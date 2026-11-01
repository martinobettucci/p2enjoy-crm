// @verifies CRM-124 (docs/BACKLOG.md) T2 — la prévisualisation d'un modèle présélectionne l'unique contact rattaché à
//           l'affaire choisie, sur la pile réelle et le seed : un rattaché (Sogexia, Léo Marchand), aucun, deux
//           rattachements temporaires, choix manuel conservé, lectrice sous sa RLS (Lyon, Sophie Dupont), rendu substitué, console vierge
// @verifies docs/SPEC-modeles-emails.md §9.5 (révision `CRM-124`, décision 806) ; docs/DESIGN_SYSTEM.md §5.39 ;
//           CLAUDE.md §16 (captures observées)
//
// LE SEED EST RENDU TEL QU'IL A ÉTÉ REÇU. Les deux rattachements du cas « plusieurs contacts » sont posés par la
// véritable route REST, avec le jeton réel de l'administratrice, sur une affaire qui n'en porte aucun, et retirés par
// le même chemin en fin de scénario, quoi qu'il arrive. Léo Marchand n'y est jamais employé : le seed garde qu'il soit
// rattaché à exactement une affaire (`docs/SPEC-contacts.md` §5).

import { connecterAvecLeLabs, expect, test, type Page } from './fixtures'
import { URL_API, enTetesAuthentifies, jetonDe } from '../api/jetons'
import { PALIERS, capturer } from './captures'

const UNITE = 'CRM-124'
const ADMIN = 'admin@p2enjoy.test'
const VIEWER = 'viewer@p2enjoy.test'
const WORKSPACE = '5eed0000-0000-4000-8000-000000000001'

/** Les identifiants stables du seed (`supabase/seed/apply-seed.sh`, sections des affaires et des contacts). */
const SOGEXIA = '5eed0000-0000-4000-8000-0000000000c2' // Léo Marchand y est l'unique rattaché
const VITRINE = '5eed0000-0000-4000-8000-0000000000c1' // aucun rattachement
const LYON = '5eed0000-0000-4000-8000-0000000000c4' // Sophie Dupont y est l'unique rattachée ; la lectrice la lit
const AUDIT = '5eed0000-0000-4000-8000-0000000000c3' // aucun rattachement : y sont posés les deux temporaires
const LEO = '5eed0000-0000-4000-8000-000000000091'
const DUPONT = '5eed0000-0000-4000-8000-000000000092'
const ELISE = '5eed0000-0000-4000-8000-000000000093'

const MODELE_RELANCE = 'Relance sans réponse'

async function ouvrirPrevisualisation(page: Page, email: string, affaireAttendue = SOGEXIA) {
	await connecterAvecLeLabs(page, email)
	await page.goto('/reglages/modeles-emails')
	await page
		.getByTestId('ligne-modele-email')
		.filter({ hasText: MODELE_RELANCE })
		.getByTestId('previsualiser-modele')
		.click()
	const affaire = page.getByTestId('champ-affaire-previsualisation')
	const contact = page.getByTestId('champ-contact-previsualisation')
	// LA PRÉSÉLECTION EXIGE QUE LE CONTACT SOIT PROPOSÉ : on attend que les deux listes soient là.
	await expect(contact.locator(`option[value="${LEO}"]`)).toHaveCount(1)
	await expect(affaire.locator(`option[value="${affaireAttendue}"]`)).toHaveCount(1)
	return { affaire, contact }
}

async function rattacher(page: Page, carte: string, contacts: readonly string[]) {
	const jeton = await jetonDe(ADMIN)
	for (const contact of contacts) {
		const reponse = await page.request.post(`${URL_API}/rest/v1/card_contacts`, {
			headers: enTetesAuthentifies(jeton),
			data: { workspace_id: WORKSPACE, card_id: carte, contact_id: contact },
		})
		expect(reponse.status(), `rattachement de ${contact}`).toBe(201)
	}
}

async function detacherTout(page: Page, carte: string) {
	const jeton = await jetonDe(ADMIN)
	await page.request.delete(`${URL_API}/rest/v1/card_contacts?card_id=eq.${carte}`, {
		headers: enTetesAuthentifies(jeton),
	})
	const restants = await page.request.get(`${URL_API}/rest/v1/card_contacts?select=contact_id&card_id=eq.${carte}`, {
		headers: enTetesAuthentifies(jeton),
	})
	expect(((await restants.json()) as unknown[]).length, 'le seed doit être rendu tel qu’il a été reçu').toBe(0)
}

test.describe('le contact présélectionné de la prévisualisation (§9.5, CRM-124)', () => {
	test('l’unique rattaché est présélectionné, rendu, et retiré pour une affaire qui n’en a pas', async ({ page }) => {
		const { affaire, contact } = await ouvrirPrevisualisation(page, ADMIN)
		await expect(contact).toHaveValue('')

		// AU CLAVIER : le focus est déjà sur l'affaire (§9.5), on choisit Sogexia sans la souris.
		await expect(affaire).toBeFocused()
		await affaire.selectOption(SOGEXIA)
		await expect(contact).toHaveValue(LEO)
		await page.getByTestId('lancer-previsualisation').click()
		// LE RENDU EST SUBSTITUÉ PAR LA BASE AVEC LE CONTACT PRÉSÉLECTIONNÉ.
		await expect(page.getByTestId('rendu-corps')).toContainText('Bonjour Léo Marchand,')
		await capturer(page, 'contact-preselectionne-1440', UNITE)

		// UNE PRÉSÉLECTION QUE LA NOUVELLE AFFAIRE NE JUSTIFIE PLUS EST RETIRÉE.
		await affaire.selectOption(VITRINE)
		await expect(contact).toHaveValue('')
	})

	test('deux rattachés : aucune présélection', async ({ page }) => {
		await rattacher(page, AUDIT, [DUPONT, ELISE])
		try {
			const { affaire, contact } = await ouvrirPrevisualisation(page, ADMIN)
			await affaire.selectOption(SOGEXIA)
			await expect(contact).toHaveValue(LEO)
			await affaire.selectOption(AUDIT)
			// CHOISIR ENTRE PLUSIEURS SERAIT DEVINER.
			await expect(contact).toHaveValue('')
			await capturer(page, 'contact-plusieurs-rattaches-1440', UNITE)
		} finally {
			await detacherTout(page, AUDIT)
		}
	})

	test('un choix manuel n’est jamais écrasé par le changement d’affaire', async ({ page }) => {
		const { affaire, contact } = await ouvrirPrevisualisation(page, ADMIN)
		await contact.selectOption(ELISE)
		await affaire.selectOption(SOGEXIA)
		// La lecture des rattachements de Sogexia a eu lieu : on attend sa réponse avant de constater.
		await page.waitForResponse((r) => r.url().includes('/rest/v1/card_contacts') && r.url().includes(SOGEXIA))
		await expect(contact).toHaveValue(ELISE)
	})

	// MESURÉ : la lectrice ne lit qu'un rattachement, celui de Lyon ; Sogexia appartient à un track qui lui est fermé.
	test('la lectrice obtient la présélection des seuls rattachements qu’elle lit', async ({ page }) => {
		const { affaire, contact } = await ouvrirPrevisualisation(page, VIEWER, LYON)
		await expect(affaire.locator(`option[value="${SOGEXIA}"]`)).toHaveCount(0)
		await affaire.selectOption(LYON)
		await expect(contact).toHaveValue(DUPONT)
	})

	for (const palier of PALIERS) {
		test(`palier ${palier.nom} : le contact présélectionné, sans débordement`, async ({ page }) => {
			await page.setViewportSize({ width: palier.largeur, height: palier.hauteur })
			const { affaire, contact } = await ouvrirPrevisualisation(page, ADMIN)
			await affaire.selectOption(SOGEXIA)
			await expect(contact).toHaveValue(LEO)
			const deborde = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)
			expect(deborde, 'aucun défilement horizontal').toBe(false)
			await capturer(page, `contact-preselectionne-${palier.nom}`, UNITE)
		})
	}
})
