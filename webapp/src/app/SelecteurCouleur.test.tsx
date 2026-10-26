// @verifies CRM-116 (docs/BACKLOG.md) tranche T3 — le sélecteur de couleur partagé
// @verifies docs/DESIGN_SYSTEM.md §5.68 et §5.29 (cinq pastilles nommées dans l'ordre de la palette, le choix qui ne repose pas
//           sur la couleur seule, groupe radio natif au clavier, valeur initiale et repli) ; §8 (rôles accessibles)
// @verifies docs/SPEC-administration-arborescence.md §14.3 (la valeur choisie est celle que le formulaire envoie)
//
// Le composant est interrogé par ses RÔLES — groupe, boutons radio et leurs noms —, et le clavier est celui de
// `user-event` : c'est le navigateur, et non le composant, qui doit faire avancer les flèches, et la preuve le vérifie.

import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SelecteurCouleur } from './SelecteurCouleur'

afterEach(cleanup)

/** Un hôte qui garde la valeur, comme le formulaire : le sélecteur est contrôlé. */
function Hote({ initiale, surChoix }: { readonly initiale: string; readonly surChoix?: (couleur: string) => void }) {
	const [valeur, setValeur] = useState(initiale)
	return (
		<SelecteurCouleur
			valeur={valeur}
			onChange={(couleur) => {
				setValeur(couleur)
				surChoix?.(couleur)
			}}
		/>
	)
}

const groupe = () => screen.getByRole('group', { name: 'Couleur' })
const options = () => screen.getAllByRole('radio')

describe('SelecteurCouleur — rendu', () => {
	it('un groupe nommé « Couleur », cinq boutons radio nommés en français, dans l’ordre de la palette', () => {
		render(<Hote initiale="neutral" />)
		expect(groupe()).toBeTruthy()
		expect(options().map((option) => option.closest('label')?.textContent)).toEqual([
			'Bleu',
			'Vert',
			'Jaune',
			'Rouge',
			'Gris',
		])
		// Jamais le nom du jeton à l'écran.
		expect(groupe().textContent).not.toMatch(/brand|success|accent|danger|neutral/)
	})

	it('coche la valeur initiale, et elle seule', () => {
		render(<Hote initiale="accent" />)
		expect(screen.getByRole('radio', { name: 'Jaune' })).toHaveProperty('checked', true)
		expect(options().filter((option) => (option as HTMLInputElement).checked)).toHaveLength(1)
	})

	it('affiche une valeur inconnue comme Gris, sans rien cocher d’autre', () => {
		render(<Hote initiale="turquoise" />)
		expect(screen.getByRole('radio', { name: 'Gris' })).toHaveProperty('checked', true)
		expect(options().filter((option) => (option as HTMLInputElement).checked)).toHaveLength(1)
	})

	it('le choix ne repose pas sur la couleur seule : radio coché visible, bordure et fond de marque (§5.29)', () => {
		render(<Hote initiale="success" />)
		const radio = screen.getByRole('radio', { name: 'Vert' })
		const choisie = radio.closest('label')
		const autre = screen.getByRole('radio', { name: 'Rouge' }).closest('label')
		// Le radio n'est pas masqué : son état coché est la marque du choix qui ne doit rien à la couleur.
		expect(radio.className).not.toContain('sr-only')
		expect(choisie?.className).toContain('border-brand')
		expect(choisie?.className).toContain('bg-brand-soft')
		expect(autre?.className).not.toContain('border-brand')
		expect(autre?.className).toContain('border-border')
	})
})

describe('SelecteurCouleur — choisir', () => {
	it('un clic choisit la couleur et la rend à l’hôte en jeton', async () => {
		const surChoix = vi.fn()
		render(<Hote initiale="neutral" surChoix={surChoix} />)
		await userEvent.click(screen.getByRole('radio', { name: 'Rouge' }).closest('label') as HTMLElement)
		expect(surChoix).toHaveBeenLastCalledWith('danger')
		expect(screen.getByRole('radio', { name: 'Rouge' })).toHaveProperty('checked', true)
	})

	it('au clavier : `Tab` entre sur l’option choisie, les flèches changent l’option', async () => {
		const surChoix = vi.fn()
		render(
			<>
				<button type="button">avant</button>
				<Hote initiale="success" surChoix={surChoix} />
			</>,
		)
		await userEvent.click(screen.getByRole('button', { name: 'avant' }))
		await userEvent.tab()
		expect(document.activeElement).toBe(screen.getByRole('radio', { name: 'Vert' }))
		await userEvent.keyboard('{ArrowRight}')
		expect(surChoix).toHaveBeenLastCalledWith('accent')
		expect(document.activeElement).toBe(screen.getByRole('radio', { name: 'Jaune' }))
		await userEvent.keyboard('{ArrowLeft}{ArrowLeft}')
		expect(surChoix).toHaveBeenLastCalledWith('brand')
	})
})
