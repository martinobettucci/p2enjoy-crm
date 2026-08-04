// @verifies CRM-007 (docs/BACKLOG.md) — routes de premier niveau et leurs états
// @verifies docs/SPEC-webapp.md §5.2 (routes) ; docs/DESIGN_SYSTEM.md §5.8 (aucune page blanche)
// @verifies docs/DESIGN_SYSTEM.md §10 (libellés issus du dictionnaire)

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { MemoryRouter } from 'react-router'
import { fr } from '../i18n'
import { ENTREES_TRANSVERSES } from './navigation'
import { CLE_TITRE_INTROUVABLE, PageIntrouvable, ROUTES } from './routes'

afterEach(cleanup)

describe('table des routes', () => {
	it('couvre exactement les entrées de navigation, sans orpheline dans un sens ni dans l’autre', () => {
		expect(ROUTES.map((route) => route.chemin).sort()).toEqual(
			ENTREES_TRANSVERSES.map((entree) => entree.chemin).sort(),
		)
	})

	it('nomme chaque route par une clé du dictionnaire', () => {
		for (const route of ROUTES) {
			expect(Object.keys(fr)).toContain(route.cleTitre)
		}
		expect(Object.keys(fr)).toContain(CLE_TITRE_INTROUVABLE)
	})

	// Aucune route ne doit être une page blanche (docs/DESIGN_SYSTEM.md §5.8).
	it.each(ROUTES.map((route) => [route.chemin, route] as const))(
		'la route %s rend un état explicite',
		(_chemin, route) => {
			render(<MemoryRouter>{route.rendu()}</MemoryRouter>)
			expect(screen.getByTestId('etat-vide')).toBeTruthy()
			expect(screen.getByRole('heading').textContent?.length).toBeGreaterThan(0)
		},
	)
})

describe('adresse inconnue', () => {
	it('nomme le problème et offre un retour, plutôt qu’une page blanche', () => {
		render(
			<MemoryRouter>
				<PageIntrouvable />
			</MemoryRouter>,
		)
		expect(screen.getByRole('heading').textContent).toBe(fr['route.notfound.title'])
		const retour = screen.getByRole('link', { name: fr['route.notfound.action'] })
		expect(retour.getAttribute('href')).toBe('/')
	})
})
