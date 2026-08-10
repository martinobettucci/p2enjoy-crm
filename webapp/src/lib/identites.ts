// @spec CRM-022 (docs/BACKLOG.md) — lecture du profil courant et présentation sûre des identités
// @spec docs/SPEC-identite.md §3.1, §4 et §7
// @spec docs/SCHEMA.md §1 (`profiles`) ; docs/SPEC-webapp.md §6.4 (contrat asynchrone)
//
// Ce module est l'unique lecture autonome de profil de la webapp. Les responsables, auteurs et
// acteurs sont embarqués dans leurs lignes métier par PostgREST ; seul le profil de session se lit
// ici, une fois après restauration de l'utilisateur.

import { classerErreur, enErreur, pret, type EtatAsync } from './async'
import type { Database } from './database.types'
import type { ClientCrm } from './supabase'

export type ProfilAffiche = Pick<
	Database['public']['Tables']['profiles']['Row'],
	'id' | 'full_name' | 'avatar_url'
>

export const COLONNES_PROFIL_AFFICHE = 'id, full_name, avatar_url'

/** Lit exclusivement le profil désigné par la session ; une ligne absente reste un état explicite. */
export async function lireProfilCourant(
	client: ClientCrm,
	idUtilisateur: string,
): Promise<EtatAsync<ProfilAffiche | null>> {
	try {
		const reponse = await client
			.from('profiles')
			.select(COLONNES_PROFIL_AFFICHE)
			.eq('id', idUtilisateur)
			.maybeSingle()
		if (reponse.error !== null) {
			return enErreur(classerErreur(reponse.status, reponse.error.message))
		}
		return pret(reponse.data)
	} catch (cause) {
		return enErreur(
			classerErreur(undefined, cause instanceof Error ? cause.message : String(cause)),
		)
	}
}

/**
 * URL qu'un `<img>` de l'application peut charger.
 *
 * La contrainte PostgreSQL porte déjà la même frontière. La répéter ici ne crée aucun droit :
 * elle empêche seulement qu'une réponse dégradée ou substituée atteigne l'attribut `src`.
 */
export function urlAvatarSure(valeur: string | null | undefined): string | null {
	if (valeur === null || valeur === undefined || valeur.length > 2048) return null
	if (valeur.startsWith('/') && !valeur.startsWith('//')) return valeur
	if (!valeur.startsWith('https://')) return null
	try {
		const url = new URL(valeur)
		return url.protocol === 'https:' ? url.href : null
	} catch {
		return null
	}
}

/** Deux initiales au plus, sans supposer que chaque caractère Unicode occupe une unité UTF-16. */
export function initialesDe(nom: string): string {
	const parties = nom.trim().split(/\s+/u).filter(Boolean)
	if (parties.length === 0) return '?'
	const selection = parties.length === 1 ? [parties[0]] : [parties[0], parties.at(-1)]
	return selection
		.map((partie) => Array.from(partie ?? '')[0] ?? '')
		.join('')
		.toLocaleUpperCase('fr-FR')
}
