// @verifies CRM-009 (docs/BACKLOG.md) — restauration avant les lectures, état de session unique
// @verifies CRM-092 (docs/BACKLOG.md) — session ouverte, prolongée et fermée par l'échangeur
// @verifies docs/SPEC-session-sso.md §8.3 (jeton en mémoire, rien sur l'appareil), §8.4 (restauration,
//           rafraîchissement 60 s avant l'échéance, panne réessayée jusqu'à l'échéance, fin de session,
//           K18 : Realtime attendu avant la session), §8.5 (déconnexion sans révocation)
// @verifies docs/SPEC-auth.md §9.1 ; docs/SPEC-webapp.md §6.2
// @verifies CRM-092 (docs/BACKLOG.md) tranche T9 — docs/SPEC-session-sso.md §8.7 (aucune page sans
//           session), §13 (preuve unitaire T9) ; docs/DESIGN_SYSTEM.md §5.12 ; docs/JOURNAL.md décision 601

import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import type { Echangeur, IssueFermeture, IssueGeste, SessionInterne } from '../lib/session'
import { CHEMIN_RETOUR_SSO } from '../lib/sso'
import { creerPorteurJeton, type ClientCrm, type PorteurJeton } from '../lib/supabase'
import { ExigerSession, useRenvoiFinSession } from './App'
import { AVANCE_RAFRAICHISSEMENT_MS, FournisseurAuthentification, useAuthentification } from './Authentification'

const T0 = 1_790_000_000_000

beforeEach(() => {
	vi.useFakeTimers({ shouldAdvanceTime: true })
	vi.setSystemTime(T0)
	sessionStorage.clear()
	localStorage.clear()
})

afterEach(() => {
	cleanup()
	vi.useRealTimers()
})

function session(jeton: string, dureeS = 300, decalageServeurS = 0): SessionInterne {
	const expireA = Math.floor(Date.now() / 1000) + decalageServeurS + dureeS
	return { jeton, expireA, dureeS, identite: { id: '5eed0000-0000-4000-8000-000000000011', email: 'admin@exemple.tld', nom: 'Admin' } }
}

type FauxClient = { readonly client: ClientCrm; readonly setAuth: ReturnType<typeof vi.fn>; readonly jetonsVusParRealtime: (string | null)[] }

function fauxClient(porteur: PorteurJeton): FauxClient {
	const jetonsVusParRealtime: (string | null)[] = []
	const setAuth = vi.fn(async () => {
		jetonsVusParRealtime.push(porteur.lire())
	})
	const requete = {
		select: () => requete,
		eq: () => requete,
		maybeSingle: async () => ({ data: null, error: null, status: 200 }),
	}
	const client = { realtime: { setAuth }, from: () => requete } as unknown as ClientCrm
	return { client, setAuth, jetonsVusParRealtime }
}

function fauxEchangeur(prolongations: (IssueGeste | Promise<IssueGeste>)[], ouverture?: IssueGeste): Echangeur & {
	readonly prolonger: ReturnType<typeof vi.fn>
	readonly fermer: ReturnType<typeof vi.fn>
	readonly ouvrir: ReturnType<typeof vi.fn>
} {
	return {
		prolonger: vi.fn(async () => {
			const suivante = prolongations.shift()
			if (suivante === undefined) throw new Error('prolongation inattendue')
			return suivante
		}),
		ouvrir: vi.fn(async (): Promise<IssueGeste> => ouverture ?? { ok: false, nature: 'sso_echec' }),
		fermer: vi.fn(async (): Promise<IssueFermeture> => ({ ok: true })),
	}
}

function Observateur() {
	const { etat, fin, ouvrirSession, deconnecter } = useAuthentification()
	return (
		<div>
			<span data-testid="statut">{etat.statut}</span>
			<span data-testid="identite">{etat.statut === 'authentifie' ? etat.utilisateur.email : ''}</span>
			<span data-testid="fin">{fin === null ? '' : `${fin.nature}${fin.adresse === undefined ? '' : `:${fin.adresse}`}`}</span>
			<button type="button" onClick={() => void ouvrirSession('le-code', 'le-verificateur', 'https://crm.tld/auth/retour')}>
				ouvrir
			</button>
			<button type="button" onClick={() => void deconnecter().then((r) => document.body.setAttribute('data-deconnexion', String(r.ok)))}>
				déconnexion
			</button>
		</div>
	)
}

function monter(echangeur: Echangeur, porteur = creerPorteurJeton()) {
	const faux = fauxClient(porteur)
	render(
		<FournisseurAuthentification client={faux.client} porteur={porteur} echangeur={echangeur}>
			<Observateur />
		</FournisseurAuthentification>,
	)
	return { ...faux, porteur }
}

const statut = () => screen.getByTestId('statut').textContent

describe('restauration au chargement', () => {
	it('reste en chargement tant que l’échangeur n’a pas répondu, puis rend la session du cookie', async () => {
		let repondre!: (issue: IssueGeste) => void
		const echangeur = fauxEchangeur([new Promise((r) => (repondre = r))])
		const { porteur, jetonsVusParRealtime } = monter(echangeur)
		expect(statut()).toBe('chargement')

		await act(async () => repondre({ ok: true, session: session('jeton-1') }))
		await waitFor(() => expect(statut()).toBe('authentifie'))
		expect(screen.getByTestId('identite').textContent).toBe('admin@exemple.tld')
		expect(porteur.lire()).toBe('jeton-1')
		// K18 : Realtime a reçu le jeton AVANT que la session soit déclarée.
		expect(jetonsVusParRealtime).toEqual(['jeton-1'])
	})

	it('rend l’état anonyme SANS message quand aucune session n’existe', async () => {
		monter(fauxEchangeur([{ ok: false, nature: 'session_absente' }]))
		await waitFor(() => expect(statut()).toBe('anonyme'))
		expect(screen.getByTestId('fin').textContent).toBe('')
	})

	it('dit pourquoi une session restaurée est refusée', async () => {
		monter(fauxEchangeur([{ ok: false, nature: 'attente_verification', adresse: 'attendu@exemple.tld' }]))
		await waitFor(() => expect(screen.getByTestId('fin').textContent).toBe('attente_verification:attendu@exemple.tld'))
		expect(statut()).toBe('anonyme')
	})

	it('reste anonyme sans configuration, sans jamais appeler l’échangeur', async () => {
		const echangeur = fauxEchangeur([])
		render(
			<FournisseurAuthentification client={null} echangeur={echangeur}>
				<Observateur />
			</FournisseurAuthentification>,
		)
		expect(statut()).toBe('anonyme')
		expect(echangeur.prolonger).not.toHaveBeenCalled()
	})
})

describe('rafraîchissement', () => {
	it('part 60 s avant l’échéance du jeton interne, et remplace le jeton sans perdre la session', async () => {
		const echangeur = fauxEchangeur([{ ok: true, session: session('jeton-1', 300) }, { ok: true, session: session('jeton-2', 300) }])
		const { porteur, jetonsVusParRealtime } = monter(echangeur)
		await waitFor(() => expect(statut()).toBe('authentifie'))
		expect(echangeur.prolonger).toHaveBeenCalledTimes(1)

		await act(async () => vi.advanceTimersByTime(300_000 - AVANCE_RAFRAICHISSEMENT_MS - 1_000))
		expect(echangeur.prolonger).toHaveBeenCalledTimes(1)
		await act(async () => vi.advanceTimersByTime(1_000))
		await waitFor(() => expect(porteur.lire()).toBe('jeton-2'))
		expect(echangeur.prolonger).toHaveBeenCalledTimes(2)
		expect(statut()).toBe('authentifie')
		expect(jetonsVusParRealtime).toEqual(['jeton-1', 'jeton-2'])
	})

	it('compte l’échéance sur la durée du jeton : une horloge du poste décalée ne fait pas boucler', async () => {
		// Le serveur vit 10 min DERRIÈRE le poste : lue à l'horloge du poste, l'échéance absolue serait
		// déjà passée, et la page prolongerait sans cesse. La durée, elle, est commune aux deux.
		const echangeur = fauxEchangeur([{ ok: true, session: session('jeton-1', 300, -600) }, { ok: true, session: session('jeton-2', 300, -600) }])
		const { porteur } = monter(echangeur)
		await waitFor(() => expect(statut()).toBe('authentifie'))
		await act(async () => vi.advanceTimersByTime(60_000))
		expect(echangeur.prolonger).toHaveBeenCalledTimes(1)
		await act(async () => vi.advanceTimersByTime(180_000))
		await waitFor(() => expect(porteur.lire()).toBe('jeton-2'))
		expect(echangeur.prolonger).toHaveBeenCalledTimes(2)
	})

	it('réessaie une panne réseau jusqu’à l’échéance, puis met fin à la session avec le message réseau', async () => {
		const pannes: IssueGeste[] = Array.from({ length: 10 }, () => ({ ok: false, nature: 'reseau' }))
		const echangeur = fauxEchangeur([{ ok: true, session: session('jeton-1', 300) }, ...pannes])
		const { porteur, jetonsVusParRealtime } = monter(echangeur)
		await waitFor(() => expect(statut()).toBe('authentifie'))

		await act(async () => vi.advanceTimersByTime(240_000))
		await waitFor(() => expect(echangeur.prolonger).toHaveBeenCalledTimes(2))
		expect(statut()).toBe('authentifie')
		await act(async () => vi.advanceTimersByTime(60_000))
		await waitFor(() => expect(statut()).toBe('anonyme'))
		expect(screen.getByTestId('fin').textContent).toBe('reseau')
		expect(porteur.lire()).toBeNull()
		expect(jetonsVusParRealtime.at(-1)).toBeNull()
		// 240 s, puis toutes les 10 s jusqu'à 300 s : six nouveaux essais au plus, jamais au-delà.
		expect(echangeur.prolonger.mock.calls.length).toBeLessThanOrEqual(8)
	})

	it.each([
		[{ ok: false, nature: 'session_expiree' } as IssueGeste, 'session_expiree'],
		[{ ok: false, nature: 'session_absente' } as IssueGeste, 'session_expiree'],
		[{ ok: false, nature: 'attente_espace', adresse: 'admin@exemple.tld' } as IssueGeste, 'attente_espace:admin@exemple.tld'],
	])('met fin à la session sur un refus au rafraîchissement (%j)', async (refus, fin) => {
		const echangeur = fauxEchangeur([{ ok: true, session: session('jeton-1', 300) }, refus])
		const { porteur } = monter(echangeur)
		await waitFor(() => expect(statut()).toBe('authentifie'))
		await act(async () => vi.advanceTimersByTime(240_000))
		await waitFor(() => expect(statut()).toBe('anonyme'))
		expect(screen.getByTestId('fin').textContent).toBe(fin)
		expect(porteur.lire()).toBeNull()
	})
})

describe('ouverture et déconnexion', () => {
	it('ouvre par l’échangeur avec le code et le vérificateur, puis déconnecte sans rien garder', async () => {
		const echangeur = fauxEchangeur([{ ok: false, nature: 'session_absente' }], { ok: true, session: session('jeton-ouvert') })
		const { porteur } = monter(echangeur)
		await waitFor(() => expect(statut()).toBe('anonyme'))

		await act(async () => screen.getByRole('button', { name: 'ouvrir' }).click())
		await waitFor(() => expect(statut()).toBe('authentifie'))
		expect(echangeur.ouvrir).toHaveBeenCalledWith('le-code', 'le-verificateur', 'https://crm.tld/auth/retour')
		expect(porteur.lire()).toBe('jeton-ouvert')
		expect(sessionStorage.length).toBe(0)
		expect(localStorage.length).toBe(0)

		await act(async () => screen.getByRole('button', { name: 'déconnexion' }).click())
		await waitFor(() => expect(statut()).toBe('anonyme'))
		expect(echangeur.fermer).toHaveBeenCalledOnce()
		expect(porteur.lire()).toBeNull()
		expect(screen.getByTestId('fin').textContent).toBe('')
	})

	it('garde la session si la fermeture échoue, et le dit', async () => {
		const echangeur = fauxEchangeur([{ ok: true, session: session('jeton-1') }])
		echangeur.fermer.mockResolvedValueOnce({ ok: false, nature: 'reseau' })
		const { porteur } = monter(echangeur)
		await waitFor(() => expect(statut()).toBe('authentifie'))

		await act(async () => screen.getByRole('button', { name: 'déconnexion' }).click())
		await waitFor(() => expect(document.body.getAttribute('data-deconnexion')).toBe('false'))
		expect(statut()).toBe('authentifie')
		expect(porteur.lire()).toBe('jeton-1')
	})

	it('une déconnexion pendant un rafraîchissement en vol n’est jamais annulée par sa réponse', async () => {
		let repondre!: (issue: IssueGeste) => void
		const echangeur = fauxEchangeur([{ ok: true, session: session('jeton-1', 300) }, new Promise((r) => (repondre = r))])
		const { porteur } = monter(echangeur)
		await waitFor(() => expect(statut()).toBe('authentifie'))
		await act(async () => vi.advanceTimersByTime(240_000))
		await waitFor(() => expect(echangeur.prolonger).toHaveBeenCalledTimes(2))

		await act(async () => screen.getByRole('button', { name: 'déconnexion' }).click())
		await waitFor(() => expect(statut()).toBe('anonyme'))
		await act(async () => repondre({ ok: true, session: session('jeton-ressuscite') }))
		expect(statut()).toBe('anonyme')
		expect(porteur.lire()).toBeNull()
	})
})

describe('fin de session rendue par /connexion', () => {
	function Lieu() {
		const location = useLocation()
		const etat = location.state as { erreurSso?: string; retour?: string } | null
		return <p data-testid="lieu">{`${location.pathname}|${etat?.erreurSso ?? ''}|${etat?.retour ?? ''}`}</p>
	}
	function Renvoi() {
		useRenvoiFinSession()
		return <Lieu />
	}

	it('mène à /connexion avec la cause et l’adresse quittée, une seule fois', async () => {
		const echangeur = fauxEchangeur([{ ok: true, session: session('jeton-1', 300) }, { ok: false, nature: 'session_expiree' }])
		const porteur = creerPorteurJeton()
		render(
			<MemoryRouter initialEntries={['/tracks/conseil-ia']}>
				<FournisseurAuthentification client={fauxClient(porteur).client} porteur={porteur} echangeur={echangeur}>
					<Routes>
						<Route path="*" element={<Renvoi />} />
					</Routes>
				</FournisseurAuthentification>
			</MemoryRouter>,
		)
		await waitFor(() => expect(screen.getByTestId('lieu').textContent).toBe('/tracks/conseil-ia||'))
		await act(async () => vi.advanceTimersByTime(240_000))
		await waitFor(() => expect(screen.getByTestId('lieu').textContent).toBe('/connexion|session_expiree|/tracks/conseil-ia'))
	})
})

describe('aucune page sans session — T9', () => {
	function Lieu() {
		const location = useLocation()
		const etat = location.state as { erreurSso?: string; retour?: string } | null
		return <p data-testid="lieu">{`${location.pathname}${location.search}|${etat?.erreurSso ?? ''}|${etat?.retour ?? ''}`}</p>
	}
	function Application() {
		useRenvoiFinSession()
		return (
			<ExigerSession>
				<Routes>
					<Route path="/connexion" element={<Lieu />} />
					<Route path={CHEMIN_RETOUR_SSO} element={<Lieu />} />
					<Route
						path="*"
						element={
							<>
								<Lieu />
								<p data-testid="page">page de l’application</p>
							</>
						}
					/>
				</Routes>
			</ExigerSession>
		)
	}
	function demarrer(adresse: string, echangeur: Echangeur) {
		const porteur = creerPorteurJeton()
		render(
			<MemoryRouter initialEntries={[adresse]}>
				<FournisseurAuthentification client={fauxClient(porteur).client} porteur={porteur} echangeur={echangeur}>
					<Application />
				</FournisseurAuthentification>
			</MemoryRouter>,
		)
	}

	it('mène une adresse profonde à /connexion, en retenant chemin et paramètres comme retour', async () => {
		demarrer('/tracks/conseil-ia/prospection?vue=liste', fauxEchangeur([{ ok: false, nature: 'session_absente' }]))
		await waitFor(() =>
			expect(screen.getByTestId('lieu').textContent).toBe('/connexion||/tracks/conseil-ia/prospection?vue=liste'),
		)
		expect(screen.queryByTestId('page')).toBeNull()
	})

	it('mène la racine à /connexion, elle aussi', async () => {
		demarrer('/', fauxEchangeur([{ ok: false, nature: 'session_absente' }]))
		await waitFor(() => expect(screen.getByTestId('lieu').textContent).toBe('/connexion||/'))
		expect(screen.queryByTestId('page')).toBeNull()
	})

	it('laisse /connexion et l’URL de retour du SSO publiques', async () => {
		demarrer('/connexion', fauxEchangeur([{ ok: false, nature: 'session_absente' }]))
		await waitFor(() => expect(screen.getByTestId('lieu').textContent).toBe('/connexion||'))
		cleanup()
		demarrer(`${CHEMIN_RETOUR_SSO}?code=c&state=s`, fauxEchangeur([{ ok: false, nature: 'session_absente' }]))
		await waitFor(() => expect(screen.getByTestId('lieu').textContent).toBe(`${CHEMIN_RETOUR_SSO}?code=c&state=s||`))
	})

	it('rend la page demandée à une session ouverte', async () => {
		demarrer('/contacts?q=durand', fauxEchangeur([{ ok: true, session: session('jeton-1', 300) }]))
		await waitFor(() => expect(screen.getByTestId('page')).toBeTruthy())
		expect(screen.getByTestId('lieu').textContent).toBe('/contacts?q=durand||')
	})

	it('ne rend rien de l’application pendant la restauration, seulement l’écran de chargement', async () => {
		let repondre!: (issue: IssueGeste) => void
		demarrer('/contacts', fauxEchangeur([new Promise((r) => (repondre = r))]))
		expect(screen.getByRole('status', { name: 'Restauration de votre session' })).toBeTruthy()
		expect(screen.queryByTestId('page')).toBeNull()
		expect(screen.queryByTestId('lieu')).toBeNull()
		await act(async () => repondre({ ok: true, session: session('jeton-1', 300) }))
		await waitFor(() => expect(screen.getByTestId('page')).toBeTruthy())
	})

	it('laisse une session refusée à la restauration dire pourquoi, au lieu de la simple redirection', async () => {
		demarrer(
			'/tracks/conseil-ia',
			fauxEchangeur([{ ok: false, nature: 'attente_verification', adresse: 'attendu@exemple.tld' }]),
		)
		await waitFor(() =>
			expect(screen.getByTestId('lieu').textContent).toBe('/connexion|attente_verification|/tracks/conseil-ia'),
		)
		expect(screen.queryByTestId('page')).toBeNull()
	})
})

