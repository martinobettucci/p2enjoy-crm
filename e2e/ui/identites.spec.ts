// @verifies CRM-022 (docs/BACKLOG.md) — identités exhaustives vues par une utilisatrice réelle
// @verifies docs/SPEC-identite.md §7 (surfaces UI), §10 (preuve souris/clavier et captures)
// @verifies docs/DESIGN_SYSTEM.md §7, §8, §11 — responsive, accessibilité, console silencieuse

import { expect, test, type Page } from './fixtures'
import { MOT_DE_PASSE_SEED } from '../api/jetons'
import { capturer } from './captures'

const ADMIN = 'admin@p2enjoy.test'
const CARD_SUPPORT = 'Support niveau 2 — Atelier Meunier'

async function connecter(page: Page): Promise<void> {
	await page.getByLabel('Adresse email').click()
	await page.keyboard.type(ADMIN)
	await page.keyboard.press('Tab')
	await page.keyboard.type(MOT_DE_PASSE_SEED)
	await page.keyboard.press('Enter')
	await expect(page.getByRole('button', { name: 'Se déconnecter' })).toBeVisible()
}

test('Camille parcourt le board, la liste et la fiche avec toutes les identités consenties', async ({
	page,
}) => {
	const avatars = new Map<string, number>()
	page.on('response', (reponse) => {
		const chemin = new URL(reponse.url()).pathname
		if (chemin.startsWith('/avatars/')) avatars.set(chemin, reponse.status())
	})

	await page.setViewportSize({ width: 1440, height: 900 })
	await page.goto('/connexion')
	await connecter(page)

	const session = page.getByTestId('identite-session')
	await expect(session).toContainText('Camille Aubert')
	await expect(session.getByText('Camille Aubert', { exact: true })).toHaveAttribute('title', ADMIN)
	await expect(session.locator('img')).toHaveAttribute('src', '/avatars/camille-aubert.svg')

	// Navigation de produit uniquement : le parcours ne tape aucune route interne et ne substitue
	// aucune réponse. Le track, le channel, la vue et la card sont activés comme par l'utilisatrice.
	await page.getByRole('link', { name: 'Studio web' }).click()
	await page.getByRole('link', { name: 'Maintenance' }).click()
	await expect(page.getByRole('link', { name: CARD_SUPPORT })).toBeVisible()
	const avatarBoard = page.getByRole('img', { name: 'Responsable : Farida Nowak' })
	await expect(avatarBoard).toBeVisible()
	await expect(avatarBoard).toHaveAttribute('src', '/avatars/farida-nowak.svg')
	await capturer(page, 'identites-board-1440', 'CRM-022')

	await page.getByRole('link', { name: 'Liste', exact: true }).click()
	const ligne = page.getByTestId('ligne-card').filter({ hasText: CARD_SUPPORT })
	await expect(ligne).toContainText('Farida Nowak')
	await expect(ligne.locator('img')).toHaveAttribute('src', '/avatars/farida-nowak.svg')
	await capturer(page, 'identites-liste-1440', 'CRM-022')

	await ligne.getByRole('link', { name: CARD_SUPPORT }).click()
	await expect(page.getByRole('heading', { name: 'Historique et discussion' })).toBeVisible()
	await expect(page.getByText('Farida Nowak', { exact: true })).toBeVisible()
	await expect(page.getByText('par Camille Aubert', { exact: true }).first()).toBeVisible()
	await expect(page.getByText('Compte supprimé', { exact: true })).toHaveCount(0)
	await expect(page.getByText('Auteur indisponible', { exact: true })).toHaveCount(0)
	await capturer(page, 'identites-fiche-1440', 'CRM-022')

	await expect
		.poll(() => avatars.get('/avatars/camille-aubert.svg'))
		.toBe(200)
	await expect.poll(() => avatars.get('/avatars/farida-nowak.svg')).toBe(200)

	await page.setViewportSize({ width: 390, height: 780 })
	// Le passage depuis le desktop déclenche la transition CSS du tiroir. Attendre sa position
	// finale évite de figer une capture intermédiaire qui ressemble à un écran rogné.
	await expect
		.poll(async () => (await page.getByTestId('barre-laterale').boundingBox())?.x ?? 0)
		.toBeLessThan(-200)
	await page.keyboard.press('End')
	await expect(page.getByText('Farida Nowak', { exact: true })).toBeVisible()
	const debordement = await page.evaluate(
		() => document.documentElement.scrollWidth - document.documentElement.clientWidth,
	)
	expect(debordement, 'la fiche d’identité mobile ne défile pas horizontalement').toBeLessThanOrEqual(0)
	await capturer(page, 'identites-fiche-390', 'CRM-022')
})
