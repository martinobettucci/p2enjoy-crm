// @spec CRM-117 (docs/BACKLOG.md) — tranche T2 : lire le sommaire et un chapitre du manuel depuis les écrans
// @spec docs/SPEC-manual.md §13.3 (le sommaire est lu une fois par session de lecture), §13.4 (les états) ;
//       docs/SPEC-webapp.md §6.4 (contrat asynchrone)
//
// LE SOMMAIRE EST LU UNE FOIS, ET PARTAGÉ : le panneau d'aide de l'en-tête et les pages de l'aide en ont tous deux
// besoin, et le relire à chaque ouverture du panneau ou à chaque chapitre serait une requête sans objet. La lecture en
// cours est gardée par client ; un échec n'est pas gardé, pour que « Réessayer » relise réellement.

import { useCallback, useEffect, useState } from 'react'
import { enChargement, enErreur, type EtatAsync } from '../lib/async'
import { lireChapitre, lireSommaire, type Chapitre, type Sommaire } from '../lib/manuel'
import type { ClientCrm } from '../lib/supabase'

const SANS_CLIENT = { nature: 'unknown', detail: 'client de la base absent' } as const

const lectures = new WeakMap<ClientCrm, Promise<EtatAsync<Sommaire>>>()

/** Le sommaire, lu une fois par client ; un échec est oublié aussitôt. */
export function sommaireEnCache(client: ClientCrm): Promise<EtatAsync<Sommaire>> {
	const enCours = lectures.get(client)
	if (enCours !== undefined) return enCours
	const lecture = lireSommaire(client).then((etat) => {
		if (etat.statut !== 'pret') lectures.delete(client)
		return etat
	})
	lectures.set(client, lecture)
	return lecture
}

/** Oublie le sommaire gardé — pour « Réessayer », et pour les preuves. */
export function oublierSommaire(client: ClientCrm): void {
	lectures.delete(client)
}

/** Le sommaire du manuel. `actif` à faux ne lit rien : le panneau ne le lit qu'à son ouverture. */
export function useSommaireManuel(client: ClientCrm | null, actif = true) {
	const [etat, setEtat] = useState<EtatAsync<Sommaire>>(enChargement)
	const [essai, setEssai] = useState(0)

	useEffect(() => {
		if (!actif) return
		if (client === null) {
			setEtat(enErreur(SANS_CLIENT))
			return
		}
		let actuel = true
		void sommaireEnCache(client).then((suivant) => {
			if (actuel) setEtat(suivant)
		})
		return () => {
			actuel = false
		}
	}, [client, actif, essai])

	const reessayer = useCallback(() => {
		if (client !== null) oublierSommaire(client)
		setEtat(enChargement())
		setEssai((n) => n + 1)
	}, [client])

	return { etat, reessayer }
}

/** Un chapitre : `null` s'il est introuvable. Relu à chaque changement d'identifiant. */
export function useChapitreManuel(client: ClientCrm | null, slug: string) {
	const [etat, setEtat] = useState<{ readonly slug: string; readonly etat: EtatAsync<Chapitre | null> }>({
		slug,
		etat: enChargement(),
	})
	const [essai, setEssai] = useState(0)

	useEffect(() => {
		if (client === null) {
			setEtat({ slug, etat: enErreur(SANS_CLIENT) })
			return
		}
		let actuel = true
		setEtat({ slug, etat: enChargement() })
		void lireChapitre(client, slug).then((suivant) => {
			if (actuel) setEtat({ slug, etat: suivant })
		})
		return () => {
			actuel = false
		}
	}, [client, slug, essai])

	const reessayer = useCallback(() => setEssai((n) => n + 1), [])

	// UN CHAPITRE D'UN AUTRE IDENTIFIANT SE REND COMME UN CHARGEMENT (docs/DESIGN_SYSTEM.md §5.36) : pendant l'image qui
	// suit un changement d'adresse, l'état gardé est encore celui du chapitre précédent.
	return { etat: etat.slug === slug ? etat.etat : enChargement<Chapitre | null>(), reessayer }
}
