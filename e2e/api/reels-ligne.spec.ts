// @verifies CRM-099 (docs/BACKLOG.md) — tranche T2 : les réels d'une ligne de coût et la case « Soldé », prouvés par
//           la route REST avec les jetons réels
// @verifies docs/SPEC-costs.md §2.3 bis (le réel ne s'écrit pas directement ; il est la somme des réels ; soldée sans
//           réel, la ligne vaut zéro ; une ligne soldée est figée ; l'auteur du soldé est celui du jeton), §3 (lecture et
//           écriture : celles de la ligne) ; docs/SCHEMA.md §9 quater « Migration `0088` » ; CLAUDE.md §10
//
// Une ligne de sonde est posée par la clé de service sur une affaire que le commercial écrit et que la lectrice lit,
// puis retirée — ses réels partent avec elle.

import { expect, test, type APIRequestContext } from '@playwright/test'
import { COMPTES_SEED, URL_API, enTetesAuthentifies, enTetesService, jetonDe } from './jetons'

const BIZDEV = COMPTES_SEED[1]
const VIEWER = COMPTES_SEED[2]
const DRISS = '5eed0000-0000-4000-8000-000000000012'
const CAMILLE = '5eed0000-0000-4000-8000-000000000011'
const LIGNE = '5eed0000-0000-4000-8000-0000000009a1'
const COUTS = `${URL_API}/rest/v1/card_costs`
const REELS = `${URL_API}/rest/v1/card_cost_actuals`

const ecrire = (jeton: string) => ({ ...enTetesAuthentifies(jeton), 'Content-Type': 'application/json', Prefer: 'return=representation' })

async function reelDeLaLigne(requete: APIRequestContext): Promise<number | null> {
	const reponse = await requete.get(`${COUTS}?id=eq.${LIGNE}&select=actual_cost`, { headers: enTetesService() })
	const [ligne] = (await reponse.json()) as { actual_cost: number | null }[]
	return ligne?.actual_cost ?? null
}

test.describe('Les réels d’une ligne de coût (docs/SPEC-costs.md §2.3 bis)', () => {
	test.beforeEach(async ({ request }) => {
		await request.delete(`${COUTS}?id=eq.${LIGNE}`, { headers: enTetesService() })
		// « Refonte intranet Ville de Lyon », sur le budget récurrent « Publicité 2026 », occurrence ouverte — le
		// rattachement de la ligne « Publicité » du seed.
		const pose = await request.post(COUTS, {
			headers: { ...enTetesService(), 'Content-Type': 'application/json' },
			data: {
				id: LIGNE,
				card_id: '5eed0000-0000-4000-8000-0000000000c4',
				budget_id: '5eed0000-0000-4000-8000-0000000000c2',
				occurrence_id: '5eed0000-0000-4000-8000-0000000000d2',
				label: 'Sonde 099',
				estimated_cost: 300,
			},
		})
		expect(pose.status(), await pose.text()).toBe(201)
	})

	test.afterEach(async ({ request }) => {
		await request.delete(`${COUTS}?id=eq.${LIGNE}`, { headers: enTetesService() })
		const reste = await request.get(`${REELS}?card_cost_id=eq.${LIGNE}&select=id`, { headers: enTetesService() })
		expect(await reste.json(), 'les réels de la sonde partent avec elle').toEqual([])
	})

	test('le réel d’une ligne ne s’écrit pas directement : 400 « reel derive »', async ({ request }) => {
		const jeton = await jetonDe(BIZDEV.adresse)
		const reponse = await request.patch(`${COUTS}?id=eq.${LIGNE}`, { headers: ecrire(jeton), data: { actual_cost: 999 } })
		expect(reponse.status()).toBe(400)
		const corps = (await reponse.json()) as { code: string; message: string }
		expect([corps.code, corps.message]).toEqual(['23514', 'reel derive'])
		expect(await reelDeLaLigne(request)).toBeNull()
	})

	test('les réels s’ajoutent, se corrigent, se retirent, et la ligne porte leur somme', async ({ request }) => {
		const jeton = await jetonDe(BIZDEV.adresse)
		const premier = await request.post(REELS, { headers: ecrire(jeton), data: { card_cost_id: LIGNE, amount: 120, label: 'Facture 1' } })
		expect(premier.status(), await premier.text()).toBe(201)
		const [reel] = (await premier.json()) as { id: string; created_by: string; spent_on: string }[]
		expect(reel?.created_by).toBe(DRISS)
		await request.post(REELS, { headers: ecrire(jeton), data: { card_cost_id: LIGNE, amount: -20, label: 'Avoir' } })
		expect(await reelDeLaLigne(request)).toBe(100)
		await request.patch(`${REELS}?id=eq.${reel?.id}`, { headers: ecrire(jeton), data: { amount: 150 } })
		expect(await reelDeLaLigne(request)).toBe(130)
		await request.delete(`${REELS}?id=eq.${reel?.id}`, { headers: ecrire(jeton) })
		expect(await reelDeLaLigne(request)).toBe(-20)
	})

	test('« Soldé » : l’auteur est celui du jeton ; soldée, la ligne est figée ; décochée, elle se rouvre', async ({ request }) => {
		const jeton = await jetonDe(BIZDEV.adresse)
		const solde = await request.patch(`${COUTS}?id=eq.${LIGNE}`, {
			headers: ecrire(jeton),
			data: { settled_at: '2000-01-01T00:00:00Z', settled_by: CAMILLE },
		})
		expect(solde.status(), await solde.text()).toBe(200)
		const [ligne] = (await solde.json()) as { settled_by: string; settled_at: string; actual_cost: number | null }[]
		expect(ligne?.settled_by).toBe(DRISS)
		expect(Date.parse(ligne?.settled_at ?? '')).toBeGreaterThan(Date.now() - 600_000)
		expect(ligne?.actual_cost).toBe(0)

		const figee = await request.post(REELS, { headers: ecrire(jeton), data: { card_cost_id: LIGNE, amount: 10 } })
		expect(figee.status()).toBe(400)
		expect(((await figee.json()) as { message: string }).message).toBe('ligne soldee')

		await request.patch(`${COUTS}?id=eq.${LIGNE}`, { headers: ecrire(jeton), data: { settled_at: null } })
		expect(await reelDeLaLigne(request)).toBeNull()
		const rouverte = await request.post(REELS, { headers: ecrire(jeton), data: { card_cost_id: LIGNE, amount: 10 } })
		expect(rouverte.status()).toBe(201)
	})

	test('la lectrice lit les réels d’une ligne qu’elle lit, et n’en saisit aucun : 403 / 42501', async ({ request }) => {
		await request.post(REELS, { headers: { ...enTetesService(), 'Content-Type': 'application/json' }, data: { card_cost_id: LIGNE, amount: 50 } })
		const jeton = await jetonDe(VIEWER.adresse)
		const lus = await request.get(`${REELS}?card_cost_id=eq.${LIGNE}&select=amount`, { headers: enTetesAuthentifies(jeton) })
		expect(await lus.json()).toEqual([{ amount: 50 }])
		const refus = await request.post(REELS, { headers: ecrire(jeton), data: { card_cost_id: LIGNE, amount: 1 } })
		expect(refus.status()).toBe(403)
		expect(((await refus.json()) as { code: string }).code).toBe('42501')
		const soldeRefuse = await request.patch(`${COUTS}?id=eq.${LIGNE}`, { headers: ecrire(jeton), data: { settled_at: '2026-10-11T00:00:00Z' } })
		expect(await soldeRefuse.json()).toEqual([])
	})
})
