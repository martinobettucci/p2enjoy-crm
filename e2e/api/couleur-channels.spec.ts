// @verifies CRM-116 (docs/BACKLOG.md) — tranche T2 : la couleur d'un channel, lue et écrite aux jetons réels
// @verifies docs/SPEC-administration-arborescence.md §14.2 (aucune politique nouvelle : seule l'administration écrit),
//           §14.4 (les lectures) ; docs/SPEC-channels.md §2.1, §5 ; docs/SPEC-seed.md §2.6 (les couleurs du seed) ;
//           docs/DESIGN_SYSTEM.md §1 (jamais un hexadécimal libre)
// @verifies CLAUDE.md §10 (la règle se prouve hors interface, avec le jeton réel de chaque profil)
//
// Un `PATCH` que la politique écarte ne rend pas d'erreur : PostgREST répond `200` avec un tableau VIDE. C'est donc le
// nombre de lignes rendues, puis la relecture, qui prouvent le refus — jamais le seul statut.
//
// Le channel modifié, `maintenance`, est rendu à sa valeur du seed — `neutral` — en fin de fichier, quoi qu'il arrive.

import { expect, test } from '@playwright/test'
import { enTetesAuthentifies, jetonDe } from './jetons'

const CHANNEL_PROSPECTION = '5eed0000-0000-4000-8000-000000000031'
const CHANNEL_MAINTENANCE = '5eed0000-0000-4000-8000-000000000035'
const COULEUR_SEED_MAINTENANCE = 'neutral'

type LigneCouleur = { id: string; slug: string; color: string }

// Les scénarios écrivent le même channel, et C4 compare à ce que C3 a posé : ils se jouent dans l'ordre, un à la fois.
test.describe.configure({ mode: 'serial' })

let jetonAdmin: string
let jetonBizdev: string
let jetonViewer: string

test.beforeAll(async () => {
	jetonAdmin = await jetonDe('admin@p2enjoy.test')
	jetonBizdev = await jetonDe('bizdev@p2enjoy.test')
	jetonViewer = await jetonDe('viewer@p2enjoy.test')
})

test.afterAll(async ({ request }) => {
	const reponse = await request.patch(`/rest/v1/channels?id=eq.${CHANNEL_MAINTENANCE}`, {
		headers: { ...enTetesAuthentifies(jetonAdmin), Prefer: 'return=representation' },
		data: { color: COULEUR_SEED_MAINTENANCE },
	})
	expect(reponse.status(), 'le channel modifié est rendu au seed').toBe(200)
})

async function couleurDe(request: import('@playwright/test').APIRequestContext, id: string): Promise<string> {
	const reponse = await request.get(`/rest/v1/channels?id=eq.${id}&select=color`, {
		headers: enTetesAuthentifies(jetonAdmin),
	})
	expect(reponse.status()).toBe(200)
	const lignes = (await reponse.json()) as { color: string }[]
	expect(lignes).toHaveLength(1)
	return lignes[0]?.color ?? ''
}

test('C1 — la barre d’onglets lit la couleur des channels du seed, les cinq jetons démontrés', async ({ request }) => {
	const reponse = await request.get(
		'/rest/v1/channels?select=id,slug,color&slug=in.(prospection,grands-comptes,appels-offres,refonte,maintenance,inter-entreprises)',
		{ headers: enTetesAuthentifies(jetonAdmin) },
	)
	expect(reponse.status()).toBe(200)
	const parSlug = new Map(((await reponse.json()) as LigneCouleur[]).map((ligne) => [ligne.slug, ligne.color]))
	expect(Object.fromEntries(parSlug)).toEqual({
		prospection: 'brand',
		'grands-comptes': 'success',
		'appels-offres': 'danger',
		refonte: 'accent',
		maintenance: 'neutral',
		'inter-entreprises': 'success',
	})
})

test('C2 — la lectrice lit la couleur d’un channel qu’elle lit, sous la RLS', async ({ request }) => {
	const reponse = await request.get(`/rest/v1/channels?id=eq.${CHANNEL_PROSPECTION}&select=id,slug,color`, {
		headers: enTetesAuthentifies(jetonViewer),
	})
	expect(reponse.status()).toBe(200)
	expect((await reponse.json()) as LigneCouleur[]).toEqual([{ id: CHANNEL_PROSPECTION, slug: 'prospection', color: 'brand' }])
})

test('C3 — l’administratrice change la couleur d’un channel, et la valeur est relue', async ({ request }) => {
	const reponse = await request.patch(`/rest/v1/channels?id=eq.${CHANNEL_MAINTENANCE}`, {
		headers: { ...enTetesAuthentifies(jetonAdmin), Prefer: 'return=representation' },
		data: { color: 'accent' },
	})
	expect(reponse.status()).toBe(200)
	expect(((await reponse.json()) as LigneCouleur[]).map((ligne) => ligne.color)).toEqual(['accent'])
	expect(await couleurDe(request, CHANNEL_MAINTENANCE)).toBe('accent')
})

for (const [profil, jeton] of [
	['le business developer', () => jetonBizdev],
	['la lectrice', () => jetonViewer],
] as const) {
	test(`C4 — ${profil} ne change pas la couleur : aucune ligne rendue, la valeur intacte`, async ({ request }) => {
		const avant = await couleurDe(request, CHANNEL_MAINTENANCE)
		const reponse = await request.patch(`/rest/v1/channels?id=eq.${CHANNEL_MAINTENANCE}`, {
			headers: { ...enTetesAuthentifies(jeton()), Prefer: 'return=representation' },
			data: { color: avant === 'danger' ? 'success' : 'danger' },
		})
		expect(reponse.status()).toBe(200)
		expect(await reponse.json()).toEqual([])
		expect(await couleurDe(request, CHANNEL_MAINTENANCE)).toBe(avant)
	})
}

test('C5 — un hexadécimal est refusé par la contrainte, même pour l’administratrice', async ({ request }) => {
	const avant = await couleurDe(request, CHANNEL_MAINTENANCE)
	const reponse = await request.patch(`/rest/v1/channels?id=eq.${CHANNEL_MAINTENANCE}`, {
		headers: { ...enTetesAuthentifies(jetonAdmin), Prefer: 'return=representation' },
		data: { color: '#23468C' },
	})
	expect(reponse.status()).toBe(400)
	expect(((await reponse.json()) as { code: string }).code).toBe('23514')
	expect(await couleurDe(request, CHANNEL_MAINTENANCE)).toBe(avant)
})
