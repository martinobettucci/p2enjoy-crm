// @verifies CRM-165 (docs/BACKLOG.md) — tranche T1 : les consignes de la plateforme, par requête directe avec les jetons
//           réels — le super-administrateur lit et écrit ; l'administratrice d'espace, la lectrice et l'anonyme sont
//           refusées, rien n'est écrit ; la table n'est pas lisible par REST ; lire le texte et publier le socle sont
//           réservés à la clé de service
// @verifies docs/SPEC-mcp.md §18.2, §18.3, §18.7 ; CLAUDE.md §10 (toute règle se prouve hors interface)
//
// Le texte en place — celui du seed — est lu d'abord et rendu à la fin, quoi qu'il arrive.

import { type APIRequestContext, expect, test } from '@playwright/test'
import { URL_API, enTetesAnonymes, enTetesAuthentifies, enTetesService, jetonDe } from './jetons'

const SABINE = 'plateforme@p2enjoy.test'
const CAMILLE = 'admin@p2enjoy.test'
const FARIDA = 'viewer@p2enjoy.test'
const rpc = (nom: string) => `${URL_API}/rest/v1/rpc/${nom}`
const json = (entetes: Record<string, string>) => ({ ...entetes, 'Content-Type': 'application/json' })

type Consignes = { body: string; updated_at: string | null; updated_by_name: string | null; base: string | null }

test.describe.configure({ mode: 'serial' })

let texteDOrigine = ''

async function lire(request: APIRequestContext, jeton: string): Promise<Consignes> {
	const reponse = await request.post(rpc('platform_connector_instructions'), { headers: json(enTetesAuthentifies(jeton)), data: {} })
	expect(reponse.status(), await reponse.text()).toBe(200)
	return ((await reponse.json()) as Consignes[])[0]!
}

async function ecrire(request: APIRequestContext, entetes: Record<string, string>, texte: string | null) {
	return request.post(rpc('platform_set_connector_instructions'), { headers: json(entetes), data: { p_body: texte } })
}

test.beforeAll(async ({ request }) => {
	texteDOrigine = (await lire(request, await jetonDe(SABINE))).body
})

test.afterAll(async ({ request }) => {
	const remise = await ecrire(request, enTetesAuthentifies(await jetonDe(SABINE)), texteDOrigine)
	expect(remise.status(), await remise.text()).toBe(204)
})

test('le super-administrateur écrit, normalisé, et lit son texte, son nom et la date', async ({ request }) => {
	const jeton = await jetonDe(SABINE)
	const reponse = await ecrire(request, enTetesAuthentifies(jeton), '  Preuve CRM-165 : cherchez avant de créer.\r\n')
	expect(reponse.status(), await reponse.text()).toBe(204)
	const consignes = await lire(request, jeton)
	expect(consignes.body).toBe('Preuve CRM-165 : cherchez avant de créer.')
	expect(consignes.updated_by_name).toBe('Sabine Plateforme')
	expect(Date.now() - Date.parse(consignes.updated_at ?? '')).toBeLessThan(60_000)
})

test('plus de 4 000 caractères : refusé en 400, le texte en place ne bouge pas', async ({ request }) => {
	const jeton = await jetonDe(SABINE)
	const reponse = await ecrire(request, enTetesAuthentifies(jeton), 'a'.repeat(4001))
	expect(reponse.status()).toBe(400)
	expect(((await reponse.json()) as { message: string }).message).toBe('connector_instructions_too_long')
	expect((await lire(request, jeton)).body).toBe('Preuve CRM-165 : cherchez avant de créer.')
})

test('l’administratrice d’espace et la lectrice sont refusées, à l’écriture comme à la lecture, et rien n’est écrit', async ({ request }) => {
	for (const adresse of [CAMILLE, FARIDA]) {
		const jeton = await jetonDe(adresse)
		const ecriture = await ecrire(request, enTetesAuthentifies(jeton), `Pirate ${adresse}`)
		expect(ecriture.status(), adresse).toBe(403)
		const lecture = await request.post(rpc('platform_connector_instructions'), { headers: json(enTetesAuthentifies(jeton)), data: {} })
		expect(lecture.status(), adresse).toBe(403)
	}
	expect((await lire(request, await jetonDe(SABINE))).body).toBe('Preuve CRM-165 : cherchez avant de créer.')
})

test('l’anonyme n’atteint ni la lecture ni l’écriture', async ({ request }) => {
	const ecriture = await ecrire(request, enTetesAnonymes(), 'Pirate anonyme')
	expect([401, 403]).toContain(ecriture.status())
	const lecture = await request.post(rpc('platform_connector_instructions'), { headers: json(enTetesAnonymes()), data: {} })
	expect([401, 403]).toContain(lecture.status())
})

test('la table n’est pas lisible par REST, même du super-administrateur : tout passe par les fonctions', async ({ request }) => {
	const reponse = await request.get(`${URL_API}/rest/v1/connector_instructions?select=body`, {
		headers: enTetesAuthentifies(await jetonDe(SABINE)),
	})
	expect(reponse.status()).toBe(403)
})

test('lire le texte et publier le socle : la clé de service seule', async ({ request }) => {
	const jeton = await jetonDe(SABINE)
	for (const [nom, corps] of [['connector_instructions_text', {}], ['connector_instructions_publish_base', { p_base: 'Pirate' }]] as const) {
		const refuse = await request.post(rpc(nom), { headers: json(enTetesAuthentifies(jeton)), data: corps })
		expect(refuse.status(), nom).toBe(403)
	}
	const texte = await request.post(rpc('connector_instructions_text'), { headers: json(enTetesService()), data: {} })
	expect(texte.status()).toBe(200)
	expect(await texte.json()).toBe('Preuve CRM-165 : cherchez avant de créer.')
})
