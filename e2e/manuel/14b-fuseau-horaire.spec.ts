// @spec INC-216 (docs/BACKLOG.md « Correctif arbitré le 2026-11-25 — INC-216 ») — tranche T2.c : l'image du §14.4 du manuel, « Le fuseau horaire de l'espace »
//       — Réglages ▸ Fuseau horaire, le champ, l'heure qu'il est dans le fuseau, et « Enregistrer »
// @spec docs/SPEC-manual.md §11.1, §11.2 ; docs/manual.md §14.4 ; docs/SPEC-modeles-emails.md §8.6 ter ; docs/DESIGN_SYSTEM.md §5.117
//
// Rien n'est écrit : l'écran est ouvert sur l'espace du seed, photographié, et laissé tel quel.

import { expect, test } from '@playwright/test'
import { illustrer } from './illustrer'
import { ADMIN, connecterAvecLeLabs } from './outils'

const CHAPITRE = 'ecrire-des-modeles-d-emails-et-les-previsualiser'
const SECTION = 'le-fuseau-horaire-de-l-espace'

test('Réglages ▸ Fuseau horaire : le champ, l’heure du fuseau et « Enregistrer »', async ({ page }) => {
	await page.setViewportSize({ width: 1280, height: 900 })
	await connecterAvecLeLabs(page, ADMIN)
	await page.goto('/p2enjoy/reglages/fuseau-horaire')
	const ecran = page.getByTestId('reglages-fuseau-espace')
	await expect(ecran.getByTestId('champ-fuseau')).toHaveValue('Europe/Paris')
	await expect(ecran.getByTestId('heure-fuseau')).toBeVisible()
	await illustrer(page, {
		chapitre: CHAPITRE,
		section: SECTION,
		nom: 'fuseau-horaire',
		cibles: [ecran.getByRole('heading', { name: 'Fuseau horaire de l’espace' }), ecran.getByTestId('champ-fuseau'), ecran.getByTestId('heure-fuseau'), ecran.getByTestId('enregistrer-fuseau')],
	})
})
