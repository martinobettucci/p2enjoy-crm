// @verifies CRM-059 (docs/BACKLOG.md) — « coupure SMTP simulée sans perte de message »
// @verifies docs/SPEC-mail-subsystem.md §20.3 (une panne se rejoue), §20.4 (l'envoi orphelin),
//           §7 (la file ne perd pas) ; docs/JOURNAL.md décision 331
// @verifies INC-271 (docs/INCONSISTENCY_REPORT.md, décision 624) — la boîte destinataire est rendue dans l'état trouvé,
//           copie rangée par la veille et dossiers nés compris
//
// LA COUPURE EST RÉELLE, PAS SIMULÉE PAR UNE SUBSTITUTION : l'identité est momentanément pointée
// vers un port fermé, et le worker se heurte à un vrai refus de connexion. Ce que le scénario
// mesure ensuite est le fait qui compte — le message n'est ni parti, ni perdu : il est REPROGRAMMÉ.
//
// Le serveur revenu, le même message part pour de bon. Sans cette seconde moitié, la preuve
// montrerait qu'on sait échouer, pas qu'on sait reprendre.

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
const CARD = '5eed0000-0000-4000-8000-0000000000c1'

// LA BOÎTE VISÉE EST RÉELLE ET SEEDÉE — celle de Driss, `owner_id` non nul, donc RLS-visible.
// C'est ce qui fait de ces deux scénarios les auteurs de la fuite d'INC-091 tant qu'ils ne
// purgent que la table (décision 362) : la veille de `CRM-059` relève ce compte en continu.
const DESTINATAIRE = 'bizdev@p2enjoy.test'
const MDP = lireEnv('STALWART_MAILBOX_PASSWORD')
/** La boîte destinataire, que la veille relève et où elle RANGE une copie sous `CRM/…` (INC-271). */
const BOITES: readonly Boite[] = [{ adresse: DESTINATAIRE, motDePasse: MDP }]
/** Port fermé sur l'hôte `stalwart` : la connexion est refusée immédiatement, sans attente. */
const PORT_FERME = 1

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

function viderLaFile(): Record<string, number> {
	const brut = docker(
		'run',
		'--rm',
		'--network',
		reseau(),
		'-e',
		`JETON=${JETON}`,
		IMAGE,
		'python',
		'-c',
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
	)
	return JSON.parse(brut) as Record<string, number>
}

test.describe('résilience de l’envoi — une coupure ne perd rien', () => {
	test('SMTP coupé : le message est reprogrammé, pas perdu ; revenu : il part', async ({
		request,
	}) => {
		const objet = `Coupure ${Date.now()}`
		let file: string | undefined
		const debut = new Date().toISOString()
		const dossiersAvant = await instantaneDesBoites(BOITES)
		let identite: string | undefined
		let portOrigine: number | undefined

		try {
			const identites = await request.get(
				`${URL_API}/rest/v1/mail_outbound_identities?select=id,smtp_port&owner_id=is.null&limit=1`,
				{ headers: enTetesService() },
			)
			const [service] = (await identites.json()) as { id: string; smtp_port: number }[]
			expect(service, 'l’identité de service du seed est introuvable').toBeDefined()
			identite = service!.id
			portOrigine = service!.smtp_port

			const miseEnFile = await request.post(`${URL_API}/rest/v1/rpc/queue_outbound_email`, {
				headers: {
					...enTetesAuthentifies(await jetonDe('admin@p2enjoy.test')),
					'Content-Type': 'application/json',
				},
				data: {
					p_card_id: CARD,
					p_identity_id: identite,
					p_to: [DESTINATAIRE],
					p_subject: objet,
					p_body_text: 'Message qui doit survivre à une coupure.',
				},
			})
			expect(miseEnFile.status(), await miseEnFile.text()).toBe(200)
			file = (await miseEnFile.json()) as string

			// --- LA COUPURE ---------------------------------------------------------------------
			const coupure = await request.patch(
				`${URL_API}/rest/v1/mail_outbound_identities?id=eq.${identite}`,
				{
					headers: { ...enTetesService(), Prefer: 'return=minimal' },
					data: { smtp_port: PORT_FERME },
				},
			)
			expect([200, 204]).toContain(coupure.status())

			const passeEnPanne = viderLaFile()
			expect(
				passeEnPanne['rescheduled'],
				`la passe en panne a rendu ${JSON.stringify(passeEnPanne)}`,
			).toBe(1)
			expect(passeEnPanne['sent']).toBe(0)
			// UNE PANNE N'EST PAS UN ÉCHEC DÉFINITIF : le compteur des échecs reste à zéro.
			expect(passeEnPanne['failed']).toBe(0)

			const apresPanne = await request.get(
				`${URL_API}/rest/v1/mail_outbox?select=status,attempts,last_error,next_attempt_at&id=eq.${file}`,
				{ headers: enTetesService() },
			)
			const [enAttente] = (await apresPanne.json()) as {
				status: string
				attempts: number
				last_error: string
				next_attempt_at: string
			}[]
			// LE MESSAGE N'EST NI PARTI, NI PERDU : il attend, sa tentative est comptée, et sa
			// cause est nommée par un CODE.
			expect(enAttente?.status).toBe('queued')
			expect(enAttente?.attempts).toBe(1)
			expect(enAttente?.last_error).toBe('connection_refused')
			expect(new Date(enAttente!.next_attempt_at).getTime()).toBeGreaterThan(Date.now())

			// --- LE RETOUR ----------------------------------------------------------------------
			await request.patch(`${URL_API}/rest/v1/mail_outbound_identities?id=eq.${identite}`, {
				headers: { ...enTetesService(), Prefer: 'return=minimal' },
				data: { smtp_port: portOrigine },
			})

			// LE DÉLAI EST RAMENÉ À MAINTENANT — le scénario ne mesure pas l'horloge, il mesure la
			// reprise. Attendre une minute pour prouver qu'une minute passe n'apprendrait rien.
			await request.patch(`${URL_API}/rest/v1/mail_outbox?id=eq.${file}`, {
				headers: { ...enTetesService(), Prefer: 'return=minimal' },
				data: { next_attempt_at: new Date(Date.now() - 1000).toISOString() },
			})

			const passeRetablie = viderLaFile()
			expect(
				passeRetablie['sent'],
				`la passe rétablie a rendu ${JSON.stringify(passeRetablie)}`,
			).toBe(1)

			const apresRetour = await request.get(
				`${URL_API}/rest/v1/mail_outbox?select=status,attempts&id=eq.${file}`,
				{ headers: enTetesService() },
			)
			const [parti] = (await apresRetour.json()) as { status: string; attempts: number }[]
			expect(parti?.status).toBe('sent')
			// LA TENTATIVE PERDUE RESTE COMPTÉE : l'exploitant doit pouvoir lire qu'un envoi a
			// d'abord échoué, même s'il a fini par partir.
			expect(parti?.attempts).toBe(1)
		} finally {
			if (identite !== undefined && portOrigine !== undefined) {
				await request.patch(`${URL_API}/rest/v1/mail_outbound_identities?id=eq.${identite}`, {
					headers: { ...enTetesService(), Prefer: 'return=minimal' },
					data: { smtp_port: portOrigine },
				})
			}
			if (file !== undefined) {
				await request.delete(`${URL_API}/rest/v1/mail_outbox?id=eq.${file}`, {
					headers: enTetesService(),
				})
			}
			// LA BOÎTE D'ABORD, LA TABLE ENSUITE — INC-091, décision 362 : c'est le message laissé dans la boîte RÉELLE
			// que la veille remonterait au tour suivant. ET LES DOSSIERS OÙ LA VEILLE L'A RANGÉ — INC-271, décision 624 :
			// `rendreLesBoites` (e2e/mail/menage.ts) rend la boîte dans l'état trouvé, barrière comprise.
			await rendreLesBoites(request, { boites: BOITES, motif: objet, avant: dossiersAvant, debut })
		}
	})

	test('un envoi abandonné par un worker mort est REPRIS, non perdu', async ({ request }) => {
		const objet = `Orphelin ${Date.now()}`
		let file: string | undefined
		const debut = new Date().toISOString()
		const dossiersAvant = await instantaneDesBoites(BOITES)

		try {
			const identites = await request.get(
				`${URL_API}/rest/v1/mail_outbound_identities?select=id&owner_id=is.null&limit=1`,
				{ headers: enTetesService() },
			)
			const [service] = (await identites.json()) as { id: string }[]

			const miseEnFile = await request.post(`${URL_API}/rest/v1/rpc/queue_outbound_email`, {
				headers: {
					...enTetesAuthentifies(await jetonDe('admin@p2enjoy.test')),
					'Content-Type': 'application/json',
				},
				data: {
					p_card_id: CARD,
					p_identity_id: service!.id,
					p_to: [DESTINATAIRE],
					p_subject: objet,
					p_body_text: 'Message abandonné en vol.',
				},
			})
			file = (await miseEnFile.json()) as string

			// LA MORT DU WORKER EST SIMULÉE PAR SON EFFET, qui est le seul fait observable : une
			// ligne restée `sending`, vieille de plus que le seuil. Tuer réellement un conteneur
			// au bon millième de seconde ne prouverait rien de plus, et rien de reproductible.
			const abandon = await request.patch(`${URL_API}/rest/v1/mail_outbox?id=eq.${file}`, {
				headers: { ...enTetesService(), Prefer: 'return=minimal' },
				// `reserved_at`, ET NON `updated_at` : le trigger de la table remet la seconde à
				// `now()` à chaque écriture, si bien que vieillir la ligne la rajeunissait —
				// mesuré en écrivant cette preuve, et corrigé par une colonne dédiée (§20.4).
				data: {
					status: 'sending',
					reserved_at: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
				},
			})
			expect([200, 204]).toContain(abandon.status())

			const passe = viderLaFile()
			expect(passe['orphans'], `la passe a rendu ${JSON.stringify(passe)}`).toBeGreaterThanOrEqual(1)

			// REPRIS ET PARTI DANS LA MÊME PASSE : l'orphelin est remis en file avant la
			// réservation, sans quoi il aurait attendu la suivante.
			const apres = await request.get(
				`${URL_API}/rest/v1/mail_outbox?select=status&id=eq.${file}`,
				{ headers: enTetesService() },
			)
			const [reprise] = (await apres.json()) as { status: string }[]
			expect(reprise?.status).toBe('sent')
		} finally {
			if (file !== undefined) {
				await request.delete(`${URL_API}/rest/v1/mail_outbox?id=eq.${file}`, {
					headers: enTetesService(),
				})
			}
			// LA BOÎTE D'ABORD, LA TABLE ENSUITE — INC-091, décision 362. Ce scénario-ci envoie
			// pour de bon : le message EST remis, et il resterait donc en boîte indéfiniment — copie rangée
			// par la veille comprise (INC-271, décision 624).
			await rendreLesBoites(request, { boites: BOITES, motif: objet, avant: dossiersAvant, debut })
		}
	})
})
