// @verifies CRM-068 (docs/BACKLOG.md) — tranche T3b : les checklists dans l'éditeur de workflows, hors navigateur
// @verifies docs/SPEC-checklists.md §3.1 (points d'une étape, archivés à leur place), §3.4 (une exigence ne porte que sur
//           un point de l'étape de départ ; un point archivé reste exigé), §4 (décision 759) ;
//           docs/DESIGN_SYSTEM.md §5.70 bis (ordre, sélecteur « Exiger un point »)

import { describe, expect, it } from 'vitest'
import {
	COLONNES_EXIGENCE_POINT,
	ajouterPointEtape,
	archiverPointEtape,
	classerRefusChecklistsWorkflow,
	deplacementPoint,
	exigerPoint,
	lireChecklistsWorkflow,
	nePlusExigerPoint,
	placerPointEtape,
	pointsDeLEtape,
	pointsExigeables,
	pointsExiges,
	positionNouveauPoint,
	renommerPointEtape,
	type ChecklistsWorkflow,
	type PointEtape,
} from './administration-checklists'
import type { ClientCrm } from './supabase'

const PROSPECTION = 'etape-prospection'
const RELANCE = 'etape-relance'

function point(partiel: Partial<PointEtape> & { id: string }): PointEtape {
	return {
		step_id: PROSPECTION,
		label: `Point ${partiel.id}`,
		position: 1,
		archived_at: null,
		created_at: '2026-10-27T08:00:00+00:00',
		...partiel,
	}
}

const POINTS: readonly PointEtape[] = [
	point({ id: 'b', position: 2 }),
	point({ id: 'a', position: 1 }),
	point({ id: 'c', position: 3, archived_at: '2026-10-27T09:00:00+00:00' }),
	point({ id: 'r', step_id: RELANCE, position: 1 }),
]

describe('les points d’une étape et leurs exigences', () => {
	it('ordonne les points d’une étape, archivés compris à leur place', () => {
		expect(pointsDeLEtape(POINTS, PROSPECTION).map((p) => p.id)).toEqual(['a', 'b', 'c'])
		expect(pointsDeLEtape(POINTS, RELANCE).map((p) => p.id)).toEqual(['r'])
	})

	it('« Exiger un point » ne propose que les points non archivés de l’étape de départ, pas encore exigés', () => {
		const checklists: ChecklistsWorkflow = { points: POINTS, exigences: [{ idTransition: 't1', idPoint: 'a' }] }
		expect(pointsExigeables(checklists, 't1', PROSPECTION).map((p) => p.id)).toEqual(['b'])
		expect(pointsExigeables(checklists, 't2', PROSPECTION).map((p) => p.id)).toEqual(['a', 'b'])
		expect(pointsExigeables(checklists, 't3', 'etape-vide')).toEqual([])
	})

	it('un point archivé encore exigé reste listé parmi les exigés (§3.4)', () => {
		const checklists: ChecklistsWorkflow = {
			points: POINTS,
			exigences: [
				{ idTransition: 't1', idPoint: 'c' },
				{ idTransition: 't1', idPoint: 'a' },
				{ idTransition: 't2', idPoint: 'b' },
			],
		}
		expect(pointsExiges(checklists, 't1', PROSPECTION).map((p) => p.id)).toEqual(['a', 'c'])
	})

	it('place un nouveau point après le dernier de l’étape, archivé compris ; à 1 dans une étape vide', () => {
		expect(positionNouveauPoint(POINTS, PROSPECTION)).toBe(4)
		expect(positionNouveauPoint(POINTS, 'etape-vide')).toBe(1)
	})

	it('déplace parmi les points non archivés : extrémités impossibles, milieu calculé', () => {
		const [a, b] = [POINTS[1]!, POINTS[0]!]
		expect(deplacementPoint(POINTS, a, 'monter')).toEqual({ statut: 'impossible', cause: 'extremite' })
		expect(deplacementPoint(POINTS, b, 'descendre')).toEqual({ statut: 'impossible', cause: 'extremite' })
		expect(deplacementPoint(POINTS, b, 'monter')).toEqual({ statut: 'calcule', position: 0.5 })
		expect(deplacementPoint(POINTS, a, 'descendre')).toEqual({ statut: 'calcule', position: 3 })
	})
})

describe('classerRefusChecklistsWorkflow — le dictionnaire fermé', () => {
	it('nomme chaque refus par son code, jamais par la prose du serveur', () => {
		expect(classerRefusChecklistsWorkflow(400, '23514', 'violates "workflow_step_checklist_items_label_check"')).toBe('libelle')
		expect(classerRefusChecklistsWorkflow(400, '22023', 'checklist_item_not_from_source_step')).toBe('hors-etape')
		expect(classerRefusChecklistsWorkflow(409, '23505', 'duplicate key')).toBe('deja-exige')
		expect(classerRefusChecklistsWorkflow(403, '42501', 'permission denied')).toBe('forbidden')
		expect(classerRefusChecklistsWorkflow(undefined, undefined, 'Failed to fetch')).toBe('network')
		expect(classerRefusChecklistsWorkflow(400, '22023', 'autre')).toBe('unknown')
	})
})

type Appel = { table: string; geste: string; charge?: unknown; filtres: string[]; select?: string }

function client(reponses: readonly { data?: unknown; error?: { code?: string; message: string } | null; status?: number }[]) {
	const appels: Appel[] = []
	let rang = 0
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
			then: (resoudre: (valeur: unknown) => unknown) => {
				const r = reponses[Math.min(rang++, reponses.length - 1)]!
				return Promise.resolve({ data: r.data ?? null, error: r.error ?? null, status: r.status ?? 200 }).then(resoudre)
			},
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
			insert: geste(table, 'insert'),
			update: geste(table, 'update'),
			delete: geste(table, 'delete'),
		}),
	}
	return { appels, client: double as unknown as ClientCrm }
}

describe('les lectures et écritures émises', () => {
	it('lit les points et les exigences du workflow, l’exigence bornée par son arête', async () => {
		const { appels, client: c } = client([
			{ data: [POINTS[0]] },
			{ data: [{ transition_id: 't1', step_item_id: 'b' }] },
		])
		const etat = await lireChecklistsWorkflow(c, 'wf-1')
		expect(appels.map((a) => [a.table, a.filtres])).toEqual([
			['workflow_step_checklist_items', ['workflow_id=wf-1']],
			['workflow_transition_required_checklist_items', ['transition.workflow_id=wf-1']],
		])
		expect(appels[1]?.select).toBe(COLONNES_EXIGENCE_POINT)
		expect(etat).toEqual({ statut: 'pret', donnees: { points: [POINTS[0]], exigences: [{ idTransition: 't1', idPoint: 'b' }] } })
	})

	it('ajoute un point avec son espace, son workflow, son étape et sa position ; le libellé sans blancs', async () => {
		const { appels, client: c } = client([{ data: [{ id: 'neuf' }], status: 201 }])
		const issue = await ajouterPointEtape(c, { idWorkspace: 'ws', idWorkflow: 'wf', idEtape: PROSPECTION }, '  Budget connu ', 4)
		expect(issue).toEqual({ statut: 'applique' })
		expect(appels[0]?.charge).toEqual({ workspace_id: 'ws', workflow_id: 'wf', step_id: PROSPECTION, label: 'Budget connu', position: 4 })
	})

	it('renomme, place, archive et désarchive par l’identifiant du point', async () => {
		const { appels, client: c } = client([{ data: [{ id: 'a' }] }])
		await renommerPointEtape(c, 'a', ' Neuf ')
		await placerPointEtape(c, 'a', 0.5)
		await archiverPointEtape(c, 'a', true, () => '2026-10-27T10:00:00Z')
		await archiverPointEtape(c, 'a', false)
		expect(appels.map((a) => a.charge)).toEqual([
			{ label: 'Neuf' },
			{ position: 0.5 },
			{ archived_at: '2026-10-27T10:00:00Z' },
			{ archived_at: null },
		])
		expect(appels.every((a) => a.filtres[0] === 'id=a')).toBe(true)
	})

	it('exige et n’exige plus par le couple (transition, point) ; zéro ligne est « sans effet »', async () => {
		const ok = client([{ data: [{ transition_id: 't1' }], status: 201 }])
		expect(await exigerPoint(ok.client, 't1', 'b')).toEqual({ statut: 'applique' })
		expect(ok.appels[0]?.charge).toEqual({ transition_id: 't1', step_item_id: 'b' })
		const filtre = client([{ data: [] }])
		expect(await nePlusExigerPoint(filtre.client, 't1', 'b')).toEqual({ statut: 'refus', nature: 'sans-effet' })
		expect(filtre.appels[0]?.filtres).toEqual(['transition_id=t1', 'step_item_id=b'])
		const refus = client([{ error: { code: '22023', message: 'checklist_item_not_from_source_step' }, status: 400 }])
		expect(await exigerPoint(refus.client, 't1', 'r')).toEqual({ statut: 'refus', nature: 'hors-etape' })
	})
})
