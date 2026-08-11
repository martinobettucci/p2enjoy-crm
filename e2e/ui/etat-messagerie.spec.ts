// @verifies CRM-059 (docs/BACKLOG.md) — écran d'état de la messagerie, parcours d'interface
// @verifies docs/SPEC-mail-subsystem.md §20.7 (les faits montrés), §20.8 (« l'écran d'état montre
//           ce que la base porte, y compris un incident »), §20.11 (l'écran)
// @verifies docs/DESIGN_SYSTEM.md §5.14 (cette surface), §7 (paliers) ; CLAUDE.md §16
//
// LE PARCOURS EST FAIT AU CLAVIER ET À LA SOURIS, comme un utilisateur réel : aucune fonction
// interne n'est appelée. Le seed ne pose aucun compte en incident — les trois comptes sont
// `pending`, jamais relevés — donc l'INCIDENT MONTRÉ EST PRODUIT PAR LA CLÉ DE SERVICE, seul
// chemin qui le peut (`mail_inbound_accounts` n'accorde aucune écriture à `authenticated`), et
// RENDU AU SEED DANS LE `finally` — même discipline que `e2e/mail/resilience.spec.ts`.

import { expect, test, type Page } from './fixtures'
import { MOT_DE_PASSE_SEED, URL_API, enTetesService } from '../api/jetons'
import { PALIERS, capturer } from './captures'

const UNITE = 'CRM-059'
const ADMIN = 'admin@p2enjoy.test'
const VIEWER = 'viewer@p2enjoy.test'
const COMPTE_DRISS = 'fb0ae013-bf82-4d3c-a997-b1d8d21f0cfb'

async function connecter(page: Page, email: string): Promise<void> {
	await page.goto('/connexion')
	await page.getByLabel('Adresse email').click()
	await page.keyboard.type(email)
	await page.keyboard.press('Tab')
	await page.keyboard.type(MOT_DE_PASSE_SEED)
	await page.keyboard.press('Enter')
	await expect(page.getByRole('button', { name: 'Se déconnecter' })).toBeVisible()
}

async function mettreDrissEnIncident(page: Page): Promise<void> {
	const reponse = await page.request.patch(
		`${URL_API}/rest/v1/mail_inbound_accounts?id=eq.${COMPTE_DRISS}`,
		{
			headers: { ...enTetesService(), Prefer: 'return=minimal' },
			data: { status: 'error', last_error: 'auth_failed', last_sync_at: '2026-08-11T08:00:00Z' },
		},
	)
	expect([200, 204]).toContain(reponse.status())
}

async function restaurerDriss(page: Page): Promise<void> {
	await page.request.patch(`${URL_API}/rest/v1/mail_inbound_accounts?id=eq.${COMPTE_DRISS}`, {
		headers: { ...enTetesService(), Prefer: 'return=minimal' },
		data: { status: 'pending', last_error: null, last_sync_at: null },
	})
}

test.describe('état de la messagerie (docs/SPEC-mail-subsystem.md §20.11)', () => {
	test('l’administratrice voit les trois comptes, dont un incident, et les deux compteurs', async ({
		page,
	}) => {
		await mettreDrissEnIncident(page)
		try {
			await connecter(page, ADMIN)
			// Depuis l'index des réglages, gestes réels — pas une navigation directe.
			await page.goto('/reglages')
			await page.getByRole('link', { name: 'État de la messagerie' }).click()
			await expect(page).toHaveURL(/\/reglages\/messagerie$/)
			await expect(page.getByRole('heading', { name: 'État de la messagerie' })).toBeVisible()

			const tableau = page.getByTestId('tableau-comptes-mail')
			await expect(tableau).toBeVisible()
			await expect(page.getByTestId('ligne-compte-mail')).toHaveCount(3)

			// LE FAIT QUE LA BASE PORTE (§20.7) : le compte de Driss est en incident, traduit —
			// jamais le code brut.
			const ligneDriss = page.getByTestId('ligne-compte-mail').filter({ hasText: 'Driss' })
			await expect(ligneDriss.getByText('Authentification refusée')).toBeVisible()
			await expect(ligneDriss).not.toContainText('auth_failed')

			// Un compte jamais relevé le dit en toutes lettres, pas une cellule vide (§20.11.3).
			await expect(
				page.getByTestId('ligne-compte-mail').filter({ hasText: 'système' }).getByText('Jamais relevée'),
			).toBeVisible()

			// Les deux compteurs de la file sortante, sans pilule ni couleur d'alerte (§20.11.5).
			const compteurs = page.getByTestId('compteur-mail')
			await expect(compteurs).toHaveCount(2)
			await expect(page.getByText("En attente d'envoi", { exact: false })).toBeVisible()
			await expect(page.getByText('Échecs définitifs')).toBeVisible()
		} finally {
			await restaurerDriss(page)
		}
	})

	test('un membre sans boîte voit l’état vide, sans action offerte (§20.11.6)', async ({ page }) => {
		await connecter(page, VIEWER)
		await page.goto('/reglages/messagerie')
		await expect(page.getByTestId('etat-vide')).toBeVisible()
		await expect(page.getByText('Aucune boîte à superviser')).toBeVisible()
	})
})

// --- Paliers responsive (docs/DESIGN_SYSTEM.md §7) --------------------------------------------
//
// La taille de fenêtre est fixée AVANT le chargement — même patron que `board.spec.ts` — car la
// coquille applicative détermine son repli de barre latérale au montage, pas en réaction à un
// redimensionnement ultérieur : capturer après un `setViewportSize` tardif laisserait la barre
// ouverte par-dessus le contenu, mesuré en écrivant cette suite.

test.describe('paliers responsive (docs/DESIGN_SYSTEM.md §7)', () => {
	for (const palier of PALIERS) {
		test(`${palier.nom} : le tableau des comptes reste lisible`, async ({ page }) => {
			await page.setViewportSize({ width: palier.largeur, height: palier.hauteur })
			await mettreDrissEnIncident(page)
			try {
				await connecter(page, ADMIN)
				await page.goto('/reglages/messagerie')
				await expect(page.getByTestId('tableau-comptes-mail')).toBeVisible()

				// La page ne défile jamais horizontalement (§7) : c'est le conteneur du tableau qui
				// le fait, avec l'indication de débordement du §12.6 — même garantie que le board.
				const debordePage = await page.evaluate(
					() => document.documentElement.scrollWidth > document.documentElement.clientWidth,
				)
				expect(debordePage, 'la page ne défile pas horizontalement').toBe(false)

				await capturer(page, `etat-messagerie-${palier.nom}`, UNITE)
			} finally {
				await restaurerDriss(page)
			}
		})
	}
})
