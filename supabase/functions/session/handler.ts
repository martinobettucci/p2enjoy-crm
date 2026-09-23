// @spec CRM-092 (docs/BACKLOG.md) — échangeur de session : jeton LeLabs vérifié contre jeton interne
// @spec docs/SPEC-session-sso.md §5.1 (requête), §5.2 (vérifications ordonnées), §5.3 (jeton interne),
//       §5.4 (refus, dictionnaire fermé), §5.5 (journal), §6.1 (admission)
// @spec docs/SSO-client-lelabs-crm.md (« À vérifier côté application ») ; docs/SSO.md (rôles)
// @spec docs/JOURNAL.md décisions 578 (K3), 579 (A1, A2), 580 (K14)
// @spec CLAUDE.md §10 (la règle d'accès est appliquée côté serveur), §20 (journal sans secret)
//
// Module pur : toute entrée-sortie passe par `DependancesSession`, ce qui rend chaque refus
// prouvable sans réseau. L'ordre des vérifications est celui du §5.2 : RIEN n'est lu chez LeLabs
// avant d'avoir écarté un algorithme refusé, et RIEN n'est écrit en base avant que le jeton, l'adresse
// et le rôle `verified` n'aient été établis.

import { algorithmeAccepte, cleCompatible, lireJws, signerHs256, verifierSignature } from './jws.ts'

export type ConfigurationSession = {
	/** Émetteur EXACT attendu dans les jetons et dans la découverte (`SSO_OIDC_ISSUER`). */
	readonly emetteur: string
	/** Seule application acceptée dans `azp` (`SSO_OIDC_CLIENT_ID`). */
	readonly clientId: string
	/** Clé de signature du jeton interne (`JWT_SECRET`). */
	readonly secretJwt: string
}

export type ResultatOuverture = { readonly admis: boolean; readonly nom: string | null }

export type DependancesSession = {
	readonly configuration: ConfigurationSession | null
	/** Lit un document JSON chez LeLabs ; LÈVE sur panne réseau, délai dépassé ou réponse non 2xx. */
	readonly lireJson: (url: string) => Promise<unknown>
	/** `public.ouvrir_session_sso` (§6.2) ; LÈVE si l'appel échoue. */
	readonly ouvrirSession: (sub: string, adresse: string, nom: string) => Promise<ResultatOuverture>
	/** Instant présent, en secondes. */
	readonly maintenant: () => number
	readonly journaliser: (evenement: Readonly<Record<string, unknown>>) => void
}

/** Dictionnaire fermé du §5.4. */
export type CodeRefus =
	| 'jeton_refuse'
	| 'adresse_non_verifiee'
	| 'attente_verification'
	| 'attente_espace'
	| 'methode'
	| 'sso_injoignable'
	| 'service_indisponible'

export const ROLE_REQUIS = 'verified'
export const EMETTEUR_INTERNE = 'p2enjoy-crm/session'
/** Au plus 300 s, et jamais au-delà du jeton LeLabs (§5.3). */
export const DUREE_MAX_JETON_INTERNE = 300
/** Tolérance d'un `iat` dans le futur, pour une horloge de fournisseur légèrement en avance. */
export const AVANCE_IAT_TOLEREE = 60

const ALLOW = 'POST, OPTIONS'
const EN_TETES = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const BEARER = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/

class Refus extends Error {
	readonly code: CodeRefus
	readonly adresse: string | null
	constructor(code: CodeRefus, adresse: string | null = null) {
		super(code)
		this.code = code
		this.adresse = adresse
	}
}

const STATUT: Readonly<Record<CodeRefus, number>> = {
	jeton_refuse: 401,
	adresse_non_verifiee: 403,
	attente_verification: 403,
	attente_espace: 403,
	methode: 405,
	sso_injoignable: 502,
	service_indisponible: 502,
}

function repondre(status: number, corps: Readonly<Record<string, unknown>>, extra: Record<string, string> = {}): Response {
	return new Response(JSON.stringify(corps), { status, headers: { ...EN_TETES, ...extra } })
}

function reponseRefus(refus: Refus): Response {
	const corps: Record<string, unknown> = { erreur: refus.code }
	const attente = refus.code === 'adresse_non_verifiee' || refus.code === 'attente_verification' || refus.code === 'attente_espace'
	if (attente) corps.adresse = refus.adresse
	return repondre(STATUT[refus.code], corps, refus.code === 'methode' ? { allow: ALLOW } : {})
}

/**
 * Un `jwks_uri` n'est suivi qu'en `https:`, ou en `http:` vers la boucle locale ou `*.localhost` —
 * le seul Keycloak de développement (§5.2, point 3).
 */
export function adresseClesAcceptable(valeur: unknown): valeur is string {
	if (typeof valeur !== 'string') return false
	let url: URL
	try {
		url = new URL(valeur)
	} catch {
		return false
	}
	if (url.protocol === 'https:') return true
	if (url.protocol !== 'http:') return false
	const hote = url.hostname
	return hote === 'localhost' || hote.endsWith('.localhost') || hote === '127.0.0.1' || hote === '[::1]'
}

async function lireChezLeLabs(d: DependancesSession, url: string): Promise<Record<string, unknown>> {
	let document: unknown
	try {
		document = await d.lireJson(url)
	} catch {
		throw new Refus('sso_injoignable')
	}
	if (document === null || typeof document !== 'object' || Array.isArray(document)) throw new Refus('sso_injoignable')
	return document as Record<string, unknown>
}

function nomDesRevendications(charge: Readonly<Record<string, unknown>>): string {
	if (typeof charge.name === 'string' && charge.name.trim() !== '') return charge.name
	const parties = [charge.given_name, charge.family_name].filter((p): p is string => typeof p === 'string' && p.trim() !== '')
	return parties.join(' ')
}

type SessionOuverte = { readonly jeton: string; readonly expireA: number; readonly sub: string; readonly adresse: string; readonly nom: string }

async function echanger(requete: Request, d: DependancesSession, configuration: ConfigurationSession): Promise<SessionOuverte> {
	// §5.2, point 1 — la forme.
	const brut = BEARER.exec(requete.headers.get('authorization') ?? '')?.[1]
	if (brut === undefined) throw new Refus('jeton_refuse')
	const jws = lireJws(brut)
	if (jws === null) throw new Refus('jeton_refuse')

	// §5.2, point 2 — l'algorithme, AVANT toute lecture de clé : aucun jeton symétrique n'est essayé.
	const alg = jws.entete.alg
	if (!algorithmeAccepte(alg)) throw new Refus('jeton_refuse')
	const kid = jws.entete.kid
	if (typeof kid !== 'string' || kid === '') throw new Refus('jeton_refuse')

	// §5.2, point 3 — la découverte, et son émetteur exact.
	const decouverte = await lireChezLeLabs(d, `${configuration.emetteur}/.well-known/openid-configuration`)
	if (decouverte.issuer !== configuration.emetteur || !adresseClesAcceptable(decouverte.jwks_uri)) {
		throw new Refus('sso_injoignable')
	}

	// §5.2, point 4 — les clés, relues à chaque échange : aucune n'est épinglée ni gardée.
	const jwks = await lireChezLeLabs(d, decouverte.jwks_uri)
	if (!Array.isArray(jwks.keys)) throw new Refus('sso_injoignable')
	const cle = (jwks.keys as unknown[]).find(
		(k): k is Record<string, unknown> =>
			k !== null && typeof k === 'object' && (k as Record<string, unknown>).kid === kid && cleCompatible(alg, k as Record<string, unknown>),
	)
	if (cle === undefined) throw new Refus('jeton_refuse')

	// §5.2, point 5 — la signature.
	if (!(await verifierSignature(alg, cle, jws.signe, jws.signature))) throw new Refus('jeton_refuse')

	// §5.2, point 6 — les revendications.
	const c = jws.charge
	const maintenant = d.maintenant()
	if (c.iss !== configuration.emetteur) throw new Refus('jeton_refuse')
	if (c.azp !== configuration.clientId) throw new Refus('jeton_refuse')
	if (c.typ !== 'Bearer') throw new Refus('jeton_refuse')
	if (typeof c.exp !== 'number' || !(c.exp > maintenant)) throw new Refus('jeton_refuse')
	if (c.iat !== undefined && (typeof c.iat !== 'number' || c.iat > maintenant + AVANCE_IAT_TOLEREE)) {
		throw new Refus('jeton_refuse')
	}
	if (typeof c.sub !== 'string' || !UUID.test(c.sub)) throw new Refus('jeton_refuse')
	const sub = c.sub.toLowerCase()

	// §5.2, point 7 — l'admission (§6.1) : adresse vérifiée, puis PRÉSENCE de `verified`.
	const adresse = typeof c.email === 'string' && c.email.trim() !== '' ? c.email.trim().toLowerCase() : null
	if (adresse === null || c.email_verified !== true) throw new Refus('adresse_non_verifiee', adresse)
	const roles = (c.realm_access as Record<string, unknown> | undefined)?.roles
	if (!Array.isArray(roles) || !roles.includes(ROLE_REQUIS)) throw new Refus('attente_verification', adresse)

	const nomSso = nomDesRevendications(c)
	let ouverture: ResultatOuverture
	try {
		ouverture = await d.ouvrirSession(sub, adresse, nomSso)
	} catch {
		throw new Refus('service_indisponible')
	}
	if (!ouverture.admis) throw new Refus('attente_espace', adresse)

	// §5.3 — le jeton interne : jamais au-delà du jeton LeLabs, au plus 300 s.
	const expireA = Math.min(c.exp, maintenant + DUREE_MAX_JETON_INTERNE)
	const jeton = await signerHs256(
		{ iss: EMETTEUR_INTERNE, sub, aud: 'authenticated', role: 'authenticated', iat: maintenant, exp: expireA },
		configuration.secretJwt,
	)
	return { jeton, expireA, sub, adresse, nom: ouverture.nom ?? nomSso }
}

export async function traiterSession(requete: Request, d: DependancesSession): Promise<Response> {
	if (requete.method === 'OPTIONS') return new Response(null, { status: 204, headers: { allow: ALLOW } })
	const debut = Date.now()
	const conclure = (evenement: string, code: string) =>
		d.journaliser({ event: evenement, code, duree_ms: Date.now() - debut })

	if (requete.method !== 'POST') {
		conclure('session_refusee', 'methode')
		return reponseRefus(new Refus('methode'))
	}
	// Le corps est sans objet, mais consommé : un flux abandonné peut retenir un isolate (décision 286).
	await requete.arrayBuffer()

	if (d.configuration === null) {
		conclure('session_refusee', 'configuration_absente')
		return reponseRefus(new Refus('service_indisponible'))
	}

	try {
		const session = await echanger(requete, d, d.configuration)
		conclure('session_ouverte', 'ok')
		return repondre(200, {
			jeton: session.jeton,
			expire_a: session.expireA,
			identite: { id: session.sub, adresse: session.adresse, nom: session.nom },
		})
	} catch (erreur) {
		const refus = erreur instanceof Refus ? erreur : new Refus('service_indisponible')
		conclure('session_refusee', refus.code)
		return reponseRefus(refus)
	}
}
