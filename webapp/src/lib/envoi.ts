// @spec CRM-058 (docs/BACKLOG.md) — composer et répondre depuis l'écran
// @spec docs/SPEC-mail-subsystem.md §19.4 (les six refus), §19.6 (le même chemin de code)
// @spec docs/DESIGN_SYSTEM.md §5.8 (états systématiques) ; docs/SPEC-webapp.md §6.4
// @spec docs/JOURNAL.md décision 330
//
// L'INTERFACE N'OUVRE JAMAIS DE CONNEXION SMTP (§5) : elle met en file, et le worker envoie. Ce
// module ne fait donc qu'appeler la garde et classer ses refus — six, dont chacun demande à
// l'utilisateur un geste différent.

import { classerErreur, type ErreurDonnees } from './async'
import type { ClientCrm } from './supabase'

export type IdentiteEnvoi = {
	readonly id: string
	readonly libelle: string
	readonly adresse: string
}

/**
 * Les identités que l'appelant peut EMPLOYER — et c'est plus étroit que ce qu'il peut LIRE.
 *
 * MESURÉ, ET CE N'ÉTAIT PAS CE QUE JE CROYAIS : la RLS de `mail_outbound_identities` ouvre la
 * lecture aux administrateurs sur TOUTES les identités du workspace, y compris les identités
 * personnelles de leurs collègues — c'est une règle de supervision, pas d'usage. Une liste qui s'en
 * remettrait à elle proposerait donc à une administratrice d'expédier au nom d'un collègue, et la
 * garde refuserait au premier envoi (`identity_not_available`). Proposer une action qui échouera
 * est pire que ne pas la proposer.
 *
 * LE FILTRE EST UNE AIDE D'INTERFACE, JAMAIS LA RÈGLE (`CLAUDE.md` §10) : la règle reste dans la
 * garde, qui refuse de toute façon. C'est pourquoi il est écrit ici, en clair, plutôt que caché
 * dans une requête.
 */
export async function lireIdentitesDisponibles(
	client: ClientCrm | null,
	idUtilisateur: string | null,
): Promise<readonly IdentiteEnvoi[]> {
	if (client === null) return []
	try {
		const reponse = await client
			.from('mail_outbound_identities')
			.select('id, label, from_address, owner_id')
			.order('label')
		if (reponse.error !== null) return []
		return reponse.data
			// L'identité de SERVICE — sans propriétaire — appartient au workspace : la garde ne
			// l'ouvre qu'aux administrateurs, et un membre qui la choisirait serait refusé. La lui
			// proposer reste néanmoins juste : la RLS ne la lui montre que s'il l'administre.
			.filter((ligne) => ligne.owner_id === null || ligne.owner_id === idUtilisateur)
			.map((ligne) => ({
				id: ligne.id,
				libelle: ligne.label,
				adresse: ligne.from_address,
			}))
	} catch {
		return []
	}
}

export type NatureRefusEnvoi =
	/** `42501` : ni le droit d'écrire sur l'affaire, ni le droit d'emprunter cette identité. */
	| 'forbidden'
	/** `23514` : affaire fermée, sans adresse, ou message sans destinataire. */
	| 'invalide'
	/** `23505` : le quota journalier de l'identité est atteint. */
	| 'quota'
	| 'network'
	| 'unknown'

export type RefusEnvoi = { readonly nature: NatureRefusEnvoi; readonly detail: string }

/**
 * Classe le refus d'une mise en file.
 *
 * LE QUOTA EST DISTINGUÉ DU RESTE, et ce n'est pas un raffinement : « vous ne pouvez pas écrire au
 * nom de cette affaire » et « cette identité a atteint son plafond du jour » demandent deux gestes
 * différents — demander un droit, ou attendre demain. Les confondre sous « une erreur est
 * survenue » serait la valeur par défaut trompeuse que `CLAUDE.md` §18 proscrit.
 */
export function classerRefusEnvoi(
	statutHttp: number | undefined,
	code: string | undefined,
	detail: string,
): RefusEnvoi {
	if (code === '23505') return { nature: 'quota', detail }
	if (code === '23514') return { nature: 'invalide', detail }
	if (statutHttp === 401 || statutHttp === 403) return { nature: 'forbidden', detail }
	if (statutHttp === undefined || statutHttp === 0) return { nature: 'network', detail }
	return { nature: 'unknown', detail }
}

export type Brouillon = {
	readonly idCard: string
	readonly idIdentite: string
	readonly destinataires: readonly string[]
	readonly objet: string
	readonly corps: string
	/** Identifiant du message auquel on répond — absent pour un message initial. */
	readonly repondA?: string
}

/**
 * Sépare une saisie de destinataires en adresses.
 *
 * LA VIRGULE ET LE POINT-VIRGULE SONT ACCEPTÉS tous les deux : les deux séparateurs coexistent
 * dans les clients de messagerie, et refuser l'un obligerait l'utilisateur à savoir lequel ce
 * produit attend.
 */
export function decouperDestinataires(saisie: string): readonly string[] {
	return saisie
		.split(/[,;]/)
		.map((morceau) => morceau.trim())
		.filter((morceau) => morceau !== '')
}

/** Met un message en file. Rend `null` en cas de succès, le refus sinon. */
export async function mettreEnFile(
	client: ClientCrm | null,
	brouillon: Brouillon,
): Promise<RefusEnvoi | null> {
	if (client === null) return { nature: 'unknown', detail: 'configuration_absente' }
	try {
		const reponse = await client.rpc('queue_outbound_email', {
			p_card_id: brouillon.idCard,
			p_identity_id: brouillon.idIdentite,
			p_to: [...brouillon.destinataires],
			p_subject: brouillon.objet,
			p_body_text: brouillon.corps,
			...(brouillon.repondA === undefined ? {} : { p_in_reply_to_message_id: brouillon.repondA }),
		})
		if (reponse.error !== null) {
			return classerRefusEnvoi(reponse.status, reponse.error.code, reponse.error.message)
		}
		return null
	} catch (cause) {
		const erreur: ErreurDonnees = classerErreur(
			undefined,
			cause instanceof Error ? cause.message : String(cause),
		)
		return { nature: 'network', detail: erreur.detail }
	}
}

/**
 * L'objet d'une réponse, préfixé une seule fois.
 *
 * `Re: Re: Re:` est le symptôme d'un produit qui empile sans regarder : le préfixe est ajouté s'il
 * manque, et laissé tel quel sinon.
 */
export function objetDeReponse(objet: string): string {
	return /^re\s*:/i.test(objet.trim()) ? objet.trim() : `Re: ${objet.trim()}`
}
