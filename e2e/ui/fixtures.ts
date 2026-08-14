// @verifies CRM-007 (docs/BACKLOG.md) — aucune erreur ou alerte navigateur silencieuse
// @verifies docs/SPEC-webapp.md §12.3, §14 ; docs/JOURNAL.md décision 248

import { expect, test as base, type Page } from '@playwright/test'

export { expect }
export type { APIRequestContext, Page, Route } from '@playwright/test'

const ANOMALIES_PAR_PAGE = new WeakMap<Page, string[]>()

export const ERREUR_RESSOURCE_HTTP = {
	400: 'console.error: Failed to load resource: the server responded with a status of 400 (Bad Request)',
	// `401` AJOUTÉ PAR `CRM-057` : PostgREST rend `401` — et non `403` — à la clé ANONYME sur une
	// table ou une fonction dont `anon` n'a aucun privilège. Un visiteur non connecté qui ouvre
	// l'inbox provoque donc ce refus, que l'écran présente comme un refus et non comme une panne.
	401: 'console.error: Failed to load resource: the server responded with a status of 401 (Unauthorized)',
	403: 'console.error: Failed to load resource: the server responded with a status of 403 (Forbidden)',
	// `409` AJOUTÉ PAR `CRM-076` : PostgREST rend `409 Conflict` sur une violation de clé
	// étrangère — ici le `on delete restrict` d'une étape occupée par des cards, que l'écran
	// présente comme le refus métier qu'il est (docs/SPEC-workflow-engine.md §7 bis.4).
	409: 'console.error: Failed to load resource: the server responded with a status of 409 (Conflict)',
	416: 'console.error: Failed to load resource: the server responded with a status of 416 (Range Not Satisfiable)',
} as const

export const ERREUR_CONNEXION_REFUSEE =
	'console.error: Failed to load resource: net::ERR_CONNECTION_REFUSED'

/**
 * Observe les erreurs JavaScript et les messages console que l'utilisateur ne voit pas à l'écran.
 * Le tableau rendu reste vivant jusqu'à la fermeture de la page.
 */
export function surveillerConsole(page: Page): string[] {
	const anomalies: string[] = []
	ANOMALIES_PAR_PAGE.set(page, anomalies)
	page.on('console', (message) => {
		if (['error', 'warning', 'warn'].includes(message.type())) {
			anomalies.push(`console.${message.type()}: ${message.text()}`)
		}
	})
	page.on('pageerror', (erreur) => anomalies.push(`pageerror: ${erreur.message}`))
	return anomalies
}

/**
 * Consomme une liste exacte d'erreurs que le scénario vient de provoquer et d'expliquer à
 * l'utilisateur. Rien n'est filtré globalement : un statut, un nombre ou un ordre différent
 * échoue ici, et toute anomalie postérieure reste disponible pour le verdict final.
 */
export function autoriserErreursConsole(page: Page, attendues: readonly string[]): void {
	const anomalies = ANOMALIES_PAR_PAGE.get(page) ?? []
	expect(anomalies, 'les seules erreurs console sont celles que le scénario vient de vérifier').toEqual(
		attendues,
	)
	anomalies.length = 0
}

/** Chaque scénario UI reçoit une page dont la console fait partie du verdict. */
export const test = base.extend({
	page: async ({ page }, utiliser) => {
		const anomalies = surveillerConsole(page)
		await utiliser(page)
		expect(anomalies, 'aucun warning, error ou pageerror ne reste dans le navigateur').toEqual([])
	},
})
