// @verifies CRM-156 (docs/BACKLOG.md) — tranche T1 : les actions groupées de l'inbox par l'API réelle, sous les jetons réels
//           des trois profils du seed — le filtre explicite exigé, la portée limitée à ce que chacun voit, les refus de
//           l'action unitaire comptés dans le compte rendu, une sélection mixte, les paquets et leur curseur
// @verifies docs/SPEC-mail-subsystem.md §32.2 à §32.5 bis ; docs/JOURNAL.md décisions 944, 946 et 949 ; CLAUDE.md §10
//           (toute règle d'accès se prouve hors interface)
//
// La preuve pose ses messages sous la clé de service et les retire à la fin : deux reçus et un envoi, non classés, dans la
// boîte de Driss (business developer), d'un expéditeur propre à l'exécution ; un reçu du même expéditeur dans l'affaire
// `…c5`, que Driss et Farida (lectrice) lisent sans l'écrire. AUCUN CLASSEMENT RÉUSSI ici : il écrirait au journal
// immuable d'une affaire du seed ; le succès de chaque action est prouvé par pgTAP, dans une transaction défaite
// (`supabase/tests/0177_actions_groupees_inbox.test.sql`).
// *Révisé le 2026-11-21 (`CRM-161` T1, docs/SPEC-mail-subsystem.md §35.8, décision 51)* : les fonctions de l'inbox prennent
// l'espace (`p_workspace_id`, la portée `workspace_id`) ; la preuve passe celui du seed, sans changer ce qu'elle prouve.

import { expect, test, type APIRequestContext } from '@playwright/test'
import { CLE_ANONYME, URL_API, enTetesAuthentifies, enTetesService, jetonDe } from './jetons'

const WORKSPACE = '5eed0000-0000-4000-8000-000000000001'
const DRISS = '5eed0000-0000-4000-8000-000000000012'
const C5 = '5eed0000-0000-4000-8000-0000000000c5'

async function rpc(request: APIRequestContext, jeton: string, fonction: string, corps: Record<string, unknown>) {
	return request.post(`${URL_API}/rest/v1/rpc/${fonction}`, {
		headers: { ...enTetesAuthentifies(jeton), 'Content-Type': 'application/json' },
		data: corps,
	})
}

type CompteRendu = { threads: number; messages: number; done: number; refused: Record<string, number>; next: unknown }

test.describe('les actions groupées de l’inbox — décidées par la base (CRM-156, §32)', () => {
	test('chaque profil n’agit que sur ce qu’il voit, avec les refus de l’action unitaire', async ({ request }) => {
		const [bizdev, viewer] = await Promise.all([jetonDe('bizdev@p2enjoy.test'), jetonDe('viewer@p2enjoy.test')])
		const expediteur = `crm156-${Date.now()}@exemple.test`
		const boites = (await (
			await request.get(`${URL_API}/rest/v1/mail_inbound_accounts?select=id&owner_id=eq.${DRISS}&limit=1`, {
				headers: enTetesService(),
			})
		).json()) as { id: string }[]
		expect(boites[0], 'une boîte de Driss dans le seed').toBeDefined()

		const poser = async (suffixe: string, champs: Record<string, unknown>) => {
			const reponse = await request.post(`${URL_API}/rest/v1/mail_messages?select=id`, {
				headers: { ...enTetesService(), Prefer: 'return=representation' },
				data: {
					workspace_id: WORKSPACE,
					rfc822_message_id: `<${suffixe}-${expediteur}>`,
					classification: 'unclassified',
					direction: 'inbound',
					from_address: expediteur,
					subject: `Preuve API CRM-156 ${suffixe}`,
					received_at: new Date().toISOString(),
					...champs,
				},
			})
			expect(reponse.status(), await reponse.text()).toBe(201)
			return ((await reponse.json()) as { id: string }[])[0]!.id
		}
		const recu1 = await poser('r1', {})
		const recu2 = await poser('r2', {})
		const envoi = await poser('e1', { direction: 'outbound', references_ids: [`<r1-${expediteur}>`] })
		const dansC5 = await poser('k1', { card_id: C5, classification: 'manual' })
		let uid = 156_100 + (Date.now() % 1000)
		for (const message of [recu1, recu2, envoi]) {
			const occurrence = await request.post(`${URL_API}/rest/v1/mail_message_occurrences`, {
				headers: enTetesService(),
				data: { message_id: message, account_id: boites[0]!.id, folder: 'INBOX', uid: uid++ },
			})
			expect(occurrence.status(), await occurrence.text()).toBe(201)
		}
		const nonClasses = { workspace_id: WORKSPACE, folder: 'unclassified', sender: expediteur, snoozed: 'shown' }
		const affaireC5 = { workspace_id: WORKSPACE, folder: 'card', card_id: C5, sender: expediteur, snoozed: 'shown' }

		try {
			// L'anonyme n'appelle rien.
			const anonyme = await request.post(`${URL_API}/rest/v1/rpc/inbox_bulk_count`, {
				headers: { apikey: CLE_ANONYME, 'Content-Type': 'application/json' },
				data: { p_scope: nonClasses },
			})
			expect([401, 403], await anonyme.text()).toContain(anonyme.status())

			// « Tout le filtre » sans filtre explicite : refusé par la base, quel que soit l'écran.
			const sansFiltre = await rpc(request, bizdev, 'inbox_bulk_apply', {
				p_scope: { workspace_id: WORKSPACE, folder: 'unclassified', snoozed: 'shown' },
				p_action: 'mark_read',
			})
			expect(sansFiltre.status(), await sansFiltre.text()).toBe(400)
			expect(await sansFiltre.text()).toContain('filter_required')

			// Driss voit sa boîte : deux fils, trois messages ; Farida ne la voit pas : rien.
			const compte = async (jeton: string, portee: object) =>
				((await (await rpc(request, jeton, 'inbox_bulk_count', { p_scope: portee })).json()) as {
					thread_count: number
					message_count: number
				}[])[0]
			expect(await compte(bizdev, nonClasses)).toEqual({ thread_count: 2, message_count: 3 })
			expect(await compte(viewer, nonClasses)).toEqual({ thread_count: 0, message_count: 0 })

			// Classer dans une affaire que Driss lit sans l'écrire : chaque message refusé, et rien ne bouge.
			const classer = await rpc(request, bizdev, 'inbox_bulk_apply', {
				p_scope: nonClasses,
				p_action: 'classify',
				p_argument: { card_id: C5 },
			})
			expect(classer.status(), await classer.text()).toBe(200)
			expect((await classer.json()) as CompteRendu).toEqual({
				threads: 2,
				messages: 3,
				done: 0,
				refused: { forbidden: 3 },
				next: null,
			})
			const restes = (await (
				await request.get(`${URL_API}/rest/v1/mail_messages?select=card_id&id=in.(${recu1},${recu2},${envoi})`, {
					headers: enTetesService(),
				})
			).json()) as { card_id: string | null }[]
			expect(restes.every((ligne) => ligne.card_id === null), 'aucun message n’a été classé').toBe(true)

			// Une sélection mixte : réévaluer les pastilles d'un fil qui porte un reçu et un envoi.
			const mixte = await rpc(request, bizdev, 'inbox_bulk_apply', {
				p_scope: { ...nonClasses, threads: [{ workspace_id: WORKSPACE, thread_key: `<r1-${expediteur}>` }] },
				p_action: 'request_label_evaluation',
			})
			expect(mixte.status(), await mixte.text()).toBe(200)
			expect((await mixte.json()) as CompteRendu).toMatchObject({ messages: 2, done: 1, refused: { outbound_message: 1 } })

			// La lectrice, dans l'affaire qu'elle lit : marquer lu, oui ; supprimer, non — la règle de l'unité.
			const lu = await rpc(request, viewer, 'inbox_bulk_apply', { p_scope: affaireC5, p_action: 'mark_read' })
			expect((await lu.json()) as CompteRendu).toMatchObject({ messages: 1, done: 1 })
			const supprime = await rpc(request, viewer, 'inbox_bulk_apply', {
				p_scope: affaireC5,
				p_action: 'delete',
				p_argument: { also_mailbox: false },
			})
			expect((await supprime.json()) as CompteRendu).toMatchObject({ done: 0, refused: { forbidden: 1 } })

			// Un curseur mal formé : refusé.
			const curseur = await rpc(request, bizdev, 'inbox_bulk_apply', {
				p_scope: { ...affaireC5, after: 'pas-un-uuid' },
				p_action: 'mark_read',
			})
			expect(curseur.status(), await curseur.text()).toBe(400)
			expect(await curseur.text()).toContain('invalid_scope')
		} finally {
			await request.delete(`${URL_API}/rest/v1/mail_messages?id=in.(${recu1},${recu2},${envoi},${dansC5})`, {
				headers: enTetesService(),
			})
		}
	})
})
