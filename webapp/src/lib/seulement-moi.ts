// @spec CRM-139 (docs/BACKLOG.md) — « Seulement moi » dans l'inbox : la clé d'adresse de la case, la présence d'une
//       identité personnelle, et la décision « le filtre s'applique ou non »
// @spec docs/SPEC-mail-subsystem.md §27.4 (l'écran) ; docs/DESIGN_SYSTEM.md §5.96 ; docs/JOURNAL.md décisions 879 et 902
// @spec CLAUDE.md §11 (rien n'est stocké sur l'appareil : l'état vit dans l'adresse)
//
// LE FILTRE LUI-MÊME EST CALCULÉ PAR LA BASE (`concerns_me`, `inbox_arborescence(p_only_me)`) : ce module ne décide que
// de le DEMANDER. Ce n'est pas une règle d'accès (§27.1).

import type { ClientCrm } from './supabase'

/** Cochée, la case montre le courrier qui concerne la personne ; décochée, tout ce qu'elle lit. */
export type ModeCourrier = 'moi' | 'tous'

/** La clé de l'adresse, voisine de `sommeil` (docs/DESIGN_SYSTEM.md §5.3 septies). */
export const CLE_URL_COURRIER = 'courrier'

/** La seule valeur écrite : le défaut, la case cochée, ne s'écrit jamais (§12.2). */
export const VALEUR_URL_COURRIER_TOUS = 'tous'

/** Lit le mode d'une valeur d'adresse ; toute valeur inconnue est ramenée au défaut, la case cochée. */
export function lireModeCourrier(valeur: string | null | undefined): ModeCourrier {
	return valeur === VALEUR_URL_COURRIER_TOUS ? 'tous' : 'moi'
}

/**
 * Écrit le mode dans une copie des paramètres d'adresse, les autres conservés.
 * Le défaut retire la clé : la vue par défaut reste l'adresse la plus courte.
 */
export function ecrireModeCourrier(parametres: URLSearchParams, mode: ModeCourrier): URLSearchParams {
	const suivants = new URLSearchParams(parametres)
	if (mode === 'tous') suivants.set(CLE_URL_COURRIER, VALEUR_URL_COURRIER_TOUS)
	else suivants.delete(CLE_URL_COURRIER)
	return suivants
}

/** Ce que l'écran sait des identités personnelles de la personne. */
export type PresenceIdentite = 'chargement' | 'presente' | 'aucune' | 'erreur'

/**
 * Le filtre s'applique-t-il ? `null` tant que la présence d'une identité n'est pas lue : la liste et l'arborescence
 * attendent, pour ne pas montrer un instant tout le courrier puis le retirer (§27.4).
 *
 * Sans identité, ou si sa lecture échoue, le filtre ne s'applique pas : rien ne concernerait la personne, et un échec
 * ne cache rien.
 */
export function filtreApplique(mode: ModeCourrier, presence: PresenceIdentite): boolean | null {
	if (presence === 'chargement') return null
	if (presence === 'presente') return mode === 'moi'
	return false
}

/**
 * Lit si la personne a au moins une identité sortante PERSONNELLE.
 *
 * Le filtre `owner_id` est explicite : un administrateur lit aussi les identités des autres et celle du service
 * (`mail_outbound_identities_lecture_admin`), qui ne sont pas les siennes.
 */
export async function lirePresenceIdentite(
	client: ClientCrm | null,
	idUtilisateur: string | null,
): Promise<Exclude<PresenceIdentite, 'chargement'>> {
	if (client === null || idUtilisateur === null) return 'erreur'
	try {
		const reponse = await client
			.from('mail_outbound_identities')
			.select('id')
			.eq('owner_id', idUtilisateur)
			.limit(1)
		if (reponse.error !== null) return 'erreur'
		return reponse.data.length > 0 ? 'presente' : 'aucune'
	} catch {
		return 'erreur'
	}
}
