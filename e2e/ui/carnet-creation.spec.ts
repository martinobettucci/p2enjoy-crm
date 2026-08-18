// @verifies CRM-060 (docs/BACKLOG.md) — tranche 4 sous-tranche 4e : la création d'un contact
//            depuis le carnet
// @verifies docs/SPEC-contacts.md §14.5 (contrat de comportement, cas a, b, e, i), §14.6
//            (l'écran ne calcule aucun droit : la lectrice reçoit un refus TRADUIT),
//            §14.8 (preuves exigées)
// @verifies docs/DESIGN_SYSTEM.md §5.23 (le formulaire dans le flux du carnet)
//
// LE SEED EST RENDU INTACT (§14.8) : le contact créé par le scénario est SUPPRIMÉ par l'API à la
// fin, avec un filet de sécurité en `afterAll`. `apply-seed.sh` échoue si le carnet ne compte pas
// exactement trois contacts, et la suite ne doit pas être ce qui casse cette garde.

import { expect, test, type Page } from '@playwright/test'
import { CLE_ANONYME, MOT_DE_PASSE_SEED, URL_API, jetonDe } from '../api/jetons'
import { PALIERS, capturer } from './captures'

const UNITE = 'CRM-060'
const ADMIN = 'admin@p2enjoy.test'
const LECTRICE = 'viewer@p2enjoy.test'
const NOM_CREE = 'Contact de preuve 4e'

async function connecter(page: Page, email = ADMIN): Promise<void> {
	await page.goto('/connexion')
	await page.getByLabel('Adresse email').click()
	await page.keyboard.type(email)
	await page.keyboard.press('Tab')
	await page.keyboard.type(MOT_DE_PASSE_SEED)
	await page.keyboard.press('Enter')
	await expect(page.getByRole('button', { name: 'Se déconnecter' })).toBeVisible()
}

/** Rend le seed intact : supprime le contact de preuve s'il existe encore. */
async function supprimerContactDePreuve(): Promise<void> {
	const jeton = await jetonDe(ADMIN)
	await fetch(`${URL_API}/rest/v1/contacts?full_name=eq.${encodeURIComponent(NOM_CREE)}`, {
		method: 'DELETE',
		headers: { apikey: CLE_ANONYME, Authorization: `Bearer ${jeton}` },
	})
}

test.afterAll(async () => {
	await supprimerContactDePreuve()
})

test.describe('Création d’un contact depuis le carnet — CRM-060 §14', () => {
	test('a, b et e — le geste ouvre le formulaire, le focus y entre, et la ligne rejoint le tableau', async ({
		page,
	}) => {
		await supprimerContactDePreuve()
		await connecter(page)
		await page.goto('/contacts')

		// cas a — un seul geste, replié
		const ouvrir = page.getByTestId('ouvrir-creation-contact')
		await expect(ouvrir).toBeVisible()
		await expect(page.getByTestId('formulaire-creation-contact')).toHaveCount(0)
		await capturer(page, 'carnet-creation-replie-1440', UNITE)

		// cas b — le formulaire s'ouvre et le focus ENTRE sur le champ du nom
		await ouvrir.click()
		const champNom = page.getByTestId('champ-nom-contact')
		await expect(champNom).toBeFocused()
		await capturer(page, 'carnet-creation-formulaire-1440', UNITE)

		// cas e — la ligne créée rejoint le tableau à sa place de tri, le formulaire se referme
		await page.keyboard.type(NOM_CREE)
		await page.getByTestId('envoyer-creation-contact').click()
		await expect(page.getByTestId('formulaire-creation-contact')).toHaveCount(0)
		await expect(page.getByTestId('tableau-contacts')).toContainText(NOM_CREE)
		await capturer(page, 'carnet-creation-ligne-1440', UNITE)

		await supprimerContactDePreuve()
	})

	test('i — la lectrice voit le geste, envoie, et reçoit le refus TRADUIT avec sa saisie conservée', async ({
		page,
	}) => {
		const erreurs: string[] = []
		page.on('pageerror', (erreur) => erreurs.push(erreur.message))
		await connecter(page, LECTRICE)
		await page.goto('/contacts')

		// AUCUNE COMMANDE N'EST ÉTEINTE D'AVANCE (§14.6) : la lectrice voit le geste et peut l'ouvrir.
		await page.getByTestId('ouvrir-creation-contact').click()
		await page.getByTestId('champ-nom-contact').fill('Refus attendu')
		await page.getByTestId('envoyer-creation-contact').click()

		const refus = page.getByTestId('refus-creation-contact')
		await expect(refus).toBeVisible()
		await expect(refus).toHaveText(
			'Votre rôle ne permet pas de créer un contact dans cet espace de travail.',
		)
		// LA SAISIE EST CONSERVÉE : elle est ce qu'il faut corriger.
		await expect(page.getByTestId('champ-nom-contact')).toHaveValue('Refus attendu')
		await capturer(page, 'carnet-creation-refus-1440', UNITE)
		expect(erreurs).toEqual([])
	})

	test('les quatre paliers du formulaire ouvert', async ({ page }) => {
		await connecter(page)
		await page.goto('/contacts')
		await page.getByTestId('ouvrir-creation-contact').click()
		for (const palier of PALIERS) {
			await page.setViewportSize({ width: palier.largeur, height: palier.hauteur })
			await capturer(page, `carnet-creation-${palier.nom}`, UNITE)
		}
	})
})
