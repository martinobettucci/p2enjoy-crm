// @spec CRM-043 (docs/BACKLOG.md) — le rôle de workspace courant, sans lequel la modération d'un
//       commentaire n'a aucun chemin dans le produit (INC-072)
// @spec CRM-022 (docs/BACKLOG.md) — `workspace_members` est lisible par les membres du workspace
// @spec docs/SPEC-cards.md §13.10 (le geste de modération et à qui il est offert), §13.6 (la règle,
//       tenue par `card_comments_moderation`)
// @spec docs/SPEC-permissions-rls.md §2.1 (les trois rôles), §7 (un refus est zéro ligne)
// @spec docs/SPEC-webapp.md §6.4 (contrat asynchrone) ; docs/SCHEMA.md §1 (socle d'identité)
// @spec docs/JOURNAL.md décision 376 (ce que l'écran apprend, et ce qu'il ne décide pas)
//
// CE MODULE NE DÉCIDE AUCUN DROIT, ET C'EST SA PREMIÈRE PROPRIÉTÉ (`CLAUDE.md` §10).
//
// Le rôle qu'il lit ne sert qu'à **ne pas offrir un geste voué au néant**. La règle de modération
// est tenue par la politique `card_comments_moderation`, qui juge sur `app.is_workspace_admin` et
// `app.can_read_card` ; un client qui mentirait sur son rôle n'obtiendrait rien de plus. Le cas où
// cette lecture se trompe — rôle retombé depuis le chargement de l'écran — est celui, déjà traité,
// du `PATCH` rendant `200` et **zéro ligne** (docs/SPEC-cards.md §13.8, ligne *j*).
//
// LE RÔLE EST LU PAR WORKSPACE, JAMAIS « EN GÉNÉRAL ». `workspace_members` porte une ligne par
// couple `(workspace_id, user_id)` : la même personne peut être administratrice ici et lectrice
// ailleurs. La card porte son `workspace_id`, et c'est lui qui sert de clé.
//
// MESURÉ avant d'être écrit (décision 376) : un membre lit les trois lignes de son workspace, un
// appelant anonyme reçoit **`200` et `[]`** — jamais un `401`. La lecture est donc silencieuse dans
// la console même hors session, ce que `CRM-007` exige de toute requête de la webapp. Elle n'est
// pour autant **pas émise** sans identifiant d'utilisateur : une requête dont la réponse est connue
// d'avance est un coût sans contrepartie.

import { useEffect, useState } from 'react'
import { classerErreur, enChargement, enErreur, pret, type EtatAsync } from './async'
import type { ClientCrm } from './supabase'

/**
 * Les trois rôles du §2.1 de `docs/SPEC-permissions-rls.md`.
 *
 * `database.types.ts` déclare `workspace_members.role` comme une **chaîne** — le générateur ne voit
 * pas la contrainte `CHECK` (`docs/SPEC-types.md`). La valeur lue est donc confrontée à cette liste
 * plutôt que castée : un rôle inconnu devient `null`, et l'écran n'offre rien. Prétendre le
 * contraire ferait dépendre une offre de geste d'une valeur que rien n'a vérifiée.
 */
export const ROLES = ['admin', 'business_developer', 'viewer'] as const

export type RoleWorkspace = (typeof ROLES)[number]

/** Rend le rôle si la valeur lue en est un, `null` sinon — jamais une valeur par défaut. */
export function roleConnu(valeur: string | null | undefined): RoleWorkspace | null {
	return ROLES.includes(valeur as RoleWorkspace) ? (valeur as RoleWorkspace) : null
}

/**
 * Lit le rôle de l'utilisateur dans un workspace.
 *
 * `null` en état `pret` est une réponse pleine : l'utilisateur n'est pas membre, ou la RLS a refusé
 * — le §7 de `docs/SPEC-permissions-rls.md` rend les deux cas indiscernables, délibérément. Aucun
 * des deux ne justifie d'offrir un geste, et les distinguer ici renseignerait un appelant sans
 * droit.
 */
export async function lireRoleWorkspace(
	client: ClientCrm,
	idWorkspace: string,
	idUtilisateur: string,
): Promise<EtatAsync<RoleWorkspace | null>> {
	try {
		const reponse = await client
			.from('workspace_members')
			.select('role')
			.eq('workspace_id', idWorkspace)
			.eq('user_id', idUtilisateur)
			.maybeSingle()
		if (reponse.error !== null) {
			return enErreur(classerErreur(reponse.status, reponse.error.message))
		}
		return pret(roleConnu(reponse.data?.role))
	} catch (cause) {
		// `supabase-js` peut relancer une panne de transport plutôt que la rendre.
		return enErreur(classerErreur(undefined, cause instanceof Error ? cause.message : String(cause)))
	}
}

/**
 * Le rôle courant, tenu par l'écran hôte.
 *
 * IL N'EXPOSE AUCUNE REPRISE, et c'est délibéré. Un rôle illisible ne rend pas l'écran
 * indisponible : il retire une offre de geste, et rien d'autre. Offrir un bouton « réessayer » pour
 * cela ferait porter à l'utilisateur une panne dont il ne peut rien faire, sur un écran dont le
 * contenu principal est chargé. L'échec se voit — l'action n'apparaît pas — et le rechargement de
 * la fiche le rejoue.
 */
export function useRoleWorkspace(
	client: ClientCrm | null,
	idWorkspace: string | null,
	idUtilisateur: string | null,
): { readonly etat: EtatAsync<RoleWorkspace | null> } {
	const [etat, setEtat] = useState<EtatAsync<RoleWorkspace | null>>(enChargement)

	useEffect(() => {
		// Hors session, ou avant que le workspace ne soit connu, rien n'est demandé : la réponse
		// est connue d'avance, et l'état « pas de rôle » est la vérité de ce moment.
		if (client === null || idWorkspace === null || idUtilisateur === null) {
			setEtat(pret(null))
			return
		}
		let vivant = true
		setEtat(enChargement)
		void lireRoleWorkspace(client, idWorkspace, idUtilisateur).then((resultat) => {
			if (vivant) setEtat(resultat)
		})
		return () => {
			vivant = false
		}
	}, [client, idWorkspace, idUtilisateur])

	return { etat }
}

/**
 * L'unique question que l'interface pose à ce module.
 *
 * Un état de chargement ou d'erreur rend `false` : tant que le rôle n'est pas connu, aucun geste de
 * modération n'est offert. C'est le sens correct du doute — offrir puis retirer ferait clignoter
 * une action, et offrir sans savoir produirait la commande morte que le §5.10 du design system
 * refuse.
 */
export function estAdministrateur(etat: EtatAsync<RoleWorkspace | null>): boolean {
	return etat.statut === 'pret' && etat.donnees === 'admin'
}
