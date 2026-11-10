// @verifies CRM-133 (docs/BACKLOG.md) — tranche T2 : la description d'un nœud et sa surcharge par l'étape, écrites par
//           Réglages ▸ Catalogue de nœuds et l'éditeur de workflows, lues sur le board et sur la fiche, à la souris et au
//           clavier ; vidées, elles sont retirées (docs/SPEC-workflow-engine.md §7 sexies.1, §7 sexies.4)
// @verifies docs/DESIGN_SYSTEM.md §5.15, §5.18, §5.58 (révisé : le bouton d'information d'une étape) ; CLAUDE.md §16
//
// LES DONNÉES DE LA PREUVE NE SONT PAS CELLES DU SEED DE `CRM-133` (T4, docs/SPEC-seed.md §39) : celui-ci décrira le nœud
// « Prospection » et surchargera l'étape « Négociation ». La preuve écrit, par les écrans, la description du nœud
// « Relance » et la surcharge de l'étape « Signature » du workflow par défaut, que le seed laisse vides — et les vide
// avant et après elle, sous la clé de service, pour ne rien laisser derrière elle même en cas d'échec.
import { connecterAvecLeLabs, expect, test, type Page } from './fixtures'
import type { APIRequestContext } from '@playwright/test'
import { URL_API, enTetesService } from '../api/jetons'
import { PALIERS, capturer } from './captures'

const UNITE = 'CRM-133'
const ADMIN = 'admin@p2enjoy.test'
const NOEUD_RELANCE = '5eed0000-0000-4000-8000-000000000042'
const ETAPE_SIGNATURE = '5eed0000-0000-4000-8000-000000000064'
const BOARD = '/tracks/conseil-ia/grands-comptes'
const AFFAIRE = 'Plateforme de billetterie — Musée des Confluences'
const DESCRIPTION_NOEUD = 'Le client a été relancé : on attend son retour sur la proposition.'
const DESCRIPTION_ETAPE = 'Le contrat est en relecture chez le client.\nSignature attendue sous huit jours.'

const bulle = (page: Page) => page.getByTestId('infobulle')

async function lireEnBase(request: APIRequestContext): Promise<{ noeud: string | null; etape: string | null }> {
	const noeud = await request.get(`${URL_API}/rest/v1/workflow_nodes_catalog?select=description&id=eq.${NOEUD_RELANCE}`, {
		headers: enTetesService(),
	})
	const etape = await request.get(`${URL_API}/rest/v1/workflow_steps?select=description_override&id=eq.${ETAPE_SIGNATURE}`, {
		headers: enTetesService(),
	})
	const [n] = (await noeud.json()) as { description: string | null }[]
	const [e] = (await etape.json()) as { description_override: string | null }[]
	return { noeud: n?.description ?? null, etape: e?.description_override ?? null }
}

async function viderEnBase(request: APIRequestContext): Promise<void> {
	const entetes = { ...enTetesService(), 'Content-Type': 'application/json' }
	const a = await request.patch(`${URL_API}/rest/v1/workflow_nodes_catalog?id=eq.${NOEUD_RELANCE}`, {
		headers: entetes,
		data: { description: null },
	})
	const b = await request.patch(`${URL_API}/rest/v1/workflow_steps?id=eq.${ETAPE_SIGNATURE}`, {
		headers: entetes,
		data: { description_override: null },
	})
	expect(a.ok() && b.ok(), 'remise à vide sous la clé de service').toBe(true)
}

async function idAffaire(request: APIRequestContext): Promise<string> {
	const reponse = await request.get(`${URL_API}/rest/v1/cards?select=id&title=eq.${encodeURIComponent(AFFAIRE)}`, {
		headers: enTetesService(),
	})
	const [ligne] = (await reponse.json()) as { id: string }[]
	expect(ligne, `l'affaire « ${AFFAIRE} » du seed`).toBeDefined()
	return ligne!.id
}

/** Le nom du palier courant, pour nommer la capture des formulaires. */
function nomPalier(page: Page): string {
	const largeur = page.viewportSize()?.width ?? 1440
	return PALIERS.find((palier) => palier.largeur === largeur)?.nom ?? `${largeur}`
}

/** Écrit les deux descriptions par les écrans de Réglages, comme un administrateur. */
async function ecrireParLesEcrans(page: Page, request: APIRequestContext): Promise<void> {
	await page.goto('/reglages/catalogue')
	await page.getByRole('button', { name: 'Modifier le nœud Relance' }).click()
	const champNoeud = page.getByTestId('champ-description-noeud')
	await expect(champNoeud).toHaveValue('')
	await champNoeud.fill(DESCRIPTION_NOEUD)
	await champNoeud.scrollIntoViewIfNeeded()
	await capturer(page, `catalogue-description-noeud-${nomPalier(page)}`, UNITE)
	await page.getByTestId('valider-noeud').click()
	await expect.poll(async () => (await lireEnBase(request)).noeud).toBe(DESCRIPTION_NOEUD)

	await page.goto('/reglages/workflows')
	await page.getByRole('button', { name: 'Surcharger Signature' }).click()
	const formulaire = page.getByTestId('formulaire-surcharge')
	// Le nœud « Signature » ne porte aucune description : l'aide le dit (§5.15).
	await expect(formulaire.getByText('Vide, l’étape n’a pas de description : le nœud n’en porte aucune.')).toBeVisible()
	await formulaire.getByLabel('Description de l’étape').fill(DESCRIPTION_ETAPE)
	await formulaire.getByLabel('Description de l’étape').scrollIntoViewIfNeeded()
	await capturer(page, `editeur-description-etape-${nomPalier(page)}`, UNITE)
	await formulaire.getByRole('button', { name: 'Enregistrer' }).click()
	await expect.poll(async () => (await lireEnBase(request)).etape).toBe(DESCRIPTION_ETAPE)
}

test.describe('la description d’une étape (CRM-133, §7 sexies)', () => {
	test.describe.configure({ mode: 'serial' })

	test.beforeEach(async ({ page, request }) => {
		await viderEnBase(request)
		await page.setViewportSize({ width: 1440, height: 900 })
		await connecterAvecLeLabs(page, ADMIN)
	})

	test.afterEach(async ({ request }) => {
		await viderEnBase(request)
	})

	test('à la souris : écrite par Réglages, lue sur le board et sur la fiche, vidée et retirée', async ({ page, request }) => {
		await ecrireParLesEcrans(page, request)

		// Le board : un bouton sur « Relance » (le nœud) et un sur « Signature » (la surcharge), aucun ailleurs.
		await page.goto(BOARD)
		const boutons = page.getByTestId('description-colonne')
		await expect(boutons).toHaveCount(2)
		await page.getByRole('button', { name: 'Description de l’étape Relance' }).hover()
		await expect(bulle(page)).toContainText('Relance')
		await expect(bulle(page)).toContainText(DESCRIPTION_NOEUD)
		for (const palier of PALIERS) {
			await page.setViewportSize({ width: palier.largeur, height: palier.hauteur })
			const bouton = page.getByRole('button', { name: 'Description de l’étape Signature' })
			await bouton.scrollIntoViewIfNeeded()
			await bouton.hover()
			await expect(bulle(page)).toContainText('Signature attendue sous huit jours.')
			await capturer(page, `board-description-etape-${palier.nom}`, UNITE)
			await page.mouse.move(2, 2)
		}
		await page.setViewportSize({ width: 1440, height: 900 })

		// La fiche, ouverte depuis grands-comptes : l'autre rattachement (Refonte de site) est à « Relance ».
		await page.goto(`${BOARD}/cards/${await idAffaire(request)}`)
		const boutonFiche = page.getByTestId('description-etape-rattachement')
		await expect(boutonFiche).toHaveAccessibleName('Description de l’étape Relance')
		await boutonFiche.hover()
		await expect(bulle(page)).toContainText(DESCRIPTION_NOEUD)
		await capturer(page, 'fiche-description-etape-xl-1440', UNITE)

		// Vidée par l'écran, la description du nœud est retirée en base, et son bouton disparaît du board.
		await page.goto('/reglages/catalogue')
		await page.getByRole('button', { name: 'Modifier le nœud Relance' }).click()
		await page.getByTestId('champ-description-noeud').fill('   ')
		await page.getByTestId('valider-noeud').click()
		await expect.poll(async () => (await lireEnBase(request)).noeud).toBeNull()
		await page.goto(BOARD)
		await expect(page.getByTestId('description-colonne')).toHaveCount(1)
		await expect(page.getByRole('button', { name: 'Description de l’étape Relance' })).toHaveCount(0)
	})

	test('au clavier : le bouton s’atteint par Tab, s’ouvre au focus, se ferme à Échap, se rouvre à Entrée', async ({
		page,
		request,
	}) => {
		await page.setViewportSize({ width: 390, height: 780 })
		await ecrireParLesEcrans(page, request)
		await page.setViewportSize({ width: 1440, height: 900 })
		await page.goto(BOARD)
		const bouton = page.getByRole('button', { name: 'Description de l’étape Signature' })
		await expect(bouton).toBeVisible()
		await page.locator('body').focus()
		let atteint = false
		for (let pas = 0; pas < 120 && !atteint; pas += 1) {
			await page.keyboard.press('Tab')
			atteint = await bouton.evaluate((element) => element === document.activeElement)
		}
		expect(atteint, 'le bouton est atteint par Tab').toBe(true)
		await expect(bulle(page)).toContainText('Le contrat est en relecture chez le client.')
		await capturer(page, 'board-description-etape-clavier-xl-1440', UNITE)
		await page.keyboard.press('Escape')
		await expect(bulle(page)).toHaveCount(0)
		await expect(bouton).toBeFocused()
		await page.keyboard.press('Enter')
		await expect(bulle(page)).toContainText('Signature attendue sous huit jours.')
	})
})
