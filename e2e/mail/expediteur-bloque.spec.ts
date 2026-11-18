// @verifies CRM-156 (docs/BACKLOG.md) — tranche T2 : contre le vrai serveur IMAP de dev et la vraie relève, un mail d'un
//           expéditeur bloqué arrive directement dans la corbeille de l'inbox — effacé au nom de l'administratrice qui a
//           bloqué, ni lu dans l'inbox, ni classé, et listé dans sa corbeille
// @verifies docs/SPEC-mail-subsystem.md §32.8 (à la réception) ; docs/JOURNAL.md décisions 945 et 947 ; CLAUDE.md §8 (aucune
//           trace fabriquée : le mail est réellement déposé et réellement relevé)
//
// La preuve bloque une adresse propre à l'exécution sous le jeton de Camille (administratrice), dépose par IMAP dans sa
// boîte (`admin@p2enjoy.test`) un mail venu de cette adresse, puis déclenche la relève de la boîte par la route interne de
// `mail-sync`. Elle retire tout à la fin : le blocage, la ligne en base, et le mail de la boîte.

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

/** Dépose dans INBOX un mail venu de l'adresse donnée. */
function deposer(expediteur: string, messageId: string, objet: string): void {
	python(
		IMAP +
			`
import email.utils, time
corps = ("From: " + os.environ["DE"] + "\\r\\nTo: " + os.environ["ADRESSE"] + "\\r\\nSubject: " + os.environ["OBJET"]
         + "\\r\\nMessage-ID: " + os.environ["MID"] + "\\r\\nDate: " + email.utils.formatdate()
         + "\\r\\n\\r\\nPreuve CRM-156 : un expéditeur bloqué.\\r\\n").encode()
m.append("INBOX", "", imaplib.Time2Internaldate(time.time()), corps)
m.logout()
`,
		{ ADRESSE: BOITE.adresse, MOT: BOITE.motDePasse, DE: expediteur, MID: messageId, OBJET: objet },
	)
}

/**
 * Retire de la boîte tout mail venu du domaine de la preuve, quel que soit son dossier. LA RECHERCHE PORTE SUR
 * L'EXPÉDITEUR, EN ASCII : `imaplib` refuse un critère accentué, et un objet accentué laissait le mail dans la boîte —
 * où la veille l'aurait relevé une fois le blocage levé. Le domaine attrape aussi les restes d'un passage interrompu.
 */
function retirer(): void {
	python(
		IMAP +
			`
import re
for ligne in m.list()[1]:
    nom = re.search(rb'"([^"]+)"$', ligne).group(1).decode()
    if m.select('"' + nom + '"')[0] != "OK":
        continue
    typ, dat = m.uid("SEARCH", None, "FROM", '"bloque.example"')
    for uid in dat[0].split():
        m.uid("STORE", uid, "+FLAGS", "(\\\\Deleted)")
    m.expunge()
m.logout()
`,
		{ ADRESSE: BOITE.adresse, MOT: BOITE.motDePasse },
	)
}

/** La relève de la boîte, par la route interne de `mail-sync` (§23.2). */
function relever(compte: string): string {
	return python(
		`
import os, urllib.error, urllib.request
r = urllib.request.Request("http://mail-sync:8080/internal/v1/inbound-accounts/" + os.environ["COMPTE"] + "/poll", data=b"", method="POST")
r.add_header("Authorization", "Bearer " + os.environ["JETON"])
try:
    with urllib.request.urlopen(r, timeout=300) as s:
        print(s.status, s.read().decode(), end="")
except urllib.error.HTTPError as e:
    print(e.code, e.read().decode(), end="")
`,
		{ JETON, COMPTE: compte },
	)
}

test.describe('le mail d’un expéditeur bloqué (CRM-156 T2, §32.8)', () => {
	test('relevé après le blocage, il arrive directement dans la corbeille de l’inbox', async ({ request }) => {
		const marque = `crm156-${Date.now()}`
		const expediteur = `${marque}@bloque.example`
		const messageId = `<${marque}@bloque.example>`
		const objet = `${marque} expediteur bloque`
		const camille = await jetonDe(BOITE.adresse)
		const rpc = (fonction: string, corps: Record<string, unknown>) =>
			request.post(`${URL_API}/rest/v1/rpc/${fonction}`, {
				headers: { ...enTetesAuthentifies(camille), 'Content-Type': 'application/json' },
				data: corps,
			})
		const [boite] = (await (
			await request.get(`${URL_API}/rest/v1/mail_inbound_accounts?select=id&owner_id=eq.${CAMILLE}&order=created_at&limit=1`, {
				headers: enTetesService(),
			})
		).json()) as { id: string }[]
		expect(boite, 'la boîte de Camille dans le seed').toBeDefined()

		try {
			const bloque = await rpc('block_sender', { p_workspace_id: WORKSPACE, p_address: expediteur })
			expect(bloque.status(), await bloque.text()).toBe(200)

			deposer(expediteur, messageId, objet)
			const releve = relever(boite!.id)
			expect(releve.startsWith('200'), `relève : ${releve}`).toBe(true)

			// En base, sous la clé de service : le mail existe, né en corbeille, au nom de Camille, non classé.
			const lignes = (await (
				await request.get(
					`${URL_API}/rest/v1/mail_messages?select=id,deleted_at,deleted_by,card_id,classification&rfc822_message_id=eq.${encodeURIComponent(messageId)}`,
					{ headers: enTetesService() },
				)
			).json()) as { id: string; deleted_at: string | null; deleted_by: string; card_id: string | null; classification: string }[]
			expect(lignes, 'le mail relevé est en base').toHaveLength(1)
			expect(lignes[0]).toMatchObject({ deleted_by: CAMILLE, card_id: null, classification: 'unclassified' })
			expect(lignes[0]!.deleted_at, 'il est né en corbeille').not.toBeNull()

			// Sous le jeton de Camille : absent de l'inbox, présent dans sa corbeille.
			const inbox = (await (
				await request.get(`${URL_API}/rest/v1/mail_messages?select=id&id=eq.${lignes[0]!.id}`, {
					headers: enTetesAuthentifies(camille),
				})
			).json()) as unknown[]
			expect(inbox, 'il n’est pas dans l’inbox').toEqual([])
			const corbeille = (await (await rpc('trashed_messages', { p_workspace_id: WORKSPACE })).json()) as { message_id: string }[]
			expect(corbeille.map((ligne) => ligne.message_id)).toContain(lignes[0]!.id)
		} finally {
			// Le mail de la boîte d'abord, pour que la veille ne le relève pas entre-temps ; puis tout mail du domaine de la preuve
			// en base, y compris celui d'un passage interrompu.
			retirer()
			await request.delete(`${URL_API}/rest/v1/mail_messages?from_address=like.*%40bloque.example`, {
				headers: enTetesService(),
			})
			await request.delete(`${URL_API}/rest/v1/mail_blocked_senders?address=eq.${encodeURIComponent(expediteur)}`, {
				headers: enTetesService(),
			})
		}
	})
})
