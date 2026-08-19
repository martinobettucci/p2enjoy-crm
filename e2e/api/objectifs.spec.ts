// @verifies CRM-082 (docs/BACKLOG.md) — objectifs : modèle, RLS et API, hors interface
// @verifies CRM-083 (docs/BACKLOG.md) — sa Definition of Done exige que le refus du `viewer` soit
//           mesuré HORS INTERFACE, et c'est CE fichier qui le tient pour le canevas : insertion
//           refusée `403` / `42501` sur les trois tables, modification et SUPPRESSION filtrées à
//           zéro ligne, les lignes relues intactes derrière. La citation est écrite ici plutôt que
//           laissée implicite : sans elle, la trace de cette exigence ne mène plus à l'unité de
//           l'écran, et `scripts/verify-objectifs-canevas.sh` la refuse
// @verifies docs/SPEC-goals.md §2 (objets et contraintes), §4.1 (lecture, et le bloc invisible),
//           §4.2 (écriture, et le lien qui engage la destination)
// @verifies docs/SCHEMA.md §9 bis.1 à §9 bis.3 (colonnes), §9 bis.7 (politiques)
// @verifies docs/SPEC-permissions-rls.md §2.1 (un viewer n'écrit rien), §7 (preuves de refus)
// @verifies CLAUDE.md §10 (toute règle d'accès se prouve hors interface, avec le jeton réel)
//
// LA QUESTION À LAQUELLE CE FICHIER RÉPOND. La suite pgTAP `0047_objectifs.test.sql` prouve les
// mêmes règles DANS la base, avec `set local role` : elle ne traverse ni Kong, ni PostgREST, ni
// GoTrue. Or la DoD de `CRM-082` exige des refus « mesurés comme zéro ligne ou 403 SELON LE
// GESTE », et cette distinction n'existe QU'AU NIVEAU HTTP. Elle n'est pas décorative :
//
//   * un refus opposé par le `USING` d'une politique FILTRE — la requête réussit, elle ne rend
//     simplement aucune ligne, et PostgREST répond `200 []` ou `204` (décision 106) ;
//   * un refus opposé par le `WITH CHECK` LÈVE — PostgREST répond `403` avec `42501`.
//
// Un fichier qui n'attendrait qu'un « échec » ne verrait pas la différence, et une régression qui
// transformerait l'un en l'autre passerait inaperçue.
//
// IL POSE SES PROPRES FIXTURES ET LES DÉTRUIT. Le tableau du seed est LU mais jamais écrit : ses
// six blocs et ses quatre flèches sont un contrat que `CRM-083` capturera, et les déplacer
// déplacerait ses captures. Les gestes d'écriture portent donc sur un tableau d'essai, détruit
// inconditionnellement en fin de fichier pour qu'un scénario interrompu ne laisse rien derrière.

import { expect, test } from '@playwright/test'
import { URL_API, enTetesAuthentifies, enTetesService, jetonDe } from './jetons'

const BOARDS = '/rest/v1/goal_boards'
const BLOCKS = '/rest/v1/goal_blocks'
const LINKS = '/rest/v1/goal_links'

/** Identifiants du seed, stables par contrat (`docs/SPEC-seed.md`). */
const WORKSPACE = '5eed0000-0000-4000-8000-000000000001'
const ADMIN = '5eed0000-0000-4000-8000-000000000011'

/**
 * Le tableau d'objectifs du seed et ses blocs, tels que `supabase/seed/apply-seed.sh` les pose.
 * Ils sont LUS ici, jamais écrits.
 */
const TABLEAU_SEED = '5eed0000-0000-4000-8000-0000000000e1'
const BLOC_GRANDS_COMPTES = '5eed0000-0000-4000-8000-0000000000e3'

/**
 * Les trois channels retenus le sont pour ce qu'ils SÉPARENT — MESURÉ le 2026-08-19 sur la pile
 * seedée, et non supposé :
 *
 *   * « Prospection »    — lu ET écrit par l'administratrice comme par le business developer ;
 *   * « Grands comptes » — INVISIBLE à la lectrice : elle lit six channels sur huit ;
 *   * « Maintenance »    — LU par le business developer, qu'il n'ÉCRIT PAS. C'est le seul channel
 *     du seed qui sépare la lecture de l'écriture, donc le seul qui puisse prouver que poser un
 *     lien exige davantage que le lire.
 */
const CH_PROSPECTION = '5eed0000-0000-4000-8000-000000000031'
const CH_MAINTENANCE = '5eed0000-0000-4000-8000-000000000035'

/** Fixtures d'essai, détruites en fin de fichier. */
const TABLEAU_ESSAI = 'c0000000-0000-4000-8000-0000000000a1'
const BLOC_A = 'c0000000-0000-4000-8000-0000000000a2'
const BLOC_B = 'c0000000-0000-4000-8000-0000000000a3'
const BLOC_MAINTENANCE = 'c0000000-0000-4000-8000-0000000000a4'

const blocDEssai = (id: string, titre: string, x: number, channel: string | null) => ({
	id,
	board_id: TABLEAU_ESSAI,
	title: titre,
	fill_percent: 0,
	channel_id: channel,
	pos_x: x,
	pos_y: 0,
	width: 200,
	height: 100,
	color: 'neutral',
})

test.describe('CRM-082 — objectifs : le contrat d’API, hors interface', () => {
	let jetonAdmin = ''
	let jetonBizdev = ''
	let jetonViewer = ''

	test.beforeAll(async ({ playwright }) => {
		jetonAdmin = await jetonDe('admin@p2enjoy.test')
		jetonBizdev = await jetonDe('bizdev@p2enjoy.test')
		jetonViewer = await jetonDe('viewer@p2enjoy.test')

		// Les fixtures sont posées par la CLÉ DE SERVICE, qui traverse la RLS : ce fichier prouve
		// des refus, et poser ses propres fixtures avec un jeton de profil ferait dépendre le
		// décor de la règle qu'il éprouve.
		const service = await playwright.request.newContext({ baseURL: URL_API })
		try {
			await service.post(BOARDS, {
				headers: { ...enTetesService(), Prefer: 'resolution=merge-duplicates' },
				data: {
					id: TABLEAU_ESSAI,
					workspace_id: WORKSPACE,
					name: 'Tableau d’essai objectifs.spec',
					position: 90,
					created_by: ADMIN,
				},
			})
			await service.post(BLOCKS, {
				headers: { ...enTetesService(), Prefer: 'resolution=merge-duplicates' },
				data: [
					blocDEssai(BLOC_A, 'Bloc A', 0, null),
					blocDEssai(BLOC_B, 'Bloc B', 300, null),
					blocDEssai(BLOC_MAINTENANCE, 'Bloc lié à Maintenance', 600, CH_MAINTENANCE),
				],
			})
		} finally {
			await service.dispose()
		}
	})

	/**
	 * Le seed sort INTACT. La destruction est inconditionnelle et porte sur le seul tableau
	 * d'essai : `on delete cascade` emporte ses blocs et ses flèches, y compris ceux qu'un
	 * scénario interrompu aurait laissés.
	 */
	test.afterAll(async ({ playwright }) => {
		const service = await playwright.request.newContext({ baseURL: URL_API })
		try {
			await service.delete(`${BOARDS}?workspace_id=eq.${WORKSPACE}&position=gte.90`, {
				headers: enTetesService(),
			})
		} finally {
			await service.dispose()
		}
	})

	// -------------------------------------------------------------------------------------------
	// 1. Lecture
	// -------------------------------------------------------------------------------------------

	test('l’appelant anonyme ne lit AUCUN tableau, et le refus est un filtrage', async ({
		request,
	}) => {
		// Les politiques de lecture sont ouvertes `to anon`, délibérément : `auth.uid()` valant
		// NULL, le refus se fait par ZÉRO LIGNE et non par une erreur de privilège
		// (docs/SPEC-permissions-rls.md §7). La distinction compte — un `401` révélerait que la
		// table existe et qu'elle est protégée ; `200 []` ne révèle rien.
		const reponse = await request.get(`${BOARDS}?select=id`, {
			headers: { apikey: (await import('./jetons')).CLE_ANONYME },
		})
		expect(reponse.status()).toBe(200)
		expect(await reponse.json()).toEqual([])
	})

	test('les trois profils lisent le tableau du seed, la lectrice comprise', async ({ request }) => {
		for (const [role, jeton] of [
			['admin', jetonAdmin],
			['business_developer', jetonBizdev],
			['viewer', jetonViewer],
		] as const) {
			const reponse = await request.get(`${BOARDS}?id=eq.${TABLEAU_SEED}&select=id,name`, {
				headers: enTetesAuthentifies(jeton),
			})
			expect(reponse.status(), `lecture du tableau par ${role}`).toBe(200)
			expect(await reponse.json(), `le tableau est lisible par ${role}`).toHaveLength(1)
		}
	})

	test('LE BLOC INVISIBLE : la lectrice lit cinq blocs sur six, et pas celui de Grands comptes', async ({
		request,
	}) => {
		// C'est la règle du §4.1, et le cas qui la motive. Le bloc n'est pas grisé, il est ABSENT :
		// le griser révélerait qu'un objectif existe sur un channel interdit, et son titre en
		// dirait déjà trop.
		const vusParLaLectrice = await request.get(
			`${BLOCKS}?board_id=eq.${TABLEAU_SEED}&select=id,title`,
			{ headers: enTetesAuthentifies(jetonViewer) },
		)
		expect(vusParLaLectrice.status()).toBe(200)
		expect(await vusParLaLectrice.json()).toHaveLength(5)

		// Nommément, et pas seulement par le compte : une erreur de comptage ailleurs dans le seed
		// rendrait l'assertion précédente verte sur le mauvais bloc.
		const nommement = await request.get(`${BLOCKS}?id=eq.${BLOC_GRANDS_COMPTES}&select=id`, {
			headers: enTetesAuthentifies(jetonViewer),
		})
		expect(nommement.status()).toBe(200)
		expect(await nommement.json()).toEqual([])

		// Et l'administratrice, elle, les lit tous les six : sans cette moitié, l'assertion serait
		// verte sur une table vide.
		const vusParLAdmin = await request.get(`${BLOCKS}?board_id=eq.${TABLEAU_SEED}&select=id`, {
			headers: enTetesAuthentifies(jetonAdmin),
		})
		expect(await vusParLAdmin.json()).toHaveLength(6)
	})

	test('la FLÈCHE du bloc invisible reste lisible : le dessin ne disparaît pas', async ({
		request,
	}) => {
		// La lecture d'un lien ne dépend QUE du tableau (§9 bis.7). La lectrice voit donc les
		// quatre flèches, dont celle qui part d'un bloc qui n'existe pas pour elle : c'est l'état
		// « pointillés vers le vide » du §5.4, que `CRM-083` rendra.
		const reponse = await request.get(
			`${LINKS}?board_id=eq.${TABLEAU_SEED}&select=id,direction`,
			{ headers: enTetesAuthentifies(jetonViewer) },
		)
		expect(reponse.status()).toBe(200)
		const fleches = (await reponse.json()) as { direction: string }[]
		expect(fleches).toHaveLength(4)
		expect(new Set(fleches.map((f) => f.direction))).toEqual(
			new Set(['forward', 'backward', 'both']),
		)
	})

	// -------------------------------------------------------------------------------------------
	// 2. Le refus de la lectrice sur CHACUNE des trois tables
	// -------------------------------------------------------------------------------------------
	// La DoD l'exige table par table, et « mesuré comme zéro ligne ou 403 SELON LE GESTE ». Les
	// deux formes apparaissent ci-dessous, et chacune est attendue nommément.

	test('la lectrice n’INSÈRE rien, sur les trois tables : 403 à chaque fois', async ({
		request,
	}) => {
		const gestes = [
			{
				table: 'goal_boards',
				url: BOARDS,
				charge: { workspace_id: WORKSPACE, name: 'Tableau de la lectrice', position: 95 },
			},
			{
				table: 'goal_blocks',
				url: BLOCKS,
				charge: blocDEssai(
					'c0000000-0000-4000-8000-0000000000b9',
					'Bloc de la lectrice',
					900,
					null,
				),
			},
			{
				table: 'goal_links',
				url: LINKS,
				charge: {
					board_id: TABLEAU_ESSAI,
					source_block_id: BLOC_A,
					target_block_id: BLOC_B,
					direction: 'forward',
				},
			},
		]

		for (const geste of gestes) {
			const reponse = await request.post(geste.url, {
				headers: enTetesAuthentifies(jetonViewer),
				data: geste.charge,
			})
			expect(reponse.status(), `insertion de la lectrice dans ${geste.table}`).toBe(403)
			const corps = await reponse.json()
			expect(corps.code, `code SQL du refus sur ${geste.table}`).toBe('42501')
		}
	})

	test('la lectrice ne MODIFIE ni ne SUPPRIME rien : le refus FILTRE, sans erreur', async ({
		request,
	}) => {
		// Un refus opposé par le `USING` ne lève pas : il ne touche aucune ligne (décision 106).
		// La preuve est donc le corps VIDE d'un `return=representation`, et non un code d'erreur —
		// attendre `403` ici serait attendre le mauvais refus.
		const modification = await request.patch(`${BOARDS}?id=eq.${TABLEAU_SEED}`, {
			headers: { ...enTetesAuthentifies(jetonViewer), Prefer: 'return=representation' },
			data: { name: 'Renommé par la lectrice' },
		})
		expect(modification.status()).toBe(200)
		expect(await modification.json()).toEqual([])

		const suppression = await request.delete(`${BOARDS}?id=eq.${TABLEAU_SEED}`, {
			headers: { ...enTetesAuthentifies(jetonViewer), Prefer: 'return=representation' },
		})
		expect(suppression.status()).toBe(200)
		expect(await suppression.json()).toEqual([])

		// Et le tableau est TOUJOURS LÀ. Sans cette relecture, les deux assertions précédentes
		// seraient vertes sur un tableau réellement détruit dont la représentation serait vide.
		const relecture = await request.get(`${BOARDS}?id=eq.${TABLEAU_SEED}&select=id,name`, {
			headers: enTetesAuthentifies(jetonAdmin),
		})
		const lignes = (await relecture.json()) as { name: string }[]
		expect(lignes).toHaveLength(1)
		expect(lignes[0]?.name).toBe('Objectifs du trimestre')
	})

	test('la lectrice ne SUPPRIME ni un BLOC ni une FLÈCHE, et les deux lignes restent', async ({
		request,
	}) => {
		// La DoD exige le refus mesuré HORS interface, table par table. Le geste de suppression de
		// la tranche 2b-2c touche `goal_blocks` ET `goal_links`, et le refus y prend la forme du
		// `USING` : `200` et zéro ligne, jamais une erreur. Les fixtures d'essai sont posées par la
		// clé de service, la lectrice ne pouvant rien créer.
		const fleche = 'c0000000-0000-4000-8000-0000000000a9'
		await request.post(LINKS, {
			headers: { ...enTetesService(), Prefer: 'return=representation' },
			data: {
				id: fleche,
				board_id: TABLEAU_ESSAI,
				source_block_id: BLOC_A,
				target_block_id: BLOC_B,
				direction: 'forward',
			},
		})

		for (const geste of [
			{ table: 'goal_links', url: `${LINKS}?id=eq.${fleche}` },
			{ table: 'goal_blocks', url: `${BLOCKS}?id=eq.${BLOC_A}` },
		]) {
			const suppression = await request.delete(geste.url, {
				headers: { ...enTetesAuthentifies(jetonViewer), Prefer: 'return=representation' },
			})
			expect(suppression.status(), `suppression de la lectrice dans ${geste.table}`).toBe(200)
			expect(await suppression.json(), `lignes retirées dans ${geste.table}`).toEqual([])
		}

		// ET LES DEUX LIGNES SONT TOUJOURS LÀ : sans cette relecture, les assertions ci-dessus
		// seraient vertes sur des lignes réellement détruites dont la représentation serait vide.
		for (const url of [`${LINKS}?id=eq.${fleche}&select=id`, `${BLOCKS}?id=eq.${BLOC_A}&select=id`]) {
			const relecture = await request.get(url, { headers: enTetesService() })
			expect((await relecture.json()) as unknown[]).toHaveLength(1)
		}

		await request.delete(`${LINKS}?id=eq.${fleche}`, { headers: enTetesService() })
	})

	// -------------------------------------------------------------------------------------------
	// 3. L'écriture, et le lien qui engage la destination
	// -------------------------------------------------------------------------------------------

	test('le business developer CRÉE un tableau sans demander un administrateur', async ({
		request,
	}) => {
		// Arbitrage du responsable du 2026-08-19 : la lavagna est un outil de travail, pas une
		// configuration. C'est ce qui distingue `goal_boards` d'un track.
		const reponse = await request.post(BOARDS, {
			headers: { ...enTetesAuthentifies(jetonBizdev), Prefer: 'return=representation' },
			data: {
				workspace_id: WORKSPACE,
				name: 'Tableau du business developer',
				position: 91,
			},
		})
		expect(reponse.status()).toBe(201)
	})

	test('POSER un lien exige l’ÉCRITURE du channel, pas seulement sa lecture', async ({
		request,
	}) => {
		// MESURÉ : le business developer LIT « Maintenance » et ne l'ÉCRIT PAS. Un lien est une
		// affirmation publique — « cet objectif porte sur ce dossier » — que verront tous ceux qui
		// lisent le channel ; qui n'a que la lecture ne peut pas engager le dossier d'autrui.
		const refus = await request.post(BLOCKS, {
			headers: enTetesAuthentifies(jetonBizdev),
			data: blocDEssai(
				'c0000000-0000-4000-8000-0000000000c1',
				'Lien vers Maintenance',
				1200,
				CH_MAINTENANCE,
			),
		})
		expect(refus.status()).toBe(403)
		expect((await refus.json()).code).toBe('42501')

		// LE MÊME GESTE VERS UN CHANNEL QU'IL ÉCRIT RÉUSSIT. Sans cette moitié, l'assertion
		// précédente serait verte sur une politique qui refuserait tout bloc lié.
		const succes = await request.post(BLOCKS, {
			headers: { ...enTetesAuthentifies(jetonBizdev), Prefer: 'return=representation' },
			data: blocDEssai(
				'c0000000-0000-4000-8000-0000000000c2',
				'Lien vers Prospection',
				1500,
				CH_PROSPECTION,
			),
		})
		expect(succes.status()).toBe(201)
	})

	test('RETIRER un lien reste possible à qui écrit le bloc — l’asymétrie du using et du with check', async ({
		request,
	}) => {
		// C'est la règle du §4.2, et elle se mesure en DEUX temps qui ne rendent pas le même code.
		//
		// 1. Le retrait passe : le `USING` n'exige que la LECTURE du channel actuel. Sans cette
		//    asymétrie, un bloc lié à un channel qu'on ne peut plus écrire serait définitivement
		//    figé — « on peut toujours défaire ce qui gêne ».
		const retrait = await request.patch(`${BLOCKS}?id=eq.${BLOC_MAINTENANCE}`, {
			headers: { ...enTetesAuthentifies(jetonBizdev), Prefer: 'return=representation' },
			data: { channel_id: null },
		})
		expect(retrait.status()).toBe(200)
		expect(await retrait.json()).toHaveLength(1)

		// 2. La REPOSE est refusée, et par un code DIFFÉRENT : le `WITH CHECK` lève `403`/`42501`
		//    là où le `USING` filtrait en silence. La règle n'a pas été contournée, elle a été
		//    appliquée dans le seul sens où elle s'applique.
		const repose = await request.patch(`${BLOCKS}?id=eq.${BLOC_MAINTENANCE}`, {
			headers: enTetesAuthentifies(jetonBizdev),
			data: { channel_id: CH_MAINTENANCE },
		})
		expect(repose.status()).toBe(403)
		expect((await repose.json()).code).toBe('42501')
	})

	// -------------------------------------------------------------------------------------------
	// 4. Les gardes de forme, vues depuis HTTP
	// -------------------------------------------------------------------------------------------

	test('les quatre gardes du modèle répondent 400, et le CYCLE est accepté', async ({
		request,
	}) => {
		const refuses = [
			{
				libelle: 'fill_percent hors bornes',
				url: BLOCKS,
				charge: {
					...blocDEssai('c0000000-0000-4000-8000-0000000000d1', 'Hors bornes', 0, null),
					fill_percent: 101,
				},
			},
			{
				libelle: 'couleur hexadécimale',
				url: BLOCKS,
				charge: {
					...blocDEssai('c0000000-0000-4000-8000-0000000000d2', 'Hexadécimal', 0, null),
					color: '#23468C',
				},
			},
			{
				libelle: 'boucle d’un bloc sur lui-même',
				url: LINKS,
				charge: {
					board_id: TABLEAU_ESSAI,
					source_block_id: BLOC_A,
					target_block_id: BLOC_A,
					direction: 'forward',
				},
			},
			{
				libelle: 'direction hors des trois nommées',
				url: LINKS,
				charge: {
					board_id: TABLEAU_ESSAI,
					source_block_id: BLOC_A,
					target_block_id: BLOC_B,
					direction: 'sideways',
				},
			},
		]

		for (const cas of refuses) {
			const reponse = await request.post(cas.url, {
				headers: enTetesAuthentifies(jetonAdmin),
				data: cas.charge,
			})
			expect(reponse.status(), `refus attendu : ${cas.libelle}`).toBe(400)
		}

		// LE CYCLE EST ACCEPTÉ, et c'est la seule assertion de ce fichier qu'une implémentation
		// zélée refusant les cycles rendrait rouge (`docs/SPEC-goals.md` §2.3).
		const aller = await request.post(LINKS, {
			headers: enTetesAuthentifies(jetonAdmin),
			data: {
				board_id: TABLEAU_ESSAI,
				source_block_id: BLOC_A,
				target_block_id: BLOC_B,
				direction: 'forward',
			},
		})
		expect(aller.status()).toBe(201)

		const retour = await request.post(LINKS, {
			headers: enTetesAuthentifies(jetonAdmin),
			data: {
				board_id: TABLEAU_ESSAI,
				source_block_id: BLOC_B,
				target_block_id: BLOC_A,
				direction: 'forward',
			},
		})
		expect(retour.status(), 'A nourrit B et B nourrit A est une intention légitime').toBe(201)
	})

	test('une flèche entre deux TABLEAUX est refusée par le trigger', async ({ request }) => {
		// C'est la raison d'être de la redondance de `goal_links.board_id` (§2.4) : sans elle, un
		// lien entre deux tableaux ne se détecterait qu'à l'affichage.
		const reponse = await request.post(LINKS, {
			headers: enTetesAuthentifies(jetonAdmin),
			data: {
				board_id: TABLEAU_ESSAI,
				source_block_id: BLOC_A,
				target_block_id: '5eed0000-0000-4000-8000-0000000000e2',
				direction: 'forward',
			},
		})
		expect(reponse.status()).toBe(400)
		expect(await reponse.text()).toContain('même tableau')
	})

	// -------------------------------------------------------------------------------------------
	// 5. Le seed sort intact
	// -------------------------------------------------------------------------------------------

	test('le tableau du seed est rendu intact : six blocs, quatre flèches', async ({ request }) => {
		// Dernière lecture plutôt que supposition : les scénarios ci-dessus écrivent, et une
		// fixture mal bornée déplacerait les captures de `CRM-083`.
		const blocs = await request.get(`${BLOCKS}?board_id=eq.${TABLEAU_SEED}&select=id`, {
			headers: enTetesService(),
		})
		expect(await blocs.json()).toHaveLength(6)

		const flechesSeed = await request.get(`${LINKS}?board_id=eq.${TABLEAU_SEED}&select=id`, {
			headers: enTetesService(),
		})
		expect(await flechesSeed.json()).toHaveLength(4)
	})
})
