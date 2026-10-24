// @verifies CRM-113 (docs/BACKLOG.md) — tranche T3 : le générateur connaît l'affaire et le catalogue, sur la pile réelle,
//           à la souris et au clavier ; quatre paliers
// @verifies docs/SPEC-ia.md §14.7 (le nom et la probabilité de toute étape ; « Utiliser le nœud du catalogue » garde le
//           nom ; le défaut `native_field` traduit), §14.8 (le parcours : générer avec le scénario `catalogue`, voir les
//           deux défauts, utiliser le nœud du catalogue en gardant le nom, retirer `montant`, accepter ; l'éditeur
//           montre l'étape sous son nom surchargé) ; §14.3 (les surcharges relues en base)
// @verifies docs/DESIGN_SYSTEM.md §5.52 bis (deux champs par étape, l'exemple à la valeur du nœud, le focus après
//           « Utiliser le nœud du catalogue »), §7 (quatre paliers, aucun défilement horizontal), §8 (clavier) ;
//           docs/SPEC-seed.md §16 ter (la suggestion du seed) ; décisions 646 et 677
// @verifies CLAUDE.md §15 (état déterministe, effets en base relus), §16 (captures observées)
//
// LE SERVEUR LLM N'EST JAMAIS APPELÉ (docs/SPEC-ia.md §8) : chaque requête de la page vers la fonction `ia` reçoit
// l'en-tête `x-ia-simulateur: catalogue`. Les suggestions créées portent un préfixe ; après chaque scénario, la clé de
// service retire les workflows qu'elles ont créés, puis les suggestions — retrait CONSTATÉ. Le scénario ne crée aucun
// nœud de catalogue une fois « negociation » rendu au catalogue ; la suggestion du seed n'est jamais décidée.

import { connecterAvecLeLabs, expect, test, type APIRequestContext, type Page } from './fixtures'
import { PALIERS, capturer } from './captures'
import { URL_API, enTetesService } from '../api/jetons'

const UNITE = 'CRM-113'
const ADMIN = 'admin@p2enjoy.test'
const EDITEUR = '/reglages/workflows'
const PREFIXE = 'Sonde 113 UI'
const ESPACE = '5eed0000-0000-4000-8000-000000000001'
const DEMANDE_SEED = 'Un cycle de vente accompagné : premier contact, discussion commerciale'
const NBSP = ' '

const rest = (chemin: string) => `${URL_API}/rest/v1/${chemin}`
const FILTRE = `demande=like.${encodeURIComponent(`${PREFIXE}*`)}`

test.use({ viewport: { width: 1440, height: 900 } })

async function lireService<T>(requete: APIRequestContext, chemin: string): Promise<T[]> {
	const reponse = await requete.get(rest(chemin), { headers: enTetesService() })
	expect(reponse.status(), chemin).toBe(200)
	return (await reponse.json()) as T[]
}

test.afterEach(async ({ request }) => {
	const creees = await lireService<{ workflow_cree_id: string | null }>(request, `suggestions_ia?select=workflow_cree_id&${FILTRE}&workflow_cree_id=not.is.null`)
	for (const { workflow_cree_id } of creees) {
		expect((await request.delete(rest(`workflows?id=eq.${workflow_cree_id}`), { headers: enTetesService() })).status()).toBe(204)
	}
	await request.delete(rest(`suggestions_ia?${FILTRE}`), { headers: enTetesService() })
	expect(await lireService(request, `suggestions_ia?select=id&${FILTRE}`), 'aucune suggestion de sonde ne doit rester').toEqual([])
	// Le catalogue du seed est intact : « negociation » garde son libellé, aucun nœud n'a été ajouté par le scénario.
	const [negociation] = await lireService<{ label: string }>(request, `workflow_nodes_catalog?select=label&workspace_id=eq.${ESPACE}&key=eq.negociation`)
	expect(negociation?.label).toBe('Négociation')
})

async function simuler(page: Page): Promise<void> {
	await page.route('**/functions/v1/ia/**', async (route) => {
		await route.continue({ headers: { ...route.request().headers(), 'x-ia-simulateur': 'catalogue' } })
	})
}

async function tabulerJusqua(page: Page, nom: string, maximum = 160): Promise<void> {
	for (let pas = 0; pas < maximum; pas += 1) {
		await page.keyboard.press('Tab')
		const courant = await page.evaluate(() => {
			const element = document.activeElement as HTMLElement | null
			return element?.getAttribute('aria-label') ?? element?.textContent?.trim() ?? ''
		})
		if (courant === nom) return
	}
	throw new Error(`« ${nom} » n'est pas atteint au clavier en ${maximum} tabulations`)
}

const panneau = (page: Page) => page.getByTestId('ia-panneau')
const guillemets = (texte: string) => texte.replace(/« /g, `«${NBSP}`).replace(/ »/g, `${NBSP}»`)

async function demander(page: Page, demande: string): Promise<void> {
	await page.getByRole('button', { name: 'Créer avec l’IA' }).click()
	await page.getByLabel('Décrivez le workflow').fill(demande)
	await page.getByRole('button', { name: 'Générer la suggestion' }).click()
	await expect(panneau(page).getByRole('heading', { level: 2, name: 'Suggestion de l’IA' })).toBeFocused()
}

test.describe('Le générateur connaît l’affaire et le catalogue (docs/SPEC-ia.md §14)', () => {
	test('à la souris : deux défauts, le nœud du catalogue qui garde le nom, « montant » retiré, accepté — l’éditeur montre le nom surchargé', async ({ page, request }) => {
		await simuler(page)
		await connecterAvecLeLabs(page, ADMIN)
		await page.goto(EDITEUR)
		// La suggestion du seed est listée (docs/SPEC-seed.md §16 ter).
		await expect(page.getByTestId('ia-suggestions-en-revue').getByRole('button', { name: new RegExp(DEMANDE_SEED) })).toBeVisible()

		await demander(page, `${PREFIXE} — souris : un cycle de vente accompagné, avec le montant.`)
		const defauts = page.getByTestId('ia-defauts')
		await expect(defauts.getByRole('heading')).toHaveText('2 défauts empêchent l’acceptation')
		await expect(defauts.getByRole('listitem')).toHaveText([
			guillemets('Le nœud « negociation » existe déjà au catalogue : utilisez-le sans le redéclarer.'),
			guillemets('Le champ « montant » reprend le montant, déjà porté par l’affaire : retirez-le ou renommez-le.'),
		])

		// L'étape du catalogue « prospection » porte le nom et la probabilité que l'IA lui a donnés ; l'exemple est le nœud.
		const nomProspection = page.getByLabel('Nom de l’étape prospection')
		await expect(nomProspection).toHaveValue('Premier contact')
		await expect(nomProspection).toHaveAttribute('placeholder', 'Prospection')
		await expect(page.getByLabel('Probabilité de l’étape prospection, en %')).toHaveValue('15')
		await expect(page.getByLabel('Nom de l’étape livre')).toHaveValue('')
		await expect(page.getByLabel('Nom de l’étape livre')).toHaveAttribute('placeholder', 'Livré')
		await capturer(page, 'ia-catalogue-defauts-xl-1440', UNITE)

		// « Utiliser le nœud du catalogue » : le nom « Discussion commerciale » est gardé, annoncé, et prend le focus.
		await page.getByRole('button', { name: 'Utiliser le nœud du catalogue' }).click()
		const nomNegociation = page.getByLabel('Nom de l’étape negociation')
		await expect(nomNegociation).toHaveValue('Discussion commerciale')
		await expect(nomNegociation).toBeFocused()
		await expect(nomNegociation).toHaveAttribute('placeholder', 'Négociation')
		await expect(page.getByLabel('Libellé du nœud negociation')).toHaveCount(0)
		await expect(page.locator('[aria-live]').filter({ hasText: 'garde son nom' })).toHaveText(
			guillemets('L’étape vise le nœud « negociation » du catalogue et garde son nom « Discussion commerciale ».'),
		)
		await page.getByRole('button', { name: 'Retirer le champ Montant' }).click()
		await capturer(page, 'ia-catalogue-corrigee-xl-1440', UNITE)
		await page.getByRole('button', { name: 'Enregistrer la correction' }).click()
		await expect(page.getByTestId('ia-defauts')).toHaveCount(0)

		await page.getByRole('button', { name: 'Accepter et créer le workflow' }).click()
		await expect(page.getByTestId('ia-panneau')).toHaveCount(0)
		// L'éditeur montre les étapes sous leur nom surchargé.
		const etapes = page.getByTestId('ligne-etape')
		await expect(etapes).toHaveCount(4)
		await expect(etapes.nth(0)).toContainText('Premier contact')
		await expect(etapes.nth(1)).toContainText('Discussion commerciale')
		await capturer(page, 'ia-catalogue-acceptee-xl-1440', UNITE)

		// L'effet réel, relu en base : les surcharges posées, et aucune là où le nœud convient.
		const [suggestion] = await lireService<{ statut: string; workflow_cree_id: string }>(request, `suggestions_ia?select=statut,workflow_cree_id&${FILTRE}`)
		expect(suggestion?.statut).toBe('acceptee')
		const lignes = await lireService<{ label_override: string | null; probability_override: number | null; workflow_nodes_catalog: { key: string } }>(
			request, `workflow_steps?workflow_id=eq.${suggestion?.workflow_cree_id}&select=label_override,probability_override,workflow_nodes_catalog(key)&order=position`)
		expect(lignes).toEqual([
			{ label_override: 'Premier contact', probability_override: 15, workflow_nodes_catalog: { key: 'prospection' } },
			{ label_override: 'Discussion commerciale', probability_override: null, workflow_nodes_catalog: { key: 'negociation' } },
			{ label_override: null, probability_override: null, workflow_nodes_catalog: { key: 'livre' } },
			{ label_override: null, probability_override: null, workflow_nodes_catalog: { key: 'perdu' } },
		])
		expect(await lireService(request, `form_fields?workflow_id=eq.${suggestion?.workflow_cree_id}&key=eq.montant&select=id`)).toEqual([])
	})

	test('au clavier seul : nommer une étape, utiliser le nœud du catalogue, retirer « montant », accepter', async ({ page, request }) => {
		await simuler(page)
		await connecterAvecLeLabs(page, ADMIN)
		await page.goto(EDITEUR)
		await demander(page, `${PREFIXE} — clavier`)

		await tabulerJusqua(page, 'Nom de l’étape livre')
		await page.keyboard.type('Contrat signé')
		await tabulerJusqua(page, 'Utiliser le nœud du catalogue')
		await page.keyboard.press('Enter')
		await expect(page.getByLabel('Nom de l’étape negociation')).toBeFocused()
		await tabulerJusqua(page, 'Retirer le champ Montant')
		await page.keyboard.press('Enter')
		await tabulerJusqua(page, 'Enregistrer la correction')
		await page.keyboard.press('Enter')
		await expect(page.getByTestId('ia-defauts')).toHaveCount(0)
		await tabulerJusqua(page, 'Accepter et créer le workflow')
		await page.keyboard.press('Enter')
		await expect(page.getByTestId('ia-panneau')).toHaveCount(0)

		const [suggestion] = await lireService<{ workflow_cree_id: string }>(request, `suggestions_ia?select=workflow_cree_id&${FILTRE}`)
		const [livre] = await lireService<{ label_override: string | null }>(
			request, `workflow_steps?workflow_id=eq.${suggestion?.workflow_cree_id}&select=label_override,workflow_nodes_catalog!inner(key)&workflow_nodes_catalog.key=eq.livre`)
		expect(livre?.label_override).toBe('Contrat signé')
	})

	for (const palier of PALIERS) {
		test(`la suggestion du seed au palier ${palier.nom} : deux champs par étape, dans le cadre, la page sans défilement de côté`, async ({ page }) => {
			await page.setViewportSize({ width: palier.largeur, height: palier.hauteur })
			await simuler(page)
			await connecterAvecLeLabs(page, ADMIN)
			await page.goto(EDITEUR)
			await page.getByTestId('ia-suggestions-en-revue').getByRole('button', { name: new RegExp(DEMANDE_SEED) }).click()
			await expect(page.getByTestId('ia-etape')).toHaveCount(4)
			await expect(page.getByLabel('Nom de l’étape prospection')).toHaveValue('Premier contact')

			const debordement = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
			expect(debordement, 'la page ne défile jamais horizontalement (§7)').toBeLessThanOrEqual(0)
			const premiere = page.getByTestId('ia-etape').first()
			await premiere.scrollIntoViewIfNeeded()
			for (const libelle of ['Nom de l’étape prospection', 'Probabilité de l’étape prospection, en %']) {
				const boite = await page.getByLabel(libelle).boundingBox()
				expect(boite, libelle).not.toBeNull()
				expect(boite?.x ?? -1, libelle).toBeGreaterThanOrEqual(0)
				expect((boite?.x ?? 0) + (boite?.width ?? 0), libelle).toBeLessThanOrEqual(palier.largeur)
				expect(boite?.height ?? 0, `${libelle} : cible de 40 px (§8)`).toBeGreaterThanOrEqual(40)
			}
			await capturer(page, `ia-catalogue-${palier.nom}`, UNITE)
		})
	}
})
