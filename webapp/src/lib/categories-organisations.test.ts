// @verifies CRM-153 (docs/BACKLOG.md) — tranche T2 : la lecture du catalogue des catégories d'organisations (colonnes et
//           espace demandés, actives avant archivées), les écritures nettoyées (trois colonnes à la création, l'heure
//           d'archivage envoyée ou retirée), et le dictionnaire fermé des refus
// @verifies docs/SPEC-organisations.md §9.1, §9.3 ; docs/DESIGN_SYSTEM.md §5.107
//
// Les droits réels sont éprouvés contre la vraie base par `supabase/tests/0176_commentaires_categories_organisations.test.sql`
// et `e2e/api/commentaires-categories-organisations.spec.ts` (CLAUDE.md §10).

import { describe, expect, it } from 'vitest'
import {
	archiverCategorieOrganisation,
	classerRefusCategorie,
	COLONNES_CATEGORIE_ORGANISATION,
	creerCategorieOrganisation,
	lireCategoriesOrganisations,
	modifierCategorieOrganisation,
	projeterCategoriesOrganisations,
} from './categories-organisations'
import type { ClientCrm } from './supabase'

type Appel = { readonly methode: string; readonly args: readonly unknown[] }

function espion(reponse: unknown | (() => never)) {
	const appels: Appel[] = []
	const client = {
		from: (table: string) => {
			appels.push({ methode: 'from', args: [table] })
			const maillon: Record<string, unknown> = {}
			for (const methode of ['select', 'eq', 'insert', 'update']) {
				maillon[methode] = (...args: unknown[]) => {
					appels.push({ methode, args })
					return maillon
				}
			}
			maillon.then = (resoudre: (r: unknown) => unknown, rejeter: (e: unknown) => unknown) => {
				if (typeof reponse === 'function') {
					try {
						;(reponse as () => never)()
					} catch (cause) {
						return rejeter(cause)
					}
				}
				return resoudre(reponse)
			}
			return maillon
		},
	} as unknown as ClientCrm
	return { client, appels }
}

const ligne = (id: string, name: string, archived_at: string | null = null, color = 'brand') => ({ id, name, color, archived_at })

describe('projeterCategoriesOrganisations', () => {
	it('les actives d’abord, puis les archivées, chacune dans l’ordre du nom sans casse ni accent', () => {
		const projetees = projeterCategoriesOrganisations([
			ligne('a', 'Partenaire'),
			ligne('b', 'Ancien client', '2026-11-18T00:00:00Z'),
			ligne('c', 'éditeur'),
			null,
			ligne('d', 'Client'),
		])
		expect(projetees.map((c) => [c.nom, c.archivee])).toEqual([
			['Client', false],
			['éditeur', false],
			['Partenaire', false],
			['Ancien client', true],
		])
	})

	it('une couleur hors des cinq jetons retombe sur le neutre, jamais sur une couleur inventée', () => {
		const [c] = projeterCategoriesOrganisations([ligne('a', 'X', null, 'fuchsia')])
		expect(c).toEqual({ id: 'a', nom: 'X', couleur: 'neutral', archivee: false })
	})
})

describe('lireCategoriesOrganisations', () => {
	it('demande les colonnes du catalogue, bornées à l’espace', async () => {
		const { client, appels } = espion({ data: [ligne('a', 'Client')], error: null, status: 200 })
		const lu = await lireCategoriesOrganisations(client, 'ws-1')
		expect(lu.statut).toBe('pret')
		expect(appels).toEqual([
			{ methode: 'from', args: ['organization_categories'] },
			{ methode: 'select', args: [COLONNES_CATEGORIE_ORGANISATION] },
			{ methode: 'eq', args: ['workspace_id', 'ws-1'] },
		])
	})

	it('une panne réseau est une erreur classée, jamais un catalogue vide', async () => {
		const { client } = espion({ data: null, error: { message: 'fetch failed' }, status: 0 })
		const lu = await lireCategoriesOrganisations(client, 'ws-1')
		expect(lu.statut).toBe('erreur')
		const leve = espion(() => {
			throw new Error('boom')
		})
		expect((await lireCategoriesOrganisations(leve.client, 'ws-1')).statut).toBe('erreur')
	})
})

describe('les écritures', () => {
	it('la création n’envoie que l’espace, le nom rogné et la couleur — l’auteur et les dates sont à la base', async () => {
		const { client, appels } = espion({ data: [{ id: 'n' }], error: null, status: 201 })
		const issue = await creerCategorieOrganisation(client, 'ws-1', { nom: '  Partenaire ', couleur: 'success' })
		expect(issue).toEqual({ statut: 'applique' })
		expect(appels.find((a) => a.methode === 'insert')!.args[0]).toEqual({ workspace_id: 'ws-1', name: 'Partenaire', color: 'success' })
	})

	it('la modification vise la catégorie et n’envoie que le nom et la couleur', async () => {
		const { client, appels } = espion({ data: [{ id: 'c' }], error: null, status: 200 })
		await modifierCategorieOrganisation(client, 'c', { nom: ' Client ', couleur: 'brand' })
		expect(appels.find((a) => a.methode === 'update')!.args[0]).toEqual({ name: 'Client', color: 'brand' })
		expect(appels.find((a) => a.methode === 'eq')!.args).toEqual(['id', 'c'])
	})

	it('archiver envoie une heure, désarchiver la retire', async () => {
		const archive = espion({ data: [{ id: 'c' }], error: null, status: 200 })
		await archiverCategorieOrganisation(archive.client, 'c', true, () => '2026-11-18T10:00:00Z')
		expect(archive.appels.find((a) => a.methode === 'update')!.args[0]).toEqual({ archived_at: '2026-11-18T10:00:00Z' })
		const reprise = espion({ data: [{ id: 'c' }], error: null, status: 200 })
		await archiverCategorieOrganisation(reprise.client, 'c', false)
		expect(reprise.appels.find((a) => a.methode === 'update')!.args[0]).toEqual({ archived_at: null })
	})

	it('zéro ligne rendue est « sans effet », jamais un succès (CLAUDE.md §18)', async () => {
		const { client } = espion({ data: [], error: null, status: 200 })
		expect(await archiverCategorieOrganisation(client, 'c', true)).toEqual({ statut: 'refus', nature: 'sans-effet' })
	})

	it('une exception du client est une panne réseau', async () => {
		const { client } = espion(() => {
			throw new Error('fetch failed')
		})
		expect(await creerCategorieOrganisation(client, 'ws-1', { nom: 'X', couleur: 'neutral' })).toEqual({
			statut: 'refus',
			nature: 'network',
		})
	})
})

describe('classerRefusCategorie — dictionnaire fermé', () => {
	it.each([
		[409, '23505', 'nom-pris'],
		[400, '23514', 'forme'],
		[403, '42501', 'forbidden'],
		[401, undefined, 'forbidden'],
		[0, undefined, 'network'],
		[undefined, undefined, 'network'],
		[500, 'XX000', 'unknown'],
	] as const)('statut %s, code %s → %s', (statut, code, nature) => {
		expect(classerRefusCategorie(statut, code)).toBe(nature)
	})
})
