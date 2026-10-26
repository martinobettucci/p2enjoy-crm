// @verifies CRM-072 (docs/BACKLOG.md) — tranche T2 : Réglages ▸ Journal d'audit, l'écran
// @verifies docs/SPEC-audit.md §3.2 (capacité refusée : aucune lecture ; en lecture : rien ne part), §7.3 (le nom d'un
//           contact lu dans le carnet), §8 (filtres dans l'adresse, entrée d'historique remplacée, pagination) ;
//           docs/DESIGN_SYSTEM.md §5.66 (tableau à quatre colonnes, vide sans action, filtres rendus sur le vide,
//           « Entrées plus anciennes » qui garde les lignes lues), §5.8 ; docs/JOURNAL.md décisions 725 à 728
//
// La base est simulée en mémoire, au format de PostgREST. Le refus réel par la RLS est prouvé hors interface
// (`e2e/api/journal-audit.spec.ts`) ; ici, l'écran.

import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router'
import { afterEach, describe, expect, it } from 'vitest'
import type { Capacite } from '../lib/capacites'
import { PAGE_AUDIT } from '../lib/audit'
import type { ClientCrm } from '../lib/supabase'
import { FournisseurEspace } from './ContexteEspace'
import { ReglagesJournal } from './ReglagesJournal'

afterEach(cleanup)

type Reponse = { data: unknown; error: { message: string } | null; status: number }

const ligne = (id: number, extra: Record<string, unknown> = {}) => ({
	id,
	occurred_at: '2026-10-26T09:00:00Z',
	family: 'access',
	action: 'added',
	entity_type: 'member',
	entity_id: 'u1',
	entity_label: 'Sabine Plateforme',
	details: { role: 'viewer' },
	actor_id: 'camille',
	acteur: { full_name: 'Camille Aubert' },
	...extra,
})

/** Une base en mémoire : `pages` rend la page demandée selon le curseur (`lt id`), et compte les lectures du journal. */
function base(options: { pages?: (avant: number | null) => Reponse } = {}) {
	const lectures: { filtres: Record<string, unknown>; avant: number | null }[] = []
	const client = {
		from(table: string) {
			const filtres: Record<string, unknown> = {}
			let avant: number | null = null
			const chaine: Record<string, unknown> = {}
			for (const methode of ['select', 'order', 'limit', 'in', 'gte']) chaine[methode] = () => chaine
			chaine.eq = (colonne: string, valeur: unknown) => {
				filtres[colonne] = valeur
				return chaine
			}
			chaine.is = (colonne: string, valeur: unknown) => {
				filtres[colonne] = valeur
				return chaine
			}
			chaine.lt = (colonne: string, valeur: unknown) => {
				if (colonne === 'id') avant = valeur as number
				else filtres[colonne] = valeur
				return chaine
			}
			chaine.then = (ok: (r: Reponse) => unknown) => {
				if (table === 'audit_log') {
					lectures.push({ filtres: { ...filtres }, avant })
					const page = options.pages?.(avant) ?? {
						data: [
							ligne(3),
							ligne(2, { entity_type: 'contact', action: 'exported', family: 'export', entity_id: 'c1', entity_label: null, details: {} }),
							ligne(1, { family: 'sign_in', entity_type: 'session', action: 'signed_in', actor_id: null, acteur: null, details: {} }),
						],
						error: null,
						status: 200,
					}
					return Promise.resolve(page).then(ok)
				}
				if (table === 'contacts') return Promise.resolve({ data: [{ id: 'c1', full_name: 'Léo Marchand' }], error: null, status: 200 }).then(ok)
				if (table === 'workspace_members') {
					return Promise.resolve({
						data: [{ user_id: '5eed0000-0000-4000-8000-000000000011', role: 'admin', created_at: '2026-09-01T08:00:00Z', profiles: { full_name: 'Camille Aubert' } }],
						error: null,
						status: 200,
					}).then(ok)
				}
				return Promise.resolve({ data: [], error: null, status: 200 }).then(ok)
			}
			return chaine
		},
	}
	return { client: client as unknown as ClientCrm, lectures }
}

function Adresse() {
	const lieu = useLocation()
	return <output data-testid="adresse">{lieu.search}</output>
}

function monter(client: ClientCrm, administration: Capacite = 'permise', entree = '/reglages/journal') {
	render(
		<MemoryRouter initialEntries={['/reglages', entree]} initialIndex={1}>
			<FournisseurEspace valeur={{ idWorkspace: 'w', estAdmin: administration === 'permise', capacites: { administration, edition: 'permise' } }}>
				<ReglagesJournal client={client} />
				<Adresse />
			</FournisseurEspace>
		</MemoryRouter>,
	)
}

describe('l’écran du journal', () => {
	it('rend le tableau à quatre colonnes, le contact nommé par le carnet, l’acteur nul sans cause devinée', async () => {
		monter(base().client)
		const tableau = await screen.findByTestId('tableau-audit')
		expect(within(tableau).getAllByRole('columnheader').map((th) => th.textContent)).toEqual(['Date', 'Acteur', 'Geste', 'Détail'])
		const lignes = screen.getAllByTestId('ligne-audit')
		expect(lignes.map((l) => l.getAttribute('data-geste'))).toEqual(['member.added', 'contact.exported', 'session.signed_in'])
		expect(lignes[1]?.textContent).toContain('Léo Marchand')
		expect(lignes[2]?.textContent).toContain('Système ou compte supprimé')
	})

	it('capacité refusée : l’état « réservé », et aucune lecture du journal', async () => {
		const { client, lectures } = base()
		monter(client, 'refusee')
		expect(await screen.findByText('Réservé aux administrateurs')).toBeTruthy()
		expect(lectures).toEqual([])
		expect(screen.queryByTestId('audit-filtres')).toBeNull()
	})

	it('capacité en lecture : un squelette, et rien ne part tant qu’elle n’est pas connue', async () => {
		const { client, lectures } = base()
		monter(client, 'en-lecture')
		expect(screen.getByTestId('audit-filtres')).toBeTruthy()
		expect(screen.queryByTestId('tableau-audit')).toBeNull()
		await new Promise((r) => setTimeout(r, 20))
		expect(lectures).toEqual([])
	})

	it('vide : la phrase sans action, et les filtres restent au-dessus', async () => {
		monter(base({ pages: () => ({ data: [], error: null, status: 200 }) }).client)
		expect(await screen.findByText('Aucun geste sur cette période')).toBeTruthy()
		expect(screen.getByTestId('audit-filtres')).toBeTruthy()
		expect(screen.queryByRole('button', { name: 'Entrées plus anciennes' })).toBeNull()
	})

	it('une panne rend l’erreur avec sa reprise, qui relit', async () => {
		let echec = true
		const { client, lectures } = base({
			pages: () => (echec ? { data: null, error: { message: 'x' }, status: 500 } : { data: [ligne(1)], error: null, status: 200 }),
		})
		monter(client)
		const reprise = await screen.findByRole('button', { name: 'Réessayer' })
		echec = false
		await userEvent.click(reprise)
		await screen.findByTestId('tableau-audit')
		expect(lectures.length).toBe(2)
	})
})

describe('les filtres et la pagination', () => {
	it('lit les filtres dans l’adresse et les applique à la lecture', async () => {
		const { client, lectures } = base()
		monter(client, 'permise', '/reglages/journal?famille=export&acteur=systeme')
		await screen.findByTestId('tableau-audit')
		expect(lectures[0]?.filtres).toMatchObject({ workspace_id: 'w', family: 'export', actor_id: null })
		expect((screen.getByLabelText('Famille') as HTMLSelectElement).value).toBe('export')
	})

	it('un filtre choisi s’écrit dans l’adresse en remplaçant l’entrée d’historique, et relit', async () => {
		const { client, lectures } = base()
		monter(client)
		await screen.findByTestId('tableau-audit')
		await userEvent.selectOptions(screen.getByLabelText('Famille'), 'deletion')
		await waitFor(() => expect(screen.getByTestId('adresse').textContent).toBe('?famille=deletion'))
		await waitFor(() => expect(lectures.at(-1)?.filtres).toMatchObject({ family: 'deletion' }))
		await userEvent.selectOptions(screen.getByLabelText('Acteur'), 'Camille Aubert')
		await waitFor(() =>
			expect(screen.getByTestId('adresse').textContent).toBe('?famille=deletion&acteur=5eed0000-0000-4000-8000-000000000011'),
		)
	})

	it('« Entrées plus anciennes » lit la page suivante par le curseur et garde les lignes déjà lues', async () => {
		const premiere = Array.from({ length: PAGE_AUDIT }, (_, i) => ligne(200 - i))
		const { client, lectures } = base({
			pages: (avant) => ({ data: avant === null ? premiere : [ligne(10, { entity_label: 'Plus ancien' })], error: null, status: 200 }),
		})
		monter(client)
		await screen.findByTestId('tableau-audit')
		await userEvent.click(screen.getByRole('button', { name: 'Entrées plus anciennes' }))
		await waitFor(() => expect(screen.getAllByTestId('ligne-audit')).toHaveLength(PAGE_AUDIT + 1))
		expect(lectures.at(-1)?.avant).toBe(200 - PAGE_AUDIT + 1)
		expect(screen.queryByRole('button', { name: 'Entrées plus anciennes' })).toBeNull()
	})
})
