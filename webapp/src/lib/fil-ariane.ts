// @spec CRM-110 (docs/BACKLOG.md) tranche T2 — les ancêtres d'une route de track, composés sans requête
// @spec docs/SPEC-webapp.md §5.1 bis (niveaux par route ; règles 1, 2 et 5) ; docs/DESIGN_SYSTEM.md §5.62
//
// Le fil d'Ariane ne nomme que des lignes que la route a DÉJÀ lues — le track et ses channels, chargés pour la barre
// d'onglets (règle 1). Un niveau dont la donnée manque n'est pas rendu : ni slug à la place d'un nom, ni libellé
// inventé (règle 2, `CLAUDE.md` §18). Les adresses sont composées depuis le slug de la LIGNE rendue, et non depuis
// l'adresse demandée : c'est la ligne que la RLS a consentie.
//
// Le workspace n'est pas un ancêtre composé ici : la coquille le lit et l'ajoute elle-même en tête (règle 5).

import { cheminCoutsTrack } from '../app/chemins'
import { t } from '../i18n'
import type { Channel, TrackOuvert } from './channels'

/** Un niveau du fil d'Ariane, entre le workspace et le titre de la route : un nom et l'adresse où il mène. */
export type NiveauAriane = {
	readonly libelle: string
	readonly vers: string
}

type TrackNomme = Pick<TrackOuvert, 'name' | 'slug'>
type ChannelNomme = Pick<Channel, 'name' | 'slug'>

const AUCUN: readonly NiveauAriane[] = []

function niveauTrack(track: TrackNomme): NiveauAriane {
	// La cible de la pilule du track dans la barre latérale (docs/DESIGN_SYSTEM.md §5.62).
	return { libelle: track.name, vers: `/tracks/${track.slug}` }
}

/**
 * Un channel ouvert, en board ou en liste : le track le précède. Sans channel lu, la route se lit comme celle du track
 * seul — son titre est le nom du track, et rien ne le précède.
 */
export function ancetresChannel(track: TrackNomme | null, channel: ChannelNomme | undefined): readonly NiveauAriane[] {
	if (track === null || channel === undefined) return AUCUN
	return [niveauTrack(track)]
}

/**
 * Une affaire ouverte : le track, puis son channel, résolu par son slug dans la liste déjà chargée — comme l'onglet
 * actif. Un channel absent de la liste n'est pas nommé ; le track, lu, le reste.
 */
export function ancetresAffaire(
	track: TrackNomme | null,
	channels: readonly ChannelNomme[],
	slugChannel: string | undefined,
): readonly NiveauAriane[] {
	if (track === null) return AUCUN
	const channel = channels.find((candidat) => candidat.slug === slugChannel)
	if (channel === undefined) return [niveauTrack(track)]
	return [niveauTrack(track), { libelle: channel.name, vers: `/tracks/${track.slug}/${channel.slug}` }]
}

/** Les coûts d'un track : le track les précède. */
export function ancetresCoutsTrack(track: TrackNomme | null): readonly NiveauAriane[] {
	if (track === null) return AUCUN
	return [niveauTrack(track)]
}

/** Le détail d'un budget : le track, puis « Coûts », l'écran des coûts du track. */
export function ancetresBudget(track: TrackNomme | null): readonly NiveauAriane[] {
	if (track === null) return AUCUN
	return [niveauTrack(track), { libelle: t('tabs.track.costs'), vers: cheminCoutsTrack(track.slug) }]
}
