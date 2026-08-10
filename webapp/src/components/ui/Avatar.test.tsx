// @verifies CRM-022 (docs/BACKLOG.md) — avatar sûr, accessible et repli sans trou
// @verifies docs/SPEC-identite.md §7 ; docs/DESIGN_SYSTEM.md §8

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Avatar } from './Avatar'

afterEach(cleanup)

const CAMILLE = {
	id: 'profil-1',
	full_name: 'Camille Aubert',
	avatar_url: '/avatars/camille-aubert.svg',
}

describe('Avatar', () => {
	it('rend l’image sûre avec son nom accessible quand elle représente seule la personne', () => {
		render(<Avatar profil={CAMILLE} taille={32} />)
		const image = screen.getByRole('img', { name: 'Camille Aubert' })
		expect(image.getAttribute('src')).toBe('/avatars/camille-aubert.svg')
		expect(screen.getByTestId('avatar').getAttribute('title')).toBe('Camille Aubert')
	})

	it('rend l’image décorative lorsque le nom est déjà écrit à côté', () => {
		render(<Avatar profil={CAMILLE} taille={24} decoratif />)
		const image = within(screen.getByTestId('avatar')).getByAltText('')
		expect(image.getAttribute('alt')).toBe('')
	})

	it('retombe sur les initiales accessibles si l’image échoue', () => {
		render(<Avatar profil={CAMILLE} taille={32} />)
		fireEvent.error(screen.getByRole('img', { name: 'Camille Aubert' }))
		expect(screen.getByRole('img', { name: 'Camille Aubert' }).textContent).toBe('CA')
	})

	it('n’envoie jamais une URL refusée au navigateur', () => {
		render(
			<Avatar
				profil={{ ...CAMILLE, avatar_url: 'javascript:alert(1)' }}
				taille={24}
			/>,
		)
		const avatar = screen.getByTestId('avatar')
		expect(avatar.querySelector('img')).toBeNull()
		expect(screen.getByRole('img', { name: 'Camille Aubert' }).textContent).toBe('CA')
	})

	it('nomme un profil détaché par le repli fourni', () => {
		render(<Avatar profil={null} nomDeRepli="Compte supprimé" taille={24} />)
		expect(screen.getByRole('img', { name: 'Compte supprimé' }).textContent).toBe('CS')
	})

	it('ne rend rien lorsqu’aucun nom n’est connaissable', () => {
		const { container } = render(<Avatar profil={null} taille={24} />)
		expect(container.childElementCount).toBe(0)
	})
})
