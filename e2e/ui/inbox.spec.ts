// @verifies CRM-057 (docs/BACKLOG.md) — inbox globale : trois panneaux, tri, double visibilité
// @verifies docs/SPEC-mail-subsystem.md §18.3 (les trois panneaux), §18.4 (le HTML jamais
//           affiché), §18.6 (le message dans la card), §18.8 (preuves exigées)
// @verifies docs/DESIGN_SYSTEM.md §5.4 (inbox), §5.8 (états), §7 (paliers), §10 (clavier)
// @verifies docs/JOURNAL.md décision 327 ; CLAUDE.md §16 (vérification visuelle)
//
// LE PARCOURS EST FAIT AU CLAVIER ET À LA SOURIS, comme un utilisateur réel : aucune fonction
// interne n'est appelée, aucune réponse n'est substituée. Le courrier vient du seed (§2.19) : deux
// messages RÉELLEMENT reçus par la relève.
//
// LE SEED EST RENDU INTACT. Le scénario qui classe le message non classé le **remet** non classé
// par la clé de service dans son `finally` — le seul chemin qui le peut, `mail_messages`
// n'accordant aucune écriture à `authenticated`.

import { expect, test, type Page } from './fixtures'
import { MOT_DE_PASSE_SEED, URL_API, enTetesService } from '../api/jetons'
import { PALIERS, capturer } from './captures'

const UNITE = 'CRM-057'
const ADMIN = 'admin@p2enjoy.test'
const OBJET_NON_CLASSE = 'Candidature spontanée'
const OBJET_CLASSE = 'Demande de devis — refonte'
const MSGID_NON_CLASSE = '<seed-inbox-non-classe@p2enjoy.test>'
const CARD_COURRIER = '5eed0000-0000-4000-8000-0000000000c1'

async function connecter(page: Page): Promise<void> {
	await page.goto('/connexion')
	await page.getByLabel('Adresse email').click()
	await page.keyboard.type(ADMIN)
	await page.keyboard.press('Tab')
	await page.keyboard.type(MOT_DE_PASSE_SEED)
	await page.keyboard.press('Enter')
	await expect(page.getByRole('button', { name: 'Se déconnecter' })).toBeVisible()
}

test.describe('inbox globale (docs/SPEC-mail-subsystem.md §18)', () => {
	test('les trois panneaux montrent le courrier reçu, et le corps reste du texte', async ({ page }) => {
		await connecter(page)
		await page.goto('/inbox')

		// Panneau 1 — les dossiers. « Non classés » est en tête, avec son compte.
		const dossiers = page.getByTestId('inbox-panneau-dossiers')
		await expect(dossiers.getByRole('button', { name: /Non classés/ })).toBeVisible()

		// Panneau 2 — la liste, après un clic sur le dossier.
		await dossiers.getByRole('button', { name: /Non classés/ }).click()
		const liste = page.getByTestId('inbox-panneau-liste')
		await expect(liste.getByText(OBJET_NON_CLASSE)).toBeVisible()

		// Panneau 3 — le message.
		await liste.getByTestId('inbox-message').filter({ hasText: OBJET_NON_CLASSE }).click()
		const message = page.getByTestId('inbox-message-ouvert')
		await expect(message.getByRole('heading', { name: OBJET_NON_CLASSE })).toBeVisible()
		await expect(message.getByText('bizdev@p2enjoy.test')).toBeVisible()

		// LE CORPS EST DU TEXTE : le message du seed est en `text/plain`, et l'écran l'affiche tel
		// quel. Aucune balise n'est interprétée nulle part — la réduction du HTML est éprouvée sans
		// navigateur par `webapp/src/lib/inbox.test.ts`.
		await expect(page.getByTestId('inbox-corps')).toContainText('candidature spontanée')

		await capturer(page, 'inbox-trois-panneaux-1440', UNITE)
	})

	test('le dossier retenu et le message ouvert s’annoncent, pas seulement en couleur', async ({
		page,
	}) => {
		await connecter(page)
		await page.goto('/inbox')

		const dossiers = page.getByTestId('inbox-panneau-dossiers')
		const nonClasses = dossiers.getByRole('button', { name: /Non classés/ })
		await expect(nonClasses).not.toHaveAttribute('aria-current', 'true')
		await nonClasses.click()
		await expect(nonClasses).toHaveAttribute('aria-current', 'true')

		const ligne = page
			.getByTestId('inbox-panneau-liste')
			.getByTestId('inbox-message')
			.filter({ hasText: OBJET_NON_CLASSE })
		await ligne.click()
		await expect(ligne).toHaveAttribute('aria-current', 'true')
	})

	test('tout le parcours se fait AU CLAVIER, du dossier au message', async ({ page }) => {
		await connecter(page)
		await page.goto('/inbox')
		await expect(page.getByTestId('inbox-panneau-dossiers')).toBeVisible()

		// Depuis le haut du document, on avance jusqu'au dossier des non classés, et on l'ouvre par
		// la touche Entrée — jamais par un clic programmatique.
		const nonClasses = page
			.getByTestId('inbox-panneau-dossiers')
			.getByRole('button', { name: /Non classés/ })
		await nonClasses.focus()
		// Le focus VISIBLE est celui du clavier : `:focus-visible` ne s'applique pas à un `focus()`
		// programmatique, et une preuve qui s'en contenterait mesurerait autre chose que ce que
		// l'utilisateur voit. On repart donc d'un vrai geste de tabulation.
		await page.keyboard.press('Shift+Tab')
		await page.keyboard.press('Tab')
		await expect(nonClasses).toBeFocused()
		await page.keyboard.press('Enter')

		const liste = page.getByTestId('inbox-panneau-liste')
		await expect(liste.getByText(OBJET_NON_CLASSE)).toBeVisible()

		const premier = liste.getByTestId('inbox-message').first()
		await premier.focus()
		await page.keyboard.press('Shift+Tab')
		await page.keyboard.press('Tab')
		await expect(premier).toBeFocused()
		await capturer(page, 'inbox-focus-clavier-1440', UNITE)
		await page.keyboard.press('Enter')

		await expect(page.getByTestId('inbox-message-ouvert')).toBeVisible()
	})

	test('un message classé est visible À LA FOIS dans sa card et dans l’inbox', async ({ page }) => {
		await connecter(page)

		// 1. Dans l'inbox, sous le dossier de la card.
		await page.goto('/inbox')
		const dossiers = page.getByTestId('inbox-panneau-dossiers')
		await dossiers.getByRole('button', { name: /Refonte du site vitrine/ }).click()
		const liste = page.getByTestId('inbox-panneau-liste')
		await liste.getByTestId('inbox-message').filter({ hasText: OBJET_CLASSE }).click()
		await expect(page.getByTestId('inbox-message-ouvert')).toContainText(OBJET_CLASSE)
		// La pilule mène à l'affaire, et porte son titre — non le mot « card ».
		const pilule = page.getByTestId('inbox-pilule-card')
		await expect(pilule).toHaveText('Refonte du site vitrine')
		await capturer(page, 'inbox-message-classe-1440', UNITE)

		// 2. Dans la card, par la pilule — le même message, nommé dans le fil.
		await pilule.click()
		await expect(page).toHaveURL(new RegExp(`/cards/${CARD_COURRIER}$`))
		const fil = page.getByRole('region', { name: 'Fil de cette affaire' })
		const ligneCourrier = fil.getByText(new RegExp(OBJET_CLASSE)).first()
		await expect(fil.getByText('Message reçu').first()).toBeVisible()
		// LE FIL NOMME LE COURRIER, il ne se contente plus d'annoncer qu'un message est arrivé.
		await expect(ligneCourrier).toBeVisible()
		// LA CAPTURE DOIT MONTRER CE QUE L'ASSERTION MESURE : le fil est long, et une capture prise
		// sans amener la ligne dans le champ de vision aurait montré le haut du formulaire — vraie,
		// et sans rapport avec ce qui est prouvé.
		await ligneCourrier.scrollIntoViewIfNeeded()
		await capturer(page, 'inbox-message-dans-la-card-1440', UNITE)
	})

	test('un non classé se trie depuis l’écran, et le fil de la card l’enregistre', async ({ page }) => {
		await connecter(page)
		await page.goto('/inbox')

		try {
			await page.getByTestId('inbox-panneau-dossiers').getByRole('button', { name: /Non classés/ }).click()
			await page
				.getByTestId('inbox-panneau-liste')
				.getByTestId('inbox-message')
				.filter({ hasText: OBJET_NON_CLASSE })
				.click()

			await page.getByTestId('inbox-classer').click()
			const formulaire = page.getByTestId('inbox-formulaire-classement')
			await expect(formulaire).toBeVisible()
			// Le focus part sur le sélecteur : sans cela, le clavier repartirait du début du
			// document après la disparition du bouton.
			await expect(page.getByLabel('Affaire de destination')).toBeFocused()
			await capturer(page, 'inbox-classement-1440', UNITE)

			// Le sélecteur porte le chemin complet de l'affaire — track, channel, titre —, et c'est
			// ce que l'utilisateur lit. L'option est donc désignée par sa VALEUR, l'identifiant de
			// la card, plutôt que par un libellé qui dépend du nommage des tracks.
			await page.getByLabel('Affaire de destination').selectOption(CARD_COURRIER)
			await page.getByTestId('inbox-classer-valider').click()

			// L'ÉCRAN RELIT TOUT CE QUI A CHANGÉ : le message porte désormais son affaire.
			await expect(page.getByTestId('inbox-pilule-card')).toHaveText('Refonte du site vitrine')

			// ET L'EFFET EST RELU PAR L'API, avec la clé de service : un geste prouvé sur l'écran
			// seul ne prouverait que l'écran.
			const reponse = await page.request.get(
				`${URL_API}/rest/v1/mail_messages?select=classification,card_id,classified_by&rfc822_message_id=eq.${encodeURIComponent(MSGID_NON_CLASSE)}`,
				{ headers: enTetesService() },
			)
			const [ligne] = (await reponse.json()) as {
				classification: string
				card_id: string
				classified_by: string | null
			}[]
			expect(ligne?.classification).toBe('manual')
			expect(ligne?.card_id).toBe(CARD_COURRIER)
			expect(ligne?.classified_by).not.toBeNull()
		} finally {
			// LE SEED EST RENDU INTACT : le message redevient non classé, et l'événement de timeline
			// qu'il a produit est retiré. `card_events` n'accorde d'écriture à personne d'autre.
			await page.request.patch(
				`${URL_API}/rest/v1/mail_messages?rfc822_message_id=eq.${encodeURIComponent(MSGID_NON_CLASSE)}`,
				{
					headers: { ...enTetesService(), Prefer: 'return=minimal' },
					data: { card_id: null, classification: 'unclassified', classified_by: null, classified_at: null },
				},
			)
		}
	})

	test('les quatre paliers : trois panneaux au-dessus de 1024 px, une pile en dessous', async ({
		page,
	}) => {
		await connecter(page)
		await page.goto('/inbox')
		await page.getByTestId('inbox-panneau-dossiers').getByRole('button', { name: /Non classés/ }).click()

		for (const palier of PALIERS) {
			await page.setViewportSize({ width: palier.largeur, height: palier.hauteur })
			// LA BARRE LATÉRALE GLISSE HORS CHAMP sous 1024 px, et la capture d'une transition en
			// cours montre un écran que personne ne voit — première version de cette preuve, où le
			// tiroir apparaissait à moitié sorti et le contenu décalé. On attend donc une CONDITION
			// — la barre entièrement dedans, ou entièrement dehors —, jamais un délai arbitraire
			// (`CLAUDE.md` §18).
			const barre = page.getByRole('complementary', { name: 'Barre latérale' })
			let precedente = ''
			await expect
				.poll(async () => {
					const boite = await barre.boundingBox()
					const courante = boite === null ? 'absente' : `${Math.round(boite.x)}x${Math.round(boite.width)}`
					const verdict = courante === precedente ? 'stable' : 'en mouvement'
					precedente = courante
					return verdict
				})
				.toBe('stable')
			const dossiers = page.getByTestId('inbox-panneau-dossiers')
			const liste = page.getByTestId('inbox-panneau-liste')

			if (palier.largeur >= 1024) {
				// LES TROIS PANNEAUX COEXISTENT : c'est la composition du §5.4.
				await expect(dossiers).toBeVisible()
				await expect(liste).toBeVisible()
				await expect(page.getByTestId('inbox-panneau-message')).toBeVisible()
			} else {
				// UNE PILE, PAS TROIS COLONNES RÉTRÉCIES : un seul panneau est montré, et un bouton
				// « Retour » remonte d'un cran.
				await expect(dossiers).toBeHidden()
				await expect(liste).toBeVisible()
				await expect(liste.getByRole('button', { name: 'Retour aux dossiers' })).toBeVisible()
			}
			await capturer(page, `inbox-${palier.nom}`, UNITE)
		}

		// LE RETOUR FONCTIONNE au palier le plus étroit — sinon la pile serait un cul-de-sac.
		await page
			.getByTestId('inbox-panneau-liste')
			.getByRole('button', { name: 'Retour aux dossiers' })
			.click()
		await expect(page.getByTestId('inbox-panneau-dossiers')).toBeVisible()
		await expect(page.getByTestId('inbox-panneau-liste')).toBeHidden()
	})
})
