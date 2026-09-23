// @verifies CRM-092 (docs/BACKLOG.md) — lecture, vérification et signature des jetons de l'échangeur
// @verifies docs/SPEC-session-sso.md §5.2 (points 1, 2, 4, 5), §5.3 (jeton interne HS256), §13

import { describe, expect, it } from 'vitest'
import {
	algorithmeAccepte,
	cleCompatible,
	decoderBase64url,
	encoderBase64url,
	lireJws,
	signerHs256,
	verifierSignature,
} from './jws.ts'

const texte = (valeur: unknown) => encoderBase64url(new TextEncoder().encode(JSON.stringify(valeur)))

async function paireRsa() {
	const paire = (await crypto.subtle.generateKey(
		{ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
		true,
		['sign', 'verify'],
	)) as CryptoKeyPair
	return { prive: paire.privateKey, publique: (await crypto.subtle.exportKey('jwk', paire.publicKey)) as Record<string, unknown> }
}

async function paireEc() {
	const paire = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair
	return { prive: paire.privateKey, publique: (await crypto.subtle.exportKey('jwk', paire.publicKey)) as Record<string, unknown> }
}

describe('base64url', () => {
	it('fait l’aller-retour sans remplissage', () => {
		const octets = new Uint8Array([0, 251, 255, 62, 63, 1])
		const encode = encoderBase64url(octets)
		expect(encode).not.toMatch(/[=+/]/)
		expect(Array.from(decoderBase64url(encode) ?? [])).toEqual(Array.from(octets))
	})

	it('refuse un caractère hors de l’alphabet et une longueur impossible', () => {
		expect(decoderBase64url('ab+c')).toBeNull()
		expect(decoderBase64url('a=')).toBeNull()
		expect(decoderBase64url('abcde')).toBeNull()
	})
})

describe('lireJws', () => {
	it('découpe un JWS compact en entête, charge, octets signés et signature', () => {
		const jws = lireJws(`${texte({ alg: 'RS256', kid: 'k' })}.${texte({ sub: 's' })}.${encoderBase64url(new Uint8Array([1, 2]))}`)
		expect(jws?.entete).toEqual({ alg: 'RS256', kid: 'k' })
		expect(jws?.charge).toEqual({ sub: 's' })
		expect(Array.from(jws?.signature ?? [])).toEqual([1, 2])
	})

	it('refuse ce qui n’est pas un JWS à trois segments d’objets JSON', () => {
		expect(lireJws('a.b')).toBeNull()
		expect(lireJws('a.b.c.d')).toBeNull()
		expect(lireJws(`${texte([1])}.${texte({})}.AQ`)).toBeNull()
		expect(lireJws(`${texte({})}.${encoderBase64url(new TextEncoder().encode('pas du json'))}.AQ`)).toBeNull()
		expect(lireJws(`${texte({})}.${texte({})}.`)).toBeNull()
	})
})

describe('algorithmeAccepte et cleCompatible', () => {
	it('n’accepte que RS256 et ES256, jamais none ni HS*', () => {
		expect(algorithmeAccepte('RS256')).toBe(true)
		expect(algorithmeAccepte('ES256')).toBe(true)
		for (const alg of ['none', 'HS256', 'HS384', 'HS512', 'RS384', 'PS256', 'ES512', '', undefined, 256]) {
			expect(algorithmeAccepte(alg), String(alg)).toBe(false)
		}
	})

	it('exige une clé de la bonne famille, destinée à la signature', () => {
		expect(cleCompatible('RS256', { kty: 'RSA', n: 'n', e: 'AQAB', use: 'sig' })).toBe(true)
		expect(cleCompatible('RS256', { kty: 'RSA', n: 'n', e: 'AQAB' })).toBe(true)
		expect(cleCompatible('RS256', { kty: 'RSA', n: 'n', e: 'AQAB', use: 'enc' })).toBe(false)
		expect(cleCompatible('RS256', { kty: 'EC', crv: 'P-256', x: 'x', y: 'y' })).toBe(false)
		expect(cleCompatible('ES256', { kty: 'EC', crv: 'P-256', x: 'x', y: 'y' })).toBe(true)
		expect(cleCompatible('ES256', { kty: 'EC', crv: 'P-384', x: 'x', y: 'y' })).toBe(false)
		expect(cleCompatible('RS256', { kty: 'oct', k: 'secret' })).toBe(false)
	})
})

describe('verifierSignature', () => {
	it('vérifie une signature RS256, et refuse la même altérée d’un octet', async () => {
		const { prive, publique } = await paireRsa()
		const signe = new TextEncoder().encode('entete.charge')
		const signature = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', prive, signe))
		expect(await verifierSignature('RS256', { ...publique, x5c: ['ignoré'], alg: 'RS256' }, signe, signature)).toBe(true)
		signature[0] = (signature[0] ?? 0) ^ 1
		expect(await verifierSignature('RS256', publique, signe, signature)).toBe(false)
	})

	it('vérifie une signature ES256', async () => {
		const { prive, publique } = await paireEc()
		const signe = new TextEncoder().encode('entete.charge')
		const signature = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, prive, signe))
		expect(await verifierSignature('ES256', publique, signe, signature)).toBe(true)
		expect(await verifierSignature('ES256', publique, new TextEncoder().encode('autre'), signature)).toBe(false)
	})

	it('rend false, sans lever, sur une clé invalide', async () => {
		expect(await verifierSignature('RS256', { kty: 'RSA', n: '!!', e: 'AQAB' }, new Uint8Array([1]), new Uint8Array([1]))).toBe(false)
	})
})

describe('signerHs256', () => {
	it('produit un JWT HS256 que la même clé vérifie, avec la charge intacte', async () => {
		const jeton = await signerHs256({ sub: 'abc', role: 'authenticated' }, 'un-secret-de-test-assez-long')
		const [entete, charge, signature] = jeton.split('.') as [string, string, string]
		expect(JSON.parse(new TextDecoder().decode(decoderBase64url(entete) ?? new Uint8Array()))).toEqual({ alg: 'HS256', typ: 'JWT' })
		expect(JSON.parse(new TextDecoder().decode(decoderBase64url(charge) ?? new Uint8Array()))).toEqual({ sub: 'abc', role: 'authenticated' })
		const cle = await crypto.subtle.importKey(
			'raw',
			new TextEncoder().encode('un-secret-de-test-assez-long'),
			{ name: 'HMAC', hash: 'SHA-256' },
			false,
			['verify'],
		)
		expect(
			await crypto.subtle.verify('HMAC', cle, decoderBase64url(signature) ?? new Uint8Array(), new TextEncoder().encode(`${entete}.${charge}`)),
		).toBe(true)
	})
})
