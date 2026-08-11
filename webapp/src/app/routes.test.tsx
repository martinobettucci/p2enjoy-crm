// @verifies CRM-007 (docs/BACKLOG.md) — routes de premier niveau et leurs états
// @verifies docs/SPEC-webapp.md §5.2 (routes) ; docs/DESIGN_SYSTEM.md §5.8 (aucune page blanche)
// @verifies docs/DESIGN_SYSTEM.md §10 (libellés issus du dictionnaire)

import { Suspense } from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { MemoryRouter } from 'react-router'
import { fr } from '../i18n'
import { ChargementRoute } from './App'
import { ENTREES_TRANSVERSES } from './navigation'
import { CHEMIN_INBOX, CLE_TITRE_INTROUVABLE, PageIntrouvable, ROUTES } from './routes'

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
	//
	// RÉVISÉ PAR `CRM-057`, ET L'ASSERTION AVAIT JOUÉ : elle exigeait un état VIDE de chaque route,
	// et `/inbox` a cessé d'en être un le jour où la messagerie a été raccordée. La garantie, elle,
	// ne change pas — aucune page blanche —, mais elle se vérifie désormais différemment selon que
	// la route porte un écran ou attend encore le sien.
	const ROUTES_EN_ATTENTE = ROUTES.filter((route) => route.chemin !== CHEMIN_INBOX)

	it.each(ROUTES_EN_ATTENTE.map((route) => [route.chemin, route] as const))(
		'la route %s rend un état explicite',
		(_chemin, route) => {
			render(<MemoryRouter>{route.rendu()}</MemoryRouter>)
			expect(screen.getByTestId('etat-vide')).toBeTruthy()
			expect(screen.getByRole('heading').textContent?.length).toBeGreaterThan(0)
		},
	)

	it('la route /inbox rend son écran, chargé à la demande derrière un repli', async () => {
		const route = ROUTES.find((candidate) => candidate.chemin === CHEMIN_INBOX)
		expect(route).toBeDefined()
		render(
			<MemoryRouter>
				<Suspense fallback={<ChargementRoute />}>{route!.rendu()}</Suspense>
			</MemoryRouter>,
		)
		// Le repli de `Suspense` est lui-même un état explicite : le téléchargement du module ne
		// laisse à aucun moment un écran blanc.
		expect(screen.getByLabelText(fr['state.loading.aria'])).toBeTruthy()
		expect(await screen.findByTestId('route-inbox')).toBeTruthy()
	})
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

describe('chargement différé des routes métier', () => {
	it('annonce un chargement accessible plutôt que de rendre une page blanche', () => {
		render(<ChargementRoute />)
		const statut = screen.getByRole('status', { name: fr['state.loading.aria'] })
		expect(statut.getAttribute('aria-busy')).toBe('true')
		expect(screen.getAllByTestId('squelette')).toHaveLength(1)
	})
})
