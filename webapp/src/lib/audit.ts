// @spec CRM-072 (docs/BACKLOG.md) — tranche T2 : la lecture du journal d'audit de l'espace, filtrée et paginée
// @spec docs/SPEC-audit.md §3 (la table, lue sous la RLS : `audit_log_select_admin`), §4 (familles, objets, actions),
//       §7.3 (le nom d'un contact n'est jamais dans le journal : il est lu à l'affichage), §8 (filtres dans l'adresse,
//       pagination par curseur de 50) ; docs/DESIGN_SYSTEM.md §5.66 ; docs/JOURNAL.md décisions 725 à 728
// @spec CLAUDE.md §10 — ce module ne décide AUCUN droit : la RLS rend ce que l'appelant peut lire, zéro ligne sinon
//
// LES FILTRES VIENNENT DE L'ADRESSE, ET UNE VALEUR INCONNUE Y EST IGNORÉE, JAMAIS DEVINÉE : une famille hors des six, un
// acteur qui n'est ni un identifiant ni « système », une date mal formée retombent sur « aucun filtre ».

import { classerErreur, enErreur, pret, type EtatAsync } from './async'
import type { ClientCrm } from './supabase'

/** Les six familles de `audit_log.family` (`docs/SPEC-audit.md` §4), dans l'ordre de l'écran. */
export const FAMILLES_AUDIT = ['access', 'configuration', 'sign_in', 'export', 'deletion', 'retention'] as const
export type FamilleAudit = (typeof FAMILLES_AUDIT)[number]

/** La valeur d'adresse du filtre « Système ou compte supprimé » : les entrées sans acteur. */
export const ACTEUR_SYSTEME = 'systeme'

export type FiltresAudit = {
	readonly famille: FamilleAudit | null
	/** Un identifiant de profil, `ACTEUR_SYSTEME`, ou `null` pour tous. */
	readonly acteur: string | null
	/** Jour local `AAAA-MM-JJ`, inclus. */
	readonly du: string | null
	/** Jour local `AAAA-MM-JJ`, inclus. */
	readonly au: string | null
}

export const AUCUN_FILTRE: FiltresAudit = { famille: null, acteur: null, du: null, au: null }

export type EntreeAudit = {
	readonly id: number
	readonly date: string
	/** `null` pour une famille que l'écran ne connaît pas : la ligne reste, sa phrase est vide. */
	readonly famille: FamilleAudit | null
	readonly action: string
	readonly objet: string
	readonly idObjet: string | null
	readonly libelle: string | null
	readonly details: Readonly<Record<string, unknown>>
	readonly idActeur: string | null
	/** Le nom du profil ; `null` pour un acteur nul ou un profil sans nom. */
	readonly acteur: string | null
}

/** Taille d'une page ; une page pleine laisse supposer des entrées plus anciennes (`docs/SPEC-audit.md` §8). */
export const PAGE_AUDIT = 50

const MOTIF_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MOTIF_JOUR = /^(\d{4})-(\d{2})-(\d{2})$/

/** Un jour `AAAA-MM-JJ` réel — « 2026-02-30 » n'en est pas un. */
export function jourValide(valeur: string | null): valeur is string {
	if (valeur === null) return false
	const morceaux = MOTIF_JOUR.exec(valeur)
	if (morceaux === null) return false
	const [annee, mois, jour] = [Number(morceaux[1]), Number(morceaux[2]), Number(morceaux[3])]
	const date = new Date(annee, mois - 1, jour)
	return date.getFullYear() === annee && date.getMonth() === mois - 1 && date.getDate() === jour
}

/** Les filtres lus dans l'adresse ; toute valeur inconnue est ignorée. */
export function lireFiltres(parametres: URLSearchParams): FiltresAudit {
	const famille = parametres.get('famille')
	const acteur = parametres.get('acteur')
	const du = parametres.get('du')
	const au = parametres.get('au')
	return {
		famille: (FAMILLES_AUDIT as readonly (string | null)[]).includes(famille) ? (famille as FamilleAudit) : null,
		acteur: acteur !== null && (acteur === ACTEUR_SYSTEME || MOTIF_UUID.test(acteur)) ? acteur : null,
		du: jourValide(du) ? du : null,
		au: jourValide(au) ? au : null,
	}
}

/** Les filtres écrits dans l'adresse ; un filtre absent n'y paraît pas. */
export function ecrireFiltres(filtres: FiltresAudit): URLSearchParams {
	const parametres = new URLSearchParams()
	if (filtres.famille !== null) parametres.set('famille', filtres.famille)
	if (filtres.acteur !== null) parametres.set('acteur', filtres.acteur)
	if (filtres.du !== null) parametres.set('du', filtres.du)
	if (filtres.au !== null) parametres.set('au', filtres.au)
	return parametres
}

/** Minuit local du jour donné, en instant ISO ; `decalage` jours plus tard. */
export function debutJour(jour: string, decalage = 0): string {
	const [annee, mois, quantieme] = jour.split('-').map(Number) as [number, number, number]
	return new Date(annee, mois - 1, quantieme + decalage).toISOString()
}

type LigneAudit = {
	readonly id: number
	readonly occurred_at: string
	readonly family: string
	readonly action: string
	readonly entity_type: string
	readonly entity_id: string | null
	readonly entity_label: string | null
	readonly details: unknown
	readonly actor_id: string | null
	readonly acteur: { readonly full_name: string | null } | null
}

function entreeDe(ligne: LigneAudit): EntreeAudit {
	return {
		id: ligne.id,
		date: ligne.occurred_at,
		famille: (FAMILLES_AUDIT as readonly string[]).includes(ligne.family) ? (ligne.family as FamilleAudit) : null,
		action: ligne.action,
		objet: ligne.entity_type,
		idObjet: ligne.entity_id,
		libelle: ligne.entity_label,
		details:
			typeof ligne.details === 'object' && ligne.details !== null && !Array.isArray(ligne.details)
				? (ligne.details as Record<string, unknown>)
				: {},
		idActeur: ligne.actor_id,
		acteur: ligne.acteur?.full_name ?? null,
	}
}

/**
 * Une page du journal, la plus récente en tête. `avant` est le curseur : l'identifiant le plus ancien de la page
 * précédente. Un membre qui n'administre pas l'espace reçoit zéro ligne (RLS), jamais une erreur.
 */
export async function lireJournalAudit(
	client: ClientCrm,
	idWorkspace: string,
	filtres: FiltresAudit,
	avant: number | null,
): Promise<EtatAsync<readonly EntreeAudit[]>> {
	try {
		let requete = client
			.from('audit_log')
			.select('id, occurred_at, family, action, entity_type, entity_id, entity_label, details, actor_id, acteur:profiles(full_name)')
			.eq('workspace_id', idWorkspace)
		if (filtres.famille !== null) requete = requete.eq('family', filtres.famille)
		if (filtres.acteur === ACTEUR_SYSTEME) requete = requete.is('actor_id', null)
		else if (filtres.acteur !== null) requete = requete.eq('actor_id', filtres.acteur)
		if (filtres.du !== null) requete = requete.gte('occurred_at', debutJour(filtres.du))
		// « Au » inclut le jour qu'il nomme : la borne est minuit du lendemain, exclue.
		if (filtres.au !== null) requete = requete.lt('occurred_at', debutJour(filtres.au, 1))
		if (avant !== null) requete = requete.lt('id', avant)
		const reponse = await requete.order('id', { ascending: false }).limit(PAGE_AUDIT)
		if (reponse.error !== null) return enErreur(classerErreur(reponse.status, reponse.error.message))
		return pret(((reponse.data ?? []) as unknown as readonly LigneAudit[]).map(entreeDe))
	} catch (cause) {
		return enErreur(classerErreur(undefined, cause instanceof Error ? cause.message : String(cause)))
	}
}

/** Le curseur de la page suivante : l'identifiant le plus ancien, ou `null` quand la page n'est pas pleine. */
export function curseurSuivantAudit(page: readonly EntreeAudit[]): number | null {
	if (page.length < PAGE_AUDIT) return null
	return page.reduce((plusAncien, entree) => Math.min(plusAncien, entree.id), Number.POSITIVE_INFINITY)
}

/**
 * Les noms des contacts nommés par une page du journal, lus dans le carnet À L'AFFICHAGE (`docs/SPEC-audit.md` §7.3).
 * Un contact absent de la réponse n'existe plus : l'écran écrit « contact supprimé ». Un échec de lecture rend une
 * table vide — la ligne reste lisible, sans nom —, jamais une erreur de tout l'écran.
 */
export async function lireNomsContacts(client: ClientCrm, ids: readonly string[]): Promise<ReadonlyMap<string, string>> {
	const uniques = [...new Set(ids)]
	if (uniques.length === 0) return new Map()
	try {
		const reponse = await client.from('contacts').select('id, full_name').in('id', uniques)
		if (reponse.error !== null) return new Map()
		return new Map(
			((reponse.data ?? []) as readonly { readonly id: string; readonly full_name: string }[]).map((l) => [l.id, l.full_name]),
		)
	} catch {
		return new Map()
	}
}

/** Les identifiants de contacts d'une page, pour `lireNomsContacts`. */
export function contactsDe(entrees: readonly EntreeAudit[]): readonly string[] {
	return entrees.filter((e) => e.objet === 'contact' && e.idObjet !== null).map((e) => e.idObjet as string)
}
