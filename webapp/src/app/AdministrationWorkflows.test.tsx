// @verifies CRM-076 (docs/BACKLOG.md) — éditeur administrateur de workflows, première et deuxième
//           tranches
// @verifies docs/SPEC-workflow-engine.md §7 bis.3 (les lectures et le catalogue à la demande),
//           §7 bis.4 (les six gestes et leurs écritures), §7 bis.5 (validation de forme, `0`
//           accepté), §7 bis.6 (états, clavier), §2.5 (`0` n'est pas `NULL`), §3.3 (libellé
//           surchargé), §3.5 (éteindre avant d'allumer)
// @verifies docs/SPEC-workflow-engine.md §7 bis.9 (les arêtes du graphe), §7 bis.9.1 (les deux
//           lectures ensemble), §7 bis.9.2 (les trois gestes), §7 bis.9.3 (les choix offerts),
//           §7 bis.9.6 (états et disposition), §3.4 (modèle des arêtes)
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
	readonly catalogue?: unknown[]
	readonly erreurWorkflows?: { message: string; status: number }
	readonly erreurTransitions?: { message: string; status: number }
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
				if (table === 'workflow_transitions') {
					return lecture(options.transitions ?? TRANSITIONS, options.erreurTransitions)
				}
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
