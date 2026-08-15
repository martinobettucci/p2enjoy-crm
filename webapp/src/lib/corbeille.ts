// @spec CRM-077 (docs/BACKLOG.md) — corbeille et restauration : l'énumération des enfants rendus
//       inaccessibles, cinquième tranche
// @spec docs/SPEC-corbeille.md §3.3 (l'énumération remplace la descente de l'horodatage), §3.5 (ce
//       qu'elle compte exactement, la forme des lectures, la composition), §4 (ce que l'écran montre)
// @spec docs/SPEC-permissions-rls.md §7 (un refus de lecture est zéro ligne)
// @spec docs/SPEC-webapp.md §6.4 (contrat asynchrone)
//
// CE MODULE N'OUVRE AUCUNE POLITIQUE NOUVELLE. Il lit `channels` sous la RLS de `CRM-021` et compte
// `cards` sous celle de `CRM-040` : ce qu'il rend est donc ce que l'appelant peut déjà lire
// ailleurs. MESURÉ le 2026-08-15 sur le track `conseil-ia` du seed — l'administratrice lit 3
// channels et 7 affaires, la lectrice 1 channel et 2 affaires. C'est voulu, et le §3.5 en tire la
// seule interdiction qui compte : ce nombre n'est pas une garantie d'exhaustivité.

import { classerErreur, enErreur, pret, type EtatAsync } from './async'
import type { ClientCrm } from './supabase'

/**
 * L'objet dont on énumère les enfants.
 *
 * Le type est une somme plutôt qu'une paire `(table, id)` : les deux cas ne comptent pas les mêmes
 * enfants (§3.5), et un appelant qui se tromperait de table ne compilerait pas.
 */
export type CibleEnumeration =
	| { readonly type: 'track'; readonly id: string }
	| { readonly type: 'channel'; readonly id: string }

/**
 * Ce que l'énumération rapporte, par type d'enfant.
 *
 * `channels` vaut toujours `0` pour un channel : il n'en porte pas. Le champ reste présent plutôt
 * que rendu optionnel, pour que la composition traite les deux cibles sans se demander de quoi elle
 * parle.
 */
export type EnumerationEnfants = {
	readonly channels: number
	readonly cards: number
}

/** Colonne réellement demandée. Exportée pour que les tests vérifient la requête émise. */
export const COLONNE_ENFANT = 'id'

/** Le compte vient du serveur, jamais des lignes rapportées (§3.5). */
export const OPTIONS_COMPTE = { count: 'exact', head: true } as const

/**
 * Une réponse aboutie sans `count` est un contrat rompu, pas une corbeille vide — même position que
 * `lireCompteursFileSortante` (`mail-etat.ts`) et `lirePageCards` (`liste-cards.ts`). Rendre `0`
 * ferait dire à l'écran « rien ne sera perdu » sur une réponse qu'on n'a pas comprise.
 */
const COMPTE_ABSENT = 'count absent alors que la réponse a abouti'

/**
 * Compte les enfants qu'une mise à la corbeille rendrait inaccessibles, ou que la corbeille retient
 * déjà — c'est le même compte, et donc la même requête, pour l'écran de confirmation d'un geste et
 * pour l'entrée d'un parent déjà retiré (§3.5, §4).
 *
 * Trois règles portées par les requêtes elles-mêmes :
 *
 *   * `deleted_at=is.null` sur les enfants — un enfant DÉJÀ en corbeille n'est pas compté : il ne
 *     *devient* pas inaccessible, il l'est, et il porte sa propre entrée où il se restaure
 *     séparément ;
 *   * aucun filtre sur `archived_at` — un enfant archivé EST compté, parce que l'archivage est
 *     réversible et que le désarchivage est livré : ce retour attendu est exactement ce que la mise
 *     à la corbeille du parent immobilise ;
 *   * les affaires sont comptées sur les channels retenus par la première lecture, donc jamais
 *     celles d'un channel lui-même en corbeille : elles sont retenues un cran plus bas, et
 *     restaurer le track ne les rendrait pas.
 *
 * DEUX LECTURES PLUTÔT QU'UNE JOINTURE EMBARQUÉE, ET C'EST MESURÉ : `cards` porte deux clés
 * étrangères composites vers `channels` (`cards_channel_id_workflow_id_fkey` et
 * `cards_channel_id_workspace_id_fkey`), et `select=id,channels!inner(id)` rend `300` / `PGRST201`.
 * Lever l'ambiguïté demanderait d'écrire un nom de contrainte dans la requête d'un écran, ce que
 * `lireCardsClassables` (`inbox.ts`) a déjà refusé pour cette relation. Le nombre de channels est la
 * longueur de la première lecture : il ne coûte aucune requête de plus.
 */
export async function compterEnfantsInaccessibles(
	client: ClientCrm,
	cible: CibleEnumeration,
): Promise<EtatAsync<EnumerationEnfants>> {
	try {
		if (cible.type === 'channel') {
			const cards = await client
				.from('cards')
				.select(COLONNE_ENFANT, OPTIONS_COMPTE)
				.eq('channel_id', cible.id)
				.is('deleted_at', null)
			if (cards.error !== null) {
				return enErreur(classerErreur(cards.status, cards.error.message))
			}
			if (cards.count === null) return enErreur(classerErreur(undefined, COMPTE_ABSENT))
			return pret({ channels: 0, cards: cards.count })
		}

		const channels = await client
			.from('channels')
			.select(COLONNE_ENFANT)
			.eq('track_id', cible.id)
			.is('deleted_at', null)
		if (channels.error !== null) {
			return enErreur(classerErreur(channels.status, channels.error.message))
		}
		const identifiants = channels.data.map((ligne) => ligne.id)
		// AUCUNE SECONDE LECTURE SANS CHANNEL. MESURÉ : `channel_id=in.()` rend `200` et `*/0`, donc
		// ce n'est pas un piège qu'on évite — c'est une requête dont la réponse est connue d'avance,
		// comme `useContenuTrack` n'interroge pas `channels` pour un track absent.
		if (identifiants.length === 0) return pret({ channels: 0, cards: 0 })

		const cards = await client
			.from('cards')
			.select(COLONNE_ENFANT, OPTIONS_COMPTE)
			.in('channel_id', identifiants)
			.is('deleted_at', null)
		if (cards.error !== null) {
			return enErreur(classerErreur(cards.status, cards.error.message))
		}
		if (cards.count === null) return enErreur(classerErreur(undefined, COMPTE_ABSENT))
		return pret({ channels: identifiants.length, cards: cards.count })
	} catch (cause) {
		// `supabase-js` peut relancer une panne de transport plutôt que la rendre : un échec réseau
		// ne doit pas remonter comme une exception non traitée jusqu'à React.
		return enErreur(classerErreur(undefined, cause instanceof Error ? cause.message : String(cause)))
	}
}

/**
 * Une ligne de l'énumération telle que l'écran l'affiche : un type d'enfant et son compte.
 *
 * La composition ne rend AUCUN texte : le catalogue vit dans `webapp/src/i18n`, qu'aucun module de
 * `lib/` n'importe. Le choix du singulier ou du pluriel appartient donc à l'écran, qui le fait sur
 * ce compte avec deux clés distinctes — jamais par une phrase concaténée (`CLAUDE.md` §23).
 */
export type LigneEnumeration =
	| { readonly type: 'channels'; readonly compte: number }
	| { readonly type: 'cards'; readonly compte: number }

/**
 * Compose l'énumération : les channels d'abord, les affaires ensuite — du plus englobant au plus
 * fin —, et **toute ligne dont le compte est nul est omise** : « 0 channel » n'apprend rien et se
 * lit deux fois pour comprendre qu'il n'y a rien (§3.5).
 *
 * Une énumération entièrement vide rend **aucune ligne**, et non une ligne à zéro : l'écran dit
 * alors sa propre phrase d'état vide (§4), un tableau sans ligne n'étant pas un état vide.
 */
export function composerEnumeration(enumeration: EnumerationEnfants): readonly LigneEnumeration[] {
	const lignes: LigneEnumeration[] = []
	if (enumeration.channels > 0) lignes.push({ type: 'channels', compte: enumeration.channels })
	if (enumeration.cards > 0) lignes.push({ type: 'cards', compte: enumeration.cards })
	return lignes
}
