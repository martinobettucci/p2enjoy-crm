// @verifies CRM-058 (docs/BACKLOG.md) — composer depuis la card et répondre depuis l'inbox
// @verifies docs/SPEC-mail-subsystem.md §19.6 (le même chemin de code), §19.7 (preuves exigées)
// @verifies docs/DESIGN_SYSTEM.md §5.8 (états), §10 (clavier) ; CLAUDE.md §16
//
// LE PARCOURS EST FAIT AU CLAVIER ET À LA SOURIS, et l'effet est relu par l'API : un geste prouvé
// sur l'écran seul ne prouverait que l'écran.
//
// L'ÉCRAN MET EN FILE, IL N'ENVOIE PAS. Ces scénarios ne déclenchent donc aucun worker : ce qu'ils
// mesurent, c'est que la file reçoit la bonne ligne. L'aller-retour réel est prouvé par
// `e2e/mail/envoi.spec.ts`, qui soumet pour de bon.

import { expect, test, type Page } from './fixtures'
import { MOT_DE_PASSE_SEED, URL_API, enTetesService } from '../api/jetons'
import { capturer } from './captures'

const UNITE = 'CRM-058'
const ADMIN = 'admin@p2enjoy.test'
const CARD = '5eed0000-0000-4000-8000-0000000000c1'
const ADRESSE_CARD = `/tracks/conseil-ia/grands-comptes/cards/${CARD}`

type LigneFile = {
	id: string
	subject: string
	to_addrs: string[]
	status: string
	in_reply_to_message_id: string | null
}

async function connecter(page: Page): Promise<void> {
	await page.goto('/connexion')
	await page.getByLabel('Adresse email').click()
	await page.keyboard.type(ADMIN)
	await page.keyboard.press('Tab')
	await page.keyboard.type(MOT_DE_PASSE_SEED)
	await page.keyboard.press('Enter')
	await expect(page.getByRole('button', { name: 'Se déconnecter' })).toBeVisible()
}

async function lireFile(page: Page, objet: string): Promise<LigneFile[]> {
	const reponse = await page.request.get(
		`${URL_API}/rest/v1/mail_outbox?select=id,subject,to_addrs,status,in_reply_to_message_id&subject=eq.${encodeURIComponent(objet)}`,
		{ headers: enTetesService() },
	)
	return (await reponse.json()) as LigneFile[]
}

async function viderLaFile(page: Page, objet: string): Promise<void> {
	// LE SEED EST RENDU INTACT : la ligne créée par le scénario est retirée par la clé de service,
	// seul chemin qui le peut — la file n'accorde aucune écriture à `authenticated`.
	await page.request.delete(
		`${URL_API}/rest/v1/mail_outbox?subject=eq.${encodeURIComponent(objet)}`,
		{ headers: enTetesService() },
	)
}

test.describe('composer et répondre (docs/SPEC-mail-subsystem.md §19.6)', () => {
	test('depuis la CARD : le message part en file, avec ses destinataires', async ({ page }) => {
		const objet = `Depuis la card ${Date.now()}`
		await connecter(page)
		await page.goto(ADRESSE_CARD)

		try {
			await page.getByTestId('envoi-ouvrir').click()
			const formulaire = page.getByTestId('envoi-formulaire')
			await expect(formulaire).toBeVisible()
			// Le focus part sur le premier champ : sans cela, le clavier repartirait du début du
			// document après la disparition du bouton.
			await expect(page.getByLabel('Expédier depuis')).toBeFocused()

			await page.getByLabel('Destinataires').fill('client@exterieur.test, copie@exterieur.test')
			await page.getByLabel('Objet').fill(objet)
			await page.getByLabel('Message').fill('Bonjour,\n\nVoici notre proposition.')
			await capturer(page, 'envoi-depuis-la-card-1440', UNITE)
			await page.getByTestId('envoi-valider').click()

			// L'ÉCRAN ANNONCE « MIS EN FILE », JAMAIS « ENVOYÉ » : le worker n'a pas encore parlé.
			await expect(page.getByTestId('envoi-confirmation')).toContainText('mis en file')

			const lignes = await lireFile(page, objet)
			expect(lignes).toHaveLength(1)
			expect(lignes[0]?.status).toBe('queued')
			// LA VIRGULE SÉPARE, ET LES DEUX ADRESSES SONT LÀ : une saisie mal découpée aurait
			// produit un destinataire unique et illisible.
			expect(lignes[0]?.to_addrs).toEqual(['client@exterieur.test', 'copie@exterieur.test'])
			expect(lignes[0]?.in_reply_to_message_id).toBeNull()
		} finally {
			await viderLaFile(page, objet)
		}
	})

	test('une saisie incomplète est dite AVANT tout aller-retour', async ({ page }) => {
		await connecter(page)
		await page.goto(ADRESSE_CARD)

		await page.getByTestId('envoi-ouvrir').click()
		await page.getByLabel('Objet').fill('Sans destinataire ni corps')
		await page.getByTestId('envoi-valider').click()

		await expect(page.getByRole('alert')).toContainText('Choisissez une adresse d’expédition')
		// LE FORMULAIRE RESTE OUVERT ET LE TEXTE EST CONSERVÉ : un refus ne fait jamais perdre ce
		// qu'on a écrit.
		await expect(page.getByLabel('Objet')).toHaveValue('Sans destinataire ni corps')
	})

	test('depuis l’INBOX : répondre vise la même affaire et cite le message', async ({ page }) => {
		await connecter(page)
		await page.goto('/inbox')

		const objetLu = 'Demande de devis — refonte'
		let objetReponse = ''
		try {
			await page
				.getByTestId('inbox-panneau-dossiers')
				.getByRole('button', { name: /Refonte du site vitrine/ })
				.click()
			await page
				.getByTestId('inbox-panneau-liste')
				.getByTestId('inbox-message')
				.filter({ hasText: objetLu })
				.click()
			await expect(page.getByTestId('inbox-message-ouvert')).toBeVisible()

			// LE MÊME COMPOSANT QUE DEPUIS LA CARD, avec un libellé qui dit ce qu'on fait.
			await page.getByTestId('envoi-ouvrir').click()
			// LE DESTINATAIRE ET L'OBJET SONT PRÉ-REMPLIS : répondre, c'est répondre à quelqu'un.
			await expect(page.getByLabel('Destinataires')).toHaveValue('bizdev@p2enjoy.test')
			objetReponse = await page.getByLabel('Objet').inputValue()
			expect(objetReponse).toBe(`Re: ${objetLu}`)

			// LE FORMULAIRE EST DÉSIGNÉ EXPLICITEMENT : dans l'inbox, « Message » nomme aussi un
			// panneau et une liste, et un libellé ambigu ferait échouer la preuve sur une
			// ressemblance de mots plutôt que sur le produit.
			await page
				.getByTestId('envoi-formulaire')
				.getByLabel('Message')
				.fill('Bien reçu, nous revenons vers vous.')
			await capturer(page, 'envoi-reponse-depuis-inbox-1440', UNITE)
			await page.getByTestId('envoi-valider').click()
			await expect(page.getByTestId('envoi-confirmation')).toContainText('mis en file')

			const lignes = await lireFile(page, objetReponse)
			expect(lignes).toHaveLength(1)
			// LA RÉPONSE PORTE SON PARENT : c'est ce dont le worker tirera `In-Reply-To` et la
			// chaîne `References`, donc ce qui empêchera le fil de se couper.
			expect(lignes[0]?.in_reply_to_message_id).not.toBeNull()
		} finally {
			if (objetReponse !== '') await viderLaFile(page, objetReponse)
		}
	})

	test('un message NON CLASSÉ n’offre pas de réponse : il n’a pas d’affaire', async ({ page }) => {
		await connecter(page)
		await page.goto('/inbox')

		await page
			.getByTestId('inbox-panneau-dossiers')
			.getByRole('button', { name: /Non classés/ })
			.click()
		await page
			.getByTestId('inbox-panneau-liste')
			.getByTestId('inbox-message')
			.filter({ hasText: 'Candidature spontanée' })
			.click()
		await expect(page.getByTestId('inbox-message-ouvert')).toBeVisible()

		// AUCUNE ACTION QUI ÉCHOUERAIT : sans affaire, il n'y a pas d'adresse de retour, et la
		// garde refuserait. L'écran propose le classement à la place.
		await expect(page.getByTestId('envoi-ouvrir')).toHaveCount(0)
		await expect(page.getByTestId('inbox-classer')).toBeVisible()
	})
})
