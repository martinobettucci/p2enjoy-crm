// @verifies CRM-031 (docs/BACKLOG.md) — workflows, étapes, transitions : lecture, écriture, ordre
// @verifies docs/SPEC-workflow-engine.md §3.8 (contrat d'API, lignes a à p), §3.3 (surcharges),
//           §3.5 (étape initiale), §3.6 (ordre), §3.7 (autorisations), §3.9 (seed)
// @verifies docs/SPEC-permissions-rls.md §7 (preuves de refus n° 2, n° 3 et n° 11)
// @verifies docs/SPEC-test-harness.md §4.3 (projet `api`, hors interface)
// @verifies docs/INCONSISTENCY_REPORT.md INC-029 (channels rattachés), INC-033 (`require_fields`)
// @verifies CLAUDE.md §10 (toute règle d'accès se prouve hors interface, avec le jeton réel)
//
// Ces scénarios exercent le backend **sans passer par l'interface**, avec les jetons réels des
// trois profils seedés, obtenus par la véritable route de connexion. Aucun navigateur n'est lancé —
// et pour cause : cette unité ne livre aucun écran (INC-021).
//
// Ils reprennent une à une les seize lignes du tableau de `docs/SPEC-workflow-engine.md` §3.8,
// écrit avant le code à partir des mesures faites sur des tables sondes.
//
// DEUX PIÈGES, hérités de `CRM-030` et qui valent ici de la même façon :
//
//   * une mise à jour refusée par la clause `USING` d'une politique ne produit **aucune erreur** :
//     PostgREST rend `200` et un tableau vide. Chaque refus de mise à jour relit donc la ligne et
//     la constate **inchangée** (décision 70). Il en va de même d'une suppression refusée ;
//   * un « zéro ligne » sur une table vide serait vrai que la RLS refuse ou qu'elle autorise tout.
//     L'état de la base est donc d'abord constaté avec la clé de service, qui ne sert **jamais** à
//     prouver un refus (décision 50).

import { expect, test, type APIRequestContext } from '@playwright/test'
import { COMPTES_SEED, enTetesAnonymes, enTetesAuthentifies, enTetesService, jetonDe } from './jetons'

/** Le workspace du seed socle (`docs/SPEC-seed.md` §2). */
const WORKSPACE_SEED = '5eed0000-0000-4000-8000-000000000001'

/** Le workflow par défaut du seed et deux de ses étapes (`docs/SPEC-workflow-engine.md` §3.9). */
const WORKFLOW_SEED = '5eed0000-0000-4000-8000-000000000051'
const ETAPE_PROSPECTION = '5eed0000-0000-4000-8000-000000000061'
const ETAPE_PERDU = '5eed0000-0000-4000-8000-000000000067'

/** Le nœud du catalogue resté hors du workflow : le seul libre pour une étape d'essai. */
const NOEUD_QUALIFICATION = '5eed0000-0000-4000-8000-000000000048'

const WF = '/rest/v1/workflows'
const STEPS = '/rest/v1/workflow_steps'
const TRANSITIONS = '/rest/v1/workflow_transitions'

type Workflow = {
	id: string
	workspace_id: string
	name: string
	scope: string
	track_id: string | null
	is_default: boolean
	archived_at: string | null
}

type Etape = {
	id: string
	workflow_id: string
	node_id: string
	position: number
	is_initial: boolean
	label_override: string | null
	stale_after_days: number | null
}

/**
 * Crée un second workspace avec la clé de service.
 *
 * Aucune politique n'autorise la création d'un workspace par un client — c'est voulu, `CRM-012` en
 * décidera. Le fait est nommé ici plutôt que masqué, comme les trois fichiers de scénarios qui
 * précèdent le font déjà.
 */
async function poserWorkspaceB(requete: APIRequestContext, suffixe: string): Promise<string> {
	if (!/^[0-9a-f]{5}$/.test(suffixe)) throw new Error(`suffixe invalide : ${suffixe}`)
	const workspaceId = `e0000000-0000-4000-8000-0000000${suffixe}`

	const ws = await requete.post('/rest/v1/workspaces', {
		headers: { ...enTetesService(), 'Content-Type': 'application/json' },
		data: { id: workspaceId, name: `Workspace WF B ${suffixe}`, slug: `workspace-wf-b-${suffixe}` },
	})
	expect(ws.status(), 'la fixture du workspace B doit être posée').toBeLessThan(300)
	return workspaceId
}

async function retirerWorkspaceB(requete: APIRequestContext, workspaceId: string): Promise<void> {
	await requete.delete(`/rest/v1/workspaces?id=eq.${workspaceId}`, { headers: enTetesService() })
}

/** Retire un workflow créé par un scénario. Seule la clé de service en a le privilège. */
async function retirerWorkflow(requete: APIRequestContext, id: string): Promise<void> {
	await requete.delete(`${WF}?id=eq.${id}`, { headers: enTetesService() })
}

async function retirerEtape(requete: APIRequestContext, id: string): Promise<void> {
	await requete.delete(`${STEPS}?id=eq.${id}`, { headers: enTetesService() })
}

test.describe('W0 — le seed a réellement posé le workflow par défaut', () => {
	// Condition de validité de tout ce qui suit (décision 50).
	test('un workflow global et par défaut, sept étapes, dix transitions', async ({ request }) => {
		const reponseWf = await request.get(
			`${WF}?select=*&workspace_id=eq.${WORKSPACE_SEED}`,
			{ headers: enTetesService() },
		)
		expect(reponseWf.status()).toBe(200)
		const workflows = (await reponseWf.json()) as Workflow[]

		// RÉVISÉ PAR `CRM-032` (mécanisme de la décision 51) : le workspace du seed porte désormais
		// **deux** workflows — le workflow global par défaut de cette unité, et la copie de portée
		// `track` livrée par `docs/SPEC-workflow-engine.md` §4.10. L'assertion d'origine comptait
		// « un workflow, ni plus ni moins » ; elle est resserrée sur ce que cette unité garantit
		// réellement, plutôt que relâchée : un seul workflow **global**, un seul **par défaut**.
		expect(workflows.filter((w) => w.scope === 'global')).toHaveLength(1)
		expect(workflows.filter((w) => w.is_default)).toHaveLength(1)

		const defaut = workflows.find((w) => w.id === WORKFLOW_SEED)!
		expect(defaut.scope).toBe('global')
		expect(defaut.track_id).toBeNull()
		expect(defaut.is_default).toBe(true)
		expect(defaut.archived_at).toBeNull()

		const reponseEtapes = await request.get(
			`${STEPS}?select=*&workflow_id=eq.${WORKFLOW_SEED}&order=position`,
			{ headers: enTetesService() },
		)
		const etapes = (await reponseEtapes.json()) as Etape[]
		expect(etapes).toHaveLength(7)
		expect(etapes.map((e) => Number(e.position))).toEqual([1, 2, 3, 4, 5, 6, 7])

		// **Exactement une** étape initiale : la base garantit « au plus une » (§3.5), le seed
		// fournit la seconde moitié de l'exigence.
		expect(etapes.filter((e) => e.is_initial)).toHaveLength(1)
		expect(etapes.find((e) => e.is_initial)?.id).toBe(ETAPE_PROSPECTION)

		// Les deux surcharges du §3.9, sur deux colonnes différentes : sans elles, la faculté de
		// surcharger serait documentée sans être démontrable.
		expect(etapes.filter((e) => e.label_override !== null)).toHaveLength(1)
		expect(etapes.filter((e) => e.stale_after_days !== null)).toHaveLength(1)

		const reponseTransitions = await request.get(
			`${TRANSITIONS}?select=id,require_comment,require_fields&workflow_id=eq.${WORKFLOW_SEED}`,
			{ headers: enTetesService() },
		)
		const transitions = (await reponseTransitions.json()) as {
			require_comment: boolean
			require_fields: string[]
		}[]
		expect(transitions).toHaveLength(10)
		expect(transitions.filter((t) => t.require_comment)).toHaveLength(4)

		// RÉVISÉ À `CRM-036`, NON RETIRÉ — mécanisme de la décision 51. L'assertion constatait le vide,
		// motivé alors par l'absence de `form_fields`, puis par l'absence de garde qui la lise. Les
		// deux motifs ont disparu : la sixième vérification de `move_card` LIT cette colonne, et le
		// seed en porte exactement UNE (docs/SPEC-seed.md §2.13). Elle COMPTE désormais, de sorte
		// qu'une seconde entrée posée sans preuve la fasse rougir à son tour.
		expect(
			transitions.filter((t) => t.require_fields.length > 0),
			'INC-033 : une seule transition porte `require_fields` — « Démarrer la réalisation »',
		).toHaveLength(1)
	})

	// Révisé par `CRM-033`, qui a soldé INC-029. L'assertion posée ici comptait « les six »
	// rattachés au workflow par défaut ; elle est devenue rouge le jour où le seed a rattaché
	// `prospection` à la copie de portée `track` de son propre track — cas accepté de la règle du
	// §4.12, qui serait autrement documenté sans être démontrable. Elle est **resserrée** sur ce que
	// cette unité-ci garantit : aucun channel sans workflow, et cinq sur six suivant le global.
	test('INC-029 — les channels du seed sont tous rattachés, cinq au workflow par défaut', async ({
		request,
	}) => {
		const reponse = await request.get(
			`/rest/v1/channels?select=id,workflow_id&workspace_id=eq.${WORKSPACE_SEED}`,
			{ headers: enTetesService() },
		)
		const channels = (await reponse.json()) as { id: string; workflow_id: string | null }[]
		expect(channels).toHaveLength(6)
		expect(channels.every((c) => c.workflow_id !== null)).toBe(true)
		expect(channels.filter((c) => c.workflow_id === WORKFLOW_SEED)).toHaveLength(5)
	})
})

test.describe('W1 — lecture (§3.8, lignes a, b, c)', () => {
	test('ligne b — PREUVE DE REFUS N° 11 : l’anonyme ne lit aucun workflow', async ({ request }) => {
		// Le refus se manifeste par zéro ligne, **pas** par une erreur : les deux formes sont
		// vérifiées séparément (docs/SPEC-permissions-rls.md §7, dernier paragraphe).
		for (const chemin of [WF, STEPS, TRANSITIONS]) {
			const reponse = await request.get(`${chemin}?select=*`, { headers: enTetesAnonymes() })
			expect(reponse.status(), `${chemin} doit répondre 200 à l'anonyme`).toBe(200)
			expect(await reponse.json(), `${chemin} doit rendre zéro ligne`).toEqual([])
		}
	})

	for (const compte of COMPTES_SEED) {
		test(`ligne a — ${compte.role} lit le workflow de son workspace`, async ({ request }) => {
			const jeton = await jetonDe(compte.adresse)
			const reponse = await request.get(`${WF}?select=id,name,is_default`, {
				headers: enTetesAuthentifies(jeton),
			})
			expect(reponse.status()).toBe(200)
			const lignes = (await reponse.json()) as Workflow[]

			// RÉVISÉ PAR `CRM-032` : le seed livre désormais deux workflows, le global par défaut et
			// sa copie de portée `track` (§4.10). Ce que cette ligne du contrat prouve reste entier —
			// le profil lit **son** workflow —, et une assertion d'appartenance le dit mieux qu'un
			// compte figé.
			expect(lignes.map((l) => l.id)).toContain(WORKFLOW_SEED)
			expect(lignes.filter((l) => l.is_default)).toHaveLength(1)

			// Un `viewer` lit aussi les étapes et les transitions : sans elles, il ne verrait ni les
			// colonnes du board ni les actions possibles. Sept par workflow, donc quatorze depuis
			// que la copie existe.
			const etapes = await request.get(`${STEPS}?select=id&workflow_id=eq.${WORKFLOW_SEED}`, {
				headers: enTetesAuthentifies(jeton),
			})
			expect((await etapes.json()) as unknown[]).toHaveLength(7)
		})
	}

	test('ligne c — PREUVE DE REFUS N° 3 : un membre ne voit pas le workflow d’un autre workspace', async ({
		request,
	}) => {
		const workspaceB = await poserWorkspaceB(request, 'aa001')
		try {
			// La ligne de B est d'abord constatée **présente** avec la clé de service : sans cela, le
			// « zéro ligne » du membre de A ne prouverait rien (décision 50).
			const creation = await request.post(WF, {
				headers: { ...enTetesService(), 'Content-Type': 'application/json', Prefer: 'return=representation' },
				data: { workspace_id: workspaceB, name: 'Workflow de B' },
			})
			expect(creation.status()).toBe(201)

			const constat = await request.get(`${WF}?select=id&workspace_id=eq.${workspaceB}`, {
				headers: enTetesService(),
			})
			expect((await constat.json()) as unknown[]).toHaveLength(1)

			const jeton = await jetonDe(COMPTES_SEED[0].adresse)
			const vueDeA = await request.get(`${WF}?select=id&workspace_id=eq.${workspaceB}`, {
				headers: enTetesAuthentifies(jeton),
			})
			expect(vueDeA.status()).toBe(200)
			expect(await vueDeA.json()).toEqual([])
		} finally {
			await retirerWorkspaceB(request, workspaceB)
		}
	})
})

test.describe('W2 — écriture d’un workflow (§3.8, lignes d, e, f, g, h)', () => {
	test('ligne d — un administrateur crée un workflow', async ({ request }) => {
		const jeton = await jetonDe('admin@p2enjoy.test')
		const id = 'e1000000-0000-4000-8000-000000000101'
		try {
			const reponse = await request.post(WF, {
				headers: {
					...enTetesAuthentifies(jeton),
					'Content-Type': 'application/json',
					Prefer: 'return=representation',
				},
				data: { id, workspace_id: WORKSPACE_SEED, name: 'Workflow d’essai' },
			})
			expect(reponse.status()).toBe(201)
			const lignes = (await reponse.json()) as Workflow[]
			const ligne = lignes[0]!

			// Les défauts de colonne sont appliqués : `global`, et surtout **pas** `is_default` —
			// créer un workflow ne détrône pas celui du workspace.
			expect(ligne.scope).toBe('global')
			expect(ligne.is_default).toBe(false)
			expect(ligne.track_id).toBeNull()
		} finally {
			await retirerWorkflow(request, id)
		}
	})

	for (const compte of [COMPTES_SEED[1], COMPTES_SEED[2]]) {
		test(`lignes e et f — PREUVE DE REFUS N° 2 : ${compte.role} ne crée aucun workflow`, async ({
			request,
		}) => {
			const jeton = await jetonDe(compte.adresse)
			const reponse = await request.post(WF, {
				headers: { ...enTetesAuthentifies(jeton), 'Content-Type': 'application/json' },
				data: { workspace_id: WORKSPACE_SEED, name: `Interdit par ${compte.role}` },
			})
			expect(reponse.status()).toBe(403)
			expect((await reponse.json()).code).toBe('42501')

			// Et la ligne n'existe **nulle part** : le refus n'a pas seulement masqué la création.
			const constat = await request.get(
				`${WF}?select=id&name=eq.${encodeURIComponent(`Interdit par ${compte.role}`)}`,
				{ headers: enTetesService() },
			)
			expect(await constat.json()).toEqual([])
		})
	}

	test('ligne g — le renommage par un business_developer ne lève rien et ne change rien', async ({
		request,
	}) => {
		const jeton = await jetonDe('bizdev@p2enjoy.test')
		const reponse = await request.patch(`${WF}?id=eq.${WORKFLOW_SEED}`, {
			headers: {
				...enTetesAuthentifies(jeton),
				'Content-Type': 'application/json',
				Prefer: 'return=representation',
			},
			data: { name: 'Renommé sans droit' },
		})

		// LE PIÈGE : `200` et un tableau vide, aucune ligne n'ayant été vue comme modifiable.
		expect(reponse.status()).toBe(200)
		expect(await reponse.json()).toEqual([])

		const relecture = await request.get(`${WF}?select=name&id=eq.${WORKFLOW_SEED}`, {
			headers: enTetesService(),
		})
		expect(((await relecture.json()) as Workflow[])[0]!.name).toBe('Cycle commercial standard')
	})

	test('ligne h — le WITH CHECK interdit de déplacer un workflow vers un autre workspace', async ({
		request,
	}) => {
		const workspaceB = await poserWorkspaceB(request, 'aa002')
		try {
			const jeton = await jetonDe('admin@p2enjoy.test')
			const reponse = await request.patch(`${WF}?id=eq.${WORKFLOW_SEED}`, {
				headers: { ...enTetesAuthentifies(jeton), 'Content-Type': 'application/json' },
				data: { workspace_id: workspaceB },
			})

			// Ici le refus est une **erreur**, à la différence de la ligne g : c'est le `WITH CHECK`
			// qui parle, et non le `USING`. Les deux formes coexistent sur la même politique.
			expect(reponse.status()).toBe(403)
			expect((await reponse.json()).code).toBe('42501')

			const relecture = await request.get(`${WF}?select=workspace_id&id=eq.${WORKFLOW_SEED}`, {
				headers: enTetesService(),
			})
			expect(((await relecture.json()) as Workflow[])[0]!.workspace_id).toBe(WORKSPACE_SEED)
		} finally {
			await retirerWorkspaceB(request, workspaceB)
		}
	})
})

test.describe('W3 — étapes (§3.8, lignes i, j, k)', () => {
	test('ligne i — `position` omise place l’étape en fin de board', async ({ request }) => {
		const jeton = await jetonDe('admin@p2enjoy.test')
		const id = 'e1000000-0000-4000-8000-000000000201'
		try {
			const reponse = await request.post(STEPS, {
				headers: {
					...enTetesAuthentifies(jeton),
					'Content-Type': 'application/json',
					Prefer: 'return=representation',
				},
				data: {
					id,
					workflow_id: WORKFLOW_SEED,
					workspace_id: WORKSPACE_SEED,
					node_id: NOEUD_QUALIFICATION,
				},
			})
			expect(reponse.status()).toBe(201)
			const etape = ((await reponse.json()) as Etape[])[0]!

			// Le seed pose sept étapes de 1 à 7 : la huitième prend 8, dans la portée du **workflow**.
			expect(Number(etape.position)).toBe(8)
			expect(etape.is_initial).toBe(false)
			expect(etape.label_override).toBeNull()
		} finally {
			await retirerEtape(request, id)
		}
	})

	test('ligne j — le même nœud ne s’instancie pas deux fois dans un workflow', async ({
		request,
	}) => {
		const jeton = await jetonDe('admin@p2enjoy.test')
		const reponse = await request.post(STEPS, {
			headers: { ...enTetesAuthentifies(jeton), 'Content-Type': 'application/json' },
			data: {
				workflow_id: WORKFLOW_SEED,
				workspace_id: WORKSPACE_SEED,
				node_id: '5eed0000-0000-4000-8000-000000000041',
			},
		})
		expect(reponse.status()).toBe(409)
		expect((await reponse.json()).code).toBe('23505')
	})

	test('ligne k — une seconde étape initiale est refusée', async ({ request }) => {
		const jeton = await jetonDe('admin@p2enjoy.test')
		const id = 'e1000000-0000-4000-8000-000000000202'
		try {
			const reponse = await request.post(STEPS, {
				headers: { ...enTetesAuthentifies(jeton), 'Content-Type': 'application/json' },
				data: {
					id,
					workflow_id: WORKFLOW_SEED,
					workspace_id: WORKSPACE_SEED,
					node_id: NOEUD_QUALIFICATION,
					is_initial: true,
				},
			})
			expect(reponse.status()).toBe(409)
			expect((await reponse.json()).code).toBe('23505')

			// L'étape initiale du seed est intacte : le refus n'a rien déplacé.
			const constat = await request.get(
				`${STEPS}?select=id&workflow_id=eq.${WORKFLOW_SEED}&is_initial=is.true`,
				{ headers: enTetesService() },
			)
			expect((await constat.json()) as Etape[]).toHaveLength(1)
		} finally {
			await retirerEtape(request, id)
		}
	})

	test('un business_developer n’ajoute aucune étape', async ({ request }) => {
		const jeton = await jetonDe('bizdev@p2enjoy.test')
		const reponse = await request.post(STEPS, {
			headers: { ...enTetesAuthentifies(jeton), 'Content-Type': 'application/json' },
			data: {
				workflow_id: WORKFLOW_SEED,
				workspace_id: WORKSPACE_SEED,
				node_id: NOEUD_QUALIFICATION,
			},
		})
		expect(reponse.status()).toBe(403)
		expect((await reponse.json()).code).toBe('42501')
	})
})

test.describe('W4 — transitions (§3.8, lignes l, m, n, o)', () => {
	test('ligne l — une arête vers l’étape d’un autre workflow est refusée', async ({ request }) => {
		const jeton = await jetonDe('admin@p2enjoy.test')
		const autreWorkflow = 'e1000000-0000-4000-8000-000000000301'
		const autreEtape = 'e1000000-0000-4000-8000-000000000302'
		try {
			// Un second workflow du **même** workspace, avec sa propre étape : le refus porte donc
			// bien sur l'appartenance au workflow, et non sur le cloisonnement des workspaces.
			await request.post(WF, {
				headers: { ...enTetesService(), 'Content-Type': 'application/json' },
				data: { id: autreWorkflow, workspace_id: WORKSPACE_SEED, name: 'Autre workflow' },
			})
			await request.post(STEPS, {
				headers: { ...enTetesService(), 'Content-Type': 'application/json' },
				data: {
					id: autreEtape,
					workflow_id: autreWorkflow,
					workspace_id: WORKSPACE_SEED,
					node_id: NOEUD_QUALIFICATION,
				},
			})

			const reponse = await request.post(TRANSITIONS, {
				headers: { ...enTetesAuthentifies(jeton), 'Content-Type': 'application/json' },
				data: {
					workflow_id: WORKFLOW_SEED,
					workspace_id: WORKSPACE_SEED,
					from_step_id: ETAPE_PROSPECTION,
					to_step_id: autreEtape,
				},
			})
			expect(reponse.status()).toBe(409)
			expect((await reponse.json()).code).toBe('23503')
		} finally {
			await retirerWorkflow(request, autreWorkflow)
		}
	})

	test('ligne m — une transition d’une étape vers elle-même est refusée', async ({ request }) => {
		const jeton = await jetonDe('admin@p2enjoy.test')
		const reponse = await request.post(TRANSITIONS, {
			headers: { ...enTetesAuthentifies(jeton), 'Content-Type': 'application/json' },
			data: {
				workflow_id: WORKFLOW_SEED,
				workspace_id: WORKSPACE_SEED,
				from_step_id: ETAPE_PROSPECTION,
				to_step_id: ETAPE_PROSPECTION,
			},
		})
		expect(reponse.status()).toBe(400)
		expect((await reponse.json()).code).toBe('23514')
	})

	test('lignes n et o — un administrateur retire une arête, un business_developer non', async ({
		request,
	}) => {
		const id = 'e1000000-0000-4000-8000-000000000401'
		// Une arête d'essai, posée avec la clé de service pour ne pas toucher aux dix du seed.
		await request.post(TRANSITIONS, {
			headers: { ...enTetesService(), 'Content-Type': 'application/json' },
			data: {
				id,
				workflow_id: WORKFLOW_SEED,
				workspace_id: WORKSPACE_SEED,
				from_step_id: ETAPE_PERDU,
				to_step_id: ETAPE_PROSPECTION,
				label: 'Rouvrir',
			},
		})

		try {
			// Ligne o d'abord : le refus doit porter sur une arête réellement présente.
			const jetonBizdev = await jetonDe('bizdev@p2enjoy.test')
			const refus = await request.delete(`${TRANSITIONS}?id=eq.${id}`, {
				headers: enTetesAuthentifies(jetonBizdev),
			})
			expect(refus.status()).toBe(204)

			const relecture = await request.get(`${TRANSITIONS}?select=id&id=eq.${id}`, {
				headers: enTetesService(),
			})
			expect(
				(await relecture.json()) as unknown[],
				'la suppression par un business_developer porte sur zéro ligne : l’arête est relue présente',
			).toHaveLength(1)

			// Ligne n : l'administrateur, lui, la retire réellement.
			const jetonAdmin = await jetonDe('admin@p2enjoy.test')
			const suppression = await request.delete(`${TRANSITIONS}?id=eq.${id}`, {
				headers: enTetesAuthentifies(jetonAdmin),
			})
			expect(suppression.status()).toBe(204)

			const apres = await request.get(`${TRANSITIONS}?select=id&id=eq.${id}`, {
				headers: enTetesService(),
			})
			expect(await apres.json()).toEqual([])
		} finally {
			await request.delete(`${TRANSITIONS}?id=eq.${id}`, { headers: enTetesService() })
		}
	})
})

test.describe('W5 — ce qu’aucun client ne peut faire (§3.8, ligne p)', () => {
	test('ligne p — même un administrateur ne supprime pas un workflow', async ({ request }) => {
		const jeton = await jetonDe('admin@p2enjoy.test')
		const reponse = await request.delete(`${WF}?id=eq.${WORKFLOW_SEED}`, {
			headers: enTetesAuthentifies(jeton),
		})

		// Le refus vient du **privilège**, avant même la politique : aucune n'est écrite pour
		// `DELETE`, et aucun `grant delete` n'est accordé. Un workflow s'archive.
		expect(reponse.status()).toBe(403)

		const relecture = await request.get(`${WF}?select=id&id=eq.${WORKFLOW_SEED}`, {
			headers: enTetesService(),
		})
		expect((await relecture.json()) as unknown[]).toHaveLength(1)
	})

	test('l’archivage, lui, est ouvert à l’administrateur — et réversible', async ({ request }) => {
		const jeton = await jetonDe('admin@p2enjoy.test')
		const id = 'e1000000-0000-4000-8000-000000000501'
		try {
			await request.post(WF, {
				headers: { ...enTetesService(), 'Content-Type': 'application/json' },
				data: { id, workspace_id: WORKSPACE_SEED, name: 'À archiver' },
			})

			const archivage = await request.patch(`${WF}?id=eq.${id}`, {
				headers: {
					...enTetesAuthentifies(jeton),
					'Content-Type': 'application/json',
					Prefer: 'return=representation',
				},
				data: { archived_at: '2026-04-01T09:00:00Z' },
			})
			expect(archivage.status()).toBe(200)
			expect(((await archivage.json()) as Workflow[])[0]!.archived_at).not.toBeNull()

			const desarchivage = await request.patch(`${WF}?id=eq.${id}`, {
				headers: {
					...enTetesAuthentifies(jeton),
					'Content-Type': 'application/json',
					Prefer: 'return=representation',
				},
				data: { archived_at: null },
			})
			expect(((await desarchivage.json()) as Workflow[])[0]!.archived_at).toBeNull()
		} finally {
			await retirerWorkflow(request, id)
		}
	})
})
