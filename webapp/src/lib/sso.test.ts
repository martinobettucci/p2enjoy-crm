// @verifies CRM-091 (docs/BACKLOG.md) — aller PKCE : transaction, découverte, jugement du retour
// @verifies docs/SPEC-auth.md §10.2 (configuration), §10.3 (parcours), §10.5 (transaction d'onglet)
// @verifies CRM-092 (docs/BACKLOG.md), docs/SPEC-session-sso.md §4 (sans nonce), §8.1 (module révisé :
//           plus d'échange de code dans le navigateur), §9.2 (dictionnaire fermé) ; décision 586
// @verifies CRM-092 (docs/BACKLOG.md), docs/SPEC-session-sso.md §5.5, §9.2 — INC-249, décision 593 :
//           l'attente `attente_administrateur` (espace sans administrateur encore)

import { describe, expect, it, vi } from 'vitest'
import {
	CLE_TRANSACTION_SSO,
	DUREE_TRANSACTION_MS,
	EchecSso,
	NATURES_ATTENTE,
	aleatoire,
	base64url,
	consommerTransaction,
	defiPkce,
	estAttente,
	jugerRetour,
	lireConfigurationSso,
	lireDecouverte,
	natureDe,
	preparerRedirection,
	type ConfigurationSso,
	type StockageTransaction,
	type TransactionSso,
} from './sso'

const CONFIG: ConfigurationSso = { emetteur: 'https://sso.exemple.tld/realms/lelabs', clientId: 'lelabs-crm-serveur' }
const DECOUVERTE = {
	autorisation: 'https://sso.exemple.tld/realms/lelabs/protocol/openid-connect/auth',
}
const POINT_JETON = 'https://sso.exemple.tld/realms/lelabs/protocol/openid-connect/token'

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

describe('primitives PKCE', () => {
	it('rend le défi du vecteur de la RFC 7636, annexe B', async () => {
		expect(await defiPkce('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
			'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
		)
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
		token_endpoint: POINT_JETON,
	}

	it('ne retient que le point d’autorisation : le navigateur ne parle jamais au point de jeton', async () => {
		const requete = vi.fn(async () => reponse(200, document))
		expect(await lireDecouverte(CONFIG, requete)).toEqual(DECOUVERTE)
		expect(requete).toHaveBeenCalledWith(`${CONFIG.emetteur}/.well-known/openid-configuration`)
	})

	it('refuse un autre émetteur que celui configuré', async () => {
		const requete = async () => reponse(200, { ...document, issuer: 'https://autre.tld/realms/lelabs' })
		expect(await nature(lireDecouverte(CONFIG, requete))).toBe('sso_echec')
	})

	it('refuse un point d’autorisation absent ou hors http', async () => {
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
			client_id: 'lelabs-crm-serveur',
			response_type: 'code',
			scope: 'openid email profile',
			redirect_uri: 'https://crm.exemple.tld/auth/retour',
			state: t.state,
			code_challenge: await defiPkce(t.verificateur),
			code_challenge_method: 'S256',
		})
		expect(t).toEqual({
			state: t.state,
			verificateur: t.verificateur,
			retour: '/tracks/conseil-ia',
			redirectUri: 'https://crm.exemple.tld/auth/retour',
			expireA: 1_000 + DUREE_TRANSACTION_MS,
		})
		expect(t.verificateur).toMatch(/^[A-Za-z0-9_-]{43}$/)
	})

	it('n’envoie jamais le vérificateur à Keycloak, et ne demande aucun nonce', async () => {
		const stockage = stockageMemoire()
		const url = await preparerRedirection({
			configuration: CONFIG,
			decouverte: DECOUVERTE,
			origine: 'https://crm.exemple.tld',
			retour: '/',
			stockage,
		})
		const t = JSON.parse(stockage.valeurs.get(CLE_TRANSACTION_SSO) ?? 'null') as TransactionSso
		expect(url).not.toContain(t.verificateur)
		expect(new URL(url).searchParams.has('nonce')).toBe(false)
	})
})

describe('retour : transaction à usage unique', () => {
	const valide: TransactionSso = {
		state: 's1',
		verificateur: 'v1',
		retour: '/',
		redirectUri: 'https://crm.exemple.tld/auth/retour',
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

describe('dictionnaire fermé', () => {
	it('distingue les trois attentes des refus', () => {
		expect(NATURES_ATTENTE).toEqual(['adresse_non_verifiee', 'attente_verification', 'attente_espace', 'attente_administrateur'])
		for (const nature of NATURES_ATTENTE) expect(estAttente(nature)).toBe(true)
		for (const nature of ['sso_annule', 'sso_echec', 'reseau', 'session_expiree', 'configuration'] as const) {
			expect(estAttente(nature)).toBe(false)
		}
	})

	it('rend « échec » pour toute erreur qui n’est pas une étape du parcours', () => {
		expect(natureDe(new Error('inattendue'))).toBe('sso_echec')
		expect(natureDe(new EchecSso('sso_annule'))).toBe('sso_annule')
	})
})
