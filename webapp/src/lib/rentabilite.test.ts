// @verifies CRM-108 (docs/BACKLOG.md) — tranche T3 : la règle de rentabilité et l'arborescence du rapport
// @verifies docs/SPEC-recettes.md §4.1 à §4.4 (marge réelle et prévue, taux, partielle, plusieurs devises), §4.6 (filtre
//           d'état), §5 (lecture des colonnes de la fonction), §6.3 (track › channel › affaire, sous-totaux, un tableau par
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
	readonly calculable: boolean
	readonly attendu: Record<string, unknown>
}

const CAS: readonly Cas[] = JSON.parse(
	readFileSync(resolve(__dirname, '../../../mcp/tests/rentabilite_cas.json'), 'utf-8'),
).cas

describe('calculerRentabilite — les cas partagés avec le connecteur', () => {
	it('lit au moins les sept cas de la règle', () => {
		expect(CAS.length).toBeGreaterThanOrEqual(7)
	})
	for (const cas of CAS) {
		it(cas.nom, () => {
			const r = calculerRentabilite(cas.montants, cas.vue, cas.calculable)
			expect({
				recettes: r.recettes,
				couts: r.couts,
				personnel: r.personnel,
				marge: r.marge,
				taux: r.taux,
				partielle: r.partielle,
			}).toEqual(cas.attendu)
			expect(r.calculable).toBe(cas.calculable)
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

	it('rend un tableau par devise, sans jamais additionner deux devises', () => {
		const r = construireRapport(lignes, 'toutes', 'reel', NOMS)
		expect(r.tableaux.map((t) => t.devise)).toEqual(['CHF', 'EUR'])
		expect(r.tableaux[0]?.total.recettes).toBe(14000)
	})

	it('range les tracks et les channels par position, et porte un sous-total à chaque niveau', () => {
		const eur = construireRapport(lignes, 'toutes', 'reel', NOMS).tableaux[1]
		expect(eur?.tracks.map((t) => t.nom)).toEqual(['Conseil & IA', 'Studio web'])
		const studio = eur?.tracks[1]
		expect(studio?.channels.map((c) => c.nom)).toEqual(['Refonte', 'Maintenance'])
		expect(studio?.sousTotal.marge).toBe(4000 - 375 - 4800 + (0 - 880))
		expect(studio?.sousTotal.partielle).toEqual({ recettesSansReel: 0, coutsSansReel: 1, minutesNonValorisees: 0 })
	})

	it('dit « non calculable » une affaire à plusieurs devises, et le sous-total qui la contient', () => {
		const r = construireRapport(lignes, 'toutes', 'reel', NOMS)
		const conseilEur = r.tableaux[1]?.tracks[0]
		const formation = conseilEur?.channels[0]?.affaires.find((a) => a.cardId === 'a4')
		expect(formation?.rentabilite.calculable).toBe(false)
		expect(formation?.rentabilite.marge).toBe(null)
		expect(formation?.autresDevises).toEqual(['CHF'])
		expect(conseilEur?.sousTotal.calculable).toBe(false)
		expect(r.tableaux[1]?.total.marge).toBe(null)
	})

	it('ne montre le montant d’une affaire que dans le tableau de SA devise', () => {
		const r = construireRapport(lignes, 'toutes', 'reel', NOMS)
		const dansEur = r.tableaux[1]?.tracks[0]?.channels[0]?.affaires.find((a) => a.cardId === 'a4')
		const dansChf = r.tableaux[0]?.tracks[0]?.channels[0]?.affaires.find((a) => a.cardId === 'a4')
		expect(dansEur?.montant).toBe(null)
		expect(dansChf?.montant).toBe(28000)
	})

	it('filtre par état : seules les affaires gagnées', () => {
		const r = construireRapport(lignes, 'gagnees', 'reel', NOMS)
		expect(r.affaires).toBe(1)
		expect(r.tableaux).toHaveLength(1)
		expect(r.tableaux[0]?.tracks[0]?.channels[0]?.affaires[0]?.archivee).toBe(true)
	})

	it('compte les mentions toutes devises confondues', () => {
		const r = construireRapport(lignes, 'toutes', 'reel', NOMS)
		expect(r.mentions).toEqual({ recettesSansReel: 0, coutsSansReel: 1, minutesNonValorisees: 0 })
		expect(r.affaires).toBe(4)
	})

	it('garde la place d’un track que la seconde lecture n’a pas nommé', () => {
		const r = construireRapport([ligne({ trackId: 'inconnu', channelId: 'c9' })], 'toutes', 'reel', NOMS)
		expect(r.tableaux[0]?.tracks[0]?.nom).toBe('')
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
