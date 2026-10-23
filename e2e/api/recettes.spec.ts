// @verifies CRM-108 (docs/BACKLOG.md) — tranche T5 : les recettes et la rentabilité, hors interface, avec les jetons réels
// @verifies docs/SPEC-recettes.md §2.3 (la recette réelle ne s'écrit pas directement : 400/23514), §2.4 (la devise
//           d'une affaire qui porte des recettes ne change pas), §3 (la lectrice lit sans écrire ; écrire est celui qui
//           écrit l'affaire), §5 (`rentabilite_affaires` : 200 à l'administratrice, 403/42501 au business developer et à
//           la lectrice), §8 et docs/SPEC-seed.md §21 (le jeu de démonstration)
// @verifies CLAUDE.md §10 (toute règle d'accès se prouve hors interface, avec le jeton réel du profil)
//
// IL POSE SES PROPRES FIXTURES ET LES DÉTRUIT : les lignes du seed §21 sont lues, jamais écrites.

import { expect, test } from '@playwright/test'
import { URL_API, enTetesAuthentifies, enTetesService, jetonDe } from './jetons'

const RECETTES = '/rest/v1/card_revenues'
const REELS = '/rest/v1/card_revenue_actuals'
const RENTABILITE = '/rest/v1/rpc/rentabilite_affaires'
/** « Refonte intranet Ville de Lyon » — la lectrice la LIT, le business developer l'ÉCRIT (docs/SPEC-seed.md). */
const CARD_STUDIO = '5eed0000-0000-4000-8000-0000000000c4'
const LIGNE_SEED_LOT1 = '5eed0000-0000-4000-8000-0000000000f3'

let jetonAdmin = ''
let jetonBizdev = ''
let jetonViewer = ''

test.beforeAll(async () => {
	jetonAdmin = await jetonDe('admin@p2enjoy.test')
	jetonBizdev = await jetonDe('bizdev@p2enjoy.test')
	jetonViewer = await jetonDe('viewer@p2enjoy.test')
})

const json = (jeton: string) => ({ ...enTetesAuthentifies(jeton), 'Content-Type': 'application/json', Prefer: 'return=representation' })

test.describe('la rentabilité est réservée aux administrateurs (§5)', () => {
	test('l’administratrice lit les cinq affaires du seed §21', async ({ request }) => {
		const r = await request.post(`${URL_API}${RENTABILITE}`, { headers: json(jetonAdmin), data: {} })
		expect(r.status()).toBe(200)
		const ids = new Set(((await r.json()) as { card_id: string }[]).map((l) => l.card_id.slice(-3)))
		for (const c of ['0cd', '0c4', '0cc', '0c7', '0cb']) expect(ids.has(c), `affaire …${c}`).toBe(true)
	})

	for (const [profil, jeton] of [['business developer', () => jetonBizdev], ['lectrice', () => jetonViewer]] as const) {
		test(`la ${profil === 'lectrice' ? 'lectrice' : 'demande du ' + profil} est refusée en 403 / 42501`, async ({ request }) => {
			const r = await request.post(`${URL_API}${RENTABILITE}`, { headers: json(jeton()), data: { p_card: CARD_STUDIO } })
			expect(r.status()).toBe(403)
			expect((await r.json()).code).toBe('42501')
		})
	}
})

test.describe('les lignes de recette (§2, §3)', () => {
	test('la lectrice lit une ligne du seed mais n’en crée pas', async ({ request }) => {
		const lue = await request.get(`${URL_API}${RECETTES}?id=eq.${LIGNE_SEED_LOT1}&select=id,actual_amount`, {
			headers: enTetesAuthentifies(jetonViewer),
		})
		expect(lue.status()).toBe(200)
		expect(await lue.json()).toHaveLength(1)
		const creee = await request.post(`${URL_API}${RECETTES}`, {
			headers: json(jetonViewer),
			data: { card_id: CARD_STUDIO, label: 'Lectrice E2E', estimated_amount: 1 },
		})
		expect(creee.status()).toBe(403)
	})

	test('le commercial crée une ligne et un réel ; la recette réelle ne s’écrit pas directement ; la devise est verrouillée', async ({ request }) => {
		const creee = await request.post(`${URL_API}${RECETTES}`, {
			headers: json(jetonBizdev),
			data: { card_id: CARD_STUDIO, label: 'Ligne E2E recettes', estimated_amount: 100 },
		})
		expect(creee.status()).toBe(201)
		const [ligne] = (await creee.json()) as { id: string; actual_amount: number | null }[]
		try {
			expect(ligne!.actual_amount).toBeNull()
			const reel = await request.post(`${URL_API}${REELS}`, { headers: json(jetonBizdev), data: { card_revenue_id: ligne!.id, amount: 40 } })
			expect(reel.status()).toBe(201)
			const relue = await request.get(`${URL_API}${RECETTES}?id=eq.${ligne!.id}&select=actual_amount`, { headers: enTetesAuthentifies(jetonBizdev) })
			expect(((await relue.json()) as { actual_amount: number }[])[0]!.actual_amount).toBe(40)

			const direct = await request.patch(`${URL_API}${RECETTES}?id=eq.${ligne!.id}`, { headers: json(jetonBizdev), data: { actual_amount: 999 } })
			expect(direct.status()).toBe(400)
			expect((await direct.json()).code).toBe('23514')

			const devise = await request.patch(`${URL_API}/rest/v1/cards?id=eq.${CARD_STUDIO}`, { headers: json(jetonAdmin), data: { currency: 'USD' } })
			expect(devise.status()).toBe(400)
			expect((await devise.json()).message).toBe('devise verrouillee par les recettes')
		} finally {
			await request.delete(`${URL_API}${RECETTES}?id=eq.${ligne!.id}`, { headers: enTetesService() })
		}
	})
})
