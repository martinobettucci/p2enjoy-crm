// @spec CRM-084 (docs/BACKLOG.md) — budgets, occurrences et clôture, TRANCHE 2 : ce que l'écran
//       d'administration des budgets d'un track lit et écrit
// @spec docs/SPEC-costs.md §2.1 (budgets), §2.2 (occurrences), §3.1 (lecture), §3.2 (écriture),
//       §4.1 (l'écran d'administration), §4.7 (les états)
// @spec docs/SCHEMA.md §9 bis.4 (budgets), §9 bis.5 (budget_occurrences), §9 bis.7 (politiques)
// @spec docs/DESIGN_SYSTEM.md §5.13 (la surface qui accueille ce bloc)
//
// CE MODULE N'INVENTE AUCUNE RÈGLE, exactement comme `administration-arborescence.ts`. Chaque refus
// traduit ici est déjà posé et mesuré par la migration `0050` et par
// `supabase/tests/0048_budgets.test.sql`. Rien n'est anticipé pour décider si une requête part :
// l'écran envoie, puis traduit le refus reçu (`CLAUDE.md` §10). Une commande masquée sur la foi d'un
// rôle lu au chargement cacherait un geste **permis** le jour où ce rôle a changé depuis.
//
// La seule validation locale est celle de la FORME — nom non vide, devise à trois majuscules —, qui
// n'économise qu'un aller-retour dont la réponse est connue d'avance, et dont l'erreur reste
// rattrapée par le `CHECK` de la base.

import { classerErreur, enErreur, pret, type EtatAsync } from './async'
import type { Database } from './database.types'
import type { ClientCrm } from './supabase'

// ---------------------------------------------------------------------------------------------
// Ce que l'écran lit
// ---------------------------------------------------------------------------------------------

/**
 * Un budget tel que la table du §4.1 a besoin de le connaître.
 *
 * Les colonnes demandées sont exactement celles que la table rend — nom, devise, enveloppe,
 * récurrent, état — plus `position`, dont le réordonnancement a besoin, et `track_id`, qui n'est pas
 * affiché mais sert de clé de rattachement. Une requête ne rapporte que ce qui est affiché.
 */
export type BudgetAdministrable = Pick<
	Database['public']['Tables']['budgets']['Row'],
	'id' | 'track_id' | 'name' | 'currency' | 'planned_amount' | 'is_recurrent' | 'closed_at' | 'position'
>

/** Colonnes réellement demandées. Exportées pour que les preuves vérifient la requête émise. */
export const COLONNES_BUDGET_ADMIN =
	'id, track_id, name, currency, planned_amount, is_recurrent, closed_at, position'

/**
 * Les budgets d'un **seul** track, dans l'ordre d'affichage.
 *
 * `inclureClotures` retire le filtre `closed_at=is.null` — c'est l'interrupteur « afficher les
 * budgets clôturés » du §4.1, éteint par défaut. Le filtre reste **côté serveur** dans les deux cas,
 * pour la même raison que sur les tracks archivés : lire toutes les lignes pour en masquer la moitié
 * dans le navigateur ferait transiter ce que l'écran ne montre pas.
 *
 * L'ordre est `position` puis `name`, celui de toutes les listes ordonnées du produit
 * (`docs/SPEC-tracks.md` §3) : le budget porte une `position` attribuée par trigger, et le nom ne
 * départage que les positions égales.
 *
 * AUCUN FILTRE DE CORBEILLE ICI, et c'est une différence assumée avec `lireTracksAdministrables` :
 * `budgets` ne porte pas de `deleted_at` — un budget ne se supprime pas, il se clôture
 * (`docs/SPEC-costs.md` §3.2). Ajouter `is('deleted_at', null)` filtrerait sur une colonne
 * inexistante et ferait échouer la lecture entière.
 */
export async function lireBudgetsAdministrables(
	client: ClientCrm,
	trackId: string,
	inclureClotures: boolean,
): Promise<EtatAsync<readonly BudgetAdministrable[]>> {
	try {
		const base = client.from('budgets').select(COLONNES_BUDGET_ADMIN).eq('track_id', trackId)
		const filtre = inclureClotures ? base : base.is('closed_at', null)
		const reponse = await filtre.order('position').order('name')
		if (reponse.error !== null) {
			return enErreur(classerErreur(reponse.status, reponse.error.message))
		}
		return pret(reponse.data)
	} catch (cause) {
		return enErreur(classerErreur(undefined, cause instanceof Error ? cause.message : String(cause)))
	}
}

/**
 * Le nombre d'occurrences **ouvertes** de chaque budget récurrent, tel que la colonne du §4.1
 * l'affiche.
 *
 * UNE SEULE REQUÊTE POUR TOUS LES BUDGETS, et non une par ligne : la table en affiche autant qu'il y
 * a de budgets récurrents sur le track, et une requête par ligne multiplierait les allers-retours
 * sans rien ajouter. Les identifiants sont passés en `in`, donc le filtre reste côté serveur.
 *
 * `closed_at=is.null` porte sur l'OCCURRENCE, pas sur le budget : « une occurrence se clôture
 * indépendamment de son budget » (`docs/SPEC-costs.md` §2.2). Un budget ouvert peut donc n'avoir que
 * des occurrences closes, et la colonne affiche alors zéro — ce qui est l'information, pas un blanc.
 *
 * LA LISTE VIDE NE DÉCLENCHE AUCUNE REQUÊTE. Un `in` sur zéro identifiant est une requête dont la
 * réponse est connue, et PostgREST rend de surcroît un filtre `in.()` que rien n'oblige à accepter.
 */
export async function compterOccurrencesOuvertes(
	client: ClientCrm,
	idsBudgets: readonly string[],
): Promise<EtatAsync<Readonly<Record<string, number>>>> {
	if (idsBudgets.length === 0) return pret({})
	try {
		const reponse = await client
			.from('budget_occurrences')
			.select('id, budget_id')
			.in('budget_id', [...idsBudgets])
			.is('closed_at', null)
		if (reponse.error !== null) {
			return enErreur(classerErreur(reponse.status, reponse.error.message))
		}
		const comptes: Record<string, number> = {}
		for (const occurrence of reponse.data) {
			comptes[occurrence.budget_id] = (comptes[occurrence.budget_id] ?? 0) + 1
		}
		return pret(comptes)
	} catch (cause) {
		return enErreur(classerErreur(undefined, cause instanceof Error ? cause.message : String(cause)))
	}
}

// ---------------------------------------------------------------------------------------------
// Validation de forme
// ---------------------------------------------------------------------------------------------

/**
 * Motif d'une devise, **copié de la contrainte de la base** — `CHECK (currency ~ '^[A-Z]{3}$')`
 * (`supabase/migrations/0050_budgets.sql` §1.1, `docs/SPEC-costs.md` §2.1).
 *
 * Il est exporté pour que le test unitaire compare les deux écritures. Ce n'est pas la règle : la
 * règle est le `CHECK`, et le `23514` reste traité par `classerRefusBudget`. Même position que
 * `MOTIF_SLUG` dans `administration-arborescence.ts`.
 */
export const MOTIF_DEVISE = /^[A-Z]{3}$/

export const deviseConforme = (devise: string): boolean => MOTIF_DEVISE.test(devise)

/** `app.btrim_blancs(name) <> ''`, la contrainte de la base, lue depuis l'interface. */
export const nomBudgetConforme = (nom: string): boolean => nom.trim() !== ''

/**
 * Lit l'enveloppe saisie, qui est **facultative** (`docs/SPEC-costs.md` §2.1).
 *
 * Trois issues, et la troisième est celle qui compte : un champ vide vaut `null` — l'enveloppe n'est
 * pas décidée —, un nombre vaut ce nombre, et une saisie non numérique est `invalide`. Confondre les
 * deux premières enverrait `0` pour un champ vide, c'est-à-dire « enveloppe nulle décidée » là où
 * l'utilisateur n'a rien décidé : exactement la valeur par défaut trompeuse que `CLAUDE.md` §18
 * proscrit.
 *
 * AUCUNE CONTRAINTE DE SIGNE (§2.1) : un avoir ou un remboursement sont des montants négatifs
 * légitimes, et la base ne les refuse pas non plus.
 */
export type Enveloppe =
	| { readonly statut: 'absente' }
	| { readonly statut: 'lue'; readonly montant: number }
	| { readonly statut: 'invalide' }

export function lireEnveloppe(saisie: string): Enveloppe {
	const nettoyee = saisie.trim()
	if (nettoyee === '') return { statut: 'absente' }
	// `Number` et non `parseFloat` : `parseFloat('12abc')` rend 12 en ignorant la queue, ce qui
	// accepterait une saisie que personne n'a voulue.
	const montant = Number(nettoyee)
	if (!Number.isFinite(montant)) return { statut: 'invalide' }
	return { statut: 'lue', montant }
}

// ---------------------------------------------------------------------------------------------
// Les refus
// ---------------------------------------------------------------------------------------------

/**
 * Les refus qu'une écriture de budget peut recevoir, tels que l'écran doit les présenter.
 *
 * Chacun appelle un geste différent de l'utilisateur — changer de nom, vider les occurrences,
 * renoncer —, et les confondre sous « une erreur est survenue » serait la valeur par défaut
 * trompeuse de `CLAUDE.md` §18.
 */
export type NatureRefusBudget =
	/** `403`/`401` — `42501`. Seul un administrateur du workspace écrit un budget (§3.2). */
	| 'forbidden'
	/**
	 * `23505` — l'index d'unicité **partiel** `budgets_track_name_ouvert_key`. Il ne porte que sur
	 * les budgets OUVERTS (§2.1) : ce refus survient donc aussi à la RÉOUVERTURE d'un budget clos
	 * dont le nom a été repris entre-temps, et le texte doit le dire.
	 */
	| 'nom-pris'
	/** `23514` — un `CHECK` de forme : nom vide, devise hors motif. */
	| 'forme-refusee'
	/**
	 * `23514` levé par `app.budgets_verifier_recurrence` : retirer la récurrence d'un budget qui
	 * porte encore des occurrences. Le geste attendu n'est PAS le même que pour un `CHECK` de forme
	 * — il faut vider les occurrences, pas corriger un champ.
	 */
	| 'recurrence-occupee'
	/** `23503` — clé étrangère : le track a disparu. */
	| 'reference-absente'
	| 'network'
	| 'unknown'

export type RefusBudget = {
	readonly nature: NatureRefusBudget
	readonly detail: string
}

/**
 * Fragment stable du message levé par `app.budgets_verifier_recurrence`
 * (`supabase/migrations/0050_budgets.sql` §3).
 *
 * C'EST LA SEULE INSPECTION DE TEXTE DE CE MODULE, et c'est le même compromis, assumé pour la même
 * raison, que `NOM_CONTRAINTE_WORKFLOW` dans `administration-arborescence.ts` : le trigger et les
 * `CHECK` de forme partagent le SQLSTATE `23514`, et rien d'autre que le message ne les sépare —
 * PostgREST n'expose pas le nom de la contrainte hors du message.
 *
 * Le fragment retenu est celui que la migration écrit, et `scripts/verify-budgets.sh` vérifie qu'il
 * s'y trouve encore : une dérive entre les deux fichiers est ainsi mesurée, pas découverte à
 * l'usage.
 */
export const FRAGMENT_RECURRENCE_OCCUPEE = 'avant de le rendre non récurrent'

/**
 * Classe un refus d'écriture sur le **code PostgreSQL** d'abord, le **code HTTP** ensuite, et jamais
 * sur le texte du message — la règle de `classerErreur`, reprise sans exception, à la seule réserve
 * du fragment ci-dessus.
 *
 * L'ORDRE COMPTE, et il est celui d'`administration-arborescence.ts` : un `42501` remonte en `403`
 * au niveau HTTP, mais un refus de `CHECK` remonte lui aussi avec un statut d'erreur ; classer par
 * le statut d'abord rangerait les seconds avec les premiers et dirait « vous n'avez pas le droit »
 * là où c'est le nom qui est mauvais.
 */
export function classerRefusBudget(
	statutHttp: number | undefined,
	code: string | undefined,
	detail: string,
): RefusBudget {
	if (code === '23505') return { nature: 'nom-pris', detail }
	if (code === '23503') return { nature: 'reference-absente', detail }
	if (code === '23514') {
		return detail.includes(FRAGMENT_RECURRENCE_OCCUPEE)
			? { nature: 'recurrence-occupee', detail }
			: { nature: 'forme-refusee', detail }
	}
	if (statutHttp === 401 || statutHttp === 403) return { nature: 'forbidden', detail }
	if (statutHttp === undefined || statutHttp === 0) return { nature: 'network', detail }
	return { nature: 'unknown', detail }
}

/**
 * Résultat d'une écriture.
 *
 * `sans-effet` n'est ni un succès ni une erreur, et il est ici le refus le plus FRÉQUENT : les
 * politiques d'écriture de `0050` filtrent par leur clause `USING`, PostgREST rend alors `200` et
 * **zéro ligne**. C'est la distinction que la Definition of Done de `CRM-084` exige et que la base
 * ne porte pas : `403 / 42501` quand un `WITH CHECK` lève, `200 []` quand un `USING` filtre.
 */
export type ResultatBudget =
	| { readonly statut: 'applique' }
	| { readonly statut: 'sans-effet' }
	| { readonly statut: 'refus'; readonly refus: RefusBudget }

/** Enveloppe commune : aucune écriture de ce module ne lève, toutes rendent un résultat classé. */
async function executer(
	appel: () => PromiseLike<{
		error: { code?: string; message: string } | null
		status: number
		data: unknown[] | null
	}>,
): Promise<ResultatBudget> {
	try {
		const reponse = await appel()
		if (reponse.error !== null) {
			return {
				statut: 'refus',
				refus: classerRefusBudget(reponse.status, reponse.error.code, reponse.error.message),
			}
		}
		// `select()` accompagne chaque écriture précisément pour que ce comptage existe : sans lui,
		// PostgREST ne rend aucun corps et « zéro ligne touchée » serait indistinguable d'un succès.
		if (reponse.data !== null && reponse.data.length === 0) return { statut: 'sans-effet' }
		return { statut: 'applique' }
	} catch (cause) {
		return {
			statut: 'refus',
			refus: classerRefusBudget(
				undefined,
				undefined,
				cause instanceof Error ? cause.message : String(cause),
			),
		}
	}
}

// ---------------------------------------------------------------------------------------------
// Les écritures
// ---------------------------------------------------------------------------------------------

export type CreationBudget = {
	readonly idTrack: string
	readonly nom: string
	readonly devise: string
	readonly enveloppe: number | null
	readonly recurrent: boolean
}

/**
 * Crée un budget.
 *
 * `position` EST ENVOYÉE À `null`, et pour la raison déjà mesurée sur les tracks : le trigger
 * `BEFORE INSERT` reçoit `new.position` à `NULL` que le client l'ait omise ou écrite explicitement,
 * et place alors le budget en fin de liste. L'assertion de type est nécessaire parce que le
 * générateur de `CRM-006` **ne voit pas les triggers** et déclare obligatoire une colonne `NOT NULL`
 * sans défaut de colonne — la limite est déjà nommée dans `database.types.test-d.ts`.
 *
 * `closed_at` n'est JAMAIS envoyé à la création : un budget naît ouvert, et la clôture est un geste
 * distinct (§3.2) que la table rend par sa propre commande.
 *
 * `created_by` n'est pas envoyé non plus : c'est une TRACE posée par la base, jamais un droit
 * (`supabase/migrations/0050_budgets.sql` §1), et l'auteur d'un budget n'en obtient aucun privilège.
 */
export async function creerBudget(
	client: ClientCrm,
	creation: CreationBudget,
): Promise<ResultatBudget> {
	return executer(() =>
		client
			.from('budgets')
			.insert({
				track_id: creation.idTrack,
				name: creation.nom,
				currency: creation.devise,
				planned_amount: creation.enveloppe,
				is_recurrent: creation.recurrent,
				position: null,
			} as unknown as Database['public']['Tables']['budgets']['Insert'])
			.select('id'),
	)
}

export type ModificationBudget = {
	readonly nom: string
	readonly devise: string
	readonly enveloppe: number | null
	readonly recurrent: boolean
}

/**
 * Renomme un budget, le dote, et change sa récurrence — les quatre gestes que le §3.2 nomme sous
 * « créer, renommer, doter, rendre récurrent ».
 *
 * `closed_at` n'y figure pas : la clôture et la réouverture ont leur propre fonction, parce qu'elles
 * ont leurs propres refus — un nom repris entre-temps fait échouer la réouverture en `23505`, et ce
 * refus n'a rien à dire à qui renomme.
 */
export async function modifierBudget(
	client: ClientCrm,
	id: string,
	modification: ModificationBudget,
): Promise<ResultatBudget> {
	return executer(() =>
		client
			.from('budgets')
			.update({
				name: modification.nom,
				currency: modification.devise,
				planned_amount: modification.enveloppe,
				is_recurrent: modification.recurrent,
			})
			.eq('id', id)
			.select('id'),
	)
}

/** Écrit la position calculée par `calculerDeplacement`. Une ligne, une écriture. */
export async function deplacerBudget(
	client: ClientCrm,
	id: string,
	position: number,
): Promise<ResultatBudget> {
	return executer(() => client.from('budgets').update({ position }).eq('id', id).select('id'))
}

/**
 * Clôture un budget, ou le rouvre.
 *
 * LA CLÔTURE EST RÉVERSIBLE, ET SA SEULE LIMITE EST NOMMÉE (`docs/BACKLOG.md`, `CRM-084`) : remettre
 * `closed_at` à nul est une mise à jour qu'aucune garde n'interdit, mais elle échoue en `23505` si
 * le nom du budget a été REPRIS entre-temps — conséquence directe et assumée du fait que la clôture
 * libère le nom (§2.1). Le refus est classé `nom-pris`, et l'écran le dit dans ces termes-là.
 *
 * L'horodatage est celui du **client**, faute d'un défaut de colonne ou d'une RPC qui le prendrait
 * du serveur — même approximation que `archived_at`, et même limite nommée : `closed_at` sert à
 * distinguer ouvert de clos, jamais à mesurer une durée. Aucune règle du produit ne dépend de sa
 * valeur exacte, seule sa nullité compte.
 */
export async function cloturerBudget(
	client: ClientCrm,
	id: string,
	clore: boolean,
	maintenant: () => string = () => new Date().toISOString(),
): Promise<ResultatBudget> {
	return executer(() =>
		client
			.from('budgets')
			.update({ closed_at: clore ? maintenant() : null })
			.eq('id', id)
			.select('id'),
	)
}
