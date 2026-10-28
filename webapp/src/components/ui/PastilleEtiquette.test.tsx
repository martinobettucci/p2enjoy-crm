// @verifies CRM-069 (docs/BACKLOG.md) — tranche T2 : la pastille d'une étiquette et la rangée d'une affaire
// @verifies docs/DESIGN_SYSTEM.md §5.73 (point de tête et nom, archivée dite dans le nom accessible, plafond puis « +n »
//           qui nomme les masquées, aucune ligne sans étiquette), §1

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { Etiquette } from '../../lib/etiquettes'
import { PastilleEtiquette, PastillesEtiquettes } from './PastilleEtiquette'

afterEach(cleanup)

const e = (nom: string, partiel: Partial<Etiquette> = {}): Etiquette => ({ id: nom, nom, couleur: 'brand', archivee: false, ...partiel })

describe('la pastille d’une étiquette', () => {
	it('écrit le nom, porte un point de tête décoratif et sa teinte', () => {
		render(<PastilleEtiquette etiquette={e('Prioritaire', { couleur: 'danger' })} />)
		const pastille = screen.getByTestId('pastille-etiquette')
		expect(pastille.textContent).toBe('Prioritaire')
		expect(pastille.getAttribute('data-couleur')).toBe('danger')
		expect(pastille.querySelector('[aria-hidden="true"]')).not.toBeNull()
		expect(pastille.className).toContain('text-danger-on-soft')
	})

	it('archivée, son nom accessible et son infobulle le disent', () => {
		render(<PastilleEtiquette etiquette={e('Salon 2025', { couleur: 'neutral', archivee: true })} />)
		const pastille = screen.getByRole('img', { name: 'Salon 2025, étiquette archivée' })
		expect(pastille.getAttribute('title')).toBe('Salon 2025, étiquette archivée')
	})
})

describe('les pastilles d’une affaire', () => {
	it('avec un plafond de trois : trois pastilles, puis « +2 » qui nomme les masquées', () => {
		render(<PastillesEtiquettes etiquettes={['A', 'B', 'C', 'D', 'E'].map((n) => e(n))} plafond={3} />)
		expect(screen.getAllByTestId('pastille-etiquette').map((p) => p.textContent)).toEqual(['A', 'B', 'C'])
		const reste = screen.getByTestId('pastille-etiquettes-reste')
		expect(reste.textContent).toBe('+2')
		expect(reste.getAttribute('aria-label')).toBe('2 autres étiquettes : D, E')
	})

	it('sans plafond, toutes ; sans étiquette, rien du tout', () => {
		const { container } = render(<PastillesEtiquettes etiquettes={[]} />)
		expect(container.innerHTML).toBe('')
		render(<PastillesEtiquettes etiquettes={['A', 'B', 'C', 'D'].map((n) => e(n))} />)
		expect(screen.getAllByTestId('pastille-etiquette')).toHaveLength(4)
		expect(screen.queryByTestId('pastille-etiquettes-reste')).toBeNull()
	})
})
