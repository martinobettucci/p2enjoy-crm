// @verifies CRM-040 (docs/BACKLOG.md) — écriture des six champs d'en-tête, hors interface
// @verifies docs/SPEC-cards.md §15 bis.8 (contrat d'API mesuré, lignes a à o),
//           §15 bis.1 (les deux colonnes fermées), §15 bis.5 (les trois refus que le produit
//           n'invente pas), §15 bis.6 (la liste des membres et l'événement `assigned`),
//           §15 bis.7 (les issues, et « 200 avec zéro ligne »)
// @verifies docs/SPEC-permissions-rls.md §7 (un refus se mesure, jamais ne se suppose)
// @verifies docs/SPEC-identite.md §3.3 (les appartenances sont lisibles par tout membre)
// @verifies docs/SPEC-test-harness.md §4.3 (projet `api`, hors interface)
// @verifies CLAUDE.md §10 (toute règle se prouve hors interface, avec le jeton réel)
//
// Ces scénarios rejouent une à une les quinze lignes du tableau de `docs/SPEC-cards.md` §15 bis.8,
// écrit **avant** le code, avec les jetons réels des trois profils seedés.
//
// TROIS PIÈGES, tous hérités des unités précédentes et tous encore actifs ici :
//
//   * une écriture refusée par la clause `USING` d'une politique ne produit AUCUNE erreur :
//     PostgREST rend `200` et ne modifie rien. Tout refus relit donc la ligne et la constate
//     **inchangée** — sans cette relecture, une preuve verte ne dirait rien ;
//   * `Prefer: return=representation` est OBLIGATOIRE pour distinguer les deux issues à `200` :
//     sans lui, PostgREST rend `204` et aucun corps, et « écrit » ressemblerait à « filtré » ;
//   * chaque scénario RESTAURE la valeur seedée derrière lui, y compris en cas d'échec, et par
//     identifiant — jamais par prédicat métier, qui amputerait le seed.

import { expect, test, type APIRequestContext } from '@playwright/test'
import { enTetesAuthentifies, enTetesService, jetonDe } from './jetons'

const WORKSPACE_SEED = '5eed0000-0000-4000-8000-000000000001'
/** `…0c6`, « Piste entrante à qualifier » : la seule affaire du seed sans responsable ni montant. */
const CARD_NUE = '5eed0000-0000-4000-8000-0000000000c6'
/** `…0c8`, « Contrat cadre 2025 » : la seule affaire ARCHIVÉE du seed. */
const CARD_ARCHIVEE = '5eed0000-0000-4000-8000-0000000000c8'
/** Driss Lemoine, business developer du workspace. */
const PROFIL_DRISS = '5eed0000-0000-4000-8000-000000000012'
/** Une étape réelle du workflow global : la cible d'un `PATCH` que le privilège doit refuser. */
const ETAPE_RELANCE = '5eed0000-0000-4000-8000-000000000062'

/** L'état seedé de `…0c6`, restauré après chaque scénario qui écrit (`docs/SPEC-seed.md` §9.3). */
const ETAT_SEEDE = {
	title: 'Piste entrante à qualifier',
	owner_id: null,
	amount: null,
	currency: 'EUR',
	next_action: null,
	next_action_at: null,
} as const

let jetonAdmin = ''
let jetonBizdev = ''
let jetonViewer = ''

test.beforeAll(async () => {
	jetonAdmin = await jetonDe('admin@p2enjoy.test')
	jetonBizdev = await jetonDe('bizdev@p2enjoy.test')
	jetonViewer = await jetonDe('viewer@p2enjoy.test')
})

/** Un `PATCH` tel que le produit l'émet : une colonne, et la représentation demandée. */
async function ecrire(
	requete: APIRequestContext,
	jeton: string,
	idCard: string,
	charge: Record<string, unknown>,
) {
	return requete.patch(`/rest/v1/cards?id=eq.${idCard}`, {
		headers: { ...enTetesAuthentifies(jeton), Prefer: 'return=representation' },
		data: charge,
	})
}

/** Relit une affaire AVEC LA CLÉ DE SERVICE : constater « inchangée » exige de voir la vraie ligne. */
async function relire(requete: APIRequestContext, idCard: string) {
	const reponse = await requete.get(
		`/rest/v1/cards?id=eq.${idCard}&select=title,owner_id,amount,currency,next_action,next_action_at`,
		{ headers: enTetesService() },
	)
	expect(reponse.status()).toBe(200)
	return (await reponse.json())[0]
}

/** Restaure l'état seedé de `…0c6`, par identifiant et avec la clé de service. */
async function restaurer(requete: APIRequestContext) {
	const reponse = await requete.patch(`/rest/v1/cards?id=eq.${CARD_NUE}`, {
		headers: { ...enTetesService(), Prefer: 'return=representation' },
		data: ETAT_SEEDE,
	})
	expect(reponse.status()).toBe(200)
}

test.afterEach(async ({ request }) => {
	await restaurer(request)
})

test.describe("le contrat d'écriture des champs d'en-tête", () => {
	test('a — un administrateur écrit le titre, et la ligne est modifiée', async ({ request }) => {
		const reponse = await ecrire(request, jetonAdmin, CARD_NUE, { title: 'Piste requalifiée' })
		expect(reponse.status()).toBe(200)
		expect((await reponse.json())[0].title).toBe('Piste requalifiée')
		expect((await relire(request, CARD_NUE)).title).toBe('Piste requalifiée')
	})

	// LA LIGNE QUI COMMANDE TOUT LE GESTE. Un refus de politique n'est PAS un `403` : la clause
	// `USING` filtre avant la mise à jour, et PostgREST rend `200` avec un tableau VIDE. Un écran
	// qui lirait le seul code HTTP annoncerait « Enregistré » à qui n'a rien écrit.
	test("b — un lecteur seul reçoit 200 et ZÉRO ligne, et la ligne reste inchangée", async ({
		request,
	}) => {
		const reponse = await ecrire(request, jetonViewer, CARD_NUE, { title: 'tentative du viewer' })
		expect(reponse.status()).toBe(200)
		expect(await reponse.json()).toEqual([])
		expect((await relire(request, CARD_NUE)).title).toBe(ETAT_SEEDE.title)
	})

	test("c — un business developer écrit : la politique porte sur le channel, pas sur un rôle", async ({
		request,
	}) => {
		const reponse = await ecrire(request, jetonBizdev, CARD_NUE, { next_action: 'Rappeler lundi' })
		expect(reponse.status()).toBe(200)
		expect((await reponse.json())).toHaveLength(1)
		expect((await relire(request, CARD_NUE)).next_action).toBe('Rappeler lundi')
	})

	test('d — un titre vide est refusé par la contrainte, en 400 / 23514', async ({ request }) => {
		const reponse = await ecrire(request, jetonAdmin, CARD_NUE, { title: '' })
		expect(reponse.status()).toBe(400)
		expect((await reponse.json()).code).toBe('23514')
		expect((await relire(request, CARD_NUE)).title).toBe(ETAT_SEEDE.title)
	})

	test("e — un titre de blancs est refusé COMME un titre vide : la base tranche, pas l'écran", async ({
		request,
	}) => {
		const reponse = await ecrire(request, jetonAdmin, CARD_NUE, { title: '   ' })
		expect(reponse.status()).toBe(400)
		expect((await reponse.json()).code).toBe('23514')
	})

	// L'ABSENCE DE CONTRAINTE EST FIGÉE PAR CETTE ASSERTION : refuser un négatif est une décision de
	// produit que personne n'a prise (§10), et cette preuve deviendra rouge le jour où elle sera.
	test('f — un montant NÉGATIF est accepté : aucune contrainte de signe', async ({ request }) => {
		const reponse = await ecrire(request, jetonAdmin, CARD_NUE, { amount: -500 })
		expect(reponse.status()).toBe(200)
		expect(Number((await relire(request, CARD_NUE)).amount)).toBe(-500)
	})

	test('g — vider la devise est refusé : la colonne est NOT NULL, 400 / 23502', async ({
		request,
	}) => {
		const reponse = await ecrire(request, jetonAdmin, CARD_NUE, { currency: null })
		expect(reponse.status()).toBe(400)
		expect((await reponse.json()).code).toBe('23502')
		expect((await relire(request, CARD_NUE)).currency).toBe('EUR')
	})

	test('h — une devise mal FORMÉE est refusée, en minuscules comme en quatre lettres', async ({
		request,
	}) => {
		for (const devise of ['eur', 'EURO']) {
			const reponse = await ecrire(request, jetonAdmin, CARD_NUE, { currency: devise })
			expect(reponse.status()).toBe(400)
			expect((await reponse.json()).code).toBe('23514')
		}
		expect((await relire(request, CARD_NUE)).currency).toBe('EUR')
	})

	test("i — une échéance illisible est refusée en 400 / 22007", async ({ request }) => {
		const reponse = await ecrire(request, jetonAdmin, CARD_NUE, { next_action_at: 'pas-une-date' })
		expect(reponse.status()).toBe(400)
		expect((await reponse.json()).code).toBe('22007')
	})

	test("j — un responsable inconnu est refusé par la clé étrangère, en 409 / 23503", async ({
		request,
	}) => {
		const reponse = await ecrire(request, jetonAdmin, CARD_NUE, {
			owner_id: '5eed0000-0000-4000-8000-999999999999',
		})
		expect(reponse.status()).toBe(409)
		expect((await reponse.json()).code).toBe('23503')
		expect((await relire(request, CARD_NUE)).owner_id).toBeNull()
	})

	// LES DEUX COLONNES FERMÉES : ces assertions figent le privilège de `CRM-034` et de `CRM-013`.
	// Leur passage au vert d'un `200` signalerait une migration qui les rouvre en silence.
	test("k — `current_step_id` est fermée par privilège : 403 / 42501", async ({ request }) => {
		const reponse = await ecrire(request, jetonAdmin, CARD_NUE, { current_step_id: ETAPE_RELANCE })
		expect(reponse.status()).toBe(403)
		expect((await reponse.json()).code).toBe('42501')
	})

	test("l — `email_local_part` est fermée par privilège : 403 / 42501", async ({ request }) => {
		const reponse = await ecrire(request, jetonAdmin, CARD_NUE, { email_local_part: 'tentative' })
		expect(reponse.status()).toBe(403)
		expect((await reponse.json()).code).toBe('42501')
	})

	test('m — les quatre colonnes nullables se vident, et la ligne demeure', async ({ request }) => {
		await ecrire(request, jetonAdmin, CARD_NUE, { amount: 1000 })
		await ecrire(request, jetonAdmin, CARD_NUE, { next_action: 'à vider' })
		const reponse = await ecrire(request, jetonAdmin, CARD_NUE, { amount: null })
		expect(reponse.status()).toBe(200)
		const apres = await relire(request, CARD_NUE)
		expect(apres.amount).toBeNull()
		// La ligne DEMEURE : vider n'est pas supprimer.
		expect(apres.title).toBe(ETAT_SEEDE.title)
	})

	// LA SEULE DES SIX ÉCRITURES QUI LAISSE UNE TRACE, et c'est mesuré et non supposé.
	test("n — changer le responsable engendre un événement `assigned`, et lui seul", async ({
		request,
	}) => {
		const avant = await request.get(
			`/rest/v1/card_events?card_id=eq.${CARD_NUE}&select=id&order=created_at.desc`,
			{ headers: enTetesService() },
		)
		const nombreAvant = (await avant.json()).length

		const reponse = await ecrire(request, jetonAdmin, CARD_NUE, { owner_id: PROFIL_DRISS })
		expect(reponse.status()).toBe(200)

		const apres = await request.get(
			`/rest/v1/card_events?card_id=eq.${CARD_NUE}&select=type,payload,actor_id&order=created_at.desc&limit=1`,
			{ headers: enTetesService() },
		)
		const dernier = (await apres.json())[0]
		expect(dernier.type).toBe('assigned')
		expect(dernier.payload.to_owner_id).toBe(PROFIL_DRISS)
		expect(dernier.payload.from_owner_id).toBeNull()
		// L'`actor_id` est posé par le SERVEUR à partir de la session : le client ne le fournit jamais.
		expect(dernier.actor_id).not.toBeNull()

		// ... et un titre modifié n'en engendre AUCUN : l'écart est nommé au §15 bis.10, non comblé.
		const compteApresAssignation = (
			await (
				await request.get(`/rest/v1/card_events?card_id=eq.${CARD_NUE}&select=id`, {
					headers: enTetesService(),
				})
			).json()
		).length
		expect(compteApresAssignation).toBe(nombreAvant + 1)
		await ecrire(request, jetonAdmin, CARD_NUE, { title: 'Titre sans trace' })
		const compteFinal = (
			await (
				await request.get(`/rest/v1/card_events?card_id=eq.${CARD_NUE}&select=id`, {
					headers: enTetesService(),
				})
			).json()
		).length
		expect(compteFinal).toBe(compteApresAssignation)
	})

	test("o — une affaire ARCHIVÉE reste modifiable : l'archivage ne ferme pas l'écriture", async ({
		request,
	}) => {
		const reponse = await ecrire(request, jetonAdmin, CARD_ARCHIVEE, {
			next_action: 'mesure sur affaire archivée',
		})
		expect(reponse.status()).toBe(200)
		expect((await reponse.json())).toHaveLength(1)
		// Restauration par identifiant, l'`afterEach` ne portant que sur `…0c6`.
		const remise = await request.patch(`/rest/v1/cards?id=eq.${CARD_ARCHIVEE}`, {
			headers: enTetesService(),
			data: { next_action: null },
		})
		expect(remise.status()).toBe(204)
	})
})

test.describe('la liste des membres affectables', () => {
	test("est lisible par un membre, avec le profil embarqué et sans ambiguïté de relation", async ({
		request,
	}) => {
		const reponse = await request.get(
			`/rest/v1/workspace_members?select=user_id,profiles(id,full_name)&workspace_id=eq.${WORKSPACE_SEED}`,
			{ headers: enTetesAuthentifies(jetonAdmin) },
		)
		expect(reponse.status()).toBe(200)
		const membres = await reponse.json()
		expect(membres.length).toBeGreaterThanOrEqual(3)
		expect(membres.every((membre: { profiles: unknown }) => membre.profiles !== null)).toBe(true)
	})

	// Le nom d'un collègue est une donnée d'ÉQUIPE, pas une donnée du dossier
	// (`docs/SPEC-identite.md` §3.3) : le lecteur seul obtient la même liste.
	test('est lisible par un LECTEUR SEUL, à l’identique', async ({ request }) => {
		const reponse = await request.get(
			`/rest/v1/workspace_members?select=user_id,profiles(id,full_name)&workspace_id=eq.${WORKSPACE_SEED}`,
			{ headers: enTetesAuthentifies(jetonViewer) },
		)
		expect(reponse.status()).toBe(200)
		expect((await reponse.json()).length).toBeGreaterThanOrEqual(3)
	})
})
