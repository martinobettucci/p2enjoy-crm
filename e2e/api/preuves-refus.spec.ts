// @verifies CRM-014 (docs/BACKLOG.md) — les douze preuves de refus, hors interface
// @verifies docs/SPEC-permissions-rls.md §7 (le tableau des douze preuves), §7.1 (pourquoi elles
//           sont rassemblées), §7.2 (contrat mesuré, ligne à ligne), §7.3 (les cinq absences
//           figées et le cas particulier de la n° 10), §7.4 (non-complaisance)
// @verifies docs/SPEC-test-harness.md §4.3 (fixtures `jetons.ts`), §4.6 (fichier consolidé)
// @verifies docs/SPEC-workflow-engine.md §5.3 (discrétion : `card_not_found` ≠ `forbidden`)
// @verifies docs/SPEC-seed.md §2.3 (comptes), §2.11 (droits fins) ; docs/SPEC-cards.md §9 (cards)
// @verifies docs/INCONSISTENCY_REPORT.md INC-014 (aucune politique d'identité), INC-021 (aucun
//           écran), INC-057 (la preuve n° 3 sur les cards n'était pas écrite)
// @verifies CLAUDE.md §10 (toute règle d'accès se prouve hors interface, avec le jeton réel)
//
// Les douze scénarios de `docs/SPEC-permissions-rls.md` §7, dans leur ordre, exercés **sans passer
// par l'interface**, avec les jetons réels obtenus par la véritable route de connexion. Aucun
// navigateur n'est lancé — et pour cause : cette unité ne livre aucun écran (INC-021).
//
// POURQUOI CE FICHIER DUPLIQUE DES ASSERTIONS DÉJÀ VERTES AILLEURS (§7.1, décision 147).
// Sept des douze preuves sont déjà exercées dans les fichiers des unités précédentes, où elles
// sont des **corollaires** du contrat d'API de leur table. Aucune ne répond à la question que pose
// la Definition of Done de `CRM-014` : *les douze sont-elles exercées, et lesquelles ne le sont
// pas ?* Tant que les preuves vivent dans quatorze fichiers, une preuve manquante n'a aucun lieu
// où être vue — c'est exactement ce qui est arrivé à la n° 3 sur les cards (INC-057).
//
// TROIS PRÉCAUTIONS gouvernent tout le fichier, héritées des unités précédentes :
//
//   * la clé de service ne prouve JAMAIS un refus. Elle établit que les lignes existent, avant
//     qu'on affirme que personne ne les voit (décision 50) ;
//   * un refus d'écriture par clause `USING` ne lève rien : PostgREST rend `200` ou `204` et ne
//     modifie rien. Tout refus d'écriture RELIT donc la ligne et la constate inchangée ;
//   * tout scénario qui écrit nettoie derrière lui, y compris en cas d'échec, par identifiant ou
//     par préfixe — jamais par prédicat métier (décision 108).

import { expect, test, type APIRequestContext } from '@playwright/test'
import { enTetesAnonymes, enTetesAuthentifies, enTetesService, jetonDe } from './jetons'

/** Le workspace, le workflow global et ses étapes (`docs/SPEC-seed.md` §2). */
const WS_SEED = '5eed0000-0000-4000-8000-000000000001'
const WF_GLOBAL = '5eed0000-0000-4000-8000-000000000051'
const ETAPE_PROSPECTION = '5eed0000-0000-4000-8000-000000000061'
const ETAPE_QUALIFICATION = '5eed0000-0000-4000-8000-000000000064'

/** L'administratrice du seed — la seule de son workspace, ce que la suite pgTAP assère. */
const U_ADMIN = '5eed0000-0000-4000-8000-000000000011'

/** Le channel dont le track est FERMÉ au `viewer` par un droit fin `none` (§2.11). */
const CH_FERME_AU_VIEWER = '5eed0000-0000-4000-8000-000000000032'

/** Une card que le `viewer` VOIT, et l'étape vers laquelle une transition existe. */
const CARD_VUE_DU_VIEWER = '5eed0000-0000-4000-8000-0000000000c4'
const ETAPE_DEPUIS_C4 = '5eed0000-0000-4000-8000-000000000064'

/** Une card du channel fermé : le `viewer` ne doit pas même apprendre qu'elle existe. */
const CARD_CACHEE_AU_VIEWER = '5eed0000-0000-4000-8000-0000000000c1'

/**
 * Les douze tables métier que le seed peuple réellement.
 *
 * Énumérées et non échantillonnées : la preuve n° 11 porte sur « n'importe quelle table métier »,
 * et un échantillon laisserait naître une table hors du contrôle. `track_members` et
 * `channel_members` y figurent depuis `CRM-012` — `CRM-008` les excluait parce qu'elles étaient
 * vides, et un « zéro ligne » sur une table vide ne prouve rien (docs/SPEC-test-harness.md §4.3).
 */
const TABLES_METIER = [
	'tracks',
	'channels',
	'track_members',
	'channel_members',
	'workflows',
	'workflow_steps',
	'workflow_transitions',
	'workflow_nodes_catalog',
	'form_fields',
	'form_field_rules',
	'cards',
	'card_field_values',
] as const

/** Les quatre tables de la famille « workflow », sur lesquelles porte la preuve n° 2. */
const FAMILLE_WORKFLOW = [
	'workflows',
	'workflow_steps',
	'workflow_transitions',
	'workflow_nodes_catalog',
] as const

/** Préfixe des lignes créées par ces scénarios. Le ménage ne s'appuie que sur lui. */
const PREFIXE = 'tst-crm014'

/** Identifiants de la chaîne posée dans le second workspace pour la preuve n° 3. */
const B = {
	workspace: 'e0000000-0000-4000-8000-00000014b001',
	track: 'e0140000-0000-4000-8000-000000000001',
	channel: 'e0140000-0000-4000-8000-000000000002',
	workflow: 'e0140000-0000-4000-8000-000000000003',
	etape: 'e0140000-0000-4000-8000-000000000004',
	noeud: 'e0140000-0000-4000-8000-000000000005',
	card: 'e0140000-0000-4000-8000-000000000006',
} as const

type Erreur = { code?: string; message?: string }

let jetonAdmin: string
let jetonBizdev: string
let jetonViewer: string

test.beforeAll(async () => {
	jetonAdmin = await jetonDe('admin@p2enjoy.test')
	jetonBizdev = await jetonDe('bizdev@p2enjoy.test')
	jetonViewer = await jetonDe('viewer@p2enjoy.test')
})

/** Compte les lignes qu'un appelant obtient sur une ressource. Jamais employé pour une écriture. */
async function lignes(
	requete: APIRequestContext,
	chemin: string,
	entetes: Record<string, string>,
): Promise<unknown[]> {
	const reponse = await requete.get(chemin, { headers: entetes })
	expect(reponse.status(), `lecture de ${chemin}`).toBe(200)
	return (await reponse.json()) as unknown[]
}

/**
 * Pose dans un SECOND workspace la chaîne complète qu'exige une card : workspace, track, workflow,
 * nœud, étape initiale, channel, card.
 *
 * Passe par la clé de service, seule à pouvoir créer un workspace — aucune politique ne l'autorise
 * à un client, et `CRM-012` en a décidé ainsi. Le fait est nommé plutôt que masqué, comme le font
 * déjà `tracks.spec.ts`, `channels.spec.ts` et `workflows.spec.ts`.
 *
 * Le seed ne fournit **aucun** second workspace (`docs/SPEC-seed.md` §8) : `CRM-014` fabrique donc
 * le sien et le détruit, plutôt que d'étendre un seed qui appartient à `CRM-005` et `CRM-046`.
 */
async function poserChaineB(requete: APIRequestContext): Promise<void> {
	const creer = async (table: string, corps: Record<string, unknown>) => {
		const reponse = await requete.post(`/rest/v1/${table}`, {
			headers: { ...enTetesService(), 'Content-Type': 'application/json' },
			data: corps,
		})
		expect(reponse.status(), `fixture ${table} de la preuve n° 3 : ${await reponse.text()}`).toBe(
			201,
		)
	}

	await creer('workspaces', {
		id: B.workspace,
		name: `${PREFIXE} workspace B`,
		slug: `${PREFIXE}-workspace-b`,
	})
	await creer('tracks', {
		id: B.track,
		workspace_id: B.workspace,
		name: `${PREFIXE} track B`,
		slug: `${PREFIXE}-track-b`,
		position: 1,
	})
	await creer('workflows', { id: B.workflow, workspace_id: B.workspace, name: `${PREFIXE} wf B` })
	await creer('workflow_nodes_catalog', {
		id: B.noeud,
		workspace_id: B.workspace,
		key: `${PREFIXE}-noeud-b`,
		label: `${PREFIXE} nœud B`,
	})
	await creer('workflow_steps', {
		id: B.etape,
		workflow_id: B.workflow,
		workspace_id: B.workspace,
		node_id: B.noeud,
		position: 1,
		is_initial: true,
	})
	await creer('channels', {
		id: B.channel,
		workspace_id: B.workspace,
		track_id: B.track,
		name: `${PREFIXE} channel B`,
		slug: `${PREFIXE}-channel-b`,
		workflow_id: B.workflow,
		position: 1,
	})
	await creer('cards', {
		id: B.card,
		workspace_id: B.workspace,
		channel_id: B.channel,
		workflow_id: B.workflow,
		current_step_id: B.etape,
		title: `${PREFIXE} card de B`,
		position: 1,
	})
}

/** Défait la chaîne dans l'ordre inverse des dépendances. Appelé même si le scénario échoue. */
async function retirerChaineB(requete: APIRequestContext): Promise<void> {
	const cibles: Array<[string, string]> = [
		['cards', B.card],
		['channels', B.channel],
		['workflow_steps', B.etape],
		['workflow_nodes_catalog', B.noeud],
		['workflows', B.workflow],
		['tracks', B.track],
		['workspaces', B.workspace],
	]
	for (const [table, id] of cibles) {
		await requete.delete(`/rest/v1/${table}?id=eq.${id}`, { headers: enTetesService() })
	}
}

// =================================================================================================
// PREUVE N° 1 — `viewer` tente `move_card`
// =================================================================================================

test.describe('PREUVE N° 1 — un `viewer` ne déplace aucune card', () => {
	test('sur une card qu’il VOIT : 403, 42501, `forbidden`, et la card ne bouge pas', async ({
		request,
	}) => {
		const avant = await lignes(
			request,
			`/rest/v1/cards?id=eq.${CARD_VUE_DU_VIEWER}&select=current_step_id`,
			enTetesService(),
		)

		const reponse = await request.post('/rest/v1/rpc/move_card', {
			headers: { ...enTetesAuthentifies(jetonViewer), 'Content-Type': 'application/json' },
			data: { card_id: CARD_VUE_DU_VIEWER, to_step_id: ETAPE_DEPUIS_C4 },
		})

		expect(reponse.status()).toBe(403)
		const corps = (await reponse.json()) as Erreur
		expect(corps.code).toBe('42501')
		expect(corps.message).toBe('forbidden')

		// Le refus doit être réel : un `403` rendu après un déplacement effectué serait le pire des
		// deux mondes. La ligne est relue avec la clé de service, qui ne prouve jamais un refus.
		const apres = await lignes(
			request,
			`/rest/v1/cards?id=eq.${CARD_VUE_DU_VIEWER}&select=current_step_id`,
			enTetesService(),
		)
		expect(apres).toEqual(avant)
	})

	test('sur une card d’un channel FERMÉ : `card_not_found`, jamais `forbidden`', async ({
		request,
	}) => {
		// Règle de discrétion (docs/SPEC-workflow-engine.md §5.3) : répondre `forbidden` apprendrait
		// au `viewer` qu'une card existe hors de sa vue. Le même jeton distingue donc les deux cas.
		const reponse = await request.post('/rest/v1/rpc/move_card', {
			headers: { ...enTetesAuthentifies(jetonViewer), 'Content-Type': 'application/json' },
			data: { card_id: CARD_CACHEE_AU_VIEWER, to_step_id: ETAPE_QUALIFICATION },
		})

		expect(reponse.status()).toBe(400)
		const corps = (await reponse.json()) as Erreur
		expect(corps.code).toBe('P0001')
		expect(corps.message).toBe('card_not_found')
	})
})

// =================================================================================================
// PREUVE N° 2 — `business_developer` tente de modifier un workflow
// =================================================================================================

test.describe('PREUVE N° 2 — un `business_developer` ne touche pas au vocabulaire du workflow', () => {
	const corpsMinimal: Record<(typeof FAMILLE_WORKFLOW)[number], Record<string, unknown>> = {
		workflows: { workspace_id: WS_SEED, name: `${PREFIXE} wf` },
		workflow_steps: {
			workspace_id: WS_SEED,
			workflow_id: WF_GLOBAL,
			node_id: '5eed0000-0000-4000-8000-000000000041',
			position: 99,
		},
		workflow_transitions: {
			workspace_id: WS_SEED,
			workflow_id: WF_GLOBAL,
			from_step_id: ETAPE_PROSPECTION,
			to_step_id: ETAPE_QUALIFICATION,
		},
		workflow_nodes_catalog: { workspace_id: WS_SEED, key: `${PREFIXE}-noeud`, label: `${PREFIXE}` },
	}

	for (const table of FAMILLE_WORKFLOW) {
		test(`${table} : l’insertion est refusée par une erreur, 403 et 42501`, async ({ request }) => {
			const reponse = await request.post(`/rest/v1/${table}`, {
				headers: { ...enTetesAuthentifies(jetonBizdev), 'Content-Type': 'application/json' },
				data: corpsMinimal[table],
			})

			expect(reponse.status()).toBe(403)
			const corps = (await reponse.json()) as Erreur
			expect(corps.code).toBe('42501')
			expect(corps.message).toContain('row-level security policy')

			// L'échec doit être réel jusque dans la base, pas seulement dans le code HTTP.
			const restes = await lignes(
				request,
				`/rest/v1/${table}?select=id&workspace_id=eq.${WS_SEED}`,
				enTetesService(),
			)
			expect(restes.length).toBeGreaterThan(0) // le seed est intact
		})
	}

	test('le renommage d’un workflow ne lève rien ET ne change rien', async ({ request }) => {
		// Deuxième forme du refus, et la plus traître : une clause `USING` ne rejette pas, elle
		// filtre. PostgREST rend `200` et un tableau vide. Sans relecture, ce scénario serait vert
		// pour un produit qui aurait réellement renommé le workflow.
		const avant = await lignes(
			request,
			`/rest/v1/workflows?id=eq.${WF_GLOBAL}&select=name`,
			enTetesService(),
		)

		const reponse = await request.patch(`/rest/v1/workflows?id=eq.${WF_GLOBAL}`, {
			headers: {
				...enTetesAuthentifies(jetonBizdev),
				'Content-Type': 'application/json',
				Prefer: 'return=representation',
			},
			data: { name: `${PREFIXE} renommage interdit` },
		})

		expect(reponse.status()).toBe(200)
		expect(await reponse.json()).toEqual([])

		const apres = await lignes(
			request,
			`/rest/v1/workflows?id=eq.${WF_GLOBAL}&select=name`,
			enTetesService(),
		)
		expect(apres).toEqual(avant)
	})
})

// =================================================================================================
// PREUVE N° 3 — membre du workspace A lit une card du workspace B
// =================================================================================================

test.describe('PREUVE N° 3 — la frontière du workspace tient sur les cards', () => {
	// INC-057 : cette preuve était annoncée par l'en-tête de `e2e/api/cards.spec.ts` sans y être
	// écrite. Elle l'est ici, et sur une chaîne complète — une card ne peut pas exister sans son
	// channel, son workflow et son étape.
	test.beforeEach(async ({ request }) => {
		await retirerChaineB(request) // un passage interrompu ne doit pas empoisonner le suivant
		await poserChaineB(request)
	})
	test.afterEach(async ({ request }) => {
		await retirerChaineB(request)
	})

	test('la card de B existe réellement — condition de validité du zéro ligne', async ({
		request,
	}) => {
		const vues = await lignes(
			request,
			`/rest/v1/cards?id=eq.${B.card}&select=id,workspace_id`,
			enTetesService(),
		)
		expect(vues).toHaveLength(1)
	})

	for (const [role, obtenir] of [
		['admin', () => jetonAdmin],
		['business_developer', () => jetonBizdev],
		['viewer', () => jetonViewer],
	] as const) {
		test(`${role} du workspace A : 200 et [] sur la card de B`, async ({ request }) => {
			const vues = await lignes(
				request,
				`/rest/v1/cards?id=eq.${B.card}&select=id`,
				enTetesAuthentifies(obtenir()),
			)
			expect(vues).toEqual([])
		})
	}

	test('un administrateur de A ne modifie pas non plus la card de B', async ({ request }) => {
		const reponse = await request.patch(`/rest/v1/cards?id=eq.${B.card}`, {
			headers: {
				...enTetesAuthentifies(jetonAdmin),
				'Content-Type': 'application/json',
				Prefer: 'return=representation',
			},
			data: { title: `${PREFIXE} titre pirate` },
		})

		expect(reponse.status()).toBe(200)
		expect(await reponse.json()).toEqual([])

		const relue = (await lignes(
			request,
			`/rest/v1/cards?id=eq.${B.card}&select=title`,
			enTetesService(),
		)) as Array<{ title: string }>
		expect(relue[0]?.title).toBe(`${PREFIXE} card de B`)
	})
})

// =================================================================================================
// PREUVE N° 4 — un droit fin `none` ferme les cards du channel et leurs valeurs
// =================================================================================================

test.describe('PREUVE N° 4 — un droit fin `none` ferme la card ET son formulaire', () => {
	test('les cards du channel fermé existent, et le `viewer` n’en voit aucune', async ({
		request,
	}) => {
		const vuesParLeService = await lignes(
			request,
			`/rest/v1/cards?select=id&channel_id=eq.${CH_FERME_AU_VIEWER}`,
			enTetesService(),
		)
		expect(vuesParLeService.length).toBeGreaterThan(0)

		const vuesParLeViewer = await lignes(
			request,
			`/rest/v1/cards?select=id&channel_id=eq.${CH_FERME_AU_VIEWER}`,
			enTetesAuthentifies(jetonViewer),
		)
		expect(vuesParLeViewer).toEqual([])
	})

	test('les valeurs de formulaire de ces cards lui sont fermées aussi', async ({ request }) => {
		// Le droit fin ne s'arrête pas à la card : une valeur de formulaire lisible dirait le
		// montant d'une affaire que son porteur ne voit pas.
		const filtre = `card_id=eq.${CARD_CACHEE_AU_VIEWER}`

		// `card_field_values` n'a pas de colonne `id` : sa clé est composite (`card_id`, `field_id`),
		// mesuré. Sélectionner `id` rend `400` — une erreur de test qui aurait pu passer pour un refus.
		const vuesParLeService = await lignes(
			request,
			`/rest/v1/card_field_values?select=card_id&${filtre}`,
			enTetesService(),
		)
		expect(vuesParLeService.length).toBeGreaterThan(0)

		const vuesParLeViewer = await lignes(
			request,
			`/rest/v1/card_field_values?select=card_id&${filtre}`,
			enTetesAuthentifies(jetonViewer),
		)
		expect(vuesParLeViewer).toEqual([])
	})
})

// =================================================================================================
// PREUVE N° 5 — mise à jour directe de `cards.current_step_id`
// =================================================================================================

test.describe('PREUVE N° 5 — même une administratrice ne déplace pas une card par `PATCH`', () => {
	test('403, 42501, `permission denied for table cards`, et l’étape ne change pas', async ({
		request,
	}) => {
		const avant = await lignes(
			request,
			`/rest/v1/cards?id=eq.${CARD_CACHEE_AU_VIEWER}&select=current_step_id`,
			enTetesService(),
		)

		const reponse = await request.patch(`/rest/v1/cards?id=eq.${CARD_CACHEE_AU_VIEWER}`, {
			headers: { ...enTetesAuthentifies(jetonAdmin), 'Content-Type': 'application/json' },
			data: { current_step_id: ETAPE_QUALIFICATION },
		})

		expect(reponse.status()).toBe(403)
		const corps = (await reponse.json()) as Erreur
		expect(corps.code).toBe('42501')
		expect(corps.message).toContain('permission denied for table cards')

		const apres = await lignes(
			request,
			`/rest/v1/cards?id=eq.${CARD_CACHEE_AU_VIEWER}&select=current_step_id`,
			enTetesService(),
		)
		expect(apres).toEqual(avant)
	})
})

// =================================================================================================
// PREUVES N° 6, 7, 8, 9, 12 — non satisfaisables, et l'absence est FIGÉE (§7.3)
// =================================================================================================
// Ces scénarios n'affirment pas un refus : ils affirment que le sujet du refus **n'existe pas**.
// Chacun deviendra ROUGE le jour où la table ou la fonction naîtra, et désignera alors la preuve à
// écrire — au lieu de laisser une limite survivre à sa cause (mécanisme de la décision 51).

const ABSENCES = [
	{ preuve: 6, table: 'mail_inbound_accounts', unite: 'CRM-052' },
	{ preuve: 7, table: 'mail_outbound_identities', unite: 'CRM-053' },
	{ preuve: 8, table: 'audit_log', unite: 'CRM-072' },
	{ preuve: 9, table: 'attachments', unite: 'CRM-057' },
] as const

test.describe('PREUVES N° 6, 7, 8, 9 — leurs tables n’existent pas, et c’est asséré', () => {
	for (const { preuve, table, unite } of ABSENCES) {
		test(`PREUVE N° ${preuve} : \`${table}\` est absente — attendue par ${unite}`, async ({
			request,
		}) => {
			// La clé de service est employée à dessein : si même elle ne trouve pas la table, aucun
			// appelant ne la trouvera. Un `404` obtenu avec un jeton d'utilisateur pourrait signifier
			// « table cachée » plutôt que « table absente ».
			const reponse = await request.get(`/rest/v1/${table}?select=*`, { headers: enTetesService() })
			expect(reponse.status()).toBe(404)
			expect((await reponse.json()) as Erreur).toMatchObject({ code: 'PGRST205' })
		})
	}
})

// PREUVE N° 8, MOITIÉ SATISFAISABLE DEPUIS `CRM-044`. `card_events` est sortie de la liste des
// absences ci-dessus : elle existe, et le refus qu'elle oppose est désormais MESURABLE plutôt
// qu'attendu. Le contrat complet — lecture filtrée, immuabilité, cycle de vie — est exercé par
// `e2e/api/timeline.spec.ts` ; ce qui est repris ici est la ligne du §7 de
// `docs/SPEC-permissions-rls.md`, et elle seule.
test.describe('PREUVE N° 8 — insertion directe dans `card_events`, refusée', () => {
	test('403 et 42501 : aucun rôle ne peut forger un événement, `service_role` compris', async ({
		request,
	}) => {
		const card = await request.get('/rest/v1/cards?select=id,workspace_id&limit=1', {
			headers: enTetesService(),
		})
		const cards = (await card.json()) as Array<{ id: string; workspace_id: string }>
		const cible = cards.at(0)
		expect(cible, 'aucune card en base : le scénario n’aurait aucun sujet').toBeDefined()

		const reponse = await request.post('/rest/v1/card_events', {
			headers: enTetesService(),
			data: { card_id: cible?.id, workspace_id: cible?.workspace_id, type: 'moved' },
		})
		expect(reponse.status()).toBe(403)
		expect((await reponse.json()) as Erreur).toMatchObject({ code: '42501' })
	})
})

test.describe('PREUVE N° 12 — `queue_outbound_email` n’existe pas, et c’est asséré', () => {
	test('404 et PGRST202 : envoyer avec l’identité d’autrui suppose une fonction d’envoi', async ({
		request,
	}) => {
		const reponse = await request.post('/rest/v1/rpc/queue_outbound_email', {
			headers: { ...enTetesService(), 'Content-Type': 'application/json' },
			data: {},
		})
		expect(reponse.status()).toBe(404)
		expect((await reponse.json()) as Erreur).toMatchObject({ code: 'PGRST202' })
	})
})

// =================================================================================================
// PREUVE N° 10 — le dernier administrateur : l'effet est obtenu, la règle n'existe pas
// =================================================================================================

test.describe('PREUVE N° 10 — l’effet est obtenu, et ce scénario dit ce qu’il ne prouve PAS', () => {
	// LIMITE FIGÉE PAR UNE ASSERTION, ET NON PAR UN COMMENTAIRE (décision 148).
	//
	// L'écriture est sans effet, mais parce que `workspace_members` ne porte AUCUNE politique
	// (INC-014) : c'est le refus par défaut de `CRM-003`, pas une règle protégeant le dernier
	// administrateur. Le jour où INC-014 sera arbitrée, la requête trouvera sa ligne et la
	// modifiera — et ces assertions tomberont, ce qui est exactement ce qu'on leur demande.
	test('se retirer son rôle rend 200 et [], et le rôle reste `admin`', async ({ request }) => {
		const filtre = `workspace_id=eq.${WS_SEED}&user_id=eq.${U_ADMIN}`

		const reponse = await request.patch(`/rest/v1/workspace_members?${filtre}`, {
			headers: {
				...enTetesAuthentifies(jetonAdmin),
				'Content-Type': 'application/json',
				Prefer: 'return=representation',
			},
			data: { role: 'viewer' },
		})
		expect(reponse.status()).toBe(200)
		expect(await reponse.json()).toEqual([])

		const relue = (await lignes(
			request,
			`/rest/v1/workspace_members?${filtre}&select=role`,
			enTetesService(),
		)) as Array<{ role: string }>
		expect(relue[0]?.role).toBe('admin')
	})

	test('supprimer son appartenance rend 204 et ne supprime rien', async ({ request }) => {
		// `204` est la réponse de PostgREST à une suppression qui n'a rien trouvé. Sans la
		// relecture, ce scénario serait vert pour un produit qui aurait réellement supprimé la ligne.
		const filtre = `workspace_id=eq.${WS_SEED}&user_id=eq.${U_ADMIN}`

		const reponse = await request.delete(`/rest/v1/workspace_members?${filtre}`, {
			headers: enTetesAuthentifies(jetonAdmin),
		})
		expect(reponse.status()).toBe(204)

		const relue = await lignes(
			request,
			`/rest/v1/workspace_members?${filtre}&select=role`,
			enTetesService(),
		)
		expect(relue).toHaveLength(1)
	})
})

// =================================================================================================
// PREUVE N° 11 — un anonyme ne lit aucune ligne d'aucune table métier
// =================================================================================================

test.describe('PREUVE N° 11 — l’anonyme, sur les douze tables métier peuplées', () => {
	for (const table of TABLES_METIER) {
		test(`${table} : la table est peuplée, et l’anonyme y lit 200 et []`, async ({ request }) => {
			// Les deux moitiés dans le même scénario, et dans cet ordre : la seconde n'a de valeur
			// probante que si la première a réussi (décision 50).
			const vuesParLeService = await lignes(
				request,
				`/rest/v1/${table}?select=*`,
				enTetesService(),
			)
			expect(vuesParLeService.length).toBeGreaterThan(0)

			const reponse = await request.get(`/rest/v1/${table}?select=*`, {
				headers: enTetesAnonymes(),
			})

			// Le refus se manifeste par zéro ligne, PAS par une erreur : les deux formes sont
			// vérifiées séparément (docs/SPEC-permissions-rls.md §7).
			expect(reponse.status()).toBe(200)
			expect(await reponse.json()).toEqual([])
		})
	}
})

// =================================================================================================
// Inventaire — ce que ce fichier couvre, et ce qu'il ne couvre pas
// =================================================================================================

test.describe('Inventaire des douze preuves', () => {
	test('sept preuves sont acquises, cinq ne sont pas satisfaisables, et le compte est asséré', () => {
		// Ce scénario ne mesure pas le produit : il mesure la COUVERTURE, et c'est la question que
		// la Definition of Done de `CRM-014` pose. Le jour où une des cinq tables absentes naîtra,
		// les scénarios de figeage ci-dessus deviendront rouges et ce compte devra être révisé.
		const acquises = [1, 2, 3, 4, 5, 10, 11]
		const nonSatisfaisables = [6, 7, 8, 9, 12]

		expect(acquises.length + nonSatisfaisables.length).toBe(12)
		expect(acquises).toHaveLength(7)

		// La n° 10 est acquise dans son EFFET seulement : sa règle n'existe pas (INC-014, §7.3).
		// Elle est comptée parmi les acquises parce que le scénario existe et mesure l'état réel ;
		// la Definition of Done, elle, ne la coche pas.
		expect(acquises).toContain(10)
	})

	test('la clé de service n’est pas la clé anonyme', () => {
		// Si les deux clés étaient confondues, toutes les conditions de validité mesureraient ce que
		// mesurent les refus, et l'ensemble du fichier deviendrait tautologique.
		expect(enTetesService()['apikey']).not.toBe(enTetesAnonymes()['apikey'])
	})
})
