// @verifies CRM-138 (docs/BACKLOG.md) — tranche T2 : contre le vrai serveur IMAP de dev, un message effacé AVEC la case
//           arrive dans la corbeille de sa boîte (le dossier annoncé `\Trash`, trouvé par le LIST étendu de la RFC 6154) ;
//           effacé SANS la case, il reste dans son dossier
// @verifies docs/SPEC-mail-subsystem.md §29.3, §29.5 ; docs/JOURNAL.md décisions 878 et 917
//
// La preuve dépose ses propres messages dans la boîte de Camille (`admin@p2enjoy.test`) par IMAP, les inscrit en base sous
// la clé de service avec leur UID, les efface sous le jeton de Camille, puis déclenche la passe de `mail-sync` par sa route
// interne. Elle retire tout à la fin : les lignes en base, et les messages de la boîte, où qu'ils soient.

import { conteneur } from '../conteneur'
import { execFileSync } from 'node:child_process'
import { expect, test } from '@playwright/test'
import { lireEnv, urlApi } from '../env'
import { enTetesAuthentifies, enTetesService, jetonDe } from '../api/jetons'

const CONTENEUR = conteneur('mail-sync')
const IMAGE = 'python:3.13.13-slim-bookworm'
const JETON = lireEnv('MAIL_SYNC_INTERNAL_TOKEN')
const URL_API = urlApi()
const WORKSPACE = '5eed0000-0000-4000-8000-000000000001'
const CAMILLE = '5eed0000-0000-4000-8000-000000000011'
const BOITE = { adresse: 'admin@p2enjoy.test', motDePasse: 'SeedDev2026Local' }

function docker(...arguments_: string[]): string {
	return execFileSync('docker', arguments_, { encoding: 'utf8', timeout: 300_000 }).trim()
}

let reseauMemo: string | undefined
function reseau(): string {
	reseauMemo ??= docker('inspect', CONTENEUR, '--format', '{{range $k,$v := .NetworkSettings.Networks}}{{$k}}{{end}}')
	return reseauMemo
}

function python(source: string, variables: Record<string, string> = {}): string {
	const arguments_ = ['run', '--rm', '--network', reseau()]
	for (const [nom, valeur] of Object.entries(variables)) arguments_.push('-e', `${nom}=${valeur}`)
	arguments_.push(IMAGE, 'python', '-c', source)
	return docker(...arguments_)
}

const IMAP = `
import imaplib, os
m = imaplib.IMAP4("stalwart", 143)
m.login(os.environ["ADRESSE"], os.environ["MOT"])
`

/** Dépose un message dans INBOX et rend son UID. */
function deposer(objet: string): number {
	return Number(
		python(
			IMAP +
				`
import email.utils, time
corps = ("From: client@exemple.test\\r\\nTo: " + os.environ["ADRESSE"] + "\\r\\nSubject: " + os.environ["OBJET"]
         + "\\r\\nMessage-ID: <" + os.environ["OBJET"].replace(" ", "-") + "@exemple.test>\\r\\nDate: "
         + email.utils.formatdate() + "\\r\\n\\r\\nPreuve CRM-138.\\r\\n").encode()
m.append("INBOX", "", imaplib.Time2Internaldate(time.time()), corps)
m.select("INBOX")
typ, dat = m.uid("SEARCH", None, "SUBJECT", '"' + os.environ["OBJET"] + '"')
print(dat[0].split()[-1].decode(), end="")
m.logout()
`,
			{ ADRESSE: BOITE.adresse, MOT: BOITE.motDePasse, OBJET: objet },
		),
	)
}

/** Les dossiers de la boîte où un message de cet objet se trouve. */
function ouEst(objet: string): string[] {
	return JSON.parse(
		python(
			IMAP +
				`
import json, re
trouves = []
for ligne in m.list()[1]:
    nom = re.search(rb'"([^"]+)"$', ligne).group(1).decode()
    if m.select('"' + nom + '"', readonly=True)[0] != "OK":
        continue
    typ, dat = m.uid("SEARCH", None, "SUBJECT", '"' + os.environ["OBJET"] + '"')
    if dat[0].split():
        trouves.append(nom)
print(json.dumps(trouves), end="")
m.logout()
`,
			{ ADRESSE: BOITE.adresse, MOT: BOITE.motDePasse, OBJET: objet },
		),
	) as string[]
}

/** Retire de la boîte tout message de cet objet, quel que soit son dossier. */
function retirer(objet: string): void {
	python(
		IMAP +
			`
import re
for ligne in m.list()[1]:
    nom = re.search(rb'"([^"]+)"$', ligne).group(1).decode()
    if m.select('"' + nom + '"')[0] != "OK":
        continue
    typ, dat = m.uid("SEARCH", None, "SUBJECT", '"' + os.environ["OBJET"] + '"')
    for uid in dat[0].split():
        m.uid("STORE", uid, "+FLAGS", "(\\\\Deleted)")
    m.expunge()
m.logout()
`,
		{ ADRESSE: BOITE.adresse, MOT: BOITE.motDePasse, OBJET: objet },
	)
}

function passeCorbeille(): Record<string, number> {
	return JSON.parse(
		python(
			`
import os, urllib.error, urllib.request
r = urllib.request.Request("http://mail-sync:8080/internal/v1/trash-moves/flush", data=b"", method="POST")
r.add_header("Authorization", "Bearer " + os.environ["JETON"])
try:
    with urllib.request.urlopen(r, timeout=180) as s:
        print(s.read().decode(), end="")
except urllib.error.HTTPError as e:
    print(e.read().decode(), end="")
`,
			{ JETON },
		),
	) as Record<string, number>
}

test.describe('le déplacement dans la corbeille de la boîte (CRM-138 T2, §29.5)', () => {
	test('avec la case, le message passe dans la corbeille de la boîte ; sans elle, il reste où il est', async ({ request }) => {
		const marque = `crm138-${Date.now()}`
		const avec = `${marque} avec la case`
		const sans = `${marque} sans la case`
		const camille = await jetonDe(BOITE.adresse)
		const [boite] = (await (
			await request.get(`${URL_API}/rest/v1/mail_inbound_accounts?select=id&owner_id=eq.${CAMILLE}&order=created_at&limit=1`, {
				headers: enTetesService(),
			})
		).json()) as { id: string }[]
		expect(boite, 'la boîte de Camille dans le seed').toBeDefined()
		const inscrits: string[] = []
		const inscrire = async (objet: string, uid: number): Promise<string> => {
			const pose = await request.post(`${URL_API}/rest/v1/mail_messages?select=id`, {
				headers: { ...enTetesService(), Prefer: 'return=representation' },
				data: {
					workspace_id: WORKSPACE,
					rfc822_message_id: `<${objet.replace(/ /g, '-')}@exemple.test>`,
					classification: 'unclassified',
					direction: 'inbound',
					from_address: 'client@exemple.test',
					subject: objet,
					received_at: new Date().toISOString(),
				},
			})
			expect(pose.status(), await pose.text()).toBe(201)
			const id = ((await pose.json()) as { id: string }[])[0]!.id
			inscrits.push(id)
			const occurrence = await request.post(`${URL_API}/rest/v1/mail_message_occurrences`, {
				headers: enTetesService(),
				data: { message_id: id, account_id: boite!.id, folder: 'INBOX', uid },
			})
			expect(occurrence.status(), await occurrence.text()).toBe(201)
			return id
		}
		const effacer = async (id: string, boiteAussi: boolean) => {
			const reponse = await request.post(`${URL_API}/rest/v1/rpc/delete_message`, {
				headers: { ...enTetesAuthentifies(camille), 'Content-Type': 'application/json' },
				data: { p_message_id: id, p_also_mailbox: boiteAussi },
			})
			expect(reponse.status(), await reponse.text()).toBe(200)
		}
		try {
			const idAvec = await inscrire(avec, deposer(avec))
			const idSans = await inscrire(sans, deposer(sans))
			expect(ouEst(avec)).toEqual(['INBOX'])

			await effacer(idAvec, true)
			await effacer(idSans, false)
			const bilan = passeCorbeille()
			expect(bilan.done, `passe de mail-sync : ${JSON.stringify(bilan)}`).toBeGreaterThanOrEqual(1)

			// Avec la case : dans le dossier `\Trash` du serveur (« Deleted Items » sur le serveur de dev), plus dans INBOX.
			expect(ouEst(avec)).toEqual(['Deleted Items'])
			const etats = (await (
				await request.get(`${URL_API}/rest/v1/mail_trash_moves?select=state,last_error&message_id=eq.${idAvec}`, {
					headers: enTetesService(),
				})
			).json()) as { state: string; last_error: string | null }[]
			expect(etats).toEqual([{ state: 'done', last_error: null }])
			// Sans la case : aucun déplacement demandé, le message reste dans sa boîte.
			expect(ouEst(sans)).toEqual(['INBOX'])
			const aucun = (await (
				await request.get(`${URL_API}/rest/v1/mail_trash_moves?select=id&message_id=eq.${idSans}`, { headers: enTetesService() })
			).json()) as unknown[]
			expect(aucun).toEqual([])
		} finally {
			for (const id of inscrits) await request.delete(`${URL_API}/rest/v1/mail_messages?id=eq.${id}`, { headers: enTetesService() })
			retirer(avec)
			retirer(sans)
		}
	})
})
