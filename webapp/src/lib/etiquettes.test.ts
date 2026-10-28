// @verifies CRM-069 (docs/BACKLOG.md) — tranche T2 : la bibliothèque des étiquettes — lecture, écriture, refus
// @verifies docs/SPEC-etiquettes-digest.md §2.1, §2.2 (les refus nommés, zéro ligne = refus) ; docs/DESIGN_SYSTEM.md §5.73
//
// Ces tests éprouvent la requête RÉELLEMENT émise et la traduction de chaque réponse, telles que `e2e/api/etiquettes.spec.ts`
// et la pgTAP `0123` les mesurent sur la pile réelle.

import { describe, expect, it } from 'vitest'
import {
	archiverEtiquette,
	basculerEtiquetteAffaire,
	classerRefusEtiquette,
	COLONNES_ETIQUETTE,
	couleurEtiquette,
	etiquettesDeLAffaire,
	lireEtiquettes,
	modifierEtiquette,
	poserEtiquette,
	projeterEtiquettes,
} from './etiquettes'
import type { ClientCrm } from './supabase'

type Reponse = { readonly data: unknown; readonly error: { readonly code?: string; readonly message: string } | null; readonly status: number }

function client(reponse: Reponse) {
	const appels: unknown[][] = []
	const faux = {
		from: (table: string) => {
			appels.push(['from', table])
			const maillon: Record<string, unknown> = {}
			for (const methode of ['select', 'eq', 'is', 'insert', 'update', 'delete']) {
				maillon[methode] = (...args: unknown[]) => {
					appels.push([methode, ...args])
					return maillon
				}
			}
			maillon.then = (resoudre: (r: Reponse) => unknown) => resoudre(reponse)
			return maillon
		},
	} as unknown as ClientCrm
	return { client: faux, appels }
}

const lue = (id: string, name: string, color = 'brand', archived_at: string | null = null) => ({ id, name, color, archived_at })

describe('projeter les étiquettes', () => {
	it('trie par nom à la casse près, dit l’archivage, et lit `neutral` une couleur hors palette', () => {
		expect(projeterEtiquettes([lue('b', 'public'), lue('a', 'Prioritaire', 'violet', '2026-01-01')])).toEqual([
			{ id: 'a', nom: 'Prioritaire', couleur: 'neutral', archivee: true },
			{ id: 'b', nom: 'public', couleur: 'brand', archivee: false },
		])
		expect(couleurEtiquette('danger')).toBe('danger')
	})

	it('le plongement d’une affaire : une étiquette illisible (nulle) est écartée, l’absence rend une liste vide', () => {
		expect(etiquettesDeLAffaire([{ etiquette: lue('a', 'Z') }, { etiquette: null }, { etiquette: lue('b', 'A') }]).map((e) => e.nom)).toEqual(['A', 'Z'])
		expect(etiquettesDeLAffaire(null)).toEqual([])
	})
})

describe('les requêtes émises', () => {
	it('le catalogue : les colonnes déclarées, sans les archivées par défaut', async () => {
		const { client: c, appels } = client({ data: [lue('a', 'A')], error: null, status: 200 })
		expect((await lireEtiquettes(c)).statut).toBe('pret')
		expect(appels).toEqual([['from', 'labels'], ['select', COLONNES_ETIQUETTE], ['is', 'archived_at', null]])
		const avec = client({ data: [], error: null, status: 200 })
		await lireEtiquettes(avec.client, { archives: true })
		expect(avec.appels.some((a) => a[0] === 'is')).toBe(false)
	})

	it('poser et modifier : le nom débarrassé de ses blancs, la couleur', async () => {
		const { client: c, appels } = client({ data: [{ id: 'n' }], error: null, status: 201 })
		expect(await poserEtiquette(c, 'ws', { nom: '  Public ', couleur: 'brand' })).toEqual({ statut: 'applique' })
		await modifierEtiquette(c, 'e-1', { nom: 'Privé', couleur: 'danger' })
		expect(appels).toContainEqual(['insert', { workspace_id: 'ws', name: 'Public', color: 'brand' }])
		expect(appels).toContainEqual(['update', { name: 'Privé', color: 'danger' }])
		expect(appels).toContainEqual(['eq', 'id', 'e-1'])
	})

	it('archiver pose l’instant, désarchiver l’efface', async () => {
		const { client: c, appels } = client({ data: [{ id: 'e' }], error: null, status: 200 })
		await archiverEtiquette(c, 'e', true, () => 't')
		await archiverEtiquette(c, 'e', false)
		expect(appels.filter((a) => a[0] === 'update').map((a) => a[1])).toEqual([{ archived_at: 't' }, { archived_at: null }])
	})

	it('poser sur une affaire n’envoie que l’affaire et l’étiquette ; retirer filtre sur les deux', async () => {
		const { client: c, appels } = client({ data: [{ card_id: 'c' }], error: null, status: 201 })
		await basculerEtiquetteAffaire(c, 'c', 'e', true)
		await basculerEtiquetteAffaire(c, 'c', 'e', false)
		expect(appels).toContainEqual(['insert', { card_id: 'c', label_id: 'e' }])
		expect(appels).toContainEqual(['delete'])
		expect(appels).toContainEqual(['eq', 'card_id', 'c'])
		expect(appels).toContainEqual(['eq', 'label_id', 'e'])
	})

	it('zéro ligne rendue est un refus, jamais un succès', async () => {
		const { client: c } = client({ data: [], error: null, status: 200 })
		expect(await basculerEtiquetteAffaire(c, 'c', 'e', false)).toEqual({ statut: 'refus', nature: 'sans-effet' })
	})
})

describe('classerRefusEtiquette — le dictionnaire fermé', () => {
	it.each([
		[409, '23505', 'duplicate key value violates unique constraint "labels_workspace_name_key"', 'nom-pris'],
		[409, '23505', 'duplicate key value violates unique constraint "card_labels_pkey"', 'sans-effet'],
		[400, '23514', 'check', 'forme'],
		[400, '22023', 'label_archived', 'archivee'],
		[403, '42501', 'rls', 'forbidden'],
		[401, undefined, 'jwt', 'forbidden'],
		[undefined, undefined, 'Failed to fetch', 'network'],
		[500, 'XX000', 'autre', 'unknown'],
	] as const)('%s %s %s → %s', (statut, code, message, attendu) => {
		expect(classerRefusEtiquette(statut, code, message)).toBe(attendu)
	})
})
