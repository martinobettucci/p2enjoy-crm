// @spec CRM-083 (docs/BACKLOG.md) — canevas d'objectifs, tranche 2a : la GÉOMÉTRIE, c'est-à-dire
//       poser un bloc, le déplacer et le redimensionner, à la souris comme au clavier ;
//       tranche 2b-1 : le CONTENU, c'est-à-dire saisir le titre, le corps, la couleur, et régler
//       le remplissage au curseur comme au champ numérique ;
//       tranche 2b-2a : LE LIEN, c'est-à-dire désigner le channel qu'un bloc vise, et retirer ce
//       lien ;
//       tranche 2b-2b : LES FLÈCHES, c'est-à-dire tracer une flèche entre deux blocs avec le choix
//       de sa direction, et corriger cette direction ensuite ;
//       tranche 2b-2c : LES SUPPRESSIONS, c'est-à-dire supprimer une flèche, et supprimer un bloc
//       — ce dernier emportant ses flèches par la cascade de la base
// @spec docs/SPEC-goals.md §2.3 (trois directions et non deux ; une flèche d'un bloc vers lui-même
//       n'a pas de sens ; unicité sur la paire — changer la direction d'une flèche existante est
//       une MODIFICATION, pas un ajout ; aucun refus de cycle)
// @spec docs/SPEC-goals.md §2.4 (`board_id` redondant, gardé par un trigger)
// @spec docs/SPEC-goals.md §3 (poser un bloc — position issue du geste, jamais d'un placement
//       automatique ; déplacer et redimensionner — persiste `pos_x`, `pos_y`, `width`, `height` ;
//       saisir le titre, le corps, la couleur ; régler le remplissage — curseur ET champ
//       numérique, les deux écrivant la même valeur ; lier le bloc à un channel — sélecteur des
//       channels LISIBLES par l'appelant, groupés par track ; retirer le lien — remet `channel_id`
//       à nul ; supprimer une flèche, supprimer un bloc — la suppression d'un bloc emporte ses
//       flèches par cascade, et un bloc se supprime réellement, il ne s'archive pas)
// @spec docs/SPEC-goals.md §4.2 (écriture ouverte à tout membre pouvant écrire ; un `viewer`
//       n'écrit rien ; POSER le lien exige `app.can_write_channel`, le RETIRER non ; une flèche
//       s'écrit par « tout membre pouvant écrire les DEUX blocs qu'elle relie »),
//       §2.2 (colonnes et bornes du bloc ; `channel_id` facultatif)
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

import { useCallback, useEffect, useRef, useState } from 'react'
import { classerErreur, enChargement, enErreur, pret, type EtatAsync } from './async'
import type { Database } from './database.types'
import type { BlocObjectif, DirectionFleche, FlecheObjectif, TableauObjectifs } from './objectifs'
import { destinationDepuisEmbarque, normaliserDirection } from './objectifs'
import { COLONNES_BLOC, COLONNES_FLECHE, COLONNES_TABLEAU } from './objectifs'
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
 * Les cinq couleurs de jeton d'un bloc (`docs/SPEC-goals.md` §2.2), dans l'ordre où le sélecteur
 * les présente.
 *
 * ELLE EST LA MÊME LISTE QUE `goal_blocks_color_check` de la migration `0049`, et cette redite est
 * assumée : l'écran doit bien proposer des choix, et il ne peut pas les lire de la base. Ce n'est
 * PAS un contrôle d'autorisation dédoublé (`CLAUDE.md` §10) — une couleur hors liste, envoyée par
 * une autre voie, est refusée par la contrainte et traduite en `saisie-invalide`, jamais filtrée
 * ici. La liste ne fait que meubler un sélecteur.
 */
export const COULEURS_BLOC = ['brand', 'success', 'accent', 'danger', 'neutral'] as const

export type CouleurBloc = (typeof COULEURS_BLOC)[number]

/** Bornes du remplissage — `goal_blocks_fill_percent_check`, `between 0 and 100`. */
export const REMPLISSAGE_MINIMAL = 0
export const REMPLISSAGE_MAXIMAL = 100

/**
 * Ramène un remplissage à un ENTIER borné.
 *
 * `fill_percent` est un `smallint` : `60.5` serait refusé par la base, et une décimale suggérerait
 * un calcul que `docs/SPEC-goals.md` §1 interdit. Le curseur rend déjà des entiers ; le champ
 * numérique, lui, accepte tout ce qu'on y tape — c'est donc lui que cette fonction protège.
 *
 * Une saisie qui n'est PAS un nombre — champ vidé, texte collé — rend `null` plutôt qu'un zéro :
 * zéro est une valeur, et l'écrire à la place d'une saisie illisible serait la « valeur par défaut
 * trompeuse » que `CLAUDE.md` §18 interdit.
 */
export function bornerRemplissage(valeur: number | string): number | null {
	const nombre = typeof valeur === 'number' ? valeur : Number(valeur.trim())
	if (typeof valeur === 'string' && valeur.trim() === '') return null
	if (!Number.isFinite(nombre)) return null
	return Math.min(REMPLISSAGE_MAXIMAL, Math.max(REMPLISSAGE_MINIMAL, Math.round(nombre)))
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

/**
 * Les trois issues d'une modification de bloc, QUELLE QUE SOIT la colonne touchée. La troisième
 * est celle de la clause `using`.
 *
 * Le type est commun à la géométrie et au contenu parce que la politique l'est : `goal_blocks`
 * porte UNE seule politique de modification, et un titre refusé l'est exactement comme une
 * position refusée. Deux types distincts laisseraient croire à deux contrats.
 */
export type ResultatEcritureBloc =
	| { readonly statut: 'enregistree'; readonly bloc: BlocObjectif }
	| { readonly statut: 'sans-effet' }
	| { readonly statut: 'refus'; readonly refus: RefusBloc }

/** Nom d'origine du type ci-dessus, gardé pour les appelants de la tranche 2a. */
export type ResultatGeometrie = ResultatEcritureBloc

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
): Promise<ResultatEcritureBloc> {
	// Le type est celui de la table et non un `Record` libre : le contrat de `database.types.ts`
	// refuse toute colonne qu'il ne connaît pas, et c'est précisément la garde qui a manqué à
	// INC-165. Les quatre clés restent FACULTATIVES — un déplacement n'envoie pas de taille.
	const modifications: Partial<{
		pos_x: number
		pos_y: number
		width: number
		height: number
	}> = {}
	if (geometrie.x !== undefined) modifications.pos_x = bornerCoordonnee(geometrie.x)
	if (geometrie.y !== undefined) modifications.pos_y = bornerCoordonnee(geometrie.y)
	if (geometrie.largeur !== undefined) {
		modifications.width = bornerDimension(geometrie.largeur, TAILLE_BLOC_MINIMALE.largeur)
	}
	if (geometrie.hauteur !== undefined) {
		modifications.height = bornerDimension(geometrie.hauteur, TAILLE_BLOC_MINIMALE.hauteur)
	}

	return modifierBloc(client, idBloc, modifications)
}

/**
 * Ce qu'une saisie de contenu transporte. Les quatre clés sont FACULTATIVES et pour la même raison
 * qu'à la géométrie : chaque champ s'enregistre POUR LUI-MÊME (`docs/DESIGN_SYSTEM.md` §5.7 ter),
 * et renvoyer les quatre à chaque frappe écraserait ce qu'un collègue vient d'écrire dans un autre
 * champ du même bloc.
 */
export type ContenuBloc = {
	readonly titre?: string
	readonly corps?: string | null
	readonly couleur?: string
	readonly remplissage?: number
}

/**
 * Écrit le contenu d'un bloc — titre, corps, couleur, remplissage.
 *
 * ELLE N'EST PAS FUSIONNÉE AVEC `ecrireGeometrieBloc`, et le motif est le geste, non la table :
 * une saisie de contenu et un glissement de souris n'ont ni la même cadence, ni les mêmes bornes,
 * ni la même unité de valeur. Ce qu'elles partagent — la requête, ses trois issues — est extrait
 * dans `modifierBloc` plutôt que dupliqué.
 *
 * DEUX NORMALISATIONS SEULEMENT, ET AUCUN REFUS ANTICIPÉ (`CLAUDE.md` §10) :
 *
 *   * le titre est débarrassé de ses espaces de bord, comme à la pose — la contrainte
 *     `goal_blocks_titre_check` refuse le vide, et c'est ELLE qui refuse, traduite en
 *     `saisie-invalide` ; l'écran n'invente pas ce refus, il le reçoit ;
 *   * le corps VIDE devient `null` et non `''` : `body` est facultatif (§2.2), et deux
 *     représentations du néant dans la même colonne rendraient « pas de corps » indistinguable
 *     de « un corps vide » à la relecture.
 *
 * La couleur et le remplissage partent TELS QUELS. Une couleur hors énumération et un remplissage
 * hors bornes sont refusés par la base, pas ici.
 *
 * Ne lève jamais.
 */
export async function ecrireContenuBloc(
	client: ClientCrm,
	idBloc: string,
	contenu: ContenuBloc,
): Promise<ResultatEcritureBloc> {
	const modifications: Partial<{
		title: string
		body: string | null
		color: string
		fill_percent: number
	}> = {}
	if (contenu.titre !== undefined) modifications.title = contenu.titre.trim()
	if (contenu.corps !== undefined) {
		const corps = contenu.corps === null ? '' : contenu.corps.trim()
		modifications.body = corps === '' ? null : corps
	}
	if (contenu.couleur !== undefined) modifications.color = contenu.couleur
	if (contenu.remplissage !== undefined) modifications.fill_percent = contenu.remplissage

	return modifierBloc(client, idBloc, modifications)
}

/**
 * Un channel que le sélecteur de destination propose (§3 : « sélecteur des channels LISIBLES par
 * l'appelant, groupés par track »).
 *
 * `track` est FACULTATIF alors que `channels.track_id` est obligatoire : l'imbrication PostgREST
 * peut rendre `null` lorsque la politique de lecture des tracks ne consent pas la ligne parente. Un
 * channel dont le track n'est pas rendu ne disparaît pas du sélecteur pour autant — il n'aurait
 * simplement plus de groupe où se ranger, et c'est `grouperChannelsParTrack` qui décide de son sort.
 */
export type ChannelLiable = {
	readonly id: string
	readonly nom: string
	readonly track: { readonly id: string; readonly nom: string } | null
}

/** Un groupe du sélecteur : un track, et les channels qu'il porte. */
export type GroupeChannels = {
	readonly idTrack: string | null
	readonly nomTrack: string | null
	readonly channels: readonly ChannelLiable[]
}

/**
 * Colonnes du sélecteur, avec le track EMBARQUÉ plutôt que relu.
 *
 * Le nom de la clé étrangère est explicite pour la même raison que dans `COLONNES_BLOC` : une
 * seconde clé de `channels` vers `tracks` rendrait l'imbrication ambiguë, et PostgREST refuserait
 * alors la requête entière plutôt que d'en choisir une.
 *
 * IL EST `channels_track_id_workspace_id_fkey`, ET NON `channels_track_id_fkey` — MESURÉ contre
 * l'API, après qu'un nom déduit du seul nom de colonne eut fait rendre `PGRST200` à la requête
 * entière. La clé est COMPOSITE : `(track_id, workspace_id)` référence `(id, workspace_id)` de
 * `tracks`, ce qui est la garde qui empêche un channel de désigner le track d'un autre espace de
 * travail. Un nom de contrainte ne se devine pas depuis le nom d'une colonne.
 */
export const COLONNES_CHANNEL_LIABLE =
	'id, name, tracks!channels_track_id_workspace_id_fkey(id, name)'

/**
 * Lit les channels que l'appelant peut proposer comme destination.
 *
 * CE N'EST PAS UN CONTRÔLE D'AUTORISATION (`CLAUDE.md` §10). La liste est celle que la RLS de
 * `channels` consent à l'appelant — le module ne filtre aucun droit lui-même —, et elle recouvre la
 * LECTURE, non l'écriture. Or poser un lien exige `app.can_write_channel` (§4.2), condition plus
 * étroite : le sélecteur propose donc des destinations que la base refusera parfois, et ce refus est
 * TRADUIT en `interdit` plutôt qu'anticipé. Réduire la liste aux channels écrivables demanderait à
 * l'écran de rejouer une règle qui vit dans la politique, et la ferait diverger d'elle au premier
 * changement.
 *
 * Les channels archivés et ceux de la corbeille sont écartés — convention de `lireChannels`
 * (`channels.ts`) —, et pour un motif propre à ce sélecteur : une destination en corbeille rendrait
 * immédiatement l'état « lien perdu » du §5.4, si bien que le proposer reviendrait à offrir un lien
 * qui naît cassé.
 *
 * Ne lève jamais.
 */
export async function lireChannelsLiables(
	client: ClientCrm,
	idWorkspace: string,
): Promise<EtatAsync<readonly ChannelLiable[]>> {
	try {
		const reponse = await client
			.from('channels')
			.select(COLONNES_CHANNEL_LIABLE)
			.eq('workspace_id', idWorkspace)
			.is('archived_at', null)
			.is('deleted_at', null)
			.order('position')
			.order('name')
		if (reponse.error !== null) {
			return enErreur(classerErreur(reponse.status, reponse.error.message))
		}
		return pret(
			(reponse.data ?? []).map((brut) => {
				const ligne = brut as unknown as { id: string; name: string; tracks: unknown }
				const track = (Array.isArray(ligne.tracks) ? ligne.tracks[0] : ligne.tracks) as
					| { id: string; name: string }
					| null
					| undefined
				return {
					id: ligne.id,
					nom: ligne.name,
					track: track === null || track === undefined ? null : { id: track.id, nom: track.name },
				}
			}),
		)
	} catch (cause) {
		return enErreur(classerErreur(undefined, cause instanceof Error ? cause.message : String(cause)))
	}
}

/**
 * Groupe les channels par track, dans l'ordre où le sélecteur les présente (§3).
 *
 * L'ORDRE DES CHANNELS EST CELUI QUE LE SERVEUR A RENDU, jamais retrié ici : la requête ordonne
 * déjà par `position` puis par nom, et rejouer ce tri à l'écran le ferait diverger le jour où la
 * requête changera. La fonction ne fait que REGROUPER, en conservant l'ordre de première apparition
 * de chaque track — ce qui rend le sélecteur stable d'un chargement à l'autre.
 *
 * Un channel dont le track n'est pas rendu est rangé dans un groupe SANS NOM, en dernier. Il n'est
 * pas écarté : l'appelant lit ce channel, il a donc le droit de le viser, et le faire disparaître
 * du sélecteur parce que son parent n'est pas lisible lui retirerait une destination légitime sans
 * jamais le dire.
 */
export function grouperChannelsParTrack(
	channels: readonly ChannelLiable[],
): readonly GroupeChannels[] {
	const groupes = new Map<string, { idTrack: string | null; nomTrack: string | null; channels: ChannelLiable[] }>()
	const SANS_TRACK = ''
	for (const channel of channels) {
		const cle = channel.track === null ? SANS_TRACK : channel.track.id
		const groupe = groupes.get(cle)
		if (groupe === undefined) {
			groupes.set(cle, {
				idTrack: channel.track?.id ?? null,
				nomTrack: channel.track?.nom ?? null,
				channels: [channel],
			})
			continue
		}
		groupe.channels.push(channel)
	}
	// Le groupe sans track passe en DERNIER, quel que soit son rang d'apparition : il n'a pas de nom
	// à afficher, et l'ouvrir en tête ferait commencer le sélecteur par une liste anonyme.
	const ordonnes = [...groupes.entries()]
		.sort(([gauche], [droite]) => {
			if (gauche === SANS_TRACK) return 1
			if (droite === SANS_TRACK) return -1
			return 0
		})
		.map(([, groupe]) => groupe)
	return ordonnes.map((groupe) => ({
		idTrack: groupe.idTrack,
		nomTrack: groupe.nomTrack,
		channels: groupe.channels,
	}))
}

/**
 * Charge les channels liables, MAIS SEULEMENT quand `actif` le demande.
 *
 * Le drapeau n'est pas une optimisation prématurée (`CLAUDE.md` §21) : sans lui, l'ouverture d'un
 * tableau émettrait une requête sur TOUS les channels du workspace alors que la plupart des visites
 * ne font que regarder le canevas. La liste ne sert qu'au sélecteur de la fiche d'édition, et elle
 * part donc à la première ouverture d'une fiche.
 *
 * Elle n'est chargée QU'UNE FOIS par visite d'écran, et non à chaque fiche : le champ est le même
 * d'un bloc à l'autre, et relire la liste à chaque ouverture émettrait la même requête indéfiniment.
 * `recharger` existe pour la reprise après erreur, seul cas où relire a un sens.
 */
export function useChannelsLiables(
	client: ClientCrm | null,
	idWorkspace: string | null,
	actif: boolean,
): { readonly etat: EtatAsync<readonly ChannelLiable[]>; readonly recharger: () => void } {
	const [etat, setEtat] = useState<EtatAsync<readonly ChannelLiable[]>>(enChargement)
	const [tentative, setTentative] = useState(0)
	const courant = useRef(0)

	useEffect(() => {
		if (!actif || client === null || idWorkspace === null) return
		const rang = ++courant.current
		setEtat(enChargement)
		void lireChannelsLiables(client, idWorkspace).then((resultat) => {
			if (rang === courant.current) setEtat(resultat)
		})
	}, [client, idWorkspace, actif, tentative])

	const recharger = useCallback(() => setTentative((precedente) => precedente + 1), [])
	return { etat, recharger }
}

/**
 * Lie un bloc à un channel, ou RETIRE le lien lorsque `idChannel` vaut `null` (§3).
 *
 * UNE SEULE FONCTION POUR LES DEUX GESTES, parce que c'est une seule écriture : `channel_id` reçoit
 * un identifiant ou `null`, sur la même ligne et sous la même politique. Deux fonctions ne
 * différeraient que par la valeur envoyée.
 *
 * ELLE N'ANTICIPE AUCUN DROIT, et c'est ici que cela compte le plus (`CLAUDE.md` §10) : poser le
 * lien exige `app.can_write_channel(channel_id)` tandis que le retirer n'exige que l'écriture sur
 * le bloc (§4.2). Cette asymétrie vit dans la clause `with check` de la politique, jamais ici : le
 * module envoie les deux gestes de la même façon et traduit ce qu'il reçoit. Un `viewer` qui retire
 * un lien reçoit donc bien un refus, mais c'est la politique qui le refuse, pas l'écran.
 *
 * Ne lève jamais.
 */
export async function lierBlocAChannel(
	client: ClientCrm,
	idBloc: string,
	idChannel: string | null,
): Promise<ResultatEcritureBloc> {
	return modifierBloc(client, idBloc, { channel_id: idChannel })
}

// =================================================================================================
// TRANCHE 2b-2b — LES FLÈCHES
// =================================================================================================
//
// UNE FLÈCHE N'EST PAS UN CHAMP DE BLOC, et son écriture ne partage donc rien avec `modifierBloc` :
// elle vit dans `goal_links`, sous des politiques qui exigent le droit d'écrire les DEUX blocs
// qu'elle relie (§4.2), et son refus de doublon n'existe nulle part ailleurs dans cet écran.

/** Les trois directions proposées, dans l'ordre où les contrôles les présentent (§2.3). */
export const DIRECTIONS_FLECHE = ['forward', 'backward', 'both'] as const

/**
 * Une seconde flèche entre les mêmes blocs — `goal_links_source_target_key`.
 *
 * ELLE MÉRITE SA PROPRE NATURE, et ce n'est pas un raffinement : le §2.3 dit que « changer la
 * direction d'une flèche existante est une MODIFICATION, pas un ajout ». Le geste à faire après ce
 * refus n'est donc pas de réessayer, mais d'aller corriger la flèche déjà tracée — et un texte de
 * refus générique enverrait l'utilisateur retenter indéfiniment le même geste.
 */
export const CODE_DOUBLON = '23505'

/**
 * Les natures de refus d'une écriture de flèche. Le dictionnaire est FERMÉ, comme celui des blocs,
 * et il compte une nature de plus pour la raison écrite au-dessus.
 */
export type RefusFleche = {
	readonly nature: 'interdit' | 'saisie-invalide' | 'doublon' | 'indisponible'
	readonly detail: string
}

/**
 * Classe un refus de flèche — LE CODE POSTGRESQL D'ABORD, le statut HTTP ensuite, patron de
 * `classerRefusBloc`.
 *
 * `23514` recouvre ici DEUX contraintes que rien ne distingue par leur code : la boucle
 * (`goal_links_boucle_check`) et le trigger de cohérence de tableau, qui lève `check_violation`
 * (§2.4). Les deux sont des refus de forme, et l'écran les dit de la même façon — le détail, lui,
 * reste au diagnostic.
 */
export function classerRefusFleche(
	statutHttp: number | undefined,
	code: string | undefined,
	detail: string,
): RefusFleche {
	if (code === CODE_DOUBLON) return { nature: 'doublon', detail }
	if (code === CODE_SAISIE_INVALIDE) return { nature: 'saisie-invalide', detail }
	if (code === CODE_INTERDIT) return { nature: 'interdit', detail }
	if (statutHttp === 401 || statutHttp === 403) return { nature: 'interdit', detail }
	return { nature: 'indisponible', detail }
}

/** Les deux issues d'un tracé : la flèche créée, ou un refus traduit. */
export type ResultatTraceFleche =
	| { readonly statut: 'tracee'; readonly fleche: FlecheObjectif }
	| { readonly statut: 'refus'; readonly refus: RefusFleche }

/** Les trois issues d'une modification de flèche — la troisième est celle de la clause `using`. */
export type ResultatEcritureFleche =
	| { readonly statut: 'enregistree'; readonly fleche: FlecheObjectif }
	| { readonly statut: 'sans-effet' }
	| { readonly statut: 'refus'; readonly refus: RefusFleche }

/** Ce qu'un geste de tracé transporte : le tableau, les deux blocs, et la direction choisie. */
export type TraceFleche = {
	readonly idTableau: string
	readonly idSource: string
	readonly idCible: string
	readonly direction: DirectionFleche
}

/** Traduit la ligne rendue par PostgREST en flèche d'écran, direction normalisée comprise. */
export function flecheDepuisLigne(brut: unknown): FlecheObjectif {
	const ligne = brut as {
		id: string
		source_block_id: string
		target_block_id: string
		label: string | null
		direction: string
	}
	return {
		id: ligne.id,
		source_block_id: ligne.source_block_id,
		target_block_id: ligne.target_block_id,
		label: ligne.label,
		direction: normaliserDirection(ligne.direction),
	}
}

/**
 * Trace une flèche entre deux blocs.
 *
 * `board_id` EST ENVOYÉ alors qu'il se déduit des blocs, et c'est le §2.4 qui le veut : la colonne
 * existe, elle est `not null`, et un trigger `security definer` refuse une flèche dont un bloc
 * n'appartient pas à ce tableau. Le déduire ici à la place du serveur ferait de l'écran la garde,
 * là où la garde doit rester en base (`CLAUDE.md` §10).
 *
 * LA DIRECTION PART TELLE QUELLE, sans être normalisée en deux : `backward` n'est PAS réécrit en
 * `forward` avec les blocs inversés, sans quoi la flèche « sauterait » au rechargement dans l'autre
 * sens que celui où elle a été tracée (§2.3).
 *
 * AUCUN REFUS N'EST ANTICIPÉ (`CLAUDE.md` §10) : ni la boucle, ni le doublon, ni le droit d'écrire
 * les deux blocs ne sont vérifiés ici. Tous partent, et tous sont TRADUITS.
 *
 * Ne lève jamais.
 */
export async function tracerFleche(client: ClientCrm, trace: TraceFleche): Promise<ResultatTraceFleche> {
	try {
		const reponse = await client
			.from('goal_links')
			.insert({
				board_id: trace.idTableau,
				source_block_id: trace.idSource,
				target_block_id: trace.idCible,
				direction: trace.direction,
			})
			.select(COLONNES_FLECHE)
			.single()
		if (reponse.error !== null) {
			return {
				statut: 'refus',
				refus: classerRefusFleche(reponse.status, reponse.error.code, reponse.error.message),
			}
		}
		return { statut: 'tracee', fleche: flecheDepuisLigne(reponse.data) }
	} catch (cause) {
		return {
			statut: 'refus',
			refus: classerRefusFleche(undefined, undefined, cause instanceof Error ? cause.message : String(cause)),
		}
	}
}

/**
 * Change la direction d'une flèche déjà tracée (§3 : « choix de la direction à la création, et
 * MODIFIABLE ENSUITE »).
 *
 * `.select(...)` accompagne la mise à jour pour la même raison que sur les blocs : sans lui,
 * PostgREST ne rend aucun corps et le refus silencieux de la clause `using` — ici, l'appelant ne
 * peut pas écrire l'un des deux blocs — serait indistinguable d'un succès.
 *
 * Ne lève jamais.
 */
export async function changerDirectionFleche(
	client: ClientCrm,
	idFleche: string,
	direction: DirectionFleche,
): Promise<ResultatEcritureFleche> {
	try {
		const reponse = await client
			.from('goal_links')
			.update({ direction })
			.eq('id', idFleche)
			.select(COLONNES_FLECHE)
		if (reponse.error !== null) {
			return {
				statut: 'refus',
				refus: classerRefusFleche(reponse.status, reponse.error.code, reponse.error.message),
			}
		}
		const lignes = reponse.data ?? []
		if (lignes.length === 0) return { statut: 'sans-effet' }
		return { statut: 'enregistree', fleche: flecheDepuisLigne(lignes[0]) }
	} catch (cause) {
		return {
			statut: 'refus',
			refus: classerRefusFleche(undefined, undefined, cause instanceof Error ? cause.message : String(cause)),
		}
	}
}

// =================================================================================================
// TRANCHE 2b-2c — LES SUPPRESSIONS
// =================================================================================================
//
// UN BLOC SE SUPPRIME RÉELLEMENT, IL NE S'ARCHIVE PAS (§3) : contrairement aux tracks et aux
// channels, il ne porte aucune donnée métier et n'est référencé par rien d'autre que ses flèches.
// C'est le tableau qui s'archive, parce que c'est lui qui contient le travail.
//
// LA CASCADE VIT EN BASE, JAMAIS ICI. `goal_links.source_block_id` et `target_block_id` sont
// `on delete cascade` (§2.3) : supprimer un bloc emporte ses flèches sans qu'aucune requête d'écran
// ne les nomme. Les retirer une à une avant le bloc ferait de l'écran la garde d'une règle qui vit
// dans le schéma, et laisserait un état incohérent si la seconde requête échouait.

/**
 * Les trois issues d'une suppression, et la troisième est ici la plus probable : la clause `using`
 * de la politique rend la ligne invisible à l'écriture, si bien que le serveur répond `200` avec
 * ZÉRO ligne retirée — ni un succès, ni une erreur. C'est la règle que `docs/DESIGN_SYSTEM.md`
 * §5.27 a déjà posée pour le détachement d'un rattachement, et elle se retrouve ici pour la même
 * cause structurelle. Faire disparaître le bloc sur ce silence annoncerait une suppression qui n'a
 * pas eu lieu.
 */
export type ResultatSuppressionBloc =
	| { readonly statut: 'supprime' }
	| { readonly statut: 'sans-effet' }
	| { readonly statut: 'refus'; readonly refus: RefusBloc }

/** Les trois issues d'une suppression de flèche — mêmes natures que son tracé. */
export type ResultatSuppressionFleche =
	| { readonly statut: 'supprimee' }
	| { readonly statut: 'sans-effet' }
	| { readonly statut: 'refus'; readonly refus: RefusFleche }

/**
 * Supprime un bloc, et avec lui les flèches que la base fait tomber en cascade (§2.3, §3).
 *
 * `.select('id')` ACCOMPAGNE LA SUPPRESSION, pour la raison exacte qui le fait accompagner une
 * modification : sans lui, PostgREST ne rend aucun corps, et « la ligne était invisible à
 * l'écriture » serait indistinguable de « la ligne a bien été retirée ».
 *
 * AUCUN DROIT N'EST ANTICIPÉ (`CLAUDE.md` §10) : la requête part, et le refus est traduit.
 *
 * Ne lève jamais.
 */
export async function supprimerBloc(client: ClientCrm, idBloc: string): Promise<ResultatSuppressionBloc> {
	try {
		const reponse = await client.from('goal_blocks').delete().eq('id', idBloc).select('id')
		if (reponse.error !== null) {
			return {
				statut: 'refus',
				refus: classerRefusBloc(reponse.status, reponse.error.code, reponse.error.message),
			}
		}
		return (reponse.data ?? []).length === 0 ? { statut: 'sans-effet' } : { statut: 'supprime' }
	} catch (cause) {
		return {
			statut: 'refus',
			refus: classerRefusBloc(undefined, undefined, cause instanceof Error ? cause.message : String(cause)),
		}
	}
}

/**
 * Supprime une flèche (§3), sans toucher aux deux blocs qu'elle reliait.
 *
 * Son refus emprunte le dictionnaire des flèches et non celui des blocs : la politique de
 * `goal_links` exige le droit d'écrire les DEUX blocs (§4.2), et un refus formulé comme celui d'un
 * bloc ferait chercher le problème du mauvais côté. La nature `doublon` y est sans emploi — une
 * suppression n'insère rien —, mais le dictionnaire reste commun : le partager évite deux
 * traductions du même refus selon le geste qui l'a reçu.
 *
 * Ne lève jamais.
 */
export async function supprimerFleche(client: ClientCrm, idFleche: string): Promise<ResultatSuppressionFleche> {
	try {
		const reponse = await client.from('goal_links').delete().eq('id', idFleche).select('id')
		if (reponse.error !== null) {
			return {
				statut: 'refus',
				refus: classerRefusFleche(reponse.status, reponse.error.code, reponse.error.message),
			}
		}
		return (reponse.data ?? []).length === 0 ? { statut: 'sans-effet' } : { statut: 'supprimee' }
	} catch (cause) {
		return {
			statut: 'refus',
			refus: classerRefusFleche(undefined, undefined, cause instanceof Error ? cause.message : String(cause)),
		}
	}
}

// =================================================================================================
// TRANCHE 2c — LES TABLEAUX
// =================================================================================================
//
// UN TABLEAU S'ARCHIVE, IL NE SE SUPPRIME PAS (§2.1 et §3, dernier paragraphe) — c'est l'inverse
// exact du bloc, et le motif est écrit dans la spécification : « un bloc ne porte aucune donnée
// métier […] Le tableau, lui, s'archive : il contient le travail. » Aucune fonction de suppression
// n'est donc écrite ici, alors même que la politique `goal_boards_suppression_membre_ecrivant`
// l'autoriserait : ce que la base permet et ce que le produit offre sont deux choses distinctes.
//
// SON UNICITÉ DE NOM PORTE AUSSI SUR LES TABLEAUX ARCHIVÉS, et c'est mesuré dans la migration
// `0049` plutôt que supposé : l'index `goal_boards_workspace_name_key` est TOTAL, sans clause
// `where archived_at is null`. Un nom libéré par l'archivage reste donc pris, et le refus de
// doublon doit le dire — l'écart entre cet index et celui des budgets est déjà consigné au registre.

/**
 * Les natures de refus d'une écriture de tableau. Le dictionnaire est FERMÉ, comme ceux des blocs
 * et des flèches, et il compte `doublon` pour la même raison que les flèches : le geste à faire
 * après ce refus — choisir un autre nom — n'est pas celui qu'appelle un refus de droit.
 */
export type RefusTableau = {
	readonly nature: 'interdit' | 'saisie-invalide' | 'doublon' | 'indisponible'
	readonly detail: string
}

/**
 * Classe un refus de tableau — LE CODE POSTGRESQL D'ABORD, le statut HTTP ensuite, patron de
 * `classerRefusBloc` et de `classerRefusFleche`.
 *
 * `23505` ne peut venir que de `goal_boards_workspace_name_key`, seul index unique de la table
 * hors clé primaire ; `23514` ne peut venir que de `goal_boards_name_check`, seule contrainte de
 * valeur. Les deux sont donc traduits sans inspecter le message, que `CLAUDE.md` §18 et le patron
 * de `classerErreur` interdisent de lire pour décider.
 */
export function classerRefusTableau(
	statutHttp: number | undefined,
	code: string | undefined,
	detail: string,
): RefusTableau {
	if (code === CODE_DOUBLON) return { nature: 'doublon', detail }
	if (code === CODE_SAISIE_INVALIDE) return { nature: 'saisie-invalide', detail }
	if (code === CODE_INTERDIT) return { nature: 'interdit', detail }
	if (statutHttp === 401 || statutHttp === 403) return { nature: 'interdit', detail }
	return { nature: 'indisponible', detail }
}

/** Les deux issues d'une création : le tableau créé, ou un refus traduit. */
export type ResultatCreationTableau =
	| { readonly statut: 'cree'; readonly tableau: TableauObjectifs }
	| { readonly statut: 'refus'; readonly refus: RefusTableau }

/** Les trois issues d'une écriture de tableau — la troisième est celle de la clause `using`. */
export type ResultatEcritureTableau =
	| { readonly statut: 'enregistree'; readonly tableau: TableauObjectifs }
	| { readonly statut: 'sans-effet' }
	| { readonly statut: 'refus'; readonly refus: RefusTableau }

/** Ce qu'un geste de création transporte : l'espace de travail, le nom saisi, et la description. */
export type CreationTableau = {
	readonly idWorkspace: string
	readonly nom: string
	readonly description: string
}

/**
 * Crée un tableau d'objectifs (§3, §4.2 : « tout membre du workspace »).
 *
 * `position` EST ENVOYÉE À `null`, comme pour un track et pour le même motif mesuré : le trigger
 * `goal_boards_attribuer_position` reçoit `new.position` à `NULL` que le client l'ait omise ou
 * écrite explicitement — il ne peut pas distinguer les deux cas —, et place alors le tableau en fin
 * de liste. L'assertion de type est nécessaire parce que le générateur de `database.types.ts` NE
 * VOIT PAS LES TRIGGERS : il lit une colonne `not null` sans défaut de colonne et la déclare
 * obligatoire. L'alternative serait de calculer `max + 1` dans le navigateur, c'est-à-dire de
 * recopier le trigger en moins fiable et en y ajoutant une course entre deux utilisateurs.
 *
 * Le nom est débarrassé de ses espaces de bord, comme le titre d'un bloc : la contrainte
 * `goal_boards_name_check` refuse le vide, et c'est ELLE qui refuse — l'écran n'invente pas ce
 * refus, il le reçoit (`CLAUDE.md` §10). La description vide devient `null` et non `''`, pour que
 * « pas de description » ne soit pas indistinguable d'« une description vide » à la relecture.
 *
 * Ne lève jamais.
 */
export async function creerTableau(
	client: ClientCrm,
	creation: CreationTableau,
): Promise<ResultatCreationTableau> {
	try {
		const description = creation.description.trim()
		const reponse = await client
			.from('goal_boards')
			.insert({
				workspace_id: creation.idWorkspace,
				name: creation.nom.trim(),
				description: description === '' ? null : description,
				position: null,
			} as unknown as Database['public']['Tables']['goal_boards']['Insert'])
			.select(COLONNES_TABLEAU)
			.single()
		if (reponse.error !== null) {
			return {
				statut: 'refus',
				refus: classerRefusTableau(reponse.status, reponse.error.code, reponse.error.message),
			}
		}
		return { statut: 'cree', tableau: reponse.data }
	} catch (cause) {
		return {
			statut: 'refus',
			refus: classerRefusTableau(undefined, undefined, cause instanceof Error ? cause.message : String(cause)),
		}
	}
}

/**
 * Ce qu'un renommage transporte. Les deux clés sont FACULTATIVES, pour la raison qui vaut déjà au
 * contenu d'un bloc : renvoyer les deux à chaque geste écraserait ce qu'un collègue vient d'écrire
 * dans l'autre champ du même tableau.
 */
export type ModificationTableau = {
	readonly nom?: string
	readonly description?: string | null
}

/**
 * Renomme un tableau, et modifie sa description (§3).
 *
 * Ne lève jamais.
 */
export async function renommerTableau(
	client: ClientCrm,
	idTableau: string,
	modification: ModificationTableau,
): Promise<ResultatEcritureTableau> {
	const modifications: Partial<{ name: string; description: string | null }> = {}
	if (modification.nom !== undefined) modifications.name = modification.nom.trim()
	if (modification.description !== undefined) {
		const description = modification.description === null ? '' : modification.description.trim()
		modifications.description = description === '' ? null : description
	}
	return modifierTableau(client, idTableau, modifications)
}

/**
 * Écrit la position calculée par `calculerDeplacement` (§2.1 : `position` ordonne la liste).
 *
 * UNE SEULE ÉCRITURE, JAMAIS UNE PERMUTATION, et l'arithmétique est celle que
 * `administration-arborescence.ts` porte déjà pour les tracks et les channels : le milieu de deux
 * voisines n'écrit qu'une ligne, là où une permutation coûterait deux `update` non atomiques dont
 * le second peut échouer, laissant la liste dans un état que personne n'a voulu. C'est l'usage pour
 * lequel `position` est un `numeric` et non un entier, ici comme là-bas.
 *
 * Le calcul n'est PAS recopié : `calculerDeplacement` est réemployée telle quelle. La dupliquer
 * pour deux tables qui portent la même colonne la ferait diverger au premier ajustement.
 *
 * Ne lève jamais.
 */
export async function deplacerTableau(
	client: ClientCrm,
	idTableau: string,
	position: number,
): Promise<ResultatEcritureTableau> {
	return modifierTableau(client, idTableau, { position })
}

/**
 * Archive un tableau — l'archivage TIENT LIEU de suppression (§2.1).
 *
 * L'horodatage est celui du CLIENT, faute d'un défaut de colonne ou d'une RPC qui le prendrait du
 * serveur. C'est une approximation, et elle est nommée, exactement comme pour `archiverTrack` :
 * `archived_at` sert à masquer, jamais à ordonner ni à mesurer une durée — aucune règle du produit
 * ne dépend de sa valeur exacte, seule sa nullité compte.
 *
 * ~~LE DÉSARCHIVAGE N'EST PAS OFFERT, ET C'EST UNE LIMITE NOMMÉE plutôt qu'un oubli : le §5.1 ne
 * décrit qu'une liste des tableaux NON archivés, et le §3 ne nomme que « archiver ». Ajouter ici un
 * paramètre qui rendrait la colonne à `null` poserait une capacité qu'aucun écran n'atteint — du
 * code mort dès sa première ligne.~~ **RÉVISÉ le 2026-08-28, tranche 2 h** : l'écran existe
 * désormais, et le motif tombe avec sa prémisse. Voir `desarchiverTableau` ci-dessous. La
 * confirmation de l'écran dit toujours que le tableau quitte la liste — mais elle n'a plus à
 * laisser croire que c'est sans retour.
 *
 * Ne lève jamais.
 */
export async function archiverTableau(
	client: ClientCrm,
	idTableau: string,
	maintenant: () => string = () => new Date().toISOString(),
): Promise<ResultatEcritureTableau> {
	return modifierTableau(client, idTableau, { archived_at: maintenant() })
}

/**
 * Reprend un tableau archivé — l'inverse exact d'`archiverTableau`.
 *
 * @spec CRM-083 (docs/BACKLOG.md) — tranche 2 h, la reprise d'un tableau archivé
 * @spec docs/SPEC-goals.md §5.6.1 mesures 4, 5 et 6 ; §5.6.2 lignes f, g et h
 *
 * UN TABLEAU S'ARCHIVE AU LIEU DE SE SUPPRIMER (§2.1) : sans ce geste, l'archivage était SANS
 * RETOUR, c'est-à-dire une perte silencieuse au sens de `CLAUDE.md` §18, sur une donnée que la base
 * n'a jamais cessé de porter.
 *
 * AUCUN CAS `doublon` N'EST POSSIBLE ICI, ET C'EST MESURÉ DES DEUX CÔTÉS (§5.6.1, mesures 2 et 6) :
 * `goal_boards_workspace_name_key` est un index TOTAL, sans clause `where archived_at is null`.
 * L'archivage n'a donc jamais libéré le nom — reprendre celui d'un tableau archivé rend
 * `409 / 23505` —, et le rendre ne peut rien heurter. Le dictionnaire fermé des refus n'a pas à
 * gagner de cas sur ce geste, et une assertion le FIGE plutôt que ce commentaire ne l'affirme.
 *
 * LE REFUS DE LA LECTRICE N'EST PAS UN `403`, et le contrat le dit parce que la mesure l'a établi
 * (mesure 4) : `goal_boards_maj_membre_ecrivant` refuse par sa clause `using`, donc PostgREST rend
 * `200` et zéro ligne. C'est l'issue `sans-effet` que `modifierTableau` distingue déjà, et que
 * l'écran traduit en `interdit` — jamais en recopiant un corps de serveur.
 *
 * LA POSITION EST CONSERVÉE (mesure 5) : le tableau revient là où il était, et rien n'est à
 * recalculer. `position` n'est pas rendue à zéro ni repoussée en fin de liste.
 *
 * Ne lève jamais.
 */
export async function desarchiverTableau(
	client: ClientCrm,
	idTableau: string,
): Promise<ResultatEcritureTableau> {
	return modifierTableau(client, idTableau, { archived_at: null })
}

/**
 * La requête de modification d'un tableau et ses TROIS issues, partagées par le renommage, le
 * déplacement et l'archivage.
 *
 * `.select(...)` accompagne la mise à jour pour la raison qui la fait accompagner celle d'un bloc :
 * sans lui, PostgREST ne rend aucun corps et le refus silencieux de la clause `using` — ici, un
 * `viewer` — serait indistinguable d'un succès.
 *
 * Ne lève jamais.
 */
async function modifierTableau(
	client: ClientCrm,
	idTableau: string,
	modifications: Partial<{
		name: string
		description: string | null
		position: number
		archived_at: string | null
	}>,
): Promise<ResultatEcritureTableau> {
	try {
		const reponse = await client
			.from('goal_boards')
			.update(modifications)
			.eq('id', idTableau)
			.select(COLONNES_TABLEAU)
		if (reponse.error !== null) {
			return {
				statut: 'refus',
				refus: classerRefusTableau(reponse.status, reponse.error.code, reponse.error.message),
			}
		}
		const lignes = reponse.data ?? []
		if (lignes.length === 0) return { statut: 'sans-effet' }
		return { statut: 'enregistree', tableau: lignes[0] as TableauObjectifs }
	} catch (cause) {
		return {
			statut: 'refus',
			refus: classerRefusTableau(undefined, undefined, cause instanceof Error ? cause.message : String(cause)),
		}
	}
}

/**
 * La requête de modification et ses TROIS issues, partagées par la géométrie et le contenu.
 *
 * `.select(...)` accompagne la mise à jour précisément pour que « zéro ligne touchée » existe comme
 * réponse : sans lui, PostgREST ne rend aucun corps et le refus silencieux de la clause `using`
 * serait indistinguable d'un succès (patron de `detacherContact`).
 *
 * Le type des modifications est celui de la table et non un `Record` libre : le contrat de
 * `database.types.ts` refuse toute colonne qu'il ne connaît pas, et c'est précisément la garde qui
 * a manqué à INC-165.
 *
 * Ne lève jamais.
 */
async function modifierBloc(
	client: ClientCrm,
	idBloc: string,
	modifications: Partial<{
		pos_x: number
		pos_y: number
		width: number
		height: number
		title: string
		body: string | null
		color: string
		fill_percent: number
		channel_id: string | null
	}>,
): Promise<ResultatEcritureBloc> {
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
