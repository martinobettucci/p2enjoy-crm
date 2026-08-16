// @spec CRM-081 (docs/BACKLOG.md) — mise en sommeil d'une affaire, tranche 2 a
// @spec docs/SPEC-cards.md §16.2 (ce que « en sommeil » signifie), §16.3 (les quatre refus de
//       `snooze_card` et leur ordre), §16.4 (l'idempotence de `wake_card`), §16.8 (contrat d'API),
//       §16.11.1 (le prédicat se calcule à la lecture), §16.11.3 (les quatre échéances usuelles),
//       §16.11.4 (dictionnaire fermé des issues)
// @spec docs/DESIGN_SYSTEM.md §5.3 quater (de quoi le geste a l'air), §5.7 (mention d'erreur)
//
// Ce module ne rend rien : il **décide**. La séparation est ce qui rend le prédicat, les quatre
// échéances usuelles et le classement des huit issues vérifiables **sans navigateur** — un
// composant ne les exercerait qu'à travers un rendu, et l'instant de comparaison ne serait alors
// pas injectable.
//
// AUCUNE MIGRATION N'ACCOMPAGNE CETTE TRANCHE : les deux fonctions, la fermeture de la colonne et
// le trigger de trace sont livrés par `supabase/migrations/0044_snooze_cards.sql` (tranche 1). Ce
// qui manquait était le **chemin** vers elles.

import type { ClientCrm } from './supabase'

/**
 * Une card est **en sommeil** si `snoozed_until` est non nulle ET strictement postérieure à
 * l'instant de rendu (docs/SPEC-cards.md §16.2).
 *
 * L'INSTANT EST INJECTABLE, et ce n'est pas une commodité de test : sans lui, aucune preuve ne
 * pourrait éprouver les deux côtés du prédicat sans dépendre de l'heure à laquelle elle s'exécute
 * — une échéance figée dans une fixture cesserait d'être future au bout de quelques semaines, et
 * la preuve changerait de verdict sans que le produit ait bougé.
 *
 * Une valeur que `Date` ne sait pas lire rend `false` plutôt qu'un `NaN` propagé : le type généré
 * ne garantit aucune valeur (`docs/SPEC-types.md`), et une comparaison avec `NaN` est fausse de
 * toute façon — la rendre explicite évite d'avoir à s'en souvenir.
 */
export function estEnSommeil(
	snoozedUntil: string | null,
	maintenant: Date = new Date(),
): boolean {
	if (snoozedUntil === null) return false
	const echeance = new Date(snoozedUntil)
	if (Number.isNaN(echeance.getTime())) return false
	return echeance.getTime() > maintenant.getTime()
}

/**
 * L'échéance en date courte, ou `null` lorsqu'elle n'est pas lisible.
 *
 * MÊME FORMAT COURT que l'échéance de la prochaine action (`formaterEcheance` de `entete-card.ts`)
 * et que la dernière relève du §5.14 : deux dates du même produit ne se lisent pas dans deux
 * formats. La duplication est assumée plutôt que factorisée — les deux fonctions répondent à deux
 * chapitres qui peuvent diverger, et les lier ferait qu'un changement de l'une changerait l'autre
 * sans que personne l'ait demandé.
 */
export function formaterEcheanceSommeil(valeur: string | null, locale = 'fr-FR'): string | null {
	if (valeur === null) return null
	const date = new Date(valeur)
	if (Number.isNaN(date.getTime())) return null
	return new Intl.DateTimeFormat(locale, { dateStyle: 'short' }).format(date)
}

/** Les quatre échéances usuelles du §16.11.3, en jours ajoutés à l'instant courant. */
export const ECHEANCES_USUELLES = [
	{ cle: 'demain', jours: 1 },
	{ cle: 'troisjours', jours: 3 },
	{ cle: 'semaine', jours: 7 },
	{ cle: 'mois', jours: 30 },
] as const

export type CleEcheanceUsuelle = (typeof ECHEANCES_USUELLES)[number]['cle']

const MILLISECONDES_PAR_JOUR = 24 * 60 * 60 * 1000

/**
 * L'échéance ISO 8601 d'une échéance usuelle, comptée depuis l'instant courant.
 *
 * DES JOURS AJOUTÉS À L'INSTANT, jamais une date calée sur un début de journée (§16.11.3) :
 * « demain à la même heure » est une promesse que le produit tient, là où « demain à 9 h »
 * inventerait une heure de bureau que personne n'a spécifiée.
 *
 * « Le mois prochain » vaut trente jours et non le même quantième du mois suivant : le second
 * n'existe pas pour le 31 janvier, et la règle de repli serait une décision de produit que
 * personne n'a prise.
 */
export function echeanceUsuelle(jours: number, maintenant: Date = new Date()): string {
	return new Date(maintenant.getTime() + jours * MILLISECONDES_PAR_JOUR).toISOString()
}

/**
 * L'échéance ISO 8601 d'une saisie `datetime-local`, ou `null` lorsqu'elle n'est pas convertible.
 *
 * `datetime-local` rend une chaîne SANS fuseau — « 2026-09-01T14:30 » —, que `Date` interprète
 * dans le fuseau du navigateur. C'est exactement ce que l'utilisateur a voulu dire : il a saisi une
 * heure locale.
 *
 * UNE SAISIE VIDE REND `null`, ET ELLE EST ENVOYÉE TELLE QUELLE : c'est `snooze_date_required` qui
 * la refuse (§16.3), pas l'écran. Doubler cette contrainte côté client contredirait le §5.3 ter du
 * design system, et masquerait la disparition de la garde le jour où elle disparaîtrait.
 */
export function echeanceSaisie(saisie: string): string | null {
	if (saisie === '') return null
	const date = new Date(saisie)
	if (Number.isNaN(date.getTime())) return null
	return date.toISOString()
}

/**
 * Les huit issues des deux gestes — dictionnaire fermé du §16.11.4.
 *
 * `endormie` et `reveillee` sont DEUX issues et non une seule « succès » : l'écran n'en dit pas la
 * même chose, et la pastille apparaît dans un cas, disparaît dans l'autre.
 */
export type IssueSommeil =
	/** `200` sur `snooze_card` : la ligne rendue porte la nouvelle échéance. */
	| 'endormie'
	/** `200` sur `wake_card` : la ligne rendue porte `snoozed_until` nulle. */
	| 'reveillee'
	/** `400`, `snooze_date_required` : l'échéance manque (§16.3, refus n° 3). */
	| 'echeance-requise'
	/** `400`, `snooze_date_in_past` : l'échéance rendrait la card immédiatement éveillée (refus n° 4). */
	| 'echeance-passee'
	/** `400`, `card_not_found` : absente, archivée, ou d'un channel non lisible (refus n° 1). */
	| 'introuvable'
	/** `403`, `forbidden` : lue sans droit d'écriture sur le channel (refus n° 2). */
	| 'refus'
	/** Aucune réponse : la requête n'a jamais abouti. */
	| 'reseau'
	/** Tout le reste. L'interface ne prétend pas savoir. */
	| 'inconnu'

/**
 * Classe une réponse des deux gestes sur le code HTTP et le MESSAGE que la garde oppose.
 *
 * LE MESSAGE, ET NON UN TEXTE LIBRE DE SERVEUR : les quatre refus du §16.3 sont levés par
 * `raise exception ... using message = '<code>'`, et PostgREST rend ce code tel quel dans
 * `message`. Ce sont des identifiants stables du contrat d'API (§16.8), au même titre qu'un
 * `SQLSTATE` — les trois refus applicatifs partagent d'ailleurs `P0001` et ne se distinguent que
 * par lui.
 *
 * `succes` dit lequel des deux gestes a réussi : les deux rendent `200`, et sans lui l'écran ne
 * saurait pas s'il doit poser la pastille ou la retirer.
 */
export function classerSommeil(
	statutHttp: number | undefined,
	message: string | null,
	succes: 'endormie' | 'reveillee',
): IssueSommeil {
	if (statutHttp === undefined || statutHttp === 0) return 'reseau'
	if (message !== null) {
		if (message === 'snooze_date_required') return 'echeance-requise'
		if (message === 'snooze_date_in_past') return 'echeance-passee'
		if (message === 'card_not_found') return 'introuvable'
		if (message === 'forbidden') return 'refus'
		return 'inconnu'
	}
	if (statutHttp >= 200 && statutHttp < 300) return succes
	return 'inconnu'
}

/** Ce que les deux gestes rendent à l'écran lorsqu'ils ont abouti — la ligne telle que la BASE la porte. */
export type LigneSommeil = { readonly id: string; readonly snoozed_until: string | null }

export type ResultatSommeil =
	| { readonly issue: 'endormie' | 'reveillee'; readonly ligne: LigneSommeil }
	| { readonly issue: Exclude<IssueSommeil, 'endormie' | 'reveillee'> }

/**
 * Réduit la réponse d'un RPC à son issue et, en cas de succès, à la ligne rendue.
 *
 * LA LIGNE RENDUE EST LA SOURCE DE LA MISE À JOUR, jamais la saisie (§16.11.4) : les deux fonctions
 * rendent le type composite `public.cards`, et c'est l'échéance que la BASE a écrite qui doit
 * atteindre la pastille. Un succès sans ligne exploitable retombe sur `inconnu` plutôt que sur un
 * succès inventé — l'écran n'annonce jamais un sommeil que le serveur n'a pas confirmé.
 */
function reduire(
	statut: number | undefined,
	message: string | null,
	donnee: unknown,
	succes: 'endormie' | 'reveillee',
): ResultatSommeil {
	const issue = classerSommeil(statut, message, succes)
	// Les deux succès sont nommés plutôt que comparés à `succes` : le compilateur ne sait pas que
	// `classerSommeil` ne rend jamais que celui qu'on lui a passé, et la comparaison ne rétrécirait
	// donc pas le type de retour.
	if (issue !== 'endormie' && issue !== 'reveillee') return { issue }
	if (donnee === null || typeof donnee !== 'object' || Array.isArray(donnee)) {
		return { issue: 'inconnu' }
	}
	const ligne = donnee as { id?: unknown; snoozed_until?: unknown }
	if (typeof ligne.id !== 'string') return { issue: 'inconnu' }
	const echeance = typeof ligne.snoozed_until === 'string' ? ligne.snoozed_until : null
	return { issue, ligne: { id: ligne.id, snoozed_until: echeance } }
}

/**
 * Met une affaire en sommeil jusqu'à `until` — le geste du §16.3.
 *
 * `until` PEUT ÊTRE `null`, et cette signature est délibérée : la saisie vide doit atteindre la
 * base pour que `snooze_date_required` la refuse (§16.11.3). Le type généré déclare l'argument non
 * nullable — PostgREST accepte pourtant `null`, MESURÉ par le scénario n° 3 de
 * `e2e/api/snooze.spec.ts` —, d'où la seule conversion de type de ce module, restreinte à cet
 * argument et motivée ici plutôt que subie à l'appel.
 */
export async function mettreEnSommeil(
	client: ClientCrm,
	idCard: string,
	until: string | null,
): Promise<ResultatSommeil> {
	try {
		const reponse = await client.rpc('snooze_card', {
			card_id: idCard,
			until: until as string,
		})
		return reduire(
			reponse.status,
			reponse.error === null ? null : reponse.error.message,
			reponse.data,
			'endormie',
		)
	} catch (cause) {
		// `supabase-js` peut relancer une panne de transport plutôt que la rendre.
		void cause
		return { issue: 'reseau' }
	}
}

/**
 * Réveille une affaire — le geste du §16.4, idempotent et sans refus propre.
 *
 * Sur une affaire qui ne dort pas, la base ne fait rien, n'écrit aucun événement et rend `200` :
 * l'issue est donc `reveillee`, et c'est exact. Un réveil sans sommeil n'est pas une erreur du
 * demandeur, c'est un état déjà atteint.
 */
export async function reveiller(client: ClientCrm, idCard: string): Promise<ResultatSommeil> {
	try {
		const reponse = await client.rpc('wake_card', { card_id: idCard })
		return reduire(
			reponse.status,
			reponse.error === null ? null : reponse.error.message,
			reponse.data,
			'reveillee',
		)
	} catch (cause) {
		void cause
		return { issue: 'reseau' }
	}
}
