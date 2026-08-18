// @verifies CRM-036 (docs/BACKLOG.md) — valeurs de formulaire et validation, hors interface
// @verifies CRM-060 tranche 3 (docs/BACKLOG.md) — résolution de `contact` et `user`, bloc V5
// @verifies docs/SPEC-contacts.md §9 (la règle, les cas a à j du §9.5, le seed laissé intact §9.6)
// @verifies docs/SPEC-form-composer.md §6.10 (contrat d'API, lignes a à r), §6.3 (clés composites),
//           §6.5 (ce que chaque type accepte), §6.6 (« renseigné »), §6.7 (la sixième
//           vérification), §6.9 (autorisations), §7.2 (preuves attendues)
// @verifies docs/SPEC-permissions-rls.md §3.7 (`app.can_write_card`), §4 (politiques),
//           §7 (preuves de refus n° 4 et n° 11)
// @verifies docs/SPEC-workflow-engine.md §5.3 (les six vérifications), §5.7 (la n° 6)
// @verifies docs/SPEC-seed.md §2.13 (valeurs du seed)
// @verifies docs/SPEC-test-harness.md §4.3 (projet `api`, hors interface)
// @verifies docs/INCONSISTENCY_REPORT.md INC-047 (**close**), INC-053 (**close** par CRM-060
//           tranche 3 : `user` et `contact` résolus — bloc V5), INC-054 (`value` nullable, mesuré)
// @verifies CLAUDE.md §10 (toute règle se prouve hors interface, avec le jeton réel)
//
// Ces scénarios exercent le backend **sans passer par l'interface**, avec les jetons réels des
// profils seedés obtenus par la véritable route de connexion. Aucun navigateur n'est lancé — et
// pour cause : cette unité ne livre aucun écran (INC-021).
//
// Ils reprennent une à une les dix-huit lignes du tableau de `docs/SPEC-form-composer.md` §6.10,
// écrit **avant** le code.
//
// TROIS PIÈGES, tous hérités des unités précédentes et tous encore actifs ici :
//
//   * une écriture refusée par la clause `USING` d'une politique ne produit **aucune erreur** :
//     PostgREST rend `200` ou `204` et ne modifie rien. Tout refus d'autorisation relit donc la
//     ligne et la constate **inchangée** (décision 70) ;
//   * un « zéro ligne » sur une table vide serait vrai que la RLS refuse ou qu'elle autorise tout.
//     La table est peuplée par le seed — vingt et une valeurs —, et l'état est d'abord constaté avec la
//     clé de service, qui ne sert **jamais** à prouver un refus (décision 50) ;
//   * chaque scénario qui écrit **nettoie derrière lui**, y compris en cas d'échec. Le seed est un
//     contrat maintenu : le laisser modifié ferait échouer les suivants pour la mauvaise raison.

import { expect, test, type APIRequestContext } from '@playwright/test'
import { enTetesAnonymes, enTetesAuthentifies, enTetesService, jetonDe } from './jetons'

const WORKSPACE_SEED = '5eed0000-0000-4000-8000-000000000001'
const WORKFLOW_GLOBAL = '5eed0000-0000-4000-8000-000000000051'
const NOM_COPIE_SEED = 'Cycle commercial — Conseil IA'

/** Étapes du workflow global (`docs/SPEC-seed.md` §2.8). */
const ETAPE_NEGOCIATION = '5eed0000-0000-4000-8000-000000000063'
const ETAPE_SIGNATURE = '5eed0000-0000-4000-8000-000000000064'
const ETAPE_REALISATION = '5eed0000-0000-4000-8000-000000000065'

/** Champs du seed (`docs/SPEC-seed.md` §2.10). */
const CHAMP_BUDGET = '5eed0000-0000-4000-8000-000000000081' // money
const CHAMP_SOURCE = '5eed0000-0000-4000-8000-000000000082' // select
const CHAMP_DATE = '5eed0000-0000-4000-8000-000000000083' // date
const CHAMP_MOTIF = '5eed0000-0000-4000-8000-000000000084' // textarea
const CHAMP_DECIDEUR = '5eed0000-0000-4000-8000-000000000085' // checkbox
const CHAMP_LIEN = '5eed0000-0000-4000-8000-000000000086' // url

/** Cards du seed (`docs/SPEC-cards.md` §9). */
const CARD_C1 = '5eed0000-0000-4000-8000-0000000000c1' // grands-comptes, relance, budget VIDE
const CARD_C2 = '5eed0000-0000-4000-8000-0000000000c2' // grands-comptes, relance, budget renseigné
const CARD_C4 = '5eed0000-0000-4000-8000-0000000000c4' // refonte, négociation
const CARD_C5 = '5eed0000-0000-4000-8000-0000000000c5' // maintenance, bizdev rétrogradé en lecture
const CARD_C6 = '5eed0000-0000-4000-8000-0000000000c6' // inter-entreprises, prospection
const CARD_C7 = '5eed0000-0000-4000-8000-0000000000c7' // inter-entreprises, signature

const VALEURS = '/rest/v1/card_field_values'

type Valeur = { card_id: string; field_id: string; value: unknown; updated_by: string | null }
type Erreur = { code: string; message: string; details: string | null }

let jetonAdmin: string
let jetonBizdev: string
let jetonViewer: string

test.beforeAll(async () => {
	jetonAdmin = await jetonDe('admin@p2enjoy.test')
	jetonBizdev = await jetonDe('bizdev@p2enjoy.test')
	jetonViewer = await jetonDe('viewer@p2enjoy.test')
})

/** Retire toute valeur posée par ces scénarios sur les cards de travail. */
async function menage(requete: APIRequestContext, card: string, champ: string): Promise<void> {
	await requete.delete(`${VALEURS}?card_id=eq.${card}&field_id=eq.${champ}`, {
		headers: enTetesService(),
	})
}

/** Écrit une valeur avec un jeton donné, et rend la réponse brute. */
function ecrire(
	requete: APIRequestContext,
	jeton: string,
	corps: Record<string, unknown>,
	prefer = 'return=representation,resolution=merge-duplicates',
) {
	return requete.post(VALEURS, {
		headers: { ...enTetesAuthentifies(jeton), 'Content-Type': 'application/json', Prefer: prefer },
		data: { workflow_id: WORKFLOW_GLOBAL, workspace_id: WORKSPACE_SEED, ...corps },
	})
}

/** Relit une valeur avec la clé de service — jamais employée pour prouver un refus. */
async function relire(
	requete: APIRequestContext,
	card: string,
	champ: string,
): Promise<Valeur | undefined> {
	const reponse = await requete.get(`${VALEURS}?card_id=eq.${card}&field_id=eq.${champ}`, {
		headers: enTetesService(),
	})
	expect(reponse.status()).toBe(200)
	return ((await reponse.json()) as Valeur[])[0]
}

function deplacer(
	requete: APIRequestContext,
	jeton: string,
	corps: Record<string, unknown>,
) {
	return requete.post('/rest/v1/rpc/move_card', {
		headers: { ...enTetesAuthentifies(jeton), 'Content-Type': 'application/json' },
		data: corps,
	})
}

// =================================================================================================
// V0 — l'état de départ, constaté avec la clé de service
// =================================================================================================
// Sans ce bloc, tous les « zéro ligne » qui suivent seraient vrais sur une table vide, que la RLS
// refuse ou qu'elle autorise tout (décision 50).

test.describe('V0 — état de départ', () => {
	// RÉVISÉ PAR `CRM-046`, puis `CRM-018`, puis la sous-tranche 4d de `CRM-060` : quatorze valeurs
	// devenues vingt et une, puis VINGT-TROIS — les deux réponses résolues de « Migration ERP
	// Sogexia », `contact-principal` et `referent-technique` (docs/SPEC-contacts.md §13.6). Le cas
	// éprouvé ici — `budget` de `c1` VIDE — est inchangé.
	test('le seed pose bien vingt-trois valeurs, et `budget` de `c1` est VIDE', async ({ request }) => {
		const reponse = await request.get(`${VALEURS}?select=card_id,field_id,value`, {
			headers: enTetesService(),
		})
		expect(reponse.status()).toBe(200)
		const valeurs = (await reponse.json()) as Valeur[]
		expect(valeurs.length, 'docs/SPEC-seed.md §2.13 et §9.6 ; docs/SPEC-contacts.md §13.6').toBe(23)

		const budgetC1 = valeurs.find((v) => v.card_id === CARD_C1 && v.field_id === CHAMP_BUDGET)
		expect(budgetC1, 'la LIGNE existe').toBeDefined()
		expect(
			budgetC1?.value,
			'et sa valeur est vide : c’est la donnée qui démontre en permanence qu’une ligne présente ' +
				'n’est PAS une valeur renseignée (§6.6)',
		).toBeNull()
	})
})

// =================================================================================================
// V1 — lignes a à c : lecture
// =================================================================================================

test.describe('V1 — lecture', () => {
	test('a) anonyme → 200 et [] : preuve de refus n° 11', async ({ request }) => {
		const reponse = await request.get(VALEURS, { headers: enTetesAnonymes() })
		expect(reponse.status(), 'le refus est ZÉRO LIGNE, jamais une erreur').toBe(200)
		expect((await reponse.json()) as unknown[]).toEqual([])
	})

	test('b) anonyme en écriture → refusé, et aucune ligne créée', async ({ request }) => {
		const reponse = await request.post(VALEURS, {
			headers: { ...enTetesAnonymes(), 'Content-Type': 'application/json' },
			data: {
				card_id: CARD_C6,
				field_id: CHAMP_LIEN,
				workflow_id: WORKFLOW_GLOBAL,
				workspace_id: WORKSPACE_SEED,
				value: 'https://intrus.test/x',
			},
		})
		expect(reponse.status()).toBeGreaterThanOrEqual(400)
		expect(await relire(request, CARD_C6, CHAMP_LIEN), 'aucune ligne créée').toBeUndefined()
	})

	test('c) `admin` lit les valeurs de son workspace', async ({ request }) => {
		const reponse = await request.get(VALEURS, { headers: enTetesAuthentifies(jetonAdmin) })
		expect(reponse.status()).toBe(200)
		expect(((await reponse.json()) as Valeur[]).length).toBe(23)
	})
})

// =================================================================================================
// V2 — lignes d à g : les droits, prouvés hors interface avec les jetons réels
// =================================================================================================

test.describe('V2 — autorisations', () => {
	test('e) le `viewer` LIT la valeur d’une card qu’il voit', async ({ request }) => {
		const reponse = await request.get(`${VALEURS}?card_id=eq.${CARD_C6}`, {
			headers: enTetesAuthentifies(jetonViewer),
		})
		expect(reponse.status()).toBe(200)
		expect(
			((await reponse.json()) as Valeur[]).length,
			'`inter-entreprises` lui est ouvert : sans ce succès, le refus de la ligne f ne prouverait ' +
				'rien — il pourrait venir d’un refus général',
		).toBeGreaterThan(0)
	})

	test('f) le `viewer` ne voit AUCUNE valeur d’un channel que le seed lui ferme — refus n° 4', async ({
		request,
	}) => {
		// Le seed ferme le track de `grands-comptes` au `viewer` par un droit fin `none`.
		const parService = await request.get(`${VALEURS}?card_id=eq.${CARD_C1}`, {
			headers: enTetesService(),
		})
		expect(
			((await parService.json()) as Valeur[]).length,
			'ÉTAT CONSTATÉ : la card `c1` porte bien des valeurs. Sans ce constat, le zéro ligne ' +
				'suivant serait vrai sur une absence de données',
		).toBeGreaterThan(0)

		const reponse = await request.get(`${VALEURS}?card_id=eq.${CARD_C1}`, {
			headers: enTetesAuthentifies(jetonViewer),
		})
		expect(reponse.status(), 'zéro ligne, jamais une erreur').toBe(200)
		expect((await reponse.json()) as unknown[]).toEqual([])
	})

	test('d) le `viewer` ne peut pas ÉCRIRE, même sur une card qu’il voit → 403', async ({
		request,
	}) => {
		const reponse = await ecrire(request, jetonViewer, {
			card_id: CARD_C6,
			field_id: CHAMP_LIEN,
			value: 'https://viewer.test/x',
		})
		expect(reponse.status(), '`app.can_write_card` exige le droit d’ÉCRITURE sur le channel').toBe(
			403,
		)
		expect(await relire(request, CARD_C6, CHAMP_LIEN), 'aucune ligne créée').toBeUndefined()
	})

	test('g) le `bizdev` rétrogradé en lecture sur `maintenance` ne peut pas écrire → 403', async ({
		request,
	}) => {
		// Le seed pose `channel_members.access = 'viewer'` sur `maintenance` pour le bizdev : c’est
		// l’AUTRE chemin vers le refus — un droit fin de channel, là où la ligne d passe par le rôle
		// de workspace (décision 121).
		const lecture = await request.get(`${VALEURS}?card_id=eq.${CARD_C5}`, {
			headers: enTetesAuthentifies(jetonBizdev),
		})
		expect(lecture.status(), 'il LIT la card : la rétrogradation est bien locale et partielle').toBe(
			200,
		)

		const reponse = await ecrire(request, jetonBizdev, {
			card_id: CARD_C5,
			field_id: CHAMP_MOTIF,
			value: 'tentative',
		})
		expect(reponse.status()).toBe(403)
		expect(await relire(request, CARD_C5, CHAMP_MOTIF), 'aucune ligne créée').toBeUndefined()
	})
})

// =================================================================================================
// V3 — lignes h à p : la validation par type, mesurée contre PostgREST
// =================================================================================================
// Chaque refus est vérifié sur son CODE et son MESSAGE — un jeton stable — et le `DETAIL` est lu
// dans la clé `details`, comme la décision 126 l’a mesuré.

test.describe('V3 — validation par type', () => {
	test.afterEach(async ({ request }) => {
		await menage(request, CARD_C6, CHAMP_LIEN)
		await menage(request, CARD_C6, CHAMP_DECIDEUR)
		await menage(request, CARD_C6, CHAMP_DATE)
		await menage(request, CARD_C6, CHAMP_BUDGET)
	})

	test('h) une valeur conforme est acceptée → 201', async ({ request }) => {
		const reponse = await ecrire(request, jetonAdmin, {
			card_id: CARD_C6,
			field_id: CHAMP_LIEN,
			value: 'https://p2enjoy.fr/proposition',
		})
		expect(reponse.status(), await reponse.text()).toBe(201)
		expect((await relire(request, CARD_C6, CHAMP_LIEN))?.value).toBe(
			'https://p2enjoy.fr/proposition',
		)
	})

	test('i) `money` recevant une chaîne → 400 invalid_field_value', async ({ request }) => {
		const reponse = await ecrire(request, jetonAdmin, {
			card_id: CARD_C6,
			field_id: CHAMP_BUDGET,
			value: '45000',
		})
		expect(reponse.status(), 'MESURÉ : un refus levé depuis un trigger rend 400').toBe(400)
		const erreur = (await reponse.json()) as Erreur
		expect(erreur.message, 'le message est un JETON STABLE, comparable par égalité').toBe(
			'invalid_field_value',
		)
		expect(
			erreur.details,
			'la donnée variable voyage dans `details`, où PostgREST expose le DETAIL (décision 126)',
		).toContain('budget')
		expect(await relire(request, CARD_C6, CHAMP_BUDGET), 'aucune ligne créée').toBeUndefined()
	})

	test('j) `checkbox` recevant une chaîne → 400', async ({ request }) => {
		const reponse = await ecrire(request, jetonAdmin, {
			card_id: CARD_C6,
			field_id: CHAMP_DECIDEUR,
			value: 'oui',
		})
		expect(reponse.status()).toBe(400)
		expect(((await reponse.json()) as Erreur).message).toBe('invalid_field_value')
		expect(await relire(request, CARD_C6, CHAMP_DECIDEUR)).toBeUndefined()
	})

	test('k) `select` recevant une clé absente de `choices` → 400', async ({ request }) => {
		// Le point ouvert n° 4 du §8, clos par `CRM-036` : la base ne contraint toujours pas la forme
		// de `choices`, mais aucune card ne peut plus porter une réponse que son champ n’offre pas.
		const reponse = await ecrire(request, jetonAdmin, {
			card_id: CARD_C6,
			field_id: CHAMP_SOURCE,
			value: 'linkedin',
		})
		expect(reponse.status()).toBe(400)
		const erreur = (await reponse.json()) as Erreur
		expect(erreur.message).toBe('invalid_field_value')
		expect(erreur.details).toContain('linkedin')

		// `c6` porte déjà `source` par le seed : la relecture constate la valeur SEEDÉE, inchangée.
		expect(
			(await relire(request, CARD_C6, CHAMP_SOURCE))?.value,
			'la valeur seedée est inchangée : le refus n’a rien écrasé',
		).toBe('prospection')
	})

	test('l) `date` recevant une chaîne non convertible → 400', async ({ request }) => {
		const reponse = await ecrire(request, jetonAdmin, {
			card_id: CARD_C6,
			field_id: CHAMP_DATE,
			value: '31/12/2026',
		})
		expect(reponse.status()).toBe(400)
		const erreur = (await reponse.json()) as Erreur
		expect(erreur.message).toBe('invalid_field_value')
		expect(
			erreur.details,
			'le message est celui du PRODUIT, non « invalid input syntax for type date »',
		).toContain('ISO 8601')
		expect(await relire(request, CARD_C6, CHAMP_DATE)).toBeUndefined()
	})

	test('m) `url` recevant `javascript:` → 400', async ({ request }) => {
		const reponse = await ecrire(request, jetonAdmin, {
			card_id: CARD_C6,
			field_id: CHAMP_LIEN,
			value: 'javascript:alert(1)',
		})
		expect(reponse.status()).toBe(400)
		expect(((await reponse.json()) as Erreur).message).toBe('invalid_field_value')
		expect(await relire(request, CARD_C6, CHAMP_LIEN)).toBeUndefined()
	})

	test('n) `null` est accepté sur n’importe quel type → 201 — INC-054', async ({ request }) => {
		// MESURÉ : PostgREST convertit ce `null` JSON en SQL NULL, jamais en `'null'::jsonb`. C’est
		// la SEULE écriture d’API qui vide un champ, et c’est elle qui a imposé la nullabilité de la
		// colonne (décision 133).
		const reponse = await ecrire(request, jetonAdmin, {
			card_id: CARD_C6,
			field_id: CHAMP_BUDGET,
			value: null,
		})
		expect(reponse.status(), await reponse.text()).toBe(201)
		const ligne = await relire(request, CARD_C6, CHAMP_BUDGET)
		expect(ligne, 'la ligne existe').toBeDefined()
		expect(
			ligne?.value,
			'et sa valeur est vide : « vider un champ money » était IMPOSSIBLE avant INC-054',
		).toBeNull()
	})

	test('o) une valeur croisant card et champ de deux workflows → 400, 23503', async ({
		request,
	}) => {
		// L'identifiant de la fixture dérivée est lu par son contrat de seed. Une copie utilisateur
		// supplémentaire ne doit jamais rendre cette preuve dépendante de l'ordre des lignes.
		const copies = await request.get(
			`/rest/v1/workflows?derived_from_workflow_id=eq.${WORKFLOW_GLOBAL}&name=eq.${encodeURIComponent(NOM_COPIE_SEED)}&select=id`,
			{ headers: enTetesService() },
		)
		const copie = ((await copies.json()) as { id: string }[])[0]
		expect(copie, 'le seed pose bien une copie de portée track').toBeDefined()

		const reponse = await request.post(VALEURS, {
			headers: {
				...enTetesAuthentifies(jetonAdmin),
				'Content-Type': 'application/json',
			},
			data: {
				card_id: CARD_C6,
				field_id: CHAMP_LIEN,
				workflow_id: copie!.id,
				workspace_id: WORKSPACE_SEED,
				value: 'https://p2enjoy.fr/x',
			},
		})
		// MESURÉ, ET LE CONTRAT A ÉTÉ CORRIGÉ : `23503` rend **409**, non 400 — c'est la table du §4.4
		// de docs/SPEC-workflow-engine.md, qui range les violations de clé étrangère en conflit. La
		// ligne o du §6.10 annonçait 400 ; elle est corrigée dans le même changement, plutôt que le
		// test relâché.
		expect(reponse.status()).toBe(409)
		expect(
			((await reponse.json()) as Erreur).code,
			'la clé composite refuse : une valeur ne répond pas à la question d’un autre workflow',
		).toBe('23503')
		expect(await relire(request, CARD_C6, CHAMP_LIEN)).toBeUndefined()
	})

	test('p) la suppression d’une valeur est refusée — le refus est DOUBLE', async ({ request }) => {
		const avant = await relire(request, CARD_C6, CHAMP_SOURCE)
		expect(avant, 'ÉTAT DE DÉPART : la valeur seedée existe').toBeDefined()

		const reponse = await request.delete(
			`${VALEURS}?card_id=eq.${CARD_C6}&field_id=eq.${CHAMP_SOURCE}`,
			{ headers: enTetesAuthentifies(jetonAdmin) },
		)
		// Aucun privilège `DELETE`, aucune politique `for delete` : PostgREST rend un refus explicite.
		//
		// MESURÉ : **403**, non 401. Un rôle AUTHENTIFIÉ privé du privilège n'est pas un appelant sans
		// rôle — c'est exactement la correction que `CRM-035` avait dû faire sur la suppression d'un
		// champ (§2.8). La ligne p du §6.10 est corrigée dans le même changement.
		expect(reponse.status(), 'aucun privilège `DELETE` n’est accordé à `authenticated`').toBe(403)
		expect(
			(await relire(request, CARD_C6, CHAMP_SOURCE))?.value,
			'et la ligne est RELUE inchangée : une réponse d’erreur ne prouve pas qu’aucune écriture ' +
				'n’a eu lieu (décision 70)',
		).toBe('prospection')
	})
})

// =================================================================================================
// V4 — lignes q et r : la sixième vérification de `move_card`, par l'API — INC-047 CLOSE
// =================================================================================================
// Le scénario *M7* de `e2e/api/move-card.spec.ts`, écrit par `CRM-034` pour devenir rouge ce
// jour-là, l'est devenu et a été RETOURNÉ. Ce bloc-ci prouve la règle depuis son propre versant :
// le refus, sa liste de clés, et l'acceptation une fois la valeur renseignée.

test.describe('V4 — la sixième vérification', () => {
	test('q) une étape dont un champ `required` est vide → 400 missing_required_fields', async ({
		request,
	}) => {
		const avant = await relire(request, CARD_C1, CHAMP_BUDGET)
		expect(avant?.value, 'ÉTAT DE DÉPART : `budget` de `c1` est vide par contrat de seed').toBeNull()

		const reponse = await deplacer(request, jetonAdmin, {
			card_id: CARD_C1,
			to_step_id: ETAPE_NEGOCIATION,
		})
		expect(reponse.status(), 'MESURÉ : `P0001` rend 400').toBe(400)
		const erreur = (await reponse.json()) as Erreur
		expect(erreur.message, 'jeton stable, comme les cinq refus de `CRM-034`').toBe(
			'missing_required_fields',
		)
		expect(
			erreur.details,
			'la LISTE DES CLÉS MANQUANTES, que docs/SPEC-form-composer.md §6 exige depuis `CRM-000`',
		).toBe('budget')

		const card = await request.get(`/rest/v1/cards?id=eq.${CARD_C1}&select=current_step_id`, {
			headers: enTetesService(),
		})
		expect(
			((await card.json()) as { current_step_id: string }[])[0]?.current_step_id,
			'la card n’a PAS bougé : le refus est effectif, non cosmétique',
		).not.toBe(ETAPE_NEGOCIATION)
	})

	test('q bis) plusieurs clés manquantes → la liste est ordonnée par `position`', async ({
		request,
	}) => {
		const reponse = await deplacer(request, jetonAdmin, {
			card_id: CARD_C4,
			to_step_id: ETAPE_SIGNATURE,
		})
		expect(reponse.status()).toBe(400)
		expect(
			((await reponse.json()) as Erreur).details,
			'`budget` en est absent : il est renseigné. Les deux autres sont ordonnées par `position`',
		).toBe('date-signature-prevue, decideur-identifie')
	})

	test('q ter) l’UNION : la liaison de transition exige, l’étape cible n’exigeant rien', async ({
		request,
	}) => {
		const regles = await request.get(
			`/rest/v1/form_field_rules?step_id=eq.${ETAPE_REALISATION}&select=field_id`,
			{ headers: enTetesService() },
		)
		expect(
			((await regles.json()) as unknown[]).length,
			'ÉTAT CONSTATÉ : l’étape `réalisation` ne porte AUCUNE règle. Sans ce constat, le refus ' +
				'suivant pourrait venir de l’étape et non de la transition',
		).toBe(0)

		const reponse = await deplacer(request, jetonAdmin, {
			card_id: CARD_C7,
			to_step_id: ETAPE_REALISATION,
		})
		expect(reponse.status()).toBe(400)
		expect(
			((await reponse.json()) as Erreur).details,
			'le second membre de l’union de docs/SPEC-form-composer.md §3.5, porté par l’ARÊTE',
		).toBe('lien-proposition')
	})

	test('r) la valeur renseignée, la MÊME transition réussit → 200', async ({ request }) => {
		// Sans ce scénario, le précédent serait vert sur une garde qui refuserait TOUT.
		const pose = await ecrire(request, jetonAdmin, {
			card_id: CARD_C7,
			field_id: CHAMP_LIEN,
			value: 'https://p2enjoy.fr/formation-data-ia',
		})
		expect(pose.status(), await pose.text()).toBe(201)

		try {
			const reponse = await deplacer(request, jetonAdmin, {
				card_id: CARD_C7,
				to_step_id: ETAPE_REALISATION,
			})
			expect(reponse.status(), await reponse.text()).toBe(200)
			expect(
				((await reponse.json()) as { current_step_id: string }).current_step_id,
				'la card est bien passée : la règle DISCRIMINE, elle ne refuse pas tout',
			).toBe(ETAPE_REALISATION)
		} finally {
			// Le seed est un contrat maintenu : la card et la valeur sont remises en l’état.
			await request.patch(`/rest/v1/cards?id=eq.${CARD_C7}`, {
				headers: { ...enTetesService(), 'Content-Type': 'application/json' },
				data: { current_step_id: ETAPE_SIGNATURE, position: 2 },
			})
			await menage(request, CARD_C7, CHAMP_LIEN)
		}
	})

	test('un champ `hidden` à l’étape cible n’est PAS exigé, même vide', async ({ request }) => {
		// `motif-perte` est `hidden` en négociation et vide sur `c2`. La Definition of Done le nomme.
		const regle = await request.get(
			`/rest/v1/form_field_rules?step_id=eq.${ETAPE_NEGOCIATION}&field_id=eq.${CHAMP_MOTIF}&select=visibility`,
			{ headers: enTetesService() },
		)
		expect(
			((await regle.json()) as { visibility: string }[])[0]?.visibility,
			'ÉTAT CONSTATÉ : la règle est bien `hidden`',
		).toBe('hidden')
		expect(await relire(request, CARD_C2, CHAMP_MOTIF), 'et la valeur est absente').toBeUndefined()

		try {
			const reponse = await deplacer(request, jetonAdmin, {
				card_id: CARD_C2,
				to_step_id: ETAPE_NEGOCIATION,
			})
			expect(
				reponse.status(),
				'`hidden` n’est pas `required` : le champ n’entre pas dans l’ensemble exigé',
			).toBe(200)
		} finally {
			await request.patch(`/rest/v1/cards?id=eq.${CARD_C2}`, {
				headers: { ...enTetesService(), 'Content-Type': 'application/json' },
				data: { current_step_id: '5eed0000-0000-4000-8000-000000000062', position: 2 },
			})
		}
	})
})

// =================================================================================================
// V5 — la RÉSOLUTION des champs `contact` et `user` — CRM-060 tranche 3
// =================================================================================================
// @verifies CRM-060 tranche 3 (docs/BACKLOG.md), docs/SPEC-contacts.md §9 (la règle, les cas a à j
//           du §9.5), docs/SPEC-form-composer.md §6.5 (révisé), INC-053 (**close**)
//
// Ce bloc éprouve par la VRAIE ROUTE PostgREST ce que `supabase/tests/0045` éprouve en base : un
// champ `contact` n'accepte qu'un contact du workspace, un champ `user` qu'un membre du workspace.
// Les deux niveaux sont nécessaires et ne se remplacent pas — pgTAP dit ce que la base refuse, ce
// bloc dit ce qu'un CLIENT reçoit, et c'est le second que l'interface devra rendre (400,
// `invalid_field_value`, `details` exploitable).
//
// LES DEUX CHAMPS SONDES SONT CRÉÉS ICI, ET ILS LE RESTENT bien que le seed porte désormais
// `contact-principal` et `referent-technique` (docs/SPEC-contacts.md §13.6) : ce bloc écrit des
// valeurs refusées et acceptées à répétition, et le faire sur les deux champs seedés déplacerait des
// valeurs que la sous-tranche 4d éprouve à l'écran. Les sondes sont posées avec la clé de service et
// RETIRÉES dans le `afterAll`, y compris en cas d'échec — le seed est un contrat maintenu.

const CHAMP_SONDE_CONTACT = 'a5100000-0000-4000-8000-000000000001'
const CHAMP_SONDE_USER = 'a5100000-0000-4000-8000-000000000002'

/** Contacts et membres du seed — docs/SPEC-contacts.md §5, §9.5. */
const CONTACT_LEO = '5eed0000-0000-4000-8000-000000000091'
const MEMBRE_BIZDEV = '5eed0000-0000-4000-8000-000000000012'
const UUID_INEXISTANT = '00000000-0000-4000-8000-000000000000'

test.describe('V5 — résolution de `contact` et `user`', () => {
	test.beforeAll(async ({ request }) => {
		for (const [id, cle, type] of [
			[CHAMP_SONDE_CONTACT, 'sonde-contact-api', 'contact'],
			[CHAMP_SONDE_USER, 'sonde-user-api', 'user'],
		] as const) {
			const reponse = await request.post('/rest/v1/form_fields', {
				headers: {
					...enTetesService(),
					'Content-Type': 'application/json',
					Prefer: 'resolution=merge-duplicates',
				},
				data: {
					id,
					workflow_id: WORKFLOW_GLOBAL,
					workspace_id: WORKSPACE_SEED,
					key: cle,
					label: `Sonde ${type}`,
					type,
					options: {},
					position: 900,
				},
			})
			expect(reponse.status(), await reponse.text()).toBeLessThan(300)
		}
	})

	test.afterAll(async ({ request }) => {
		// Les valeurs partent avec le champ (cascade `(field_id, workflow_id)`), mais le ménage est
		// explicite : un `afterAll` qui suppose une cascade ne dit pas ce qu'il nettoie.
		for (const champ of [CHAMP_SONDE_CONTACT, CHAMP_SONDE_USER]) {
			await request.delete(`${VALEURS}?field_id=eq.${champ}`, { headers: enTetesService() })
			await request.delete(`/rest/v1/form_fields?id=eq.${champ}`, { headers: enTetesService() })
		}
	})

	test.afterEach(async ({ request }) => {
		await menage(request, CARD_C6, CHAMP_SONDE_CONTACT)
		await menage(request, CARD_C6, CHAMP_SONDE_USER)
	})

	test('CAS a) un contact du workspace est accepté → 201', async ({ request }) => {
		const reponse = await ecrire(request, jetonAdmin, {
			card_id: CARD_C6,
			field_id: CHAMP_SONDE_CONTACT,
			value: CONTACT_LEO,
		})
		expect(reponse.status(), await reponse.text()).toBe(201)
		expect((await relire(request, CARD_C6, CHAMP_SONDE_CONTACT))?.value).toBe(CONTACT_LEO)
	})

	test('CAS b) un uuid bien formé ne désignant aucun contact → 400', async ({ request }) => {
		const reponse = await ecrire(request, jetonAdmin, {
			card_id: CARD_C6,
			field_id: CHAMP_SONDE_CONTACT,
			value: UUID_INEXISTANT,
		})
		expect(
			reponse.status(),
			'AVANT la migration 0047, cette écriture rendait 201 : c’est le défaut qu’INC-053 portait',
		).toBe(400)
		const erreur = (await reponse.json()) as Erreur
		expect(erreur.message, 'le jeton reste stable').toBe('invalid_field_value')
		expect(
			erreur.details,
			'le DETAIL nomme la clé du champ et la raison, pour que l’interface sache quoi dire',
		).toContain('ne désigne aucun contact de ce workspace')
		expect(
			await relire(request, CARD_C6, CHAMP_SONDE_CONTACT),
			'et AUCUNE ligne n’a été créée — un refus se relit (décision 70)',
		).toBeUndefined()
	})

	test('CAS g) un membre du workspace est accepté sur un champ `user` → 201', async ({
		request,
	}) => {
		const reponse = await ecrire(request, jetonAdmin, {
			card_id: CARD_C6,
			field_id: CHAMP_SONDE_USER,
			value: MEMBRE_BIZDEV,
		})
		expect(reponse.status(), await reponse.text()).toBe(201)
		expect((await relire(request, CARD_C6, CHAMP_SONDE_USER))?.value).toBe(MEMBRE_BIZDEV)
	})

	test('CAS i) un uuid ne désignant aucun membre → 400', async ({ request }) => {
		const reponse = await ecrire(request, jetonAdmin, {
			card_id: CARD_C6,
			field_id: CHAMP_SONDE_USER,
			value: UUID_INEXISTANT,
		})
		expect(reponse.status()).toBe(400)
		const erreur = (await reponse.json()) as Erreur
		expect(erreur.message).toBe('invalid_field_value')
		expect(erreur.details).toContain('ne désigne aucun membre de ce workspace')
		expect(await relire(request, CARD_C6, CHAMP_SONDE_USER)).toBeUndefined()
	})

	test('CAS e) vider un champ `contact` reste possible → 201', async ({ request }) => {
		// Sans ce scénario, la résolution pourrait rendre un champ `contact` IMPOSSIBLE à vider :
		// c’est exactement le défaut qu’INC-054 avait produit sur `money` (décision 133).
		const reponse = await ecrire(request, jetonAdmin, {
			card_id: CARD_C6,
			field_id: CHAMP_SONDE_CONTACT,
			value: null,
		})
		expect(reponse.status(), await reponse.text()).toBe(201)
		expect(
			(await relire(request, CARD_C6, CHAMP_SONDE_CONTACT))?.value,
			'la ligne existe et son contenu est vide — « vidé explicitement » (§6.6)',
		).toBeNull()
	})

	test('CAS d) une chaîne qui n’est pas un uuid → 400, forme inchangée', async ({ request }) => {
		const reponse = await ecrire(request, jetonAdmin, {
			card_id: CARD_C6,
			field_id: CHAMP_SONDE_CONTACT,
			value: 'martin',
		})
		expect(reponse.status()).toBe(400)
		expect(((await reponse.json()) as Erreur).details).toContain('attend un identifiant')
	})
})
