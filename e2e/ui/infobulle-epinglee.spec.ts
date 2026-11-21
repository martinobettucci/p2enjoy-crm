// @verifies CRM-148 (docs/BACKLOG.md) — l'infobulle de description épinglée, dans l'application réelle : son texte long défile
//           sans la fermer ; un clic dans elle l'épingle et fait paraître la croix ; épinglée, ni le pointeur qui part, ni
//           un clic ailleurs, ni le défilement ne la ferment, et elle suit son élément ; la croix et `Échap` la ferment ; au
//           clavier, `Flèche bas` l'épingle, `Tab` va du texte à la croix, `Échap` rend le focus ; l'étape (CRM-133) aussi ;
//           le cadre borné à la fenêtre aux quatre paliers, et les captures
// @verifies docs/DESIGN_SYSTEM.md §5.58, « Épinglée — CRM-148 » ; docs/JOURNAL.md décision 929 ; CLAUDE.md §15, §16
//
// UNE DESCRIPTION LONGUE EST POSÉE PAR LA CLÉ DE SERVICE sur le channel « Grands comptes », le temps de la preuve, et la
// sienne lui est rendue à la fin : la plus longue du seed tient sans défiler (§5.58). Rien d'autre n'est écrit.
// *Révisé le 2026-11-21 (`CRM-161` T2.a, docs/SPEC-espace-courant.md §15.5, décision 51)* : les pages d'un espace sont sous
// le slug de l'espace (`/p2enjoy/…`) ; les adresses et leurs attentes suivent, sans changer ce que la preuve prouve.

import type { APIRequestContext } from '@playwright/test'
import { connecterAvecLeLabs, expect, test, type Page } from './fixtures'
import { PALIERS, capturer } from './captures'
import { URL_API, enTetesService } from '../api/jetons'

const UNITE = 'CRM-148'
const ADMIN = 'admin@p2enjoy.test'
const MARGE = 16
const BOARD = '/p2enjoy/tracks/conseil-ia/grands-comptes'
const CHANNEL = '5eed0000-0000-4000-8000-000000000032'
const LONGUE = Array.from(
	{ length: 18 },
	(_, rang) =>
		`Point ${rang + 1} : les comptes stratégiques sont suivis par un interlocuteur dédié, qui tient le plan de compte à jour.`,
).join('\n')

const bulle = (page: Page) => page.getByTestId('infobulle')
const texte = (page: Page) => page.getByTestId('infobulle-texte')
const croix = (page: Page) => page.getByRole('button', { name: 'Fermer la description de Grands comptes' })
const onglet = (page: Page) => page.locator('[data-testid="onglet-channel"][data-slug="grands-comptes"]')

async function description(request: APIRequestContext): Promise<string | null> {
	const reponse = await request.get(`${URL_API}/rest/v1/channels?select=description&id=eq.${CHANNEL}`, {
		headers: enTetesService(),
	})
	return ((await reponse.json()) as { description: string | null }[])[0]?.description ?? null
}

async function poser(request: APIRequestContext, valeur: string | null): Promise<void> {
	const reponse = await request.patch(`${URL_API}/rest/v1/channels?id=eq.${CHANNEL}`, {
		headers: enTetesService(),
		data: { description: valeur },
	})
	expect(reponse.status(), await reponse.text()).toBeLessThan(300)
}

async function cadreDansLaFenetre(page: Page): Promise<void> {
	const cadre = await bulle(page).boundingBox()
	const fenetre = page.viewportSize()
	expect(cadre).not.toBeNull()
	if (cadre === null || fenetre === null) return
	expect(cadre.x, 'bord gauche').toBeGreaterThanOrEqual(MARGE - 0.5)
	expect(cadre.x + cadre.width, 'bord droit').toBeLessThanOrEqual(fenetre.width - MARGE + 0.5)
	expect(cadre.y + cadre.height, 'bord bas').toBeLessThanOrEqual(fenetre.height - MARGE + 0.5)
}

async function atteindreAuClavier(page: Page): Promise<void> {
	await page.locator('body').focus()
	for (let pas = 0; pas < 80; pas += 1) {
		await page.keyboard.press('Tab')
		if (await onglet(page).evaluate((element) => element === document.activeElement)) return
	}
	throw new Error('l’onglet n’a pas été atteint par `Tab` en 80 pas')
}

let origine: string | null = null

test.beforeAll(async ({ request }) => {
	origine = await description(request)
	await poser(request, LONGUE)
})

test.afterAll(async ({ request }) => {
	await poser(request, origine)
})

test.beforeEach(async ({ page }) => {
	await page.setViewportSize({ width: 1440, height: 900 })
	await connecterAvecLeLabs(page, ADMIN)
	await page.goto(BOARD)
	await expect(onglet(page)).toBeVisible()
})

test('à la souris : le texte défile sans la fermer, un clic l’épingle, elle tient, elle suit, la croix la ferme', async ({ page }) => {
	await onglet(page).hover()
	await expect(bulle(page)).toBeVisible()
	await expect(croix(page)).toHaveCount(0)

	// LA CAUSE DU DÉFAUT : la molette sur le texte le fait défiler, et la bulle reste ouverte.
	await texte(page).hover()
	await page.mouse.wheel(0, 200)
	await expect.poll(() => texte(page).evaluate((element) => element.scrollTop)).toBeGreaterThan(0)
	await expect(bulle(page)).toBeVisible()

	// UN CLIC DANS LA BULLE L'ÉPINGLE : la croix paraît.
	await texte(page).click()
	await expect(bulle(page)).toHaveAttribute('data-epinglee', 'true')
	await expect(croix(page)).toBeVisible()
	await expect(page.getByRole('dialog', { name: 'Grands comptes' })).toBeVisible()
	await capturer(page, 'infobulle-epinglee-xl-1440', UNITE)

	// ÉPINGLÉE, ELLE TIENT : le pointeur qui part, un clic ailleurs.
	await page.mouse.move(1400, 880)
	await page.waitForTimeout(400)
	await expect(bulle(page)).toBeVisible()
	await page.mouse.click(1400, 880)
	await expect(bulle(page)).toBeVisible()

	// ELLE SUIT SON ÉLÉMENT au redimensionnement, bornée à la fenêtre.
	await page.setViewportSize({ width: 1200, height: 900 })
	await expect(bulle(page)).toBeVisible()
	await cadreDansLaFenetre(page)

	// LA CROIX LA FERME.
	await croix(page).click()
	await expect(bulle(page)).toHaveCount(0)
})

test('au clavier : `Flèche bas` l’épingle, le texte défile aux flèches, `Tab` va à la croix et revient, `Échap` rend le focus', async ({ page }) => {
	await atteindreAuClavier(page)
	await expect(bulle(page)).toBeVisible()
	await page.keyboard.press('ArrowDown')
	await expect(bulle(page)).toHaveAttribute('data-epinglee', 'true')
	const region = page.getByRole('region', { name: 'Description de Grands comptes' })
	await expect(region).toBeFocused()
	await page.keyboard.press('PageDown')
	await expect.poll(() => texte(page).evaluate((element) => element.scrollTop)).toBeGreaterThan(0)
	await page.keyboard.press('Tab')
	await expect(croix(page)).toBeFocused()
	await capturer(page, 'infobulle-epinglee-clavier-xl-1440', UNITE)
	await page.keyboard.press('Tab')
	await expect(region).toBeFocused()
	await page.keyboard.press('Escape')
	await expect(bulle(page)).toHaveCount(0)
	await expect(onglet(page)).toBeFocused()
	// Rendu à l'élément, le focus ne rouvre pas la bulle.
	await page.waitForTimeout(500)
	await expect(bulle(page)).toHaveCount(0)
})

test('l’étape aussi (CRM-133) : un clic dans sa bulle l’épingle, la croix la ferme', async ({ page }) => {
	const bouton = page.getByRole('button', { name: 'Description de l’étape Négociation' })
	await bouton.hover()
	await expect(bulle(page)).toBeVisible()
	await bulle(page).click()
	await expect(page.getByRole('button', { name: 'Fermer la description de Négociation' })).toBeVisible()
	await page.mouse.move(1400, 880)
	await expect(bulle(page)).toBeVisible()
	await page.getByRole('button', { name: 'Fermer la description de Négociation' }).click()
	await expect(bulle(page)).toHaveCount(0)
})

test.describe('les quatre paliers', () => {
	for (const palier of PALIERS) {
		test(`palier ${palier.nom} : la bulle épinglée tient dans la fenêtre, croix comprise`, async ({ page }) => {
			await page.setViewportSize({ width: palier.largeur, height: palier.hauteur })
			await page.goto(BOARD)
			// Sous 768 px, l'onglet reste dans la barre défilante : il est amené en vue avant le survol.
			await onglet(page).scrollIntoViewIfNeeded()
			await onglet(page).hover()
			await expect(bulle(page)).toBeVisible()
			await texte(page).click()
			await expect(croix(page)).toBeVisible()
			await cadreDansLaFenetre(page)
			const largeurs = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth])
			expect(largeurs[0], 'la page ne défile jamais horizontalement (§7)').toBeLessThanOrEqual(largeurs[1]!)
			await capturer(page, `infobulle-epinglee-${palier.nom}`, UNITE)
		})
	}
})
