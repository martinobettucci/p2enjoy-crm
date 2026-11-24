// @verifies CRM-161 (docs/BACKLOG.md) — tranche T3.a : le filtre « Espace » des pages globales et le vide sous le filtre
//           (docs/SPEC-espace-courant.md §16.1, §16.2 ; docs/DESIGN_SYSTEM.md §5.115, §5.105, §5.92)

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router'
import { afterEach, describe, expect, it } from 'vitest'
import { FournisseurEspace } from './ContexteEspace'
import { FiltreEspaces, useFiltreEspaces, VideSousFiltreEspaces } from './FiltreEspaces'
import type { Workspace } from '../lib/workspaces'

afterEach(cleanup)

const P2ENJOY = { id: 'ws-p', name: 'P2Enjoy SAS', slug: 'p2enjoy' }
const LUMEN = { id: 'ws-l', name: 'Studio Lumen', slug: 'studio-lumen' }

function Adresse() {
	const { search } = useLocation()
	return <output data-testid="adresse">{search}</output>
}

function Page({ vide = false }: { readonly vide?: boolean }) {
	const filtre = useFiltreEspaces()
	return (
		<>
			<FiltreEspaces filtre={filtre} />
			{vide ? <VideSousFiltreEspaces filtre={filtre} /> : null}
			<output data-testid="choisis">{filtre.choisis.join(',')}</output>
			<Adresse />
		</>
	)
}

function monter(espaces: readonly Workspace[] | undefined, adresse = '/affaires-figees', vide = false) {
	return render(
		<MemoryRouter initialEntries={[adresse]}>
			<FournisseurEspace valeur={{ idWorkspace: 'ws-p', estAdmin: true, ...(espaces === undefined ? {} : { espaces }) }}>
				<Page vide={vide} />
			</FournisseurEspace>
		</MemoryRouter>,
	)
}

describe('le filtre « Espace » (§5.115)', () => {
	it('n’existe pas pour une personne d’un seul espace, ni hors coquille — et l’adresse n’y filtre rien', () => {
		monter([P2ENJOY], '/affaires-figees?espaces=p2enjoy')
		expect(screen.queryByTestId('filtre-espaces')).toBeNull()
		expect(screen.getByTestId('choisis').textContent).toBe('')
		cleanup()
		monter(undefined)
		expect(screen.queryByTestId('filtre-espaces')).toBeNull()
	})

	it('à deux espaces : un bouton « Espace » replié, nommé dans un groupe « Filtres »', () => {
		monter([P2ENJOY, LUMEN])
		expect(screen.getByRole('group', { name: 'Filtres' })).toBeTruthy()
		const bouton = screen.getByRole('button', { name: 'Espace' })
		expect(bouton.getAttribute('aria-expanded')).toBe('false')
		expect(screen.queryByTestId('panneau-filtre-espaces')).toBeNull()
	})

	it('le panneau liste une case par espace, dans l’ordre des espaces lus, et lie le bouton par aria-controls', () => {
		monter([P2ENJOY, LUMEN])
		const bouton = screen.getByRole('button', { name: 'Espace' })
		fireEvent.click(bouton)
		expect(bouton.getAttribute('aria-expanded')).toBe('true')
		const panneau = screen.getByTestId('panneau-filtre-espaces')
		expect(bouton.getAttribute('aria-controls')).toBe(panneau.id)
		expect(screen.getByRole('group', { name: 'Espaces affichés' })).toBeTruthy()
		const cases = screen.getAllByTestId('case-filtre-espace')
		expect(cases.map((une) => une.getAttribute('data-slug'))).toEqual(['p2enjoy', 'studio-lumen'])
		expect(cases.every((une) => !(une as HTMLInputElement).checked)).toBe(true)
	})

	it('cocher filtre aussitôt : l’adresse porte le slug, le bouton dit le compte', () => {
		monter([P2ENJOY, LUMEN])
		fireEvent.click(screen.getByRole('button', { name: 'Espace' }))
		fireEvent.click(screen.getByRole('checkbox', { name: 'Studio Lumen' }))
		expect(screen.getByTestId('adresse').textContent).toBe('?espaces=studio-lumen')
		expect(screen.getByTestId('choisis').textContent).toBe('ws-l')
		expect(screen.getByRole('button', { name: 'Espace (1)' })).toBeTruthy()
		// L'ordre écrit est celui des espaces, pas celui des clics.
		fireEvent.click(screen.getByRole('checkbox', { name: 'P2Enjoy SAS' }))
		expect(screen.getByTestId('adresse').textContent).toBe('?espaces=p2enjoy%2Cstudio-lumen')
		expect(screen.getByRole('button', { name: 'Espace (2)' })).toBeTruthy()
		// Tout décoché : le paramètre disparaît, tous les espaces.
		fireEvent.click(screen.getByRole('checkbox', { name: 'P2Enjoy SAS' }))
		fireEvent.click(screen.getByRole('checkbox', { name: 'Studio Lumen' }))
		expect(screen.getByTestId('adresse').textContent).toBe('')
		expect(screen.getByRole('button', { name: 'Espace' })).toBeTruthy()
	})

	it('relit l’adresse : un slug choisi est coché, un slug inconnu ignoré', () => {
		monter([P2ENJOY, LUMEN], '/affaires-figees?espaces=studio-lumen,inconnu')
		expect(screen.getByRole('button', { name: 'Espace (1)' })).toBeTruthy()
		fireEvent.click(screen.getByRole('button', { name: 'Espace (1)' }))
		expect((screen.getByRole('checkbox', { name: 'Studio Lumen' }) as HTMLInputElement).checked).toBe(true)
		expect((screen.getByRole('checkbox', { name: 'P2Enjoy SAS' }) as HTMLInputElement).checked).toBe(false)
	})

	it('Échap replie le panneau depuis une case et rend le focus au bouton', () => {
		monter([P2ENJOY, LUMEN])
		const bouton = screen.getByRole('button', { name: 'Espace' })
		fireEvent.click(bouton)
		const caseLumen = screen.getByRole('checkbox', { name: 'Studio Lumen' })
		caseLumen.focus()
		fireEvent.keyDown(caseLumen, { key: 'Escape' })
		expect(screen.queryByTestId('panneau-filtre-espaces')).toBeNull()
		expect(document.activeElement).toBe(bouton)
		expect(bouton.getAttribute('aria-expanded')).toBe('false')
	})

	it('le vide sous le filtre dit sa cause, et « Afficher tous les espaces » vide le filtre et rend le focus au bouton', () => {
		monter([P2ENJOY, LUMEN], '/affaires-figees?espaces=studio-lumen', true)
		expect(screen.getByText('Rien dans les espaces choisis')).toBeTruthy()
		fireEvent.click(screen.getByRole('button', { name: 'Afficher tous les espaces' }))
		expect(screen.getByTestId('adresse').textContent).toBe('')
		expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Espace' }))
	})
})
