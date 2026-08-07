// @verifies CRM-011 (docs/BACKLOG.md) — restauration, connexion et déconnexion partagées
// @verifies docs/SPEC-auth.md §9.1 (restauration avant lectures), §9.4 (déconnexion)
// @verifies docs/SPEC-webapp.md §6.2 (état de session unique)

import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Session, User } from '@supabase/supabase-js'
import type { ClientCrm } from '../lib/supabase'
import { FournisseurAuthentification, useAuthentification } from './Authentification'

afterEach(cleanup)

const UTILISATEUR = { id: 'u-1', email: 'admin@p2enjoy.test' } as User

function Observateur() {
	const { etat, connecter, deconnecter } = useAuthentification()
	return (
		<div>
			<span data-testid="statut">{etat.statut}</span>
			<button type="button" onClick={() => void connecter(' admin@p2enjoy.test ', 'secret')}>
				connexion
			</button>
			<button type="button" onClick={() => void deconnecter()}>
				déconnexion
			</button>
		</div>
	)
}

function fauxClient(sessionInitiale: Session | null = null) {
	let ecoute: ((evenement: string, session: Session | null) => void) | undefined
	const signInWithPassword = vi.fn(async () => ({ data: { user: UTILISATEUR, session: {} }, error: null }))
	const signOut = vi.fn(async () => ({ error: null }))
	const client = {
		auth: {
			getSession: vi.fn(async () => ({ data: { session: sessionInitiale }, error: null })),
		onAuthStateChange: vi.fn((rappel: (evenement: string, session: Session | null) => void) => {
				ecoute = rappel
				return { data: { subscription: { unsubscribe: vi.fn() } } }
			}),
			signInWithPassword,
			signOut,
		},
	} as unknown as ClientCrm
	return { client, signInWithPassword, signOut, emettre: (session: Session | null) => ecoute?.('SIGNED_IN', session) }
}

describe('fournisseur de session', () => {
	it('ne rend pas un appelant anonyme pendant la restauration', async () => {
		let resoudre!: (valeur: unknown) => void
		const client = {
			auth: {
				getSession: () => new Promise((resolution) => (resoudre = resolution)),
				onAuthStateChange: () => ({ data: { subscription: { unsubscribe: vi.fn() } } }),
			},
		} as unknown as ClientCrm
		render(
			<FournisseurAuthentification client={client}>
				<Observateur />
			</FournisseurAuthentification>,
		)
		expect(screen.getByTestId('statut').textContent).toBe('chargement')

		await act(async () => resoudre({ data: { session: null }, error: null }))
		expect(screen.getByTestId('statut').textContent).toBe('anonyme')
	})

	it('connecte avec l’email normalisé puis ferme la vraie session', async () => {
		const { client, signInWithPassword, signOut } = fauxClient()
		render(
			<FournisseurAuthentification client={client}>
				<Observateur />
			</FournisseurAuthentification>,
		)
		await waitFor(() => expect(screen.getByTestId('statut').textContent).toBe('anonyme'))

		screen.getByRole('button', { name: 'connexion' }).click()
		await waitFor(() => expect(screen.getByTestId('statut').textContent).toBe('authentifie'))
		expect(signInWithPassword).toHaveBeenCalledWith({
			email: 'admin@p2enjoy.test',
			password: 'secret',
		})

		screen.getByRole('button', { name: 'déconnexion' }).click()
		await waitFor(() => expect(screen.getByTestId('statut').textContent).toBe('anonyme'))
		expect(signOut).toHaveBeenCalledOnce()
	})
})
