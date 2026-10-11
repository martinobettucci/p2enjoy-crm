// @verifies CRM-098 (docs/BACKLOG.md) — tranches T2 et T4 : la saisie de temps à l'écran
// @verifies docs/SPEC-temps.md §7.1 (« Temps », « Saisir pour »), §7.2 (la matrice : lignes, cellule qui s'enregistre
//           seule, pied, navigation, ajout d'une affaire), §6.3 (la case « En heures »), §2 (plafond de 7 heures) ;
//           docs/DESIGN_SYSTEM.md §5.54 ; CLAUDE.md §15 (effets backend vérifiés), §16 (captures observées)
//
// Les scénarios travaillent sur une semaine FIXE, sans temps dans le seed (la semaine du 1er juin 2026), et retirent
// après chacun les saisies qu'ils ont faites : le seed est rendu intact.

import { connecterAvecLeLabs, expect, test, type APIRequestContext, type Page } from './fixtures'
import { PALIERS, capturer } from './captures'
import { URL_API, enTetesService } from '../api/jetons'

const UNITE = 'CRM-098'
const ADMIN = 'admin@p2enjoy.test'
const BIZDEV = 'bizdev@p2enjoy.test'
const SEMAINE = '2026-06-01'
const FIN_SEMAINE = '2026-06-07'
const PERIODE = `jour=gte.${SEMAINE}&jour=lte.${FIN_SEMAINE}`

const rest = (chemin: string) => `${URL_API}/rest/v1/${chemin}`

test.use({ viewport: { width: 1440, height: 900 } })

test.afterEach(async ({ request }) => {
	await request.delete(rest(`saisies_temps?${PERIODE}`), { headers: enTetesService() })
	const restantes = await request.get(rest(`saisies_temps?select=id&${PERIODE}`), { headers: enTetesService() })
	expect(await restantes.json(), 'aucune saisie de la semaine de preuve ne doit rester').toEqual([])
})

type SaisieLue = { readonly jour: string; readonly minutes: number; readonly profile_id: string; readonly created_by: string }

/** Les saisies de la semaine de preuve, lues par la clé de service : l'effet réel des gestes. */
async function lireSaisies(requete: APIRequestContext): Promise<readonly SaisieLue[]> {
	const reponse = await requete.get(rest(`saisies_temps?select=jour,minutes,profile_id,created_by&${PERIODE}&order=jour`), {
		headers: enTetesService(),
	})
	expect(reponse.status()).toBe(200)
	return (await reponse.json()) as SaisieLue[]
}

async function ouvrirSemaine(page: Page): Promise<void> {
	await page.goto(`/temps?semaine=${SEMAINE}`)
	await expect(page.getByTestId('temps-matrice')).toBeVisible()
	await expect(page.getByTestId('temps-semaine')).toHaveText('Semaine du 1 au 7 juin 2026')
}

const cellule = (page: Page, cible: string, jour: string) =>
	page.getByRole('textbox', { name: `${cible}, ${jour}` })

test('une semaine se saisit au quart, à la souris : chaque cellule s’enregistre seule', async ({ page, request }) => {
	await connecterAvecLeLabs(page, BIZDEV)
	await ouvrirSemaine(page)
	await capturer(page, 'temps-semaine-vide-xl-1440', UNITE)

	await cellule(page, 'Refonte de site', 'lundi 1 juin').click()
	await page.keyboard.type('2')
	await cellule(page, 'Studio web', 'lundi 1 juin').click()
	await page.keyboard.type('1')
	await page.getByRole('heading', { name: 'Semaine du 1 au 7 juin 2026' }).click()

	await expect(page.getByTestId('temps-total-2026-06-01')).toHaveText('3 / 4 quarts')
	await expect.poll(async () => (await lireSaisies(request)).map((s) => `${s.jour}:${s.minutes}`).sort()).toEqual([
		'2026-06-01:105',
		'2026-06-01:210',
	])
	await capturer(page, 'temps-semaine-saisie-xl-1440', UNITE)
})

test('au clavier seul : Entrée descend d’une ligne, la journée pleine se signale, un quart de trop est refusé', async ({ page, request }) => {
	await connecterAvecLeLabs(page, BIZDEV)
	await ouvrirSemaine(page)

	await cellule(page, 'Conseil & IA', 'lundi 1 juin').focus()
	await page.keyboard.type('1')
	await page.keyboard.press('Enter')
	await expect(cellule(page, 'Prospection', 'lundi 1 juin')).toBeFocused()
	await page.keyboard.type('1')
	await page.keyboard.press('Enter')
	await expect(cellule(page, 'Grands comptes', 'lundi 1 juin')).toBeFocused()
	await page.keyboard.type('2')
	await page.keyboard.press('Enter')
	await expect(page.getByTestId('temps-total-2026-06-01')).toHaveText('4 / 4 quarts')

	// La flèche droite passe au jour suivant ; Échap rétablit la valeur enregistrée.
	await page.keyboard.press('ArrowRight')
	await expect(cellule(page, 'Studio web', 'mardi 2 juin')).toBeFocused()
	await page.keyboard.press('ArrowLeft')
	await page.keyboard.type('1')
	await page.keyboard.press('Enter')
	await expect(cellule(page, 'Studio web', 'lundi 1 juin')).toHaveAttribute('aria-invalid', 'true')
	await expect(cellule(page, 'Studio web', 'lundi 1 juin')).toHaveAccessibleDescription(
		'Cette valeur dépasserait la journée de 7 heures.',
	)
	await capturer(page, 'temps-plafond-xl-1440', UNITE)
	await page.keyboard.press('Escape')
	await expect(cellule(page, 'Studio web', 'lundi 1 juin')).toHaveValue('')

	await expect.poll(async () => (await lireSaisies(request)).reduce((s, l) => s + l.minutes, 0)).toBe(420)
})

test('une journée en heures : cinq cibles au quart d’heure, et la case qui ne se décoche plus', async ({ page, request }) => {
	await connecterAvecLeLabs(page, BIZDEV)
	await ouvrirSemaine(page)

	await page.getByRole('checkbox', { name: 'Saisir le mardi 2 juin en heures' }).check()
	const valeurs: readonly [string, string][] = [
		['Conseil & IA', '1,5'],
		['Prospection', '1,5'],
		['Studio web', '1,5'],
		['Refonte de site', '1,5'],
		['Maintenance', '1'],
	]
	for (const [cible, valeur] of valeurs) {
		await cellule(page, cible, 'mardi 2 juin').fill(valeur)
		await cellule(page, cible, 'mardi 2 juin').press('Enter')
	}
	await expect(page.getByTestId('temps-total-2026-06-02')).toHaveText('7 h / 7 h')
	await page.getByTestId('temps-semaine').click()
	await expect(cellule(page, 'Conseil & IA', 'mardi 2 juin')).toHaveValue('1 h 30')

	// Le clic ne décoche pas : la case reste cochée, et l'écran dit pourquoi (`uncheck` exigerait le changement d'état).
	await page.getByRole('checkbox', { name: 'Saisir le mardi 2 juin en heures' }).click()
	await expect(page.getByTestId('temps-motif-case')).toHaveText(
		'Le mardi 2 juin reste en heures : des saisies de ce jour ne tombent pas sur un quart.',
	)
	await expect(page.getByRole('checkbox', { name: 'Saisir le mardi 2 juin en heures' })).toBeChecked()
	await capturer(page, 'temps-journee-en-heures-xl-1440', UNITE)

	await expect.poll(async () => (await lireSaisies(request)).map((s) => s.minutes).sort((a, b) => a - b)).toEqual([60, 90, 90, 90, 90])
})

test('une affaire s’ajoute par recherche, et sa ligne revient au rechargement parce qu’elle porte du temps', async ({ page, request }) => {
	await connecterAvecLeLabs(page, BIZDEV)
	await ouvrirSemaine(page)

	await page.getByRole('combobox', { name: 'Ajouter une affaire' }).fill('MGEN')
	await page.getByRole('option', { name: 'Portail adhérents — MGEN Loire' }).click()
	const ligne = page.locator('[data-testid="temps-ligne"][data-cible="card:5eed0000-0000-4000-8000-0000000000cc"]')
	await expect(ligne).toBeVisible()
	// Sous son channel : la ligne qui la précède est « Refonte de site ».
	await expect(ligne.locator('xpath=preceding-sibling::tr[1]')).toHaveAttribute('data-cible', 'channel:5eed0000-0000-4000-8000-000000000034')

	await cellule(page, 'Portail adhérents — MGEN Loire', 'mercredi 3 juin').fill('2')
	await cellule(page, 'Portail adhérents — MGEN Loire', 'mercredi 3 juin').press('Enter')
	await expect.poll(async () => (await lireSaisies(request)).map((s) => s.minutes)).toEqual([210])

	await page.reload()
	await expect(cellule(page, 'Portail adhérents — MGEN Loire', 'mercredi 3 juin')).toHaveValue('2')
	await capturer(page, 'temps-affaire-ajoutee-xl-1440', UNITE)
})

test('un administrateur saisit pour un membre : le bandeau le rappelle, la base garde l’auteur', async ({ page, request }) => {
	await connecterAvecLeLabs(page, ADMIN)
	await ouvrirSemaine(page)

	await page.getByTestId('temps-saisir-pour').selectOption({ label: 'Driss Lemoine' })
	await expect(page.getByTestId('temps-bandeau-autrui')).toHaveText('Vous saisissez le temps de Driss Lemoine.')
	await cellule(page, 'Studio web', 'jeudi 4 juin').fill('3')
	await cellule(page, 'Studio web', 'jeudi 4 juin').press('Enter')
	await capturer(page, 'temps-saisir-pour-xl-1440', UNITE)

	await expect.poll(async () => await lireSaisies(request)).toEqual([
		{
			jour: '2026-06-04',
			minutes: 315,
			profile_id: '5eed0000-0000-4000-8000-000000000012',
			created_by: '5eed0000-0000-4000-8000-000000000011',
		},
	])
})

test('la navigation de semaine vit dans l’adresse', async ({ page }) => {
	await connecterAvecLeLabs(page, BIZDEV)
	await ouvrirSemaine(page)
	await page.getByRole('button', { name: 'Semaine suivante' }).click()
	await expect(page).toHaveURL(/\/temps\?semaine=2026-06-08$/)
	await expect(page.getByTestId('temps-semaine')).toHaveText('Semaine du 8 au 14 juin 2026')
	await page.getByRole('button', { name: 'Semaine précédente' }).click()
	await page.getByRole('button', { name: 'Semaine précédente' }).click()
	await expect(page.getByTestId('temps-semaine')).toHaveText('Semaine du 25 au 31 mai 2026')
	await page.getByRole('button', { name: 'Cette semaine' }).click()
	await expect(page).toHaveURL(/\/temps$/)
	await expect(page.getByRole('button', { name: 'Cette semaine' })).toHaveCount(0)
})

test('aux quatre paliers, la matrice défile dans son conteneur et jamais la page', async ({ page }) => {
	await connecterAvecLeLabs(page, BIZDEV)
	for (const palier of PALIERS) {
		await page.setViewportSize({ width: palier.largeur, height: palier.hauteur })
		await ouvrirSemaine(page)
		const debordePage = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
		expect(debordePage, `la page ne défile pas horizontalement à ${palier.largeur} px`).toBe(false)
		await capturer(page, `temps-semaine-${palier.nom}`, UNITE)
	}
})
