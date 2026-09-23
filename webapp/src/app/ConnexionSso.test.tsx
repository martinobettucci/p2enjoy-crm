// @verifies CRM-091 (docs/BACKLOG.md) — action SSO de l'écran de connexion et route de retour
// @verifies docs/SPEC-auth.md §10.2 (bouton absent sans configuration), §10.3 (parcours complet),
//           §10.4 (refus rendus par le dictionnaire fermé), §10.5 (transaction retirée au retour)
// @verifies docs/DESIGN_SYSTEM.md §5.12 (refus en role="alert", aucune commande morte)

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StrictMode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { User } from '@supabase/supabase-js'
import { MemoryRouter, Route, Routes } from 'react-router'
import { CLE_TRANSACTION_SSO, type ConfigurationSso, type StockageTransaction, type TransactionSso } from '../lib/sso'
import type { ClientCrm } from '../lib/supabase'
import { FournisseurAuthentification } from './Authentification'
import { EcranConnexion } from './EcranConnexion'
import { RetourSso } from './RetourSso'

afterEach(() => {
	cleanup()
	vi.unstubAllGlobals()
	sessionStorage.clear()
})

const SSO: ConfigurationSso = { emetteur: 'https://sso.exemple.tld/realms/lelabs', clientId: 'lelabs-crm' }
const POINT_JETON = 'https://sso.exemple.tld/realms/lelabs/protocol/openid-connect/token'
const DECOUVERTE = {
	issuer: SSO.emetteur,
	authorization_endpoint: 'https://sso.exemple.tld/realms/lelabs/protocol/openid-connect/auth',
	token_endpoint: POINT_JETON,
}
const UTILISATEUR = { id: 'u-1', email: 'admin@p2enjoy.test' } as User

function client(signInWithIdToken: (entree: unknown) => Promise<unknown> = vi.fn()): ClientCrm {
	return {
		auth: {
			getSession: vi.fn(async () => ({ data: { session: null }, error: null })),
			onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
			signInWithPassword: vi.fn(),
			signInWithIdToken,
		},
	} as unknown as ClientCrm
}

function stockage(): StockageTransaction & { readonly valeurs: Map<string, string> } {
	const valeurs = new Map<string, string>()
	return {
		valeurs,
		getItem: (cle) => valeurs.get(cle) ?? null,
		setItem: (cle, valeur) => void valeurs.set(cle, valeur),
		removeItem: (cle) => void valeurs.delete(cle),
	}
}

describe('action « Se connecter avec LeLabs »', () => {
	function monterEcran(options: { sso?: ConfigurationSso | null; rediriger?: (url: string) => void; etat?: unknown }) {
		return render(
			<MemoryRouter initialEntries={[{ pathname: '/connexion', state: options.etat }]}>
				<FournisseurAuthentification client={client()}>
					<Routes>
						<Route
							path="/connexion"
							element={<EcranConnexion sso={options.sso ?? null} rediriger={options.rediriger ?? vi.fn()} />}
						/>
					</Routes>
				</FournisseurAuthentification>
			</MemoryRouter>,
		)
	}

	it('n’est pas rendue sans configuration : aucune commande morte', async () => {
		monterEcran({ sso: null })
		await screen.findByRole('button', { name: 'Se connecter' })
		expect(screen.queryByRole('button', { name: 'Se connecter avec LeLabs' })).toBeNull()
	})

	it('écrit la transaction dans le stockage d’onglet puis quitte vers l’autorisation PKCE', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(DECOUVERTE), { status: 200 })))
		const rediriger = vi.fn()
		monterEcran({ sso: SSO, rediriger, etat: { retour: '/tracks/test' } })
		await userEvent.setup().click(await screen.findByRole('button', { name: 'Se connecter avec LeLabs' }))

		await waitFor(() => expect(rediriger).toHaveBeenCalledOnce())
		const url = new URL(String(rediriger.mock.calls[0]?.[0]))
		expect(url.searchParams.get('client_id')).toBe('lelabs-crm')
		expect(url.searchParams.get('code_challenge_method')).toBe('S256')
		expect(url.searchParams.get('redirect_uri')).toBe(`${window.location.origin}/auth/retour`)
		const transaction = JSON.parse(sessionStorage.getItem(CLE_TRANSACTION_SSO) ?? 'null') as TransactionSso
		expect(transaction.retour).toBe('/tracks/test')
		expect(url.searchParams.get('state')).toBe(transaction.state)
		expect(localStorage.length).toBe(0)
	})

	it('rend la panne de découverte comme une panne, et rend l’action à nouveau disponible', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))))
		monterEcran({ sso: SSO })
		const bouton = await screen.findByRole('button', { name: 'Se connecter avec LeLabs' })
		await userEvent.setup().click(bouton)

		const alerte = await screen.findByRole('alert')
		expect(alerte.textContent).toBe("Le serveur n'a pas répondu. Vérifiez votre connexion, puis réessayez.")
		expect((bouton as HTMLButtonElement).disabled).toBe(false)
	})

	it('rend le refus rapporté par la route de retour, et ignore une valeur hors dictionnaire', async () => {
		monterEcran({ sso: SSO, etat: { erreurSso: 'sso_sans_compte' } })
		expect((await screen.findByRole('alert')).textContent).toBe(
			"Aucun compte du CRM ne correspond à ce compte LeLabs. L'accès exige une invitation à la même adresse, vérifiée auprès de LeLabs.",
		)
		cleanup()
		monterEcran({ sso: SSO, etat: { erreurSso: '<script>' } })
		await screen.findByRole('button', { name: 'Se connecter avec LeLabs' })
		expect(screen.queryByRole('alert')).toBeNull()
	})
})

describe('route de retour /auth/retour', () => {
	const TRANSACTION: TransactionSso = {
		state: 'etat-1',
		verificateur: 'verificateur-1',
		nonce: 'nonce-brut-1',
		retour: '/tracks/test',
		redirectUri: 'http://localhost:3000/auth/retour',
		pointJeton: POINT_JETON,
		expireA: Number.MAX_SAFE_INTEGER,
	}

	function monterRetour(recherche: string, crm: ClientCrm, magasin: StockageTransaction, strict = false) {
		const arbre = (
			<MemoryRouter initialEntries={[`/auth/retour${recherche}`]}>
				<FournisseurAuthentification client={crm}>
					<Routes>
						<Route path="/auth/retour" element={<RetourSso sso={SSO} stockage={magasin} />} />
						<Route path="/connexion" element={<EcranConnexion sso={SSO} rediriger={vi.fn()} />} />
						<Route path="/tracks/test" element={<h1>Destination réelle</h1>} />
					</Routes>
				</FournisseurAuthentification>
			</MemoryRouter>
		)
		return render(strict ? <StrictMode>{arbre}</StrictMode> : arbre)
	}

	it('échange le code, remet l’id_token et le nonce BRUT à GoTrue, puis rejoint l’adresse de retour', async () => {
		const requete = vi.fn(async () => new Response(JSON.stringify({ id_token: 'jeton.id' }), { status: 200 }))
		vi.stubGlobal('fetch', requete)
		const magasin = stockage()
		magasin.setItem(CLE_TRANSACTION_SSO, JSON.stringify(TRANSACTION))
		const signIn = vi.fn(async () => ({ data: { user: UTILISATEUR, session: {} }, error: null }))
		monterRetour('?code=le-code&state=etat-1', client(signIn), magasin, true)

		await screen.findByRole('heading', { name: 'Destination réelle' })
		expect(signIn).toHaveBeenCalledWith({ provider: 'keycloak', token: 'jeton.id', nonce: 'nonce-brut-1' })
		expect(requete).toHaveBeenCalledOnce()
		expect(magasin.valeurs.has(CLE_TRANSACTION_SSO)).toBe(false)
	})

	it.each([
		['?error=access_denied&state=etat-1', 'La connexion LeLabs a été annulée.'],
		['?code=le-code&state=un-autre-etat', "La connexion LeLabs n'a pas abouti. Recommencez depuis cet écran."],
	])('ramène %s à /connexion avec son refus, sans rien échanger', async (recherche, message) => {
		const requete = vi.fn()
		vi.stubGlobal('fetch', requete)
		const magasin = stockage()
		magasin.setItem(CLE_TRANSACTION_SSO, JSON.stringify(TRANSACTION))
		monterRetour(recherche, client(), magasin)

		expect((await screen.findByRole('alert')).textContent).toBe(message)
		expect(requete).not.toHaveBeenCalled()
		expect(magasin.valeurs.has(CLE_TRANSACTION_SSO)).toBe(false)
	})

	it('rend « aucun compte » quand GoTrue refuse l’identité', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ id_token: 'jeton.id' }), { status: 200 })))
		const magasin = stockage()
		magasin.setItem(CLE_TRANSACTION_SSO, JSON.stringify(TRANSACTION))
		const signIn = vi.fn(async () => ({
			data: { user: null, session: null },
			error: { status: 422, code: 'signup_disabled', message: 'Signups not allowed for this instance' },
		}))
		monterRetour('?code=le-code&state=etat-1', client(signIn), magasin)

		expect((await screen.findByRole('alert')).textContent).toContain('Aucun compte du CRM ne correspond')
	})

	it('refuse un retour sans transaction — autre onglet, stockage indisponible, retour rejoué', async () => {
		const requete = vi.fn()
		vi.stubGlobal('fetch', requete)
		monterRetour('?code=le-code&state=etat-1', client(), stockage())

		expect((await screen.findByRole('alert')).textContent).toBe(
			"La connexion LeLabs n'a pas abouti. Recommencez depuis cet écran.",
		)
		expect(requete).not.toHaveBeenCalled()
	})
})
