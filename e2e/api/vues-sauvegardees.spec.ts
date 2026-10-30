// @verifies CRM-071 (docs/BACKLOG.md) — tranche T1 : les vues sauvegardées, hors interface, avec les vrais jetons
// @verifies docs/SPEC-vues-import-export.md §2.1 (propriétaire et espace posés par la base, nom unique), §2.2 (filtres aux
//           clés fermées), §2.3 (vue privée lue par sa seule propriétaire, publication réservée à l'administrateur) ;
//           CLAUDE.md §10 (refus par requête directe)
//
// Les vues de la preuve portent le préfixe `ZZ 071` et sont retirées à la fin, par la clé de service.

import { expect, test } from '@playwright/test'
import { URL_API, enTetesAnonymes, enTetesAuthentifies, enTetesService, jetonDe } from './jetons'

const ESPACE = '5eed0000-0000-4000-8000-000000000001'
const REFONTE = '5eed0000-0000-4000-8000-000000000034'
const GRANDS_COMPTES = '5eed0000-0000-4000-8000-000000000032'
const DRISS = '5eed0000-0000-4000-8000-000000000012'
const PREFIXE = 'ZZ 071'

const json = (jeton: string) => ({ ...enTetesAuthentifies(jeton), 'Content-Type': 'application/json' })
const representation = (jeton: string) => ({ ...json(jeton), Prefer: 'return=representation' })
const vues = `${URL_API}/rest/v1/saved_views`

test.describe('les vues sauvegardées — hors interface (docs/SPEC-vues-import-export.md §2)', () => {
	test.afterEach(async ({ request }) => {
		await request.delete(`${vues}?name=like.${encodeURIComponent(`${PREFIXE}*`)}`, { headers: enTetesService() })
	})

	test('une vue privée : la base pose sa propriétaire et son espace, et nul autre ne la lit ni ne l’écrit', async ({ request }) => {
		const driss = await jetonDe('bizdev@p2enjoy.test')
		// Une propriétaire et un espace envoyés par le client sont refusés par le privilège de colonne.
		const usurpee = await request.post(vues, {
			headers: representation(driss),
			data: { channel_id: REFONTE, name: `${PREFIXE} usurpée`, owner_id: '5eed0000-0000-4000-8000-000000000011' },
		})
		expect(usurpee.status()).toBe(403)
		expect(((await usurpee.json()) as { code: string }).code).toBe('42501')

		const pose = await request.post(vues, {
			headers: representation(driss),
			data: { channel_id: REFONTE, name: `${PREFIXE} Mes négociations`, filters: { sort: 'next_action_at', direction: 'asc' } },
		})
		expect(pose.status(), await pose.text()).toBe(201)
		const [vue] = (await pose.json()) as { id: string; owner_id: string; workspace_id: string; visibility: string }[]
		expect(vue).toMatchObject({ owner_id: DRISS, workspace_id: ESPACE, visibility: 'private' })

		const camille = await jetonDe('admin@p2enjoy.test')
		const lue = await request.get(`${vues}?id=eq.${vue!.id}&select=id`, { headers: enTetesAuthentifies(camille) })
		expect(await lue.json()).toEqual([])
		const renommee = await request.patch(`${vues}?id=eq.${vue!.id}`, { headers: representation(camille), data: { name: 'détournée' } })
		expect(renommee.status()).toBe(200)
		expect(await renommee.json()).toEqual([])
		const retiree = await request.delete(`${vues}?id=eq.${vue!.id}`, { headers: representation(camille) })
		expect(await retiree.json()).toEqual([])

		// Une clé inconnue dans les filtres est refusée par la contrainte.
		const page = await request.post(vues, {
			headers: representation(driss),
			data: { channel_id: REFONTE, name: `${PREFIXE} paginée`, filters: { page: 2 } },
		})
		expect(page.status()).toBe(400)
		expect(((await page.json()) as { code: string }).code).toBe('23514')
	})

	test('la publication pour l’espace : l’administratrice publie, le business developer est refusé', async ({ request }) => {
		const driss = await jetonDe('bizdev@p2enjoy.test')
		const refus = await request.post(vues, {
			headers: representation(driss),
			data: { channel_id: REFONTE, name: `${PREFIXE} pour tous`, visibility: 'workspace' },
		})
		expect(refus.status()).toBe(403)

		const camille = await jetonDe('admin@p2enjoy.test')
		const publiee = await request.post(vues, {
			headers: representation(camille),
			data: { channel_id: GRANDS_COMPTES, name: `${PREFIXE} Revue du lundi`, visibility: 'workspace' },
		})
		expect(publiee.status(), await publiee.text()).toBe(201)
		const [vue] = (await publiee.json()) as { id: string }[]

		const lueParDriss = await request.get(`${vues}?id=eq.${vue!.id}&select=name`, { headers: enTetesAuthentifies(driss) })
		expect(await lueParDriss.json()).toEqual([{ name: `${PREFIXE} Revue du lundi` }])
		// La lectrice, fermée sur « Conseil & IA », ne lit pas une vue d'un channel qu'elle ne lit pas.
		const farida = await jetonDe('viewer@p2enjoy.test')
		const lueParFarida = await request.get(`${vues}?id=eq.${vue!.id}&select=name`, { headers: enTetesAuthentifies(farida) })
		expect(await lueParFarida.json()).toEqual([])

		const retireeParDriss = await request.delete(`${vues}?id=eq.${vue!.id}`, { headers: representation(driss) })
		expect(await retireeParDriss.json()).toEqual([])
		const depubliee = await request.patch(`${vues}?id=eq.${vue!.id}`, { headers: json(camille), data: { visibility: 'private' } })
		expect(depubliee.status()).toBe(400)
		expect(((await depubliee.json()) as { message: string }).message).toBe('saved_view_cannot_be_unpublished')
	})

	test('l’anonyme ne lit ni n’écrit les vues', async ({ request }) => {
		const lecture = await request.get(`${vues}?select=id`, { headers: enTetesAnonymes() })
		expect(lecture.status()).toBe(401)
		const pose = await request.post(vues, {
			headers: { ...enTetesAnonymes(), 'Content-Type': 'application/json' },
			data: { channel_id: REFONTE, name: `${PREFIXE} anonyme` },
		})
		expect(pose.status()).toBe(401)
	})
})
