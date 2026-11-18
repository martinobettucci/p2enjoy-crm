// @verifies CRM-156 (docs/BACKLOG.md) — tranche T3 : la rangée et la barre d'actions groupées — « Tout sélectionner » sous
//           un filtre explicite seulement, le compte lu en base, l'option refusée par la capacité d'éditer, la confirmation
//           qui dit les nombres et n'agit qu'au bouton, la suppression sans la case d'une heure, la progression, le compte
//           rendu des faits et des refus, l'interruption, la corbeille et « Restaurer »
// @verifies docs/DESIGN_SYSTEM.md §5.109 ; docs/SPEC-mail-subsystem.md §32.3 à §32.6 ; docs/JOURNAL.md décisions 946 et 949

import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ClientCrm } from '../lib/supabase'
import type { PorteeGroupee } from '../lib/actions-groupees'

const injecte = vi.hoisted(() => ({
	rpc: null as null | ((fonction: string, corps: unknown) => Promise<unknown>),
}))

vi.mock('../lib/supabase', () => ({
	get clientCrm() {
		return injecte.rpc === null ? null : ({ rpc: injecte.rpc } as unknown as ClientCrm)
	},
}))

const { ActionsGroupees } = await import('./ActionsGroupeesInbox')

afterEach(() => {
	cleanup()
	injecte.rpc = null
})

const PORTEE: PorteeGroupee = {
	dossier: { genre: 'non-classes' },
	seulementMoi: false,
	pastilles: ['p1'],
	expediteur: null,
	sommeilVisible: false,
	fils: [{ workspaceId: 'w', cleFil: '<a@x>' }],
}

/** La base : `inbox_bulk_count` rend 2 fils / 5 messages ; `inbox_bulk_apply` rend les paquets donnés. */
function base(paquets: readonly unknown[], appels: [string, unknown][] = []) {
	let rang = 0
	injecte.rpc = async (fonction, corps) => {
		appels.push([fonction, corps])
		if (fonction === 'inbox_bulk_count') return { data: [{ thread_count: 2, message_count: 5 }], error: null, status: 200 }
		const paquet = paquets[Math.min(rang, paquets.length - 1)]
		rang += 1
		return paquet
	}
}

function monter(proprietes: Partial<Parameters<typeof ActionsGroupees>[0]> = {}) {
	const onTermine = vi.fn()
	render(
		<ActionsGroupees
			nonLusAffiches={[]}
			onToutMarquer={vi.fn()}
			filtreExplicite={true}
			selection={{ genre: 'fils', nombre: 2 }}
			onToutSelectionner={vi.fn()}
			onDeselectionner={vi.fn()}
			portee={PORTEE}
			dansUneAffaire={false}
			edition="permise"
			catalogue={new Map()}
			idEspace="w"
			ancre={{ messageId: 'm1', expediteur: 'a@x.fr' }}
			retention={30}
			onTermine={onTermine}
			{...proprietes}
		/>,
	)
	return { onTermine }
}

describe('la rangée d’action (§5.109)', () => {
	it('« Tout sélectionner » n’existe que sous un filtre explicite', () => {
		monter({ selection: { genre: 'aucune' }, filtreExplicite: false, nonLusAffiches: ['m'] })
		expect(screen.queryByTestId('inbox-tout-selectionner')).toBeNull()
		expect(screen.getByTestId('inbox-tout-marquer-lu')).toBeTruthy()
		cleanup()
		const onToutSelectionner = vi.fn()
		monter({ selection: { genre: 'aucune' }, onToutSelectionner })
		expect(screen.getByTestId('inbox-tout-selectionner')).toBeTruthy()
	})

	it('sans filtre, sans non-lu ni sélection, la rangée n’est pas rendue', () => {
		monter({ selection: { genre: 'aucune' }, filtreExplicite: false })
		expect(screen.queryByTestId('inbox-rangee-action')).toBeNull()
	})

	it('« tout le filtre » dit son nombre lu en base, jamais un compte de la page', async () => {
		base([])
		monter({ selection: { genre: 'tout' }, portee: { ...PORTEE, fils: null } })
		await waitFor(() => expect(screen.getByTestId('inbox-selection-compte').textContent).toBe('Tout le filtre : 2 fils (5 messages)'))
	})

	it('une action refusée par la capacité d’éditer reste une option, désactivée, avec son mot', () => {
		monter({ edition: 'refusee' })
		const option = screen.getByRole('option', { name: 'Poser une pastille — non permis' }) as HTMLOptionElement
		expect(option.disabled).toBe(true)
		expect((screen.getByRole('option', { name: 'Marquer comme lu' }) as HTMLOptionElement).disabled).toBe(false)
	})

	it('« Retirer de l’affaire » n’est offert que dans le dossier d’une affaire', () => {
		monter()
		expect(screen.queryByRole('option', { name: 'Retirer de l’affaire' })).toBeNull()
		cleanup()
		monter({ dansUneAffaire: true })
		expect(screen.getByRole('option', { name: 'Retirer de l’affaire' })).toBeTruthy()
	})
})

describe('la confirmation et le compte rendu (§5.109, décision 946)', () => {
	it('choisir n’ouvre rien ; « Continuer » ouvre la confirmation, qui dit les nombres et n’agit qu’au bouton', async () => {
		const appels: [string, unknown][] = []
		base([{ data: { threads: 2, messages: 5, done: 5, refused: {}, next: null }, error: null, status: 200 }], appels)
		const { onTermine } = monter()
		await userEvent.selectOptions(screen.getByTestId('inbox-action-groupee'), 'mark_read')
		expect(screen.queryByTestId('inbox-confirmation-groupee')).toBeNull()
		await userEvent.click(screen.getByTestId('inbox-action-continuer'))
		const bloc = await screen.findByTestId('inbox-confirmation-groupee')
		await waitFor(() => expect(within(bloc).getByText('Marquer comme lus 2 fils (5 messages) ?')).toBeTruthy())
		expect(appels.some(([f]) => f === 'inbox_bulk_apply')).toBe(false)
		await userEvent.click(screen.getByTestId('inbox-groupe-confirmer'))
		const compteRendu = await screen.findByTestId('inbox-compte-rendu')
		expect(within(compteRendu).getByTestId('inbox-compte-rendu-fait').textContent).toBe('Fait : 5 messages.')
		expect(onTermine).toHaveBeenCalledTimes(1)
		await waitFor(() => expect(document.activeElement?.textContent).toBe('Marquer comme lu'))
	})

	it('la suppression est destructive, rappelle sa conséquence, et ne porte pas la case « Ne plus demander »', async () => {
		base([])
		monter()
		await userEvent.selectOptions(screen.getByTestId('inbox-action-groupee'), 'delete_everywhere')
		await userEvent.click(screen.getByTestId('inbox-action-continuer'))
		const bloc = await screen.findByTestId('inbox-confirmation-groupee')
		expect(within(bloc).getByText(/pendant 30 jours, et dans la corbeille de la boîte mail/)).toBeTruthy()
		expect(within(bloc).queryByRole('checkbox')).toBeNull()
		expect(screen.getByTestId('inbox-groupe-confirmer').className).toContain('bg-danger')
	})

	it('`Échap` referme la confirmation et rend le focus au `select`', async () => {
		base([])
		monter()
		await userEvent.selectOptions(screen.getByTestId('inbox-action-groupee'), 'wake')
		await userEvent.click(screen.getByTestId('inbox-action-continuer'))
		await screen.findByTestId('inbox-confirmation-groupee')
		await userEvent.keyboard('{Escape}')
		expect(screen.queryByTestId('inbox-confirmation-groupee')).toBeNull()
		expect(document.activeElement).toBe(screen.getByTestId('inbox-action-groupee'))
	})

	it('le compte rendu nomme chaque refus et son nombre, par le dictionnaire', async () => {
		base([
			{
				data: { threads: 2, messages: 5, done: 3, refused: { forbidden: 1, outbound_message: 1 }, next: null },
				error: null,
				status: 200,
			},
		])
		monter()
		await userEvent.selectOptions(screen.getByTestId('inbox-action-groupee'), 'reevaluate')
		await userEvent.click(screen.getByTestId('inbox-action-continuer'))
		await waitFor(() => expect((screen.getByTestId('inbox-groupe-confirmer') as HTMLButtonElement).disabled).toBe(false))
		await userEvent.click(screen.getByTestId('inbox-groupe-confirmer'))
		const refus = await screen.findByTestId('inbox-compte-rendu-refus')
		expect(refus.textContent).toContain('1 — vous n’avez pas le droit de faire ce geste sur ces messages')
		expect(refus.textContent).toContain('1 — messages envoyés : ils ne sont pas évalués')
		expect(screen.getByTestId('inbox-compte-rendu').getAttribute('role')).toBe('status')
	})

	it('un paquet en échec passe le compte rendu en alerte, qui dit ce qui a été traité avant l’arrêt', async () => {
		base([
			{ data: { threads: 2, messages: 3, done: 3, refused: {}, next: 'x' }, error: null, status: 200 },
			{ data: null, error: { message: 'panne' }, status: 500 },
		])
		monter()
		await userEvent.selectOptions(screen.getByTestId('inbox-action-groupee'), 'mark_unread')
		await userEvent.click(screen.getByTestId('inbox-action-continuer'))
		await waitFor(() => expect((screen.getByTestId('inbox-groupe-confirmer') as HTMLButtonElement).disabled).toBe(false))
		await userEvent.click(screen.getByTestId('inbox-groupe-confirmer'))
		const bloc = await screen.findByTestId('inbox-compte-rendu')
		expect(bloc.getAttribute('role')).toBe('alert')
		expect(bloc.textContent).toContain('Action interrompue : 3 messages traités avant l’arrêt')
	})

	it('le sommeil n’agit pas tant qu’aucune échéance n’est choisie ; une échéance usuelle la choisit sans confirmer', async () => {
		const appels: [string, unknown][] = []
		base([{ data: { threads: 2, messages: 5, done: 2, refused: {}, next: null }, error: null, status: 200 }], appels)
		monter()
		await userEvent.selectOptions(screen.getByTestId('inbox-action-groupee'), 'snooze')
		await userEvent.click(screen.getByTestId('inbox-action-continuer'))
		await screen.findByTestId('inbox-confirmation-groupee')
		await waitFor(() => expect(screen.getByText('Mettre en sommeil 2 fils (5 messages) ?')).toBeTruthy())
		expect((screen.getByTestId('inbox-groupe-confirmer') as HTMLButtonElement).disabled).toBe(true)
		await userEvent.click(screen.getByRole('button', { name: 'Demain' }))
		expect(appels.some(([f]) => f === 'inbox_bulk_apply')).toBe(false)
		await userEvent.click(screen.getByTestId('inbox-groupe-confirmer'))
		expect((await screen.findByTestId('inbox-compte-rendu-fait')).textContent).toBe('Fait : 2 fils.')
	})
})

describe('la corbeille (§5.109)', () => {
	it('une sélection de messages, « Restaurer » direct, et aucun `select`', async () => {
		base([{ data: { threads: 1, messages: 2, done: 2, refused: {}, next: null }, error: null, status: 200 }])
		monter({
			dansLaCorbeille: true,
			filtreExplicite: false,
			selection: { genre: 'fils', nombre: 2 },
			portee: { ...PORTEE, dossier: { genre: 'corbeille' }, fils: null, messages: ['m1', 'm2'] },
		})
		expect(screen.getByTestId('inbox-selection-compte').textContent).toBe('2 messages sélectionnés')
		expect(screen.queryByTestId('inbox-action-groupee')).toBeNull()
		await userEvent.click(screen.getByTestId('inbox-corbeille-restaurer-selection'))
		await waitFor(() => expect((screen.getByTestId('inbox-groupe-confirmer') as HTMLButtonElement).disabled).toBe(false))
		expect(screen.getByTestId('inbox-groupe-confirmer').className).not.toContain('bg-danger')
		await userEvent.click(screen.getByTestId('inbox-groupe-confirmer'))
		expect((await screen.findByTestId('inbox-compte-rendu-fait')).textContent).toBe('Fait : 2 messages.')
	})
})
