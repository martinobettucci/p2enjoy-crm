// @verifies CRM-104 (docs/BACKLOG.md) — tranche T5 : l'effet des outils de la famille `temps`, constaté dans la webapp
// @verifies docs/SPEC-mcp.md §9.2 octies (« du temps posé par le connecteur paraît dans « Votre semaine » de la fiche »,
//           crm_time_entry_set) ; docs/SPEC-temps.md (la bande de la fiche d'affaire) ; CLAUDE.md §16 (captures)
//
// Un VRAI client MCP pose deux quarts d'aujourd'hui sur l'affaire Sogexia au nom du business developer ; la bande « Votre
// semaine » de la fiche, sous le même compte, les montre. Seule cette case est effacée à la fin — le seed ne pose du temps
// que sur des jours ouvrés passés (docs/SPEC-seed.md §17.1) — ; les cases de matrice que le seed accorde à Driss
// (docs/SPEC-seed.md §22) ne sont ni posées ni retirées.

import type { Browser } from '@playwright/test'
import { connecterAvecLeLabs, expect, test, type APIRequestContext } from './fixtures'
import { capturer } from './captures'
import { MOT_DE_PASSE_SEED, URL_API, enTetesService } from '../api/jetons'
import { RETOUR_CLIENT, SessionMcp, echangerCode, preparerAutorisation } from '../mcp/client'

const UNITE = 'CRM-104'
const ESPACE = '5eed0000-0000-4000-8000-000000000001'
const DRISS = { adresse: 'bizdev@p2enjoy.test', sub: '5eed0000-0000-4000-8000-000000000012' }
const SOGEXIA = '5eed0000-0000-4000-8000-0000000000c2'
const FICHE = `/tracks/conseil-ia/grands-comptes/cards/${SOGEXIA}`
const CASES: readonly [string, string][] = [
	['temps', 'consulter'],
	['temps', 'modifier'],
]
// Le jour de la personne, comme la bande le calcule.
const AUJOURDHUI = (() => {
	const d = new Date()
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
})()
const CASE = `saisies_temps?profile_id=eq.${DRISS.sub}&card_id=eq.${SOGEXIA}&jour=eq.${AUJOURDHUI}`
const rest = (chemin: string) => `${URL_API}/rest/v1/${chemin}`
let posees: [string, string][] = []

test.use({ viewport: { width: 1440, height: 900 } })

async function viderLaCase(request: APIRequestContext): Promise<void> {
	await request.delete(rest(CASE), { headers: enTetesService() })
}

test.beforeEach(async ({ request }) => {
	await viderLaCase(request)
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
	await viderLaCase(request)
	expect(await (await request.get(rest(`${CASE}&select=id`), { headers: enTetesService() })).json()).toEqual([])
})

/** Un vrai client MCP connecté au nom de la personne, dans un autre contexte de navigateur que la webapp. */
async function sessionDe(browser: Browser, adresse: string): Promise<SessionMcp> {
	const contexte = await browser.newContext()
	try {
		const page = await contexte.newPage()
		const autorisation = await preparerAutorisation('Preuve du temps du connecteur')
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

test('du temps posé par le connecteur paraît dans « Votre semaine » de la fiche', async ({ page, browser }) => {
	const session = await sessionDe(browser, DRISS.adresse)
	const pose = await session.appeler('tools/call', {
		name: 'crm_time_entry_set',
		arguments: { workspace: 'p2enjoy', day: AUJOURDHUI, minutes: 210, card_id: SOGEXIA },
	})
	expect(pose.isError ?? false, JSON.stringify(pose)).toBe(false)

	await connecterAvecLeLabs(page, DRISS.adresse)
	await page.goto(FICHE)
	const bande = page.getByTestId('temps-card-bande')
	await expect(bande.getByTestId('temps-card-tableau')).toBeVisible()
	await expect(bande.getByTestId(`temps-total-${AUJOURDHUI}`)).toHaveText('2 / 4 quarts')
	await bande.scrollIntoViewIfNeeded()
	await capturer(page, 'connecteur-temps-fiche-1440', UNITE)
})
