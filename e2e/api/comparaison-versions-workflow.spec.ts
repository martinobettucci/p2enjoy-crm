// @verifies CRM-078 (docs/BACKLOG.md) — versionnement des workflows, deuxième tranche :
//           comparaison de deux versions
// @verifies docs/SPEC-workflow-engine.md §7 ter.11.6 (contrat d'API, lignes a à l),
//           §7 ter.11.2 (l'identité est un identifiant, jamais une ressemblance),
//           §7 ter.11.3 (le geste et ses quatre refus), §7 ter.11.4 (ce que la fonction rend)
// @verifies docs/SPEC-permissions-rls.md §7 (preuve de refus n° 3 au niveau des versions)
// @verifies docs/SPEC-test-harness.md §4.3 (projet `api`, hors interface)
// @verifies CLAUDE.md §10 (toute règle d'accès se prouve hors interface, avec le jeton réel)
//
// Ces scénarios exercent le backend **sans passer par l'interface**, avec les jetons réels des
// trois profils seedés obtenus par la véritable route de connexion. Aucun navigateur n'est lancé :
// cette tranche ne livre aucun écran (`docs/SPEC-workflow-engine.md` §7 ter.11.7).
//
// Ils reprennent une à une les douze lignes du tableau du §7 ter.11.6, écrit **avant** le code.
//
// CE QUE CES PREUVES DOIVENT ATTRAPER, ET QUE LA SUITE pgTAP NE PEUT PAS :
//
//   * la comparaison est `security invoker`. Son autorisation est donc celle de PostgREST et de la
//     RLS, pas celle d'un `set role` simulé — c'est ici, et ici seulement, que la ligne j peut être
//     jouée contre un SECOND workspace réel, absent du seed ;
//   * l'anonyme obtient `401` et non `403` : le privilège refuse avant la première vérification,
//     PostgREST traitant l'absence de droit d'un appelant non authentifié comme une invitation à
//     s'authentifier (§4.4) ;
//   * un `viewer` et un `business_developer` COMPARENT. Sans ces deux lignes, les refus seraient
//     tout aussi verts sur un produit où personne ne peut comparer.
//
// LES FIXTURES SONT PROPRES À LA PREUVE, ET RENDUES. Chaque scénario qui publie crée son propre
// workflow et le supprime dans un `finally` : la cascade emporte ses versions, et le seed est rendu
// intact. Publier sur le workflow du seed ferait avancer son numéro de version à chaque exécution.

import { randomUUID } from 'node:crypto'
import { expect, test, type APIRequestContext } from '@playwright/test'
import { COMPTES_SEED, enTetesAnonymes, enTetesAuthentifies, enTetesService, jetonDe } from './jetons'

/** Le workspace du seed socle (`docs/SPEC-seed.md` §2). */
const WORKSPACE_SEED = '5eed0000-0000-4000-8000-000000000001'

const RPC_COMPARER = '/rest/v1/rpc/compare_workflow_versions'
const RPC_PUBLIER = '/rest/v1/rpc/publish_workflow_version'
const VERSIONS = '/rest/v1/workflow_versions'
const WF = '/rest/v1/workflows'
const STEPS = '/rest/v1/workflow_steps'
const WORKSPACES = '/rest/v1/workspaces'

/** Deux nœuds actifs du catalogue seedé, employés pour faire bouger une composition. */
const NOEUD_PROSPECTION = '5eed0000-0000-4000-8000-000000000041'
const NOEUD_NEGOCIATION = '5eed0000-0000-4000-8000-000000000043'

type Comparaison = {
	base: { version_id: string; version_number: number; composition_fingerprint: string }
	target: { version_id: string; version_number: number; composition_fingerprint: string }
	identical: boolean
	summary: { added: number; removed: number; modified: number }
	changes: {
		workflow: { modified: Modification[] }
		steps: Collection
		transitions: Collection
		fields: Collection
		rules: Collection
		required_fields: Collection
	}
}

type Element = { identity: Record<string, string>; element: Record<string, unknown> }
type Modification = {
	identity: Record<string, string>
	attributes: { name: string; before: unknown; after: unknown }[]
}
type Collection = { added: Element[]; removed: Element[]; modified: Modification[] }

/** Crée un workflow jetable par la clé de service et rend son identifiant. */
async function workflowJetable(api: APIRequestContext, nom: string): Promise<string> {
	const id = randomUUID()
	const reponse = await api.post(WF, {
		headers: { ...enTetesService(), Prefer: 'return=representation' },
		data: { id, workspace_id: WORKSPACE_SEED, name: nom, scope: 'global', is_default: false },
	})
	expect(reponse.status(), `création du workflow jetable « ${nom} »`).toBe(201)
	return id
}

/** Ajoute une étape au workflow jetable, par la clé de service, et rend son identifiant. */
async function etapeJetable(
	api: APIRequestContext,
	workflowId: string,
	noeudId: string,
	position: number,
	initiale = false,
): Promise<string> {
	const id = randomUUID()
	const reponse = await api.post(STEPS, {
		headers: { ...enTetesService(), Prefer: 'return=representation' },
		data: {
			id,
			workflow_id: workflowId,
			workspace_id: WORKSPACE_SEED,
			node_id: noeudId,
			position,
			is_initial: initiale,
		},
	})
	expect(reponse.status(), 'création de l’étape jetable').toBe(201)
	return id
}

/**
 * Publie une version du workflow par la VRAIE RPC, avec le jeton de l'administratrice, et rend
 * l'identifiant de la version. Jamais d'insertion directe : les privilèges la refusent de toute
 * façon (§7 ter.4).
 */
async function publier(api: APIRequestContext, jeton: string, workflowId: string): Promise<string> {
	const reponse = await api.post(RPC_PUBLIER, {
		headers: enTetesAuthentifies(jeton),
		data: { target_workflow_id: workflowId },
	})
	expect(reponse.status(), 'publication d’une version de preuve').toBe(200)
	return ((await reponse.json()) as { id: string }).id
}

/** Supprime le workflow jetable : la cascade emporte ses versions. */
async function rendreLaBase(api: APIRequestContext, workflowId: string): Promise<void> {
	await api.delete(`${WF}?id=eq.${workflowId}`, { headers: enTetesService() })
}

test.describe('N1 — la comparaison rend ce qui a changé (lignes a, b, c, d, e)', () => {
	test('ligne a — une version comparée à elle-même rend `identical` et un `summary` à zéro', async ({
		request,
	}) => {
		const jeton = await jetonDe(COMPTES_SEED[0].adresse)
		const workflow = await workflowJetable(request, `Comparaison — ligne a ${randomUUID()}`)
		try {
			const version = await publier(request, jeton, workflow)

			const reponse = await request.post(RPC_COMPARER, {
				headers: enTetesAuthentifies(jeton),
				data: { base_version_id: version, target_version_id: version },
			})
			expect(reponse.status()).toBe(200)

			const comparaison = (await reponse.json()) as Comparaison
			expect(comparaison.identical).toBe(true)
			expect(comparaison.summary).toEqual({ added: 0, removed: 0, modified: 0 })
			// Les six collections sont présentes et vides : un appelant n'a pas à tester
			// l'existence de chaque clé avant de la parcourir.
			expect(Object.keys(comparaison.changes).sort()).toEqual([
				'fields',
				'required_fields',
				'rules',
				'steps',
				'transitions',
				'workflow',
			])
			for (const [nom, collection] of Object.entries(comparaison.changes)) {
				expect((collection as { modified: Modification[] }).modified, `${nom}.modified`).toEqual([])
			}
		} finally {
			await rendreLaBase(request, workflow)
		}
	})

	test('ligne b — une étape ajoutée figure en `added`, avec son document complet', async ({
		request,
	}) => {
		const jeton = await jetonDe(COMPTES_SEED[0].adresse)
		const workflow = await workflowJetable(request, `Comparaison — ligne b ${randomUUID()}`)
		try {
			const avant = await publier(request, jeton, workflow)
			const etape = await etapeJetable(request, workflow, NOEUD_PROSPECTION, 1, true)
			const apres = await publier(request, jeton, workflow)

			const reponse = await request.post(RPC_COMPARER, {
				headers: enTetesAuthentifies(jeton),
				data: { base_version_id: avant, target_version_id: apres },
			})
			expect(reponse.status()).toBe(200)

			const comparaison = (await reponse.json()) as Comparaison
			expect(comparaison.identical).toBe(false)
			expect(comparaison.summary).toEqual({ added: 1, removed: 0, modified: 0 })

			const ajoutees = comparaison.changes.steps.added
			expect(ajoutees).toHaveLength(1)
			expect(ajoutees[0]!.identity).toEqual({ id: etape })
			// Le document COMPLET, et non le seul identifiant : un écran doit pouvoir nommer
			// l'étape sans relire la base — et il ne le pourra plus quand elle aura disparu.
			expect(ajoutees[0]!.element.node_key).toBe('prospection')
			expect(ajoutees[0]!.element.is_initial).toBe(true)
		} finally {
			await rendreLaBase(request, workflow)
		}
	})

	test('ligne c — une étape renommée est MODIFIÉE, et seul l’attribut changé est rendu', async ({
		request,
	}) => {
		const jeton = await jetonDe(COMPTES_SEED[0].adresse)
		const workflow = await workflowJetable(request, `Comparaison — ligne c ${randomUUID()}`)
		try {
			const etape = await etapeJetable(request, workflow, NOEUD_NEGOCIATION, 1, true)
			const avant = await publier(request, jeton, workflow)

			const renommage = await request.patch(`${STEPS}?id=eq.${etape}`, {
				headers: enTetesService(),
				data: { label_override: 'Négociation commerciale' },
			})
			expect(renommage.status()).toBe(204)
			const apres = await publier(request, jeton, workflow)

			const reponse = await request.post(RPC_COMPARER, {
				headers: enTetesAuthentifies(jeton),
				data: { base_version_id: avant, target_version_id: apres },
			})
			expect(reponse.status()).toBe(200)

			const comparaison = (await reponse.json()) as Comparaison
			const modifiees = comparaison.changes.steps.modified
			// UNE étape modifiée, et non une retirée plus une ajoutée : l'identité est
			// l'identifiant, jamais le libellé (§7 ter.11.2).
			expect(modifiees).toHaveLength(1)
			expect(comparaison.changes.steps.added).toEqual([])
			expect(comparaison.changes.steps.removed).toEqual([])
			expect(modifiees[0]!.identity).toEqual({ id: etape })
			expect(modifiees[0]!.attributes).toEqual([
				{ name: 'label_override', before: null, after: 'Négociation commerciale' },
			])
		} finally {
			await rendreLaBase(request, workflow)
		}
	})

	test('ligne d — une étape retirée figure en `removed`', async ({ request }) => {
		const jeton = await jetonDe(COMPTES_SEED[0].adresse)
		const workflow = await workflowJetable(request, `Comparaison — ligne d ${randomUUID()}`)
		try {
			const etape = await etapeJetable(request, workflow, NOEUD_PROSPECTION, 1, true)
			const avant = await publier(request, jeton, workflow)

			const suppression = await request.delete(`${STEPS}?id=eq.${etape}`, {
				headers: enTetesService(),
			})
			expect(suppression.status()).toBe(204)
			const apres = await publier(request, jeton, workflow)

			const reponse = await request.post(RPC_COMPARER, {
				headers: enTetesAuthentifies(jeton),
				data: { base_version_id: avant, target_version_id: apres },
			})
			expect(reponse.status()).toBe(200)

			const comparaison = (await reponse.json()) as Comparaison
			const retirees = comparaison.changes.steps.removed
			expect(retirees).toHaveLength(1)
			expect(retirees[0]!.identity).toEqual({ id: etape })
			expect(comparaison.summary).toEqual({ added: 0, removed: 1, modified: 0 })
		} finally {
			await rendreLaBase(request, workflow)
		}
	})

	test('ligne e — arguments inversés, la même étape est `removed` et non `added`', async ({
		request,
	}) => {
		const jeton = await jetonDe(COMPTES_SEED[0].adresse)
		const workflow = await workflowJetable(request, `Comparaison — ligne e ${randomUUID()}`)
		try {
			const avant = await publier(request, jeton, workflow)
			const etape = await etapeJetable(request, workflow, NOEUD_PROSPECTION, 1, true)
			const apres = await publier(request, jeton, workflow)

			// L'ORIENTATION est celle des arguments, et la fonction ne la corrige pas : choisir le
			// sens appartient à l'appelant, qui seul sait s'il regarde un historique ou un projet
			// de restauration (§7 ter.11.3).
			const reponse = await request.post(RPC_COMPARER, {
				headers: enTetesAuthentifies(jeton),
				data: { base_version_id: apres, target_version_id: avant },
			})
			expect(reponse.status()).toBe(200)

			const comparaison = (await reponse.json()) as Comparaison
			expect(comparaison.changes.steps.added).toEqual([])
			expect(comparaison.changes.steps.removed[0]!.identity).toEqual({ id: etape })
			expect(comparaison.summary).toEqual({ added: 0, removed: 1, modified: 0 })
		} finally {
			await rendreLaBase(request, workflow)
		}
	})
})

test.describe('N2 — comparer est une LECTURE (lignes f, g)', () => {
	for (const [ligne, indice] of [
		['ligne f', 2],
		['ligne g', 1],
	] as const) {
		test(`${ligne} — un ${COMPTES_SEED[indice].role} du workspace compare`, async ({ request }) => {
			const jetonAdmin = await jetonDe(COMPTES_SEED[0].adresse)
			const jetonLecteur = await jetonDe(COMPTES_SEED[indice].adresse)
			const workflow = await workflowJetable(request, `Comparaison — ${ligne} ${randomUUID()}`)
			try {
				const avant = await publier(request, jetonAdmin, workflow)
				await etapeJetable(request, workflow, NOEUD_PROSPECTION, 1, true)
				const apres = await publier(request, jetonAdmin, workflow)

				// Comparer suit la politique de LECTURE de `workflow_versions`, et non le droit
				// d'administration qu'exige la publication : sans cette ligne, les refus seraient
				// verts sur un produit où personne ne peut comparer.
				const reponse = await request.post(RPC_COMPARER, {
					headers: enTetesAuthentifies(jetonLecteur),
					data: { base_version_id: avant, target_version_id: apres },
				})
				expect(reponse.status()).toBe(200)
				expect(((await reponse.json()) as Comparaison).summary.added).toBe(1)
			} finally {
				await rendreLaBase(request, workflow)
			}
		})
	}
})

test.describe('N3 — les quatre refus (lignes h, i, j, k, l)', () => {
	test('ligne h — une version de base inexistante rend « version introuvable »', async ({
		request,
	}) => {
		const jeton = await jetonDe(COMPTES_SEED[0].adresse)
		const workflow = await workflowJetable(request, `Comparaison — ligne h ${randomUUID()}`)
		try {
			const version = await publier(request, jeton, workflow)
			const reponse = await request.post(RPC_COMPARER, {
				headers: enTetesAuthentifies(jeton),
				data: { base_version_id: randomUUID(), target_version_id: version },
			})
			expect(reponse.status()).toBe(400)
			const corps = (await reponse.json()) as { code: string; message: string }
			expect(corps.code).toBe('P0001')
			expect(corps.message).toBe('version introuvable')
		} finally {
			await rendreLaBase(request, workflow)
		}
	})

	test('ligne i — une version CIBLE inexistante rend le MÊME message', async ({ request }) => {
		const jeton = await jetonDe(COMPTES_SEED[0].adresse)
		const workflow = await workflowJetable(request, `Comparaison — ligne i ${randomUUID()}`)
		try {
			const version = await publier(request, jeton, workflow)
			const reponse = await request.post(RPC_COMPARER, {
				headers: enTetesAuthentifies(jeton),
				data: { base_version_id: version, target_version_id: randomUUID() },
			})
			expect(reponse.status()).toBe(400)
			const corps = (await reponse.json()) as { code: string; message: string }
			expect(corps.code).toBe('P0001')
			// La fonction ne dit pas LAQUELLE des deux lui manque : elle n'est pas un oracle.
			expect(corps.message).toBe('version introuvable')
		} finally {
			await rendreLaBase(request, workflow)
		}
	})

	test('ligne j — une version d’un AUTRE workspace rend le même message : preuve de refus n° 3', async ({
		request,
	}) => {
		const jeton = await jetonDe(COMPTES_SEED[0].adresse)
		const workflow = await workflowJetable(request, `Comparaison — ligne j ${randomUUID()}`)
		// Le seed ne porte qu'UN workspace : le second est donc créé ici, par la clé de service, et
		// démonté dans le `finally`. Sa version est insérée directement — c'est le seul chemin, la
		// RPC de publication exigeant un appelant authentifié, et l'objet de la preuve n'étant pas
		// la publication mais la LECTURE que l'administratrice de l'autre workspace n'obtient pas.
		const workspaceEtranger = randomUUID()
		const workflowEtranger = randomUUID()
		const versionEtrangere = randomUUID()
		try {
			const mienne = await publier(request, jeton, workflow)

			expect(
				(
					await request.post(WORKSPACES, {
						headers: enTetesService(),
						data: {
							id: workspaceEtranger,
							name: `Ailleurs ${randomUUID()}`,
							slug: `ailleurs-${workspaceEtranger}`,
						},
					})
				).status(),
			).toBe(201)
			expect(
				(
					await request.post(WF, {
						headers: enTetesService(),
						data: {
							id: workflowEtranger,
							workspace_id: workspaceEtranger,
							name: 'Workflow d’ailleurs',
							scope: 'global',
							is_default: false,
						},
					})
				).status(),
			).toBe(201)
			expect(
				(
					await request.post(VERSIONS, {
						headers: enTetesService(),
						data: {
							id: versionEtrangere,
							workspace_id: workspaceEtranger,
							workflow_id: workflowEtranger,
							version_number: 1,
							composition: { workflow: { id: workflowEtranger } },
							composition_fingerprint: '0'.repeat(64),
						},
					})
				).status(),
			).toBe(201)

			// La ligne EXISTE — constatée avec la clé de service ci-dessus —, sans quoi le refus
			// serait vrai par simple absence et ne prouverait rien (décision 50).
			const reponse = await request.post(RPC_COMPARER, {
				headers: enTetesAuthentifies(jeton),
				data: { base_version_id: mienne, target_version_id: versionEtrangere },
			})
			expect(reponse.status()).toBe(400)
			const corps = (await reponse.json()) as { code: string; message: string }
			expect(corps.code).toBe('P0001')
			expect(corps.message).toBe('version introuvable')
		} finally {
			await request.delete(`${WORKSPACES}?id=eq.${workspaceEtranger}`, {
				headers: enTetesService(),
			})
			await rendreLaBase(request, workflow)
		}
	})

	test('ligne k — deux versions de workflows DIFFÉRENTS sont refusées', async ({ request }) => {
		const jeton = await jetonDe(COMPTES_SEED[0].adresse)
		const premier = await workflowJetable(request, `Comparaison — ligne k1 ${randomUUID()}`)
		const second = await workflowJetable(request, `Comparaison — ligne k2 ${randomUUID()}`)
		try {
			const versionPremier = await publier(request, jeton, premier)
			await etapeJetable(request, second, NOEUD_PROSPECTION, 1, true)
			const versionSecond = await publier(request, jeton, second)

			const reponse = await request.post(RPC_COMPARER, {
				headers: enTetesAuthentifies(jeton),
				data: { base_version_id: versionPremier, target_version_id: versionSecond },
			})
			expect(reponse.status()).toBe(400)
			const corps = (await reponse.json()) as { code: string; message: string }
			expect(corps.code).toBe('P0001')
			expect(corps.message).toBe('versions de workflows differents')
		} finally {
			await rendreLaBase(request, premier)
			await rendreLaBase(request, second)
		}
	})

	test('ligne l — l’appelant anonyme obtient 401 : le privilège refuse avant la vérification 1', async ({
		request,
	}) => {
		const reponse = await request.post(RPC_COMPARER, {
			headers: enTetesAnonymes(),
			data: { base_version_id: randomUUID(), target_version_id: randomUUID() },
		})
		expect(reponse.status()).toBe(401)
	})
})
