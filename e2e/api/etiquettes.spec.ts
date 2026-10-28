// @verifies CRM-069 (docs/BACKLOG.md) — tranche T1 : les étiquettes, hors interface, avec les vrais jetons
// @verifies docs/SPEC-etiquettes-digest.md §2.1 (catalogue : écriture administrateur, lecture membre), §2.2 (pose par qui
//           écrit l'affaire, espace posé par la base, étiquette archivée refusée) ; CLAUDE.md §10 (refus par requête directe)
//
// L'étiquette est posée par l'administratrice, l'affaire créée et étiquetée par le business developer ; tout est retiré à
// la fin, par la clé de service.

import { expect, test } from '@playwright/test'
import { URL_API, enTetesAnonymes, enTetesAuthentifies, enTetesService, jetonDe } from './jetons'

const ESPACE = '5eed0000-0000-4000-8000-000000000001'
const CHANNEL = '5eed0000-0000-4000-8000-000000000036'
const NOM = `ZZ étiquette API ${Date.now()}`

const json = (jeton: string) => ({ ...enTetesAuthentifies(jeton), 'Content-Type': 'application/json' })
const representation = (jeton: string) => ({ ...json(jeton), Prefer: 'return=representation' })

test.describe('les étiquettes — hors interface (docs/SPEC-etiquettes-digest.md §2)', () => {
	const crees: { etiquettes: string[]; affaires: string[] } = { etiquettes: [], affaires: [] }

	test.afterAll(async ({ request }) => {
		for (const id of crees.affaires) await request.delete(`${URL_API}/rest/v1/cards?id=eq.${id}`, { headers: enTetesService() })
		for (const id of crees.etiquettes) {
			await request.delete(`${URL_API}/rest/v1/labels?id=eq.${id}`, { headers: enTetesService() })
		}
	})

	test('le catalogue : l’administratrice pose, le business developer est refusé, la lectrice lit', async ({ request }) => {
		const camille = await jetonDe('admin@p2enjoy.test')
		const pose = await request.post(`${URL_API}/rest/v1/labels`, {
			headers: representation(camille),
			data: { workspace_id: ESPACE, name: NOM, color: 'danger' },
		})
		expect(pose.status(), await pose.text()).toBe(201)
		const [etiquette] = (await pose.json()) as { id: string; created_by: string }[]
		crees.etiquettes.push(etiquette!.id)
		expect(etiquette!.created_by).toBe('5eed0000-0000-4000-8000-000000000011')

		const driss = await jetonDe('bizdev@p2enjoy.test')
		const refus = await request.post(`${URL_API}/rest/v1/labels`, {
			headers: representation(driss),
			data: { workspace_id: ESPACE, name: 'ZZ interdite' },
		})
		expect(refus.status()).toBe(403)

		// Aucune suppression du catalogue, même pour l'administratrice : une étiquette s'archive.
		const suppression = await request.delete(`${URL_API}/rest/v1/labels?id=eq.${etiquette!.id}`, { headers: json(camille) })
		expect(suppression.status()).toBe(403)

		const farida = await jetonDe('viewer@p2enjoy.test')
		const lue = await request.get(`${URL_API}/rest/v1/labels?select=name,color&id=eq.${etiquette!.id}`, {
			headers: enTetesAuthentifies(farida),
		})
		expect(await lue.json()).toEqual([{ name: NOM, color: 'danger' }])
	})

	test('la pose : le business developer étiquette son affaire, la lectrice est refusée, une archivée aussi', async ({ request }) => {
		const driss = await jetonDe('bizdev@p2enjoy.test')
		const creation = await request.post(`${URL_API}/rest/v1/rpc/creer_affaire`, {
			headers: json(driss),
			data: { p_channel: CHANNEL, p_titre: 'ZZ affaire étiquetée API' },
		})
		expect(creation.status(), await creation.text()).toBe(200)
		const carte = (await creation.json()) as string
		crees.affaires.push(carte)

		const pose = await request.post(`${URL_API}/rest/v1/card_labels`, {
			headers: representation(driss),
			data: { card_id: carte, label_id: crees.etiquettes[0] },
		})
		expect(pose.status(), await pose.text()).toBe(201)
		expect(((await pose.json()) as { workspace_id: string }[])[0]!.workspace_id).toBe(ESPACE)

		const farida = await jetonDe('viewer@p2enjoy.test')
		const refus = await request.delete(`${URL_API}/rest/v1/card_labels?card_id=eq.${carte}`, {
			headers: { ...representation(farida) },
		})
		// Une écriture que la politique filtre rend zéro ligne (décision 70) : rien n'est retiré.
		expect(refus.status()).toBe(200)
		expect(await refus.json()).toEqual([])

		const camille = await jetonDe('admin@p2enjoy.test')
		await request.patch(`${URL_API}/rest/v1/labels?id=eq.${crees.etiquettes[0]}`, {
			headers: json(camille),
			data: { archived_at: new Date().toISOString() },
		})
		await request.delete(`${URL_API}/rest/v1/card_labels?card_id=eq.${carte}`, { headers: json(driss) })
		const archivee = await request.post(`${URL_API}/rest/v1/card_labels`, {
			headers: representation(driss),
			data: { card_id: carte, label_id: crees.etiquettes[0] },
		})
		expect(archivee.status()).toBe(400)
		expect(((await archivee.json()) as { message: string }).message).toBe('label_archived')

		const fil = await request.get(`${URL_API}/rest/v1/card_events?card_id=eq.${carte}&type=like.label_*&select=type&order=created_at`, {
			headers: enTetesService(),
		})
		expect(((await fil.json()) as { type: string }[]).map((e) => e.type)).toEqual(['label_added', 'label_removed'])
	})

	test('l’anonyme ne lit ni n’écrit les étiquettes', async ({ request }) => {
		const lecture = await request.get(`${URL_API}/rest/v1/labels?select=id`, { headers: enTetesAnonymes() })
		expect(lecture.status()).toBe(401)
		const pose = await request.post(`${URL_API}/rest/v1/card_labels`, {
			headers: { ...enTetesAnonymes(), 'Content-Type': 'application/json' },
			data: { card_id: '00000000-0000-4000-8000-000000000000', label_id: '00000000-0000-4000-8000-000000000000' },
		})
		expect(pose.status()).toBe(401)
	})
})
