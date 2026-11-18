// @spec CRM-153 (docs/BACKLOG.md) — tranche T2 : lire le catalogue des catégories d'organisations de l'espace, les écrire
//       (administrateur), les archiver et désarchiver ; classer les refus
// @spec docs/SPEC-organisations.md §9.1 (`organization_categories` : nom rogné de 1 à 40, unique sans casse archivées
//       comprises ; un des cinq jetons ; « supprimer » archive, aucune suppression physique ; l'heure d'archivage est celle
//       de la base), §9.3 (Réglages ▸ Catégories d'organisations) ; docs/SCHEMA.md « Migration `0188` » ;
//       docs/DESIGN_SYSTEM.md §5.107, §5.103, §5.73 ; CLAUDE.md §10 — ce module ne décide AUCUN droit : il écrit, et la
//       base tranche (politiques `organization_categories_insert_admin` et `_update_admin`)
//
// Ce module ne rend rien : il lit, écrit et classe les refus. Les tranches T3 (la fiche) et T4 (la liste) relisent le même
// catalogue par `lireCategoriesOrganisations`.

import { classerErreur, enErreur, pret, type EtatAsync } from './async'
import type { CouleurNoeud } from './board'
import { couleurEtiquette } from './etiquettes'
import type { ClientCrm } from './supabase'

/** Colonnes réellement demandées. Exportées pour que les tests éprouvent la requête émise. */
export const COLONNES_CATEGORIE_ORGANISATION = 'id, name, color, archived_at'

/** La borne de la base (§9.1), dite à l'écran avant l'envoi : jamais une garde qui double une contrainte. */
export const LONGUEUR_NOM_CATEGORIE = 40

export type CategorieOrganisationLue = {
	readonly id: string
	readonly name: string
	readonly color: string
	readonly archived_at: string | null
}

export type CategorieOrganisation = {
	readonly id: string
	readonly nom: string
	readonly couleur: CouleurNoeud
	readonly archivee: boolean
}

const compare = (a: string, b: string): number => a.localeCompare(b, 'fr', { sensitivity: 'base' })

/** Les actives d'abord, puis les archivées ; chaque groupe dans l'ordre du nom (§9.3, la règle des étiquettes). */
export function projeterCategoriesOrganisations(
	lignes: readonly (CategorieOrganisationLue | null | undefined)[],
): readonly CategorieOrganisation[] {
	return lignes
		.filter((l): l is CategorieOrganisationLue => l !== null && l !== undefined)
		.map((l) => ({ id: l.id, nom: l.name, couleur: couleurEtiquette(l.color), archivee: l.archived_at !== null }))
		.sort((a, b) => Number(a.archivee) - Number(b.archivee) || compare(a.nom, b.nom) || compare(a.id, b.id))
}

/** Tout le catalogue de l'espace, archivées comprises : la RLS le borne aux membres de l'espace. */
export async function lireCategoriesOrganisations(
	client: ClientCrm,
	idWorkspace: string,
): Promise<EtatAsync<readonly CategorieOrganisation[]>> {
	try {
		const reponse = await client
			.from('organization_categories')
			.select(COLONNES_CATEGORIE_ORGANISATION)
			.eq('workspace_id', idWorkspace)
		if (reponse.error !== null) return enErreur(classerErreur(reponse.status, reponse.error.message))
		return pret(projeterCategoriesOrganisations((reponse.data ?? []) as readonly CategorieOrganisationLue[]))
	} catch (cause) {
		return enErreur(classerErreur(undefined, cause instanceof Error ? cause.message : String(cause)))
	}
}

// ---------------------------------------------------------------------------------------------
// Les écritures, et leurs refus — dictionnaire fermé
// ---------------------------------------------------------------------------------------------

export type NatureRefusCategorie =
	/** `23505` : une catégorie — active ou archivée — porte déjà ce nom, à la casse près. */
	| 'nom-pris'
	/** `23514` : nom vide ou de plus de 40 caractères, couleur hors des cinq jetons. */
	| 'forme'
	/** `401`, `403`, `42501` : le catalogue est à l'administrateur de l'espace. */
	| 'forbidden'
	/** `200` et zéro ligne : la politique a filtré, ou la ligne a disparu. */
	| 'sans-effet'
	| 'network'
	| 'unknown'

export function classerRefusCategorie(statutHttp: number | undefined, code: string | undefined): NatureRefusCategorie {
	if (code === '23505') return 'nom-pris'
	if (code === '23514') return 'forme'
	if (code === '42501' || statutHttp === 401 || statutHttp === 403) return 'forbidden'
	if (statutHttp === undefined || statutHttp === 0) return 'network'
	return 'unknown'
}

export type IssueCategorie = { readonly statut: 'applique' } | { readonly statut: 'refus'; readonly nature: NatureRefusCategorie }

type ReponseBrute = {
	readonly data: unknown
	readonly error: { readonly code?: string; readonly message: string } | null
	readonly status: number
}

async function executer(appel: () => PromiseLike<ReponseBrute>): Promise<IssueCategorie> {
	try {
		const reponse = await appel()
		if (reponse.error !== null) return { statut: 'refus', nature: classerRefusCategorie(reponse.status, reponse.error.code) }
		if (Array.isArray(reponse.data) && reponse.data.length === 0) return { statut: 'refus', nature: 'sans-effet' }
		return { statut: 'applique' }
	} catch {
		return { statut: 'refus', nature: 'network' }
	}
}

export type SaisieCategorie = { readonly nom: string; readonly couleur: CouleurNoeud }

/** Crée une catégorie. L'auteur et les dates sont posés par la base ; seules ces trois colonnes s'insèrent. */
export function creerCategorieOrganisation(
	client: ClientCrm,
	idWorkspace: string,
	saisie: SaisieCategorie,
): Promise<IssueCategorie> {
	return executer(() =>
		client
			.from('organization_categories')
			.insert({ workspace_id: idWorkspace, name: saisie.nom.trim(), color: saisie.couleur })
			.select('id'),
	)
}

export function modifierCategorieOrganisation(
	client: ClientCrm,
	idCategorie: string,
	saisie: SaisieCategorie,
): Promise<IssueCategorie> {
	return executer(() =>
		client
			.from('organization_categories')
			.update({ name: saisie.nom.trim(), color: saisie.couleur })
			.eq('id', idCategorie)
			.select('id'),
	)
}

/**
 * Archive ou désarchive (décision 939 : « supprimer » archive). L'heure envoyée n'est qu'un signal : la base pose la
 * sienne, et une catégorie déjà archivée garde la sienne (§9.1). Archivée, une catégorie ne se pose plus ; elle reste
 * affichée sur les organisations qui la portent, et s'en retire.
 */
export function archiverCategorieOrganisation(
	client: ClientCrm,
	idCategorie: string,
	archive: boolean,
	maintenant: () => string = () => new Date().toISOString(),
): Promise<IssueCategorie> {
	return executer(() =>
		client
			.from('organization_categories')
			.update({ archived_at: archive ? maintenant() : null })
			.eq('id', idCategorie)
			.select('id'),
	)
}
