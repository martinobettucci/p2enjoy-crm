// @verifies CRM-009 (docs/BACKLOG.md) — retour interne après connexion
// @verifies docs/SPEC-auth.md §9.1 (adresse de retour)
// @verifies CRM-092 (docs/BACKLOG.md), docs/SPEC-session-sso.md §2 — la classification des refus de
//           GoTrue part avec le formulaire à mot de passe ; `lib/session.test.ts` prouve celle de
//           l'échangeur

import { describe, expect, it } from 'vitest'
import { cheminRetour } from './auth'

describe('adresse de retour', () => {
	it('conserve une adresse interne, paramètres compris', () => {
		expect(cheminRetour('/tracks/conseil-ia/grands-comptes?vue=liste')).toBe(
			'/tracks/conseil-ia/grands-comptes?vue=liste',
		)
	})

	it.each([undefined, null, '', 'https://exemple.test', '//exemple.test', '/connexion', '/connexion?x=1'])(
		'replie %s vers l’accueil',
		(valeur) => {
			expect(cheminRetour(valeur)).toBe('/')
		},
	)
})
