// @verifies CRM-060 (docs/BACKLOG.md) — sous-tranche 2 bis : la SURFACE de la suggestion
// @verifies docs/SPEC-contacts.md §8.8.2 (où le bloc s'ancre), §8.8.4 (les quatre états),
//           §8.8.5 (l'affaire nommée et adressable, la règle écrite), §8.8.6 (le geste appelle
//           `classify_message`), §8.8.9 (contrat de comportement, cas b, c, e, f, i),
//           §8.8.11 (preuves exigées)
// @verifies docs/DESIGN_SYSTEM.md §5.4 ter (de quoi le bloc a l'air), §7 (les quatre paliers)
// @verifies docs/SPEC-seed.md §2.19 (le quatrième message, réellement reçu)
// @verifies CLAUDE.md §16 (vérification visuelle)
//
// LE PARCOURS EST FAIT AU CLAVIER ET À LA SOURIS, comme un utilisateur réel : aucune fonction
// interne n'est appelée, aucune réponse n'est substituée. Le courrier vient du seed — le quatrième
// message, RÉELLEMENT soumis par la boîte du correspondant puis relevé, qui arrive non classé ET
// suggéré parce que son expéditeur est un contact du workspace.
//
// LE SEED EST REMIS DANS SON ÉTAT, SAUF SUR UN POINT QUI EST NOMMÉ. Le scénario qui accepte la
// suggestion **remet** le message non classé par la clé de service dans son `finally` — le seul
// chemin qui le puisse, `mail_messages` n'accordant aucune écriture à `authenticated`.
//
// L'ÉVÉNEMENT DE TIMELINE, LUI, DEMEURE, ET C'EST MESURÉ : `card_events` n'accorde d'écriture à
// PERSONNE, pas même à la clé de service — un `DELETE` y rend **403** (mesuré le 2026-08-20), et
// c'est exactement la garantie que `CRM-044` a posée. L'affaire suggérée garde donc un
// `mail_received` de plus après ce parcours. La dérive est bornée et tolérée par construction : les
// compteurs d'événements de `scripts/verify-seed-demo.sh` sont des **minorants**, et seul le compte
// des `created` est exact. L'écart est écrit ici et au §8.8.10 plutôt que masqué par une
// affirmation de restauration qui serait fausse.

import { expect, test, type Page } from './fixtures'
import { MOT_DE_PASSE_SEED, URL_API, enTetesService } from '../api/jetons'
import { PALIERS, capturer } from './captures'

const UNITE = 'CRM-060'
// LA SUGGESTION N'EST VISIBLE QUE DE L'ADMINISTRATRICE, et ce n'est pas un choix d'écran : un
// message non classé de la boîte système n'est lisible que des administrateurs du workspace
// (docs/SPEC-mail-subsystem.md §18.1). Mesuré : Driss et Farida reçoivent `200` et zéro ligne.
const ADMIN = 'admin@p2enjoy.test'
const OBJET_SUGGERE = 'Point d’avancement — migration ERP'
const OBJET_SANS_SUGGESTION = 'Candidature spontanée'
const MSGID_SUGGERE = '<seed-inbox-suggere@sogexia.example>'
const CARD_SUGGEREE = '5eed0000-0000-4000-8000-0000000000c2'
const TITRE_SUGGEREE = 'Migration ERP Sogexia'

async function connecter(page: Page): Promise<void> {
	await page.goto('/connexion')
	await page.getByLabel('Adresse email').click()
	await page.keyboard.type(ADMIN)
	await page.keyboard.press('Tab')
	await page.keyboard.type(MOT_DE_PASSE_SEED)
	await page.keyboard.press('Enter')
	await expect(page.getByRole('button', { name: 'Se déconnecter' })).toBeVisible()
}

/** Ouvre le message suggéré du seed, par le chemin qu'un utilisateur emprunte. */
async function ouvrirLeMessageSuggere(page: Page): Promise<void> {
	await page.goto('/inbox')
	await page.getByTestId('inbox-panneau-dossiers').getByRole('button', { name: /Non classés/ }).click()
	await page
		.getByTestId('inbox-panneau-liste')
		.getByTestId('inbox-message')
		.filter({ hasText: OBJET_SUGGERE })
		.click()
	await expect(page.getByTestId('inbox-message-ouvert')).toBeVisible()
}

test.describe('la suggestion de classement (docs/SPEC-contacts.md §8.8)', () => {
	test('cas c — le bloc nomme l’affaire suggérée, l’adresse, et écrit la règle', async ({ page }) => {
		await connecter(page)
		await ouvrirLeMessageSuggere(page)

		const bloc = page.getByTestId('inbox-suggestion')
		await expect(bloc).toBeVisible()

		// L'AFFAIRE EST NOMMÉE **ET** ADRESSABLE (§8.8.5) : vérifier une suggestion suppose de
		// pouvoir ouvrir l'affaire qu'elle désigne. Le lien porte le chemin complet, track et
		// channel compris — que ni la liste ni l'arborescence ne portent.
		const lien = bloc.getByTestId('inbox-suggestion-card')
		await expect(lien).toHaveText(TITRE_SUGGEREE)
		await expect(lien).toHaveAttribute('href', new RegExp(`/cards/${CARD_SUGGEREE}$`))

		// LA RÈGLE EST ÉCRITE EN TOUTES LETTRES : sans elle, l'utilisateur lirait un nom d'affaire
		// sans savoir d'où il sort.
		await expect(bloc).toContainText('L’expéditeur est un contact rattaché à cette affaire.')

		// LE BLOC S'ANCRE AU-DESSUS DE LA COMMANDE MANUELLE (§8.8.2), qui reste offerte (cas i).
		await expect(page.getByTestId('inbox-classer')).toBeVisible()

		await capturer(page, 'inbox-suggestion-1440', UNITE)
	})

	test('cas b — un message sans suggestion ne rend aucun bloc : le témoin', async ({ page }) => {
		await connecter(page)
		await page.goto('/inbox')
		await page.getByTestId('inbox-panneau-dossiers').getByRole('button', { name: /Non classés/ }).click()
		await page
			.getByTestId('inbox-panneau-liste')
			.getByTestId('inbox-message')
			.filter({ hasText: OBJET_SANS_SUGGESTION })
			.click()
		await expect(page.getByTestId('inbox-message-ouvert')).toBeVisible()

		// LE TÉMOIN EST CE QUI REND CETTE PREUVE NON COMPLAISANTE : un bloc rendu sur TOUT message
		// non classé passerait le scénario précédent sans rien prouver de la règle 3.
		await expect(page.getByTestId('inbox-suggestion')).toHaveCount(0)
		await expect(page.getByTestId('inbox-classer')).toBeVisible()

		await capturer(page, 'inbox-sans-suggestion-1440', UNITE)
	})

	test('cas e et f — accepter la suggestion AU CLAVIER classe le message, et l’écran le montre', async ({
		page,
	}) => {
		await connecter(page)
		try {
			await ouvrirLeMessageSuggere(page)

			// AU CLAVIER, sans souris : le §8 ne connaît pas d'exception à la parité.
			const accepter = page.getByTestId('inbox-suggestion-accepter')
			await accepter.focus()
			await expect(accepter).toBeFocused()
			await page.keyboard.press('Enter')

			// L'ÉCRAN RELIT TOUT CE QUI A CHANGÉ (§8.8.6) : le message porte désormais son affaire,
			// et le bloc de suggestion disparaît avec le visage « non classé » du pied.
			await expect(page.getByTestId('inbox-pilule-card')).toHaveText(TITRE_SUGGEREE)
			await expect(page.getByTestId('inbox-suggestion')).toHaveCount(0)
			await capturer(page, 'inbox-suggestion-acceptee-1440', UNITE)

			// ET L'EFFET EST RELU PAR L'API, avec la clé de service : un geste prouvé sur l'écran
			// seul ne prouverait que l'écran.
			const reponse = await page.request.get(
				`${URL_API}/rest/v1/mail_messages?select=classification,card_id,classified_by,suggested_card_id&rfc822_message_id=eq.${encodeURIComponent(MSGID_SUGGERE)}`,
				{ headers: enTetesService() },
			)
			const [ligne] = (await reponse.json()) as {
				classification: string
				card_id: string
				classified_by: string | null
				suggested_card_id: string | null
			}[]
			// LE CLASSEMENT EST « manual » ET NON « auto » : accepter une suggestion est un geste
			// humain, et la règle 3 n'a jamais classé (§8.1).
			expect(ligne?.classification).toBe('manual')
			expect(ligne?.card_id).toBe(CARD_SUGGEREE)
			expect(ligne?.classified_by).not.toBeNull()
			// L'INDICE RESTE ÉCRIT SUR LA LIGNE : la sous-tranche ne l'efface pas (§8.8.10).
			expect(ligne?.suggested_card_id).toBe(CARD_SUGGEREE)

			// LE MESSAGE A QUITTÉ « NON CLASSÉS » — c'est le cas f, et il se lit à l'écran.
			await page.goto('/inbox')
			await page
				.getByTestId('inbox-panneau-dossiers')
				.getByRole('button', { name: /Non classés/ })
				.click()
			await expect(
				page.getByTestId('inbox-panneau-liste').getByTestId('inbox-message').filter({ hasText: OBJET_SUGGERE }),
			).toHaveCount(0)
		} finally {
			// LE MESSAGE REDEVIENT NON CLASSÉ. L'événement de timeline, lui, RESTE : aucun appelant
			// ne peut le retirer (403 mesuré), et prétendre le contraire serait la simulation que
			// `CLAUDE.md` §18 interdit. Voir l'en-tête de ce fichier et le §8.8.10.
			await page.request.patch(
				`${URL_API}/rest/v1/mail_messages?rfc822_message_id=eq.${encodeURIComponent(MSGID_SUGGERE)}`,
				{
					headers: { ...enTetesService(), Prefer: 'return=minimal' },
					data: { card_id: null, classification: 'unclassified', classified_by: null, classified_at: null },
				},
			)
		}
	})

	test('les quatre paliers : le bloc reste lisible et la page ne défile jamais en largeur', async ({
		page,
	}) => {
		await connecter(page)
		await ouvrirLeMessageSuggere(page)

		for (const palier of PALIERS) {
			await page.setViewportSize({ width: palier.largeur, height: palier.hauteur })

			// LA BARRE LATÉRALE GLISSE HORS CHAMP sous 1024 px : on attend une CONDITION — la barre
			// stable —, jamais un délai arbitraire (`CLAUDE.md` §18). Même remède qu'à
			// `inbox.spec.ts`, et pour le même défaut mesuré.
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

			// Sous 1024 px l'écran est une PILE, et le panneau de lecture est celui qui est montré :
			// c'est là que le bloc vit.
			const bloc = page.getByTestId('inbox-suggestion')
			await expect(bloc).toBeVisible()
			await expect(bloc.getByTestId('inbox-suggestion-card')).toHaveText(TITRE_SUGGEREE)
			await expect(page.getByTestId('inbox-suggestion-accepter')).toBeVisible()

			// LA PAGE NE DÉFILE JAMAIS HORIZONTALEMENT (docs/DESIGN_SYSTEM.md §7), et c'est mesuré
			// plutôt qu'espéré : un bloc qui pousserait le document hors du cadre passerait toutes
			// les assertions ci-dessus sans qu'on le voie.
			const debordement = await page.evaluate(
				() => document.documentElement.scrollWidth - document.documentElement.clientWidth,
			)
			expect(debordement).toBeLessThanOrEqual(0)

			await capturer(page, `inbox-suggestion-${palier.nom}`, UNITE)
		}
	})
})
