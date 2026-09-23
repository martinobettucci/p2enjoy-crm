// @verifies CRM-091 (docs/BACKLOG.md) — route de retour : jugement du retour, transaction à usage unique
// @verifies CRM-092 (docs/BACKLOG.md) — le code et le vérificateur sont remis à l'échangeur, jamais au
//           point de jeton de LeLabs par le navigateur
// @verifies docs/SPEC-session-sso.md §4 (points 3 à 6), §5.2, §9.2 ; docs/SPEC-auth.md §10.3, §10.5
// @verifies docs/DESIGN_SYSTEM.md §5.12 (refus en `role="alert"`, attente en `role="status"`)

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { StrictMode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router'
import type { Echangeur, IssueGeste } from '../lib/session'
import { CLE_TRANSACTION_SSO, type ConfigurationSso, type StockageTransaction, type TransactionSso } from '../lib/sso'
import { creerPorteurJeton, type ClientCrm } from '../lib/supabase'
import { FournisseurAuthentification } from './Authentification'
import { EcranConnexion } from './EcranConnexion'
import { RetourSso } from './RetourSso'

afterEach(() => {
	cleanup()
	vi.unstubAllGlobals()
})

const SSO: ConfigurationSso = { emetteur: 'https://sso.exemple.tld/realms/lelabs', clientId: 'lelabs-crm-serveur' }

const TRANSACTION: TransactionSso = {
	state: 'etat-1',
	verificateur: 'verificateur-1',
	retour: '/tracks/test',
	redirectUri: 'http://localhost:3000/auth/retour',
	expireA: Number.MAX_SAFE_INTEGER,
}

function fauxClient(): ClientCrm {
	const requete = { select: () => requete, eq: () => requete, maybeSingle: async () => ({ data: null, error: null, status: 200 }) }
	return { realtime: { setAuth: vi.fn(async () => undefined) }, from: () => requete } as unknown as ClientCrm
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

function monterRetour(recherche: string, ouverture: IssueGeste, magasin: StockageTransaction, strict = false) {
	const echangeur: Echangeur & { ouvrir: ReturnType<typeof vi.fn> } = {
		prolonger: vi.fn(async () => ({ ok: false, nature: 'session_absente' }) as IssueGeste),
		ouvrir: vi.fn(async () => ouverture),
		fermer: vi.fn(),
	}
	const porteur = creerPorteurJeton()
	const arbre = (
		<MemoryRouter initialEntries={[`/auth/retour${recherche}`]}>
			<FournisseurAuthentification client={fauxClient()} porteur={porteur} echangeur={echangeur}>
				<Routes>
					<Route path="/auth/retour" element={<RetourSso stockage={magasin} />} />
					<Route path="/connexion" element={<EcranConnexion sso={SSO} apiConfiguree rediriger={vi.fn()} />} />
					<Route path="/tracks/test" element={<h1>Destination réelle</h1>} />
				</Routes>
			</FournisseurAuthentification>
		</MemoryRouter>
	)
	render(strict ? <StrictMode>{arbre}</StrictMode> : arbre)
	return { echangeur, porteur }
}

const SESSION: IssueGeste = {
	ok: true,
	session: {
		jeton: 'jeton-interne',
		expireA: Math.floor(Date.now() / 1000) + 300,
		dureeS: 300,
		identite: { id: 'u-1', email: 'admin@exemple.tld', nom: 'Admin' },
	},
}

describe('route de retour /auth/retour', () => {
	it('remet code, vérificateur et URL de retour à l’échangeur, une seule fois, puis rejoint l’adresse de retour', async () => {
		const requete = vi.fn()
		vi.stubGlobal('fetch', requete)
		const magasin = stockage()
		magasin.setItem(CLE_TRANSACTION_SSO, JSON.stringify(TRANSACTION))
		const { echangeur, porteur } = monterRetour('?code=le-code&state=etat-1', SESSION, magasin, true)

		await screen.findByRole('heading', { name: 'Destination réelle' })
		expect(echangeur.ouvrir).toHaveBeenCalledOnce()
		expect(echangeur.ouvrir).toHaveBeenCalledWith('le-code', 'verificateur-1', 'http://localhost:3000/auth/retour')
		expect(porteur.lire()).toBe('jeton-interne')
		expect(magasin.valeurs.has(CLE_TRANSACTION_SSO)).toBe(false)
		// Le navigateur ne parle jamais au point de jeton de LeLabs.
		expect(requete).not.toHaveBeenCalled()
	})

	it.each([
		['?error=access_denied&state=etat-1', 'La connexion LeLabs a été annulée.'],
		['?code=le-code&state=un-autre-etat', "La connexion LeLabs n'a pas abouti. Recommencez depuis cet écran."],
	])('ramène %s à /connexion avec son refus, sans rien remettre à l’échangeur', async (recherche, message) => {
		const magasin = stockage()
		magasin.setItem(CLE_TRANSACTION_SSO, JSON.stringify(TRANSACTION))
		const { echangeur } = monterRetour(recherche, SESSION, magasin)

		expect((await screen.findByRole('alert')).textContent).toBe(message)
		expect(echangeur.ouvrir).not.toHaveBeenCalled()
		expect(magasin.valeurs.has(CLE_TRANSACTION_SSO)).toBe(false)
	})

	it('rend l’attente décidée par l’échangeur, avec l’adresse de la personne', async () => {
		const magasin = stockage()
		magasin.setItem(CLE_TRANSACTION_SSO, JSON.stringify(TRANSACTION))
		const { porteur } = monterRetour(
			'?code=le-code&state=etat-1',
			{ ok: false, nature: 'attente_espace', adresse: 'inconnu@exemple.tld' },
			magasin,
		)

		const texte = await screen.findByText(/Aucun espace du CRM ne vous attend à l'adresse inconnu@exemple\.tld\./)
		expect(texte.closest('[role="status"]')?.textContent).toContain('Accès en attente')
		expect(porteur.lire()).toBeNull()
	})

	it('refuse un retour sans transaction — autre onglet, stockage indisponible, retour rejoué', async () => {
		const { echangeur } = monterRetour('?code=le-code&state=etat-1', SESSION, stockage())

		expect((await screen.findByRole('alert')).textContent).toBe("La connexion LeLabs n'a pas abouti. Recommencez depuis cet écran.")
		expect(echangeur.ouvrir).not.toHaveBeenCalled()
	})

	it('annonce l’échange pendant qu’il a lieu', async () => {
		const magasin = stockage()
		magasin.setItem(CLE_TRANSACTION_SSO, JSON.stringify(TRANSACTION))
		monterRetour('?code=le-code&state=etat-1', SESSION, magasin)
		expect(screen.getByLabelText('Connexion LeLabs en cours')).toBeTruthy()
		await waitFor(() => expect(screen.getByRole('heading', { name: 'Destination réelle' })).toBeTruthy())
	})
})
