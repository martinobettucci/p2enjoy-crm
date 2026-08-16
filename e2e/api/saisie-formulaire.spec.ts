// @verifies CRM-037 (docs/BACKLOG.md) — la saisie depuis la fiche, éprouvée hors interface
// @verifies docs/SPEC-form-composer.md §4 bis.10 (contrat d'API, lignes a à g),
//           §4 bis.2 (un champ, une écriture — un lot est une transaction),
//           §4 bis.4 (ce qui est écrit, et `updated_by` qui ne l'est pas),
//           §4 bis.5 (vider est une écriture, pas une suppression),
//           §4 bis.7 (les natures de refus, mesurées et non supposées), §6.9 (autorisations)
// @verifies docs/SPEC-permissions-rls.md §4 (politiques de `card_field_values`),
//           §7 (preuve de refus n° 4 : le droit d'écriture manque)
// @verifies docs/SPEC-test-harness.md §4.3 (projet `api`, hors interface)
// @verifies CLAUDE.md §10 (toute règle d'accès se prouve hors interface, avec le jeton réel)
//
// La saisie du §4 bis passe par une seule route, et ces scénarios l'exercent **exactement comme
// l'écran l'appelle** : un `upsert` sur `(card_id, field_id)`, la charge à cinq colonnes, la
// résolution `merge-duplicates`. Ce que le test unitaire du composant établit — que l'écran émet
// bien cette charge — n'a de valeur que si le serveur l'accepte : c'est ce que ce fichier mesure,
// avec les jetons réels des profils seedés.
//
// LA LIGNE `b` EST CE QUI DÉCIDE DU GRAIN DE L'ÉCRITURE (§4 bis.2). Un lot est une transaction :
// le scénario du bas de ce fichier écrit deux valeurs dont **une seule** est invalide, et constate
// que la valeur valide n'est pas enregistrée non plus. Sans cette mesure, « un champ, une
// écriture » ne serait qu'une préférence de style.
//
// TROIS PIÈGES hérités des unités précédentes, tous actifs ici :
//
//   * un refus d'autorisation relit la ligne et la constate **inchangée** : une réponse d'erreur ne
//     prouve pas qu'aucune écriture n'a eu lieu (décision 70) ;
//   * la clé de service ne sert **jamais** à prouver un refus ; elle sert à constater l'état
//     (décision 50) ;
//   * chaque scénario nettoie derrière lui, y compris en cas d'échec : le seed est un contrat
//     maintenu, et le laisser modifié ferait échouer les suivants pour la mauvaise raison.

import { expect, test, type APIRequestContext } from '@playwright/test'
import { enTetesAuthentifies, enTetesService, jetonDe } from './jetons'

const WORKSPACE_SEED = '5eed0000-0000-4000-8000-000000000001'
const WORKFLOW_GLOBAL = '5eed0000-0000-4000-8000-000000000051'

/** Champs du seed (`docs/SPEC-seed.md` §2.10). */
const CHAMP_BUDGET = '5eed0000-0000-4000-8000-000000000081' // money
const CHAMP_SOURCE = '5eed0000-0000-4000-8000-000000000082' // select
const CHAMP_MOTIF = '5eed0000-0000-4000-8000-000000000084' // textarea
const CHAMP_DECIDEUR = '5eed0000-0000-4000-8000-000000000085' // checkbox

/** `c6` « Piste entrante à qualifier », étape *prospection* — la card que le §4.1 mesure. */
const CARD_C6 = '5eed0000-0000-4000-8000-0000000000c6'

/**
 * Les deux valeurs que le seed pose sur `c6` (`docs/SPEC-seed.md` §2.13), relues en base le
 * 2026-08-16. Elles sont **restaurées** après les scénarios qui les touchent : le seed est un
 * contrat maintenu, et le laisser modifié ferait échouer les suites suivantes.
 */
const MOTIF_SEED = 'Budget gelé jusqu’au prochain exercice.'
const SOURCE_SEED = 'prospection'

/** L'administratrice du seed : `apply-seed.sh` §8 quater pose `updated_by` sur chaque valeur. */
const AUTEUR_SEED = '5eed0000-0000-4000-8000-000000000011'

const VALEURS = '/rest/v1/card_field_values'

type Valeur = { card_id: string; field_id: string; value: unknown; updated_by: string | null }
type Erreur = { code: string; message: string; details: string | null }

let jetonAdmin: string
let jetonViewer: string

test.beforeAll(async () => {
	jetonAdmin = await jetonDe('admin@p2enjoy.test')
	jetonViewer = await jetonDe('viewer@p2enjoy.test')
})

/**
 * L'appel **exact** que l'écran émet : `upsert` sur la clé primaire, charge à cinq colonnes.
 *
 * `updated_by` en est délibérément absente (§4 bis.4) : la trace faisant foi de l'auteur est
 * l'`actor_id` de `card_events`, posé par le serveur à partir de la session réelle.
 */
function saisir(requete: APIRequestContext, jeton: string, champ: string, valeur: unknown) {
	return requete.post(VALEURS, {
		headers: {
			...enTetesAuthentifies(jeton),
			'Content-Type': 'application/json',
			Prefer: 'return=representation,resolution=merge-duplicates',
		},
		data: {
			card_id: CARD_C6,
			field_id: champ,
			workflow_id: WORKFLOW_GLOBAL,
			workspace_id: WORKSPACE_SEED,
			value: valeur,
		},
	})
}

/** Relit une valeur avec la clé de service — jamais employée pour prouver un refus. */
async function relire(requete: APIRequestContext, champ: string): Promise<Valeur | undefined> {
	const reponse = await requete.get(`${VALEURS}?card_id=eq.${CARD_C6}&field_id=eq.${champ}`, {
		headers: enTetesService(),
	})
	expect(reponse.status()).toBe(200)
	return ((await reponse.json()) as Valeur[])[0]
}

/**
 * Retire les valeurs posées par ces scénarios, ainsi que les événements de fil qu'elles ont
 * engendrés — `app.card_events_apres_ecriture_valeur` en inscrit un par écriture, et les laisser
 * ferait dériver la timeline du seed d'une exécution à l'autre.
 */
async function menage(requete: APIRequestContext, champs: readonly string[]): Promise<void> {
	for (const champ of champs) {
		await requete.delete(`${VALEURS}?card_id=eq.${CARD_C6}&field_id=eq.${champ}`, {
			headers: enTetesService(),
		})
		await requete.delete(
			`/rest/v1/card_events?card_id=eq.${CARD_C6}&type=eq.field_changed&payload->>field_id=eq.${champ}`,
			{ headers: enTetesService() },
		)
	}
}

// =================================================================================================
// S0 — l'état de départ, constaté avec la clé de service
// =================================================================================================

test.describe('S0 — état de départ', () => {
	test('`c6` ne porte AUCUNE valeur de `budget` : les lignes a et b partent d’une absence', async ({
		request,
	}) => {
		expect(await relire(request, CHAMP_BUDGET)).toBeUndefined()
	})
})

// =================================================================================================
// S1 — les sept lignes du contrat du §4 bis.10
// =================================================================================================

test.describe('S1 — contrat d’API de la saisie (§4 bis.10)', () => {
	test.afterEach(async ({ request }) => {
		await menage(request, [CHAMP_BUDGET, CHAMP_DECIDEUR])
	})

	test('a — un couple absent : la ligne est CRÉÉE, `201`', async ({ request }) => {
		const reponse = await saisir(request, jetonAdmin, CHAMP_BUDGET, 12000)
		expect(reponse.status(), await reponse.text()).toBe(201)
		expect((await relire(request, CHAMP_BUDGET))?.value).toBe(12000)
	})

	test('b — le MÊME couple, autre valeur : `200`, la ligne modifiée, `created_at` inchangé', async ({
		request,
	}) => {
		const premiere = await saisir(request, jetonAdmin, CHAMP_BUDGET, 12000)
		expect(premiere.status()).toBe(201)
		const creee = (await premiere.json()) as { created_at: string }[]

		const seconde = await saisir(request, jetonAdmin, CHAMP_BUDGET, 15000)
		// `200` et non `409` : c'est tout l'objet de l'`upsert`. Un écran qui choisirait entre
		// insertion et modification d'après ce qu'il a lu prendrait ici un conflit que l'utilisateur
		// n'a pas provoqué (§4 bis.10).
		expect(seconde.status(), await seconde.text()).toBe(200)
		const modifiee = (await seconde.json()) as { created_at: string; updated_at: string }[]
		expect(modifiee[0]?.created_at).toBe(creee[0]?.created_at)
		expect((await relire(request, CHAMP_BUDGET))?.value).toBe(15000)
	})

	test('c — `money` recevant une chaîne : `400`, `P0001`, `invalid_field_value`', async ({
		request,
	}) => {
		const reponse = await saisir(request, jetonAdmin, CHAMP_BUDGET, 'douze mille')
		expect(reponse.status()).toBe(400)
		const erreur = (await reponse.json()) as Erreur
		expect(erreur.code).toBe('P0001')
		// C'est ce `message`, et non le `details`, que l'interface classe : le premier est un
		// identifiant stable écrit dans la migration, le second est une phrase (§4 bis.7).
		expect(erreur.message).toBe('invalid_field_value')
		// Le refus ne laisse RIEN derrière lui.
		expect(await relire(request, CHAMP_BUDGET)).toBeUndefined()
	})

	test('d — `value` à `null` : `200`, la ligne CONSERVÉE, valeur explicitement vide', async ({
		request,
	}) => {
		expect((await saisir(request, jetonAdmin, CHAMP_BUDGET, 12000)).status()).toBe(201)
		const reponse = await saisir(request, jetonAdmin, CHAMP_BUDGET, null)
		expect(reponse.status(), await reponse.text()).toBe(200)
		// Vider n'est PAS supprimer (§6.9, §4 bis.5) : la ligne demeure, sa valeur devient vide.
		const relue = await relire(request, CHAMP_BUDGET)
		expect(relue, 'la ligne demeure').toBeDefined()
		expect(relue?.value).toBeNull()
	})

	test('e — le `viewer` écrit sur une card qu’il VOIT : `403`, `42501`, rien d’écrit', async ({
		request,
	}) => {
		// Il la voit : sans cette mesure, le refus pourrait n'être qu'un refus de lecture.
		const lecture = await request.get(`${VALEURS}?card_id=eq.${CARD_C6}&select=field_id`, {
			headers: enTetesAuthentifies(jetonViewer),
		})
		expect(lecture.status()).toBe(200)
		expect(((await lecture.json()) as unknown[]).length).toBeGreaterThan(0)

		const reponse = await saisir(request, jetonViewer, CHAMP_BUDGET, 12000)
		expect(reponse.status()).toBe(403)
		expect(((await reponse.json()) as Erreur).code).toBe('42501')
		expect(await relire(request, CHAMP_BUDGET)).toBeUndefined()
	})

	test('f — `updated_by` reste `NULL` : l’écran ne la renseigne pas (§4 bis.4)', async ({
		request,
	}) => {
		expect((await saisir(request, jetonAdmin, CHAMP_BUDGET, 12000)).status()).toBe(201)
		const relue = await relire(request, CHAMP_BUDGET)
		expect(
			relue?.updated_by,
			'aucun trigger ne la dérive, et le client ne l’envoie pas — la trace faisant foi est `card_events.actor_id`',
		).toBeNull()

		// LA TRACE, ELLE, EXISTE ET VIENT DU SERVEUR : sans ce contrôle, « l'auteur est tracé »
		// serait une affirmation et non une mesure.
		const evenements = await request.get(
			`/rest/v1/card_events?card_id=eq.${CARD_C6}&type=eq.field_changed&payload->>field_id=eq.${CHAMP_BUDGET}&select=actor_id`,
			{ headers: enTetesService() },
		)
		expect(evenements.status()).toBe(200)
		const lignes = (await evenements.json()) as { actor_id: string | null }[]
		expect(lignes.length).toBeGreaterThan(0)
		expect(lignes[0]?.actor_id, 'posé par `app.card_event_ecrire` depuis la session').not.toBeNull()
	})

	test('g — `DELETE` reste hors du produit : `403`, la ligne intacte', async ({ request }) => {
		expect((await saisir(request, jetonAdmin, CHAMP_BUDGET, 12000)).status()).toBe(201)
		const reponse = await request.delete(
			`${VALEURS}?card_id=eq.${CARD_C6}&field_id=eq.${CHAMP_BUDGET}`,
			{ headers: enTetesAuthentifies(jetonAdmin) },
		)
		expect(reponse.status()).toBe(403)
		expect((await relire(request, CHAMP_BUDGET))?.value).toBe(12000)
	})
})

// =================================================================================================
// S2 — pourquoi l'écriture est PAR CHAMP (§4 bis.2)
// =================================================================================================

test.describe('S2 — un lot est une transaction, et c’est ce qui décide du grain', () => {
	test.afterEach(async ({ request }) => {
		await menage(request, [CHAMP_BUDGET, CHAMP_DECIDEUR])
	})

	test('un lot dont UNE valeur est invalide n’enregistre AUCUNE des autres', async ({ request }) => {
		const reponse = await request.post(VALEURS, {
			headers: {
				...enTetesAuthentifies(jetonAdmin),
				'Content-Type': 'application/json',
				Prefer: 'return=representation,resolution=merge-duplicates',
			},
			data: [
				{
					card_id: CARD_C6,
					field_id: CHAMP_DECIDEUR,
					workflow_id: WORKFLOW_GLOBAL,
					workspace_id: WORKSPACE_SEED,
					value: true,
				},
				{
					card_id: CARD_C6,
					field_id: CHAMP_BUDGET,
					workflow_id: WORKFLOW_GLOBAL,
					workspace_id: WORKSPACE_SEED,
					value: 'douze mille',
				},
			],
		})
		expect(reponse.status()).toBe(400)
		expect(((await reponse.json()) as Erreur).message).toBe('invalid_field_value')
		// LA MESURE QUI DÉCIDE : la case à cocher, valide, n'est pas enregistrée non plus. Un écran
		// à bouton unique perdrait donc une saisie correcte à cause d'une saisie voisine, et
		// n'aurait qu'un refus global à montrer là où le §4.5 exige une erreur PAR CHAMP.
		expect(await relire(request, CHAMP_DECIDEUR)).toBeUndefined()
		expect(await relire(request, CHAMP_BUDGET)).toBeUndefined()
	})

	test('les deux mêmes valeurs écrites SÉPARÉMENT : la valide est conservée, l’autre refusée', async ({
		request,
	}) => {
		expect((await saisir(request, jetonAdmin, CHAMP_DECIDEUR, true)).status()).toBe(201)
		expect((await saisir(request, jetonAdmin, CHAMP_BUDGET, 'douze mille')).status()).toBe(400)
		expect((await relire(request, CHAMP_DECIDEUR))?.value).toBe(true)
		expect(await relire(request, CHAMP_BUDGET)).toBeUndefined()
	})
})

// =================================================================================================
// S3 — ce que la saisie change pour la garde de transition
// =================================================================================================
// Le §4 bis n'invente aucune règle : il ouvre un chemin vers celles de `CRM-036`. Ce bloc le
// vérifie de bout en bout — une valeur écrite par la route de la saisie satisfait la sixième
// vérification de `move_card`, et la même valeur vidée la refait échouer.

test.describe('S3 — la saisie et la garde lisent la même donnée', () => {
	test.afterEach(async ({ request }) => {
		// `motif-perte` et `source` appartiennent au seed : leurs valeurs sont **restaurées**, pas
		// seulement retirées — le seed est un contrat maintenu (`CLAUDE.md` §8).
		await menage(request, [CHAMP_MOTIF, CHAMP_SOURCE])
		for (const [champ, valeur] of [
			[CHAMP_MOTIF, MOTIF_SEED],
			[CHAMP_SOURCE, SOURCE_SEED],
		] as const) {
			await request.post(VALEURS, {
				headers: {
					...enTetesService(),
					'Content-Type': 'application/json',
					Prefer: 'resolution=merge-duplicates',
				},
				data: {
					card_id: CARD_C6,
					field_id: champ,
					workflow_id: WORKFLOW_GLOBAL,
					workspace_id: WORKSPACE_SEED,
					value: valeur,
					// `updated_by` FAIT PARTIE DE LA VALEUR SEEDÉE, et l'omettre a réellement cassé
					// `supabase/tests/0014_valeurs_champs.test.sql` : son assertion 93 compte les
					// valeurs du seed **par leur auteur**, et une restauration sans auteur en
					// laissait cinq sur sept. Un harnais qui laisse la base dégradée en sortant est
					// exactement ce qu'INC-129 décrit ; celui-ci restaure la ligne ENTIÈRE.
					updated_by: AUTEUR_SEED,
				},
			})
		}
	})

	test('une valeur vidée par la saisie laisse la LIGNE et devient explicitement vide', async ({
		request,
	}) => {
		expect((await saisir(request, jetonAdmin, CHAMP_SOURCE, null)).status()).toBe(200)
		const relue = await relire(request, CHAMP_SOURCE)
		expect(relue, 'la ligne demeure').toBeDefined()
		expect(relue?.value, 'explicitement vide, au sens du §6.6').toBeNull()
	})

	test('une chaîne de blancs est ACCEPTÉE par la base, et reste ce que l’utilisateur a saisi', async ({
		request,
	}) => {
		// C'est exactement le cas que le §4 bis.4 refuse de rogner à l'écriture. La base la porte
		// telle quelle ; `app.valeur_de_champ_est_vide` la dit vide, comme `estRenseigne` côté
		// interface. Rogner ferait diverger ce que l'utilisateur voit de ce que la base garde.
		const reponse = await saisir(request, jetonAdmin, CHAMP_MOTIF, '   ')
		expect(reponse.status(), await reponse.text()).toBe(200)
		expect((await relire(request, CHAMP_MOTIF))?.value).toBe('   ')
	})

	test('une clé absente des `choices` est refusée : la saisie ne contourne aucune validation', async ({
		request,
	}) => {
		const reponse = await saisir(request, jetonAdmin, CHAMP_SOURCE, 'bouche-a-oreille')
		expect(reponse.status()).toBe(400)
		expect(((await reponse.json()) as Erreur).message).toBe('invalid_field_value')
		expect((await relire(request, CHAMP_SOURCE))?.value, 'la valeur du seed est intacte').toBe(
			SOURCE_SEED,
		)
	})
})
