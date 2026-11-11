// @verifies CRM-138 (docs/BACKLOG.md) — tranche T1 : effacer, la corbeille visible, restaurer, et chaque refus, par l'API
//           réelle avec les jetons réels des trois profils du seed (docs/SPEC-mail-subsystem.md §29.3, §29.4, §29.6)
// @verifies docs/JOURNAL.md décisions 878, 917 et 921 ; CLAUDE.md §10 (toute règle d'accès se prouve hors interface)
//
// La preuve pose son propre message, non classé, dans la boîte de Camille (l'administratrice), sous la clé de service, et
// le retire à la fin. Driss (business developer) et Farida (lectrice) ne voient pas cette boîte.

import { expect, test, type APIRequestContext } from '@playwright/test'
import { URL_API, enTetesAuthentifies, enTetesService, jetonDe } from './jetons'

const WORKSPACE = '5eed0000-0000-4000-8000-000000000001'
const CAMILLE = '5eed0000-0000-4000-8000-000000000011'

async function rpc(request: APIRequestContext, jeton: string, fonction: string, corps: Record<string, unknown>) {
	return request.post(`${URL_API}/rest/v1/rpc/${fonction}`, {
		headers: { ...enTetesAuthentifies(jeton), 'Content-Type': 'application/json' },
		data: corps,
	})
}

test.describe('la corbeille des messages — contrôlée par la base (CRM-138, §29)', () => {
	test('chaque profil obtient ce que la base lui permet, et rien d’autre', async ({ request }) => {
		const [admin, bizdev, viewer] = await Promise.all([
			jetonDe('admin@p2enjoy.test'),
			jetonDe('bizdev@p2enjoy.test'),
			jetonDe('viewer@p2enjoy.test'),
		])
		const boites = (await (
			await request.get(`${URL_API}/rest/v1/mail_inbound_accounts?select=id&owner_id=eq.${CAMILLE}&order=created_at&limit=1`, {
				headers: enTetesService(),
			})
		).json()) as { id: string }[]
		expect(boites[0], 'une boîte de Camille dans le seed').toBeDefined()
		const pose = await request.post(`${URL_API}/rest/v1/mail_messages?select=id`, {
			headers: { ...enTetesService(), Prefer: 'return=representation' },
			data: {
				workspace_id: WORKSPACE,
				rfc822_message_id: `<crm138-api-${Date.now()}@exemple.test>`,
				classification: 'unclassified',
				direction: 'inbound',
				from_address: 'inconnu@exemple.test',
				subject: 'Preuve API CRM-138',
				received_at: new Date().toISOString(),
			},
		})
		expect(pose.status(), await pose.text()).toBe(201)
		const message = ((await pose.json()) as { id: string }[])[0]!.id
		const occurrence = await request.post(`${URL_API}/rest/v1/mail_message_occurrences`, {
			headers: enTetesService(),
			data: { message_id: message, account_id: boites[0]!.id, folder: 'INBOX', uid: 990001 },
		})
		expect(occurrence.status(), await occurrence.text()).toBe(201)
		try {
			// La lectrice et le business developer ne voient pas la boîte de Camille : introuvable, et rien n'est effacé.
			for (const [nom, jeton] of [['lectrice', viewer], ['business developer', bizdev]] as const) {
				const refus = await rpc(request, jeton, 'delete_message', { p_message_id: message, p_also_mailbox: true })
				expect(refus.status(), `${nom} : ${await refus.text()}`).toBe(404)
				expect(await refus.text()).toContain('message_not_found')
			}
			// Aucune écriture directe des déplacements, même pour l'administratrice.
			const direct = await request.post(`${URL_API}/rest/v1/mail_trash_moves`, {
				headers: { ...enTetesAuthentifies(admin), 'Content-Type': 'application/json' },
				data: { workspace_id: WORKSPACE, message_id: message, account_id: boites[0]!.id, folder: 'INBOX', uid: 1 },
			})
			expect([401, 403], `écriture directe : ${await direct.text()}`).toContain(direct.status())
			// Les fonctions de mail-sync sont fermées à un jeton de personne.
			for (const [fonction, corps] of [
				['purge_mail_message', { p_message_id: message }],
				['trash_moves_to_process', { p_limit: 5 }],
				['mail_messages_to_purge', { p_limit: 5 }],
			] as const) {
				const ferme = await rpc(request, admin, fonction, corps)
				expect([401, 403, 404], `${fonction} : ${await ferme.text()}`).toContain(ferme.status())
			}

			// Camille efface, la case cochée : un déplacement par occurrence de sa boîte.
			const efface = await rpc(request, admin, 'delete_message', { p_message_id: message, p_also_mailbox: true })
			expect(efface.status(), await efface.text()).toBe(200)
			expect((await efface.json()).mailbox_moves).toBe(1)
			const lu = await request.get(`${URL_API}/rest/v1/mail_messages?select=id&id=eq.${message}`, {
				headers: enTetesAuthentifies(admin),
			})
			expect(await lu.json(), 'effacé, il n’est plus lu, même par qui l’a effacé').toEqual([])

			// La corbeille visible : Camille, oui ; Driss, qui ne l'a pas effacé et n'administre pas, non.
			const corbeille = async (jeton: string) =>
				((await (await rpc(request, jeton, 'trashed_messages', { p_workspace_id: WORKSPACE })).json()) as { message_id: string }[]).map(
					(ligne) => ligne.message_id,
				)
			expect(await corbeille(admin)).toContain(message)
			expect(await corbeille(bizdev)).not.toContain(message)

			// Restaurer : introuvable pour la lectrice ; fait par Camille, et le déplacement en attente est annulé.
			const refusRestaurer = await rpc(request, viewer, 'restore_message', { p_message_id: message })
			expect(refusRestaurer.status(), await refusRestaurer.text()).toBe(404)
			const restaure = await rpc(request, admin, 'restore_message', { p_message_id: message })
			expect(restaure.status(), await restaure.text()).toBe(200)
			expect((await restaure.json()).cancelled_moves).toBe(1)
			const etat = (await (
				await request.get(`${URL_API}/rest/v1/mail_trash_moves?select=state&message_id=eq.${message}`, { headers: enTetesService() })
			).json()) as { state: string }[]
			expect(etat.map((ligne) => ligne.state)).toEqual(['cancelled'])
		} finally {
			await request.delete(`${URL_API}/rest/v1/mail_messages?id=eq.${message}`, { headers: enTetesService() })
		}
	})
})
