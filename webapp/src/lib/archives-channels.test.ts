// @verifies CRM-134 (docs/BACKLOG.md) tranche T1 — l'état déplié du groupe « Archivés » porté par l'adresse, la vue
//           après un archivage, le focus après un désarchivage
// @verifies docs/SPEC-channels.md §11.2 (le channel suivant, à défaut le précédent, à défaut la racine), §11.3 (le
//           paramètre `archives=1`, les autres paramètres conservés, le lien hors de la vue d'un track, le focus du
//           panneau) ; CLAUDE.md §11 (une préférence d'écran portée par l'adresse, jamais stockée)

import { describe, expect, it } from 'vitest'
import {
	archivesDepliees,
	channelApresArchivage,
	cheminArchivesTrack,
	focusApresDesarchivage,
	groupeEstUnBouton,
	rechercheAvecArchives,
} from './archives-channels'

const A = { id: 'a', slug: 'prospection' }
const B = { id: 'b', slug: 'grands-comptes' }
const C = { id: 'c', slug: 'appels-offres' }

describe('l’état déplié, dans l’adresse (§11.3)', () => {
	it('se lit sur `archives=1` seulement', () => {
		expect(archivesDepliees(new URLSearchParams('archives=1'))).toBe(true)
		expect(archivesDepliees(new URLSearchParams('archives=0'))).toBe(false)
		expect(archivesDepliees(new URLSearchParams(''))).toBe(false)
	})

	it('se pose et se retire en conservant les AUTRES paramètres de la vue', () => {
		expect(rechercheAvecArchives('?page=2&tri=titre', true)).toBe('page=2&tri=titre&archives=1')
		expect(rechercheAvecArchives('page=2&archives=1', false)).toBe('page=2')
		expect(rechercheAvecArchives('archives=1', false)).toBe('')
	})

	it('hors de la vue d’un track, le groupe est un LIEN vers la racine du track, déplié', () => {
		expect(cheminArchivesTrack('conseil-ia')).toBe('/tracks/conseil-ia?archives=1')
		expect(groupeEstUnBouton('/tracks/conseil-ia')).toBe(true)
		expect(groupeEstUnBouton('/tracks/conseil-ia/prospection')).toBe(true)
		expect(groupeEstUnBouton('/tracks/conseil-ia/prospection/liste')).toBe(true)
		expect(groupeEstUnBouton('/tracks/conseil-ia/couts')).toBe(false)
		expect(groupeEstUnBouton('/cards/5eed0000-0000-4000-8000-0000000000c1')).toBe(false)
	})
})

describe('la vue après un archivage (§11.2)', () => {
	it('passe au channel qui SUIVAIT l’archivé', () => {
		expect(channelApresArchivage([A, B, C], 'b')).toBe(C)
		expect(channelApresArchivage([A, B, C], 'a')).toBe(B)
	})

	it('à défaut, à celui qui le PRÉCÉDAIT', () => {
		expect(channelApresArchivage([A, B, C], 'c')).toBe(B)
	})

	it('à défaut, à aucun : la racine du track', () => {
		expect(channelApresArchivage([A], 'a')).toBeNull()
	})

	it('un archivé absent de la liste ne fige pas la vue : le premier onglet', () => {
		expect(channelApresArchivage([A, B], 'z')).toBe(A)
		expect(channelApresArchivage([], 'z')).toBeNull()
	})
})

describe('le focus après un désarchivage (§11.3)', () => {
	it('va au « Désarchiver » suivant du panneau, à défaut au précédent', () => {
		expect(focusApresDesarchivage([A, B, C], B)).toEqual({ cible: 'desarchiver', id: 'c' })
		expect(focusApresDesarchivage([A, B, C], C)).toEqual({ cible: 'desarchiver', id: 'b' })
	})

	it('le dernier rendu, va à l’onglet du channel rendu — le panneau disparaît avec lui', () => {
		expect(focusApresDesarchivage([A], A)).toEqual({ cible: 'onglet', slug: 'prospection' })
	})
})
