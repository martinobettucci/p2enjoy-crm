// @verifies CRM-111 (docs/BACKLOG.md) — tranche T4.1 : la recherche et le temps valorisé à plusieurs rattachements, par
//           l'API, avec les jetons réels du seed
// @verifies docs/SPEC-rattachements.md §6 (le temps sous chaque channel rattaché lisible, `shared`, compté une fois par
//           la rentabilité), §9 (la recherche nomme les rattachements lisibles, dans l'ordre des tracks puis des
//           channels) ; docs/SPEC-recherche.md ; docs/SPEC-temps.md §6.2 ; docs/JOURNAL.md décision 814 ;
//           docs/SPEC-test-harness.md §4.3 (projet `api`) ; CLAUDE.md §10 (règle d'accès prouvée hors interface)
//
// Une affaire JETABLE de `refonte` (track « Studio web », position 2), posée par la clé de service, que l'administratrice
// rattache à `grands-comptes` (track « Conseil & IA », position 1, fermé à la lectrice). Les saisies portent sur le
// 8 juillet 2025, hors de toute fenêtre du seed ; tout est retiré en fin de fichier.

import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { posterAffaire } from '../affaire'
import { COMPTES_SEED, URL_API, enTetesAnonymes, enTetesAuthentifies, enTetesService, jetonDe } from './jetons'

const ADMIN = COMPTES_SEED[0].adresse
const LECTRICE = COMPTES_SEED[2].adresse

const ESPACE = '5eed0000-0000-4000-8000-000000000001'
const CAMILLE = '5eed0000-0000-4000-8000-000000000011'
const FARIDA = '5eed0000-0000-4000-8000-000000000013'
const WORKFLOW_GLOBAL = '5eed0000-0000-4000-8000-000000000051'
const ETAPE_INITIALE = '5eed0000-0000-4000-8000-000000000061'
const CONSEIL = '5eed0000-0000-4000-8000-000000000021'
const GRANDS_COMPTES = '5eed0000-0000-4000-8000-000000000032'
const REFONTE = '5eed0000-0000-4000-8000-000000000034'
const JOUR = '2025-07-08'

const rest = (chemin: string) => `${URL_API}/rest/v1/${chemin}`
const AFFAIRE = randomUUID()
// Un mot que rien d'autre ne porte, pour que la recherche ne rende que l'affaire jetable.
const TITRE = 'Sonde T4 aquilonaire'

type LigneTemps = { channel_id: string | null; minutes: number; montant: number | null; devise: string | null; shared: boolean }
type LigneRecherche = { objet: string; id: string; sous_titre: string | null }

async function chercher(request: import('@playwright/test').APIRequestContext, jeton: string, terme: string) {
	const reponse = await request.post(rest('rpc/recherche_globale'), {
		headers: enTetesAuthentifies(jeton),
		data: { p_terme: terme, p_limite: 50 },
	})
	expect(reponse.status(), await reponse.text()).toBe(200)
	return ((await reponse.json()) as LigneRecherche[]).filter((l) => l.id === AFFAIRE)
}

async function temps(request: import('@playwright/test').APIRequestContext, jeton: string, filtre: Record<string, string> = {}) {
	const reponse = await request.post(rest('rpc/temps_valorise'), {
		headers: enTetesAuthentifies(jeton),
		data: { p_debut: JOUR, p_fin: JOUR, p_card: AFFAIRE, ...filtre },
	})
	expect(reponse.status(), await reponse.text()).toBe(200)
	return (await reponse.json()) as LigneTemps[]
}

test.describe.configure({ mode: 'serial' })

test.describe('CRM-111 T4.1 — la recherche et le temps à plusieurs rattachements, par l’API', () => {
	test.beforeAll(async ({ request }) => {
		const pose = await posterAffaire(request, rest('cards'), {
			headers: { ...enTetesService(), Prefer: 'return=representation' },
			data: {
				id: AFFAIRE,
				workspace_id: ESPACE,
				channel_id: REFONTE,
				workflow_id: WORKFLOW_GLOBAL,
				current_step_id: ETAPE_INITIALE,
				title: TITRE,
			},
		})
		expect(pose.status(), await pose.text()).toBe(201)
		const rattache = await request.post(rest('rpc/attach_card'), {
			headers: enTetesAuthentifies(await jetonDe(ADMIN)),
			data: { p_card: AFFAIRE, p_channel: GRANDS_COMPTES },
		})
		expect(rattache.status(), await rattache.text()).toBe(200)
		const saisies = await request.post(rest('saisies_temps'), {
			headers: { ...enTetesService(), 'Content-Type': 'application/json' },
			data: [
				{ workspace_id: ESPACE, profile_id: CAMILLE, jour: JOUR, minutes: 60, card_id: AFFAIRE },
				{ workspace_id: ESPACE, profile_id: FARIDA, jour: JOUR, minutes: 30, card_id: AFFAIRE },
			],
		})
		expect(saisies.status(), await saisies.text()).toBe(201)
	})

	test.afterAll(async ({ request }) => {
		await request.delete(rest(`saisies_temps?card_id=eq.${AFFAIRE}`), { headers: enTetesService() })
		const retrait = await request.delete(rest(`cards?id=eq.${AFFAIRE}`), { headers: enTetesService() })
		expect(retrait.status(), 'l’affaire jetable est retirée, son fil avec elle').toBe(204)
	})

	test('l’administratrice trouve l’affaire nommée par ses deux channels, dans l’ordre des tracks', async ({ request }) => {
		const lignes = await chercher(request, await jetonDe(ADMIN), 'aquilonaire')
		expect(lignes).toHaveLength(1)
		expect(lignes[0]?.sous_titre).toBe('Grands comptes, Refonte de site')
	})

	test('la lectrice ne voit nommé que le channel qu’elle lit', async ({ request }) => {
		const lignes = await chercher(request, await jetonDe(LECTRICE), 'aquilonaire')
		expect(lignes).toHaveLength(1)
		expect(lignes[0]?.sous_titre).toBe('Refonte de site')
	})

	test('la saisie de l’administratrice paraît sous chaque channel, marquée `shared`, avec le même temps', async ({ request }) => {
		const lignes = await temps(request, await jetonDe(ADMIN), { p_profile: CAMILLE })
		expect(lignes.map((l) => l.channel_id).sort()).toEqual([GRANDS_COMPTES, REFONTE].sort())
		expect(lignes.every((l) => l.shared && l.minutes === 60)).toBe(true)
		expect(new Set(lignes.map((l) => `${l.montant}/${l.devise}`)).size).toBe(1)
		const conseil = await temps(request, await jetonDe(ADMIN), { p_profile: CAMILLE, p_track: CONSEIL })
		expect(conseil.map((l) => [l.channel_id, l.shared])).toEqual([[GRANDS_COMPTES, true]])
	})

	test('la lectrice voit sa saisie sous le seul channel qu’elle lit, non partagée', async ({ request }) => {
		const lignes = await temps(request, await jetonDe(LECTRICE))
		expect(lignes.map((l) => [l.channel_id, l.shared, l.minutes])).toEqual([[REFONTE, false, 30]])
	})

	test('la rentabilité de l’affaire compte chaque saisie une fois', async ({ request }) => {
		const reponse = await request.post(rest('rpc/rentabilite_affaires'), {
			headers: enTetesAuthentifies(await jetonDe(ADMIN)),
			data: { p_debut: JOUR, p_fin: JOUR, p_card: AFFAIRE },
		})
		expect(reponse.status(), await reponse.text()).toBe(200)
		const lignes = (await reponse.json()) as { minutes: number }[]
		expect(lignes.reduce((total, l) => total + l.minutes, 0)).toBe(60 + 30)
	})

	test('l’anonyme ne lit pas le temps valorisé', async ({ request }) => {
		const reponse = await request.post(rest('rpc/temps_valorise'), {
			headers: { ...enTetesAnonymes(), 'Content-Type': 'application/json' },
			data: { p_debut: JOUR, p_fin: JOUR },
		})
		expect(reponse.status()).toBe(401)
	})
})
