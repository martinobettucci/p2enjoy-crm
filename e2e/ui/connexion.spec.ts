// @verifies CRM-092 (docs/BACKLOG.md) — le SSO, seule source d'identité, vécu dans le navigateur
// @verifies docs/SPEC-session-sso.md §4 (parcours), §5.6 (cookie `httpOnly` de la poignée), §8.3 (rien
//           sur l'appareil), §8.4 (restauration, rafraîchissement, fin de session), §8.5 (déconnexion
//           sans révocation), §9.1 (carte, action unique), §9.2 (refus et attentes), §13 (preuves E2E)
// @verifies docs/DESIGN_SYSTEM.md §5.12 (connexion), §7 (paliers), §8 (clavier), §11 (captures)
// @verifies docs/manual.md chapitre 1 (connexion) ; CLAUDE.md §10, §11, §16
// @verifies docs/JOURNAL.md décision 593 (INC-249) — l'attente `attente_administrateur`, vécue avec un
//           compte jetable dans un espace neuf
//
// Le navigateur quitte réellement le CRM pour la page de connexion du Keycloak de développement, y
// saisit les identifiants d'un compte du realm, et revient ; l'échangeur de session, client
// confidentiel, décide. Deux interventions seulement, chacune NOMMÉE (docs/DESIGN_SYSTEM.md §12.5) :
// l'annulation substitue la redirection que Keycloak rend quand la personne refuse — ce realm n'a pas
// d'écran de consentement où refuser — ; la capture du retour RETARDE l'ouverture, sans en changer la
// réponse, le temps de photographier l'état de chargement.

import { autoriserErreursConsole, connecterAvecLeLabs, ERREUR_RESSOURCE_HTTP, expect, test, type Page } from './fixtures'
import { PALIERS, capturer } from './captures'
import { lireEnv } from '../env'
import { COMPTES_SEED, MOT_DE_PASSE_SEED, URL_API, enTetesService } from '../api/jetons'
import {
	creerCompteJetable,
	effacerActionsRequises,
	exigerVerificationAdresse,
	fermerSessionsLeLabs,
	idUtilisateur,
	supprimerCompte,
} from '../api/keycloak-dev'

const UNITE = 'CRM-092'
const DOMAINE = lireEnv('MAIL_DEV_PERSONAL_DOMAIN')
const EMETTEUR = lireEnv('SSO_OIDC_ISSUER')
const COOKIE = 'p2enjoy_crm_session'
const CLE_TRANSACTION = 'p2enjoy-crm.sso.transaction'
const ROUTE_BOARD = '/tracks/conseil-ia/grands-comptes'
const ADMIN = COMPTES_SEED[0].adresse
const NOMS: Readonly<Record<string, string>> = {
	admin: 'Camille Aubert',
	business_developer: 'Driss Lemoine',
	viewer: 'Farida Nowak',
}

async function remplirKeycloak(page: Page, adresse: string): Promise<void> {
	await page.waitForURL((url) => url.href.startsWith(EMETTEUR))
	await page.locator('#username').fill(adresse)
	await page.locator('#password').fill(MOT_DE_PASSE_SEED)
	await page.locator('#kc-login').click()
}

/** Ce que l'appareil porte : aucun jeton lisible par un script, la poignée en cookie `httpOnly`. */
async function etatAppareil(page: Page) {
	const stockage = await page.evaluate((cle) => ({
		local: globalThis.localStorage.length,
		session: Object.entries(globalThis.sessionStorage),
		transaction: globalThis.sessionStorage.getItem(cle),
		cookiesScript: document.cookie,
		url: globalThis.location.href,
	}), CLE_TRANSACTION)
	const poignee = (await page.context().cookies()).find((c) => c.name === COOKIE) ?? null
	return { ...stockage, poignee }
}

test.describe.configure({ mode: 'serial' })

test.describe('Parcours de connexion', () => {
	for (const compte of COMPTES_SEED) {
		test(`${compte.role} : vraie page LeLabs, retour à l’adresse demandée, aucun jeton sur l’appareil`, async ({ page }) => {
			await page.setViewportSize({ width: PALIERS[0].largeur, height: PALIERS[0].hauteur })
			await page.goto(ROUTE_BOARD)
			await page.getByRole('link', { name: 'Se connecter' }).click()
			await expect(page).toHaveURL(/\/connexion$/)

			// L'action unique se rejoint et s'active au clavier.
			const action = page.getByRole('button', { name: 'Se connecter avec LeLabs' })
			await action.focus()
			await page.keyboard.press('Enter')
			await page.waitForURL((url) => url.href.startsWith(EMETTEUR))
			if (compte.role === 'admin') await capturer(page, 'connexion-lelabs-formulaire-xl-1440', UNITE)
			await remplirKeycloak(page, compte.adresse)

			await expect(page.getByRole('button', { name: 'Se déconnecter' })).toBeVisible()
			await expect(page).toHaveURL(new RegExp(`${ROUTE_BOARD}$`))
			await expect(page.getByTestId('identite-session')).toContainText(NOMS[compte.role] ?? '')

			const appareil = await etatAppareil(page)
			expect(appareil.local, 'aucun localStorage').toBe(0)
			expect(appareil.transaction, 'la transaction ne sert qu’une fois').toBeNull()
			expect(JSON.stringify(appareil.session), 'aucun jeton dans le stockage d’onglet').not.toMatch(/eyJ|access_token|refresh_token/)
			expect(appareil.url).not.toContain('code=')
			expect(appareil.cookiesScript, 'aucun script ne lit la poignée').not.toContain(COOKIE)
			expect(appareil.poignee).toMatchObject({ httpOnly: true, sameSite: 'Strict', path: '/functions/v1/session', expires: -1 })

			// L'historique ne garde pas l'adresse de retour porteuse du code.
			await page.goBack()
			await expect(page).not.toHaveURL(/auth\/retour/)
		})
	}

	test('le rechargement et un nouvel onglet retrouvent la session du navigateur, sans formulaire', async ({ page }) => {
		await connecterAvecLeLabs(page, ADMIN)
		await page.goto(ROUTE_BOARD)
		await page.reload()
		await expect(page.getByRole('button', { name: 'Se déconnecter' })).toBeVisible()
		await expect(page.getByTestId('identite-session')).toContainText('Camille Aubert')

		// La session vit dans le navigateur, partagée par ses onglets (décision 586, §5.6).
		const onglet = await page.context().newPage()
		await onglet.goto(ROUTE_BOARD)
		await expect(onglet.getByRole('button', { name: 'Se déconnecter' })).toBeVisible()
		await onglet.close()
	})

	test('le rafraîchissement, franchi par l’horloge, prolonge la session sans perte', async ({ page }) => {
		await page.clock.install()
		await connecterAvecLeLabs(page, ADMIN)
		await page.goto(ROUTE_BOARD)
		await expect(page.getByRole('button', { name: 'Se déconnecter' })).toBeVisible()

		const prolongations: number[] = []
		page.on('response', (reponse) => {
			if (reponse.url().endsWith('/functions/v1/session/prolonger')) prolongations.push(reponse.status())
		})
		// Le jeton interne vit 300 s ; la prolongation part 60 s avant son échéance.
		await page.clock.fastForward('04:10')
		await expect.poll(() => prolongations, { timeout: 15_000 }).toEqual([200])
		await expect(page.getByRole('button', { name: 'Se déconnecter' })).toBeVisible()

		// Le nouveau jeton sert aussitôt, SANS rechargement : une navigation interne lit sous RLS.
		await page.getByRole('navigation', { name: 'Navigation principale' }).getByRole('link', { name: 'Board' }).first().click()
		await expect(page).toHaveURL(/\/$/)
		await expect(page.getByTestId('entree-track')).toHaveCount(3)
		await page.clock.fastForward('00:30')
		expect(prolongations, 'une seule prolongation par échéance, jamais en boucle').toEqual([200])
	})

	test('la déconnexion ramène à /connexion et retire la poignée ; LeLabs, lui, reste ouvert', async ({ page }) => {
		await connecterAvecLeLabs(page, ADMIN)
		await page.getByRole('button', { name: 'Se déconnecter' }).click()
		await expect(page).toHaveURL(/\/connexion$/)
		expect((await etatAppareil(page)).poignee, 'la poignée est effacée').toBeNull()
		await page.reload()
		await expect(page.getByRole('button', { name: 'Se connecter avec LeLabs' })).toBeVisible()

		// Rien n'est révoqué chez LeLabs (§8.5) : se reconnecter ne redemande pas le mot de passe.
		let formulaire = false
		page.on('response', (reponse) => {
			if (reponse.url().startsWith(`${EMETTEUR}/protocol/openid-connect/auth`) && reponse.status() === 200) formulaire = true
		})
		await page.getByRole('button', { name: 'Se connecter avec LeLabs' }).click()
		await expect(page.getByRole('button', { name: 'Se déconnecter' })).toBeVisible()
		expect(formulaire, 'aucun formulaire LeLabs tant que la session LeLabs vit').toBe(false)
	})

	test('une session close chez LeLabs prend fin dans le CRM, et l’écran le dit', async ({ page }) => {
		await page.clock.install()
		await connecterAvecLeLabs(page, ADMIN)
		await page.goto(ROUTE_BOARD)
		await expect(page.getByRole('button', { name: 'Se déconnecter' })).toBeVisible()

		await fermerSessionsLeLabs(await idUtilisateur(ADMIN))
		await page.clock.fastForward('04:10')

		await expect(page).toHaveURL(/\/connexion$/)
		await expect(page.getByRole('alert')).toHaveText('Votre session a pris fin. Reconnectez-vous avec LeLabs.')
		autoriserErreursConsole(page, [ERREUR_RESSOURCE_HTTP[401]])
		expect((await etatAppareil(page)).poignee).toBeNull()
		await page.setViewportSize({ width: PALIERS[3].largeur, height: PALIERS[3].hauteur })
		await capturer(page, `connexion-session-expiree-${PALIERS[3].nom}`, UNITE)

		// Se reconnecter rejoint l'adresse quittée.
		await connecterAvecLeLabs(page, ADMIN, { naviguer: false })
		await expect(page).toHaveURL(new RegExp(`${ROUTE_BOARD}$`))
	})
})

test.describe('Attentes et refus', () => {
	async function tenter(page: Page, adresse: string): Promise<void> {
		await page.context().clearCookies()
		await page.goto('/connexion')
		await page.getByRole('button', { name: 'Se connecter avec LeLabs' }).click()
		await remplirKeycloak(page, adresse)
		await expect(page).toHaveURL(/\/connexion$/)
	}

	const ATTENTES = [
		{
			local: 'inconnu',
			texte: `Aucun espace du CRM ne vous attend à l'adresse inconnu@${DOMAINE}. Demandez à un administrateur de votre espace de vous inscrire avec cette adresse, puis reconnectez-vous.`,
			paliers: PALIERS,
		},
		{
			local: 'attendu',
			texte: `Votre compte LeLabs attendu@${DOMAINE} n'est pas encore vérifié. Un administrateur de LeLabs doit confirmer votre identité avant que le CRM vous ouvre ses espaces ; ce geste est humain et peut prendre du temps.`,
			paliers: [PALIERS[0], PALIERS[3]],
		},
	] as const

	for (const attente of ATTENTES) {
		test(`${attente.local}@ voit son attente, sur la surface d’attente, et rien n’est ouvert`, async ({ page }) => {
			await tenter(page, `${attente.local}@${DOMAINE}`)
			const etat = page.getByRole('status').filter({ hasText: 'Accès en attente' })
			await expect(etat).toHaveText(`Accès en attente${attente.texte}`)
			await expect(page.getByRole('alert')).toHaveCount(0)
			await expect(page.getByRole('button', { name: 'Se déconnecter' })).toHaveCount(0)
			await expect(page.getByRole('button', { name: 'Se connecter avec LeLabs' })).toHaveAttribute(
				'aria-describedby',
				(await etat.getAttribute('id')) ?? '',
			)
			expect((await etatAppareil(page)).poignee).toBeNull()
			autoriserErreursConsole(page, [ERREUR_RESSOURCE_HTTP[403]])
			for (const palier of attente.paliers) {
				await page.setViewportSize({ width: palier.largeur, height: palier.hauteur })
				expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
				await capturer(page, `connexion-attente-${attente.local}-${palier.nom}`, UNITE)
			}
		})
	}

	test('une adresse non prouvée voit son attente', async ({ page }) => {
		const adresse = `adresse-non-verifiee@${DOMAINE}`
		const sub = await idUtilisateur(adresse)
		await effacerActionsRequises(sub)
		await exigerVerificationAdresse(false)
		try {
			await tenter(page, adresse)
			await expect(page.getByRole('status').filter({ hasText: 'Accès en attente' })).toHaveText(
				`Accès en attenteVotre adresse ${adresse} n'est pas encore vérifiée auprès de LeLabs. Vérifiez-la depuis votre compte LeLabs, puis reconnectez-vous.`,
			)
			autoriserErreursConsole(page, [ERREUR_RESSOURCE_HTTP[403]])
			await page.setViewportSize({ width: PALIERS[3].largeur, height: PALIERS[3].hauteur })
			await capturer(page, `connexion-attente-adresse-non-verifiee-${PALIERS[3].nom}`, UNITE)
		} finally {
			await exigerVerificationAdresse(true)
			await effacerActionsRequises(sub)
		}
	})

	// INC-249, décision 593 : l'espace attend la personne mais n'a pas encore d'administrateur. Le seed
	// n'a qu'un espace, qui a le sien : l'état se construit ici, sur des données jetables, retirées.
	test('une personne attendue dans un espace sans administrateur voit son attente (INC-249)', async ({ page }) => {
		const compte = await creerCompteJetable('preuve-inc249-ui', 'Léa', 'Patiente')
		const slug = `preuve-inc249-ui-${Math.random().toString(36).slice(2, 10)}`
		let espace = ''
		try {
			const creation = await fetch(`${URL_API}/rest/v1/workspaces`, {
				method: 'POST',
				headers: { ...enTetesService(), 'content-type': 'application/json', prefer: 'return=representation' },
				body: JSON.stringify({ name: 'Espace neuf INC-249', slug }),
			})
			expect(creation.status).toBe(201)
			espace = ((await creation.json()) as { id: string }[])[0]?.id ?? ''
			const attente = await fetch(`${URL_API}/rest/v1/workspace_invitations`, {
				method: 'POST',
				headers: { ...enTetesService(), 'content-type': 'application/json' },
				body: JSON.stringify({ workspace_id: espace, email: compte.adresse, role: 'viewer' }),
			})
			expect(attente.status).toBe(201)

			await tenter(page, compte.adresse)
			const etat = page.getByRole('status').filter({ hasText: 'Accès en attente' })
			await expect(etat).toHaveText(
				`Accès en attenteUn espace du CRM vous attend à l'adresse ${compte.adresse}, mais son administrateur ne s'y est pas encore connecté. Votre accès s'ouvrira dès qu'il l'aura fait : reconnectez-vous alors.`,
			)
			await expect(page.getByRole('alert')).toHaveCount(0)
			expect((await etatAppareil(page)).poignee).toBeNull()
			autoriserErreursConsole(page, [ERREUR_RESSOURCE_HTTP[403]])
			for (const palier of [PALIERS[0], PALIERS[3]]) {
				await page.setViewportSize({ width: palier.largeur, height: palier.hauteur })
				expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
				await capturer(page, `connexion-attente-administrateur-${palier.nom}`, UNITE)
			}
		} finally {
			if (espace !== '') {
				await fetch(`${URL_API}/rest/v1/workspaces?id=eq.${espace}`, { method: 'DELETE', headers: enTetesService() })
			}
			await fetch(`${URL_API}/rest/v1/workspace_invitations?email=eq.${compte.adresse}`, { method: 'DELETE', headers: enTetesService() })
			await supprimerCompte(compte.sub)
		}
	})

	test('une annulation chez LeLabs ramène à l’écran, sans rien remettre à l’échangeur', async ({ page }) => {
		// RÉPONSE SUBSTITUÉE, NOMMÉE : la redirection que Keycloak rend quand la personne refuse, avec le
		// `state` de la demande (décision 568, M2).
		let ouverture = false
		await page.route(`${EMETTEUR}/protocol/openid-connect/auth?**`, async (route) => {
			const demande = new URL(route.request().url())
			const retour = new URL(demande.searchParams.get('redirect_uri') ?? '')
			retour.searchParams.set('error', 'access_denied')
			retour.searchParams.set('state', demande.searchParams.get('state') ?? '')
			await route.fulfill({ status: 302, headers: { location: retour.toString() } })
		})
		page.on('request', (requete) => {
			if (requete.url().includes('/functions/v1/session/ouvrir')) ouverture = true
		})

		await page.setViewportSize({ width: PALIERS[0].largeur, height: PALIERS[0].hauteur })
		await page.goto('/connexion')
		await page.getByRole('button', { name: 'Se connecter avec LeLabs' }).click()

		await expect(page).toHaveURL(/\/connexion$/)
		await expect(page.getByRole('alert')).toHaveText('La connexion LeLabs a été annulée.')
		expect(ouverture).toBe(false)
		expect((await etatAppareil(page)).transaction).toBeNull()
		await capturer(page, `connexion-annulee-${PALIERS[0].nom}`, UNITE)
	})
})

test.describe('L’écran', () => {
	test('la carte porte une seule action aux quatre paliers, sans débordement', async ({ page }) => {
		for (const palier of PALIERS) {
			await page.setViewportSize({ width: palier.largeur, height: palier.hauteur })
			await page.goto('/connexion')
			const action = page.getByRole('button', { name: 'Se connecter avec LeLabs' })
			await expect(action).toBeVisible()
			await expect(page.getByRole('button')).toHaveCount(1)
			await expect(page.getByRole('textbox')).toHaveCount(0)
			const cadre = await action.boundingBox()
			expect(cadre?.x ?? -1).toBeGreaterThanOrEqual(0)
			expect((cadre?.x ?? 0) + (cadre?.width ?? 0)).toBeLessThanOrEqual(palier.largeur)
			expect(cadre?.height ?? 0).toBeGreaterThanOrEqual(40)
			expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
			await capturer(page, `connexion-${palier.nom}`, UNITE)
		}
	})

	test('le retour annonce l’échange en cours, puis rejoint l’application', async ({ page }) => {
		// RÉPONSE RETARDÉE, NON SUBSTITUÉE : l'ouverture part vers le vrai échangeur une seconde plus tard,
		// le temps de photographier l'état de chargement.
		await page.route('**/functions/v1/session/ouvrir', async (route) => {
			await new Promise((resolve) => setTimeout(resolve, 1_000))
			await route.continue()
		})
		await page.setViewportSize({ width: PALIERS[3].largeur, height: PALIERS[3].hauteur })
		await page.context().clearCookies()
		await page.goto('/connexion')
		await page.getByRole('button', { name: 'Se connecter avec LeLabs' }).click()
		await remplirKeycloak(page, ADMIN)
		await expect(page.getByLabel('Connexion LeLabs en cours')).toBeVisible()
		await capturer(page, `connexion-retour-${PALIERS[3].nom}`, UNITE)
		await expect(page.getByRole('button', { name: 'Se déconnecter' })).toBeVisible()
	})
})
