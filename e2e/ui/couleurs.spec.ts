// @verifies CRM-116 (docs/BACKLOG.md) — tranche T4 : choisir la couleur d'un track et d'un channel, dans l'application
//           réelle et sur le seed
// @verifies docs/SPEC-administration-arborescence.md §14.3 (le sélecteur dans les deux formulaires, la couleur envoyée à
//           la création et en modification, le brouillon de l'aller-retour), §14.4 (les lectures), §14.5 (le
//           non-administrateur) ; docs/SPEC-channels.md §5
// @verifies docs/DESIGN_SYSTEM.md §5.68 (cinq options nommées, radio natif au clavier, pastille d'onglet, pilule de
//           channel), §5.29 (le patron réemployé), §7 (aucun défilement horizontal), §8 (cibles de 40 px)
// @verifies docs/SPEC-seed.md §2.6 (les couleurs des channels du seed) ; CLAUDE.md §16 (vérification visuelle)
//
// Aucune réponse n'est substituée : la pile réelle et le seed rendent les couleurs, et chaque écriture est relue en base
// par la clé de service. Les objets du seed modifiés ici sont rendus à leur couleur après chaque scénario, et les
// channels de sonde purgés — le seed ne garde aucune trace de ce fichier.

import { connecterAvecLeLabs, expect, test, type APIRequestContext, type Page } from './fixtures'
import { PALIERS, capturer } from './captures'
import { URL_API, enTetesService } from '../api/jetons'

const UNITE = 'CRM-116'
const ADMIN = 'admin@p2enjoy.test'
const LECTRICE = 'viewer@p2enjoy.test'
const WORKFLOW_DEFAUT = 'Cycle commercial standard (par défaut)'
const PREFIXE_SLUG = 'sonde-116'

const TRACK_FORMATION = '5eed0000-0000-4000-8000-000000000023'
const CHANNEL_PROSPECTION = '5eed0000-0000-4000-8000-000000000031'

const rest = (chemin: string) => `${URL_API}/rest/v1/${chemin}`

async function remettreLeSeed(request: APIRequestContext): Promise<void> {
	await request.delete(rest(`channels?slug=like.${PREFIXE_SLUG}*`), { headers: enTetesService() })
	await request.patch(rest(`tracks?id=eq.${TRACK_FORMATION}`), { headers: enTetesService(), data: { color: 'accent' } })
	await request.patch(rest(`channels?id=eq.${CHANNEL_PROSPECTION}`), {
		headers: enTetesService(),
		data: { color: 'brand' },
	})
}

async function couleurEnBase(request: APIRequestContext, table: string, filtre: string): Promise<string | undefined> {
	const reponse = await request.get(rest(`${table}?select=color&${filtre}`), { headers: enTetesService() })
	expect(reponse.status()).toBe(200)
	return ((await reponse.json()) as { color: string }[])[0]?.color
}

const groupe = (page: Page) => page.getByRole('group', { name: 'Couleur' })
const pilule = (page: Page, slug: string) => page.locator(`[data-testid="entree-track"][data-slug="${slug}"]`)
const pastille = (page: Page, slug: string) =>
	page.locator(`[data-testid="onglet-channel"][data-slug="${slug}"] [data-testid="pastille-channel"]`)

test.beforeEach(async ({ request }) => remettreLeSeed(request))
test.afterEach(async ({ request }) => remettreLeSeed(request))

test.describe('l’administratrice choisit les couleurs', () => {
	test.beforeEach(async ({ page }) => {
		await page.setViewportSize({ width: 1440, height: 900 })
		await connecterAvecLeLabs(page, ADMIN)
	})

	test('le formulaire de track propose cinq couleurs nommées, et la couleur choisie au clavier colore la pilule', async ({
		page,
		request,
	}) => {
		await page.goto('/reglages/arborescence')
		await page.getByRole('button', { name: 'Modifier Formation' }).click()
		const formulaire = page.getByTestId('formulaire-track')
		await expect(groupe(page)).toBeVisible()
		await expect(groupe(page).getByRole('radio')).toHaveCount(5)
		await expect(groupe(page).getByTestId('option-couleur')).toHaveText(['Bleu', 'Vert', 'Jaune', 'Rouge', 'Gris'])
		// Plus aucun nom de jeton à l'écran.
		await expect(formulaire).not.toContainText(/\b(brand|success|accent|danger|neutral)\b/)
		await expect(groupe(page).getByRole('radio', { name: 'Jaune' })).toBeChecked()
		await capturer(page, 'track-selecteur-xl-1440', UNITE)

		// AU CLAVIER : `Tab` depuis le nom, jusqu'au radio coché du groupe, puis la flèche.
		await expect(formulaire.getByLabel('Nom')).toBeFocused()
		for (let pas = 0; pas < 6; pas += 1) {
			if (await groupe(page).getByRole('radio', { name: 'Jaune' }).evaluate((e) => e === document.activeElement)) break
			await page.keyboard.press('Tab')
		}
		await expect(groupe(page).getByRole('radio', { name: 'Jaune' })).toBeFocused()
		await page.keyboard.press('ArrowRight')
		await expect(groupe(page).getByRole('radio', { name: 'Rouge' })).toBeChecked()
		await expect(groupe(page).getByRole('radio', { name: 'Rouge' })).toBeFocused()

		await formulaire.getByRole('button', { name: 'Enregistrer' }).click()
		await expect(formulaire).toHaveCount(0)
		await expect.poll(() => couleurEnBase(request, 'tracks', `id=eq.${TRACK_FORMATION}`)).toBe('danger')
		// La barre latérale suit, sans rechargement (§5.13).
		await expect(pilule(page, 'formation')).toHaveClass(/bg-danger-soft/)
		await capturer(page, 'track-recolore-xl-1440', UNITE)
	})

	test('un channel se recolore depuis l’arborescence : pilule, puis pastille de l’onglet', async ({ page, request }) => {
		await page.goto('/reglages/arborescence')
		await page.getByRole('button', { name: 'Déplier Conseil & IA' }).click()
		const prospection = page.locator('[data-testid="pilule-channel"]', { hasText: 'Prospection' })
		await expect(prospection).toHaveAttribute('data-couleur', 'brand')
		await capturer(page, 'arborescence-pilules-xl-1440', UNITE)

		await page.getByRole('button', { name: 'Modifier Prospection' }).click()
		const formulaire = page.getByTestId('formulaire-channel')
		await expect(formulaire.getByRole('radio', { name: 'Bleu' })).toBeChecked()
		await formulaire.getByRole('radio', { name: 'Vert' }).check()
		await formulaire.getByRole('button', { name: 'Enregistrer' }).click()
		await expect(formulaire).toHaveCount(0)
		await expect.poll(() => couleurEnBase(request, 'channels', `id=eq.${CHANNEL_PROSPECTION}`)).toBe('success')
		await expect(prospection).toHaveAttribute('data-couleur', 'success')

		await page.goto('/tracks/conseil-ia/prospection')
		await expect(pastille(page, 'prospection')).toHaveAttribute('data-couleur', 'success')
		await expect(pastille(page, 'grands-comptes')).toHaveAttribute('data-couleur', 'success')
		await capturer(page, 'onglets-pastilles-xl-1440', UNITE)
	})

	test('« Nouveau channel » de la barre d’onglets crée un channel de la couleur choisie', async ({ page, request }) => {
		await page.goto('/tracks/formation?nouveau-channel=1')
		const formulaire = page.getByTestId('formulaire-channel')
		await formulaire.getByLabel('Nom').fill('Sonde 116 couleur')
		await expect(formulaire.getByRole('radio', { name: 'Gris' })).toBeChecked()
		await formulaire.getByRole('radio', { name: 'Rouge' }).check()
		await formulaire.getByLabel('Workflow').selectOption({ label: WORKFLOW_DEFAUT })
		await capturer(page, 'nouveau-channel-couleur-xl-1440', UNITE)
		await formulaire.getByRole('button', { name: 'Créer' }).click()

		await expect(page).toHaveURL(/\/tracks\/formation\/sonde-116-couleur$/)
		await expect(pastille(page, 'sonde-116-couleur')).toHaveAttribute('data-couleur', 'danger')
		expect(await couleurEnBase(request, 'channels', `slug=eq.sonde-116-couleur`)).toBe('danger')
	})

	test('la couleur choisie survit à l’aller-retour vers l’éditeur de workflows', async ({ page }) => {
		await page.goto('/tracks/formation?nouveau-channel=1')
		const formulaire = page.getByTestId('formulaire-channel')
		await formulaire.getByLabel('Nom').fill('Sonde 116 retour')
		await formulaire.getByRole('radio', { name: 'Vert' }).check()
		await formulaire.getByRole('link', { name: 'Nouveau workflow' }).click()
		await expect(page).toHaveURL(/\/reglages\/workflows\?/)
		await page.getByRole('link', { name: 'Revenir au nouveau channel' }).click()

		const rouvert = page.getByTestId('formulaire-channel')
		await expect(rouvert.getByLabel('Nom')).toHaveValue('Sonde 116 retour')
		await expect(rouvert.getByRole('radio', { name: 'Vert' })).toBeChecked()
	})
})

test('la lectrice voit les couleurs, sans formulaire pour les changer', async ({ page }) => {
	await page.setViewportSize({ width: 1440, height: 900 })
	await connecterAvecLeLabs(page, LECTRICE)
	await page.goto('/tracks/conseil-ia/prospection')
	await expect(pastille(page, 'prospection')).toHaveAttribute('data-couleur', 'brand')
	// La barre d'onglets n'ouvre aucun formulaire à la lectrice : la commande est un texte inactif (CRM-093, §5.59).
	await expect(page.getByTestId('commande-nouveau-channel')).toHaveAttribute('aria-disabled', 'true')
	await expect(page.getByRole('group', { name: 'Couleur' })).toHaveCount(0)
	await capturer(page, 'lectrice-pastilles-xl-1440', UNITE)
})

// Un palier par scénario, la taille posée AVANT le premier rendu.
test.describe('paliers responsive (§7, §8)', () => {
	for (const palier of PALIERS) {
		test(`palier ${palier.nom} : le sélecteur tient, chaque option garde sa cible, la page ne défile pas`, async ({
			page,
		}) => {
			await page.setViewportSize({ width: palier.largeur, height: palier.hauteur })
			await connecterAvecLeLabs(page, ADMIN)
			await page.goto('/reglages/arborescence')
			await page.getByRole('button', { name: 'Modifier Formation' }).click()
			await expect(groupe(page)).toBeVisible()
			const hauteurs = await groupe(page)
				.getByTestId('option-couleur')
				.evaluateAll((options) => options.map((option) => option.getBoundingClientRect().height))
			for (const hauteur of hauteurs) expect(hauteur, 'hauteur d’une option').toBeGreaterThanOrEqual(40)
			// LE CADRE DE CHAQUE OPTION, et non le seul défilement de la page (§5.43) : à 390 px, le sélecteur vit dans une
			// liste qui défile, et « Rouge » et « Gris » sortaient du champ alors que la page ne défilait pas.
			const bords = await groupe(page)
				.getByTestId('option-couleur')
				.evaluateAll((options) => options.map((option) => option.getBoundingClientRect().right))
			for (const bord of bords) expect(bord, 'bord droit d’une option').toBeLessThanOrEqual(palier.largeur)
			const { defilement, largeur } = await page.evaluate(() => ({
				defilement: document.documentElement.scrollWidth,
				largeur: document.documentElement.clientWidth,
			}))
			expect(defilement, 'largeur défilable du document').toBeLessThanOrEqual(largeur)
			await groupe(page).scrollIntoViewIfNeeded()
			await capturer(page, `selecteur-${palier.nom}`, UNITE)
		})
	}
})
