// @verifies CRM-066 (docs/BACKLOG.md) — tranche 4 : le bloc « Santé de l'affaire » de la fiche, et la pastille partagée
// @verifies docs/SPEC-analytique.md §13.2, §13.3, §13.6 ; docs/DESIGN_SYSTEM.md §5.65 (palier écrit dans le nom
//           accessible, « Aucune pénalité », « inconnu », aucun bloc pour une affaire décidée) ; décisions 723 et 724

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const injecte: { ligne: Record<string, unknown> | null } = { ligne: null }

vi.mock('../lib/supabase', () => ({
	get clientCrm() {
		return {
			// `CRM-111` T2.4.5 : la lecture trie les rattachements de l'affaire avant d'en prendre un.
			from: () => ({
				select: () => ({
					eq: () => {
						const chaine = {
							order: () => chaine,
							limit: () =>
								Promise.resolve({ data: injecte.ligne === null ? [] : [injecte.ligne], error: null, status: 200 }),
						}
						return chaine
					},
				}),
			}),
		}
	},
}))

const { BlocSanteCard } = await import('./BlocSanteCard')

afterEach(cleanup)

describe('BlocSanteCard (§5.65)', () => {
	it('écrit chaque score, son palier, et le détail — le palier est dans le nom accessible de la pastille', async () => {
		injecte.ligne = {
			health_momentum: { score: 55, tier: 'watch', penalties: [{ code: 'stale_step', points: 30, days: 16, threshold: 14 }] },
			health_commercial: {
				score: 33,
				tier: 'danger',
				signals: [
					{ code: 'probability', weight: 40, value: 10 },
					{ code: 'step_age', weight: 15, value: null, status: 'unknown' },
				],
			},
		}
		render(<BlocSanteCard idCard="c1" />)
		expect(await screen.findByRole('img', { name: 'Dynamique 55 sur 100, à surveiller' })).toBeTruthy()
		expect(screen.getByRole('img', { name: 'Santé 33 sur 100, en danger' })).toBeTruthy()
		expect(screen.getByText('Étape figée depuis 16 jours (seuil 14)')).toBeTruthy()
		expect(screen.getByText('−30')).toBeTruthy()
		expect(screen.getByText('10/100, poids 40 %')).toBeTruthy()
		expect(screen.getByText('inconnu, poids 15 % réparti')).toBeTruthy()
	})

	it('une dynamique sans pénalité le dit en une phrase', async () => {
		injecte.ligne = { health_momentum: { score: 100, tier: 'healthy', penalties: [] }, health_commercial: null }
		render(<BlocSanteCard idCard="c1" />)
		expect(await screen.findByText('Aucune pénalité.')).toBeTruthy()
	})

	it('une affaire décidée n’a aucun bloc', async () => {
		injecte.ligne = { health_momentum: null, health_commercial: null }
		const { container } = render(<BlocSanteCard idCard="c1" />)
		await vi.waitFor(() => expect(container.querySelector('[aria-busy], [role="status"]')).toBeNull())
		expect(screen.queryByTestId('bloc-sante')).toBeNull()
	})

	it('une affaire illisible rend une erreur dite, sans masquer la fiche', async () => {
		injecte.ligne = null
		render(<BlocSanteCard idCard="c1" />)
		expect((await screen.findByTestId('bloc-sante-erreur')).getAttribute('role')).toBe('alert')
	})
})
