// @verifies CRM-098 (docs/BACKLOG.md) — tranche T3 : le coût du personnel, versionné par date d'effet
// @verifies docs/SPEC-temps.md §3.1 (version en vigueur, version programmée, refus de la base traduits), §7.4

import { describe, expect, it } from 'vitest'
import {
	classerRefusVersion,
	creerVersion,
	estProgrammee,
	prochaineVersion,
	supprimerVersion,
	versionEnVigueur,
	type VersionCout,
} from './cout-personnel'
import type { ClientCrm } from './supabase'

const v = (date_effet: string, cout_quart: number): VersionCout => ({ id: date_effet, profile_id: 'p', date_effet, cout_quart, devise: 'EUR' })
const VERSIONS = [v('2026-01-01', 100), v('2026-10-01', 120), v('2027-01-01', 135), v('2027-06-01', 150)]

describe('les versions d’une personne', () => {
	it('la version en vigueur est la plus récente dont l’effet ne dépasse pas le jour', () => {
		expect(versionEnVigueur(VERSIONS, '2026-10-11')?.cout_quart).toBe(120)
		expect(versionEnVigueur(VERSIONS, '2026-10-01')?.cout_quart).toBe(120)
		expect(versionEnVigueur(VERSIONS, '2026-09-30')?.cout_quart).toBe(100)
		expect(versionEnVigueur(VERSIONS, '2025-12-31')).toBeNull()
	})
	it('la prochaine version est la plus proche dans le futur ; une version du jour n’est plus programmée', () => {
		expect(prochaineVersion(VERSIONS, '2026-10-11')?.cout_quart).toBe(135)
		expect(prochaineVersion(VERSIONS, '2027-06-01')).toBeNull()
		expect(estProgrammee(v('2026-10-11', 1), '2026-10-11')).toBe(false)
		expect(estProgrammee(v('2026-10-12', 1), '2026-10-11')).toBe(true)
	})
})

describe('les refus de la base, traduits', () => {
	it('par le message des déclencheurs de 0087, puis par le code', () => {
		expect(classerRefusVersion(400, 'P0001', 'version retroactive')).toBe('retroactive')
		expect(classerRefusVersion(400, 'P0001', 'version en vigueur')).toBe('en-vigueur')
		expect(classerRefusVersion(400, 'P0001', "personne hors de l'espace")).toBe('hors-espace')
		expect(classerRefusVersion(409, '23505', 'duplicate key')).toBe('doublon')
		expect(classerRefusVersion(400, '23514', 'check')).toBe('forme')
		expect(classerRefusVersion(403, '42501', 'rls')).toBe('droit')
		expect(classerRefusVersion(undefined, undefined, 'Failed to fetch')).toBe('reseau')
	})
})

/** Client factice : une seule requête, la réponse donnée ; il retient l'action et sa charge. */
function client(reponse: { data: unknown[] | null; error: { message: string; code?: string } | null; status: number }) {
	const appels: { action: string; charge: unknown }[] = []
	const chaine: Record<string, unknown> = {}
	let courant = { action: 'select', charge: null as unknown }
	for (const nom of ['eq', 'select', 'order']) chaine[nom] = () => chaine
	for (const nom of ['insert', 'delete']) {
		chaine[nom] = (charge?: unknown) => {
			courant = { action: nom, charge }
			return chaine
		}
	}
	chaine.then = (ok: (r: unknown) => unknown) => {
		appels.push(courant)
		return Promise.resolve(reponse).then(ok)
	}
	return { client: { from: () => chaine } as unknown as ClientCrm, appels }
}

describe('créer et retirer une version', () => {
	it('la création envoie la personne, la date, le coût et la devise', async () => {
		const { client: c, appels } = client({ data: [{ id: 'x' }], error: null, status: 201 })
		expect(await creerVersion(c, { idWorkspace: 'w', idPersonne: 'p', dateEffet: '2027-01-04', coutQuart: 135.5, devise: 'EUR' })).toEqual({ ok: true })
		expect(appels[0]).toEqual({
			action: 'insert',
			charge: { workspace_id: 'w', profile_id: 'p', date_effet: '2027-01-04', cout_quart: 135.5, devise: 'EUR' },
		})
	})
	it('un refus de la base est rendu avec son motif', async () => {
		const { client: c } = client({ data: null, error: { message: 'version retroactive', code: 'P0001' }, status: 400 })
		expect(await creerVersion(c, { idWorkspace: 'w', idPersonne: 'p', dateEffet: '2026-01-01', coutQuart: 1, devise: 'EUR' })).toEqual({
			ok: false,
			motif: 'retroactive',
		})
	})
	it('un retrait qui ne touche aucune ligne est un refus, jamais un succès', async () => {
		const { client: c } = client({ data: [], error: null, status: 200 })
		expect(await supprimerVersion(c, 'x')).toEqual({ ok: false, motif: 'droit' })
	})
})
