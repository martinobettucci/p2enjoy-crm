// @verifies CRM-086 (docs/BACKLOG.md) — écrans de coûts, TRANCHE 3 : le montage de l'écran du §4.2
// @verifies docs/SPEC-costs.md §4.2 (un budget clôturé n'y figure pas ; un budget récurrent est
//           AGRÉGÉ, une seule paire de barres), §4.4 (la mention des réels manquants), §4.5 (le
//           cumul est calculé APRÈS la RLS : une réponse amputée rend un total amputé),
//           §4.7 (les états : aucun budget, budget sans ligne, lecture refusée)
// @verifies docs/DESIGN_SYSTEM.md §5.8 (les quatre états systématiques), §5.30 (tableau équivalent)
//
// CE FICHIER ÉPROUVE L'ÉCRAN, PAS L'AGRÉGATION. `couts-ecrans.test.ts` couvre déjà l'addition, le
// groupement par devise et la forme des deux requêtes ; les répéter ici les ferait diverger. Ce qui
// est éprouvé ici est ce que le montage ajoute et qu'aucune des deux premières tranches ne pouvait
// éprouver : la résolution du track, les cinq issues de la zone principale, et le fait que la
// lecture parte bien de l'identifiant du track résolu.
//
// LA PROPRIÉTÉ DU §4.5 EST ÉPROUVÉE PAR LA RÉPONSE, ET NON PAR UN RÔLE. Le module lit sous
// l'identité de l'appelant : une preuve unitaire ne peut pas poser une RLS, mais elle peut poser ce
// que la RLS PRODUIT — une réponse à laquelle des lignes manquent — et vérifier que l'écran rend
// alors un total plus petit, sans compenser ni signaler un manque qu'il ne connaît pas. C'est la
// preuve E2E, listée au backlog, qui exercera la RLS réelle avec deux profils.

import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it } from 'vitest'
import { ContenuCoutsTrack, enGroupes } from './CoutsTrack'
import type { ClientCrm } from '../lib/supabase'
import type { HistogrammeDevise } from '../lib/couts-ecrans'

afterEach(cleanup)

type Reponse = {
	data: unknown[] | null
	error: { message: string } | null
	status: number
}

/**
 * Client factice rendant les réponses en séquence — les budgets, puis leurs lignes.
 *
 * Il est volontairement plus pauvre que celui de `couts-ecrans.test.ts`, qui enregistre chaque
 * filtre construit : la forme des requêtes est le contrat du module, éprouvé là-bas, et le
 * réenregistrer ici ferait de ce fichier une seconde source de vérité sur un sujet qui n'est pas
 * le sien.
 */
function clientQuiRend(reponses: readonly Reponse[]): ClientCrm {
	let rang = 0
	return {
		from: () => {
			const reponse = reponses[rang++] ?? { data: [], error: null, status: 200 }
			const chaine: Record<string, unknown> = {}
			const rendre = () => chaine
			chaine.is = rendre
			chaine.eq = rendre
			chaine.in = rendre
			chaine.order = rendre
			chaine.then = (resoudre: (valeur: Reponse) => unknown) =>
				Promise.resolve(reponse).then(resoudre)
			return { select: () => chaine }
		},
	} as unknown as ClientCrm
}

const budget = (id: string, name: string, currency = 'EUR') => ({
	id,
	name,
	currency,
	is_recurrent: false,
	planned_amount: null,
	closed_at: null,
	position: 1,
})

const ligne = (budget_id: string, estimated_cost: number, actual_cost: number | null) => ({
	id: `l-${budget_id}-${estimated_cost}`,
	budget_id,
	estimated_cost,
	actual_cost,
})

const ok = (data: unknown[]): Reponse => ({ data, error: null, status: 200 })

/**
 * La zone est montée SOUS un routeur : l'état « track introuvable » du §4.7 porte un lien de
 * retour, et un `Link` hors routeur lève. Le routeur n'est pas la chose éprouvée — aucune
 * assertion ne porte sur une navigation —, il est le contexte minimal que le rendu exige.
 */
const monter = (
	proprietes: Parameters<typeof ContenuCoutsTrack>[0],
): ReturnType<typeof render> =>
	render(
		<MemoryRouter>
			<ContenuCoutsTrack {...proprietes} />
		</MemoryRouter>,
	)

/** La ligne du tableau équivalent (§5.30) portant ce libellé de budget. */
const ligneDuTableau = (libelle: string) =>
	screen.getByRole('row', { name: new RegExp(libelle) })

// ---------------------------------------------------------------------------------------------

describe('ContenuCoutsTrack — résolution du track (§4.7)', () => {
	it('ne rend RIEN pendant la résolution, jamais un « introuvable » prématuré', () => {
		const { container } = monter({ chargementTrack: true, idTrack: null, client: clientQuiRend([]) })
		// L'absence annoncée avant la réponse serait la valeur par défaut trompeuse que
		// `CLAUDE.md` §18 interdit : la zone reste vide, les squelettes vivant dans la coquille.
		expect(container.innerHTML).toBe('')
	})

	it('rend « track introuvable » avec un retour, une fois la résolution terminée', () => {
		monter({ chargementTrack: false, idTrack: null, client: clientQuiRend([]) })
		expect(screen.getByText('Track introuvable')).toBeTruthy()
		// Le même écran qu'un slug refusé : les distinguer renseignerait un appelant sans droit sur
		// l'existence d'un track (docs/SPEC-permissions-rls.md §7).
		expect(screen.getByRole('link')).toBeTruthy()
	})

	it('n’émet AUCUNE lecture tant que le track n’est pas résolu', () => {
		let appels = 0
		const client = {
			from: () => {
				appels += 1
				return { select: () => ({ then: () => Promise.resolve(ok([])) }) }
			},
		} as unknown as ClientCrm
		monter({ chargementTrack: true, idTrack: null, client })
		expect(appels).toBe(0)
	})
})

describe('ContenuCoutsTrack — l’histogramme rendu (§4.2)', () => {
	it('rend une paire de barres par budget, avec son estimé et son réel', async () => {
		render(
			<MemoryRouter>
				<ContenuCoutsTrack
					chargementTrack={false}
					idTrack="t-1"
					client={clientQuiRend([
						ok([budget('b-1', 'Publicité'), budget('b-2', 'Production')]),
						ok([ligne('b-1', 100, 90), ligne('b-2', 350, 375)]),
					])}
				/>
			</MemoryRouter>,
		)
		// Les assertions portent sur le TABLEAU ÉQUIVALENT et non sur les barres : le §5.30 en fait
		// la version accessible du graphique, les barres étant `aria-hidden` à dessein.
		const publicite = await screen.findByRole('row', { name: /Publicité/ })
		expect(within(publicite).getAllByRole('cell')[0]?.textContent).toContain('100')
		expect(within(publicite).getAllByRole('cell')[1]?.textContent).toContain('90')
		expect(ligneDuTableau('Production')).toBeTruthy()
	})

	it('rend UN histogramme par devise, jamais un total unique (§4.5)', async () => {
		render(
			<MemoryRouter>
				<ContenuCoutsTrack
					chargementTrack={false}
					idTrack="t-1"
					client={clientQuiRend([
						ok([budget('b-1', 'Publicité', 'EUR'), budget('b-2', 'Salon', 'CHF')]),
						ok([ligne('b-1', 100, 90), ligne('b-2', 200, 200)]),
					])}
				/>
			</MemoryRouter>,
		)
		// Deux régions distinctes : additionner des francs et des euros sur un axe commun serait le
		// total illisible que le §4.5 refuse.
		await waitFor(() => expect(screen.getAllByRole('table')).toHaveLength(2))
		expect(screen.getByRole('region', { name: /EUR/ })).toBeTruthy()
		expect(screen.getByRole('region', { name: /CHF/ })).toBeTruthy()
	})

	it('rend la mention du §4.4 dès qu’une ligne n’a pas de réel, et le compte est celui des lignes', async () => {
		render(
			<MemoryRouter>
				<ContenuCoutsTrack
					chargementTrack={false}
					idTrack="t-1"
					client={clientQuiRend([
						ok([budget('b-1', 'Publicité')]),
						ok([ligne('b-1', 100, null), ligne('b-1', 50, null), ligne('b-1', 30, 30)]),
					])}
				/>
			</MemoryRouter>,
		)
		// C'est le nombre que le badge de l'onglet « À saisir » devra porter (§4.8) : s'ils
		// divergeaient, l'un des deux mentirait.
		const mention = await screen.findByText(/2 ligne\(s\) sans coût réel saisi/)
		expect(mention.textContent).toContain('150')
	})

	it('n’écrit PAS la mention du §4.4 quand tous les réels sont saisis', async () => {
		render(
			<MemoryRouter>
				<ContenuCoutsTrack
					chargementTrack={false}
					idTrack="t-1"
					client={clientQuiRend([ok([budget('b-1', 'Publicité')]), ok([ligne('b-1', 100, 90)])])}
				/>
			</MemoryRouter>,
		)
		await screen.findByRole('table')
		// Absente, et non rendue à zéro : un avertissement permanent cesserait d'être lu.
		expect(screen.queryByText(/sans coût réel saisi/)).toBeNull()
	})

	it('rend un budget SANS ligne avec un agrégat nul, jamais en l’omettant (§4.7)', async () => {
		render(
			<MemoryRouter>
				<ContenuCoutsTrack
					chargementTrack={false}
					idTrack="t-1"
					client={clientQuiRend([ok([budget('b-1', 'Publicité')]), ok([])])}
				/>
			</MemoryRouter>,
		)
		// Le §4.7 exige « un histogramme à deux barres nulles et "aucune dépense rattachée" », pas
		// une absence de barres : un budget qui disparaîtrait se lirait comme un budget inexistant.
		const publicite = await screen.findByRole('row', { name: /Publicité/ })
		expect(within(publicite).getAllByRole('cell')[0]?.textContent).toContain('0')
	})

	it('rend un total AMPUTÉ lorsque la réponse l’est — c’est la propriété du §4.5', async () => {
		// Deux budgets rendus, mais les lignes de l'un ne sont pas dans la réponse : c'est ce que
		// produit `card_costs`, qui exige `app.can_read_card` ET `app.can_read_budget` (§3.1).
		render(
			<MemoryRouter>
				<ContenuCoutsTrack
					chargementTrack={false}
					idTrack="t-1"
					client={clientQuiRend([
						ok([budget('b-1', 'Publicité'), budget('b-2', 'Production')]),
						ok([ligne('b-1', 100, 90)]),
					])}
				/>
			</MemoryRouter>,
		)
		const production = await screen.findByRole('row', { name: /Production/ })
		// Le budget reste nommé et son agrégat vaut zéro. L'écran ne compense pas, et n'annonce pas
		// non plus un manque : un total juste au centime près qui divulguerait par soustraction
		// l'existence d'un budget fermé serait un défaut d'autorisation, pas un défaut d'affichage.
		expect(within(production).getAllByRole('cell')[0]?.textContent).toContain('0')
		expect(screen.queryByText(/sans coût réel saisi/)).toBeNull()
	})
})

describe('ContenuCoutsTrack — les états du §4.7 et du §5.8', () => {
	it('rend l’état « aucun budget » SANS action quand le track n’en porte aucun', async () => {
		render(
			<MemoryRouter>
				<ContenuCoutsTrack
					chargementTrack={false}
					idTrack="t-1"
					client={clientQuiRend([ok([])])}
				/>
			</MemoryRouter>,
		)
		await screen.findByText('Aucun budget sur ce track')
		// Aucune action : la création vit dans l'administration de l'arborescence (§4.1), et y
		// renvoyer selon le rôle ferait calculer un droit à l'interface (`CLAUDE.md` §10).
		expect(screen.queryByRole('link')).toBeNull()
		expect(screen.queryByRole('button')).toBeNull()
	})

	it('rend le refus, et non une erreur de transport, sur un 403', async () => {
		render(
			<MemoryRouter>
				<ContenuCoutsTrack
					chargementTrack={false}
					idTrack="t-1"
					client={clientQuiRend([{ data: null, error: { message: 'refus' }, status: 403 }])}
				/>
			</MemoryRouter>,
		)
		await screen.findByText('Accès refusé')
		// Un refus est définitif là où une panne de transport se retente : aucune reprise n'est
		// offerte (docs/DESIGN_SYSTEM.md §5.8).
		expect(screen.queryByRole('button')).toBeNull()
	})

	it('rend l’erreur AVEC sa reprise sur un échec de transport', async () => {
		render(
			<MemoryRouter>
				<ContenuCoutsTrack
					chargementTrack={false}
					idTrack="t-1"
					client={clientQuiRend([
						{ data: null, error: { message: 'panne' }, status: 500 },
						ok([budget('b-1', 'Publicité')]),
						ok([ligne('b-1', 100, 90)]),
					])}
				/>
			</MemoryRouter>,
		)
		const reprise = await screen.findByRole('button')
		reprise.click()
		// La reprise RELIT réellement : elle ne se contente pas de masquer l'erreur.
		expect(await screen.findByRole('row', { name: /Publicité/ })).toBeTruthy()
	})
})

describe('enGroupes', () => {
	it('nomme chaque paire de barres par son budget, et ne pose aucune précision', () => {
		const histogramme: HistogrammeDevise = {
			devise: 'EUR',
			barres: [
				{
					budget: budget('b-1', 'Publicité'),
					agregat: { estime: 100, reel: 90, sansReel: 0, estimeSansReel: 0, lignes: 1 },
				},
			],
			total: { estime: 100, reel: 90, sansReel: 0, estimeSansReel: 0, lignes: 1 },
		}
		expect(enGroupes(histogramme)).toEqual([
			{ cle: 'b-1', libelle: 'Publicité', agregat: histogramme.total },
		])
	})

	it('pose le LIEN vers le détail du budget quand le slug du track est connu — tranche 4', () => {
		// Sans ce lien, l'écran du §4.3 serait une adresse qu'aucun geste n'ouvre. Le nom accessible
		// NOMME le budget : « Publicité » répété sur cinq lignes ne dirait pas ce que chaque lien
		// ouvre (docs/DESIGN_SYSTEM.md §5.29).
		const histogramme: HistogrammeDevise = {
			devise: 'EUR',
			barres: [
				{
					budget: budget('b-1', 'Publicité'),
					agregat: { estime: 100, reel: 90, sansReel: 0, estimeSansReel: 0, lignes: 1 },
				},
			],
			total: { estime: 100, reel: 90, sansReel: 0, estimeSansReel: 0, lignes: 1 },
		}
		expect(enGroupes(histogramme, 'conseil-ia')[0]?.lien).toEqual({
			adresse: '/tracks/conseil-ia/couts/b-1',
			nomAccessible: 'Voir le détail du budget Publicité',
		})
	})

	it("ne pose AUCUN lien quand le slug manque, plutôt qu'une adresse partielle", () => {
		// Un lien vers `/tracks/undefined/couts/...` mènerait à un écran que l'utilisateur croirait
		// cassé — la règle d'`adresseAffaire` du carnet, tenue ici aussi.
		const histogramme: HistogrammeDevise = {
			devise: 'EUR',
			barres: [
				{
					budget: budget('b-1', 'Publicité'),
					agregat: { estime: 100, reel: 90, sansReel: 0, estimeSansReel: 0, lignes: 1 },
				},
			],
			total: { estime: 100, reel: 90, sansReel: 0, estimeSansReel: 0, lignes: 1 },
		}
		expect(enGroupes(histogramme)[0]?.lien).toBeUndefined()
	})

	it('rend le nom du budget en LIEN dans le tableau équivalent, et jamais sur la barre', async () => {
		// Le graphique est `aria-hidden` (§5.30) : une cible interactive posée dessus serait perdue
		// au clavier et au lecteur d'écran. Le geste vit donc dans le tableau, qui est la version
		// accessible du graphique.
		monter({
			chargementTrack: false,
			idTrack: 'track-1',
			slugTrack: 'conseil-ia',
			client: clientQuiRend([ok([budget('b-1', 'Publicité')]), ok([ligne('b-1', 100, 90)])]),
		})
		const lien = await screen.findByRole('link', { name: 'Voir le détail du budget Publicité' })
		expect(lien.getAttribute('href')).toBe('/tracks/conseil-ia/couts/b-1')
	})
})
