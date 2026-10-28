// @spec CRM-069 (docs/BACKLOG.md) — tranche T2 : la pastille d'une étiquette, et la rangée de pastilles d'une affaire
// @spec docs/DESIGN_SYSTEM.md §5.73 (pilule compacte, point de tête, palette des tracks ; archivée dite dans le nom
//       accessible ; trois au plus sur la carte, puis « +n »), §5.6, §1 ; docs/SPEC-etiquettes-digest.md §3
//
// LA COULEUR NE PORTE JAMAIS SEULE L'INFORMATION (§1) : la pastille écrit le nom, et son point de tête n'est qu'un repère.

import { t } from '../../i18n'
import type { CouleurNoeud } from '../../lib/board'
import type { Etiquette } from '../../lib/etiquettes'

const TEINTES: Readonly<Record<CouleurNoeud, string>> = {
	brand: 'bg-brand-soft text-brand-on-soft',
	success: 'bg-success-soft text-success-on-soft',
	accent: 'bg-accent-soft text-accent-on-soft',
	danger: 'bg-danger-soft text-danger-on-soft',
	neutral: 'bg-hover text-text-2',
}

const POINTS: Readonly<Record<CouleurNoeud, string>> = {
	brand: 'bg-brand',
	success: 'bg-success',
	accent: 'bg-accent',
	danger: 'bg-danger',
	neutral: 'bg-text-3',
}

const CLASSES = 'inline-flex max-w-full items-center gap-1 rounded-full px-2 py-[2px] text-xs font-medium'

export function PastilleEtiquette({ etiquette }: { readonly etiquette: Pick<Etiquette, 'nom' | 'couleur' | 'archivee'> }) {
	const nomAccessible = etiquette.archivee ? t('labels.pill.archived', { nom: etiquette.nom }) : undefined
	return (
		<span
			data-testid="pastille-etiquette"
			data-couleur={etiquette.couleur}
			data-archivee={String(etiquette.archivee)}
			{...(nomAccessible === undefined ? {} : { role: 'img', 'aria-label': nomAccessible, title: nomAccessible })}
			className={`${CLASSES} ${TEINTES[etiquette.couleur]}`}
		>
			<span aria-hidden="true" className={`size-2 shrink-0 rounded-full ${POINTS[etiquette.couleur]}`} />
			<span className="truncate">{etiquette.nom}</span>
		</span>
	)
}

/**
 * Les pastilles d'une affaire. `plafond` borne leur nombre — trois sur la carte du board (§5.73) — et la dernière pastille,
 * neutre, dit combien restent, et lesquelles, dans son nom accessible et son infobulle. Aucune étiquette : rien n'est rendu.
 */
export function PastillesEtiquettes({
	etiquettes,
	plafond,
	testId = 'pastilles-etiquettes',
}: {
	readonly etiquettes: readonly Etiquette[]
	readonly plafond?: number
	readonly testId?: string
}) {
	if (etiquettes.length === 0) return null
	const visibles = plafond === undefined ? etiquettes : etiquettes.slice(0, plafond)
	const masquees = etiquettes.slice(visibles.length)
	const reste = masquees.map((e) => e.nom).join(', ')
	return (
		<ul data-testid={testId} aria-label={t('labels.list.aria')} className="flex flex-wrap gap-1 min-w-0">
			{visibles.map((etiquette) => (
				<li key={etiquette.id} className="min-w-0">
					<PastilleEtiquette etiquette={etiquette} />
				</li>
			))}
			{masquees.length === 0 ? null : (
				<li>
					<span
						data-testid="pastille-etiquettes-reste"
						role="img"
						aria-label={t('labels.more.aria', { n: String(masquees.length), noms: reste })}
						title={reste}
						className={`${CLASSES} ${TEINTES.neutral}`}
					>
						+{masquees.length}
					</span>
				</li>
			)}
		</ul>
	)
}
