// @verifies CRM-009 (docs/BACKLOG.md) — écran de connexion utilisable au clavier, retour interne
// @verifies CRM-092 (docs/BACKLOG.md) — une seule action, refus et attentes sur deux surfaces
// @verifies docs/SPEC-session-sso.md §9.1 (carte, action unique, configuration absente), §9.2 (refus :
//           danger, `role="alert"` ; attentes : accent, `CircleDashed`, `role="status"`, titre, adresse
//           interpolée ; `aria-describedby`) ; docs/SPEC-auth.md §9.1 (adresse de retour), §10.5
// @verifies docs/DESIGN_SYSTEM.md §5.10 (aucune commande morte), §5.12 (connexion), §8 (clavier)

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router'
import type { Echangeur, IssueGeste } from '../lib/session'
import { CLE_TRANSACTION_SSO, type ConfigurationSso, type TransactionSso } from '../lib/sso'
import { creerPorteurJeton, type ClientCrm } from '../lib/supabase'
import { FournisseurAuthentification } from './Authentification'
import { EcranConnexion } from './EcranConnexion'

afterEach(() => {
	cleanup()
	vi.unstubAllGlobals()
	sessionStorage.clear()
})

const SSO: ConfigurationSso = { emetteur: 'https://sso.exemple.tld/realms/lelabs', clientId: 'lelabs-crm-serveur' }
const DECOUVERTE = {
	issuer: SSO.emetteur,
	authorization_endpoint: 'https://sso.exemple.tld/realms/lelabs/protocol/openid-connect/auth',
	token_endpoint: 'https://sso.exemple.tld/realms/lelabs/protocol/openid-connect/token',
}

function fauxClient(): ClientCrm {
	const requete = { select: () => requete, eq: () => requete, maybeSingle: async () => ({ data: null, error: null, status: 200 }) }
	return { realtime: { setAuth: vi.fn(async () => undefined) }, from: () => requete } as unknown as ClientCrm
}

function echangeur(restauration: IssueGeste = { ok: false, nature: 'session_absente' }): Echangeur {
	return { prolonger: vi.fn(async () => restauration), ouvrir: vi.fn(), fermer: vi.fn() }
}

function monter(options: {
	readonly etat?: unknown
	readonly sso?: ConfigurationSso | null
	readonly apiConfiguree?: boolean
	readonly rediriger?: (url: string) => void
	readonly restauration?: IssueGeste
}) {
	return render(
		<MemoryRouter initialEntries={[{ pathname: '/connexion', state: options.etat }]}>
			<FournisseurAuthentification client={fauxClient()} porteur={creerPorteurJeton()} echangeur={echangeur(options.restauration)}>
				<Routes>
					<Route
						path="/connexion"
						element={
							<EcranConnexion
								sso={options.sso === undefined ? SSO : options.sso}
								apiConfiguree={options.apiConfiguree ?? true}
								rediriger={options.rediriger ?? vi.fn()}
							/>
						}
					/>
					<Route path="/tracks/test" element={<h1>Destination réelle</h1>} />
					<Route path="/" element={<h1>Accueil réel</h1>} />
				</Routes>
			</FournisseurAuthentification>
		</MemoryRouter>,
	)
}

const ACTION = { name: 'Se connecter avec LeLabs' }

describe('écran de connexion', () => {
	it('n’offre qu’une action, primaire, et plus aucun champ', async () => {
		monter({})
		const action = await screen.findByRole('button', ACTION)
		expect(screen.getAllByRole('button')).toHaveLength(1)
		expect(screen.queryByRole('textbox')).toBeNull()
		expect(document.querySelector('input')).toBeNull()
		expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Se connecter')
		expect(screen.getByText(/inscrites par un administrateur de leur espace, avec un compte LeLabs vérifié/)).toBeTruthy()
		expect(action.getAttribute('aria-describedby')).toBeNull()
	})

	it.each([
		['sans configuration du SSO', { sso: null }],
		['sans configuration de l’API', { apiConfiguree: false }],
	])('ne rend aucune commande morte %s, et dit pourquoi', async (_cas, options) => {
		monter(options)
		expect((await screen.findByRole('alert')).textContent).toBe("La connexion n'est pas configurée sur ce déploiement.")
		expect(screen.queryByRole('button', ACTION)).toBeNull()
	})

	it('écrit la transaction dans le stockage d’onglet puis quitte vers l’autorisation PKCE, au clavier', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(DECOUVERTE), { status: 200 })))
		const rediriger = vi.fn()
		monter({ rediriger, etat: { retour: '/tracks/test' } })
		;(await screen.findByRole('button', ACTION)).focus()
		await userEvent.setup().keyboard('{Enter}')

		await waitFor(() => expect(rediriger).toHaveBeenCalledOnce())
		const url = new URL(String(rediriger.mock.calls[0]?.[0]))
		expect(url.searchParams.get('client_id')).toBe('lelabs-crm-serveur')
		expect(url.searchParams.get('code_challenge_method')).toBe('S256')
		expect(url.searchParams.has('nonce')).toBe(false)
		const transaction = JSON.parse(sessionStorage.getItem(CLE_TRANSACTION_SSO) ?? 'null') as TransactionSso
		expect(transaction.retour).toBe('/tracks/test')
		expect(url.searchParams.get('state')).toBe(transaction.state)
		expect(localStorage.length).toBe(0)
		expect(screen.getByRole('button', { name: 'Redirection vers LeLabs…' })).toHaveProperty('disabled', true)
	})

	it('rend la panne de découverte comme une panne, et rend l’action à nouveau disponible', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))))
		monter({})
		const bouton = await screen.findByRole('button', ACTION)
		await userEvent.setup().click(bouton)

		const alerte = await screen.findByRole('alert')
		expect(alerte.textContent).toBe("Le serveur n'a pas répondu. Vérifiez votre connexion, puis réessayez.")
		expect((bouton as HTMLButtonElement).disabled).toBe(false)
		expect(bouton.getAttribute('aria-describedby')).toBe(alerte.id)
	})

	it.each([
		['sso_annule', 'La connexion LeLabs a été annulée.'],
		['sso_echec', "La connexion LeLabs n'a pas abouti. Recommencez depuis cet écran."],
		['reseau', "Le serveur n'a pas répondu. Vérifiez votre connexion, puis réessayez."],
		['session_expiree', 'Votre session a pris fin. Reconnectez-vous avec LeLabs.'],
	])('rend le refus %s sur la surface danger', async (nature, message) => {
		monter({ etat: { erreurSso: nature } })
		const alerte = await screen.findByRole('alert')
		expect(alerte.textContent).toBe(message)
		expect(alerte.className).toContain('bg-danger-soft')
		expect(screen.queryByRole('status')).toBeNull()
		expect(screen.getByRole('button', ACTION).getAttribute('aria-describedby')).toBe(alerte.id)
	})

	it.each([
		[
			'adresse_non_verifiee',
			"Votre adresse personne@exemple.tld n'est pas encore vérifiée auprès de LeLabs. Vérifiez-la depuis votre compte LeLabs, puis reconnectez-vous.",
		],
		[
			'attente_verification',
			"Votre compte LeLabs personne@exemple.tld n'est pas encore vérifié. Un administrateur de LeLabs doit confirmer votre identité avant que le CRM vous ouvre ses espaces ; ce geste est humain et peut prendre du temps.",
		],
		[
			'attente_espace',
			"Aucun espace du CRM ne vous attend à l'adresse personne@exemple.tld. Demandez à un administrateur de votre espace de vous inscrire avec cette adresse, puis reconnectez-vous.",
		],
	])('rend l’attente %s sur la surface accent, avec son adresse', async (nature, message) => {
		monter({ etat: { erreurSso: nature, adresse: 'personne@exemple.tld' } })
		const attente = await screen.findByRole('status')
		expect(attente.textContent).toBe(`Accès en attente${message}`)
		expect(attente.className).toContain('bg-accent-soft')
		expect(attente.className).toContain('text-accent-on-soft')
		expect(attente.querySelector('svg.lucide-circle-dashed')).not.toBeNull()
		expect(screen.queryByRole('alert')).toBeNull()
		// L'action reste disponible : se reconnecter est le seul geste utile, une fois la cause levée.
		const action = screen.getByRole('button', ACTION)
		expect((action as HTMLButtonElement).disabled).toBe(false)
		expect(action.getAttribute('aria-describedby')).toBe(attente.id)
	})

	it('ignore une valeur hors dictionnaire, et une attente sans adresse', async () => {
		monter({ etat: { erreurSso: '<script>' } })
		await screen.findByRole('button', ACTION)
		expect(screen.queryByRole('alert')).toBeNull()
		cleanup()
		monter({ etat: { erreurSso: 'attente_espace' } })
		await screen.findByRole('button', ACTION)
		expect(screen.queryByRole('status')).toBeNull()
		expect(screen.queryByRole('alert')).toBeNull()
	})

	it('une session déjà ouverte rejoint l’adresse de retour interne, jamais une adresse externe', async () => {
		const ouverte: IssueGeste = {
			ok: true,
			session: { jeton: 'j', expireA: Math.floor(Date.now() / 1000) + 300, dureeS: 300, identite: { id: 'u', email: 'a@b.tld', nom: 'A' } },
		}
		monter({ restauration: ouverte, etat: { retour: '/tracks/test' } })
		await waitFor(() => expect(screen.getByRole('heading').textContent).toBe('Destination réelle'))
		cleanup()
		monter({ restauration: ouverte, etat: { retour: '//exemple.test' } })
		await waitFor(() => expect(screen.getByRole('heading').textContent).toBe('Accueil réel'))
	})
})
