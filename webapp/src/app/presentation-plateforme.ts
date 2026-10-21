// @spec CRM-101 (docs/BACKLOG.md) — tranche T3 : ce que l'écran de la plateforme écrit, et comment
// @spec CRM-103 tranche T2 — docs/DESIGN_SYSTEM.md §5.56 (onglet « Connecteur MCP » : familles, actions et issues en MOT,
//       détail de `mcp_droits_poses` accordé par clé), docs/SPEC-mcp.md §8.1, §6.1, §7.1
// @spec docs/DESIGN_SYSTEM.md §5.56 (dictionnaire fermé des refus, geste du journal en MOT, détail composé par clé),
//       §10 (aucune phrase par concaténation) ; docs/SPEC-plateforme.md §5.2 (gestes), §6.1 (refus)
//
// Module sans rendu : les composants de la plateforme le partagent, et ses fonctions se prouvent seules.

import { t, type CleTraduction } from '../i18n'
import type { ActionMcp, EntreeJournal, FamilleMcp, GesteJournal, IssueMcp, RefusPlateforme, RoleEspace } from '../lib/plateforme'

/** Un texte par refus ; un code inconnu rend le texte générique, jamais le message brut de la base (§5.56). */
const CLES_REFUS: Readonly<Record<RefusPlateforme, CleTraduction>> = {
	reserve_aux_superadministrateurs: 'platform.refus.reserve',
	espace_introuvable: 'platform.refus.espaceIntrouvable',
	profil_introuvable: 'platform.refus.profilIntrouvable',
	nom_invalide: 'platform.refus.nom',
	identifiant_invalide: 'platform.refus.identifiant',
	domaine_invalide: 'platform.refus.domaine',
	role_invalide: 'platform.refus.role',
	adresse_invalide: 'platform.refus.adresse',
	confirmation_incorrecte: 'platform.refus.confirmation',
	identifiant_pris: 'platform.refus.identifiantPris',
	last_workspace_admin: 'platform.refus.dernierAdministrateur',
	dernier_superadministrateur: 'platform.refus.dernierSuperadmin',
	droit_invalide: 'platform.refus.droit',
	issue_invalide: 'platform.refus.issue',
	network: 'platform.refus.reseau',
	unknown: 'platform.refus.inconnu',
}

export function texteRefus(refus: RefusPlateforme): string {
	return t(CLES_REFUS[refus])
}

const CLES_ROLE: Readonly<Record<RoleEspace, CleTraduction>> = {
	admin: 'platform.role.admin',
	business_developer: 'platform.role.business_developer',
	viewer: 'platform.role.viewer',
}

/** Le libellé d'un rôle ; un rôle inconnu laisse un texte vide, jamais la valeur brute (§5.14). */
export function libelleRole(role: RoleEspace | null): string {
	return role === null ? '' : t(CLES_ROLE[role])
}

const roleLu = (valeur: unknown): string =>
	valeur === 'admin' || valeur === 'business_developer' || valeur === 'viewer' ? t(CLES_ROLE[valeur]) : ''

/** Date et heure courtes, au format des autres tableaux du produit (`Corbeille.tsx`, `EtatMessagerie.tsx`). */
export function formaterDate(horodatage: string): string {
	const date = new Date(horodatage)
	if (Number.isNaN(date.getTime())) return horodatage
	return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'short' }).format(date)
}

const CLES_GESTE: Readonly<Record<GesteJournal, CleTraduction>> = {
	superadmin_amorce: 'platform.journal.geste.superadmin_amorce',
	superadmin_accorde: 'platform.journal.geste.superadmin_accorde',
	superadmin_retire: 'platform.journal.geste.superadmin_retire',
	espace_cree: 'platform.journal.geste.espace_cree',
	espace_modifie: 'platform.journal.geste.espace_modifie',
	espace_supprime: 'platform.journal.geste.espace_supprime',
	membre_pose: 'platform.journal.geste.membre_pose',
	membre_retire: 'platform.journal.geste.membre_retire',
	attente_inscrite: 'platform.journal.geste.attente_inscrite',
	attente_retiree: 'platform.journal.geste.attente_retiree',
	mcp_droits_poses: 'platform.journal.geste.mcp_droits_poses',
}

/** Le geste en MOT ; un geste inconnu laisse la cellule vide (§5.56). */
export function libelleGeste(geste: GesteJournal | null): string {
	return geste === null ? '' : t(CLES_GESTE[geste])
}

const chaine = (valeur: unknown): string => (typeof valeur === 'string' ? valeur : '')
const sous = (cible: Readonly<Record<string, unknown>>, cle: string): Readonly<Record<string, unknown>> => {
	const valeur = cible[cle]
	return typeof valeur === 'object' && valeur !== null ? (valeur as Record<string, unknown>) : {}
}

/**
 * Le détail d'une entrée, composé par UNE CLÉ PAR GESTE (§10) à partir de ce que la base a inscrit. Une entrée dont
 * la cible manque de ce qu'il faut rend un texte vide, jamais un `undefined`.
 */
export function detailJournal(entree: EntreeJournal): string {
	const c = entree.cible
	switch (entree.geste) {
		case 'superadmin_amorce':
		case 'superadmin_accorde':
		case 'superadmin_retire':
			return chaine(c['nom'])
		case 'espace_cree':
		case 'espace_supprime':
			return t('platform.journal.detail.espace', { nom: chaine(c['nom']), slug: chaine(c['slug']) })
		case 'espace_modifie':
			return t('platform.journal.detail.espaceModifie', {
				avant: chaine(sous(c, 'avant')['nom']),
				apres: chaine(sous(c, 'apres')['nom']),
			})
		case 'membre_pose':
			return c['avant'] === null || c['avant'] === undefined
				? t('platform.journal.detail.membreNouveau', {
						nom: chaine(c['nom']),
						espace: chaine(c['espace']),
						apres: roleLu(c['apres']),
					})
				: t('platform.journal.detail.membreRole', {
						nom: chaine(c['nom']),
						espace: chaine(c['espace']),
						avant: roleLu(c['avant']),
						apres: roleLu(c['apres']),
					})
		case 'membre_retire':
			return t('platform.journal.detail.membreRetire', {
				nom: chaine(c['nom']),
				espace: chaine(c['espace']),
				role: roleLu(c['role']),
			})
		case 'attente_inscrite':
			return t('platform.journal.detail.attenteInscrite', {
				email: chaine(c['email']),
				espace: chaine(c['espace']),
				apres: roleLu(c['apres']),
			})
		case 'attente_retiree':
			return t('platform.journal.detail.attenteRetiree', {
				email: chaine(c['email']),
				espace: chaine(c['espace']),
				role: roleLu(c['role']),
			})
		case 'mcp_droits_poses':
			return t('platform.journal.detail.mcpDroits', {
				nom: chaine(c['nom']),
				espace: chaine(c['espace']),
				avant: compter(Array.isArray(c['avant']) ? c['avant'].length : 0, CLES_CASES),
				apres: compter(Array.isArray(c['apres']) ? c['apres'].length : 0, CLES_CASES),
			})
		case null:
			return ''
	}
}

/**
 * Un compte en toutes lettres, accordé PAR CLÉ — jamais « 1 appartenance(s) » ni « les 1 flèches » (§10, §5.29).
 */
export function compter(n: number, cles: { readonly zero: CleTraduction; readonly un: CleTraduction; readonly plusieurs: CleTraduction }): string {
	if (n === 0) return t(cles.zero)
	if (n === 1) return t(cles.un)
	return t(cles.plusieurs, { n: String(n) })
}

export const CLES_APPARTENANCES = {
	zero: 'platform.compte.appartenances.zero',
	un: 'platform.compte.appartenances.un',
	plusieurs: 'platform.compte.appartenances.plusieurs',
} as const satisfies Record<'zero' | 'un' | 'plusieurs', CleTraduction>

export const CLES_ATTENTES = {
	zero: 'platform.compte.attentes.zero',
	un: 'platform.compte.attentes.un',
	plusieurs: 'platform.compte.attentes.plusieurs',
} as const satisfies Record<'zero' | 'un' | 'plusieurs', CleTraduction>

/** L'acteur : son nom, « Amorçage » pour l'amorçage, « Compte supprimé » sinon (§5.56, §5.10). */
export function libelleActeur(entree: EntreeJournal): string {
	if (entree.acteur !== null) return entree.acteur
	return entree.geste === 'superadmin_amorce' ? t('platform.amorcage') : t('platform.journal.acteurSupprime')
}

// --- Le connecteur MCP (`CRM-103`) ------------------------------------------------------------------------------

/** Un compte de cases de la matrice, accordé par clé (§10). */
export const CLES_CASES = {
	zero: 'platform.mcp.cases.zero',
	un: 'platform.mcp.cases.un',
	plusieurs: 'platform.mcp.cases.plusieurs',
} as const satisfies Record<'zero' | 'un' | 'plusieurs', CleTraduction>

const CLES_FAMILLE: Readonly<Record<FamilleMcp, { readonly libelle: CleTraduction; readonly portee: CleTraduction }>> = {
	structure: { libelle: 'platform.mcp.famille.structure', portee: 'platform.mcp.famille.structure.portee' },
	affaires: { libelle: 'platform.mcp.famille.affaires', portee: 'platform.mcp.famille.affaires.portee' },
	contacts: { libelle: 'platform.mcp.famille.contacts', portee: 'platform.mcp.famille.contacts.portee' },
	budgets: { libelle: 'platform.mcp.famille.budgets', portee: 'platform.mcp.famille.budgets.portee' },
	temps: { libelle: 'platform.mcp.famille.temps', portee: 'platform.mcp.famille.temps.portee' },
	objectifs: { libelle: 'platform.mcp.famille.objectifs', portee: 'platform.mcp.famille.objectifs.portee' },
	messagerie: { libelle: 'platform.mcp.famille.messagerie', portee: 'platform.mcp.famille.messagerie.portee' },
}

const CLES_ACTION: Readonly<Record<ActionMcp, CleTraduction>> = {
	consulter: 'platform.mcp.action.consulter',
	ajouter: 'platform.mcp.action.ajouter',
	modifier: 'platform.mcp.action.modifier',
	supprimer: 'platform.mcp.action.supprimer',
}

const CLES_ISSUE: Readonly<Record<IssueMcp, CleTraduction>> = {
	ok: 'platform.mcp.issue.ok',
	refus_matrice: 'platform.mcp.issue.refus_matrice',
	refus_crm: 'platform.mcp.issue.refus_crm',
	erreur: 'platform.mcp.issue.erreur',
	trop_volumineux: 'platform.mcp.issue.trop_volumineux',
}

export const libelleFamille = (famille: FamilleMcp): string => t(CLES_FAMILLE[famille].libelle)
export const porteeFamille = (famille: FamilleMcp): string => t(CLES_FAMILLE[famille].portee)
export const libelleAction = (action: ActionMcp): string => t(CLES_ACTION[action])
/** Une issue inconnue laisse un texte vide, jamais la valeur brute (§5.14). */
export const libelleIssue = (issue: IssueMcp | null): string => (issue === null ? '' : t(CLES_ISSUE[issue]))
