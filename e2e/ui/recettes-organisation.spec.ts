// @verifies CRM-146 (docs/BACKLOG.md) — tranche T3 : le prévisionnel et le réel d'une organisation, de bout en bout sur la
//           pile réelle et le seed §41, à la souris et au clavier
// @verifies docs/SPEC-recettes.md §12.4 (la colonne « Réel sur prévu » : deux devises, la cellule vide sans recette, ce que
//           la lectrice ne lit pas ne compte pas), §12.5 (le bloc de la fiche : le tableau, les mentions, la portée, le vide
//           sans action) ; docs/SPEC-seed.md §41 ; docs/DESIGN_SYSTEM.md §5.97 (la barre `aria-hidden`, le texte porte
//           tout), §7 (aucun défilement horizontal aux quatre paliers) ; CLAUDE.md §10 (la lectrice, par l'écran ; la requête
//           directe est `e2e/api/recettes-organisation.spec.ts`), §16 (captures)
//
// LE SEED EST LU, JAMAIS ÉCRIT : Vertigo Conseil porte « Socle analytique — Vertuo » (EUR, par Marc Lefort) et « Formation
// Data & IA » (CHF, par Nadia Benali) ; « Socle analytique » compte aussi pour Atelier Lumen (par Thomas Garnier) ; Sogexia
// a une affaire sans recette ; Comptoir Vasseur n'a aucun contact.

import { connecterAvecLeLabs, expect, test, type Page } from './fixtures'
import { PALIERS, capturer } from './captures'

const UNITE = 'CRM-146'
const ADMIN = 'admin@p2enjoy.test'
const VIEWER = 'viewer@p2enjoy.test'

const ligne = (page: Page, nom: string) => page.getByTestId('ligne-organisation').filter({ hasText: nom })
const cellule = (page: Page, nom: string) => ligne(page, nom).locator('td').nth(4)
// Les montants s'écrivent avec l'espace fine insécable du format français (U+202F) : `\s` la reconnaît.

/** Tabule jusqu'au lien de ce nom : le parcours est fait au clavier, sans focalisation programmée. */
async function tabulerJusquauLien(page: Page, nom: string, maximum = 80): Promise<void> {
	for (let pas = 0; pas < maximum; pas += 1) {
		await page.keyboard.press('Tab')
		const courant = await page.evaluate(() => {
			const element = document.activeElement as HTMLElement | null
			return element?.tagName === 'A' ? (element.textContent?.trim() ?? '') : ''
		})
		if (courant === nom) return
	}
	throw new Error(`le lien « ${nom} » n'est pas atteint au clavier en ${maximum} tabulations`)
}

test.describe('la colonne « Réel sur prévu » (docs/SPEC-recettes.md §12.4)', () => {
	test('deux devises pour Vertigo Conseil, la cellule vide pour Sogexia et Comptoir Vasseur ; la fiche s’ouvre au clavier', async ({ page }) => {
		await connecterAvecLeLabs(page, ADMIN)
		await page.goto('/contacts/organisations')
		await expect(page.getByRole('columnheader', { name: 'Réel sur prévu' })).toBeVisible()

		const vertigo = cellule(page, 'Vertigo Conseil').getByTestId('reel-sur-prevu')
		await expect(vertigo).toHaveCount(2)
		await expect(vertigo.nth(0)).toHaveAttribute('data-devise', 'CHF')
		await expect(vertigo.nth(0)).toHaveText(/^14\s000,00 sur 28\s000,00\s*CHF$/u)
		await expect(vertigo.nth(1)).toHaveText(/^163\s000,00 sur 210\s000,00\s*EUR$/u)
		// La barre double le texte à l'œil seulement (§5.97).
		await expect(vertigo.nth(1).getByTestId('barre-recette')).toHaveAttribute('aria-hidden', 'true')
		await expect(cellule(page, 'Atelier Lumen')).toHaveText(/^163\s000,00 sur 210\s000,00\s*EUR$/u)
		await expect(cellule(page, 'Sogexia')).toHaveText('')
		await expect(cellule(page, 'Comptoir Vasseur')).toHaveText('')
		await capturer(page, 'recettes-organisation-liste-1440', UNITE)

		await tabulerJusquauLien(page, 'Vertigo Conseil')
		await page.keyboard.press('Enter')
		await expect(page.getByRole('heading', { level: 2, name: 'Recettes avec cette organisation' })).toBeVisible()
	})
})

test.describe('le bloc « Recettes avec cette organisation » (docs/SPEC-recettes.md §12.5)', () => {
	test('Vertigo Conseil : un tableau par devise, les mentions et la portée', async ({ page }) => {
		await connecterAvecLeLabs(page, ADMIN)
		await page.goto('/contacts/organisations')
		await ligne(page, 'Vertigo Conseil').getByRole('link', { name: 'Vertigo Conseil' }).click()
		const bloc = page.getByTestId('recettes-organisation')
		const lignes = bloc.getByTestId('ligne-recettes-organisation')
		await expect(lignes).toHaveCount(2)
		await expect(lignes.nth(0).getByRole('rowheader')).toHaveText('CHF')
		await expect(lignes.nth(0)).toContainText(/28\s000,00/u)
		await expect(lignes.nth(0)).toContainText(/14\s000,00/u)
		await expect(lignes.nth(0)).toContainText('50 %')
		await expect(lignes.nth(1)).toContainText('78 %')
		const mentions = bloc.getByTestId('mentions-recettes-organisation')
		await expect(mentions).toContainText('2 affaires comptent pour cette organisation : celles dont un contact rattaché en fait partie.')
		await expect(mentions).toContainText('Dont 1 compte aussi pour une autre organisation.')
		await expect(mentions).toContainText('Les affaires que vous lisez, hors corbeille.')
		// Le bloc vient entre les caractéristiques et les contacts, et ne porte aucun lien (§12.5).
		await expect(bloc.locator('a')).toHaveCount(0)
		await capturer(page, 'recettes-organisation-fiche-1440', UNITE)
	})

	test('Atelier Lumen : l’affaire partagée le dit ; Sogexia : le vide sans action', async ({ page }) => {
		await connecterAvecLeLabs(page, ADMIN)
		await page.goto('/contacts/organisations')
		await ligne(page, 'Atelier Lumen').getByRole('link', { name: 'Atelier Lumen' }).click()
		const bloc = page.getByTestId('recettes-organisation')
		await expect(bloc.getByTestId('ligne-recettes-organisation')).toHaveCount(1)
		await expect(bloc.getByTestId('mention-recettes-partagees')).toHaveText('Dont 1 compte aussi pour une autre organisation.')

		await page.goto('/contacts/organisations')
		await ligne(page, 'Sogexia').getByRole('link', { name: 'Sogexia' }).click()
		const vide = page.getByTestId('recettes-organisation').getByTestId('etat-vide')
		await expect(vide).toContainText('Aucune recette prévue avec cette organisation.')
		await expect(vide.locator('button, a')).toHaveCount(0)
		await expect(page.getByTestId('recettes-organisation').getByText('Les affaires que vous lisez, hors corbeille.')).toHaveCount(0)
		await capturer(page, 'recettes-organisation-vide-1440', UNITE)
	})

	test('la lectrice ne lit pas « Socle analytique » : Vertigo Conseil en CHF seulement, Atelier Lumen vide', async ({ page }) => {
		await connecterAvecLeLabs(page, VIEWER)
		await page.goto('/contacts/organisations')
		const vertigo = cellule(page, 'Vertigo Conseil').getByTestId('reel-sur-prevu')
		await expect(vertigo).toHaveCount(1)
		await expect(vertigo).toHaveAttribute('data-devise', 'CHF')
		await expect(cellule(page, 'Atelier Lumen')).toHaveText('')
		await capturer(page, 'recettes-organisation-lectrice-1440', UNITE)
		await ligne(page, 'Vertigo Conseil').getByRole('link', { name: 'Vertigo Conseil' }).click()
		const mentions = page.getByTestId('mentions-recettes-organisation')
		await expect(mentions).toContainText('1 affaire compte pour cette organisation : celle dont un contact rattaché en fait partie.')
		await expect(page.getByTestId('mention-recettes-partagees')).toHaveCount(0)
	})
})

test.describe('les paliers (docs/DESIGN_SYSTEM.md §7)', () => {
	for (const palier of PALIERS) {
		test(`aucun défilement horizontal, liste et fiche — ${palier.nom}`, async ({ page }) => {
			await page.setViewportSize({ width: palier.largeur, height: palier.hauteur })
			await connecterAvecLeLabs(page, ADMIN)
			await page.goto('/contacts/organisations')
			await expect(cellule(page, 'Vertigo Conseil').getByTestId('reel-sur-prevu')).toHaveCount(2)
			await capturer(page, `recettes-organisation-liste-${palier.nom}`, UNITE)
			expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0)
			await ligne(page, 'Vertigo Conseil').getByRole('link', { name: 'Vertigo Conseil' }).click()
			await expect(page.getByTestId('tableau-recettes-organisation')).toBeVisible()
			await capturer(page, `recettes-organisation-fiche-${palier.nom}`, UNITE)
			expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0)
		})
	}
})
