// @verifies CRM-114 (docs/BACKLOG.md) — tranche T2 : créer et modifier une organisation par la route REST, avec les jetons
//           réels des profils du seed
// @verifies docs/SPEC-organisations.md §3 (le business developer et l'administrateur écrivent, la lectrice non ; domaine
//           déjà pris ; forme du domaine) ; CLAUDE.md §10 (le refus prouvé par une requête directe, hors interface)
//
// Chaque scénario retire, par la clé de service, ce qu'il a créé.

import { expect, test } from '@playwright/test'
import { COMPTES_SEED, URL_API, enTetesAuthentifies, enTetesService, jetonDe } from './jetons'

const [, BIZDEV, VIEWER] = COMPTES_SEED
const ORGANISATIONS = `${URL_API}/rest/v1/organizations`
const ESPACE = '5eed0000-0000-4000-8000-000000000001'
const PREFIXE = 'API CRM-114'

async function entetes(adresse: string) {
	return { ...enTetesAuthentifies(await jetonDe(adresse)), 'Content-Type': 'application/json', Prefer: 'return=representation' }
}

test.afterEach(async ({ request }) => {
	await request.delete(`${ORGANISATIONS}?name=like.${encodeURIComponent(PREFIXE)}*`, { headers: enTetesService() })
})

test.describe('les organisations (docs/SPEC-organisations.md §3)', () => {
	test('le business developer crée puis modifie ; un domaine déjà pris est refusé', async ({ request }) => {
		const h = await entetes(BIZDEV.adresse)
		const creation = await request.post(ORGANISATIONS, {
			headers: h,
			data: { workspace_id: ESPACE, name: `${PREFIXE} Atelier`, domain: 'api-crm-114.example', website: null },
		})
		expect(creation.status(), await creation.text()).toBe(201)
		const [cree] = (await creation.json()) as { id: string }[]
		const modification = await request.patch(`${ORGANISATIONS}?id=eq.${cree?.id}`, {
			headers: h,
			data: { name: `${PREFIXE} Atelier renommé`, website: 'https://api-crm-114.example' },
		})
		expect(((await modification.json()) as { name: string }[])[0]?.name).toBe(`${PREFIXE} Atelier renommé`)
		const doublon = await request.post(ORGANISATIONS, {
			headers: h,
			data: { workspace_id: ESPACE, name: `${PREFIXE} Doublon`, domain: 'api-crm-114.example' },
		})
		expect(doublon.status()).toBe(409)
		expect(((await doublon.json()) as { code: string }).code).toBe('23505')
	})

	test('la forme du domaine est jugée par la base : une majuscule est refusée', async ({ request }) => {
		const refus = await request.post(ORGANISATIONS, {
			headers: await entetes(BIZDEV.adresse),
			data: { workspace_id: ESPACE, name: `${PREFIXE} Forme`, domain: 'Majuscule.example' },
		})
		expect(refus.status()).toBe(400)
		expect(((await refus.json()) as { message: string }).message).toContain('organizations_domain_check')
	})

	test('la lectrice ne crée pas (403) et ne modifie rien (zéro ligne)', async ({ request }) => {
		const h = await entetes(VIEWER.adresse)
		const creation = await request.post(ORGANISATIONS, { headers: h, data: { workspace_id: ESPACE, name: `${PREFIXE} Refusée` } })
		expect(creation.status(), await creation.text()).toBe(403)
		const modification = await request.patch(`${ORGANISATIONS}?id=eq.5eed0000-0000-4000-8000-000000000083`, {
			headers: h,
			data: { name: `${PREFIXE} Réécrite` },
		})
		expect(await modification.json()).toEqual([])
	})
})
