// @verifies CRM-092 (docs/BACKLOG.md) — échangeur de session, client confidentiel : preuve unitaire
// @verifies docs/SPEC-session-sso.md §5.1 à §5.7 (trois gestes, ouvrir, prolonger, fermer, jeton interne,
//           refus, poignée et cookie, échéance et journal), §6.1, §13 (preuves unitaires)
// @verifies docs/JOURNAL.md décision 586 (aucun jeton LeLabs n'atteint le navigateur)
//
// Un faux LeLabs sert la découverte, le point de jeton et les clés ; une fausse base reproduit les
// quatre fonctions de session de `0076_sessions_serveur.sql`. Chacun enregistre ce qu'il reçoit, ce qui
// prouve CE QUE l'échangeur envoie — le secret au point de jeton, l'empreinte et jamais la poignée en
// base, le jeton de rafraîchissement chiffré et jamais en clair.

import { beforeAll, describe, expect, it } from 'vitest'
import { cleDeChiffrement, dechiffrer, empreinteDe } from './chiffrement.ts'
import { ECHEANCE_GESTE_MS, EMETTEUR_INTERNE, traiterSession, type DependancesSession } from './handler.ts'
import { decoderBase64url, encoderBase64url } from './jws.ts'

const EMETTEUR = 'https://oauth.lelabs.tech/realms/lelabs'
const CLIENT = 'lelabs-crm-serveur'
const SECRET_CLIENT = 'secret-du-client-confidentiel'
const SECRET_JWT = 'secret-de-signature-de-test-de-trente-deux-caracteres'
const POINT_JETON = `${EMETTEUR}/protocol/openid-connect/token`
const JWKS_URI = `${EMETTEUR}/protocol/openid-connect/certs`
const MAINTENANT_MS = 1_790_180_130_000
const MAINTENANT = MAINTENANT_MS / 1000
const SUB = '5eed0000-0000-4000-8000-000000000011'
const POIGNEE = 'P'.repeat(43)
const RETOUR = 'https://crm.lelabs.tech/auth/retour'

let rsa: { prive: CryptoKey; publique: Record<string, unknown> }

beforeAll(async () => {
	const p = (await crypto.subtle.generateKey(
		{ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
		true,
		['sign', 'verify'],
	)) as CryptoKeyPair
	rsa = { prive: p.privateKey, publique: (await crypto.subtle.exportKey('jwk', p.publicKey)) as Record<string, unknown> }
})

const texte = (valeur: unknown) => encoderBase64url(new TextEncoder().encode(JSON.stringify(valeur)))

async function jetonAcces(surcharge: Record<string, unknown> = {}): Promise<string> {
	const charge = {
		exp: MAINTENANT + 300,
		iat: MAINTENANT,
		iss: EMETTEUR,
		sub: SUB,
		typ: 'Bearer',
		azp: CLIENT,
		realm_access: { roles: ['default-roles-lelabs', 'verified'] },
		email: 'admin@p2enjoy.test',
		email_verified: true,
		name: 'Camille Aubert',
		...surcharge,
	}
	const signe = `${texte({ alg: 'RS256', typ: 'JWT', kid: 'cle-rsa' })}.${texte(charge)}`
	const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', rsa.prive, new TextEncoder().encode(signe))
	return `${signe}.${encoderBase64url(new Uint8Array(signature))}`
}

type Session = { sub: string; rafraichissement: string; expire_le: string }

type Monde = {
	/** Réponse du point de jeton, par geste ; par défaut un succès. */
	pointJeton?: (champs: Record<string, string>) => Promise<{ statut: number; corps: unknown }> | 'panne'
	/** Surcharge du jeton d'accès rendu. */
	jeton?: Record<string, unknown>
	admis?: boolean
	panneBase?: boolean
	decouverte?: unknown
	sessions?: Map<string, Session>
}

function monde(m: Monde = {}) {
	const appelsJeton: Array<Record<string, string>> = []
	const appelsBase: Array<{ fonction: string; args: Record<string, unknown>; echeance: number }> = []
	const echeances: number[] = []
	const journal: Array<Readonly<Record<string, unknown>>> = []
	const sessions = m.sessions ?? new Map<string, Session>()

	const d: DependancesSession = {
		configuration: { emetteur: EMETTEUR, clientId: CLIENT, clientSecret: SECRET_CLIENT, secretJwt: SECRET_JWT },
		lireJson: async (url, echeance) => {
			echeances.push(echeance)
			if (url === `${EMETTEUR}/.well-known/openid-configuration`) {
				return m.decouverte ?? { issuer: EMETTEUR, token_endpoint: POINT_JETON, jwks_uri: JWKS_URI }
			}
			return { keys: [{ ...rsa.publique, kid: 'cle-rsa', use: 'sig' }] }
		},
		posterFormulaire: async (url, champs, echeance) => {
			echeances.push(echeance)
			expect(url).toBe(POINT_JETON)
			appelsJeton.push({ ...champs })
			const reponse = m.pointJeton?.({ ...champs })
			if (reponse === 'panne') throw new Error('délai dépassé')
			if (reponse !== undefined) return reponse
			return {
				statut: 200,
				corps: { access_token: await jetonAcces(m.jeton), refresh_token: `rt-${appelsJeton.length}`, refresh_expires_in: 1800 },
			}
		},
		appelerBase: async (fonction, args, echeance) => {
			echeances.push(echeance)
			appelsBase.push({ fonction, args: { ...args }, echeance })
			if (m.panneBase) throw new Error('HTTP 500')
			const e = String(args.p_empreinte)
			switch (fonction) {
				case 'ouvrir_session_serveur':
					if (m.admis === false) return { admis: false, espaces: 0, rattachees: 0, nom: null }
					sessions.set(e, { sub: String(args.p_sub), rafraichissement: String(args.p_rafraichissement), expire_le: String(args.p_expire_le) })
					return { admis: true, espaces: 1, rattachees: 0, nom: 'Camille A.' }
				case 'lire_session_serveur': {
					const s = sessions.get(e)
					return s === undefined ? [] : [{ sub: s.sub, rafraichissement: s.rafraichissement }]
				}
				case 'renouveler_session_serveur': {
					const s = sessions.get(e)
					if (s === undefined || s.sub !== args.p_sub) return { admis: false, session: false }
					if (m.admis === false) {
						sessions.delete(e)
						return { admis: false, espaces: 0, rattachees: 0, nom: 'Camille A.', session: true }
					}
					sessions.set(e, { sub: s.sub, rafraichissement: String(args.p_rafraichissement), expire_le: String(args.p_expire_le) })
					return { admis: true, espaces: 1, rattachees: 0, nom: 'Camille A.', session: true }
				}
				case 'fermer_session_serveur':
					sessions.delete(e)
					return null
				default:
					throw new Error(`fonction inconnue ${fonction}`)
			}
		},
		maintenantMs: () => MAINTENANT_MS,
		tirerPoignee: () => POIGNEE,
		journaliser: (e) => journal.push(e),
	}
	return { d, appelsJeton, appelsBase, echeances, journal, sessions }
}

type OptionsRequete = { corps?: unknown; cookie?: string; origine?: string; methode?: string }

function requete(geste: string, o: OptionsRequete = {}): Request {
	const headers = new Headers({ 'content-type': 'application/json' })
	if (o.cookie !== undefined) headers.set('cookie', o.cookie)
	if (o.origine !== undefined) headers.set('origin', o.origine)
	const methode = o.methode ?? 'POST'
	const corps = methode === 'POST' ? (typeof o.corps === 'string' ? o.corps : JSON.stringify(o.corps ?? {})) : undefined
	return new Request(`http://functions:9000/session/${geste}`, { method: methode, headers, body: corps })
}

const CORPS_OUVERTURE = { code: 'code-lelabs', verificateur: 'verificateur-pkce', redirect_uri: RETOUR }
const COOKIE = `p2enjoy_crm_session=${POIGNEE}`

async function json(reponse: Response): Promise<Record<string, unknown>> {
	return (await reponse.json()) as Record<string, unknown>
}

function charge(jeton: string): Record<string, unknown> {
	return JSON.parse(new TextDecoder().decode(decoderBase64url(jeton.split('.')[1] ?? '') ?? new Uint8Array())) as Record<string, unknown>
}

/** Une session déjà ouverte, dont le jeton de rafraîchissement est chiffré comme l'échangeur le fait. */
async function sessionOuverte(): Promise<Map<string, Session>> {
	const m = monde()
	await traiterSession(requete('ouvrir', { corps: CORPS_OUVERTURE }), m.d)
	return m.sessions
}

describe('ouvrir — succès (§5.2)', () => {
	it('échange le code AVEC LE SECRET et le vérificateur, et ne rend aucun jeton LeLabs', async () => {
		const m = monde()
		const reponse = await traiterSession(requete('ouvrir', { corps: CORPS_OUVERTURE, origine: 'http://127.0.0.1:5273' }), m.d)
		expect(reponse.status).toBe(200)
		expect(m.appelsJeton).toEqual([
			{
				grant_type: 'authorization_code',
				client_id: CLIENT,
				client_secret: SECRET_CLIENT,
				code: 'code-lelabs',
				code_verifier: 'verificateur-pkce',
				redirect_uri: RETOUR,
			},
		])
		const corps = await json(reponse)
		expect(Object.keys(corps).sort()).toEqual(['expire_a', 'identite', 'jeton'])
		expect(JSON.stringify(corps)).not.toContain('rt-1')
		expect(corps.identite).toEqual({ id: SUB, adresse: 'admin@p2enjoy.test', nom: 'Camille A.' })
		expect(charge(corps.jeton as string)).toEqual({
			iss: EMETTEUR_INTERNE,
			sub: SUB,
			aud: 'authenticated',
			role: 'authenticated',
			iat: MAINTENANT,
			exp: MAINTENANT + 300,
		})
	})

	it('pose la poignée en cookie HttpOnly, SameSite=Strict, borné à l’échangeur, Secure sur https seulement', async () => {
		const clair = await traiterSession(requete('ouvrir', { corps: CORPS_OUVERTURE, origine: 'http://127.0.0.1:5273' }), monde().d)
		expect(clair.headers.get('set-cookie')).toBe(`p2enjoy_crm_session=${POIGNEE}; Path=/functions/v1/session; HttpOnly; SameSite=Strict`)
		expect(clair.headers.get('cache-control')).toBe('no-store')
		const https = await traiterSession(requete('ouvrir', { corps: CORPS_OUVERTURE, origine: 'https://crm.lelabs.tech' }), monde().d)
		expect(https.headers.get('set-cookie')).toMatch(/; Secure$/)
	})

	it('garde en base l’EMPREINTE de la poignée et le jeton de rafraîchissement CHIFFRÉ, jamais en clair', async () => {
		const m = monde()
		await traiterSession(requete('ouvrir', { corps: CORPS_OUVERTURE }), m.d)
		const appel = m.appelsBase.find((a) => a.fonction === 'ouvrir_session_serveur')
		expect(appel?.args.p_empreinte).toBe(await empreinteDe(POIGNEE))
		expect(JSON.stringify(appel?.args)).not.toContain(POIGNEE)
		expect(appel?.args.p_rafraichissement).not.toContain('rt-1')
		expect(await dechiffrer(String(appel?.args.p_rafraichissement), await cleDeChiffrement(SECRET_JWT))).toBe('rt-1')
		expect(appel?.args).toMatchObject({ p_sub: SUB, p_email: 'admin@p2enjoy.test', p_nom: 'Camille Aubert' })
		expect(appel?.args.p_expire_le).toBe(new Date(MAINTENANT_MS + 1800 * 1000).toISOString())
	})

	it('ne dépasse jamais l’échéance du jeton d’accès LeLabs', async () => {
		const m = monde({ jeton: { exp: MAINTENANT + 42 } })
		const corps = await json(await traiterSession(requete('ouvrir', { corps: CORPS_OUVERTURE }), m.d))
		expect(corps.expire_a).toBe(MAINTENANT + 42)
	})

	it('donne à chaque appel l’échéance du geste : 8 s après son début', async () => {
		const m = monde()
		await traiterSession(requete('ouvrir', { corps: CORPS_OUVERTURE }), m.d)
		expect(m.echeances.length).toBe(4)
		expect(new Set(m.echeances)).toEqual(new Set([MAINTENANT_MS + ECHEANCE_GESTE_MS]))
	})
})

describe('ouvrir — refus (§5.2, §5.5)', () => {
	it.each([
		['un corps qui n’est pas du JSON', 'pas du json'],
		['un code absent', { verificateur: 'v', redirect_uri: RETOUR }],
		['un vérificateur vide', { code: 'c', verificateur: '', redirect_uri: RETOUR }],
		['une URL de retour étrangère', { code: 'c', verificateur: 'v', redirect_uri: 'https://ailleurs.example/auth/retour?x=1' }],
		['une URL de retour d’un autre chemin', { code: 'c', verificateur: 'v', redirect_uri: 'https://crm.lelabs.tech/autre' }],
	])('rend 400 requete_invalide pour %s, sans rien demander à LeLabs', async (_cas, corps) => {
		const m = monde()
		const reponse = await traiterSession(requete('ouvrir', { corps }), m.d)
		expect(reponse.status).toBe(400)
		expect(await json(reponse)).toEqual({ erreur: 'requete_invalide' })
		expect(m.appelsJeton).toEqual([])
	})

	it('rend 401 jeton_refuse quand LeLabs refuse le code, sans rien écrire en base', async () => {
		const m = monde({ pointJeton: async () => ({ statut: 400, corps: { error: 'invalid_grant' } }) })
		const reponse = await traiterSession(requete('ouvrir', { corps: CORPS_OUVERTURE }), m.d)
		expect(reponse.status).toBe(401)
		expect(await json(reponse)).toEqual({ erreur: 'jeton_refuse' })
		expect(reponse.headers.get('set-cookie')).toBeNull()
		expect(m.appelsBase).toEqual([])
	})

	it.each([
		['une panne du point de jeton', 'panne' as const],
		['un 503 du point de jeton', async () => ({ statut: 503, corps: null })],
		['une réponse sans jeton de rafraîchissement', async () => ({ statut: 200, corps: { access_token: 'x', refresh_expires_in: 1800 } })],
		['une réponse sans échéance de rafraîchissement', async () => ({ statut: 200, corps: { access_token: 'x', refresh_token: 'y' } })],
	])('rend 502 sso_injoignable pour %s', async (_cas, pointJeton) => {
		const m = monde({ pointJeton: pointJeton === 'panne' ? () => 'panne' : pointJeton })
		const reponse = await traiterSession(requete('ouvrir', { corps: CORPS_OUVERTURE }), m.d)
		expect(reponse.status).toBe(502)
		expect(await json(reponse)).toEqual({ erreur: 'sso_injoignable' })
	})

	it.each([
		['un autre émetteur', { issuer: 'https://ailleurs.example', token_endpoint: POINT_JETON, jwks_uri: JWKS_URI }],
		['un point de jeton en http public', { issuer: EMETTEUR, token_endpoint: 'http://oauth.lelabs.tech/token', jwks_uri: JWKS_URI }],
	])('rend 502 pour une découverte portant %s, sans poster le code', async (_cas, decouverte) => {
		const m = monde({ decouverte })
		expect((await traiterSession(requete('ouvrir', { corps: CORPS_OUVERTURE }), m.d)).status).toBe(502)
		expect(m.appelsJeton).toEqual([])
	})

	it('rend 401 jeton_refuse pour un jeton émis pour une autre application, sans rien écrire', async () => {
		const m = monde({ jeton: { azp: 'lelabs-crm' } })
		expect((await traiterSession(requete('ouvrir', { corps: CORPS_OUVERTURE }), m.d)).status).toBe(401)
		expect(m.appelsBase).toEqual([])
	})

	it('rend 403 attente_verification sans `verified`, adresse comprise, sans rien écrire', async () => {
		const m = monde({ jeton: { realm_access: { roles: ['default-roles-lelabs'] } } })
		const reponse = await traiterSession(requete('ouvrir', { corps: CORPS_OUVERTURE }), m.d)
		expect(reponse.status).toBe(403)
		expect(await json(reponse)).toEqual({ erreur: 'attente_verification', adresse: 'admin@p2enjoy.test' })
		expect(m.appelsBase).toEqual([])
	})

	it('rend 403 attente_espace quand la base n’admet pas, sans poser de cookie', async () => {
		const m = monde({ admis: false })
		const reponse = await traiterSession(requete('ouvrir', { corps: CORPS_OUVERTURE }), m.d)
		expect(reponse.status).toBe(403)
		expect(await json(reponse)).toEqual({ erreur: 'attente_espace', adresse: 'admin@p2enjoy.test' })
		expect(reponse.headers.get('set-cookie')).toBeNull()
	})

	it('rend 502 service_indisponible quand la base ne répond pas', async () => {
		const m = monde({ panneBase: true })
		const reponse = await traiterSession(requete('ouvrir', { corps: CORPS_OUVERTURE }), m.d)
		expect(reponse.status).toBe(502)
		expect(await json(reponse)).toEqual({ erreur: 'service_indisponible' })
	})
})

describe('prolonger (§5.3)', () => {
	// Décision 587 : l'absence de session est le cas normal d'une page anonyme, pas un refus. Un `4xx`
	// serait journalisé en erreur par le navigateur à chaque chargement.
	it('rend 204 sans corps sans cookie — aucune session, et rien d’un refus —, sans rien demander ni effacer', async () => {
		const m = monde()
		const reponse = await traiterSession(requete('prolonger'), m.d)
		expect(reponse.status).toBe(204)
		expect(await reponse.text()).toBe('')
		expect(reponse.headers.get('set-cookie')).toBeNull()
		expect(m.appelsJeton).toEqual([])
		expect(m.appelsBase).toEqual([])
		expect(m.journal).toEqual([{ event: 'session_absente', code: 'aucune', duree_ms: expect.any(Number) }])
	})

	it('rend 204 pour une poignée inconnue, et efface le cookie', async () => {
		const m = monde()
		const reponse = await traiterSession(requete('prolonger', { cookie: COOKIE }), m.d)
		expect(reponse.status).toBe(204)
		expect(reponse.headers.get('set-cookie')).toMatch(/Max-Age=0/)
		expect(m.appelsJeton).toEqual([])
	})

	it('rend 204 et efface le cookie quand la base a supprimé la session entre la lecture et le renouvellement', async () => {
		const sessions = await sessionOuverte()
		const m = monde({ sessions })
		const lire = m.d.appelerBase
		const d = {
			...m.d,
			appelerBase: async (fonction: string, args: Readonly<Record<string, unknown>>, echeance: number) => {
				const resultat = await lire(fonction, args, echeance)
				if (fonction === 'lire_session_serveur') sessions.clear()
				return resultat
			},
		}
		const reponse = await traiterSession(requete('prolonger', { cookie: COOKIE }), d)
		expect(reponse.status).toBe(204)
		expect(reponse.headers.get('set-cookie')).toMatch(/Max-Age=0/)
	})

	it('rafraîchit AVEC LE SECRET et le jeton déchiffré, rejoue l’admission et remplace le jeton gardé', async () => {
		const sessions = await sessionOuverte()
		const m = monde({ sessions })
		const reponse = await traiterSession(requete('prolonger', { cookie: COOKIE }), m.d)
		expect(reponse.status).toBe(200)
		expect(m.appelsJeton).toEqual([{ grant_type: 'refresh_token', client_id: CLIENT, client_secret: SECRET_CLIENT, refresh_token: 'rt-1' }])
		expect(m.appelsBase.map((a) => a.fonction)).toEqual(['lire_session_serveur', 'renouveler_session_serveur'])
		const garde = sessions.get(await empreinteDe(POIGNEE))
		expect(await dechiffrer(garde?.rafraichissement ?? '', await cleDeChiffrement(SECRET_JWT))).toBe('rt-1')
		expect(garde?.rafraichissement).not.toContain('rt-1')
		expect(charge(String((await json(reponse)).jeton)).sub).toBe(SUB)
		expect(reponse.headers.get('set-cookie')).toBeNull()
	})

	it('rend 401 session_expiree quand LeLabs refuse, supprime la session et efface le cookie', async () => {
		const sessions = await sessionOuverte()
		const m = monde({ sessions, pointJeton: async () => ({ statut: 400, corps: { error: 'invalid_grant' } }) })
		const reponse = await traiterSession(requete('prolonger', { cookie: COOKIE }), m.d)
		expect(reponse.status).toBe(401)
		expect(await json(reponse)).toEqual({ erreur: 'session_expiree' })
		expect(reponse.headers.get('set-cookie')).toMatch(/Max-Age=0/)
		expect(sessions.size).toBe(0)
	})

	it('rend 403 attente_verification quand `verified` a été retiré, et ferme la session', async () => {
		const sessions = await sessionOuverte()
		const m = monde({ sessions, jeton: { realm_access: { roles: ['default-roles-lelabs'] } } })
		const reponse = await traiterSession(requete('prolonger', { cookie: COOKIE }), m.d)
		expect(reponse.status).toBe(403)
		expect(await json(reponse)).toEqual({ erreur: 'attente_verification', adresse: 'admin@p2enjoy.test' })
		expect(reponse.headers.get('set-cookie')).toMatch(/Max-Age=0/)
		expect(sessions.size).toBe(0)
	})

	it('rend 403 attente_espace quand l’appartenance a été retirée, et la session est supprimée', async () => {
		const sessions = await sessionOuverte()
		const m = monde({ sessions, admis: false })
		const reponse = await traiterSession(requete('prolonger', { cookie: COOKIE }), m.d)
		expect(reponse.status).toBe(403)
		expect(reponse.headers.get('set-cookie')).toMatch(/Max-Age=0/)
		expect(sessions.size).toBe(0)
	})

	it('refuse un jeton rafraîchi d’une autre personne, et ferme la session', async () => {
		const sessions = await sessionOuverte()
		const m = monde({ sessions, jeton: { sub: '5eed0000-0000-4000-8000-000000000012' } })
		expect((await traiterSession(requete('prolonger', { cookie: COOKIE }), m.d)).status).toBe(401)
		expect(sessions.size).toBe(0)
	})

	it('rend 204 pour un jeton gardé indéchiffrable, et ferme la session', async () => {
		const sessions = new Map([[await empreinteDe(POIGNEE), { sub: SUB, rafraichissement: 'v1.pas-un.chiffre', expire_le: '' }]])
		const m = monde({ sessions })
		const reponse = await traiterSession(requete('prolonger', { cookie: COOKIE }), m.d)
		expect(reponse.status).toBe(204)
		expect(reponse.headers.get('set-cookie')).toMatch(/Max-Age=0/)
		expect(sessions.size).toBe(0)
		expect(m.appelsJeton).toEqual([])
	})

	it('garde la session et le cookie quand LeLabs est seulement injoignable', async () => {
		const sessions = await sessionOuverte()
		const m = monde({ sessions, pointJeton: () => 'panne' })
		const reponse = await traiterSession(requete('prolonger', { cookie: COOKIE }), m.d)
		expect(reponse.status).toBe(502)
		expect(reponse.headers.get('set-cookie')).toBeNull()
		expect(sessions.size).toBe(1)
	})
})

describe('fermer (§5.3)', () => {
	it('supprime la session désignée et efface le cookie', async () => {
		const sessions = await sessionOuverte()
		const m = monde({ sessions })
		const reponse = await traiterSession(requete('fermer', { cookie: COOKIE, origine: 'https://crm.lelabs.tech' }), m.d)
		expect(reponse.status).toBe(204)
		expect(reponse.headers.get('set-cookie')).toBe('p2enjoy_crm_session=; Path=/functions/v1/session; HttpOnly; SameSite=Strict; Secure; Max-Age=0')
		expect(sessions.size).toBe(0)
		expect(m.appelsJeton).toEqual([])
	})

	it('rend 204 sans cookie : fermer ce qui n’existe pas n’est pas une erreur', async () => {
		const m = monde()
		const reponse = await traiterSession(requete('fermer'), m.d)
		expect(reponse.status).toBe(204)
		expect(m.appelsBase).toEqual([])
	})

	it('dit l’échec de la base, et efface le cookie quand même', async () => {
		const m = monde({ panneBase: true })
		const reponse = await traiterSession(requete('fermer', { cookie: COOKIE }), m.d)
		expect(reponse.status).toBe(502)
		expect(reponse.headers.get('set-cookie')).toMatch(/Max-Age=0/)
	})
})

describe('chemins, méthodes, configuration, journal (§5.1, §5.7)', () => {
	it('rend 404 geste_inconnu pour un autre chemin', async () => {
		const reponse = await traiterSession(new Request('http://functions:9000/session/autre', { method: 'POST' }), monde().d)
		expect(reponse.status).toBe(404)
		expect(await json(reponse)).toEqual({ erreur: 'geste_inconnu' })
		expect((await traiterSession(new Request('http://functions:9000/session', { method: 'POST' }), monde().d)).status).toBe(404)
	})

	it('rend 405 methode pour un GET, et répond au préflight sans corps', async () => {
		const get = await traiterSession(requete('prolonger', { methode: 'GET' }), monde().d)
		expect(get.status).toBe(405)
		expect(get.headers.get('allow')).toBe('POST, OPTIONS')
		expect((await traiterSession(requete('ouvrir', { methode: 'OPTIONS' }), monde().d)).status).toBe(204)
	})

	it('rend 502 service_indisponible sans configuration, sans rien tenter', async () => {
		const m = monde()
		const d: DependancesSession = { ...m.d, configuration: null }
		expect((await traiterSession(requete('ouvrir', { corps: CORPS_OUVERTURE }), d)).status).toBe(502)
		expect(m.appelsJeton).toEqual([])
		expect(m.journal[0]).toMatchObject({ event: 'session_refusee', code: 'configuration_absente' })
	})

	it('ne journalise ni jeton, ni poignée, ni code, ni adresse, ni sub', async () => {
		const sessions = await sessionOuverte()
		for (const [geste, options, monde_] of [
			['ouvrir', { corps: CORPS_OUVERTURE }, monde()],
			['prolonger', { cookie: COOKIE }, monde({ sessions })],
			['ouvrir', { corps: CORPS_OUVERTURE }, monde({ admis: false })],
			['fermer', { cookie: COOKIE }, monde({ sessions })],
		] as const) {
			await traiterSession(requete(geste, options), monde_.d)
			const trace = JSON.stringify(monde_.journal)
			for (const secret of [POIGNEE, 'code-lelabs', 'verificateur-pkce', 'rt-1', 'admin@p2enjoy.test', 'Camille', SUB, SECRET_CLIENT]) {
				expect(trace, `${geste} : ${secret}`).not.toContain(secret)
			}
			expect(Object.keys(monde_.journal[0] ?? {}).sort()).toEqual(['code', 'duree_ms', 'event'])
		}
	})
})
