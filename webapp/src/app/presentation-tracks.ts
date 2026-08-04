// @spec CRM-020 (docs/BACKLOG.md) — présentation d'un track : couleur et icône
// @spec docs/SPEC-tracks.md §2.2 (color est un nom de jeton), §2.4 (icon), §7.1 (pilule)
// @spec docs/DESIGN_SYSTEM.md §1 (couleurs de données), §5.6 (badges et pilules), §9 (icônes)
//
// Deux correspondances, et un seul endroit où elles vivent.
//
// 1. `color` est un **nom de jeton** (docs/DESIGN_SYSTEM.md §1), jamais un hexadécimal. La base
//    le garantit par une contrainte `CHECK` ; ce module traduit le jeton en classes, sans jamais
//    écrire de couleur — `tokens.css` reste le seul fichier du dépôt à en contenir une.
//
// 2. `icon` est un nom d'icône Lucide. La base n'en contrôle que la **forme** : une énumération
//    en base deviendrait fausse au premier `npm update` sans qu'aucune migration ne le signale
//    (docs/JOURNAL.md, décision 54). L'existence est donc traitée ici, par un catalogue explicite
//    et un repli documenté.
//
// Pourquoi un catalogue plutôt qu'un accès dynamique à `lucide-react` : importer l'ensemble du
// paquet pour résoudre un nom au vol embarquerait plus d'un millier d'icônes dans le bundle. Le
// catalogue est aussi ce qui rend le repli **testable**.

import type { LucideIcon } from 'lucide-react'
import {
	Archive,
	Briefcase,
	Building2,
	Folder,
	GraduationCap,
	Handshake,
	LayoutDashboard,
	LifeBuoy,
	Rocket,
	Sparkles,
	Target,
	Wrench,
} from 'lucide-react'

/** Les cinq jetons de `docs/DESIGN_SYSTEM.md` §1, et eux seuls. */
export type JetonCouleur = 'brand' | 'success' | 'accent' | 'danger' | 'neutral'

/**
 * Classes de la pilule pour chaque jeton — `docs/DESIGN_SYSTEM.md` §5.6 : fond de la couleur
 * douce, texte à la couleur pleine.
 *
 * `neutral` emploie les neutres existants (`--color-hover`, `--color-text-2`) : le design system
 * ne déclare pas de « neutre doux », et en inventer un pour l'occasion créerait un jeton que le
 * document ne connaît pas (`docs/SPEC-tracks.md` §7.1).
 */
const CLASSES_PILULE: Readonly<Record<JetonCouleur, string>> = {
	brand: 'bg-brand-soft text-brand',
	success: 'bg-success-soft text-success',
	accent: 'bg-accent-soft text-ink',
	danger: 'bg-danger-soft text-danger',
	neutral: 'bg-hover text-text-2',
}

/**
 * Catalogue des icônes admises pour un track. Les clés sont en kebab-case, comme la colonne
 * `tracks.icon` et comme les noms publiés par Lucide.
 */
const CATALOGUE_ICONES: Readonly<Record<string, LucideIcon>> = {
	archive: Archive,
	briefcase: Briefcase,
	building: Building2,
	folder: Folder,
	'graduation-cap': GraduationCap,
	handshake: Handshake,
	'layout-dashboard': LayoutDashboard,
	'life-buoy': LifeBuoy,
	rocket: Rocket,
	sparkles: Sparkles,
	target: Target,
	wrench: Wrench,
}

/** Repli documenté : un nom inconnu donne une icône neutre, jamais un vide ni une exception. */
export const ICONE_PAR_DEFAUT: LucideIcon = Folder

/** Repli documenté : une valeur hors des cinq jetons est traitée comme `neutral`. */
export const COULEUR_PAR_DEFAUT: JetonCouleur = 'neutral'

/**
 * Classes de la pilule pour une couleur venue de la base.
 *
 * Le paramètre est un `string` et non un `JetonCouleur` **à dessein** : la valeur vient du
 * backend, et `docs/SPEC-types.md` pose qu'un type ne décrit jamais une garantie que le serveur
 * seul détient. La contrainte `CHECK` rend ce repli improbable ; elle ne le rend pas inutile —
 * une migration future pourrait ajouter un jeton avant que ce module ne le connaisse.
 */
export function classesPilule(couleur: string): string {
	// `Object.hasOwn` et non une simple indexation : la valeur vient du réseau, et
	// `CLASSES_PILULE['constructor']` rendrait une propriété héritée d'`Object`, donc une valeur
	// **vraie** qui court-circuiterait le repli. Défaut réel, trouvé par le test dédié.
	return Object.hasOwn(CLASSES_PILULE, couleur)
		? CLASSES_PILULE[couleur as JetonCouleur]
		: CLASSES_PILULE[COULEUR_PAR_DEFAUT]
}

/** Icône d'un track, avec repli sur `Folder` lorsque le nom est inconnu du catalogue. */
export function iconeTrack(nom: string): LucideIcon {
	// Même précaution que `classesPilule` : `CATALOGUE_ICONES['toString']` rendrait une fonction,
	// que React tenterait ensuite de rendre comme un composant.
	return Object.hasOwn(CATALOGUE_ICONES, nom) ? (CATALOGUE_ICONES[nom] as LucideIcon) : ICONE_PAR_DEFAUT
}

/** Noms d'icônes réellement admis. Exporté pour que les tests énumèrent le catalogue réel. */
export const NOMS_ICONES: readonly string[] = Object.keys(CATALOGUE_ICONES)
