// @verifies CRM-098 (docs/BACKLOG.md) — tranche T3 : le mois du rapport mensuel et de la série « Personnel » du track
// @verifies docs/INCONSISTENCY_REPORT.md INC-333, décision 801 (docs/JOURNAL.md) — le mois se choisit par « Mois
//           précédent » / « Mois suivant » / « Ce mois-ci », sans champ de saisie ; docs/SPEC-temps.md §7.3
//           (`?mois=AAAA-MM`, le mois du jour jamais écrit), §7.5 ; docs/DESIGN_SYSTEM.md §5.54 (navigation de mois),
//           §5.13 (le focus ne reste pas sur la commande qui disparaît)

import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router'
import { afterEach, describe, expect, it } from 'vitest'
import { NavigationMois, decalerMois, lireMois, titreMois, useMoisDeLAdresse } from './NavigationMois'

afterEach(cleanup)

describe('le mois', () => {
	it('le mois de l’adresse, ou celui du jour', () => {
		expect(lireMois('2027-03', '2026-10-11')).toBe('2027-03')
		expect(lireMois('2027-13', '2026-10-11')).toBe('2026-10')
		expect(lireMois('2', '2026-10-11')).toBe('2026-10')
		expect(lireMois(null, '2026-10-11')).toBe('2026-10')
	})
	it('le mois voisin passe les années, dans les deux sens', () => {
		expect(decalerMois('2026-11', 1)).toBe('2026-12')
		expect(decalerMois('2026-12', 1)).toBe('2027-01')
		expect(decalerMois('2027-01', -1)).toBe('2026-12')
		expect(decalerMois('2099-03', -1)).toBe('2099-02')
		expect(decalerMois('2026-11', -23)).toBe('2024-12')
		expect(decalerMois('2026-11', 14)).toBe('2028-01')
	})
	it('le libellé porte sa majuscule, le mois et l’année', () => {
		expect(titreMois('2027-03')).toBe('Mars 2027')
		expect(titreMois('2026-08')).toBe('Août 2026')
	})
})

function Banc({ aujourdhui, titre }: { readonly aujourdhui: string; readonly titre: boolean }) {
	const { mois, moisCourant, allerA } = useMoisDeLAdresse(aujourdhui)
	return (
		<>
			<NavigationMois mois={mois} moisCourant={moisCourant} allerA={allerA} titre={titre} testId="mois" />
			<span data-testid="adresse">{useLocation().search}</span>
		</>
	)
}

const monter = (adresse: string, titre = true) =>
	render(
		<MemoryRouter initialEntries={[adresse]}>
			<Banc aujourdhui="2026-10-11" titre={titre} />
		</MemoryRouter>,
	)

describe('la navigation de mois', () => {
	it('aucun champ à saisir : deux boutons, le mois en titre, et pas de retour sur le mois du jour', () => {
		monter('/temps?onglet=rapport')
		expect(screen.queryByRole('textbox')).toBeNull()
		expect(document.querySelector('input')).toBeNull()
		expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Octobre 2026')
		expect(screen.getByRole('button', { name: 'Mois précédent' })).toBeTruthy()
		expect(screen.getByRole('button', { name: 'Mois suivant' })).toBeTruthy()
		expect(screen.queryByRole('button', { name: 'Ce mois-ci' })).toBeNull()
	})

	it('« Mois précédent » et « Mois suivant » écrivent le mois dans l’adresse, sans toucher aux autres paramètres', async () => {
		monter('/temps?onglet=rapport&mois=2027-01')
		await userEvent.click(screen.getByRole('button', { name: 'Mois précédent' }))
		expect(screen.getByTestId('mois').textContent).toBe('Décembre 2026')
		expect(screen.getByTestId('adresse').textContent).toBe('?onglet=rapport&mois=2026-12')
		await userEvent.click(screen.getByRole('button', { name: 'Mois suivant' }))
		await userEvent.click(screen.getByRole('button', { name: 'Mois suivant' }))
		expect(screen.getByTestId('mois').textContent).toBe('Février 2027')
		expect(screen.getByTestId('adresse').textContent).toBe('?onglet=rapport&mois=2027-02')
	})

	it('le mois du jour n’est jamais écrit dans l’adresse', async () => {
		monter('/temps?onglet=rapport&mois=2026-09')
		await userEvent.click(screen.getByRole('button', { name: 'Mois suivant' }))
		expect(screen.getByTestId('mois').textContent).toBe('Octobre 2026')
		expect(screen.getByTestId('adresse').textContent).toBe('?onglet=rapport')
	})

	it('« Ce mois-ci » ramène au mois du jour, disparaît, et rend le focus au libellé du mois', async () => {
		monter('/temps?onglet=rapport&mois=2099-03')
		const retour = screen.getByRole('button', { name: 'Ce mois-ci' })
		await userEvent.click(retour)
		expect(screen.getByTestId('adresse').textContent).toBe('?onglet=rapport')
		expect(screen.queryByRole('button', { name: 'Ce mois-ci' })).toBeNull()
		expect(document.activeElement).toBe(screen.getByTestId('mois'))
		expect(screen.getByTestId('mois').textContent).toBe('Octobre 2026')
	})

	it('sous un titre existant (le bloc du track), le mois est un texte, pas un second titre', () => {
		monter('/tracks/studio-web/couts?mois=2099-03', false)
		expect(screen.queryByRole('heading')).toBeNull()
		expect(screen.getByTestId('mois').tagName).toBe('P')
		expect(screen.getByTestId('mois').textContent).toBe('Mars 2099')
	})
})
