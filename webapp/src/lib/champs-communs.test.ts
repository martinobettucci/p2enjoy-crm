// @verifies CRM-112 (docs/BACKLOG.md) — tranche T4.a : les colonnes de la vue liste — les champs actifs, listés, d'un type
//           affichable, dans l'ordre de la partie commune ; ce qu'une cellule dit, par type
// @verifies docs/SPEC-champs-communs.md §8 (précision T4.a) ; docs/DESIGN_SYSTEM.md §5.91

import { describe, expect, it } from 'vitest'
import { celluleCommune, colonnesCommunes, type ChampCommun } from './champs-communs'

const champ = (partiel: Partial<ChampCommun>): ChampCommun => ({
	id: 'c',
	key: 'k',
	label: 'Champ',
	type: 'text',
	options: {},
	help_text: null,
	position: 1,
	archived_at: null,
	is_listed: true,
	...partiel,
})

describe('colonnesCommunes (§5.91)', () => {
	it('garde les champs actifs, listés, d’un type affichable, dans l’ordre de la partie commune', () => {
		const colonnes = colonnesCommunes([
			champ({ id: 'b', key: 'secteur', position: 2 }),
			champ({ id: 'a', key: 'siret', position: 1 }),
			champ({ id: 'x', key: 'archive', archived_at: '2026-01-01T00:00:00Z' }),
			champ({ id: 'y', key: 'pas-liste', is_listed: false }),
			champ({ id: 'z', key: 'referent', type: 'user' }),
			champ({ id: 'f', key: 'kbis', type: 'file' }),
		])
		expect(colonnes.map((c) => c.key)).toEqual(['siret', 'secteur'])
	})
})

describe('celluleCommune (§5.91)', () => {
	it('un choix par son libellé ; plusieurs, séparés par une virgule ; une case par un mot', () => {
		const options = { choices: [{ key: 'btp', label: 'BTP' }, { key: 'sante', label: 'Santé' }] }
		expect(celluleCommune(champ({ type: 'select', options }), 'btp')).toEqual({ texte: 'BTP', technique: false, devise: null })
		expect(celluleCommune(champ({ type: 'multiselect', options }), ['btp', 'sante'])?.texte).toBe('BTP, Santé')
		expect(celluleCommune(champ({ type: 'checkbox' }), true)?.texte).toBe('Oui')
		expect(celluleCommune(champ({ type: 'checkbox' }), false)?.texte).toBe('Non')
	})

	it('un nombre, un montant et une date en données techniques ; le montant au format de la colonne « Montant »', () => {
		expect(celluleCommune(champ({ type: 'number' }), 1234.5)).toEqual({ texte: '1 234,5', technique: true, devise: null })
		// Le format de la colonne « Montant » de la liste : style monétaire, sans décimales (§5.91).
		expect(celluleCommune(champ({ type: 'money', options: { currency: 'EUR' } }), 1500)).toEqual({
			texte: '1 500 €',
			technique: true,
			devise: null,
		})
		expect(celluleCommune(champ({ type: 'date' }), '2026-11-03')).toEqual({ texte: '03/11/2026', technique: true, devise: null })
	})

	it('aucune valeur : la cellule reste vide ; une valeur illisible se montre telle quelle', () => {
		expect(celluleCommune(champ({}), null)).toBeNull()
		expect(celluleCommune(champ({}), undefined)).toBeNull()
		expect(celluleCommune(champ({ type: 'multiselect' }), [])).toBeNull()
		expect(celluleCommune(champ({ type: 'number' }), 'douze')?.texte).toBe('douze')
	})
})
