// @verifies CRM-133 (docs/BACKLOG.md) — tranche T2 : le bouton d'information d'une étape — absent sans description, nommé
//           par l'étape, ouvert au focus clavier et à Entrée, fermé à Échap (docs/DESIGN_SYSTEM.md §5.58, révisé)
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BoutonDescriptionEtape } from './BoutonDescriptionEtape'

/** jsdom rend `:focus-visible` toujours faux : la modalité clavier est simulée sur ce seul sélecteur (cf. Infobulle.test). */
function simulerModaliteClavier() {
	const origine = Element.prototype.matches
	vi.spyOn(Element.prototype, 'matches').mockImplementation(function (this: Element, selecteur: string) {
		return selecteur === ':focus-visible' ? true : origine.call(this, selecteur)
	})
}
const bulle = () => screen.queryByTestId('infobulle')

beforeEach(() => {
	vi.useFakeTimers({ shouldAdvanceTime: true })
})
afterEach(() => {
	vi.restoreAllMocks()
	vi.useRealTimers()
	cleanup()
})

describe('le bouton d’information d’une étape (§5.58)', () => {
	it('n’est pas rendu sans description effective, ni pour une description blanche', () => {
		const { container, rerender } = render(<BoutonDescriptionEtape etape="Relance" description={null} />)
		expect(container.innerHTML).toBe('')
		rerender(<BoutonDescriptionEtape etape="Relance" description={'  \n '} />)
		expect(container.innerHTML).toBe('')
	})

	it('est un bouton nommé par l’étape, qui cite la description par `aria-describedby`', () => {
		render(<BoutonDescriptionEtape etape="Négociation" description="Le devis est envoyé." />)
		const bouton = screen.getByRole('button', { name: 'Description de l’étape Négociation' })
		const id = bouton.getAttribute('aria-describedby')
		expect(id).not.toBeNull()
		expect(document.getElementById(id!)?.textContent).toBe('Le devis est envoyé.')
	})

	it('s’ouvre au focus clavier, se ferme à Échap et se rouvre à Entrée', async () => {
		simulerModaliteClavier()
		render(<BoutonDescriptionEtape etape="Négociation" description="Le devis est envoyé." />)
		const bouton = screen.getByRole('button', { name: 'Description de l’étape Négociation' })
		await act(async () => {
			bouton.focus()
			await vi.advanceTimersByTimeAsync(0)
		})
		expect(bulle()?.textContent).toContain('Le devis est envoyé.')
		expect(bulle()?.textContent).toContain('Négociation')
		await act(async () => {
			fireEvent.keyDown(document, { key: 'Escape' })
		})
		expect(bulle()).toBeNull()
		await act(async () => {
			fireEvent.keyDown(bouton, { key: 'Enter' })
			await vi.advanceTimersByTimeAsync(0)
		})
		expect(bulle()?.textContent).toContain('Le devis est envoyé.')
	})
})
