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
	CHEMIN_CONTACTS,
	CHEMIN_OBJECTIFS,
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
	//
	// RÉVISÉE UNE QUATRIÈME FOIS PAR `CRM-060`, ET POUR LE MOTIF DÉJÀ ÉCRIT : `/contacts` portait
	// un état vide inconditionnel, ce qui a cessé d'être vrai le jour où le carnet de contacts est
	// arrivé (`docs/SPEC-contacts.md` §10). La règle a changé par livraison, la preuve est donc
	// RÉVISÉE et non contournée : la route rejoint celles qui portent un écran, et son assertion
	// propre ci-dessous vérifie qu'elle rend bien un état explicite sans session.
	const ROUTES_EN_ATTENTE = ROUTES.filter(
		(route) =>
			route.chemin !== CHEMIN_INBOX &&
			route.chemin !== CHEMIN_CONTACTS &&
			route.chemin !== CHEMIN_OBJECTIFS &&
			route.chemin !== '/reglages' &&
			route.chemin !== '/',
	)

	it.each(ROUTES_EN_ATTENTE.map((route) => [route.chemin, route] as const))(
		'la route %s rend un état explicite',
		(_chemin, route) => {
			render(<MemoryRouter>{route.rendu()}</MemoryRouter>)
			expect(screen.getByTestId('etat-vide')).toBeTruthy()
			expect(screen.getByRole('heading').textContent?.length).toBeGreaterThan(0)
		},
	)

	it('la route / rend un état explicite SANS session, et n’interroge pas la base — §4.4', () => {
		// RÉVISÉE UNE QUATRIÈME FOIS, ET LA RÈGLE A ENCORE CHANGÉ PAR ARBITRAGE — le §4.4 de
		// `docs/SPEC-onboarding.md`, écrit après la mesure d'une régression réelle : monté sans
		// session, `/` rendait le guide ET déclenchait les cinq comptages, dont celui des boîtes
		// entrantes que la clé anonyme reçoit en `401`. La console de l'écran d'ARRIVÉE portait
		// donc une erreur (`docs/SPEC-onboarding.md` §3.1, fait 3).
		//
		// Cette preuve monte la route SANS fournisseur d'authentification : le contexte est donc
		// anonyme, exactement comme pour un visiteur sans session. Ce qu'elle exige est ce que le
		// §4.4 promet — l'état vide EXISTANT de `CRM-007`, inchangé.
		//
		// Le cas connecté, ses quatre issues et l'absence de requête sont éprouvés par
		// `GuideDemarrage.test.tsx`, qui déclare la session et compte les appels émis.
		const route = ROUTES.find((candidate) => candidate.chemin === '/')
		expect(route).toBeDefined()
		render(<MemoryRouter>{route!.rendu()}</MemoryRouter>)
		expect(screen.getByTestId('etat-vide')).toBeTruthy()
		expect(screen.queryByTestId('guide-demarrage')).toBeNull()
		expect(screen.getByRole('heading').textContent).toBe(fr['route.board.empty.title'])
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

	it('la route /objectifs rend son écran, chargé à la demande derrière un repli — CRM-083', async () => {
		// RÉVISÉE UNE CINQUIÈME FOIS, ET POUR LE MOTIF DÉJÀ ÉCRIT DEUX FOIS AU-DESSUS : `/objectifs`
		// n'a jamais porté d'état vide inconditionnel — l'entrée est CRÉÉE par `CRM-083` avec son
		// écran (`docs/SPEC-goals.md` §5.1). Elle rejoint donc d'emblée les routes qui portent un
		// écran chargé à la demande, et son assertion propre est ici. Montée SANS session, elle
		// rend l'état vide « aucun tableau d'objectifs », jamais une page blanche.
		const route = ROUTES.find((candidate) => candidate.chemin === CHEMIN_OBJECTIFS)
		expect(route).toBeDefined()
		render(
			<MemoryRouter>
				<Suspense fallback={<ChargementRoute />}>{route!.rendu()}</Suspense>
			</MemoryRouter>,
		)
		expect(screen.getByLabelText(fr['state.loading.aria'])).toBeTruthy()
		expect(await screen.findByTestId('etat-vide')).toBeTruthy()
	})

	it('la route /contacts rend son écran, chargé à la demande derrière un repli — CRM-060', async () => {
		// Même patron que l'inbox ci-dessous, et pour le même motif (`docs/SPEC-contacts.md` §10.2) :
		// le carnet est chargé à la demande, et le repli de `Suspense` est lui-même un état
		// explicite. Montée SANS session, la route rend l'état vide « aucun espace de travail »,
		// jamais une page blanche.
		const route = ROUTES.find((candidate) => candidate.chemin === CHEMIN_CONTACTS)
		expect(route).toBeDefined()
		render(
			<MemoryRouter>
				<Suspense fallback={<ChargementRoute />}>{route!.rendu()}</Suspense>
			</MemoryRouter>,
		)
		expect(screen.getByLabelText(fr['state.loading.aria'])).toBeTruthy()
		expect(await screen.findByTestId('etat-vide')).toBeTruthy()
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
