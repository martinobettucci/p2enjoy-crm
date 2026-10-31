// @verifies CRM-073 (docs/BACKLOG.md) — tranche T2 : un essai de remise
// @verifies docs/SPEC-webhooks.md §5.1 (POST JSON signé, en-têtes, redirections non suivies, délai), §5.2 (le code rendu),
//           §6 (hôte refusé sans aucun appel ; motifs courts)

import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { AGENT, type OutilsRemise, type Remise, motifDe, remettre } from './remise.ts'

const REMISE: Remise = {
	delivery_id: 'd-1',
	url: 'https://recepteur.example/crm',
	event: 'card.step_changed',
	payload: { id: 'e-1', event: 'card.step_changed', data: { title: 'Refonte' } },
	secret: `whsec_${'cd'.repeat(32)}`,
	attempt: 1,
}

const outils = (requete: OutilsRemise['requete'], extra: Partial<OutilsRemise> = {}): OutilsRemise => ({
	requete,
	resoudre: async () => ['93.184.216.34'],
	autorises: new Set(),
	maintenantS: () => 1761919331,
	...extra,
})

describe('remettre', () => {
	it('envoie un POST JSON signé, sans suivre les redirections, et rend le code', async () => {
		let vu: { url: string; init: RequestInit } | undefined
		const resultat = await remettre(
			REMISE,
			outils(async (url, init) => {
				vu = { url, init: init as RequestInit }
				return new Response('ok', { status: 202 })
			}),
		)
		expect(resultat).toEqual({ statut: 202, motif: null })
		const entetes = new Headers(vu!.init.headers)
		const corps = String(vu!.init.body)
		expect(vu!.url).toBe(REMISE.url)
		expect(vu!.init.method).toBe('POST')
		expect(vu!.init.redirect).toBe('manual')
		expect(JSON.parse(corps)).toEqual(REMISE.payload)
		expect(entetes.get('content-type')).toBe('application/json')
		expect(entetes.get('user-agent')).toBe(AGENT)
		expect(entetes.get('x-p2enjoy-event')).toBe('card.step_changed')
		expect(entetes.get('x-p2enjoy-delivery')).toBe('d-1')
		const hmac = createHmac('sha256', REMISE.secret).update(`1761919331.${corps}`).digest('hex')
		expect(entetes.get('x-p2enjoy-signature')).toBe(`t=1761919331,v1=${hmac}`)
	})

	it('une redirection ou un 500 est un code comme un autre : la base décide de l’échec', async () => {
		expect(await remettre(REMISE, outils(async () => new Response(null, { status: 301 })))).toEqual({ statut: 301, motif: null })
		expect(await remettre(REMISE, outils(async () => new Response('x', { status: 500 })))).toEqual({ statut: 500, motif: null })
	})

	it('un hôte interne est refusé SANS aucun appel', async () => {
		let appels = 0
		const resultat = await remettre(
			REMISE,
			outils(async () => (appels++, new Response(null)), { resoudre: async () => ['10.0.0.5'] }),
		)
		expect(resultat).toEqual({ statut: null, motif: 'address_forbidden' })
		expect(appels).toBe(0)
	})

	it('une adresse qui n’est pas en https ne part pas', async () => {
		let appels = 0
		const resultat = await remettre({ ...REMISE, url: 'http://recepteur.example/crm' }, outils(async () => (appels++, new Response(null))))
		expect(resultat).toEqual({ statut: null, motif: 'address_forbidden' })
		expect(appels).toBe(0)
	})

	it('le délai dépassé rend `timeout` (borne injectée)', async () => {
		const lente: OutilsRemise['requete'] = (_url, init) =>
			new Promise((_ok, ko) => init?.signal?.addEventListener('abort', () => ko(init.signal?.reason)))
		expect(await remettre(REMISE, outils(lente, { delaiMs: 20 }))).toEqual({ statut: null, motif: 'timeout' })
	})

	it('le client de développement est transmis à `fetch` quand il existe', async () => {
		let client: unknown
		await remettre(REMISE, outils(async (_u, init) => ((client = init?.client), new Response(null)), { client: 'client-dev' }))
		expect(client).toBe('client-dev')
	})
})

describe('motifDe', () => {
	it.each([
		[Object.assign(new Error('x'), { name: 'TimeoutError' }), 'timeout'],
		[new TypeError('tcp connect error: Connection refused (os error 111)'), 'connection_refused'],
		[new TypeError('invalid peer certificate: UnknownIssuer'), 'tls_error'],
		[new TypeError('dns error: failed to lookup address information'), 'dns_error'],
		[new TypeError('operation timed out'), 'timeout'],
		[new TypeError('quelque chose d’autre'), 'network_error'],
	])('%s → %s', (erreur, motif) => {
		expect(motifDe(erreur)).toBe(motif)
	})
})
