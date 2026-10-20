// @verifies CRM-102 (docs/BACKLOG.md) — tranche T3 : un vrai client MCP, connecté dans le navigateur, sur la pile réelle
// @verifies docs/SPEC-mcp.md §3.1 (flux complet), §3.3 (« Stay signed in » décochée, cochée au clavier, `offline_access`
//           demandé alors seulement), §4 (superadministratrice et `admin` LeLabs entrent ; « Droits en attente » ;
//           vérification attendue ; aucun code émis sur un refus ; registre injoignable = refus), §5 (la donnée lue sous la
//           RLS), §7.1 (une ligne au journal) ; docs/DESIGN_SYSTEM.md §5.57 (pages du connecteur), §5.12 (attente et
//           refus), §7 (quatre paliers, aucun défilement horizontal), §8 (clavier) ; CLAUDE.md §15, §16
//
// Le navigateur ne fait que ce qu'un humain fait — consentir, se connecter au SSO —, et le client MCP de test
// (`e2e/mcp/client.ts`) fait le reste : enregistrement, échange du code, JSON-RPC. Tout part des comptes du realm de
// développement et du seed ; le registre du connecteur est lu par la clé de service, jamais écrit par la preuve, sauf
// l'état d'erreur, provoqué par un retrait de privilège rétabli dans le même scénario.

import { execFileSync } from 'node:child_process'
import { ERREUR_RESSOURCE_HTTP, autoriserErreursConsole, expect, test, type Page } from './fixtures'
import { PALIERS, capturer } from './captures'
import { MOT_DE_PASSE_SEED, URL_API, enTetesService } from '../api/jetons'
import { ORIGINE_MCP, RETOUR_CLIENT, SessionMcp, echangerCode, preparerAutorisation } from '../mcp/client'

const UNITE = 'CRM-102'
const SABINE = { adresse: 'plateforme@p2enjoy.test', sub: '5eed0000-0000-4000-8000-000000000018' }
const EXPLOITANTE = 'exploitante@p2enjoy.test'
const CAMILLE = 'admin@p2enjoy.test'
const ATTENDU = 'attendu@p2enjoy.test'
const ESPACE_SEEDE = '5eed0000-0000-4000-8000-000000000001'

test.use({ viewport: { width: 1440, height: 900 } })

async function sansDefilementHorizontal(page: Page, contexte: string): Promise<void> {
	const debord = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
	expect(debord, `${contexte} : la page ne défile jamais horizontalement (§7)`).toBeLessThanOrEqual(0)
}

async function connexionSso(page: Page, adresse: string): Promise<void> {
	await expect(page.locator('#kc-form-login')).toBeVisible()
	await page.locator('#username').fill(adresse)
	await page.locator('#password').fill(MOT_DE_PASSE_SEED)
	await page.locator('#kc-login').click()
}

/** Le retour vers le client MCP est une redirection : la requête est observable, et c'est elle qui porte le code. */
const versLeClient = (page: Page) => page.waitForRequest((r) => r.url().startsWith(RETOUR_CLIENT), { timeout: 20_000 })

async function consentir(page: Page, url: string): Promise<void> {
	await page.goto(url)
	await page.getByRole('button', { name: 'Allow Access' }).click()
}

async function derniereLigneDuJournal(sub: string): Promise<{ outil: string; issue: string } | undefined> {
	const reponse = await fetch(`${URL_API}/rest/v1/mcp_journal?sub=eq.${sub}&order=id.desc&limit=1&select=outil,issue`, {
		headers: enTetesService(),
	})
	return ((await reponse.json()) as { outil: string; issue: string }[])[0]
}

test.describe('Le connecteur MCP, par un vrai client (docs/SPEC-mcp.md §3, §4)', () => {
	test('« Stay signed in » se coche au clavier, la connexion longue est demandée, et le client lit sous la RLS', async ({ page }) => {
		const autorisation = await preparerAutorisation()
		await page.goto(autorisation.url)
		const caseLongue = page.getByRole('checkbox', { name: 'Stay signed in' })
		await expect(caseLongue, 'décochée par défaut (§3.3)').not.toBeChecked()
		await capturer(page, 'consentement-xl-1440', UNITE)

		await caseLongue.focus()
		await page.keyboard.press('Space')
		await expect(caseLongue).toBeChecked()
		const versSso = page.waitForRequest((r) => r.url().includes('/protocol/openid-connect/auth'))
		await page.getByRole('button', { name: 'Allow Access' }).click()
		const demande = new URL((await versSso).url())
		expect(demande.searchParams.get('scope')?.split(' '), 'case cochée : offline_access demandé').toContain('offline_access')

		const attente = versLeClient(page)
		await connexionSso(page, SABINE.adresse)
		const retour = new URL((await attente).url())
		expect(retour.searchParams.get('state')).toBe(autorisation.etat)
		const jetons = await echangerCode(autorisation, retour.searchParams.get('code') ?? '')
		expect(jetons.expires_in).toBeLessThanOrEqual(300)
		expect(jetons.refresh_token, 'une connexion longue rend un jeton de rafraîchissement').toBeTruthy()

		const session = new SessionMcp(jetons.access_token)
		await session.ouvrir()
		const { tools } = await session.appeler('tools/list')
		expect(tools.map((o: { name: string }) => o.name)).toEqual(['crm_workspace_list'])
		const resultat = await session.appeler('tools/call', { name: 'crm_workspace_list', arguments: {} })
		expect(resultat.isError ?? false).toBe(false)
		// Superadministratrice en base, membre d'aucun espace : elle franchit la matrice, pas la RLS (D7).
		expect(resultat.structuredContent).toEqual({ total: 0, offset: 0, workspaces: [] })
		expect(await derniereLigneDuJournal(SABINE.sub)).toEqual({ outil: 'crm_workspace_list', issue: 'ok' })
	})

	test('sans la case, aucune connexion longue n’est demandée ; l’administratrice LeLabs lit l’espace seedé', async ({ page }) => {
		const autorisation = await preparerAutorisation()
		const versSso = page.waitForRequest((r) => r.url().includes('/protocol/openid-connect/auth'))
		await consentir(page, autorisation.url)
		expect(new URL((await versSso).url()).searchParams.get('scope')?.split(' ')).not.toContain('offline_access')
		const attente = versLeClient(page)
		await connexionSso(page, EXPLOITANTE)
		const jetons = await echangerCode(autorisation, new URL((await attente).url()).searchParams.get('code') ?? '')
		const session = new SessionMcp(jetons.access_token)
		await session.ouvrir()
		const { structuredContent } = await session.appeler('tools/call', { name: 'crm_workspace_list', arguments: {} })
		const seede = structuredContent.workspaces.find((e: { id: string }) => e.id === ESPACE_SEEDE)
		expect(seede, 'admin LeLabs : tout espace, dans la RLS').toMatchObject({ slug: 'p2enjoy', role: null, rights: 'all' })
	})

	test('un compte vérifié sans droit attend ses droits, et aucun code ne part', async ({ page }) => {
		const codes: string[] = []
		page.on('request', (r) => {
			if (r.url().startsWith(RETOUR_CLIENT)) codes.push(r.url())
		})
		await consentir(page, (await preparerAutorisation()).url)
		await connexionSso(page, CAMILLE)
		await expect(page.getByRole('heading', { level: 1, name: 'Droits en attente' })).toBeVisible()
		await expect(page.getByRole('status')).toContainText(CAMILLE)
		await expect(page.getByRole('alert')).toHaveCount(0)
		expect(codes, 'aucun code ne doit partir vers le client MCP').toEqual([])
		autoriserErreursConsole(page, [ERREUR_RESSOURCE_HTTP[403]])
		for (const palier of PALIERS) {
			await page.setViewportSize({ width: palier.largeur, height: palier.hauteur })
			await capturer(page, `droits-en-attente-${palier.nom}`, UNITE)
			await sansDefilementHorizontal(page, `droits en attente ${palier.nom}`)
		}
	})

	test('un compte non vérifié par LeLabs attend sa vérification ; le lien du compte se suit au clavier', async ({ page }) => {
		await consentir(page, (await preparerAutorisation()).url)
		await connexionSso(page, ATTENDU)
		await expect(page.getByRole('heading', { level: 1, name: 'Compte en attente de vérification' })).toBeVisible()
		await expect(page.getByRole('status')).toContainText(ATTENDU)
		const lien = page.getByRole('link', { name: 'Ouvrir mon espace de compte' })
		await page.keyboard.press('Tab')
		await lien.focus()
		await expect(lien).toBeFocused()
		await expect(lien).toHaveAttribute('href', /\/realms\/lelabs\/account$/)
		autoriserErreursConsole(page, [ERREUR_RESSOURCE_HTTP[403]])
		for (const palier of PALIERS) {
			await page.setViewportSize({ width: palier.largeur, height: palier.hauteur })
			await capturer(page, `verification-attendue-${palier.nom}`, UNITE)
			await sansDefilementHorizontal(page, `vérification attendue ${palier.nom}`)
		}
	})

	test('un registre injoignable refuse l’entrée, il ne l’accorde jamais', async ({ page }) => {
		// L'état d'erreur, provoqué de façon déterministe (CLAUDE.md §15) : le service perd le droit d'inscrire.
		const psql = (sql: string) => execFileSync('docker', ['exec', 'p2enjoy-db', 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-qc', sql])
		const signature = 'public.mcp_inscrire_compte(uuid, text, text, text[], boolean)'
		psql(`revoke execute on function ${signature} from service_role`)
		try {
			await consentir(page, (await preparerAutorisation()).url)
			await connexionSso(page, SABINE.adresse)
			await expect(page.getByRole('heading', { level: 1, name: "La connexion n'a pas abouti" })).toBeVisible()
			await expect(page.getByRole('alert')).toContainText("Aucun accès n'a été accordé")
			autoriserErreursConsole(page, [ERREUR_RESSOURCE_HTTP[403]])
			for (const palier of PALIERS) {
				await page.setViewportSize({ width: palier.largeur, height: palier.hauteur })
				await capturer(page, `connexion-refusee-${palier.nom}`, UNITE)
				await sansDefilementHorizontal(page, `connexion refusée ${palier.nom}`)
			}
		} finally {
			psql(`grant execute on function ${signature} to service_role`)
		}
	})

	test('l’accueil donne l’adresse du connecteur, et la copie se dit', async ({ page, context }) => {
		await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: ORIGINE_MCP })
		await page.goto(`${ORIGINE_MCP}/`)
		await expect(page.getByRole('heading', { level: 1, name: 'Connecteur MCP du CRM' })).toBeVisible()
		await expect(page.getByLabel('Adresse du connecteur')).toHaveValue(`${ORIGINE_MCP}/mcp`)
		const copier = page.getByRole('button', { name: "Copier l'adresse du connecteur" })
		await copier.focus()
		await page.keyboard.press('Enter')
		await expect(page.getByRole('status')).toHaveText('Adresse copiée.')
		expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`${ORIGINE_MCP}/mcp`)
		for (const palier of PALIERS) {
			await page.setViewportSize({ width: palier.largeur, height: palier.hauteur })
			await capturer(page, `accueil-${palier.nom}`, UNITE)
			await sansDefilementHorizontal(page, `accueil ${palier.nom}`)
		}
	})

	test('la page de consentement porte la charte, ne charge rien d’un tiers, et tient aux quatre paliers', async ({ page }) => {
		const tiers: string[] = []
		page.on('request', (r) => {
			const hote = new URL(r.url()).hostname
			if (!['localhost', '127.0.0.1', 'sso.localhost'].includes(hote) && !r.url().startsWith('data:')) tiers.push(r.url())
		})
		await page.goto((await preparerAutorisation()).url)
		await expect(page.getByRole('checkbox', { name: 'Stay signed in' })).toBeVisible()
		await expect(page.getByRole('img', { name: 'P2Enjoy CRM' })).toHaveAttribute('src', /^data:image\/svg\+xml,/)
		const accord = page.getByRole('button', { name: 'Allow Access' })
		expect(await accord.evaluate((b) => getComputedStyle(b).backgroundColor), 'accord primaire : --color-brand').toBe('rgb(35, 70, 140)')
		expect(tiers, 'aucune requête vers un domaine tiers (CLAUDE.md §11)').toEqual([])
		for (const palier of PALIERS) {
			await page.setViewportSize({ width: palier.largeur, height: palier.hauteur })
			await capturer(page, `consentement-${palier.nom}`, UNITE)
			await sansDefilementHorizontal(page, `consentement ${palier.nom}`)
		}
	})
})
