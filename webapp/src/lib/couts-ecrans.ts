// @spec CRM-086 (docs/BACKLOG.md) — écrans de coûts, TRANCHE 1 : ce que les trois écrans lisent et
//       agrègent, et le décompte que l'onglet « À saisir » doit rendre identique
// @spec docs/SPEC-costs.md §4.0 (adresses des trois écrans), §4.2 (histogramme du track),
//       §4.3 (détail d'un budget, une paire de barres par occurrence), §4.4 (ce que l'écran dit du
//       réel inconnu), §4.5 (cumul du workspace, calculé APRÈS la RLS), §4.7 (les états)
// @spec docs/SPEC-costs.md §2.3 (« nul n'est pas zéro »), §3.1 (double condition de lecture)
// @spec docs/SCHEMA.md §9 bis.6 (card_costs), §9 bis.7 (politiques)
// @spec docs/DESIGN_SYSTEM.md §5.30 (histogramme prévisionnel / réel)
//
// CE MODULE N'AGRÈGE QUE CE QUE LA RLS A DÉJÀ CONSENTI, et c'est sa règle de conception centrale.
// Le §4.5 l'écrit sans ambiguïté : « le cumul est calculé APRÈS application de la RLS, jamais
// avant. Un total qui inclurait un budget interdit le divulguerait par soustraction. » Aucune
// somme n'est donc demandée au serveur avec une clé de service, et aucun `count` n'est calculé sur
// une table que l'appelant ne lit pas : les lignes sont lues sous l'identité de l'appelant, puis
// additionnées ici. Le total d'un profil restreint DIFFÈRE de celui d'un administrateur, et cette
// différence est exactement ce que la Definition of Done de `CRM-086` demande de prouver.
//
// AUCUN `?? 0` N'EST ÉCRIT SUR `actual_cost`, jamais, nulle part. Le §2.3 pose que « `actual_cost`
// nul n'est pas zéro » et le §4.4 que « une ligne sans `actual_cost` ne compte pas dans la barre du
// réel ». Une coercition ici transformerait un retard de saisie en économie, ce qui est nommé
// « la principale façon dont un tel écran ment ». C'est la même règle que `calculerTotaux` de
// `card-costs.ts` applique déjà sur la fiche d'affaire, et les deux doivent rendre le même nombre.

import { classerErreur, enErreur, pret, type EtatAsync } from './async'
import type { Database } from './database.types'
import type { ClientCrm } from './supabase'

// ---------------------------------------------------------------------------------------------
// L'agrégat, et ce qu'il refuse de taire
// ---------------------------------------------------------------------------------------------

/**
 * Ce qu'une paire de barres porte : l'estimé, le réel, et ce que le réel ne dit pas.
 *
 * LES DEUX DERNIERS CHAMPS NE SONT PAS DÉCORATIFS. Le §4.4 exige la mention « n lignes sans coût
 * réel saisi, pour m € de prévisionnel » dès qu'une ligne n'a pas de réel, et le §4.8 exige que le
 * badge de l'onglet « À saisir » porte le MÊME nombre : « s'ils divergeaient, l'un des deux
 * mentirait ». Les porter dans l'agrégat plutôt que de les recalculer ailleurs est ce qui rend
 * cette égalité structurelle au lieu d'être une coïncidence à surveiller.
 *
 * `depassement` est dérivé et non stocké : la barre du réel passe en `--color-danger` lorsqu'elle
 * dépasse le prévisionnel (`docs/DESIGN_SYSTEM.md` §5.30). Il se lit `reel > estime` et rien
 * d'autre — en particulier PAS « le réel est proche de l'estimé », qui inventerait un seuil que
 * personne n'a arbitré.
 */
export type AgregatCouts = {
	readonly estime: number
	readonly reel: number
	readonly sansReel: number
	readonly estimeSansReel: number
}

export const AGREGAT_NUL: AgregatCouts = { estime: 0, reel: 0, sansReel: 0, estimeSansReel: 0 }

/** La barre du réel dépasse-t-elle celle du prévisionnel — `docs/DESIGN_SYSTEM.md` §5.30. */
export const depasse = (agregat: AgregatCouts): boolean => agregat.reel > agregat.estime

/**
 * La forme minimale d'une ligne pour être agrégée.
 *
 * Un type STRUCTUREL et non la ligne complète : les trois écrans lisent des colonnes différentes —
 * le détail d'un budget veut l'affaire et l'occurrence, l'histogramme du track n'en a que faire —,
 * et faire dépendre l'addition de la forme la plus riche obligerait chaque appelant à fabriquer
 * des champs qu'il n'utilise pas.
 */
export type LigneAgregeable = {
	readonly estimated_cost: number
	readonly actual_cost: number | null
}

/**
 * Additionne des lignes en un agrégat.
 *
 * `actual_cost` NUL N'ENTRE PAS DANS `reel` et incrémente `sansReel` : c'est la totalité de la
 * règle du §4.4, écrite une fois pour les trois écrans. Le montant estimé de ces lignes est
 * accumulé à part, dans `estimeSansReel`, parce que la mention du §4.4 le nomme — « pour m € de
 * prévisionnel » — et qu'il ne se déduit pas de l'estimé total.
 *
 * Aucune contrainte de signe (§2.1) : un avoir est un coût négatif légitime, et un agrégat peut
 * donc être négatif. `depasse` reste juste dans ce cas, la comparaison étant faite sur les valeurs
 * et non sur leurs valeurs absolues.
 */
export function agreger(lignes: Iterable<LigneAgregeable>): AgregatCouts {
	let estime = 0
	let reel = 0
	let sansReel = 0
	let estimeSansReel = 0
	for (const ligne of lignes) {
		estime += ligne.estimated_cost
		// Extrait dans une variable narrowie plutôt que testé par un booléen intermédiaire :
		// TypeScript ne propage pas une garde à travers un booléen, et l'assertion qu'il faudrait
		// sinon écrire affirmerait au compilateur ce que ce module refuse justement de supposer.
		const constate = ligne.actual_cost
		if (constate === null) {
			sansReel += 1
			estimeSansReel += ligne.estimated_cost
		} else {
			reel += constate
		}
	}
	return { estime, reel, sansReel, estimeSansReel }
}

// ---------------------------------------------------------------------------------------------
// L'écran de coûts du track — §4.2, §4.4, §4.7
// ---------------------------------------------------------------------------------------------

export type BudgetDeLEcran = Pick<
	Database['public']['Tables']['budgets']['Row'],
	'id' | 'name' | 'currency' | 'is_recurrent' | 'planned_amount' | 'closed_at'
>

/** Une paire de barres de l'histogramme : le budget qui la nomme, et ce qu'elle vaut. */
export type BarresBudget = {
	readonly budget: BudgetDeLEcran
	readonly agregat: AgregatCouts
}

/**
 * Un histogramme, c'est-à-dire les paires de barres d'UNE devise.
 *
 * LE GROUPEMENT PAR DEVISE N'EST PAS RÉSERVÉ AU CUMUL DU WORKSPACE, bien que seul le §4.5 l'écrive.
 * Un track peut parfaitement porter un budget en EUR et un autre en CHF — le seed en pose un —, et
 * un axe unique y placerait des francs et des euros sur la même échelle, ce qui est exactement le
 * total illisible que le §4.5 refuse. La règle « les devises ne se mélangent pas » est donc
 * appliquée partout où des barres partagent un axe.
 */
export type HistogrammeDevise = {
	readonly devise: string
	readonly barres: readonly BarresBudget[]
	/** Le total de la devise, pour la mention du §4.4 rendue sous le graphique. */
	readonly total: AgregatCouts
}

export const COLONNES_BUDGET_ECRAN =
	'id, name, currency, is_recurrent, planned_amount, closed_at, position'

/**
 * Les budgets OUVERTS d'un track et leurs lignes agrégées — le contenu du §4.2.
 *
 * DEUX REQUÊTES, ET PAS UNE PAR BUDGET. Les budgets d'abord, puis toutes leurs lignes en un seul
 * `in` : un appel par budget ferait dépendre le nombre d'allers-retours du nombre de budgets, ce
 * que `CLAUDE.md` §21 proscrit. Un `in` sur zéro identifiant n'est pas émis, sa réponse étant
 * connue d'avance.
 *
 * `closed_at is null` EST APPLIQUÉ CÔTÉ SERVEUR : le §4.2 pose qu'« un budget clôturé n'y figure
 * pas ». Ce n'est pas une règle d'autorisation — un budget clos reste parfaitement lisible, et le
 * §4.8 le liste d'ailleurs dans l'onglet « À saisir » — mais une règle d'écran, et elle est nommée
 * comme telle plutôt que présentée comme un refus du backend (`CLAUDE.md` §10).
 *
 * LES LIGNES SONT LUES SOUS L'IDENTITÉ DE L'APPELANT, et c'est le cœur du §4.5. `card_costs` exige
 * `app.can_read_card` ET `app.can_read_budget` (§3.1) : une ligne dont l'affaire est fermée à
 * l'appelant n'est simplement pas rendue, et n'entre donc pas dans la somme. Le total obtenu est
 * celui que l'appelant a le droit de connaître, jamais le total absolu.
 *
 * L'ORDRE EST `position` PUIS `name`, celui de l'administration des budgets (§4.1) : l'histogramme
 * et la table d'administration doivent présenter les mêmes budgets dans le même ordre, sans quoi
 * l'utilisateur qui passe de l'une à l'autre les recompte.
 */
export async function lireHistogrammeTrack(
	client: ClientCrm,
	idTrack: string,
): Promise<EtatAsync<readonly HistogrammeDevise[]>> {
	try {
		const budgets = await client
			.from('budgets')
			.select(COLONNES_BUDGET_ECRAN)
			.eq('track_id', idTrack)
			.is('closed_at', null)
			.order('position')
			.order('name')
		if (budgets.error !== null) {
			return enErreur(classerErreur(budgets.status, budgets.error.message))
		}

		const parBudget = await lireLignesParBudget(
			client,
			budgets.data.map((budget) => budget.id),
		)
		if (parBudget.statut !== 'pret') return parBudget

		return pret(grouperParDevise(budgets.data, parBudget.donnees))
	} catch (cause) {
		return enErreur(classerErreur(undefined, cause instanceof Error ? cause.message : String(cause)))
	}
}

/**
 * Les lignes de coût de plusieurs budgets, rangées par budget.
 *
 * UN BUDGET SANS AUCUNE LIGNE EST ABSENT DE LA CARTE, et son appelant en fait un agrégat nul — le
 * §4.7 exige « un histogramme à deux barres nulles et "aucune dépense rattachée" » plutôt qu'une
 * absence de barres. Distinguer les deux ici serait une invention : la carte dit ce que la réponse
 * porte, et c'est l'écran qui sait ce qu'une absence signifie.
 */
async function lireLignesParBudget(
	client: ClientCrm,
	idsBudgets: readonly string[],
): Promise<EtatAsync<ReadonlyMap<string, readonly LigneAgregeable[]>>> {
	if (idsBudgets.length === 0) return pret(new Map())
	const lignes = await client
		.from('card_costs')
		.select('id, budget_id, estimated_cost, actual_cost')
		.in('budget_id', idsBudgets)
	if (lignes.error !== null) {
		return enErreur(classerErreur(lignes.status, lignes.error.message))
	}
	const parBudget = new Map<string, LigneAgregeable[]>()
	for (const ligne of lignes.data) {
		const liste = parBudget.get(ligne.budget_id) ?? []
		liste.push({ estimated_cost: ligne.estimated_cost, actual_cost: ligne.actual_cost })
		parBudget.set(ligne.budget_id, liste)
	}
	return pret(parBudget)
}

/**
 * Range les budgets par devise et calcule chaque agrégat.
 *
 * Fonction PURE et exportée : c'est elle que les tests unitaires éprouvent sur des jeux construits,
 * sans pile ni client. L'ordre des devises suit celui des budgets — la première rencontrée d'abord
 * — plutôt qu'un tri alphabétique qui ferait passer CHF devant EUR sur un track dont tout est en
 * euros sauf un budget. Même convention que `calculerTotaux` de `card-costs.ts`.
 */
export function grouperParDevise(
	budgets: readonly BudgetDeLEcran[],
	lignesParBudget: ReadonlyMap<string, readonly LigneAgregeable[]>,
): readonly HistogrammeDevise[] {
	const parDevise = new Map<string, BarresBudget[]>()
	for (const budget of budgets) {
		const barres = parDevise.get(budget.currency) ?? []
		barres.push({ budget, agregat: agreger(lignesParBudget.get(budget.id) ?? []) })
		parDevise.set(budget.currency, barres)
	}
	return [...parDevise.entries()].map(([devise, barres]) => ({
		devise,
		barres,
		total: cumuler(barres.map((barre) => barre.agregat)),
	}))
}

/**
 * Additionne des agrégats déjà calculés.
 *
 * Distinct d'`agreger`, qui part des lignes : cumuler des agrégats préserve `sansReel`, qui est un
 * COMPTE de lignes et non un montant. Le recalculer depuis les lignes une seconde fois exposerait
 * les deux chemins à diverger, et c'est précisément la divergence que le §4.8 interdit entre la
 * mention du §4.4 et le badge de l'onglet.
 */
export function cumuler(agregats: Iterable<AgregatCouts>): AgregatCouts {
	let total = AGREGAT_NUL
	for (const agregat of agregats) {
		total = {
			estime: total.estime + agregat.estime,
			reel: total.reel + agregat.reel,
			sansReel: total.sansReel + agregat.sansReel,
			estimeSansReel: total.estimeSansReel + agregat.estimeSansReel,
		}
	}
	return total
}
