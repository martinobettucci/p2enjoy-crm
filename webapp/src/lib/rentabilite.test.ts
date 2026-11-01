// @verifies CRM-108 (docs/BACKLOG.md) — tranche T3 : la règle de rentabilité et l'arborescence du rapport
// @verifies CRM-126 (docs/BACKLOG.md) — tranche T2 : la balance par devise dans un seul tableau (décision 810)
// @verifies docs/SPEC-recettes.md §4.1 à §4.4 (marge réelle et prévue, taux, partielle ; révision CRM-126 : marge dans
//           chaque devise, taux vide sur une ligne qui mêle plusieurs devises), §4.6 (filtre d'état), §5 (lecture des
//           colonnes de la fonction), §6.3 (un seul tableau, track › channel › affaire, sous-totaux et total en balance par
//           devise) ; docs/DESIGN_SYSTEM.md §5.60
//
// Les cas de la règle sont lus dans `mcp/tests/rentabilite_cas.json`, que le connecteur rejoue aussi : une divergence
// entre les deux implémentations fait rougir l'une des deux suites.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
	calculerRentabilite,
	construireRapport,
	lireEtatRapport,
	lireLignesRentabilite,
	lireVueRapport,
	type LigneRentabilite,
	type Montants,
	type Noms,
	type VueRentabilite,
} from './rentabilite'

type Cas = {
	readonly nom: string
	readonly montants: Montants
	readonly vue: VueRentabilite
	readonly plusieursDevises: boolean
	readonly attendu: Record<string, unknown>
}

const CAS: readonly Cas[] = JSON.parse(
	readFileSync(resolve(__dirname, '../../../mcp/tests/rentabilite_cas.json'), 'utf-8'),
).cas

describe('calculerRentabilite — les cas partagés avec le connecteur', () => {
	it('lit au moins les neuf cas de la règle', () => {
		expect(CAS.length).toBeGreaterThanOrEqual(9)
	})
	for (const cas of CAS) {
		it(cas.nom, () => {
			const r = calculerRentabilite(cas.montants, cas.vue, cas.plusieursDevises)
			expect({
				recettes: r.recettes,
				couts: r.couts,
				personnel: r.personnel,
				marge: r.marge,
				taux: r.taux,
				partielle: r.partielle,
			}).toEqual(cas.attendu)
		})
	}
})

const ligne = (surcharge: Partial<LigneRentabilite>): LigneRentabilite => ({
	workspaceId: 'w',
	trackId: 't1',
	channelId: 'c1',
	cardId: 'a1',
	genre: 'open',
	archivee: false,
	devise: 'EUR',
	recettesPrevues: null,
	recettesReelles: null,
	lignesRecette: 0,
	lignesRecetteSansReel: 0,
	coutsPrevus: null,
	coutsReels: null,
	lignesCout: 0,
	lignesCoutSansReel: 0,
	personnel: null,
	minutes: 0,
	minutesNonValorisees: 0,
	...surcharge,
})

const NOMS: Noms = {
	tracks: new Map([
		['t1', { nom: 'Studio web', position: 2, slug: 'studio-web' }],
		['t2', { nom: 'Conseil & IA', position: 1, slug: 'conseil-ia' }],
	]),
	channels: new Map([
		['c1', { nom: 'Refonte', position: 1, slug: 'refonte' }],
		['c2', { nom: 'Maintenance', position: 2, slug: 'maintenance' }],
		['c3', { nom: 'Grands comptes', position: 1, slug: 'grands-comptes' }],
	]),
	affaires: new Map([
		['a1', { titre: 'Refonte intranet', montant: 72000, devise: 'EUR' }],
		['a2', { titre: 'Portail adhérents', montant: 64000, devise: 'EUR' }],
		['a3', { titre: 'Socle analytique', montant: 210000, devise: 'EUR' }],
		['a4', { titre: 'Formation', montant: 28000, devise: 'CHF' }],
	]),
}

describe('lireLignesRentabilite', () => {
	it('convertit les colonnes de la fonction, nombres en texte compris, et garde « nul n’est pas zéro »', () => {
		const { lignes, ecartees } = lireLignesRentabilite([
			{
				workspace_id: 'w', track_id: 't1', channel_id: 'c1', card_id: 'a1', node_kind: 'won', archivee: true,
				currency: 'EUR', recettes_prevues: '21500.00', recettes_reelles: null, lignes_recette: 2,
				lignes_recette_sans_reel: 1, couts_prevus: 450, couts_reels: null, lignes_cout: 1, lignes_cout_sans_reel: 1,
				personnel: '4800.50', minutes: 4200, minutes_non_valorisees: 0,
			},
		])
		expect(ecartees).toBe(0)
		expect(lignes[0]).toMatchObject({
			genre: 'won', archivee: true, recettesPrevues: 21500, recettesReelles: null, coutsReels: null, personnel: 4800.5,
		})
	})
	it('écarte et compte une ligne sans identifiant ou d’un genre inconnu, sans la deviner', () => {
		const { lignes, ecartees } = lireLignesRentabilite([
			{ workspace_id: 'w', track_id: 't1', channel_id: 'c1', card_id: null, node_kind: 'open', currency: 'EUR' },
			{ workspace_id: 'w', track_id: 't1', channel_id: 'c1', card_id: 'a1', node_kind: 'paused', currency: 'EUR' },
		])
		expect(lignes).toHaveLength(0)
		expect(ecartees).toBe(2)
	})
})

describe('construireRapport', () => {
	const lignes = [
		ligne({ cardId: 'a1', recettesReelles: 4000, recettesPrevues: 72000, coutsReels: 375, personnel: 4800, lignesCoutSansReel: 1 }),
		ligne({ cardId: 'a2', channelId: 'c2', recettesReelles: 0, recettesPrevues: 1500, coutsReels: 880 }),
		ligne({ cardId: 'a3', trackId: 't2', channelId: 'c3', genre: 'won', archivee: true, recettesReelles: 163000 }),
		ligne({ cardId: 'a4', trackId: 't2', channelId: 'c3', devise: 'CHF', recettesReelles: 14000 }),
		ligne({ cardId: 'a4', trackId: 't2', channelId: 'c3', devise: 'EUR', personnel: 300 }),
	]

	const balances = (r: { readonly parDevise: readonly { devise: string; rentabilite: { marge: number | null } }[] }) =>
		Object.fromEntries(r.parDevise.map((b) => [b.devise, b.rentabilite.marge]))

	it('rend UN tableau dont le total porte une balance par devise, sans jamais additionner deux devises', () => {
		const r = construireRapport(lignes, 'toutes', 'reel', NOMS)
		expect(r.tracks).toHaveLength(2)
		expect(balances(r.total)).toEqual({ CHF: 14000, EUR: 4000 - 375 - 4800 + (0 - 880) + 163000 - 300 })
		expect(r.total.parDevise.map((b) => b.devise)).toEqual(['CHF', 'EUR'])
		expect(r.total.parDevise[0]?.rentabilite.recettes).toBe(14000)
	})

	it('range les tracks et les channels par position, et porte un sous-total à chaque niveau', () => {
		const r = construireRapport(lignes, 'toutes', 'reel', NOMS)
		expect(r.tracks.map((t) => t.nom)).toEqual(['Conseil & IA', 'Studio web'])
		const studio = r.tracks[1]
		expect(studio?.channels.map((c) => c.nom)).toEqual(['Refonte', 'Maintenance'])
		expect(balances(studio!.sousTotal)).toEqual({ EUR: 4000 - 375 - 4800 + (0 - 880) })
		expect(studio?.sousTotal.partielle).toEqual({ recettesSansReel: 0, coutsSansReel: 1, minutesNonValorisees: 0 })
		expect(studio?.sousTotal.plusieursDevises).toBe(false)
	})

	it('rend une affaire à plusieurs devises UNE fois, une balance par devise, son taux vide', () => {
		const r = construireRapport(lignes, 'toutes', 'reel', NOMS)
		const conseil = r.tracks[0]
		const formations = conseil?.channels[0]?.affaires.filter((a) => a.cardId === 'a4')
		expect(formations).toHaveLength(1)
		const formation = formations![0]!
		expect(formation.rentabilite.plusieursDevises).toBe(true)
		expect(balances(formation.rentabilite)).toEqual({ CHF: 14000, EUR: -300 })
		expect(formation.rentabilite.parDevise.every((b) => b.rentabilite.taux === null)).toBe(true)
	})

	it('vide le taux de tout regroupement qui contient une affaire mixte, et seulement de ceux-là', () => {
		const r = construireRapport(lignes, 'toutes', 'reel', NOMS)
		expect(r.tracks[0]?.sousTotal.plusieursDevises).toBe(true)
		expect(r.tracks[0]?.sousTotal.parDevise.every((b) => b.rentabilite.taux === null)).toBe(true)
		expect(r.total.plusieursDevises).toBe(true)
		// Le track « Studio web » ne contient que des affaires en EUR : son taux se calcule.
		expect(r.tracks[1]?.sousTotal.parDevise[0]?.rentabilite.taux).toBe(Math.round(((4000 - 375 - 4800 - 880) / 4000) * 1000) / 10)
	})

	it('calcule le taux de chaque devise d’un regroupement d’affaires mono-devise en devises différentes', () => {
		const r = construireRapport(
			[
				ligne({ cardId: 'a1', recettesReelles: 1000, coutsReels: 250 }),
				ligne({ cardId: 'a4', devise: 'CHF', recettesReelles: 2000, coutsReels: 1000 }),
			],
			'toutes',
			'reel',
			NOMS,
		)
		expect(r.total.plusieursDevises).toBe(false)
		expect(r.total.parDevise.map((b) => [b.devise, b.rentabilite.taux])).toEqual([
			['CHF', 50],
			['EUR', 75],
		])
	})

	it('rend le montant d’une affaire dans sa devise, même quand la base ne rend aucune ligne dans celle-ci', () => {
		const r = construireRapport([ligne({ cardId: 'a4', devise: 'EUR', personnel: 300 })], 'toutes', 'reel', NOMS)
		expect(r.tracks[0]?.channels[0]?.affaires[0]?.montant).toEqual({ valeur: 28000, devise: 'CHF' })
	})

	it('balance la vue « Prévu » devise par devise', () => {
		const r = construireRapport(lignes, 'toutes', 'prevu', NOMS)
		const formation = r.tracks[0]?.channels[0]?.affaires.find((a) => a.cardId === 'a4')
		expect(balances(formation!.rentabilite)).toEqual({ CHF: null, EUR: -300 })
	})

	it('filtre par état : seules les affaires gagnées', () => {
		const r = construireRapport(lignes, 'gagnees', 'reel', NOMS)
		expect(r.affaires).toBe(1)
		expect(r.tracks).toHaveLength(1)
		expect(r.tracks[0]?.channels[0]?.affaires[0]?.archivee).toBe(true)
	})

	it('compte les mentions toutes devises confondues', () => {
		const r = construireRapport(lignes, 'toutes', 'reel', NOMS)
		expect(r.mentions).toEqual({ recettesSansReel: 0, coutsSansReel: 1, minutesNonValorisees: 0 })
		expect(r.affaires).toBe(4)
	})

	it('garde la place d’un track que la seconde lecture n’a pas nommé', () => {
		const r = construireRapport([ligne({ trackId: 'inconnu', channelId: 'c9' })], 'toutes', 'reel', NOMS)
		expect(r.tracks[0]?.nom).toBe('')
		expect(r.affaires).toBe(1)
	})
})

describe('lireEtatRapport et lireVueRapport', () => {
	it('replient une valeur d’adresse inconnue sur le défaut', () => {
		expect(lireEtatRapport('perdues')).toBe('perdues')
		expect(lireEtatRapport('n-importe')).toBe('toutes')
		expect(lireEtatRapport(null)).toBe('toutes')
		expect(lireVueRapport('prevu')).toBe('prevu')
		expect(lireVueRapport('x')).toBe('reel')
	})
})
