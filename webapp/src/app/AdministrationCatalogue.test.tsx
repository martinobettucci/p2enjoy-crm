// @verifies CRM-094 (docs/BACKLOG.md) tranche T2 — docs/SPEC-onboarding.md §10.3 : le catalogue de nœuds se
//           relit au signal du workflow de départ, qui pose ses sept nœuds (docs/SPEC-workflow-engine.md
//           §7 quater) ; docs/JOURNAL.md décision 607
// @verifies CRM-030 (docs/BACKLOG.md) — docs/SPEC-workflow-engine.md §2 bis.1 (l'écran du catalogue),
//           docs/DESIGN_SYSTEM.md §5.18 (la liste plate, l'état vide)
//
// Ce fichier ne reprend PAS les preuves de `CRM-030` : l'écran est éprouvé par ses modules
// (`administration-catalogue.test.ts`) et par son parcours connecté (`e2e/ui/`). Il porte la seule
// chose que `CRM-094` ajoute à l'écran — se relire quand le workflow de départ est posé depuis le guide
// flottant, PAR-DESSUS lui —, avec le patron des autres surfaces d'administration : le vrai écran, un
// client factice qui compte ses lectures.

import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { AdministrationCatalogue } from './AdministrationCatalogue'
import { EVENEMENT_WORKFLOW_DEPART } from '../lib/demarrage'
import type { ClientCrm } from '../lib/supabase'

afterEach(cleanup)

const WORKSPACE = { id: 'ws-1', name: 'Espace neuf', slug: 'espace-neuf' }

const PROSPECTION = {
	id: 'n-1',
	workspace_id: 'ws-1',
	key: 'prospection',
	label: 'Prospection',
	kind: 'open',
	color: 'neutral',
	default_probability: 10,
	default_stale_after_days: 14,
	position: 1,
	archived_at: null,
}

/**
 * Client factice : `workspaces` puis `workflow_nodes_catalog`, les deux lectures de l'écran. Les nœuds
 * sont lus PAR RÉFÉRENCE à chaque requête : remplir le tableau simule la base après le geste.
 */
function clientFactice(noeuds: unknown[]): { client: ClientCrm; lectures: string[] } {
	const lectures: string[] = []
	const lecture = (data: unknown[]) => {
		const chaine: Record<string, unknown> = {}
		chaine['order'] = () => chaine
		chaine['then'] = (resoudre: (valeur: unknown) => unknown) =>
			Promise.resolve({ data: [...data], error: null, status: 200 }).then(resoudre)
		return chaine
	}
	const client = {
		from: (table: string) => ({
			select: () => {
				lectures.push(table)
				return lecture(table === 'workspaces' ? [WORKSPACE] : noeuds)
			},
		}),
	} as unknown as ClientCrm
	return { client, lectures }
}

describe('le signal du workflow de départ (CRM-094, docs/SPEC-onboarding.md §10.3)', () => {
	it('relit le catalogue quand le workflow de départ est posé depuis le guide : ses nœuds paraissent', async () => {
		const noeuds: unknown[] = []
		const { client, lectures } = clientFactice(noeuds)
		render(<AdministrationCatalogue client={client} />)
		// L'état d'un espace neuf, mesuré en production le 2026-09-28 : aucun nœud.
		expect(await screen.findByText('Aucun nœud dans ce catalogue')).toBeTruthy()
		const avant = lectures.filter((table) => table === 'workflow_nodes_catalog').length

		noeuds.push(PROSPECTION)
		act(() => {
			globalThis.dispatchEvent(new Event(EVENEMENT_WORKFLOW_DEPART))
		})

		expect(await screen.findByTestId('ligne-noeud')).toBeTruthy()
		expect(screen.getByTestId('liste-catalogue').textContent).toContain('Prospection')
		expect(lectures.filter((table) => table === 'workflow_nodes_catalog').length).toBe(avant + 1)
	})

	it('démonté, il lâche le signal : aucune lecture ne part d’un écran quitté', async () => {
		const { client, lectures } = clientFactice([PROSPECTION])
		const { unmount } = render(<AdministrationCatalogue client={client} />)
		await screen.findByTestId('ligne-noeud')
		unmount()
		const avant = lectures.length
		act(() => {
			globalThis.dispatchEvent(new Event(EVENEMENT_WORKFLOW_DEPART))
		})
		expect(lectures.length).toBe(avant)
	})
})
