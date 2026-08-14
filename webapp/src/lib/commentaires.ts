// @spec CRM-043 (docs/BACKLOG.md) — lecture, publication et flux du fil de commentaires
// @spec CRM-022 (docs/BACKLOG.md) — auteur embarqué et compte supprimé détaché
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
import type { ProfilAffiche } from './identites'
import type { ClientCrm } from './supabase'

/**
 * Colonnes réellement demandées. Exportée pour que les tests éprouvent **la requête émise**.
 *
 * `workspace_id` et `mentions` ne sont pas demandées : la première est une dénormalisation que
 * l'écran n'affiche pas, la seconde n'est alimentée par rien (docs/SPEC-cards.md §13.1). Une
 * requête ne rapporte que ce que l'écran montre.
 *
 * L'auteur est embarqué par la FK : nom et avatar arrivent dans la même requête. `author_id`
 * distingue un profil réellement supprimé (`null`) d'une relation momentanément illisible, sans
 * jamais rendre l'identifiant technique.
 *
 * `deleted_by` EST DEMANDÉE, ET SEULEMENT COMPARÉE (décision 376). Elle est ce qui distingue un
 * commentaire retiré par un tiers d'un commentaire supprimé par son auteur (docs/SPEC-cards.md
 * §13.6). Elle n'est **pas** embarquée en profil : le §13.13, point 7, écrit que l'écran dit
 * qu'un tiers est intervenu, jamais qui — nommer le modérateur est une autre divulgation, qu'aucun
 * document ne porte. Une colonne d'audit que rien ne lit n'audite rien ; une colonne d'audit
 * affichée au-delà de ce qui est spécifié est une fuite.
 */
export const COLONNES_COMMENTAIRE =
	'id, card_id, author_id, body, created_at, edited_at, deleted_at, deleted_by, auteur:profiles!card_comments_author_id_fkey(id, full_name, avatar_url)'

export type CommentaireLu = Pick<
	Database['public']['Tables']['card_comments']['Row'],
	'id' | 'card_id' | 'author_id' | 'body' | 'created_at' | 'edited_at' | 'deleted_at'
> & {
	readonly auteur: ProfilAffiche | null
	/**
	 * Qui a posé la pierre tombale, ou `null`.
	 *
	 * Déclarée ici plutôt que reprise de `Row` : la colonne est née avec la migration `0035` et le
	 * type généré la porte, mais l'exposer par `Pick` la ferait disparaître silencieusement du
	 * contrat le jour où le générateur serait rejoué sur une base en retard.
	 */
	readonly deleted_by: string | null
}

/**
 * Ce que le panneau rend, et rien de plus.
 *
 * `supprime` est un booléen et non une date : le §13.10 n'affiche pas *quand* un commentaire a été
 * supprimé — cette information ne dit rien à personne —, seulement qu'il l'a été. `modifieLe`, en
 * revanche, est une date : elle est portée par l'infobulle de la mention « modifié ».
 */
export type CommentaireAffiche = {
	readonly id: string
	readonly auteurId: string | null
	readonly auteur: ProfilAffiche | null
	/** Vide si et seulement si le commentaire est supprimé : la base ne porte plus de corps. */
	readonly corps: string
	readonly creeLe: string
	readonly modifieLe: string | null
	readonly supprime: boolean
	/**
	 * Vrai lorsque la pierre tombale a été posée par quelqu'un d'autre que l'auteur.
	 *
	 * C'est un **booléen**, et non l'identifiant du modérateur : le §13.13 de `docs/SPEC-cards.md`,
	 * point 7, arrête l'écran au fait. Il est faux si `deleted_by` est nul, ce qui est le cas d'une
	 * suppression par la clé de service — `auth.uid()` y étant nul, il n'y a personne à nommer.
	 */
	readonly retireParModeration: boolean
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
			auteur: ligne.auteur ?? null,
			corps: ligne.body,
			creeLe: ligne.created_at,
			modifieLe: ligne.edited_at,
			supprime: ligne.deleted_at !== null,
			// LES TROIS CONDITIONS SONT NÉCESSAIRES. `deleted_by` non nul seul ne suffit pas — un
			// auteur qui supprime son propre commentaire y est inscrit lui aussi (le trigger relève
			// `auth.uid()` sans distinguer) ; c'est la DIFFÉRENCE avec `author_id` qui fait la
			// modération (docs/SPEC-cards.md §13.6).
			//
			// `== null` COUVRE `undefined` AUTANT QUE `null`, ET CE N'EST PAS UN RAFFINEMENT DE
			// STYLE. Écrit `!== null`, le prédicat lisait une colonne ABSENTE comme un retrait par
			// un tiers : `undefined` est différent de `null` ET de tout `author_id`. Défaut réel,
			// trouvé par `e2e/ui/commentaires.spec.ts` sur une réponse substituée qui ne portait
			// pas encore la colonne — une pierre tombale ordinaire s'y annonçait « retirée par la
			// modération ». Une réponse dégradée ne doit jamais accuser quelqu'un.
			retireParModeration:
				ligne.deleted_at != null &&
				ligne.deleted_by != null &&
				ligne.deleted_by !== ligne.author_id,
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
	/** `P0001` `comment_deleted` : la pierre tombale est définitive (§13.4). */
	| 'supprime'
	/** `P0001` `comment_moderation_limitee` : un tiers ne peut que supprimer (§13.6). */
	| 'moderation'
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

/**
 * Résultat commun aux deux gestes de l'auteur. Un `PATCH` filtré par le `USING` de la politique
 * rend `200` **et zéro ligne** : ce n'est ni un succès, ni une erreur HTTP, et le confondre avec
 * l'un ou l'autre ferait croire à un effet qui n'a pas eu lieu (docs/SPEC-cards.md §13.8, ligne *j*).
 */
export type ResultatGeste =
	| { readonly statut: 'applique' }
	| { readonly statut: 'sans-effet' }
	| { readonly statut: 'refus'; readonly refus: RefusPublication }

/**
 * Symbole levé par le trigger lorsqu'un tiers tente autre chose qu'une suppression.
 *
 * CE N'EST PAS UNE LECTURE DE PHRASE HUMAINE, malgré les apparences. `raise exception
 * 'comment_moderation_limitee'` place ce **nom** dans le champ `message` de PostgREST, où il est un
 * identifiant de contrat au même titre que `23514` ou `P0001` ; la phrase explicative, elle, vit
 * dans `details` et n'est lue par personne. Or c'est précisément `error.message` que les appelants
 * de ce module transmettent depuis toujours sous le nom de `detail` — le paramètre porte le symbole,
 * pas la prose. MESURÉ (décision 376) :
 *
 * ```
 * {"code":"P0001","message":"comment_moderation_limitee",
 *  "details":"Un tiers ne peut que supprimer un commentaire, jamais le modifier."}
 * ```
 */
export const SYMBOLE_MODERATION_LIMITEE = 'comment_moderation_limitee'

/**
 * Classe le refus d'un geste sur un commentaire existant.
 *
 * `P0001` est ajouté aux natures : le trigger de la pierre tombale refuse toute écriture sur une
 * ligne déjà supprimée — `comment_deleted` (docs/SPEC-cards.md §13.4, lignes *l* et *m*). Le
 * confondre avec « une erreur est survenue » laisserait l'utilisateur réessayer indéfiniment un
 * geste que rien ne rendra possible.
 *
 * DEUX `P0001` DISENT DEUX CHOSES OPPOSÉES, ET LE CODE SEUL NE LES DISTINGUE PAS (décision 376).
 * Depuis la migration `0035`, le même trigger lève aussi `comment_moderation_limitee` — « un tiers
 * ne peut que supprimer ». Classer les deux sous « ce commentaire a été supprimé » rendrait à un
 * administrateur un message faux : son commentaire est bien vivant, c'est son geste qui est borné.
 * C'est la valeur par défaut trompeuse que `CLAUDE.md` §18 proscrit.
 */
export function classerRefusGeste(
	statutHttp: number | undefined,
	code: string | undefined,
	detail: string,
): RefusPublication {
	if (code === 'P0001') {
		return detail === SYMBOLE_MODERATION_LIMITEE
			? { nature: 'moderation', detail }
			: { nature: 'supprime', detail }
	}
	return classerRefusPublication(statutHttp, code, detail)
}

/**
 * Corrige le corps d'un commentaire — docs/SPEC-cards.md §13.5, ligne *i* du §13.8.
 *
 * `edited_at` **n'est pas envoyé** : la colonne est fermée à `authenticated`, et le trigger la pose
 * lui-même si et seulement si le corps change. L'envoyer rendrait `403`.
 */
export async function modifierCommentaire(
	client: ClientCrm,
	idCommentaire: string,
	corps: string,
): Promise<ResultatGeste> {
	return await appliquerGeste(client, idCommentaire, { body: corps })
}

/**
 * Pose la pierre tombale — docs/SPEC-cards.md §13.4, ligne *k* du §13.8.
 *
 * Les DEUX colonnes sont envoyées, et c'est le `CHECK` qui l'impose : une ligne supprimée doit
 * porter un corps vide, et une ligne vivante un corps non vide. Envoyer `deleted_at` seul
 * violerait la contrainte au lieu de supprimer.
 *
 * La date transmise n'a **aucune importance** : le trigger la remplace par `now()`. Elle est
 * envoyée parce que la colonne est typée non nulle côté client, et la preuve d'API mesure
 * précisément qu'elle est ignorée.
 */
export async function supprimerCommentaire(
	client: ClientCrm,
	idCommentaire: string,
): Promise<ResultatGeste> {
	return await appliquerGeste(client, idCommentaire, {
		body: '',
		deleted_at: new Date().toISOString(),
	})
}

async function appliquerGeste(
	client: ClientCrm,
	idCommentaire: string,
	valeurs: Partial<Database['public']['Tables']['card_comments']['Update']>,
): Promise<ResultatGeste> {
	try {
		// `select('id')` n'est pas décoratif : sans lui, PostgREST ne rend aucun corps et le
		// filtrage silencieux du `USING` — ligne *j* — serait indiscernable d'une modification.
		const reponse = await client
			.from('card_comments')
			.update(valeurs)
			.eq('id', idCommentaire)
			.select('id')
		if (reponse.error !== null) {
			return {
				statut: 'refus',
				refus: classerRefusGeste(reponse.status, reponse.error.code, reponse.error.message),
			}
		}
		return (reponse.data ?? []).length === 0 ? { statut: 'sans-effet' } : { statut: 'applique' }
	} catch (cause) {
		return {
			statut: 'refus',
			refus: classerRefusGeste(
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
	readonly reprendre: () => void
} {
	const [etat, setEtat] = useState<EtatAsync<readonly CommentaireAffiche[]>>(enChargement)
	const [tentative, setTentative] = useState(0)
	// Une réponse arrivée après le démontage ne doit pas écrire dans un composant démonté, ni une
	// réponse périmée écraser une réponse plus récente — l'identifiant change d'une card à l'autre.
	const courant = useRef(0)
	// La relecture silencieuse traverse ce relais, et non la liste de dépendances de l'effet
	// (décision 315). L'effet POSSÈDE l'abonnement ; le relais ne fait que rejouer la lecture.
	const relecture = useRef<() => void>(() => {})

	useEffect(() => {
		if (client === null || idCard === undefined) return
		++courant.current
		setEtat(enChargement)

		const charger = () => {
			// LE RANG EST PRIS PAR LECTURE, ET NON PAR ABONNEMENT (décision 315). Deux lectures
			// peuvent être en vol en même temps — un événement du temps réel et le geste qui l'a
			// provoqué se croisent —, et rien ne garantit qu'elles reviennent dans l'ordre. Sans ce
			// rang, la plus ancienne écrase la plus récente : la preuve d'interface l'a montré en
			// faisant réapparaître un commentaire supprimé une seconde plus tôt.
			const rang = ++courant.current
			// LE FIL N'EST JAMAIS VIDÉ POUR ÊTRE RELU. Repasser par `enChargement` ferait
			// disparaître toute la conversation le temps d'un aller-retour, et cette disparition
			// a été VUE sur une capture (décision 315). L'état de chargement reste dû tant
			// qu'aucune donnée n'est affichable — première lecture, changement de card, reprise
			// après erreur —, et lui seul.
			setEtat((precedent) => (precedent.statut === 'pret' ? precedent : enChargement()))
			void (async () => {
				const resultat = await lireCommentaires(client, idCard)
				if (rang !== courant.current) return
				setEtat(resultat)
			})()
		}
		relecture.current = charger

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

	/**
	 * Relit le fil **sans défaire l'abonnement ni vider l'écran**.
	 *
	 * C'est le geste ordinaire : après une publication, une correction ou une suppression, et à
	 * chaque événement du temps réel. Il ne touche pas au canal — le recréer à chaque écriture
	 * ferait payer une reconnexion pour une relecture, et laisserait une fenêtre sans abonnement
	 * à l'instant précis où le fil change.
	 */
	const recharger = useCallback(() => {
		relecture.current()
	}, [])

	/**
	 * Reprise explicite, offerte à l'utilisateur quand le fil est en erreur.
	 *
	 * Elle refait TOUT : l'abonnement comme la lecture. Une erreur peut venir du canal autant que
	 * de la requête — `CHANNEL_ERROR` charge le fil mais laisse le panneau sans mise à jour
	 * automatique —, et une reprise qui ne rejouerait que la lecture laisserait ce défaut en place
	 * sans que rien ne le dise.
	 */
	const reprendre = useCallback(() => {
		setTentative((precedente) => precedente + 1)
	}, [])

	return { etat, recharger, reprendre }
}
