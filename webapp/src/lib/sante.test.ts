// @verifies CRM-066 (docs/BACKLOG.md) — tranche 4 : la lecture des deux scores de santé rendus par la base
// @verifies docs/SPEC-analytique.md §13.2, §13.3 (le signal inconnu), §13.5 (la forme de l'objet), §13.6 ;
//           docs/DESIGN_SYSTEM.md §5.65 (palier écrit, teinte du palier) ; docs/JOURNAL.md décisions 723 et 724

import { describe, expect, it } from 'vitest'
import { CLASSES_PALIER, CLE_PALIER, lireCommerciale, lireDynamique, lireScoresAffaire } from './sante'
import type { ClientCrm } from './supabase'

const DYNAMIQUE = {
	score: 55,
	tier: 'watch',
	penalties: [
		{ code: 'stale_step', points: 30, days: 16, threshold: 14 },
		{ code: 'next_action_missing', points: 15 },
	],
}
const COMMERCIALE = {
	score: 62,
	tier: 'watch',
	signals: [
		{ code: 'probability', weight: 40, value: 50 },
		{ code: 'step_age', weight: 15, value: null, status: 'unknown' },
	],
}

describe('la lecture des scores (§13.5)', () => {
	it('lit la dynamique et chacune de ses pénalités', () => {
		expect(lireDynamique(DYNAMIQUE)).toEqual({
			score: 55,
			palier: 'watch',
			penalites: [
				{ code: 'stale_step', points: 30, jours: 16, seuil: 14 },
				{ code: 'next_action_missing', points: 15, jours: null, seuil: null },
			],
		})
	})

	it('lit la santé commerciale, et un signal inconnu garde une note nulle', () => {
		expect(lireCommerciale(COMMERCIALE)?.signaux).toEqual([
			{ code: 'probability', poids: 40, note: 50 },
			{ code: 'step_age', poids: 15, note: null },
		])
	})

	it('rend `null` pour une affaire sans score et pour toute forme inattendue — jamais un nombre deviné', () => {
		expect(lireDynamique(null)).toBeNull()
		expect(lireDynamique({ score: 55, tier: 'rouge', penalties: [] })).toBeNull()
		expect(lireDynamique({ score: '55', tier: 'watch', penalties: [] })).toBeNull()
		expect(lireDynamique({ score: 55, tier: 'watch', penalties: [{ code: 'x' }] })).toBeNull()
		expect(lireCommerciale({ score: 62, tier: 'watch' })).toBeNull()
		expect(lireCommerciale([COMMERCIALE])).toBeNull()
	})

	it('nomme chaque palier en toutes lettres et lui donne la teinte de sa signification', () => {
		expect(CLE_PALIER).toEqual({ healthy: 'health.tier.healthy', watch: 'health.tier.watch', danger: 'health.tier.danger' })
		expect(CLASSES_PALIER.healthy).toContain('success')
		expect(CLASSES_PALIER.watch).toContain('accent')
		expect(CLASSES_PALIER.danger).toContain('danger')
	})
})

describe('la lecture d’une affaire', () => {
	// `CRM-111` T2.4.5 : les scores se lisent sur le rattachement le plus ancien de l'affaire (`card_placements`, triés
	// par création puis identifiant) ; le double enregistre la table et la colonne de filtre.
	const appels: { table: string; filtre: string }[] = []
	const client = (data: unknown[] | null, error: unknown = null, status = 200) => {
		const chaine = {
			order: () => chaine,
			limit: () => Promise.resolve({ data, error, status }),
		}
		return {
			from: (table: string) => ({
				select: () => ({
					eq: (colonne: string) => {
						appels.push({ table, filtre: colonne })
						return chaine
					},
				}),
			}),
		} as unknown as ClientCrm
	}

	it('demande les deux colonnes calculées et les lit', async () => {
		const etat = await lireScoresAffaire(client([{ health_momentum: DYNAMIQUE, health_commercial: COMMERCIALE }]), 'c1')
		expect(etat.statut === 'pret' && etat.donnees.dynamique?.score).toBe(55)
		expect(appels.at(-1)).toEqual({ table: 'card_placements', filtre: 'card_id' })
	})

	it('une affaire décidée rend deux scores nuls, pas une erreur', async () => {
		const etat = await lireScoresAffaire(client([{ health_momentum: null, health_commercial: null }]), 'c1')
		expect(etat).toEqual({ statut: 'pret', donnees: { dynamique: null, commerciale: null } })
	})

	it('une affaire illisible et une panne sont des erreurs classées', async () => {
		expect((await lireScoresAffaire(client([]), 'c1')).statut).toBe('erreur')
		const refus = await lireScoresAffaire(client(null, { message: 'refusé' }, 401), 'c1')
		expect(refus.statut === 'erreur' && refus.erreur.nature).toBe('forbidden')
	})
})
