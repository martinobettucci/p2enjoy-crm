// @verifies CRM-021 (docs/BACKLOG.md) — route d'un track et barre d'onglets, dans l'application réelle
// @verifies docs/SPEC-channels.md §5 (ce que la barre lit), §5.1 (route), §5.2 (pilules), §5.3
// @verifies docs/DESIGN_SYSTEM.md §4 (onglets), §5.8 (états), §7 (paliers), §12.1, §12.4
// @verifies docs/SPEC-webapp.md §7 (états), §8 (responsive) ; CLAUDE.md §16 (vérification visuelle)
//
// Ces scénarios s'exécutent contre le **build de production** servi par `vite preview`, et contre
// la vraie API. Rien n'est simulé, sauf là où c'est explicitement dit — et alors c'est le
// **réseau** qui est manipulé, jamais un état interne de l'application.
//
// CE QU'ILS PROUVENT, ET CE QU'ILS NE PROUVENT PAS.
//
// Ils prouvent que la route d'un track interroge réellement `public.tracks` puis
// `public.channels`, et qu'elle affiche l'état que le backend lui rend. Le cas sans substitution
// exerce explicitement l'anonyme et son refus réel ; le parcours connecté est couvert par
// `e2e/ui/authentification.spec.ts`.
//
// Le rendu chargé — onglets, ordre, onglet courant, patron ARIA — est éprouvé par
// `webapp/src/app/TabBar.test.tsx`, qui monte le composant réel, et ici en substituant la
// **réponse réseau**. Ni l'un ni l'autre n'est une session, et aucun n'est présenté comme telle.

import {
	autoriserErreursConsole,
	ERREUR_CONNEXION_REFUSEE,
	expect,
	test,
} from './fixtures'
import { PALIERS, capturer } from './captures'

const UNITE = 'CRM-021'

const ROUTE_TRACKS = '**/rest/v1/tracks*'
const ROUTE_CHANNELS = '**/rest/v1/channels*'

/**
 * Le track servi par le réseau, à la forme exacte de ce que PostgREST rend.
 *
 * Il porte `color` et `icon` bien que la route du track ne les demande pas : la **barre latérale**
 * les demande, et les deux écrans lisent la même table. Une fixture amputée y produirait une
 * pilule sans icône, donc un écran que le produit ne rendrait jamais.
 */
const TRACK_SERVI = [
	{ id: 't-1', name: 'Conseil & IA', slug: 'conseil-ia', color: 'brand', icon: 'sparkles', position: 1 },
]

/** Trois channels servis, dans l'ordre de leur `position`. */
// `workflow_id` a rejoint la lecture partagée à `CRM-041` (docs/SPEC-channels.md §5). Elle est
// `NOT NULL` en base depuis `CRM-033` : une fixture qui l'omettrait servirait une ligne que le
// produit ne peut pas produire.
//
// LES IDENTIFIANTS SONT DES UUID RÉELS, ET C'EST MESURÉ. Écrits d'abord `'c-1'` et `'wf-1'`, ils
// faisaient partir vers la vraie API des `channel_id=eq.c-2` et `workflow_id=eq.wf-1` que PostgREST
// refuse en `400` — « invalid input syntax for type uuid ». Le board affichait donc son état
// d'**erreur** et non son état vide : une fixture mal typée fabrique un écran que le produit ne
// rend jamais. Ces valeurs sont celles du seed.
const CHANNELS_SERVIS = [
	{ id: '5eed0000-0000-4000-8000-000000000031', name: 'Prospection', slug: 'prospection', position: 1, workflow_id: '5eed0000-0000-4000-8000-000000000051' },
	{ id: '5eed0000-0000-4000-8000-000000000032', name: 'Grands comptes', slug: 'grands-comptes', position: 2, workflow_id: '5eed0000-0000-4000-8000-000000000051' },
	{ id: '5eed0000-0000-4000-8000-000000000033', name: 'Appels d’offres', slug: 'appels-offres', position: 3, workflow_id: '5eed0000-0000-4000-8000-000000000051' },
]

/** Sert les deux routes du track chargé. Le réseau est substitué, pas l'état de l'application. */
async function servirTrackCharge(page: import('@playwright/test').Page): Promise<void> {
	await page.route(ROUTE_CHANNELS, (route) =>
		route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(CHANNELS_SERVIS) }),
	)
	// La barre latérale et la résolution de la route interrogent la même table : les deux reçoivent
	// donc le **même** track.
	//
	// DÉFAUT TROUVÉ EN REGARDANT UNE CAPTURE, et non en lisant un test. Une première rédaction ne
	// servait le track qu'à la requête `slug=eq.`, laissant la barre latérale sur « Aucun track » :
	// la capture montrait un écran incohérent — un track ouvert, titré dans l'en-tête, avec ses
	// onglets, et une barre latérale affirmant qu'il n'existe aucun track. Substituer le réseau
	// doit produire un état **cohérent** du produit, sinon la capture ne prouve rien de ce que
	// l'utilisateur verrait.
	await page.route(ROUTE_TRACKS, (route) =>
		route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(TRACK_SERVI) }),
	)
}

test.describe('la route d’un track interroge réellement le backend', () => {
	test('elle résout le track par son slug, puis demande ses channels', async ({ page }) => {
		const urls: string[] = []
		page.on('request', (requete) => {
			const url = requete.url()
			if (url.includes('/rest/v1/tracks') || url.includes('/rest/v1/channels')) urls.push(url)
		})
		await servirTrackCharge(page)
		await page.goto('/tracks/conseil-ia')
		await expect(page.getByTestId('onglet-channel').first()).toBeVisible()

		const resolution = urls.find((u) => u.includes('slug=eq.conseil-ia'))
		expect(resolution, 'le track est résolu par son slug').toBeTruthy()
		// Un track archivé reste masqué même quand son adresse est saisie directement : sans ce
		// filtre, l'archivage ne serait qu'un masquage de la barre latérale.
		expect(resolution).toContain('archived_at=is.null')

		const channels = urls.find((u) => u.includes('/rest/v1/channels'))
		expect(channels, 'les channels du track sont demandés').toBeTruthy()
		// Le filtre est côté serveur, et l'ordre aussi (docs/SPEC-channels.md §5).
		expect(channels).toContain('track_id=eq.t-1')
		expect(channels).toContain('archived_at=is.null')
		expect(channels).toContain('order=position')
	})

	test('elle n’interroge pas `channels` lorsque le track n’est pas consenti', async ({ page }) => {
		// Émettre une requête dont on sait qu'elle rendra `[]` est une requête de trop.
		let channelsDemandes = false
		page.on('request', (requete) => {
			if (requete.url().includes('/rest/v1/channels')) channelsDemandes = true
		})
		await page.goto('/tracks/conseil-ia')
		await expect(page.getByTestId('etat-vide')).toBeVisible()
		expect(channelsDemandes).toBe(false)
	})
})

test.describe('états de la route d’un track', () => {
	test('appelant anonyme : « track introuvable », qui est le refus réel du backend', async ({
		page,
	}) => {
		// C'est l'état réel du produit pour un visiteur sans session. Il est capturé comme tel.
		await page.setViewportSize({ width: 1440, height: 900 })
		await page.goto('/tracks/conseil-ia')
		const vide = page.getByTestId('etat-vide')
		await expect(vide).toBeVisible()
		await expect(vide).toContainText('Track introuvable')
		// La barre d'onglets reste présente et montre son état vide : la structure de l'écran ne
		// change pas d'une route à l'autre.
		await expect(page.getByTestId('onglets-vides')).toBeVisible()
		await capturer(page, 'track-introuvable-1440', UNITE)
	})

	test('un slug inexistant produit le même écran qu’un slug refusé', async ({ page }) => {
		// Délibéré : les distinguer renseignerait un appelant sans droit sur l'existence d'un
		// track (docs/SPEC-permissions-rls.md §7).
		await page.goto('/tracks/ce-track-nexiste-pas')
		await expect(page.getByTestId('etat-vide')).toContainText('Track introuvable')
	})

	test('erreur de chargement : message et reprise **réelle**', async ({ page }) => {
		// La panne porte sur **toutes** les requêtes `tracks` tant qu'elle dure : la barre latérale
		// et la résolution du track interrogent la même route, et n'en couper qu'une rendrait le
		// scénario dépendant de leur ordre d'émission.
		//
		// `supabase-js` retente automatiquement une requête abandonnée avant de la rendre en
		// échec — mesuré à `CRM-007` : trois reprises après la tentative initiale. Couper une
		// seule fois laisserait donc l'écran en chargement, ce qu'une première rédaction de ce
		// scénario a réellement produit. La panne dure jusqu'à ce que le test la lève.
		test.setTimeout(60_000)
		let enPanne = true
		let appels = 0
		await page.route(ROUTE_TRACKS, (route) => {
			appels += 1
			return enPanne
				? route.abort('connectionrefused')
				: route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
		})
		await page.goto('/tracks/conseil-ia')
		await expect(page.getByTestId('etat-erreur')).toBeVisible({ timeout: 30_000 })
		const appelsAvantReprise = appels
		autoriserErreursConsole(page, Array(8).fill(ERREUR_CONNEXION_REFUSEE))

		// La reprise relance la requête, elle ne recharge pas la page.
		enPanne = false
		await page.getByRole('button', { name: 'Réessayer' }).click()
		await expect(page.getByTestId('etat-vide')).toBeVisible({ timeout: 30_000 })
		expect(appels).toBeGreaterThan(appelsAvantReprise)
	})

	test('track consenti sans channel : la barre affiche son état vide', async ({ page }) => {
		await page.route(ROUTE_CHANNELS, (route) =>
			route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
		)
		await page.route(ROUTE_TRACKS, (route) =>
			route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify(route.request().url().includes('slug=eq.') ? TRACK_SERVI : []),
			}),
		)
		await page.goto('/tracks/conseil-ia')
		await expect(page.getByTestId('onglets-vides')).toBeVisible()
		await expect(page.getByTestId('etat-vide')).toContainText('Aucun channel dans ce track')
	})
})

test.describe('onglets réels, servis par le réseau', () => {
	test('la barre rend un onglet par channel, dans l’ordre, et l’en-tête porte le nom du track', async ({
		page,
	}) => {
		await page.setViewportSize({ width: 1440, height: 900 })
		await servirTrackCharge(page)
		await page.goto('/tracks/conseil-ia')

		const onglets = page.getByTestId('onglet-channel')
		await expect(onglets).toHaveCount(3)
		await expect(onglets.nth(0)).toHaveText('Prospection')
		// Le nom du track est une **donnée** : il remplace le libellé traduit de la route.
		await expect(page.getByRole('heading', { level: 1 })).toContainText('Conseil & IA')
		await capturer(page, 'onglets-charges-1440', UNITE)
	})

	test('ouvrir un onglet change l’adresse et marque l’onglet courant', async ({ page }) => {
		await page.setViewportSize({ width: 1440, height: 900 })
		await servirTrackCharge(page)
		await page.goto('/tracks/conseil-ia')

		await page.getByTestId('onglet-channel').nth(1).click()
		await expect(page).toHaveURL(/\/tracks\/conseil-ia\/grands-comptes$/)
		// L'onglet courant se signale par `aria-current`, pas seulement par la couleur.
		await expect(page.getByTestId('onglet-channel').nth(1)).toHaveAttribute('aria-current', 'page')
		// ASSERTION RETOURNÉE PAR `CRM-041`, non retirée (mécanisme de la décision 51). Elle
		// attendait « Aucune card dans ce channel », l'état vide que `CRM-021` avait posé faute de
		// board. Le board existe ; ouvrir un onglet ouvre désormais **ses colonnes**. Ici, seuls
		// les channels sont substitués : les étapes du workflow sont demandées à la vraie API, qui
		// n'en consent aucune à un anonyme — l'écran dit donc que le workflow ne déclare aucune
		// étape, et c'est le refus réel du backend (docs/SPEC-workflow-engine.md §7.11).
		await expect(page.getByTestId('etat-vide')).toContainText('aucune étape')
		await capturer(page, 'channel-ouvert-1440', UNITE)
	})

	test('les onglets sont atteignables au clavier, sans `tablist`', async ({ page }) => {
		await servirTrackCharge(page)
		await page.goto('/tracks/conseil-ia')
		await expect(page.getByTestId('onglet-channel').first()).toBeVisible()

		// Décision 62 : ce sont des liens, donc parcourus par `Tab` sans qu'aucun code ne
		// l'organise. Le patron `tablist` aurait retiré cette navigation.
		expect(await page.locator('[role="tablist"]').count()).toBe(0)
		expect(await page.locator('[role="tab"]').count()).toBe(0)

		const premier = page.getByTestId('onglet-channel').first()
		await premier.focus()
		await expect(premier).toBeFocused()
		await page.keyboard.press('Enter')
		await expect(page).toHaveURL(/\/tracks\/conseil-ia\/prospection$/)
	})

	test('une pilule de track mène à sa route — l’écart §12.4 est refermé', async ({ page }) => {
		// `CRM-020` avait laissé les pilules inertes, « le lien arrivera avec la destination ».
		// La destination existe : le lien est vérifié dans l'application construite.
		await page.setViewportSize({ width: 1440, height: 900 })
		await page.route(ROUTE_CHANNELS, (route) =>
			route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(CHANNELS_SERVIS) }),
		)
		await page.route(ROUTE_TRACKS, (route) =>
			route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(TRACK_SERVI) }),
		)
		await page.goto('/')

		const pilule = page.getByTestId('entree-track').first()
		await expect(pilule).toHaveAttribute('href', '/tracks/conseil-ia')
		await pilule.click()
		await expect(page).toHaveURL(/\/tracks\/conseil-ia$/)
		await expect(page.getByTestId('onglet-channel').first()).toBeVisible()
	})
})

test.describe('paliers responsive de la route d’un track', () => {
	for (const palier of PALIERS) {
		test(`palier ${palier.nom} : la page ne défile jamais horizontalement`, async ({ page }) => {
			await page.setViewportSize({ width: palier.largeur, height: palier.hauteur })
			await servirTrackCharge(page)
			await page.goto('/tracks/conseil-ia')
			await expect(page.getByTestId('barre-onglets')).toBeVisible()

			// docs/DESIGN_SYSTEM.md §7 : « les tableaux et les boards défilent dans leur propre
			// conteneur : la page ne défile jamais horizontalement ». Le débordement des onglets
			// est donc porté par la barre, pas par le document.
			const debordement = await page.evaluate(
				() => document.documentElement.scrollWidth > document.documentElement.clientWidth,
			)
			expect(debordement, 'le document ne déborde pas horizontalement').toBe(false)

			// docs/DESIGN_SYSTEM.md §4 : « défilable, **jamais tronqué sans indication** ». Là où
			// la barre déborde réellement, l'indication doit être posée — défaut trouvé en
			// regardant la capture à 390 px, où le dernier libellé était coupé net sans que rien
			// ne le signale (§12.6).
			const barre = page.getByTestId('barre-onglets')
			const deborde = await barre.evaluate((e) => e.scrollWidth > e.clientWidth)
			const indique = await barre.evaluate((e) =>
				e.classList.contains('indique-debordement-x'),
			)
			expect(indique, 'la barre porte l’indication de débordement').toBe(true)

			// La capture est prise **au repos**, avant tout défilement : c'est l'état que
			// l'utilisateur rencontre en arrivant, et donc celui qui doit montrer l'indication.
			await capturer(page, `onglets-palier-${palier.nom}`, UNITE)

			if (deborde) {
				// Elle défile réellement : l'indication n'est pas décorative.
				await barre.evaluate((e) => e.scrollBy({ left: 200 }))
				expect(await barre.evaluate((e) => e.scrollLeft)).toBeGreaterThan(0)
			}
		})
	}
})
