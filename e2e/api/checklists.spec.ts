// @verifies CRM-068 (docs/BACKLOG.md) — tranches T1 et T2 : le modèle des checklists et l'exigence de transition, hors interface
// @verifies docs/SPEC-checklists.md §3.1 (les points d'une étape, réservés à l'administrateur), §3.2 (cocher : la base pose
//           l'heure et l'auteur, fermés au client ; un point d'étape ne se retire pas), §3.3 (l'ajout à l'entrée dans
//           l'étape), §3.6 (le fil trace le cochage), §3.4 (`move_card` refuse `checklist_incomplete` avec les points
//           manquants, puis passe une fois cochés) ; CLAUDE.md §10 ; docs/JOURNAL.md décisions 747 à 749
//
// AVEC LES VRAIS JETONS. Le point d'étape est posé par l'administratrice, l'affaire créée par la vraie fonction
// `creer_affaire` ; les deux sont retirés à la fin, par la clé de service.

import { expect, test } from '@playwright/test'
import { URL_API, enTetesAnonymes, enTetesAuthentifies, enTetesService, jetonDe } from './jetons'

const ESPACE = '5eed0000-0000-4000-8000-000000000001'
const WORKFLOW = '5eed0000-0000-4000-8000-000000000051'
const PROSPECTION = '5eed0000-0000-4000-8000-000000000061'
const CHANNEL = '5eed0000-0000-4000-8000-000000000036'
const POINT_ETAPE = 'c0680000-0000-4000-8000-0000000000e1'
const LIBELLE = 'ZZ point de prospection'

const json = (jeton: string) => ({ ...enTetesAuthentifies(jeton), 'Content-Type': 'application/json' })
const representation = (jeton: string) => ({ ...json(jeton), Prefer: 'return=representation' })

test.describe('les checklists — hors interface (docs/SPEC-checklists.md §3)', () => {
	let carte = ''

	test.beforeAll(async ({ request }) => {
		await request.delete(`${URL_API}/rest/v1/workflow_step_checklist_items?id=eq.${POINT_ETAPE}`, { headers: enTetesService() })
		const point = await request.post(`${URL_API}/rest/v1/workflow_step_checklist_items`, {
			headers: representation(await jetonDe('admin@p2enjoy.test')),
			data: { id: POINT_ETAPE, workspace_id: ESPACE, workflow_id: WORKFLOW, step_id: PROSPECTION, label: LIBELLE, position: 99 },
		})
		expect(point.status(), await point.text()).toBe(201)
		const creation = await request.post(`${URL_API}/rest/v1/rpc/creer_affaire`, {
			headers: json(await jetonDe('admin@p2enjoy.test')),
			data: { p_channel: CHANNEL, p_titre: 'ZZ affaire à checklist' },
		})
		expect(creation.status(), await creation.text()).toBe(200)
		carte = (await creation.json()) as string
	})

	test.afterAll(async ({ request }) => {
		await request.delete(`${URL_API}/rest/v1/cards?id=eq.${carte}`, { headers: enTetesService() })
		await request.delete(`${URL_API}/rest/v1/workflow_step_checklist_items?id=eq.${POINT_ETAPE}`, { headers: enTetesService() })
	})

	const pointDeLaCarte = (jeton: string, filtre = `step_item_id=eq.${POINT_ETAPE}`) =>
		`${URL_API}/rest/v1/card_checklist_items?card_id=eq.${carte}&${filtre}&select=id,label,checked,checked_at,checked_by`

	test('l’affaire née en prospection porte le point de l’étape ; le business developer le coche, la base date et signe', async ({
		request,
	}) => {
		const jeton = await jetonDe('bizdev@p2enjoy.test')
		const lus = await request.get(pointDeLaCarte(jeton), { headers: enTetesAuthentifies(jeton) })
		expect((await lus.json()) as { label: string; checked: boolean }[]).toMatchObject([{ label: LIBELLE, checked: false }])

		const coche = await request.patch(pointDeLaCarte(jeton), { headers: representation(jeton), data: { checked: true } })
		expect(coche.status(), await coche.text()).toBe(200)
		const [ligne] = (await coche.json()) as { checked: boolean; checked_at: string | null; checked_by: string | null }[]
		expect(ligne?.checked).toBe(true)
		expect(ligne?.checked_at).not.toBeNull()
		expect(ligne?.checked_by).toBe('5eed0000-0000-4000-8000-000000000012')

		const fil = await request.get(
			`${URL_API}/rest/v1/card_events?card_id=eq.${carte}&type=eq.checklist_checked&select=actor_id,payload`,
			{ headers: enTetesService() },
		)
		expect(await fil.json()).toMatchObject([{ actor_id: '5eed0000-0000-4000-8000-000000000012', payload: { label: LIBELLE } }])
	})

	test('l’heure d’un cochage est fermée au client, et un point d’étape ne se retire pas', async ({ request }) => {
		const jeton = await jetonDe('bizdev@p2enjoy.test')
		const heure = await request.patch(pointDeLaCarte(jeton), {
			headers: representation(jeton),
			data: { checked_at: '2020-01-01T00:00:00Z' },
		})
		expect(heure.status()).toBe(403)
		const retrait = await request.delete(pointDeLaCarte(jeton), { headers: representation(jeton) })
		expect(retrait.status()).toBe(200)
		expect(await retrait.json()).toEqual([])
		const relu = await request.get(pointDeLaCarte(jeton), { headers: enTetesAuthentifies(jeton) })
		expect(await relu.json()).toHaveLength(1)
	})

	test('un point libre s’ajoute par qui écrit l’affaire ; la lectrice lit, et ne coche ni n’ajoute rien', async ({
		request,
	}) => {
		const driss = await jetonDe('bizdev@p2enjoy.test')
		const ajout = await request.post(`${URL_API}/rest/v1/card_checklist_items`, {
			headers: representation(driss),
			data: { workspace_id: ESPACE, card_id: carte, label: 'ZZ point libre', position: 1 },
		})
		expect(ajout.status(), await ajout.text()).toBe(201)

		const farida = await jetonDe('viewer@p2enjoy.test')
		const lus = await request.get(pointDeLaCarte(farida, 'label=like.ZZ*'), { headers: enTetesAuthentifies(farida) })
		expect(await lus.json(), 'témoin : la lectrice lit les deux points').toHaveLength(2)
		const coche = await request.patch(pointDeLaCarte(farida, 'label=eq.ZZ point libre'), {
			headers: representation(farida),
			data: { checked: true },
		})
		expect(coche.status()).toBe(200)
		expect(await coche.json(), 'rien n’est coché').toEqual([])
		const refus = await request.post(`${URL_API}/rest/v1/card_checklist_items`, {
			headers: representation(farida),
			data: { workspace_id: ESPACE, card_id: carte, label: 'ZZ interdit' },
		})
		expect(refus.status()).toBe(403)
	})

	test('les points d’une étape sont réservés à l’administratrice ; l’anonyme ne lit rien', async ({ request }) => {
		const refus = await request.post(`${URL_API}/rest/v1/workflow_step_checklist_items`, {
			headers: representation(await jetonDe('bizdev@p2enjoy.test')),
			data: { workspace_id: ESPACE, workflow_id: WORKFLOW, step_id: PROSPECTION, label: 'ZZ interdit' },
		})
		expect(refus.status()).toBe(403)
		const anonyme = await request.get(`${URL_API}/rest/v1/card_checklist_items?select=id&card_id=eq.${carte}`, {
			headers: enTetesAnonymes(),
		})
		expect([200, 401]).toContain(anonyme.status())
		if (anonyme.status() === 200) expect(await anonyme.json()).toEqual([])
	})

	test('T2 — une transition qui exige le point refuse le déplacement, puis le laisse passer une fois coché', async ({
		request,
	}) => {
		const service = { ...enTetesService(), 'Content-Type': 'application/json' }
		const exigence = await request.post(`${URL_API}/rest/v1/workflow_transition_required_checklist_items`, {
			headers: representation(await jetonDe('admin@p2enjoy.test')),
			data: { transition_id: '5eed0000-0000-4000-8000-000000000071', step_item_id: POINT_ETAPE },
		})
		expect(exigence.status(), await exigence.text()).toBe(201)
		try {
			const rattachement = await request.get(`${URL_API}/rest/v1/card_placements?card_id=eq.${carte}&select=id`, {
				headers: service,
			})
			const [{ id }] = (await rattachement.json()) as { id: string }[]
			const driss = await jetonDe('bizdev@p2enjoy.test')
			// Le point peut avoir été coché par un scénario précédent : il est décoché d'abord, par Driss.
			await request.patch(pointDeLaCarte(driss), { headers: representation(driss), data: { checked: false } })
			const deplacer = () =>
				request.post(`${URL_API}/rest/v1/rpc/move_card`, {
					headers: json(driss),
					data: { p_placement: id, to_step_id: '5eed0000-0000-4000-8000-000000000062', comment: null },
				})
			const refus = await deplacer()
			expect(refus.status()).toBe(400)
			const corps = (await refus.json()) as { message: string; details: string }
			expect(corps.message).toBe('checklist_incomplete')
			expect(JSON.parse(corps.details)).toEqual([LIBELLE])

			await request.patch(pointDeLaCarte(driss), { headers: representation(driss), data: { checked: true } })
			const accord = await deplacer()
			expect(accord.status(), await accord.text()).toBe(200)
		} finally {
			await request.delete(
				`${URL_API}/rest/v1/workflow_transition_required_checklist_items?step_item_id=eq.${POINT_ETAPE}`,
				{ headers: enTetesService() },
			)
		}
	})
})
