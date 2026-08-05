// @verifies CRM-034 (docs/BACKLOG.md) — `move_card`, garde centrale, hors interface
// @verifies docs/SPEC-workflow-engine.md §5.8 (contrat d'API, lignes a à m), §5.2 (valeur de
//           retour), §5.3 (les six vérifications), §5.4 (effets), §5.5 (protection de colonne),
//           §5.6 (privilèges), §5.7 (la n° 6 non livrable), §5.9 (seed exercé)
// @verifies docs/SPEC-permissions-rls.md §7 (preuves de refus n° 1 et n° 5)
// @verifies docs/SPEC-cards.md §2.6 (portée de `position`), §2.9 (`entered_step_at`), §5 (« active »)
// @verifies docs/SPEC-seed.md §2.11 (droits fins), docs/SPEC-test-harness.md §4.3 (projet `api`)
// @verifies docs/INCONSISTENCY_REPORT.md INC-021 (aucun écran), INC-026 (le `hint` de PostgREST),
//           INC-047 (vérification n° 6, **close par `CRM-036`**), INC-048 (commentaire non
//           conservé), INC-050, INC-051
// @verifies CLAUDE.md §10 (toute règle se prouve hors interface, avec le jeton réel)
//
// Ces scénarios exercent la garde **sans passer par l'interface**, avec les jetons réels des trois
// profils seedés obtenus par la véritable route de connexion. Aucun navigateur n'est lancé — et
// pour cause : cette unité ne livre aucun écran, le board étant `CRM-041` (INC-021).
//
// Ils reprennent une à une les treize lignes du tableau de `docs/SPEC-workflow-engine.md` §5.8,
// écrit **avant** le code pour être mesuré et non supposé.
//
// TROIS RÈGLES DE PROBANTE, héritées des unités précédentes et toutes actives ici :
//
//   * **chaque refus RELIT la ligne** et la constate inchangée. Une réponse d'erreur ne prouve pas
//     qu'aucune écriture n'a eu lieu — la fonction pourrait avoir écrit puis échoué plus loin, et
//     une garde qui laisserait une trace derrière un refus serait pire qu'aucune garde ;
//   * **l'état de départ est d'abord constaté**, avec la clé de service, qui ne sert JAMAIS à
//     prouver un refus (décision 50). Une assertion d'arrivée n'a de valeur que si le départ diffère ;
//   * **chaque scénario qui déplace remet la card où elle était**, par la clé de service et par
//     identifiant — jamais par prédicat métier (décision 108). Sans quoi le seed serait durablement
//     faux pour les scénarios suivants, et l'ordre d'exécution deviendrait significatif.

import { expect, test, type APIRequestContext } from '@playwright/test'
import { enTetesAnonymes, enTetesAuthentifies, enTetesService, jetonDe } from './jetons'

/** Le workflow global du seed et ses étapes (`docs/SPEC-seed.md` §2). */
const ETAPE_PROSPECT = '5eed0000-0000-4000-8000-000000000061'
const ETAPE_RELANCE = '5eed0000-0000-4000-8000-000000000062'
const ETAPE_NEGOCIATION = '5eed0000-0000-4000-8000-000000000063'
const ETAPE_REALISATION = '5eed0000-0000-4000-8000-000000000065'
const ETAPE_PERDU = '5eed0000-0000-4000-8000-000000000067'

/**
 * Les cards du seed employées ici (`docs/SPEC-cards.md` §9), avec ce que les droits fins en font.
 *
 * MESURÉ, et c'est ce qui rend les lignes h et i probantes : le `viewer` porte un `none` sur le
 * track de `grands-comptes` et n'y voit AUCUNE card, tandis qu'il voit celles de
 * `inter-entreprises` sans pouvoir les écrire. Le MÊME profil exerce donc les deux refus.
 */
const CARD_C1 = '5eed0000-0000-4000-8000-0000000000c1' // grands-comptes, étape 62
const CARD_C2 = '5eed0000-0000-4000-8000-0000000000c2' // grands-comptes, étape 62
const CARD_C3 = '5eed0000-0000-4000-8000-0000000000c3' // grands-comptes, étape 61
const CARD_C5 = '5eed0000-0000-4000-8000-0000000000c5' // maintenance : bizdev rétrogradé en lecture
const CARD_C6 = '5eed0000-0000-4000-8000-0000000000c6' // inter-entreprises, étape 61
const CARD_ARCHIVEE = '5eed0000-0000-4000-8000-0000000000c8'
const CARD_CORBEILLE = '5eed0000-0000-4000-8000-0000000000c9'
const CARD_INCONNUE = '5eed0000-0000-4000-8000-0000000000ff'
const ETAPE_INCONNUE = '5eed0000-0000-4000-8000-0000000000ee'

const CARDS = '/rest/v1/cards'
const RPC = '/rest/v1/rpc/move_card'

type Card = {
	id: string
	channel_id: string
	workflow_id: string
	current_step_id: string
	position: string | number
	entered_step_at: string
	title: string
	amount: string | null
	owner_id: string | null
}
type Erreur = { code: string; message: string; hint: string | null; details: string | null }

let jetonAdmin: string
let jetonBizdev: string
let jetonViewer: string

test.beforeAll(async () => {
	jetonAdmin = await jetonDe('admin@p2enjoy.test')
	jetonBizdev = await jetonDe('bizdev@p2enjoy.test')
	jetonViewer = await jetonDe('viewer@p2enjoy.test')
})

/** Lit une card avec la clé de service : sert à CONSTATER un état, jamais à prouver un refus. */
async function lire(requete: APIRequestContext, id: string): Promise<Card> {
	const reponse = await requete.get(`${CARDS}?id=eq.${id}&select=*`, { headers: enTetesService() })
	expect(reponse.status()).toBe(200)
	const lignes = (await reponse.json()) as Card[]
	const [card] = lignes
	expect(card, `la card ${id} doit exister — le seed est-il appliqué ?`).toBeDefined()
	return card as Card
}

/**
 * Remet une card à l'étape et à la position données, par la clé de service et par identifiant.
 *
 * `entered_step_at` n'est PAS restaurée, et ne peut pas l'être : `CRM-034` a fermé cette colonne à
 * `authenticated` comme à toute écriture directe autre que celle de la garde. La clé de service la
 * franchit, mais la restaurer supposerait de connaître sa valeur d'origine à la microseconde. Les
 * scénarios qui la mesurent le font donc par comparaison avec l'instant de l'appel, jamais avec une
 * valeur absolue.
 */
async function remettre(
	requete: APIRequestContext,
	id: string,
	etape: string,
	position: string | number,
): Promise<void> {
	const reponse = await requete.patch(`${CARDS}?id=eq.${id}`, {
		headers: { ...enTetesService(), 'Content-Type': 'application/json' },
		data: { current_step_id: etape, position },
	})
	expect(reponse.status()).toBe(204)
}

/** Appelle `move_card` avec un jeton donné. */
async function deplacer(
	requete: APIRequestContext,
	jeton: string | null,
	corps: Record<string, unknown>,
) {
	return requete.post(RPC, {
		headers: {
			...(jeton === null ? enTetesAnonymes() : enTetesAuthentifies(jeton)),
			'Content-Type': 'application/json',
		},
		data: corps,
	})
}

/**
 * Constate qu'un refus n'a **rien écrit**.
 *
 * C'est la moitié de chaque preuve de refus : `expect(status).toBe(400)` seul serait vert sur une
 * garde qui écrirait d'abord et refuserait ensuite.
 */
async function constaterInchangee(
	requete: APIRequestContext,
	id: string,
	avant: Card,
): Promise<void> {
	const apres = await lire(requete, id)
	expect(apres.current_step_id, `${id} : l'étape doit être INCHANGÉE après un refus`).toBe(
		avant.current_step_id,
	)
	expect(String(apres.position)).toBe(String(avant.position))
	expect(apres.entered_step_at).toBe(avant.entered_step_at)
}

// =================================================================================================
// M0 — le seed est dans l'état que le §5.9 déclare
// =================================================================================================
// Sans ce préalable, tout ce qui suit serait vert sur une base vide.

test.describe('M0 — l’état de départ, constaté et non supposé', () => {
	test('les cards du seed sont aux étapes que docs/SPEC-cards.md §9 déclare', async ({
		request,
	}) => {
		expect((await lire(request, CARD_C3)).current_step_id).toBe(ETAPE_PROSPECT)
		expect((await lire(request, CARD_C1)).current_step_id).toBe(ETAPE_RELANCE)
		expect((await lire(request, CARD_C2)).current_step_id).toBe(ETAPE_RELANCE)
		expect((await lire(request, CARD_C6)).current_step_id).toBe(ETAPE_PROSPECT)
	})

	test('le graphe seedé fournit bien les arêtes que ces preuves empruntent', async ({
		request,
	}) => {
		const reponse = await request.get(
			'/rest/v1/workflow_transitions?select=from_step_id,to_step_id,require_comment',
			{ headers: enTetesService() },
		)
		expect(reponse.status()).toBe(200)
		const aretes = (await reponse.json()) as {
			from_step_id: string
			to_step_id: string
			require_comment: boolean
		}[]

		const arete = (de: string, vers: string) =>
			aretes.find((a) => a.from_step_id === de && a.to_step_id === vers)

		expect(arete(ETAPE_PROSPECT, ETAPE_RELANCE), '61 → 62 « Relancer » est déclarée').toBeDefined()
		expect(arete(ETAPE_PROSPECT, ETAPE_RELANCE)?.require_comment).toBe(false)
		expect(
			arete(ETAPE_PROSPECT, ETAPE_PERDU)?.require_comment,
			'61 → 67 « Marquer perdu » EXIGE un commentaire — c’est la donnée qui exerce la n° 5',
		).toBe(true)
		expect(
			arete(ETAPE_RELANCE, ETAPE_REALISATION),
			'62 → 65 n’est PAS déclarée : la paire non reliée qui exerce la n° 4',
		).toBeUndefined()
	})
})

// =================================================================================================
// M1 — ligne a : l'appelant anonyme
// =================================================================================================

test.describe('M1 — ligne a : l’appelant anonyme', () => {
	test('a) anonyme → 401, refus de PRIVILÈGE avant toute vérification', async ({ request }) => {
		const avant = await lire(request, CARD_C3)

		const reponse = await deplacer(request, null, {
			card_id: CARD_C3,
			to_step_id: ETAPE_RELANCE,
		})

		// MESURÉ : PostgREST traite l'absence de droit d'un appelant NON AUTHENTIFIÉ comme une
		// invitation à s'authentifier, et rend `401` là où un authentifié recevrait `403` (§5.6).
		expect(reponse.status()).toBe(401)
		const erreur = (await reponse.json()) as Erreur
		expect(erreur.code).toBe('42501')
		expect(erreur.message).toContain('permission denied for function move_card')

		await constaterInchangee(request, CARD_C3, avant)
	})
})

// =================================================================================================
// M2 — lignes b, c, d : le succès et ce qu'il écrit
// =================================================================================================

test.describe('M2 — lignes b à d : le succès et ses effets', () => {
	test('b) admin, transition déclarée sans exigence → 200 et la card à jour', async ({
		request,
	}) => {
		const avant = await lire(request, CARD_C3)
		expect(avant.current_step_id).toBe(ETAPE_PROSPECT)

		try {
			const reponse = await deplacer(request, jetonAdmin, {
				card_id: CARD_C3,
				to_step_id: ETAPE_RELANCE,
			})
			expect(reponse.status()).toBe(200)

			// §5.2 : une fonction rendant un type composite est rendue par PostgREST comme un OBJET
			// JSON unique, non comme un tableau. Le client n'a donc pas à relire — et cette
			// relecture, précisément, aurait pu être refusée par une politique entre-temps.
			const corps = await reponse.json()
			expect(Array.isArray(corps), 'un type composite est rendu comme un OBJET, pas un tableau').toBe(
				false,
			)
			const card = corps as Card
			expect(card.id).toBe(CARD_C3)
			expect(card.current_step_id).toBe(ETAPE_RELANCE)

			// La valeur rendue est bien celle de la base, et non un écho de la requête.
			expect((await lire(request, CARD_C3)).current_step_id).toBe(ETAPE_RELANCE)
		} finally {
			await remettre(request, CARD_C3, avant.current_step_id, avant.position)
		}
	})

	test('c) entered_step_at est postérieure à l’appel', async ({ request }) => {
		const avant = await lire(request, CARD_C3)
		// L'instant est pris côté base et non côté test : les horloges peuvent différer, et une
		// comparaison entre deux référentiels ne prouverait rien.
		const instantAppel = (await lire(request, CARD_C1)).entered_step_at

		try {
			const reponse = await deplacer(request, jetonAdmin, {
				card_id: CARD_C3,
				to_step_id: ETAPE_RELANCE,
			})
			expect(reponse.status()).toBe(200)

			const apres = await lire(request, CARD_C3)
			expect(
				new Date(apres.entered_step_at).getTime(),
				'`entered_step_at` doit avoir AVANCÉ — docs/SPEC-cards.md §2.9 la réserve à `move_card`',
			).toBeGreaterThan(new Date(avant.entered_step_at).getTime())
			expect(new Date(apres.entered_step_at).getTime()).toBeGreaterThan(
				new Date(instantAppel).getTime(),
			)
		} finally {
			await remettre(request, CARD_C3, avant.current_step_id, avant.position)
		}
	})

	test('d) position est recalculée en FIN de la colonne d’arrivée', async ({ request }) => {
		const avant = await lire(request, CARD_C3)

		// L'état de départ est constaté : la colonne d'arrivée contient DÉJÀ deux cards. Sur une
		// colonne vide, « en fin » et « au début » donneraient tous deux 1, et l'assertion serait
		// verte sans rien prouver.
		const c1 = await lire(request, CARD_C1)
		const c2 = await lire(request, CARD_C2)
		expect(c1.current_step_id).toBe(ETAPE_RELANCE)
		expect(c2.current_step_id).toBe(ETAPE_RELANCE)
		const rangMax = Math.max(Number(c1.position), Number(c2.position))
		expect(rangMax).toBe(2)

		try {
			const reponse = await deplacer(request, jetonAdmin, {
				card_id: CARD_C3,
				to_step_id: ETAPE_RELANCE,
			})
			expect(reponse.status()).toBe(200)

			const apres = await lire(request, CARD_C3)
			expect(
				Number(apres.position),
				'`position` ← fin de la colonne d’arrivée. Le trigger de `CRM-040` est un BEFORE ' +
					'INSERT : il ne voit pas les déplacements (§5.4)',
			).toBe(rangMax + 1)

			// Arriver en fin ne renumérote pas la colonne : l'ordre que l'utilisateur y avait mis
			// est préservé.
			expect(Number((await lire(request, CARD_C1)).position)).toBe(Number(c1.position))
			expect(Number((await lire(request, CARD_C2)).position)).toBe(Number(c2.position))
		} finally {
			await remettre(request, CARD_C3, avant.current_step_id, avant.position)
		}
	})

	test('le déplacement ne touche NI le titre, NI le montant, NI le responsable', async ({
		request,
	}) => {
		const avant = await lire(request, CARD_C3)

		try {
			expect(
				(await deplacer(request, jetonAdmin, { card_id: CARD_C3, to_step_id: ETAPE_RELANCE })).status(),
			).toBe(200)

			const apres = await lire(request, CARD_C3)
			expect(apres.title).toBe(avant.title)
			expect(apres.amount).toBe(avant.amount)
			expect(apres.owner_id).toBe(avant.owner_id)
			expect(apres.channel_id, 'changer de channel est `CRM-045`, une autre unité').toBe(
				avant.channel_id,
			)
		} finally {
			await remettre(request, CARD_C3, avant.current_step_id, avant.position)
		}
	})
})

// =================================================================================================
// M3 — lignes e, f, g : la vérification n° 1
// =================================================================================================

test.describe('M3 — lignes e à g : la card existe et elle est ACTIVE', () => {
	test('e) card_id inconnu → 400 card_not_found', async ({ request }) => {
		const reponse = await deplacer(request, jetonAdmin, {
			card_id: CARD_INCONNUE,
			to_step_id: ETAPE_RELANCE,
		})
		expect(reponse.status()).toBe(400)
		const erreur = (await reponse.json()) as Erreur
		expect(erreur.code).toBe('P0001')
		expect(erreur.message).toBe('card_not_found')
	})

	test('f) card ARCHIVÉE → 400 card_not_found, et rien n’est écrit', async ({ request }) => {
		const avant = await lire(request, CARD_ARCHIVEE)
		expect(avant.current_step_id, 'la card archivée du seed est à l’étape 66').toBeTruthy()

		const reponse = await deplacer(request, jetonAdmin, {
			card_id: CARD_ARCHIVEE,
			to_step_id: ETAPE_RELANCE,
		})
		expect(reponse.status()).toBe(400)
		expect(((await reponse.json()) as Erreur).message).toBe('card_not_found')

		// « Active » a la définition de docs/SPEC-cards.md §5 : une card rangée ne se déplace pas,
		// on la restaure d'abord. Elle est traitée comme ABSENTE, et non par un refus qui lui serait
		// propre — le client qui la voit dans ses archives sait déjà pourquoi.
		await constaterInchangee(request, CARD_ARCHIVEE, avant)
	})

	test('g) card en CORBEILLE → 400 card_not_found, et rien n’est écrit', async ({ request }) => {
		const avant = await lire(request, CARD_CORBEILLE)

		const reponse = await deplacer(request, jetonAdmin, {
			card_id: CARD_CORBEILLE,
			to_step_id: ETAPE_RELANCE,
		})
		expect(reponse.status()).toBe(400)
		expect(((await reponse.json()) as Erreur).message).toBe('card_not_found')

		await constaterInchangee(request, CARD_CORBEILLE, avant)
	})
})

// =================================================================================================
// M4 — lignes h et i : la vérification n° 2 et la règle de DISCRÉTION
// =================================================================================================
// Les deux lignes sont exercées par LE MÊME profil, et c'est ce qui les rend probantes : employer
// deux profils différents laisserait planer le doute que l'écart vienne du profil plutôt que de la
// règle.
//
// ÉCART MESURÉ AVEC LE §5.8 — INC-051. La ligne i du tableau nomme le `bizdev`. MESURÉ contre la
// pile réelle : le `bizdev` LIT les neuf cards du seed, aucun droit fin ne lui ferme de channel, et
// l'appel rend `200`. Aucune donnée seedée ne peut donc satisfaire cette ligne telle qu'écrite, et
// le §5.9 pose que le seed n'est PAS modifié. Le profil retenu est le `viewer`, à qui le seed ferme
// réellement le track de `grands-comptes`. La contradiction est consignée, non résolue en silence.

test.describe('M4 — lignes h et i : forbidden ou card_not_found, selon ce que l’appelant VOIT', () => {
	test('h) viewer, card qu’il VOIT → 403 forbidden — preuve de refus n° 1', async ({ request }) => {
		const avant = await lire(request, CARD_C6)

		const reponse = await deplacer(request, jetonViewer, {
			card_id: CARD_C6,
			to_step_id: ETAPE_RELANCE,
		})

		expect(reponse.status()).toBe(403)
		const erreur = (await reponse.json()) as Erreur
		expect(erreur.code).toBe('42501')
		expect(erreur.message).toBe('forbidden')

		await constaterInchangee(request, CARD_C6, avant)
	})

	test('i) viewer, card d’un channel FERMÉ par un droit fin → 400 card_not_found', async ({
		request,
	}) => {
		const avant = await lire(request, CARD_C1)

		const reponse = await deplacer(request, jetonViewer, {
			card_id: CARD_C1,
			to_step_id: ETAPE_NEGOCIATION,
		})

		// DISCRÉTION : répondre « interdit » confirmerait l'existence de la card à quelqu'un qui
		// n'a pas le droit de la connaître (§5.3, décision 82). L'écart avec la ligne h ne peut
		// venir que de la RÈGLE : c'est le même jeton, à la même seconde.
		expect(reponse.status()).toBe(400)
		const erreur = (await reponse.json()) as Erreur
		expect(erreur.code).toBe('P0001')
		expect(erreur.message).toBe('card_not_found')

		await constaterInchangee(request, CARD_C1, avant)
	})

	test('INC-051 : le bizdev, lui, LIT cette card — la ligne i ne peut pas le nommer', async ({
		request,
	}) => {
		// RÉVISÉ À `CRM-036` : la card employée est passée de `CARD_C1` à `CARD_C2`, et le motif est
		// nommé plutôt que tu. Les deux vivent dans `grands-comptes`, à la même étape, et le fait
		// mesuré est identique — aucun droit fin ne ferme ce channel au `bizdev`. Mais `CARD_C1`
		// porte `budget` VIDE par contrat de seed, et la sixième vérification la refuse désormais :
		// ce refus n'a rien à voir avec les droits fins, et le scénario aurait mesuré la mauvaise
		// règle. `CARD_C2` renseigne `budget` — seule la condition à prouver varie (décision 121).
		const avant = await lire(request, CARD_C2)

		try {
			// Ce scénario ne contourne pas la ligne i : il MESURE le fait qui la rend inapplicable au
			// `bizdev`, pour que la correction du §5.8 repose sur une preuve rejouable et non sur une
			// affirmation. Il deviendra rouge si un droit fin venait à fermer ce channel au `bizdev`.
			const reponse = await deplacer(request, jetonBizdev, {
				card_id: CARD_C2,
				to_step_id: ETAPE_NEGOCIATION,
			})
			expect(
				reponse.status(),
				'le `bizdev` écrit sur `grands-comptes` : aucun droit fin ne le lui ferme',
			).toBe(200)
		} finally {
			await remettre(request, CARD_C2, avant.current_step_id, avant.position)
		}
	})

	test('le bizdev rétrogradé en lecture par un droit fin de CHANNEL → 403 forbidden', async ({
		request,
	}) => {
		const avant = await lire(request, CARD_C5)

		const reponse = await deplacer(request, jetonBizdev, {
			card_id: CARD_C5,
			to_step_id: ETAPE_RELANCE,
		})

		// L'autre chemin vers `forbidden` : la garde consulte le droit EFFECTIF, pas le rôle de
		// workspace. Le `bizdev` écrit partout, sauf sur ce channel.
		expect(reponse.status()).toBe(403)
		expect(((await reponse.json()) as Erreur).message).toBe('forbidden')

		await constaterInchangee(request, CARD_C5, avant)
	})
})

// =================================================================================================
// M5 — lignes j, k, l : les vérifications n° 3, 4 et 5
// =================================================================================================

test.describe('M5 — lignes j à l : le graphe devient opposable', () => {
	test('j) étape d’un AUTRE workflow → 400 step_not_in_workflow', async ({ request }) => {
		const avant = await lire(request, CARD_C2)

		// L'étape est prise dans la copie de portée track créée par le seed via
		// `copy_workflow_to_track` (`CRM-032`) : une étape réelle, d'un workflow réel, qui n'est
		// simplement pas celui de la card.
		const reponse = await request.get(
			`/rest/v1/workflow_steps?workflow_id=neq.${avant.workflow_id}&select=id&limit=1`,
			{ headers: enTetesService() },
		)
		expect(reponse.status()).toBe(200)
		const etapes = (await reponse.json()) as { id: string }[]
		const [etapeAilleurs] = etapes
		expect(etapeAilleurs, 'le seed doit porter une copie de workflow — `CRM-032`').toBeDefined()

		const refus = await deplacer(request, jetonAdmin, {
			card_id: CARD_C2,
			to_step_id: (etapeAilleurs as { id: string }).id,
		})
		expect(refus.status()).toBe(400)
		const erreur = (await refus.json()) as Erreur
		expect(erreur.code).toBe('P0001')
		expect(
			erreur.message,
			'un message de PRODUIT, là où la clé composite de `CRM-040` rendait un `23503` brut',
		).toBe('step_not_in_workflow')

		await constaterInchangee(request, CARD_C2, avant)
	})

	test('j’) étape INEXISTANTE → le même message, car distinguer serait divulguer', async ({
		request,
	}) => {
		const avant = await lire(request, CARD_C2)

		const reponse = await deplacer(request, jetonAdmin, {
			card_id: CARD_C2,
			to_step_id: ETAPE_INCONNUE,
		})
		expect(reponse.status()).toBe(400)
		expect(((await reponse.json()) as Erreur).message).toBe('step_not_in_workflow')

		await constaterInchangee(request, CARD_C2, avant)
	})

	test('k) étape du BON workflow, aucune transition déclarée → 400 transition_not_allowed', async ({
		request,
	}) => {
		const avant = await lire(request, CARD_C2)
		expect(avant.current_step_id).toBe(ETAPE_RELANCE)

		const reponse = await deplacer(request, jetonAdmin, {
			card_id: CARD_C2,
			to_step_id: ETAPE_REALISATION,
		})

		// L'ORDRE des n° 3 et n° 4 est prouvé ici : l'étape 65 appartient bien au workflow de la
		// card. Si la n° 3 était évaluée après la n° 4, ce cas rendrait `step_not_in_workflow` et
		// enverrait le client chercher un workflow là où il manque une ARÊTE (§5.3).
		expect(reponse.status()).toBe(400)
		const erreur = (await reponse.json()) as Erreur
		expect(erreur.code).toBe('P0001')
		expect(erreur.message).toBe('transition_not_allowed')

		await constaterInchangee(request, CARD_C2, avant)
	})

	test('k’) le graphe est ORIENTÉ : 62 → 61 est refusée là où 61 → 62 passe', async ({
		request,
	}) => {
		const avant = await lire(request, CARD_C1)

		const reponse = await deplacer(request, jetonAdmin, {
			card_id: CARD_C1,
			to_step_id: ETAPE_PROSPECT,
		})
		expect(reponse.status()).toBe(400)
		expect(((await reponse.json()) as Erreur).message).toBe('transition_not_allowed')

		await constaterInchangee(request, CARD_C1, avant)
	})

	test('l) transition exigeant un commentaire, sans commentaire → 400 comment_required', async ({
		request,
	}) => {
		const avant = await lire(request, CARD_C6)

		const reponse = await deplacer(request, jetonAdmin, {
			card_id: CARD_C6,
			to_step_id: ETAPE_PERDU,
		})
		expect(reponse.status()).toBe(400)
		const erreur = (await reponse.json()) as Erreur
		expect(erreur.code).toBe('P0001')
		expect(erreur.message).toBe('comment_required')

		await constaterInchangee(request, CARD_C6, avant)
	})

	test('l’) un commentaire d’ESPACES est refusé comme l’absence', async ({ request }) => {
		const avant = await lire(request, CARD_C6)

		const reponse = await deplacer(request, jetonAdmin, {
			card_id: CARD_C6,
			to_step_id: ETAPE_PERDU,
			comment: '   ',
		})

		// Sans `nullif(btrim(…), '')`, la règle « la raison d’une affaire perdue est exigée » se
		// satisferait d’une barre d’espace (§5.3).
		expect(reponse.status()).toBe(400)
		expect(((await reponse.json()) as Erreur).message).toBe('comment_required')

		await constaterInchangee(request, CARD_C6, avant)
	})

	test('l’’) la MÊME transition passe avec un commentaire réel', async ({ request }) => {
		const avant = await lire(request, CARD_C6)

		try {
			const reponse = await deplacer(request, jetonAdmin, {
				card_id: CARD_C6,
				to_step_id: ETAPE_PERDU,
				comment: 'Budget reporté en 2027',
			})

			// Sans ce scénario, les deux précédents seraient verts sur une garde qui refuserait TOUT
			// passage en « perdu ».
			expect(reponse.status()).toBe(200)
			expect((await reponse.json()).current_step_id).toBe(ETAPE_PERDU)

			// INC-048 : le commentaire est EXIGÉ, CONTRÔLÉ, et conservé NULLE PART. `card_comments`
			// est le livrable de `CRM-043`. La perte est nommée ici plutôt que tue.
			const tables = await request.get('/rest/v1/card_comments?select=id&limit=1', {
				headers: enTetesService(),
			})
			expect(
				tables.status(),
				'INC-048 : `card_comments` n’existe pas — le motif fourni est PERDU. `CRM-043`',
			).toBe(404)
		} finally {
			await remettre(request, CARD_C6, avant.current_step_id, avant.position)
		}
	})
})

// =================================================================================================
// M6 — ligne m : la protection de colonne, preuve de refus n° 5
// =================================================================================================
// Sans elle, tout ce qui précède ne s'appliquerait qu'aux clients qui veulent bien passer par la
// fonction.

test.describe('M6 — ligne m : la garde n’est pas contournable', () => {
	test('m) PATCH direct de current_step_id → 403, 42501 — preuve de refus n° 5', async ({
		request,
	}) => {
		const avant = await lire(request, CARD_C3)

		const reponse = await request.patch(`${CARDS}?id=eq.${CARD_C3}`, {
			headers: { ...enTetesAuthentifies(jetonAdmin), 'Content-Type': 'application/json' },
			data: { current_step_id: ETAPE_PERDU },
		})

		expect(reponse.status()).toBe(403)
		const erreur = (await reponse.json()) as Erreur
		expect(erreur.code).toBe('42501')
		expect(erreur.message).toContain('permission denied for table cards')

		// INC-026, quatrième occurrence : le message de refus DIVULGUE la commande `GRANT` à
		// exécuter. C'est un comportement de PostgREST et non du produit ; il est constaté et non
		// masqué, pour que sa disparition ou son aggravation soit remarquée.
		expect(erreur.hint).toContain('GRANT UPDATE ON public.cards')

		await constaterInchangee(request, CARD_C3, avant)
	})

	test('m’) les colonnes OUVERTES le restent : un revoke trop large aurait tout cassé', async ({
		request,
	}) => {
		const avant = await lire(request, CARD_C3)

		try {
			const reponse = await request.patch(`${CARDS}?id=eq.${CARD_C3}`, {
				headers: { ...enTetesAuthentifies(jetonAdmin), 'Content-Type': 'application/json' },
				data: { description: 'sonde de non-régression CRM-034' },
			})
			expect(reponse.status()).toBe(204)
		} finally {
			await request.patch(`${CARDS}?id=eq.${CARD_C3}`, {
				headers: { ...enTetesService(), 'Content-Type': 'application/json' },
				data: { description: avant === null ? null : undefined },
			})
		}
	})

	test('m’’) entered_step_at est fermée elle aussi : elle n’appartient qu’à la garde', async ({
		request,
	}) => {
		const avant = await lire(request, CARD_C3)

		const reponse = await request.patch(`${CARDS}?id=eq.${CARD_C3}`, {
			headers: { ...enTetesAuthentifies(jetonAdmin), 'Content-Type': 'application/json' },
			data: { entered_step_at: '2020-01-01T00:00:00Z' },
		})

		// docs/SPEC-cards.md §2.9 la réserve NOMMÉMENT à `move_card`. Un client qui la réécrirait
		// fausserait toute mesure d'ancienneté à l'étape.
		expect(reponse.status()).toBe(403)
		await constaterInchangee(request, CARD_C3, avant)
	})
})

// =================================================================================================
// M7 — ce qui reste dû, constaté par l'API
// =================================================================================================

test.describe('M7 — INC-047 CLOSE : la vérification n° 6 est livrée par `CRM-036`', () => {
	// RETOURNÉ, NON RETIRÉ — mécanisme de la décision 51, neuvième occurrence. Ce scénario
	// constatait, jusqu'à `CRM-036`, qu'un déplacement vers une étape `required` RÉUSSISSAIT, et il
	// annonçait devoir devenir rouge le jour où `card_field_values` serait livrée. Il l'est devenu.
	//
	// Le détail des preuves de la n° 6 vit dans `e2e/api/valeurs-champs.spec.ts` ; ce qui reste ici
	// est ce que `CRM-034` avait promis de constater — et son inverse, désormais vrai.
	test('card_field_values existe, et un déplacement vers une étape `required` est REFUSÉ', async ({
		request,
	}) => {
		const table = await request.get('/rest/v1/card_field_values?select=card_id&limit=1', {
			headers: enTetesService(),
		})
		expect(table.status(), 'INC-047 : `card_field_values` est livrée par `CRM-036`').toBe(200)

		const regles = await request.get(
			// `field_id` et non `id` : la table a une clé PRIMAIRE COMPOSITE `(field_id, step_id)` et
			// ne porte aucune colonne `id` — MESURÉ, `42703` sinon (docs/SPEC-form-composer.md §2).
			`/rest/v1/form_field_rules?step_id=eq.${ETAPE_NEGOCIATION}&visibility=eq.required&select=field_id`,
			{ headers: enTetesService() },
		)
		expect(regles.status()).toBe(200)
		expect(
			((await regles.json()) as unknown[]).length,
			'l’étape 63 porte bien une règle `required` : sans elle, le scénario serait vert parce ' +
				'qu’il n’y a RIEN à vérifier, et non parce que la n° 6 refuse',
		).toBeGreaterThan(0)

		const avant = await lire(request, CARD_C1)
		try {
			const reponse = await deplacer(request, jetonAdmin, {
				card_id: CARD_C1,
				to_step_id: ETAPE_NEGOCIATION,
			})
			expect(
				reponse.status(),
				'INC-047 REFERMÉE : le déplacement vers une étape `required` est désormais REFUSÉ. ' +
					'`CRM-034` livrait CINQ vérifications sur six ; `CRM-036` a livré la sixième',
			).toBe(400)
			const erreur = (await reponse.json()) as Erreur
			expect(erreur.message).toBe('missing_required_fields')
			expect(
				erreur.details,
				'et le message « liste des clés manquantes », que la Definition of Done de `CRM-034` ' +
					'nommait sans pouvoir le livrer, existe : il voyage dans le `DETAIL` (décision 126)',
			).toBe('budget')
		} finally {
			await remettre(request, CARD_C1, avant.current_step_id, avant.position)
		}
	})

	test('aucun card_event n’est écrit : la trace du déplacement n’existe pas — CRM-044', async ({
		request,
	}) => {
		const table = await request.get('/rest/v1/card_events?select=id&limit=1', {
			headers: enTetesService(),
		})
		expect(table.status()).toBe(404)
	})
})
