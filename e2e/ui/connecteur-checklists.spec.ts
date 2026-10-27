// @verifies CRM-068 (docs/BACKLOG.md) — tranche T5 : un point coché par un vrai client MCP paraît coché sur la fiche, au nom
//           de la personne, et le fil le dit
// @verifies docs/SPEC-mcp.md §9.2 duodecies (crm_card_checklist_list, crm_card_checklist_set ; preuve E2E), §5 (sous
//           l'identité de la personne) ; docs/SPEC-checklists.md §5 ; docs/DESIGN_SYSTEM.md §5.70 ; CLAUDE.md §16
//
// Le business developer reçoit les cases `affaires` (consulter, ajouter, modifier) ; son client MCP crée une affaire jetable
// dans le channel « Checklists », lit sa checklist et coche « Besoin confirmé ». La webapp, sous le même compte, montre le
// point coché à son nom. Les cases et l'affaire sont retirées à la fin.

import type { Browser } from '@playwright/test'
import { connecterAvecLeLabs, expect, test, type APIRequestContext } from './fixtures'
import { capturer } from './captures'
import { MOT_DE_PASSE_SEED, URL_API, enTetesService } from '../api/jetons'
import { RETOUR_CLIENT, SessionMcp, echangerCode, preparerAutorisation } from '../mcp/client'

const ESPACE = '5eed0000-0000-4000-8000-000000000001'
const DRISS = { adresse: 'bizdev@p2enjoy.test', sub: '5eed0000-0000-4000-8000-000000000012' }
const CHANNEL_CHECKLISTS = '5eed0000-0000-4000-8000-0000000c6841'
const TITRE = 'E2E MCP checklist'
const CASES: readonly [string, string][] = [
	['affaires', 'consulter'],
	['affaires', 'ajouter'],
	['affaires', 'modifier'],
]
const rest = (chemin: string) => `${URL_API}/rest/v1/${chemin}`

test.use({ viewport: { width: 1440, height: 1000 } })

async function retirer(request: APIRequestContext): Promise<void> {
	for (const [famille, action] of CASES) {
		await request.delete(rest(`mcp_droits?sub=eq.${DRISS.sub}&workspace_id=eq.${ESPACE}&famille=eq.${famille}&action=eq.${action}`), {
			headers: enTetesService(),
		})
	}
	await request.delete(rest(`cards?title=like.${encodeURIComponent(`${TITRE}*`)}`), { headers: enTetesService() })
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
		const autorisation = await preparerAutorisation('Preuve des checklists du connecteur')
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

test('un point coché par le connecteur paraît coché sur la fiche, au nom de la personne', async ({ page, browser }) => {
	const session = await sessionDe(browser, DRISS.adresse)
	const appeler = async (name: string, args: Record<string, unknown>) => {
		const resultat = await session.appeler('tools/call', { name, arguments: args })
		expect(resultat.isError ?? false, JSON.stringify(resultat)).toBe(false)
		return resultat.structuredContent
	}
	const carte = (await appeler('crm_card_create', { channel_id: CHANNEL_CHECKLISTS, title: `${TITRE} Cerfrance` })).card
	const liste = await appeler('crm_card_checklist_list', { card_id: carte.id })
	expect(liste.current_step_count).toEqual({ checked: 0, total: 2 })
	const point = liste.step_items[0].items.find((p: { label: string }) => p.label === 'Besoin confirmé')
	const coche = await appeler('crm_card_checklist_set', { card_id: carte.id, item_id: point.item_id, checked: true })
	expect(coche.item.checked).toBe(true)

	await connecterAvecLeLabs(page, DRISS.adresse)
	await page.goto(`/tracks/studio-web/checklists/cards/${carte.id}`)
	const bloc = page.getByTestId('bloc-checklist-card')
	await expect(bloc.getByTestId('checklist-compte')).toHaveText('1 sur 2')
	await expect(bloc.getByRole('checkbox', { name: 'Besoin confirmé' })).toBeChecked()
	await expect(bloc.getByTestId('checklist-coche-par')).toContainText('Coché par Driss Lemoine, le ')
	await expect(page.getByText('Point de checklist coché')).toBeVisible()
	await bloc.scrollIntoViewIfNeeded()
	await capturer(page, 'connecteur-checklist-coche-1440', 'CRM-068')
})
