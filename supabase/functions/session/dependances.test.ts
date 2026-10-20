// @verifies CRM-092 (docs/BACKLOG.md) — entrées-sorties réelles de l'échangeur de session
// @verifies docs/SPEC-session-sso.md §5.2 (point de jeton), §5.7 (échéance, 3 s par appel, environnement),
//           §7.4 (fonctions de session appelées par PostgREST)
// @verifies CRM-101 (docs/BACKLOG.md) — tranche T2 : la liste `CRM_SUPERADMINS_INITIAUX` lue et normalisée
//           (docs/SPEC-plateforme.md §3)

import { describe, expect, it } from 'vitest'
import { DELAI_APPEL_MS, creerDependances, delaiAppel, lireConfiguration, listeSuperadminsInitiaux } from './dependances.ts'

const ENV: Record<string, string> = {
	SSO_OIDC_ISSUER: 'http://sso.localhost:18480/realms/lelabs/',
	SSO_OIDC_CLIENT_ID: ' lelabs-crm-serveur ',
	OIDC_CLIENT_SECRET: 'secret-du-client',
	JWT_SECRET: 'secret',
	SUPABASE_URL: 'http://kong:8000/',
	SUPABASE_SERVICE_ROLE_KEY: 'cle-de-service',
}
const lire = (env: Record<string, string>) => (nom: string) => env[nom]

type Appel = { url: string; init: RequestInit | undefined }

function fetchEnregistre(reponse: () => Response) {
	const appels: Appel[] = []
	const f = async (url: string, init?: RequestInit) => {
		appels.push({ url, init })
		return reponse()
	}
	return { f, appels }
}

describe('lireConfiguration', () => {
	it('lit l’émetteur sans barre finale, le client épuré, son secret et la clé de signature', () => {
		expect(lireConfiguration(lire(ENV))).toEqual({
			emetteur: 'http://sso.localhost:18480/realms/lelabs',
			clientId: 'lelabs-crm-serveur',
			clientSecret: 'secret-du-client',
			secretJwt: 'secret',
			superadminsInitiaux: [],
		})
	})

	it('lit la liste d’amorçage avec la configuration', () => {
		expect(lireConfiguration(lire({ ...ENV, CRM_SUPERADMINS_INITIAUX: 'plateforme@p2enjoy.test' }))?.superadminsInitiaux)
			.toEqual(['plateforme@p2enjoy.test'])
	})

	it.each(['SSO_OIDC_ISSUER', 'SSO_OIDC_CLIENT_ID', 'OIDC_CLIENT_SECRET', 'JWT_SECRET'])('rend null sans %s', (nom) => {
		expect(lireConfiguration(lire({ ...ENV, [nom]: '' }))).toBeNull()
	})
})

describe('listeSuperadminsInitiaux', () => {
	it('normalise : espaces de bord, minuscules, doublons retirés, ordre conservé', () => {
		expect(listeSuperadminsInitiaux(' Sabine@Exemple.TEST , autre@exemple.test,sabine@exemple.test ')).toEqual([
			'sabine@exemple.test',
			'autre@exemple.test',
		])
	})

	it('écarte une entrée mal formée sans lever : l’amorçage est facultatif', () => {
		expect(listeSuperadminsInitiaux('pas-une-adresse, a@b@c, deux mots@x.test, ,ok@exemple.test')).toEqual(['ok@exemple.test'])
	})

	it.each([undefined, '', ' , ,'])('rend une liste vide pour %j, qui n’amorce rien', (valeur) => {
		expect(listeSuperadminsInitiaux(valeur)).toEqual([])
	})
})

describe('delaiAppel', () => {
	it('prend au plus 3 s, et jamais au-delà de l’échéance du geste', () => {
		expect(DELAI_APPEL_MS).toBe(3_000)
		expect(delaiAppel(10_000, 0)).toBe(3_000)
		expect(delaiAppel(10_000, 8_500)).toBe(1_500)
		expect(delaiAppel(10_000, 12_000)).toBe(0)
	})
})

describe('creerDependances', () => {
	it('n’a pas de configuration sans l’adresse de l’API ou la clé de service', () => {
		expect(creerDependances(lire({ ...ENV, SUPABASE_URL: '' })).configuration).toBeNull()
		expect(creerDependances(lire({ ...ENV, SUPABASE_SERVICE_ROLE_KEY: '' })).configuration).toBeNull()
		expect(creerDependances(lire(ENV)).configuration).not.toBeNull()
	})

	it('lit chez LeLabs en JSON, sous un signal d’abandon', async () => {
		const { f, appels } = fetchEnregistre(() => Response.json({ issuer: 'x' }))
		expect(await creerDependances(lire(ENV), f, () => 0).lireJson('https://oauth.lelabs.tech/x', 8_000)).toEqual({ issuer: 'x' })
		expect(appels[0]?.url).toBe('https://oauth.lelabs.tech/x')
		expect(appels[0]?.init?.signal).toBeInstanceOf(AbortSignal)
	})

	it('lève sur une réponse non 2xx de la lecture', async () => {
		const { f } = fetchEnregistre(() => new Response('indisponible', { status: 503 }))
		await expect(creerDependances(lire(ENV), f).lireJson('https://oauth.lelabs.tech/x', Date.now() + 8_000)).rejects.toThrow('HTTP 503')
	})

	it('poste un formulaire au point de jeton, et rend le statut sans lever sur un refus', async () => {
		const { f, appels } = fetchEnregistre(() => Response.json({ error: 'invalid_grant' }, { status: 400 }))
		const reponse = await creerDependances(lire(ENV), f).posterFormulaire(
			'https://oauth.lelabs.tech/token',
			{ grant_type: 'authorization_code', client_secret: 's', code: 'c' },
			Date.now() + 8_000,
		)
		expect(reponse).toEqual({ statut: 400, corps: { error: 'invalid_grant' } })
		expect(appels[0]?.init?.method).toBe('POST')
		expect(appels[0]?.init?.headers).toMatchObject({ 'content-type': 'application/x-www-form-urlencoded' })
		expect(String(appels[0]?.init?.body)).toBe('grant_type=authorization_code&client_secret=s&code=c')
	})

	it('appelle une fonction de session par PostgREST, avec la clé de service et le corps exact', async () => {
		const { f, appels } = fetchEnregistre(() => Response.json({ admis: true }))
		const resultat = await creerDependances(lire(ENV), f).appelerBase('ouvrir_session_serveur', { p_sub: 's', p_empreinte: '\\x00' }, Date.now() + 8_000)
		expect(resultat).toEqual({ admis: true })
		expect(appels[0]?.url).toBe('http://kong:8000/rest/v1/rpc/ouvrir_session_serveur')
		expect(appels[0]?.init?.headers).toEqual({
			apikey: 'cle-de-service',
			authorization: 'Bearer cle-de-service',
			'content-type': 'application/json',
		})
		expect(JSON.parse(String(appels[0]?.init?.body))).toEqual({ p_sub: 's', p_empreinte: '\\x00' })
	})

	it('rend null pour une fonction `returns void`, et lève sur un refus de la base', async () => {
		const vide = fetchEnregistre(() => new Response(null, { status: 204 }))
		expect(await creerDependances(lire(ENV), vide.f).appelerBase('fermer_session_serveur', {}, Date.now() + 8_000)).toBeNull()
		const refus = fetchEnregistre(() => new Response('{"code":"42501"}', { status: 401 }))
		await expect(creerDependances(lire(ENV), refus.f).appelerBase('lire_session_serveur', {}, Date.now() + 8_000)).rejects.toThrow('HTTP 401')
	})
})
