// @verifies CRM-158 (docs/BACKLOG.md) — la file d'envoi se vide SEULE : un envoi mis en file par la vraie garde part dans la
//           minute, sans qu'aucun appel à la route `outbox/flush` n'ait eu lieu, et le destinataire le reçoit
//           (docs/SPEC-mail-subsystem.md §34.2, §34.3, §34.11 ; docs/manual.md §12.5 « dans la minute » ; décisions 952 et 954)
//
// CE QUE CE FICHIER PROUVE, ET QU'AUCUN AUTRE NE PEUT PROUVER : le défaut de production du 2026-11-19 — rien ne vidait la
// file. Toutes les autres preuves d'envoi déclenchent la passe elles-mêmes ; celle-ci s'en INTERDIT, et le constate dans le
// journal du service : aucune requête sur la route entre la mise en file et le départ.

import { execFileSync, spawnSync } from 'node:child_process'
import { expect, test } from '@playwright/test'
import { conteneur } from '../conteneur'
import { lireEnv, urlApi } from '../env'
import { enTetesAuthentifies, enTetesService, jetonDe } from '../api/jetons'
import { attendreLeSort } from '../sort-envoi'
import { instantaneDesBoites, rendreLesBoites, type Boite } from './menage'

const CONTENEUR = conteneur('mail-sync')
const IMAGE = 'python:3.13.13-slim-bookworm'
const URL_API = urlApi()
const CARD = '5eed0000-0000-4000-8000-0000000000c1'
const CAMILLE = '5eed0000-0000-4000-8000-000000000011'
const DESTINATAIRE = 'bizdev@p2enjoy.test'
const BOITES: readonly Boite[] = [{ adresse: DESTINATAIRE, motDePasse: lireEnv('STALWART_MAILBOX_PASSWORD') }]

function docker(...arguments_: string[]): string {
	return execFileSync('docker', arguments_, { encoding: 'utf8', timeout: 300_000, stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

/** Le journal du service depuis `depuis`, ligne à ligne — sortie standard et erreur, où Uvicorn écrit aussi. */
function journal(depuis: string): Record<string, unknown>[] {
	// LES DEUX FLUX : `logging.StreamHandler` écrit sur la sortie d'erreur, que `execFileSync` ne rend pas.
	const sortie = spawnSync('docker', ['logs', '--since', depuis, CONTENEUR], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
	if (sortie.status !== 0) throw new Error(`docker logs a échoué : ${sortie.stderr}`)
	const brut = `${sortie.stdout}\n${sortie.stderr}`
	const lignes: Record<string, unknown>[] = []
	for (const ligne of brut.split('\n')) {
		try {
			lignes.push(JSON.parse(ligne) as Record<string, unknown>)
		} catch {
			// Une ligne qui n'est pas du JSONL n'est pas un événement du service : elle n'a rien à dire ici.
		}
	}
	return lignes
}

function objetRecu(objet: string): boolean {
	const reseau = docker('inspect', CONTENEUR, '--format', '{{range $k,$v := .NetworkSettings.Networks}}{{$k}}{{end}}')
	const sortie = docker(
		'run', '--rm', '--network', reseau, '-e', `BOITE=${DESTINATAIRE}`, '-e', `MOT=${BOITES[0]!.motDePasse}`, '-e', `OBJET=${objet}`,
		IMAGE, 'python', '-c',
		`
import imaplib, os
c = imaplib.IMAP4("stalwart", 143)
c.login(os.environ["BOITE"], os.environ["MOT"])
c.select("INBOX", readonly=True)
typ, ids = c.search(None, "HEADER", "Subject", os.environ["OBJET"])
print(len(ids[0].split()))
c.logout()
`,
	)
	return Number(sortie) >= 1
}

test.describe('la file d’envoi se vide seule (CRM-158, §34)', () => {
	test('un envoi mis en file part dans la minute, sans aucun appel à la route', async ({ request }) => {
		test.setTimeout(180_000)
		const objet = `EnvoiAutomatique${Date.now()}`
		const debut = new Date().toISOString()
		const dossiersAvant = await instantaneDesBoites(BOITES)
		let file: string | undefined

		// LA BOUCLE TOURNE : le service l'a annoncée à son démarrage, avec sa cadence.
		const demarrage = journal('1970-01-01T00:00:00Z').filter((ligne) => ligne['event'] === 'outbox_loop_started')
		expect(demarrage.length, 'mail-sync n’a pas démarré de boucle d’envoi : l’image est-elle reconstruite ?').toBeGreaterThanOrEqual(1)
		expect(demarrage.at(-1)!['intervalle_secondes']).toBe(30)

		try {
			const [identite] = (await (
				await request.get(`${URL_API}/rest/v1/mail_outbound_identities?select=id&owner_id=eq.${CAMILLE}&is_default=is.true`, {
					headers: enTetesService(),
				})
			).json()) as { id: string }[]
			expect(identite, 'l’identité par défaut de Camille, dans le seed').toBeDefined()

			const miseEnFile = await request.post(`${URL_API}/rest/v1/rpc/queue_outbound_email`, {
				headers: { ...enTetesAuthentifies(await jetonDe('admin@p2enjoy.test')), 'Content-Type': 'application/json' },
				data: {
					p_card_id: CARD,
					p_identity_id: identite!.id,
					p_to: [DESTINATAIRE],
					p_subject: objet,
					p_body_text: 'Bonjour,\n\nCe message part sans que personne ne vide la file.',
				},
			})
			expect(miseEnFile.status(), await miseEnFile.text()).toBe(200)
			file = (await miseEnFile.json()) as string
			const misEnFileA = Date.now()
			const repere = new Date(misEnFileA - 1000).toISOString()

			// AUCUN APPEL À LA ROUTE : la preuve attend, c'est tout. La borne est la promesse du manuel, une minute.
			const parti = await attendreLeSort(request, file, { borne: 60_000 })
			const delai = Date.now() - misEnFileA
			expect(parti.status).toBe('sent')
			expect(delai, `parti en ${delai} ms`).toBeLessThanOrEqual(60_000)

			// PERSONNE N'A VIDÉ LA FILE À SA PLACE : le journal du service ne porte aucune requête sur la route depuis la mise en
			// file, et une passe de la boucle y dit l'avoir envoyé.
			const lignes = journal(repere)
			const appels = lignes.filter((ligne) => ligne['event'] === 'request_completed' && ligne['path'] === '/internal/v1/outbox/flush')
			expect(appels, 'une requête a vidé la file : la preuve ne dit plus rien de la boucle').toEqual([])
			expect(lignes.some((ligne) => ligne['event'] === 'outbox_flushed' && Number(ligne['sent']) >= 1)).toBe(true)

			// LE DESTINATAIRE L'A REÇU — dans sa vraie boîte.
			expect(objetRecu(objet), 'le message n’est pas dans la boîte du destinataire').toBe(true)
		} finally {
			if (file !== undefined) await request.delete(`${URL_API}/rest/v1/mail_outbox?id=eq.${file}`, { headers: enTetesService() })
			await rendreLesBoites(request, { boites: BOITES, motif: objet, avant: dossiersAvant, debut })
		}
	})
})
