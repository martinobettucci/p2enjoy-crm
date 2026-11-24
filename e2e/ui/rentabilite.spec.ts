// @verifies CRM-108 (docs/BACKLOG.md) — tranche T5 : les recettes et la rentabilité, dans le navigateur, sur la pile seedée
// @verifies docs/SPEC-recettes.md §6.1 (le bloc « Recettes » : une ligne et deux réels saisis puis soldés, à la souris et
//           au clavier, relus en base), §6.2 (le bloc « Rentabilité » de l'administratrice, absent pour le business
//           developer — sans aucune 403 en console), §6.3 (l'écran : tableaux par devise, vues, filtres ; « Réservé aux
//           administrateurs »), §6.4 (la saisie en série au clavier) ; docs/DESIGN_SYSTEM.md §5.60 ; docs/SPEC-seed.md §21
// @verifies docs/SPEC-recettes.md §7 et §11 (« un outil du connecteur dont l'effet se voit dans la fiche ») ; docs/SPEC-mcp.md
//           §3.1 (un vrai client MCP, connecté dans le navigateur), §9.1 (aucun chemin parallèle : la fiche lit ce que
//           l'outil a écrit) ; docs/SPEC-seed.md §21.4 (la matrice de démonstration du business developer)
// @verifies CRM-126 (docs/BACKLOG.md) — tranche T2 : docs/SPEC-recettes.md §4.4, §6.2 et §6.3 révisés (décision 810) — un
//           seul tableau, …0c7 « Formation Data & IA » (CHF et EUR, docs/SPEC-seed.md §21.1) sur une ligne, une balance
//           par devise, taux vide, sous-totaux et total en balance par devise ; la fiche de …0c7 ; docs/DESIGN_SYSTEM.md §5.60
// @verifies CLAUDE.md §16 (captures aux quatre paliers, page jamais défilante horizontalement)
// @verifies CRM-161 (docs/BACKLOG.md) — tranche T3.b : la ligne de chaque track nomme son espace, le bouton « Espace » de la
//           barre de filtres, à la souris et au clavier, le vide sous le filtre, et rien pour une personne d'un seul espace
//           (docs/SPEC-espace-courant.md §16.2, §16.3 ; docs/DESIGN_SYSTEM.md §5.115)
// *Révisé le 2026-11-21 (`CRM-161` T2.a, docs/SPEC-espace-courant.md §15.5, décision 51)* : les pages d'un espace sont sous
// le slug de l'espace (`/p2enjoy/…`) ; les adresses et leurs attentes suivent, sans changer ce que la preuve prouve.
// @verifies CRM-161 (docs/BACKLOG.md) — tranche T3.b.2 : l'onglet « À saisir » nomme l'espace de chaque affaire
//           (docs/SPEC-espace-courant.md §16.3)

import { connecterAvecLeLabs, expect, test, type Page } from './fixtures'
import { MOT_DE_PASSE_SEED, URL_API, enTetesService } from '../api/jetons'
import { RETOUR_CLIENT, SessionMcp, echangerCode, preparerAutorisation } from '../mcp/client'
import { PALIERS, capturer } from './captures'

const UNITE = 'CRM-108'
const ADMIN = 'admin@p2enjoy.test'
const BIZDEV = 'bizdev@p2enjoy.test'
const FICHE = '/p2enjoy/tracks/studio-web/refonte/cards/5eed0000-0000-4000-8000-0000000000c4'
const CARD = '5eed0000-0000-4000-8000-0000000000c4'
const NATURE = 'Ligne E2E rentabilité'
const FORMATION = '5eed0000-0000-4000-8000-0000000000c7'

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

test('l’administratrice lit la rentabilité dans la fiche et dans l’écran, en balance par devise, en vues Réel et Prévu', async ({ page }) => {
	await connecterAvecLeLabs(page, ADMIN)
	await page.goto(FICHE)
	const bloc = page.getByTestId('bloc-rentabilite-card')
	await expect(bloc.getByTestId('rentab-marge').first()).toBeVisible()
	await expect(bloc.getByTestId('rentab-partielle').first()).toBeVisible()
	await bloc.scrollIntoViewIfNeeded()
	await capturer(page, 'fiche-rentabilite-1440', UNITE)

	await page.getByRole('link', { name: 'Ouvrir dans Rentabilité' }).click()
	await expect(page).toHaveURL(/\/rentabilite$/)
	// Un seul tableau (CRM-126) : …0c7, en CHF avec un coût en EUR, y paraît une fois, une balance par devise.
	await expect(page.getByTestId('rentab-tableau')).toHaveCount(1)
	await expect(page.getByTestId('rentab-ligne-affaire').filter({ hasText: 'Socle analytique' })).toBeVisible()
	const formation = page.locator(`[data-testid="rentab-ligne-affaire"][data-card="${FORMATION}"]`)
	await expect(formation).toHaveCount(1)
	await expect(formation.getByTestId('rentab-marge').first()).toHaveAttribute('data-devise', 'CHF')
	await expect(formation.getByTestId('rentab-taux-devise')).toHaveCount(0)
	await expect(page.getByText('Non calculable — plusieurs devises')).toHaveCount(0)
	const total = page.getByTestId('rentab-total')
	await expect(total.getByTestId('rentab-marge')).toHaveCount(2)
	await expect(total.getByTestId('rentab-marge').nth(0)).toHaveAttribute('data-devise', 'CHF')
	await expect(total.getByTestId('rentab-marge').nth(1)).toHaveAttribute('data-devise', 'EUR')
	await expect(total.getByTestId('rentab-taux-devise')).toHaveCount(0)
	await capturer(page, 'rentabilite-reel-xl-1440', UNITE)
	await formation.scrollIntoViewIfNeeded()
	await capturer(page, 'rentabilite-balance-par-devise-1440', 'CRM-126')

	await page.getByTestId('rentab-vue-prevu').click()
	await expect(page).toHaveURL(/vue=prevu/)
	await expect(page.getByText('La marge prévue soustrait le temps déjà passé')).toBeVisible()
	// En prévu, …0c7 balance ses 28 000 CHF prévus contre ses 800 EUR de coût prévu, sans les additionner.
	const prevues = formation.getByTestId('rentab-marge')
	await expect(prevues).toHaveCount(2)
	await expect(prevues.nth(1)).toHaveAttribute('data-devise', 'EUR')
	await expect(prevues.nth(1)).toHaveAttribute('data-negative', 'oui')
	await capturer(page, 'rentabilite-prevu-balance-par-devise-1440', 'CRM-126')
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

test('la fiche d’une affaire à plusieurs devises rend un seul tableau, une marge par devise, et aucun taux', async ({ page }) => {
	await connecterAvecLeLabs(page, ADMIN)
	await page.goto(`/p2enjoy/tracks/formation/inter-entreprises/cards/${FORMATION}`)
	const bloc = page.getByTestId('bloc-rentabilite-card')
	await expect(bloc.getByTestId('rentab-marge').first()).toBeVisible()
	await expect(bloc.getByRole('table')).toHaveCount(1)
	const devises = await bloc.getByTestId('rentab-marge').evaluateAll((m) => m.map((x) => (x as HTMLElement).dataset.devise))
	expect(new Set(devises)).toEqual(new Set(['CHF', 'EUR']))
	await expect(bloc.getByTestId('rentab-taux')).toHaveCount(0)
	await bloc.scrollIntoViewIfNeeded()
	await capturer(page, 'fiche-rentabilite-plusieurs-devises-1440', 'CRM-126')
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

// `CRM-161` T3.b — Camille lit « P2Enjoy SAS » et « Studio Lumen » (docs/SPEC-seed.md §55) ; seul le premier porte des recettes
// et des coûts : isoler le second rend le vide sous le filtre. Rien n'est écrit. La rentabilité est réservée aux
// administrateurs, tous de deux espaces dans le seed : la page d'un seul espace est prouvée par l'unitaire de
// `provenanceVisible` et, en E2E, sur « Coûts » et « Affaires figées ».
test.describe('`CRM-161` T3.b — la rentabilité de tous les espaces (docs/DESIGN_SYSTEM.md §5.115)', () => {
	const UNITE_T3 = 'CRM-161'

	test('à la souris : chaque track nomme son espace ; isoler un espace, le vide sous le filtre, tout réafficher', async ({ page }) => {
		await connecterAvecLeLabs(page, ADMIN)
		await page.goto('/rentabilite')
		await expect(page.getByTestId('rentab-tableau')).toBeVisible()
		// LA PROVENANCE : sur la ligne de chaque track, une fois — jamais sur celles des channels ni des affaires.
		const mentions = page.getByTestId('espace-track-rentab')
		await expect(mentions.first()).toHaveText('· P2Enjoy SAS')
		for (const texte of await mentions.allTextContents()) expect(texte.trim()).toBe('· P2Enjoy SAS')
		await expect(page.getByTestId('rentab-ligne-affaire').getByTestId('espace-track-rentab')).toHaveCount(0)

		// Le bouton vit dans la barre de filtres de la page, son panneau sous elle.
		const bouton = page.getByTestId('rentab-filtres').getByRole('button', { name: 'Espace', exact: true })
		await expect(bouton).toHaveAttribute('aria-expanded', 'false')
		await bouton.click()
		await expect(bouton).toHaveAttribute('aria-expanded', 'true')
		const panneau = page.getByTestId('panneau-filtre-espaces')
		await expect(panneau.getByRole('checkbox')).toHaveCount(2)
		await panneau.getByRole('checkbox', { name: 'Studio Lumen' }).check()
		await expect(page).toHaveURL(/[?&]espaces=studio-lumen/)
		await expect(page.getByRole('button', { name: 'Espace (1)' })).toBeVisible()
		await expect(page.getByTestId('vide-filtre-espaces')).toBeVisible()
		await expect(page.getByTestId('rentab-tableau')).toHaveCount(0)
		await expect(page.getByTestId('rentab-vide')).toHaveCount(0)
		await capturer(page, 'rentabilite-filtre-vide-1440', UNITE_T3)

		// L'ADRESSE SE RELIT : un rechargement garde le filtre.
		await page.reload()
		await expect(page.getByTestId('vide-filtre-espaces')).toBeVisible()
		await page.getByRole('button', { name: 'Afficher tous les espaces' }).click()
		await expect(page.getByTestId('rentab-tableau')).toBeVisible()
		await expect(page).not.toHaveURL(/espaces=/)
		await expect(page.getByRole('button', { name: 'Espace', exact: true })).toBeFocused()

		// Isoler l'espace qui porte tout : le tableau reste entier.
		const nombre = await page.getByTestId('rentab-ligne-affaire').count()
		await page.getByRole('button', { name: 'Espace', exact: true }).click()
		await page.getByTestId('panneau-filtre-espaces').getByRole('checkbox', { name: 'P2Enjoy SAS' }).check()
		await expect(page).toHaveURL(/[?&]espaces=p2enjoy/)
		await expect(page.getByTestId('rentab-ligne-affaire')).toHaveCount(nombre)
		await capturer(page, 'rentabilite-espaces-1440', UNITE_T3)
	})

	test('au clavier : ouvrir, cocher à l’espace, replier par Échap, le focus rendu au bouton', async ({ page }) => {
		await connecterAvecLeLabs(page, ADMIN)
		await page.goto('/rentabilite')
		await expect(page.getByTestId('rentab-tableau')).toBeVisible()
		const bouton = page.getByRole('button', { name: 'Espace', exact: true })
		await bouton.focus()
		await page.keyboard.press('Enter')
		await expect(bouton).toHaveAttribute('aria-expanded', 'true')
		// LE PANNEAU SUIT LA BARRE DANS L'ORDRE DU FOCUS : Tab y entre, sur la première case.
		await page.keyboard.press('Tab')
		await expect(page.getByRole('checkbox', { name: 'P2Enjoy SAS' })).toBeFocused()
		await page.keyboard.press('Tab')
		await expect(page.getByRole('checkbox', { name: 'Studio Lumen' })).toBeFocused()
		await page.keyboard.press('Space')
		await expect(page).toHaveURL(/[?&]espaces=studio-lumen/)
		await expect(page.getByTestId('vide-filtre-espaces')).toBeVisible()
		await page.keyboard.press('Escape')
		await expect(page.getByTestId('panneau-filtre-espaces')).toHaveCount(0)
		await expect(page.getByRole('button', { name: 'Espace (1)' })).toBeFocused()
		await page.getByRole('button', { name: 'Afficher tous les espaces' }).focus()
		await page.keyboard.press('Enter')
		await expect(page.getByTestId('rentab-tableau')).toBeVisible()
		await expect(page.getByRole('button', { name: 'Espace', exact: true })).toBeFocused()
	})

	test('les quatre paliers, filtre ouvert : captures produites, et aucun débordement horizontal', async ({ page }) => {
		await connecterAvecLeLabs(page, ADMIN)
		for (const palier of PALIERS) {
			await page.setViewportSize({ width: palier.largeur, height: palier.hauteur })
			await page.goto('/rentabilite')
			await expect(page.getByTestId('rentab-tableau')).toBeVisible()
			await page.getByRole('button', { name: 'Espace', exact: true }).click()
			await expect(page.getByTestId('panneau-filtre-espaces')).toBeVisible()
			await sansDefilementHorizontal(page)
			await capturer(page, `rentabilite-filtre-${palier.nom}`, UNITE_T3)
		}
	})
})

test('`CRM-161` T3.b.2 — l’onglet « À saisir » nomme l’espace de l’affaire de chaque recette (§16.3)', async ({ page }) => {
	await connecterAvecLeLabs(page, ADMIN)
	await page.goto('/rentabilite?onglet=saisir')
	const lignes = page.getByTestId('tableau-recettes-a-saisir').locator('tbody tr')
	await expect(lignes.first()).toBeVisible()
	await expect(page.getByTestId('espace-a-saisir')).toHaveCount(await lignes.count())
	for (const texte of await page.getByTestId('espace-a-saisir').allTextContents()) expect(texte).toBe('P2Enjoy SAS')
	await capturer(page, 'rentabilite-a-saisir-espaces-1440', 'CRM-161')
})
