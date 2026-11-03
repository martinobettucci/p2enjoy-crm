// @verifies CRM-111 (docs/BACKLOG.md) T7.5 — la pastille « aussi rattachée à N » : absente sans autre rattachement, « +N »
//           visible, nom accessible accordé, focalisable, l'infobulle qui nomme les channels au focus clavier
//           (docs/DESIGN_SYSTEM.md §5.85, §5.58)

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { PastilleAussiRattachee } from './AussiRattachee'

afterEach(cleanup)

describe('la pastille « aussi rattachée à » (§5.85)', () => {
	it('n’existe pas sans autre rattachement', () => {
		const { container } = render(<PastilleAussiRattachee autres={[]} />)
		expect(container.innerHTML).toBe('')
	})

	it('accorde son nom accessible, et montre « +N »', () => {
		render(<PastilleAussiRattachee autres={[{ track: 'Conseil & IA', channel: 'Grands comptes' }]} />)
		expect(screen.getByRole('img', { name: 'Aussi rattachée à 1 autre channel' }).textContent).toBe('+1')
		cleanup()
		render(
			<PastilleAussiRattachee
				autres={[
					{ track: 'Conseil & IA', channel: 'Grands comptes' },
					{ track: 'Studio web', channel: 'Maintenance' },
				]}
			/>,
		)
		expect(screen.getByRole('img', { name: 'Aussi rattachée à 2 autres channels' }).textContent).toBe('+2')
	})

	it('au focus clavier, l’infobulle nomme chaque channel', async () => {
		render(
			<PastilleAussiRattachee
				autres={[
					{ track: 'Conseil & IA', channel: 'Grands comptes' },
					{ track: 'Studio web', channel: 'Maintenance' },
				]}
			/>,
		)
		await userEvent.tab()
		const pastille = screen.getByTestId('pastille-aussi-rattachee')
		expect(document.activeElement).toBe(pastille)
		const id = pastille.getAttribute('aria-describedby')
		expect(id).toBeTruthy()
		await waitFor(() => expect(document.getElementById(id!)?.textContent).toContain('Conseil & IA › Grands comptes'))
		expect(document.getElementById(id!)?.textContent).toContain('Studio web › Maintenance')
	})
})
