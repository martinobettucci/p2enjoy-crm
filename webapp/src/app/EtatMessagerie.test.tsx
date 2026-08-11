// @verifies CRM-059 (docs/BACKLOG.md) — écran d'état de la messagerie
// @verifies docs/SPEC-mail-subsystem.md §20.7 (les faits montrés), §20.11.3 (le tableau),
//           §20.11.4 (dictionnaire fermé des six codes), §20.11.5 (les deux compteurs),
//           §20.11.6 (états systématiques)
// @verifies docs/DESIGN_SYSTEM.md §5.14 (cette surface), §5.8 (états)
//
// Ces preuves montent le **vrai** écran avec un client factice qui enregistre les requêtes émises,
// comme `AdministrationArborescence.test.tsx`. Le parcours connecté complet relève de
// `e2e/ui/etat-messagerie.spec.ts`, qui ne peut pas être exécuté sans la pile.

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { MemoryRouter } from 'react-router'
import { EtatMessagerie } from './EtatMessagerie'
import type { ClientCrm } from '../lib/supabase'

afterEach(cleanup)

type ReponseComptes = { data: unknown[] | null; error: { message: string } | null; status: number }
type ReponseCompteur = { count: number | null; error: { message: string } | null; status: number }

function client({
	comptes,
	enAttente,
	echecs,
}: {
	readonly comptes: ReponseComptes
	readonly enAttente: ReponseCompteur
	readonly echecs: ReponseCompteur
}): ClientCrm {
	return {
		from: (table: string) => {
			if (table === 'mail_inbound_accounts') {
				return { select: () => ({ order: () => Promise.resolve(comptes) }) }
			}
			if (table === 'mail_outbox') {
				return {
					select: () => ({
						in: () => Promise.resolve(enAttente),
						eq: () => Promise.resolve(echecs),
					}),
				}
			}
			throw new Error(`table inattendue : ${table}`)
		},
	} as unknown as ClientCrm
}

const OK: ReponseCompteur = { count: 0, error: null, status: 200 }

const COMPTES = [
	{
		id: 'c-1',
		label: 'Boîte système',
		last_sync_at: '2026-08-11T09:30:00Z',
		status: 'ok',
		last_error: null,
	},
	{
		id: 'c-2',
		label: 'Boîte de Driss',
		last_sync_at: null,
		status: 'error',
		last_error: 'auth_failed',
	},
]

describe('EtatMessagerie', () => {
	it('affiche un squelette pendant le chargement', () => {
		const c = client({
			comptes: new Promise(() => {}) as unknown as ReponseComptes,
			enAttente: OK,
			echecs: OK,
		})
		render(
			<MemoryRouter>
				<EtatMessagerie client={c} />
			</MemoryRouter>,
		)
		expect(screen.getByTestId('squelette')).toBeTruthy()
	})

	it('montre les comptes, « Jamais relevée », un incident traduit et les deux compteurs', async () => {
		const c = client({
			comptes: { data: COMPTES, error: null, status: 200 },
			enAttente: { count: 4, error: null, status: 200 },
			echecs: { count: 2, error: null, status: 200 },
		})
		render(
			<MemoryRouter>
				<EtatMessagerie client={c} />
			</MemoryRouter>,
		)

		expect(await screen.findByTestId('tableau-comptes-mail')).toBeTruthy()
		expect(screen.getAllByTestId('ligne-compte-mail')).toHaveLength(2)
		expect(screen.getByText('Boîte système')).toBeTruthy()
		expect(screen.getByText('Boîte de Driss')).toBeTruthy()
		// « Jamais relevée » — pas une cellule vide (§20.11.3).
		expect(screen.getByText('Jamais relevée')).toBeTruthy()
		// Le code brut n'apparaît jamais ; sa traduction française si (§20.11.4).
		expect(screen.queryByText('auth_failed')).toBeNull()
		expect(screen.getByText('Authentification refusée')).toBeTruthy()

		const compteurs = screen.getAllByTestId('compteur-mail')
		expect(compteurs).toHaveLength(2)
		expect(compteurs[0]?.textContent).toContain('4')
		expect(compteurs[1]?.textContent).toContain('2')
	})

	it("n'affiche aucun incident pour un compte qui n'est pas en erreur (§20.11.3)", async () => {
		const c = client({
			comptes: { data: [COMPTES[0]], error: null, status: 200 },
			enAttente: OK,
			echecs: OK,
		})
		render(
			<MemoryRouter>
				<EtatMessagerie client={c} />
			</MemoryRouter>,
		)
		expect(await screen.findByTestId('tableau-comptes-mail')).toBeTruthy()
		const ligne = screen.getByTestId('ligne-compte-mail')
		expect(ligne.textContent).not.toMatch(/Authentification|refusé|Hôte|TLS|Délai|protocole/i)
	})

	it('affiche l’état vide quand aucun compte n’est visible (§20.11.6)', async () => {
		const c = client({ comptes: { data: [], error: null, status: 200 }, enAttente: OK, echecs: OK })
		render(
			<MemoryRouter>
				<EtatMessagerie client={c} />
			</MemoryRouter>,
		)
		expect(await screen.findByTestId('etat-vide')).toBeTruthy()
	})

	it('affiche un état d’erreur avec reprise quand la lecture échoue', async () => {
		const c = client({
			comptes: { data: null, error: { message: 'denied' }, status: 403 },
			enAttente: OK,
			echecs: OK,
		})
		render(
			<MemoryRouter>
				<EtatMessagerie client={c} />
			</MemoryRouter>,
		)
		expect(await screen.findByTestId('etat-erreur')).toBeTruthy()
	})

	it('sans client (aucun espace de travail), rend un état vide explicite', () => {
		render(
			<MemoryRouter>
				<EtatMessagerie client={null} />
			</MemoryRouter>,
		)
		expect(screen.getByTestId('etat-vide')).toBeTruthy()
	})
})
