// @verifies CRM-098 (docs/BACKLOG.md) — tranche T2 : lire et écrire le temps de la semaine
// @verifies docs/SPEC-temps.md §3.2 (zéro supprime la ligne, seules les minutes changent), §5 (refus de la base :
//           plafond, droit), §6.1 (la semaine et la précédente ; recherche d'affaire) ; docs/DESIGN_SYSTEM.md §5.7 ter
// @verifies CRM-111 (docs/BACKLOG.md) — tranche T2.4.1 : l'affaire située par son plus ancien rattachement

import { describe, expect, it } from 'vitest'
import {
	BORNE_RECHERCHE_AFFAIRE,
	affairesSituees,
	COLONNES_SAISIE,
	chercherAffaires,
	classerRefusTemps,
	ecrireCellule,
	lireAffaires,
	lireArbreTemps,
	lireSaisies,
	type Ecriture,
} from './saisie-temps'
import type { ClientCrm } from './supabase'

type Reponse = { data: unknown[] | null; error: { message: string; code?: string } | null; status: number }
type Appel = { table: string; action?: string; charge?: unknown; colonnes?: string; filtres: [string, unknown][] }

/** Client factice : il enregistre chaque requête construite et rend les réponses dans l'ordre. */
function espion(reponses: readonly Reponse[]): { client: ClientCrm; appels: Appel[] } {
	const appels: Appel[] = []
	let rang = 0
	const client = {
		from: (table: string) => {
			const appel: Appel = { table, filtres: [] }
			appels.push(appel)
			const reponse = reponses[rang++] ?? { data: [], error: null, status: 200 }
			const chaine: Record<string, unknown> = {}
			for (const nom of ['eq', 'is', 'in', 'gte', 'lte', 'ilike', 'order', 'limit']) {
				chaine[nom] = (colonne: unknown, valeur?: unknown) => {
					appel.filtres.push([`${nom}:${String(colonne)}`, valeur])
					return chaine
				}
			}
			chaine.select = (colonnes: string) => {
				appel.colonnes = colonnes
				appel.action ??= 'select'
				return chaine
			}
			for (const action of ['insert', 'update', 'delete']) {
				chaine[action] = (charge?: unknown) => {
					appel.action = action
					appel.charge = charge
					return chaine
				}
			}
			chaine.then = (resoudre: (r: Reponse) => unknown) => Promise.resolve(reponse).then(resoudre)
			return chaine
		},
	}
	return { client: client as unknown as ClientCrm, appels }
}

const SAISIE = { id: 's1', jour: '2026-10-12', minutes: 105, track_id: null, channel_id: 'c1', card_id: null }

describe('les lectures', () => {
	it('l’arbre : tracks et channels non archivés, channels dans l’ordre de leur position', async () => {
		const { client, appels } = espion([
			{
				data: [{ id: 't1', name: 'Studio web', position: 1, channels: [{ id: 'c2', name: 'B', position: 2 }, { id: 'c1', name: 'A', position: 1 }] }],
				error: null,
				status: 200,
			},
		])
		const etat = await lireArbreTemps(client)
		expect(etat).toEqual({ statut: 'pret', donnees: [{ id: 't1', name: 'Studio web', channels: [{ id: 'c1', name: 'A' }, { id: 'c2', name: 'B' }] }] })
		expect(appels[0]?.filtres).toContainEqual(['is:archived_at', null])
		expect(appels[0]?.filtres).toContainEqual(['is:channels.archived_at', null])
	})
	it('les saisies : l’espace, la personne et la période, bornes comprises', async () => {
		const { client, appels } = espion([{ data: [SAISIE], error: null, status: 200 }])
		const etat = await lireSaisies(client, 'w', 'p', '2026-10-05', '2026-10-18')
		expect(etat).toEqual({ statut: 'pret', donnees: [SAISIE] })
		expect(appels[0]?.colonnes).toBe(COLONNES_SAISIE)
		expect(appels[0]?.filtres).toEqual(
			expect.arrayContaining([['eq:workspace_id', 'w'], ['eq:profile_id', 'p'], ['gte:jour', '2026-10-05'], ['lte:jour', '2026-10-18']]),
		)
	})
	it('un refus de lecture devient une erreur classée', async () => {
		const { client } = espion([{ data: null, error: { message: 'interdit' }, status: 403 }])
		expect(await lireSaisies(client, 'w', 'p', 'a', 'b')).toEqual({ statut: 'erreur', erreur: { nature: 'forbidden', detail: 'interdit' } })
	})
	it('aucune requête pour nommer zéro affaire', async () => {
		const { client, appels } = espion([])
		expect(await lireAffaires(client, [])).toEqual({ statut: 'pret', donnees: [] })
		expect(appels).toHaveLength(0)
	})
	it('la recherche : affaires actives, jokers neutralisés, bornée', async () => {
		const { client, appels } = espion([{ data: [], error: null, status: 200 }])
		await chercherAffaires(client, ' 100%_ ')
		expect(appels[0]?.filtres).toEqual(
			expect.arrayContaining([
				['ilike:title', '%100\\%\\_%'],
				['is:card_placements.archived_at', null],
				['is:deleted_at', null],
				[`limit:${BORNE_RECHERCHE_AFFAIRE}`, undefined],
			]),
		)
	})
	it('situe chaque affaire par le channel de son plus ancien rattachement, et écarte celle qui n’en a aucun', () => {
		expect(
			affairesSituees([
				{
					id: 'c1',
					title: 'Refonte',
					card_placements: [
						{ id: 'r2', channel_id: 'ch-recent', created_at: '2026-10-02T09:00:00+00:00' },
						{ id: 'r1', channel_id: 'ch-ancien', created_at: '2026-10-01T09:00:00+00:00' },
					],
				},
				{ id: 'c2', title: 'Sans rattachement lisible', card_placements: [] },
			]),
		).toEqual([{ id: 'c1', title: 'Refonte', channel_id: 'ch-ancien' }])
	})
	it('un terme vide ne cherche rien', async () => {
		const { client, appels } = espion([])
		expect(await chercherAffaires(client, '   ')).toEqual({ statut: 'pret', donnees: [] })
		expect(appels).toHaveLength(0)
	})
})

const BASE: Ecriture = { idWorkspace: 'w', idPersonne: 'p', jour: '2026-10-12', cible: { genre: 'channel', id: 'c1' }, minutes: 105, existante: null }

describe('écrire une cellule', () => {
	it('une cellule vide reçoit une ligne : une seule cible renseignée', async () => {
		const { client, appels } = espion([{ data: [SAISIE], error: null, status: 201 }])
		expect(await ecrireCellule(client, BASE)).toEqual({ statut: 'applique', saisie: SAISIE })
		expect(appels[0]?.action).toBe('insert')
		expect(appels[0]?.charge).toEqual({
			workspace_id: 'w', profile_id: 'p', jour: '2026-10-12', minutes: 105, track_id: null, channel_id: 'c1', card_id: null,
		})
	})
	it('une cellule occupée ne change que ses minutes', async () => {
		const { client, appels } = espion([{ data: [{ ...SAISIE, minutes: 210 }], error: null, status: 200 }])
		await ecrireCellule(client, { ...BASE, minutes: 210, existante: SAISIE })
		expect(appels[0]?.action).toBe('update')
		expect(appels[0]?.charge).toEqual({ minutes: 210 })
		expect(appels[0]?.filtres).toContainEqual(['eq:id', 's1'])
	})
	it('zéro supprime la ligne, et la cellule redevient vide', async () => {
		const { client, appels } = espion([{ data: [SAISIE], error: null, status: 200 }])
		expect(await ecrireCellule(client, { ...BASE, minutes: 0, existante: SAISIE })).toEqual({ statut: 'applique', saisie: null })
		expect(appels[0]?.action).toBe('delete')
	})
	it('zéro sur une cellule déjà vide n’envoie rien', async () => {
		const { client, appels } = espion([])
		expect(await ecrireCellule(client, { ...BASE, minutes: 0 })).toEqual({ statut: 'applique', saisie: null })
		expect(appels).toHaveLength(0)
	})
	it('zéro ligne touchée est « sans effet », jamais un succès', async () => {
		const { client } = espion([{ data: [], error: null, status: 200 }])
		expect(await ecrireCellule(client, { ...BASE, minutes: 210, existante: SAISIE })).toEqual({ statut: 'sans-effet' })
	})
	it('le plafond refusé par la base est dit comme tel', async () => {
		const { client } = espion([{ data: null, error: { message: 'plafond journalier', code: 'P0001' }, status: 400 }])
		expect(await ecrireCellule(client, BASE)).toEqual({ statut: 'refus', motif: 'plafond' })
	})
})

describe('classer un refus', () => {
	it('distingue le plafond, le droit, le conflit, le réseau et le reste', () => {
		expect(classerRefusTemps(400, 'P0001', 'plafond journalier')).toBe('plafond')
		expect(classerRefusTemps(403, '42501', 'new row violates row-level security policy')).toBe('droit')
		expect(classerRefusTemps(409, '23505', 'duplicate key')).toBe('conflit')
		expect(classerRefusTemps(undefined, undefined, 'Failed to fetch')).toBe('reseau')
		expect(classerRefusTemps(500, 'XX000', 'boom')).toBe('inconnu')
	})
})
