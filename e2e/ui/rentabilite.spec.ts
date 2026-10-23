// @verifies CRM-108 (docs/BACKLOG.md) — tranche T5 : les recettes et la rentabilité, dans le navigateur, sur la pile seedée
// @verifies docs/SPEC-recettes.md §6.1 (le bloc « Recettes » : une ligne et deux réels saisis puis soldés, à la souris et
//           au clavier, relus en base), §6.2 (le bloc « Rentabilité » de l'administratrice, absent pour le business
//           developer — sans aucune 403 en console), §6.3 (l'écran : tableaux par devise, vues, filtres ; « Réservé aux
//           administrateurs »), §6.4 (la saisie en série au clavier) ; docs/DESIGN_SYSTEM.md §5.60 ; docs/SPEC-seed.md §21
// @verifies docs/SPEC-recettes.md §7 et §11 (« un outil du connecteur dont l'effet se voit dans la fiche ») ; docs/SPEC-mcp.md
//           §3.1 (un vrai client MCP, connecté dans le navigateur), §9.1 (aucun chemin parallèle : la fiche lit ce que
//           l'outil a écrit) ; docs/SPEC-seed.md §21.4 (la matrice de démonstration du business developer)
// @verifies CLAUDE.md §16 (captures aux quatre paliers, page jamais défilante horizontalement)

import { connecterAvecLeLabs, expect, test, type Page } from './fixtures'
import { MOT_DE_PASSE_SEED, URL_API, enTetesService } from '../api/jetons'
import { RETOUR_CLIENT, SessionMcp, echangerCode, preparerAutorisation } from '../mcp/client'
import { PALIERS, capturer } from './captures'

const UNITE = 'CRM-108'
const ADMIN = 'admin@p2enjoy.test'
const BIZDEV = 'bizdev@p2enjoy.test'
const FICHE = '/tracks/studio-web/refonte/cards/5eed0000-0000-4000-8000-0000000000c4'
const CARD = '5eed0000-0000-4000-8000-0000000000c4'
const NATURE = 'Ligne E2E rentabilité'

async function sansDefilementHorizontal(page: Page): Promise<void> {
	const debord = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
	expect(debord, 'la page ne défile jamais horizontalement').toBeLessThanOrEqual(0)
}

test.afterEach(async ({ request }) => {
	await request.delete(`${URL_API}/rest/v1/card_revenues?card_id=eq.${CARD}&label=eq.${encodeURIComponent(NATURE)}`, {
		headers: enTetesService(),
	})
})

test('le commercial saisit une ligne de recette et deux réels depuis la fiche, puis la solde ; la base les tient', async ({ page, request }) => {
	await connecterAvecLeLabs(page, BIZDEV)
	await page.goto(FICHE)
	const bloc = page.getByTestId('bloc-recettes-card')
	await expect(bloc.getByTestId('ligne-recette').first()).toBeVisible()
	// Le business developer n'administre pas l'espace : aucun bloc de rentabilité, et aucune 403 en console (fixture).
	await expect(page.getByTestId('bloc-rentabilite-card')).toHaveCount(0)

	await bloc.getByRole('button', { name: 'Nouvelle ligne de recette' }).click()
	await bloc.getByLabel('Nature').fill(NATURE)
	await bloc.getByLabel('Recette prévue (EUR)').fill('1000')
	await bloc.getByRole('button', { name: 'Ajouter la ligne' }).click()
	const ligne = bloc.getByTestId('ligne-recette').filter({ hasText: NATURE })
	await expect(ligne).toBeVisible()

	await ligne.getByTestId('recette-reels-bascule').click()
	const reels = page.getByTestId('reels-ligne')
	await reels.getByLabel('Montant').fill('400')
	await reels.getByRole('button', { name: 'Ajouter le réel' }).click()
	await expect(ligne.getByTestId('recette-cellule-reel')).toContainText('400.00')
	// Au clavier : le champ, la saisie, Entrée.
	await reels.getByLabel('Montant').focus()
	await page.keyboard.type('250')
	await page.keyboard.press('Enter')
	await expect(ligne.getByTestId('recette-cellule-reel')).toContainText('650.00')
	await reels.getByRole('checkbox').check()
	await expect(ligne.getByTestId('recette-pilule-soldee')).toBeVisible()
	await bloc.scrollIntoViewIfNeeded()
	await capturer(page, 'fiche-recettes-soldee-1440', UNITE)

	const enBase = await request.get(
		`${URL_API}/rest/v1/card_revenues?card_id=eq.${CARD}&label=eq.${encodeURIComponent(NATURE)}&select=actual_amount,settled_at`,
		{ headers: enTetesService() },
	)
	const [lu] = (await enBase.json()) as { actual_amount: number; settled_at: string | null }[]
	expect(lu!.actual_amount).toBe(650)
	expect(lu!.settled_at).not.toBeNull()
})

test('l’administratrice lit la rentabilité dans la fiche et dans l’écran, par devise, en vues Réel et Prévu', async ({ page }) => {
	await connecterAvecLeLabs(page, ADMIN)
	await page.goto(FICHE)
	const bloc = page.getByTestId('bloc-rentabilite-card')
	await expect(bloc.getByTestId('rentab-marge').first()).toBeVisible()
	await expect(bloc.getByTestId('rentab-partielle').first()).toBeVisible()
	await bloc.scrollIntoViewIfNeeded()
	await capturer(page, 'fiche-rentabilite-1440', UNITE)

	await page.getByRole('link', { name: 'Ouvrir dans Rentabilité' }).click()
	await expect(page).toHaveURL(/\/rentabilite$/)
	const tableaux = page.getByTestId('rentab-tableau')
	await expect(tableaux).toHaveCount(2)
	await expect(tableaux.first()).toHaveAttribute('data-devise', 'CHF')
	await expect(page.getByTestId('rentab-ligne-affaire').filter({ hasText: 'Socle analytique' })).toBeVisible()
	await capturer(page, 'rentabilite-reel-xl-1440', UNITE)

	await page.getByTestId('rentab-vue-prevu').click()
	await expect(page).toHaveURL(/vue=prevu/)
	await expect(page.getByText('La marge prévue soustrait le temps déjà passé')).toBeVisible()
	await page.getByLabel('État').selectOption('gagnees')
	await expect(page.getByTestId('rentab-ligne-affaire')).toHaveCount(1)
	// La capture attend la fin de la transition de l'onglet quitté (150 ms) : sinon elle le montre encore souligné.
	await expect(page.getByTestId('rentab-vue-reel')).toHaveCSS('border-bottom-color', 'rgba(0, 0, 0, 0)')
	await capturer(page, 'rentabilite-prevu-gagnees-1440', UNITE)

	for (const palier of PALIERS) {
		await page.setViewportSize({ width: palier.largeur, height: palier.hauteur })
		await page.goto('/rentabilite')
		await expect(page.getByTestId('rentab-tableau').first()).toBeVisible()
		await sansDefilementHorizontal(page)
		await capturer(page, `rentabilite-${palier.nom}`, UNITE)
	}
})

test('le commercial lit « Réservé aux administrateurs » et saisit à la suite dans « À saisir », au clavier', async ({ page }) => {
	await connecterAvecLeLabs(page, BIZDEV)
	await page.goto('/rentabilite')
	await expect(page.getByText('Réservé aux administrateurs')).toBeVisible()
	await capturer(page, 'rentabilite-reservee-1440', UNITE)
	await page.getByRole('link', { name: /Saisir des recettes réelles/ }).click()
	await expect(page).toHaveURL(/onglet=saisir/)
	const champs = page.getByTestId('recette-saisir-champ')
	await expect(champs.first()).toBeVisible()
	await expect(page.getByTestId('onglet-rentab-badge')).toBeVisible()
	await expect(page.getByText('0 jour', { exact: true }).first()).toBeVisible()
	await expect(page.getByTestId('onglet-rentab-ensemble')).toHaveCSS('border-bottom-color', 'rgba(0, 0, 0, 0)')
	await capturer(page, 'a-saisir-xl-1440', UNITE)
	for (const palier of PALIERS) {
		await page.setViewportSize({ width: palier.largeur, height: palier.hauteur })
		// Rechargée à chaque palier : redimensionner sans recharger capturait le tiroir de navigation en mouvement.
		await page.goto('/rentabilite?onglet=saisir')
		await expect(page.getByTestId('recette-saisir-champ').first()).toBeVisible()
		await sansDefilementHorizontal(page)
		await capturer(page, `a-saisir-${palier.nom}`, UNITE)
	}
})

test('une ligne et un réel écrits par le connecteur MCP du commercial se lisent dans sa fiche', async ({ page, browser }) => {
	// Le consentement et la connexion au SSO, dans un contexte à part : la session du connecteur n'est pas celle de la webapp.
	const consentement = await browser.newContext()
	const onglet = await consentement.newPage()
	const autorisation = await preparerAutorisation()
	await onglet.goto(autorisation.url)
	await onglet.getByRole('button', { name: 'Allow Access' }).click()
	await expect(onglet.locator('#kc-form-login')).toBeVisible()
	await onglet.locator('#username').fill(BIZDEV)
	await onglet.locator('#password').fill(MOT_DE_PASSE_SEED)
	const retour = onglet.waitForRequest((r) => r.url().startsWith(RETOUR_CLIENT), { timeout: 20_000 })
	await onglet.locator('#kc-login').click()
	const code = new URL((await retour).url()).searchParams.get('code') ?? ''
	await consentement.close()
	const session = new SessionMcp((await echangerCode(autorisation, code)).access_token)
	await session.ouvrir()

	const ajout = await session.appeler('tools/call', {
		name: 'crm_card_revenue_add',
		arguments: { card_id: CARD, label: NATURE, estimated_amount: 1200 },
	})
	expect(ajout.isError ?? false, JSON.stringify(ajout.content)).toBe(false)
	const reel = await session.appeler('tools/call', {
		name: 'crm_card_revenue_actual_add',
		arguments: { revenue_id: ajout.structuredContent.revenue_line.id, amount: 300 },
	})
	expect(reel.isError ?? false, JSON.stringify(reel.content)).toBe(false)

	await connecterAvecLeLabs(page, BIZDEV)
	await page.goto(FICHE)
	const ligne = page.getByTestId('bloc-recettes-card').getByTestId('ligne-recette').filter({ hasText: NATURE })
	await expect(ligne).toBeVisible()
	await expect(ligne).toContainText('1200.00')
	await expect(ligne.getByTestId('recette-cellule-reel')).toContainText('300.00')
	await ligne.scrollIntoViewIfNeeded()
	await capturer(page, 'fiche-recette-par-le-connecteur-1440', UNITE)
})
