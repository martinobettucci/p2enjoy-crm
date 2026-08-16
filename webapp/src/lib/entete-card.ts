// @spec CRM-040 (docs/BACKLOG.md) — les champs d'en-tête de la fiche d'affaire, et leur écriture
// @spec docs/SPEC-cards.md §15.3 (ce que l'en-tête lit, et en combien de requêtes),
//       §15.4 (les six données et comment chacune se rend), §3.5 (l'adresse complète est une
//       dérivation, jamais une colonne), §2.1 (les colonnes et leurs types),
//       §15 bis.2 (un champ, une écriture), §15 bis.4 (ce qui est écrit et sa normalisation),
//       §15 bis.5 (ce que le produit n'invente pas), §15 bis.6 (le responsable et sa trace),
//       §15 bis.7 (dictionnaire fermé des issues), §15 bis.8 (contrat d'API mesuré)
// @spec docs/DESIGN_SYSTEM.md §5.3 bis (les règles visuelles), §5.3 ter (l'édition), §2 (données
//       techniques)
//
// Ce module ne rend rien : il **compose**, comme `formulaire.ts` compose le formulaire. La
// séparation est ce qui rend l'adresse et le montant vérifiables sans navigateur — trois cas de
// composition d'adresse, quatre de montant — là où un composant ne les exercerait qu'à travers un
// rendu.
//
// AUCUNE MIGRATION N'ACCOMPAGNE LA TRANCHE D'ÉCRITURE : les six colonnes sont ouvertes en `UPDATE`
// à `authenticated` depuis `CRM-013` (`supabase/migrations/0014_colonnes_protegees.sql`), et la
// politique `cards_maj` existe depuis `CRM-040`. Ce qui manquait était le **chemin** vers elles.

import { classerErreur, enErreur, pret, type EtatAsync } from './async'
import type { Database } from './database.types'
import type { ProfilAffiche } from './identites'
import type { ClientCrm } from './supabase'
import type { CardOuverte } from './formulaire'

/**
 * L'adresse complète de l'affaire, ou `null` lorsqu'elle n'est pas composable.
 *
 * `email_local_part || '@' || workspaces.inbound_domain` est une **dérivation** (docs/SPEC-cards.md
 * §3.5) : elle n'est pas stockée, `inbound_domain` pouvant changer.
 *
 * SANS DOMAINE, AUCUNE ADRESSE — et surtout pas la partie locale seule. Une adresse amputée de son
 * domaine ne serait pas une adresse incomplète, elle serait **fausse** : la copier enverrait un
 * message nulle part. C'est la « valeur par défaut trompeuse » que `CLAUDE.md` §18 proscrit.
 */
export function composerAdresseCard(card: CardOuverte): string | null {
	const domaine = card.workspaces?.inbound_domain ?? null
	if (domaine === null || domaine.trim() === '') return null
	if (card.email_local_part.trim() === '') return null
	return `${card.email_local_part}@${domaine}`
}

/**
 * Le montant et son code devise, **séparés**, ou `null` lorsqu'il n'y a pas de montant.
 *
 * DEUX MEMBRES ET NON UNE CHAÎNE : le code devise occupe son propre élément à l'écran, jamais un
 * nœud de texte accolé au nombre — c'est le défaut « Discussion1 » mesuré au §5.11 du design
 * system, où `gap` ne sépare pas un nœud anonyme.
 *
 * `Intl.NumberFormat` est employé SANS `style: 'currency'`. La base ne contraint que la **forme**
 * du code devise, jamais sa liste réelle (docs/SPEC-cards.md §2.1) : `currency: 'XYZ'` lèverait
 * `RangeError` sur un code que le navigateur ne connaît pas, et l'écran entier tomberait pour une
 * devise saisie. Le format numérique à deux décimales ne dépend d'aucune liste.
 *
 * Zéro est un montant. Seule l'absence de valeur — `null` — fait disparaître la ligne (§15.4).
 */
export function formaterMontant(
	card: Pick<CardOuverte, 'amount' | 'currency'>,
	locale = 'fr-FR',
): { readonly montant: string; readonly devise: string } | null {
	if (card.amount === null) return null
	const montant = new Intl.NumberFormat(locale, {
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
	}).format(card.amount)
	return { montant, devise: card.currency }
}

/**
 * L'échéance de la prochaine action, en date courte, ou `null`.
 *
 * MÊME FORMAT COURT que la dernière relève du §5.14 du design system : deux dates du même produit
 * ne se lisent pas dans deux formats. Une valeur que `Date` ne sait pas lire rend `null` plutôt
 * qu'un « Invalid Date » à l'écran — le type généré ne garantit aucune valeur
 * (`docs/SPEC-types.md`).
 */
export function formaterEcheance(valeur: string | null, locale = 'fr-FR'): string | null {
	if (valeur === null) return null
	const date = new Date(valeur)
	if (Number.isNaN(date.getTime())) return null
	return new Intl.DateTimeFormat(locale, { dateStyle: 'short' }).format(date)
}

/** Une affaire archivée porte la pilule « Archivé » à côté de son titre (§15.4). */
export function estArchivee(card: Pick<CardOuverte, 'archived_at'>): boolean {
	return card.archived_at !== null
}

// ---------------------------------------------------------------------------------------------
// L'écriture des six champs d'en-tête — docs/SPEC-cards.md §15 bis
// ---------------------------------------------------------------------------------------------

/**
 * Les six colonnes que la tranche écrit, et elles seules (§15 bis.1).
 *
 * `current_step_id` et `email_local_part` en sont ABSENTES parce qu'elles sont fermées par
 * privilège de colonne — MESURÉ, un `PATCH` les portant rend `403` / `42501`. `description`,
 * `probability_override`, `position` et `snoozed_until` sont ouvertes en base mais hors de cette
 * tranche : aucune n'atteint l'en-tête en lecture, et livrer l'écriture d'une donnée que l'écran ne
 * montre pas inventerait une règle de produit.
 */
export const CHAMPS_ENTETE = [
	'title',
	'owner_id',
	'amount',
	'currency',
	'next_action',
	'next_action_at',
] as const

export type ChampEntete = (typeof CHAMPS_ENTETE)[number]

/** Ce qu'un `PATCH` de `cards` accepte pour ces six colonnes. */
export type ValeurEntete = string | number | null

/**
 * Normalise une saisie d'écran en la valeur que la colonne attend (§15 bis.4).
 *
 * **Aucun `trim`, et c'est la décision du §4 bis.4 du composeur reprise sans changement** : rogner
 * à l'écriture ferait diverger ce que l'utilisateur voit de ce que la base porte. La différence
 * avec le composeur est que `cards_title_check` REFUSE une chaîne de blancs — MESURÉ, `"   "` rend
 * `23514` comme `""` —, si bien que l'écran n'a pas à décider ce qu'une telle saisie signifie.
 *
 * **La devise passe en majuscules, et ce n'est PAS une validation.** MESURÉ, `"eur"` est refusé en
 * `23514` : la contrainte porte sur la forme, trois lettres majuscules. La casse épargne un refus
 * que l'utilisateur ne comprendrait pas — il a bien tapé sa devise — sans décider à la place de la
 * base : une saisie de quatre lettres reste envoyée, et son refus reste montré.
 *
 * **Le titre et la devise n'ont pas de valeur vide** : `cards_title_check` refuse le premier,
 * `NOT NULL` le second (MESURÉ, `23502`). Une saisie vide leur est donc transmise telle quelle, et
 * c'est la base qui tranche — le §15 bis.5 interdit de doubler une contrainte côté écran.
 */
export function normaliserSaisieEntete(champ: ChampEntete, saisie: string): ValeurEntete {
	if (champ === 'currency') return saisie.toUpperCase()
	if (champ === 'title') return saisie
	if (saisie === '') return null
	if (champ === 'amount') {
		const nombre = Number(saisie)
		// Un `input type="number"` ne laisse pas produire une saisie non convertible ; cette branche
		// protège d'un `NaN` que `JSON.stringify` transformerait silencieusement en `null` — donc en
		// « vidé », ce qui effacerait un montant que l'utilisateur croyait corriger.
		return Number.isFinite(nombre) ? nombre : saisie
	}
	return saisie
}

/**
 * Les sept issues d'une écriture d'en-tête — dictionnaire fermé du §15 bis.7.
 *
 * `sans-effet` N'EST NI UN SUCCÈS NI UNE ERREUR, et c'est la découverte de la mesure : le `viewer`
 * qui voit une affaire et tente d'en écrire le titre reçoit **`200` et zéro ligne**, jamais `403`.
 * La clause `USING` de `cards_maj` filtre avant la mise à jour, aucune ligne n'est candidate, et
 * PostgREST rend un tableau vide. Annoncer « Enregistré » sur zéro ligne serait la « simulation de
 * succès » que `CLAUDE.md` §18 interdit.
 */
export type IssueEcritureEntete =
	/** `200` et au moins une ligne rendue. */
	| 'enregistree'
	/** `200` et zéro ligne : la politique a filtré l'appelant (mesure `b`). */
	| 'sans-effet'
	/** `400`, `23514` ou `22007` : la valeur ne convient pas à la colonne (mesures `d`, `e`, `h`, `i`). */
	| 'invalide'
	/** `409`, `23503` : le responsable choisi n'est plus une ligne de `profiles` (mesure `j`). */
	| 'introuvable'
	/** `403`, `42501` : privilège de colonne. Hors du geste — figé pour que sa disparition se voie. */
	| 'refus'
	/** Aucune réponse : la requête n'a jamais abouti. */
	| 'reseau'
	/** Tout le reste. L'interface ne prétend pas savoir. */
	| 'inconnu'

/** Les deux `SQLSTATE` que la base rend pour une valeur non conforme (mesures `d`, `e`, `h`, `i`). */
export const CODES_VALEUR_INVALIDE = ['23514', '22007', '23502'] as const

/**
 * Classe une réponse d'écriture sur le code HTTP, le `SQLSTATE` et le NOMBRE DE LIGNES rendues —
 * jamais sur le message du serveur (§15 bis.7).
 *
 * `lignes` est indispensable : sans lui, `sans-effet` et `enregistree` seraient indistinguables,
 * les deux portant `200`. C'est la raison pour laquelle la requête exige
 * `Prefer: return=representation` (§15 bis.7) — sans en-tête, PostgREST rend `204` et aucun corps.
 */
export function classerEcritureEntete(
	statutHttp: number | undefined,
	codeErreur: string | null,
	lignes: number,
): IssueEcritureEntete {
	if (statutHttp === undefined || statutHttp === 0) return 'reseau'
	if (codeErreur !== null) {
		if (statutHttp === 400 && (CODES_VALEUR_INVALIDE as readonly string[]).includes(codeErreur)) {
			return 'invalide'
		}
		if (statutHttp === 409 && codeErreur === '23503') return 'introuvable'
		if (statutHttp === 401 || statutHttp === 403) return 'refus'
		return 'inconnu'
	}
	if (statutHttp >= 200 && statutHttp < 300) return lignes > 0 ? 'enregistree' : 'sans-effet'
	return 'inconnu'
}

/** Colonnes relues par l'écriture : celles que l'écran met à jour EN PLACE, et rien de plus. */
export const COLONNES_RETOUR_ENTETE =
	'id, title, owner_id, amount, currency, next_action, next_action_at'

/** Ce que l'écriture rend à l'écran lorsqu'elle a abouti — la ligne telle que la BASE la porte. */
export type LigneEnteteEcrite = Pick<
	Database['public']['Tables']['cards']['Row'],
	'id' | 'title' | 'owner_id' | 'amount' | 'currency' | 'next_action' | 'next_action_at'
>

export type ResultatEcritureEntete =
	| { readonly issue: 'enregistree'; readonly ligne: LigneEnteteEcrite }
	| { readonly issue: Exclude<IssueEcritureEntete, 'enregistree'> }

/**
 * Le corps du `PATCH`, construit colonne par colonne plutôt que par une clé calculée.
 *
 * UNE CLÉ CALCULÉE NE COMPILE PAS, et c'est une contrainte utile plutôt qu'une gêne : le type
 * généré déclare `title` et `currency` NON nullables — `docs/SPEC-types.md` —, et
 * `{ [champ]: valeur }` réduit l'objet entier à un index `never` sur lequel `supabase-js` refuse
 * toute écriture. Le `switch` ci-dessous fait donc porter au compilateur ce que la base porte déjà :
 * vider le titre ou la devise est refusé AVANT la requête, non parce que l'écran double une
 * contrainte (§15 bis.5 l'interdit) mais parce que ces deux colonnes n'ont pas de valeur vide à
 * envoyer — une saisie vide leur arrive comme la chaîne vide, que la base refuse en `23514`.
 */
function composerPatchEntete(champ: ChampEntete, valeur: ValeurEntete) {
	const texte = typeof valeur === 'string' ? valeur : ''
	switch (champ) {
		case 'title':
			return { title: texte }
		case 'currency':
			return { currency: texte }
		case 'owner_id':
			return { owner_id: typeof valeur === 'string' ? valeur : null }
		case 'amount':
			// `typeof` et non une conversion : une saisie non convertible arrive ici en CHAÎNE
			// (§15 bis.4), et `Number('abc')` rendrait `NaN`, que `JSON.stringify` transforme
			// silencieusement en `null` — donc en montant VIDÉ. Ce cas n'atteint jamais la requête :
			// `ecrireChampEntete` le classe `invalide` avant de l'émettre.
			return { amount: typeof valeur === 'number' ? valeur : null }
		case 'next_action':
			return { next_action: typeof valeur === 'string' ? valeur : null }
		case 'next_action_at':
			return { next_action_at: typeof valeur === 'string' ? valeur : null }
	}
}

/**
 * Écrit UNE colonne d'en-tête d'une affaire — le geste du §15 bis.
 *
 * UNE COLONNE À LA FOIS, ET LA MESURE L'IMPOSE (§15 bis.2) : chaque colonne a son refus propre —
 * `23514` pour le titre et la devise, `22007` pour l'échéance, `23503` pour le responsable —, et un
 * `PATCH` portant plusieurs colonnes est une seule instruction. Une devise mal formée ferait
 * échouer le titre saisi en même temps, et l'écran n'aurait qu'un refus global là où le §5.7 du
 * design system exige l'erreur au niveau du champ. Le lot fonctionne — MESURÉ, `200` — ; ce n'est
 * pas une impossibilité technique, c'est une perte d'attribution que le produit refuse.
 *
 * `updated_at` n'est PAS écrite : MESURÉ, le trigger l'avance de lui-même. L'écrire depuis le
 * client créerait une seconde version de la même information, qui pourrait la contredire.
 *
 * `select` accompagne l'écriture pour que le NOMBRE de lignes se lise : c'est lui qui distingue une
 * écriture acceptée d'une écriture filtrée par la politique (§15 bis.7).
 */
export async function ecrireChampEntete(
	client: ClientCrm,
	idCard: string,
	champ: ChampEntete,
	valeur: ValeurEntete,
): Promise<ResultatEcritureEntete> {
	// UN MONTANT NON CONVERTIBLE N'EST PAS ÉMIS, et ce n'est pas une garde qui double une contrainte
	// de la base (§15 bis.5) : c'est une valeur que la requête ne peut pas PORTER. La colonne est
	// `numeric` et le corps est du JSON — envoyer `NaN` reviendrait à envoyer `null`, c'est-à-dire à
	// vider un montant que l'utilisateur croyait corriger. L'issue est celle que la base rendrait.
	if (champ === 'amount' && typeof valeur === 'string') return { issue: 'invalide' }
	try {
		const reponse = await client
			.from('cards')
			.update(composerPatchEntete(champ, valeur))
			.eq('id', idCard)
			.select(COLONNES_RETOUR_ENTETE)
		const code = reponse.error === null ? null : reponse.error.code
		const issue = classerEcritureEntete(reponse.status, code ?? null, reponse.data?.length ?? 0)
		if (issue === 'enregistree' && reponse.data !== null && reponse.data[0] !== undefined) {
			return { issue, ligne: reponse.data[0] }
		}
		// Une issue `enregistree` sans ligne ne peut pas se produire — `classerEcritureEntete` la
		// conditionne à `lignes > 0` —, mais le type ne le sait pas. Le repli est `inconnu` plutôt
		// qu'un succès inventé : l'écran n'annonce jamais enregistré ce que le serveur n'a pas rendu.
		return { issue: issue === 'enregistree' ? 'inconnu' : issue }
	} catch (cause) {
		// `supabase-js` peut relancer une panne de transport plutôt que la rendre.
		void cause
		return { issue: 'reseau' }
	}
}

/** Un membre du workspace, tel que la liste des responsables a besoin de le connaître. */
export type MembreAffectable = {
	readonly id: string
	readonly nom: string
}

/**
 * Les colonnes de la liste des responsables. La relation `profiles` n'est PAS ambiguë ici — une
 * seule clé étrangère de `workspace_members` la désigne —, à la différence de celle de `cards`, que
 * trois clés désignent et que PostgREST refuse alors de choisir (§15.3, `PGRST201`).
 */
export const COLONNES_MEMBRES = 'user_id, profiles(id, full_name)'

/**
 * Les membres du workspace de l'affaire, pour la liste du responsable (§15 bis.6).
 *
 * ELLE N'EST LUE QU'À L'OUVERTURE DE L'ÉDITION, jamais au chargement de la fiche : l'en-tête est
 * d'abord une lecture, et charger la liste des membres pour un geste que la plupart des visites ne
 * font pas serait une requête gratuite sur l'écran le plus ouvert du produit.
 *
 * MESURÉ : elle rend les trois membres du seed à l'`admin` COMME au `viewer` — le nom d'un collègue
 * est une donnée d'équipe, pas une donnée du dossier (`docs/SPEC-identite.md` §3.3) — et `[]` à un
 * appelant anonyme. Un membre sans profil lisible est écarté plutôt que rendu sans nom : une entrée
 * de liste anonyme ne se choisit pas.
 */
export async function lireMembresAffectables(
	client: ClientCrm,
	idWorkspace: string,
): Promise<EtatAsync<readonly MembreAffectable[]>> {
	try {
		const reponse = await client
			.from('workspace_members')
			.select(COLONNES_MEMBRES)
			.eq('workspace_id', idWorkspace)
		if (reponse.error !== null) {
			return enErreur(classerErreur(reponse.status, reponse.error.message))
		}
		const membres: MembreAffectable[] = []
		for (const ligne of reponse.data) {
			const profil: Pick<ProfilAffiche, 'id' | 'full_name'> | null = ligne.profiles ?? null
			if (profil === null) continue
			membres.push({ id: profil.id, nom: profil.full_name })
		}
		// Ordonnés par nom : la base ne donne aucun ordre à `workspace_members`, et une liste dont
		// l'ordre change d'un chargement à l'autre se parcourt mal. `localeCompare` plutôt que `<` :
		// « Émile » se range après « Emma » avec le second.
		return pret(membres.sort((a, b) => a.nom.localeCompare(b.nom, 'fr')))
	} catch (cause) {
		return enErreur(classerErreur(undefined, cause instanceof Error ? cause.message : String(cause)))
	}
}
