// @verifies CRM-071 (docs/BACKLOG.md) — tranche T6 : l'import des affaires hors interface, avec les vrais jetons
// @verifies docs/SPEC-vues-import-export.md §6.3, §6.3 bis (simulation sans trace, étape posée directement, fil « par
//           import », doublon de titre, refus de qui n'écrit pas le channel, journal de l'import confirmé) ; CLAUDE.md §10
//
// Les affaires de la preuve portent le préfixe `ZZ 071` et sont retirées à la fin, par la clé de service.

import { expect, test } from '@playwright/test'
import { URL_API, enTetesAnonymes, enTetesAuthentifies, enTetesService, jetonDe } from './jetons'

const REFONTE = '5eed0000-0000-4000-8000-000000000034'
const DRISS = '5eed0000-0000-4000-8000-000000000012'
const rpc = `${URL_API}/rest/v1/rpc/import_cards`
const json = (jeton: string) => ({ ...enTetesAuthentifies(jeton), 'Content-Type': 'application/json' })
const LIGNES = [
	{ title: 'ZZ 071 Refonte Lumen', step: 'Négociation', owner: 'Driss Lemoine', amount: '8 000', next_action_at: '20/11/2026' },
	{ title: 'zz 071 refonte lumen' },
	{ title: 'ZZ 071 Étape inconnue', step: 'Nulle part' },
]
const ZZ = `title=like.${encodeURIComponent('ZZ 071*')}`

test.describe('l’import des affaires — hors interface (docs/SPEC-vues-import-export.md §6.3)', () => {
	test.afterEach(async ({ request }) => {
		await request.delete(`${URL_API}/rest/v1/cards?${ZZ}`, { headers: enTetesService() })
	})

	test('la simulation juge sans écrire ; l’import confirmé pose l’étape, dit « par import » au fil et se journalise', async ({
		request,
	}) => {
		const driss = await jetonDe('bizdev@p2enjoy.test')
		const avant = new Date().toISOString()
		const simulation = await request.post(rpc, { headers: json(driss), data: { p_channel: REFONTE, p_rows: LIGNES, p_dry_run: true } })
		expect(simulation.status(), await simulation.text()).toBe(200)
		expect(((await simulation.json()) as { outcome: string; code: string | null }[]).map((i) => [i.outcome, i.code])).toEqual([
			['created', null],
			['skipped', 'duplicate_title'],
			['refused', 'unknown_step'],
		])
		const rien = await request.get(`${URL_API}/rest/v1/cards?${ZZ}&select=id`, { headers: enTetesService() })
		expect(await rien.json()).toEqual([])

		const confirme = await request.post(rpc, { headers: json(driss), data: { p_channel: REFONTE, p_rows: LIGNES, p_dry_run: false } })
		expect(confirme.status()).toBe(200)
		const [cree] = (await confirme.json()) as { card_id: string }[]
		const rattachement = await request.get(
			`${URL_API}/rest/v1/card_placements?card_id=eq.${cree!.card_id}&select=owner_id,amount,etape:workflow_steps(noeud:workflow_nodes_catalog(label))`,
			{ headers: enTetesService() },
		)
		expect(await rattachement.json()).toEqual([{ owner_id: DRISS, amount: 8000, etape: { noeud: { label: 'Négociation' } } }])
		const fil = await request.get(`${URL_API}/rest/v1/card_events?card_id=eq.${cree!.card_id}&select=type,actor_id,payload->>source`, {
			headers: enTetesService(),
		})
		expect(await fil.json()).toEqual([{ type: 'created', actor_id: DRISS, source: 'import' }])
		const journal = await request.get(
			`${URL_API}/rest/v1/audit_log?actor_id=eq.${DRISS}&family=eq.import&entity_type=eq.card&occurred_at=gte.${encodeURIComponent(avant)}&select=details`,
			{ headers: enTetesService() },
		)
		expect(await journal.json()).toEqual([{ details: { created: 1, skipped: 1, refused: 1, channel_id: REFONTE } }])
	})

	test('la lectrice est refusée ligne par ligne ; un channel inconnu n’existe pas ; l’anonyme ne l’appelle pas', async ({
		request,
	}) => {
		const farida = await jetonDe('viewer@p2enjoy.test')
		const refus = await request.post(rpc, {
			headers: json(farida),
			data: { p_channel: REFONTE, p_rows: [{ title: 'ZZ 071 Farida' }], p_dry_run: false },
		})
		expect(refus.status()).toBe(200)
		expect(await refus.json()).toMatchObject([{ outcome: 'refused', code: 'forbidden', card_id: null }])
		const inconnu = await request.post(rpc, {
			headers: json(farida),
			data: { p_channel: '5eed0000-0000-4000-8000-0000000e7299', p_rows: [], p_dry_run: true },
		})
		// Le refus se lit à son message, comme celui de l'export (`e2e/api/export-csv.spec.ts`) : PostgREST rend `P0002` en 500.
		expect(inconnu.ok()).toBe(false)
		expect(((await inconnu.json()) as { message: string }).message).toBe('channel_not_found')
		const anonyme = await request.post(rpc, {
			headers: { ...enTetesAnonymes(), 'Content-Type': 'application/json' },
			data: { p_channel: REFONTE, p_rows: [], p_dry_run: true },
		})
		expect(anonyme.status()).toBe(401)
		const ecrits = await request.get(`${URL_API}/rest/v1/cards?${ZZ}&select=id`, { headers: enTetesService() })
		expect(await ecrits.json()).toEqual([])
	})
})
