// @verifies CRM-127 (docs/BACKLOG.md) — tranche T3 : la fonction edge `mail-connection-test`
// @verifies docs/SPEC-mail-subsystem.md §23.4 (chaque code rendu ; la base décide avant tout relais ; le journal ne
//           porte ni jeton ni identifiant de connexion), §23.3 (les refus de la base) ;
//           docs/SPEC-edge-functions.md §2 bis (aucun `204`)

import { describe, expect, it } from 'vitest'
import { type Autorisation, type DependancesTest, type Relais, traiterTestConnexion } from './handler.ts'

const ID = '5eed0000-0000-4000-8000-0000000000aa'

function dependances(autorisation: Autorisation = 'ok', relais: Relais = { cas: 'verdict', status: 'ok', error: null, checked_at: '2026-11-02T10:00:00Z' }) {
	const autorisations: [string, string, string][] = []
	const relayes: [string, string][] = []
	const journal: Record<string, unknown>[] = []
	const deps: DependancesTest = {
		autoriser: async (jeton, cible, id) => (autorisations.push([jeton, cible, id]), autorisation),
		relayer: async (cible, id) => (relayes.push([cible, id]), relais),
		journal: (ligne) => void journal.push(ligne),
		maintenant: () => 1000,
	}
	return { deps, autorisations, relayes, journal }
}

const appel = (corps: unknown = { target: 'inbound', id: ID }, options: { methode?: string; jeton?: string | null } = {}) =>
	new Request('http://functions:9000/mail-connection-test', {
		method: options.methode ?? 'POST',
		headers: options.jeton === null ? {} : { authorization: `Bearer ${options.jeton ?? 'jeton-de-camille'}` },
		body: (options.methode ?? 'POST') === 'POST' ? (typeof corps === 'string' ? corps : JSON.stringify(corps)) : undefined,
	})

describe('mail-connection-test — la forme de la requête (§23.4, point 1 et 2)', () => {
	it('refuse une autre méthode que POST par 405', async () => {
		const { deps, autorisations } = dependances()
		expect((await traiterTestConnexion(appel(undefined, { methode: 'GET' }), deps)).status).toBe(405)
		expect(autorisations).toEqual([])
	})

	it('rend 401 sans jeton, avant toute lecture de la base', async () => {
		const { deps, autorisations } = dependances()
		const reponse = await traiterTestConnexion(appel(undefined, { jeton: null }), deps)
		expect(reponse.status).toBe(401)
		expect(await reponse.json()).toEqual({ error: 'unauthorized' })
		expect(autorisations).toEqual([])
	})

	it.each([
		['un corps illisible', '{pas du json'],
		['une cible inconnue', { target: 'carrier-pigeon', id: ID }],
		['un identifiant qui n’est pas un UUID', { target: 'outbound', id: '42' }],
		['un corps sans cible', { id: ID }],
	])('rend 400 invalid_request pour %s, sans appeler la base', async (_cas, corps) => {
		const { deps, autorisations } = dependances()
		const reponse = await traiterTestConnexion(appel(corps), deps)
		expect(reponse.status).toBe(400)
		expect(await reponse.json()).toEqual({ error: 'invalid_request' })
		expect(autorisations).toEqual([])
	})
})

describe('mail-connection-test — la base décide avant le relais (§23.4, point 3)', () => {
	it('transmet le jeton de l’appelant, la cible et l’identifiant à la base', async () => {
		const { deps, autorisations } = dependances()
		await traiterTestConnexion(appel({ target: 'outbound', id: ID }, { jeton: 'jeton-de-driss' }), deps)
		expect(autorisations).toEqual([['jeton-de-driss', 'outbound', ID]])
	})

	it.each([
		['not_authenticated', 401, 'unauthorized'],
		['invalid_target', 400, 'invalid_request'],
		['not_found', 404, 'not_found'],
		['disabled', 409, 'disabled'],
		['too_soon', 429, 'too_soon'],
		['indisponible', 502, 'service_unavailable'],
	] as const)('le refus %s rend %i %s, et le service n’est jamais appelé', async (refus, statut, erreur) => {
		const { deps, relayes } = dependances(refus)
		const reponse = await traiterTestConnexion(appel(), deps)
		expect(reponse.status).toBe(statut)
		expect(await reponse.json()).toEqual({ error: erreur })
		expect(relayes).toEqual([])
	})
})

describe('mail-connection-test — le relais (§23.4, point 4)', () => {
	it('rend le verdict tel que le service l’a écrit', async () => {
		const { deps, relayes } = dependances('ok', { cas: 'verdict', status: 'error', error: 'auth_failed', checked_at: '2026-11-02T10:00:01Z' })
		const reponse = await traiterTestConnexion(appel({ target: 'outbound', id: ID }), deps)
		expect(reponse.status).toBe(200)
		expect(await reponse.json()).toEqual({ status: 'error', error: 'auth_failed', checked_at: '2026-11-02T10:00:01Z' })
		expect(relayes).toEqual([['outbound', ID]])
	})

	it.each([
		[{ cas: 'not_found' }, 404, 'not_found'],
		[{ cas: 'secret_missing' }, 409, 'secret_missing'],
		[{ cas: 'indisponible' }, 502, 'service_unavailable'],
	] as const)('le cas %j rend %i %s', async (relais, statut, erreur) => {
		const { deps } = dependances('ok', relais)
		const reponse = await traiterTestConnexion(appel(), deps)
		expect(reponse.status).toBe(statut)
		expect(await reponse.json()).toEqual({ error: erreur })
	})
})

describe('mail-connection-test — le journal (§23.4, point 5)', () => {
	it('écrit une ligne par appel, sans le jeton de l’appelant ni l’identifiant de la ligne', async () => {
		const { deps, journal } = dependances()
		await traiterTestConnexion(appel(undefined, { jeton: 'jeton-secret-de-camille' }), deps)
		expect(journal).toEqual([{ fonction: 'mail-connection-test', target: 'inbound', statut: 200, duree_ms: 0 }])
		expect(JSON.stringify(journal)).not.toContain('jeton-secret-de-camille')
	})

	it('journalise aussi un refus de forme, sans cible connue', async () => {
		const { deps, journal } = dependances()
		await traiterTestConnexion(appel(undefined, { jeton: null }), deps)
		expect(journal).toEqual([{ fonction: 'mail-connection-test', target: null, statut: 401, duree_ms: 0 }])
	})
})
