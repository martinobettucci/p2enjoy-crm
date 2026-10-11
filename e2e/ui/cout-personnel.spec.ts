// @verifies CRM-098 (docs/BACKLOG.md) — tranches T3 et T4 : le rapport mensuel, le coût du personnel et la série
//           « Personnel » à l'écran
// @verifies docs/SPEC-temps.md §4 (valorisation par la version du jour travaillé ; « non valorisé », jamais zéro),
//           §5.1 (un membre ne lit que son temps), §7.3 (rapport mensuel ; « Toute l'équipe »), §7.4 (Réglages ▸ « Coût
//           du personnel » : version programmée, historique, retrait confirmé), §7.5 (série « Personnel » du track et
//           de l'affaire, portée écrite) ; docs/DESIGN_SYSTEM.md §5.54 ; CLAUDE.md §15, §16
//
// UNE VERSION EN VIGUEUR NE SE RETIRE JAMAIS, même par la clé de service (déclencheur de `0087`). Toutes les versions
// posées ici prennent donc effet dans un futur LOINTAIN (2099) — une date proche finirait par entrer en vigueur et ne
// se retirerait plus —, et le temps est saisi en mars 2099 : chaque scénario retire
// ce qu'il a posé, et le seed est rendu intact.

import { connecterAvecLeLabs, expect, test, type APIRequestContext } from './fixtures'
import { capturer } from './captures'
import { URL_API, enTetesService } from '../api/jetons'

const UNITE = 'CRM-098'
const ADMIN = 'admin@p2enjoy.test'
const BIZDEV = 'bizdev@p2enjoy.test'
const W = '5eed0000-0000-4000-8000-000000000001'
const DRISS = '5eed0000-0000-4000-8000-000000000012'
const FARIDA = '5eed0000-0000-4000-8000-000000000013'
const STUDIO = '5eed0000-0000-4000-8000-000000000022'
const REFONTE = '5eed0000-0000-4000-8000-000000000034'
const PROSPECTION = '5eed0000-0000-4000-8000-000000000031'
const MGEN = '5eed0000-0000-4000-8000-0000000000cc'
const MARS = 'jour=gte.2099-03-01&jour=lte.2099-03-31'

const rest = (chemin: string) => `${URL_API}/rest/v1/${chemin}`
const service = () => ({ ...enTetesService(), 'Content-Type': 'application/json', Prefer: 'return=minimal' })

test.use({ viewport: { width: 1440, height: 900 } })

async function nettoyer(requete: APIRequestContext): Promise<void> {
	await requete.delete(rest(`saisies_temps?${MARS}`), { headers: enTetesService() })
	await requete.delete(rest('couts_personnel?date_effet=gte.2099-01-01'), { headers: enTetesService() })
}

/**
 * Driss : 120 € le quart à partir du 1er janvier 2099 ; en mars 2099, 2 quarts sur l'affaire « Portail adhérents »,
 * 1 quart sur le channel « Refonte de site », 1 heure sur le track « Studio web ». Farida : 1 quart sur « Prospection »,
 * sans version de coût.
 */
async function poserLeMois(requete: APIRequestContext): Promise<void> {
	await nettoyer(requete)
	const version = await requete.post(rest('couts_personnel'), {
		headers: service(),
		data: { workspace_id: W, profile_id: DRISS, date_effet: '2099-01-01', cout_quart: 120 },
	})
	expect(version.status(), await version.text()).toBe(201)
	const saisies = await requete.post(rest('saisies_temps'), {
		headers: service(),
		data: [
			{ workspace_id: W, profile_id: DRISS, jour: '2099-03-02', minutes: 210, track_id: null, channel_id: null, card_id: MGEN },
			{ workspace_id: W, profile_id: DRISS, jour: '2099-03-02', minutes: 105, track_id: null, channel_id: REFONTE, card_id: null },
			{ workspace_id: W, profile_id: DRISS, jour: '2099-03-03', minutes: 60, track_id: STUDIO, channel_id: null, card_id: null },
			{ workspace_id: W, profile_id: FARIDA, jour: '2099-03-02', minutes: 105, track_id: null, channel_id: PROSPECTION, card_id: null },
		],
	})
	expect(saisies.status(), await saisies.text()).toBe(201)
}

test.afterEach(async ({ request }) => {
	await nettoyer(request)
	const restantes = await request.get(rest(`saisies_temps?select=id&${MARS}`), { headers: enTetesService() })
	expect(await restantes.json(), 'aucune saisie de mars 2099 ne doit rester').toEqual([])
})

test('le rapport mensuel d’un membre : son temps seul, valorisé par la version du mois, avec ses totaux', async ({ page, request }) => {
	await poserLeMois(request)
	await connecterAvecLeLabs(page, BIZDEV)
	await page.goto('/temps?onglet=rapport&mois=2099-03')
	await expect(page.getByTestId('temps-rapport')).toBeVisible()
	await expect(page.getByTestId('temps-rapport-personne')).toHaveCount(0)

	const lignes = page.getByTestId('temps-rapport-ligne')
	await expect(lignes).toHaveCount(3)
	await expect(lignes.nth(0)).toContainText('Studio web')
	await expect(lignes.nth(0)).toContainText('1 h')
	await expect(lignes.nth(0)).toContainText('68,57 EUR')
	await expect(page.getByTestId('temps-rapport-total')).toHaveText('6 h 15')
	await expect(page.locator('tfoot')).toContainText('428,57 EUR')
	await expect(page.getByTestId('temps-non-valorise')).toHaveCount(0)
	await capturer(page, 'temps-rapport-membre-xl-1440', UNITE)
})

test('un administrateur lit toute l’équipe : une section par personne, et le temps sans version dit « non valorisé »', async ({ page, request }) => {
	await poserLeMois(request)
	await connecterAvecLeLabs(page, ADMIN)
	await page.goto('/temps?onglet=rapport&mois=2099-03')
	await page.getByTestId('temps-rapport-personne').selectOption({ label: 'Toute l’équipe' })

	const sections = page.getByTestId('temps-rapport-section')
	await expect(sections).toHaveCount(2)
	await expect(page.getByRole('heading', { name: 'Driss Lemoine' })).toBeVisible()
	const farida = sections.filter({ has: page.getByRole('heading', { name: 'Farida Nowak' }) })
	await expect(farida.getByTestId('temps-non-valorise').first()).toHaveText('non valorisé')
	await expect(farida).not.toContainText('0,00')
	await capturer(page, 'temps-rapport-equipe-xl-1440', UNITE)
})

test('la série « Personnel » du track, par channel, et le temps passé dans la fiche d’une affaire', async ({ page, request }) => {
	await poserLeMois(request)
	await connecterAvecLeLabs(page, BIZDEV)
	await page.goto('/tracks/studio-web/couts')
	const serie = page.getByTestId('personnel-track')
	await expect(serie).toBeVisible()
	await expect(serie.getByTestId('personnel-portee')).toHaveText('Votre temps')
	await serie.getByTestId('personnel-mois').fill('2099-03')
	const lignes = serie.getByTestId('personnel-ligne')
	await expect(lignes).toHaveCount(2)
	await expect(lignes.nth(0)).toContainText('Le track lui-même')
	await expect(lignes.nth(1)).toContainText('Refonte de site')
	await expect(lignes.nth(1)).toContainText('5 h 15')
	await expect(lignes.nth(1)).toContainText('360,00 EUR')
	await serie.scrollIntoViewIfNeeded()
	await capturer(page, 'personnel-track-xl-1440', UNITE)

	await page.goto(`/tracks/studio-web/refonte/cards/${MGEN}`)
	const bloc = page.getByTestId('temps-card')
	await expect(bloc.getByTestId('temps-card-duree')).toHaveText('3 h 30')
	await expect(bloc).toContainText('240,00 EUR')
	await expect(bloc.getByTestId('personnel-portee')).toHaveText('Votre temps')
	await bloc.scrollIntoViewIfNeeded()
	await capturer(page, 'temps-card-xl-1440', UNITE)
})

test('Réglages ▸ « Coût du personnel » : une version programmée s’ajoute, se lit dans l’historique et se retire après confirmation', async ({ page, request }) => {
	await nettoyer(request)
	await connecterAvecLeLabs(page, ADMIN)
	await page.goto('/reglages')
	await page.getByRole('link', { name: /Coût du personnel/ }).click()
	await expect(page).toHaveURL(/\/reglages\/cout-personnel$/)

	const carte = page.locator(`[data-testid="cout-personne"][data-personne="${FARIDA}"]`)
	await carte.getByRole('button', { name: 'Nouvelle version' }).click()
	await carte.getByLabel('Coût par quart').fill('135,50')
	await carte.getByLabel('Date d’effet').fill('2099-01-04')
	await carte.getByRole('button', { name: 'Enregistrer la version' }).click()
	await expect(carte.getByTestId('cout-prochain')).toHaveText('135,50 EUR par quart à partir du 4 janvier 2099')
	await capturer(page, 'cout-personnel-version-programmee-xl-1440', UNITE)

	const lue = await request.get(rest(`couts_personnel?select=cout_quart,date_effet&profile_id=eq.${FARIDA}&date_effet=gte.2099-01-01`), {
		headers: enTetesService(),
	})
	expect(await lue.json()).toEqual([{ cout_quart: 135.5, date_effet: '2099-01-04' }])

	await carte.getByRole('button', { name: 'Historique' }).click()
	await carte.getByRole('button', { name: 'Retirer la version du 4 janvier 2099' }).click()
	await expect(carte.getByTestId('cout-confirmation')).toBeVisible()
	await capturer(page, 'cout-personnel-confirmation-xl-1440', UNITE)
	await carte.getByRole('button', { name: 'Retirer la version', exact: true }).click()
	await expect(carte.getByTestId('cout-prochain')).toHaveCount(0)
	const apres = await request.get(rest(`couts_personnel?select=id&profile_id=eq.${FARIDA}&date_effet=gte.2099-01-01`), {
		headers: enTetesService(),
	})
	expect(await apres.json()).toEqual([])
})

test('un membre n’a pas accès aux réglages du coût du personnel', async ({ page }) => {
	await connecterAvecLeLabs(page, BIZDEV)
	await page.goto('/reglages/cout-personnel')
	await expect(page.getByRole('heading', { name: 'Réservé aux administrateurs' })).toBeVisible()
	await expect(page.getByTestId('cout-personnel')).toHaveCount(0)
})
