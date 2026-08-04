// @verifies CRM-008 (docs/BACKLOG.md) — projet Playwright `api`, contrats et refus hors interface
// @verifies docs/SPEC-test-harness.md §4.3 (scénarios A1 à A6)
// @verifies docs/SPEC-permissions-rls.md §7 (preuve de refus n° 11)
// @verifies docs/SCHEMA.md §1 (tables du socle) ; docs/SPEC-seed.md §2 (contrat du seed)
//
// Ces scénarios exercent le backend **sans passer par l'interface**, avec les jetons réels des
// trois profils seedés, comme `CLAUDE.md` §10 l'exige de toute règle d'accès. Aucun navigateur
// n'est lancé : seul le contexte de requête de Playwright est employé.
//
// Ils décrivent l'état réellement mesuré du produit **avant `CRM-012`**, où aucune politique RLS
// n'existe : le refus par défaut de `CRM-003` rend `200` et `[]` à tout appelant. Voir la note
// portée par le scénario A5, qui échouera le jour où les politiques seront livrées — et c'est
// ce qu'on lui demande.

import { expect, test } from '@playwright/test'
import {
	CLE_SERVICE,
	COMPTES_SEED,
	TABLES_ALIMENTEES,
	enTetesAnonymes,
	enTetesAuthentifies,
	enTetesService,
	jetonDe,
} from './jetons'

test.describe('A1 — la passerelle filtre avant toute règle métier', () => {
	test('une requête sans clé apikey est refusée par Kong', async ({ request }) => {
		const reponse = await request.get('/rest/v1/workspaces?select=id')
		expect(reponse.status()).toBe(401)
		expect(await reponse.text()).toContain('No API key found in request')
	})
})

test.describe("A2 — le schéma `app` n'est pas exposé par l'API", () => {
	// Les fonctions d'autorisation de CRM-010 vivent dans `app`, que PostgREST n'expose pas.
	// Le contrôle porte sur la clé de **service** : si même elle ne les joint pas, aucun
	// appelant ne le peut.
	test('une fonction du schéma app est introuvable, même avec la clé de service', async ({
		request,
	}) => {
		const reponse = await request.post('/rest/v1/rpc/resolve_access', {
			headers: { ...enTetesService(), 'Content-Type': 'application/json' },
			data: {},
		})
		expect(reponse.status()).toBe(404)
		expect(await reponse.text()).toContain('PGRST202')
	})
})

test.describe('A3 — les tables du socle contiennent réellement des lignes', () => {
	// Condition de validité de A4 et A5, et non un contrôle décoratif : sur une table vide,
	// « l'API rend [] » serait vrai que la RLS refuse ou qu'elle autorise tout.
	for (const table of TABLES_ALIMENTEES) {
		test(`${table} est non vide, vu par la clé de service`, async ({ request }) => {
			const reponse = await request.get(`/rest/v1/${table}?select=*`, {
				headers: enTetesService(),
			})
			expect(reponse.status()).toBe(200)
			const lignes = (await reponse.json()) as unknown[]
			expect(lignes.length).toBeGreaterThan(0)
		})
	}
})

test.describe('A4 — preuve de refus n° 11 : un appelant anonyme ne lit aucune ligne', () => {
	for (const table of TABLES_ALIMENTEES) {
		test(`${table} : 200 et [] pour l'anonyme, alors que la table est peuplée`, async ({
			request,
		}) => {
			const reponse = await request.get(`/rest/v1/${table}?select=*`, {
				headers: enTetesAnonymes(),
			})

			// Le refus se manifeste par zéro ligne, **pas** par une erreur : les deux formes
			// sont vérifiées séparément (docs/SPEC-permissions-rls.md §7).
			expect(reponse.status()).toBe(200)
			expect(await reponse.json()).toEqual([])
		})
	}
})

test.describe("A5 — aucun profil authentifié n'obtient davantage que l'anonyme", () => {
	// LIMITE FIGÉE PAR UNE ASSERTION, ET NON PAR UN COMMENTAIRE.
	//
	// Aucune politique RLS n'existe avant `CRM-012` : un membre du workspace ne voit donc pas
	// son propre workspace. Le jour où `CRM-012` livrera les politiques, ces assertions
	// échoueront, et il faudra les réviser plutôt que de laisser la limite survivre à sa cause
	// (docs/JOURNAL.md décision 51 ; convention posée par `CRM-006`).
	for (const compte of COMPTES_SEED) {
		test(`${compte.role} : 200 et [] sur les tables du socle`, async ({ request }) => {
			const jeton = await jetonDe(compte.adresse)
			for (const table of TABLES_ALIMENTEES) {
				const reponse = await request.get(`/rest/v1/${table}?select=*`, {
					headers: enTetesAuthentifies(jeton),
				})
				expect(reponse.status(), `${compte.role} sur ${table}`).toBe(200)
				expect(await reponse.json(), `${compte.role} sur ${table}`).toEqual([])
			}
		})
	}
})

test.describe("A6 — l'écriture est refusée par une erreur, pas par un silence", () => {
	test('un jeton réel ne peut pas créer de workspace : 403, code 42501', async ({ request }) => {
		const jeton = await jetonDe(COMPTES_SEED[0].adresse)
		const reponse = await request.post('/rest/v1/workspaces', {
			headers: { ...enTetesAuthentifies(jeton), 'Content-Type': 'application/json' },
			data: { name: 'Écriture interdite', slug: 'ecriture-interdite' },
		})

		expect(reponse.status()).toBe(403)
		const corps = (await reponse.json()) as { code?: string }
		expect(corps.code).toBe('42501')

		// L'échec doit être réel : la ligne ne doit exister nulle part, y compris pour la clé
		// de service. Un `403` rendu après une insertion réussie serait le pire des deux mondes.
		const controle = await request.get('/rest/v1/workspaces?select=id&slug=eq.ecriture-interdite', {
			headers: enTetesService(),
		})
		expect(await controle.json()).toEqual([])
	})
})

test.describe('Garde du harnais', () => {
	test("la clé de service n'est pas la clé anonyme", async () => {
		// Si les deux clés étaient confondues, A3 mesurerait ce que mesure A4 et l'ensemble du
		// fichier deviendrait tautologique.
		expect(CLE_SERVICE).not.toBe(enTetesAnonymes().apikey)
	})
})
