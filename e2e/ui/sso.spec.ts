// @verifies CRM-091 (docs/BACKLOG.md) — connexion unique vécue dans le navigateur, Keycloak réel
// @verifies docs/SPEC-auth.md §10.3 (parcours), §10.4 (refus rendus), §10.5 (stockage d'onglet),
//           §10.10 (preuves exigées) ; docs/DESIGN_SYSTEM.md §5.12, §7, §8 ; CLAUDE.md §11, §16
//
// Le navigateur quitte réellement le CRM pour la page de connexion du Keycloak de développement,
// y saisit les identifiants d'un compte du realm, et revient. Aucune réponse n'est substituée, sauf
// dans le scénario d'annulation, qui le NOMME : ce realm n'a pas d'écran de consentement où refuser,
// et la réponse substituée est exactement la redirection que Keycloak rend alors (docs/DESIGN_SYSTEM.md
// §12.5, réponse substituée admise pour isoler un état rare).

import { autoriserErreursConsole, expect, test, type Page } from './fixtures'
import { PALIERS, capturer } from './captures'
import { lireEnv } from '../env'

const DOMAINE = lireEnv('MAIL_DEV_PERSONAL_DOMAIN')
const EMETTEUR = lireEnv('SSO_OIDC_ISSUER')
const MOT_DE_PASSE_SSO = 'SsoDev2026Local'
const CLE_TRANSACTION = 'p2enjoy-crm.sso.transaction'
const ERREUR_422 =
	'console.error: Failed to load resource: the server responded with a status of 422 (Unprocessable Entity)'

async function seConnecterChezKeycloak(page: Page, adresse: string): Promise<void> {
	await page.waitForURL((url) => url.href.startsWith(EMETTEUR))
	await page.locator('#username').fill(adresse)
	await page.locator('#password').fill(MOT_DE_PASSE_SSO)
	await page.locator('#kc-login').click()
}

test('parcours complet : Keycloak réel, session dans l’onglet, retour à l’adresse demandée', async ({ page }) => {
	await page.goto('/tracks/conseil-ia/grands-comptes')
	await page.getByRole('link', { name: 'Se connecter' }).click()
	await expect(page).toHaveURL(/\/connexion$/)

	// L'action se rejoint au clavier, après le formulaire par mot de passe.
	const action = page.getByRole('button', { name: 'Se connecter avec LeLabs' })
	await expect(action).toBeVisible()
	await action.focus()
	await page.keyboard.press('Enter')

	await seConnecterChezKeycloak(page, `admin@${DOMAINE}`)

	await expect(page.getByRole('button', { name: 'Se déconnecter' })).toBeVisible()
	await expect(page).toHaveURL(/\/tracks\/conseil-ia\/grands-comptes$/)
	const stockage = await page.evaluate((cle) => ({
		transaction: sessionStorage.getItem(cle),
		session: Object.keys(sessionStorage).filter((k) => k.includes('auth-token')).length,
		local: localStorage.length,
		url: location.href,
	}), CLE_TRANSACTION)
	expect(stockage.transaction, 'la transaction ne sert qu’une fois').toBeNull()
	expect(stockage.session, 'la session GoTrue vit dans le stockage d’onglet').toBe(1)
	expect(stockage.local, 'aucun localStorage').toBe(0)
	expect(stockage.url).not.toContain('code=')

	// L'historique ne garde pas l'adresse de retour porteuse du code.
	await page.goBack()
	await expect(page).not.toHaveURL(/auth\/retour/)
})

test('un compte LeLabs sans compte CRM est refusé par le serveur, et l’écran le dit', async ({ page }) => {
	await page.goto('/connexion')
	await page.getByRole('button', { name: 'Se connecter avec LeLabs' }).click()
	await seConnecterChezKeycloak(page, `inconnu@${DOMAINE}`)

	await expect(page).toHaveURL(/\/connexion$/)
	await expect(page.getByRole('alert')).toHaveText(
		"Aucun compte du CRM ne correspond à ce compte LeLabs. L'accès exige une invitation à la même adresse, vérifiée auprès de LeLabs.",
	)
	await expect(page.getByRole('button', { name: 'Se déconnecter' })).toHaveCount(0)
	autoriserErreursConsole(page, [ERREUR_422])

	for (const palier of [PALIERS[0], PALIERS[3]]) {
		await page.setViewportSize({ width: palier.largeur, height: palier.hauteur })
		await capturer(page, `connexion-sso-sans-compte-${palier.nom}`, 'CRM-091')
	}
})

test('une annulation chez le fournisseur ramène au formulaire, sans rien échanger', async ({ page }) => {
	// RÉPONSE SUBSTITUÉE, NOMMÉE : la redirection que Keycloak rend quand la personne refuse — avec
	// le `state` de la demande, comme il le fait pour tout refus (décision 568, M2).
	let echange = false
	await page.route(`${EMETTEUR}/protocol/openid-connect/auth?**`, async (route) => {
		const demande = new URL(route.request().url())
		const retour = new URL(demande.searchParams.get('redirect_uri') ?? '')
		retour.searchParams.set('error', 'access_denied')
		retour.searchParams.set('state', demande.searchParams.get('state') ?? '')
		await route.fulfill({ status: 302, headers: { location: retour.toString() } })
	})
	await page.route(`${EMETTEUR}/protocol/openid-connect/token`, async (route) => {
		echange = true
		await route.abort()
	})

	await page.setViewportSize({ width: PALIERS[0].largeur, height: PALIERS[0].hauteur })
	await page.goto('/connexion')
	await page.getByRole('button', { name: 'Se connecter avec LeLabs' }).click()

	await expect(page).toHaveURL(/\/connexion$/)
	await expect(page.getByRole('alert')).toHaveText('La connexion LeLabs a été annulée.')
	expect(echange).toBe(false)
	expect(await page.evaluate((cle) => sessionStorage.getItem(cle), CLE_TRANSACTION)).toBeNull()
	await capturer(page, `connexion-sso-annulee-${PALIERS[0].nom}`, 'CRM-091')
})

test('l’écran de connexion porte l’action SSO aux quatre paliers, sans débordement', async ({ page }) => {
	for (const palier of PALIERS) {
		await page.setViewportSize({ width: palier.largeur, height: palier.hauteur })
		await page.goto('/connexion')
		const action = page.getByRole('button', { name: 'Se connecter avec LeLabs' })
		await expect(action).toBeVisible()
		const cadre = await action.boundingBox()
		expect(cadre?.x ?? -1).toBeGreaterThanOrEqual(0)
		expect((cadre?.x ?? 0) + (cadre?.width ?? 0)).toBeLessThanOrEqual(palier.largeur)
		expect(cadre?.height ?? 0).toBeGreaterThanOrEqual(40)
		expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
		await capturer(page, `connexion-sso-${palier.nom}`, 'CRM-091')
	}
})
