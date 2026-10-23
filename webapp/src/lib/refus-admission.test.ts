// @verifies CRM-109 (docs/BACKLOG.md) — tranche T3 : la forme de la trace d'un refus d'admission, telle que la base la
//           rend ; docs/SPEC-refus-admission.md §2 (trois motifs), §3

import { describe, expect, it } from 'vitest'
import { refusAdmissionDe } from './refus-admission'

describe('la trace d’un refus d’admission', () => {
	it('rend la trace des trois motifs, avec ses dates et son nombre', () => {
		for (const motif of ['adresse_non_verifiee', 'attente_verification', 'attente_administrateur']) {
			expect(refusAdmissionDe(motif, '2026-10-18', '2026-10-21', 2)).toEqual({ motif, premier: '2026-10-18', dernier: '2026-10-21', nombre: 2 })
		}
	})

	it('une trace absente, un motif hors des trois ou un nombre impossible ne font aucune trace', () => {
		expect(refusAdmissionDe(null, null, null, null)).toBeNull()
		expect(refusAdmissionDe('attente_espace', '2026-10-18', '2026-10-21', 1)).toBeNull()
		expect(refusAdmissionDe('attente_verification', '2026-10-18', '2026-10-21', 0)).toBeNull()
		expect(refusAdmissionDe('attente_verification', '2026-10-18', '2026-10-21', 1.5)).toBeNull()
		expect(refusAdmissionDe('attente_verification', null, '2026-10-21', 1)).toBeNull()
	})
})
