// @spec CRM-117 (docs/BACKLOG.md) — tranche T4.1 : les images du chapitre 1, « Se connecter et se déconnecter »
// @spec docs/SPEC-manual.md §11.1 (strict minimum, pleine page en tête de chapitre), §11.2 (générées sur la pile et le seed)
// @spec docs/manual.md chapitre 1 ; docs/SPEC-session-sso.md §4 (le parcours), §8.3 (les attentes)
//
// Deux états sont transitoires — « Redirection vers LeLabs… » à l'aller, « Connexion LeLabs en cours » au retour. Le
// scénario RETIENT la vraie requête le temps de l'image, puis la libère : la réponse n'est jamais substituée.

import { expect, test } from '@playwright/test'
import { illustrer } from './illustrer'
import { ADMIN, EMETTEUR_SSO, connecterAvecLeLabs, retenir, tenterConnexion } from './outils'
import { MOT_DE_PASSE_SEED } from '../api/jetons'

const CHAPITRE = 'se-connecter-et-se-deconnecter'

test('l’écran de connexion, l’aller vers LeLabs et le retour', async ({ page }) => {
	await page.context().clearCookies()
	await page.goto('/connexion')
	const bouton = page.getByRole('button', { name: 'Se connecter avec LeLabs' })
	await expect(bouton).toBeVisible()
	await illustrer(page, { chapitre: CHAPITRE, section: null, nom: 'ecran-de-connexion', cibles: [], pleinePage: true })

	const aller = retenir()
	// La découverte de LeLabs est lue avant de quitter la page : le bouton dit « Redirection vers LeLabs… » tout ce temps.
	await page.route((url) => url.pathname.endsWith('/.well-known/openid-configuration'), async (route) => {
		await aller.attendre
		await route.continue()
	})
	// Un clic par le DOM : Playwright attendrait sinon la navigation que la route retient.
	await bouton.evaluate((noeud) => (noeud as HTMLButtonElement).click())
	await illustrer(page, {
		chapitre: CHAPITRE,
		section: null,
		nom: 'redirection-vers-lelabs',
		cibles: [page.getByRole('button', { name: 'Redirection vers LeLabs…' })],
	})
	aller.liberer()

	const retour = retenir()
	await page.route('**/functions/v1/session/ouvrir', async (route) => {
		await retour.attendre
		await route.continue()
	})
	await page.waitForURL((url) => url.href.startsWith(EMETTEUR_SSO))
	await page.locator('#username').fill(ADMIN)
	await page.locator('#password').fill(MOT_DE_PASSE_SEED)
	await page.locator('#kc-login').click()
	await illustrer(page, {
		chapitre: CHAPITRE,
		section: null,
		nom: 'connexion-en-cours',
		cibles: [page.getByLabel('Connexion LeLabs en cours')],
	})
	retour.liberer()
	await expect(page.getByRole('button', { name: 'Se déconnecter' })).toBeVisible()
})

test('une attente : le compte LeLabs n’est pas encore vérifié', async ({ page }) => {
	await tenterConnexion(page, 'attendu@p2enjoy.test')
	await expect(page).toHaveURL(/\/connexion$/)
	const attente = page.getByRole('status').filter({ hasText: 'Accès en attente' })
	await illustrer(page, {
		chapitre: CHAPITRE,
		section: 'les-messages-de-l-ecran-de-connexion',
		nom: 'acces-en-attente',
		cibles: [attente, page.getByRole('button', { name: 'Se connecter avec LeLabs' })],
	})
})

test('l’en-tête : votre nom et « Se déconnecter »', async ({ page }) => {
	await connecterAvecLeLabs(page, ADMIN)
	await page.goto('/')
	const deconnexion = page.getByRole('button', { name: 'Se déconnecter' })
	await illustrer(page, {
		chapitre: CHAPITRE,
		section: 'se-deconnecter',
		nom: 'se-deconnecter',
		cibles: [page.getByText('Camille Aubert', { exact: true }).first(), deconnexion],
	})
})
