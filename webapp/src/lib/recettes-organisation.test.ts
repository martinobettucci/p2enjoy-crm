// @verifies CRM-146 (docs/BACKLOG.md) — tranche T2 : la lecture des totaux d'une organisation et la part réalisée
// @verifies docs/SPEC-recettes.md §12.2 (la part : sans objet sur un prévu nul ou négatif, au-delà de 100 %, 0 % sur un
//           réel inconnu ; les devises jamais additionnées), §12.3 (l'appel de `organization_revenue_totals`, avec ou sans
//           `p_organization_id`), §12.5 (les mentions : des affaires, jamais comptées deux fois, et des lignes) ;
//           docs/SPEC-types.md (une réponse non conforme est écartée et comptée)

import { describe, expect, it } from 'vitest'
import {
	largeurBarre,
	lireLignesTotaux,
	lireTotauxOrganisations,
	mentionsOrganisation,
	partRealisee,
	pourcentageEntier,
	type TotalDevise,
} from './recettes-organisation'
import type { ClientCrm } from './supabase'

const brute = (o: Record<string, unknown> = {}) => ({
	organization_id: 'o1',
	currency: 'EUR',
	estimated_total: 210000,
	actual_total: 163000,
	cards: 1,
	shared_cards: 1,
	revenue_lines: 2,
	lines_without_actual: 0,
	...o,
})

describe('la part réalisée (§12.2)', () => {
	it('est le réel sur le prévu, et peut dépasser 1', () => {
		expect(partRealisee(200, 50)).toBe(0.25)
		expect(partRealisee(100, 150)).toBe(1.5)
	})
	it('vaut 0 quand aucun réel n’est connu', () => {
		expect(partRealisee(72000, null)).toBe(0)
	})
	it('est sans objet quand le prévu est nul ou négatif', () => {
		expect(partRealisee(0, 10)).toBeNull()
		expect(partRealisee(-50, 10)).toBeNull()
	})
	it('la barre est bornée à [0, 100], le pourcentage écrit ne l’est pas', () => {
		expect(largeurBarre(1.5)).toBe(100)
		expect(largeurBarre(-0.2)).toBe(0)
		expect(largeurBarre(0.776)).toBeCloseTo(77.6)
		expect(pourcentageEntier(0.776)).toBe(78)
		expect(pourcentageEntier(1.5)).toBe(150)
	})
})

describe('la lecture des lignes de la fonction', () => {
	it('range par organisation, les devises par code ; le réel nul reste nul ; les montants en texte sont lus', () => {
		const { parOrganisation, ecartees } = lireLignesTotaux([
			brute({ currency: 'EUR' }),
			brute({ currency: 'CHF', estimated_total: '28000.00', actual_total: null }),
			brute({ organization_id: 'o2', cards: 3 }),
		])
		expect(ecartees).toBe(0)
		expect(parOrganisation.get('o1')?.map((t) => t.devise)).toEqual(['CHF', 'EUR'])
		expect(parOrganisation.get('o1')?.[0]).toEqual({
			devise: 'CHF', prevu: 28000, reel: null, affaires: 1, affairesPartagees: 1, lignes: 2, lignesSansReel: 0,
		})
		expect(parOrganisation.get('o2')?.[0]?.affaires).toBe(3)
	})
	it('écarte et compte une ligne sans organisation, sans devise ou sans prévu — jamais devinée', () => {
		const { parOrganisation, ecartees } = lireLignesTotaux([
			brute({ organization_id: null }),
			brute({ currency: '' }),
			brute({ estimated_total: null }),
			brute(),
		])
		expect(ecartees).toBe(3)
		expect(parOrganisation.get('o1')).toHaveLength(1)
	})
})

describe('les mentions de la fiche (§12.5)', () => {
	it('additionnent les affaires et les lignes à travers les devises — une affaire n’a qu’une devise', () => {
		const totaux: TotalDevise[] = [
			{ devise: 'CHF', prevu: 1, reel: null, affaires: 1, affairesPartagees: 0, lignes: 1, lignesSansReel: 1 },
			{ devise: 'EUR', prevu: 1, reel: 1, affaires: 2, affairesPartagees: 1, lignes: 3, lignesSansReel: 2 },
		]
		expect(mentionsOrganisation(totaux)).toEqual({ affaires: 3, affairesPartagees: 1, lignesSansReel: 3 })
	})
})

describe('l’appel de la fonction (§12.3)', () => {
	function client(reponse: unknown, appels: unknown[][]) {
		return {
			rpc: (...args: unknown[]) => {
				appels.push(args)
				return Promise.resolve(reponse)
			},
		} as unknown as ClientCrm
	}

	it('sans organisation pour la liste, avec `p_organization_id` pour la fiche', async () => {
		const appels: unknown[][] = []
		const c = client({ data: [brute()], error: null, status: 200 }, appels)
		const liste = await lireTotauxOrganisations(c)
		const fiche = await lireTotauxOrganisations(c, 'o1')
		expect(appels).toEqual([
			['organization_revenue_totals', {}],
			['organization_revenue_totals', { p_organization_id: 'o1' }],
		])
		expect(liste.statut === 'pret' && liste.donnees.get('o1')?.[0]?.prevu).toBe(210000)
		expect(fiche.statut).toBe('pret')
	})

	it('un refus de la base est une erreur classée, jamais un vide', async () => {
		const lu = await lireTotauxOrganisations(client({ data: null, error: { message: 'permission denied' }, status: 401 }, []))
		expect(lu.statut).toBe('erreur')
	})

	it('une exception du réseau est une erreur, jamais une absence de recette', async () => {
		const c = { rpc: () => Promise.reject(new Error('Failed to fetch')) } as unknown as ClientCrm
		expect((await lireTotauxOrganisations(c)).statut).toBe('erreur')
	})
})
