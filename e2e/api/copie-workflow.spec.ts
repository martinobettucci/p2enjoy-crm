// @verifies CRM-032 (docs/BACKLOG.md) — copie d'un workflow vers un track, lignage, divergence
// @verifies docs/SPEC-workflow-engine.md §4.9 (contrat d'API, lignes a à p), §4.3 (refus),
//           §4.5 (ce qui est copié), §4.6 (vue de divergence), §4.10 (seed)
// @verifies docs/SPEC-permissions-rls.md §7 (preuves de refus n° 2 et n° 11)
// @verifies docs/SPEC-test-harness.md §4.3 (projet `api`, hors interface)
// @verifies docs/INCONSISTENCY_REPORT.md INC-037 (formulaire remappé), INC-038 (suppression
//           détectée), INC-056 (liaison remappée)
// @verifies CLAUDE.md §10 (toute règle d'accès se prouve hors interface, avec le jeton réel)
//
// Ces scénarios exercent le backend **sans passer par l'interface**, avec les jetons réels des
// trois profils seedés, obtenus par la véritable route de connexion. Aucun navigateur n'est lancé —
// et pour cause : cette unité ne livre aucun écran (INC-021).
//
// Ils reprennent une à une les seize lignes du tableau de `docs/SPEC-workflow-engine.md` §4.9,
// écrit avant le code à partir des mesures faites sur la pile réelle.
//
// TROIS PIÈGES, dont deux hérités et un propre à cette unité :
//
//   * un « zéro ligne » sur une table vide serait vrai que la RLS refuse ou qu'elle autorise tout.
//     L'état de la base est donc d'abord constaté avec la clé de service, qui ne sert **jamais** à
//     prouver un refus (décision 50) ;
//   * une écriture refusée par une politique ne lève **aucune erreur** : la preuve relit et
//     constate (décision 70). Ici, le refus vient d'un `raise` explicite, donc d'un vrai code
//     HTTP — mais la preuve vérifie **en plus** qu'aucune ligne n'a été créée, car un refus qui
//     laisse une trace n'est pas un refus ;
//   * l'appelant **anonyme** obtient `401` et non `403` — mesuré : PostgREST traite l'absence de
//     droit d'un appelant non authentifié comme une invitation à s'authentifier
//     (`docs/SPEC-workflow-engine.md` §4.4).

import { randomUUID } from 'node:crypto'
import { expect, test, type APIRequestContext } from '@playwright/test'
import { COMPTES_SEED, enTetesAnonymes, enTetesAuthentifies, enTetesService, jetonDe } from './jetons'

/** Le workspace du seed socle (`docs/SPEC-seed.md` §2). */
const WORKSPACE_SEED = '5eed0000-0000-4000-8000-000000000001'

/** Le workflow par défaut du seed, sa source de copie (`docs/SPEC-workflow-engine.md` §3.9). */
const WORKFLOW_SEED = '5eed0000-0000-4000-8000-000000000051'
const NOM_COPIE_SEED = 'Cycle commercial — Conseil IA'

/** Les tracks du seed : « Conseil & IA », actif, et « Pipeline 2024 », archivé. */
const TRACK_CONSEIL = '5eed0000-0000-4000-8000-000000000021'
const TRACK_STUDIO = '5eed0000-0000-4000-8000-000000000022'
const TRACK_ARCHIVE = '5eed0000-0000-4000-8000-000000000024'

const RPC = '/rest/v1/rpc/copy_workflow_to_track'
const WF = '/rest/v1/workflows'
const STEPS = '/rest/v1/workflow_steps'
const TRANSITIONS = '/rest/v1/workflow_transitions'
const FIELDS = '/rest/v1/form_fields'
const FIELD_RULES = '/rest/v1/form_field_rules'
const REQUIRED_FIELDS = '/rest/v1/workflow_transition_required_fields'
const DERIVATIONS = '/rest/v1/workflow_derivations'

type Derivation = {
	workflow_id: string
	name: string
	derived_at: string
	source_workflow_id: string
	source_name: string
	source_modified_at: string
	source_composition_fingerprint: string
	current_source_composition_fingerprint: string
	source_modified_since_copy: boolean
}

type Erreur = { code: string; message: string }

/**
 * Appelle la RPC et rend le couple (statut, corps).
 *
 * Le corps d'un succès est l'identifiant de la copie, une chaîne JSON ; celui d'un refus est
 * l'objet d'erreur de PostgREST. Les deux sont rendus tels quels, les scénarios n'ayant pas les
 * mêmes attentes.
 */
async function copier(
	requete: APIRequestContext,
	enTetes: Record<string, string>,
	corps: Record<string, unknown>,
): Promise<{ statut: number; texte: string }> {
	const reponse = await requete.post(RPC, {
		headers: { ...enTetes, 'Content-Type': 'application/json' },
		data: corps,
	})
	return { statut: reponse.status(), texte: await reponse.text() }
}

/** Supprime une copie avec la clé de service : aucun client n'a le privilège de le faire. */
async function retirerCopie(requete: APIRequestContext, id: string): Promise<void> {
	const reponse = await requete.delete(`${WF}?id=eq.${id}`, { headers: enTetesService() })
	expect(reponse.status(), 'le ménage doit réussir, sans quoi le scénario suivant part faussé')
		.toBeLessThan(300)
}

test.describe('C1 — la copie, et ce qu’elle contient (§4.9, lignes a, b, l)', () => {
	test('ligne a — un administrateur copie le workflow, avec ses étapes et ses arêtes', async ({
		request,
	}) => {
		const jeton = await jetonDe(COMPTES_SEED[0].adresse)

		const { statut, texte } = await copier(request, enTetesAuthentifies(jeton), {
			workflow_id: WORKFLOW_SEED,
			track_id: TRACK_STUDIO,
			new_name: 'Copie C1 — Studio web',
		})
		expect(statut, 'la copie doit réussir').toBe(200)

		const copieId = JSON.parse(texte) as string
		expect(copieId, 'la fonction rend l’identifiant de la copie').toMatch(/^[0-9a-f-]{36}$/)

		try {
			// La copie est relue par l'API, avec le jeton de l'administrateur : ce que le produit
			// expose, et non ce que la base contient.
			const lue = await request.get(`${WF}?id=eq.${copieId}&select=*`, {
				headers: enTetesAuthentifies(jeton),
			})
			expect(lue.status()).toBe(200)
			const copie = ((await lue.json()) as {
				name: string
				scope: string
				track_id: string
				is_default: boolean
				derived_from_workflow_id: string
				derived_at: string | null
				source_composition_fingerprint: string | null
			}[])[0]!

			expect(copie.name).toBe('Copie C1 — Studio web')
			expect(copie.scope, 'la copie est de portée `track`').toBe('track')
			expect(copie.track_id, 'et rattachée au track demandé').toBe(TRACK_STUDIO)
			expect(copie.derived_from_workflow_id, 'le lignage est renseigné').toBe(WORKFLOW_SEED)
			expect(copie.derived_at, 'et sa date aussi').not.toBeNull()
			expect(
				copie.source_composition_fingerprint,
				'la copie mémorise une empreinte SHA-256 de sa source',
			).toMatch(/^[0-9a-f]{64}$/)

			// Le workflow du seed porte sept étapes et onze transitions (§3.9). La copie doit en
			// porter autant, et ses arêtes doivent pointer vers ses propres étapes.
			const etapes = await request.get(
				`${STEPS}?workflow_id=eq.${copieId}&select=id,node_id,position,is_initial,label_override,stale_after_days&order=position`,
				{ headers: enTetesAuthentifies(jeton) },
			)
			const listeEtapes = (await etapes.json()) as {
				id: string
				node_id: string
				position: number
				is_initial: boolean
				label_override: string | null
				stale_after_days: number | null
			}[]
			expect(listeEtapes, 'sept étapes copiées').toHaveLength(7)
			expect(listeEtapes.filter((e) => e.is_initial), 'une seule initiale').toHaveLength(1)
			expect(
				listeEtapes.map((e) => e.position),
				'les positions sont celles de la source, dans l’ordre',
			).toEqual([1, 2, 3, 4, 5, 6, 7])
			expect(
				listeEtapes.filter((e) => e.label_override !== null || e.stale_after_days !== null),
				'les deux surcharges du seed suivent la copie',
			).toHaveLength(2)

			const aretes = await request.get(
				`${TRANSITIONS}?workflow_id=eq.${copieId}&select=id,from_step_id,to_step_id,label,require_comment`,
				{ headers: enTetesAuthentifies(jeton) },
			)
			const listeAretes = (await aretes.json()) as {
				id: string
				from_step_id: string
				to_step_id: string
				label: string | null
				require_comment: boolean
			}[]
			expect(listeAretes, 'onze arêtes copiées').toHaveLength(11)
			expect(
				listeAretes.filter((t) => t.require_comment),
				'dont les cinq qui exigent un commentaire',
			).toHaveLength(5)

			// LE POINT CENTRAL : aucune extrémité ne sort de la copie.
			const idsCopie = new Set(listeEtapes.map((e) => e.id))
			const horsCopie = listeAretes.filter(
				(t) => !idsCopie.has(t.from_step_id) || !idsCopie.has(t.to_step_id),
			)
			expect(horsCopie, 'aucune arête ne pointe vers une étape restée dans la source').toHaveLength(0)

			// CRM-018 ferme INC-037 et INC-056 ensemble : formulaire et exigence sont remappés.
			const idsAretes = listeAretes.map((t) => t.id).join(',')
			const exigeantes = await request.get(
				`${REQUIRED_FIELDS}?transition_id=in.(${idsAretes})&select=transition_id`,
				{ headers: enTetesService() },
			)
			expect(exigeantes.status()).toBe(200)
			expect(
				(await exigeantes.json()) as unknown[],
				'CRM-018 / INC-056 : la copie reçoit son exigence fonctionnelle',
			).toHaveLength(1)

			const champsDeLaCopie = await request.get(
				`${FIELDS}?workflow_id=eq.${copieId}&select=id,key,type,position,archived_at&order=position`,
				{ headers: enTetesService() },
			)
			expect(champsDeLaCopie.status()).toBe(200)
			const champsCopies = (await champsDeLaCopie.json()) as { id: string; key: string }[]
			// NEUF depuis la sous-tranche 4d de `CRM-060` (docs/SPEC-contacts.md §13.6) : le seed
			// source porte deux champs de plus, et la copie du produit les recopie comme les autres.
			expect(
				champsCopies,
				'les neuf champs de la source, archivé compris, sont copiés',
			).toHaveLength(9)

			const champsSource = await request.get(
				`${FIELDS}?workflow_id=eq.${WORKFLOW_SEED}&select=id,key`,
				{ headers: enTetesService() },
			)
			expect(champsSource.status()).toBe(200)
			const idsSource = new Set(
				((await champsSource.json()) as { id: string }[]).map((champ) => champ.id),
			)
			expect(
				champsCopies.filter((champ) => idsSource.has(champ.id)),
				'aucun identifiant de champ n’est partagé avec la source',
			).toHaveLength(0)

			const regles = await request.get(
				`${FIELD_RULES}?workflow_id=eq.${copieId}&select=field_id,step_id,visibility`,
				{ headers: enTetesService() },
			)
			expect(regles.status()).toBe(200)
			expect(
				(await regles.json()) as unknown[],
				'les quinze règles sont remappées avec le formulaire',
			).toHaveLength(15)
		} finally {
			await retirerCopie(request, copieId)
		}
	})

	test('ligne b — `new_name` omis : la copie reprend le nom de sa source', async ({ request }) => {
		const jeton = await jetonDe(COMPTES_SEED[0].adresse)
		const { statut, texte } = await copier(request, enTetesAuthentifies(jeton), {
			workflow_id: WORKFLOW_SEED,
			track_id: TRACK_STUDIO,
		})
		expect(statut).toBe(200)
		const copieId = JSON.parse(texte) as string

		try {
			const lue = await request.get(`${WF}?id=eq.${copieId}&select=name`, {
				headers: enTetesAuthentifies(jeton),
			})
			const copie = ((await lue.json()) as { name: string }[])[0]!
			expect(copie.name, 'le nom de la source est repris tel quel').toBe(
				'Cycle commercial standard',
			)
		} finally {
			await retirerCopie(request, copieId)
		}
	})

	test('ligne l — copier le workflow **par défaut** ne produit pas un second défaut', async ({
		request,
	}) => {
		const jeton = await jetonDe(COMPTES_SEED[0].adresse)

		// L'état de départ est constaté avec la clé de service : le workflow du seed est bien celui
		// par défaut. Sans cette constatation, « la copie n'est pas par défaut » serait vrai même si
		// la source ne l'était pas.
		const source = await request.get(`${WF}?id=eq.${WORKFLOW_SEED}&select=is_default`, {
			headers: enTetesService(),
		})
		const ligneSource = ((await source.json()) as { is_default: boolean }[])[0]!
		expect(ligneSource.is_default, 'la source est bien le workflow par défaut').toBe(true)

		const { statut, texte } = await copier(request, enTetesAuthentifies(jeton), {
			workflow_id: WORKFLOW_SEED,
			track_id: TRACK_STUDIO,
			new_name: 'Copie C1 — défaut',
		})
		expect(statut, 'la copie d’un workflow par défaut réussit').toBe(200)
		const copieId = JSON.parse(texte) as string

		try {
			const lue = await request.get(`${WF}?id=eq.${copieId}&select=is_default`, {
				headers: enTetesAuthentifies(jeton),
			})
			const copie = ((await lue.json()) as { is_default: boolean }[])[0]!
			expect(
				copie.is_default,
				'`is_default` est forcé à faux : copié tel quel, il serait refusé en 23505',
			).toBe(false)

			const defauts = await request.get(
				`${WF}?workspace_id=eq.${WORKSPACE_SEED}&is_default=is.true&select=id`,
				{ headers: enTetesService() },
			)
			expect(
				(await defauts.json()) as unknown[],
				'le workspace n’a toujours qu’un seul workflow par défaut',
			).toHaveLength(1)
		} finally {
			await retirerCopie(request, copieId)
		}
	})
})

test.describe('C2 — qui a le droit de copier (§4.9, lignes c, d, e)', () => {
	for (const compte of [COMPTES_SEED[1], COMPTES_SEED[2]]) {
		test(`lignes c et d — un ${compte.role} est refusé en 403, et rien n’est créé`, async ({
			request,
		}) => {
			const jeton = await jetonDe(compte.adresse)

			const avant = await request.get(
				`${WF}?workspace_id=eq.${WORKSPACE_SEED}&select=id`,
				{ headers: enTetesService() },
			)
			const nombreAvant = ((await avant.json()) as unknown[]).length

			const { statut, texte } = await copier(request, enTetesAuthentifies(jeton), {
				workflow_id: WORKFLOW_SEED,
				track_id: TRACK_STUDIO,
			})

			expect(statut, 'PREUVE DE REFUS N° 2 : copier, c’est écrire').toBe(403)
			const erreur = JSON.parse(texte) as Erreur
			expect(erreur.message, 'le message fait partie du contrat').toBe('forbidden')
			expect(erreur.code).toBe('42501')

			// Un refus qui laisse une trace n'est pas un refus.
			const apres = await request.get(`${WF}?workspace_id=eq.${WORKSPACE_SEED}&select=id`, {
				headers: enTetesService(),
			})
			expect(
				((await apres.json()) as unknown[]).length,
				'aucune ligne n’a été créée, constaté avec la clé de service',
			).toBe(nombreAvant)
		})
	}

	test('ligne e — l’anonyme est refusé par le privilège, avant tout contrôle', async ({
		request,
	}) => {
		const { statut, texte } = await copier(request, enTetesAnonymes(), {
			workflow_id: WORKFLOW_SEED,
			track_id: TRACK_STUDIO,
		})

		// MESURÉ : 401 et non 403. PostgREST traite l'absence de droit d'un appelant non
		// authentifié comme une invitation à s'authentifier (§4.4).
		expect(statut, 'refus par le privilège d’exécution, pas par le contrôle explicite').toBe(401)
		const erreur = JSON.parse(texte) as Erreur
		expect(erreur.code).toBe('42501')
		expect(
			erreur.message,
			'le message vient du moteur, pas de la fonction : elle n’a jamais été exécutée',
		).toContain('permission denied for function')
	})
})

test.describe('C3 — ce qui ne se copie pas (§4.9, lignes f, g, h, i, j, k)', () => {
	test('lignes f et g — un workflow d’un autre workspace est « introuvable », jamais « interdit »', async ({
		request,
	}) => {
		const jeton = await jetonDe(COMPTES_SEED[0].adresse)

		// Un workspace B et son workflow, posés avec la clé de service : aucune politique
		// n'autorise la création d'un workspace par un client (`CRM-012` en décidera).
		const workspaceB = 'c0b1e000-0000-4000-8000-000000000001'
		const workflowB = 'c0b1e000-0000-4000-8000-000000000002'
		await request.post('/rest/v1/workspaces', {
			headers: { ...enTetesService(), 'Content-Type': 'application/json' },
			data: { id: workspaceB, name: 'Workspace copie B', slug: 'tst-crm032-api-b' },
		})
		await request.post(WF, {
			headers: { ...enTetesService(), 'Content-Type': 'application/json' },
			data: { id: workflowB, workspace_id: workspaceB, name: 'Workflow de B' },
		})

		try {
			// L'existence de la ligne est d'abord constatée : sans cela, « introuvable » serait vrai
			// pour la mauvaise raison.
			const presence = await request.get(`${WF}?id=eq.${workflowB}&select=id`, {
				headers: enTetesService(),
			})
			expect((await presence.json()) as unknown[], 'le workflow de B existe bel et bien')
				.toHaveLength(1)

			const chezB = await copier(request, enTetesAuthentifies(jeton), {
				workflow_id: workflowB,
				track_id: TRACK_STUDIO,
			})
			expect(chezB.statut).toBe(400)
			expect(
				(JSON.parse(chezB.texte) as Erreur).message,
				'RÈGLE DE DISCRÉTION : « interdit » révélerait que la ligne existe',
			).toBe('workflow_not_found')

			const inconnu = await copier(request, enTetesAuthentifies(jeton), {
				workflow_id: '00000000-0000-4000-8000-0000000000ff',
				track_id: TRACK_STUDIO,
			})
			expect(inconnu.statut).toBe(400)
			expect(
				(JSON.parse(inconnu.texte) as Erreur).message,
				'un identifiant inventé rend exactement le même refus — c’est ce qui rend la règle effective',
			).toBe('workflow_not_found')
		} finally {
			await request.delete(`${WF}?id=eq.${workflowB}`, { headers: enTetesService() })
			await request.delete(`/rest/v1/workspaces?id=eq.${workspaceB}`, {
				headers: enTetesService(),
			})
		}
	})

	test('ligne h — un workflow archivé est introuvable', async ({ request }) => {
		const jeton = await jetonDe(COMPTES_SEED[0].adresse)

		// L'archivage passe par l'API, avec le jeton de l'administrateur : c'est le geste réel du
		// produit, et il est réversible.
		const archive = await request.patch(`${WF}?id=eq.${WORKFLOW_SEED}`, {
			headers: { ...enTetesAuthentifies(jeton), 'Content-Type': 'application/json' },
			data: { archived_at: '2026-01-01T00:00:00Z' },
		})
		expect(archive.status()).toBe(204)

		try {
			const { statut, texte } = await copier(request, enTetesAuthentifies(jeton), {
				workflow_id: WORKFLOW_SEED,
				track_id: TRACK_STUDIO,
			})
			expect(statut).toBe(400)
			expect(
				(JSON.parse(texte) as Erreur).message,
				'on ne copie pas ce que le produit a retiré de ses sélecteurs',
			).toBe('workflow_not_found')
		} finally {
			await request.patch(`${WF}?id=eq.${WORKFLOW_SEED}`, {
				headers: { ...enTetesAuthentifies(jeton), 'Content-Type': 'application/json' },
				data: { archived_at: null },
			})
		}
	})

	test('ligne i — une copie ne se copie pas', async ({ request }) => {
		const jeton = await jetonDe(COMPTES_SEED[0].adresse)

		// La copie livrée par le seed est de portée `track` : elle est la source d'essai idéale.
		const derivee = await request.get(
			`${WF}?derived_from_workflow_id=eq.${WORKFLOW_SEED}`
			+ `&track_id=eq.${TRACK_CONSEIL}`
			+ `&name=eq.${encodeURIComponent(NOM_COPIE_SEED)}&select=id,scope`,
			{ headers: enTetesAuthentifies(jeton) },
		)
		const copieSeed = ((await derivee.json()) as { id: string; scope: string }[])[0]!
		expect(copieSeed, 'le seed livre une copie sur le track « Conseil & IA » (§4.10)').toBeDefined()
		expect(copieSeed.scope).toBe('track')

		const { statut, texte } = await copier(request, enTetesAuthentifies(jeton), {
			workflow_id: copieSeed.id,
			track_id: TRACK_STUDIO,
		})
		expect(statut).toBe(400)
		expect(
			(JSON.parse(texte) as Erreur).message,
			'une chaîne de dérivations rendrait le lignage illisible (décision 85)',
		).toBe('workflow_not_global')
	})

	test('lignes j et k — un track d’un autre workspace ou archivé est introuvable', async ({
		request,
	}) => {
		const jeton = await jetonDe(COMPTES_SEED[0].adresse)

		const archive = await copier(request, enTetesAuthentifies(jeton), {
			workflow_id: WORKFLOW_SEED,
			track_id: TRACK_ARCHIVE,
		})
		expect(archive.statut).toBe(400)
		expect(
			(JSON.parse(archive.texte) as Erreur).message,
			'le track « Pipeline 2024 » du seed est archivé',
		).toBe('track_not_found')

		const inconnu = await copier(request, enTetesAuthentifies(jeton), {
			workflow_id: WORKFLOW_SEED,
			track_id: '00000000-0000-4000-8000-0000000000ee',
		})
		expect(inconnu.statut).toBe(400)
		expect((JSON.parse(inconnu.texte) as Erreur).message).toBe('track_not_found')
	})
})

test.describe('C4 — le signalement de divergence (§4.9, lignes m, n, o, p)', () => {
	test('ligne m — un membre du workspace lit la dérivation livrée par le seed', async ({
		request,
	}) => {
		const jeton = await jetonDe(COMPTES_SEED[2].adresse)

		// Le filtre porte sur la **source**, et non sur « toutes les lignes » : un harnais ou un
		// scénario voisin peut légitimement tenir une copie d'essai au même moment, et une
		// assertion qui compterait la vue entière échouerait pour une raison sans rapport avec ce
		// qu'elle prouve.
		const reponse = await request.get(
			`${DERIVATIONS}?source_workflow_id=eq.${WORKFLOW_SEED}&track_id=eq.${TRACK_CONSEIL}&select=*`,
			{ headers: enTetesAuthentifies(jeton) },
		)
		expect(reponse.status()).toBe(200)
		const lignes = (await reponse.json()) as Derivation[]

		expect(lignes, 'la copie du seed apparaît, et une seule fois').toHaveLength(1)
		expect(lignes[0]!.source_workflow_id, 'la source est le workflow par défaut').toBe(
			WORKFLOW_SEED,
		)
		expect(lignes[0]!.source_name, 'la vue nomme la source').toBe('Cycle commercial standard')
		expect(
			typeof lignes[0]!.source_modified_since_copy,
			'le signal est un booléen, jamais nul : un `coalesce` protège le cas du brouillon',
		).toBe('boolean')

		// Un `viewer` lit : la vue est en lecture, et lire n'exige pas d'écrire.
		expect(lignes[0]!.workflow_id).toMatch(/^[0-9a-f-]{36}$/)
	})

	test('ligne n — l’anonyme obtient 200 et zéro ligne (preuve de refus n° 11)', async ({
		request,
	}) => {
		// L'état est d'abord constaté avec la clé de service : sur une vue vide, « zéro ligne »
		// serait vrai que la RLS refuse ou qu'elle autorise tout (décision 50).
		const service = await request.get(`${DERIVATIONS}?select=workflow_id`, {
			headers: enTetesService(),
		})
		expect(
			((await service.json()) as unknown[]).length,
			'la vue n’est pas vide : le refus qui suit porte donc sur quelque chose',
		).toBeGreaterThan(0)

		const reponse = await request.get(`${DERIVATIONS}?select=workflow_id`, {
			headers: enTetesAnonymes(),
		})
		expect(reponse.status(), 'un refus de lecture n’est pas une erreur').toBe(200)
		expect((await reponse.json()) as unknown[], 'il vaut zéro ligne').toHaveLength(0)
	})

	test('ligne o — la vue est en lecture seule, même pour un administrateur', async ({ request }) => {
		const jeton = await jetonDe(COMPTES_SEED[0].adresse)

		const reponse = await request.patch(`${DERIVATIONS}?source_name=eq.Cycle%20commercial%20standard`, {
			headers: { ...enTetesAuthentifies(jeton), 'Content-Type': 'application/json' },
			data: { name: 'Renommée par la vue' },
		})

		// MESURÉ, et l'attente écrite au §4.9 a été révisée en conséquence : la fermeture est
		// **double**, et c'est la seconde qui parle la première. PostgreSQL refuse la réécriture
		// avant tout contrôle de privilège — une vue qui joint deux tables n'est pas automatiquement
		// modifiable —, ce que PostgREST rend en `500` faute de savoir traduire `55000`.
		//
		// L'absence de privilège d'écriture, elle, est prouvée en base par
		// `supabase/tests/0008_copie_workflow.test.sql` : les deux verrous existent, mais un seul
		// est observable depuis l'API.
		expect(reponse.status(), 'la vue n’est pas modifiable, et le refus vient du moteur').toBe(500)
		const erreur = JSON.parse(await reponse.text()) as Erreur & { details?: string }
		expect(erreur.code, 'une vue joignant deux tables n’est pas automatiquement modifiable').toBe(
			'55000',
		)
	})

	test('ligne p — une source modifiée après la copie fait apparaître la divergence', async ({
		request,
	}) => {
		const jeton = await jetonDe(COMPTES_SEED[0].adresse)

		const avant = await request.get(
			`${DERIVATIONS}?source_workflow_id=eq.${WORKFLOW_SEED}&select=workflow_id,derived_at,source_modified_since_copy`,
			{ headers: enTetesAuthentifies(jeton) },
		)
		const ligneAvant = ((await avant.json()) as Derivation[])[0]!
		expect(ligneAvant, 'la dérivation du seed est là').toBeDefined()

		// La source est modifiée par le geste réel : renommer le workflow global avec le jeton de
		// l'administrateur. L'ancien nom est remis en fin de scénario.
		const renomme = await request.patch(`${WF}?id=eq.${WORKFLOW_SEED}`, {
			headers: { ...enTetesAuthentifies(jeton), 'Content-Type': 'application/json' },
			data: { name: 'Cycle commercial standard (modifié)' },
		})
		expect(renomme.status()).toBe(204)

		try {
			const apres = await request.get(
				`${DERIVATIONS}?source_workflow_id=eq.${WORKFLOW_SEED}&select=source_modified_since_copy,source_modified_at,derived_at`,
				{ headers: enTetesAuthentifies(jeton) },
			)
			const ligneApres = ((await apres.json()) as Derivation[])[0]!
			expect(
				ligneApres.source_modified_since_copy,
				'la copie sait désormais que sa source a bougé',
			).toBe(true)
			expect(
				new Date(ligneApres.source_modified_at).getTime(),
				'et la date exposée est postérieure à la copie : « modifié depuis le … » est écrivable',
			).toBeGreaterThan(new Date(ligneApres.derived_at).getTime())
		} finally {
			await request.patch(`${WF}?id=eq.${WORKFLOW_SEED}`, {
				headers: { ...enTetesAuthentifies(jeton), 'Content-Type': 'application/json' },
				data: { name: 'Cycle commercial standard' },
			})
		}
	})

	test('INC-038 — supprimer dans la source fait apparaître la divergence', async ({ request }) => {
		const jeton = await jetonDe(COMPTES_SEED[0].adresse)
		const fieldId = randomUUID()
		const fieldKey = `suppression-${fieldId}`
		let copieId: string | undefined

		try {
			const champ = await request.post(FIELDS, {
				headers: {
					...enTetesService(),
					'Content-Type': 'application/json',
					Prefer: 'return=representation',
				},
				data: {
					id: fieldId,
					workflow_id: WORKFLOW_SEED,
					workspace_id: WORKSPACE_SEED,
					key: fieldKey,
					label: 'Champ supprimé — preuve INC-038',
					type: 'text',
					options: {},
					position: 999,
				},
			})
			expect(champ.status()).toBe(201)

			const copie = await copier(request, enTetesAuthentifies(jeton), {
				workflow_id: WORKFLOW_SEED,
				track_id: TRACK_STUDIO,
				new_name: 'Copie suppression — INC-038',
			})
			expect(copie.statut).toBe(200)
			copieId = JSON.parse(copie.texte) as string

			const avant = await request.get(
				`${DERIVATIONS}?workflow_id=eq.${copieId}&select=source_modified_since_copy`,
				{ headers: enTetesAuthentifies(jeton) },
			)
			expect(
				((await avant.json()) as Pick<Derivation, 'source_modified_since_copy'>[])[0]!
					.source_modified_since_copy,
				'la copie est identique avant la suppression',
			).toBe(false)

			const suppression = await request.delete(`${FIELDS}?id=eq.${fieldId}`, {
				headers: enTetesService(),
			})
			expect(suppression.status()).toBe(204)

			const apres = await request.get(
				`${DERIVATIONS}?workflow_id=eq.${copieId}&select=source_modified_since_copy`,
				{ headers: enTetesAuthentifies(jeton) },
			)
			expect(
				((await apres.json()) as Pick<Derivation, 'source_modified_since_copy'>[])[0]!
					.source_modified_since_copy,
				'la suppression change l’empreinte malgré l’absence d’updated_at survivant',
			).toBe(true)
		} finally {
			await request.delete(`${FIELDS}?id=eq.${fieldId}`, { headers: enTetesService() })
			if (copieId) await retirerCopie(request, copieId)
		}
	})
})
