// @verifies CRM-007 (docs/BACKLOG.md) — contrat asynchrone et classement des échecs
// @verifies docs/SPEC-webapp.md §6.4 (contrat asynchrone), §7 (états systématiques)
// @verifies docs/DESIGN_SYSTEM.md §5.8 (quatre états explicites)

import { describe, expect, it } from 'vitest'
import { classerErreur, enChargement, enErreur, pret } from './async'

describe('classerErreur', () => {
	it('classe 403 en refus : le backend a répondu, et a refusé', () => {
		expect(classerErreur(403, 'permission denied').nature).toBe('forbidden')
	})

	it('classe 401 en refus, au même titre que 403', () => {
		expect(classerErreur(401, 'JWT expired').nature).toBe('forbidden')
	})

	it('classe une absence de code en panne de transport : réessayer a un sens', () => {
		expect(classerErreur(undefined, 'Failed to fetch').nature).toBe('network')
		expect(classerErreur(0, 'Failed to fetch').nature).toBe('network')
	})

	it('ne prétend pas savoir devant un code inattendu', () => {
		expect(classerErreur(500, 'boom').nature).toBe('unknown')
		expect(classerErreur(418, 'teapot').nature).toBe('unknown')
	})

	it('conserve le détail technique pour le diagnostic, sans le confondre avec le message affiché', () => {
		expect(classerErreur(500, 'relation "workspaces" does not exist').detail).toBe(
			'relation "workspaces" does not exist',
		)
	})

	// Le refus par RLS ne passe pas par ici : il rend 200 et zéro ligne. C'est un état *vide*,
	// pas un état d'erreur (docs/SPEC-webapp.md §6.3). Cette assertion fige la distinction.
	it('ne transforme jamais un état vide en erreur', () => {
		expect(pret<readonly string[]>([]).statut).toBe('pret')
	})
})

describe('constructeurs d’état', () => {
	it('produisent les trois statuts, et rien d’autre', () => {
		expect(enChargement<number>().statut).toBe('chargement')
		expect(pret(3)).toEqual({ statut: 'pret', donnees: 3 })
		expect(enErreur<number>({ nature: 'network', detail: 'x' }).statut).toBe('erreur')
	})
})
