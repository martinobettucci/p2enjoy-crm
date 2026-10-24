// @verifies CRM-114 (docs/BACKLOG.md) — tranche T2 : l'onglet « Organisations » du carnet, monté pour de vrai
// @verifies docs/SPEC-organisations.md §2 à §4 ; docs/DESIGN_SYSTEM.md §5.64 (tableau à quatre colonnes, commande et
//           formulaire qui s'excluent, fiche ouverte après la création, refus dans le formulaire), §5.59 (commande
//           éteinte avec le motif), §5.8 (états)

import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, describe, expect, it } from 'vitest'
import { ListeOrganisations } from './ListeOrganisations'
import { FournisseurEspace } from './ContexteEspace'
import { fr } from '../i18n'
import type { Capacite } from '../lib/capacites'
import type { ClientCrm } from '../lib/supabase'

afterEach(cleanup)

const COMPTOIR = { id: 'o1', name: 'Comptoir Vasseur', domain: 'comptoir-vasseur.example', website: null, contacts: [{ count: 0 }] }
const SOGEXIA = { id: 'o2', name: 'Sogexia', domain: 'sogexia.example', website: 'https://www.sogexia.example', contacts: [{ count: 1 }] }

type Reponse = { data?: unknown; error?: { code?: string; message: string } | null; status?: number }

function double({ liste = [COMPTOIR, SOGEXIA] as unknown[], insertion = { data: [{ id: 'neuve' }], status: 201 } as Reponse } = {}) {
	const ecritures: unknown[] = []
	const chaine = (r: Reponse) => {
		const c: Record<string, unknown> = {
			select: () => c, order: () => c, eq: () => c,
			then: (resoudre: (v: unknown) => unknown) =>
				Promise.resolve({ data: r.data ?? null, error: r.error ?? null, status: r.status ?? 200 }).then(resoudre),
		}
		return c
	}
	const client = {
		from: (table: string) => ({
			select: () => chaine(table === 'workspaces' ? { data: [{ id: 'ws', name: 'P2Enjoy', slug: 'p2enjoy' }] } : { data: liste }),
			insert: (charge: unknown) => { ecritures.push(charge); return chaine(insertion) },
		}),
	} as unknown as ClientCrm
	return { client, ecritures }
}

function monter(client: ClientCrm, edition: Capacite = 'permise') {
	render(
		<MemoryRouter initialEntries={['/contacts/organisations']}>
			<FournisseurEspace valeur={{ idWorkspace: 'ws', estAdmin: false, capacites: { administration: 'refusee', edition } }}>
				<Routes>
					<Route path="/contacts/organisations" element={<ListeOrganisations client={client} />} />
					<Route path="/contacts/organisations/:id" element={<p data-testid="fiche-ouverte">fiche</p>} />
				</Routes>
			</FournisseurEspace>
		</MemoryRouter>,
	)
}

describe('l’onglet « Organisations » (docs/DESIGN_SYSTEM.md §5.64)', () => {
	it('rend un tableau à quatre colonnes ; le nom est le seul lien, zéro contact s’écrit 0', async () => {
		monter(double().client)
		const lignes = await screen.findAllByTestId('ligne-organisation')
		expect(screen.getAllByRole('columnheader').map((c) => c.textContent)).toEqual([
			fr['organizations.table.name'], fr['organizations.table.domain'], fr['organizations.table.website'], fr['organizations.table.contacts'],
		])
		expect(within(lignes[0] as HTMLElement).getAllByRole('link').map((l) => l.textContent)).toEqual(['Comptoir Vasseur'])
		expect(within(lignes[1] as HTMLElement).getAllByRole('link')).toHaveLength(1)
		expect((lignes[0] as HTMLElement).lastElementChild?.textContent).toBe('0')
	})

	it('l’état vide garde la commande', async () => {
		monter(double({ liste: [] }).client)
		expect(await screen.findByText(fr['organizations.empty.title'])).toBeTruthy()
		expect(screen.getByTestId('ouvrir-creation-organisation')).toBeTruthy()
	})

	it('créer : le focus entre, « Créer » attend un nom, l’envoi normalise, puis la fiche s’ouvre', async () => {
		const { client, ecritures } = double()
		monter(client)
		await userEvent.click(await screen.findByTestId('ouvrir-creation-organisation'))
		expect(screen.queryByTestId('ouvrir-creation-organisation')).toBeNull()
		expect(document.activeElement).toBe(screen.getByTestId('champ-nom-organisation'))
		expect((screen.getByTestId('envoyer-organisation') as HTMLButtonElement).disabled).toBe(true)
		await userEvent.type(screen.getByTestId('champ-nom-organisation'), 'Atelier Brun')
		await userEvent.type(screen.getByTestId('champ-domaine-organisation'), 'Atelier-Brun.FR')
		await userEvent.click(screen.getByTestId('envoyer-organisation'))
		expect(await screen.findByTestId('fiche-ouverte')).toBeTruthy()
		expect(ecritures).toEqual([{ workspace_id: 'ws', name: 'Atelier Brun', domain: 'atelier-brun.fr', website: null }])
	})

	it('un refus reste dans le formulaire, la saisie conservée', async () => {
		monter(double({ insertion: { error: { code: '23505', message: 'duplicate' }, status: 409 } }).client)
		await userEvent.click(await screen.findByTestId('ouvrir-creation-organisation'))
		await userEvent.type(screen.getByTestId('champ-nom-organisation'), 'Doublon')
		await userEvent.click(screen.getByTestId('envoyer-organisation'))
		expect((await screen.findByTestId('refus-organisation')).textContent).toBe(fr['organizations.refus.domainePris'])
		expect((screen.getByTestId('champ-nom-organisation') as HTMLInputElement).value).toBe('Doublon')
	})

	it('`Échap` referme et rend le focus à la commande', async () => {
		monter(double().client)
		await userEvent.click(await screen.findByTestId('ouvrir-creation-organisation'))
		await userEvent.keyboard('{Escape}')
		await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId('ouvrir-creation-organisation')))
	})

	it('quand la base refuse l’édition, la commande est montée, désactivée, et cite le motif (§5.59)', async () => {
		monter(double().client, 'refusee')
		const commande = await screen.findByTestId('ouvrir-creation-organisation')
		expect((commande as HTMLButtonElement).disabled).toBe(true)
		const motif = commande.getAttribute('aria-describedby')
		expect(document.getElementById(motif ?? '')?.textContent).toBe(fr['rights.readonly.edition'])
	})
})
