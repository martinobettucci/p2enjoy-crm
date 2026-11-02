// @verifies CRM-112 (docs/BACKLOG.md) — tranche T1 : les champs communs hors interface, avec les vrais jetons — la
//           lectrice lit les définitions et les valeurs sans écrire, un non-administrateur ne définit pas, un membre qui
//           écrit l'affaire écrit sa valeur, une valeur hors type est refusée, l'anonyme ne lit rien
// @verifies docs/SPEC-champs-communs.md §3, §4 ; docs/SCHEMA.md « Migration `0152` » ; CLAUDE.md §10 (refus par requête
//           directe)
//
// Les lignes de la preuve portent la clé `tst-crm112-…` ; elles sont retirées à la fin par la clé de service.

import { expect, test } from '@playwright/test'
import { URL_API, enTetesAnonymes, enTetesAuthentifies, enTetesService, jetonDe } from './jetons'

const ESPACE = '5eed0000-0000-4000-8000-000000000001'
const REST = `${URL_API}/rest/v1`
const json = (enTetes: Record<string, string>) => ({ ...enTetes, 'Content-Type': 'application/json', Prefer: 'return=representation' })

test.describe('les champs communs — hors interface (docs/SPEC-champs-communs.md §4)', () => {
	let champ = ''
	let affaire = ''

	test.beforeAll(async ({ request }) => {
		const camille = await jetonDe('admin@p2enjoy.test')
		const cree = await request.post(`${REST}/card_common_fields`, {
			headers: json(enTetesAuthentifies(camille)),
			data: { workspace_id: ESPACE, key: 'tst-crm112-siret', label: 'SIRET de preuve', type: 'text', is_listed: true },
		})
		expect(cree.status(), await cree.text()).toBe(201)
		champ = ((await cree.json()) as { id: string }[])[0]!.id

		// Une affaire que Driss lit ET que Farida lit : la RLS ne rend à chacun que ce qu'il lit, et la lectrice ne lit que
		// certains channels. La politique d'écriture juge ensuite l'écriture de Driss (201 attendu plus bas).
		const lues = async (adresse: string) => {
			const reponse = await request.get(`${REST}/card_placements?select=card_id&archived_at=is.null&order=card_id`, {
				headers: enTetesAuthentifies(await jetonDe(adresse)),
			})
			return ((await reponse.json()) as { card_id: string }[]).map((ligne) => ligne.card_id)
		}
		const parFarida = new Set(await lues('viewer@p2enjoy.test'))
		const communes = (await lues('bizdev@p2enjoy.test')).filter((id) => parFarida.has(id))
		expect(communes.length, 'le seed donne au moins une affaire lue par Driss et par Farida').toBeGreaterThan(0)
		affaire = communes[0]!
	})

	test.afterAll(async ({ request }) => {
		await request.delete(`${REST}/card_common_field_values?field_id=eq.${champ}`, { headers: enTetesService() })
		await request.delete(`${REST}/card_common_fields?key=like.tst-crm112-*`, { headers: enTetesService() })
	})

	test('un non-administrateur ne définit pas de champ ; l’anonyme ne lit rien', async ({ request }) => {
		for (const adresse of ['bizdev@p2enjoy.test', 'viewer@p2enjoy.test']) {
			const refus = await request.post(`${REST}/card_common_fields`, {
				headers: json(enTetesAuthentifies(await jetonDe(adresse))),
				data: { workspace_id: ESPACE, key: 'tst-crm112-refus', label: 'Refusé', type: 'text' },
			})
			expect(refus.status(), adresse).toBe(403)
		}
		const anonyme = await request.get(`${REST}/card_common_fields?key=eq.tst-crm112-siret`, { headers: enTetesAnonymes() })
		expect(await anonyme.json()).toEqual([])
	})

	test('le commercial écrit la valeur ; une valeur hors type est refusée ; la lectrice lit sans écrire', async ({ request }) => {
		const driss = await jetonDe('bizdev@p2enjoy.test')
		const hors = await request.post(`${REST}/card_common_field_values`, {
			headers: json(enTetesAuthentifies(driss)),
			data: { card_id: affaire, field_id: champ, workspace_id: ESPACE, value: 42 },
		})
		expect(hors.status()).toBe(400)
		expect(((await hors.json()) as { message: string }).message).toBe('invalid_field_value')

		const ecrit = await request.post(`${REST}/card_common_field_values`, {
			headers: json(enTetesAuthentifies(driss)),
			data: { card_id: affaire, field_id: champ, workspace_id: ESPACE, value: '123 456 789 00012' },
		})
		expect(ecrit.status(), await ecrit.text()).toBe(201)

		const farida = await jetonDe('viewer@p2enjoy.test')
		const lue = await request.get(`${REST}/card_common_field_values?field_id=eq.${champ}&select=value`, {
			headers: enTetesAuthentifies(farida),
		})
		expect(await lue.json()).toEqual([{ value: '123 456 789 00012' }])
		const refus = await request.patch(`${REST}/card_common_field_values?field_id=eq.${champ}`, {
			headers: json(enTetesAuthentifies(farida)),
			data: { value: 'modifié' },
		})
		// Une mise à jour hors de la politique ne touche aucune ligne : PostgREST rend 200 et un tableau vide.
		expect(await refus.json()).toEqual([])
		const relue = await request.get(`${REST}/card_common_field_values?field_id=eq.${champ}&select=value,updated_by`, {
			headers: enTetesService(),
		})
		expect(await relue.json()).toEqual([{ value: '123 456 789 00012', updated_by: '5eed0000-0000-4000-8000-000000000012' }])
	})
})
