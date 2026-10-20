// @spec CRM-101 (docs/BACKLOG.md) — tranche T3 : les appels de l'écran de la plateforme et leurs refus
// @spec docs/SPEC-plateforme.md §5.3 (`public.est_superadmin`, aide d'interface), §6 (les fonctions et le dictionnaire
//       des refus), §7 (l'écran) ; docs/DESIGN_SYSTEM.md §5.56 ; docs/SCHEMA.md §1 bis
// @spec docs/SPEC-webapp.md §6.4 (contrat asynchrone) ; CLAUDE.md §10 — ce module ne décide AUCUN droit
// @spec CRM-101 tranche T6 — docs/SPEC-plateforme.md §6.5 (`plateforme_utilisateurs`), arbitrage A6
//
// Toutes les lectures et écritures passent par les fonctions `public.plateforme_*`, gardées en base par
// `app.exiger_superadmin()`. L'écran n'en déduit rien : il envoie, et traduit ce que la base rend. Un refus est
// reconnu par son CODE — le message que la fonction lève, et qu'un dictionnaire fermé traduit —, jamais par une
// déduction de rôle.

import { useEffect, useState } from 'react'
import { classerErreur, enChargement, enErreur, pret, type EtatAsync } from './async'
import type { ClientCrm } from './supabase'

/** Les trois rôles d'un espace (`docs/SPEC-permissions-rls.md` §2.1). */
export const ROLES_ESPACE = ['admin', 'business_developer', 'viewer'] as const
export type RoleEspace = (typeof ROLES_ESPACE)[number]

/**
 * Les refus que les fonctions de la plateforme lèvent par leur message (`docs/SPEC-plateforme.md` §6.1), et
 * l'invariant du dernier administrateur, remonté tel quel depuis `0021`.
 */
export const CODES_REFUS_PLATEFORME = [
	'reserve_aux_superadministrateurs',
	'espace_introuvable',
	'profil_introuvable',
	'nom_invalide',
	'identifiant_invalide',
	'domaine_invalide',
	'role_invalide',
	'adresse_invalide',
	'confirmation_incorrecte',
	'identifiant_pris',
	'last_workspace_admin',
	'dernier_superadministrateur',
] as const
export type CodeRefusPlateforme = (typeof CODES_REFUS_PLATEFORME)[number]

/** Un refus reconnu, ou la nature d'un échec qui n'en est pas un (`network`, `unknown`). */
export type RefusPlateforme = CodeRefusPlateforme | 'network' | 'unknown'

/** L'issue d'une écriture : appliquée, ou refusée avec son code. */
export type Issue<T = null> = { readonly statut: 'ok'; readonly valeur: T } | { readonly statut: 'refus'; readonly refus: RefusPlateforme }

type ReponseRpc = {
	readonly data: unknown
	readonly error: { readonly message: string } | null
	readonly status: number
}

/**
 * Classe une réponse en échec. Le CODE est le message exact que la fonction a levé ; tout autre texte n'est jamais
 * affiché (`docs/DESIGN_SYSTEM.md` §5.56, dictionnaire fermé) et devient `unknown` — ou `network` si la requête n'a
 * pas abouti.
 */
export function classerRefus(statut: number | undefined, message: string | undefined): RefusPlateforme {
	if (message !== undefined && (CODES_REFUS_PLATEFORME as readonly string[]).includes(message)) {
		return message as CodeRefusPlateforme
	}
	if (statut === undefined || statut === 0) return 'network'
	return 'unknown'
}

async function appeler(client: ClientCrm, fonction: string, args: Record<string, unknown>): Promise<ReponseRpc> {
	// Le client est typé par le schéma généré ; les arguments sont ceux de `docs/SPEC-plateforme.md` §6, et la
	// conversion passe par `unknown` parce que le nom de la fonction est une variable de ce module.
	const rpc = client.rpc as unknown as (nom: string, a: Record<string, unknown>) => PromiseLike<ReponseRpc>
	return await rpc.call(client, fonction, args)
}

async function ecrire(client: ClientCrm, fonction: string, args: Record<string, unknown>): Promise<Issue<unknown>> {
	try {
		const reponse = await appeler(client, fonction, args)
		if (reponse.error !== null) return { statut: 'refus', refus: classerRefus(reponse.status, reponse.error.message) }
		return { statut: 'ok', valeur: reponse.data }
	} catch {
		return { statut: 'refus', refus: 'network' }
	}
}

async function lire<T>(client: ClientCrm, fonction: string, args: Record<string, unknown>, lignes: (data: unknown) => T): Promise<EtatAsync<T>> {
	try {
		const reponse = await appeler(client, fonction, args)
		if (reponse.error !== null) return enErreur(classerErreur(reponse.status, reponse.error.message))
		return pret(lignes(reponse.data))
	} catch (cause) {
		return enErreur(classerErreur(undefined, cause instanceof Error ? cause.message : String(cause)))
	}
}

const tableau = (data: unknown): readonly Record<string, unknown>[] => (Array.isArray(data) ? (data as Record<string, unknown>[]) : [])
const texte = (valeur: unknown): string => (typeof valeur === 'string' ? valeur : '')
const texteOuNul = (valeur: unknown): string | null => (typeof valeur === 'string' && valeur !== '' ? valeur : null)
const entier = (valeur: unknown): number => (typeof valeur === 'number' ? valeur : 0)

/** Un rôle lu est confronté à la liste, jamais casté : une valeur inconnue devient `null` (`lib/roles.ts`). */
export function roleConnu(valeur: unknown): RoleEspace | null {
	return (ROLES_ESPACE as readonly unknown[]).includes(valeur) ? (valeur as RoleEspace) : null
}

// --- Le drapeau, pour l'interface -------------------------------------------------------------------------------

/** Aide d'interface : `true` seulement quand la base l'a dit (`docs/DESIGN_SYSTEM.md` §5.56, frontière du §5.29 ter). */
export async function lireEstSuperadmin(client: ClientCrm): Promise<EtatAsync<boolean>> {
	return await lire(client, 'est_superadmin', {}, (data) => data === true)
}

/**
 * Le drapeau de l'appelant, lu une fois par la coquille. Hors session, rien n'est demandé : la réponse est connue.
 */
export function useEstSuperadmin(client: ClientCrm | null, idUtilisateur: string | null): EtatAsync<boolean> {
	const [etat, setEtat] = useState<EtatAsync<boolean>>(enChargement)
	useEffect(() => {
		if (client === null || idUtilisateur === null) {
			setEtat(pret(false))
			return
		}
		let vivant = true
		setEtat(enChargement())
		void lireEstSuperadmin(client).then((resultat) => {
			if (vivant) setEtat(resultat)
		})
		return () => {
			vivant = false
		}
	}, [client, idUtilisateur])
	return etat
}

// --- Espaces (§6.2) ----------------------------------------------------------------------------------------------

export type EspacePlateforme = {
	readonly id: string
	readonly nom: string
	readonly slug: string
	readonly domaineEntrant: string | null
	readonly membres: number
	readonly administrateurs: number
	readonly attentes: number
}

export async function lireEspaces(client: ClientCrm): Promise<EtatAsync<readonly EspacePlateforme[]>> {
	return await lire(client, 'plateforme_espaces', {}, (data) =>
		tableau(data).map((ligne) => ({
			id: texte(ligne['id']),
			nom: texte(ligne['nom']),
			slug: texte(ligne['slug']),
			domaineEntrant: texteOuNul(ligne['domaine_entrant']),
			membres: entier(ligne['membres']),
			administrateurs: entier(ligne['administrateurs']),
			attentes: entier(ligne['attentes']),
		})),
	)
}

export async function creerEspace(client: ClientCrm, nom: string, slug: string, domaine: string): Promise<Issue<string | null>> {
	const issue = await ecrire(client, 'plateforme_creer_espace', {
		p_nom: nom,
		p_slug: slug,
		p_domaine_entrant: domaine.trim() === '' ? null : domaine,
	})
	return issue.statut === 'ok' ? { statut: 'ok', valeur: typeof issue.valeur === 'string' ? issue.valeur : null } : issue
}

export async function modifierEspace(client: ClientCrm, id: string, nom: string, domaine: string): Promise<Issue<unknown>> {
	return await ecrire(client, 'plateforme_modifier_espace', {
		p_id: id,
		p_nom: nom,
		p_domaine_entrant: domaine.trim() === '' ? null : domaine,
	})
}

export async function supprimerEspace(client: ClientCrm, id: string, slugConfirme: string): Promise<Issue<unknown>> {
	return await ecrire(client, 'plateforme_supprimer_espace', { p_id: id, p_slug_confirme: slugConfirme })
}

/**
 * La confirmation de suppression n'est ouverte qu'à la saisie EXACTE de l'identifiant court : c'est l'état de la
 * confirmation, pas un droit (`docs/DESIGN_SYSTEM.md` §5.56). Aucune normalisation : la base compare à l'identique.
 */
export function confirmationSuppressionValide(saisie: string, slug: string): boolean {
	return slug !== '' && saisie === slug
}

// --- Appartenances (§6.3) ----------------------------------------------------------------------------------------

export type MembrePlateforme = {
	readonly idUtilisateur: string
	readonly nom: string
	readonly role: RoleEspace | null
	readonly superadmin: boolean
	readonly depuis: string
}

export async function lireMembres(client: ClientCrm, idEspace: string): Promise<EtatAsync<readonly MembrePlateforme[]>> {
	return await lire(client, 'plateforme_membres', { p_ws: idEspace }, (data) =>
		tableau(data).map((ligne) => ({
			idUtilisateur: texte(ligne['user_id']),
			nom: texte(ligne['nom']),
			role: roleConnu(ligne['role']),
			superadmin: ligne['superadmin'] === true,
			depuis: texte(ligne['depuis']),
		})),
	)
}

export async function poserMembre(client: ClientCrm, idEspace: string, idUtilisateur: string, role: RoleEspace): Promise<Issue<unknown>> {
	return await ecrire(client, 'plateforme_poser_membre', { p_ws: idEspace, p_user: idUtilisateur, p_role: role })
}

export async function retirerMembre(client: ClientCrm, idEspace: string, idUtilisateur: string): Promise<Issue<unknown>> {
	return await ecrire(client, 'plateforme_retirer_membre', { p_ws: idEspace, p_user: idUtilisateur })
}

// --- Attentes (§6.4) ---------------------------------------------------------------------------------------------

export type AttentePlateforme = {
	readonly email: string
	readonly role: RoleEspace | null
	readonly invitePar: string | null
	readonly depuis: string
}

export async function lireAttentes(client: ClientCrm, idEspace: string): Promise<EtatAsync<readonly AttentePlateforme[]>> {
	return await lire(client, 'plateforme_attentes', { p_ws: idEspace }, (data) =>
		tableau(data).map((ligne) => ({
			email: texte(ligne['email']),
			role: roleConnu(ligne['role']),
			invitePar: texteOuNul(ligne['invite_par']),
			depuis: texte(ligne['depuis']),
		})),
	)
}

/**
 * Une attente est EN SUSPENS quand l'espace n'a aucun administrateur et qu'elle n'est pas administratrice : elle ne
 * se consommera qu'après l'arrivée d'un administrateur (décision 593). Le calcul vient des données déjà lues, et il
 * ne décide rien — la base applique la même règle à la connexion.
 */
export function attenteEnSuspens(attente: AttentePlateforme, administrateurs: number): boolean {
	return administrateurs === 0 && attente.role !== 'admin'
}

export async function inviter(client: ClientCrm, idEspace: string, email: string, role: RoleEspace): Promise<Issue<unknown>> {
	return await ecrire(client, 'plateforme_inviter', { p_ws: idEspace, p_email: email, p_role: role })
}

export async function retirerAttente(client: ClientCrm, idEspace: string, email: string): Promise<Issue<unknown>> {
	return await ecrire(client, 'plateforme_retirer_attente', { p_ws: idEspace, p_email: email })
}

// --- Personnes et superadministrateurs (§6.5) ---------------------------------------------------------------------

export type ProfilPlateforme = {
	readonly id: string
	readonly nom: string
	readonly superadmin: boolean
}

/** Une recherche de moins de deux caractères n'est pas émise : elle rendrait la moitié des profils. */
export const LONGUEUR_MIN_RECHERCHE = 2

export function rechercheEmissible(terme: string): boolean {
	return terme.trim().length >= LONGUEUR_MIN_RECHERCHE
}

export async function lireProfils(client: ClientCrm, terme: string): Promise<EtatAsync<readonly ProfilPlateforme[]>> {
	return await lire(client, 'plateforme_profils', { p_recherche: terme.trim(), p_limite: 50 }, (data) =>
		tableau(data).map((ligne) => ({
			id: texte(ligne['id']),
			nom: texte(ligne['nom']),
			superadmin: ligne['superadmin'] === true,
		})),
	)
}

// --- Utilisateurs (§6.5, `CRM-101` T6, arbitrage A6) -----------------------------------------------------------

/** La borne de `plateforme_utilisateurs` : au-delà, la troncature est écrite (`docs/DESIGN_SYSTEM.md` §5.56). */
export const BORNE_UTILISATEURS = 200

export type AppartenanceUtilisateur = {
	readonly slug: string
	readonly nom: string
	/** Confronté à la liste des rôles, jamais casté : une valeur inconnue devient `null`. */
	readonly role: RoleEspace | null
}

export type UtilisateurPlateforme = {
	readonly id: string
	readonly nom: string
	readonly creeLe: string
	readonly superadmin: boolean
	readonly espaces: readonly AppartenanceUtilisateur[]
	/** `null` pour qui n'est jamais venu au connecteur : « Jamais connecté » à l'écran. */
	readonly connecteurDerniereActivite: string | null
}

/** Les utilisateurs du CRM — les profils —, filtrés par nom ; un terme vide les rend tous, dans la borne. */
export async function lireUtilisateurs(client: ClientCrm, terme: string): Promise<EtatAsync<readonly UtilisateurPlateforme[]>> {
	return await lire(client, 'plateforme_utilisateurs', { p_recherche: terme.trim(), p_limite: BORNE_UTILISATEURS }, (data) =>
		tableau(data).map((ligne) => ({
			id: texte(ligne['id']),
			nom: texte(ligne['nom']),
			creeLe: texte(ligne['cree_le']),
			superadmin: ligne['superadmin'] === true,
			espaces: tableau(ligne['espaces']).map((espace) => ({
				slug: texte(espace['slug']),
				nom: texte(espace['nom']),
				role: roleConnu(espace['role']),
			})),
			connecteurDerniereActivite: texteOuNul(ligne['connecteur_derniere_activite']),
		})),
	)
}

export type SuperadminPlateforme = {
	readonly sub: string
	readonly nom: string
	/** `null` pour un drapeau amorcé, qui n'a pas d'auteur : « Amorçage » à l'écran (§5.56). */
	readonly accordePar: string | null
	readonly accordeLe: string
}

export async function lireSuperadmins(client: ClientCrm): Promise<EtatAsync<readonly SuperadminPlateforme[]>> {
	return await lire(client, 'plateforme_superadmins', {}, (data) =>
		tableau(data).map((ligne) => ({
			sub: texte(ligne['sub']),
			nom: texte(ligne['nom']),
			accordePar: texteOuNul(ligne['accorde_par_nom']),
			accordeLe: texte(ligne['accorde_le']),
		})),
	)
}

export async function poserSuperadmin(client: ClientCrm, idUtilisateur: string, actif: boolean): Promise<Issue<unknown>> {
	return await ecrire(client, 'plateforme_poser_superadmin', { p_user: idUtilisateur, p_actif: actif })
}

// --- Journal -----------------------------------------------------------------------------------------------------

/** Les gestes du journal (`docs/SPEC-plateforme.md` §5.2) ; un geste inconnu n'est jamais affiché brut. */
export const GESTES_JOURNAL = [
	'superadmin_amorce',
	'superadmin_accorde',
	'superadmin_retire',
	'espace_cree',
	'espace_modifie',
	'espace_supprime',
	'membre_pose',
	'membre_retire',
	'attente_inscrite',
	'attente_retiree',
	'mcp_droits_poses',
] as const
export type GesteJournal = (typeof GESTES_JOURNAL)[number]

export type EntreeJournal = {
	readonly id: number
	readonly acteur: string | null
	readonly geste: GesteJournal | null
	readonly cible: Readonly<Record<string, unknown>>
	readonly creeLe: string
}

/** Taille d'une page du journal ; une page pleine laisse supposer des entrées plus anciennes. */
export const PAGE_JOURNAL = 50

export async function lireJournal(client: ClientCrm, avant: number | null): Promise<EtatAsync<readonly EntreeJournal[]>> {
	return await lire(client, 'plateforme_journal_liste', { p_avant: avant, p_limite: PAGE_JOURNAL }, (data) =>
		tableau(data).map((ligne) => ({
			id: entier(ligne['id']),
			acteur: texteOuNul(ligne['acteur_nom']),
			geste: (GESTES_JOURNAL as readonly unknown[]).includes(ligne['geste']) ? (ligne['geste'] as GesteJournal) : null,
			cible: typeof ligne['cible'] === 'object' && ligne['cible'] !== null ? (ligne['cible'] as Record<string, unknown>) : {},
			creeLe: texte(ligne['cree_le']),
		})),
	)
}

/** Le curseur de la page suivante : l'identifiant le plus ancien de la page, ou `null` quand elle n'est pas pleine. */
export function curseurSuivant(page: readonly EntreeJournal[]): number | null {
	if (page.length < PAGE_JOURNAL) return null
	return page.reduce((plusAncien, entree) => Math.min(plusAncien, entree.id), Number.POSITIVE_INFINITY)
}
