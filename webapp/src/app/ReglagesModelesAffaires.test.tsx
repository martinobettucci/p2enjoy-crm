// @verifies CRM-068 (docs/BACKLOG.md) — tranche T4b1 : Réglages ▸ Modèles d'affaires — sections par workflow, lignes,
//           archivés sous leur case, fiche dans le flux (nouveau, modifier), archivage sans confirmation, états
// @verifies CRM-068 (docs/BACKLOG.md) — tranche T4b2 : les réponses aux questions du workflow dans la fiche — contrôles
//           préremplis, réponses conservées sans saisie, envoi composé, workflow changé qui efface, lecture en échec qui
//           n'envoie rien (docs/DESIGN_SYSTEM.md §5.71 bis, décision 766)
// @verifies docs/SPEC-checklists.md §3.5 ; docs/DESIGN_SYSTEM.md §5.71, §5.39, §5.8 (états), §5.15 (le workflow d'un modèle
//           existant se lit en phrase), §5.59 (écran réservé atteint par son adresse)
//
// L'écran RÉEL est monté sur un client espion qui sert les deux lectures et note chaque écriture. La pile réelle est
// éprouvée par `e2e/ui/modeles-affaires.spec.ts`.

import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { fr } from '../i18n'
import { CAPACITES_INCONNUES, type Capacite } from '../lib/capacites'
import type { ClientCrm } from '../lib/supabase'
import { FournisseurEspace } from './ContexteEspace'
import { ReglagesModelesAffaires } from './ReglagesModelesAffaires'

afterEach(cleanup)

const WORKFLOWS = [
	{ id: 'wf-1', workspace_id: 'ws-1', name: 'Cycle commercial', scope: 'global', track_id: null, is_default: true, archived_at: null },
	{ id: 'wf-2', workspace_id: 'ws-1', name: 'Formation', scope: 'global', track_id: null, is_default: false, archived_at: null },
]
const modele = (partiel: Record<string, unknown>) => ({
	id: 'm-1', workflow_id: 'wf-1', name: 'Audit flash', title: 'Audit flash — client', description: null, amount: 4800,
	currency: 'EUR', field_values: { budget: 4800, source: 'salon' }, checklist: ['Un', 'Deux', 'Trois'], archived_at: null,
	created_at: '2026-10-27T08:00:00Z', ...partiel,
})

type Ecriture = { readonly methode: string; readonly valeur: unknown }

const champ = (workflow: string, key: string, type: string, partiel: Record<string, unknown> = {}) => ({
	id: `f-${key}`, workflow_id: workflow, key, label: key[0]!.toUpperCase() + key.slice(1), type, position: 1, options: null,
	help_text: null, archived_at: null, ...partiel,
})
/** Les questions du seed, réduites : le workflow `wf-1` en pose quatre dont une archivée, `wf-2` une seule. */
const QUESTIONS = [
	champ('wf-1', 'budget', 'money', { help_text: 'Montant hors taxes.' }),
	champ('wf-1', 'source', 'select', { options: { choices: [{ key: 'salon', label: 'Salon' }, { key: 'web', label: 'Site web' }] } }),
	champ('wf-1', 'interlocuteur', 'contact'),
	champ('wf-1', 'ancien', 'text', { archived_at: '2026-01-01T00:00:00Z' }),
	champ('wf-2', 'public', 'text'),
]

function client(
	modeles: readonly Record<string, unknown>[],
	ecriture: { data: unknown; error: unknown; status: number } = { data: [{ id: 'm-new' }], error: null, status: 201 },
	questionsEnPanne = false,
) {
	const ecritures: Ecriture[] = []
	const faux = {
		from: (table: string) => {
			const maillon: Record<string, unknown> = {}
			let ecrit = false
			let workflow: unknown = null
			for (const methode of ['select', 'is', 'order']) maillon[methode] = () => maillon
			maillon.eq = (colonne: string, valeur: unknown) => {
				if (colonne === 'workflow_id') workflow = valeur
				return maillon
			}
			for (const methode of ['insert', 'update']) {
				maillon[methode] = (valeur: unknown) => {
					ecrit = true
					ecritures.push({ methode, valeur })
					return maillon
				}
			}
			maillon.then = (resoudre: (r: unknown) => unknown) => {
				if (ecrit) return resoudre(ecriture)
				if (table === 'form_fields') {
					return resoudre(
						questionsEnPanne
							? { data: null, error: { message: 'boom' }, status: 500 }
							: { data: QUESTIONS.filter((q) => q.workflow_id === workflow), error: null, status: 200 },
					)
				}
				return resoudre({ data: table === 'workflows' ? WORKFLOWS : modeles, error: null, status: 200 })
			}
			return maillon
		},
	} as unknown as ClientCrm
	return { client: faux, ecritures }
}

function monter(c: ClientCrm, administration: Capacite = 'permise') {
	return render(
		<FournisseurEspace valeur={{ idWorkspace: 'ws-1', estAdmin: true, capacites: { ...CAPACITES_INCONNUES, administration } }}>
			<ReglagesModelesAffaires client={c} />
		</FournisseurEspace>,
	)
}

describe('la liste des modèles (docs/DESIGN_SYSTEM.md §5.71)', () => {
	it('une section par workflow ayant un modèle, dans l’ordre des workflows ; la ligne dit nom, titre, montant, points', async () => {
		monter(client([modele({}), modele({ id: 'm-2', workflow_id: 'wf-2', name: 'Inter-entreprises', amount: null, checklist: ['Seul'] })]).client)
		const sections = await screen.findAllByTestId('modeles-workflow')
		expect(sections.map((s) => within(s).getByRole('heading').textContent)).toEqual(['Cycle commercial', 'Formation'])
		const ligne = within(sections[0]!).getByTestId('ligne-modele-affaire')
		expect(ligne.textContent).toContain('Audit flash')
		expect(ligne.textContent).toContain('Audit flash — client')
		expect(ligne.querySelector('code')?.textContent?.replace(/\s/gu, '')).toBe('4800')
		expect(ligne.textContent).toContain('EUR')
		expect(ligne.textContent).toContain('3 points')
		expect(within(sections[1]!).getByTestId('ligne-modele-affaire').textContent).toContain('1 point')
	})

	it('un modèle archivé ne paraît que sous « Afficher les archivés », avec sa pilule et « Désarchiver »', async () => {
		monter(client([modele({ archived_at: '2026-10-27T09:00:00Z' })]).client)
		expect(await screen.findByText(fr['admin.cardTemplates.empty.title'])).toBeDefined()
		await userEvent.click(screen.getByLabelText(fr['admin.cardTemplates.showArchived']))
		const ligne = screen.getByTestId('ligne-modele-affaire')
		expect(ligne.textContent).toContain(fr['admin.cardTemplates.archived'])
		expect(within(ligne).getByRole('button', { name: 'Désarchiver le modèle Audit flash' })).toBeDefined()
		expect(within(ligne).queryByRole('button', { name: /^Modifier/ })).toBeNull()
	})

	it('vide : « Aucun modèle d’affaire. » ; refusée : l’écran réservé, sans lecture', async () => {
		monter(client([]).client)
		expect(await screen.findByText(fr['admin.cardTemplates.empty.title'])).toBeDefined()
		cleanup()
		monter(client([]).client, 'refusee')
		expect(screen.getByText(fr['admin.cardTemplates.forbidden.title'])).toBeDefined()
		expect(screen.queryByTestId('nouveau-modele-affaire')).toBeNull()
	})
})

describe('la fiche d’un modèle', () => {
	it('« Nouveau modèle » : le focus entre dans « Workflow » ; les points s’ajoutent et se retirent ; l’envoi est normalisé', async () => {
		const { client: c, ecritures } = client([])
		monter(c)
		await userEvent.click(await screen.findByTestId('nouveau-modele-affaire'))
		const workflow = screen.getByLabelText(fr['admin.cardTemplates.field.workflow']) as HTMLSelectElement
		expect(document.activeElement).toBe(workflow)
		expect([...workflow.options].map((o) => o.textContent)).toEqual(['Cycle commercial', 'Formation'])
		await userEvent.selectOptions(workflow, 'wf-2')
		await userEvent.type(screen.getByLabelText(fr['admin.cardTemplates.field.name']), 'Inter')
		await userEvent.type(screen.getByLabelText(fr['admin.cardTemplates.field.amount']), '1200,5')
		await userEvent.click(screen.getByTestId('modele-ajouter-point'))
		expect(document.activeElement).toBe(screen.getByLabelText('Point 1'))
		await userEvent.keyboard('Convention')
		await userEvent.click(screen.getByTestId('modele-ajouter-point'))
		await userEvent.click(screen.getByRole('button', { name: 'Retirer le point 2' }))
		await userEvent.click(screen.getByTestId('modele-enregistrer'))
		expect(ecritures).toEqual([
			{
				methode: 'insert',
				// T4b2 : les questions lues, les réponses partent avec le modèle — ici aucune.
				valeur: { workspace_id: 'ws-1', workflow_id: 'wf-2', name: 'Inter', title: null, description: null, amount: 1200.5, currency: 'EUR', checklist: ['Convention'], field_values: {} },
			},
		])
		await waitFor(() => expect(screen.queryByTestId('fiche-modele-affaire')).toBeNull())
		expect(screen.getByTestId('annonce-modeles-affaires').textContent).toBe('Modèle « Inter » enregistré.')
	})

	it('« Modifier » : le workflow en phrase, et un nom pris refusé sous les champs', async () => {
		monter(client([modele({})], { data: null, error: { code: '23505', message: 'dup' }, status: 409 }).client)
		await userEvent.click(await screen.findByRole('button', { name: 'Modifier le modèle Audit flash' }))
		expect(screen.getByTestId('modele-workflow-phrase').textContent).toBe('Ce modèle sert les affaires du workflow « Cycle commercial ».')
		expect(screen.queryByLabelText(fr['admin.cardTemplates.field.workflow'])).toBeNull()
		const nom = screen.getByLabelText(fr['admin.cardTemplates.field.name']) as HTMLInputElement
		expect(document.activeElement).toBe(nom)
		await userEvent.click(screen.getByTestId('modele-enregistrer'))
		expect((await screen.findByRole('alert')).textContent).toContain(fr['admin.cardTemplates.refus.nom'])
		expect(nom.value).toBe('Audit flash')
	})

	it('un montant illisible est refusé avant envoi ; `Échap` referme et rend le focus à « Nouveau modèle »', async () => {
		const { client: c, ecritures } = client([])
		monter(c)
		await userEvent.click(await screen.findByTestId('nouveau-modele-affaire'))
		await userEvent.type(screen.getByLabelText(fr['admin.cardTemplates.field.name']), 'X')
		await userEvent.type(screen.getByLabelText(fr['admin.cardTemplates.field.amount']), 'beaucoup')
		await userEvent.click(screen.getByTestId('modele-enregistrer'))
		expect((await screen.findByRole('alert')).textContent).toContain(fr['admin.cardTemplates.refus.montant'])
		expect(ecritures).toEqual([])
		await userEvent.keyboard('{Escape}')
		await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId('nouveau-modele-affaire')))
	})

	it('« Archiver » écrit l’instant, sans confirmation, et l’annonce', async () => {
		const { client: c, ecritures } = client([modele({})], { data: [{ id: 'm-1' }], error: null, status: 200 })
		monter(c)
		await userEvent.click(await screen.findByRole('button', { name: 'Archiver le modèle Audit flash' }))
		await waitFor(() => expect(ecritures).toHaveLength(1))
		expect(ecritures[0]!.methode).toBe('update')
		expect(typeof (ecritures[0]!.valeur as { archived_at: unknown }).archived_at).toBe('string')
		await waitFor(() => expect(screen.getByTestId('annonce-modeles-affaires').textContent).toBe('Modèle « Audit flash » archivé.'))
	})
})

// `CRM-068` T4b2 — les réponses aux questions (docs/DESIGN_SYSTEM.md §5.71 bis).
describe('les réponses d’un modèle (T4b2)', () => {
	const AVEC_REPONSES = modele({ field_values: { budget: 4800, source: 'salon', interlocuteur: 'c-1', ancien: 'x' } })

	it('préremplit les contrôles ; contact et question archivée sont dits conservés ; l’envoi compose les réponses', async () => {
		const { client: c, ecritures } = client([AVEC_REPONSES], { data: [{ id: 'm-1' }], error: null, status: 200 })
		monter(c)
		await userEvent.click(await screen.findByRole('button', { name: 'Modifier le modèle Audit flash' }))
		const budget = (await screen.findByLabelText('Budget')) as HTMLInputElement
		expect(budget.value).toBe('4800')
		expect(budget.type).toBe('number')
		expect(document.getElementById(budget.getAttribute('aria-describedby')!)?.textContent).toBe('Montant hors taxes.')
		const source = screen.getByLabelText('Source') as HTMLSelectElement
		expect(source.value).toBe('salon')
		expect(screen.getByTestId('reponse-sans-saisie').textContent).toContain(fr['admin.cardTemplates.answers.kept'])
		expect(screen.getByTestId('reponses-archivees').textContent).toBe('1 réponse à une question archivée, conservée.')
		await userEvent.clear(budget)
		await userEvent.selectOptions(source, 'web')
		await userEvent.click(screen.getByTestId('modele-enregistrer'))
		await waitFor(() => expect(ecritures).toHaveLength(1))
		expect((ecritures[0]!.valeur as { field_values: unknown }).field_values).toEqual({ source: 'web', interlocuteur: 'c-1', ancien: 'x' })
	})

	it('à la création, changer de workflow le dit puis efface les réponses saisies', async () => {
		const { client: c, ecritures } = client([])
		monter(c)
		await userEvent.click(await screen.findByTestId('nouveau-modele-affaire'))
		expect(screen.getByTestId('reponse-sans-saisie').textContent).toContain(fr['admin.cardTemplates.answers.onCard'])
		await userEvent.type(await screen.findByLabelText('Budget'), '900')
		expect(screen.getByTestId('modele-workflow-efface').textContent).toBe(fr['admin.cardTemplates.answers.workflowChange'])
		await userEvent.selectOptions(screen.getByLabelText(fr['admin.cardTemplates.field.workflow']), 'wf-2')
		await userEvent.type(await screen.findByLabelText('Public'), 'Lycées')
		expect(screen.queryByLabelText('Budget')).toBeNull()
		await userEvent.type(screen.getByLabelText(fr['admin.cardTemplates.field.name']), 'Inter')
		await userEvent.click(screen.getByTestId('modele-enregistrer'))
		expect((ecritures[0]!.valeur as { field_values: unknown }).field_values).toEqual({ public: 'Lycées' })
	})

	it('questions illisibles : la fiche le dit, et le modèle part sans toucher à ses réponses', async () => {
		const { client: c, ecritures } = client([AVEC_REPONSES], { data: [{ id: 'm-1' }], error: null, status: 200 }, true)
		monter(c)
		await userEvent.click(await screen.findByRole('button', { name: 'Modifier le modèle Audit flash' }))
		expect(await screen.findByText(fr['admin.cardTemplates.answers.error'])).toBeDefined()
		await userEvent.click(screen.getByTestId('modele-enregistrer'))
		await waitFor(() => expect(ecritures).toHaveLength(1))
		expect('field_values' in (ecritures[0]!.valeur as object)).toBe(false)
	})
})
