// @verifies CRM-161 (docs/BACKLOG.md) — tranche T2.a : le lien et la navigation d'un écran d'un espace — un chemin d'espace mis
//           dans l'espace courant (du contexte, ou de l'adresse pour un écran qui monte sa propre coquille), un chemin global
//           et un chemin déjà préfixé laissés tels quels, et sans espace connu, l'ancienne adresse que la redirection sert
// @verifies docs/SPEC-espace-courant.md §15.3, §15.4

import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { afterEach, describe, expect, it } from 'vitest'
import { FournisseurEspace } from './ContexteEspace'
import { LienEspace, useNaviguerEspace } from './LienEspace'

afterEach(cleanup)

function Liens() {
	return (
		<>
			<LienEspace to="/inbox">inbox</LienEspace>
			<LienEspace to="/reglages/etiquettes?x=1">etiquettes</LienEspace>
			<LienEspace to="/contacts">contacts</LienEspace>
			<LienEspace to="/autre/tracks/a">deja</LienEspace>
		</>
	)
}

const href = (nom: string) => screen.getByRole('link', { name: nom }).getAttribute('href')

describe('LienEspace (§15.3)', () => {
	it('met un chemin d’espace dans l’espace du contexte, laisse un chemin global ou déjà préfixé', () => {
		render(
			<MemoryRouter>
				<FournisseurEspace valeur={{ idWorkspace: 'w-2', estAdmin: false, slugEspace: 'studio-lumen' }}>
					<Liens />
				</FournisseurEspace>
			</MemoryRouter>,
		)
		expect(href('inbox')).toBe('/studio-lumen/inbox')
		expect(href('etiquettes')).toBe('/studio-lumen/reglages/etiquettes?x=1')
		expect(href('contacts')).toBe('/contacts')
		expect(href('deja')).toBe('/autre/tracks/a')
	})

	it('hors du fournisseur — un écran qui monte sa propre coquille —, le slug de l’adresse', () => {
		render(
			<MemoryRouter initialEntries={['/p2enjoy/tracks/conseil-ia']}>
				<Routes>
					<Route path="/:slugEspace/tracks/:slugTrack" element={<Liens />} />
				</Routes>
			</MemoryRouter>,
		)
		expect(href('inbox')).toBe('/p2enjoy/inbox')
	})

	it('sans espace connu, l’ancienne adresse, que la redirection résout (§15.4)', () => {
		render(
			<MemoryRouter>
				<Liens />
			</MemoryRouter>,
		)
		expect(href('inbox')).toBe('/inbox')
	})
})

describe('useNaviguerEspace', () => {
	function Bouton() {
		const naviguer = useNaviguerEspace()
		const { pathname } = useLocation()
		return (
			<>
				<button type="button" onClick={() => naviguer('/tracks/conseil-ia/grands-comptes')}>
					aller
				</button>
				<output>{pathname}</output>
			</>
		)
	}

	it('navigue dans l’espace de l’adresse', async () => {
		render(
			<MemoryRouter initialEntries={['/p2enjoy/tracks/conseil-ia']}>
				<Routes>
					<Route path="/:slugEspace/tracks/*" element={<Bouton />} />
				</Routes>
			</MemoryRouter>,
		)
		await userEvent.click(screen.getByRole('button', { name: 'aller' }))
		expect(screen.getByRole('status').textContent).toBe('/p2enjoy/tracks/conseil-ia/grands-comptes')
	})
})
