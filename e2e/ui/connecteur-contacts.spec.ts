// @verifies CRM-104 (docs/BACKLOG.md) — tranche T3 : l'effet des outils de contact, constaté dans la webapp
// @verifies docs/SPEC-mcp.md §9.2 quinquies (« un contact créé par le connecteur paraît dans le carnet »,
//           crm_contact_create), §5 (sous l'identité de la personne) ; CLAUDE.md §16 (captures)
//
// Un VRAI client MCP crée un contact au nom du business developer ; le carnet de la webapp, sous le même compte, le liste.
// Les cases posées pour la preuve, et le contact, sont retirés à la fin.

import type { Browser } from '@playwright/test'
import { connecterAvecLeLabs, expect, test, type APIRequestContext } from './fixtures'
import { capturer } from './captures'
import { MOT_DE_PASSE_SEED, URL_API, enTetesService } from '../api/jetons'
import { RETOUR_CLIENT, SessionMcp, echangerCode, preparerAutorisation } from '../mcp/client'

const UNITE = 'CRM-104'
const ESPACE = '5eed0000-0000-4000-8000-000000000001'
const DRISS = { adresse: 'bizdev@p2enjoy.test', sub: '5eed0000-0000-4000-8000-000000000012' }
const NOM = 'E2E MCP Contact'
const CASES: readonly [string, string][] = [
	['contacts', 'consulter'],
	['contacts', 'ajouter'],
]
const rest = (chemin: string) => `${URL_API}/rest/v1/${chemin}`

test.use({ viewport: { width: 1440, height: 900 } })

async function retirer(request: APIRequestContext): Promise<void> {
	for (const [famille, action] of CASES) {
		await request.delete(rest(`mcp_droits?sub=eq.${DRISS.sub}&workspace_id=eq.${ESPACE}&famille=eq.${famille}&action=eq.${action}`), {
			headers: enTetesService(),
		})
	}
	await request.delete(rest(`contacts?workspace_id=eq.${ESPACE}&full_name=eq.${encodeURIComponent(NOM)}`), { headers: enTetesService() })
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
		const autorisation = await preparerAutorisation('Preuve des contacts du connecteur')
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

test('un contact créé par le connecteur paraît dans le carnet', async ({ page, browser }) => {
	const session = await sessionDe(browser, DRISS.adresse)
	const creation = await session.appeler('tools/call', {
		name: 'crm_contact_create',
		arguments: { workspace: 'p2enjoy', full_name: NOM, role_title: 'Acheteuse', email: 'e2e-mcp@exemple.test' },
	})
	expect(creation.isError ?? false, JSON.stringify(creation)).toBe(false)

	await connecterAvecLeLabs(page, DRISS.adresse)
	await page.goto('/contacts')
	const ligne = page.getByRole('row').filter({ hasText: NOM })
	await expect(ligne).toBeVisible()
	await expect(ligne).toContainText('Acheteuse')
	await expect(ligne).toContainText('e2e-mcp@exemple.test')
	await ligne.scrollIntoViewIfNeeded()
	await capturer(page, 'connecteur-contact-carnet-1440', UNITE)
})
