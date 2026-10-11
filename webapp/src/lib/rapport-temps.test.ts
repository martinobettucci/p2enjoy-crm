// @verifies CRM-098 (docs/BACKLOG.md) — tranche T3 : le rapport mensuel et la série « Personnel », sans rendu
// @verifies docs/SPEC-temps.md §4 (« non valorisé », jamais zéro ; devises séparées), §6.2 (lignes par personne × cible
//           × devise), §7.3 (une section par personne, une ligne par cible dans l'ordre du chemin), §7.5 (par channel)

import { describe, expect, it } from 'vitest'
import { bornesDuMois, composerRapport, cumuler, idsANommer, parChannel, type LigneValorisee } from './rapport-temps'

const l = (partiel: Partial<LigneValorisee>): LigneValorisee => ({
	profile_id: 'p1',
	track_id: 't1',
	channel_id: null,
	card_id: null,
	minutes: 105,
	montant: 120,
	devise: 'EUR',
	...partiel,
})

const NOMS: Record<string, string> = { t1: 'Studio web', t2: 'Conseil & IA', c1: 'Refonte de site', c2: 'Maintenance', a1: 'Audit', a2: 'Portail' }
const nom = (_genre: string, id: string) => NOMS[id] ?? id

describe('les bornes d’un mois', () => {
	it('du premier au dernier jour, années bissextiles comprises', () => {
		expect(bornesDuMois('2026-10')).toEqual({ debut: '2026-10-01', fin: '2026-10-31' })
		expect(bornesDuMois('2028-02')).toEqual({ debut: '2028-02-01', fin: '2028-02-29' })
		expect(bornesDuMois('2026-02')).toEqual({ debut: '2026-02-01', fin: '2026-02-28' })
	})
})

describe('cumuler', () => {
	it('additionne le temps, et les montants devise par devise', () => {
		expect(cumuler([l({}), l({ montant: 60.5 }), l({ montant: 200, devise: 'CHF' })])).toEqual({
			minutes: 315,
			montants: { EUR: 180.5, CHF: 200 },
			minutesNonValorisees: 0,
		})
	})
	it('une part sans version compte en temps, jamais en zéro euro', () => {
		expect(cumuler([l({ montant: null, devise: null, minutes: 60 }), l({})])).toEqual({
			minutes: 165,
			montants: { EUR: 120 },
			minutesNonValorisees: 60,
		})
	})
	it('les centimes ne dérivent pas', () => {
		expect(cumuler([l({ montant: 0.1 }), l({ montant: 0.2 })]).montants).toEqual({ EUR: 0.3 })
	})
})

describe('composer le rapport', () => {
	it('une section par personne ; dans chacune, les cibles dans l’ordre du chemin, les parts d’une cible réunies', () => {
		const rapport = composerRapport(
			[
				l({ track_id: 't1', channel_id: 'c1', card_id: 'a2', minutes: 210, montant: 240 }),
				l({ track_id: 't1', channel_id: 'c1', card_id: 'a2', minutes: 60, montant: null, devise: null }),
				l({ track_id: 't1' }),
				l({ track_id: 't2', channel_id: 'c2' }),
				l({ track_id: 't1', channel_id: 'c1', card_id: 'a1' }),
				l({ profile_id: 'p2', track_id: 't1', montant: null, devise: null }),
			],
			nom,
		)
		expect(rapport.map((s) => s.profil)).toEqual(['p1', 'p2'])
		const p1 = rapport[0]!
		expect(p1.lignes.map((x) => `${x.niveau}:${x.cle}`)).toEqual([
			'1:t2/c2/-', // « Conseil & IA » se range avant « Studio web »
			'0:t1/-/-',
			'2:t1/c1/a1',
			'2:t1/c1/a2',
		])
		expect(p1.lignes.find((x) => x.card_id === 'a2')?.cumul).toEqual({ minutes: 270, montants: { EUR: 240 }, minutesNonValorisees: 60 })
		expect(p1.total.minutes).toBe(105 + 270 + 105 + 105)
		expect(rapport[1]!.total).toEqual({ minutes: 105, montants: {}, minutesNonValorisees: 105 })
	})
})

describe('la série « Personnel » d’un track', () => {
	it('le temps saisi sur le track lui-même d’abord, puis un cumul par channel, ses affaires comprises', () => {
		const series = parChannel([
			l({ channel_id: 'c1', card_id: 'a1' }),
			l({ channel_id: 'c1' }),
			l({}),
			l({ channel_id: 'c2', montant: null, devise: null }),
		])
		expect(series).toEqual([
			{ channel_id: null, cumul: { minutes: 105, montants: { EUR: 120 }, minutesNonValorisees: 0 } },
			{ channel_id: 'c1', cumul: { minutes: 210, montants: { EUR: 240 }, minutesNonValorisees: 0 } },
			{ channel_id: 'c2', cumul: { minutes: 105, montants: {}, minutesNonValorisees: 105 } },
		])
	})
})

describe('les identifiants à nommer', () => {
	it('uniques, par sorte, sans les vides', () => {
		expect(idsANommer([l({ channel_id: 'c1' }), l({ channel_id: 'c1', card_id: 'a1', profile_id: 'p2' })])).toEqual({
			tracks: ['t1'],
			channels: ['c1'],
			cards: ['a1'],
			profils: ['p1', 'p2'],
		})
	})
})
