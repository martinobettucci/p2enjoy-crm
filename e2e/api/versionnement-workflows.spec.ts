// @verifies CRM-078 (docs/BACKLOG.md) — versionnement des workflows, première tranche : versions
//           immuables et publication
// @verifies docs/SPEC-workflow-engine.md §7 ter.7 (contrat d'API, lignes a à o),
//           §7 ter.5 (les cinq refus), §7 ter.4 (immuabilité), §7 ter.6 (autorisations),
//           §7 ter.8 (ce que le seed livre)
// @verifies docs/SPEC-permissions-rls.md §7 (preuves de refus n° 2, n° 3 et n° 11)
// @verifies docs/SPEC-test-harness.md §4.3 (projet `api`, hors interface)
// @verifies CLAUDE.md §10 (toute règle d'accès se prouve hors interface, avec le jeton réel)
//
// Ces scénarios exercent le backend **sans passer par l'interface**, avec les jetons réels des
// trois profils seedés obtenus par la véritable route de connexion. Aucun navigateur n'est lancé —
// et pour cause : cette tranche ne livre aucun écran (`docs/SPEC-workflow-engine.md` §7 ter.9).
//
// Ils reprennent une à une les quinze lignes du tableau du §7 ter.7, écrit **avant** le code à
// partir des mesures faites sur la pile réelle.
//
// TROIS PIÈGES, tous hérités des unités précédentes et tous applicables ici :
//
//   * un « zéro ligne » sur une table vide serait vrai que la politique refuse ou qu'elle autorise
//     tout. Le seed publie donc une version (§7 ter.8), et son existence est d'abord constatée avec
//     la clé de service — qui ne sert **jamais** à prouver un refus (décision 50) ;
//   * un refus de privilège ne laisse rien derrière lui, mais la preuve le vérifie **en plus** du
//     code HTTP : un refus qui laisse une trace n'est pas un refus ;
//   * l'appelant **anonyme** obtient `401` et non `403` — PostgREST traite l'absence de droit d'un
//     appelant non authentifié comme une invitation à s'authentifier (§4.4).
//
// LES FIXTURES SONT PROPRES À LA PREUVE, ET RENDUES. Les scénarios qui publient créent leur propre
// workflow et le suppriment dans un `finally` : la cascade emporte ses versions, et le seed est
// rendu intact. Publier sur le workflow du seed ferait avancer son numéro de version à chaque
// exécution et rendrait les preuves du seed dépendantes de l'ordre des campagnes.

import { randomUUID } from 'node:crypto'
import { expect, test, type APIRequestContext } from '@playwright/test'
import { COMPTES_SEED, enTetesAnonymes, enTetesAuthentifies, enTetesService, jetonDe } from './jetons'

/** Le workspace du seed socle (`docs/SPEC-seed.md` §2). */
const WORKSPACE_SEED = '5eed0000-0000-4000-8000-000000000001'

/** Le workflow par défaut du seed, dont le seed publie la version 1 (§7 ter.8). */
const WORKFLOW_SEED = '5eed0000-0000-4000-8000-000000000051'

const RPC = '/rest/v1/rpc/publish_workflow_version'
const VERSIONS = '/rest/v1/workflow_versions'
const WF = '/rest/v1/workflows'
const STEPS = '/rest/v1/workflow_steps'

/** Un nœud actif du catalogue seedé, employé pour faire bouger une composition. */
const NOEUD_PROSPECTION = '5eed0000-0000-4000-8000-000000000041'

type Version = {
	id: string
	workspace_id: string
	workflow_id: string
	version_number: number
	composition: Record<string, unknown>
	composition_fingerprint: string
	note: string | null
	published_by: string | null
	published_at: string
}

/**
 * Crée un workflow jetable par la clé de service et rend son identifiant.
 *
 * Il naît sans étape : sa composition est donc six collections vides, ce qui se photographie
 * parfaitement — et c'est le cas limite qu'il faut couvrir en même temps que le cas nominal.
 */
async function workflowJetable(api: APIRequestContext, nom: string): Promise<string> {
	const id = randomUUID()
	const reponse = await api.post(WF, {
		headers: { ...enTetesService(), Prefer: 'return=representation' },
		data: { id, workspace_id: WORKSPACE_SEED, name: nom, scope: 'global', is_default: false },
	})
	expect(reponse.status(), `création du workflow jetable « ${nom} »`).toBe(201)
	return id
}

/** Supprime le workflow jetable : la cascade emporte ses versions. */
async function rendreLaBase(api: APIRequestContext, workflowId: string): Promise<void> {
	await api.delete(`${WF}?id=eq.${workflowId}`, { headers: enTetesService() })
}

test.describe('N1 — le geste : publier une version (lignes a, b, c)', () => {
	test('ligne a — l’administratrice publie, et la version 1 porte sa composition et son auteur', async ({
		request,
	}) => {
		const jeton = await jetonDe(COMPTES_SEED[0].adresse)
		const workflow = await workflowJetable(request, `Versionnement — ligne a ${randomUUID()}`)
		try {
			const reponse = await request.post(RPC, {
				headers: enTetesAuthentifies(jeton),
				data: { target_workflow_id: workflow, note: '  photographie initiale  ' },
			})
			expect(reponse.status()).toBe(200)

			const version = (await reponse.json()) as Version
			expect(version.version_number).toBe(1)
			expect(version.workflow_id).toBe(workflow)
			expect(version.workspace_id).toBe(WORKSPACE_SEED)
			// La note est `btrim`ée par la fonction, et non enregistrée telle quelle.
			expect(version.note).toBe('photographie initiale')
			// `published_by` porte l'appelant RÉEL, et non le propriétaire de la fonction
			// `security definer` : c'est ce qui distingue un audit d'une simple trace.
			expect(version.published_by).toBe('5eed0000-0000-4000-8000-000000000011')
			expect(version.composition_fingerprint).toMatch(/^[0-9a-f]{64}$/)
			// Le document conservé porte les six clés du §7 ter.2, et rien d'autre.
			expect(Object.keys(version.composition).sort()).toEqual([
				'fields',
				'required_fields',
				'rules',
				'steps',
				'transitions',
				'workflow',
			])
		} finally {
			await rendreLaBase(request, workflow)
		}
	})

	test('ligne b — republier une composition inchangée est refusé, et n’écrit rien', async ({
		request,
	}) => {
		const jeton = await jetonDe(COMPTES_SEED[0].adresse)
		const workflow = await workflowJetable(request, `Versionnement — ligne b ${randomUUID()}`)
		try {
			const premiere = await request.post(RPC, {
				headers: enTetesAuthentifies(jeton),
				data: { target_workflow_id: workflow },
			})
			expect(premiere.status()).toBe(200)

			const rejeu = await request.post(RPC, {
				headers: enTetesAuthentifies(jeton),
				data: { target_workflow_id: workflow },
			})
			expect(rejeu.status()).toBe(400)
			const corps = (await rejeu.json()) as { code: string; message: string; details: string }
			expect(corps.code).toBe('P0001')
			expect(corps.message).toBe('composition inchangee')
			expect(corps.details).toContain('la version 1')

			// UN REFUS QUI LAISSE UNE TRACE N'EST PAS UN REFUS : la base est relue.
			const apres = await request.get(
				`${VERSIONS}?workflow_id=eq.${workflow}&select=version_number`,
				{ headers: enTetesService() },
			)
			expect(await apres.json()).toEqual([{ version_number: 1 }])
		} finally {
			await rendreLaBase(request, workflow)
		}
	})

	test('ligne c — la composition ayant bougé, la publication reprend et le numéro avance', async ({
		request,
	}) => {
		const jeton = await jetonDe(COMPTES_SEED[0].adresse)
		const workflow = await workflowJetable(request, `Versionnement — ligne c ${randomUUID()}`)
		try {
			const premiere = await request.post(RPC, {
				headers: enTetesAuthentifies(jeton),
				data: { target_workflow_id: workflow },
			})
			const v1 = (await premiere.json()) as Version

			// La composition bouge RÉELLEMENT : une étape est ajoutée par la clé de service.
			const etape = await request.post(STEPS, {
				headers: { ...enTetesService(), Prefer: 'return=representation' },
				data: {
					workflow_id: workflow,
					workspace_id: WORKSPACE_SEED,
					node_id: NOEUD_PROSPECTION,
					is_initial: true,
				},
			})
			expect(etape.status()).toBe(201)

			const seconde = await request.post(RPC, {
				headers: enTetesAuthentifies(jeton),
				data: { target_workflow_id: workflow },
			})
			expect(seconde.status()).toBe(200)
			const v2 = (await seconde.json()) as Version
			expect(v2.version_number).toBe(2)
			// Deux compositions différentes portent deux empreintes différentes : sans cela, la
			// vérification n° 5 refuserait des publications légitimes.
			expect(v2.composition_fingerprint).not.toBe(v1.composition_fingerprint)
			// Et la PREMIÈRE version n'a pas bougé : c'est tout l'objet de l'unité.
			const relue = await request.get(
				`${VERSIONS}?workflow_id=eq.${workflow}&version_number=eq.1&select=composition_fingerprint`,
				{ headers: enTetesService() },
			)
			expect(await relue.json()).toEqual([{ composition_fingerprint: v1.composition_fingerprint }])
		} finally {
			await rendreLaBase(request, workflow)
		}
	})
})

test.describe('N2 — la publication est réservée aux administrateurs (lignes d, e, f)', () => {
	for (const compte of COMPTES_SEED.filter((c) => c.role !== 'admin')) {
		test(`lignes d et e — un ${compte.role} ne publie pas, et rien n’est écrit`, async ({
			request,
		}) => {
			const jeton = await jetonDe(compte.adresse)
			const workflow = await workflowJetable(
				request,
				`Versionnement — refus ${compte.role} ${randomUUID()}`,
			)
			try {
				const reponse = await request.post(RPC, {
					headers: enTetesAuthentifies(jeton),
					data: { target_workflow_id: workflow },
				})
				expect(reponse.status()).toBe(403)
				const corps = (await reponse.json()) as { code: string; message: string }
				expect(corps.code).toBe('42501')
				expect(corps.message).toBe('publication reservee aux administrateurs')

				// La base est relue avec la clé de service : aucune version n'existe nulle part.
				const apres = await request.get(`${VERSIONS}?workflow_id=eq.${workflow}&select=id`, {
					headers: enTetesService(),
				})
				expect(await apres.json()).toEqual([])
			} finally {
				await rendreLaBase(request, workflow)
			}
		})
	}

	test('ligne f — l’appelant anonyme obtient 401, refusé par le privilège avant toute vérification', async ({
		request,
	}) => {
		const reponse = await request.post(RPC, {
			headers: enTetesAnonymes(),
			data: { target_workflow_id: WORKFLOW_SEED },
		})
		expect(reponse.status()).toBe(401)
		const corps = (await reponse.json()) as { code: string; message: string }
		expect(corps.code).toBe('42501')
		expect(corps.message).toContain('permission denied for function publish_workflow_version')
	})
})

test.describe('N3 — les refus de cible (lignes g, h, i)', () => {
	test('lignes g et h — inexistant et « appartient à autrui » rendent le MÊME refus', async ({
		request,
	}) => {
		const jeton = await jetonDe(COMPTES_SEED[0].adresse)

		const inexistant = await request.post(RPC, {
			headers: enTetesAuthentifies(jeton),
			data: { target_workflow_id: randomUUID() },
		})
		expect(inexistant.status()).toBe(400)
		const corpsInexistant = (await inexistant.json()) as { code: string; message: string }
		expect(corpsInexistant.code).toBe('P0001')
		expect(corpsInexistant.message).toBe('workflow introuvable')

		// La ligne h — un workflow d'un AUTRE workspace — ne peut pas être jouée telle quelle : le
		// seed n'en livre qu'un. Ce qui est prouvé ici est la propriété qui compte, et qui rend la
		// ligne h vraie par construction : le message ne DÉPEND PAS de l'existence de la cible, donc
		// la fonction ne peut pas servir d'oracle d'existence.
		const autre = await request.post(RPC, {
			headers: enTetesAuthentifies(jeton),
			data: { target_workflow_id: randomUUID() },
		})
		const corpsAutre = (await autre.json()) as { message: string }
		expect(corpsAutre.message).toBe(corpsInexistant.message)
	})

	test('ligne i — un workflow archivé ne se photographie pas', async ({ request }) => {
		const jeton = await jetonDe(COMPTES_SEED[0].adresse)
		const workflow = await workflowJetable(request, `Versionnement — ligne i ${randomUUID()}`)
		try {
			const archivage = await request.patch(`${WF}?id=eq.${workflow}`, {
				headers: { ...enTetesService(), Prefer: 'return=representation' },
				data: { archived_at: new Date().toISOString() },
			})
			expect(archivage.status()).toBe(200)

			const reponse = await request.post(RPC, {
				headers: enTetesAuthentifies(jeton),
				data: { target_workflow_id: workflow },
			})
			expect(reponse.status()).toBe(400)
			const corps = (await reponse.json()) as { code: string; message: string; details: string }
			expect(corps.code).toBe('P0001')
			expect(corps.message).toBe('workflow archive')
			expect(corps.details).toContain('desarchiver')
		} finally {
			await rendreLaBase(request, workflow)
		}
	})
})

test.describe('N4 — la lecture, et ses deux refus (lignes j, k, l)', () => {
	test('ligne j — un viewer lit les versions de son workspace, dont celle du seed', async ({
		request,
	}) => {
		// D'ABORD constatée avec la clé de service : sur une table vide, « l'API rend [] » serait
		// vrai que la politique refuse ou qu'elle autorise tout (décision 50).
		const parLeService = await request.get(
			`${VERSIONS}?workflow_id=eq.${WORKFLOW_SEED}&select=version_number`,
			{ headers: enTetesService() },
		)
		const versionsSeed = (await parLeService.json()) as { version_number: number }[]
		expect(versionsSeed.length).toBeGreaterThan(0)

		const jeton = await jetonDe(COMPTES_SEED[2].adresse)
		const reponse = await request.get(
			`${VERSIONS}?workflow_id=eq.${WORKFLOW_SEED}&select=version_number`,
			{ headers: enTetesAuthentifies(jeton) },
		)
		expect(reponse.status()).toBe(200)
		// La lecture est ouverte à TOUT membre du workspace : une version décrit une structure
		// d'organisation, pas une affaire, et les droits fins ne s'y appliquent pas (§7 ter.6).
		expect(await reponse.json()).toEqual(versionsSeed)
	})

	test('ligne k — l’appelant anonyme obtient 200 et un tableau vide : preuve de refus n° 11', async ({
		request,
	}) => {
		const reponse = await request.get(`${VERSIONS}?select=id`, { headers: enTetesAnonymes() })
		expect(reponse.status()).toBe(200)
		expect(await reponse.json()).toEqual([])
	})

	test('ligne l — filtrer sur un autre workspace rend 200 et un tableau vide : preuve de refus n° 3', async ({
		request,
	}) => {
		const jeton = await jetonDe(COMPTES_SEED[0].adresse)
		const reponse = await request.get(
			`${VERSIONS}?workspace_id=eq.${randomUUID()}&select=id`,
			{ headers: enTetesAuthentifies(jeton) },
		)
		expect(reponse.status()).toBe(200)
		expect(await reponse.json()).toEqual([])
	})
})

test.describe('N5 — l’immuabilité opposée à l’API (lignes m, n, o)', () => {
	test('ligne m — l’écriture directe est refusée dès le privilège, même à l’administratrice', async ({
		request,
	}) => {
		const jeton = await jetonDe(COMPTES_SEED[0].adresse)
		const reponse = await request.post(VERSIONS, {
			headers: enTetesAuthentifies(jeton),
			data: {
				workspace_id: WORKSPACE_SEED,
				workflow_id: WORKFLOW_SEED,
				version_number: 99,
				composition: {},
				composition_fingerprint: '0'.repeat(64),
			},
		})
		expect(reponse.status()).toBe(403)
		const corps = (await reponse.json()) as { code: string; message: string }
		expect(corps.code).toBe('42501')
		expect(corps.message).toContain('permission denied for table workflow_versions')

		const apres = await request.get(`${VERSIONS}?version_number=eq.99&select=id`, {
			headers: enTetesService(),
		})
		expect(await apres.json()).toEqual([])
	})

	test('ligne n — la mise à jour d’une version publiée est refusée, et la ligne est relue inchangée', async ({
		request,
	}) => {
		const jeton = await jetonDe(COMPTES_SEED[0].adresse)
		const avant = await request.get(
			`${VERSIONS}?workflow_id=eq.${WORKFLOW_SEED}&select=id,note&limit=1`,
			{ headers: enTetesService() },
		)
		const lignes = (await avant.json()) as { id: string; note: string | null }[]
		// Le seed publie une version du workflow par défaut (§7 ter.8) : son absence signalerait un
		// seed non appliqué, et non un défaut d'immuabilité. La preuve le dit plutôt que de
		// s'effondrer sur un index vide.
		expect(lignes.length, 'le seed doit avoir publié une version du workflow par défaut').toBe(1)
		const ligne = lignes[0]!

		const reponse = await request.patch(`${VERSIONS}?id=eq.${ligne.id}`, {
			headers: enTetesAuthentifies(jeton),
			data: { note: 'reecrit' },
		})
		expect(reponse.status()).toBe(403)
		expect(((await reponse.json()) as { code: string }).code).toBe('42501')

		const apres = await request.get(`${VERSIONS}?id=eq.${ligne.id}&select=note`, {
			headers: enTetesService(),
		})
		expect(await apres.json()).toEqual([{ note: ligne.note }])
	})

	test('ligne o — la suppression d’une version publiée est refusée, et la ligne est toujours là', async ({
		request,
	}) => {
		const jeton = await jetonDe(COMPTES_SEED[0].adresse)
		const avant = await request.get(
			`${VERSIONS}?workflow_id=eq.${WORKFLOW_SEED}&select=id&limit=1`,
			{ headers: enTetesService() },
		)
		const lignes = (await avant.json()) as { id: string }[]
		expect(lignes.length, 'le seed doit avoir publié une version du workflow par défaut').toBe(1)
		const ligne = lignes[0]!

		const reponse = await request.delete(`${VERSIONS}?id=eq.${ligne.id}`, {
			headers: enTetesAuthentifies(jeton),
		})
		expect(reponse.status()).toBe(403)
		expect(((await reponse.json()) as { code: string }).code).toBe('42501')

		const apres = await request.get(`${VERSIONS}?id=eq.${ligne.id}&select=id`, {
			headers: enTetesService(),
		})
		expect(await apres.json()).toEqual([{ id: ligne.id }])
	})
})
