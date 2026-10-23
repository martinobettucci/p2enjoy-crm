// @verifies CRM-070 (docs/BACKLOG.md) — tranche T2 : Réglages ▸ Membres sur la pile réelle, par rôle
// @verifies docs/SPEC-membres.md §3 (consultable par tout membre, commandes éteintes par la capacité d'administration),
//           §3.1 (le rôle écrit au choix, le retrait confirmé, soi-même, le dernier administrateur), §3.4 (refus
//           traduits), §6 (E2E par rôle) ; docs/DESIGN_SYSTEM.md §5.61, §5.59 ; CLAUDE.md §16 (captures observées)
//
// LE SEED : Camille Aubert seule administratrice de l'espace de démonstration, Driss Lemoine business developer, Farida
// Nowak lectrice. Chaque scénario qui écrit REND l'état du seed avant de finir : le rôle de Farida revient à « Lecteur »,
// et le seul retrait tenté est celui que la base refuse — celui de la dernière administratrice.

import { ERREUR_RESSOURCE_HTTP, autoriserErreursConsole, connecterAvecLeLabs, expect, test, type Page } from './fixtures'
import { capturer } from './captures'

const UNITE = 'CRM-070'
const MEMBRES = '/reglages/membres'

const role = (page: Page, nom: string) => page.getByLabel(`Rôle de ${nom}`)
const retirer = (page: Page, nom: string) => page.getByRole('button', { name: `Retirer ${nom} de l’espace` })
const message = (page: Page) => page.getByTestId('message-membres')

test.describe('l’administratrice — Camille Aubert', () => {
	test.beforeEach(async ({ page }) => {
		await page.setViewportSize({ width: 1440, height: 900 })
		await connecterAvecLeLabs(page, 'admin@p2enjoy.test')
	})

	test('arrive par l’index des réglages, lit la liste, administrateurs d’abord', async ({ page }) => {
		await page.goto('/reglages')
		await page.getByRole('link', { name: /Membres : personnes et rôles/ }).click()
		await expect(page).toHaveURL(MEMBRES)
		const lignes = page.getByTestId('ligne-membre')
		await expect(lignes).toHaveCount(3)
		await expect(lignes.nth(0)).toContainText('Camille Aubert')
		await expect(lignes.nth(1)).toContainText('Driss Lemoine')
		await expect(lignes.nth(2)).toContainText('Farida Nowak')
		await expect(page.getByTestId('motif-membres')).toHaveCount(0)
		await expect(retirer(page, 'Driss Lemoine')).toBeEnabled()
		await capturer(page, 'membres-administratrice-1440', UNITE)
	})

	test('change le rôle de Farida au clavier, le voit relu, puis le rend', async ({ page }) => {
		await page.goto(MEMBRES)
		const selecteur = role(page, 'Farida Nowak')
		await expect(selecteur).toHaveValue('viewer')
		await selecteur.focus()
		await selecteur.selectOption('business_developer')
		await expect(message(page)).toHaveText('Rôle de Farida Nowak modifié.')
		await expect(message(page)).toHaveAttribute('role', 'status')
		await page.reload()
		await expect(role(page, 'Farida Nowak')).toHaveValue('business_developer')
		await capturer(page, 'membres-role-change-1440', UNITE)
		await role(page, 'Farida Nowak').selectOption('viewer')
		await expect(message(page)).toHaveText('Rôle de Farida Nowak modifié.')
		await page.reload()
		await expect(role(page, 'Farida Nowak')).toHaveValue('viewer')
	})

	test('la dernière administratrice : changer son rôle est refusé par la base, et dit pourquoi', async ({ page }) => {
		await page.goto(MEMBRES)
		await role(page, 'Camille Aubert').selectOption('viewer')
		await expect(message(page)).toContainText('Un espace garde au moins un administrateur')
		await expect(message(page)).toHaveAttribute('role', 'alert')
		await expect(role(page, 'Camille Aubert')).toHaveValue('admin')
		// Le refus de la base (400, `last_workspace_admin`) est celui que l'écran vient de traduire.
		autoriserErreursConsole(page, [ERREUR_RESSOURCE_HTTP[400]])
		await capturer(page, 'membres-refus-dernier-admin-1440', UNITE)
	})

	test('se retirer : la confirmation le dit, Échap l’annule et rend le focus, et la base refuse la dernière administratrice', async ({ page }) => {
		await page.goto(MEMBRES)
		const commande = retirer(page, 'Camille Aubert')
		await commande.click()
		const confirmation = page.getByRole('group', { name: /Retirer Camille Aubert de l’espace/ })
		await expect(confirmation).toContainText('C’est votre propre compte')
		await expect(confirmation.getByRole('button', { name: 'Retirer de l’espace' })).toBeFocused()
		await capturer(page, 'membres-confirmation-soi-1440', UNITE)
		await page.keyboard.press('Escape')
		await expect(confirmation).toHaveCount(0)
		await expect(commande).toBeFocused()

		await commande.click()
		await page.getByRole('button', { name: 'Retirer de l’espace' }).click()
		await expect(message(page)).toContainText('Un espace garde au moins un administrateur')
		await expect(page.getByTestId('ligne-membre')).toHaveCount(3)
		autoriserErreursConsole(page, [ERREUR_RESSOURCE_HTTP[400]])
	})

	for (const [largeur, palier] of [
		[390, 'sm'],
		[900, 'md'],
		[1152, 'lg'],
	] as const) {
		test(`palier ${palier} (${largeur} px) : le tableau défile dans son conteneur, jamais la page`, async ({ page }) => {
			await page.setViewportSize({ width: largeur, height: 900 })
			await page.goto(MEMBRES)
			await expect(page.getByTestId('ligne-membre')).toHaveCount(3)
			const deborde = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
			expect(deborde, 'la page ne défile pas horizontalement').toBe(false)
			await capturer(page, `membres-palier-${palier}-${largeur}`, UNITE)
		})
	}
})

test.describe('la lectrice — Farida Nowak', () => {
	test('consulte la liste ; chaque commande est éteinte, lisible, et cite le motif', async ({ page }) => {
		await page.setViewportSize({ width: 1440, height: 900 })
		await connecterAvecLeLabs(page, 'viewer@p2enjoy.test')
		await page.goto('/reglages')
		await page.getByRole('link', { name: /Membres : personnes et rôles/ }).click()
		const motif = page.getByTestId('motif-membres')
		await expect(motif).toContainText('réservées aux administrateurs de l’espace')
		const idMotif = await motif.getAttribute('id')
		for (const commande of [role(page, 'Driss Lemoine'), retirer(page, 'Driss Lemoine'), retirer(page, 'Farida Nowak')]) {
			await expect(commande).toBeDisabled()
			await expect(commande).toHaveAttribute('aria-describedby', idMotif ?? '')
		}
		await expect(role(page, 'Driss Lemoine')).toHaveValue('business_developer')
		await capturer(page, 'membres-lectrice-1440', UNITE)
	})
})
