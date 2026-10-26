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
