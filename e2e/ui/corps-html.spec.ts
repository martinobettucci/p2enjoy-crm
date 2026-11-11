// @verifies CRM-140 (docs/BACKLOG.md) — tranche T3 : le courrier HTML du seed, sur la pile réelle — AUCUNE requête vers
//           l'hôte de l'image avant le clic, mesurée par l'interception réseau ; la requête part après « Afficher les
//           images » ; revenir au message le rend bloqué ; l'image `cid:` affichée sans clic ; les pièges retirés ; le lien
//           ouvre un onglet sans `opener` ni référent ; au clavier, le bouton, la phrase d'état qui prend le focus, puis les
//           liens du cadre ; le corps texte aux liens ; captures aux quatre paliers sans défilement horizontal
// @verifies docs/SPEC-mail-subsystem.md §30.3 à §30.7, §30.9, §30.11 (lignes « E2E ui » et « Captures ») ;
//           docs/DESIGN_SYSTEM.md §5.100 ; CLAUDE.md §15, §16
//
// DEUX SERVEURS EXTÉRIEURS SONT TENUS PAR L'INTERCEPTION, ET ILS SONT LES SEULS (§30.9, docs/DESIGN_SYSTEM.md §12.5) :
// l'hôte de l'image, `images.partenaire-demo.test`, qui ne se résout pas (RFC 2606) et répond ici une vraie image du seed,
// et le site du lien, `sogexia.example`, qui répond une page vide. Tout le reste est la pile : le courrier a été soumis en
// SMTP puis relevé par le seed, la pièce intégrée analysée par l'antivirus local, le HTML nettoyé par l'écran.
// Le corps TEXTE aux liens isole un état que le seed ne porte pas : une réponse SUBSTITUÉE, nommée ici, rend le même
// courrier sans `body_html`, si bien que l'écran montre son alternative texte (§12.5 : un état rare, isolé et nommé).

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Page, Route } from '@playwright/test'
import { connecterAvecLeLabs, consommerTraceCadreIsole, expect, test } from './fixtures'
import { PALIERS, capturer } from './captures'
import { URL_API, enTetesService } from '../api/jetons'

const UNITE = 'CRM-140'
const ADMIN = 'admin@p2enjoy.test'
const MSGID_HTML = '<seed-corps-html@p2enjoy.test>'
const MSGID_NON_CLASSE = '<seed-inbox-non-classe@p2enjoy.test>'
const HOTE_IMAGE = 'images.partenaire-demo.test'
const IMAGE = readFileSync(resolve(import.meta.dirname, '../../supabase/seed/pieces-jointes/maquette-accueil.png'))

async function idDuMessage(page: Page, rfc822: string): Promise<string> {
	const reponse = await page.request.get(`${URL_API}/rest/v1/mail_messages?select=id&rfc822_message_id=eq.${encodeURIComponent(rfc822)}`, {
		headers: enTetesService(),
	})
	const [ligne] = (await reponse.json()) as { id: string }[]
	expect(ligne, `le message ${rfc822} du seed (docs/SPEC-seed.md §44)`).toBeDefined()
	return ligne!.id
}

/** L'hôte de l'image, tenu par l'interception : chaque requête est COMPTÉE, et reçoit une vraie image. */
async function intercepterImages(page: Page): Promise<string[]> {
	const requetes: string[] = []
	await page.route(`**://${HOTE_IMAGE}/**`, (route: Route) => {
		requetes.push(route.request().url())
		return route.fulfill({ status: 200, contentType: 'image/png', body: IMAGE })
	})
	return requetes
}

const cadre = (page: Page) => page.frameLocator('[data-testid="inbox-corps-cadre"]')

/** Le cadre a rendu le courrier : son titre est visible DANS le cadre. */
async function attendreLeCourrier(page: Page): Promise<void> {
	await expect(cadre(page).getByRole('heading', { name: /Journée partenaires Sogexia/ })).toBeVisible()
}

test.use({ viewport: { width: 1440, height: 900 } })

// Le seul message de console attendu : celui que la trace de Playwright fait naître dans le cadre isolé (`fixtures.ts`).
test.afterEach(({ page }) => consommerTraceCadreIsole(page))

test('à la souris : rien ne part avant le clic, la requête part après, et le message rouvert repart bloqué', async ({ page, context }) => {
	const requetes = await intercepterImages(page)
	await context.route('**://sogexia.example/**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<p>Programme</p>' }))
	const idHtml = await idDuMessage(page, MSGID_HTML)
	const idAutre = await idDuMessage(page, MSGID_NON_CLASSE)
	await connecterAvecLeLabs(page, ADMIN)
	await page.goto(`/inbox?courrier=tous&message=${idHtml}`)
	await attendreLeCourrier(page)

	// LE CADRE : ses droits exacts, et le HTML hors du DOM de l'écran.
	const element = page.getByTestId('inbox-corps-cadre')
	await expect(element).toHaveAttribute('sandbox', 'allow-popups allow-popups-to-escape-sandbox')
	await expect(element).toHaveAttribute('referrerpolicy', 'no-referrer')
	await expect(page.getByTestId('inbox-message-ouvert').getByRole('heading', { name: /Journée partenaires Sogexia/ })).toHaveCount(0)

	// LES PIÈGES DU SEED SONT RETIRÉS : ni script, ni gestionnaire, ni lien `javascript:` ; le titre de l'écran est intact.
	await expect(cadre(page).locator('script')).toHaveCount(0)
	await expect(cadre(page).locator('[onclick]')).toHaveCount(0)
	await expect(cadre(page).getByText('répondez ici')).not.toHaveAttribute('href', /.*/)
	expect(await page.title()).not.toContain('piège')

	// L'IMAGE INTÉGRÉE s'affiche SANS clic, depuis la pièce saine, en `data:`.
	const logo = cadre(page).getByRole('img', { name: 'Sogexia' })
	await expect(logo).toHaveAttribute('src', /^data:image\/png;base64,/)
	await expect.poll(() => logo.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(96)

	// AUCUNE REQUÊTE AVANT LE CLIC — mesurée après que le cadre a rendu le courrier ET son image intégrée.
	expect(requetes).toEqual([])
	await expect(page.getByTestId('bandeau-images')).toContainText('Les images distantes de ce message sont bloquées')
	await capturer(page, 'corps-html-bloque-xl-1440', UNITE)

	const partie = page.waitForRequest((requete) => requete.url().includes(HOTE_IMAGE))
	await page.getByTestId('afficher-images').click()
	await partie
	expect(requetes).toEqual([`https://${HOTE_IMAGE}/journee-partenaires.png`])
	await expect(page.getByTestId('images-affichees')).toHaveText('Images affichées pour ce message.')
	await expect
		.poll(() => cadre(page).getByRole('img', { name: 'Affiche de la journée partenaires' }).evaluate((image: HTMLImageElement) => image.naturalWidth))
		.toBe(480)
	await capturer(page, 'corps-html-affiche-xl-1440', UNITE)

	// LE LIEN ouvre un onglet ORDINAIRE, sans `opener` ni référent.
	const [onglet] = await Promise.all([
		page.waitForEvent('popup'),
		cadre(page).getByRole('link', { name: 'programme et inscription' }).click(),
	])
	await onglet.waitForLoadState()
	expect(onglet.url()).toBe('https://sogexia.example/journee-partenaires')
	expect(await onglet.evaluate(() => [window.opener === null, document.referrer])).toEqual([true, ''])
	await onglet.close()

	// UN AUTRE MESSAGE, PUIS LE RETOUR : le courrier repart bloqué, et AUCUNE requête de plus ne part.
	await page.goto(`/inbox?courrier=tous&message=${idAutre}`)
	await expect(page.getByTestId('inbox-corps')).toContainText('candidature spontanée')
	await page.goto(`/inbox?courrier=tous&message=${idHtml}`)
	await attendreLeCourrier(page)
	await expect(page.getByTestId('afficher-images')).toBeVisible()
	await expect(cadre(page).getByRole('img', { name: 'Sogexia' })).toHaveAttribute('src', /^data:/)
	expect(requetes, 'le message rouvert ne recharge pas l’image distante').toHaveLength(1)
})

test('au clavier : le bouton, la phrase d’état qui prend le focus, puis les liens du cadre', async ({ page }) => {
	const requetes = await intercepterImages(page)
	await connecterAvecLeLabs(page, ADMIN)
	await page.goto(`/inbox?courrier=tous&message=${await idDuMessage(page, MSGID_HTML)}`)
	await attendreLeCourrier(page)

	const bouton = page.getByTestId('afficher-images')
	await bouton.focus()
	await expect(bouton).toBeFocused()
	await page.keyboard.press('Enter')
	await expect(page.getByTestId('images-affichees')).toBeFocused()
	await expect.poll(() => requetes.length).toBe(1)

	// `Tab` ENTRE DANS LE CADRE et en parcourt les liens : le premier est « programme et inscription ».
	await page.keyboard.press('Tab')
	await expect(cadre(page).getByRole('link', { name: 'programme et inscription' })).toBeFocused()
})

test('un corps sans HTML : ses adresses web sont des liens (réponse substituée, nommée en tête)', async ({ page }) => {
	const idHtml = await idDuMessage(page, MSGID_HTML)
	await page.route(`**/rest/v1/mail_messages?*id=eq.${idHtml}*`, async (route) => {
		const reponse = await route.fetch()
		const lignes = (await reponse.json()) as Record<string, unknown>[]
		await route.fulfill({ response: reponse, json: lignes.map((ligne) => ('body_html' in ligne ? { ...ligne, body_html: null } : ligne)) })
	})
	await connecterAvecLeLabs(page, ADMIN)
	await page.goto(`/inbox?courrier=tous&message=${idHtml}`)
	const corps = page.getByTestId('inbox-corps')
	await expect(corps).toContainText('Nous serions ravis de vous accueillir')
	await expect(page.getByTestId('inbox-corps-cadre')).toHaveCount(0)
	const lien = corps.getByRole('link', { name: 'https://sogexia.example/journee-partenaires' })
	await expect(lien).toHaveAttribute('target', '_blank')
	await expect(lien).toHaveAttribute('rel', 'noopener noreferrer')
	await capturer(page, 'corps-texte-liens-xl-1440', UNITE)
})

test.describe('les quatre paliers', () => {
	for (const palier of PALIERS) {
		test(`palier ${palier.nom} : le cadre et le bandeau tiennent, la page ne défile pas horizontalement`, async ({ page }) => {
			await intercepterImages(page)
			await page.setViewportSize({ width: palier.largeur, height: palier.hauteur })
			await connecterAvecLeLabs(page, ADMIN)
			await page.goto(`/inbox?courrier=tous&message=${await idDuMessage(page, MSGID_HTML)}`)
			await attendreLeCourrier(page)
			await expect(page.getByTestId('afficher-images')).toBeVisible()
			await page.getByTestId('bandeau-images').scrollIntoViewIfNeeded()
			await capturer(page, `corps-html-${palier.nom}`, UNITE)
			const largeurs = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth])
			expect(largeurs[0], 'la page ne défile jamais horizontalement (§7)').toBeLessThanOrEqual(largeurs[1]!)
		})
	}
})
