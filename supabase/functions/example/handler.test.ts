// @verifies CRM-016 (docs/BACKLOG.md) — preuve unitaire de la fonction edge d'exemple
// @verifies docs/SPEC-edge-functions.md §6, §7.1

import { describe, expect, it } from 'vitest'
import { handleExampleRequest } from './handler.ts'

describe('handleExampleRequest', () => {
	it('rend le contrat JSON exact sur POST sans refléter le corps entrant', async () => {
		const response = await handleExampleRequest(new Request('http://edge/example', {
			method: 'POST',
			body: 'secret-qui-ne-doit-pas-sortir',
		}))
		expect(response.status).toBe(200)
		expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8')
		expect(await response.json()).toEqual({
			function: 'example',
			runtime: 'edge-runtime',
			message: 'Fonction edge opérationnelle',
		})
	})

	it('répond sans corps au préflight', async () => {
		const response = await handleExampleRequest(new Request('http://edge/example', { method: 'OPTIONS' }))
		expect(response.status).toBe(204)
		expect(response.headers.get('allow')).toBe('POST, OPTIONS')
		expect(await response.text()).toBe('')
	})

	it('refuse les autres méthodes avec le contrat Allow exact', async () => {
		const response = await handleExampleRequest(new Request('http://edge/example'))
		expect(response.status).toBe(405)
		expect(response.headers.get('allow')).toBe('POST, OPTIONS')
		expect(await response.json()).toEqual({ error: 'method_not_allowed' })
	})
})
