// @verifies CRM-112 (docs/BACKLOG.md) — tranche T2.b : par la vraie route et les vrais jetons, l'administratrice exige un
//           champ commun pour une transition, et le commercial qui déplace une affaire sans ce champ reçoit
//           `missing_required_fields`, sa clé dans le détail
// @verifies docs/SPEC-champs-communs.md §5 ; docs/SPEC-workflow-engine.md §5.3 ; CLAUDE.md §10 (refus par requête directe)
//
// SEUL LE REFUS EST JOUÉ ICI : il ne change rien. Un déplacement réussi écrirait au fil de l'affaire un événement que rien
// ne retire, et salirait le seed ; le passage est prouvé par la pgTAP `0145`, annulée par son `rollback`.
// L'affaire « Audit sécurité applicative » (`…00c3`) et sa transition `…0071` sont du seed, sans autre exigence.

import { expect, test } from '@playwright/test'
import { URL_API, enTetesAuthentifies, enTetesService, jetonDe } from './jetons'

const ESPACE = '5eed0000-0000-4000-8000-000000000001'
const AFFAIRE = '5eed0000-0000-4000-8000-0000000000c3'
const TRANSITION = '5eed0000-0000-4000-8000-000000000071'
const CIBLE = '5eed0000-0000-4000-8000-000000000062'
const CLE = 'tst-crm112-t2-siret'
const REST = `${URL_API}/rest/v1`
const json = (enTetes: Record<string, string>) => ({ ...enTetes, 'Content-Type': 'application/json', Prefer: 'return=representation' })

test.describe('move_card et les champs communs exigés (docs/SPEC-champs-communs.md §5)', () => {
	let champ = ''

	test.beforeAll(async ({ request }) => {
		const camille = await jetonDe('admin@p2enjoy.test')
		const cree = await request.post(`${REST}/card_common_fields`, {
			headers: json(enTetesAuthentifies(camille)),
			data: { workspace_id: ESPACE, key: CLE, label: 'SIRET exigé', type: 'text' },
		})
		expect(cree.status(), await cree.text()).toBe(201)
		champ = ((await cree.json()) as { id: string }[])[0]!.id
		const exige = await request.post(`${REST}/workflow_transition_required_common_fields`, {
			headers: json(enTetesAuthentifies(camille)),
			data: { transition_id: TRANSITION, common_field_id: champ },
		})
		expect(exige.status(), await exige.text()).toBe(201)
	})

	test.afterAll(async ({ request }) => {
		await request.delete(`${REST}/workflow_transition_required_common_fields?common_field_id=eq.${champ}`, { headers: enTetesService() })
		await request.delete(`${REST}/card_common_field_values?field_id=eq.${champ}`, { headers: enTetesService() })
		await request.delete(`${REST}/card_common_fields?key=eq.${CLE}`, { headers: enTetesService() })
	})

	test('le commercial ne déplace pas l’affaire sans le champ commun exigé, et le refus le nomme', async ({ request }) => {
		const driss = await jetonDe('bizdev@p2enjoy.test')
		const lu = await request.get(`${REST}/card_placements?card_id=eq.${AFFAIRE}&archived_at=is.null&select=id,current_step_id`, {
			headers: enTetesAuthentifies(driss),
		})
		const [rattachement] = (await lu.json()) as { id: string; current_step_id: string }[]
		expect(rattachement, 'Driss lit le rattachement de l’affaire').toBeDefined()

		const refus = await request.post(`${REST}/rpc/move_card`, {
			headers: json(enTetesAuthentifies(driss)),
			data: { p_placement: rattachement!.id, to_step_id: CIBLE },
		})
		expect(refus.status()).toBe(400)
		const corps = (await refus.json()) as { message: string; details: string }
		expect(corps.message).toBe('missing_required_fields')
		expect(corps.details).toBe(CLE)

		const relu = await request.get(`${REST}/card_placements?id=eq.${rattachement!.id}&select=current_step_id`, {
			headers: enTetesService(),
		})
		expect(await relu.json(), 'le refus ne déplace rien').toEqual([{ current_step_id: rattachement!.current_step_id }])
	})
})
