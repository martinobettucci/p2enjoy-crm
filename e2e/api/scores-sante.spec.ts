// @verifies CRM-066 (docs/BACKLOG.md) — tranche 4 : les deux scores de santé, contrat d'API hors interface
// @verifies docs/SPEC-analytique.md §13.4 (aucun score pour une affaire décidée), §13.5 (colonnes calculées
//           `SECURITY INVOKER`, objet rendu), §13.8 (le seed couvre les trois paliers) ; CLAUDE.md §10 ;
//           docs/JOURNAL.md décisions 723 et 724
// @verifies CRM-111 T2.4.4 (docs/BACKLOG.md) — les colonnes de rattachement se lisent et s'écrivent sur `card_placements`
//           (docs/SPEC-rattachements.md §3.2, §5)
//
// AVEC LES VRAIS JETONS : Camille (admin) lit toutes les affaires ; Farida (viewer) ne lit pas « Grands comptes », dont le
// track lui est fermé (CRM-040). Le score d'une affaire suit sa ligne : qui ne lit pas l'affaire n'en lit pas le score.

import { expect, test } from '@playwright/test'
import { URL_API, enTetesAnonymes, enTetesAuthentifies, enTetesService, jetonDe } from './jetons'

const AUDIT = '5eed0000-0000-4000-8000-0000000000c3' // « Audit sécurité applicative », Grands comptes, ouverte
const GAGNEE = '5eed0000-0000-4000-8000-0000000000cd' // « Socle analytique — Vertuo », gagnée
const COLONNES = 'id,health_momentum,health_commercial'

type Ligne = {
	id: string
	health_momentum: { score: number; tier: string; penalties: { code: string; points: number }[] } | null
	health_commercial: { score: number; tier: string; signals: { code: string; weight: number }[] } | null
}

test.describe('les scores de santé — hors interface (§13)', () => {
	test('Camille lit les deux scores d’une affaire ouverte, avec palier et composantes', async ({ request }) => {
		const reponse = await request.get(`${URL_API}/rest/v1/cards?select=${COLONNES}&id=eq.${AUDIT}`, {
			headers: enTetesAuthentifies(await jetonDe('admin@p2enjoy.test')),
		})
		expect(reponse.status(), await reponse.text()).toBe(200)
		const [ligne] = (await reponse.json()) as Ligne[]
		expect(ligne?.health_momentum?.tier).toMatch(/^(healthy|watch|danger)$/)
		expect(ligne?.health_momentum?.score).toBe(100 - (ligne?.health_momentum?.penalties ?? []).reduce((s, p) => s + p.points, 0))
		expect(ligne?.health_commercial?.signals.map((s) => [s.code, s.weight])).toEqual([
			['probability', 40],
			['contact_freshness', 25],
			['next_action_timeliness', 20],
			['step_age', 15],
		])
	})

	test('TÉMOIN puis refus : Farida ne lit ni l’affaire ni son score', async ({ request }) => {
		const temoin = await request.get(`${URL_API}/rest/v1/cards?select=id&id=eq.${AUDIT}`, { headers: enTetesService() })
		expect((await temoin.json()) as unknown[]).toHaveLength(1)
		const reponse = await request.get(`${URL_API}/rest/v1/cards?select=${COLONNES}&id=eq.${AUDIT}`, {
			headers: enTetesAuthentifies(await jetonDe('viewer@p2enjoy.test')),
		})
		expect(reponse.status()).toBe(200)
		expect((await reponse.json()) as unknown[]).toEqual([])
	})

	test('une affaire gagnée n’a aucun score : `null`, pas zéro', async ({ request }) => {
		const reponse = await request.get(`${URL_API}/rest/v1/cards?select=${COLONNES}&id=eq.${GAGNEE}`, {
			headers: enTetesAuthentifies(await jetonDe('admin@p2enjoy.test')),
		})
		const [ligne] = (await reponse.json()) as Ligne[]
		expect(ligne).toEqual({ id: GAGNEE, health_momentum: null, health_commercial: null })
	})

	test('le seed couvre les trois paliers des deux scores (§13.8)', async ({ request }) => {
		const reponse = await request.get(
			// `CRM-111` T2.4.4 : une affaire ouverte a un rattachement non archivé.
			`${URL_API}/rest/v1/cards?select=${COLONNES},card_placements!card_placements_card_fk!inner(archived_at)&card_placements.archived_at=is.null&deleted_at=is.null`,
			{ headers: enTetesAuthentifies(await jetonDe('admin@p2enjoy.test')) },
		)
		const lignes = ((await reponse.json()) as Ligne[]).filter((l) => l.health_momentum !== null)
		expect(new Set(lignes.map((l) => l.health_momentum!.tier))).toEqual(new Set(['healthy', 'watch', 'danger']))
		expect(new Set(lignes.map((l) => l.health_commercial!.tier))).toEqual(new Set(['healthy', 'watch', 'danger']))
	})

	test('l’anonyme ne lit aucun score', async ({ request }) => {
		const reponse = await request.get(`${URL_API}/rest/v1/cards?select=${COLONNES}&id=eq.${AUDIT}`, {
			headers: enTetesAnonymes(),
		})
		expect([401, 403]).toContain(reponse.status())
	})
})
