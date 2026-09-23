// @verifies CRM-091 (docs/BACKLOG.md) — client OIDC public : PKCE, transaction, découverte, échange
// @verifies docs/SPEC-auth.md §10.2 (configuration), §10.3 (parcours), §10.4 (dictionnaire fermé),
//           §10.5 (transaction d'onglet à usage unique) ; docs/JOURNAL.md décision 568 (M7)

import { describe, expect, it, vi } from 'vitest'
import {
	CLE_TRANSACTION_SSO,
	DUREE_TRANSACTION_MS,
	EchecSso,
	aleatoire,
	base64url,
	classerEchecGoTrue,
	consommerTransaction,
	defiPkce,
	echangerCode,
	jugerRetour,
	lireConfigurationSso,
	lireDecouverte,
	natureDe,
	nonceHache,
	preparerRedirection,
	type ConfigurationSso,
	type StockageTransaction,
	type TransactionSso,
} from './sso'

const CONFIG: ConfigurationSso = { emetteur: 'https://sso.exemple.tld/realms/lelabs', clientId: 'lelabs-crm' }
const DECOUVERTE = {
	autorisation: 'https://sso.exemple.tld/realms/lelabs/protocol/openid-connect/auth',
	jeton: 'https://sso.exemple.tld/realms/lelabs/protocol/openid-connect/token',
}

/** Un `ImportMetaEnv` partiel : seules les deux variables du SSO comptent ici. */
function env(valeurs: { VITE_SSO_ISSUER?: string; VITE_SSO_CLIENT_ID?: string }): ImportMetaEnv {
	return valeurs as unknown as ImportMetaEnv
}

function stockageMemoire(): StockageTransaction & { readonly valeurs: Map<string, string> } {
	const valeurs = new Map<string, string>()
	return {
		valeurs,
		getItem: (cle) => valeurs.get(cle) ?? null,
		setItem: (cle, valeur) => void valeurs.set(cle, valeur),
		removeItem: (cle) => void valeurs.delete(cle),
	}
}

function reponse(statut: number, corps: unknown): Response {
	return new Response(typeof corps === 'string' ? corps : JSON.stringify(corps), { status: statut })
}

async function nature(promesse: Promise<unknown>): Promise<string> {
	try {
		await promesse
		return 'aucune erreur'
	} catch (erreur) {
		return natureDe(erreur)
	}
}

describe('primitives PKCE et nonce', () => {
	it('rend le défi du vecteur de la RFC 7636, annexe B', async () => {
		expect(await defiPkce('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
			'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
		)
	})

	it('hache le nonce envoyé à Keycloak en hexadécimal SHA-256', async () => {
		expect(await nonceHache('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
	})

	it('encode en base64url sans remplissage', () => {
		expect(base64url(new Uint8Array([0xfb, 0xff]))).toBe('-_8')
		expect(base64url(new Uint8Array([]))).toBe('')
	})

	it('tire des valeurs imprévisibles de la longueur attendue', () => {
		const a = aleatoire(32)
		expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/)
		expect(aleatoire(32)).not.toBe(a)
	})
})

describe('configuration figée au build', () => {
	it('est absente si l’une des deux valeurs manque', () => {
		expect(lireConfigurationSso(env({ VITE_SSO_ISSUER: 'https://x' }))).toBeNull()
		expect(lireConfigurationSso(env({ VITE_SSO_CLIENT_ID: 'c' }))).toBeNull()
		expect(lireConfigurationSso(env({ VITE_SSO_ISSUER: ' ', VITE_SSO_CLIENT_ID: 'c' }))).toBeNull()
	})

	it('retire espaces et barre oblique finale de l’émetteur', () => {
		expect(
			lireConfigurationSso(env({ VITE_SSO_ISSUER: ' https://x/realms/lelabs/ ', VITE_SSO_CLIENT_ID: ' c ' })),
		).toEqual({ emetteur: 'https://x/realms/lelabs', clientId: 'c' })
	})
})

describe('découverte', () => {
	const document = {
		issuer: CONFIG.emetteur,
		authorization_endpoint: DECOUVERTE.autorisation,
		token_endpoint: DECOUVERTE.jeton,
	}

	it('lit les deux points d’entrée à l’adresse normalisée', async () => {
		const requete = vi.fn(async () => reponse(200, document))
		expect(await lireDecouverte(CONFIG, requete)).toEqual(DECOUVERTE)
		expect(requete).toHaveBeenCalledWith(`${CONFIG.emetteur}/.well-known/openid-configuration`)
	})

	it('refuse un autre émetteur que celui configuré', async () => {
		const requete = async () => reponse(200, { ...document, issuer: 'https://autre.tld/realms/lelabs' })
		expect(await nature(lireDecouverte(CONFIG, requete))).toBe('sso_echec')
	})

	it('refuse des points d’entrée absents ou hors http', async () => {
		expect(await nature(lireDecouverte(CONFIG, async () => reponse(200, { issuer: CONFIG.emetteur })))).toBe('sso_echec')
		const javascript = { ...document, authorization_endpoint: 'javascript:alert(1)' }
		expect(await nature(lireDecouverte(CONFIG, async () => reponse(200, javascript)))).toBe('sso_echec')
	})

	it('distingue la panne du refus', async () => {
		expect(await nature(lireDecouverte(CONFIG, async () => reponse(503, 'x')))).toBe('reseau')
		expect(await nature(lireDecouverte(CONFIG, async () => reponse(404, 'x')))).toBe('sso_echec')
		expect(await nature(lireDecouverte(CONFIG, async () => Promise.reject(new TypeError('Failed to fetch'))))).toBe(
			'reseau',
		)
		expect(await nature(lireDecouverte(CONFIG, async () => reponse(200, 'pas du json')))).toBe('sso_echec')
	})
})

describe('aller : redirection et transaction', () => {
	it('construit l’adresse exacte et enregistre la transaction correspondante', async () => {
		const stockage = stockageMemoire()
		const url = new URL(
			await preparerRedirection({
				configuration: CONFIG,
				decouverte: DECOUVERTE,
				origine: 'https://crm.exemple.tld',
				retour: '/tracks/conseil-ia',
				stockage,
				maintenant: 1_000,
			}),
		)
		const t = JSON.parse(stockage.valeurs.get(CLE_TRANSACTION_SSO) ?? 'null') as TransactionSso
		expect(`${url.origin}${url.pathname}`).toBe(DECOUVERTE.autorisation)
		expect(Object.fromEntries(url.searchParams)).toEqual({
			client_id: 'lelabs-crm',
			response_type: 'code',
			scope: 'openid email profile',
			redirect_uri: 'https://crm.exemple.tld/auth/retour',
			state: t.state,
			nonce: await nonceHache(t.nonce),
			code_challenge: await defiPkce(t.verificateur),
			code_challenge_method: 'S256',
		})
		expect(t).toMatchObject({
			retour: '/tracks/conseil-ia',
			redirectUri: 'https://crm.exemple.tld/auth/retour',
			pointJeton: DECOUVERTE.jeton,
			expireA: 1_000 + DUREE_TRANSACTION_MS,
		})
		expect(t.verificateur).toMatch(/^[A-Za-z0-9_-]{43}$/)
	})

	it('n’envoie jamais le nonce brut ni le vérificateur à Keycloak', async () => {
		const stockage = stockageMemoire()
		const url = await preparerRedirection({
			configuration: CONFIG,
			decouverte: DECOUVERTE,
			origine: 'https://crm.exemple.tld',
			retour: '/',
			stockage,
		})
		const t = JSON.parse(stockage.valeurs.get(CLE_TRANSACTION_SSO) ?? 'null') as TransactionSso
		expect(url).not.toContain(t.nonce)
		expect(url).not.toContain(t.verificateur)
	})
})

describe('retour : transaction à usage unique', () => {
	const valide: TransactionSso = {
		state: 's1',
		verificateur: 'v1',
		nonce: 'n1',
		retour: '/',
		redirectUri: 'https://crm.exemple.tld/auth/retour',
		pointJeton: DECOUVERTE.jeton,
		expireA: 5_000,
	}

	it('rend la transaction puis la retire', () => {
		const stockage = stockageMemoire()
		stockage.setItem(CLE_TRANSACTION_SSO, JSON.stringify(valide))
		expect(consommerTransaction(stockage, 1_000)).toEqual(valide)
		expect(stockage.valeurs.has(CLE_TRANSACTION_SSO)).toBe(false)
		expect(consommerTransaction(stockage, 1_000)).toBeNull()
	})

	it.each([
		['échue', JSON.stringify(valide), 5_000],
		['illisible', '{pas du json', 1_000],
		['incomplète', JSON.stringify({ ...valide, verificateur: '' }), 1_000],
		['sans échéance', JSON.stringify({ ...valide, expireA: 'demain' }), 1_000],
	])('rejette une transaction %s, et la retire quand même', (_cas, brut, maintenant) => {
		const stockage = stockageMemoire()
		stockage.setItem(CLE_TRANSACTION_SSO, brut)
		expect(consommerTransaction(stockage, maintenant)).toBeNull()
		expect(stockage.valeurs.has(CLE_TRANSACTION_SSO)).toBe(false)
	})

	it('juge l’adresse de retour avant tout échange', () => {
		expect(jugerRetour('?code=c&state=s1', valide)).toEqual({ ok: true, code: 'c' })
		expect(jugerRetour('?code=c&state=s1', null)).toEqual({ ok: false, nature: 'sso_echec' })
		expect(jugerRetour('?code=c&state=autre', valide)).toEqual({ ok: false, nature: 'sso_echec' })
		expect(jugerRetour('?error=access_denied&state=s1', valide)).toEqual({ ok: false, nature: 'sso_annule' })
		expect(jugerRetour('?error=access_denied&state=autre', valide)).toEqual({ ok: false, nature: 'sso_echec' })
		expect(jugerRetour('?error=invalid_request&state=s1', valide)).toEqual({ ok: false, nature: 'sso_echec' })
		expect(jugerRetour('?state=s1', valide)).toEqual({ ok: false, nature: 'sso_echec' })
	})
})

describe('échange du code', () => {
	const t: TransactionSso = {
		state: 's',
		verificateur: 'le-verificateur',
		nonce: 'n',
		retour: '/',
		redirectUri: 'https://crm.exemple.tld/auth/retour',
		pointJeton: DECOUVERTE.jeton,
		expireA: Number.MAX_SAFE_INTEGER,
	}

	it('poste exactement les cinq paramètres d’un client public et ne rend que l’id_token', async () => {
		const requete = vi.fn(async (_url: string, _init?: RequestInit) =>
			reponse(200, { id_token: 'jeton.id', access_token: 'jamais-rendu', refresh_token: 'jamais-rendu' }),
		)
		expect(await echangerCode(CONFIG, t, 'le-code', requete as unknown as typeof fetch)).toBe('jeton.id')
		const [url, init] = requete.mock.calls[0] ?? []
		expect(url).toBe(DECOUVERTE.jeton)
		expect(init?.method).toBe('POST')
		expect(Object.fromEntries(new URLSearchParams(String(init?.body)))).toEqual({
			grant_type: 'authorization_code',
			client_id: 'lelabs-crm',
			code: 'le-code',
			redirect_uri: 'https://crm.exemple.tld/auth/retour',
			code_verifier: 'le-verificateur',
		})
	})

	it('classe chaque échec sans rendre le corps du serveur', async () => {
		expect(await nature(echangerCode(CONFIG, t, 'c', async () => reponse(400, { error: 'invalid_grant' })))).toBe('sso_echec')
		expect(await nature(echangerCode(CONFIG, t, 'c', async () => reponse(502, 'x')))).toBe('reseau')
		expect(await nature(echangerCode(CONFIG, t, 'c', async () => Promise.reject(new TypeError('x'))))).toBe('reseau')
		expect(await nature(echangerCode(CONFIG, t, 'c', async () => reponse(200, { access_token: 'a' })))).toBe('sso_echec')
	})
})

describe('refus de GoTrue', () => {
	it('nomme « sans compte » le refus que GoTrue rend aux deux causes mesurées', () => {
		expect(classerEchecGoTrue({ status: 422, code: 'signup_disabled' })).toBe('sso_sans_compte')
	})

	it('classe le reste sans jamais deviner', () => {
		expect(classerEchecGoTrue({ status: 400, message: 'Nonces mismatch' })).toBe('sso_echec')
		expect(classerEchecGoTrue({ status: 400, message: 'Unacceptable audience in id_token' })).toBe('sso_echec')
		expect(classerEchecGoTrue({ status: 500 })).toBe('reseau')
		expect(classerEchecGoTrue({ status: 0 })).toBe('reseau')
		expect(classerEchecGoTrue({ message: 'Failed to fetch' })).toBe('reseau')
	})

	it('rend « échec » pour toute erreur qui n’est pas une étape du parcours', () => {
		expect(natureDe(new Error('inattendue'))).toBe('sso_echec')
		expect(natureDe(new EchecSso('sso_annule'))).toBe('sso_annule')
	})
})
