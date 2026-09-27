// @verifies CRM-094 (docs/BACKLOG.md) — tranche T1 : le workflow de départ, avec les jetons réels
// @verifies docs/SPEC-workflow-engine.md §7 quater (le geste, ses refus, le modèle) ; docs/SPEC-onboarding.md
//           §10.6 (preuve d'API) ; docs/SPEC-permissions-rls.md §4 ; docs/JOURNAL.md décision 606
// @verifies docs/SPEC-test-harness.md §4.3 (projet `api`) ; CLAUDE.md §10 (règle d'accès prouvée hors
//           interface, avec le jeton réel)
//
// L'espace neuf est posé par la clé de service — aucun écran ne crée d'espace, c'est une opération
// d'exploitation, comme dans `espace-solitaire.ts` —, puis tout ce qui est éprouvé l'est avec le JETON
// RÉEL de l'administratrice et du commercial du seed, sous les politiques inchangées. La preuve qui
// compte est la dernière du premier scénario : un channel NAÎT sur le workflow rendu, ce qui était
// impossible dans un espace neuf. L'espace est démonté dans un `finally`, et l'état rendu CONSTATÉ.

import { expect, test, type APIRequestContext } from '@playwright/test'
import { COMPTES_SEED, URL_API, enTetesAnonymes, enTetesAuthentifies, enTetesService, jetonDe } from './jetons'

const ADMIN = COMPTES_SEED[0]
const BIZDEV = COMPTES_SEED[1]
const ID_ADMIN = '5eed0000-0000-4000-8000-000000000011'
const ID_BIZDEV = '5eed0000-0000-4000-8000-000000000012'
const WORKSPACE_SEED = '5eed0000-0000-4000-8000-000000000001'

/** Identifiants fixes, préfixés `e0940000-…` : une trace interrompue se reconnaît et s'écrase. */
const ESPACE = { workspace: 'e0940000-0000-4000-8000-0000000000c1', track: 'e0940000-0000-4000-8000-0000000000c2' }

const rest = (chemin: string) => `${URL_API}/rest/v1/${chemin}`

async function demonter(requete: APIRequestContext, constater: boolean): Promise<void> {
	const filtre = `workspace_id=eq.${ESPACE.workspace}`
	for (const table of ['channels', 'tracks', 'workflow_transitions', 'workflow_steps', 'workflows', 'workflow_nodes_catalog']) {
		await requete.delete(rest(`${table}?${filtre}`), { headers: enTetesService() })
	}
	await requete.delete(rest(`workspaces?id=eq.${ESPACE.workspace}`), { headers: enTetesService() })
	if (!constater) return
	const restants = await requete.get(rest('workspaces?select=id'), { headers: enTetesService() })
	expect(
		(await restants.json()) as Array<{ id: string }>,
		'la base doit être rendue à son unique workspace seedé — sans quoi e2e/ui/demarrage.spec.ts rougirait',
	).toEqual([{ id: WORKSPACE_SEED }])
}

async function monter(requete: APIRequestContext): Promise<void> {
	await demonter(requete, false)
	for (const [table, corps] of [
		['workspaces', { id: ESPACE.workspace, name: 'Sonde 094 — espace neuf', slug: 'sonde-094-espace-neuf' }],
		['workspace_members', { workspace_id: ESPACE.workspace, user_id: ID_ADMIN, role: 'admin' }],
		['workspace_members', { workspace_id: ESPACE.workspace, user_id: ID_BIZDEV, role: 'business_developer' }],
	] as const) {
		const reponse = await requete.post(rest(table), { headers: enTetesService(), data: corps })
		expect(reponse.status(), `montage ${table} : ${await reponse.text()}`).toBe(201)
	}
}

const creer = (requete: APIRequestContext, jeton: string | null) =>
	requete.post(rest('rpc/creer_workflow_de_depart'), {
		headers: jeton === null ? enTetesAnonymes() : enTetesAuthentifies(jeton),
		data: { p_workspace: ESPACE.workspace },
	})

test.describe.configure({ mode: 'serial' })

test.describe('Le workflow de départ d’un espace neuf (§7 quater)', () => {
	test.beforeAll(async ({ request }) => monter(request))
	test.afterAll(async ({ request }) => demonter(request, true))

	test('le commercial est refusé, l’anonyme aussi, et rien n’est écrit', async ({ request }) => {
		const commercial = await creer(request, await jetonDe(BIZDEV.adresse))
		expect(commercial.status(), await commercial.text()).toBe(403)
		expect(((await commercial.json()) as { code: string; message: string })).toMatchObject({
			code: '42501',
			message: 'reserve aux administrateurs',
		})
		const anonyme = await creer(request, null)
		expect(anonyme.status(), 'le privilège refuse d’abord l’anonyme').toBe(401)

		const workflows = await request.get(rest(`workflows?workspace_id=eq.${ESPACE.workspace}&select=id`), { headers: enTetesService() })
		expect(await workflows.json()).toEqual([])
	})

	test('l’administratrice pose le cycle, puis un channel NAÎT dessus', async ({ request }) => {
		const jeton = await jetonDe(ADMIN.adresse)
		const reponse = await creer(request, jeton)
		expect(reponse.status(), await reponse.text()).toBe(200)
		const idWorkflow = (await reponse.json()) as string
		expect(idWorkflow).toMatch(/^[0-9a-f-]{36}$/)

		// Relu sous les politiques, avec le même jeton : ce que l'administratrice voit est ce qui est posé.
		const lire = async (chemin: string) => {
			const r = await request.get(rest(chemin), { headers: enTetesAuthentifies(jeton) })
			expect(r.status()).toBe(200)
			return (await r.json()) as unknown[]
		}
		expect(await lire(`workflows?workspace_id=eq.${ESPACE.workspace}&select=name,is_default,scope`)).toEqual([
			{ name: 'Cycle commercial', is_default: true, scope: 'global' },
		])
		expect(await lire(`workflow_steps?workflow_id=eq.${idWorkflow}&select=id`)).toHaveLength(7)
		expect(await lire(`workflow_steps?workflow_id=eq.${idWorkflow}&is_initial=is.true&select=id`)).toHaveLength(1)
		expect(await lire(`workflow_transitions?workflow_id=eq.${idWorkflow}&select=id`)).toHaveLength(11)
		expect(await lire(`workflow_nodes_catalog?workspace_id=eq.${ESPACE.workspace}&select=key`)).toHaveLength(7)

		const track = await request.post(rest('tracks'), {
			headers: enTetesAuthentifies(jeton),
			data: { id: ESPACE.track, workspace_id: ESPACE.workspace, name: 'Premier track', slug: 'premier-track', position: 1 },
		})
		expect(track.status(), await track.text()).toBe(201)
		const channel = await request.post(rest('channels'), {
			headers: enTetesAuthentifies(jeton),
			data: {
				workspace_id: ESPACE.workspace,
				track_id: ESPACE.track,
				name: 'Premier channel',
				slug: 'premier-channel',
				workflow_id: idWorkflow,
				position: 1,
			},
		})
		expect(channel.status(), `le premier channel naît sur le workflow de départ : ${await channel.text()}`).toBe(201)
	})

	test('un second appel est refusé : un double clic ne crée pas deux workflows', async ({ request }) => {
		const reponse = await creer(request, await jetonDe(ADMIN.adresse))
		expect(reponse.status(), await reponse.text()).toBe(400)
		expect(((await reponse.json()) as { code: string; message: string })).toMatchObject({
			code: 'P0001',
			message: 'workflow existant',
		})
		const workflows = await request.get(rest(`workflows?workspace_id=eq.${ESPACE.workspace}&select=id`), { headers: enTetesService() })
		expect(await workflows.json()).toHaveLength(1)
	})
})
