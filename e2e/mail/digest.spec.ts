// @verifies CRM-158 (docs/BACKLOG.md) — le départ lu sur la ligne de l'envoi, la boucle d'envoi active
//           (docs/SPEC-mail-subsystem.md §34.7 ; décision 954)
// @verifies CRM-069 (docs/BACKLOG.md) — tranche T5 : le récapitulatif quotidien jusqu'à la boîte de développement, sans
//           aucune substitution — le vrai job, la vraie file, le vrai worker, la vraie boîte
// @verifies docs/SPEC-etiquettes-digest.md §5.2 (le contenu, ses liens), §5.3 (l'identité de service, aucun `Reply-To`),
//           §5.4 (le job à 7 h de Paris) ; docs/JOURNAL.md décision 772 (le jeton `{site}` remplacé par `SITE_URL`) ;
//           CLAUDE.md §8 (aucune trace fabriquée), §15 (un chemin déterministe : le job appelé pour 7 h 15)
// @verifies CRM-069 (docs/BACKLOG.md) — tranche T6 : le digest se déclare automatique, et la relève de la boîte de Driss,
//           synchronisée, ne le réingère pas (docs/SPEC-etiquettes-digest.md §5.3 bis, INC-321, décision 780)
// @verifies INC-361 (docs/INCONSISTENCY_REPORT.md ; lot F du backlog, décisions 992 et 1000) : le digest reçu cite la mention
//           non lue du fil d'une organisation, avec le lien de sa fiche à l'ancre du commentaire — posée par Camille par les vrais
//           gestes (le commentaire et la mention, sous son jeton), retirée à la fin (docs/SPEC-etiquettes-digest.md §5.2 bis)
//
// LE JOB EST APPELÉ PAR SA FONCTION, POUR UN INSTANT DE 7 H 15 À PARIS — le chemin déterministe que `CLAUDE.md` §15 permet :
// attendre 7 h ne prouverait rien de plus, et `pg_cron` est prouvé par la pgTAP `0124`. Tout le reste est le vrai chemin.

import { conteneur } from '../conteneur'
import { execFileSync } from 'node:child_process'
import { expect, test } from '@playwright/test'
import { lireEnv, urlApi } from '../env'
import { enTetesAuthentifies, enTetesService, jetonDe } from '../api/jetons'
import { instantaneDesBoites, rendreLesBoites, type Boite } from './menage'
import { attendreLeSort } from '../sort-envoi'

const IMAGE = 'python:3.13.13-slim-bookworm'
const JETON = lireEnv('MAIL_SYNC_INTERNAL_TOKEN')
const URL_API = urlApi()
const ESPACE = '5eed0000-0000-4000-8000-000000000001'
const DRISS = '5eed0000-0000-4000-8000-000000000012'
const BOITE_DRISS = 'bizdev@p2enjoy.test'
const OBJET = 'Votre journée dans'
// La recherche IMAP et le ménage cherchent un motif ASCII : `imaplib` n'encode pas « é » sans jeu de caractères déclaré.
const MOTIF = 'Votre journ'
const BOITES: readonly Boite[] = [{ adresse: BOITE_DRISS, motDePasse: lireEnv('STALWART_MAILBOX_PASSWORD') }]

function docker(...arguments_: string[]): string {
	return execFileSync('docker', arguments_, { encoding: 'utf8', timeout: 300_000 }).trim()
}

let reseauMemo: string | undefined
function reseau(): string {
	reseauMemo ??= docker('inspect', conteneur('mail-sync'), '--format', '{{range $k,$v := .NetworkSettings.Networks}}{{$k}}{{end}}')
	return reseauMemo
}

function python(source: string, variables: Record<string, string> = {}): string {
	const arguments_ = ['run', '--rm', '--network', reseau()]
	for (const [nom, valeur] of Object.entries(variables)) arguments_.push('-e', `${nom}=${valeur}`)
	arguments_.push(IMAGE, 'python', '-c', source)
	return docker(...arguments_)
}

/** Le job, appelé par sa fonction pour 7 h 15 à Paris aujourd'hui. */
function lancerLeJob(): string {
	return docker('exec', conteneur('db'), 'psql', '-U', 'postgres', '-d', 'postgres', '-qtA', '-c',
		"select app.envoyer_digests(((current_date + time '07:15') at time zone 'Europe/Paris'))")
}

/** Vide la file par la route interne du service — le vrai chemin, jamais un appel SQL direct. */
function viderLaFile(): Record<string, number> {
	const brut = python(
		`
import os, urllib.error, urllib.request
requete = urllib.request.Request("http://mail-sync:8080/internal/v1/outbox/flush", data=b"", method="POST")
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

/** La relève d'un compte par la route interne du service — le vrai chemin de la synchronisation. */
function relever(compte: string): Record<string, number> {
	const brut = python(
		`
import os, urllib.error, urllib.request
requete = urllib.request.Request(
    "http://mail-sync:8080/internal/v1/inbound-accounts/" + os.environ["COMPTE"] + "/poll", data=b"", method="POST")
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

/** Le digest reçu dans la boîte de Driss : ses en-têtes et son corps. */
function digestRecu(): { entetes: Record<string, string>; corps: string } {
	const brut = python(
		`
import email, email.policy, imaplib, json, os
c = imaplib.IMAP4("stalwart", 143)
c.login(os.environ["BOITE"], os.environ["MOT_DE_PASSE"])
c.select("INBOX")
typ, ids = c.search(None, "HEADER", "Subject", '"' + os.environ["MOTIF"] + '"')
resultat = {"entetes": {}, "corps": ""}
uids = ids[0].split()
if uids:
    typ, brut = c.fetch(uids[-1], "(BODY.PEEK[])")
    # La politique moderne décode les en-têtes encodés (RFC 2047) : le sujet porte « é ».
    message = email.message_from_bytes(brut[0][1], policy=email.policy.default)
    resultat["entetes"] = {cle: str(message.get(cle)) for cle in ("From", "To", "Subject", "Reply-To", "Auto-Submitted") if message.get(cle) is not None}
    partie = message.get_body(preferencelist=("plain",)) or message
    resultat["corps"] = partie.get_content()
c.logout()
print(json.dumps(resultat))
`,
		{ BOITE: BOITE_DRISS, MOT_DE_PASSE: lireEnv('STALWART_MAILBOX_PASSWORD'), MOTIF },
	)
	return JSON.parse(brut) as { entetes: Record<string, string>; corps: string }
}

test.describe('le récapitulatif quotidien — du job à la boîte', () => {
	test('Driss, abonné, reçoit son digest du jour par l’identité de service, sans Reply-To, ses liens complets', async ({
		request,
	}) => {
		// Un conteneur par lecture IMAP, et l'attente de la remise : le délai par défaut ne suffit pas.
		test.setTimeout(120_000)
		const debut = new Date().toISOString()
		const dossiersAvant = await instantaneDesBoites(BOITES)
		const service = { ...enTetesService(), 'Content-Type': 'application/json' }
		let file: string | undefined
		let commentaire: string | undefined
		try {
			// `INC-361` : Camille mentionne Driss dans le fil d'« Imprimerie Duval », par les vrais gestes de l'écran, sous son
			// jeton — la preuve pose SA mention (texte distinctif), elle ne dépend pas de celle du seed.
			const camille = { ...enTetesAuthentifies(await jetonDe('admin@p2enjoy.test')), 'Content-Type': 'application/json' }
			const [duval] = (await (
				await request.get(`${URL_API}/rest/v1/organizations?workspace_id=eq.${ESPACE}&name=eq.Imprimerie%20Duval&select=id`, { headers: service })
			).json()) as { id: string }[]
			expect(duval, 'le seed porte « Imprimerie Duval »').toBeDefined()
			const pose = await request.post(`${URL_API}/rest/v1/organization_comments?select=id`, {
				headers: { ...camille, Prefer: 'return=representation' },
				data: { organization_id: duval!.id, body: 'Preuve INC-361 : le digest cite cette mention.' },
			})
			expect(pose.status(), await pose.text()).toBe(201)
			commentaire = ((await pose.json()) as { id: string }[])[0]!.id
			const mention = await request.post(`${URL_API}/rest/v1/organization_comment_mentions`, {
				headers: { ...camille, Prefer: 'return=minimal' },
				data: { comment_id: commentaire, profile_id: DRISS },
			})
			expect(mention.status(), await mention.text()).toBe(201)

			// Le consentement de Driss, et aucune issue pour aujourd'hui : le job doit produire son digest.
			await request.post(`${URL_API}/rest/v1/digest_subscriptions`, {
				headers: { ...service, Prefer: 'resolution=ignore-duplicates' },
				data: { profile_id: DRISS, workspace_id: ESPACE },
			})
			await request.delete(`${URL_API}/rest/v1/digest_runs?profile_id=eq.${DRISS}&workspace_id=eq.${ESPACE}`, { headers: service })

			expect(Number(lancerLeJob())).toBeGreaterThanOrEqual(1)
			const runs = await request.get(
				`${URL_API}/rest/v1/digest_runs?profile_id=eq.${DRISS}&workspace_id=eq.${ESPACE}&select=status,outbox_id`,
				{ headers: service },
			)
			const [run] = (await runs.json()) as { status: string; outbox_id: string }[]
			expect(run!.status).toBe('queued')
			file = run!.outbox_id

			// *Révisé par `CRM-158` (§34.7, décision 51), non relâché* : la boucle d'envoi a pu le prendre avant cette passe, qui
			// reste un accélérateur ; le départ se lit sur SA ligne.
			viderLaFile()
			await attendreLeSort(request, file)
			const ligne = await request.get(`${URL_API}/rest/v1/mail_outbox?id=eq.${file}&select=status,kind,card_id`, { headers: service })
			expect(await ligne.json()).toEqual([{ status: 'sent', kind: 'digest', card_id: null }])

			await expect.poll(() => digestRecu().entetes['Subject'] ?? '', { timeout: 30_000 }).toContain(OBJET)
			const { entetes, corps } = digestRecu()
			expect(entetes['From']).toContain('systeme@crm.p2enjoy.test')
			expect(entetes['Reply-To']).toBeUndefined()
			const site = lireEnv('SITE_URL').replace(/\/$/, '')
			expect(corps).toContain(`${site}/tracks/`)
			expect(corps).not.toContain('{site}')
			// `INC-361` : la mention du fil de l'organisation, citée avec la fiche à l'ancre de SON commentaire, dans le mail reçu.
			expect(corps).toContain('- Imprimerie Duval (organisation)')
			expect(corps).toContain(`${site}/contacts/organisations/${duval!.id}#commentaire-${commentaire}`)

			// `CRM-069` T6 (§5.3 bis) : le digest se déclare automatique, et la relève de la boîte de Driss — synchronisée —
			// le tient pour relevé sans l'ingérer : aucun message de l'espace ne naît de lui.
			expect(entetes['Auto-Submitted']).toBe('auto-generated')
			const comptes = await request.get(`${URL_API}/rest/v1/mail_inbound_accounts?owner_id=eq.${DRISS}&select=id`, { headers: service })
			const [compte] = (await comptes.json()) as { id: string }[]
			const releve = relever(compte!.id)
			expect(releve['messages_skipped'], `relève = ${JSON.stringify(releve)}`).toBeGreaterThanOrEqual(1)
			const ingeres = await request.get(
				`${URL_API}/rest/v1/mail_messages?workspace_id=eq.${ESPACE}&subject=like.${encodeURIComponent(MOTIF + '*')}&created_at=gte.${encodeURIComponent(debut)}&select=id`,
				{ headers: service },
			)
			expect(await ingeres.json()).toEqual([])
		} finally {
			// Elle ne retire que ce qu'elle a posé : son commentaire (la mention suit en cascade), et la notification de Driss qu'il a fait naître.
			if (commentaire !== undefined) {
				await request.delete(`${URL_API}/rest/v1/notifications?payload->>comment_id=eq.${commentaire}`, { headers: service })
				await request.delete(`${URL_API}/rest/v1/organization_comments?id=eq.${commentaire}`, { headers: service })
			}
			if (file !== undefined) await request.delete(`${URL_API}/rest/v1/mail_outbox?id=eq.${file}`, { headers: service })
			await rendreLesBoites(request, { boites: BOITES, motif: MOTIF, avant: dossiersAvant, debut })
		}
	})
})
