// @verifies CRM-151 (docs/BACKLOG.md) — tranche T2 : la mémoire de « Ne plus demander pendant 1 heure » — l'échéance d'une
//           heure, le défaut sûr à toute anomalie (aucune valeur, valeur illisible, échéance passée ou trop lointaine,
//           stockage absent ou qui lève), « Redemander »
// @verifies docs/SPEC-mail-subsystem.md §29.11 ; CLAUDE.md §11 (préférence limitée à la session)

import { describe, expect, it } from 'vitest'
import {
	CLE_SUPPRESSION_SANS_CONFIRMATION,
	DUREE_SANS_CONFIRMATION_MS,
	lireEcheance,
	redemanderConfirmation,
	suspendreConfirmation,
} from './suppression-sans-confirmation'

function stockage(initial: Record<string, string> = {}): Storage {
	const valeurs = new Map(Object.entries(initial))
	return {
		get length() {
			return valeurs.size
		},
		clear: () => valeurs.clear(),
		getItem: (cle: string) => valeurs.get(cle) ?? null,
		key: (rang: number) => [...valeurs.keys()][rang] ?? null,
		removeItem: (cle: string) => void valeurs.delete(cle),
		setItem: (cle: string, valeur: string) => void valeurs.set(cle, valeur),
	}
}

const qui_leve = {
	getItem: () => {
		throw new Error('SecurityError')
	},
	setItem: () => {
		throw new Error('QuotaExceededError')
	},
	removeItem: () => {
		throw new Error('SecurityError')
	},
} as unknown as Storage

const MAINTENANT = new Date('2026-11-17T16:00:00.000Z')

describe('la suspension de la confirmation (§29.11)', () => {
	it('suspendre pose l’échéance d’une heure, que la lecture rend', () => {
		const s = stockage()
		const echeance = suspendreConfirmation(s, MAINTENANT)
		expect(echeance?.toISOString()).toBe('2026-11-17T17:00:00.000Z')
		expect(s.getItem(CLE_SUPPRESSION_SANS_CONFIRMATION)).toBe('2026-11-17T17:00:00.000Z')
		expect(lireEcheance(s, new Date(MAINTENANT.getTime() + 59 * 60_000))?.toISOString()).toBe('2026-11-17T17:00:00.000Z')
	})

	it('une échéance passée redemande, et la clé est retirée', () => {
		const s = stockage({ [CLE_SUPPRESSION_SANS_CONFIRMATION]: '2026-11-17T15:59:59.000Z' })
		expect(lireEcheance(s, MAINTENANT)).toBeNull()
		expect(s.getItem(CLE_SUPPRESSION_SANS_CONFIRMATION)).toBeNull()
	})

	it('le défaut sûr : rien, une valeur illisible, une échéance trop lointaine, un stockage absent ou qui lève', () => {
		expect(lireEcheance(stockage(), MAINTENANT)).toBeNull()
		expect(lireEcheance(stockage({ [CLE_SUPPRESSION_SANS_CONFIRMATION]: 'demain' }), MAINTENANT)).toBeNull()
		const lointaine = new Date(MAINTENANT.getTime() + DUREE_SANS_CONFIRMATION_MS + 60_000).toISOString()
		expect(lireEcheance(stockage({ [CLE_SUPPRESSION_SANS_CONFIRMATION]: lointaine }), MAINTENANT)).toBeNull()
		expect(lireEcheance(null, MAINTENANT)).toBeNull()
		expect(lireEcheance(qui_leve, MAINTENANT)).toBeNull()
		expect(suspendreConfirmation(qui_leve, MAINTENANT)).toBeNull()
		expect(suspendreConfirmation(null, MAINTENANT)).toBeNull()
		expect(() => redemanderConfirmation(qui_leve)).not.toThrow()
	})

	it('« Redemander » retire la clé', () => {
		const s = stockage()
		suspendreConfirmation(s, MAINTENANT)
		redemanderConfirmation(s)
		expect(lireEcheance(s, MAINTENANT)).toBeNull()
	})
})
