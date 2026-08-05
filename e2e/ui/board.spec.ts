// @verifies CRM-041 (docs/BACKLOG.md) — le board kanban dans l'application réelle
// @verifies docs/SPEC-workflow-engine.md §7.3 (colonnes), §7.4 (carte de card), §7.5 (menu),
//           §7.6 (glisser-déposer), §7.7 (clavier), §7.8 (motif exigé), §7.9 (optimisme et
//           retour arrière), §7.10 (refus), §7.11 (états, responsive, accessibilité), §7.14
// @verifies docs/DESIGN_SYSTEM.md §5.1 (carte), §5.2 (colonne), §7 (paliers), §8 (accessibilité),
//           §12.5 (réponses substituées), §12.6 (indication de débordement)
// @verifies CLAUDE.md §16 (vérification visuelle)
//
// Ces scénarios s'exécutent contre le **build de production** servi par `vite preview`, et contre
// la vraie API. Rien n'est simulé, sauf là où c'est explicitement dit — et alors c'est le
// **réseau** qui est manipulé, jamais un état interne de l'application (§12.5).
//
// CE QU'ILS PROUVENT, ET CE QU'ILS NE PROUVENT PAS.
//
// Le premier scénario n'emploie **aucune substitution** : l'anonyme demande réellement le track de
// l'adresse, n'obtient rien, et la route rend « track introuvable » — le refus réel du backend,
// mesuré par `e2e/api/board.spec.ts`. Le board ne s'affiche donc jamais en conditions réelles.
//
// Les suivants substituent les réponses réseau pour montrer ce que le §7 décrit : les colonnes,
// le menu, le dépôt autorisé, le dépôt refusé sans appel, le retour arrière, la saisie du motif.
// Ils **ne prouvent pas** qu'un utilisateur connecté déplace une affaire de bout en bout : cela
// suppose une session, et c'est INC-021. L'absence est nommée plutôt que maquillée.

import { expect, test, type Page, type Route } from '@playwright/test'
import { copyFileSync, mkdirSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { PALIERS, capturer } from './captures'

const ROUTE_CARDS = '**/rest/v1/cards*'
const ROUTE_ETAPES = '**/rest/v1/workflow_steps*'
const ROUTE_TRANSITIONS = '**/rest/v1/workflow_transitions*'
const ROUTE_CHAMPS = '**/rest/v1/form_fields*'
const ROUTE_TRACKS = '**/rest/v1/tracks*'
const ROUTE_CHANNELS = '**/rest/v1/channels*'
const ROUTE_WORKSPACES = '**/rest/v1/workspaces*'
const ROUTE_MOVE = '**/rest/v1/rpc/move_card'

/** Identifiants du seed, employés tels quels : l'adresse doit être une adresse réelle du produit. */
const TRACK = { id: '5eed0000-0000-4000-8000-000000000021', slug: 'conseil-ia', nom: 'Conseil IA' }
const CHANNEL = { id: '5eed0000-0000-4000-8000-000000000032', slug: 'grands-comptes' }
const WORKFLOW = '5eed0000-0000-4000-8000-000000000051'
const ADRESSE = `/tracks/${TRACK.slug}/${CHANNEL.slug}`

const PROSPECTION = '5eed0000-0000-4000-8000-000000000061'
const RELANCE = '5eed0000-0000-4000-8000-000000000062'
const NEGOCIATION = '5eed0000-0000-4000-8000-000000000063'
const PERDU = '5eed0000-0000-4000-8000-000000000067'

const CARD_C3 = '5eed0000-0000-4000-8000-0000000000c3'
const CARD_C1 = '5eed0000-0000-4000-8000-0000000000c1'

/**
 * Les cinq étapes servies, à la forme exacte de ce que PostgREST rend avec sa jointure embarquée.
 *
 * Cinq et non sept : `Signature` et `Livré` n'ajouteraient aucun cas à ce qui est éprouvé ici, et
 * un board de sept colonnes déborde de la capture à 900 px sans rien montrer de plus. `Perdu` est
 * conservée parce qu'elle porte les deux cas rares — aucune transition sortante, et aucun seuil de
 * relance.
 */
const ETAPES_SERVIES = [
	{
		id: PROSPECTION,
		position: 1,
		label_override: null,
		stale_after_days: null,
		workflow_nodes_catalog: {
			label: 'Prospection',
			color: 'neutral',
			kind: 'open',
			default_stale_after_days: 14,
		},
	},
	{
		id: RELANCE,
		position: 2,
		label_override: null,
		stale_after_days: null,
		workflow_nodes_catalog: {
			label: 'Relance',
			color: 'accent',
			kind: 'open',
			default_stale_after_days: 7,
		},
	},
	{
		id: NEGOCIATION,
		position: 3,
		label_override: null,
		stale_after_days: 5,
		workflow_nodes_catalog: {
			label: 'Négociation',
			color: 'brand',
			kind: 'open',
			default_stale_after_days: 10,
		},
	},
	{
		id: PERDU,
		position: 7,
		label_override: null,
		stale_after_days: null,
		workflow_nodes_catalog: {
			label: 'Perdu',
			color: 'danger',
			kind: 'lost',
			default_stale_after_days: null,
		},
	},
]

/** Le graphe servi est celui du seed, restreint aux étapes ci-dessus (mesuré le 2026-08-05). */
const TRANSITIONS_SERVIES = [
	{ id: 't1', from_step_id: PROSPECTION, to_step_id: RELANCE, label: 'Relancer', require_comment: false },
	{ id: 't2', from_step_id: PROSPECTION, to_step_id: PERDU, label: 'Marquer perdu', require_comment: true },
	{
		id: 't3',
		from_step_id: RELANCE,
		to_step_id: NEGOCIATION,
		label: 'Engager la négociation',
		require_comment: false,
	},
	{ id: 't4', from_step_id: RELANCE, to_step_id: PERDU, label: 'Marquer perdu', require_comment: true },
]

/**
 * Les trois cards actives de `grands-comptes`, telles que le seed les porte.
 *
 * `c3` est **ancienne de trente jours** ici, alors que le seed pose `entered_step_at` à `now()` :
 * c'est la seule façon d'exercer la bascule de la pastille d'ancienneté (§7.4), qu'aucune donnée
 * permanente ne démontre. Le fait est nommé, il n'est pas maquillé — et il appartient à `CRM-046`.
 */
const CARDS_SERVIES = [
	{
		id: CARD_C3,
		title: 'Audit sécurité applicative',
		position: 1,
		amount: 15500,
		currency: 'EUR',
		next_action: 'Premier appel de qualification',
		current_step_id: PROSPECTION,
		entered_step_at: new Date(Date.now() - 30 * 86400000).toISOString(),
		email_local_part: 'c-gbw6mh97',
	},
	{
		id: CARD_C1,
		title: 'Refonte du site vitrine',
		position: 1,
		amount: 48000,
		currency: 'EUR',
		next_action: 'Relancer la DSI après la démo',
		current_step_id: RELANCE,
		entered_step_at: new Date().toISOString(),
		email_local_part: 'c-0tkf9avr',
	},
	{
		id: '5eed0000-0000-4000-8000-0000000000c2',
		title: 'Migration ERP Sogexia',
		position: 2,
		amount: 125000,
		currency: 'EUR',
		next_action: 'Obtenir le cadrage technique',
		current_step_id: RELANCE,
		entered_step_at: new Date().toISOString(),
		email_local_part: 'c-ffw3mhw3',
	},
]

const CHAMPS_SERVIS = [
	{ key: 'lien-proposition', label: 'Lien vers la proposition' },
	{ key: 'budget', label: 'Budget estimé' },
]

const TRACK_SERVI = [
	{ id: TRACK.id, name: TRACK.nom, slug: TRACK.slug, color: 'brand', icon: 'folder', position: 1 },
]

/**
 * L'espace de travail du seed, servi lui aussi.
 *
 * Sans lui, la capture montrerait un board chargé sous un en-tête affirmant « Aucun workspace
 * accessible » — un écran que le produit ne rend jamais. C'est le défaut relevé sur une capture
 * pendant `CRM-021`, et corrigé pour la barre d'onglets par la décision 167 : une fixture amputée
 * produit une preuve visuelle qui ne prouve rien.
 */
const WORKSPACES_SERVIS = [
	{ id: '5eed0000-0000-4000-8000-000000000001', name: 'P2Enjoy', slug: 'p2enjoy' },
]

/** Deux channels : avec un seul onglet, l'onglet courant serait « courant » par accident. */
const CHANNELS_SERVIS = [
	{ id: CHANNEL.id, name: 'Grands comptes', slug: CHANNEL.slug, position: 1, workflow_id: WORKFLOW },
	{ id: 'ch-2', name: 'Appels d’offres', slug: 'appels-offres', position: 2, workflow_id: WORKFLOW },
]

const servir = (corps: unknown) => (route: Route) =>
	route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(corps) })

/**
 * Sert les six réponses du chargement, à la forme exacte de ce que PostgREST rend.
 *
 * `workflow_transitions` est déclarée **avant** `workflow_steps` : le motif des étapes ne
 * capturerait pas les transitions, mais l'inverse n'est pas vrai de tous les motifs — l'ordre
 * explicite évite d'avoir à le vérifier à chaque ajout. C'est la précaution déjà prise par
 * `e2e/ui/formulaire.spec.ts` entre `cards` et `card_field_values`.
 */
async function servirBoard(page: Page): Promise<void> {
	await page.route(ROUTE_TRANSITIONS, servir(TRANSITIONS_SERVIES))
	await page.route(ROUTE_ETAPES, servir(ETAPES_SERVIES))
	await page.route(ROUTE_CHAMPS, servir(CHAMPS_SERVIS))
	await page.route(ROUTE_CARDS, servir(CARDS_SERVIES))
	await page.route(ROUTE_CHANNELS, servir(CHANNELS_SERVIS))
	await page.route(ROUTE_TRACKS, servir(TRACK_SERVI))
	await page.route(ROUTE_WORKSPACES, servir(WORKSPACES_SERVIS))
}

/** Substitue la réponse de la garde. Le corps est un **objet**, non un tableau (§5.2). */
async function servirDeplacement(
	page: Page,
	reponse: { readonly ok: true; readonly card: unknown } | { readonly ok: false; readonly erreur: unknown },
	compteur?: { nombre: number },
): Promise<void> {
	await page.route(ROUTE_MOVE, (route) => {
		if (compteur !== undefined) compteur.nombre += 1
		if (reponse.ok) {
			void route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify(reponse.card),
			})
			return
		}
		void route.fulfill({
			status: 400,
			contentType: 'application/json',
			body: JSON.stringify(reponse.erreur),
		})
	})
}

const colonne = (page: Page, idEtape: string) => page.locator(`[data-testid="colonne"][data-etape="${idEtape}"]`)
const carte = (page: Page, idCard: string) => page.locator(`[data-testid="carte-card"][data-card="${idCard}"]`)

// --- Sans aucune substitution ----------------------------------------------------------------

test.describe('la route d’un channel, sans aucune substitution', () => {
	test('l’anonyme demande réellement le track de l’adresse et n’obtient aucun board', async ({
		page,
	}) => {
		// Le filtre `slug=` distingue la résolution de la route de la lecture de la barre latérale :
		// les deux visent `tracks`, et attendre « la première requête vers tracks » attraperait
		// celle de la coquille, qui ne porte aucun slug.
		const attendue = page.waitForRequest(
			(requete) => requete.url().includes('/rest/v1/tracks?') && requete.url().includes('slug='),
		)
		await page.setViewportSize({ width: 1440, height: 900 })
		await page.goto(ADRESSE)

		const url = new URL((await attendue).url())
		expect(url.searchParams.get('slug'), 'le track est résolu par son slug').toBe(`eq.${TRACK.slug}`)
		expect(url.searchParams.get('archived_at'), 'un track archivé n’est pas ouvert par son URL').toBe(
			'is.null',
		)

		// C'est le refus réel du backend, mesuré par e2e/api/board.spec.ts : la RLS rend `200` et
		// zéro ligne à un anonyme. Le board n'est jamais atteint (§7.12).
		await expect(page.getByTestId('etat-vide')).toContainText('Track introuvable')
		await expect(page.getByTestId('board')).toHaveCount(0)
		await capturer(page, 'board-anonyme-1440', 'CRM-041')
	})
})

// --- Réponses substituées (docs/DESIGN_SYSTEM.md §12.5) ---------------------------------------

test.describe('board chargé (réponse réseau substituée, docs/DESIGN_SYSTEM.md §12.5)', () => {
	test('une colonne par étape, y compris celles que personne n’occupe', async ({ page }) => {
		await page.setViewportSize({ width: 1440, height: 900 })
		await servirBoard(page)
		await page.goto(ADRESSE)

		await expect(page.getByTestId('board')).toBeVisible()
		await expect(page.getByTestId('colonne')).toHaveCount(4)
		await expect(colonne(page, PROSPECTION)).toContainText('Prospection')
		await expect(colonne(page, NEGOCIATION).getByTestId('colonne-vide')).toBeVisible()
		await expect(carte(page, CARD_C3)).toBeVisible()

		await capturer(page, 'board-charge-1440', 'CRM-041')
	})

	test('le board demande bien les quatre lectures du §7.2, filtrées', async ({ page }) => {
		const urls: string[] = []
		page.on('request', (requete) => urls.push(requete.url()))
		await servirBoard(page)
		await page.goto(ADRESSE)
		await expect(page.getByTestId('board')).toBeVisible()

		const cards = urls.find((url) => url.includes('/rest/v1/cards?'))
		expect(cards, 'les cards sont demandées').toBeDefined()
		const parametres = new URL(cards ?? '').searchParams
		expect(parametres.get('channel_id')).toBe(`eq.${CHANNEL.id}`)
		expect(parametres.get('archived_at'), 'une card archivée n’est pas une colonne du board').toBe(
			'is.null',
		)
		expect(parametres.get('deleted_at'), 'une card en corbeille non plus').toBe('is.null')

		const etapes = urls.find((url) => url.includes('/rest/v1/workflow_steps?'))
		expect(new URL(etapes ?? '').searchParams.get('workflow_id')).toBe(`eq.${WORKFLOW}`)
		expect(urls.some((url) => url.includes('/rest/v1/workflow_transitions?'))).toBe(true)
		expect(urls.some((url) => url.includes('/rest/v1/form_fields?'))).toBe(true)
	})

	test('la pastille d’ancienneté bascule au-delà du seuil, et disparaît sans seuil', async ({
		page,
	}) => {
		await servirBoard(page)
		await page.goto(ADRESSE)
		await expect(page.getByTestId('board')).toBeVisible()

		// `c3` est à trente jours dans une étape dont le seuil est de quatorze.
		await expect(carte(page, CARD_C3).getByTestId('anciennete')).toHaveAttribute(
			'data-depassee',
			'oui',
		)
		// `c1` vient d'entrer : la pastille est là, neutre.
		await expect(carte(page, CARD_C1).getByTestId('anciennete')).toHaveAttribute(
			'data-depassee',
			'non',
		)
	})

	test('le cumul d’une colonne s’affiche en donnée technique', async ({ page }) => {
		await servirBoard(page)
		await page.goto(ADRESSE)
		await expect(colonne(page, RELANCE).getByTestId('cumul-colonne')).toBeVisible()
		// 48 000 + 125 000 : le cumul porte sur la colonne, pas sur le board.
		await expect(colonne(page, RELANCE).getByTestId('cumul-colonne')).toContainText('173')
	})
})

test.describe('menu des transitions (§7.5, §7.7)', () => {
	test('liste exactement les transitions déclarées depuis l’étape de la card', async ({ page }) => {
		await page.setViewportSize({ width: 1440, height: 900 })
		await servirBoard(page)
		await page.goto(ADRESSE)

		await carte(page, CARD_C3).getByTestId('menu-transitions').click()
		const gestes = carte(page, CARD_C3).getByTestId('transition')
		await expect(gestes).toHaveCount(2)
		await expect(gestes.nth(0)).toHaveText('Relancer')
		await expect(gestes.nth(1)).toHaveText('Marquer perdu')

		await capturer(page, 'board-menu-ouvert-1440', 'CRM-041')
	})

	test('se referme par Échap, et rend le focus au bouton qui l’a ouvert', async ({ page }) => {
		await servirBoard(page)
		await page.goto(ADRESSE)
		const bouton = carte(page, CARD_C3).getByTestId('menu-transitions')
		await bouton.click()
		await expect(carte(page, CARD_C3).getByTestId('liste-transitions')).toBeVisible()
		await page.keyboard.press('Escape')
		await expect(carte(page, CARD_C3).getByTestId('liste-transitions')).toHaveCount(0)
		await expect(bouton).toBeFocused()
	})

	// Le déplacement au clavier que la Definition of Done exige : aucune souris n'est employée.
	test('déplace une affaire au clavier seul, et appelle la garde', async ({ page }) => {
		const compteur = { nombre: 0 }
		await servirBoard(page)
		await servirDeplacement(
			page,
			{ ok: true, card: { ...CARDS_SERVIES[0], current_step_id: RELANCE, position: 3 } },
			compteur,
		)
		await page.goto(ADRESSE)

		await carte(page, CARD_C3).getByTestId('menu-transitions').focus()
		await page.keyboard.press('Enter')
		await carte(page, CARD_C3).getByTestId('transition').first().focus()
		await page.keyboard.press('Enter')

		await expect(colonne(page, RELANCE).locator('[data-testid="carte-card"]')).toHaveCount(3)
		expect(compteur.nombre, 'la garde a bien été appelée une fois').toBe(1)
	})
})

test.describe('glisser-déposer (§7.6, §7.9)', () => {
	// Le dépôt autorisé, joué par une séquence de souris pas à pas : c'est celle qui produit une
	// vidéo exploitable, et elle a été MESURÉE pilotable avant d'être spécifiée (décision 170).
	test('un dépôt sur une colonne atteignable déplace l’affaire et appelle la garde', async ({
		page,
	}) => {
		const compteur = { nombre: 0 }
		await page.setViewportSize({ width: 1440, height: 900 })
		await servirBoard(page)
		await servirDeplacement(
			page,
			{ ok: true, card: { ...CARDS_SERVIES[0], current_step_id: RELANCE, position: 3 } },
			compteur,
		)
		await page.goto(ADRESSE)
		await expect(page.getByTestId('board')).toBeVisible()

		await carte(page, CARD_C3).dragTo(colonne(page, RELANCE))

		await expect(colonne(page, RELANCE).locator('[data-testid="carte-card"]')).toHaveCount(3)
		await expect(colonne(page, PROSPECTION).getByTestId('colonne-vide')).toBeVisible()
		expect(compteur.nombre).toBe(1)
		await capturer(page, 'board-apres-depot-1440', 'CRM-041')
	})

	// LA RÈGLE D'ORIGINE, RENDUE OPPOSABLE : « le glisser-déposer vers une colonne non atteignable
	// est refusé visuellement ET ne déclenche aucun appel ».
	test('un dépôt sur une colonne non atteignable n’émet aucun appel', async ({ page }) => {
		const compteur = { nombre: 0 }
		await servirBoard(page)
		await servirDeplacement(page, { ok: true, card: CARDS_SERVIES[0] }, compteur)
		await page.goto(ADRESSE)
		await expect(page.getByTestId('board')).toBeVisible()

		// Depuis `Prospection`, aucune transition ne mène à `Négociation` : la colonne n'est pas
		// une cible de dépôt, et le navigateur refuse le geste faute de `preventDefault`.
		await carte(page, CARD_C3).dragTo(colonne(page, NEGOCIATION))

		await expect(colonne(page, NEGOCIATION).getByTestId('colonne-vide')).toBeVisible()
		await expect(carte(page, CARD_C3)).toBeVisible()
		expect(compteur.nombre, 'aucun appel n’est émis vers la garde').toBe(0)
	})

	// LE REFUS VISUEL, ET C'EST UNE DÉGRADATION DU HARNAIS QUI A MONTRÉ QU'IL MANQUAIT. La preuve
	// ci-dessus ne constate que « aucun appel n'est émis » — or le composant porte DEUX gardes, une
	// sur `dragover` et une sur `drop`. Retirer la première laissait la preuve verte, la seconde
	// suffisant à empêcher l'appel : le harnais était complaisant sur la moitié « refusé
	// visuellement » de la règle d'origine. `data-survolee` est ce que la première garde contrôle,
	// et elle seule.
	test('seule une colonne atteignable se signale pendant le glissement', async ({ page }) => {
		await servirBoard(page)
		await page.goto(ADRESSE)
		await expect(page.getByTestId('board')).toBeVisible()

		const source = await carte(page, CARD_C3).boundingBox()
		const interdite = await colonne(page, NEGOCIATION).boundingBox()
		const permise = await colonne(page, RELANCE).boundingBox()

		await page.mouse.move((source?.x ?? 0) + 20, (source?.y ?? 0) + 20)
		await page.mouse.down()

		// Depuis `Prospection`, `Négociation` n'est reliée par aucune transition : elle ne doit
		// **jamais** se signaler comme zone de dépôt (docs/DESIGN_SYSTEM.md §5.2).
		//
		// TROIS MOUVEMENTS, ET C'EST MESURÉ. Un unique `mouse.move` qui **s'arrête** sur une colonne
		// n'y fait dispatcher aucun `dragover` par Chromium : compté, la colonne visée en recevait
		// **zéro** quand celle simplement traversée en recevait deux. La preuve était donc verte
		// sans rien mesurer. Le pointeur continue de bouger **à l'intérieur** de la colonne, ce qui
		// est aussi ce que fait une main.
		await page.mouse.move((interdite?.x ?? 0) + 40, (interdite?.y ?? 0) + 60, { steps: 12 })
		await page.mouse.move((interdite?.x ?? 0) + 60, (interdite?.y ?? 0) + 80, { steps: 6 })
		await page.mouse.move((interdite?.x ?? 0) + 80, (interdite?.y ?? 0) + 100, { steps: 6 })
		await expect(colonne(page, NEGOCIATION)).toHaveAttribute('data-atteignable', 'non')
		await expect(colonne(page, NEGOCIATION)).toHaveAttribute('data-survolee', 'non')

		// `Relance`, elle, l'est — et se signale. Même remarque sur le mouvement continu.
		await page.mouse.move((permise?.x ?? 0) + 40, (permise?.y ?? 0) + 60, { steps: 12 })
		await page.mouse.move((permise?.x ?? 0) + 60, (permise?.y ?? 0) + 80, { steps: 6 })
		await expect(colonne(page, RELANCE)).toHaveAttribute('data-atteignable', 'oui')
		await expect(colonne(page, RELANCE)).toHaveAttribute('data-survolee', 'oui')

		await page.mouse.up()
	})
})

test.describe('refus de la garde, et retour arrière (§7.9, §7.10)', () => {
	test('un refus replace l’affaire et affiche sa raison', async ({ page }) => {
		await page.setViewportSize({ width: 1440, height: 900 })
		await servirBoard(page)
		await servirDeplacement(page, {
			ok: false,
			erreur: { code: 'P0001', message: 'transition_not_allowed', details: null, hint: null },
		})
		await page.goto(ADRESSE)

		await carte(page, CARD_C3).dragTo(colonne(page, RELANCE))

		const alerte = page.getByTestId('refus-deplacement')
		await expect(alerte).toBeVisible()
		await expect(alerte).toHaveAttribute('role', 'alert')
		await expect(alerte).toHaveAttribute('data-cle', 'transition_not_allowed')
		// Retour arrière : la card est revenue dans sa colonne d'origine.
		await expect(colonne(page, PROSPECTION).locator('[data-testid="carte-card"]')).toHaveCount(1)
		await expect(colonne(page, RELANCE).locator('[data-testid="carte-card"]')).toHaveCount(2)

		await capturer(page, 'board-refus-1440', 'CRM-041')
	})

	test('les champs manquants sont nommés par leur libellé, pas par leur clé', async ({ page }) => {
		await page.setViewportSize({ width: 1440, height: 900 })
		await servirBoard(page)
		await servirDeplacement(page, {
			ok: false,
			erreur: {
				code: 'P0001',
				message: 'missing_required_fields',
				details: 'lien-proposition',
				hint: null,
			},
		})
		await page.goto(ADRESSE)

		await carte(page, CARD_C3).dragTo(colonne(page, RELANCE))
		await expect(page.getByTestId('champs-manquants')).toContainText('Lien vers la proposition')
		await capturer(page, 'board-champs-manquants-1440', 'CRM-041')
	})

	test('un refus inconnu n’est pas absorbé : le message brut est montré', async ({ page }) => {
		await servirBoard(page)
		await servirDeplacement(page, {
			ok: false,
			erreur: { code: 'P0001', message: 'un_refus_que_l_ecran_ignore', details: null, hint: null },
		})
		await page.goto(ADRESSE)

		await carte(page, CARD_C3).dragTo(colonne(page, RELANCE))
		await expect(page.getByTestId('refus-deplacement')).toHaveAttribute('data-cle', 'inconnu')
		await expect(page.getByTestId('refus-brut')).toHaveText('un_refus_que_l_ecran_ignore')
	})
})

test.describe('motif exigé (§7.8)', () => {
	test('le geste ouvre une saisie, la card ne bouge pas, et aucun appel n’est émis', async ({
		page,
	}) => {
		const compteur = { nombre: 0 }
		await page.setViewportSize({ width: 1440, height: 900 })
		await servirBoard(page)
		await servirDeplacement(page, { ok: true, card: CARDS_SERVIES[0] }, compteur)
		await page.goto(ADRESSE)

		await carte(page, CARD_C3).getByTestId('menu-transitions').click()
		await carte(page, CARD_C3).getByTestId('transition').nth(1).click()

		await expect(page.getByTestId('saisie-motif')).toBeVisible()
		await expect(colonne(page, PROSPECTION).locator('[data-testid="carte-card"]')).toHaveCount(1)
		expect(compteur.nombre, 'rien n’est appelé tant que le motif manque').toBe(0)

		await capturer(page, 'board-motif-exige-1440', 'CRM-041')
	})

	test('le motif saisi part avec l’appel', async ({ page }) => {
		let corps: unknown = null
		await servirBoard(page)
		await page.route(ROUTE_MOVE, (route) => {
			corps = route.request().postDataJSON()
			void route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ ...CARDS_SERVIES[0], current_step_id: PERDU }),
			})
		})
		await page.goto(ADRESSE)

		await carte(page, CARD_C3).getByTestId('menu-transitions').click()
		await carte(page, CARD_C3).getByTestId('transition').nth(1).click()
		await page.getByTestId('champ-motif').fill('Budget gelé jusqu’au prochain exercice.')
		await page.getByTestId('valider-motif').click()

		await expect(colonne(page, PERDU).locator('[data-testid="carte-card"]')).toHaveCount(1)
		expect(corps).toMatchObject({
			card_id: CARD_C3,
			to_step_id: PERDU,
			comment: 'Budget gelé jusqu’au prochain exercice.',
		})
	})
})

// --- Paliers responsive (docs/DESIGN_SYSTEM.md §7) --------------------------------------------

test.describe('paliers responsive (docs/DESIGN_SYSTEM.md §7)', () => {
	for (const palier of PALIERS) {
		test(`${palier.nom} : le board défile dans son conteneur, jamais la page`, async ({ page }) => {
			await page.setViewportSize({ width: palier.largeur, height: palier.hauteur })
			await servirBoard(page)
			await page.goto(ADRESSE)
			await expect(page.getByTestId('board')).toBeVisible()

			// La page ne défile jamais horizontalement (§7) : c'est le conteneur du board qui le
			// fait, et il porte l'indication de débordement du §12.6.
			const debordePage = await page.evaluate(
				() => document.documentElement.scrollWidth > document.documentElement.clientWidth,
			)
			expect(debordePage, 'la page ne défile pas horizontalement').toBe(false)
			await expect(page.getByTestId('board')).toHaveClass(/indique-debordement-x/)

			await capturer(page, `board-${palier.nom}`, 'CRM-041')
		})
	}
})

// --- Vidéo du glisser-déposer (Definition of Done de `CRM-041`) --------------------------------

/**
 * La vidéo `.webm` que la Definition of Done exige.
 *
 * Elle est **enregistrée délibérément**, et non récupérée d'un échec : la configuration du harnais
 * conserve les vidéos `retain-on-failure`, ce qui n'en produit aucune quand tout va bien. Le
 * contexte est donc créé ici avec `recordVideo`, et le fichier est copié dans
 * `docs/captures/CRM-041/` — la même destination que les captures.
 *
 * Le geste est joué **pas à pas** à la souris, et non par `dragTo` : mesuré, `dragTo` saute d'un
 * point à l'autre et la vidéo ne montrerait rien du déplacement (décision 170).
 */
test.describe('vidéo du glisser-déposer', () => {
	test('le geste est enregistré et déposé dans les captures de l’unité', async ({ browser }, infos) => {
		const dossier = join(infos.outputDir, 'video-board')
		const contexte = await browser.newContext({
			viewport: { width: 1440, height: 900 },
			recordVideo: { dir: dossier, size: { width: 1440, height: 900 } },
		})
		const page = await contexte.newPage()
		await servirBoard(page)
		await servirDeplacement(page, {
			ok: true,
			card: { ...CARDS_SERVIES[0], current_step_id: RELANCE, position: 3 },
		})
		await page.goto(ADRESSE)
		await expect(page.getByTestId('board')).toBeVisible()

		const source = await carte(page, CARD_C3).boundingBox()
		const cible = await colonne(page, RELANCE).boundingBox()
		await page.mouse.move((source?.x ?? 0) + 40, (source?.y ?? 0) + 24)
		await page.mouse.down()
		await page.mouse.move((source?.x ?? 0) + 80, (source?.y ?? 0) + 40, { steps: 10 })
		await page.mouse.move((cible?.x ?? 0) + 100, (cible?.y ?? 0) + 120, { steps: 25 })
		await page.mouse.move((cible?.x ?? 0) + 120, (cible?.y ?? 0) + 160, { steps: 10 })
		await page.mouse.up()

		await expect(colonne(page, RELANCE).locator('[data-testid="carte-card"]')).toHaveCount(3)
		await page.waitForTimeout(500)
		await contexte.close()

		const enregistre = readdirSync(dossier).find((nom) => nom.endsWith('.webm'))
		expect(enregistre, 'une vidéo .webm a bien été enregistrée').toBeDefined()
		const destination = join(dirname(dirname(import.meta.dirname)), 'docs', 'captures', 'CRM-041')
		mkdirSync(destination, { recursive: true })
		copyFileSync(join(dossier, enregistre ?? ''), join(destination, 'glisser-deposer.webm'))
	})
})
