// @spec CRM-111 (docs/BACKLOG.md) — tranche T7.2 : archiver et désarchiver un rattachement depuis le bloc
//       « Rattachements » de la fiche (docs/SPEC-rattachements.md §5 « Archiver, désarchiver », §8.1 ; décision 823)
// @spec docs/DESIGN_SYSTEM.md §5.82 (le geste, sans confirmation, jamais éteint d'avance, refus dans la ligne) ;
//       docs/SPEC-rattachements.md §4 (le droit : écrire le channel du rattachement, tenu par `card_placements_update`)
//
// CE MODULE N'OUVRE AUCUNE RÈGLE. Il écrit la seule colonne `archived_at` du rattachement, sous la politique
// `card_placements_update` et le privilège de colonne de `authenticated` ; le déclencheur `card_placements_write_events`
// inscrit `archived` ou `unarchived` au fil. Un refus de politique rend `200` et zéro ligne : la requête relit donc la
// ligne écrite, sans quoi un refus passerait pour un succès (décision 70).

import { classerEcritureEntete, type IssueEcritureEntete } from './entete-card'
import type { ClientCrm } from './supabase'

/** Ce que l'écran distingue d'un archivage : réussi, refusé par la base, ou en panne. */
export type IssueArchivage = 'enregistree' | 'refusee' | 'reseau'

/** Ramène l'issue d'une écriture au trio du bloc : tout ce qui n'est pas un succès ni une panne est un refus. */
export function issueArchivage(issue: IssueEcritureEntete): IssueArchivage {
	if (issue === 'enregistree') return 'enregistree'
	if (issue === 'reseau') return 'reseau'
	return 'refusee'
}

/** Archive (`archiver = true`) ou désarchive un rattachement. L'horodatage est celui du client, comme pour un nœud. */
export async function archiverRattachement(
	client: ClientCrm,
	idRattachement: string,
	archiver: boolean,
	maintenant: () => string = () => new Date().toISOString(),
): Promise<IssueArchivage> {
	try {
		const reponse = await client
			.from('card_placements')
			.update({ archived_at: archiver ? maintenant() : null })
			.eq('id', idRattachement)
			.select('id')
		const code = reponse.error === null ? null : (reponse.error.code ?? '')
		return issueArchivage(classerEcritureEntete(reponse.status, code, reponse.data?.length ?? 0))
	} catch {
		// `supabase-js` peut relancer une panne de transport plutôt que la rendre : c'est une panne, dite comme telle.
		return 'reseau'
	}
}
