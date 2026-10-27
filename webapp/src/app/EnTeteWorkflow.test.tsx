// @verifies CRM-118 (docs/BACKLOG.md) — tranche T1.b : l'en-tête du workflow choisi, monté pour de vrai — ses pilules,
//           ses commandes rendues selon la ligne, ses formulaires dans le flux, ses refus traduits
// @verifies docs/SPEC-workflow-engine.md §7 quinquies.2 ; docs/DESIGN_SYSTEM.md §5.72 (cinq commandes dans cet ordre, une
//           commande vouée au refus non rendue, « Renommer » désactivé sur champ blanc, la confirmation d'archivage, le
//           refus qui nomme son recours), §5.59 (commandes éteintes avec le motif)

import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EnTeteWorkflow, type OuvertureEnTete } from './EnTeteWorkflow'
import { FournisseurRefus } from '../components/ui/RefusCommandes'
import { fr } from '../i18n'
import type { WorkflowAdministrable } from '../lib/administration-workflows'
import type { ClientCrm } from '../lib/supabase'

afterEach(cleanup)

const GLOBAL: WorkflowAdministrable = {
	id: 'wf-1',
	workspace_id: 'ws',
	name: 'Cycle commercial',
	scope: 'global',
	track_id: null,
	is_default: false,
	archived_at: null,
}

type Reponse = { data?: unknown; error?: { code?: string; message: string } | null; status?: number }
type Appel = { geste: string; charge?: unknown; filtres: string[] }

function clientDouble(reponse: Reponse = { data: [{ id: 'wf-1' }] }) {
	const appels: Appel[] = []
	const resolu = () => Promise.resolve({ data: reponse.data ?? null, error: reponse.error ?? null, status: reponse.status ?? 200 })
	const chaine = (trace: Appel) => {
		const objet: Record<string, unknown> = {
			eq: (colonne: string, valeur: string) => {
				trace.filtres.push(`${colonne}=${valeur}`)
				return objet
			},
			select: () => objet,
			then: (resoudre: (valeur: unknown) => unknown) => resolu().then(resoudre),
		}
		return objet
	}
	const client = {
		from: () => ({
			update: (charge: unknown) => {
				const trace: Appel = { geste: 'update', charge, filtres: [] }
				appels.push(trace)
				return chaine(trace)
			},
		}),
		rpc: (nom: string, charge: unknown) => {
			appels.push({ geste: nom, charge, filtres: [] })
			return resolu()
		},
	} as unknown as ClientCrm
	return { client, appels }
}

function Hote({
	client,
	workflow = GLOBAL,
	onApplique = () => {},
}: {
	readonly client: ClientCrm
	readonly workflow?: WorkflowAdministrable
	readonly onApplique?: (annonce: string, id?: string) => void
}) {
	const [ouverture, setOuverture] = useState<OuvertureEnTete>(null)
	return (
		<EnTeteWorkflow
			client={client}
			workflow={workflow}
			tracks={{ statut: 'pret', donnees: [{ id: 'tr-1', name: 'Conseil & IA' }] }}
			ouverture={ouverture}
			onOuvrir={setOuverture}
			onApplique={onApplique}
		/>
	)
}

const commandes = () =>
	screen.getAllByRole('button').map((bouton) => bouton.textContent)

describe('l’en-tête du workflow choisi', () => {
	it('rend le nom en titre, ses pilules, et les cinq commandes dans l’ordre — quatre visibles à la fois', () => {
		render(<Hote client={clientDouble().client} />)
		expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Cycle commercial')
		expect(screen.getByTestId('entete-workflow').textContent).toContain(fr['admin.workflows.scope.global'])
		expect(commandes()).toEqual([
			fr['admin.workflows.header.rename'],
			fr['admin.workflows.header.default'],
			fr['admin.workflows.header.copy'],
			fr['admin.workflows.header.archive'],
		])
	})

	it('ne rend pas une commande vouée au refus : ni défaut ni copie pour un workflow de track, « Rétablir » sur un archivé', () => {
		const { unmount } = render(
			<Hote client={clientDouble().client} workflow={{ ...GLOBAL, scope: 'track', track_id: 'tr-1' }} />,
		)
		// La pilule nomme le track.
		expect(screen.getByTestId('entete-workflow').textContent).toContain('Conseil & IA')
		expect(commandes()).toEqual([fr['admin.workflows.header.rename'], fr['admin.workflows.header.archive']])
		unmount()
		render(<Hote client={clientDouble().client} workflow={{ ...GLOBAL, archived_at: '2026-10-27T10:00:00Z' }} />)
		expect(commandes()).toEqual([fr['admin.workflows.header.rename'], fr['admin.workflows.header.restore']])
		expect(screen.getByTestId('entete-workflow').textContent).toContain(fr['admin.workflows.archived'])
	})

	it('le défaut porte sa pilule et n’offre plus « Définir par défaut »', () => {
		render(<Hote client={clientDouble().client} workflow={{ ...GLOBAL, is_default: true }} />)
		expect(screen.getByTestId('entete-workflow').textContent).toContain(fr['admin.workflows.default'])
		expect(screen.queryByRole('button', { name: 'Définir le workflow Cycle commercial par défaut' })).toBeNull()
	})

	it('renomme : le champ prérempli prend le focus, « Enregistrer » s’éteint sur un champ blanc, le nom part trimé', async () => {
		const double = clientDouble()
		const onApplique = vi.fn()
		render(<Hote client={double.client} onApplique={onApplique} />)
		await userEvent.click(screen.getByRole('button', { name: 'Renommer le workflow Cycle commercial' }))
		const champ = screen.getByLabelText(fr['admin.workflows.header.rename.field']) as HTMLInputElement
		expect(document.activeElement).toBe(champ)
		expect(champ.value).toBe('Cycle commercial')
		await userEvent.clear(champ)
		await userEvent.type(champ, '   ')
		expect((screen.getByRole('button', { name: fr['admin.action.save'] }) as HTMLButtonElement).disabled).toBe(true)
		await userEvent.clear(champ)
		await userEvent.type(champ, '  Cycle long  {Enter}')
		expect(double.appels[0]).toMatchObject({ geste: 'update', charge: { name: 'Cycle long' }, filtres: ['id=wf-1'] })
		expect(onApplique).toHaveBeenCalledWith('Le workflow s’appelle désormais « Cycle long ».')
		expect(screen.queryByLabelText(fr['admin.workflows.header.rename.field'])).toBeNull()
	})

	it('définit par défaut par la fonction atomique, sans confirmation', async () => {
		const double = clientDouble({ data: { id: 'wf-1', is_default: true } })
		const onApplique = vi.fn()
		render(<Hote client={double.client} onApplique={onApplique} />)
		await userEvent.click(screen.getByRole('button', { name: 'Définir le workflow Cycle commercial par défaut' }))
		expect(double.appels[0]).toMatchObject({ geste: 'set_default_workflow', charge: { p_workflow: 'wf-1' } })
		expect(onApplique).toHaveBeenCalledWith('Le workflow « Cycle commercial » est désormais le workflow par défaut.')
	})

	it('copie vers un track : « Copier » s’éteint sans track, la copie devient le workflow choisi', async () => {
		const double = clientDouble({ data: 'wf-copie' })
		const onApplique = vi.fn()
		render(<Hote client={double.client} onApplique={onApplique} />)
		await userEvent.click(screen.getByRole('button', { name: 'Copier le workflow Cycle commercial vers un track' }))
		const track = screen.getByLabelText(fr['admin.workflows.header.copy.track'])
		expect(document.activeElement).toBe(track)
		const copier = screen.getByRole('button', { name: fr['admin.workflows.header.copy.submit'] }) as HTMLButtonElement
		expect(copier.disabled).toBe(true)
		await userEvent.selectOptions(track, 'tr-1')
		await userEvent.click(copier)
		expect(double.appels[0]).toMatchObject({
			geste: 'copy_workflow_to_track',
			charge: { workflow_id: 'wf-1', track_id: 'tr-1', new_name: 'Cycle commercial' },
		})
		expect(onApplique).toHaveBeenCalledWith('La copie de « Cycle commercial » est créée, et c’est elle qui est ouverte.', 'wf-copie')
	})

	it('archive après confirmation ; le refus d’un workflow employé nomme les channels et l’arborescence', async () => {
		const double = clientDouble({ error: { code: 'P0001', message: 'workflow_in_use : 3 channel(s)' }, status: 400 })
		render(<Hote client={double.client} />)
		await userEvent.click(screen.getByRole('button', { name: 'Archiver le workflow Cycle commercial' }))
		expect(screen.getByTestId('entete-workflow-archivage').textContent).toContain('Archiver le workflow « Cycle commercial » ?')
		const confirmer = screen.getByRole('button', { name: fr['admin.workflows.header.archive.confirm.action'] })
		expect(document.activeElement).toBe(confirmer)
		await userEvent.click(confirmer)
		expect(double.appels[0]).toMatchObject({ geste: 'update', filtres: ['id=wf-1'] })
		expect((double.appels[0]!.charge as { archived_at: string | null }).archived_at).not.toBeNull()
		expect((await screen.findByRole('alert')).textContent).toBe(
			'3 channels emploient encore ce workflow : changez-leur de workflow depuis l’arborescence d’abord.',
		)
		// La confirmation reste ouverte sur son refus ; Échap la referme.
		await userEvent.keyboard('{Escape}')
		expect(screen.queryByTestId('entete-workflow-archivage')).toBeNull()
	})

	it('rétablit sans confirmation ; un refus sans formulaire se lit sous l’en-tête', async () => {
		const double = clientDouble({ data: [] })
		render(<Hote client={double.client} workflow={{ ...GLOBAL, archived_at: '2026-10-27T10:00:00Z' }} />)
		await userEvent.click(screen.getByRole('button', { name: 'Rétablir le workflow Cycle commercial' }))
		expect(double.appels[0]).toMatchObject({ geste: 'update', charge: { archived_at: null } })
		expect((await screen.findByRole('alert')).textContent).toBe(fr['admin.workflows.header.refus.sans-effet'])
	})

	it('suit la capacité de l’espace : refusée, les commandes restent montées, éteintes, et citent le motif', () => {
		render(
			<FournisseurRefus valeur={{ disabled: true, 'aria-describedby': 'motif' }}>
				<Hote client={clientDouble().client} />
			</FournisseurRefus>,
		)
		for (const bouton of screen.getAllByRole('button')) {
			expect((bouton as HTMLButtonElement).disabled).toBe(true)
			expect(bouton.getAttribute('aria-describedby')).toBe('motif')
		}
	})
})
