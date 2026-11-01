// @spec CRM-117 (docs/BACKLOG.md) — tranche T4.5 : les images des chapitres 27 à 29 — l'onglet « À saisir », le temps
//       passé et le coût du personnel, les recettes et la rentabilité
// @spec docs/SPEC-manual.md §11.1, §11.2 ; docs/manual.md chapitres 27, 28, 29 ; docs/SPEC-costs.md (les coûts réels,
//       l'onglet « À saisir »), docs/SPEC-temps.md (la saisie, le rapport, le coût du personnel), docs/SPEC-recettes.md
// @spec CRM-126 (docs/BACKLOG.md) — tranche T2 : l'image « tableau » montre le tableau unique en balance par devise
//
// Les écrans sont lus sur le seed — le track « Studio web », l'affaire « Refonte intranet Ville de Lyon », la semaine et
// le mois que le seed remplit. Rien n'est saisi : les formulaires sont ouverts puis refermés, et une valeur hors borne
// est montrée sans être envoyée.

import { expect, test } from '@playwright/test'
import { illustrer } from './illustrer'
import { ADMIN, VIEWER, connecterAvecLeLabs } from './outils'

const A_SAISIR = 'l-onglet-a-saisir-renseigner-les-couts-reels-a-la-suite'
const TEMPS = 'le-temps-passe-et-le-cout-du-personnel'
const RECETTES = 'les-recettes-d-une-affaire-et-sa-rentabilite'
const FICHE = '/tracks/studio-web/refonte/cards/5eed0000-0000-4000-8000-0000000000c4'

test('l’onglet « À saisir » d’un track', async ({ page }) => {
	await connecterAvecLeLabs(page, ADMIN)
	await page.goto('/tracks/studio-web/couts?onglet=saisir')
	const ligne = page.getByTestId('couts-a-saisir-ligne').first()
	await expect(ligne).toBeVisible()
	await illustrer(page, { chapitre: A_SAISIR, section: null, nom: 'a-saisir', cibles: [], pleinePage: true })
	await illustrer(page, { chapitre: A_SAISIR, section: 'saisir-au-clavier', nom: 'une-ligne', cibles: [ligne] })
	await illustrer(page, { chapitre: A_SAISIR, section: 'le-compteur-de-l-onglet', nom: 'compteur', cibles: [page.getByTestId('onglet-couts-saisir')] })
	await illustrer(page, { chapitre: A_SAISIR, section: 'ce-que-cet-onglet-ne-fait-pas', nom: 'onglet-couts', cibles: [page.getByTestId('onglet-couts-track')] })
	await ligne.getByTestId('couts-a-saisir-champ').fill('douze')
	await ligne.getByTestId('couts-a-saisir-champ').press('Tab')
	const refus = ligne.getByText('Ce montant n’est pas un nombre.')
	if ((await refus.count()) > 0) await illustrer(page, { chapitre: A_SAISIR, section: 'ce-que-l-ecran-ecrit-quand-quelque-chose-ne-va-pas', nom: 'pas-un-nombre', cibles: [ligne] })
	await ligne.getByTestId('couts-a-saisir-champ').fill('')

})

// Un autre compte, une autre page : la session de l'administratrice ne se quitte pas au milieu d'un test.
test('l’onglet « À saisir » vu par une lectrice', async ({ page }) => {
	await connecterAvecLeLabs(page, VIEWER)
	await page.goto('/tracks/studio-web/couts?onglet=saisir')
	await expect(page.getByTestId('onglet-couts-saisir')).toBeVisible()
	const lecture = page.getByTestId('couts-a-saisir-lecture-seule')
	if ((await lecture.count()) > 0) await illustrer(page, { chapitre: A_SAISIR, section: 'ce-que-vous-ne-pouvez-pas-modifier-reste-visible', nom: 'lecture-seule', cibles: [lecture] })
})

test('les réels d’une ligne de coût, dans la fiche', async ({ page }) => {
	await connecterAvecLeLabs(page, ADMIN)
	await page.goto(FICHE)
	const bloc = page.getByTestId('bloc-couts-card')
	await expect(bloc).toBeVisible()
	const bascule = bloc.getByTestId('cout-reels-bascule').first()
	if ((await bascule.count()) > 0) await bascule.click()
	await illustrer(page, { chapitre: A_SAISIR, section: 'les-reels-d-une-ligne-dans-la-fiche-d-une-affaire', nom: 'reels-d-une-ligne', cibles: [bloc] })
	const recettes = page.getByTestId('bloc-recettes-card')
	await illustrer(page, { chapitre: RECETTES, section: 'saisir-les-recettes-dans-la-fiche', nom: 'recettes', cibles: [recettes] })
	const rentabilite = page.getByTestId('bloc-rentabilite-card')
	await illustrer(page, { chapitre: RECETTES, section: 'la-rentabilite-d-une-affaire', nom: 'rentabilite-de-l-affaire', cibles: [rentabilite] })
	const temps = page.getByTestId('temps-card')
	await illustrer(page, { chapitre: TEMPS, section: 'saisir-son-temps-depuis-la-fiche-d-une-affaire', nom: 'temps-dans-la-fiche', cibles: [temps] })
})

test('le temps : la semaine, le rapport, le coût du personnel', async ({ page }) => {
	await connecterAvecLeLabs(page, ADMIN)
	await page.goto('/temps')
	const matrice = page.getByTestId('temps-matrice')
	await expect(matrice).toBeVisible()
	await illustrer(page, { chapitre: TEMPS, section: null, nom: 'temps', cibles: [], pleinePage: true })
	// La semaine dépasse la fenêtre de 900 px : elle est agrandie le temps de cette image (comme au chapitre 9).
	await page.setViewportSize({ width: 1440, height: 1400 })
	await illustrer(page, { chapitre: TEMPS, section: 'saisir-sa-semaine', nom: 'semaine', cibles: [page.getByTestId('temps-semaine'), matrice] })
	await page.setViewportSize({ width: 1440, height: 900 })
	const pour = page.getByTestId('temps-saisir-pour')
	if ((await pour.count()) > 0) await illustrer(page, { chapitre: TEMPS, section: 'saisir-pour-quelqu-un-d-autre', nom: 'saisir-pour', cibles: [pour] })
	await page.goto('/temps?onglet=rapport')
	const rapport = page.getByTestId('temps-rapport')
	await expect(rapport).toBeVisible()
	await illustrer(page, { chapitre: TEMPS, section: 'le-rapport-mensuel', nom: 'rapport-mensuel', cibles: [rapport] })
	await page.goto('/reglages/cout-personnel')
	const cout = page.getByTestId('cout-personnel')
	await expect(cout).toBeVisible()
	await illustrer(page, { chapitre: TEMPS, section: 'regler-le-cout-du-personnel', nom: 'cout-du-personnel', cibles: [cout] })
	await page.goto('/tracks/studio-web/couts')
	const personnel = page.getByTestId('personnel-track').or(page.getByTestId('personnel-portee')).first()
	if ((await personnel.count()) > 0) await illustrer(page, { chapitre: TEMPS, section: 'le-cout-du-personnel-a-cote-des-couts', nom: 'cout-a-cote-des-couts', cibles: [personnel] })
})

test('l’écran « Rentabilité »', async ({ page }) => {
	await connecterAvecLeLabs(page, ADMIN)
	await page.goto('/rentabilite')
	// Un seul tableau, une balance par devise (CRM-126, docs/SPEC-recettes.md §6.3 révisé).
	const tableau = page.getByRole('region', { name: 'Rentabilité des affaires, une balance par devise' })
	await expect(tableau).toBeVisible()
	await page.setViewportSize({ width: 1440, height: 1400 })
	await illustrer(page, { chapitre: RECETTES, section: 'l-ecran-rentabilite', nom: 'tableau', cibles: [page.getByTestId('onglet-rentab-ensemble'), tableau] })
	await page.goto('/rentabilite?onglet=saisir')
	const champ = page.getByTestId('recette-saisir-champ').first()
	if ((await champ.count()) > 0)
		await illustrer(page, { chapitre: RECETTES, section: 'l-onglet-a-saisir', nom: 'a-saisir', cibles: [champ.locator('xpath=ancestor::tr[1]')] })
})
