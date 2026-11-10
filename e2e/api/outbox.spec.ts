// @verifies CRM-144 (docs/BACKLOG.md) — tranche T3 : l'outbox par une requête directe qui contourne l'interface, avec de
//           vrais jetons — l'auteur annule, un administrateur annule l'envoi d'un collègue, un collègue non administrateur
//           est refusé, la lectrice ne voit pas l'envoi d'une affaire qu'elle ne lit pas (404) et ne peut rien sur celui
//           d'une affaire qu'elle lit (403), l'issue incertaine refusée, réessayer un échec et pas un envoi parti,
//           l'anonyme rien ; la capacité `outbox_gestes_permis` lue sous chaque session
// @verifies docs/SPEC-mail-subsystem.md §28.2, §28.3, §28.4, §28.11 (ligne « API ») ; docs/SCHEMA.md « Migration `0176` » ;
//           décision 906 ; CLAUDE.md §10
//
// LES ENVOIS DE LA PREUVE sont posés par la clé de service, comme `queue_outbound_email` les pose — la file est le fait du
// service —, sur deux affaires du seed (docs/SPEC-seed.md) : c1, que la lectrice ne lit pas, et c6, qu'elle lit. Leur départ
// est prévu dans un jour : le worker local ne les prend pas pendant la preuve. Chaque envoi créé est retiré, même en cas
// d'échec. CE QUE LA REMISE EN ÉTAT NE PEUT PAS DÉFAIRE, et qui est nommé plutôt que tu : la ligne `mail_cancelled` écrite au
// fil de c1 par chaque annulation réussie. `card_events` n'accorde aucun privilège d'écriture, `service_role` compris
// (`CRM-044`) : l'historique ne se corrige pas — la règle de `e2e/ui/declassement.spec.ts`.

import { expect, test, type APIRequestContext } from '@playwright/test'
import { URL_API, enTetesAnonymes, enTetesAuthentifies, enTetesService, jetonDe } from './jetons'

const WORKSPACE = '5eed0000-0000-4000-8000-000000000001'
const CARD_ILLISIBLE = '5eed0000-0000-4000-8000-0000000000c1'
const CARD_LUE = '5eed0000-0000-4000-8000-0000000000c6'
const CAMILLE = '5eed0000-0000-4000-8000-000000000011'
const DRISS = '5eed0000-0000-4000-8000-000000000012'
const CORPS = 'Preuve API de l’outbox CRM-144.'

type Ligne = { id: string; status: string; last_error: string | null; cancelled_by: string | null }

async function identiteDe(request: APIRequestContext, personne: string): Promise<string> {
	const reponse = await request.get(
		`${URL_API}/rest/v1/mail_outbound_identities?select=id&owner_id=eq.${personne}&order=created_at&limit=1`,
		{ headers: enTetesService() },
	)
	const [identite] = (await reponse.json()) as { id: string }[]
	expect(identite, `une identité d'expédition pour ${personne}`).toBeDefined()
	return identite!.id
}

test.describe('l’outbox — annuler et réessayer, contrôlés par la base (§28.3, §28.4)', () => {
	test('chaque profil obtient ce que la base lui permet, et rien d’autre', async ({ request }) => {
		const identites: Record<string, string> = {
			[CAMILLE]: await identiteDe(request, CAMILLE),
			[DRISS]: await identiteDe(request, DRISS),
		}
		const crees: string[] = []
		const poser = async (auteur: string, carte: string, statut: string, motif: string | null = null): Promise<string> => {
			const reponse = await request.post(`${URL_API}/rest/v1/mail_outbox?select=id`, {
				headers: { ...enTetesService(), Prefer: 'return=representation' },
				data: {
					workspace_id: WORKSPACE,
					identity_id: identites[auteur],
					card_id: carte,
					to_addrs: ['client@exterieur.test'],
					subject: `Preuve outbox ${statut}`,
					body_text: CORPS,
					status: statut,
					last_error: motif,
					created_by: auteur,
					next_attempt_at: new Date(Date.now() + 86_400_000).toISOString(),
					...(statut === 'sent' ? { sent_at: new Date().toISOString() } : {}),
				},
			})
			expect(reponse.status(), await reponse.text()).toBe(201)
			const [ligne] = (await reponse.json()) as { id: string }[]
			crees.push(ligne!.id)
			return ligne!.id
		}
		const lire = async (id: string): Promise<Ligne> => {
			const reponse = await request.get(
				`${URL_API}/rest/v1/mail_outbox?select=id,status,last_error,cancelled_by&id=eq.${id}`,
				{ headers: enTetesService() },
			)
			return ((await reponse.json()) as Ligne[])[0]!
		}
		const geste = (fonction: string, id: string, entetes: Record<string, string>) =>
			request.post(`${URL_API}/rest/v1/rpc/${fonction}`, { headers: entetes, data: { p_outbox_id: id } })
		const capacite = async (id: string, entetes: Record<string, string>) => {
			const reponse = await request.get(`${URL_API}/rest/v1/mail_outbox?select=outbox_gestes_permis&id=eq.${id}`, {
				headers: entetes,
			})
			expect(reponse.status()).toBe(200)
			return (await reponse.json()) as { outbox_gestes_permis: boolean }[]
		}

		try {
			const camille = enTetesAuthentifies(await jetonDe('admin@p2enjoy.test'))
			const driss = enTetesAuthentifies(await jetonDe('bizdev@p2enjoy.test'))
			const lectrice = enTetesAuthentifies(await jetonDe('viewer@p2enjoy.test'))

			// L'AUTEUR ANNULE son envoi en file : la date, la ligne annulée par lui, et une ligne `mail_cancelled` au fil.
			const sien = await poser(DRISS, CARD_ILLISIBLE, 'queued')
			expect(await capacite(sien, driss)).toEqual([{ outbox_gestes_permis: true }])
			const annulation = await geste('cancel_outbound_email', sien, driss)
			expect(annulation.status(), await annulation.text()).toBe(200)
			expect(Number.isNaN(Date.parse((await annulation.json()) as string))).toBe(false)
			expect(await lire(sien)).toMatchObject({ status: 'cancelled', cancelled_by: DRISS })
			const evenements = await request.get(
				`${URL_API}/rest/v1/card_events?select=actor_id&type=eq.mail_cancelled&payload->>outbox_id=eq.${sien}`,
				{ headers: enTetesService() },
			)
			expect(await evenements.json()).toEqual([{ actor_id: DRISS }])
			// Une seconde annulation est refusée, nommée.
			const encore = await geste('cancel_outbound_email', sien, driss)
			expect(encore.status()).toBe(409)
			expect(await encore.text()).toContain('outbox_cancelled')

			// UN ADMINISTRATEUR ANNULE L'ENVOI D'UN COLLÈGUE (décision 906, Q1).
			const deDriss = await poser(DRISS, CARD_ILLISIBLE, 'queued')
			expect(await capacite(deDriss, camille)).toEqual([{ outbox_gestes_permis: true }])
			const parAdmin = await geste('cancel_outbound_email', deDriss, camille)
			expect(parAdmin.status(), await parAdmin.text()).toBe(200)
			expect(await lire(deDriss)).toMatchObject({ status: 'cancelled', cancelled_by: CAMILLE })

			// UN COLLÈGUE NON ADMINISTRATEUR EST REFUSÉ, et l'envoi reste en file.
			const deCamille = await poser(CAMILLE, CARD_ILLISIBLE, 'queued')
			expect(await capacite(deCamille, driss)).toEqual([{ outbox_gestes_permis: false }])
			const refuse = await geste('cancel_outbound_email', deCamille, driss)
			expect(refuse.status(), await refuse.text()).toBe(403)
			expect(await refuse.text()).toContain('forbidden')
			expect((await lire(deCamille)).status).toBe('queued')

			// LA LECTRICE ne voit pas l'envoi d'une affaire qu'elle ne lit pas : 404, sans distinguer l'interdit.
			expect(await capacite(deCamille, lectrice)).toEqual([])
			const invisible = await geste('cancel_outbound_email', deCamille, lectrice)
			expect(invisible.status()).toBe(404)
			expect(await invisible.text()).toContain('outbox_not_found')
			const invisibleRetry = await geste('retry_outbound_email', deCamille, lectrice)
			expect(invisibleRetry.status()).toBe(404)
			// …et ne peut rien sur celui d'une affaire qu'elle lit : elle le voit, sa capacité est fausse, la base refuse.
			const lu = await poser(DRISS, CARD_LUE, 'queued')
			expect(await capacite(lu, lectrice)).toEqual([{ outbox_gestes_permis: false }])
			const lectriceRefusee = await geste('cancel_outbound_email', lu, lectrice)
			expect(lectriceRefusee.status(), await lectriceRefusee.text()).toBe(403)
			expect((await lire(lu)).status).toBe('queued')

			// L'ISSUE INCERTAINE (décision 906, Q3) : refusée, et la ligne reste en file.
			const incertain = await poser(DRISS, CARD_ILLISIBLE, 'queued', 'worker_interrompu')
			const refusIncertain = await geste('cancel_outbound_email', incertain, driss)
			expect(refusIncertain.status()).toBe(409)
			expect(await refusIncertain.text()).toContain('outbox_uncertain')
			expect(await lire(incertain)).toMatchObject({ status: 'queued', last_error: 'worker_interrompu' })

			// RÉESSAYER UN ÉCHEC : il repasse en file, son motif effacé ; un envoi parti ne se réessaie pas.
			const parti = await poser(DRISS, CARD_ILLISIBLE, 'sent')
			const refusParti = await geste('retry_outbound_email', parti, driss)
			expect(refusParti.status()).toBe(409)
			expect(await refusParti.text()).toContain('outbox_sent')
			const echec = await poser(DRISS, CARD_ILLISIBLE, 'failed', 'auth_failed')
			const reprise = await geste('retry_outbound_email', echec, driss)
			expect(reprise.status(), await reprise.text()).toBe(200)
			expect(await reprise.json()).toBe(echec)
			const relu = await lire(echec)
			// Remis en file et dû : le worker local peut déjà l'avoir pris — jamais il ne reste en échec.
			expect(['queued', 'sending', 'sent', 'failed']).toContain(relu.status)
			expect(relu.status === 'failed' && relu.last_error === 'auth_failed').toBe(false)

			// L'ANONYME : ni l'un, ni l'autre.
			const anonyme = await geste('cancel_outbound_email', deCamille, enTetesAnonymes())
			expect([401, 403]).toContain(anonyme.status())
			const anonymeRetry = await geste('retry_outbound_email', deCamille, enTetesAnonymes())
			expect([401, 403]).toContain(anonymeRetry.status())
			expect((await lire(deCamille)).status).toBe('queued')
		} finally {
			for (const id of crees) {
				await request.delete(`${URL_API}/rest/v1/mail_outbox?id=eq.${id}`, { headers: enTetesService() })
			}
		}
	})
})
