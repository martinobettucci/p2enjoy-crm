// @verifies CRM-009 (docs/BACKLOG.md) — connexion, session d’onglet et déconnexion réelles
// @verifies CRM-041 (docs/BACKLOG.md) — déplacement d’une card par un utilisateur connecté
// @verifies CRM-043 (docs/BACKLOG.md) — publication et refus d’un commentaire dans l’interface
// @verifies docs/SPEC-auth.md §9.1 à §9.5 (parcours, stockage, erreurs et preuves attendues)
// @verifies docs/DESIGN_SYSTEM.md §5.12, §7, §8 ; CLAUDE.md §10, §15 et §16
//
// Ces scénarios sont la jonction que les preuves d’interface précédentes ne pouvaient pas faire :
// le navigateur obtient son jeton par le formulaire réel, puis parle à la vraie API sans aucune
// substitution réseau. Chaque écriture est relue hors interface avec le jeton du même profil ; les
// lignes fabriquées par le harnais sont ensuite retirées avec la clé de service.

import {
	autoriserErreursConsole,
	ERREUR_RESSOURCE_HTTP,
	expect,
	surveillerConsole,
	test,
	type APIRequestContext,
	type Page,
} from './fixtures'
import { randomUUID } from 'node:crypto'
import {
	URL_API,
	MOT_DE_PASSE_SEED,
	enTetesAuthentifies,
	enTetesService,
	jetonDe,
} from '../api/jetons'
import { PALIERS, capturer } from './captures'
import { lireEnv } from '../env'

const ADMIN = 'admin@p2enjoy.test'
const VIEWER = 'viewer@p2enjoy.test'
const WORKSPACE = '5eed0000-0000-4000-8000-000000000001'
const CHANNEL_GRANDS_COMPTES = '5eed0000-0000-4000-8000-000000000032'
const WORKFLOW_GLOBAL = '5eed0000-0000-4000-8000-000000000051'
const ETAPE_PROSPECTION = '5eed0000-0000-4000-8000-000000000061'
const ETAPE_RELANCE = '5eed0000-0000-4000-8000-000000000062'
const CARD_AUDIT = '5eed0000-0000-4000-8000-0000000000c3'
const CARD_MAINTENANCE = '5eed0000-0000-4000-8000-0000000000c5'

const ROUTE_AUDIT = `/tracks/conseil-ia/grands-comptes/cards/${CARD_AUDIT}`
const ROUTE_MAINTENANCE = `/tracks/studio-web/maintenance/cards/${CARD_MAINTENANCE}`
const ROUTE_BOARD_MAINTENANCE = '/tracks/studio-web/maintenance'
const ROUTE_BOARD = '/tracks/conseil-ia/grands-comptes'
const INBUCKET = `http://127.0.0.1:${lireEnv('INBUCKET_WEB_PORT')}`
const SITE_URL = lireEnv('SITE_URL')
const SUJET_INVITATION = 'Invitation à P2Enjoy CRM'

let jetonAdmin: string

test.beforeAll(async () => {
	jetonAdmin = await jetonDe(ADMIN)
})

async function connecter(page: Page, adresse: string): Promise<void> {
	await page.getByLabel('Adresse email').click()
	await page.keyboard.press('ControlOrMeta+A')
	await page.keyboard.type(adresse)
	await page.keyboard.press('Tab')
	await page.keyboard.press('ControlOrMeta+A')
	await page.keyboard.type(MOT_DE_PASSE_SEED)
	await page.keyboard.press('Enter')
	await expect(page.getByRole('button', { name: 'Se déconnecter' })).toBeVisible()
}

function urlRest(table: string, parametres: Readonly<Record<string, string>> = {}): string {
	const url = new URL(`/rest/v1/${table}`, URL_API)
	for (const [cle, valeur] of Object.entries(parametres)) url.searchParams.set(cle, valeur)
	return url.toString()
}

async function retirerCommentaires(
	request: APIRequestContext,
	idCard: string,
	corps: string,
): Promise<void> {
	await request.delete(
		urlRest('card_comments', { card_id: `eq.${idCard}`, body: `eq.${corps}` }),
		{ headers: enTetesService() },
	)
}

test('identifiants génériques, restauration dans l’onglet, aucun localStorage et déconnexion', async ({
	page,
}) => {
	await page.goto('/connexion')

	await page.getByLabel('Adresse email').click()
	await page.keyboard.type('personne-inconnue@p2enjoy.test')
	await page.keyboard.press('Tab')
	await page.keyboard.type('mot-de-passe-volontairement-invalide')
	await page.keyboard.press('Enter')
	await expect(page.getByRole('alert')).toHaveText("L'adresse email ou le mot de passe est incorrect.")
	await expect(page.getByLabel('Adresse email')).toBeFocused()
	autoriserErreursConsole(page, [ERREUR_RESSOURCE_HTTP[400]])

	await connecter(page, ADMIN)
	await expect(page).toHaveURL(/\/$/)
	await expect(page.getByTestId('entree-track')).toHaveCount(3)
	await expect(page.getByText(ADMIN, { exact: true })).toBeVisible()

	const stockageApresConnexion = await page.evaluate(() => ({
		local: globalThis.localStorage.length,
		session: Object.entries(globalThis.sessionStorage),
	}))
	expect(stockageApresConnexion.local, 'aucun jeton durable sur l’appareil').toBe(0)
	expect(
		stockageApresConnexion.session.some(
			([cle, valeur]) => cle.startsWith('sb-') && valeur.includes('access_token'),
		),
		'la session Supabase doit vivre dans sessionStorage',
	).toBe(true)

	await page.reload()
	await expect(page.getByRole('button', { name: 'Se déconnecter' })).toBeVisible()
	await expect(page.getByTestId('entree-track')).toHaveCount(3)

	await page.getByRole('button', { name: 'Se déconnecter' }).click()
	await expect(page).toHaveURL(/\/connexion$/)
	const stockageApresDeconnexion = await page.evaluate(() => ({
		local: globalThis.localStorage.length,
		session: Object.entries(globalThis.sessionStorage),
	}))
	expect(stockageApresDeconnexion.local).toBe(0)
	expect(
		stockageApresDeconnexion.session.some(
			([cle, valeur]) => cle.startsWith('sb-') || valeur.includes('access_token'),
		),
		'la déconnexion retire les jetons de l’onglet',
	).toBe(false)
})

test('fermer l’onglet détruit la session sans laisser de persistance locale', async ({ page }) => {
	await page.goto('/connexion')
	await connecter(page, ADMIN)
	const origine = new URL(page.url()).origin
	const contexte = page.context()

	await page.close()
	const nouvelOnglet = await contexte.newPage()
	const anomalies = surveillerConsole(nouvelOnglet)
	await nouvelOnglet.goto(`${origine}/`)

	await expect(nouvelOnglet.getByRole('link', { name: 'Se connecter' })).toBeVisible()
	const stockage = await nouvelOnglet.evaluate(() => ({
		local: globalThis.localStorage.length,
		session: globalThis.sessionStorage.length,
	}))
	expect(stockage).toEqual({ local: 0, session: 0 })
	expect(anomalies, 'le nouvel onglet anonyme ne laisse aucune anomalie console').toEqual([])
	await nouvelOnglet.close()
})

test('le destinataire lit l’invitation française et active son lien à la souris', async ({
	page,
	request,
}) => {
	const adresse = `crm-009-destinataire-${randomUUID()}@exemple.test`
	const boite = encodeURIComponent(adresse)
	let idCompte = ''

	try {
		await page.setViewportSize({ width: 1280, height: 1000 })
		await request.delete(`${INBUCKET}/api/v1/mailbox/${boite}`)
		const invitation = await request.post(`${URL_API}/auth/v1/invite`, {
			headers: enTetesService(),
			data: { email: adresse },
		})
		expect(invitation.status(), await invitation.text()).toBe(200)
		idCompte = ((await invitation.json()) as { id: string }).id

		await expect
			.poll(async () => {
				const messages = await request.get(`${INBUCKET}/api/v1/mailbox/${boite}`)
				return ((await messages.json()) as unknown[]).length
			}, { message: 'l’invitation doit être reçue dans la vraie boîte SMTP' })
			.toBe(1)

		await page.goto(`${INBUCKET}/m/${boite}`)
		await expect(page.getByText(SUJET_INVITATION, { exact: true })).toBeVisible()
		await page.getByText(SUJET_INVITATION, { exact: true }).click()

		await expect(page.getByText('Vous avez été invité(e) à rejoindre P2Enjoy CRM.')).toBeVisible()
		await expect(page.getByText(/Vous pouvez aussi saisir ce code à six chiffres/)).toBeVisible()
		await expect(page.getByText(/^\d{6}$/)).toBeVisible()
		const action = page.getByRole('link', { name: 'Accepter l’invitation' })
		await expect(action).toBeVisible()
		const fondAction = action.locator('xpath=ancestor::td[1]')
		const texteAction = action.locator('span')
		await expect(fondAction).toHaveCSS('background-color', 'rgb(35, 70, 140)')
		await expect(texteAction).toHaveCSS('color', 'rgb(255, 255, 255)')
		await action.hover()
		await expect(action).toBeInViewport()
		await capturer(page, 'invitation-francaise-destinataire', 'CRM-009')
		await action.click()

		expect(await page.evaluate(() => globalThis.location.origin)).toBe(SITE_URL)
		await expect(page.getByRole('button', { name: 'Se déconnecter' })).toBeVisible()
		await expect(page.getByText(adresse, { exact: true })).toBeVisible()
		const etatNavigateur = await page.evaluate(() => ({
			fragmentVide: globalThis.location.hash === '',
			fragmentAvecJetonAcces: globalThis.location.hash.includes('access_token='),
			fragmentAvecJetonRafraichissement: globalThis.location.hash.includes('refresh_token='),
			local: globalThis.localStorage.length,
			sessionAvecJeton: Object.entries(globalThis.sessionStorage).some(
				([cle, valeur]) => cle.startsWith('sb-') && valeur.includes('access_token'),
			),
		}))
		expect(etatNavigateur).toEqual({
			fragmentVide: true,
			fragmentAvecJetonAcces: false,
			fragmentAvecJetonRafraichissement: false,
			local: 0,
			sessionAvecJeton: true,
		})
	} finally {
		if (idCompte !== '') {
			await request.delete(`${URL_API}/auth/v1/admin/users/${idCompte}`, {
				headers: enTetesService(),
			})
		}
		await request.delete(`${INBUCKET}/api/v1/mailbox/${boite}`)
	}
})

test('le retour à la card publie réellement le commentaire de l’administratrice', async ({
	page,
	request,
}) => {
	const corps = `Preuve utilisateur CRM-009 ${randomUUID()}`
	try {
		await page.goto(ROUTE_AUDIT)
		await expect(page.getByTestId('etat-vide')).toContainText('Card introuvable')
		await page.getByRole('link', { name: 'Se connecter' }).click()
		await connecter(page, ADMIN)

		await expect(page).toHaveURL(new RegExp(`${ROUTE_AUDIT}$`))
		await expect(page.getByText('Audit sécurité applicative', { exact: true }).first()).toBeVisible()
		await page.getByLabel('Votre commentaire').fill(corps)
		await page.getByRole('button', { name: 'Publier' }).click()
		await expect(page.getByText(corps, { exact: true })).toBeVisible()

		const reponse = await request.get(
			urlRest('card_comments', {
				card_id: `eq.${CARD_AUDIT}`,
				body: `eq.${corps}`,
				select: 'id,card_id,body,author_id',
			}),
			{ headers: enTetesAuthentifies(jetonAdmin) },
		)
		expect(reponse.status(), await reponse.text()).toBe(200)
		const lignes = (await reponse.json()) as { card_id: string; body: string; author_id: string }[]
		expect(lignes).toHaveLength(1)
		expect(lignes[0]).toMatchObject({ card_id: CARD_AUDIT, body: corps })
	} finally {
		await retirerCommentaires(request, CARD_AUDIT, corps)
	}
})

test('le viewer voit la card mais son commentaire est refusé sans perdre son texte', async ({
	page,
	request,
}) => {
	const corps = `Refus viewer CRM-009 ${randomUUID()}`
	try {
		await page.goto(ROUTE_MAINTENANCE)
		await page.getByRole('link', { name: 'Se connecter' }).click()
		await connecter(page, VIEWER)

		await expect(page).toHaveURL(new RegExp(`${ROUTE_MAINTENANCE}$`))
		const champ = page.getByLabel('Votre commentaire')
		await expect(champ).toBeVisible()
		await champ.fill(corps)
		await page.getByRole('button', { name: 'Publier' }).click()
		await expect(
			page.getByRole('alert').filter({ hasText: 'Vous ne pouvez pas commenter cette affaire' }),
		).toBeVisible()
		await expect(champ).toHaveValue(corps)
		autoriserErreursConsole(page, [ERREUR_RESSOURCE_HTTP[403]])

		const reponse = await request.get(
			urlRest('card_comments', {
				card_id: `eq.${CARD_MAINTENANCE}`,
				body: `eq.${corps}`,
				select: 'id',
			}),
			{ headers: enTetesService() },
		)
		expect(reponse.status()).toBe(200)
		expect(await reponse.json()).toEqual([])
	} finally {
		// Défensif : si la politique régressait et acceptait l’écriture, le scénario resterait propre.
		await retirerCommentaires(request, CARD_MAINTENANCE, corps)
	}
})

test('le viewer tente un vrai déplacement, voit le refus et la card reste en place', async ({
	page,
	request,
}) => {
	await page.goto('/connexion')
	await connecter(page, VIEWER)
	await page.goto(ROUTE_BOARD_MAINTENANCE)

	const card = page.locator(
		`[data-testid="carte-card"][data-card="${CARD_MAINTENANCE}"]`,
	)
	await expect(card).toBeVisible()
	await card.getByRole('button', { name: /Déplacer Support niveau 2/ }).click()
	await card.getByRole('button', { name: 'Relancer' }).click()

	await expect(
		page.getByRole('alert').filter({ hasText: "Votre compte n'a pas le droit d'écrire" }),
	).toBeVisible()
	autoriserErreursConsole(page, [ERREUR_RESSOURCE_HTTP[403]])
	const colonneProspection = page.locator(
		`[data-testid="colonne"][data-etape="${ETAPE_PROSPECTION}"]`,
	)
	await expect(colonneProspection.locator(`[data-card="${CARD_MAINTENANCE}"]`)).toBeVisible()

	const relecture = await request.get(
		urlRest('cards', { id: `eq.${CARD_MAINTENANCE}`, select: 'id,current_step_id' }),
		{ headers: enTetesService() },
	)
	expect(relecture.status(), await relecture.text()).toBe(200)
	expect(await relecture.json()).toEqual([
		{ id: CARD_MAINTENANCE, current_step_id: ETAPE_PROSPECTION },
	])
})

test('l’administratrice déplace une card d’essai et la base confirme la nouvelle étape', async ({
	page,
	request,
}) => {
	const idCard = randomUUID()
	const titre = `tst-crm011 déplacement ${idCard.slice(0, 8)}`
	const creation = await request.post(urlRest('cards'), {
		headers: { ...enTetesService(), Prefer: 'return=representation' },
		data: {
			id: idCard,
			workspace_id: WORKSPACE,
			channel_id: CHANNEL_GRANDS_COMPTES,
			workflow_id: WORKFLOW_GLOBAL,
			current_step_id: ETAPE_PROSPECTION,
			title: titre,
		},
	})
	expect(creation.status(), await creation.text()).toBe(201)

	try {
		await page.goto('/connexion')
		await connecter(page, ADMIN)
		await page.goto(ROUTE_BOARD)

		const card = page.locator(`[data-testid="carte-card"][data-card="${idCard}"]`)
		await expect(card).toContainText(titre)
		await card.getByRole('button', { name: `Déplacer ${titre}` }).click()
		await card.getByRole('button', { name: 'Relancer' }).click()

		const colonneRelance = page.locator(
			`[data-testid="colonne"][data-etape="${ETAPE_RELANCE}"]`,
		)
		await expect(colonneRelance.locator(`[data-card="${idCard}"]`)).toContainText(titre)

		const relecture = await request.get(
			urlRest('cards', { id: `eq.${idCard}`, select: 'id,current_step_id' }),
			{ headers: enTetesAuthentifies(jetonAdmin) },
		)
		expect(relecture.status(), await relecture.text()).toBe(200)
		expect(await relecture.json()).toEqual([{ id: idCard, current_step_id: ETAPE_RELANCE }])
	} finally {
		await request.delete(urlRest('cards', { id: `eq.${idCard}` }), {
			headers: enTetesService(),
		})
	}
})

test('l’écran de connexion tient les quatre paliers et une session chargée reste lisible', async ({
	page,
}) => {
	for (const palier of PALIERS) {
		await page.setViewportSize({ width: palier.largeur, height: palier.hauteur })
		await page.goto('/connexion')
		await expect(page.getByRole('heading', { name: 'Se connecter' })).toBeVisible()
		await expect(page.getByLabel('Adresse email')).toBeVisible()
		await expect(page.getByLabel('Mot de passe')).toBeVisible()
		expect(
			await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
			`${palier.nom} ne doit pas déborder horizontalement`,
		).toBe(true)
		await capturer(page, `connexion-${palier.nom}`, 'CRM-009')
	}

	await page.setViewportSize({ width: 1440, height: 900 })
	await connecter(page, ADMIN)
	await expect(page.getByTestId('entree-track')).toHaveCount(3)
	await capturer(page, 'session-chargee-1440', 'CRM-009')
})
