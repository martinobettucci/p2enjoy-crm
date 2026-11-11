// @verifies CRM-134 (docs/BACKLOG.md) tranche T1 — archiver un channel depuis sa vue, et le retrouver dans le groupe
//           « Archivés » replié de la barre d'onglets, de bout en bout sur la pile réelle, à la souris et au clavier
// @verifies docs/SPEC-channels.md §11.2 (la confirmation dans le flux, `Échap` et « Annuler », la vue qui passe au
//           channel suivant, à défaut au précédent, l'annonce, le focus au groupe), §11.3 (le groupe et son compte, le
//           panneau, les noms non cliquables, désarchiver sans confirmation, l'onglet qui revient, le focus), §11.4 (la
//           lectrice : le groupe visible là où elle lit l'archivé, absent là où la RLS le lui ferme, les commandes éteintes
//           avec leur motif ; la requête directe est
//           `e2e/api/channels-archivage.spec.ts`), §11.6 (le seed : « Appels d'offres » archivé dans « Conseil & IA ») ;
//           docs/DESIGN_SYSTEM.md §5.101, §7 (aucun défilement horizontal aux quatre paliers) ; CLAUDE.md §16 (captures)
//
// LES CHANNELS ARCHIVÉS PAR CES SCÉNARIOS SONT DES SONDES PROPRES AU FICHIER, créées par la clé de service dans
// « Formation » et retirées à la fin quoi qu'il arrive : archiver un channel du seed ferait disparaître un onglet sous les
// preuves qui tournent en même temps. Le seed n'est que LU : « Appels d'offres », archivé dans « Conseil & IA ».

import type { APIRequestContext } from '@playwright/test'
import { CLE_SERVICE, URL_API } from '../api/jetons'
import { connecterAvecLeLabs, expect, test, type Page } from './fixtures'
import { PALIERS, capturer } from './captures'

const UNITE = 'CRM-134'
const ADMIN = 'admin@p2enjoy.test'
const VIEWER = 'viewer@p2enjoy.test'
const WORKSPACE_SEED = '5eed0000-0000-4000-8000-000000000001'
const WORKFLOW_SEED = '5eed0000-0000-4000-8000-000000000051'
const TRACK_FORMATION = '5eed0000-0000-4000-8000-000000000023'
const SERVICE = { apikey: CLE_SERVICE, Authorization: `Bearer ${CLE_SERVICE}` }

test.describe.configure({ mode: 'serial' })

const suffixe = Date.now().toString(36)
const SONDE_A = { nom: `Sonde A ${suffixe}`, slug: `sonde-a-${suffixe}`, position: 998 }
const SONDE_B = { nom: `Sonde B ${suffixe}`, slug: `sonde-b-${suffixe}`, position: 999 }
const ids: string[] = []

async function service(playwright: { request: { newContext: (o: object) => Promise<APIRequestContext> } }) {
	return playwright.request.newContext({ baseURL: URL_API, extraHTTPHeaders: SERVICE })
}

test.beforeAll(async ({ playwright }) => {
	const contexte = await service(playwright)
	for (const sonde of [SONDE_A, SONDE_B]) {
		const reponse = await contexte.post('/rest/v1/channels', {
			headers: { Prefer: 'return=representation' },
			data: {
				workspace_id: WORKSPACE_SEED,
				track_id: TRACK_FORMATION,
				workflow_id: WORKFLOW_SEED,
				name: sonde.nom,
				slug: sonde.slug,
				position: sonde.position,
				color: 'brand',
			},
		})
		expect(reponse.status(), await reponse.text()).toBe(201)
		ids.push(((await reponse.json()) as { id: string }[])[0]!.id)
	}
	await contexte.dispose()
})

test.afterAll(async ({ playwright }) => {
	const contexte = await service(playwright)
	for (const id of ids) await contexte.delete(`/rest/v1/channels?id=eq.${id}`)
	await contexte.dispose()
})

const onglet = (page: Page, slug: string) => page.locator(`[data-testid="onglet-channel"][data-slug="${slug}"]`)
const annonce = (page: Page, texte: string) => page.getByTestId('region-annonces').filter({ hasText: texte })
const sansDefilementHorizontal = (page: Page) =>
	page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)

/** Tabule jusqu'à l'élément de ce `data-testid` : le parcours est fait au clavier, sans focalisation programmée. */
async function tabulerJusqua(page: Page, testId: string, maximum = 120): Promise<void> {
	for (let pas = 0; pas < maximum; pas += 1) {
		await page.keyboard.press('Tab')
		if ((await page.evaluate(() => document.activeElement?.getAttribute('data-testid') ?? '')) === testId) return
	}
	throw new Error(`« ${testId} » n'est pas atteint au clavier en ${maximum} tabulations`)
}

test.describe('archiver depuis la vue, puis désarchiver (docs/SPEC-channels.md §11.2, §11.3)', () => {
	test('à la souris : confirmer, la vue passe au channel SUIVANT, le groupe le montre, « Désarchiver » le rend', async ({
		page,
	}) => {
		await connecterAvecLeLabs(page, ADMIN)
		await page.goto(`/tracks/formation/${SONDE_A.slug}`)
		await expect(onglet(page, SONDE_A.slug)).toHaveAttribute('aria-current', 'page')
		// « Formation » n'a aucun archivé dans le seed : pas de groupe.
		await expect(page.getByTestId('groupe-archives')).toHaveCount(0)

		// « Annuler » referme sans rien écrire, et rend le focus à la commande.
		const commande = page.getByTestId('commande-archiver-channel')
		await commande.click()
		const confirmation = page.getByTestId('confirmation-archivage')
		await expect(confirmation).toContainText(`Archiver le channel « ${SONDE_A.nom} » ?`)
		await expect(confirmation).toContainText('pour tout l')
		await capturer(page, 'archiver-confirmation-1440', UNITE)
		await confirmation.getByRole('button', { name: 'Annuler' }).click()
		await expect(confirmation).toHaveCount(0)
		await expect(commande).toBeFocused()
		await expect(onglet(page, SONDE_A.slug)).toHaveCount(1)

		// Confirmer : l'onglet part, la vue passe au channel qui le SUIVAIT, l'annonce le dit, le focus va au groupe.
		await commande.click()
		await page.getByTestId('confirmation-archivage').getByRole('button', { name: 'Archiver' }).click()
		await expect(page).toHaveURL(new RegExp(`/tracks/formation/${SONDE_B.slug}$`))
		await expect(onglet(page, SONDE_A.slug)).toHaveCount(0)
		await expect(annonce(page, `« ${SONDE_A.nom} » est archivé`)).toHaveCount(1)
		const groupe = page.getByTestId('groupe-archives')
		await expect(groupe).toHaveText('Archivés (1)')
		await expect(groupe).toBeFocused()
		await expect(groupe).toHaveAttribute('aria-expanded', 'false')

		// Déplier : le panneau en tête de la zone principale, le nom sans lien, la mention « Archivé ».
		await groupe.click()
		await expect(groupe).toHaveAttribute('aria-expanded', 'true')
		await expect(page).toHaveURL(/archives=1/)
		const panneau = page.getByTestId('panneau-archives')
		await expect(panneau.getByRole('heading', { level: 2, name: 'Channels archivés de ce track' })).toBeVisible()
		const ligne = panneau.getByTestId('ligne-channel-archive')
		await expect(ligne).toHaveCount(1)
		await expect(ligne).toContainText(SONDE_A.nom)
		await expect(ligne).toContainText('Archivé')
		await expect(ligne.locator('a')).toHaveCount(0)
		await capturer(page, 'archives-panneau-1440', UNITE)

		// Désarchiver, sans confirmation : l'onglet revient, le groupe et le panneau disparaissent, le focus va à l'onglet.
		await ligne.getByRole('button', { name: `Désarchiver le channel ${SONDE_A.nom}` }).click()
		await expect(onglet(page, SONDE_A.slug)).toHaveCount(1)
		await expect(annonce(page, `« ${SONDE_A.nom} » est désarchivé`)).toHaveCount(1)
		await expect(page.getByTestId('groupe-archives')).toHaveCount(0)
		await expect(page.getByTestId('panneau-archives')).toHaveCount(0)
		await expect(page).not.toHaveURL(/archives=1/)
		await expect(onglet(page, SONDE_A.slug)).toBeFocused()
	})

	test('au clavier : `Échap` referme ; le DERNIER onglet archivé fait passer au PRÉCÉDENT ; tout se rend au clavier', async ({
		page,
	}) => {
		await connecterAvecLeLabs(page, ADMIN)
		await page.goto(`/tracks/formation/${SONDE_B.slug}`)
		await expect(onglet(page, SONDE_B.slug)).toHaveAttribute('aria-current', 'page')

		await tabulerJusqua(page, 'commande-archiver-channel')
		await page.keyboard.press('Enter')
		const archiver = page.getByTestId('confirmation-archivage').getByRole('button', { name: 'Archiver' })
		await expect(archiver).toBeFocused()
		await page.keyboard.press('Escape')
		await expect(page.getByTestId('confirmation-archivage')).toHaveCount(0)
		await expect(page.getByTestId('commande-archiver-channel')).toBeFocused()

		await page.keyboard.press('Enter')
		await expect(archiver).toBeFocused()
		await page.keyboard.press('Enter')
		// « Sonde B » était le dernier onglet : la vue passe à celui qui le PRÉCÉDAIT.
		await expect(page).toHaveURL(new RegExp(`/tracks/formation/${SONDE_A.slug}$`))
		await expect(onglet(page, SONDE_B.slug)).toHaveCount(0)
		const groupe = page.getByTestId('groupe-archives')
		await expect(groupe).toBeFocused()
		await page.keyboard.press('Enter')
		await expect(groupe).toHaveAttribute('aria-expanded', 'true')

		await tabulerJusqua(page, 'desarchiver-channel')
		await page.keyboard.press('Enter')
		await expect(onglet(page, SONDE_B.slug)).toHaveCount(1)
		await expect(onglet(page, SONDE_B.slug)).toBeFocused()
		await expect(page.getByTestId('groupe-archives')).toHaveCount(0)
	})
})

test.describe('la lectrice (docs/SPEC-channels.md §11.4)', () => {
	// MESURÉ à l'écriture de la preuve : la lectrice du seed est privée de « Conseil & IA » (`track_members.access =
	// 'none'`), « Prospection » seul lui étant rouvert ; elle ne lit donc pas « Appels d'offres », et le groupe n'y paraît
	// pas pour elle — c'est la RLS, et c'est juste. Le scénario se joue dans « Formation », qu'elle lit : la sonde A y est
	// archivée par la clé de service le temps du scénario, puis rendue.
	test('voit le groupe et l’archivé ; « Archiver le channel » et « Désarchiver » sont éteints avec leur motif', async ({
		page,
		playwright,
	}) => {
		const contexte = await service(playwright)
		const poser = (archive: boolean) =>
			contexte.patch(`/rest/v1/channels?id=eq.${ids[0]}`, { data: { archived_at: archive ? new Date().toISOString() : null } })
		expect((await poser(true)).status()).toBe(204)
		try {
			await connecterAvecLeLabs(page, VIEWER)
			await page.goto(`/tracks/formation/${SONDE_B.slug}`)
			const commande = page.getByTestId('commande-archiver-channel')
			await expect(commande).toBeDisabled()
			await expect(commande).toHaveAttribute('aria-describedby', /.+/)
			const groupe = page.getByTestId('groupe-archives')
			await expect(groupe).toHaveText('Archivés (1)')
			await groupe.click()
			const panneau = page.getByTestId('panneau-archives')
			await expect(panneau.getByTestId('ligne-channel-archive')).toContainText(SONDE_A.nom)
			await expect(panneau.getByTestId('motif-lecture-seule')).toBeVisible()
			await expect(panneau.getByTestId('desarchiver-channel')).toBeDisabled()
			await capturer(page, 'archives-lectrice-1440', UNITE)
		} finally {
			await poser(false)
			await contexte.dispose()
		}
	})

	test('ne voit PAS l’archivé d’un track qui lui est fermé : « Conseil & IA », où le seed archive « Appels d’offres »', async ({
		page,
	}) => {
		await connecterAvecLeLabs(page, VIEWER)
		await page.goto('/tracks/conseil-ia/prospection')
		await expect(page.getByTestId('commande-archiver-channel')).toBeDisabled()
		await expect(page.getByTestId('groupe-archives')).toHaveCount(0)
	})
})

test.describe('les paliers (docs/DESIGN_SYSTEM.md §7)', () => {
	for (const palier of PALIERS) {
		test(`aucun défilement horizontal : la barre d’outils, la confirmation, le groupe et le panneau — ${palier.nom}`, async ({
			page,
		}) => {
			await page.setViewportSize({ width: palier.largeur, height: palier.hauteur })
			await connecterAvecLeLabs(page, ADMIN)
			await page.goto('/tracks/conseil-ia/prospection?archives=1')
			await expect(page.getByTestId('panneau-archives')).toBeVisible()
			await page.getByTestId('commande-archiver-channel').click()
			await expect(page.getByTestId('confirmation-archivage')).toBeVisible()
			await capturer(page, `archives-${palier.nom}`, UNITE)
			expect(await sansDefilementHorizontal(page)).toBeLessThanOrEqual(0)
			// Rien n'est archivé : la confirmation est refermée sans écrire.
			await page.keyboard.press('Escape')
			await expect(page.getByTestId('confirmation-archivage')).toHaveCount(0)
		})
	}
})
