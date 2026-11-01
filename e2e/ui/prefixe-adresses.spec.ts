// @verifies CRM-123 (docs/BACKLOG.md) — tranche T3 : le préfixe des adresses d'affaire et la régénération, sur l'écran de
//           la plateforme et la pile réelle
// @verifies docs/SPEC-cards.md §3.6 (points 5, 7, 8 et 9) ; docs/SPEC-plateforme.md §7.3 ; docs/DESIGN_SYSTEM.md §5.56
//           (adresses des affaires : champ et exemple, refus traduit, décompte en phrase, confirmation dans le flux et ses
//           conséquences, `Échap`, succès annoncé, focus au titre), §7 (quatre paliers, aucun défilement horizontal), §8
// @verifies CLAUDE.md §15 (état déterministe, effets constatés en base), §16 (captures observées)
//
// L'espace seedé n'est jamais modifié. Le scénario pose, par la clé de service, un espace de SONDE `sonde-123-ui` et deux
// affaires — l'insertion par la clé de service n'exige pas de rattachement —, et le retire avant et après ; le retrait
// est constaté.

import { ERREUR_RESSOURCE_HTTP, autoriserErreursConsole, connecterAvecLeLabs, expect, test, type APIRequestContext, type Page } from './fixtures'
import { PALIERS, capturer } from './captures'
import { URL_API, enTetesService } from '../api/jetons'

const UNITE = 'CRM-123'
const SABINE = 'plateforme@p2enjoy.test'
const SLUG = 'sonde-123-ui'
const rest = (chemin: string) => `${URL_API}/rest/v1/${chemin}`

test.use({ viewport: { width: 1440, height: 900 } })

async function purger(request: APIRequestContext): Promise<void> {
	await request.delete(rest(`workspaces?slug=eq.${SLUG}`), { headers: enTetesService() })
	const restants = await request.get(rest(`workspaces?select=slug&slug=eq.${SLUG}`), { headers: enTetesService() })
	expect(await restants.json(), 'l’espace de sonde ne doit pas rester dans la base').toEqual([])
}

async function poserSonde(request: APIRequestContext): Promise<string> {
	const service = { ...enTetesService(), 'Content-Type': 'application/json', Prefer: 'return=representation' }
	const espace = await request.post(rest('workspaces'), {
		headers: service,
		data: { name: 'Sonde 123 adresses', slug: SLUG, inbound_domain: 'crm.sonde-123.test' },
	})
	expect(espace.status()).toBe(201)
	const [pose] = (await espace.json()) as { id: string }[]
	expect(pose, 'l’espace de sonde est rendu').toBeDefined()
	const id = pose!.id
	const cartes = await request.post(rest('cards'), {
		headers: service,
		data: [{ workspace_id: id, title: 'Sonde 123 — refonte' }, { workspace_id: id, title: 'Sonde 123 — maintenance' }],
	})
	expect(cartes.status()).toBe(201)
	return id
}

async function adressesEnBase(request: APIRequestContext, espace: string): Promise<string[]> {
	const reponse = await request.get(rest(`cards?workspace_id=eq.${espace}&select=email_local_part&order=email_local_part`), { headers: enTetesService() })
	return ((await reponse.json()) as { email_local_part: string }[]).map((ligne) => ligne.email_local_part)
}

async function sansDefilementHorizontal(page: Page, contexte: string): Promise<void> {
	const debord = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
	expect(debord, `${contexte} : la page ne défile jamais horizontalement (§7)`).toBeLessThanOrEqual(0)
}

test.beforeEach(async ({ request }) => purger(request))
test.afterEach(async ({ request }) => purger(request))

test.describe('Les adresses des affaires (docs/DESIGN_SYSTEM.md §5.56)', () => {
	test('régler le préfixe, lire le décompte, régénérer au clavier, et le refus d’un préfixe hors forme', async ({ page, request }) => {
		const espace = await poserSonde(request)
		await connecterAvecLeLabs(page, SABINE)
		await page.goto(`/plateforme/espaces/${SLUG}`)
		const section = page.getByTestId('adresses-affaires')
		await expect(section.getByTestId('prefixe-adresses')).toHaveText('c-')
		await expect(section.getByTestId('adresses-a-jour')).toBeVisible()
		await expect(section.getByRole('button', { name: 'Régénérer les adresses' })).toHaveCount(0)
		await capturer(page, 'adresses-a-jour-xl-1440', UNITE)

		// Le refus d'un préfixe hors forme : traduit sous les champs, la saisie gardée (§5.7 ter), rien d'écrit. Le 400 de la
		// base est la réponse attendue, que la console note : elle est constatée une fois le refus lu.
		await page.getByRole('button', { name: /^Modifier l’espace/u }).click()
		const formulaire = page.getByTestId('formulaire-identite')
		const champ = formulaire.getByLabel('Préfixe des adresses d’affaire')
		await champ.fill('app*')
		await formulaire.getByRole('button', { name: 'Enregistrer' }).click()
		await expect(formulaire.getByRole('alert')).toContainText('minuscules')
		await expect(champ).toHaveValue('app*')
		autoriserErreursConsole(page, [ERREUR_RESSOURCE_HTTP[400]])
		await capturer(page, 'refus-prefixe-xl-1440', UNITE)

		// Le réglage : l'exemple suit la frappe, en minuscules comme la base rangera la saisie.
		await champ.fill('APP-')
		await expect(formulaire.getByTestId('exemple-adresse')).toHaveText('Exemple : app-xxxxxxxx@crm.sonde-123.test')
		await capturer(page, 'formulaire-prefixe-xl-1440', UNITE)
		await formulaire.getByRole('button', { name: 'Enregistrer' }).click()
		await expect(page.getByTestId('message-identite')).toHaveText('Espace modifié.')
		await expect(section.getByTestId('prefixe-adresses')).toHaveText('app-')
		await expect(section.getByTestId('adresses-a-regenerer')).toContainText('2 affaires ont une adresse hors du préfixe')
		expect((await adressesEnBase(request, espace)).every((adresse) => adresse.startsWith('c-')), 'régler ne réécrit aucune adresse').toBe(true)
		await capturer(page, 'adresses-a-regenerer-xl-1440', UNITE)

		// Au clavier : la confirmation s'ouvre, dit ses conséquences ; `Échap` la referme et rend le focus à la commande.
		const commande = section.getByRole('button', { name: 'Régénérer les adresses' })
		await commande.focus()
		await page.keyboard.press('Enter')
		const confirmation = page.getByTestId('confirmation-regeneration')
		await expect(confirmation).toContainText('Régénérer les adresses de 2 affaires ?')
		await expect(confirmation).toContainText('ne sera plus classé')
		await expect(commande).toBeDisabled()
		await capturer(page, 'confirmation-regeneration-xl-1440', UNITE)
		await page.keyboard.press('Escape')
		await expect(confirmation).toHaveCount(0)
		await expect(commande).toBeFocused()

		await page.keyboard.press('Enter')
		await expect(confirmation.getByRole('button', { name: 'Régénérer', exact: true })).toBeFocused()
		await page.keyboard.press('Enter')
		await expect(page.getByTestId('message-adresses')).toHaveText('Adresses régénérées : 2 affaires.')
		await expect(section.getByTestId('adresses-a-jour')).toBeVisible()
		await expect(page.locator('#titre-adresses')).toBeFocused()
		const apres = await adressesEnBase(request, espace)
		expect(apres).toHaveLength(2)
		for (const adresse of apres) expect(adresse).toMatch(/^app-[0-9abcdefghjkmnpqrstvwxyz]{8}$/u)
		await capturer(page, 'adresses-regenerees-xl-1440', UNITE)

		// Le journal de la plateforme nomme le geste en mots, son détail par clé.
		await page.goto('/plateforme/journal')
		const ligne = page.getByTestId('ligne-journal').filter({ hasText: 'Adresses d’affaire régénérées' }).first()
		await expect(ligne).toContainText('2 adresses au préfixe')
		await capturer(page, 'journal-regeneration-xl-1440', UNITE)
	})

	test('quatre paliers : la section et la confirmation tiennent dans la page', async ({ page, request }) => {
		const espace = await poserSonde(request)
		await request.patch(rest(`workspaces?id=eq.${espace}`), {
			headers: { ...enTetesService(), 'Content-Type': 'application/json' },
			data: { card_address_prefix: 'app-' },
		})
		await connecterAvecLeLabs(page, SABINE)
		for (const palier of PALIERS) {
			await page.setViewportSize({ width: palier.largeur, height: palier.hauteur })
			await page.goto(`/plateforme/espaces/${SLUG}`)
			const section = page.getByTestId('adresses-affaires')
			await expect(section.getByTestId('adresses-a-regenerer')).toBeVisible()
			await section.getByRole('button', { name: 'Régénérer les adresses' }).click()
			await expect(page.getByTestId('confirmation-regeneration')).toBeVisible()
			await section.scrollIntoViewIfNeeded()
			await sansDefilementHorizontal(page, palier.nom)
			await capturer(page, `adresses-confirmation-${palier.nom}`, UNITE)
		}
	})
})
