// @verifies CRM-137 (docs/BACKLOG.md) — `classification_candidates` hors interface, avec les jetons réels : l'expéditeur
//           connu d'abord, la recherche sans casse ni accents, la borne, et les refus (message illisible, anonyme)
// @verifies docs/SPEC-mail-subsystem.md §26.2, §26.5 ; docs/JOURNAL.md décisions 877 et 893 ; CLAUDE.md §10 (toute règle
//           d'accès se prouve hors interface, avec le jeton réel)
//
// CE FICHIER ÉCRIT, ET DÉFAIT : il rattache Léo Marchand — l'expéditeur du message seedé « Point d'avancement », contact de
// la seule affaire `…00c2` — à une seconde affaire, `…00c4`, par la clé de service, puis retire ce lien en `afterAll`. La
// suggestion du message, posée à son ingestion, n'en dépend pas (`docs/SPEC-contacts.md` §8.3).

import { expect, test, type APIRequestContext } from '@playwright/test'
import { URL_API, enTetesAnonymes, enTetesAuthentifies, enTetesService, jetonDe } from './jetons'

const ESPACE = '5eed0000-0000-4000-8000-000000000001'
const AFFAIRE_LEO = '5eed0000-0000-4000-8000-0000000000c2'
const AFFAIRE_AJOUTEE = '5eed0000-0000-4000-8000-0000000000c4'
const CONTACT_LEO = '5eed0000-0000-4000-8000-0000000000e1'
const MSGID_LEO = '<seed-inbox-suggere@sogexia.example>'
const MSGID_INCONNU = '<seed-inbox-non-classe@p2enjoy.test>'
const RPC = `${URL_API}/rest/v1/rpc/classification_candidates`

type Ligne = { card_id: string; title: string; path: string; known_sender: boolean }

async function idMessage(request: APIRequestContext, msgid: string): Promise<string> {
	const reponse = await request.get(
		`${URL_API}/rest/v1/mail_messages?select=id&rfc822_message_id=eq.${encodeURIComponent(msgid)}`,
		{ headers: enTetesService() },
	)
	const [ligne] = (await reponse.json()) as { id: string }[]
	expect(ligne, `le seed porte ${msgid}`).toBeDefined()
	return ligne!.id
}

async function candidates(request: APIRequestContext, jeton: string, corps: Record<string, unknown>) {
	const reponse = await request.post(RPC, { headers: enTetesAuthentifies(jeton), data: corps })
	expect(reponse.status(), JSON.stringify(corps)).toBe(200)
	return (await reponse.json()) as Ligne[]
}

test.describe.configure({ mode: 'serial' })

test.describe('classification_candidates — les affaires où classer un message', () => {
	let leo = ''
	let inconnu = ''
	let contactLeo = CONTACT_LEO

	test.beforeAll(async ({ request }) => {
		leo = await idMessage(request, MSGID_LEO)
		inconnu = await idMessage(request, MSGID_INCONNU)
		const contact = await request.get(
			`${URL_API}/rest/v1/contacts?select=id&email=eq.leo.marchand@sogexia.example`,
			{ headers: enTetesService() },
		)
		contactLeo = ((await contact.json()) as { id: string }[])[0]?.id ?? CONTACT_LEO
		const lien = await request.post(`${URL_API}/rest/v1/card_contacts`, {
			headers: { ...enTetesService(), prefer: 'return=minimal' },
			data: { workspace_id: ESPACE, card_id: AFFAIRE_AJOUTEE, contact_id: contactLeo },
		})
		expect(lien.status()).toBe(201)
	})

	test.afterAll(async ({ request }) => {
		const retrait = await request.delete(
			`${URL_API}/rest/v1/card_contacts?card_id=eq.${AFFAIRE_AJOUTEE}&contact_id=eq.${contactLeo}`,
			{ headers: enTetesService() },
		)
		expect(retrait.status()).toBe(204)
	})

	test('case cochée : les deux affaires dont Léo est le contact, et elles seules', async ({ request }) => {
		const lignes = await candidates(request, await jetonDe('admin@p2enjoy.test'), { p_message_id: leo })
		expect(lignes.map((l) => l.card_id).sort()).toEqual([AFFAIRE_AJOUTEE, AFFAIRE_LEO].sort())
		expect(lignes.every((l) => l.known_sender)).toBe(true)
		expect(lignes.find((l) => l.card_id === AFFAIRE_LEO)?.path).toContain(' › ')
	})

	test('case décochée : toutes les affaires lisibles, les connues d’abord', async ({ request }) => {
		const lignes = await candidates(request, await jetonDe('admin@p2enjoy.test'), {
			p_message_id: leo,
			p_known_sender: false,
		})
		expect(lignes.length).toBeGreaterThan(2)
		expect(lignes.slice(0, 2).every((l) => l.known_sender)).toBe(true)
		expect(lignes.slice(2).some((l) => l.known_sender)).toBe(false)
	})

	test('la recherche ignore la casse et les accents, sur le titre', async ({ request }) => {
		const lignes = await candidates(request, await jetonDe('admin@p2enjoy.test'), {
			p_message_id: leo,
			p_known_sender: false,
			p_search: 'MIGRÂTION erp',
		})
		expect(lignes.map((l) => l.card_id)).toContain(AFFAIRE_LEO)
	})

	test('un expéditeur inconnu : zéro ligne case cochée, jamais une erreur', async ({ request }) => {
		expect(await candidates(request, await jetonDe('admin@p2enjoy.test'), { p_message_id: inconnu })).toEqual([])
	})

	test('la borne : `p_limit` 1 rend une ligne', async ({ request }) => {
		const lignes = await candidates(request, await jetonDe('admin@p2enjoy.test'), {
			p_message_id: leo,
			p_known_sender: false,
			p_limit: 1,
		})
		expect(lignes).toHaveLength(1)
	})

	test('la lectrice, qui ne lit pas ce message non classé, reçoit 404 `message_not_found`', async ({ request }) => {
		const reponse = await request.post(RPC, {
			headers: enTetesAuthentifies(await jetonDe('viewer@p2enjoy.test')),
			data: { p_message_id: leo },
		})
		expect(reponse.status()).toBe(404)
		expect(JSON.stringify(await reponse.json())).toContain('message_not_found')
	})

	test('l’anonyme est refusé par le privilège', async ({ request }) => {
		const reponse = await request.post(RPC, { headers: enTetesAnonymes(), data: { p_message_id: leo } })
		expect([401, 403]).toContain(reponse.status())
	})
})
