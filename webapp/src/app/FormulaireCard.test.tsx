// @verifies CRM-037 (docs/BACKLOG.md) — rendu réel du formulaire conditionnel, et sa saisie
// @verifies docs/SPEC-form-composer.md §4.2 (section repliée), §4.4 (astérisque et mention),
//           §4.5 (erreurs, accessibilité), §4 bis.1 (la section repliée reste en lecture seule),
//           §4 bis.3 (le moment de l'écriture), §4 bis.4 (normalisation par type),
//           §4 bis.5 (vider), §4 bis.6 (les quatre états), §4 bis.7 (dictionnaire fermé),
//           §4 bis.8 (mise à jour en place), §4 bis.9 (accessibilité)
// @verifies docs/DESIGN_SYSTEM.md §5.7 (champs de formulaire), §5.7 ter (champ qui s'enregistre
//           pour lui-même), §8 (accessibilité), §10 (aucun texte en dur)
//
// Ces tests montent le **vrai** composant et isolent son rendu par ses rôles accessibles.
//
// UN GARDE-FOU FIGÉ A ÉTÉ RÉVISÉ ICI, ET LE MOTIF EST ÉCRIT DANS LE FICHIER — mécanisme de la
// décision 51. Le bloc « aucune écriture, et l'écran dit pourquoi » exigeait que **tous** les
// contrôles soient indisponibles et qu'un bandeau explique pourquoi. Il avait raison quand il a été
// écrit : aucune écriture n'était livrée, et son motif était INC-021. Cette incohérence est close
// depuis `CRM-009`, la décision 334 (INC-088) a levé la limite, et le §4 bis spécifie désormais la
// saisie. Le bloc n'est pas supprimé : il est **retourné** en preuves de la saisie, sur les mêmes
// contrôles.
//
// Ce qu'ils ne prouvent PAS, et qui reste dû : qu'un utilisateur franchisse une transition. Le
// contrôle de transition est `CRM-041` (INC-062), et c'est nommé dans docs/BACKLOG.md.

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { FormulaireCard } from './FormulaireCard'
import { composerFormulaire, type ChampFormulaire, type ValeurChamp } from '../lib/formulaire'
import type { ClientCrm } from '../lib/supabase'

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

const CARD = {
	idCard: 'card-c6',
	idWorkflow: 'wf-1',
	idWorkspace: 'ws-1',
} as const

type Ecriture = {
	readonly table: string
	readonly charge: Record<string, unknown>
	readonly options: Record<string, unknown> | undefined
}

type ReponseEcriture = {
	readonly data: unknown[] | null
	readonly error: { readonly message: string } | null
	readonly status: number
}

/**
 * Client factice : il **enregistre** les écritures reçues et rend la réponse voulue.
 *
 * Il n'imite pas PostgREST : il rapporte ce que le composant a émis, ce qui est exactement ce
 * qu'une preuve unitaire peut établir. Que le serveur accepte réellement cette charge est prouvé
 * ailleurs, par `e2e/api/saisie-formulaire.spec.ts` contre la vraie route.
 */
function clientFactice(reponse: ReponseEcriture = { data: [{ field_id: 'f' }], error: null, status: 200 }): {
	client: ClientCrm
	ecritures: Ecriture[]
} {
	const ecritures: Ecriture[] = []
	const client = {
		from: (table: string) => ({
			upsert: (charge: Record<string, unknown>, options?: Record<string, unknown>) => {
				ecritures.push({ table, charge, options })
				const chaine: Record<string, unknown> = {}
				chaine['select'] = () => chaine
				chaine['then'] = (resoudre: (valeur: unknown) => unknown) =>
					Promise.resolve(reponse).then(resoudre)
				return chaine
			},
		}),
	} as unknown as ClientCrm
	return { client, ecritures }
}

function monter(valeurs: readonly ValeurChamp[] = [], reponse?: ReponseEcriture) {
	const modele = composerFormulaire({ champs: CHAMPS, regles: REGLES, valeurs, etape: ETAPE })
	const factice = clientFactice(reponse)
	render(<FormulaireCard modele={modele} {...CARD} client={factice.client} />)
	return factice
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

describe('la saisie (§4 bis) — garde-fou du §4.7 retourné, motif en tête de fichier', () => {
	it('les contrôles du formulaire de l’étape sont saisissables', () => {
		monter([{ field_id: 'f-source', value: 'salon' }])
		for (const controle of Array.from(document.querySelectorAll('input, textarea, select'))) {
			expect((controle as HTMLInputElement).disabled).toBe(false)
		}
	})

	it('plus aucun bandeau « consultation seule » : la limite est levée', () => {
		monter()
		expect(screen.queryByTestId('formulaire-lecture-seule')).toBeNull()
	})

	it('une saisie de texte écrit à la PERTE DU FOCUS, et porte les quatre colonnes (§4 bis.3, §4 bis.4)', async () => {
		const factice = monter()
		const controle = screen.getByLabelText(/Budget estimé/)
		fireEvent.change(controle, { target: { value: '45000' } })
		expect(factice.ecritures).toHaveLength(0)
		fireEvent.blur(controle)
		await waitFor(() => expect(factice.ecritures).toHaveLength(1))
		const ecriture = factice.ecritures[0]
		expect(ecriture?.table).toBe('card_field_values')
		expect(ecriture?.charge).toEqual({
			card_id: 'card-c6',
			field_id: 'f-budget',
			workflow_id: 'wf-1',
			workspace_id: 'ws-1',
			value: 45000,
		})
		// `updated_by` n'est PAS écrit (§4 bis.4) : la trace faisant foi vient du serveur.
		expect(Object.keys(ecriture?.charge ?? {})).not.toContain('updated_by')
		// L'unicité portée par la clé primaire du §6.2, écrite plutôt que déduite.
		expect(ecriture?.options).toEqual({ onConflict: 'card_id,field_id' })
	})

	it('une case à cocher écrit au CHANGEMENT, et un booléen (§4 bis.3, §4 bis.4)', async () => {
		const factice = monter()
		fireEvent.click(screen.getByLabelText(/Décideur identifié/))
		await waitFor(() => expect(factice.ecritures).toHaveLength(1))
		expect(factice.ecritures[0]?.charge['value']).toBe(true)
	})

	it('une liste écrit au CHANGEMENT la clé retenue', async () => {
		const factice = monter()
		fireEvent.change(screen.getByLabelText(/Origine du contact/), { target: { value: 'salon' } })
		await waitFor(() => expect(factice.ecritures).toHaveLength(1))
		expect(factice.ecritures[0]?.charge['value']).toBe('salon')
	})

	it('vider un champ écrit null, et ne supprime rien (§4 bis.5)', async () => {
		const factice = monter([{ field_id: 'f-source', value: 'salon' }])
		fireEvent.change(screen.getByLabelText(/Origine du contact/), { target: { value: '' } })
		await waitFor(() => expect(factice.ecritures).toHaveLength(1))
		expect(factice.ecritures[0]?.charge['value']).toBeNull()
	})

	it('une valeur inchangée n’émet AUCUNE écriture (§4 bis.3)', async () => {
		const factice = monter([{ field_id: 'f-budget', value: 45000 }])
		fireEvent.blur(screen.getByLabelText(/Budget estimé/))
		await new Promise((resoudre) => setTimeout(resoudre, 0))
		expect(factice.ecritures).toHaveLength(0)
	})

	it('un champ vide SANS ligne ne fait pas naître une ligne au simple passage du focus (§4 bis.3)', async () => {
		const factice = monter()
		fireEvent.blur(screen.getByLabelText(/Budget estimé/))
		await new Promise((resoudre) => setTimeout(resoudre, 0))
		expect(factice.ecritures).toHaveLength(0)
	})

	it('l’envoi puis la confirmation sont annoncés par role="status" et cités par aria-describedby (§4 bis.9)', async () => {
		const factice = monter()
		const controle = screen.getByLabelText(/Budget estimé/)
		fireEvent.change(controle, { target: { value: '45000' } })
		fireEvent.blur(controle)
		await waitFor(() => expect(screen.getByTestId('etat-budget').textContent).toContain('Enregistré'))
		const etat = screen.getByTestId('etat-budget')
		expect(etat.getAttribute('role')).toBe('status')
		expect((controle.getAttribute('aria-describedby') ?? '').split(' ')).toContain('champ-budget-etat')
		expect(factice.ecritures).toHaveLength(1)
	})

	it('un champ exigé renseigné perd son alerte SANS rechargement (§4 bis.8)', async () => {
		monter()
		expect(screen.getByTestId('alerte-source')).toBeDefined()
		fireEvent.change(screen.getByLabelText(/Origine du contact/), { target: { value: 'salon' } })
		await waitFor(() => expect(screen.queryByTestId('alerte-source')).toBeNull())
		expect(screen.getByLabelText(/Origine du contact/).getAttribute('aria-invalid')).toBe('false')
	})
})

describe('les refus de saisie, dictionnaire fermé (§4 bis.6, §4 bis.7)', () => {
	const refuser = (status: number, message: string): ReponseEcriture => ({
		data: null,
		error: { message },
		status,
	})

	it('un 400 invalid_field_value dit que la valeur ne convient pas, et jamais le texte du serveur', async () => {
		monter([], refuser(400, 'invalid_field_value'))
		const controle = screen.getByLabelText(/Budget estimé/)
		fireEvent.change(controle, { target: { value: '45000' } })
		fireEvent.blur(controle)
		const refus = await screen.findByTestId('refus-budget')
		expect(refus.getAttribute('role')).toBe('alert')
		expect(refus.textContent).toContain('ne convient pas')
		expect(refus.textContent).not.toContain('invalid_field_value')
	})

	it('un 403 nomme le droit d’écriture manquant', async () => {
		monter([], refuser(403, 'new row violates row-level security policy'))
		const controle = screen.getByLabelText(/Budget estimé/)
		fireEvent.change(controle, { target: { value: '45000' } })
		fireEvent.blur(controle)
		const refus = await screen.findByTestId('refus-budget')
		expect(refus.textContent).toContain("droit d'écrire")
		expect(refus.textContent).not.toContain('row-level security')
	})

	it('un refus laisse la saisie à l’écran et rend le champ aria-invalid (§4 bis.6)', async () => {
		monter([], refuser(400, 'invalid_field_value'))
		const controle = screen.getByLabelText(/Budget estimé/) as HTMLInputElement
		fireEvent.change(controle, { target: { value: '45000' } })
		fireEvent.blur(controle)
		await screen.findByTestId('refus-budget')
		expect(controle.value).toBe('45000')
		expect(controle.getAttribute('aria-invalid')).toBe('true')
		// Le refus est cité par `aria-describedby`, comme l'alerte d'exigence (§4 bis.9).
		expect((controle.getAttribute('aria-describedby') ?? '').split(' ')).toContain('champ-budget-refus')
	})

	it('un champ à la fois manquant et refusé porte les DEUX alertes (§4 bis.9)', async () => {
		monter([], refuser(400, 'invalid_field_value'))
		const controle = screen.getByLabelText(/Origine du contact/)
		fireEvent.change(controle, { target: { value: 'salon' } })
		await screen.findByTestId('refus-source')
		expect(screen.getByTestId('alerte-source')).toBeDefined()
		const decrit = (controle.getAttribute('aria-describedby') ?? '').split(' ')
		expect(decrit).toContain('champ-source-alerte')
		expect(decrit).toContain('champ-source-refus')
	})

	it('un refus ne modifie PAS la valeur connue de la base', async () => {
		monter([{ field_id: 'f-source', value: 'salon' }], refuser(400, 'invalid_field_value'))
		fireEvent.change(screen.getByLabelText(/Origine du contact/), { target: { value: 'site' } })
		await screen.findByTestId('refus-source')
		// La valeur connue reste `salon` : l'alerte d'exigence est toujours absente, et elle le
		// serait tout autant si l'écran avait cru l'écriture — c'est le contrôle suivant qui tranche.
		expect(screen.queryByTestId('etat-source')).toBeNull()
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
		render(<FormulaireCard modele={modele} {...CARD} client={clientFactice().client} />)
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
		render(<FormulaireCard modele={modele} {...CARD} client={clientFactice().client} />)
		expect(screen.getByTestId('formulaire-vide')).toBeDefined()
	})
})
