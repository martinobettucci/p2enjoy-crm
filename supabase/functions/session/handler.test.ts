// @verifies CRM-092 (docs/BACKLOG.md) — échangeur de session, preuve unitaire
// @verifies docs/SPEC-session-sso.md §5.1 à §5.5 (requête, vérifications ordonnées, jeton interne,
//           refus, journal), §6.1 (admission : adresse vérifiée, `verified`, attente), §13 (preuves)
// @verifies docs/SSO-client-lelabs-crm.md (« À vérifier côté application »)
//
// Les clés RSA et EC sont tirées par WebCrypto dans le test, jamais versées. Un faux LeLabs sert la
// découverte et le jeu de clés ; il COMPTE ses lectures, ce qui prouve qu'un algorithme refusé ne
// déclenche aucune lecture de clé (§5.2, point 2).

import { beforeAll, describe, expect, it } from 'vitest'
import {
	DUREE_MAX_JETON_INTERNE,
	EMETTEUR_INTERNE,
	traiterSession,
	type DependancesSession,
	type ResultatOuverture,
} from './handler.ts'
import { decoderBase64url, encoderBase64url, signerHs256 } from './jws.ts'

const EMETTEUR = 'https://oauth.lelabs.tech/realms/lelabs'
const CLIENT = 'lelabs-crm'
const SECRET = 'secret-de-signature-de-test-de-trente-deux-caracteres'
const JWKS_URI = `${EMETTEUR}/protocol/openid-connect/certs`
const MAINTENANT = 1_790_180_130
const SUB = '5eed0000-0000-4000-8000-000000000011'

type Paire = { prive: CryptoKey; publique: Record<string, unknown> }
let rsa: Paire
let rsaEtrangere: Paire
let ec: Paire

beforeAll(async () => {
	const tirerRsa = async (): Promise<Paire> => {
		const p = (await crypto.subtle.generateKey(
			{ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
			true,
			['sign', 'verify'],
		)) as CryptoKeyPair
		return { prive: p.privateKey, publique: (await crypto.subtle.exportKey('jwk', p.publicKey)) as Record<string, unknown> }
	}
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

async function signer(
	charge: Record<string, unknown>,
	options: { alg?: string; kid?: string | null; paire?: Paire } = {},
): Promise<string> {
	const alg = options.alg ?? 'RS256'
	const entete: Record<string, unknown> = { alg, typ: 'JWT' }
	if (options.kid !== null) entete.kid = options.kid ?? (alg === 'ES256' ? 'cle-ec' : 'cle-rsa')
	const signe = `${texte(entete)}.${texte(charge)}`
	const octets = new TextEncoder().encode(signe)
	let signature: ArrayBuffer
	if (alg === 'ES256') signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, (options.paire ?? ec).prive, octets)
	else signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', (options.paire ?? rsa).prive, octets)
	return `${signe}.${encoderBase64url(new Uint8Array(signature))}`
}

type Monde = {
	decouverte?: unknown
	jwks?: unknown
	panne?: 'decouverte' | 'cles'
	ouverture?: ResultatOuverture | 'panne'
}

function monde(m: Monde = {}) {
	const lectures: string[] = []
	const ouvertures: Array<[string, string, string]> = []
	const journal: Array<Readonly<Record<string, unknown>>> = []
	const d: DependancesSession = {
		configuration: { emetteur: EMETTEUR, clientId: CLIENT, secretJwt: SECRET },
		lireJson: async (url) => {
			lectures.push(url)
			if (url === `${EMETTEUR}/.well-known/openid-configuration`) {
				if (m.panne === 'decouverte') throw new Error('délai dépassé')
				return m.decouverte ?? { issuer: EMETTEUR, jwks_uri: JWKS_URI }
			}
			if (m.panne === 'cles') throw new Error('HTTP 503')
			return m.jwks ?? { keys: [{ ...rsa.publique, kid: 'cle-rsa', use: 'sig', alg: 'RS256' }, { ...ec.publique, kid: 'cle-ec', use: 'sig' }] }
		},
		ouvrirSession: async (sub, adresse, nom) => {
			ouvertures.push([sub, adresse, nom])
			if (m.ouverture === 'panne') throw new Error('HTTP 500')
			return m.ouverture ?? { admis: true, nom: 'Camille Aubert' }
		},
		maintenant: () => MAINTENANT,
		journaliser: (e) => journal.push(e),
	}
	return { d, lectures, ouvertures, journal }
}

function requete(jeton: string | null, methode = 'POST', autorisation?: string): Request {
	const headers = new Headers()
	if (autorisation !== undefined) headers.set('authorization', autorisation)
	else if (jeton !== null) headers.set('authorization', `Bearer ${jeton}`)
	return new Request('http://edge/session', { method: methode, headers, body: methode === 'POST' ? '' : undefined })
}

async function corps(reponse: Response): Promise<Record<string, unknown>> {
	return (await reponse.json()) as Record<string, unknown>
}

function charge(jeton: string): Record<string, unknown> {
	return JSON.parse(new TextDecoder().decode(decoderBase64url(jeton.split('.')[1] ?? '') ?? new Uint8Array())) as Record<string, unknown>
}

describe('traiterSession — succès (§5.3)', () => {
	it('rend un jeton interne HS256 aux revendications exactes, vérifiable par JWT_SECRET', async () => {
		const { d, ouvertures, journal } = monde()
		const reponse = await traiterSession(requete(await signer(revendications())), d)
		expect(reponse.status).toBe(200)
		expect(reponse.headers.get('cache-control')).toBe('no-store')
		const c = await corps(reponse)
		expect(c.expire_a).toBe(MAINTENANT + 300)
		expect(c.identite).toEqual({ id: SUB, adresse: 'admin@p2enjoy.test', nom: 'Camille Aubert' })
		const jeton = c.jeton as string
		expect(charge(jeton)).toEqual({
			iss: EMETTEUR_INTERNE,
			sub: SUB,
			aud: 'authenticated',
			role: 'authenticated',
			iat: MAINTENANT,
			exp: MAINTENANT + 300,
		})
		const [e, p, s] = jeton.split('.') as [string, string, string]
		expect(JSON.parse(new TextDecoder().decode(decoderBase64url(e) ?? new Uint8Array()))).toEqual({ alg: 'HS256', typ: 'JWT' })
		const cle = await crypto.subtle.importKey('raw', new TextEncoder().encode(SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify'])
		expect(await crypto.subtle.verify('HMAC', cle, decoderBase64url(s) ?? new Uint8Array(), new TextEncoder().encode(`${e}.${p}`))).toBe(true)
		// L'adresse est remise en minuscules à la base, avec le nom du SSO.
		expect(ouvertures).toEqual([[SUB, 'admin@p2enjoy.test', 'Camille Aubert']])
		expect(journal).toHaveLength(1)
		expect(journal[0]).toMatchObject({ event: 'session_ouverte', code: 'ok' })
	})

	it('ne dépasse JAMAIS l’échéance du jeton LeLabs', async () => {
		const { d } = monde()
		const c = await corps(await traiterSession(requete(await signer(revendications({ exp: MAINTENANT + 42 }))), d))
		expect(c.expire_a).toBe(MAINTENANT + 42)
		expect(charge(c.jeton as string).exp).toBe(MAINTENANT + 42)
	})

	it('ne dépasse pas 300 s, même si le jeton LeLabs vit plus longtemps', async () => {
		const { d } = monde()
		const c = await corps(await traiterSession(requete(await signer(revendications({ exp: MAINTENANT + 86_400 }))), d))
		expect(c.expire_a).toBe(MAINTENANT + DUREE_MAX_JETON_INTERNE)
	})

	it('accepte un jeton ES256', async () => {
		const { d } = monde()
		const reponse = await traiterSession(requete(await signer(revendications(), { alg: 'ES256' })), d)
		expect(reponse.status).toBe(200)
	})

	it('teste la PRÉSENCE de `verified`, jamais le nombre ni l’ordre des rôles', async () => {
		for (const roles of [['verified'], ['uma_authorization', 'admin', 'verified', 'offline_access']]) {
			const { d } = monde()
			const reponse = await traiterSession(requete(await signer(revendications({ realm_access: { roles } }))), d)
			expect(reponse.status, JSON.stringify(roles)).toBe(200)
		}
	})

	it('compose le nom du prénom et du nom quand `name` manque', async () => {
		const { d, ouvertures } = monde({ ouverture: { admis: true, nom: null } })
		const c = await corps(
			await traiterSession(requete(await signer(revendications({ name: undefined, given_name: 'Driss', family_name: 'Lemoine' }))), d),
		)
		expect(ouvertures[0]?.[2]).toBe('Driss Lemoine')
		expect((c.identite as Record<string, unknown>).nom).toBe('Driss Lemoine')
	})
})

describe('traiterSession — forme et algorithme (§5.2, points 1 et 2)', () => {
	it.each([
		['sans en-tête', null, undefined],
		['en-tête sans Bearer', null, 'Basic abc'],
		['jeton à deux segments', null, 'Bearer abc.def'],
		['jeton illisible', null, 'Bearer abc.def.ghi'],
	])('refuse un %s en 401 jeton_refuse, sans rien lire chez LeLabs', async (_cas, jeton, autorisation) => {
		const { d, lectures, ouvertures } = monde()
		const reponse = await traiterSession(requete(jeton, 'POST', autorisation), d)
		expect(reponse.status).toBe(401)
		expect(await corps(reponse)).toEqual({ erreur: 'jeton_refuse' })
		expect(lectures).toEqual([])
		expect(ouvertures).toEqual([])
	})

	it.each(['none', 'HS256', 'HS512', 'RS384', 'PS256'])(
		'refuse `alg=%s` AVANT toute lecture de clé',
		async (alg) => {
			const { d, lectures, ouvertures } = monde()
			const entete = texte({ alg, typ: 'JWT', kid: 'cle-rsa' })
			const jeton = `${entete}.${texte(revendications())}.${encoderBase64url(new Uint8Array([1, 2, 3]))}`
			const reponse = await traiterSession(requete(jeton), d)
			expect(reponse.status).toBe(401)
			expect(lectures).toEqual([])
			expect(ouvertures).toEqual([])
		},
	)

	it('refuse un jeton HS256 signé par JWT_SECRET lui-même : le jeton interne n’est pas une preuve SSO', async () => {
		const { d, lectures } = monde()
		const interne = await signerHs256(revendications(), SECRET)
		expect((await traiterSession(requete(interne), d)).status).toBe(401)
		expect(lectures).toEqual([])
	})

	it('refuse un jeton sans `kid`', async () => {
		const { d, lectures } = monde()
		expect((await traiterSession(requete(await signer(revendications(), { kid: null })), d)).status).toBe(401)
		expect(lectures).toEqual([])
	})
})

describe('traiterSession — clés et signature (§5.2, points 3 à 5)', () => {
	it('relit la découverte puis les clés à chaque échange : aucune n’est gardée', async () => {
		const { d, lectures } = monde()
		const jeton = await signer(revendications())
		await traiterSession(requete(jeton), d)
		await traiterSession(requete(jeton), d)
		expect(lectures).toEqual([
			`${EMETTEUR}/.well-known/openid-configuration`,
			JWKS_URI,
			`${EMETTEUR}/.well-known/openid-configuration`,
			JWKS_URI,
		])
	})

	it('refuse un `kid` absent du jeu de clés publié', async () => {
		const { d } = monde()
		expect((await traiterSession(requete(await signer(revendications(), { kid: 'cle-retiree' })), d)).status).toBe(401)
	})

	it('refuse une clé publiée pour le chiffrement, même au bon `kid`', async () => {
		const { d } = monde({ jwks: { keys: [{ ...rsa.publique, kid: 'cle-rsa', use: 'enc' }] } })
		expect((await traiterSession(requete(await signer(revendications())), d)).status).toBe(401)
	})

	it('refuse un jeton signé par une autre clé que celle publiée sous son `kid`', async () => {
		const { d } = monde()
		expect((await traiterSession(requete(await signer(revendications(), { paire: rsaEtrangere })), d)).status).toBe(401)
	})

	it('refuse une signature altérée d’un octet', async () => {
		const { d, ouvertures } = monde()
		const [e, p, s] = (await signer(revendications())).split('.') as [string, string, string]
		const octets = decoderBase64url(s) ?? new Uint8Array()
		octets[10] = (octets[10] ?? 0) ^ 1
		const reponse = await traiterSession(requete(`${e}.${p}.${encoderBase64url(octets)}`), d)
		expect(reponse.status).toBe(401)
		expect(ouvertures).toEqual([])
	})

	it('suit une rotation : une nouvelle clé publiée est acceptée sans rien redémarrer', async () => {
		const { d } = monde({ jwks: { keys: [{ ...rsaEtrangere.publique, kid: 'cle-nouvelle', use: 'sig' }] } })
		const reponse = await traiterSession(requete(await signer(revendications(), { kid: 'cle-nouvelle', paire: rsaEtrangere })), d)
		expect(reponse.status).toBe(200)
	})

	it.each([
		['un autre émetteur', { issuer: 'https://ailleurs.example/realms/lelabs', jwks_uri: JWKS_URI }],
		['un jwks_uri en http public', { issuer: EMETTEUR, jwks_uri: 'http://oauth.lelabs.tech/certs' }],
		['un jwks_uri absent', { issuer: EMETTEUR }],
		['un document qui n’est pas un objet', ['pas', 'un', 'objet']],
	])('rend 502 sso_injoignable pour une découverte portant %s', async (_cas, decouverte) => {
		const { d, ouvertures } = monde({ decouverte })
		const reponse = await traiterSession(requete(await signer(revendications())), d)
		expect(reponse.status).toBe(502)
		expect(await corps(reponse)).toEqual({ erreur: 'sso_injoignable' })
		expect(ouvertures).toEqual([])
	})

	it('accepte un jwks_uri en http vers *.localhost, le seul Keycloak de développement', async () => {
		const { d } = monde({ decouverte: { issuer: EMETTEUR, jwks_uri: 'http://sso.localhost:18480/realms/lelabs/protocol/openid-connect/certs' } })
		expect((await traiterSession(requete(await signer(revendications())), d)).status).toBe(200)
	})

	it.each(['decouverte', 'cles'] as const)('rend 502 sso_injoignable quand %s ne répond pas', async (panne) => {
		const { d } = monde({ panne })
		const reponse = await traiterSession(requete(await signer(revendications())), d)
		expect(reponse.status).toBe(502)
		expect(await corps(reponse)).toEqual({ erreur: 'sso_injoignable' })
	})
})

describe('traiterSession — revendications (§5.2, point 6)', () => {
	it.each([
		['un autre émetteur', { iss: 'https://ailleurs.example/realms/lelabs' }],
		['une autre application (azp)', { azp: 'crm-audience-etrangere' }],
		['un id_token (typ=ID)', { typ: 'ID' }],
		['un jeton échu depuis une seconde', { exp: MAINTENANT - 1 }],
		['un jeton échu à l’instant même', { exp: MAINTENANT }],
		['un exp absent', { exp: undefined }],
		['un iat trop loin dans le futur', { iat: MAINTENANT + 61 }],
		['un sub qui n’est pas un UUID', { sub: 'admin@p2enjoy.test' }],
		['un sub absent', { sub: undefined }],
	])('refuse %s en 401, sans rien écrire en base', async (_cas, surcharge) => {
		const { d, ouvertures } = monde()
		const reponse = await traiterSession(requete(await signer(revendications(surcharge))), d)
		expect(reponse.status).toBe(401)
		expect(await corps(reponse)).toEqual({ erreur: 'jeton_refuse' })
		expect(ouvertures).toEqual([])
	})

	it('tolère un iat jusqu’à 60 s dans le futur', async () => {
		const { d } = monde()
		expect((await traiterSession(requete(await signer(revendications({ iat: MAINTENANT + 60 }))), d)).status).toBe(200)
	})

	it('n’examine jamais `aud` : `account` ou absent, le jeton est accepté (K14)', async () => {
		for (const aud of ['account', undefined, ['account', 'broker']]) {
			const { d } = monde()
			expect((await traiterSession(requete(await signer(revendications({ aud }))), d)).status, String(aud)).toBe(200)
		}
	})
})

describe('traiterSession — admission (§6.1)', () => {
	it.each([
		['une adresse non vérifiée', { email_verified: false }],
		['email_verified absent', { email_verified: undefined }],
		['email_verified en chaîne', { email_verified: 'true' }],
	])('rend 403 adresse_non_verifiee pour %s, sans rien écrire', async (_cas, surcharge) => {
		const { d, ouvertures } = monde()
		const reponse = await traiterSession(requete(await signer(revendications(surcharge))), d)
		expect(reponse.status).toBe(403)
		expect(await corps(reponse)).toEqual({ erreur: 'adresse_non_verifiee', adresse: 'admin@p2enjoy.test' })
		expect(ouvertures).toEqual([])
	})

	it('rend 403 adresse_non_verifiee, adresse nulle, quand le jeton ne porte aucune adresse', async () => {
		const { d } = monde()
		const reponse = await traiterSession(requete(await signer(revendications({ email: undefined }))), d)
		expect(await corps(reponse)).toEqual({ erreur: 'adresse_non_verifiee', adresse: null })
	})

	it.each([
		['aucun rôle', { realm_access: undefined }],
		['les seuls rôles par défaut', { realm_access: { roles: ['default-roles-lelabs', 'offline_access', 'uma_authorization'] } }],
		['admin sans verified', { realm_access: { roles: ['admin'] } }],
		['des rôles qui ne sont pas un tableau', { realm_access: { roles: 'verified' } }],
	])('rend 403 attente_verification pour %s, sans rien écrire', async (_cas, surcharge) => {
		const { d, ouvertures } = monde()
		const reponse = await traiterSession(requete(await signer(revendications(surcharge))), d)
		expect(reponse.status).toBe(403)
		expect(await corps(reponse)).toEqual({ erreur: 'attente_verification', adresse: 'admin@p2enjoy.test' })
		expect(ouvertures).toEqual([])
	})

	it('rend 403 attente_espace quand la base ne l’admet pas, et ne frappe aucun jeton', async () => {
		const { d } = monde({ ouverture: { admis: false, nom: null } })
		const reponse = await traiterSession(requete(await signer(revendications())), d)
		expect(reponse.status).toBe(403)
		const c = await corps(reponse)
		expect(c).toEqual({ erreur: 'attente_espace', adresse: 'admin@p2enjoy.test' })
		expect(c).not.toHaveProperty('jeton')
	})

	it('rend 502 service_indisponible quand la base ne répond pas', async () => {
		const { d } = monde({ ouverture: 'panne' })
		const reponse = await traiterSession(requete(await signer(revendications())), d)
		expect(reponse.status).toBe(502)
		expect(await corps(reponse)).toEqual({ erreur: 'service_indisponible' })
	})
})

describe('traiterSession — méthode, configuration, journal (§5.1, §5.5)', () => {
	it('répond au préflight sans corps', async () => {
		const reponse = await traiterSession(requete(null, 'OPTIONS'), monde().d)
		expect(reponse.status).toBe(204)
		expect(reponse.headers.get('allow')).toBe('POST, OPTIONS')
	})

	it('refuse toute autre méthode en 405 methode', async () => {
		const reponse = await traiterSession(requete(null, 'GET'), monde().d)
		expect(reponse.status).toBe(405)
		expect(reponse.headers.get('allow')).toBe('POST, OPTIONS')
		expect(await corps(reponse)).toEqual({ erreur: 'methode' })
	})

	it('rend 502 service_indisponible sans configuration, sans rien tenter', async () => {
		const m = monde()
		const d: DependancesSession = { ...m.d, configuration: null }
		const reponse = await traiterSession(requete(await signer(revendications())), d)
		expect(reponse.status).toBe(502)
		expect(m.lectures).toEqual([])
		expect(m.journal[0]).toMatchObject({ event: 'session_refusee', code: 'configuration_absente' })
	})

	it('ne journalise ni jeton, ni adresse, ni nom, ni sub', async () => {
		for (const surcharge of [{}, { realm_access: undefined }, { azp: 'autre' }]) {
			const { d, journal } = monde()
			const jeton = await signer(revendications(surcharge))
			await traiterSession(requete(jeton), d)
			const trace = JSON.stringify(journal)
			for (const secret of [jeton, 'admin@p2enjoy.test', 'Camille', SUB]) expect(trace).not.toContain(secret)
			expect(Object.keys(journal[0] ?? {}).sort()).toEqual(['code', 'duree_ms', 'event'])
		}
	})
})
