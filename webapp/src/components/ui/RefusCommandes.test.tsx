// @verifies CRM-093 (docs/BACKLOG.md) — tranche T3 : le refus d'un bloc transmis à ses commandes
// @verifies docs/SPEC-droits-interface.md §3 (chaque commande cite le motif du bloc), §4 ; docs/DESIGN_SYSTEM.md §5.59

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { FournisseurRefus, useRefus } from './RefusCommandes'

afterEach(cleanup)

function Commande({ autre = false }: { readonly autre?: boolean }) {
	return (
		<button type="button" {...useRefus(autre)}>
			Agir
		</button>
	)
}

describe('le refus d’un bloc', () => {
	it('hors fournisseur, la commande est offerte', () => {
		render(<Commande />)
		const commande = screen.getByRole('button') as HTMLButtonElement
		expect(commande.disabled).toBe(false)
		expect(commande.hasAttribute('aria-describedby')).toBe(false)
	})

	it('refusée : chaque commande du bloc est désactivée et cite le motif', () => {
		render(
			<FournisseurRefus valeur={{ disabled: true, 'aria-describedby': 'motif' }}>
				<Commande />
				<Commande />
			</FournisseurRefus>,
		)
		for (const commande of screen.getAllByRole('button') as HTMLButtonElement[]) {
			expect(commande.disabled).toBe(true)
			expect(commande.getAttribute('aria-describedby')).toBe('motif')
		}
	})

	it('une désactivation étrangère au droit est gardée, sans motif inventé', () => {
		render(
			<FournisseurRefus valeur={{}}>
				<Commande autre />
			</FournisseurRefus>,
		)
		const commande = screen.getByRole('button') as HTMLButtonElement
		expect(commande.disabled).toBe(true)
		expect(commande.hasAttribute('aria-describedby')).toBe(false)
	})
})
