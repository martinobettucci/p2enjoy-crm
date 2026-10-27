// @verifies CRM-118 (docs/BACKLOG.md) — tranche T1.b : le panneau « Changer de workflow », monté pour de vrai — ses
//           lectures, une destination par étape occupée sans rien deviner, la perte consentie, les refus traduits
// @verifies docs/SPEC-workflow-engine.md §7 quinquies.3 ; docs/SPEC-change-channel-workflow.md §2, §3, §5 ;
//           docs/DESIGN_SYSTEM.md §5.72 (le titre nomme le workflow courant, « 3 affaires », le bouton désactivé tant
//           qu'un choix manque, la case de perte décochée qui garde le bouton éteint, Échap), §5.59

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PanneauChangementWorkflow, type ChannelAChanger } from './PanneauChangementWorkflow'
import { FournisseurRefus } from '../components/ui/RefusCommandes'
import { fr } from '../i18n'
import type { ClientCrm } from '../lib/supabase'

afterEach(cleanup)

const CHANNEL: ChannelAChanger = {
	id: 'ch-1',
	name: 'Grands comptes',
	workspace_id: 'ws',
	track_id: 'tr-1',
	workflow_id: 'wf-courant',
}

type Reponse = { data: unknown; error: { code?: string; message: string; details?: string } | null; status: number }
const ok = (data: unknown): Reponse => ({ data, error: null, status: 200 })

/**
 * Un client qui répond par table, et par appel pour la fonction : chaque `rpc` consomme la réponse suivante.
 * `workflows` sert deux lectures — le nom du courant (`maybeSingle`) et les cibles (une liste).
 */
function clientDouble(rpc: Reponse[], placements: unknown[] = PLACEMENTS) {
	const appelsRpc: { nom: string; charge: unknown }[] = []
	const client = {
		from: (table: string) => {
			let unique = false
			const reponse = (): Reponse => {
				if (table === 'card_placements') return ok(placements)
				if (table === 'workflow_steps') return ok(ETAPES_CIBLES)
				if (table === 'workflows') return unique ? ok({ name: 'Cycle court' }) : ok(CIBLES)
				return ok([])
			}
			const objet: Record<string, unknown> = {}
			for (const methode of ['select', 'eq', 'is', 'neq', 'or', 'order']) objet[methode] = () => objet
			objet.maybeSingle = () => {
				unique = true
				return objet
			}
			objet.then = (resoudre: (valeur: unknown) => unknown) => Promise.resolve(reponse()).then(resoudre)
			return objet
		},
		rpc: (nom: string, charge: unknown) => {
			appelsRpc.push({ nom, charge })
			return Promise.resolve(rpc.shift() ?? ok([]))
		},
	} as unknown as ClientCrm
	return { client, appelsRpc }
}

const PLACEMENTS = [
	{ current_step_id: 'e-relance', etape: { label_override: null, noeud: { label: 'Relance' } } },
	{ current_step_id: 'e-relance', etape: { label_override: null, noeud: { label: 'Relance' } } },
	{ current_step_id: 'e-contact', etape: { label_override: 'Premier contact', noeud: { label: 'Prospection' } } },
]
const CIBLES = [{ id: 'wf-long', name: 'Cycle long', is_default: false }]
const ETAPES_CIBLES = [
	{ id: 'c-qualif', label_override: null, noeud: { label: 'Qualification' } },
	{ id: 'c-offre', label_override: null, noeud: { label: 'Offre' } },
]

const bouton = () => screen.getByRole('button', { name: fr['admin.tree.workflowChange.submit'] }) as HTMLButtonElement

async function choisirTout() {
	await userEvent.selectOptions(screen.getByLabelText(fr['admin.tree.workflowChange.workflow']), 'wf-long')
	await screen.findAllByRole('option', { name: 'Offre' })
	await userEvent.selectOptions(screen.getByLabelText(/des affaires de « Relance »/), 'c-offre')
	await userEvent.selectOptions(screen.getByLabelText(/des affaires de « Premier contact »/), 'c-qualif')
}

describe('le panneau « Changer de workflow »', () => {
	it('nomme le channel et son workflow, liste les étapes occupées avec leur compte, focus dans « Nouveau workflow »', async () => {
		render(<PanneauChangementWorkflow client={clientDouble([]).client} channel={CHANNEL} onAnnuler={() => {}} onApplique={() => {}} />)
		expect(await screen.findByText('Changer de workflow — « Grands comptes » suit aujourd’hui « Cycle court »')).toBeTruthy()
		const choix = screen.getByLabelText(fr['admin.tree.workflowChange.workflow'])
		expect(document.activeElement).toBe(choix)
		expect(screen.getByText('2 affaires')).toBeTruthy()
		expect(screen.getByText('1 affaire')).toBeTruthy()
		expect(bouton().disabled).toBe(true)
	})

	it('ne devine aucune destination : le bouton reste éteint tant qu’une étape n’a pas la sienne', async () => {
		render(<PanneauChangementWorkflow client={clientDouble([]).client} channel={CHANNEL} onAnnuler={() => {}} onApplique={() => {}} />)
		await userEvent.selectOptions(await screen.findByLabelText(fr['admin.tree.workflowChange.workflow']), 'wf-long')
		await screen.findAllByRole('option', { name: 'Offre' })
		const relance = screen.getByLabelText(/des affaires de « Relance »/) as HTMLSelectElement
		expect(relance.value).toBe('')
		await userEvent.selectOptions(relance, 'c-offre')
		expect(bouton().disabled).toBe(true)
		await userEvent.selectOptions(screen.getByLabelText(/des affaires de « Premier contact »/), 'c-qualif')
		expect(bouton().disabled).toBe(false)
	})

	it('un channel sans affaire le dit, et se change dès le workflow choisi', async () => {
		const double = clientDouble([ok([])], [])
		const onApplique = vi.fn()
		render(<PanneauChangementWorkflow client={double.client} channel={CHANNEL} onAnnuler={() => {}} onApplique={onApplique} />)
		expect(await screen.findByText(fr['admin.tree.workflowChange.mapping.empty'])).toBeTruthy()
		await userEvent.selectOptions(screen.getByLabelText(fr['admin.tree.workflowChange.workflow']), 'wf-long')
		await waitFor(() => expect(bouton().disabled).toBe(false))
		await userEvent.click(bouton())
		expect(double.appelsRpc[0]).toEqual({
			nom: 'change_channel_workflow',
			charge: { channel_id: 'ch-1', workflow_id: 'wf-long', step_mapping: [], discard_field_values: false },
		})
		expect(onApplique).toHaveBeenCalledWith('Cycle long')
	})

	it('la perte des réponses est consentie : la case décochée garde le bouton éteint, cochée le même envoi repart', async () => {
		const double = clientDouble([
			{ data: null, error: { code: 'P0001', message: 'field_values_would_be_lost', details: '4 réponse(s) de formulaire seraient perdues.' }, status: 400 },
			ok([{ id: 'card' }]),
		])
		const onApplique = vi.fn()
		render(<PanneauChangementWorkflow client={double.client} channel={CHANNEL} onAnnuler={() => {}} onApplique={onApplique} />)
		await screen.findByLabelText(fr['admin.tree.workflowChange.workflow'])
		await choisirTout()
		await userEvent.click(bouton())
		expect(double.appelsRpc[0]!.charge).toMatchObject({
			step_mapping: [
				{ from_step_id: 'e-contact', to_step_id: 'c-qualif' },
				{ from_step_id: 'e-relance', to_step_id: 'c-offre' },
			],
			discard_field_values: false,
		})
		expect((await screen.findByTestId('changement-workflow-perte')).textContent).toContain(
			'4 réponses de formulaire seraient perdues',
		)
		const case_ = screen.getByLabelText(fr['admin.tree.workflowChange.loss.accept']) as HTMLInputElement
		expect(case_.checked).toBe(false)
		expect(bouton().disabled).toBe(true)
		await userEvent.click(case_)
		await userEvent.click(bouton())
		expect(double.appelsRpc[1]!.charge).toMatchObject({ discard_field_values: true })
		expect(onApplique).toHaveBeenCalledWith('Cycle long')
	})

	it('traduit un refus par le dictionnaire fermé, et Échap referme', async () => {
		const double = clientDouble([{ data: null, error: { message: 'step_mapping_incomplete' }, status: 400 }])
		const onAnnuler = vi.fn()
		render(<PanneauChangementWorkflow client={double.client} channel={CHANNEL} onAnnuler={onAnnuler} onApplique={() => {}} />)
		await screen.findByLabelText(fr['admin.tree.workflowChange.workflow'])
		await choisirTout()
		await userEvent.click(bouton())
		expect((await screen.findByTestId('changement-workflow-refus')).textContent).toBe(
			fr['admin.tree.workflowChange.refus.mapping-incomplet'],
		)
		await userEvent.keyboard('{Escape}')
		expect(onAnnuler).toHaveBeenCalled()
	})

	it('suit la capacité de l’espace : refusée, le bouton reste éteint et cite le motif', async () => {
		render(
			<FournisseurRefus valeur={{ disabled: true, 'aria-describedby': 'motif' }}>
				<PanneauChangementWorkflow client={clientDouble([]).client} channel={CHANNEL} onAnnuler={() => {}} onApplique={() => {}} />
			</FournisseurRefus>,
		)
		await screen.findByLabelText(fr['admin.tree.workflowChange.workflow'])
		await choisirTout()
		expect(bouton().disabled).toBe(true)
		expect(bouton().getAttribute('aria-describedby')).toBe('motif')
	})
})
