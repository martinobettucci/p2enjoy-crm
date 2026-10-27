// @verifies CRM-068 (docs/BACKLOG.md) — tranche T4a : les modèles d'affaires, hors interface, avec les vrais jetons
// @verifies docs/SPEC-checklists.md §3.5 (écriture administrateur, lecture membre, forme tenue par la base), §3.6
//           (`creer_affaire` applique le modèle ; `save_card_as_template`) ; CLAUDE.md §10 (refus par requête directe)
//
// Le modèle est posé par l'administratrice, l'affaire créée par le business developer ; tout est retiré à la fin, par la
// clé de service.

import { expect, test } from '@playwright/test'
import { URL_API, enTetesAnonymes, enTetesAuthentifies, enTetesService, jetonDe } from './jetons'

const ESPACE = '5eed0000-0000-4000-8000-000000000001'
const WORKFLOW = '5eed0000-0000-4000-8000-000000000051'
const CHANNEL = '5eed0000-0000-4000-8000-000000000036'
const NOM = `ZZ modèle API ${Date.now()}`

const json = (jeton: string) => ({ ...enTetesAuthentifies(jeton), 'Content-Type': 'application/json' })
const representation = (jeton: string) => ({ ...json(jeton), Prefer: 'return=representation' })

test.describe('les modèles d’affaires — hors interface (docs/SPEC-checklists.md §3.5, §3.6)', () => {
	const crees: { modeles: string[]; affaires: string[] } = { modeles: [], affaires: [] }

	test.afterAll(async ({ request }) => {
		for (const id of crees.affaires) await request.delete(`${URL_API}/rest/v1/cards?id=eq.${id}`, { headers: enTetesService() })
		for (const id of crees.modeles) {
			await request.delete(`${URL_API}/rest/v1/card_templates?id=eq.${id}`, { headers: enTetesService() })
		}
	})

	test('l’administratrice pose un modèle ; le business developer est refusé, la lectrice le lit', async ({ request }) => {
		const camille = await jetonDe('admin@p2enjoy.test')
		const pose = await request.post(`${URL_API}/rest/v1/card_templates`, {
			headers: representation(camille),
			data: {
				workspace_id: ESPACE,
				workflow_id: WORKFLOW,
				name: NOM,
				description: 'Deux jours sur site.',
				amount: 4800,
				field_values: { budget: 4800, source: 'salon' },
				checklist: ['Envoyer la convention'],
			},
		})
		expect(pose.status(), await pose.text()).toBe(201)
		const [modele] = (await pose.json()) as { id: string; created_by: string }[]
		crees.modeles.push(modele!.id)
		expect(modele!.created_by).toBe('5eed0000-0000-4000-8000-000000000011')

		const driss = await jetonDe('bizdev@p2enjoy.test')
		const refus = await request.post(`${URL_API}/rest/v1/card_templates`, {
			headers: representation(driss),
			data: { workspace_id: ESPACE, workflow_id: WORKFLOW, name: 'ZZ interdit' },
		})
		expect(refus.status()).toBe(403)

		const farida = await jetonDe('viewer@p2enjoy.test')
		const lu = await request.get(`${URL_API}/rest/v1/card_templates?select=name&id=eq.${modele!.id}`, {
			headers: enTetesAuthentifies(farida),
		})
		expect(await lu.json()).toEqual([{ name: NOM }])
	})

	test('la base refuse une valeur qu’une affaire refuserait, et une clé sans question', async ({ request }) => {
		const camille = await jetonDe('admin@p2enjoy.test')
		const valeur = await request.post(`${URL_API}/rest/v1/card_templates`, {
			headers: representation(camille),
			data: { workspace_id: ESPACE, workflow_id: WORKFLOW, name: 'ZZ valeur', field_values: { budget: 'beaucoup' } },
		})
		expect(valeur.status()).toBe(400)
		expect(((await valeur.json()) as { message: string }).message).toBe('invalid_field_value')
		const cle = await request.post(`${URL_API}/rest/v1/card_templates`, {
			headers: representation(camille),
			data: { workspace_id: ESPACE, workflow_id: WORKFLOW, name: 'ZZ clé', field_values: { inconnue: 1 } },
		})
		expect(cle.status()).toBe(400)
		expect(((await cle.json()) as { message: string }).message).toBe('template_field_unknown')
	})

	test('le business developer crée une affaire depuis le modèle ; « Enregistrer comme modèle » lui est refusé', async ({ request }) => {
		const driss = await jetonDe('bizdev@p2enjoy.test')
		const creation = await request.post(`${URL_API}/rest/v1/rpc/creer_affaire`, {
			headers: json(driss),
			data: { p_channel: CHANNEL, p_titre: 'ZZ affaire depuis modèle', p_template: crees.modeles[0] },
		})
		expect(creation.status(), await creation.text()).toBe(200)
		const carte = (await creation.json()) as string
		crees.affaires.push(carte)

		const lue = await request.get(
			`${URL_API}/rest/v1/cards?id=eq.${carte}&select=description,card_placements!card_placements_card_fk(id,amount),card_checklist_items(label,placement_id)`,
			{ headers: enTetesService() },
		)
		const [affaire] = (await lue.json()) as {
			description: string
			card_placements: { id: string; amount: number }[]
			card_checklist_items: { label: string; placement_id: string | null }[]
		}[]
		expect(affaire!.description).toBe('Deux jours sur site.')
		expect(affaire!.card_placements[0]!.amount).toBe(4800)
		expect(affaire!.card_checklist_items.filter((i) => i.placement_id === null).map((i) => i.label)).toEqual([
			'Envoyer la convention',
		])

		const refus = await request.post(`${URL_API}/rest/v1/rpc/save_card_as_template`, {
			headers: json(driss),
			data: { p_placement: affaire!.card_placements[0]!.id, p_name: 'ZZ copie interdite' },
		})
		expect(refus.status()).toBe(403)
		expect(((await refus.json()) as { message: string }).message).toBe('reserved_to_admins')

		const camille = await jetonDe('admin@p2enjoy.test')
		const copie = await request.post(`${URL_API}/rest/v1/rpc/save_card_as_template`, {
			headers: json(camille),
			data: { p_placement: affaire!.card_placements[0]!.id, p_name: `${NOM} (copie)` },
		})
		expect(copie.status(), await copie.text()).toBe(200)
		crees.modeles.push((await copie.json()) as string)
	})

	test('l’anonyme n’appelle ni la création depuis un modèle, ni l’enregistrement', async ({ request }) => {
		const appels: [string, Record<string, unknown>][] = [
			['creer_affaire', { p_channel: CHANNEL, p_titre: 'ZZ anonyme', p_template: crees.modeles[0] ?? null }],
			['save_card_as_template', { p_placement: '00000000-0000-4000-8000-000000000000', p_name: 'ZZ anonyme' }],
		]
		for (const [fonction, data] of appels) {
			const reponse = await request.post(`${URL_API}/rest/v1/rpc/${fonction}`, {
				headers: { ...enTetesAnonymes(), 'Content-Type': 'application/json' },
				data,
			})
			expect(reponse.status()).toBe(401)
		}
	})
})
