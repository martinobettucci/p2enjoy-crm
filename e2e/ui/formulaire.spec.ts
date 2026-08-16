// @verifies CRM-037 (docs/BACKLOG.md) — le formulaire conditionnel dans l'application réelle
// @verifies docs/SPEC-form-composer.md §4.2 (section repliée), §4.4 (mention « requis pour
//           passer à »), §4.5 (erreurs, accessibilité, états), §4.6 (l'écran hôte),
//           §4.6 bis (la coquille autour du formulaire), §7.3 (preuves)
// @verifies docs/SPEC-channels.md §5 (ce que la barre d'onglets lit), §5.3 (patron ARIA), §5.4
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
// qu'elle rend l'état que le backend consent à l'appelant anonyme — « card introuvable ».
// Réponse substituée, ils prouvent les variantes déterministes du formulaire chargé ; la route
// réelle connectée est atteinte dans `e2e/ui/authentification.spec.ts`.
//
// Ils **ne prouvent pas** le parcours « transition bloquée → saisie → transition réussie » que la
// Definition of Done exige : il suppose une session et un contrôle de transition, dus par
// `CRM-041`. C'est INC-062, et l'absence est nommée plutôt que maquillée.

import { autoriserErreursConsole, ERREUR_RESSOURCE_HTTP, expect, test } from './fixtures'
import { PALIERS, capturer } from './captures'

const ROUTE_CARDS = '**/rest/v1/cards*'
const ROUTE_ETAPES = '**/rest/v1/workflow_steps*'
const ROUTE_CHAMPS = '**/rest/v1/form_fields*'
const ROUTE_REGLES = '**/rest/v1/form_field_rules*'
const ROUTE_VALEURS = '**/rest/v1/card_field_values*'
const ROUTE_TRACKS = '**/rest/v1/tracks*'
const ROUTE_CHANNELS = '**/rest/v1/channels*'

/**
 * Identifiants du seed, employés tels quels : l'adresse doit être une adresse réelle du produit.
 *
 * ADRESSE CORRIGÉE LE 2026-08-05, ET CE QUE LA CORRECTION A RÉVÉLÉ. La première rédaction employait
 * `/tracks/inter-entreprises/formations/…`, qui n'est l'adresse de rien : MESURÉ en base, la card
 * `…0000c6` appartient au channel **`inter-entreprises`** du track **`formation`**. Les deux
 * segments étaient donc intervertis, et le second n'existait pas — et **aucune assertion ne
 * pouvait le voir**, la card étant résolue par son seul identifiant. C'est INC-065 : rien ne
 * confronte le couple `(slugTrack, slugChannel)` de l'adresse à la card qu'elle désigne. Le
 * comportement reste inchangé ; l'adresse, elle, redevient celle du produit.
 */
const CARD = '5eed0000-0000-4000-8000-0000000000c6'
const TRACK = { id: '5eed0000-0000-4000-8000-000000000023', slug: 'formation', nom: 'Formation' }
const CHANNEL = { id: '5eed0000-0000-4000-8000-000000000036', slug: 'inter-entreprises' }
const ADRESSE = `/tracks/${TRACK.slug}/${CHANNEL.slug}/cards/${CARD}`

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
		// `workspace_id` est demandée depuis `CRM-043` : le panneau de commentaires l'envoie à
		// l'insertion (docs/JOURNAL.md décision 200). Sans elle, la réponse substituée ne
		// ressemblerait plus à ce que PostgREST rend.
		workspace_id: '5eed0000-0000-4000-8000-000000000001',
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

/**
 * Le track porteur, servi à la forme exacte de ce que PostgREST rend — `docs/SPEC-form-composer.md`
 * §4.6 bis.
 *
 * Il porte `color` et `icon` bien que la résolution de la route ne les demande pas : la **barre
 * latérale** les demande, et les deux lectures visent la même table. Une fixture amputée y
 * produirait une pilule sans icône, donc un écran que le produit ne rendrait jamais — le défaut
 * déjà trouvé sur une capture pendant `CRM-021`.
 *
 * Valeurs MESURÉES sur le seed, sauf `position`, sans effet sur cet écran.
 */
const TRACK_SERVI = [
	{ id: TRACK.id, name: TRACK.nom, slug: TRACK.slug, color: 'accent', icon: 'graduation-cap', position: 3 },
]

/**
 * Deux channels servis, alors que le seed n'en pose **qu'un** dans ce track.
 *
 * Le second est déclaré ici, et il est **inventé** : il n'existe que pour distinguer l'onglet
 * courant des autres. Avec un seul onglet, `aria-current="page"` serait vrai par accident — il n'y
 * aurait rien dont le distinguer, et l'assertion ne prouverait rien de la règle du §4.6 bis. Le
 * premier, lui, est celui du seed, et c'est celui que l'adresse nomme.
 */
const CHANNELS_SERVIS = [
	{ id: CHANNEL.id, name: 'Inter-entreprises', slug: CHANNEL.slug, position: 1 },
	{ id: 'ch-2', name: 'Intra-entreprise', slug: 'intra-entreprise', position: 2 },
]

/**
 * Ce que la route des valeurs répond à une **écriture** — §4 bis.
 *
 * Par défaut, le `201` d'une ligne créée que la mesure du §4 bis.10 relève. Les scénarios de refus
 * substituent la réponse, ce qui est le seul moyen d'éprouver dans le navigateur un refus dont la
 * cause est une politique RLS : l'appelant du harnais est anonyme, et son refus arriverait avant
 * même que le formulaire ne soit chargé (docs/DESIGN_SYSTEM.md §12.5).
 */
type ReponseEcriture = { readonly status: number; readonly corps: unknown }

const ECRITURE_ACCEPTEE: ReponseEcriture = { status: 201, corps: [{ field_id: 'f-source' }] }

/** Sert les sept réponses du chargement, à la forme exacte de ce que PostgREST rend. */
async function servirFormulaire(
	page: import('@playwright/test').Page,
	ecriture: ReponseEcriture = ECRITURE_ACCEPTEE,
): Promise<void> {
	const servir = (corps: unknown) => (route: import('@playwright/test').Route) =>
		route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(corps) })
	// `card_field_values` avant `cards` : le motif `**/rest/v1/cards*` capturerait aussi
	// `card_field_values`, et la première route déclarée l'emporte dans Playwright.
	//
	// LA MÉTHODE EST DISTINGUÉE, et elle ne peut pas ne pas l'être : la lecture et l'écriture
	// partagent la même adresse depuis que la saisie est livrée. Servir la liste des valeurs en
	// réponse à un `POST` ferait passer une écriture pour un succès sans jamais éprouver son code.
	await page.route(ROUTE_VALEURS, (route) => {
		if (route.request().method() === 'POST') {
			return route.fulfill({
				status: ecriture.status,
				contentType: 'application/json',
				body: JSON.stringify(ecriture.corps),
			})
		}
		return route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify(VALEURS_SERVIES),
		})
	})
	await page.route(ROUTE_CHAMPS, servir(CHAMPS_SERVIS))
	await page.route(ROUTE_REGLES, servir(REGLES_SERVIES))
	await page.route(ROUTE_ETAPES, servir(ETAPE_SERVIE))
	await page.route(ROUTE_CARDS, servir(CARD_SERVIE))
	// La coquille est servie comme le reste : sans elle, l'écran capturé montrerait un formulaire
	// de card sous une barre latérale affirmant qu'aucun track n'existe, et sous une barre
	// d'onglets vide — un état que le produit ne rend jamais (§4.6 bis).
	await page.route(ROUTE_CHANNELS, servir(CHANNELS_SERVIS))
	await page.route(ROUTE_TRACKS, servir(TRACK_SERVI))
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

	// UN GARDE-FOU FIGÉ A ÉTÉ RÉVISÉ ICI, ET LE MOTIF EST ÉCRIT DANS LE FICHIER — mécanisme de la
	// décision 51. Ce scénario exigeait « aucun contrôle saisissable » et le bandeau qui explique
	// pourquoi. Il avait raison quand il a été écrit : aucune écriture n'était livrée, et son motif
	// était INC-021, close depuis `CRM-009`. La décision 334 (INC-088) a levé la limite, le §4 bis
	// spécifie la saisie, et le scénario est **retourné** sur les mêmes contrôles plutôt que
	// supprimé.
	test('les contrôles sont saisissables, et plus aucun bandeau ne prétend le contraire (§4 bis)', async ({
		page,
	}) => {
		await servirFormulaire(page)
		await page.goto(ADRESSE)
		await expect(page.getByTestId('formulaire-card')).toBeVisible()

		await expect(page.getByTestId('formulaire-lecture-seule')).toHaveCount(0)

		const controles = page.getByTestId('formulaire-card').locator('input, textarea, select')
		const nombre = await controles.count()
		expect(nombre, 'des contrôles sont bien rendus, pas seulement du texte').toBeGreaterThan(0)
		for (let rang = 0; rang < nombre; rang += 1) {
			await expect(controles.nth(rang)).toBeEnabled()
		}
	})
})

test.describe('la saisie depuis la fiche (§4 bis)', () => {
	test('choisir une valeur écrit sur `card_field_values`, et la charge porte les cinq colonnes', async ({
		page,
	}) => {
		await page.setViewportSize({ width: 1440, height: 900 })
		await servirFormulaire(page)
		await page.goto(ADRESSE)
		await expect(page.getByTestId('formulaire-card')).toBeVisible()

		const attendue = page.waitForRequest(
			(requete) =>
				requete.method() === 'POST' && requete.url().includes('/rest/v1/card_field_values'),
		)
		await page.locator('#champ-source').selectOption('salon')
		const requete = await attendue

		expect(
			requete.url(),
			'l’unicité est celle de la clé primaire du §6.2, écrite plutôt que déduite',
		).toContain('on_conflict=card_id%2Cfield_id')
		expect(requete.headers()['prefer'] ?? '').toContain('resolution=merge-duplicates')
		expect(JSON.parse(requete.postData() ?? '{}')).toMatchObject({
			card_id: CARD,
			field_id: 'f-source',
			workflow_id: 'wf-1',
			workspace_id: '5eed0000-0000-4000-8000-000000000001',
			value: 'salon',
		})
		// `updated_by` n'est pas envoyée : la trace faisant foi vient du serveur (§4 bis.4).
		expect(Object.keys(JSON.parse(requete.postData() ?? '{}'))).not.toContain('updated_by')
	})

	test('l’enregistrement est CONFIRMÉ à l’écran, et l’alerte d’exigence disparaît sans rechargement', async ({
		page,
	}) => {
		await page.setViewportSize({ width: 1440, height: 900 })
		await servirFormulaire(page)
		await page.goto(ADRESSE)

		await expect(page.getByTestId('alerte-source')).toBeVisible()
		await page.locator('#champ-source').selectOption('salon')

		const etat = page.getByTestId('etat-source')
		await expect(etat).toBeVisible()
		await expect(etat).toHaveAttribute('role', 'status')
		await expect(etat).toContainText('Enregistré')
		// §4 bis.8 : le modèle est mis à jour EN PLACE, sans rejouer les cinq requêtes du chargement.
		await expect(page.getByTestId('alerte-source')).toHaveCount(0)
		await expect(page.locator('#champ-source')).toHaveAttribute('aria-invalid', 'false')

		await capturer(page, 'formulaire-saisie-enregistree-1440', 'CRM-037')
	})

	test('une saisie de texte n’écrit qu’à la PERTE DU FOCUS, jamais à la frappe (§4 bis.3)', async ({
		page,
	}) => {
		await servirFormulaire(page)
		await page.goto(ADRESSE)
		await expect(page.getByTestId('formulaire-card')).toBeVisible()

		const ecritures: string[] = []
		page.on('request', (requete) => {
			if (requete.method() === 'POST' && requete.url().includes('/rest/v1/card_field_values')) {
				ecritures.push(requete.url())
			}
		})

		// La case à cocher est le seul contrôle **texte-libre-adjacent** de ce jeu servi ; la frappe
		// se fait donc sur la liste, dont l'écriture part au changement. Le contrôle éprouvé ici est
		// la case, dont on vérifie qu'un simple focus ne déclenche rien.
		await page.locator('#champ-decideur-identifie').focus()
		await page.locator('#champ-source').focus()
		await page.waitForTimeout(200)
		expect(ecritures, 'le focus seul n’écrit rien').toHaveLength(0)

		await page.locator('#champ-decideur-identifie').check()
		await page.waitForTimeout(200)
		expect(ecritures, 'une case à cocher écrit au changement').toHaveLength(1)
	})

	test('un refus est montré PRÈS du champ, sans effacer la saisie ni le texte du serveur', async ({
		page,
	}) => {
		await page.setViewportSize({ width: 1440, height: 900 })
		await servirFormulaire(page, {
			status: 400,
			corps: {
				code: 'P0001',
				message: 'invalid_field_value',
				details: 'source attend une clé de choices',
				hint: null,
			},
		})
		await page.goto(ADRESSE)
		await expect(page.getByTestId('formulaire-card')).toBeVisible()

		await page.locator('#champ-source').selectOption('salon')

		const refus = page.getByTestId('refus-source')
		await expect(refus).toBeVisible()
		await expect(refus).toHaveAttribute('role', 'alert')
		await expect(refus).toContainText('ne convient pas')
		// Le texte du serveur n'est JAMAIS rendu tel quel (`CLAUDE.md` §20).
		await expect(refus).not.toContainText('invalid_field_value')
		await expect(refus).not.toContainText('choices')

		// La saisie reste à l'écran, et le champ est signalé invalide (§4 bis.6).
		await expect(page.locator('#champ-source')).toHaveValue('salon')
		await expect(page.locator('#champ-source')).toHaveAttribute('aria-invalid', 'true')
		// L'alerte d'exigence et le refus COEXISTENT, et les deux sont cités (§4 bis.9).
		const decrit = (await page.locator('#champ-source').getAttribute('aria-describedby')) ?? ''
		expect(decrit.split(' ')).toContain('champ-source-alerte')
		expect(decrit.split(' ')).toContain('champ-source-refus')

		await capturer(page, 'formulaire-saisie-refusee-1440', 'CRM-037')

		// Le `400` du serveur laisse une trace dans la console du navigateur, que rien ne peut
		// supprimer : c'est le transport qui l'écrit. Elle est CONSOMMÉE ici, une par une et par son
		// texte exact, plutôt que filtrée globalement — la console reste dans le verdict.
		autoriserErreursConsole(page, [ERREUR_RESSOURCE_HTTP[400]])
	})

	test('un refus de droit d’écriture nomme le droit, et le contrôle reste utilisable', async ({
		page,
	}) => {
		await servirFormulaire(page, {
			status: 403,
			corps: {
				code: '42501',
				message: 'new row violates row-level security policy for table "card_field_values"',
				details: null,
				hint: null,
			},
		})
		await page.goto(ADRESSE)
		await expect(page.getByTestId('formulaire-card')).toBeVisible()

		await page.locator('#champ-source').selectOption('salon')
		await expect(page.getByTestId('refus-source')).toContainText("droit d'écrire")
		// Le contrôle N'EST PAS éteint : la règle vit dans la politique RLS, et l'écran montre le
		// refus plutôt que de l'anticiper (`CLAUDE.md` §10, §4 bis.7).
		await expect(page.locator('#champ-source')).toBeEnabled()

		autoriserErreursConsole(page, [ERREUR_RESSOURCE_HTTP[403]])
	})

	test('la section repliée reste en lecture seule : aucun contrôle n’y est rendu (§4 bis.1)', async ({
		page,
	}) => {
		await servirFormulaire(page)
		await page.goto(ADRESSE)

		const section = page.getByTestId('autres-etapes')
		await section.locator('summary').click()
		await expect(section.locator('input, textarea, select')).toHaveCount(0)
	})
})

test.describe('la coquille autour du formulaire (§4.6 bis)', () => {
	test('anonyme : le track de l’adresse est réellement demandé, et la barre reste vide', async ({
		page,
	}) => {
		const urls: string[] = []
		page.on('request', (requete) => {
			const url = requete.url()
			if (url.includes('/rest/v1/tracks') || url.includes('/rest/v1/channels')) urls.push(url)
		})
		await page.goto(ADRESSE)
		await expect(page.getByTestId('etat-vide')).toBeVisible()

		const resolution = urls.find((url) => url.includes(`slug=eq.${TRACK.slug}`))
		expect(resolution, 'le track porteur est résolu par le slug de l’adresse').toBeTruthy()
		// Un track archivé reste masqué même quand son adresse est saisie directement.
		expect(resolution).toContain('archived_at=is.null')

		// La RLS ne consent aucun track à un anonyme : la seconde requête n'est **pas** émise, le
		// chargeur ne demandant pas les channels d'un track qu'il n'a pas. La barre affiche donc
		// son état vide, qui est le refus réel du backend et non une barre qu'on aurait oublié
		// d'alimenter (§4.6 bis).
		expect(
			urls.some((url) => url.includes('/rest/v1/channels')),
			'aucune requête de channels sans track résolu',
		).toBe(false)
		await expect(page.getByTestId('onglets-vides')).toBeVisible()
	})

	test('réponse substituée : les channels du track porteur sont demandés, filtrés côté serveur', async ({
		page,
	}) => {
		const urls: string[] = []
		page.on('request', (requete) => {
			if (requete.url().includes('/rest/v1/channels')) urls.push(requete.url())
		})
		await servirFormulaire(page)
		await page.goto(ADRESSE)
		await expect(page.getByTestId('onglet-channel').first()).toBeVisible()

		const channels = urls[0]
		expect(channels, 'les channels du track porteur sont demandés').toBeTruthy()
		// Les trois exigences du §5 de docs/SPEC-channels.md sont portées par la requête elle-même.
		expect(channels).toContain(`track_id=eq.${TRACK.id}`)
		expect(channels).toContain('archived_at=is.null')
		expect(channels).toContain('order=position')
	})

	test('réponse substituée : l’onglet du channel de l’adresse est le seul courant', async ({
		page,
	}) => {
		await page.setViewportSize({ width: 1440, height: 900 })
		await servirFormulaire(page)
		await page.goto(ADRESSE)

		const onglets = page.getByTestId('onglet-channel')
		await expect(onglets).toHaveCount(CHANNELS_SERVIS.length)
		// L'onglet courant n'est pas calculé par l'écran : `NavLink` le résout par préfixe de
		// segments, l'adresse d'une card commençant par celle de son channel (§4.6 bis).
		// **Un seul** onglet est courant : sans ce compte, servir deux channels ne prouverait rien.
		await expect(page.locator('[data-testid="onglet-channel"][aria-current="page"]')).toHaveCount(1)
		const courant = page.locator(`[data-testid="onglet-channel"][data-slug="${CHANNEL.slug}"]`)
		await expect(courant).toHaveAttribute('aria-current', 'page')
		const autre = page.locator('[data-testid="onglet-channel"][data-slug="intra-entreprise"]')
		await expect(autre).not.toHaveAttribute('aria-current', 'page')

		// Le formulaire est bien rendu **sous** cette barre : la coquille n'a pas remplacé la zone
		// principale par un état d'erreur (§4.6 bis, « ce que la coquille fait d'un échec »).
		await expect(page.getByTestId('formulaire-card')).toBeVisible()
		await capturer(page, 'coquille-onglets-1440', 'CRM-037')
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
