// @verifies CRM-156 (docs/BACKLOG.md) — tranche T2 : le transfert d'un mail et le blocage d'un expéditeur par l'API réelle,
//           sous les jetons réels des trois profils du seed — la lecture ouverte par le transfert et refermée par son
//           retrait, le retrait réservé à l'auteur et au destinataire, la lectrice qui ne transfère pas, le blocage réservé
//           à l'administratrice, l'écriture directe fermée
// @verifies docs/SPEC-mail-subsystem.md §32.7, §32.8 ; docs/JOURNAL.md décisions 945 et 947 ; CLAUDE.md §10 (toute règle
//           d'accès se prouve hors interface)
//
// La preuve pose son message sous la clé de service, non classé, dans la boîte de Camille (l'administratrice), que Driss
// (business developer) et Farida (lectrice) ne lisent pas, et le retire à la fin avec ce qu'il a entraîné. Elle bloque une
// adresse propre à l'exécution, sans aucun mail : rien du seed ne part en corbeille.

import { expect, test, type APIRequestContext } from '@playwright/test'
import { URL_API, enTetesAuthentifies, enTetesService, jetonDe } from './jetons'

const WORKSPACE = '5eed0000-0000-4000-8000-000000000001'
const CAMILLE = '5eed0000-0000-4000-8000-000000000011'
const DRISS = '5eed0000-0000-4000-8000-000000000012'
const FARIDA = '5eed0000-0000-4000-8000-000000000013'

async function rpc(request: APIRequestContext, jeton: string, fonction: string, corps: Record<string, unknown>) {
	return request.post(`${URL_API}/rest/v1/rpc/${fonction}`, {
		headers: { ...enTetesAuthentifies(jeton), 'Content-Type': 'application/json' },
		data: corps,
	})
}

test.describe('le transfert et le blocage — décidés par la base (CRM-156, §32.7, §32.8)', () => {
	test('le transfert ouvre la lecture au seul destinataire, et seuls l’auteur et lui le retirent', async ({ request }) => {
		const [admin, bizdev, viewer] = await Promise.all([
			jetonDe('admin@p2enjoy.test'),
			jetonDe('bizdev@p2enjoy.test'),
			jetonDe('viewer@p2enjoy.test'),
		])
		const boites = (await (
			await request.get(`${URL_API}/rest/v1/mail_inbound_accounts?select=id&owner_id=eq.${CAMILLE}&limit=1`, {
				headers: enTetesService(),
			})
		).json()) as { id: string }[]
		const pose = await request.post(`${URL_API}/rest/v1/mail_messages?select=id`, {
			headers: { ...enTetesService(), Prefer: 'return=representation' },
			data: {
				workspace_id: WORKSPACE,
				rfc822_message_id: `<crm156-t2-api-${Date.now()}@exemple.test>`,
				classification: 'unclassified',
				direction: 'inbound',
				from_address: 'tiers@exemple.test',
				to_addresses: ['admin@p2enjoy.test'],
				subject: 'Preuve API CRM-156 T2',
				received_at: new Date().toISOString(),
			},
		})
		expect(pose.status(), await pose.text()).toBe(201)
		const message = ((await pose.json()) as { id: string }[])[0]!.id
		const occurrence = await request.post(`${URL_API}/rest/v1/mail_message_occurrences`, {
			headers: enTetesService(),
			data: { message_id: message, account_id: boites[0]!.id, folder: 'INBOX', uid: 156_900 + (Date.now() % 100) },
		})
		expect(occurrence.status(), await occurrence.text()).toBe(201)
		const lit = async (jeton: string) =>
			((await (await request.get(`${URL_API}/rest/v1/mail_messages?select=id&id=eq.${message}`, {
				headers: enTetesAuthentifies(jeton),
			})).json()) as unknown[]).length

		try {
			expect(await lit(bizdev), 'avant le transfert, Driss ne lit pas le mail').toBe(0)

			// Aucune écriture directe : la table ne s'écrit que par les fonctions.
			const direct = await request.post(`${URL_API}/rest/v1/mail_message_transfers`, {
				headers: { ...enTetesAuthentifies(admin), 'Content-Type': 'application/json' },
				data: { message_id: message, recipient_id: DRISS, workspace_id: WORKSPACE },
			})
			expect([401, 403], `écriture directe : ${await direct.text()}`).toContain(direct.status())

			// Driss ne transfère pas ce qu'il ne voit pas : introuvable.
			const aveugle = await rpc(request, bizdev, 'transfer_message', { p_message_id: message, p_recipient_id: FARIDA })
			expect(aveugle.status(), await aveugle.text()).toBe(404)

			// Camille transfère à Driss : il le lit, et sa notification existe.
			const transfert = await rpc(request, admin, 'transfer_message', { p_message_id: message, p_recipient_id: DRISS })
			expect(transfert.status(), await transfert.text()).toBe(200)
			expect(await transfert.json()).toBe(true)
			expect(await lit(bizdev), 'après le transfert, Driss lit le mail').toBe(1)
			expect(await lit(viewer), 'la lectrice, non').toBe(0)
			const notifications = (await (
				await request.get(
					`${URL_API}/rest/v1/notifications?select=type,payload&type=eq.mail_transfer&payload->>message_id=eq.${message}`,
					{ headers: enTetesAuthentifies(bizdev) },
				)
			).json()) as { payload: { count: number; author_id: string } }[]
			expect(notifications).toHaveLength(1)
			expect(notifications[0]!.payload).toMatchObject({ count: 1, author_id: CAMILLE })

			// La lectrice ne transfère pas ; transférée, elle lit, mais ne retire pas le transfert d'un autre.
			const versLectrice = await rpc(request, admin, 'transfer_message', { p_message_id: message, p_recipient_id: FARIDA })
			expect(versLectrice.status(), await versLectrice.text()).toBe(200)
			const lectriceTransfere = await rpc(request, viewer, 'transfer_message', { p_message_id: message, p_recipient_id: DRISS })
			expect(lectriceTransfere.status(), await lectriceTransfere.text()).toBe(403)
			const lectriceRetire = await rpc(request, viewer, 'remove_message_transfer', { p_message_id: message, p_recipient_id: DRISS })
			expect(lectriceRetire.status(), await lectriceRetire.text()).toBe(403)

			// L'auteur retire le transfert vers Driss : sa lecture se referme, celle de la lectrice reste.
			const retrait = await rpc(request, admin, 'remove_message_transfer', { p_message_id: message, p_recipient_id: DRISS })
			expect(retrait.status(), await retrait.text()).toBe(200)
			expect(await lit(bizdev)).toBe(0)
			expect(await lit(viewer)).toBe(1)
			// La destinataire retire le sien.
			const sonRetrait = await rpc(request, viewer, 'remove_message_transfer', { p_message_id: message, p_recipient_id: FARIDA })
			expect(sonRetrait.status(), await sonRetrait.text()).toBe(200)
			expect(await lit(viewer)).toBe(0)
		} finally {
			await request.delete(`${URL_API}/rest/v1/notifications?type=eq.mail_transfer&payload->>message_id=eq.${message}`, {
				headers: enTetesService(),
			})
			await request.delete(`${URL_API}/rest/v1/mail_messages?id=eq.${message}`, { headers: enTetesService() })
		}
	})

	test('seule l’administratrice bloque et débloque un expéditeur', async ({ request }) => {
		const [admin, bizdev] = await Promise.all([jetonDe('admin@p2enjoy.test'), jetonDe('bizdev@p2enjoy.test')])
		const adresse = `crm156-bloque-${Date.now()}@exemple.test`
		try {
			for (const fonction of ['blocked_sender_impact', 'block_sender', 'unblock_sender']) {
				const refus = await rpc(request, bizdev, fonction, { p_workspace_id: WORKSPACE, p_address: adresse })
				expect(refus.status(), `${fonction} : ${await refus.text()}`).toBe(403)
			}
			const direct = await request.post(`${URL_API}/rest/v1/mail_blocked_senders`, {
				headers: { ...enTetesAuthentifies(admin), 'Content-Type': 'application/json' },
				data: { workspace_id: WORKSPACE, address: adresse },
			})
			expect([401, 403], `écriture directe : ${await direct.text()}`).toContain(direct.status())

			const effet = await rpc(request, admin, 'blocked_sender_impact', { p_workspace_id: WORKSPACE, p_address: adresse })
			expect(await effet.json()).toBe(0)
			const bloque = await rpc(request, admin, 'block_sender', { p_workspace_id: WORKSPACE, p_address: adresse.toUpperCase() })
			expect(bloque.status(), await bloque.text()).toBe(200)
			expect(await bloque.json()).toMatchObject({ address: adresse, trashed: 0 })
			// La liste se lit par tout membre, la lectrice comprise.
			const liste = (await (
				await request.get(`${URL_API}/rest/v1/mail_blocked_senders?select=address,blocked_by&address=eq.${adresse}`, {
					headers: enTetesAuthentifies(bizdev),
				})
			).json()) as { address: string; blocked_by: string }[]
			expect(liste).toEqual([{ address: adresse, blocked_by: CAMILLE }])
			const debloque = await rpc(request, admin, 'unblock_sender', { p_workspace_id: WORKSPACE, p_address: adresse })
			expect(await debloque.json()).toBe(true)
		} finally {
			await request.delete(`${URL_API}/rest/v1/mail_blocked_senders?address=eq.${adresse}`, { headers: enTetesService() })
		}
	})
})
