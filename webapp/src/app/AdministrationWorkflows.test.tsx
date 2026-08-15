// @verifies CRM-076 (docs/BACKLOG.md) — éditeur administrateur de workflows, première, deuxième,
//           troisième et quatrième tranches
// @verifies docs/SPEC-workflow-engine.md §7 bis.3 (les lectures et le catalogue à la demande),
//           §7 bis.4 (les six gestes et leurs écritures), §7 bis.5 (validation de forme, `0`
//           accepté), §7 bis.6 (états, clavier), §2.5 (`0` n'est pas `NULL`), §3.3 (libellé
//           surchargé), §3.5 (éteindre avant d'allumer)
// @verifies docs/SPEC-workflow-engine.md §7 bis.9 (les arêtes du graphe), §7 bis.9.1 (les deux
//           lectures ensemble), §7 bis.9.2 (les trois gestes), §7 bis.9.3 (les choix offerts),
//           §7 bis.9.6 (états et disposition), §3.4 (modèle des arêtes)
// @verifies docs/SPEC-workflow-engine.md §7 bis.10 (les champs du formulaire), §7 bis.10.1
//           (lecture 5, archivés compris), §7 bis.10.2 (les cinq gestes), §7 bis.10.3 (clé et type
//           figés après la déclaration), §7 bis.10.4 (validation de forme), §7 bis.10.5 (refus)
// @verifies docs/SPEC-workflow-engine.md §7 bis.11 (la grille champ × étape), §7 bis.11.1
//           (lecture 6, émise avec les trois autres), §7 bis.11.2 (les champs archivés écartés),
//           §7 bis.11.3 (l'`upsert` et la suppression), §7 bis.11.4 (les quatre états d'une case),
//           §7 bis.11.5 (les refus), §7 bis.11.6 (le vrai `table` et ses deux en-têtes)
// @verifies docs/SPEC-form-composer.md §2.3 (types), §2.4 (options), §2.7 (aucune suppression),
//           §3.1 (l'absence de règle vaut `visible`), §5 (un champ archivé n'est dans aucun formulaire)
// @verifies docs/DESIGN_SYSTEM.md §5.9 (tableau sémantique, jamais simulé)
// @verifies docs/DESIGN_SYSTEM.md §5.7 bis (case à cocher), §5.8 (états), §6 (confirmation avant
//           retrait), §8, §10
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
	verbe: 'insert' | 'update' | 'delete' | 'upsert'
	charge: Record<string, unknown> | null
	/** Les options d'un `upsert` : `onConflict` porte le couple d'unicité (§7 bis.11.3). */
	options?: Record<string, unknown>
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

/**
 * Une seule arête par défaut : `Prospection → Qualification fine`.
 *
 * Elle suffit à ce que le second groupe — `Qualification fine` — soit un cul-de-sac, ce que le
 * §7 bis.9.1 exige de montrer, et à ce que `Prospection` n'ait plus aucune arrivée possible : les
 * deux moitiés de la règle sont donc éprouvables sans jeu supplémentaire.
 */
const TRANSITIONS = [
	{
		id: 'tr-1',
		workflow_id: 'wf-1',
		workspace_id: 'ws-1',
		from_step_id: 'e-1',
		to_step_id: 'e-2',
		label: null,
		require_comment: false,
	},
]

/**
 * Trois champs, choisis pour que chaque règle du §7 bis.10 ait de quoi être éprouvée : un `money`
 * avec sa devise, un `select` avec ses choix, et un champ **archivé** — le seul « retiré » que le
 * produit connaisse. Leurs libellés ne recoupent aucun libellé d'étape : deux commandes de même nom
 * accessible rendraient les assertions ambiguës (docs/DESIGN_SYSTEM.md §5.15).
 */
const CHAMPS = [
	{
		id: 'c-1',
		workflow_id: 'wf-1',
		workspace_id: 'ws-1',
		key: 'budget',
		label: 'Budget estimé',
		type: 'money',
		options: { currency: 'EUR' },
		help_text: 'Montant hors taxes.',
		position: 1,
		archived_at: null,
	},
	{
		id: 'c-2',
		workflow_id: 'wf-1',
		workspace_id: 'ws-1',
		key: 'source',
		label: 'Origine du contact',
		type: 'select',
		options: { choices: [{ key: 'salon', label: 'Salon' }, { key: 'site', label: 'Site web' }] },
		help_text: null,
		position: 2,
		archived_at: null,
	},
	{
		id: 'c-3',
		workflow_id: 'wf-1',
		workspace_id: 'ws-1',
		key: 'note-ancienne',
		label: 'Note interne',
		type: 'textarea',
		options: {},
		help_text: null,
		position: 3,
		archived_at: '2026-03-15T09:00:00Z',
	},
]

/**
 * Deux règles seulement, sur quatre couples possibles — deux champs actifs × deux étapes.
 *
 * C'est délibéré : la grille doit rendre **deux cases par défaut**, et le §7 bis.11.2 en fait la
 * moitié du contrat. Une des deux règles est un `visible` explicite, que le §7 bis.11.4 interdit de
 * replier sur le défaut. La troisième porte sur le champ **archivé** : elle ne doit apparaître
 * nulle part, sans être supprimée pour autant.
 */
const REGLES = [
	{ field_id: 'c-1', step_id: 'e-2', visibility: 'required' },
	{ field_id: 'c-2', step_id: 'e-1', visibility: 'visible' },
	{ field_id: 'c-3', step_id: 'e-1', visibility: 'hidden' },
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
	readonly transitions?: unknown[]
	readonly champs?: unknown[]
	readonly regles?: unknown[]
	readonly catalogue?: unknown[]
	readonly erreurWorkflows?: { message: string; status: number }
	readonly erreurTransitions?: { message: string; status: number }
	readonly erreurChamps?: { message: string; status: number }
	readonly erreurRegles?: { message: string; status: number }
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
		verbe: 'insert' | 'update' | 'delete' | 'upsert',
		charge: Record<string, unknown> | null,
		options?: Record<string, unknown>,
	) => {
		const enregistree: Ecriture = { table, verbe, charge, filtres: [] }
		if (options !== undefined) enregistree.options = options
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
				if (table === 'workflow_transitions') {
					return lecture(options.transitions ?? TRANSITIONS, options.erreurTransitions)
				}
				if (table === 'form_fields') return lecture(options.champs ?? CHAMPS, options.erreurChamps)
				if (table === 'form_field_rules') return lecture(options.regles ?? REGLES, options.erreurRegles)
				return lecture(options.catalogue ?? CATALOGUE)
			},
			insert: (charge: Record<string, unknown>) => ecriture(table, 'insert', charge),
			update: (charge: Record<string, unknown>) => ecriture(table, 'update', charge),
			upsert: (charge: Record<string, unknown>, options?: Record<string, unknown>) =>
				ecriture(table, 'upsert', charge, options),
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
	// PREUVE RÉVISÉE, ET LA RÈGLE A CHANGÉ : depuis le §7 bis.9.6, le bloc des transitions nomme
	// ses groupes par le libellé de l'étape de départ, donc chaque libellé apparaît DEUX fois à
	// l'écran. La version précédente interrogeait tout le document et échouait sur l'ambiguïté.
	// Elle est resserrée sur la liste des étapes plutôt que supprimée : ce qu'elle éprouve — la
	// surcharge l'emporte sur le catalogue — reste vrai et reste dû.
	it('rend le libellé du catalogue sans surcharge, la surcharge sinon', async () => {
		monter()
		await attendreEcran()
		const liste = within(screen.getByTestId('liste-etapes'))
		expect(liste.getByText('Prospection')).toBeTruthy()
		expect(liste.getByText('Qualification fine')).toBeTruthy()
		expect(liste.queryByText('Qualification')).toBeNull()
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

// ---------------------------------------------------------------------------------------------
// §7 bis.9 — Les arêtes du graphe
// ---------------------------------------------------------------------------------------------

describe('le bloc des transitions (§7 bis.9.1, §7 bis.9.6)', () => {
	it('lit les arêtes avec les étapes, sans geste supplémentaire', async () => {
		const { lectures } = monter()
		await attendreEcran()
		await waitFor(() => expect(lectures).toContain('workflow_transitions'))
	})

	it('groupe les sorties sous leur étape de départ, dans l’ordre du graphe', async () => {
		monter()
		await attendreEcran()
		const groupes = within(await screen.findByTestId('groupes-transitions')).getAllByRole(
			'listitem',
			{},
		)
		// Le premier élément de liste est le groupe de `Prospection`, qui porte l'unique sortie.
		expect(within(groupes[0] as HTMLElement).getByText('Vers Qualification fine')).toBeTruthy()
	})

	// Le §3.9 en livre deux, et un graphe qui masquerait ses culs-de-sac cacherait ce qu'un
	// administrateur cherche.
	it('une étape sans sortie le dit, elle ne disparaît pas', async () => {
		monter()
		await attendreEcran()
		expect(await screen.findByTestId('etape-sans-sortie')).toBeTruthy()
	})

	it('une arête sans libellé annonce qu’elle prendra celui de l’arrivée', async () => {
		monter()
		await attendreEcran()
		expect(await screen.findByText('Libellé de l’étape d’arrivée')).toBeTruthy()
	})

	it('le motif exigé est une mention textuelle, jamais une teinte seule', async () => {
		monter({
			transitions: [
				{ ...TRANSITIONS[0], id: 'tr-2', require_comment: true, label: 'Qualifier' },
			],
		})
		await attendreEcran()
		expect(await screen.findByTestId('transition-motif')).toBeTruthy()
		expect(screen.getByText('Qualifier')).toBeTruthy()
	})

	// Une transition relie DEUX étapes : sous ce seuil, offrir le formulaire serait offrir deux
	// listes inutilisables.
	it('un workflow d’une seule étape annonce qu’aucune transition n’est possible', async () => {
		monter({ etapes: [ETAPES[0]], transitions: [] })
		await attendreEcran()
		expect(await screen.findByTestId('transitions-trop-peu-etapes')).toBeTruthy()
		expect(screen.queryByRole('button', { name: 'Déclarer une transition' })).toBeNull()
	})

	it('une erreur de lecture des arêtes est nommée dans son bloc, avec une reprise réelle', async () => {
		monter({ erreurTransitions: { message: 'boom', status: 500 } })
		await attendreEcran()
		// Les étapes, elles, sont chargées : l'erreur est celle du SECOND bloc, et l'écran ne
		// remplace pas tout le graphe par une page d'erreur pour une moitié manquante.
		expect(screen.getAllByTestId('ligne-etape').length).toBeGreaterThan(0)
		const erreur = await screen.findByText(
			'Les transitions de ce workflow n’ont pas pu être chargées.',
		)
		expect(erreur).toBeTruthy()
	})

	it('un workflow sans aucune arête montre ses étapes en culs-de-sac', async () => {
		monter({ transitions: [] })
		await attendreEcran()
		expect((await screen.findAllByTestId('etape-sans-sortie')).length).toBe(2)
	})
})

describe('les trois gestes sur une arête (§7 bis.9.2)', () => {
	it('la déclaration envoie les deux extrémités, le libellé et le motif', async () => {
		const { ecritures } = monter()
		await attendreEcran()
		await userEvent.click(screen.getByRole('button', { name: 'Déclarer une transition' }))
		const formulaire = await screen.findByTestId('formulaire-transition')
		// Le départ par défaut est la première étape ; on choisit explicitement la seconde, dont
		// la seule arrivée possible est `Prospection`.
		await userEvent.selectOptions(
			within(formulaire).getByLabelText('Étape de départ'),
			'e-2',
		)
		await userEvent.type(within(formulaire).getByLabelText('Libellé du bouton'), 'Revenir')
		await userEvent.click(within(formulaire).getByLabelText('Exiger un motif'))
		await userEvent.click(within(formulaire).getByRole('button', { name: 'Enregistrer' }))
		await waitFor(() => expect(ecritures).toHaveLength(1))
		expect(ecritures[0]).toMatchObject({
			table: 'workflow_transitions',
			verbe: 'insert',
			charge: {
				workflow_id: 'wf-1',
				workspace_id: 'ws-1',
				from_step_id: 'e-2',
				to_step_id: 'e-1',
				label: 'Revenir',
				require_comment: true,
			},
		})
	})

	// Le §7 bis.9.3 : l'étape de départ et les arrivées déjà déclarées ne sont pas offertes.
	it('le sélecteur d’arrivée retire le départ et les arrivées déjà déclarées', async () => {
		monter()
		await attendreEcran()
		await userEvent.click(screen.getByRole('button', { name: 'Déclarer une transition' }))
		const formulaire = await screen.findByTestId('formulaire-transition')
		// Départ `Prospection` : `Prospection` est exclue par le `CHECK`, `Qualification fine`
		// par l'unicité — il ne reste rien, et le formulaire le DIT.
		expect(within(formulaire).getByTestId('arrivees-epuisees')).toBeTruthy()
		expect(within(formulaire).getByRole('button', { name: 'Enregistrer' }).hasAttribute('disabled')).toBe(
			true,
		)
	})

	it('changer le départ recalcule les arrivées offertes', async () => {
		monter()
		await attendreEcran()
		await userEvent.click(screen.getByRole('button', { name: 'Déclarer une transition' }))
		const formulaire = await screen.findByTestId('formulaire-transition')
		await userEvent.selectOptions(within(formulaire).getByLabelText('Étape de départ'), 'e-2')
		const arrivees = within(formulaire).getByLabelText('Étape d’arrivée') as HTMLSelectElement
		expect(Array.from(arrivees.options).map((option) => option.value)).toEqual(['e-1'])
	})

	it('un libellé blanc est refusé avant d’être envoyé', async () => {
		const { ecritures } = monter()
		await attendreEcran()
		await userEvent.click(screen.getByRole('button', { name: 'Déclarer une transition' }))
		const formulaire = await screen.findByTestId('formulaire-transition')
		await userEvent.selectOptions(within(formulaire).getByLabelText('Étape de départ'), 'e-2')
		await userEvent.type(within(formulaire).getByLabelText('Libellé du bouton'), '   ')
		expect(within(formulaire).getByText('Le libellé ne peut pas être blanc.')).toBeTruthy()
		expect(ecritures).toHaveLength(0)
	})

	it('la modification n’écrit que le libellé et le motif', async () => {
		const { ecritures } = monter()
		await attendreEcran()
		await userEvent.click(
			await screen.findByRole('button', {
				name: 'Modifier la transition Prospection vers Qualification fine',
			}),
		)
		const formulaire = await screen.findByTestId('formulaire-transition-edition')
		await userEvent.type(within(formulaire).getByLabelText('Libellé du bouton'), 'Qualifier')
		await userEvent.click(within(formulaire).getByRole('button', { name: 'Enregistrer' }))
		await waitFor(() => expect(ecritures).toHaveLength(1))
		expect(ecritures[0]).toMatchObject({
			table: 'workflow_transitions',
			verbe: 'update',
			charge: { label: 'Qualifier', require_comment: false },
			filtres: [['id', 'tr-1']],
		})
	})

	// `''` heurterait le `CHECK` du §3.4 : vider le champ retire la surcharge par un `null`.
	it('vider le libellé envoie `null`, pas une chaîne vide', async () => {
		const { ecritures } = monter({
			transitions: [{ ...TRANSITIONS[0], label: 'Qualifier' }],
		})
		await attendreEcran()
		await userEvent.click(
			await screen.findByRole('button', {
				name: 'Modifier la transition Prospection vers Qualification fine',
			}),
		)
		const formulaire = await screen.findByTestId('formulaire-transition-edition')
		await userEvent.clear(within(formulaire).getByLabelText('Libellé du bouton'))
		await userEvent.click(within(formulaire).getByRole('button', { name: 'Enregistrer' }))
		await waitFor(() => expect(ecritures).toHaveLength(1))
		expect(ecritures[0]?.charge).toMatchObject({ label: null })
	})

	it('le retrait demande confirmation, puis supprime sur l’identifiant de l’arête', async () => {
		const { ecritures } = monter()
		await attendreEcran()
		await userEvent.click(
			await screen.findByRole('button', {
				name: 'Retirer la transition Prospection vers Qualification fine',
			}),
		)
		expect(ecritures).toHaveLength(0)
		const confirmation = await screen.findByTestId('confirmation-retrait-transition')
		await userEvent.click(within(confirmation).getByRole('button', { name: 'Retirer la transition' }))
		await waitFor(() => expect(ecritures).toHaveLength(1))
		expect(ecritures[0]).toMatchObject({
			table: 'workflow_transitions',
			verbe: 'delete',
			filtres: [['id', 'tr-1']],
		})
	})

	it('annuler la confirmation n’écrit rien', async () => {
		const { ecritures } = monter()
		await attendreEcran()
		await userEvent.click(
			await screen.findByRole('button', {
				name: 'Retirer la transition Prospection vers Qualification fine',
			}),
		)
		const confirmation = await screen.findByTestId('confirmation-retrait-transition')
		await userEvent.click(within(confirmation).getByRole('button', { name: 'Annuler' }))
		expect(screen.queryByTestId('confirmation-retrait-transition')).toBeNull()
		expect(ecritures).toHaveLength(0)
	})

	// Le §7 bis.9.5 : `23505` est ici « déjà déclarée », et le message le dit dans ces termes.
	it('un refus d’unicité est traduit dans le vocabulaire des arêtes', async () => {
		monter({
			reponseEcriture: {
				data: null,
				error: { message: 'duplicate key value', code: '23505' },
				status: 409,
			},
		})
		await attendreEcran()
		await userEvent.click(
			await screen.findByRole('button', {
				name: 'Modifier la transition Prospection vers Qualification fine',
			}),
		)
		const formulaire = await screen.findByTestId('formulaire-transition-edition')
		await userEvent.click(within(formulaire).getByRole('button', { name: 'Enregistrer' }))
		expect(await screen.findByText('Cette transition est déjà déclarée.')).toBeTruthy()
	})

	// LA TABULATION EST LE VRAI SUJET, pas la touche Entrée : un formulaire dont le bouton
	// d'enregistrement ne se rejoint pas au clavier est inutilisable, et c'est ce que le §8 du
	// design system exige. Le nombre de tabulations n'est pas écrit en dur — il changerait au
	// premier champ ajouté — mais borné, pour qu'un piège de focus fasse échouer la preuve.
	it('la déclaration se mène au clavier seul, du bouton d’ouverture à l’enregistrement', async () => {
		const { ecritures } = monter()
		await attendreEcran()
		const declarer = screen.getByRole('button', { name: 'Déclarer une transition' })
		declarer.focus()
		await userEvent.keyboard('{Enter}')
		const formulaire = await screen.findByTestId('formulaire-transition')
		// Le focus est porté dans le premier champ à l'ouverture (docs/DESIGN_SYSTEM.md §5.13).
		expect(document.activeElement).toBe(within(formulaire).getByLabelText('Étape de départ'))
		await userEvent.selectOptions(within(formulaire).getByLabelText('Étape de départ'), 'e-2')
		const enregistrer = within(formulaire).getByRole('button', { name: 'Enregistrer' })
		for (let pas = 0; pas < 8 && document.activeElement !== enregistrer; pas += 1) {
			await userEvent.tab()
		}
		expect(document.activeElement).toBe(enregistrer)
		await userEvent.keyboard('{Enter}')
		await waitFor(() => expect(ecritures).toHaveLength(1))
		expect(ecritures[0]).toMatchObject({ verbe: 'insert', charge: { from_step_id: 'e-2' } })
	})
})

// ---------------------------------------------------------------------------------------------
// §7 bis.10 — Les champs du formulaire
// ---------------------------------------------------------------------------------------------

describe('le bloc des champs de formulaire (§7 bis.10)', () => {
	it('lit `form_fields` avec les étapes et les arêtes, en une seule salve', async () => {
		const { lectures } = monter()
		await attendreEcran()
		await waitFor(() => expect(lectures).toContain('form_fields'))
		expect(lectures.filter((table) => table === 'form_fields')).toHaveLength(1)
	})

	it('montre chaque champ avec sa clé, son type traduit et son aide', async () => {
		monter()
		await attendreEcran()
		const liste = await screen.findByTestId('liste-champs')
		expect(within(liste).getByText('Budget estimé')).toBeTruthy()
		expect(within(liste).getByText('budget')).toBeTruthy()
		expect(within(liste).getByText('Montant')).toBeTruthy()
		expect(within(liste).getByText('Montant hors taxes.')).toBeTruthy()
		expect(within(liste).getByText('Choix unique')).toBeTruthy()
	})

	it('NOMME un champ archivé au lieu de le masquer ou de le griser seulement', async () => {
		monter()
		await attendreEcran()
		const liste = await screen.findByTestId('liste-champs')
		// Le champ archivé est bien rendu — la lecture ne l'exclut pas (§7 bis.10.1) —, il porte la
		// mention « Archivé », et sa commande est la RESTAURATION, jamais une suppression.
		expect(within(liste).getByText('Note interne')).toBeTruthy()
		expect(within(liste).getAllByTestId('champ-archive')).toHaveLength(1)
		expect(within(liste).getByRole('button', { name: 'Restaurer le champ Note interne' })).toBeTruthy()
		expect(within(liste).queryByRole('button', { name: 'Archiver le champ Note interne' })).toBeNull()
	})

	it('montre un état vide nommé quand le formulaire n’a aucun champ', async () => {
		monter({ champs: [] })
		await attendreEcran()
		expect(await screen.findByText('Aucun champ dans ce formulaire')).toBeTruthy()
	})

	it('montre un état d’erreur propre au bloc des champs', async () => {
		monter({ erreurChamps: { message: 'boom', status: 500 } })
		await attendreEcran()
		expect(await screen.findByText('Les champs de ce workflow n’ont pas pu être chargés.')).toBeTruthy()
	})

	it('la déclaration envoie une insertion SANS `position`, options composées selon le type', async () => {
		const { ecritures } = monter()
		await attendreEcran()
		await userEvent.click(screen.getByRole('button', { name: 'Déclarer un champ' }))
		const formulaire = await screen.findByTestId('formulaire-champ')
		await userEvent.type(within(formulaire).getByLabelText('Clé'), 'delai-reponse')
		await userEvent.type(within(formulaire).getByLabelText('Libellé'), 'Délai de réponse')
		await userEvent.selectOptions(within(formulaire).getByLabelText('Type'), 'number')
		await userEvent.click(within(formulaire).getByRole('button', { name: 'Enregistrer' }))
		await waitFor(() => expect(ecritures).toHaveLength(1))
		expect(ecritures[0]).toMatchObject({
			table: 'form_fields',
			verbe: 'insert',
			charge: {
				workflow_id: 'wf-1',
				workspace_id: 'ws-1',
				key: 'delai-reponse',
				label: 'Délai de réponse',
				type: 'number',
				help_text: null,
				options: {},
			},
		})
		expect(Object.keys(ecritures[0]?.charge ?? {})).not.toContain('position')
	})

	it('un type à choix fait apparaître l’éditeur de choix, et un `money` son champ de devise', async () => {
		monter()
		await attendreEcran()
		await userEvent.click(screen.getByRole('button', { name: 'Déclarer un champ' }))
		const formulaire = await screen.findByTestId('formulaire-champ')
		expect(within(formulaire).queryByTestId('editeur-choix')).toBeNull()
		await userEvent.selectOptions(within(formulaire).getByLabelText('Type'), 'select')
		expect(within(formulaire).getByTestId('editeur-choix')).toBeTruthy()
		await userEvent.selectOptions(within(formulaire).getByLabelText('Type'), 'money')
		expect(within(formulaire).queryByTestId('editeur-choix')).toBeNull()
		expect(within(formulaire).getByLabelText('Devise')).toBeTruthy()
	})

	it('REFUSE DEUX CHOIX DE MÊME CLÉ, que la base accepterait', async () => {
		// §7 bis.10.4 : mesuré le 2026-08-14, un `select` portant deux choix de clé `a` est accepté
		// en `201` par la base. Cet écran est la seule garantie du produit, et la preuve le montre
		// dans les deux sens — le refus, puis la levée du refus.
		const { ecritures } = monter()
		await attendreEcran()
		await userEvent.click(screen.getByRole('button', { name: 'Déclarer un champ' }))
		const formulaire = await screen.findByTestId('formulaire-champ')
		await userEvent.type(within(formulaire).getByLabelText('Clé'), 'origine')
		await userEvent.type(within(formulaire).getByLabelText('Libellé'), 'Origine')
		await userEvent.selectOptions(within(formulaire).getByLabelText('Type'), 'select')
		await userEvent.click(within(formulaire).getByRole('button', { name: 'Ajouter un choix' }))
		await userEvent.click(within(formulaire).getByRole('button', { name: 'Ajouter un choix' }))
		const cles = () => within(formulaire).getAllByLabelText('Clé du choix') as HTMLInputElement[]
		const libelles = () => within(formulaire).getAllByLabelText('Libellé du choix') as HTMLInputElement[]
		await userEvent.type(cles()[0] as HTMLInputElement, 'salon')
		await userEvent.type(libelles()[0] as HTMLInputElement, 'Salon')
		await userEvent.type(cles()[1] as HTMLInputElement, 'salon')
		await userEvent.type(libelles()[1] as HTMLInputElement, 'Salon bis')
		expect(
			within(formulaire).getByText(
				'Deux choix portent la même clé : les réponses seraient impossibles à distinguer.',
			),
		).toBeTruthy()
		const enregistrer = within(formulaire).getByRole('button', { name: 'Enregistrer' }) as HTMLButtonElement
		expect(enregistrer.disabled).toBe(true)
		expect(ecritures).toHaveLength(0)
		// La seconde clé corrigée lève le refus : un contrôle qui ne se laisse jamais satisfaire
		// serait indistinguable d'un formulaire cassé.
		await userEvent.clear(cles()[1] as HTMLInputElement)
		await userEvent.type(cles()[1] as HTMLInputElement, 'site')
		expect((within(formulaire).getByRole('button', { name: 'Enregistrer' }) as HTMLButtonElement).disabled).toBe(
			false,
		)
	})

	it('l’édition n’offre NI la clé NI le type, et son écriture ne les porte pas', async () => {
		const { ecritures } = monter()
		await attendreEcran()
		await userEvent.click(screen.getByRole('button', { name: 'Modifier le champ Budget estimé' }))
		const formulaire = await screen.findByTestId('formulaire-champ')
		// Les deux sont AFFICHÉS — l'administrateur doit les lire — mais comme des textes qui disent
		// pourquoi ils ne bougent pas, jamais comme des champs désactivés sans explication.
		expect(within(formulaire).queryByLabelText('Clé')).toBeNull()
		expect(within(formulaire).queryByLabelText('Type')).toBeNull()
		expect(within(formulaire).getByTestId('champ-cle-figee').textContent).toContain('budget')
		expect(within(formulaire).getByTestId('champ-type-fige').textContent).toContain('Montant')
		// La devise du champ `money` est reprise telle qu'elle est portée, pas devinée.
		expect((within(formulaire).getByLabelText('Devise') as HTMLInputElement).value).toBe('EUR')
		await userEvent.clear(within(formulaire).getByLabelText('Libellé'))
		await userEvent.type(within(formulaire).getByLabelText('Libellé'), 'Budget prévisionnel')
		await userEvent.click(within(formulaire).getByRole('button', { name: 'Enregistrer' }))
		await waitFor(() => expect(ecritures).toHaveLength(1))
		expect(ecritures[0]).toMatchObject({
			table: 'form_fields',
			verbe: 'update',
			charge: { label: 'Budget prévisionnel', help_text: 'Montant hors taxes.', options: { currency: 'EUR' } },
		})
		expect(Object.keys(ecritures[0]?.charge ?? {})).not.toContain('key')
		expect(Object.keys(ecritures[0]?.charge ?? {})).not.toContain('type')
		expect(ecritures[0]?.filtres).toEqual([['id', 'c-1']])
	})

	it('l’édition d’un `select` reprend ses choix et les réécrit tels quels', async () => {
		const { ecritures } = monter()
		await attendreEcran()
		await userEvent.click(screen.getByRole('button', { name: 'Modifier le champ Origine du contact' }))
		const formulaire = await screen.findByTestId('formulaire-champ')
		expect(within(formulaire).getAllByLabelText('Clé du choix')).toHaveLength(2)
		await userEvent.click(within(formulaire).getByRole('button', { name: 'Enregistrer' }))
		await waitFor(() => expect(ecritures).toHaveLength(1))
		expect(ecritures[0]?.charge).toMatchObject({
			options: { choices: [{ key: 'salon', label: 'Salon' }, { key: 'site', label: 'Site web' }] },
		})
	})

	it('l’archivage passe par une confirmation et écrit un instant, jamais un `delete`', async () => {
		const { ecritures } = monter()
		await attendreEcran()
		await userEvent.click(screen.getByRole('button', { name: 'Archiver le champ Budget estimé' }))
		const confirmation = await screen.findByTestId('confirmation-archivage-champ')
		expect(ecritures).toHaveLength(0)
		await userEvent.click(within(confirmation).getByRole('button', { name: 'Archiver' }))
		await waitFor(() => expect(ecritures).toHaveLength(1))
		expect(ecritures[0]?.table).toBe('form_fields')
		expect(ecritures[0]?.verbe).toBe('update')
		expect(typeof (ecritures[0]?.charge as { archived_at?: unknown }).archived_at).toBe('string')
		expect(ecritures[0]?.filtres).toEqual([['id', 'c-1']])
	})

	it('la restauration écrit `null` sans confirmation : elle ne perd rien', async () => {
		const { ecritures } = monter()
		await attendreEcran()
		await userEvent.click(screen.getByRole('button', { name: 'Restaurer le champ Note interne' }))
		await waitFor(() => expect(ecritures).toHaveLength(1))
		expect(ecritures[0]?.charge).toEqual({ archived_at: null })
		expect(ecritures[0]?.filtres).toEqual([['id', 'c-3']])
	})

	it('déplacer un champ écrit UNE position, et les extrémités sont désactivées', async () => {
		const { ecritures } = monter()
		await attendreEcran()
		const liste = await screen.findByTestId('liste-champs')
		const monterPremier = within(liste).getByRole('button', {
			name: 'Monter Budget estimé',
		}) as HTMLButtonElement
		const descendreDernier = within(liste).getByRole('button', {
			name: 'Descendre Note interne',
		}) as HTMLButtonElement
		expect(monterPremier.disabled).toBe(true)
		expect(descendreDernier.disabled).toBe(true)
		await userEvent.click(within(liste).getByRole('button', { name: 'Monter Origine du contact' }))
		await waitFor(() => expect(ecritures).toHaveLength(1))
		expect(ecritures[0]?.charge).toEqual({ position: 0.5 })
		expect(ecritures[0]?.filtres).toEqual([['id', 'c-2']])
	})

	it('traduit le refus d’une clé déjà prise reçu de la base', async () => {
		monter({
			reponseEcriture: {
				data: null,
				error: { message: 'duplicate key value', code: '23505' },
				status: 409,
			},
		})
		await attendreEcran()
		await userEvent.click(screen.getByRole('button', { name: 'Déclarer un champ' }))
		const formulaire = await screen.findByTestId('formulaire-champ')
		await userEvent.type(within(formulaire).getByLabelText('Clé'), 'budget')
		await userEvent.type(within(formulaire).getByLabelText('Libellé'), 'Doublon')
		await userEvent.click(within(formulaire).getByRole('button', { name: 'Enregistrer' }))
		expect(await screen.findByText('Cette clé est déjà prise dans ce workflow.')).toBeTruthy()
	})

	it('refuse une clé malformée avant l’aller-retour, et le dit', async () => {
		const { ecritures } = monter()
		await attendreEcran()
		await userEvent.click(screen.getByRole('button', { name: 'Déclarer un champ' }))
		const formulaire = await screen.findByTestId('formulaire-champ')
		await userEvent.type(within(formulaire).getByLabelText('Clé'), 'Budget_Prev')
		await userEvent.type(within(formulaire).getByLabelText('Libellé'), 'Budget')
		expect(
			within(formulaire).getByText(
				'La clé n’accepte que des minuscules, des chiffres et des tirets simples, sans tiret au début ni à la fin.',
			),
		).toBeTruthy()
		expect(
			(within(formulaire).getByRole('button', { name: 'Enregistrer' }) as HTMLButtonElement).disabled,
		).toBe(true)
		expect(ecritures).toHaveLength(0)
	})

	it('la déclaration d’un champ se mène au clavier seul', async () => {
		const { ecritures } = monter()
		await attendreEcran()
		const declarer = screen.getByRole('button', { name: 'Déclarer un champ' })
		declarer.focus()
		await userEvent.keyboard('{Enter}')
		const formulaire = await screen.findByTestId('formulaire-champ')
		// Le focus entre dans le premier champ réellement modifiable : la clé, à la déclaration.
		expect(document.activeElement).toBe(within(formulaire).getByLabelText('Clé'))
		await userEvent.keyboard('note-libre')
		await userEvent.tab()
		await userEvent.keyboard('Note libre')
		const enregistrer = within(formulaire).getByRole('button', { name: 'Enregistrer' })
		for (let pas = 0; pas < 10 && document.activeElement !== enregistrer; pas += 1) {
			await userEvent.tab()
		}
		expect(document.activeElement).toBe(enregistrer)
		await userEvent.keyboard('{Enter}')
		await waitFor(() => expect(ecritures).toHaveLength(1))
		expect(ecritures[0]).toMatchObject({ verbe: 'insert', charge: { key: 'note-libre', label: 'Note libre' } })
	})
})

// ---------------------------------------------------------------------------------------------
// §7 bis.11 — La grille champ × étape des règles de visibilité
// ---------------------------------------------------------------------------------------------

describe('la grille des règles de visibilité (§7 bis.11)', () => {
	it('lit les règles AVEC les étapes, les arêtes et les champs, à l’ouverture', async () => {
		// §7 bis.11.1 : une règle n'a de sens qu'entre un champ et une étape du même instant.
		const { lectures } = monter()
		await attendreEcran()
		await waitFor(() => expect(lectures).toContain('form_field_rules'))
	})

	it('rend un VRAI tableau : une colonne par étape, une ligne par champ actif', async () => {
		// docs/DESIGN_SYSTEM.md §5.9 — `th scope="col"` pour les étapes, `th scope="row"` pour les
		// champs. Une grille de `div` priverait un lecteur d'écran de l'en-tête rappelé à chaque case.
		monter()
		await attendreEcran()
		const grille = await screen.findByTestId('grille-visibilites')
		expect(grille.tagName).toBe('TABLE')
		const colonnes = within(grille).getAllByRole('columnheader').map((entete) => entete.textContent)
		expect(colonnes).toEqual(['Champ', 'Prospection', 'Qualification fine'])
		const lignes = within(grille).getAllByRole('rowheader').map((entete) => entete.textContent)
		expect(lignes).toEqual(['Budget estimé', 'Origine du contact'])
	})

	it('ÉCARTE LE CHAMP ARCHIVÉ de la grille, et dit pourquoi', async () => {
		// §7 bis.11.2 : la liste des champs le rapporte pour le restaurer, la grille l'écarte parce
		// qu'il n'apparaît dans aucun formulaire. Ses règles ne sont pas supprimées pour autant.
		monter()
		await attendreEcran()
		const grille = await screen.findByTestId('grille-visibilites')
		expect(within(grille).queryByText('Note interne')).toBe(null)
		expect(screen.getByTestId('grille-note-archives').textContent).toContain(
			'Un champ archivé n’apparaît pas dans cette grille',
		)
	})

	it('rend le défaut sur les couples sans règle, et les visibilités écrites sur les autres', async () => {
		// §7 bis.11.2 et §3.1 du composeur : l'absence de règle vaut `visible`, et une composition
		// partant des règles perdrait ces cases.
		monter()
		await attendreEcran()
		const grille = await screen.findByTestId('grille-visibilites')
		const cases = within(grille).getAllByTestId('case-visibilite') as HTMLSelectElement[]
		expect(cases.map((liste) => [liste.dataset['champ'], liste.dataset['etape'], liste.value])).toEqual([
			['budget', 'e-1', 'defaut'],
			['budget', 'e-2', 'required'],
			['source', 'e-1', 'visible'],
			['source', 'e-2', 'defaut'],
		])
	})

	it('NE REPLIE PAS `visible` SUR LE DÉFAUT, et propose quatre états', async () => {
		// §7 bis.11.4 : le seed pose deux `visible` explicites ; les afficher comme des absences les
		// ferait supprimer au premier réglage voisin.
		monter()
		await attendreEcran()
		const grille = await screen.findByTestId('grille-visibilites')
		const premiere = within(grille).getAllByTestId('case-visibilite')[0] as HTMLSelectElement
		expect([...premiere.options].map((option) => option.textContent)).toEqual([
			'Par défaut',
			'Masqué',
			'Affiché',
			'Exigé',
		])
		expect(screen.getByTestId('grille-note-defaut').textContent).toContain('le même formulaire')
	})

	it('nomme le champ ET l’étape dans le libellé accessible de chaque case', async () => {
		// §7 bis.11.6 : sept colonnes de listes anonymes seraient indéchiffrables à la voix.
		monter()
		await attendreEcran()
		expect(
			await screen.findByLabelText('Visibilité de « Budget estimé » à l’étape « Qualification fine »'),
		).toBeTruthy()
	})

	it('RÈGLE UNE CASE PAR UN `upsert` portant le couple d’unicité', async () => {
		// §7 bis.11.3 : le `409`/`23505` mesuré interdit de choisir entre insertion et modification
		// d'après ce qu'on a lu.
		const { ecritures } = monter()
		await attendreEcran()
		const grille = await screen.findByTestId('grille-visibilites')
		const premiere = within(grille).getAllByTestId('case-visibilite')[0] as HTMLSelectElement
		await userEvent.selectOptions(premiere, 'hidden')
		await waitFor(() => expect(ecritures).toHaveLength(1))
		expect(ecritures[0]).toMatchObject({
			table: 'form_field_rules',
			verbe: 'upsert',
			charge: {
				field_id: 'c-1',
				step_id: 'e-1',
				workflow_id: 'wf-1',
				workspace_id: 'ws-1',
				visibility: 'hidden',
			},
			options: { onConflict: 'field_id,step_id' },
		})
	})

	it('REND UNE CASE AU DÉFAUT PAR UNE SUPPRESSION, filtrée sur le couple', async () => {
		const { ecritures } = monter()
		await attendreEcran()
		const grille = await screen.findByTestId('grille-visibilites')
		const deuxieme = within(grille).getAllByTestId('case-visibilite')[1] as HTMLSelectElement
		await userEvent.selectOptions(deuxieme, 'defaut')
		await waitFor(() => expect(ecritures).toHaveLength(1))
		expect(ecritures[0]).toMatchObject({ table: 'form_field_rules', verbe: 'delete', charge: null })
		expect(ecritures[0]?.filtres).toEqual([
			['field_id', 'c-1'],
			['step_id', 'e-2'],
		])
	})

	it('se règle au clavier seul', async () => {
		const { ecritures } = monter()
		await attendreEcran()
		const grille = await screen.findByTestId('grille-visibilites')
		const premiere = within(grille).getAllByTestId('case-visibilite')[0] as HTMLSelectElement
		premiere.focus()
		expect(document.activeElement).toBe(premiere)
		await userEvent.selectOptions(premiere, ['required'])
		await waitFor(() => expect(ecritures).toHaveLength(1))
		expect(ecritures[0]).toMatchObject({ verbe: 'upsert', charge: { visibility: 'required' } })
	})

	it('dit `sans-effet` quand la base rend zéro ligne — le `USING` d’un non-administrateur', async () => {
		// MESURÉ : le `business_developer` reçoit `200` et `[]` en `PATCH` comme en `DELETE`.
		monter({ reponseEcriture: { data: [], error: null, status: 200 } })
		await attendreEcran()
		const grille = await screen.findByTestId('grille-visibilites')
		const premiere = within(grille).getAllByTestId('case-visibilite')[0] as HTMLSelectElement
		await userEvent.selectOptions(premiere, 'hidden')
		expect(await screen.findByRole('alert')).toBeTruthy()
	})

	it('traduit le refus d’autorisation reçu de la base', async () => {
		monter({
			reponseEcriture: {
				data: null,
				error: { message: 'row-level security policy', code: '42501' },
				status: 403,
			},
		})
		await attendreEcran()
		const grille = await screen.findByTestId('grille-visibilites')
		const premiere = within(grille).getAllByTestId('case-visibilite')[0] as HTMLSelectElement
		await userEvent.selectOptions(premiere, 'hidden')
		expect(await screen.findByRole('alert')).toBeTruthy()
	})

	it('montre un état d’erreur repris quand les règles ne se chargent pas', async () => {
		monter({ erreurRegles: { message: 'boom', status: 500 } })
		await attendreEcran()
		expect(
			await screen.findByText('Les règles de visibilité n’ont pas pu être chargées.'),
		).toBeTruthy()
	})

	it('dit ce qui manque quand aucun champ actif n’existe, plutôt que d’afficher un tableau vide', async () => {
		monter({ champs: [CHAMPS[2]] })
		await attendreEcran()
		expect((await screen.findByTestId('grille-impossible')).textContent).toContain('Aucun champ actif')
	})
})
