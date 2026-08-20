// @verifies CRM-081 (docs/BACKLOG.md) — sommeil des fils et des cards, tranche 2 e : la SURFACE
// @verifies docs/SPEC-cards.md §16.15.4 (la pastille et son instant), §16.15.5 (le filtre de
//           composition, l'état vide qui ne ment pas, le message ouvert jamais masqué),
//           §16.15.6 (le geste à deux visages, l'échéance passée ENVOYÉE et refusée)
// @verifies docs/DESIGN_SYSTEM.md §5.3 septies (de quoi tout cela a l'air), §7 (paliers),
//           §5.8 (états) ; CLAUDE.md §16 (vérification visuelle)
//
// LE PARCOURS EST FAIT À LA SOURIS ET AU CLAVIER, comme un utilisateur réel : aucune fonction
// interne n'est appelée, aucune réponse n'est substituée, et le sommeil est posé par le VRAI geste
// de l'écran — donc par `snooze_thread`, avec le jeton réel de l'administratrice.
//
// LE SEED SORT INTACT, ET C'EST VÉRIFIÉ PLUTÔT QUE SUPPOSÉ : le réveil SUPPRIME la ligne
// (docs/SPEC-cards.md §16.14.3), donc un nettoyage inconditionnel par la clé de service en fin de
// fichier suffit — et il s'exécute même si un scénario s'interrompt en cours de route.

import { ERREUR_RESSOURCE_HTTP, autoriserErreursConsole, expect, test, type Page } from './fixtures'
import { MOT_DE_PASSE_SEED, URL_API, enTetesService } from '../api/jetons'
import { PALIERS, capturer } from './captures'

const UNITE = 'CRM-081'
const ADMIN = 'admin@p2enjoy.test'
const OBJET_CLASSE = 'Demande de devis — refonte'
const OBJET_NON_CLASSE = 'Candidature spontanée'
// LE SECOND MESSAGE NON CLASSÉ DU SEED — `CRM-060` sous-tranche 2 bis, `docs/SPEC-seed.md` §2.19.
// Il est arrivé après ce fichier, et il en a RÉVISÉ trois scénarios : le dossier « Non classés »
// ne porte plus UN fil mais DEUX, chacun d'un seul message. Ce que ces preuves visaient reste vrai
// et reste prouvé — c'est leur façon de le viser qui supposait un dossier d'une seule ligne.
const OBJET_SUGGERE = 'Point d’avancement — migration ERP'
const WORKSPACE = '5eed0000-0000-4000-8000-000000000001'
/** Le dossier du message classé : l'affaire dans laquelle la relève l'a rangé (seed §9.2). */
const CARD_COURRIER = 'Refonte du site vitrine'

/** Les deux fils du seed. Leur `references_ids` est VIDE : la clé est le `Message-ID` propre. */
const FIL_CLASSE = '<seed-inbox-classe@p2enjoy.test>'
const FIL_NON_CLASSE = '<seed-inbox-non-classe@p2enjoy.test>'

async function connecter(page: Page): Promise<void> {
	await page.goto('/connexion')
	await page.getByLabel('Adresse email').click()
	await page.keyboard.type(ADMIN)
	await page.keyboard.press('Tab')
	await page.keyboard.type(MOT_DE_PASSE_SEED)
	await page.keyboard.press('Enter')
	await expect(page.getByRole('button', { name: 'Se déconnecter' })).toBeVisible()
}

/** Ouvre le dossier « Non classés » et son unique message. */
async function ouvrirNonClasse(page: Page): Promise<void> {
	await page.goto('/inbox')
	await page.getByTestId('inbox-panneau-dossiers').getByRole('button', { name: /Non classés/ }).click()
	await page.getByTestId('inbox-panneau-liste').getByText(OBJET_NON_CLASSE).click()
	await expect(page.getByTestId('inbox-message-ouvert')).toBeVisible()
}

/**
 * Ouvre le même message alors que son fil DORT : sa ligne est masquée, la bascule la ramène.
 *
 * LA BASCULE EST PRISE DANS LE PANNEAU, ET NON DANS L'ÉTAT VIDE — révisé le 2026-08-20. Ce helper
 * cherchait `etat-vide` parce que le dossier « Non classés » ne portait qu'UN fil : l'endormir
 * vidait la liste. Depuis que le seed en fait arriver un second (`docs/SPEC-seed.md` §2.19), la
 * liste n'est plus vide, l'état vide n'existe pas, et la bascule vit dans l'en-tête du panneau —
 * exactement ce que le §5.3 septies du design system prescrit, et ce que le produit fait déjà.
 * La règle éprouvée est inchangée : une ligne masquée par le sommeil revient par la bascule.
 */
async function ouvrirNonClasseEndormi(page: Page): Promise<void> {
	await page.goto('/inbox')
	await page.getByTestId('inbox-panneau-dossiers').getByRole('button', { name: /Non classés/ }).click()
	const liste = page.getByTestId('inbox-panneau-liste')
	await expect(liste.getByText(OBJET_NON_CLASSE)).toHaveCount(0)
	await liste.getByTestId('bascule-sommeil-case').click()
	await liste.getByText(OBJET_NON_CLASSE).click()
	await expect(page.getByTestId('inbox-message-ouvert')).toBeVisible()
}

/**
 * Endort le fil d'un message désigné par son objet, par le VRAI geste de l'écran.
 *
 * AJOUTÉ LE 2026-08-20 : prouver que l'état vide d'un dossier porte sa bascule (§5.3 septies) exige
 * désormais d'endormir les DEUX fils non classés du seed, et non plus un seul. La règle n'a pas
 * bougé ; c'est la donnée de démonstration qui en porte deux.
 */
async function endormirLeFilDe(page: Page, objet: string): Promise<void> {
	await page.goto('/inbox')
	await page.getByTestId('inbox-panneau-dossiers').getByRole('button', { name: /Non classés/ }).click()
	const liste = page.getByTestId('inbox-panneau-liste')
	// LA BASCULE RAMÈNE LES LIGNES DÉJÀ ENDORMIES : sans elle, le second appel ne trouverait pas
	// son message si le premier l'avait masqué.
	if ((await liste.getByText(objet).count()) === 0) {
		await liste.getByTestId('bascule-sommeil-case').click()
	}
	await liste.getByText(objet).click()
	await expect(page.getByTestId('inbox-message-ouvert')).toBeVisible()
	await page.getByTestId('fil-endormir').click()
	await page.getByTestId('fil-preset-semaine').click()
	await expect(page.getByTestId('inbox-message-ouvert').getByTestId('pastille-sommeil')).toBeVisible()
}

/** Le nettoyage : la clé de service supprime toute ligne restée derrière un scénario. */
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

test.describe('CRM-081 tranche 2 e — le sommeil d’un fil dans l’inbox', () => {
	test.afterEach(async () => {
		await reveillerTout()
	})

	test('le geste endort le fil, la pastille paraît, et la ligne quitte la liste', async ({ page }) => {
		await connecter(page)
		await ouvrirNonClasse(page)

		const liste = page.getByTestId('inbox-panneau-liste')
		// AVANT LE GESTE : aucune pastille, et le message est dans la liste.
		await expect(liste.getByText(OBJET_NON_CLASSE)).toBeVisible()
		await expect(page.getByTestId('pastille-sommeil')).toHaveCount(0)
		await capturer(page, 'sommeil-fil-avant', UNITE)

		// LE GESTE, PAR L'ÉCRAN ET RIEN D'AUTRE.
		await page.getByTestId('fil-endormir').click()
		await expect(page.getByTestId('fil-panneau')).toBeVisible()
		await capturer(page, 'sommeil-fil-panneau', UNITE)
		await page.getByTestId('fil-preset-semaine').click()

		// LA PASTILLE PARAÎT DANS LE MESSAGE OUVERT.
		await expect(page.getByTestId('inbox-message-ouvert').getByTestId('pastille-sommeil')).toBeVisible()

		// ET SA LIGNE RESTE, MARQUÉE — RÈGLE CORRIGÉE PAR CETTE PREUVE LE 2026-08-19. La première
		// rédaction du §16.15.5 attendait ici que la ligne quitte la liste, tout en posant que le
		// message ouvert n'est jamais masqué : les deux ne peuvent pas être vraies ensemble, le
		// filtre n'agissant que sur des lignes. Le produit avait raison, la phrase avait tort ; le
		// chapitre est corrigé dans le même changement, et l'assertion dit désormais la règle
		// retenue — rien ne disparaît sous le doigt de celui qui vient d'appuyer.
		await expect(liste.getByText(OBJET_NON_CLASSE)).toBeVisible()
		await expect(liste.getByTestId('pastille-sommeil')).toBeVisible()
		await capturer(page, 'sommeil-fil-apres', UNITE)

		// ELLE QUITTE LA LISTE AU GESTE SUIVANT, et c'est là que le masquage s'observe.
		await page.goto('/inbox')
		await page.getByTestId('inbox-panneau-dossiers').getByRole('button', { name: /Non classés/ }).click()
		await expect(liste.getByText(OBJET_NON_CLASSE)).toHaveCount(0)

	})

	test('la bascule ramène le fil endormi, marqué, et l’état vide porte son geste', async ({ page }) => {
		await connecter(page)
		// LES DEUX FILS DU DOSSIER SONT ENDORMIS — révisé le 2026-08-20. Ce scénario endormait le
		// SEUL fil non classé du seed ; il en porte deux depuis `CRM-060` sous-tranche 2 bis
		// (`docs/SPEC-seed.md` §2.19). Ce que la preuve vise est l'état vide DÛ AU SOMMEIL, et un
		// dossier dont une ligne reste éveillée n'est pas vide : il faut donc endormir les deux
		// pour atteindre l'état que le §16.15.5 point 2 décrit. La règle est inchangée.
		await endormirLeFilDe(page, OBJET_NON_CLASSE)
		await endormirLeFilDe(page, OBJET_SUGGERE)

		// LE DOSSIER « Non classés » EST ALORS ENTIÈREMENT ENDORMI : la liste est vide, et l'état
		// vide doit dire POURQUOI — « tous dans des fils en sommeil », et non « aucun message »
		// (§16.15.5 point 2). Le message ouvert est refermé en changeant de dossier.
		await page.goto('/inbox')
		const dossiers = page.getByTestId('inbox-panneau-dossiers')
		await dossiers.getByRole('button', { name: /Non classés/ }).click()
		const liste = page.getByTestId('inbox-panneau-liste')
		await expect(liste.getByText('Tous les messages de ce dossier sont dans des fils en sommeil')).toBeVisible()
		// L'ACTION N'EST PAS RÉPÉTÉE (§5.8, §5.3 septies) : UNE seule bascule dans le panneau, celle
		// de l'état vide. Défaut vu en capture — l'en-tête et l'état vide portaient la même case à
		// quelques centimètres l'une de l'autre — puis corrigé et figé ici.
		await expect(liste.getByTestId('bascule-sommeil')).toHaveCount(1)
		await capturer(page, 'sommeil-fil-vide', UNITE)

		// L'ÉTAT VIDE PORTE LA BASCULE QUI L'EN SORT (§5.8), et elle fonctionne.
		// `click` ET NON `check` : la bascule de l'état vide DISPARAÎT en réussissant — l'état vide
		// qui la porte cesse d'exister dès que la liste n'est plus vide. `check` relit l'état de la
		// case après son clic et échouerait sur un élément détaché, ce qui dirait le contraire de
		// ce qui s'est passé.
		await liste.getByTestId('etat-vide').getByTestId('bascule-sommeil-case').click()
		await expect(liste.getByText(OBJET_NON_CLASSE)).toBeVisible()
		// LA LIGNE RAMENÉE EST MARQUÉE : sans la pastille, elle serait indistinguable d'une ligne
		// éveillée, et la bascule n'aurait aucun effet visible (§16.12.7, transposé).
		// LA PASTILLE EST CHERCHÉE SUR SA LIGNE, et non dans le panneau — révisé le 2026-08-20 :
		// les DEUX fils du dossier dorment désormais, donc deux pastilles paraissent, et une
		// recherche à l'échelle du panneau ne dit plus laquelle appartient à la ligne visée.
		const ligneRamenee = liste.getByTestId('inbox-message').filter({ hasText: OBJET_NON_CLASSE })
		await expect(ligneRamenee.getByTestId('pastille-sommeil')).toBeVisible()
		await capturer(page, 'sommeil-fil-bascule', UNITE)
	})

	test('le réveil est vérifié APRÈS RECHARGEMENT, donc contre la base', async ({ page }) => {
		await connecter(page)
		await ouvrirNonClasse(page)
		await page.getByTestId('fil-endormir').click()
		await page.getByTestId('fil-preset-demain').click()
		await expect(page.getByTestId('fil-reveiller')).toBeVisible()

		// RECHARGEMENT : ce qui suit ne peut plus venir d'un état de composant, il vient de la base.
		// ET IL FAUT LA BASCULE POUR LE RETROUVER : après rechargement le message n'est plus ouvert,
		// donc sa ligne est masquée — c'est précisément ce que le filtre promet.
		await ouvrirNonClasseEndormi(page)
		await expect(page.getByTestId('fil-reveiller')).toBeVisible()
		await expect(page.getByTestId('inbox-message-ouvert').getByTestId('pastille-sommeil')).toBeVisible()

		// LE RÉVEIL N'OUVRE AUCUN PANNEAU ET NE DEMANDE AUCUNE CONFIRMATION (§5.3 septies).
		await page.getByTestId('fil-reveiller').click()
		await expect(page.getByTestId('fil-endormir')).toBeVisible()
		await expect(page.getByTestId('pastille-sommeil')).toHaveCount(0)

		// ET IL TIENT APRÈS RECHARGEMENT : la ligne a bien été supprimée en base (§16.14.3), donc le
		// message se retrouve SANS bascule — la preuve que le réveil a bien atteint la base.
		await ouvrirNonClasse(page)
		await expect(page.getByTestId('fil-endormir')).toBeVisible()
		await expect(page.getByTestId('pastille-sommeil')).toHaveCount(0)
		await expect(page.getByTestId('inbox-panneau-liste').getByText(OBJET_NON_CLASSE)).toBeVisible()
	})

	test('une échéance PASSÉE est envoyée, refusée par la base, et le refus n’efface pas la saisie', async ({
		page,
	}) => {
		await connecter(page)
		await ouvrirNonClasse(page)
		await page.getByTestId('fil-endormir').click()

		// AUCUNE GARDE DE SAISIE NE DOUBLE LA BASE (§16.15.6) : la date passée est ENVOYÉE.
		const champ = page.getByTestId('fil-echeance')
		await champ.fill('2020-01-01T09:00')
		await page.getByTestId('fil-soumettre').click()

		// LE REFUS VIENT DU SERVEUR — `snooze_date_in_past` —, et il est écrit sous le champ.
		const refus = page.getByTestId('fil-refus')
		await expect(refus).toBeVisible()
		await expect(refus).toHaveText('L’échéance doit être future.')
		// LA SAISIE N'EST PAS EFFACÉE : la corriger vaut mieux que la retaper.
		await expect(champ).toHaveValue('2020-01-01T09:00')
		// ET RIEN N'A ÉTÉ ENDORMI : la pastille est absente, le panneau reste ouvert.
		await expect(page.getByTestId('pastille-sommeil')).toHaveCount(0)
		await expect(page.getByTestId('fil-panneau')).toBeVisible()
		await capturer(page, 'sommeil-fil-refus', UNITE)

		// LE `400` EST CONSOMMÉ NOMMÉMENT : il est la PREUVE que le refus vient du serveur et non
		// d'une garde de saisie. Le filtrer globalement laisserait passer un écran qui refuserait
		// tout seul, sans jamais demander.
		autoriserErreursConsole(page, [ERREUR_RESSOURCE_HTTP[400]])
	})

	test('le fil du message CLASSÉ s’endort indépendamment de celui du non classé', async ({ page }) => {
		// DEUX FILS, DEUX ÉTATS : sans ce scénario, rien ne prouverait que la clé distingue les
		// fils — un masquage qui emporterait les deux messages serait vert sur un seul fil.
		await connecter(page)
		await ouvrirNonClasse(page)
		await page.getByTestId('fil-endormir').click()
		await page.getByTestId('fil-preset-semaine').click()
		await expect(page.getByTestId('fil-reveiller')).toBeVisible()

		// Le message CLASSÉ vit dans le dossier de son affaire, et son fil est intact.
		await page.goto('/inbox')
		const dossiers = page.getByTestId('inbox-panneau-dossiers')
		await dossiers.getByRole('button', { name: new RegExp(CARD_COURRIER) }).click()
		const liste = page.getByTestId('inbox-panneau-liste')
		await liste.getByText(OBJET_CLASSE).click()
		await expect(page.getByTestId('inbox-message-ouvert')).toBeVisible()
		// SON FIL EST ÉVEILLÉ : la commande est « Mettre le fil en sommeil », pas « Réveiller ».
		await expect(page.getByTestId('fil-endormir')).toBeVisible()
		await expect(page.getByTestId('inbox-message-ouvert').getByTestId('pastille-sommeil')).toHaveCount(0)
	})

	test('les quatre paliers rendent la pastille et le geste sans débordement', async ({ page }) => {
		await connecter(page)
		await ouvrirNonClasse(page)
		await page.getByTestId('fil-endormir').click()
		await page.getByTestId('fil-preset-semaine').click()
		await expect(page.getByTestId('fil-reveiller')).toBeVisible()

		for (const palier of PALIERS) {
			await page.setViewportSize({ width: palier.largeur, height: palier.hauteur })
			// SOUS 1024 PX L'INBOX EST UNE PILE : le message reste l'étage visible après le geste.
			await expect(page.getByTestId('inbox-message-ouvert')).toBeVisible()
			await expect(page.getByTestId('fil-reveiller')).toBeVisible()
			// AUCUN DÉBORDEMENT HORIZONTAL du document, à aucun palier (§7).
			const debordement = await page.evaluate(
				() => document.documentElement.scrollWidth > document.documentElement.clientWidth,
			)
			expect(debordement, `débordement horizontal au palier ${palier.nom}`).toBe(false)
			await capturer(page, `sommeil-fil-${palier.nom}`, UNITE)
		}
	})
})
