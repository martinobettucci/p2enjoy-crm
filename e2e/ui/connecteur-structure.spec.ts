// @verifies CRM-104 (docs/BACKLOG.md) — tranche T1 : l'effet des outils de structure, constaté dans la webapp
// @verifies docs/SPEC-mcp.md §9.2 quater (« un channel créé par le connecteur paraît dans la barre d'onglets du track »,
//           crm_channel_create, crm_workflow_get), §5 (sous l'identité de la personne) ; CLAUDE.md §16 (captures)
//
// Un VRAI client MCP crée un channel au nom de l'administratrice ; la webapp, sous le même compte, le montre dans la barre
// d'onglets du track. Les cases posées pour la preuve, et le channel, sont retirés à la fin.

import type { Browser } from '@playwright/test'
import { connecterAvecLeLabs, expect, test, type APIRequestContext } from './fixtures'
import { capturer } from './captures'
import { MOT_DE_PASSE_SEED, URL_API, enTetesService } from '../api/jetons'
import { RETOUR_CLIENT, SessionMcp, echangerCode, preparerAutorisation } from '../mcp/client'

const UNITE = 'CRM-104'
const ESPACE = '5eed0000-0000-4000-8000-000000000001'
const CAMILLE = { adresse: 'admin@p2enjoy.test', sub: '5eed0000-0000-4000-8000-000000000011' }
const CONSEIL = '5eed0000-0000-4000-8000-000000000021'
const GRANDS_COMPTES = '5eed0000-0000-4000-8000-000000000032'
const SLUG = 'e2e-mcp-canal'
const NOM = 'E2E MCP canal'
const CASES: readonly [string, string][] = [
	['structure', 'consulter'],
	['structure', 'ajouter'],
]
const rest = (chemin: string) => `${URL_API}/rest/v1/${chemin}`

test.use({ viewport: { width: 1440, height: 900 } })

async function retirer(request: APIRequestContext): Promise<void> {
	for (const [famille, action] of CASES) {
		await request.delete(rest(`mcp_droits?sub=eq.${CAMILLE.sub}&workspace_id=eq.${ESPACE}&famille=eq.${famille}&action=eq.${action}`), {
			headers: enTetesService(),
		})
	}
	await request.delete(rest(`channels?track_id=eq.${CONSEIL}&slug=eq.${SLUG}`), { headers: enTetesService() })
}

test.beforeEach(async ({ request }) => {
	await retirer(request)
	const pose = await request.post(rest('mcp_droits'), {
		headers: { ...enTetesService(), prefer: 'return=minimal' },
		data: CASES.map(([famille, action]) => ({ sub: CAMILLE.sub, workspace_id: ESPACE, famille, action })),
	})
	expect(pose.status()).toBe(201)
})

test.afterEach(async ({ request }) => retirer(request))

/** Un vrai client MCP connecté au nom de la personne, dans un autre contexte de navigateur que la webapp. */
async function sessionDe(browser: Browser, adresse: string): Promise<SessionMcp> {
	const contexte = await browser.newContext()
	try {
		const page = await contexte.newPage()
		const autorisation = await preparerAutorisation('Preuve de la structure du connecteur')
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

test('un channel créé par le connecteur paraît dans la barre d’onglets du track', async ({ page, browser }) => {
	const session = await sessionDe(browser, CAMILLE.adresse)
	const lu = await session.appeler('tools/call', { name: 'crm_channel_get', arguments: { channel_id: GRANDS_COMPTES } })
	expect(lu.isError ?? false, JSON.stringify(lu)).toBe(false)
	const workflow = lu.structuredContent.workflow.id as string
	const creation = await session.appeler('tools/call', {
		name: 'crm_channel_create',
		arguments: { track_id: CONSEIL, workflow_id: workflow, name: NOM, slug: SLUG },
	})
	expect(creation.isError ?? false, JSON.stringify(creation)).toBe(false)

	await connecterAvecLeLabs(page, CAMILLE.adresse)
	await page.goto('/tracks/conseil-ia')
	const onglet = page.getByRole('link', { name: NOM })
	await expect(onglet).toBeVisible()
	await capturer(page, 'connecteur-channel-onglets-1440', UNITE)
	await onglet.click()
	await expect(page).toHaveURL(/\/tracks\/conseil-ia\/e2e-mcp-canal/u)
	await expect(page.getByText('Aucune affaire à cette étape.').first()).toBeVisible()
})
