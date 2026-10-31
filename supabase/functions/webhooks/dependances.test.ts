// @verifies CRM-073 (docs/BACKLOG.md) — tranche T2 : les dépendances réelles de la fonction `webhooks`
// @verifies docs/SPEC-webhooks.md §2 (la base par PostgREST sous la clé de service), §6 (hôtes autorisés de
//           développement), §12 (l'autorité du récepteur local lue chez lui, en développement seulement)

import { describe, expect, it } from 'vitest'
import { creerDependances, hotesAutorises } from './dependances.ts'

const ENV: Record<string, string> = {
	SUPABASE_URL: 'http://kong:8000/',
	SUPABASE_SERVICE_ROLE_KEY: 'cle-de-service',
}

describe('hotesAutorises', () => {
	it('lit une liste séparée par des virgules, en minuscules, sans vide', () => {
		expect([...hotesAutorises(' Webhook-Sink, ,autre ')]).toEqual(['webhook-sink', 'autre'])
		expect(hotesAutorises(undefined).size).toBe(0)
	})
})

describe('creerDependances', () => {
	const runtime = { resoudre: async () => [], creerClient: (a: string[]) => ({ autorites: a }) }

	it('parle à PostgREST sous la clé de service, par les trois fonctions de la base', async () => {
		const appels: { url: string; corps: unknown; auth: string | null }[] = []
		const deps = creerDependances((n) => ENV[n], runtime, async (url, init) => {
			appels.push({ url, corps: JSON.parse(String(init?.body)), auth: new Headers(init?.headers).get('authorization') })
			return new Response(url.endsWith('verify_webhook_dispatch') ? 'true' : '[]', { status: 200 })
		})
		expect(await deps.verifierAppel('abc')).toBe(true)
		expect(await deps.prendre(50)).toEqual([])
		await deps.inscrire('d-1', { statut: null, motif: 'timeout' })
		expect(appels).toEqual([
			{ url: 'http://kong:8000/rest/v1/rpc/verify_webhook_dispatch', corps: { p_secret: 'abc' }, auth: 'Bearer cle-de-service' },
			{ url: 'http://kong:8000/rest/v1/rpc/claim_webhook_deliveries', corps: { p_limit: 50 }, auth: 'Bearer cle-de-service' },
			{
				url: 'http://kong:8000/rest/v1/rpc/record_webhook_attempt',
				corps: { p_delivery: 'd-1', p_status_code: null, p_error: 'timeout' },
				auth: 'Bearer cle-de-service',
			},
		])
	})

	it('une prise refusée par la base lève, plutôt que de passer pour « rien à remettre »', async () => {
		const deps = creerDependances((n) => ENV[n], runtime, async () => new Response('{}', { status: 401 }))
		await expect(deps.prendre(50)).rejects.toThrow('claim_webhook_deliveries 401')
	})

	it('sans `WEBHOOKS_DEV_CA_URL` (production) : aucun client particulier, aucun appel de plus', async () => {
		let appels = 0
		const deps = creerDependances((n) => ENV[n], runtime, async () => (appels++, new Response('')))
		expect('client' in (await deps.outils())).toBe(false)
		expect(appels).toBe(0)
	})

	it('en développement : l’autorité lue chez le récepteur fait le client ; injoignable, on s’en passe', async () => {
		const env = { ...ENV, WEBHOOKS_DEV_CA_URL: 'http://webhook-sink:8080/ca.pem', WEBHOOKS_ALLOWED_HOSTS: 'webhook-sink' }
		const avec = creerDependances((n) => env[n as keyof typeof env], runtime, async () => new Response('-----PEM-----'))
		const outils = await avec.outils()
		expect(outils.client).toEqual({ autorites: ['-----PEM-----'] })
		expect([...outils.autorises]).toEqual(['webhook-sink'])
		const sans = creerDependances((n) => env[n as keyof typeof env], runtime, async () => {
			throw new TypeError('Connection refused')
		})
		expect('client' in (await sans.outils())).toBe(false)
	})
})
