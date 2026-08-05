// @verifies CRM-037 (docs/BACKLOG.md) — rendu réel du formulaire conditionnel
// @verifies docs/SPEC-form-composer.md §4.2 (section repliée), §4.4 (astérisque et mention),
//           §4.5 (erreurs, accessibilité), §4.7 (aucune écriture)
// @verifies docs/DESIGN_SYSTEM.md §5.7 (champs de formulaire), §8 (accessibilité, états
//           désactivés lisibles), §10 (aucun texte en dur)
//
// Ces tests montent le **vrai** composant et l'interrogent par ses rôles accessibles. Ils
// existent parce que le rendu chargé du formulaire ne peut être vu nulle part ailleurs : la
// webapp est un appelant anonyme faute d'écran de connexion (INC-021), et son E2E n'obtient donc
// jamais de ligne — le procédé est celui endossé par docs/DESIGN_SYSTEM.md §12.5.
//
// Ce qu'ils ne prouvent PAS, et qui reste dû : qu'un utilisateur connecté saisisse une valeur et
// franchisse une transition. C'est INC-062, et c'est nommé dans docs/BACKLOG.md.

import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { FormulaireCard } from './FormulaireCard'
import { composerFormulaire, type ChampFormulaire, type ValeurChamp } from '../lib/formulaire'

const ETAPE = { id: 'etape-prospection', label: 'Prospection' }

const CHAMPS: readonly ChampFormulaire[] = [
	{
		id: 'f-budget',
		key: 'budget',
		label: 'Budget estimé',
		type: 'money',
		position: 1,
		options: { currency: 'EUR' },
		help_text: 'Montant hors taxes.',
		archived_at: null,
	},
	{
		id: 'f-source',
		key: 'source',
		label: 'Origine du contact',
		type: 'select',
		position: 2,
		options: {
			choices: [
				{ key: 'salon', label: 'Salon' },
				{ key: 'site', label: 'Site web' },
				// Entrée mal formée : la base ne contraint pas la forme des choix (§2.4), et le
				// rendu doit l'écarter plutôt que l'afficher en « [object Object] ».
				{ key: 42 },
			],
		},
		help_text: null,
		archived_at: null,
	},
	{
		id: 'f-motif',
		key: 'motif-perte',
		label: 'Motif de la perte',
		type: 'textarea',
		position: 3,
		options: {},
		help_text: null,
		archived_at: null,
	},
	{
		id: 'f-decideur',
		key: 'decideur-identifie',
		label: 'Décideur identifié',
		type: 'checkbox',
		position: 4,
		options: {},
		help_text: null,
		archived_at: null,
	},
]

const REGLES = [
	{ field_id: 'f-source', step_id: ETAPE.id, visibility: 'required' },
	{ field_id: 'f-motif', step_id: ETAPE.id, visibility: 'hidden' },
]

function monter(valeurs: readonly ValeurChamp[] = []) {
	const modele = composerFormulaire({ champs: CHAMPS, regles: REGLES, valeurs, etape: ETAPE })
	return render(<FormulaireCard modele={modele} />)
}

afterEach(cleanup)

describe('formulaire de l’étape', () => {
	it('nomme l’étape courante', () => {
		monter()
		expect(screen.getByTestId('formulaire-card').textContent).toContain('Prospection')
	})

	it('rend un contrôle étiqueté par champ affiché, et aucun pour un champ masqué', () => {
		monter()
		expect(screen.getByLabelText(/Budget estimé/)).toBeDefined()
		expect(screen.getByLabelText(/Origine du contact/)).toBeDefined()
		expect(screen.getByLabelText(/Décideur identifié/)).toBeDefined()
		expect(screen.queryByLabelText(/Motif de la perte/)).toBeNull()
	})

	it('le libellé résout vers son contrôle par « for » (docs/DESIGN_SYSTEM.md §5.7)', () => {
		monter()
		const controle = screen.getByLabelText(/Budget estimé/)
		expect(controle.id).toBe('champ-budget')
	})

	it('l’aide est associée au contrôle par aria-describedby', () => {
		monter()
		const controle = screen.getByLabelText(/Budget estimé/)
		const decrit = controle.getAttribute('aria-describedby') ?? ''
		expect(decrit.split(' ')).toContain('champ-budget-aide')
		expect(document.getElementById('champ-budget-aide')?.textContent).toBe('Montant hors taxes.')
	})

	it('un champ sans aide ne prétend pas en avoir une', () => {
		monter([{ field_id: 'f-decideur', value: true }])
		const controle = screen.getByLabelText(/Décideur identifié/)
		expect(controle.getAttribute('aria-describedby')).toBeNull()
	})
})

describe('champ exigé (§4.4)', () => {
	it('porte un astérisque décoratif doublé d’un texte lisible par lecteur d’écran', () => {
		monter()
		const etiquette = screen.getByText('Origine du contact').closest('label')
		expect(etiquette?.textContent).toContain('*')
		expect(etiquette?.textContent).toContain('(champ requis)')
		// L'astérisque est masqué aux technologies d'assistance : sans cela, il serait annoncé
		// comme un caractère, en plus de la mention explicite.
		expect(within(etiquette as HTMLElement).getByText('*', { exact: false }).getAttribute('aria-hidden')).toBe('true')
	})

	it('affiche la mention « requis pour passer à <étape> », l’étape nommée', () => {
		monter()
		const mention = screen.getByTestId('requis-source')
		expect(mention.textContent).toContain('Requis pour passer à')
		expect(mention.textContent).toContain('Prospection')
	})

	it('vide, il porte une alerte role="alert" citée par aria-describedby et aria-invalid', () => {
		monter()
		const alerte = screen.getByTestId('alerte-source')
		expect(alerte.getAttribute('role')).toBe('alert')
		const controle = screen.getByLabelText(/Origine du contact/)
		expect(controle.getAttribute('aria-invalid')).toBe('true')
		expect((controle.getAttribute('aria-describedby') ?? '').split(' ')).toContain('champ-source-alerte')
	})

	it('renseigné, l’alerte disparaît et le champ n’est plus invalide', () => {
		monter([{ field_id: 'f-source', value: 'salon' }])
		expect(screen.queryByTestId('alerte-source')).toBeNull()
		expect(screen.getByLabelText(/Origine du contact/).getAttribute('aria-invalid')).toBe('false')
	})

	it('un champ non exigé n’affiche ni astérisque ni mention', () => {
		monter()
		expect(screen.queryByTestId('requis-budget')).toBeNull()
		expect(screen.queryByTestId('alerte-budget')).toBeNull()
	})
})

describe('section repliée « Informations d’autres étapes » (§4.2)', () => {
	it('n’existe pas lorsqu’aucune valeur d’une autre étape n’est portée', () => {
		monter()
		expect(screen.queryByTestId('autres-etapes')).toBeNull()
	})

	it('apparaît, repliée, dès qu’un champ masqué porte une valeur', () => {
		monter([{ field_id: 'f-motif', value: 'Budget gelé.' }])
		const section = screen.getByTestId('autres-etapes') as HTMLDetailsElement
		expect(section.open).toBe(false)
		expect(section.textContent).toContain("Informations d'autres étapes")
	})

	it('rend la valeur en lecture seule, sans contrôle de saisie', () => {
		monter([{ field_id: 'f-motif', value: 'Budget gelé.' }])
		const ligne = screen.getByTestId('autre-motif-perte')
		expect(ligne.textContent).toContain('Motif de la perte')
		expect(ligne.textContent).toContain('Budget gelé.')
		expect(ligne.querySelector('input, textarea, select')).toBeNull()
	})
})

describe('aucune écriture, et l’écran dit pourquoi (§4.7, docs/DESIGN_SYSTEM.md §8)', () => {
	it('tous les contrôles sont indisponibles', () => {
		monter([{ field_id: 'f-source', value: 'salon' }])
		for (const controle of Array.from(document.querySelectorAll('input, textarea, select'))) {
			expect((controle as HTMLInputElement).disabled).toBe(true)
		}
	})

	it('un texte explique l’indisponibilité plutôt que de la laisser deviner', () => {
		monter()
		expect(screen.getByTestId('formulaire-lecture-seule').textContent).toContain('session')
	})
})

describe('rendu par type (§2.3)', () => {
	it('un select rend ses choix bien formés, et écarte les autres', () => {
		monter()
		const options = Array.from(screen.getByLabelText(/Origine du contact/).querySelectorAll('option'))
		const libelles = options.map((option) => option.textContent)
		expect(libelles).toContain('Salon')
		expect(libelles).toContain('Site web')
		expect(libelles).not.toContain('[object Object]')
		expect(options).toHaveLength(3)
	})

	it('une case à cocher reflète sa valeur booléenne', () => {
		monter([{ field_id: 'f-decideur', value: true }])
		expect((screen.getByLabelText(/Décideur identifié/) as HTMLInputElement).checked).toBe(true)
	})

	it('un montant est rendu par un contrôle numérique', () => {
		monter([{ field_id: 'f-budget', value: 45000 }])
		const controle = screen.getByLabelText(/Budget estimé/) as HTMLInputElement
		expect(controle.getAttribute('type')).toBe('number')
		expect(controle.value).toBe('45000')
	})

	it('la case à cocher occupe une ligne de hauteur de cible (docs/DESIGN_SYSTEM.md §8, §5.7 bis)', () => {
		monter()
		const controle = screen.getByLabelText(/Décideur identifié/)
		const ligne = controle.parentElement
		expect(ligne?.className).toContain('min-h-[var(--size-target)]')
	})

	it('un montant en lecture seule est rendu en donnée technique (docs/DESIGN_SYSTEM.md §2)', () => {
		const modele = composerFormulaire({
			champs: [
				{
					id: 'f-previsionnel',
					key: 'budget-previsionnel',
					label: 'Budget prévisionnel',
					type: 'number',
					position: 9,
					options: {},
					help_text: null,
					archived_at: '2026-08-03T00:00:00Z',
				},
			],
			regles: [],
			valeurs: [{ field_id: 'f-previsionnel', value: 72000 }],
			etape: ETAPE,
		})
		render(<FormulaireCard modele={modele} />)
		const ligne = screen.getByTestId('autre-budget-previsionnel')
		expect(ligne.querySelector('code')?.textContent).toBe('72000')
	})

	it('un texte en lecture seule n’est pas rendu en donnée technique', () => {
		monter([{ field_id: 'f-motif', value: 'Budget gelé.' }])
		expect(screen.getByTestId('autre-motif-perte').querySelector('code')).toBeNull()
	})

	it('une chaîne est rendue telle quelle, sans guillemets de sérialisation', () => {
		monter([{ field_id: 'f-motif', value: 'Budget gelé.' }])
		expect(screen.getByTestId('autre-motif-perte').textContent).not.toContain('"Budget gelé."')
	})
})

describe('état vide', () => {
	it('une étape sans champ affichable le dit, plutôt que de rendre un bloc muet', () => {
		const modele = composerFormulaire({
			champs: CHAMPS,
			regles: CHAMPS.map((champ) => ({ field_id: champ.id, step_id: ETAPE.id, visibility: 'hidden' })),
			valeurs: [],
			etape: ETAPE,
		})
		render(<FormulaireCard modele={modele} />)
		expect(screen.getByTestId('formulaire-vide')).toBeDefined()
	})
})
