// @verifies CRM-110 (docs/BACKLOG.md) tranche T3 — le fil d'Ariane de l'en-tête, dans l'application réelle et sur le seed
// @verifies docs/SPEC-webapp.md §5.1 bis (niveaux par route ; règle 2, un niveau non lu n'est pas rendu ; règle 3,
//           rien de plus qu'ailleurs sur l'écran — un channel refusé n'est jamais nommé)
// @verifies docs/DESIGN_SYSTEM.md §5.62 (liens, titre, repli au clavier, Échap, panneau dans la fenêtre), §12.2 (ordre
//           de sacrifice aux paliers), §5.46 (le fil cède à la recherche ouverte), §7 (aucun défilement horizontal)
// @verifies CLAUDE.md §16 (vérification visuelle) ; CRM-092, docs/SPEC-session-sso.md §13 (connexion réelle)
//
// Aucune réponse n'est substituée : les noms viennent des lectures réelles du seed, sous la RLS du compte connecté.
// Le repli est atteint par `Tab` et ouvert par `Entrée` : un focus posé par script ne prouverait rien du clavier.

import type { Locator } from '@playwright/test'
import { connecterAvecLeLabs, expect, test, type Page } from './fixtures'
import { PALIERS, capturer } from './captures'

const UNITE = 'CRM-110'
const ADMIN = 'admin@p2enjoy.test'
const LECTRICE = 'viewer@p2enjoy.test'

const WORKSPACE = 'P2Enjoy SAS'
const AFFAIRE = '/tracks/conseil-ia/grands-comptes/cards/5eed0000-0000-4000-8000-0000000000c2'
const AFFAIRE_LONGUE = '/tracks/studio-web/maintenance/cards/5eed0000-0000-4000-8000-00000000d002'
const BUDGET = '/tracks/conseil-ia/couts/5eed0000-0000-4000-8000-0000000000c1'

const fil = (page: Page) => page.getByTestId('fil-ariane')
const ligne = (page: Page) => fil(page).getByRole('list').first()
const titre = (page: Page) => page.getByRole('heading', { level: 1 })
const repli = (page: Page) => page.getByTestId('fil-ariane-repli')
const panneau = (page: Page) => page.getByTestId('fil-ariane-panneau')

/**
 * Les niveaux VISIBLES de la ligne, dans l'ordre : ce que la personne lit réellement, palier compris. Le repli s'écrit
 * « … », ce qu'il montre ; son nom accessible est prouvé à part.
 */
async function niveauxVisibles(page: Page): Promise<string[]> {
	return ligne(page)
		.locator(':scope > li')
		.evaluateAll((elements) =>
			elements
				.filter((element) => (element as HTMLElement).offsetParent !== null)
				.map((element) =>
					element.querySelector('[data-testid="fil-ariane-repli"]') !== null
						? '…'
						: (element.textContent ?? '').replace(/\/\s*$/, '').trim(),
				),
		)
}

/** Atteint l'élément par `Tab` seul, comme un utilisateur au clavier, en partant du haut du document. */
async function atteindreAuClavier(page: Page, cible: Locator): Promise<void> {
	await page.locator('body').focus()
	for (let pas = 0; pas < 40; pas += 1) {
		await page.keyboard.press('Tab')
		if (await cible.evaluate((element) => element === document.activeElement)) return
	}
	throw new Error('la cible n’a pas été atteinte par `Tab` en 40 pas')
}

/** Largeur sous laquelle un titre n'est plus lu : « B. » pour « Board », mesuré avant la décision 641. */
const TITRE_LISIBLE = 120

/**
 * La page ne défile jamais horizontalement (§7), et le titre est LISIBLE : rendu dans la fenêtre, d'une largeur utile,
 * et sans chevaucher les commandes de l'en-tête. Mesurer son seul bord droit avait laissé passer un titre de largeur
 * nulle à 390 px — la preuve était verte, la capture montrait l'en-tête sans titre (décision 641).
 */
async function attendreSansDebordement(page: Page): Promise<void> {
	const { defilement, largeur } = await page.evaluate(() => ({
		defilement: document.documentElement.scrollWidth,
		largeur: document.documentElement.clientWidth,
	}))
	expect(defilement, 'largeur défilable du document').toBeLessThanOrEqual(largeur)
	const cadre = await titre(page).boundingBox()
	const cloche = await page.getByTestId('cloche-notifications').boundingBox()
	expect(cadre, 'le titre est rendu').not.toBeNull()
	expect(cloche, 'la cloche est rendue').not.toBeNull()
	if (cadre === null || cloche === null) return
	expect(cadre.x + cadre.width, 'bord droit du titre').toBeLessThanOrEqual(largeur + 0.5)
	expect(cadre.width, 'largeur du titre').toBeGreaterThanOrEqual(TITRE_LISIBLE)
	// Le titre et la cloche ne se chevauchent pas : l'un est à gauche de l'autre, ou sur une autre ligne.
	const disjoints =
		cadre.x + cadre.width <= cloche.x + 0.5 || cadre.y >= cloche.y + cloche.height - 0.5
	expect(disjoints, 'le titre ne chevauche pas la cloche').toBe(true)
}

test.describe('le chemin d’une affaire, à 1440 px', () => {
	test.beforeEach(async ({ page }) => {
		await page.setViewportSize({ width: 1440, height: 900 })
		await connecterAvecLeLabs(page, ADMIN)
	})

	test('nomme le workspace, le track, le channel puis l’affaire — et plus le nom du produit', async ({ page }) => {
		await page.goto(AFFAIRE)
		await expect(titre(page)).toHaveText('Migration ERP Sogexia')
		await expect(titre(page)).toHaveAttribute('aria-current', 'page')
		await expect.poll(() => niveauxVisibles(page)).toEqual([WORKSPACE, 'Conseil & IA', 'Grands comptes', 'Migration ERP Sogexia'])
		// Le contexte d'espace ne se répète plus en fin de ligne, et le nom du produit a quitté l'en-tête.
		await expect(page.getByTestId('entete-fin')).not.toContainText(WORKSPACE)
		await expect(page.getByTestId('entete')).not.toContainText('P2Enjoy CRM')
		await expect(repli(page)).toBeHidden()
		await capturer(page, 'fil-affaire-xl-1440', UNITE)
	})

	test('chaque ancêtre mène à sa route, et le fil suit', async ({ page }) => {
		await page.goto(AFFAIRE)
		await ligne(page).getByRole('link', { name: 'Grands comptes' }).click()
		await expect(page).toHaveURL(/\/tracks\/conseil-ia\/grands-comptes$/)
		await expect(titre(page)).toHaveText('Grands comptes')
		await expect.poll(() => niveauxVisibles(page)).toEqual([WORKSPACE, 'Conseil & IA', 'Grands comptes'])
		await capturer(page, 'fil-channel-xl-1440', UNITE)

		await ligne(page).getByRole('link', { name: 'Conseil & IA' }).click()
		await expect(page).toHaveURL(/\/tracks\/conseil-ia$/)
		await expect(titre(page)).toHaveText('Conseil & IA')
		await expect.poll(() => niveauxVisibles(page)).toEqual([WORKSPACE, 'Conseil & IA'])

		await ligne(page).getByRole('link', { name: WORKSPACE }).click()
		await expect(page).toHaveURL(/\/$/)
		await expect.poll(() => niveauxVisibles(page)).toEqual([WORKSPACE, 'Board'])
	})

	test('la vue liste d’un channel a le même fil que son board', async ({ page }) => {
		await page.goto('/tracks/studio-web/maintenance/liste')
		await expect(titre(page)).toHaveText('Maintenance')
		await expect.poll(() => niveauxVisibles(page)).toEqual([WORKSPACE, 'Studio web', 'Maintenance'])
	})

	test('les coûts d’un track, puis le détail d’un budget', async ({ page }) => {
		await page.goto('/tracks/conseil-ia/couts')
		await expect(titre(page)).toHaveText('Coûts')
		await expect.poll(() => niveauxVisibles(page)).toEqual([WORKSPACE, 'Conseil & IA', 'Coûts'])

		await page.goto(BUDGET)
		await expect(titre(page)).toHaveText('Prospection sortante')
		await expect.poll(() => niveauxVisibles(page)).toEqual([WORKSPACE, 'Conseil & IA', 'Coûts', 'Prospection sortante'])
		await ligne(page).getByRole('link', { name: 'Coûts' }).click()
		await expect(page).toHaveURL(/\/tracks\/conseil-ia\/couts$/)
		await capturer(page, 'fil-budget-retour-couts-xl-1440', UNITE)
	})

	test('hors d’un track, le fil est `Workspace / titre`', async ({ page }) => {
		await page.goto('/contacts')
		await expect.poll(() => niveauxVisibles(page)).toEqual([WORKSPACE, 'Contacts'])
	})

	test('un slug inconnu n’est jamais affiché : aucun ancêtre, le titre de repli', async ({ page }) => {
		await page.goto('/tracks/track-inexistant/canal-inexistant')
		await expect(page.getByText('Track introuvable')).toBeVisible()
		await expect(page.getByTestId('fil-ariane-ancetre')).toHaveCount(0)
		await expect(fil(page)).not.toContainText('inexistant')
	})
})

test('la lectrice : un channel refusé n’est nommé nulle part, son track lu reste un ancêtre', async ({ page }) => {
	await page.setViewportSize({ width: 1440, height: 900 })
	await connecterAvecLeLabs(page, LECTRICE)

	await page.goto('/tracks/conseil-ia/grands-comptes')
	await expect(page.getByText('Choisissez un channel')).toBeVisible()
	// Sans channel lu, la route se lit comme celle du track : son nom est le titre, rien ne le précède.
	await expect(titre(page)).toHaveText('Conseil & IA')
	await expect(page.getByTestId('fil-ariane-ancetre')).toHaveCount(0)
	await expect(page.getByText('Grands comptes')).toHaveCount(0)

	await page.goto(AFFAIRE)
	await expect(page.getByTestId('fil-ariane-ancetre')).toHaveCount(1)
	await expect(page.getByTestId('fil-ariane-ancetre')).toContainText('Conseil & IA')
	await expect(page.getByText('Grands comptes')).toHaveCount(0)
	await capturer(page, 'fil-lectrice-channel-refuse-1440', UNITE)
})

test.describe('le repli « … » au clavier', () => {
	test.beforeEach(async ({ page }) => {
		await connecterAvecLeLabs(page, ADMIN)
	})

	test('à 900 px : le fil a sa propre ligne, entier, sans repli (décision 641)', async ({ page }) => {
		await page.setViewportSize({ width: 900, height: 800 })
		await page.goto(AFFAIRE)
		await expect(titre(page)).toHaveText('Migration ERP Sogexia')
		await expect.poll(() => niveauxVisibles(page)).toEqual([WORKSPACE, 'Conseil & IA', 'Grands comptes', 'Migration ERP Sogexia'])
		await expect(repli(page)).toBeHidden()
		await attendreSansDebordement(page)
		await capturer(page, 'fil-ligne-propre-md-900', UNITE)
	})

	test('à 390 px : seul le parent immédiat reste en ligne, le panneau mène aux autres', async ({ page }) => {
		await page.setViewportSize({ width: 390, height: 780 })
		await page.goto(AFFAIRE)
		await expect(titre(page)).toHaveText('Migration ERP Sogexia')
		await expect.poll(() => niveauxVisibles(page)).toEqual(['…', 'Grands comptes', 'Migration ERP Sogexia'])
		await attendreSansDebordement(page)

		// Ouvert au clavier, refermé par `Échap`, qui rend le focus au repli.
		await atteindreAuClavier(page, repli(page))
		await expect(repli(page)).toHaveAttribute('aria-expanded', 'false')
		await page.keyboard.press('Enter')
		await expect(panneau(page)).toBeVisible()
		await expect(repli(page)).toHaveAttribute('aria-expanded', 'true')
		await page.keyboard.press('Escape')
		await expect(panneau(page)).toHaveCount(0)
		await expect(repli(page)).toBeFocused()

		await page.keyboard.press('Enter')
		const visibles = panneau(page).getByRole('link').filter({ visible: true })
		await expect(visibles).toHaveText([WORKSPACE, 'Conseil & IA'])
		// Le panneau tient dans la fenêtre : ancré à l'en-tête, il ne sort par aucun bord (§5.43).
		const cadre = await panneau(page).boundingBox()
		expect(cadre).not.toBeNull()
		if (cadre !== null) {
			expect(cadre.x, 'bord gauche du panneau').toBeGreaterThanOrEqual(0)
			expect(cadre.x + cadre.width, 'bord droit du panneau').toBeLessThanOrEqual(390)
		}
		await capturer(page, 'fil-repli-ouvert-sm-390', UNITE)

		// Suivre un lien du panneau au clavier : le panneau se referme, la route change.
		await page.keyboard.press('Tab')
		await page.keyboard.press('Tab')
		await expect(visibles.nth(1)).toBeFocused()
		await page.keyboard.press('Enter')
		await expect(page).toHaveURL(/\/tracks\/conseil-ia$/)
		await expect(panneau(page)).toHaveCount(0)
	})

	test('la recherche ouverte sous `lg` fait céder le fil, Échap le rend', async ({ page }) => {
		await page.setViewportSize({ width: 900, height: 800 })
		await page.goto(AFFAIRE)
		await expect(fil(page)).toBeVisible()
		await page.getByTestId('ouvrir-recherche').click()
		await expect(fil(page)).toBeHidden()
		// `Échap` est écouté par le champ. Sous `lg`, la commande à icône ne lui donne pas le focus — mesuré ici, antérieur
		// à `CRM-110` et consigné (INC-284) : le scénario, qui porte sur le fil et non sur la recherche, y clique.
		await page.getByTestId('champ-recherche').click()
		await expect(page.getByTestId('champ-recherche')).toBeFocused()
		await page.keyboard.press('Escape')
		await expect(fil(page)).toBeVisible()
	})
})

// Un palier par scénario, la taille posée AVANT le premier rendu ; l'affaire au titre le plus long du seed.
test.describe('paliers responsive (§7, §12.2)', () => {
	for (const palier of PALIERS) {
		test(`palier ${palier.nom} : le titre long tient, la page ne défile pas`, async ({ page }) => {
			await page.setViewportSize({ width: palier.largeur, height: palier.hauteur })
			await connecterAvecLeLabs(page, ADMIN)
			await page.goto(AFFAIRE_LONGUE)
			await expect(titre(page)).toHaveText('Renouvellement TMA — Clinique Saint-Ambroise')
			await attendreSansDebordement(page)
			await capturer(page, `fil-affaire-longue-${palier.nom}`, UNITE)
		})
	}
})
