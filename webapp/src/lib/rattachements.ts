// @spec CRM-111 (docs/BACKLOG.md) — tranche T2.3 : les gestes désignent le rattachement, et l'écran doit donc le connaître
// @spec docs/SPEC-rattachements.md §3.1 (la table), §5 (les signatures par rattachement), §14 (le découpage) ;
//       docs/JOURNAL.md décisions 661, 705
//
// Pendant la bascule, une affaire n'a qu'UN rattachement (index `card_placements_one_per_card_idx`), et les écrans qui
// lisent une affaire lisent aussi le sien, par le plongement `card_placements!card_placements_card_fk(id, created_at)`,
// écrit EN CLAIR dans chaque liste de colonnes : une concaténation ferait perdre à `supabase-js` l'inférence de la
// réponse (mesuré, `formulaire.ts`). La clé est nommée, ce qui fige le contrat au lieu de laisser PostgREST la déduire.
// Ce module dit lequel employer ; T7 donnera à la fiche ses blocs par rattachement, et ce choix disparaîtra avec eux.

/** Ce qu'une affaire lue porte de ses rattachements. */
export type RattachementsLus = {
	readonly card_placements: readonly { readonly id: string; readonly created_at: string }[]
}

/**
 * Le rattachement d'une affaire : le plus ancien, comme `app.card_first_placement` en base, l'identifiant départageant
 * deux créations simultanées. `null` quand l'affaire n'en rend aucun — un rattachement que l'appelant ne lit pas lui
 * est masqué (décision 642) —, et le geste ne doit alors pas partir.
 */
export function idRattachement(affaire: RattachementsLus): string | null {
	let retenu: { readonly id: string; readonly created_at: string } | null = null
	for (const rattachement of affaire.card_placements) {
		if (
			retenu === null ||
			rattachement.created_at < retenu.created_at ||
			(rattachement.created_at === retenu.created_at && rattachement.id < retenu.id)
		) {
			retenu = rattachement
		}
	}
	return retenu?.id ?? null
}
