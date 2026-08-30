// @spec CRM-066 (docs/BACKLOG.md) — analytique de conversion et prévisionnel pondéré,
//       TRANCHE 3 b : le sélecteur de portée de l'écran `/pilotage`
// @spec docs/SPEC-analytique.md §8 bis.1 (les quatre mesures), §8 bis.2 (l'adresse porte DEUX clés,
//       et M8 l'impose), §8 bis.3 (changer de portée ne relit rien), §8 bis.4 (ce que la seconde
//       lecture lit, et l'unique limite qu'elle porte), §5.2 (aucun paramètre de portée au serveur),
//       §5.3 (l'entonnoir est calculé APRÈS la RLS)
// @spec docs/DESIGN_SYSTEM.md §5.48 bis (le sélecteur), §5.22 (la liste distante et sa dérogation)
// @spec docs/SPEC-webapp.md §17.2 (une adresse tapée à la main n'est pas une panne), §6.4 (contrat
//       asynchrone)
//
// CE MODULE NE FILTRE AUCUN DROIT (`CLAUDE.md` §10). La liste des portées est celle que la RLS de
// `channels` consent à l'appelant, et l'entonnoir est de toute façon calculé APRÈS la RLS (§5.3) :
// forcer une portée dans l'adresse ne rend rien de plus que ce que la base a déjà consenti. Ce que
// ce module fait est NOMMER les portées — la seconde lecture que la tranche 3 a ne faisait pas.
//
// LA PORTÉE N'EST PAS UN PARAMÈTRE DU SERVEUR (§5.2). La fonction rend le grain le plus fin, et les
// trois portées s'en déduisent par sommation : `restreindre` (`analytique.ts`, tranche 2 b) applique
// la restriction sur des lignes DÉJÀ lues. Un appel par portée aurait fait de ce sélecteur un filtre
// serveur, c'est-à-dire une seconde définition de la restriction — le mode de défaillance
// qu'INC-138, INC-241 et la décision 560 ont déjà coûté au dépôt.

import type { Portee } from './analytique'
import { classerErreur, enErreur, pret, type EtatAsync } from './async'
import type { ClientCrm } from './supabase'

/** Un channel offrable comme portée : ce qu'il faut pour l'écrire dans l'adresse et pour le nommer. */
export type ChannelPortee = {
	readonly id: string
	readonly slug: string
	readonly nom: string
}

/** Un track et ses channels lisibles, dans l'ordre où le sélecteur les présente. */
export type TrackPortee = {
	readonly id: string
	readonly slug: string
	readonly nom: string
	/**
	 * `tracks.position` — l'ordre PROPRE du track, et non celui de son premier channel.
	 *
	 * MESURÉ le 2026-08-30 en exécutant `S9` : `channels.position` est numérotée **par track** —
	 * 1, 2, 3 dans chacun —, si bien qu'un tri global des channels par `position` puis `name` les
	 * ENTRELACE, et que grouper ensuite rendait l'ordre `Legacy 2023, Formation, Conseil & IA,
	 * Studio web`. Aucun autre écran du produit ne range les tracks ainsi.
	 */
	readonly position: number
	readonly channels: readonly ChannelPortee[]
}

/**
 * La portée telle que l'ADRESSE la porte — en slugs, jamais en identifiants techniques.
 *
 * DEUX CLÉS, ET C'EST LA MESURE M8 QUI L'IMPOSE (§8 bis.2). `channels_track_id_slug_key` est
 * `UNIQUE (track_id, slug)` : un slug de channel n'est unique que **dans son track**, si bien que
 * `?channel=prospection` peut désigner deux channels de deux tracks différents. Le couple
 * `(track, channel)` est exactement l'adressage que le produit emploie déjà pour un channel —
 * `/tracks/:slugTrack/:slugChannel` (`webapp/src/app/chemins.ts`) —, et deux écrans qui désignent la
 * même chose la désignent de la même façon.
 */
export type PorteeUrl =
	| { readonly type: 'workspace' }
	| { readonly type: 'track'; readonly track: string }
	| { readonly type: 'channel'; readonly track: string; readonly channel: string }

/** Les deux noms de paramètre, déclarés une fois : l'écran et les preuves les importent. */
export const CLE_URL_TRACK = 'track'
export const CLE_URL_CHANNEL = 'channel'

/** La portée par défaut. Elle ne s'écrit JAMAIS dans l'adresse (§8 bis.2). */
export const PORTEE_URL_PAR_DEFAUT: PorteeUrl = { type: 'workspace' }

/**
 * Lit la portée demandée par l'adresse, en repliant tout ce qui n'est pas exploitable.
 *
 * `channel` SANS `track` NE DÉSIGNE RIEN, et ce n'est pas un oubli : c'est M8. Sans le track, le
 * slug de channel est ambigu, et deviner lequel des deux homonymes l'appelant visait montrerait un
 * portefeuille pour un autre. Le repli est la portée workspace, que le sélecteur affiche.
 *
 * Une chaîne vide est traitée comme une absence : `?track=` est une adresse tronquée, pas un track.
 */
export function lirePorteeUrl(
	track: string | null | undefined,
	channel: string | null | undefined,
): PorteeUrl {
	const slugTrack = track === null || track === undefined || track === '' ? null : track
	const slugChannel = channel === null || channel === undefined || channel === '' ? null : channel
	if (slugTrack === null) return PORTEE_URL_PAR_DEFAUT
	if (slugChannel === null) return { type: 'track', track: slugTrack }
	return { type: 'channel', track: slugTrack, channel: slugChannel }
}

/**
 * Les paramètres à écrire dans l'adresse pour une portée — le défaut n'écrit RIEN (§8 bis.2).
 *
 * `/pilotage` nu EST la portée workspace, et la vue par défaut doit rester l'adresse la plus courte :
 * c'est la règle que `?qui=tous` de `/ma-journee` tient déjà (`docs/SPEC-webapp.md` §17.2).
 */
export function ecrirePorteeUrl(portee: PorteeUrl): Readonly<Record<string, string>> {
	if (portee.type === 'workspace') return {}
	if (portee.type === 'track') return { [CLE_URL_TRACK]: portee.track }
	return { [CLE_URL_TRACK]: portee.track, [CLE_URL_CHANNEL]: portee.channel }
}

/**
 * Résout une portée d'adresse contre l'arborescence lue — et replie sur le workspace si elle n'y
 * correspond à rien.
 *
 * UNE PORTÉE QUI NE SE RÉSOUT PAS N'EST PAS UNE PANNE (§8 bis.2). Un slug inconnu, un track fermé
 * par la RLS, un channel qui n'appartient pas au track nommé : l'écran rend l'espace de travail
 * entier, sans aucune erreur. Écrire « ce track n'existe pas » renseignerait par la bande sur ce que
 * la RLS ferme — ce que `docs/DESIGN_SYSTEM.md` §5.48 interdit déjà à cet écran.
 *
 * LE REPLI N'EST PAS SILENCIEUX POUR AUTANT : la valeur rendue ici est celle que le sélecteur
 * affiche et que la phrase de portée nomme. Le lecteur voit donc la portée RÉELLEMENT appliquée,
 * jamais celle que l'adresse demandait.
 *
 * LE CHANNEL EST CHERCHÉ DANS SON TRACK, jamais dans tout l'arbre — M8 encore : chercher ailleurs
 * rendrait le premier homonyme trouvé, c'est-à-dire un portefeuille pour un autre.
 */
export function resoudrePorteeUrl(
	demandee: PorteeUrl,
	arbre: readonly TrackPortee[],
): PorteeUrl {
	if (demandee.type === 'workspace') return PORTEE_URL_PAR_DEFAUT
	const track = arbre.find((candidat) => candidat.slug === demandee.track)
	if (track === undefined) return PORTEE_URL_PAR_DEFAUT
	if (demandee.type === 'track') return { type: 'track', track: track.slug }
	const channel = track.channels.find((candidat) => candidat.slug === demandee.channel)
	if (channel === undefined) return { type: 'track', track: track.slug }
	return { type: 'channel', track: track.slug, channel: channel.slug }
}

/**
 * Traduit une portée d'adresse en portée du module d'analytique — des slugs vers des identifiants.
 *
 * La restriction, elle, se fait sur `track_id` et `channel_id` : ce sont les colonnes que
 * `public.entonnoir_conversion()` rend (§5.1). Les slugs vivent dans l'adresse parce qu'une adresse
 * se lit et se partage ; les identifiants vivent dans la donnée. La traduction est ici, en un seul
 * endroit, plutôt que répétée à chaque usage.
 *
 * ELLE SUPPOSE UNE PORTÉE DÉJÀ RÉSOLUE : appelée sur une portée que l'arbre ne porte pas, elle rend
 * le workspace — le même repli, jamais une exception.
 */
export function porteeAnalytique(portee: PorteeUrl, arbre: readonly TrackPortee[]): Portee {
	if (portee.type === 'workspace') return { type: 'workspace' }
	const track = arbre.find((candidat) => candidat.slug === portee.track)
	if (track === undefined) return { type: 'workspace' }
	if (portee.type === 'track') return { type: 'track', id: track.id }
	const channel = track.channels.find((candidat) => candidat.slug === portee.channel)
	if (channel === undefined) return { type: 'track', id: track.id }
	return { type: 'channel', id: channel.id }
}

/**
 * La valeur d'une option du `select`, et sa lecture inverse.
 *
 * ELLE N'EST PAS L'ADRESSE, et les deux ne se confondent pas : l'adresse porte deux clés (§8 bis.2)
 * là où un `select` ne rend qu'une chaîne. Le séparateur est `/`, comme dans l'adresse d'un channel
 * — un slug ne peut pas en porter, la base le contraint —, et la portée workspace est la chaîne
 * vide, qui est aussi la valeur naturelle de l'option de tête.
 */
export function valeurOption(portee: PorteeUrl): string {
	if (portee.type === 'workspace') return ''
	if (portee.type === 'track') return portee.track
	return `${portee.track}/${portee.channel}`
}

/** Lit la valeur rendue par le `select`. Une valeur inconnue replie sur le workspace. */
export function porteeDepuisOption(valeur: string): PorteeUrl {
	if (valeur === '') return PORTEE_URL_PAR_DEFAUT
	const separateur = valeur.indexOf('/')
	if (separateur === -1) return { type: 'track', track: valeur }
	return {
		type: 'channel',
		track: valeur.slice(0, separateur),
		channel: valeur.slice(separateur + 1),
	}
}

/**
 * Les colonnes de la seconde lecture — la forme MESURÉE de `lireChannelsLiables`.
 *
 * LE NOM DE LA CONTRAINTE EST `channels_track_id_workspace_id_fkey`, ET IL A DÉJÀ ÉTÉ PAYÉ CONTRE
 * L'API (`objectifs-ecriture.ts`) : la clé est COMPOSITE — `(track_id, workspace_id)` référence
 * `(id, workspace_id)` de `tracks` —, et un nom déduit du seul nom de colonne fait rendre `PGRST200`
 * à la requête entière. Il est repris tel quel plutôt que redécouvert.
 *
 * `slug` s'ajoute des deux côtés, là où le sélecteur des objectifs n'avait besoin que des noms :
 * c'est le slug, et lui seul, qui s'écrit dans l'adresse (§8 bis.2). `position` s'ajoute côté track
 * pour le motif MESURÉ écrit sur `TrackPortee.position`.
 */
export const COLONNES_PORTEE =
	'id, slug, name, tracks!channels_track_id_workspace_id_fkey(id, slug, name, position)'

/**
 * Lit les portées offrables : les channels lisibles de l'espace de travail, avec leur track.
 *
 * UNE SEULE REQUÊTE, et les archivés comme ceux de la corbeille en sont écartés — convention de
 * `lireChannels` (`channels.ts`). Un channel archivé ne porte plus d'affaire active à mesurer, et
 * l'offrir comme portée offrirait un entonnoir vide par construction.
 *
 * L'ORDRE EST CELUI DU SERVEUR — `position` puis `name` —, jamais retrié ici : rejouer ce tri à
 * l'écran le ferait diverger le jour où la requête changera (règle du §5.22).
 *
 * Ne lève jamais.
 */
export async function lirePorteesOffrables(
	client: ClientCrm,
	idWorkspace: string,
): Promise<EtatAsync<readonly TrackPortee[]>> {
	try {
		const reponse = await client
			.from('channels')
			.select(COLONNES_PORTEE)
			.eq('workspace_id', idWorkspace)
			.is('archived_at', null)
			.is('deleted_at', null)
			.order('position')
			.order('name')
		if (reponse.error !== null) {
			return enErreur(classerErreur(reponse.status, reponse.error.message))
		}
		return pret(grouperPortees(reponse.data ?? []))
	} catch (cause) {
		return enErreur(classerErreur(undefined, cause instanceof Error ? cause.message : String(cause)))
	}
}

/**
 * Groupe les channels lus par track, en conservant l'ordre du serveur.
 *
 * UN CHANNEL DONT LE TRACK N'EST PAS LISIBLE EST ÉCARTÉ, ET LA LIMITE EST NOMMÉE (§8 bis.4).
 * L'adresse d'une portée channel exige le slug de son track (M8) ; sans track lisible, il n'y a pas
 * d'adresse à écrire, et une option qu'aucune adresse ne peut porter serait la commande morte du
 * §5.10 du design system. Le sélecteur de destination des objectifs range un tel channel hors de
 * tout groupe parce qu'il n'a besoin que de son identifiant ; ici, l'adresse est le contrat.
 *
 * L'ORDRE DES CHANNELS DANS UN GROUPE EST CELUI DU SERVEUR, jamais rejoué ici : la requête ordonne
 * par `position` puis par `name`, et `channels.position` est numérotée PAR TRACK — le tri du serveur
 * est donc exactement le bon à l'intérieur d'un groupe.
 *
 * L'ORDRE DES TRACKS, LUI, EST `tracks.position`, ET C'EST UN DÉFAUT TROUVÉ EN EXÉCUTANT `S9`
 * (`CLAUDE.md` §18, correction de la CAUSE). La même numérotation par track qui rend le tri du
 * serveur juste à l'intérieur d'un groupe le rend FAUX entre les groupes : quatre channels portent
 * `position = 1`, si bien que le tri global les entrelace et qu'un track apparaissait à la place de
 * son premier channel. MESURÉ : `Legacy 2023, Formation, Conseil & IA, Studio web`, là où le
 * produit range partout ailleurs `Conseil & IA, Studio web, Formation, Legacy 2023`. Deux écrans
 * qui rangent la même chose la rangent de la même façon (`docs/CloudWorker.md` §4.1 bis).
 *
 * Le nom départage deux tracks de même position — sans quoi ils s'échangeraient d'un chargement à
 * l'autre, la garde que `lireChannels` pose déjà pour les channels.
 */
export function grouperPortees(lignes: readonly unknown[]): readonly TrackPortee[] {
	const groupes = new Map<string, { track: Omit<TrackPortee, 'channels'>; channels: ChannelPortee[] }>()
	for (const brut of lignes) {
		const ligne = brut as { id: string; slug: string; name: string; tracks: unknown }
		// PostgREST rend l'imbriqué tantôt en objet, tantôt en tableau selon la cardinalité déduite :
		// les deux formes sont acceptées ici, comme dans `lireChannelsLiables`.
		const track = (Array.isArray(ligne.tracks) ? ligne.tracks[0] : ligne.tracks) as
			| { id: string; slug: string; name: string; position?: number }
			| null
			| undefined
		if (track === null || track === undefined) continue
		const groupe = groupes.get(track.id)
		const channel: ChannelPortee = { id: ligne.id, slug: ligne.slug, nom: ligne.name }
		if (groupe === undefined) {
			groupes.set(track.id, {
				track: {
					id: track.id,
					slug: track.slug,
					nom: track.name,
					position: track.position ?? 0,
				},
				channels: [channel],
			})
		} else {
			groupe.channels.push(channel)
		}
	}
	return [...groupes.values()]
		.map((groupe) => ({
			...groupe.track,
			channels: groupe.channels as readonly ChannelPortee[],
		}))
		.sort((a, b) => a.position - b.position || a.nom.localeCompare(b.nom))
}

/**
 * Le nom de la portée courante, tel que la phrase de portée et le sélecteur l'emploient.
 *
 * IL VIENT DE L'ARBRE, JAMAIS DE L'ADRESSE. Le slug est une adresse, pas un nom : écrire
 * « dossiers-2023 » là où le produit dit « Dossiers 2023 » ferait lire à l'utilisateur une donnée
 * technique. Une portée que l'arbre ne porte pas rend `null` — l'écran affiche alors le workspace,
 * qui est exactement ce que `resoudrePorteeUrl` lui a déjà donné.
 */
export function nommerPortee(portee: PorteeUrl, arbre: readonly TrackPortee[]): string | null {
	if (portee.type === 'workspace') return null
	const track = arbre.find((candidat) => candidat.slug === portee.track)
	if (track === undefined) return null
	if (portee.type === 'track') return track.nom
	return track.channels.find((candidat) => candidat.slug === portee.channel)?.nom ?? null
}
