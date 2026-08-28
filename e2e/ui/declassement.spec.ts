// @verifies CRM-055 tranche 2 (docs/BACKLOG.md) — le DÉCLASSEMENT : retirer un message de l'affaire
//           où il était classé
// @verifies docs/SPEC-mail-subsystem.md §16.5.5 (la commande, sa confirmation dans le flux, la
//           conséquence nommée), §16.5.2 (les droits, et la card quittée rendue), §16.5.3
//           (l'historique conservé, le départ écrit)
// @verifies docs/DESIGN_SYSTEM.md §5.3 quater (confirmation dans le flux, jamais en modale),
//           §5.4 (inbox), §7 (paliers), §10 (clavier)
// @verifies docs/JOURNAL.md décision 536 ; CLAUDE.md §16 (vérification visuelle)
//
// LE PARCOURS EST FAIT À LA SOURIS ET AU CLAVIER, comme un utilisateur réel : aucune fonction
// interne n'est appelée, aucune réponse n'est substituée. Le message vient du seed (§2.19) : il a
// été RÉELLEMENT reçu par la relève, puis classé par la règle 1.
//
// LE SEED EST RENDU INTACT PAR UN `afterEach` INCONDITIONNEL, et c'est la leçon des décisions 501
// et 535, payée deux fois : une remise en état écrite en fin de corps N'A PAS LIEU quand le
// scénario échoue, et les scénarios suivants échouent alors sur un décor qu'ils n'ont pas cassé.
// Diagnostiquer trois échecs quand un seul est réel coûte cher.
//
// CE QUE LA REMISE EN ÉTAT NE PEUT PAS DÉFAIRE, et qui est nommé plutôt que tu : le `card_event`
// `mail_unclassified` écrit sur la card. `card_events` n'accorde AUCUN privilège d'écriture,
// `service_role` compris (`CRM-044`) — l'historique ne se corrige pas. C'est exactement ce que le
// scénario de classement de `inbox.spec.ts` constate déjà pour son `mail_received`.

import { expect, test, type Page } from './fixtures'
import { MOT_DE_PASSE_SEED, URL_API, enTetesService } from '../api/jetons'
import { capturer } from './captures'

const UNITE = 'CRM-055'
const ADMIN = 'admin@p2enjoy.test'
const OBJET_CLASSE = 'Demande de devis — refonte'
const MSGID_CLASSE = '<seed-inbox-classe@p2enjoy.test>'
/** L'autre membre du MÊME fil : le seed le classe lui aussi dans la card du courrier. */
const MSGID_REPONSE = '<seed-inbox-reponse@p2enjoy.test>'
const CARD_COURRIER = '5eed0000-0000-4000-8000-0000000000c1'
const TITRE_CARD_COURRIER = 'Refonte du site vitrine'
/** L'adresse d'une card porte son track et son channel — `CHEMIN_CARD` de `routes.tsx`. */
const SLUG_TRACK = 'conseil-ia'
const SLUG_CHANNEL = 'grands-comptes'

async function connecter(page: Page): Promise<void> {
	await page.goto('/connexion')
	await page.getByLabel('Adresse email').click()
	await page.keyboard.type(ADMIN)
	await page.keyboard.press('Tab')
	await page.keyboard.type(MOT_DE_PASSE_SEED)
	await page.keyboard.press('Enter')
	await expect(page.getByRole('button', { name: 'Se déconnecter' })).toBeVisible()
}

/**
 * L'identifiant d'un message du seed, LU et jamais codé en dur.
 *
 * MESURÉ : `mail_messages.id` est un `uuid` engendré à l'insertion, et le seed ne le fige pas. Le
 * `rfc822_message_id`, lui, est stable. Même règle qu'à `inbox.spec.ts`.
 */
async function idDuMessage(page: Page, rfc822: string): Promise<string> {
	const reponse = await page.request.get(
		`${URL_API}/rest/v1/mail_messages?select=id&rfc822_message_id=eq.${encodeURIComponent(rfc822)}`,
		{ headers: enTetesService() },
	)
	const [ligne] = (await reponse.json()) as { id: string }[]
	expect(ligne?.id, `le seed porte ${rfc822}`).toBeTruthy()
	return ligne?.id ?? ''
}

/**
 * Ouvre le message CLASSÉ du seed **par son adresse**, et surtout pas par un filtre d'objet.
 *
 * UN DÉFAUT DE CETTE PREUVE, TROUVÉ PAR SON PREMIER ÉCHEC, ET CORRIGÉ À SA CAUSE. La première
 * rédaction cliquait la ligne de liste filtrée par `hasText: 'Demande de devis — refonte'`. Or la
 * liste énumère des FILS (`CRM-081` §16.16.3) et le seed en porte deux membres — la demande et sa
 * réponse « Re: Demande de devis — refonte », que ce filtre attrape AUSSI. Ouvrir un fil ouvre son
 * message le plus RÉCENT : le geste portait donc sur la réponse, et non sur le message que le
 * scénario relit ensuite. Les assertions échouaient sur un message correct, et le seed repartait
 * abîmé sur une ligne que la remise en état ne visait pas.
 *
 * Le paramètre `message` de l'adresse (`CRM-065` §15) désigne UN message et un seul : c'est le seul
 * chemin déterministe, et il est d'ailleurs celui que la palette emprunte.
 */
async function ouvrirLeMessageClasse(page: Page): Promise<void> {
	const identifiant = await idDuMessage(page, MSGID_CLASSE)
	await page.goto(`/inbox?message=${identifiant}`)
	await expect(page.getByTestId('inbox-message-ouvert')).toBeVisible()
	await expect(page.getByTestId('inbox-message-ouvert')).toContainText(OBJET_CLASSE)
	// LE FIL DU SEED PORTE DEUX MESSAGES : sans cette assertion, un sélecteur qui ouvrirait le
	// mauvais membre du fil passerait inaperçu, l'objet de la réponse contenant celui de la demande.
	await expect(page.getByRole('heading', { level: 3 })).toHaveText(OBJET_CLASSE)
}

/** L'état de classement du message du seed, lu par la clé de service. */
async function etatDuMessage(page: Page): Promise<{
	classification: string
	card_id: string | null
	classified_by: string | null
}> {
	const reponse = await page.request.get(
		`${URL_API}/rest/v1/mail_messages?select=classification,card_id,classified_by` +
			`&rfc822_message_id=eq.${encodeURIComponent(MSGID_CLASSE)}`,
		{ headers: enTetesService() },
	)
	const [ligne] = (await reponse.json()) as {
		classification: string
		card_id: string | null
		classified_by: string | null
	}[]
	expect(ligne, `le seed porte ${MSGID_CLASSE}`).toBeTruthy()
	return ligne as { classification: string; card_id: string | null; classified_by: string | null }
}

test.describe('déclassement d’un message (docs/SPEC-mail-subsystem.md §16.5)', () => {
	// INCONDITIONNEL, ET DANS UN `afterEach` PLUTÔT QU'UN `afterAll` : le scénario du retrait laisse
	// le message non classé, et celui de l'annulation attend de le trouver classé.
	test.afterEach(async ({ page }) => {
		// LES DEUX MEMBRES DU FIL SONT REMIS, et pas seulement celui que le scénario vise. Le
		// premier échec de cette suite a déclassé la RÉPONSE au lieu de la demande, et une remise
		// en état qui n'aurait visé qu'un `rfc822_message_id` aurait laissé l'autre abîmé — le
		// scénario suivant aurait alors échoué sur un décor qu'il n'a pas cassé (décision 501).
		for (const identifiant of [MSGID_CLASSE, MSGID_REPONSE]) {
			await page.request.patch(
				`${URL_API}/rest/v1/mail_messages?rfc822_message_id=eq.${encodeURIComponent(identifiant)}`,
				{
					headers: { ...enTetesService(), Prefer: 'return=minimal' },
					data: {
						card_id: CARD_COURRIER,
						classification: 'auto',
						classified_by: null,
						classified_at: null,
					},
				},
			)
		}
	})

	test('la commande demande confirmation, la nomme, et ANNULER ne défait rien', async ({ page }) => {
		await connecter(page)
		await ouvrirLeMessageClasse(page)

		// AUCUNE COMMANDE N'EST ÉTEINTE D'AVANCE : elle est offerte, et activable.
		const commande = page.getByTestId('inbox-retirer')
		await expect(commande).toBeEnabled()
		await commande.click()

		const confirmation = page.getByTestId('inbox-retrait-confirmation')
		await expect(confirmation).toBeVisible()
		// LA CONFIRMATION VIT DANS LE FLUX, JAMAIS EN MODALE (§5.3 quater) : rien ne porte le rôle
		// `dialog`, et le reste de la page demeure lisible derrière elle.
		await expect(page.getByRole('dialog')).toHaveCount(0)
		await expect(page.getByTestId('inbox-corps')).toBeVisible()

		// ELLE DIT CE QUI N'ARRIVE PAS — rien n'est supprimé — ET LA CONSÉQUENCE qui peut arriver.
		await expect(confirmation).toContainText('Rien n’est supprimé')
		await expect(confirmation).toContainText('vous ne le verrez plus')
		// LE FOCUS ENTRE DANS LA CONFIRMATION : le clavier ne repart pas du début du document.
		await expect(page.getByTestId('inbox-retirer-valider')).toBeFocused()

		await capturer(page, 'declassement-confirmation-1440', UNITE)

		// ANNULER, AU CLAVIER, et le focus revient à la commande qui avait ouvert.
		await page.getByTestId('inbox-retirer-annuler').click()
		await expect(confirmation).toHaveCount(0)
		await expect(commande).toBeFocused()

		// ET RIEN N'A ÉTÉ ENVOYÉ : la ligne est relue par l'API, avec la clé de service. Un geste
		// annulé qui aurait écrit ne se verrait pas à l'écran.
		const etat = await etatDuMessage(page)
		expect(etat.classification).toBe('auto')
		expect(etat.card_id).toBe(CARD_COURRIER)
	})

	test('le retrait renvoie le message aux « Non classés », et le fil garde les DEUX faits', async ({
		page,
	}) => {
		await connecter(page)
		await ouvrirLeMessageClasse(page)

		await page.getByTestId('inbox-retirer').click()
		await page.getByTestId('inbox-retirer-valider').click()

		// L'ÉCRAN RELIT TOUT CE QUI A CHANGÉ : le message n'a plus d'affaire, et il porte donc la
		// mention et les gestes d'un non classé.
		await expect(page.getByTestId('inbox-pilule-card')).toHaveCount(0)
		await expect(page.getByTestId('inbox-classer')).toBeVisible()
		await expect(page.getByTestId('inbox-retirer')).toHaveCount(0)

		await capturer(page, 'declassement-apres-retrait-1440', UNITE)

		// ET L'EFFET EST RELU PAR L'API : un geste prouvé sur l'écran seul ne prouverait que l'écran.
		const etat = await etatDuMessage(page)
		expect(etat.classification).toBe('unclassified')
		expect(etat.card_id).toBeNull()
		expect(etat.classified_by).toBeNull()

		// L'HISTOIRE N'EST PAS RÉÉCRITE, ET LE DÉPART EST ÉCRIT. Les deux événements coexistent sur
		// la card : le courrier est arrivé, puis il est parti.
		const identifiant = await idDuMessage(page, MSGID_CLASSE)

		const arrivee = await page.request.get(
			`${URL_API}/rest/v1/card_events?card_id=eq.${CARD_COURRIER}&type=eq.mail_received` +
				`&payload->>message_id=eq.${identifiant}&select=id`,
			{ headers: enTetesService() },
		)
		expect(((await arrivee.json()) as unknown[]).length).toBeGreaterThanOrEqual(1)

		const depart = await page.request.get(
			`${URL_API}/rest/v1/card_events?card_id=eq.${CARD_COURRIER}&type=eq.mail_unclassified` +
				`&payload->>message_id=eq.${identifiant}&select=id,payload`,
			{ headers: enTetesService() },
		)
		const departs = (await depart.json()) as { payload: { subject: string } }[]
		expect(departs.length).toBeGreaterThanOrEqual(1)
		// LE DÉPART PORTE L'OBJET DU MESSAGE, et c'est ce qui rend la ligne lisible à qui ne peut
		// plus ouvrir le message qu'elle désigne (§16.5.3).
		expect(departs[departs.length - 1]?.payload.subject).toBe(OBJET_CLASSE)
	})

	test('le fil de l’affaire NOMME le départ, il ne rend pas « Événement »', async ({ page }) => {
		await connecter(page)
		await ouvrirLeMessageClasse(page)
		await page.getByTestId('inbox-retirer').click()
		await page.getByTestId('inbox-retirer-valider').click()
		await expect(page.getByTestId('inbox-classer')).toBeVisible()

		// C'EST LE DÉFAUT D'INC-207 ET D'INC-220 QU'ON ÉCARTE ICI : un type écrit en base et absent
		// du registre de l'écran se lit « Événement », et la mémoire de l'affaire devient muette.
		// L'ADRESSE D'UNE CARD EXIGE SON TRACK ET SON CHANNEL (`webapp/src/app/routes.tsx`,
		// `CHEMIN_CARD`) : `/cards/<id>` seul rend « Page introuvable ». Mesuré au premier échec de
		// ce scénario, et corrigé plutôt que contourné.
		await page.goto(`/tracks/${SLUG_TRACK}/${SLUG_CHANNEL}/cards/${CARD_COURRIER}`)
		const fil = page.getByRole('region', { name: 'Fil de cette affaire' })
		const ligneDepart = fil.getByText('Message retiré de l’affaire').first()
		await expect(ligneDepart).toBeVisible()
		// LE DÉTAIL PORTE L'OBJET, lu dans le `payload` : la card ne porte plus ce message, donc
		// aucun libellé ne pourrait être résolu à la lecture (§16.5.3).
		await expect(fil.getByText(new RegExp(OBJET_CLASSE)).first()).toBeVisible()
		// ET L'ARRIVÉE EST TOUJOURS LÀ : l'historique n'est pas réécrit.
		await expect(fil.getByText('Message reçu').first()).toBeVisible()

		// LA CAPTURE DOIT MONTRER CE QUE L'ASSERTION MESURE : le fil est long, et une capture prise
		// sans amener la ligne dans le champ de vision montrerait le haut du formulaire.
		await ligneDepart.scrollIntoViewIfNeeded()
		await capturer(page, 'declassement-fil-affaire-1440', UNITE)
	})

	test('tout le geste se fait AU CLAVIER, de la commande à la confirmation', async ({ page }) => {
		await connecter(page)
		await ouvrirLeMessageClasse(page)

		// LA COMMANDE EST ATTEIGNABLE ET ACTIONNABLE SANS SOURIS (`CLAUDE.md` §22). Elle est
		// focalisée puis actionnée par `Entrée`, comme un utilisateur au clavier le ferait.
		await page.getByTestId('inbox-retirer').focus()
		await page.keyboard.press('Enter')
		await expect(page.getByTestId('inbox-retrait-confirmation')).toBeVisible()
		await expect(page.getByTestId('inbox-retirer-valider')).toBeFocused()

		// `Tab` MÈNE DE LA CONFIRMATION À SON ANNULATION, et `Entrée` referme.
		await page.keyboard.press('Tab')
		await expect(page.getByTestId('inbox-retirer-annuler')).toBeFocused()
		await page.keyboard.press('Enter')
		await expect(page.getByTestId('inbox-retrait-confirmation')).toHaveCount(0)
		await expect(page.getByTestId('inbox-retirer')).toBeFocused()

		// PUIS LE GESTE COMPLET, AU CLAVIER, jusqu'à son effet.
		await page.keyboard.press('Enter')
		await expect(page.getByTestId('inbox-retirer-valider')).toBeFocused()
		await page.keyboard.press('Enter')
		await expect(page.getByTestId('inbox-classer')).toBeVisible()

		const etat = await etatDuMessage(page)
		expect(etat.card_id).toBeNull()
	})

	test('la confirmation tient à 390 px, sans débordement', async ({ page }) => {
		await connecter(page)
		await page.setViewportSize({ width: 390, height: 780 })
		await ouvrirLeMessageClasse(page)
		await page.getByTestId('inbox-retirer').click()
		await expect(page.getByTestId('inbox-retrait-confirmation')).toBeVisible()

		// LE DOCUMENT NE DÉFILE PAS HORIZONTALEMENT : c'est le défaut que l'œil trouve et qu'aucune
		// assertion de contenu n'attrape (`CLAUDE.md` §16, et le défaut mesuré de `CRM-089`).
		const debordement = await page.evaluate(
			() => document.documentElement.scrollWidth - document.documentElement.clientWidth,
		)
		expect(debordement).toBeLessThanOrEqual(0)

		await capturer(page, 'declassement-confirmation-390', UNITE)
	})
})
