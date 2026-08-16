// @verifies CRM-032 (docs/BACKLOG.md) — copie d'un workflow vers un track, dernière tranche : la
//           comparaison copie ↔ source
// @verifies docs/SPEC-workflow-engine.md §4 ter.8 (contrat d'API, lignes a à j),
//           §4 ter.2 (les clés naturelles), §4 ter.4 (le geste), §4 ter.5 (les quatre refus),
//           §4 ter.6 (ce que la fonction rend)
// @verifies docs/SPEC-workflow-engine.md §4.5 (ce que la copie copie, dont cet appariement est le
//           miroir)
// @verifies docs/SPEC-test-harness.md §4.3 (projet `api`, hors interface)
// @verifies CLAUDE.md §10 (toute règle d'accès se prouve hors interface, avec le jeton réel)
//
// Ces scénarios exercent le backend **sans passer par l'interface**, avec les jetons réels des
// profils seedés obtenus par la véritable route de connexion. Aucun navigateur n'est lancé : cette
// tranche ne livre aucun écran (`docs/SPEC-workflow-engine.md` §4 ter.7).
//
// CE QUE CES PREUVES DOIVENT ATTRAPER, ET QUE LA SUITE pgTAP NE PEUT PAS :
//
//   * la comparaison est `security invoker`. Son autorisation est donc celle de PostgREST et de la
//     RLS, et non celle d'un `set role` simulé ;
//   * l'anonyme obtient `401` et non `403` : le privilège refuse avant la première vérification,
//     PostgREST traitant l'absence de droit d'un appelant non authentifié comme une invitation à
//     s'authentifier (§4.4) ;
//   * un `viewer` COMPARE. Sans cette ligne, les refus seraient tout aussi verts sur un produit où
//     personne ne peut comparer.
//
// LES FIXTURES SONT PROPRES À LA PREUVE, ET RENDUES. Les scénarios qui dégradent créent leur propre
// copie jetable par la VRAIE RPC de copie et la suppriment dans un `finally`. La copie du seed
// n'est jamais modifiée : les suites voisines la lisent.
//
// L'IDENTIFIANT DE LA COPIE DU SEED N'EST PAS ÉCRIT EN DUR : il est engendré par la fonction de
// copie et diffère d'une base à l'autre (INC-122, `docs/SPEC-seed.md` §2.9). Il est retrouvé par
// son lignage.

import { randomUUID } from 'node:crypto'
import { expect, test, type APIRequestContext } from '@playwright/test'
import { COMPTES_SEED, enTetesAnonymes, enTetesAuthentifies, enTetesService, jetonDe } from './jetons'

/** Le workspace du seed socle (`docs/SPEC-seed.md` §2). */
const WORKSPACE_SEED = '5eed0000-0000-4000-8000-000000000001'
/** Le track « Conseil IA », qui porte la copie du seed (`docs/SPEC-seed.md` §2.9). */
const TRACK_CONSEIL_IA = '5eed0000-0000-4000-8000-000000000021'
/** Le workflow par défaut du seed, source de la copie. */
const WORKFLOW_DEFAUT = '5eed0000-0000-4000-8000-000000000051'

const RPC_COMPARER = '/rest/v1/rpc/compare_workflow_with_source'
const RPC_COPIER = '/rest/v1/rpc/copy_workflow_to_track'
const WF = '/rest/v1/workflows'
const STEPS = '/rest/v1/workflow_steps'

type Element = { identity: Record<string, string>; element: Record<string, unknown> }
type Modification = {
	identity: Record<string, string>
	attributes: { name: string; before: unknown; after: unknown }[]
}
type Collection = { added: Element[]; removed: Element[]; modified: Modification[] }

type Comparaison = {
	workflow: { workflow_id: string; name: string }
	source: { workflow_id: string; name: string; archived_at: string | null }
	identical: boolean
	summary: { added: number; removed: number; modified: number }
	changes: {
		steps: Collection
		transitions: Collection
		fields: Collection
		rules: Collection
		required_fields: Collection
	}
}

/**
 * Premier élément d'une liste, avec l'échec NOMMÉ plutôt qu'un `undefined` propagé. Le dépôt
 * compile sous `noUncheckedIndexedAccess` : une déstructuration muette rendrait un diagnostic
 * illisible le jour où la fixture attendue n'existe pas.
 */
function premier<T>(liste: T[], quoi: string): T {
	expect(liste.length, `aucun élément : ${quoi}`).toBeGreaterThan(0)
	return liste[0] as T
}

/** La copie du seed, retrouvée par son lignage et jamais par un identifiant écrit en dur. */
async function copieDuSeed(api: APIRequestContext): Promise<string> {
	const reponse = await api.get(
		`${WF}?derived_from_workflow_id=eq.${WORKFLOW_DEFAUT}&select=id&order=created_at.asc&limit=1`,
		{ headers: enTetesService() },
	)
	expect(reponse.status(), 'lecture de la copie du seed').toBe(200)
	const lignes = (await reponse.json()) as { id: string }[]
	expect(lignes.length, 'le seed porte une copie du workflow par défaut').toBe(1)
	return premier(lignes, 'la copie du seed').id
}

/**
 * Crée une copie jetable par la VRAIE RPC de copie, avec le jeton de l'administratrice. Jamais
 * d'insertion fabriquée : `CLAUDE.md` §8 exige que la donnée naisse du mécanisme réel, et c'est
 * précisément le remappage de cette fonction que la comparaison doit refléter.
 */
async function copieJetable(api: APIRequestContext, jeton: string): Promise<string> {
	const reponse = await api.post(RPC_COPIER, {
		headers: enTetesAuthentifies(jeton),
		data: {
			workflow_id: WORKFLOW_DEFAUT,
			track_id: TRACK_CONSEIL_IA,
			new_name: `Copie de preuve ${randomUUID()}`,
		},
	})
	expect(reponse.status(), 'création de la copie jetable par la vraie RPC').toBe(200)
	return (await reponse.json()) as unknown as string
}

/** Supprime la copie jetable : la cascade emporte ses étapes, arêtes, champs et règles. */
async function rendreLaBase(api: APIRequestContext, workflowId: string): Promise<void> {
	await api.delete(`${STEPS}?workflow_id=eq.${workflowId}`, { headers: enTetesService() })
	await api.delete(`${WF}?id=eq.${workflowId}`, { headers: enTetesService() })
}

async function comparer(
	api: APIRequestContext,
	jeton: string,
	workflowId: string,
): Promise<Comparaison> {
	const reponse = await api.post(RPC_COMPARER, {
		headers: enTetesAuthentifies(jeton),
		data: { workflow_id: workflowId },
	})
	expect(reponse.status(), 'la comparaison rend 200').toBe(200)
	return (await reponse.json()) as Comparaison
}

test.describe('N1 — une copie intacte est identique à sa source (lignes a, b, c)', () => {
	test('ligne a — la copie du seed est déclarée identique, les trois compteurs à zéro', async ({
		request,
	}) => {
		const jeton = await jetonDe(COMPTES_SEED[0].adresse)
		const copie = await copieDuSeed(request)

		const comparaison = await comparer(request, jeton, copie)

		expect(comparaison.identical, 'une copie que personne n’a touchée est identique').toBe(true)
		expect(comparaison.summary).toEqual({ added: 0, removed: 0, modified: 0 })
		expect(comparaison.source.workflow_id).toBe(WORKFLOW_DEFAUT)
		expect(comparaison.workflow.workflow_id).toBe(copie)
		// Les cinq collections sont vides, et pas seulement le résumé : `identical` est calculé sur
		// elles, mais un résumé juste sur un document faux resterait invisible.
		for (const nom of ['steps', 'transitions', 'fields', 'rules', 'required_fields'] as const) {
			expect(comparaison.changes[nom].added, `${nom}.added`).toEqual([])
			expect(comparaison.changes[nom].removed, `${nom}.removed`).toEqual([])
			expect(comparaison.changes[nom].modified, `${nom}.modified`).toEqual([])
		}
	})

	test('ligne b — un `viewer` obtient le même document : comparer est une LECTURE', async ({
		request,
	}) => {
		const jetonAdmin = await jetonDe(COMPTES_SEED[0].adresse)
		const jetonViewer = await jetonDe(COMPTES_SEED[2].adresse)
		const copie = await copieDuSeed(request)

		const vueAdmin = await comparer(request, jetonAdmin, copie)
		const vueViewer = await comparer(request, jetonViewer, copie)

		expect(vueViewer).toEqual(vueAdmin)
	})

	test('ligne c — l’anonyme est refusé en 401, par le privilège et avant tout contrôle', async ({
		request,
	}) => {
		const copie = await copieDuSeed(request)

		const reponse = await request.post(RPC_COMPARER, {
			headers: enTetesAnonymes(),
			data: { workflow_id: copie },
		})

		// `401` et non `403` : le privilège refuse avant la première vérification (§4.4). Un `403`
		// signalerait que la révocation nommée d'`anon` a été perdue.
		expect(reponse.status()).toBe(401)
	})
})

test.describe('N2 — les refus (lignes d, e, f)', () => {
	test('ligne d — un workflow qui n’est la copie de personne est refusé, et n’est pas une réponse vide', async ({
		request,
	}) => {
		const jeton = await jetonDe(COMPTES_SEED[0].adresse)

		const reponse = await request.post(RPC_COMPARER, {
			headers: enTetesAuthentifies(jeton),
			data: { workflow_id: WORKFLOW_DEFAUT },
		})

		expect(reponse.status()).toBe(400)
		expect(((await reponse.json()) as { message: string }).message).toBe('workflow non derive')
	})

	test('ligne e — un identifiant inexistant rend `workflow introuvable`', async ({ request }) => {
		const jeton = await jetonDe(COMPTES_SEED[0].adresse)

		const reponse = await request.post(RPC_COMPARER, {
			headers: enTetesAuthentifies(jeton),
			data: { workflow_id: randomUUID() },
		})

		expect(reponse.status()).toBe(400)
		expect(((await reponse.json()) as { message: string }).message).toBe('workflow introuvable')
	})

	test('ligne f — un workflow d’un AUTRE workspace rend le MÊME message : aucun oracle d’existence', async ({
		request,
	}) => {
		const jeton = await jetonDe(COMPTES_SEED[0].adresse)
		const workspaceEtranger = randomUUID()
		const workflowEtranger = randomUUID()

		const creationWorkspace = await request.post('/rest/v1/workspaces', {
			headers: { ...enTetesService(), Prefer: 'return=representation' },
			data: {
				id: workspaceEtranger,
				name: `Workspace étranger ${workspaceEtranger}`,
				slug: `etranger-${workspaceEtranger}`,
			},
		})
		expect(creationWorkspace.status(), 'création du workspace étranger').toBe(201)

		try {
			const creation = await request.post(WF, {
				headers: { ...enTetesService(), Prefer: 'return=representation' },
				data: {
					id: workflowEtranger,
					workspace_id: workspaceEtranger,
					name: 'Workflow étranger',
					scope: 'global',
					is_default: false,
				},
			})
			expect(creation.status(), 'création du workflow étranger').toBe(201)

			// D'abord CONSTATER qu'il existe, avec la clé de service : sans cela, le refus ci-dessous
			// serait indistinguable d'un identifiant simplement inventé, et la preuve ne prouverait
			// rien de la discrétion.
			const constat = await request.get(`${WF}?id=eq.${workflowEtranger}&select=id`, {
				headers: enTetesService(),
			})
			expect(((await constat.json()) as unknown[]).length).toBe(1)

			const reponse = await request.post(RPC_COMPARER, {
				headers: enTetesAuthentifies(jeton),
				data: { workflow_id: workflowEtranger },
			})

			expect(reponse.status()).toBe(400)
			expect(((await reponse.json()) as { message: string }).message).toBe('workflow introuvable')
		} finally {
			await request.delete(`${WF}?id=eq.${workflowEtranger}`, { headers: enTetesService() })
			await request.delete(`/rest/v1/workspaces?id=eq.${workspaceEtranger}`, {
				headers: enTetesService(),
			})
		}
	})
})

test.describe('N3 — chaque forme d’écart, avec l’identité juste (lignes g, h, i, j)', () => {
	test('ligne g — une position changée rend un `modified` qui NOMME l’attribut, avec son avant et son après', async ({
		request,
	}) => {
		const jeton = await jetonDe(COMPTES_SEED[0].adresse)
		const copie = await copieJetable(request, jeton)
		try {
			const etapes = await request.get(
				`${STEPS}?workflow_id=eq.${copie}&select=id,node_id,position&order=position.asc&limit=1`,
				{ headers: enTetesService() },
			)
			const etape = premier(
				(await etapes.json()) as { id: string; node_id: string; position: number }[],
				'la première étape de la copie jetable',
			)

			const modification = await request.patch(`${STEPS}?id=eq.${etape.id}`, {
				headers: enTetesService(),
				data: { position: etape.position + 100 },
			})
			expect(modification.status()).toBe(204)

			const comparaison = await comparer(request, jeton, copie)

			expect(comparaison.identical).toBe(false)
			expect(comparaison.summary.modified).toBe(1)
			const modifiee = premier(comparaison.changes.steps.modified, 'une étape modifiée')
			expect(modifiee.identity).toEqual({ node_id: etape.node_id })
			expect(modifiee.attributes).toEqual([
				{ name: 'position', before: etape.position, after: etape.position + 100 },
			])
		} finally {
			await rendreLaBase(request, copie)
		}
	})

	test('ligne h — une étape retirée de la copie est RETIRÉE, et son identité est le `node_id`', async ({
		request,
	}) => {
		const jeton = await jetonDe(COMPTES_SEED[0].adresse)
		const copie = await copieJetable(request, jeton)
		try {
			const etapes = await request.get(
				`${STEPS}?workflow_id=eq.${copie}&is_initial=eq.false&select=id,node_id&order=position.desc&limit=1`,
				{ headers: enTetesService() },
			)
			const etape = premier(
				(await etapes.json()) as { id: string; node_id: string }[],
				'une étape non initiale de la copie jetable',
			)

			const suppression = await request.delete(`${STEPS}?id=eq.${etape.id}`, {
				headers: enTetesService(),
			})
			expect(suppression.status()).toBe(204)

			const comparaison = await comparer(request, jeton, copie)

			expect(comparaison.identical).toBe(false)
			const retirees = comparaison.changes.steps.removed.map((e) => e.identity.node_id)
			expect(retirees).toContain(etape.node_id)
		} finally {
			await rendreLaBase(request, copie)
		}
	})

	test('ligne i — un libellé d’arête changé est un `modified`, identifié par le COUPLE de nœuds', async ({
		request,
	}) => {
		const jeton = await jetonDe(COMPTES_SEED[0].adresse)
		const copie = await copieJetable(request, jeton)
		try {
			const arcs = await request.get(
				`/rest/v1/workflow_transitions?workflow_id=eq.${copie}&select=id,label&order=id.asc&limit=1`,
				{ headers: enTetesService() },
			)
			const arc = premier(
				(await arcs.json()) as { id: string; label: string | null }[],
				'une arête de la copie jetable',
			)

			const modification = await request.patch(`/rest/v1/workflow_transitions?id=eq.${arc.id}`, {
				headers: enTetesService(),
				data: { label: 'Libellé changé par la preuve' },
			})
			expect(modification.status()).toBe(204)

			const comparaison = await comparer(request, jeton, copie)

			const modifiee = premier(comparaison.changes.transitions.modified, 'une arête modifiée')
			// L'identité est le couple de nœuds, et non un identifiant local : c'est ce qui rend la
			// comparaison possible entre deux workflows qui n'en partagent aucun (§4 ter.2).
			expect(Object.keys(modifiee.identity).sort()).toEqual(['from_node_id', 'to_node_id'])
			expect(modifiee.attributes).toEqual([
				{ name: 'label', before: arc.label, after: 'Libellé changé par la preuve' },
			])
			// Aucune arête n'est ni ajoutée ni retirée : un libellé n'est pas une identité.
			expect(comparaison.changes.transitions.added).toEqual([])
			expect(comparaison.changes.transitions.removed).toEqual([])
		} finally {
			await rendreLaBase(request, copie)
		}
	})

	test('ligne j — un champ renommé rend un RETRAIT et un AJOUT, jamais un `modified`', async ({
		request,
	}) => {
		const jeton = await jetonDe(COMPTES_SEED[0].adresse)
		const copie = await copieJetable(request, jeton)
		try {
			const champs = await request.get(
				`/rest/v1/form_fields?workflow_id=eq.${copie}&select=id,key&order=position.asc&limit=1`,
				{ headers: enTetesService() },
			)
			const champ = premier(
				(await champs.json()) as { id: string; key: string }[],
				'un champ de la copie jetable',
			)

			const modification = await request.patch(`/rest/v1/form_fields?id=eq.${champ.id}`, {
				headers: enTetesService(),
				data: { key: 'cle-renommee-par-la-preuve' },
			})
			expect(modification.status()).toBe(204)

			const comparaison = await comparer(request, jeton, copie)

			// Conséquence ASSUMÉE du §4 ter.2 : `key` est la clé d'appariement — celle-là même que la
			// copie remappe —, donc la renommer rend deux éléments et non un. Toute autre réponse
			// serait une supposition sur l'intention de l'utilisateur.
			expect(comparaison.changes.fields.added.map((e) => e.identity.key)).toContain(
				'cle-renommee-par-la-preuve',
			)
			expect(comparaison.changes.fields.removed.map((e) => e.identity.key)).toContain(champ.key)
			expect(
				comparaison.changes.fields.modified.map((m) => m.identity.key),
				'aucun `modified` : un renommage n’est pas une modification d’attribut',
			).not.toContain(champ.key)
		} finally {
			await rendreLaBase(request, copie)
		}
	})
})
