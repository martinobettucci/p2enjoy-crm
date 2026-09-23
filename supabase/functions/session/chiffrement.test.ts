// @verifies CRM-092 (docs/BACKLOG.md) — poignée, empreinte et chiffrement du jeton LeLabs au repos
// @verifies docs/SPEC-session-sso.md §5.6 (poignée, empreinte), §5.7 (AES-GCM, clé HKDF), §13

import { describe, expect, it } from 'vitest'
import { chiffrer, cleDeChiffrement, dechiffrer, empreinteDe, tirerPoignee } from './chiffrement.ts'

describe('tirerPoignee', () => {
	it('tire 32 octets en base64url, jamais deux fois la même', () => {
		const poignees = new Set(Array.from({ length: 50 }, () => tirerPoignee()))
		expect(poignees.size).toBe(50)
		for (const p of poignees) expect(p).toMatch(/^[A-Za-z0-9_-]{43}$/)
	})
})

describe('empreinteDe', () => {
	it('rend le SHA-256 au format bytea hexadécimal de PostgreSQL', async () => {
		// SHA-256("abc"), vecteur de la FIPS 180-2.
		expect(await empreinteDe('abc')).toBe('\\xba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
	})
})

describe('chiffrer et dechiffrer', () => {
	it('font l’aller-retour, et le chiffré ne contient pas le clair', async () => {
		const cle = await cleDeChiffrement('secret-jwt-de-test-assez-long-0123456789')
		const jeton = 'eyJhbGciOiJIUzUxMiJ9.jeton-de-rafraichissement.signature'
		const enveloppe = await chiffrer(jeton, cle)
		expect(enveloppe).toMatch(/^v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]+$/)
		expect(enveloppe).not.toContain('eyJ')
		expect(await dechiffrer(enveloppe, cle)).toBe(jeton)
	})

	it('tire un vecteur neuf à chaque écriture : deux chiffrés du même texte diffèrent', async () => {
		const cle = await cleDeChiffrement('secret-jwt-de-test-assez-long-0123456789')
		expect(await chiffrer('meme-texte', cle)).not.toBe(await chiffrer('meme-texte', cle))
	})

	it('refuse un chiffré altéré d’un caractère : GCM l’authentifie', async () => {
		const cle = await cleDeChiffrement('secret-jwt-de-test-assez-long-0123456789')
		const [v, iv, c] = (await chiffrer('jeton', cle)).split('.') as [string, string, string]
		const altere = `${v}.${iv}.${c.startsWith('A') ? `B${c.slice(1)}` : `A${c.slice(1)}`}`
		expect(await dechiffrer(altere, cle)).toBeNull()
	})

	it('refuse avec une clé dérivée d’un autre secret', async () => {
		const enveloppe = await chiffrer('jeton', await cleDeChiffrement('premier-secret-0123456789abcdef'))
		expect(await dechiffrer(enveloppe, await cleDeChiffrement('second-secret-0123456789abcdef'))).toBeNull()
	})

	it.each(['', 'jeton-en-clair', 'v2.aaaaaaaaaaaaaaaa.bbbb', 'v1.court.bbbb', 'v1.aaaaaaaaaaaaaaaa'])(
		'refuse la forme inconnue « %s »',
		async (enveloppe) => {
			expect(await dechiffrer(enveloppe, await cleDeChiffrement('secret-0123456789abcdef'))).toBeNull()
		},
	)
})
