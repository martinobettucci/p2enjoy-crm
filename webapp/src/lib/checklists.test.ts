// @verifies CRM-068 (docs/BACKLOG.md) — tranche T3a : lire, cocher, ajouter et retirer les points de la checklist
// @verifies docs/SPEC-checklists.md §2 (points d'étape du rattachement, points libres de l'affaire), §3.2 (cocher sans
//           envoyer l'heure ni l'auteur ; ajouter un point libre seulement), §3.4 (les mentions d'exigence) ;
//           docs/DESIGN_SYSTEM.md §5.70 (l'étape courante d'abord, les étapes quittées ensuite, les points libres)

import { describe, expect, it } from 'vitest'
import {
	COLONNES_POINT_CHECKLIST,
	ajouterPointLibre,
	classerRefusChecklist,
	cocherPoint,
	lireChecklist,
	positionSuivante,
	projeterChecklist,
	retirerPointLibre,
	type PointLu,
} from './checklists'
import type { ClientCrm } from './supabase'

const RATTACHEMENT = 'rattachement-1'
const PROSPECTION = 'etape-prospection'
const RELANCE = 'etape-relance'

const etape = (position: number, label: string) => ({ position, label_override: null, workflow_nodes_catalog: { label } })
const vers = (id: string, position: number, label: string) => ({ transition: { vers: { id, ...etape(position, label) } } })

function point(partiel: Partial<PointLu> & { id: string }): PointLu {
	return {
		placement_id: RATTACHEMENT,
		step_item_id: `origine-${partiel.id}`,
		label: `Point ${partiel.id}`,
		position: 1,
		checked: false,
		checked_at: null,
		created_at: '2026-10-26T10:00:00+00:00',
		cocheur: null,
		origine: { step_id: RELANCE, etape: etape(2, 'Relance'), exigences: [] },
		...partiel,
	}
}

describe('projeterChecklist — le groupement du bloc (docs/DESIGN_SYSTEM.md §5.70)', () => {
	it('met l’étape courante d’abord, les étapes quittées ensuite dans l’ordre du workflow, et compte tout', () => {
		const vue = projeterChecklist(
			[
				point({ id: 'r1', position: 2, checked: true, checked_at: '2026-10-26T11:00:00+00:00', cocheur: { full_name: 'Driss Lemoine' } }),
				point({ id: 'r0', position: 1 }),
				point({ id: 'p1', origine: { step_id: PROSPECTION, etape: etape(1, 'Prospection'), exigences: [] } }),
				point({ id: 'l1', placement_id: null, step_item_id: null, origine: null, checked: true, checked_at: '2026-10-26T12:00:00+00:00' }),
			],
			RATTACHEMENT,
			RELANCE,
		)
		expect(vue.etapeCourante?.libelle).toBe('Relance')
		expect(vue.etapeCourante?.points.map((p) => p.id)).toEqual(['r0', 'r1'])
		expect(vue.etapesPassees.map((g) => g.libelle)).toEqual(['Prospection'])
		expect(vue.libres.map((p) => p.id)).toEqual(['l1'])
		expect(vue.libres[0]?.libre).toBe(true)
		expect(vue.etapeCourante?.points[1]).toMatchObject({ coche: true, cochePar: 'Driss Lemoine' })
		expect({ coches: vue.coches, total: vue.total }).toEqual({ coches: 2, total: 4 })
	})

	it('nomme les étapes d’arrivée des transitions qui exigent un point — dans l’étape courante seulement', () => {
		const exigences = [vers('negociation', 3, 'Négociation'), vers('perdu', 9, 'Perdu'), vers('negociation', 3, 'Négociation')]
		const vue = projeterChecklist(
			[
				point({ id: 'r1', origine: { step_id: RELANCE, etape: etape(2, 'Relance'), exigences } }),
				point({ id: 'p1', origine: { step_id: PROSPECTION, etape: etape(1, 'Prospection'), exigences } }),
			],
			RATTACHEMENT,
			RELANCE,
		)
		expect(vue.etapeCourante?.points[0]?.exigePour).toEqual(['Négociation', 'Perdu'])
		expect(vue.etapesPassees[0]?.points[0]?.exigePour).toEqual([])
	})

	it('écarte les points d’un autre rattachement, et range en dernier ceux dont l’étape a été supprimée', () => {
		const vue = projeterChecklist(
			[
				point({ id: 'autre', placement_id: 'rattachement-2' }),
				point({ id: 'orphelin', step_item_id: null, origine: null }),
				point({ id: 'p1', origine: { step_id: PROSPECTION, etape: etape(1, 'Prospection'), exigences: [] } }),
			],
			RATTACHEMENT,
			RELANCE,
		)
		expect(vue.etapeCourante).toBeNull()
		expect(vue.etapesPassees.map((g) => [g.idEtape, g.libelle])).toEqual([
			[PROSPECTION, 'Prospection'],
			[null, null],
		])
		expect(vue.total).toBe(2)
	})

	it('ne dit ni l’auteur ni l’heure d’un point décoché, et le libellé propre d’une étape prime sur son nœud', () => {
		const vue = projeterChecklist(
			[
				point({
					id: 'r1',
					checked: false,
					checked_at: '2026-10-26T11:00:00+00:00',
					cocheur: { full_name: 'Driss Lemoine' },
					origine: { step_id: RELANCE, etape: { position: 2, label_override: 'Relance client', workflow_nodes_catalog: { label: 'Relance' } }, exigences: [] },
				}),
			],
			RATTACHEMENT,
			RELANCE,
		)
		expect(vue.etapeCourante?.libelle).toBe('Relance client')
		expect(vue.etapeCourante?.points[0]).toMatchObject({ cocheLe: null, cochePar: null })
	})

	it('place un nouveau point libre après le dernier, à 1 sans point libre', () => {
		const vide = projeterChecklist([], RATTACHEMENT, RELANCE)
		expect(positionSuivante(vide)).toBe(1)
		const avec = projeterChecklist([point({ id: 'l1', placement_id: null, step_item_id: null, origine: null, position: 4 })], RATTACHEMENT, RELANCE)
		expect(positionSuivante(avec)).toBe(5)
	})
})

describe('classerRefusChecklist — le dictionnaire fermé', () => {
	it('nomme le libellé refusé, le droit, le réseau, et rien d’autre', () => {
		expect(classerRefusChecklist(400, '23514', 'new row violates check constraint "card_checklist_items_label_check"')).toBe('libelle')
		expect(classerRefusChecklist(400, '23514', 'autre contrainte')).toBe('unknown')
		expect(classerRefusChecklist(403, '42501', 'permission denied')).toBe('forbidden')
		expect(classerRefusChecklist(401, undefined, '')).toBe('forbidden')
		expect(classerRefusChecklist(undefined, undefined, 'Failed to fetch')).toBe('network')
		expect(classerRefusChecklist(500, 'XX000', 'boom')).toBe('unknown')
	})
})

type Appel = { table: string; geste: string; charge?: unknown; filtres: string[]; select?: string }

function client(reponse: { data?: unknown; error?: { code?: string; message: string } | null; status?: number }) {
	const appels: Appel[] = []
	const fin = { data: reponse.data ?? null, error: reponse.error ?? null, status: reponse.status ?? 200 }
	const chaine = (appel: Appel) => {
		const objet: Record<string, unknown> = {
			eq: (colonne: string, valeur: string) => {
				appel.filtres.push(`${colonne}=${valeur}`)
				return objet
			},
			select: (colonnes: string) => {
				appel.select = colonnes
				return objet
			},
			then: (resoudre: (valeur: unknown) => unknown) => Promise.resolve(fin).then(resoudre),
		}
		return objet
	}
	const geste = (table: string, nom: string) => (charge?: unknown) => {
		const appel: Appel = { table, geste: nom, charge, filtres: [] }
		appels.push(appel)
		return chaine(appel)
	}
	const double = {
		from: (table: string) => ({
			select: (colonnes: string) => {
				const appel: Appel = { table, geste: 'select', filtres: [], select: colonnes }
				appels.push(appel)
				return chaine(appel)
			},
			update: geste(table, 'update'),
			insert: geste(table, 'insert'),
			delete: geste(table, 'delete'),
		}),
	}
	return { appels, client: double as unknown as ClientCrm }
}

describe('les lectures et écritures émises', () => {
	it('lit les points de l’affaire par la requête exportée, aux relations nommées par leur contrainte', async () => {
		const { appels, client: c } = client({ data: [point({ id: 'r1' })] })
		const etat = await lireChecklist(c, 'card-1', RATTACHEMENT, RELANCE)
		expect(appels[0]).toMatchObject({ table: 'card_checklist_items', select: COLONNES_POINT_CHECKLIST, filtres: ['card_id=card-1'] })
		expect(COLONNES_POINT_CHECKLIST).toContain('profiles!card_checklist_items_checked_by_fkey')
		expect(COLONNES_POINT_CHECKLIST).toContain('workflow_steps!workflow_transitions_to_step_fkey')
		expect(etat.statut === 'pret' && etat.donnees.total).toBe(1)
	})

	it('rend une erreur classée quand la lecture échoue', async () => {
		const { client: c } = client({ error: { message: 'jwt expired' }, status: 401 })
		const etat = await lireChecklist(c, 'card-1', RATTACHEMENT, RELANCE)
		expect(etat).toMatchObject({ statut: 'erreur', erreur: { nature: 'forbidden' } })
	})

	it('coche en n’envoyant que `checked` ; zéro ligne rendue est un refus « sans effet »', async () => {
		const ok = client({ data: [{ id: 'p' }] })
		expect(await cocherPoint(ok.client, 'p', true)).toEqual({ statut: 'applique' })
		expect(ok.appels[0]).toMatchObject({ geste: 'update', charge: { checked: true }, filtres: ['id=p'] })
		const filtre = client({ data: [] })
		expect(await cocherPoint(filtre.client, 'p', false)).toEqual({ statut: 'refus', nature: 'sans-effet' })
	})

	it('ajoute un point libre sans rattachement ni origine, au libellé débarrassé de ses blancs', async () => {
		const { appels, client: c } = client({ data: [{ id: 'neuf' }], status: 201 })
		expect(await ajouterPointLibre(c, 'card-1', 'espace-1', '  Rappeler le client  ', 3)).toEqual({ statut: 'applique' })
		expect(appels[0]).toMatchObject({
			geste: 'insert',
			charge: { card_id: 'card-1', workspace_id: 'espace-1', label: 'Rappeler le client', position: 3 },
		})
		expect(appels[0]?.charge).not.toHaveProperty('placement_id')
		const refus = client({ error: { code: '23514', message: 'card_checklist_items_label_check' }, status: 400 })
		expect(await ajouterPointLibre(refus.client, 'card-1', 'espace-1', 'x', 1)).toEqual({ statut: 'refus', nature: 'libelle' })
	})

	it('retire un point par son identifiant, et dit un retrait filtré par la politique', async () => {
		const ok = client({ data: [{ id: 'l1' }] })
		expect(await retirerPointLibre(ok.client, 'l1')).toEqual({ statut: 'applique' })
		expect(ok.appels[0]).toMatchObject({ geste: 'delete', filtres: ['id=l1'] })
		const filtre = client({ data: [] })
		expect(await retirerPointLibre(filtre.client, 'r1')).toEqual({ statut: 'refus', nature: 'sans-effet' })
	})
})
