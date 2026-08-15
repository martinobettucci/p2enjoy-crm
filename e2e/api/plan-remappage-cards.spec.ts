// @verifies CRM-078 (docs/BACKLOG.md) — versionnement des workflows, troisième tranche : le plan
//           de remappage des cards
// @verifies docs/SPEC-workflow-engine.md §7 ter.12.9 (contrat d'API, lignes a à o),
//           §7 ter.12.2 (les trois issues d'une card), §7 ter.12.4 (le geste et ses huit refus),
//           §7 ter.12.5 (quelles cards entrent dans le plan), §7 ter.12.6 (ce que la fonction
//           rend), §7 ter.12.7 (liste bornée, troncature annoncée, ordre)
// @verifies docs/SPEC-permissions-rls.md §7 (preuve de refus n° 3 au niveau des versions)
// @verifies docs/SPEC-test-harness.md §4.3 (projet `api`, hors interface)
// @verifies CLAUDE.md §10 (toute règle d'accès se prouve hors interface, avec le jeton réel)
//
// Ces scénarios exercent le backend **sans passer par l'interface**, avec les jetons réels des
// trois profils seedés obtenus par la véritable route de connexion. Aucun navigateur n'est lancé :
// cette tranche ne livre aucun écran (`docs/SPEC-workflow-engine.md` §7 ter.12.10).
//
// Ils reprennent une à une les quinze lignes du tableau du §7 ter.12.9, écrit **avant** le code.
//
// CE QUE CES PREUVES DOIVENT ATTRAPER, ET QUE LA SUITE pgTAP NE PEUT PAS :
//
//   * le plan est `security invoker`. Son autorisation est donc celle de PostgREST et de la RLS,
//     pas celle d'un `set role` simulé — c'est ici, et ici seulement, que la ligne n peut être
//     jouée contre un SECOND workspace réel, absent du seed ;
//   * l'anonyme obtient `401` et non `403` : le privilège refuse avant la première vérification,
//     PostgREST traitant l'absence de droit d'un appelant non authentifié comme une invitation à
//     s'authentifier (§4.4) ;
//   * `card_limit` et `step_overrides` traversent PostgREST avec leurs valeurs par défaut. Une RPC
//     dont un argument facultatif ne serait pas franchissable par le client serait verte en pgTAP
//     et inutilisable par un écran.
//
// AUCUN COMPTE DU SEED N'EST FIGÉ EN DUR. La ligne a compare le `cards_total` rendu à
// l'administratrice au compte lu **par la clé de service**, laquelle ignore la RLS : c'est la
// mesure de l'exhaustivité, et elle reste juste au premier ajout du seed.
//
// LES FIXTURES SONT PROPRES À LA PREUVE, ET RENDUES. Chaque scénario qui publie crée son propre
// workflow, son channel et ses affaires, et supprime le workflow dans un `finally` : la cascade
// emporte versions, étapes et — le channel supprimé — les affaires. Publier sur le workflow du seed
// ferait avancer son numéro de version à chaque exécution.

import { randomUUID } from 'node:crypto'
import { expect, test, type APIRequestContext } from '@playwright/test'
import { COMPTES_SEED, enTetesAnonymes, enTetesAuthentifies, enTetesService, jetonDe } from './jetons'

/** Le workspace du seed socle (`docs/SPEC-seed.md` §2). */
const WORKSPACE_SEED = '5eed0000-0000-4000-8000-000000000001'
/** Un track du seed, hôte des channels jetables. */
const TRACK_SEED = '5eed0000-0000-4000-8000-000000000022'
/** Le workflow par défaut du seed et sa version publiée par le seed lui-même (§7 ter.8). */
const WORKFLOW_SEED = '5eed0000-0000-4000-8000-000000000051'

const RPC_PLAN = '/rest/v1/rpc/plan_card_remapping'
const RPC_PUBLIER = '/rest/v1/rpc/publish_workflow_version'
const VERSIONS = '/rest/v1/workflow_versions'
const WF = '/rest/v1/workflows'
const STEPS = '/rest/v1/workflow_steps'
const CHANNELS = '/rest/v1/channels'
const CARDS = '/rest/v1/cards'
const WORKSPACES = '/rest/v1/workspaces'

/** Trois nœuds actifs du catalogue seedé, employés pour composer un workflow de preuve. */
const NOEUD_PROSPECTION = '5eed0000-0000-4000-8000-000000000041'
const NOEUD_NEGOCIATION = '5eed0000-0000-4000-8000-000000000043'
const NOEUD_SIGNATURE = '5eed0000-0000-4000-8000-000000000044'

type Affaire = {
	card_id: string
	title: string
	state: 'active' | 'archived' | 'deleted'
	channel_id: string
	current_step_id: string
	target_step_id: string | null
	resolution: 'unchanged' | 'remapped' | 'unresolved'
}

type Plan = {
	version: { version_id: string; version_number: number; workflow_id: string }
	ready: boolean
	summary: {
		cards_total: number
		cards_unchanged: number
		cards_remapped: number
		cards_unresolved: number
		steps_removed: number
		steps_restored: number
	}
	steps: {
		removed: {
			step_id: string
			label: string
			cards_total: number
			cards_unresolved: number
			target_step_id: string | null
		}[]
		restored: { step_id: string; label: string }[]
	}
	cards: { total: number; returned: number; truncated: boolean; limit: number; items: Affaire[] }
}

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
	libelle: string | null = null,
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
			label_override: libelle,
		},
	})
	expect(reponse.status(), 'création de l’étape jetable').toBe(201)
	return id
}

/** Crée un channel jetable porté par le workflow jetable. */
async function channelJetable(api: APIRequestContext, workflowId: string): Promise<string> {
	const id = randomUUID()
	const reponse = await api.post(CHANNELS, {
		headers: { ...enTetesService(), Prefer: 'return=representation' },
		data: {
			id,
			workspace_id: WORKSPACE_SEED,
			track_id: TRACK_SEED,
			name: `tst plan ${id}`,
			slug: `tst-plan-${id}`,
			workflow_id: workflowId,
			position: 99,
		},
	})
	expect(reponse.status(), 'création du channel jetable').toBe(201)
	return id
}

/**
 * Crée une affaire jetable. `etat` couvre les trois états du §7 ter.12.5 : une affaire archivée et
 * une affaire en corbeille ne sont pas des lignes disparues, et elles doivent figurer dans le plan.
 */
async function cardJetable(
	api: APIRequestContext,
	channelId: string,
	workflowId: string,
	etapeId: string,
	titre: string,
	etat: 'active' | 'archived' | 'deleted' = 'active',
): Promise<string> {
	const id = randomUUID()
	const reponse = await api.post(CARDS, {
		headers: { ...enTetesService(), Prefer: 'return=representation' },
		data: {
			id,
			workspace_id: WORKSPACE_SEED,
			channel_id: channelId,
			workflow_id: workflowId,
			current_step_id: etapeId,
			title: titre,
			position: 1,
			archived_at: etat === 'archived' ? new Date().toISOString() : null,
			deleted_at: etat === 'deleted' ? new Date().toISOString() : null,
		},
	})
	expect(reponse.status(), `création de l’affaire « ${titre} »`).toBe(201)
	return id
}

/** Publie une version par la VRAIE RPC, avec le jeton de l'administratrice (§7 ter.8). */
async function publier(api: APIRequestContext, jeton: string, workflowId: string): Promise<string> {
	const reponse = await api.post(RPC_PUBLIER, {
		headers: enTetesAuthentifies(jeton),
		data: { target_workflow_id: workflowId },
	})
	expect(reponse.status(), 'publication d’une version de preuve').toBe(200)
	return ((await reponse.json()) as { id: string }).id
}

/** Déplace une affaire par la clé de service : la preuve porte sur le plan, non sur `move_card`. */
async function poser(api: APIRequestContext, cardId: string, etapeId: string): Promise<void> {
	const reponse = await api.patch(`${CARDS}?id=eq.${cardId}`, {
		headers: enTetesService(),
		data: { current_step_id: etapeId },
	})
	expect(reponse.status(), 'déplacement d’une affaire de fixture').toBe(204)
}

/** Le plan, joué par le profil donné. */
async function planifier(
	api: APIRequestContext,
	jeton: string,
	versionId: string,
	corps: Record<string, unknown> = {},
) {
	return api.post(RPC_PLAN, {
		headers: enTetesAuthentifies(jeton),
		data: { target_version_id: versionId, ...corps },
	})
}

/** Supprime le workflow jetable et son channel : la cascade emporte étapes, versions et affaires. */
async function rendreLaBase(
	api: APIRequestContext,
	workflowId: string,
	channelId?: string,
): Promise<void> {
	if (channelId) {
		await api.delete(`${CARDS}?channel_id=eq.${channelId}`, { headers: enTetesService() })
		await api.delete(`${CHANNELS}?id=eq.${channelId}`, { headers: enTetesService() })
	}
	await api.delete(`${WF}?id=eq.${workflowId}`, { headers: enTetesService() })
}

/**
 * Une fixture complète : un workflow à deux étapes, un channel, quatre affaires dont une archivée
 * et une en corbeille, et une version publiée qui décrit exactement cette structure.
 */
async function fixture(api: APIRequestContext, jeton: string, nom: string) {
	const workflow = await workflowJetable(api, `Plan — ${nom} ${randomUUID()}`)
	const depart = await etapeJetable(api, workflow, NOEUD_PROSPECTION, 1, true, 'Départ')
	const arrivee = await etapeJetable(api, workflow, NOEUD_NEGOCIATION, 2, false, 'Arrivée')
	const channel = await channelJetable(api, workflow)
	const cards = {
		active: await cardJetable(api, channel, workflow, depart, 'tst plan active'),
		seconde: await cardJetable(api, channel, workflow, arrivee, 'tst plan seconde'),
		archivee: await cardJetable(api, channel, workflow, depart, 'tst plan archivée', 'archived'),
		corbeille: await cardJetable(api, channel, workflow, depart, 'tst plan corbeille', 'deleted'),
	}
	const version = await publier(api, jeton, workflow)
	return { workflow, channel, depart, arrivee, version, cards }
}

test.describe('N1 — le plan nominal, et l’exhaustivité (lignes a, b)', () => {
	test('ligne a — sur la version du seed, le plan est prêt et compte TOUTES les affaires', async ({
		request,
	}) => {
		const jeton = await jetonDe(COMPTES_SEED[0].adresse)

		const versions = await request.get(
			`${VERSIONS}?workflow_id=eq.${WORKFLOW_SEED}&order=version_number.asc&limit=1`,
			{ headers: enTetesAuthentifies(jeton) },
		)
		expect(versions.status()).toBe(200)
		const publiees = (await versions.json()) as { id: string }[]
		// `toHaveLength` et non une simple vérité : le seed DOIT publier une version du workflow par
		// défaut (§7 ter.8), et sans elle cette ligne ne prouverait rien tout en restant verte.
		expect(publiees, 'le seed publie une version du workflow par défaut (§7 ter.8)').toHaveLength(1)
		const version = publiees[0] as { id: string }

		const reponse = await planifier(request, jeton, version.id)
		expect(reponse.status()).toBe(200)
		const plan = (await reponse.json()) as Plan

		expect(plan.ready).toBe(true)
		expect(plan.summary.cards_unresolved).toBe(0)
		expect(plan.summary.steps_removed).toBe(0)

		// L'EXHAUSTIVITÉ, MESURÉE ET NON SUPPOSÉE. La clé de service ignore la RLS : si
		// l'administratrice en voyait moins, le plan serait partiel et le dirait prêt quand même.
		// L'administratrice porte pourtant un droit fin `none` sur un track du seed — c'est la règle
		// 2 d'`app.resolve_access` qui la protège, et c'est elle que cette ligne éprouve.
		const total = await request.get(`${CARDS}?workflow_id=eq.${WORKFLOW_SEED}&select=id`, {
			headers: { ...enTetesService(), Prefer: 'count=exact' },
		})
		expect(total.status()).toBe(200)
		expect(plan.summary.cards_total).toBe(((await total.json()) as unknown[]).length)
	})

	test('ligne b — les affaires ARCHIVÉE et en CORBEILLE figurent dans le plan, avec leur état', async ({
		request,
	}) => {
		const jeton = await jetonDe(COMPTES_SEED[0].adresse)
		const f = await fixture(request, jeton, 'ligne b')
		try {
			const reponse = await planifier(request, jeton, f.version)
			expect(reponse.status()).toBe(200)
			const plan = (await reponse.json()) as Plan

			expect(plan.summary).toEqual({
				cards_total: 4,
				cards_unchanged: 4,
				cards_remapped: 0,
				cards_unresolved: 0,
				steps_removed: 0,
				steps_restored: 0,
			})
			const etats = Object.fromEntries(plan.cards.items.map((a) => [a.card_id, a.state]))
			expect(etats[f.cards.archivee]).toBe('archived')
			expect(etats[f.cards.corbeille]).toBe('deleted')
			expect(etats[f.cards.active]).toBe('active')
			// Chaque affaire reste où elle est : l'étape existe des deux côtés, et c'est la SEULE
			// issue automatique du §7 ter.12.2.
			for (const affaire of plan.cards.items) {
				expect(affaire.resolution).toBe('unchanged')
				expect(affaire.target_step_id).toBe(affaire.current_step_id)
			}
		} finally {
			await rendreLaBase(request, f.workflow, f.channel)
		}
	})
})

test.describe('N2 — une étape retirée, et l’instruction qui lève le blocage (lignes c, d)', () => {
	test('ligne c — les affaires d’une étape retirée restent `unresolved`, sans destination', async ({
		request,
	}) => {
		const jeton = await jetonDe(COMPTES_SEED[0].adresse)
		const f = await fixture(request, jeton, 'ligne c')
		try {
			const neuve = await etapeJetable(request, f.workflow, NOEUD_SIGNATURE, 3, false, 'Née après')
			await poser(request, f.cards.active, neuve)

			const reponse = await planifier(request, jeton, f.version)
			expect(reponse.status()).toBe(200)
			const plan = (await reponse.json()) as Plan

			expect(plan.ready).toBe(false)
			expect(plan.summary.cards_unresolved).toBe(1)
			expect(plan.steps.removed).toEqual([
				{
					step_id: neuve,
					label: 'Née après',
					cards_total: 1,
					cards_unresolved: 1,
					target_step_id: null,
				},
			])
			const bloquee = plan.cards.items.find((a) => a.card_id === f.cards.active)
			expect(bloquee?.resolution).toBe('unresolved')
			expect(bloquee?.target_step_id).toBeNull()
		} finally {
			await rendreLaBase(request, f.workflow, f.channel)
		}
	})

	test('ligne d — une instruction couvrant l’étape retirée rend le plan prêt', async ({
		request,
	}) => {
		const jeton = await jetonDe(COMPTES_SEED[0].adresse)
		const f = await fixture(request, jeton, 'ligne d')
		try {
			const neuve = await etapeJetable(request, f.workflow, NOEUD_SIGNATURE, 3, false, 'Née après')
			await poser(request, f.cards.active, neuve)

			const reponse = await planifier(request, jeton, f.version, {
				step_overrides: [{ from_step_id: neuve, to_step_id: f.arrivee }],
			})
			expect(reponse.status()).toBe(200)
			const plan = (await reponse.json()) as Plan

			expect(plan.ready).toBe(true)
			expect(plan.summary.cards_remapped).toBe(1)
			expect(plan.summary.cards_unresolved).toBe(0)
			expect(plan.steps.removed[0]?.target_step_id).toBe(f.arrivee)
			const deplacee = plan.cards.items.find((a) => a.card_id === f.cards.active)
			expect(deplacee?.resolution).toBe('remapped')
			expect(deplacee?.target_step_id).toBe(f.arrivee)
		} finally {
			await rendreLaBase(request, f.workflow, f.channel)
		}
	})
})

test.describe('N3 — la borne, sa troncature et son ordre (ligne e)', () => {
	test('ligne e — tronquée, la liste l’annonce et montre d’abord ce qui BLOQUE', async ({
		request,
	}) => {
		const jeton = await jetonDe(COMPTES_SEED[0].adresse)
		const f = await fixture(request, jeton, 'ligne e')
		try {
			const neuve = await etapeJetable(request, f.workflow, NOEUD_SIGNATURE, 3, false, 'Née après')
			await poser(request, f.cards.corbeille, neuve)

			const reponse = await planifier(request, jeton, f.version, { card_limit: 1 })
			expect(reponse.status()).toBe(200)
			const plan = (await reponse.json()) as Plan

			expect(plan.cards.limit).toBe(1)
			expect(plan.cards.returned).toBe(1)
			expect(plan.cards.total).toBe(4)
			expect(plan.cards.truncated).toBe(true)
			// LES COMPTEURS NE DÉPENDENT PAS DE LA PAGE : un verdict qui changerait avec la taille de
			// la page ne serait pas un verdict.
			expect(plan.summary.cards_total).toBe(4)
			expect(plan.summary.cards_unresolved).toBe(1)
			// L'ORDRE EST UNE PROPRIÉTÉ D'USAGE : la seule ligne rendue est l'affaire bloquante, et
			// non une affaire tranquille qui aurait laissé croire à un plan sain.
			expect(plan.cards.items[0]?.card_id).toBe(f.cards.corbeille)
			expect(plan.cards.items[0]?.resolution).toBe('unresolved')
		} finally {
			await rendreLaBase(request, f.workflow, f.channel)
		}
	})
})

test.describe('N4 — les refus de forme (lignes f, g, h, i, j)', () => {
	const refus: {
		ligne: string
		corps: Record<string, unknown>
		message: string
	}[] = [
		{ ligne: 'f', corps: { card_limit: 0 }, message: 'limite invalide' },
		{ ligne: 'g', corps: { step_overrides: { a: 1 } }, message: 'remappage invalide' },
	]

	for (const cas of refus) {
		test(`ligne ${cas.ligne} — « ${cas.message} »`, async ({ request }) => {
			const jeton = await jetonDe(COMPTES_SEED[0].adresse)
			const f = await fixture(request, jeton, `ligne ${cas.ligne}`)
			try {
				const reponse = await planifier(request, jeton, f.version, cas.corps)
				expect(reponse.status()).toBe(400)
				const corps = (await reponse.json()) as { code: string; message: string }
				expect(corps.code).toBe('P0001')
				expect(corps.message).toBe(cas.message)
			} finally {
				await rendreLaBase(request, f.workflow, f.channel)
			}
		})
	}

	test('ligne h — deux instructions sur la même étape rendent « remappage ambigu »', async ({
		request,
	}) => {
		const jeton = await jetonDe(COMPTES_SEED[0].adresse)
		const f = await fixture(request, jeton, 'ligne h')
		try {
			const neuve = await etapeJetable(request, f.workflow, NOEUD_SIGNATURE, 3, false, 'Née après')
			const reponse = await planifier(request, jeton, f.version, {
				step_overrides: [
					{ from_step_id: neuve, to_step_id: f.depart },
					{ from_step_id: neuve, to_step_id: f.arrivee },
				],
			})
			expect(reponse.status()).toBe(400)
			const corps = (await reponse.json()) as { code: string; message: string }
			expect(corps.code).toBe('P0001')
			expect(corps.message).toBe('remappage ambigu')
		} finally {
			await rendreLaBase(request, f.workflow, f.channel)
		}
	})

	test('ligne i — une instruction sur une étape CONSERVÉE est refusée, non appliquée', async ({
		request,
	}) => {
		const jeton = await jetonDe(COMPTES_SEED[0].adresse)
		const f = await fixture(request, jeton, 'ligne i')
		try {
			const reponse = await planifier(request, jeton, f.version, {
				step_overrides: [{ from_step_id: f.depart, to_step_id: f.arrivee }],
			})
			expect(reponse.status()).toBe(400)
			const corps = (await reponse.json()) as { code: string; message: string }
			expect(corps.code).toBe('P0001')
			expect(corps.message).toBe('origine de remappage inconnue')
		} finally {
			await rendreLaBase(request, f.workflow, f.channel)
		}
	})

	test('ligne j — une cible absente de la version est refusée', async ({ request }) => {
		const jeton = await jetonDe(COMPTES_SEED[0].adresse)
		const f = await fixture(request, jeton, 'ligne j')
		try {
			const neuve = await etapeJetable(request, f.workflow, NOEUD_SIGNATURE, 3, false, 'Née après')
			const reponse = await planifier(request, jeton, f.version, {
				step_overrides: [{ from_step_id: neuve, to_step_id: neuve }],
			})
			expect(reponse.status()).toBe(400)
			const corps = (await reponse.json()) as { code: string; message: string }
			expect(corps.code).toBe('P0001')
			expect(corps.message).toBe('cible de remappage absente de la version')
		} finally {
			await rendreLaBase(request, f.workflow, f.channel)
		}
	})
})

test.describe('N5 — les refus d’autorisation (lignes k, l, m, n, o)', () => {
	for (const [ligne, compte] of [
		['k', COMPTES_SEED[1]],
		['l', COMPTES_SEED[2]],
	] as const) {
		test(`ligne ${ligne} — un ${compte.role} est refusé : son plan serait PARTIEL`, async ({
			request,
		}) => {
			const jetonAdmin = await jetonDe(COMPTES_SEED[0].adresse)
			const jeton = await jetonDe(compte.adresse)
			const f = await fixture(request, jetonAdmin, `ligne ${ligne}`)
			try {
				const reponse = await planifier(request, jeton, f.version)
				expect(reponse.status()).toBe(403)
				const corps = (await reponse.json()) as { code: string; message: string }
				expect(corps.code).toBe('42501')
				// LE MÊME MESSAGE POUR LES DEUX PROFILS : le plan n'est pas un oracle de droits fins.
				expect(corps.message).toBe('plan reserve aux administrateurs')
			} finally {
				await rendreLaBase(request, f.workflow, f.channel)
			}
		})
	}

	test('ligne m — une version inexistante rend « version introuvable »', async ({ request }) => {
		const jeton = await jetonDe(COMPTES_SEED[0].adresse)
		const reponse = await planifier(request, jeton, randomUUID())
		expect(reponse.status()).toBe(400)
		const corps = (await reponse.json()) as { code: string; message: string }
		expect(corps.code).toBe('P0001')
		expect(corps.message).toBe('version introuvable')
	})

	test('ligne n — une version d’un AUTRE workspace rend le même message — refus n° 3', async ({
		request,
	}) => {
		// Sans ce second workspace RÉEL, le refus serait vrai par simple absence et ne prouverait
		// rien (décision 50). La version y est réellement posée, et son existence est constatée avec
		// la clé de service avant que l'administratrice ne s'y heurte.
		const jeton = await jetonDe(COMPTES_SEED[0].adresse)
		const workspaceEtranger = randomUUID()
		const workflowEtranger = randomUUID()
		const versionEtrangere = randomUUID()
		try {
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
							composition: { workflow: { id: workflowEtranger }, steps: [] },
							composition_fingerprint: 'a'.repeat(64),
						},
					})
				).status(),
			).toBe(201)

			const reponse = await planifier(request, jeton, versionEtrangere)
			expect(reponse.status()).toBe(400)
			const corps = (await reponse.json()) as { code: string; message: string }
			expect(corps.code).toBe('P0001')
			// LE MÊME MESSAGE QU'À LA LIGNE m : la fonction ne dit pas à l'appelant qu'une version
			// existe ailleurs, sans quoi elle serait un oracle d'existence (§4.3).
			expect(corps.message).toBe('version introuvable')
		} finally {
			await request.delete(`${WORKSPACES}?id=eq.${workspaceEtranger}`, {
				headers: enTetesService(),
			})
		}
	})

	test('ligne o — un appel anonyme obtient 401, le privilège refusant avant la vérification 1', async ({
		request,
	}) => {
		const reponse = await request.post(RPC_PLAN, {
			headers: enTetesAnonymes(),
			data: { target_version_id: randomUUID() },
		})
		expect(reponse.status()).toBe(401)
	})
})
