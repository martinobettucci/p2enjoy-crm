// @verifies CRM-093 (docs/BACKLOG.md) — tranche T2 : le motif d'une commande refusée, dit une fois en tête du bloc
// @verifies docs/DESIGN_SYSTEM.md §5.59, §5.29 ter (bandeau neutre, `role="status"`, icône décorative, l'identifiant
//           que les commandes citent) ; docs/SPEC-droits-interface.md §3

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { MotifLectureSeule } from './MotifLectureSeule'

afterEach(cleanup)

describe('le motif de lecture seule', () => {
	it('est un statut, jamais une alerte, et porte l’identifiant que les commandes citent', () => {
		render(
			<>
				<MotifLectureSeule id="motif-bloc">Vous consultez cet écran.</MotifLectureSeule>
				<button type="button" disabled aria-describedby="motif-bloc">
					Nouveau channel
				</button>
			</>,
		)
		const motif = screen.getByRole('status')
		expect(motif.id).toBe('motif-bloc')
		expect(screen.queryByRole('alert')).toBeNull()
		expect(screen.getByRole('button', { name: 'Nouveau channel' })).toHaveProperty('disabled', true)
		expect(screen.getByRole('button', { description: 'Vous consultez cet écran.' })).toBeTruthy()
	})

	it('son icône est décorative, et sa forme est le bandeau neutre du §5.29 ter', () => {
		render(<MotifLectureSeule id="m">Texte</MotifLectureSeule>)
		const motif = screen.getByTestId('motif-lecture-seule')
		expect(motif.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true')
		for (const classe of ['bg-hover', 'border-border', 'text-ink']) expect(motif.className).toContain(classe)
		expect(motif.className).not.toMatch(/danger|opacity/)
	})
})
