// @spec CRM-165 (docs/BACKLOG.md) — tranche T3 : les images du §33.8, « Les consignes de la plateforme » — le bloc
//       « Consignes aux assistants » de Plateforme ▸ Connecteur MCP, avec le texte du seed et son auteur, puis les consignes
//       fixes du connecteur dépliées
// @spec docs/SPEC-manual.md §11.1, §11.2 ; docs/manual.md §33.8 ; docs/SPEC-mcp.md §18.5, §18.6 ; docs/DESIGN_SYSTEM.md
//       §5.114 ; docs/SPEC-seed.md §56
//
// Rien n'est écrit : le texte est celui que le seed fait écrire à Sabine ; le socle est celui que le service `mcp` publie.

import { expect, test } from '@playwright/test'
import { illustrer } from './illustrer'
import { connecterAvecLeLabs } from './outils'

const CONNECTEUR = 'le-connecteur-mcp-piloter-le-crm-depuis-votre-assistant'
const SECTION = 'les-consignes-de-la-plateforme'
const SABINE = 'plateforme@p2enjoy.test'

test('Plateforme ▸ Connecteur MCP : les consignes de la plateforme, puis les consignes fixes dépliées', async ({ page }) => {
	await page.setViewportSize({ width: 1280, height: 900 })
	await connecterAvecLeLabs(page, SABINE)
	await page.goto('/plateforme/mcp')
	const bloc = page.getByTestId('consignes-connecteur')
	const champ = bloc.getByTestId('consignes-texte')
	await expect(champ).toHaveValue(/^Avant de créer une affaire, cherchez-la avec crm_search/)
	await expect(bloc.getByTestId('consignes-auteur')).toHaveText(/^Modifiées par /)
	// Le bloc est sous les comptes et la recherche : il est centré dans la fenêtre, pour que son titre et son champ y tiennent.
	await bloc.evaluate((element) => element.scrollIntoView({ block: 'center' }))
	await illustrer(page, {
		chapitre: CONNECTEUR,
		section: SECTION,
		nom: 'consignes-de-la-plateforme',
		cibles: [bloc.getByRole('heading', { name: 'Consignes aux assistants' }), champ],
	})

	const socle = bloc.getByTestId('consignes-socle')
	await socle.locator('summary').click()
	await expect(socle.locator('pre')).toContainText('P2Enjoy CRM')
	// Le socle déplié est plus haut que la fenêtre de 900 px : elle est agrandie pour que « Enregistrer », le résumé et tout le
	// texte y tiennent.
	await page.setViewportSize({ width: 1280, height: 1600 })
	await socle.locator('summary').evaluate((element) => {
		element.scrollIntoView({ block: 'start' })
		window.scrollBy(0, -160)
	})
	await illustrer(page, { chapitre: CONNECTEUR, section: SECTION, nom: 'consignes-fixes', cibles: [bloc.getByTestId('consignes-enregistrer'), socle.locator('summary'), socle.locator('pre')] })
})
