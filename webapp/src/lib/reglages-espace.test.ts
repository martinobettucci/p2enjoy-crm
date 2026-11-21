// @verifies CRM-161 (docs/BACKLOG.md) — tranche T2.c : chaque lecture de premier niveau d'un écran de réglages émet le filtre
//           `workspace_id=eq.<espace>` quand l'espace est donné, et aucun quand il est omis
// @verifies docs/SPEC-espace-courant.md §15.4 bis

import { describe, expect, it } from 'vitest'
import { lireTracksAdministrables } from './administration-arborescence'
import { lireCatalogueAdministrable } from './administration-catalogue'
import { lireCatalogueActif, lireTracksAffectables, lireWorkflowsAdministrables } from './administration-workflows'
import { lireCorbeille } from './corbeille'
import { lireEtiquettes } from './etiquettes'
import { lireComptesEntrants } from './mail-comptes'
import { lireIdentitesSortantes } from './mail-identites'
import { lireModeles } from './modeles-affaires'
import { lireModelesEmails } from './modeles-emails'
import { lireSequences } from './sequences-relance'
import type { ClientCrm } from './supabase'

/** Un client qui accepte toute chaîne de PostgREST, rend zéro ligne, et note chaque `eq`. */
function espion() {
	const egalites: [string, unknown][] = []
	const chaine: Record<string, unknown> = {}
	for (const methode of ['select', 'is', 'not', 'order', 'limit', 'in', 'neq']) chaine[methode] = () => chaine
	chaine['eq'] = (colonne: string, valeur: unknown) => {
		egalites.push([colonne, valeur])
		return chaine
	}
	chaine['then'] = (resoudre: (r: unknown) => unknown) => Promise.resolve({ data: [], error: null, status: 200 }).then(resoudre)
	const client = { from: () => chaine } as unknown as ClientCrm
	return { client, egalites }
}

const LECTURES: readonly [string, (c: ClientCrm, w?: string) => Promise<unknown>][] = [
	['lireTracksAdministrables', (c, w) => lireTracksAdministrables(c, false, w)],
	['lireWorkflowsAdministrables', (c, w) => lireWorkflowsAdministrables(c, false, w)],
	['lireTracksAffectables', (c, w) => lireTracksAffectables(c, w)],
	['lireCatalogueActif', (c, w) => lireCatalogueActif(c, w)],
	['lireCatalogueAdministrable', (c, w) => lireCatalogueAdministrable(c, w)],
	['lireComptesEntrants', (c, w) => lireComptesEntrants(c, w)],
	['lireIdentitesSortantes', (c, w) => lireIdentitesSortantes(c, w)],
	['lireModelesEmails', (c, w) => lireModelesEmails(c, w)],
	['lireSequences', (c, w) => lireSequences(c, w)],
	['lireEtiquettes', (c, w) => lireEtiquettes(c, w === undefined ? {} : { idWorkspace: w })],
	['lireModeles', (c, w) => lireModeles(c, w === undefined ? {} : { idWorkspace: w })],
	['lireCorbeille', (c, w) => lireCorbeille(c, w)],
]

describe('les réglages ne lisent que l’espace de l’écran (§15.4 bis)', () => {
	it.each(LECTURES)('%s : le filtre de l’espace quand il est donné', async (_nom, lire) => {
		const { client, egalites } = espion()
		await lire(client, 'w-2')
		expect(egalites.filter(([c]) => c === 'workspace_id').length).toBeGreaterThan(0)
		expect(egalites.filter(([c]) => c === 'workspace_id').every(([, v]) => v === 'w-2')).toBe(true)
	})

	it.each(LECTURES)('%s : aucun filtre d’espace quand il est omis', async (_nom, lire) => {
		const { client, egalites } = espion()
		await lire(client)
		expect(egalites.filter(([c]) => c === 'workspace_id')).toEqual([])
	})
})
