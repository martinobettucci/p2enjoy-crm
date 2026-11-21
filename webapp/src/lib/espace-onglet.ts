// @spec CRM-161 (docs/BACKLOG.md) tranche T2.a — l'espace courant de l'onglet : celui de l'adresse sur une page d'un espace,
//       le dernier de l'onglet sur une page globale, sinon le premier par nom (docs/SPEC-espace-courant.md §2, §15.2 ;
//       docs/JOURNAL.md décision 967)
//
// LA MÉMOIRE DE L'ONGLET EST UNE VARIABLE DE CE MODULE, ET RIEN D'AUTRE. Elle vit tant que la page n'est pas rechargée ; chaque
// onglet a son propre contexte JavaScript, donc sa propre valeur : deux onglets travaillent sur deux espaces sans se gêner.
// Rien n'est écrit dans un stockage, ni sur l'appareil ni en base (`CLAUDE.md` §11 ; décision 967 : « si on stocke je ne
// peux pas avoir plusieurs onglets ouverts qui travaillent au même temps sur plusieurs espaces »).

import type { Workspace } from './workspaces'

let slugDeLOnglet: string | null = null

/** Le dernier espace courant de l'onglet, ou `null` s'il n'y en a pas encore eu. */
export function lireEspaceDeLOnglet(): string | null {
	return slugDeLOnglet
}

/** Retient l'espace d'une page d'un espace qu'on vient d'ouvrir. */
export function retenirEspaceDeLOnglet(slug: string): void {
	slugDeLOnglet = slug
}

/** Pour les preuves : l'onglet neuf. */
export function oublierEspaceDeLOnglet(): void {
	slugDeLOnglet = null
}

export type EspaceChoisi =
	| { readonly genre: 'espace'; readonly espace: Workspace }
	/** Le slug de l'adresse n'est pas un espace lu (§8.3) : l'écran le dit, sans dire si l'espace existe. */
	| { readonly genre: 'introuvable'; readonly premier: Workspace | null }
	/** Aucun espace lisible. */
	| { readonly genre: 'aucun' }

/**
 * L'espace courant (§15.2) : le slug de l'adresse s'il y en a un — il doit nommer un espace lu ; sinon le dernier de
 * l'onglet, s'il est encore lu ; sinon le premier par nom. `espaces` est la liste de `lireWorkspaces`, déjà triée par nom.
 */
export function choisirEspace(
	espaces: readonly Workspace[],
	slugAdresse: string | undefined,
	slugOnglet: string | null = lireEspaceDeLOnglet(),
): EspaceChoisi {
	const premier = espaces[0] ?? null
	if (slugAdresse !== undefined) {
		const espace = espaces.find((w) => w.slug === slugAdresse)
		return espace === undefined ? { genre: 'introuvable', premier } : { genre: 'espace', espace }
	}
	const memoire = slugOnglet === null ? undefined : espaces.find((w) => w.slug === slugOnglet)
	const espace = memoire ?? premier
	return espace === null ? { genre: 'aucun' } : { genre: 'espace', espace }
}

/** Le slug de l'espace d'une ressource, par son `workspace_id` ; `null` si l'espace n'est pas lu (§15.3). */
export function slugDeLEspace(espaces: readonly Workspace[], idWorkspace: string | null | undefined): string | null {
	if (idWorkspace === null || idWorkspace === undefined) return null
	return espaces.find((w) => w.id === idWorkspace)?.slug ?? null
}

/**
 * L'identifiant de l'espace où un écran d'un espace travaille (§15.2) : celui du contexte s'il est parmi les espaces lus ;
 * sinon — hors coquille, dans une preuve qui monte l'écran seul — le premier par nom, comme avant `CRM-161`.
 */
export function idEspaceParmi(espaces: readonly { readonly id: string }[], idContexte: string | null): string | null {
	if (idContexte !== null && espaces.some((w) => w.id === idContexte)) return idContexte
	return espaces[0]?.id ?? null
}
