// @spec CRM-149 (docs/BACKLOG.md) — tranche T4 : les images du §33.7, « Les prompts : des parcours guidés » — Réglages ▸
//       Prompts du connecteur, la liste des six prompts du seed, puis la fiche d'un prompt ouverte par « Modifier »
// @spec docs/SPEC-manual.md §11.1, §11.2 ; docs/manual.md §33.7 ; docs/SPEC-mcp.md §17.7 ; docs/DESIGN_SYSTEM.md §5.104 ;
//       docs/SPEC-seed.md §47
//
// Rien n'est écrit : la fiche est ouverte, photographiée, puis refermée par « Annuler ».
// *Révisé le 2026-11-21 (`CRM-161` T2.a, docs/SPEC-espace-courant.md §15.5, décision 51)* : les pages d'un espace sont sous
// le slug de l'espace (`/p2enjoy/…`) ; les adresses et leurs attentes suivent, sans changer ce que la preuve prouve.

import { expect, test } from '@playwright/test'
import { illustrer } from './illustrer'
import { ADMIN, connecterAvecLeLabs } from './outils'

const CONNECTEUR = 'le-connecteur-mcp-piloter-le-crm-depuis-votre-assistant'
const SECTION = 'les-prompts-des-parcours-guides'

test('Réglages ▸ Prompts du connecteur : la liste, puis la fiche d’un prompt', async ({ page }) => {
	await page.setViewportSize({ width: 1280, height: 900 })
	await connecterAvecLeLabs(page, ADMIN)
	await page.goto('/p2enjoy/reglages/prompts-connecteur')
	const ecran = page.getByTestId('reglages-prompts-connecteur')
	const liste = ecran.getByTestId('liste-prompts')
	await expect(liste.getByTestId('ligne-prompt').filter({ hasText: 'preparer-le-comite' })).toBeVisible()
	await illustrer(page, {
		chapitre: CONNECTEUR,
		section: SECTION,
		nom: 'prompts-du-connecteur',
		cibles: [ecran.getByRole('heading', { name: 'Prompts du connecteur' }), ecran.getByTestId('nouveau-prompt'), liste],
	})

	await page.getByRole('button', { name: 'Modifier le prompt Faire le point sur une affaire' }).click()
	const fiche = page.getByTestId('fiche-prompt')
	await expect(fiche.getByTestId('prompt-titre')).toHaveValue('Faire le point sur une affaire')
	await illustrer(page, { chapitre: CONNECTEUR, section: SECTION, nom: 'prompt-fiche', cibles: [fiche] })
	await fiche.getByTestId('prompt-annuler').click()
	await expect(fiche).toHaveCount(0)
})
