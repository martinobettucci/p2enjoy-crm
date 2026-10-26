// @verifies CRM-111 (docs/BACKLOG.md) — tranche T2.3 : l'écran désigne le rattachement d'une affaire, le plus ancien,
//           comme `app.card_first_placement` en base
// @verifies docs/SPEC-rattachements.md §3.1, §5 ; docs/JOURNAL.md décisions 661, 705

import { describe, expect, it } from 'vitest'
import { idRattachement } from './rattachements'

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
