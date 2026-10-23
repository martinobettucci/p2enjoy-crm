// @spec CRM-067 (docs/BACKLOG.md) — tranche T2 : le mot et l'icône de chaque type d'activité, partagés par le bloc de la
//       fiche et par le fil unifié
// @spec docs/DESIGN_SYSTEM.md §5.63 (une icône par type, jamais seule : le type se dit aussi en mot), §9 (une icône ne
//       sert qu'un objet), §10 (aucun texte en dur)
//
// Écrite UNE FOIS : deux écrans qui montrent la même donnée la montrent de la même façon (§5.58), et une table recopiée
// divergerait au premier type ajouté.

import { Phone, Users, Video, type LucideIcon } from 'lucide-react'
import type { CleTraduction } from '../i18n'
import type { TypeActivite } from '../lib/activites'

export const PRESENTATION_ACTIVITE: Readonly<
	Record<TypeActivite, { readonly cle: CleTraduction; readonly icone: LucideIcon }>
> = {
	call: { cle: 'activities.type.call', icone: Phone },
	meeting: { cle: 'activities.type.meeting', icone: Users },
	visio: { cle: 'activities.type.visio', icone: Video },
}

/** La pastille d'une activité vivante, et celle d'une pierre tombale (§5.63, §5.11). */
export const PASTILLE_ACTIVITE = 'bg-brand-soft text-brand'
export const PASTILLE_ACTIVITE_RETIREE = 'bg-hover text-text-3'

/** Date et heure absolues, au format du fil (§5.10) ; une valeur illisible est rendue telle quelle, ce qui se voit. */
export function formaterDateActivite(iso: string): string {
	const date = new Date(iso)
	if (Number.isNaN(date.getTime())) return iso
	return date.toLocaleString('fr-FR', {
		day: '2-digit',
		month: '2-digit',
		year: 'numeric',
		hour: '2-digit',
		minute: '2-digit',
	})
}
