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

// ---------------------------------------------------------------------------------------------
// Guide de démarrage masqué pour la session — `CRM-079`, docs/SPEC-onboarding.md §5
// ---------------------------------------------------------------------------------------------
//
// Même support et même motif que le repli ci-dessus : catégorie 2 de `CLAUDE.md` §11, préférence
// d'interface limitée à la session. Rien ne survit à la fermeture de l'onglet, et aucun
// consentement n'a donc à être recueilli.
//
// C'est ce qui rend le guide « interrompable et relançable » sans persistance : masqué, il
// disparaît de `/` pour la session ; `/demarrage` l'affiche quand même, toujours (§5).

const CLE_DEMARRAGE_MASQUE = 'p2enjoy.demarrage.masque'

function lireMasque(): boolean {
	try {
		return globalThis.sessionStorage?.getItem(CLE_DEMARRAGE_MASQUE) === '1'
	} catch {
		// Stockage d'onglet indisponible : le guide reste visible. Le défaut le plus utile est
		// celui qui montre l'aide, pas celui qui la cache.
		return false
	}
}

function ecrireMasque(masque: boolean): void {
	try {
		globalThis.sessionStorage?.setItem(CLE_DEMARRAGE_MASQUE, masque ? '1' : '0')
	} catch {
		// Même raison qu'au repli : ne pas pouvoir mémoriser la préférence n'empêche pas de
		// l'appliquer pour la vue courante.
	}
}

export function useMasqueDemarrage(): {
	readonly masque: boolean
	readonly masquer: () => void
} {
	const [masque, setMasque] = useState<boolean>(lireMasque)

	const masquer = useCallback(() => {
		ecrireMasque(true)
		setMasque(true)
	}, [])

	return { masque, masquer }
}

export const CLE_PREFERENCE_DEMARRAGE_MASQUE = CLE_DEMARRAGE_MASQUE
