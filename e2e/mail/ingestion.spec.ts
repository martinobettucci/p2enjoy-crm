// @verifies CRM-054 (docs/BACKLOG.md) — ingestion d'un email RÉELLEMENT envoyé
// @verifies INC-271 (docs/INCONSISTENCY_REPORT.md, décision 624) — l'ingestion et le classement sont jugés sur l'état,
//           quel que soit celui qui les a faits, la veille ou la relève de la preuve
// @verifies docs/SPEC-mail-subsystem.md §4.2 (dédoublonnage et occurrences), §4.3 (les statuts
//           antivirus), §15.4 (le chemin authentifié), §15.5 (dépôt puis analyse, nom assaini)
// @verifies docs/JOURNAL.md décision 320 ; CLAUDE.md §8 (aucune trace fabriquée)
// @verifies CRM-111 T2.4.4 (docs/BACKLOG.md) — les colonnes de rattachement se lisent et s'écrivent sur `card_placements`
//           (docs/SPEC-rattachements.md §3.2, §5)
// @verifies CRM-055 (docs/BACKLOG.md) — tranche INC-326 : la pièce d'un courrier classé à la relève porte l'affaire de son
//           message (docs/SCHEMA.md « Migration `0142` », décision 795)
// @verifies CRM-123 (docs/BACKLOG.md) — tranche T3 : un message réellement envoyé à une adresse régénérée au préfixe
//           `app-` est classé dans son affaire (docs/SPEC-cards.md §3.6 points 7, 8 et 11 ; décision 804)
//
// RIEN N'EST SIMULÉ : un message est réellement soumis en SMTP authentifié — le chemin d'un
// message légitime remis par un serveur (§15.4) —, relevé par le service depuis le vrai IMAP,
// analysé par le vrai ClamAV, et déposé dans le vrai Storage. Chaque assertion relit la BASE.
//
// LE SEED N'EST PAS TOUCHÉ : les messages ingérés ne font pas partie du seed, et le scénario
// retire ce qu'il a créé — en base et dans la boîte.

// @spec CRM-115 (docs/BACKLOG.md) T2, docs/SPEC-pile-par-session.md §6 : le conteneur se désigne par son service.
import { conteneur } from '../conteneur'
import { execFileSync } from 'node:child_process'
import { expect, test } from '@playwright/test'
import { lireEnv, urlApi } from '../env'
import { enTetesAuthentifies, enTetesService, jetonDe } from '../api/jetons'
import { instantaneDesBoites, rendreLesBoites, type Boite } from './menage'

const CONTENEUR = conteneur('mail-sync')
const IMAGE = 'python:3.13.13-slim-bookworm'
const JETON = lireEnv('MAIL_SYNC_INTERNAL_TOKEN')
const URL_API = urlApi()
/** La boîte système, que la veille relève et où elle range la copie classée (INC-271). */
const BOITE_SYSTEME: Boite = { adresse: 'systeme@crm.p2enjoy.test', motDePasse: lireEnv('STALWART_MAILBOX_PASSWORD') }
const EICAR = String.raw`X5O!P%@AP[4\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*`

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

/** Soumet un message à une adresse choisie — `CRM-055` en a besoin pour viser une card ; une pièce texte sur demande. */
function envoyerA(identifiant: string, destinataire: string, avecPiece = false): void {
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
if os.environ['PIECE'] == 'oui':
    msg.add_attachment(b'Note jointe au courrier.', maintype='text', subtype='plain', filename='note-inc326.txt')
s = smtplib.SMTP('stalwart', 587, timeout=30)
s.ehlo()
s.login('admin@p2enjoy.test', 'SeedDev2026Local')
s.send_message(msg)
s.quit()
`,
		{ ID: identifiant, DEST: destinataire, PIECE: avecPiece ? 'oui' : 'non' },
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

			// L'INGESTION EST JUGÉE SUR L'ÉTAT — INC-271, décision 624 : la veille relève la même boîte en fond et peut
			// ingérer le message AVANT cette relève, qui rend alors 0 nouveau message pour un produit correct. Le verrou
			// par compte (INC-266) sérialise les deux relèves : au retour de celle-ci, le message est en base, quel que
			// soit celui qui l'a ingéré — et c'est ce que les assertions ci-dessous jugent, pièce infectée comprise.
			relever(compte!.id)

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
			const apresRejeu = await request.get(
				`${URL_API}/rest/v1/mail_message_occurrences?message_id=eq.${message?.id}&select=uid`,
				{ headers: enTetesService() },
			)
			expect((await apresRejeu.json()) as unknown[], 'le rejeu ne duplique aucune occurrence').toHaveLength(1)
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
		const debut = new Date().toISOString()
		const dossiersAvant = await instantaneDesBoites([BOITE_SYSTEME])

		const cartes = await request.get(
			`${URL_API}/rest/v1/cards?select=id,title,email_local_part,card_placements!card_placements_card_fk!inner(archived_at)&card_placements.archived_at=is.null&deleted_at=is.null&limit=1`,
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

			// LE CONTRAT EST JUGÉ SUR L'ÉTAT — INC-271, décision 624 (et la famille d'INC-205) : la veille relève la même
			// boîte toutes les minutes et peut classer le message AVANT cette relève, qui rend alors 0 classement pour un
			// produit correct. Ce qui est prouvé ci-dessous — classé `auto`, dans SA card, sans auteur, tracé — ne
			// dépend pas de celui qui l'a fait.
			relever(compte!.id)

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
			// LA COPIE RANGÉE SOUS `CRM/…` ET SES DOSSIERS PARTENT AVEC LE MESSAGE — INC-271, décision 624 : ne purger
			// qu'`INBOX` laissait la copie classée dans le dossier de la card jusqu'à ce qu'un autre scénario efface
			// l'arborescence (vu dans la capture de `roundcube-dossiers.spec.ts` le 2026-10-12).
			await rendreLesBoites(request, { boites: [BOITE_SYSTEME], motif: identifiant, avant: dossiersAvant, debut })
			// L'événement de timeline reste : `card_events` n'accorde aucune écriture, à personne
			// (`CRM-044`), et l'historique d'une card ne se corrige pas. Prétendre l'effacer
			// aurait produit un refus silencieux.
		}
	})

	// INC-326 : la relève classe le message AVANT d'en inscrire les pièces ; la pièce hérite donc de l'affaire à son
	// insertion (migration `0142`). Jugé sur l'état, comme le classement : la veille peut faire la relève à sa place.
	test('la pièce d’un courrier classé à la relève porte l’affaire de son message', async ({ request }) => {
		test.setTimeout(300_000)
		const identifiant = `piece-auto-${Date.now()}`
		const debut = new Date().toISOString()
		const dossiersAvant = await instantaneDesBoites([BOITE_SYSTEME])
		const cartes = await request.get(
			`${URL_API}/rest/v1/cards?select=id,email_local_part,card_placements!card_placements_card_fk!inner(archived_at)&card_placements.archived_at=is.null&deleted_at=is.null&limit=1`,
			{ headers: enTetesService() },
		)
		const [carte] = (await cartes.json()) as { id: string; email_local_part: string }[]
		const compteReponse = await request.get(`${URL_API}/rest/v1/mail_inbound_accounts?owner_id=is.null&select=id`, {
			headers: enTetesService(),
		})
		const [compte] = (await compteReponse.json()) as { id: string }[]

		try {
			envoyerA(identifiant, `${carte!.email_local_part}@crm.p2enjoy.test`, true)
			relever(compte!.id)

			const messages = await request.get(
				`${URL_API}/rest/v1/mail_messages?rfc822_message_id=eq.${encodeURIComponent(`<${identifiant}@p2enjoy.test>`)}&select=id,card_id,classification`,
				{ headers: enTetesService() },
			)
			const [message] = (await messages.json()) as { id: string; card_id: string; classification: string }[]
			expect(message?.classification).toBe('auto')
			expect(message?.card_id).toBe(carte!.id)
			const pieces = await request.get(
				`${URL_API}/rest/v1/mail_attachments?message_id=eq.${message!.id}&select=filename,card_id`,
				{ headers: enTetesService() },
			)
			expect(await pieces.json()).toEqual([{ filename: 'note-inc326.txt', card_id: carte!.id }])
		} finally {
			await rendreLesBoites(request, { boites: [BOITE_SYSTEME], motif: identifiant, avant: dossiersAvant, debut })
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

	// CRM-123 — LE PRÉFIXE RÉGLÉ ET LES ADRESSES RÉGÉNÉRÉES PAR LES VRAIES FONCTIONS, AU VRAI JETON DE LA SUPERADMINISTRATRICE,
	// puis un message RÉELLEMENT envoyé à une adresse `app-…` : le catch-all de Stalwart le remet à la boîte système, la
	// relève le classe par la règle 1, sans aucun changement du classement (docs/SPEC-cards.md §3.6 point 8).
	// L'ESPACE SEEDÉ EST RENDU TEL QU'IL A ÉTÉ TROUVÉ : son préfixe et l'adresse de CHACUNE de ses affaires, relus avant et
	// réécrits après par la clé de service, puis constatés.
	test('un email adressé à une adresse régénérée au préfixe « app- » est classé dans son affaire', async ({ request }) => {
		test.setTimeout(300_000)
		const ESPACE = '5eed0000-0000-4000-8000-000000000001'
		const identifiant = `prefixe-${Date.now()}`
		const debut = new Date().toISOString()
		const dossiersAvant = await instantaneDesBoites([BOITE_SYSTEME])
		const espaceAvant = (await (
			await request.get(`${URL_API}/rest/v1/workspaces?id=eq.${ESPACE}&select=name,inbound_domain,card_address_prefix`, { headers: enTetesService() })
		).json()) as { name: string; inbound_domain: string; card_address_prefix: string }[]
		const adressesAvant = (await (
			await request.get(`${URL_API}/rest/v1/cards?workspace_id=eq.${ESPACE}&select=id,email_local_part&order=id`, { headers: enTetesService() })
		).json()) as { id: string; email_local_part: string }[]
		expect(adressesAvant.length).toBeGreaterThan(0)
		const [compte] = (await (
			await request.get(`${URL_API}/rest/v1/mail_inbound_accounts?owner_id=is.null&select=id`, { headers: enTetesService() })
		).json()) as { id: string }[]
		const sabine = { ...enTetesAuthentifies(await jetonDe('plateforme@p2enjoy.test')), 'Content-Type': 'application/json' }

		try {
			const regle = await request.post(`${URL_API}/rest/v1/rpc/plateforme_modifier_espace`, {
				headers: sabine,
				data: { p_id: ESPACE, p_nom: espaceAvant[0]!.name, p_domaine_entrant: espaceAvant[0]!.inbound_domain, p_card_address_prefix: 'app-' },
			})
			expect(regle.status(), 'la superadministratrice règle le préfixe').toBe(204)
			const regeneration = await request.post(`${URL_API}/rest/v1/rpc/platform_regenerate_card_addresses`, {
				headers: sabine,
				data: { p_workspace_id: ESPACE },
			})
			expect(regeneration.status()).toBe(200)
			expect(await regeneration.json(), 'toutes les affaires du seed sont réécrites').toBe(adressesAvant.length)

			const [carte] = (await (
				await request.get(
					`${URL_API}/rest/v1/cards?workspace_id=eq.${ESPACE}&select=id,email_local_part,card_placements!card_placements_card_fk!inner(archived_at)&card_placements.archived_at=is.null&deleted_at=is.null&limit=1`,
					{ headers: enTetesService() },
				)
			).json()) as { id: string; email_local_part: string }[]
			expect(carte!.email_local_part).toMatch(/^app-[0-9abcdefghjkmnpqrstvwxyz]{8}$/u)

			envoyerA(identifiant, `${carte!.email_local_part}@crm.p2enjoy.test`)
			relever(compte!.id)

			const [message] = (await (
				await request.get(
					`${URL_API}/rest/v1/mail_messages?rfc822_message_id=eq.${encodeURIComponent(`<${identifiant}@p2enjoy.test>`)}&select=classification,card_id`,
					{ headers: enTetesService() },
				)
			).json()) as { classification: string; card_id: string }[]
			expect(message, 'le message adressé à la nouvelle adresse est ingéré').toBeDefined()
			expect(message?.classification).toBe('auto')
			expect(message?.card_id).toBe(carte!.id)
		} finally {
			await rendreLesBoites(request, { boites: [BOITE_SYSTEME], motif: identifiant, avant: dossiersAvant, debut })
			await request.delete(`${URL_API}/rest/v1/mail_messages?rfc822_message_id=eq.${encodeURIComponent(`<${identifiant}@p2enjoy.test>`)}`, {
				headers: enTetesService(),
			})
			// Rendre l'espace : le préfixe, puis l'adresse de chaque affaire, par la clé de service — qui garde l'écriture de la
			// colonne (docs/SPEC-permissions-rls.md §4.4.3).
			await request.patch(`${URL_API}/rest/v1/workspaces?id=eq.${ESPACE}`, {
				headers: { ...enTetesService(), 'Content-Type': 'application/json' },
				data: { card_address_prefix: espaceAvant[0]!.card_address_prefix },
			})
			for (const { id, email_local_part } of adressesAvant) {
				await request.patch(`${URL_API}/rest/v1/cards?id=eq.${id}`, {
					headers: { ...enTetesService(), 'Content-Type': 'application/json' },
					data: { email_local_part },
				})
			}
			const rendues = (await (
				await request.get(`${URL_API}/rest/v1/cards?workspace_id=eq.${ESPACE}&select=id,email_local_part&order=id`, { headers: enTetesService() })
			).json()) as unknown[]
			expect(rendues, 'chaque affaire du seed retrouve son adresse').toEqual(adressesAvant)
		}
	})
})
