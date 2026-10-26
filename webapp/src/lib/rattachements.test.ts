// @verifies CRM-111 (docs/BACKLOG.md) — tranche T2.3 : l'écran désigne le rattachement d'une affaire, le plus ancien,
//           comme `app.card_first_placement` en base
// @verifies docs/SPEC-rattachements.md §3.1, §5 ; docs/JOURNAL.md décisions 661, 705
// @verifies CRM-111 (docs/BACKLOG.md) — tranche T2.4.1 : `premierRattachement`, le même choix sur des rattachements portant
//           d'autres colonnes (le channel d'une affaire situe son chemin)

import { describe, expect, it } from 'vitest'
import { idRattachement, premierRattachement } from './rattachements'

describe("le rattachement d'une affaire", () => {
	it("rend l'unique rattachement, le cas de toute la bascule", () => {
		expect(idRattachement({ card_placements: [{ id: 'r1', created_at: '2026-10-01T09:00:00+00:00' }] })).toBe('r1')
	})

	it('prend le plus ancien, quel que soit l’ordre rendu par PostgREST', () => {
		const affaire = {
			card_placements: [
				{ id: 'r2', created_at: '2026-10-02T09:00:00+00:00' },
				{ id: 'r1', created_at: '2026-10-01T09:00:00+00:00' },
			],
		}
		expect(idRattachement(affaire)).toBe('r1')
	})

	it("départage deux créations simultanées par l'identifiant, comme la base", () => {
		const instant = '2026-10-01T09:00:00+00:00'
		const affaire = { card_placements: [{ id: 'rb', created_at: instant }, { id: 'ra', created_at: instant }] }
		expect(idRattachement(affaire)).toBe('ra')
	})

	it("rend `null` quand aucun rattachement n'est lisible : le geste ne doit pas partir", () => {
		expect(idRattachement({ card_placements: [] })).toBeNull()
	})
})

describe('le premier rattachement, quelles que soient ses colonnes (`CRM-111` T2.4.1)', () => {
	it('rend l’élément entier, avec ses colonnes, le plus ancien d’abord', () => {
		const liste = [
			{ id: 'r2', created_at: '2026-10-02T09:00:00+00:00', channel_id: 'ch-2' },
			{ id: 'r1', created_at: '2026-10-01T09:00:00+00:00', channel_id: 'ch-1' },
		]
		expect(premierRattachement(liste)).toEqual(liste[1])
	})

	it('rend `null` sur une liste vide', () => {
		expect(premierRattachement([])).toBeNull()
	})
})
