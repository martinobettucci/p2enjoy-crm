// @spec CRM-092 (docs/BACKLOG.md) — connexion SSO réelle et échange de session, pour les preuves
// @spec docs/SPEC-session-sso.md §4 (parcours), §5.1 (requête à l'échangeur), §10 (realm), §13
// @spec docs/SPEC-test-harness.md §4.3 (fixtures du projet api)
// @spec docs/JOURNAL.md décision 578 (K2 : cookies `Secure` reportés à la main hors navigateur)
// @spec CLAUDE.md §10 (preuves hors interface, avec les vrais identifiants)
//
// Le parcours est celui de la webapp dans un navigateur — découverte, PKCE `S256`, page de connexion
// du realm, formulaire, retour à l'URL déclarée, échange du code —, mené par `fetch`. Aucun jeton
// n'est fabriqué : le realm émet, l'échangeur vérifie. Seul le Keycloak de DÉVELOPPEMENT est visé.

import { createHash, randomBytes } from 'node:crypto'
import { lireEnv } from '../env'
import { CLE_ANONYME, MOT_DE_PASSE_SEED, URL_API } from './jetons'

export const EMETTEUR = lireEnv('SSO_OIDC_ISSUER')
export const CLIENT = lireEnv('SSO_OIDC_CLIENT_ID')
export const DOMAINE = lireEnv('MAIL_DEV_PERSONAL_DOMAIN')
export const RETOUR = `${lireEnv('SITE_URL')}/auth/retour`

const b64url = (octets: Buffer) => octets.toString('base64url')

export type JetonsKeycloak = {
	readonly accessToken: string
	readonly refreshToken: string
	readonly idToken: string
}

export type OptionsConnexion = {
	readonly client?: string
	readonly motDePasse?: string
}

/**
 * Mène la connexion et rend les trois jetons émis par le realm. Lève en nommant l'étape qui a échoué :
 * un compte absent ou une adresse non prouvée s'arrêtent au formulaire, sans code.
 */
export async function connexionPkce(adresse: string, options: OptionsConnexion = {}): Promise<JetonsKeycloak> {
	const client = options.client ?? CLIENT
	const verificateur = b64url(randomBytes(32))
	const params = new URLSearchParams({
		client_id: client,
		response_type: 'code',
		scope: 'openid email profile',
		redirect_uri: RETOUR,
		state: b64url(randomBytes(16)),
		code_challenge: b64url(createHash('sha256').update(verificateur).digest()),
		code_challenge_method: 'S256',
	})

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

	const page = await fetch(`${EMETTEUR}/protocol/openid-connect/auth?${params}`, { redirect: 'manual' })
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

	const jeton = await fetch(`${EMETTEUR}/protocol/openid-connect/token`, {
		method: 'POST',
		headers: { 'content-type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({
			grant_type: 'authorization_code',
			client_id: client,
			code,
			redirect_uri: RETOUR,
			code_verifier: verificateur,
		}),
	})
	if (jeton.status !== 200) throw new Error(`échange du code refusé pour ${adresse} (HTTP ${jeton.status})`)
	const corps = (await jeton.json()) as { access_token: string; refresh_token: string; id_token: string }
	return { accessToken: corps.access_token, refreshToken: corps.refresh_token, idToken: corps.id_token }
}

/** Rafraîchit chez LeLabs, comme la webapp le fera (K15). */
export async function rafraichir(jetonRafraichissement: string): Promise<{ statut: number; accessToken?: string }> {
	const reponse = await fetch(`${EMETTEUR}/protocol/openid-connect/token`, {
		method: 'POST',
		headers: { 'content-type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({ grant_type: 'refresh_token', client_id: CLIENT, refresh_token: jetonRafraichissement }),
	})
	const corps = (await reponse.json()) as { access_token?: string }
	return reponse.status === 200 && corps.access_token ? { statut: 200, accessToken: corps.access_token } : { statut: reponse.status }
}

export type ReponseEchange = { readonly statut: number; readonly corps: Record<string, unknown> }

/** L'appel que la webapp fait : la passerelle, la clé publique, le jeton LeLabs en `Authorization`. */
export async function echangerSession(jetonAcces: string | null, methode = 'POST'): Promise<ReponseEchange> {
	const headers: Record<string, string> = { apikey: CLE_ANONYME }
	if (jetonAcces !== null) headers.authorization = `Bearer ${jetonAcces}`
	const reponse = await fetch(`${URL_API}/functions/v1/session`, { method: methode, headers })
	return { statut: reponse.status, corps: (await reponse.json()) as Record<string, unknown> }
}

/** Charge utile d'un JWT, décodée sans vérification : pour LIRE ce qu'un jeton porte. */
export function revendications(jeton: string): Record<string, unknown> {
	return JSON.parse(Buffer.from(jeton.split('.')[1] ?? '', 'base64url').toString()) as Record<string, unknown>
}
