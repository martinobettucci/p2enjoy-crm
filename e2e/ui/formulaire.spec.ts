// @verifies CRM-037 (docs/BACKLOG.md) — le formulaire conditionnel dans l'application réelle
// @verifies docs/SPEC-form-composer.md §4.2 (section repliée), §4.4 (mention « requis pour
//           passer à »), §4.5 (erreurs, accessibilité, états), §4.6 (l'écran hôte), §7.3 (preuves)
// @verifies docs/DESIGN_SYSTEM.md §5.7 (champs de formulaire), §5.8 (états), §7 (paliers),
//           §8 (accessibilité) ; CLAUDE.md §16 (vérification visuelle)
//
// Ces scénarios s'exécutent contre le **build de production** servi par `vite preview`, et contre
// la vraie API. Rien n'est simulé, sauf là où c'est explicitement dit — et alors c'est le
// **réseau** qui est manipulé, jamais un état interne de l'application
// (docs/DESIGN_SYSTEM.md §12.5).
//
// CE QU'ILS PROUVENT, ET CE QU'ILS NE PROUVENT PAS.
//
// Ils prouvent que la route du §4.6 existe, qu'elle interroge réellement `public.cards`, et
// qu'elle rend l'état que le backend lui consent — c'est-à-dire « card introuvable », la webapp
// étant un appelant anonyme (INC-021). Réponse substituée, ils prouvent que le formulaire chargé
// affiche ce que le §4 décrit.
//
// Ils **ne prouvent pas** le parcours « transition bloquée → saisie → transition réussie » que la
// Definition of Done exige : il suppose une session et un contrôle de transition, dus par
// `CRM-041`. C'est INC-062, et l'absence est nommée plutôt que maquillée.

import { expect, test } from '@playwright/test'
import { PALIERS, capturer } from './captures'

const ROUTE_CARDS = '**/rest/v1/cards*'
const ROUTE_ETAPES = '**/rest/v1/workflow_steps*'
const ROUTE_CHAMPS = '**/rest/v1/form_fields*'
const ROUTE_REGLES = '**/rest/v1/form_field_rules*'
const ROUTE_VALEURS = '**/rest/v1/card_field_values*'

/** Identifiants du seed, employés tels quels : l'adresse doit être une adresse réelle du produit. */
const CARD = '5eed0000-0000-4000-8000-0000000000c6'
const ADRESSE = `/tracks/inter-entreprises/formations/cards/${CARD}`

/**
 * Le jeu servi reprend **la card `…0000c6` du seed, à l'étape `Prospection`** : `source` y est
 * `required` et vide, `motif-perte` y est `hidden` et porte pourtant une valeur, et
 * `decideur-identifie` n'a aucune règle. Les trois destinations du §4.2 sont donc exercées par
 * des données que le produit porte réellement.
 */
const ETAPE = { id: 'etape-1', label: 'Prospection' }

const CARD_SERVIE = [
	{
		id: CARD,
		title: 'Piste entrante à qualifier',
		workflow_id: 'wf-1',
		current_step_id: ETAPE.id,
		email_local_part: 'c-t2dtpcjd',
	},
]

const ETAPE_SERVIE = [{ id: ETAPE.id, workflow_nodes_catalog: { label: ETAPE.label } }]

const CHAMPS_SERVIS = [
	{
		id: 'f-budget',
		key: 'budget',
		label: 'Budget estimé',
		type: 'money',
		position: 1,
		options: { currency: 'EUR', min: 0 },
		help_text: 'Montant hors taxes, en euros.',
		archived_at: null,
	},
	{
		id: 'f-source',
		key: 'source',
		label: 'Origine du contact',
		type: 'select',
		position: 2,
		options: {
			choices: [
				{ key: 'salon', label: 'Salon' },
				{ key: 'recommandation', label: 'Recommandation' },
				{ key: 'site', label: 'Site web' },
			],
		},
		help_text: null,
		archived_at: null,
	},
	{
		id: 'f-motif',
		key: 'motif-perte',
		label: 'Motif de la perte',
		type: 'textarea',
		position: 4,
		options: {},
		help_text: null,
		archived_at: null,
	},
	{
		id: 'f-decideur',
		key: 'decideur-identifie',
		label: 'Décideur identifié',
		type: 'checkbox',
		position: 5,
		options: {},
		help_text: null,
		archived_at: null,
	},
	{
		id: 'f-previsionnel',
		key: 'budget-previsionnel',
		label: 'Budget prévisionnel',
		type: 'number',
		position: 7,
		options: {},
		help_text: null,
		archived_at: '2026-08-03T00:00:00Z',
	},
]

const REGLES_SERVIES = [
	{ field_id: 'f-budget', step_id: ETAPE.id, visibility: 'hidden' },
	{ field_id: 'f-source', step_id: ETAPE.id, visibility: 'required' },
	{ field_id: 'f-motif', step_id: ETAPE.id, visibility: 'hidden' },
]

const VALEURS_SERVIES = [
	{ field_id: 'f-motif', value: 'Budget gelé jusqu’au prochain exercice.' },
	{ field_id: 'f-previsionnel', value: 72000 },
]

/** Sert les cinq réponses du chargement, à la forme exacte de ce que PostgREST rend. */
async function servirFormulaire(page: import('@playwright/test').Page): Promise<void> {
	const servir = (corps: unknown) => (route: import('@playwright/test').Route) =>
		route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(corps) })
	// `card_field_values` avant `cards` : le motif `**/rest/v1/cards*` capturerait aussi
	// `card_field_values`, et la première route déclarée l'emporte dans Playwright.
	await page.route(ROUTE_VALEURS, servir(VALEURS_SERVIES))
	await page.route(ROUTE_CHAMPS, servir(CHAMPS_SERVIS))
	await page.route(ROUTE_REGLES, servir(REGLES_SERVIES))
	await page.route(ROUTE_ETAPES, servir(ETAPE_SERVIE))
	await page.route(ROUTE_CARDS, servir(CARD_SERVIE))
}

test.describe('la route de détail interroge réellement `cards`', () => {
	test('une requête part vers `/rest/v1/cards`, filtrée sur l’identifiant', async ({ page }) => {
		const attendue = page.waitForRequest((requete) => requete.url().includes('/rest/v1/cards?'))
		await page.goto(ADRESSE)
		const url = new URL((await attendue).url())
		expect(url.searchParams.get('id'), 'la card est désignée par son identifiant (§4.6)').toBe(
			`eq.${CARD}`,
		)
		expect(
			url.searchParams.get('deleted_at'),
			'une card en corbeille n’est pas ouverte par son adresse',
		).toBe('is.null')
	})

	test('l’appelant anonyme n’obtient aucune card, et l’écran le dit', async ({ page }) => {
		await page.setViewportSize({ width: 1440, height: 900 })
		await page.goto(ADRESSE)
		// C'est le refus réel du backend, mesuré par e2e/api/cards.spec.ts : la RLS rend `200` et
		// zéro ligne à un anonyme. L'écran ne prétend ni à une erreur, ni à une page blanche.
		await expect(page.getByTestId('etat-vide')).toBeVisible()
		await expect(page.getByTestId('etat-vide')).toContainText('Card introuvable')
		await capturer(page, 'card-introuvable-1440', 'CRM-037')
	})
})

test.describe('formulaire chargé (réponse réseau substituée, docs/DESIGN_SYSTEM.md §12.5)', () => {
	test('les champs de l’étape sont rendus, ordonnés, et les masqués sont absents', async ({
		page,
	}) => {
		await page.setViewportSize({ width: 1440, height: 900 })
		await servirFormulaire(page)
		await page.goto(ADRESSE)

		await expect(page.getByTestId('formulaire-card')).toBeVisible()
		await expect(page.getByTestId('formulaire-card')).toContainText('Prospection')
		// `source` est affiché ; `decideur-identifie`, sans aucune règle, l'est aussi par le défaut
		// du §3.1 — c'est le cas que le seed exerce réellement.
		await expect(page.getByTestId('champ-source')).toBeVisible()
		await expect(page.getByTestId('champ-decideur-identifie')).toBeVisible()
		// `budget` et `motif-perte` sont `hidden` à cette étape.
		await expect(page.getByTestId('champ-budget')).toHaveCount(0)
		await expect(page.getByTestId('champ-motif-perte')).toHaveCount(0)

		await capturer(page, 'formulaire-charge-1440', 'CRM-037')
	})

	test('un champ exigé et vide porte sa mention, son alerte et son état invalide', async ({
		page,
	}) => {
		await servirFormulaire(page)
		await page.goto(ADRESSE)

		await expect(page.getByTestId('requis-source')).toContainText('Requis pour passer à')
		await expect(page.getByTestId('requis-source')).toContainText('Prospection')

		const alerte = page.getByTestId('alerte-source')
		await expect(alerte).toBeVisible()
		await expect(alerte).toHaveAttribute('role', 'alert')

		const controle = page.locator('#champ-source')
		await expect(controle).toHaveAttribute('aria-invalid', 'true')
		const decrit = (await controle.getAttribute('aria-describedby')) ?? ''
		expect(decrit.split(' '), 'l’alerte est citée par aria-describedby (§4.5)').toContain(
			'champ-source-alerte',
		)

		await capturer(page, 'formulaire-champ-requis-1440', 'CRM-037')
	})

	test('la section repliée s’ouvre au clavier et montre la valeur d’une autre étape', async ({
		page,
	}) => {
		await page.setViewportSize({ width: 1440, height: 900 })
		await servirFormulaire(page)
		await page.goto(ADRESSE)

		const section = page.getByTestId('autres-etapes')
		await expect(section).toBeVisible()
		expect(await section.evaluate((element) => (element as HTMLDetailsElement).open)).toBe(false)

		// Ouverture **au clavier**, sans souris : docs/DESIGN_SYSTEM.md §8 exige que tout soit
		// atteignable et actionnable sans souris.
		await section.locator('summary').focus()
		await page.keyboard.press('Enter')
		expect(await section.evaluate((element) => (element as HTMLDetailsElement).open)).toBe(true)

		await expect(page.getByTestId('autre-motif-perte')).toContainText('Budget gelé')
		// Le champ archivé porteur d'une valeur y figure aussi (§4.2), et nulle part ailleurs.
		await expect(page.getByTestId('autre-budget-previsionnel')).toContainText('72000')
		await expect(page.getByTestId('champ-budget-previsionnel')).toHaveCount(0)

		await capturer(page, 'formulaire-autres-etapes-1440', 'CRM-037')
	})

	test('aucun contrôle n’est saisissable, et l’écran explique pourquoi (§4.7)', async ({ page }) => {
		await servirFormulaire(page)
		await page.goto(ADRESSE)

		await expect(page.getByTestId('formulaire-lecture-seule')).toContainText('session')

		const controles = page.getByTestId('formulaire-card').locator('input, textarea, select')
		const nombre = await controles.count()
		expect(nombre, 'des contrôles sont bien rendus, pas seulement du texte').toBeGreaterThan(0)
		for (let rang = 0; rang < nombre; rang += 1) {
			await expect(controles.nth(rang)).toBeDisabled()
		}
	})
})

test.describe('paliers responsive (docs/DESIGN_SYSTEM.md §7)', () => {
	for (const palier of PALIERS) {
		test(`${palier.nom} : le formulaire tient sans faire défiler la page horizontalement`, async ({
			page,
		}) => {
			await page.setViewportSize({ width: palier.largeur, height: palier.hauteur })
			await servirFormulaire(page)
			await page.goto(ADRESSE)
			await expect(page.getByTestId('formulaire-card')).toBeVisible()

			const debordement = await page.evaluate(
				() => document.documentElement.scrollWidth > document.documentElement.clientWidth,
			)
			expect(debordement, 'docs/DESIGN_SYSTEM.md §7 : la page ne défile jamais horizontalement').toBe(
				false,
			)

			await capturer(page, `formulaire-${palier.nom}`, 'CRM-037')
		})
	}
})
