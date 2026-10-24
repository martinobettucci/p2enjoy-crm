// @verifies CRM-114 (docs/BACKLOG.md) — tranche T3 : l'onglet « Organisations », la création et la modification, de bout en
//           bout sur la pile réelle et le seed
// @verifies docs/SPEC-organisations.md §2 à §4 ; docs/DESIGN_SYSTEM.md §5.64 (onglets du carnet, tableau, création qui
//           ouvre la fiche, modification), §5.59 (commandes éteintes avec le motif), §7 (aucun défilement horizontal) ;
//           CLAUDE.md §10 (le refus de la base, ici par l'écran ; la requête directe est `e2e/api/organisations.spec.ts`),
//           §16 (captures)
//
// Les organisations du seed sont LUES ; ce fichier crée la sienne et l'efface par la clé de service, avant et après.

import { ERREUR_RESSOURCE_HTTP, autoriserErreursConsole, connecterAvecLeLabs, expect, test, type Page } from './fixtures'
import { CLE_SERVICE, URL_API } from '../api/jetons'
import { PALIERS, capturer } from './captures'

const UNITE = 'CRM-114'
const BIZDEV = 'bizdev@p2enjoy.test'
const VIEWER = 'viewer@p2enjoy.test'
const NOM = 'E2E Organisation'
const ESPACE = '5eed0000-0000-4000-8000-000000000001'

async function nettoyer(): Promise<void> {
	const reponse = await fetch(`${URL_API}/rest/v1/organizations?workspace_id=eq.${ESPACE}&name=like.${encodeURIComponent(NOM)}*`, {
		method: 'DELETE',
		headers: { apikey: CLE_SERVICE, Authorization: `Bearer ${CLE_SERVICE}` },
	})
	if (!reponse.ok) throw new Error(`nettoyage des organisations : ${reponse.status}`)
}

test.beforeAll(nettoyer)
test.afterAll(nettoyer)

const onglets = (page: Page) => page.getByRole('navigation', { name: 'Sections du carnet' })

test.describe('l’onglet « Organisations » (docs/DESIGN_SYSTEM.md §5.64)', () => {
	test('les onglets du carnet, et une organisation sans contact atteignable par la liste', async ({ page }) => {
		await connecterAvecLeLabs(page, BIZDEV)
		await page.goto('/contacts')
		await expect(onglets(page).getByRole('link', { name: 'Contacts' })).toHaveAttribute('aria-current', 'page')
		await onglets(page).getByRole('link', { name: 'Organisations' }).click()
		await expect(page).toHaveURL(/\/contacts\/organisations$/u)
		await expect(onglets(page).getByRole('link', { name: 'Organisations' })).toHaveAttribute('aria-current', 'page')
		const vasseur = page.getByTestId('ligne-organisation').filter({ hasText: 'Comptoir Vasseur' })
		await expect(vasseur).toContainText('comptoir-vasseur.example')
		await expect(vasseur.locator('td').last()).toHaveText('0')
		await capturer(page, 'organisations-liste-1440', UNITE)
		await vasseur.getByRole('link', { name: 'Comptoir Vasseur' }).click()
		await expect(page).toHaveURL(/\/contacts\/organisations\/5eed0000-0000-4000-8000-000000000083$/u)
	})

	test('créer au clavier ouvre la fiche, puis la modifier ; un domaine déjà pris est refusé', async ({ page }) => {
		await connecterAvecLeLabs(page, BIZDEV)
		await page.goto('/contacts/organisations')
		await page.getByTestId('ouvrir-creation-organisation').click()
		await expect(page.getByTestId('champ-nom-organisation')).toBeFocused()
		await page.keyboard.type(NOM)
		await page.getByTestId('champ-domaine-organisation').fill('sogexia.example')
		await page.getByTestId('envoyer-organisation').click()
		await expect(page.getByTestId('refus-organisation')).toHaveText('Ce domaine est déjà celui d’une autre organisation de l’espace.')
		await expect(page.getByTestId('champ-nom-organisation')).toHaveValue(NOM)
		// Le refus est le 409 que la base rend sur l'unicité du domaine, PROVOQUÉ ici : l'écran l'a traduit, la console
		// n'en garde que cette trace.
		autoriserErreursConsole(page, [ERREUR_RESSOURCE_HTTP[409]])
		await page.getByTestId('champ-domaine-organisation').fill('E2E-Organisation.Example')
		await page.getByTestId('champ-site-organisation').fill('https://e2e-organisation.example')
		await capturer(page, 'organisations-creation-1440', UNITE)
		await page.getByTestId('envoyer-organisation').click()

		await expect(page).toHaveURL(/\/contacts\/organisations\/[0-9a-f-]{36}$/u)
		await expect(page.getByTestId('caracteristiques-organisation')).toContainText('e2e-organisation.example')
		const id = new URL(page.url()).pathname.split('/').pop()
		const enBase = await fetch(`${URL_API}/rest/v1/organizations?id=eq.${id}&select=name,domain,website`, {
			headers: { apikey: CLE_SERVICE, Authorization: `Bearer ${CLE_SERVICE}` },
		})
		expect(await enBase.json()).toEqual([{ name: NOM, domain: 'e2e-organisation.example', website: 'https://e2e-organisation.example' }])

		await page.getByTestId('modifier-organisation').click()
		await expect(page.getByTestId('champ-nom-organisation')).toHaveValue(NOM)
		await page.getByTestId('champ-nom-organisation').fill(`${NOM} renommée`)
		await page.getByTestId('champ-site-organisation').fill('')
		await capturer(page, 'organisations-modification-1440', UNITE)
		await page.getByTestId('envoyer-organisation').click()
		await expect(page.getByRole('status', { name: 'Annonces de la fiche d’organisation' })).toHaveText('Organisation enregistrée')
		await expect(page.getByRole('heading', { level: 1 })).toHaveText(`${NOM} renommée`)
		await expect(page.getByTestId('lien-site-organisation')).toHaveCount(0)
		await expect(page.getByTestId('modifier-organisation')).toBeFocused()
		await capturer(page, 'organisations-fiche-modifiee-1440', UNITE)
		// Les captures suivantes montrent le seed tel qu'il est : l'organisation du scénario part dès qu'il a fini.
		await nettoyer()
	})

	test('la lectrice lit la liste ; « Nouvelle organisation » et « Modifier » sont éteintes avec le motif', async ({ page }) => {
		await connecterAvecLeLabs(page, VIEWER)
		await page.goto('/contacts/organisations')
		const commande = page.getByTestId('ouvrir-creation-organisation')
		await expect(commande).toBeDisabled()
		await expect(page.locator(`[id="${await commande.getAttribute('aria-describedby')}"]`)).toBeVisible()
		await expect(page.getByTestId('ligne-organisation').filter({ hasText: 'Sogexia' })).toBeVisible()
		await capturer(page, 'organisations-lectrice-1440', UNITE)
		await page.getByTestId('ligne-organisation').filter({ hasText: 'Sogexia' }).getByRole('link').click()
		await expect(page.getByTestId('modifier-organisation')).toBeDisabled()
	})
})

test.describe('les paliers (docs/DESIGN_SYSTEM.md §7)', () => {
	for (const palier of PALIERS) {
		test(`aucun défilement horizontal, liste et formulaire — ${palier.nom}`, async ({ page }) => {
			await page.setViewportSize({ width: palier.largeur, height: palier.hauteur })
			await connecterAvecLeLabs(page, BIZDEV)
			await page.goto('/contacts/organisations')
			await expect(page.getByTestId('ligne-organisation').first()).toBeVisible()
			await capturer(page, `organisations-${palier.nom}`, UNITE)
			await page.getByTestId('ouvrir-creation-organisation').click()
			await expect(page.getByTestId('formulaire-organisation')).toBeVisible()
			await capturer(page, `organisations-formulaire-${palier.nom}`, UNITE)
			const debord = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
			expect(debord).toBeLessThanOrEqual(0)
		})
	}
})
