// @verifies CRM-092 (docs/BACKLOG.md) — vérification du jeton d'accès LeLabs et admission côté jeton
// @verifies docs/SPEC-session-sso.md §5.2 (point 4 : forme, algorithme, clés, signature, revendications ;
//           point 5 : adresse vérifiée, présence de `verified`), §6.1, §13 (preuves unitaires)
// @verifies docs/SSO-client-lelabs-crm.md (« À vérifier côté application »)
//
// Les clés RSA et EC sont tirées par WebCrypto dans le test, jamais versées. Le faux jeu de clés
// COMPTE ses lectures : un algorithme refusé ne déclenche aucune lecture de clé.

import { beforeAll, describe, expect, it } from 'vitest'
import { encoderBase64url, signerHs256 } from './jws.ts'
import { Refus } from './refus.ts'
import { verifierJetonAcces, type ContexteVerification } from './verification.ts'

const EMETTEUR = 'https://oauth.lelabs.tech/realms/lelabs'
const CLIENT = 'lelabs-crm-serveur'
const MAINTENANT = 1_790_180_130
const SUB = '5eed0000-0000-4000-8000-000000000011'

type Paire = { prive: CryptoKey; publique: Record<string, unknown> }
let rsa: Paire
let rsaEtrangere: Paire
let ec: Paire

async function tirerRsa(): Promise<Paire> {
	const p = (await crypto.subtle.generateKey(
		{ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
		true,
		['sign', 'verify'],
	)) as CryptoKeyPair
	return { prive: p.privateKey, publique: (await crypto.subtle.exportKey('jwk', p.publicKey)) as Record<string, unknown> }
}

beforeAll(async () => {
	rsa = await tirerRsa()
	rsaEtrangere = await tirerRsa()
	const p = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair
	ec = { prive: p.privateKey, publique: (await crypto.subtle.exportKey('jwk', p.publicKey)) as Record<string, unknown> }
})

const texte = (valeur: unknown) => encoderBase64url(new TextEncoder().encode(JSON.stringify(valeur)))

function revendications(surcharge: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		exp: MAINTENANT + 300,
		iat: MAINTENANT,
		iss: EMETTEUR,
		sub: SUB,
		typ: 'Bearer',
		azp: CLIENT,
		aud: 'account',
		realm_access: { roles: ['default-roles-lelabs', 'offline_access', 'verified', 'uma_authorization'] },
		email: 'Admin@P2Enjoy.test',
		email_verified: true,
		name: 'Camille Aubert',
		...surcharge,
	}
}

async function signer(charge: Record<string, unknown>, options: { alg?: string; kid?: string | null; paire?: Paire } = {}): Promise<string> {
	const alg = options.alg ?? 'RS256'
	const entete: Record<string, unknown> = { alg, typ: 'JWT' }
	if (options.kid !== null) entete.kid = options.kid ?? (alg === 'ES256' ? 'cle-ec' : 'cle-rsa')
	const signe = `${texte(entete)}.${texte(charge)}`
	const octets = new TextEncoder().encode(signe)
	const signature =
		alg === 'ES256'
			? await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, (options.paire ?? ec).prive, octets)
			: await crypto.subtle.sign('RSASSA-PKCS1-v1_5', (options.paire ?? rsa).prive, octets)
	return `${signe}.${encoderBase64url(new Uint8Array(signature))}`
}

function contexte(jwks?: unknown, panne = false) {
	const lectures: string[] = []
	const c: ContexteVerification = {
		emetteur: EMETTEUR,
		clientId: CLIENT,
		jwksUri: `${EMETTEUR}/protocol/openid-connect/certs`,
		maintenant: MAINTENANT,
		lireCles: async (url) => {
			lectures.push(url)
			if (panne) throw new Refus('sso_injoignable')
			return (jwks ?? {
				keys: [{ ...rsa.publique, kid: 'cle-rsa', use: 'sig', alg: 'RS256' }, { ...ec.publique, kid: 'cle-ec', use: 'sig' }],
			}) as Record<string, unknown>
		},
	}
	return { c, lectures }
}

async function refusDe(promesse: Promise<unknown>): Promise<{ code: string; adresse: string | null }> {
	try {
		await promesse
	} catch (erreur) {
		if (erreur instanceof Refus) return { code: erreur.code, adresse: erreur.adresse }
		throw erreur
	}
	throw new Error('aucun refus')
}

describe('verifierJetonAcces — succès', () => {
	it('rend le sub, l’adresse en minuscules, le nom et l’échéance', async () => {
		const { c } = contexte()
		expect(await verifierJetonAcces(await signer(revendications()), c)).toEqual({
			sub: SUB,
			adresse: 'admin@p2enjoy.test',
			nom: 'Camille Aubert',
			exp: MAINTENANT + 300,
		})
	})

	it('accepte un jeton ES256', async () => {
		const { c } = contexte()
		expect((await verifierJetonAcces(await signer(revendications(), { alg: 'ES256' }), c)).sub).toBe(SUB)
	})

	it('teste la PRÉSENCE de `verified`, jamais le nombre ni l’ordre des rôles', async () => {
		for (const roles of [['verified'], ['uma_authorization', 'admin', 'verified', 'offline_access']]) {
			const { c } = contexte()
			expect((await verifierJetonAcces(await signer(revendications({ realm_access: { roles } })), c)).sub, JSON.stringify(roles)).toBe(SUB)
		}
	})

	it('compose le nom du prénom et du nom quand `name` manque', async () => {
		const { c } = contexte()
		const identite = await verifierJetonAcces(await signer(revendications({ name: undefined, given_name: 'Driss', family_name: 'Lemoine' })), c)
		expect(identite.nom).toBe('Driss Lemoine')
	})

	it('n’examine jamais `aud` : `account`, absent ou un tableau, le jeton est accepté (K14)', async () => {
		for (const aud of ['account', undefined, ['account', 'broker']]) {
			const { c } = contexte()
			expect((await verifierJetonAcces(await signer(revendications({ aud })), c)).sub, String(aud)).toBe(SUB)
		}
	})

	it('tolère un iat jusqu’à 60 s dans le futur', async () => {
		const { c } = contexte()
		expect((await verifierJetonAcces(await signer(revendications({ iat: MAINTENANT + 60 })), c)).sub).toBe(SUB)
	})

	it('suit une rotation : une nouvelle clé publiée est acceptée sans rien redémarrer', async () => {
		const { c } = contexte({ keys: [{ ...rsaEtrangere.publique, kid: 'cle-nouvelle', use: 'sig' }] })
		expect((await verifierJetonAcces(await signer(revendications(), { kid: 'cle-nouvelle', paire: rsaEtrangere }), c)).sub).toBe(SUB)
	})
})

describe('verifierJetonAcces — forme, algorithme, clés, signature', () => {
	it.each(['abc.def', 'abc.def.ghi', 'a.b.c.d', ''])('refuse « %s » sans rien lire', async (jeton) => {
		const { c, lectures } = contexte()
		expect(await refusDe(verifierJetonAcces(jeton, c))).toEqual({ code: 'jeton_refuse', adresse: null })
		expect(lectures).toEqual([])
	})

	it.each(['none', 'HS256', 'HS512', 'RS384', 'PS256'])('refuse `alg=%s` AVANT toute lecture de clé', async (alg) => {
		const { c, lectures } = contexte()
		const jeton = `${texte({ alg, typ: 'JWT', kid: 'cle-rsa' })}.${texte(revendications())}.${encoderBase64url(new Uint8Array([1, 2, 3]))}`
		expect((await refusDe(verifierJetonAcces(jeton, c))).code).toBe('jeton_refuse')
		expect(lectures).toEqual([])
	})

	it('refuse un jeton HS256 signé par JWT_SECRET lui-même : le jeton interne n’est pas une preuve SSO', async () => {
		const { c, lectures } = contexte()
		expect((await refusDe(verifierJetonAcces(await signerHs256(revendications(), 'secret-quelconque'), c))).code).toBe('jeton_refuse')
		expect(lectures).toEqual([])
	})

	it('refuse un jeton sans `kid`, sans rien lire', async () => {
		const { c, lectures } = contexte()
		expect((await refusDe(verifierJetonAcces(await signer(revendications(), { kid: null }), c))).code).toBe('jeton_refuse')
		expect(lectures).toEqual([])
	})

	it('refuse un `kid` absent du jeu publié, une clé de chiffrement, une autre clé, une signature altérée', async () => {
		expect((await refusDe(verifierJetonAcces(await signer(revendications(), { kid: 'cle-retiree' }), contexte().c))).code).toBe('jeton_refuse')
		const chiffrement = contexte({ keys: [{ ...rsa.publique, kid: 'cle-rsa', use: 'enc' }] })
		expect((await refusDe(verifierJetonAcces(await signer(revendications()), chiffrement.c))).code).toBe('jeton_refuse')
		expect((await refusDe(verifierJetonAcces(await signer(revendications(), { paire: rsaEtrangere }), contexte().c))).code).toBe('jeton_refuse')
		const [e, p, s] = (await signer(revendications())).split('.') as [string, string, string]
		const altere = `${e}.${p}.${s.startsWith('A') ? `B${s.slice(1)}` : `A${s.slice(1)}`}`
		expect((await refusDe(verifierJetonAcces(altere, contexte().c))).code).toBe('jeton_refuse')
	})

	it('rend sso_injoignable quand le jeu de clés ne répond pas ou n’en est pas un', async () => {
		expect((await refusDe(verifierJetonAcces(await signer(revendications()), contexte(undefined, true).c))).code).toBe('sso_injoignable')
		expect((await refusDe(verifierJetonAcces(await signer(revendications()), contexte({ pas: 'de clés' }).c))).code).toBe('sso_injoignable')
	})
})

describe('verifierJetonAcces — revendications et admission', () => {
	it.each([
		['un autre émetteur', { iss: 'https://ailleurs.example/realms/lelabs' }],
		['une autre application (azp)', { azp: 'lelabs-crm' }],
		['un id_token (typ=ID)', { typ: 'ID' }],
		['un jeton échu depuis une seconde', { exp: MAINTENANT - 1 }],
		['un jeton échu à l’instant même', { exp: MAINTENANT }],
		['un exp absent', { exp: undefined }],
		['un iat trop loin dans le futur', { iat: MAINTENANT + 61 }],
		['un sub qui n’est pas un UUID', { sub: 'admin@p2enjoy.test' }],
	])('refuse %s', async (_cas, surcharge) => {
		expect((await refusDe(verifierJetonAcces(await signer(revendications(surcharge)), contexte().c))).code).toBe('jeton_refuse')
	})

	it.each([
		['une adresse non vérifiée', { email_verified: false }],
		['email_verified absent', { email_verified: undefined }],
		['email_verified en chaîne', { email_verified: 'true' }],
	])('rend adresse_non_verifiee pour %s', async (_cas, surcharge) => {
		expect(await refusDe(verifierJetonAcces(await signer(revendications(surcharge)), contexte().c))).toEqual({
			code: 'adresse_non_verifiee',
			adresse: 'admin@p2enjoy.test',
		})
	})

	it('rend adresse_non_verifiee, adresse nulle, sans adresse du tout', async () => {
		expect(await refusDe(verifierJetonAcces(await signer(revendications({ email: undefined })), contexte().c))).toEqual({
			code: 'adresse_non_verifiee',
			adresse: null,
		})
	})

	it.each([
		['aucun rôle', { realm_access: undefined }],
		['les seuls rôles par défaut', { realm_access: { roles: ['default-roles-lelabs', 'offline_access', 'uma_authorization'] } }],
		['admin sans verified', { realm_access: { roles: ['admin'] } }],
		['des rôles qui ne sont pas un tableau', { realm_access: { roles: 'verified' } }],
	])('rend attente_verification pour %s', async (_cas, surcharge) => {
		expect(await refusDe(verifierJetonAcces(await signer(revendications(surcharge)), contexte().c))).toEqual({
			code: 'attente_verification',
			adresse: 'admin@p2enjoy.test',
		})
	})
})
