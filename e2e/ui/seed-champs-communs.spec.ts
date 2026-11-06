// @verifies CRM-112 (docs/BACKLOG.md) — tranche T8 : le jeu de démonstration des champs de l'affaire, tel que l'écran le
//           rend — Réglages avec un champ archivé, la partie commune de la fiche, les colonnes et le filtre de la liste, le
//           refus de transition faute de SIRET, la recherche par SIRET, le modèle prévisualisé, la lectrice, la suggestion
//           de l'assistant ; captures aux quatre paliers
// @verifies docs/SPEC-seed.md §38 (décisions 853 et 855) ; docs/SPEC-champs-communs.md §13 et §14 (E2E, visuel) ;
//           docs/DESIGN_SYSTEM.md §5.86, §5.88, §5.91, §5.92, §5.52 ter ; §7 (quatre paliers, aucun défilement horizontal)
// @verifies CLAUDE.md §8 (le seed démontre chaque fonctionnalité livrée), §15 (état déterministe), §16 (captures observées)
//
// Le jeu n'est pas modifié : chaque geste est une lecture, ou un déplacement que la base refuse (la refonte du monitoring
// de Vertuo n'a pas de SIRET). Les données sont celles de `supabase/seed/apply-seed.sh`, section « 8 tertricies ».

import { ERREUR_RESSOURCE_HTTP, autoriserErreursConsole, connecterAvecLeLabs, expect, test, type APIRequestContext, type Page } from './fixtures'
import { PALIERS, capturer } from './captures'
import { URL_API, enTetesService } from '../api/jetons'

const UNITE = 'CRM-112'
const ADMIN = 'admin@p2enjoy.test'
const LECTRICE = 'viewer@p2enjoy.test'
const BILLETTERIE = 'Plateforme de billetterie — Musée des Confluences'
const VERTUO = '5eed0000-0000-4000-8000-00000000d012'
const TITRE_VERTUO = 'Refonte du monitoring — Vertuo'
const NBSP = ' '
const guillemets = (texte: string) => texte.replace(/« /g, `«${NBSP}`).replace(/ »/g, `${NBSP}»`)

async function idBilletterie(requete: APIRequestContext): Promise<string> {
	const reponse = await requete.get(`${URL_API}/rest/v1/cards?select=id&title=eq.${encodeURIComponent(BILLETTERIE)}`, {
		headers: enTetesService(),
	})
	expect(reponse.status()).toBe(200)
	const [ligne] = (await reponse.json()) as { id: string }[]
	expect(ligne?.id, 'la billetterie du seed (§36) doit exister').toBeTruthy()
	return ligne?.id ?? ''
}

async function sansDefilementDeCote(page: Page): Promise<void> {
	const debordement = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
	expect(debordement, 'la page ne défile jamais horizontalement (§7)').toBeLessThanOrEqual(0)
}

test.describe('Le jeu de démonstration des champs de l’affaire (docs/SPEC-seed.md §38)', () => {
	for (const palier of PALIERS) {
		test(`Réglages, la fiche, la liste filtrée et le refus de transition au palier ${palier.nom}`, async ({ page, request }) => {
			await page.setViewportSize({ width: palier.largeur, height: palier.hauteur })
			const billetterie = await idBilletterie(request)
			await connecterAvecLeLabs(page, ADMIN)

			// Réglages ▸ « Champs de l'affaire » : quatre actifs ; l'archivé paraît sous la case.
			await page.goto('/reglages/champs')
			for (const cle of ['siret', 'secteur', 'date-signature', 'budget-client']) {
				await expect(page.locator(`[data-champ="${cle}"]`)).toBeVisible()
			}
			await expect(page.locator('[data-champ="code-client-historique"]')).toHaveCount(0)
			await page.getByLabel('Afficher les archivés').check()
			await expect(page.locator('[data-champ="code-client-historique"]')).toContainText('Archivé')
			await sansDefilementDeCote(page)
			await capturer(page, `seed-champs-reglages-${palier.nom}`, UNITE)

			// La fiche de la billetterie : la partie commune, et la valeur gardée du champ archivé.
			await page.goto(`/tracks/conseil-ia/grands-comptes/cards/${billetterie}`)
			const bloc = page.getByTestId('bloc-champs-communs')
			await expect(bloc.getByRole('heading', { level: 2, name: 'Champs de l’affaire' })).toBeVisible()
			await expect(page.locator('#commun-siret')).toHaveValue('81234567800012')
			await expect(bloc.getByTestId('commun-archive-code-client-historique')).toContainText('CLI-0042')
			await expect(bloc.getByTestId('commun-archive-code-client-historique')).toContainText('Archivé')
			await bloc.scrollIntoViewIfNeeded()
			await sansDefilementDeCote(page)
			await capturer(page, `seed-champs-fiche-${palier.nom}`, UNITE)

			// La liste de « Grands comptes » : les colonnes SIRET et Secteur, et le filtre « Secteur public ».
			await page.goto('/tracks/conseil-ia/grands-comptes/liste')
			await expect(page.locator('[data-testid="entete-commun"][data-champ="siret"]')).toBeVisible()
			await expect(page.locator('[data-testid="entete-commun"][data-champ="secteur"]')).toBeVisible()
			await page.getByTestId('ouvrir-filtres-communs').click()
			const panneau = page.getByTestId('panneau-filtres-communs')
			await panneau.locator('[data-champ="secteur"]').getByLabel('Secteur public').check()
			await panneau.getByTestId('appliquer-filtres-communs').click()
			await expect(page.getByTestId('ligne-card').filter({ hasText: BILLETTERIE })).toBeVisible()
			await sansDefilementDeCote(page)
			await capturer(page, `seed-champs-liste-${palier.nom}`, UNITE)

			// Le board de « Maintenance » : Vertuo, sans SIRET, est refusé vers Signature, et le refus nomme le champ.
			await page.goto('/tracks/studio-web/maintenance')
			const carte = page.locator(`[data-testid="carte-card"][data-card="${VERTUO}"]`)
			await carte.scrollIntoViewIfNeeded()
			await carte.getByRole('button', { name: `Actions ${TITRE_VERTUO}` }).click()
			await carte.getByRole('button', { name: 'Passer en signature' }).click()
			const refus = page.getByTestId('refus-deplacement')
			await expect(refus).toHaveAttribute('data-cle', 'missing_required_fields')
			await expect(page.getByTestId('champs-manquants')).toContainText('SIRET')
			autoriserErreursConsole(page, [ERREUR_RESSOURCE_HTTP[400]])
			// Le bandeau du refus vit au-dessus des colonnes : la capture le montre, pas la carte.
			await refus.scrollIntoViewIfNeeded()
			await sansDefilementDeCote(page)
			await capturer(page, `seed-champs-refus-${palier.nom}`, UNITE)
		})
	}

	test.describe('à 1440 px', () => {
		test.use({ viewport: { width: 1440, height: 900 } })

		test('la recherche trouve la billetterie par son SIRET, et l’extrait nomme le champ', async ({ page }) => {
			await connecterAvecLeLabs(page, ADMIN)
			await page.goto('/')
			await page.getByTestId('champ-recherche').fill('81234567800012')
			const ligne = page.getByTestId('resultat-recherche').filter({ hasText: BILLETTERIE })
			await expect(ligne).toBeVisible()
			await expect(ligne).toContainText('SIRET')
			await capturer(page, 'seed-champs-recherche-xl-1440', UNITE)
		})

		test('le modèle « SIRET pour la facturation » se prévisualise avec le SIRET de la billetterie', async ({ page }) => {
			await connecterAvecLeLabs(page, ADMIN)
			await page.goto('/reglages/modeles-emails')
			await page.getByTestId('ligne-modele-email').filter({ hasText: 'SIRET pour la facturation' }).getByTestId('previsualiser-modele').click()
			await page.getByTestId('champ-affaire-previsualisation').selectOption({ label: BILLETTERIE })
			await page.getByTestId('lancer-previsualisation').click()
			await expect(page.getByTestId('rendu-corps')).toContainText(/812\s?345\s?678\s?00012/)
			await capturer(page, 'seed-champs-modele-xl-1440', UNITE)
		})

		test('la lectrice lit les champs de la billetterie sans pouvoir les écrire', async ({ page, request }) => {
			const billetterie = await idBilletterie(request)
			await connecterAvecLeLabs(page, LECTRICE)
			await page.goto(`/tracks/studio-web/refonte/cards/${billetterie}`)
			const bloc = page.getByTestId('bloc-champs-communs')
			await expect(page.locator('#commun-siret')).toHaveValue('81234567800012')
			await expect(page.locator('#commun-siret')).toBeDisabled()
			await expect(bloc.getByTestId('commun-archive-code-client-historique')).toContainText('CLI-0042')
			await capturer(page, 'seed-champs-lectrice-xl-1440', UNITE)
		})

		test('la suggestion de l’assistant qui doublonne le SIRET est en revue, son défaut nommé', async ({ page }) => {
			await connecterAvecLeLabs(page, ADMIN)
			await page.goto('/reglages/workflows')
			await page.getByTestId('ia-suggestions-en-revue').getByRole('button', { name: /Un cycle de vente aux entreprises/ }).click()
			await expect(page.getByTestId('ia-defauts').getByRole('listitem')).toHaveText([
				guillemets('Le champ « siret » reprend le champ de l’affaire « SIRET », déjà porté par toute affaire de l’espace : retirez-le ou renommez-le.'),
			])
			await capturer(page, 'seed-champs-suggestion-xl-1440', UNITE)
		})
	})
})
