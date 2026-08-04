// @spec CRM-007 (docs/BACKLOG.md) — description des entrées de navigation
// @spec docs/DESIGN_SYSTEM.md §4 (barre latérale : tracks, Inbox, Ma journée, Réglages)
// @spec docs/SPEC-webapp.md §5.2 (routes)
//
// Les entrées transverses sont **des données**, pas du balisage : la barre latérale les
// parcourt, elle ne les code pas en dur. C'est la même règle que docs/DESIGN_SYSTEM.md
// applique aux sections administrables, appliquée ici à la navigation.

import type { LucideIcon } from 'lucide-react'
import { CalendarCheck, Inbox, LayoutGrid, Settings } from 'lucide-react'
import type { CleTraduction } from '../i18n'

export type EntreeNavigation = {
	readonly chemin: string
	readonly cleLibelle: CleTraduction
	readonly icone: LucideIcon
}

export const ENTREES_TRANSVERSES: readonly EntreeNavigation[] = [
	{ chemin: '/', cleLibelle: 'nav.item.board', icone: LayoutGrid },
	{ chemin: '/inbox', cleLibelle: 'nav.item.inbox', icone: Inbox },
	{ chemin: '/ma-journee', cleLibelle: 'nav.item.today', icone: CalendarCheck },
	{ chemin: '/reglages', cleLibelle: 'nav.item.settings', icone: Settings },
]
