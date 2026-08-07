// @spec CRM-043 (docs/BACKLOG.md) — lecture, publication et flux du fil de commentaires
// @spec docs/SPEC-cards.md §13.4 (la pierre tombale), §13.5 (`edited_at`), §13.6 (autorisations),
//       §13.9 (le temps réel, et la règle « recharger à l'abonnement »), §13.10 (le panneau)
// @spec docs/DESIGN_SYSTEM.md §5.10 (panneau de commentaires), §5.8 (états systématiques)
// @spec docs/SPEC-webapp.md §6.4 (contrat asynchrone), §11 (stockage côté client)
// @spec docs/JOURNAL.md décisions 195 (le temps réel mesuré), 200 (le générateur ne voit pas les
//       triggers), 201 (le flux déclenche la lecture, il ne la remplace pas)
//
// Ce module ne rend rien : il **lit, écrit et écoute**. La séparation est ce qui rend l'ordre du
// fil, la classification des refus et la règle d'abonnement vérifiables **sans navigateur**.
//
// Le même client porte soit la clé anonyme, soit la session restaurée par `CRM-009`. L'anonyme
// reçoit un fil vide et un refus ; un membre lit et publie selon la RLS. Le parcours connecté et le
// refus du `viewer` sont éprouvés sans substitution par `e2e/ui/authentification.spec.ts`.

import { useCallback, useEffect, useRef, useState } from 'react'
import { classerErreur, enChargement, enErreur, pret, type EtatAsync } from './async'
import type { Database } from './database.types'
import type { ClientCrm } from './supabase'

/**
 * Colonnes réellement demandées. Exportée pour que les tests éprouvent **la requête émise**.
 *
 * `workspace_id` et `mentions` ne sont pas demandées : la première est une dénormalisation que
 * l'écran n'affiche pas, la seconde n'est alimentée par rien (docs/SPEC-cards.md §13.1). Une
 * requête ne rapporte que ce que l'écran montre.
 *
 * `author_id` est demandée **et pourtant jamais affichée** : le §13.10 ne rend aucun nom d'auteur,
 * `profiles` n'étant lisible par aucun jeton d'utilisateur (INC-014). Elle sert à distinguer les
 * commentaires de l'appelant. Les actions de correction et de suppression ne sont pas encore
 * rendues ; cette colonne évite néanmoins une nouvelle lecture le jour où elles le seront.
 */
export const COLONNES_COMMENTAIRE = 'id, card_id, author_id, body, created_at, edited_at, deleted_at'

export type CommentaireLu = Pick<
	Database['public']['Tables']['card_comments']['Row'],
	'id' | 'card_id' | 'author_id' | 'body' | 'created_at' | 'edited_at' | 'deleted_at'
>

/**
 * Ce que le panneau rend, et rien de plus.
 *
 * `supprime` est un booléen et non une date : le §13.10 n'affiche pas *quand* un commentaire a été
 * supprimé — cette information ne dit rien à personne —, seulement qu'il l'a été. `modifieLe`, en
 * revanche, est une date : elle est portée par l'infobulle de la mention « modifié ».
 */
export type CommentaireAffiche = {
	readonly id: string
	readonly auteurId: string
	/** Vide si et seulement si le commentaire est supprimé : la base ne porte plus de corps. */
	readonly corps: string
	readonly creeLe: string
	readonly modifieLe: string | null
	readonly supprime: boolean
}

/**
 * Projette le fil dans l'ordre où la conversation s'est tenue — **du plus ancien au plus récent**
 * (docs/DESIGN_SYSTEM.md §5.10).
 *
 * L'ordre est **TOTAL**, terminé par `id`, et ce n'est pas une précaution de style : `CRM-042` l'a
 * mesuré sur la sonde `sonde_l2` — un ordre non total parcouru page par page rend 20 lignes dont
 * 17 distinctes (décision 185). Le fil n'est pas paginé aujourd'hui (§13.12), mais deux
 * commentaires publiés dans la même milliseconde suffisent déjà à rendre l'affichage instable d'un
 * rechargement à l'autre, ce qu'un lecteur voit.
 *
 * La projection **ne masque rien** : un commentaire supprimé garde sa place, réduit à sa mention.
 * Le retirer ici ferait disparaître un tour de parole d'une conversation.
 */
export function projeterFil(lignes: readonly CommentaireLu[]): readonly CommentaireAffiche[] {
	return [...lignes]
		.sort((a, b) => (a.created_at === b.created_at ? compare(a.id, b.id) : compare(a.created_at, b.created_at)))
		.map((ligne) => ({
			id: ligne.id,
			auteurId: ligne.author_id,
			corps: ligne.body,
			creeLe: ligne.created_at,
			modifieLe: ligne.edited_at,
			supprime: ligne.deleted_at !== null,
		}))
}

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

/** Lit le fil d'une card. */
export async function lireCommentaires(
	client: ClientCrm,
	idCard: string,
): Promise<EtatAsync<readonly CommentaireAffiche[]>> {
	try {
		const reponse = await client
			.from('card_comments')
			.select(COLONNES_COMMENTAIRE)
			.eq('card_id', idCard)
			.order('created_at')
			.order('id')
		if (reponse.error !== null) {
			return enErreur(classerErreur(reponse.status, reponse.error.message))
		}
		return pret(projeterFil(reponse.data))
	} catch (cause) {
		return enErreur(classerErreur(undefined, cause instanceof Error ? cause.message : String(cause)))
	}
}

/** Les refus qu'une publication peut recevoir, tels que l'écran doit les présenter. */
export type NatureRefusPublication =
	/** `401` ou `403` : le backend a refusé. Le texte saisi est CONSERVÉ (§5.10). */
	| 'forbidden'
	/** `23514` : le `CHECK` du corps. Corps vide, ou plus de 10 000 caractères. */
	| 'invalide'
	| 'network'
	| 'unknown'

export type RefusPublication = {
	readonly nature: NatureRefusPublication
	readonly detail: string
}

/**
 * Classe le refus d'une publication.
 *
 * Le `23514` du `CHECK` est distingué des autres, et ce n'est pas un raffinement : « votre
 * commentaire est trop long » et « vous ne pouvez pas commenter cette affaire » demandent à
 * l'utilisateur deux gestes différents. Les confondre sous « une erreur est survenue » serait la
 * valeur par défaut trompeuse que `CLAUDE.md` §18 proscrit.
 */
export function classerRefusPublication(
	statutHttp: number | undefined,
	code: string | undefined,
	detail: string,
): RefusPublication {
	if (code === '23514') return { nature: 'invalide', detail }
	if (statutHttp === 401 || statutHttp === 403) return { nature: 'forbidden', detail }
	if (statutHttp === undefined || statutHttp === 0) return { nature: 'network', detail }
	return { nature: 'unknown', detail }
}

/**
 * Longueur maximale du corps, **copiée de la contrainte de la base** (docs/SPEC-cards.md §13.4).
 *
 * Elle sert au compteur de l'écran et à rien d'autre : la règle est tenue par le `CHECK`, et le
 * `23514` reste traité. Une borne d'interface qui prétendrait remplacer la contrainte serait
 * exactement le contrôle d'interface que `CLAUDE.md` §10 refuse de considérer comme une règle.
 */
export const LONGUEUR_MAX_CORPS = 10_000

export type Publication = {
	readonly idCard: string
	/**
	 * Le workspace de la card, tel que l'écran l'a lu.
	 *
	 * IL N'EST PAS DÉCIDÉ PAR LE CLIENT — décision 200. Le trigger de la migration 15 le remplace
	 * par celui de la card, quelle que soit la valeur transmise ; la preuve d'API le mesure en
	 * envoyant délibérément un workspace inventé. Il est envoyé parce que le générateur de types,
	 * qui ne voit pas les triggers, déclare la colonne obligatoire — et parce qu'une assertion de
	 * type qui ferait taire le compilateur cacherait cette limite au lieu de l'écrire.
	 */
	readonly idWorkspace: string
	readonly corps: string
}

/**
 * Publie un commentaire.
 *
 * `author_id` **n'est pas envoyé** : la colonne vaut `auth.uid()` par défaut, et la politique
 * d'insertion refuse toute autre valeur (décision 196). L'envoyer reviendrait à demander au client
 * de signer, ce qu'il n'a pas à faire.
 */
export async function publierCommentaire(
	client: ClientCrm,
	publication: Publication,
): Promise<{ readonly statut: 'publie' } | { readonly statut: 'refus'; readonly refus: RefusPublication }> {
	try {
		const reponse = await client.from('card_comments').insert({
			card_id: publication.idCard,
			workspace_id: publication.idWorkspace,
			body: publication.corps,
		})
		if (reponse.error !== null) {
			return {
				statut: 'refus',
				refus: classerRefusPublication(reponse.status, reponse.error.code, reponse.error.message),
			}
		}
		return { statut: 'publie' }
	} catch (cause) {
		return {
			statut: 'refus',
			refus: classerRefusPublication(
				undefined,
				undefined,
				cause instanceof Error ? cause.message : String(cause),
			),
		}
	}
}

/** Nom du canal de temps réel d'une card. Exporté pour que la preuve l'observe. */
export const nomCanal = (idCard: string): string => `commentaires:${idCard}`

/** Filtre du canal : les événements d'une seule card, jamais ceux de toutes. */
export const filtreCanal = (idCard: string): string => `card_id=eq.${idCard}`

/**
 * Le fil d'une card, tenu à jour.
 *
 * DEUX RÈGLES, ET LA PREMIÈRE EST UNE MESURE.
 *
 * 1. **La lecture est déclenchée par l'abonnement, jamais avant** (décision 195). MESURÉ : une
 *    insertion émise juste après `SUBSCRIBED` est reçue dans les quatre délais éprouvés, mais une
 *    première sonde ne l'a pas été, et ce cas n'a pas été reproduit — donc pas expliqué. Charger
 *    puis s'abonner laisserait une fenêtre dont la largeur n'est connue de personne ; s'abonner
 *    puis charger la referme, au prix d'une lecture.
 *
 * 2. **Le flux DÉCLENCHE la lecture, il ne la remplace pas** (décision 201). Un événement ne porte
 *    pas le fil : il dit qu'il a changé. Le panneau relit. C'est une requête de plus par
 *    événement, et c'est le prix de trois choses qu'aucune fusion locale ne donnerait — l'ordre
 *    total est celui du serveur, un événement perdu ou dupliqué ne laisse aucune trace, et la
 *    lecture applique la RLS courante plutôt que celle du moment de l'abonnement.
 */
export function useFilCommentaires(
	client: ClientCrm | null,
	idCard: string | undefined,
): {
	readonly etat: EtatAsync<readonly CommentaireAffiche[]>
	readonly recharger: () => void
} {
	const [etat, setEtat] = useState<EtatAsync<readonly CommentaireAffiche[]>>(enChargement)
	const [tentative, setTentative] = useState(0)
	// Une réponse arrivée après le démontage ne doit pas écrire dans un composant démonté, ni une
	// réponse périmée écraser une réponse plus récente — l'identifiant change d'une card à l'autre.
	const courant = useRef(0)

	useEffect(() => {
		if (client === null || idCard === undefined) return
		const rang = ++courant.current
		setEtat(enChargement)

		const charger = () => {
			void (async () => {
				const resultat = await lireCommentaires(client, idCard)
				if (rang !== courant.current) return
				setEtat(resultat)
			})()
		}

		const canal = client
			.channel(nomCanal(idCard))
			.on(
				'postgres_changes',
				{ event: '*', schema: 'public', table: 'card_comments', filter: filtreCanal(idCard) },
				charger,
			)
			.subscribe((statut) => {
				// `SUBSCRIBED` est le seul état qui autorise la lecture (règle 1). Les deux autres
				// sont des échecs d'abonnement : le fil est chargé quand même, car un panneau muet
				// serait pire qu'un panneau qui ne se met pas à jour tout seul — et l'utilisateur
				// garde l'action de rechargement.
				if (statut === 'SUBSCRIBED' || statut === 'CHANNEL_ERROR' || statut === 'TIMED_OUT') {
					charger()
				}
			})

		return () => {
			void client.removeChannel(canal)
		}
	}, [client, idCard, tentative])

	const recharger = useCallback(() => {
		setTentative((precedente) => precedente + 1)
	}, [])

	return { etat, recharger }
}
