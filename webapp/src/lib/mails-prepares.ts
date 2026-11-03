// @spec CRM-128 (docs/BACKLOG.md) — tranche T4 : les mails préparés côté webapp — les lire (la personne seule, par la
//       RLS), les envoyer avec le contenu relu (`send_email_draft`), les écarter (`discard_email_draft`), et le
//       dictionnaire de leurs refus (docs/SPEC-mails-prepares.md §3.3 à §3.5, §6 ; docs/DESIGN_SYSTEM.md §5.90 ;
//       décision 829)
//
// CE MODULE N'OUVRE AUCUNE RÈGLE. La lecture passe par la politique `mail_drafts_lecture_personne`, qui ne rend que les
// mails préparés de la personne ; l'envoi passe par `send_email_draft`, qui appelle `queue_outbound_email` et en garde
// tous les contrôles. Un refus de cette dernière remonte tel quel : il est classé par `classerRefusEnvoi`, le même
// dictionnaire que le formulaire d'envoi, et deux refus propres s'y ajoutent.

import { classerErreur, enErreur, pret, type EtatAsync } from './async'
import { classerRefusEnvoi, type Brouillon, type RefusEnvoi } from './envoi'
import type { ClientCrm } from './supabase'

/** Un mail préparé en attente de relecture, tel que l'écran le montre et le préremplit (§6.1). */
export type MailPrepare = {
	readonly id: string
	readonly idCard: string
	readonly titreCard: string | null
	readonly idIdentite: string | null
	readonly repondA: string | null
	readonly destinataires: readonly string[]
	readonly copies: readonly string[]
	readonly copiesCachees: readonly string[]
	readonly objet: string
	readonly corps: string
	/** `mcp` : préparé par l'assistant ; `web` : préparé dans le CRM. */
	readonly origine: 'mcp' | 'web'
	readonly creeLe: string
}

type LigneMailPrepare = {
	readonly id: string
	readonly card_id: string
	readonly identity_id: string | null
	readonly in_reply_to_message_id: string | null
	readonly to_addrs: readonly string[] | null
	readonly cc_addrs: readonly string[] | null
	readonly bcc_addrs: readonly string[] | null
	readonly subject: string | null
	readonly body_text: string
	readonly origin: string
	readonly created_at: string
	readonly cards: { readonly title: string | null } | null
}

const COLONNES =
	'id,card_id,identity_id,in_reply_to_message_id,to_addrs,cc_addrs,bcc_addrs,subject,body_text,origin,created_at,' +
	'cards(title)'

export function mailPrepareDepuisLigne(ligne: LigneMailPrepare): MailPrepare {
	return {
		id: ligne.id,
		idCard: ligne.card_id,
		titreCard: ligne.cards?.title ?? null,
		idIdentite: ligne.identity_id,
		repondA: ligne.in_reply_to_message_id,
		destinataires: ligne.to_addrs ?? [],
		copies: ligne.cc_addrs ?? [],
		copiesCachees: ligne.bcc_addrs ?? [],
		objet: ligne.subject ?? '',
		corps: ligne.body_text,
		// UNE ORIGINE INCONNUE N'EST PAS « l'assistant » : la contrainte de la base n'en connaît que deux, et le défaut le
		// plus prudent est de ne pas attribuer au connecteur ce qu'on ne sait pas venir de lui.
		origine: ligne.origin === 'mcp' ? 'mcp' : 'web',
		creeLe: ligne.created_at,
	}
}

/**
 * Les mails préparés EN ATTENTE de la personne, du plus ancien au plus récent (§5.90 : une file de travail) ; ceux d'une
 * affaire seulement quand `idCard` est donné. La RLS ne rend que les siens : aucun filtre `created_by` n'est nécessaire,
 * et en poser un ferait croire que l'écran tient la règle.
 */
export async function lireMailsPrepares(
	client: ClientCrm | null,
	idCard?: string,
): Promise<EtatAsync<readonly MailPrepare[]>> {
	if (client === null) return enErreur(classerErreur(undefined, 'configuration_absente'))
	try {
		let requete = client
			.from('mail_drafts')
			.select(COLONNES)
			.eq('status', 'pending')
			.order('created_at', { ascending: true })
			.order('id', { ascending: true })
		if (idCard !== undefined) requete = requete.eq('card_id', idCard)
		const reponse = await requete
		if (reponse.error !== null) return enErreur(classerErreur(reponse.status, reponse.error.message))
		return pret((reponse.data as unknown as LigneMailPrepare[]).map(mailPrepareDepuisLigne))
	} catch (cause) {
		return enErreur(classerErreur(undefined, cause instanceof Error ? cause.message : String(cause)))
	}
}

/** Les refus propres aux mails préparés, en plus de ceux de l'envoi (`docs/SPEC-mails-prepares.md` §3.4, §3.5). */
export type RefusMailPrepare = RefusEnvoi | { readonly nature: 'plus_en_attente'; readonly detail: string }

/**
 * Classe un refus de `send_email_draft` ou de `discard_email_draft`. **« Plus en attente »** recouvre `draft_not_pending`
 * et `draft_not_found` : un mail envoyé ou écarté entre-temps, et un mail absent ou d'autrui, ne se distinguent pas à
 * l'écran (§5.90) ; le 404 de la base porte `P0002` et le message `draft_not_found`.
 */
export function classerRefusMailPrepare(
	statutHttp: number | undefined,
	code: string | undefined,
	detail: string,
): RefusMailPrepare {
	if (detail === 'draft_not_pending' || detail === 'draft_not_found' || statutHttp === 404) {
		return { nature: 'plus_en_attente', detail }
	}
	return classerRefusEnvoi(statutHttp, code, detail)
}

/** Ce qui part : le contenu du formulaire de relecture, l'affaire et la réponse restant celles du mail préparé. */
export type ContenuRelu = Pick<Brouillon, 'idIdentite' | 'destinataires' | 'objet' | 'corps' | 'copiesCachees' | 'pieces'> & {
	readonly copies?: readonly string[]
}

/** Envoie un mail préparé avec le contenu relu. Rend `null` en cas de succès, le refus sinon. */
export async function envoyerMailPrepare(
	client: ClientCrm | null,
	idMail: string,
	contenu: ContenuRelu,
): Promise<RefusMailPrepare | null> {
	if (client === null) return { nature: 'unknown', detail: 'configuration_absente' }
	try {
		const reponse = await client.rpc('send_email_draft', {
			p_draft_id: idMail,
			p_identity_id: contenu.idIdentite,
			p_to: [...contenu.destinataires],
			p_subject: contenu.objet,
			p_body_text: contenu.corps,
			p_cc: [...(contenu.copies ?? [])],
			p_bcc: [...(contenu.copiesCachees ?? [])],
			p_attachments: [...(contenu.pieces ?? [])],
		})
		if (reponse.error !== null) {
			return classerRefusMailPrepare(reponse.status, reponse.error.code, reponse.error.message)
		}
		return null
	} catch (cause) {
		return { nature: 'network', detail: cause instanceof Error ? cause.message : String(cause) }
	}
}

/** Écarte un mail préparé : il ne partira jamais. Rend `null` en cas de succès, le refus sinon. */
export async function ecarterMailPrepare(
	client: ClientCrm | null,
	idMail: string,
): Promise<RefusMailPrepare | null> {
	if (client === null) return { nature: 'unknown', detail: 'configuration_absente' }
	try {
		const reponse = await client.rpc('discard_email_draft', { p_draft_id: idMail })
		if (reponse.error !== null) {
			return classerRefusMailPrepare(reponse.status, reponse.error.code, reponse.error.message)
		}
		return null
	} catch (cause) {
		return { nature: 'network', detail: cause instanceof Error ? cause.message : String(cause) }
	}
}

/** L'adresse qui ouvre la relecture d'un mail préparé (§5.90) ; le connecteur rend la même. */
export const PARAMETRE_BROUILLON = 'brouillon'

export function adresseRelecture(idMail: string): string {
	return `/inbox?${PARAMETRE_BROUILLON}=${encodeURIComponent(idMail)}`
}
