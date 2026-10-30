// @verifies CRM-071 (docs/BACKLOG.md) — tranche T6 : l'import des affaires sur la vraie pile — un fichier au format de l'export
//           déposé dans la vue liste, ses colonnes reconnues, la vérification et ses lignes écartées, l'import, le rapport,
//           la liste relue et le focus rendu ; la fiche dit « Affaire créée par import » ; la lectrice éteinte
// @verifies docs/DESIGN_SYSTEM.md §5.78, §5.77, §5.59 ; docs/SPEC-vues-import-export.md §6.3, §6.3 bis ; CLAUDE.md §10, §16
// @verifies CRM-092 (docs/BACKLOG.md), docs/SPEC-session-sso.md §13 — connexion par la vraie page du SSO
//
// Les affaires de la preuve portent le préfixe `ZZ 071` et sont retirées à la fin, par la clé de service.

import { URL_API, enTetesService } from '../api/jetons'
import { capturer } from './captures'
import { connecterAvecLeLabs, expect, test } from './fixtures'

const UNITE = 'CRM-071'
const FICHIER = [
	'Identifiant;Affaire;Responsable;Étape;Montant;Devise;Échéance',
	';ZZ 071 Refonte Atelier Lumen;Driss Lemoine;Négociation;12 500;EUR;20/11/2026',
	';Portail adhérents — MGEN Loire;;;;;',
	';ZZ 071 Étape inconnue;;Signature électronique;;;',
	'',
].join('\r\n')

test.use({ viewport: { width: 1440, height: 1000 } })

test.afterEach(async ({ request }) => {
	await request.delete(`${URL_API}/rest/v1/cards?title=like.${encodeURIComponent('ZZ 071*')}`, { headers: enTetesService() })
})

test('Driss importe un export retouché : vérification, import, rapport, liste relue, fil « par import »', async ({ page }) => {
	await connecterAvecLeLabs(page, 'bizdev@p2enjoy.test')
	await page.goto('/tracks/studio-web/refonte/liste')
	await page.getByTestId('importer-affaires').click()
	const panneau = page.getByTestId('panneau-import')
	await expect(panneau.getByLabel('Fichier CSV')).toBeFocused()
	// Le panneau et le formulaire de création s'excluent (§5.78) : « Nouvelle affaire » se retire.
	await expect(page.getByTestId('nouvelle-affaire')).toHaveCount(0)
	await panneau.getByLabel('Fichier CSV').setInputFiles({ name: 'affaires.csv', mimeType: 'text/csv', buffer: Buffer.from(FICHIER, 'utf8') })

	const champs = panneau.getByTestId('champ-colonne-import')
	await expect(champs).toHaveCount(7)
	await expect(champs.nth(0)).toHaveValue('ignorer')
	await expect(champs.nth(1)).toHaveValue('title')
	await expect(champs.nth(2)).toHaveValue('owner')
	await expect(champs.nth(3)).toHaveValue('step')
	await panneau.getByTestId('import-verifier').click()
	await expect(panneau.getByTestId('import-comptes')).toHaveText('1 ligne sera créée, 1 doublon ignoré, 1 ligne refusée.')
	await expect(panneau.getByTestId('ligne-ecartee-import')).toHaveText([
		/^2Portail adhérents — MGEN LoireUne affaire de ce channel porte déjà ce titre\.$/,
		/^3ZZ 071 Étape inconnueAucune étape de ce channel ne porte ce nom\.$/,
	])
	await expect(panneau.getByTestId('import-confirmer')).toBeFocused()
	await capturer(page, 'import-affaires-verification-1440', UNITE)

	await panneau.getByTestId('import-confirmer').click()
	await expect(panneau.getByTestId('import-rapport')).toHaveText('1 ligne créée ; 1 doublon ignoré ; 1 ligne refusée.')
	await capturer(page, 'import-affaires-rapport-1440', UNITE)
	await panneau.getByTestId('import-terminer').click()
	await expect(panneau).toHaveCount(0)
	await expect(page.getByTestId('importer-affaires')).toBeFocused()
	const ligne = page.getByTestId('ligne-card').filter({ hasText: 'ZZ 071 Refonte Atelier Lumen' })
	await expect(ligne).toContainText('Négociation')

	await ligne.getByRole('link', { name: 'ZZ 071 Refonte Atelier Lumen' }).click()
	await expect(page.getByText('Affaire créée par import')).toBeVisible()
	await capturer(page, 'import-affaires-fil-1440', UNITE)
})

test('la lectrice : « Importer un fichier » est éteinte avec le motif du channel, sans débordement à 390 px', async ({ page }) => {
	await connecterAvecLeLabs(page, 'viewer@p2enjoy.test')
	await page.goto('/tracks/studio-web/refonte/liste')
	const commande = page.getByTestId('importer-affaires')
	await expect(commande).toBeDisabled()
	await expect(commande).toHaveAttribute('aria-describedby', /.+/)
	await page.setViewportSize({ width: 390, height: 900 })
	await page.reload()
	await expect(page.getByTestId('importer-affaires')).toBeVisible()
	await page.getByTestId('importer-affaires').scrollIntoViewIfNeeded()
	const debordement = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
	expect(debordement, 'aucun défilement horizontal de page à 390 px').toBeLessThanOrEqual(0)
	await capturer(page, 'import-affaires-lectrice-390', UNITE)
})
