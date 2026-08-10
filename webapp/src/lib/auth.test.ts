// @verifies CRM-009 (docs/BACKLOG.md) — classification assainie et retour interne après connexion
// @verifies docs/SPEC-auth.md §9.1 (adresse de retour), §9.3 (erreurs génériques)
// @verifies docs/SPEC-permissions-rls.md §7 (un refus ne divulgue aucune existence)

import { describe, expect, it } from 'vitest'
import { cheminRetour, classerEchecConnexion } from './auth'

describe('classification des échecs de connexion', () => {
	it('réunit un mauvais mot de passe et une adresse inconnue sous le même état', () => {
		expect(classerEchecConnexion({ status: 400, code: 'invalid_credentials' })).toBe('identifiants')
		expect(classerEchecConnexion({ status: 400, code: 'user_not_found' })).toBe('identifiants')
	})

	it('distingue une panne du serveur ou du réseau', () => {
		expect(classerEchecConnexion({ status: 503 })).toBe('reseau')
		expect(classerEchecConnexion({ status: 0 })).toBe('reseau')
		expect(classerEchecConnexion({ message: 'Failed to fetch' })).toBe('reseau')
	})

	it('nomme séparément une configuration cliente absente', () => {
		expect(classerEchecConnexion({ code: 'configuration_missing' })).toBe('configuration')
	})
})

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
