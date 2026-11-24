// @verifies CRM-007 (docs/BACKLOG.md) — coquille : points de repère, états, préférences
// @verifies docs/DESIGN_SYSTEM.md §4 (architecture), §5.8 (états), §8 (accessibilité)
// @verifies docs/SPEC-webapp.md §5.1 (coquille), §7 (états), §9 (accessibilité), §11 (stockage)
// @verifies CRM-161 (docs/BACKLOG.md) tranche T2.c — la page ne se monte qu'une fois les espaces lus, avec l'espace connu ;
//           un squelette entre-temps (docs/SPEC-espace-courant.md §15.4 bis, décision 974 ; docs/DESIGN_SYSTEM.md §5.8)
// @verifies CRM-161 (docs/BACKLOG.md) tranche T3.a — les non-lus de chaque espace lus une fois par la coquille, mis au contexte
//           pour le menu et le repli, et seulement pour une personne de deux espaces (docs/SPEC-espace-courant.md §16.4)
// @verifies INC-254, décision 608 — docs/SPEC-webapp.md §6.3 bis : la coquille relit ses tracks au signal
//           `p2enjoy:tracks-modifies`, sans squelette ni remontage de la page ; docs/DESIGN_SYSTEM.md §5.13
//
// Les composants sont réellement montés et interrogés par leur **rôle accessible** quand il
// existe : un test qui n'interrogerait que des classes CSS validerait une apparence sans rien
// dire de l'utilisabilité.

import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router'
import { useEffect, useState } from 'react'
import type { ClientCrm } from '../lib/supabase'
import { EVENEMENT_TRACKS_MODIFIES, type Track } from '../lib/tracks'
import type { Workspace } from '../lib/workspaces'
import { useContexteEspace } from './ContexteEspace'

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
			// `CRM-161` T2.a : les tracks de la barre sont filtrés par l'espace courant (`eq('workspace_id', …)`).
			eq: () => chaine,
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
		{ id: 't-1', name: 'Conseil & IA', slug: 'conseil-ia', color: 'brand', icon: 'sparkles', position: 1, description: null },
		{
			id: 't-2',
			name: 'Studio web',
			slug: 'studio-web',
			color: 'success',
			icon: 'layout-dashboard',
			position: 2,
			description: null,
		},
		{ id: 't-3', name: 'Formation', slug: 'formation', color: 'accent', icon: 'inconnue', position: 3, description: null },
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

describe('INC-254 — la barre latérale suit les écritures de l’arborescence (docs/SPEC-webapp.md §6.3 bis)', () => {
	it('relit ses tracks au signal, sans squelette et sans remonter la page', async () => {
		const DEUX_TRACKS: Reponse = { ...TROIS_TRACKS, data: (TROIS_TRACKS.data as Track[]).slice(0, 2) }
		injecte.client = client([UNE_LIGNE], [DEUX_TRACKS, TROIS_TRACKS])
		monter()
		await waitFor(() => expect(screen.getAllByTestId('entree-track')).toHaveLength(2))
		const contenu = screen.getByText('contenu')

		// Un track vient de naître sur l'arborescence, qui émet le signal.
		act(() => {
			globalThis.dispatchEvent(new Event(EVENEMENT_TRACKS_MODIFIES))
		})
		// Pendant la relecture, l'ancienne liste reste : aucun squelette, aucun clignotement.
		expect(screen.getAllByTestId('entree-track')).toHaveLength(2)
		await waitFor(() => expect(screen.getAllByTestId('entree-track')).toHaveLength(3))
		// La page n'a pas été remontée : c'est le même nœud, une saisie en cours y aurait survécu.
		expect(screen.getByText('contenu')).toBe(contenu)
	})
})

describe('la page attend les espaces (CRM-161 T2.c, décision 974)', () => {
	/** Une page qui note l'espace qu'elle voit À SON MONTAGE : c'est là que ses lectures partent. */
	function PageQuiLit({ montages }: { readonly montages: (string | null)[] }) {
		const { idWorkspace } = useContexteEspace()
		const [vu] = useState(idWorkspace)
		useEffect(() => {
			montages.push(vu)
		}, [montages, vu])
		return <p>{'page montée'}</p>
	}

	it('pendant la lecture des espaces : un squelette, et la page n’est pas montée ; ensuite, une fois, avec l’espace', async () => {
		let livrer: (reponse: Reponse) => void = () => undefined
		const enAttente = new Promise<Reponse>((resoudre) => {
			livrer = resoudre
		})
		const chaineEspaces = {
			eq: () => chaineEspaces,
			is: () => chaineEspaces,
			order: () => chaineEspaces,
			then: (resoudre: (valeur: Reponse) => unknown) => enAttente.then(resoudre),
		}
		const parDefaut = client([VIDE])
		injecte.client = {
			from: (table: string) => (table === 'workspaces' ? { select: () => chaineEspaces } : parDefaut.from(table as never)),
		} as unknown as ClientCrm
		const montages: (string | null)[] = []
		render(
			<MemoryRouter>
				<AppShell cleTitreRoute="route.board.title">
					<PageQuiLit montages={montages} />
				</AppShell>
			</MemoryRouter>,
		)

		const principal = screen.getByRole('main')
		expect(within(principal).getByLabelText('Chargement en cours')).toBeTruthy()
		expect(screen.queryByText('page montée')).toBeNull()
		expect(montages).toEqual([])

		await act(async () => {
			livrer(UNE_LIGNE)
			await enAttente
		})
		await waitFor(() => expect(screen.getByText('page montée')).toBeTruthy())
		expect(montages).toEqual(['w-1'])
		expect(within(principal).queryByLabelText('Chargement en cours')).toBeNull()
	})
})

describe('les non-lus de chaque espace, lus par la coquille (CRM-161 T3.a, §16.4)', () => {
	function PageQuiMontreLesNonLus() {
		const { nonLus } = useContexteEspace()
		if (nonLus === undefined) return <p>{'aucun non-lu partagé'}</p>
		if (nonLus.statut !== 'pret') return <p>{'non-lus en lecture'}</p>
		return <p>{`non-lus : ${[...nonLus.donnees.entries()].map(([id, n]) => `${id}=${n}`).join(',')}`}</p>
	}

	function clientAvecNonLus(espaces: Reponse, appels: { rpc: number }): ClientCrm {
		const base = client([espaces])
		return {
			from: (table: string) => base.from(table as never),
			rpc: (nom: string) => {
				appels.rpc += nom === 'inbox_unread_by_workspace' ? 1 : 0
				return Promise.resolve({ data: [{ workspace_id: 'w-2', unread_count: 3 }], error: null, status: 200 })
			},
		} as unknown as ClientCrm
	}

	it('deux espaces : une seule lecture, et le contexte porte les non-lus', async () => {
		const appels = { rpc: 0 }
		const DEUX: Reponse = {
			data: [
				{ id: 'w-1', name: 'Atelier P2Enjoy', slug: 'atelier' },
				{ id: 'w-2', name: 'Studio', slug: 'studio' },
			],
			error: null,
			status: 200,
		}
		injecte.client = clientAvecNonLus(DEUX, appels)
		render(
			<MemoryRouter>
				<AppShell cleTitreRoute="route.board.title">
					<PageQuiMontreLesNonLus />
				</AppShell>
			</MemoryRouter>,
		)
		await waitFor(() => expect(screen.getByText('non-lus : w-2=3')).toBeTruthy())
		expect(appels.rpc).toBe(1)
	})

	it('un seul espace : aucune lecture, rien au contexte', async () => {
		const appels = { rpc: 0 }
		injecte.client = clientAvecNonLus(UNE_LIGNE, appels)
		render(
			<MemoryRouter>
				<AppShell cleTitreRoute="route.board.title">
					<PageQuiMontreLesNonLus />
				</AppShell>
			</MemoryRouter>,
		)
		await waitFor(() => expect(screen.getByText('aucun non-lu partagé')).toBeTruthy())
		expect(appels.rpc).toBe(0)
	})
})
