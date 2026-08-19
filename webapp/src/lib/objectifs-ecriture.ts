// @spec CRM-083 (docs/BACKLOG.md) — canevas d'objectifs, tranche 2a : la GÉOMÉTRIE, c'est-à-dire
//       poser un bloc, le déplacer et le redimensionner, à la souris comme au clavier
// @spec docs/SPEC-goals.md §3 (poser un bloc — position issue du geste, jamais d'un placement
//       automatique ; déplacer et redimensionner — persiste `pos_x`, `pos_y`, `width`, `height`)
// @spec docs/SPEC-goals.md §4.2 (écriture ouverte à tout membre pouvant écrire ; un `viewer`
//       n'écrit rien), §2.2 (colonnes et bornes du bloc)
// @spec docs/SPEC-permissions-rls.md §7 (un refus de lecture est zéro ligne, pas une erreur)
// @spec docs/SPEC-webapp.md §6.4 (contrat asynchrone)
// @spec docs/DESIGN_SYSTEM.md §5.29 (canevas d'objectifs)
//
// CE MODULE N'ANTICIPE AUCUN DROIT. Il envoie, puis TRADUIT ce qu'il reçoit (`CLAUDE.md` §10) : la
// règle réelle vit dans les politiques `goal_blocks_*` de la migration `0049`, jamais ici.
//
// TROIS ISSUES ET NON DEUX, pour une modification comme pour une création, et la troisième est
// structurelle : la clause `using` d'une politique rend une ligne INVISIBLE à l'écriture, si bien
// que le serveur répond `200` avec ZÉRO ligne — ni un succès, ni une erreur. C'est la règle que
// `docs/DESIGN_SYSTEM.md` §5.25, §5.27 et §5.28 ont déjà posée trois fois pour le carnet, et elle
// se retrouve ici pour la même cause. Annoncer « Enregistré » sur zéro ligne serait la simulation
// de succès que `CLAUDE.md` §18 interdit.

import type { BlocObjectif } from './objectifs'
import { destinationDepuisEmbarque } from './objectifs'
import { COLONNES_BLOC } from './objectifs'
import type { ClientCrm } from './supabase'

/**
 * Taille d'un bloc neuf, en unités de canevas.
 *
 * Ce n'est PAS un placement automatique au sens du §3 — celui-ci porte sur la POSITION, qui vient
 * toujours du geste. La taille, elle, doit bien valoir quelque chose : la contrainte
 * `goal_blocks_taille_check` refuse zéro, et un bloc posé sans dimension n'existerait pas à
 * l'écran. La valeur retenue est celle du gabarit rendu par la tranche 1, à quoi le geste de
 * redimensionnement donne ensuite la mesure voulue.
 */
export const TAILLE_BLOC_NEUF = { largeur: 220, hauteur: 120 } as const

/**
 * Taille minimale imposée AU GESTE, jamais à la donnée.
 *
 * Elle ne double aucune contrainte de la base (`CLAUDE.md` §10, `docs/DESIGN_SYSTEM.md` §5.3 ter) :
 * la base n'exige que `width > 0`, et une valeur inférieure posée par une autre voie est acceptée
 * puis rendue telle quelle. Ce que cette borne protège est le geste lui-même — le commentaire de la
 * migration `0049` le nomme : « un bloc de largeur ou de hauteur nulle serait invisible et
 * impossible à ressaisir à la souris ». Une poignée qu'on peut réduire jusqu'à la faire disparaître
 * est une poignée qu'on ne peut plus attraper.
 */
export const TAILLE_BLOC_MINIMALE = { largeur: 120, hauteur: 72 } as const

/**
 * Pas d'un déplacement ou d'un redimensionnement au clavier (`docs/SPEC-goals.md` §5.5).
 *
 * Deux pas et non un : le pas ordinaire sert à composer, le pas fin à ajuster. Sans le second, le
 * clavier ne saurait pas atteindre les positions que la souris atteint, et la parité souris /
 * clavier du §8 serait tenue en apparence seulement.
 */
export const PAS_CLAVIER = 8
export const PAS_CLAVIER_FIN = 1

/**
 * Le canevas commence à l'origine, et une coordonnée négative sortirait de son étendue.
 *
 * `etendueCanevas` mesure de `0` au bord le plus lointain : un bloc posé en `-40` serait rendu hors
 * de la surface défilable, donc inatteignable à la souris ET au clavier. Le geste est donc borné à
 * l'origine — la donnée, elle, n'est bornée par rien, et un bloc négatif venu d'ailleurs reste rendu
 * là où il est.
 */
export function bornerCoordonnee(valeur: number): number {
	return Math.max(0, Math.round(valeur))
}

/** Borne une dimension au minimum du geste, en unités entières. */
export function bornerDimension(valeur: number, minimum: number): number {
	return Math.max(minimum, Math.round(valeur))
}

/**
 * Les trois natures de refus d'une écriture de bloc, et rien d'autre : le dictionnaire est FERMÉ.
 *
 * `detail` accompagne chaque nature pour le diagnostic ; il n'est JAMAIS affiché tel quel, un
 * message de serveur n'étant pas un texte d'interface (`docs/DESIGN_SYSTEM.md` §10).
 */
export type RefusBloc = {
	readonly nature: 'interdit' | 'saisie-invalide' | 'indisponible'
	readonly detail: string
}

/** Une contrainte de forme violée — titre vide, taille nulle, couleur hors énumération. */
export const CODE_SAISIE_INVALIDE = '23514'

/** Le refus d'une politique en `with check` — mesuré `403` / `42501` sur la lectrice du seed. */
export const CODE_INTERDIT = '42501'

/**
 * Classe un refus — LE CODE POSTGRESQL D'ABORD, le statut HTTP ensuite.
 *
 * L'ordre suit le patron de `classerRefusCreation` (`contacts.ts`), et pour le même motif : deux
 * causes qui appellent des gestes opposés peuvent partager un statut, jamais un code.
 */
export function classerRefusBloc(
	statutHttp: number | undefined,
	code: string | undefined,
	detail: string,
): RefusBloc {
	if (code === CODE_SAISIE_INVALIDE) return { nature: 'saisie-invalide', detail }
	if (code === CODE_INTERDIT) return { nature: 'interdit', detail }
	if (statutHttp === 401 || statutHttp === 403) return { nature: 'interdit', detail }
	return { nature: 'indisponible', detail }
}

/** Les deux issues d'une création : la ligne créée, ou un refus traduit. */
export type ResultatCreationBloc =
	| { readonly statut: 'cree'; readonly bloc: BlocObjectif }
	| { readonly statut: 'refus'; readonly refus: RefusBloc }

/** Les trois issues d'une modification. La troisième est celle de la clause `using`. */
export type ResultatGeometrie =
	| { readonly statut: 'enregistree'; readonly bloc: BlocObjectif }
	| { readonly statut: 'sans-effet' }
	| { readonly statut: 'refus'; readonly refus: RefusBloc }

/** Ce qu'un geste de pose transporte : le tableau, la position du geste, et le titre saisi. */
export type PoseBloc = {
	readonly idTableau: string
	readonly x: number
	readonly y: number
	readonly titre: string
}

/**
 * Traduit la ligne rendue par PostgREST en bloc d'écran.
 *
 * La forme est celle de `lireContenuTableau` : l'imbrication du channel est RETIRÉE de la ligne et
 * traduite en destination, pour que le reste du produit n'ait jamais à connaître la forme que
 * PostgREST donne à un embed.
 */
export function blocDepuisLigne(brut: unknown): BlocObjectif {
	const ligne = brut as Record<string, unknown>
	const { channels, ...reste } = ligne
	return {
		...(reste as Omit<BlocObjectif, 'destination'>),
		destination: destinationDepuisEmbarque(channels),
	}
}

/**
 * Pose un bloc sur le canevas.
 *
 * LA POSITION VIENT DU GESTE, jamais d'un placement automatique (§3) : l'appelant transmet le
 * point du clic, ou celui du repère déplacé au clavier. Ce module ne cherche pas une place libre,
 * ne décale pas un bloc qui en recouvrirait un autre, et n'aligne rien sur une grille — un tableau
 * blanc restitue exactement le geste (§2.3, sur les flèches, et le même principe vaut ici).
 *
 * `channel_id` n'est PAS envoyé : poser un lien exige `app.can_write_channel` (§4.2), c'est un
 * geste distinct que la tranche suivante livre. Un bloc neuf naît sans destination.
 *
 * `.select(...)` obtient la ligne créée avec son embed, ce qui permet au canevas de l'ajouter à
 * sa place sans relire le tableau entier.
 *
 * Ne lève jamais.
 */
export async function poserBloc(client: ClientCrm, pose: PoseBloc): Promise<ResultatCreationBloc> {
	try {
		const reponse = await client
			.from('goal_blocks')
			.insert({
				board_id: pose.idTableau,
				title: pose.titre.trim(),
				pos_x: bornerCoordonnee(pose.x),
				pos_y: bornerCoordonnee(pose.y),
				width: TAILLE_BLOC_NEUF.largeur,
				height: TAILLE_BLOC_NEUF.hauteur,
			})
			.select(COLONNES_BLOC)
			.single()
		if (reponse.error !== null) {
			return {
				statut: 'refus',
				refus: classerRefusBloc(reponse.status, reponse.error.code, reponse.error.message),
			}
		}
		return { statut: 'cree', bloc: blocDepuisLigne(reponse.data) }
	} catch (cause) {
		return {
			statut: 'refus',
			refus: classerRefusBloc(undefined, undefined, cause instanceof Error ? cause.message : String(cause)),
		}
	}
}

/**
 * Écrit la géométrie d'un bloc — position, taille, ou les deux.
 *
 * UNE SEULE FONCTION POUR LES DEUX GESTES, parce que c'est une seule écriture : déplacer et
 * redimensionner touchent les mêmes quatre colonnes de la même ligne, sous la même politique. Deux
 * fonctions ne différeraient que par les clés envoyées, et divergeraient au premier ajustement.
 *
 * `.select(...)` accompagne la mise à jour précisément pour que « zéro ligne touchée » existe comme
 * réponse : sans lui, PostgREST ne rend aucun corps et le refus silencieux de la clause `using`
 * serait indistinguable d'un succès (patron de `detacherContact`).
 *
 * Ne lève jamais.
 */
export async function ecrireGeometrieBloc(
	client: ClientCrm,
	idBloc: string,
	geometrie: {
		readonly x?: number
		readonly y?: number
		readonly largeur?: number
		readonly hauteur?: number
	},
): Promise<ResultatGeometrie> {
	const modifications: Record<string, number> = {}
	if (geometrie.x !== undefined) modifications.pos_x = bornerCoordonnee(geometrie.x)
	if (geometrie.y !== undefined) modifications.pos_y = bornerCoordonnee(geometrie.y)
	if (geometrie.largeur !== undefined) {
		modifications.width = bornerDimension(geometrie.largeur, TAILLE_BLOC_MINIMALE.largeur)
	}
	if (geometrie.hauteur !== undefined) {
		modifications.height = bornerDimension(geometrie.hauteur, TAILLE_BLOC_MINIMALE.hauteur)
	}

	try {
		const reponse = await client
			.from('goal_blocks')
			.update(modifications)
			.eq('id', idBloc)
			.select(COLONNES_BLOC)
		if (reponse.error !== null) {
			return {
				statut: 'refus',
				refus: classerRefusBloc(reponse.status, reponse.error.code, reponse.error.message),
			}
		}
		const lignes = reponse.data ?? []
		if (lignes.length === 0) return { statut: 'sans-effet' }
		return { statut: 'enregistree', bloc: blocDepuisLigne(lignes[0]) }
	} catch (cause) {
		return {
			statut: 'refus',
			refus: classerRefusBloc(undefined, undefined, cause instanceof Error ? cause.message : String(cause)),
		}
	}
}
