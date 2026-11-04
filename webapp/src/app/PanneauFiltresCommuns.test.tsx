// @verifies CRM-112 (docs/BACKLOG.md) — tranche T4.b : le bouton « Champs de l'affaire » et son panneau — absent sans champ
//           filtrable, le nombre de filtres actifs, un fieldset par champ, « Appliquer » qui ramène à la page 1, la borne
//           illisible refusée sous son champ, `Échap` qui rend le focus, « Effacer les filtres » qui les retire
// @verifies docs/DESIGN_SYSTEM.md §5.92 ; docs/SPEC-champs-communs.md §8 (précision T4.b)

import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ListeCards } from './ListeCards'
import type { ChampCommun } from '../lib/champs-communs'
import { PARAMETRES_PAR_DEFAUT, type ParametresListe } from '../lib/liste-cards'

afterEach(cleanup)

const champ = (partiel: Partial<ChampCommun>): ChampCommun => ({
	id: `id-${partiel.key ?? 'k'}`,
	key: 'k',
	label: 'Champ',
	type: 'text',
	options: {},
	help_text: null,
	position: 1,
	archived_at: null,
	is_listed: false,
	...partiel,
})

const CHAMPS = [
	champ({ key: 'siret', label: 'SIRET', type: 'text', position: 1 }),
	champ({ key: 'secteur', label: 'Secteur', type: 'select', position: 2, options: { choices: [{ key: 'btp', label: 'BTP' }, { key: 'sante', label: 'Santé' }] } }),
	champ({ key: 'ca', label: 'Chiffre d’affaires', type: 'money', position: 3, options: { currency: 'EUR' } }),
	champ({ key: 'signe', label: 'Contrat signé', type: 'checkbox', position: 4 }),
]

function rendre(params: Partial<ParametresListe> = {}, champsFiltrables: readonly ChampCommun[] = CHAMPS) {
	const onParametres = vi.fn()
	render(
		<MemoryRouter>
			<ListeCards
				cards={[]}
				etapes={[]}
				champsFiltrables={champsFiltrables}
				parametres={{ ...PARAMETRES_PAR_DEFAUT, ...params }}
				total={0}
				slugTrack="conseil-ia"
				slugChannel="grands-comptes"
				onParametres={onParametres}
			/>
		</MemoryRouter>,
	)
	return { onParametres }
}

describe('le bouton « Champs de l’affaire » (§5.92)', () => {
	it('absent sans champ filtrable ni filtre dans l’adresse', () => {
		rendre({}, [])
		expect(screen.queryByTestId('ouvrir-filtres-communs')).toBeNull()
	})

	it('présent pour retirer un filtre posé par l’adresse, même sans champ', () => {
		rendre({ communs: { ancien: 'x' } }, [])
		expect(screen.getByTestId('ouvrir-filtres-communs').textContent).toContain('Champs de l’affaire (1)')
	})

	it('dit le nombre de filtres actifs, et déplie le panneau sous la barre', async () => {
		const utilisateur = userEvent.setup()
		rendre({ communs: { siret: '123', signe: 'oui' } })
		const bouton = screen.getByTestId('ouvrir-filtres-communs')
		expect(bouton.textContent).toContain('Champs de l’affaire (2)')
		expect(bouton.getAttribute('aria-expanded')).toBe('false')
		await utilisateur.click(bouton)
		expect(bouton.getAttribute('aria-expanded')).toBe('true')
		const panneau = screen.getByTestId('panneau-filtres-communs')
		expect(bouton.getAttribute('aria-controls')).toBe(panneau.id)
		expect(within(panneau).getAllByTestId('filtre-commun').map((f) => f.getAttribute('data-champ'))).toEqual(['siret', 'secteur', 'ca', 'signe'])
		// Les filtres de l'adresse sont repris dans le panneau.
		expect((within(panneau).getByLabelText('Contient') as HTMLInputElement).value).toBe('123')
	})
})

describe('le panneau (§5.92)', () => {
	it('« Appliquer » compose les paramètres bruts et ramène à la page 1', async () => {
		const utilisateur = userEvent.setup()
		const { onParametres } = rendre({ page: 3 })
		await utilisateur.click(screen.getByTestId('ouvrir-filtres-communs'))
		const panneau = screen.getByTestId('panneau-filtres-communs')
		await utilisateur.type(within(panneau).getByLabelText('Contient'), 'Élan')
		await utilisateur.click(within(panneau).getByLabelText('Santé'))
		await utilisateur.type(within(panneau).getByLabelText('De'), '1 000,5')
		await utilisateur.selectOptions(within(panneau).getByLabelText('Contrat signé'), 'vide')
		await utilisateur.click(within(panneau).getByTestId('appliquer-filtres-communs'))
		expect(onParametres).toHaveBeenCalledWith(
			expect.objectContaining({ page: 1, communs: { siret: 'Élan', secteur: 'sante', ca: '1000.5..', signe: 'vide' } }),
		)
		// Le panneau reste ouvert, pour corriger.
		expect(screen.getByTestId('panneau-filtres-communs')).not.toBeNull()
	})

	it('une borne illisible est refusée sous son champ, et rien n’est appliqué', async () => {
		const utilisateur = userEvent.setup()
		const { onParametres } = rendre()
		await utilisateur.click(screen.getByTestId('ouvrir-filtres-communs'))
		const panneau = screen.getByTestId('panneau-filtres-communs')
		await utilisateur.type(within(panneau).getByLabelText('À'), 'douze')
		await utilisateur.click(within(panneau).getByTestId('appliquer-filtres-communs'))
		expect(onParametres).not.toHaveBeenCalled()
		expect(within(panneau).getByText('Saisissez un nombre.')).not.toBeNull()
		expect(within(panneau).getByLabelText('À').getAttribute('aria-invalid')).toBe('true')
	})

	it('`Échap` et « Fermer » replient le panneau et rendent le focus au bouton', async () => {
		const utilisateur = userEvent.setup()
		rendre()
		const bouton = screen.getByTestId('ouvrir-filtres-communs')
		await utilisateur.click(bouton)
		await utilisateur.click(within(screen.getByTestId('panneau-filtres-communs')).getByLabelText('Contient'))
		await utilisateur.keyboard('{Escape}')
		expect(screen.queryByTestId('panneau-filtres-communs')).toBeNull()
		expect(document.activeElement).toBe(bouton)
		await utilisateur.click(bouton)
		await utilisateur.click(screen.getByTestId('fermer-filtres-communs'))
		expect(screen.queryByTestId('panneau-filtres-communs')).toBeNull()
		expect(document.activeElement).toBe(bouton)
	})

	// RÉVISÉ PAR T4.d.2 (décision 51) : les vues et l'export retiennent désormais ces filtres ; la phrase qui disait le
	// contraire est retirée, et sa présence serait un mensonge.
	it('ne dit plus que l’export et les vues ignorent ces filtres (T4.d.2)', async () => {
		const utilisateur = userEvent.setup()
		rendre()
		await utilisateur.click(screen.getByTestId('ouvrir-filtres-communs'))
		expect(screen.queryByText(/ne retiennent pas encore ces filtres/)).toBeNull()
	})
})

describe('« Effacer les filtres » (docs/SPEC-cards.md §16.12.5)', () => {
	it('retire les filtres de champ avec les autres', async () => {
		const utilisateur = userEvent.setup()
		const onParametres = vi.fn()
		render(
			<MemoryRouter>
				<ListeCards
					cards={[]}
					etapes={[]}
					champsFiltrables={CHAMPS}
					parametres={{ ...PARAMETRES_PAR_DEFAUT, communs: { siret: '1' } }}
					total={3}
					slugTrack="conseil-ia"
					slugChannel="grands-comptes"
					onParametres={onParametres}
				/>
			</MemoryRouter>,
		)
		await utilisateur.click(screen.getByTestId('effacer-filtres'))
		expect(onParametres).toHaveBeenCalledWith(expect.objectContaining({ communs: {}, page: 1 }))
	})
})
