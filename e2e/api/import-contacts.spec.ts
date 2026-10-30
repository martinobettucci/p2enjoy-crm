// @verifies CRM-071 (docs/BACKLOG.md) — tranche T5 : l'import du carnet hors interface, avec les vrais jetons
// @verifies docs/SPEC-vues-import-export.md §6.2, §6.2 bis (simulation sans trace, doublons ignorés, refus de la lectrice
//           par la RLS, journal de l'import confirmé) ; CLAUDE.md §10 (refus par requête directe)
//
// Les contacts et organisations de la preuve portent le préfixe `ZZ 071` et sont retirés à la fin, par la clé de service.

import { expect, test } from '@playwright/test'
import { URL_API, enTetesAnonymes, enTetesAuthentifies, enTetesService, jetonDe } from './jetons'

const ESPACE = '5eed0000-0000-4000-8000-000000000001'
const DRISS = '5eed0000-0000-4000-8000-000000000012'
const rpc = `${URL_API}/rest/v1/rpc/import_contacts`
const json = (jeton: string) => ({ ...enTetesAuthentifies(jeton), 'Content-Type': 'application/json' })
const LIGNES = [
	{ full_name: 'ZZ 071 Anne', email: 'anne@zz071.example', organization_name: 'ZZ 071 Société', organization_domain: 'zz071.example' },
	{ full_name: 'ZZ 071 Doublon', email: 'ANNE@zz071.example' },
	{ full_name: 'ZZ 071 Refusée', email: 'pas-un-email' },
]

test.describe('l’import du carnet — hors interface (docs/SPEC-vues-import-export.md §6)', () => {
	test.afterEach(async ({ request }) => {
		await request.delete(`${URL_API}/rest/v1/contacts?full_name=like.${encodeURIComponent('ZZ 071*')}`, { headers: enTetesService() })
		await request.delete(`${URL_API}/rest/v1/organizations?name=like.${encodeURIComponent('ZZ 071*')}`, { headers: enTetesService() })
	})

	test('la simulation juge sans écrire ; l’import confirmé écrit les lignes valides et se journalise', async ({ request }) => {
		const driss = await jetonDe('bizdev@p2enjoy.test')
		const avant = new Date().toISOString()
		const simulation = await request.post(rpc, { headers: json(driss), data: { p_workspace: ESPACE, p_rows: LIGNES, p_dry_run: true } })
		expect(simulation.status(), await simulation.text()).toBe(200)
		expect(((await simulation.json()) as { outcome: string; code: string | null }[]).map((i) => [i.outcome, i.code])).toEqual([
			['created', null],
			['skipped', 'duplicate_email'],
			['refused', 'invalid_email'],
		])
		const rien = await request.get(`${URL_API}/rest/v1/contacts?full_name=like.${encodeURIComponent('ZZ 071*')}&select=id`, { headers: enTetesService() })
		expect(await rien.json()).toEqual([])

		const confirme = await request.post(rpc, { headers: json(driss), data: { p_workspace: ESPACE, p_rows: LIGNES, p_dry_run: false } })
		expect(confirme.status()).toBe(200)
		const ecrits = await request.get(
			`${URL_API}/rest/v1/contacts?full_name=like.${encodeURIComponent('ZZ 071*')}&select=full_name,source,organisation:organizations(name)`,
			{ headers: enTetesService() },
		)
		expect(await ecrits.json()).toEqual([{ full_name: 'ZZ 071 Anne', source: 'import', organisation: { name: 'ZZ 071 Société' } }])
		const journal = await request.get(
			`${URL_API}/rest/v1/audit_log?actor_id=eq.${DRISS}&family=eq.import&occurred_at=gte.${encodeURIComponent(avant)}&select=details`,
			{ headers: enTetesService() },
		)
		expect(await journal.json()).toEqual([{ details: { created: 1, skipped: 1, refused: 1, organizations_created: 1 } }])
	})

	test('la lectrice est refusée ligne par ligne par la RLS ; l’anonyme ne l’appelle pas', async ({ request }) => {
		const farida = await jetonDe('viewer@p2enjoy.test')
		const refus = await request.post(rpc, {
			headers: json(farida),
			data: { p_workspace: ESPACE, p_rows: [{ full_name: 'ZZ 071 Farida' }], p_dry_run: false },
		})
		expect(refus.status()).toBe(200)
		expect(await refus.json()).toMatchObject([{ outcome: 'refused', code: 'forbidden' }])
		const anonyme = await request.post(rpc, {
			headers: { ...enTetesAnonymes(), 'Content-Type': 'application/json' },
			data: { p_workspace: ESPACE, p_rows: [], p_dry_run: true },
		})
		expect(anonyme.status()).toBe(401)
	})
})
