// @verifies CRM-076 (docs/BACKLOG.md) — éditeur administrateur de workflows, première, deuxième,
//           troisième, quatrième et cinquième tranches
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
// @verifies docs/SPEC-workflow-engine.md §7 bis.12 (les exigences de transition), §7 bis.12.1
//           (lecture 7, émise avec les quatre autres), §7 bis.12.2 (l'union effective et ses
//           origines), §7 bis.12.3 (les deux gestes, sans `upsert`), §7 bis.12.4 (les choix
//           refusés), §7 bis.12.5 (les refus), §7 bis.12.6 (états et disposition)
// @verifies docs/SPEC-transition-required-fields.md §1 (l'union), §5.1 (la sixième garde)
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

/**
 * Une exigence explicite, et une seule : `tr-1` exige « Origine du contact ».
 *
 * Le couple est choisi pour que l'union du §7 bis.12.2 soit éprouvable en entier sur la seule arête
 * du jeu : « Budget estimé » y est exigé par la RÈGLE de l'étape d'arrivée `e-2`, « Origine du
 * contact » par la TRANSITION, et aucun des deux ne l'est par les deux — ce dernier cas a son
 * propre scénario, avec son propre jeu.
 */
const EXIGENCES = [{ transition_id: 'tr-1', field_id: 'c-2' }]

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
	readonly exigences?: unknown[]
	readonly catalogue?: unknown[]
	/** Lignes de la lecture 8 — les versions du workflow choisi (`CRM-078`, §7 ter.14.3). */
	readonly versions?: unknown[]
	/** Le workspace courant et les tracks affectables — `CRM-031`, §3 bis.3, lecture 4. */
	readonly workspaces?: unknown[]
	readonly tracks?: unknown[]
	readonly erreurTracks?: { message: string; status: number }
	readonly erreurWorkflows?: { message: string; status: number }
	readonly erreurTransitions?: { message: string; status: number }
	readonly erreurChamps?: { message: string; status: number }
	readonly erreurRegles?: { message: string; status: number }
	readonly erreurExigences?: { message: string; status: number }
	readonly reponseEcriture?: {
		data: unknown[] | null
		error: { message: string; code?: string } | null
		status: number
	}
	/** Réponse de `previsualiser_exigence` (§7 bis.13). Absente = un couple sans effet. */
	readonly previsualisation?: {
		data: unknown[] | null
		error: { message: string } | null
		status: number
	}
}

/** Le workspace courant — `CRM-031`, §3 bis.3 : il n'est pas saisi, il est lu. */
const WORKSPACES = [{ id: 'ws-1', name: 'P2Enjoy', slug: 'p2enjoy' }]

/** Les tracks affectables sous la portée `track` — §3 bis.3, lecture 4. */
const TRACKS = [
	{ id: 'tr-1', name: 'Conseil & IA' },
	{ id: 'tr-2', name: 'Studio web' },
]

/** Client factice : il rend les données voulues et **enregistre** les écritures reçues. */
function clientFactice(options: Options = {}): {
	client: ClientCrm
	ecritures: Ecriture[]
	lectures: string[]
	previsualisations: { nom: string; params: Record<string, unknown> }[]
} {
	const ecritures: Ecriture[] = []
	const lectures: string[] = []
	const previsualisations: { nom: string; params: Record<string, unknown> }[] = []
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
				if (table === 'workflow_transition_required_fields') {
					return lecture(options.exigences ?? EXIGENCES, options.erreurExigences)
				}
				// LECTURE 8, ajoutée par `CRM-078` (§7 ter.14.3). Elle est routée EXPLICITEMENT :
				// sans cette branche, la lecture des versions retombait sur le catalogue et
				// rendait des lignes sans colonne de version — un double qui ment sur la forme.
				if (table === 'workflow_versions') return lecture(options.versions ?? [])
				// Les deux lectures de la CRÉATION (`CRM-031`, §3 bis.3) sont routées explicitement,
				// pour la raison exacte qui a valu à `workflow_versions` de l'être : sans ces
				// branches, elles retombaient sur le catalogue et rendaient des nœuds là où l'écran
				// attend un workspace et des tracks.
				if (table === 'workspaces') return lecture(options.workspaces ?? WORKSPACES)
				if (table === 'tracks') return lecture(options.tracks ?? TRACKS, options.erreurTracks)
				return lecture(options.catalogue ?? CATALOGUE)
			},
			insert: (charge: Record<string, unknown>) => ecriture(table, 'insert', charge),
			update: (charge: Record<string, unknown>) => ecriture(table, 'update', charge),
			upsert: (charge: Record<string, unknown>, options?: Record<string, unknown>) =>
				ecriture(table, 'upsert', charge, options),
			delete: () => ecriture(table, 'delete', null),
		}),
		// `previsualiser_exigence` est la SEULE fonction que cet écran appelle (§7 bis.13.2). Le
		// défaut est un couple sans effet : une preuve qui ne parle pas de prévisualisation n'a pas
		// à déclarer de nombres, et « aucune affaire concernée » est la phrase la plus neutre.
		rpc: (nom: string, params: Record<string, unknown>) => {
			previsualisations.push({ nom, params })
			return Promise.resolve(
				options.previsualisation ?? {
					data: [{ sur_place: 0, a_l_entree: 0 }],
					error: null,
					status: 200,
				},
			)
		},
	} as unknown as ClientCrm

	return { client, ecritures, lectures, previsualisations }
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

	// PREUVE RÉVISÉE PAR LA SIXIÈME TRANCHE, NON SUPPRIMÉE (décision 390). Elle réglait la case sur
	// « Exigé » et attendait une écriture immédiate ; le §7 bis.13.4 fait désormais passer ce seul
	// état par une confirmation portant la prévisualisation. La RÈGLE prouvée est inchangée — une
	// case se règle au clavier seul —, et l'état retenu devient « Masqué », qui ne bloque aucune
	// affaire et reste donc immédiat. Le chemin « Exigé » au clavier a sa propre preuve plus bas.
	it('se règle au clavier seul', async () => {
		const { ecritures } = monter()
		await attendreEcran()
		const grille = await screen.findByTestId('grille-visibilites')
		const premiere = within(grille).getAllByTestId('case-visibilite')[0] as HTMLSelectElement
		premiere.focus()
		expect(document.activeElement).toBe(premiere)
		await userEvent.selectOptions(premiere, ['hidden'])
		await waitFor(() => expect(ecritures).toHaveLength(1))
		expect(ecritures[0]).toMatchObject({ verbe: 'upsert', charge: { visibility: 'hidden' } })
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

// ---------------------------------------------------------------------------------------------
// §7 bis.12 — Les exigences propres à une transition
// ---------------------------------------------------------------------------------------------

describe('les exigences de transition (§7 bis.12)', () => {
	it('est lu AVEC les quatre autres lectures, jamais séparément', async () => {
		// §7 bis.12.1 : une exigence n'a de sens qu'entre une arête et un champ du MÊME instant.
		const { lectures } = monter()
		await attendreEcran()
		await waitFor(() =>
			expect(lectures).toContain('workflow_transition_required_fields'),
		)
		expect(lectures.filter((table) => table === 'workflow_transition_required_fields')).toHaveLength(1)
	})

	it('réunit l’exigence venue de la RÈGLE et celle venue de la TRANSITION', async () => {
		// La sixième garde de `move_card` exige les deux (§7 bis.12.2). N'afficher que la table
		// écrirait « aucune exigence » là où la règle en impose déjà une.
		monter()
		await attendreEcran()
		const arete = await screen.findByTestId('transition-exigences')
		const lignes = within(arete).getAllByTestId('ligne-exigence')
		expect(lignes.map((ligne) => ligne.getAttribute('data-champ'))).toEqual(['budget', 'source'])
		expect(lignes.map((ligne) => ligne.getAttribute('data-origine'))).toEqual([
			'regle',
			'transition',
		])
	})

	it('n’offre AUCUNE commande de retrait sur une exigence venue d’une règle', async () => {
		// Un `DELETE` sur une ligne qui n'existe pas rendrait `200` et zéro ligne, l'exigence
		// restant imposée par `move_card`. L'écran renvoie à la grille plutôt que de le promettre.
		monter()
		await attendreEcran()
		const arete = await screen.findByTestId('transition-exigences')
		const parRegle = within(arete)
			.getAllByTestId('ligne-exigence')
			.find((ligne) => ligne.getAttribute('data-origine') === 'regle')
		expect(parRegle).toBeTruthy()
		expect(within(parRegle as HTMLElement).queryByRole('button')).toBeNull()
		// La phrase qui renvoie à la grille est rendue UNE fois pour l'arête, jamais par ligne :
		// répétée, elle occupait plus de place que les noms de champs (capture du 2026-08-15).
		expect(within(arete).getAllByTestId('exigences-note-regle')).toHaveLength(1)
	})

	it('garde la commande de retrait quand la règle ET la transition exigent le champ', async () => {
		monter({ exigences: [{ transition_id: 'tr-1', field_id: 'c-1' }] })
		await attendreEcran()
		const arete = await screen.findByTestId('transition-exigences')
		const ligne = within(arete).getAllByTestId('ligne-exigence')[0] as HTMLElement
		expect(ligne.getAttribute('data-origine')).toBe('les-deux')
		expect(within(ligne).getByRole('button')).toBeTruthy()
	})

	it('exige un champ par un `insert` SIMPLE, sans résolution de conflit', async () => {
		// MESURÉ : `resolution=merge-duplicates` rend `403`/`42501` faute du privilège `UPDATE`
		// (§7 bis.12.3). L'`upsert` de la grille est impossible ici.
		const { ecritures } = monter()
		await attendreEcran()
		const arete = await screen.findByTestId('transition-exigences')
		await userEvent.click(within(arete).getByRole('button', { name: 'Exiger un champ' }))
		const formulaire = await screen.findByTestId('formulaire-exigence')
		await userEvent.click(within(formulaire).getByRole('button', { name: 'Exiger ce champ' }))
		await waitFor(() => expect(ecritures).toHaveLength(1))
		expect(ecritures[0]).toMatchObject({
			table: 'workflow_transition_required_fields',
			verbe: 'insert',
			charge: { transition_id: 'tr-1', field_id: 'c-1' },
		})
		expect(ecritures[0]?.options).toBeUndefined()
	})

	it('ne propose ni le champ déjà lié ni le champ archivé', async () => {
		// §7 bis.12.4 : le premier serait refusé en `23505`, le second produirait une liaison sans
		// effet — les deux mesurés.
		monter()
		await attendreEcran()
		const arete = await screen.findByTestId('transition-exigences')
		await userEvent.click(within(arete).getByRole('button', { name: 'Exiger un champ' }))
		const formulaire = await screen.findByTestId('formulaire-exigence')
		const choix = within(formulaire).getByRole('combobox') as HTMLSelectElement
		expect([...choix.options].map((option) => option.textContent)).toEqual(['Budget estimé'])
	})

	it('dit ce qu’une liaison ajoute quand la règle exige déjà le champ', async () => {
		monter()
		await attendreEcran()
		const arete = await screen.findByTestId('transition-exigences')
		await userEvent.click(within(arete).getByRole('button', { name: 'Exiger un champ' }))
		expect(await screen.findByTestId('exigence-deja-par-regle')).toBeTruthy()
	})

	it('dit que les choix sont épuisés au lieu d’offrir une liste vide', async () => {
		monter({
			exigences: [
				{ transition_id: 'tr-1', field_id: 'c-1' },
				{ transition_id: 'tr-1', field_id: 'c-2' },
			],
		})
		await attendreEcran()
		const arete = await screen.findByTestId('transition-exigences')
		await userEvent.click(within(arete).getByRole('button', { name: 'Exiger un champ' }))
		expect((await screen.findByTestId('exigences-choix-epuises')).textContent).toContain(
			'déjà exigés',
		)
	})

	it('retire une exigence par le couple complet, après confirmation', async () => {
		const { ecritures } = monter()
		await attendreEcran()
		const arete = await screen.findByTestId('transition-exigences')
		const ligne = within(arete)
			.getAllByTestId('ligne-exigence')
			.find((item) => item.getAttribute('data-origine') === 'transition') as HTMLElement
		await userEvent.click(within(ligne).getByRole('button'))
		const confirmation = await screen.findByTestId('confirmation-retrait-exigence')
		await userEvent.click(within(confirmation).getByRole('button', { name: 'Ne plus exiger' }))
		await waitFor(() => expect(ecritures).toHaveLength(1))
		expect(ecritures[0]).toMatchObject({
			table: 'workflow_transition_required_fields',
			verbe: 'delete',
			charge: null,
		})
		expect(ecritures[0]?.filtres).toEqual([
			['transition_id', 'tr-1'],
			['field_id', 'c-2'],
		])
	})

	it('s’ajoute au clavier seul, sans jamais passer par la souris', async () => {
		const { ecritures } = monter()
		await attendreEcran()
		const arete = await screen.findByTestId('transition-exigences')
		const commande = within(arete).getByRole('button', { name: 'Exiger un champ' })
		commande.focus()
		await userEvent.keyboard('{Enter}')
		const formulaire = await screen.findByTestId('formulaire-exigence')
		// Le focus est posé sur la liste à l'ouverture : le §7 bis.12.6 l'exige, faute de quoi il
		// faudrait tabuler depuis le début du document pour atteindre le formulaire qu'on vient
		// d'ouvrir.
		expect(document.activeElement).toBe(within(formulaire).getByRole('combobox'))
		// La tabulation atteint la commande d'envoi, comme dans les deux parcours clavier des
		// tranches précédentes : `Entrée` depuis une liste déroulante n'envoie pas le formulaire.
		const exiger = within(formulaire).getByRole('button', { name: 'Exiger ce champ' })
		for (let pas = 0; pas < 8 && document.activeElement !== exiger; pas += 1) {
			await userEvent.tab()
		}
		expect(document.activeElement).toBe(exiger)
		await userEvent.keyboard('{Enter}')
		await waitFor(() => expect(ecritures).toHaveLength(1))
		expect(ecritures[0]?.verbe).toBe('insert')
	})

	it('nomme la liaison vers un champ archivé, qui ne produit aucun effet', async () => {
		monter({ exigences: [{ transition_id: 'tr-1', field_id: 'c-3' }] })
		await attendreEcran()
		const note = await screen.findByTestId('exigences-sans-effet')
		expect(note.textContent).toContain('sans effet')
	})

	it('traduit `23505` en « déjà exigé » plutôt qu’en échec incompréhensible', async () => {
		monter({
			reponseEcriture: {
				data: null,
				error: { message: 'duplicate key value', code: '23505' },
				status: 409,
			},
		})
		await attendreEcran()
		const arete = await screen.findByTestId('transition-exigences')
		await userEvent.click(within(arete).getByRole('button', { name: 'Exiger un champ' }))
		const formulaire = await screen.findByTestId('formulaire-exigence')
		await userEvent.click(within(formulaire).getByRole('button', { name: 'Exiger ce champ' }))
		expect((await screen.findByRole('alert')).textContent).toContain('déjà exigé')
	})

	it('dit `sans-effet` quand la base rend zéro ligne', async () => {
		monter({ reponseEcriture: { data: [], error: null, status: 200 } })
		await attendreEcran()
		const arete = await screen.findByTestId('transition-exigences')
		const ligne = within(arete)
			.getAllByTestId('ligne-exigence')
			.find((item) => item.getAttribute('data-origine') === 'transition') as HTMLElement
		await userEvent.click(within(ligne).getByRole('button'))
		const confirmation = await screen.findByTestId('confirmation-retrait-exigence')
		await userEvent.click(within(confirmation).getByRole('button', { name: 'Ne plus exiger' }))
		expect(await screen.findByRole('alert')).toBeTruthy()
	})

	it('montre un état d’erreur repris quand les exigences ne se chargent pas', async () => {
		monter({ erreurExigences: { message: 'boom', status: 500 } })
		await attendreEcran()
		expect(
			await screen.findByText('Les exigences des transitions n’ont pas pu être chargées.'),
		).toBeTruthy()
	})

	it('dit ce qui manque quand aucune transition n’est déclarée', async () => {
		monter({ transitions: [], exigences: [] })
		await attendreEcran()
		expect((await screen.findByTestId('exigences-sans-transition')).textContent).toContain(
			'Aucune transition déclarée',
		)
	})

	it('dit ce qui manque quand aucun champ actif n’existe', async () => {
		monter({ champs: [CHAMPS[2]], regles: [], exigences: [] })
		await attendreEcran()
		expect((await screen.findByTestId('exigences-sans-champ')).textContent).toContain(
			'Aucun champ actif',
		)
	})
})

// ---------------------------------------------------------------------------------------------
// §7 bis.13 — La prévisualisation des effets
// ---------------------------------------------------------------------------------------------
//
// @verifies CRM-076 (docs/BACKLOG.md) — sixième tranche : la prévisualisation des effets
// @verifies docs/SPEC-workflow-engine.md §7 bis.13.4 (ce que l'écran en fait : confirmation sur le
//           seul état bloquant, renoncement sans écriture, compte dans le formulaire d'exigence,
//           zéro dit en toutes lettres, échec non bloquant)

describe('la prévisualisation des effets (§7 bis.13)', () => {
	/** Règle la première case sur « Exigé » et rend la grille. */
	async function viserExige(options: Options = {}) {
		const factice = monter(options)
		await attendreEcran()
		const grille = await screen.findByTestId('grille-visibilites')
		const premiere = within(grille).getAllByTestId('case-visibilite')[0] as HTMLSelectElement
		await userEvent.selectOptions(premiere, 'required')
		return { ...factice, premiere }
	}

	it('N’ÉCRIT RIEN sur « Exigé » : elle demande d’abord ce que cela ferait', async () => {
		const { ecritures, previsualisations } = await viserExige({
			previsualisation: { data: [{ sur_place: 4, a_l_entree: 0 }], error: null, status: 200 },
		})
		expect(await screen.findByTestId('confirmation-exigence-case')).toBeTruthy()
		expect(ecritures).toHaveLength(0)
		expect(previsualisations).toEqual([
			{ nom: 'previsualiser_exigence', params: { p_field_id: 'c-1', p_step_id: 'e-1' } },
		])
	})

	it('laisse les TROIS AUTRES ÉTATS immédiats : eux ne bloquent aucune affaire', async () => {
		// Le contraire aurait imposé une confirmation à quarante-deux cases dont aucune ne contraint
		// personne, et rendu la grille inutilisable (§7 bis.13.4).
		const { ecritures, previsualisations } = monter()
		await attendreEcran()
		const grille = await screen.findByTestId('grille-visibilites')
		const premiere = within(grille).getAllByTestId('case-visibilite')[0] as HTMLSelectElement
		await userEvent.selectOptions(premiere, 'visible')
		await waitFor(() => expect(ecritures).toHaveLength(1))
		expect(screen.queryByTestId('confirmation-exigence-case')).toBe(null)
		expect(previsualisations).toHaveLength(0)
	})

	it('montre le choix EN COURS dans la case, et non l’état enregistré', async () => {
		// Sans cette surcharge, la case reviendrait à son état d'avant et démentirait la
		// confirmation affichée juste en dessous.
		const { premiere } = await viserExige()
		await screen.findByTestId('confirmation-exigence-case')
		expect(premiere.value).toBe('required')
	})

	it('RENONCER n’écrit rien et rend la case à sa valeur enregistrée', async () => {
		const { ecritures, premiere } = await viserExige()
		await screen.findByTestId('confirmation-exigence-case')
		await userEvent.click(screen.getByRole('button', { name: 'Annuler' }))
		await waitFor(() => expect(screen.queryByTestId('confirmation-exigence-case')).toBe(null))
		expect(ecritures).toHaveLength(0)
		expect(premiere.value).toBe('defaut')
	})

	it('CONFIRMER écrit la règle « Exigé », et alors seulement', async () => {
		const { ecritures } = await viserExige()
		await screen.findByTestId('confirmation-exigence-case')
		await userEvent.click(screen.getByRole('button', { name: 'Exiger ce champ' }))
		await waitFor(() => expect(ecritures).toHaveLength(1))
		expect(ecritures[0]).toMatchObject({
			table: 'form_field_rules',
			verbe: 'upsert',
			charge: { field_id: 'c-1', step_id: 'e-1', visibility: 'required' },
		})
	})

	it('mène le chemin « Exigé » AU CLAVIER SEUL, du choix à la confirmation', async () => {
		const { ecritures } = monter()
		await attendreEcran()
		const grille = await screen.findByTestId('grille-visibilites')
		const premiere = within(grille).getAllByTestId('case-visibilite')[0] as HTMLSelectElement
		premiere.focus()
		await userEvent.selectOptions(premiere, ['required'])
		// Le focus entre dans la confirmation : le bouton d'action est atteint sans souris (§5.13).
		const action = await screen.findByRole('button', { name: 'Exiger ce champ' })
		await waitFor(() => expect(document.activeElement).toBe(action))
		await userEvent.keyboard('{Enter}')
		await waitFor(() => expect(ecritures).toHaveLength(1))
	})

	it('dit les DEUX NOMBRES quand les deux existent, et jamais un seul', async () => {
		// Mesuré sur le seed pour `date-signature-prevue` × `Perdu` : 1 sur place, 8 à l'entrée.
		await viserExige({
			previsualisation: { data: [{ sur_place: 1, a_l_entree: 8 }], error: null, status: 200 },
		})
		const effets = await screen.findByTestId('effets-case')
		expect(effets.textContent).toContain('1 affaire est déjà à cette étape')
		expect(effets.textContent).toContain('8 affaires ne pourront plus entrer')
	})

	it('DIT ZÉRO EN TOUTES LETTRES, jamais par un silence', async () => {
		await viserExige({
			previsualisation: { data: [{ sur_place: 0, a_l_entree: 0 }], error: null, status: 200 },
		})
		const effets = await screen.findByTestId('effets-case')
		expect(effets.textContent).toContain('Aucune affaire en cours n’est concernée.')
	})

	it('un échec de mesure NE BLOQUE PAS le geste, et le dit', async () => {
		// Le compte est une aide à la décision, jamais une garde : la garde est `move_card`.
		const { ecritures } = await viserExige({
			previsualisation: { data: null, error: { message: 'refus' }, status: 500 },
		})
		const effets = await screen.findByTestId('effets-case')
		expect(effets.textContent).toContain('n’ont pas pu être mesurés')
		await userEvent.click(screen.getByRole('button', { name: 'Exiger ce champ' }))
		await waitFor(() => expect(ecritures).toHaveLength(1))
	})

	it('NE MESURE QU’UNE FOIS par champ choisi : le formulaire ouvert ne boucle pas', async () => {
		// DÉFAUT MESURÉ ET CORRIGÉ LE 2026-08-15 (décision 390). L'effet du formulaire dépendait de la
		// callback du parent, construite dans une boucle sur les arêtes et donc recréée à chaque
		// rendu : il se rejouait à chaque rendu, chaque mesure provoquait un rendu de plus, et les
		// appels RPC partaient sans fin. Cette preuve ÉCHOUE avant le correctif — le compte croît
		// indéfiniment — et fixe la propriété : une mesure par champ choisi, pas une par rendu.
		const { previsualisations } = monter()
		await attendreEcran()
		const boutons = await screen.findAllByRole('button', { name: 'Exiger un champ' })
		await userEvent.click(boutons[0] as HTMLElement)
		await screen.findByTestId('effets-exigence')
		const apresOuverture = previsualisations.length
		expect(apresOuverture).toBe(1)
		// Laisse largement le temps à une boucle de se manifester.
		await new Promise((resoudre) => setTimeout(resoudre, 150))
		expect(previsualisations).toHaveLength(apresOuverture)
	})

	it('mesure aussi le champ proposé d’office dans le formulaire d’exigence d’une transition', async () => {
		// Sans cela, le champ que validera un administrateur pressé serait le seul dont l'effet
		// resterait inconnu.
		const { previsualisations } = monter({
			previsualisation: { data: [{ sur_place: 0, a_l_entree: 4 }], error: null, status: 200 },
		})
		await attendreEcran()
		const boutons = await screen.findAllByRole('button', { name: 'Exiger un champ' })
		await userEvent.click(boutons[0] as HTMLElement)
		const effets = await screen.findByTestId('effets-exigence')
		expect(effets.textContent).toContain('4 affaires ne pourront plus emprunter ce chemin')
		expect(previsualisations[0]?.params).toHaveProperty('p_transition_id')
		expect(previsualisations[0]?.params).not.toHaveProperty('p_step_id')
	})
})

// ---------------------------------------------------------------------------------------------
// La création d'un workflow — CRM-031, docs/SPEC-workflow-engine.md §3 bis
// ---------------------------------------------------------------------------------------------
//
// @verifies CRM-031 (docs/BACKLOG.md) — création d'un workflow depuis l'éditeur d'administration
// @verifies docs/SPEC-workflow-engine.md §3 bis.2 (le geste rendu deux fois, dont l'état vide),
//           §3 bis.3 (les trois champs, la lecture 4 à l'ouverture), §3 bis.4 (validation de
//           forme), §3 bis.5 (les refus traduits), §3 bis.6 (les trois effets d'un succès),
//           §3 bis.8 (preuves attendues, niveau composant)
// @verifies docs/DESIGN_SYSTEM.md §5.15 (la création d'un workflow : le sélecteur absent et non
//           grisé, aucune case « par défaut », la liste relue)
//
// L'ÉTAT VIDE EST LA PREUVE QUE SEUL CE NIVEAU PEUT RENDRE. La table du seed n'est jamais vide —
// le workspace y porte deux workflows —, et la vider pour un scénario E2E casserait toutes les
// autres suites. C'est écrit au §3 bis.8, et c'est pourquoi ce cas vit ici.

describe('la création d’un workflow (§3 bis)', () => {
	it('l’état vide PORTE le geste : sans lui, un workspace neuf est un cul-de-sac', async () => {
		monter({ workflows: [] })
		expect(await screen.findByTestId('etat-vide')).toBeTruthy()
		const commande = screen.getByRole('button', { name: 'Nouveau workflow' })
		await userEvent.click(commande)
		expect(await screen.findByTestId('workflows-formulaire-creation')).toBeTruthy()
	})

	it('la liste peuplée porte le même geste, au-dessus d’elle', async () => {
		monter()
		await attendreEcran()
		await userEvent.click(screen.getByRole('button', { name: 'Nouveau workflow' }))
		expect(await screen.findByTestId('workflows-formulaire-creation')).toBeTruthy()
	})

	it('les tracks ne sont PAS lus tant que le formulaire n’est pas ouvert', async () => {
		const { lectures } = monter()
		await attendreEcran()
		expect(lectures).not.toContain('tracks')
		await userEvent.click(screen.getByRole('button', { name: 'Nouveau workflow' }))
		await screen.findByTestId('workflows-formulaire-creation')
		await waitFor(() => expect(lectures).toContain('tracks'))
	})

	it('le sélecteur de track est ABSENT sous la portée globale, et apparaît sous la portée track', async () => {
		monter()
		await attendreEcran()
		await userEvent.click(screen.getByRole('button', { name: 'Nouveau workflow' }))
		const formulaire = await screen.findByTestId('workflows-formulaire-creation')
		// Absent, et non désactivé : `docs/DESIGN_SYSTEM.md` §5.15.
		expect(within(formulaire).queryByLabelText('Track')).toBeNull()
		await userEvent.selectOptions(within(formulaire).getByLabelText('Portée'), 'track')
		expect(await within(formulaire).findByLabelText('Track')).toBeTruthy()
	})

	it('la commande reste éteinte tant que le nom est vide, puis s’allume', async () => {
		monter()
		await attendreEcran()
		await userEvent.click(screen.getByRole('button', { name: 'Nouveau workflow' }))
		const formulaire = await screen.findByTestId('workflows-formulaire-creation')
		const creer = within(formulaire).getByRole('button', { name: 'Créer' })
		expect(creer.hasAttribute('disabled')).toBe(true)
		await userEvent.type(within(formulaire).getByLabelText('Nom'), 'Cycle neuf')
		expect(creer.hasAttribute('disabled')).toBe(false)
	})

	it('la portée `track` sans track choisi éteint la commande — la seconde condition du §3 bis.4', async () => {
		monter()
		await attendreEcran()
		await userEvent.click(screen.getByRole('button', { name: 'Nouveau workflow' }))
		const formulaire = await screen.findByTestId('workflows-formulaire-creation')
		await userEvent.type(within(formulaire).getByLabelText('Nom'), 'Cycle du track')
		await userEvent.selectOptions(within(formulaire).getByLabelText('Portée'), 'track')
		const creer = within(formulaire).getByRole('button', { name: 'Créer' })
		expect(creer.hasAttribute('disabled')).toBe(true)
		await userEvent.selectOptions(await within(formulaire).findByLabelText('Track'), 'tr-2')
		expect(creer.hasAttribute('disabled')).toBe(false)
	})

	it('l’envoi insère dans `workflows`, sans `is_default` et sans `track_id` sous la portée globale', async () => {
		const { ecritures } = monter()
		await attendreEcran()
		await userEvent.click(screen.getByRole('button', { name: 'Nouveau workflow' }))
		const formulaire = await screen.findByTestId('workflows-formulaire-creation')
		await userEvent.type(within(formulaire).getByLabelText('Nom'), 'Cycle neuf')
		await userEvent.click(within(formulaire).getByRole('button', { name: 'Créer' }))
		await waitFor(() => expect(ecritures.some((e) => e.table === 'workflows')).toBe(true))
		const ecrite = ecritures.find((e) => e.table === 'workflows')
		expect(ecrite?.verbe).toBe('insert')
		expect(ecrite?.charge).toEqual({
			workspace_id: 'ws-1',
			name: 'Cycle neuf',
			scope: 'global',
			track_id: null,
		})
	})

	it('aucune case « par défaut » n’est offerte — elle échouerait en 23505 (§3 bis.1)', async () => {
		monter()
		await attendreEcran()
		await userEvent.click(screen.getByRole('button', { name: 'Nouveau workflow' }))
		const formulaire = await screen.findByTestId('workflows-formulaire-creation')
		expect(within(formulaire).queryByRole('checkbox')).toBeNull()
	})

	it('un succès referme le formulaire et RELIT la liste (§3 bis.6)', async () => {
		const { lectures } = monter({ reponseEcriture: { data: [{ id: 'wf-2' }], error: null, status: 201 } })
		await attendreEcran()
		const avant = lectures.filter((table) => table === 'workflows').length
		await userEvent.click(screen.getByRole('button', { name: 'Nouveau workflow' }))
		const formulaire = await screen.findByTestId('workflows-formulaire-creation')
		await userEvent.type(within(formulaire).getByLabelText('Nom'), 'Cycle neuf')
		await userEvent.click(within(formulaire).getByRole('button', { name: 'Créer' }))
		await waitFor(() => expect(screen.queryByTestId('workflows-formulaire-creation')).toBeNull())
		// La relecture est la seule chose qui prouve que la ligne existe côté base : une insertion
		// optimiste afficherait un workflow que personne n'a relu.
		await waitFor(() =>
			expect(lectures.filter((table) => table === 'workflows').length).toBeGreaterThan(avant),
		)
	})

	it('un refus 42501 est NOMMÉ dans le formulaire, qui reste ouvert', async () => {
		monter({
			reponseEcriture: {
				data: null,
				error: { message: 'row-level security', code: '42501' },
				status: 403,
			},
		})
		await attendreEcran()
		await userEvent.click(screen.getByRole('button', { name: 'Nouveau workflow' }))
		const formulaire = await screen.findByTestId('workflows-formulaire-creation')
		await userEvent.type(within(formulaire).getByLabelText('Nom'), 'Cycle refusé')
		await userEvent.click(within(formulaire).getByRole('button', { name: 'Créer' }))
		const alerte = await within(formulaire).findByRole('alert')
		expect(alerte.textContent).toContain("Vous n'avez pas le droit de créer un workflow")
		expect(screen.getByTestId('workflows-formulaire-creation')).toBeTruthy()
	})

	it('un workspace sans track NOMME l’absence au lieu d’offrir une liste vide', async () => {
		monter({ tracks: [] })
		await attendreEcran()
		await userEvent.click(screen.getByRole('button', { name: 'Nouveau workflow' }))
		const formulaire = await screen.findByTestId('workflows-formulaire-creation')
		await userEvent.selectOptions(within(formulaire).getByLabelText('Portée'), 'track')
		expect(await screen.findByTestId('workflows-sans-track')).toBeTruthy()
	})
})
