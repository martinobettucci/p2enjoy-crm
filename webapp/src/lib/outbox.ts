// @spec CRM-144 (docs/BACKLOG.md) — tranche T3 : l'outbox côté webapp — lire les trois dossiers (« En file », « Envoyés »,
//       « Échecs ») sous la RLS, leurs comptes, annuler un envoi en file (`cancel_outbound_email`), réessayer un échec
//       (`retry_outbound_email`), le dictionnaire des motifs et celui des refus (docs/SPEC-mail-subsystem.md §28.2 à §28.7 ;
//       docs/DESIGN_SYSTEM.md §5.98 ; décisions 898 et 906)
//
// CE MODULE N'OUVRE AUCUNE RÈGLE. La lecture passe par la politique `mail_outbox_lecture` (`app.can_read_card`) : chacun voit
// les envois des affaires qu'il lit, et un récapitulatif quotidien, sans affaire, n'est rendu à personne. Le droit d'annuler
// ou de réessayer est la colonne calculée `outbox_gestes_permis`, rendue par la base sur la ligne (§5.59) : l'écran ne lit
// aucun rôle. Les deux gestes sont des fonctions de la base, qui refusent de toute façon.

import { classerErreur, enErreur, pret, type EtatAsync } from './async'
import { LIMITE_COMPTE, OPTIONS_COMPTE } from './compter'
import type { ClientCrm } from './supabase'

/** Les trois dossiers de l'outbox, et la valeur qui les désigne dans l'adresse (`?envois=`, §5.98). */
export type DossierEnvoi = 'file' | 'envoyes' | 'echecs'
export const DOSSIERS_ENVOI: readonly DossierEnvoi[] = ['file', 'envoyes', 'echecs']
export const PARAMETRE_ENVOIS = 'envois'

/** La valeur d'adresse lue défensivement : une valeur inconnue ne désigne aucun dossier. */
export function dossierEnvoiDepuisAdresse(valeur: string | null): DossierEnvoi | null {
	return DOSSIERS_ENVOI.find((dossier) => dossier === valeur) ?? null
}

/** Les états de `mail_outbox.status` que chaque dossier montre (§28.6). */
const STATUTS: Record<DossierEnvoi, readonly string[]> = {
	file: ['queued', 'sending'],
	envoyes: ['sent'],
	echecs: ['failed'],
}

/** La page de « Envoyés » (§5.98 : paginée par « Afficher plus »). Les deux autres dossiers sont des files courtes. */
export const PAGE_ENVOYES = 50

/** Un envoi tel que l'écran le montre. */
export type EnvoiOutbox = {
	readonly id: string
	readonly idCard: string
	readonly titreCard: string | null
	readonly destinataires: readonly string[]
	readonly copies: readonly string[]
	readonly copiesCachees: readonly string[]
	readonly objet: string
	readonly corps: string
	readonly statut: 'queued' | 'sending' | 'sent' | 'failed' | 'cancelled' | 'inconnu'
	readonly essais: number
	/** `last_error` : le code de la dernière panne, traduit par `phraseMotif`. */
	readonly motif: string | null
	readonly prevuLe: string
	readonly envoyeLe: string | null
	/** `updated_at` : pour un échec, l'heure où il a été constaté. */
	readonly misAJourLe: string
	readonly expediteur: string | null
	readonly auteur: string | null
	/**
	 * La capacité d'annuler ou de réessayer, rendue par la base (`outbox_gestes_permis`) : `null` quand elle n'a pas pu
	 * être lue — la commande reste alors offerte, et la base tranche (§5.59).
	 */
	readonly gestesPermis: boolean | null
}

type LigneEnvoi = {
	readonly id: string
	readonly card_id: string
	readonly to_addrs: readonly string[] | null
	readonly cc_addrs: readonly string[] | null
	readonly bcc_addrs: readonly string[] | null
	readonly subject: string | null
	readonly body_text: string | null
	readonly status: string
	readonly attempts: number | null
	readonly next_attempt_at: string
	readonly last_error: string | null
	readonly sent_at: string | null
	readonly updated_at: string
	readonly from_address: string | null
	readonly outbox_gestes_permis?: boolean | null
	readonly cards: { readonly title: string | null } | null
	readonly auteur: { readonly full_name: string | null } | null
}

const COLONNES =
	'id,card_id,to_addrs,cc_addrs,bcc_addrs,subject,body_text,status,attempts,next_attempt_at,last_error,sent_at,' +
	'updated_at,from_address,outbox_gestes_permis,cards(title),auteur:profiles!mail_outbox_created_by_fkey(full_name)'

const STATUTS_CONNUS = ['queued', 'sending', 'sent', 'failed', 'cancelled'] as const

export function envoiDepuisLigne(ligne: LigneEnvoi): EnvoiOutbox {
	const statut = (STATUTS_CONNUS as readonly string[]).includes(ligne.status)
		? (ligne.status as EnvoiOutbox['statut'])
		: 'inconnu'
	return {
		id: ligne.id,
		idCard: ligne.card_id,
		titreCard: ligne.cards?.title ?? null,
		destinataires: ligne.to_addrs ?? [],
		copies: ligne.cc_addrs ?? [],
		copiesCachees: ligne.bcc_addrs ?? [],
		objet: ligne.subject ?? '',
		corps: ligne.body_text ?? '',
		statut,
		essais: ligne.attempts ?? 0,
		motif: ligne.last_error,
		prevuLe: ligne.next_attempt_at,
		envoyeLe: ligne.sent_at,
		misAJourLe: ligne.updated_at,
		expediteur: ligne.from_address,
		auteur: ligne.auteur?.full_name ?? null,
		// Une valeur absente ou non booléenne n'est PAS un refus : la commande reste offerte (§5.59).
		gestesPermis: typeof ligne.outbox_gestes_permis === 'boolean' ? ligne.outbox_gestes_permis : null,
	}
}

/** Une page d'un dossier : les envois, et s'il en reste après eux. */
export type PageEnvois = { readonly envois: readonly EnvoiOutbox[]; readonly plusAnciens: boolean }

/**
 * Les envois d'un dossier, dans son ordre (§28.6) : « En file » du plus proche départ au plus lointain, les deux autres du
 * plus récent au plus ancien. `limite` borne « Envoyés » ; la base rend une ligne de plus pour savoir s'il en reste.
 */
export async function lireEnvois(
	client: ClientCrm | null,
	dossier: DossierEnvoi,
	limite: number = PAGE_ENVOYES,
): Promise<EtatAsync<PageEnvois>> {
	if (client === null) return enErreur(classerErreur(undefined, 'configuration_absente'))
	try {
		let requete = client.from('mail_outbox').select(COLONNES).in('status', [...STATUTS[dossier]])
		if (dossier === 'file') {
			requete = requete.order('next_attempt_at', { ascending: true }).order('id', { ascending: true })
		} else if (dossier === 'envoyes') {
			requete = requete
				.order('sent_at', { ascending: false, nullsFirst: false })
				.order('id', { ascending: false })
				.limit(limite + 1)
		} else {
			requete = requete.order('updated_at', { ascending: false }).order('id', { ascending: false })
		}
		const reponse = await requete
		if (reponse.error !== null) return enErreur(classerErreur(reponse.status, reponse.error.message))
		const lignes = (reponse.data as unknown as LigneEnvoi[]).map(envoiDepuisLigne)
		const plusAnciens = dossier === 'envoyes' && lignes.length > limite
		return pret({ envois: plusAnciens ? lignes.slice(0, limite) : lignes, plusAnciens })
	} catch (cause) {
		return enErreur(classerErreur(undefined, cause instanceof Error ? cause.message : String(cause)))
	}
}

/** Les comptes des trois dossiers, sous la RLS de la personne. */
export type ComptesEnvois = Readonly<Record<DossierEnvoi, number>>

export async function lireComptesEnvois(client: ClientCrm | null): Promise<EtatAsync<ComptesEnvois>> {
	if (client === null) return enErreur(classerErreur(undefined, 'configuration_absente'))
	try {
		const reponses = await Promise.all(
			DOSSIERS_ENVOI.map((dossier) =>
				// LA FORME D'UN COMPTE EST CELLE DE `compter.ts` (INC-299) : un `GET` borné à zéro ligne, jamais un `HEAD`.
				client
					.from('mail_outbox')
					.select('id', OPTIONS_COMPTE)
					.in('status', [...STATUTS[dossier]])
					.limit(LIMITE_COMPTE),
			),
		)
		const fautive = reponses.find((reponse) => reponse.error !== null)
		if (fautive !== undefined && fautive.error !== null) {
			return enErreur(classerErreur(fautive.status, fautive.error.message))
		}
		const [file, envoyes, echecs] = reponses.map((reponse) => reponse.count ?? 0)
		return pret({ file: file ?? 0, envoyes: envoyes ?? 0, echecs: echecs ?? 0 })
	} catch (cause) {
		return enErreur(classerErreur(undefined, cause instanceof Error ? cause.message : String(cause)))
	}
}

/** Les motifs que la file écrit (§28.7). Un code inconnu rend `inconnu` : jamais le code brut à l'écran. */
export const MOTIFS_ENVOI = [
	'auth_failed',
	'tls_failed',
	'timeout',
	'host_unreachable',
	'connection_refused',
	'protocol_error',
	'quota_exceeded',
	'credentials_missing',
	'storage_unavailable',
	'attachment_infected',
	'attachment_missing',
	'worker_interrompu',
] as const
export type MotifEnvoi = (typeof MOTIFS_ENVOI)[number] | 'inconnu'

export function classerMotif(code: string | null): MotifEnvoi | null {
	if (code === null || code === '') return null
	return (MOTIFS_ENVOI as readonly string[]).includes(code) ? (code as MotifEnvoi) : 'inconnu'
}

/**
 * L'issue incertaine (décision 906, Q3) : un envoi `queued` dont un premier essai a été interrompu — le message a pu
 * partir, et la base refuse de l'annuler.
 */
export function issueIncertaine(envoi: EnvoiOutbox): boolean {
	return envoi.statut === 'queued' && envoi.motif === 'worker_interrompu'
}

/** Ce que le détail offre à un envoi, selon son état (§5.98) — jamais selon un rôle. */
export type GesteEnvoi = 'annuler' | 'reessayer' | 'en_cours' | 'incertain' | 'aucun'

export function gesteDe(envoi: EnvoiOutbox): GesteEnvoi {
	if (envoi.statut === 'sending') return 'en_cours'
	if (issueIncertaine(envoi)) return 'incertain'
	if (envoi.statut === 'queued') return 'annuler'
	if (envoi.statut === 'failed') return 'reessayer'
	return 'aucun'
}

/** « Au prochain passage » : un départ prévu déjà échu (§28.6). */
export function departEchu(envoi: EnvoiOutbox, maintenant: Date): boolean {
	const prevu = Date.parse(envoi.prevuLe)
	return Number.isFinite(prevu) && prevu <= maintenant.getTime()
}

/** Les refus d'annuler et de réessayer, dictionnaire fermé (§28.3, §28.4 ; §5.98). */
export type RefusEnvoiOutbox =
	| 'parti'
	| 'en_cours'
	| 'deja_annule'
	| 'en_echec'
	| 'deja_en_file'
	| 'incertain'
	| 'introuvable'
	| 'refuse'
	| 'affaire_indisponible'
	| 'quota'
	| 'reseau'
	| 'inconnu'

const REFUS_PAR_MESSAGE: Readonly<Record<string, RefusEnvoiOutbox>> = {
	outbox_sent: 'parti',
	outbox_sending: 'en_cours',
	outbox_cancelled: 'deja_annule',
	outbox_failed: 'en_echec',
	outbox_queued: 'deja_en_file',
	outbox_uncertain: 'incertain',
	outbox_not_found: 'introuvable',
	forbidden: 'refuse',
	not_authenticated: 'refuse',
	card_not_available: 'affaire_indisponible',
	quota_exceeded: 'quota',
}

export function classerRefusOutbox(statutHttp: number | undefined, message: string): RefusEnvoiOutbox {
	const connu = REFUS_PAR_MESSAGE[message]
	if (connu !== undefined) return connu
	if (statutHttp === 404) return 'introuvable'
	if (statutHttp === 401 || statutHttp === 403) return 'refuse'
	return 'inconnu'
}

async function appeler(
	client: ClientCrm | null,
	fonction: 'cancel_outbound_email' | 'retry_outbound_email',
	idEnvoi: string,
): Promise<RefusEnvoiOutbox | null> {
	if (client === null) return 'inconnu'
	try {
		const reponse = await client.rpc(fonction, { p_outbox_id: idEnvoi })
		if (reponse.error !== null) return classerRefusOutbox(reponse.status, reponse.error.message)
		return null
	} catch {
		return 'reseau'
	}
}

/** Annule un envoi en file. Rend `null` en cas de succès, le refus sinon. */
export const annulerEnvoi = (client: ClientCrm | null, idEnvoi: string) =>
	appeler(client, 'cancel_outbound_email', idEnvoi)

/** Remet en file un envoi en échec. Rend `null` en cas de succès, le refus sinon. */
export const reessayerEnvoi = (client: ClientCrm | null, idEnvoi: string) =>
	appeler(client, 'retry_outbound_email', idEnvoi)
