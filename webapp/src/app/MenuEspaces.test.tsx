// @verifies CRM-161 (docs/BACKLOG.md) — tranche T2.b : le menu des espaces — un bouton à deux espaces, la pastille d'un autre
//           espace aux non-lus, le panneau (l'espace courant coché, les comptes), le clavier (↓ ouvre sur le courant, ↑ ↓
//           parcourent, Échap rend le focus), et le choix qui mène la page dans l'espace choisi
// @verifies docs/DESIGN_SYSTEM.md §5.113 ; docs/SPEC-espace-courant.md §9

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { oublierEspaceDeLOnglet } from '../lib/espace-onglet'
import { FournisseurEspace } from './ContexteEspace'
import { MenuEspaces } from './MenuEspaces'

const injecte = vi.hoisted(() => ({ nonLus: [] as { workspace_id: string; unread_count: number }[] }))
vi.mock('../lib/supabase', () => ({
	clientCrm: { rpc: () => Promise.resolve({ data: injecte.nonLus, error: null, status: 200 }) },
}))

const P2E = { id: 'w-1', name: 'P2Enjoy SAS', slug: 'p2enjoy' }
const LUMEN = { id: 'w-2', name: 'Studio Lumen', slug: 'studio-lumen' }

function Adresse() {
	return <output data-testid="adresse">{useLocation().pathname}</output>
}

function monter(adresse = '/p2enjoy/inbox') {
	return render(
		<MemoryRouter initialEntries={[adresse]}>
			<FournisseurEspace valeur={{ idWorkspace: 'w-1', estAdmin: true, slugEspace: 'p2enjoy', espaces: [P2E, LUMEN] }}>
				<Routes>
					<Route
						path="*"
						element={
							<>
								<MenuEspaces espaces={[P2E, LUMEN]} />
								<Adresse />
							</>
						}
					/>
				</Routes>
			</FournisseurEspace>
		</MemoryRouter>,
	)
}

beforeEach(() => {
	injecte.nonLus = [
		{ workspace_id: 'w-1', unread_count: 4 },
		{ workspace_id: 'w-2', unread_count: 3 },
	]
})
afterEach(() => {
	cleanup()
	oublierEspaceDeLOnglet()
})

describe('le menu des espaces (§5.113)', () => {
	it('le bouton nomme l’espace courant ; sa pastille dit qu’un AUTRE espace a des non-lus', async () => {
		monter()
		const bouton = screen.getByRole('button', { name: /Changer d’espace — P2Enjoy SAS/ })
		expect(bouton.getAttribute('aria-haspopup')).toBe('menu')
		await waitFor(() => expect(screen.getByTestId('pastille-autre-espace')).toBeTruthy())
		expect(bouton.getAttribute('aria-label')).toBe('Changer d’espace — P2Enjoy SAS — des messages non lus dans un autre espace')
	})

	it('sans non-lu ailleurs, aucune pastille : ceux de l’espace courant ne l’allument pas', async () => {
		injecte.nonLus = [{ workspace_id: 'w-1', unread_count: 9 }, { workspace_id: 'w-2', unread_count: 0 }]
		monter()
		await waitFor(() => expect(screen.getByRole('button', { name: 'Changer d’espace — P2Enjoy SAS' })).toBeTruthy())
		expect(screen.queryByTestId('pastille-autre-espace')).toBeNull()
	})

	it('au clavier : ↓ ouvre sur l’espace courant, ↓ passe au suivant, Échap referme et rend le focus', async () => {
		monter()
		const bouton = screen.getByRole('button', { name: /Changer d’espace/ })
		bouton.focus()
		await userEvent.keyboard('{ArrowDown}')
		const lignes = await screen.findAllByRole('menuitemradio')
		expect(lignes.map((l) => l.getAttribute('aria-checked'))).toEqual(['true', 'false'])
		expect(document.activeElement).toBe(lignes[0])
		await waitFor(() => expect(lignes[1]!.getAttribute('aria-label')).toBe('Studio Lumen — 3 messages non lus'))
		await userEvent.keyboard('{ArrowDown}')
		expect(document.activeElement).toBe(lignes[1])
		await userEvent.keyboard('{Escape}')
		expect(screen.queryByRole('menu')).toBeNull()
		expect(document.activeElement).toBe(bouton)
	})

	it('choisir un espace mène la même page dans cet espace ; depuis une affaire, son inbox', async () => {
		monter('/p2enjoy/reglages/etiquettes')
		await userEvent.click(screen.getByRole('button', { name: /Changer d’espace/ }))
		await userEvent.click(await screen.findByRole('menuitemradio', { name: /Studio Lumen/ }))
		expect(screen.getByTestId('adresse').textContent).toBe('/studio-lumen/reglages/etiquettes')
		cleanup()
		monter('/p2enjoy/tracks/conseil-ia/grands-comptes/cards/c-1')
		await userEvent.click(screen.getByRole('button', { name: /Changer d’espace/ }))
		await userEvent.click(await screen.findByRole('menuitemradio', { name: /Studio Lumen/ }))
		expect(screen.getByTestId('adresse').textContent).toBe('/studio-lumen/inbox')
	})
})
