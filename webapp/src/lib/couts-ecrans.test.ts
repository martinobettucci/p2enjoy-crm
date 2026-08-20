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
	COLONNES_LIGNE_BUDGET,
	adresseAffaireLigne,
	agreger,
	cumuler,
	depasse,
	estIdentifiantBudget,
	filtrerParOccurrence,
	grouperParDevise,
	grouperParOccurrence,
	lireDetailBudget,
	lireHistogrammeTrack,
	type BudgetDeLEcran,
	type LigneAgregeable,
	type LigneBudget,
	type OccurrenceDeLEcran,
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
			lignes: 2,
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
			lignes: 1,
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
			// LA LIGNE EST COMPTÉE, et c'est ce qui distingue ce cas du budget vide du §4.7 : elle
			// existe, elle vaut zéro, et l'écran ne doit pas écrire « aucune dépense rattachée ».
			lignes: 1,
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
			lignes: 2,
		})
	})

	it('accepte les montants négatifs — un avoir est un coût légitime (§2.1)', () => {
		expect(agreger([ligne(100, 120), ligne(-30, -30)])).toEqual({
			estime: 70,
			reel: 90,
			sansReel: 0,
			estimeSansReel: 0,
			// DEUX lignes dont les montants NE S'ANNULENT PAS ici, mais qui le pourraient : c'est
			// exactement pourquoi l'état vide du §4.7 se lit sur le compte et jamais sur les
			// montants (décision 476).
			lignes: 2,
		})
	})

	it('aucune ligne rend l\'agrégat nul, et non une absence (§4.7)', () => {
		expect(agreger([])).toEqual(AGREGAT_NUL)
	})
})

describe('depasse — docs/DESIGN_SYSTEM.md §5.30', () => {
	it('est vrai quand le réel dépasse strictement le prévisionnel', () => {
		expect(depasse({ estime: 350, reel: 375, sansReel: 0, estimeSansReel: 0, lignes: 1 })).toBe(true)
	})

	it("est faux à l'égalité — dépenser exactement son enveloppe n'est pas un dépassement", () => {
		expect(depasse({ estime: 350, reel: 350, sansReel: 0, estimeSansReel: 0, lignes: 1 })).toBe(
			false,
		)
	})

	it("est faux quand des réels manquent et que le peu de réel connu reste sous l'estimé", () => {
		// Le piège du §4.4 : ne PAS lire une saisie en retard comme une économie. `depasse` reste
		// faux, et c'est la mention — pas la couleur — qui porte l'information.
		expect(depasse({ estime: 450, reel: 375, sansReel: 1, estimeSansReel: 100, lignes: 2 })).toBe(
			false,
		)
	})

	it('reste juste sur des agrégats négatifs', () => {
		expect(depasse({ estime: -100, reel: -50, sansReel: 0, estimeSansReel: 0, lignes: 2 })).toBe(
			true,
		)
	})
})

describe('cumuler — §4.5', () => {
	it('additionne les montants ET les comptes de lignes en attente', () => {
		// `sansReel` est un COMPTE, pas un montant : le cumuler doit préserver le nombre de lignes,
		// puisque le §4.8 exige que le badge de l'onglet porte le même nombre que la mention du §4.4.
		expect(
			cumuler([
				{ estime: 450, reel: 375, sansReel: 1, estimeSansReel: 100, lignes: 2 },
				{ estime: 200, reel: 0, sansReel: 2, estimeSansReel: 200, lignes: 2 },
			]),
		).toEqual({ estime: 650, reel: 375, sansReel: 3, estimeSansReel: 300, lignes: 4 })
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
			lignes: 1,
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
			lignes: 3,
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
			{ estime: 100, reel: 0, sansReel: 1, estimeSansReel: 100, lignes: 1 },
			{ estime: 350, reel: 375, sansReel: 0, estimeSansReel: 0, lignes: 1 },
		])
		expect(etat.donnees[0]?.total).toEqual({
			estime: 450,
			reel: 375,
			sansReel: 1,
			estimeSansReel: 100,
			lignes: 2,
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
			lignes: 1,
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

// ---------------------------------------------------------------------------------------------
// TRANCHE 4 — l'écran de détail d'un budget (§4.3)
//
// @verifies CRM-086 (docs/BACKLOG.md) — écrans de coûts, TRANCHE 4
// @verifies docs/SPEC-costs.md §4.0 (le budget est désigné par son IDENTIFIANT), §4.3 (une paire de
//           barres par occurrence, dans l'ordre des périodes puis des libellés ; un budget non
//           récurrent en rend une seule ; la liste filtrable), §4.7 (les états),
//           §2.2 (les périodes ne contraignent rien), §2.3 (un budget clos garde ses lignes)
// @verifies docs/SPEC-permissions-rls.md §7 (inexistant, refusé et mal formé ne se distinguent pas)
// ---------------------------------------------------------------------------------------------

/**
 * Second client factice, qui parle `maybeSingle` et enregistre les OPTIONS de tri.
 *
 * Il n'étend pas le premier : celui-ci sert des lectures qui rendent toujours des tableaux, et lui
 * greffer un `maybeSingle` obligerait chaque test existant à dire lequel des deux il attend. Les
 * deux exigences propres à cette lecture — l'unicité du budget et le `nullsFirst: false` des
 * périodes — se portent dans la requête, jamais dans la réponse (§4.3, §2.2).
 */
function espionDetail(reponses: readonly Reponse[]): { client: ClientCrm; appels: AppelDetail[] } {
	const appels: AppelDetail[] = []
	let rang = 0
	const client = {
		from: (table: string) => {
			const appel: AppelDetail = { table, filtres: [], tris: [], unique: false }
			appels.push(appel)
			const reponse = reponses[rang++] ?? { data: [], error: null, status: 200 }
			const chaine: Record<string, unknown> = {}
			chaine.eq = (colonne: string, valeur: unknown) => {
				appel.filtres.push([`eq:${colonne}`, valeur])
				return chaine
			}
			chaine.order = (colonne: string, options?: { nullsFirst?: boolean }) => {
				appel.tris.push(options === undefined ? colonne : `${colonne}:${JSON.stringify(options)}`)
				return chaine
			}
			chaine.maybeSingle = () => {
				appel.unique = true
				// `maybeSingle` rend UN objet ou `null`, jamais un tableau : la réponse déclarée par le
				// test est donc dépliée ici, comme PostgREST le fait.
				const data = Array.isArray(reponse.data) ? (reponse.data[0] ?? null) : reponse.data
				return Promise.resolve({ ...reponse, data })
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

type AppelDetail = Appel & { unique: boolean }

const ID_BUDGET = '11111111-1111-4111-8111-111111111111'

const occurrence = (
	id: string,
	label: string,
	reste: Partial<OccurrenceDeLEcran> = {},
): OccurrenceDeLEcran => ({
	id,
	label,
	period_start: null,
	period_end: null,
	planned_amount: null,
	closed_at: null,
	...reste,
})

const ligneBudget = (
	id: string,
	estimated_cost: number,
	actual_cost: number | null,
	reste: Partial<LigneBudget> = {},
): LigneBudget => ({
	id,
	occurrence_id: null,
	label: 'Publicité',
	estimated_cost,
	actual_cost,
	created_at: '2026-08-01T10:00:00Z',
	cards: null,
	profiles: null,
	...reste,
})

describe('estIdentifiantBudget — §4.0', () => {
	it('accepte un uuid et refuse tout le reste', () => {
		expect(estIdentifiantBudget(ID_BUDGET)).toBe(true)
		expect(estIdentifiantBudget('salon-2025')).toBe(false)
		expect(estIdentifiantBudget(undefined)).toBe(false)
		expect(estIdentifiantBudget('')).toBe(false)
	})
})

describe('lireDetailBudget — §4.3', () => {
	it("n'émet AUCUNE requête sur un identifiant mal formé, et rend la même absence qu'un budget inconnu", async () => {
		// Sans ce contrôle, un slug tapé à la main rendrait `400` / `22P02`, que l'écran classerait en
		// erreur — dont l'action de reprise rejouerait la même requête pour recevoir le même refus.
		const { client, appels } = espionDetail([])
		const etat = await lireDetailBudget(client, 'salon-2025')
		expect(etat).toEqual({ statut: 'pret', donnees: null })
		expect(appels).toHaveLength(0)
	})

	it('lit le budget par son identifiant, en une seule ligne, et rend `null` quand il ne répond pas', async () => {
		const { client, appels } = espionDetail([{ data: [], error: null, status: 200 }])
		const etat = await lireDetailBudget(client, ID_BUDGET)
		// Un budget inexistant et un budget refusé rendent tous deux zéro ligne, et donc le même
		// écran : les distinguer renseignerait sur l'existence d'un budget interdit.
		expect(etat).toEqual({ statut: 'pret', donnees: null })
		expect(appels[0]?.table).toBe('budgets')
		expect(appels[0]?.unique).toBe(true)
		expect(appels[0]?.filtres).toEqual([['eq:id', ID_BUDGET]])
		// Aucune lecture des occurrences ni des lignes n'est émise : il n'y a rien à détailler.
		expect(appels).toHaveLength(1)
	})

	it('ne filtre PAS sur `closed_at`, contrairement à la lecture du track', async () => {
		// Le §4.2 exclut un budget clôturé de l'histogramme du TRACK ; c'est une règle d'écran, jamais
		// d'autorisation. Ses lignes restent lisibles (§2.3) et le §4.8 les liste. Une adresse mise en
		// signet ne doit pas cesser de répondre le jour où le budget se ferme.
		const { client, appels } = espionDetail([
			{ data: [budget('b1', 'Salon 2025', 'EUR', { closed_at: '2026-07-01T00:00:00Z' })], error: null, status: 200 },
			{ data: [], error: null, status: 200 },
			{ data: [], error: null, status: 200 },
		])
		const etat = await lireDetailBudget(client, ID_BUDGET)
		expect(appels[0]?.filtres.map(([nom]) => nom)).not.toContain('is:closed_at')
		expect(etat.statut).toBe('pret')
		expect(etat.statut === 'pret' ? etat.donnees?.budget.closed_at : undefined).toBe(
			'2026-07-01T00:00:00Z',
		)
	})

	it('ordonne les occurrences par période PUIS par libellé, les non datées en dernier', async () => {
		// L'ordre est celui que le §4.3 écrit, et il est porté par la REQUÊTE : un test qui
		// n'observerait que la réponse le laisserait disparaître sans bruit. `nullsFirst: false` place
		// les occurrences sans période après celles qui en ont une — le §2.2 les rend facultatives.
		const { client, appels } = espionDetail([
			{ data: [budget('b1', 'Salon 2025')], error: null, status: 200 },
			{ data: [], error: null, status: 200 },
			{ data: [], error: null, status: 200 },
		])
		await lireDetailBudget(client, ID_BUDGET)
		expect(appels[1]?.table).toBe('budget_occurrences')
		expect(appels[1]?.filtres).toEqual([['eq:budget_id', ID_BUDGET]])
		expect(appels[1]?.tris).toEqual(['period_start:{"nullsFirst":false}', 'label'])
	})

	it('lit les lignes du budget avec leur affaire et leur auteur, sans aucune agrégation serveur', async () => {
		const { client, appels } = espionDetail([
			{ data: [budget('b1', 'Salon 2025')], error: null, status: 200 },
			{ data: [], error: null, status: 200 },
			{ data: [], error: null, status: 200 },
		])
		await lireDetailBudget(client, ID_BUDGET)
		expect(appels[2]?.table).toBe('card_costs')
		expect(appels[2]?.filtres).toEqual([['eq:budget_id', ID_BUDGET]])
		expect(appels[2]?.tris).toEqual(['created_at', 'label'])
		// LA CLÉ ÉTRANGÈRE EST NOMMÉE, et c'est obligatoire : `cards` porte DEUX clés composites vers
		// `channels`, et un embed nu rend `PGRST201` — la requête entière est refusée. Cette assertion
		// est la seule qui le dise avant l'exécution.
		expect(COLONNES_LIGNE_BUDGET).toContain('channels!cards_channel_id_workspace_id_fkey')
		expect(COLONNES_LIGNE_BUDGET).toContain('profiles!card_costs_created_by_fkey')
		// Aucune somme n'est demandée au serveur : le §4.5 exige que le cumul se fasse APRÈS la RLS.
		expect(COLONNES_LIGNE_BUDGET).not.toContain('sum(')
	})

	it('remonte le refus de la lecture des LIGNES, et ne rend pas un budget faussement vide', async () => {
		const { client } = espionDetail([
			{ data: [budget('b1', 'Salon 2025')], error: null, status: 200 },
			{ data: [], error: null, status: 200 },
			{ data: null, error: { message: 'refus' }, status: 403 },
		])
		const etat = await lireDetailBudget(client, ID_BUDGET)
		expect(etat).toEqual({ statut: 'erreur', erreur: { nature: 'forbidden', detail: 'refus' } })
	})
})

describe('grouperParOccurrence — §4.3 et §4.7', () => {
	it('rend UNE paire de barres par occurrence, dans l’ordre reçu', () => {
		const groupes = grouperParOccurrence({
			budget: budget('b1', 'Salon', 'EUR', { is_recurrent: true }),
			occurrences: [occurrence('o1', 'Janvier'), occurrence('o2', 'Février')],
			lignes: [
				ligneBudget('l1', 100, 90, { occurrence_id: 'o1' }),
				ligneBudget('l2', 200, null, { occurrence_id: 'o2' }),
				ligneBudget('l3', 50, 50, { occurrence_id: 'o1' }),
			],
		})
		expect(groupes.map((groupe) => groupe.occurrence?.label)).toEqual(['Janvier', 'Février'])
		expect(groupes[0]?.agregat).toEqual({
			estime: 150,
			reel: 140,
			sansReel: 0,
			estimeSansReel: 0,
			lignes: 2,
		})
		expect(groupes[1]?.agregat).toEqual({
			estime: 200,
			reel: 0,
			sansReel: 1,
			estimeSansReel: 200,
			lignes: 1,
		})
	})

	it('garde la paire de barres d’une occurrence SANS aucune ligne', () => {
		// Le §4.3 demande « une paire de barres par occurrence », pas « par occurrence dépensée ».
		// Faire disparaître un mois muet ferait lire le budget comme s'il n'avait jamais porté ce
		// mois-là, alors que c'est précisément l'information.
		const groupes = grouperParOccurrence({
			budget: budget('b1', 'Salon', 'EUR', { is_recurrent: true }),
			occurrences: [occurrence('o1', 'Janvier'), occurrence('o2', 'Février')],
			lignes: [ligneBudget('l1', 100, 90, { occurrence_id: 'o1' })],
		})
		expect(groupes).toHaveLength(2)
		expect(groupes[1]?.agregat).toEqual(AGREGAT_NUL)
	})

	it('rend UNE SEULE paire, sans occurrence, sur un budget NON récurrent — même sans aucune ligne', () => {
		// Le §4.3 : « un budget non récurrent affiche une seule paire de barres et la même liste ».
		// Elle est rendue même à vide, parce que le §4.7 exige « deux barres nulles » et non une
		// absence de graphique.
		const groupes = grouperParOccurrence({
			budget: budget('b1', 'Suisse romande', 'CHF'),
			occurrences: [],
			lignes: [],
		})
		expect(groupes).toHaveLength(1)
		expect(groupes[0]?.occurrence).toBeNull()
		expect(groupes[0]?.agregat).toEqual(AGREGAT_NUL)
	})

	it('ne rend AUCUN groupe hors occurrence sur un budget récurrent qui n’en a pas besoin', () => {
		const groupes = grouperParOccurrence({
			budget: budget('b1', 'Salon', 'EUR', { is_recurrent: true }),
			occurrences: [occurrence('o1', 'Janvier')],
			lignes: [ligneBudget('l1', 100, 90, { occurrence_id: 'o1' })],
		})
		expect(groupes).toHaveLength(1)
		expect(groupes[0]?.occurrence?.id).toBe('o1')
	})

	it('ne PERD jamais une ligne dont l’occurrence n’est pas listée', () => {
		// L'écarter silencieusement retrancherait un montant du total sans que rien ne le dise, ce qui
		// est exactement ce que le §4.4 reproche à un écran de coûts.
		const groupes = grouperParOccurrence({
			budget: budget('b1', 'Salon', 'EUR', { is_recurrent: true }),
			occurrences: [occurrence('o1', 'Janvier')],
			lignes: [
				ligneBudget('l1', 100, 90, { occurrence_id: 'o1' }),
				ligneBudget('l2', 400, null, { occurrence_id: 'o-inconnue' }),
			],
		})
		expect(groupes).toHaveLength(2)
		expect(groupes[1]?.occurrence).toBeNull()
		expect(groupes[1]?.agregat.estime).toBe(400)
		expect(groupes[1]?.agregat.sansReel).toBe(1)
	})

	it('ne groupe AUCUNE devise, toutes les lignes d’un budget partageant la sienne', () => {
		// Le §2.3 pose qu'« une ligne ne porte pas de colonne `currency` » : un écran de détail ne
		// peut donc pas mêler deux monnaies sur un même axe, et le groupement du §4.5 n'y a pas
		// d'objet. Cette assertion garde la propriété : les groupes sont des occurrences, pas des
		// devises.
		const groupes = grouperParOccurrence({
			budget: budget('b1', 'Salon', 'CHF', { is_recurrent: true }),
			occurrences: [occurrence('o1', 'Janvier')],
			lignes: [ligneBudget('l1', 100, 90, { occurrence_id: 'o1' })],
		})
		expect(groupes.every((groupe) => 'occurrence' in groupe)).toBe(true)
	})
})

describe('filtrerParOccurrence — §4.3', () => {
	const lignes = [
		ligneBudget('l1', 100, 90, { occurrence_id: 'o1' }),
		ligneBudget('l2', 200, null, { occurrence_id: 'o2' }),
		ligneBudget('l3', 50, 50, { occurrence_id: null }),
	]

	it('rend TOUTES les lignes quand aucune occurrence n’est retenue', () => {
		expect(filtrerParOccurrence(lignes, null)).toHaveLength(3)
	})

	it('ne rend que les lignes de l’occurrence retenue', () => {
		expect(filtrerParOccurrence(lignes, 'o1').map((ligne) => ligne.id)).toEqual(['l1'])
	})

	it('rend un tableau VIDE sur une occurrence sans ligne, et ne retombe pas sur toutes', () => {
		// Sans cette assertion, un filtre écrit avec un `||` de repli rendrait la liste entière sur
		// une occurrence muette : l'utilisateur lirait des lignes qu'il vient d'exclure.
		expect(filtrerParOccurrence(lignes, 'o-vide')).toEqual([])
	})
})

describe('adresseAffaireLigne — §4.3', () => {
	it('compose l’adresse de l’affaire depuis ses deux slugs', () => {
		const adresse = adresseAffaireLigne(
			ligneBudget('l1', 100, 90, {
				cards: {
					id: 'card-1',
					title: 'ERP Groupe Vitalis',
					archived_at: null,
					channels: { slug: 'grands-comptes', tracks: { slug: 'conseil-ia' } },
				},
			}),
		)
		expect(adresse).toBe('/tracks/conseil-ia/grands-comptes/cards/card-1')
	})

	it('rend `null` plutôt qu’une adresse partielle quand un slug manque', () => {
		// Un lien vers `/tracks/undefined/...` mènerait à un écran que l'utilisateur croirait cassé,
		// là où une ligne sans lien dit seulement que l'affaire n'est pas adressable pour lui.
		expect(
			adresseAffaireLigne(
				ligneBudget('l1', 100, 90, {
					cards: { id: 'card-1', title: 'ERP', archived_at: null, channels: null },
				}),
			),
		).toBeNull()
		expect(adresseAffaireLigne(ligneBudget('l2', 100, 90))).toBeNull()
	})
})
