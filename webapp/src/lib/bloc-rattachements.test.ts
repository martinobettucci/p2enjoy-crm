// @verifies CRM-111 (docs/BACKLOG.md) T7.2 — archiver et désarchiver un rattachement : la seule colonne écrite, la ligne
//           relue, le refus de politique (`200` et zéro ligne) dit comme un refus, la panne comme une panne
//           (docs/SPEC-rattachements.md §5, §8.1 ; docs/DESIGN_SYSTEM.md §5.82)
// @verifies CRM-111 (docs/BACKLOG.md) T7.3 — le dictionnaire fermé des refus d'`attach_card` (migration 0148 ;
//           docs/DESIGN_SYSTEM.md §5.83)

import { describe, expect, it } from 'vitest'
import { archiverRattachement, issueArchivage, refusRattachement } from './bloc-rattachements'
import type { ClientCrm } from './supabase'

type Reponse = { data: unknown[] | null; error: { message: string; code?: string } | null; status: number }

function espion(reponse: Reponse | Error) {
	const appel: { table?: string; charge?: Record<string, unknown>; filtre?: [string, string]; colonnes?: string } = {}
	const client = {
		from: (table: string) => {
			appel.table = table
			return {
				update: (charge: Record<string, unknown>) => {
					appel.charge = charge
					const chaine = {
						eq: (colonne: string, valeur: string) => ((appel.filtre = [colonne, valeur]), chaine),
						select: (colonnes: string) => {
							appel.colonnes = colonnes
							return reponse instanceof Error ? Promise.reject(reponse) : Promise.resolve(reponse)
						},
					}
					return chaine
				},
			}
		},
	} as unknown as ClientCrm
	return { client, appel }
}

describe('archiver un rattachement (§5.82)', () => {
	it('archive : la seule colonne `archived_at`, sur le rattachement désigné, la ligne relue', async () => {
		const { client, appel } = espion({ data: [{ id: 'p-1' }], error: null, status: 200 })
		const issue = await archiverRattachement(client, 'p-1', true, () => '2026-11-03T10:00:00.000Z')
		expect(issue).toBe('enregistree')
		expect(appel).toEqual({
			table: 'card_placements',
			charge: { archived_at: '2026-11-03T10:00:00.000Z' },
			filtre: ['id', 'p-1'],
			colonnes: 'id',
		})
	})

	it('désarchive : `archived_at` remis à nul', async () => {
		const { client, appel } = espion({ data: [{ id: 'p-1' }], error: null, status: 200 })
		await archiverRattachement(client, 'p-1', false)
		expect(appel.charge).toEqual({ archived_at: null })
	})

	it('`200` et zéro ligne : la politique a filtré l’appelant, c’est un REFUS, jamais un succès', async () => {
		const { client } = espion({ data: [], error: null, status: 200 })
		expect(await archiverRattachement(client, 'p-1', true)).toBe('refusee')
	})

	it('un privilège refusé est un refus ; une panne de transport est une panne', async () => {
		expect(await archiverRattachement(espion({ data: null, error: { message: 'denied', code: '42501' }, status: 403 }).client, 'p-1', true)).toBe('refusee')
		expect(await archiverRattachement(espion(new Error('fetch failed')).client, 'p-1', true)).toBe('reseau')
	})

	it('ramène toute issue d’écriture au trio du bloc', () => {
		expect(issueArchivage('enregistree')).toBe('enregistree')
		expect(issueArchivage('reseau')).toBe('reseau')
		for (const issue of ['sans-effet', 'invalide', 'introuvable', 'refus', 'inconnu'] as const) {
			expect(issueArchivage(issue)).toBe('refusee')
		}
	})
})

describe('les refus d’`attach_card` (§5.83)', () => {
	it('chaque symbole de la migration 0148 a son refus ; l’inconnu et la panne se lisent comme une panne', () => {
		expect(refusRattachement(400, 'P0001', 'channel_not_found')).toBe('channel-introuvable')
		expect(refusRattachement(400, 'P0001', 'channel_closed')).toBe('channel-ferme')
		expect(refusRattachement(403, '42501', 'forbidden')).toBe('interdit')
		expect(refusRattachement(400, 'P0001', 'already_attached')).toBe('deja-rattachee')
		expect(refusRattachement(400, '22023', 'step_not_initial')).toBe('sans-etape-initiale')
		expect(refusRattachement(400, 'P0001', 'card_not_found')).toBe('affaire-introuvable')
		expect(refusRattachement(undefined, null, '')).toBe('reseau')
		expect(refusRattachement(500, 'XX000', 'boom')).toBe('reseau')
	})
})
