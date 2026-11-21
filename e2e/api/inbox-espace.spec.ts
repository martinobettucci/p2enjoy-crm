// @verifies CRM-161 (docs/BACKLOG.md) — tranche T1 : l'inbox d'un espace par l'API réelle, sous les jetons réels — un appel
//           sans espace ne se résout plus (l'ancienne signature est supprimée), un espace nul est refusé
//           (`workspace_required`), la liste et l'arborescence d'un espace ne rendent que lui pour une personne membre de
//           deux espaces, les non-lus sont comptés par espace, un non-membre ne lit rien
// @verifies docs/SPEC-mail-subsystem.md §35.2, §35.4, §35.8 ; docs/SPEC-espace-courant.md §7.1, §13 ; docs/JOURNAL.md
//           décisions 965 et 967 ; CLAUDE.md §10 (toute règle se prouve hors interface)
//
// La preuve pose, sous la clé de service, un espace jetable (« Sonde 161 API ») dont Camille, administratrice de l'espace du
// seed, est aussi administratrice, sa boîte système et un mail non classé non lu ; elle supprime l'espace à la fin, et la
// suppression emporte, en cascade, tout ce qu'elle a posé. Aucune donnée du seed n'est modifiée.

import { expect, test, type APIRequestContext } from '@playwright/test'
import { URL_API, enTetesAuthentifies, enTetesService, jetonDe } from './jetons'

const SEED = '5eed0000-0000-4000-8000-000000000001'
const SONDE = 'e1610000-0000-4000-8000-0000000000a1'
const CAMILLE = '5eed0000-0000-4000-8000-000000000011'
const RFC = '<api-161@sonde-161-api.test>'
const rest = (chemin: string) => `${URL_API}/rest/v1/${chemin}`
const JSON_SERVICE = () => ({ ...enTetesService(), 'Content-Type': 'application/json', Prefer: 'return=representation' })

async function rpc(request: APIRequestContext, jeton: string, fonction: string, corps: Record<string, unknown>) {
	return request.post(rest(`rpc/${fonction}`), {
		headers: { ...enTetesAuthentifies(jeton), 'Content-Type': 'application/json' },
		data: corps,
	})
}

async function retirer(request: APIRequestContext): Promise<void> {
	const reponse = await request.delete(rest(`workspaces?id=eq.${SONDE}`), { headers: enTetesService() })
	expect(reponse.status(), await reponse.text()).toBeLessThan(300)
}

async function monter(request: APIRequestContext): Promise<string> {
	await retirer(request)
	const espace = await request.post(rest('workspaces'), {
		headers: JSON_SERVICE(),
		data: { id: SONDE, name: 'Sonde 161 API', slug: 'sonde-161-api' },
	})
	expect(espace.status(), await espace.text()).toBe(201)
	const membre = await request.post(rest('workspace_members'), {
		headers: JSON_SERVICE(),
		data: { workspace_id: SONDE, user_id: CAMILLE, role: 'admin' },
	})
	expect(membre.status(), await membre.text()).toBe(201)
	const boite = await request.post(rest('mail_inbound_accounts?select=id'), {
		headers: JSON_SERVICE(),
		data: {
			workspace_id: SONDE,
			owner_id: null,
			label: 'Boîte système sonde 161 API',
			imap_host: 'imap.sonde-161-api.test',
			imap_port: 143,
			imap_username: 'systeme@sonde-161-api.test',
		},
	})
	expect(boite.status(), await boite.text()).toBe(201)
	const message = await request.post(rest('mail_messages?select=id'), {
		headers: JSON_SERVICE(),
		data: {
			workspace_id: SONDE,
			rfc822_message_id: RFC,
			classification: 'unclassified',
			direction: 'inbound',
			from_address: 'tiers161@exemple.test',
			to_addresses: ['systeme@sonde-161-api.test'],
			subject: 'Preuve API CRM-161',
			received_at: new Date().toISOString(),
		},
	})
	expect(message.status(), await message.text()).toBe(201)
	const idMessage = ((await message.json()) as { id: string }[])[0]!.id
	const occurrence = await request.post(rest('mail_message_occurrences'), {
		headers: JSON_SERVICE(),
		data: {
			message_id: idMessage,
			account_id: ((await boite.json()) as { id: string }[])[0]!.id,
			folder: 'INBOX',
			uid: 161_001,
		},
	})
	expect(occurrence.status(), await occurrence.text()).toBe(201)
	return idMessage
}

test.describe('l’inbox d’un espace — décidée par la base (CRM-161, §35)', () => {
	test.afterEach(async ({ request }) => {
		await retirer(request)
	})

	test('sans espace, rien ne se lit ; avec un espace, rien d’un autre ; les non-lus par espace ; un non-membre ne lit rien', async ({
		request,
	}) => {
		const idMessage = await monter(request)
		const [camille, driss] = await Promise.all([jetonDe('admin@p2enjoy.test'), jetonDe('bizdev@p2enjoy.test')])

		// L'ancienne signature n'existe plus : un appel sans espace ne se résout pas (PGRST202), il ne lit pas tout.
		const sansEspace = await rpc(request, camille, 'inbox_messages', { p_limit: 200 })
		expect(sansEspace.status()).toBe(404)
		expect(((await sansEspace.json()) as { code: string }).code).toBe('PGRST202')
		const arbreSansEspace = await rpc(request, camille, 'inbox_arborescence', {})
		expect(arbreSansEspace.status()).toBe(404)

		// Un espace nul est refusé, nommé.
		const espaceNul = await rpc(request, camille, 'inbox_messages', { p_workspace_id: null })
		expect(espaceNul.status()).toBe(400)
		expect(((await espaceNul.json()) as { message: string }).message).toBe('workspace_required')

		// La liste de chaque espace ne rend que lui.
		const listeSonde = (await (await rpc(request, camille, 'inbox_messages', { p_workspace_id: SONDE, p_limit: 200 })).json()) as {
			id: string
			workspace_id: string
		}[]
		expect(listeSonde.map((m) => m.id)).toEqual([idMessage])
		const listeSeed = (await (await rpc(request, camille, 'inbox_messages', { p_workspace_id: SEED, p_limit: 200 })).json()) as {
			id: string
			workspace_id: string
		}[]
		expect(listeSeed.length, 'témoin : l’espace du seed a ses non classés').toBeGreaterThan(0)
		expect(listeSeed.some((m) => m.id === idMessage)).toBe(false)
		expect(listeSeed.every((m) => m.workspace_id === SEED)).toBe(true)

		// L'arborescence de l'espace jetable : « Non classés », un mail, non lu.
		const arbre = (await (await rpc(request, camille, 'inbox_arborescence', { p_workspace_id: SONDE })).json()) as {
			card_id: string | null
			nombre: number
			unread_count: number
		}[]
		expect(arbre).toEqual([expect.objectContaining({ card_id: null, nombre: 1, unread_count: 1 })])

		// Les non-lus de chaque espace de Camille, l'un et l'autre.
		const nonLus = (await (await rpc(request, camille, 'inbox_unread_by_workspace', {})).json()) as {
			workspace_id: string
			unread_count: number
		}[]
		expect(nonLus).toContainEqual({ workspace_id: SONDE, unread_count: 1 })
		expect(nonLus.some((l) => l.workspace_id === SEED)).toBe(true)

		// Driss n'est pas membre de l'espace jetable : il n'y lit rien, sans erreur, et ne le compte pas.
		const listeDriss = await rpc(request, driss, 'inbox_messages', { p_workspace_id: SONDE })
		expect(listeDriss.status()).toBe(200)
		expect(await listeDriss.json()).toEqual([])
		const nonLusDriss = (await (await rpc(request, driss, 'inbox_unread_by_workspace', {})).json()) as {
			workspace_id: string
		}[]
		expect(nonLusDriss.some((l) => l.workspace_id === SONDE)).toBe(false)
	})
})
