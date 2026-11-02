// @spec CRM-111 (docs/BACKLOG.md) — tranche T2.3 : les gestes désignent le rattachement, et l'écran doit donc le connaître
// @spec docs/SPEC-rattachements.md §3.1 (la table), §5 (les signatures par rattachement), §14 (le découpage) ;
//       docs/JOURNAL.md décisions 661, 705
// @spec CRM-111 (docs/BACKLOG.md) — tranche T4.1 : `premierDansLOrdreDesTracks`, le lien d'une affaire trouvée ;
//       docs/SPEC-rattachements.md §9 ; docs/SPEC-recherche.md ; décision 814
//
// Une affaire peut avoir plusieurs rattachements depuis `CRM-111` T3 ; les écrans qui lisent une affaire lisent son
// PLUS ANCIEN, la « forme d'avant », par le plongement `card_placements!card_placements_card_fk(id, created_at)`,
// écrit EN CLAIR dans chaque liste de colonnes : une concaténation ferait perdre à `supabase-js` l'inférence de la
// réponse (mesuré, `formulaire.ts`). La clé est nommée, ce qui fige le contrat au lieu de laisser PostgREST la déduire.
// Ce module dit lequel employer ; T7 donnera à la fiche ses blocs par rattachement, et ce choix disparaîtra avec eux.

import type { Database } from './database.types'

/**
 * La ligne d'avant `CRM-111` T2.4.5 : l'affaire et les colonnes de son rattachement, la forme que les écrans reçoivent depuis
 * T2.4.1 (`carteDepuisRattachement`, `ligneDepuisRattachement`, `cardDepuisRattachements`). Les colonnes de rattachement
 * ont quitté `cards` ; ce type les reprend du rattachement, pour que les projections des écrans restent écrites colonne par
 * colonne (docs/SPEC-rattachements.md §3.2).
 */
export type LigneAffaire = Database['public']['Tables']['cards']['Row'] &
	Omit<
		Database['public']['Tables']['card_placements']['Row'],
		'id' | 'workspace_id' | 'card_id' | 'created_at' | 'updated_at' | 'created_by'
	>

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
	return premierRattachement(affaire.card_placements)?.id ?? null
}

/**
 * Une affaire lue avec ses rattachements et leur channel, ramenée à la forme d'avant `CRM-111` T2.4.1 : `channels` est le
 * channel de son PLUS ANCIEN rattachement, `null` s'il n'en rend aucun. Les modules qui situent une affaire — son adresse,
 * sa pilule « Track › Channel » — gardent ainsi leur projection et leurs preuves ; T4 à T6 fixeront leur forme à plusieurs.
 */
export function channelDuPremierRattachement<
	A extends {
		readonly card_placements: readonly { readonly id: string; readonly created_at: string; readonly channels: unknown }[]
	},
>(affaire: A): Omit<A, 'card_placements'> & { readonly channels: A['card_placements'][number]['channels'] | null } {
	const { card_placements, ...reste } = affaire
	return { ...reste, channels: premierRattachement(card_placements)?.channels ?? null }
}

/** Une affaire telle que la lisent les lignes de coût et de recette : ses rattachements à la place de leurs colonnes. */
export type AffaireParRattachements<A extends { readonly archived_at: string | null; readonly channels: unknown }> = Omit<
	A,
	'archived_at' | 'channels'
> & {
	readonly card_placements: readonly {
		readonly id: string
		readonly created_at: string
		readonly archived_at: string | null
		readonly channels: A['channels']
	}[]
}

/** Ramène une ligne qui plonge son affaire par rattachements à la forme d'avant (`situationDuPremierRattachement`). */
export function situerLigne<A extends { readonly archived_at: string | null; readonly channels: unknown }, L extends { readonly cards: AffaireParRattachements<A> | null }>(
	ligne: L,
): Omit<L, 'cards'> & { readonly cards: (Omit<A, 'archived_at' | 'channels'> & { readonly archived_at: string | null; readonly channels: A['channels'] | null }) | null } {
	return { ...ligne, cards: ligne.cards === null ? null : situationDuPremierRattachement(ligne.cards) }
}

/**
 * Comme `channelDuPremierRattachement`, avec l'archivage : `archived_at` est celui du plus ancien rattachement, la forme
 * d'avant `CRM-111` T2.4.1 où `cards.archived_at` en était le miroir. Les lignes de coût et de recette situent ainsi
 * leur affaire et sa pilule « archivée » sans changer de projection ; `null` quand aucun rattachement n'est rendu.
 */
export function situationDuPremierRattachement<
	A extends {
		readonly card_placements: readonly {
			readonly id: string
			readonly created_at: string
			readonly archived_at: string | null
			readonly channels: unknown
		}[]
	},
>(
	affaire: A,
): Omit<A, 'card_placements'> & {
	readonly archived_at: string | null
	readonly channels: A['card_placements'][number]['channels'] | null
} {
	const { card_placements, ...reste } = affaire
	const premier = premierRattachement(card_placements)
	return { ...reste, archived_at: premier?.archived_at ?? null, channels: premier?.channels ?? null }
}

/**
 * Le plus ancien d'une liste de rattachements, quelles que soient les colonnes qu'ils portent (`CRM-111` T2.4.1 : une
 * lecture qui situe l'affaire — son channel, son chemin — prend celui-là, comme les gestes). `null` sur une liste vide.
 */
export function premierRattachement<R extends { readonly id: string; readonly created_at: string }>(
	liste: readonly R[],
): R | null {
	let retenu: R | null = null
	for (const rattachement of liste) {
		if (
			retenu === null ||
			rattachement.created_at < retenu.created_at ||
			(rattachement.created_at === retenu.created_at && rattachement.id < retenu.id)
		) {
			retenu = rattachement
		}
	}
	return retenu
}

/** Le channel d'un rattachement tel que la recherche le plonge : de quoi le ranger, et son track s'il est lisible. */
type ChannelRangeable = {
	readonly position: number
	readonly name: string
	readonly tracks: { readonly position: number; readonly name: string } | null
}

/**
 * Le PREMIER rattachement dans l'ordre des tracks puis des channels (`CRM-111` T4.1, décision 814) : celui que
 * `recherche_globale` nomme en tête de son sous-titre, et où mène le lien d'une affaire trouvée. Le même ordre que la
 * base — position puis nom du track, position puis nom du channel, l'identifiant du rattachement départageant le reste ;
 * un track illisible se range en dernier, comme `null` en tête d'un tri croissant de PostgreSQL. `null` sur une liste
 * vide, ou quand aucun channel n'est rendu.
 */
export function premierDansLOrdreDesTracks<R extends { readonly id: string; readonly channels: ChannelRangeable | null }>(
	liste: readonly R[],
): R | null {
	const situes = liste.filter((r): r is R & { readonly channels: ChannelRangeable } => r.channels !== null)
	const cle = (r: (typeof situes)[number]) =>
		[r.channels.tracks === null ? 1 : 0, r.channels.tracks?.position ?? 0, r.channels.tracks?.name ?? '', r.channels.position, r.channels.name, r.id] as const
	const comparer = (a: (typeof situes)[number], b: (typeof situes)[number]) => {
		const [ka, kb] = [cle(a), cle(b)]
		for (let i = 0; i < ka.length; i++) {
			const [va, vb] = [ka[i]!, kb[i]!]
			const ordre = typeof va === 'number' ? va - (vb as number) : i === 5 ? (va < vb ? -1 : va > vb ? 1 : 0) : va.localeCompare(vb as string, 'fr')
			if (ordre !== 0) return ordre
		}
		return 0
	}
	return [...situes].sort(comparer)[0] ?? null
}
