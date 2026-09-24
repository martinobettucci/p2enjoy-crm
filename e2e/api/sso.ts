// @spec CRM-092 (docs/BACKLOG.md) — connexion SSO réelle et gestes de l'échangeur, pour les preuves
// @spec docs/SPEC-session-sso.md §4 (parcours), §5.1 (trois gestes), §5.6 (cookie de la poignée),
//       §10 (realm confidentiel), §13 ; docs/JOURNAL.md décision 586 (client serveur)
// @spec docs/SPEC-test-harness.md §4.3 (fixtures du projet api)
// @spec docs/JOURNAL.md décision 578 (K2 : cookies `Secure` reportés à la main hors navigateur)
// @spec CLAUDE.md §10 (preuves hors interface, avec les vrais identifiants)
//
// Le parcours est celui de la webapp dans un navigateur — découverte, PKCE `S256`, page de connexion
// du realm, formulaire, retour à l'URL déclarée —, mené par `fetch`, jusqu'au CODE. Le code et son
// vérificateur sont ensuite remis à l'échangeur, qui les échange avec le secret du client : c'est le
// geste d'ouverture de la webapp. Aucun jeton n'est fabriqué. Seul le Keycloak de DÉVELOPPEMENT est
// visé ; le secret du client confidentiel n'est lu ici que pour obtenir, quand une preuve en a besoin,
// un jeton LeLabs brut — ce que le produit, lui, ne remet jamais au navigateur.

import { createHash, randomBytes } from 'node:crypto'
import { cleAnonyme, lireEnv, urlApi } from '../env'

// Ce module ne dépend PAS de `jetons.ts`, qui dépend de lui (`jetonDe`) : un cycle d'imports entre
// modules ESM rend `undefined` une constante lue avant son initialisation (`CRM-092` T4).
const URL_API = urlApi()
const CLE_ANONYME = cleAnonyme()

/**
 * Mot de passe de développement commun aux comptes seedés et au realm de développement.
 *
 * Il est publié dans `docs/SPEC-seed.md` §2.3 et `README.md` : ce n'est pas un secret, mais une
 * donnée de développement sur un domaine `.test`, réservé par la RFC 2606 et non routable. Le realm
 * réel refuse ces comptes (docs/SPEC-session-sso.md §10).
 */
export const MOT_DE_PASSE_SEED = 'SeedDev2026Local'

export const EMETTEUR = lireEnv('SSO_OIDC_ISSUER')
export const CLIENT = lireEnv('SSO_OIDC_CLIENT_ID')
export const DOMAINE = lireEnv('MAIL_DEV_PERSONAL_DOMAIN')
export const RETOUR = `${lireEnv('SITE_URL')}/auth/retour`
/** Le client public du realm de développement qui n'est PAS le CRM (docs/SPEC-session-sso.md §10). */
export const CLIENT_ETRANGER = 'crm-audience-etrangere'
export const NOM_COOKIE = 'p2enjoy_crm_session'

const b64url = (octets: Buffer) => octets.toString('base64url')

export type OptionsConnexion = {
	readonly client?: string
	readonly motDePasse?: string
	/** Omet le défi PKCE : le realm doit alors refuser l'autorisation (M2). */
	readonly sansPkce?: boolean
}

export type CodeObtenu = {
	readonly code: string
	readonly verificateur: string
	readonly redirectUri: string
	readonly client: string
}

/** Adresse d'autorisation d'un parcours, avec son vérificateur. */
export function autorisation(options: OptionsConnexion = {}): { readonly url: string; readonly verificateur: string } {
	const verificateur = b64url(randomBytes(32))
	const params = new URLSearchParams({
		client_id: options.client ?? CLIENT,
		response_type: 'code',
		scope: 'openid email profile',
		redirect_uri: RETOUR,
		state: b64url(randomBytes(16)),
	})
	if (options.sansPkce !== true) {
		params.set('code_challenge', b64url(createHash('sha256').update(verificateur).digest()))
		params.set('code_challenge_method', 'S256')
	}
	return { url: `${EMETTEUR}/protocol/openid-connect/auth?${params}`, verificateur }
}

/**
 * Mène la connexion jusqu'au code rendu à l'URL de retour. Lève en nommant l'étape qui a échoué : un
 * compte absent ou une adresse non prouvée s'arrêtent au formulaire, sans code.
 */
export async function obtenirCode(adresse: string, options: OptionsConnexion = {}): Promise<CodeObtenu> {
	const client = options.client ?? CLIENT
	const { url, verificateur } = autorisation(options)

	// Les cookies du realm sont `Secure` même en `http` : un navigateur les garde sur `*.localhost`,
	// `fetch` ne garde rien. Ils sont reportés à la main (K2).
	const cookies = new Map<string, string>()
	const garder = (reponse: Response) => {
		for (const valeur of reponse.headers.getSetCookie()) {
			const [paire] = valeur.split(';')
			const egal = paire?.indexOf('=') ?? -1
			if (paire && egal > 0) cookies.set(paire.slice(0, egal), paire.slice(egal + 1))
		}
	}

	const page = await fetch(url, { redirect: 'manual' })
	garder(page)
	if (page.status !== 200) throw new Error(`autorisation refusée pour ${adresse} (HTTP ${page.status})`)
	const action = /action="([^"]+)"/.exec(await page.text())?.[1]?.replaceAll('&amp;', '&')
	if (!action) throw new Error(`formulaire de connexion introuvable pour ${adresse}`)

	const connexion = await fetch(action, {
		method: 'POST',
		redirect: 'manual',
		headers: {
			'content-type': 'application/x-www-form-urlencoded',
			cookie: [...cookies].map(([nom, valeur]) => `${nom}=${valeur}`).join('; '),
		},
		body: new URLSearchParams({ username: adresse, password: options.motDePasse ?? MOT_DE_PASSE_SEED }),
	})
	const location = connexion.headers.get('location')
	const code = location?.startsWith(`${RETOUR}?`) ? new URL(location).searchParams.get('code') : null
	if (!code) throw new Error(`connexion LeLabs sans code pour ${adresse} (HTTP ${connexion.status})`)
	return { code, verificateur, redirectUri: RETOUR, client }
}

export type JetonsKeycloak = {
	readonly accessToken: string
	readonly refreshToken: string
	readonly idToken: string
}

/**
 * Jetons LeLabs BRUTS, pour les seules preuves qui doivent en présenter un ailleurs qu'à l'échangeur.
 * Le client du CRM est confidentiel : son secret de développement est lu dans le `.env` du poste. Le
 * client étranger est public et n'en a pas.
 */
export async function connexionPkce(adresse: string, options: OptionsConnexion = {}): Promise<JetonsKeycloak> {
	const obtenu = await obtenirCode(adresse, options)
	const champs = new URLSearchParams({
		grant_type: 'authorization_code',
		client_id: obtenu.client,
		code: obtenu.code,
		redirect_uri: obtenu.redirectUri,
		code_verifier: obtenu.verificateur,
	})
	if (obtenu.client === CLIENT) champs.set('client_secret', lireEnv('SSO_OIDC_CLIENT_SECRET'))
	const jeton = await fetch(`${EMETTEUR}/protocol/openid-connect/token`, {
		method: 'POST',
		headers: { 'content-type': 'application/x-www-form-urlencoded' },
		body: champs,
	})
	if (jeton.status !== 200) throw new Error(`échange du code refusé pour ${adresse} (HTTP ${jeton.status})`)
	const corps = (await jeton.json()) as { access_token: string; refresh_token: string; id_token: string }
	return { accessToken: corps.access_token, refreshToken: corps.refresh_token, idToken: corps.id_token }
}

// --- Les trois gestes de l'échangeur -------------------------------------------------------------

export type ReponseGeste = {
	readonly statut: number
	readonly corps: Record<string, unknown> | null
	/** L'en-tête `Set-Cookie` tel que rendu, ou `null`. */
	readonly setCookie: string | null
	/** La poignée posée par ce geste, ou `null` si aucune ne l'a été. */
	readonly poignee: string | null
}

async function geste(
	nom: string,
	options: { readonly corps?: unknown; readonly poignee?: string | null; readonly methode?: string; readonly enTetes?: Record<string, string> } = {},
): Promise<ReponseGeste> {
	const headers: Record<string, string> = { apikey: CLE_ANONYME, ...(options.enTetes ?? {}) }
	if (options.corps !== undefined) headers['content-type'] = 'application/json'
	if (options.poignee != null) headers.cookie = `${NOM_COOKIE}=${options.poignee}`
	const reponse = await fetch(`${URL_API}/functions/v1/session${nom === '' ? '' : `/${nom}`}`, {
		method: options.methode ?? 'POST',
		headers,
		...(options.corps === undefined ? {} : { body: JSON.stringify(options.corps) }),
	})
	const texte = await reponse.text()
	const setCookie = reponse.headers.get('set-cookie')
	const poignee = setCookie?.startsWith(`${NOM_COOKIE}=`) ? (setCookie.split(';')[0]?.slice(NOM_COOKIE.length + 1) ?? '') : null
	return {
		statut: reponse.status,
		corps: texte === '' ? null : (JSON.parse(texte) as Record<string, unknown>),
		setCookie,
		poignee: poignee === '' ? null : poignee,
	}
}

/** Ouvrir : le code, son vérificateur et l'URL de retour, exactement comme la webapp (§5.2). */
export function ouvrir(obtenu: Pick<CodeObtenu, 'code' | 'verificateur' | 'redirectUri'>): Promise<ReponseGeste> {
	return geste('ouvrir', { corps: { code: obtenu.code, verificateur: obtenu.verificateur, redirect_uri: obtenu.redirectUri } })
}

/** Prolonger : la seule poignée du cookie désigne la session (§5.3). */
export function prolonger(poignee: string | null): Promise<ReponseGeste> {
	return geste('prolonger', { poignee })
}

/** Fermer : supprime la session serveur et efface le cookie (§5.3). */
export function fermer(poignee: string | null): Promise<ReponseGeste> {
	return geste('fermer', { poignee })
}

/** Un geste quelconque, pour les refus de forme : chemin, méthode, corps, en-têtes. */
export function gesteBrut(
	nom: string,
	options: { readonly corps?: unknown; readonly poignee?: string | null; readonly methode?: string; readonly enTetes?: Record<string, string> } = {},
): Promise<ReponseGeste> {
	return geste(nom, options)
}

/** La vraie connexion, puis l'ouverture : ce que fait la webapp de bout en bout. */
export async function ouvrirSession(adresse: string, options: OptionsConnexion = {}): Promise<ReponseGeste> {
	return ouvrir(await obtenirCode(adresse, options))
}

/** Charge utile d'un JWT, décodée sans vérification : pour LIRE ce qu'un jeton porte. */
export function revendications(jeton: string): Record<string, unknown> {
	return JSON.parse(Buffer.from(jeton.split('.')[1] ?? '', 'base64url').toString()) as Record<string, unknown>
}

/** Empreinte SHA-256 d'une poignée, telle que la base la garde (`\x…`, §5.6). */
export function empreinte(poignee: string): string {
	return `\\x${createHash('sha256').update(poignee).digest('hex')}`
}
