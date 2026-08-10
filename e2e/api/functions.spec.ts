// @verifies CRM-016 (docs/BACKLOG.md) — appel réel d'une fonction edge par Kong
// @verifies docs/SPEC-edge-functions.md §5 (clé d'API), §6 (exemple), §7.2 (preuves API)

import { expect, test } from '@playwright/test'
import { cleAnonyme } from '../env'

const EXAMPLE = '/functions/v1/example'
const HEADERS = { apikey: cleAnonyme() }
const EXPECTED = {
	function: 'example',
	runtime: 'edge-runtime',
	message: 'Fonction edge opérationnelle',
}

test.describe('CRM-016 — fonctions edge par la vraie passerelle', () => {
	test('une requête sans clé est refusée avant le runtime', async ({ request }) => {
		const response = await request.post(EXAMPLE)
		expect(response.status()).toBe(401)
		expect(await response.text()).toContain('No API key found in request')
	})

	test('une fausse clé est refusée avant le runtime', async ({ request }) => {
		const response = await request.post(EXAMPLE, { headers: { apikey: 'cle-invalide' } })
		expect(response.status()).toBe(401)
	})

	test('la clé anonyme appelle le vrai worker et reçoit le contrat exact', async ({ request }) => {
		const response = await request.post(EXAMPLE, { headers: HEADERS, data: { ignored: true } })
		expect(response.status()).toBe(200)
		expect(response.headers()['content-type']).toBe('application/json; charset=utf-8')
		expect(response.headers()['x-request-id']).toMatch(/^[0-9a-f-]{36}$/)
		expect(await response.json()).toEqual(EXPECTED)
	})

	test('une méthode non admise rend 405 et Allow', async ({ request }) => {
		const response = await request.get(EXAMPLE, { headers: HEADERS })
		expect(response.status()).toBe(405)
		expect(response.headers()['allow']).toBe('POST, OPTIONS')
		expect(await response.json()).toEqual({ error: 'method_not_allowed' })
	})

	test('une fonction inconnue rend un 404 générique et corrélé', async ({ request }) => {
		const response = await request.post('/functions/v1/inconnue', { headers: HEADERS })
		expect(response.status()).toBe(404)
		const requestId = response.headers()['x-request-id']
		expect(requestId).toMatch(/^[0-9a-f-]{36}$/)
		expect(await response.json()).toEqual({ error: 'function_not_found', request_id: requestId })
	})

	test('le preflight CORS autorise POST et les en-têtes du client', async ({ request }) => {
		const response = await request.fetch(EXAMPLE, {
			method: 'OPTIONS',
			headers: {
				...HEADERS,
				origin: 'http://localhost:5173',
				'access-control-request-method': 'POST',
				'access-control-request-headers': 'apikey,authorization,content-type',
			},
		})
		expect([200, 204]).toContain(response.status())
		expect(response.headers()['access-control-allow-origin']).toBe('*')
		expect(response.headers()['access-control-allow-methods']).toContain('POST')
	})
})
