// @spec CRM-067 (docs/BACKLOG.md) — tranche T2 : lire, consigner, corriger et retirer les activités d'une affaire
// @spec docs/SPEC-activites.md §2 (ce qui est consigné : type fermé, date jamais future, durée, sujet, compte rendu,
//       participants), §3 (deux tables, pierre tombale, politiques d'un commentaire, modération bornée au retrait),
//       §5 (refus traduits par un dictionnaire fermé)
// @spec docs/DESIGN_SYSTEM.md §5.63 (le bloc « Activités » et la sixième famille du fil), §5.8 (états)
// @spec docs/SPEC-webapp.md §6.4 (contrat asynchrone)
// @spec CLAUDE.md §10 — ce module ne décide AUCUN droit : il écrit dans les tables, et les politiques décident
//
// Ce module ne rend rien : il **lit et écrit**. La classification des refus, l'ordre de la liste, la conversion des dates
// du formulaire et l'écriture des participants y sont vérifiables sans navigateur.
//
// LES PARTICIPANTS S'ÉCRIVENT APRÈS L'ACTIVITÉ, UN PAR UN (docs/DESIGN_SYSTEM.md §5.63). La clé de
// `card_activity_participants` exige l'activité, et un envoi groupé est atomique : un seul participant refusé ferait
// tomber tous les autres. Un par un, l'écran sait combien ont été posés, et le dit.

import { classerErreur, enErreur, pret, type EtatAsync } from './async'
import type { Database } from './database.types'
import type { ProfilAffiche } from './identites'
import type { ClientCrm } from './supabase'

/** Les trois types, dans l'ordre où le formulaire les offre (docs/SPEC-activites.md §2). */
export const TYPES_ACTIVITE = ['call', 'meeting', 'visio'] as const
export type TypeActivite = (typeof TYPES_ACTIVITE)[number]

export const estTypeActivite = (valeur: string): valeur is TypeActivite =>
	(TYPES_ACTIVITE as readonly string[]).includes(valeur)

/** Les bornes de la base, reprises pour les attributs du formulaire — la base reste seule juge (§2). */
export const LONGUEUR_MAX_SUJET = 200
export const LONGUEUR_MAX_COMPTE_RENDU = 20_000
export const DUREE_MIN = 1
export const DUREE_MAX = 1440

/**
 * Colonnes réellement demandées. Exportée pour que les tests éprouvent **la requête émise**.
 *
 * L'auteur est embarqué par sa clé NOMMÉE : `card_activities` porte deux clés vers `profiles` (`author_id`,
 * `deleted_by`), et un embarquement sans nom serait ambigu (`PGRST201`). `deleted_by` est lue et seulement comparée :
 * l'écran dit qu'un tiers a retiré, jamais qui (docs/DESIGN_SYSTEM.md §5.10, §5.63).
 */
export const COLONNES_ACTIVITE =
	'id, card_id, type, occurred_at, duration_minutes, subject, body, author_id, created_at, edited_at, deleted_at, deleted_by, ' +
	'auteur:profiles!card_activities_author_id_fkey(id, full_name, avatar_url), ' +
	'participants:card_activity_participants(contact_id, profile_id, contact:contacts(full_name), profil:profiles(full_name))'

type ParticipantBrut = {
	readonly contact_id: string | null
	readonly profile_id: string | null
	readonly contact: { readonly full_name: string | null } | null
	readonly profil: { readonly full_name: string | null } | null
}

export type ActiviteLue = {
	readonly id: string
	readonly card_id: string
	readonly type: string
	readonly occurred_at: string
	readonly duration_minutes: number | null
	readonly subject: string
	readonly body: string | null
	readonly author_id: string | null
	readonly created_at: string
	readonly edited_at: string | null
	readonly deleted_at: string | null
	readonly deleted_by: string | null
	readonly auteur: ProfilAffiche | null
	readonly participants: readonly ParticipantBrut[] | null
}

/** Un participant tel que l'écran le nomme ; `nom` nul quand la base ne le rend pas lisible. */
export type ParticipantAffiche = { readonly id: string; readonly nom: string | null }

export type ActiviteAffichee = {
	readonly id: string
	readonly type: TypeActivite
	readonly survenueLe: string
	readonly dureeMinutes: number | null
	readonly sujet: string
	readonly compteRendu: string | null
	readonly auteurId: string | null
	readonly auteur: ProfilAffiche | null
	readonly creeLe: string
	readonly modifieLe: string | null
	readonly retiree: boolean
	/** Vrai quand la pierre tombale a été posée par quelqu'un d'autre que l'auteur (§5.10, §5.63). */
	readonly retireeParModeration: boolean
	readonly contacts: readonly ParticipantAffiche[]
	readonly membres: readonly ParticipantAffiche[]
}

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

/**
 * Projette les activités lues, **la plus récente en tête** (docs/DESIGN_SYSTEM.md §5.63).
 *
 * L'ordre est TOTAL, terminé par l'identifiant : deux activités consignées à la même minute ne doivent pas s'échanger
 * d'un rechargement à l'autre. Un type hors des trois est un défaut de la contrainte, pas une valeur à deviner : la ligne
 * est écartée, comme un rôle inconnu dans `membres-espace.ts`.
 */
export function projeterActivites(lignes: readonly ActiviteLue[]): readonly ActiviteAffichee[] {
	const activites: ActiviteAffichee[] = []
	for (const ligne of lignes) {
		if (!estTypeActivite(ligne.type)) continue
		const participants = ligne.participants ?? []
		activites.push({
			id: ligne.id,
			type: ligne.type,
			survenueLe: ligne.occurred_at,
			dureeMinutes: ligne.duration_minutes,
			sujet: ligne.subject,
			compteRendu: ligne.body,
			auteurId: ligne.author_id,
			auteur: ligne.auteur ?? null,
			creeLe: ligne.created_at,
			modifieLe: ligne.edited_at,
			retiree: ligne.deleted_at != null,
			// `!= null` couvre une colonne absente autant que nulle : une réponse dégradée n'accuse personne (§5.10).
			retireeParModeration:
				ligne.deleted_at != null && ligne.deleted_by != null && ligne.deleted_by !== ligne.author_id,
			contacts: participants.flatMap((p) =>
				p.contact_id === null ? [] : [{ id: p.contact_id, nom: p.contact?.full_name ?? null }],
			),
			membres: participants.flatMap((p) =>
				p.profile_id === null ? [] : [{ id: p.profile_id, nom: p.profil?.full_name ?? null }],
			),
		})
	}
	return activites.sort((a, b) =>
		a.survenueLe === b.survenueLe ? compare(b.id, a.id) : compare(b.survenueLe, a.survenueLe),
	)
}

/** Lit les activités d'une affaire, retirées comprises en pierre tombale. */
export async function lireActivites(
	client: ClientCrm,
	idCard: string,
): Promise<EtatAsync<readonly ActiviteAffichee[]>> {
	try {
		const reponse = await client.from('card_activities').select(COLONNES_ACTIVITE).eq('card_id', idCard)
		if (reponse.error !== null) return enErreur(classerErreur(reponse.status, reponse.error.message))
		return pret(projeterActivites((reponse.data ?? []) as unknown as readonly ActiviteLue[]))
	} catch (cause) {
		return enErreur(classerErreur(undefined, cause instanceof Error ? cause.message : String(cause)))
	}
}

// ---------------------------------------------------------------------------------------------
// Les refus — dictionnaire fermé (docs/SPEC-activites.md §5)
// ---------------------------------------------------------------------------------------------

export type NatureRefusActivite =
	/** `23514` `activity_in_future` : une activité réalisée a eu lieu (§2). */
	| 'future'
	/** `23514` sur `card_activities_subject_check` : sujet blanc ou de plus de 200 caractères. */
	| 'sujet'
	/** `23514` sur `card_activities_duration_check`, ou une durée qui n'est pas un entier. */
	| 'duree'
	/** `23514` sur `card_activities_body_check` : compte rendu de plus de 20 000 caractères. */
	| 'compte-rendu'
	/** `23514` `participant_outside_card` : contact non lié à l'affaire, ou non-membre de l'espace. */
	| 'participant'
	/** `P0001` `activity_deleted` : la pierre tombale est définitive. */
	| 'retiree'
	/** `P0001` `activity_moderation_limited` : un tiers ne fait que retirer. */
	| 'moderation'
	/** `401`, `403`, `42501`, ou `card_not_found` : l'affaire n'est pas ouverte en écriture à l'appelant. */
	| 'forbidden'
	/** `200` et zéro ligne : la politique a filtré la ligne, rien n'a changé. */
	| 'sans-effet'
	| 'network'
	| 'unknown'

/**
 * Classe un refus par ce que la base rend : le code, puis le **symbole** du message.
 *
 * Le message d'un `raise exception` est un identifiant de contrat (`activity_in_future`), et celui d'un `CHECK` nomme
 * la contrainte : ce sont eux qui distinguent quatre `23514` qui disent quatre choses. La prose de la base n'atteint
 * jamais l'écran (`CLAUDE.md` §20).
 */
export function classerRefusActivite(
	statutHttp: number | undefined,
	code: string | undefined,
	message: string,
): NatureRefusActivite {
	if (code === '23514') {
		if (message === 'activity_in_future') return 'future'
		if (message === 'participant_outside_card') return 'participant'
		if (message.includes('card_activities_subject_check')) return 'sujet'
		if (message.includes('card_activities_duration_check')) return 'duree'
		if (message.includes('card_activities_body_check')) return 'compte-rendu'
		return 'unknown'
	}
	if (code === 'P0001') {
		if (message === 'activity_deleted') return 'retiree'
		if (message === 'activity_moderation_limited') return 'moderation'
		if (message === 'card_not_found') return 'forbidden'
		return 'unknown'
	}
	if (code === '42501' || statutHttp === 401 || statutHttp === 403) return 'forbidden'
	if (statutHttp === undefined || statutHttp === 0) return 'network'
	return 'unknown'
}

// ---------------------------------------------------------------------------------------------
// Le formulaire : dates et durée
// ---------------------------------------------------------------------------------------------

const deuxChiffres = (n: number): string => String(n).padStart(2, '0')

/**
 * La valeur d'un `input type="datetime-local"` pour un instant, à l'heure LOCALE du poste, à la minute.
 *
 * Le champ ne connaît pas de fuseau : il montre l'heure du poste, et c'est ce que la personne a vécu. Une date
 * illisible rend une chaîne vide, jamais « Invalid Date ».
 */
export function versChampLocal(iso: string): string {
	const date = new Date(iso)
	if (Number.isNaN(date.getTime())) return ''
	return (
		`${date.getFullYear()}-${deuxChiffres(date.getMonth() + 1)}-${deuxChiffres(date.getDate())}` +
		`T${deuxChiffres(date.getHours())}:${deuxChiffres(date.getMinutes())}`
	)
}

/** L'instant d'une valeur de champ local, en ISO, ou `null` si le champ est vide ou illisible. */
export function depuisChampLocal(valeur: string): string | null {
	if (valeur.trim() === '') return null
	const date = new Date(valeur)
	return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

/**
 * La durée saisie : vide vaut « pas de durée » ; un entier est envoyé tel quel, la base jugeant ses bornes ; tout le
 * reste est refusé AVANT l'envoi, parce que la colonne est entière et qu'un `1,5` y rendrait un refus de syntaxe que le
 * dictionnaire ne saurait pas nommer.
 */
export function lireDuree(texte: string): { readonly ok: true; readonly valeur: number | null } | { readonly ok: false } {
	const net = texte.trim()
	if (net === '') return { ok: true, valeur: null }
	if (!/^\d+$/.test(net)) return { ok: false }
	return { ok: true, valeur: Number(net) }
}

// ---------------------------------------------------------------------------------------------
// Les écritures
// ---------------------------------------------------------------------------------------------

/** Ce que le formulaire envoie, une fois converti. */
export type SaisieActivite = {
	readonly type: TypeActivite
	readonly survenueLe: string
	readonly dureeMinutes: number | null
	readonly sujet: string
	/** Vide vaut « pas de compte rendu » : la base porte alors `null`, pas une chaîne vide. */
	readonly compteRendu: string
	readonly contacts: readonly string[]
	readonly membres: readonly string[]
}

/**
 * L'issue d'une écriture d'activité.
 *
 * `participantsRefuses` compte les participants que la base n'a pas acceptés après une activité ÉCRITE : c'est la
 * troisième issue du §5.63, ni un succès entier ni un refus. `natureParticipants` dit pourquoi, quand il y en a.
 */
export type IssueActivite =
	| {
			readonly statut: 'applique'
			readonly participantsRefuses: number
			readonly natureParticipants: NatureRefusActivite | null
	  }
	| { readonly statut: 'refus'; readonly nature: NatureRefusActivite }

type ReponseBrute = {
	readonly data: unknown
	readonly error: { readonly code?: string; readonly message: string } | null
	readonly status: number
}

const refusDe = (reponse: ReponseBrute): NatureRefusActivite =>
	classerRefusActivite(reponse.status, reponse.error?.code, reponse.error?.message ?? '')

const refusDeCause = (cause: unknown): NatureRefusActivite =>
	classerRefusActivite(undefined, undefined, cause instanceof Error ? cause.message : String(cause))

const valeursActivite = (saisie: SaisieActivite) => ({
	type: saisie.type,
	occurred_at: saisie.survenueLe,
	duration_minutes: saisie.dureeMinutes,
	subject: saisie.sujet,
	body: saisie.compteRendu.trim() === '' ? null : saisie.compteRendu,
})

type ParticipantCible = { readonly colonne: 'contact_id' | 'profile_id'; readonly id: string }

const cibles = (contacts: readonly string[], membres: readonly string[]): readonly ParticipantCible[] => [
	...contacts.map((id) => ({ colonne: 'contact_id' as const, id })),
	...membres.map((id) => ({ colonne: 'profile_id' as const, id })),
]

/** Pose ou retire des participants un par un ; rend les refus, dans l'ordre d'envoi. */
async function ecrireParticipants(
	client: ClientCrm,
	idActivite: string,
	ajouts: readonly ParticipantCible[],
	retraits: readonly ParticipantCible[],
): Promise<readonly NatureRefusActivite[]> {
	const refus: NatureRefusActivite[] = []
	for (const cible of retraits) {
		try {
			const reponse = await client
				.from('card_activity_participants')
				.delete()
				.eq('activity_id', idActivite)
				.eq(cible.colonne, cible.id)
				.select('activity_id')
			if (reponse.error !== null) refus.push(refusDe(reponse))
			else if ((reponse.data ?? []).length === 0) refus.push('sans-effet')
		} catch (cause) {
			refus.push(refusDeCause(cause))
		}
	}
	for (const cible of ajouts) {
		try {
			const reponse = await client
				.from('card_activity_participants')
				.insert(
					cible.colonne === 'contact_id'
						? { activity_id: idActivite, contact_id: cible.id }
						: { activity_id: idActivite, profile_id: cible.id },
				)
			if (reponse.error !== null) refus.push(refusDe(reponse))
		} catch (cause) {
			refus.push(refusDeCause(cause))
		}
	}
	return refus
}

const issueAppliquee = (refus: readonly NatureRefusActivite[]): IssueActivite => ({
	statut: 'applique',
	participantsRefuses: refus.length,
	natureParticipants: refus[0] ?? null,
})

/**
 * Consigne une activité, puis ses participants (docs/SPEC-activites.md §3).
 *
 * L'auteur, l'espace et les dates de traçabilité ne sont PAS envoyés : la base les pose (défaut `auth.uid()`, trigger),
 * et le privilège de colonne refuserait un auteur fourni par le client.
 */
export async function consignerActivite(
	client: ClientCrm,
	idCard: string,
	saisie: SaisieActivite,
): Promise<IssueActivite> {
	try {
		// `workspace_id` N'EST PAS ENVOYÉE, et la conversion le dit : le générateur la déclare requise parce qu'il ne voit
		// pas le trigger qui la dérive de l'affaire, mais le privilège d'insertion ne l'ouvre pas — l'envoyer rendrait
		// `403` (migration `0100`, docs/SPEC-activites.md §3).
		const ligne = { card_id: idCard, ...valeursActivite(saisie) } as Database['public']['Tables']['card_activities']['Insert']
		const reponse = await client
			.from('card_activities')
			.insert(ligne)
			.select('id')
			.single()
		if (reponse.error !== null) return { statut: 'refus', nature: refusDe(reponse) }
		const refus = await ecrireParticipants(client, reponse.data.id, cibles(saisie.contacts, saisie.membres), [])
		return issueAppliquee(refus)
	} catch (cause) {
		return { statut: 'refus', nature: refusDeCause(cause) }
	}
}

/**
 * Corrige une activité dont l'appelant est l'auteur, puis met ses participants à jour par différence.
 *
 * `edited_at` n'est pas envoyé : le trigger la pose si et seulement si le contenu change. Un `200` sans ligne est
 * `sans-effet` — la politique a filtré (non-auteur, droit retombé) — et rien n'est tenté sur les participants.
 */
export async function corrigerActivite(
	client: ClientCrm,
	activite: Pick<ActiviteAffichee, 'id' | 'contacts' | 'membres'>,
	saisie: SaisieActivite,
): Promise<IssueActivite> {
	try {
		const reponse = await client
			.from('card_activities')
			.update(valeursActivite(saisie))
			.eq('id', activite.id)
			.select('id')
		if (reponse.error !== null) return { statut: 'refus', nature: refusDe(reponse) }
		if ((reponse.data ?? []).length === 0) return { statut: 'refus', nature: 'sans-effet' }
		const avant = cibles(
			activite.contacts.map((p) => p.id),
			activite.membres.map((p) => p.id),
		)
		const apres = cibles(saisie.contacts, saisie.membres)
		const cle = (c: ParticipantCible) => `${c.colonne}:${c.id}`
		const clesAvant = new Set(avant.map(cle))
		const clesApres = new Set(apres.map(cle))
		const refus = await ecrireParticipants(
			client,
			activite.id,
			apres.filter((c) => !clesAvant.has(cle(c))),
			avant.filter((c) => !clesApres.has(cle(c))),
		)
		return issueAppliquee(refus)
	} catch (cause) {
		return { statut: 'refus', nature: refusDeCause(cause) }
	}
}

/**
 * Pose la pierre tombale. La date envoyée est ignorée : le trigger la remplace par `now()`, efface le sujet et le
 * compte rendu, et retire les participants (docs/SPEC-activites.md §3).
 */
export async function retirerActivite(client: ClientCrm, idActivite: string): Promise<IssueActivite> {
	try {
		const reponse = await client
			.from('card_activities')
			.update({ deleted_at: new Date().toISOString() })
			.eq('id', idActivite)
			.select('id')
		if (reponse.error !== null) return { statut: 'refus', nature: refusDe(reponse) }
		if ((reponse.data ?? []).length === 0) return { statut: 'refus', nature: 'sans-effet' }
		return issueAppliquee([])
	} catch (cause) {
		return { statut: 'refus', nature: refusDeCause(cause) }
	}
}
