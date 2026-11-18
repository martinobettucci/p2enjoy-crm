// @verifies CRM-154 (docs/BACKLOG.md) — tranche T4 : réorganiser les channels depuis la barre d'onglets d'un track — le
//           glisser à la souris, le mode déplacement au clavier, l'ordre écrit en base et relu après rechargement, la
//           lectrice sans poignée et « Réorganiser » vers l'arborescence en lecture seule, le refus traduit sous la barre,
//           les quatre paliers et leurs captures
// @verifies docs/SPEC-administration-arborescence.md §15.4, §15.3 (`?track=`) ; docs/DESIGN_SYSTEM.md §5.106, §8, §12.6 ;
//           docs/JOURNAL.md décisions 935 et 938 ; CLAUDE.md §10 (le refus réel est prouvé par `e2e/api/reorganiser-channels`),
//           §16, §22
//
// LA PREUVE ÉCRIT, ET REND LE SEED INTACT : l'ordre de « Studio web » est reposé par la fonction elle-même, avec la clé
// de service, après chaque test.

import { autoriserErreursConsole, connecterAvecLeLabs, ERREUR_RESSOURCE_HTTP, expect, test, type Page } from './fixtures'
import type { APIRequestContext, Locator } from '@playwright/test'
import { URL_API, enTetesService } from '../api/jetons'
import { PALIERS, capturer } from './captures'

const UNITE = 'CRM-154'
const ADMIN = 'admin@p2enjoy.test'
const LECTRICE = 'viewer@p2enjoy.test'

const TRACK_STUDIO_WEB = '5eed0000-0000-4000-8000-000000000022'
const ORDRE_DU_SEED = [
	'5eed0000-0000-4000-8000-000000000034', // Refonte
	'5eed0000-0000-4000-8000-000000000035', // Maintenance
	'5eed0000-0000-4000-8000-0000000c6841', // Checklists
]
const NOMS_DU_SEED = ['Refonte de site', 'Maintenance', 'Checklists']
const CHEMIN = '/tracks/studio-web/refonte'

async function reposerOrdreDuSeed(request: APIRequestContext): Promise<void> {
	const reponse = await request.post(`${URL_API}/rest/v1/rpc/reorder_channels`, {
		headers: { ...enTetesService(), 'Content-Type': 'application/json' },
		data: { p_track_id: TRACK_STUDIO_WEB, p_channel_ids: ORDRE_DU_SEED },
	})
	expect(reponse.status(), 'l’ordre du seed est reposé').toBe(200)
}

/** L'ordre en base, relu avec la clé de service. */
async function ordreEnBase(request: APIRequestContext): Promise<string[]> {
	const reponse = await request.get(
		`${URL_API}/rest/v1/channels?select=id&track_id=eq.${TRACK_STUDIO_WEB}&archived_at=is.null&deleted_at=is.null&order=position,name`,
		{ headers: enTetesService() },
	)
	return ((await reponse.json()) as { id: string }[]).map((ligne) => ligne.id)
}

const barre = (page: Page) => page.getByTestId('barre-onglets')
const onglets = (page: Page) => barre(page).getByTestId('onglet-channel')
const poignee = (page: Page, nom: string) => page.getByRole('button', { name: `Déplacer « ${nom} »` })
const annonce = (page: Page) => page.getByRole('status', { name: 'Annonces de la barre d’onglets' })

async function ordreAffiche(page: Page): Promise<string[]> {
	return (await onglets(page).allTextContents()).map((texte) => texte.trim())
}

/** Avance par `Tab` jusqu'à `cible` : jamais de `focus()` programmatique (`:focus-visible`, §8). */
async function tabVers(page: Page, cible: Locator, max = 80): Promise<void> {
	for (let tentative = 0; tentative < max; tentative++) {
		if (await cible.evaluate((element: Element) => element === document.activeElement).catch(() => false)) return
		await page.keyboard.press('Tab')
	}
	await expect(cible).toBeFocused()
}

test.describe.configure({ mode: 'serial' })

test.beforeEach(async ({ request }) => {
	await reposerOrdreDuSeed(request)
})

test.afterEach(async ({ request }) => {
	await reposerOrdreDuSeed(request)
})

test('à la souris : glisser « Checklists » en tête ; l’ordre est écrit en base et tient au rechargement', async ({
	page,
	request,
}) => {
	await connecterAvecLeLabs(page, ADMIN)
	await page.goto(CHEMIN)
	await expect.poll(() => ordreAffiche(page)).toEqual(NOMS_DU_SEED)
	await expect(barre(page).getByTestId('poignee-onglet')).toHaveCount(3)
	await expect(barre(page).getByRole('link', { name: 'Réorganiser' })).toBeVisible()
	await capturer(page, 'barre-poignees-xl-1440', UNITE)

	// Le repère d'insertion, pendant le glisser : capturé à mi-geste.
	const cible = barre(page).getByTestId('element-onglet').first()
	const depart = await poignee(page, 'Checklists').boundingBox()
	const arrivee = await cible.boundingBox()
	await page.mouse.move(depart!.x + depart!.width / 2, depart!.y + depart!.height / 2)
	await page.mouse.down()
	await page.mouse.move(arrivee!.x + 6, arrivee!.y + arrivee!.height / 2, { steps: 8 })
	// Chromium traite les survols d'un glisser en différé : deux petits pas sur place laissent le dernier arriver.
	await page.mouse.move(arrivee!.x + 7, arrivee!.y + arrivee!.height / 2)
	await page.mouse.move(arrivee!.x + 6, arrivee!.y + arrivee!.height / 2)
	// Le repère est AVANT le premier onglet — attendu là, et non sur un survol intermédiaire, avant la capture.
	await expect(cible.getByTestId('repere-insertion')).toHaveCount(1)
	await capturer(page, 'barre-glisser-repere-xl-1440', UNITE)
	await page.mouse.up()

	await expect.poll(() => ordreAffiche(page)).toEqual(['Checklists', 'Refonte de site', 'Maintenance'])
	await expect(annonce(page)).toHaveText('« Checklists » placé au rang 1 sur 3.')
	await expect(barre(page).getByTestId('repere-insertion')).toHaveCount(0)
	expect(await ordreEnBase(request)).toEqual([ORDRE_DU_SEED[2], ORDRE_DU_SEED[0], ORDRE_DU_SEED[1]])

	// L'onglet ouvert ne change pas ; l'ordre tient au rechargement.
	await expect(page).toHaveURL(new RegExp(`${CHEMIN}$`))
	await page.reload()
	await expect.poll(() => ordreAffiche(page)).toEqual(['Checklists', 'Refonte de site', 'Maintenance'])
})

test('au clavier : Tab jusqu’à la poignée, Espace saisit, → déplace, Entrée pose ; Échap annule', async ({
	page,
	request,
}) => {
	await connecterAvecLeLabs(page, ADMIN)
	await page.goto(CHEMIN)
	await expect.poll(() => ordreAffiche(page)).toEqual(NOMS_DU_SEED)

	// Échap annule : rien n'est écrit.
	await tabVers(page, poignee(page, 'Maintenance'))
	await page.keyboard.press('Space')
	await expect(poignee(page, 'Maintenance')).toHaveAttribute('aria-pressed', 'true')
	await expect(annonce(page)).toContainText('« Maintenance » saisi, rang 2 sur 3.')
	await page.keyboard.press('ArrowLeft')
	await expect.poll(() => ordreAffiche(page)).toEqual(['Maintenance', 'Refonte de site', 'Checklists'])
	await expect(poignee(page, 'Maintenance')).toBeFocused()
	await capturer(page, 'barre-saisie-clavier-xl-1440', UNITE)
	await page.keyboard.press('Escape')
	await expect.poll(() => ordreAffiche(page)).toEqual(NOMS_DU_SEED)
	await expect(annonce(page)).toHaveText('Déplacement annulé.')
	expect(await ordreEnBase(request)).toEqual(ORDRE_DU_SEED)

	// Saisir, Fin, poser.
	await expect(poignee(page, 'Maintenance')).toBeFocused()
	await page.keyboard.press('Enter')
	await page.keyboard.press('End')
	await expect(annonce(page)).toHaveText('Rang 3 sur 3.')
	await page.keyboard.press('Enter')
	await expect(annonce(page)).toHaveText('« Maintenance » placé au rang 3 sur 3.')
	await expect.poll(() => ordreAffiche(page)).toEqual(['Refonte de site', 'Checklists', 'Maintenance'])
	await expect(poignee(page, 'Maintenance')).toBeFocused()
	expect(await ordreEnBase(request)).toEqual([ORDRE_DU_SEED[0], ORDRE_DU_SEED[2], ORDRE_DU_SEED[1]])
})

test('la lectrice : aucune poignée ; « Réorganiser » ouvre l’arborescence sur le track, en lecture seule', async ({
	page,
}) => {
	await connecterAvecLeLabs(page, LECTRICE)
	await page.goto(CHEMIN)
	await expect.poll(() => ordreAffiche(page)).toEqual(NOMS_DU_SEED)
	await expect(barre(page).getByTestId('poignee-onglet')).toHaveCount(0)
	const lien = barre(page).getByRole('link', { name: 'Réorganiser' })
	await expect(lien).toBeVisible()
	await lien.click()
	await expect(page).toHaveURL(/\/reglages\/arborescence$/)
	const replier = page.getByRole('button', { name: 'Replier Studio web' })
	await expect(replier).toHaveAttribute('aria-expanded', 'true')
	await expect(replier).toBeFocused()
	// En lecture seule : les flèches des channels sont rendues, éteintes, avec le motif (CRM-093).
	const channels = page.getByRole('list', { name: 'Channels du track Studio web' })
	await expect(channels.getByRole('button', { name: 'Descendre Refonte de site' })).toBeDisabled()
	await capturer(page, 'arborescence-lectrice-xl-1440', UNITE)
})

test('un refus est traduit sous la barre, et l’ordre d’avant revient (réponse substituée, nommée)', async ({ page }) => {
	// RÉPONSE SUBSTITUÉE (docs/DESIGN_SYSTEM.md §12.5) : un administrateur n'est pas refusé par la base ; le refus réel
	// du business developer et de la lectrice est prouvé hors interface par `e2e/api/reorganiser-channels.spec.ts`. Ici,
	// la traduction de ce refus par l'écran.
	await page.route('**/rest/v1/rpc/reorder_channels', (route) =>
		route.fulfill({
			status: 403,
			contentType: 'application/json',
			body: JSON.stringify({ code: '42501', message: 'channel_reorder_forbidden', details: null, hint: null }),
		}),
	)
	await connecterAvecLeLabs(page, ADMIN)
	await page.goto(CHEMIN)
	await expect.poll(() => ordreAffiche(page)).toEqual(NOMS_DU_SEED)
	await tabVers(page, poignee(page, 'Refonte de site'))
	await page.keyboard.press('Enter')
	await page.keyboard.press('ArrowRight')
	await page.keyboard.press('Enter')
	const refus = page.getByTestId('reorganisation-refus')
	await expect(refus).toHaveText('Seul un administrateur de cet espace de travail peut réorganiser les channels.')
	await expect(refus).toHaveAttribute('role', 'alert')
	await expect.poll(() => ordreAffiche(page)).toEqual(NOMS_DU_SEED)
	await capturer(page, 'barre-refus-xl-1440', UNITE)
	// Le 403 substitué, que l'écran vient de traduire : consommé, nommé, et seul.
	autoriserErreursConsole(page, [ERREUR_RESSOURCE_HTTP[403]])
})

test.describe('les quatre paliers', () => {
	for (const palier of PALIERS) {
		test(`palier ${palier.nom} : la barre, ses poignées et « Réorganiser » tiennent, sans défilement horizontal de la page`, async ({
			page,
		}) => {
			await page.setViewportSize({ width: palier.largeur, height: palier.hauteur })
			await connecterAvecLeLabs(page, ADMIN)
			await page.goto(CHEMIN)
			await expect.poll(() => ordreAffiche(page)).toEqual(NOMS_DU_SEED)
			await expect(barre(page).getByTestId('poignee-onglet')).toHaveCount(3)
			// Une poignée est une cible de 40 × 40 px (§8).
			const boite = await poignee(page, 'Maintenance').boundingBox()
			expect(boite!.width).toBeGreaterThanOrEqual(40)
			expect(boite!.height).toBeGreaterThanOrEqual(40)
			await capturer(page, `barre-palier-${palier.nom}`, UNITE)
			const largeurs = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth])
			expect(largeurs[0], 'la page ne défile jamais horizontalement (§7)').toBeLessThanOrEqual(largeurs[1]!)
		})
	}
})
