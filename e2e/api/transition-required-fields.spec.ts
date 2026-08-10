// @verifies CRM-018 (docs/BACKLOG.md) — table de liaison des champs exigés par une transition
// @verifies docs/SPEC-transition-required-fields.md §2, §4, §5 et §6
// @verifies docs/SPEC-permissions-rls.md §4 et §7
// @verifies CLAUDE.md §10 — les autorisations se prouvent avec de vrais jetons

import { randomUUID } from 'node:crypto'
import { expect, test, type APIRequestContext } from '@playwright/test'
import { enTetesAnonymes, enTetesAuthentifies, enTetesService, jetonDe } from './jetons'

const WORKSPACE = '5eed0000-0000-4000-8000-000000000001'
const WORKFLOW = '5eed0000-0000-4000-8000-000000000051'
const TRANSITION_REALISATION = '5eed0000-0000-4000-8000-000000000074'
const TRANSITION_LIVRE = '5eed0000-0000-4000-8000-000000000075'
const CHAMP_BUDGET = '5eed0000-0000-4000-8000-000000000081'
const CHAMP_LIEN_PROPOSITION = '5eed0000-0000-4000-8000-000000000086'

const LIENS = '/rest/v1/workflow_transition_required_fields'
const CHAMPS = '/rest/v1/form_fields'
const WORKFLOWS = '/rest/v1/workflows'

let jetonAdmin: string
let jetonBizdev: string

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
	jetonAdmin = await jetonDe('admin@p2enjoy.test')
	jetonBizdev = await jetonDe('bizdev@p2enjoy.test')
})

function posterLien(
	requete: APIRequestContext,
	enTetes: Record<string, string>,
	transitionId: string,
	fieldId: string,
) {
	return requete.post(LIENS, {
		headers: { ...enTetes, 'Content-Type': 'application/json', Prefer: 'return=representation' },
		data: { transition_id: transitionId, field_id: fieldId },
	})
}

async function retirerLien(
	requete: APIRequestContext,
	transitionId: string,
	fieldId: string,
): Promise<void> {
	await requete.delete(`${LIENS}?transition_id=eq.${transitionId}&field_id=eq.${fieldId}`, {
		headers: enTetesService(),
	})
}

test.describe('CRM-018 — autorisations et intégrité de la liaison', () => {
	test('un administrateur crée et supprime réellement une exigence du même workflow', async ({
		request,
	}) => {
		await retirerLien(request, TRANSITION_REALISATION, CHAMP_BUDGET)
		try {
			const creation = await posterLien(
				request,
				enTetesAuthentifies(jetonAdmin),
				TRANSITION_REALISATION,
				CHAMP_BUDGET,
			)
			expect(creation.status()).toBe(201)
			expect(await creation.json()).toEqual([
				{ transition_id: TRANSITION_REALISATION, field_id: CHAMP_BUDGET },
			])

			const suppression = await request.delete(
				`${LIENS}?transition_id=eq.${TRANSITION_REALISATION}&field_id=eq.${CHAMP_BUDGET}`,
				{
					headers: {
						...enTetesAuthentifies(jetonAdmin),
						Prefer: 'return=representation',
					},
				},
			)
			expect(suppression.status()).toBe(200)
			expect((await suppression.json()) as unknown[]).toHaveLength(1)
		} finally {
			await retirerLien(request, TRANSITION_REALISATION, CHAMP_BUDGET)
		}
	})

	test('un membre non administrateur lit mais ne crée ni ne supprime aucune liaison', async ({
		request,
	}) => {
		const lecture = await request.get(
			`${LIENS}?transition_id=eq.${TRANSITION_REALISATION}`
			+ `&field_id=eq.${CHAMP_LIEN_PROPOSITION}&select=transition_id,field_id`,
			{ headers: enTetesAuthentifies(jetonBizdev) },
		)
		expect(lecture.status()).toBe(200)
		expect((await lecture.json()) as unknown[]).toHaveLength(1)

		const creation = await posterLien(
			request,
			enTetesAuthentifies(jetonBizdev),
			TRANSITION_REALISATION,
			CHAMP_BUDGET,
		)
		expect(creation.status()).toBe(403)
		expect((await creation.json()) as { code: string }).toMatchObject({ code: '42501' })

		await retirerLien(request, TRANSITION_LIVRE, CHAMP_BUDGET)
		const lienService = await posterLien(
			request,
			enTetesService(),
			TRANSITION_LIVRE,
			CHAMP_BUDGET,
		)
		expect(lienService.status()).toBe(201)
		try {
			const suppression = await request.delete(
				`${LIENS}?transition_id=eq.${TRANSITION_LIVRE}&field_id=eq.${CHAMP_BUDGET}`,
				{
					headers: {
						...enTetesAuthentifies(jetonBizdev),
						Prefer: 'return=representation',
					},
				},
			)
			expect(suppression.status()).toBe(200)
			expect(await suppression.json()).toEqual([])

			const reste = await request.get(
				`${LIENS}?transition_id=eq.${TRANSITION_LIVRE}&field_id=eq.${CHAMP_BUDGET}`,
				{ headers: enTetesService() },
			)
			expect(reste.status()).toBe(200)
			expect((await reste.json()) as unknown[]).toHaveLength(1)
		} finally {
			await retirerLien(request, TRANSITION_LIVRE, CHAMP_BUDGET)
		}
	})

	test('l’anonyme reçoit 200 et zéro ligne sur une table pourtant peuplée', async ({ request }) => {
		const filtre = `transition_id=eq.${TRANSITION_REALISATION}`
			+ `&field_id=eq.${CHAMP_LIEN_PROPOSITION}&select=transition_id`
		const service = await request.get(`${LIENS}?${filtre}`, { headers: enTetesService() })
		expect(service.status()).toBe(200)
		expect((await service.json()) as unknown[]).toHaveLength(1)

		const anonyme = await request.get(`${LIENS}?${filtre}`, {
			headers: enTetesAnonymes(),
		})
		expect(anonyme.status()).toBe(200)
		expect(await anonyme.json()).toEqual([])
	})

	test('un champ d’un autre workflow est refusé en 23514', async ({ request }) => {
		const workflowId = randomUUID()
		const fieldId = randomUUID()
		try {
			const workflow = await request.post(WORKFLOWS, {
				headers: {
					...enTetesService(),
					'Content-Type': 'application/json',
					Prefer: 'return=minimal',
				},
				data: {
					id: workflowId,
					workspace_id: WORKSPACE,
					name: `Sonde CRM-018 ${workflowId}`,
					scope: 'global',
				},
			})
			expect(workflow.status()).toBe(201)

			const champ = await request.post(CHAMPS, {
				headers: {
					...enTetesService(),
					'Content-Type': 'application/json',
					Prefer: 'return=minimal',
				},
				data: {
					id: fieldId,
					workflow_id: workflowId,
					workspace_id: WORKSPACE,
					key: `sonde-${fieldId}`,
					label: 'Sonde CRM-018',
					type: 'text',
					position: 1,
				},
			})
			expect(champ.status()).toBe(201)

			const croisement = await posterLien(
				request,
				enTetesService(),
				TRANSITION_REALISATION,
				fieldId,
			)
			expect(croisement.status()).toBe(400)
			expect((await croisement.json()) as { code: string; message: string }).toMatchObject({
				code: '23514',
				message: 'required_field_workflow_mismatch',
			})
		} finally {
			await request.delete(`${WORKFLOWS}?id=eq.${workflowId}`, { headers: enTetesService() })
		}
	})

	test('la suppression physique d’un champ jetable cascade sans liaison morte', async ({
		request,
	}) => {
		const fieldId = randomUUID()
		try {
			const champ = await request.post(CHAMPS, {
				headers: {
					...enTetesService(),
					'Content-Type': 'application/json',
					Prefer: 'return=minimal',
				},
				data: {
					id: fieldId,
					workflow_id: WORKFLOW,
					workspace_id: WORKSPACE,
					key: `sonde-${fieldId}`,
					label: 'Champ cascade CRM-018',
					type: 'text',
					position: 999,
				},
			})
			expect(champ.status()).toBe(201)

			const lien = await posterLien(request, enTetesService(), TRANSITION_LIVRE, fieldId)
			expect(lien.status()).toBe(201)

			const suppression = await request.delete(`${CHAMPS}?id=eq.${fieldId}`, {
				headers: { ...enTetesService(), Prefer: 'return=representation' },
			})
			expect(suppression.status()).toBe(200)
			expect((await suppression.json()) as unknown[]).toHaveLength(1)

			const reste = await request.get(`${LIENS}?field_id=eq.${fieldId}&select=field_id`, {
				headers: enTetesService(),
			})
			expect(reste.status()).toBe(200)
			expect(await reste.json()).toEqual([])
		} finally {
			await retirerLien(request, TRANSITION_LIVRE, fieldId)
			await request.delete(`${CHAMPS}?id=eq.${fieldId}`, { headers: enTetesService() })
		}
	})
})
