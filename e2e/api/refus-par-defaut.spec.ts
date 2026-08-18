// @verifies CRM-008 (docs/BACKLOG.md) — projet Playwright `api`, contrats et refus hors interface
// @verifies CRM-022 (docs/BACKLOG.md) — lecture bornée des profils, workspaces et memberships
// @verifies docs/SPEC-test-harness.md §4.3 (scénarios A1 à A6)
// @verifies docs/SPEC-permissions-rls.md §7 (preuve de refus n° 11)
// @verifies docs/SCHEMA.md §1 (tables du socle) ; docs/SPEC-seed.md §2 (contrat du seed)
//
// Ces scénarios exercent le backend **sans passer par l'interface**, avec les jetons réels des
// trois profils seedés, comme `CLAUDE.md` §10 l'exige de toute règle d'accès. Aucun navigateur
// n'est lancé : seul le contexte de requête de Playwright est employé.
//
// A4 conserve la preuve de refus anonyme. A5 a été retourné par CRM-022 : les trois tables
// d'identité du socle sont désormais lisibles par les membres de l'équipe, et leur contenu exact
// est opposé aux trois rôles réels du seed.

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
	// APPEL CORRIGÉ le 2026-08-18 (INC-146). Il se faisait avec `data: {}`, alors que
	// `app.resolve_access(text, text, text)` exige TROIS paramètres : `PGRST202` serait rendu même
	// si la fonction était exposée, et l'assertion ne distinguait donc pas « schéma non exposé » de
	// « signature non correspondante ». Ce qu'elle affirmait était vrai ; elle ne le mesurait pas.
	// Avec les VRAIS arguments, un `PGRST202` ne peut plus vouloir dire qu'une chose : PostgREST ne
	// route pas vers `app`. Si le schéma venait à être exposé, l'assertion rougirait.
	test('une fonction du schéma app est introuvable, même avec la clé de service', async ({
		request,
	}) => {
		const reponse = await request.post('/rest/v1/rpc/resolve_access', {
			headers: { ...enTetesService(), 'Content-Type': 'application/json' },
			data: { ws_role: 'admin', track_access: 'write', channel_access: 'write' },
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

test.describe('A5 — les profils authentifiés lisent exactement le socle de leur équipe', () => {
	const contrats = [
		{
			table: 'profiles',
			select: 'id',
			order: 'id',
			attendu: [
				{ id: '5eed0000-0000-4000-8000-000000000011' },
				{ id: '5eed0000-0000-4000-8000-000000000012' },
				{ id: '5eed0000-0000-4000-8000-000000000013' },
			],
		},
		{
			table: 'workspaces',
			select: 'id',
			order: 'id',
			attendu: [{ id: '5eed0000-0000-4000-8000-000000000001' }],
		},
		{
			table: 'workspace_members',
			select: 'workspace_id,user_id,role',
			order: 'user_id',
			attendu: [
				{
					workspace_id: '5eed0000-0000-4000-8000-000000000001',
					user_id: '5eed0000-0000-4000-8000-000000000011',
					role: 'admin',
				},
				{
					workspace_id: '5eed0000-0000-4000-8000-000000000001',
					user_id: '5eed0000-0000-4000-8000-000000000012',
					role: 'business_developer',
				},
				{
					workspace_id: '5eed0000-0000-4000-8000-000000000001',
					user_id: '5eed0000-0000-4000-8000-000000000013',
					role: 'viewer',
				},
			],
		},
	] as const

	for (const compte of COMPTES_SEED) {
		test(`${compte.role} : le même workspace, ses trois membres et leurs profils`, async ({
			request,
		}) => {
			const jeton = await jetonDe(compte.adresse)
			for (const contrat of contrats) {
				const reponse = await request.get(
					`/rest/v1/${contrat.table}?select=${contrat.select}&order=${contrat.order}`,
					{
					headers: enTetesAuthentifies(jeton),
					},
				)
				expect(reponse.status(), `${compte.role} sur ${contrat.table}`).toBe(200)
				expect(await reponse.json(), `${compte.role} sur ${contrat.table}`).toEqual(
					contrat.attendu,
				)
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
