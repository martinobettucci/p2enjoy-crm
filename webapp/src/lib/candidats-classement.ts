// @spec CRM-137 (docs/BACKLOG.md) — classer un mail : les affaires candidates d'un message, lues par la base
// @spec docs/SPEC-mail-subsystem.md §26.2 (le contrat de `classification_candidates`), §26.3 (l'écran : 51 demandées
//       pour en montrer 50, le choix qui survit au filtre) ; docs/DESIGN_SYSTEM.md §5.94 ; docs/JOURNAL.md décision 893
//
// Ce module ne rend rien : il LIT et RÉDUIT. Aucun droit n'y est appliqué — la fonction est `security invoker`, et ce
// qu'elle ne rend pas est un refus déjà appliqué par la RLS (`CLAUDE.md` §10).

import { classerErreur, type ErreurDonnees } from './async'
import type { Database } from './database.types'

type ClientCrm = {
	rpc: (
		nom: 'classification_candidates',
		args: Database['public']['Functions']['classification_candidates']['Args'],
	) => PromiseLike<{
		data: Database['public']['Functions']['classification_candidates']['Returns'] | null
		error: { message: string } | null
		status: number
	}>
}

/** Une affaire où le message peut être classé. */
export type Candidate = {
	readonly id: string
	readonly titre: string
	/** « Track › Channel » du plus ancien rattachement actif ; vide si l'un des deux ne se lit pas. */
	readonly chemin: string
	/** Un contact de l'affaire porte l'adresse de l'expéditeur (§26.2). */
	readonly connue: boolean
}

/** Ce que l'écran montre au plus ; la base en rend une de plus pour dire la troncature (§26.3). */
export const CANDIDATES_AFFICHEES = 50

export type DemandeCandidates = {
	readonly messageId: string
	/** La case « Expéditeur connu ». */
	readonly connues: boolean
	readonly terme: string
}

export type ResultatCandidates =
	| { readonly ok: true; readonly candidates: readonly Candidate[]; readonly tronquee: boolean }
	| { readonly ok: false; readonly erreur: ErreurDonnees }

/**
 * Lit les affaires candidates. Demande `CANDIDATES_AFFICHEES + 1` lignes : la ligne de plus ne s'affiche pas, elle dit
 * seulement qu'il y en a d'autres. Le terme est envoyé rogné, et un terme blanc n'est pas envoyé.
 */
export async function lireCandidates(client: ClientCrm | null, demande: DemandeCandidates): Promise<ResultatCandidates> {
	if (client === null) return { ok: false, erreur: { nature: 'unknown', detail: 'configuration_absente' } }
	const terme = demande.terme.trim()
	try {
		const reponse = await client.rpc('classification_candidates', {
			p_message_id: demande.messageId,
			p_known_sender: demande.connues,
			...(terme === '' ? {} : { p_search: terme }),
			p_limit: CANDIDATES_AFFICHEES + 1,
		})
		if (reponse.error !== null) return { ok: false, erreur: classerErreur(reponse.status, reponse.error.message) }
		const lignes = reponse.data ?? []
		return {
			ok: true,
			candidates: lignes.slice(0, CANDIDATES_AFFICHEES).map((ligne) => ({
				id: ligne.card_id,
				titre: ligne.title,
				chemin: ligne.path ?? '',
				connue: ligne.known_sender === true,
			})),
			tronquee: lignes.length > CANDIDATES_AFFICHEES,
		}
	} catch (cause) {
		return { ok: false, erreur: classerErreur(undefined, cause instanceof Error ? cause.message : String(cause)) }
	}
}

/**
 * La présélection du §26.3 : une seule candidate, case cochée et sans terme. Partout ailleurs, aucune — choisir à la
 * place de la personne entre plusieurs affaires serait deviner.
 */
export function preselection(demande: DemandeCandidates, candidates: readonly Candidate[]): Candidate | null {
	if (!demande.connues || demande.terme.trim() !== '') return null
	return candidates.length === 1 ? (candidates[0] ?? null) : null
}
