// @verifies CRM-059 (docs/BACKLOG.md) — « import historique par lots », seul écart nommé qui
//           retenait encore l'unité en `[~]`
// @verifies docs/SPEC-mail-subsystem.md §20.6 (le backfill par lots), §20.6 bis.3 (deux passes,
//           le courant d'abord), §20.6 bis.4 (premier contact : le jour, jamais l'historique)
// @verifies docs/JOURNAL.md décision 342 (le plan de relève) et l'entrée qui accompagne ce fichier
//
// LE SEUL MOYEN DE PROUVER LE §20.6 BIS.4 DE BOUT EN BOUT est une boîte qui porte déjà de
// l'historique AVANT le premier contact du service — sans quoi la passe historique n'a jamais
// rien à reprendre. `date.today()` (mail_sync/ingestion.py) n'est pas injectable : la seule façon
// réaliste de dater cet historique est de le déposer par un `APPEND` IMAP, la commande que le
// protocole prévoit précisément pour porter une date d'origine (RFC 3501 §6.3.11) — celle qu'un
// outil de migration de boîte emploierait pour préserver la date réelle d'un message importé.
// Le serveur RESTITUE cette date lui-même à la lecture (`FETCH INTERNALDATE`, vérifié à la main
// avant d'écrire ce fichier) : ce n'est pas une valeur que le produit invente ou qu'un test écrit
// à sa place, c'est ce que le protocole rend pour un message réellement présent dans la boîte
// (CLAUDE.md §8 — la trace n'est pas fabriquée, le mécanisme réel du protocole est employé).
//
// LA BOÎTE EST CELLE DE DRISS (`bizdev@p2enjoy.test`, seed CRM-052). Elle n'est PAS exclusive à ce
// scénario pour autant : `e2e/mail/resilience.spec.ts` lui adresse RÉELLEMENT des envois de
// démonstration sans jamais retirer le message IMAP livré, et la boucle de veille (§20.10) la
// relève en permanence, en tâche de fond. Ce scénario contrôle donc L'ÉTAT, PAS L'EXCLUSIVITÉ :
// `sync_state` et `INBOX` sont forcés à vierge en entrée ET en sortie (`forcerEtatVierge`,
// `viderLaBoite`) — mesuré nécessaire après qu'un reliquat d'un autre scénario a une première
// fois faussé le premier contact. `backfill_months` est restauré à sa valeur du seed dans le
// `finally`.

import { execFileSync } from 'node:child_process'
import { expect, test } from '@playwright/test'
import { lireEnv, urlApi } from '../env'
import { CLE_ANONYME, enTetesService, jetonDe } from '../api/jetons'

const CONTENEUR = 'p2enjoy-mail-sync'
const IMAGE = 'python:3.13.13-slim-bookworm'
const JETON = lireEnv('MAIL_SYNC_INTERNAL_TOKEN')
const URL_API = urlApi()
const WORKSPACE = '5eed0000-0000-4000-8000-000000000001'
const DRISS = '5eed0000-0000-4000-8000-000000000012'
const BOITE = 'bizdev@p2enjoy.test'
const MOT_DE_PASSE = 'SeedDev2026Local'

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

type Historique = { id: string; sujet: string; joursAnciennete: number }

/**
 * Dépose RÉELLEMENT des messages d'historique dans la boîte, par `APPEND` daté — voir l'en-tête
 * de ce fichier pour le motif. `imaplib.Time2Internaldate` produit la forme que le protocole
 * attend ; le serveur la restitue telle quelle à la lecture.
 */
function deposerHistorique(messages: Historique[]): void {
	python(
		`
import imaplib, json, os, time

c = imaplib.IMAP4('stalwart', 143)
c.login(os.environ['BOITE'], os.environ['MDP'])
c.select('INBOX')
for m in json.loads(os.environ['MESSAGES']):
    date_origine = imaplib.Time2Internaldate(time.time() - m['joursAnciennete'] * 86400)
    corps = (
        'From: historique@p2enjoy.test\\r\\n'
        'To: ' + os.environ['BOITE'] + '\\r\\n'
        'Subject: ' + m['sujet'] + '\\r\\n'
        'Message-ID: <' + m['id'] + '@p2enjoy.test>\\r\\n'
        '\\r\\n'
        'Message d historique, depose par APPEND avec une date d origine.\\r\\n'
    ).encode()
    typ, data = c.append('INBOX', None, date_origine, corps)
    assert typ == 'OK', data
c.logout()
`,
		{ BOITE, MDP: MOT_DE_PASSE, MESSAGES: JSON.stringify(messages) },
	)
}

/** Soumet le courrier du jour par le chemin authentifié réel — un vrai envoi SMTP, pas un dépôt. */
function envoyerAujourdhui(id: string, sujet: string): void {
	python(
		`
import os, smtplib
from email.message import EmailMessage

msg = EmailMessage()
msg['From'] = os.environ['BOITE']
msg['To'] = os.environ['BOITE']
msg['Subject'] = os.environ['SUJET']
msg['Message-ID'] = '<' + os.environ['ID'] + '@p2enjoy.test>'
msg.set_content('Courrier du jour, envoi SMTP reel.')
s = smtplib.SMTP('stalwart', 587, timeout=30)
s.ehlo()
s.login(os.environ['BOITE'], os.environ['MDP'])
s.send_message(msg)
s.quit()
`,
		{ BOITE, MDP: MOT_DE_PASSE, ID: id, SUJET: sujet },
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

/**
 * Vide ENTIÈREMENT `INBOX` — pas seulement les messages de ce scénario.
 *
 * `e2e/mail/resilience.spec.ts` (`CRM-059`) adresse RÉELLEMENT des envois de démonstration à
 * cette même boîte (`bizdev@p2enjoy.test` est son destinataire de test) et ne retire, dans son
 * propre `finally`, que la ligne de base — jamais le message IMAP livré. Sans ce grand ménage,
 * un reliquat plus ancien que les messages de ce scénario fausserait le premier contact : la
 * passe courante engloberait alors ce reliquat lui aussi, et `uid_min` ne désignerait plus le
 * courrier du jour posé ici. Un scénario qui dépend d'une boîte propre doit la rendre propre
 * lui-même, à l'entrée comme à la sortie.
 */
function viderLaBoite(): void {
	python(
		`
import os, imaplib
c = imaplib.IMAP4('stalwart', 143)
c.login(os.environ['BOITE'], os.environ['MDP'])
c.select('INBOX')
typ, ids = c.uid('search', None, 'ALL')
for uid in ids[0].split():
    c.uid('store', uid, '+FLAGS', '(\\\\Deleted)')
c.expunge()
c.logout()
`,
		{ BOITE, MDP: MOT_DE_PASSE },
	)
}

type CompteEntrant = {
	id: string
	label: string
	imap_host: string
	imap_port: number
	imap_security: string
	imap_username: string
	watch_folders: string[]
	folder_style: string
	backfill_months: number
	sync_state: Record<string, unknown>
}

async function lireCompteDeDriss(
	request: import('@playwright/test').APIRequestContext,
): Promise<CompteEntrant> {
	const reponse = await request.get(
		`${URL_API}/rest/v1/mail_inbound_accounts?owner_id=eq.${DRISS}&select=id,label,imap_host,imap_port,imap_security,imap_username,watch_folders,folder_style,backfill_months,sync_state`,
		{ headers: enTetesService() },
	)
	const [compte] = (await reponse.json()) as CompteEntrant[]
	expect(compte?.id, 'le compte entrant de Driss est introuvable : le seed est-il appliqué ?').toBeDefined()
	return compte!
}

/**
 * Force `sync_state` à vierge (`{}`), par le MÊME chemin d'écriture que
 * `mail_sync.postgrest.enregistrer_progression` — un `PATCH` qui ne porte que cette colonne.
 *
 * Appelé EN ENTRÉE ET EN SORTIE, plutôt que de capturer puis restaurer une valeur lue : la boucle
 * de veille (`CRM-059`, §20.10) relève ce compte en permanence, en tâche de fond, et une valeur
 * lue à l'instant T peut déjà avoir changé à l'instant T+ε. `{}` est l'état de repos légitime
 * d'une boîte vide — c'est celui que le seed livre — et le forcer aux deux bouts rend ce scénario
 * indépendant de ce que la veille a pu faire entre deux exécutions.
 */
async function forcerEtatVierge(
	request: import('@playwright/test').APIRequestContext,
	compte: CompteEntrant,
): Promise<void> {
	const reponse = await request.patch(
		`${URL_API}/rest/v1/mail_inbound_accounts?id=eq.${compte.id}`,
		{
			headers: { ...enTetesService(), Prefer: 'return=minimal' },
			data: { sync_state: {} },
		},
	)
	expect([200, 204]).toContain(reponse.status())
}

/** Réécrit `backfill_months` par le VRAI chemin d'écriture, tout le reste inchangé. */
async function ecrireBackfillMonths(
	request: import('@playwright/test').APIRequestContext,
	jetonAdmin: string,
	compte: CompteEntrant,
	mois: number,
): Promise<void> {
	const reponse = await request.post(`${URL_API}/rest/v1/rpc/upsert_mail_inbound_account`, {
		headers: {
			apikey: CLE_ANONYME,
			Authorization: `Bearer ${jetonAdmin}`,
			'Content-Type': 'application/json',
		},
		data: {
			p_workspace_id: WORKSPACE,
			p_label: compte.label,
			p_imap_host: compte.imap_host,
			p_imap_port: compte.imap_port,
			p_imap_security: compte.imap_security,
			p_imap_username: compte.imap_username,
			p_password: null,
			p_owner_id: DRISS,
			p_watch_folders: compte.watch_folders,
			p_folder_style: compte.folder_style,
			p_backfill_months: mois,
		},
	})
	expect(reponse.status(), await reponse.text()).toBe(200)
}

function encoderIds(identifiants: string[]): string {
	return identifiants.map((id) => encodeURIComponent(`<${id}@p2enjoy.test>`)).join(',')
}

async function messagesVus(
	request: import('@playwright/test').APIRequestContext,
	identifiants: string[],
): Promise<string[]> {
	const reponse = await request.get(
		`${URL_API}/rest/v1/mail_messages?select=rfc822_message_id,subject&rfc822_message_id=in.(${encoderIds(identifiants)})`,
		{ headers: enTetesService() },
	)
	const lignes = (await reponse.json()) as { rfc822_message_id: string; subject: string }[]
	return lignes.map((l) => l.rfc822_message_id)
}

test.describe('backfill par lots — le jour d’abord, l’historique déposé au tour suivant', () => {
	test('un premier contact ne descend jamais l’historique, même déjà présent et autorisé', async ({
		request,
	}) => {
		test.setTimeout(300_000)

		const prefixe = `backfill-${Date.now()}`
		const idsHistorique = [0, 1, 2].map((i) => `${prefixe}-hist-${i}`)
		const idAujourdhui = `${prefixe}-jour`
		const tousLesIds = [...idsHistorique, idAujourdhui]

		const jetonAdmin = await jetonDe('admin@p2enjoy.test')
		const compte = await lireCompteDeDriss(request)
		const backfillMonthsInitial = compte.backfill_months

		try {
			// L'ÉTAT DE DÉPART EST FORCÉ VIERGE, BOÎTE COMPRISE : voir le motif porté par
			// `forcerEtatVierge` et par `viderLaBoite`.
			await forcerEtatVierge(request, compte)
			viderLaBoite()

			// --- L'historique existe RÉELLEMENT, AVANT tout premier contact du service -----------
			deposerHistorique(
				idsHistorique.map((id, i) => ({ id, sujet: `Archive ${i} ${prefixe}`, joursAnciennete: 90 })),
			)
			envoyerAujourdhui(idAujourdhui, `Courrier du jour ${prefixe}`)
			await ecrireBackfillMonths(request, jetonAdmin, compte, 6)

			// --- PREMIER CONTACT : le jour, et RIEN D'AUTRE (§20.6 bis.4) -------------------------
			const premier = relever(compte.id)
			expect(premier['messages_new'], JSON.stringify(premier)).toBeGreaterThanOrEqual(1)

			const vusApresPremier = await messagesVus(request, tousLesIds)
			expect(vusApresPremier, JSON.stringify(vusApresPremier)).toContain(
				`<${idAujourdhui}@p2enjoy.test>`,
			)
			for (const id of idsHistorique) {
				expect(
					vusApresPremier,
					`l'historique est descendu dès le premier contact : ${JSON.stringify(vusApresPremier)}`,
				).not.toContain(`<${id}@p2enjoy.test>`)
			}

			// --- LA RELÈVE SUIVANTE REPREND L'HISTORIQUE, PAR LOTS (§20.6, §20.6 bis.3) -----------
			let vusApresSecond: string[] = []
			for (let tentative = 0; tentative < 5; tentative += 1) {
				relever(compte.id)
				vusApresSecond = await messagesVus(request, tousLesIds)
				if (vusApresSecond.length === tousLesIds.length) break
			}
			for (const id of tousLesIds) {
				expect(
					vusApresSecond,
					`l'historique n'a jamais été repris : ${JSON.stringify(vusApresSecond)}`,
				).toContain(`<${id}@p2enjoy.test>`)
			}

			// LA RELÈVE EST IDEMPOTENTE : rejouer n'ajoute rien — même garantie que `CRM-054`.
			const troisieme = relever(compte.id)
			expect(troisieme['messages_new']).toBe(0)
		} finally {
			viderLaBoite()
			await request.delete(
				`${URL_API}/rest/v1/mail_messages?rfc822_message_id=in.(${encoderIds(tousLesIds)})`,
				{ headers: enTetesService() },
			)
			await ecrireBackfillMonths(request, jetonAdmin, compte, backfillMonthsInitial)
			await forcerEtatVierge(request, compte)
		}
	})
})
