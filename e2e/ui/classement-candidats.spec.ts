// @verifies CRM-137 (docs/BACKLOG.md) — classer un mail : le sélecteur d'affaire cherchable et la case « Expéditeur connu »,
//           à la souris et au clavier, sur le seed
// @verifies docs/SPEC-mail-subsystem.md §26.3 (l'écran : la case cochée à l'ouverture, la présélection unique, le choix
//           qui survit au filtre), §26.4 (les données), §26.5 (preuves exigées)
// @verifies docs/DESIGN_SYSTEM.md §5.94 (la case, le champ, la liste, la pilule, le choix retenu, les vides et leur
//           action, `Échap`), §7 (les quatre paliers), §10 (clavier) ; docs/JOURNAL.md décisions 877 et 893
// @verifies CLAUDE.md §16 (vérification visuelle)
//
// LE PARCOURS EST FAIT AU CLAVIER ET À LA SOURIS, comme un utilisateur réel : la liste vient de
// `classification_candidates`, sous la RLS de l'administratrice, et aucune réponse n'est substituée.
//
// LES DEUX MESSAGES DU SEED (docs/SPEC-mail-subsystem.md §26.4) : « Point d'avancement — migration ERP », de Léo Marchand,
// contact de la seule affaire `…00c2` (un expéditeur connu), et « Candidature spontanée », de `bizdev@p2enjoy.test`,
// contact d'aucune affaire (un expéditeur inconnu).
//
// CE FICHIER ÉCRIT, ET DÉFAIT :
// - le cas de PLUSIEURS affaires connues rattache Léo à `…00c4` par la clé de service, et retire ce lien dans son
//   `finally` ;
// - le scénario au clavier classe « Candidature spontanée », puis le remet non classé par la clé de service, comme
//   `e2e/ui/inbox.spec.ts` : `mail_messages` n'accorde aucune écriture à `authenticated`. L'événement de timeline
//   demeure, borné et toléré (`e2e/ui/suggestion-classement.spec.ts` le mesure).

import { connecterAvecLeLabs, expect, test, type Page } from './fixtures'
import { URL_API, enTetesService } from '../api/jetons'
import { PALIERS, capturer } from './captures'

const UNITE = 'CRM-137'
const ADMIN = 'admin@p2enjoy.test'
const ESPACE = '5eed0000-0000-4000-8000-000000000001'
const OBJET_LEO = 'Point d’avancement — migration ERP'
const OBJET_INCONNU = 'Candidature spontanée'
const MSGID_INCONNU = '<seed-inbox-non-classe@p2enjoy.test>'
const ADRESSE_INCONNUE = 'bizdev@p2enjoy.test'
const TITRE_LEO = 'Migration ERP Sogexia'
const AFFAIRE_AJOUTEE = '5eed0000-0000-4000-8000-0000000000c4'
const AFFAIRE_VITRINE = '5eed0000-0000-4000-8000-0000000000c1'
const TITRE_VITRINE = 'Refonte du site vitrine'

const option = (page: Page) => page.getByTestId('classement-option')
const champ = (page: Page) => page.getByRole('combobox', { name: 'Rechercher une affaire' })

/** Capture le formulaire de classement, amené dans la vue : sous le message, il est sinon hors de la fenêtre. */
async function capturerLeFormulaire(page: Page, nom: string): Promise<void> {
	await page.getByTestId('inbox-formulaire-classement').scrollIntoViewIfNeeded()
	await capturer(page, nom, UNITE)
}

/** Ouvre un message non classé du seed, puis son formulaire de classement, par le chemin d'un utilisateur. */
async function ouvrirLeFormulaire(page: Page, objet: string): Promise<void> {
	await page.goto('/inbox')
	await page.getByTestId('inbox-panneau-dossiers').getByRole('button', { name: /Non classés/ }).click()
	await page.getByTestId('inbox-panneau-liste').getByTestId('inbox-message').filter({ hasText: objet }).click()
	await expect(page.getByTestId('inbox-message-ouvert')).toBeVisible()
	await page.getByTestId('inbox-classer').click()
	await expect(page.getByTestId('inbox-formulaire-classement')).toBeVisible()
	// La première lecture a répondu : la liste ou son vide est rendu, plus le squelette.
	await expect(page.getByTestId('classement-liste').or(page.getByTestId('classement-vide'))).toBeVisible()
}

/** L'identifiant du contact de Léo, lu : le seed le crée par l'écran, sans identifiant figé. */
async function contactDeLeo(page: Page): Promise<string> {
	const reponse = await page.request.get(
		`${URL_API}/rest/v1/contacts?select=id&email=eq.leo.marchand@sogexia.example`,
		{ headers: enTetesService() },
	)
	const [ligne] = (await reponse.json()) as { id: string }[]
	expect(ligne?.id, 'le seed porte le contact de Léo Marchand').toBeTruthy()
	return ligne?.id ?? ''
}

test.describe('classer un mail : le sélecteur cherchable (docs/DESIGN_SYSTEM.md §5.94)', () => {
	test('expéditeur connu d’une seule affaire : la case est cochée, l’affaire est déjà choisie', async ({ page }) => {
		await connecterAvecLeLabs(page, ADMIN)
		await ouvrirLeFormulaire(page, OBJET_LEO)

		// LA CASE PART COCHÉE, et dit sur quelle adresse elle filtre (§5.94).
		const caseConnu = page.getByTestId('classement-connu')
		await expect(caseConnu).toBeChecked()
		await expect(page.getByTestId('classement-selecteur')).toContainText('leo.marchand@sogexia.example')
		await expect(champ(page)).toBeFocused()

		// UNE SEULE AFFAIRE CONNUE : elle est la seule option, et elle est choisie (§26.3).
		await expect(option(page)).toHaveCount(1)
		await expect(option(page).first()).toContainText(TITRE_LEO)
		await expect(option(page).first()).toContainText(' › ')
		await expect(option(page).first()).toHaveAttribute('aria-selected', 'true')
		await expect(page.getByTestId('classement-choix')).toContainText(`Affaire choisie : ${TITRE_LEO}`)
		await expect(page.getByTestId('inbox-classer-valider')).toBeEnabled()
		// Case cochée, toutes sont connues : la pilule serait du bruit (§5.94).
		await expect(option(page).first().getByRole('img', { name: 'L’expéditeur est un contact de cette affaire' })).toHaveCount(0)
		await capturerLeFormulaire(page, 'classement-connu-preselection-1440')

		// DÉCOCHÉE, la liste montre toutes les affaires, la connue en tête avec sa pilule ; le choix est conservé.
		await caseConnu.uncheck()
		await expect.poll(() => option(page).count()).toBeGreaterThan(1)
		await expect(option(page).first()).toContainText(TITRE_LEO)
		await expect(option(page).first().getByRole('img', { name: 'L’expéditeur est un contact de cette affaire' })).toBeVisible()
		await expect(option(page).nth(1).getByRole('img', { name: 'L’expéditeur est un contact de cette affaire' })).toHaveCount(0)
		await expect(page.getByTestId('classement-choix')).toContainText(TITRE_LEO)
		await capturerLeFormulaire(page, 'classement-toutes-les-affaires-1440')

		// LE CHOIX SURVIT AU FILTRE : une frappe qui fait sortir l'affaire de la liste la laisse nommée (§26.3).
		await champ(page).fill('vitri')
		await expect(option(page).filter({ hasText: TITRE_VITRINE })).toBeVisible()
		await expect(option(page).filter({ hasText: TITRE_LEO })).toHaveCount(0)
		await expect(page.getByTestId('classement-choix')).toContainText(TITRE_LEO)

		// UN TERME SANS RÉPONSE, case cochée : le vide le dit, et propose d'élargir (§5.3 quinquies).
		await caseConnu.check()
		await champ(page).fill('zzz-aucune')
		const vide = page.getByTestId('classement-vide')
		await expect(vide).toContainText('Aucune affaire ne correspond à « zzz-aucune »')
		await expect(page.getByTestId('classement-elargir')).toHaveText('Chercher dans toutes les affaires')
		await capturerLeFormulaire(page, 'classement-terme-sans-reponse-1440')

		// « Annuler » referme sans rien écrire.
		await page.getByRole('button', { name: 'Annuler' }).click()
		await expect(page.getByTestId('inbox-formulaire-classement')).toHaveCount(0)
	})

	test('expéditeur connu de deux affaires : rien n’est présélectionné, un clic choisit', async ({ page }) => {
		await connecterAvecLeLabs(page, ADMIN)
		const contact = await contactDeLeo(page)
		const lien = await page.request.post(`${URL_API}/rest/v1/card_contacts`, {
			headers: { ...enTetesService(), prefer: 'return=minimal' },
			data: { workspace_id: ESPACE, card_id: AFFAIRE_AJOUTEE, contact_id: contact },
		})
		expect(lien.status()).toBe(201)
		try {
			await ouvrirLeFormulaire(page, OBJET_LEO)
			await expect(option(page)).toHaveCount(2)
			// Deux connues : aucune n'est choisie, et « Classer » attend un choix (§5.50).
			await expect(page.getByTestId('classement-choix')).toBeEmpty()
			await expect(page.getByTestId('inbox-classer-valider')).toBeDisabled()
			await expect(option(page).filter({ hasText: TITRE_LEO })).toHaveAttribute('aria-selected', 'false')

			await option(page).filter({ hasText: TITRE_LEO }).click()
			// Un clic choisit, et le focus reste dans le champ (§5.46).
			await expect(champ(page)).toBeFocused()
			await expect(option(page).filter({ hasText: TITRE_LEO })).toHaveAttribute('aria-selected', 'true')
			await expect(page.getByTestId('inbox-classer-valider')).toBeEnabled()
			await capturerLeFormulaire(page, 'classement-deux-connues-1440')
			await page.getByRole('button', { name: 'Annuler' }).click()
		} finally {
			const retrait = await page.request.delete(
				`${URL_API}/rest/v1/card_contacts?card_id=eq.${AFFAIRE_AJOUTEE}&contact_id=eq.${contact}`,
				{ headers: enTetesService() },
			)
			expect(retrait.status()).toBe(204)
		}
	})

	test('AU CLAVIER : le vide de l’expéditeur inconnu, élargir, chercher, choisir, classer', async ({ page }) => {
		await connecterAvecLeLabs(page, ADMIN)
		try {
			await ouvrirLeFormulaire(page, OBJET_INCONNU)
			await expect(champ(page)).toBeFocused()

			// LE VIDE NOMME L'ADRESSE, et porte son action (§5.94).
			await expect(page.getByTestId('classement-vide')).toContainText(`${ADRESSE_INCONNUE} n’est le contact d’aucune affaire.`)
			await capturerLeFormulaire(page, 'classement-expediteur-inconnu-1440')

			// `Tab` mène du champ au bouton du vide ; `Entrée` décoche la case et rend le focus au champ.
			await page.keyboard.press('Tab')
			await expect(page.getByTestId('classement-elargir')).toBeFocused()
			await expect(page.getByTestId('classement-elargir')).toHaveText('Voir toutes les affaires')
			await page.keyboard.press('Enter')
			await expect(page.getByTestId('classement-connu')).not.toBeChecked()
			await expect(champ(page)).toBeFocused()
			await expect.poll(() => option(page).count()).toBeGreaterThan(1)

			// SANS CASSE NI ACCENTS : « VITRÎ » trouve « Refonte du site vitrine » (§26.2).
			await page.keyboard.type('VITRÎ')
			await expect(option(page)).toHaveCount(1)
			await expect(option(page).first()).toContainText(TITRE_VITRINE)

			// `Entrée` sans option active n'envoie rien ; les flèches activent, `Entrée` choisit (§5.94).
			await page.keyboard.press('Enter')
			await expect(page.getByTestId('inbox-formulaire-classement')).toBeVisible()
			await expect(page.getByTestId('classement-choix')).toBeEmpty()
			await page.keyboard.press('ArrowDown')
			await expect(option(page).first()).toHaveAttribute('data-actif', 'oui')
			const idActif = await option(page).first().getAttribute('id')
			await expect(champ(page)).toHaveAttribute('aria-activedescendant', idActif ?? '')
			await page.keyboard.press('Enter')
			await expect(option(page).first()).toHaveAttribute('aria-selected', 'true')
			await expect(page.getByTestId('classement-choix')).toContainText(`Affaire choisie : ${TITRE_VITRINE}`)
			await expect(page.getByTestId('inbox-formulaire-classement')).toBeVisible()
			await capturerLeFormulaire(page, 'classement-clavier-choix-1440')

			// `Tab` mène à « Classer », `Entrée` l'envoie.
			await page.keyboard.press('Tab')
			await expect(page.getByTestId('inbox-classer-valider')).toBeFocused()
			await page.keyboard.press('Enter')
			await expect(page.getByTestId('inbox-pilule-card')).toHaveText(TITRE_VITRINE)

			// L'EFFET EST RELU PAR L'API, avec la clé de service.
			const reponse = await page.request.get(
				`${URL_API}/rest/v1/mail_messages?select=classification,card_id&rfc822_message_id=eq.${encodeURIComponent(MSGID_INCONNU)}`,
				{ headers: enTetesService() },
			)
			const [ligne] = (await reponse.json()) as { classification: string; card_id: string }[]
			expect(ligne?.classification).toBe('manual')
			expect(ligne?.card_id).toBe(AFFAIRE_VITRINE)
		} finally {
			await page.request.patch(
				`${URL_API}/rest/v1/mail_messages?rfc822_message_id=eq.${encodeURIComponent(MSGID_INCONNU)}`,
				{
					headers: { ...enTetesService(), Prefer: 'return=minimal' },
					data: { card_id: null, classification: 'unclassified', classified_by: null, classified_at: null },
				},
			)
		}
	})

	test('AU CLAVIER : `Échap` referme le formulaire et rend le focus à « Classer dans une affaire »', async ({ page }) => {
		await connecterAvecLeLabs(page, ADMIN)
		await ouvrirLeFormulaire(page, OBJET_LEO)
		await expect(champ(page)).toBeFocused()
		await page.keyboard.press('Escape')
		await expect(page.getByTestId('inbox-formulaire-classement')).toHaveCount(0)
		await expect(page.getByTestId('inbox-classer')).toBeFocused()
		// Rouvert, la case repart cochée : son état n'est gardé nulle part (`CLAUDE.md` §11).
		await page.keyboard.press('Enter')
		await expect(page.getByTestId('classement-connu')).toBeChecked()
	})

	test('les quatre paliers : le formulaire tient dans le panneau, sans défilement horizontal', async ({ page }) => {
		await connecterAvecLeLabs(page, ADMIN)
		for (const palier of PALIERS) {
			await page.setViewportSize({ width: palier.largeur, height: palier.hauteur })
			await ouvrirLeFormulaire(page, OBJET_LEO)
			await page.getByTestId('classement-connu').uncheck()
			await expect.poll(() => option(page).count()).toBeGreaterThan(1)
			// LA PAGE NE DÉFILE JAMAIS HORIZONTALEMENT (§7).
			const debord = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
			expect(debord, `débordement horizontal à ${palier.largeur} px`).toBeLessThanOrEqual(0)
			// La liste défile en elle-même, bornée à 20rem (§5.94).
			const hauteur = await page.getByTestId('classement-liste').evaluate((n) => n.getBoundingClientRect().height)
			expect(hauteur).toBeLessThanOrEqual(20 * 16 + 2)
			await capturerLeFormulaire(page, `classement-${palier.nom}`)
		}
	})
})
