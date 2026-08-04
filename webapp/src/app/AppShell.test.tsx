// @verifies CRM-007 (docs/BACKLOG.md) — coquille : points de repère, états, préférences
// @verifies docs/DESIGN_SYSTEM.md §4 (architecture), §5.8 (états), §8 (accessibilité)
// @verifies docs/SPEC-webapp.md §5.1 (coquille), §7 (états), §9 (accessibilité), §11 (stockage)
//
// Les composants sont réellement montés et interrogés par leur **rôle accessible** quand il
// existe : un test qui n'interrogerait que des classes CSS validerait une apparence sans rien
// dire de l'utilisabilité.

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router'
import type { ClientCrm } from '../lib/supabase'
import type { Track } from '../lib/tracks'
import type { Workspace } from '../lib/workspaces'

const injecte = vi.hoisted(() => ({ client: null as ClientCrm | null }))

// Le client est lu à chaque rendu au travers d'un accesseur : un même fichier de tests peut
// ainsi éprouver la configuration absente **et** la configuration présente.
vi.mock('../lib/supabase', () => ({
	get clientCrm() {
		return injecte.client
	},
}))

const { AppShell } = await import('./AppShell')

type Reponse = {
	data: Workspace[] | Track[] | null
	error: { message: string } | null
	status: number
}

/**
 * Client factice servant **deux** tables depuis `CRM-020` : `workspaces`, lue par l'en-tête, et
 * `tracks`, lue par la barre latérale.
 *
 * Le constructeur de requête reproduit la forme réellement employée par `webapp/src/lib` :
 * `select().order()` pour les workspaces, `select().is().order().order()` pour les tracks. Chaque
 * maillon rend un objet qui porte à la fois les affineurs et la promesse, de sorte que la chaîne
 * puisse être terminée à n'importe quelle profondeur — c'est ce que fait `postgrest-js`, dont le
 * constructeur est un `thenable`.
 */
function client(reponses: readonly Reponse[], reponsesTracks?: readonly Reponse[]): ClientCrm {
	const rangs: Record<string, number> = {}

	const suivante = (table: string): Reponse => {
		const suite = table === 'tracks' ? (reponsesTracks ?? [VIDE]) : reponses
		const rang = rangs[table] ?? 0
		rangs[table] = rang + 1
		return suite[Math.min(rang, suite.length - 1)] as Reponse
	}

	const constructeur = (table: string): unknown => {
		const chaine = {
			is: () => chaine,
			order: () => chaine,
			then: (resoudre: (valeur: Reponse) => unknown) => Promise.resolve(suivante(table)).then(resoudre),
		}
		return chaine
	}

	return {
		from: (table: string) => ({ select: () => constructeur(table) }),
	} as unknown as ClientCrm
}

const VIDE: Reponse = { data: [], error: null, status: 200 }
const REFUS: Reponse = { data: null, error: { message: 'permission denied' }, status: 403 }
const PANNE: Reponse = { data: null, error: { message: 'Failed to fetch' }, status: 0 }
const UNE_LIGNE: Reponse = {
	data: [{ id: 'w-1', name: 'Atelier P2Enjoy', slug: 'atelier' }],
	error: null,
	status: 200,
}
const TROIS_TRACKS: Reponse = {
	data: [
		{ id: 't-1', name: 'Conseil & IA', slug: 'conseil-ia', color: 'brand', icon: 'sparkles', position: 1 },
		{
			id: 't-2',
			name: 'Studio web',
			slug: 'studio-web',
			color: 'success',
			icon: 'layout-dashboard',
			position: 2,
		},
		{ id: 't-3', name: 'Formation', slug: 'formation', color: 'accent', icon: 'inconnue', position: 3 },
	],
	error: null,
	status: 200,
}

function monter() {
	return render(
		<MemoryRouter>
			<AppShell cleTitreRoute="route.board.title">
				<p>{'contenu'}</p>
			</AppShell>
		</MemoryRouter>,
	)
}

beforeEach(() => {
	injecte.client = client([VIDE])
	globalThis.sessionStorage.clear()
	globalThis.localStorage.clear()
})

afterEach(cleanup)

describe('points de repère (docs/DESIGN_SYSTEM.md §8)', () => {
	it('expose une bannière, une navigation, un complément et un contenu principal', async () => {
		monter()
		expect(screen.getByRole('banner')).toBeTruthy()
		expect(screen.getByRole('main')).toBeTruthy()
		expect(screen.getByRole('complementary', { name: 'Barre latérale' })).toBeTruthy()
		expect(screen.getByRole('navigation', { name: 'Navigation principale' })).toBeTruthy()
		await waitFor(() => expect(screen.getByTestId('workspace-absent')).toBeTruthy())
	})

	it('place le lien d’évitement en premier élément focusable, et il vise le contenu', () => {
		monter()
		const lien = screen.getByTestId('lien-evitement')
		expect(lien.getAttribute('href')).toBe('#contenu-principal')
		expect(screen.getByRole('main').id).toBe('contenu-principal')
	})

	it('rend une région d’annonces dès le premier rendu, avant tout message', () => {
		monter()
		const region = screen.getByTestId('region-annonces')
		expect(region.getAttribute('aria-live')).toBe('polite')
	})

	it('n’a aucun saut de niveau de titre : un seul h1, et des h2 ensuite', async () => {
		monter()
		await waitFor(() => expect(screen.getByTestId('workspace-absent')).toBeTruthy())
		expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
		expect(screen.queryAllByRole('heading', { level: 4 })).toHaveLength(0)
	})
})

describe('états systématiques (docs/DESIGN_SYSTEM.md §5.8)', () => {
	it('affiche des squelettes pendant le chargement, jamais un spinner plein écran', () => {
		monter()
		expect(screen.getAllByTestId('squelette').length).toBeGreaterThan(0)
	})

	// « 200 et zéro ligne » est le comportement réel de la RLS en refus par défaut : la
	// coquille laisse alors la route rendre son contenu, et n'usurpe pas la zone principale
	// avec une erreur qui n'a pas eu lieu.
	it('traite « 200 et zéro ligne » comme un état vide, pas comme une erreur', async () => {
		monter()
		await waitFor(() => expect(screen.getByTestId('tracks-vides')).toBeTruthy())
		expect(screen.queryByTestId('etat-erreur')).toBeNull()
		expect(screen.queryByTestId('etat-refus')).toBeNull()
		expect(screen.getByText('contenu')).toBeTruthy()
	})

	// Depuis `CRM-020`, la région relaie **deux** chargements : le contexte d'espace de travail
	// et les tracks de la barre latérale. N'en annoncer qu'un laisserait l'autre changer en
	// silence (docs/DESIGN_SYSTEM.md §8).
	it('annonce l’absence d’espace de travail et de track dans la région polie', async () => {
		monter()
		await waitFor(() =>
			expect(screen.getByTestId('region-annonces').textContent).toBe(
				'Aucun espace de travail accessible Aucun track accessible',
			),
		)
	})

	it('affiche l’état de refus, distinct de l’erreur, quand le backend refuse', async () => {
		injecte.client = client([REFUS])
		monter()
		await waitFor(() => expect(screen.getByTestId('etat-refus')).toBeTruthy())
		expect(screen.queryByTestId('etat-erreur')).toBeNull()
	})

	it('affiche l’état d’erreur avec une reprise quand le transport échoue', async () => {
		injecte.client = client([PANNE])
		monter()
		await waitFor(() => expect(screen.getByTestId('etat-erreur')).toBeTruthy())
		expect(screen.getByRole('button', { name: 'Réessayer' })).toBeTruthy()
	})

	// La reprise doit relancer la requête, pas recharger la page
	// (docs/SPEC-webapp.md §7). On le prouve en rendant la seconde réponse différente.
	it('la reprise relance réellement la requête', async () => {
		injecte.client = client([PANNE, UNE_LIGNE])
		monter()
		const bouton = await screen.findByRole('button', { name: 'Réessayer' })
		bouton.click()
		await waitFor(() => expect(screen.getByTestId('workspace-courant').textContent).toBe('Atelier P2Enjoy'))
		expect(screen.queryByTestId('etat-erreur')).toBeNull()
	})

	// La barre latérale liste les tracks depuis `CRM-020`. Ce test monte la coquille entière, et
	// non la seule barre : il prouve que le chargement des tracks est bien câblé à l'écran, ce
	// que `SectionTracks.test.tsx` ne dit pas — il monte la barre avec un état déjà résolu.
	it('liste les tracks du backend dans la barre latérale, et l’annonce', async () => {
		injecte.client = client([UNE_LIGNE], [TROIS_TRACKS])
		monter()
		await waitFor(() => expect(screen.getAllByTestId('entree-track')).toHaveLength(3))
		expect(screen.getByText('Conseil & IA')).toBeTruthy()
		expect(screen.getByTestId('region-annonces').textContent).toBe(
			'Espaces de travail chargés Tracks chargés',
		)
		expect(screen.queryByTestId('tracks-vides')).toBeNull()
	})

	// Un échec du chargement des tracks ne doit pas être avalé : la barre latérale n'a pas la
	// place de l'expliquer, donc la zone principale s'en charge (CLAUDE.md §18).
	it('remonte un échec des tracks dans la zone principale, même si les workspaces répondent', async () => {
		injecte.client = client([UNE_LIGNE], [PANNE])
		monter()
		await waitFor(() => expect(screen.getByTestId('etat-erreur')).toBeTruthy())
		expect(screen.getByRole('button', { name: 'Réessayer' })).toBeTruthy()
	})

	it('affiche l’état de configuration incomplète quand aucun client n’a pu être construit', () => {
		injecte.client = null
		monter()
		expect(screen.getByTestId('etat-configuration')).toBeTruthy()
		expect(screen.queryByTestId('etat-erreur')).toBeNull()
	})
})

describe('préférences et stockage (CLAUDE.md §11)', () => {
	it('n’écrit jamais dans localStorage, même après avoir replié la barre', async () => {
		monter()
		screen.getByTestId('bascule-repli').click()
		await waitFor(() =>
			expect(screen.getByTestId('barre-laterale').getAttribute('data-replie')).toBe('oui'),
		)
		expect(globalThis.localStorage.length).toBe(0)
		expect(globalThis.sessionStorage.getItem('p2enjoy.sidebar.replie')).toBe('1')
	})

	it('relit la préférence de repli au montage suivant, dans la même session', async () => {
		globalThis.sessionStorage.setItem('p2enjoy.sidebar.replie', '1')
		monter()
		await waitFor(() =>
			expect(screen.getByTestId('barre-laterale').getAttribute('data-replie')).toBe('oui'),
		)
	})
})
