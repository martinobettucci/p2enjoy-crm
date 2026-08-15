// @spec CRM-020 (docs/BACKLOG.md) — lecture des tracks par la barre latérale
// @spec docs/SPEC-tracks.md §7 (ce que la barre latérale lit), §4 (archivage), §3 (ordre)
// @spec CRM-077 (docs/BACKLOG.md) — corbeille : docs/SPEC-corbeille.md §3.1 (les trois états),
//       §3.3 (un enfant dont le parent est en corbeille est traité comme inaccessible), §4
// @spec docs/SPEC-webapp.md §6.3 (ce que la coquille lit), §6.4 (contrat asynchrone)
// @spec docs/SPEC-permissions-rls.md §4 (lecture par les membres du workspace)
//
// `public.tracks` porte, depuis `CRM-020`, une politique de lecture réservée aux membres du
// workspace. Sans session la requête rend `200` et `[]` ; avec la session restaurée par `CRM-009`,
// elle rend les tracks consentis. Dans les deux cas, l'état vient du backend.
//
// L'interface n'en déduit aucun droit : ce qu'elle affiche est ce que le backend a consenti à
// rendre (docs/DAT.md §3.1).

import { useCallback, useEffect, useRef, useState } from 'react'
import { classerErreur, enChargement, enErreur, pret, type EtatAsync } from './async'
import type { Database } from './database.types'
import type { ClientCrm } from './supabase'

/**
 * Ce que la barre latérale a besoin de savoir d'un track, et rien de plus.
 *
 * `description` et les horodatages ne sont pas demandés : une requête ne rapporte que ce qui est
 * affiché, sans quoi la charge utile grossit à chaque colonne ajoutée au modèle.
 */
export type Track = Pick<
	Database['public']['Tables']['tracks']['Row'],
	'id' | 'name' | 'slug' | 'color' | 'icon' | 'position'
>

/** Colonnes réellement demandées. Exportée pour que le test unitaire vérifie la requête émise. */
export const COLONNES_TRACK = 'id, name, slug, color, icon, position'

/**
 * Interroge PostgREST. Ne lève jamais : tout échec est rendu comme un état d'erreur classé, sur
 * le code HTTP réellement reçu et jamais sur le texte du message (voir `classerErreur`).
 *
 * Deux contraintes de la spécification sont portées par la requête elle-même :
 *
 *   * `archived_at=is.null` — un track archivé est **masqué** de la barre latérale
 *     (docs/SPEC-tracks.md §4). Le filtre est côté serveur : filtrer après coup ferait transiter
 *     des lignes que l'écran ne montrera jamais ;
 *   * `deleted_at=is.null` — un track EN CORBEILLE n'a plus de place dans la barre latérale
 *     (docs/SPEC-corbeille.md §3.1 et §4). Le filtre est SÉPARÉ du précédent parce que les deux
 *     états le sont : archiver conserve un dossier clos, mettre à la corbeille retire une erreur.
 *     Un objet en corbeille reste LISIBLE — c'est la condition pour qu'un écran de corbeille
 *     puisse l'afficher et le restaurer (§2.2) — et c'est donc bien à la lecture de LISTE, ici,
 *     que son retrait se joue ;
 *   * `order=position,name` — l'ordre est celui de `position`, puis du nom à position égale, pour
 *     que deux tracks de même position ne s'échangent pas d'un chargement à l'autre
 *     (docs/SPEC-tracks.md §3).
 */
export async function lireTracks(client: ClientCrm): Promise<EtatAsync<readonly Track[]>> {
	try {
		const reponse = await client
			.from('tracks')
			.select(COLONNES_TRACK)
			.is('archived_at', null)
			.is('deleted_at', null)
			.order('position')
			.order('name')
		if (reponse.error !== null) {
			return enErreur(classerErreur(reponse.status, reponse.error.message))
		}
		return pret(reponse.data)
	} catch (cause) {
		// `supabase-js` peut relancer une panne de transport plutôt que la rendre : un échec
		// réseau ne doit pas remonter comme une exception non traitée jusqu'à React.
		return enErreur(classerErreur(undefined, cause instanceof Error ? cause.message : String(cause)))
	}
}

/**
 * Charge les tracks accessibles et expose un rechargement **réel** — la reprise proposée par
 * l'état d'erreur relance la requête, elle ne recharge pas la page (docs/SPEC-webapp.md §7).
 */
export function useTracks(client: ClientCrm | null): {
	readonly etat: EtatAsync<readonly Track[]>
	readonly recharger: () => void
} {
	const [etat, setEtat] = useState<EtatAsync<readonly Track[]>>(enChargement)
	const [tentative, setTentative] = useState(0)
	// Une réponse arrivée après le démontage ne doit pas écrire dans un composant démonté, ni une
	// réponse périmée écraser une réponse plus récente.
	const courant = useRef(0)

	useEffect(() => {
		if (client === null) return
		const rang = ++courant.current
		setEtat(enChargement)
		void lireTracks(client).then((resultat) => {
			if (rang === courant.current) setEtat(resultat)
		})
	}, [client, tentative])

	const recharger = useCallback(() => {
		setTentative((precedente) => precedente + 1)
	}, [])

	return { etat, recharger }
}
