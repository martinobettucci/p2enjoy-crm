// @verifies CRM-070 (docs/BACKLOG.md) — tranche T2 : Réglages ▸ Membres sur la pile réelle, par rôle
// @verifies docs/SPEC-membres.md §3 (consultable par tout membre, commandes éteintes par la capacité d'administration),
//           §3.1 (le rôle écrit au choix, le retrait confirmé, soi-même, le dernier administrateur), §3.4 (refus
//           traduits), §6 (E2E par rôle) ; docs/DESIGN_SYSTEM.md §5.61, §5.59 ; CLAUDE.md §16 (captures observées)
// @verifies CRM-070 (docs/BACKLOG.md) — tranche T3 : la section « Attentes » sur la pile réelle — inscrire au clavier,
//           remplacer, retirer ; absente pour la lectrice ; docs/SPEC-membres.md §3.2 ; docs/DESIGN_SYSTEM.md §5.61
// @verifies CRM-070 (docs/BACKLOG.md) — tranche T4 : la matrice des droits fins sur la pile réelle — l'accès effectif rendu
//           par la base, un droit posé puis retiré au clavier, l'administratrice jamais restreinte ; absente pour la
//           lectrice ; docs/SPEC-membres.md §3.3
//
// LE SEED : Camille Aubert seule administratrice de l'espace de démonstration, Driss Lemoine business developer, Farida
// Nowak lectrice. Chaque scénario qui écrit REND l'état du seed avant de finir : le rôle de Farida revient à « Lecteur »,
// et le seul retrait tenté est celui que la base refuse — celui de la dernière administratrice. L'attente du seed,
// `attendu@p2enjoy.test`, n'est jamais touchée : le scénario des attentes inscrit, remplace et retire sa propre adresse.

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

	test('inscrit une attente au clavier, la remplace, puis la retire ; l’attente du seed reste', async ({ page }) => {
		const ADRESSE = 'e2e-membres@p2enjoy.test'
		await page.goto(MEMBRES)
		const section = page.getByRole('region', { name: 'Attentes' })
		await expect(section.getByTestId('ligne-attente')).toHaveCount(1)
		await expect(section.getByTestId('ligne-attente')).toHaveAttribute('data-email', 'attendu@p2enjoy.test')

		const inscrire = async (role: string) => {
			await section.getByTestId('inscrire-attente').focus()
			await page.keyboard.press('Enter')
			await expect(section.getByLabel('Adresse')).toBeFocused()
			await page.keyboard.type(ADRESSE)
			await section.locator('select#attente-role').selectOption(role)
			await section.getByRole('button', { name: 'Inscrire', exact: true }).click()
		}
		await inscrire('business_developer')
		await expect(section.getByTestId('message-attentes')).toHaveText(`Attente de ${ADRESSE} inscrite.`)
		await expect(section.locator(`[data-email="${ADRESSE}"]`)).toContainText('Business developer')
		await expect(section.locator(`[data-email="${ADRESSE}"]`)).toContainText('Camille Aubert')
		await capturer(page, 'attentes-inscrite-1440', UNITE)

		await inscrire('admin')
		await expect(section.getByTestId('message-attentes')).toHaveText(
			`Attente de ${ADRESSE} remplacée : Business developer devient Administrateur.`,
		)
		await expect(section.locator(`[data-email="${ADRESSE}"]`)).toContainText('Administrateur')
		await expect(section.getByTestId('ligne-attente')).toHaveCount(2)

		await section.getByRole('button', { name: `Retirer l’attente de ${ADRESSE}` }).click()
		await expect(section.getByTestId('message-attentes')).toHaveText(`Attente de ${ADRESSE} retirée.`)
		await expect(section.getByTestId('ligne-attente')).toHaveCount(1)
		await expect(section.getByTestId('ligne-attente')).toHaveAttribute('data-email', 'attendu@p2enjoy.test')
	})

	test('droits fins : la matrice de Farida, un droit posé puis rendu à « hérité », l’administratrice jamais restreinte', async ({ page }) => {
		await page.goto(MEMBRES)
		const droits = page.getByTestId('droits-fins')
		// Le premier membre qui n'administre pas est choisi d'abord : Driss Lemoine, dans l'ordre de la liste.
		await expect(droits.getByLabel('Membre')).toHaveValue('5eed0000-0000-4000-8000-000000000012')
		await expect(droits.getByRole('row', { name: /^Maintenance/ }).getByTestId('acces-effectif')).toHaveText('Lecture')
		await droits.getByLabel('Membre').selectOption({ label: 'Farida Nowak' })
		const effectif = (nom: string) => droits.getByRole('row', { name: new RegExp(`^${nom}`) }).getByTestId('acces-effectif')
		await expect(effectif('Conseil & IA')).toHaveText('Aucun accèsLisible par l’un de ses channels')
		await expect(effectif('Prospection')).toHaveText('Écriture')
		await expect(effectif('Grands comptes')).toHaveText('Aucun accès')
		await capturer(page, 'droits-fins-farida-1440', UNITE)

		const grandsComptes = droits.getByLabel('Droit posé sur Grands comptes')
		await grandsComptes.focus()
		await grandsComptes.selectOption('viewer')
		await expect(droits.getByTestId('message-droits')).toHaveText('Droit de Farida Nowak sur « Grands comptes » : Lecture.')
		await expect(effectif('Grands comptes')).toHaveText('Lecture')
		await grandsComptes.selectOption('herite')
		await expect(droits.getByTestId('message-droits')).toHaveText('Droit de Farida Nowak sur « Grands comptes » : Hérité.')
		await expect(effectif('Grands comptes')).toHaveText('Aucun accès')

		await droits.getByLabel('Membre').selectOption({ label: 'Camille Aubert' })
		await expect(droits.getByTestId('droits-administrateur')).toContainText('n’est jamais restreint')
		await expect(effectif('Conseil & IA')).toHaveText('Écriture')
		await expect(droits.getByLabel('Droit posé sur Conseil & IA')).toBeDisabled()
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
		// Les attentes sont réservées à l'administrateur : la section est absente, sans phrase qui dirait qu'elle existe.
		await expect(page.getByRole('heading', { name: 'Attentes' })).toHaveCount(0)
		await expect(page.getByTestId('inscrire-attente')).toHaveCount(0)
		await expect(page.getByTestId('droits-fins')).toHaveCount(0)
		await capturer(page, 'membres-lectrice-1440', UNITE)
	})
})
