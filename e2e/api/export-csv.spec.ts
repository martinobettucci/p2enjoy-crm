// @verifies CRM-071 (docs/BACKLOG.md) — tranche T4 : l'export CSV hors interface, avec les vrais jetons
// @verifies docs/SPEC-vues-import-export.md §5.2 (sous la RLS de la personne, journalisé, refus nommés) ; docs/SPEC-audit.md
//           §4.5 ; CLAUDE.md §10 (refus par requête directe)

import { expect, test } from '@playwright/test'
import { URL_API, enTetesAnonymes, enTetesAuthentifies, enTetesService, jetonDe } from './jetons'

const ESPACE = '5eed0000-0000-4000-8000-000000000001'
const REFONTE = '5eed0000-0000-4000-8000-000000000034'
const GRANDS_COMPTES = '5eed0000-0000-4000-8000-000000000032'
const DRISS = '5eed0000-0000-4000-8000-000000000012'
const rpc = (nom: string) => `${URL_API}/rest/v1/rpc/${nom}`
const json = (jeton: string) => ({ ...enTetesAuthentifies(jeton), 'Content-Type': 'application/json' })

test.describe('l’export CSV — hors interface (docs/SPEC-vues-import-export.md §5.2)', () => {
	test('le business developer exporte les affaires d’un channel et le carnet ; chaque export est journalisé', async ({ request }) => {
		const driss = await jetonDe('bizdev@p2enjoy.test')
		const avant = new Date().toISOString()
		const affaires = await request.post(rpc('export_cards'), {
			headers: json(driss),
			data: { p_channel: REFONTE, p_filters: { sort: 'amount' } },
		})
		expect(affaires.status(), await affaires.text()).toBe(200)
		const lignes = (await affaires.json()) as { title: string; amount: number | null }[]
		expect(lignes.length).toBeGreaterThan(0)
		const montants = lignes.map((l) => l.amount).filter((m): m is number => m !== null)
		expect(montants).toEqual([...montants].sort((a, b) => b - a))

		const contacts = await request.post(rpc('export_contacts'), { headers: json(driss), data: { p_workspace: ESPACE } })
		expect(contacts.status(), await contacts.text()).toBe(200)

		const journal = await request.get(
			`${URL_API}/rest/v1/audit_log?actor_id=eq.${DRISS}&family=eq.export&occurred_at=gte.${encodeURIComponent(avant)}&select=entity_type,details&order=id`,
			{ headers: enTetesService() },
		)
		const entrees = (await journal.json()) as { entity_type: string; details: { count: number } }[]
		expect(entrees.map((e) => e.entity_type)).toEqual(['card_list', 'contact_list'])
		expect(entrees[0]!.details.count).toBe(lignes.length)
	})

	test('les refus : un channel illisible, des filtres hors forme, l’anonyme', async ({ request }) => {
		const farida = await jetonDe('viewer@p2enjoy.test')
		const ferme = await request.post(rpc('export_cards'), { headers: json(farida), data: { p_channel: GRANDS_COMPTES } })
		expect(ferme.ok()).toBe(false)
		expect(((await ferme.json()) as { message: string }).message).toBe('channel_not_found')

		const driss = await jetonDe('bizdev@p2enjoy.test')
		const forme = await request.post(rpc('export_cards'), { headers: json(driss), data: { p_channel: REFONTE, p_filters: { page: 2 } } })
		expect(forme.status()).toBe(400)
		expect(((await forme.json()) as { message: string }).message).toBe('invalid_filters')

		const anonyme = await request.post(rpc('export_contacts'), {
			headers: { ...enTetesAnonymes(), 'Content-Type': 'application/json' },
			data: { p_workspace: ESPACE },
		})
		expect(anonyme.status()).toBe(401)
	})
})
