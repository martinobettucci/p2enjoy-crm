// @spec CRM-021 (docs/BACKLOG.md) — lecture des channels et résolution d'un track par son slug
// @spec docs/SPEC-channels.md §5 (ce que la barre d'onglets lit), §5.1 (route d'un track), §4
// @spec docs/SPEC-webapp.md §6.3 (ce que la coquille lit), §6.4 (contrat asynchrone)
// @spec docs/SPEC-permissions-rls.md §4 (lecture par les membres du workspace)
//
// `public.channels` porte, depuis `CRM-021`, une politique de lecture réservée aux membres du
// workspace. Sans session les deux requêtes rendent `200` et `[]` ; avec la session restaurée par
// `CRM-009`, elles rendent le track et ses channels consentis. Dans les deux cas, l'état vient du
// backend.
//
// L'interface n'en déduit aucun droit : ce qu'elle affiche est ce que le backend a consenti à
// rendre (docs/DAT.md §3.1).

import { useCallback, useEffect, useRef, useState } from 'react'
import { classerErreur, enChargement, enErreur, pret, type EtatAsync } from './async'
import type { Database } from './database.types'
import type { ClientCrm } from './supabase'

/**
 * Ce que la barre d'onglets a besoin de savoir d'un channel, et rien de plus.
 *
 * `description` et les horodatages ne sont pas demandés : une requête ne rapporte que ce qui est
 * affiché.
 *
 * `workflow_id` FAIT EXCEPTION DEPUIS `CRM-041`, et l'exception est écrite plutôt que subie.
 * `CRM-021` l'écartait parce qu'elle « est de surcroît nulle partout jusqu'à `CRM-031` (INC-029) —
 * le demander donnerait l'illusion d'une donnée exploitable ». MESURÉ : les six channels du seed
 * portent un workflow, et la colonne est `NOT NULL` depuis `CRM-033`. Le board en a besoin pour
 * composer ses colonnes ; il la lit **ici**, dans la lecture déjà émise par la coquille, plutôt
 * que par une seconde lecture des mêmes lignes — c'est la règle du §5.4 de
 * `docs/SPEC-channels.md`, appliquée à une colonne au lieu d'une route (décision 169). La barre
 * d'onglets transporte donc une colonne qu'elle n'affiche pas : c'est le prix, et il est moindre
 * qu'une requête par ouverture de board et une seconde définition de « channel non archivé ».
 */
export type Channel = Pick<
	Database['public']['Tables']['channels']['Row'],
	'id' | 'name' | 'slug' | 'position' | 'workflow_id'
>

/** Le track porteur de la route, tel que l'écran a besoin de le connaître. */
export type TrackOuvert = Pick<
	Database['public']['Tables']['tracks']['Row'],
	'id' | 'name' | 'slug'
>

/** Colonnes réellement demandées. Exportées pour que les tests unitaires vérifient la requête. */
export const COLONNES_CHANNEL = 'id, name, slug, position, workflow_id'
export const COLONNES_TRACK_OUVERT = 'id, name, slug'

/**
 * Ce que la route d'un track a chargé : le track lui-même, ou son absence, et ses channels.
 *
 * `track: null` **n'est pas une erreur** : c'est la réponse du backend à un appelant qui n'a pas
 * le droit de voir ce track, ou à un slug qui n'existe pas. Les deux se ressemblent, et c'est
 * voulu — distinguer les deux renseignerait un appelant anonyme sur l'existence d'un track qu'il
 * n'a pas le droit de lire (docs/SPEC-permissions-rls.md §7, « un refus de lecture est zéro
 * ligne »).
 */
export type ContenuTrack = {
	readonly track: TrackOuvert | null
	readonly channels: readonly Channel[]
}

/**
 * Résout un track par son **slug**, et non par son identifiant : `docs/SCHEMA.md` §2 le décrit
 * comme « identifiant d'URL stable », et une URL lisible se partage.
 *
 * Le filtre `archived_at=is.null` vaut ici aussi : un track archivé est masqué, y compris quand
 * son adresse est saisie directement. Sans ce filtre, l'archivage ne serait qu'un masquage de la
 * barre latérale, contournable par l'URL (docs/SPEC-tracks.md §4).
 */
export async function lireTrackParSlug(
	client: ClientCrm,
	slug: string,
): Promise<EtatAsync<TrackOuvert | null>> {
	try {
		const reponse = await client
			.from('tracks')
			.select(COLONNES_TRACK_OUVERT)
			.eq('slug', slug)
			.is('archived_at', null)
			.limit(1)
		if (reponse.error !== null) {
			return enErreur(classerErreur(reponse.status, reponse.error.message))
		}
		return pret(reponse.data[0] ?? null)
	} catch (cause) {
		return enErreur(classerErreur(undefined, cause instanceof Error ? cause.message : String(cause)))
	}
}

/**
 * Les channels **non archivés** d'un track, dans l'ordre des onglets.
 *
 * Deux contraintes de la spécification sont portées par la requête elle-même :
 *
 *   * `track_id=eq.<id>` — le filtre est côté serveur. Rapporter les channels de tous les tracks
 *     pour n'en afficher qu'une barre ferait transiter des lignes que l'écran ne montrera jamais
 *     (docs/SPEC-channels.md §5) ;
 *   * `order=position,name` — l'ordre est celui de `position`, puis du nom à position égale, pour
 *     que deux channels de même position ne s'échangent pas d'un chargement à l'autre (§3).
 */
export async function lireChannels(
	client: ClientCrm,
	trackId: string,
): Promise<EtatAsync<readonly Channel[]>> {
	try {
		const reponse = await client
			.from('channels')
			.select(COLONNES_CHANNEL)
			.eq('track_id', trackId)
			.is('archived_at', null)
			.order('position')
			.order('name')
		if (reponse.error !== null) {
			return enErreur(classerErreur(reponse.status, reponse.error.message))
		}
		return pret(reponse.data)
	} catch (cause) {
		return enErreur(classerErreur(undefined, cause instanceof Error ? cause.message : String(cause)))
	}
}

/**
 * Projette un état de **contenu de track** en état de **channels**, pour la barre d'onglets.
 *
 * @spec CRM-037 — docs/SPEC-form-composer.md §4.6 bis ; docs/SPEC-channels.md §5.4
 *
 * Le type somme d'`EtatAsync` ne se transpose pas d'un contenu à l'autre : la barre d'onglets veut
 * un état *de channels*, pas un état *de contenu de track*. La projection est explicite plutôt que
 * forcée par un cast, pour que le compilateur continue d'exiger l'exhaustivité.
 *
 * Elle vit ici, et non dans une route, depuis que **deux** routes portent un track courant — celle
 * d'un track (`CRM-021`) et celle d'une card (`CRM-037`, §4.6 bis). Recopiée, elle aurait été
 * l'occasion de divergence que la décision 167 refuse : la même donnée, lue deux fois, finit par
 * être lue de deux façons.
 */
export function projeterChannels(etat: EtatAsync<ContenuTrack>): EtatAsync<readonly Channel[]> {
	if (etat.statut === 'pret') return pret(etat.donnees.channels)
	if (etat.statut === 'chargement') return enChargement()
	return enErreur(etat.erreur)
}

/**
 * Charge le contenu de la route d'un track : le track, puis ses channels.
 *
 * Les deux requêtes sont **séquentielles et non parallèles**, parce que la seconde a besoin de
 * l'identifiant que la première rapporte. Lorsque le track est absent — refusé ou inexistant —,
 * la seconde n'est pas émise du tout : interroger `channels` avec un identifiant qu'on n'a pas
 * n'aurait aucun sens, et émettre une requête dont on sait qu'elle rendra `[]` est une requête de
 * trop.
 */
export function useContenuTrack(
	client: ClientCrm | null,
	slug: string | undefined,
): {
	readonly etat: EtatAsync<ContenuTrack>
	readonly recharger: () => void
} {
	const [etat, setEtat] = useState<EtatAsync<ContenuTrack>>(enChargement)
	const [tentative, setTentative] = useState(0)
	// Une réponse arrivée après le démontage ne doit pas écrire dans un composant démonté, ni une
	// réponse périmée écraser une réponse plus récente — le slug change d'un onglet à l'autre.
	const courant = useRef(0)

	useEffect(() => {
		if (client === null || slug === undefined) return
		const rang = ++courant.current
		setEtat(enChargement)
		void (async () => {
			const resultatTrack = await lireTrackParSlug(client, slug)
			if (rang !== courant.current) return
			if (resultatTrack.statut !== 'pret') {
				setEtat(resultatTrack)
				return
			}
			const track = resultatTrack.donnees
			if (track === null) {
				setEtat(pret({ track: null, channels: [] }))
				return
			}
			const resultatChannels = await lireChannels(client, track.id)
			if (rang !== courant.current) return
			if (resultatChannels.statut !== 'pret') {
				setEtat(resultatChannels)
				return
			}
			setEtat(pret({ track, channels: resultatChannels.donnees }))
		})()
	}, [client, slug, tentative])

	const recharger = useCallback(() => {
		setTentative((precedente) => precedente + 1)
	}, [])

	return { etat, recharger }
}
