// @verifies CRM-071 (docs/BACKLOG.md) — tranche T5 : l'import du carnet sur la vraie pile — un fichier déposé, les colonnes
//           reconnues, la vérification et ses lignes écartées, l'import, le rapport, le carnet relu ; la lectrice éteinte
// @verifies docs/DESIGN_SYSTEM.md §5.77, §5.59 ; docs/SPEC-vues-import-export.md §6.1, §6.2 ; CLAUDE.md §10, §16
// @verifies CRM-092 (docs/BACKLOG.md), docs/SPEC-session-sso.md §13 — connexion par la vraie page du SSO
//
// Les contacts et organisations de la preuve portent le préfixe `ZZ 071` et sont retirés à la fin, par la clé de service.

import { URL_API, enTetesService } from '../api/jetons'
import { capturer } from './captures'
import { connecterAvecLeLabs, expect, test } from './fixtures'

const UNITE = 'CRM-071'
const FICHIER = [
	'Nom;Email;Société;Notes',
	'ZZ 071 Anne Petit;anne.petit@zz071.example;ZZ 071 Petit SA;salon',
	'ZZ 071 Bruno;ANNE.PETIT@zz071.example;;doublon',
	'ZZ 071 Chloé;pas-un-email;;refusée',
	'',
].join('\r\n')

test.use({ viewport: { width: 1440, height: 1000 } })

test.afterEach(async ({ request }) => {
	await request.delete(`${URL_API}/rest/v1/contacts?full_name=like.${encodeURIComponent('ZZ 071*')}`, { headers: enTetesService() })
	await request.delete(`${URL_API}/rest/v1/organizations?name=like.${encodeURIComponent('ZZ 071*')}`, { headers: enTetesService() })
})

test('Driss importe un fichier : vérification, lignes écartées, import, rapport, carnet relu', async ({ page }) => {
	await connecterAvecLeLabs(page, 'bizdev@p2enjoy.test')
	await page.goto('/contacts')
	await page.getByTestId('importer-contacts').click()
	const panneau = page.getByTestId('panneau-import')
	await expect(panneau.getByLabel('Fichier CSV')).toBeFocused()
	await panneau.getByLabel('Fichier CSV').setInputFiles({ name: 'salon.csv', mimeType: 'text/csv', buffer: Buffer.from(FICHIER, 'utf8') })

	const champs = panneau.getByTestId('champ-colonne-import')
	await expect(champs).toHaveCount(4)
	await expect(champs.nth(0)).toHaveValue('full_name')
	await expect(champs.nth(2)).toHaveValue('organization_name')
	await expect(champs.nth(3)).toHaveValue('ignorer')
	await panneau.getByTestId('import-verifier').click()
	await expect(panneau.getByTestId('import-comptes')).toHaveText('1 ligne sera créée, 1 doublon ignoré, 1 ligne refusée.')
	await expect(panneau.getByTestId('ligne-ecartee-import')).toHaveCount(2)
	await expect(panneau.getByTestId('import-confirmer')).toBeFocused()
	await capturer(page, 'import-verification-1440', UNITE)

	await panneau.getByTestId('import-confirmer').click()
	await expect(panneau.getByTestId('import-rapport')).toHaveText('1 ligne créée, dont 1 organisation ; 1 doublon ignoré ; 1 ligne refusée.')
	await expect(panneau.getByTestId('import-terminer')).toBeFocused()
	const attente = page.waitForEvent('download')
	await panneau.getByTestId('import-telecharger-rapport').click()
	expect((await attente).suggestedFilename()).toMatch(/^rapport-import-\d{4}-\d{2}-\d{2}\.csv$/)
	await capturer(page, 'import-rapport-1440', UNITE)

	await panneau.getByTestId('import-terminer').click()
	await expect(panneau).toHaveCount(0)
	await expect(page.getByTestId('importer-contacts')).toBeFocused()
	await expect(page.getByRole('link', { name: 'ZZ 071 Anne Petit' })).toBeVisible()
})

test('la lectrice : « Importer un fichier » est éteinte avec le motif du carnet', async ({ page }) => {
	await connecterAvecLeLabs(page, 'viewer@p2enjoy.test')
	await page.goto('/contacts')
	const commande = page.getByTestId('importer-contacts')
	await expect(commande).toBeDisabled()
	await expect(commande).toHaveAttribute('aria-describedby', /.+/)
	await page.setViewportSize({ width: 390, height: 900 })
	await page.reload()
	await expect(page.getByTestId('importer-contacts')).toBeVisible()
	const debordement = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
	expect(debordement, 'aucun défilement horizontal de page à 390 px').toBeLessThanOrEqual(0)
	await capturer(page, 'import-lectrice-390', UNITE)
})
