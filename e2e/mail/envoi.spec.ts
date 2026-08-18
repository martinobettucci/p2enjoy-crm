// @verifies CRM-058 (docs/BACKLOG.md) — l'aller-retour complet, sans aucune substitution
// @verifies docs/SPEC-mail-subsystem.md §5 (envoi), §19.1 (ce que le serveur ne fait pas),
//           §19.5 (ce que le worker compose), §19.7 (preuves exigées)
// @verifies docs/JOURNAL.md décision 330 ; CLAUDE.md §8 (aucune trace fabriquée)
//
// CE QUE CE FICHIER PROUVE, ET QU'AUCUN AUTRE NE PEUT PROUVER : le tour complet. Le produit met un
// message en file par sa VRAIE garde, son worker le SOUMET réellement en SMTP authentifié, le
// destinataire le REÇOIT dans sa boîte, y répond à l'adresse que le produit a mise en `Reply-To`,
// et la relève ramène cette réponse DANS LA MÊME CARD.
//
// Rien n'est simulé. Si le `Reply-To` était faux, la réponse n'arriverait nulle part et ce
// scénario deviendrait rouge — c'est exactement ce qu'on lui demande de garantir.

import { execFileSync } from 'node:child_process'
import { expect, test } from '@playwright/test'
import { lireEnv, urlApi } from '../env'
import { enTetesAuthentifies, enTetesService, jetonDe } from '../api/jetons'

const CONTENEUR = 'p2enjoy-mail-sync'
const IMAGE = 'python:3.13.13-slim-bookworm'
const JETON = lireEnv('MAIL_SYNC_INTERNAL_TOKEN')
const URL_API = urlApi()
const CARD = '5eed0000-0000-4000-8000-0000000000c1'
const DESTINATAIRE = 'bizdev@p2enjoy.test'

function docker(...arguments_: string[]): string {
	return execFileSync('docker', arguments_, { encoding: 'utf8', timeout: 300_000 }).trim()
}

// INC-151 — CALCUL RENDU PARESSEUX le 2026-08-18. Cette valeur était une constante de premier
// niveau, donc un appel `docker` à l'IMPORT du module. Docker absent, l'import levait et Playwright
// abandonnait le PROJET ENTIER : `--list` rendait « 0 test dans 0 fichier » pour les onze fichiers
// de `e2e/mail/`, alors que neuf seulement portaient le défaut. On ne pouvait donc ni compter ni
// inventorier ces scénarios sans l'infrastructure — au moment précis où l'on en a besoin.
// La valeur et la commande sont INCHANGÉES ; seul le moment du calcul l'est, et il est mémoïsé.
let reseauMemo: string | undefined
function reseau(): string {
	reseauMemo ??= docker(
		'inspect',
		CONTENEUR,
		'--format',
		'{{range $k,$v := .NetworkSettings.Networks}}{{$k}}{{end}}',
	)
	return reseauMemo
}

function python(source: string, variables: Record<string, string> = {}): string {
	const arguments_ = ['run', '--rm', '--network', reseau()]
	for (const [nom, valeur] of Object.entries(variables)) arguments_.push('-e', `${nom}=${valeur}`)
	arguments_.push(IMAGE, 'python', '-c', source)
	return docker(...arguments_)
}

/** Vide la file par la route interne du service — le vrai chemin, jamais un appel SQL direct. */
function viderLaFile(): Record<string, number> {
	const brut = python(
		`
import os, urllib.error, urllib.request
requete = urllib.request.Request(
    "http://mail-sync:8080/internal/v1/outbox/flush", data=b"", method="POST")
requete.add_header("Authorization", "Bearer " + os.environ["JETON"])
try:
    with urllib.request.urlopen(requete, timeout=180) as r:
        print(r.read().decode(), end="")
except urllib.error.HTTPError as e:
    print(e.read().decode(), end="")
`,
		{ JETON },
	)
	return JSON.parse(brut) as Record<string, number>
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
    with urllib.request.urlopen(requete, timeout=300) as r:
        print(r.read().decode(), end="")
except urllib.error.HTTPError as e:
    print(e.read().decode(), end="")
`,
		{ COMPTE: compte, JETON },
	)
	return JSON.parse(brut) as Record<string, number>
}

/** Lit dans la BOÎTE du destinataire les en-têtes du message reçu. */
function entetesRecus(identifiant: string): Record<string, string> {
	const brut = python(
		`
import email, imaplib, os

c = imaplib.IMAP4("stalwart", 143)
c.login(os.environ["BOITE"], "SeedDev2026Local")
c.select("INBOX")
typ, ids = c.search(None, "HEADER", "Subject", os.environ["OBJET"])
resultat = {}
for uid in ids[0].split():
    typ, brut = c.fetch(uid, "(BODY.PEEK[HEADER])")
    entetes = email.message_from_bytes(brut[0][1])
    for cle in ("From", "To", "Subject", "Reply-To", "Message-ID", "In-Reply-To", "References"):
        valeur = entetes.get(cle)
        if valeur is not None:
            resultat[cle] = valeur.replace("\\n", " ").replace("\\r", " ")
c.logout()
print("\\n".join(cle + "=" + valeur for cle, valeur in resultat.items()))
`,
		{ BOITE: DESTINATAIRE, OBJET: identifiant },
	)
	const entetes: Record<string, string> = {}
	for (const ligne of brut.split('\n')) {
		const separateur = ligne.indexOf('=')
		if (separateur > 0) entetes[ligne.slice(0, separateur)] = ligne.slice(separateur + 1).trim()
	}
	return entetes
}

/** Le destinataire RÉPOND, comme un correspondant réel : à l'adresse du `Reply-To`. */
function repondre(replyTo: string, parent: string, identifiant: string): void {
	python(
		`
import os, smtplib
from email.message import EmailMessage

msg = EmailMessage()
msg["From"] = os.environ["BOITE"]
msg["To"] = os.environ["DEST"]
msg["Subject"] = "Re: " + os.environ["OBJET"]
msg["Message-ID"] = "<" + os.environ["ID"] + "@p2enjoy.test>"
msg["In-Reply-To"] = os.environ["PARENT"]
msg["References"] = os.environ["PARENT"]
msg.set_content("Bien recu, merci.")
s = smtplib.SMTP("stalwart", 587, timeout=30)
s.ehlo()
s.login(os.environ["BOITE"], "SeedDev2026Local")
s.send_message(msg)
s.quit()
`,
		{ BOITE: DESTINATAIRE, DEST: replyTo, PARENT: parent, ID: identifiant, OBJET: identifiant },
	)
}

function retirerDeLaBoite(boite: string, motif: string): void {
	python(
		`
import os, imaplib

c = imaplib.IMAP4("stalwart", 143)
c.login(os.environ["BOITE"], "SeedDev2026Local")
for dossier in ("INBOX", "Junk Mail"):
    try:
        c.select('"%s"' % dossier)
    except Exception:
        continue
    typ, ids = c.uid("search", None, "ALL")
    for uid in (ids[0] or b"").split():
        typ, brut = c.uid("fetch", uid, "(BODY.PEEK[HEADER.FIELDS (SUBJECT)])")
        if os.environ["MOTIF"].encode() in brut[0][1]:
            c.uid("store", uid, "+FLAGS", "(\\\\Deleted)")
    c.expunge()
c.logout()
`,
		{ BOITE: boite, MOTIF: motif },
	)
}

test.describe('envoi sortant — l’aller-retour complet', () => {
	test('le produit envoie, le destinataire reçoit, répond, et la réponse revient dans la card', async ({
		request,
	}) => {
		const marqueur = `AllerRetour${Date.now()}`
		let file: string | undefined

		try {
			// 1. MISE EN FILE PAR LA VRAIE GARDE, AVEC UNE VRAIE SESSION. La clé de service ne
			//    convient pas, et c'est mesuré : `auth.uid()` y est nul, la garde rend
			//    `not_authenticated`, et c'est exactement ce qu'on attend d'elle — un envoi part
			//    toujours au nom de quelqu'un.
			const identite = await request.get(
				`${URL_API}/rest/v1/mail_outbound_identities?select=id&owner_id=is.null&limit=1`,
				{ headers: enTetesService() },
			)
			const [service] = (await identite.json()) as { id: string }[]
			expect(service, 'l’identité de service du seed est introuvable').toBeDefined()

			const session = enTetesAuthentifies(await jetonDe('admin@p2enjoy.test'))
			const miseEnFile = await request.post(`${URL_API}/rest/v1/rpc/queue_outbound_email`, {
				headers: { ...session, 'Content-Type': 'application/json' },
				data: {
					p_card_id: CARD,
					p_identity_id: service!.id,
					p_to: [DESTINATAIRE],
					p_subject: marqueur,
					p_body_text: 'Bonjour,\n\nVoici notre proposition.',
				},
			})
			expect(miseEnFile.status(), await miseEnFile.text()).toBe(200)
			file = (await miseEnFile.json()) as string

			// 2. LE WORKER SOUMET RÉELLEMENT.
			const passe = viderLaFile()
			expect(passe['sent'], `passe = ${JSON.stringify(passe)}`).toBeGreaterThanOrEqual(1)

			// 3. LE DESTINATAIRE A REÇU — dans sa vraie boîte, pas dans une table.
			const entetes = entetesRecus(marqueur)
			expect(entetes['Subject']).toContain(marqueur)
			expect(entetes['From']).toBe('systeme@crm.p2enjoy.test')
			// LE `Reply-To` PORTE L'ADRESSE DE LA CARD : c'est lui qui ramènera la réponse.
			expect(entetes['Reply-To']).toMatch(/^c-[a-z0-9]{8}@crm\.p2enjoy\.test$/)
			expect(entetes['Message-ID']).toBeDefined()

			// 4. LE `Message-ID` MÉMORISÉ EST CELUI QUI A ÉTÉ REMIS — le serveur ne le réécrit
			//    pas (§19.1), et c'est ce qui fait de lui la charnière du fil.
			const ligneFile = await request.get(
				`${URL_API}/rest/v1/mail_outbox?select=status,rfc822_message_id,sent_message_id&id=eq.${file}`,
				{ headers: enTetesService() },
			)
			const [envoi] = (await ligneFile.json()) as {
				status: string
				rfc822_message_id: string
				sent_message_id: string
			}[]
			expect(envoi?.status).toBe('sent')
			expect(envoi?.rfc822_message_id).toBe(entetes['Message-ID'])

			// 5. LE MESSAGE ENVOYÉ EST ARCHIVÉ, ET DIT QU'IL EST SORTANT.
			const archive = await request.get(
				`${URL_API}/rest/v1/mail_messages?select=direction,classification,card_id&id=eq.${envoi!.sent_message_id}`,
				{ headers: enTetesService() },
			)
			const [message] = (await archive.json()) as {
				direction: string
				classification: string
				card_id: string
			}[]
			expect(message?.direction).toBe('outbound')
			expect(message?.classification).toBe('outbound')
			expect(message?.card_id).toBe(CARD)

			// 6. LA TIMELINE DE LA CARD GARDE LA TRACE.
			const evenements = await request.get(
				`${URL_API}/rest/v1/card_events?select=id&card_id=eq.${CARD}&type=eq.mail_sent`,
				{ headers: enTetesService() },
			)
			expect(((await evenements.json()) as unknown[]).length).toBeGreaterThanOrEqual(1)

			// 7. LE DESTINATAIRE RÉPOND — à l'adresse du `Reply-To`, comme le ferait un vrai
			//    correspondant qui clique sur « Répondre ».
			repondre(entetes['Reply-To']!, entetes['Message-ID']!, marqueur)

			// 8. LA RELÈVE RAMÈNE LA RÉPONSE DANS LA MÊME CARD.
			const comptes = await request.get(
				`${URL_API}/rest/v1/mail_inbound_accounts?select=id&owner_id=is.null&limit=1`,
				{ headers: enTetesService() },
			)
			const [systeme] = (await comptes.json()) as { id: string }[]
			let reponse: { card_id: string | null; classification: string } | undefined
			for (let tentative = 0; tentative < 5 && reponse === undefined; tentative += 1) {
				relever(systeme!.id)
				const lues = await request.get(
					`${URL_API}/rest/v1/mail_messages?select=card_id,classification,subject&subject=eq.Re:%20${marqueur}`,
					{ headers: enTetesService() },
				)
				;[reponse] = (await lues.json()) as { card_id: string | null; classification: string }[]
			}
			expect(reponse, 'la réponse n’a pas été relevée').toBeDefined()
			// LA BOUCLE EST FERMÉE : la réponse d'un correspondant est revenue dans l'affaire, sans
			// que personne n'ait eu à la classer.
			expect(reponse!.card_id).toBe(CARD)
			expect(reponse!.classification).toBe('auto')
		} finally {
			// LE SEED EST RENDU INTACT : les messages du scénario sont retirés de la base et des
			// deux boîtes. L'événement de timeline, lui, ne peut pas l'être — `card_events`
			// n'accorde d'écriture à personne (`CRM-044`), et l'historique ne se corrige pas.
			await request.delete(`${URL_API}/rest/v1/mail_messages?subject=like.*${marqueur}*`, {
				headers: enTetesService(),
			})
			if (file !== undefined) {
				await request.delete(`${URL_API}/rest/v1/mail_outbox?id=eq.${file}`, {
					headers: enTetesService(),
				})
			}
			retirerDeLaBoite(DESTINATAIRE, marqueur)
			retirerDeLaBoite('systeme@crm.p2enjoy.test', marqueur)
		}
	})
})
