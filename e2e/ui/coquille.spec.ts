// @verifies CRM-007 (docs/BACKLOG.md) — Definition of Done du squelette de la webapp
// @verifies docs/DESIGN_SYSTEM.md §4 (coquille), §5.8 (états), §7 (paliers), §8 (clavier)
// @verifies docs/SPEC-webapp.md §7 (états), §8 (responsive), §9 (accessibilité), §11 (stockage)
//
// Ces scénarios s'exécutent contre le **build de production** servi par `vite preview`, et
// contre la vraie API : l'état vide observé est celui que la RLS en refus par défaut produit,
// il n'est simulé nulle part.
//
// Les états de chargement et d'erreur, eux, sont provoqués en agissant sur le **réseau** —
// retard réel, échec réel — et non en injectant un état dans l'application. Une simulation
// interne prouverait que le composant sait s'afficher, pas que l'application sait échouer.

import {
	autoriserErreursConsole,
	ERREUR_CONNEXION_REFUSEE,
	ERREUR_RESSOURCE_HTTP,
	expect,
	test,
} from './fixtures'
import { PALIERS, capturer } from './captures'

const ROUTE_WORKSPACES = '**/rest/v1/workspaces*'

test.describe('coquille', () => {
	test('rend les points de repère et les états réels du backend', async ({ page }) => {
		await page.setViewportSize({ width: 1440, height: 900 })
		await page.goto('/')

		await expect(page.getByRole('banner')).toBeVisible()
		await expect(page.getByRole('main')).toBeVisible()
		await expect(page.getByRole('complementary', { name: 'Barre latérale' })).toBeVisible()
		await expect(page.getByRole('navigation', { name: 'Navigation principale' })).toBeVisible()
		await expect(page.getByTestId('barre-onglets')).toBeVisible()

		// L'appelant est anonyme : la RLS ne consent aucune ligne, l'interface le dit.
		await expect(page.getByTestId('workspace-absent')).toBeVisible()
		await expect(page.getByTestId('tracks-vides')).toBeVisible()
		await expect(page.getByTestId('etat-vide')).toBeVisible()
		await expect(page.getByTestId('etat-erreur')).toHaveCount(0)

		await capturer(page, 'coquille-vide-1440')
	})

	test('navigue entre les routes, chacune avec son état explicite', async ({ page }) => {
		await page.setViewportSize({ width: 1440, height: 900 })
		await page.goto('/')

		// RÉVISÉ PAR `CRM-057` : les trois routes transverses rendaient un état VIDE, et `/inbox` a
		// cessé d'en être un le jour où la messagerie a été livrée. Pour un visiteur anonyme, elle
		// n'est pas vide — elle est REFUSÉE. La garantie ne change pas : aucune route n'est une page
		// blanche ; c'est la forme de l'état explicite qui diffère (docs/DESIGN_SYSTEM.md §5.8).
		for (const [libelle, etat] of [
			['Inbox', 'etat-refus'],
			['Ma journée', 'etat-vide'],
		] as const) {
			await page.getByRole('navigation', { name: 'Navigation principale' }).getByTitle(libelle).click()
			await expect(page.getByRole('heading', { level: 1 })).toHaveText(libelle)
			await expect(page.getByTestId(etat).first()).toBeVisible()
		}

		// RÉVISÉ PAR `CRM-075` : « Réglages » a cessé d'être un état vide le jour où
		// l'administration de l'arborescence lui a donné une première section — `/reglages` est
		// désormais l'INDEX de ces sections, pas une page sans contenu
		// (docs/SPEC-administration-arborescence.md §3.1). L'assertion périmée n'avait jamais pu
		// être rejouée contre la vraie pile depuis ce changement (docs/JOURNAL.md décision 343) ;
		// mesurée ici pour la première fois, elle est corrigée plutôt que contournée.
		await page.getByRole('navigation', { name: 'Navigation principale' }).getByTitle('Réglages').click()
		await expect(page.getByRole('heading', { level: 1 })).toHaveText('Réglages')
		await expect(page.getByRole('heading', { name: 'Sections de réglages' })).toBeVisible()
		await expect(page.getByRole('link', { name: /Arborescence : tracks et channels/ })).toBeVisible()
		await expect(page.getByTestId('etat-vide')).toHaveCount(0)
		await capturer(page, 'route-reglages-1440')

		// LE REFUS DE L'INBOX EST CONSOMMÉ EXPLICITEMENT : PostgREST rend `401` à la clé anonyme,
		// et le navigateur l'écrit dans sa console. Rien n'est filtré globalement (décision 248).
		autoriserErreursConsole(page, [ERREUR_RESSOURCE_HTTP[401]])

		await page.goto('/adresse-inexistante')
		await expect(page.getByRole('heading', { level: 1 })).toHaveText('Page introuvable')
		await expect(page.getByRole('link', { name: "Revenir à l'accueil" })).toBeVisible()
		await capturer(page, 'route-introuvable-1440')
	})
})

test.describe('paliers responsive (docs/DESIGN_SYSTEM.md §7)', () => {
	for (const palier of PALIERS) {
		test(`${palier.nom} : la page ne défile jamais horizontalement`, async ({ page }) => {
			await page.setViewportSize({ width: palier.largeur, height: palier.hauteur })
			await page.goto('/')
			await expect(page.getByTestId('etat-vide')).toBeVisible()

			const debordement = await page.evaluate(
				() => document.documentElement.scrollWidth - document.documentElement.clientWidth,
			)
			expect(debordement).toBeLessThanOrEqual(0)

			// Le titre de la route survit à tous les paliers. Défaut réellement observé sur
			// une capture à 390 px : le contexte secondaire de l'en-tête écrasait le titre,
			// qui ne se déduit d'aucun autre élément de l'écran
			// (docs/DESIGN_SYSTEM.md §7 : aucun contenu masqué sans point d'accès).
			await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
			await expect(page.getByRole('heading', { level: 1 })).toHaveText('Board')

			await capturer(page, `palier-${palier.nom}`)
		})
	}

	test('la barre latérale suit le palier : colonne, icônes, puis tiroir', async ({ page }) => {
		await page.goto('/')
		const barre = page.getByTestId('barre-laterale')

		await page.setViewportSize({ width: 1440, height: 900 })
		await expect(page.getByTestId('etat-vide')).toBeVisible()
		const largeurXl = (await barre.boundingBox())?.width ?? 0
		expect(largeurXl).toBeGreaterThan(200)

		await page.setViewportSize({ width: 1152, height: 800 })
		const largeurLg = (await barre.boundingBox())?.width ?? 0
		expect(largeurLg).toBeLessThan(largeurXl)
		expect(largeurLg).toBeGreaterThan(0)

		// Sous 1024 px, la barre sort du flux : elle n'est plus visible tant que le tiroir
		// n'est pas ouvert, et l'en-tête offre le bouton qui l'ouvre.
		await page.setViewportSize({ width: 900, height: 800 })
		await expect(page.getByTestId('ouvrir-tiroir')).toBeVisible()
		await expect(barre).not.toBeInViewport()

		await page.getByTestId('ouvrir-tiroir').click()
		// Le tiroir glisse en 150 ms : exiger qu'il soit **entièrement** dans la fenêtre
		// attend la fin de l'animation. Sans ce seuil, la capture fige un état intermédiaire
		// — constaté sur une première capture, où seule une lisière du tiroir était visible.
		await expect(barre).toBeInViewport({ ratio: 0.99 })
		await expect(page.getByTestId('fermer-tiroir')).toBeVisible()
		await capturer(page, 'tiroir-ouvert-900')

		// Échap referme : une surface qui recouvre l'écran doit se refermer au clavier.
		await page.keyboard.press('Escape')
		await expect(barre).not.toBeInViewport()
	})

	test('le repli de la barre est une préférence de session, et rien n’est écrit ailleurs', async ({
		page,
	}) => {
		await page.setViewportSize({ width: 1440, height: 900 })
		await page.goto('/')
		await expect(page.getByTestId('etat-vide')).toBeVisible()

		const barre = page.getByTestId('barre-laterale')
		const largeurDepliee = (await barre.boundingBox())?.width ?? 0
		await page.getByTestId('bascule-repli').click()
		await expect(barre).toHaveAttribute('data-replie', 'oui')
		const largeurRepliee = (await barre.boundingBox())?.width ?? 0
		expect(largeurRepliee).toBeLessThan(largeurDepliee)
		await capturer(page, 'barre-repliee-1440')

		// Le repli doit rester réversible : la bascule est toujours visible, entièrement dans
		// la barre, et la déplie réellement. Défaut réellement observé sur une capture — la
		// bascule était rognée par la colonne réduite, et le repli sans retour.
		const bascule = page.getByTestId('bascule-repli')
		await expect(bascule).toBeInViewport({ ratio: 0.99 })
		await bascule.click()
		await expect(barre).toHaveAttribute('data-replie', 'non')
		expect((await barre.boundingBox())?.width).toBe(largeurDepliee)
		await bascule.click()
		await expect(barre).toHaveAttribute('data-replie', 'oui')

		const stockage = await page.evaluate(() => ({
			local: { ...globalThis.localStorage },
			session: { ...globalThis.sessionStorage },
		}))
		expect(stockage.local).toEqual({})
		expect(stockage.session).toEqual({ 'p2enjoy.sidebar.replie': '1' })
	})
})

test.describe('navigation au clavier (docs/DESIGN_SYSTEM.md §8)', () => {
	test('le parcours complet est atteignable sans souris', async ({ page }) => {
		await page.setViewportSize({ width: 1440, height: 900 })
		await page.goto('/')
		await expect(page.getByTestId('etat-vide')).toBeVisible()

		// 1. Le premier élément focusable est le lien d'évitement, et il devient visible.
		await page.keyboard.press('Tab')
		await expect(page.getByTestId('lien-evitement')).toBeFocused()
		await expect(page.getByTestId('lien-evitement')).toBeInViewport()
		await capturer(page, 'clavier-lien-evitement-1440')

		// 2. Il mène réellement au contenu principal.
		await page.keyboard.press('Enter')
		expect(new URL(page.url()).hash).toBe('#contenu-principal')

		// 3. Depuis le début, la tabulation atteint la bascule de repli puis les quatre
		//    entrées de navigation, dans l'ordre visuel.
		await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
		await page.keyboard.press('Tab')
		await page.keyboard.press('Tab')
		await expect(page.getByTestId('bascule-repli')).toBeFocused()

		for (const libelle of ['Board', 'Inbox', 'Ma journée', 'Réglages']) {
			await page.keyboard.press('Tab')
			await expect(
				page.getByRole('navigation', { name: 'Navigation principale' }).getByTitle(libelle),
			).toBeFocused()
		}

		// 4. Une entrée s'active à la touche Entrée, comme un lien doit le faire.
		await page.keyboard.press('Enter')
		await expect(page.getByRole('heading', { level: 1 })).toHaveText('Réglages')
	})

	test('l’anneau de focus est réellement rendu, et non seulement déclaré', async ({ page }) => {
		await page.setViewportSize({ width: 1440, height: 900 })
		await page.goto('/')
		await page.getByTestId('bascule-repli').focus()
		const contour = await page
			.getByTestId('bascule-repli')
			.evaluate((element) => globalThis.getComputedStyle(element).outlineWidth)
		expect(contour).toBe('2px')
	})
})

test.describe('états provoqués sur le réseau (docs/DESIGN_SYSTEM.md §5.8)', () => {
	test('le chargement montre des squelettes, jamais un spinner plein écran', async ({ page }) => {
		await page.setViewportSize({ width: 1440, height: 900 })
		// Retard réel de la réponse : l'état de chargement dure assez pour être observé.
		await page.route(ROUTE_WORKSPACES, async (route) => {
			await new Promise((resoudre) => setTimeout(resoudre, 2500))
			await route.continue()
		})
		await page.goto('/')

		await expect(page.getByTestId('squelette').first()).toBeVisible()
		await capturer(page, 'etat-chargement-1440')
		await expect(page.getByTestId('workspace-absent')).toBeVisible({ timeout: 10_000 })
	})

	// Mesuré : `postgrest-js` réessaie **trois fois** une lecture en échec, avec une attente
	// de 1 s, 2 s puis 4 s. L'état d'erreur n'apparaît donc qu'après environ sept secondes,
	// pendant lesquelles l'utilisateur voit des squelettes. Le délai d'attente de ce scénario
	// tient compte du comportement réel de la bibliothèque, il ne le contourne pas
	// (docs/JOURNAL.md décision 47).
	test('une panne de transport donne un état d’erreur, dont la reprise relance la requête', async ({
		page,
	}) => {
		test.setTimeout(60_000)
		await page.setViewportSize({ width: 1440, height: 900 })
		let echecs = 0
		await page.route(ROUTE_WORKSPACES, async (route) => {
			if (echecs < 4) {
				echecs += 1
				await route.abort('connectionrefused')
				return
			}
			await route.continue()
		})
		await page.goto('/')

		await expect(page.getByTestId('etat-erreur')).toBeVisible({ timeout: 30_000 })
		await expect(page.getByRole('button', { name: 'Réessayer' })).toBeVisible()
		autoriserErreursConsole(page, Array(4).fill(ERREUR_CONNEXION_REFUSEE))
		await capturer(page, 'etat-erreur-1440')

		// La reprise relance la requête ; la seconde tentative passe, et l'erreur disparaît.
		await page.getByRole('button', { name: 'Réessayer' }).click()
		await expect(page.getByTestId('etat-erreur')).toHaveCount(0)
		await expect(page.getByTestId('workspace-absent')).toBeVisible()
		// La tentative initiale et ses trois reprises automatiques : au-delà, la requête
		// passe, ce qui prouve que la reprise a bien relancé un appel réseau.
		expect(echecs).toBe(4)
	})

	test('un refus du backend donne l’état d’accès refusé, distinct de l’erreur', async ({ page }) => {
		await page.setViewportSize({ width: 1440, height: 900 })
		await page.route(ROUTE_WORKSPACES, (route) =>
			route.fulfill({
				status: 403,
				contentType: 'application/json',
				body: JSON.stringify({ message: 'permission denied for table workspaces' }),
			}),
		)
		await page.goto('/')

		await expect(page.getByTestId('etat-refus')).toBeVisible()
		await expect(page.getByTestId('etat-erreur')).toHaveCount(0)
		autoriserErreursConsole(page, [ERREUR_RESSOURCE_HTTP[403]])
		await capturer(page, 'etat-refus-1440')
	})
})
