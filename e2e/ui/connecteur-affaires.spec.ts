// @verifies CRM-104 (docs/BACKLOG.md) — tranche T2.b : l'effet des outils d'écriture des affaires, constaté dans la webapp
// @verifies docs/SPEC-mcp.md §13 (« une affaire créée par le connecteur apparaît au board, et sa timeline nomme la
//           personne »), §9.2 ter (crm_card_create, crm_card_comment_add), §5 (le connecteur agit sous l'identité de la
//           personne) ; CLAUDE.md §16 (captures)
//
// Un VRAI client MCP — découverte, enregistrement, consentement, SSO, échange du code (`e2e/mcp/client.ts`) — crée une
// affaire et la commente au nom du business developer ; la webapp, connectée sous le même compte, la montre au board et
// nomme Driss dans son fil. Les cases de la matrice posées pour la preuve, et l'affaire, sont retirées à la fin.

import type { Browser } from '@playwright/test'
import { connecterAvecLeLabs, expect, test, type APIRequestContext } from './fixtures'
import { capturer } from './captures'
import { MOT_DE_PASSE_SEED, URL_API, enTetesService } from '../api/jetons'
import { RETOUR_CLIENT, SessionMcp, echangerCode, preparerAutorisation } from '../mcp/client'

const UNITE = 'CRM-104'
const ESPACE = '5eed0000-0000-4000-8000-000000000001'
const DRISS = { adresse: 'bizdev@p2enjoy.test', sub: '5eed0000-0000-4000-8000-000000000012' }
const GRANDS_COMPTES = '5eed0000-0000-4000-8000-000000000032'
const BOARD = '/tracks/conseil-ia/grands-comptes'
const TITRE = 'E2E MCP — affaire créée par l’assistant'
const CASES: readonly [string, string][] = [
	['affaires', 'consulter'],
	['affaires', 'ajouter'],
]
const rest = (chemin: string) => `${URL_API}/rest/v1/${chemin}`

test.use({ viewport: { width: 1440, height: 900 } })

async function retirer(request: APIRequestContext): Promise<void> {
	for (const [famille, action] of CASES) {
		await request.delete(rest(`mcp_droits?sub=eq.${DRISS.sub}&workspace_id=eq.${ESPACE}&famille=eq.${famille}&action=eq.${action}`), {
			headers: enTetesService(),
		})
	}
	await request.delete(rest(`cards?title=eq.${encodeURIComponent(TITRE)}`), { headers: enTetesService() })
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

/** Un vrai client MCP connecté au nom de Driss, dans un autre contexte de navigateur que la webapp. */
async function sessionDeDriss(browser: Browser): Promise<SessionMcp> {
	const contexte = await browser.newContext()
	try {
		const page = await contexte.newPage()
		const autorisation = await preparerAutorisation('Preuve des affaires du connecteur')
		await page.goto(autorisation.url)
		await page.getByRole('button', { name: 'Allow Access' }).click()
		await expect(page.locator('#kc-form-login')).toBeVisible()
		await page.locator('#username').fill(DRISS.adresse)
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

test('une affaire créée et commentée par le connecteur paraît au board, et son fil nomme Driss', async ({ page, browser }) => {
	const session = await sessionDeDriss(browser)
	const creation = await session.appeler('tools/call', {
		name: 'crm_card_create',
		arguments: { channel_id: GRANDS_COMPTES, title: TITRE },
	})
	expect(creation.isError ?? false, JSON.stringify(creation)).toBe(false)
	const carte = creation.structuredContent.card as { id: string; step: { name: string } }
	expect(carte.step.name).toBe('Prospection')
	const commentaire = await session.appeler('tools/call', {
		name: 'crm_card_comment_add',
		arguments: { card_id: carte.id, body: 'Ouverte depuis l’assistant, après l’appel du matin.' },
	})
	expect(commentaire.isError ?? false, JSON.stringify(commentaire)).toBe(false)

	await connecterAvecLeLabs(page, DRISS.adresse)
	await page.goto(BOARD)
	const lien = page.getByRole('link', { name: TITRE })
	await expect(lien).toBeVisible()
	await lien.scrollIntoViewIfNeeded()
	await capturer(page, 'connecteur-affaire-board-1440', UNITE)

	await lien.click()
	await expect(page).toHaveURL(new RegExp(`/cards/${carte.id}$`, 'u'))
	const fil = page.getByRole('region', { name: 'Fil de cette affaire' })
	await expect(fil.getByText('Affaire créée')).toBeVisible()
	await expect(fil).toContainText('par Driss Lemoine')
	await expect(fil.getByTestId('commentaire').filter({ hasText: 'Ouverte depuis l’assistant' })).toContainText('Driss Lemoine')
	await fil.scrollIntoViewIfNeeded()
	await capturer(page, 'connecteur-affaire-fil-1440', UNITE)
})
