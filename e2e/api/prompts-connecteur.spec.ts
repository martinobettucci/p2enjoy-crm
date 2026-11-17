// @verifies CRM-149 (docs/BACKLOG.md) — tranche T1 : les prompts du connecteur, hors interface, avec les vrais jetons —
//           l'administratrice ajoute, modifie et supprime ; le business developer et la lectrice lisent et sont refusés par
//           des requêtes directes ; un identifiant pris ou hors forme est refusé ; un espace créé reçoit ses cinq défauts,
//           qu'un non-membre ne lit pas ; l'anonyme ne lit ni n'écrit rien
// @verifies docs/SPEC-mcp.md §17.2 (bornes, unicité), §17.3 (lecture par tout membre, écriture par l'administrateur),
//           §17.4 (les défauts) ; docs/JOURNAL.md décision 930 ; CLAUDE.md §10 (refus par requête directe)
//
// Les prompts et l'espace créés ici sont retirés à la fin, par la clé de service.

import { expect, test } from '@playwright/test'
import { URL_API, enTetesAnonymes, enTetesAuthentifies, enTetesService, jetonDe } from './jetons'

const ESPACE = '5eed0000-0000-4000-8000-000000000001'
const CAMILLE = '5eed0000-0000-4000-8000-000000000011'
const SUFFIXE = Date.now().toString(36)
const CLE = `zz-preuve-api-${SUFFIXE}`
const DEFAUTS = ['creer-une-affaire', 'enregistrer-une-recette-reelle', 'faire-avancer', 'faire-le-point', 'retrouver-une-affaire']

const json = (jeton: string) => ({ ...enTetesAuthentifies(jeton), 'Content-Type': 'application/json' })
const representation = (jeton: string) => ({ ...json(jeton), Prefer: 'return=representation' })
const service = () => ({ ...enTetesService(), 'Content-Type': 'application/json', Prefer: 'return=representation' })

test.describe('les prompts du connecteur — hors interface (docs/SPEC-mcp.md §17.3)', () => {
	const prompts: string[] = []
	const espaces: string[] = []

	test.afterAll(async ({ request }) => {
		for (const id of prompts) await request.delete(`${URL_API}/rest/v1/mcp_prompts?id=eq.${id}`, { headers: enTetesService() })
		for (const id of espaces) await request.delete(`${URL_API}/rest/v1/workspaces?id=eq.${id}`, { headers: enTetesService() })
	})

	test('l’administratrice ajoute, modifie et supprime ; l’auteur est posé par la base ; l’espace ne se change pas', async ({ request }) => {
		const camille = await jetonDe('admin@p2enjoy.test')
		const ajout = await request.post(`${URL_API}/rest/v1/mcp_prompts`, {
			headers: representation(camille),
			data: { workspace_id: ESPACE, key: CLE, title: 'Preuve API', description: 'Un prompt de la preuve API.', body: 'Texte.' },
		})
		expect(ajout.status(), await ajout.text()).toBe(201)
		const [prompt] = (await ajout.json()) as { id: string; created_by: string; updated_by: string }[]
		prompts.push(prompt!.id)
		expect(prompt!.created_by).toBe(CAMILLE)
		expect(prompt!.updated_by).toBe(CAMILLE)

		const modification = await request.patch(`${URL_API}/rest/v1/mcp_prompts?id=eq.${prompt!.id}`, {
			headers: representation(camille),
			data: { title: 'Preuve API revue', body: 'Texte revu.\nDeuxième ligne.' },
		})
		expect(modification.status()).toBe(200)
		expect(((await modification.json()) as { title: string; body: string }[])[0]).toMatchObject({
			title: 'Preuve API revue',
			body: 'Texte revu.\nDeuxième ligne.',
		})

		// L'espace d'un prompt n'est pas une colonne modifiable : le privilège manque, la requête est refusée.
		const deplacement = await request.patch(`${URL_API}/rest/v1/mcp_prompts?id=eq.${prompt!.id}`, {
			headers: json(camille),
			data: { workspace_id: '00000000-0000-4000-8000-000000000000' },
		})
		expect(deplacement.status()).toBe(403)

		const suppression = await request.delete(`${URL_API}/rest/v1/mcp_prompts?id=eq.${prompt!.id}`, { headers: representation(camille) })
		expect(suppression.status()).toBe(200)
		expect(((await suppression.json()) as unknown[]).length).toBe(1)
		const relu = await request.get(`${URL_API}/rest/v1/mcp_prompts?select=id&id=eq.${prompt!.id}`, { headers: enTetesService() })
		expect(await relu.json(), 'supprimer détruit (décision 930)').toEqual([])
	})

	test('le business developer et la lectrice LISENT les prompts ; leurs écritures directes sont refusées', async ({ request }) => {
		for (const adresse of ['bizdev@p2enjoy.test', 'viewer@p2enjoy.test']) {
			const jeton = await jetonDe(adresse)
			const lecture = await request.get(`${URL_API}/rest/v1/mcp_prompts?select=key&workspace_id=eq.${ESPACE}`, {
				headers: enTetesAuthentifies(jeton),
			})
			expect(lecture.status()).toBe(200)
			const cles = ((await lecture.json()) as { key: string }[]).map((l) => l.key)
			expect(cles, adresse).toEqual(expect.arrayContaining(DEFAUTS))

			const ajout = await request.post(`${URL_API}/rest/v1/mcp_prompts`, {
				headers: representation(jeton),
				data: { workspace_id: ESPACE, key: `zz-interdit-${SUFFIXE}`, title: 'T', description: 'D', body: 'B' },
			})
			expect(ajout.status(), adresse).toBe(403)

			// Une écriture que la politique filtre rend zéro ligne (décision 70) : rien n'est modifié ni supprimé.
			const modification = await request.patch(`${URL_API}/rest/v1/mcp_prompts?workspace_id=eq.${ESPACE}&key=eq.faire-le-point`, {
				headers: representation(jeton),
				data: { title: 'Détourné' },
			})
			expect(modification.status(), adresse).toBe(200)
			expect(await modification.json(), adresse).toEqual([])
			const suppression = await request.delete(`${URL_API}/rest/v1/mcp_prompts?workspace_id=eq.${ESPACE}&key=eq.faire-le-point`, {
				headers: representation(jeton),
			})
			expect(suppression.status(), adresse).toBe(200)
			expect(await suppression.json(), adresse).toEqual([])
		}
		const temoin = await request.get(
			`${URL_API}/rest/v1/mcp_prompts?select=title&workspace_id=eq.${ESPACE}&key=eq.faire-le-point`,
			{ headers: enTetesService() },
		)
		expect(await temoin.json()).toEqual([{ title: 'Faire le point sur une affaire' }])
	})

	test('un identifiant pris ou hors forme est refusé, et les bornes aussi', async ({ request }) => {
		const camille = await jetonDe('admin@p2enjoy.test')
		const doublon = await request.post(`${URL_API}/rest/v1/mcp_prompts`, {
			headers: representation(camille),
			data: { workspace_id: ESPACE, key: 'faire-le-point', title: 'Doublon', description: 'D', body: 'B' },
		})
		expect(doublon.status()).toBe(409)
		expect(((await doublon.json()) as { code: string }).code).toBe('23505')

		for (const donnees of [
			{ key: 'Majuscules', title: 'T', description: 'D', body: 'B' },
			{ key: 'a', title: 'T', description: 'D', body: 'B' },
			{ key: 'x'.repeat(41), title: 'T', description: 'D', body: 'B' },
			{ key: 'zz-titre', title: 'T'.repeat(81), description: 'D', body: 'B' },
			{ key: 'zz-description', title: 'T', description: 'D'.repeat(301), body: 'B' },
			{ key: 'zz-texte', title: 'T', description: 'D', body: ' \n\n ' },
		]) {
			const refus = await request.post(`${URL_API}/rest/v1/mcp_prompts`, {
				headers: representation(camille),
				data: { workspace_id: ESPACE, ...donnees },
			})
			expect(refus.status(), JSON.stringify(donnees)).toBe(400)
			expect(((await refus.json()) as { code: string }).code).toBe('23514')
		}
	})

	test('un espace créé reçoit ses cinq défauts ; un non-membre ne les lit pas et n’y écrit rien', async ({ request }) => {
		const creation = await request.post(`${URL_API}/rest/v1/workspaces`, {
			headers: service(),
			data: { name: `Preuve prompts ${SUFFIXE}`, slug: `preuve-prompts-${SUFFIXE}` },
		})
		expect(creation.status(), await creation.text()).toBe(201)
		const [espace] = (await creation.json()) as { id: string }[]
		espaces.push(espace!.id)

		const defauts = await request.get(`${URL_API}/rest/v1/mcp_prompts?select=key&workspace_id=eq.${espace!.id}&order=key`, {
			headers: enTetesService(),
		})
		expect(((await defauts.json()) as { key: string }[]).map((l) => l.key)).toEqual(DEFAUTS)

		// Camille administre l'espace du seed, pas celui-ci : elle n'en est pas membre.
		const camille = await jetonDe('admin@p2enjoy.test')
		const lecture = await request.get(`${URL_API}/rest/v1/mcp_prompts?select=key&workspace_id=eq.${espace!.id}`, {
			headers: enTetesAuthentifies(camille),
		})
		expect(lecture.status()).toBe(200)
		expect(await lecture.json()).toEqual([])
		const ajout = await request.post(`${URL_API}/rest/v1/mcp_prompts`, {
			headers: representation(camille),
			data: { workspace_id: espace!.id, key: 'zz-ailleurs', title: 'T', description: 'D', body: 'B' },
		})
		expect(ajout.status()).toBe(403)
	})

	test('l’anonyme ne lit rien et n’écrit rien', async ({ request }) => {
		const lecture = await request.get(`${URL_API}/rest/v1/mcp_prompts?select=id`, { headers: enTetesAnonymes() })
		expect(lecture.status()).toBe(200)
		expect(await lecture.json()).toEqual([])
		const ajout = await request.post(`${URL_API}/rest/v1/mcp_prompts`, {
			headers: { ...enTetesAnonymes(), 'Content-Type': 'application/json' },
			data: { workspace_id: ESPACE, key: 'zz-anonyme', title: 'T', description: 'D', body: 'B' },
		})
		expect([401, 403]).toContain(ajout.status())
	})
})
