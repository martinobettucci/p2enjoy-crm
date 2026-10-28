// @verifies CRM-069 (docs/BACKLOG.md) — tranche T3 : des étiquettes posées par un vrai client MCP paraissent sur la fiche,
//           au nom de la personne, et le fil le dit ; une étiquette archivée est refusée avant toute écriture
// @verifies docs/SPEC-mcp.md §9.2 tredecies (crm_card_label_set : noms sans casse, refus d'un nom archivé ; preuve E2E), §5
//           (sous l'identité de la personne) ; docs/SPEC-etiquettes-digest.md §2.2, §4 ; docs/DESIGN_SYSTEM.md §5.73 ;
//           CLAUDE.md §16
//
// Le business developer reçoit les cases `affaires` (consulter, ajouter, modifier) ; son client MCP crée une affaire jetable
// dans le channel « Checklists », y pose « prioritaire » et « Partenaire », se voit refuser « Salon 2025 » (archivée). La
// webapp, sous le même compte, montre les deux pastilles et la pose au fil. Les cases et l'affaire sont retirées à la fin.

import type { Browser } from '@playwright/test'
import { connecterAvecLeLabs, expect, test, type APIRequestContext } from './fixtures'
import { capturer } from './captures'
import { MOT_DE_PASSE_SEED, URL_API, enTetesService } from '../api/jetons'
import { RETOUR_CLIENT, SessionMcp, echangerCode, preparerAutorisation } from '../mcp/client'

const ESPACE = '5eed0000-0000-4000-8000-000000000001'
const DRISS = { adresse: 'bizdev@p2enjoy.test', sub: '5eed0000-0000-4000-8000-000000000012' }
const CHANNEL_CHECKLISTS = '5eed0000-0000-4000-8000-0000000c6841'
const TITRE = 'E2E MCP etiquettes'
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
		const autorisation = await preparerAutorisation('Preuve des étiquettes du connecteur')
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

test('des étiquettes posées par le connecteur paraissent sur la fiche, au nom de la personne', async ({ page, browser, request }) => {
	const session = await sessionDe(browser, DRISS.adresse)
	const appeler = async (name: string, args: Record<string, unknown>) => {
		const resultat = await session.appeler('tools/call', { name, arguments: args })
		expect(resultat.isError ?? false, JSON.stringify(resultat)).toBe(false)
		return resultat.structuredContent
	}
	const carte = (await appeler('crm_card_create', { channel_id: CHANNEL_CHECKLISTS, title: `${TITRE} Cerfrance` })).card

	// Une étiquette archivée : refusée avant toute écriture, le refus nomme les étiquettes possibles.
	const archivee = await session.appeler('tools/call', { name: 'crm_card_label_set', arguments: { card_id: carte.id, add: ['Salon 2025'] } })
	expect(archivee.isError, JSON.stringify(archivee)).toBe(true)
	expect(JSON.stringify(archivee.content)).toContain('Partenaire')
	const rien = await request.get(rest(`card_labels?card_id=eq.${carte.id}&select=label_id`), { headers: enTetesService() })
	expect(await rien.json()).toEqual([])

	// Les noms se lisent sans casse.
	const posees = await appeler('crm_card_label_set', { card_id: carte.id, add: ['prioritaire', 'Partenaire'] })
	expect(posees.labels.map((e: { name: string }) => e.name).sort()).toEqual(['Partenaire', 'Prioritaire'])
	expect(posees.unchanged).toEqual([])
	const lue = await appeler('crm_card_get', { card_id: carte.id })
	expect(lue.labels.map((e: { name: string }) => e.name).sort()).toEqual(['Partenaire', 'Prioritaire'])
	const poses = await request.get(rest(`card_labels?card_id=eq.${carte.id}&select=created_by`), { headers: enTetesService() })
	expect(await poses.json()).toEqual([{ created_by: DRISS.sub }, { created_by: DRISS.sub }])

	await connecterAvecLeLabs(page, DRISS.adresse)
	await page.goto(`/tracks/studio-web/checklists/cards/${carte.id}`)
	const pastilles = page.getByTestId('entete-card-etiquettes-pastilles')
	await expect(pastilles.getByTestId('pastille-etiquette')).toHaveCount(2)
	await expect(pastilles).toContainText('Prioritaire')
	await expect(pastilles).toContainText('Partenaire')
	await expect(page.getByText('Étiquette posée')).toHaveCount(2)
	await capturer(page, 'connecteur-etiquettes-posees-1440', 'CRM-069')
})
