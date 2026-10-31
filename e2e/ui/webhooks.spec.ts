// @verifies CRM-073 (docs/BACKLOG.md) — tranche T3 : Réglages ▸ Webhooks sur la vraie pile — la liste semée et ses états,
//           l'historique et le renvoi, la création (événements de contact éteints sous un channel, le secret montré une
//           fois), la modification, la régénération confirmée, la suppression ; l'écran refusé à la lectrice ; les paliers
// @verifies docs/SPEC-webhooks.md §3, §4.1, §5.3, §6, §7 ; docs/DESIGN_SYSTEM.md §5.79, §5.59 ; docs/SPEC-seed.md §34 ;
//           CLAUDE.md §10 (refus par la base), §16 (captures)
// @verifies CRM-092 (docs/BACKLOG.md), docs/SPEC-session-sso.md §13 — connexion par la vraie page du SSO
//
// Les webhooks de la preuve portent le préfixe `tst-crm073` et sont retirés à la fin, par la clé de service.

import { URL_API, enTetesService } from '../api/jetons'
import { capturer, PALIERS } from './captures'
import { ERREUR_RESSOURCE_HTTP, autoriserErreursConsole, connecterAvecLeLabs, expect, test } from './fixtures'

const UNITE = 'CRM-073'
const ECRAN = '/reglages/webhooks'
const rest = (chemin: string) => `${URL_API}/rest/v1/${chemin}`

test.use({ viewport: { width: 1440, height: 1000 } })

test.afterEach(async ({ request }) => {
	await request.delete(rest(`webhook_endpoints?name=like.${encodeURIComponent('tst-crm073*')}`), { headers: enTetesService() })
})

test('Camille lit les webhooks semés, leur historique, et renvoie une remise', async ({ page, request }) => {
	await connecterAvecLeLabs(page, 'admin@p2enjoy.test')
	await page.goto(ECRAN)
	const lignes = page.getByTestId('ligne-webhook')
	await expect(lignes).toHaveCount(3)
	await expect(lignes.nth(0)).toContainText('Ancienne intégration')
	await expect(lignes.nth(0)).toContainText('Désactivé')
	await expect(lignes.nth(0)).toContainText('En attente')
	await expect(lignes.nth(1)).toContainText('Automate Refonte')
	await expect(lignes.nth(1)).toContainText('Studio web › Refonte de site')
	await expect(lignes.nth(1)).toContainText('Aucune remise')
	await expect(lignes.nth(2)).toContainText('Tableur commercial')
	await expect(lignes.nth(2)).toContainText('Remise réussie')
	// L'hôte seul : jamais le chemin de l'adresse.
	await expect(lignes.nth(2)).toContainText('webhook-sink:8443')
	await expect(lignes.nth(2)).not.toContainText('/crm/tableur')
	await capturer(page, 'webhooks-liste-1440', UNITE)

	await page.getByRole('button', { name: 'Historique des remises de Tableur commercial' }).click()
	const historique = page.getByTestId('historique-webhook')
	const remises = historique.getByTestId('ligne-remise')
	// « Tableur commercial » écoute tout l'espace : d'autres preuves jouées avant celle-ci peuvent lui avoir ajouté des
	// remises. Les deux du seed sont les PLUS ANCIENNES, donc les deux dernières lignes (la plus récente en haut, §5.79).
	await expect(remises.nth(1)).toBeVisible()
	const avant = await remises.count()
	const anonymisation = remises.nth(avant - 2)
	const creation = remises.nth(avant - 1)
	await expect(anonymisation).toContainText('Contact supprimé ou anonymisé')
	await expect(anonymisation.getByTestId('resultat-remise')).toHaveText('200')
	await expect(creation).toContainText('Contact créé')
	await creation.getByRole('button', { name: /Voir le corps/ }).click()
	await expect(historique.getByTestId('corps-remise')).toContainText('"event": "contact.created"')
	await capturer(page, 'webhooks-historique-1440', UNITE)

	await creation.getByTestId('renvoyer-remise').click()
	await expect(historique.getByTestId('message-historique')).toHaveText('Remise renvoyée.')
	await expect(remises).toHaveCount(Math.min(avant + 1, 50))
	// L'effet en base : une nouvelle remise du même événement, qui renvoie à celle d'origine.
	const relues = (await (
		await request.get(rest('webhook_deliveries?select=redelivery_of&redelivery_of=not.is.null'), { headers: enTetesService() })
	).json()) as unknown[]
	expect(relues.length).toBeGreaterThanOrEqual(1)
	await request.delete(rest('webhook_deliveries?redelivery_of=not.is.null'), { headers: enTetesService() })
})

test('Camille crée un webhook — le secret une seule fois —, le modifie, régénère son secret puis le supprime', async ({
	page,
	request,
}) => {
	await connecterAvecLeLabs(page, 'admin@p2enjoy.test')
	await page.goto(ECRAN)
	await page.getByTestId('nouveau-webhook').click()
	const fiche = page.getByTestId('fiche-webhook')
	await expect(fiche.getByLabel('Nom')).toBeFocused()
	await fiche.getByLabel('Nom').fill('tst-crm073 Automate')
	await fiche.getByLabel('Adresse').fill('https://webhook-sink:8443/crm/tst')
	await fiche.getByLabel('Channel').selectOption({ label: 'Studio web — Refonte de site' })
	await expect(fiche.getByLabel('Contact créé')).toBeDisabled()
	await expect(fiche.getByTestId('webhook-contacts-eteints')).toBeVisible()
	await fiche.getByLabel('Affaire créée').check()
	await capturer(page, 'webhooks-fiche-1440', UNITE)
	await fiche.getByTestId('webhook-enregistrer').click()

	const secret = page.getByTestId('webhook-secret')
	await expect(secret).toHaveValue(/^whsec_[0-9a-f]{64}$/)
	await capturer(page, 'webhooks-secret-1440', UNITE)
	const valeur = await secret.inputValue()
	await page.getByTestId('webhook-secret-fermer').click()
	await expect(page.getByTestId('webhook-secret')).toHaveCount(0)
	// Le secret n'est nulle part ailleurs à l'écran, ni relisible par l'API.
	await expect(page.locator('body')).not.toContainText(valeur)
	const ligne = page.getByTestId('ligne-webhook').filter({ hasText: 'tst-crm073 Automate' })
	await expect(ligne).toContainText('1 événement')

	await ligne.getByRole('button', { name: 'Modifier le webhook tst-crm073 Automate' }).click()
	const edition = page.getByTestId('fiche-webhook')
	await edition.getByLabel('Nom').fill('tst-crm073 Automate renommé')
	await edition.getByLabel('Actif').uncheck()
	await edition.getByTestId('webhook-enregistrer').click()
	const renommee = page.getByTestId('ligne-webhook').filter({ hasText: 'tst-crm073 Automate renommé' })
	await expect(renommee).toContainText('Désactivé')

	await renommee.getByRole('button', { name: /Régénérer le secret/ }).click()
	await expect(page.getByTestId('confirmation-rotation-confirmer')).toBeFocused()
	await capturer(page, 'webhooks-regeneration-1440', UNITE)
	await page.getByTestId('confirmation-rotation-confirmer').click()
	await expect(page.getByTestId('webhook-secret')).toHaveValue(/^whsec_[0-9a-f]{64}$/)
	await expect(page.getByTestId('webhook-secret')).not.toHaveValue(valeur)
	await page.getByTestId('webhook-secret-fermer').click()

	await renommee.getByRole('button', { name: /Supprimer le webhook/ }).click()
	await page.getByTestId('confirmation-suppression-confirmer').click()
	await expect(page.getByTestId('ligne-webhook').filter({ hasText: 'tst-crm073' })).toHaveCount(0)
	await expect(page.getByTestId('nouveau-webhook')).toBeFocused()
	const restants = (await (
		await request.get(rest(`webhook_endpoints?name=like.${encodeURIComponent('tst-crm073*')}&select=id`), { headers: enTetesService() })
	).json()) as unknown[]
	expect(restants).toEqual([])
})

test('une adresse en http:// est refusée par la base, sous les champs, la saisie gardée', async ({ page }) => {
	await connecterAvecLeLabs(page, 'admin@p2enjoy.test')
	await page.goto(ECRAN)
	await page.getByTestId('nouveau-webhook').click()
	const fiche = page.getByTestId('fiche-webhook')
	await fiche.getByLabel('Nom').fill('tst-crm073 En clair')
	await fiche.getByLabel('Adresse').fill('http://outil.example/hook')
	await fiche.getByLabel('Affaire créée').check()
	await fiche.getByTestId('webhook-enregistrer').click()
	await expect(fiche.getByTestId('refus-webhook')).toContainText('https://')
	// Le refus de la base est un `400` : la console le note, et c'est le refus que l'écran vient de traduire.
	autoriserErreursConsole(page, [ERREUR_RESSOURCE_HTTP[400]])
	await expect(fiche.getByLabel('Adresse')).toBeFocused()
	await expect(fiche.getByLabel('Adresse')).toHaveValue('http://outil.example/hook')
	await capturer(page, 'webhooks-refus-adresse-1440', UNITE)
})

test('la lectrice : l’entrée de l’index est éteinte, et l’écran ouvert par son adresse est réservé', async ({ page }) => {
	await connecterAvecLeLabs(page, 'viewer@p2enjoy.test')
	await page.goto('/reglages')
	const entree = page.getByTestId('entree-webhooks')
	await expect(entree).toHaveAttribute('aria-disabled', 'true')
	await page.goto(ECRAN)
	await expect(page.getByText('Réservé aux administrateurs')).toBeVisible()
	await expect(page.getByTestId('liste-webhooks')).toHaveCount(0)
	await capturer(page, 'webhooks-lectrice-1440', UNITE)
})

for (const palier of PALIERS) {
	test(`les paliers : ${palier.nom}, la liste et l’historique ouvert sans défilement de page`, async ({ page }) => {
		await page.setViewportSize({ width: palier.largeur, height: palier.hauteur })
		await connecterAvecLeLabs(page, 'admin@p2enjoy.test')
		await page.goto(ECRAN)
		await expect(page.getByTestId('ligne-webhook')).toHaveCount(3)
		await page.getByRole('button', { name: 'Historique des remises de Tableur commercial' }).click()
		await expect(page.getByTestId('ligne-remise').first()).toBeVisible()
		const debordement = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
		expect(debordement, 'aucun défilement horizontal de page').toBeLessThanOrEqual(0)
		await capturer(page, `webhooks-palier-${palier.nom}`, UNITE)
	})
}
