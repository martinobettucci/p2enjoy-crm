// @spec CRM-064 (docs/BACKLOG.md) — sous-tranche 3b : l'émission
// @spec docs/SPEC-notifications.md §34 (d'où vient la liste du sélecteur), §34.2 (la RPC et son
//       refus à zéro ligne), §34.3 (l'appelant n'est pas dans sa propre liste), §35.1 (la mesure
//       qui décide : le POST groupé est tout ou rien), §35.2 (un POST par mention, séquentiel),
//       §35.3 (le commentaire publié n'est jamais retiré), §35.4 (les trois issues)
// @spec docs/SPEC-notifications.md §5.1 (la règle d'éligibilité), §6 (les trois refus du trigger),
//       §7.1 (la politique d'insertion juge l'AUTEUR)
// @spec docs/DESIGN_SYSTEM.md §5.44 (le sélecteur de mentions), §5.8 (états systématiques)
// @spec docs/SPEC-webapp.md §6.4 (contrat asynchrone)
//
// Ce module ne rend rien : il **lit et écrit**. La séparation est ce qui rend la chaîne émise, la
// classification des refus, l'ordre des envois et le découpage des trois issues vérifiables **sans
// navigateur**.
//
// L'ÉCRAN NE CALCULE AUCUN DROIT (`CLAUDE.md` §10, §5.22 du design system). La liste des personnes
// mentionnables vient de `public.mentionnables`, qui appelle `app.can_read_card_pour` — la seule
// écriture de la règle d'éligibilité. Ce module ne relit ni `track_members`, ni `channel_members`,
// ni `workspace_members` : recopier ici le prédicat serait la seconde écriture que la migration
// `0063` a précisément refusée en base.
//
// LE REFUS DE LECTURE EST ZÉRO LIGNE, JAMAIS UNE ERREUR (§34.2, mesuré M8). Une affaire fermée à
// l'appelant — ou inexistante — rend `200 []`. La liste vide est donc un état **normal** du §5.8,
// pas un échec à mettre en scène.

import { classerErreur, enErreur, pret, type EtatAsync } from './async'
import type { ClientCrm } from './supabase'

/**
 * Une personne que le commentaire en cours de rédaction peut mentionner.
 *
 * `avatar_url` est **rendue telle que la base la porte** : c'est `urlAvatarSure` (`identites.ts`)
 * qui décide, à l'affichage, si un `<img>` peut la charger. La borner ici ferait deux frontières
 * pour la même règle.
 */
export type PersonneMentionnable = {
	readonly id: string
	readonly nom: string
	readonly avatar: string | null
}

/**
 * Lit les personnes mentionnables d'une affaire.
 *
 * ELLE N'EST APPELÉE QU'À L'OUVERTURE DU SÉLECTEUR, jamais au chargement de la fiche (§36.3) :
 * c'est la règle de `lireMembresAffectables` (`CRM-060`), et pour le même motif mesuré — la plupart
 * des visites d'une affaire ne mentionnent personne.
 *
 * L'ORDRE VIENT DU SERVEUR, et il n'est pas retrié ici. `public.mentionnables` ordonne par nom sous
 * la collation française ; un second tri côté client serait une seconde définition de l'ordre, qui
 * divergerait le jour où l'une des deux changerait.
 */
export async function lireMentionnables(
	client: ClientCrm,
	idCard: string,
): Promise<EtatAsync<readonly PersonneMentionnable[]>> {
	try {
		const reponse = await client.rpc('mentionnables', { card_id: idCard })
		if (reponse.error !== null) {
			return enErreur(classerErreur(reponse.status, reponse.error.message))
		}
		return pret(
			(reponse.data ?? []).map((ligne) => ({
				id: ligne.profile_id,
				nom: ligne.full_name,
				avatar: ligne.avatar_url,
			})),
		)
	} catch (cause) {
		return enErreur(classerErreur(undefined, cause instanceof Error ? cause.message : String(cause)))
	}
}

/**
 * Les refus qu'une pose de mention peut recevoir, tels que l'écran doit les présenter.
 *
 * LES DEUX PREMIERS NE VIENNENT PAS DU MÊME JUGE, et les confondre rendrait un message faux
 * (§32, M3 et M4). Le trigger du §6 juge le **destinataire** et rend `400` / `P0001` ; la politique
 * du §7.1 juge l'**auteur** et rend `403` / `42501`. « Cette personne ne peut pas lire l'affaire »
 * et « vous ne pouvez pas mentionner sur ce commentaire » demandent deux gestes différents.
 */
export type NatureRefusMention =
	/** `P0001` `mention_destinataire_sans_acces` : le destinataire ne lit pas l'affaire (§5.1). */
	| 'destinataire-sans-acces'
	/** `P0001` `comment_deleted` : la pierre tombale ne reçoit plus rien (§6, refus 2). */
	| 'commentaire-supprime'
	/** `P0001` `comment_not_found` : aucun commentaire lisible ne porte cet identifiant (§6). */
	| 'commentaire-introuvable'
	/** `401` ou `403` : la politique d'insertion a refusé — le commentaire n'est pas le nôtre. */
	| 'forbidden'
	| 'network'
	| 'unknown'

/**
 * Les trois symboles levés par le trigger de la migration `0063`.
 *
 * CE NE SONT PAS DES PHRASES HUMAINES, malgré les apparences : `raise exception '<symbole>'` place
 * ce **nom** dans le champ `message` de PostgREST, où il est un identifiant de contrat au même titre
 * que `23514` — la phrase explicative vit dans `details` et n'est lue par personne. C'est le
 * mécanisme que `SYMBOLE_MODERATION_LIMITEE` documente déjà pour `card_comments`. MESURÉ (§32, M3) :
 *
 * ```
 * {"code":"P0001","message":"mention_destinataire_sans_acces",
 *  "details":"Une mention ne désigne que quelqu'un qui peut lire cette affaire."}
 * ```
 */
export const SYMBOLE_DESTINATAIRE_SANS_ACCES = 'mention_destinataire_sans_acces'
export const SYMBOLE_COMMENTAIRE_SUPPRIME = 'comment_deleted'
export const SYMBOLE_COMMENTAIRE_INTROUVABLE = 'comment_not_found'

/**
 * Classe le refus d'une pose de mention.
 *
 * UN CODE INCONNU RESTE INCONNU. L'écran n'invente aucun message pour un symbole qu'il ne connaît
 * pas : il rend le refus générique du §5.8. Ramener tout `P0001` à la cause la plus fréquente serait
 * la valeur par défaut trompeuse que `CLAUDE.md` §18 proscrit.
 */
export function classerRefusMention(
	statutHttp: number | undefined,
	code: string | undefined,
	detail: string,
): { readonly nature: NatureRefusMention; readonly detail: string } {
	if (code === 'P0001') {
		if (detail === SYMBOLE_DESTINATAIRE_SANS_ACCES) return { nature: 'destinataire-sans-acces', detail }
		if (detail === SYMBOLE_COMMENTAIRE_SUPPRIME) return { nature: 'commentaire-supprime', detail }
		if (detail === SYMBOLE_COMMENTAIRE_INTROUVABLE) return { nature: 'commentaire-introuvable', detail }
		return { nature: 'unknown', detail }
	}
	if (statutHttp === 401 || statutHttp === 403) return { nature: 'forbidden', detail }
	if (statutHttp === undefined || statutHttp === 0) return { nature: 'network', detail }
	return { nature: 'unknown', detail }
}

/** L'issue d'UNE mention, attribuée à la personne qu'elle désignait. */
export type IssueMention =
	| { readonly personne: PersonneMentionnable; readonly statut: 'posee' }
	| {
			readonly personne: PersonneMentionnable
			readonly statut: 'refus'
			readonly nature: NatureRefusMention
			readonly detail: string
	  }

/**
 * Pose une mention. `created_at` **n'est pas envoyé** : le trigger l'impose, et une valeur
 * transmise ne survit pas (assertion de `0061`).
 *
 * `workspace_id` EST ENVOYÉ SANS ÊTRE DÉCIDÉ PAR LE CLIENT — même mécanisme que `publierCommentaire`
 * (décision 200) : le trigger le dérive du commentaire quelle que soit la valeur reçue, et la clé
 * étrangère composite rend l'incohérence impossible. Il est transmis parce que le générateur de
 * types, qui ne voit pas les triggers, déclare la colonne obligatoire.
 */
async function poserUneMention(
	client: ClientCrm,
	idCommentaire: string,
	idWorkspace: string,
	personne: PersonneMentionnable,
): Promise<IssueMention> {
	try {
		const reponse = await client.from('card_comment_mentions').insert({
			comment_id: idCommentaire,
			profile_id: personne.id,
			workspace_id: idWorkspace,
		})
		if (reponse.error !== null) {
			const refus = classerRefusMention(reponse.status, reponse.error.code, reponse.error.message)
			return { personne, statut: 'refus', nature: refus.nature, detail: refus.detail }
		}
		return { personne, statut: 'posee' }
	} catch (cause) {
		const refus = classerRefusMention(
			undefined,
			undefined,
			cause instanceof Error ? cause.message : String(cause),
		)
		return { personne, statut: 'refus', nature: refus.nature, detail: refus.detail }
	}
}

/**
 * Pose les mentions d'un commentaire **déjà publié**, une par une.
 *
 * UN `POST` PAR PERSONNE, ET C'EST UNE MESURE QUI LE DÉCIDE (§35.1, M5). Un `POST` groupé est
 * **tout ou rien** : deux mentions dont une seule est inéligible rendent `400` et n'en posent
 * AUCUNE, pas même celle qui était éligible — et le refus ne dit **pas laquelle** est en cause. Une
 * seule entrée périmée ferait donc perdre toutes les mentions du commentaire, en silence sur la
 * cause. Deux `POST` séparés (M6) rendent `201` pour l'une et `400` pour l'autre : le résultat est
 * **partiel** et **attribuable**.
 *
 * Le coût est nommé : `N` requêtes au lieu d'une. Il est payé pour qu'un refus nomme quelqu'un — un
 * refus qui ne nomme personne ne se corrige pas.
 *
 * SÉQUENTIELLES, JAMAIS EN PARALLÈLE (§35.2). Elles écrivent toutes sur la même clé primaire
 * composite, et un ordre stable rend le compte rendu lisible : les issues sortent dans l'ordre où
 * les personnes ont été choisies.
 */
export async function poserMentions(
	client: ClientCrm,
	idCommentaire: string,
	idWorkspace: string,
	personnes: readonly PersonneMentionnable[],
): Promise<readonly IssueMention[]> {
	const issues: IssueMention[] = []
	for (const personne of personnes) {
		issues.push(await poserUneMention(client, idCommentaire, idWorkspace, personne))
	}
	return issues
}

/**
 * Ce que l'écran doit rendre après une publication, mentions comprises (§35.4).
 *
 * TROIS ISSUES, ET AUCUNE N'EST CONFONDUE AVEC UNE AUTRE — la règle des trois issues du geste
 * d'auteur (`commentaires.ts`, `ResultatGeste`), transposée. Le succès partiel n'est ni un succès,
 * ni un échec : le confondre avec l'un ou l'autre ferait croire à un effet qui n'a pas eu lieu.
 *
 * `partiel` PORTE AUSSI LE CAS OÙ TOUTES LES MENTIONS SONT REFUSÉES, et ce n'est pas un abus de
 * nom : ce qui le distingue d'un échec, c'est que **le commentaire, lui, est publié** (§35.3). Le
 * ranger avec les refus laisserait croire que rien n'a eu lieu.
 */
export type ResultatPublication =
	| { readonly statut: 'complet' }
	| { readonly statut: 'partiel'; readonly refusees: readonly IssueMention[] }

/**
 * Range les issues en l'une des deux formes que l'écran sait rendre.
 *
 * Une publication SANS aucune mention est `complet` : il n'y avait rien à poser, et rien n'a
 * échoué. Prétendre le contraire ferait apparaître une alerte sur le geste le plus ordinaire du
 * composeur.
 */
export function resumerPublication(issues: readonly IssueMention[]): ResultatPublication {
	const refusees = issues.filter((issue) => issue.statut === 'refus')
	return refusees.length === 0 ? { statut: 'complet' } : { statut: 'partiel', refusees }
}
