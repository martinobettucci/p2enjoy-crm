// @verifies CRM-106 (docs/BACKLOG.md) — tranche T3 : saisir son temps depuis la fiche d'une affaire, sur la pile réelle
// @verifies docs/SPEC-temps.md §7.6 (1 : les cellules de la matrice, `Entrée` vers le jour suivant ; 2 : une valeur
//           remplace, zéro retire ; 3 : son temps seulement ; 4 : le pied et le plafond comptent les autres cibles ;
//           6 : navigation, « Ouvrir dans Temps » ; 7 : « Votre semaine » ; 8 : le résumé relu), §6.3 ;
//           docs/DESIGN_SYSTEM.md §5.54 bis ; CLAUDE.md §15 (effets backend vérifiés), §16 (captures observées)
//
// LA SEMAINE DE PREUVE EST CELLE D'APRÈS LA PROCHAINE. La bande ne porte pas sa semaine dans l'adresse (§7.6, point 6) :
// une semaine de 2025 demanderait des dizaines de clics. Le seed ne pose du temps que sur des jours PASSÉS
// (`docs/SPEC-seed.md` §17.1) : une semaine future est hors de toute fenêtre du jeu. Chaque scénario retire ce qu'il a
// posé sur cette semaine, et le vérifie.

import { connecterAvecLeLabs, expect, test, type APIRequestContext, type Page } from './fixtures'
import { PALIERS, capturer } from './captures'
import { URL_API, enTetesService } from '../api/jetons'

const UNITE = 'CRM-106'
const ADMIN = 'admin@p2enjoy.test'
const BIZDEV = 'bizdev@p2enjoy.test'
const VIEWER = 'viewer@p2enjoy.test'
const W = '5eed0000-0000-4000-8000-000000000001'
const CAMILLE = '5eed0000-0000-4000-8000-000000000011'
const DRISS = '5eed0000-0000-4000-8000-000000000012'
const MAINTENANCE = '5eed0000-0000-4000-8000-000000000035'
const MGEN = '5eed0000-0000-4000-8000-0000000000cc'
const NORDIS = '5eed0000-0000-4000-8000-0000000000cb'
const FICHE_MGEN = `/tracks/studio-web/refonte/cards/${MGEN}`
const FICHE_NORDIS = `/tracks/conseil-ia/prospection/cards/${NORDIS}`
const TITRE_MGEN = 'Portail adhérents — MGEN Loire'

// ---------------------------------------------------------------------------------------------
// La semaine de preuve, calculée comme l'écran la calcule : jours ISO, arithmétique en UTC.
// ---------------------------------------------------------------------------------------------

const iso = (d: Date) => d.toISOString().slice(0, 10)
const decaler = (jour: string, n: number) => {
	const d = new Date(`${jour}T00:00:00Z`)
	d.setUTCDate(d.getUTCDate() + n)
	return iso(d)
}
const aujourdhui = (() => {
	const d = new Date()
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
})()
const lundiDe = (jour: string) => decaler(jour, -((new Date(`${jour}T00:00:00Z`).getUTCDay() + 6) % 7))
const LUNDI = decaler(lundiDe(aujourdhui), 14)
const MARDI = decaler(LUNDI, 1)
const MERCREDI = decaler(LUNDI, 2)
const DIMANCHE = decaler(LUNDI, 6)
const PERIODE = `jour=gte.${LUNDI}&jour=lte.${DIMANCHE}`
const FORMAT_LONG = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })
const nomJour = (jour: string) => FORMAT_LONG.format(new Date(`${jour}T00:00:00Z`))

const rest = (chemin: string) => `${URL_API}/rest/v1/${chemin}`

test.use({ viewport: { width: 1440, height: 900 } })

test.afterEach(async ({ request }) => {
	await request.delete(rest(`saisies_temps?${PERIODE}`), { headers: enTetesService() })
	const restantes = await request.get(rest(`saisies_temps?select=id&${PERIODE}`), { headers: enTetesService() })
	expect(await restantes.json(), 'aucune saisie de la semaine de preuve ne doit rester').toEqual([])
})

type SaisieLue = { readonly jour: string; readonly minutes: number; readonly profile_id: string; readonly card_id: string | null }

async function lireSaisies(requete: APIRequestContext): Promise<readonly SaisieLue[]> {
	const reponse = await requete.get(rest(`saisies_temps?select=jour,minutes,profile_id,card_id&${PERIODE}&order=jour`), {
		headers: enTetesService(),
	})
	expect(reponse.status()).toBe(200)
	return (await reponse.json()) as SaisieLue[]
}

/** Ouvre la fiche et amène la bande sur la semaine de preuve, par deux « Semaine suivante ». */
async function ouvrirBande(page: Page, fiche: string) {
	await page.goto(fiche)
	const bande = page.getByTestId('temps-card-bande')
	await expect(bande.getByTestId('temps-card-tableau')).toBeVisible()
	for (let i = 0; i < 2; i += 1) await bande.getByRole('button', { name: 'Semaine suivante' }).click()
	await expect(bande.getByRole('textbox', { name: new RegExp(`, ${nomJour(LUNDI)}$`) })).toBeVisible()
	return bande
}

test('à la souris : une valeur s’enregistre seule, en base, sur l’affaire et pour soi ; le résumé se relit', async ({ page, request }) => {
	await connecterAvecLeLabs(page, BIZDEV)
	const bande = await ouvrirBande(page, FICHE_MGEN)
	const resume = page.getByTestId('temps-card')
	await expect(bande.getByRole('heading', { name: 'Votre semaine' })).toBeVisible()
	// Le seed ne pose aucun temps de Driss sur cette affaire (`docs/SPEC-seed.md` §17.1).
	await expect(resume).toContainText('Aucun temps saisi sur cette affaire.')

	await bande.getByRole('textbox', { name: `${TITRE_MGEN}, ${nomJour(LUNDI)}` }).click()
	await page.keyboard.type('2')
	await bande.getByTestId('temps-card-semaine').click()

	await expect.poll(async () => lireSaisies(request)).toEqual([{ jour: LUNDI, minutes: 210, profile_id: DRISS, card_id: MGEN }])
	await expect(bande.getByTestId('temps-total-ligne')).toHaveText('3 h 30')
	await expect(bande.getByTestId(`temps-total-${LUNDI}`)).toHaveText('2 / 4 quarts')
	// Le résumé « depuis le premier jour » compte la nouvelle saisie : il a été relu, sans recharger la page.
	await expect(resume.getByTestId('temps-card-duree')).toHaveText('3 h 30')
	await bande.scrollIntoViewIfNeeded()
	await capturer(page, 'bande-saisie-xl-1440', UNITE)
})

test('au clavier seul : Entrée passe au jour suivant, une valeur remplace, une case vidée retire le temps', async ({ page, request }) => {
	await connecterAvecLeLabs(page, BIZDEV)
	const bande = await ouvrirBande(page, FICHE_MGEN)
	const champ = (jour: string) => bande.getByRole('textbox', { name: `${TITRE_MGEN}, ${nomJour(jour)}` })

	await champ(LUNDI).focus()
	await page.keyboard.type('1')
	await page.keyboard.press('Enter')
	await expect(champ(MARDI)).toBeFocused()
	await page.keyboard.type('2')
	await page.keyboard.press('Enter')
	await expect(champ(MERCREDI)).toBeFocused()
	await expect.poll(async () => (await lireSaisies(request)).map((s) => `${s.jour}:${s.minutes}`)).toEqual([`${LUNDI}:105`, `${MARDI}:210`])

	// Remplacer : la valeur du lundi devient 3 quarts, et il n'existe toujours qu'UNE ligne ce jour-là.
	await page.keyboard.press('ArrowLeft')
	await page.keyboard.press('ArrowLeft')
	await expect(champ(LUNDI)).toBeFocused()
	await page.keyboard.type('3')
	await page.keyboard.press('Enter')
	await expect.poll(async () => (await lireSaisies(request)).map((s) => `${s.jour}:${s.minutes}`)).toEqual([`${LUNDI}:315`, `${MARDI}:210`])

	// Retirer : vider la case du mardi supprime la ligne.
	await champ(MARDI).focus()
	await page.keyboard.press('Backspace')
	await page.keyboard.press('Enter')
	await expect.poll(async () => (await lireSaisies(request)).map((s) => `${s.jour}:${s.minutes}`)).toEqual([`${LUNDI}:315`])
	await expect(champ(MARDI)).toHaveValue('')
})

test('le pied compte les autres cibles du jour, et un quart de trop est annoncé sans rien écrire', async ({ page, request }) => {
	// Trois quarts sur le channel « Maintenance », posés par la clé de service avant d'ouvrir la fiche.
	const posee = await request.post(rest('saisies_temps'), {
		headers: { ...enTetesService(), 'Content-Type': 'application/json' },
		data: { workspace_id: W, profile_id: DRISS, jour: LUNDI, minutes: 315, track_id: null, channel_id: MAINTENANCE, card_id: null, created_by: DRISS, updated_by: DRISS },
	})
	expect(posee.status(), await posee.text()).toBe(201)

	await connecterAvecLeLabs(page, BIZDEV)
	const bande = await ouvrirBande(page, FICHE_MGEN)
	await expect(bande.getByTestId(`temps-total-${LUNDI}`)).toHaveText('3 / 4 quarts')
	await expect(bande.getByTestId('temps-total-ligne'), 'un total nul ne s’écrit pas').toHaveCount(0)

	const champ = bande.getByRole('textbox', { name: `${TITRE_MGEN}, ${nomJour(LUNDI)}` })
	await champ.fill('2')
	await champ.press('Enter')
	await expect(champ).toHaveAttribute('aria-invalid', 'true')
	await expect(champ).toHaveAccessibleDescription('Cette valeur dépasserait la journée de 7 heures.')
	await capturer(page, 'bande-plafond-xl-1440', UNITE)
	expect((await lireSaisies(request)).filter((s) => s.card_id === MGEN), 'rien n’a été écrit sur l’affaire').toEqual([])

	await champ.fill('1')
	await champ.press('Enter')
	await expect(bande.getByTestId(`temps-total-${LUNDI}`)).toHaveText('4 / 4 quarts')
})

test('une journée en heures, et « Ouvrir dans Temps » relit la même semaine dans la matrice', async ({ page, request }) => {
	await connecterAvecLeLabs(page, BIZDEV)
	const bande = await ouvrirBande(page, FICHE_MGEN)
	await bande.getByRole('checkbox', { name: `Saisir le ${nomJour(MERCREDI)} en heures` }).check()
	const champ = bande.getByRole('textbox', { name: `${TITRE_MGEN}, ${nomJour(MERCREDI)}` })
	await champ.fill('1,5')
	await champ.press('Enter')
	await expect.poll(async () => (await lireSaisies(request)).map((s) => `${s.jour}:${s.minutes}`)).toEqual([`${MERCREDI}:90`])
	await expect(bande.getByTestId(`temps-total-${MERCREDI}`)).toHaveText('1 h 30 / 7 h')

	await bande.getByRole('link', { name: 'Ouvrir dans Temps' }).click()
	await expect(page).toHaveURL(new RegExp(`/temps\\?semaine=${LUNDI}$`))
	await expect(page.getByTestId('temps-matrice')).toBeVisible()
	await expect(page.getByRole('textbox', { name: `${TITRE_MGEN}, ${nomJour(MERCREDI)}` })).toHaveValue('1 h 30')
})

test('la lectrice saisit SON temps sur une affaire qu’elle lit, malgré la fiche en lecture seule', async ({ page, request }) => {
	await connecterAvecLeLabs(page, VIEWER)
	const bande = await ouvrirBande(page, FICHE_NORDIS)
	const champ = bande.getByRole('textbox', { name: new RegExp(`, ${nomJour(LUNDI)}$`) })
	await expect(champ).toBeEnabled()
	await champ.fill('1')
	await champ.press('Enter')
	await expect.poll(async () => (await lireSaisies(request)).map((s) => s.card_id)).toEqual([NORDIS])
})

test('l’administratrice : le résumé compte l’équipe, la bande ne saisit que son temps', async ({ page, request }) => {
	await connecterAvecLeLabs(page, ADMIN)
	const bande = await ouvrirBande(page, FICHE_MGEN)
	await expect(page.getByTestId('temps-card').getByTestId('personnel-portee')).toHaveText('Le temps de toute l’équipe')
	await expect(bande.getByRole('heading', { name: 'Votre semaine' })).toBeVisible()
	await expect(page.getByTestId('temps-card').getByTestId('temps-saisir-pour')).toHaveCount(0)
	const champ = bande.getByRole('textbox', { name: `${TITRE_MGEN}, ${nomJour(LUNDI)}` })
	await champ.fill('1')
	await champ.press('Enter')
	await expect.poll(async () => lireSaisies(request)).toEqual([{ jour: LUNDI, minutes: 105, profile_id: CAMILLE, card_id: MGEN }])
})

test('aux quatre paliers, la bande défile dans son cadre, jamais la page', async ({ page }) => {
	await connecterAvecLeLabs(page, BIZDEV)
	for (const palier of PALIERS) {
		await page.setViewportSize({ width: palier.largeur, height: palier.hauteur })
		const bande = await ouvrirBande(page, FICHE_MGEN)
		await bande.scrollIntoViewIfNeeded()
		const debordement = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
		expect(debordement, `aucun défilement horizontal de la page à ${palier.nom}`).toBeLessThanOrEqual(0)
		await capturer(page, `bande-${palier.nom}`, UNITE)
	}
})
