// @spec CRM-041 (docs/BACKLOG.md) — composition du board kanban et appel de la garde `move_card`
// @spec CRM-022 (docs/BACKLOG.md) — profil du responsable embarqué avec chaque card
// @spec docs/SPEC-workflow-engine.md §7.2 (ce que le board lit), §7.3 (composition des colonnes),
//       §7.4 (contenu d'une carte), §7.5 (transitions atteignables), §7.9 (optimisme et retour
//       arrière), §7.10 (les sept refus), §5.2 (signature et valeur de retour de `move_card`)
// @spec CRM-081 (docs/BACKLOG.md) — tranche 2 b : le board masque les affaires en sommeil ;
//       tranche 2 d : le geste de sommeil depuis la carte
// @spec docs/SPEC-cards.md §2.6 (ordre dans une colonne), §5 (« active »), §16.12.3 (le board
//       filtre à la composition, et pourquoi), §16.12.6 (le compte des masquées), §16.12.8 (ce que
//       le compteur et le cumul deviennent), §16.13.3 (ce que la carte devient après le geste)
// @spec docs/DESIGN_SYSTEM.md §5.1 (carte de card), §5.2 (colonne de board)
// @spec docs/SPEC-webapp.md §6.3 (ce que la coquille lit), §6.4 (contrat asynchrone)
//
// Ce module ne rend rien : il **compose**, et il appelle. La séparation est ce qui rend les
// règles du §7.3 vérifiables sans navigateur — l'ordre des colonnes, le départage à position
// égale, le refus d'additionner deux devises, le seuil d'ancienneté — et ce qui permet à la
// correspondance des refus du §7.10 d'être exercée par un test unitaire d'un côté et par la
// pile réelle de l'autre.
//
// Le même client porte soit la clé anonyme, soit la session restaurée par `CRM-009`. L'anonyme
// reçoit `200` et `[]` ; un membre consent les colonnes réelles, et le parcours connecté est
// éprouvé sans substitution par `e2e/ui/authentification.spec.ts`.

import { useCallback, useEffect, useRef, useState } from 'react'
import { classerErreur, enChargement, enErreur, pret, type EtatAsync } from './async'
import {
	COLONNES_CARD_BOARD,
	COLONNES_CHAMP_LIBELLE,
	COLONNES_ETAPE,
	COLONNES_TRANSITION,
} from './colonnes-board'
import type { Database } from './database.types'
import { MODE_SOMMEIL_PAR_DEFAUT, type ModeSommeil } from './filtre-sommeil'
import type { ProfilAffiche } from './identites'
import { estEnSommeil } from './sommeil-card'
import type { ClientCrm } from './supabase'

/** Les cinq jetons de couleur que `workflow_nodes_catalog.color` accepte (docs/SCHEMA.md §4). */
export type CouleurNoeud = 'brand' | 'success' | 'accent' | 'danger' | 'neutral'

/** Repli documenté : la valeur vient du backend, et un type ne garantit jamais une valeur. */
export const COULEUR_PAR_DEFAUT: CouleurNoeud = 'neutral'

const COULEURS: readonly CouleurNoeud[] = ['brand', 'success', 'accent', 'danger', 'neutral']

export function couleurNoeud(valeur: string | null | undefined): CouleurNoeud {
	return COULEURS.find((connue) => connue === valeur) ?? COULEUR_PAR_DEFAUT
}

/**
 * Une étape lue, telle que PostgREST la rend avec son nœud embarqué.
 *
 * La jointure est **embarquée côté serveur** et non recomposée par le client : le libellé, la
 * couleur et le seuil par défaut vivent dans le catalogue, et les rapporter séparément
 * obligerait à une seconde requête et à un appariement que la base fait mieux.
 */
export type EtapeLue = Pick<
	Database['public']['Tables']['workflow_steps']['Row'],
	'id' | 'position' | 'label_override' | 'stale_after_days'
> & {
	readonly workflow_nodes_catalog: {
		readonly label: string
		readonly color: string
		readonly kind: string
		readonly default_stale_after_days: number | null
	} | null
}

/** Une étape **résolue** : ce qu'une colonne a besoin de savoir, sans rien recroiser. */
export type EtapeBoard = {
	readonly id: string
	readonly position: number
	readonly libelle: string
	readonly couleur: CouleurNoeud
	readonly kind: string
	/** Seuil de relance en jours, `null` lorsque ni l'étape ni son nœud n'en posent (§7.4). */
	readonly seuilJours: number | null
}

export type CardBoard = Pick<
	Database['public']['Tables']['cards']['Row'],
	| 'id'
	| 'title'
	| 'position'
	| 'amount'
	| 'currency'
	| 'next_action'
	| 'current_step_id'
	| 'entered_step_at'
	| 'email_local_part'
	| 'owner_id'
	// Lue depuis la tranche 2 b de `CRM-081` : le board masque les affaires en sommeil et marque
	// celles qu'il montre (docs/SPEC-cards.md §16.12).
	| 'snoozed_until'
> & {
	readonly responsable: ProfilAffiche | null
}

export type TransitionLue = Pick<
	Database['public']['Tables']['workflow_transitions']['Row'],
	'id' | 'from_step_id' | 'to_step_id' | 'label' | 'require_comment'
>

export type ChampLibelle = Pick<Database['public']['Tables']['form_fields']['Row'], 'key' | 'label'>

// Réexportées pour que le rendu et ses preuves n'aient qu'une seule porte d'entrée, alors que la
// déclaration elle-même vit dans un module sans React ni DOM : la preuve d'API appartient à un
// autre projet TypeScript et ne peut pas importer un module du navigateur — mesuré, elle échoue
// sur `webapp/src/lib/supabase.ts` (docs/SPEC-workflow-engine.md §7.2).
export {
	COLONNES_CARD_BOARD,
	COLONNES_CHAMP_LIBELLE,
	COLONNES_ETAPE,
	COLONNES_TRANSITION,
} from './colonnes-board'

/** Une transition **résolue** : le geste tel que le menu et le dépôt en ont besoin (§7.5). */
export type TransitionBoard = {
	readonly id: string
	readonly versEtape: EtapeBoard
	/** `null` : la transition n'a pas de libellé propre, le rendu se replie sur l'étape (§7.5). */
	readonly libelle: string | null
	readonly requiertCommentaire: boolean
}

/** Une carte de card, prête à rendre — l'ancienneté est calculée ici, pas dans le composant. */
export type CarteBoard = {
	readonly card: CardBoard
	readonly joursDansEtape: number
	readonly seuilJours: number | null
	readonly ancienneteDepassee: boolean
	/**
	 * L'affaire dort-elle ? Calculé ici, avec **l'instant qui a servi au filtre** (§16.12.3).
	 *
	 * Le composant ne le recalcule pas, et ce n'est pas une commodité : le board masque et marque
	 * avec la même définition, et laisser le rendu appeler `estEnSommeil` avec un `new Date()` qui
	 * lui est propre ferait qu'une carte pourrait être rendue par le filtre et non marquée par la
	 * pastille — deux instants, deux verdicts. Une seule définition, un seul instant.
	 *
	 * Vrai uniquement en mode « visibles » en pratique : en mode masqué, ces cartes ne sont pas
	 * composées. La valeur n'en dépend pourtant pas — elle dit l'état de l'affaire, pas celui de la vue.
	 */
	readonly enSommeil: boolean
}

/** Cumul d'une colonne, ou son refus explicite lorsque deux devises s'y mêlent (§7.3). */
export type CumulColonne = {
	readonly montant: number
	readonly devise: string
}

export type ColonneBoard = {
	readonly etape: EtapeBoard
	readonly cartes: readonly CarteBoard[]
	/** `null` : aucune card ne porte de montant, ou deux devises se mêlent. Jamais `0` par défaut. */
	readonly cumul: CumulColonne | null
	/** Les transitions déclarées **depuis** cette étape, ordonnées par position de l'étape cible. */
	readonly transitions: readonly TransitionBoard[]
}

export type ModeleBoard = {
	readonly colonnes: readonly ColonneBoard[]
	/** Nombre total de cards **rendues**, pour l'état vide du board entier. */
	readonly nombreCards: number
	/**
	 * Nombre de cards écartées par le filtre du sommeil (docs/SPEC-cards.md §16.12.6).
	 *
	 * Il est **connu sans requête supplémentaire** : le board lit déjà toutes les cards actives du
	 * channel, et c'est précisément ce qui permet à son état vide de dire « toutes les affaires de
	 * ce channel sont en sommeil » plutôt que « aucune affaire », qui serait faux.
	 */
	readonly nombreEnSommeilMasquees: number
}

const MILLISECONDES_PAR_JOUR = 24 * 60 * 60 * 1000

/**
 * Résout une étape lue en étape de board.
 *
 * Le nœud embarqué peut être `null` : la politique de lecture du catalogue est distincte de
 * celle des étapes, et rien ne garantit que les deux consentent la même chose au même appelant.
 * Le libellé se replie alors sur une chaîne vide plutôt que sur un texte inventé — le composant
 * décide quoi en montrer, ce module ne ment pas sur ce qu'il a reçu.
 */
export function resoudreEtape(lue: EtapeLue): EtapeBoard {
	const noeud = lue.workflow_nodes_catalog
	return {
		id: lue.id,
		position: lue.position,
		libelle: lue.label_override ?? noeud?.label ?? '',
		couleur: couleurNoeud(noeud?.color),
		kind: noeud?.kind ?? 'open',
		seuilJours: lue.stale_after_days ?? noeud?.default_stale_after_days ?? null,
	}
}

/**
 * Indexe les transitions par étape de départ, en les ordonnant par **position de l'étape cible**.
 *
 * MESURÉ : `workflow_transitions` ne porte aucune colonne `position` (§7.5). C'est le seul ordre
 * que la donnée porte ; un ordre alphabétique ferait passer « Marquer perdu » avant « Relancer »
 * sur toutes les étapes du seed.
 *
 * Une transition dont l'étape cible est absente des colonnes lues est **ignorée** : le cas est
 * structurellement impossible — la clé composite `(to_step_id, workflow_id)` l'interdit —, et
 * rendre une colonne fantôme serait pire que ne rien rendre.
 */
export function indexerTransitions(
	etapes: readonly EtapeBoard[],
	transitions: readonly TransitionLue[],
): ReadonlyMap<string, readonly TransitionBoard[]> {
	const parId = new Map(etapes.map((etape) => [etape.id, etape]))
	const index = new Map<string, TransitionBoard[]>()
	for (const transition of transitions) {
		const versEtape = parId.get(transition.to_step_id)
		if (versEtape === undefined) continue
		const liste = index.get(transition.from_step_id) ?? []
		liste.push({
			id: transition.id,
			versEtape,
			libelle: transition.label,
			requiertCommentaire: transition.require_comment,
		})
		index.set(transition.from_step_id, liste)
	}
	for (const liste of index.values()) {
		liste.sort((gauche, droite) => gauche.versEtape.position - droite.versEtape.position)
	}
	return index
}

/**
 * Cumul des montants d'une colonne, ou `null`.
 *
 * Deux devises mêlées ne s'additionnent pas : la colonne n'affiche alors **aucun** cumul plutôt
 * qu'une somme fausse. MESURÉ sur le seed : `EUR` et `CHF` vivent sur des channels distincts, la
 * situation n'y survient pas — l'écart est donc tenu par ce test, pas par une donnée.
 */
export function cumulerMontants(cards: readonly CardBoard[]): CumulColonne | null {
	const avecMontant = cards.filter((card) => card.amount !== null)
	const premiere = avecMontant[0]
	if (premiere === undefined) return null
	const devise = premiere.currency
	if (avecMontant.some((card) => card.currency !== devise)) return null
	return {
		montant: avecMontant.reduce((total, card) => total + (card.amount ?? 0), 0),
		devise,
	}
}

/**
 * Ancienneté d'une card dans son étape, et dépassement du seuil de relance (§7.4).
 *
 * Le seuil absent ne devient jamais un seuil par défaut : `docs/DESIGN_SYSTEM.md` §5.1 parle du
 * « seuil de relance », et en inventer un serait une règle de produit que personne n'a prise.
 * MESURÉ : l'étape `Livré` du seed n'en porte aucun.
 */
export function evaluerAnciennete(
	card: CardBoard,
	seuilJours: number | null,
	maintenant: Date,
): CarteBoard {
	const entree = new Date(card.entered_step_at).getTime()
	const jours = Math.floor((maintenant.getTime() - entree) / MILLISECONDES_PAR_JOUR)
	return {
		card,
		joursDansEtape: Number.isFinite(jours) ? Math.max(jours, 0) : 0,
		seuilJours,
		ancienneteDepassee: seuilJours !== null && Number.isFinite(jours) && jours >= seuilJours,
		// Le MÊME instant que celui du filtre de `composerBoard` (§16.12.3) : c'est le seul moyen
		// qu'une carte rendue par l'un soit marquée par l'autre.
		enSommeil: estEnSommeil(card.snoozed_until, maintenant),
	}
}

/**
 * Compose le board, selon `docs/SPEC-workflow-engine.md` §7.3.
 *
 * **La composition part des étapes, jamais des cards.** Grouper les cards par étape produirait
 * uniquement les colonnes occupées, et perdrait en silence les autres : MESURÉ sur le seed,
 * `grands-comptes` n'occupe que deux étapes sur sept — cinq colonnes vides sont la situation
 * normale, pas le cas limite.
 *
 * L'ordre des cards est `position`, puis `title`. Le second critère n'est pas décoratif :
 * MESURÉ, `position` n'est pas dense — la card `…0000c7` est seule dans sa colonne et y porte la
 * position `2` — et deux cards peuvent partager une valeur après un déplacement. Sans départage,
 * elles s'échangeraient d'un chargement à l'autre.
 */
export function composerBoard({
	etapes,
	cards,
	transitions,
	maintenant,
	modeSommeil = MODE_SOMMEIL_PAR_DEFAUT,
}: {
	readonly etapes: readonly EtapeBoard[]
	readonly cards: readonly CardBoard[]
	readonly transitions: readonly TransitionLue[]
	readonly maintenant: Date
	/** Défaut : les affaires en sommeil sont **masquées** (docs/SPEC-cards.md §16.12.4). */
	readonly modeSommeil?: ModeSommeil
}): ModeleBoard {
	const index = indexerTransitions(etapes, transitions)
	const ordonnees = [...etapes].sort((gauche, droite) => gauche.position - droite.position)
	// LE FILTRE S'APPLIQUE ICI, ET NON AU SERVEUR (§16.12.3) : le board ne pagine pas et lit déjà
	// toutes les cards actives du channel en une requête. Le porter dans la requête coûterait une
	// lecture de plus à chaque bascule et ferait perdre le nombre de masquées, dont l'état vide a
	// besoin. L'argument qui impose le serveur pour « active » ne se transporte pas : le sommeil
	// n'est la garde de rien — une affaire endormie se déplace et s'édite comme une autre.
	const dort = (card: CardBoard) => estEnSommeil(card.snoozed_until, maintenant)
	const visibles = modeSommeil === 'visibles' ? cards : cards.filter((card) => !dort(card))
	const colonnes = ordonnees.map((etape) => {
		const siennes = visibles
			.filter((card) => card.current_step_id === etape.id)
			.sort(
				(gauche, droite) =>
					gauche.position - droite.position || gauche.title.localeCompare(droite.title, 'fr'),
			)
		return {
			etape,
			cartes: siennes.map((card) => evaluerAnciennete(card, etape.seuilJours, maintenant)),
			cumul: cumulerMontants(siennes),
			transitions: index.get(etape.id) ?? [],
		}
	})
	return {
		colonnes,
		// Le compte porte sur les cards **rendues** (§16.12.8) : une colonne, et le board entier,
		// annoncent ce qu'ils montrent. Un compteur qui inclurait les masquées désignerait des
		// cartes introuvables à l'œil.
		nombreCards: visibles.filter((card) =>
			ordonnees.some((etape) => etape.id === card.current_step_id),
		).length,
		nombreEnSommeilMasquees:
			modeSommeil === 'visibles'
				? 0
				: cards.filter(
						(card) => dort(card) && ordonnees.some((etape) => etape.id === card.current_step_id),
					).length,
	}
}

// --- Les sept refus de `move_card` (§7.10) -------------------------------------------------

/**
 * Les messages que la garde émet, tels qu'ils voyagent — des **jetons stables comparés par
 * égalité**, jamais des textes affichés. C'est le contrat posé par la décision 126, qui a fait
 * voyager la liste des champs manquants dans le `DETAIL` plutôt que dans le message.
 */
export const MESSAGES_REFUS = [
	'card_not_found',
	'forbidden',
	'step_not_in_workflow',
	'transition_not_allowed',
	'comment_required',
	'missing_required_fields',
] as const

export type MessageRefus = (typeof MESSAGES_REFUS)[number]

/** Le `42501` de PostgREST sur un appelant sans privilège d'exécution — mesuré `401`. */
export const REFUS_ANONYME = 'anonyme'

export type RefusDeplacement = {
	/** Jeton connu, `REFUS_ANONYME`, ou `null` lorsque le message n'est pas de ceux qu'on connaît. */
	readonly cle: MessageRefus | typeof REFUS_ANONYME | null
	/** Libellés des champs manquants, dans l'ordre du `DETAIL`. Vide pour les autres refus. */
	readonly champsManquants: readonly string[]
	/**
	 * Les **clés** des mêmes champs, dans le même ordre — ce que le `DETAIL` porte réellement.
	 *
	 * Le libellé est ce qui se lit ; la clé est ce qui se transporte. La reprise de la saisie
	 * (`docs/SPEC-form-composer.md` §4 ter.3) désigne les champs par leur clé, stable par workflow,
	 * là où un libellé changerait l'adresse au premier renommage.
	 */
	readonly clesManquantes: readonly string[]
	/** Message brut du backend, affiché **en plus** lorsque `cle` est `null` (§7.10). */
	readonly brut: string
}

/**
 * Classe un refus de `move_card`, et **n'en absorbe aucun**.
 *
 * Un message inconnu rend `cle: null` et conserve le message brut : une valeur par défaut qui
 * cacherait un refus non prévu est précisément ce que `CLAUDE.md` §18 interdit, et un refus muet
 * ferait croire à un défaut d'interface.
 *
 * Une clé sans libellé reste la clé. Elle est moins lisible qu'un libellé ; elle est vraie.
 */
export function classerRefus(
	message: string,
	details: string | null | undefined,
	libelles: ReadonlyMap<string, string>,
	code?: string | null,
): RefusDeplacement {
	const connu = MESSAGES_REFUS.find((jeton) => jeton === message)
	if (connu === 'missing_required_fields') {
		const cles = (details ?? '')
			.split(',')
			.map((cle) => cle.trim())
			.filter((cle) => cle.length > 0)
		return {
			cle: connu,
			champsManquants: cles.map((cle) => libelles.get(cle) ?? cle),
			clesManquantes: cles,
			brut: message,
		}
	}
	if (connu !== undefined)
		return { cle: connu, champsManquants: [], clesManquantes: [], brut: message }
	// Le privilège d'exécution refusé n'est pas un message de la garde : c'est PostgreSQL qui
	// répond avant elle. Il est reconnu par son `SQLSTATE`, jamais par le texte du message, qui
	// dépend de la version du serveur (docs/SPEC-workflow-engine.md §7.10).
	if (code === '42501')
		return { cle: REFUS_ANONYME, champsManquants: [], clesManquantes: [], brut: message }
	return { cle: null, champsManquants: [], clesManquantes: [], brut: message }
}

// --- Optimisme et retour arrière (§7.9) ----------------------------------------------------

/**
 * Déplace une card **dans l'état local**, en fin de colonne d'arrivée.
 *
 * C'est l'état optimiste, et rien d'autre : `position` n'est pas celle que la base attribuera.
 * La réponse de `move_card` remplace ensuite la card entière (§7.9), plutôt que de compléter
 * cet état — recopier une position que la base n'a pas attribuée afficherait un rang faux.
 */
export function appliquerDeplacement(
	cards: readonly CardBoard[],
	idCard: string,
	versEtapeId: string,
): readonly CardBoard[] {
	const rangs = cards
		.filter((card) => card.current_step_id === versEtapeId)
		.map((card) => card.position)
	const dernier = rangs.length === 0 ? 0 : Math.max(...rangs)
	return cards.map((card) =>
		card.id === idCard ? { ...card, current_step_id: versEtapeId, position: dernier + 1 } : card,
	)
}

/** Remplace une card par la ligne que `move_card` a rendue. */
export function remplacerCard(
	cards: readonly CardBoard[],
	ligne: CardBoard,
): readonly CardBoard[] {
	return cards.map((card) =>
		card.id === ligne.id
			? {
					...ligne,
					// `move_card` rend une ligne de `cards`, pas une relation PostgREST. Le déplacement
					// ne modifie jamais `owner_id` : conserver l'embed déjà consenti évite un avatar qui
					// disparaît jusqu'au prochain rechargement.
					responsable:
						ligne.owner_id === card.owner_id ? (ligne.responsable ?? card.responsable) : ligne.responsable,
				}
			: card,
	)
}

/**
 * Reporte sur la card détenue par l'écran la SEULE colonne que les deux gestes de sommeil écrivent
 * — `docs/SPEC-cards.md` §16.13.3.
 *
 * ELLE NE REMPLACE PAS LA CARD, ET C'EST LA DIFFÉRENCE AVEC `remplacerCard` CI-DESSUS.
 * `snooze_card` et `wake_card` rendent le type composite `public.cards`, donc **sans** la relation
 * `profiles` embarquée que la carte porte pour son avatar (`CRM-022`) : remplacer la ligne entière
 * ferait disparaître l'avatar du responsable jusqu'au prochain chargement. Le sommeil ne touche
 * qu'une colonne ; n'en reporter qu'une est à la fois le plus sûr et le plus exact.
 *
 * L'échéance vient de la LIGNE RENDUE, jamais de la saisie (§16.11.4) : l'écran n'annonce jamais un
 * sommeil que le serveur n'a pas confirmé.
 */
export function appliquerSommeil(
	cards: readonly CardBoard[],
	idCard: string,
	snoozedUntil: string | null,
): readonly CardBoard[] {
	return cards.map((card) => (card.id === idCard ? { ...card, snoozed_until: snoozedUntil } : card))
}

// --- Lectures (§7.2) -----------------------------------------------------------------------

export type ContenuBoard = {
	readonly etapes: readonly EtapeBoard[]
	readonly cards: readonly CardBoard[]
	readonly transitions: readonly TransitionLue[]
	/** Clé de champ → libellé, pour traduire le `DETAIL` d'un `missing_required_fields`. */
	readonly libellesChamps: ReadonlyMap<string, string>
}

/**
 * Traduit un échec inattendu — une exception, et non une réponse — en état d'erreur.
 *
 * Les quatre lectures ci-dessous répètent la même structure que celles de `channels.ts` et de
 * `formulaire.ts`, plutôt qu'un enveloppeur générique : l'inférence de types de `supabase-js`
 * dépend de la chaîne `select`, et la faire transiter par une fonction générique obligerait à
 * un `as` qui effacerait exactement ce que le compilateur doit vérifier.
 */
function surException(cause: unknown) {
	return classerErreur(undefined, cause instanceof Error ? cause.message : String(cause))
}

export async function lireEtapes(
	client: ClientCrm,
	workflowId: string,
): Promise<EtatAsync<readonly EtapeLue[]>> {
	try {
		const reponse = await client
			.from('workflow_steps')
			.select(COLONNES_ETAPE)
			.eq('workflow_id', workflowId)
			.order('position')
		if (reponse.error !== null) {
			return enErreur(classerErreur(reponse.status, reponse.error.message))
		}
		return pret(reponse.data)
	} catch (cause) {
		return enErreur(surException(cause))
	}
}

export async function lireTransitions(
	client: ClientCrm,
	workflowId: string,
): Promise<EtatAsync<readonly TransitionLue[]>> {
	try {
		const reponse = await client
			.from('workflow_transitions')
			.select(COLONNES_TRANSITION)
			.eq('workflow_id', workflowId)
		if (reponse.error !== null) {
			return enErreur(classerErreur(reponse.status, reponse.error.message))
		}
		return pret(reponse.data)
	} catch (cause) {
		return enErreur(surException(cause))
	}
}

/**
 * Les cards **actives** d'un channel, dans l'ordre des colonnes.
 *
 * Les deux filtres d'exclusion sont **côté serveur** : c'est la définition d'« active » de
 * `docs/SPEC-cards.md` §5, la même qu'emploie la première vérification de `move_card`. Les
 * appliquer dans le composant ferait transiter des lignes que l'écran ne montrera jamais, et
 * ferait diverger l'écran de la garde.
 */
export async function lireCards(
	client: ClientCrm,
	channelId: string,
): Promise<EtatAsync<readonly CardBoard[]>> {
	try {
		const reponse = await client
			.from('cards')
			.select(COLONNES_CARD_BOARD)
			.eq('channel_id', channelId)
			.is('archived_at', null)
			.is('deleted_at', null)
			.order('position')
			.order('title')
		if (reponse.error !== null) {
			return enErreur(classerErreur(reponse.status, reponse.error.message))
		}
		return pret(reponse.data.map((card) => ({ ...card, responsable: card.responsable ?? null })))
	} catch (cause) {
		return enErreur(surException(cause))
	}
}

export async function lireLibellesChamps(
	client: ClientCrm,
	workflowId: string,
): Promise<EtatAsync<readonly ChampLibelle[]>> {
	try {
		const reponse = await client
			.from('form_fields')
			.select(COLONNES_CHAMP_LIBELLE)
			.eq('workflow_id', workflowId)
		if (reponse.error !== null) {
			return enErreur(classerErreur(reponse.status, reponse.error.message))
		}
		return pret(reponse.data)
	} catch (cause) {
		return enErreur(surException(cause))
	}
}

/**
 * Charge le contenu du board : les quatre lectures du §7.2, **en parallèle**.
 *
 * Elles ne dépendent que de `workflow_id` et de `channel_id`, connus ensemble dès que le channel
 * est résolu dans la liste que la coquille a déjà chargée. Les enchaîner multiplierait par quatre
 * la latence d'ouverture sans rien garantir de plus.
 *
 * Un échec de **l'une quelconque** rend l'état d'erreur du board entier (§7.11) : afficher des
 * colonnes sans leurs cards, ou des cards sans leurs gestes, serait un écran à moitié faux.
 */
export function useContenuBoard(
	client: ClientCrm | null,
	channelId: string | undefined,
	workflowId: string | undefined,
): {
	readonly etat: EtatAsync<ContenuBoard>
	readonly recharger: () => void
} {
	const [etat, setEtat] = useState<EtatAsync<ContenuBoard>>(enChargement)
	const [tentative, setTentative] = useState(0)
	// Une réponse arrivée après le démontage ne doit pas écrire dans un composant démonté, ni une
	// réponse périmée écraser une réponse plus récente — le channel change d'un onglet à l'autre.
	const courant = useRef(0)

	useEffect(() => {
		if (client === null || channelId === undefined || workflowId === undefined) return
		const rang = ++courant.current
		setEtat(enChargement)
		void (async () => {
			const [etapes, cards, transitions, champs] = await Promise.all([
				lireEtapes(client, workflowId),
				lireCards(client, channelId),
				lireTransitions(client, workflowId),
				lireLibellesChamps(client, workflowId),
			])
			if (rang !== courant.current) return
			for (const resultat of [etapes, cards, transitions, champs]) {
				if (resultat.statut === 'erreur') {
					setEtat(enErreur(resultat.erreur))
					return
				}
			}
			if (
				etapes.statut !== 'pret' ||
				cards.statut !== 'pret' ||
				transitions.statut !== 'pret' ||
				champs.statut !== 'pret'
			) {
				return
			}
			setEtat(
				pret({
					etapes: etapes.donnees.map(resoudreEtape),
					cards: cards.donnees,
					transitions: transitions.donnees,
					libellesChamps: new Map(champs.donnees.map((champ) => [champ.key, champ.label])),
				}),
			)
		})()
	}, [client, channelId, workflowId, tentative])

	const recharger = useCallback(() => {
		setTentative((precedente) => precedente + 1)
	}, [])

	return { etat, recharger }
}

// --- L'appel de la garde (§5.2, §7.9) ------------------------------------------------------

export type ResultatDeplacement =
	| { readonly statut: 'ok'; readonly card: CardBoard }
	| { readonly statut: 'refus'; readonly refus: RefusDeplacement }

/**
 * Appelle `move_card`, le **seul chemin** par lequel une card change d'étape (§5.1).
 *
 * La fonction rend la ligne mise à jour, et non `void` : le client obtient en une requête
 * l'étape, `entered_step_at` et `position` recalculés (§5.2). Le board est le premier appelant à
 * s'en servir.
 *
 * Le commentaire n'est transmis que lorsqu'il est fourni : passer `null` explicitement et ne rien
 * passer sont équivalents pour la garde, mais l'omission dit mieux ce que le client sait.
 */
export async function deplacerCard(
	client: ClientCrm,
	idCard: string,
	versEtapeId: string,
	commentaire: string | null,
	libelles: ReadonlyMap<string, string>,
): Promise<ResultatDeplacement> {
	try {
		const reponse = await client.rpc('move_card', {
			card_id: idCard,
			to_step_id: versEtapeId,
			...(commentaire === null ? {} : { comment: commentaire }),
		})
		if (reponse.error !== null) {
			return {
				statut: 'refus',
				refus: classerRefus(
					reponse.error.message,
					reponse.error.details,
					libelles,
					reponse.error.code,
				),
			}
		}
		return {
			statut: 'ok',
			card: { ...(reponse.data as unknown as Omit<CardBoard, 'responsable'>), responsable: null },
		}
	} catch (cause) {
		return {
			statut: 'refus',
			refus: classerRefus(
				cause instanceof Error ? cause.message : String(cause),
				null,
				libelles,
				null,
			),
		}
	}
}
