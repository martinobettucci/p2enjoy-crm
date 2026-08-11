// @verifies CRM-056 (docs/BACKLOG.md) — observation VISUELLE de l'arborescence dans Roundcube
// @verifies docs/SPEC-mail-subsystem.md §4.5 (dossiers imbriqués), §11.5 (Roundcube est le seul
//           moyen de vérification visuelle de la messagerie tant que CRM-057 n'existe pas)
// @verifies CLAUDE.md §16 (vérification visuelle) ; docs/JOURNAL.md décision 323
//
// LA DEFINITION OF DONE EXIGE UNE OBSERVATION VISUELLE, et c'est le seul endroit du produit où
// l'arborescence se voit : aucun écran ne la montre avant `CRM-057`. Le parcours est celui d'un
// utilisateur — souris et clavier, jamais d'affectation directe de champ.
//
// Le scénario crée son propre message, l'observe, puis retire dossiers et message : la boîte est
// rendue telle qu'elle a été reçue.

import { execFileSync } from 'node:child_process'
import { expect, test, type Page } from '@playwright/test'
import { capturer } from '../ui/captures'
import { lireEnv, urlApi } from '../env'
import { enTetesService } from '../api/jetons'

const URL_ROUNDCUBE = `http://127.0.0.1:${lireEnv('ROUNDCUBE_PORT')}/`
const BOITE_SYSTEME = 'systeme@crm.p2enjoy.test'
const MDP = lireEnv('STALWART_MAILBOX_PASSWORD')
const JETON = lireEnv('MAIL_SYNC_INTERNAL_TOKEN')
const URL_API = urlApi()
const IMAGE = 'python:3.13.13-slim-bookworm'

function docker(...arguments_: string[]): string {
	return execFileSync('docker', arguments_, { encoding: 'utf8', timeout: 300_000 }).trim()
}

const RESEAU = docker(
	'inspect',
	'p2enjoy-mail-sync',
	'--format',
	'{{range $k,$v := .NetworkSettings.Networks}}{{$k}}{{end}}',
)

function python(source: string, variables: Record<string, string> = {}): string {
	const arguments_ = ['run', '--rm', '--network', RESEAU]
	for (const [nom, valeur] of Object.entries(variables)) arguments_.push('-e', `${nom}=${valeur}`)
	arguments_.push(IMAGE, 'python', '-c', source)
	return docker(...arguments_)
}

async function ouvrirSession(page: Page): Promise<void> {
	await page.goto(URL_ROUNDCUBE)
	// Gestes d'utilisateur : la souris place le focus, le clavier saisit, la souris soumet.
	await page.locator('#rcmloginuser').click()
	await page.keyboard.type(BOITE_SYSTEME)
	await page.keyboard.press('Tab')
	await page.keyboard.type(MDP)
	await page.locator('#rcmloginsubmit').click()
	await page.locator('#mailboxlist').waitFor({ state: 'visible', timeout: 30_000 })
}

test.describe('M6 — l’arborescence des cards se voit dans Roundcube', () => {
	const anomalies = new WeakMap<Page, string[]>()

	test.beforeEach(async ({ page }) => {
		const relevees: string[] = []
		anomalies.set(page, relevees)
		page.on('console', (message) => {
			if (message.type() === 'warning' || message.type() === 'error') {
				relevees.push(`${message.type()}: ${message.text()}`)
			}
		})
		page.on('pageerror', (erreur) => relevees.push(`pageerror: ${erreur.message}`))
	})

	test.afterEach(async ({ page }) => {
		expect(
			anomalies.get(page) ?? [],
			'aucun avertissement ni erreur dans la console du parcours Roundcube',
		).toEqual([])
	})

	test('les trois niveaux apparaissent, et le message est dans le dossier de sa card', async ({
		page,
		request,
	}) => {
		test.setTimeout(300_000)
		const identifiant = `roundcube-${Date.now()}`

		const cartes = await request.get(
			`${URL_API}/rest/v1/cards?archived_at=is.null&deleted_at=is.null&select=id,email_local_part&limit=1`,
			{ headers: enTetesService() },
		)
		const [carte] = (await cartes.json()) as { id: string; email_local_part: string }[]
		const comptes = await request.get(
			`${URL_API}/rest/v1/mail_inbound_accounts?owner_id=is.null&select=id`,
			{ headers: enTetesService() },
		)
		const [compte] = (await comptes.json()) as { id: string }[]
		const cheminReponse = await request.post(`${URL_API}/rest/v1/rpc/chemin_dossier_card`, {
			headers: enTetesService(),
			data: { p_card_id: carte!.id },
		})
		const chemin = (await cheminReponse.json()) as string
		const [, track, channel, card] = chemin.split('/')

		try {
			python(
				`
import os, smtplib
from email.message import EmailMessage

msg = EmailMessage()
msg['From'] = 'admin@p2enjoy.test'
msg['To'] = os.environ['DEST']
msg['Subject'] = 'Roundcube ' + os.environ['ID']
msg['Message-ID'] = '<' + os.environ['ID'] + '@p2enjoy.test>'
msg.set_content('Message visible dans son dossier.')
s = smtplib.SMTP('stalwart', 587, timeout=30)
s.ehlo()
s.login('admin@p2enjoy.test', 'SeedDev2026Local')
s.send_message(msg)
s.quit()
`,
				{ ID: identifiant, DEST: `${carte!.email_local_part}@crm.p2enjoy.test` },
			)

			python(
				`
import os, urllib.request
requete = urllib.request.Request(
    "http://mail-sync:8080/internal/v1/inbound-accounts/" + os.environ["COMPTE"] + "/poll",
    data=b"", method="POST")
requete.add_header("Authorization", "Bearer " + os.environ["JETON"])
with urllib.request.urlopen(requete, timeout=180) as r:
    print(r.status)
`,
				{ COMPTE: compte!.id, JETON },
			)

			await page.setViewportSize({ width: 1440, height: 900 })
			await ouvrirSession(page)

			// LES TROIS NIVEAUX SONT LUS À L'ÉCRAN, avec leurs vrais noms — accents et esperluette
			// compris. Un libellé illisible signalerait un défaut d'encodage que l'API ne montre
			// pas.
			const dossiers = page.locator('#mailboxlist')
			// L'attente porte sur `CRM`, dont l'apparition prouve que la souscription a pris : un
			// dossier créé mais NON SOUSCRIT n'apparaît pas dans un client de messagerie, et c'est
			// ce que cette observation a trouvé la première fois.
			await expect(dossiers).toContainText('CRM', { timeout: 30_000 })
			await expect(dossiers).toContainText(track as string)
			await expect(dossiers).toContainText(channel as string)
			await expect(dossiers).toContainText(card as string)

			await capturer(page, 'roundcube-arborescence-cards-1440', 'CRM-056')

			// LE MESSAGE EST DANS LE DOSSIER DE SA CARD : on l'ouvre à la souris, comme un
			// utilisateur, et le sujet doit s'y trouver.
			// Le dossier s'ouvre par un CLIC sur son lien, comme un utilisateur le ferait.
			//
			// LE NOM N'EST PAS EXIGÉ EXACT, ET C'EST MESURÉ : Roundcube colle le compteur de
			// messages non lus DANS le lien — « Inbox12 » —, si bien qu'un `exact: true` ne
			// résout jamais et attend indéfiniment. Le défaut s'est manifesté par un test qui
			// expirait au bout de cinq minutes sans rien dire.
			await dossiers
				.getByRole('link', { name: card as string })
				.first()
				.click({ timeout: 30_000 })
			await expect(page.locator('#messagelist')).toContainText(`Roundcube ${identifiant}`, {
				timeout: 60_000,
			})
			await capturer(page, 'roundcube-message-dans-la-card-1440', 'CRM-056')

			// ET IL EST TOUJOURS DANS INBOX : le produit COPIE, il ne déplace pas (§4.5).
			await dossiers.getByRole('link', { name: 'Inbox' }).first().click({ timeout: 30_000 })
			await expect(page.locator('#messagelist')).toContainText(`Roundcube ${identifiant}`, {
				timeout: 60_000,
			})
		} finally {
			python(
				`
import os, imaplib

c = imaplib.IMAP4('stalwart', 143)
c.login('systeme@crm.p2enjoy.test', 'SeedDev2026Local')
for dossier in ('INBOX', 'Junk Mail'):
    c.select('"%s"' % dossier)
    typ, ids = c.uid('search', None, 'ALL')
    for uid in ids[0].split():
        typ, brut = c.uid('fetch', uid, '(BODY.PEEK[HEADER.FIELDS (MESSAGE-ID)])')
        if os.environ['ID'].encode() in brut[0][1]:
            c.uid('store', uid, '+FLAGS', '(\\\\Deleted)')
    c.expunge()
typ, dossiers = c.list()
noms = [d.decode('utf-8').rsplit(' "/" ', 1)[-1].strip('"') for d in dossiers]
for nom in sorted((n for n in noms if n.startswith('CRM')), key=len, reverse=True):
    try:
        c.delete('"%s"' % nom)
    except Exception:
        pass
c.logout()
`,
				{ ID: identifiant },
			)
			await request.delete(
				`${URL_API}/rest/v1/mail_messages?rfc822_message_id=eq.${encodeURIComponent(`<${identifiant}@p2enjoy.test>`)}`,
				{ headers: enTetesService() },
			)
			await request.delete(`${URL_API}/rest/v1/mail_folder_map?actual_path=like.CRM*`, {
				headers: enTetesService(),
			})
		}
	})
})
