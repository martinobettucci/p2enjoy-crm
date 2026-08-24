// @spec CRM-007 (docs/BACKLOG.md) — description des entrées de navigation
// @spec CRM-060 (docs/BACKLOG.md) — le carnet de contacts entre dans la navigation transverse
// @spec CRM-083 (docs/BACKLOG.md) — l'entrée « Objectifs » (docs/SPEC-goals.md §5.1)
// @spec CRM-086 (docs/BACKLOG.md) — l'entrée « Coûts » (docs/SPEC-costs.md §4.0 et §4.5)
// @spec CRM-061 (docs/BACKLOG.md) — l'entrée « Ma journée » mène enfin à un écran (docs/SPEC-cards.md §17.2)
// @spec CRM-062 (docs/BACKLOG.md) — l'entrée « Affaires figées » (docs/SPEC-relances.md §10.4)
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
	Hourglass,
	Inbox,
	LayoutGrid,
	Settings,
} from 'lucide-react'
import type { CleTraduction } from '../i18n'
import { CHEMIN_AFFAIRES_FIGEES, CHEMIN_MA_JOURNEE } from './chemins'

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
	{ chemin: CHEMIN_MA_JOURNEE, cleLibelle: 'nav.item.today', icone: CalendarCheck },
	// IMMÉDIATEMENT APRÈS « Ma journée », ET CE N'EST PAS UNE COMMODITÉ (`docs/SPEC-relances.md`
	// §10.4). Les deux écrans répondent à la même question — « qu'est-ce qui me réclame ? » — et se
	// lisent dans cet ordre : ce qui est DÛ aujourd'hui, puis ce qui DORT depuis trop longtemps. Le
	// §2.6 pose qu'une échéance dépassée et une affaire figée sont deux notions DIFFÉRENTES qui se
	// recoupent souvent, et le seul endroit où cette différence s'enseigne est la navigation, où
	// l'on voit les deux entrées voisines.
	//
	// L'icône est `Hourglass` : elle dit le temps qui s'écoule sans que rien n'avance, ce qu'est
	// exactement une affaire figée, et aucune autre entrée ne la porte (`docs/DESIGN_SYSTEM.md`
	// §9). Elle est DISTINCTE de l'`AlarmClock` que le fil donne à la relance (§10.3.1) : l'écran
	// montre un ÉTAT, la ligne du fil date un GESTE.
	{ chemin: CHEMIN_AFFAIRES_FIGEES, cleLibelle: 'nav.item.stalled', icone: Hourglass },
	{ chemin: '/reglages', cleLibelle: 'nav.item.settings', icone: Settings },
]
