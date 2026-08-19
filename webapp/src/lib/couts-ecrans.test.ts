// @verifies CRM-086 (docs/BACKLOG.md) — écrans de coûts, TRANCHE 1 : l'agrégation que les trois
//           écrans partagent
// @verifies docs/SPEC-costs.md §2.3 (`actual_cost` nul n'est PAS zéro, aucune contrainte de signe),
//           §4.2 (un budget clôturé ne figure pas dans l'histogramme du track, les budgets sont
//           dans l'ordre de l'administration), §4.4 (« n lignes sans coût réel saisi, pour m € de
//           prévisionnel »), §4.5 (les devises ne se mélangent pas, et le cumul est calculé APRÈS
//           la RLS), §4.7 (un budget sans ligne rend un agrégat NUL et non une absence)
// @verifies docs/DESIGN_SYSTEM.md §5.30 (la barre du réel dépasse, ou non, celle du prévisionnel)
//
// CE FICHIER ÉPROUVE LA REQUÊTE RÉELLEMENT ÉMISE autant que la valeur rendue, comme
// `card-costs.test.ts` : deux exigences de la spécification sont portées par la requête elle-même —
// le filtre des budgets clôturés et l'ordre — et un test qui n'observerait que la réponse les
// laisserait disparaître sans bruit.
//
// LE TEST LE PLUS IMPORTANT DE CE FICHIER EST CELUI QUI ÉPROUVE LA RLS. Le §4.5 exige que le cumul
// soit calculé APRÈS application de la RLS : la preuve, du côté client, est que le module
// n'additionne QUE les lignes que la réponse porte, et n'ajoute aucun `count` ni aucune somme
// serveur qui contournerait la politique. Une réponse amputée rend donc un total amputé, ce qui est
// exactement le comportement voulu — et le contraire divulguerait par soustraction l'existence d'un
// budget interdit.

import { describe, expect, it } from 'vitest'
import {
	AGREGAT_NUL,
	COLONNES_BUDGET_ECRAN,
	agreger,
	cumuler,
	depasse,
	grouperParDevise,
	lireHistogrammeTrack,
	type BudgetDeLEcran,
	type LigneAgregeable,
} from './couts-ecrans'
import type { ClientCrm } from './supabase'

type Reponse = {
	data: unknown[] | null
	error: { message: string; code?: string } | null
	status: number
}

type Appel = {
	table?: string
	colonnes?: string
	filtres: [string, unknown][]
	tris: string[]
}

/** Client factice qui **enregistre** chaque requête construite, puis rend les réponses en séquence. */
function espion(reponses: readonly Reponse[]): { client: ClientCrm; appels: Appel[] } {
	const appels: Appel[] = []
	let rang = 0
	const client = {
		from: (table: string) => {
			const appel: Appel = { table, filtres: [], tris: [] }
			appels.push(appel)
			const reponse = reponses[rang++] ?? { data: [], error: null, status: 200 }
			const chaine: Record<string, unknown> = {}
			const enregistrer = (nom: 'is' | 'eq' | 'in') => (colonne: string, valeur: unknown) => {
				appel.filtres.push([`${nom}:${colonne}`, valeur])
				return chaine
			}
			chaine.is = enregistrer('is')
			chaine.eq = enregistrer('eq')
			chaine.in = enregistrer('in')
			chaine.order = (colonne: string) => {
				appel.tris.push(colonne)
				return chaine
			}
			chaine.then = (resoudre: (valeur: Reponse) => unknown) =>
				Promise.resolve(reponse).then(resoudre)
			return {
				select: (colonnes: string) => {
					appel.colonnes = colonnes
					return chaine
				},
			}
		},
	} as unknown as ClientCrm
	return { client, appels }
}

const budget = (
	id: string,
	name: string,
	currency = 'EUR',
	reste: Partial<BudgetDeLEcran> = {},
): BudgetDeLEcran => ({
	id,
	name,
	currency,
	is_recurrent: false,
	planned_amount: null,
	closed_at: null,
	...reste,
})

const ligne = (estimated_cost: number, actual_cost: number | null): LigneAgregeable => ({
	estimated_cost,
	actual_cost,
})

// ---------------------------------------------------------------------------------------------

describe('agreger — §2.3 et §4.4', () => {
	it('additionne les estimés et les réels renseignés', () => {
		expect(agreger([ligne(100, 90), ligne(350, 375)])).toEqual({
			estime: 450,
			reel: 465,
			sansReel: 0,
			estimeSansReel: 0,
		})
	})

	it("un réel NUL n'entre pas dans le réel, et n'y entre pas comme zéro non plus", () => {
		// C'est LE test du §2.3 : `actual_cost` nul n'est pas zéro. Un `?? 0` dans le module rendrait
		// `reel: 100` ici — indistinguable d'un « rien dépensé » réellement constaté.
		expect(agreger([ligne(100, null)])).toEqual({
			estime: 100,
			reel: 0,
			sansReel: 1,
			estimeSansReel: 100,
		})
	})

	it('un réel réellement nul est compté, et ne rejoint PAS les lignes en attente', () => {
		// Le pendant du test précédent, et il est indispensable : sans lui, un module qui traiterait
		// `0` comme une absence passerait le test ci-dessus. Le §4.8 pose que « saisir 0 retire la
		// ligne de l'attente ».
		expect(agreger([ligne(100, 0)])).toEqual({
			estime: 100,
			reel: 0,
			sansReel: 0,
			estimeSansReel: 0,
		})
	})

	it("le cas du responsable : publicité 100 sans réel, production 350 pour 375", () => {
		// « n lignes sans coût réel saisi, pour m € de prévisionnel » — §4.4, sur l'exemple qui a
		// motivé toute la spécification (§1).
		expect(agreger([ligne(100, null), ligne(350, 375)])).toEqual({
			estime: 450,
			reel: 375,
			sansReel: 1,
			estimeSansReel: 100,
		})
	})

	it('accepte les montants négatifs — un avoir est un coût légitime (§2.1)', () => {
		expect(agreger([ligne(100, 120), ligne(-30, -30)])).toEqual({
			estime: 70,
			reel: 90,
			sansReel: 0,
			estimeSansReel: 0,
		})
	})

	it('aucune ligne rend l\'agrégat nul, et non une absence (§4.7)', () => {
		expect(agreger([])).toEqual(AGREGAT_NUL)
	})
})

describe('depasse — docs/DESIGN_SYSTEM.md §5.30', () => {
	it('est vrai quand le réel dépasse strictement le prévisionnel', () => {
		expect(depasse({ estime: 350, reel: 375, sansReel: 0, estimeSansReel: 0 })).toBe(true)
	})

	it("est faux à l'égalité — dépenser exactement son enveloppe n'est pas un dépassement", () => {
		expect(depasse({ estime: 350, reel: 350, sansReel: 0, estimeSansReel: 0 })).toBe(false)
	})

	it("est faux quand des réels manquent et que le peu de réel connu reste sous l'estimé", () => {
		// Le piège du §4.4 : ne PAS lire une saisie en retard comme une économie. `depasse` reste
		// faux, et c'est la mention — pas la couleur — qui porte l'information.
		expect(depasse({ estime: 450, reel: 375, sansReel: 1, estimeSansReel: 100 })).toBe(false)
	})

	it('reste juste sur des agrégats négatifs', () => {
		expect(depasse({ estime: -100, reel: -50, sansReel: 0, estimeSansReel: 0 })).toBe(true)
	})
})

describe('cumuler — §4.5', () => {
	it('additionne les montants ET les comptes de lignes en attente', () => {
		// `sansReel` est un COMPTE, pas un montant : le cumuler doit préserver le nombre de lignes,
		// puisque le §4.8 exige que le badge de l'onglet porte le même nombre que la mention du §4.4.
		expect(
			cumuler([
				{ estime: 450, reel: 375, sansReel: 1, estimeSansReel: 100 },
				{ estime: 200, reel: 0, sansReel: 2, estimeSansReel: 200 },
			]),
		).toEqual({ estime: 650, reel: 375, sansReel: 3, estimeSansReel: 300 })
	})

	it('rend l\'agrégat nul sur une suite vide', () => {
		expect(cumuler([])).toEqual(AGREGAT_NUL)
	})
})

describe('grouperParDevise — §4.5 et §4.7', () => {
	it('rend un histogramme par devise, dans l\'ordre des budgets et non par ordre alphabétique', () => {
		// EUR est rencontré en premier : il reste en premier. Un tri alphabétique ferait passer CHF
		// devant sur un track dont tout est en euros sauf un budget.
		const histogrammes = grouperParDevise(
			[budget('b1', 'Publicité'), budget('b2', 'Salon Genève', 'CHF')],
			new Map([
				['b1', [ligne(100, null)]],
				['b2', [ligne(900, 950)]],
			]),
		)
		expect(histogrammes.map((h) => h.devise)).toEqual(['EUR', 'CHF'])
		expect(histogrammes[0]?.barres.map((b) => b.budget.name)).toEqual(['Publicité'])
		expect(histogrammes[1]?.total).toEqual({
			estime: 900,
			reel: 950,
			sansReel: 0,
			estimeSansReel: 0,
		})
	})

	it('ne mélange JAMAIS deux devises dans un même total (§4.5)', () => {
		const histogrammes = grouperParDevise(
			[budget('b1', 'A'), budget('b2', 'B', 'CHF'), budget('b3', 'C')],
			new Map([
				['b1', [ligne(10, 10)]],
				['b2', [ligne(1000, 1000)]],
				['b3', [ligne(20, 20)]],
			]),
		)
		expect(histogrammes).toHaveLength(2)
		// 30 et non 1030 : les francs ne rejoignent pas les euros.
		expect(histogrammes[0]?.total.estime).toBe(30)
		expect(histogrammes[1]?.total.estime).toBe(1000)
	})

	it('un budget SANS aucune ligne rend deux barres nulles, et non une absence (§4.7)', () => {
		const histogrammes = grouperParDevise([budget('b1', 'Neuf')], new Map())
		expect(histogrammes[0]?.barres).toHaveLength(1)
		expect(histogrammes[0]?.barres[0]?.agregat).toEqual(AGREGAT_NUL)
	})

	it('aucun budget rend aucun histogramme', () => {
		expect(grouperParDevise([], new Map())).toEqual([])
	})

	it('le total de la devise porte la mention du §4.4 pour TOUS ses budgets', () => {
		const histogrammes = grouperParDevise(
			[budget('b1', 'A'), budget('b2', 'B')],
			new Map([
				['b1', [ligne(100, null), ligne(50, 50)]],
				['b2', [ligne(200, null)]],
			]),
		)
		expect(histogrammes[0]?.total).toEqual({
			estime: 350,
			reel: 50,
			sansReel: 2,
			estimeSansReel: 300,
		})
	})
})

describe('lireHistogrammeTrack — la requête réellement émise', () => {
	it('filtre le track et les budgets clôturés CÔTÉ SERVEUR, et trie comme l\'administration', async () => {
		const { client, appels } = espion([
			{ data: [budget('b1', 'Publicité')], error: null, status: 200 },
			{ data: [], error: null, status: 200 },
		])
		await lireHistogrammeTrack(client, 'track-1')
		expect(appels[0]?.table).toBe('budgets')
		expect(appels[0]?.colonnes).toBe(COLONNES_BUDGET_ECRAN)
		expect(appels[0]?.filtres).toEqual([
			['eq:track_id', 'track-1'],
			['is:closed_at', null],
		])
		expect(appels[0]?.tris).toEqual(['position', 'name'])
	})

	it('lit les lignes en UNE requête pour tous les budgets, jamais une par budget', async () => {
		const { client, appels } = espion([
			{
				data: [budget('b1', 'A'), budget('b2', 'B')],
				error: null,
				status: 200,
			},
			{ data: [], error: null, status: 200 },
		])
		await lireHistogrammeTrack(client, 'track-1')
		expect(appels).toHaveLength(2)
		expect(appels[1]?.table).toBe('card_costs')
		expect(appels[1]?.filtres).toEqual([['in:budget_id', ['b1', 'b2']]])
	})

	it('n\'émet AUCUNE requête de lignes quand le track ne porte aucun budget', async () => {
		const { client, appels } = espion([{ data: [], error: null, status: 200 }])
		const etat = await lireHistogrammeTrack(client, 'track-1')
		expect(appels).toHaveLength(1)
		expect(etat).toEqual({ statut: 'pret', donnees: [] })
	})

	it('agrège les lignes rendues par budget', async () => {
		const { client } = espion([
			{ data: [budget('b1', 'Publicité'), budget('b2', 'Production')], error: null, status: 200 },
			{
				data: [
					{ id: 'l1', budget_id: 'b1', estimated_cost: 100, actual_cost: null },
					{ id: 'l2', budget_id: 'b2', estimated_cost: 350, actual_cost: 375 },
				],
				error: null,
				status: 200,
			},
		])
		const etat = await lireHistogrammeTrack(client, 'track-1')
		expect(etat.statut).toBe('pret')
		if (etat.statut !== 'pret') return
		expect(etat.donnees).toHaveLength(1)
		expect(etat.donnees[0]?.barres.map((b) => b.agregat)).toEqual([
			{ estime: 100, reel: 0, sansReel: 1, estimeSansReel: 100 },
			{ estime: 350, reel: 375, sansReel: 0, estimeSansReel: 0 },
		])
		expect(etat.donnees[0]?.total).toEqual({
			estime: 450,
			reel: 375,
			sansReel: 1,
			estimeSansReel: 100,
		})
	})

	it('N\'ADDITIONNE QUE LES LIGNES QUE LA RLS A RENDUES — §4.5', async () => {
		// LE TEST QUI PORTE LE §4.5. La politique de `card_costs` exige de lire la card ET le budget
		// (§3.1) : une ligne fermée à l'appelant n'est tout simplement pas dans la réponse. Le module
		// ne doit RIEN faire pour la retrouver — ni `count` serveur, ni somme calculée en base. Le
		// total d'un profil restreint est donc plus petit, et c'est la propriété attendue : un total
		// juste au centime près qui divulguerait par soustraction un budget fermé serait un défaut
		// d'autorisation.
		const { client, appels } = espion([
			{ data: [budget('b1', 'Publicité')], error: null, status: 200 },
			{
				data: [{ id: 'l1', budget_id: 'b1', estimated_cost: 100, actual_cost: 90 }],
				error: null,
				status: 200,
			},
		])
		const etat = await lireHistogrammeTrack(client, 'track-1')
		expect(etat.statut).toBe('pret')
		if (etat.statut !== 'pret') return
		expect(etat.donnees[0]?.total).toEqual({
			estime: 100,
			reel: 90,
			sansReel: 0,
			estimeSansReel: 0,
		})
		// Aucune option d'agrégation n'accompagne la lecture : les colonnes demandées sont des
		// colonnes, pas une somme.
		expect(appels[1]?.colonnes).toBe('id, budget_id, estimated_cost, actual_cost')
	})

	it('remonte le refus de la lecture des budgets sans le convertir en tableau vide', async () => {
		const { client } = espion([{ data: null, error: { message: 'refus' }, status: 403 }])
		const etat = await lireHistogrammeTrack(client, 'track-1')
		expect(etat).toEqual({
			statut: 'erreur',
			erreur: { nature: 'forbidden', detail: 'refus' },
		})
	})

	it('remonte le refus de la lecture des LIGNES, et ne rend pas un histogramme faussement nul', async () => {
		// Sans ce test, un module qui avalerait l'erreur des lignes rendrait des barres à zéro : un
		// écran qui affiche « aucune dépense » là où la lecture a échoué est la valeur par défaut
		// trompeuse de `CLAUDE.md` §18.
		const { client } = espion([
			{ data: [budget('b1', 'A')], error: null, status: 200 },
			{ data: null, error: { message: 'coupure' }, status: 0 },
		])
		const etat = await lireHistogrammeTrack(client, 'track-1')
		expect(etat).toEqual({
			statut: 'erreur',
			erreur: { nature: 'network', detail: 'coupure' },
		})
	})
})
