// @verifies CRM-093 (docs/BACKLOG.md) — tranche T4 : la navigation des réglages ; l'entrée d'un écran REFUSÉ devient un
//           texte citant son motif, les écrans consultables gardent leur lien
// @verifies docs/SPEC-droits-interface.md §3 (précision T4), §4 (en lecture : éteinte sans motif ; inconnue : offerte) ;
//           docs/DESIGN_SYSTEM.md §5.59, §5.10
// @verifies CRM-070 (docs/BACKLOG.md) — tranche T2 : l'entrée « Membres » vient après l'arborescence, et reste un lien
//           pour tous — l'écran se consulte (docs/SPEC-membres.md §3 ; docs/DESIGN_SYSTEM.md §5.61)
// @verifies CRM-068 (docs/BACKLOG.md) — tranche T4b1 : l'entrée « Modèles d'affaires », réservée, suit la règle de « Coût du
//           personnel » (docs/DESIGN_SYSTEM.md §5.71, §5.59)

import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it } from 'vitest'
import { FournisseurEspace } from './ContexteEspace'
import { IndexReglages } from './routes'
import type { Capacite } from '../lib/capacites'

afterEach(cleanup)

function monter(administration: Capacite) {
	render(
		<MemoryRouter>
			<FournisseurEspace valeur={{ idWorkspace: 'w', estAdmin: false, capacites: { administration, edition: 'permise' } }}>
				<IndexReglages />
			</FournisseurEspace>
		</MemoryRouter>,
	)
	return screen.getByTestId('entree-cout-personnel')
}

describe('la navigation des réglages et la capacité d’administration (CRM-093 T4)', () => {
	it('refusée : « Coût du personnel » devient un texte qui cite le motif, en tête de la liste', () => {
		const entree = monter('refusee')
		const motif = screen.getByTestId('motif-reglages')
		expect(entree.tagName).not.toBe('A')
		expect(entree.getAttribute('aria-disabled')).toBe('true')
		expect(entree.getAttribute('aria-describedby')).toBe(motif.id)
		// Révisé par `CRM-068` T4b1 : le motif nomme désormais les trois entrées réservées (décision 51).
		expect(motif.textContent).toContain('« Coût du personnel » sont réservés aux administrateurs')
		const modeles = screen.getByTestId('entree-modeles-affaires')
		expect(modeles.tagName).not.toBe('A')
		expect(modeles.getAttribute('aria-describedby')).toBe(motif.id)
	})

	it('refusée : les écrans consultables en lecture seule gardent leur lien', () => {
		monter('refusee')
		for (const nom of [/Arborescence/, /Membres/, /Corbeille/, /Notifications/]) {
			expect(screen.getByRole('link', { name: nom })).toBeTruthy()
		}
	})

	it('en lecture : texte sans motif ; permise ou inconnue : lien, sans motif', () => {
		const enLecture = monter('en-lecture')
		expect(enLecture.tagName).not.toBe('A')
		expect(enLecture.hasAttribute('aria-describedby')).toBe(false)
		expect(screen.queryByTestId('motif-reglages')).toBeNull()
		cleanup()
		for (const administration of ['permise', 'inconnue'] as const) {
			expect(monter(administration).tagName).toBe('A')
			expect(screen.queryByTestId('motif-reglages')).toBeNull()
			cleanup()
		}
	})

	it('« Membres » suit immédiatement l’arborescence et mène à /reglages/membres', () => {
		monter('permise')
		const liens = screen.getAllByRole('link')
		const rang = liens.findIndex((lien) => /Arborescence/.test(lien.textContent ?? ''))
		expect(liens[rang + 1]?.getAttribute('href')).toBe('/reglages/membres')
		expect(liens[rang + 1]?.textContent).toContain('Membres : personnes et rôles')
	})
})
