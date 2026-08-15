// @verifies CRM-077 (docs/BACKLOG.md) — corbeille : l'énumération des enfants rendus inaccessibles,
//           puis le GESTE de mise à la corbeille d'un track et d'un channel (septième tranche)
// @verifies docs/SPEC-corbeille.md §3.3 (l'énumération remplace la descente), §3.5 (les trois règles
//           de comptage, la forme des lectures), §5 (ligne « API » : « l'énumération des enfants lue
//           par la même requête que l'écran », « mise en corbeille et restauration avec les jetons
//           RÉELS des trois profils »), §4 bis.2 (le filtre de l'administration), §4 bis.5 (les
//           trois issues du geste)
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
const TRACKS = '/rest/v1/tracks'
const PREFIXE = 'ZZ énumération'
/** Préfixe des objets jetables du geste : ils sont créés ici, et retirés par `menage`. */
const PREFIXE_GESTE = 'ZZ geste corbeille'
/** L'administratrice du seed — c'est elle que le trigger de `0037` doit inscrire en `deleted_by`. */
const PROFIL_ADMIN = '5eed0000-0000-4000-8000-000000000011'

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
	// Les channels d'abord : `tracks → channels` est en `CASCADE`, mais l'ordre explicite évite de
	// faire dépendre le ménage d'une cascade que le §2.3 dit précisément ne jamais emprunter.
	await requete.delete(`${CHANNELS}?name=like.${PREFIXE_GESTE}*`, { headers: enTetesService() })
	await requete.delete(`${TRACKS}?name=like.${PREFIXE_GESTE}*`, { headers: enTetesService() })
}

/** Crée un track jetable, ACTIF, par la clé de service. Rend son identifiant. */
async function trackJetable(requete: APIRequestContext, suffixe: string): Promise<string> {
	const reponse = await requete.post(TRACKS, {
		headers: { ...enTetesService(), Prefer: 'return=representation' },
		data: {
			workspace_id: WORKSPACE_SEED,
			name: `${PREFIXE_GESTE} ${suffixe}`,
			slug: `zz-geste-corbeille-${suffixe}`,
			color: 'neutral',
			icon: 'folder',
		},
	})
	expect(reponse.status(), await reponse.text()).toBe(201)
	return ((await reponse.json()) as { id: string }[])[0]!.id
}

/** Émet EXACTEMENT l'écriture de `mettreTrackALaCorbeille` : `deleted_at`, et rien d'autre. */
function mettreALaCorbeille(
	requete: APIRequestContext,
	jeton: string,
	chemin: string,
	id: string,
	charge: Record<string, unknown> = { deleted_at: '2026-08-15T10:00:00+00:00' },
) {
	return requete.patch(`${chemin}?id=eq.${id}&select=id`, {
		headers: { ...enTetesAuthentifies(jeton), Prefer: 'return=representation' },
		data: charge,
	})
}

let jetonAdmin: string
let jetonBizdev: string
let jetonViewer: string

test.beforeAll(async ({ request }) => {
	jetonAdmin = await jetonDe('admin@p2enjoy.test')
	jetonBizdev = await jetonDe('bizdev@p2enjoy.test')
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

test.describe('E4 — le GESTE de mise à la corbeille, avec les jetons réels (§4 bis.5)', () => {
	test('l’administratrice retire un track : `200`, la ligne, et `deleted_by` écrite par le trigger', async ({
		request,
	}) => {
		const track = await trackJetable(request, 'admin')

		const reponse = await mettreALaCorbeille(request, jetonAdmin, TRACKS, track)
		expect(reponse.status()).toBe(200)
		expect((await reponse.json()) as unknown[], 'la ligne touchée est rendue').toHaveLength(1)

		// L'AUDIT EST RELU EN BASE, pas déduit du code HTTP : le client n'a envoyé que `deleted_at`,
		// et c'est le trigger de `0037` qui doit avoir posé l'auteur (§4 bis.5).
		const relecture = await request.get(`${TRACKS}?id=eq.${track}&select=deleted_at,deleted_by`, {
			headers: enTetesService(),
		})
		const [ligne] = (await relecture.json()) as { deleted_at: string | null; deleted_by: string | null }[]
		expect(ligne?.deleted_at).not.toBeNull()
		expect(ligne?.deleted_by).toBe(PROFIL_ADMIN)
	})

	test('le business developer et la lectrice obtiennent `200` et `[]`, la ligne relue INCHANGÉE', async ({
		request,
	}) => {
		const track = await trackJetable(request, 'refus')

		for (const [nom, jeton] of [
			['business_developer', jetonBizdev],
			['viewer', jetonViewer],
		] as const) {
			const reponse = await mettreALaCorbeille(request, jeton, TRACKS, track)
			expect(reponse.status(), `${nom} ne reçoit pas d'erreur`).toBe(200)
			expect((await reponse.json()) as unknown[], `${nom} ne touche aucune ligne`).toHaveLength(0)
		}

		// LE REFUS EST CONSTATÉ PAR RELECTURE, et c'est la moitié qui compte : `200` et `[]` ne
		// prouvent rien tant que la ligne n'a pas été relue inchangée (décision 70).
		const relecture = await request.get(`${TRACKS}?id=eq.${track}&select=deleted_at,deleted_by`, {
			headers: enTetesService(),
		})
		expect((await relecture.json()) as unknown[]).toEqual([{ deleted_at: null, deleted_by: null }])
	})

	test('une charge qui porte `deleted_by` est refusée ENTIÈREMENT, en `42501`', async ({ request }) => {
		const track = await trackJetable(request, 'audit')

		const reponse = await mettreALaCorbeille(request, jetonAdmin, TRACKS, track, {
			deleted_at: '2026-08-15T10:00:00+00:00',
			deleted_by: PROFIL_ADMIN,
		})
		expect(reponse.status()).toBe(403)
		expect(((await reponse.json()) as { code?: string }).code).toBe('42501')

		// Et le refus n'est pas partiel : `deleted_at`, pourtant ouverte, n'a pas été écrite non plus.
		const relecture = await request.get(`${TRACKS}?id=eq.${track}&select=deleted_at`, {
			headers: enTetesService(),
		})
		expect((await relecture.json()) as unknown[]).toEqual([{ deleted_at: null }])
	})

	test('le geste ne descend PAS sur les enfants : le channel garde son `deleted_at` nul (§3.3)', async ({
		request,
	}) => {
		const track = await trackJetable(request, 'enfants')
		const cree = await request.post(CHANNELS, {
			headers: { ...enTetesService(), Prefer: 'return=representation' },
			data: {
				workspace_id: WORKSPACE_SEED,
				track_id: track,
				workflow_id: WORKFLOW_GLOBAL,
				name: `${PREFIXE_GESTE} enfant`,
				slug: 'zz-geste-corbeille-enfant',
			},
		})
		expect(cree.status(), await cree.text()).toBe(201)

		// L'énumération voit l'enfant AVANT le geste : c'est ce nombre que la confirmation affiche.
		expect(await enumererTrack(request, jetonAdmin, track)).toEqual({ channels: 1, cards: 0 })

		expect((await mettreALaCorbeille(request, jetonAdmin, TRACKS, track)).status()).toBe(200)

		const enfants = await request.get(`${CHANNELS}?select=deleted_at&track_id=eq.${track}`, {
			headers: enTetesService(),
		})
		expect((await enfants.json()) as unknown[], 'l’enfant n’est pas horodaté').toEqual([
			{ deleted_at: null },
		])
	})

	test('un track ARCHIVÉ se retire, et reste archivé : les deux états sont indépendants (§3.1)', async ({
		request,
	}) => {
		const track = await trackJetable(request, 'archive')
		const archive = await request.patch(`${TRACKS}?id=eq.${track}&select=id`, {
			headers: { ...enTetesAuthentifies(jetonAdmin), Prefer: 'return=representation' },
			data: { archived_at: '2026-08-01T00:00:00+00:00' },
		})
		expect(archive.status()).toBe(200)

		expect((await mettreALaCorbeille(request, jetonAdmin, TRACKS, track)).status()).toBe(200)

		const relecture = await request.get(`${TRACKS}?id=eq.${track}&select=archived_at,deleted_at`, {
			headers: enTetesService(),
		})
		const [ligne] = (await relecture.json()) as { archived_at: string | null; deleted_at: string | null }[]
		expect(ligne?.archived_at).not.toBeNull()
		expect(ligne?.deleted_at).not.toBeNull()
	})

	test('un channel se retire par la même écriture, et son track n’est pas touché', async ({
		request,
	}) => {
		const track = await trackJetable(request, 'channel')
		const cree = await request.post(CHANNELS, {
			headers: { ...enTetesService(), Prefer: 'return=representation' },
			data: {
				workspace_id: WORKSPACE_SEED,
				track_id: track,
				workflow_id: WORKFLOW_GLOBAL,
				name: `${PREFIXE_GESTE} seul`,
				slug: 'zz-geste-corbeille-seul',
			},
		})
		const channel = ((await cree.json()) as { id: string }[])[0]!.id

		const reponse = await mettreALaCorbeille(request, jetonAdmin, CHANNELS, channel)
		expect(reponse.status()).toBe(200)
		expect((await reponse.json()) as unknown[]).toHaveLength(1)

		const relecture = await request.get(
			`${CHANNELS}?id=eq.${channel}&select=deleted_at,deleted_by`,
			{ headers: enTetesService() },
		)
		const [ligne] = (await relecture.json()) as { deleted_at: string | null; deleted_by: string | null }[]
		expect(ligne?.deleted_by).toBe(PROFIL_ADMIN)

		const parent = await request.get(`${TRACKS}?id=eq.${track}&select=deleted_at`, {
			headers: enTetesService(),
		})
		expect((await parent.json()) as unknown[]).toEqual([{ deleted_at: null }])
	})
})

test.describe('E5 — les lectures de l’administration excluent la corbeille (§4 bis.2)', () => {
	// LA REQUÊTE ÉMISE EST CELLE DE `lireTracksAdministrables`, filtre pour filtre. Une preuve qui
	// aurait interrogé la table sans les deux filtres aurait mesuré la base, pas l'écran.
	test('la lecture des tracks ne rend PAS le track en corbeille du seed', async ({ request }) => {
		const reponse = await request.get(
			`${TRACKS}?select=id&deleted_at=is.null&archived_at=is.null&order=position&order=name`,
			{ headers: enTetesAuthentifies(jetonAdmin) },
		)
		expect(reponse.status()).toBe(200)
		const identifiants = ((await reponse.json()) as { id: string }[]).map((ligne) => ligne.id)
		expect(identifiants).not.toContain(TRACK_CORBEILLE)

		// CONTRE-ÉPREUVE : sans le filtre de corbeille, la MÊME lecture le rend. Sans elle, l'absence
		// ci-dessus serait vraie même si le track avait disparu de la base.
		const sansFiltre = await request.get(
			`${TRACKS}?select=id&archived_at=is.null&order=position&order=name`,
			{ headers: enTetesAuthentifies(jetonAdmin) },
		)
		expect(((await sansFiltre.json()) as { id: string }[]).map((ligne) => ligne.id)).toContain(
			TRACK_CORBEILLE,
		)
	})

	test('la case « Afficher les archivés » conserve le filtre de corbeille (§3.1)', async ({
		request,
	}) => {
		const reponse = await request.get(`${TRACKS}?select=id&deleted_at=is.null&order=position`, {
			headers: enTetesAuthentifies(jetonAdmin),
		})
		const identifiants = ((await reponse.json()) as { id: string }[]).map((ligne) => ligne.id)
		expect(identifiants).not.toContain(TRACK_CORBEILLE)
		// …et elle ramène bien l'ARCHIVÉ, sans quoi la case n'aurait plus d'effet du tout.
		expect(identifiants).toContain(TRACK_SANS_CHANNEL)
	})

	test('la lecture des channels d’un track ne rend pas celui qui est en corbeille', async ({
		request,
	}) => {
		const reponse = await request.get(
			`${CHANNELS}?select=id&track_id=eq.${TRACK_CORBEILLE}&deleted_at=is.null&archived_at=is.null`,
			{ headers: enTetesAuthentifies(jetonAdmin) },
		)
		const identifiants = ((await reponse.json()) as { id: string }[]).map((ligne) => ligne.id)
		expect(identifiants).toEqual([CHANNEL_VIVANT])
		expect(identifiants).not.toContain(CHANNEL_CORBEILLE)
	})
})
