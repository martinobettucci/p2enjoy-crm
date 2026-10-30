// @verifies CRM-071 (docs/BACKLOG.md) — tranche T3 : une vue sauvegardée demandée par un vrai client MCP rend les mêmes
//           affaires que la même vue choisie à l'écran, au nom de la même personne
// @verifies docs/SPEC-mcp.md §9.2 quattuordecies (crm_view_list, l'argument `view` de crm_card_list ; preuve E2E), §5 (sous
//           l'identité de la personne) ; docs/SPEC-vues-import-export.md §4 ; docs/SPEC-seed.md §32 ; CLAUDE.md §16
//
// Le business developer reçoit la case « Affaires ▸ Consulter » ; son client MCP lit les vues de « Refonte de site » et liste
// les affaires de « Mes négociations ». La webapp, sous le même compte, choisit la même vue. La case est retirée à la fin ;
// aucune vue n'est écrite.

import type { Browser } from '@playwright/test'
import { connecterAvecLeLabs, expect, test, type APIRequestContext } from './fixtures'
import { capturer } from './captures'
import { MOT_DE_PASSE_SEED, URL_API, enTetesService } from '../api/jetons'
import { RETOUR_CLIENT, SessionMcp, echangerCode, preparerAutorisation } from '../mcp/client'

const ESPACE = '5eed0000-0000-4000-8000-000000000001'
const DRISS = { adresse: 'bizdev@p2enjoy.test', sub: '5eed0000-0000-4000-8000-000000000012' }
const REFONTE = '5eed0000-0000-4000-8000-000000000034'
const rest = (chemin: string) => `${URL_API}/rest/v1/${chemin}`

test.use({ viewport: { width: 1440, height: 1000 } })

async function retirer(request: APIRequestContext): Promise<void> {
	await request.delete(rest(`mcp_droits?sub=eq.${DRISS.sub}&workspace_id=eq.${ESPACE}&famille=eq.affaires&action=eq.consulter`), {
		headers: enTetesService(),
	})
}

test.beforeEach(async ({ request }) => {
	await retirer(request)
	const pose = await request.post(rest('mcp_droits'), {
		headers: { ...enTetesService(), prefer: 'return=minimal' },
		data: [{ sub: DRISS.sub, workspace_id: ESPACE, famille: 'affaires', action: 'consulter' }],
	})
	expect(pose.status()).toBe(201)
})

test.afterEach(async ({ request }) => retirer(request))

/** Un vrai client MCP connecté au nom de la personne, dans un autre contexte de navigateur que la webapp. */
async function sessionDe(browser: Browser, adresse: string): Promise<SessionMcp> {
	const contexte = await browser.newContext()
	try {
		const page = await contexte.newPage()
		const autorisation = await preparerAutorisation('Preuve des vues du connecteur')
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
		return session
	} finally {
		await contexte.close()
	}
}

test('la vue « Mes négociations » rend les mêmes affaires au connecteur et à l’écran', async ({ page, browser }) => {
	const session = await sessionDe(browser, DRISS.adresse)
	const appeler = async (name: string, args: Record<string, unknown>) => {
		const resultat = await session.appeler('tools/call', { name, arguments: args })
		expect(resultat.isError ?? false, JSON.stringify(resultat)).toBe(false)
		return resultat.structuredContent
	}
	const vues = (await appeler('crm_view_list', { channel_id: REFONTE })).views as { name: string; visibility: string }[]
	expect(vues.map((v) => [v.name, v.visibility])).toEqual([
		['Mes négociations', 'private'],
		['Secteur public, par échéance', 'workspace'],
	])
	const liste = await appeler('crm_card_list', { workspace: 'p2enjoy', view: 'Mes négociations' })
	const auConnecteur = (liste.cards as { title: string }[]).map((c) => c.title)
	expect(auConnecteur.length).toBeGreaterThan(0)

	await connecterAvecLeLabs(page, DRISS.adresse)
	await page.goto('/tracks/studio-web/refonte/liste')
	await page.getByRole('combobox', { name: 'Vue', exact: true }).selectOption({ label: 'Mes négociations' })
	await expect(page).toHaveURL(/vue=/)
	const lignes = page.getByTestId('ligne-card')
	await expect(lignes).toHaveCount(auConnecteur.length)
	const titres = await page.getByTestId('ligne-card').evaluateAll((elements) =>
		elements.map((e) => (e.querySelector('a')?.getAttribute('title') ?? e.querySelector('a')?.textContent ?? '').trim()),
	)
	// Même ensemble, et même ordre : la vue trie par échéance, à l'écran comme au connecteur.
	expect(titres).toEqual(auConnecteur)
	await capturer(page, 'connecteur-vue-1440', 'CRM-071')
})
