// @verifies CRM-093 (docs/BACKLOG.md) — tranche T5 : l'interface n'offre pas à un compte les gestes que le serveur lui
//           refuse, prouvé par rôle sur la pile réelle
// @verifies docs/SPEC-droits-interface.md §3 (la commande refusée reste montée, désactivée, et cite son motif ; seule
//           l'entrée d'un écran refusé devient un texte), §4 (les états), §5 (inventaire : familles A, E, C et P), §6
//           (« E2E par rôle, à la souris et au clavier ») ; docs/DESIGN_SYSTEM.md §5.59 ; CLAUDE.md §16
//
// LA MATRICE EST CELLE DU SEED, mesurée par la suite pgTAP `0086` et par `e2e/api/droits-interface.spec.ts` :
//
//   Camille Aubert  administratrice      administre, édite, écrit les huit channels
//   Driss Lemoine   business developer   édite ; écrit tout sauf « Maintenance », où un droit fin le restreint
//   Farida Nowak    lectrice             n'édite rien ; n'écrit que « Prospection », rouvert par un droit fin
//
// CE QUE CES SCÉNARIOS PROUVENT : l'écran OBÉIT à la capacité que la base rend — une commande refusée est désactivée
// et cite son motif, une commande permise est offerte, un geste personnel reste offert à tous. Le refus serveur reste
// prouvé hors interface par les suites existantes (CLAUDE.md §10) : ce fichier n'en est pas une.

import type { Locator } from '@playwright/test'
import { connecterAvecLeLabs, expect, test, type Page } from './fixtures'
import { capturer } from './captures'

const UNITE = 'CRM-093'
const MAINTENANCE = '/tracks/studio-web/maintenance'
const REFONTE = '/tracks/studio-web/refonte'
const PROSPECTION = '/tracks/conseil-ia/prospection'

/** Une commande refusée : montée, désactivée, et son `aria-describedby` désigne un motif visible qui dit `texte`. */
async function attendreEteinte(page: Page, commande: Locator, texte: RegExp): Promise<void> {
	await expect(commande).toBeVisible()
	await expect(commande).toBeDisabled()
	const idMotif = await commande.getAttribute('aria-describedby')
	expect(idMotif, 'la commande éteinte cite son motif').not.toBeNull()
	const motif = page.locator(`[id="${idMotif}"]`)
	await expect(motif).toBeVisible()
	await expect(motif).toContainText(texte)
}

async function attendreOfferte(commande: Locator): Promise<void> {
	await expect(commande).toBeVisible()
	await expect(commande).toBeEnabled()
	await expect(commande).not.toHaveAttribute('aria-describedby', /.+/)
}

const nouveauContact = (page: Page) => page.getByRole('button', { name: 'Nouveau contact' })
const nouveauTrack = (page: Page) => page.getByRole('button', { name: 'Nouveau track' })
const nouvelleAffaire = (page: Page) => page.getByTestId('nouvelle-affaire')
const entreeCout = (page: Page) => page.getByTestId('entree-cout-personnel')

test.describe('la lectrice — Farida Nowak', () => {
	test.beforeEach(async ({ page }) => {
		await page.setViewportSize({ width: 1440, height: 900 })
		await connecterAvecLeLabs(page, 'viewer@p2enjoy.test')
	})

	test('voit les familles A, E et C éteintes avec leur motif, et garde « Prospection », rouvert pour elle', async ({ page }) => {
		await page.goto('/contacts')
		await attendreEteinte(page, nouveauContact(page), /administrateurs et aux business developers/)

		await page.goto('/reglages/arborescence')
		await attendreEteinte(page, nouveauTrack(page), /réservées aux administrateurs/)
		// Les icônes de ligne aussi : montées, désactivées, citant le même motif.
		for (const nom of ['Modifier Studio web', 'Archiver Studio web']) {
			await attendreEteinte(page, page.getByRole('button', { name: nom }), /réservées aux administrateurs/)
		}
		await capturer(page, 'droits-lectrice-arborescence-xl-1440', UNITE)

		await page.goto(MAINTENANCE)
		await attendreEteinte(page, nouvelleAffaire(page), /Vos droits ne vous permettent pas d’en modifier les affaires/)
		await capturer(page, 'droits-lectrice-maintenance-xl-1440', UNITE)

		// Le droit fin rouvre « Prospection » en écriture : la commande est offerte, et aucun motif n'est dit.
		await page.goto(PROSPECTION)
		await attendreOfferte(nouvelleAffaire(page))
		await expect(page.getByText(/Vos droits ne vous permettent pas d’en modifier les affaires/)).toHaveCount(0)
	})

	test('au clavier : la commande éteinte ne prend pas le focus ; l’offerte s’ouvre à Entrée et se referme à Échap', async ({ page }) => {
		await page.goto(MAINTENANCE)
		const eteinte = nouvelleAffaire(page)
		await expect(eteinte).toBeDisabled()
		await eteinte.focus()
		await expect(eteinte).not.toBeFocused()

		await page.goto(PROSPECTION)
		const offerte = nouvelleAffaire(page)
		await expect(offerte).toBeEnabled()
		await offerte.focus()
		await page.keyboard.press('Enter')
		await expect(page.getByTestId('formulaire-nouvelle-affaire')).toBeVisible()
		await expect(page.getByTestId('champ-titre-affaire')).toBeFocused()
		await page.keyboard.press('Escape')
		await expect(page.getByTestId('formulaire-nouvelle-affaire')).toHaveCount(0)
	})

	test('les réglages : « Coût du personnel » est un texte qui cite son motif ; ses préférences restent à elle', async ({ page }) => {
		await page.goto('/reglages')
		// Le motif n'est dit qu'une fois la capacité LUE : l'attendre, c'est attendre l'état stable (§4).
		const motif = page.getByTestId('motif-reglages')
		await expect(motif).toContainText('« Coût du personnel » est réservé aux administrateurs')
		const entree = entreeCout(page)
		await expect(entree).toHaveAttribute('aria-disabled', 'true')
		await expect(entree).toHaveAttribute('aria-describedby', (await motif.getAttribute('id'))!)
		expect(await entree.evaluate((element) => element.tagName)).not.toBe('A')
		// Famille P : les notifications règlent le compte de qui regarde, jamais éteintes.
		await page.getByRole('link', { name: /Notifications/ }).click()
		await expect(page).toHaveURL(/\/reglages\/notifications$/)
		await capturer(page, 'droits-lectrice-notifications-xl-1440', UNITE)
	})

	test('mobile : le motif et la commande éteinte tiennent à 390 px', async ({ page }) => {
		await page.setViewportSize({ width: 390, height: 780 })
		await page.goto(MAINTENANCE)
		await attendreEteinte(page, nouvelleAffaire(page), /Vos droits ne vous permettent pas d’en modifier les affaires/)
		await capturer(page, 'droits-lectrice-maintenance-sm-390', UNITE)
	})
})

test.describe('le business developer — Driss Lemoine', () => {
	test.beforeEach(async ({ page }) => {
		await page.setViewportSize({ width: 1440, height: 900 })
		await connecterAvecLeLabs(page, 'bizdev@p2enjoy.test')
	})

	test('garde E et C, voit A éteinte ; « Maintenance », restreint par un droit fin, est éteint', async ({ page }) => {
		await page.goto('/contacts')
		await attendreOfferte(nouveauContact(page))

		await page.goto('/reglages/arborescence')
		await attendreEteinte(page, nouveauTrack(page), /réservées aux administrateurs/)
		await capturer(page, 'droits-bizdev-arborescence-xl-1440', UNITE)

		await page.goto(REFONTE)
		await attendreOfferte(nouvelleAffaire(page))

		await page.goto(MAINTENANCE)
		await attendreEteinte(page, nouvelleAffaire(page), /Vos droits ne vous permettent pas d’en modifier les affaires/)
		await capturer(page, 'droits-bizdev-maintenance-xl-1440', UNITE)

		await page.goto('/reglages')
		await expect(page.getByTestId('motif-reglages')).toBeVisible()
		await expect(entreeCout(page)).toHaveAttribute('aria-disabled', 'true')
	})
})

test.describe('l’administratrice — Camille Aubert', () => {
	test.beforeEach(async ({ page }) => {
		await page.setViewportSize({ width: 1440, height: 900 })
		await connecterAvecLeLabs(page, 'admin@p2enjoy.test')
	})

	test('garde tout : aucune commande éteinte, aucun motif', async ({ page }) => {
		await page.goto('/contacts')
		await attendreOfferte(nouveauContact(page))

		await page.goto('/reglages/arborescence')
		await attendreOfferte(nouveauTrack(page))
		await expect(page.getByTestId('motif-lecture-seule')).toHaveCount(0)

		await page.goto(MAINTENANCE)
		await attendreOfferte(nouvelleAffaire(page))
		await expect(page.getByTestId('motif-lecture-seule')).toHaveCount(0)
		await capturer(page, 'droits-admin-maintenance-xl-1440', UNITE)

		await page.goto('/reglages')
		// Pendant la lecture de la capacité, l'entrée est un texte sans motif (§4) ; lue, elle redevient un lien.
		await expect(page.locator('a[data-testid="entree-cout-personnel"]')).toBeVisible()
		await expect(page.getByTestId('motif-reglages')).toHaveCount(0)
	})
})
