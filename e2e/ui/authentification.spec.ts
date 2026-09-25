// @verifies CRM-009 (docs/BACKLOG.md) — retour à l'adresse demandée après connexion, session chargée
// @verifies CRM-041 (docs/BACKLOG.md) — déplacement d’une card par un utilisateur connecté
// @verifies CRM-043 (docs/BACKLOG.md) — publication et refus d’un commentaire dans l’interface
// @verifies docs/SPEC-auth.md §9.1 (parcours et retour), §9.5 (preuves attendues)
// @verifies docs/SPEC-test-harness.md §7.2 — attendre le signal utilisateur avant la relecture
// @verifies docs/DESIGN_SYSTEM.md §5.12, §7, §8 ; CLAUDE.md §10, §15 et §16
// @verifies CRM-092 (docs/BACKLOG.md), docs/SPEC-session-sso.md §13 — connexion par la vraie page du
//           SSO, fixture connecterAvecLeLabs (CRM-092 T5) : plus aucun mot de passe du CRM
// @verifies CRM-092 (docs/BACKLOG.md) tranche T9 — docs/SPEC-session-sso.md §8.7 : sans session, aucune page
//           de l'application ; l'adresse demandée mène à /connexion (docs/JOURNAL.md décision 601)
//
// Ces scénarios sont la jonction que les preuves d’interface précédentes ne pouvaient pas faire :
// le navigateur obtient sa session par la vraie connexion, puis parle à la vraie API sans aucune
// substitution réseau. Chaque écriture est relue hors interface avec le jeton du même profil ; les
// lignes fabriquées par le harnais sont ensuite retirées avec la clé de service.
//
// RETIRÉS PAR `CRM-092` T5, avec leur objet (docs/JOURNAL.md, décision 587) : le formulaire à mot de
// passe et son refus générique, la session d'onglet de GoTrue, et l'invitation par courriel de GoTrue
// acceptée dans la webapp. La connexion, la restauration, le stockage et la déconnexion sont prouvés
// par `e2e/ui/connexion.spec.ts` ; l'inscription d'une attente, par `e2e/api/session.spec.ts`.

import {
	autoriserErreursConsole,
	connecterAvecLeLabs,
	ERREUR_RESSOURCE_HTTP,
	expect,
	test,
	type APIRequestContext,
	type Page,
} from './fixtures'
import { randomUUID } from 'node:crypto'
import { URL_API, enTetesAuthentifies, enTetesService, jetonDe } from '../api/jetons'
import { PALIERS, capturer } from './captures'

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

let jetonAdmin: string

test.beforeAll(async () => {
	jetonAdmin = await jetonDe(ADMIN)
})

/** La page est déjà sur `/connexion`, où l'adresse de retour a été retenue. */
async function connecter(page: Page, adresse: string): Promise<void> {
	await connecterAvecLeLabs(page, adresse, { naviguer: false })
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

test('le retour à la card publie réellement le commentaire de l’administratrice', async ({
	page,
	request,
}) => {
	const corps = `Preuve utilisateur CRM-009 ${randomUUID()}`
	try {
		// RÉVISÉ PAR `CRM-092` T9 : sans session, l'adresse de la card mène d'elle-même à
		// `/connexion`, qui la retient ; plus de « Card introuvable » ni de lien à cliquer.
		await page.goto(ROUTE_AUDIT)
		await expect(page).toHaveURL(/\/connexion$/)
		await connecter(page, ADMIN)

		await expect(page).toHaveURL(new RegExp(`${ROUTE_AUDIT}$`))
		await expect(page.getByText('Audit sécurité applicative', { exact: true }).first()).toBeVisible()
		const champ = page.getByLabel('Votre commentaire')
		await champ.fill(corps)
		await page.getByRole('button', { name: 'Publier' }).click()
		await expect(champ).toHaveValue('')
		await expect(
			page.getByRole('status', { name: 'Annonces de la discussion' }),
		).toHaveText('Commentaire publié')
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
		// RÉVISÉ PAR `CRM-092` T9 : l'adresse mène d'elle-même à `/connexion`, qui la retient.
		await page.goto(ROUTE_MAINTENANCE)
		await expect(page).toHaveURL(/\/connexion$/)
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
	// LE MENU DE LA CARTE S'APPELLE « ACTIONS » DEPUIS `CRM-081` TRANCHE 2 d : il ne porte plus les
	// seuls déplacements, mais aussi le geste de sommeil (docs/SPEC-cards.md §16.13.1). Son nom
	// accessible suit son contenu ; le déplacement, lui, est inchangé et se joue dans la section
	// « Déplacer vers » que ce bouton dévoile.
	await card.getByRole('button', { name: /Actions Support niveau 2/ }).click()
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
		await card.getByRole('button', { name: `Actions ${titre}` }).click()
		await card.getByRole('button', { name: 'Relancer' }).click()

		const colonneRelance = page.locator(
			`[data-testid="colonne"][data-etape="${ETAPE_RELANCE}"]`,
		)
		await expect(colonneRelance.locator(`[data-card="${idCard}"]`)).toContainText(titre)
		// La colonne bouge d'abord de façon optimiste. La région live, elle, n'annonce le succès
		// qu'après la réponse réelle de `move_card` : c'est ce signal utilisateur non ambigu qu'il
		// faut attendre avant de relire la base (docs/SPEC-test-harness.md §7.2).
		await expect(page.getByRole('status', { name: 'Annonces du board' })).toHaveText(
			'Affaire déplacée vers Relance',
		)

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
		await expect(page.getByRole('button', { name: 'Se connecter avec LeLabs' })).toBeVisible()
		await expect(page.getByRole('textbox')).toHaveCount(0)
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
