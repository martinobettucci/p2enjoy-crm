// @verifies CRM-058 (docs/BACKLOG.md) — tranche 2 : l'aller réel d'un message avec copie cachée et pièces jointes
// @verifies docs/SPEC-mail-subsystem.md §19 bis.2 (points 1, 2, 6 et 7), §19 bis.4, §19 bis.7 (ligne « E2E mail ») ;
//           docs/JOURNAL.md décisions 719 et 720 ; CLAUDE.md §8 (aucune trace fabriquée)
//
// RIEN N'EST SIMULÉ : les fichiers sont déposés par la vraie API de stockage avec la vraie session de Camille, mis en
// file par la vraie garde, soumis par le vrai worker, et lus dans les vraies boîtes. Ce que ce fichier prouve, et
// qu'aucun autre ne peut prouver : la copie cachée est REMISE sans qu'aucun en-tête ne la révèle, et chaque pièce arrive
// INTACTE — son empreinte relue dans la boîte est celle du fichier déposé.

// @spec CRM-115 (docs/BACKLOG.md) T2, docs/SPEC-pile-par-session.md §6 : le conteneur se désigne par son service.
import { conteneur } from '../conteneur'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { expect, test } from '@playwright/test'
import { lireEnv, urlApi } from '../env'
import { CLE_ANONYME, enTetesAuthentifies, enTetesService, jetonDe } from '../api/jetons'
import { instantaneDesBoites, rendreLesBoites, type Boite } from './menage'

const CONTENEUR = conteneur('mail-sync')
const IMAGE = 'python:3.13.13-slim-bookworm'
const JETON = lireEnv('MAIL_SYNC_INTERNAL_TOKEN')
const URL_API = urlApi()
const CARD = '5eed0000-0000-4000-8000-0000000000c1'
const ESPACE = '5eed0000-0000-4000-8000-000000000001'
const CAMILLE = '5eed0000-0000-4000-8000-000000000011'
const DESTINATAIRE = 'bizdev@p2enjoy.test'
const COPIE_CACHEE = lireEnv('MAIL_DEV_CORRESPONDENT_ADDRESS')
const MOT_DE_PASSE = lireEnv('STALWART_MAILBOX_PASSWORD')

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

function viderLaFile(): Record<string, number> {
	return JSON.parse(
		python(
			`
import os, urllib.error, urllib.request
r = urllib.request.Request("http://mail-sync:8080/internal/v1/outbox/flush", data=b"", method="POST")
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

/** Lit, dans une boîte, les en-têtes et l'empreinte de chaque pièce du message dont l'objet porte le marqueur. */
function recu(boite: string, marqueur: string): { entetes: Record<string, string | null>; pieces: Record<string, string> } {
	return JSON.parse(
		python(
			`
import email, hashlib, imaplib, json, os
c = imaplib.IMAP4("stalwart", 143)
c.login(os.environ["BOITE"], os.environ["MDP"])
c.select("INBOX")
typ, ids = c.search(None, "HEADER", "Subject", os.environ["OBJET"])
sortie = {"entetes": {}, "pieces": {}}
for uid in ids[0].split()[:1]:
    typ, brut = c.fetch(uid, "(BODY.PEEK[])")
    m = email.message_from_bytes(brut[0][1])
    for cle in ("To", "Cc", "Bcc", "Subject"):
        sortie["entetes"][cle] = m.get(cle)
    for partie in m.walk():
        nom = partie.get_filename()
        if nom:
            sortie["pieces"][nom] = hashlib.sha256(partie.get_payload(decode=True)).hexdigest()
c.logout()
print(json.dumps(sortie), end="")
`,
			{ BOITE: boite, MDP: MOT_DE_PASSE, OBJET: marqueur },
		),
	) as { entetes: Record<string, string | null>; pieces: Record<string, string> }
}

const BOITES: readonly Boite[] = [
	{ adresse: DESTINATAIRE, motDePasse: MOT_DE_PASSE },
	{ adresse: COPIE_CACHEE, motDePasse: MOT_DE_PASSE },
	{ adresse: 'systeme@crm.p2enjoy.test', motDePasse: MOT_DE_PASSE },
]

test.describe('envoi sortant — copie cachée et pièces jointes (§19 bis)', () => {
	test('la copie cachée reçoit le message sans en-tête qui la révèle, et chaque pièce arrive intacte', async ({
		request,
	}) => {
		const marqueur = `PiecesCci${Date.now()}`
		const debut = new Date().toISOString()
		const dossiersAvant = await instantaneDesBoites(BOITES)
		const jeton = await jetonDe('admin@p2enjoy.test')
		const fichiers = [
			{ nom: 'proposition.txt', type: 'text/plain', contenu: Buffer.from('Proposition commerciale, version 2.\n') },
			{ nom: 'grille.bin', type: 'application/octet-stream', contenu: Buffer.from(Array.from({ length: 4096 }, (_, i) => i % 251)) },
		]
		const chemins: string[] = []
		let file: string | undefined
		let archives: string[] = []

		try {
			// 1. LE DÉPÔT PAR LA VRAIE API DE STOCKAGE, avec la vraie session.
			for (const fichier of fichiers) {
				const chemin = `${ESPACE}/${CAMILLE}/${crypto.randomUUID()}/${fichier.nom}`
				const depot = await request.post(`${URL_API}/storage/v1/object/mail-outbound-attachments/${chemin}`, {
					headers: { apikey: CLE_ANONYME, Authorization: `Bearer ${jeton}`, 'Content-Type': fichier.type },
					data: fichier.contenu,
				})
				expect(depot.status(), await depot.text()).toBe(200)
				chemins.push(chemin)
			}

			// 2. LA MISE EN FILE PAR LA VRAIE GARDE.
			const identite = await request.get(
				`${URL_API}/rest/v1/mail_outbound_identities?select=id&owner_id=is.null&limit=1`,
				{ headers: enTetesService() },
			)
			const [service] = (await identite.json()) as { id: string }[]
			const miseEnFile = await request.post(`${URL_API}/rest/v1/rpc/queue_outbound_email`, {
				headers: { ...enTetesAuthentifies(jeton), 'Content-Type': 'application/json' },
				data: {
					p_card_id: CARD,
					p_identity_id: service!.id,
					p_to: [DESTINATAIRE],
					p_subject: marqueur,
					p_body_text: 'Bonjour,\n\nVous trouverez notre proposition jointe.',
					p_bcc: [COPIE_CACHEE],
					p_attachments: chemins,
				},
			})
			expect(miseEnFile.status(), await miseEnFile.text()).toBe(200)
			file = (await miseEnFile.json()) as string

			// 3. LE WORKER SOUMET RÉELLEMENT.
			const passe = viderLaFile()
			expect(passe['sent'], `passe = ${JSON.stringify(passe)}`).toBeGreaterThanOrEqual(1)

			// 4. LA COPIE CACHÉE A REÇU — et rien, dans ce qu'elle a reçu, ne dit qu'elle était en copie cachée.
			const chezCopie = recu(COPIE_CACHEE, marqueur)
			expect(chezCopie.entetes['Subject']).toContain(marqueur)
			expect(chezCopie.entetes['Bcc']).toBeNull()
			expect(chezCopie.entetes['To']).toBe(DESTINATAIRE)
			// 5. LE DESTINATAIRE NE VOIT PAS LA COPIE CACHÉE.
			const chezDestinataire = recu(DESTINATAIRE, marqueur)
			expect(chezDestinataire.entetes['Bcc']).toBeNull()
			expect(chezDestinataire.entetes['Cc']).toBeNull()

			// 6. CHAQUE PIÈCE ARRIVE INTACTE, DANS LES DEUX BOÎTES : l'empreinte relue est celle du fichier déposé.
			const attendues = Object.fromEntries(
				fichiers.map((fichier) => [fichier.nom, createHash('sha256').update(fichier.contenu).digest('hex')]),
			)
			expect(chezCopie.pieces).toEqual(attendues)
			expect(chezDestinataire.pieces).toEqual(attendues)

			// 7. L'ARCHIVE : le message envoyé porte sa copie cachée, et ses pièces analysées par ClamAV (`clean`).
			const ligne = await request.get(`${URL_API}/rest/v1/mail_outbox?select=status,sent_message_id&id=eq.${file}`, {
				headers: enTetesService(),
			})
			const [envoi] = (await ligne.json()) as { status: string; sent_message_id: string }[]
			expect(envoi?.status).toBe('sent')
			const message = await request.get(
				`${URL_API}/rest/v1/mail_messages?select=bcc_addresses,mail_attachments(filename,sha256,av_status,storage_path)&id=eq.${envoi!.sent_message_id}`,
				{ headers: enTetesService() },
			)
			const [archive] = (await message.json()) as {
				bcc_addresses: string[]
				mail_attachments: { filename: string; sha256: string; av_status: string; storage_path: string }[]
			}[]
			expect(archive?.bcc_addresses).toEqual([COPIE_CACHEE])
			archives = (archive?.mail_attachments ?? []).map((piece) => piece.storage_path)
			expect(
				Object.fromEntries((archive?.mail_attachments ?? []).map((piece) => [piece.filename, piece.sha256])),
			).toEqual(attendues)
			expect(new Set(archive?.mail_attachments.map((piece) => piece.av_status))).toEqual(new Set(['clean']))
		} finally {
			if (file !== undefined) {
				await request.delete(`${URL_API}/rest/v1/mail_outbox?id=eq.${file}`, { headers: enTetesService() })
			}
			const objets = (bucket: string, prefixes: string[]) =>
				prefixes.length === 0
					? Promise.resolve()
					: request.delete(`${URL_API}/storage/v1/object/${bucket}`, {
							headers: { ...enTetesService(), 'Content-Type': 'application/json' },
							data: { prefixes },
						})
			await objets('mail-outbound-attachments', chemins)
			await objets('mail-attachments', archives)
			await rendreLesBoites(request, { boites: BOITES, motif: marqueur, avant: dossiersAvant, debut })
		}
	})
})
