// @verifies CRM-104 (docs/BACKLOG.md) — tranche T6 : l'effet des outils de la famille `objectifs`, constaté dans la webapp
// @verifies docs/SPEC-mcp.md §9.2 nonies (« un bloc ajouté par le connecteur paraît sur le canevas, avec son avancement »,
//           crm_goal_block_add puis crm_goal_block_update) ; docs/SPEC-goals.md §1 (l'avancement saisi, jamais calculé) ;
//           CLAUDE.md §16 (captures)
//
// Un VRAI client MCP ajoute un bloc au tableau « Objectifs du trimestre » puis en règle l'avancement, au nom du business
// developer ; le canevas de la webapp, sous le même compte, le montre avec sa jauge. Le bloc et les cases posées pour la
// preuve sont retirés à la fin.

import type { Browser } from '@playwright/test'
import { connecterAvecLeLabs, expect, test, type APIRequestContext } from './fixtures'
import { capturer } from './captures'
import { MOT_DE_PASSE_SEED, URL_API, enTetesService } from '../api/jetons'
import { RETOUR_CLIENT, SessionMcp, echangerCode, preparerAutorisation } from '../mcp/client'

const UNITE = 'CRM-104'
const ESPACE = '5eed0000-0000-4000-8000-000000000001'
const DRISS = { adresse: 'bizdev@p2enjoy.test', sub: '5eed0000-0000-4000-8000-000000000012' }
const TRIMESTRE = '5eed0000-0000-4000-8000-0000000000e1'
const TITRE = 'E2E MCP Objectif'
const CASES: readonly [string, string][] = [
	['objectifs', 'consulter'],
	['objectifs', 'ajouter'],
	['objectifs', 'modifier'],
]
const rest = (chemin: string) => `${URL_API}/rest/v1/${chemin}`
let posees: [string, string][] = []

test.use({ viewport: { width: 1440, height: 900 } })

async function retirerBloc(request: APIRequestContext): Promise<void> {
	await request.delete(rest(`goal_blocks?title=eq.${encodeURIComponent(TITRE)}`), { headers: enTetesService() })
}

test.beforeEach(async ({ request }) => {
	await retirerBloc(request)
	const tenues = (await (await request.get(rest(`mcp_droits?select=famille,action&sub=eq.${DRISS.sub}&workspace_id=eq.${ESPACE}`), { headers: enTetesService() })).json()) as { famille: string; action: string }[]
	posees = CASES.filter(([f, a]) => !tenues.some((t) => t.famille === f && t.action === a)).map(([f, a]) => [f, a])
	if (posees.length > 0) {
		const pose = await request.post(rest('mcp_droits'), {
			headers: { ...enTetesService(), prefer: 'return=minimal' },
			data: posees.map(([famille, action]) => ({ sub: DRISS.sub, workspace_id: ESPACE, famille, action })),
		})
		expect(pose.status()).toBe(201)
	}
})

test.afterEach(async ({ request }) => {
	for (const [famille, action] of posees) {
		await request.delete(rest(`mcp_droits?sub=eq.${DRISS.sub}&workspace_id=eq.${ESPACE}&famille=eq.${famille}&action=eq.${action}`), {
			headers: enTetesService(),
		})
	}
	await retirerBloc(request)
})

/** Un vrai client MCP connecté au nom de la personne, dans un autre contexte de navigateur que la webapp. */
async function sessionDe(browser: Browser, adresse: string): Promise<SessionMcp> {
	const contexte = await browser.newContext()
	try {
		const page = await contexte.newPage()
		const autorisation = await preparerAutorisation('Preuve des objectifs du connecteur')
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

test('un bloc ajouté par le connecteur paraît sur le canevas, avec son avancement', async ({ page, browser }) => {
	const session = await sessionDe(browser, DRISS.adresse)
	const ajout = await session.appeler('tools/call', {
		name: 'crm_goal_block_add',
		arguments: { board_id: TRIMESTRE, title: TITRE, fill_percent: 10 },
	})
	expect(ajout.isError ?? false, JSON.stringify(ajout)).toBe(false)
	const idBloc = (ajout.structuredContent as { block: { id: string } }).block.id
	const avancement = await session.appeler('tools/call', {
		name: 'crm_goal_block_update',
		arguments: { block_id: idBloc, fill_percent: 65 },
	})
	expect(avancement.isError ?? false, JSON.stringify(avancement)).toBe(false)

	await connecterAvecLeLabs(page, DRISS.adresse)
	await page.goto(`/objectifs/${TRIMESTRE}`)
	const bloc = page.getByTestId('bloc-objectif').filter({ hasText: TITRE })
	await expect(bloc).toBeVisible()
	await expect(bloc).toContainText('Remplissage 65 %')
	await bloc.scrollIntoViewIfNeeded()
	await capturer(page, 'connecteur-objectif-canevas-1440', UNITE)
})
