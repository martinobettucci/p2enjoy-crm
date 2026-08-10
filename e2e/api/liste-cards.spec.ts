// @verifies CRM-042 (docs/BACKLOG.md) — la lecture paginée de la vue liste, hors interface
// @verifies CRM-022 (docs/BACKLOG.md) — l'identité du responsable embarquée dans chaque ligne
// @verifies docs/SPEC-cards.md §12.3 (ce que la liste lit, et le total exact), §12.4 (le tri
//           TOTAL et `nullslast`), §12.5 (les filtres côté serveur), §12.6 (la pagination et le
//           `416`), §12.12 (preuves attendues)
// @verifies docs/SPEC-permissions-rls.md §7 (preuves hors interface, jetons réels)
// @verifies docs/SPEC-cards.md §5 (« active » : ni archivée, ni en corbeille)
// @verifies CLAUDE.md §10 (toute règle d'accès se prouve hors interface, avec le jeton réel)
//
// LA QUESTION À LAQUELLE CE FICHIER RÉPOND. La vue liste construit une requête paginée, triée et
// filtrée (§12.3 à §12.6). Cette construction est éprouvée par `webapp/src/lib/liste-cards.test.ts`
// **contre un client factice** : rien n'y garantit que la pile réelle réponde ce qu'on croit. Un
// `Range` mal interprété, un `nullslast` refusé, un `plfts` sans configuration, un `count` estimé —
// le test unitaire resterait vert et l'écran mentirait.
//
// Les deux lectures du §12.3 sont donc rejouées **par la vraie route, avec le jeton réel de
// l'administratrice**, et confrontées au seed mesuré. Puis les mêmes lectures sont opposées à
// l'anonyme, dont le `200` et le `[]` sont la cause de l'écran vide que les captures montrent.
//
// AUCUNE ÉCRITURE. Ce fichier ne pose ni ne retire aucune ligne : le seed sort intact. C'est ce
// qui distingue cette preuve de celle de `CRM-040`, dont INC-061 dit le coût.

import { expect, test } from '@playwright/test'
import { enTetesAnonymes, enTetesAuthentifies, jetonDe } from './jetons'

/**
 * Les colonnes et le pas de pagination réellement employés par la webapp, **importés depuis le
 * module qu'elle emploie**. Un test qui redéclarerait sa propre chaîne `select` ou son propre pas
 * prouverait qu'une requête quelconque fonctionne, pas que **celle du produit** fonctionne
 * (décision 177, reprise ici).
 */
import {
	CODE_PAGE_INEXISTANTE,
	COLONNES_CARD_LISTE,
	LIGNES_PAR_PAGE,
} from '../../webapp/src/lib/colonnes-liste'

/** Identifiants du seed, mesurés en base le 2026-08-05 (docs/SPEC-seed.md, docs/SPEC-cards.md §9). */
const WORKFLOW_GLOBAL = '5eed0000-0000-4000-8000-000000000051'
const CHANNEL_GRANDS_COMPTES = '5eed0000-0000-4000-8000-000000000032'
const CHANNEL_INTER_ENTREPRISES = '5eed0000-0000-4000-8000-000000000036'
const CHANNEL_PROSPECTION = '5eed0000-0000-4000-8000-000000000031'
/** Le seul channel du seed sans aucune affaire depuis `CRM-046` : il est ARCHIVÉ. */
const CHANNEL_APPELS_OFFRES = '5eed0000-0000-4000-8000-000000000033'
const ETAPE_PROSPECTION = '5eed0000-0000-4000-8000-000000000061'
const ETAPE_RELANCE = '5eed0000-0000-4000-8000-000000000062'
const CARD_ARCHIVEE = '5eed0000-0000-4000-8000-0000000000c8'
const CARD_CORBEILLE = '5eed0000-0000-4000-8000-0000000000c9'

const CARDS = '/rest/v1/cards'
const ETAPES = '/rest/v1/workflow_steps'

type CardLue = {
	id: string
	title: string
	amount: number | string | null
	currency: string
	next_action: string | null
	next_action_at: string | null
	current_step_id: string
	owner_id: string | null
	responsable: {
		id: string
		full_name: string
		avatar_url: string | null
	} | null
}

/**
 * Les cards **actives** de `grands-comptes`, telles que le §12.3 les demande.
 *
 * RÉVISÉ PAR `CRM-046` (décision 51) : trois devenues QUATRE — `…0cd` y occupe l'étape « Livré »,
 * dont la seule card était archivée, donc invisible de tout écran (docs/SPEC-seed.md §9.3). La
 * constante existe précisément pour que cette révision tienne en une ligne.
 */
const ACTIVES_GRANDS_COMPTES = 4

/** Les filtres d'activité, écrits une fois : ils sont la définition d'« active » du §5. */
const FILTRES_ACTIVES = 'archived_at=is.null&deleted_at=is.null'

/**
 * L'ordre TOTAL du §12.4, **tel que la webapp l'émet réellement** pour un tri par titre.
 *
 * `nullslast` figure sur chaque critère, `id` compris : le module pose une seule règle plutôt
 * qu'une exception pour les colonnes `NOT NULL`, où la clause est sans effet. Cette preuve emploie
 * la chaîne du produit, et non une variante équivalente qui ne prouverait rien de lui.
 */
const ORDRE_TITRE = 'order=title.asc.nullslast,id.asc.nullslast'

let jetonAdmin: string

test.beforeAll(async () => {
	jetonAdmin = await jetonDe('admin@p2enjoy.test')
})

// --- Ce que la liste lit (§12.3) --------------------------------------------------------------

test.describe('les deux lectures de la vue liste (§12.3)', () => {
	test('la page rapporte les colonnes du produit, et la pile les rend toutes', async ({ request }) => {
		const reponse = await request.get(
			`${CARDS}?select=${encodeURIComponent(COLONNES_CARD_LISTE)}` +
				`&channel_id=eq.${CHANNEL_GRANDS_COMPTES}&${FILTRES_ACTIVES}&${ORDRE_TITRE}`,
			{ headers: enTetesAuthentifies(jetonAdmin) },
		)
		expect(reponse.status()).toBe(200)
		const lignes = (await reponse.json()) as CardLue[]
		expect(lignes).toHaveLength(ACTIVES_GRANDS_COMPTES)
		for (const ligne of lignes) {
			// Chacune des colonnes scalaires demandées est présente, y compris celles qui valent `null` :
			// une colonne absente de la réponse et une colonne nulle ne se distinguent pas à l'œil.
			for (const colonne of [
				'id',
				'title',
				'amount',
				'currency',
				'next_action',
				'next_action_at',
				'current_step_id',
				'owner_id',
			]) {
				expect(Object.hasOwn(ligne, colonne)).toBe(true)
			}
			expect(Object.hasOwn(ligne, 'responsable')).toBe(true)
			if (ligne.owner_id === null) {
				expect(ligne.responsable).toBeNull()
			} else {
				expect(ligne.responsable?.id).toBe(ligne.owner_id)
				expect(ligne.responsable?.full_name.trim()).not.toBe('')
			}
		}
	})

	test('la lecture des étapes rend les sept étapes du workflow, pour le filtre et les badges', async ({
		request,
	}) => {
		const reponse = await request.get(
			`${ETAPES}?select=id,position&workflow_id=eq.${WORKFLOW_GLOBAL}&order=position`,
			{ headers: enTetesAuthentifies(jetonAdmin) },
		)
		expect(reponse.status()).toBe(200)
		const etapes = (await reponse.json()) as { id: string; position: number }[]
		expect(etapes).toHaveLength(7)
		expect(etapes.map((etape) => etape.position)).toEqual([1, 2, 3, 4, 5, 6, 7])
	})

	// CRM-022 clôt INC-014 : l'identité est demandée par jointure, tandis que les colonnes qui ne
	// sont jamais affichées restent absentes.
	test('la lecture embarque le responsable, sans colonne technique non affichée', () => {
		expect(COLONNES_CARD_LISTE).toContain('owner_id')
		expect(COLONNES_CARD_LISTE).toContain('responsable:profiles!cards_owner_id_fkey')
		for (const absente of ['position', 'description', 'health_score', 'search_tsv']) {
			expect(COLONNES_CARD_LISTE).not.toContain(absente)
		}
	})
})

// --- La définition d'« active » (§5) ----------------------------------------------------------

test.describe('l’exclusion des cards rangées (§5)', () => {
	test('les deux filtres d’activité sont appliqués côté serveur', async ({ request }) => {
		const reponse = await request.get(
			`${CARDS}?select=id&channel_id=eq.${CHANNEL_GRANDS_COMPTES}&${FILTRES_ACTIVES}`,
			{ headers: enTetesAuthentifies(jetonAdmin) },
		)
		const ids = ((await reponse.json()) as { id: string }[]).map((ligne) => ligne.id)
		expect(ids).toHaveLength(ACTIVES_GRANDS_COMPTES)
		expect(ids).not.toContain(CARD_ARCHIVEE)
		expect(ids).not.toContain(CARD_CORBEILLE)
	})

	// LA CONTRE-ÉPREUVE : sans les filtres, la même requête rend DEUX lignes de plus. Sans elle,
	// un filtre retiré passerait inaperçu — l'écran afficherait simplement deux affaires de plus.
	test('sans ces filtres, la même requête rend deux lignes de plus', async ({ request }) => {
		const reponse = await request.get(
			`${CARDS}?select=id&channel_id=eq.${CHANNEL_GRANDS_COMPTES}`,
			{ headers: enTetesAuthentifies(jetonAdmin) },
		)
		const ids = ((await reponse.json()) as { id: string }[]).map((ligne) => ligne.id)
		expect(ids).toHaveLength(ACTIVES_GRANDS_COMPTES + 2)
		expect(ids).toContain(CARD_ARCHIVEE)
		expect(ids).toContain(CARD_CORBEILLE)
	})
})

// --- Le tri (§12.4) ---------------------------------------------------------------------------

test.describe('le tri (§12.4)', () => {
	test('les quatre clés de tri sont acceptées par la pile, dans les deux sens', async ({ request }) => {
		for (const cle of ['title', 'amount', 'next_action_at', 'created_at']) {
			for (const sens of ['asc', 'desc']) {
				const reponse = await request.get(
					`${CARDS}?select=id&channel_id=eq.${CHANNEL_GRANDS_COMPTES}&${FILTRES_ACTIVES}` +
						`&order=${cle}.${sens}.nullslast,title.asc,id.asc`,
					{ headers: enTetesAuthentifies(jetonAdmin) },
				)
				expect(reponse.status(), `${cle}.${sens}`).toBe(200)
			}
		}
	})

	// La clôture du §12.2, vue de l'autre côté : une colonne inventée rend `400`. C'est
	// exactement ce que le repli des paramètres empêche d'atteindre.
	test('une colonne inventée est REFUSÉE par la pile, ce que le repli des paramètres empêche', async ({
		request,
	}) => {
		const reponse = await request.get(
			`${CARDS}?select=id&channel_id=eq.${CHANNEL_GRANDS_COMPTES}&order=couleur_preferee.asc`,
			{ headers: enTetesAuthentifies(jetonAdmin) },
		)
		expect(reponse.status()).toBe(400)
	})

	// MESURÉ : sans `nullslast`, une affaire SANS montant remonterait en tête d'un tri descendant.
	test('`nullslast` range l’affaire sans montant en dernier, tri descendant', async ({ request }) => {
		const reponse = await request.get(
			`${CARDS}?select=title,amount&channel_id=eq.${CHANNEL_INTER_ENTREPRISES}&${FILTRES_ACTIVES}` +
				`&order=amount.desc.nullslast,title.asc,id.asc`,
			{ headers: enTetesAuthentifies(jetonAdmin) },
		)
		const lignes = (await reponse.json()) as CardLue[]
		expect(lignes.length).toBeGreaterThanOrEqual(2)
		expect(lignes[0]?.amount).not.toBeNull()
		expect(lignes[lignes.length - 1]?.amount).toBeNull()
	})

	// La contre-épreuve du `nullslast` : sans lui, PostgreSQL range les `NULL` EN TÊTE d'un
	// tri descendant. C'est la mesure qui justifie la règle, pas une croyance.
	test('sans `nullslast`, la même requête remonte l’affaire sans montant en tête', async ({
		request,
	}) => {
		const reponse = await request.get(
			`${CARDS}?select=title,amount&channel_id=eq.${CHANNEL_INTER_ENTREPRISES}&${FILTRES_ACTIVES}` +
				`&order=amount.desc`,
			{ headers: enTetesAuthentifies(jetonAdmin) },
		)
		const lignes = (await reponse.json()) as CardLue[]
		expect(lignes[0]?.amount).toBeNull()
	})

	// L'ordre TOTAL du §12.4 : la même page demandée deux fois rend exactement la même chose.
	test('l’ordre total rend deux fois de suite la même page, à l’identique', async ({ request }) => {
		const adresse =
			`${CARDS}?select=id&channel_id=eq.${CHANNEL_GRANDS_COMPTES}&${FILTRES_ACTIVES}` +
			`&order=currency.asc.nullslast,title.asc,id.asc`
		const premiere = (await (
			await request.get(adresse, { headers: enTetesAuthentifies(jetonAdmin) })
		).json()) as { id: string }[]
		const seconde = (await (
			await request.get(adresse, { headers: enTetesAuthentifies(jetonAdmin) })
		).json()) as { id: string }[]
		expect(seconde.map((ligne) => ligne.id)).toEqual(premiere.map((ligne) => ligne.id))
	})

	// La propriété qui compte : une marche page par page ne rend AUCUN doublon, donc n'omet
	// aucune affaire. C'est ce que la sonde `sonde_l2` a mesuré faux sur un tri non total.
	test('une marche page par page ne rend aucun doublon', async ({ request }) => {
		const vus: string[] = []
		for (let rang = 0; rang < ACTIVES_GRANDS_COMPTES; rang += 1) {
			const reponse = await request.get(
				`${CARDS}?select=id&channel_id=eq.${CHANNEL_GRANDS_COMPTES}&${FILTRES_ACTIVES}` +
					`&order=currency.asc.nullslast,title.asc,id.asc`,
				{ headers: { ...enTetesAuthentifies(jetonAdmin), Range: `${rang}-${rang}` } },
			)
			const lignes = (await reponse.json()) as { id: string }[]
			expect(lignes).toHaveLength(1)
			vus.push(lignes[0]?.id ?? '')
		}
		expect(new Set(vus).size).toBe(ACTIVES_GRANDS_COMPTES)
	})
})

// --- Les filtres (§12.5) ----------------------------------------------------------------------

test.describe('les filtres (§12.5)', () => {
	test('le filtre par étape est appliqué côté serveur', async ({ request }) => {
		const reponse = await request.get(
			`${CARDS}?select=id,current_step_id&channel_id=eq.${CHANNEL_GRANDS_COMPTES}` +
				`&${FILTRES_ACTIVES}&current_step_id=eq.${ETAPE_RELANCE}&${ORDRE_TITRE}`,
			{ headers: enTetesAuthentifies(jetonAdmin) },
		)
		const lignes = (await reponse.json()) as CardLue[]
		expect(lignes).toHaveLength(2)
		expect(lignes.every((ligne) => ligne.current_step_id === ETAPE_RELANCE)).toBe(true)
	})

	test('une étape sans card rend zéro ligne, et non une erreur', async ({ request }) => {
		const reponse = await request.get(
			`${CARDS}?select=id&channel_id=eq.${CHANNEL_INTER_ENTREPRISES}&${FILTRES_ACTIVES}` +
				`&current_step_id=eq.${ETAPE_RELANCE}`,
			{ headers: enTetesAuthentifies(jetonAdmin) },
		)
		expect(reponse.status()).toBe(200)
		expect(await reponse.json()).toEqual([])
	})

	// `plfts` et non `ilike` : la colonne générée du §2.7 et son index GIN.
	test('la recherche plein texte trouve une affaire par un mot de son titre', async ({ request }) => {
		const reponse = await request.get(
			`${CARDS}?select=title&channel_id=eq.${CHANNEL_GRANDS_COMPTES}&${FILTRES_ACTIVES}` +
				`&search_tsv=plfts(french).refonte`,
			{ headers: enTetesAuthentifies(jetonAdmin) },
		)
		expect(reponse.status()).toBe(200)
		const lignes = (await reponse.json()) as CardLue[]
		expect(lignes.map((ligne) => ligne.title)).toEqual(['Refonte du site vitrine'])
	})

	// La racinisation française est le motif du `french` explicite : « sécurité » trouve
	// « sécurité », et un terme absent ne trouve rien.
	test('la recherche ne rend rien pour un terme absent', async ({ request }) => {
		const reponse = await request.get(
			`${CARDS}?select=title&channel_id=eq.${CHANNEL_GRANDS_COMPTES}&${FILTRES_ACTIVES}` +
				`&search_tsv=plfts(french).zzzintrouvable`,
			{ headers: enTetesAuthentifies(jetonAdmin) },
		)
		expect(reponse.status()).toBe(200)
		expect(await reponse.json()).toEqual([])
	})

	test('les deux filtres se combinent, et le total porte sur les lignes filtrées', async ({
		request,
	}) => {
		const reponse = await request.get(
			`${CARDS}?select=id&channel_id=eq.${CHANNEL_GRANDS_COMPTES}&${FILTRES_ACTIVES}` +
				`&current_step_id=eq.${ETAPE_PROSPECTION}&search_tsv=plfts(french).audit&${ORDRE_TITRE}`,
			{ headers: { ...enTetesAuthentifies(jetonAdmin), Prefer: 'count=exact', Range: '0-24' } },
		)
		expect(reponse.status()).toBe(200)
		expect(reponse.headers()['content-range']).toBe('0-0/1')
	})
})

// --- La pagination (§12.6) --------------------------------------------------------------------

test.describe('la pagination et son `416` (§12.6)', () => {
	const adresse =
		`${CARDS}?select=id&channel_id=eq.${CHANNEL_GRANDS_COMPTES}&${FILTRES_ACTIVES}&${ORDRE_TITRE}`

	test('une page partielle rend `206` et son `Content-Range`', async ({ request }) => {
		const reponse = await request.get(adresse, {
			headers: { ...enTetesAuthentifies(jetonAdmin), Prefer: 'count=exact', Range: '0-1' },
		})
		expect(reponse.status()).toBe(206)
		expect(reponse.headers()['content-range']).toBe(`0-1/${ACTIVES_GRANDS_COMPTES}`)
	})

	test('une page qui couvre tout rend `200` et le total complet', async ({ request }) => {
		const reponse = await request.get(adresse, {
			headers: {
				...enTetesAuthentifies(jetonAdmin),
				Prefer: 'count=exact',
				Range: `0-${LIGNES_PAR_PAGE - 1}`,
			},
		})
		expect(reponse.status()).toBe(200)
		expect(reponse.headers()['content-range']).toBe(
			`0-${ACTIVES_GRANDS_COMPTES - 1}/${ACTIVES_GRANDS_COMPTES}`,
		)
	})

	// LA FRONTIÈRE, mesurée à un rang près, et qui n'est écrite nulle part ailleurs.
	test('un rang ÉGAL au total rend encore `206`, sans erreur', async ({ request }) => {
		const reponse = await request.get(adresse, {
			headers: {
				...enTetesAuthentifies(jetonAdmin),
				Prefer: 'count=exact',
				Range: `${ACTIVES_GRANDS_COMPTES}-${ACTIVES_GRANDS_COMPTES}`,
			},
		})
		expect(reponse.status()).toBe(206)
		expect(reponse.headers()['content-range']).toBe(`*/${ACTIVES_GRANDS_COMPTES}`)
		expect(await reponse.json()).toEqual([])
	})

	test('le rang SUIVANT rend `416`, et son code est celui que le module reconnaît', async ({
		request,
	}) => {
		const reponse = await request.get(adresse, {
			headers: {
				...enTetesAuthentifies(jetonAdmin),
				Prefer: 'count=exact',
				Range: `${ACTIVES_GRANDS_COMPTES + 1}-${ACTIVES_GRANDS_COMPTES + 1}`,
			},
		})
		expect(reponse.status()).toBe(416)
		expect(reponse.headers()['content-range']).toBe(`*/${ACTIVES_GRANDS_COMPTES}`)
		expect(((await reponse.json()) as { code?: string }).code).toBe(CODE_PAGE_INEXISTANTE)
	})

	// MESURÉ : `count=planned` rend 1 là où la table en porte 4. Une pagination bâtie dessus
	// afficherait un nombre de pages qui n'existe pas (décision 187).
	test('`count=planned` est FAUX sur ce channel, ce qui justifie `count=exact`', async ({
		request,
	}) => {
		const planifie = await request.get(adresse, {
			headers: { ...enTetesAuthentifies(jetonAdmin), Prefer: 'count=planned', Range: '0-0' },
		})
		const exact = await request.get(adresse, {
			headers: { ...enTetesAuthentifies(jetonAdmin), Prefer: 'count=exact', Range: '0-0' },
		})
		const totalPlanifie = planifie.headers()['content-range']?.split('/')[1]
		const totalExact = exact.headers()['content-range']?.split('/')[1]
		expect(totalExact).toBe(String(ACTIVES_GRANDS_COMPTES))
		expect(totalPlanifie).not.toBe(totalExact)
	})

	// RÉVISÉ PAR `CRM-046`. Le scénario employait `prospection`, alors vide ; l'unité y a posé deux
	// cards pour que le workflow dérivé cesse d'être inexercé (docs/SPEC-seed.md §9.3), et
	// « aucun écran vide » interdit désormais qu'un channel ACTIF soit vide. Le seul channel du
	// seed sans affaire est donc `appels-offres`, ARCHIVÉ — il reste lisible par l'API, seule la
	// coquille le masque, et il rend exactement ce que le §12.6 attend d'un total nul.
	test('un channel sans affaire rend `200`, un total de zéro, et aucune erreur', async ({
		request,
	}) => {
		const reponse = await request.get(
			`${CARDS}?select=id&channel_id=eq.${CHANNEL_APPELS_OFFRES}&${FILTRES_ACTIVES}&${ORDRE_TITRE}`,
			{ headers: { ...enTetesAuthentifies(jetonAdmin), Prefer: 'count=exact', Range: '0-24' } },
		)
		expect(reponse.status()).toBe(200)
		expect(reponse.headers()['content-range']).toBe('*/0')
		expect(await reponse.json()).toEqual([])
	})
})

// --- Le refus opposé à l'anonyme (§7 de docs/SPEC-permissions-rls.md) -------------------------

test.describe('ce que la liste consent à un anonyme', () => {
	// D'ABORD constater que la table n'est PAS vide avec le jeton réel : sans quoi l'assertion
	// serait verte que la RLS refuse ou qu'elle autorise tout (décision 50).
	test('les deux lectures rendent des lignes à l’administratrice, et rien à l’anonyme', async ({
		request,
	}) => {
		const lectures = [
			`${CARDS}?select=id&channel_id=eq.${CHANNEL_GRANDS_COMPTES}&${FILTRES_ACTIVES}&${ORDRE_TITRE}`,
			`${ETAPES}?select=id&workflow_id=eq.${WORKFLOW_GLOBAL}&order=position`,
		]
		for (const adresse of lectures) {
			const avecJeton = await request.get(adresse, { headers: enTetesAuthentifies(jetonAdmin) })
			expect(avecJeton.status()).toBe(200)
			expect(((await avecJeton.json()) as unknown[]).length).toBeGreaterThan(0)

			const anonyme = await request.get(adresse, { headers: enTetesAnonymes() })
			expect(anonyme.status()).toBe(200)
			expect(await anonyme.json()).toEqual([])
		}
	})

	// Un refus par RLS n'est pas une erreur : il rend `200` et un total de ZÉRO, ce qui produit
	// l'état vide de l'écran et non son état d'erreur (§12.9).
	test('le total rendu à l’anonyme est zéro, pas une erreur', async ({ request }) => {
		const reponse = await request.get(
			`${CARDS}?select=id&channel_id=eq.${CHANNEL_GRANDS_COMPTES}&${FILTRES_ACTIVES}&${ORDRE_TITRE}`,
			{ headers: { ...enTetesAnonymes(), Prefer: 'count=exact', Range: '0-24' } },
		)
		expect(reponse.status()).toBe(200)
		expect(reponse.headers()['content-range']).toBe('*/0')
	})

	// L'anonyme n'obtient pas davantage par un filtre ou une recherche : la RLS juge la ligne,
	// pas la question posée.
	test('ni le filtre par étape ni la recherche n’ouvrent quoi que ce soit à l’anonyme', async ({
		request,
	}) => {
		for (const supplement of [
			`&current_step_id=eq.${ETAPE_RELANCE}`,
			'&search_tsv=plfts(french).refonte',
		]) {
			const reponse = await request.get(
				`${CARDS}?select=id&channel_id=eq.${CHANNEL_GRANDS_COMPTES}&${FILTRES_ACTIVES}${supplement}`,
				{ headers: enTetesAnonymes() },
			)
			expect(reponse.status()).toBe(200)
			expect(await reponse.json()).toEqual([])
		}
	})
})

// --- Ce que la mesure ajoute à INC-067 --------------------------------------------------------

test.describe('la représentation de `cards.amount` — INC-067', () => {
	// Le §12.11, point 5 : ce fichier **ne tranche pas** et ne modifie aucun comportement. Il
	// ajoute une mesure à une contradiction ouverte, et la fige pour que la bascule se voie.
	test('`amount` voyage en NOMBRE JSON, ce que la liste constate sans le trancher', async ({
		request,
	}) => {
		const reponse = await request.get(
			`${CARDS}?select=amount&channel_id=eq.${CHANNEL_GRANDS_COMPTES}&${FILTRES_ACTIVES}` +
				`&amount=not.is.null&${ORDRE_TITRE}`,
			{ headers: enTetesAuthentifies(jetonAdmin) },
		)
		const lignes = (await reponse.json()) as { amount: unknown }[]
		expect(lignes.length).toBeGreaterThan(0)
		for (const ligne of lignes) {
			expect(typeof ligne.amount).toBe('number')
		}
	})
})
