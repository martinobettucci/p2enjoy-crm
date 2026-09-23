// @verifies CRM-091 (docs/BACKLOG.md) — connexion unique : ce que GoTrue fait d'un id_token Keycloak
// @verifies docs/SPEC-auth.md §10.1 (GoTrue seul juge), §10.6 (règle d'accès côté serveur),
//           §10.7 (revendications conservées), §10.9 (realm de développement), §10.10 (preuves)
// @verifies docs/JOURNAL.md décision 568 — mesures M2 à M10, rejouées contre la pile réelle
//
// Aucune de ces preuves ne passe par l'interface. Le parcours PKCE est mené ici comme un navigateur
// le mènerait — page de connexion de Keycloak comprise —, puis l'`id_token` est remis à GoTrue par
// la vraie passerelle. Les refus sont ceux du SERVEUR, avec les vrais comptes du realm.

import { createHash, randomBytes } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { lireEnv } from '../env'
import { CLE_ANONYME, COMPTES_SEED, URL_API, enTetesAuthentifies, enTetesService } from './jetons'

const EMETTEUR = lireEnv('SSO_OIDC_ISSUER')
const CLIENT = lireEnv('SSO_OIDC_CLIENT_ID')
const DOMAINE = lireEnv('MAIL_DEV_PERSONAL_DOMAIN')
const SITE = lireEnv('SITE_URL')
const RETOUR = `${SITE}/auth/retour`
const BASE_KEYCLOAK = EMETTEUR.replace(/\/realms\/lelabs$/, '')
const MOT_DE_PASSE_SSO = 'SsoDev2026Local'

test.describe.configure({ mode: 'serial' })

const b64url = (octets: Buffer) => octets.toString('base64url')
const sha256 = (texte: string) => createHash('sha256').update(texte).digest()

type IssueKeycloak =
	| { readonly etape: 'jeton'; readonly idToken: string; readonly revendications: Record<string, unknown> }
	| { readonly etape: 'autorisation' | 'connexion'; readonly statut: number; readonly location: string | null }

/**
 * Mène le code d'autorisation comme un navigateur : page de connexion, formulaire, retour, échange.
 * `pkce: false` omet le défi, pour éprouver le refus du realm (M2).
 */
async function parcoursKeycloak(
	adresse: string,
	nonceBrut: string | null,
	options: { readonly pkce?: boolean; readonly client?: string } = {},
): Promise<IssueKeycloak> {
	const client = options.client ?? CLIENT
	const verificateur = b64url(randomBytes(32))
	const params = new URLSearchParams({
		client_id: client,
		response_type: 'code',
		scope: 'openid email profile',
		redirect_uri: RETOUR,
		state: b64url(randomBytes(16)),
	})
	if (options.pkce !== false) {
		params.set('code_challenge', b64url(sha256(verificateur)))
		params.set('code_challenge_method', 'S256')
	}
	if (nonceBrut !== null) params.set('nonce', sha256(nonceBrut).toString('hex'))

	const cookies = new Map<string, string>()
	const garder = (reponse: Response) => {
		for (const valeur of reponse.headers.getSetCookie()) {
			const [paire] = valeur.split(';')
			const egal = paire?.indexOf('=') ?? -1
			if (paire && egal > 0) cookies.set(paire.slice(0, egal), paire.slice(egal + 1))
		}
	}
	const enTeteCookies = () => [...cookies].map(([nom, valeur]) => `${nom}=${valeur}`).join('; ')

	const page = await fetch(`${EMETTEUR}/protocol/openid-connect/auth?${params}`, { redirect: 'manual' })
	garder(page)
	if (page.status !== 200) return { etape: 'autorisation', statut: page.status, location: page.headers.get('location') }
	const action = /action="([^"]+)"/.exec(await page.text())?.[1]?.replaceAll('&amp;', '&')
	if (!action) throw new Error('Formulaire de connexion Keycloak introuvable.')

	const connexion = await fetch(action, {
		method: 'POST',
		redirect: 'manual',
		headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: enTeteCookies() },
		body: new URLSearchParams({ username: adresse, password: MOT_DE_PASSE_SSO }),
	})
	const location = connexion.headers.get('location')
	const code = location === null ? null : new URL(location).searchParams.get('code')
	if (code === null) return { etape: 'connexion', statut: connexion.status, location }

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
	expect(jeton.status, 'échange du code chez Keycloak').toBe(200)
	const idToken = ((await jeton.json()) as { id_token: string }).id_token
	const revendications = JSON.parse(Buffer.from(idToken.split('.')[1] ?? '', 'base64url').toString()) as Record<
		string,
		unknown
	>
	return { etape: 'jeton', idToken, revendications }
}

async function idTokenDe(adresse: string, nonceBrut: string, client?: string): Promise<string> {
	const issue = await parcoursKeycloak(adresse, nonceBrut, client === undefined ? {} : { client })
	if (issue.etape !== 'jeton') throw new Error(`Keycloak n'a pas émis de jeton pour ${adresse} : ${JSON.stringify(issue)}`)
	return issue.idToken
}

/** L'échange que la webapp fait — même route, même clé publique, même corps. */
async function echangeGoTrue(idToken: string, nonce: string | null) {
	const reponse = await fetch(`${URL_API}/auth/v1/token?grant_type=id_token`, {
		method: 'POST',
		headers: { apikey: CLE_ANONYME, 'content-type': 'application/json' },
		body: JSON.stringify(nonce === null ? { provider: 'keycloak', id_token: idToken } : { provider: 'keycloak', id_token: idToken, nonce }),
	})
	return { statut: reponse.status, corps: (await reponse.json()) as Record<string, unknown> }
}

async function adminKeycloak(): Promise<string> {
	const reponse = await fetch(`${BASE_KEYCLOAK}/realms/master/protocol/openid-connect/token`, {
		method: 'POST',
		headers: { 'content-type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({
			client_id: 'admin-cli',
			username: 'admin',
			password: lireEnv('SSO_DEV_ADMIN_PASSWORD'),
			grant_type: 'password',
		}),
	})
	expect(reponse.status, 'jeton d’administration du Keycloak de développement').toBe(200)
	return ((await reponse.json()) as { access_token: string }).access_token
}

/**
 * Comptes GoTrue portant cette adresse, lus UN PAR UN : la liste d'administration rend
 * `identities: null`, seule la lecture d'un compte porte ses identités (mesuré).
 */
async function utilisateursGoTrue(adresse: string): Promise<Array<Record<string, unknown>>> {
	const reponse = await fetch(`${URL_API}/auth/v1/admin/users?per_page=1000`, { headers: enTetesService() })
	const corps = (await reponse.json()) as { users: Array<{ id: string; email?: string }> }
	const ids = corps.users.filter((u) => u.email === adresse).map((u) => u.id)
	return Promise.all(
		ids.map(async (id) => {
			const detail = await fetch(`${URL_API}/auth/v1/admin/users/${id}`, { headers: enTetesService() })
			return (await detail.json()) as Record<string, unknown>
		}),
	)
}

test('M2 — le realm refuse une autorisation sans PKCE, et le dit par une redirection', async () => {
	const issue = await parcoursKeycloak(`admin@${DOMAINE}`, null, { pkce: false })
	expect(issue.etape).toBe('autorisation')
	if (issue.etape === 'jeton') return
	expect(issue.statut).toBe(302)
	const location = new URL(issue.location ?? '')
	expect(`${location.origin}${location.pathname}`).toBe(RETOUR)
	expect(location.searchParams.get('error')).toBe('invalid_request')
	expect(location.searchParams.get('error_description')).toBe('Missing parameter: code_challenge_method')
})

test('M3 — un compte du realm sans compte CRM est refusé par GoTrue', async () => {
	const nonce = b64url(randomBytes(16))
	const { statut, corps } = await echangeGoTrue(await idTokenDe(`inconnu@${DOMAINE}`, nonce), nonce)
	expect(statut).toBe(422)
	expect(corps.error_code ?? corps.code).toBe('signup_disabled')
	expect(await utilisateursGoTrue(`inconnu@${DOMAINE}`)).toHaveLength(0)
})

test('M4 — un compte CRM existant est rattaché, sans second compte, et sa session lit ses données', async () => {
	const adresse = COMPTES_SEED[0].adresse
	const [avant] = await utilisateursGoTrue(adresse)
	expect(avant, 'compte seedé présent').toBeDefined()

	for (let passage = 0; passage < 2; passage++) {
		const nonce = b64url(randomBytes(16))
		const { statut, corps } = await echangeGoTrue(await idTokenDe(adresse, nonce), nonce)
		expect(statut).toBe(200)
		expect((corps.user as { id: string }).id).toBe(avant?.id)

		// La session ouverte par le SSO est une vraie session du CRM : la RLS lui consent l'espace.
		const espaces = await fetch(`${URL_API}/rest/v1/workspaces?select=id`, {
			headers: enTetesAuthentifies(corps.access_token as string),
		})
		expect(espaces.status).toBe(200)
		expect(((await espaces.json()) as unknown[]).length).toBeGreaterThan(0)
	}

	const apres = await utilisateursGoTrue(adresse)
	expect(apres).toHaveLength(1)
	const identites = (apres[0]?.identities as Array<{ provider: string }>).map((i) => i.provider).sort()
	expect(identites).toEqual(['email', 'keycloak'])
})

test('M5 — une adresse non vérifiée auprès du SSO n’ouvre JAMAIS le compte CRM de même adresse', async () => {
	const adresse = `adresse-non-verifiee@${DOMAINE}`
	const creation = await fetch(`${URL_API}/auth/v1/admin/users`, {
		method: 'POST',
		headers: { ...enTetesService(), 'content-type': 'application/json' },
		body: JSON.stringify({ email: adresse, password: b64url(randomBytes(24)), email_confirm: true }),
	})
	expect(creation.status).toBe(200)
	const idCrm = ((await creation.json()) as { id: string }).id
	const admin = await adminKeycloak()
	const realm = `${BASE_KEYCLOAK}/admin/realms/lelabs`
	const regler = (verifyEmail: boolean) =>
		fetch(realm, {
			method: 'PUT',
			headers: { authorization: `Bearer ${admin}`, 'content-type': 'application/json' },
			body: JSON.stringify({ verifyEmail }),
		})
	try {
		// Le realm exige la vérification d'adresse : il faut la lever le temps d'émettre un jeton
		// `email_verified=false`, cas que docs/SSO.md décrit (un administrateur vérifie une personne
		// dont l'adresse ne l'est pas encore).
		expect((await regler(false)).status).toBe(204)
		const nonce = b64url(randomBytes(16))
		const issue = await parcoursKeycloak(adresse, nonce)
		expect(issue.etape).toBe('jeton')
		if (issue.etape !== 'jeton') return
		expect(issue.revendications.email_verified).toBe(false)

		const { statut, corps } = await echangeGoTrue(issue.idToken, nonce)
		expect(statut).toBe(422)
		expect(corps.error_code ?? corps.code).toBe('signup_disabled')
		const [compte] = await utilisateursGoTrue(adresse)
		expect((compte?.identities as Array<{ provider: string }>).map((i) => i.provider)).toEqual(['email'])
	} finally {
		expect((await regler(true)).status).toBe(204)
		await fetch(`${URL_API}/auth/v1/admin/users/${idCrm}`, { method: 'DELETE', headers: enTetesService() })
	}
})

test('M6 — une invitation non acceptée est acceptée par le SSO, comme par le lien du courriel', async () => {
	const adresse = `sso-invite-${b64url(randomBytes(6)).toLowerCase()}@${DOMAINE}`
	const admin = await adminKeycloak()
	const utilisateurs = `${BASE_KEYCLOAK}/admin/realms/lelabs/users`
	const creationSso = await fetch(utilisateurs, {
		method: 'POST',
		headers: { authorization: `Bearer ${admin}`, 'content-type': 'application/json' },
		body: JSON.stringify({
			username: adresse,
			email: adresse,
			emailVerified: true,
			enabled: true,
			firstName: 'Invitée',
			lastName: 'Preuve',
			credentials: [{ type: 'password', value: MOT_DE_PASSE_SSO, temporary: false }],
		}),
	})
	expect(creationSso.status).toBe(201)
	const idSso = creationSso.headers.get('location')?.split('/').pop()
	let idCrm: string | undefined
	try {
		const invitation = await fetch(`${URL_API}/auth/v1/invite`, {
			method: 'POST',
			headers: { ...enTetesService(), 'content-type': 'application/json' },
			body: JSON.stringify({ email: adresse }),
		})
		expect(invitation.status).toBe(200)
		idCrm = ((await invitation.json()) as { id: string }).id
		const [invite] = await utilisateursGoTrue(adresse)
		expect(invite?.email_confirmed_at ?? null).toBeNull()

		const nonce = b64url(randomBytes(16))
		const { statut, corps } = await echangeGoTrue(await idTokenDe(adresse, nonce), nonce)
		expect(statut).toBe(200)
		expect((corps.user as { id: string }).id).toBe(idCrm)
		const [accepte] = await utilisateursGoTrue(adresse)
		expect(accepte?.email_confirmed_at).toBeTruthy()
	} finally {
		if (idCrm) await fetch(`${URL_API}/auth/v1/admin/users/${idCrm}`, { method: 'DELETE', headers: enTetesService() })
		if (idSso) await fetch(`${utilisateurs}/${idSso}`, { method: 'DELETE', headers: { authorization: `Bearer ${admin}` } })
	}
})

test('M7 — un nonce faux ou absent est refusé', async () => {
	const nonce = b64url(randomBytes(16))
	const idToken = await idTokenDe(COMPTES_SEED[0].adresse, nonce)
	const faux = await echangeGoTrue(idToken, 'un-autre-nonce')
	expect(faux.statut).toBe(400)
	expect(String(faux.corps.error_description ?? faux.corps.msg)).toMatch(/nonce/i)
	const absent = await echangeGoTrue(idToken, null)
	expect(absent.statut).toBe(400)
	expect(String(absent.corps.error_description ?? absent.corps.msg)).toMatch(/nonce/i)
})

test('M8 — un jeton émis pour un autre client du realm est refusé', async () => {
	const nonce = b64url(randomBytes(16))
	const { statut, corps } = await echangeGoTrue(await idTokenDe(COMPTES_SEED[0].adresse, nonce, 'crm-audience-etrangere'), nonce)
	expect(statut).toBe(400)
	expect(String(corps.error_description ?? corps.msg)).toMatch(/audience/i)
})

test('M9 — la voie /authorize sans PKCE de GoTrue est fermée d’elle-même', async () => {
	const reponse = await fetch(`${URL_API}/auth/v1/authorize?provider=keycloak`, {
		redirect: 'manual',
		headers: { apikey: CLE_ANONYME },
	})
	expect(reponse.status).toBe(400)
	expect(JSON.stringify(await reponse.json())).toContain('missing OAuth secret')
})

test('M10 — GoTrue ne conserve ni téléphone, ni profil déclaré, ni rôle du realm', async () => {
	const [compte] = await utilisateursGoTrue(COMPTES_SEED[0].adresse)
	const identite = (compte?.identities as Array<{ provider: string; identity_data: Record<string, unknown> }>).find(
		(i) => i.provider === 'keycloak',
	)
	expect(identite, 'identité keycloak rattachée par M4').toBeDefined()
	const cles = Object.keys(identite?.identity_data ?? {})
	for (const interdite of ['phone', 'phone_number', 'telephone', 'profile', 'profilVerification', 'realm_access', 'roles']) {
		expect(cles, `identity_data ne doit pas porter ${interdite}`).not.toContain(interdite)
	}
	expect(identite?.identity_data.email_verified).toBe(true)
	expect(identite?.identity_data.iss).toBe(EMETTEUR)
})
