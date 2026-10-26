// @spec CRM-117 (docs/BACKLOG.md) — tranche T2 : un seul panneau de l'en-tête ouvert à la fois
// @spec docs/DESIGN_SYSTEM.md §5.69 (« ouvrir l'aide referme le panneau des notifications, et inversement »), §5.43
//
// Les panneaux de l'en-tête sont des composants indépendants : aucun ne connaît l'autre. Celui qui s'ouvre l'annonce par
// un événement du document, et les autres se referment. À la souris, le clic hors d'un panneau le refermait déjà ; au
// clavier, rien ne le faisait, et deux panneaux ancrés au même endroit se superposaient.

import { useEffect, useRef } from 'react'

const EVENEMENT = 'p2enjoy:panneau-entete-ouvert'

/** Annonce qu'un panneau de l'en-tête s'ouvre : tous les autres se referment. */
export function fermerLesAutresPanneaux(panneau: string): void {
	globalThis.dispatchEvent(new CustomEvent<string>(EVENEMENT, { detail: panneau }))
}

/** Referme ce panneau quand un AUTRE panneau de l'en-tête s'ouvre. */
export function useFermetureParUnAutrePanneau(panneau: string, fermer: () => void): void {
	const rappel = useRef(fermer)
	useEffect(() => {
		rappel.current = fermer
	}, [fermer])
	useEffect(() => {
		const surOuverture = (evenement: Event) => {
			if ((evenement as CustomEvent<string>).detail !== panneau) rappel.current()
		}
		globalThis.addEventListener(EVENEMENT, surOuverture)
		return () => globalThis.removeEventListener(EVENEMENT, surOuverture)
	}, [panneau])
}
