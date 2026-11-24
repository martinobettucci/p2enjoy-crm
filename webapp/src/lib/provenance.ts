// @spec CRM-161 (docs/BACKLOG.md) — tranche T3.a : le socle des pages globales — la provenance d'une ligne et le filtre
//       « Espace » dans l'adresse (docs/SPEC-espace-courant.md §10, §16.2, §16.5)
// @spec docs/DESIGN_SYSTEM.md §5.115 (rien pour une personne d'un seul espace ; `?espaces=<slug>,<slug>`, un slug inconnu
//       ignoré, aucune case cochée valant tous les espaces)
//
// CE MODULE NE LIT RIEN : il compose ce que la coquille a déjà lu (`ContexteEspace.espaces`) avec l'adresse de la page. Le
// filtre n'est PAS un droit (`CLAUDE.md` §10) : il restreint ce que la personne a déjà le droit de lire, et la RLS reste la
// seule règle de ce qu'elle lit.
// @spec CRM-161 (docs/BACKLOG.md) — tranche T3.b.2 : `avecEspaces`, le filtre gardé par un lien de la même page
//       (docs/DESIGN_SYSTEM.md §5.115)

import type { Workspace } from './workspaces'

/** Le paramètre d'adresse du filtre (§5.115). */
export const PARAMETRE_ESPACES = 'espaces'

/** Le séparateur des slugs dans l'adresse : un slug ne porte jamais de virgule (`[a-z0-9-]`). */
const SEPARATEUR = ','

/**
 * La provenance et le filtre n'existent qu'à partir de DEUX espaces lus (§16.1, §5.115) : pour une personne d'un seul
 * espace, la page reste celle d'avant T3. Sans espaces connus — hors coquille, ou pendant la lecture —, rien.
 */
export function provenanceVisible(espaces: readonly Workspace[] | undefined): boolean {
	return espaces !== undefined && espaces.length >= 2
}

/** Le nom d'un espace lu, ou `null` s'il ne l'est pas — l'écran ne nomme jamais ce qu'il ne connaît pas. */
export function nomEspace(espaces: readonly Workspace[] | undefined, idEspace: string | null | undefined): string | null {
	if (espaces === undefined || idEspace === null || idEspace === undefined) return null
	return espaces.find((espace) => espace.id === idEspace)?.name ?? null
}

/**
 * Les espaces choisis par l'adresse, en identifiants, dans l'ordre des espaces lus (celui du menu, §5.113). Un slug
 * inconnu — un espace quitté, une adresse recopiée d'une autre personne — est IGNORÉ : il ne filtre rien, et aucune case
 * ne lui correspond. Vide : tous les espaces.
 */
export function lireEspacesChoisis(
	parametres: URLSearchParams,
	espaces: readonly Workspace[] | undefined,
): readonly string[] {
	const brut = parametres.get(PARAMETRE_ESPACES)
	if (brut === null || brut === '' || espaces === undefined) return []
	const slugs = new Set(brut.split(SEPARATEUR))
	return espaces.filter((espace) => slugs.has(espace.slug)).map((espace) => espace.id)
}

/**
 * Écrit les espaces choisis dans l'adresse, par leurs slugs, en gardant les autres paramètres de la page. Aucun choisi :
 * le paramètre disparaît (tous les espaces, l'état de départ). Un identifiant inconnu n'est pas écrit.
 */
export function ecrireEspacesChoisis(
	idsChoisis: readonly string[],
	espaces: readonly Workspace[],
	precedente: URLSearchParams,
): URLSearchParams {
	const suivante = new URLSearchParams(precedente)
	const choisis = new Set(idsChoisis)
	const slugs = espaces.filter((espace) => choisis.has(espace.id)).map((espace) => espace.slug)
	if (slugs.length === 0) suivante.delete(PARAMETRE_ESPACES)
	else suivante.set(PARAMETRE_ESPACES, slugs.join(SEPARATEUR))
	return suivante
}

/**
 * Garde les lignes des espaces choisis. Aucun choisi : toutes. Une ligne sans espace connu n'est gardée que sans filtre :
 * le filtre dit « dans ces espaces », et une ligne dont l'espace est inconnu n'y est pas (§16.2 : le filtrage en mémoire
 * vaut pour une lecture non paginée).
 */
export function filtrerParEspace<T>(
	lignes: readonly T[],
	idsChoisis: readonly string[],
	espaceDe: (ligne: T) => string | null,
): readonly T[] {
	if (idsChoisis.length === 0) return lignes
	const choisis = new Set(idsChoisis)
	return lignes.filter((ligne) => {
		const idEspace = espaceDe(ligne)
		return idEspace !== null && choisis.has(idEspace)
	})
}

/**
 * Un chemin de la même page qui GARDE le filtre « Espace » de l'adresse courante (`CRM-161` T3.b.2, §5.115) : un lien qui
 * change une autre dimension de la page (la portée de « Ma journée ») ne défait pas le choix des espaces. Sans filtre posé,
 * le chemin est rendu tel quel.
 */
export function avecEspaces(chemin: string, parametres: URLSearchParams): string {
	const valeur = parametres.get(PARAMETRE_ESPACES)
	if (valeur === null || valeur === '') return chemin
	const [base = '', requete = ''] = chemin.split('?', 2)
	const suite = new URLSearchParams(requete)
	suite.set(PARAMETRE_ESPACES, valeur)
	return `${base}?${suite.toString()}`
}

// @spec CRM-161 (docs/BACKLOG.md) — tranche T3.c : la portée des cases propres à un espace, et leur groupement par espace
//       (docs/SPEC-espace-courant.md §16.8.3 ; docs/DESIGN_SYSTEM.md §5.115, « Un filtre dont les cases sont propres à un
//       espace »)

/** Les espaces que couvre une page filtrée : ceux du filtre, sinon tous les espaces lus, dans l'ordre du menu. */
export function espacesDeLaPortee(espaces: readonly Workspace[], idsChoisis: readonly string[]): readonly Workspace[] {
	if (idsChoisis.length === 0) return espaces
	const choisis = new Set(idsChoisis)
	return espaces.filter((espace) => choisis.has(espace.id))
}

/** Un groupe de cases : un espace, et ses éléments, dans l'ordre reçu. */
export type GroupeDEspace<T> = { readonly espace: Workspace; readonly elements: readonly T[] }

/**
 * Groupe des éléments par espace, dans l'ordre des espaces donnés (celui du menu, §5.113) ; un espace sans élément n'a pas
 * de groupe, et un élément d'un espace absent n'est rendu dans aucun — l'écran ne nomme jamais ce qu'il ne connaît pas.
 */
export function grouperParEspace<T>(
	elements: readonly T[],
	espaces: readonly Workspace[],
	espaceDe: (element: T) => string | null | undefined,
): readonly GroupeDEspace<T>[] {
	return espaces
		.map((espace) => ({ espace, elements: elements.filter((element) => espaceDe(element) === espace.id) }))
		.filter((groupe) => groupe.elements.length > 0)
}

