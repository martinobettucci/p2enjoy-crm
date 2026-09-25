// @verifies CRM-047 (docs/BACKLOG.md) — Definition of Done du manuel utilisateur du chunk 3
// @verifies docs/SPEC-manual.md §3.1 (les libellés cités sont les libellés réels), §5 (les huit
//           adresses du parcours et leur jeu de captures), §7.1 (preuve d'interface)
// @verifies docs/manual.md §3.1, §3.2, §3.5, §4.7, §4.8, §4.9, §4.10, §4.11
// @verifies docs/INCONSISTENCY_REPORT.md INC-077 (le changement de dossier est désormais nommé)
// @verifies docs/DESIGN_SYSTEM.md §5.8 (états explicites), §12.5 (réponses substituées)
// @verifies CLAUDE.md §7 (documentation utilisateur), §16 (vérification visuelle)
// @verifies CRM-092 (docs/BACKLOG.md) tranche T9 — docs/SPEC-session-sso.md §8.7 : ces scénarios se
//           connectent, aucune page n'étant rendue sans session (docs/JOURNAL.md décision 601)
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
// AUCUNE SUBSTITUTION SUR LES HUIT PARCOURS. Ils exerçaient le visiteur sans session et les refus
// réels que le manuel lui décrivait ; depuis `CRM-092` T9, aucun visiteur sans session n'atteint
// ces adresses, et le manuel le dit. Ils exercent donc la session réelle de la LECTRICE du jeu de
// démonstration, et les refus réels que le manuel décrit pour un compte : un track ou une card
// qu'il ne peut pas lire.
//
// UNE SEULE EXCEPTION, NOMMÉE : le neuvième scénario substitue un événement `channel_changed`,
// parce que **rien d'autre ne peut le rendre visible** — la lectrice n'atteint pas le fil de cette
// card. Il MESURE la clôture d'INC-077 plutôt que de la déduire de la lecture d'un fichier.

import {
	connecterAvecLeLabs,
	expect,
	test,
	type Page,
	type Route,
} from './fixtures'
import { capturer } from './captures'

// RÉVISÉ PAR `CRM-092` T9 (docs/SPEC-session-sso.md §8.7, décision 601) : sans session, aucune page de
// l'application n'est rendue. Ces scénarios, écrits pour un visiteur anonyme à réponses substituées, se
// connectent d'abord — comme LECTRICE, le profil le plus proche de l'anonyme qu'ils supposaient :
// aucun geste d'écriture ne lui est offert.
test.beforeEach(async ({ page }) => {
	await connecterAvecLeLabs(page, 'viewer@p2enjoy.test')
})

const UNITE = 'CRM-047'

/** Identifiants du seed, employés tels quels : le manuel cite des adresses réelles du produit. */
const TRACK = 'conseil-ia'
/** Un track qu'aucune ligne ne porte : même écran qu'un track non consenti (docs/manual.md §3.2 ter). */
const TRACK_INEXISTANT = 'ce-track-nexiste-pas'
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
	// RÉVISÉ PAR `CRM-092` T9 : les libellés des vides anonymes (« Aucune échéance dans votre
	// journée », « Accès refusé », « Aucun track »…) quittent cette liste avec les parcours anonymes ;
	// ceux-ci sont ceux que le manuel cite pour un compte connecté.
	nonClasses: 'Non classés',
	mesAffaires: 'Mes affaires',
	reglagesIndex: 'Sections de réglages',
	reglagesArborescence: 'Arborescence : tracks et channels',
	trackIntrouvable: 'Track introuvable',
	cardIntrouvable: 'Card introuvable',
	retour: "Revenir à l'accueil",
	tracksDemonstration: ['Conseil & IA', 'Studio web', 'Formation'],
	dossierChange: 'Dossier changé',
} as const

test.describe('le parcours que le manuel décrit, sans aucune substitution (docs/manual.md §3.2)', () => {
	// RÉVISÉ PAR `CRM-092` T9 : l'accueil anonyme et ses trois refus n'existent plus. Le §3.2 décrit
	// désormais ce qu'un compte voit après connexion : son espace, et les tracks du jeu de
	// démonstration dans la barre latérale.
	test('l’accueil montre, après connexion, ce que le manuel annonce (§3.2)', async ({ page }) => {
		await page.setViewportSize({ width: 1440, height: 900 })
		await page.goto('/')

		await expect(page.getByTestId('workspace-courant')).toBeVisible()
		const tracks = page.getByTestId('entree-track')
		for (const nom of LIBELLES.tracksDemonstration) await expect(tracks.filter({ hasText: nom })).toHaveCount(1)
		await expect(page.getByTestId('etat-erreur')).toHaveCount(0)

		await capturer(page, 'manuel-accueil-1440', UNITE)
	})

	// RÉVISÉ PAR `CRM-092` T9 : ce scénario prouvait le REFUS de la messagerie à un anonyme, qui
	// n'atteint plus l'écran. Il éprouve désormais ce que le §4.15 promet à un compte : « Non
	// classés » en premier, même vide — et un zéro qui n'est pas une panne, ce que la lectrice lit.
	// Plus aucun `401` à consommer : la console doit rester vierge.
	test('/inbox ouvre « Non classés » en premier, à zéro sans panne (§4.15)', async ({ page }) => {
		await page.setViewportSize({ width: 1440, height: 900 })
		await page.goto('/inbox')

		const dossiers = page.getByRole('navigation', { name: 'Dossiers de la messagerie' }).getByRole('button')
		await expect(dossiers.first()).toContainText(LIBELLES.nonClasses)
		await expect(dossiers.first()).toContainText('0')
		await expect(page.getByTestId('etat-refus')).toHaveCount(0)
		await expect(page.getByTestId('etat-erreur')).toHaveCount(0)
		await capturer(page, 'manuel-inbox-1440', UNITE)
	})

	// RÉVISÉ PAR `CRM-092` T9 : l'anonyme lisait le premier des deux vides du §3 quater.6, « mes
	// affaires » n'ayant pas de sujet sans session. La lectrice, elle, a une affaire à son nom : le
	// scénario éprouve la bascule de portée que le §3 quater.3 décrit, sans dépendre d'une date.
	test('/ma-journee s’ouvre sur « Mes affaires », avec la bascule vers tout l’espace (§3 quater.3)', async ({
		page,
	}) => {
		await page.setViewportSize({ width: 1440, height: 900 })
		await page.goto('/ma-journee')

		const portee = page.getByRole('navigation', { name: 'Portée de la journée' })
		await expect(portee.getByRole('link', { name: LIBELLES.mesAffaires })).toBeVisible()
		await expect(portee.getByRole('link', { name: /^Tout l.espace de travail$/ })).toBeVisible()
		await expect(page.getByTestId('etat-erreur')).toHaveCount(0)
		await capturer(page, 'manuel-ma-journee-1440', UNITE)
	})

	// RÉVISÉ PAR `CRM-075`, § 5 « L'index » : `/reglages` a cessé d'être un état vide le jour où
	// l'administration de l'arborescence lui a donné une première section. L'assertion n'avait
	// jamais pu être rejouée contre la vraie pile depuis ce changement (docs/JOURNAL.md décision
	// 343) ; corrigée ici plutôt que contournée, pour un visiteur anonyme comme pour un membre —
	// l'index ne lit aucune donnée protégée.
	test('/reglages rend l’index des sections que le manuel promet (§5)', async ({ page }) => {
		await page.setViewportSize({ width: 1440, height: 900 })
		await page.goto('/reglages')

		await expect(page.getByRole('heading', { name: LIBELLES.reglagesIndex })).toBeVisible()
		await expect(
			page.getByRole('link', { name: new RegExp(LIBELLES.reglagesArborescence) }),
		).toBeVisible()
		await expect(etatVide(page)).toHaveCount(0)
		await capturer(page, 'manuel-reglages-1440', UNITE)
	})

	// RÉVISÉ PAR `CRM-092` T9 : un track du seed n'est plus refusé à personne qui atteigne l'écran ;
	// le §3.2 ter promet le même message pour une adresse qui ne désigne aucun track.
	test('une adresse qui ne désigne aucun track est « Track introuvable » (§3.2 ter)', async ({ page }) => {
		await page.setViewportSize({ width: 1440, height: 900 })
		await page.goto(`/tracks/${TRACK_INEXISTANT}`)

		await expect(etatVide(page)).toContainText(LIBELLES.trackIntrouvable)
		await expect(page.getByRole('link', { name: LIBELLES.retour })).toBeVisible()

		await capturer(page, 'manuel-track-1440', UNITE)
	})

	test('le tableau kanban n’est jamais atteint, et le manuel le dit (§4.8)', async ({ page }) => {
		await page.setViewportSize({ width: 1440, height: 900 })
		await page.goto(`/tracks/${TRACK_INEXISTANT}/${CHANNEL}`)

		await expect(etatVide(page)).toContainText(LIBELLES.trackIntrouvable)
		await expect(page.getByTestId('board')).toHaveCount(0)

		await capturer(page, 'manuel-board-1440', UNITE)
	})

	test('la vue liste non plus, pour la même cause (§4.9)', async ({ page }) => {
		await page.setViewportSize({ width: 1440, height: 900 })
		await page.goto(`/tracks/${TRACK_INEXISTANT}/${CHANNEL}/liste`)

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
	 * Un seul événement, du neuvième type — celui que `CRM-045` écrit et que `CRM-019` a nommé.
	 * Son `payload` porte les deux channels, exactement comme le trigger les écrit : la
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

	test('un `channel_changed` s’affiche sous son libellé métier, sans nommer les dossiers', async ({
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

		// MESURÉ, et non déduit : le fil nomme le changement de contexte sans inventer le nom des
		// dossiers, qui n'est pas résolu par cette vue.
		await expect(fil).toContainText(LIBELLES.dossierChange)

		await expect(fil).not.toContainText('Événement')
		await expect(fil).not.toContainText('Grands comptes')
		await expect(fil).not.toContainText('Prospection')

		await capturer(page, 'manuel-evenement-sans-nom-1440', UNITE)
	})
})
