// @verifies CRM-117 (docs/BACKLOG.md) — tranche T2 : le rendu d'un chapitre du manuel, bloc par bloc
// @verifies docs/SPEC-manual.md §13.3 (des blocs, jamais du HTML ; liens internes et externes ; image lue avec la
//           session puis libérée) ; docs/DESIGN_SYSTEM.md §5.69 (titres, note, tableau, image, « Voir en taille
//           réelle »), §5.20 (lien externe annoncé), §8

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Bloc } from '../lib/manuel'
import type { ClientCrm } from '../lib/supabase'
import { BlocsManuel } from './BlocsManuel'

afterEach(cleanup)

const creees: string[] = []
const liberees: string[] = []
beforeEach(() => {
	creees.length = 0
	liberees.length = 0
	vi.stubGlobal('URL', Object.assign(Object.create(URL), {
		createObjectURL: () => {
			const url = `blob:image-${creees.length}`
			creees.push(url)
			return url
		},
		revokeObjectURL: (url: string) => liberees.push(url),
	}))
	return () => vi.unstubAllGlobals()
})

/** Un stockage qui rend une image pour `board/carte.jpg`, et rien d'autre. */
const client = {
	storage: {
		from: () => ({
			download: (chemin: string) =>
				Promise.resolve(
					chemin === 'images/board/carte.jpg'
						? { data: new Blob(['x'], { type: 'image/jpeg' }), error: null }
						: { data: null, error: { message: 'not found', status: 400 } },
				),
		}),
	},
} as unknown as ClientCrm

const rendre = (blocs: Bloc[]) =>
	render(
		<MemoryRouter>
			<BlocsManuel blocs={blocs} client={client} />
		</MemoryRouter>,
	)

describe('les blocs de texte', () => {
	it('un titre de section est un h2 qui porte son ancre ; un niveau 4, un h3', () => {
		rendre([
			{ type: 'heading', level: 3, anchor: 'deplacer', content: [{ type: 'text', text: 'Déplacer' }] },
			{ type: 'heading', level: 4, anchor: null, content: [{ type: 'text', text: 'Au clavier' }] },
		])
		expect(screen.getByRole('heading', { level: 2, name: 'Déplacer' }).id).toBe('deplacer')
		expect(screen.getByRole('heading', { level: 3, name: 'Au clavier' })).toBeTruthy()
	})

	it('un texte qui ressemble à du HTML est rendu tel quel, jamais interprété', () => {
		const { container } = rendre([{ type: 'paragraph', content: [{ type: 'text', text: '<b>gras</b><script>x()</script>' }] }])
		expect(container.querySelector('b, script')).toBeNull()
		expect(container.textContent).toContain('<b>gras</b><script>x()</script>')
	})

	it('liste numérotée avec son départ, liste à puces, note, code et filet', () => {
		const { container } = rendre([
			{ type: 'list', ordered: true, start: 3, items: [[{ type: 'paragraph', content: [{ type: 'text', text: 'a' }] }]] },
			{ type: 'list', ordered: false, start: null, items: [[{ type: 'paragraph', content: [{ type: 'text', text: 'b' }] }]] },
			{ type: 'note', blocks: [{ type: 'paragraph', content: [{ type: 'text', text: 'Une note' }] }] },
			{ type: 'codeblock', text: 'npm run' },
			{ type: 'rule' },
		])
		expect(container.querySelector('ol')?.getAttribute('start')).toBe('3')
		expect(container.querySelectorAll('ul > li')).toHaveLength(1)
		expect(screen.getByTestId('note-manuel').textContent).toBe('Une note')
		expect(container.querySelector('pre code')?.textContent).toBe('npm run')
		expect(container.querySelector('hr')).not.toBeNull()
	})

	it('un tableau a ses en-têtes de colonne et son alignement, dans un conteneur qui défile', () => {
		const { container } = rendre([
			{
				type: 'table',
				align: [null, 'right'],
				header: [[{ type: 'text', text: 'Nom' }], [{ type: 'text', text: 'Valeur' }]],
				rows: [[[{ type: 'text', text: 'a' }], [{ type: 'text', text: '1' }]]],
			},
		])
		expect(screen.getAllByRole('columnheader').map((th) => th.textContent)).toEqual(['Nom', 'Valeur'])
		expect(container.querySelector('td:last-child')?.className).toContain('text-right')
		expect(container.querySelector('.indique-debordement-x table')).not.toBeNull()
	})
})

describe('les liens', () => {
	it('un lien vers une section mène à /aide/<chapitre>#<section>', () => {
		rendre([
			{
				type: 'paragraph',
				content: [{ type: 'link', target: { chapter: 'le-board', anchor: 'deplacer' }, content: [{ type: 'text', text: 'voir' }] }],
			},
		])
		expect(screen.getByRole('link', { name: 'voir' }).getAttribute('href')).toBe('/aide/le-board#deplacer')
	})

	it('un lien externe s’ouvre dans un nouvel onglet et l’annonce', () => {
		rendre([
			{
				type: 'paragraph',
				content: [{ type: 'link', href: 'https://example.org', external: true, content: [{ type: 'text', text: 'site' }] }],
			},
		])
		const lien = screen.getByRole('link', { name: /site/ })
		expect(lien.getAttribute('target')).toBe('_blank')
		expect(lien.getAttribute('rel')).toBe('noreferrer noopener')
		expect(lien.textContent).toContain('Ouvre un nouvel onglet')
	})
})

describe('les images (§14.2)', () => {
	it('lue avec la session, rendue depuis une adresse locale, libérée en quittant la page', async () => {
		const { unmount } = rendre([{ type: 'image', src: 'board/carte.jpg', alt: 'La carte', width: 320, height: 180 }])
		const image = await screen.findByRole('img', { name: 'La carte' })
		expect(image.getAttribute('src')).toBe('blob:image-0')
		expect(screen.queryByText('Voir en taille réelle')).toBeNull()
		unmount()
		expect(liberees).toEqual(['blob:image-0'])
	})

	it('indisponible, son texte alternatif prend sa place — jamais une image cassée', async () => {
		rendre([{ type: 'image', src: 'board/absente.jpg', alt: 'Une image absente', width: 320, height: 180 }])
		await waitFor(() => expect(screen.getByTestId('image-manuel-indisponible').textContent).toBe('Une image absente'))
		expect(screen.queryByRole('img')).toBeNull()
	})

	it('une image plus large que la colonne s’offre en taille réelle, dans un nouvel onglet', async () => {
		rendre([{ type: 'image', src: 'board/carte.jpg', alt: 'Le board entier', width: 1440, height: 900 }])
		const lien = await screen.findByRole('link', { name: 'Voir en taille réelle, dans un nouvel onglet : Le board entier' })
		expect(lien.getAttribute('href')).toBe('blob:image-0')
		expect(lien.getAttribute('target')).toBe('_blank')
	})
})
