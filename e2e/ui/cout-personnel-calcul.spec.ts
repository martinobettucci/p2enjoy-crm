// @verifies CRM-107 (docs/BACKLOG.md) — tranche T3 : le calculateur du coût par quart, sur la pile réelle
// @verifies docs/SPEC-temps.md §7.4 bis (1 : les cinq champs, 218 jours par défaut ; 2 : la formule, l'exemple 4 510 →
//           62,06 ; 3 : seul le coût par quart est enregistré, par « Enregistrer la version » ; 4 : « Utiliser ce coût » ;
//           5 : un champ hors bornes) ; docs/DESIGN_SYSTEM.md §5.54 ter ; CLAUDE.md §15 (effets backend vérifiés),
//           §16 (captures observées)
//
// Les versions de preuve prennent effet en 2099 — une version en vigueur ne se retire jamais — sur Farida, qui n'a
// aucune version au seed (sa première version peut porter toute date). Chaque scénario retire ce qu'il a posé.

import { connecterAvecLeLabs, expect, test, type APIRequestContext, type Page } from './fixtures'
import { PALIERS, capturer } from './captures'
import { URL_API, enTetesService } from '../api/jetons'

const UNITE = 'CRM-107'
const ADMIN = 'admin@p2enjoy.test'
const FARIDA = '5eed0000-0000-4000-8000-000000000013'

const rest = (chemin: string) => `${URL_API}/rest/v1/${chemin}`

test.use({ viewport: { width: 1440, height: 900 } })

async function nettoyer(requete: APIRequestContext): Promise<void> {
	await requete.delete(rest('couts_personnel?date_effet=gte.2099-01-01'), { headers: enTetesService() })
}

async function versionsDeFarida(requete: APIRequestContext) {
	const reponse = await requete.get(rest(`couts_personnel?select=date_effet,cout_quart,devise&profile_id=eq.${FARIDA}`), { headers: enTetesService() })
	expect(reponse.status()).toBe(200)
	return (await reponse.json()) as { date_effet: string; cout_quart: number; devise: string }[]
}

test.beforeEach(async ({ request }) => nettoyer(request))
test.afterEach(async ({ request }) => {
	await nettoyer(request)
	expect(await versionsDeFarida(request), 'aucune version de preuve ne doit rester').toEqual([])
})

async function ouvrirFormulaire(page: Page) {
	await page.goto('/reglages/cout-personnel')
	const carte = page.locator(`[data-testid="cout-personne"][data-personne="${FARIDA}"]`)
	await carte.getByRole('button', { name: 'Nouvelle version' }).click()
	return carte
}

test('à la souris : l’exemple de la spécification, reporté puis enregistré — seul le coût par quart est en base', async ({ page, request }) => {
	await connecterAvecLeLabs(page, ADMIN)
	const carte = await ouvrirFormulaire(page)
	await carte.getByRole('button', { name: 'Calculer depuis le coût mensuel' }).click()
	const calcul = carte.getByRole('group', { name: 'Calcul du coût par quart' })
	await expect(calcul.getByLabel('Jours travaillés par an')).toHaveValue('218')
	await calcul.getByLabel('Salaire brut mensuel (EUR)').fill('3 000')
	await calcul.getByLabel('Charges sociales (% du brut)').fill('42')
	await calcul.getByLabel('Frais de gestion par mois (EUR)').fill('150')
	await calcul.getByLabel('Avantages par mois (EUR)').fill('100')
	await expect(calcul.getByTestId('cout-calc-resultat')).toContainText(/Coût mensuel complet : 4\s510,00 EUR/)
	await expect(calcul.getByTestId('cout-calc-resultat')).toContainText('Coût par quart : 62,06 EUR')
	await capturer(page, 'calculateur-xl-1440', UNITE)

	expect(await versionsDeFarida(request), 'calculer n’enregistre rien').toEqual([])
	await calcul.getByRole('button', { name: 'Utiliser ce coût' }).click()
	await expect(carte.getByLabel('Coût par quart', { exact: true })).toHaveValue('62,06')
	await expect(carte.getByLabel('Coût par quart', { exact: true })).toBeFocused()
	expect(await versionsDeFarida(request), '« Utiliser ce coût » n’enregistre rien non plus').toEqual([])

	await carte.getByLabel('Date d’effet').fill('2099-01-04')
	await carte.getByRole('button', { name: 'Enregistrer la version' }).click()
	await expect(carte.getByTestId('cout-prochain')).toHaveText('62,06 EUR par quart à partir du 4 janvier 2099')
	expect(await versionsDeFarida(request)).toEqual([{ date_effet: '2099-01-04', cout_quart: 62.06, devise: 'EUR' }])
})

test('au clavier seul : 240 jours font le mensuel ÷ 80, et un champ hors bornes tait le résultat', async ({ page, request }) => {
	await connecterAvecLeLabs(page, ADMIN)
	const carte = await ouvrirFormulaire(page)
	const bouton = carte.getByRole('button', { name: 'Calculer depuis le coût mensuel' })
	await bouton.focus()
	await page.keyboard.press('Enter')
	await expect(bouton).toHaveAttribute('aria-expanded', 'true')
	const calcul = carte.getByRole('group', { name: 'Calcul du coût par quart' })

	await page.keyboard.press('Tab')
	await expect(calcul.getByLabel('Salaire brut mensuel (EUR)')).toBeFocused()
	await page.keyboard.type('4000')
	await page.keyboard.press('Tab')
	await page.keyboard.type('120')
	await expect(calcul.getByLabel('Charges sociales (% du brut)')).toHaveAttribute('aria-invalid', 'true')
	await expect(calcul.getByLabel('Charges sociales (% du brut)')).toHaveAccessibleDescription('Entre 0 et 100 %.')
	await expect(calcul.getByRole('button', { name: 'Utiliser ce coût' })).toBeDisabled()
	await capturer(page, 'calculateur-erreur-xl-1440', UNITE)

	await page.keyboard.press('Backspace')
	await page.keyboard.press('Backspace')
	await page.keyboard.press('Backspace')
	await page.keyboard.press('Tab')
	await page.keyboard.press('Tab')
	await page.keyboard.press('Tab')
	await expect(calcul.getByLabel('Jours travaillés par an')).toBeFocused()
	await page.keyboard.press('ControlOrMeta+a')
	await page.keyboard.type('240')
	await expect(calcul.getByTestId('cout-calc-resultat')).toContainText('Coût par quart : 50,00 EUR')
	await page.keyboard.press('Tab')
	await page.keyboard.press('Enter')
	await expect(carte.getByLabel('Coût par quart', { exact: true })).toBeFocused()
	await expect(carte.getByLabel('Coût par quart', { exact: true })).toHaveValue('50,00')
	expect(await versionsDeFarida(request)).toEqual([])
})

test('aux quatre paliers, le calculateur déplié ne fait jamais défiler la page', async ({ page }) => {
	await connecterAvecLeLabs(page, ADMIN)
	for (const palier of PALIERS) {
		await page.setViewportSize({ width: palier.largeur, height: palier.hauteur })
		const carte = await ouvrirFormulaire(page)
		await carte.getByRole('button', { name: 'Calculer depuis le coût mensuel' }).click()
		await carte.getByLabel('Salaire brut mensuel (EUR)').fill('3000')
		await carte.getByLabel('Charges sociales (% du brut)').fill('42')
		await carte.getByRole('group', { name: 'Calcul du coût par quart' }).scrollIntoViewIfNeeded()
		const debordement = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
		expect(debordement, `aucun défilement horizontal de la page à ${palier.nom}`).toBeLessThanOrEqual(0)
		await capturer(page, `calculateur-${palier.nom}`, UNITE)
	}
})
