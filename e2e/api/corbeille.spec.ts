// @verifies CRM-077 (docs/BACKLOG.md) — corbeille : l'énumération des enfants rendus inaccessibles
// @verifies docs/SPEC-corbeille.md §3.3 (l'énumération remplace la descente), §3.5 (les trois règles
//           de comptage, la forme des lectures), §5 (ligne « API » : « l'énumération des enfants lue
//           par la même requête que l'écran »)
// @verifies docs/SPEC-seed.md §10.1 (les trois objets), §10.4 bis (l'affaire `…0cf`)
// @verifies CLAUDE.md §10 (toute règle se prouve hors interface, avec les jetons réels)
//
// Ces scénarios émettent LES REQUÊTES DE `webapp/src/lib/corbeille.ts`, avec les mêmes chemins et
// les mêmes filtres, et lisent le compte là où PostgREST le rend — l'en-tête `content-range` d'un
// `Prefer: count=exact`. Une preuve qui aurait recompté les lignes côté test aurait mesuré autre
// chose que ce que l'écran affiche.
//
// Aucun navigateur n'est lancé, et aucun refus n'est prouvé avec la clé de service : elle ne sert
// ici qu'à CONSTATER l'état de la base et à poser la fixture du scénario 5.

import { expect, test, type APIRequestContext } from '@playwright/test'
import { enTetesAuthentifies, enTetesService, jetonDe } from './jetons'

const WORKSPACE_SEED = '5eed0000-0000-4000-8000-000000000001'
const WORKFLOW_GLOBAL = '5eed0000-0000-4000-8000-000000000051'
const ETAPE_PROSPECTION = '5eed0000-0000-4000-8000-000000000061'

/** Le track EN CORBEILLE du seed, et ses deux channels (`docs/SPEC-seed.md` §10.1). */
const TRACK_CORBEILLE = '5eed0000-0000-4000-8000-000000000025'
const CHANNEL_VIVANT = '5eed0000-0000-4000-8000-000000000037'
const CHANNEL_CORBEILLE = '5eed0000-0000-4000-8000-000000000038'

/** Le track actif qui porte un channel ARCHIVÉ, et les droits fins qui ferment le reste. */
const TRACK_CONSEIL = '5eed0000-0000-4000-8000-000000000021'
/** Le track ARCHIVÉ, qui ne porte aucun channel : le cas de l'énumération vide. */
const TRACK_SANS_CHANNEL = '5eed0000-0000-4000-8000-000000000024'

const CHANNELS = '/rest/v1/channels'
const CARDS = '/rest/v1/cards'
const PREFIXE = 'ZZ énumération'

/**
 * Émet la PREMIÈRE lecture de l'énumération d'un track : les identifiants de ses channels qui ne
 * sont pas eux-mêmes en corbeille. Le nombre de channels est la longueur de cette lecture.
 */
async function channelsEnumeres(
	requete: APIRequestContext,
	jeton: string,
	track: string,
): Promise<string[]> {
	const reponse = await requete.get(
		`${CHANNELS}?select=id&track_id=eq.${track}&deleted_at=is.null`,
		{ headers: enTetesAuthentifies(jeton) },
	)
	expect(reponse.status()).toBe(200)
	return ((await reponse.json()) as { id: string }[]).map((ligne) => ligne.id)
}

/**
 * Émet la SECONDE lecture : le compte exact des affaires portées par ces channels et non mises à la
 * corbeille. Le compte est lu dans `content-range`, jamais dans un tableau de lignes.
 */
async function compterAffaires(
	requete: APIRequestContext,
	jeton: string,
	filtre: string,
): Promise<number> {
	const reponse = await requete.get(`${CARDS}?select=id&${filtre}&deleted_at=is.null`, {
		headers: { ...enTetesAuthentifies(jeton), Prefer: 'count=exact', Range: '0-0' },
	})
	expect(reponse.status()).toBeLessThan(300)
	const plage = reponse.headers()['content-range']
	expect(plage, 'PostgREST rend le compte dans `content-range`').toBeDefined()
	return Number(plage!.split('/')[1])
}

/** L'énumération complète d'un track, exactement comme `compterEnfantsInaccessibles` la compose. */
async function enumererTrack(
	requete: APIRequestContext,
	jeton: string,
	track: string,
): Promise<{ channels: number; cards: number }> {
	const identifiants = await channelsEnumeres(requete, jeton, track)
	if (identifiants.length === 0) return { channels: 0, cards: 0 }
	const cards = await compterAffaires(requete, jeton, `channel_id=in.(${identifiants.join(',')})`)
	return { channels: identifiants.length, cards }
}

async function menage(requete: APIRequestContext): Promise<void> {
	await requete.delete(`${CARDS}?title=like.${PREFIXE}*`, { headers: enTetesService() })
}

let jetonAdmin: string
let jetonViewer: string

test.beforeAll(async ({ request }) => {
	jetonAdmin = await jetonDe('admin@p2enjoy.test')
	jetonViewer = await jetonDe('viewer@p2enjoy.test')
	await menage(request)
})
test.afterEach(async ({ request }) => {
	await menage(request)
})

test.describe('E1 — l’énumération du track en corbeille', () => {
	test('rend UN channel et UNE affaire : l’enfant déjà en corbeille n’est pas compté', async ({
		request,
	}) => {
		// L'état de la base est CONSTATÉ d'abord, avec la clé de service : sans cela, « un channel »
		// serait vrai que le second soit filtré ou qu'il n'existe pas (décision 50).
		const tous = await request.get(`${CHANNELS}?select=id,deleted_at&track_id=eq.${TRACK_CORBEILLE}`, {
			headers: enTetesService(),
		})
		const lignes = (await tous.json()) as { id: string; deleted_at: string | null }[]
		expect(lignes).toHaveLength(2)
		expect(lignes.filter((ligne) => ligne.deleted_at !== null).map((ligne) => ligne.id)).toEqual([
			CHANNEL_CORBEILLE,
		])

		expect(await enumererTrack(request, jetonAdmin, TRACK_CORBEILLE)).toEqual({
			channels: 1,
			cards: 1,
		})
	})

	test('l’énumération du channel vivant compte sa seule affaire (`…0cf`)', async ({ request }) => {
		expect(await compterAffaires(request, jetonAdmin, `channel_id=eq.${CHANNEL_VIVANT}`)).toBe(1)
	})

	test('une affaire posée sous le channel EN CORBEILLE ne change pas le compte du track', async ({
		request,
	}) => {
		// Elle est retenue un cran plus bas : restaurer le track ne la rendrait pas (§3.5). Aucune
		// donnée du seed ne porte ce cas — la fixture est posée ici, et retirée par `menage`.
		const posee = await request.post(CARDS, {
			headers: { ...enTetesService(), Prefer: 'return=representation' },
			data: {
				workspace_id: WORKSPACE_SEED,
				channel_id: CHANNEL_CORBEILLE,
				workflow_id: WORKFLOW_GLOBAL,
				current_step_id: ETAPE_PROSPECTION,
				title: `${PREFIXE} sous un channel retiré`,
			},
		})
		expect(posee.status()).toBe(201)

		expect(await enumererTrack(request, jetonAdmin, TRACK_CORBEILLE)).toEqual({
			channels: 1,
			cards: 1,
		})
		// Contre-épreuve : la card existe bel et bien, et son channel la compte, lui.
		expect(await compterAffaires(request, jetonAdmin, `channel_id=eq.${CHANNEL_CORBEILLE}`)).toBe(1)
	})
})

test.describe('E2 — un enfant ARCHIVÉ est compté, et le compte est celui de l’appelant', () => {
	test('l’administratrice lit trois channels — dont l’archivé — et sept affaires', async ({
		request,
	}) => {
		const archives = await request.get(
			`${CHANNELS}?select=id&track_id=eq.${TRACK_CONSEIL}&archived_at=not.is.null`,
			{ headers: enTetesService() },
		)
		expect((await archives.json()) as unknown[], 'le seed porte bien un channel archivé').toHaveLength(1)

		expect(await enumererTrack(request, jetonAdmin, TRACK_CONSEIL)).toEqual({
			channels: 3,
			cards: 7,
		})
	})

	test('la lectrice lit UN channel et DEUX affaires : les droits fins ferment le reste', async ({
		request,
	}) => {
		expect(await enumererTrack(request, jetonViewer, TRACK_CONSEIL)).toEqual({
			channels: 1,
			cards: 2,
		})
	})
})

test.describe('E3 — l’énumération vide', () => {
	test('un track sans channel n’énumère rien, et la seconde lecture n’a pas lieu', async ({
		request,
	}) => {
		expect(await channelsEnumeres(request, jetonAdmin, TRACK_SANS_CHANNEL)).toEqual([])
		expect(await enumererTrack(request, jetonAdmin, TRACK_SANS_CHANNEL)).toEqual({
			channels: 0,
			cards: 0,
		})
	})

	test('`channel_id=in.()` n’est pas un piège : il rend `200` et zéro ligne', async ({ request }) => {
		// MESURÉ, et c'est ce qui autorise à parler d'une requête ÉPARGNÉE plutôt que d'un
		// contournement (§3.5).
		const reponse = await request.get(`${CARDS}?select=id&channel_id=in.()&deleted_at=is.null`, {
			headers: { ...enTetesAuthentifies(jetonAdmin), Prefer: 'count=exact', Range: '0-0' },
		})
		expect(reponse.status()).toBe(200)
		expect(reponse.headers()['content-range']).toBe('*/0')
	})
})
