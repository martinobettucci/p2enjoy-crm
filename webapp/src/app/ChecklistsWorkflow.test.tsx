// @verifies CRM-068 (docs/BACKLOG.md) — tranche T3b : les checklists dans l'éditeur de workflows, montées pour de vrai
// @verifies docs/SPEC-checklists.md §3.1, §3.4, §4 (décision 759) ; docs/DESIGN_SYSTEM.md §5.70 bis (bloc des étapes,
//           pilule « Archivé », ordre aux extrémités, « Exiger un point » borné à l'étape de départ, point archivé
//           toujours exigé), §5.59 (commandes éteintes avec le motif), §5.8 (états)

import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BlocChecklistsEtapes, ExigencesPointsTransition, type ContexteChecklistsWorkflow, type OuvertureChecklist } from './ChecklistsWorkflow'
import { FournisseurRefus } from '../components/ui/RefusCommandes'
import { fr } from '../i18n'
import type { ChecklistsWorkflow, PointEtape } from '../lib/administration-checklists'
import type { EtatAsync } from '../lib/async'
import type { ClientCrm } from '../lib/supabase'

afterEach(cleanup)

const PROSPECTION = 'etape-prospection'
const RELANCE = 'etape-relance'
const ETAPES = [
	{ id: PROSPECTION, libelle: 'Prospection' },
	{ id: RELANCE, libelle: 'Relance' },
]

const point = (partiel: Partial<PointEtape> & { id: string; label: string }): PointEtape => ({
	step_id: PROSPECTION,
	position: 1,
	archived_at: null,
	created_at: '2026-10-27T08:00:00+00:00',
	...partiel,
})

const DONNEES: ChecklistsWorkflow = {
	points: [
		point({ id: 'a', label: 'Besoin confirmé', position: 1 }),
		point({ id: 'b', label: 'Décideur identifié', position: 2 }),
		point({ id: 'c', label: 'Ancien point', position: 3, archived_at: '2026-10-27T09:00:00+00:00' }),
	],
	exigences: [{ idTransition: 't1', idPoint: 'c' }],
}

type Ecriture = { geste: string; charge?: unknown; filtres: string[] }

function clientDouble(reponse: { data?: unknown; error?: { code?: string; message: string } | null; status?: number } = { data: [{ id: 'x' }] }) {
	const ecritures: Ecriture[] = []
	const chaine = (trace: Ecriture) => {
		const objet: Record<string, unknown> = {
			eq: (colonne: string, valeur: string) => {
				trace.filtres.push(`${colonne}=${valeur}`)
				return objet
			},
			select: () => objet,
			then: (resoudre: (valeur: unknown) => unknown) =>
				Promise.resolve({ data: reponse.data ?? null, error: reponse.error ?? null, status: reponse.status ?? 200 }).then(resoudre),
		}
		return objet
	}
	const ecrire = (geste: string) => (charge?: unknown) => {
		const trace: Ecriture = { geste, charge, filtres: [] }
		ecritures.push(trace)
		return chaine(trace)
	}
	return { ecritures, client: { from: () => ({ insert: ecrire('insert'), update: ecrire('update'), delete: ecrire('delete') }) } as unknown as ClientCrm }
}

/** Un hôte qui tient l'ouverture comme l'éditeur la tient : partagée, au plus une chose. */
function Hote({
	client,
	checklists = { statut: 'pret', donnees: DONNEES },
	onEcrit = () => {},
	enfant,
}: {
	readonly client: ClientCrm
	readonly checklists?: EtatAsync<ChecklistsWorkflow>
	readonly onEcrit?: (annonce: string) => void
	readonly enfant: (contexte: ContexteChecklistsWorkflow) => React.ReactNode
}) {
	const [ouverture, setOuverture] = useState<OuvertureChecklist>(null)
	return <>{enfant({ client, checklists, ouverture, onOuvrir: setOuverture, onEcrit, onReprise: () => {} })}</>
}

const bloc = (contexte: ContexteChecklistsWorkflow) => (
	<BlocChecklistsEtapes etapes={ETAPES} idWorkspace="ws" idWorkflow="wf" nomWorkflow="Cycle" contexte={contexte} />
)

describe('le bloc « Checklists des étapes »', () => {
	it('liste les points de chaque étape dans l’ordre, nomme l’archivé et dit l’étape vide', () => {
		render(<Hote client={clientDouble().client} enfant={bloc} />)
		const etapes = screen.getAllByTestId('checklist-etape')
		expect(within(etapes[0]!).getAllByTestId('checklist-point-etape').map((li) => li.getAttribute('data-point'))).toEqual(['a', 'b', 'c'])
		const archive = within(etapes[0]!).getAllByTestId('checklist-point-etape')[2]!
		expect(archive.textContent).toContain(fr['admin.workflows.checklists.archived'])
		// Un point archivé ne se déplace ni ne se renomme (§5.18) : seule « Désarchiver » reste.
		expect(within(archive).queryByRole('button', { name: 'Renommer le point Ancien point' })).toBeNull()
		expect(within(archive).getByTestId('checklist-desarchiver')).toBeTruthy()
		expect(etapes[1]!.textContent).toContain(fr['admin.workflows.checklists.empty'])
	})

	it('désactive « Monter » en tête et « Descendre » en queue, jamais masqués', () => {
		render(<Hote client={clientDouble().client} enfant={bloc} />)
		expect((screen.getByRole('button', { name: 'Monter le point Besoin confirmé' }) as HTMLButtonElement).disabled).toBe(true)
		expect((screen.getByRole('button', { name: 'Descendre le point Décideur identifié' }) as HTMLButtonElement).disabled).toBe(true)
		expect((screen.getByRole('button', { name: 'Descendre le point Besoin confirmé' }) as HTMLButtonElement).disabled).toBe(false)
	})

	it('ajoute un point : focus dans le champ, envoi désactivé sur champ blanc, position après le dernier, annonce', async () => {
		const double = clientDouble({ data: [{ id: 'neuf' }], status: 201 })
		const onEcrit = vi.fn()
		render(<Hote client={double.client} onEcrit={onEcrit} enfant={bloc} />)
		await userEvent.click(screen.getByRole('button', { name: 'Ajouter un point à l’étape Relance' }))
		const champ = screen.getByLabelText(fr['admin.workflows.checklists.add.label'])
		expect(document.activeElement).toBe(champ)
		expect((screen.getByRole('button', { name: 'Ajouter' }) as HTMLButtonElement).disabled).toBe(true)
		await userEvent.type(champ, 'Proposition envoyée{Enter}')
		expect(double.ecritures[0]).toMatchObject({
			geste: 'insert',
			charge: { workspace_id: 'ws', workflow_id: 'wf', step_id: RELANCE, label: 'Proposition envoyée', position: 1 },
		})
		expect(onEcrit).toHaveBeenCalledWith('Point « Proposition envoyée » ajouté à l’étape Relance')
		expect(screen.queryByLabelText(fr['admin.workflows.checklists.add.label'])).toBeNull()
	})

	it('un refus garde le formulaire ouvert, la saisie et le motif ; Échap le referme', async () => {
		const double = clientDouble({ error: { code: '42501', message: 'denied' }, status: 403 })
		render(<Hote client={double.client} enfant={bloc} />)
		await userEvent.click(screen.getByRole('button', { name: 'Renommer le point Besoin confirmé' }))
		const champ = screen.getByLabelText(fr['admin.workflows.checklists.rename.label']) as HTMLInputElement
		expect(champ.value).toBe('Besoin confirmé')
		await userEvent.type(champ, ' !{Enter}')
		expect((await screen.findByRole('alert')).textContent).toBe(fr['admin.workflows.checklists.refus.forbidden'])
		expect(champ.value).toBe('Besoin confirmé !')
		await userEvent.keyboard('{Escape}')
		expect(screen.queryByLabelText(fr['admin.workflows.checklists.rename.label'])).toBeNull()
	})

	it('archive un point en posant une date ; le refus silencieux se dit sur la ligne', async () => {
		const double = clientDouble({ data: [] })
		render(<Hote client={double.client} enfant={bloc} />)
		await userEvent.click(screen.getByRole('button', { name: 'Archiver le point Décideur identifié' }))
		expect(double.ecritures[0]?.filtres).toEqual(['id=b'])
		expect((double.ecritures[0]?.charge as { archived_at: string | null }).archived_at).not.toBeNull()
		expect((await screen.findByTestId('checklist-refus-point')).textContent).toBe(fr['admin.workflows.checklists.refus.sans-effet'])
	})

	it('dit l’erreur de lecture avec « Réessayer »', () => {
		render(
			<Hote
				client={clientDouble().client}
				checklists={{ statut: 'erreur', erreur: { nature: 'network', detail: 'x' } }}
				enfant={bloc}
			/>,
		)
		expect(screen.getByTestId('erreur-checklists-workflow').textContent).toContain(fr['admin.workflows.checklists.error'])
	})

	it('sous le refus de l’administration, les commandes sont éteintes et citent le motif', () => {
		render(
			<FournisseurRefus valeur={{ disabled: true, 'aria-describedby': 'motif-workflows' }}>
				<Hote client={clientDouble().client} enfant={bloc} />
			</FournisseurRefus>,
		)
		const ajouter = screen.getByRole('button', { name: 'Ajouter un point à l’étape Prospection' }) as HTMLButtonElement
		expect(ajouter.disabled).toBe(true)
		expect(ajouter.getAttribute('aria-describedby')).toBe('motif-workflows')
		expect((screen.getByTestId('checklist-desarchiver') as HTMLButtonElement).disabled).toBe(true)
	})
})

const exigences = (contexte: ContexteChecklistsWorkflow) => (
	<ExigencesPointsTransition idTransition="t1" idEtapeDepart={PROSPECTION} nomTransition="Prospection vers Relance" contexte={contexte} />
)

describe('les points exigés par une transition', () => {
	it('liste les exigés — l’archivé avec sa phrase — et ne propose que les points non archivés de l’étape de départ', async () => {
		render(<Hote client={clientDouble().client} enfant={exigences} />)
		const exige = screen.getByTestId('exigence-point')
		expect(exige.getAttribute('data-point')).toBe('c')
		expect(exige.textContent).toContain(fr['admin.workflows.checklists.required.archived'])
		await userEvent.click(screen.getByRole('button', { name: 'Exiger un point pour Prospection vers Relance' }))
		const select = screen.getByLabelText(fr['admin.workflows.checklists.required.select']) as HTMLSelectElement
		expect(document.activeElement).toBe(select)
		expect([...select.options].map((o) => o.textContent)).toEqual([
			fr['admin.workflows.checklists.required.select.empty'],
			'Besoin confirmé',
			'Décideur identifié',
		])
	})

	it('exige un point choisi, puis referme et annonce ; « Ne plus exiger » vise le couple', async () => {
		const double = clientDouble({ data: [{ transition_id: 't1' }], status: 201 })
		const onEcrit = vi.fn()
		render(<Hote client={double.client} onEcrit={onEcrit} enfant={exigences} />)
		await userEvent.click(screen.getByRole('button', { name: 'Exiger un point pour Prospection vers Relance' }))
		expect((screen.getByRole('button', { name: 'Exiger' }) as HTMLButtonElement).disabled).toBe(true)
		await userEvent.selectOptions(screen.getByLabelText(fr['admin.workflows.checklists.required.select']), 'b')
		await userEvent.click(screen.getByRole('button', { name: 'Exiger' }))
		expect(double.ecritures[0]).toMatchObject({ geste: 'insert', charge: { transition_id: 't1', step_item_id: 'b' } })
		expect(onEcrit).toHaveBeenCalledWith('Point « Décideur identifié » exigé')
		await userEvent.click(screen.getByRole('button', { name: 'Ne plus exiger le point Ancien point pour Prospection vers Relance' }))
		expect(double.ecritures[1]).toMatchObject({ geste: 'delete', filtres: ['transition_id=t1', 'step_item_id=c'] })
	})

	it('sans point disponible, une phrase remplace la commande', () => {
		const vide: ChecklistsWorkflow = { points: [], exigences: [] }
		render(<Hote client={clientDouble().client} checklists={{ statut: 'pret', donnees: vide }} enfant={exigences} />)
		expect(screen.getByTestId('exigences-points-indisponible').textContent).toBe(fr['admin.workflows.checklists.required.noPoints'])
		expect(screen.getByTestId('exigences-points-aucun').textContent).toBe(fr['admin.workflows.checklists.required.none'])
	})
})
