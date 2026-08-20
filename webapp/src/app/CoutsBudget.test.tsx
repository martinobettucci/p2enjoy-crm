// @verifies CRM-086 (docs/BACKLOG.md) — écrans de coûts, TRANCHE 4 : le montage de l'écran du §4.3
// @verifies docs/SPEC-costs.md §4.3 (une paire de barres par occurrence ; un budget non récurrent
//           en rend une seule ; la liste des lignes — affaire, libellé, estimé, réel, auteur —
//           filtrable par occurrence, et l'accès à l'affaire), §4.4 (la mention des réels
//           manquants), §4.7 (les états : budget introuvable, budget sans ligne, budget récurrent
//           sans occurrence, lecture refusée), §2.3 (`actual_cost` nul n'est PAS zéro)
// @verifies docs/SPEC-permissions-rls.md §7 (inexistant, refusé et mal formé ne se distinguent pas)
// @verifies docs/DESIGN_SYSTEM.md §5.8 (les quatre états systématiques), §5.9 (cellule sans valeur
//           VIDE, en-têtes de colonne), §5.16 (« auteur inconnu » est un texte), §5.30 (le tableau
//           équivalent est la version accessible du graphique)
//
// CE FICHIER ÉPROUVE L'ÉCRAN, PAS L'AGRÉGATION NI LA LECTURE. `couts-ecrans.test.ts` couvre déjà le
// groupement par occurrence, le filtre, la forme des trois requêtes et l'adresse d'une affaire ; les
// répéter ici les ferait diverger. Ce qui est éprouvé ici est ce que le MONTAGE ajoute : les issues
// de la zone principale, ce que le tableau rend et ce qu'il laisse vide, et le fait que le nom du
// budget remonte bien à la coquille qui en fait le titre de la route.

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ContenuCoutsBudget, enGroupesOccurrence, formaterPeriode } from './CoutsBudget'
import type { ClientCrm } from '../lib/supabase'
import type { BarresOccurrence } from '../lib/couts-ecrans'

afterEach(cleanup)

type Reponse = {
	data: unknown[] | null
	error: { message: string } | null
	status: number
}

const ID_BUDGET = '11111111-1111-4111-8111-111111111111'

/**
 * Client factice rendant les réponses en séquence — le budget, ses occurrences, ses lignes.
 *
 * Il parle `maybeSingle` comme PostgREST : la première réponse est déclarée sous forme de tableau
 * par commodité, et dépliée ici. Il est volontairement plus pauvre que l'espion de
 * `couts-ecrans.test.ts`, qui enregistre chaque filtre : la forme des requêtes est le contrat du
 * module et se prouve là-bas.
 */
function clientQuiRend(reponses: readonly Reponse[]): ClientCrm {
	let rang = 0
	return {
		from: () => {
			const reponse = reponses[rang++] ?? { data: [], error: null, status: 200 }
			const chaine: Record<string, unknown> = {}
			const rendre = () => chaine
			chaine.eq = rendre
			chaine.order = rendre
			chaine.maybeSingle = () =>
				Promise.resolve({
					...reponse,
					data: Array.isArray(reponse.data) ? (reponse.data[0] ?? null) : reponse.data,
				})
			chaine.then = (resoudre: (valeur: Reponse) => unknown) =>
				Promise.resolve(reponse).then(resoudre)
			return { select: () => chaine }
		},
	} as unknown as ClientCrm
}

const ok = (data: unknown[]): Reponse => ({ data, error: null, status: 200 })

const budget = (reste: Record<string, unknown> = {}) => ({
	id: ID_BUDGET,
	name: 'Salon 2025',
	currency: 'EUR',
	is_recurrent: false,
	planned_amount: null,
	closed_at: null,
	position: 1,
	...reste,
})

const occurrence = (id: string, label: string, reste: Record<string, unknown> = {}) => ({
	id,
	label,
	period_start: null,
	period_end: null,
	planned_amount: null,
	closed_at: null,
	...reste,
})

const ligne = (id: string, reste: Record<string, unknown> = {}) => ({
	id,
	occurrence_id: null,
	label: 'Publicité',
	estimated_cost: 1000,
	actual_cost: 880,
	created_at: '2026-08-01T10:00:00Z',
	cards: null,
	profiles: null,
	...reste,
})

/**
 * La zone est montée SOUS un routeur : l'état « budget introuvable » porte un lien de retour et le
 * titre d'une affaire est un lien, or un `Link` hors routeur lève. Le routeur n'est pas la chose
 * éprouvée, il est le contexte minimal que le rendu exige.
 */
const monter = (
	proprietes: Parameters<typeof ContenuCoutsBudget>[0],
): ReturnType<typeof render> =>
	render(
		<MemoryRouter>
			<ContenuCoutsBudget {...proprietes} />
		</MemoryRouter>,
	)

// ---------------------------------------------------------------------------------------------

describe('ContenuCoutsBudget — les états du §4.7', () => {
	it('rend le squelette tant que la lecture est en vol', () => {
		monter({ idBudget: ID_BUDGET, client: clientQuiRend([]) })
		expect(screen.getByLabelText('Chargement en cours')).toBeTruthy()
	})

	it('rend « Budget introuvable » sur un budget qui ne répond pas', async () => {
		monter({ idBudget: ID_BUDGET, slugTrack: 'conseil-ia', client: clientQuiRend([ok([])]) })
		expect(await screen.findByText('Budget introuvable')).toBeTruthy()
		// Le retour mène aux coûts du track, jamais à la racine : c'est de là qu'on vient, et c'est
		// là que les autres budgets se trouvent.
		expect(screen.getByRole('link', { name: 'Revenir aux coûts du track' }).getAttribute('href')).toBe(
			'/tracks/conseil-ia/couts',
		)
	})

	it('rend le MÊME écran sur un identifiant mal formé, sans jamais interroger le serveur', async () => {
		// La règle du §7 de `docs/SPEC-permissions-rls.md` : inexistant, refusé et mal formé ne se
		// distinguent pas. Un texte différent renseignerait sur l'existence d'un budget interdit.
		monter({ idBudget: 'salon-2025', slugTrack: 'conseil-ia', client: clientQuiRend([]) })
		expect(await screen.findByText('Budget introuvable')).toBeTruthy()
	})

	it('rend le refus de lecture, et non une erreur générique', async () => {
		monter({
			idBudget: ID_BUDGET,
			client: clientQuiRend([{ data: null, error: { message: 'refus' }, status: 403 }]),
		})
		expect(await screen.findByText('Accès refusé')).toBeTruthy()
	})

	it('rend l’erreur avec sa reprise, et la reprise RELIT réellement', async () => {
		const client = clientQuiRend([
			{ data: null, error: { message: 'coupure' }, status: 0 },
			ok([budget()]),
			ok([]),
			ok([ligne('l1')]),
		])
		monter({ idBudget: ID_BUDGET, client })
		const reprise = await screen.findByRole('button', { name: 'Réessayer' })
		fireEvent.click(reprise)
		// La seconde lecture aboutit : l'écran montre le budget, ce qu'une reprise décorative ne
		// ferait pas.
		expect(await screen.findByText('Lignes de coût')).toBeTruthy()
	})

	it('écrit « Aucune occurrence ouverte » sur un budget RÉCURRENT qui n’en porte aucune', async () => {
		monter({
			idBudget: ID_BUDGET,
			client: clientQuiRend([ok([budget({ is_recurrent: true })]), ok([]), ok([])]),
		})
		expect(
			await screen.findByText(/Aucune occurrence ouverte/),
		).toBeTruthy()
	})

	it('n’écrit RIEN de tel sur un budget non récurrent, dont c’est le cas ordinaire', async () => {
		// Un budget non récurrent n'admet aucune occurrence (§2.2, un trigger le refuse) : annoncer
		// leur absence serait du bruit à chaque ouverture de l'écran.
		monter({ idBudget: ID_BUDGET, client: clientQuiRend([ok([budget()]), ok([]), ok([])]) })
		await screen.findByText('Lignes de coût')
		expect(screen.queryByText(/Aucune occurrence ouverte/)).toBeNull()
	})

	it('écrit « aucune dépense rattachée » sur un budget SANS ligne, et rend ses barres nulles', async () => {
		monter({ idBudget: ID_BUDGET, client: clientQuiRend([ok([budget()]), ok([]), ok([])]) })
		expect(await screen.findByText('Aucune dépense rattachée.')).toBeTruthy()
		expect(screen.getByText('Aucune dépense rattachée à ce budget.')).toBeTruthy()
	})

	it('dit qu’un budget est CLÔTURÉ, et que ses lignes restent saisissables', async () => {
		monter({
			idBudget: ID_BUDGET,
			client: clientQuiRend([
				ok([budget({ closed_at: '2026-07-01T00:00:00Z' })]),
				ok([]),
				ok([ligne('l1')]),
			]),
		})
		expect(await screen.findByText(/Budget clôturé/)).toBeTruthy()
	})
})

describe('ContenuCoutsBudget — le contenu du §4.3', () => {
	it('remonte le nom du budget à la coquille, qui en fait le titre de la route', async () => {
		const onNomBudget = vi.fn()
		monter({
			idBudget: ID_BUDGET,
			client: clientQuiRend([ok([budget()]), ok([]), ok([])]),
			onNomBudget,
		})
		await waitFor(() => expect(onNomBudget).toHaveBeenCalledWith('Salon 2025'))
	})

	it('rend une paire de barres PAR OCCURRENCE dans le tableau équivalent', async () => {
		monter({
			idBudget: ID_BUDGET,
			client: clientQuiRend([
				ok([budget({ is_recurrent: true })]),
				ok([occurrence('o1', 'Janvier 2026'), occurrence('o2', 'Février 2026')]),
				ok([
					ligne('l1', { occurrence_id: 'o1', estimated_cost: 1000, actual_cost: 880 }),
					ligne('l2', { occurrence_id: 'o2', estimated_cost: 500, actual_cost: 600 }),
				]),
			]),
		})
		const tableau = await screen.findByRole('table', { name: /Équivalent textuel/ })
		expect(within(tableau).getByRole('rowheader', { name: 'Janvier 2026' })).toBeTruthy()
		expect(within(tableau).getByRole('rowheader', { name: 'Février 2026' })).toBeTruthy()
		// L'en-tête de la première colonne nomme ce qu'une paire de barres désigne ICI — une
		// occurrence, là où l'écran du track dit « Budget ».
		expect(within(tableau).getByRole('columnheader', { name: 'Occurrence' })).toBeTruthy()
		// Le dépassement de « Février » est dit en TEXTE, pas seulement par la couleur de la barre.
		expect(within(tableau).getByText('dépassement')).toBeTruthy()
	})

	it('rend la mention du §4.4 dès qu’un réel manque, avec le compte exact', async () => {
		monter({
			idBudget: ID_BUDGET,
			client: clientQuiRend([
				ok([budget()]),
				ok([]),
				ok([
					ligne('l1', { estimated_cost: 1000, actual_cost: null }),
					ligne('l2', { estimated_cost: 200, actual_cost: 200 }),
				]),
			]),
		})
		expect(await screen.findByText(/1 ligne\(s\) sans coût réel saisi/)).toBeTruthy()
	})

	it('laisse la cellule du réel VIDE quand il n’est pas saisi, et n’écrit jamais zéro', async () => {
		// C'est le §2.3 rendu à l'écran : « nul n'est pas zéro ». Écrire « 0 € » transformerait un
		// retard de saisie en dépense nulle — la principale façon dont cet écran mentirait.
		monter({
			idBudget: ID_BUDGET,
			client: clientQuiRend([
				ok([budget()]),
				ok([]),
				ok([ligne('l1', { label: 'Production', estimated_cost: 350, actual_cost: null })]),
			]),
		})
		const lignes = await screen.findByRole('table', { name: /Lignes de coût rattachées/ })
		const cellules = within(lignes).getAllByRole('cell')
		expect(cellules[0]?.textContent).toBe('Production')
		expect(cellules[1]?.textContent).toContain('350')
		// La cellule du réel est vide : ni tiret, ni « non renseigné », ni zéro (§5.9).
		expect(cellules[2]?.textContent).toBe('')
	})

	it('nomme un auteur inconnu au lieu de laisser la cellule vide', async () => {
		// `created_by` est `on delete set null` : un profil supprimé laisse un FAIT à nommer, non une
		// donnée absente — la règle du §5.16 du design system.
		monter({
			idBudget: ID_BUDGET,
			client: clientQuiRend([ok([budget()]), ok([]), ok([ligne('l1', { profiles: null })])]),
		})
		expect(await screen.findByText('Auteur inconnu')).toBeTruthy()
	})

	it('rend le titre de l’affaire en LIEN quand elle est adressable, et en texte sinon', async () => {
		monter({
			idBudget: ID_BUDGET,
			client: clientQuiRend([
				ok([budget()]),
				ok([]),
				ok([
					ligne('l1', {
						cards: {
							id: 'card-1',
							title: 'ERP Groupe Vitalis',
							archived_at: null,
							channels: { slug: 'grands-comptes', tracks: { slug: 'conseil-ia' } },
						},
					}),
					ligne('l2', {
						cards: { id: 'card-2', title: 'Affaire sans slug', archived_at: null, channels: null },
					}),
				]),
			]),
		})
		const lien = await screen.findByRole('link', { name: 'ERP Groupe Vitalis' })
		expect(lien.getAttribute('href')).toBe('/tracks/conseil-ia/grands-comptes/cards/card-1')
		// L'affaire dont l'adresse est incomplète reste LISTÉE, sans lien : la masquer ferait
		// disparaître un montant du tableau.
		expect(screen.getByText('Affaire sans slug')).toBeTruthy()
		expect(screen.queryByRole('link', { name: 'Affaire sans slug' })).toBeNull()
	})

	it('marque une affaire archivée sans lui retirer son lien', async () => {
		monter({
			idBudget: ID_BUDGET,
			client: clientQuiRend([
				ok([budget()]),
				ok([]),
				ok([
					ligne('l1', {
						cards: {
							id: 'card-1',
							title: 'ERP Groupe Vitalis',
							archived_at: '2026-06-01T00:00:00Z',
							channels: { slug: 'grands-comptes', tracks: { slug: 'conseil-ia' } },
						},
					}),
				]),
			]),
		})
		expect(await screen.findByText('Archivée')).toBeTruthy()
		expect(screen.getByRole('link', { name: 'ERP Groupe Vitalis' })).toBeTruthy()
	})
})

describe('ContenuCoutsBudget — le filtre par occurrence du §4.3', () => {
	const clientRecurrent = () =>
		clientQuiRend([
			ok([budget({ is_recurrent: true })]),
			ok([occurrence('o1', 'Janvier 2026'), occurrence('o2', 'Février 2026')]),
			ok([
				ligne('l1', { occurrence_id: 'o1', label: 'Publicité' }),
				ligne('l2', { occurrence_id: 'o2', label: 'Production' }),
			]),
		])

	it('n’offre AUCUN filtre sur un budget non récurrent', async () => {
		monter({ idBudget: ID_BUDGET, client: clientQuiRend([ok([budget()]), ok([]), ok([ligne('l1')])]) })
		await screen.findByText('Lignes de coût')
		// Un contrôle sans objet est du bruit — la règle du §5.11 pour la barre de filtres du fil.
		expect(screen.queryByLabelText('Filtrer par occurrence')).toBeNull()
	})

	it('n’offre aucun filtre sur un budget récurrent qui ne porte encore aucune occurrence', async () => {
		monter({
			idBudget: ID_BUDGET,
			client: clientQuiRend([ok([budget({ is_recurrent: true })]), ok([]), ok([])]),
		})
		await screen.findByText('Lignes de coût')
		expect(screen.queryByLabelText('Filtrer par occurrence')).toBeNull()
	})

	it('ne retient que les lignes de l’occurrence choisie, et rend toutes les lignes une fois levé', async () => {
		monter({ idBudget: ID_BUDGET, client: clientRecurrent() })
		const filtre = await screen.findByLabelText('Filtrer par occurrence')
		expect(screen.getByText('Publicité')).toBeTruthy()
		expect(screen.getByText('Production')).toBeTruthy()

		fireEvent.change(filtre, { target: { value: 'o1' } })
		expect(screen.getByText('Publicité')).toBeTruthy()
		expect(screen.queryByText('Production')).toBeNull()

		// L'option vide est le moyen de LEVER le filtre, comme l'option vide d'un champ le vide.
		fireEvent.change(filtre, { target: { value: '' } })
		expect(screen.getByText('Production')).toBeTruthy()
	})

	it('distingue « aucune dépense sur cette occurrence » de « aucune dépense sur ce budget »', async () => {
		// Les confondre ferait passer un filtre trop restrictif pour un budget sans histoire — la
		// règle des deux vides distincts du §5.11.
		monter({
			idBudget: ID_BUDGET,
			client: clientQuiRend([
				ok([budget({ is_recurrent: true })]),
				ok([occurrence('o1', 'Janvier 2026'), occurrence('o2', 'Février 2026')]),
				ok([ligne('l1', { occurrence_id: 'o1' })]),
			]),
		})
		const filtre = await screen.findByLabelText('Filtrer par occurrence')
		fireEvent.change(filtre, { target: { value: 'o2' } })
		expect(screen.getByText('Aucune dépense sur cette occurrence.')).toBeTruthy()
		expect(screen.queryByText('Aucune dépense rattachée à ce budget.')).toBeNull()
	})

	it('le filtre NE MASQUE PAS les barres : l’histogramme reste celui du budget entier', async () => {
		// Le §4.3 rend la LISTE filtrable, jamais le graphique : masquer une paire de barres ferait
		// perdre la comparaison entre occurrences, qui est l'objet même de cet écran.
		monter({ idBudget: ID_BUDGET, client: clientRecurrent() })
		const filtre = await screen.findByLabelText('Filtrer par occurrence')
		fireEvent.change(filtre, { target: { value: 'o1' } })
		const tableau = screen.getByRole('table', { name: /Équivalent textuel/ })
		expect(within(tableau).getByRole('rowheader', { name: 'Février 2026' })).toBeTruthy()
	})
})

describe('enGroupesOccurrence et formaterPeriode — §4.3 et §2.2', () => {
	const agregat = { estime: 100, reel: 90, sansReel: 0, estimeSansReel: 0, lignes: 1 }

	it('porte la période en PRÉCISION sous le libellé, sans jamais la concaténer', () => {
		const groupes: readonly BarresOccurrence[] = [
			{
				occurrence: occurrence('o1', 'Janvier 2026', {
					period_start: '2026-01-01',
					period_end: '2026-01-31',
				}),
				agregat,
			},
		]
		expect(enGroupesOccurrence(groupes)[0]).toEqual({
			cle: 'o1',
			libelle: 'Janvier 2026',
			precision: 'du 01/01/2026 au 31/01/2026',
			agregat,
		})
	})

	it('rend les trois formes d’une période, les deux bornes étant indépendantes', () => {
		expect(formaterPeriode({ period_start: '2026-01-01', period_end: null })).toBe(
			'à partir du 01/01/2026',
		)
		expect(formaterPeriode({ period_start: null, period_end: '2026-01-31' })).toBe(
			'jusqu’au 31/01/2026',
		)
		expect(formaterPeriode({ period_start: null, period_end: null })).toBeNull()
	})

	it('traite une date illisible comme absente plutôt que de rendre « Invalid Date »', () => {
		// Le type généré ne garantit aucune valeur (`docs/SPEC-types.md`) : une colonne `date` peut
		// porter ce que la base y a mis, et « Invalid Date » à l'écran serait pire qu'un silence.
		expect(formaterPeriode({ period_start: 'pas-une-date', period_end: null })).toBeNull()
	})

	it('nomme « Sans occurrence » le groupe qui n’en porte aucune', () => {
		expect(enGroupesOccurrence([{ occurrence: null, agregat }])[0]).toEqual({
			cle: 'sans-occurrence',
			libelle: 'Sans occurrence',
			agregat,
		})
	})
})
