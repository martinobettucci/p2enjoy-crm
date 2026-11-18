// @verifies CRM-156 (docs/BACKLOG.md) — tranche T4 : le transfert du message ouvert — la commande qui suit la capacité
//           d'éditer, le bloc « Transférer ce message » (le `select` sans la personne, le bouton éteint sans membre, `Échap`),
//           l'appel `transfer_message`, le refus traduit ; les transferts lus, « Compte supprimé », « Retirer » rendu pour
//           l'auteur et le destinataire seuls, le retrait relu et annoncé ; l'exclusion avec les autres blocs
// @verifies docs/DESIGN_SYSTEM.md §5.109 bis (« LE TRANSFERT ») ; docs/SPEC-mail-subsystem.md §32.7 ; docs/JOURNAL.md
//           décisions 945 et 947

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ClientCrm } from '../lib/supabase'

type Reponse = { readonly data: unknown; readonly error: { readonly message: string } | null; readonly status: number }

const injecte = vi.hoisted(() => ({
	transferts: [] as unknown[],
	rpc: null as null | ((fonction: string, corps: unknown) => Promise<Reponse>),
	lectures: 0,
}))

const MEMBRES = [
	{ user_id: 'moi', profiles: { id: 'moi', full_name: 'Camille Admin' } },
	{ user_id: 'u2', profiles: { id: 'u2', full_name: 'Driss Bizdev' } },
	{ user_id: 'u3', profiles: { id: 'u3', full_name: 'Farida Lectrice' } },
]

vi.mock('../lib/supabase', () => ({
	clientCrm: {
		rpc: (fonction: string, corps: unknown) => injecte.rpc?.(fonction, corps),
		from: (table: string) => {
			if (table === 'workspace_members')
				return { select: () => ({ eq: async () => ({ data: MEMBRES, error: null, status: 200 }) }) }
			// `mail_message_transfers` : select → eq → order.
			return {
				select: () => ({
					eq: () => ({
						order: async () => {
							injecte.lectures += 1
							return { data: injecte.transferts, error: null, status: 200 }
						},
					}),
				}),
			}
		},
	} as unknown as ClientCrm,
}))

const { TransfertDuMessage } = await import('./TransfertInbox')

afterEach(() => {
	cleanup()
	injecte.transferts = []
	injecte.rpc = null
	injecte.lectures = 0
})

function monter(proprietes: Partial<Parameters<typeof TransfertDuMessage>[0]> = {}) {
	const onAnnonce = vi.fn()
	const autres = vi.fn()
	render(
		<TransfertDuMessage
			idMessage="m1"
			idEspace="w"
			idMoi="moi"
			edition="permise"
			onAnnonce={onAnnonce}
			enfants={(transfert) => {
				autres(transfert.refermerAutres)
				return (
					<div>
						{transfert.liste}
						<div>{transfert.commande}</div>
						{transfert.panneau}
					</div>
				)
			}}
			{...proprietes}
		/>,
	)
	return { onAnnonce, autres }
}

describe('la commande et le bloc (§5.109 bis)', () => {
	it('la commande suit la capacité d’éditer : refusée, elle est éteinte', async () => {
		monter({ edition: 'refusee' })
		expect((screen.getByTestId('inbox-transferer') as HTMLButtonElement).disabled).toBe(true)
	})

	it('le bloc : un `select` sans la personne, le focus dessus, le bouton éteint sans membre ; `Échap` rend le focus', async () => {
		const { autres } = monter()
		await userEvent.click(screen.getByTestId('inbox-transferer'))
		expect(screen.getByRole('group', { name: 'Transférer ce message' })).toBeTruthy()
		expect(autres).toHaveBeenLastCalledWith(1)
		const membre = screen.getByTestId('inbox-transfert-membre') as HTMLSelectElement
		await waitFor(() => expect(document.activeElement).toBe(membre))
		expect([...membre.options].map((option) => option.textContent)).toEqual([
			'Choisir un membre',
			'Driss Bizdev',
			'Farida Lectrice',
		])
		expect((screen.getByTestId('inbox-transfert-confirmer') as HTMLButtonElement).disabled).toBe(true)
		await userEvent.keyboard('{Escape}')
		expect(screen.queryByTestId('inbox-transfert-bloc')).toBeNull()
		await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId('inbox-transferer')))
	})

	it('transférer appelle la base, annonce, referme et relit les transferts', async () => {
		const appels: [string, unknown][] = []
		injecte.rpc = async (fonction, corps) => {
			appels.push([fonction, corps])
			return { data: null, error: null, status: 204 }
		}
		const { onAnnonce } = monter()
		await userEvent.click(screen.getByTestId('inbox-transferer'))
		const membre = screen.getByTestId('inbox-transfert-membre') as HTMLSelectElement
		await waitFor(() => expect(membre.disabled).toBe(false))
		await userEvent.selectOptions(membre, 'u2')
		const lecturesAvant = injecte.lectures
		await userEvent.click(screen.getByTestId('inbox-transfert-confirmer'))
		await waitFor(() => expect(onAnnonce).toHaveBeenCalledWith('Message transféré à Driss Bizdev.'))
		expect(appels).toEqual([['transfer_message', { p_message_id: 'm1', p_recipient_id: 'u2' }]])
		expect(screen.queryByTestId('inbox-transfert-bloc')).toBeNull()
		await waitFor(() => expect(injecte.lectures).toBeGreaterThan(lecturesAvant))
	})

	it('un refus se dit dans le bloc, par le dictionnaire, sans le fermer', async () => {
		injecte.rpc = async () => ({ data: null, error: { message: 'recipient_not_member' }, status: 400 })
		monter()
		await userEvent.click(screen.getByTestId('inbox-transferer'))
		const membre = screen.getByTestId('inbox-transfert-membre') as HTMLSelectElement
		await waitFor(() => expect(membre.disabled).toBe(false))
		await userEvent.selectOptions(membre, 'u3')
		await userEvent.click(screen.getByTestId('inbox-transfert-confirmer'))
		expect((await screen.findByTestId('inbox-transfert-refus')).textContent).toBe(
			'Cette personne n’est pas membre de l’espace du message.',
		)
		expect(screen.getByTestId('inbox-transfert-bloc')).toBeTruthy()
	})
})

describe('les transferts du message (§5.109 bis)', () => {
	const LIGNES = [
		{
			recipient_id: 'u2',
			transferred_by: 'moi',
			created_at: '2026-11-18T09:30:00Z',
			destinataire: { full_name: 'Driss Bizdev' },
			auteur: { full_name: 'Camille Admin' },
		},
		{
			recipient_id: 'u3',
			transferred_by: 'u9',
			created_at: '2026-11-18T10:00:00Z',
			destinataire: { full_name: 'Farida Lectrice' },
			auteur: null,
		},
	]

	it('une ligne par transfert ; « Retirer » pour l’auteur et le destinataire seuls ; « Compte supprimé »', async () => {
		injecte.transferts = LIGNES
		monter()
		const lignes = await screen.findAllByText(/^Transféré à/)
		expect(lignes).toHaveLength(2)
		expect(lignes[0]?.textContent).toMatch(/^Transféré à Driss Bizdev par Camille Admin, le 18\/11\/2026/)
		expect(lignes[1]?.textContent).toMatch(/^Transféré à Farida Lectrice par Compte supprimé, le/)
		const retirer = screen.getAllByTestId('inbox-transfert-retirer')
		expect(retirer).toHaveLength(1)
		expect(retirer[0]?.getAttribute('aria-label')).toBe('Retirer le transfert à Driss Bizdev')
	})

	it('le destinataire retire le transfert qu’il a reçu ; le retrait est annoncé et relu', async () => {
		injecte.transferts = [LIGNES[1]]
		const appels: [string, unknown][] = []
		injecte.rpc = async (fonction, corps) => {
			appels.push([fonction, corps])
			injecte.transferts = []
			return { data: null, error: null, status: 204 }
		}
		const { onAnnonce } = monter({ idMoi: 'u3' })
		await userEvent.click(await screen.findByRole('button', { name: 'Retirer le transfert à Farida Lectrice' }))
		await waitFor(() => expect(onAnnonce).toHaveBeenCalledWith('Transfert retiré.'))
		expect(appels).toEqual([['remove_message_transfer', { p_message_id: 'm1', p_recipient_id: 'u3' }]])
		await waitFor(() => expect(screen.queryByTestId('inbox-transferts')).toBeNull())
	})

	it('un retrait refusé se dit sous sa ligne', async () => {
		injecte.transferts = [LIGNES[0]]
		injecte.rpc = async () => ({ data: null, error: { message: 'forbidden' }, status: 403 })
		monter()
		await userEvent.click(await screen.findByTestId('inbox-transfert-retirer'))
		expect((await screen.findByTestId('inbox-transfert-retrait-refus')).textContent).toBe(
			'Vous n’avez pas le droit de faire ce geste.',
		)
	})
})
