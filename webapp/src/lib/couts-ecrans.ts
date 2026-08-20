// @spec CRM-086 (docs/BACKLOG.md) — écrans de coûts, TRANCHES 1 et 4 : ce que les trois écrans
//       lisent et agrègent, le décompte que l'onglet « À saisir » doit rendre identique, et la
//       lecture propre à l'écran de détail d'un budget (§4.3)
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
	/**
	 * LE NOMBRE DE LIGNES AGRÉGÉES, ET IL N'EST PAS DÉCORATIF NON PLUS. Le §4.7 exige qu'un budget
	 * SANS ligne rende « deux barres nulles ET "aucune dépense rattachée" » ; or un agrégat qui ne
	 * porterait que des montants ne distingue pas « aucune dépense » de « des dépenses qui
	 * s'annulent ». Le §2.1 rend ce second cas parfaitement légitime — un avoir est un coût négatif
	 * —, et une ligne de 0 saisie exprès en est un troisième.
	 *
	 * Déduire l'état vide de `estime === 0 && reel === 0` serait donc la valeur par défaut
	 * trompeuse que `CLAUDE.md` §18 interdit : l'écran écrirait « aucune dépense rattachée » sur un
	 * budget qui en porte deux. Le compte est ajouté à la décision 476, après qu'une preuve
	 * d'interface a montré la phrase manquante sur un budget réellement vide du seed.
	 */
	readonly lignes: number
}

export const AGREGAT_NUL: AgregatCouts = {
	estime: 0,
	reel: 0,
	sansReel: 0,
	estimeSansReel: 0,
	lignes: 0,
}

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
	let compte = 0
	for (const ligne of lignes) {
		compte += 1
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
	return { estime, reel, sansReel, estimeSansReel, lignes: compte }
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
			lignes: total.lignes + agregat.lignes,
		}
	}
	return total
}

// ---------------------------------------------------------------------------------------------
// L'écran de détail d'un budget — §4.3, §4.4, §4.7
// ---------------------------------------------------------------------------------------------

/**
 * La forme d'un identifiant de budget, telle que PostgreSQL l'exige.
 *
 * Le contrôle est celui de `estFormeUuid` dans `contacts.ts`, et il vaut ici pour la raison exacte
 * qu'il y est écrite : un `id` qui n'est pas un uuid rend `400` et `22P02`, que `classerErreur`
 * range en erreur — dont l'action de reprise rejouerait la même requête pour recevoir le même
 * refus, soit une commande morte sur une adresse que l'utilisateur édite directement. La forme est
 * donc contrôlée AVANT d'émettre quoi que ce soit, et un identifiant mal formé rend le même écran
 * qu'un budget inexistant ou fermé (`docs/SPEC-permissions-rls.md` §7).
 *
 * La constante est recopiée plutôt qu'importée : `contacts.ts` porte le carnet et ses écritures,
 * et faire dépendre les écrans de coûts du carnet pour une expression régulière de dix caractères
 * créerait un lien entre deux domaines qui n'en ont aucun. L'écart est consigné au registre.
 */
const FORME_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Vrai lorsque la chaîne a la forme d'un uuid. Exportée pour être éprouvée directement. */
export function estIdentifiantBudget(valeur: string | undefined): valeur is string {
	return valeur !== undefined && FORME_UUID.test(valeur)
}

/**
 * Une occurrence telle que l'écran du §4.3 la nomme.
 *
 * `period_start` et `period_end` sont lues bien qu'elles ne contraignent RIEN (§2.2, « purement
 * descriptives ») : elles portent l'ORDRE que le §4.3 demande — « dans l'ordre des périodes puis
 * des libellés » — et précisent un libellé libre que rien n'oblige à nommer sa période.
 */
export type OccurrenceDeLEcran = Pick<
	Database['public']['Tables']['budget_occurrences']['Row'],
	'id' | 'label' | 'period_start' | 'period_end' | 'planned_amount' | 'closed_at'
>

/**
 * L'affaire d'une ligne, telle que la table du §4.3 la rend — avec de quoi l'atteindre.
 *
 * Les deux slugs sont embarqués parce que l'adresse d'une affaire les EXIGE tous les deux
 * (`/tracks/:slugTrack/:slugChannel/cards/:idCard`), et qu'aucune des deux ne se déduit de
 * l'adresse courante : la ligne de coût d'un budget peut porter sur une affaire d'un AUTRE track
 * que celui du budget — le §3.1 autorise le rattachement croisé, et l'y supposer produirait un
 * lien qui mène à un écran vide.
 */
export type AffaireDeLaLigne = {
	readonly id: string
	readonly title: string
	readonly archived_at: string | null
	readonly channels: {
		readonly slug: string
		readonly tracks: { readonly slug: string } | null
	} | null
}

/**
 * Une ligne de coût telle que la liste du §4.3 la rend : « affaire, libellé, estimé, réel, auteur ».
 *
 * `cards` et `profiles` sont déclarées NULLABLES, et ce n'est pas une précaution de style. La
 * politique de `card_costs` exige `app.can_read_card` (§3.1), donc une ligne rendue s'accompagne
 * en principe d'une affaire lisible ; mais le compilateur ne connaît pas cette implication, et
 * supposer non nul ce que PostgREST peut rendre nul est l'hypothèse tenue pour un fait que
 * `CLAUDE.md` §1 proscrit. `created_by` est en outre `on delete set null` : un profil supprimé
 * laisse réellement une ligne sans auteur, et l'écran le NOMME plutôt que de laisser une cellule
 * vide (`docs/DESIGN_SYSTEM.md` §5.16).
 */
export type LigneBudget = Pick<
	Database['public']['Tables']['card_costs']['Row'],
	'id' | 'occurrence_id' | 'label' | 'estimated_cost' | 'actual_cost' | 'created_at'
> & {
	readonly cards: AffaireDeLaLigne | null
	readonly profiles: { readonly id: string; readonly full_name: string } | null
}

/** Ce que l'écran du §4.3 lit en une fois : le budget, ses occurrences, et ses lignes. */
export type DetailBudget = {
	readonly budget: BudgetDeLEcran
	readonly occurrences: readonly OccurrenceDeLEcran[]
	readonly lignes: readonly LigneBudget[]
}

/**
 * Colonnes de la ligne détaillée, écrites **d'un seul tenant**.
 *
 * Une concaténation rendrait le type `string` et `supabase-js` cesserait d'inférer la forme de la
 * réponse — la limite déjà mesurée sur `COLONNES_LIGNE_COUT` et `COLONNES_CARD_FORMULAIRE`.
 *
 * LES DEUX RELATIONS SONT NOMMÉES PAR LEUR CLÉ ÉTRANGÈRE, ET C'EST OBLIGATOIRE POUR L'UNE D'ELLES.
 * `cards` porte DEUX clés composites vers `channels` — `cards_channel_id_workflow_id_fkey` et
 * `cards_channel_id_workspace_id_fkey` — et un `channels(...)` nu est donc AMBIGU : PostgREST
 * refuse la requête entière en `PGRST201` plutôt que d'en choisir une (mesuré par `card-costs.ts`
 * et par `contacts.ts`, qui nomment la même). La clé retenue est celle qui passe par le workspace,
 * seule dont la présence est structurellement garantie sur toute card. `profiles` n'a qu'une seule
 * clé depuis `card_costs` et n'exigerait pas d'être nommée ; elle l'est quand même, pour que
 * l'ajout d'une seconde clé demain ne casse pas cette lecture en silence.
 */
export const COLONNES_LIGNE_BUDGET =
	'id, occurrence_id, label, estimated_cost, actual_cost, created_at, cards(id, title, archived_at, channels!cards_channel_id_workspace_id_fkey(slug, tracks(slug))), profiles!card_costs_created_by_fkey(id, full_name)'

/**
 * Le budget désigné par `idBudget`, ses occurrences et ses lignes — ou `null` s'il n'est pas
 * lisible.
 *
 * **`null` recouvre TROIS situations, et c'est délibéré** : le budget n'existe pas, l'appelant n'a
 * pas le droit de le lire, ou l'identifiant n'a pas la forme d'un uuid. Les distinguer
 * renseignerait un appelant sans droit sur l'EXISTENCE d'un budget
 * (`docs/SPEC-permissions-rls.md` §7), et c'est la règle que les fiches de contact et
 * d'organisation tiennent déjà.
 *
 * **UN BUDGET CLÔTURÉ EST LU ICI, alors que le §4.2 l'exclut de l'histogramme du track.** Ce n'est
 * pas une incohérence mais la distinction que le §4.2 nomme lui-même : « un budget clôturé n'y
 * figure pas » est une règle d'ÉCRAN — il ne se propose plus —, jamais une règle d'autorisation.
 * Ses lignes restent lisibles (§2.3, « clôturer n'efface pas l'histoire »), le §4.8 les liste dans
 * l'onglet « À saisir », et une adresse qu'on a mise en signet ne doit pas cesser de répondre le
 * jour où le budget se ferme.
 *
 * **TROIS REQUÊTES, ET PAS UNE DE PLUS.** Le budget d'abord — sans lui, rien à rendre —, puis ses
 * occurrences et ses lignes. Les occurrences ne sont PAS embarquées dans la lecture du budget :
 * elles portent leur propre ordre (`period_start` puis `label`, §4.3), qu'un embed rendrait dans
 * l'ordre de la clé primaire.
 *
 * **LES LIGNES SONT LUES SOUS L'IDENTITÉ DE L'APPELANT**, comme partout dans ce module : une ligne
 * dont l'AFFAIRE est fermée à l'appelant n'est pas rendue et n'entre donc pas dans les barres. Le
 * total obtenu est celui que l'appelant a le droit de connaître, jamais le total absolu (§4.5).
 */
export async function lireDetailBudget(
	client: ClientCrm,
	idBudget: string | undefined,
): Promise<EtatAsync<DetailBudget | null>> {
	if (!estIdentifiantBudget(idBudget)) return pret(null)
	try {
		const budget = await client
			.from('budgets')
			.select(COLONNES_BUDGET_ECRAN)
			.eq('id', idBudget)
			.maybeSingle()
		if (budget.error !== null) {
			return enErreur(classerErreur(budget.status, budget.error.message))
		}
		if (budget.data === null) return pret(null)

		const occurrences = await client
			.from('budget_occurrences')
			.select('id, label, period_start, period_end, planned_amount, closed_at')
			.eq('budget_id', idBudget)
			// `nullsFirst: false` place les occurrences SANS période après celles qui en ont une :
			// le §2.2 rend les deux bornes facultatives, et une occurrence non datée n'a aucune
			// raison de précéder janvier. Le second critère est le libellé, comme le §4.3 l'écrit.
			.order('period_start', { nullsFirst: false })
			.order('label')
		if (occurrences.error !== null) {
			return enErreur(classerErreur(occurrences.status, occurrences.error.message))
		}

		const lignes = await client
			.from('card_costs')
			.select(COLONNES_LIGNE_BUDGET)
			.eq('budget_id', idBudget)
			// `created_at` puis `label` : la plus ancienne d'abord, l'ordre que `lireCoutsCard` tient
			// déjà sur la fiche d'affaire. C'est le seul qui ne bouge pas sous les doigts de qui
			// saisit — un ordre par montant ferait sauter une ligne de place à chaque correction.
			.order('created_at')
			.order('label')
		if (lignes.error !== null) {
			return enErreur(classerErreur(lignes.status, lignes.error.message))
		}

		return pret({
			budget: budget.data,
			occurrences: occurrences.data,
			lignes: lignes.data as unknown as readonly LigneBudget[],
		})
	} catch (cause) {
		return enErreur(classerErreur(undefined, cause instanceof Error ? cause.message : String(cause)))
	}
}

/**
 * Une paire de barres de l'écran du §4.3 : l'occurrence qui la nomme, et ce qu'elle vaut.
 *
 * `occurrence` vaut `null` sur un budget NON RÉCURRENT, qui « affiche une seule paire de barres »
 * (§4.3) : la paire désigne alors le budget entier, et fabriquer une occurrence fictive pour
 * uniformiser la forme inventerait un objet que la base refuse (§2.2, un trigger interdit les
 * occurrences d'un budget non récurrent).
 */
export type BarresOccurrence = {
	readonly occurrence: OccurrenceDeLEcran | null
	readonly agregat: AgregatCouts
}

/**
 * Range les lignes d'un budget par occurrence — le contenu du §4.3.
 *
 * Fonction PURE et exportée : c'est elle que les preuves unitaires éprouvent sur des jeux
 * construits, sans pile ni client, comme `grouperParDevise` pour l'écran du track.
 *
 * **UNE OCCURRENCE SANS AUCUNE LIGNE GARDE SA PAIRE DE BARRES**, à zéro. Le §4.3 demande « une
 * paire de barres par occurrence », pas « par occurrence dépensée » : une occurrence muette est
 * l'information qu'il ne s'est rien passé sur cette période, et la faire disparaître ferait lire
 * un budget comme s'il n'avait jamais porté ce mois-là. C'est la même règle que l'état vide du
 * §4.7 appliquée à un cran plus fin.
 *
 * **AUCUNE DEVISE N'EST GROUPÉE ICI, et c'est une propriété du modèle et non un oubli.** Toutes
 * les lignes d'un budget partagent SA devise — le §2.3 pose qu'« une ligne ne porte pas de colonne
 * `currency` » —, si bien qu'un écran de détail ne peut pas mêler deux monnaies sur un même axe.
 * Le groupement du §4.5 n'a d'objet que là où plusieurs budgets partagent un graphique.
 *
 * **UNE LIGNE DONT L'OCCURRENCE N'EST PAS LISTÉE N'EST PAS PERDUE.** Elle rejoint le groupe sans
 * occurrence, celui-là même que rend un budget non récurrent. Le cas ne devrait pas se produire —
 * la lecture rend toutes les occurrences du budget —, mais l'écarter silencieusement retrancherait
 * un montant du total sans que rien ne le dise, ce qui est exactement ce que le §4.4 reproche à un
 * écran de coûts.
 */
export function grouperParOccurrence(detail: DetailBudget): readonly BarresOccurrence[] {
	const connues = new Set(detail.occurrences.map((occurrence) => occurrence.id))
	const parOccurrence = new Map<string, LigneBudget[]>()
	const horsOccurrence: LigneBudget[] = []
	for (const ligne of detail.lignes) {
		const cle = ligne.occurrence_id
		if (cle === null || !connues.has(cle)) {
			horsOccurrence.push(ligne)
			continue
		}
		const liste = parOccurrence.get(cle) ?? []
		liste.push(ligne)
		parOccurrence.set(cle, liste)
	}

	const groupes: BarresOccurrence[] = detail.occurrences.map((occurrence) => ({
		occurrence,
		agregat: agreger(parOccurrence.get(occurrence.id) ?? []),
	}))

	// Le groupe sans occurrence n'est rendu que s'il porte quelque chose, SAUF sur un budget non
	// récurrent — où il est la seule paire de barres, et où son absence viderait le graphique d'un
	// budget qui n'a simplement encore aucune dépense (§4.7, « deux barres nulles »).
	if (horsOccurrence.length > 0 || !detail.budget.is_recurrent) {
		groupes.push({ occurrence: null, agregat: agreger(horsOccurrence) })
	}
	return groupes
}

/**
 * L'adresse de l'affaire d'une ligne, ou `null` lorsque ses slugs manquent.
 *
 * Rendre `null` plutôt qu'une adresse partielle est la règle d'`adresseAffaire` du carnet : un lien
 * vers `/tracks/undefined/...` mènerait à un écran que l'utilisateur croirait cassé, là où une
 * ligne sans lien dit seulement que l'affaire n'est pas adressable pour cet appelant.
 */
export function adresseAffaireLigne(ligne: LigneBudget): string | null {
	const affaire = ligne.cards
	const slugChannel = affaire?.channels?.slug
	const slugTrack = affaire?.channels?.tracks?.slug
	if (slugChannel === undefined || slugTrack === undefined || affaire === null) return null
	return `/tracks/${slugTrack}/${slugChannel}/cards/${affaire.id}`
}

/**
 * Les lignes retenues par le filtre d'occurrence du §4.3.
 *
 * `null` vaut « toutes les occurrences », qui est l'état par défaut du filtre. LE FILTRE NE
 * RETOURNE PAS AU SERVEUR : toutes les lignes du budget sont déjà en main, et une seconde requête
 * par changement de filtre ferait payer un aller-retour pour un tri de tableau (`CLAUDE.md` §21).
 */
export function filtrerParOccurrence(
	lignes: readonly LigneBudget[],
	idOccurrence: string | null,
): readonly LigneBudget[] {
	if (idOccurrence === null) return lignes
	return lignes.filter((ligne) => ligne.occurrence_id === idOccurrence)
}
