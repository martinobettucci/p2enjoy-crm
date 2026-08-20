// @verifies CRM-081 (docs/BACKLOG.md) — sommeil des fils et des cards, tranche 2 f : LE GROUPEMENT
// @verifies docs/SPEC-cards.md §16.16.3 (la liste énumère des fils, et le compte est celui de la
//           page), §16.16.4 (ouvrir un fil ouvre son message le plus récent, le sélecteur, le
//           repère de sélection qui ne s'efface pas), §16.16.5 (le filtre masque le fil ENTIER),
//           §16.16.8 (le fil du seed)
// @verifies docs/DESIGN_SYSTEM.md §5.4 bis (de quoi le fil a l'air), §7 (paliers), §10
//           (accessibilité) ; CLAUDE.md §16 (vérification visuelle)
//
// LE PARCOURS EST FAIT À LA SOURIS ET AU CLAVIER, comme un utilisateur réel : aucune fonction
// interne n'est appelée, aucune réponse n'est substituée. Le fil éprouvé est celui que le seed a
// fait ARRIVER par SMTP puis relever (§16.16.8) — deux messages réunis par leur chaîne
// `References`, non deux lignes forgées en base.
//
// CE QUE CETTE SUITE ÉPROUVE ET QUE LES PREUVES UNITAIRES NE PEUVENT PAS : que la liste rendue à
// l'écran compte UNE ligne là où la base porte DEUX messages, et que le sélecteur ouvre le second
// sans que la ligne perde son repère de sélection.

import { ERREUR_RESSOURCE_HTTP, autoriserErreursConsole, expect, test, type Page } from './fixtures'
import { MOT_DE_PASSE_SEED, URL_API, enTetesService } from '../api/jetons'
import { PALIERS, capturer } from './captures'

const UNITE = 'CRM-081'
const ADMIN = 'admin@p2enjoy.test'
const WORKSPACE = '5eed0000-0000-4000-8000-000000000001'

/** Le dossier du fil : l'affaire dans laquelle la relève a rangé ses deux messages (§16.16.8). */
const CARD_COURRIER = 'Refonte du site vitrine'
const OBJET_RACINE = 'Demande de devis — refonte'
const OBJET_REPONSE = 'Re: Demande de devis — refonte'
/**
 * Le message NON CLASSÉ dont le fil ne porte qu'un seul message.
 *
 * Le dossier « Non classés » en compte DEUX depuis `CRM-060` sous-tranche 2 bis
 * (`docs/SPEC-seed.md` §2.19) : celui-ci, et celui que la règle 3 suggère. Cette preuve vise le
 * FIL, non le dossier, et le nomme donc explicitement.
 */
const OBJET_NON_CLASSE = 'Candidature spontanée'
/** La clé du fil : la racine `References` des deux messages (§16.14.2). */
const FIL_CLASSE = '<seed-inbox-classe@p2enjoy.test>'

async function connecter(page: Page): Promise<void> {
	await page.goto('/connexion')
	await page.getByLabel('Adresse email').click()
	await page.keyboard.type(ADMIN)
	await page.keyboard.press('Tab')
	await page.keyboard.type(MOT_DE_PASSE_SEED)
	await page.keyboard.press('Enter')
	await expect(page.getByRole('button', { name: 'Se déconnecter' })).toBeVisible()
}

/** Ouvre le dossier de la card qui porte le fil de deux messages. */
async function ouvrirDossierDuFil(page: Page): Promise<void> {
	await page.goto('/inbox')
	const dossiers = page.getByTestId('inbox-panneau-dossiers')
	await dossiers.getByRole('button', { name: new RegExp(CARD_COURRIER) }).click()
	await expect(page.getByTestId('inbox-panneau-liste').getByTestId('inbox-message')).toHaveCount(1)
}

/** Le nettoyage : la clé de service retire toute mise en sommeil restée derrière un scénario. */
async function reveillerTout(): Promise<void> {
	const { request } = await import('@playwright/test')
	const contexte = await request.newContext({ baseURL: URL_API })
	try {
		await contexte.delete(`/rest/v1/mail_thread_snoozes?workspace_id=eq.${WORKSPACE}`, {
			headers: enTetesService(),
		})
	} finally {
		await contexte.dispose()
	}
}

test.describe('CRM-081 tranche 2 f — le groupement des messages en fils', () => {
	test.afterEach(async () => {
		await reveillerTout()
	})

	test('DEUX messages du seed rendent UNE ligne, qui porte son compte', async ({ page }) => {
		await connecter(page)
		await ouvrirDossierDuFil(page)

		const liste = page.getByTestId('inbox-panneau-liste')
		// LE COMPTEUR DU DOSSIER COMPTE DES MESSAGES, ET IL NE CHANGE PAS (§16.16.6) : le dossier
		// annonce 2, la liste montre 1 ligne, et la ligne porte 2. C'est exactement l'arithmétique
		// que le chapitre rend lisible plutôt que de la masquer par une migration.
		await expect(
			page.getByTestId('inbox-panneau-dossiers').getByRole('button', { name: new RegExp(CARD_COURRIER) }),
		).toContainText('2')
		await expect(liste.getByTestId('inbox-message')).toHaveCount(1)

		// LA LIGNE PORTE L'OBJET DU DERNIER MESSAGE, jamais celui de la racine (§16.16.3) : la page
		// arrive triée par récence, donc la première occurrence de la clé est la réponse.
		await expect(liste.getByTestId('inbox-message')).toContainText(OBJET_REPONSE)

		// LE BADGE DIT « 2 », ET SON NOM ACCESSIBLE EST UNE PHRASE ENTIÈRE (§5.4 bis) : un chiffre
		// nu ne dit pas ce qu'il compte.
		const compte = liste.getByTestId('inbox-fil-compte')
		await expect(compte).toHaveText('2')
		await expect(compte).toHaveAccessibleName('2 messages dans ce fil')
		await capturer(page, 'groupement-fil-liste', UNITE)
	})

	test('ouvrir le fil ouvre son message le plus RÉCENT, et le sélecteur donne accès à l’autre', async ({
		page,
	}) => {
		await connecter(page)
		await ouvrirDossierDuFil(page)

		const liste = page.getByTestId('inbox-panneau-liste')
		await liste.getByTestId('inbox-message').click()

		// OUVRIR UN FIL OUVRE SON DERNIER MESSAGE (§16.16.4) : celui dont la ligne vient d'afficher
		// l'objet. Ouvrir la racine ferait mentir la ligne qu'on a cliquée.
		const ouvert = page.getByTestId('inbox-message-ouvert')
		await expect(ouvert.getByRole('heading', { level: 3 })).toHaveText(OBJET_REPONSE)

		// LE SÉLECTEUR EXISTE, ET IL PORTE LES DEUX MESSAGES DANS L'ORDRE DE LA LISTE.
		const selecteur = page.getByTestId('inbox-fil-selecteur')
		await expect(selecteur).toBeVisible()
		await expect(selecteur.getByTestId('inbox-fil-message')).toHaveCount(2)
		await capturer(page, 'groupement-fil-selecteur', UNITE)

		// LE MESSAGE AFFICHÉ S'ANNONCE : `aria-current`, et pas une simple teinte (§10).
		await expect(selecteur.getByTestId('inbox-fil-message').first()).toHaveAttribute('aria-current', 'true')

		// CHOISIR LE SECOND MESSAGE AU CLAVIER — le parcours réel, pas seulement la souris.
		await selecteur.getByTestId('inbox-fil-message').nth(1).focus()
		await page.keyboard.press('Enter')
		await expect(ouvert.getByRole('heading', { level: 3 })).toHaveText(OBJET_RACINE)

		// ET LA LIGNE GARDE SON REPÈRE DE SÉLECTION (§16.16.4) : le message ouvert appartient
		// toujours au fil, même s'il n'en est plus le dernier. Sans cette règle, naviguer À
		// L'INTÉRIEUR de ce qu'on a choisi effacerait le repère de ce choix.
		await expect(liste.getByTestId('inbox-message')).toHaveAttribute('aria-current', 'true')
		// LA LISTE NE BOUGE PAS : elle énumère toujours UN fil, et sa ligne montre toujours le
		// dernier message — le sélecteur choisit ce que le panneau montre, pas ce que la liste dit.
		await expect(liste.getByTestId('inbox-message')).toContainText(OBJET_REPONSE)
		await capturer(page, 'groupement-fil-second-message', UNITE)
	})

	test('un fil d’UN SEUL message ne porte NI badge NI sélecteur — l’écran d’avant, inchangé', async ({
		page,
	}) => {
		await connecter(page)
		await page.goto('/inbox')
		await page.getByTestId('inbox-panneau-dossiers').getByRole('button', { name: /Non classés/ }).click()

		const liste = page.getByTestId('inbox-panneau-liste')
		// LA PREUVE PORTE SUR UNE LIGNE, ET NON SUR LE NOMBRE DE LIGNES DU DOSSIER — révisée le
		// 2026-08-20. Elle écrivait `toHaveCount(1)` sur toutes les lignes de « Non classés »,
		// parce que le seed n'y faisait arriver qu'un message ; il en fait arriver deux depuis
		// `CRM-060` sous-tranche 2 bis (`docs/SPEC-seed.md` §2.19), chacun formant un fil d'un
		// seul message. Ce que la preuve vise — « un fil d'UN SEUL message ne porte NI badge NI
		// sélecteur » — est inchangé, et se vise désormais par la LIGNE, ce qu'elle aurait dû
		// faire dès l'origine : le compte du dossier n'a jamais été son sujet.
		const ligne = liste.getByTestId('inbox-message').filter({ hasText: OBJET_NON_CLASSE })
		await expect(ligne).toHaveCount(1)
		// C'EST LA PROPRIÉTÉ QUI REND CETTE TRANCHE SÛRE (§16.16.4) : là où les fils sont d'un
		// message — tout le courrier reçu avant le correctif du §16.16.2 —, rien ne change.
		await expect(ligne.getByTestId('inbox-fil-compte')).toHaveCount(0)

		await ligne.click()
		await expect(page.getByTestId('inbox-message-ouvert')).toBeVisible()
		await expect(page.getByTestId('inbox-fil-selecteur')).toHaveCount(0)
		await capturer(page, 'groupement-fil-unique', UNITE)
	})

	test('le sommeil masque le fil ENTIER, ses deux messages compris', async ({ page }) => {
		await connecter(page)
		await ouvrirDossierDuFil(page)

		const liste = page.getByTestId('inbox-panneau-liste')
		await liste.getByTestId('inbox-message').click()

		// LE GESTE RÉEL DE L'ÉCRAN, donc `snooze_thread` avec le jeton de l'administratrice.
		await page.getByTestId('fil-endormir').click()
		await expect(page.getByTestId('fil-panneau')).toBeVisible()
		await page.getByTestId('fil-preset-semaine').click()

		// LA PASTILLE PARAÎT UNE FOIS, sur la ligne du fil (§5.4 bis) — non une fois par message.
		await expect(liste.getByTestId('pastille-sommeil')).toHaveCount(1)
		await capturer(page, 'groupement-fil-endormi', UNITE)

		// AU GESTE SUIVANT, LE FIL ENTIER QUITTE LA LISTE : ses DEUX messages, non seulement celui
		// que la ligne montrait (§16.16.5). Le dossier est alors vide POUR CETTE RAISON, et l'état
		// vide le dit.
		await page.goto('/inbox')
		await page.getByTestId('inbox-panneau-dossiers').getByRole('button', { name: new RegExp(CARD_COURRIER) }).click()
		await expect(liste.getByTestId('inbox-message')).toHaveCount(0)
		await expect(
			liste.getByText('Tous les messages de ce dossier sont dans des fils en sommeil'),
		).toBeVisible()
		await capturer(page, 'groupement-fil-masque', UNITE)

		// LA BASCULE LE RAMÈNE, ENTIER : une ligne, son compte de 2, et sa pastille.
		await liste.getByTestId('etat-vide').getByTestId('bascule-sommeil-case').click()
		await expect(liste.getByTestId('inbox-message')).toHaveCount(1)
		await expect(liste.getByTestId('inbox-fil-compte')).toHaveText('2')
		await expect(liste.getByTestId('pastille-sommeil')).toHaveCount(1)
	})

	test('le réveil est vérifié APRÈS RECHARGEMENT, donc contre la base', async ({ page }) => {
		await connecter(page)
		await ouvrirDossierDuFil(page)
		await page.getByTestId('inbox-panneau-liste').getByTestId('inbox-message').click()
		await page.getByTestId('fil-endormir').click()
		await page.getByTestId('fil-preset-semaine').click()
		await expect(page.getByTestId('fil-reveiller')).toBeVisible()

		await page.getByTestId('fil-reveiller').click()
		await expect(page.getByTestId('fil-endormir')).toBeVisible()

		// RECHARGEMENT COMPLET : l'écran repart de la base, et non de son propre état. Un réveil qui
		// n'aurait vécu qu'en mémoire se verrait ici.
		await page.goto('/inbox')
		await page.getByTestId('inbox-panneau-dossiers').getByRole('button', { name: new RegExp(CARD_COURRIER) }).click()
		const liste = page.getByTestId('inbox-panneau-liste')
		await expect(liste.getByTestId('inbox-message')).toHaveCount(1)
		await expect(liste.getByTestId('pastille-sommeil')).toHaveCount(0)
		await expect(liste.getByTestId('inbox-fil-compte')).toHaveText('2')
	})

	test('les quatre paliers rendent le fil, son compte et son sélecteur sans débordement', async ({
		page,
	}) => {
		await connecter(page)
		await ouvrirDossierDuFil(page)
		await page.getByTestId('inbox-panneau-liste').getByTestId('inbox-message').click()
		await expect(page.getByTestId('inbox-fil-selecteur')).toBeVisible()

		for (const palier of PALIERS) {
			await page.setViewportSize({ width: palier.largeur, height: palier.hauteur })
			// SOUS 1024 PX L'INBOX EST UNE PILE : le message reste l'étage visible, et son sélecteur
			// avec lui.
			await expect(page.getByTestId('inbox-message-ouvert')).toBeVisible()
			await expect(page.getByTestId('inbox-fil-selecteur')).toBeVisible()
			await expect(page.getByTestId('inbox-fil-message')).toHaveCount(2)
			// AUCUN DÉBORDEMENT HORIZONTAL du document, à aucun palier (§7).
			const debordement = await page.evaluate(
				() => document.documentElement.scrollWidth > document.documentElement.clientWidth,
			)
			expect(debordement, `débordement horizontal au palier ${palier.nom}`).toBe(false)
			await capturer(page, `groupement-fil-${palier.nom}`, UNITE)
		}
	})
})
