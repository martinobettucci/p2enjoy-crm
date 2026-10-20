// @verifies CRM-093 (docs/BACKLOG.md) — tranche T2 : la capacité lue par l'interface et ce qu'elle fait d'une commande
// @verifies docs/SPEC-droits-interface.md §2.2 (la lecture des deux capacités de l'espace, sur sa ligne), §3 (refusée :
//           désactivée, citant son motif), §4 (en lecture : désactivée sans motif ; inconnue : offerte)

import { describe, expect, it } from 'vitest'
import {
	CAPACITES_INCONNUES,
	capaciteDe,
	capaciteDeLEtat,
	capacitesDeLEtat,
	lireCapacitesEspace,
	motifVisible,
	proprietesCommande,
} from './capacites'
import { enChargement, enErreur, pret } from './async'
import type { ClientCrm } from './supabase'

type Reponse = { data: unknown[] | null; error: { message: string } | null; status: number }

function espion(reponse: Reponse | Error) {
	const appels: { table: string; colonnes?: string; filtres: [string, unknown][] }[] = []
	const client = {
		from: (table: string) => {
			const appel: (typeof appels)[number] = { table, filtres: [] }
			appels.push(appel)
			const chaine: Record<string, unknown> = {}
			chaine.select = (colonnes: string) => {
				appel.colonnes = colonnes
				return chaine
			}
			chaine.eq = (colonne: string, valeur: unknown) => {
				appel.filtres.push([colonne, valeur])
				return chaine
			}
			chaine.then = (ok: (r: Reponse) => unknown, ko: (e: unknown) => unknown) =>
				reponse instanceof Error ? Promise.reject(reponse).then(ok, ko) : Promise.resolve(reponse).then(ok)
			return chaine
		},
	}
	return { client: client as unknown as ClientCrm, appels }
}

describe('une valeur de colonne calculée', () => {
	it('seul false refuse, true permet, tout le reste est inconnu', () => {
		expect(capaciteDe(true)).toBe('permise')
		expect(capaciteDe(false)).toBe('refusee')
		for (const valeur of [null, undefined, 'true', 0, 1]) expect(capaciteDe(valeur)).toBe('inconnue')
	})

	it('un état asynchrone : en lecture, inconnu sur un échec', () => {
		expect(capaciteDeLEtat(enChargement())).toBe('en-lecture')
		expect(capaciteDeLEtat(enErreur({ nature: 'reseau', detail: 'x' } as never))).toBe('inconnue')
		expect(capaciteDeLEtat(pret(false))).toBe('refusee')
		expect(capaciteDeLEtat(pret(null))).toBe('inconnue')
	})
})

describe('ce que la capacité fait d’une commande', () => {
	it('refusée : désactivée, et elle cite le motif du bloc', () => {
		expect(proprietesCommande('refusee', 'motif-x')).toEqual({ disabled: true, 'aria-describedby': 'motif-x' })
		expect(motifVisible('refusee')).toBe(true)
	})

	it('en lecture : désactivée SANS motif — aucun refus ne s’affiche avant d’être su', () => {
		expect(proprietesCommande('en-lecture', 'motif-x')).toEqual({ disabled: true })
		expect(motifVisible('en-lecture')).toBe(false)
	})

	it('permise ou inconnue : offerte — un défaut de lecture ne prive personne de ses gestes', () => {
		expect(proprietesCommande('permise', 'motif-x')).toEqual({})
		expect(proprietesCommande('inconnue', 'motif-x')).toEqual({})
		expect(motifVisible('inconnue')).toBe(false)
	})

	it('une désactivation étrangère au droit — un envoi en vol — est gardée', () => {
		expect(proprietesCommande('permise', 'motif-x', true)).toEqual({ disabled: true })
		expect(proprietesCommande('refusee', 'motif-x', true)).toEqual({ disabled: true, 'aria-describedby': 'motif-x' })
	})
})

describe('les deux capacités de l’espace', () => {
	it('se lisent sur la ligne de l’espace, par ses deux colonnes calculées', async () => {
		const { client, appels } = espion({ data: [{ administration_permise: false, edition_permise: true }], error: null, status: 200 })
		expect(await lireCapacitesEspace(client, 'w1')).toEqual(pret({ administration: 'refusee', edition: 'permise' }))
		expect(appels[0]).toEqual({ table: 'workspaces', colonnes: 'administration_permise, edition_permise', filtres: [['id', 'w1']] })
	})

	it('une colonne absente de la réponse est inconnue, et n’éteint rien', async () => {
		const { client } = espion({ data: [{ edition_permise: false }], error: null, status: 200 })
		expect(await lireCapacitesEspace(client, 'w1')).toEqual(pret({ administration: 'inconnue', edition: 'refusee' }))
	})

	it('aucune ligne : rien n’est su', async () => {
		const { client } = espion({ data: [], error: null, status: 200 })
		expect(await lireCapacitesEspace(client, 'w1')).toEqual(pret(CAPACITES_INCONNUES))
	})

	it('une erreur de la base, ou une panne de transport, rend une erreur — jamais une exception', async () => {
		const enPanne = await lireCapacitesEspace(espion({ data: null, error: { message: 'PGRST202' }, status: 400 }).client, 'w1')
		expect(enPanne.statut).toBe('erreur')
		const transport = await lireCapacitesEspace(espion(new Error('Failed to fetch')).client, 'w1')
		expect(transport.statut).toBe('erreur')
		expect(capacitesDeLEtat(transport)).toEqual(CAPACITES_INCONNUES)
	})

	it('pendant la lecture, les deux sont en lecture', () => {
		expect(capacitesDeLEtat(enChargement())).toEqual({ administration: 'en-lecture', edition: 'en-lecture' })
	})
})
