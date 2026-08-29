// @spec CRM-086 (docs/BACKLOG.md) — écrans de coûts, TRANCHE 6a : le socle de données de l'onglet
//       « À saisir », ce qu'il lit et ce que sa saisie envoie
// @spec docs/SPEC-costs.md §4.8 (l'onglet, ce qu'il liste, ce que l'appelant ne peut pas écrire, le
//       compteur, les états), §4.8.1 (contrat de lecture : le droit d'écriture est rendu par la
//       base ; l'ancienneté se mesure sur `created_at` ; la saisie n'envoie qu'`actual_cost`),
//       §4.8.2 (la portée du badge), §2.3 (« nul n'est pas zéro », frontière de la clôture),
//       §3.1 (double condition de lecture), §3.2 (écriture)
// @spec docs/SCHEMA.md §9 bis.6 (card_costs), §9 bis.7 (politiques),
//       §9 bis.8 (`public.reel_saisissable`)
// @spec docs/DESIGN_SYSTEM.md §5.31 (table de saisie en série des coûts réels, et les TROIS états
//       de sa colonne « Ancienneté » depuis le 2026-08-29)
// @spec docs/SPEC-costs.md §2.1 bis (le seuil d'ancienneté est une donnée du budget, arbitrage
//       d'INC-183, décision 549) — d'où `ancienneteEnRetard` plus bas
// @spec docs/SPEC-permissions-rls.md §3.7 (`app.can_write_card`), §7 (formes du refus)
// @spec docs/SPEC-webapp.md §6.4 (contrat asynchrone)
//
// CE MODULE NE JUGE AUCUN DROIT, IL EN LIT UN. Le §4.8 exige qu'« une ligne lisible mais non
// écrivable soit rendue en lecture seule, avec le motif, jamais masquée » — c'est le seul endroit du
// produit où l'interface doit connaître un droit d'écriture AVANT de rendre son contrôle. Le droit
// n'est pas pour autant recalculé ici : la colonne calculée `reel_saisissable` de la migration 52 le
// fait rendre par la base, sous l'identité de l'appelant, dans la MÊME requête (§4.8.1). Déduire ce
// droit d'un rôle de workspace serait faux — les droits fins ouvrent l'écriture par channel — et le
// calculer dans l'écran serait la règle d'autorisation d'interface que `CLAUDE.md` §10 interdit.
//
// AUCUN `?? 0` N'EST ÉCRIT SUR `actual_cost`, ici comme dans `couts-ecrans.ts` et `card-costs.ts`.
// Le §2.3 pose que « `actual_cost` nul n'est pas zéro » ; c'est même la définition de ce que cet
// onglet liste — les lignes dont le réel est NUL. Une coercition n'y viderait pas seulement un
// agrégat : elle viderait l'onglet.
//
// ZÉRO EST UNE VALEUR, PAS UN VIDE (§4.8). Saisir `0` signifie « finalement rien dépensé » et retire
// la ligne de l'attente ; laisser le champ vide la laisse en attente. C'est pourquoi
// `enregistrerReel` prend un `number` et non un `number | null` : il n'existe aucun geste de cet
// onglet qui REMETTE une ligne en attente, et accepter `null` en ouvrirait un que personne n'a
// spécifié.

import { classerErreur, enErreur, pret, type EtatAsync } from './async'
import type { Database } from './database.types'
import type { ClientCrm } from './supabase'

// ---------------------------------------------------------------------------------------------
// Ce que l'onglet lit
// ---------------------------------------------------------------------------------------------

/**
 * Le budget d'une ligne en attente, tel que la colonne « Budget » du §4.8 le rend.
 *
 * `closed_at` porte la pilule « clôturé » que le §4.8 exige — « pour que personne ne s'étonne de la
 * voir » —, et `currency` la devise du montant : le §2.3 pose qu'« une ligne ne porte pas de colonne
 * `currency` », la devise d'une ligne étant celle de son budget. `is_recurrent` décide si la colonne
 * « Occurrence » a quelque chose à rendre.
 */
export type BudgetDeLaLigne = Pick<
	Database['public']['Tables']['budgets']['Row'],
	'id' | 'name' | 'currency' | 'is_recurrent' | 'closed_at' | 'stale_after_days'
>

/**
 * L'occurrence d'une ligne en attente.
 *
 * `closed_at` est lu POUR LA MÊME RAISON que celui du budget : le §4.8 liste « les budgets **et
 * occurrences** clôturés », et une ligne dont seule l'occurrence est close doit porter la pilule
 * aussi — sans quoi l'utilisateur chercherait en vain ce qui, dans un budget ouvert, la fait
 * paraître ici.
 */
export type OccurrenceDeLaLigne = Pick<
	Database['public']['Tables']['budget_occurrences']['Row'],
	'id' | 'label' | 'closed_at'
>

/**
 * L'affaire d'une ligne en attente, avec de quoi l'atteindre.
 *
 * Les deux slugs sont embarqués parce que l'adresse d'une affaire les EXIGE tous les deux, et
 * qu'aucun ne se déduit de l'adresse courante : la ligne de coût d'un budget peut porter sur une
 * affaire d'un AUTRE track que celui du budget (§3.1, rattachement croisé). C'est la forme exacte
 * d'`AffaireDeLaLigne` dans `couts-ecrans.ts`, et le type n'est pas importé de là : ce module lit sa
 * propre requête, et faire dépendre sa forme de celle d'un autre écran ferait qu'un ajout de colonne
 * là-bas changerait silencieusement le contrat d'ici.
 */
export type AffaireDeLaLigne = {
	readonly id: string
	readonly title: string
	readonly archived_at: string | null
	readonly channels: {
		readonly slug: string
		readonly tracks: { readonly id: string; readonly slug: string; readonly name: string } | null
	} | null
}

/**
 * Une ligne en attente de son réel, telle que le tableau du §4.8 la rend.
 *
 * `reel_saisissable` EST UNE COLONNE DE LA RÉPONSE, pas un champ calculé ici. C'est la colonne
 * calculée de la migration 52 (`docs/SCHEMA.md` §9 bis.8), évaluée par la base sous l'identité de
 * l'appelant. Elle est déclarée `boolean` et non `boolean | null` parce que son corps rend
 * `app.can_write_card`, dont le `coalesce(…, false)` interdit le nul (migration 13) ; mais la
 * lecture qui la consomme ne s'y fie pas — `estSaisissable` ci-dessous traite `null` et `undefined`
 * comme un refus, parce qu'un type ne garantit jamais une valeur (`docs/SPEC-types.md`).
 *
 * `actual_cost` N'EST PAS LU, et son absence est délibérée : cet onglet ne liste que les lignes dont
 * il est nul (§4.8), et le demander inviterait à écrire une condition d'écran là où la requête pose
 * déjà le filtre.
 */
export type LigneASaisir = Pick<
	Database['public']['Tables']['card_costs']['Row'],
	'id' | 'label' | 'estimated_cost' | 'created_at'
> & {
	readonly reel_saisissable: boolean | null
	readonly budgets: BudgetDeLaLigne | null
	readonly budget_occurrences: OccurrenceDeLaLigne | null
	readonly cards: AffaireDeLaLigne | null
}

/**
 * Colonnes de la lecture, écrites **d'un seul tenant**.
 *
 * Une concaténation rendrait le type `string` et `supabase-js` cesserait d'inférer la forme de la
 * réponse — la limite déjà mesurée sur `COLONNES_LIGNE_COUT` et `COLONNES_LIGNE_BUDGET`.
 *
 * `budgets!inner` ET NON `budgets`, ET CE N'EST PAS UN CHOIX DE STYLE. Le filtre de portée du §4.8
 * — « les budgets du track » — s'écrit `budgets.track_id=eq.…`, et PostgREST n'applique un filtre
 * sur une ressource EMBARQUÉE que si la jointure est déclarée `inner` : en jointure externe, une
 * ligne dont le budget ne correspond pas serait rendue avec `budgets: null` au lieu d'être écartée.
 * La jointure est `inner` dans les DEUX portées, plutôt que composée selon la portée : `budget_id`
 * est `not null` et la RLS de `card_costs` exige déjà la lecture du budget (§3.1), si bien qu'une
 * ligne sans budget lisible n'est de toute façon jamais rendue — `inner` ne retranche donc rien, et
 * une chaîne unique évite deux formes de réponse à typer.
 *
 * `cards` PORTE DEUX CLÉS COMPOSITES VERS `channels` — `cards_channel_id_workflow_id_fkey` et
 * `cards_channel_id_workspace_id_fkey` — et un `channels(...)` nu est donc AMBIGU : PostgREST refuse
 * la requête entière en `PGRST201` plutôt que d'en choisir une (mesuré par `card-costs.ts`,
 * `contacts.ts` et `couts-ecrans.ts`, qui nomment tous la même). La clé retenue est celle qui passe
 * par le workspace, seule dont la présence est structurellement garantie sur toute card.
 */
export const COLONNES_LIGNE_A_SAISIR =
	'id, label, estimated_cost, created_at, reel_saisissable, budgets!inner(id, name, currency, is_recurrent, closed_at, stale_after_days), budget_occurrences(id, label, closed_at), cards!inner(id, title, archived_at, channels!cards_channel_id_workspace_id_fkey(slug, tracks(id, slug, name)))'

/**
 * La portée d'un onglet « À saisir ».
 *
 * Le §4.8 en nomme deux, et deux seulement : « les budgets du track, ou tous les tracks lisibles au
 * niveau du workspace ». Un type discriminé plutôt qu'un `idTrack?: string` : un identifiant absent
 * et un identifiant vide seraient indiscernables, et une portée « workspace » exprimée par une
 * absence se lirait comme un oubli d'appelant.
 */
export type PorteeASaisir =
	| { readonly genre: 'track'; readonly idTrack: string }
	| { readonly genre: 'workspace' }

/**
 * Les lignes en attente de leur réel, dans la portée demandée — le contenu du §4.8.
 *
 * **UNE SEULE REQUÊTE**, et le filtre `actual_cost is null` est appliqué CÔTÉ SERVEUR : l'index
 * partiel `card_costs_sans_reel_idx` de la migration 51 existe précisément pour lui, et rapatrier
 * toutes les lignes pour en écarter la plupart ici ferait payer un volume qui croît avec l'historique
 * (`CLAUDE.md` §21).
 *
 * **LES BUDGETS ET OCCURRENCES CLÔTURÉS SONT LISTÉS, ET C'EST LA RAISON D'ÊTRE DE L'ONGLET.** Aucun
 * `closed_at is null` n'est posé ici, à la différence de `lireHistogrammeTrack` et de
 * `lireCumulWorkspace` : le §4.8 écrit que « c'est précisément après la clôture que les factures
 * arrivent, et les exclure viderait l'onglet de son usage ». La conséquence est que le compte de
 * cette lecture DIFFÈRE de la mention du §4.4 rendue sous l'histogramme — écart consigné à
 * **INC-182**, nommé au §4.8.2, et non tranché ici.
 *
 * **UN TRACK ARCHIVÉ OU EN CORBEILLE EST LISTÉ AUSSI**, pour le même motif et il est nommé plutôt que
 * tu : `lireCumulWorkspace` écarte ces tracks de son cumul par une règle d'ÉCRAN, en annonçant que
 * « le §4.8 listera leurs lignes sans réel dans l'onglet ». Une facture arrive sur une campagne
 * rangée exactement comme sur un budget clos.
 *
 * **L'ORDRE EST `created_at` PUIS `label`** — « du plus ancien au plus récent : celui qui attend
 * depuis le plus longtemps est celui qu'on oublie » (§4.8). Le second critère départage deux lignes
 * créées dans la même transaction, faute de quoi l'ordre rendu dépendrait du plan d'exécution et le
 * tableau se réordonnerait d'un chargement à l'autre — sous les doigts de qui saisit, ce que le §4.8
 * interdit ailleurs pour la même raison.
 *
 * **LA PORTÉE `workspace` NE POSE AUCUN FILTRE, ET CE N'EST PAS UN RACCOURCI.** La RLS de
 * `card_costs` exige `app.can_read_card` **et** la lecture du budget (§3.1), donc la lecture est
 * déjà bornée aux tracks que l'appelant lit. Y ajouter un `in` sur les tracks lisibles referait le
 * travail de la base en moins bien : la liste de tracks serait mesurée à un instant, la RLS à un
 * autre, et l'écart se lirait comme une ligne manquante.
 */
export async function lireLignesASaisir(
	client: ClientCrm,
	portee: PorteeASaisir,
): Promise<EtatAsync<readonly LigneASaisir[]>> {
	try {
		const base = client
			.from('card_costs')
			.select(COLONNES_LIGNE_A_SAISIR)
			.is('actual_cost', null)
		const filtree =
			portee.genre === 'track' ? base.eq('budgets.track_id', portee.idTrack) : base
		const reponse = await filtree.order('created_at').order('label')
		if (reponse.error !== null) {
			return enErreur(classerErreur(reponse.status, reponse.error.message))
		}
		return pret(reponse.data as unknown as readonly LigneASaisir[])
	} catch (cause) {
		return enErreur(classerErreur(undefined, cause instanceof Error ? cause.message : String(cause)))
	}
}

// ---------------------------------------------------------------------------------------------
// Ce que l'onglet dit d'une ligne, sans rien recalculer
// ---------------------------------------------------------------------------------------------

/**
 * La ligne est-elle saisissable par l'appelant ?
 *
 * `=== true` ET NON UNE COERCITION. La colonne calculée est déclarée `boolean`, mais un type ne
 * garantit jamais une valeur (`docs/SPEC-types.md`) : une réponse amputée, un cache de schéma
 * PostgREST périmé ou une jointure malformée rendraient `undefined`, et `!!undefined` vaut faux —
 * ce qui est le bon repli — tandis qu'une écriture `!== false` l'aurait rendu SAISISSABLE. Le repli
 * d'un droit se fait toujours vers le refus.
 */
export const estSaisissable = (ligne: LigneASaisir): boolean => ligne.reel_saisissable === true

/**
 * La ligne porte-t-elle la pilule « clôturé » du §4.8 ?
 *
 * **UNE SEULE PILULE POUR DEUX CAUSES**, et c'est la lettre du §4.8 : « une ligne de budget clos
 * porte une pilule "clôturé" pour que personne ne s'étonne de la voir ». Une occurrence close dans
 * un budget ouvert produit exactement le même étonnement, et distinguer les deux pilules
 * demanderait à l'utilisateur de savoir ce qu'une occurrence est pour comprendre pourquoi sa ligne
 * paraît là. La cause reste lisible : la colonne « Occurrence » nomme l'occurrence.
 *
 * **LE REPLI EST « OUVERT », JAMAIS « CLOS ».** `?? null` avant la comparaison : une relation absente
 * — réponse amputée, embed manquant — rend `undefined`, et un `!== null` nu l'aurait alors comptée
 * comme CLOSE, posant une pilule sur une ligne dont on ne sait rien. Une pilule affirme un fait ; le
 * repli d'un fait inconnu est de ne rien affirmer.
 */
export const estClos = (ligne: LigneASaisir): boolean =>
	(ligne.budgets?.closed_at ?? null) !== null ||
	(ligne.budget_occurrences?.closed_at ?? null) !== null

/**
 * L'ancienneté d'une ligne en jours révolus — la première colonne du §4.8.
 *
 * **ELLE SE MESURE SUR `created_at`, JAMAIS SUR `updated_at`** (§4.8.1) : l'ancienneté compte depuis
 * que la dépense a été engagée sans son réel, et `updated_at` bougerait à chaque correction du
 * libellé, faisant rajeunir une ligne qu'on vient de renommer.
 *
 * `maintenant` EST UN PARAMÈTRE, jamais un `Date.now()` interne : sans lui, aucune preuve ne pourrait
 * éprouver le calcul sans figer l'horloge, et le composant qui l'appelle rendrait un nombre
 * différent à chaque rendu.
 *
 * **`null` LORSQUE LA DATE EST ILLISIBLE, jamais zéro.** Le §5.31 du design system rend l'ancienneté
 * « formulée en durée » ; « 0 jour » sur une date qu'on n'a pas su lire serait la valeur par défaut
 * trompeuse que `CLAUDE.md` §18 interdit — l'écran écrira alors une cellule vide, la règle du §5.9.
 * Une date FUTURE rend `0` et non un nombre négatif : c'est une horloge qui dérive, pas une dépense
 * qui n'attend pas encore.
 */
export function ancienneteEnJours(ligne: LigneASaisir, maintenant: Date): number | null {
	const cree = Date.parse(ligne.created_at)
	if (!Number.isFinite(cree)) return null
	const ecoule = maintenant.getTime() - cree
	if (!Number.isFinite(ecoule)) return null
	if (ecoule <= 0) return 0
	return Math.floor(ecoule / 86_400_000)
}

/**
 * La ligne est-elle **en retard** — c'est-à-dire le seuil de son budget est-il dépassé ?
 * `docs/SPEC-costs.md` §2.1 bis, `docs/DESIGN_SYSTEM.md` §5.31, arbitrage d'INC-183.
 *
 * **TROIS ÉTATS SE RÉDUISENT ICI À UN BOOLÉEN, ET C'EST LÉGITIME PARCE QUE DEUX D'ENTRE EUX
 * APPELLENT LE MÊME RENDU.** « Aucun seuil décidé » et « seuil non franchi » sont sémantiquement
 * distincts — le §5.31 le dit — mais tous deux rendent la cellule neutre. Ce que l'écran doit
 * distinguer, il le distingue par le TEXTE du nom accessible, qui a le seuil sous la main ; ce que
 * cette fonction décide, c'est la seule teinte.
 *
 * **UN SEUIL ABSENT NE DEVIENT JAMAIS UN SEUIL PAR DÉFAUT.** `null`, `undefined`, un budget absent
 * de la réponse : tous rendent `false`. C'est la règle de `seuilEffectif` de `carte-figee.ts`
 * (`docs/SPEC-relances.md` §2.2), et l'inverse — colorer par précaution — ferait crier l'écran sur
 * une décision que personne n'a prise.
 *
 * **LA COMPARAISON EST STRICTE**, et c'est le contrat écrit : « au delà d'un seuil ». Une ligne de
 * trente jours sur un seuil de trente n'est pas en retard ; elle le devient le lendemain. C'est la
 * borne large déjà retenue pour la pastille d'une card (`docs/SPEC-relances.md` §2.5), et deux
 * signaux de même forme ne peuvent pas se lire à deux bornes différentes.
 *
 * **UNE ANCIENNETÉ ILLISIBLE N'EST PAS EN RETARD.** `ancienneteEnJours` rend `null` sur une date
 * que `Date` ne sait pas lire, et l'écran laisse alors la cellule VIDE (§4.8.1). Colorer une
 * cellule vide affirmerait un retard sur une durée qu'on n'a pas su calculer — la valeur par
 * défaut trompeuse de `CLAUDE.md` §18.
 *
 * **UN SEUIL NUL OU NÉGATIF RENDU PAR LA BASE EST IGNORÉ**, bien que `budgets_stale_check` le
 * refuse : la garde ne coûte rien, et une réponse amputée ou un contournement de la contrainte ne
 * doit pas transformer toute la table en rouge.
 */
export function ancienneteEnRetard(ligne: LigneASaisir, maintenant: Date): boolean {
	const seuil = ligne.budgets?.stale_after_days ?? null
	if (seuil === null || !Number.isFinite(seuil) || seuil < 1) return false
	const jours = ancienneteEnJours(ligne, maintenant)
	if (jours === null) return false
	return jours > seuil
}

/**
 * Le nombre que porte le badge de l'onglet — §4.8, §4.8.2.
 *
 * **IL COMPTE LES LIGNES QUE LE TABLEAU LISTE, et rien d'autre.** Le §4.8 écrit qu'il « est le même
 * nombre que celui de la mention du §4.4 » ; cette égalité est structurellement fausse — la clôture
 * et la devise séparent les deux populations —, l'écart est consigné à **INC-182** et n'est pas
 * tranché ici. Un badge qui annoncerait un autre nombre que celui des lignes rendues juste en
 * dessous mentirait sur l'écran même où il est posé, ce qui est précisément le défaut que la phrase
 * du §4.8 cherchait à prévenir.
 *
 * **IL COMPTE AUSSI LES LIGNES NON SAISISSABLES.** Le §4.8 exige qu'elles soient rendues « jamais
 * masquées » : les exclure du compte ferait diverger le badge du tableau, et écrirait « 0 » à une
 * lectrice qui a pourtant des lignes sous les yeux.
 *
 * La fonction est triviale, et c'est voulu : elle existe pour que le badge et le tableau ne puissent
 * pas répondre à deux sources. Un `lignes.length` recopié dans un composant serait la divergence
 * d'un refactoring plus tard.
 */
export const compterEnAttente = (lignes: readonly LigneASaisir[]): number => lignes.length

// ---------------------------------------------------------------------------------------------
// Ce que la saisie envoie
// ---------------------------------------------------------------------------------------------

/**
 * Les refus qu'une saisie de coût réel peut recevoir.
 *
 * **BEAUCOUP PLUS ÉTROIT QUE `NatureRefusCout` de `card-costs.ts`, et c'est le fruit du §4.8.1** :
 * cette écriture n'envoie qu'`actual_cost`. Aucun rattachement ne change, donc aucun des cinq refus
 * du trigger `app.card_costs_verifier_rattachement` n'est atteignable — ni `occurrence-exigee`, ni
 * `occurrence-interdite`, ni `occurrence-etrangere`, ni `rattachement-clos`. MESURÉ sur la ligne
 * « Production », rattachée au budget clôturé « Salon du web 2025 » : `{ "actual_cost": 376.00 }`
 * rend `200` et une ligne, là où `{ "budget_id": … }` rend `23514`.
 *
 * `forme-refusee` reste possible : `actual_cost` est un `numeric(14,2)`, et une valeur qui déborde
 * l'échelle est refusée par la base (`22003`). Le classer sous `unknown` ferait chercher une panne
 * là où une saisie est trop grande.
 */
export type NatureRefusSaisie =
	/** `403`/`401` — `42501`. Il faut écrire l'affaire (§3.2). */
	| 'forbidden'
	/** `22003` — le montant déborde `numeric(14,2)`. */
	| 'montant-hors-echelle'
	/** `23514` — un `CHECK` de forme, qu'aucune saisie de cet onglet ne devrait atteindre. */
	| 'forme-refusee'
	/** `23503` — clé étrangère : la ligne, l'affaire ou le budget a disparu. */
	| 'reference-absente'
	| 'network'
	| 'unknown'

export type RefusSaisie = {
	readonly nature: NatureRefusSaisie
	readonly detail: string
}

/**
 * Classe un refus de saisie sur le **code PostgreSQL** d'abord, le **code HTTP** ensuite, et jamais
 * sur le texte du message — la règle de `classerErreur` et de `classerRefusCout`.
 *
 * L'ORDRE COMPTE, et c'est celui de `classerRefusCout` : un `42501` remonte en `403` au niveau HTTP,
 * mais un refus de contrainte remonte lui aussi avec un statut d'erreur ; classer par le statut
 * d'abord rangerait les seconds avec les premiers et dirait « vous n'avez pas le droit » là où c'est
 * le montant qui déborde.
 */
export function classerRefusSaisie(
	statutHttp: number | undefined,
	code: string | undefined,
	detail: string,
): RefusSaisie {
	if (code === '22003') return { nature: 'montant-hors-echelle', detail }
	if (code === '23503') return { nature: 'reference-absente', detail }
	if (code === '23514') return { nature: 'forme-refusee', detail }
	if (statutHttp === 401 || statutHttp === 403) return { nature: 'forbidden', detail }
	if (statutHttp === undefined || statutHttp === 0) return { nature: 'network', detail }
	return { nature: 'unknown', detail }
}

/**
 * Résultat d'une saisie.
 *
 * `sans-effet` N'EST NI UN SUCCÈS NI UNE ERREUR, et il est ici le refus le plus probable : la
 * politique `card_costs_modification` de la migration 51 filtre par sa clause `USING`, si bien qu'un
 * droit d'écriture retombé depuis le chargement rend `200` et **zéro ligne**. L'onglet le dit en
 * toutes lettres (`docs/DESIGN_SYSTEM.md` §5.25, §5.27) : annoncer « Enregistré » sur zéro ligne
 * serait la simulation de succès que `CLAUDE.md` §18 interdit.
 *
 * **LE SUCCÈS PORTE LA VALEUR ENREGISTRÉE**, et ce n'est pas décoratif : le §4.8 exige qu'« une ligne
 * enregistrée ne disparaisse pas immédiatement — elle reste affichée, marquée "enregistré" ». La
 * ligne quitte donc la POPULATION de l'onglet sans quitter le TABLEAU, et l'écran a besoin de la
 * valeur que la base a réellement retenue — arrondie à deux décimales par `numeric(14,2)` — plutôt
 * que de celle qui a été tapée.
 */
export type ResultatSaisie =
	| { readonly statut: 'applique'; readonly reel: number }
	| { readonly statut: 'sans-effet' }
	| { readonly statut: 'refus'; readonly refus: RefusSaisie }

/**
 * Enregistre le coût réel d'une ligne — le seul geste d'écriture de l'onglet.
 *
 * **ELLE N'ENVOIE QUE `actual_cost`, ET C'EST LA RÈGLE DU §4.8.1.** `modifierLigneCout` de
 * `card-costs.ts` renvoie les cinq attributs de la ligne ; sur un budget clos, cet envoi traverse
 * aujourd'hui — le trigger ne s'oppose qu'au CHANGEMENT de rattachement, `new.budget_id is distinct
 * from old.budget_id` — mais il fait dépendre la saisie d'un rattachement que cet onglet n'a aucune
 * raison de connaître, et une évolution du trigger le casserait sans que rien ne l'annonce.
 *
 * **`select('actual_cost')` ACCOMPAGNE L'ÉCRITURE, ET C'EST CE QUI REND LES TROIS ISSUES
 * DISTINGUABLES.** Sans lui, PostgREST ne rend aucun corps et « zéro ligne touchée » serait
 * indistinguable d'un succès — la même raison qui fait accompagner chaque écriture de `card-costs.ts`
 * d'un `select`. Il rend en outre la valeur RETENUE par la base, que le §4.8 demande d'afficher.
 *
 * Aucune contrainte de signe, aucune borne (§2.1, `CLAUDE.md` §10) : un avoir est un coût négatif
 * légitime, et une valeur qui déborde `numeric(14,2)` est refusée par la BASE, jamais par une garde
 * d'interface qui poserait une règle que personne n'a prise.
 */
export async function enregistrerReel(
	client: ClientCrm,
	id: string,
	reel: number,
): Promise<ResultatSaisie> {
	try {
		const reponse = await client
			.from('card_costs')
			.update({ actual_cost: reel })
			.eq('id', id)
			.select('actual_cost')
		if (reponse.error !== null) {
			return {
				statut: 'refus',
				refus: classerRefusSaisie(reponse.status, reponse.error.code, reponse.error.message),
			}
		}
		const premiere = reponse.data?.[0]
		if (premiere === undefined) return { statut: 'sans-effet' }
		// La valeur rendue est reprise TELLE QUELLE, sans repli sur celle qui a été envoyée : c'est
		// l'arrondi de `numeric(14,2)` que l'écran doit afficher. Un `?? reel` masquerait une réponse
		// malformée derrière la saisie de l'utilisateur, et ferait croire enregistré ce qui ne l'est
		// peut-être pas — la valeur par défaut trompeuse de `CLAUDE.md` §18. Une réponse sans montant
		// lisible est donc traitée comme « sans effet » : dire moins que mentir.
		const enregistre = premiere.actual_cost
		if (typeof enregistre !== 'number') return { statut: 'sans-effet' }
		return { statut: 'applique', reel: enregistre }
	} catch (cause) {
		return {
			statut: 'refus',
			refus: classerRefusSaisie(
				undefined,
				undefined,
				cause instanceof Error ? cause.message : String(cause),
			),
		}
	}
}
