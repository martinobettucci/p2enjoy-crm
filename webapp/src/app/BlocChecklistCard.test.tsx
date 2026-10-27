// @verifies CRM-068 (docs/BACKLOG.md) — tranche T3b : l'arrivée par « Cocher ces points » — le bloc en vue, le focus sur
//           le premier point exigé non coché (docs/DESIGN_SYSTEM.md §5.7 quinquies, décision 759)
// @verifies CRM-068 (docs/BACKLOG.md) — tranche T3a : le bloc « Checklist » de la fiche, monté pour de vrai
// @verifies docs/SPEC-checklists.md §4 (la fiche : points d'étape groupés, points libres, compte, mention d'exigence) ;
//           docs/DESIGN_SYSTEM.md §5.70 (ce bloc), §5.31 bis (la case revient si la base refuse), §5.41 (retrait sans
//           confirmation, point libre seul), §5.50 (bouton désactivé sur champ blanc), §5.59 (commandes éteintes avec le
//           motif), §5.8 (états)

import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BlocChecklistCard, premierPointAReprendre } from './BlocChecklistCard'
import { FournisseurRefus } from '../components/ui/RefusCommandes'
import { fr } from '../i18n'
import { projeterChecklist, type PointLu } from '../lib/checklists'
import type { ClientCrm } from '../lib/supabase'

afterEach(cleanup)

const RATTACHEMENT = 'rattachement-1'
const RELANCE = 'etape-relance'

const relance = { position: 2, label_override: null, workflow_nodes_catalog: { label: 'Relance' } }

const POINT_ETAPE: PointLu = {
	id: 'r1',
	placement_id: RATTACHEMENT,
	step_item_id: 'origine-r1',
	label: 'Budget connu',
	position: 1,
	checked: false,
	checked_at: null,
	created_at: '2026-10-26T10:00:00+00:00',
	cocheur: null,
	origine: {
		step_id: RELANCE,
		etape: relance,
		exigences: [{ transition: { vers: { id: 'etape-negociation', position: 3, label_override: null, workflow_nodes_catalog: { label: 'Négociation' } } } }],
	},
}
const POINT_COCHE: PointLu = {
	...POINT_ETAPE,
	id: 'r2',
	step_item_id: 'origine-r2',
	label: 'Décideur identifié',
	position: 2,
	checked: true,
	checked_at: '2026-10-26T11:00:00+00:00',
	cocheur: { full_name: 'Driss Lemoine' },
	origine: { step_id: RELANCE, etape: relance, exigences: [] },
}
const POINT_LIBRE: PointLu = {
	...POINT_ETAPE,
	id: 'l1',
	placement_id: null,
	step_item_id: null,
	label: 'Envoyer les références',
	origine: null,
}

type Reponse = { data?: unknown; error?: { code?: string; message: string } | null; status?: number }

/** Un client dont les lectures se suivent (la dernière se répète) et qui note les écritures. */
function clientDouble({
	lectures = [[POINT_ETAPE, POINT_COCHE, POINT_LIBRE]] as readonly (readonly PointLu[])[],
	lectureEchoue = false,
	ecriture = { data: [{ id: 'x' }] } as Reponse,
} = {}) {
	const ecritures: { geste: string; charge?: unknown; filtres: string[] }[] = []
	let rang = 0
	const reponse = (r: Reponse) => ({ data: r.data ?? null, error: r.error ?? null, status: r.status ?? 200 })
	const chaine = (fin: () => Reponse, filtres: string[] = []) => {
		const objet: Record<string, unknown> = {
			eq: (colonne: string, valeur: string) => {
				filtres.push(`${colonne}=${valeur}`)
				return objet
			},
			select: () => objet,
			then: (resoudre: (valeur: unknown) => unknown) => Promise.resolve(reponse(fin())).then(resoudre),
		}
		return objet
	}
	const ecrire = (geste: string) => (charge?: unknown) => {
		const trace = { geste, charge, filtres: [] as string[] }
		ecritures.push(trace)
		return chaine(() => ecriture, trace.filtres)
	}
	const client = {
		from: () => ({
			select: () =>
				chaine(() => {
					rang += 1
					if (lectureEchoue) return { error: { message: 'boom' }, status: 500 }
					return { data: lectures[Math.min(rang, lectures.length) - 1] }
				}),
			update: ecrire('update'),
			insert: ecrire('insert'),
			delete: ecrire('delete'),
		}),
	}
	return { ecritures, client: client as unknown as ClientCrm, lectures: () => rang }
}

function monter(client: ClientCrm, onChange = vi.fn()) {
	render(
		<BlocChecklistCard
			client={client}
			idCard="card-1"
			idWorkspace="espace-1"
			idRattachement={RATTACHEMENT}
			idEtapeCourante={RELANCE}
			onChange={onChange}
		/>,
	)
	return onChange
}

describe('BlocChecklistCard — lecture', () => {
	it('groupe les points de l’étape et les points libres, compte, et dit qui a coché et ce qui est exigé', async () => {
		monter(clientDouble().client)
		expect((await screen.findByTestId('checklist-compte')).textContent).toContain('1 sur 3')
		const etape = screen.getByTestId('checklist-etape-courante')
		expect(within(etape).getByRole('heading', { level: 3 }).textContent).toContain('Étape Relance')
		expect(within(etape).getAllByTestId('checklist-point').map((li) => li.textContent)).toEqual([
			expect.stringContaining('Budget connu'),
			expect.stringContaining('Décideur identifié'),
		])
		expect(within(etape).getByTestId('checklist-exige').textContent).toContain('Exigé pour passer à Négociation')
		expect(within(etape).getByTestId('checklist-coche-par').textContent).toMatch(/^Coché par Driss Lemoine, le /)
		const libres = screen.getByTestId('checklist-libres')
		expect(within(libres).getByRole('heading', { level: 3 }).textContent).toContain('Points libres')
		// « Retirer » n'est offert qu'au point libre : la forme d'un point d'étape appartient à l'étape (§3.2).
		expect(screen.getAllByTestId('checklist-retirer')).toHaveLength(1)
		expect(within(libres).getByRole('button', { name: 'Retirer le point Envoyer les références' })).toBeTruthy()
	})

	it('dit le vide, sans compte, en gardant le champ d’ajout', async () => {
		monter(clientDouble({ lectures: [[]] }).client)
		expect((await screen.findByTestId('checklist-vide')).textContent).toContain(fr['checklist.empty'])
		expect(screen.queryByTestId('checklist-compte')).toBeNull()
		expect(screen.getByLabelText('Nouveau point')).toBeTruthy()
	})

	it('dit l’échec de lecture, et « Réessayer » relit', async () => {
		const double = clientDouble({ lectureEchoue: true })
		monter(double.client)
		expect((await screen.findByTestId('erreur-checklist')).textContent).toContain(fr['checklist.error.body'])
		await userEvent.click(screen.getByRole('button', { name: 'Réessayer' }))
		await waitFor(() => expect(double.lectures()).toBe(2))
	})
})

describe('BlocChecklistCard — gestes', () => {
	it('cocher envoie `checked`, relit le bloc et prévient la fiche', async () => {
		const double = clientDouble({ lectures: [[POINT_ETAPE], [{ ...POINT_ETAPE, checked: true, checked_at: '2026-10-26T12:00:00+00:00' }]] })
		const onChange = monter(double.client)
		const caseBudget = await screen.findByRole('checkbox', { name: 'Budget connu' })
		await userEvent.click(caseBudget)
		expect(double.ecritures[0]).toMatchObject({ geste: 'update', charge: { checked: true }, filtres: ['id=r1'] })
		await waitFor(() => expect(screen.getByTestId('checklist-compte').textContent).toContain('1 sur 1'))
		expect(onChange).toHaveBeenCalledTimes(1)
		expect(screen.getByRole('status', { name: fr['checklist.live.aria'] }).textContent).toContain('Point « Budget connu » coché')
	})

	it('un cochage refusé ramène la case et le dit sous la ligne, sans prévenir la fiche', async () => {
		const double = clientDouble({ lectures: [[POINT_ETAPE]], ecriture: { data: [] } })
		const onChange = monter(double.client)
		const caseBudget = await screen.findByRole('checkbox', { name: 'Budget connu' })
		await userEvent.click(caseBudget)
		expect((await screen.findByTestId('checklist-refus')).textContent).toContain(fr['checklist.refus.sans-effet'])
		expect((caseBudget as HTMLInputElement).checked).toBe(false)
		expect(onChange).not.toHaveBeenCalled()
	})

	it('ajoute un point libre par `Entrée` : bouton éteint sur champ blanc, champ vidé et focus gardé', async () => {
		const double = clientDouble({ lectures: [[POINT_LIBRE]] })
		monter(double.client)
		const champ = await screen.findByLabelText('Nouveau point')
		const bouton = screen.getByRole('button', { name: 'Ajouter' })
		expect((bouton as HTMLButtonElement).disabled).toBe(true)
		await userEvent.type(champ, '   ')
		expect((bouton as HTMLButtonElement).disabled).toBe(true)
		await userEvent.clear(champ)
		await userEvent.type(champ, 'Relancer la DAF{Enter}')
		expect(double.ecritures[0]).toMatchObject({
			geste: 'insert',
			charge: { card_id: 'card-1', workspace_id: 'espace-1', label: 'Relancer la DAF', position: 2 },
		})
		await waitFor(() => expect((champ as HTMLInputElement).value).toBe(''))
		expect(document.activeElement).toBe(champ)
	})

	it('un ajout refusé garde la saisie et dit le motif', async () => {
		const double = clientDouble({ lectures: [[]], ecriture: { error: { code: '42501', message: 'denied' }, status: 403 } })
		monter(double.client)
		const champ = await screen.findByLabelText('Nouveau point')
		await userEvent.type(champ, 'Interdit{Enter}')
		expect((await screen.findByTestId('checklist-refus-ajout')).textContent).toContain(fr['checklist.refus.forbidden'])
		expect((champ as HTMLInputElement).value).toBe('Interdit')
	})

	it('retire un point libre sans confirmation', async () => {
		const double = clientDouble({ lectures: [[POINT_LIBRE], []] })
		monter(double.client)
		await userEvent.click(await screen.findByRole('button', { name: 'Retirer le point Envoyer les références' }))
		expect(double.ecritures[0]).toMatchObject({ geste: 'delete', filtres: ['id=l1'] })
		expect(await screen.findByTestId('checklist-vide')).toBeTruthy()
	})

	it('affaire en lecture seule : cases, « Retirer » et l’ajout sont éteints et citent le motif', async () => {
		render(
			<FournisseurRefus valeur={{ disabled: true, 'aria-describedby': 'motif-fiche' }}>
				<BlocChecklistCard
					client={clientDouble().client}
					idCard="card-1"
					idWorkspace="espace-1"
					idRattachement={RATTACHEMENT}
					idEtapeCourante={RELANCE}
				/>
			</FournisseurRefus>,
		)
		const caseBudget = await screen.findByRole('checkbox', { name: 'Budget connu' })
		expect((caseBudget as HTMLButtonElement).disabled).toBe(true)
		expect(caseBudget.getAttribute('aria-describedby')).toContain('motif-fiche')
		expect((screen.getByTestId('checklist-retirer') as HTMLButtonElement).disabled).toBe(true)
		expect((screen.getByLabelText('Nouveau point') as HTMLButtonElement).disabled).toBe(true)
		expect(screen.getByRole('button', { name: 'Ajouter' }).getAttribute('aria-describedby')).toBe('motif-fiche')
	})
})

describe('BlocChecklistCard — l’arrivée par « Cocher ces points » (CRM-068 T3b)', () => {
	it('choisit le premier point exigé non coché de l’étape courante, sinon le premier non coché', () => {
		const vue = projeterChecklist([POINT_COCHE, POINT_ETAPE, POINT_LIBRE], RATTACHEMENT, RELANCE)
		expect(premierPointAReprendre(vue)).toBe('r1')
		const sansExigence = projeterChecklist(
			[{ ...POINT_ETAPE, origine: { step_id: RELANCE, etape: relance, exigences: [] } }],
			RATTACHEMENT,
			RELANCE,
		)
		expect(premierPointAReprendre(sansExigence)).toBe('r1')
		expect(premierPointAReprendre(projeterChecklist([POINT_COCHE], RATTACHEMENT, RELANCE))).toBeNull()
	})

	it('avec l’ancre #checklist, amène le bloc en vue et donne le focus à la case du point exigé', async () => {
		const defiler = vi.fn()
		Element.prototype.scrollIntoView = defiler
		window.history.replaceState(null, '', '#checklist')
		try {
			monter(clientDouble().client)
			const caseBudget = await screen.findByRole('checkbox', { name: 'Budget connu' })
			await waitFor(() => expect(document.activeElement).toBe(caseBudget))
			expect(defiler).toHaveBeenCalledTimes(1)
			expect(screen.getByTestId('bloc-checklist-card').id).toBe('checklist')
		} finally {
			window.history.replaceState(null, '', window.location.pathname)
		}
	})

	it('sans l’ancre, la fiche ne prend pas la main', async () => {
		const defiler = vi.fn()
		Element.prototype.scrollIntoView = defiler
		monter(clientDouble().client)
		await screen.findByRole('checkbox', { name: 'Budget connu' })
		expect(defiler).not.toHaveBeenCalled()
		expect(document.activeElement).toBe(document.body)
	})
})
