// @verifies CRM-139 (docs/BACKLOG.md) — « Seulement moi » dans l'inbox, à la souris et au clavier, sur le seed : la case
//           cochée par défaut et les compteurs qui la suivent ; le vide sous le filtre et son action ; la case décochée
//           dans l'adresse ; la personne sans identité (case désactivée, explication, lien) ; l'adresse d'un message caché
//           qui décoche la case ; les quatre paliers
// @verifies docs/SPEC-mail-subsystem.md §27.4, §27.5, §27.6 ; docs/DESIGN_SYSTEM.md §5.96, §7 (paliers), §8 (clavier) ;
//           docs/JOURNAL.md décisions 879 et 902 ; CLAUDE.md §16 (vérification visuelle)
//
// LE SEED DÉMONTRE L'UNITÉ SANS CHANGEMENT (§27.5) : Camille (admin) a une identité, `admin@p2enjoy.test`, d'où est parti
// l'envoi de démonstration classé dans « Refonte du monitoring — Vertuo » ; « Candidature spontanée », adressée à la seule
// boîte système, ne la concerne pas. La lectrice n'a aucune identité. CE FICHIER N'ÉCRIT RIEN.

import { connecterAvecLeLabs, expect, test, type Page } from './fixtures'
import { URL_API, enTetesService } from '../api/jetons'
import { PALIERS, capturer } from './captures'

const UNITE = 'CRM-139'
const ADMIN = 'admin@p2enjoy.test'
const LECTRICE = 'viewer@p2enjoy.test'
const AFFAIRE_ENVOI = 'Refonte du monitoring — Vertuo'
const OBJET_ENVOI = 'Proposition de refonte du monitoring'
const OBJET_NON_CLASSE = 'Candidature spontanée'
const MSGID_NON_CLASSE = '<seed-inbox-non-classe@p2enjoy.test>'

const dossiers = (page: Page) => page.getByTestId('inbox-panneau-dossiers')
const liste = (page: Page) => page.getByTestId('inbox-panneau-liste')
const caseMoi = (page: Page) => page.getByTestId('inbox-seulement-moi')

/** Attend que la case soit active : la présence d'une identité est lue. */
async function caseLue(page: Page): Promise<void> {
	await expect(caseMoi(page)).toBeEnabled()
}

test.describe('« Seulement moi » (docs/DESIGN_SYSTEM.md §5.96)', () => {
	test('cochée par défaut : seul son courrier est compté et listé, et le vide de « Non classés » porte son action', async ({ page }) => {
		await connecterAvecLeLabs(page, ADMIN)
		await page.goto('/inbox')
		await caseLue(page)
		await expect(caseMoi(page)).toBeChecked()

		// LES COMPTEURS SUIVENT : son affaire porte son seul envoi ; « Non classés » est rendu, à zéro.
		const affaire = dossiers(page).getByRole('button', { name: new RegExp(AFFAIRE_ENVOI) })
		await expect(affaire).toBeVisible()
		await expect(dossiers(page).getByRole('button', { name: /Refonte du site vitrine/ })).toHaveCount(0)
		await capturer(page, 'seulement-moi-dossiers-1440', UNITE)

		await affaire.click()
		await expect(liste(page).getByTestId('inbox-message')).toHaveCount(1)
		await expect(liste(page).getByTestId('inbox-message').first()).toContainText(OBJET_ENVOI)
		await capturer(page, 'seulement-moi-liste-1440', UNITE)

		await dossiers(page).getByRole('button', { name: /Non classés/ }).click()
		await expect(liste(page).getByText('Aucun message de ce dossier ne vous concerne')).toBeVisible()
		await expect(liste(page).getByText(OBJET_NON_CLASSE)).toHaveCount(0)
		await capturer(page, 'seulement-moi-vide-1440', UNITE)

		// L'ACTION DU VIDE décoche la case, et le courrier qui ne la concerne pas réapparaît.
		await page.getByTestId('inbox-seulement-moi-tout').click()
		await expect(caseMoi(page)).not.toBeChecked()
		await expect(page).toHaveURL(/courrier=tous/)
		await expect(liste(page).getByText(OBJET_NON_CLASSE)).toBeVisible()
		await expect(dossiers(page).getByRole('button', { name: /Refonte du site vitrine/ })).toBeVisible()
	})

	test('AU CLAVIER : la case se décoche et se recoche à l’Espace, et l’adresse la garde au rechargement', async ({ page }) => {
		await connecterAvecLeLabs(page, ADMIN)
		await page.goto('/inbox')
		await caseLue(page)
		await caseMoi(page).focus()
		await expect(caseMoi(page)).toBeFocused()
		await page.keyboard.press('Space')
		await expect(caseMoi(page)).not.toBeChecked()
		await expect(page).toHaveURL(/\?courrier=tous$/)
		await expect(dossiers(page).getByRole('button', { name: /Refonte du site vitrine/ })).toBeVisible()

		// LE RECHARGEMENT GARDE CE QU'ON REGARDAIT : l'état vit dans l'adresse.
		await page.reload()
		await caseLue(page)
		await expect(caseMoi(page)).not.toBeChecked()

		await caseMoi(page).focus()
		await page.keyboard.press('Space')
		await expect(caseMoi(page)).toBeChecked()
		await expect(page).not.toHaveURL(/courrier=/)
		await expect(dossiers(page).getByRole('button', { name: /Refonte du site vitrine/ })).toHaveCount(0)
	})

	test('SANS IDENTITÉ : la case est décochée, désactivée, explique, et son lien mène aux identités sortantes', async ({ page }) => {
		await connecterAvecLeLabs(page, LECTRICE)
		await page.goto('/inbox')
		const explication = page.getByTestId('inbox-seulement-moi-explication')
		await expect(explication).toContainText('Aucune adresse d’expédition personnelle : tous les mails sont affichés.')
		await expect(caseMoi(page)).toBeDisabled()
		await expect(caseMoi(page)).not.toBeChecked()
		await expect(caseMoi(page)).toHaveAttribute('aria-describedby', (await explication.getAttribute('id')) ?? '')
		await capturer(page, 'seulement-moi-sans-identite-1440', UNITE)

		// AU CLAVIER : le lien est atteignable et mène à l'écran où la personne déclare sa propre identité.
		const lien = explication.getByRole('link', { name: 'Ajouter une adresse d’expédition' })
		await lien.focus()
		await page.keyboard.press('Enter')
		await expect(page).toHaveURL(/\/reglages\/identites-mail$/)
	})

	test('L’ADRESSE D’UN MESSAGE QUI NE LA CONCERNE PAS l’emporte : le message s’ouvre et la case passe décochée', async ({ page }) => {
		await connecterAvecLeLabs(page, ADMIN)
		const reponse = await page.request.get(
			`${URL_API}/rest/v1/mail_messages?select=id&rfc822_message_id=eq.${encodeURIComponent(MSGID_NON_CLASSE)}`,
			{ headers: enTetesService() },
		)
		const [ligne] = (await reponse.json()) as { id: string }[]
		expect(ligne?.id, 'le seed porte « Candidature spontanée »').toBeTruthy()
		await page.goto(`/inbox?message=${ligne?.id ?? ''}`)
		await expect(page.getByTestId('inbox-message-ouvert').getByRole('heading', { name: OBJET_NON_CLASSE })).toBeVisible()
		await expect(page).toHaveURL(/courrier=tous/)
		await expect(caseMoi(page)).not.toBeChecked()
		await expect(liste(page).getByText(OBJET_NON_CLASSE)).toBeVisible()
	})

	test('les quatre paliers : la case tient dans l’en-tête des dossiers, sans défilement horizontal', async ({ page }) => {
		await connecterAvecLeLabs(page, ADMIN)
		for (const palier of PALIERS) {
			await page.setViewportSize({ width: palier.largeur, height: palier.hauteur })
			await page.goto('/inbox')
			await caseLue(page)
			await expect(caseMoi(page)).toBeVisible()
			// Une seule ligne d'en-tête : la case et son libellé ne passent pas sous le titre.
			const entete = dossiers(page).locator('div').first()
			const hauteur = await entete.evaluate((n) => n.getBoundingClientRect().height)
			expect(hauteur, `en-tête des dossiers à ${palier.largeur} px`).toBeLessThanOrEqual(64)
			const debord = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
			expect(debord, `débordement horizontal à ${palier.largeur} px`).toBeLessThanOrEqual(0)
			await capturer(page, `seulement-moi-${palier.nom}`, UNITE)
		}
	})
})
