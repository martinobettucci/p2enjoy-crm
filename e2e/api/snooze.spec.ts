// @verifies CRM-081 (docs/BACKLOG.md) — snooze des fils et des cards, TRANCHE 1, hors interface
// @verifies docs/SPEC-cards.md §16.2 (ce que « en sommeil » signifie), §16.3 (`snooze_card` et ses
//           quatre refus), §16.4 (`wake_card` et son idempotence), §16.5 (la trace par trigger),
//           §16.7 (la colonne est fermée en écriture directe), §16.8 (contrat d'API, les neuf
//           lignes rejouées ici), §16.9 (preuves exigées)
// @verifies docs/SPEC-permissions-rls.md §4.3 (règle de discrétion), §4.4 (colonne constatée par
//           le serveur), §7 (preuve de refus n° 1)
// @verifies CLAUDE.md §10 (toute règle d'accès se prouve hors interface, avec le jeton réel)
//
// LA QUESTION À LAQUELLE CE FICHIER RÉPOND. La suite pgTAP prouve les mêmes règles DANS la base,
// avec `set local role` : elle ne traverse ni Kong, ni PostgREST, ni GoTrue. Or le §16.8 est un
// contrat d'API — codes HTTP compris —, et un `revoke` de colonne rendu `403` par PostgREST ne se
// voit pas depuis `psql`.
//
// IL ÉCRIT, ET IL NETTOIE. Les gestes sont joués sur DEUX cards d'essai, jamais sur une card du
// seed : `snooze_card` et `wake_card` laissent des événements dans un fil APPEND-ONLY que rien ne
// peut effacer, et les poser sur une card seedée déplacerait les empreintes dont
// `scripts/verify-seed-demo.sh` prouve la convergence. Les deux cards sont détruites en fin de
// fichier, la cascade emportant leur mémoire (docs/SPEC-cards.md §14.8). Préfixe `f00d`, jamais
// `5eed` (INC-061).

import { expect, test } from '@playwright/test'
import { URL_API, enTetesAuthentifies, enTetesService, jetonDe } from './jetons'

const CARDS = '/rest/v1/cards'
const EVENEMENTS = '/rest/v1/card_events'
const RPC = '/rest/v1/rpc'

/** Identifiants du seed, stables par contrat (docs/SPEC-seed.md). */
const WORKSPACE = '5eed0000-0000-4000-8000-000000000001'
const CHANNEL_GRANDS_COMPTES = '5eed0000-0000-4000-8000-000000000032'
const CHANNEL_MAINTENANCE = '5eed0000-0000-4000-8000-000000000035'
const WORKFLOW_GLOBAL = '5eed0000-0000-4000-8000-000000000051'
const ETAPE_QUALIFICATION = '5eed0000-0000-4000-8000-000000000061'

/** Les deux cards d'essai de ce fichier. */
const CARD_FERMEE = 'f00d0000-0000-4000-8000-0000000000d1' // `grands-comptes` : invisible de la lectrice
const CARD_LUE = 'f00d0000-0000-4000-8000-0000000000d2' // `maintenance` : lue par la lectrice, sans écriture

const ECHEANCE = '2099-01-01T00:00:00+00:00'
const ECHEANCE_REPORTEE = '2099-06-01T00:00:00+00:00'

const filDe = (card: string) =>
	`${EVENEMENTS}?card_id=eq.${card}&select=type,payload&order=created_at.asc,id.asc`

type Evenement = { type: string; payload: Record<string, unknown> }

test.describe('CRM-081 — la mise en sommeil, hors interface', () => {
	let jetonAdmin = ''
	let jetonViewer = ''

	test.beforeAll(async ({ request }) => {
		jetonAdmin = await jetonDe('admin@p2enjoy.test')
		jetonViewer = await jetonDe('viewer@p2enjoy.test')

		for (const [id, channel] of [
			[CARD_FERMEE, CHANNEL_GRANDS_COMPTES],
			[CARD_LUE, CHANNEL_MAINTENANCE],
		] as const) {
			const creation = await request.post(`${URL_API}${CARDS}`, {
				headers: { ...enTetesAuthentifies(jetonAdmin), Prefer: 'return=representation' },
				data: {
					id,
					workspace_id: WORKSPACE,
					channel_id: channel,
					workflow_id: WORKFLOW_GLOBAL,
					current_step_id: ETAPE_QUALIFICATION,
					title: 'Sonde de sommeil',
				},
			})
			expect(creation.status(), 'la card d’essai est créée par le vrai chemin').toBe(201)
		}
	})

	test.afterAll(async ({ request }) => {
		for (const id of [CARD_FERMEE, CARD_LUE]) {
			await request.delete(`${URL_API}${CARDS}?id=eq.${id}`, { headers: enTetesService() })
			const memoire = await request.get(`${EVENEMENTS}?card_id=eq.${id}&select=id`.replace(/^/, URL_API), {
				headers: enTetesService(),
			})
			expect(await memoire.json(), 'la cascade a emporté la mémoire de la card d’essai').toEqual([])
		}
	})

	// --- 1, 2, 3 : le geste et ses refus de forme ---------------------------------------------

	test('1 — l’échéance future est enregistrée, et la fonction rend la ligne', async ({
		request,
	}) => {
		const reponse = await request.post(`${URL_API}${RPC}/snooze_card`, {
			headers: enTetesAuthentifies(jetonAdmin),
			data: { card_id: CARD_FERMEE, until: ECHEANCE },
		})
		expect(reponse.status()).toBe(200)

		// Objet JSON unique, non tableau : c'est ce que PostgREST fait d'un type composite.
		const card = (await reponse.json()) as { id: string; snoozed_until: string }
		expect(card.id).toBe(CARD_FERMEE)
		expect(new Date(card.snoozed_until).toISOString()).toBe(new Date(ECHEANCE).toISOString())
	})

	test('2 — une échéance passée est refusée, et la ligne est relue inchangée', async ({
		request,
	}) => {
		const avant = await request.get(`${URL_API}${CARDS}?id=eq.${CARD_LUE}&select=snoozed_until`, {
			headers: enTetesAuthentifies(jetonAdmin),
		})
		expect((await avant.json()).at(0)?.snoozed_until).toBeNull()

		const reponse = await request.post(`${URL_API}${RPC}/snooze_card`, {
			headers: enTetesAuthentifies(jetonAdmin),
			data: { card_id: CARD_LUE, until: '2020-01-01T00:00:00+00:00' },
		})
		expect(reponse.status()).toBe(400)
		expect((await reponse.json()).message).toBe('snooze_date_in_past')

		const apres = await request.get(`${URL_API}${CARDS}?id=eq.${CARD_LUE}&select=snoozed_until`, {
			headers: enTetesAuthentifies(jetonAdmin),
		})
		expect((await apres.json()).at(0)?.snoozed_until, 'le refus n’a rien écrit').toBeNull()
	})

	test('3 — une échéance absente est refusée', async ({ request }) => {
		const reponse = await request.post(`${URL_API}${RPC}/snooze_card`, {
			headers: enTetesAuthentifies(jetonAdmin),
			data: { card_id: CARD_LUE, until: null },
		})
		expect(reponse.status()).toBe(400)
		expect((await reponse.json()).message).toBe('snooze_date_required')
	})

	// --- 4, 5 : la règle de discrétion, avec le MÊME profil ------------------------------------

	test('4 — une card qu’elle ne lit pas est ABSENTE pour la lectrice', async ({ request }) => {
		const reponse = await request.post(`${URL_API}${RPC}/snooze_card`, {
			headers: enTetesAuthentifies(jetonViewer),
			data: { card_id: CARD_FERMEE, until: ECHEANCE },
		})
		expect(reponse.status()).toBe(400)
		expect(
			(await reponse.json()).message,
			'le refus ne lui apprend pas que la card existe (§4.3)',
		).toBe('card_not_found')
	})

	test('5 — une card qu’elle LIT sans y écrire rend `forbidden`', async ({ request }) => {
		const reponse = await request.post(`${URL_API}${RPC}/snooze_card`, {
			headers: enTetesAuthentifies(jetonViewer),
			data: { card_id: CARD_LUE, until: ECHEANCE },
		})
		expect(reponse.status(), 'preuve de refus n° 1, `42501` → `403`').toBe(403)
		expect((await reponse.json()).message).toBe('forbidden')
	})

	// --- 6 : la colonne est fermée ------------------------------------------------------------

	test('6 — le `PATCH` direct de `snoozed_until` est refusé par privilège', async ({
		request,
	}) => {
		const reponse = await request.patch(`${URL_API}${CARDS}?id=eq.${CARD_LUE}`, {
			headers: enTetesAuthentifies(jetonAdmin),
			data: { snoozed_until: ECHEANCE },
		})
		expect(
			reponse.status(),
			'sans cette fermeture, les quatre refus seraient contournables (§16.7)',
		).toBe(403)

		const apres = await request.get(`${URL_API}${CARDS}?id=eq.${CARD_LUE}&select=snoozed_until`, {
			headers: enTetesAuthentifies(jetonAdmin),
		})
		expect((await apres.json()).at(0)?.snoozed_until).toBeNull()
	})

	// --- 7, 8, 9 : le report, le réveil, son idempotence, et le fil ----------------------------

	test('7 — reporter puis réveiller, et le fil porte les trois gestes', async ({ request }) => {
		const report = await request.post(`${URL_API}${RPC}/snooze_card`, {
			headers: enTetesAuthentifies(jetonAdmin),
			data: { card_id: CARD_FERMEE, until: ECHEANCE_REPORTEE },
		})
		expect(report.status(), 'reporter une échéance est un geste ordinaire').toBe(200)

		const reveil = await request.post(`${URL_API}${RPC}/wake_card`, {
			headers: enTetesAuthentifies(jetonAdmin),
			data: { card_id: CARD_FERMEE },
		})
		expect(reveil.status()).toBe(200)
		expect((await reveil.json()).snoozed_until).toBeNull()

		const fil = (await (
			await request.get(`${URL_API}${filDe(CARD_FERMEE)}`, { headers: enTetesService() })
		).json()) as Evenement[]
		expect(fil.map((e) => e.type)).toEqual(['created', 'snoozed', 'snoozed', 'woken'])
		expect(new Date(String(fil.at(1)?.payload.until)).toISOString()).toBe(
			new Date(ECHEANCE).toISOString(),
		)
		expect(new Date(String(fil.at(3)?.payload.from)).toISOString()).toBe(
			new Date(ECHEANCE_REPORTEE).toISOString(),
		)
	})

	test('8 — réveiller une card qui ne dort pas n’écrit AUCUN événement', async ({ request }) => {
		const avant = (await (
			await request.get(`${URL_API}${filDe(CARD_FERMEE)}`, { headers: enTetesService() })
		).json()) as Evenement[]

		const reponse = await request.post(`${URL_API}${RPC}/wake_card`, {
			headers: enTetesAuthentifies(jetonAdmin),
			data: { card_id: CARD_FERMEE },
		})
		expect(reponse.status(), 'un état déjà atteint n’est pas une erreur (§16.4)').toBe(200)

		const apres = (await (
			await request.get(`${URL_API}${filDe(CARD_FERMEE)}`, { headers: enTetesService() })
		).json()) as Evenement[]
		expect(apres.length, 'deux onglets ne produisent pas deux traces').toBe(avant.length)
	})

	test('9 — une card à la corbeille est ABSENTE, même pour l’administratrice', async ({
		request,
	}) => {
		const corbeille = await request.patch(`${URL_API}${CARDS}?id=eq.${CARD_LUE}`, {
			headers: enTetesAuthentifies(jetonAdmin),
			data: { deleted_at: new Date().toISOString() },
		})
		expect(corbeille.status()).toBe(204)

		const reponse = await request.post(`${URL_API}${RPC}/snooze_card`, {
			headers: enTetesAuthentifies(jetonAdmin),
			data: { card_id: CARD_LUE, until: ECHEANCE },
		})
		expect(reponse.status()).toBe(400)
		expect(
			(await reponse.json()).message,
			'on restaure une affaire avant de l’endormir (§5)',
		).toBe('card_not_found')
	})
})
