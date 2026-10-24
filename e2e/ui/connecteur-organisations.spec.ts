// @verifies CRM-114 (docs/BACKLOG.md) — tranche T4 : l'effet des outils de la famille `organizations`, constaté dans la
//           webapp
// @verifies docs/SPEC-mcp.md §9.2 sexies (« une organisation créée par le connecteur paraît dans l'onglet
//           « Organisations » », crm_organization_create, domaine en minuscules) ; docs/SPEC-organisations.md §6 ;
//           CLAUDE.md §16 (captures)
//
// Un VRAI client MCP crée une organisation au nom du business developer ; l'onglet « Organisations » de la webapp, sous le
// même compte, la liste. Les cases posées pour la preuve, et l'organisation, sont retirées à la fin.

import type { Browser } from '@playwright/test'
import { connecterAvecLeLabs, expect, test, type APIRequestContext } from './fixtures'
import { capturer } from './captures'
import { MOT_DE_PASSE_SEED, URL_API, enTetesService } from '../api/jetons'
import { RETOUR_CLIENT, SessionMcp, echangerCode, preparerAutorisation } from '../mcp/client'

const UNITE = 'CRM-114'
const ESPACE = '5eed0000-0000-4000-8000-000000000001'
const DRISS = { adresse: 'bizdev@p2enjoy.test', sub: '5eed0000-0000-4000-8000-000000000012' }
const NOM = 'E2E MCP Organisation'
const CASES: readonly [string, string][] = [
	['organizations', 'consulter'],
	['organizations', 'ajouter'],
]
const rest = (chemin: string) => `${URL_API}/rest/v1/${chemin}`

test.use({ viewport: { width: 1440, height: 900 } })

async function retirer(request: APIRequestContext): Promise<void> {
	for (const [famille, action] of CASES) {
		await request.delete(rest(`mcp_droits?sub=eq.${DRISS.sub}&workspace_id=eq.${ESPACE}&famille=eq.${famille}&action=eq.${action}`), {
			headers: enTetesService(),
		})
	}
	await request.delete(rest(`organizations?workspace_id=eq.${ESPACE}&name=eq.${encodeURIComponent(NOM)}`), { headers: enTetesService() })
}

test.beforeEach(async ({ request }) => {
	await retirer(request)
	const pose = await request.post(rest('mcp_droits'), {
		headers: { ...enTetesService(), prefer: 'return=minimal' },
		data: CASES.map(([famille, action]) => ({ sub: DRISS.sub, workspace_id: ESPACE, famille, action })),
	})
	expect(pose.status()).toBe(201)
})

test.afterEach(async ({ request }) => retirer(request))

/** Un vrai client MCP connecté au nom de la personne, dans un autre contexte de navigateur que la webapp. */
async function sessionDe(browser: Browser, adresse: string): Promise<SessionMcp> {
	const contexte = await browser.newContext()
	try {
		const page = await contexte.newPage()
		const autorisation = await preparerAutorisation('Preuve des organisations du connecteur')
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

test('une organisation créée par le connecteur paraît dans l’onglet « Organisations »', async ({ page, browser }) => {
	const session = await sessionDe(browser, DRISS.adresse)
	const creation = await session.appeler('tools/call', {
		name: 'crm_organization_create',
		arguments: { workspace: 'p2enjoy', name: NOM, domain: 'E2E-MCP-Organisation.Example' },
	})
	expect(creation.isError ?? false, JSON.stringify(creation)).toBe(false)

	await connecterAvecLeLabs(page, DRISS.adresse)
	await page.goto('/contacts/organisations')
	const ligne = page.getByTestId('ligne-organisation').filter({ hasText: NOM })
	await expect(ligne).toBeVisible()
	await expect(ligne).toContainText('e2e-mcp-organisation.example')
	await expect(ligne.locator('td').last()).toHaveText('0')
	await capturer(page, 'connecteur-organisation-onglet-1440', UNITE)
})
