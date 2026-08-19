// @spec CRM-083 (docs/BACKLOG.md) — canevas d'objectifs, tranche 2a : la GÉOMÉTRIE, c'est-à-dire
//       poser un bloc, le déplacer et le redimensionner, à la souris comme au clavier ;
//       tranche 2b-1 : le CONTENU, c'est-à-dire saisir le titre, le corps, la couleur, et régler
//       le remplissage au curseur comme au champ numérique ;
//       tranche 2b-2a : LE LIEN, c'est-à-dire désigner le channel qu'un bloc vise, et retirer ce
//       lien
// @spec docs/SPEC-goals.md §3 (poser un bloc — position issue du geste, jamais d'un placement
//       automatique ; déplacer et redimensionner — persiste `pos_x`, `pos_y`, `width`, `height` ;
//       saisir le titre, le corps, la couleur ; régler le remplissage — curseur ET champ
//       numérique, les deux écrivant la même valeur ; lier le bloc à un channel — sélecteur des
//       channels LISIBLES par l'appelant, groupés par track ; retirer le lien — remet `channel_id`
//       à nul)
// @spec docs/SPEC-goals.md §4.2 (écriture ouverte à tout membre pouvant écrire ; un `viewer`
//       n'écrit rien ; POSER le lien exige `app.can_write_channel`, le RETIRER non),
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

import { classerErreur, enErreur, pret, type EtatAsync } from './async'
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
 */
export const COLONNES_CHANNEL_LIABLE = 'id, name, tracks!channels_track_id_fkey(id, name)'

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
