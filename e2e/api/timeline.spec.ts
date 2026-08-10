// @verifies CRM-044 (docs/BACKLOG.md) — timeline unifiée, hors interface
// @verifies docs/SPEC-cards.md §14.4 (les dix types), §14.5 (triggers `SECURITY DEFINER`),
//           §14.6 (payloads), §14.7 (AUCUNE écriture cliente), §14.8 (immuabilité),
//           §14.9 (contrat d'API), §14.11 (seed), §14.14 (preuves attendues)
// @verifies docs/SPEC-permissions-rls.md §7 (preuves hors interface, jetons réels ; preuve de
//           refus n° 8, satisfaisable pour moitié depuis cette unité)
// @verifies docs/SPEC-seed.md §2.15 (événements du seed)
// @verifies docs/INCONSISTENCY_REPORT.md INC-061 (jeu d'essai nettoyé), INC-048 (le motif d'une
//           transition, toujours perdu)
// @verifies CLAUDE.md §8 (aucune trace fabriquée), §10 (toute règle d'accès se prouve hors
//           interface, avec le jeton réel)
//
// LA QUESTION À LAQUELLE CE FICHIER RÉPOND. La suite pgTAP prouve les mêmes règles **dans la
// base**, avec `set local role` : elle ne traverse ni PostgREST, ni Kong, ni GoTrue. Or la
// Definition of Done de `CRM-044` porte sur ce qu'un CLIENT peut faire — et un client passe par la
// pile. Un refus de privilège rendu `403` par PostgREST, un `POST` sur une table sans politique
// d'insertion, une lecture filtrée par la RLS : rien de cela ne se voit depuis `psql`.
//
// IL ÉCRIT — INDIRECTEMENT — ET IL NETTOIE. Aucune ligne de `card_events` n'est écrite par ce
// fichier : il ne le peut pas, c'est justement ce qu'il prouve. Il crée en revanche **une card
// d'essai**, dont les triggers produisent des événements, et il la détruit en fin de fichier —
// la cascade emportant sa mémoire (docs/SPEC-cards.md §14.8). L'identifiant est ÉNUMÉRÉ et non
// filtré par motif : MESURÉ à `CRM-043`, `?id=like.f00d*` rend `404` sur une colonne `uuid`
// (INC-061, décision 199).

import { expect, test } from '@playwright/test'
import {
	CLE_ANONYME,
	URL_API,
	enTetesAnonymes,
	enTetesAuthentifies,
	enTetesService,
	jetonDe,
} from './jetons'

const EVENEMENTS = '/rest/v1/card_events'
const CARDS = '/rest/v1/cards'

/** Identifiants du seed, mesurés en base le 2026-08-05 (docs/SPEC-seed.md §2.15). */
const CARD_GRANDS_COMPTES = '5eed0000-0000-4000-8000-0000000000c1'
const CARD_REFONTE = '5eed0000-0000-4000-8000-0000000000c4'
const CARD_MAINTENANCE = '5eed0000-0000-4000-8000-0000000000c5'
const CHANNEL_GRANDS_COMPTES = '5eed0000-0000-4000-8000-000000000032'
const WORKFLOW_GLOBAL = '5eed0000-0000-4000-8000-000000000051'
const ETAPE_QUALIFICATION = '5eed0000-0000-4000-8000-000000000061'
const ETAPE_RELANCE = '5eed0000-0000-4000-8000-000000000062'
const WORKSPACE = '5eed0000-0000-4000-8000-000000000001'
const ADMIN = '5eed0000-0000-4000-8000-000000000011'
const BIZDEV = '5eed0000-0000-4000-8000-000000000012'

/** La card d'essai de ce fichier. Préfixe `f00d`, jamais `5eed` : INC-061 en sens inverse. */
const CARD_ESSAI = 'f00d0000-0000-4000-8000-0000000000e1'

const champs = 'id,card_id,type,actor_id,payload,created_at'
const filDe = (card: string) =>
	`${EVENEMENTS}?card_id=eq.${card}&select=${champs}&order=created_at.asc,id.asc`

test.describe('CRM-044 — la mémoire d’une affaire, hors interface', () => {
	let jetonAdmin = ''
	let jetonViewer = ''

	test.beforeAll(async () => {
		jetonAdmin = await jetonDe('admin@p2enjoy.test')
		jetonViewer = await jetonDe('viewer@p2enjoy.test')
	})

	test.afterAll(async ({ request }) => {
		// La card d'essai emporte sa mémoire (§14.8) : une seule suppression suffit, et elle est
		// CONSTATÉE plutôt que supposée.
		await request.delete(`${URL_API}${CARDS}?id=eq.${CARD_ESSAI}`, { headers: enTetesService() })
		const reste = await request.get(`${URL_API}${CARDS}?id=eq.${CARD_ESSAI}&select=id`, {
			headers: enTetesService(),
		})
		expect(await reste.json(), 'la card d’essai n’a pas été nettoyée').toEqual([])
		const memoire = await request.get(
			`${URL_API}${EVENEMENTS}?card_id=eq.${CARD_ESSAI}&select=id`,
			{ headers: enTetesService() },
		)
		expect(
			await memoire.json(),
			'la cascade n’a pas emporté les événements de la card d’essai',
		).toEqual([])
	})

	// --- a, b, c, d : la lecture --------------------------------------------------------------

	test('a — l’anonyme ne lit aucun événement, et la clé de service en voit', async ({
		request,
	}) => {
		// La clé de service ÉTABLIT que les lignes existent avant qu'on affirme que personne ne les
		// voit (décision 50). Sans elle, un « zéro ligne » serait vrai sur une table vide.
		const service = await request.get(filDe(CARD_GRANDS_COMPTES), { headers: enTetesService() })
		expect(service.status()).toBe(200)
		expect((await service.json()).length).toBeGreaterThan(0)

		const anonyme = await request.get(filDe(CARD_GRANDS_COMPTES), { headers: enTetesAnonymes() })
		expect(anonyme.status()).toBe(200)
		expect(await anonyme.json()).toEqual([])
	})

	test('b — l’administratrice lit le fil d’une card, dans l’ordre croissant', async ({
		request,
	}) => {
		const reponse = await request.get(filDe(CARD_GRANDS_COMPTES), {
			headers: enTetesAuthentifies(jetonAdmin),
		})
		expect(reponse.status()).toBe(200)

		const fil = (await reponse.json()) as Array<{ type: string; created_at: string }>
		expect(fil.length).toBeGreaterThan(0)
		expect(fil.at(0)?.type).toBe('created')

		const dates = fil.map((e) => e.created_at)
		expect(dates, 'le fil n’est pas rendu dans l’ordre croissant').toEqual([...dates].sort())
	})

	test('c — le viewer ne lit rien d’une card dont le track lui est fermé', async ({ request }) => {
		const service = await request.get(filDe(CARD_GRANDS_COMPTES), { headers: enTetesService() })
		expect((await service.json()).length).toBeGreaterThan(0)

		const viewer = await request.get(filDe(CARD_GRANDS_COMPTES), {
			headers: enTetesAuthentifies(jetonViewer),
		})
		expect(viewer.status()).toBe(200)
		expect(await viewer.json()).toEqual([])
	})

	test('d — le viewer LIT la mémoire d’une card qu’il voit', async ({ request }) => {
		// LA DIFFÉRENCE AVEC `CRM-043` EST LE POINT DE CE SCÉNARIO. Écrire un commentaire exige le
		// droit d'ÉCRITURE (INC-071) ; lire la mémoire n'exige que de LIRE.
		const reponse = await request.get(filDe(CARD_MAINTENANCE), {
			headers: enTetesAuthentifies(jetonViewer),
		})
		expect(reponse.status()).toBe(200)
		expect((await reponse.json()).length).toBeGreaterThan(0)
	})

	// --- e, f, g, h : aucune écriture cliente, la Definition of Done ---------------------------

	test('e — l’administratrice ne peut PAS forger un événement', async ({ request }) => {
		const reponse = await request.post(`${URL_API}${EVENEMENTS}`, {
			headers: enTetesAuthentifies(jetonAdmin),
			data: { card_id: CARD_GRANDS_COMPTES, workspace_id: WORKSPACE, type: 'moved' },
		})
		expect(reponse.status()).toBe(403)
		const corps = await reponse.json()
		expect(corps.code).toBe('42501')
		expect(corps.message).toContain('permission denied for table card_events')
	})

	test('f — LE COMPTE DE SERVICE NON PLUS', async ({ request }) => {
		// C'est la propriété que l'unité cherchait (décision 205) : `CLAUDE.md` §8 cesse d'être une
		// convention et devient une propriété de la base. Le seed ne PEUT pas fabriquer une trace.
		const reponse = await request.post(`${URL_API}${EVENEMENTS}`, {
			headers: enTetesService(),
			data: { card_id: CARD_GRANDS_COMPTES, workspace_id: WORKSPACE, type: 'moved' },
		})
		expect(reponse.status()).toBe(403)
		expect((await reponse.json()).code).toBe('42501')
	})

	test('g — aucun événement ne peut être modifié', async ({ request }) => {
		const fil = await request.get(filDe(CARD_GRANDS_COMPTES), { headers: enTetesService() })
		const premier = (await fil.json())[0] as { id: string; payload: unknown }

		const reponse = await request.patch(`${URL_API}${EVENEMENTS}?id=eq.${premier.id}`, {
			headers: enTetesAuthentifies(jetonAdmin),
			data: { payload: { forge: true } },
		})
		expect(reponse.status()).toBe(403)
		expect((await reponse.json()).code).toBe('42501')

		// Le refus est relu : un `USING` qui filtre rendrait `200` et un corps vide sans rien
		// modifier, et l'assertion de statut ne le distinguerait pas d'un refus (précaution n° 2 du
		// §7.2 de docs/SPEC-permissions-rls.md).
		const relu = await request.get(`${URL_API}${EVENEMENTS}?id=eq.${premier.id}&select=payload`, {
			headers: enTetesService(),
		})
		expect((await relu.json())[0].payload).toEqual(premier.payload)
	})

	test('h — aucun événement ne peut être supprimé', async ({ request }) => {
		const fil = await request.get(filDe(CARD_GRANDS_COMPTES), { headers: enTetesService() })
		const avant = (await fil.json()).length

		const reponse = await request.delete(
			`${URL_API}${EVENEMENTS}?card_id=eq.${CARD_GRANDS_COMPTES}`,
			{ headers: enTetesAuthentifies(jetonAdmin) },
		)
		expect(reponse.status()).toBe(403)
		expect((await reponse.json()).code).toBe('42501')

		const apres = await request.get(filDe(CARD_GRANDS_COMPTES), { headers: enTetesService() })
		expect((await apres.json()).length).toBe(avant)
	})

	// --- i, j, k, l : ce que les triggers écrivent réellement, par la vraie route ---------------

	test('i — `move_card` laisse un événement `moved`, avec son acteur et ses deux étapes', async ({
		request,
	}) => {
		// La card d'essai naît ici : elle porte le premier scénario d'écriture, et sert aux
		// suivants. Elle est détruite dans `afterAll`.
		const creation = await request.post(`${URL_API}${CARDS}`, {
			headers: { ...enTetesAuthentifies(jetonAdmin), Prefer: 'return=representation' },
			data: {
				id: CARD_ESSAI,
				workspace_id: WORKSPACE,
				channel_id: CHANNEL_GRANDS_COMPTES,
				workflow_id: WORKFLOW_GLOBAL,
				current_step_id: ETAPE_QUALIFICATION,
				title: 'Sonde de timeline',
			},
		})
		expect(creation.status()).toBe(201)

		// l — le `created` est écrit, et son acteur est l'administratrice : `auth.uid()` est bien
		// atteint depuis une fonction `SECURITY DEFINER` (§14.5).
		const naissance = await request.get(filDe(CARD_ESSAI), { headers: enTetesService() })
		const fil0 = (await naissance.json()) as Array<{ type: string; actor_id: string | null }>
		expect(fil0).toHaveLength(1)
		expect(fil0.at(0)?.type).toBe('created')
		expect(fil0.at(0)?.actor_id).toBe(ADMIN)

		const deplacement = await request.post(`${URL_API}/rest/v1/rpc/move_card`, {
			headers: enTetesAuthentifies(jetonAdmin),
			data: { card_id: CARD_ESSAI, to_step_id: ETAPE_RELANCE },
		})
		expect(deplacement.status()).toBe(200)

		const apres = await request.get(filDe(CARD_ESSAI), { headers: enTetesService() })
		const fil = (await apres.json()) as Array<{
			type: string
			actor_id: string | null
			payload: Record<string, unknown>
		}>
		expect(fil.map((e) => e.type)).toEqual(['created', 'moved'])

		const bouge = fil.at(1)
		expect(bouge?.actor_id).toBe(ADMIN)
		expect(bouge?.payload).toEqual({
			from_step_id: ETAPE_QUALIFICATION,
			to_step_id: ETAPE_RELANCE,
		})
		// INC-048 : le `comment` que `move_card` exige n'atteint TOUJOURS aucune destination.
		expect(bouge?.payload).not.toHaveProperty('comment')
	})

	test('j — un changement de responsable laisse un `assigned`', async ({ request }) => {
		const reponse = await request.patch(`${URL_API}${CARDS}?id=eq.${CARD_ESSAI}`, {
			headers: { ...enTetesAuthentifies(jetonAdmin), Prefer: 'return=representation' },
			data: { owner_id: BIZDEV },
		})
		expect(reponse.status()).toBe(200)

		const fil = await request.get(`${filDe(CARD_ESSAI)}&type=eq.assigned`, {
			headers: enTetesService(),
		})
		const assignations = (await fil.json()) as Array<{
			actor_id: string
			payload: Record<string, unknown>
		}>
		expect(assignations).toHaveLength(1)
		expect(assignations.at(0)?.actor_id).toBe(ADMIN)
		expect(assignations.at(0)?.payload).toEqual({ from_owner_id: null, to_owner_id: BIZDEV })
	})

	test('k — une écriture qui ne change rien n’écrit AUCUN événement', async ({ request }) => {
		const avant = await request.get(filDe(CARD_ESSAI), { headers: enTetesService() })
		const nombre = (await avant.json()).length

		// Le même responsable, réécrit. C'est ce qui rend le seed convergent (§14.5).
		const reponse = await request.patch(`${URL_API}${CARDS}?id=eq.${CARD_ESSAI}`, {
			headers: { ...enTetesAuthentifies(jetonAdmin), Prefer: 'return=representation' },
			data: { owner_id: BIZDEV, title: 'Sonde de timeline' },
		})
		expect(reponse.status()).toBe(200)

		const apres = await request.get(filDe(CARD_ESSAI), { headers: enTetesService() })
		expect((await apres.json()).length).toBe(nombre)
	})

	test('l — le cycle de vie complet est tracé, et l’acteur d’une écriture de service est NUL', async ({
		request,
	}) => {
		// Les quatre types que le seed ne démontre pas (§2.15 de docs/SPEC-seed.md) sont exercés
		// ici, sur la card d'essai, par la clé de SERVICE — ce qui prouve du même coup que
		// `actor_id` est nul lorsque l'auteur n'est pas un utilisateur.
		for (const etat of [
			{ archived_at: new Date().toISOString() },
			{ archived_at: null },
			{ deleted_at: new Date().toISOString() },
			{ deleted_at: null },
		]) {
			const reponse = await request.patch(`${URL_API}${CARDS}?id=eq.${CARD_ESSAI}`, {
				headers: { ...enTetesService(), Prefer: 'return=representation' },
				data: etat,
			})
			expect(reponse.status()).toBe(200)
		}

		const fil = await request.get(filDe(CARD_ESSAI), { headers: enTetesService() })
		const evenements = (await fil.json()) as Array<{ type: string; actor_id: string | null }>

		expect(evenements.map((e) => e.type)).toEqual([
			'created',
			'moved',
			'assigned',
			'archived',
			'unarchived',
			'trashed',
			'restored',
		])

		const cycle = evenements.slice(3)
		expect(
			cycle.every((e) => e.actor_id === null),
			'un événement écrit par la clé de service porte un acteur',
		).toBe(true)
	})

	// --- Le seed, et ce qu'il démontre ---------------------------------------------------------

	test('m — le seed a fait naître quatorze cards, et son histoire ne cesse plus de croître', async ({
		request,
	}) => {
		// Les quatorze cards du seed sont ÉNUMÉRÉES, jamais filtrées par motif :
		// `?card_id=like.5eed*`
		// rend `404` sur une colonne `uuid` (INC-061, décision 199), et un filtre par exclusion
		// compterait les cards d'essai des autres fichiers de preuve, qui s'exécutent dans la même
		// pile.
		const CARDS_DU_SEED = [
			...Array.from(
				{ length: 9 },
				(_, rang) => `5eed0000-0000-4000-8000-0000000000c${rang + 1}`,
			),
			'5eed0000-0000-4000-8000-0000000000ca',
			'5eed0000-0000-4000-8000-0000000000cb',
			'5eed0000-0000-4000-8000-0000000000cc',
			'5eed0000-0000-4000-8000-0000000000cd',
			'5eed0000-0000-4000-8000-0000000000ce',
		]
		const tous = await request.get(
			`${URL_API}${EVENEMENTS}?select=type,actor_id&card_id=in.(${CARDS_DU_SEED.join(',')})`,
			{ headers: enTetesService() },
		)
		expect(tous.status()).toBe(200)
		const evenements = (await tous.json()) as Array<{ type: string; actor_id: string | null }>

		// LE SEUL COMPTE EXACT QUI TIENNE : une card ne naît qu'une fois (décision 210). Le seed
		// pose 41 événements sur une base fraîchement seedée — `scripts/verify-timeline.sh` le
		// mesure à cet instant-là —, mais une timeline enregistre TOUT, y compris ce que les
		// dix-neuf autres fichiers de preuve font à la même pile. Le reste est donc borné par le
		// bas, et cette croissance est elle-même une démonstration : la trace est réelle.
		expect(evenements.filter((e) => e.type === 'created')).toHaveLength(14)
		expect(evenements.filter((e) => e.type === 'created' && e.actor_id !== null)).toHaveLength(0)
		expect(evenements.filter((e) => e.type === 'field_changed').length).toBeGreaterThanOrEqual(21)
		expect(evenements.filter((e) => e.type === 'moved').length).toBeGreaterThanOrEqual(2)
		expect(evenements.filter((e) => e.type === 'assigned').length).toBeGreaterThanOrEqual(2)
		expect(evenements.filter((e) => e.type === 'channel_changed').length).toBeGreaterThanOrEqual(2)
		expect(evenements.filter((e) => e.actor_id === ADMIN).length).toBeGreaterThanOrEqual(4)
	})

	test('n — l’aller-retour du seed n’a laissé AUCUNE trace d’état', async ({ request }) => {
		const reponse = await request.get(
			`${URL_API}${CARDS}?id=in.(${CARD_GRANDS_COMPTES},${CARD_REFONTE})&select=id,current_step_id,owner_id&order=id`,
			{ headers: enTetesService() },
		)
		const cards = (await reponse.json()) as Array<{
			id: string
			current_step_id: string
			owner_id: string
		}>
		expect(cards.at(0)?.owner_id).toBe(BIZDEV)
		expect(cards.at(1)?.current_step_id).toBe('5eed0000-0000-4000-8000-000000000063')
	})

	test('o — le vocabulaire est tenu par la base, et les types de messagerie sont refusés', async ({
		request,
	}) => {
		// Le refus vient du privilège AVANT de venir du `CHECK` : c'est la preuve que même un type
		// légitime n'ouvrirait aucune porte. Le `CHECK` lui-même est éprouvé par la suite pgTAP,
		// seul endroit d'où l'on peut écrire.
		for (const type of ['mail_received', 'mail_sent', 'commented']) {
			const reponse = await request.post(`${URL_API}${EVENEMENTS}`, {
				headers: enTetesService(),
				data: { card_id: CARD_GRANDS_COMPTES, workspace_id: WORKSPACE, type },
			})
			expect(reponse.status()).toBe(403)
		}
	})

	test('p — la clé anonyme sans jeton n’atteint pas la table', async ({ request }) => {
		const reponse = await request.get(filDe(CARD_GRANDS_COMPTES), {
			headers: { apikey: CLE_ANONYME },
		})
		expect(reponse.status()).toBe(200)
		expect(await reponse.json()).toEqual([])
	})
})
