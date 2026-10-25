// @verifies CRM-104 (docs/BACKLOG.md) — tranche T7 : l'effet des outils de la famille `messagerie`, constaté dans la webapp
// @verifies docs/SPEC-mcp.md §9.2 decies (« un email envoyé par le connecteur paraît dans le fil de l'affaire » :
//           crm_card_mail_list puis crm_mail_send, par la file de l'écran) ; docs/SPEC-mail-subsystem.md §5 (le worker
//           soumet réellement) ; INC-271 (les boîtes rendues dans l'état trouvé) ; CLAUDE.md §8 (aucune trace
//           fabriquée), §16 (captures)
//
// Un VRAI client MCP, au nom de l'administratrice, lit le fil de « Refonte du site vitrine » puis y envoie un email ;
// l'identité est celle du service, la seule qu'elle puisse emprunter — celle de Driss, que Stalwart refuse en
// expéditeur, ne passerait pas le worker (INC-087). La file est vidée par la route interne de `mail-sync`, le vrai
// chemin ; le fil de l'affaire, dans la webapp, nomme alors le message envoyé. Le ménage retire l'envoi, le message et
// sa copie des deux boîtes, et les cases posées. L'événement `mail_sent` de la timeline, lui, reste : `card_events`
// n'accorde d'écriture à personne (`CRM-044`), comme pour `e2e/mail/envoi.spec.ts`.

// @spec CRM-115 (docs/BACKLOG.md) T2, docs/SPEC-pile-par-session.md §6 : le conteneur se désigne par son service.
import { conteneur } from '../conteneur'
import { execFileSync } from 'node:child_process'
import type { Browser } from '@playwright/test'
import { connecterAvecLeLabs, expect, test, type APIRequestContext } from './fixtures'
import { capturer } from './captures'
import { MOT_DE_PASSE_SEED, URL_API, enTetesService } from '../api/jetons'
import { lireEnv } from '../env'
import { RETOUR_CLIENT, SessionMcp, echangerCode, preparerAutorisation } from '../mcp/client'
import { instantaneDesBoites, rendreLesBoites, type Boite } from '../mail/menage'

const UNITE = 'CRM-104'
const ESPACE = '5eed0000-0000-4000-8000-000000000001'
const ADMIN = { adresse: 'admin@p2enjoy.test', sub: '5eed0000-0000-4000-8000-000000000011' }
const CARD = '5eed0000-0000-4000-8000-0000000000c1'
const BOARD = '/tracks/conseil-ia/grands-comptes'
const TITRE_CARD = 'Refonte du site vitrine'
const DESTINATAIRE = 'bizdev@p2enjoy.test'
const CASES: readonly [string, string][] = [
	['messagerie', 'consulter'],
	['messagerie', 'ajouter'],
	['affaires', 'consulter'],
]
const BOITES: readonly Boite[] = [
	{ adresse: DESTINATAIRE, motDePasse: lireEnv('STALWART_MAILBOX_PASSWORD') },
	{ adresse: 'systeme@crm.p2enjoy.test', motDePasse: lireEnv('STALWART_MAILBOX_PASSWORD') },
]
const rest = (chemin: string) => `${URL_API}/rest/v1/${chemin}`
let posees: [string, string][] = []

test.use({ viewport: { width: 1440, height: 900 } })

test.beforeEach(async ({ request }) => {
	const tenues = (await (await request.get(rest(`mcp_droits?select=famille,action&sub=eq.${ADMIN.sub}&workspace_id=eq.${ESPACE}`), { headers: enTetesService() })).json()) as { famille: string; action: string }[]
	posees = CASES.filter(([f, a]) => !tenues.some((t) => t.famille === f && t.action === a)).map(([f, a]) => [f, a])
	if (posees.length > 0) {
		const pose = await request.post(rest('mcp_droits'), {
			headers: { ...enTetesService(), prefer: 'return=minimal' },
			data: posees.map(([famille, action]) => ({ sub: ADMIN.sub, workspace_id: ESPACE, famille, action })),
		})
		expect(pose.status()).toBe(201)
	}
})

test.afterEach(async ({ request }) => {
	for (const [famille, action] of posees) {
		await request.delete(rest(`mcp_droits?sub=eq.${ADMIN.sub}&workspace_id=eq.${ESPACE}&famille=eq.${famille}&action=eq.${action}`), {
			headers: enTetesService(),
		})
	}
})

/** Vide la file par la route interne du service — le vrai chemin, jamais un appel SQL direct (`e2e/mail/envoi.spec.ts`). */
function viderLaFile(): Record<string, number> {
	const reseau = execFileSync('docker', ['inspect', conteneur('mail-sync'), '--format', '{{range $k,$v := .NetworkSettings.Networks}}{{$k}}{{end}}'], { encoding: 'utf8' }).trim()
	const source = `
import os, urllib.error, urllib.request
requete = urllib.request.Request("http://mail-sync:8080/internal/v1/outbox/flush", data=b"", method="POST")
requete.add_header("Authorization", "Bearer " + os.environ["JETON"])
try:
    with urllib.request.urlopen(requete, timeout=180) as r:
        print(r.read().decode(), end="")
except urllib.error.HTTPError as e:
    print(e.read().decode(), end="")
`
	const brut = execFileSync(
		'docker',
		['run', '--rm', '--network', reseau, '-e', `JETON=${lireEnv('MAIL_SYNC_INTERNAL_TOKEN')}`, 'python:3.13.13-slim-bookworm', 'python', '-c', source],
		{ encoding: 'utf8', timeout: 300_000 },
	).trim()
	return JSON.parse(brut) as Record<string, number>
}

/** Un vrai client MCP connecté au nom de la personne, dans un autre contexte de navigateur que la webapp. */
async function sessionDe(browser: Browser, adresse: string): Promise<SessionMcp> {
	const contexte = await browser.newContext()
	try {
		const page = await contexte.newPage()
		const autorisation = await preparerAutorisation('Preuve de la messagerie du connecteur')
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

async function retirerEnvoi(request: APIRequestContext, idEnvoi: string | undefined): Promise<void> {
	if (idEnvoi !== undefined) await request.delete(rest(`mail_outbox?id=eq.${idEnvoi}`), { headers: enTetesService() })
}

test('un email envoyé par le connecteur paraît dans le fil de l’affaire', async ({ page, browser, request }) => {
	test.setTimeout(240_000)
	const marqueur = `ConnecteurMcp${Date.now()}`
	const debut = new Date().toISOString()
	const dossiersAvant = await instantaneDesBoites(BOITES)
	let idEnvoi: string | undefined
	try {
		const session = await sessionDe(browser, ADMIN.adresse)
		const fil = await session.appeler('tools/call', { name: 'crm_card_mail_list', arguments: { card_id: CARD } })
		expect(fil.isError ?? false, JSON.stringify(fil)).toBe(false)
		expect((fil.structuredContent as { messages: { subject: string }[] }).messages[0]?.subject).toBe('Demande de devis — refonte')

		const envoi = await session.appeler('tools/call', {
			name: 'crm_mail_send',
			arguments: { card_id: CARD, to: [DESTINATAIRE], subject: `Proposition ${marqueur}`, body: 'Bonjour,\n\nVoici notre proposition.' },
		})
		expect(envoi.isError ?? false, JSON.stringify(envoi)).toBe(false)
		const rendu = envoi.structuredContent as { outbox_id: string; status: string; from_address: string }
		idEnvoi = rendu.outbox_id
		expect([rendu.status, rendu.from_address]).toEqual(['queued', 'systeme@crm.p2enjoy.test'])

		// LE WORKER SOUMET RÉELLEMENT : la ligne passe à `sent` et le message sortant est inscrit au fil.
		const passe = viderLaFile()
		expect(passe['sent'], `passe = ${JSON.stringify(passe)}`).toBeGreaterThanOrEqual(1)
		const [ligne] = (await (await request.get(rest(`mail_outbox?select=status,created_by&id=eq.${idEnvoi}`), { headers: enTetesService() })).json()) as { status: string; created_by: string }[]
		expect(ligne).toEqual({ status: 'sent', created_by: ADMIN.sub })

		await connecterAvecLeLabs(page, ADMIN.adresse)
		await page.goto(BOARD)
		await page.getByRole('link', { name: TITRE_CARD }).click()
		await expect(page).toHaveURL(new RegExp(`/cards/${CARD}$`, 'u'))
		const filAffaire = page.getByRole('region', { name: 'Fil de cette affaire' })
		const message = filAffaire.locator('li').filter({ hasText: marqueur })
		await expect(message).toBeVisible()
		await expect(message).toContainText('Message envoyé')
		await message.scrollIntoViewIfNeeded()
		await capturer(page, 'connecteur-messagerie-fil-1440', UNITE)
	} finally {
		await retirerEnvoi(request, idEnvoi)
		await rendreLesBoites(request, { boites: BOITES, motif: marqueur, avant: dossiersAvant, debut })
	}
})
