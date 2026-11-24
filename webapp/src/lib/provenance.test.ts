// @verifies CRM-161 (docs/BACKLOG.md) — tranche T3.a : la provenance et le filtre « Espace » dans l'adresse
//           (docs/SPEC-espace-courant.md §16.1, §16.2 ; docs/DESIGN_SYSTEM.md §5.115)
// @verifies CRM-161 (docs/BACKLOG.md) — tranche T3.b.2 : `avecEspaces`, un lien de la même page garde le filtre (§5.115)

import { describe, expect, it } from 'vitest'
import {
	PARAMETRE_ESPACES,
	avecEspaces,
	ecrireEspacesChoisis,
	filtrerParEspace,
	lireEspacesChoisis,
	nomEspace,
	provenanceVisible,
} from './provenance'

const P2ENJOY = { id: 'ws-p', name: 'P2Enjoy SAS', slug: 'p2enjoy' }
const LUMEN = { id: 'ws-l', name: 'Studio Lumen', slug: 'studio-lumen' }
const ESPACES = [P2ENJOY, LUMEN]

describe('la provenance n’existe qu’à partir de deux espaces (§16.1)', () => {
	it('rien hors coquille, rien pour un seul espace, visible à deux', () => {
		expect(provenanceVisible(undefined)).toBe(false)
		expect(provenanceVisible([])).toBe(false)
		expect(provenanceVisible([P2ENJOY])).toBe(false)
		expect(provenanceVisible(ESPACES)).toBe(true)
	})

	it('nomme un espace lu, et rien d’un espace inconnu', () => {
		expect(nomEspace(ESPACES, 'ws-l')).toBe('Studio Lumen')
		expect(nomEspace(ESPACES, 'ws-inconnu')).toBeNull()
		expect(nomEspace(ESPACES, null)).toBeNull()
		expect(nomEspace(undefined, 'ws-l')).toBeNull()
	})
})

describe('le choix dans l’adresse (§5.115)', () => {
	it('lit les slugs en identifiants, dans l’ordre des espaces, et ignore un slug inconnu', () => {
		const adresse = new URLSearchParams(`${PARAMETRE_ESPACES}=studio-lumen,inconnu,p2enjoy`)
		expect(lireEspacesChoisis(adresse, ESPACES)).toEqual(['ws-p', 'ws-l'])
	})

	it('absent, vide, ou sans espaces connus : tous (aucun choisi)', () => {
		expect(lireEspacesChoisis(new URLSearchParams(''), ESPACES)).toEqual([])
		expect(lireEspacesChoisis(new URLSearchParams(`${PARAMETRE_ESPACES}=`), ESPACES)).toEqual([])
		expect(lireEspacesChoisis(new URLSearchParams(`${PARAMETRE_ESPACES}=inconnu`), ESPACES)).toEqual([])
		expect(lireEspacesChoisis(new URLSearchParams(`${PARAMETRE_ESPACES}=p2enjoy`), undefined)).toEqual([])
	})

	it('écrit les slugs en gardant les autres paramètres, et retire le paramètre quand rien n’est choisi', () => {
		const precedente = new URLSearchParams('tri=nom&espaces=p2enjoy')
		const ecrite = ecrireEspacesChoisis(['ws-l', 'ws-p'], ESPACES, precedente)
		expect(ecrite.get('tri')).toBe('nom')
		// L'ORDRE DES ESPACES, pas celui des identifiants reçus : deux choix égaux font la même adresse.
		expect(ecrite.get(PARAMETRE_ESPACES)).toBe('p2enjoy,studio-lumen')
		expect(ecrireEspacesChoisis([], ESPACES, precedente).has(PARAMETRE_ESPACES)).toBe(false)
		expect(ecrireEspacesChoisis(['ws-inconnu'], ESPACES, precedente).has(PARAMETRE_ESPACES)).toBe(false)
		// La précédente n'est pas modifiée.
		expect(precedente.get(PARAMETRE_ESPACES)).toBe('p2enjoy')
	})

	it('relit ce qu’elle écrit', () => {
		const ecrite = ecrireEspacesChoisis(['ws-l'], ESPACES, new URLSearchParams())
		expect(lireEspacesChoisis(ecrite, ESPACES)).toEqual(['ws-l'])
	})
})

describe('le filtrage en mémoire (§16.2)', () => {
	const lignes = [
		{ id: 'a', espace: 'ws-p' },
		{ id: 'b', espace: 'ws-l' },
		{ id: 'c', espace: null },
	]
	const espaceDe = (ligne: { espace: string | null }) => ligne.espace

	it('aucun choisi : toutes les lignes, celle sans espace comprise', () => {
		expect(filtrerParEspace(lignes, [], espaceDe).map((ligne) => ligne.id)).toEqual(['a', 'b', 'c'])
	})

	it('garde les espaces choisis, et jamais une ligne dont l’espace est inconnu', () => {
		expect(filtrerParEspace(lignes, ['ws-l'], espaceDe).map((ligne) => ligne.id)).toEqual(['b'])
		expect(filtrerParEspace(lignes, ['ws-p', 'ws-l'], espaceDe).map((ligne) => ligne.id)).toEqual(['a', 'b'])
	})
})

describe('un lien de la même page garde le filtre (§5.115, T3.b.2)', () => {
	it('sans filtre posé, le chemin est rendu tel quel', () => {
		expect(avecEspaces('/ma-journee', new URLSearchParams('qui=tous'))).toBe('/ma-journee')
		expect(avecEspaces('/ma-journee?qui=tous', new URLSearchParams(''))).toBe('/ma-journee?qui=tous')
		expect(avecEspaces('/ma-journee', new URLSearchParams(`${PARAMETRE_ESPACES}=`))).toBe('/ma-journee')
	})

	it('avec un filtre, il l’ajoute au chemin, après la requête du lien', () => {
		const adresse = new URLSearchParams('qui=tous&espaces=studio-lumen,p2enjoy')
		expect(avecEspaces('/ma-journee', adresse)).toBe('/ma-journee?espaces=studio-lumen%2Cp2enjoy')
		expect(avecEspaces('/ma-journee?qui=tous', adresse)).toBe('/ma-journee?qui=tous&espaces=studio-lumen%2Cp2enjoy')
	})

	it('le filtre de l’adresse courante remplace celui qu’un chemin porterait déjà', () => {
		expect(avecEspaces('/ma-journee?espaces=p2enjoy', new URLSearchParams('espaces=studio-lumen'))).toBe(
			'/ma-journee?espaces=studio-lumen',
		)
	})
})
