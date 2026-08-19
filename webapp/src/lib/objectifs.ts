// @spec CRM-083 (docs/BACKLOG.md) — canevas d'objectifs, tranche 1 : lecture et composition
// @spec docs/SPEC-goals.md §5.1 (liste des tableaux), §5.2 (canevas), §5.3 (flèches),
//       §5.4 (états), §5.5 (accessibilité : liste textuelle équivalente)
// @spec docs/SPEC-goals.md §4.1 (un bloc lié à un channel fermé est INVISIBLE, ses flèches restent)
// @spec docs/SPEC-goals.md §1 (aucun calcul : `fill_percent` est lu, jamais dérivé)
// @spec docs/DESIGN_SYSTEM.md §5.29 (bloc, jauge, flèche)
// @spec docs/SPEC-webapp.md §6.4 (contrat asynchrone)
//
// CE MODULE NE CALCULE AUCUN AVANCEMENT, et c'est la première règle de `docs/SPEC-goals.md` §1.
// Il lit ce que le backend consent, et compose une GÉOMÉTRIE : où passe un trait entre deux
// rectangles, quelles flèches n'ont plus de bloc à joindre. Rien d'autre n'est dérivé.
//
// LE BLOC MASQUÉ PAR LA RLS N'ARRIVE JAMAIS ICI. La politique de lecture de `goal_blocks` filtre
// à la source : l'appelant reçoit cinq blocs sur six, sans savoir qu'un sixième existe. Les
// flèches, elles, ne dépendent que du tableau — l'appelant en reçoit QUATRE, dont une dont
// l'origine ne lui est pas rendue. C'est cette asymétrie, voulue par le §4.1, qui produit l'état
// « pointillés vers le vide » du §5.4, et c'est `composerDiagramme` qui la matérialise.

import { useCallback, useEffect, useRef, useState } from 'react'
import { classerErreur, enChargement, enErreur, pret, type EtatAsync } from './async'
import type { Database } from './database.types'
import type { ClientCrm } from './supabase'

/** Ce que la liste des tableaux a besoin de savoir, et rien de plus (§5.1). */
export type TableauObjectifs = Pick<
	Database['public']['Tables']['goal_boards']['Row'],
	'id' | 'name' | 'description' | 'position'
>

/** Un tableau tel que la liste le rend : ses attributs, et le nombre de blocs LISIBLES (§5.1). */
export type TableauListe = TableauObjectifs & { readonly blocsLisibles: number }

/**
 * La destination d'un bloc lié, telle que la pilule l'affiche : « Track › Channel » (§5.2).
 *
 * Les deux horodatages sont demandés parce que l'écran doit distinguer une destination VIVANTE
 * d'une destination partie à la corbeille : `app.can_read_channel` ne regarde pas `deleted_at`
 * (migration `0010`), si bien qu'un channel en corbeille reste lisible et son bloc reste rendu.
 * L'écran ne peut donc pas se contenter de la présence d'un lien pour proposer d'y naviguer.
 */
export type DestinationBloc = {
	readonly id: string
	readonly nom: string
	readonly slug: string
	readonly supprime: boolean
	readonly track: { readonly nom: string; readonly slug: string; readonly supprime: boolean } | null
}

/** Un bloc tel que le canevas le rend. */
export type BlocObjectif = Pick<
	Database['public']['Tables']['goal_blocks']['Row'],
	'id' | 'title' | 'body' | 'fill_percent' | 'channel_id' | 'pos_x' | 'pos_y' | 'width' | 'height' | 'color'
> & { readonly destination: DestinationBloc | null }

/** Les trois directions du §2.3, jamais normalisées en deux. */
export type DirectionFleche = 'forward' | 'backward' | 'both'

/** Une flèche telle que le canevas la rend. */
export type FlecheObjectif = Pick<
	Database['public']['Tables']['goal_links']['Row'],
	'id' | 'source_block_id' | 'target_block_id' | 'label'
> & { readonly direction: DirectionFleche }

/** Ce qu'une ouverture de tableau charge : ses blocs et ses flèches, tels que consentis. */
export type ContenuTableau = {
	readonly tableau: TableauObjectifs | null
	readonly blocs: readonly BlocObjectif[]
	readonly fleches: readonly FlecheObjectif[]
}

export const COLONNES_TABLEAU = 'id, name, description, position'

/**
 * Colonnes du bloc, avec la destination EMBARQUÉE plutôt que relue.
 *
 * L'imbrication est nommée explicitement (`channels!goal_blocks_channel_id_fkey`) : `goal_blocks`
 * ne porte qu'une seule clé étrangère vers `channels` aujourd'hui, mais une seconde la rendrait
 * ambiguë et PostgREST refuserait alors la requête entière plutôt que d'en choisir une.
 */
export const COLONNES_BLOC =
	'id, title, body, fill_percent, channel_id, pos_x, pos_y, width, height, color, ' +
	'channels!goal_blocks_channel_id_fkey(id, name, slug, deleted_at, tracks(name, slug, deleted_at))'

export const COLONNES_FLECHE = 'id, source_block_id, target_block_id, direction, label'

/** Les trois directions admises. Une valeur inconnue est ramenée à `forward` plutôt que jetée. */
const DIRECTIONS: readonly DirectionFleche[] = ['forward', 'backward', 'both']

export function normaliserDirection(valeur: string): DirectionFleche {
	return DIRECTIONS.includes(valeur as DirectionFleche) ? (valeur as DirectionFleche) : 'forward'
}

type ChannelEmbarque = {
	id: string
	name: string
	slug: string
	deleted_at: string | null
	tracks: { name: string; slug: string; deleted_at: string | null } | null
}

/**
 * Traduit l'imbrication PostgREST en destination d'écran.
 *
 * `supabase-js` rend l'imbrication tantôt comme objet, tantôt comme tableau d'un élément selon la
 * façon dont la relation est détectée ; les deux formes sont acceptées ici plutôt que supposées.
 */
export function destinationDepuisEmbarque(brut: unknown): DestinationBloc | null {
	const channel = (Array.isArray(brut) ? brut[0] : brut) as ChannelEmbarque | null | undefined
	if (channel === null || channel === undefined) return null
	const trackBrut = (Array.isArray(channel.tracks) ? channel.tracks[0] : channel.tracks) ?? null
	return {
		id: channel.id,
		nom: channel.name,
		slug: channel.slug,
		supprime: channel.deleted_at !== null,
		track:
			trackBrut === null
				? null
				: { nom: trackBrut.name, slug: trackBrut.slug, supprime: trackBrut.deleted_at !== null },
	}
}

/**
 * Un lien est OUVRABLE lorsque sa destination est encore atteignable par la navigation : le
 * channel et son track sont connus et hors corbeille. Sinon l'écran rend « lien perdu » (§5.4) au
 * lieu d'une pilule qui mènerait à une adresse morte.
 */
export function lienOuvrable(bloc: BlocObjectif): boolean {
	const destination = bloc.destination
	if (destination === null) return false
	if (destination.supprime) return false
	return destination.track !== null && !destination.track.supprime
}

/**
 * Un bloc porte la mention « lien perdu » quand il DÉSIGNE un channel dont la destination n'est
 * plus atteignable. Un bloc sans `channel_id` n'est pas concerné : il n'a jamais été lié.
 *
 * LIMITE NOMMÉE, consignée au registre plutôt que compensée ici : une destination détruite pour
 * de bon remet `channel_id` à nul (`on delete set null`, §2.2), état que rien ne distingue d'un
 * bloc jamais lié. La mention ne se lève donc que pour une destination partie à la corbeille.
 */
export function lienPerdu(bloc: BlocObjectif): boolean {
	return bloc.channel_id !== null && !lienOuvrable(bloc)
}

/** Lit les tableaux non archivés du workspace, dans l'ordre d'affichage du §2.1. */
export async function lireTableaux(
	client: ClientCrm,
	idWorkspace: string,
): Promise<EtatAsync<readonly TableauListe[]>> {
	try {
		const reponse = await client
			.from('goal_boards')
			.select(COLONNES_TABLEAU)
			.eq('workspace_id', idWorkspace)
			.is('archived_at', null)
			.order('position')
			.order('name')
		if (reponse.error !== null) {
			return enErreur(classerErreur(reponse.status, reponse.error.message))
		}
		const tableaux = reponse.data ?? []
		if (tableaux.length === 0) return pret([])

		// Le nombre de blocs est celui que le BACKEND consent à l'appelant (§5.1). Il se compte
		// donc sur les lignes réellement rendues, jamais sur un total stocké : deux personnes du
		// même workspace n'ont pas le même compte, et c'est la conséquence assumée du §4.1.
		const blocs = await client
			.from('goal_blocks')
			.select('id, board_id')
			.in('board_id', tableaux.map((tableau) => tableau.id))
		if (blocs.error !== null) {
			return enErreur(classerErreur(blocs.status, blocs.error.message))
		}
		const comptes = new Map<string, number>()
		for (const bloc of blocs.data ?? []) {
			comptes.set(bloc.board_id, (comptes.get(bloc.board_id) ?? 0) + 1)
		}
		return pret(
			tableaux.map((tableau) => ({ ...tableau, blocsLisibles: comptes.get(tableau.id) ?? 0 })),
		)
	} catch (cause) {
		return enErreur(classerErreur(undefined, cause instanceof Error ? cause.message : String(cause)))
	}
}

/**
 * Lit un tableau et son contenu.
 *
 * `tableau: null` n'est PAS une erreur : c'est la réponse du backend à un identifiant inconnu ou
 * fermé à l'appelant, et les deux se ressemblent délibérément
 * (`docs/SPEC-permissions-rls.md` §7).
 */
export async function lireContenuTableau(
	client: ClientCrm,
	idTableau: string,
): Promise<EtatAsync<ContenuTableau>> {
	try {
		const tableau = await client
			.from('goal_boards')
			.select(COLONNES_TABLEAU)
			.eq('id', idTableau)
			.is('archived_at', null)
			.maybeSingle()
		if (tableau.error !== null) {
			return enErreur(classerErreur(tableau.status, tableau.error.message))
		}
		if (tableau.data === null) return pret({ tableau: null, blocs: [], fleches: [] })

		const [blocs, fleches] = await Promise.all([
			client.from('goal_blocks').select(COLONNES_BLOC).eq('board_id', idTableau).order('pos_y').order('pos_x'),
			client.from('goal_links').select(COLONNES_FLECHE).eq('board_id', idTableau).order('created_at'),
		])
		if (blocs.error !== null) return enErreur(classerErreur(blocs.status, blocs.error.message))
		if (fleches.error !== null) return enErreur(classerErreur(fleches.status, fleches.error.message))

		return pret({
			tableau: tableau.data,
			// L'imbrication est RETIRÉE de la ligne et traduite en destination : le reste du
			// produit ne doit jamais avoir à connaître la forme que PostgREST donne à un embed.
			blocs: (blocs.data ?? []).map((brut) => {
				const ligne = brut as unknown as Record<string, unknown>
				const { channels, ...reste } = ligne
				return {
					...(reste as Omit<BlocObjectif, 'destination'>),
					destination: destinationDepuisEmbarque(channels),
				}
			}),
			fleches: (fleches.data ?? []).map((brut) => ({
				id: brut.id,
				source_block_id: brut.source_block_id,
				target_block_id: brut.target_block_id,
				label: brut.label,
				direction: normaliserDirection(brut.direction),
			})),
		})
	} catch (cause) {
		return enErreur(classerErreur(undefined, cause instanceof Error ? cause.message : String(cause)))
	}
}

/** Un point du canevas, en unités de canevas et non en pixels d'écran. */
export type Point = { readonly x: number; readonly y: number }

/**
 * Une flèche prête à être tracée.
 *
 * `orpheline` porte l'état du §5.4 : l'un des deux blocs n'est pas rendu à cet appelant. Le trait
 * est alors pointillé, SANS libellé et SANS infobulle — l'écran ne nomme jamais ce qu'il cache.
 */
export type FlecheTracee = {
	readonly id: string
	readonly depart: Point
	readonly arrivee: Point
	readonly milieu: Point
	readonly direction: DirectionFleche
	readonly libelle: string | null
	readonly orpheline: boolean
}

/** Longueur du moignon tracé vers le vide quand le bloc opposé n'est pas rendu (§5.4). */
export const LONGUEUR_MOIGNON = 96

/** Centre géométrique d'un bloc. */
export function centreBloc(bloc: BlocObjectif): Point {
	return { x: bloc.pos_x + bloc.width / 2, y: bloc.pos_y + bloc.height / 2 }
}

/**
 * Point où le segment joignant deux centres coupe le BORD du bloc (§5.3 : « tracées entre les
 * bords des blocs »).
 *
 * La résolution est analytique et non itérative : on cherche le facteur `t` le plus grand tel que
 * le point reste dans le rectangle, ce qui revient à prendre le minimum des deux rapports
 * `demi-largeur / |dx|` et `demi-hauteur / |dy|`. Deux blocs exactement superposés rendent le
 * centre lui-même plutôt qu'une division par zéro.
 */
export function pointDeBord(bloc: BlocObjectif, vers: Point): Point {
	const centre = centreBloc(bloc)
	const dx = vers.x - centre.x
	const dy = vers.y - centre.y
	if (dx === 0 && dy === 0) return centre
	const demiLargeur = bloc.width / 2
	const demiHauteur = bloc.height / 2
	const facteurX = dx === 0 ? Number.POSITIVE_INFINITY : demiLargeur / Math.abs(dx)
	const facteurY = dy === 0 ? Number.POSITIVE_INFINITY : demiHauteur / Math.abs(dy)
	const facteur = Math.min(facteurX, facteurY)
	return { x: centre.x + dx * facteur, y: centre.y + dy * facteur }
}

/**
 * Compose le diagramme rendu : les flèches tracées, dans l'ordre de lecture.
 *
 * TROIS CAS, ET LE TROISIÈME EST CELUI QUE LA RLS PRODUIT :
 *
 *   * les deux blocs sont rendus — trait plein entre les deux bords, libellé au milieu ;
 *   * un seul l'est — moignon pointillé partant de son bord vers l'extérieur, sans libellé ;
 *   * aucun ne l'est — la flèche n'est PAS tracée : un trait flottant sans origine ni
 *     destination ne dit rien au lecteur et ne fait que révéler qu'il manque quelque chose.
 */
export function composerDiagramme(
	blocs: readonly BlocObjectif[],
	fleches: readonly FlecheObjectif[],
): readonly FlecheTracee[] {
	const parIdentifiant = new Map(blocs.map((bloc) => [bloc.id, bloc]))
	const tracees: FlecheTracee[] = []

	for (const fleche of fleches) {
		const source = parIdentifiant.get(fleche.source_block_id) ?? null
		const cible = parIdentifiant.get(fleche.target_block_id) ?? null
		if (source === null && cible === null) continue

		let depart: Point
		let arrivee: Point
		if (source !== null && cible !== null) {
			depart = pointDeBord(source, centreBloc(cible))
			arrivee = pointDeBord(cible, centreBloc(source))
		} else if (source !== null) {
			// Le moignon part vers la DROITE du bloc rendu : une direction constante rend le
			// dessin stable d'un chargement à l'autre, là où une direction tirée du bloc absent
			// renseignerait sur sa position — donc sur son existence.
			const centre = centreBloc(source)
			depart = pointDeBord(source, { x: centre.x + LONGUEUR_MOIGNON, y: centre.y })
			arrivee = { x: depart.x + LONGUEUR_MOIGNON, y: depart.y }
		} else {
			const centre = centreBloc(cible as BlocObjectif)
			arrivee = pointDeBord(cible as BlocObjectif, { x: centre.x - LONGUEUR_MOIGNON, y: centre.y })
			depart = { x: arrivee.x - LONGUEUR_MOIGNON, y: arrivee.y }
		}

		const orpheline = source === null || cible === null
		tracees.push({
			id: fleche.id,
			depart,
			arrivee,
			milieu: { x: (depart.x + arrivee.x) / 2, y: (depart.y + arrivee.y) / 2 },
			direction: fleche.direction,
			libelle: orpheline ? null : fleche.label,
			orpheline,
		})
	}

	return tracees
}

/** Une ligne de la liste textuelle équivalente du diagramme (§5.5). */
export type LigneDiagramme = {
	readonly id: string
	readonly source: string
	readonly cible: string
	readonly symbole: '→' | '←' | '↔'
	readonly libelle: string | null
}

const SYMBOLES: Record<DirectionFleche, LigneDiagramme['symbole']> = {
	forward: '→',
	backward: '←',
	both: '↔',
}

/**
 * Liste textuelle ÉQUIVALENTE du diagramme, pour les lecteurs d'écran (§5.5) : « A → B »,
 * « B ↔ C ». Un diagramme qui n'existe que visuellement n'est pas accessible.
 *
 * Un bloc non rendu n'est jamais NOMMÉ : la ligne existe — la flèche est bien là pour cet
 * appelant — mais son extrémité manquante est laissée en `''`, à charge de l'écran d'employer sa
 * propre formulation neutre. Écrire ici « bloc masqué » ferait dire au texte ce que le dessin
 * s'interdit de dire.
 */
export function listeTextuelleDiagramme(
	blocs: readonly BlocObjectif[],
	fleches: readonly FlecheObjectif[],
): readonly LigneDiagramme[] {
	const titres = new Map(blocs.map((bloc) => [bloc.id, bloc.title]))
	const lignes: LigneDiagramme[] = []
	for (const fleche of fleches) {
		const source = titres.get(fleche.source_block_id) ?? ''
		const cible = titres.get(fleche.target_block_id) ?? ''
		if (source === '' && cible === '') continue
		lignes.push({
			id: fleche.id,
			source,
			cible,
			symbole: SYMBOLES[fleche.direction],
			libelle: fleche.label,
		})
	}
	return lignes
}

/**
 * Étendue du canevas, en unités de canevas : de quoi contenir tous les blocs et les moignons,
 * avec une marge. Une étendue calculée sur les seuls blocs couperait les flèches vers le vide.
 */
export function etendueCanevas(blocs: readonly BlocObjectif[]): {
	readonly largeur: number
	readonly hauteur: number
} {
	const MARGE = LONGUEUR_MOIGNON * 2
	let largeur = 0
	let hauteur = 0
	for (const bloc of blocs) {
		largeur = Math.max(largeur, bloc.pos_x + bloc.width)
		hauteur = Math.max(hauteur, bloc.pos_y + bloc.height)
	}
	return { largeur: largeur + MARGE, hauteur: hauteur + MARGE }
}

/**
 * Ordre de TABULATION des blocs (§5.5 : « tabulation entre les blocs dans l'ordre de leur
 * position »). Lecture occidentale : de haut en bas, puis de gauche à droite. L'identifiant
 * départage deux blocs exactement superposés, pour que l'ordre ne dépende pas de celui du
 * serveur.
 */
export function ordreTabulation(blocs: readonly BlocObjectif[]): readonly BlocObjectif[] {
	return [...blocs].sort((gauche, droite) => {
		if (gauche.pos_y !== droite.pos_y) return gauche.pos_y - droite.pos_y
		if (gauche.pos_x !== droite.pos_x) return gauche.pos_x - droite.pos_x
		return gauche.id.localeCompare(droite.id)
	})
}

/** Charge les tableaux du workspace et expose un rechargement réel (docs/SPEC-webapp.md §7). */
export function useTableaux(
	client: ClientCrm | null,
	idWorkspace: string | null,
): { readonly etat: EtatAsync<readonly TableauListe[]>; readonly recharger: () => void } {
	const [etat, setEtat] = useState<EtatAsync<readonly TableauListe[]>>(enChargement)
	const [tentative, setTentative] = useState(0)
	const courant = useRef(0)

	useEffect(() => {
		if (client === null || idWorkspace === null) return
		const rang = ++courant.current
		setEtat(enChargement)
		void lireTableaux(client, idWorkspace).then((resultat) => {
			if (rang === courant.current) setEtat(resultat)
		})
	}, [client, idWorkspace, tentative])

	const recharger = useCallback(() => setTentative((precedente) => precedente + 1), [])
	return { etat, recharger }
}

/** Charge le contenu d'un tableau et expose un rechargement réel. */
export function useContenuTableau(
	client: ClientCrm | null,
	idTableau: string | null,
): { readonly etat: EtatAsync<ContenuTableau>; readonly recharger: () => void } {
	const [etat, setEtat] = useState<EtatAsync<ContenuTableau>>(enChargement)
	const [tentative, setTentative] = useState(0)
	const courant = useRef(0)

	useEffect(() => {
		if (client === null || idTableau === null) return
		const rang = ++courant.current
		setEtat(enChargement)
		void lireContenuTableau(client, idTableau).then((resultat) => {
			if (rang === courant.current) setEtat(resultat)
		})
	}, [client, idTableau, tentative])

	const recharger = useCallback(() => setTentative((precedente) => precedente + 1), [])
	return { etat, recharger }
}
