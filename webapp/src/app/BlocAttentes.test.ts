// @verifies CRM-109 (docs/BACKLOG.md) — tranche T3 : la dernière tentative refusée d'une attente, dite en mots dans le
//           bloc partagé des attentes ; docs/SPEC-refus-admission.md §5 ; docs/DESIGN_SYSTEM.md §5.61

import { describe, expect, it } from 'vitest'
import { texteTentative } from './BlocAttentes'

describe('la dernière tentative en mots (docs/SPEC-refus-admission.md §5)', () => {
	it('sans trace : « Aucune tentative refusée »', () => {
		expect(texteTentative(null)).toBe('Aucune tentative refusée')
	})
	it('un seul refus : la date et le motif, sans compte', () => {
		expect(texteTentative({ motif: 'attente_administrateur', premier: '2026-10-20T09:00:00Z', dernier: '2026-10-20T09:00:00Z', nombre: 1 })).toBe(
			'Refusée le 20/10 : l’espace n’a pas encore d’administrateur',
		)
	})
	it('plusieurs refus : le compte et la date du premier', () => {
		expect(texteTentative({ motif: 'adresse_non_verifiee', premier: '2026-10-18T09:00:00Z', dernier: '2026-10-21T09:00:00Z', nombre: 2 })).toBe(
			'Refusée le 21/10 : adresse non vérifiée chez LeLabs (2 fois depuis le 18/10)',
		)
	})
})
