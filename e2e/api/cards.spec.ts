// @verifies CRM-040 (docs/BACKLOG.md) — cards, hors interface
// @verifies docs/SPEC-cards.md §8.1 (contrat d'API, lignes a à x), §2.4 (clés composites),
//           §3 (adresse générée), §4 (archivage et corbeille), §6 (autorisations), §7 (garde
//           d'archivage d'un nœud occupé), §9 (seed)
// @verifies docs/SPEC-permissions-rls.md §7 (preuves de refus n° 3, 4 et 11 sur les cards)
// @verifies docs/SPEC-seed.md §2.11 (droits fins), docs/SPEC-cards.md §9 (cards du seed)
// @verifies docs/SPEC-test-harness.md §4.3 (projet `api`, hors interface)
// @verifies docs/INCONSISTENCY_REPORT.md INC-021 (aucun écran), INC-046 (workflow d'un channel)
// @verifies CLAUDE.md §10 (toute règle se prouve hors interface, avec le jeton réel)
//
// Ces scénarios exercent le backend **sans passer par l'interface**, avec les jetons réels des
// profils seedés obtenus par la véritable route de connexion. Aucun navigateur n'est lancé — et
// pour cause : cette unité ne livre aucun écran (INC-021).
//
// Ils reprennent une à une les vingt-quatre lignes du tableau de `docs/SPEC-cards.md` §8.1, écrit
// **avant** le code.
//
// TROIS PIÈGES, tous hérités des unités précédentes et tous encore actifs ici :
//
//   * une écriture refusée par la clause `USING` d'une politique ne produit **aucune erreur** :
//     PostgREST rend `200` ou `204` et ne modifie rien. Tout refus de mise à jour relit donc la
//     ligne et la constate **inchangée** (décision 70, décision 106) ;
//   * un « zéro ligne » sur une table vide serait vrai que la RLS refuse ou qu'elle autorise tout.
//     La table est peuplée par le seed, et l'état est d'abord constaté avec la clé de service, qui
//     ne sert **jamais** à prouver un refus (décision 50) ;
//   * chaque scénario qui écrit **nettoie derrière lui**, y compris en cas d'échec — et par
//     identifiant ou par préfixe de titre, **jamais par prédicat métier** : un `delete` par
//     prédicat amputerait le seed, défaut réel trouvé à `CRM-012` (décision 108).

import { expect, test, type APIRequestContext } from '@playwright/test'
import { enTetesAnonymes, enTetesAuthentifies, enTetesService, jetonDe } from './jetons'

/** Le workspace, le workflow global et ses étapes, tels que `docs/SPEC-seed.md` §2 les déclare. */
const WORKSPACE_SEED = '5eed0000-0000-4000-8000-000000000001'
const WORKFLOW_GLOBAL = '5eed0000-0000-4000-8000-000000000051'
const ETAPE_PROSPECTION = '5eed0000-0000-4000-8000-000000000061'
const ETAPE_RELANCE = '5eed0000-0000-4000-8000-000000000062'
/** Ajoutée par `CRM-046` : l'étape « Livré », que `…0cd` occupe désormais activement. */
const ETAPE_LIVRE = '5eed0000-0000-4000-8000-000000000066'

/** Les channels du seed, et ce que les droits fins en font (`docs/SPEC-seed.md` §2.11). */
const CH_GRANDS_COMPTES = '5eed0000-0000-4000-8000-000000000032' // track fermé au `viewer`
const CH_PROSPECTION = '5eed0000-0000-4000-8000-000000000031' // rouvert au `viewer` en écriture
const CH_REFONTE = '5eed0000-0000-4000-8000-000000000034' // rien de particulier
const CH_MAINTENANCE = '5eed0000-0000-4000-8000-000000000035' // lecture seule pour le `bizdev`

/**
 * Les quatorze cards du seed (`docs/SPEC-cards.md` §9, `docs/SPEC-seed.md` §9.3).
 *
 * Énumérées, et non filtrées par préfixe : PostgREST refuse `like` sur une colonne `uuid` — mesuré,
 * `404`. Les énumérer rend en outre le contrat lisible et fait échouer le test si le seed en ajoute
 * une sans que ces preuves soient étendues.
 */
const CARDS_SEED = [
	'5eed0000-0000-4000-8000-0000000000c1',
	'5eed0000-0000-4000-8000-0000000000c2',
	'5eed0000-0000-4000-8000-0000000000c3',
	'5eed0000-0000-4000-8000-0000000000c4',
	'5eed0000-0000-4000-8000-0000000000c5',
	'5eed0000-0000-4000-8000-0000000000c6',
	'5eed0000-0000-4000-8000-0000000000c7',
	'5eed0000-0000-4000-8000-0000000000c8',
	'5eed0000-0000-4000-8000-0000000000c9',
	'5eed0000-0000-4000-8000-0000000000ca',
	'5eed0000-0000-4000-8000-0000000000cb',
	'5eed0000-0000-4000-8000-0000000000cc',
	'5eed0000-0000-4000-8000-0000000000cd',
	'5eed0000-0000-4000-8000-0000000000ce',
	// `CRM-077`, cinquième tranche : l'affaire sous `dossiers-2023`, l'enfant vivant d'un track en
	// corbeille (`docs/SPEC-seed.md` §10.4 bis).
	'5eed0000-0000-4000-8000-0000000000cf',
] as const
const FILTRE_SEED = `id=in.(${CARDS_SEED.join(',')})`

/** Les cards du seed employées par les preuves (`docs/SPEC-cards.md` §9). */
const CARD_GRANDS_COMPTES = '5eed0000-0000-4000-8000-0000000000c1'
const CARD_MAINTENANCE = '5eed0000-0000-4000-8000-0000000000c5'
const CARD_ARCHIVEE = '5eed0000-0000-4000-8000-0000000000c8'
/** `…0cd`, la seule affaire GAGNÉE active du seed — ajoutée par `CRM-046`. */
const CARD_LIVREE = '5eed0000-0000-4000-8000-0000000000cd'

const CARDS = '/rest/v1/cards'
const CATALOGUE = '/rest/v1/workflow_nodes_catalog'

/** Préfixe des titres créés par ces scénarios. Le ménage ne s'appuie que sur lui. */
const PREFIXE = 'tst-crm040'

const FORME_ADRESSE = /^c-[0-9abcdefghjkmnpqrstvwxyz]{8}$/

type Card = {
	id: string
	title: string
	channel_id: string
	workflow_id: string
	current_step_id: string
	position: string | number
	email_local_part: string
	owner_id: string | null
	amount: string | null
	currency: string
	archived_at: string | null
	deleted_at: string | null
}
type Erreur = { code: string; message: string }

/**
 * Retire toute card posée par ces scénarios.
 *
 * Passe par la clé de service : le produit n'expose **aucune** suppression de card (§4), et un test
 * qui n'en nettoierait pas laisserait le seed durablement faux pour les suivants. Le filtre porte
 * sur le préfixe de titre, jamais sur un prédicat métier — leçon de la décision 108.
 */
async function menage(requete: APIRequestContext): Promise<void> {
	await requete.delete(`${CARDS}?title=like.${PREFIXE}*`, { headers: enTetesService() })
}

/** Corps minimal d'une card licite dans un channel donné. */
function corpsCard(channel: string, etape = ETAPE_PROSPECTION, extra: Record<string, unknown> = {}) {
	return {
		workspace_id: WORKSPACE_SEED,
		channel_id: channel,
		workflow_id: WORKFLOW_GLOBAL,
		current_step_id: etape,
		title: `${PREFIXE} ${Math.random().toString(36).slice(2, 8)}`,
		...extra,
	}
}

/** Crée une card avec le jeton fourni et rend la réponse brute. */
async function creer(
	requete: APIRequestContext,
	jeton: string,
	corps: Record<string, unknown>,
) {
	return requete.post(CARDS, {
		headers: { ...enTetesAuthentifies(jeton), Prefer: 'return=representation' },
		data: corps,
	})
}

/** Relit une card avec la clé de service — jamais employée pour prouver un refus. */
async function relire(requete: APIRequestContext, id: string): Promise<Card | undefined> {
	const reponse = await requete.get(`${CARDS}?id=eq.${id}&select=*`, { headers: enTetesService() })
	expect(reponse.status()).toBe(200)
	return ((await reponse.json()) as Card[])[0]
}

let jetonAdmin: string
let jetonBizdev: string
let jetonViewer: string

test.beforeAll(async ({ request }) => {
	jetonAdmin = await jetonDe('admin@p2enjoy.test')
	jetonBizdev = await jetonDe('bizdev@p2enjoy.test')
	jetonViewer = await jetonDe('viewer@p2enjoy.test')
	await menage(request)
})
test.afterEach(async ({ request }) => {
	await menage(request)
})

test.describe('C0 — le seed est dans l’état que le §9 déclare', () => {
	// QUINZE DEPUIS LA CINQUIÈME TRANCHE DE `CRM-077` : l'affaire `…0cf` est posée sous
	// `dossiers-2023`, l'enfant vivant d'un track en corbeille, pour donner son compte non nul à
	// l'énumération (`docs/SPEC-seed.md` §10.4 bis). Le compte est RENFORCÉ et non relâché — « au
	// moins quatorze » n'aurait plus rien dit de ce que la tranche ajoute.
	test('quinze cards, dont une archivée et une en corbeille, toutes avec une adresse conforme', async ({
		request,
	}) => {
		const reponse = await request.get(`${CARDS}?${FILTRE_SEED}&select=*&order=id`, {
			headers: enTetesService(),
		})
		expect(reponse.status()).toBe(200)
		const cards = (await reponse.json()) as Card[]

		expect(cards).toHaveLength(15)
		expect(cards.filter((c) => c.archived_at !== null)).toHaveLength(1)
		expect(cards.filter((c) => c.deleted_at !== null)).toHaveLength(1)
		expect(cards.filter((c) => c.owner_id === null && c.amount === null)).toHaveLength(1)
		expect(new Set(cards.map((c) => c.currency)).size).toBeGreaterThan(1)

		for (const card of cards) expect(card.email_local_part).toMatch(FORME_ADRESSE)
		expect(new Set(cards.map((c) => c.email_local_part)).size).toBe(15)
	})

	test('CRM-046 — les deux cards de « prospection » suivent le workflow dérivé', async ({
		request,
	}) => {
		const reponse = await request.get(
			`${CARDS}?channel_id=eq.${CH_PROSPECTION}&${FILTRE_SEED}&select=id,workflow_id`,
			{ headers: enTetesService() },
		)
		expect(reponse.status()).toBe(200)
		const cards = (await reponse.json()) as Pick<Card, 'id' | 'workflow_id'>[]
		expect(cards).toHaveLength(2)
		expect(new Set(cards.map((card) => card.workflow_id)).size).toBe(1)
		expect(cards.every((card) => card.workflow_id !== WORKFLOW_GLOBAL)).toBe(true)
	})
})

test.describe('C1 — création : lignes a à d du §8.1', () => {
	test('a — l’admin crée une card, et l’adresse est générée', async ({ request }) => {
		const reponse = await creer(request, jetonAdmin, corpsCard(CH_GRANDS_COMPTES))
		expect(reponse.status(), await reponse.text()).toBe(201)
		const [card] = (await reponse.json()) as Card[]
		expect(card!.email_local_part).toMatch(FORME_ADRESSE)
	})

	test('b — deux cards portent deux adresses différentes', async ({ request }) => {
		const une = (await (await creer(request, jetonAdmin, corpsCard(CH_GRANDS_COMPTES))).json()) as Card[]
		const deux = (await (await creer(request, jetonAdmin, corpsCard(CH_GRANDS_COMPTES))).json()) as Card[]
		expect(une[0]!.email_local_part).not.toBe(deux[0]!.email_local_part)
	})

	test('c — une adresse fournie par le client est ignorée et remplacée', async ({ request }) => {
		// « Généré » signifie que la valeur ne vient pas de l'appelant : l'accepter laisserait
		// choisir une adresse devinable (docs/SPEC-cards.md §3.4).
		const reponse = await creer(
			request,
			jetonAdmin,
			corpsCard(CH_GRANDS_COMPTES, ETAPE_PROSPECTION, { email_local_part: 'c-00000000' }),
		)
		expect(reponse.status(), await reponse.text()).toBe(201)
		const [card] = (await reponse.json()) as Card[]
		expect(card!.email_local_part).not.toBe('c-00000000')
		expect(card!.email_local_part).toMatch(FORME_ADRESSE)
	})

	test('d — sans `position`, la card est placée en fin de colonne du board', async ({ request }) => {
		// La portée est le couple (channel, étape), non le channel entier. `perdu` est la seule
		// étape qu'aucune card du seed n'occupe : une card qui y naît prend donc la position 1, ce
		// qui prouve la portée bien mieux qu'une comparaison entre deux colonnes déjà peuplées.
		const etapes = await request.get(
			`/rest/v1/workflow_steps?workflow_id=eq.${WORKFLOW_GLOBAL}` +
				`&select=id,workflow_nodes_catalog!inner(key)&workflow_nodes_catalog.key=eq.perdu`,
			{ headers: enTetesService() },
		)
		const [etapePerdu] = (await etapes.json()) as { id: string }[]

		const premiere = (await (
			await creer(request, jetonAdmin, corpsCard(CH_GRANDS_COMPTES, etapePerdu!.id))
		).json()) as Card[]
		const seconde = (await (
			await creer(request, jetonAdmin, corpsCard(CH_GRANDS_COMPTES, etapePerdu!.id))
		).json()) as Card[]

		expect(Number(premiere[0]!.position)).toBe(1)
		expect(Number(seconde[0]!.position)).toBe(2)

		// Et l'étape `relance`, déjà peuplée par le seed, poursuit SA propre suite : la portée
		// n'est pas le channel.
		const autreColonne = (await (
			await creer(request, jetonAdmin, corpsCard(CH_GRANDS_COMPTES, ETAPE_RELANCE))
		).json()) as Card[]
		expect(Number(autreColonne[0]!.position)).toBeGreaterThan(2)
	})
})

test.describe('C2 — cohérence structurelle : lignes e à g du §8.1', () => {
	test('e — une étape d’un autre workflow est refusée en 409 / 23503', async ({ request }) => {
		// Vérification n° 3 des six de `move_card`, acquise structurellement
		// (docs/SPEC-workflow-engine.md §5, décision 109).
		const etapeCopie = await request.get(
			`/rest/v1/workflow_steps?workflow_id=neq.${WORKFLOW_GLOBAL}&select=id&limit=1`,
			{ headers: enTetesService() },
		)
		const [autre] = (await etapeCopie.json()) as { id: string }[]

		const reponse = await creer(
			request,
			jetonAdmin,
			corpsCard(CH_GRANDS_COMPTES, autre!.id),
		)
		expect(reponse.status()).toBe(409)
		expect(((await reponse.json()) as Erreur).code).toBe('23503')
	})

	test('f — un `workflow_id` autre que celui du channel est refusé', async ({ request }) => {
		const copie = await request.get(
			`/rest/v1/workflows?id=neq.${WORKFLOW_GLOBAL}&select=id&limit=1`,
			{ headers: enTetesService() },
		)
		const [autre] = (await copie.json()) as { id: string }[]

		const reponse = await creer(request, jetonAdmin, {
			...corpsCard(CH_GRANDS_COMPTES),
			workflow_id: autre!.id,
		})
		expect(reponse.status()).toBe(409)
		expect(((await reponse.json()) as Erreur).code).toBe('23503')
	})

	test('g — un `workspace_id` autre que celui du channel est refusé', async ({ request }) => {
		const reponse = await creer(request, jetonAdmin, {
			...corpsCard(CH_GRANDS_COMPTES),
			workspace_id: '55550000-0000-4000-8000-0000000000ff',
		})
		expect(reponse.status()).toBe(409)
		expect(((await reponse.json()) as Erreur).code).toBe('23503')
	})
})

test.describe('C3 — contraintes de valeur : lignes h à j du §8.1', () => {
	test('h — un titre d’espaces est refusé en 400 / 23514', async ({ request }) => {
		const reponse = await creer(request, jetonAdmin, { ...corpsCard(CH_GRANDS_COMPTES), title: '   ' })
		expect(reponse.status()).toBe(400)
		expect(((await reponse.json()) as Erreur).code).toBe('23514')
	})

	test('i — `currency = "euro"` est refusée : la forme ISO 4217 est tenue par la base', async ({
		request,
	}) => {
		const reponse = await creer(request, jetonAdmin, {
			...corpsCard(CH_GRANDS_COMPTES),
			currency: 'euro',
		})
		expect(reponse.status()).toBe(400)
		expect(((await reponse.json()) as Erreur).code).toBe('23514')
	})

	test('j — `probability_override = 101` est refusée', async ({ request }) => {
		const reponse = await creer(request, jetonAdmin, {
			...corpsCard(CH_GRANDS_COMPTES),
			probability_override: 101,
		})
		expect(reponse.status()).toBe(400)
		expect(((await reponse.json()) as Erreur).code).toBe('23514')
	})
})

test.describe('C4 — autorisations d’écriture : lignes k à n du §8.1', () => {
	test('k — le `business_developer` crée une card là où rien ne le restreint', async ({ request }) => {
		const reponse = await creer(request, jetonBizdev, corpsCard(CH_GRANDS_COMPTES))
		expect(reponse.status(), await reponse.text()).toBe(201)
	})

	test('l — …et il est refusé dans `maintenance`, où un droit fin le met en lecture seule', async ({
		request,
	}) => {
		const reponse = await creer(request, jetonBizdev, corpsCard(CH_MAINTENANCE))
		expect(reponse.status()).toBe(403)
		expect(((await reponse.json()) as Erreur).code).toBe('42501')
	})

	test('m — le `viewer` est refusé là où il ne fait que lire', async ({ request }) => {
		const reponse = await creer(request, jetonViewer, corpsCard(CH_REFONTE))
		expect(reponse.status()).toBe(403)
		expect(((await reponse.json()) as Erreur).code).toBe('42501')
	})

	test('n — …et il est accepté dans `prospection`, que son droit fin rouvre EN ÉCRITURE', async ({
		request,
	}) => {
		// C'est la démonstration que le seed ne peut pas porter (INC-046, §9.1) : elle est ici, et
		// elle est plus forte — c'est le `viewer` lui-même qui écrit. Le channel porte le workflow
		// de portée track, donc l'étape doit venir de CE workflow.
		const etapes = await request.get(
			`/rest/v1/workflow_steps?workflow_id=neq.${WORKFLOW_GLOBAL}&select=id,workflow_id&limit=1`,
			{ headers: enTetesService() },
		)
		const [etape] = (await etapes.json()) as { id: string; workflow_id: string }[]

		const reponse = await creer(request, jetonViewer, {
			workspace_id: WORKSPACE_SEED,
			channel_id: CH_PROSPECTION,
			workflow_id: etape!.workflow_id,
			current_step_id: etape!.id,
			title: `${PREFIXE} par le viewer`,
		})
		expect(reponse.status(), await reponse.text()).toBe(201)
	})
})

test.describe('C5 — lecture : lignes o à q du §8.1', () => {
	test('o — le `viewer` ne voit aucune card de `grands-comptes`, dont le track lui est fermé', async ({
		request,
	}) => {
		// D'abord constater, avec la clé de service, que la table N'EST PAS VIDE : sans cela, le
		// zéro ligne serait vrai que la RLS refuse ou qu'elle autorise tout (décision 50).
		const reel = await request.get(`${CARDS}?channel_id=eq.${CH_GRANDS_COMPTES}&select=id`, {
			headers: enTetesService(),
		})
		expect(((await reel.json()) as unknown[]).length).toBeGreaterThan(0)

		const vu = await request.get(`${CARDS}?channel_id=eq.${CH_GRANDS_COMPTES}&select=id`, {
			headers: enTetesAuthentifies(jetonViewer),
		})
		expect(vu.status()).toBe(200)
		expect(await vu.json()).toHaveLength(0)
	})

	test('o bis — …mais il voit celles des channels que rien ne lui ferme', async ({ request }) => {
		const vu = await request.get(`${CARDS}?channel_id=eq.${CH_REFONTE}&select=id`, {
			headers: enTetesAuthentifies(jetonViewer),
		})
		expect(vu.status()).toBe(200)
		expect(((await vu.json()) as unknown[]).length).toBeGreaterThan(0)
	})

	test('p — l’admin voit tout : un administrateur n’est jamais restreint', async ({ request }) => {
		const vu = await request.get(`${CARDS}?${FILTRE_SEED}&select=id`, {
			headers: enTetesAuthentifies(jetonAdmin),
		})
		expect(vu.status()).toBe(200)
		expect(await vu.json()).toHaveLength(15)
	})

	test('q — PREUVE N° 11 : un anonyme lit zéro ligne, sans erreur', async ({ request }) => {
		const vu = await request.get(`${CARDS}?select=id`, { headers: enTetesAnonymes() })
		expect(vu.status()).toBe(200)
		expect(await vu.json()).toHaveLength(0)
	})
})

test.describe('C6 — mise à jour : lignes r et s du §8.1', () => {
	test('r — le refus du `USING` ne lève AUCUNE erreur, et se prouve en relisant la ligne', async ({
		request,
	}) => {
		const avant = await relire(request, CARD_MAINTENANCE)

		const reponse = await request.patch(`${CARDS}?id=eq.${CARD_MAINTENANCE}`, {
			headers: enTetesAuthentifies(jetonBizdev),
			data: { title: 'Titre imposé par un compte en lecture seule' },
		})
		// Ni 403 ni erreur : le `USING` FILTRE. Un test qui vérifierait l'absence d'erreur serait
		// vert que la politique tienne ou qu'elle ait été retirée (décision 106).
		expect([200, 204]).toContain(reponse.status())

		const apres = await relire(request, CARD_MAINTENANCE)
		expect(apres!.title).toBe(avant!.title)
	})

	test('s — déplacer une card VERS un channel interdit est refusé par le `WITH CHECK`', async ({
		request,
	}) => {
		const avant = await relire(request, CARD_GRANDS_COMPTES)

		const reponse = await request.patch(`${CARDS}?id=eq.${CARD_GRANDS_COMPTES}`, {
			headers: enTetesAuthentifies(jetonBizdev),
			data: { channel_id: CH_MAINTENANCE },
		})
		// Ici l'erreur EST levée : la règle appliquée à la ligne d'ARRIVÉE est une contrainte, non
		// un filtre — et c'est tout l'écart entre les deux clauses. MESURÉ par ailleurs : cette
		// règle vient du `WITH CHECK` **ou**, s'il est omis, du `USING` que PostgreSQL réutilise
		// (docs/SPEC-cards.md §6.1). La clause explicite ne change donc pas le comportement ; ce
		// scénario prouve la règle, pas la clause.
		expect(reponse.status()).toBe(403)
		expect(((await reponse.json()) as Erreur).code).toBe('42501')

		const apres = await relire(request, CARD_GRANDS_COMPTES)
		expect(apres!.channel_id).toBe(avant!.channel_id)
	})
})

test.describe('C7 — cycle de vie : lignes t à v du §8.1', () => {
	test('t et u — archivage et corbeille sont deux gestes distincts, tous deux réversibles', async ({
		request,
	}) => {
		const [card] = (await (
			await creer(request, jetonAdmin, corpsCard(CH_GRANDS_COMPTES))
		).json()) as Card[]

		const archive = await request.patch(`${CARDS}?id=eq.${card!.id}`, {
			headers: { ...enTetesAuthentifies(jetonAdmin), Prefer: 'return=representation' },
			data: { archived_at: '2026-05-01T10:00:00Z' },
		})
		expect(archive.status()).toBe(200)
		expect((await relire(request, card!.id))!.deleted_at).toBeNull()

		const corbeille = await request.patch(`${CARDS}?id=eq.${card!.id}`, {
			headers: { ...enTetesAuthentifies(jetonAdmin), Prefer: 'return=representation' },
			data: { deleted_at: '2026-05-02T10:00:00Z' },
		})
		expect(corbeille.status()).toBe(200)

		const apres = await relire(request, card!.id)
		expect(apres!.archived_at).not.toBeNull()
		expect(apres!.deleted_at).not.toBeNull()
	})

	test('v — `DELETE` est refusé : aucun privilège, aucune suppression physique', async ({
		request,
	}) => {
		const [card] = (await (
			await creer(request, jetonAdmin, corpsCard(CH_GRANDS_COMPTES))
		).json()) as Card[]

		const reponse = await request.delete(`${CARDS}?id=eq.${card!.id}`, {
			headers: enTetesAuthentifies(jetonAdmin),
		})
		expect(reponse.status()).toBe(403)
		expect(await relire(request, card!.id)).toBeDefined()
	})
})

test.describe('C8 — la garde d’archivage d’un nœud occupé : lignes w et x du §8.1 (INC-031)', () => {
	test('w — archiver un nœud qu’une card active occupe est refusé en 403 / node_occupied', async ({
		request,
	}) => {
		const noeuds = await request.get(`${CATALOGUE}?key=eq.relance&select=id`, {
			headers: enTetesService(),
		})
		const [noeud] = (await noeuds.json()) as { id: string }[]

		const reponse = await request.patch(`${CATALOGUE}?id=eq.${noeud!.id}`, {
			headers: enTetesAuthentifies(jetonAdmin),
			data: { archived_at: '2026-05-01T10:00:00Z' },
		})
		expect(reponse.status()).toBe(403)
		expect(((await reponse.json()) as Erreur).message).toContain('node_occupied')

		const apres = await request.get(`${CATALOGUE}?id=eq.${noeud!.id}&select=archived_at`, {
			headers: enTetesService(),
		})
		expect(((await apres.json()) as { archived_at: string | null }[])[0]!.archived_at).toBeNull()
	})

	test('x — un nœud dont les cards sont toutes archivées reste archivable', async ({ request }) => {
		// « Active » a une définition, et elle compte : sans elle, un nœud deviendrait inarchivable
		// dès qu'une card y serait passée un jour (docs/SPEC-cards.md §5).
		//
		// RÉVISÉ PAR `CRM-046` (décision 51). Le nœud `livre` ne portait que la card ARCHIVÉE du
		// seed ; l'unité y a posé `…0cd`, ACTIVE, pour que l'étape « Livré » cesse d'être une
		// colonne vide (docs/SPEC-seed.md §9.3). La propriété reste vraie et reste à prouver — le
		// seed ne la sert simplement plus toute faite, et le scénario construit l'état qu'il
		// éprouve, puis le rend.
		const seuleCard = await relire(request, CARD_ARCHIVEE)
		expect(seuleCard!.archived_at).not.toBeNull()

		const noeuds = await request.get(`${CATALOGUE}?key=eq.livre&select=id`, {
			headers: enTetesService(),
		})
		const [noeud] = (await noeuds.json()) as { id: string }[]

		// Préalable : la seule card ACTIVE de cette étape est archivée le temps du scénario.
		const misEnPlace = await request.patch(`${CARDS}?id=eq.${CARD_LIVREE}`, {
			headers: enTetesService(),
			data: { archived_at: '2026-05-01T09:00:00Z' },
		})
		expect([200, 204]).toContain(misEnPlace.status())

		try {
			const restantes = await request.get(
				`${CARDS}?select=id&current_step_id=eq.${ETAPE_LIVRE}&archived_at=is.null&deleted_at=is.null`,
				{ headers: enTetesService() },
			)
			expect(
				((await restantes.json()) as { id: string }[]).length,
				'préalable posé : plus aucune card ACTIVE sur `livre`',
			).toBe(0)

			const reponse = await request.patch(`${CATALOGUE}?id=eq.${noeud!.id}`, {
				headers: enTetesAuthentifies(jetonAdmin),
				data: { archived_at: '2026-05-01T10:00:00Z' },
			})
			expect(reponse.status(), await reponse.text()).toBe(204)
		} finally {
			// Remis dans son état de contrat : le seed déclare ce nœud actif et cette card active.
			const restauration = await request.patch(`${CATALOGUE}?id=eq.${noeud!.id}`, {
				headers: enTetesService(),
				data: { archived_at: null },
			})
			expect([200, 204]).toContain(restauration.status())

			const rendue = await request.patch(`${CARDS}?id=eq.${CARD_LIVREE}`, {
				headers: enTetesService(),
				data: { archived_at: null },
			})
			expect([200, 204]).toContain(rendue.status())
		}
	})
})
