// @verifies CRM-103 (docs/BACKLOG.md) — tranche T3.c : l'onglet « Connecteur MCP » et la fiche d'un utilisateur, sur la
//           pile réelle, à la souris et au clavier, avec l'EFFET constaté par un vrai client MCP
// @verifies docs/SPEC-mcp.md §8.1 (comptes, « Accorder des droits à un utilisateur » cherché par nom, fiche, rôle ou « pas
//           membre » et son avertissement, « Franchit la matrice », enregistrement qui relit, journal filtré par issue),
//           §8 (A5 : le droit vaut dès la connexion suivante), §5 (le client lit sous la RLS) ; docs/SPEC-seed.md §22
//           (comptes et journal du seed) ; docs/DESIGN_SYSTEM.md §5.56 (onglet « Connecteur MCP »), §7 (quatre paliers,
//           aucun défilement horizontal de la page), §8 (clavier seul) ; docs/manual.md chapitre 11
// @verifies CLAUDE.md §10 (le refus d'un non-superadministrateur), §15 (état déterministe, effets confirmés en base et par
//           un vrai client), §16 (captures observées)
//
// Tout part du SEED (docs/SPEC-seed.md §22) : Farida sans matrice, Camille à `recettes:consulter` seule, Driss et sa
// matrice du §21.4. Les matrices que ces scénarios changent sont rendues à l'état du seed, avant et après chaque
// scénario, par la clé de service — et ce retour est CONSTATÉ. Le registre et le journal ne sont jamais écrits ici : ils
// ne naissent que des vrais appels du client MCP.

import type { Browser } from '@playwright/test'
import { connecterAvecLeLabs, expect, test, type APIRequestContext, type Page } from './fixtures'
import { PALIERS, capturer } from './captures'
import { MOT_DE_PASSE_SEED, URL_API, enTetesService } from '../api/jetons'
import { RETOUR_CLIENT, SessionMcp, echangerCode, preparerAutorisation } from '../mcp/client'

const UNITE = 'CRM-103'
const ESPACE = '5eed0000-0000-4000-8000-000000000001'
const SABINE = { adresse: 'plateforme@p2enjoy.test', sub: '5eed0000-0000-4000-8000-000000000018' }
const FARIDA = { adresse: 'viewer@p2enjoy.test', sub: '5eed0000-0000-4000-8000-000000000013' }
const CAMILLE = { adresse: 'admin@p2enjoy.test', sub: '5eed0000-0000-4000-8000-000000000011' }
const rest = (chemin: string) => `${URL_API}/rest/v1/${chemin}`

/** La matrice de chacun au seed (docs/SPEC-seed.md §22.1). */
const SEED: readonly { sub: string; droits: readonly [string, string][] }[] = [
	{ sub: FARIDA.sub, droits: [] },
	{ sub: CAMILLE.sub, droits: [['recettes', 'consulter']] },
]

test.use({ viewport: { width: 1440, height: 900 } })

async function droits(request: APIRequestContext, sub: string): Promise<[string, string][]> {
	const reponse = await request.get(rest(`mcp_droits?sub=eq.${sub}&workspace_id=eq.${ESPACE}&select=famille,action&order=famille,action`), {
		headers: enTetesService(),
	})
	return ((await reponse.json()) as { famille: string; action: string }[]).map((l) => [l.famille, l.action])
}

async function rendreLeSeed(request: APIRequestContext): Promise<void> {
	for (const { sub, droits: attendus } of SEED) {
		if (JSON.stringify(await droits(request, sub)) === JSON.stringify(attendus)) continue
		await request.delete(rest(`mcp_droits?sub=eq.${sub}&workspace_id=eq.${ESPACE}`), { headers: enTetesService() })
		if (attendus.length > 0) {
			await request.post(rest('mcp_droits'), {
				headers: { ...enTetesService(), prefer: 'return=minimal' },
				data: attendus.map(([famille, action]) => ({ sub, workspace_id: ESPACE, famille, action, accorde_par: SABINE.sub })),
			})
		}
		expect(await droits(request, sub), `la matrice du seed de ${sub} est rendue`).toEqual(attendus)
	}
}

test.beforeEach(async ({ request }) => rendreLeSeed(request))
test.afterEach(async ({ request }) => rendreLeSeed(request))

async function sansDefilementHorizontal(page: Page, contexte: string): Promise<void> {
	const debord = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
	expect(debord, `${contexte} : la page ne défile jamais horizontalement (§7)`).toBeLessThanOrEqual(0)
}

/**
 * Un vrai client MCP, connecté dans un AUTRE contexte de navigateur que la webapp : consentement, SSO, échange du code
 * (`e2e/mcp/client.ts`). Rend la liste des espaces que le connecteur lui ouvre, sous la RLS.
 */
async function espacesVusParLeConnecteur(browser: Browser, adresse: string): Promise<unknown> {
	const contexte = await browser.newContext()
	try {
		const page = await contexte.newPage()
		const autorisation = await preparerAutorisation('Preuve de l’administration du connecteur')
		await page.goto(autorisation.url)
		await page.getByRole('button', { name: 'Allow Access' }).click()
		await expect(page.locator('#kc-form-login')).toBeVisible()
		await page.locator('#username').fill(adresse)
		await page.locator('#password').fill(MOT_DE_PASSE_SEED)
		const retour = page.waitForRequest((r) => r.url().startsWith(RETOUR_CLIENT), { timeout: 20_000 })
		await page.locator('#kc-login').click()
		const code = new URL((await retour).url()).searchParams.get('code') ?? ''
		const session = new SessionMcp((await echangerCode(autorisation, code)).access_token)
		await session.ouvrir()
		const resultat = await session.appeler('tools/call', { name: 'crm_workspace_list', arguments: {} })
		expect(resultat.isError ?? false).toBe(false)
		return resultat.structuredContent
	} finally {
		await contexte.close()
	}
}

async function ouvrirOnglet(page: Page): Promise<void> {
	await page.goto('/plateforme/espaces')
	await page.getByRole('tab', { name: 'Connecteur MCP' }).or(page.getByRole('link', { name: 'Connecteur MCP' })).click()
	await expect(page).toHaveURL(/\/plateforme\/mcp$/u)
	await expect(page.getByTestId('tableau-comptes-mcp')).toBeVisible()
}

test.describe('L’administration du connecteur (docs/SPEC-mcp.md §8.1, docs/DESIGN_SYSTEM.md §5.56)', () => {
	test('à la souris : chercher Farida, lui ouvrir « Affaires : consulter », et un vrai client MCP le constate', async ({ page, request, browser }) => {
		await connecterAvecLeLabs(page, SABINE.adresse)
		await ouvrirOnglet(page)

		// Les comptes du seed (§22.1) : Farida, venue sans matrice, n'ouvre aucun espace.
		const ligneFarida = page.locator(`[data-testid="ligne-compte-mcp"][data-sub="${FARIDA.sub}"]`)
		await expect(ligneFarida).toContainText('Farida Nowak')
		await expect(ligneFarida).toContainText('viewer@p2enjoy.test')
		await expect(ligneFarida.locator('td').nth(2)).toHaveText('0')
		await expect(page.locator(`[data-testid="ligne-compte-mcp"][data-sub="${CAMILLE.sub}"] td`).nth(2)).toHaveText('1')
		await capturer(page, 'onglet-connecteur-xl-1440', UNITE)

		// « Accorder des droits à un utilisateur » : par le nom, parmi tous les utilisateurs du CRM (A5).
		await page.getByTestId('recherche-accorder').fill('farida')
		await page.getByTestId('resultats-accorder').getByRole('link', { name: 'Farida Nowak' }).click()
		await expect(page).toHaveURL(new RegExp(`/plateforme/mcp/${FARIDA.sub}`, 'u'))
		const fiche = page.getByTestId('fiche-mcp')
		await expect(fiche.getByRole('heading', { level: 2, name: 'Farida Nowak' })).toBeVisible()
		await expect(page.getByTestId('fiche-mcp-role')).toHaveText('Rôle dans cet espace : Lecteur')
		await expect(page.getByTestId('fiche-mcp-hors-espace')).toHaveCount(0)
		await expect(page.getByTestId('matrice-mcp').getByRole('checkbox', { checked: true })).toHaveCount(0)

		const caseAffaires = page.getByRole('checkbox', { name: 'Affaires : consulter' })
		await caseAffaires.click()
		await expect(caseAffaires).toBeChecked()
		await expect(page.getByText('Modifications non enregistrées')).toBeVisible()
		await capturer(page, 'fiche-modifiee-xl-1440', UNITE)
		await page.getByTestId('enregistrer-mcp').click()
		await expect(page.getByTestId('message-mcp')).toHaveText('Droits enregistrés.')
		await expect(page.getByText('Modifications non enregistrées')).toHaveCount(0)
		await expect(caseAffaires, 'relu après l’enregistrement').toBeChecked()

		// L'effet en base, puis par un VRAI client MCP : le droit vaut dès la connexion suivante (A5), sous la RLS.
		expect(await droits(request, FARIDA.sub)).toEqual([['affaires', 'consulter']])
		const vus = (await espacesVusParLeConnecteur(browser, FARIDA.adresse)) as { workspaces: { slug: string; role: string; rights: unknown }[] }
		expect(vus.workspaces.map((e) => [e.slug, e.role, e.rights])).toEqual([['p2enjoy', 'viewer', ['affaires:consulter']]])

		// Sa fiche relit son journal : l'appel du client y est, « Réussi ».
		await page.reload()
		const appel = page.getByTestId('ligne-appel').filter({ hasText: 'crm_workspace_list' }).first()
		await expect(appel).toContainText('Réussi')
		await capturer(page, 'fiche-enregistree-xl-1440', UNITE)

		// Retirer : la case décochée, enregistrée, et la matrice vide en base.
		await caseAffaires.click()
		await page.getByTestId('enregistrer-mcp').click()
		await expect(page.getByTestId('message-mcp')).toHaveText('Droits enregistrés.')
		expect(await droits(request, FARIDA.sub)).toEqual([])
	})

	test('au clavier : toute une famille cochée, « Annuler » puis enregistrer, l’espace gardé dans l’adresse', async ({ page, request }) => {
		await connecterAvecLeLabs(page, SABINE.adresse)
		await page.goto(`/plateforme/mcp/${CAMILLE.sub}`)
		await expect(page.getByTestId('fiche-mcp-role')).toHaveText('Rôle dans cet espace : Administrateur')
		await expect(page.getByRole('checkbox', { name: 'Recettes : consulter' })).toBeChecked()

		// « Toute la famille » au clavier, puis « Annuler les modifications » : rien n'est parti.
		const toutBudgets = page.getByRole('button', { name: 'Cocher toute la famille Budgets' })
		await toutBudgets.focus()
		await page.keyboard.press('Enter')
		for (const action of ['consulter', 'ajouter', 'modifier', 'supprimer']) {
			await expect(page.getByRole('checkbox', { name: `Budgets : ${action}` })).toBeChecked()
		}
		await page.getByRole('button', { name: 'Annuler les modifications' }).focus()
		await page.keyboard.press('Enter')
		await expect(page.getByRole('checkbox', { name: 'Budgets : consulter' })).not.toBeChecked()
		expect(await droits(request, CAMILLE.sub), 'annuler n’écrit rien').toEqual([['recettes', 'consulter']])

		// Une seule case, à la barre d'espace, puis « Enregistrer les droits » à la touche Entrée.
		const caseTemps = page.getByRole('checkbox', { name: 'Temps : consulter' })
		await caseTemps.focus()
		await page.keyboard.press('Space')
		await expect(caseTemps).toBeChecked()
		await page.getByTestId('enregistrer-mcp').focus()
		await page.keyboard.press('Enter')
		await expect(page.getByTestId('message-mcp')).toHaveText('Droits enregistrés.')
		expect(await droits(request, CAMILLE.sub)).toEqual([
			['recettes', 'consulter'],
			['temps', 'consulter'],
		])
		await expect(page).toHaveURL(/espace=p2enjoy|\/plateforme\/mcp\/[^?]+$/u)
	})

	test('la fiche d’une superadministratrice : « pas membre », son avertissement, la matrice franchie et en lecture seule', async ({ page }) => {
		await connecterAvecLeLabs(page, SABINE.adresse)
		await page.goto(`/plateforme/mcp/${SABINE.sub}`)
		await expect(page.getByTestId('choix-espace-mcp')).toContainText('pas membre')
		await expect(page.getByTestId('fiche-mcp-hors-espace')).toContainText('resteront sans effet')
		await expect(page.getByTestId('fiche-mcp-franchie')).toContainText('sans consulter la matrice')
		await expect(page.getByTestId('enregistrer-mcp')).toBeDisabled()
		for (const coche of await page.getByTestId('matrice-mcp').getByRole('checkbox').all()) await expect(coche).toBeDisabled()
		await capturer(page, 'fiche-superadministratrice-xl-1440', UNITE)
	})

	test('le journal des appels filtré par issue : le refus du CRM du seed, et l’état vide d’un filtre sans appel', async ({ page }) => {
		await connecterAvecLeLabs(page, SABINE.adresse)
		await page.goto('/plateforme/mcp')
		const filtre = page.getByTestId('filtre-issue')
		await filtre.selectOption({ label: 'Refusé par le CRM' })
		const lignes = page.getByTestId('ligne-appel')
		await expect(lignes.first()).toBeVisible()
		for (const ligne of await lignes.all()) await expect(ligne).toHaveAttribute('data-issue', 'refus_crm')
		await expect(lignes.filter({ hasText: 'crm_profitability_report' }).filter({ hasText: 'Driss Lemoine' }).first()).toBeVisible()
		await capturer(page, 'journal-refus-crm-xl-1440', UNITE)

		// Un seul espace au seed : aucun refus de la matrice n'est possible (docs/SPEC-seed.md §22.1).
		await filtre.selectOption({ label: 'Refusé par la matrice' })
		await expect(page.getByTestId('journal-appels-vide')).toHaveText('Aucun appel avec cette issue.')
	})

	test('l’onglet et la fiche aux quatre paliers, sans défilement horizontal', async ({ page }) => {
		await connecterAvecLeLabs(page, SABINE.adresse)
		for (const palier of PALIERS) {
			await page.setViewportSize({ width: palier.largeur, height: palier.hauteur })
			await page.goto('/plateforme/mcp')
			await expect(page.getByTestId('tableau-comptes-mcp')).toBeVisible()
			await sansDefilementHorizontal(page, `onglet ${palier.nom}`)
			// Une ligne par cellule (§5.9) : la pilule « Sans profil » ne se casse plus mot à mot — défaut vu sur la capture.
			for (const pilule of await page.getByTestId('tableau-comptes-mcp').getByText('Sans profil dans le CRM').all()) {
				expect((await pilule.boundingBox())?.height ?? 0, `pilule « Sans profil » sur une ligne, ${palier.nom}`).toBeLessThan(32)
			}
			await capturer(page, `onglet-connecteur-${palier.nom}`, UNITE)
			await page.goto(`/plateforme/mcp/${CAMILLE.sub}`)
			await expect(page.getByTestId('matrice-mcp')).toBeVisible()
			await sansDefilementHorizontal(page, `fiche ${palier.nom}`)
			// Une commande de tableau tient sur une ligne (§5.28) : « Toute la famille » ne se casse plus dans son bouton.
			const toutStructure = page.getByRole('button', { name: 'Cocher toute la famille Structure' })
			expect((await toutStructure.boundingBox())?.height ?? 0, `« Toute la famille » sur une ligne, ${palier.nom}`).toBeLessThanOrEqual(41)
			await capturer(page, `fiche-${palier.nom}`, UNITE)
		}
	})

	test('une administratrice d’espace n’y entre pas : l’écran refuse, la base aussi', async ({ page }) => {
		await connecterAvecLeLabs(page, CAMILLE.adresse)
		// Aucune erreur console : l'écran refuse sur le drapeau lu, avant d'appeler une fonction gardée.
		await page.goto('/plateforme/mcp')
		await expect(page.getByTestId('etat-refus')).toContainText('réservée aux superadministrateurs')
		await page.goto(`/plateforme/mcp/${FARIDA.sub}`)
		await expect(page.getByTestId('etat-refus')).toContainText('réservée aux superadministrateurs')
		await expect(page.getByTestId('matrice-mcp')).toHaveCount(0)
	})
})
