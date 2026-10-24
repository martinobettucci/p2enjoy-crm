// @verifies CRM-104 (docs/BACKLOG.md) — tranche T4 : l'effet des outils de la famille `budgets`, constaté dans la webapp
// @verifies docs/SPEC-mcp.md §9.2 septies (« une ligne ajoutée par le connecteur paraît dans la section « Coûts » de la
//           fiche », crm_card_cost_add puis crm_card_cost_actual_add) ; docs/SPEC-costs.md §4.6 (la section de la
//           fiche) ; CLAUDE.md §16 (captures)
//
// Un VRAI client MCP ajoute une ligne de coût et un coût réel au nom du business developer ; la section « Coûts » de la
// fiche Sogexia, sous le même compte, les montre. Les cases posées pour la preuve, la ligne et son réel sont retirés à la
// fin ; la case `budgets:consulter` que le seed accorde à Driss (docs/SPEC-seed.md §22) n'est ni posée ni retirée.

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
const PROSPECTION_SORTANTE = '5eed0000-0000-4000-8000-0000000000c1'
const LIBELLE = 'E2E MCP Coût'
const CASES: readonly [string, string][] = [
	['budgets', 'consulter'],
	['budgets', 'ajouter'],
]
const rest = (chemin: string) => `${URL_API}/rest/v1/${chemin}`
let posees: [string, string][] = []

test.use({ viewport: { width: 1440, height: 900 } })

async function retirerLigne(request: APIRequestContext): Promise<void> {
	const lignes = (await (await request.get(rest(`card_costs?select=id&label=eq.${encodeURIComponent(LIBELLE)}`), { headers: enTetesService() })).json()) as { id: string }[]
	for (const { id } of lignes) {
		await request.delete(rest(`card_cost_actuals?card_cost_id=eq.${id}`), { headers: enTetesService() })
	}
	await request.delete(rest(`card_costs?label=eq.${encodeURIComponent(LIBELLE)}`), { headers: enTetesService() })
}

test.beforeEach(async ({ request }) => {
	await retirerLigne(request)
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
	await retirerLigne(request)
})

/** Un vrai client MCP connecté au nom de la personne, dans un autre contexte de navigateur que la webapp. */
async function sessionDe(browser: Browser, adresse: string): Promise<SessionMcp> {
	const contexte = await browser.newContext()
	try {
		const page = await contexte.newPage()
		const autorisation = await preparerAutorisation('Preuve des coûts du connecteur')
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

test('une ligne de coût ajoutée par le connecteur paraît dans la section « Coûts » de la fiche', async ({ page, browser }) => {
	const session = await sessionDe(browser, DRISS.adresse)
	const creation = await session.appeler('tools/call', {
		name: 'crm_card_cost_add',
		arguments: { card_id: SOGEXIA, budget_id: PROSPECTION_SORTANTE, label: LIBELLE, estimated_cost: 240 },
	})
	expect(creation.isError ?? false, JSON.stringify(creation)).toBe(false)
	const idLigne = (creation.structuredContent as { cost_line: { id: string } }).cost_line.id
	const reel = await session.appeler('tools/call', {
		name: 'crm_card_cost_actual_add',
		arguments: { cost_id: idLigne, amount: 180, label: 'Facture E2E' },
	})
	expect(reel.isError ?? false, JSON.stringify(reel)).toBe(false)

	await connecterAvecLeLabs(page, DRISS.adresse)
	await page.goto(FICHE)
	const ligne = page.getByTestId('bloc-couts-card').getByTestId('ligne-cout').filter({ hasText: LIBELLE })
	await expect(ligne).toBeVisible()
	await expect(ligne).toContainText('240')
	await expect(ligne).toContainText('180')
	await ligne.scrollIntoViewIfNeeded()
	await capturer(page, 'connecteur-cout-fiche-1440', UNITE)
})
