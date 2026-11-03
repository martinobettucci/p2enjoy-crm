// @spec CRM-111 (docs/BACKLOG.md) — tranche T7.5 : les AUTRES rattachements lisibles d'une affaire, pour la pastille
//       « aussi rattachée à N » du board et de la vue liste (docs/SPEC-rattachements.md §8 ; docs/DESIGN_SYSTEM.md §5.85)
//
// Le board et la liste partent des rattachements d'UN channel ; chacun plonge son affaire, et l'affaire plonge à son tour
// ses rattachements (`rattachements:card_placements!card_placements_card_fk(…)`, écrit en clair dans chaque liste de
// colonnes — une concaténation ferait perdre à `supabase-js` l'inférence, `rattachements.ts`). La RLS de
// `card_placements` ne rend que les lisibles : ce module ne filtre rien, il retire le rattachement courant et nomme les
// autres.

/** Un rattachement tel que l'affaire plongée le rend. */
export type RattachementPlonge = {
	readonly id: string
	readonly channels: { readonly name: string; readonly tracks: { readonly name: string } | null } | null
}

/** Le chemin d'un autre rattachement, tel que la pastille le nomme. */
export type CheminRattachement = { readonly track: string; readonly channel: string }

/**
 * Les autres rattachements de l'affaire, sans celui du channel affiché, dans l'ordre des tracks puis des channels
 * (décision 814). Un rattachement dont le chemin n'est pas rendu n'est pas nommable : il n'est pas compté.
 */
export function autresRattachements(
	rattachements: readonly RattachementPlonge[] | null | undefined,
	idCourant: string,
): readonly CheminRattachement[] {
	const autres: CheminRattachement[] = []
	for (const rattachement of rattachements ?? []) {
		if (rattachement.id === idCourant) continue
		const channel = rattachement.channels
		const track = channel?.tracks ?? null
		if (channel === null || track === null) continue
		autres.push({ track: track.name, channel: channel.name })
	}
	return autres.sort((a, b) => a.track.localeCompare(b.track, 'fr') || a.channel.localeCompare(b.channel, 'fr'))
}
