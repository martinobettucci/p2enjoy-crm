// @verifies CRM-105 (docs/BACKLOG.md) — l'infobulle de description, dans l'application réelle et sur le seed
// @verifies docs/DESIGN_SYSTEM.md §5.58 (les quatre emplacements ; rien sans description ; le nom en tête ;
//           survol après le délai, focus clavier, jamais au clic ; survolable ; `Échap` ; cadre borné à la
//           fenêtre avec 16 px de marge, aux quatre paliers ; à droite de la pilule, sous l'onglet) ; §5.43
//           (la preuve de palier mesure le cadre de la surface flottante elle-même)
// @verifies docs/SPEC-seed.md §20 (deux tracks, trois channels, trois affaires décrits ; les autres non)
// @verifies docs/SPEC-tracks.md §7, docs/SPEC-channels.md §5, docs/SPEC-workflow-engine.md §7.2,
//           docs/SPEC-cards.md §12.3 (la description vient des lectures réelles, sans réponse substituée)
// @verifies CLAUDE.md §16 (vérification visuelle) ; CRM-092, docs/SPEC-session-sso.md §13 (connexion réelle)
//
// Aucune réponse n'est substituée : la pile réelle et le seed rendent les descriptions. Le survol est celui
// de la souris de Playwright, le clavier celui de `Tab` — la bulle ne s'ouvre qu'au focus CLAVIER, et un
// focus posé par script ne prouverait rien.

import type { Locator } from '@playwright/test'
import { connecterAvecLeLabs, expect, test, type Page } from './fixtures'
import { PALIERS, capturer } from './captures'

const UNITE = 'CRM-105'
const ADMIN = 'admin@p2enjoy.test'
const MARGE = 16

const BOARD_GRANDS_COMPTES = '/tracks/conseil-ia/grands-comptes'
const LISTE_MAINTENANCE = '/tracks/studio-web/maintenance/liste'
const CARD_DECRITE = '5eed0000-0000-4000-8000-0000000000c2'
const CARD_NUE = '5eed0000-0000-4000-8000-0000000000c1'
const CARD_LONGUE = '5eed0000-0000-4000-8000-00000000d002'

const DESCRIPTION_TRACK =
	"Missions de conseil et de mise en œuvre de l'intelligence artificielle : diagnostic, prototype, déploiement."
const DESCRIPTION_CHANNEL = 'Clients stratégiques suivis par un interlocuteur dédié, sur des cycles de décision longs.'

const bulle = (page: Page) => page.getByTestId('infobulle')
const pilule = (page: Page, slug: string) => page.locator(`[data-testid="entree-track"][data-slug="${slug}"]`)
const onglet = (page: Page, slug: string) => page.locator(`[data-testid="onglet-channel"][data-slug="${slug}"]`)
const titreCarte = (page: Page, id: string) => page.locator(`[data-testid="carte-card"][data-card="${id}"] a`).first()
const titreLigne = (page: Page, id: string) => page.locator(`[data-testid="ligne-card"][data-card="${id}"] a`).first()

/** Le cadre de la bulle tient dans la fenêtre, marge comprise — nommé par sa coordonnée fautive (§5.43). */
async function attendreCadreDansLaFenetre(page: Page): Promise<void> {
	const cadre = await bulle(page).boundingBox()
	const fenetre = page.viewportSize()
	expect(cadre, 'la bulle est rendue').not.toBeNull()
	expect(fenetre).not.toBeNull()
	if (cadre === null || fenetre === null) return
	expect(cadre.x, 'bord gauche de la bulle').toBeGreaterThanOrEqual(MARGE - 0.5)
	expect(cadre.y, 'bord haut de la bulle').toBeGreaterThanOrEqual(MARGE - 0.5)
	expect(cadre.x + cadre.width, 'bord droit de la bulle').toBeLessThanOrEqual(fenetre.width - MARGE + 0.5)
	expect(cadre.y + cadre.height, 'bord bas de la bulle').toBeLessThanOrEqual(fenetre.height - MARGE + 0.5)
}

/** Atteint l'élément par `Tab` seul, comme un utilisateur au clavier, en partant du haut du document. */
async function atteindreAuClavier(page: Page, cible: Locator): Promise<void> {
	await page.locator('body').focus()
	for (let pas = 0; pas < 80; pas += 1) {
		await page.keyboard.press('Tab')
		if (await cible.evaluate((element) => element === document.activeElement)) return
	}
	throw new Error('la cible n’a pas été atteinte par `Tab` en 80 pas')
}

/** Retire le pointeur de tout élément, pour qu'aucun survol ne parasite la mesure suivante. */
async function eloignerLaSouris(page: Page): Promise<void> {
	// Le coin haut droit : l'en-tête n'y porte aucune infobulle de description.
	await page.mouse.move((page.viewportSize()?.width ?? 1440) - 2, 2)
	await expect(bulle(page)).toHaveCount(0)
}

test.beforeEach(async ({ page }) => {
	await page.setViewportSize({ width: 1440, height: 900 })
	await connecterAvecLeLabs(page, ADMIN)
})

test.describe('la pilule d’un track (barre latérale)', () => {
	test('un track décrit ouvre au survol une bulle à sa droite, qui le nomme puis le décrit', async ({ page }) => {
		await page.goto(BOARD_GRANDS_COMPTES)
		const conseil = pilule(page, 'conseil-ia')
		await expect(conseil).toBeVisible()
		// La bulle remplace le `title` natif : deux infobulles superposées se liraient comme un défaut.
		expect(await conseil.getAttribute('title')).toBeNull()

		await conseil.hover()
		await expect(bulle(page)).toBeVisible()
		await expect(bulle(page).locator('p').first()).toHaveText('Conseil & IA')
		await expect(bulle(page).locator('p').nth(1)).toHaveText(DESCRIPTION_TRACK)
		const cadrePilule = await conseil.boundingBox()
		const cadreBulle = await bulle(page).boundingBox()
		expect(cadreBulle?.x ?? 0, 'la bulle est à droite de la pilule').toBeGreaterThan(
			(cadrePilule?.x ?? 0) + (cadrePilule?.width ?? 0),
		)
		await attendreCadreDansLaFenetre(page)
		await capturer(page, 'infobulle-track-xl-1440', UNITE)
	})

	test('un track sans description n’ouvre rien et garde son `title`', async ({ page }) => {
		await page.goto(BOARD_GRANDS_COMPTES)
		const formation = pilule(page, 'formation')
		await expect(formation).toHaveAttribute('title', 'Formation')
		await formation.hover()
		await page.waitForTimeout(900) // deux fois le délai d'ouverture : une absence se mesure après lui
		await expect(bulle(page)).toHaveCount(0)
	})

	test('au palier « colonne d’icônes », la bulle porte le nom que le libellé masqué ne montre plus', async ({
		page,
	}) => {
		await page.setViewportSize({ width: 1152, height: 800 })
		await page.goto(BOARD_GRANDS_COMPTES)
		await pilule(page, 'conseil-ia').hover()
		await expect(bulle(page).locator('p').first()).toHaveText('Conseil & IA')
		await attendreCadreDansLaFenetre(page)
		await capturer(page, 'infobulle-track-lg-1152', UNITE)
	})

	test('un clic navigue sans laisser de bulle sur l’écran d’arrivée', async ({ page }) => {
		await page.goto('/tracks/studio-web')
		await pilule(page, 'conseil-ia').click()
		await expect(page).toHaveURL(/\/tracks\/conseil-ia/)
		await page.waitForTimeout(900)
		await expect(bulle(page)).toHaveCount(0)
	})
})

test.describe('l’onglet d’un channel', () => {
	test('un onglet décrit ouvre une bulle sous lui ; un onglet nu n’ouvre rien', async ({ page }) => {
		await page.goto(BOARD_GRANDS_COMPTES)
		const grands = onglet(page, 'grands-comptes')
		await grands.hover()
		await expect(bulle(page).locator('p').nth(1)).toHaveText(DESCRIPTION_CHANNEL)
		const cadreOnglet = await grands.boundingBox()
		const cadreBulle = await bulle(page).boundingBox()
		expect(cadreBulle?.y ?? 0, 'la bulle est sous l’onglet').toBeGreaterThan(
			(cadreOnglet?.y ?? 0) + (cadreOnglet?.height ?? 0),
		)
		await attendreCadreDansLaFenetre(page)
		await capturer(page, 'infobulle-onglet-xl-1440', UNITE)

		await eloignerLaSouris(page)
		await page.goto('/tracks/studio-web/refonte')
		const refonte = onglet(page, 'refonte')
		await expect(refonte).toHaveAttribute('title', 'Refonte de site')
		await refonte.hover()
		await page.waitForTimeout(900)
		await expect(bulle(page)).toHaveCount(0)
	})

	test('au clavier : `Tab` l’ouvre sans délai, `Échap` la ferme sans déplacer le focus', async ({ page }) => {
		await page.goto(BOARD_GRANDS_COMPTES)
		const grands = onglet(page, 'grands-comptes')
		await atteindreAuClavier(page, grands)
		await expect(bulle(page)).toBeVisible()
		await expect(bulle(page).locator('p').first()).toHaveText('Grands comptes')
		await capturer(page, 'infobulle-onglet-clavier-xl-1440', UNITE)

		await page.keyboard.press('Escape')
		await expect(bulle(page)).toHaveCount(0)
		expect(await grands.evaluate((element) => element === document.activeElement)).toBe(true)

		// Le lecteur d'écran n'attend pas la bulle : la description est citée, fermée ou non.
		const id = await grands.getAttribute('aria-describedby')
		expect(id).not.toBeNull()
		await expect(page.locator(`[id="${id}"]`)).toHaveText(DESCRIPTION_CHANNEL)
	})

	test('survolable : le pointeur passe de l’onglet à la bulle sans la fermer', async ({ page }) => {
		await page.goto(BOARD_GRANDS_COMPTES)
		await onglet(page, 'grands-comptes').hover()
		await expect(bulle(page)).toBeVisible()
		const cadre = await bulle(page).boundingBox()
		if (cadre === null) throw new Error('bulle sans cadre')
		await page.mouse.move(cadre.x + cadre.width / 2, cadre.y + cadre.height / 2, { steps: 4 })
		await page.waitForTimeout(600)
		await expect(bulle(page)).toBeVisible()
		await eloignerLaSouris(page)
	})
})

test.describe('le titre d’une affaire', () => {
	test('sur la carte du board : la description garde son retour à la ligne ; une carte nue n’ouvre rien', async ({
		page,
	}) => {
		await page.goto(BOARD_GRANDS_COMPTES)
		await titreCarte(page, CARD_DECRITE).hover()
		await expect(bulle(page).locator('p').first()).toHaveText('Migration ERP Sogexia')
		const texte = await bulle(page).locator('p').nth(1).innerText()
		expect(texte.split('\n'), 'deux lignes rendues').toHaveLength(2)
		await attendreCadreDansLaFenetre(page)
		await capturer(page, 'infobulle-carte-board-xl-1440', UNITE)

		await eloignerLaSouris(page)
		await titreCarte(page, CARD_NUE).hover()
		await page.waitForTimeout(900)
		await expect(bulle(page)).toHaveCount(0)
	})

	test('dans la ligne de la vue liste : la donnée longue tient dans son cadre et défile en elle-même', async ({
		page,
	}) => {
		await page.goto(LISTE_MAINTENANCE)
		const titre = titreLigne(page, CARD_LONGUE)
		await expect(titre).toBeVisible()
		expect(await titre.getAttribute('title')).toBeNull()
		await titre.hover()
		await expect(bulle(page).locator('p').first()).toHaveText('Renouvellement TMA — Clinique Saint-Ambroise')
		const cadre = await bulle(page).boundingBox()
		expect(cadre?.height ?? 0, 'hauteur bornée à 320 px').toBeLessThanOrEqual(320.5)
		await attendreCadreDansLaFenetre(page)
		await capturer(page, 'infobulle-ligne-longue-xl-1440', UNITE)
	})
})

test.describe('le cadre aux quatre paliers (§5.58, §5.43)', () => {
	for (const palier of PALIERS) {
		test(`palier ${palier.nom} : la bulle d’une ligne longue et celle d’un onglet tiennent dans la fenêtre`, async ({
			page,
		}) => {
			await page.setViewportSize({ width: palier.largeur, height: palier.hauteur })
			await page.goto(LISTE_MAINTENANCE)
			const titre = titreLigne(page, CARD_LONGUE)
			await titre.scrollIntoViewIfNeeded()
			await titre.hover()
			await expect(bulle(page)).toBeVisible()
			await attendreCadreDansLaFenetre(page)
			await capturer(page, `infobulle-ligne-longue-${palier.nom}`, UNITE)

			await eloignerLaSouris(page)
			const maintenance = onglet(page, 'maintenance')
			await maintenance.scrollIntoViewIfNeeded()
			await maintenance.hover()
			await expect(bulle(page)).toBeVisible()
			await attendreCadreDansLaFenetre(page)
			// La page ne défile jamais horizontalement (§7).
			const deborde = await page.evaluate(
				() => document.documentElement.scrollWidth > document.documentElement.clientWidth,
			)
			expect(deborde).toBe(false)
		})
	}
})
