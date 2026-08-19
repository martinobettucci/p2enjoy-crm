// @spec CRM-085 (docs/BACKLOG.md) — lignes de coût d'une affaire, TRANCHE 2 : ce que la section
//       « Coûts » de la fiche d'affaire lit et écrit
// @spec docs/SPEC-costs.md §2.3 (card_costs, et « nul n'est pas zéro »), §3.1 (double condition de
//       lecture), §3.2 (qui écrit une ligne), §4.4 (ce que l'écran dit du réel inconnu),
//       §4.6 (la section de la fiche), §4.7 (les états)
// @spec docs/SCHEMA.md §9 bis.6 (card_costs), §9 bis.7 (politiques)
// @spec docs/DESIGN_SYSTEM.md §5.3 (la colonne qui accueille la section)
//
// CE MODULE N'INVENTE AUCUNE RÈGLE, exactement comme `budgets.ts`. Chaque refus traduit ici est déjà
// posé et mesuré par la migration `0051` et par `supabase/tests/0049_card_costs.test.sql`. Rien n'est
// anticipé pour décider si une requête part : la section envoie, puis traduit le refus reçu
// (`CLAUDE.md` §10).
//
// LA SEULE RESTRICTION QUI EST D'INTERFACE, ET ELLE EST NOMMÉE COMME TELLE. Le §4.6 pose que le
// sélecteur « ne propose que les budgets ouverts et lisibles du track de la card ». La base, elle,
// accepte parfaitement une ligne dont la card et le budget vivent sur deux tracks différents — le
// §3.1 nomme d'ailleurs ce cas comme celui que la double condition de lecture existe pour traiter,
// et le seed le pose. Le filtre par track est donc une aide à la saisie, jamais une règle
// d'autorisation : rien ici ne prétend le contraire, et aucune preuve de ce module ne le présente
// comme un refus du backend.

import { classerErreur, enErreur, pret, type EtatAsync } from './async'
import type { Database } from './database.types'
import type { ClientCrm } from './supabase'

// ---------------------------------------------------------------------------------------------
// Ce que la section lit
// ---------------------------------------------------------------------------------------------

/**
 * Le budget d'une ligne, tel que la section a besoin de le nommer.
 *
 * `currency` vient du BUDGET et jamais de la card (§2.3) : la ligne ne porte aucune colonne de
 * devise, précisément pour qu'un total ne puisse pas additionner deux monnaies.
 *
 * `closed_at` est lu bien qu'aucune colonne ne l'affiche : il décide de la pilule « clôturé » et,
 * surtout, il éteint les gestes qui deviendraient des refus certains — déplacer ou supprimer une
 * ligne d'un budget clos (§2.3).
 */
export type BudgetDeLaLigne = Pick<
	Database['public']['Tables']['budgets']['Row'],
	'id' | 'name' | 'currency' | 'is_recurrent' | 'closed_at'
>

export type OccurrenceDeLaLigne = Pick<
	Database['public']['Tables']['budget_occurrences']['Row'],
	'id' | 'label' | 'closed_at'
>

/**
 * Une ligne de coût telle que la section la rend.
 *
 * LES DEUX RELATIONS SONT EMBARQUÉES DANS LA MÊME REQUÊTE, et non lues ensuite par identifiant : la
 * politique de lecture de `card_costs` exige DÉJÀ `app.can_read_budget(budget_id)` (§3.1), donc une
 * ligne rendue s'accompagne nécessairement d'un budget lisible. Les relire séparément multiplierait
 * les allers-retours pour une donnée que la première réponse peut porter.
 *
 * `budgets` est néanmoins déclaré nullable : le compilateur ne connaît pas cette implication, et
 * supposer non nul ce que PostgREST peut rendre nul est exactement l'hypothèse tenue pour un fait
 * que `CLAUDE.md` §1 proscrit. La section traite le cas plutôt que de l'écarter.
 */
export type LigneCout = Pick<
	Database['public']['Tables']['card_costs']['Row'],
	'id' | 'card_id' | 'budget_id' | 'occurrence_id' | 'label' | 'estimated_cost' | 'actual_cost'
> & {
	readonly budgets: BudgetDeLaLigne | null
	readonly budget_occurrences: OccurrenceDeLaLigne | null
}

/**
 * Colonnes réellement demandées, écrites **d'un seul tenant**.
 *
 * Une concaténation rendrait le type `string` et `supabase-js` cesserait d'inférer la forme de la
 * réponse — c'est la limite déjà mesurée et consignée sur `COLONNES_CARD_FORMULAIRE`.
 */
export const COLONNES_LIGNE_COUT =
	'id, card_id, budget_id, occurrence_id, label, estimated_cost, actual_cost, budgets(id, name, currency, is_recurrent, closed_at), budget_occurrences(id, label, closed_at)'

/**
 * Les lignes de coût d'une affaire, dans l'ordre de leur apparition.
 *
 * `created_at` PUIS `label` : la plus ancienne d'abord, comme un dossier qui s'écrit. Le §4.6 ne
 * pose aucun ordre, et celui-ci est le seul qui ne bouge pas sous les doigts de qui saisit — un
 * ordre par montant ferait sauter une ligne de place à chaque correction.
 */
export async function lireCoutsCard(
	client: ClientCrm,
	idCard: string,
): Promise<EtatAsync<readonly LigneCout[]>> {
	try {
		const reponse = await client
			.from('card_costs')
			.select(COLONNES_LIGNE_COUT)
			.eq('card_id', idCard)
			.order('created_at')
			.order('label')
		if (reponse.error !== null) {
			return enErreur(classerErreur(reponse.status, reponse.error.message))
		}
		return pret(reponse.data as unknown as readonly LigneCout[])
	} catch (cause) {
		return enErreur(classerErreur(undefined, cause instanceof Error ? cause.message : String(cause)))
	}
}

/**
 * Le track de l'affaire, lu depuis son **channel** et non depuis l'adresse.
 *
 * L'ADRESSE N'EST PAS UNE SOURCE. `RouteCard` porte bien un `slugTrack`, mais rien ne confronte le
 * couple `(slugTrack, slugChannel)` de l'URL à la card qu'elle désigne — c'est **INC-065**, ouvert
 * et inchangé. Alimenter le sélecteur de budgets depuis l'adresse proposerait donc les budgets d'un
 * track quelconque sur une URL forgée, et la ligne écrite serait acceptée par la base : le §3.1
 * autorise le rattachement croisé. Le track est lu de la card elle-même, qui ne ment pas.
 *
 * `maybeSingle` et non `single` : une card refusée par la RLS rend zéro ligne, ce qui n'est pas une
 * erreur mais une absence — et `single` en ferait un `PGRST116` classé « inconnu ».
 *
 * LA RELATION EST NOMMÉE PAR SA CLÉ ÉTRANGÈRE, ET C'EST OBLIGATOIRE — MESURÉ. `cards` porte DEUX
 * clés composites vers `channels` : `cards_channel_id_workflow_id_fkey` et
 * `cards_channel_id_workspace_id_fkey`. Un `channels(track_id)` nu est donc AMBIGU, et PostgREST
 * refuse la requête entière avec `PGRST201` plutôt que d'en choisir une. La clé retenue est celle
 * qui passe par le workspace : c'est la colonne dénormalisée dont dépend la RLS, et la seule des
 * deux dont la présence est structurellement garantie sur toute card.
 */
export async function lireTrackDeLaCard(
	client: ClientCrm,
	idCard: string,
): Promise<EtatAsync<string | null>> {
	try {
		const reponse = await client
			.from('cards')
			.select('id, channels!cards_channel_id_workspace_id_fkey(track_id)')
			.eq('id', idCard)
			.maybeSingle()
		if (reponse.error !== null) {
			return enErreur(classerErreur(reponse.status, reponse.error.message))
		}
		const channel = (reponse.data as { channels: { track_id: string } | null } | null)?.channels
		return pret(channel?.track_id ?? null)
	} catch (cause) {
		return enErreur(classerErreur(undefined, cause instanceof Error ? cause.message : String(cause)))
	}
}

/** Un budget proposable par le sélecteur du §4.6, et les occurrences ouvertes qui vont avec. */
export type BudgetRattachable = {
	readonly id: string
	readonly name: string
	readonly currency: string
	readonly is_recurrent: boolean
	readonly occurrences: readonly OccurrenceDeLaLigne[]
}

export const COLONNES_BUDGET_RATTACHABLE = 'id, name, currency, is_recurrent, position'

/**
 * Les budgets qu'une ligne de cette affaire peut rejoindre — §4.6 et §4.7.
 *
 * TROIS FILTRES, ET LE TROISIÈME EST CELUI QUE LA LECTURE RAPIDE MANQUE :
 *
 *   1. le track de la card — `eq('track_id', …)`, côté serveur ;
 *   2. les budgets ouverts — `closed_at=is.null`, côté serveur : le §4.6 dit « ouverts », et le
 *      trigger de `0051` refuserait de toute façon la ligne ;
 *   3. **un budget récurrent SANS occurrence ouverte n'est pas proposé** (§4.7). Il n'est pas
 *      rattachable : le trigger exige une occurrence, et toutes les siennes sont closes. Le
 *      proposer offrirait un choix dont la seule issue est un refus.
 *
 * UNE SEULE REQUÊTE D'OCCURRENCES POUR TOUS LES BUDGETS, comme `compterOccurrencesOuvertes` : le
 * second sélecteur est alimenté par la même réponse, et choisir un budget ne déclenche aucune
 * requête. Un `in` sur zéro identifiant n'est pas émis — sa réponse est connue d'avance.
 *
 * L'ordre des occurrences est `period_start` puis `label`, celui du §4.3 : une occurrence sans
 * période décrite se range après celles qui en portent une, PostgreSQL plaçant les nuls en dernier
 * en ordre croissant.
 */
export async function lireBudgetsRattachables(
	client: ClientCrm,
	idTrack: string,
): Promise<EtatAsync<readonly BudgetRattachable[]>> {
	try {
		const budgets = await client
			.from('budgets')
			.select(COLONNES_BUDGET_RATTACHABLE)
			.eq('track_id', idTrack)
			.is('closed_at', null)
			.order('position')
			.order('name')
		if (budgets.error !== null) {
			return enErreur(classerErreur(budgets.status, budgets.error.message))
		}

		const recurrents = budgets.data.filter((budget) => budget.is_recurrent).map((b) => b.id)
		const parBudget = new Map<string, OccurrenceDeLaLigne[]>()
		if (recurrents.length > 0) {
			const occurrences = await client
				.from('budget_occurrences')
				.select('id, budget_id, label, closed_at, period_start')
				.in('budget_id', recurrents)
				.is('closed_at', null)
				.order('period_start')
				.order('label')
			if (occurrences.error !== null) {
				return enErreur(classerErreur(occurrences.status, occurrences.error.message))
			}
			for (const occurrence of occurrences.data) {
				const liste = parBudget.get(occurrence.budget_id) ?? []
				liste.push({ id: occurrence.id, label: occurrence.label, closed_at: occurrence.closed_at })
				parBudget.set(occurrence.budget_id, liste)
			}
		}

		const rattachables: BudgetRattachable[] = []
		for (const budget of budgets.data) {
			const occurrences = parBudget.get(budget.id) ?? []
			// Le troisième filtre, appliqué APRÈS la lecture parce qu'il porte sur une autre table :
			// un budget récurrent sans occurrence ouverte n'est pas rattachable (§4.7).
			if (budget.is_recurrent && occurrences.length === 0) continue
			rattachables.push({
				id: budget.id,
				name: budget.name,
				currency: budget.currency,
				is_recurrent: budget.is_recurrent,
				occurrences,
			})
		}
		return pret(rattachables)
	} catch (cause) {
		return enErreur(classerErreur(undefined, cause instanceof Error ? cause.message : String(cause)))
	}
}

// ---------------------------------------------------------------------------------------------
// Les totaux — §4.4 et §4.6
// ---------------------------------------------------------------------------------------------

/**
 * Le total d'une devise : l'estimé, le réel, et ce que le réel ne dit pas.
 *
 * `sansReel` et `estimeSansReel` portent la mention du §4.4 — « n lignes sans coût réel saisi, pour
 * m € de prévisionnel ». Sans elle, un réel bas se lirait comme une économie alors qu'il n'est
 * qu'une saisie en retard, et c'est « la principale façon dont un tel écran ment ».
 */
export type TotalDevise = {
	readonly devise: string
	readonly estime: number
	readonly reel: number
	readonly sansReel: number
	readonly estimeSansReel: number
}

/**
 * Les totaux de la section, **groupés par devise**.
 *
 * LE GROUPEMENT N'EST PAS UNE PRÉCAUTION DÉCORATIVE. Le §4.6 demande « estimé et réel de
 * l'affaire » sans nommer les devises, mais le §2.3 pose qu'une ligne prend la devise de son
 * budget, et le §4.5 tranche déjà le cas général : « les devises ne se mélangent pas ». Une affaire
 * dont deux lignes vivent sur des budgets de tracks différents peut parfaitement porter EUR et CHF
 * — le seed pose justement un budget en CHF —, et un total unique y additionnerait des francs à des
 * euros. S'il n'y a qu'une devise, le cas attendu, l'utilisateur ne voit rien de cette mécanique.
 *
 * `actual_cost` NUL NE COMPTE PAS DANS LE RÉEL (§2.3, §4.4). Aucun `?? 0` n'est écrit ici : ce
 * serait exactement la coercition que la migration `0051` refuse en tête de fichier, et elle
 * transformerait un retard de saisie en économie.
 *
 * L'ordre est celui des devises rencontrées, la première ligne d'abord : il suit la lecture de la
 * table plutôt qu'un tri alphabétique qui ferait passer CHF devant EUR sur une affaire dont tout
 * est en euros sauf une ligne.
 *
 * Une ligne dont le budget n'est pas rendu — cas que le compilateur impose de traiter — est comptée
 * sous une devise INCONNUE plutôt qu'ignorée : la taire ferait un total silencieusement incomplet,
 * ce qui est le défaut que ce groupement existe pour éviter.
 */
export const DEVISE_INCONNUE = '?'

export function calculerTotaux(lignes: readonly LigneCout[]): readonly TotalDevise[] {
	const parDevise = new Map<string, TotalDevise>()
	for (const ligne of lignes) {
		const devise = ligne.budgets?.currency ?? DEVISE_INCONNUE
		const courant =
			parDevise.get(devise) ??
			({ devise, estime: 0, reel: 0, sansReel: 0, estimeSansReel: 0 } satisfies TotalDevise)
		// Le réel est extrait dans une variable NARROWIE plutôt que testé par un booléen intermédiaire :
		// TypeScript ne propage pas une garde à travers `const sansReel = … === null`, et écrire
		// `sansReel ? 0 : ligne.actual_cost` obligerait à une assertion — c'est-à-dire à affirmer au
		// compilateur ce que l'on refuse par ailleurs de supposer.
		const reel = ligne.actual_cost
		parDevise.set(devise, {
			devise,
			estime: courant.estime + ligne.estimated_cost,
			reel: courant.reel + (reel === null ? 0 : reel),
			sansReel: courant.sansReel + (reel === null ? 1 : 0),
			estimeSansReel: courant.estimeSansReel + (reel === null ? ligne.estimated_cost : 0),
		})
	}
	return [...parDevise.values()]
}

// ---------------------------------------------------------------------------------------------
// Validation de forme
// ---------------------------------------------------------------------------------------------

/** `app.btrim_blancs(label) <> ''`, la contrainte de la base, lue depuis l'interface. */
export const libelleCoutConforme = (libelle: string): boolean => libelle.trim() !== ''

/**
 * Lit un montant saisi.
 *
 * TROIS ISSUES, ET LA DISTINCTION EST LA MÊME QUE POUR L'ENVELOPPE D'UN BUDGET : un champ vide vaut
 * `absent`, un nombre vaut ce nombre, une saisie non numérique est `invalide`. Elle ne se réduit pas
 * à `number | null` : sur `estimated_cost`, `absent` est un refus de saisie — le champ est
 * obligatoire (§2.3) — tandis que sur `actual_cost`, `absent` est l'état normal d'une dépense en
 * cours, et vaut `null`. Le même lecteur sert les deux champs ; ce sont leurs appelants qui
 * diffèrent, et c'est ce qui rend « nul n'est pas zéro » vérifiable au lieu d'être supposé.
 *
 * `Number` et non `parseFloat` : `parseFloat('12abc')` rend 12 en ignorant la queue, ce qui
 * accepterait une saisie que personne n'a voulue. Aucune contrainte de signe (§2.3).
 */
export type Montant =
	| { readonly statut: 'absent' }
	| { readonly statut: 'lu'; readonly montant: number }
	| { readonly statut: 'invalide' }

export function lireMontant(saisie: string): Montant {
	const nettoyee = saisie.trim()
	if (nettoyee === '') return { statut: 'absent' }
	const montant = Number(nettoyee)
	if (!Number.isFinite(montant)) return { statut: 'invalide' }
	return { statut: 'lu', montant }
}

// ---------------------------------------------------------------------------------------------
// Les refus
// ---------------------------------------------------------------------------------------------

/**
 * Les refus qu'une écriture de ligne de coût peut recevoir.
 *
 * Chacun appelle un geste DIFFÉRENT de l'utilisateur — choisir une occurrence, en choisir une
 * autre, recharger parce que le cadre a été clôturé sous ses pieds, corriger un champ, renoncer —,
 * et les confondre sous « une erreur est survenue » serait la valeur par défaut trompeuse de
 * `CLAUDE.md` §18.
 */
export type NatureRefusCout =
	/** `403`/`401` — `42501`. Il faut écrire l'affaire, et lire le budget (§3.2). */
	| 'forbidden'
	/** `23514` — le budget est récurrent et aucune occurrence n'a été choisie. */
	| 'occurrence-exigee'
	/** `23514` — le budget n'est pas récurrent et une occurrence a été envoyée. */
	| 'occurrence-interdite'
	/** `23514` — l'occurrence appartient à un autre budget. */
	| 'occurrence-etrangere'
	/**
	 * `23514` — une clôture est opposée au rattachement, dans un sens ou dans l'autre : budget clos
	 * rejoint ou quitté, occurrence close rejointe ou quittée. Les quatre messages du trigger
	 * appellent le MÊME geste — recharger, le cadre a changé —, et les séparer inventerait une
	 * nuance que l'utilisateur ne peut pas exploiter.
	 */
	| 'rattachement-clos'
	/** `23514` — un `CHECK` de forme : libellé vide. */
	| 'forme-refusee'
	/** `23503` — clé étrangère : l'affaire, le budget ou l'occurrence a disparu. */
	| 'reference-absente'
	| 'network'
	| 'unknown'

export type RefusCout = {
	readonly nature: NatureRefusCout
	readonly detail: string
}

/**
 * Fragments stables des messages levés par `app.card_costs_verifier_rattachement`
 * (`supabase/migrations/0051_card_costs.sql` §2).
 *
 * C'EST LA SEULE INSPECTION DE TEXTE DE CE MODULE, et c'est le compromis déjà assumé par
 * `FRAGMENT_RECURRENCE_OCCUPEE` dans `budgets.ts`, pour la même raison : le trigger et les `CHECK`
 * de forme partagent le SQLSTATE `23514`, et rien d'autre que le message ne les sépare — PostgREST
 * n'expose pas le nom de la contrainte hors du message.
 *
 * `scripts/verify-card-costs.sh` vérifie que chacun de ces fragments se trouve encore dans `0051` :
 * une dérive entre les deux fichiers est ainsi MESURÉE, et non subie à l'usage.
 *
 * L'ORDRE DE CE TABLEAU EST SIGNIFIANT. « doit citer une occurrence » et « ne cite aucune
 * occurrence » partagent le mot « occurrence » ; les motifs sont donc éprouvés dans l'ordre, du plus
 * spécifique au plus général, et `clôtur` vient en dernier parce qu'il apparaît aussi dans des
 * messages que les motifs précédents nomment plus précisément.
 */
export const FRAGMENTS_REFUS_COUT: readonly (readonly [string, NatureRefusCout])[] = [
	['doit citer une occurrence', 'occurrence-exigee'],
	['ne cite aucune occurrence', 'occurrence-interdite'],
	['appartient à un autre budget', 'occurrence-etrangere'],
	['clôtur', 'rattachement-clos'],
]

/**
 * Classe un refus d'écriture sur le **code PostgreSQL** d'abord, le **code HTTP** ensuite, et jamais
 * sur le texte du message — la règle de `classerErreur`, à la seule réserve des fragments ci-dessus.
 *
 * L'ORDRE COMPTE, et il est celui de `classerRefusBudget` : un `42501` remonte en `403` au niveau
 * HTTP, mais un refus de `CHECK` remonte lui aussi avec un statut d'erreur ; classer par le statut
 * d'abord rangerait les seconds avec les premiers et dirait « vous n'avez pas le droit » là où c'est
 * l'occurrence qui manque.
 */
export function classerRefusCout(
	statutHttp: number | undefined,
	code: string | undefined,
	detail: string,
): RefusCout {
	if (code === '23503') return { nature: 'reference-absente', detail }
	if (code === '23514') {
		for (const [fragment, nature] of FRAGMENTS_REFUS_COUT) {
			if (detail.includes(fragment)) return { nature, detail }
		}
		return { nature: 'forme-refusee', detail }
	}
	if (statutHttp === 401 || statutHttp === 403) return { nature: 'forbidden', detail }
	if (statutHttp === undefined || statutHttp === 0) return { nature: 'network', detail }
	return { nature: 'unknown', detail }
}

/**
 * Résultat d'une écriture.
 *
 * `sans-effet` n'est ni un succès ni une erreur, et il est ici le refus le plus FRÉQUENT sur la mise
 * à jour et la suppression : les politiques de `0051` filtrent par leur clause `USING`, PostgREST
 * rend alors `200` et **zéro ligne**. C'est notamment ce que reçoit qui supprime une ligne d'un
 * budget clôturé — `app.budget_est_ouvert` vit dans le `USING` de la politique de suppression, et
 * aucun trigger ne garde le `DELETE`. MESURÉ à la décision 473.
 */
export type ResultatCout =
	| { readonly statut: 'applique' }
	| { readonly statut: 'sans-effet' }
	| { readonly statut: 'refus'; readonly refus: RefusCout }

/** Enveloppe commune : aucune écriture de ce module ne lève, toutes rendent un résultat classé. */
async function executer(
	appel: () => PromiseLike<{
		error: { code?: string; message: string } | null
		status: number
		data: unknown[] | null
	}>,
): Promise<ResultatCout> {
	try {
		const reponse = await appel()
		if (reponse.error !== null) {
			return {
				statut: 'refus',
				refus: classerRefusCout(reponse.status, reponse.error.code, reponse.error.message),
			}
		}
		// `select()` accompagne chaque écriture précisément pour que ce comptage existe : sans lui,
		// PostgREST ne rend aucun corps et « zéro ligne touchée » serait indistinguable d'un succès.
		if (reponse.data !== null && reponse.data.length === 0) return { statut: 'sans-effet' }
		return { statut: 'applique' }
	} catch (cause) {
		return {
			statut: 'refus',
			refus: classerRefusCout(
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

export type SaisieLigneCout = {
	readonly idBudget: string
	/** `null` si le budget n'est pas récurrent, l'occurrence choisie s'il l'est (§2.3). */
	readonly idOccurrence: string | null
	readonly libelle: string
	readonly estime: number
	/** `null` — le réel n'est pas encore connu — n'est PAS zéro (§2.3). */
	readonly reel: number | null
}

/**
 * Crée une ligne de coût.
 *
 * `created_by` n'est PAS envoyé : c'est une trace posée par la base, jamais un droit
 * (`supabase/migrations/0051_card_costs.sql` §1), et l'auteur d'une ligne n'obtient aucun privilège
 * particulier sur elle. Même convention que `creerBudget`.
 */
export async function creerLigneCout(
	client: ClientCrm,
	idCard: string,
	saisie: SaisieLigneCout,
): Promise<ResultatCout> {
	return executer(() =>
		client
			.from('card_costs')
			.insert({
				card_id: idCard,
				budget_id: saisie.idBudget,
				occurrence_id: saisie.idOccurrence,
				label: saisie.libelle,
				estimated_cost: saisie.estime,
				actual_cost: saisie.reel,
			})
			.select('id'),
	)
}

/**
 * Modifie une ligne existante — les quatre attributs que la section rend saisissables.
 *
 * LE RATTACHEMENT EST ENVOYÉ MÊME S'IL N'A PAS CHANGÉ, et c'est sans conséquence : le trigger ne
 * s'oppose qu'au CHANGEMENT de rattachement — `new.budget_id is distinct from old.budget_id` —, si
 * bien qu'une réécriture à l'identique traverse un budget clôturé. C'est exactement ce que le §2.3
 * veut : « leur `actual_cost` reste modifiable après la clôture ». Filtrer ici les champs inchangés
 * ferait dépendre le comportement d'une comparaison d'interface là où la base en tient déjà une,
 * plus juste.
 */
export async function modifierLigneCout(
	client: ClientCrm,
	id: string,
	saisie: SaisieLigneCout,
): Promise<ResultatCout> {
	return executer(() =>
		client
			.from('card_costs')
			.update({
				budget_id: saisie.idBudget,
				occurrence_id: saisie.idOccurrence,
				label: saisie.libelle,
				estimated_cost: saisie.estime,
				actual_cost: saisie.reel,
			})
			.eq('id', id)
			.select('id'),
	)
}

/**
 * Supprime une ligne.
 *
 * Aucun trigger ne garde le `DELETE` : c'est la politique qui exige le budget OUVERT, et son
 * `USING` filtre silencieusement. Une suppression sur un budget clos rend donc `200 []`, classé
 * `sans-effet` — jamais une erreur. La section éteint d'ailleurs la commande dans ce cas, mais
 * l'éteindre ne la rend pas impossible : le refus reste traité.
 */
export async function supprimerLigneCout(client: ClientCrm, id: string): Promise<ResultatCout> {
	return executer(() => client.from('card_costs').delete().eq('id', id).select('id'))
}

// ---------------------------------------------------------------------------------------------
// Le décompte laissé ouvert par `CRM-084` — §4.1
// ---------------------------------------------------------------------------------------------

/**
 * Compte les lignes d'un budget dont le coût réel n'est pas saisi.
 *
 * C'EST LE RESTE EXACT DE `CRM-084`, et il est soldé ici parce que `card_costs` existe désormais. Le
 * §4.1 exige que la confirmation de clôture d'un budget avertisse et COMPTE : « ce budget porte n
 * lignes sans coût réel ; elles resteront saisissables après la clôture ». La confirmation disait
 * jusqu'ici que rien n'était à saisir, faute de table à interroger.
 *
 * `head: true` avec `count: 'exact'` : la réponse ne porte AUCUNE ligne, seulement leur nombre. Les
 * lignes elles-mêmes n'ont rien à faire dans une confirmation, et les faire transiter exposerait des
 * libellés et des montants pour afficher un entier.
 *
 * LE COMPTE EST CELUI QUE LA RLS CONSENT, jamais un compte absolu : `card_costs` exige de lire la
 * card ET le budget (§3.1). Un administrateur du workspace, seul à pouvoir clôturer, lit en pratique
 * tout le workspace ; mais si une ligne lui échappait, le nombre annoncé serait celui qu'il peut
 * voir — l'inverse divulguerait par soustraction l'existence d'une affaire.
 */
export async function compterLignesSansReel(
	client: ClientCrm,
	idBudget: string,
): Promise<EtatAsync<number>> {
	try {
		const reponse = await client
			.from('card_costs')
			.select('id', { count: 'exact', head: true })
			.eq('budget_id', idBudget)
			.is('actual_cost', null)
		if (reponse.error !== null) {
			return enErreur(classerErreur(reponse.status, reponse.error.message))
		}
		return pret(reponse.count ?? 0)
	} catch (cause) {
		return enErreur(classerErreur(undefined, cause instanceof Error ? cause.message : String(cause)))
	}
}
