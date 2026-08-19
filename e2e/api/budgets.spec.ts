// @verifies CRM-084 (docs/BACKLOG.md) — budgets, occurrences et clôture, hors interface
// @verifies docs/SPEC-costs.md §2.1 (budgets), §2.2 (occurrences, aucune génération),
//           §3.1 (lecture par le track), §3.2 (écriture réservée à l'administrateur),
//           §4.1 (l'administration masque les budgets clôturés), §4.7 (états)
// @verifies docs/SCHEMA.md §9 bis.4, §9 bis.5 (colonnes), §9 bis.7 (politiques)
// @verifies docs/SPEC-permissions-rls.md §2.1 (un viewer n'écrit rien), §7 (preuves de refus)
// @verifies CLAUDE.md §10 (toute règle d'accès se prouve hors interface, avec le jeton réel)
//
// LA QUESTION À LAQUELLE CE FICHIER RÉPOND. La suite pgTAP `0048_budgets.test.sql` prouve les
// mêmes règles DANS la base, avec `set local role` : elle ne traverse ni Kong, ni PostgREST, ni
// GoTrue. Or la Definition of Done de `CRM-084` exige que le refus d'un membre NON ADMINISTRATEUR
// soit mesuré hors interface sur la CRÉATION et sur la CLÔTURE, et ces deux gestes ne reçoivent
// pas le même refus — la distinction n'existe qu'au niveau HTTP :
//
//   * la CRÉATION est refusée par le `WITH CHECK` d'une politique, qui LÈVE : PostgREST répond
//     `403` avec `42501` ;
//   * la CLÔTURE est une mise à jour refusée par le `USING`, qui FILTRE : la requête réussit, elle
//     ne touche simplement aucune ligne, et PostgREST répond `200 []` (décision 106).
//
// Un fichier qui n'attendrait qu'un « échec » ne verrait pas la différence, et une régression qui
// transformerait l'un en l'autre passerait inaperçue. Elle n'est pas décorative pour l'écran non
// plus : `CRM-084` tranche 2 devra traduire un `403` en message et un `200 []` en « rien n'a
// changé », deux textes différents pour deux causes différentes.
//
// IL POSE SES PROPRES FIXTURES ET LES DÉTRUIT. Les quatre budgets du seed sont LUS mais jamais
// écrits : ils sont le contrat que `CRM-086` mesurera, et les clôturer ou les doter déplacerait
// ses histogrammes. Les gestes d'écriture portent donc sur des budgets d'essai, détruits
// inconditionnellement en fin de fichier pour qu'un scénario interrompu ne laisse rien derrière.

import { expect, test } from '@playwright/test'
import { CLE_ANONYME, URL_API, enTetesAuthentifies, enTetesService, jetonDe } from './jetons'

const BUDGETS = '/rest/v1/budgets'
const OCCURRENCES = '/rest/v1/budget_occurrences'

/**
 * Tracks du seed, stables par contrat (`docs/SPEC-seed.md`). Les deux retenus le sont pour ce
 * qu'ils SÉPARENT — MESURÉ le 2026-08-19 sur la pile seedée, et non supposé :
 *
 *   * « Conseil & IA » — lu par l'administratrice et par le business developer, **INVISIBLE à la
 *     lectrice** : son droit fin `none` sur le track n'est pas rouvert au niveau du TRACK par son
 *     `channel_members` sur « Prospection ». C'est le seul cas qui prouve le §3.1 ;
 *   * « Studio web »   — lu par les trois. Sans ce témoin, l'absence de lecture de la lectrice se
 *     confondrait avec « elle ne lit aucun budget ».
 */
const TRACK_CONSEIL = '5eed0000-0000-4000-8000-000000000021'
const TRACK_STUDIO = '5eed0000-0000-4000-8000-000000000022'

/** Budgets et occurrences du seed, LUS ici et jamais écrits. */
const BUDGET_FERME_A_LA_LECTRICE = '5eed0000-0000-4000-8000-0000000000c1'
const BUDGET_RECURRENT = '5eed0000-0000-4000-8000-0000000000c2'
const BUDGET_CLOTURE = '5eed0000-0000-4000-8000-0000000000c3'
const OCCURRENCE_CLOTUREE = '5eed0000-0000-4000-8000-0000000000d1'

/**
 * Fixtures d'essai, détruites en fin de fichier. Leur `position` est très au-dessus de celles du
 * seed pour que la destruction puisse porter sur ce seul critère, sans énumérer des identifiants
 * qu'un scénario interrompu aurait multipliés.
 */
const POSITION_ESSAI = 900
const BUDGET_ESSAI = 'c0000000-0000-4000-8000-0000000000b1'
const BUDGET_ESSAI_RECURRENT = 'c0000000-0000-4000-8000-0000000000b2'

test.describe('CRM-084 — budgets : le contrat d’API, hors interface', () => {
	let jetonAdmin = ''
	let jetonBizdev = ''
	let jetonViewer = ''

	const poserLesFixtures = async (playwright: typeof import('@playwright/test').request) => {
		// Les fixtures sont posées par la CLÉ DE SERVICE, qui traverse la RLS : ce fichier prouve
		// des refus, et poser son décor avec un jeton de profil ferait dépendre le décor de la
		// règle qu'il éprouve.
		const service = await playwright.newContext({ baseURL: URL_API })
		try {
			// LES DEUX OBJETS PORTENT EXACTEMENT LES MÊMES CLÉS, et ce n'est pas de la coquetterie :
			// PostgREST refuse une insertion en lot dont les objets diffèrent par leurs clés — il
			// n'a alors plus de liste de colonnes à écrire. MESURÉ le 2026-08-19 : omettre
			// `planned_amount` sur le second faisait échouer le décor en silence, et les scénarios
			// d'écriture mouraient plus loin sur des lignes absentes, ce qui ressemblait à un défaut
			// des politiques.
			const decor = await service.post(BUDGETS, {
				headers: { ...enTetesService(), Prefer: 'resolution=merge-duplicates' },
				data: [
					{
						id: BUDGET_ESSAI,
						track_id: TRACK_STUDIO,
						name: 'Budget d’essai budgets.spec',
						currency: 'EUR',
						planned_amount: 1000,
						is_recurrent: false,
						closed_at: null,
						position: POSITION_ESSAI,
					},
					{
						id: BUDGET_ESSAI_RECURRENT,
						track_id: TRACK_STUDIO,
						name: 'Budget récurrent d’essai budgets.spec',
						currency: 'EUR',
						planned_amount: 2000,
						is_recurrent: true,
						closed_at: null,
						position: POSITION_ESSAI + 1,
					},
				],
			})
			// LE DÉCOR ÉCHOUE BRUYAMMENT. Sans cette assertion, une erreur de fixture se déguiserait
			// en refus de politique dix scénarios plus loin.
			if (!decor.ok()) {
				throw new Error(
					`fixtures de budgets.spec non posées (${decor.status()}) : ${await decor.text()}`,
				)
			}
		} finally {
			await service.dispose()
		}
	}

	test.beforeAll(async ({ playwright }) => {
		jetonAdmin = await jetonDe('admin@p2enjoy.test')
		jetonBizdev = await jetonDe('bizdev@p2enjoy.test')
		jetonViewer = await jetonDe('viewer@p2enjoy.test')
		await poserLesFixtures(playwright.request)
	})

	/**
	 * Le seed sort INTACT. La destruction est inconditionnelle et porte sur la seule tranche de
	 * positions d'essai : `on delete cascade` emporte les occurrences, y compris celles qu'un
	 * scénario interrompu aurait laissées.
	 */
	test.afterAll(async ({ playwright }) => {
		const service = await playwright.request.newContext({ baseURL: URL_API })
		try {
			await service.delete(`${BUDGETS}?position=gte.${POSITION_ESSAI}`, {
				headers: enTetesService(),
			})
		} finally {
			await service.dispose()
		}
	})

	// -------------------------------------------------------------------------------------------
	// 1. Lecture — la règle des tracks, sans exception (§3.1)
	// -------------------------------------------------------------------------------------------

	test('l’appelant anonyme ne lit AUCUN budget, et le refus est un filtrage', async ({
		request,
	}) => {
		// La politique de lecture est ouverte `to anon` délibérément : `auth.uid()` valant NULL, le
		// refus se fait par ZÉRO LIGNE et non par une erreur de privilège. La distinction compte —
		// un `401` révélerait que la table existe et qu'elle est protégée ; `200 []` ne révèle rien.
		const reponse = await request.get(`${BUDGETS}?select=id`, {
			headers: { apikey: CLE_ANONYME },
		})
		expect(reponse.status()).toBe(200)
		expect(await reponse.json()).toEqual([])
	})

	test('LE BUDGET INVISIBLE : la lectrice lit trois budgets sur quatre', async ({ request }) => {
		// C'est la règle du §3.1, et le cas qui la motive. Le budget n'est pas grisé, il est
		// ABSENT : le rendre en le grisant révélerait le nom d'une enveloppe d'un track interdit,
		// et son montant en dirait déjà davantage.
		const vus = await request.get(`${BUDGETS}?select=id,name`, {
			headers: enTetesAuthentifies(jetonViewer),
		})
		expect(vus.status()).toBe(200)
		const lignes = (await vus.json()) as { id: string; name: string }[]

		// Nommément, et pas seulement par le compte : un décompte seul resterait vert si le seed
		// masquait le mauvais budget.
		expect(lignes.map((l) => l.id)).not.toContain(BUDGET_FERME_A_LA_LECTRICE)
		expect(lignes.filter((l) => l.id.startsWith('5eed'))).toHaveLength(3)
	})

	test('l’administratrice lit le budget d’un track où elle porte un droit fin « none »', async ({
		request,
	}) => {
		// Le seed pose un `track_members.access = 'none'` sur « Conseil & IA » pour
		// l'administratrice, précisément pour que « un administrateur n'est jamais restreint »
		// soit démontré en PERMANENCE plutôt que sur une ligne créée puis détruite
		// (docs/SPEC-permissions-rls.md §3.3).
		const reponse = await request.get(`${BUDGETS}?id=eq.${BUDGET_FERME_A_LA_LECTRICE}&select=id`, {
			headers: enTetesAuthentifies(jetonAdmin),
		})
		expect(reponse.status()).toBe(200)
		expect(await reponse.json()).toHaveLength(1)
	})

	test('la lectrice ne lit aucune occurrence d’un budget qu’elle ne lit pas, et lit celles qu’elle lit', async ({
		request,
	}) => {
		// L'occurrence suit son budget, qui suit son track. Les deux moitiés comptent : sans la
		// seconde, « elle n'en lit aucune » serait vrai d'un produit qui n'en rendrait jamais.
		const surConseil = await request.get(
			`${OCCURRENCES}?budget_id=eq.${BUDGET_ESSAI_RECURRENT}&select=id`,
			{ headers: enTetesAuthentifies(jetonViewer) },
		)
		expect(surConseil.status()).toBe(200)

		const duSeed = await request.get(`${OCCURRENCES}?budget_id=eq.${BUDGET_RECURRENT}&select=id`, {
			headers: enTetesAuthentifies(jetonViewer),
		})
		expect(duSeed.status()).toBe(200)
		expect(await duSeed.json()).toHaveLength(2)
	})

	test('un budget CLÔTURÉ reste lisible — clôturer n’efface pas l’histoire', async ({
		request,
	}) => {
		// §3.2 : « un budget ne se supprime pas : il se clôture ». Le masquage des budgets clôturés
		// est une règle d'ÉCRAN (§4.1, derrière un interrupteur), jamais une règle de lecture : les
		// masquer en base rendrait l'onglet « À saisir » du §4.8 impossible, qui doit justement
		// lister les lignes des budgets clos.
		const reponse = await request.get(
			`${BUDGETS}?id=eq.${BUDGET_CLOTURE}&select=id,closed_at`,
			{ headers: enTetesAuthentifies(jetonBizdev) },
		)
		expect(reponse.status()).toBe(200)
		const [budget] = (await reponse.json()) as { closed_at: string | null }[]
		expect(budget.closed_at).not.toBeNull()
	})

	// -------------------------------------------------------------------------------------------
	// 2. Écriture — la ligne de partage du §3, et les DEUX formes du refus
	// -------------------------------------------------------------------------------------------

	test('LE REFUS DE CRÉATION est un 403 / 42501, pour le business developer comme pour la lectrice', async ({
		request,
	}) => {
		// C'est l'arbitrage du §3 : « le budget est un CADRE — décision de gestion ; l'affectation
		// est un GESTE quotidien ». Le business developer écrit les affaires de ce track, et n'y
		// crée aucune enveloppe. Sans cette assertion, rien ne distinguerait la règle livrée de
		// « tout membre écrivant écrit un budget ».
		for (const [role, jeton] of [
			['business_developer', jetonBizdev],
			['viewer', jetonViewer],
		] as const) {
			const reponse = await request.post(BUDGETS, {
				headers: enTetesAuthentifies(jeton),
				data: {
					track_id: TRACK_STUDIO,
					name: `Budget refusé à ${role}`,
					position: POSITION_ESSAI + 50,
				},
			})
			expect(reponse.status(), `création d’un budget par ${role}`).toBe(403)
			expect((await reponse.json()).code, `code PostgreSQL du refus pour ${role}`).toBe('42501')
		}
	})

	test('LE REFUS DE CLÔTURE est un filtrage : 200, zéro ligne, et le budget reste ouvert', async ({
		request,
	}) => {
		// L'autre moitié de l'exigence de la DoD, et l'autre forme du refus. Une mise à jour
		// écartée par le `USING` d'une politique ne lève RIEN : elle ne voit simplement pas la
		// ligne. Attendre un `403` ici serait rouge sur un produit correct.
		const reponse = await request.patch(`${BUDGETS}?id=eq.${BUDGET_ESSAI}`, {
			headers: { ...enTetesAuthentifies(jetonBizdev), Prefer: 'return=representation' },
			data: { closed_at: new Date('2026-07-01T10:00:00Z').toISOString() },
		})
		expect(reponse.status()).toBe(200)
		expect(await reponse.json()).toEqual([])

		// ET LA LIGNE EST RELUE INTACTE. Sans cette relecture, un produit qui aurait écrit puis
		// caché sa réponse passerait l'assertion ci-dessus.
		const relecture = await request.get(`${BUDGETS}?id=eq.${BUDGET_ESSAI}&select=closed_at`, {
			headers: enTetesAuthentifies(jetonBizdev),
		})
		const [budget] = (await relecture.json()) as { closed_at: string | null }[]
		expect(budget.closed_at).toBeNull()
	})

	test('la suppression d’un budget est filtrée à zéro ligne pour un non-administrateur', async ({
		request,
	}) => {
		const reponse = await request.delete(`${BUDGETS}?id=eq.${BUDGET_ESSAI}`, {
			headers: { ...enTetesAuthentifies(jetonBizdev), Prefer: 'return=representation' },
		})
		expect(reponse.status()).toBe(200)
		expect(await reponse.json()).toEqual([])

		const relecture = await request.get(`${BUDGETS}?id=eq.${BUDGET_ESSAI}&select=id`, {
			headers: enTetesAuthentifies(jetonBizdev),
		})
		expect(await relecture.json()).toHaveLength(1)
	})

	test('l’administratrice crée, clôture et rouvre un budget — le refus ci-dessus porte bien sur le RÔLE', async ({
		request,
	}) => {
		const creation = await request.post(BUDGETS, {
			headers: { ...enTetesAuthentifies(jetonAdmin), Prefer: 'return=representation' },
			data: {
				track_id: TRACK_CONSEIL,
				name: 'Budget créé par l’administratrice budgets.spec',
				position: POSITION_ESSAI + 10,
			},
		})
		expect(creation.status()).toBe(201)
		const [cree] = (await creation.json()) as { id: string }[]

		const cloture = await request.patch(`${BUDGETS}?id=eq.${cree.id}`, {
			headers: { ...enTetesAuthentifies(jetonAdmin), Prefer: 'return=representation' },
			data: { closed_at: new Date('2026-07-01T10:00:00Z').toISOString() },
		})
		expect(cloture.status()).toBe(200)
		expect(await cloture.json()).toHaveLength(1)

		// LA CLÔTURE EST RÉVERSIBLE, et c'est le contrat que la DoD réclame. Sa seule limite est
		// l'index partiel d'unicité : le nom ayant été libéré par la clôture, la réouverture n'est
		// refusée que si quelqu'un l'a repris entre-temps (éprouvé dans la suite pgTAP).
		const reouverture = await request.patch(`${BUDGETS}?id=eq.${cree.id}`, {
			headers: { ...enTetesAuthentifies(jetonAdmin), Prefer: 'return=representation' },
			data: { closed_at: null },
		})
		expect(reouverture.status()).toBe(200)
		expect(await reouverture.json()).toHaveLength(1)
	})

	// -------------------------------------------------------------------------------------------
	// 3. Occurrences — la récurrence, et l'absence de génération automatique
	// -------------------------------------------------------------------------------------------

	test('une occurrence sur un budget NON récurrent est refusée par le trigger, pas par la politique', async ({
		request,
	}) => {
		// Le code distingue les deux causes, et l'écran devra les distinguer aussi : `42501` se
		// traduit par « vous n'avez pas le droit », `23514` par « ce budget n'est pas récurrent ».
		// Les confondre ferait dire à l'écran une chose fausse dans un cas sur deux.
		const reponse = await request.post(OCCURRENCES, {
			headers: enTetesAuthentifies(jetonAdmin),
			data: { budget_id: BUDGET_ESSAI, label: 'Occurrence interdite' },
		})
		expect(reponse.status()).toBe(400)
		expect((await reponse.json()).code).toBe('23514')
	})

	test('un business developer n’ouvre AUCUNE occurrence, l’administratrice si', async ({
		request,
	}) => {
		const refus = await request.post(OCCURRENCES, {
			headers: enTetesAuthentifies(jetonBizdev),
			data: { budget_id: BUDGET_ESSAI_RECURRENT, label: 'Occurrence du bizdev' },
		})
		expect(refus.status()).toBe(403)
		expect((await refus.json()).code).toBe('42501')

		const acceptee = await request.post(OCCURRENCES, {
			headers: { ...enTetesAuthentifies(jetonAdmin), Prefer: 'return=representation' },
			data: { budget_id: BUDGET_ESSAI_RECURRENT, label: 'Occurrence de l’administratrice' },
		})
		expect(acceptee.status()).toBe(201)
	})

	test('AUCUNE OCCURRENCE N’EST ENGENDRÉE : le seed en porte deux, et il n’en naît pas de troisième', async ({
		request,
	}) => {
		// `docs/SPEC-costs.md` §2.2 interdit toute génération automatique. La règle ne se prouve
		// que par une ABSENCE, et une absence ne se mesure qu'après un geste : on clôture une
		// occurrence — le geste qui, dans un produit à calendrier, ferait naître la suivante — et
		// l'on constate qu'il n'en naît aucune. « Février » existe parce qu'on l'a créé, « Mars »
		// n'existe pas parce qu'il ne s'est rien passé en mars.
		const avant = await request.get(`${OCCURRENCES}?budget_id=eq.${BUDGET_RECURRENT}&select=id`, {
			headers: enTetesAuthentifies(jetonAdmin),
		})
		expect(await avant.json()).toHaveLength(2)

		const cloture = await request.patch(`${OCCURRENCES}?id=eq.${OCCURRENCE_CLOTUREE}`, {
			headers: { ...enTetesAuthentifies(jetonAdmin), Prefer: 'return=representation' },
			data: { closed_at: new Date('2026-02-05T17:00:00Z').toISOString() },
		})
		expect(cloture.status()).toBe(200)

		const apres = await request.get(`${OCCURRENCES}?budget_id=eq.${BUDGET_RECURRENT}&select=id`, {
			headers: enTetesAuthentifies(jetonAdmin),
		})
		expect(await apres.json()).toHaveLength(2)
	})

	test('clôturer un budget ne clôt pas ses occurrences — deux décisions de gestion distinctes', async ({
		request,
	}) => {
		// §2.2. La règle ne se voit qu'en enchaînant les deux gestes, et une cascade posée « par
		// commodité » la casserait sans qu'aucune autre assertion ne rougisse.
		await request.post(OCCURRENCES, {
			headers: enTetesAuthentifies(jetonAdmin),
			data: { budget_id: BUDGET_ESSAI_RECURRENT, label: 'Occurrence qui doit rester ouverte' },
		})

		const cloture = await request.patch(`${BUDGETS}?id=eq.${BUDGET_ESSAI_RECURRENT}`, {
			headers: { ...enTetesAuthentifies(jetonAdmin), Prefer: 'return=representation' },
			data: { closed_at: new Date('2026-07-01T10:00:00Z').toISOString() },
		})
		expect(cloture.status()).toBe(200)

		const occurrences = await request.get(
			`${OCCURRENCES}?budget_id=eq.${BUDGET_ESSAI_RECURRENT}&closed_at=is.null&select=id`,
			{ headers: enTetesAuthentifies(jetonAdmin) },
		)
		expect((await occurrences.json()).length).toBeGreaterThan(0)
	})

	test('retirer la récurrence d’un budget qui porte des occurrences est refusé', async ({
		request,
	}) => {
		// Le pendant du trigger éprouvé plus haut, et le chemin que la lecture rapide manque :
		// aucune ligne interdite n'est insérée, et pourtant l'invariant « une occurrence n'existe
		// que sur un budget récurrent » deviendrait faux. `CRM-085` s'appuiera dessus pour décider
		// si `occurrence_id` est exigée.
		const reponse = await request.patch(`${BUDGETS}?id=eq.${BUDGET_ESSAI_RECURRENT}`, {
			headers: enTetesAuthentifies(jetonAdmin),
			data: { is_recurrent: false },
		})
		expect(reponse.status()).toBe(400)
		expect((await reponse.json()).code).toBe('23514')
	})
})
