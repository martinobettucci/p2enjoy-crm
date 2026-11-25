// @verifies CRM-161 (docs/BACKLOG.md) — tranche T3.d : le Pilotage et Temps ▸ Saisie de tous les espaces, à la souris et au
//           clavier — Pilotage : le bouton « Espace » en tête, la tête sur tous les espaces affichés, une section par espace,
//           la portée offerte quand le filtre en isole un seul et gardant le filtre ; Saisie : les lignes groupées par espace,
//           chaque cellule écrite dans l'espace de sa ligne (vérifié en base), le total du jour tous espaces et l'annonce du
//           dépassement, « Saisir pour » groupé par espace administré ; la lectrice d'un seul espace, qui ne voit rien de tout
//           cela ; les quatre paliers, filtre ouvert
// @verifies docs/SPEC-espace-courant.md §16.9.1, §16.9.2 ; docs/DESIGN_SYSTEM.md §5.115, §5.48, §5.48 bis, §5.54, §7 ;
//           docs/manual.md §28, §30 ; décisions 981 et 982 ; CLAUDE.md §16 (vérification visuelle)
//
// Sur le seed (docs/SPEC-seed.md §54) : Camille (`admin@`) lit « P2Enjoy SAS » et « Studio Lumen » (un track « Productions »,
// son channel « Tournages », l'affaire « Clip — Maison Arlo », une saisie de 90 minutes le 20 novembre 2026) ; la lectrice ne
// lit que le premier. Les saisies d'écriture se posent la semaine du 14 juillet 2025, hors de toute fenêtre du seed, et sont
// retirées par la clé de service après chaque test ; les lectures du Pilotage n'écrivent rien.

import { connecterAvecLeLabs, expect, test, type Page } from './fixtures'
import { CLE_SERVICE, URL_API } from '../api/jetons'
import { PALIERS, capturer } from './captures'

const ADMIN = 'admin@p2enjoy.test'
const VIEWER = 'viewer@p2enjoy.test'
const UNITE = 'CRM-161'
const CAMILLE = '5eed0000-0000-4000-8000-000000000011'
const P2ENJOY = '5eed0000-0000-4000-8000-000000000001'
const SEMAINE = '2025-07-14'
const PERIODE = 'jour=gte.2025-07-14&jour=lte.2025-07-20'
const SERVICE = { apikey: CLE_SERVICE, Authorization: `Bearer ${CLE_SERVICE}` }
const rest = (chemin: string) => `${URL_API}/rest/v1/${chemin}`

test.use({ viewport: { width: 1440, height: 900 } })

test.afterEach(async ({ request }) => {
	await request.delete(rest(`saisies_temps?${PERIODE}`), { headers: SERVICE })
})

/** `Tab` jusqu'à l'élément voulu, comme une personne au clavier ; échoue s'il n'est pas atteint en `max` pressions. */
async function tabulerJusqua(page: Page, cible: ReturnType<Page['getByRole']>, max = 12) {
	for (let i = 0; i < max; i++) {
		await page.keyboard.press('Tab')
		if (await cible.evaluate((el) => el === document.activeElement)) return
	}
	throw new Error('élément non atteint au clavier')
}

test.describe('`CRM-161` T3.d — le Pilotage de tous les espaces (docs/DESIGN_SYSTEM.md §5.115, §5.48)', () => {
	test('à la souris : le bouton en tête, la tête sur les deux espaces, une section par espace, la portée quand un seul est isolé', async ({ page }) => {
		await connecterAvecLeLabs(page, ADMIN)
		await page.goto('/pilotage')
		const sections = page.getByTestId('pilotage-espace')
		await expect(sections).toHaveCount(2)
		await expect(sections.locator('h2').first()).toHaveText('P2Enjoy SAS')
		await expect(sections.locator('h2').last()).toHaveText('Studio Lumen')
		// La tête précède les sections, et le bouton « Espace » précède la tête (§5.115) ; aucune portée sans espace isolé.
		const ordre = await page.evaluate(() => {
			const bouton = document.querySelector('[data-testid="ouvrir-filtre-espaces"]')
			const tete = document.querySelector('[data-testid="pilotage-grandeurs"]')
			const section = document.querySelector('[data-testid="pilotage-espace"]')
			const avant = (a: Element | null, b: Element | null) => !!a && !!b && !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)
			return { boutonAvantTete: avant(bouton, tete), teteAvantSections: avant(tete, section) }
		})
		expect(ordre).toEqual({ boutonAvantTete: true, teteAvantSections: true })
		await expect(page.getByTestId('pilotage-selecteur-portee')).toHaveCount(0)
		// « Studio Lumen » : l'affaire « Clip — Maison Arlo » à « Prospection », et ses autres étapes nommées dans SON catalogue.
		const lumen = sections.filter({ hasText: 'Studio Lumen' })
		await expect(lumen.getByTestId('pilotage-ligne')).toHaveCount(1)
		await expect(lumen.getByTestId('pilotage-ligne').first()).toContainText('Prospection')
		await expect(lumen.getByTestId('pilotage-noeuds-vides')).toContainText('Relance')
		await capturer(page, 'pilotage-espaces-1440', UNITE)

		await page.getByRole('button', { name: 'Espace', exact: true }).click()
		await page.getByTestId('panneau-filtre-espaces').getByRole('checkbox', { name: 'Studio Lumen' }).check()
		await expect(page).toHaveURL(/[?&]espaces=studio-lumen/)
		await expect(sections).toHaveCount(1)
		// La portée s'offre, avec le track de l'espace isolé seul.
		const selecteur = page.getByTestId('pilotage-selecteur-portee')
		await expect(selecteur).toBeVisible()
		await expect(selecteur.locator('optgroup')).toHaveCount(1)
		await expect(selecteur.locator('optgroup').first()).toHaveAttribute('label', 'Productions')
		await capturer(page, 'pilotage-filtre-lumen-1440', UNITE)

		// Choisir une portée GARDE le filtre « Espace » dans l'adresse.
		await selecteur.selectOption({ label: 'Productions — tout le track' })
		await expect(page).toHaveURL(/espaces=studio-lumen/)
		await expect(page).toHaveURL(/track=productions/)
		await expect(page.getByRole('button', { name: 'Espace (1)' })).toBeVisible()
		await page.reload()
		await expect(sections).toHaveCount(1)
		await expect(selecteur).toHaveValue(/productions/)
	})

	test('au clavier : ouvrir, cocher à l’espace, replier par Échap, le focus rendu au bouton', async ({ page }) => {
		await connecterAvecLeLabs(page, ADMIN)
		await page.goto('/pilotage')
		await expect(page.getByTestId('pilotage-espace')).toHaveCount(2)
		const bouton = page.getByRole('button', { name: 'Espace', exact: true })
		await bouton.focus()
		await page.keyboard.press('Enter')
		await expect(bouton).toHaveAttribute('aria-expanded', 'true')
		await tabulerJusqua(page, page.getByRole('checkbox', { name: 'P2Enjoy SAS' }))
		await page.keyboard.press('Space')
		await expect(page).toHaveURL(/[?&]espaces=p2enjoy/)
		await expect(page.getByTestId('pilotage-espace')).toHaveCount(1)
		await page.keyboard.press('Escape')
		await expect(page.getByTestId('panneau-filtre-espaces')).toHaveCount(0)
		await expect(page.getByRole('button', { name: 'Espace (1)' })).toBeFocused()
	})

	test('la lectrice d’un seul espace : l’écran d’avant, ni bouton « Espace » ni section par espace', async ({ page }) => {
		await connecterAvecLeLabs(page, VIEWER)
		await page.goto('/pilotage')
		await expect(page.getByTestId('pilotage-grandeurs')).toBeVisible()
		await expect(page.getByTestId('ouvrir-filtre-espaces')).toHaveCount(0)
		await expect(page.getByTestId('pilotage-espace')).toHaveCount(0)
		await expect(page.getByTestId('pilotage-selecteur-portee')).toBeVisible()
	})

	test('les quatre paliers, filtre ouvert : captures produites, et aucun débordement horizontal de la page', async ({ page }) => {
		await connecterAvecLeLabs(page, ADMIN)
		for (const palier of PALIERS) {
			await page.setViewportSize({ width: palier.largeur, height: palier.hauteur })
			await page.goto('/pilotage')
			await expect(page.getByTestId('pilotage-espace')).toHaveCount(2)
			await page.getByRole('button', { name: 'Espace', exact: true }).click()
			await expect(page.getByTestId('panneau-filtre-espaces')).toBeVisible()
			const deborde = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)
			expect(deborde, `débordement horizontal à ${palier.nom}`).toBe(false)
			await capturer(page, `pilotage-filtre-${palier.nom}`, UNITE)
		}
	})
})

test.describe('`CRM-161` T3.d — Temps ▸ Saisie de tous les espaces (docs/DESIGN_SYSTEM.md §5.54, §5.115)', () => {
	async function lumenEtSaisies(page: Page): Promise<{ lumen: string; saisies: () => Promise<{ workspace_id: string; minutes: number; jour: string }[]> }> {
		const [espace] = (await (await page.request.get(rest('workspaces?select=id&slug=eq.studio-lumen'), { headers: SERVICE })).json()) as { id: string }[]
		const saisies = async () =>
			(await (await page.request.get(rest(`saisies_temps?select=workspace_id,minutes,jour&profile_id=eq.${CAMILLE}&${PERIODE}&order=jour`), { headers: SERVICE })).json()) as {
				workspace_id: string
				minutes: number
				jour: string
			}[]
		return { lumen: espace!.id, saisies }
	}

	test('à la souris : les lignes groupées par espace, chaque cellule écrite dans l’espace de sa ligne, le total tous espaces, le dépassement annoncé', async ({ page }) => {
		await connecterAvecLeLabs(page, ADMIN)
		const { lumen, saisies } = await lumenEtSaisies(page)
		await page.goto(`/temps?semaine=${SEMAINE}`)
		await expect(page.getByTestId('temps-matrice')).toBeVisible()
		await expect(page.getByTestId('temps-groupe-espace')).toHaveText(['P2Enjoy SAS', 'Studio Lumen'])
		await expect(page.getByTestId('temps-note-espaces')).toBeVisible()
		await expect(page.getByTestId('ouvrir-filtre-espaces')).toHaveCount(0)
		await capturer(page, 'temps-saisie-espaces-1440', UNITE)

		// Un quart sur « Tournages » (« Studio Lumen »), un sur « Refonte de site » (« P2Enjoy SAS ») : le même lundi.
		const tournages = page.getByRole('textbox', { name: 'Tournages, lundi 14 juillet' })
		await tournages.click()
		await page.keyboard.type('1')
		await page.keyboard.press('Tab')
		await expect(page.getByTestId('temps-total-2025-07-14')).toHaveText('1 / 4 quarts')
		const refonte = page.getByRole('textbox', { name: 'Refonte de site, lundi 14 juillet' })
		await refonte.click()
		await page.keyboard.type('1')
		await page.keyboard.press('Tab')
		await expect(page.getByTestId('temps-total-2025-07-14')).toHaveText('2 / 4 quarts')
		// L'EFFET RÉEL, lu par la clé de service : chaque saisie dans l'espace de sa ligne.
		await expect.poll(async () => (await saisies()).map((s) => s.workspace_id).sort()).toEqual([P2ENJOY, lumen].sort())

		// Trois quarts de plus sur « Tournages » dépasseraient la journée, tous espaces confondus : annoncé, rien envoyé.
		await tournages.fill('4')
		await page.keyboard.press('Enter')
		await expect(tournages).toHaveAttribute('aria-invalid', 'true')
		await expect(page.getByText('Cette valeur dépasserait la journée de 7 heures.').first()).toBeVisible()
		expect((await saisies()).reduce((somme, s) => somme + s.minutes, 0)).toBe(210)
		await capturer(page, 'temps-saisie-depassement-1440', UNITE)
	})

	test('« Saisir pour » : les membres de l’espace administré, groupés par son nom ; un collègue restreint la grille à son espace', async ({ page }) => {
		await connecterAvecLeLabs(page, ADMIN)
		await page.goto(`/temps?semaine=${SEMAINE}`)
		const select = page.getByTestId('temps-saisir-pour')
		await expect(select).toBeVisible()
		// « Studio Lumen » n'a que Camille : seul « P2Enjoy SAS » offre des collègues.
		await expect(select.locator('optgroup')).toHaveCount(1)
		await expect(select.locator('optgroup').first()).toHaveAttribute('label', 'P2Enjoy SAS')
		await expect(select.locator('optgroup option')).toContainText(['Driss Lemoine', 'Farida Nowak'])
		await select.selectOption({ label: 'Driss Lemoine' })
		await expect(page.getByTestId('temps-bandeau-autrui')).toContainText('Driss Lemoine')
		await expect(page.getByTestId('temps-groupe-espace')).toHaveText(['P2Enjoy SAS'])
		await expect(page.getByRole('textbox', { name: 'Tournages, lundi 14 juillet' })).toHaveCount(0)
		await capturer(page, 'temps-saisir-pour-espace-1440', UNITE)
		await select.selectOption({ label: 'Moi-même' })
		await expect(page.getByTestId('temps-groupe-espace')).toHaveText(['P2Enjoy SAS', 'Studio Lumen'])
	})

	test('au clavier : les flèches suivent l’ordre affiché, d’un groupe au suivant', async ({ page }) => {
		await connecterAvecLeLabs(page, ADMIN)
		await page.goto(`/temps?semaine=${SEMAINE}`)
		const derniereDuPremier = page.getByRole('textbox', { name: 'Refonte de site, lundi 14 juillet' })
		await expect(derniereDuPremier).toBeVisible()
		// « Studio web » est le dernier track de « P2Enjoy SAS » dans l'ordre affiché : le suivant est « Productions ».
		const productions = page.getByRole('textbox', { name: 'Productions, lundi 14 juillet' })
		await productions.click()
		await page.keyboard.press('ArrowUp')
		const avant = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'))
		expect(avant).not.toBe('Productions, lundi 14 juillet')
		await page.keyboard.press('ArrowDown')
		await expect(productions).toBeFocused()
	})

	test('la lectrice d’un seul espace : la grille d’avant, ni groupe, ni note, ni « Saisir pour »', async ({ page }) => {
		await connecterAvecLeLabs(page, VIEWER)
		await page.goto(`/temps?semaine=${SEMAINE}`)
		await expect(page.getByTestId('temps-matrice')).toBeVisible()
		await expect(page.getByTestId('temps-groupe-espace')).toHaveCount(0)
		await expect(page.getByTestId('temps-note-espaces')).toHaveCount(0)
		await expect(page.getByTestId('temps-saisir-pour')).toHaveCount(0)
	})

	test('les quatre paliers de la grille de tous les espaces : aucun débordement horizontal de la page', async ({ page }) => {
		await connecterAvecLeLabs(page, ADMIN)
		for (const palier of PALIERS) {
			await page.setViewportSize({ width: palier.largeur, height: palier.hauteur })
			await page.goto('/temps?semaine=2026-11-16')
			await expect(page.getByTestId('temps-groupe-espace')).toHaveCount(2)
			const deborde = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)
			expect(deborde, `débordement horizontal à ${palier.nom}`).toBe(false)
			await capturer(page, `temps-saisie-${palier.nom}`, UNITE)
		}
	})
})
