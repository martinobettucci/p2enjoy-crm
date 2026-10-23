// @verifies CRM-110 (docs/BACKLOG.md) tranche T2 — le fil d'Ariane de l'en-tête
// @verifies docs/SPEC-webapp.md §5.1 bis (workspace en tête, ancêtres en liens, titre ; règle 4, le workspace sans
//           donnée)
// @verifies docs/DESIGN_SYSTEM.md §5.62 (liens, `h1` en `aria-current`, repli au clavier, Échap, clic extérieur),
//           §12.2 (ordre de sacrifice), §5.46 (le fil cède à la recherche ouverte)
//
// Le composant est interrogé par ses RÔLES : liens, titre, bouton et panneau. L'ordre de sacrifice, lui, est écrit en
// classes de palier que jsdom n'évalue pas — il est lu sur les classes ici, et VU aux quatre paliers par la preuve E2E
// et les captures (`e2e/ui/fil-ariane.spec.ts`).

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { MemoryRouter } from 'react-router'
import type { EtatAsync } from '../lib/async'
import type { NiveauAriane } from '../lib/fil-ariane'
import type { Workspace } from '../lib/workspaces'
import { FilAriane } from './FilAriane'

const ESPACE: EtatAsync<readonly Workspace[]> = {
	statut: 'pret',
	donnees: [{ id: 'w-1', name: 'Atelier P2Enjoy', slug: 'atelier' }],
}
const ANCETRES: readonly NiveauAriane[] = [
	{ libelle: 'Gestion commerciale', vers: '/tracks/gestion-commerciale' },
	{ libelle: 'Partenariats marques', vers: '/tracks/gestion-commerciale/partenariats-marques' },
]

function monter({
	ancetres = ANCETRES,
	etat = ESPACE,
	rechercheOuverte = false,
}: {
	readonly ancetres?: readonly NiveauAriane[]
	readonly etat?: EtatAsync<readonly Workspace[]>
	readonly rechercheOuverte?: boolean
} = {}) {
	return render(
		<MemoryRouter>
			<header className="relative">
				<FilAriane titre="VideoCoding" ancetres={ancetres} etatWorkspaces={etat} rechercheOuverte={rechercheOuverte} />
			</header>
			<button type="button">Ailleurs</button>
		</MemoryRouter>,
	)
}

const fil = () => screen.getByRole('navigation', { name: "Fil d'Ariane" })
const repli = () => screen.getByRole('button', { name: 'Afficher le chemin complet' })

afterEach(cleanup)

describe('FilAriane — le chemin d’une affaire', () => {
	it('nomme le workspace, le track, le channel puis l’affaire, dans cet ordre', () => {
		monter()
		const niveaux = within(fil()).getAllByRole('listitem').map((niveau) => niveau.textContent?.replace('/', '').trim())
		// Le premier élément est le repli, dont le texte n'est que son nom accessible masqué.
		expect(niveaux.slice(1)).toEqual(['Atelier P2Enjoy', 'Gestion commerciale', 'Partenariats marques', 'VideoCoding'])
	})

	it('le workspace et les ancêtres sont des liens vers leur route', () => {
		monter()
		const ligne = within(fil()).getByRole('list')
		expect(within(ligne).getByRole('link', { name: 'Atelier P2Enjoy' }).getAttribute('href')).toBe('/')
		expect(within(ligne).getByRole('link', { name: 'Gestion commerciale' }).getAttribute('href')).toBe(
			'/tracks/gestion-commerciale',
		)
		expect(within(ligne).getByRole('link', { name: 'Partenariats marques' }).getAttribute('href')).toBe(
			'/tracks/gestion-commerciale/partenariats-marques',
		)
	})

	it('le titre est le seul `h1`, n’est pas un lien, et porte `aria-current="page"`', () => {
		monter()
		const titre = screen.getByRole('heading', { level: 1 })
		expect(titre.textContent).toBe('VideoCoding')
		expect(titre.getAttribute('aria-current')).toBe('page')
		expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
		expect(within(fil()).queryByRole('link', { name: 'VideoCoding' })).toBeNull()
	})

	it('chaque nom tronqué garde son nom complet en `title`', () => {
		monter()
		expect(within(fil()).getByRole('link', { name: 'Gestion commerciale' }).getAttribute('title')).toBe(
			'Gestion commerciale',
		)
		expect(screen.getByRole('heading', { level: 1 }).getAttribute('title')).toBe('VideoCoding')
	})

	it('les séparateurs ne sont pas annoncés', () => {
		monter()
		const separateurs = within(fil())
			.getAllByText('/')
			.filter((element) => element.getAttribute('aria-hidden') === 'true')
		expect(separateurs.length).toBe(within(fil()).getAllByText('/').length)
	})

	it('hors d’un track, le fil est `Workspace / titre`', () => {
		monter({ ancetres: [] })
		expect(screen.queryAllByTestId('fil-ariane-ancetre')).toHaveLength(0)
		expect(within(fil()).getByRole('link', { name: 'Atelier P2Enjoy' })).toBeTruthy()
	})
})

describe('FilAriane — ordre de sacrifice (§12.2, décision 641)', () => {
	it('sous `lg`, le fil prend la ligne suivante de l’en-tête, entière', () => {
		monter()
		const classes = screen.getByTestId('fil-ariane').className.split(' ')
		expect(classes).toEqual(expect.arrayContaining(['order-last', 'basis-full', 'lg:order-none', 'lg:basis-0']))
	})

	it('sous `md`, tout niveau sauf le parent immédiat et le titre quitte la ligne', () => {
		monter()
		const workspace = screen.getByTestId('workspace-courant').closest('li')
		expect(workspace?.className).toContain('hidden md:flex')
		const [track, channel] = screen.getAllByTestId('fil-ariane-ancetre')
		expect(track?.className).toContain('hidden md:flex')
		expect(channel?.className.split(' ')).not.toContain('hidden')
		expect(screen.getByRole('heading', { level: 1 }).closest('li')?.className.split(' ')).not.toContain('hidden')
	})

	it('le repli et son panneau n’existent que sous `md`, où ils cachent au moins le workspace', () => {
		monter()
		expect(repli().closest('li')?.className).toContain('md:hidden')
		fireEvent.click(repli())
		expect(screen.getByTestId('fil-ariane-panneau').className).toContain('md:hidden')
	})

	it('la recherche ouverte fait céder le fil entier sous `lg` (§5.46)', () => {
		monter({ rechercheOuverte: true })
		expect(screen.getByTestId('fil-ariane').className).toContain('hidden lg:block')
	})
})

describe('FilAriane — le repli « … »', () => {
	it('s’ouvre au clavier, déclare son état et porte le focus dans le panneau', () => {
		monter()
		expect(repli().getAttribute('aria-expanded')).toBe('false')
		fireEvent.click(repli())
		expect(repli().getAttribute('aria-expanded')).toBe('true')
		const panneau = screen.getByRole('region', { name: 'Chemin complet' })
		expect(repli().getAttribute('aria-controls')).toBe(panneau.id)
		expect(document.activeElement).toBe(panneau)
	})

	it('liste le workspace et les ancêtres masqués, jamais le parent immédiat ni le titre', () => {
		monter()
		fireEvent.click(repli())
		const panneau = screen.getByRole('region', { name: 'Chemin complet' })
		const liens = within(panneau).getAllByRole('link').map((lien) => lien.textContent)
		expect(liens).toEqual(['Atelier P2Enjoy', 'Gestion commerciale'])
	})

	it('`Échap` le referme et rend le focus au repli', () => {
		monter()
		fireEvent.click(repli())
		fireEvent.keyDown(globalThis.window, { key: 'Escape' })
		expect(screen.queryByTestId('fil-ariane-panneau')).toBeNull()
		expect(document.activeElement).toBe(repli())
		expect(repli().getAttribute('aria-expanded')).toBe('false')
	})

	it('un clic extérieur le referme sans déplacer le focus', () => {
		monter()
		fireEvent.click(repli())
		const ailleurs = screen.getByRole('button', { name: 'Ailleurs' })
		fireEvent.mouseDown(ailleurs)
		expect(screen.queryByTestId('fil-ariane-panneau')).toBeNull()
		expect(document.activeElement).not.toBe(repli())
	})

	it('un clic à l’intérieur du panneau ne le referme pas', () => {
		monter()
		fireEvent.click(repli())
		fireEvent.mouseDown(screen.getByTestId('fil-ariane-panneau'))
		expect(screen.getByTestId('fil-ariane-panneau')).toBeTruthy()
	})

	it('suivre un lien du panneau le referme', () => {
		monter()
		fireEvent.click(repli())
		fireEvent.click(within(screen.getByTestId('fil-ariane-panneau')).getByRole('link', { name: 'Gestion commerciale' }))
		expect(screen.queryByTestId('fil-ariane-panneau')).toBeNull()
	})
})

describe('FilAriane — le workspace sans donnée (règle 4)', () => {
	it('pendant la lecture, un squelette nommé à sa place', () => {
		monter({ etat: { statut: 'chargement' } })
		expect(within(fil()).getByLabelText('Chargement du workspace')).toBeTruthy()
		expect(screen.queryByTestId('workspace-courant')).toBeNull()
	})

	it('sur un échec, « Aucun workspace accessible » en texte, sans lien', () => {
		monter({ etat: { statut: 'erreur', erreur: { nature: 'network', detail: 'panne' } } })
		expect(screen.getByTestId('workspace-absent').textContent).toBe('Aucun workspace accessible')
		expect(within(fil()).queryByRole('link', { name: 'Aucun workspace accessible' })).toBeNull()
	})

	it('sans workspace, le même message — jamais un niveau vide', () => {
		monter({ etat: { statut: 'pret', donnees: [] } })
		expect(screen.getByTestId('workspace-absent')).toBeTruthy()
	})
})
