// @verifies CRM-161 (docs/BACKLOG.md) — tranche T3.d : les membres des espaces que la personne administre, rangés par espace
//           (« Saisir pour »), et dédoublonnés pour le choix de la personne du rapport de temps ; une lecture qui échoue rend
//           l'erreur, jamais une option disparue en silence (docs/SPEC-espace-courant.md §16.9.2 ; décision 981 ;
//           docs/SPEC-temps.md §7.1, §7.2)

import { describe, expect, it } from 'vitest'
import { lireEspacesAdministres, membresDesEspaces, type EspaceAdministre } from './temps-espaces'
import type { ClientCrm } from './supabase'

const P = { id: 'ws1', name: 'P2Enjoy SAS', slug: 'p2enjoy' }
const L = { id: 'ws2', name: 'Studio Lumen', slug: 'studio-lumen' }
const M = { id: 'ws3', name: 'Atelier', slug: 'atelier' }

type Reponses = {
	roles: Record<string, string | null>
	membres?: Record<string, { user_id: string; profiles: { id: string; full_name: string } | null }[]>
	erreurRole?: string
	erreurMembres?: string
}

function client({ roles, membres = {}, erreurRole, erreurMembres }: Reponses) {
	const lus: string[] = []
	const c = {
		rpc: (_nom: string, args: { ws: string }) =>
			Promise.resolve(
				args.ws === erreurRole
					? { data: null, error: { message: 'boum' }, status: 500 }
					: { data: roles[args.ws] ?? null, error: null, status: 200 },
			),
		from: () => {
			let espace = ''
			const chaine: Record<string, unknown> = {
				select: () => chaine,
				eq: (_colonne: string, valeur: string) => {
					espace = valeur
					return chaine
				},
				then: (resoudre: (r: unknown) => unknown) => {
					lus.push(espace)
					return Promise.resolve(
						espace === erreurMembres
							? { data: null, error: { message: 'boum' }, status: 500 }
							: { data: membres[espace] ?? [], error: null, status: 200 },
					).then(resoudre)
				},
			}
			return chaine
		},
	}
	return { client: c as unknown as ClientCrm, lus }
}

const membre = (id: string, nom: string) => ({ user_id: id, profiles: { id, full_name: nom } })

describe('lireEspacesAdministres', () => {
	it('ne rend que les espaces administrés, dans l’ordre donné, avec leurs membres par nom ; les autres ne sont pas lus', async () => {
		const { client: c, lus } = client({
			roles: { ws1: 'admin', ws2: 'business_developer', ws3: 'admin' },
			membres: {
				ws1: [membre('b', 'Driss Lemoine'), membre('a', 'Camille Aubert')],
				ws3: [membre('c', 'Inès Arlo')],
			},
		})
		const lu = await lireEspacesAdministres(c, [P, L, M], 'a')
		expect(lu.statut).toBe('pret')
		if (lu.statut !== 'pret') return
		expect(lu.donnees.map((g) => [g.espace.slug, g.membres.map((m) => m.nom)])).toEqual([
			['p2enjoy', ['Camille Aubert', 'Driss Lemoine']],
			['atelier', ['Inès Arlo']],
		])
		expect(lus).toEqual(['ws1', 'ws3'])
	})

	it('aucun espace administré : une liste vide, et aucun membre lu (la lectrice, un business developer)', async () => {
		const { client: c, lus } = client({ roles: { ws1: 'viewer', ws2: 'business_developer' } })
		expect(await lireEspacesAdministres(c, [P, L], 'a')).toEqual({ statut: 'pret', donnees: [] })
		expect(lus).toEqual([])
	})

	it('un rôle illisible rend l’erreur, jamais une option disparue en silence', async () => {
		const { client: c } = client({ roles: { ws1: 'admin', ws2: 'admin' }, erreurRole: 'ws2' })
		expect((await lireEspacesAdministres(c, [P, L], 'a')).statut).toBe('erreur')
	})

	it('des membres illisibles rendent l’erreur aussi', async () => {
		const { client: c } = client({ roles: { ws1: 'admin' }, erreurMembres: 'ws1' })
		expect((await lireEspacesAdministres(c, [P], 'a')).statut).toBe('erreur')
	})
})

describe('membresDesEspaces', () => {
	const A: EspaceAdministre = { espace: P, membres: [{ id: 'b', nom: 'Driss Lemoine' }, { id: 'a', nom: 'Camille Aubert' }] }
	const B: EspaceAdministre = { espace: L, membres: [{ id: 'd', nom: 'Éloïse Arlo' }, { id: 'b', nom: 'Driss Lemoine' }] }

	it('sans doublon — une personne de deux espaces une fois —, sans la personne connectée, rangés par nom', () => {
		expect(membresDesEspaces([A, B], 'a').map((m) => m.nom)).toEqual(['Driss Lemoine', 'Éloïse Arlo'])
	})

	it('aucun espace administré, aucun membre', () => {
		expect(membresDesEspaces([], 'a')).toEqual([])
	})
})
