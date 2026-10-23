// @verifies CRM-098 (docs/BACKLOG.md) — tranche T2 : la matrice de la semaine, sans rendu
// @verifies docs/SPEC-temps.md §2 (quart de 105 minutes, journée de 420, heures au quart d'heure), §6.1 (semaine du
//           lundi), §6.3 (mode d'une journée), §7.2 (lignes, reprise, pied) ; docs/DESIGN_SYSTEM.md §5.54 (cellule)
// @verifies CRM-106 (docs/BACKLOG.md) — tranche T2 : `modesDesJours` et `remplacerDansSaisies` ; docs/SPEC-temps.md
//           §7.6 (2 : une valeur remplace, zéro retire ; 4 : le mode d'un jour se lit sur toutes ses saisies)

import { describe, expect, it } from 'vitest'
import {
	affairesDesSaisies,
	decalerJours,
	depasseLaJournee,
	enHeures,
	enJours,
	jourLocal,
	joursDeLaSemaine,
	lignesMatrice,
	lireSaisie,
	lundiDe,
	minutesCellule,
	modeDuJour,
	modesDesJours,
	remplacerDansSaisies,
	totalJour,
	totalLigne,
	valeurDeChamp,
	type Saisie,
} from './temps'

describe('le mode d’une journée', () => {
	it('en quarts tant que toutes les saisies tombent sur un quart, y compris une journée vide', () => {
		expect(modeDuJour([])).toBe('quarts')
		expect(modeDuJour([105, 210, 105])).toBe('quarts')
	})
	it('en heures dès qu’une saisie n’est pas un multiple de 105 minutes', () => {
		expect(modeDuJour([105, 60])).toBe('heures')
		expect(modeDuJour([90])).toBe('heures')
	})
})

describe('lire ce qu’on tape dans une cellule', () => {
	it('vide vaut zéro, dans les deux modes', () => {
		expect(lireSaisie('', 'quarts')).toEqual({ ok: true, minutes: 0 })
		expect(lireSaisie('  ', 'heures')).toEqual({ ok: true, minutes: 0 })
	})
	it('en quarts : un entier de 0 à 4, un quart valant 105 minutes', () => {
		expect(lireSaisie('1', 'quarts')).toEqual({ ok: true, minutes: 105 })
		expect(lireSaisie('4', 'quarts')).toEqual({ ok: true, minutes: 420 })
		expect(lireSaisie('5', 'quarts')).toEqual({ ok: false, motif: 'borne' })
		expect(lireSaisie('1,5', 'quarts')).toEqual({ ok: false, motif: 'pas' })
	})
	it('en heures : virgule ou point, au quart d’heure, 7 heures au plus', () => {
		expect(lireSaisie('1,5', 'heures')).toEqual({ ok: true, minutes: 90 })
		expect(lireSaisie('0.25', 'heures')).toEqual({ ok: true, minutes: 15 })
		expect(lireSaisie('7', 'heures')).toEqual({ ok: true, minutes: 420 })
		expect(lireSaisie('7,25', 'heures')).toEqual({ ok: false, motif: 'borne' })
		expect(lireSaisie('1,1', 'heures')).toEqual({ ok: false, motif: 'pas' })
	})
	it('ce qui n’est pas un nombre positif est refusé comme format', () => {
		expect(lireSaisie('deux', 'quarts')).toEqual({ ok: false, motif: 'format' })
		expect(lireSaisie('-1', 'heures')).toEqual({ ok: false, motif: 'format' })
		expect(lireSaisie('1h30', 'heures')).toEqual({ ok: false, motif: 'format' })
	})
})

describe('la valeur d’un champ', () => {
	it('vide pour zéro, jamais « 0 »', () => {
		expect(valeurDeChamp(0, 'quarts')).toBe('')
		expect(valeurDeChamp(0, 'heures')).toBe('')
	})
	it('des quarts entiers en mode quarts, des heures à virgule en mode heures', () => {
		expect(valeurDeChamp(210, 'quarts')).toBe('2')
		expect(valeurDeChamp(210, 'heures')).toBe('3,5')
		expect(valeurDeChamp(105, 'heures')).toBe('1,75')
	})
	it('une valeur hors quart reste en heures même si la journée est dite en quarts', () => {
		expect(valeurDeChamp(90, 'quarts')).toBe('1,5')
	})
})

describe('les durées', () => {
	it('en heures et minutes', () => {
		expect(enHeures(390)).toEqual({ jours: 0, heures: 6, minutes: 30 })
		expect(enHeures(420)).toEqual({ jours: 0, heures: 7, minutes: 0 })
	})
	it('en jours de 7 heures', () => {
		expect(enJours(630)).toEqual({ jours: 1, heures: 3, minutes: 30 })
		expect(enJours(840)).toEqual({ jours: 2, heures: 0, minutes: 0 })
		expect(enJours(45)).toEqual({ jours: 0, heures: 0, minutes: 45 })
	})
})

describe('la semaine', () => {
	it('commence le lundi, quel que soit le jour donné', () => {
		expect(lundiDe('2026-10-11')).toBe('2026-10-05') // un dimanche
		expect(lundiDe('2026-10-12')).toBe('2026-10-12') // un lundi
		expect(lundiDe('2026-10-14')).toBe('2026-10-12')
	})
	it('compte sept jours, à travers un changement de mois et d’heure', () => {
		expect(joursDeLaSemaine('2026-10-26')).toEqual([
			'2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01',
		])
		expect(decalerJours('2026-10-26', -7)).toBe('2026-10-19')
	})
	it('aujourd’hui est le jour LOCAL de la personne', () => {
		expect(jourLocal(new Date(2026, 9, 11, 23, 30))).toBe('2026-10-11')
	})
})

const ARBRE = [
	{ id: 't1', name: 'Studio web', channels: [{ id: 'c1', name: 'Refonte de site' }, { id: 'c2', name: 'Maintenance' }] },
	{ id: 't2', name: 'Formation', channels: [] },
]
const AFFAIRES = [
	{ id: 'a2', title: 'Refonte Sogexia', channel_id: 'c1' },
	{ id: 'a1', title: 'Audit Nordis', channel_id: 'c1' },
	{ id: 'a3', title: 'Hors arbre', channel_id: 'c9' },
	{ id: 'a4', title: 'Jamais touchée', channel_id: 'c2' },
]
const s = (id: string, jour: string, minutes: number, cible: Partial<Saisie>): Saisie => ({
	id, jour, minutes, track_id: null, channel_id: null, card_id: null, ...cible,
})

describe('les lignes de la matrice', () => {
	it('chaque track suivi de ses channels, et sous un channel ses affaires à montrer, par titre', () => {
		const lignes = lignesMatrice(ARBRE, AFFAIRES, new Set(['a2', 'a1']))
		expect(lignes.map((l) => `${l.niveau}:${l.libelle}`)).toEqual([
			'0:Studio web', '1:Refonte de site', '2:Audit Nordis', '2:Refonte Sogexia', '1:Maintenance', '0:Formation',
		])
	})
	it('une affaire à montrer dont le channel n’est pas dans l’arbre vient en fin, jamais perdue', () => {
		const lignes = lignesMatrice(ARBRE, AFFAIRES, new Set(['a3']))
		expect(lignes.at(-1)).toEqual({ cle: 'card:a3', cible: { genre: 'card', id: 'a3' }, libelle: 'Hors arbre', niveau: 2 })
	})
	it('une affaire sans temps ni ajout ne paraît pas', () => {
		expect(lignesMatrice(ARBRE, AFFAIRES, new Set()).some((l) => l.cible.genre === 'card')).toBe(false)
	})
	it('les affaires reprises sont celles qui portent du temps', () => {
		const saisies = [s('1', '2026-10-05', 105, { card_id: 'a1' }), s('2', '2026-10-06', 105, { channel_id: 'c1' })]
		expect([...affairesDesSaisies(saisies)]).toEqual(['a1'])
	})
})

describe('les cellules et les totaux', () => {
	const saisies = [
		s('1', '2026-10-12', 105, { track_id: 't1' }),
		s('2', '2026-10-12', 210, { card_id: 'a1' }),
		s('3', '2026-10-13', 60, { card_id: 'a1' }),
		s('4', '2026-10-05', 105, { card_id: 'a1' }),
	]
	const semaine = joursDeLaSemaine('2026-10-12')
	it('une cellule rend les minutes de sa cible ce jour-là, zéro sinon', () => {
		expect(minutesCellule(saisies, 'card:a1', '2026-10-12')).toBe(210)
		expect(minutesCellule(saisies, 'channel:c1', '2026-10-12')).toBe(0)
	})
	it('le total d’un jour additionne toutes ses cibles ; celui d’une ligne, la semaine seule', () => {
		expect(totalJour(saisies, '2026-10-12')).toBe(315)
		expect(totalLigne(saisies, 'card:a1', semaine)).toBe(270)
	})
	it('une valeur qui ferait dépasser 7 heures est annoncée, en remplaçant la valeur de la cellule', () => {
		expect(depasseLaJournee(saisies, 'card:a1', '2026-10-12', 315)).toBe(false) // 105 + 315 = 420
		expect(depasseLaJournee(saisies, 'card:a1', '2026-10-12', 330)).toBe(true)
		expect(depasseLaJournee(saisies, 'channel:c1', '2026-10-12', 120)).toBe(true) // 315 + 120
	})
})

describe('CRM-106 — le mode des jours et le remplacement d’une saisie', () => {
	const s = (id: string, jour: string, minutes: number, cible: Partial<Pick<Saisie, 'track_id' | 'channel_id' | 'card_id'>>): Saisie => ({
		id,
		jour,
		minutes,
		track_id: null,
		channel_id: null,
		card_id: null,
		...cible,
	})
	const jours = ['2026-10-19', '2026-10-20', '2026-10-21']

	it('un jour se lit sur toutes ses saisies, et la case cochée l’emporte', () => {
		const saisies = [s('1', '2026-10-19', 105, { card_id: 'a' }), s('2', '2026-10-20', 90, { channel_id: 'c' })]
		expect(modesDesJours(saisies, jours, new Set(['2026-10-21']))).toEqual({
			'2026-10-19': 'quarts',
			'2026-10-20': 'heures',
			'2026-10-21': 'heures',
		})
	})

	it('une valeur remplace celle de la cellule, sans toucher aux autres cibles ni aux autres jours', () => {
		const ancienne = s('1', '2026-10-19', 105, { card_id: 'a' })
		const autres = [s('2', '2026-10-19', 210, { channel_id: 'c' }), s('3', '2026-10-20', 105, { card_id: 'a' })]
		const nouvelle = { ...ancienne, minutes: 315 }
		expect(remplacerDansSaisies([ancienne, ...autres], ancienne, nouvelle, 'card:a', '2026-10-19')).toEqual([...autres, nouvelle])
	})

	it('zéro retire la cellule ; une première saisie s’ajoute', () => {
		const ancienne = s('1', '2026-10-19', 105, { card_id: 'a' })
		expect(remplacerDansSaisies([ancienne], ancienne, null, 'card:a', '2026-10-19')).toEqual([])
		const premiere = s('9', '2026-10-21', 60, { card_id: 'a' })
		expect(remplacerDansSaisies([ancienne], null, premiere, 'card:a', '2026-10-21')).toEqual([ancienne, premiere])
	})
})
