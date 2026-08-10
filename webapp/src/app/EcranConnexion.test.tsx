// @verifies CRM-009 (docs/BACKLOG.md) — formulaire de connexion utilisable au clavier
// @verifies docs/SPEC-auth.md §9.1 (retour), §9.3 (refus générique, double soumission)
// @verifies docs/DESIGN_SYSTEM.md §5.7 (labels), §5.12 (connexion), §8 (focus)

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { User } from '@supabase/supabase-js'
import { MemoryRouter, Route, Routes } from 'react-router'
import type { ClientCrm } from '../lib/supabase'
import { FournisseurAuthentification } from './Authentification'
import { EcranConnexion } from './EcranConnexion'

afterEach(cleanup)

const UTILISATEUR = { id: 'u-1', email: 'admin@p2enjoy.test' } as User

function clientAvecConnexion(
	connexion: (entree: { email: string; password: string }) => Promise<unknown>,
): ClientCrm {
	return {
		auth: {
			getSession: vi.fn(async () => ({ data: { session: null }, error: null })),
			onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
			signInWithPassword: connexion,
		},
	} as unknown as ClientCrm
}

function monter(client: ClientCrm, retour: unknown = undefined) {
	return render(
		<MemoryRouter initialEntries={[{ pathname: '/connexion', state: { retour } }]}>
			<FournisseurAuthentification client={client}>
				<Routes>
					<Route path="/connexion" element={<EcranConnexion />} />
					<Route path="/tracks/test" element={<h1>Destination réelle</h1>} />
					<Route path="/" element={<h1>Accueil réel</h1>} />
				</Routes>
			</FournisseurAuthentification>
		</MemoryRouter>,
	)
}

describe('écran de connexion', () => {
	it('porte deux champs libellés et les attributs d’autocomplétion attendus', async () => {
		monter(clientAvecConnexion(vi.fn()))
		const email = await screen.findByRole('textbox', { name: 'Adresse email' })
		const motDePasse = screen.getByLabelText('Mot de passe')

		expect(email.getAttribute('autocomplete')).toBe('email')
		expect(motDePasse.getAttribute('autocomplete')).toBe('current-password')
		expect(document.activeElement).toBe(email)
	})

	it('rend le même refus assaini, conserve le mot de passe et remet le focus sur l’email', async () => {
		const connexion = vi.fn(async () => ({
			data: { user: null, session: null },
			error: { status: 400, code: 'invalid_credentials', message: 'Invalid login credentials' },
		}))
		monter(clientAvecConnexion(connexion))
		const user = userEvent.setup()
		const email = await screen.findByRole('textbox', { name: 'Adresse email' })
		const motDePasse = screen.getByLabelText('Mot de passe')

		await user.type(email, 'inconnu@p2enjoy.test')
		await user.type(motDePasse, 'mot-de-passe-invalide')
		await user.click(screen.getByRole('button', { name: 'Se connecter' }))

		const alerte = await screen.findByRole('alert')
		expect(alerte.textContent).toBe("L'adresse email ou le mot de passe est incorrect.")
		expect((motDePasse as HTMLInputElement).value).toBe('mot-de-passe-invalide')
		expect(document.activeElement).toBe(email)
	})

	it('empêche deux connexions concurrentes', async () => {
		let terminer!: (valeur: unknown) => void
		const connexion = vi.fn(
			() => new Promise((resolution) => (terminer = resolution)),
		)
		monter(clientAvecConnexion(connexion))
		const user = userEvent.setup()
		await user.type(await screen.findByRole('textbox', { name: 'Adresse email' }), 'admin@p2enjoy.test')
		await user.type(screen.getByLabelText('Mot de passe'), 'SeedDev2026Local')
		const bouton = screen.getByRole('button', { name: 'Se connecter' })

		await user.click(bouton)
		expect((bouton as HTMLButtonElement).disabled).toBe(true)
		await user.click(bouton)
		expect(connexion).toHaveBeenCalledOnce()

		terminer({ data: { user: null, session: null }, error: { status: 400 } })
		await screen.findByRole('alert')
	})

	it('revient à l’adresse métier interne après succès', async () => {
		const connexion = vi.fn(async () => ({ data: { user: UTILISATEUR, session: {} }, error: null }))
		monter(clientAvecConnexion(connexion), '/tracks/test')
		const user = userEvent.setup()
		await user.type(await screen.findByRole('textbox', { name: 'Adresse email' }), 'admin@p2enjoy.test')
		await user.type(screen.getByLabelText('Mot de passe'), 'SeedDev2026Local')
		await user.click(screen.getByRole('button', { name: 'Se connecter' }))

		await waitFor(() => expect(screen.getByRole('heading').textContent).toBe('Destination réelle'))
	})

	it('refuse une adresse de retour externe', async () => {
		const connexion = vi.fn(async () => ({ data: { user: UTILISATEUR, session: {} }, error: null }))
		monter(clientAvecConnexion(connexion), '//exemple.test')
		const user = userEvent.setup()
		await user.type(await screen.findByRole('textbox', { name: 'Adresse email' }), 'admin@p2enjoy.test')
		await user.type(screen.getByLabelText('Mot de passe'), 'SeedDev2026Local')
		await user.click(screen.getByRole('button', { name: 'Se connecter' }))

		await waitFor(() => expect(screen.getByRole('heading').textContent).toBe('Accueil réel'))
	})
})
