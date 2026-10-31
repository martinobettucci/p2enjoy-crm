// @verifies CRM-073 (docs/BACKLOG.md) — tranche T2 : la signature d'une remise
// @verifies docs/SPEC-webhooks.md §5.1 (HMAC-SHA256 hexadécimal de « <t>.<corps> », la clé étant le secret entier)

import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { enteteSignature, signer } from './signature.ts'

const SECRET = `whsec_${'ab'.repeat(32)}`
const CORPS = '{"id":"e1","event":"card.created","data":{"title":"Équipe — été"}}'

describe('signer', () => {
	it('rend le HMAC-SHA256 que le tiers recalcule avec une autre implémentation', async () => {
		const attendu = createHmac('sha256', SECRET).update(`1761919331.${CORPS}`, 'utf8').digest('hex')
		expect(await signer(SECRET, 1761919331, CORPS)).toBe(attendu)
	})

	it('change si un seul octet du corps, l’horodatage ou le secret change', async () => {
		const reference = await signer(SECRET, 1761919331, CORPS)
		expect(await signer(SECRET, 1761919331, `${CORPS} `)).not.toBe(reference)
		expect(await signer(SECRET, 1761919332, CORPS)).not.toBe(reference)
		expect(await signer(`${SECRET}0`, 1761919331, CORPS)).not.toBe(reference)
	})
})

describe('enteteSignature', () => {
	it('a la forme `t=<horodatage>,v1=<64 chiffres hexadécimaux>`', async () => {
		expect(await enteteSignature(SECRET, 1761919331, CORPS)).toMatch(/^t=1761919331,v1=[0-9a-f]{64}$/)
	})
})
