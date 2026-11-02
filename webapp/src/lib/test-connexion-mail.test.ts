// @verifies CRM-127 (docs/BACKLOG.md) — tranche T4 : la traduction d'une réponse de `mail-connection-test` en issue d'écran
// @verifies docs/SPEC-mail-subsystem.md §23.4 (les codes de la fonction), §23.5 (verdict, incident du dictionnaire
//           fermé, refus ; jamais le code brut) ; docs/SPEC-webapp.md §6.4 (une panne n'est jamais un succès)

import { describe, expect, it } from 'vitest'
import { issueDepuisReponse, testerConnexion, type AccesTest } from './test-connexion-mail'

const ID = '5eed0000-0000-4000-8000-0000000000aa'
const repondre = (statut: number, corps?: unknown) =>
	new Response(corps === undefined ? 'pas du json' : JSON.stringify(corps), { status: statut })

describe('issueDepuisReponse', () => {
	it('un verdict ok est une réussite', async () => {
		expect(await issueDepuisReponse(repondre(200, { status: 'ok', error: null, checked_at: 't' }))).toEqual({ type: 'reussi' })
	})

	it('un verdict error porte son incident, tiré du dictionnaire fermé', async () => {
		expect(await issueDepuisReponse(repondre(200, { status: 'error', error: 'auth_failed', checked_at: 't' }))).toEqual({
			type: 'echoue',
			incident: 'auth_failed',
		})
	})

	it('un code d’incident inconnu n’est jamais recopié', async () => {
		expect(await issueDepuisReponse(repondre(200, { status: 'error', error: 'SELECT * FROM', checked_at: 't' }))).toEqual({
			type: 'echoue',
			incident: null,
		})
	})

	it.each([
		[401, { error: 'unauthorized' }, 'session'],
		[404, { error: 'not_found' }, 'introuvable'],
		[409, { error: 'disabled' }, 'desactivee'],
		[409, { error: 'secret_missing' }, 'secret_absent'],
		[429, { error: 'too_soon' }, 'trop_tot'],
		[502, { error: 'service_unavailable' }, 'service'],
		[400, { error: 'invalid_request' }, 'service'],
	] as const)('%i %j devient le motif %s', async (statut, corps, motif) => {
		expect(await issueDepuisReponse(repondre(statut, corps))).toEqual({ type: 'refuse', motif })
	})

	it('un 200 sans verdict reconnaissable, ou un corps illisible, est une panne et jamais un succès', async () => {
		expect(await issueDepuisReponse(repondre(200, { status: 'pending' }))).toEqual({ type: 'refuse', motif: 'service' })
		expect(await issueDepuisReponse(repondre(200))).toEqual({ type: 'refuse', motif: 'service' })
	})
})

describe('testerConnexion', () => {
	const acces = (requete: AccesTest['requete'], jeton: string | null = 'jeton-de-camille'): AccesTest => ({
		url: 'http://localhost:8000/',
		cleAnonyme: 'cle-anonyme',
		jeton: () => jeton,
		requete,
	})

	it('appelle la fonction avec la clé publique, le jeton de session, la cible et l’identifiant', async () => {
		const appels: [string, RequestInit | undefined][] = []
		const issue = await testerConnexion(
			acces(async (url, init) => (appels.push([url, init]), repondre(200, { status: 'ok', error: null, checked_at: 't' }))),
			'outbound',
			ID,
		)
		expect(issue).toEqual({ type: 'reussi' })
		const [url, init] = appels[0]!
		expect(url).toBe('http://localhost:8000/functions/v1/mail-connection-test')
		expect(init?.method).toBe('POST')
		expect(init?.headers).toMatchObject({ apikey: 'cle-anonyme', authorization: 'Bearer jeton-de-camille' })
		expect(JSON.parse(String(init?.body))).toEqual({ target: 'outbound', id: ID })
	})

	it('sans session, ne fait aucun appel et dit que la session a expiré', async () => {
		let appele = false
		expect(await testerConnexion(acces(async () => ((appele = true), repondre(200)), null), 'inbound', ID)).toEqual({
			type: 'refuse',
			motif: 'session',
		})
		expect(appele).toBe(false)
	})

	it('une panne réseau, ou une configuration absente, est le motif service', async () => {
		const enPanne = acces(async () => {
			throw new TypeError('Failed to fetch')
		})
		expect(await testerConnexion(enPanne, 'inbound', ID)).toEqual({ type: 'refuse', motif: 'service' })
		expect(await testerConnexion(null, 'inbound', ID)).toEqual({ type: 'refuse', motif: 'service' })
	})
})
