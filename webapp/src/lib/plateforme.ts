// @spec CRM-101 (docs/BACKLOG.md) — tranche T3 : les appels de l'écran de la plateforme et leurs refus
// @spec docs/SPEC-plateforme.md §5.3 (`public.est_superadmin`, aide d'interface), §6 (les fonctions et le dictionnaire
//       des refus), §7 (l'écran) ; docs/DESIGN_SYSTEM.md §5.56 ; docs/SCHEMA.md §1 bis
// @spec docs/SPEC-webapp.md §6.4 (contrat asynchrone) ; CLAUDE.md §10 — ce module ne décide AUCUN droit
// @spec CRM-101 tranche T6 — docs/SPEC-plateforme.md §6.5 (`plateforme_utilisateurs`), arbitrage A6
// @spec CRM-103 tranche T2 — docs/SPEC-mcp.md §8.1 (écrans), §8.2 (les quatre RPC d'administration, leurs refus), §6.1
//       (familles et actions), §7.1 (issues du journal) ; arbitrages A3, A5 et D9
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
	// `CRM-103` (docs/SPEC-mcp.md §8.2) : une matrice hors des familles et actions fermées, une issue inconnue.
	'droit_invalide',
	'issue_invalide',
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

// --- Le connecteur MCP (`CRM-103`, docs/SPEC-mcp.md §8) ---------------------------------------------------------

/** Les sept familles de la matrice, dans l'ordre du §6.1 : l'ordre des lignes, et celui que la base rend. */
export const FAMILLES_MCP = ['structure', 'affaires', 'contacts', 'budgets', 'temps', 'objectifs', 'messagerie'] as const
export type FamilleMcp = (typeof FAMILLES_MCP)[number]
/** Les quatre actions, dans l'ordre des colonnes. « Supprimer » veut dire corbeille ou archive, jamais purge (A4). */
export const ACTIONS_MCP = ['consulter', 'ajouter', 'modifier', 'supprimer'] as const
export type ActionMcp = (typeof ACTIONS_MCP)[number]
/** Les cinq issues d'un appel au journal du connecteur (§7.1). */
export const ISSUES_MCP = ['ok', 'refus_matrice', 'refus_crm', 'erreur', 'trop_volumineux'] as const
export type IssueMcp = (typeof ISSUES_MCP)[number]

/** Une case de la matrice, sous la forme `famille:action` : la clé d'un ensemble, et ce que la base attend en couple. */
export type CaseMcp = `${FamilleMcp}:${ActionMcp}`

export function caseMcp(famille: FamilleMcp, action: ActionMcp): CaseMcp {
	return `${famille}:${action}`
}

const familleConnue = (v: unknown): v is FamilleMcp => (FAMILLES_MCP as readonly unknown[]).includes(v)
const actionConnue = (v: unknown): v is ActionMcp => (ACTIONS_MCP as readonly unknown[]).includes(v)

export type CompteMcp = {
	readonly sub: string
	readonly nom: string
	readonly email: string
	readonly derniereActivite: string
	readonly espacesOuverts: number
	readonly superadmin: boolean
	readonly avecProfil: boolean
}

export async function lireComptesMcp(client: ClientCrm): Promise<EtatAsync<readonly CompteMcp[]>> {
	return await lire(client, 'mcp_comptes_liste', {}, (data) =>
		tableau(data).map((ligne) => ({
			sub: texte(ligne['sub']),
			nom: texte(ligne['nom']),
			email: texte(ligne['email']),
			derniereActivite: texte(ligne['derniere_activite']),
			espacesOuverts: entier(ligne['espaces_ouverts']),
			superadmin: ligne['superadmin'] === true,
			avecProfil: ligne['avec_profil'] === true,
		})),
	)
}

export type EspaceFicheMcp = {
	readonly workspaceId: string
	readonly slug: string
	readonly nom: string
	/** Le rôle d'appartenance, ou `null` hors de l'espace : les droits resteraient alors sans effet (A2). */
	readonly role: RoleEspace | null
	readonly droits: ReadonlySet<CaseMcp>
}

export type FicheMcp = {
	readonly sub: string
	readonly nom: string
	readonly email: string | null
	readonly avecProfil: boolean
	readonly connecte: boolean
	readonly derniereActivite: string | null
	readonly superadmin: boolean
	readonly espaces: readonly EspaceFicheMcp[]
}

/** Les couples rendus par la base ; un couple hors des listes fermées est ignoré, jamais deviné. */
function cases(valeur: unknown): ReadonlySet<CaseMcp> {
	const ensemble = new Set<CaseMcp>()
	for (const couple of Array.isArray(valeur) ? valeur : []) {
		if (Array.isArray(couple) && familleConnue(couple[0]) && actionConnue(couple[1])) ensemble.add(caseMcp(couple[0], couple[1]))
	}
	return ensemble
}

export async function lireFicheMcp(client: ClientCrm, sub: string): Promise<EtatAsync<FicheMcp>> {
	return await lire(client, 'mcp_compte', { p_sub: sub }, (data) => {
		const fiche = typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : {}
		return {
			sub: texte(fiche['sub']),
			nom: texte(fiche['nom']),
			email: texteOuNul(fiche['email']),
			avecProfil: fiche['avec_profil'] === true,
			connecte: fiche['connecte'] === true,
			derniereActivite: texteOuNul(fiche['derniere_activite']),
			superadmin: fiche['superadmin'] === true,
			espaces: tableau(fiche['espaces']).map((espace) => ({
				workspaceId: texte(espace['workspace_id']),
				slug: texte(espace['slug']),
				nom: texte(espace['nom']),
				role: roleConnu(espace['role']),
				droits: cases(espace['droits']),
			})),
		}
	})
}

/** Remplace la matrice d'un espace (§8.2) : l'ensemble entier part, dans l'ordre des familles puis des actions. */
export async function poserDroitsMcp(client: ClientCrm, sub: string, workspaceId: string, droits: ReadonlySet<CaseMcp>): Promise<Issue<null>> {
	const couples: [FamilleMcp, ActionMcp][] = []
	for (const famille of FAMILLES_MCP) {
		for (const action of ACTIONS_MCP) if (droits.has(caseMcp(famille, action))) couples.push([famille, action])
	}
	const issue = await ecrire(client, 'mcp_poser_droits', { p_sub: sub, p_ws: workspaceId, p_droits: couples })
	return issue.statut === 'ok' ? { statut: 'ok', valeur: null } : issue
}

export type AppelMcp = {
	readonly id: number
	readonly nom: string
	readonly outil: string
	readonly espaceNom: string | null
	/** `null` pour une issue que l'écran ne connaît pas : la cellule reste vide (§5.14). */
	readonly issue: IssueMcp | null
	readonly dureeMs: number
	readonly creeLe: string
}

export async function lireJournalMcp(
	client: ClientCrm,
	filtre: { readonly sub?: string | null; readonly issue?: IssueMcp | null; readonly avant?: number | null },
): Promise<EtatAsync<readonly AppelMcp[]>> {
	return await lire(
		client,
		'mcp_journal_liste',
		{ p_sub: filtre.sub ?? null, p_issue: filtre.issue ?? null, p_avant: filtre.avant ?? null, p_limite: PAGE_JOURNAL },
		(data) =>
			tableau(data).map((ligne) => ({
				id: entier(ligne['id']),
				nom: texte(ligne['nom']),
				outil: texte(ligne['outil']),
				espaceNom: texteOuNul(ligne['espace_nom']),
				issue: (ISSUES_MCP as readonly unknown[]).includes(ligne['issue']) ? (ligne['issue'] as IssueMcp) : null,
				dureeMs: entier(ligne['duree_ms']),
				creeLe: texte(ligne['cree_le']),
			})),
	)
}

/** Le curseur de la page suivante du journal des appels, comme celui de la plateforme. */
export function curseurSuivantMcp(page: readonly AppelMcp[]): number | null {
	if (page.length < PAGE_JOURNAL) return null
	return page.reduce((plusAncien, appel) => Math.min(plusAncien, appel.id), Number.POSITIVE_INFINITY)
}
