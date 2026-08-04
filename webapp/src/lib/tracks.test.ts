// @verifies CRM-020 (docs/BACKLOG.md) — lecture des tracks par la barre latérale
// @verifies docs/SPEC-tracks.md §7 (requête émise), §4 (archivage masqué), §3 (ordre)
// @verifies docs/SPEC-webapp.md §6.4 (contrat asynchrone), §7 (états systématiques)
//
// Ce fichier éprouve **la requête réellement émise** et la classification des échecs, pas
// seulement la valeur rendue. Motif : deux des trois exigences de `docs/SPEC-tracks.md` §7 sont
// portées par la requête elle-même — le filtre des archivés et l'ordre — et un test qui
// n'observerait que la réponse les laisserait disparaître sans bruit.

import { describe, expect, it } from 'vitest'
import { COLONNES_TRACK, lireTracks, type Track } from './tracks'
import type { ClientCrm } from './supabase'

type Appel = {
	table?: string
	colonnes?: string
	filtres: [string, unknown][]
	tris: string[]
}

type Reponse = { data: Track[] | null; error: { message: string } | null; status: number }

/** Client factice qui **enregistre** la requête construite, puis rend la réponse voulue. */
function clientEspion(reponse: Reponse): { client: ClientCrm; appel: Appel } {
	const appel: Appel = { filtres: [], tris: [] }
	const chaine = {
		is: (colonne: string, valeur: unknown) => {
			appel.filtres.push([colonne, valeur])
			return chaine
		},
		order: (colonne: string) => {
			appel.tris.push(colonne)
			return chaine
		},
		then: (resoudre: (valeur: Reponse) => unknown) => Promise.resolve(reponse).then(resoudre),
	}
	const client = {
		from: (table: string) => {
			appel.table = table
			return {
				select: (colonnes: string) => {
					appel.colonnes = colonnes
					return chaine
				},
			}
		},
	} as unknown as ClientCrm
	return { client, appel }
}

/** Client dont le transport échoue par une exception, comme `supabase-js` peut le faire. */
function clientQuiLeve(cause: unknown): ClientCrm {
	return {
		from: () => ({
			select: () => ({
				is: () => ({
					order: () => ({
						order: () => {
							throw cause
						},
					}),
				}),
			}),
		}),
	} as unknown as ClientCrm
}

const TRACK: Track = {
	id: 't-1',
	name: 'Conseil & IA',
	slug: 'conseil-ia',
	color: 'brand',
	icon: 'sparkles',
	position: 1,
}

describe('la requête émise porte les règles de docs/SPEC-tracks.md', () => {
	it('interroge `tracks`, et ne demande que les colonnes affichées', async () => {
		const { client, appel } = clientEspion({ data: [], error: null, status: 200 })
		await lireTracks(client)
		expect(appel.table).toBe('tracks')
		expect(appel.colonnes).toBe(COLONNES_TRACK)
		// `description` et les horodatages ne sont pas demandés : une requête ne rapporte que ce
		// qui est affiché.
		expect(appel.colonnes).not.toContain('description')
		expect(appel.colonnes).not.toContain('created_at')
	})

	it('masque les tracks archivés **côté serveur**, pas après coup', async () => {
		const { client, appel } = clientEspion({ data: [], error: null, status: 200 })
		await lireTracks(client)
		expect(appel.filtres).toEqual([['archived_at', null]])
	})

	it('trie par `position` puis par `name`, pour que l’ordre soit stable', async () => {
		const { client, appel } = clientEspion({ data: [], error: null, status: 200 })
		await lireTracks(client)
		expect(appel.tris).toEqual(['position', 'name'])
	})
})

describe('états rendus (docs/SPEC-webapp.md §6.4)', () => {
	it('rend l’état prêt avec les lignes reçues', async () => {
		const { client } = clientEspion({ data: [TRACK], error: null, status: 200 })
		const etat = await lireTracks(client)
		expect(etat).toEqual({ statut: 'pret', donnees: [TRACK] })
	})

	// « 200 et zéro ligne » est le refus de la RLS, pas une erreur : c'est un état **vide**.
	it('rend un état prêt et vide quand la RLS refuse par zéro ligne', async () => {
		const { client } = clientEspion({ data: [], error: null, status: 200 })
		const etat = await lireTracks(client)
		expect(etat).toEqual({ statut: 'pret', donnees: [] })
	})

	it('classe un 403 en refus, et non en erreur générique', async () => {
		const { client } = clientEspion({
			data: null,
			error: { message: 'permission denied for table tracks' },
			status: 403,
		})
		const etat = await lireTracks(client)
		expect(etat.statut).toBe('erreur')
		if (etat.statut === 'erreur') expect(etat.erreur.nature).toBe('forbidden')
	})

	it('classe une absence de réponse en panne de transport', async () => {
		const { client } = clientEspion({ data: null, error: { message: 'Failed to fetch' }, status: 0 })
		const etat = await lireTracks(client)
		expect(etat.statut).toBe('erreur')
		if (etat.statut === 'erreur') expect(etat.erreur.nature).toBe('network')
	})

	it('classe un code inattendu en erreur inconnue, sans prétendre savoir', async () => {
		const { client } = clientEspion({ data: null, error: { message: 'boom' }, status: 500 })
		const etat = await lireTracks(client)
		expect(etat.statut).toBe('erreur')
		if (etat.statut === 'erreur') expect(etat.erreur.nature).toBe('unknown')
	})

	// Une exception de transport ne doit pas remonter jusqu'à React : elle est rendue comme un
	// état, jamais relancée.
	it('ne lève jamais, même quand le client lève', async () => {
		const etat = await lireTracks(clientQuiLeve(new Error('socket fermée')))
		expect(etat.statut).toBe('erreur')
		if (etat.statut === 'erreur') {
			expect(etat.erreur.nature).toBe('network')
			expect(etat.erreur.detail).toBe('socket fermée')
		}
	})

	it('rend un état d’erreur lisible même si la cause n’est pas une Error', async () => {
		const etat = await lireTracks(clientQuiLeve('panne brute'))
		expect(etat.statut).toBe('erreur')
		if (etat.statut === 'erreur') expect(etat.erreur.detail).toBe('panne brute')
	})
})
