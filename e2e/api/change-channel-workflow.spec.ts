// @verifies CRM-019 (docs/BACKLOG.md) — changement du workflow d'un channel hors interface
// @verifies docs/SPEC-change-channel-workflow.md §1 à §8
// @verifies docs/SPEC-cards.md §14.4 et §14.6 — workflow_changed exclusif
// @verifies docs/SPEC-permissions-rls.md §7 — vrais JWT et refus hors interface
// @verifies CLAUDE.md §8 et §10 — aucune trace fabriquée, backend réellement opposable

import { expect, test, type APIRequestContext } from '@playwright/test'
import { URL_API, enTetesAnonymes, enTetesAuthentifies, enTetesService, jetonDe } from './jetons'

const RPC = '/rest/v1/rpc/change_channel_workflow'
const CHANNELS = '/rest/v1/channels'
const CARDS = '/rest/v1/cards'
const VALEURS = '/rest/v1/card_field_values'
const COMMENTAIRES = '/rest/v1/card_comments'
const EVENEMENTS = '/rest/v1/card_events'
const WORKFLOWS = '/rest/v1/workflows'

const WORKSPACE = '5eed0000-0000-4000-8000-000000000001'
const TRACK_CONSEIL = '5eed0000-0000-4000-8000-000000000021'
const TRACK_STUDIO = '5eed0000-0000-4000-8000-000000000022'
const WORKFLOW_GLOBAL = '5eed0000-0000-4000-8000-000000000051'
const ETAPE_1 = '5eed0000-0000-4000-8000-000000000061'
const ETAPE_2 = '5eed0000-0000-4000-8000-000000000062'
const CHAMP_BUDGET = '5eed0000-0000-4000-8000-000000000081'
const ADMIN = '5eed0000-0000-4000-8000-000000000011'

const CHANNEL = 'f0190000-0000-4000-8000-000000000010'
const CHANNEL_VIDE = 'f0190000-0000-4000-8000-000000000011'
const WORKFLOW_INCOMPATIBLE = 'f0190000-0000-4000-8000-000000000020'
const CARDS_ESSAI = [
	'f0190000-0000-4000-8000-0000000000a1',
	'f0190000-0000-4000-8000-0000000000a2',
	'f0190000-0000-4000-8000-0000000000a3',
] as const
const COMMENTAIRE = 'f0190000-0000-4000-8000-0000000000c1'

type Refus = { code?: string; message?: string; details?: string }
type CardRendue = {
	id: string
	workflow_id: string
	current_step_id: string
	position: number
	archived_at: string | null
	deleted_at: string | null
	entered_step_at: string
}

test.describe.configure({ mode: 'serial' })

test.describe('CRM-019 — changement atomique du workflow d’un channel', () => {
	let jetonAdmin = ''
	let jetonBizdev = ''
	let jetonViewer = ''
	let workflowDerive = ''
	let etapeDerivee = ''

	const mapping = (): Array<{ from_step_id: string; to_step_id: string }> => [
		{ from_step_id: ETAPE_1, to_step_id: etapeDerivee },
		{ from_step_id: ETAPE_2, to_step_id: etapeDerivee },
	]

	async function supprimerFixtures(request: APIRequestContext): Promise<void> {
		for (const id of CARDS_ESSAI) {
			await request.delete(`${URL_API}${CARDS}?id=eq.${id}`, { headers: enTetesService() })
		}
		for (const id of [CHANNEL, CHANNEL_VIDE]) {
			await request.delete(`${URL_API}${CHANNELS}?id=eq.${id}`, { headers: enTetesService() })
		}
		await request.delete(`${URL_API}${WORKFLOWS}?id=eq.${WORKFLOW_INCOMPATIBLE}`, {
			headers: enTetesService(),
		})
	}

	test.beforeAll(async ({ request }) => {
		jetonAdmin = await jetonDe('admin@p2enjoy.test')
		jetonBizdev = await jetonDe('bizdev@p2enjoy.test')
		jetonViewer = await jetonDe('viewer@p2enjoy.test')

		await supprimerFixtures(request)

		const derive = await request.get(
			`${URL_API}${CHANNELS}?id=eq.5eed0000-0000-4000-8000-000000000031&select=workflow_id`,
			{ headers: enTetesService() },
		)
		workflowDerive = ((await derive.json()) as Array<{ workflow_id: string }>)[0]?.workflow_id ?? ''
		expect(workflowDerive).toBeTruthy()
		expect(workflowDerive).not.toBe(WORKFLOW_GLOBAL)

		const etapes = await request.get(
			`${URL_API}/rest/v1/workflow_steps?workflow_id=eq.${workflowDerive}` +
				'&select=id&order=position.asc&limit=1',
			{ headers: enTetesService() },
		)
		etapeDerivee = ((await etapes.json()) as Array<{ id: string }>)[0]?.id ?? ''
		expect(etapeDerivee).toBeTruthy()

		const incompatible = await request.post(`${URL_API}${WORKFLOWS}`, {
			headers: { ...enTetesService(), Prefer: 'return=minimal' },
			data: {
				id: WORKFLOW_INCOMPATIBLE,
				workspace_id: WORKSPACE,
				name: 'Fixture API CRM-019 incompatible',
				scope: 'track',
				track_id: TRACK_STUDIO,
			},
		})
		expect(incompatible.status(), await incompatible.text()).toBe(201)

		for (const [id, slug] of [
			[CHANNEL, 'fixture-api-crm-019'],
			[CHANNEL_VIDE, 'fixture-api-crm-019-vide'],
		] as const) {
			const creation = await request.post(`${URL_API}${CHANNELS}`, {
				headers: { ...enTetesService(), Prefer: 'return=minimal' },
				data: {
					id,
					workspace_id: WORKSPACE,
					track_id: TRACK_CONSEIL,
					name: `Fixture API CRM-019 ${id.slice(-2)}`,
					slug,
					workflow_id: WORKFLOW_GLOBAL,
					position: 99,
				},
			})
			expect(creation.status(), await creation.text()).toBe(201)
		}

		const creationCards = await request.post(`${URL_API}${CARDS}`, {
			headers: { ...enTetesService(), Prefer: 'return=minimal' },
			data: [
				{
					id: CARDS_ESSAI[0], workspace_id: WORKSPACE, channel_id: CHANNEL,
					workflow_id: WORKFLOW_GLOBAL, current_step_id: ETAPE_1,
					title: 'Fixture API CRM-019 active', position: 4,
					entered_step_at: '2020-01-01T00:00:00Z', archived_at: null, deleted_at: null,
					created_by: ADMIN,
				},
				{
					id: CARDS_ESSAI[1], workspace_id: WORKSPACE, channel_id: CHANNEL,
					workflow_id: WORKFLOW_GLOBAL, current_step_id: ETAPE_2,
					title: 'Fixture API CRM-019 archivée', position: 2,
					entered_step_at: '2020-01-01T00:00:00Z', archived_at: '2026-01-01T00:00:00Z',
					deleted_at: null, created_by: ADMIN,
				},
				{
					id: CARDS_ESSAI[2], workspace_id: WORKSPACE, channel_id: CHANNEL,
					workflow_id: WORKFLOW_GLOBAL, current_step_id: ETAPE_2,
					title: 'Fixture API CRM-019 corbeille', position: 1,
					entered_step_at: '2020-01-01T00:00:00Z', deleted_at: '2026-01-01T00:00:00Z',
					archived_at: null, created_by: ADMIN,
				},
			],
		})
		expect(creationCards.status(), await creationCards.text()).toBe(201)

		const valeur = await request.post(`${URL_API}${VALEURS}`, {
			headers: { ...enTetesService(), Prefer: 'return=minimal' },
			data: {
				card_id: CARDS_ESSAI[0], field_id: CHAMP_BUDGET, workflow_id: WORKFLOW_GLOBAL,
				workspace_id: WORKSPACE, value: 4200,
			},
		})
		expect(valeur.status(), await valeur.text()).toBe(201)

		const commentaire = await request.post(`${URL_API}${COMMENTAIRES}`, {
			headers: { ...enTetesService(), Prefer: 'return=minimal' },
			data: {
				id: COMMENTAIRE, card_id: CARDS_ESSAI[0], workspace_id: WORKSPACE,
				author_id: ADMIN, body: 'Commentaire API CRM-019 à conserver',
			},
		})
		expect(commentaire.status(), await commentaire.text()).toBe(201)
	})

	test.afterAll(async ({ request }) => {
		await supprimerFixtures(request)
		for (const id of [...CARDS_ESSAI, CHANNEL, CHANNEL_VIDE, WORKFLOW_INCOMPATIBLE]) {
			const ressource = CARDS_ESSAI.includes(id as (typeof CARDS_ESSAI)[number])
				? CARDS
				: id === WORKFLOW_INCOMPATIBLE ? WORKFLOWS : CHANNELS
			const relecture = await request.get(`${URL_API}${ressource}?id=eq.${id}&select=id`, {
				headers: enTetesService(),
			})
			expect(await relecture.json(), `fixture CRM-019 non nettoyée : ${id}`).toEqual([])
		}
	})

	test('sans jeton, PostgREST refuse EXECUTE avant toute lecture', async ({ request }) => {
		const reponse = await request.post(`${URL_API}${RPC}`, {
			headers: enTetesAnonymes(),
			data: { channel_id: CHANNEL, workflow_id: workflowDerive, step_mapping: mapping() },
		})
		expect(reponse.status()).toBe(401)
		expect(((await reponse.json()) as Refus).code).toBe('42501')
	})

	test('un channel caché au viewer rend channel_not_found, jamais forbidden', async ({ request }) => {
		const reponse = await request.post(`${URL_API}${RPC}`, {
			headers: enTetesAuthentifies(jetonViewer),
			data: { channel_id: CHANNEL, workflow_id: workflowDerive, step_mapping: mapping() },
		})
		expect(reponse.status()).toBe(400)
		expect((await reponse.json()) as Refus).toMatchObject({ message: 'channel_not_found' })
	})

	test('un membre visible mais non administrateur reçoit forbidden en 403', async ({ request }) => {
		const reponse = await request.post(`${URL_API}${RPC}`, {
			headers: enTetesAuthentifies(jetonBizdev),
			data: {
				channel_id: '5eed0000-0000-4000-8000-000000000036',
				workflow_id: workflowDerive,
				step_mapping: [],
			},
		})
		expect(reponse.status()).toBe(403)
		expect((await reponse.json()) as Refus).toMatchObject({ code: '42501', message: 'forbidden' })
	})

	test('un channel puis un workflow inexistants ont deux refus discrets', async ({ request }) => {
		const channel = await request.post(`${URL_API}${RPC}`, {
			headers: enTetesAuthentifies(jetonAdmin),
			data: {
				channel_id: '00000000-0000-4000-8000-00000000dead',
				workflow_id: workflowDerive,
				step_mapping: [],
			},
		})
		expect(channel.status()).toBe(400)
		expect((await channel.json()) as Refus).toMatchObject({ message: 'channel_not_found' })

		const workflow = await request.post(`${URL_API}${RPC}`, {
			headers: enTetesAuthentifies(jetonAdmin),
			data: {
				channel_id: CHANNEL,
				workflow_id: '00000000-0000-4000-8000-00000000dead',
				step_mapping: [],
			},
		})
		expect(workflow.status()).toBe(400)
		expect((await workflow.json()) as Refus).toMatchObject({ message: 'workflow_not_found' })
	})

	test('un workflow de portée track étrangère est incompatible', async ({ request }) => {
		const reponse = await request.post(`${URL_API}${RPC}`, {
			headers: enTetesAuthentifies(jetonAdmin),
			data: { channel_id: CHANNEL, workflow_id: WORKFLOW_INCOMPATIBLE, step_mapping: [] },
		})
		expect(reponse.status()).toBe(400)
		expect((await reponse.json()) as Refus).toMatchObject({
			code: '23514', message: 'workflow_not_compatible',
		})
	})

	test('le workflow courant est refusé comme non-geste', async ({ request }) => {
		const reponse = await request.post(`${URL_API}${RPC}`, {
			headers: enTetesAuthentifies(jetonAdmin),
			data: { channel_id: CHANNEL, workflow_id: WORKFLOW_GLOBAL, step_mapping: [] },
		})
		expect(reponse.status()).toBe(400)
		expect((await reponse.json()) as Refus).toMatchObject({ message: 'same_workflow' })
	})

	test('les formes JSON mal définies sont refusées avant toute écriture', async ({ request }) => {
		for (const step_mapping of [
			{},
			[{ from_step_id: 'pas-un-uuid', to_step_id: etapeDerivee }],
			[{ from_step_id: ETAPE_1, to_step_id: etapeDerivee, extra: true }],
		]) {
			const reponse = await request.post(`${URL_API}${RPC}`, {
				headers: enTetesAuthentifies(jetonAdmin),
				data: { channel_id: CHANNEL, workflow_id: workflowDerive, step_mapping },
			})
			expect(reponse.status()).toBe(400)
			expect((await reponse.json()) as Refus).toMatchObject({ message: 'invalid_step_mapping' })
		}
	})

	test('un doublon de source reste détectable et refuse tout le lot', async ({ request }) => {
		const valide = mapping()
		const reponse = await request.post(`${URL_API}${RPC}`, {
			headers: enTetesAuthentifies(jetonAdmin),
			data: { channel_id: CHANNEL, workflow_id: workflowDerive, step_mapping: [...valide, valide[0]!] },
		})
		expect(reponse.status()).toBe(400)
		expect((await reponse.json()) as Refus).toMatchObject({ message: 'step_mapping_duplicate' })
	})

	test('mapping manquant puis supplémentaire : exhaustivité exacte dans les deux sens', async ({ request }) => {
		for (const step_mapping of [
			[mapping()[0]],
			[
				...mapping(),
				{ from_step_id: '5eed0000-0000-4000-8000-000000000063', to_step_id: etapeDerivee },
			],
		]) {
			const reponse = await request.post(`${URL_API}${RPC}`, {
				headers: enTetesAuthentifies(jetonAdmin),
				data: { channel_id: CHANNEL, workflow_id: workflowDerive, step_mapping },
			})
			expect(reponse.status()).toBe(400)
			expect((await reponse.json()) as Refus).toMatchObject({ message: 'step_mapping_incomplete' })
		}
	})

	test('une cible étrangère au nouveau workflow est refusée', async ({ request }) => {
		const step_mapping = mapping()
		step_mapping[0] = { ...step_mapping[0]!, to_step_id: '00000000-0000-4000-8000-00000000dead' }
		const reponse = await request.post(`${URL_API}${RPC}`, {
			headers: enTetesAuthentifies(jetonAdmin),
			data: { channel_id: CHANNEL, workflow_id: workflowDerive, step_mapping },
		})
		expect(reponse.status()).toBe(400)
		expect((await reponse.json()) as Refus).toMatchObject({ message: 'step_not_in_workflow' })
	})

	test('la perte refusée est chiffrée et le lot reste strictement inchangé', async ({ request }) => {
		const reponse = await request.post(`${URL_API}${RPC}`, {
			headers: enTetesAuthentifies(jetonAdmin),
			data: { channel_id: CHANNEL, workflow_id: workflowDerive, step_mapping: mapping() },
		})
		expect(reponse.status()).toBe(400)
		expect((await reponse.json()) as Refus).toMatchObject({
			message: 'field_values_would_be_lost',
			details: '1 réponse(s) de formulaire seraient perdues.',
		})

		const cards = await request.get(
			`${URL_API}${CARDS}?channel_id=eq.${CHANNEL}&select=id,workflow_id,current_step_id&order=id`,
			{ headers: enTetesService() },
		)
		const lignes = (await cards.json()) as Array<{ workflow_id: string }>
		expect(lignes).toHaveLength(3)
		for (const card of lignes) {
			expect(card.workflow_id).toBe(WORKFLOW_GLOBAL)
		}
		const valeurs = await request.get(`${URL_API}${VALEURS}?card_id=eq.${CARDS_ESSAI[0]}&select=card_id`, {
			headers: enTetesService(),
		})
		expect((await valeurs.json()) as unknown[]).toHaveLength(1)
	})

	test('succès réel : toutes les cards, rangs, perte consentie, commentaire et timeline exacte', async ({ request }) => {
		const reponse = await request.post(`${URL_API}${RPC}`, {
			headers: enTetesAuthentifies(jetonAdmin),
			data: {
				channel_id: CHANNEL,
				workflow_id: workflowDerive,
				step_mapping: mapping(),
				discard_field_values: true,
			},
		})
		expect(reponse.status(), await reponse.text()).toBe(200)
		const cards = (await reponse.json()) as CardRendue[]
		expect(cards).toHaveLength(3)
		for (const card of cards) {
			expect(card.workflow_id).toBe(workflowDerive)
			expect(card.current_step_id).toBe(etapeDerivee)
			expect(new Date(card.entered_step_at).getTime()).toBeGreaterThan(
				new Date('2020-01-01T00:00:00Z').getTime(),
			)
		}
		expect(Object.fromEntries(cards.map((card) => [card.id, Number(card.position)]))).toEqual({
			[CARDS_ESSAI[0]]: 1,
			[CARDS_ESSAI[1]]: 3,
			[CARDS_ESSAI[2]]: 2,
		})
		expect(cards.find((card) => card.id === CARDS_ESSAI[1])?.archived_at).not.toBeNull()
		expect(cards.find((card) => card.id === CARDS_ESSAI[2])?.deleted_at).not.toBeNull()

		const valeurs = await request.get(`${URL_API}${VALEURS}?card_id=eq.${CARDS_ESSAI[0]}&select=card_id`, {
			headers: enTetesService(),
		})
		expect(await valeurs.json()).toEqual([])
		const commentaire = await request.get(`${URL_API}${COMMENTAIRES}?id=eq.${COMMENTAIRE}&select=id`, {
			headers: enTetesService(),
		})
		expect((await commentaire.json()) as unknown[]).toHaveLength(1)

		const evenements = await request.get(
			`${URL_API}${EVENEMENTS}?card_id=in.(${CARDS_ESSAI.join(',')})` +
				'&type=in.(workflow_changed,moved)&select=card_id,type,actor_id,payload',
			{ headers: enTetesService() },
		)
		const lignes = (await evenements.json()) as Array<{
			card_id: string
			type: string
			actor_id: string | null
			payload: Record<string, string>
		}>
		expect(lignes).toHaveLength(3)
		expect(lignes.every((ligne) => ligne.type === 'workflow_changed')).toBe(true)
		expect(lignes.every((ligne) => ligne.actor_id === ADMIN)).toBe(true)
		for (const ligne of lignes) {
			expect(ligne.payload).toMatchObject({
				channel_id: CHANNEL,
				from_workflow_id: WORKFLOW_GLOBAL,
				to_workflow_id: workflowDerive,
				to_step_id: etapeDerivee,
			})
		}
	})

	test('le même workflow est refusé après succès et n’écrit aucune seconde trace', async ({ request }) => {
		const avant = await request.get(
			`${URL_API}${EVENEMENTS}?card_id=in.(${CARDS_ESSAI.join(',')})&type=eq.workflow_changed&select=id`,
			{ headers: enTetesService() },
		)
		const reponse = await request.post(`${URL_API}${RPC}`, {
			headers: enTetesAuthentifies(jetonAdmin),
			data: { channel_id: CHANNEL, workflow_id: workflowDerive, step_mapping: mapping() },
		})
		expect(reponse.status()).toBe(400)
		expect((await reponse.json()) as Refus).toMatchObject({ message: 'same_workflow' })
		const apres = await request.get(
			`${URL_API}${EVENEMENTS}?card_id=in.(${CARDS_ESSAI.join(',')})&type=eq.workflow_changed&select=id`,
			{ headers: enTetesService() },
		)
		expect(await apres.json()).toEqual(await avant.json())
	})

	test('un channel vide accepte uniquement [] et change réellement dans les deux sens', async ({ request }) => {
		for (const workflow_id of [workflowDerive, WORKFLOW_GLOBAL]) {
			const reponse = await request.post(`${URL_API}${RPC}`, {
				headers: enTetesAuthentifies(jetonAdmin),
				data: { channel_id: CHANNEL_VIDE, workflow_id, step_mapping: [] },
			})
			expect(reponse.status(), await reponse.text()).toBe(200)
			expect(await reponse.json()).toEqual([])
			const channel = await request.get(
				`${URL_API}${CHANNELS}?id=eq.${CHANNEL_VIDE}&select=workflow_id`,
				{ headers: enTetesService() },
			)
			expect((await channel.json()) as Array<{ workflow_id: string }>).toEqual([{ workflow_id }])
		}
	})
})
