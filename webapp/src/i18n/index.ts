// @spec CRM-007 (docs/BACKLOG.md) — fonction de traduction
// @spec docs/DESIGN_SYSTEM.md §10 (clés stables, français par défaut) ; docs/SPEC-webapp.md §10
//
// `t` n'accepte que les clés déclarées : une clé inconnue est une **erreur de compilation**,
// pas une chaîne manquante découverte à l'exécution.
//
// La langue par défaut, et seule langue livrée, est le français. Le jour où une seconde langue
// arrive, `LANGUE_PAR_DEFAUT` devient le repli et `t` prend la langue courante en second
// paramètre ; les clés, elles, ne bougent pas — c'est tout l'objet de leur stabilité.

import { fr, type CleTraduction } from './fr'

export const LANGUE_PAR_DEFAUT = 'fr' as const

export type Langue = typeof LANGUE_PAR_DEFAUT

const dictionnaires: Readonly<Record<Langue, Readonly<Record<CleTraduction, string>>>> = {
	fr,
}

export function t(cle: CleTraduction, langue: Langue = LANGUE_PAR_DEFAUT): string {
	return dictionnaires[langue][cle]
}

export type { CleTraduction }
export { fr }
