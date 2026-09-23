// @verifies CRM-092 (docs/BACKLOG.md) — entrées-sorties réelles de l'échangeur de session
// @verifies docs/SPEC-session-sso.md §5.2 (délais), §5.5 (environnement), §6.2 (appel de la base)

import { describe, expect, it } from 'vitest'
import { DELAI_APPEL_MS, creerDependances, lireConfiguration } from './dependances.ts'

const ENV: Record<string, string> = {
	SSO_OIDC_ISSUER: 'http://sso.localhost:18480/realms/lelabs/',
	SSO_OIDC_CLIENT_ID: ' lelabs-crm ',
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
	it('lit l’émetteur sans barre finale, le client épuré et le secret', () => {
		expect(lireConfiguration(lire(ENV))).toEqual({
			emetteur: 'http://sso.localhost:18480/realms/lelabs',
			clientId: 'lelabs-crm',
			secretJwt: 'secret',
		})
	})

	it.each(['SSO_OIDC_ISSUER', 'SSO_OIDC_CLIENT_ID', 'JWT_SECRET'])('rend null sans %s', (nom) => {
		expect(lireConfiguration(lire({ ...ENV, [nom]: '' }))).toBeNull()
	})
})

describe('creerDependances', () => {
	it('n’a pas de configuration sans l’adresse de l’API ou la clé de service', () => {
		expect(creerDependances(lire({ ...ENV, SUPABASE_URL: '' })).configuration).toBeNull()
		expect(creerDependances(lire({ ...ENV, SUPABASE_SERVICE_ROLE_KEY: '' })).configuration).toBeNull()
		expect(creerDependances(lire(ENV)).configuration).not.toBeNull()
	})

	it('lit chez LeLabs en JSON, sous un délai de 3 s', async () => {
		const { f, appels } = fetchEnregistre(() => Response.json({ issuer: 'x' }))
		expect(await creerDependances(lire(ENV), f).lireJson('https://oauth.lelabs.tech/x')).toEqual({ issuer: 'x' })
		expect(appels[0]?.url).toBe('https://oauth.lelabs.tech/x')
		expect(appels[0]?.init?.signal).toBeInstanceOf(AbortSignal)
		expect(DELAI_APPEL_MS).toBe(3_000)
	})

	it('lève sur une réponse non 2xx, pour que l’échangeur rende sso_injoignable', async () => {
		const { f } = fetchEnregistre(() => new Response('indisponible', { status: 503 }))
		await expect(creerDependances(lire(ENV), f).lireJson('https://oauth.lelabs.tech/x')).rejects.toThrow('HTTP 503')
	})

	it('appelle ouvrir_session_sso par PostgREST, avec la clé de service et le corps exact', async () => {
		const { f, appels } = fetchEnregistre(() => Response.json({ admis: true, espaces: 1, rattachees: 0, nom: 'Camille Aubert' }))
		const resultat = await creerDependances(lire(ENV), f).ouvrirSession('5eed', 'admin@p2enjoy.test', 'Camille')
		expect(resultat).toEqual({ admis: true, nom: 'Camille Aubert' })
		const appel = appels[0]
		expect(appel?.url).toBe('http://kong:8000/rest/v1/rpc/ouvrir_session_sso')
		expect(appel?.init?.method).toBe('POST')
		expect(appel?.init?.headers).toEqual({
			apikey: 'cle-de-service',
			authorization: 'Bearer cle-de-service',
			'content-type': 'application/json',
		})
		expect(JSON.parse(String(appel?.init?.body))).toEqual({ p_sub: '5eed', p_email: 'admin@p2enjoy.test', p_nom: 'Camille' })
		expect(appel?.init?.signal).toBeInstanceOf(AbortSignal)
	})

	it('lève sur un refus de la base ou une réponse sans « admis »', async () => {
		const refus = fetchEnregistre(() => new Response('{"code":"42501"}', { status: 401 }))
		await expect(creerDependances(lire(ENV), refus.f).ouvrirSession('s', 'a@b.c', 'n')).rejects.toThrow('HTTP 401')
		const etrange = fetchEnregistre(() => Response.json({ espaces: 1 }))
		await expect(creerDependances(lire(ENV), etrange.f).ouvrirSession('s', 'a@b.c', 'n')).rejects.toThrow()
	})

	it('rend un nom nul quand la base n’en porte pas', async () => {
		const { f } = fetchEnregistre(() => Response.json({ admis: false, espaces: 0, rattachees: 0, nom: null }))
		expect(await creerDependances(lire(ENV), f).ouvrirSession('s', 'a@b.c', 'n')).toEqual({ admis: false, nom: null })
	})
})
