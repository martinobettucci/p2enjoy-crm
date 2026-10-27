// @verifies CRM-068 (docs/BACKLOG.md) — tranche T4b1 : la bibliothèque des modèles d'affaires — lecture, écriture, refus
// @verifies docs/SPEC-checklists.md §3.5 (la forme d'un modèle tenue par la base, ses refus nommés), §3.6
//           (`save_card_as_template`, `creer_affaire` et son modèle) ; docs/DESIGN_SYSTEM.md §5.71
//
// Ces tests éprouvent la requête RÉELLEMENT émise et la traduction de chaque réponse, telles que
// `e2e/api/modeles-affaires.spec.ts` et la suite pgTAP `0122` les mesurent sur la pile réelle.

import { describe, expect, it } from 'vitest'
import {
	archiverModele,
	classerRefusModele,
	COLONNES_MODELE,
	enregistrerCommeModele,
	lireModeles,
	lireModelesDuChannel,
	lireMontant,
	modifierModele,
	poserModele,
	projeterModeles,
	type ModeleLu,
	type SaisieModele,
} from './modeles-affaires'
import type { ClientCrm } from './supabase'

type Reponse = {
	readonly data: unknown
	readonly error: { readonly code?: string; readonly message: string } | null
	readonly status: number
}

/** Client espion : chaque table rend sa réponse ; chaque maillon de la requête est noté, dans l'ordre. */
function client(reponses: Record<string, Reponse>, rpc?: Reponse) {
	const appels: unknown[][] = []
	const faux = {
		from: (table: string) => {
			appels.push(['from', table])
			const maillon: Record<string, unknown> = {}
			for (const methode of ['select', 'eq', 'is', 'insert', 'update', 'maybeSingle']) {
				maillon[methode] = (...args: unknown[]) => {
					appels.push([methode, ...args])
					return maillon
				}
			}
			maillon.then = (resoudre: (r: Reponse) => unknown) => resoudre(reponses[table] ?? { data: [], error: null, status: 200 })
			return maillon
		},
		rpc: (nom: string, args: unknown) => {
			appels.push(['rpc', nom, args])
			return Promise.resolve(rpc ?? { data: null, error: null, status: 200 })
		},
	} as unknown as ClientCrm
	return { client: faux, appels }
}

const ligne = (partiel: Partial<ModeleLu>): ModeleLu => ({
	id: 'm-1',
	workflow_id: 'wf-1',
	name: 'Audit flash',
	title: null,
	description: null,
	amount: null,
	currency: 'EUR',
	field_values: {},
	checklist: [],
	archived_at: null,
	created_at: '2026-10-27T08:00:00Z',
	...partiel,
})

const SAISIE: SaisieModele = {
	nom: '  Audit flash  ',
	titre: '  ',
	description: '',
	montant: '4 800,50',
	devise: 'eur',
	points: ['Envoyer la convention', '   ', ' Planifier '],
}

describe('projeterModeles — ce que l’écran lit (docs/DESIGN_SYSTEM.md §5.71)', () => {
	it('trie par nom, à la casse près, et compte réponses et points', () => {
		const modeles = projeterModeles([
			ligne({ id: 'b', name: 'formation' }),
			ligne({ id: 'a', name: 'Audit', field_values: { budget: 1, source: 'x' }, checklist: ['Un', 'Deux'], archived_at: '2026-10-27T09:00:00Z' }),
		])
		expect(modeles.map((m) => m.nom)).toEqual(['Audit', 'formation'])
		expect(modeles[0]).toMatchObject({ nombreReponses: 2, points: ['Un', 'Deux'], archive: true })
		expect(modeles[1]).toMatchObject({ nombreReponses: 0, points: [], archive: false })
	})

	it('une liste de points mal formée se lit vide, et ses éléments non textuels sont écartés', () => {
		expect(projeterModeles([ligne({ checklist: { pas: 'une liste' } })])[0]!.points).toEqual([])
		expect(projeterModeles([ligne({ checklist: ['Un', 3, null] })])[0]!.points).toEqual(['Un'])
	})
})

describe('lireModeles et lireModelesDuChannel — les requêtes émises', () => {
	it('lit les colonnes déclarées, filtre le workflow et écarte les archivés par défaut', async () => {
		const { client: c, appels } = client({ card_templates: { data: [ligne({})], error: null, status: 200 } })
		const lus = await lireModeles(c, { idWorkflow: 'wf-1' })
		expect(lus.statut).toBe('pret')
		expect(appels).toEqual([
			['from', 'card_templates'],
			['select', COLONNES_MODELE],
			['eq', 'workflow_id', 'wf-1'],
			['is', 'archived_at', null],
		])
	})

	it('avec les archivés, aucun filtre d’archivage n’est posé ; une erreur se classe', async () => {
		const { client: c, appels } = client({ card_templates: { data: null, error: { message: 'boom' }, status: 500 } })
		const lus = await lireModeles(c, { archives: true })
		expect(lus.statut).toBe('erreur')
		expect(appels.some((a) => a[0] === 'is')).toBe(false)
	})

	it('les modèles d’un channel : le channel puis les modèles NON archivés de son workflow', async () => {
		const { client: c, appels } = client({
			channels: { data: { workflow_id: 'wf-9' }, error: null, status: 200 },
			card_templates: { data: [ligne({ workflow_id: 'wf-9' })], error: null, status: 200 },
		})
		const modeles = await lireModelesDuChannel(c, 'ch-1')
		expect(modeles.map((m) => m.id)).toEqual(['m-1'])
		expect(appels).toContainEqual(['eq', 'id', 'ch-1'])
		expect(appels).toContainEqual(['eq', 'workflow_id', 'wf-9'])
		expect(appels).toContainEqual(['is', 'archived_at', null])
	})

	it('une panne de lecture rend une liste vide : la création ne dépend pas d’elle', async () => {
		const { client: c } = client({ channels: { data: null, error: { message: 'boom' }, status: 500 } })
		expect(await lireModelesDuChannel(c, 'ch-1')).toEqual([])
		expect(await lireModelesDuChannel(null, 'ch-1')).toEqual([])
	})
})

describe('lireMontant — la saisie du montant', () => {
	it('vide vaut aucun ; virgule, point et espaces sont lus ; deux décimales au plus', () => {
		expect(lireMontant('  ')).toEqual({ ok: true, valeur: null })
		expect(lireMontant('4 800,50')).toEqual({ ok: true, valeur: 4800.5 })
		expect(lireMontant('12.5')).toEqual({ ok: true, valeur: 12.5 })
		expect(lireMontant('1,234')).toEqual({ ok: false })
		expect(lireMontant('beaucoup')).toEqual({ ok: false })
	})
})

describe('poser, modifier, archiver — ce que l’écran envoie', () => {
	it('poser : colonnes normalisées, points blancs écartés, devise en majuscules', async () => {
		const { client: c, appels } = client({ card_templates: { data: [{ id: 'm-2' }], error: null, status: 201 } })
		expect(await poserModele(c, { idWorkspace: 'ws', idWorkflow: 'wf-1' }, SAISIE, 4800.5)).toEqual({ statut: 'applique', id: 'm-2' })
		expect(appels).toContainEqual([
			'insert',
			{
				workspace_id: 'ws',
				workflow_id: 'wf-1',
				name: 'Audit flash',
				title: null,
				description: null,
				amount: 4800.5,
				currency: 'EUR',
				checklist: ['Envoyer la convention', 'Planifier'],
			},
		])
	})

	it('modifier : les réponses ne sont PAS envoyées — elles restent telles quelles (T4b2)', async () => {
		const { client: c, appels } = client({ card_templates: { data: [{ id: 'm-1' }], error: null, status: 200 } })
		await modifierModele(c, 'm-1', SAISIE, null)
		const maj = appels.find((a) => a[0] === 'update')![1] as Record<string, unknown>
		expect('field_values' in maj).toBe(false)
		expect('workflow_id' in maj).toBe(false)
		expect(appels).toContainEqual(['eq', 'id', 'm-1'])
	})

	it('zéro ligne rendue : la politique a filtré — jamais un succès', async () => {
		const { client: c } = client({ card_templates: { data: [], error: null, status: 200 } })
		expect(await modifierModele(c, 'm-1', SAISIE, null)).toEqual({ statut: 'refus', nature: 'sans-effet' })
	})

	it('archiver pose l’instant, désarchiver l’efface', async () => {
		const { client: c, appels } = client({ card_templates: { data: [{ id: 'm-1' }], error: null, status: 200 } })
		await archiverModele(c, 'm-1', true, () => '2026-10-27T10:00:00Z')
		await archiverModele(c, 'm-1', false)
		const majs = appels.filter((a) => a[0] === 'update').map((a) => a[1])
		expect(majs).toEqual([{ archived_at: '2026-10-27T10:00:00Z' }, { archived_at: null }])
	})
})

describe('classerRefusModele — le dictionnaire fermé des refus', () => {
	it.each([
		[400, '23505', 'dup', 'nom-pris'],
		[400, '23514', 'check', 'forme'],
		[400, '22023', 'template_checklist_invalid', 'point'],
		[400, '22023', 'template_field_unknown', 'reponse'],
		[400, 'P0001', 'invalid_field_value', 'reponse'],
		[403, '42501', 'rls', 'forbidden'],
		[401, undefined, 'jwt', 'forbidden'],
		[undefined, undefined, 'Failed to fetch', 'network'],
		[500, 'XX000', 'autre', 'unknown'],
	] as const)('%s %s %s → %s', (statut, code, message, attendu) => {
		expect(classerRefusModele(statut, code, message)).toBe(attendu)
	})
})

describe('enregistrerCommeModele — « Enregistrer comme modèle »', () => {
	it('appelle `save_card_as_template` avec le rattachement et le nom', async () => {
		const { client: c, appels } = client({}, { data: 'm-3', error: null, status: 200 })
		expect(await enregistrerCommeModele(c, 'pl-1', 'Audit')).toEqual({ statut: 'applique', id: 'm-3' })
		expect(appels).toEqual([['rpc', 'save_card_as_template', { p_placement: 'pl-1', p_name: 'Audit' }]])
	})

	it.each([
		[{ code: '42501', message: 'reserved_to_admins' }, 403, 'reserve'],
		[{ code: '23505', message: 'dup' }, 409, 'nom-pris'],
		[{ code: '23514', message: 'check' }, 400, 'forme'],
		[{ code: 'P0002', message: 'placement_not_found' }, 404, 'introuvable'],
		[{ code: 'XX000', message: 'autre' }, 500, 'unknown'],
	] as const)('%o → %s', async (erreur, statut, attendu) => {
		const { client: c } = client({}, { data: null, error: erreur, status: statut })
		expect(await enregistrerCommeModele(c, 'pl-1', 'Audit')).toEqual({ statut: 'refus', nature: attendu })
	})
})
