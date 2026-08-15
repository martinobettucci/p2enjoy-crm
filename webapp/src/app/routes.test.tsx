// @verifies CRM-007 (docs/BACKLOG.md) — routes de premier niveau et leurs états
// @verifies CRM-075 (docs/BACKLOG.md) — index des réglages, et adresse de l'administration
// @verifies CRM-059 (docs/BACKLOG.md) — adresse de l'écran d'état de la messagerie
// @verifies docs/SPEC-webapp.md §5.2 (routes) ; docs/DESIGN_SYSTEM.md §5.8 (aucune page blanche)
// @verifies docs/DESIGN_SYSTEM.md §10 (libellés issus du dictionnaire)

import { Suspense } from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { MemoryRouter } from 'react-router'
import { fr } from '../i18n'
import { ChargementRoute } from './App'
import { ENTREES_TRANSVERSES } from './navigation'
import {
	CHEMIN_ADMIN_ARBORESCENCE,
	CHEMIN_DEMARRAGE,
	CHEMIN_ETAT_MESSAGERIE,
	CHEMIN_INBOX,
	CLE_TITRE_INTROUVABLE,
	PageIntrouvable,
	ROUTES,
} from './routes'

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
	//
	// RÉVISÉ UNE SECONDE FOIS PAR `CRM-075`, ET L'ASSERTION AVAIT JOUÉ DE NOUVEAU : `/reglages`
	// affichait « Aucun réglage modifiable », ce qui a cessé d'être vrai le jour où l'administration
	// de l'arborescence est arrivée. La garantie ne change toujours pas — aucune page blanche — et
	// la route rejoint la liste de celles qui portent un écran, avec sa propre assertion ci-dessous.
	//
	// RÉVISÉ UNE TROISIÈME FOIS PAR `CRM-079`, ET L'ASSERTION A JOUÉ UNE TROISIÈME FOIS : `/`
	// rendait un état vide inconditionnel, ce qui a cessé d'être vrai le jour où le guide de
	// démarrage est arrivé (docs/SPEC-onboarding.md §4.2). La règle a changé par arbitrage, la
	// preuve est donc RÉVISÉE et non contournée : `/` rejoint les routes qui portent un écran, et
	// son assertion propre ci-dessous vérifie qu'aucun de ses quatre cas n'est une page blanche.
	const ROUTES_EN_ATTENTE = ROUTES.filter(
		(route) =>
			route.chemin !== CHEMIN_INBOX && route.chemin !== '/reglages' && route.chemin !== '/',
	)

	it.each(ROUTES_EN_ATTENTE.map((route) => [route.chemin, route] as const))(
		'la route %s rend un état explicite',
		(_chemin, route) => {
			render(<MemoryRouter>{route.rendu()}</MemoryRouter>)
			expect(screen.getByTestId('etat-vide')).toBeTruthy()
			expect(screen.getByRole('heading').textContent?.length).toBeGreaterThan(0)
		},
	)

	it('la route / rend le guide de démarrage, et non une page blanche — `CRM-079`', () => {
		const route = ROUTES.find((candidate) => candidate.chemin === '/')
		expect(route).toBeDefined()
		render(<MemoryRouter>{route!.rendu()}</MemoryRouter>)
		// Le premier rendu est celui du chargement des cinq mesures, et il est déjà explicite : un
		// titre, une phrase, et un squelette par étape. L'état vide du board ne revient qu'une fois
		// les cinq étapes accomplies, ce qu'éprouve `GuideDemarrage.test.tsx`.
		expect(screen.getByTestId('guide-demarrage')).toBeTruthy()
		expect(screen.getByRole('heading').textContent).toBe(fr['onboarding.title'])
	})

	it("la route /reglages rend l'index des sections, et non une page blanche", () => {
		const route = ROUTES.find((candidate) => candidate.chemin === '/reglages')
		expect(route).toBeDefined()
		render(<MemoryRouter>{route!.rendu()}</MemoryRouter>)
		// Un titre, et un lien réel vers chacune des deux sections livrées — `CRM-075`, `CRM-059`.
		expect(screen.getByRole('heading').textContent).toBe(fr['admin.settings.index.title'])
		const lienArborescence = screen.getByRole('link', {
			name: new RegExp(fr['admin.settings.index.tree']),
		})
		expect(lienArborescence.getAttribute('href')).toBe(CHEMIN_ADMIN_ARBORESCENCE)
		const lienMessagerie = screen.getByRole('link', {
			name: new RegExp(fr['admin.settings.index.mail']),
		})
		expect(lienMessagerie.getAttribute('href')).toBe(CHEMIN_ETAT_MESSAGERIE)
		// `CRM-079` : le guide vient en PREMIER, un guide de démarrage se lisant avant les écrans
		// qu'il présente (docs/SPEC-onboarding.md §4.3).
		const lienGuide = screen.getByRole('link', {
			name: new RegExp(fr['admin.settings.index.onboarding']),
		})
		expect(lienGuide.getAttribute('href')).toBe(CHEMIN_DEMARRAGE)
		expect(screen.getAllByRole('link')[0]).toBe(lienGuide)
	})

	it("l'administration ne figure PAS dans la table des routes, et son adresse est nommée", () => {
		// Elle n'est pas une entrée de la barre latérale : la table doit continuer de couvrir
		// exactement les entrées transverses (assertion ci-dessus), et l'écran est monté par `App`.
		expect(ROUTES.map((route) => route.chemin)).not.toContain(CHEMIN_ADMIN_ARBORESCENCE)
		expect(CHEMIN_ADMIN_ARBORESCENCE.startsWith('/reglages/')).toBe(true)
	})

	it("l'état de la messagerie ne figure PAS dans la table des routes, et son adresse est nommée", () => {
		// Même patron que l'administration de l'arborescence, et pour la même raison.
		expect(ROUTES.map((route) => route.chemin)).not.toContain(CHEMIN_ETAT_MESSAGERIE)
		expect(CHEMIN_ETAT_MESSAGERIE.startsWith('/reglages/')).toBe(true)
	})

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
