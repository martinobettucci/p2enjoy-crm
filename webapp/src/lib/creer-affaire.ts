// @spec CRM-095 (docs/BACKLOG.md) — tranche T2 : l'appel de l'écran au geste serveur de création
// @spec docs/SPEC-cards.md §18.2 (le geste serveur et ses refus nommés), §18.3 (l'écran : succès qui
//       ouvre la fiche, refus traduits) ; docs/JOURNAL.md décision 609
// @spec docs/SPEC-webapp.md §6.4 (contrat asynchrone : une panne n'est jamais un succès)
//
// Ce module ne rend rien : il appelle `public.creer_affaire` et CLASSE sa réponse. La classification
// vit ici, à un seul endroit, parce que le board et la vue liste portent le même geste, et parce qu'elle
// se prouve sans navigateur.
//
// LA RÈGLE N'EST PAS ICI. Qui peut créer, dans quel channel, à quelle étape : la base en décide
// (`cards_insertion`, l'étape initiale résolue par la fonction). L'écran n'anticipe aucun refus ; il
// traduit celui qu'il reçoit (CLAUDE.md §10).

import type { ClientCrm } from './supabase'

/** Les quatre refus que l'écran sait dire (docs/SPEC-cards.md §18.3). */
export type RefusCreationAffaire = 'channel-ferme' | 'sans-etape-initiale' | 'interdit' | 'panne'

export type IssueCreationAffaire =
	| { readonly ok: true; readonly idCard: string }
	| { readonly ok: false; readonly refus: RefusCreationAffaire }

/**
 * Un identifiant d'affaire tel que la base le rend : un `uuid` en toutes lettres.
 *
 * La forme est vérifiée plutôt que supposée : une réponse `200` sans identifiant lisible ne permettrait
 * pas d'ouvrir la fiche, et l'annoncer comme un succès serait la simulation que `CLAUDE.md` §18 interdit.
 */
const FORME_IDENTIFIANT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Crée une affaire, avec le seul titre, dans le channel donné (docs/SPEC-cards.md §18.2).
 *
 * Le titre part tel qu'il a été saisi : la fonction le ramène elle-même par `btrim`, et un second
 * traitement ici ferait deux règles pour une donnée.
 *
 * Correspondance des refus, dans l'ordre des contrôles de la fonction :
 *   - `42501` — l'écriture du channel est refusée (`cards_insertion`), ou l'appelant n'a pas d'identité ;
 *   - `P0002` « channel introuvable » — le channel n'est plus lisible : l'écran le dit comme un refus
 *     d'écriture, sans distinguer ce que la base confond délibérément (docs/SPEC-permissions-rls.md §7) ;
 *   - `P0001` « channel ferme » — archivé ou à la corbeille ;
 *   - `P0001` « aucune etape initiale » — le workflow du channel n'en désigne aucune ;
 *   - tout le reste — réseau, réponse inattendue — est une panne, que l'écran invite à réessayer.
 */
export async function creerAffaire(
	client: ClientCrm | null,
	idChannel: string,
	titre: string,
): Promise<IssueCreationAffaire> {
	if (client === null) return { ok: false, refus: 'panne' }
	try {
		const reponse = await client.rpc('creer_affaire', { p_channel: idChannel, p_titre: titre })
		if (reponse.error === null) {
			return typeof reponse.data === 'string' && FORME_IDENTIFIANT.test(reponse.data)
				? { ok: true, idCard: reponse.data }
				: { ok: false, refus: 'panne' }
		}
		if (reponse.error.code === '42501' || reponse.error.code === 'P0002') return { ok: false, refus: 'interdit' }
		if (reponse.error.code === 'P0001') {
			if (reponse.error.message === 'channel ferme') return { ok: false, refus: 'channel-ferme' }
			if (reponse.error.message === 'aucune etape initiale') return { ok: false, refus: 'sans-etape-initiale' }
		}
		return { ok: false, refus: 'panne' }
	} catch {
		return { ok: false, refus: 'panne' }
	}
}
