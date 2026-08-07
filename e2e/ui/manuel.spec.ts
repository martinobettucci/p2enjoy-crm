// @verifies CRM-047 (docs/BACKLOG.md) — Definition of Done du manuel utilisateur du chunk 3
// @verifies docs/SPEC-manual.md §3.1 (les libellés cités sont les libellés réels), §5 (les huit
//           adresses du parcours et leur jeu de captures), §7.1 (preuve d'interface)
// @verifies docs/manual.md §3.1, §3.2, §3.5, §4.7, §4.8, §4.9, §4.10, §4.11
// @verifies docs/INCONSISTENCY_REPORT.md INC-077 (le neuvième type d'événement n'a aucun libellé)
// @verifies docs/DESIGN_SYSTEM.md §5.8 (états explicites), §12.5 (réponses substituées)
// @verifies CLAUDE.md §7 (documentation utilisateur), §16 (vérification visuelle)
//
// CE QUE CE FICHIER PROUVE, ET QU'AUCUN AUTRE NE PROUVE.
//
// Les autres preuves d'interface exercent une FONCTIONNALITÉ. Celle-ci exerce une PHRASE : chaque
// scénario ouvre une adresse que `docs/manual.md` cite, et exige que l'écran porte le libellé
// **exact** que le manuel promet à son lecteur. Un libellé qui change dans `webapp/src/i18n/fr.ts`
// rend donc le manuel ROUGE le jour du changement, au lieu de le rendre faux jusqu'à ce qu'un
// lecteur s'en aperçoive — ce qui est exactement arrivé au §4.7, qui annonçait « Affaire
// introuvable » là où l'écran dit « Card introuvable » (docs/SPEC-manual.md §6, écart n° 1).
//
// AUCUNE SUBSTITUTION SUR LES HUIT PARCOURS. Ils exercent volontairement le visiteur sans session
// et les refus réels que le manuel lui décrit. Les parcours connectés vivent dans la preuve de
// `CRM-011`, sans retirer la valeur de ces contre-épreuves anonymes.
//
// UNE SEULE EXCEPTION, NOMMÉE : le neuvième scénario substitue un événement `channel_changed`,
// parce que **rien d'autre ne peut le rendre visible** — le fil n'est jamais atteint par un
// anonyme. Il MESURE INC-077 plutôt que de la déduire de la lecture d'un fichier.

import { expect, test, type Page, type Route } from './fixtures'
import { capturer } from './captures'

const UNITE = 'CRM-047'

/** Identifiants du seed, employés tels quels : le manuel cite des adresses réelles du produit. */
const TRACK = 'conseil-ia'
const CHANNEL = 'grands-comptes'
const CARD = '5eed0000-0000-4000-8000-0000000000c3'

const etatVide = (page: Page) => page.getByTestId('etat-vide')

/**
 * Les libellés cités par `docs/manual.md`, recopiés ici **au caractère près**.
 *
 * Ils ne sont pas importés de `webapp/src/i18n/fr.ts` : importer la source ferait de ce fichier
 * une tautologie — il prouverait que l'application affiche ce que l'application déclare. Ce qui
 * est éprouvé ici est l'accord entre le PRODUIT et un TROISIÈME document, le manuel.
 */
const LIBELLES = {
	board: 'Aucun board à afficher',
	inbox: 'Aucun message',
	journee: 'Rien pour aujourd’hui',
	reglages: 'Aucun réglage modifiable',
	trackIntrouvable: 'Track introuvable',
	cardIntrouvable: 'Card introuvable',
	retour: "Revenir à l'accueil",
	tracksVides: 'Aucun track',
	onglets: 'Aucun channel',
	workspace: 'Aucun workspace accessible',
	evenementSansNom: 'Événement',
} as const

test.describe('le parcours que le manuel décrit, sans aucune substitution (docs/manual.md §3.2)', () => {
	test('l’accueil dit les trois refus que le manuel annonce (§3.1, §3.2)', async ({ page }) => {
		await page.setViewportSize({ width: 1440, height: 900 })
		await page.goto('/')

		await expect(etatVide(page)).toContainText(LIBELLES.board)
		await expect(page.getByTestId('tracks-vides')).toContainText(LIBELLES.tracksVides)
		await expect(page.getByTestId('barre-onglets')).toContainText(LIBELLES.onglets)
		await expect(page.getByTestId('workspace-absent')).toContainText(LIBELLES.workspace)

		// §3.5 : « Aucun … » n'est pas une erreur, et le manuel le dit. L'écran ne doit donc
		// afficher aucun état d'erreur en même temps.
		await expect(page.getByTestId('etat-erreur')).toHaveCount(0)

		await capturer(page, 'manuel-accueil-1440', UNITE)
	})

	for (const [chemin, libelle, capture] of [
		['/inbox', LIBELLES.inbox, 'manuel-inbox-1440'],
		['/ma-journee', LIBELLES.journee, 'manuel-ma-journee-1440'],
		['/reglages', LIBELLES.reglages, 'manuel-reglages-1440'],
	] as const) {
		test(`${chemin} rend l’état vide explicite que le manuel promet (§3.1)`, async ({ page }) => {
			await page.setViewportSize({ width: 1440, height: 900 })
			await page.goto(chemin)

			await expect(etatVide(page)).toContainText(libelle)
			await capturer(page, capture, UNITE)
		})
	}

	test('un track du seed est « Track introuvable » pour un anonyme (§3.2 ter)', async ({ page }) => {
		await page.setViewportSize({ width: 1440, height: 900 })
		await page.goto(`/tracks/${TRACK}`)

		await expect(etatVide(page)).toContainText(LIBELLES.trackIntrouvable)
		await expect(page.getByRole('link', { name: LIBELLES.retour })).toBeVisible()

		await capturer(page, 'manuel-track-1440', UNITE)
	})

	test('le tableau kanban n’est jamais atteint, et le manuel le dit (§4.8)', async ({ page }) => {
		await page.setViewportSize({ width: 1440, height: 900 })
		await page.goto(`/tracks/${TRACK}/${CHANNEL}`)

		await expect(etatVide(page)).toContainText(LIBELLES.trackIntrouvable)
		await expect(page.getByTestId('board')).toHaveCount(0)

		await capturer(page, 'manuel-board-1440', UNITE)
	})

	test('la vue liste non plus, pour la même cause (§4.9)', async ({ page }) => {
		await page.setViewportSize({ width: 1440, height: 900 })
		await page.goto(`/tracks/${TRACK}/${CHANNEL}/liste`)

		await expect(etatVide(page)).toContainText(LIBELLES.trackIntrouvable)
		await expect(page.getByRole('table')).toHaveCount(0)

		await capturer(page, 'manuel-liste-1440', UNITE)
	})

	test('la fiche d’une affaire dit « Card introuvable », et non « Affaire introuvable » (§4.7)', async ({
		page,
	}) => {
		await page.setViewportSize({ width: 1440, height: 900 })
		await page.goto(`/tracks/${TRACK}/${CHANNEL}/cards/${CARD}`)

		await expect(etatVide(page)).toContainText(LIBELLES.cardIntrouvable)

		// L'écart n° 1 des treize, figé par une preuve : le manuel a nommé pendant deux unités un
		// libellé que le produit n'affiche pas. Cette assertion interdit de l'y remettre.
		await expect(etatVide(page)).not.toContainText('Affaire introuvable')

		// Le fil n'est donc jamais atteint (§4.10, dernière phrase).
		await expect(page.getByRole('region', { name: 'Fil de cette affaire' })).toHaveCount(0)

		await capturer(page, 'manuel-fiche-1440', UNITE)
	})
})

test.describe('INC-077 — ce que le fil montre d’un changement de dossier', () => {
	const ROUTE_EVENEMENTS = '**/rest/v1/card_events*'
	const ROUTE_COMMENTAIRES = '**/rest/v1/card_comments*'
	const ROUTE_VALEURS = '**/rest/v1/card_field_values*'
	const ROUTE_CHAMPS = '**/rest/v1/form_fields*'
	const ROUTE_REGLES = '**/rest/v1/form_field_rules*'
	const ROUTE_ETAPES = '**/rest/v1/workflow_steps*'
	const ROUTE_CARDS = '**/rest/v1/cards*'
	const ROUTE_TRACKS = '**/rest/v1/tracks*'
	const ROUTE_CHANNELS = '**/rest/v1/channels*'

	const servir = (corps: unknown) => (route: Route) =>
		route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(corps) })

	/**
	 * Un seul événement, du neuvième type — celui que `CRM-045` écrit et que le fil ne sait pas
	 * nommer. Son `payload` porte les deux channels, exactement comme le trigger les écrit : la
	 * preuve porte donc sur ce que l'ÉCRAN en fait, pas sur ce qui lui est servi.
	 */
	const EVENEMENT_CHANGEMENT_DE_DOSSIER = [
		{
			id: 'ev-inc-077',
			card_id: CARD,
			type: 'channel_changed',
			actor_id: null,
			payload: {
				from_channel_id: '5eed0000-0000-4000-8000-000000000032',
				to_channel_id: '5eed0000-0000-4000-8000-000000000031',
			},
			created_at: '2026-08-05T13:00:00+00:00',
		},
	]

	test('un `channel_changed` s’affiche sous le libellé générique, sans nommer les dossiers', async ({
		page,
	}) => {
		await page.setViewportSize({ width: 1440, height: 900 })

		// `card_events` avant `cards` : le motif de `ROUTE_CARDS` capturerait aussi la première,
		// et Playwright retient la route déclarée en premier. Piège déjà rencontré par `CRM-037`,
		// `CRM-043` et `CRM-044`.
		await page.route(ROUTE_EVENEMENTS, servir(EVENEMENT_CHANGEMENT_DE_DOSSIER))
		await page.route(ROUTE_COMMENTAIRES, servir([]))
		await page.route(ROUTE_VALEURS, servir([]))
		await page.route(ROUTE_CHAMPS, servir([]))
		await page.route(ROUTE_REGLES, servir([]))
		await page.route(
			ROUTE_ETAPES,
			servir([{ id: 'etape-1', workflow_nodes_catalog: { label: 'Prospection' } }]),
		)
		await page.route(
			ROUTE_CARDS,
			servir([
				{
					id: CARD,
					title: 'Audit sécurité applicative',
					workflow_id: 'wf-1',
					workspace_id: '5eed0000-0000-4000-8000-000000000001',
					current_step_id: 'etape-1',
					email_local_part: 'c-t2dtpcjd',
				},
			]),
		)
		await page.route(
			ROUTE_TRACKS,
			servir([
				{
					id: '5eed0000-0000-4000-8000-000000000021',
					name: 'Conseil & IA',
					slug: TRACK,
					color: 'brand',
					icon: 'folder',
					position: 1,
				},
			]),
		)
		await page.route(
			ROUTE_CHANNELS,
			servir([
				{
					id: '5eed0000-0000-4000-8000-000000000032',
					name: 'Grands comptes',
					slug: CHANNEL,
					position: 2,
				},
			]),
		)

		await page.goto(`/tracks/${TRACK}/${CHANNEL}/cards/${CARD}`)

		const fil = page.getByRole('region', { name: 'Fil de cette affaire' })
		await expect(fil).toBeVisible()

		// MESURÉ, et non déduit : le fil affiche le repli générique. Le fait est là, son nom non.
		await expect(fil).toContainText(LIBELLES.evenementSansNom)

		// Ce que le manuel promettait avant `CRM-047`, et que le produit ne tient pas.
		await expect(fil).not.toContainText('changement de dossier')
		await expect(fil).not.toContainText('Grands comptes')
		await expect(fil).not.toContainText('Prospection')

		await capturer(page, 'manuel-evenement-sans-nom-1440', UNITE)
	})
})
