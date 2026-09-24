// @verifies CRM-092 (docs/BACKLOG.md) — les trois gestes de la webapp vers l'échangeur de session
// @verifies docs/SPEC-session-sso.md §5.1 (chemin relatif, `apikey`, même origine), §5.4 (corps de
//           succès), §5.5 (refus), §8.2 (ce module), §9.2 (dictionnaire de l'écran) ; décisions 586, 587
// @verifies CRM-092 (docs/BACKLOG.md), docs/SPEC-session-sso.md §5.5, §9.2 — INC-249, décision 593 :
//           l'attente `attente_administrateur` (espace sans administrateur encore)

import { describe, expect, it, vi } from 'vitest'
import { CHEMIN_ECHANGEUR, classerRefus, creerEchangeur, lireSession } from './session'

const b64 = (v: unknown) => btoa(JSON.stringify(v)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const jeton = (charge: Record<string, unknown>) => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(charge)}.signature`
const JETON = jeton({ iat: 1_790_180_130, exp: 1_790_180_430 })

const SUCCES = {
	jeton: JETON,
	expire_a: 1_790_180_430,
	identite: { id: '5eed0000-0000-4000-8000-000000000011', adresse: 'admin@exemple.tld', nom: 'Admin' },
}

function repondre(statut: number, corps: unknown = null) {
	return vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
		new Response(corps === null ? null : JSON.stringify(corps), { status: statut }),
	)
}

describe('lireSession', () => {
	it('lit le corps exact du §5.4, l’adresse devenant l’email de la session, et la durée exp − iat', () => {
		expect(lireSession(SUCCES)).toEqual({
			jeton: JETON,
			expireA: 1_790_180_430,
			dureeS: 300,
			identite: { id: SUCCES.identite.id, email: 'admin@exemple.tld', nom: 'Admin' },
		})
	})

	it.each([
		['sans jeton', { ...SUCCES, jeton: '' }],
		['sans échéance numérique', { ...SUCCES, expire_a: '1790180430' }],
		['sans identité', { ...SUCCES, identite: null }],
		['sans identifiant', { ...SUCCES, identite: { ...SUCCES.identite, id: '' } }],
		['un tableau', [SUCCES]],
		['au jeton sans iat', { ...SUCCES, jeton: jeton({ exp: 1_790_180_430 }) }],
		['au jeton illisible', { ...SUCCES, jeton: 'pas.un-jwt.lisible' }],
		['échu avant son émission', { ...SUCCES, jeton: jeton({ iat: 1_790_180_500 }) }],
	])('refuse un corps %s', (_cas, corps) => {
		expect(lireSession(corps)).toBeNull()
	})
})

describe('classerRefus', () => {
	it.each([
		['adresse_non_verifiee'],
		['attente_verification'],
		['attente_espace'],
		['attente_administrateur'],
	] as const)('rend l’attente %s avec son adresse', (code) => {
		expect(classerRefus('ouvrir', 403, { erreur: code, adresse: 'a@b.tld' })).toEqual({ ok: false, nature: code, adresse: 'a@b.tld' })
	})

	it('ne rend pas une attente sans adresse : la réponse n’est pas conforme', () => {
		expect(classerRefus('ouvrir', 403, { erreur: 'attente_espace' })).toEqual({ ok: false, nature: 'sso_echec' })
	})

	it('distingue le jeton refusé à l’ouverture (échec) et à la prolongation (fin de session)', () => {
		expect(classerRefus('ouvrir', 401, { erreur: 'jeton_refuse' })).toEqual({ ok: false, nature: 'sso_echec' })
		expect(classerRefus('prolonger', 401, { erreur: 'jeton_refuse' })).toEqual({ ok: false, nature: 'session_expiree' })
	})

	it.each([
		[401, { erreur: 'session_absente' }, 'sso_echec'],
		[401, { erreur: 'session_expiree' }, 'session_expiree'],
		[502, { erreur: 'sso_injoignable' }, 'reseau'],
		[502, { erreur: 'service_indisponible' }, 'reseau'],
		[400, { erreur: 'requete_invalide' }, 'sso_echec'],
		[404, { erreur: 'geste_inconnu' }, 'sso_echec'],
		[405, { erreur: 'methode' }, 'sso_echec'],
		[503, null, 'reseau'],
		[418, { erreur: 'inconnu', message: 'jamais lu' }, 'sso_echec'],
	])('%i %j → %s', (statut, corps, nature) => {
		expect(classerRefus('prolonger', statut, corps)).toEqual({ ok: false, nature })
	})
})

describe('creerEchangeur', () => {
	it('ouvre par un chemin RELATIF, avec l’apikey, le corps exact et le cookie de même origine', async () => {
		const requete = repondre(200, SUCCES)
		const issue = await creerEchangeur({ cleAnonyme: 'cle-anonyme', requete }).ouvrir('le-code', 'le-verificateur', 'https://crm.tld/auth/retour')
		expect(issue).toEqual({ ok: true, session: lireSession(SUCCES) })
		const [url, init] = requete.mock.calls[0] ?? []
		expect(url).toBe(`${CHEMIN_ECHANGEUR}/ouvrir`)
		expect(CHEMIN_ECHANGEUR).toBe('/functions/v1/session')
		expect(init).toMatchObject({ method: 'POST', credentials: 'same-origin', cache: 'no-store' })
		expect(init?.headers).toEqual({ apikey: 'cle-anonyme', 'content-type': 'application/json' })
		expect(JSON.parse(String(init?.body))).toEqual({
			code: 'le-code',
			verificateur: 'le-verificateur',
			redirect_uri: 'https://crm.tld/auth/retour',
		})
	})

	it('prolonge sans corps : seule la poignée du cookie désigne la session', async () => {
		const requete = repondre(200, SUCCES)
		expect((await creerEchangeur({ cleAnonyme: 'k', requete }).prolonger()).ok).toBe(true)
		const [url, init] = requete.mock.calls[0] ?? []
		expect(url).toBe('/functions/v1/session/prolonger')
		expect(init?.body).toBeUndefined()
		expect(init?.headers).toEqual({ apikey: 'k' })
		expect(init?.credentials).toBe('same-origin')
	})

	it('lit un 204 à la prolongation comme l’absence de session, sans rien d’un refus (décision 587)', async () => {
		const requete = repondre(204)
		expect(await creerEchangeur({ cleAnonyme: 'k', requete }).prolonger()).toEqual({ ok: false, nature: 'session_absente' })
	})

	it('rend le refus nommé de l’échangeur', async () => {
		const requete = repondre(403, { erreur: 'attente_verification', adresse: 'attendu@exemple.tld' })
		expect(await creerEchangeur({ cleAnonyme: 'k', requete }).ouvrir('c', 'v', 'https://crm.tld/auth/retour')).toEqual({
			ok: false,
			nature: 'attente_verification',
			adresse: 'attendu@exemple.tld',
		})
	})

	it('rend « réseau » sur une panne, et « échec » sur un succès au corps non conforme', async () => {
		const panne = vi.fn(async () => Promise.reject(new TypeError('Failed to fetch')))
		expect(await creerEchangeur({ cleAnonyme: 'k', requete: panne }).prolonger()).toEqual({ ok: false, nature: 'reseau' })
		const illisible = vi.fn(async () => new Response('pas du json', { status: 200 }))
		expect(await creerEchangeur({ cleAnonyme: 'k', requete: illisible }).prolonger()).toEqual({ ok: false, nature: 'sso_echec' })
	})

	it('ferme sur 204, et dit l’échec autrement', async () => {
		const ferme = repondre(204)
		expect(await creerEchangeur({ cleAnonyme: 'k', requete: ferme }).fermer()).toEqual({ ok: true })
		expect(ferme.mock.calls[0]?.[0]).toBe('/functions/v1/session/fermer')
		expect(await creerEchangeur({ cleAnonyme: 'k', requete: repondre(502, { erreur: 'service_indisponible' }) }).fermer()).toEqual({
			ok: false,
			nature: 'reseau',
		})
		const panne = vi.fn(async () => Promise.reject(new TypeError('Failed to fetch')))
		expect(await creerEchangeur({ cleAnonyme: 'k', requete: panne }).fermer()).toEqual({ ok: false, nature: 'reseau' })
	})
})
