// @verifies CRM-143 (docs/BACKLOG.md) — tranche T2 : une pièce reçue quand l'antivirus est muet naît `skipped`
//           (`scanner_unavailable`), déposée ; l'antivirus revenu, la reprise passe la pièce saine en `clean` et
//           l'échantillon EICAR en `infected`, sur le vrai ClamAV
// @verifies docs/SPEC-pieces-jointes.md §17.3, §17.5, §17.9 (« E2E `mail`, vrai ClamAV ») ; docs/SPEC-mail-subsystem.md
//           §12.6 (règle 3 : l'exemplaire jetable, le service partagé arrêté) ; docs/JOURNAL.md décision 892 ; CLAUDE.md §8
//
// AUCUNE TRACE FABRIQUÉE (CLAUDE.md §8). La pièce non analysée naît du vrai mécanisme : un courrier réellement envoyé par
// SMTP, relevé par un exemplaire JETABLE du service — la même image, le même environnement, la veille désactivée — dont
// l'antivirus est injoignable (`CLAMAV_HOST` qui ne se résout pas). Le service partagé est arrêté le temps de cette relève,
// pour qu'aucune relève de sa veille ne prenne le courrier avec le vrai antivirus (la règle 3 du §12.6). Le service
// partagé rendu, la route de reprise analyse les deux pièces du courrier par le vrai ClamAV : un PDF, qui devient sain, et
// l'échantillon EICAR, qui devient infecté — le verdict de la reprise, distinct de celui de la réception
// (`e2e/mail/ingestion.spec.ts`).

import { conteneur } from '../conteneur'
import { execFileSync, spawnSync } from 'node:child_process'
import { expect, test } from '@playwright/test'
import { lireEnv, urlApi } from '../env'
import { enTetesService } from '../api/jetons'
import { instantaneDesBoites, rendreLesBoites, type Boite } from './menage'

const CONTENEUR = conteneur('mail-sync')
const EXEMPLAIRE = `${conteneur('mail-sync')}-jetable`
const IMAGE = 'python:3.13.13-slim-bookworm'
const JETON = lireEnv('MAIL_SYNC_INTERNAL_TOKEN')
const URL_API = urlApi()
const BOITE: Boite = { adresse: 'bizdev@p2enjoy.test', motDePasse: 'SeedDev2026Local' }
// Le fichier de test standard, reconnu par tout antivirus et inoffensif (le patron de `e2e/mail/ingestion.spec.ts`).
const EICAR = String.raw`X5O!P%@AP[4\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*`
const PDF = 'devis-crm143.pdf'
const ECHANTILLON = 'eicar-crm143.txt'

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

/** Attend une condition relue, jamais une durée supposée ; échoue en nommant ce qu'elle attendait. */
function attendre(quoi: string, condition: () => boolean, delaiMs = 120_000): void {
	const limite = Date.now() + delaiMs
	while (Date.now() < limite) {
		if (condition()) return
		execFileSync('sleep', ['1'])
	}
	throw new Error(`délai dépassé en attendant : ${quoi}`)
}

function pret(nom: string): boolean {
	return (
		spawnSync('docker', ['exec', nom, 'python', '-c',
			"import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/health/ready', timeout=2)"],
		{ encoding: 'utf8', timeout: 30_000 }).status === 0
	)
}

/**
 * Le service partagé arrêté, un exemplaire jetable SANS VEILLE ET SANS ANTIVIRUS le remplace sous l'alias `mail-sync`.
 * L'environnement est relu sur le service et transmis par NOM : aucun secret dans une ligne de commande (patron de
 * `e2e/mail/backfill.spec.ts`). Seuls `MAIL_SYNC_POLL_INTERVAL` et `CLAMAV_HOST` sont surchargés.
 */
function remplacerParUnExemplaireSansAntivirus(): void {
	const configuration = JSON.parse(docker('inspect', CONTENEUR, '--format', '{{json .Config}}')) as { Image: string; Env: string[] }
	const environnement: Record<string, string> = {}
	for (const entree of configuration.Env) {
		const egal = entree.indexOf('=')
		environnement[entree.slice(0, egal)] = entree.slice(egal + 1)
	}
	environnement['MAIL_SYNC_POLL_INTERVAL'] = '0'
	environnement['CLAMAV_HOST'] = 'clamav-absent.invalid'
	const reseauDuService = reseau()
	docker('stop', CONTENEUR)
	const arguments_ = ['run', '-d', '--rm', '--name', EXEMPLAIRE, '--network', reseauDuService, '--network-alias', 'mail-sync',
		'--volumes-from', CONTENEUR]
	for (const nom of Object.keys(environnement)) arguments_.push('-e', nom)
	arguments_.push(configuration.Image)
	execFileSync('docker', arguments_, { encoding: 'utf8', timeout: 120_000, env: { ...process.env, ...environnement } })
	attendre('l’exemplaire jetable prêt, sans veille', () => {
		const journal = spawnSync('docker', ['logs', EXEMPLAIRE], { encoding: 'utf8' })
		return `${journal.stdout}${journal.stderr}`.includes('"veille_desactivee"') && pret(EXEMPLAIRE)
	})
}

/** Retire l'exemplaire et rend le service partagé, sain — appelé dans le `finally`, quoi qu'il soit arrivé. */
function rendreLeService(): void {
	spawnSync('docker', ['rm', '-f', EXEMPLAIRE], { encoding: 'utf8', timeout: 60_000 })
	docker('start', CONTENEUR)
	attendre('le service partagé redémarré et sain', () => {
		const sante = spawnSync('docker', ['inspect', CONTENEUR, '--format', '{{.State.Health.Status}}'], { encoding: 'utf8' })
		return sante.stdout.trim() === 'healthy'
	}, 180_000)
}

/** Un vrai courrier, par le chemin SMTP authentifié, portant une pièce PDF et l'échantillon EICAR. */
function envoyerAvecPiece(sujet: string): void {
	python(
		`
import os, smtplib
from email.message import EmailMessage
msg = EmailMessage()
msg['From'] = os.environ['BOITE']
msg['To'] = os.environ['BOITE']
msg['Subject'] = os.environ['SUJET']
msg['Message-ID'] = '<' + os.environ['SUJET'] + '@p2enjoy.test>'
msg.set_content('Ci-joint le devis, antivirus absent.')
msg.add_attachment(b'%PDF-1.4 devis crm-143\\n%%EOF\\n', maintype='application', subtype='pdf', filename=os.environ['PDF'])
msg.add_attachment(os.environ['EICAR'].encode(), maintype='application', subtype='octet-stream', filename=os.environ['ECHANTILLON'])
s = smtplib.SMTP('stalwart', 587, timeout=30)
s.ehlo()
s.login(os.environ['BOITE'], os.environ['MDP'])
s.send_message(msg)
s.quit()
`,
		{ BOITE: BOITE.adresse, MDP: BOITE.motDePasse, SUJET: sujet, PDF, ECHANTILLON, EICAR },
	)
}

/** Une route interne du service qui répond sous l'alias `mail-sync` — l'exemplaire, ou le service partagé. */
function appeler(chemin: string): Record<string, unknown> {
	const brut = python(
		`
import os, urllib.error, urllib.request
requete = urllib.request.Request("http://mail-sync:8080" + os.environ["CHEMIN"], data=b"", method="POST")
requete.add_header("Authorization", "Bearer " + os.environ["JETON"])
try:
    with urllib.request.urlopen(requete, timeout=180) as r:
        print(r.read().decode(), end="")
except urllib.error.HTTPError as e:
    print(e.read().decode(), end="")
`,
		{ CHEMIN: chemin, JETON },
	)
	return JSON.parse(brut) as Record<string, unknown>
}

type Piece = {
	id: string
	filename: string
	av_status: string
	av_skip_reason: string | null
	storage_path: string
	text_status: string | null
}

/** Les pièces du courrier, par nom de fichier. */
async function lirePieces(request: import('@playwright/test').APIRequestContext, sujet: string): Promise<Record<string, Piece>> {
	const reponse = await request.get(
		`${URL_API}/rest/v1/mail_attachments?select=id,filename,av_status,av_skip_reason,storage_path,text_status,message:mail_messages!inner(subject)&message.subject=eq.${encodeURIComponent(sujet)}`,
		{ headers: enTetesService() },
	)
	expect(reponse.status()).toBe(200)
	return Object.fromEntries(((await reponse.json()) as Piece[]).map((p) => [p.filename, p]))
}

test('une pièce reçue sans antivirus naît non analysée et déposée ; l’antivirus revenu, la reprise juge la saine et l’infectée', async ({
	request,
}) => {
	test.setTimeout(480_000)
	const sujet = `crm143-non-analysee-${Date.now()}`
	const debut = new Date().toISOString()
	const avant = await instantaneDesBoites([BOITE])
	const comptes = await request.get(`${URL_API}/rest/v1/mail_inbound_accounts?select=id&imap_username=eq.${BOITE.adresse}`, {
		headers: enTetesService(),
	})
	const [{ id: compte }] = (await comptes.json()) as { id: string }[]

	try {
		remplacerParUnExemplaireSansAntivirus()
		try {
			envoyerAvecPiece(sujet)
			let pieces: Record<string, Piece> = {}
			for (let essai = 0; essai < 10 && Object.keys(pieces).length < 2; essai += 1) {
				appeler(`/internal/v1/inbound-accounts/${compte}/poll`)
				pieces = await lirePieces(request, sujet)
			}
			expect(Object.keys(pieces).sort(), 'les deux pièces ont été relevées').toEqual([ECHANTILLON, PDF].sort())
			for (const nom of [PDF, ECHANTILLON]) {
				expect(pieces[nom], nom).toMatchObject({ av_status: 'skipped', av_skip_reason: 'scanner_unavailable', text_status: null })
				// DÉPOSÉE : sans quoi la reprise n'aurait rien à analyser, et le repli rien à télécharger (§17.3).
				const objet = await request.get(`${URL_API}/storage/v1/object/mail-attachments/${pieces[nom].storage_path}`, {
					headers: enTetesService(),
				})
				expect(objet.status(), `l’objet de ${nom}, non analysé, est déposé`).toBe(200)
			}

			// Sans antivirus, la reprise ne juge rien : elle s'arrête au premier silence et n'écrit pas.
			const muette = appeler('/internal/v1/attachments/rescan?limit=100')
			expect(muette).toMatchObject({ scanner_unavailable: true })
			const apresSilence = await lirePieces(request, sujet)
			expect(apresSilence[PDF]).toMatchObject({ av_status: 'skipped' })
			expect(apresSilence[ECHANTILLON]).toMatchObject({ av_status: 'skipped' })
		} finally {
			rendreLeService()
		}

		// L'ANTIVIRUS REVENU : la même route, sur le service partagé et le vrai ClamAV, juge les deux pièces.
		let jugees: Record<string, Piece> = {}
		for (let essai = 0; essai < 10; essai += 1) {
			appeler('/internal/v1/attachments/rescan?limit=100')
			jugees = await lirePieces(request, sujet)
			if (jugees[PDF]?.av_status !== 'skipped' && jugees[ECHANTILLON]?.av_status !== 'skipped') break
		}
		expect(jugees[PDF], 'la reprise a jugé le PDF sain').toMatchObject({ av_status: 'clean', av_skip_reason: null })
		expect(jugees[ECHANTILLON], 'la reprise a reconnu EICAR').toMatchObject({ av_status: 'infected', av_skip_reason: null })
		// Devenue saine, un PDF entre dans l'extraction de son texte (le déclencheur de `0141`) ; l'infectée jamais.
		expect(['pending', 'extracted', 'empty', 'failed']).toContain(jugees[PDF].text_status)
		expect(jugees[ECHANTILLON].text_status).toBeNull()
	} finally {
		await rendreLesBoites(request, { boites: [BOITE], motif: sujet, avant, debut })
	}
})
