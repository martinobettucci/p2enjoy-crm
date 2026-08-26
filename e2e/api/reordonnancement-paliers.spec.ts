// @verifies CRM-063 (docs/BACKLOG.md) — modèles d'emails, signatures, séquences de relance,
//           TRANCHE 4, SOUS-TRANCHE 4c : l'écran
// @verifies docs/SPEC-modeles-emails.md §13.10 (les dix lignes du contrat d'API de la RPC),
//           §13.2 (la mesure qui RÉVISE le §11.6 bis), §13.3 (les trois refus et les privilèges),
//           §11.6 bis (ce que la route ne sait PAS faire, et qui motive la RPC)
// @verifies docs/SPEC-permissions-rls.md §7 (le refus est ZÉRO LIGNE, jamais une erreur)
// @verifies CLAUDE.md §10 (toute règle d'accès se prouve hors interface, avec le jeton réel)
//
// LA QUESTION À LAQUELLE CE FICHIER RÉPOND. `supabase/tests/0060_reordonnancement_paliers.test.sql`
// prouve la règle EN BASE, sous des rôles endossés. Rien n'y garantit que la pile la rende par la
// vraie route : une fonction absente du cache de schéma rendrait `404 / PGRST205`, et un privilège
// mal posé rendrait `200` là où le contrat annonce `401` — la suite pgTAP resterait verte dans les
// deux cas.
//
// DEUX LIGNES NE SE PROUVENT QUE LÀ, et ce fichier existe d'abord pour elles :
//
//   * la ligne 1 — l'appel ANONYME. En base, `has_function_privilege` se lit ; par la route, il se
//     constate en essayant, et c'est `401` qu'il faut voir, non un `0` que l'écran lirait comme un
//     refus de politique (§13.3) ;
//   * la ligne 4 — la lectrice obtient `200` et **`0`**. C'est un SUCCÈS HTTP portant un refus
//     métier, la seule forme que PostgREST donne au zéro-ligne d'une RPC, et c'est exactement ce
//     que l'écran de 4c doit savoir distinguer d'un réordonnancement consenti.
//
// CE FICHIER ÉCRIT, ET IL REND LE SEED INTACT. Chaque réordonnancement est défait par le suivant,
// et le dernier scénario CONSTATE que les trois paliers du seed portent de nouveau les positions
// 1, 2 et 3. Une suite qui laisserait l'ordre inversé ferait rougir `verify-seed-demo.sh` et les
// preuves d'interface de la sous-tranche, pour une raison sans rapport avec leur objet.
//
// LA CONTRE-ÉPREUVE DU §11.6 bis EST REJOUÉE ICI, et ce n'est pas un doublon de
// `e2e/api/sequences-relance.spec.ts` ligne 15 : là-bas elle prouve que les détours d'un client
// sont fermés ; ici elle établit le MOTIF de la RPC, immédiatement avant de montrer que la RPC,
// elle, y parvient. Les deux mesures côte à côte sont ce qui rend la décision du §13.2 lisible.

import { expect, test, type APIRequestContext } from '@playwright/test'
import { enTetesAnonymes, enTetesAuthentifies, jetonDe } from './jetons'

const PALIERS = '/rest/v1/mail_sequence_steps'
const RPC_REORDONNER = '/rest/v1/rpc/reordonner_paliers_sequence'

/** « Relance en trois temps », la séquence de démonstration — `docs/SPEC-modeles-emails.md` §11.9. */
const SEQUENCE_SEED = '5e900000-0000-4000-8000-000000000001'

/**
 * Les trois paliers du seed, dans leur ordre nominal.
 *
 * Leurs identifiants SONT stables : le seed les pose littéralement (§11.9), contrairement aux
 * identités sortantes, créées par le vrai flux applicatif avec des `uuid` engendrés.
 */
const PALIER_1 = '5e900000-0000-4000-8000-0000000000a1'
const PALIER_2 = '5e900000-0000-4000-8000-0000000000a2'
const PALIER_3 = '5e900000-0000-4000-8000-0000000000a3'
const ORDRE_DU_SEED = [PALIER_1, PALIER_2, PALIER_3]

/** Une séquence qui n'existe pas — support de la ligne 9. */
const SEQUENCE_INCONNUE = '5e900000-0000-4000-8000-0000000000ff'

let jetonAdmin: string
let jetonBizdev: string
let jetonViewer: string

test.beforeAll(async () => {
	jetonAdmin = await jetonDe('admin@p2enjoy.test')
	jetonBizdev = await jetonDe('bizdev@p2enjoy.test')
	jetonViewer = await jetonDe('viewer@p2enjoy.test')
})

/**
 * L'ordre RÉEL des paliers, relu par la route.
 *
 * CHAQUE REFUS RELIT LES POSITIONS (décision 70), et c'est ici que cette relecture est écrite une
 * seule fois : un refus qui n'aurait pas relu ne dirait pas si la base est restée intacte, et un
 * `23514` levé APRÈS une écriture partielle serait indiscernable d'un `23514` levé avant.
 */
async function ordreReel(requete: APIRequestContext, jeton: string): Promise<string[]> {
	const reponse = await requete.get(
		`${PALIERS}?select=id,position&sequence_id=eq.${SEQUENCE_SEED}&order=position`,
		{ headers: enTetesAuthentifies(jeton) },
	)
	expect(reponse.status(), 'relecture des paliers').toBe(200)
	const lignes = (await reponse.json()) as { id: string; position: number }[]
	return lignes.map((ligne) => ligne.id)
}

/** Repose l'ordre nominal du seed. Employée par le nettoyage, jamais pour prouver quoi que ce soit. */
async function reposerOrdreDuSeed(requete: APIRequestContext): Promise<void> {
	await requete.post(RPC_REORDONNER, {
		headers: enTetesAuthentifies(jetonBizdev),
		data: { p_sequence_id: SEQUENCE_SEED, p_paliers: ORDRE_DU_SEED },
	})
}

test.afterAll(async ({ request }) => {
	// LE SEED EST REMIS EN ÉTAT QUOI QU'IL ARRIVE, y compris si un scénario a échoué au milieu
	// d'une permutation. C'est le `finally` d'`e2e/api/envoi.spec.ts`, transposé à un ordre plutôt
	// qu'à une ligne de file.
	await reposerOrdreDuSeed(request)
})

test.describe('CRM-063 4c — le contrat de `public.reordonner_paliers_sequence` (§13.10)', () => {
	test('ligne 0 — CONTRE-ÉPREUVE : la route ne sait pas échanger deux positions (§11.6 bis)', async ({
		request,
	}) => {
		// C'EST LE MOTIF DE LA RPC, ET IL EST MESURÉ ICI PLUTÔT QUE CITÉ. Un `PATCH` ne pose que
		// des valeurs littérales : poser sur le palier 1 la position du palier 2 heurte la
		// contrainte, qui est `initially immediate`.
		const reponse = await request.patch(`${PALIERS}?id=eq.${PALIER_1}`, {
			headers: { ...enTetesAuthentifies(jetonBizdev), 'Content-Type': 'application/json' },
			data: { position: 2 },
		})
		expect(reponse.status(), 'un PATCH créant un doublon de position').toBe(409)
		const corps = (await reponse.json()) as { code: string; message: string }
		expect(corps.code).toBe('23505')
		expect(corps.message).toContain('mail_sequence_steps_sequence_position_key')

		expect(await ordreReel(request, jetonBizdev), "l'ordre est resté celui du seed").toEqual(
			ORDRE_DU_SEED,
		)
	})

	test('ligne 1 — un appelant ANONYME est refusé par le PRIVILÈGE, jamais par un `0`', async ({
		request,
	}) => {
		const reponse = await request.post(RPC_REORDONNER, {
			headers: { ...enTetesAnonymes(), 'Content-Type': 'application/json' },
			data: { p_sequence_id: SEQUENCE_SEED, p_paliers: ORDRE_DU_SEED },
		})
		// `401` ET NON `403` : l'appelant n'est pas AUTHENTIFIÉ. C'est la distinction que le §12.11
		// ligne 12 a mesurée, et elle vaut ici sans changement.
		expect(reponse.status(), 'appel anonyme de la RPC').toBe(401)
		const corps = (await reponse.json()) as { code: string }
		expect(corps.code).toBe('42501')

		expect(await ordreReel(request, jetonBizdev), "l'ordre est inchangé").toEqual(ORDRE_DU_SEED)
	})

	test('lignes 2 et 3 — le développement commercial inverse l\'ordre, puis le repose', async ({
		request,
	}) => {
		const inverse = [PALIER_3, PALIER_2, PALIER_1]
		const aller = await request.post(RPC_REORDONNER, {
			headers: { ...enTetesAuthentifies(jetonBizdev), 'Content-Type': 'application/json' },
			data: { p_sequence_id: SEQUENCE_SEED, p_paliers: inverse },
		})
		expect(aller.status(), 'réordonnancement complet').toBe(200)
		// LE COMPTE DE RETOUR N'EST PAS LA PREUVE, IL EN EST LA MOITIÉ : une fonction qui rendrait
		// `3` sans rien déplacer serait verte ici. C'est la relecture qui décide.
		expect(await aller.json(), 'trois paliers repositionnés').toBe(3)
		expect(await ordreReel(request, jetonBizdev), "l'ordre relu est l'ordre envoyé").toEqual(
			inverse,
		)

		const retour = await request.post(RPC_REORDONNER, {
			headers: { ...enTetesAuthentifies(jetonBizdev), 'Content-Type': 'application/json' },
			data: { p_sequence_id: SEQUENCE_SEED, p_paliers: ORDRE_DU_SEED },
		})
		expect(retour.status(), 'retour à l’ordre du seed').toBe(200)
		expect(await retour.json()).toBe(3)
		expect(await ordreReel(request, jetonBizdev), 'le seed est rendu intact').toEqual(
			ORDRE_DU_SEED,
		)
	})

	test('ligne 4 — la lectrice obtient `200` et `0`, et les positions restent INCHANGÉES', async ({
		request,
	}) => {
		const reponse = await request.post(RPC_REORDONNER, {
			headers: { ...enTetesAuthentifies(jetonViewer), 'Content-Type': 'application/json' },
			data: { p_sequence_id: SEQUENCE_SEED, p_paliers: [PALIER_3, PALIER_2, PALIER_1] },
		})
		// UN SUCCÈS HTTP PORTANT UN REFUS MÉTIER. C'est la conséquence directe du `security
		// invoker` (§13.1 question 2) : la politique de la migration 59 ne consent pas, et l'écriture
		// n'atteint aucune ligne. Un `403` ici signifierait que la fonction est passée `definer` et
		// se défend elle-même — deux écritures de la même règle.
		expect(reponse.status(), 'appel de la lectrice').toBe(200)
		expect(await reponse.json(), 'zéro palier réordonné').toBe(0)

		expect(await ordreReel(request, jetonViewer), "l'ordre est intact").toEqual(ORDRE_DU_SEED)
	})

	test('ligne 5 — un tableau VIDE est refusé, et non rendu silencieusement à `0`', async ({
		request,
	}) => {
		const reponse = await request.post(RPC_REORDONNER, {
			headers: { ...enTetesAuthentifies(jetonAdmin), 'Content-Type': 'application/json' },
			data: { p_sequence_id: SEQUENCE_SEED, p_paliers: [] },
		})
		expect(reponse.status(), 'tableau vide').toBe(400)
		const corps = (await reponse.json()) as { code: string; message: string }
		expect(corps.code).toBe('23514')
		// LE REFUS EST NOMMÉ, ET C'EST CE QUI LE REND UTILISABLE PAR L'ÉCRAN : un `0` serait
		// indiscernable du refus de politique de la ligne 4, la seule issue que l'appelant ne doit
		// jamais confondre avec autre chose.
		expect(corps.message).toBe('paliers_requis')

		expect(await ordreReel(request, jetonAdmin)).toEqual(ORDRE_DU_SEED)
	})

	test('ligne 6 — un DOUBLON est refusé, alors qu\'aucune contrainte de la base ne le verrait', async ({
		request,
	}) => {
		const reponse = await request.post(RPC_REORDONNER, {
			headers: { ...enTetesAuthentifies(jetonAdmin), 'Content-Type': 'application/json' },
			data: { p_sequence_id: SEQUENCE_SEED, p_paliers: [PALIER_1, PALIER_1, PALIER_3] },
		})
		expect(reponse.status(), 'tableau portant deux fois le même palier').toBe(400)
		const corps = (await reponse.json()) as { code: string; message: string }
		expect(corps.code).toBe('23514')
		expect(corps.message).toBe('paliers_dupliques')

		expect(await ordreReel(request, jetonAdmin)).toEqual(ORDRE_DU_SEED)
	})

	test('ligne 7 — un ordre PARTIEL est refusé', async ({ request }) => {
		const reponse = await request.post(RPC_REORDONNER, {
			headers: { ...enTetesAuthentifies(jetonAdmin), 'Content-Type': 'application/json' },
			data: { p_sequence_id: SEQUENCE_SEED, p_paliers: [PALIER_1, PALIER_2] },
		})
		expect(reponse.status(), 'ordre ne nommant que deux paliers sur trois').toBe(400)
		const corps = (await reponse.json()) as { code: string; message: string }
		expect(corps.code).toBe('23514')
		expect(corps.message).toBe('paliers_incomplets')

		expect(await ordreReel(request, jetonAdmin)).toEqual(ORDRE_DU_SEED)
	})

	test('ligne 8 — un palier ÉTRANGER est refusé, bien que le cardinal soit juste', async ({
		request,
	}) => {
		// LE CARDINAL EST JUSTE — trois paliers pour trois —, et c'est ce qui rend ce scénario
		// distinct de la ligne 7 : une garde qui ne compterait que les éléments le laisserait
		// passer, et un palier du seed se retrouverait sans position.
		const reponse = await request.post(RPC_REORDONNER, {
			headers: { ...enTetesAuthentifies(jetonAdmin), 'Content-Type': 'application/json' },
			data: {
				p_sequence_id: SEQUENCE_SEED,
				p_paliers: [PALIER_1, PALIER_2, '5e900000-0000-4000-8000-0000000000af'],
			},
		})
		expect(reponse.status(), 'ordre portant un palier inconnu').toBe(400)
		const corps = (await reponse.json()) as { code: string; message: string }
		expect(corps.code).toBe('23514')
		expect(corps.message).toBe('paliers_incomplets')

		expect(await ordreReel(request, jetonAdmin)).toEqual(ORDRE_DU_SEED)
	})

	test('ligne 9 — une séquence INCONNUE rend le même refus, jamais une phrase qui la nomme', async ({
		request,
	}) => {
		const reponse = await request.post(RPC_REORDONNER, {
			headers: { ...enTetesAuthentifies(jetonAdmin), 'Content-Type': 'application/json' },
			data: { p_sequence_id: SEQUENCE_INCONNUE, p_paliers: [PALIER_1] },
		})
		expect(reponse.status(), 'séquence inconnue').toBe(400)
		const corps = (await reponse.json()) as { code: string; message: string }
		expect(corps.code).toBe('23514')
		// LE MÊME REFUS QUE L'ORDRE PARTIEL, ET C'EST DÉLIBÉRÉ (§13.3). Un message distinct dirait à
		// un appelant sans droit qu'une séquence existe — ou n'existe pas —, ce que la RLS cache.
		expect(corps.message).toBe('paliers_incomplets')

		expect(await ordreReel(request, jetonAdmin)).toEqual(ORDRE_DU_SEED)
	})

	test('ligne 10 — le seed est constaté INTACT en fin de suite', async ({ request }) => {
		const reponse = await request.get(
			`${PALIERS}?select=id,position,delai_jours&sequence_id=eq.${SEQUENCE_SEED}&order=position`,
			{ headers: enTetesAuthentifies(jetonAdmin) },
		)
		expect(reponse.status()).toBe(200)
		const lignes = (await reponse.json()) as {
			id: string
			position: number
			delai_jours: number
		}[]
		expect(lignes.map((l) => l.id), 'les trois paliers dans leur ordre nominal').toEqual(
			ORDRE_DU_SEED,
		)
		expect(lignes.map((l) => l.position), 'positions 1, 2, 3').toEqual([1, 2, 3])
		// LES DÉLAIS SONT CONSTATÉS AUSSI : la RPC ne touche QUE `position`, et une fonction qui
		// aurait réécrit une autre colonne serait verte sur l'ordre seul.
		expect(lignes.map((l) => l.delai_jours), 'délais 3, 7, 14 — inchangés').toEqual([3, 7, 14])
	})
})
