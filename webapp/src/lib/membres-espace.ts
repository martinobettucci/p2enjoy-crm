// @spec CRM-070 (docs/BACKLOG.md) — tranche T2 : les membres d'un espace et leurs rôles, lus et écrits par
//       l'administrateur de l'espace sous la RLS
// @spec docs/SPEC-membres.md §2 (ce que la base permet déjà : `workspace_members`, lecture par tout membre, écriture par
//       `app.is_workspace_admin`), §3.1 (les membres : changer le rôle, retirer, le dernier administrateur), §3.4 (refus
//       traduits) ; docs/SCHEMA.md §1 ; docs/JOURNAL.md décisions 634 et 635
// @spec CRM-070 (docs/BACKLOG.md) — tranche T3 : les attentes, lues sous `workspace_invitations_lecture_admin`,
//       inscrites ou remplacées par `inscrire_attente` (migration 97), retirées sous la politique de suppression ;
//       docs/SPEC-membres.md §3.2 (en attente, en suspens), §5 point 3 ; docs/SCHEMA.md §9 bis.8 quinquies
// @spec CLAUDE.md §10 — ce module ne décide AUCUN droit : il écrit dans la table, et la politique décide
//
// Ce module ne passe PAS par les fonctions `plateforme_*`, gardées par le drapeau de superadministrateur : l'écran d'un
// administrateur d'espace écrit dans `workspace_members` sous les politiques `workspace_members_*_admin`, exactement
// comme l'arborescence écrit dans `tracks`. Un refus est reconnu par ce que la base rend — un code, un message, ou zéro
// ligne —, jamais par une déduction de rôle.

import { classerErreur, enErreur, pret, type EtatAsync } from './async'
import type { RoleEspace } from './plateforme'
import type { ClientCrm } from './supabase'

/** Un membre de l'espace, tel que la RLS le rend à un membre (`workspace_members_lecture_membre`). */
export type MembreEspace = {
	readonly idUtilisateur: string
	/** Le nom du profil ; « Compte supprimé » est l'affaire de l'écran, jamais une donnée inventée ici. */
	readonly nom: string | null
	readonly role: RoleEspace
	readonly depuis: string
}

/**
 * Les issues d'une écriture.
 *
 * - `dernier-administrateur` : l'invariant de la migration 21 (`last_workspace_admin`, 23514) — un espace garde au
 *   moins un administrateur membre.
 * - `sans-effet` : `200` et zéro ligne — la clause `USING` a filtré la ligne avant d'écrire (décision 70), ou elle
 *   n'existait plus. Ni un succès, ni une erreur : l'écran le dit et relit.
 * - `droit` : `401` ou `403`.
 * - `reseau` : aucune réponse.
 * - `inconnu` : tout le reste ; le détail du serveur n'atteint jamais l'écran.
 */
export type MotifRefusMembre =
	| 'dernier-administrateur'
	| 'sans-effet'
	| 'adresse-invalide'
	| 'role-invalide'
	| 'droit'
	| 'reseau'
	| 'inconnu'
export type IssueMembre = { readonly ok: true } | { readonly ok: false; readonly motif: MotifRefusMembre }

const ROLES_CONNUS: ReadonlySet<string> = new Set(['admin', 'business_developer', 'viewer'])

type LigneMembre = {
	readonly user_id: string
	readonly role: string
	readonly created_at: string
	readonly profiles: { readonly full_name: string | null } | null
}

/** Les administrateurs d'abord, puis par nom (`docs/SPEC-membres.md` §3.1, la règle de la plateforme). */
export function trierMembres(membres: readonly MembreEspace[]): readonly MembreEspace[] {
	return [...membres].sort((a, b) => {
		if ((a.role === 'admin') !== (b.role === 'admin')) return a.role === 'admin' ? -1 : 1
		return (a.nom ?? '').localeCompare(b.nom ?? '', 'fr')
	})
}

export async function lireMembresEspace(
	client: ClientCrm,
	idWorkspace: string,
): Promise<EtatAsync<readonly MembreEspace[]>> {
	try {
		const reponse = await client
			.from('workspace_members')
			.select('user_id, role, created_at, profiles(full_name)')
			.eq('workspace_id', idWorkspace)
		if (reponse.error !== null) return enErreur(classerErreur(reponse.status, reponse.error.message))
		const lignes = (reponse.data ?? []) as unknown as readonly LigneMembre[]
		return pret(
			trierMembres(
				lignes
					// Un rôle hors des trois est un défaut de la contrainte, pas une valeur à deviner : la ligne est écartée.
					.filter((ligne) => ROLES_CONNUS.has(ligne.role))
					.map((ligne) => ({
						idUtilisateur: ligne.user_id,
						nom: ligne.profiles?.full_name ?? null,
						role: ligne.role as RoleEspace,
						depuis: ligne.created_at,
					})),
			),
		)
	} catch (cause) {
		return enErreur(classerErreur(undefined, cause instanceof Error ? cause.message : String(cause)))
	}
}

type ReponseEcriture = {
	readonly data: unknown
	readonly error: { readonly code?: string; readonly message: string } | null
	readonly status: number
}

/** Traduit ce que la base rend d'une écriture en issue, par le code, le message ou le nombre de lignes. */
export function issueEcriture(reponse: ReponseEcriture): IssueMembre {
	if (reponse.error === null) {
		const lignes = Array.isArray(reponse.data) ? reponse.data.length : 0
		return lignes === 0 ? { ok: false, motif: 'sans-effet' } : { ok: true }
	}
	if (reponse.error.message.includes('last_workspace_admin')) return { ok: false, motif: 'dernier-administrateur' }
	if (reponse.error.message === 'adresse_invalide') return { ok: false, motif: 'adresse-invalide' }
	if (reponse.error.message === 'role_invalide') return { ok: false, motif: 'role-invalide' }
	const nature = classerErreur(reponse.status, reponse.error.message).nature
	if (nature === 'forbidden') return { ok: false, motif: 'droit' }
	if (nature === 'network') return { ok: false, motif: 'reseau' }
	return { ok: false, motif: 'inconnu' }
}

async function ecrire(executer: () => PromiseLike<ReponseEcriture>): Promise<IssueMembre> {
	try {
		return issueEcriture(await executer())
	} catch {
		return { ok: false, motif: 'reseau' }
	}
}

/** Change le rôle d'un membre. Le `select` fait rendre la ligne : sans lui, zéro ligne serait indistinguable d'un succès. */
export function changerRoleMembre(
	client: ClientCrm,
	idWorkspace: string,
	idUtilisateur: string,
	role: RoleEspace,
): Promise<IssueMembre> {
	return ecrire(() =>
		client
			.from('workspace_members')
			.update({ role })
			.eq('workspace_id', idWorkspace)
			.eq('user_id', idUtilisateur)
			.select('user_id') as unknown as PromiseLike<ReponseEcriture>,
	)
}

/** Retire un membre de l'espace ; ses droits fins partent avec lui par les cascades existantes (`SPEC-plateforme.md` §6.3). */
export function retirerMembreEspace(client: ClientCrm, idWorkspace: string, idUtilisateur: string): Promise<IssueMembre> {
	return ecrire(() =>
		client
			.from('workspace_members')
			.delete()
			.eq('workspace_id', idWorkspace)
			.eq('user_id', idUtilisateur)
			.select('user_id') as unknown as PromiseLike<ReponseEcriture>,
	)
}

// --- Les attentes (T3) ------------------------------------------------------------------------------------------

/** Une attente de l'espace, telle que la RLS la rend à son administrateur (`workspace_invitations_lecture_admin`). */
export type AttenteEspace = {
	readonly email: string
	readonly role: RoleEspace
	/** Le nom de qui l'a inscrite ; `null` quand l'auteur est inconnu ou son profil effacé. */
	readonly invitePar: string | null
	readonly depuis: string
}

type LigneAttente = {
	readonly email: string
	readonly role: string
	readonly created_at: string
	readonly profiles: { readonly full_name: string | null } | null
}

/**
 * « En suspens » : une attente non administratrice dans un espace sans administrateur MEMBRE ne se consommera qu'à
 * l'arrivée d'un administrateur (décision 593, `docs/SPEC-membres.md` §3.2) — la règle de la plateforme.
 */
export function attenteSuspendue(role: RoleEspace, administrateursMembres: number): boolean {
	return administrateursMembres === 0 && role !== 'admin'
}

/** Les attentes de l'espace, par adresse. Pour qui n'administre pas l'espace, la RLS rend une liste vide. */
export async function lireAttentesEspace(
	client: ClientCrm,
	idWorkspace: string,
): Promise<EtatAsync<readonly AttenteEspace[]>> {
	try {
		const reponse = await client
			.from('workspace_invitations')
			.select('email, role, created_at, profiles(full_name)')
			.eq('workspace_id', idWorkspace)
			.order('email')
		if (reponse.error !== null) return enErreur(classerErreur(reponse.status, reponse.error.message))
		const lignes = (reponse.data ?? []) as unknown as readonly LigneAttente[]
		return pret(
			lignes
				.filter((ligne) => ROLES_CONNUS.has(ligne.role))
				.map((ligne) => ({
					email: ligne.email,
					role: ligne.role as RoleEspace,
					invitePar: ligne.profiles?.full_name ?? null,
					depuis: ligne.created_at,
				})),
		)
	} catch (cause) {
		return enErreur(classerErreur(undefined, cause instanceof Error ? cause.message : String(cause)))
	}
}

/** L'issue d'une inscription : le rôle remplacé, `null` pour une attente neuve. */
export type IssueInscription =
	| { readonly ok: true; readonly remplace: RoleEspace | null }
	| { readonly ok: false; readonly motif: MotifRefusMembre }

/** Inscrit une attente, ou remplace celle de la même adresse, en une transaction (`inscrire_attente`, migration 97). */
export async function inscrireAttente(
	client: ClientCrm,
	idWorkspace: string,
	email: string,
	role: RoleEspace,
): Promise<IssueInscription> {
	try {
		const reponse = await client.rpc('inscrire_attente', { p_ws: idWorkspace, p_email: email, p_role: role })
		if (reponse.error === null) {
			const avant = reponse.data as unknown
			return { ok: true, remplace: typeof avant === 'string' && ROLES_CONNUS.has(avant) ? (avant as RoleEspace) : null }
		}
		const issue = issueEcriture(reponse as unknown as ReponseEcriture)
		return issue.ok ? { ok: false, motif: 'inconnu' } : issue
	} catch {
		return { ok: false, motif: 'reseau' }
	}
}

/** Retire une attente ; zéro ligne rendue est « sans effet » — elle venait d'être consommée ou retirée ailleurs. */
export function retirerAttenteEspace(client: ClientCrm, idWorkspace: string, email: string): Promise<IssueMembre> {
	return ecrire(() =>
		client
			.from('workspace_invitations')
			.delete()
			.eq('workspace_id', idWorkspace)
			.eq('email', email)
			.select('email') as unknown as PromiseLike<ReponseEcriture>,
	)
}
