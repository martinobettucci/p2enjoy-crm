// @verifies CRM-110 (docs/BACKLOG.md) tranche T2 — les ancêtres d'une route de track
// @verifies docs/SPEC-webapp.md §5.1 bis (niveaux par route ; règle 1, aucune requête ; règle 2, un niveau non lu
//           n'est pas rendu)
//
// La règle à prouver d'abord est la DEUXIÈME : un niveau dont la donnée manque disparaît, il n'est jamais remplacé
// par un slug ni par un libellé inventé. Les adresses, elles, sont composées depuis la ligne rendue.

import { describe, expect, it } from 'vitest'
import { ancetresAffaire, ancetresBudget, ancetresChannel, ancetresCoutsTrack } from './fil-ariane'

const TRACK = { name: 'Gestion commerciale', slug: 'gestion-commerciale' }
const PARTENARIATS = { name: 'Partenariats marques', slug: 'partenariats-marques' }
const SUMMIT = { name: 'SEO & GEO Summit 2026', slug: 'seo-geo-summit-2026' }

describe('ancetresChannel — board et liste d’un channel', () => {
	it('le track précède un channel lu, et mène à la route du track', () => {
		expect(ancetresChannel(TRACK, PARTENARIATS)).toEqual([
			{ libelle: 'Gestion commerciale', vers: '/tracks/gestion-commerciale' },
		])
	})

	it('sans channel lu, la route se lit comme celle du track : aucun ancêtre', () => {
		expect(ancetresChannel(TRACK, undefined)).toEqual([])
	})

	it('sans track lu — chargement, slug inconnu ou refusé —, aucun ancêtre', () => {
		expect(ancetresChannel(null, PARTENARIATS)).toEqual([])
	})
})

describe('ancetresAffaire — une affaire ouverte', () => {
	it('nomme le track puis le channel résolu par son slug, chacun avec son adresse', () => {
		expect(ancetresAffaire(TRACK, [SUMMIT, PARTENARIATS], 'partenariats-marques')).toEqual([
			{ libelle: 'Gestion commerciale', vers: '/tracks/gestion-commerciale' },
			{ libelle: 'Partenariats marques', vers: '/tracks/gestion-commerciale/partenariats-marques' },
		])
	})

	it('un channel absent de la liste n’est pas nommé, et son slug n’est jamais affiché', () => {
		const ancetres = ancetresAffaire(TRACK, [SUMMIT], 'channel-refuse')
		expect(ancetres).toEqual([{ libelle: 'Gestion commerciale', vers: '/tracks/gestion-commerciale' }])
		expect(ancetres.map((niveau) => niveau.libelle)).not.toContain('channel-refuse')
	})

	it('sans segment de channel, seul le track est nommé', () => {
		expect(ancetresAffaire(TRACK, [SUMMIT], undefined)).toHaveLength(1)
	})

	it('sans track lu, rien n’est nommé — même si des channels sont fournis', () => {
		expect(ancetresAffaire(null, [PARTENARIATS], 'partenariats-marques')).toEqual([])
	})
})

describe('ancetresCoutsTrack et ancetresBudget — les écrans de coûts', () => {
	it('les coûts d’un track sont précédés du track', () => {
		expect(ancetresCoutsTrack(TRACK)).toEqual([{ libelle: 'Gestion commerciale', vers: '/tracks/gestion-commerciale' }])
		expect(ancetresCoutsTrack(null)).toEqual([])
	})

	it('un budget est précédé du track puis de « Coûts », qui mène aux coûts du track', () => {
		expect(ancetresBudget(TRACK)).toEqual([
			{ libelle: 'Gestion commerciale', vers: '/tracks/gestion-commerciale' },
			{ libelle: 'Coûts', vers: '/tracks/gestion-commerciale/couts' },
		])
		expect(ancetresBudget(null)).toEqual([])
	})
})
