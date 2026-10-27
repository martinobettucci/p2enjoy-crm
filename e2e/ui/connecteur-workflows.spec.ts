// @verifies CRM-118 (docs/BACKLOG.md) — tranche T2.a : l'effet des outils de la famille `workflows`, constaté dans la webapp
// @verifies docs/SPEC-mcp.md §9.2 undecies (« une étape ajoutée par un vrai client MCP paraît dans l'éditeur de
//           workflows », crm_workflow_create, crm_workflow_step_add), §5 (sous l'identité de la personne) ;
//           docs/SPEC-workflow-engine.md §7 bis.3 ; CLAUDE.md §16 (captures)
//
// Un VRAI client MCP crée un workflow et lui ajoute une étape au nom de l'administratrice ; la webapp, sous le même
// compte, montre le workflow et son étape dans l'éditeur. Les cases posées pour la preuve, et le workflow, sont retirés à
// la fin (ses étapes en cascade).

import type { Browser } from '@playwright/test'
import { connecterAvecLeLabs, expect, test, type APIRequestContext } from './fixtures'
import { capturer } from './captures'
import { MOT_DE_PASSE_SEED, URL_API, enTetesService } from '../api/jetons'
import { RETOUR_CLIENT, SessionMcp, echangerCode, preparerAutorisation } from '../mcp/client'

const UNITE = 'CRM-118'
const ESPACE = '5eed0000-0000-4000-8000-000000000001'
const CAMILLE = { adresse: 'admin@p2enjoy.test', sub: '5eed0000-0000-4000-8000-000000000011' }
const PROSPECTION = '5eed0000-0000-4000-8000-000000000041'
const NOM = 'E2E MCP workflow'
const ETAPE = 'E2E Étape MCP'
const CASES: readonly [string, string][] = [
	['workflows', 'consulter'],
	['workflows', 'ajouter'],
]
const rest = (chemin: string) => `${URL_API}/rest/v1/${chemin}`

test.use({ viewport: { width: 1440, height: 900 } })

async function retirer(request: APIRequestContext): Promise<void> {
	for (const [famille, action] of CASES) {
		await request.delete(rest(`mcp_droits?sub=eq.${CAMILLE.sub}&workspace_id=eq.${ESPACE}&famille=eq.${famille}&action=eq.${action}`), {
			headers: enTetesService(),
		})
	}
	await request.delete(rest(`workflows?workspace_id=eq.${ESPACE}&name=eq.${encodeURIComponent(NOM)}`), {
		headers: enTetesService(),
	})
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
		const autorisation = await preparerAutorisation('Preuve des workflows du connecteur')
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

test('une étape ajoutée par le connecteur paraît dans l’éditeur de workflows', async ({ page, browser }) => {
	const session = await sessionDe(browser, CAMILLE.adresse)
	const creation = await session.appeler('tools/call', {
		name: 'crm_workflow_create',
		arguments: { workspace: 'p2enjoy', name: NOM },
	})
	expect(creation.isError ?? false, JSON.stringify(creation)).toBe(false)
	const workflow = creation.structuredContent.workflow.id as string
	const ajout = await session.appeler('tools/call', {
		name: 'crm_workflow_step_add',
		arguments: { workflow_id: workflow, node_id: PROSPECTION, label: ETAPE },
	})
	expect(ajout.isError ?? false, JSON.stringify(ajout)).toBe(false)

	await connecterAvecLeLabs(page, CAMILLE.adresse)
	await page.goto('/reglages/workflows')
	await expect(page.getByRole('heading', { name: 'Éditeur de workflows' })).toBeVisible()
	const choix = page.getByRole('button', { name: new RegExp(`^${NOM}`, 'u') })
	await expect(choix).toBeVisible()
	await choix.click()
	await expect(choix).toHaveAttribute('aria-current', 'true')
	await expect(page.getByTestId('ligne-etape')).toHaveCount(1)
	await expect(page.getByTestId('ligne-etape').first()).toContainText(ETAPE)
	await capturer(page, 'connecteur-workflow-editeur-1440', UNITE)
})
