// @spec CRM-007 (docs/BACKLOG.md) — préférences d'interface limitées à la session
// @spec docs/DESIGN_SYSTEM.md §4 (« l'état de repli est une préférence de session »)
// @spec docs/SPEC-webapp.md §11 (stockage côté client) ; CLAUDE.md §11 (RGPD)
//
// `sessionStorage`, jamais `localStorage` : le repli de la barre latérale est une préférence
// d'interface temporaire, catégorie 2 de CLAUDE.md §11. Rien ne survit à la fermeture de
// l'onglet, et aucun consentement n'a donc à être recueilli.
//
// Un contrôle E2E lit `localStorage` après un parcours complet et exige qu'il soit vide.

import { useCallback, useState } from 'react'

const CLE_REPLI = 'p2enjoy.sidebar.replie'

function lireRepli(): boolean {
	try {
		return globalThis.sessionStorage?.getItem(CLE_REPLI) === '1'
	} catch {
		// `sessionStorage` peut être inaccessible (navigation privée verrouillée, contexte
		// sans origine). L'absence de préférence n'est pas une erreur : on retombe sur le
		// défaut, barre déployée. Rien n'est masqué ici — il n'y a rien à signaler.
		return false
	}
}

function ecrireRepli(replie: boolean): void {
	try {
		globalThis.sessionStorage?.setItem(CLE_REPLI, replie ? '1' : '0')
	} catch {
		// Même raison : ne pas pouvoir mémoriser une préférence d'affichage ne doit pas
		// empêcher de l'appliquer pour la vue courante.
	}
}

export function useReplisidebar(): {
	readonly replie: boolean
	readonly basculer: () => void
} {
	const [replie, setReplie] = useState<boolean>(lireRepli)

	const basculer = useCallback(() => {
		setReplie((precedent) => {
			const suivant = !precedent
			ecrireRepli(suivant)
			return suivant
		})
	}, [])

	return { replie, basculer }
}

export const CLE_PREFERENCE_REPLI = CLE_REPLI
