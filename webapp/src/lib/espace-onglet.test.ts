// @verifies CRM-161 (docs/BACKLOG.md) — tranche T2.a : l'espace courant de l'onglet — celui de l'adresse, sinon le dernier de
//           l'onglet, sinon le premier par nom ; un slug inconnu dit « introuvable » ; le slug d'une ressource par son espace
// @verifies docs/SPEC-espace-courant.md §2, §8.3, §15.2, §15.3 ; docs/JOURNAL.md décision 967

import { afterEach, describe, expect, it } from 'vitest'
import {
	choisirEspace,
	idEspaceParmi,
	lireEspaceDeLOnglet,
	oublierEspaceDeLOnglet,
	retenirEspaceDeLOnglet,
	slugDeLEspace,
} from './espace-onglet'

const P2E = { id: 'w-1', name: 'P2Enjoy SAS', slug: 'p2enjoy' }
const LUMEN = { id: 'w-2', name: 'Studio Lumen', slug: 'studio-lumen' }
const ESPACES = [P2E, LUMEN]

afterEach(oublierEspaceDeLOnglet)

describe('l’espace courant (§15.2)', () => {
	it('l’adresse l’emporte : son slug nomme l’espace', () => {
		expect(choisirEspace(ESPACES, 'studio-lumen', 'p2enjoy')).toEqual({ genre: 'espace', espace: LUMEN })
	})

	it('un slug d’adresse inconnu dit « introuvable », et propose le premier par nom (§8.3)', () => {
		expect(choisirEspace(ESPACES, 'inconnu')).toEqual({ genre: 'introuvable', premier: P2E })
	})

	it('sans slug d’adresse, le dernier espace de l’onglet ; sinon le premier par nom', () => {
		expect(choisirEspace(ESPACES, undefined, 'studio-lumen')).toEqual({ genre: 'espace', espace: LUMEN })
		expect(choisirEspace(ESPACES, undefined, null)).toEqual({ genre: 'espace', espace: P2E })
		// Un espace retenu qu'on ne lit plus (droits retirés) ne s'impose pas.
		expect(choisirEspace(ESPACES, undefined, 'retire')).toEqual({ genre: 'espace', espace: P2E })
		expect(choisirEspace([], undefined)).toEqual({ genre: 'aucun' })
	})

	it('la mémoire de l’onglet est une variable du module, jamais un stockage', () => {
		expect(lireEspaceDeLOnglet()).toBeNull()
		retenirEspaceDeLOnglet('studio-lumen')
		expect(choisirEspace(ESPACES, undefined)).toEqual({ genre: 'espace', espace: LUMEN })
		expect(globalThis.sessionStorage?.length ?? 0).toBe(0)
		expect(globalThis.localStorage?.length ?? 0).toBe(0)
	})
})

describe('le slug d’une ressource et l’espace d’un écran (§15.2, §15.3)', () => {
	it('le slug de l’espace d’une ressource, `null` s’il n’est pas lu', () => {
		expect(slugDeLEspace(ESPACES, 'w-2')).toBe('studio-lumen')
		expect(slugDeLEspace(ESPACES, 'w-9')).toBeNull()
		expect(slugDeLEspace(ESPACES, null)).toBeNull()
	})

	it('l’écran travaille dans l’espace du contexte ; hors coquille, dans le premier', () => {
		expect(idEspaceParmi(ESPACES, 'w-2')).toBe('w-2')
		expect(idEspaceParmi(ESPACES, null)).toBe('w-1')
		expect(idEspaceParmi(ESPACES, 'w-9')).toBe('w-1')
		expect(idEspaceParmi([], null)).toBeNull()
	})
})
