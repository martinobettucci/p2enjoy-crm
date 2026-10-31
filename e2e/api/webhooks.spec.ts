// @verifies CRM-073 (docs/BACKLOG.md) — tranche T1 : les webhooks sortants hors interface, avec les vrais jetons — la
//           création par l'administratrice et son secret rendu une fois, l'inscription d'une remise par un vrai geste,
//           le renvoi, et les refus du membre, de la lectrice et de l'anonyme
// @verifies docs/SPEC-webhooks.md §3, §4.1, §4.2, §5.1, §5.3, §6 ; docs/JOURNAL.md décision 784 ; CLAUDE.md §10
//
// Les webhooks et l'affaire de la preuve portent le préfixe `tst-crm073` et sont retirés à la fin, par la clé de service
// (les remises partent avec leur webhook). Aucune affaire du seed n'est touchée : son fil ne garde rien de la preuve.

import { expect, test } from '@playwright/test'
import { URL_API, enTetesAnonymes, enTetesAuthentifies, enTetesService, jetonDe } from './jetons'

const ESPACE = '5eed0000-0000-4000-8000-000000000001'
const REFONTE = '5eed0000-0000-4000-8000-000000000034'
const ADMIN = '5eed0000-0000-4000-8000-000000000011'
const DRISS = '5eed0000-0000-4000-8000-000000000012'
const RPC = `${URL_API}/rest/v1/rpc`
const json = (entetes: Record<string, string>) => ({ ...entetes, 'Content-Type': 'application/json' })
const NOUVEAU = {
	p_workspace: ESPACE,
	p_name: 'tst-crm073 Responsables',
	p_url: 'https://recepteur.example/crm',
	p_events: ['card.owner_changed'],
}

// Une affaire jetable de « Refonte de site », créée par le seul chemin d'un utilisateur.
async function affaireJetable(request: import('@playwright/test').APIRequestContext, jeton: string): Promise<string> {
	const reponse = await request.post(`${RPC}/creer_affaire`, {
		headers: json(enTetesAuthentifies(jeton)),
		data: { p_channel: REFONTE, p_titre: 'tst-crm073 Affaire' },
	})
	expect(reponse.status(), await reponse.text()).toBe(200)
	return (await reponse.json()) as string
}

async function changerResponsable(request: import('@playwright/test').APIRequestContext, jeton: string, affaire: string, owner: string) {
	const reponse = await request.patch(`${URL_API}/rest/v1/card_placements?card_id=eq.${affaire}`, {
		headers: json(enTetesAuthentifies(jeton)),
		data: { owner_id: owner },
	})
	expect(reponse.status(), await reponse.text()).toBe(204)
}

test.describe('les webhooks sortants — hors interface (docs/SPEC-webhooks.md §4)', () => {
	test.afterEach(async ({ request }) => {
		await request.delete(`${URL_API}/rest/v1/cards?title=like.${encodeURIComponent('tst-crm073*')}`, { headers: enTetesService() })
		await request.delete(`${URL_API}/rest/v1/webhook_endpoints?name=like.${encodeURIComponent('tst-crm073*')}`, {
			headers: enTetesService(),
		})
	})

	test('l’administratrice crée un webhook, son secret rendu une fois ; un vrai geste inscrit une remise ; le renvoi', async ({
		request,
	}) => {
		const admin = await jetonDe('admin@p2enjoy.test')
		const creation = await request.post(`${RPC}/create_webhook_endpoint`, { headers: json(enTetesAuthentifies(admin)), data: NOUVEAU })
		expect(creation.status(), await creation.text()).toBe(200)
		const [cree] = (await creation.json()) as { id: string; secret: string }[]
		expect(cree!.secret).toMatch(/^whsec_[0-9a-f]{64}$/)

		// Relu par l'administratrice : le webhook, jamais son secret.
		const relu = await request.get(`${URL_API}/rest/v1/webhook_endpoints?id=eq.${cree!.id}`, { headers: enTetesAuthentifies(admin) })
		const lignes = (await relu.json()) as Record<string, unknown>[]
		expect(lignes).toHaveLength(1)
		expect(lignes[0]).toMatchObject({ name: 'tst-crm073 Responsables', enabled: true, events: ['card.owner_changed'] })
		expect(JSON.stringify(lignes[0])).not.toContain(cree!.secret)

		// Un vrai geste : l'administratrice confie à Driss une affaire qu'elle vient de créer, puis la reprend, par l'API.
		const affaire = await affaireJetable(request, admin)
		await changerResponsable(request, admin, affaire, DRISS)
		await changerResponsable(request, admin, affaire, ADMIN)
		const remises = await request.get(`${URL_API}/rest/v1/webhook_deliveries?endpoint_id=eq.${cree!.id}&select=id,event,status,payload&order=created_at.desc&limit=1`, {
			headers: enTetesAuthentifies(admin),
		})
		const [remise] = (await remises.json()) as { id: string; event: string; status: string; payload: { data: Record<string, unknown> } }[]
		expect(remise).toMatchObject({
			event: 'card.owner_changed',
			status: 'pending',
			payload: { data: { card_id: affaire, owner: { id: ADMIN }, from_owner: { id: DRISS, full_name: 'Driss Lemoine' } } },
		})

		// Une remise en attente ne se renvoie pas ; close, elle se renvoie.
		const tropTot = await request.post(`${RPC}/redeliver_webhook`, { headers: json(enTetesAuthentifies(admin)), data: { p_delivery: remise!.id } })
		expect(tropTot.ok()).toBe(false)
		expect(((await tropTot.json()) as { message: string }).message).toBe('delivery_pending')
		await request.post(`${RPC}/claim_webhook_deliveries`, { headers: json(enTetesService()), data: {} })
		const close = await request.post(`${RPC}/record_webhook_attempt`, {
			headers: json(enTetesService()),
			data: { p_delivery: remise!.id, p_status_code: 204 },
		})
		expect(await close.json()).toBe('delivered')
		const renvoi = await request.post(`${RPC}/redeliver_webhook`, { headers: json(enTetesAuthentifies(admin)), data: { p_delivery: remise!.id } })
		expect(renvoi.status(), await renvoi.text()).toBe(200)
		const nouvelle = (await renvoi.json()) as string
		const relue = await request.get(`${URL_API}/rest/v1/webhook_deliveries?id=eq.${nouvelle}&select=status,redelivery_of`, {
			headers: enTetesAuthentifies(admin),
		})
		expect(await relue.json()).toEqual([{ status: 'pending', redelivery_of: remise!.id }])
	})

	test('le membre et la lectrice ne créent, ne lisent ni ne régénèrent rien ; l’anonyme est refusé ; la prise est à la clé de service', async ({
		request,
	}) => {
		const admin = await jetonDe('admin@p2enjoy.test')
		const driss = await jetonDe('bizdev@p2enjoy.test')
		const farida = await jetonDe('viewer@p2enjoy.test')
		const creation = await request.post(`${RPC}/create_webhook_endpoint`, { headers: json(enTetesAuthentifies(admin)), data: NOUVEAU })
		const [cree] = (await creation.json()) as { id: string }[]

		const parDriss = await request.post(`${RPC}/create_webhook_endpoint`, {
			headers: json(enTetesAuthentifies(driss)),
			data: { ...NOUVEAU, p_name: 'tst-crm073 Driss' },
		})
		expect(parDriss.status()).toBe(403)
		expect(((await parDriss.json()) as { message: string }).message).toBe('forbidden')

		for (const jeton of [driss, farida]) {
			const lus = await request.get(`${URL_API}/rest/v1/webhook_endpoints?select=id`, { headers: enTetesAuthentifies(jeton) })
			expect(await lus.json(), 'aucun webhook lisible hors de l’administration').toEqual([])
			const remises = await request.get(`${URL_API}/rest/v1/webhook_deliveries?select=id`, { headers: enTetesAuthentifies(jeton) })
			expect(await remises.json()).toEqual([])
		}

		// Le `USING` filtre : aucune erreur, aucune ligne touchée — la ligne est relue inchangée.
		await request.patch(`${URL_API}/rest/v1/webhook_endpoints?id=eq.${cree!.id}`, {
			headers: json(enTetesAuthentifies(driss)),
			data: { url: 'https://ailleurs.example/vol' },
		})
		const intacte = await request.get(`${URL_API}/rest/v1/webhook_endpoints?id=eq.${cree!.id}&select=url`, { headers: enTetesService() })
		expect(await intacte.json()).toEqual([{ url: 'https://recepteur.example/crm' }])

		const rotation = await request.post(`${RPC}/rotate_webhook_secret`, { headers: json(enTetesAuthentifies(driss)), data: { p_endpoint: cree!.id } })
		expect(rotation.ok()).toBe(false)
		expect(((await rotation.json()) as { message: string }).message).toBe('webhook_not_found')

		const anonyme = await request.post(`${RPC}/create_webhook_endpoint`, { headers: json(enTetesAnonymes()), data: NOUVEAU })
		expect(anonyme.status()).toBe(401)

		const prise = await request.post(`${RPC}/claim_webhook_deliveries`, { headers: json(enTetesAuthentifies(admin)), data: {} })
		expect(prise.status(), 'l’administratrice elle-même ne prend pas les remises : elles portent les secrets').toBe(403)

		const restants = await request.get(`${URL_API}/rest/v1/webhook_endpoints?name=eq.tst-crm073%20Driss&select=id`, {
			headers: enTetesService(),
		})
		expect(await restants.json()).toEqual([])
	})
})
