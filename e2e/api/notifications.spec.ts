// @verifies CRM-064 (docs/BACKLOG.md) — @mentions, notifications et préférences, TRANCHE 2
// @verifies docs/SPEC-notifications.md §17 (les seize lignes du contrat d'API), §14 (la
//           production, l'auto-mention écartée, la survivance au retrait de la mention), §15
//           (le seul geste ouvert, les deux refus doubles, la date imposée par la base), §16.1
//           (les deux politiques et leur seconde condition), §19 (ce que le seed livre)
// @verifies docs/SPEC-permissions-rls.md §7 (le refus est ZÉRO LIGNE, jamais une erreur)
// @verifies CLAUDE.md §10 (toute règle d'accès se prouve hors interface, avec le jeton réel)
//
// LA QUESTION À LAQUELLE CE FICHIER RÉPOND. `supabase/tests/0062_notifications.test.sql` prouve
// la règle **en base**, sous le propriétaire. Rien n'y garantit que la pile la rende par la vraie
// route, et la tranche 1 a payé cette leçon : le privilège d'exécution de `app.can_read_card_pour`
// manquait à `authenticated`, quatre lignes du contrat rendaient `403 / 42501` là où trois
// attendaient un refus MÉTIER et une un succès, **et la suite pgTAP restait verte** — elle
// s'exécute sous le propriétaire, qui n'a besoin d'aucun privilège (décision 522).
//
// CE FICHIER ÉCRIT, ET IL REND LE PRODUIT DANS L'ÉTAT OÙ IL LE TROUVE. Chaque ligne posée est
// retirée, et une dernière lecture le CONSTATE — décision 501 : une preuve qui laisse ses sondes
// en base fait rougir la suivante.

import { expect, request as requetePlaywright, test } from '@playwright/test'
import { CLE_ANONYME, CLE_SERVICE, URL_API, enTetesAnonymes, enTetesAuthentifies, jetonDe } from './jetons'

const NOTIFICATIONS = '/rest/v1/notifications'
const MENTIONS = '/rest/v1/card_comment_mentions'

/** Les trois profils du seed — `docs/SPEC-seed.md` §2.3. */
const CAMILLE = '5eed0000-0000-4000-8000-000000000011'
const DRISS = '5eed0000-0000-4000-8000-000000000012'
const FARIDA = '5eed0000-0000-4000-8000-000000000013'

/**
 * Les commentaires du seed, et ce que chacun apporte au contrat.
 *
 * `…0d1` porte la mention de Driss, `…0d2` celle de Camille : ce sont les deux notifications que
 * le seed PROVOQUE (`docs/SPEC-notifications.md` §19). `…0d3` est le seul des cinq que le seed ne
 * mentionne pas — c'est donc le support des sondes de ce fichier, qui n'y perturbent rien.
 */
const D1_DE_CAMILLE = '5eed0000-0000-4000-8000-0000000000d1'
const D3_LIBRE = '5eed0000-0000-4000-8000-0000000000d3'

/** Toutes deux vivent sur `…0c1`, dans `grands-comptes` — channel FERMÉ à Farida. */
const CARD_FERMEE = '5eed0000-0000-4000-8000-0000000000c1'

/** Une date vieille de dix ans : le §15.1 exige qu'elle ne survive pas. */
const ANTIDATEE = '2016-01-01T00:00:00.000Z'

const enTetesService = () => ({ apikey: CLE_SERVICE, Authorization: `Bearer ${CLE_SERVICE}` })

/**
 * Rend LA ligne attendue, en échouant explicitement si elle manque.
 *
 * `noUncheckedIndexedAccess` est actif dans ce dépôt, et c'est une bonne chose : une preuve qui
 * accède à `[0]` sans rien dire suppose silencieusement que la ligne existe, et rend un message
 * illisible le jour où elle manque. Cette fonction transforme cette supposition en assertion.
 */
function laLigne(
	lignes: Array<Record<string, unknown>>,
	quoi: string,
): Record<string, unknown> {
	expect(lignes.length, `${quoi} : une ligne et une seule était attendue`).toBe(1)
	const premiere = lignes[0]
	if (premiere === undefined) throw new Error(`${quoi} : aucune ligne`)
	return premiere
}

/**
 * Relit les notifications **avec la clé de service**, donc hors de toute politique.
 *
 * C'est ce qui distingue un refus d'un échec silencieux : un refus qui laisse une trace n'est pas
 * un refus (`docs/SPEC-notifications.md` §17).
 */
async function enBase(
	requete: import('@playwright/test').APIRequestContext,
	filtre: string,
): Promise<Array<Record<string, unknown>>> {
	const reponse = await requete.get(`${URL_API}${NOTIFICATIONS}?${filtre}`, {
		headers: enTetesService(),
	})
	expect(reponse.status()).toBe(200)
	return (await reponse.json()) as Array<Record<string, unknown>>
}

test.describe('CRM-064 tranche 2 — le contrat d’API de la notification', () => {
	let camille: string
	let driss: string
	let farida: string

	/** La notification que le seed a provoquée pour Driss — son identifiant est relu, jamais figé. */
	let n1: string

	test.beforeAll(async ({ request }) => {
		camille = await jetonDe('admin@p2enjoy.test')
		driss = await jetonDe('bizdev@p2enjoy.test')
		farida = await jetonDe('viewer@p2enjoy.test')

		const notification = laLigne(
			await enBase(request, `select=id&payload->>comment_id=eq.${D1_DE_CAMILLE}`),
			'le seed doit avoir PROVOQUÉ la notification de la mention posée sur `…0d1` ' +
				'(docs/SPEC-notifications.md §19) : sans elle, ce fichier ne mesure rien',
		)
		n1 = notification.id as string
	})

	// -------------------------------------------------------------------------------------------
	// Lignes a à d — la boîte de chacun est à lui, et le refus est ZÉRO LIGNE
	// -------------------------------------------------------------------------------------------

	test('a et b — chacun ne lit QUE ses propres notifications', async ({ request }) => {
		const pourDriss = await request.get(`${URL_API}${NOTIFICATIONS}?select=recipient_id,type`, {
			headers: enTetesAuthentifies(driss),
		})
		expect(pourDriss.status()).toBe(200)
		const vuesParDriss = (await pourDriss.json()) as Array<{ recipient_id: string }>
		expect(vuesParDriss.length).toBeGreaterThan(0)
		expect(
			vuesParDriss.every((n) => n.recipient_id === DRISS),
			'la boîte de quelqu’un n’est pas une donnée d’exploitation : Driss ne voit que la ' +
				'sienne (docs/SPEC-notifications.md §16.1)',
		).toBe(true)

		const pourCamille = await request.get(`${URL_API}${NOTIFICATIONS}?select=recipient_id`, {
			headers: enTetesAuthentifies(camille),
		})
		expect(pourCamille.status()).toBe(200)
		const vuesParCamille = (await pourCamille.json()) as Array<{ recipient_id: string }>
		expect(vuesParCamille.length).toBeGreaterThan(0)
		expect(
			vuesParCamille.every((n) => n.recipient_id === CAMILLE),
			'l’administratrice non plus ne lit pas la boîte des autres : le rôle `admin` n’ouvre ' +
				'rien ici',
		).toBe(true)
	})

	test('c — la lectrice n’en a aucune, et c’est ZÉRO LIGNE, jamais une erreur', async ({
		request,
	}) => {
		const reponse = await request.get(`${URL_API}${NOTIFICATIONS}?select=id`, {
			headers: enTetesAuthentifies(farida),
		})
		expect(reponse.status()).toBe(200)
		expect(await reponse.json()).toEqual([])

		// La contre-épreuve : la table N'EST PAS vide. Sans elle, l'assertion serait verte que la
		// RLS refuse ou que la table soit inexistante (décision 50).
		const toutes = await enBase(request, 'select=id')
		expect(
			toutes.length,
			'la table porte des lignes : le refus se mesure donc comme une ligne ABSENTE d’une ' +
				'liste peuplée, non comme un écran vide',
		).toBeGreaterThan(0)
	})

	test('d — l’anonyme reçoit 200 [], et non une erreur de privilège', async ({ request }) => {
		const reponse = await request.get(`${URL_API}${NOTIFICATIONS}?select=id`, {
			headers: enTetesAnonymes(),
		})
		expect(
			reponse.status(),
			'`anon` reçoit `SELECT` pour que le refus soit zéro ligne et non un 42501 ' +
				'(docs/SPEC-permissions-rls.md §3.2)',
		).toBe(200)
		expect(await reponse.json()).toEqual([])
	})

	// -------------------------------------------------------------------------------------------
	// Lignes e et f — AUCUN client n'écrit de notification, et le second geste est le dangereux
	// -------------------------------------------------------------------------------------------

	test('e et f — l’insertion est refusée, y compris (surtout) vers un TIERS', async ({
		request,
	}) => {
		for (const [libelle, destinataire] of [
			['à soi-même', CAMILLE],
			['à quelqu’un d’autre', DRISS],
		] as const) {
			const reponse = await request.post(`${URL_API}${NOTIFICATIONS}`, {
				headers: enTetesAuthentifies(camille),
				data: {
					workspace_id: '5eed0000-0000-4000-8000-000000000001',
					recipient_id: destinataire,
					type: 'mention',
					subject_card_id: CARD_FERMEE,
				},
			})
			expect(reponse.status(), `insertion ${libelle}`).toBe(403)
			expect((await reponse.json()).code).toBe('42501')
		}

		// Le refus ne laisse AUCUNE trace : un refus qui en laisse une n'est pas un refus.
		const posees = await enBase(request, `select=id&subject_card_id=eq.${CARD_FERMEE}`)
		expect(
			posees.length,
			'une notification se PRODUIT, elle ne se demande pas : le seul chemin est le trigger ' +
				'(docs/SPEC-notifications.md §15.3). Les deux du seed subsistent, aucune n’est née ici',
		).toBe(2)
	})

	// -------------------------------------------------------------------------------------------
	// Lignes g, h et m — le seul geste ouvert, et sa date imposée par la base
	// -------------------------------------------------------------------------------------------

	test('g et h — marquer lu puis non lu, la date étant celle du GESTE', async ({ request }) => {
		const nonLuesAvant = await enBase(request, `select=id&recipient_id=eq.${DRISS}&read_at=is.null`)

		const marquage = await request.patch(`${URL_API}${NOTIFICATIONS}?id=eq.${n1}`, {
			headers: enTetesAuthentifies(driss),
			data: { read_at: ANTIDATEE },
		})
		expect(marquage.status()).toBe(204)

		const apres = laLigne(await enBase(request, `select=read_at&id=eq.${n1}`), 'la notification marquée')
		expect(apres.read_at).not.toBeNull()
		expect(
			new Date(apres.read_at as string).getTime(),
			'la date ANTIDATÉE de dix ans ne survit pas : la base pose celle du geste ' +
				'(docs/SPEC-notifications.md §15.1, mécanisme de la décision 95). Une date choisie ' +
				'par le client fausserait l’ordre de lecture et le compteur de non-lues',
		).toBeGreaterThan(Date.now() - 120_000)

		// Le compteur suit — ligne *m*.
		const compteur = await request.get(
			`${URL_API}${NOTIFICATIONS}?select=id&read_at=is.null`,
			{ headers: enTetesAuthentifies(driss) },
		)
		expect(compteur.status()).toBe(200)
		expect(
			((await compteur.json()) as unknown[]).length,
			'le compteur de non-lues suit le marquage : il est la lecture que sert l’index PARTIEL ' +
				'du §13.7',
		).toBe(nonLuesAvant.length - 1)

		// Ligne *h* — marquer NON LU, l'autre sens.
		const retour = await request.patch(`${URL_API}${NOTIFICATIONS}?id=eq.${n1}`, {
			headers: enTetesAuthentifies(driss),
			data: { read_at: null },
		})
		expect(retour.status()).toBe(204)

		const restaure = laLigne(await enBase(request, `select=read_at&id=eq.${n1}`), 'la notification remise non lue')
		expect(
			restaure.read_at,
			'`null` reste `null` : un état à deux valeurs qu’on ne peut parcourir que dans un sens ' +
				'est un compteur, pas un état (docs/SPEC-notifications.md §15.1)',
		).toBeNull()
	})

	// -------------------------------------------------------------------------------------------
	// Ligne i — un tiers ne reçoit pas d'erreur : le `USING` filtre, et rien n'est touché
	// -------------------------------------------------------------------------------------------

	test('i — marquer la notification d’un AUTRE rend 204 sans effet', async ({ request }) => {
		const reponse = await request.patch(`${URL_API}${NOTIFICATIONS}?id=eq.${n1}`, {
			headers: enTetesAuthentifies(camille),
			data: { read_at: new Date().toISOString() },
		})
		expect(
			reponse.status(),
			'PostgREST rend 204 quand aucune ligne ne correspond : c’est le refus DISCRET que le ' +
				'dépôt attend d’un `UPDATE`, et non un 403',
		).toBe(204)

		const apres = laLigne(await enBase(request, `select=read_at&id=eq.${n1}`), 'la notification de Driss')
		expect(
			apres.read_at,
			'AUCUNE ligne n’a été touchée, et c’est relu en base : un refus qui laisse une trace ' +
				'n’est pas un refus',
		).toBeNull()
	})

	// -------------------------------------------------------------------------------------------
	// Lignes j, k et l — tout le reste est fermé PAR LE PRIVILÈGE
	// -------------------------------------------------------------------------------------------

	test('j et k — les autres colonnes sont fermées par le privilège de colonne', async ({
		request,
	}) => {
		for (const [libelle, corps] of [
			['la charge utile', { payload: { x: 1 } }],
			['le destinataire', { recipient_id: CAMILLE }],
		] as const) {
			const reponse = await request.patch(`${URL_API}${NOTIFICATIONS}?id=eq.${n1}`, {
				headers: enTetesAuthentifies(driss),
				data: corps,
			})
			expect(reponse.status(), `mise à jour de ${libelle}`).toBe(403)
			expect((await reponse.json()).code).toBe('42501')
		}

		const intacte = laLigne(
			await enBase(request, `select=recipient_id,payload&id=eq.${n1}`),
			'la notification restée intacte',
		)
		expect(
			intacte.recipient_id,
			'`grant update (read_at)` SEUL fige toutes les autres colonnes ' +
				'(docs/SPEC-notifications.md §15.2)',
		).toBe(DRISS)
		expect((intacte.payload as Record<string, string>).comment_id).toBe(D1_DE_CAMILLE)
	})

	test('l — la suppression est refusée, et la ligne demeure', async ({ request }) => {
		const reponse = await request.delete(`${URL_API}${NOTIFICATIONS}?id=eq.${n1}`, {
			headers: enTetesAuthentifies(driss),
		})
		expect(reponse.status()).toBe(403)
		expect((await reponse.json()).code).toBe('42501')

		const restante = await enBase(request, `select=id&id=eq.${n1}`)
		expect(
			restante.length,
			'ce n’est pas une omission mais le PÉRIMÈTRE : vider une liste est une décision de ' +
				'rétention qu’aucune mesure ne donne (docs/SPEC-notifications.md §15.4, point ' +
				'ouvert n° 1)',
		).toBe(1)
	})

	// -------------------------------------------------------------------------------------------
	// Lignes n, o et p — LA PRODUCTION, qui est l'objet même de la tranche
	// -------------------------------------------------------------------------------------------

	test('n, o et p — poser une mention PRODUIT, l’auto-mention non, et le retrait n’efface pas', async ({
		request,
	}) => {
		// --- n : la production, par la vraie route et avec le jeton réel de l'auteur -------------
		const posee = await request.post(`${URL_API}${MENTIONS}`, {
			headers: enTetesAuthentifies(camille),
			data: { comment_id: D3_LIBRE, profile_id: DRISS },
		})
		expect(posee.status()).toBe(201)

		const produite = laLigne(
			await enBase(
				request,
				`select=recipient_id,type,subject_card_id,payload,read_at&payload->>comment_id=eq.${D3_LIBRE}`,
			),
			'poser une mention PRODUIT une notification — c’est l’objet de la tranche, et toutes ' +
				'les assertions de forme passeraient sans que ce soit vrai',
		)
		expect(produite.recipient_id).toBe(DRISS)
		expect(produite.type).toBe('mention')
		expect(produite.subject_card_id).toBe(CARD_FERMEE)
		expect(
			produite.payload,
			'la charge utile porte de quoi DÉSIGNER, jamais de quoi lire : ni le corps du ' +
				'commentaire, ni le titre de la card, ni le nom de l’auteur ' +
				'(docs/SPEC-notifications.md §13.4)',
		).toEqual({ comment_id: D3_LIBRE, author_id: CAMILLE })
		expect(produite.read_at, 'une notification naît NON LUE').toBeNull()

		// Et le destinataire la voit RÉELLEMENT, par la vraie route : la produire sans la rendre
		// lisible ne servirait à rien, et seule cette lecture-ci le prouve.
		const vueParDriss = await request.get(
			`${URL_API}${NOTIFICATIONS}?select=id&payload->>comment_id=eq.${D3_LIBRE}`,
			{ headers: enTetesAuthentifies(driss) },
		)
		expect(vueParDriss.status()).toBe(200)
		expect(((await vueParDriss.json()) as unknown[]).length).toBe(1)

		// --- o : l'AUTO-MENTION est acceptée, et ne produit RIEN --------------------------------
		const auto = await request.post(`${URL_API}${MENTIONS}`, {
			headers: enTetesAuthentifies(camille),
			data: { comment_id: D3_LIBRE, profile_id: CAMILLE },
		})
		expect(
			auto.status(),
			'l’auto-mention est ACCEPTÉE par la tranche 1 — la règle d’éligibilité demande que le ' +
				'destinataire puisse LIRE l’affaire, et l’auteur le peut toujours (§12, M5)',
		).toBe(201)

		const apresAuto = laLigne(
			await enBase(request, `select=recipient_id&payload->>comment_id=eq.${D3_LIBRE}`),
			'deux mentions posées, UNE seule notification : se prévenir soi-même de ce qu’on vient ' +
				'd’écrire n’est pas une information (docs/SPEC-notifications.md §14.3)',
		)
		expect(apresAuto.recipient_id).toBe(DRISS)

		// --- p : retirer la mention n'efface PAS la notification --------------------------------
		const retrait = await request.delete(
			`${URL_API}${MENTIONS}?comment_id=eq.${D3_LIBRE}&profile_id=eq.${DRISS}`,
			{ headers: enTetesAuthentifies(camille) },
		)
		expect(retrait.status()).toBe(204)

		const apresRetrait = await enBase(request, `select=id&payload->>comment_id=eq.${D3_LIBRE}`)
		expect(
			apresRetrait.length,
			'la notification DEMEURE : le retrait d’une mention est « la correction d’une erreur de ' +
				'frappe » (§7.1), une notification est un message DÉJÀ DÉLIVRÉ, et l’effacer ' +
				'réécrirait le passé du destinataire (docs/SPEC-notifications.md §14.4)',
		).toBe(1)
	})

	// -------------------------------------------------------------------------------------------
	// LE PRODUIT EST RENDU DANS L'ÉTAT OÙ IL A ÉTÉ TROUVÉ — décision 501
	// -------------------------------------------------------------------------------------------

	test.afterAll(async () => {
		// La fixture `request` est de portée TEST : elle n'existe plus ici. Le contexte est donc
		// créé à la main, exactement comme `jetons.ts` le fait pour la route de connexion.
		const contexte = await requetePlaywright.newContext({ baseURL: URL_API })
		try {
			await contexte.delete(`${URL_API}${MENTIONS}?comment_id=eq.${D3_LIBRE}`, {
				headers: enTetesService(),
			})
			await contexte.delete(`${URL_API}${NOTIFICATIONS}?payload->>comment_id=eq.${D3_LIBRE}`, {
				headers: enTetesService(),
			})
			await contexte.patch(`${URL_API}${NOTIFICATIONS}?recipient_id=eq.${DRISS}`, {
				headers: { ...enTetesService(), 'Content-Type': 'application/json' },
				data: { read_at: null },
			})

			// LA REMISE EN ÉTAT EST CONSTATÉE, non supposée : c'est la leçon de la décision 501,
			// une preuve qui laisse ses sondes en base faisant rougir la suivante.
			const restantes = await contexte.get(
				`${URL_API}${NOTIFICATIONS}?select=id,read_at`,
				{ headers: enTetesService() },
			)
			const lignes = (await restantes.json()) as Array<{ read_at: string | null }>
			expect(lignes.length, 'les deux notifications du seed, et elles seules').toBe(2)
			expect(
				lignes.every((n) => n.read_at === null),
				'toutes deux rendues NON LUES, comme le seed les laisse (§19)',
			).toBe(true)
		} finally {
			await contexte.dispose()
		}
	})
})
