// @spec CRM-084 (docs/BACKLOG.md) — budgets, occurrences et clôture, TRANCHE 3b : ce que la
//       sous-surface des occurrences d'un budget récurrent lit et écrit
// @spec docs/SPEC-costs.md §2.2 (occurrences), §3.1 (lecture), §3.2 (écriture), §4.1 bis (la
//       sous-surface, son contrat d'écriture et son dictionnaire fermé de refus)
// @spec docs/SCHEMA.md §9 bis.5 (budget_occurrences), §9 bis.7 (politiques)
// @spec docs/DESIGN_SYSTEM.md §5.47 (la forme de la sous-surface), §5.13 (le bloc qui l'accueille)
//
// CE MODULE N'INVENTE AUCUNE RÈGLE, exactement comme `budgets.ts` dont il est le pendant. Chaque
// refus traduit ici est déjà posé et MESURÉ sur la pile seedée le 2026-08-28, mesures reportées au
// §4.1 bis.4 et §4.1 bis.5 de la spécification. Rien n'est anticipé pour décider si une requête
// part : l'écran envoie, puis traduit le refus reçu (`CLAUDE.md` §10).
//
// IL N'Y A AUCUNE FONCTION `SECURITY DEFINER` DERRIÈRE CES QUATRE GESTES, et c'est un choix écrit
// au §4.1 bis.3 : la migration `0050` n'expose que la table et ses politiques, qui suffisent. En
// ajouter une aurait posé un second chemin devant une règle déjà appliquée, et deux chemins
// divergent au premier ajustement.

import { classerErreur, enErreur, pret, type EtatAsync } from './async'
import type { Database } from './database.types'
import type { ClientCrm } from './supabase'

// ---------------------------------------------------------------------------------------------
// Ce que la sous-surface lit
// ---------------------------------------------------------------------------------------------

/**
 * Une occurrence telle que la liste du §4.1 bis.1 a besoin de la connaître.
 *
 * Les colonnes demandées sont exactement celles que la liste rend — libellé, période, enveloppe,
 * état — plus `id` et `budget_id`, clés de rattachement. Une requête ne rapporte que ce qui est
 * affiché.
 */
export type OccurrenceAdministrable = Pick<
	Database['public']['Tables']['budget_occurrences']['Row'],
	'id' | 'budget_id' | 'label' | 'period_start' | 'period_end' | 'planned_amount' | 'closed_at'
>

/** Colonnes réellement demandées. Exportées pour que les preuves vérifient la requête émise. */
export const COLONNES_OCCURRENCE_ADMIN =
	'id, budget_id, label, period_start, period_end, planned_amount, closed_at'

/**
 * Les occurrences d'un **seul** budget, dans l'ordre d'affichage.
 *
 * AUCUN FILTRE DE CLÔTURE, et c'est une différence assumée avec `lireBudgetsAdministrables`, qui en
 * pose un. Le §4.1 bis.1 la motive : l'onglet « À saisir » du §4.8 liste précisément les lignes des
 * occurrences closes — « c'est après la clôture que les factures arrivent » —, et une liste qui
 * cacherait par défaut la moitié de son objet ferait chercher ailleurs ce qui est là. Elle reste
 * courte par construction : le §2.2 interdit toute génération automatique.
 *
 * L'ordre est `period_start` DÉCROISSANTE puis `label` croissant, celui du §4.1 bis.1 : la plus
 * récente d'abord, parce qu'on ouvre « mars » quand « février » est encore la dernière ligne.
 * `nullsFirst: false` est explicite parce que les périodes sont FACULTATIVES (§2.2) : une occurrence
 * sans période irait en tête sous le défaut de PostgreSQL pour un tri descendant, et ferait passer
 * la moins renseignée devant la plus récente.
 */
export async function lireOccurrences(
	client: ClientCrm,
	idBudget: string,
): Promise<EtatAsync<readonly OccurrenceAdministrable[]>> {
	try {
		const reponse = await client
			.from('budget_occurrences')
			.select(COLONNES_OCCURRENCE_ADMIN)
			.eq('budget_id', idBudget)
			.order('period_start', { ascending: false, nullsFirst: false })
			.order('label', { ascending: true })
		if (reponse.error !== null) {
			return enErreur(classerErreur(reponse.status, reponse.error.message))
		}
		return pret(reponse.data)
	} catch (cause) {
		return enErreur(classerErreur(undefined, cause instanceof Error ? cause.message : String(cause)))
	}
}

// ---------------------------------------------------------------------------------------------
// Validation de forme
// ---------------------------------------------------------------------------------------------

/**
 * Le libellé, tel que le `CHECK` de la base l'exige — `app.btrim_blancs(label) <> ''`
 * (`supabase/migrations/0050_budgets.sql` §2, `docs/SPEC-costs.md` §2.2).
 *
 * C'est la SEULE validation locale de ce module, et elle n'économise qu'un aller-retour dont la
 * réponse est connue d'avance. Elle ne remplace pas la règle : le `23514` reste traité par
 * `classerRefusOccurrence`, et un libellé vide envoyé malgré tout serait refusé par la base.
 *
 * ELLE NE REPLIE PAS LA CASSE, et c'est délibéré : la mesure M5 du §4.1 bis.5 établit que l'index
 * d'unicité porte sur `app.btrim_blancs(label)`, qui retire les blancs de tête et de queue **sans**
 * toucher à la casse — exactement comme celui des budgets sur leur nom. Replier la casse ici
 * refuserait localement ce que la base accepte.
 */
export const libelleOccurrenceConforme = (libelle: string): boolean => libelle.trim() !== ''

/**
 * Lit une enveloppe saisie, sur le patron de `lireEnveloppe` de `budgets.ts`.
 *
 * LE VIDE REND `null` ET NON ZÉRO : `planned_amount` est facultatif (§2.2), et « aucune enveloppe »
 * n'est pas « une enveloppe de zéro ». Confondre les deux poserait à l'écran une décision que
 * personne n'a prise, et le §4.1 rend précisément une cellule VIDE dans ce cas.
 */
export type EnveloppeOccurrence =
	| { readonly statut: 'absente' }
	| { readonly statut: 'lue'; readonly montant: number }
	| { readonly statut: 'illisible' }

export function lireEnveloppeOccurrence(saisie: string): EnveloppeOccurrence {
	const texte = saisie.trim()
	if (texte === '') return { statut: 'absente' }
	const montant = Number(texte.replace(',', '.'))
	if (!Number.isFinite(montant)) return { statut: 'illisible' }
	return { statut: 'lue', montant }
}

/**
 * Lit une date de période. Le vide rend `null` — les deux bornes sont facultatives (§2.2) et
 * **purement descriptives** : elles ne contraignent rien, et aucune ligne de coût n'est refusée
 * parce que sa date en sortirait.
 *
 * AUCUNE COHÉRENCE N'EST EXIGÉE ENTRE LES DEUX BORNES, et ce n'est pas un oubli : ni le §2.2, ni un
 * `CHECK` de la migration `0050` ne demandent que la fin suive le début. En l'imposant ici, l'écran
 * poserait une règle métier que la base ignore, et deux vérités coexisteraient sur le même fait.
 */
export const lireBornePeriode = (saisie: string): string | null =>
	saisie.trim() === '' ? null : saisie.trim()

// ---------------------------------------------------------------------------------------------
// Les refus
// ---------------------------------------------------------------------------------------------

/**
 * Les refus qu'une écriture d'occurrence peut recevoir, tels que la sous-surface doit les
 * présenter. Le dictionnaire est FERMÉ, et il est celui du §4.1 bis.4.
 *
 * Chacun appelle un geste différent — rendre le budget récurrent, changer de libellé, clôturer
 * plutôt que retirer, renoncer —, et les confondre sous « une erreur est survenue » serait la
 * valeur par défaut trompeuse de `CLAUDE.md` §18.
 */
export type NatureRefusOccurrence =
	/** M2 — `403`/`42501`. Seul un administrateur du workspace gère les occurrences (§3.2). */
	| 'forbidden'
	/** M5 — `23505`, `budget_occurrences_budget_label_key` : le libellé est déjà pris sur ce budget. */
	| 'libelle-pris'
	/** M10 — `23514`, `budget_occurrences_label_check` : le libellé est vide. */
	| 'libelle-vide'
	/**
	 * M4 — `23514` levé par `app.budget_occurrences_verifier_recurrence` : une occurrence sur un
	 * budget non récurrent. Le geste attendu n'est PAS celui d'un `CHECK` de forme — il faut rendre
	 * le budget récurrent, pas corriger un champ.
	 */
	| 'budget-non-recurrent'
	/**
	 * M11 — `23503`, `card_costs_occurrence_id_fkey` : le retrait d'une occurrence que des lignes de
	 * coût référencent. C'est la borne que la base pose elle-même au cinquième geste du §4.1 bis.2,
	 * et l'écran nomme le geste de remplacement plutôt que de recopier le corps du serveur.
	 */
	| 'occurrence-referencee'
	/** `23503` autrement — le budget visé a disparu, ou le trigger le déclare inexistant. */
	| 'reference-absente'
	| 'network'
	| 'unknown'

export type RefusOccurrence = {
	readonly nature: NatureRefusOccurrence
	readonly detail: string
}

/**
 * Fragment stable du message levé par `app.budget_occurrences_verifier_recurrence`
 * (`supabase/migrations/0050_budgets.sql` §3).
 *
 * Même compromis, assumé pour la même raison, que `FRAGMENT_RECURRENCE_OCCUPEE` dans `budgets.ts` :
 * le trigger et le `CHECK` de forme partagent le SQLSTATE `23514`, et rien d'autre que le message ne
 * les sépare — PostgREST n'expose pas le nom de la contrainte hors du message.
 */
export const FRAGMENT_BUDGET_NON_RECURRENT = "une occurrence n'existe que sur un budget récurrent"

/**
 * Nom de la clé étrangère que `card_costs` pose sur `budget_occurrences`.
 *
 * Seconde et DERNIÈRE inspection de texte de ce module, et elle est nécessaire pour la même raison
 * que la première : deux causes distinctes partagent le `23503` — le retrait d'une occurrence
 * référencée (M11) et un budget visé inexistant —, et elles n'appellent pas le même geste. Le nom de
 * la contrainte figure dans le message de PostgreSQL ; `scripts/verify-budgets.sh` vérifiera qu'il
 * n'a pas dérivé.
 */
export const NOM_CONTRAINTE_OCCURRENCE_REFERENCEE = 'card_costs_occurrence_id_fkey'

/**
 * Classe un refus d'écriture sur le **code PostgreSQL** d'abord, le **code HTTP** ensuite, et jamais
 * sur le texte du message hors les deux fragments ci-dessus.
 *
 * L'ORDRE COMPTE, et il est celui de `classerRefusBudget` : un `42501` remonte en `403` au niveau
 * HTTP, mais un refus de `CHECK` remonte lui aussi avec un statut d'erreur ; classer par le statut
 * d'abord rangerait les seconds avec les premiers et dirait « vous n'avez pas le droit » là où c'est
 * le libellé qui est vide.
 */
export function classerRefusOccurrence(
	statutHttp: number | undefined,
	code: string | undefined,
	detail: string,
): RefusOccurrence {
	if (code === '23505') return { nature: 'libelle-pris', detail }
	if (code === '23503') {
		return detail.includes(NOM_CONTRAINTE_OCCURRENCE_REFERENCEE)
			? { nature: 'occurrence-referencee', detail }
			: { nature: 'reference-absente', detail }
	}
	if (code === '23514') {
		return detail.includes(FRAGMENT_BUDGET_NON_RECURRENT)
			? { nature: 'budget-non-recurrent', detail }
			: { nature: 'libelle-vide', detail }
	}
	if (statutHttp === 401 || statutHttp === 403) return { nature: 'forbidden', detail }
	if (statutHttp === undefined || statutHttp === 0) return { nature: 'network', detail }
	return { nature: 'unknown', detail }
}

/**
 * Résultat d'une écriture.
 *
 * `sans-effet` n'est ni un succès ni une erreur : les politiques de `0050` filtrent par leur clause
 * `USING`, PostgREST rend alors `200` et **zéro ligne**. C'est la même distinction que `budgets.ts`
 * porte, et pour la même raison : `403 / 42501` quand un `WITH CHECK` lève, `200 []` quand un
 * `USING` filtre. La troisième issue est DITE, jamais présentée comme un succès (§4.1 bis).
 */
export type ResultatOccurrence =
	| { readonly statut: 'applique' }
	| { readonly statut: 'sans-effet' }
	| { readonly statut: 'refus'; readonly refus: RefusOccurrence }

/** Enveloppe commune : aucune écriture de ce module ne lève, toutes rendent un résultat classé. */
async function executer(
	appel: () => PromiseLike<{
		error: { code?: string; message: string } | null
		status: number
		data: unknown[] | null
	}>,
): Promise<ResultatOccurrence> {
	try {
		const reponse = await appel()
		if (reponse.error !== null) {
			return {
				statut: 'refus',
				refus: classerRefusOccurrence(reponse.status, reponse.error.code, reponse.error.message),
			}
		}
		// `select()` accompagne chaque écriture précisément pour que ce comptage existe : sans lui,
		// PostgREST ne rend aucun corps et « zéro ligne touchée » serait indistinguable d'un succès.
		if (reponse.data !== null && reponse.data.length === 0) return { statut: 'sans-effet' }
		return { statut: 'applique' }
	} catch (cause) {
		return {
			statut: 'refus',
			refus: classerRefusOccurrence(
				undefined,
				undefined,
				cause instanceof Error ? cause.message : String(cause),
			),
		}
	}
}

// ---------------------------------------------------------------------------------------------
// Les écritures — les quatre du §4.1 bis.3
// ---------------------------------------------------------------------------------------------

export type CreationOccurrence = {
	readonly idBudget: string
	readonly libelle: string
	readonly debut: string | null
	readonly fin: string | null
	readonly enveloppe: number | null
}

/**
 * Ouvre une occurrence — le premier des quatre gestes du §3.2.
 *
 * `closed_at` n'est JAMAIS envoyé à la création : une occurrence naît ouverte, et la clôture est un
 * geste distinct que la liste rend par sa propre commande.
 */
export async function creerOccurrence(
	client: ClientCrm,
	creation: CreationOccurrence,
): Promise<ResultatOccurrence> {
	return executer(() =>
		client
			.from('budget_occurrences')
			.insert({
				budget_id: creation.idBudget,
				label: creation.libelle,
				period_start: creation.debut,
				period_end: creation.fin,
				planned_amount: creation.enveloppe,
			})
			.select('id'),
	)
}

export type ModificationOccurrence = {
	readonly libelle: string
	readonly debut: string | null
	readonly fin: string | null
	readonly enveloppe: number | null
}

/**
 * Libelle et dote une occurrence — les deuxième et troisième gestes du §3.2, réunis parce que ce
 * sont deux attributs d'une même ligne : les séparer aurait donné deux commandes pour un seul
 * aller-retour.
 *
 * LES TROIS ATTRIBUTS FACULTATIFS SONT TOUJOURS ENVOYÉS, Y COMPRIS NULS, et c'est la règle du
 * §4.1 bis.3. Ils sont effaçables par nature (§2.2, « facultatives ») ; les omettre au motif qu'ils
 * sont vides rendrait ineffaçable une enveloppe posée par erreur. C'est l'inverse exact du choix
 * fait pour `p_daily_quota` au §22.1 de `docs/SPEC-mail-subsystem.md`, et pour la même raison
 * retournée : là-bas un `coalesce` rendait l'omission irréversible, ici l'envoi rend l'effacement
 * possible.
 *
 * `closed_at` n'y figure pas : la clôture a sa propre fonction, parce qu'elle n'a pas les mêmes
 * refus. Et la mesure M8 du §4.1 bis.5 établit qu'une occurrence CLOSE reste modifiable — aucun
 * trigger ne s'y oppose —, ce que ce module ne contrarie donc pas : renommer et doter restent
 * offerts après la clôture, comme le §4.8 le suppose en faisant arriver les factures après.
 */
export async function modifierOccurrence(
	client: ClientCrm,
	id: string,
	modification: ModificationOccurrence,
): Promise<ResultatOccurrence> {
	return executer(() =>
		client
			.from('budget_occurrences')
			.update({
				label: modification.libelle,
				period_start: modification.debut,
				period_end: modification.fin,
				planned_amount: modification.enveloppe,
			})
			.eq('id', id)
			.select('id'),
	)
}

/**
 * Clôture une occurrence, ou la rouvre — le quatrième geste du §3.2.
 *
 * « Une occurrence se clôture indépendamment de son budget » (§2.2) : rien n'est écrit sur le budget
 * porteur, et clore la dernière occurrence ouverte ne clôt pas le budget.
 *
 * L'horodatage est celui du **client**, même approximation et même limite nommée que
 * `cloturerBudget` : `closed_at` sert à distinguer ouvert de clos, jamais à mesurer une durée. Seule
 * sa nullité compte pour le sélecteur du §4.6, qui ne propose que les occurrences ouvertes.
 */
export async function cloturerOccurrence(
	client: ClientCrm,
	id: string,
	clore: boolean,
	maintenant: () => string = () => new Date().toISOString(),
): Promise<ResultatOccurrence> {
	return executer(() =>
		client
			.from('budget_occurrences')
			.update({ closed_at: clore ? maintenant() : null })
			.eq('id', id)
			.select('id'),
	)
}

/**
 * Retire une occurrence — le CINQUIÈME geste, celui que la mesure a imposé (§4.1 bis.2).
 *
 * IL N'ÉTEND AUCUN PÉRIMÈTRE : la mesure M9 établit qu'un `DELETE` direct passe déjà pour une
 * administratrice, la politique de `0050` l'accordant. Le refuser dans l'écran n'aurait rien fermé.
 *
 * SA BORNE EST CELLE DE LA BASE, PAS UNE GARDE DE CE MODULE : la mesure M11 établit qu'une
 * occurrence référencée par une ligne de coût est refusée en `23503` sur
 * `card_costs_occurrence_id_fkey`. La doctrine « un budget ne se supprime pas, il se clôture » (§3.2)
 * vise ce qu'on EFFACERAIT ; la clé étrangère protège déjà ce cas, et une occurrence ouverte par
 * erreur ne référence rien.
 */
export async function retirerOccurrence(
	client: ClientCrm,
	id: string,
): Promise<ResultatOccurrence> {
	return executer(() => client.from('budget_occurrences').delete().eq('id', id).select('id'))
}
