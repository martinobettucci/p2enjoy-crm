// @verifies CRM-072 (docs/BACKLOG.md) — tranche T1 : le journal d'audit, contrat d'API hors interface
// @verifies docs/SPEC-audit.md §3.2 (seuls les administrateurs lisent), §3.3 (aucune écriture cliente, clé de service
//           comprise), §4.1 (un geste de droits journalisé avec son acteur) ; docs/SPEC-permissions-rls.md §4 (ligne
//           `audit_log`) et preuve de refus n° 8 ; CLAUDE.md §10 ; docs/JOURNAL.md décisions 725 et 726
//
// AVEC LES VRAIS JETONS. Le geste éprouvé est une attente inscrite puis retirée par Camille, par les mêmes appels que
// l'écran des membres : il ne laisse aucun résidu métier, et le journal, en ajout seul, en garde les deux entrées.

import { expect, test } from '@playwright/test'
import { URL_API, enTetesAnonymes, enTetesAuthentifies, enTetesService, jetonDe } from './jetons'

const ESPACE = '5eed0000-0000-4000-8000-000000000001'
const CAMILLE = '5eed0000-0000-4000-8000-000000000011'
const JOURNAL = `${URL_API}/rest/v1/audit_log`
const ADRESSE = 'api-journal@p2enjoy.test'

type Entree = {
	id: number
	family: string
	action: string
	entity_type: string
	entity_label: string | null
	details: Record<string, unknown>
	actor: { full_name: string } | null
}

test.describe('le journal d’audit — hors interface (docs/SPEC-audit.md §3)', () => {
	test('un geste de Camille par l’API paraît au journal, avec elle pour actrice, et elle le lit', async ({ request }) => {
		const entetes = { ...enTetesAuthentifies(await jetonDe('admin@p2enjoy.test')), 'Content-Type': 'application/json' }
		const inscription = await request.post(`${URL_API}/rest/v1/rpc/inscrire_attente`, {
			headers: entetes,
			data: { p_ws: ESPACE, p_email: ADRESSE, p_role: 'viewer' },
		})
		expect(inscription.status(), await inscription.text()).toBe(200)
		const retrait = await request.delete(
			`${URL_API}/rest/v1/workspace_invitations?workspace_id=eq.${ESPACE}&email=eq.${ADRESSE}`,
			{ headers: entetes },
		)
		expect(retrait.status(), await retrait.text()).toBe(204)

		const lecture = await request.get(
			`${JOURNAL}?select=id,family,action,entity_type,entity_label,details,actor:profiles(full_name)` +
				`&workspace_id=eq.${ESPACE}&entity_label=eq.${ADRESSE}&order=id.desc&limit=2`,
			{ headers: entetes },
		)
		expect(lecture.status(), await lecture.text()).toBe(200)
		const [retiree, posee] = (await lecture.json()) as Entree[]
		expect(posee).toMatchObject({ family: 'access', action: 'created', entity_type: 'invitation', actor: { full_name: 'Camille Aubert' } })
		expect(posee?.details).toEqual({ email: ADRESSE, role: 'viewer' })
		expect(retiree).toMatchObject({ action: 'removed', entity_type: 'invitation', actor: { full_name: 'Camille Aubert' } })
	})

	for (const compte of ['bizdev@p2enjoy.test', 'viewer@p2enjoy.test']) {
		test(`TÉMOIN puis refus : ${compte} ne lit rien du journal`, async ({ request }) => {
			const temoin = await request.get(`${JOURNAL}?select=id&workspace_id=eq.${ESPACE}&limit=1`, {
				headers: enTetesService(),
			})
			expect((await temoin.json()) as unknown[]).toHaveLength(1)
			const lecture = await request.get(`${JOURNAL}?select=id&workspace_id=eq.${ESPACE}`, {
				headers: enTetesAuthentifies(await jetonDe(compte)),
			})
			expect(lecture.status()).toBe(200)
			expect(await lecture.json()).toEqual([])
		})
	}

	test('personne n’écrit le journal, ni l’administratrice ni la clé de service (refus n° 8)', async ({ request }) => {
		const camille = { ...enTetesAuthentifies(await jetonDe('admin@p2enjoy.test')), 'Content-Type': 'application/json' }
		const service = { ...enTetesService(), 'Content-Type': 'application/json' }
		const entree = {
			workspace_id: ESPACE,
			actor_id: CAMILLE,
			family: 'access',
			action: 'added',
			entity_type: 'member',
			entity_label: 'Inventé',
		}
		for (const entetes of [camille, service]) {
			const insertion = await request.post(JOURNAL, { headers: entetes, data: entree })
			expect(insertion.status(), await insertion.text()).toBe(403)
			expect(((await insertion.json()) as { code: string }).code).toBe('42501')
			const modification = await request.patch(`${JOURNAL}?workspace_id=eq.${ESPACE}`, {
				headers: entetes,
				data: { entity_label: 'Réécrit' },
			})
			expect(modification.status(), await modification.text()).toBe(403)
			const suppression = await request.delete(`${JOURNAL}?workspace_id=eq.${ESPACE}`, { headers: entetes })
			expect(suppression.status(), await suppression.text()).toBe(403)
		}
		const aucune = await request.get(`${JOURNAL}?select=id&entity_label=in.(Inventé,Réécrit)`, { headers: enTetesService() })
		expect(await aucune.json()).toEqual([])
	})

	test('l’anonyme ne lit pas le journal', async ({ request }) => {
		const lecture = await request.get(`${JOURNAL}?select=id&limit=1`, { headers: enTetesAnonymes() })
		expect([401, 403]).toContain(lecture.status())
	})
})
