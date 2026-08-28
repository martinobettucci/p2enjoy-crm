// @verifies CRM-084 (docs/BACKLOG.md) — budgets, occurrences et clôture, TRANCHE 3c : le contrat
//           d'écriture que la sous-surface des occurrences emprunte, hors interface
// @verifies docs/SPEC-costs.md §2.2 (libellé non vide et unique par budget, périodes et enveloppe
//           facultatives, clôture indépendante), §3.2 (écriture réservée à l'administrateur),
//           §4.1 bis.3 (ce que l'écriture envoie), §4.1 bis.4 (le dictionnaire fermé des refus),
//           §4.1 bis.5 (les mesures M3, M5, M8, M9, M11)
// @verifies docs/SCHEMA.md §9 bis.5 (budget_occurrences), §9 bis.7 (politiques)
// @verifies CLAUDE.md §10 (toute règle d'accès se prouve hors interface, avec le jeton réel)
//
// LA QUESTION À LAQUELLE CE FICHIER RÉPOND, ET POURQUOI IL N'EST PAS DANS `budgets.spec.ts`. Celui-ci
// prouve déjà quatre lignes du contrat des occurrences — le refus du business developer, le trigger
// de récurrence, l'indépendance des deux clôtures, et l'absence de génération automatique. Ce qui
// manquait est exactement ce que la sous-surface du §4.1 bis a besoin de savoir pour TRADUIRE :
// chacun des cinq refus de son dictionnaire doit être mesuré avec son CODE, faute de quoi l'écran
// rangerait deux causes distinctes sous une même phrase et nommerait le mauvais geste.
//
// CHAQUE REFUS EST ÉPROUVÉ CONTRE SON SUCCÈS CORRESPONDANT. Sans cette contre-épreuve, une assertion
// resterait verte sur une base qui refuse tout, et ne prouverait rien (docs/JOURNAL.md décision 70).
//
// IL POSE SES PROPRES FIXTURES ET LES DÉTRUIT. Les deux occurrences du seed sont LUES mais jamais
// écrites : elles sont le contrat que `CRM-085` et `CRM-086` mesurent, et les renommer ou les
// clôturer déplacerait leurs écrans.

import { expect, test } from '@playwright/test'
import { URL_API, enTetesAuthentifies, enTetesService, jetonDe } from './jetons'

const OCCURRENCES = '/rest/v1/budget_occurrences'
const COUTS = '/rest/v1/card_costs'

/** Track « Studio web », lu par les trois profils du seed. */
const TRACK_STUDIO = '5eed0000-0000-4000-8000-000000000022'

/**
 * Budget récurrent du seed — « Publicité 2026 ». Il est LU ici, jamais écrit.
 *
 * Son occurrence clôturée « Janvier 2026 » porte une ligne de `card_costs` : c'est elle qui rend la
 * mesure M11 observable sur le seed, sans qu'aucune fixture n'ait à fabriquer le cas.
 */
const BUDGET_RECURRENT_SEED = '5eed0000-0000-4000-8000-0000000000c2'
const OCCURRENCE_REFERENCEE = '5eed0000-0000-4000-8000-0000000000d1'
const LIBELLE_SEED = 'Janvier 2026'

/** Fixtures d'essai, détruites inconditionnellement en fin de fichier. */
const POSITION_ESSAI = 910
const BUDGET_ESSAI = 'c0000000-0000-4000-8000-0000000000c1'

test.describe('CRM-084 tranche 3c — occurrences : le contrat d’écriture, hors interface', () => {
	let jetonAdmin = ''
	let jetonBizdev = ''
	let jetonViewer = ''

	test.beforeAll(async ({ playwright }) => {
		jetonAdmin = await jetonDe('admin@p2enjoy.test')
		jetonBizdev = await jetonDe('bizdev@p2enjoy.test')
		jetonViewer = await jetonDe('viewer@p2enjoy.test')

		// Le décor est posé par la CLÉ DE SERVICE, qui traverse la RLS : ce fichier prouve des
		// refus, et poser son décor avec un jeton de profil ferait dépendre le décor de la règle
		// qu'il éprouve.
		const service = await playwright.request.newContext({ baseURL: URL_API })
		try {
			const decor = await service.post('/rest/v1/budgets', {
				headers: { ...enTetesService(), Prefer: 'resolution=merge-duplicates' },
				data: [
					{
						id: BUDGET_ESSAI,
						track_id: TRACK_STUDIO,
						name: 'Budget récurrent d’essai occurrences.spec',
						currency: 'EUR',
						planned_amount: 3000,
						is_recurrent: true,
						closed_at: null,
						position: POSITION_ESSAI,
					},
				],
			})
			// LE DÉCOR ÉCHOUE BRUYAMMENT. Sans cette assertion, une erreur de fixture se déguiserait
			// en refus de politique plusieurs scénarios plus loin.
			if (!decor.ok()) {
				throw new Error(
					`fixtures d’occurrences.spec non posées (${decor.status()}) : ${await decor.text()}`,
				)
			}
		} finally {
			await service.dispose()
		}
	})

	/** Le seed sort INTACT : `on delete cascade` emporte les occurrences du budget d'essai. */
	test.afterAll(async ({ playwright }) => {
		const service = await playwright.request.newContext({ baseURL: URL_API })
		try {
			await service.delete(`/rest/v1/budgets?id=eq.${BUDGET_ESSAI}`, {
				headers: enTetesService(),
			})
		} finally {
			await service.dispose()
		}
	})

	// -------------------------------------------------------------------------------------------
	// M3 — qui LIT une occurrence, et pourquoi la sous-surface lui est visible
	// -------------------------------------------------------------------------------------------

	test('M3 — la lectrice LIT les deux occurrences du seed, son track lui étant ouvert', async ({
		request,
	}) => {
		// C'est la mesure qui décide de l'état « lecture seule » du §4.1 bis.5 : masquer la
		// sous-surface à qui la lit déjà par l'API mentirait sur ce que le produit rend.
		const lecture = await request.get(
			`${OCCURRENCES}?budget_id=eq.${BUDGET_RECURRENT_SEED}&select=id,label`,
			{ headers: enTetesAuthentifies(jetonViewer) },
		)
		expect(lecture.status()).toBe(200)
		const lignes = (await lecture.json()) as { label: string }[]
		expect(lignes.map((ligne) => ligne.label).sort()).toEqual(['Février 2026', 'Janvier 2026'])
	})

	// -------------------------------------------------------------------------------------------
	// M2 — le refus de droit, et sa contre-épreuve
	// -------------------------------------------------------------------------------------------

	test('M2 — la lectrice n’ouvre AUCUNE occurrence : 403 / 42501, et rien n’est écrit', async ({
		request,
	}) => {
		const refus = await request.post(OCCURRENCES, {
			headers: enTetesAuthentifies(jetonViewer),
			data: { budget_id: BUDGET_ESSAI, label: 'Tentative de la lectrice' },
		})
		expect(refus.status()).toBe(403)
		expect(((await refus.json()) as { code: string }).code).toBe('42501')

		// La ligne est RELUE pour la constater absente : un refus qui n'écrirait pas serait
		// indistinguable d'un refus qui écrit puis masque (décision 70).
		const relecture = await request.get(
			`${OCCURRENCES}?budget_id=eq.${BUDGET_ESSAI}&label=eq.${encodeURIComponent('Tentative de la lectrice')}`,
			{ headers: enTetesService() },
		)
		expect(await relecture.json()).toEqual([])
	})

	// -------------------------------------------------------------------------------------------
	// M10 et M5 — les deux refus de forme du dictionnaire, chacun avec son code
	// -------------------------------------------------------------------------------------------

	test('M10 — un libellé vide est refusé par le CHECK : 23514, et le succès le contredit', async ({
		request,
	}) => {
		const refus = await request.post(OCCURRENCES, {
			headers: enTetesAuthentifies(jetonAdmin),
			data: { budget_id: BUDGET_ESSAI, label: '   ' },
		})
		expect(refus.status()).toBe(400)
		const corps = (await refus.json()) as { code: string; message: string }
		expect(corps.code).toBe('23514')
		// Le nom de la contrainte sépare ce refus de celui du trigger de récurrence, qui porte le
		// MÊME code : c'est cette distinction que le dictionnaire du §4.1 bis.4 exploite.
		expect(corps.message).toContain('budget_occurrences_label_check')

		// CONTRE-ÉPREUVE : le même appelant, sur le même budget, avec un libellé non vide, réussit.
		const succes = await request.post(OCCURRENCES, {
			headers: { ...enTetesAuthentifies(jetonAdmin), Prefer: 'return=representation' },
			data: { budget_id: BUDGET_ESSAI, label: 'Mars 2026' },
		})
		expect(succes.status()).toBe(201)
	})

	test('M5 — un libellé déjà pris est refusé en 23505, et la CASSE n’est PAS repliée', async ({
		request,
	}) => {
		const enTetes = { ...enTetesAuthentifies(jetonAdmin), Prefer: 'return=representation' }

		const premiere = await request.post(OCCURRENCES, {
			headers: enTetes,
			data: { budget_id: BUDGET_ESSAI, label: 'Avril 2026' },
		})
		expect(premiere.status()).toBe(201)

		// Bordé de blancs, le même libellé est refusé : l'index porte sur `app.btrim_blancs(label)`.
		const doublon = await request.post(OCCURRENCES, {
			headers: enTetes,
			data: { budget_id: BUDGET_ESSAI, label: '  Avril 2026  ' },
		})
		expect(doublon.status()).toBe(409)
		const corps = (await doublon.json()) as { code: string; message: string }
		expect(corps.code).toBe('23505')
		expect(corps.message).toContain('budget_occurrences_budget_label_key')

		// LA CASSE N'EST PAS REPLIÉE, et cette assertion FIGE le comportement mesuré plutôt que de
		// le laisser redécouvrir comme un défaut. C'est exactement la normalisation que l'index des
		// budgets applique à leur nom : la règle est uniforme dans le produit. Le jour où elle
		// changera, cette assertion se retournera et le dira (§4.1 bis.5).
		const casseDifferente = await request.post(OCCURRENCES, {
			headers: enTetes,
			data: { budget_id: BUDGET_ESSAI, label: 'avril 2026' },
		})
		expect(casseDifferente.status()).toBe(201)
	})

	// -------------------------------------------------------------------------------------------
	// M8 — une occurrence close reste modifiable
	// -------------------------------------------------------------------------------------------

	test('M8 — une occurrence CLOSE se renomme et se dote encore : aucun trigger ne s’y oppose', async ({
		request,
	}) => {
		// C'est ce qui autorise la sous-surface à garder « Modifier » sur une ligne close, et c'est
		// cohérent avec le §4.8, où les factures arrivent après la clôture. L'inverse — éteindre la
		// commande — poserait à l'écran une garde que la base n'a pas (`CLAUDE.md` §10).
		const enTetes = { ...enTetesAuthentifies(jetonAdmin), Prefer: 'return=representation' }

		const creation = await request.post(OCCURRENCES, {
			headers: enTetes,
			data: { budget_id: BUDGET_ESSAI, label: 'Mai 2026', planned_amount: 100 },
		})
		expect(creation.status()).toBe(201)
		const id = ((await creation.json()) as { id: string }[])[0]!.id

		const cloture = await request.patch(`${OCCURRENCES}?id=eq.${id}`, {
			headers: enTetes,
			data: { closed_at: '2026-05-31T12:00:00Z' },
		})
		expect(cloture.status()).toBe(200)

		const modification = await request.patch(`${OCCURRENCES}?id=eq.${id}`, {
			headers: enTetes,
			data: {
				label: 'Mai 2026 — révisé',
				period_start: null,
				period_end: null,
				planned_amount: 999,
			},
		})
		expect(modification.status()).toBe(200)
		const apres = ((await modification.json()) as { label: string; planned_amount: string }[])[0]!
		expect(apres.label).toBe('Mai 2026 — révisé')
		expect(Number(apres.planned_amount)).toBe(999)
	})

	test('les trois attributs facultatifs sont EFFAÇABLES, ce qu’un `coalesce` interdirait', async ({
		request,
	}) => {
		// C'est la règle du §4.1 bis.3 — l'écran les envoie TOUJOURS, même nuls —, et elle n'a de
		// sens que si la base accepte le nul. Sans cette mesure, une enveloppe posée par erreur
		// serait ineffaçable et personne ne le saurait avant de l'avoir posée.
		const enTetes = { ...enTetesAuthentifies(jetonAdmin), Prefer: 'return=representation' }

		const creation = await request.post(OCCURRENCES, {
			headers: enTetes,
			data: {
				budget_id: BUDGET_ESSAI,
				label: 'Juin 2026',
				period_start: '2026-06-01',
				period_end: '2026-06-30',
				planned_amount: 500,
			},
		})
		expect(creation.status()).toBe(201)
		const id = ((await creation.json()) as { id: string }[])[0]!.id

		const efface = await request.patch(`${OCCURRENCES}?id=eq.${id}`, {
			headers: enTetes,
			data: { label: 'Juin 2026', period_start: null, period_end: null, planned_amount: null },
		})
		expect(efface.status()).toBe(200)
		const apres = ((await efface.json()) as {
			period_start: string | null
			period_end: string | null
			planned_amount: string | null
		}[])[0]!
		expect(apres.period_start).toBeNull()
		expect(apres.period_end).toBeNull()
		expect(apres.planned_amount).toBeNull()
	})

	// -------------------------------------------------------------------------------------------
	// M9 et M11 — le cinquième geste, et la borne que la base lui pose
	// -------------------------------------------------------------------------------------------

	test('M9 — l’administratrice RETIRE une occurrence qui ne porte aucune ligne de coût', async ({
		request,
	}) => {
		const enTetes = { ...enTetesAuthentifies(jetonAdmin), Prefer: 'return=representation' }

		const creation = await request.post(OCCURRENCES, {
			headers: enTetes,
			data: { budget_id: BUDGET_ESSAI, label: 'Juillet 2026' },
		})
		expect(creation.status()).toBe(201)
		const id = ((await creation.json()) as { id: string }[])[0]!.id

		const retrait = await request.delete(`${OCCURRENCES}?id=eq.${id}`, {
			headers: enTetesAuthentifies(jetonAdmin),
		})
		expect(retrait.status()).toBe(204)

		// RELUE À LA CLÉ DE SERVICE pour la constater réellement absente, et non simplement masquée.
		const relecture = await request.get(`${OCCURRENCES}?id=eq.${id}`, { headers: enTetesService() })
		expect(await relecture.json()).toEqual([])
	})

	test('M11 — retirer une occurrence RÉFÉRENCÉE est refusé en 23503, et la ligne survit', async ({
		request,
	}) => {
		// C'est la borne du cinquième geste, et elle est posée par la BASE, pas par l'écran. La
		// doctrine « un budget ne se supprime pas, il se clôture » vise ce qu'on EFFACERAIT : la clé
		// étrangère protège déjà ce cas, et l'écran n'a qu'à traduire.
		const temoin = await request.get(
			`${COUTS}?occurrence_id=eq.${OCCURRENCE_REFERENCEE}&select=id`,
			{ headers: enTetesService() },
		)
		// Le témoin établit que le cas EXISTE avant d'affirmer que le retrait est refusé : sur une
		// occurrence sans ligne, l'assertion serait verte pour une tout autre raison.
		expect(((await temoin.json()) as unknown[]).length).toBeGreaterThan(0)

		const refus = await request.delete(`${OCCURRENCES}?id=eq.${OCCURRENCE_REFERENCEE}`, {
			headers: enTetesAuthentifies(jetonAdmin),
		})
		expect(refus.status()).toBe(409)
		const corps = (await refus.json()) as { code: string; message: string }
		expect(corps.code).toBe('23503')
		expect(corps.message).toContain('card_costs_occurrence_id_fkey')

		// LE SEED SORT INTACT, vérifié plutôt que supposé.
		const relecture = await request.get(
			`${OCCURRENCES}?id=eq.${OCCURRENCE_REFERENCEE}&select=id,label`,
			{ headers: enTetesAuthentifies(jetonAdmin) },
		)
		expect((await relecture.json()) as { label: string }[]).toEqual([
			{ id: OCCURRENCE_REFERENCEE, label: LIBELLE_SEED },
		])
	})

	test('le business developer ne RETIRE rien non plus, et le refus est un FILTRAGE', async ({
		request,
	}) => {
		// La distinction compte pour l'écran : un `WITH CHECK` lève (`403`), un `USING` filtre
		// (`200 []`). Le second est le « sans effet » que la sous-surface DIT plutôt que de le
		// présenter comme un succès (§4.1 bis.3).
		const enTetes = { ...enTetesAuthentifies(jetonAdmin), Prefer: 'return=representation' }
		const creation = await request.post(OCCURRENCES, {
			headers: enTetes,
			data: { budget_id: BUDGET_ESSAI, label: 'Août 2026' },
		})
		expect(creation.status()).toBe(201)
		const id = ((await creation.json()) as { id: string }[])[0]!.id

		const filtre = await request.delete(`${OCCURRENCES}?id=eq.${id}`, {
			headers: { ...enTetesAuthentifies(jetonBizdev), Prefer: 'return=representation' },
		})
		expect(filtre.status()).toBe(200)
		expect(await filtre.json()).toEqual([])

		// CONTRE-ÉPREUVE : la ligne est toujours là, et l'administratrice la retire.
		const relecture = await request.get(`${OCCURRENCES}?id=eq.${id}`, { headers: enTetesService() })
		expect(((await relecture.json()) as unknown[]).length).toBe(1)
		const retrait = await request.delete(`${OCCURRENCES}?id=eq.${id}`, {
			headers: enTetesAuthentifies(jetonAdmin),
		})
		expect(retrait.status()).toBe(204)
	})
})
