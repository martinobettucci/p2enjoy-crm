// @verifies CRM-085 (docs/BACKLOG.md) — lignes de coût d'une affaire, hors interface
// @verifies docs/SPEC-costs.md §1 (le cas qui a motivé la demande), §2.3 (card_costs),
//           §3.1 (double condition de lecture), §3.2 (écriture), §4.4 (le réel inconnu),
//           §4.6 (section de la fiche), §4.8 (à saisir)
// @verifies docs/SCHEMA.md §9 bis.6 (colonnes et triggers), §9 bis.7 (politiques)
// @verifies docs/SPEC-permissions-rls.md §2.1 (un viewer n'écrit rien), §7 (preuves de refus)
// @verifies CLAUDE.md §10 (toute règle d'accès se prouve hors interface, avec le jeton réel)
//
// LA QUESTION À LAQUELLE CE FICHIER RÉPOND, ET QUE LA SUITE pgTAP NE PEUT PAS POSER.
// `0049_card_costs.test.sql` prouve les mêmes règles DANS la base, avec `set local role` : elle ne
// traverse ni Kong, ni PostgREST, ni GoTrue. Or trois choses n'existent qu'au niveau HTTP, et la
// Definition of Done de `CRM-085` les exige :
//
//   * LES TROIS FORMES DU REFUS, qui ne sont pas interchangeables et qu'un fichier attendant « un
//     échec » confondrait :
//       — un `WITH CHECK` de politique qui LÈVE            → `403` avec `42501` ;
//       — un `USING` de politique qui FILTRE               → `200 []`, la requête a réussi et n'a
//         simplement touché aucune ligne (décision 106) ;
//       — un TRIGGER qui lève                              → `400` avec `23514`.
//
//   * QUI DES DEUX PARLE EN PREMIER, ET C'EST MESURÉ, PAS DÉDUIT. PostgreSQL exécute les triggers
//     `BEFORE INSERT` AVANT d'appliquer le `WITH CHECK`. Une insertion sur un budget clôturé rend
//     donc `400 / 23514` — le message du trigger, qui NOMME la clôture — et jamais `403`, bien que
//     la politique porte la même condition. `CRM-085` tranche 2 et `CRM-086` classeront ces
//     réponses pour en tirer des messages : un module qui guetterait un `403` ici ne le
//     reconnaîtrait jamais.
//
//   * LA DOUBLE CONDITION DE LECTURE, avec les VRAIS jetons des trois profils du seed, sur le cas
//     qui la motive et sur lui seul.
//
// IL POSE SES PROPRES FIXTURES ET LES DÉTRUIT. Les quatre lignes du seed sont LUES mais jamais
// écrites : elles sont le contrat que `CRM-086` mesurera, et y saisir un réel déplacerait ses
// histogrammes.

import { expect, test } from '@playwright/test'
import { CLE_ANONYME, URL_API, enTetesAuthentifies, enTetesService, jetonDe } from './jetons'

const COUTS = '/rest/v1/card_costs'
const BUDGETS = '/rest/v1/budgets'

/**
 * Tracks du seed, stables par contrat (`docs/SPEC-seed.md`), retenus pour ce qu'ils SÉPARENT —
 * MESURÉ sur la pile seedée et non supposé :
 *
 *   * « Conseil & IA » — **INVISIBLE à la lectrice**, dont le droit fin `none` sur le track n'est
 *     pas rouvert au niveau du TRACK par son `channel_members` sur « Prospection » ;
 *   * « Studio web »   — lu par les trois, et dont le business developer ÉCRIT les cards.
 */
const TRACK_CONSEIL = '5eed0000-0000-4000-8000-000000000021'
const TRACK_STUDIO = '5eed0000-0000-4000-8000-000000000022'

/**
 * Affaires du seed. « Refonte intranet Ville de Lyon » vit sur « Studio web » : la lectrice la LIT
 * et le business developer l'ÉCRIT, tous deux mesurés. C'est ce qui permet à la même affaire de
 * porter le cas de lecture du §3.1 et les cas d'écriture du §3.2.
 */
const CARD_STUDIO = '5eed0000-0000-4000-8000-0000000000c4'

/** Lignes du seed, LUES ici et jamais écrites (`docs/SPEC-costs.md` §1). */
const LIGNE_SANS_REEL = '5eed0000-0000-4000-8000-0000000000e1'
const LIGNE_AVEC_REEL = '5eed0000-0000-4000-8000-0000000000e2'
const LIGNE_BUDGET_INVISIBLE = '5eed0000-0000-4000-8000-0000000000e4'
const CARD_LISIBLE_BUDGET_FERME = '5eed0000-0000-4000-8000-0000000000c7'

/**
 * Fixtures d'essai, détruites inconditionnellement en fin de fichier. Leur `position` est très
 * au-dessus de celles du seed pour que la destruction porte sur ce seul critère, sans énumérer des
 * identifiants qu'un scénario interrompu aurait multipliés — et `card_costs.budget_id` étant
 * `ON DELETE RESTRICT`, les lignes sont détruites AVANT leurs budgets.
 */
const POSITION_ESSAI = 950
const BUDGET_OUVERT = 'd0000000-0000-4000-8000-0000000000b1'
const BUDGET_RECURRENT = 'd0000000-0000-4000-8000-0000000000b2'
const BUDGET_A_CLOTURER = 'd0000000-0000-4000-8000-0000000000b3'
const BUDGET_INVISIBLE = 'd0000000-0000-4000-8000-0000000000b4'
const OCCURRENCE_OUVERTE = 'd0000000-0000-4000-8000-0000000000a1'
const LIGNE_SUR_BUDGET_CLOS = 'd0000000-0000-4000-8000-0000000000e1'
const LIGNE_INVISIBLE = 'd0000000-0000-4000-8000-0000000000e2'

type LigneDeCout = {
	id: string
	label: string
	estimated_cost: string | number
	actual_cost: string | number | null
	occurrence_id: string | null
}

test.describe('CRM-085 — lignes de coût : le contrat d’API, hors interface', () => {
	let jetonAdmin = ''
	let jetonBizdev = ''
	let jetonViewer = ''

	/**
	 * Le décor est posé par la CLÉ DE SERVICE, qui traverse la RLS : ce fichier prouve des refus,
	 * et poser son décor avec un jeton de profil ferait dépendre le décor de la règle qu'il
	 * éprouve.
	 *
	 * L'ORDRE EST CONTRAINT PAR LE PRODUIT, ET C'EST LA MÊME HISTOIRE QUE CELLE DU SEED : le
	 * trigger refuse toute ligne neuve sur un budget clôturé, y compris à la clé de service. Le
	 * budget à clôturer naît donc OUVERT, reçoit sa ligne, PUIS est clôturé — « on clôt une
	 * campagne puis les factures arrivent » (§2.3).
	 */
	const poserLesFixtures = async (playwright: typeof import('@playwright/test').request) => {
		const service = await playwright.newContext({ baseURL: URL_API })
		const echouerBruyamment = async (reponse: Awaited<ReturnType<typeof service.post>>) => {
			// Sans cette garde, une erreur de fixture se déguiserait en refus de politique dix
			// scénarios plus loin (apprentissage de `budgets.spec.ts`).
			if (!reponse.ok()) {
				throw new Error(
					`fixtures de card-costs.spec non posées (${reponse.status()}) : ${await reponse.text()}`,
				)
			}
		}
		try {
			// Les quatre objets portent EXACTEMENT les mêmes clés : PostgREST refuse une insertion
			// en lot dont les objets diffèrent, n'ayant plus de liste de colonnes à écrire.
			await echouerBruyamment(
				await service.post(BUDGETS, {
					headers: { ...enTetesService(), Prefer: 'resolution=merge-duplicates' },
					data: [
						{
							id: BUDGET_OUVERT,
							track_id: TRACK_STUDIO,
							name: 'Budget ouvert card-costs.spec',
							currency: 'EUR',
							planned_amount: 1000,
							is_recurrent: false,
							closed_at: null,
							position: POSITION_ESSAI,
						},
						{
							id: BUDGET_RECURRENT,
							track_id: TRACK_STUDIO,
							name: 'Budget récurrent card-costs.spec',
							currency: 'EUR',
							planned_amount: 2000,
							is_recurrent: true,
							closed_at: null,
							position: POSITION_ESSAI + 1,
						},
						{
							id: BUDGET_A_CLOTURER,
							track_id: TRACK_STUDIO,
							name: 'Budget à clôturer card-costs.spec',
							currency: 'EUR',
							planned_amount: 3000,
							is_recurrent: false,
							closed_at: null,
							position: POSITION_ESSAI + 2,
						},
						{
							id: BUDGET_INVISIBLE,
							track_id: TRACK_CONSEIL,
							name: 'Budget invisible card-costs.spec',
							currency: 'EUR',
							planned_amount: 4000,
							is_recurrent: false,
							closed_at: null,
							position: POSITION_ESSAI + 3,
						},
					],
				}),
			)

			await echouerBruyamment(
				await service.post('/rest/v1/budget_occurrences', {
					headers: { ...enTetesService(), Prefer: 'resolution=merge-duplicates' },
					data: [
						{
							id: OCCURRENCE_OUVERTE,
							budget_id: BUDGET_RECURRENT,
							label: 'Occurrence card-costs.spec',
							period_start: '2026-07-01',
							period_end: '2026-07-31',
							planned_amount: 500,
							closed_at: null,
						},
					],
				}),
			)

			await echouerBruyamment(
				await service.post(COUTS, {
					headers: { ...enTetesService(), Prefer: 'resolution=merge-duplicates' },
					data: [
						{
							id: LIGNE_SUR_BUDGET_CLOS,
							card_id: CARD_STUDIO,
							budget_id: BUDGET_A_CLOTURER,
							occurrence_id: null,
							label: 'Ligne d’un budget clos',
							estimated_cost: 500,
							actual_cost: null,
						},
						{
							id: LIGNE_INVISIBLE,
							card_id: CARD_STUDIO,
							budget_id: BUDGET_INVISIBLE,
							occurrence_id: null,
							label: 'Ligne d’un budget invisible',
							estimated_cost: 800,
							actual_cost: null,
						},
					],
				}),
			)

			// LA CLÔTURE VIENT APRÈS, par le vrai geste — un `PATCH` qui pose `closed_at`.
			await echouerBruyamment(
				await service.patch(`${BUDGETS}?id=eq.${BUDGET_A_CLOTURER}`, {
					headers: { ...enTetesService(), Prefer: 'return=representation' },
					data: { closed_at: '2026-07-31T17:00:00Z' },
				}),
			)
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
	 * Le seed sort INTACT. Les lignes tombent AVANT les budgets : `budget_id` est
	 * `ON DELETE RESTRICT`, et l'ordre inverse laisserait le décor en place — la table ne se vide
	 * pas par la cascade, c'est précisément ce que `CRM-085` garantit.
	 */
	test.afterAll(async ({ playwright }) => {
		const service = await playwright.request.newContext({ baseURL: URL_API })
		try {
			// LE FILTRE PORTE SUR `budget_id`, ET C'EST MESURÉ. Un `id=like.d0000000*` ne supprime
			// RIEN : `id` est de type `uuid`, pour lequel PostgreSQL n'offre aucun opérateur
			// `LIKE`, et PostgREST rend alors une erreur que ce nettoyage ignorait en silence. Les
			// budgets d'essai survivaient à leur tour — `ON DELETE RESTRICT` les protège dès qu'une
			// ligne les cite —, et la suite pgTAP de `CRM-084` échouait au cycle suivant sur une
			// position maximale de 954 au lieu de 202. Le filtre par budget a un second mérite : il
			// emporte AUSSI les lignes qu'un scénario interrompu aurait créées sous d'autres
			// identifiants.
			const lignes = await service.delete(
				`${COUTS}?budget_id=in.(${BUDGET_OUVERT},${BUDGET_RECURRENT},${BUDGET_A_CLOTURER},${BUDGET_INVISIBLE})`,
				{ headers: enTetesService() },
			)
			const budgets = await service.delete(`${BUDGETS}?position=gte.${POSITION_ESSAI}`, {
				headers: enTetesService(),
			})
			// LE NETTOYAGE ÉCHOUE BRUYAMMENT. Silencieux, il laisse un décor qui fait rougir la
			// suite pgTAP d'une AUTRE unité, et le diagnostic ressemble alors à une régression.
			if (!lignes.ok() || !budgets.ok()) {
				throw new Error(
					`décor de card-costs.spec non détruit (lignes ${lignes.status()}, budgets ${budgets.status()}) : ` +
						`${await lignes.text()} / ${await budgets.text()}`,
				)
			}
		} finally {
			await service.dispose()
		}
	})

	// -------------------------------------------------------------------------------------------
	// 1. Lecture — la DOUBLE condition, et le cas qui la motive (§3.1)
	// -------------------------------------------------------------------------------------------

	test('l’appelant anonyme ne lit AUCUNE ligne, et le refus est un filtrage', async ({
		request,
	}) => {
		// La politique est ouverte `to anon` délibérément : `auth.uid()` valant NULL, le refus se
		// fait par ZÉRO LIGNE et non par une erreur de privilège. Un `401` révélerait que la table
		// existe et qu'elle est protégée ; `200 []` ne révèle rien.
		const reponse = await request.get(`${COUTS}?select=id`, { headers: { apikey: CLE_ANONYME } })
		expect(reponse.status()).toBe(200)
		expect(await reponse.json()).toEqual([])
	})

	test('LE CAS QUI MOTIVE LA DOUBLE CONDITION : la lectrice lit l’affaire et AUCUNE de ses lignes', async ({
		request,
	}) => {
		// C'est le scénario central de `CRM-085`. La lectrice LIT « Formation Data & IA » — vérifié
		// ici même, sans quoi zéro ligne ne prouverait que l'absence de droit sur la card — et ne
		// voit AUCUNE de ses lignes, la seule qu'elle porte étant rattachée à un budget d'un track
		// fermé. Une politique qui n'exigerait que `app.can_read_card` en rendrait une, et
		// divulguerait le nom et le montant d'une enveloppe interdite.
		const affaire = await request.get(`/rest/v1/cards?id=eq.${CARD_LISIBLE_BUDGET_FERME}&select=id`, {
			headers: enTetesAuthentifies(jetonViewer),
		})
		expect(affaire.status()).toBe(200)
		expect(await affaire.json()).toHaveLength(1)

		const lignes = await request.get(
			`${COUTS}?card_id=eq.${CARD_LISIBLE_BUDGET_FERME}&select=id,label`,
			{ headers: enTetesAuthentifies(jetonViewer) },
		)
		expect(lignes.status()).toBe(200)
		expect(await lignes.json()).toEqual([])
	})

	test('et l’administratrice, qui lit les deux côtés, voit cette même ligne', async ({
		request,
	}) => {
		// La contre-épreuve du scénario précédent. Sans elle, une table VIDE le satisferait et le
		// fichier se féliciterait de rien.
		const reponse = await request.get(`${COUTS}?id=eq.${LIGNE_BUDGET_INVISIBLE}&select=id,label`, {
			headers: enTetesAuthentifies(jetonAdmin),
		})
		expect(reponse.status()).toBe(200)
		expect(await reponse.json()).toHaveLength(1)
	})

	test('la lectrice lit en revanche les lignes dont elle lit les DEUX côtés', async ({
		request,
	}) => {
		// Le témoin : sans lui, « elle ne voit rien » se confondrait avec un aveuglement général,
		// et une politique cassée dans les deux sens resterait verte.
		const reponse = await request.get(`${COUTS}?card_id=eq.${CARD_STUDIO}&select=id,label`, {
			headers: enTetesAuthentifies(jetonViewer),
		})
		expect(reponse.status()).toBe(200)
		const lignes = (await reponse.json()) as LigneDeCout[]
		expect(lignes.map((l) => l.id)).toContain(LIGNE_SANS_REEL)
		// Et la ligne rattachée au budget d'un track fermé n'y est PAS, sur cette même affaire :
		// c'est la double condition mesurée ligne à ligne plutôt que card à card.
		expect(lignes.map((l) => l.id)).not.toContain(LIGNE_INVISIBLE)
	})

	// -------------------------------------------------------------------------------------------
	// 2. Le cas du responsable, et le réel inconnu (§1 et §4.4)
	// -------------------------------------------------------------------------------------------

	test('LE CAS DU RESPONSABLE : une affaire porte deux lignes de nature différente, l’une sans réel', async ({
		request,
	}) => {
		// « Publicité — estimé 100, réel non connu » et « Production — estimé 350, réel 375 ». Une
		// affectation unique par affaire ne rendrait pas ce cas, et c'est la raison d'être du
		// modèle (§1). Le seed le porte en permanence ; ce scénario le lit par l'API réelle.
		const reponse = await request.get(
			`${COUTS}?id=in.(${LIGNE_SANS_REEL},${LIGNE_AVEC_REEL})&select=id,label,estimated_cost,actual_cost&order=label`,
			{ headers: enTetesAuthentifies(jetonAdmin) },
		)
		expect(reponse.status()).toBe(200)
		const lignes = (await reponse.json()) as LigneDeCout[]
		expect(lignes).toHaveLength(2)

		const publicite = lignes.find((l) => l.label === 'Publicité')
		const production = lignes.find((l) => l.label === 'Production')
		expect(Number(publicite?.estimated_cost)).toBe(100)
		expect(Number(production?.estimated_cost)).toBe(350)
		expect(Number(production?.actual_cost)).toBe(375)

		// LE POINT CENTRAL DU §2.3, ET IL SE PERD À LA MOINDRE COERCITION : le réel inconnu arrive
		// `null` jusqu'au client, jamais `0`. `toBeNull` et non `toBeFalsy` — ce dernier serait
		// vert sur `0`, c'est-à-dire sur le défaut exact que cette assertion existe pour attraper.
		expect(publicite?.actual_cost).toBeNull()
	})

	test('l’index des lignes SANS réel les rend toutes, du plus ancien au plus récent (§4.8)', async ({
		request,
	}) => {
		// C'est la requête que l'onglet « À saisir » de `CRM-086` posera. Elle est éprouvée ici
		// pour que le contrat de tri et de filtre existe avant l'écran, et non l'inverse.
		const reponse = await request.get(
			`${COUTS}?actual_cost=is.null&select=id,label,created_at&order=created_at.asc`,
			{ headers: enTetesAuthentifies(jetonAdmin) },
		)
		expect(reponse.status()).toBe(200)
		const lignes = (await reponse.json()) as LigneDeCout[]
		expect(lignes.map((l) => l.id)).toContain(LIGNE_SANS_REEL)
		// La ligne d'un budget CLÔTURÉ y figure, et c'est le §4.8 : « c'est précisément après la
		// clôture que les factures arrivent, et les exclure viderait l'onglet de son usage ».
		expect(lignes.map((l) => l.id)).toContain(LIGNE_SUR_BUDGET_CLOS)
	})

	// -------------------------------------------------------------------------------------------
	// 3. Écriture — la ligne de partage du §3.2
	// -------------------------------------------------------------------------------------------

	test('LA LIGNE DE PARTAGE : le business developer crée une ligne sans écrire le budget', async ({
		request,
	}) => {
		// « Le budget est un CADRE — décision de gestion ; l'affectation est un GESTE quotidien. »
		// Les deux moitiés sont mesurées dans le MÊME scénario : la création réussit, et la
		// modification du budget qui l'encadre échoue. Séparées, chacune resterait verte sur un
		// produit qui aurait perdu l'autre.
		const creation = await request.post(COUTS, {
			headers: { ...enTetesAuthentifies(jetonBizdev), Prefer: 'return=representation' },
			data: {
				card_id: CARD_STUDIO,
				budget_id: BUDGET_OUVERT,
				label: 'Ligne du business developer',
				estimated_cost: 42,
			},
		})
		expect(creation.status()).toBe(201)
		const creees = (await creation.json()) as LigneDeCout[]
		expect(creees).toHaveLength(1)
		// `noUncheckedIndexedAccess` : le compilateur ne sait pas que `toHaveLength(1)` garantit
		// l'indice 0. La sortie du tableau est donc EXTRAITE une fois, et non affirmée par `!` —
		// une assertion non nulle masquerait une réponse vide derrière un plantage illisible.
		const [creee] = creees
		if (!creee) throw new Error('la création n’a rendu aucune ligne')

		const surLeBudget = await request.patch(`${BUDGETS}?id=eq.${BUDGET_OUVERT}`, {
			headers: { ...enTetesAuthentifies(jetonBizdev), Prefer: 'return=representation' },
			data: { planned_amount: 999 },
		})
		// Un `USING` de politique FILTRE : la requête réussit et ne touche aucune ligne. Ce n'est
		// pas la même chose qu'un `403`, et confondre les deux ferait écrire à l'écran « accès
		// refusé » là où le produit dit « rien n'a changé ».
		expect(surLeBudget.status()).toBe(200)
		expect(await surLeBudget.json()).toEqual([])

		await request.delete(`${COUTS}?id=eq.${creee.id}`, {
			headers: enTetesAuthentifies(jetonBizdev),
		})
	})

	test('la lectrice ne crée AUCUNE ligne, et le refus est une levée', async ({ request }) => {
		// `docs/SPEC-permissions-rls.md` §2.1. Le `WITH CHECK` lève : PostgREST rend `403` avec
		// `42501`, forme distincte du `200 []` d'un filtrage.
		const reponse = await request.post(COUTS, {
			headers: enTetesAuthentifies(jetonViewer),
			data: {
				card_id: CARD_STUDIO,
				budget_id: BUDGET_OUVERT,
				label: 'Refusée à la lectrice',
				estimated_cost: 10,
			},
		})
		expect(reponse.status()).toBe(403)
		expect((await reponse.json()).code).toBe('42501')
	})

	test('une ligne sur un budget RÉCURRENT sans occurrence est refusée par le trigger', async ({
		request,
	}) => {
		// `400 / 23514` : c'est le trigger qui parle, et son message NOMME la règle. La politique
		// ne dit rien de la récurrence — elle ne le pourrait pas, la règle portant sur deux
		// colonnes de la ligne insérée et sur l'état du budget.
		const reponse = await request.post(COUTS, {
			headers: enTetesAuthentifies(jetonBizdev),
			data: {
				card_id: CARD_STUDIO,
				budget_id: BUDGET_RECURRENT,
				label: 'Sans occurrence',
				estimated_cost: 10,
			},
		})
		expect(reponse.status()).toBe(400)
		expect((await reponse.json()).code).toBe('23514')
	})

	test('LE SECOND SÉLECTEUR : la même ligne AVEC son occurrence est acceptée', async ({
		request,
	}) => {
		// La contre-épreuve du scénario précédent, et le contrat que la section de la fiche (§4.6)
		// devra tenir : « si le budget choisi est récurrent, un second sélecteur d'occurrence
		// apparaît et devient obligatoire ». Sans ce succès, le refus ci-dessus serait vert sur un
		// produit qui refuserait toute ligne sur un budget récurrent.
		const reponse = await request.post(COUTS, {
			headers: { ...enTetesAuthentifies(jetonBizdev), Prefer: 'return=representation' },
			data: {
				card_id: CARD_STUDIO,
				budget_id: BUDGET_RECURRENT,
				occurrence_id: OCCURRENCE_OUVERTE,
				label: 'Avec occurrence',
				estimated_cost: 10,
			},
		})
		expect(reponse.status()).toBe(201)
		const [avecOccurrence] = (await reponse.json()) as LigneDeCout[]
		if (!avecOccurrence) throw new Error('la création n’a rendu aucune ligne')
		expect(avecOccurrence.occurrence_id).toBe(OCCURRENCE_OUVERTE)

		await request.delete(`${COUTS}?id=eq.${avecOccurrence.id}`, {
			headers: enTetesAuthentifies(jetonBizdev),
		})
	})

	// -------------------------------------------------------------------------------------------
	// 4. La frontière de la clôture (§2.3) — trois réponses HTTP différentes
	// -------------------------------------------------------------------------------------------

	test('QUI PARLE EN PREMIER : sur un budget clôturé, l’insertion rend 400/23514 et non 403', async ({
		request,
	}) => {
		// MESURÉ le 2026-08-19, et c'est la raison d'être de ce scénario : PostgreSQL exécute les
		// triggers `BEFORE INSERT` AVANT le `WITH CHECK` de la politique. Bien que les deux portent
		// la clôture, c'est le message du trigger que le client reçoit — celui qui la NOMME.
		const reponse = await request.post(COUTS, {
			headers: enTetesAuthentifies(jetonBizdev),
			data: {
				card_id: CARD_STUDIO,
				budget_id: BUDGET_A_CLOTURER,
				label: 'Trop tard',
				estimated_cost: 10,
			},
		})
		expect(reponse.status()).toBe(400)
		const corps = await reponse.json()
		expect(corps.code).toBe('23514')
		expect(String(corps.message)).toContain('clôturé')
	})

	test('LA FRONTIÈRE : le coût RÉEL reste saisissable sur ce même budget clôturé', async ({
		request,
	}) => {
		// « On clôt une campagne PUIS les factures arrivent » (§2.3). Ce succès et le refus
		// ci-dessus définissent ENSEMBLE la frontière ; l'un sans l'autre décrirait soit un produit
		// qui gèle tout après la clôture, soit un produit qui ne clôt rien.
		const reponse = await request.patch(`${COUTS}?id=eq.${LIGNE_SUR_BUDGET_CLOS}`, {
			headers: { ...enTetesAuthentifies(jetonBizdev), Prefer: 'return=representation' },
			data: { actual_cost: 480 },
		})
		expect(reponse.status()).toBe(200)
		const [miseAJour] = (await reponse.json()) as LigneDeCout[]
		if (!miseAJour) throw new Error('la mise à jour n’a touché aucune ligne')
		expect(Number(miseAJour.actual_cost)).toBe(480)
	})

	test('mais le DÉPLACEMENT de cette ligne reste refusé, et c’est le trigger qui le dit', async ({
		request,
	}) => {
		// La contre-épreuve exacte que la Definition of Done de `CRM-086` réclame : « le changement
		// de `budget_id` ou d'`occurrence_id` sur ce même budget clos reste refusé ». Déplacer une
		// ligne réécrirait un total déjà arrêté.
		const reponse = await request.patch(`${COUTS}?id=eq.${LIGNE_SUR_BUDGET_CLOS}`, {
			headers: { ...enTetesAuthentifies(jetonBizdev), Prefer: 'return=representation' },
			data: { budget_id: BUDGET_OUVERT },
		})
		expect(reponse.status()).toBe(400)
		expect((await reponse.json()).code).toBe('23514')
	})

	test('et sa SUPPRESSION est refusée par la politique — 200, zéro ligne touchée', async ({
		request,
	}) => {
		// La troisième forme du refus, et la seule que le trigger ne produit pas : aucun trigger ne
		// garde la suppression, c'est le `USING` de la politique qui FILTRE. Le client reçoit donc
		// `200 []` — « rien n'a changé » —, et non une erreur.
		const reponse = await request.delete(`${COUTS}?id=eq.${LIGNE_SUR_BUDGET_CLOS}`, {
			headers: { ...enTetesAuthentifies(jetonBizdev), Prefer: 'return=representation' },
		})
		expect(reponse.status()).toBe(200)
		expect(await reponse.json()).toEqual([])

		// Et la ligne est TOUJOURS LÀ : clôturer n'efface pas l'histoire (§2.3).
		const relecture = await request.get(`${COUTS}?id=eq.${LIGNE_SUR_BUDGET_CLOS}&select=id`, {
			headers: enTetesAuthentifies(jetonAdmin),
		})
		expect(await relecture.json()).toHaveLength(1)
	})

	test('un budget qui porte des lignes n’est pas supprimable, même par l’administratrice', async ({
		request,
	}) => {
		// « Un budget ne se supprime pas : il se clôture » (§3.2), rendu STRUCTUREL par
		// `ON DELETE RESTRICT`. L'administratrice a pourtant le droit de supprimer un budget — la
		// politique le lui accorde —, et c'est la base qui l'arrête : `409 / 23503`.
		const reponse = await request.delete(`${BUDGETS}?id=eq.${BUDGET_A_CLOTURER}`, {
			headers: enTetesAuthentifies(jetonAdmin),
		})
		expect(reponse.status()).toBe(409)
		expect((await reponse.json()).code).toBe('23503')
	})
})
