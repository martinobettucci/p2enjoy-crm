// @verifies CRM-054 (docs/BACKLOG.md) — ingestion d'un email RÉELLEMENT envoyé
// @verifies docs/SPEC-mail-subsystem.md §4.2 (dédoublonnage et occurrences), §4.3 (les statuts
//           antivirus), §15.4 (le chemin authentifié), §15.5 (dépôt puis analyse, nom assaini)
// @verifies docs/JOURNAL.md décision 320 ; CLAUDE.md §8 (aucune trace fabriquée)
//
// RIEN N'EST SIMULÉ : un message est réellement soumis en SMTP authentifié — le chemin d'un
// message légitime remis par un serveur (§15.4) —, relevé par le service depuis le vrai IMAP,
// analysé par le vrai ClamAV, et déposé dans le vrai Storage. Chaque assertion relit la BASE.
//
// LE SEED N'EST PAS TOUCHÉ : les messages ingérés ne font pas partie du seed, et le scénario
// retire ce qu'il a créé — en base et dans la boîte.

import { execFileSync } from 'node:child_process'
import { expect, test } from '@playwright/test'
import { lireEnv, urlApi } from '../env'
import { enTetesService } from '../api/jetons'

const CONTENEUR = 'p2enjoy-mail-sync'
const IMAGE = 'python:3.13.13-slim-bookworm'
const JETON = lireEnv('MAIL_SYNC_INTERNAL_TOKEN')
const URL_API = urlApi()
const EICAR = String.raw`X5O!P%@AP[4\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*`

function docker(...arguments_: string[]): string {
	return execFileSync('docker', arguments_, { encoding: 'utf8', timeout: 300_000 }).trim()
}

const RESEAU = docker(
	'inspect',
	CONTENEUR,
	'--format',
	'{{range $k,$v := .NetworkSettings.Networks}}{{$k}}{{end}}',
)

function python(source: string, variables: Record<string, string> = {}): string {
	const arguments_ = ['run', '--rm', '--network', RESEAU]
	for (const [nom, valeur] of Object.entries(variables)) arguments_.push('-e', `${nom}=${valeur}`)
	arguments_.push(IMAGE, 'python', '-c', source)
	return docker(...arguments_)
}

/** Soumet un message à une adresse choisie — `CRM-055` en a besoin pour viser une card. */
function envoyerA(identifiant: string, destinataire: string): void {
	python(
		`
import os, smtplib
from email.message import EmailMessage

msg = EmailMessage()
msg['From'] = 'admin@p2enjoy.test'
msg['To'] = os.environ['DEST']
msg['Subject'] = 'Classement ' + os.environ['ID']
msg['Message-ID'] = '<' + os.environ['ID'] + '@p2enjoy.test>'
msg.set_content('Message adressé à une card.')
s = smtplib.SMTP('stalwart', 587, timeout=30)
s.ehlo()
s.login('admin@p2enjoy.test', 'SeedDev2026Local')
s.send_message(msg)
s.quit()
`,
		{ ID: identifiant, DEST: destinataire },
	)
}

/** Soumet un message par le chemin AUTHENTIFIÉ, seul chemin d'un message légitime (§15.4). */
function envoyer(identifiant: string, avecPieces: boolean): void {
	python(
		`
import os, smtplib
from email.message import EmailMessage

msg = EmailMessage()
msg['From'] = 'admin@p2enjoy.test'
msg['To'] = 'c-abcd1234@crm.p2enjoy.test'
msg['Subject'] = 'Ingestion ' + os.environ['ID']
msg['Message-ID'] = '<' + os.environ['ID'] + '@p2enjoy.test>'
msg.set_content('Corps du message de preuve.')
if os.environ['PIECES'] == 'oui':
    msg.add_attachment(os.environ['EICAR'].encode(), maintype='application',
                       subtype='octet-stream', filename='eicar.txt')
    msg.add_attachment(b'%PDF-1.7 anodin', maintype='application', subtype='octet-stream',
                       filename='../rapport.pdf')
s = smtplib.SMTP('stalwart', 587, timeout=30)
s.ehlo()
s.login('admin@p2enjoy.test', 'SeedDev2026Local')
s.send_message(msg)
s.quit()
`,
		{ ID: identifiant, PIECES: avecPieces ? 'oui' : 'non', EICAR },
	)
}

function relever(compte: string): Record<string, number> {
	const brut = python(
		`
import os, urllib.error, urllib.request
requete = urllib.request.Request(
    "http://mail-sync:8080/internal/v1/inbound-accounts/" + os.environ["COMPTE"] + "/poll",
    data=b"", method="POST")
requete.add_header("Authorization", "Bearer " + os.environ["JETON"])
try:
    with urllib.request.urlopen(requete, timeout=180) as r:
        print(r.read().decode(), end="")
except urllib.error.HTTPError as e:
    print(e.read().decode(), end="")
`,
		{ COMPTE: compte, JETON },
	)
	return JSON.parse(brut) as Record<string, number>
}

function retirerDeLaBoite(identifiant: string): void {
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
c.logout()
`,
		{ ID: identifiant },
	)
}

test.describe('ingestion — un email réellement envoyé, relevé et analysé', () => {
	test('le message est ingéré, sa pièce infectée détectée, et le rejeu n’ajoute rien', async ({
		request,
	}) => {
		test.setTimeout(300_000)
		const identifiant = `ingest-${Date.now()}`
		const compteReponse = await request.get(
			`${URL_API}/rest/v1/mail_inbound_accounts?owner_id=is.null&select=id,watch_folders`,
			{ headers: enTetesService() },
		)
		const [compte] = (await compteReponse.json()) as { id: string; watch_folders: string[] }[]
		expect(compte?.id).toBeDefined()

		try {
			envoyer(identifiant, true)

			const premiere = relever(compte!.id)
			expect(premiere['messages_new'], JSON.stringify(premiere)).toBeGreaterThanOrEqual(1)
			expect(premiere['attachments_infected']).toBe(1)

			const messages = await request.get(
				`${URL_API}/rest/v1/mail_messages?rfc822_message_id=eq.${encodeURIComponent(`<${identifiant}@p2enjoy.test>`)}&select=id,subject,from_address,classification`,
				{ headers: enTetesService() },
			)
			const [message] = (await messages.json()) as {
				id: string
				subject: string
				from_address: string
				classification: string
			}[]
			expect(message?.subject).toBe(`Ingestion ${identifiant}`)
			expect(message?.from_address).toBe('admin@p2enjoy.test')
			// `CRM-054` n'a PAS de classement : le message est ingéré non classé (§15.2).
			expect(message?.classification).toBe('unclassified')

			const occurrences = await request.get(
				`${URL_API}/rest/v1/mail_message_occurrences?message_id=eq.${message?.id}&select=folder,uid`,
				{ headers: enTetesService() },
			)
			expect((await occurrences.json()) as unknown[]).toHaveLength(1)

			const pieces = await request.get(
				`${URL_API}/rest/v1/mail_attachments?message_id=eq.${message?.id}&select=filename,mime_type,av_status,storage_path,original_name&order=filename`,
				{ headers: enTetesService() },
			)
			const jointes = (await pieces.json()) as {
				filename: string
				mime_type: string
				av_status: string
				storage_path: string
				original_name: string
			}[]
			expect(jointes).toHaveLength(2)

			const eicar = jointes.find((p) => p.filename === 'eicar.txt')
			expect(eicar?.av_status, 'ClamAV doit reconnaître EICAR').toBe('infected')

			const rapport = jointes.find((p) => p.filename === 'rapport.pdf')
			// Le nom est ASSAINI — `../rapport.pdf` ne subsiste pas — et l'original est conservé.
			expect(rapport?.original_name).toContain('..')
			// Le type vient du CONTENU : le message déclarait `application/octet-stream`.
			expect(rapport?.mime_type).toBe('application/pdf')
			expect(rapport?.av_status).toBe('clean')
			// LE CHEMIN NE PORTE AUCUN NOM DE FICHIER (§15.5).
			expect(rapport?.storage_path).not.toContain('rapport')
			expect(rapport?.storage_path.split('/')).toHaveLength(3)

			// LA RELÈVE EST IDEMPOTENTE : le dédoublonnage est tenu par la base (§4.2).
			const seconde = relever(compte!.id)
			expect(seconde['messages_new']).toBe(0)
			expect(seconde['occurrences']).toBe(0)
		} finally {
			retirerDeLaBoite(identifiant)
			await request.delete(
				`${URL_API}/rest/v1/mail_messages?rfc822_message_id=eq.${encodeURIComponent(`<${identifiant}@p2enjoy.test>`)}`,
				{ headers: enTetesService() },
			)
		}
	})

	// CRM-055 — LE CLASSEMENT AUTOMATIQUE, SUR UN VRAI MESSAGE ADRESSÉ À UNE VRAIE CARD.
	test('un email adressé à l’adresse d’une card y est classé automatiquement', async ({
		request,
	}) => {
		test.setTimeout(300_000)
		const identifiant = `auto-${Date.now()}`

		const cartes = await request.get(
			`${URL_API}/rest/v1/cards?archived_at=is.null&deleted_at=is.null&select=id,title,email_local_part&limit=1`,
			{ headers: enTetesService() },
		)
		const [carte] = (await cartes.json()) as {
			id: string
			title: string
			email_local_part: string
		}[]
		expect(carte?.email_local_part).toBeDefined()

		const compteReponse = await request.get(
			`${URL_API}/rest/v1/mail_inbound_accounts?owner_id=is.null&select=id`,
			{ headers: enTetesService() },
		)
		const [compte] = (await compteReponse.json()) as { id: string }[]

		try {
			envoyerA(identifiant, `${carte!.email_local_part}@crm.p2enjoy.test`)

			const releve = relever(compte!.id)
			expect(releve['messages_classified'], JSON.stringify(releve)).toBeGreaterThanOrEqual(1)

			const messages = await request.get(
				`${URL_API}/rest/v1/mail_messages?rfc822_message_id=eq.${encodeURIComponent(`<${identifiant}@p2enjoy.test>`)}&select=id,classification,card_id,classified_by`,
				{ headers: enTetesService() },
			)
			const [message] = (await messages.json()) as {
				id: string
				classification: string
				card_id: string
				classified_by: string | null
			}[]
			expect(message?.classification).toBe('auto')
			expect(message?.card_id).toBe(carte!.id)
			// Un classement automatique n'a PAS d'auteur : prétendre le contraire attribuerait un
			// geste à quelqu'un.
			expect(message?.classified_by).toBeNull()

			const evenements = await request.get(
				`${URL_API}/rest/v1/card_events?card_id=eq.${carte!.id}&type=eq.mail_received&select=payload`,
				{ headers: enTetesService() },
			)
			const traces = (await evenements.json()) as { payload: { rule: string } }[]
			expect(traces.some((t) => t.payload.rule === 'auto')).toBe(true)
		} finally {
			retirerDeLaBoite(identifiant)
			await request.delete(
				`${URL_API}/rest/v1/mail_messages?rfc822_message_id=eq.${encodeURIComponent(`<${identifiant}@p2enjoy.test>`)}`,
				{ headers: enTetesService() },
			)
			// L'événement de timeline reste : `card_events` n'accorde aucune écriture, à personne
			// (`CRM-044`), et l'historique d'une card ne se corrige pas. Prétendre l'effacer
			// aurait produit un refus silencieux.
		}
	})

	test('la relève exige le jeton interne, et un compte inconnu rend 404', () => {
		const sansJeton = python(`
import urllib.error, urllib.request
requete = urllib.request.Request(
    "http://mail-sync:8080/internal/v1/inbound-accounts/5eed0000-0000-4000-8000-0000000000ff/poll",
    data=b"", method="POST")
try:
    with urllib.request.urlopen(requete, timeout=10) as r:
        print(r.status)
except urllib.error.HTTPError as e:
    print(e.code)
`)
		expect(Number(sansJeton.trim())).toBe(401)

		const inconnu = python(
			`
import os, urllib.error, urllib.request
requete = urllib.request.Request(
    "http://mail-sync:8080/internal/v1/inbound-accounts/5eed0000-0000-4000-8000-0000000000ff/poll",
    data=b"", method="POST")
requete.add_header("Authorization", "Bearer " + os.environ["JETON"])
try:
    with urllib.request.urlopen(requete, timeout=30) as r:
        print(r.status)
except urllib.error.HTTPError as e:
    print(e.code)
`,
			{ JETON },
		)
		expect(Number(inconnu.trim())).toBe(404)
	})
})
