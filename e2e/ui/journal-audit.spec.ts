// @verifies CRM-072 (docs/BACKLOG.md) — tranche T2 : Réglages ▸ Journal d'audit sur la pile réelle, par rôle
// @verifies docs/SPEC-audit.md §3.2 (seuls les administrateurs lisent), §4.1 (un geste de droits journalisé avec son
//           acteur), §8 (l'écran, ses filtres dans l'adresse) ; docs/DESIGN_SYSTEM.md §5.66 (entrée d'index, tableau, filtres,
//           paliers), §5.59 (l'entrée devient un texte pour qui n'administre pas) ; CLAUDE.md §16 (captures observées)
// @verifies CRM-092 (docs/BACKLOG.md), docs/SPEC-session-sso.md §13 — connexion par la vraie page du SSO
//
// LE GESTE ÉPROUVÉ EST CELUI DE L'ÉCRAN DES MEMBRES : Camille pose à Farida un droit de lecture sur le track « Formation »,
// puis le rend à « hérité ». Le seed n'en porte aucun, et la spec des membres ne touche pas ce track : l'état du seed est
// rendu, et le journal, en ajout seul, garde les deux entrées.

import { connecterAvecLeLabs, expect, test } from './fixtures'
import { PALIERS, capturer } from './captures'

const UNITE = 'CRM-072'
const JOURNAL = '/reglages/journal'
const FARIDA = '5eed0000-0000-4000-8000-000000000013'

test.describe('l’administratrice — Camille Aubert', () => {
	test.beforeEach(async ({ page }) => {
		await page.setViewportSize({ width: 1440, height: 900 })
		await connecterAvecLeLabs(page, 'admin@p2enjoy.test')
	})

	test('l’index mène au journal, rendu en tableau à quatre colonnes', async ({ page }) => {
		await page.goto('/reglages')
		await page.getByTestId('entree-journal').click()
		await expect(page).toHaveURL(/\/reglages\/journal$/)
		await expect(page.getByRole('heading', { name: 'Journal d’audit', level: 2 })).toBeVisible()
		const tableau = page.getByTestId('tableau-audit')
		await expect(tableau.getByRole('columnheader')).toHaveText(['Date', 'Acteur', 'Geste', 'Détail'])
		await expect(page.getByTestId('ligne-audit').first()).toBeVisible()
		await capturer(page, 'journal-1440', UNITE)
	})

	test('un droit posé à l’écran des membres paraît au journal, avec Camille pour actrice, puis son retrait', async ({ page }) => {
		await page.goto('/reglages/membres')
		const droits = page.getByTestId('droits-fins')
		await droits.getByLabel('Membre').selectOption(FARIDA)
		const formation = droits.getByLabel('Droit posé sur Formation')
		await formation.selectOption('viewer')
		await expect(droits.getByTestId('message-droits')).toHaveText('Droit de Farida Nowak sur « Formation » : Lecture.')
		await formation.selectOption('herite')
		await expect(droits.getByTestId('message-droits')).toHaveText('Droit de Farida Nowak sur « Formation » : Hérité.')

		await page.goto(`${JOURNAL}?famille=access`)
		const lignes = page.getByTestId('ligne-audit')
		await expect(lignes.first()).toHaveAttribute('data-geste', 'track_access.revoked')
		await expect(lignes.first()).toContainText('Camille Aubert')
		await expect(lignes.first()).toContainText('Accès à un track retiré : Farida Nowak')
		await expect(lignes.first()).toContainText('Accès retiré : Lecture')
		await expect(lignes.nth(1)).toHaveAttribute('data-geste', 'track_access.granted')
		await expect(lignes.nth(1)).toContainText('Accès : Lecture')
		await capturer(page, 'journal-droit-pose-1440', UNITE)
	})

	test('le filtre de famille s’écrit dans l’adresse et ne garde que ses entrées', async ({ page }) => {
		await page.goto(JOURNAL)
		await expect(page.getByTestId('ligne-audit').first()).toBeVisible()
		await page.getByLabel('Famille').selectOption({ label: 'Connexions' })
		await expect(page).toHaveURL(/\?famille=sign_in$/)
		const familles = await page.getByTestId('ligne-audit').evaluateAll((lignes) => lignes.map((l) => l.getAttribute('data-famille')))
		expect(familles.length).toBeGreaterThan(0)
		expect(new Set(familles)).toEqual(new Set(['sign_in']))
		await expect(page.getByTestId('ligne-audit').first()).toContainText('Connexion')
		await capturer(page, 'journal-filtre-connexions-1440', UNITE)
	})

	test('les quatre paliers : le tableau défile dans son conteneur, jamais la page', async ({ page }) => {
		for (const palier of PALIERS) {
			await page.setViewportSize({ width: palier.largeur, height: palier.hauteur })
			await page.goto(JOURNAL)
			await expect(page.getByTestId('ligne-audit').first()).toBeVisible()
			const deborde = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
			expect(deborde, `la page ne défile pas horizontalement à ${palier.largeur} px`).toBe(false)
			await capturer(page, `journal-${palier.nom}`, UNITE)
		}
	})
})

test.describe('la lectrice — Farida Nowak', () => {
	test('l’entrée d’index est un texte, et l’adresse directe rend « Réservé aux administrateurs »', async ({ page }) => {
		await page.setViewportSize({ width: 1440, height: 900 })
		await connecterAvecLeLabs(page, 'viewer@p2enjoy.test')
		await page.goto('/reglages')
		const entree = page.getByTestId('entree-journal')
		await expect(entree).toHaveAttribute('aria-disabled', 'true')
		await expect(page.getByRole('link', { name: /Journal d’audit/ })).toHaveCount(0)
		await page.goto(JOURNAL)
		await expect(page.getByText('Réservé aux administrateurs')).toBeVisible()
		await expect(page.getByTestId('tableau-audit')).toHaveCount(0)
		await capturer(page, 'journal-refus-lectrice-1440', UNITE)
	})
})
