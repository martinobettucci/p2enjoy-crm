// @verifies CRM-118 (docs/BACKLOG.md) — tranches T2.a et T2.b : l'effet des outils de la famille `workflows`, constaté dans
//           la webapp
// @verifies docs/SPEC-mcp.md §9.2 undecies (« une étape ajoutée par un vrai client MCP paraît dans l'éditeur de
//           workflows », crm_workflow_create, crm_workflow_step_add), §5 (sous l'identité de la personne) ;
//           docs/SPEC-workflow-engine.md §7 bis.3 ; CLAUDE.md §16 (captures)
// @verifies docs/SPEC-mcp.md §9.2 undecies T2.b (« un champ exigé par le connecteur bloque un déplacement au board »,
//           crm_transition_required_field_set) ; docs/SPEC-workflow-engine.md §5.7, §7.10 (le bandeau de refus)
//
// Un VRAI client MCP crée un workflow et lui ajoute une étape au nom de l'administratrice ; la webapp, sous le même
// compte, montre le workflow et son étape dans l'éditeur. Les cases posées pour la preuve, et le workflow, sont retirés à
// la fin (ses étapes en cascade).

import type { Browser } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { autoriserErreursConsole, connecterAvecLeLabs, ERREUR_RESSOURCE_HTTP, expect, test, type APIRequestContext } from './fixtures'
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
	['workflows', 'modifier'],
]
// T2.b : la transition « Relancer » (Prospection → Relance) du workflow par défaut, qui n'exige rien dans le seed, et le
// champ « Date de signature prévue », exigé seulement à « Signature » ; une affaire jetable à « Prospection ».
const WORKFLOW_DEFAUT = '5eed0000-0000-4000-8000-000000000051'
const CHANNEL_GRANDS_COMPTES = '5eed0000-0000-4000-8000-000000000032'
const ETAPE_PROSPECTION = '5eed0000-0000-4000-8000-000000000061'
const TRANSITION_RELANCER = '5eed0000-0000-4000-8000-000000000071'
const CHAMP_DATE_SIGNATURE = '5eed0000-0000-4000-8000-000000000083'
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
	await request.delete(rest(`workflow_transition_required_fields?transition_id=eq.${TRANSITION_RELANCER}&field_id=eq.${CHAMP_DATE_SIGNATURE}`), {
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

test('un champ exigé par le connecteur bloque le déplacement au board, et le bandeau le nomme', async ({ page, browser, request }) => {
	const idCard = randomUUID()
	const titre = `E2E MCP exigence ${idCard.slice(0, 8)}`
	const creation = await request.post(rest('cards'), {
		headers: { ...enTetesService(), Prefer: 'return=representation' },
		data: {
			id: idCard, workspace_id: ESPACE, channel_id: CHANNEL_GRANDS_COMPTES, workflow_id: WORKFLOW_DEFAUT,
			current_step_id: ETAPE_PROSPECTION, title: titre,
		},
	})
	expect(creation.status(), await creation.text()).toBe(201)
	try {
		const session = await sessionDe(browser, CAMILLE.adresse)
		const exigence = await session.appeler('tools/call', {
			name: 'crm_transition_required_field_set',
			arguments: { transition_id: TRANSITION_RELANCER, field_id: CHAMP_DATE_SIGNATURE, required: true },
		})
		expect(exigence.isError ?? false, JSON.stringify(exigence)).toBe(false)

		await connecterAvecLeLabs(page, CAMILLE.adresse)
		await page.goto('/tracks/conseil-ia/grands-comptes')
		const carte = page.locator(`[data-testid="carte-card"][data-card="${idCard}"]`)
		await expect(carte).toContainText(titre)
		await carte.getByRole('button', { name: `Actions ${titre}` }).click()
		await carte.getByRole('button', { name: 'Relancer' }).click()
		const refus = page.getByTestId('refus-deplacement')
		await expect(refus).toHaveAttribute('data-cle', 'missing_required_fields')
		await expect(page.getByTestId('champs-manquants')).toContainText('Date de signature prévue')
		autoriserErreursConsole(page, [ERREUR_RESSOURCE_HTTP[400]])
		await expect(page.locator(`[data-testid="colonne"][data-etape="${ETAPE_PROSPECTION}"] [data-card="${idCard}"]`)).toHaveCount(1)
		await capturer(page, 'connecteur-exigence-refus-1440', UNITE)

		// Le connecteur lève l'exigence : le même déplacement passe.
		const levee = await session.appeler('tools/call', {
			name: 'crm_transition_required_field_set',
			arguments: { transition_id: TRANSITION_RELANCER, field_id: CHAMP_DATE_SIGNATURE, required: false },
		})
		expect(levee.isError ?? false, JSON.stringify(levee)).toBe(false)
		await page.reload()
		await carte.getByRole('button', { name: `Actions ${titre}` }).click()
		await carte.getByRole('button', { name: 'Relancer' }).click()
		await expect(page.locator(`[data-testid="colonne"][data-etape="5eed0000-0000-4000-8000-000000000062"] [data-card="${idCard}"]`)).toHaveCount(1)
	} finally {
		await request.delete(rest(`card_field_values?card_id=eq.${idCard}`), { headers: enTetesService() })
		await request.delete(rest(`cards?id=eq.${idCard}`), { headers: enTetesService() })
	}
})
