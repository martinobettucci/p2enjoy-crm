// @verifies CRM-073 (docs/BACKLOG.md) — tranche T2 : aucune adresse interne
// @verifies docs/SPEC-webhooks.md §6 (bouclage, privées, lien local, pile, métadonnées de nuage refusées ; un nom résolu
//           vers une seule adresse interne est refusé ; hôtes autorisés en développement)

import { describe, expect, it } from 'vitest'
import { adresseInterdite, verifierHote } from './adresse.ts'

describe('adresseInterdite', () => {
	it.each([
		'127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0',
		'224.0.0.1', '255.255.255.255', '198.18.0.1', '192.0.0.8', '::1', '::', 'fe80::1', 'fd00::1', 'fc12:3456::1',
		'::ffff:127.0.0.1', '::ffff:10.0.0.1', '64:ff9b::a00:1', 'ff02::1', '2001:db8::1', 'pas-une-adresse', '1.2.3',
	])('refuse %s', (ip) => {
		expect(adresseInterdite(ip)).toBe(true)
	})

	it.each(['8.8.8.8', '93.184.216.34', '172.15.0.1', '172.32.0.1', '100.63.0.1', '2606:4700::1111', '::ffff:8.8.8.8'])(
		'accepte %s, adresse publique',
		(ip) => {
			expect(adresseInterdite(ip)).toBe(false)
		},
	)
})

describe('verifierHote', () => {
	const dns = (table: Record<string, Partial<Record<'A' | 'AAAA', string[]>>>) => async (hote: string, type: 'A' | 'AAAA') => {
		const r = table[hote]?.[type]
		if (!r) throw new Error('NotFound')
		return r
	}
	const aucun = new Set<string>()

	it('un nom public passe', async () => {
		expect(await verifierHote('recepteur.example', dns({ 'recepteur.example': { A: ['93.184.216.34'] } }), aucun)).toBe('ok')
	})

	it('un nom qui pointe aussi dedans est refusé (une seule adresse interne suffit)', async () => {
		const resoudre = dns({ 'double.example': { A: ['93.184.216.34'], AAAA: ['::1'] } })
		expect(await verifierHote('double.example', resoudre, aucun)).toBe('address_forbidden')
	})

	it('un service de la pile se résout en adresse privée : refusé', async () => {
		expect(await verifierHote('kong', dns({ kong: { A: ['172.20.0.14'] } }), aucun)).toBe('address_forbidden')
	})

	it('une adresse littérale est jugée sans résolution ; `localhost` est refusé sans résolution', async () => {
		const jamais = async () => {
			throw new Error('ne doit pas résoudre')
		}
		expect(await verifierHote('169.254.169.254', jamais, aucun)).toBe('address_forbidden')
		expect(await verifierHote('[::1]', jamais, aucun)).toBe('address_forbidden')
		expect(await verifierHote('8.8.8.8', jamais, aucun)).toBe('ok')
		expect(await verifierHote('LocalHost', jamais, aucun)).toBe('address_forbidden')
	})

	it('un nom sans aucun enregistrement : `dns_error`', async () => {
		expect(await verifierHote('inconnu.example', dns({}), aucun)).toBe('dns_error')
	})

	it('un hôte autorisé (développement) passe malgré son adresse privée, sans résolution', async () => {
		expect(await verifierHote('webhook-sink', dns({}), new Set(['webhook-sink']))).toBe('ok')
	})
})
