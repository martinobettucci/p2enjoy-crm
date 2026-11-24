// @verifies CRM-161 (docs/BACKLOG.md) — tranche T3.c : l'onglet « Organisations » et Temps ▸ Rapport de tous les espaces,
//           à la souris et au clavier — la colonne « Espace », la dernière ; le filtre « Espace » par la lecture
//           (organisations) et en mémoire (rapport) ; un seul panneau ouvert ; les cases « Tracks » groupées par espace,
//           puis celles du seul espace choisi ; « Dans l'espace X » sur la création ; la lectrice d'un seul espace, qui ne
//           voit rien de tout cela ; les quatre paliers, filtre ouvert. Le vide sous le filtre : celui des organisations est
//           inatteignable sur le seed (chaque espace a des organisations), celui du rapport est prouvé à l'unité
// @verifies docs/SPEC-espace-courant.md §16.2, §16.8.3 ; docs/DESIGN_SYSTEM.md §5.115, §5.105, §5.28, §5.54, §7 ;
//           docs/manual.md §4, §28.4 ; CLAUDE.md §16 (vérification visuelle)
//
// Sur le seed (docs/SPEC-seed.md §54) : Camille (`admin@`) lit « P2Enjoy SAS » (sept organisations) et « Studio Lumen »
// (deux : « Maison Arlo », et « Vertigo Conseil », homonyme de celle du seed ; le track « Productions », une saisie de
// 90 minutes de Camille au jour du seed). La lectrice ne lit que le premier. Rien n'est écrit : la création est ouverte puis
// annulée. Les refus de la base sont prouvés par `e2e/api/organisations-espaces.spec.ts`.

import { connecterAvecLeLabs, expect, test, type Page } from './fixtures'
import { CLE_SERVICE, URL_API } from '../api/jetons'
import { PALIERS, capturer } from './captures'

const ADMIN = 'admin@p2enjoy.test'
const VIEWER = 'viewer@p2enjoy.test'
const UNITE = 'CRM-161'

/** Le mois de la saisie de « Studio Lumen » : le jour du seed, lu par la clé de service (aucune preuve de droit ici). */
async function moisDeLaSaisieLumen(page: Page): Promise<string> {
	const enTetes = { apikey: CLE_SERVICE, Authorization: `Bearer ${CLE_SERVICE}` }
	const espaces = (await (await page.request.get(`${URL_API}/rest/v1/workspaces?select=id&slug=eq.studio-lumen`, { headers: enTetes })).json()) as { id: string }[]
	const saisies = (await (
		await page.request.get(`${URL_API}/rest/v1/saisies_temps?select=jour&workspace_id=eq.${espaces[0]!.id}&order=jour.desc&limit=1`, { headers: enTetes })
	).json()) as { jour: string }[]
	return saisies[0]!.jour.slice(0, 7)
}

/** `Tab` jusqu'à l'élément voulu, comme une personne au clavier ; échoue s'il n'est pas atteint en `max` pressions. */
async function tabulerJusqua(page: Page, cible: ReturnType<Page['getByRole']>, max = 12) {
	for (let i = 0; i < max; i++) {
		await page.keyboard.press('Tab')
		if (await cible.evaluate((el) => el === document.activeElement)) return
	}
	throw new Error('élément non atteint au clavier')
}

test.describe('`CRM-161` T3.c — les organisations de tous les espaces (docs/DESIGN_SYSTEM.md §5.115)', () => {
	test('à la souris : la colonne « Espace », isoler un espace par la lecture, les cases groupées puis restreintes', async ({ page }) => {
		await connecterAvecLeLabs(page, ADMIN)
		await page.goto('/contacts/organisations')
		const lignes = page.getByTestId('ligne-organisation')
		await expect(lignes).toHaveCount(9)
		await expect(page.getByRole('columnheader').last()).toHaveText('Espace')
		await expect(lignes.filter({ hasText: 'Maison Arlo' }).getByTestId('espace-organisation')).toHaveText('Studio Lumen')
		await expect(lignes.filter({ hasText: 'Sogexia' }).getByTestId('espace-organisation')).toHaveText('P2Enjoy SAS')
		// DEUX HOMONYMES, UN PAR ESPACE : la colonne est ce qui les distingue.
		// Leur ordre est celui de leur identifiant (le tri total de la liste) : comparé trié.
		const homonymes = lignes.filter({ hasText: 'Vertigo Conseil' }).getByTestId('espace-organisation')
		await expect(homonymes).toHaveCount(2)
		expect((await homonymes.allTextContents()).sort()).toEqual(['P2Enjoy SAS', 'Studio Lumen'])
		await expect(page.getByTestId('compte-organisations')).toContainText('9')
		await expect(page.getByTestId('espace-des-gestes')).toHaveText('Dans l’espace P2Enjoy SAS')
		await capturer(page, 'organisations-espaces-1440', UNITE)

		// LES CASES « Tracks » DES DEUX ESPACES, groupées sous leur nom ; un seul panneau ouvert à la fois.
		await page.getByTestId('ouvrir-filtre-tracks').click()
		const groupes = page.getByTestId('panneau-filtre-tracks').getByTestId('groupe-cases-espace')
		await expect(groupes).toHaveCount(2)
		await expect(groupes.locator('legend')).toHaveText(['P2Enjoy SAS', 'Studio Lumen'])
		await expect(groupes.nth(1).getByRole('checkbox', { name: 'Productions' })).toBeVisible()
		await capturer(page, 'organisations-tracks-groupes-1440', UNITE)

		const bouton = page.getByRole('button', { name: 'Espace', exact: true })
		await bouton.click()
		await expect(page.getByTestId('panneau-filtre-tracks')).toHaveCount(0)
		await expect(bouton).toHaveAttribute('aria-expanded', 'true')
		await page.getByTestId('panneau-filtre-espaces').getByRole('checkbox', { name: 'Studio Lumen' }).check()
		await expect(page).toHaveURL(/[?&]espaces=studio-lumen/)
		await expect(lignes).toHaveCount(2)
		await expect(lignes.getByTestId('espace-organisation')).toHaveText(['Studio Lumen', 'Studio Lumen'])
		await expect(page.getByTestId('compte-organisations')).toContainText('2')
		await capturer(page, 'organisations-filtre-lumen-1440', UNITE)
		await page.reload()
		await expect(lignes).toHaveCount(2)

		// Une portée d'un espace : ses seules cases, sans groupe.
		await page.getByTestId('ouvrir-filtre-tracks').click()
		const panneauTracks = page.getByTestId('panneau-filtre-tracks')
		await expect(panneauTracks.getByTestId('groupe-cases-espace')).toHaveCount(0)
		await expect(panneauTracks.getByRole('checkbox')).toHaveCount(1)
		await expect(panneauTracks.getByRole('checkbox', { name: 'Productions' })).toBeVisible()

		// La création reste dans l'espace de l'onglet, quel que soit le filtre, et le dit.
		await page.getByTestId('ouvrir-creation-organisation').click()
		await expect(page.getByTestId('espace-creation-organisation')).toHaveText('Dans l’espace P2Enjoy SAS')
		await capturer(page, 'organisations-creation-espace-1440', UNITE)
		await page.keyboard.press('Escape')

		await page.getByRole('button', { name: 'Espace (1)' }).click()
		await page.getByTestId('panneau-filtre-espaces').getByRole('checkbox', { name: 'Studio Lumen' }).uncheck()
		await expect(page).not.toHaveURL(/espaces=/)
		await expect(lignes).toHaveCount(9)
	})

	test('au clavier : ouvrir, cocher à l’espace, replier par Échap, le focus rendu au bouton', async ({ page }) => {
		await connecterAvecLeLabs(page, ADMIN)
		await page.goto('/contacts/organisations')
		await expect(page.getByTestId('ligne-organisation')).toHaveCount(9)
		const bouton = page.getByRole('button', { name: 'Espace', exact: true })
		await bouton.focus()
		await page.keyboard.press('Enter')
		await expect(bouton).toHaveAttribute('aria-expanded', 'true')
		const caseP2enjoy = page.getByRole('checkbox', { name: 'P2Enjoy SAS' })
		await tabulerJusqua(page, caseP2enjoy)
		await page.keyboard.press('Space')
		await expect(page).toHaveURL(/[?&]espaces=p2enjoy/)
		await expect(page.getByTestId('ligne-organisation')).toHaveCount(7)
		await page.keyboard.press('Escape')
		await expect(page.getByTestId('panneau-filtre-espaces')).toHaveCount(0)
		await expect(page.getByRole('button', { name: 'Espace (1)' })).toBeFocused()
	})

	test('la lectrice d’un seul espace : la liste d’avant, ni bouton « Espace », ni colonne, ni mention', async ({ page }) => {
		await connecterAvecLeLabs(page, VIEWER)
		await page.goto('/contacts/organisations')
		await expect(page.getByTestId('ligne-organisation')).toHaveCount(7)
		await expect(page.getByRole('columnheader')).toHaveCount(5)
		await expect(page.getByTestId('ouvrir-filtre-espaces')).toHaveCount(0)
		await expect(page.getByTestId('espace-organisation')).toHaveCount(0)
		await expect(page.getByTestId('espace-des-gestes')).toHaveCount(0)
		await page.getByTestId('ouvrir-filtre-tracks').click()
		await expect(page.getByTestId('panneau-filtre-tracks').getByTestId('groupe-cases-espace')).toHaveCount(0)
	})

	test('les quatre paliers, filtre ouvert : captures produites, et aucun débordement horizontal de la page', async ({ page }) => {
		await connecterAvecLeLabs(page, ADMIN)
		for (const palier of PALIERS) {
			await page.setViewportSize({ width: palier.largeur, height: palier.hauteur })
			await page.goto('/contacts/organisations')
			await expect(page.getByTestId('ligne-organisation')).toHaveCount(9)
			await page.getByRole('button', { name: 'Espace', exact: true }).click()
			await expect(page.getByTestId('panneau-filtre-espaces')).toBeVisible()
			const deborde = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)
			expect(deborde, `débordement horizontal à ${palier.nom}`).toBe(false)
			await capturer(page, `organisations-filtre-${palier.nom}`, UNITE)
		}
	})
})

test.describe('`CRM-161` T3.c — Temps ▸ Rapport de tous les espaces (docs/DESIGN_SYSTEM.md §5.115, §5.54)', () => {
	test('la colonne « Espace », la dernière ; le filtre en mémoire, le total des espaces choisis', async ({ page }) => {
		await connecterAvecLeLabs(page, ADMIN)
		const mois = await moisDeLaSaisieLumen(page)
		await page.goto(`/temps?onglet=rapport&mois=${mois}`)
		await expect(page.getByTestId('temps-rapport')).toBeVisible()
		const lignes = page.getByTestId('temps-rapport-ligne')
		const productions = lignes.filter({ hasText: 'Productions' })
		await expect(productions.getByTestId('temps-rapport-espace')).toHaveText('Studio Lumen')
		await expect(page.getByTestId('temps-rapport').getByRole('columnheader').last()).toHaveText('Espace')
		await capturer(page, 'temps-rapport-espaces-1440', UNITE)

		const bouton = page.getByRole('button', { name: 'Espace', exact: true })
		await bouton.click()
		await page.getByTestId('panneau-filtre-espaces').getByRole('checkbox', { name: 'Studio Lumen' }).check()
		await expect(page).toHaveURL(/[?&]espaces=studio-lumen/)
		await expect(lignes).toHaveCount(1)
		await expect(lignes.getByTestId('temps-rapport-espace')).toHaveText('Studio Lumen')
		await expect(page.getByTestId('temps-rapport-total')).toHaveText('1 h 30')
		await capturer(page, 'temps-rapport-filtre-lumen-1440', UNITE)
		// Le vide sous le filtre du rapport est prouvé par `webapp/src/app/RapportTemps.test.tsx` : le seed n'a pas de mois au
		// temps de « P2Enjoy SAS » seul qui soit stable d'un rejeu à l'autre.
	})

	test('au clavier, puis la lectrice d’un seul espace : ni bouton, ni colonne', async ({ page }) => {
		await connecterAvecLeLabs(page, ADMIN)
		const mois = await moisDeLaSaisieLumen(page)
		await page.goto(`/temps?onglet=rapport&mois=${mois}`)
		await expect(page.getByTestId('temps-rapport-ligne').first()).toBeVisible()
		const bouton = page.getByRole('button', { name: 'Espace', exact: true })
		await bouton.focus()
		await page.keyboard.press('Enter')
		await tabulerJusqua(page, page.getByRole('checkbox', { name: 'Studio Lumen' }))
		await page.keyboard.press('Space')
		await expect(page.getByTestId('temps-rapport-ligne')).toHaveCount(1)
		await page.keyboard.press('Escape')
		await expect(page.getByRole('button', { name: 'Espace (1)' })).toBeFocused()

		await page.context().clearCookies()
		await connecterAvecLeLabs(page, VIEWER)
		await page.goto(`/temps?onglet=rapport&mois=${mois}`)
		await expect(page.getByTestId('temps-rapport')).toBeVisible()
		await expect(page.getByTestId('ouvrir-filtre-espaces')).toHaveCount(0)
		await expect(page.getByTestId('temps-rapport-espace')).toHaveCount(0)
	})

	test('les quatre paliers du rapport, filtre ouvert : aucun débordement horizontal de la page', async ({ page }) => {
		await connecterAvecLeLabs(page, ADMIN)
		const mois = await moisDeLaSaisieLumen(page)
		for (const palier of PALIERS) {
			await page.setViewportSize({ width: palier.largeur, height: palier.hauteur })
			await page.goto(`/temps?onglet=rapport&mois=${mois}`)
			await expect(page.getByTestId('temps-rapport-ligne').first()).toBeVisible()
			await page.getByRole('button', { name: 'Espace', exact: true }).click()
			await expect(page.getByTestId('panneau-filtre-espaces')).toBeVisible()
			const deborde = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)
			expect(deborde, `débordement horizontal à ${palier.nom}`).toBe(false)
			await capturer(page, `temps-rapport-filtre-${palier.nom}`, UNITE)
		}
	})
})
