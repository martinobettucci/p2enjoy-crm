// @spec CRM-007 (docs/BACKLOG.md) — description des entrées de navigation
// @spec CRM-060 (docs/BACKLOG.md) — le carnet de contacts entre dans la navigation transverse
// @spec CRM-083 (docs/BACKLOG.md) — l'entrée « Objectifs » (docs/SPEC-goals.md §5.1)
// @spec CRM-086 (docs/BACKLOG.md) — l'entrée « Coûts » (docs/SPEC-costs.md §4.0 et §4.5)
// @spec docs/DESIGN_SYSTEM.md §4 (barre latérale : tracks, Inbox, Contacts, Ma journée, Réglages)
// @spec docs/SPEC-contacts.md §10.2 (pourquoi le carnet est une route de premier niveau)
// @spec docs/SPEC-webapp.md §5.2 (routes)
//
// Les entrées transverses sont **des données**, pas du balisage : la barre latérale les
// parcourt, elle ne les code pas en dur. C'est la même règle que docs/DESIGN_SYSTEM.md
// applique aux sections administrables, appliquée ici à la navigation.

import type { LucideIcon } from 'lucide-react'
import {
	CalendarCheck,
	ChartColumn,
	Contact,
	Goal,
	Inbox,
	LayoutGrid,
	Settings,
} from 'lucide-react'
import type { CleTraduction } from '../i18n'

export type EntreeNavigation = {
	readonly chemin: string
	readonly cleLibelle: CleTraduction
	readonly icone: LucideIcon
}

export const ENTREES_TRANSVERSES: readonly EntreeNavigation[] = [
	{ chemin: '/', cleLibelle: 'nav.item.board', icone: LayoutGrid },
	{ chemin: '/inbox', cleLibelle: 'nav.item.inbox', icone: Inbox },
	// L'icône est `Contact`, jamais `Users` : `Users` désignerait les MEMBRES du workspace, que
	// `CRM-070` administrera, et deux objets distincts ne partagent pas une icône
	// (`docs/SPEC-contacts.md` §10.2, `docs/DESIGN_SYSTEM.md` §9).
	{ chemin: '/contacts', cleLibelle: 'nav.item.contacts', icone: Contact },
	// L'icône est `Goal`, jamais `Target` : `Target` est déjà la métaphore du ciblage et de la
	// recherche, là où `Goal` désigne le but atteint — et deux objets distincts ne partagent pas
	// une icône (`docs/DESIGN_SYSTEM.md` §9, `docs/SPEC-goals.md` §5.1).
	{ chemin: '/objectifs', cleLibelle: 'nav.item.goals', icone: Goal },
	// L'icône est `ChartColumn`, et c'est la MÊME que celle de l'entrée « Coûts » de la barre
	// d'onglets d'un track (`TabBar`, `docs/DESIGN_SYSTEM.md` §12.1). La règle du §9 — deux objets
	// distincts ne partagent pas une icône — n'est pas enfreinte, elle est appliquée : ces deux
	// entrées désignent le MÊME objet, les coûts, à deux portées différentes. Leur donner deux
	// icônes ferait chercher deux choses là où il n'y en a qu'une.
	{ chemin: '/couts', cleLibelle: 'nav.item.costs', icone: ChartColumn },
	{ chemin: '/ma-journee', cleLibelle: 'nav.item.today', icone: CalendarCheck },
	{ chemin: '/reglages', cleLibelle: 'nav.item.settings', icone: Settings },
]
