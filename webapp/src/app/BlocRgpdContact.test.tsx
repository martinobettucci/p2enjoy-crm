// @verifies CRM-072 (docs/BACKLOG.md) — tranche T3 : la zone « Données personnelles (RGPD) » de la fiche d'un contact
// @verifies docs/SPEC-audit.md §7, §9 ; docs/DESIGN_SYSTEM.md §5.67 (export téléchargé et annoncé, confirmation dans le
//           flux, bouton destructif éteint tant que le nom retapé diffère, anonymiser absent une fois fait, refus dits),
//           §5.59 (commandes éteintes par la capacité, citant le motif), §5.40 (focus rendu à la commande) ; décision 732
//
// La base est simulée au format de PostgREST. Le refus réel est prouvé hors interface (`e2e/api/rgpd-contact.spec.ts`).

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Capacite } from '../lib/capacites'
import type { ClientCrm } from '../lib/supabase'
import { BlocRgpdContact } from './BlocRgpdContact'

afterEach(cleanup)

type Reponse = { data: unknown; error: { code?: string; message?: string } | null; status: number }

function monter(options: { reponse?: Reponse; administration?: Capacite; anonymiseLe?: string | null } = {}) {
	const appels: string[] = []
	const client = {
		rpc(fonction: string) {
			appels.push(fonction)
			return Promise.resolve(options.reponse ?? { data: { format: 'p2enjoy-crm/contact-export/1' }, error: null, status: 200 })
		},
	} as unknown as ClientCrm
	const proposerFichier = vi.fn()
	const onAnonymise = vi.fn()
	render(
		<BlocRgpdContact
			client={client}
			idContact="a0d17000-0000-4000-8000-0000000000c1"
			nom="Régis Témoin"
			anonymiseLe={options.anonymiseLe ?? null}
			administration={options.administration ?? 'permise'}
			onAnonymise={onAnonymise}
			proposerFichier={proposerFichier}
		/>,
	)
	return { appels, proposerFichier, onAnonymise }
}

describe('la zone RGPD (§5.67)', () => {
	it('exporte : le fichier est proposé sous son nom, et l’issue est annoncée', async () => {
		const { proposerFichier } = monter()
		await userEvent.click(screen.getByRole('button', { name: 'Exporter les données' }))
		await waitFor(() => expect(proposerFichier).toHaveBeenCalledTimes(1))
		expect(proposerFichier.mock.calls[0]?.[0]).toMatch(/^contact-a0d17000-\d{4}-\d{2}-\d{2}\.json$/)
		expect(screen.getByRole('status').textContent).toContain('Fichier téléchargé')
	})

	it('la capacité refusée : les deux commandes éteintes, lisibles, citant le motif', () => {
		monter({ administration: 'refusee' })
		const motif = screen.getByTestId('motif-rgpd-contact')
		for (const nom of ['Exporter les données', 'Anonymiser ce contact']) {
			const commande = screen.getByRole('button', { name: nom }) as HTMLButtonElement
			expect(commande.disabled).toBe(true)
			expect(commande.getAttribute('aria-describedby')).toBe(motif.id)
		}
	})

	it('anonymiser : la confirmation dans le flux, éteinte tant que le nom retapé diffère, puis la fiche relue', async () => {
		const { appels, onAnonymise } = monter({ reponse: { data: null, error: null, status: 204 } })
		await userEvent.click(screen.getByRole('button', { name: 'Anonymiser ce contact' }))
		const confirmer = screen.getByRole('button', { name: 'Anonymiser définitivement' }) as HTMLButtonElement
		expect(confirmer.disabled).toBe(true)
		expect(document.activeElement).toBe(screen.getByLabelText('Nom du contact'))
		await userEvent.type(screen.getByLabelText('Nom du contact'), 'Régis Témoi')
		expect(confirmer.disabled).toBe(true)
		await userEvent.type(screen.getByLabelText('Nom du contact'), 'n')
		expect(confirmer.disabled).toBe(false)
		await userEvent.click(confirmer)
		await waitFor(() => expect(onAnonymise).toHaveBeenCalledTimes(1))
		expect(appels).toEqual(['anonymize_contact'])
		expect(screen.getByRole('status').textContent).toBe('Contact anonymisé.')
	})

	it('un refus de la base est dit dans la zone, la confirmation reste ouverte', async () => {
		monter({ reponse: { data: null, error: { code: '42501', message: 'reserved_to_admins' }, status: 403 } })
		await userEvent.click(screen.getByRole('button', { name: 'Anonymiser ce contact' }))
		await userEvent.type(screen.getByLabelText('Nom du contact'), 'Régis Témoin')
		await userEvent.click(screen.getByRole('button', { name: 'Anonymiser définitivement' }))
		expect((await screen.findByRole('alert')).textContent).toBe('Ce geste est réservé aux administrateurs de l’espace.')
		expect(screen.getByTestId('confirmation-anonymisation')).toBeTruthy()
	})

	it('Échap referme la confirmation et rend le focus à la commande', async () => {
		monter()
		const commande = screen.getByRole('button', { name: 'Anonymiser ce contact' })
		await userEvent.click(commande)
		await userEvent.keyboard('{Escape}')
		expect(screen.queryByTestId('confirmation-anonymisation')).toBeNull()
		await waitFor(() => expect(document.activeElement).toBe(commande))
	})

	it('un contact anonymisé : « Anonymiser » absent, la phrase datée à sa place, l’export reste', () => {
		monter({ anonymiseLe: '2026-10-26T10:00:00Z' })
		expect(screen.queryByRole('button', { name: 'Anonymiser ce contact' })).toBeNull()
		expect(screen.getByTestId('contact-deja-anonymise').textContent).toContain('26 octobre 2026')
		expect(screen.getByRole('button', { name: 'Exporter les données' })).toBeTruthy()
	})
})
