// @spec CRM-064 (docs/BACKLOG.md) — tranche 4 : les préférences
// @spec docs/SPEC-notifications.md §42 (ce que la tranche est), §42.1 (il n'y a qu'un canal),
//       §43.2 (les colonnes), §43.4 (l'absence de ligne vaut consentement), §44 (le filtrage est
//       à la lecture), §46.3 (la RPC, unique chemin d'écriture, et ses deux refus nommés),
//       §47 (le contrat d'API)
// @spec docs/DESIGN_SYSTEM.md §5.45 (l'écran des préférences), §5.7 ter (l'écriture immédiate),
//       §5.8 (états systématiques)
// @spec docs/SPEC-webapp.md §6.4 (contrat asynchrone)
//
// Ce module ne rend rien : il **lit et écrit**. La séparation est ce qui rend le défaut du §43.4,
// la classification des deux refus nommés et l'état retenu après écriture vérifiables **sans
// navigateur**.
//
// L'ÉCRAN NE DÉCIDE RIEN DE CE QUI EST REÇU (`CLAUDE.md` §10). La préférence agit **en base**, dans
// la troisième condition de `notifications_lecture` (§45.2) : ce module ne filtre aucune
// notification, il ne fait que lire et écrire la décision. Filtrer ici serait la seconde écriture
// de la règle, en TypeScript, que le §34.1 a déjà refusée pour le sélecteur de mentions.
//
// LE DÉFAUT EST « JE REÇOIS », ET IL VIENT DE LA BASE, PAS D'ICI (§43.4). Une préférence absente
// n'est **pas** un état à corriger : c'est l'état normal d'un compte qui n'a rien décidé, et le
// `coalesce` de `app.notification_consentie` le porte. Ce module se contente de rendre `true` pour
// une ligne absente — la même valeur, lue au même endroit qu'elle, jamais une seconde définition.

import { classerErreur, enErreur, pret, type EtatAsync } from './async'
import type { ClientCrm } from './supabase'

/**
 * Les types de notification que l'écran propose de régler.
 *
 * **LA LISTE EST FIXE, ELLE NE VIENT PAS DU SERVEUR** (§5.45 du design system), et c'est pourquoi
 * l'écran n'a **aucun état vide**. Elle est le miroir exact du `check` fermé de la migration `0067`
 * — `check (type in ('mention'))` —, qui est lui-même le miroir de celui de `notifications`
 * (§13.3). Trois endroits, une seule valeur : ajouter une source de notification demain touchera
 * les trois dans le même changement, et un oubli ici rendrait une case que la base refuse, ou
 * cacherait un type qu'elle produit.
 */
export const TYPES_PREFERENCE = ['mention'] as const

export type TypePreference = (typeof TYPES_PREFERENCE)[number]

/** Ce que l'écran sait d'un type : le recevoir, ou non. */
export type PreferenceNotification = {
	readonly type: TypePreference
	readonly recevoirDansApplication: boolean
}

/**
 * La ligne telle que la table et la RPC la rendent.
 *
 * `updated_at` n'est pas repris : aucun écran ne le montre, et le §43.2 dit que la date qui compte
 * est celle de la dernière décision — une information d'exploitation, pas de produit. La lire
 * pour ne pas l'employer inviterait à l'afficher un jour sans que rien ne le décide.
 */
type LignePreferenceLue = {
	readonly type: string
	readonly in_app: boolean
}

/** Vrai si la chaîne est l'un des types que l'écran connaît. */
export function estTypePreference(candidat: string): candidat is TypePreference {
	return (TYPES_PREFERENCE as readonly string[]).includes(candidat)
}

/**
 * Applique les lignes lues aux types connus, l'absence valant « je reçois ».
 *
 * ELLE EST EXPORTÉE POUR ÊTRE ÉPROUVÉE SEULE : c'est la moitié du §43.4 qui vit dans l'écran, et
 * la mettre à l'épreuve sans pile ni navigateur est ce qui la rend sûre.
 *
 * **UN TYPE INCONNU RENDU PAR LE SERVEUR EST IGNORÉ**, jamais rendu. Il ne peut venir que d'une
 * base en avance sur cette version de l'application ; lui fabriquer une case sans libellé
 * afficherait un réglage que personne ne sait nommer.
 */
export function appliquerPreferences(
	lignes: readonly LignePreferenceLue[],
): readonly PreferenceNotification[] {
	return TYPES_PREFERENCE.map((type) => {
		const ligne = lignes.find((candidate) => candidate.type === type)
		return {
			type,
			// L'ABSENCE DE LIGNE VAUT CONSENTEMENT (§43.4). `?? true` est le pendant exact du
			// `coalesce(…, true)` de `app.notification_consentie` : la même règle, écrite des deux
			// côtés parce que les deux côtés doivent en rendre compte — la base pour opposer la
			// règle, l'écran pour cocher la case. Elles ne peuvent pas diverger sans qu'une preuve
			// les prenne, la suite pgTAP tenant l'une et la suite unitaire l'autre.
			recevoirDansApplication: ligne?.in_app ?? true,
		}
	})
}

/**
 * Lit les préférences de l'appelant.
 *
 * **ELLE NE FILTRE PAS PAR `profile_id`**, et ce n'est pas un oubli : la politique
 * `notification_preferences_lecture` exige déjà `profile_id = auth.uid()`, si bien que la seule
 * ligne rendue est celle de l'appelant. Ajouter le filtre ici serait une seconde écriture de la
 * règle, et surtout une écriture **plus faible** — un filtre client ne refuse rien.
 *
 * **SANS SESSION, LA LECTURE REND ZÉRO LIGNE, JAMAIS UNE ERREUR** (§46.1, ligne *j* du contrat) :
 * `anon` a le privilège `select`, et le prédicat est faux. L'écran rend alors les cases cochées,
 * c'est-à-dire le défaut — ce qui est exact, et n'a de toute façon aucune conséquence : un
 * anonyme ne reçoit aucune notification.
 */
export async function lirePreferencesNotifications(
	client: ClientCrm,
): Promise<EtatAsync<readonly PreferenceNotification[]>> {
	try {
		const reponse = await client.from('notification_preferences').select('type, in_app')
		if (reponse.error !== null) {
			return enErreur(classerErreur(reponse.status, reponse.error.message))
		}
		return pret(appliquerPreferences(reponse.data ?? []))
	} catch (cause) {
		return enErreur(classerErreur(undefined, cause instanceof Error ? cause.message : String(cause)))
	}
}

/**
 * Les symboles levés par la RPC de la migration `0067`.
 *
 * CE NE SONT PAS DES PHRASES HUMAINES, malgré les apparences : `raise exception '<symbole>'` place
 * ce **nom** dans le champ `message` de PostgREST, où il est un identifiant de contrat au même
 * titre que `23514`. C'est le mécanisme de `SYMBOLE_DESTINATAIRE_SANS_ACCES` (`mentions.ts`).
 * MESURÉ, lignes *o* et *p* du §47 :
 *
 * ```
 * {"code":"P0001","message":"preference_type_inconnu",
 *  "hint":"Le seul type de notification produit est « mention » (§13.3)."}
 * ```
 */
export const SYMBOLE_TYPE_INCONNU = 'preference_type_inconnu'
export const SYMBOLE_SANS_SESSION = 'preference_sans_session'
export const SYMBOLE_VALEUR_ABSENTE = 'preference_valeur_absente'

/**
 * Les refus qu'une écriture de préférence peut recevoir.
 *
 * `type-inconnu` ET `sans-session` NE DEMANDENT PAS LE MÊME GESTE, et les confondre rendrait un
 * message faux : le premier signale une application en avance sur sa base — il faut la mettre à
 * jour —, le second une session expirée — il faut se reconnecter.
 */
export type NatureRefusPreference =
	/** `P0001` `preference_type_inconnu` : la base ne connaît pas ce type (§46.3). */
	| 'type-inconnu'
	/** `P0001` `preference_sans_session` : `auth.uid()` est nul — anonyme, ou clé de service. */
	| 'sans-session'
	/** `P0001` `preference_valeur_absente` : la RPC a reçu `null` au lieu d'un booléen. */
	| 'valeur-absente'
	/** `401` ou `403` : le privilège d'exécution manque — c'est le refus de l'anonyme (ligne *k*). */
	| 'forbidden'
	| 'network'
	| 'unknown'

/**
 * Classe le refus d'une écriture de préférence.
 *
 * UN CODE INCONNU RESTE INCONNU. L'écran n'invente aucun message pour un symbole qu'il ne connaît
 * pas : il rend le refus générique du §5.8. Ramener tout `P0001` à la cause la plus fréquente
 * serait la valeur par défaut trompeuse que `CLAUDE.md` §18 proscrit.
 */
export function classerRefusPreference(
	statutHttp: number | undefined,
	code: string | undefined,
	detail: string,
): { readonly nature: NatureRefusPreference; readonly detail: string } {
	if (code === 'P0001') {
		if (detail === SYMBOLE_TYPE_INCONNU) return { nature: 'type-inconnu', detail }
		if (detail === SYMBOLE_SANS_SESSION) return { nature: 'sans-session', detail }
		if (detail === SYMBOLE_VALEUR_ABSENTE) return { nature: 'valeur-absente', detail }
		return { nature: 'unknown', detail }
	}
	if (statutHttp === 401 || statutHttp === 403) return { nature: 'forbidden', detail }
	if (statutHttp === undefined || statutHttp === 0) return { nature: 'network', detail }
	return { nature: 'unknown', detail }
}

/** L'issue d'une écriture, portant l'état que la BASE a retenu et non celui qui a été demandé. */
export type IssuePreference =
	| { readonly statut: 'ecrite'; readonly preference: PreferenceNotification }
	| {
			readonly statut: 'refus'
			readonly type: TypePreference
			readonly nature: NatureRefusPreference
			readonly detail: string
	  }

/**
 * Écrit une préférence, par l'**unique** chemin que la base ouvre.
 *
 * **LE DESTINATAIRE N'EST PAS UN PARAMÈTRE, ET C'EST DÉLIBÉRÉ CÔTÉ BASE** (§46.3) : la RPC lit
 * `auth.uid()` elle-même, si bien qu'écrire pour autrui est *impossible* plutôt que *refusé*. Ce
 * module n'a donc rien à vérifier avant d'appeler — il n'y a pas de champ à ne pas remplir.
 *
 * **L'ÉCRITURE DIRECTE NE MARCHERAIT PAS**, et la mesure l'a établie avant que ce module n'existe
 * (§46.3, M10) : l'`upsert` PostgREST rend `403 / 42501` sur une table dont les colonnes sont
 * figées par un privilège de colonne, et un second `POST` rend `409 / 23505`. La RPC est la seule
 * forme qui tienne en un aller-retour.
 *
 * **ELLE REND L'ÉTAT RETENU PAR LA BASE**, jamais celui qui a été demandé : c'est ce qui permet au
 * §5.45 du design system d'exiger que la case ne se coche qu'après la réponse. Les deux valeurs
 * coïncident aujourd'hui, et c'est précisément pour cela qu'il faut lire la réponse — le jour où
 * elles divergeront, un écran qui aurait supposé l'égalité afficherait un état qui n'existe pas.
 */
export async function ecrirePreferenceNotification(
	client: ClientCrm,
	type: TypePreference,
	recevoirDansApplication: boolean,
): Promise<IssuePreference> {
	try {
		const reponse = await client.rpc('definir_preference_notification', {
			p_type: type,
			p_in_app: recevoirDansApplication,
		})
		if (reponse.error !== null) {
			const refus = classerRefusPreference(reponse.status, reponse.error.code, reponse.error.message)
			return { statut: 'refus', type, nature: refus.nature, detail: refus.detail }
		}
		const ligne = reponse.data as LignePreferenceLue | null
		// Une réponse sans ligne ne peut pas arriver — la RPC rend `returning *` ou lève —, mais
		// `noUncheckedIndexedAccess` a raison d'exiger qu'on le dise : supposer la ligne présente
		// afficherait, en cas de surprise, une case dont l'état viendrait de nulle part.
		if (ligne === null || typeof ligne.in_app !== 'boolean') {
			return { statut: 'refus', type, nature: 'unknown', detail: 'reponse_sans_ligne' }
		}
		return {
			statut: 'ecrite',
			preference: { type, recevoirDansApplication: ligne.in_app },
		}
	} catch (cause) {
		const refus = classerRefusPreference(
			undefined,
			undefined,
			cause instanceof Error ? cause.message : String(cause),
		)
		return { statut: 'refus', type, nature: refus.nature, detail: refus.detail }
	}
}
