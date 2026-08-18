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

// @verifies CRM-037 (docs/BACKLOG.md) — reprise d'un déplacement refusé, geste d'interface
// @verifies docs/SPEC-form-composer.md §4 ter.4 (rendu saisissable), §4 ter.5 (les deux mentions),
//           §4 ter.6 (le défilement emporte le focus), §4 ter.8 (accessibilité)
// @verifies docs/DESIGN_SYSTEM.md §5.7 quater (mise en évidence, liseré, focus)
describe('champs exigés par un déplacement refusé (§4 ter)', () => {
	function monterExige(clesExigees: readonly string[], valeurs: readonly ValeurChamp[] = []) {
		const modele = composerFormulaire({ champs: CHAMPS, regles: REGLES, valeurs, etape: ETAPE, clesExigees })
		const factice = clientFactice()
		render(<FormulaireCard modele={modele} {...CARD} client={factice.client} />)
		return factice
	}

	it("le champ `hidden` nommé par le refus devient SAISISSABLE, là où il n'était rendu nulle part", () => {
		// Sans reprise, `motif-perte` est `hidden` et vide : ni dans le formulaire, ni dans la
		// section repliée. C'est le cas mesuré sur dix des dix-neuf couples refusables du seed.
		monter()
		expect(screen.queryByTestId('champ-motif-perte')).toBeNull()
		cleanup()
		monterExige(['motif-perte'])
		const controle = screen.getByLabelText('Motif de la perte')
		expect(controle).toBeInstanceOf(HTMLTextAreaElement)
		expect((controle as HTMLTextAreaElement).disabled).toBe(false)
	})

	it('il porte sa mention, en toutes lettres et non par une seule teinte (§5.7 quater)', () => {
		monterExige(['motif-perte'])
		const mention = screen.getByTestId('exige-motif-perte')
		expect(mention.textContent).toContain('Exigé par le déplacement')
	})

	it('la mention est citée par aria-describedby du contrôle (§4 ter.8)', () => {
		monterExige(['motif-perte'])
		const controle = screen.getByLabelText('Motif de la perte')
		expect((controle.getAttribute('aria-describedby') ?? '').split(' ')).toContain(
			'champ-motif-perte-exige',
		)
	})

	it('les DEUX mentions coexistent lorsque le champ est aussi requis à l’étape (§4 ter.5)', () => {
		monterExige(['source'])
		expect(screen.getByTestId('requis-source').textContent).toContain('Prospection')
		expect(screen.getByTestId('exige-source')).not.toBeNull()
	})

	it('un champ non nommé par le refus ne porte NI mention NI mise en évidence', () => {
		monterExige(['motif-perte'])
		expect(screen.queryByTestId('exige-source')).toBeNull()
		expect(screen.getByTestId('champ-source').getAttribute('data-exige')).toBeNull()
		expect(screen.getByTestId('champ-motif-perte').getAttribute('data-exige')).toBe('true')
	})

	it('le PREMIER champ exigé prend le focus : le défilement se tient aussi au clavier (§4 ter.6)', () => {
		// `source` est en position 2, `motif-perte` en position 4 : le premier au sens du §4 ter.3.
		monterExige(['motif-perte', 'source'])
		expect(document.activeElement).toBe(screen.getByLabelText(/Origine du contact/))
	})

	it('sans `exiges`, aucun focus n’est volé et aucune mise en évidence n’apparaît', () => {
		monter()
		expect(document.activeElement).toBe(document.body)
		expect(screen.queryByTestId('exige-source')).toBeNull()
	})
})

// =============================================================================================
// Sous-tranche 4d de `CRM-060` — LES DEUX SÉLECTEURS DE RÉFÉRENCE
// @verifies CRM-060 (docs/BACKLOG.md) — contacts et organisations, sous-tranche 4d
// @verifies docs/SPEC-contacts.md §13.4 (quand les listes sont lues), §13.5 (cas a à m),
//           §13.8 (limites nommées)
// @verifies docs/DESIGN_SYSTEM.md §5.22 (sélecteur de contact et sélecteur de membre)
// =============================================================================================

const CHAMPS_REFERENCE: readonly ChampFormulaire[] = [
	{
		id: 'f-contact',
		key: 'contact-principal',
		label: 'Contact principal',
		type: 'contact',
		position: 1,
		options: {},
		help_text: null,
		archived_at: null,
	},
	{
		id: 'f-membre',
		key: 'referent-technique',
		label: 'Référent technique',
		type: 'user',
		position: 2,
		options: {},
		help_text: null,
		archived_at: null,
	},
]

type ReponseLecture = { readonly data: unknown; readonly error: { message: string } | null; readonly status: number }

const CONTACTS_LUS = [
	{ id: 'c-leo', full_name: 'Léo Marchand', email: null, phone: null, role_title: null, organization_id: 'o-1', organizations: { id: 'o-1', name: 'Sogexia', domain: null } },
	{ id: 'c-sophie', full_name: 'Sophie Dupont', email: null, phone: null, role_title: null, organization_id: null, organizations: null },
]

const MEMBRES_LUS = [
	{ user_id: 'u-driss', profiles: { id: 'u-driss', full_name: 'Driss Lemoine' } },
	{ user_id: 'u-camille', profiles: { id: 'u-camille', full_name: 'Camille Aubert' } },
]

/**
 * Client factice qui sert AUSSI les deux lectures de référence, et **compte** les tables lues.
 *
 * Le compte est ce qui prouve la condition du §13.4 : un formulaire sans champ de ces types
 * n'émet aucune de ces deux lectures. Une preuve qui n'observerait que le rendu ne dirait rien de
 * la requête épargnée.
 */
function clientReferences(reponses: Readonly<Record<string, ReponseLecture>> = {}): {
	client: ClientCrm
	lues: string[]
	ecritures: Ecriture[]
} {
	const lues: string[] = []
	const ecritures: Ecriture[] = []
	const defauts: Readonly<Record<string, ReponseLecture>> = {
		contacts: { data: CONTACTS_LUS, error: null, status: 200 },
		workspace_members: { data: MEMBRES_LUS, error: null, status: 200 },
	}
	const client = {
		from: (table: string) => {
			const reponse = reponses[table] ?? defauts[table] ?? { data: [], error: null, status: 200 }
			const chaine: Record<string, unknown> = {}
			for (const methode of ['select', 'order', 'eq']) {
				chaine[methode] = () => chaine
			}
			chaine['then'] = (resoudre: (valeur: unknown) => unknown) => {
				lues.push(table)
				return Promise.resolve(reponse).then(resoudre)
			}
			chaine['upsert'] = (charge: Record<string, unknown>, options?: Record<string, unknown>) => {
				ecritures.push({ table, charge, options })
				const apres: Record<string, unknown> = {}
				apres['select'] = () => apres
				apres['then'] = (resoudre: (valeur: unknown) => unknown) =>
					Promise.resolve({ data: [{ field_id: 'f' }], error: null, status: 200 }).then(resoudre)
				return apres
			}
			return chaine
		},
	} as unknown as ClientCrm
	return { client, lues, ecritures }
}

function monterReferences(
	valeurs: readonly ValeurChamp[] = [],
	reponses?: Readonly<Record<string, ReponseLecture>>,
	champs: readonly ChampFormulaire[] = CHAMPS_REFERENCE,
) {
	const modele = composerFormulaire({ champs, regles: [], valeurs, etape: ETAPE })
	const factice = clientReferences(reponses)
	render(<FormulaireCard modele={modele} {...CARD} client={factice.client} />)
	return factice
}

/**
 * Attend que le sélecteur ait REÇU sa liste.
 *
 * `findByTestId` ne suffit pas : l'état de chargement porte le MÊME identifiant de test — c'est le
 * même contrôle, pas un autre —, si bien qu'il résout immédiatement sur le `select` désactivé. La
 * condition d'attente est donc la disparition d'`aria-busy`, qui EST le signal du §13.5, cas g.
 */
async function attendreSelecteur(cle: string): Promise<HTMLSelectElement> {
	// La requête est REFAITE à chaque tour : l'état prêt enveloppe le contrôle, si bien que le
	// `select` est un AUTRE nœud du DOM que celui du chargement. Une référence capturée d'avance
	// resterait éternellement `aria-busy`, et la preuve mesurerait alors un nœud abandonné.
	await waitFor(() =>
		expect(screen.getByTestId(`selecteur-${cle}`).getAttribute('aria-busy')).toBeNull(),
	)
	return screen.getByTestId(`selecteur-${cle}`) as HTMLSelectElement
}

describe('sélecteurs de contact et de membre (docs/SPEC-contacts.md §13)', () => {
	it('cas a — liste chargée, valeur vide : l’option vide est retenue, aucun nom ne l’est', async () => {
		monterReferences()
		const selecteur = await attendreSelecteur('contact-principal')
		expect(selecteur.value).toBe('')
		expect(within(selecteur).getByText('Léo Marchand — Sogexia')).toBeDefined()
		// Sophie n'a aucune organisation : son libellé est son seul nom, sans tiret orphelin.
		expect(within(selecteur).getByText('Sophie Dupont')).toBeDefined()
	})

	it('cas b — une valeur qui désigne une entrée RETIENT son option, et le libellé est un nom', async () => {
		monterReferences([{ field_id: 'f-contact', value: 'c-leo' }])
		const selecteur = await attendreSelecteur('contact-principal')
		expect(selecteur.value).toBe('c-leo')
		expect(selecteur.selectedOptions[0]?.textContent).toBe('Léo Marchand — Sogexia')
	})

	it('cas c — retenir une autre entrée émet l’écriture, avec l’identifiant en valeur', async () => {
		const factice = monterReferences()
		const selecteur = await attendreSelecteur('contact-principal')
		fireEvent.change(selecteur, { target: { value: 'c-sophie' } })
		await waitFor(() => expect(factice.ecritures).toHaveLength(1))
		expect(factice.ecritures[0]?.charge).toMatchObject({ field_id: 'f-contact', value: 'c-sophie' })
	})

	it('cas d — retenir l’option vide VIDE le champ : la valeur envoyée est `null` (§4 bis.5)', async () => {
		const factice = monterReferences([{ field_id: 'f-contact', value: 'c-leo' }])
		const selecteur = await attendreSelecteur('contact-principal')
		fireEvent.change(selecteur, { target: { value: '' } })
		await waitFor(() => expect(factice.ecritures).toHaveLength(1))
		expect(factice.ecritures[0]?.charge['value']).toBeNull()
	})

	it('cas g — pendant la lecture, le contrôle est désactivé et `aria-busy`', () => {
		monterReferences()
		const selecteur = screen.getByTestId('selecteur-contact-principal') as HTMLSelectElement
		expect(selecteur.disabled).toBe(true)
		expect(selecteur.getAttribute('aria-busy')).toBe('true')
	})

	it('cas h — une lecture en échec offre une ACTION DE REPRISE, qui relit la liste (§5.8)', async () => {
		const factice = monterReferences([], {
			contacts: { data: null, error: { message: 'boum' }, status: 500 },
		})
		const alerte = await screen.findByTestId('selecteur-erreur-contact-principal')
		expect(alerte.getAttribute('role')).toBe('alert')
		const lecturesAvant = factice.lues.filter((table) => table === 'contacts').length
		fireEvent.click(within(alerte).getByRole('button', { name: 'Réessayer' }))
		await waitFor(() =>
			expect(factice.lues.filter((table) => table === 'contacts').length).toBeGreaterThan(lecturesAvant),
		)
	})

	it('cas i — une liste vide le dit en toutes lettres, et n’offre AUCUNE action', async () => {
		monterReferences([], { contacts: { data: [], error: null, status: 200 } })
		const mention = await screen.findByTestId('selecteur-vide-contact-principal')
		expect(mention.textContent).toBe("Cet espace de travail n'a aucun contact.")
		expect(within(mention).queryByRole('button')).toBeNull()
	})

	it('cas j — une référence morte GARDE son option retenue, et rien n’est écrit', async () => {
		const factice = monterReferences([{ field_id: 'f-contact', value: 'c-disparu' }])
		const selecteur = await attendreSelecteur('contact-principal')
		expect(selecteur.value).toBe('c-disparu')
		expect(selecteur.selectedOptions[0]?.textContent).toBe('Référence inconnue (c-disparu)')
		// AUCUNE écriture : l'écran constate la référence morte, il ne la répare pas (§13.8).
		expect(factice.ecritures).toHaveLength(0)
	})

	it('cas k — quitter la référence morte pour une entrée réelle écrit, et l’option disparaît', async () => {
		const factice = monterReferences([{ field_id: 'f-contact', value: 'c-disparu' }])
		const selecteur = await attendreSelecteur('contact-principal')
		fireEvent.change(selecteur, { target: { value: 'c-leo' } })
		await waitFor(() => expect(factice.ecritures).toHaveLength(1))
		await waitFor(() =>
			expect(within(selecteur).queryByText('Référence inconnue (c-disparu)')).toBeNull(),
		)
	})

	it('le sélecteur de MEMBRE lit `workspace_members` et rend les noms des profils', async () => {
		const factice = monterReferences()
		const selecteur = await attendreSelecteur('referent-technique')
		expect(factice.lues).toContain('workspace_members')
		expect(within(selecteur).getByText('Driss Lemoine')).toBeDefined()
		expect(within(selecteur).getByText('Camille Aubert')).toBeDefined()
	})

	it('§13.4 — un formulaire SANS champ de ces types n’émet AUCUNE des deux lectures', async () => {
		const factice = monterReferences([], undefined, CHAMPS)
		await waitFor(() => expect(screen.getByTestId('formulaire-card')).toBeDefined())
		expect(factice.lues).not.toContain('contacts')
		expect(factice.lues).not.toContain('workspace_members')
	})

	it('§13.4 — un formulaire qui ne porte QUE `user` ne lit pas les contacts', async () => {
		const factice = monterReferences([], undefined, [CHAMPS_REFERENCE[1] as ChampFormulaire])
		await waitFor(() => expect(factice.lues).toContain('workspace_members'))
		expect(factice.lues).not.toContain('contacts')
	})
})

describe('section repliée : les deux types résolus (§13.5, cas l et m)', () => {
	// `hidden` **et** renseigné : c'est la condition du §4.2 pour rejoindre la section repliée.
	const REGLES_REPLIEE = [
		{ field_id: 'f-contact', step_id: ETAPE.id, visibility: 'hidden' },
		{ field_id: 'f-membre', step_id: ETAPE.id, visibility: 'hidden' },
	]

	function monterRepliee(valeurs: readonly ValeurChamp[], reponses?: Readonly<Record<string, ReponseLecture>>) {
		const modele = composerFormulaire({
			champs: CHAMPS_REFERENCE,
			regles: REGLES_REPLIEE,
			valeurs,
			etape: ETAPE,
		})
		const factice = clientReferences(reponses)
		render(<FormulaireCard modele={modele} {...CARD} client={factice.client} />)
		return factice
	}

	it('cas l — une valeur résolue se lit en NOM, pas en identifiant', async () => {
		monterRepliee([{ field_id: 'f-contact', value: 'c-leo' }])
		await waitFor(() =>
			expect(screen.getByTestId('autre-contact-principal').textContent).toContain('Léo Marchand — Sogexia'),
		)
	})

	it('cas m — une valeur non résolue se lit en IDENTIFIANT BRUT, en donnée technique', async () => {
		monterRepliee([{ field_id: 'f-contact', value: 'c-disparu' }])
		const bloc = await screen.findByTestId('autre-contact-principal')
		await waitFor(() => expect(bloc.querySelector('code')?.textContent).toBe('c-disparu'))
	})

	it('cas m — liste illisible : l’identifiant brut, jamais un nom inventé', async () => {
		monterRepliee([{ field_id: 'f-contact', value: 'c-leo' }], {
			contacts: { data: null, error: { message: 'boum' }, status: 500 },
		})
		const bloc = await screen.findByTestId('autre-contact-principal')
		await waitFor(() => expect(bloc.querySelector('code')?.textContent).toBe('c-leo'))
		expect(bloc.textContent).not.toContain('Léo Marchand')
	})
})
