// @verifies CRM-081 (docs/BACKLOG.md) — snooze des fils et des cards, TRANCHE 2 c, hors interface
// @verifies docs/SPEC-cards.md §16.14.2 (la clé d'un fil), §16.14.3 (l'état est une ligne, son
//           absence est « éveillé »), §16.14.4 (`snooze_thread` et ses TROIS refus), §16.14.5
//           (`wake_thread` et son idempotence), §16.14.6 (qui lit la ligne, et la fermeture par
//           le privilège), §16.14.8 (contrat d'API, les NEUF lignes rejouées ici), §16.14.9
// @verifies docs/SPEC-permissions-rls.md §4.3 (règle de discrétion)
// @verifies CLAUDE.md §10 (toute règle d'accès se prouve hors interface, avec le jeton réel)
//
// LA QUESTION À LAQUELLE CE FICHIER RÉPOND. La suite pgTAP `0046_snooze_fils.test.sql` prouve les
// mêmes règles DANS la base, avec `set local role` : elle ne traverse ni Kong, ni PostgREST, ni
// GoTrue. Or le §16.14.8 est un contrat d'API — codes HTTP compris —, et une fermeture de table
// rendue `403` par PostgREST ne se voit pas depuis `psql`.
//
// IL ÉCRIT SUR LES FILS DU SEED, ET C'EST VOULU. À la différence de `snooze.spec.ts`, aucun
// événement append-only n'est engendré : le sommeil d'un fil est une LIGNE, que le réveil
// supprime (§16.14.3). Le fichier réveille donc tout ce qu'il endort, et le seed sort INTACT —
// vérifié par une dernière lecture plutôt que supposé.

import { expect, test } from '@playwright/test'
import { URL_API, enTetesAuthentifies, enTetesService, jetonDe } from './jetons'

const SOMMEILS = '/rest/v1/mail_thread_snoozes'
const RPC = '/rest/v1/rpc'

/** Identifiants du seed, stables par contrat (docs/SPEC-seed.md). */
const WORKSPACE = '5eed0000-0000-4000-8000-000000000001'
const ADMIN = '5eed0000-0000-4000-8000-000000000011'
const BIZDEV = '5eed0000-0000-4000-8000-000000000012'

/**
 * Les deux fils du seed, et l'asymétrie qui décide des refus — MESURÉE le 2026-08-19 : la
 * politique `mail_messages_lecture` rend DEUX messages à l'administratrice, UN au business
 * developer — le seul classé — et AUCUN à la lectrice.
 */
const FIL_CLASSE = '<seed-inbox-classe@p2enjoy.test>'
const FIL_NON_CLASSE = '<seed-inbox-non-classe@p2enjoy.test>'
const FIL_INCONNU = '<inconnu@p2enjoy.test>'

const ECHEANCE = '2099-01-01T00:00:00+00:00'
const ECHEANCE_REPORTEE = '2099-06-01T00:00:00+00:00'
const ECHEANCE_PASSEE = '2020-01-01T00:00:00+00:00'

const ligneDe = (cle: string) =>
	`${SOMMEILS}?workspace_id=eq.${WORKSPACE}&thread_key=eq.${encodeURIComponent(cle)}` +
	'&select=thread_key,snoozed_until,snoozed_by'

test.describe('CRM-081 tranche 2 c — le sommeil d’un fil de messagerie, hors interface', () => {
	let jetonAdmin = ''
	let jetonBizdev = ''
	let jetonViewer = ''

	test.beforeAll(async () => {
		jetonAdmin = await jetonDe('admin@p2enjoy.test')
		jetonBizdev = await jetonDe('bizdev@p2enjoy.test')
		jetonViewer = await jetonDe('viewer@p2enjoy.test')
	})

	/**
	 * Le seed sort INTACT. Le réveil supprime la ligne (§16.14.3), donc un nettoyage par la clé de
	 * service suffit — et il est inconditionnel, pour qu'un scénario interrompu ne laisse pas
	 * derrière lui un fil endormi que la suite lirait comme un état du seed.
	 */
	test.afterAll(async ({ request }) => {
		await request.delete(`${URL_API}${SOMMEILS}?workspace_id=eq.${WORKSPACE}`, {
			headers: enTetesService(),
		})
	})

	test('1 et 2 — l’administratrice endort le fil classé, puis REPORTE son échéance', async ({
		request,
	}) => {
		const endormir = await request.post(`${URL_API}${RPC}/snooze_thread`, {
			headers: enTetesAuthentifies(jetonAdmin),
			data: { workspace: WORKSPACE, thread_key: FIL_CLASSE, until: ECHEANCE },
		})
		expect(endormir.status()).toBe(200)
		const posee = await endormir.json()
		expect(posee.thread_key).toBe(FIL_CLASSE)
		expect(posee.snoozed_by).toBe(ADMIN)

		// Le REPORT remplace l'échéance sans empiler une seconde ligne (§16.14.4).
		const reporter = await request.post(`${URL_API}${RPC}/snooze_thread`, {
			headers: enTetesAuthentifies(jetonAdmin),
			data: { workspace: WORKSPACE, thread_key: FIL_CLASSE, until: ECHEANCE_REPORTEE },
		})
		expect(reporter.status()).toBe(200)

		const relecture = await request.get(`${URL_API}${ligneDe(FIL_CLASSE)}`, {
			headers: enTetesAuthentifies(jetonAdmin),
		})
		expect(relecture.status()).toBe(200)
		const lignes = await relecture.json()
		expect(lignes).toHaveLength(1)
		expect(new Date(lignes[0].snoozed_until).toISOString()).toBe(
			new Date(ECHEANCE_REPORTEE).toISOString(),
		)
	})

	test('3 — le business developer ne lit PAS le fil non classé : introuvable, jamais « interdit »', async ({
		request,
	}) => {
		const refus = await request.post(`${URL_API}${RPC}/snooze_thread`, {
			headers: enTetesAuthentifies(jetonBizdev),
			data: { workspace: WORKSPACE, thread_key: FIL_NON_CLASSE, until: ECHEANCE },
		})
		expect(refus.status()).toBe(400)
		expect((await refus.json()).message).toBe('thread_not_found')

		// Le refus RELIT la ligne pour la constater absente (décision 70).
		const relecture = await request.get(`${URL_API}${ligneDe(FIL_NON_CLASSE)}`, {
			headers: enTetesService(),
		})
		expect(await relecture.json()).toHaveLength(0)
	})

	test('3 bis — le MÊME profil réussit sur le fil qu’il LIT : la discrétion tient au fil, pas au rôle', async ({
		request,
	}) => {
		const succes = await request.post(`${URL_API}${RPC}/snooze_thread`, {
			headers: enTetesAuthentifies(jetonBizdev),
			data: { workspace: WORKSPACE, thread_key: FIL_CLASSE, until: ECHEANCE },
		})
		expect(succes.status()).toBe(200)
		// Aucun droit d'ÉCRITURE n'est exigé : la mesure 3 du §16.14.1 établit qu'il n'en existe
		// aucun sur un fil, et en inventer un trancherait une question de produit non posée.
		expect((await succes.json()).snoozed_by).toBe(BIZDEV)
	})

	test('4 — la lectrice ne lit AUCUN message : les deux fils lui sont indistinctement introuvables', async ({
		request,
	}) => {
		for (const cle of [FIL_CLASSE, FIL_NON_CLASSE]) {
			const refus = await request.post(`${URL_API}${RPC}/snooze_thread`, {
				headers: enTetesAuthentifies(jetonViewer),
				data: { workspace: WORKSPACE, thread_key: cle, until: ECHEANCE },
			})
			expect(refus.status()).toBe(400)
			expect((await refus.json()).message).toBe('thread_not_found')
		}
	})

	test('5 et 6 — l’échéance manquante et l’échéance passée, sur un fil que l’appelante LIT', async ({
		request,
	}) => {
		const sansEcheance = await request.post(`${URL_API}${RPC}/snooze_thread`, {
			headers: enTetesAuthentifies(jetonAdmin),
			data: { workspace: WORKSPACE, thread_key: FIL_CLASSE, until: null },
		})
		expect(sansEcheance.status()).toBe(400)
		expect((await sansEcheance.json()).message).toBe('snooze_date_required')

		const passee = await request.post(`${URL_API}${RPC}/snooze_thread`, {
			headers: enTetesAuthentifies(jetonAdmin),
			data: { workspace: WORKSPACE, thread_key: FIL_CLASSE, until: ECHEANCE_PASSEE },
		})
		expect(passee.status()).toBe(400)
		expect((await passee.json()).message).toBe('snooze_date_in_past')
	})

	test('7 — un fil INEXISTANT est introuvable, et son absence est relue', async ({ request }) => {
		const refus = await request.post(`${URL_API}${RPC}/snooze_thread`, {
			headers: enTetesAuthentifies(jetonAdmin),
			data: { workspace: WORKSPACE, thread_key: FIL_INCONNU, until: ECHEANCE },
		})
		expect(refus.status()).toBe(400)
		expect((await refus.json()).message).toBe('thread_not_found')

		const relecture = await request.get(`${URL_API}${ligneDe(FIL_INCONNU)}`, {
			headers: enTetesService(),
		})
		expect(await relecture.json()).toHaveLength(0)
	})

	test('8 et 9 — le réveil supprime la ligne, puis se répète sans refus', async ({ request }) => {
		await request.post(`${URL_API}${RPC}/snooze_thread`, {
			headers: enTetesAuthentifies(jetonAdmin),
			data: { workspace: WORKSPACE, thread_key: FIL_CLASSE, until: ECHEANCE },
		})

		const premier = await request.post(`${URL_API}${RPC}/wake_thread`, {
			headers: enTetesAuthentifies(jetonAdmin),
			data: { workspace: WORKSPACE, thread_key: FIL_CLASSE },
		})
		expect(premier.status()).toBe(200)
		expect(await premier.json()).toBe(true)

		const relecture = await request.get(`${URL_API}${ligneDe(FIL_CLASSE)}`, {
			headers: enTetesService(),
		})
		expect(await relecture.json()).toHaveLength(0)

		// IDEMPOTENTE : un réveil sans sommeil rend `false`, et ne refuse pas (§16.14.5).
		const second = await request.post(`${URL_API}${RPC}/wake_thread`, {
			headers: enTetesAuthentifies(jetonAdmin),
			data: { workspace: WORKSPACE, thread_key: FIL_CLASSE },
		})
		expect(second.status()).toBe(200)
		expect(await second.json()).toBe(false)
	})

	test('9 bis — `wake_thread` garde le MÊME prédicat que `snooze_thread`', async ({ request }) => {
		const refus = await request.post(`${URL_API}${RPC}/wake_thread`, {
			headers: enTetesAuthentifies(jetonViewer),
			data: { workspace: WORKSPACE, thread_key: FIL_CLASSE },
		})
		expect(refus.status()).toBe(400)
		expect((await refus.json()).message).toBe('thread_not_found')
	})

	test('LA TABLE EST FERMÉE EN ÉCRITURE, et ce n’est pas la politique qui la ferme', async ({
		request,
	}) => {
		// MESURÉ : les `alter default privileges` de la plateforme ouvraient cette table neuve en
		// écriture À UN APPELANT ANONYME. Le `revoke all` de la migration 48 est ce qui la ferme,
		// et cette assertion est ce qui empêche un futur `grant` de rouvrir la porte en silence.
		const insertion = await request.post(`${URL_API}${SOMMEILS}`, {
			headers: enTetesAuthentifies(jetonAdmin),
			data: { workspace_id: WORKSPACE, thread_key: FIL_CLASSE, snoozed_until: ECHEANCE },
		})
		expect([401, 403]).toContain(insertion.status())

		const suppression = await request.delete(
			`${URL_API}${SOMMEILS}?workspace_id=eq.${WORKSPACE}`,
			{ headers: enTetesAuthentifies(jetonAdmin) },
		)
		expect([401, 403]).toContain(suppression.status())
	})

	test('LE SEED SORT INTACT : aucun fil ne reste endormi', async ({ request }) => {
		await request.post(`${URL_API}${RPC}/wake_thread`, {
			headers: enTetesAuthentifies(jetonAdmin),
			data: { workspace: WORKSPACE, thread_key: FIL_CLASSE },
		})

		const restantes = await request.get(
			`${URL_API}${SOMMEILS}?workspace_id=eq.${WORKSPACE}&select=thread_key`,
			{ headers: enTetesService() },
		)
		expect(await restantes.json()).toHaveLength(0)
	})
})
