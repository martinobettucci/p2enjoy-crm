// @verifies CRM-076 (docs/BACKLOG.md) — éditeur administrateur de workflows, première tranche
// @verifies docs/SPEC-workflow-engine.md §7 bis.3 (les lectures et le catalogue à la demande),
//           §7 bis.4 (les six gestes et leurs écritures), §7 bis.5 (validation de forme, `0`
//           accepté), §7 bis.6 (états, clavier), §2.5 (`0` n'est pas `NULL`), §3.3 (libellé
//           surchargé), §3.5 (éteindre avant d'allumer)
// @verifies docs/DESIGN_SYSTEM.md §5.8 (états), §6 (confirmation avant retrait), §8, §10
//
// Ces preuves montent le **vrai** écran avec un client factice qui enregistre les requêtes émises,
// le patron d'`AdministrationArborescence.test.tsx`. Le parcours connecté complet relève du projet
// E2E, qui exige la pile.

import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { AdministrationWorkflows } from './AdministrationWorkflows'
import type { ClientCrm } from '../lib/supabase'

afterEach(cleanup)

type Ecriture = {
	table: string
	verbe: 'insert' | 'update' | 'delete'
	charge: Record<string, unknown> | null
	filtres: [string, unknown][]
}

const WORKFLOWS = [
	{
		id: 'wf-1',
		workspace_id: 'ws-1',
		name: 'Pipeline standard',
		scope: 'global',
		track_id: null,
		is_default: true,
		archived_at: null,
	},
	{
		id: 'wf-2',
		workspace_id: 'ws-1',
		name: 'Pipeline grands comptes',
		scope: 'track',
		track_id: 't-1',
		is_default: false,
		archived_at: null,
	},
]

const NOEUD_PROSPECTION = {
	id: 'n-1',
	key: 'prospection',
	label: 'Prospection',
	kind: 'open',
	color: 'neutral',
	default_probability: 10,
	default_stale_after_days: 14,
}

const ETAPES = [
	{
		id: 'e-1',
		workflow_id: 'wf-1',
		workspace_id: 'ws-1',
		node_id: 'n-1',
		position: 1,
		label_override: null,
		probability_override: null,
		stale_after_days: null,
		is_initial: true,
		node: NOEUD_PROSPECTION,
	},
	{
		id: 'e-2',
		workflow_id: 'wf-1',
		workspace_id: 'ws-1',
		node_id: 'n-2',
		position: 2,
		label_override: 'Qualification fine',
		probability_override: 0,
		stale_after_days: 7,
		is_initial: false,
		node: {
			id: 'n-2',
			key: 'qualification',
			label: 'Qualification',
			kind: 'open',
			color: 'brand',
			default_probability: 30,
			default_stale_after_days: 10,
		},
	},
]

const CATALOGUE = [
	{ ...NOEUD_PROSPECTION, position: 1 },
	{
		id: 'n-2',
		key: 'qualification',
		label: 'Qualification',
		kind: 'open',
		color: 'brand',
		position: 2,
		default_probability: 30,
		default_stale_after_days: 10,
	},
	{
		id: 'n-3',
		key: 'devis',
		label: 'Devis envoyé',
		kind: 'open',
		color: 'accent',
		position: 3,
		default_probability: 55,
		default_stale_after_days: 7,
	},
]

type Options = {
	readonly workflows?: unknown[]
	readonly etapes?: unknown[]
	readonly catalogue?: unknown[]
	readonly erreurWorkflows?: { message: string; status: number }
	readonly reponseEcriture?: {
		data: unknown[] | null
		error: { message: string; code?: string } | null
		status: number
	}
}

/** Client factice : il rend les données voulues et **enregistre** les écritures reçues. */
function clientFactice(options: Options = {}): {
	client: ClientCrm
	ecritures: Ecriture[]
	lectures: string[]
} {
	const ecritures: Ecriture[] = []
	const lectures: string[] = []
	const reponseEcriture = options.reponseEcriture ?? { data: [{ id: 'x' }], error: null, status: 200 }

	const lecture = (data: unknown[], erreur?: { message: string; status: number }) => {
		const resultat = erreur
			? { data: null, error: { message: erreur.message }, status: erreur.status }
			: { data, error: null, status: 200 }
		const chaine: Record<string, unknown> = {}
		for (const methode of ['is', 'eq', 'order']) chaine[methode] = () => chaine
		chaine['then'] = (resoudre: (valeur: unknown) => unknown) => Promise.resolve(resultat).then(resoudre)
		return chaine
	}

	const ecriture = (
		table: string,
		verbe: 'insert' | 'update' | 'delete',
		charge: Record<string, unknown> | null,
	) => {
		const enregistree: Ecriture = { table, verbe, charge, filtres: [] }
		ecritures.push(enregistree)
		const chaine: Record<string, unknown> = {}
		chaine['eq'] = (colonne: string, valeur: unknown) => {
			enregistree.filtres.push([colonne, valeur])
			return chaine
		}
		chaine['select'] = () => chaine
		chaine['then'] = (resoudre: (valeur: unknown) => unknown) =>
			Promise.resolve(reponseEcriture).then(resoudre)
		return chaine
	}

	const client = {
		from: (table: string) => ({
			select: () => {
				lectures.push(table)
				if (table === 'workflows') return lecture(options.workflows ?? WORKFLOWS, options.erreurWorkflows)
				if (table === 'workflow_steps') return lecture(options.etapes ?? ETAPES)
				return lecture(options.catalogue ?? CATALOGUE)
			},
			insert: (charge: Record<string, unknown>) => ecriture(table, 'insert', charge),
			update: (charge: Record<string, unknown>) => ecriture(table, 'update', charge),
			delete: () => ecriture(table, 'delete', null),
		}),
	} as unknown as ClientCrm

	return { client, ecritures, lectures }
}

function monter(options: Options = {}) {
	const factice = clientFactice(options)
	render(<AdministrationWorkflows client={factice.client} />)
	return factice
}

const attendreEcran = async () => {
	await screen.findByText('Pipeline standard')
	await screen.findAllByTestId('ligne-etape')
}

// ---------------------------------------------------------------------------------------------
// §7 bis.6 — Les états
// ---------------------------------------------------------------------------------------------

describe('les états systématiques (§7 bis.6, docs/DESIGN_SYSTEM.md §5.8)', () => {
	it('montre un squelette avant que les workflows ne soient chargés', () => {
		monter()
		expect(screen.getByTestId('squelette')).toBeTruthy()
	})

	it('montre un état vide nommé quand aucun workflow n’existe', async () => {
		monter({ workflows: [] })
		expect(await screen.findByTestId('etat-vide')).toBeTruthy()
	})

	it('montre un état d’erreur avec une reprise réelle', async () => {
		monter({ erreurWorkflows: { message: 'boom', status: 500 } })
		expect(await screen.findByTestId('etat-erreur')).toBeTruthy()
		expect(screen.getByRole('button', { name: 'Réessayer' })).toBeTruthy()
	})

	it('un workflow sans étape dit ce qui manque', async () => {
		monter({ etapes: [] })
		await screen.findByText('Pipeline standard')
		expect(await screen.findByText("Ce workflow n'a aucune étape.")).toBeTruthy()
	})
})

// ---------------------------------------------------------------------------------------------
// §7 bis.3 — Les lectures
// ---------------------------------------------------------------------------------------------

describe('les lectures (§7 bis.3)', () => {
	it('choisit d’office le premier workflow — le défaut — et charge ses étapes', async () => {
		const { lectures } = monter()
		await attendreEcran()
		expect(lectures).toContain('workflows')
		expect(lectures).toContain('workflow_steps')
		const choisi = screen.getByRole('button', { name: /Pipeline standard/ })
		expect(choisi.getAttribute('aria-current')).toBe('true')
	})

	it('ne lit PAS le catalogue tant que le sélecteur d’ajout n’est pas ouvert', async () => {
		const { lectures } = monter()
		await attendreEcran()
		expect(lectures).not.toContain('workflow_nodes_catalog')
		await userEvent.click(screen.getByRole('button', { name: 'Ajouter une étape' }))
		await screen.findByTestId('selecteur-ajout')
		await waitFor(() => expect(lectures).toContain('workflow_nodes_catalog'))
	})

	it('changer de workflow recharge ses étapes', async () => {
		const { lectures } = monter()
		await attendreEcran()
		const avant = lectures.filter((table) => table === 'workflow_steps').length
		await userEvent.click(screen.getByRole('button', { name: /Pipeline grands comptes/ }))
		await waitFor(() =>
			expect(lectures.filter((table) => table === 'workflow_steps').length).toBeGreaterThan(avant),
		)
	})
})

// ---------------------------------------------------------------------------------------------
// §3.3 — Ce qu'une ligne montre
// ---------------------------------------------------------------------------------------------

describe('ce qu’une ligne d’étape montre (§3.3)', () => {
	it('rend le libellé du catalogue sans surcharge, la surcharge sinon', async () => {
		monter()
		await attendreEcran()
		expect(screen.getByText('Prospection')).toBeTruthy()
		expect(screen.getByText('Qualification fine')).toBeTruthy()
		expect(screen.queryByText('Qualification')).toBeNull()
	})

	it('marque l’étape initiale d’une mention textuelle, jamais d’une teinte seule', async () => {
		monter()
		await attendreEcran()
		expect(screen.getByText('Étape initiale')).toBeTruthy()
	})

	// LE §2.5 RENDU VISIBLE : `0` est une probabilité surchargée, pas « celle du catalogue ».
	it('affiche une probabilité surchargée à 0, distincte de l’absence de surcharge', async () => {
		monter()
		await attendreEcran()
		const lignes = screen.getAllByTestId('etape-probabilite')
		expect(lignes[0]?.textContent).toBe('Probabilité du catalogue')
		expect(lignes[1]?.textContent).toBe('Probabilité : 0 %')
	})

	it('signale un workflow sans étape initiale par une annonce polie, pas une alerte', async () => {
		monter({ etapes: ETAPES.map((etape) => ({ ...etape, is_initial: false })) })
		await attendreEcran()
		const annonce = screen.getByTestId('alerte-sans-initiale')
		expect(annonce.getAttribute('role')).toBe('status')
	})
})

// ---------------------------------------------------------------------------------------------
// §7 bis.4 — Les gestes
// ---------------------------------------------------------------------------------------------

describe('les gestes et leurs écritures (§7 bis.4)', () => {
	it('le sélecteur d’ajout ne propose que les nœuds non employés, et l’ajout envoie `position: null`', async () => {
		const { ecritures } = monter()
		await attendreEcran()
		await userEvent.click(screen.getByRole('button', { name: 'Ajouter une étape' }))
		const selecteur = await screen.findByTestId('selecteur-ajout')
		// n-1 et n-2 sont déjà des étapes : seul n-3 reste proposable.
		expect(within(selecteur).queryByRole('button', { name: 'Ajouter Prospection' })).toBeNull()
		const ajouter = await within(selecteur).findByRole('button', { name: 'Ajouter Devis envoyé' })
		await userEvent.click(ajouter)
		await waitFor(() => expect(ecritures).toHaveLength(1))
		expect(ecritures[0]).toMatchObject({
			table: 'workflow_steps',
			verbe: 'insert',
			charge: { workflow_id: 'wf-1', workspace_id: 'ws-1', node_id: 'n-3', position: null },
		})
	})

	it('monter la seconde étape écrit UNE position, sur la seule étape déplacée', async () => {
		const { ecritures } = monter()
		await attendreEcran()
		await userEvent.click(screen.getByRole('button', { name: 'Monter Qualification fine' }))
		await waitFor(() => expect(ecritures).toHaveLength(1))
		expect(ecritures[0]?.verbe).toBe('update')
		expect(ecritures[0]?.charge).toEqual({ position: 0.5 })
		expect(ecritures[0]?.filtres).toEqual([['id', 'e-2']])
	})

	it('les commandes d’extrémité sont désactivées, jamais masquées (§10 de CLAUDE.md)', async () => {
		monter()
		await attendreEcran()
		const monter1 = screen.getByRole('button', { name: 'Monter Prospection' }) as HTMLButtonElement
		const descendre2 = screen.getByRole('button', {
			name: 'Descendre Qualification fine',
		}) as HTMLButtonElement
		expect(monter1.disabled).toBe(true)
		expect(descendre2.disabled).toBe(true)
	})

	it('désigner l’étape initiale ÉTEINT d’abord, allume ensuite (§3.5)', async () => {
		const { ecritures } = monter()
		await attendreEcran()
		await userEvent.click(
			screen.getByRole('button', { name: 'Désigner Qualification fine comme étape initiale' }),
		)
		await waitFor(() => expect(ecritures).toHaveLength(2))
		expect(ecritures[0]?.charge).toEqual({ is_initial: false })
		expect(ecritures[0]?.filtres).toEqual([
			['workflow_id', 'wf-1'],
			['is_initial', true],
		])
		expect(ecritures[1]?.charge).toEqual({ is_initial: true })
		expect(ecritures[1]?.filtres).toEqual([['id', 'e-2']])
	})

	it('l’étape déjà initiale ne peut pas être re-désignée : la commande est désactivée', async () => {
		monter()
		await attendreEcran()
		const commande = screen.getByRole('button', {
			name: 'Désigner Prospection comme étape initiale',
		}) as HTMLButtonElement
		expect(commande.disabled).toBe(true)
	})

	it('le retrait passe par une confirmation, et traduit le refus d’une étape occupée', async () => {
		const { ecritures } = monter({
			reponseEcriture: {
				data: null,
				error: { message: 'update or delete violates foreign key', code: '23503' },
				status: 409,
			},
		})
		await attendreEcran()
		await userEvent.click(screen.getByRole('button', { name: 'Retirer Prospection' }))
		// Aucune écriture avant confirmation (docs/DESIGN_SYSTEM.md §6).
		expect(ecritures).toHaveLength(0)
		const confirmation = await screen.findByTestId('confirmation-retrait')
		await userEvent.click(within(confirmation).getByRole('button', { name: 'Retirer' }))
		await waitFor(() => expect(ecritures).toHaveLength(1))
		expect(ecritures[0]?.verbe).toBe('delete')
		const refus = await screen.findByTestId('workflows-refus')
		expect(refus.textContent).toContain('porte des affaires')
	})
})

// ---------------------------------------------------------------------------------------------
// §7 bis.5 — La surcharge et sa validation
// ---------------------------------------------------------------------------------------------

describe('le formulaire de surcharge (§7 bis.5, §2.5)', () => {
	it('repart des surcharges portées, jamais des valeurs du catalogue', async () => {
		monter()
		await attendreEcran()
		await userEvent.click(screen.getByRole('button', { name: 'Surcharger Prospection' }))
		const formulaire = await screen.findByTestId('formulaire-surcharge')
		// Prospection n'a aucune surcharge : les trois champs sont VIDES, pas remplis du catalogue.
		const champs = within(formulaire).getAllByRole('textbox') as HTMLInputElement[]
		expect(champs.map((champ) => champ.value)).toEqual(['', '', ''])
	})

	it('enregistre `0` comme probabilité et `null` comme retrait, dans la même écriture', async () => {
		const { ecritures } = monter()
		await attendreEcran()
		await userEvent.click(screen.getByRole('button', { name: 'Surcharger Qualification fine' }))
		const formulaire = await screen.findByTestId('formulaire-surcharge')
		const seuil = within(formulaire).getByLabelText('Seuil de relance (jours)')
		await userEvent.clear(seuil)
		await userEvent.click(within(formulaire).getByRole('button', { name: 'Enregistrer' }))
		await waitFor(() => expect(ecritures).toHaveLength(1))
		expect(ecritures[0]?.charge).toEqual({
			label_override: 'Qualification fine',
			probability_override: 0,
			stale_after_days: null,
		})
	})

	it('refuse une probabilité hors bornes avec une erreur associée au champ, sans écrire', async () => {
		const { ecritures } = monter()
		await attendreEcran()
		await userEvent.click(screen.getByRole('button', { name: 'Surcharger Prospection' }))
		const formulaire = await screen.findByTestId('formulaire-surcharge')
		await userEvent.type(within(formulaire).getByLabelText('Probabilité (%)'), '101')
		expect(
			await within(formulaire).findByText('La probabilité doit être comprise entre 0 et 100.'),
		).toBeTruthy()
		const enregistrer = within(formulaire).getByRole('button', {
			name: 'Enregistrer',
		}) as HTMLButtonElement
		expect(enregistrer.disabled).toBe(true)
		expect(ecritures).toHaveLength(0)
	})

	it('refuse un seuil non entier ou nul', async () => {
		monter()
		await attendreEcran()
		await userEvent.click(screen.getByRole('button', { name: 'Surcharger Prospection' }))
		const formulaire = await screen.findByTestId('formulaire-surcharge')
		await userEvent.type(within(formulaire).getByLabelText('Seuil de relance (jours)'), '0')
		expect(
			await within(formulaire).findByText(
				'Le seuil de relance doit être un nombre entier de jours strictement positif.',
			),
		).toBeTruthy()
	})

	it('un refus du backend est montré dans le formulaire et la saisie est conservée', async () => {
		monter({
			reponseEcriture: { data: null, error: { message: 'denied' }, status: 403 },
		})
		await attendreEcran()
		await userEvent.click(screen.getByRole('button', { name: 'Surcharger Prospection' }))
		const formulaire = await screen.findByTestId('formulaire-surcharge')
		await userEvent.type(within(formulaire).getByLabelText('Libellé surchargé'), 'Découverte')
		await userEvent.click(within(formulaire).getByRole('button', { name: 'Enregistrer' }))
		const refus = await screen.findByTestId('workflows-refus')
		expect(refus.textContent).toContain('administrateur')
		expect((within(formulaire).getByLabelText('Libellé surchargé') as HTMLInputElement).value).toBe(
			'Découverte',
		)
	})
})
