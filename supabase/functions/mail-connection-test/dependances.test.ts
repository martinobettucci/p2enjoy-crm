// @verifies CRM-127 (docs/BACKLOG.md) — tranche T3 : les dépendances réelles de `mail-connection-test`
// @verifies docs/SPEC-mail-subsystem.md §23.3 (le refus de la base lu sur son mot, jamais deviné), §23.4 (le jeton de
//           l'appelant vers PostgREST, le jeton interne vers le seul `mail-sync`, chaque réponse du service ramenée à un
//           cas, un service injoignable rendu indisponible)

import { describe, expect, it } from 'vitest'
import { creerDependances, lireAutorisation, lireRelais } from './dependances.ts'

const ID = '5eed0000-0000-4000-8000-0000000000aa'

const ENV: Record<string, string> = {
	SUPABASE_URL: 'http://kong:8000/',
	SUPABASE_ANON_KEY: 'cle-anonyme',
	MAIL_SYNC_URL: 'http://mail-sync:8080',
	MAIL_SYNC_INTERNAL_TOKEN: 'jeton-interne',
}

const repondre = (statut: number, corps?: unknown) =>
	new Response(corps === undefined ? null : JSON.stringify(corps), { status: statut })

describe('lireAutorisation — le mot de la base (§23.3)', () => {
	it('rend ok sur une réponse réussie', async () => {
		expect(await lireAutorisation(repondre(204))).toBe('ok')
	})

	it.each(['not_authenticated', 'invalid_target', 'not_found', 'disabled', 'too_soon'])(
		'rend %s quand la base le dit, quel que soit le code HTTP choisi par PostgREST',
		async (mot) => {
			expect(await lireAutorisation(repondre(400, { code: 'P0001', message: mot }))).toBe(mot)
		},
	)

	it('rend not_authenticated pour un refus d’exécution, celui d’un appelant anonyme', async () => {
		expect(await lireAutorisation(repondre(401, { code: '42501', message: 'permission denied for function authorize_mail_connection_test' }))).toBe(
			'not_authenticated',
		)
	})

	it('rend indisponible pour un message inconnu ou un corps illisible', async () => {
		expect(await lireAutorisation(repondre(500, { code: 'XX000', message: 'boom' }))).toBe('indisponible')
		expect(await lireAutorisation(new Response('<html>', { status: 502 }))).toBe('indisponible')
	})
})

describe('lireRelais — la réponse du service (§23.4, point 4)', () => {
	it('rend le verdict', async () => {
		const corps = { account_id: ID, status: 'ok', error: null, folders: 3, checked_at: '2026-11-02T10:00:00Z' }
		expect(await lireRelais(repondre(200, corps))).toEqual({ cas: 'verdict', status: 'ok', error: null, checked_at: '2026-11-02T10:00:00Z' })
	})

	it.each([
		[404, 'not_found'],
		[409, 'secret_missing'],
		[401, 'indisponible'],
		[502, 'indisponible'],
	] as const)('ramène %i au cas %s', async (statut, cas) => {
		expect(await lireRelais(repondre(statut, { detail: 'x' }))).toEqual({ cas })
	})

	it('rend indisponible pour un 200 dont la forme n’est pas celle du verdict', async () => {
		expect(await lireRelais(repondre(200, { status: 'ok' }))).toEqual({ cas: 'indisponible' })
	})
})

describe('creerDependances — qui porte quel jeton', () => {
	it('appelle la base avec le jeton de l’appelant et la clé anonyme, jamais le jeton interne', async () => {
		const appels: [string, RequestInit][] = []
		const deps = creerDependances((nom) => ENV[nom], async (url, init) => (appels.push([url, init]), repondre(204)))
		expect(await deps.autoriser('jeton-de-camille', 'inbound', ID)).toBe('ok')
		const [url, init] = appels[0]!
		expect(url).toBe('http://kong:8000/rest/v1/rpc/authorize_mail_connection_test')
		expect(init.headers).toMatchObject({ apikey: 'cle-anonyme', authorization: 'Bearer jeton-de-camille' })
		expect(JSON.parse(String(init.body))).toEqual({ p_target: 'inbound', p_id: ID })
		expect(JSON.stringify(init)).not.toContain('jeton-interne')
	})

	it.each([
		['inbound', 'http://mail-sync:8080/internal/v1/inbound-accounts/'],
		['outbound', 'http://mail-sync:8080/internal/v1/outbound-identities/'],
	] as const)('relaie la cible %s vers sa route, avec le jeton interne', async (cible, prefixe) => {
		const appels: [string, RequestInit][] = []
		const deps = creerDependances(
			(nom) => ENV[nom],
			async (url, init) => (appels.push([url, init]), repondre(200, { status: 'ok', error: null, checked_at: 't' })),
		)
		await deps.relayer(cible, ID)
		expect(appels[0]![0]).toBe(`${prefixe}${ID}/test`)
		expect(appels[0]![1].headers).toMatchObject({ authorization: 'Bearer jeton-interne' })
	})

	it('rend indisponible quand le service ne répond pas, ou que sa configuration manque', async () => {
		const injoignable = creerDependances((nom) => ENV[nom], async () => {
			throw new TypeError('connection refused')
		})
		expect(await injoignable.relayer('inbound', ID)).toEqual({ cas: 'indisponible' })
		let appele = false
		const sansJeton = creerDependances(
			(nom) => (nom === 'MAIL_SYNC_INTERNAL_TOKEN' ? undefined : ENV[nom]),
			async () => ((appele = true), repondre(200)),
		)
		expect(await sansJeton.relayer('inbound', ID)).toEqual({ cas: 'indisponible' })
		expect(appele).toBe(false)
	})

	it('rend indisponible quand la base ne répond pas', async () => {
		const deps = creerDependances((nom) => ENV[nom], async () => {
			throw new TypeError('connection refused')
		})
		expect(await deps.autoriser('jeton', 'inbound', ID)).toBe('indisponible')
	})
})
