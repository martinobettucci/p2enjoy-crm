// @spec CRM-007 (docs/BACKLOG.md) — badge et pilule du design system
// @spec docs/DESIGN_SYSTEM.md §5.6 (rounded-full, fond doux, point ou icône obligatoire), §1
// @spec docs/SPEC-webapp.md §5.3 (composants livrés)
//
// L'information ne repose **jamais** sur la seule couleur (docs/DESIGN_SYSTEM.md §1, §5.6) :
// le point de tête n'est pas décoratif, il est structurel. Le composant ne permet donc pas de
// le retirer.

import type { ReactNode } from 'react'

export type TonBadge = 'brand' | 'success' | 'accent' | 'danger' | 'neutre'

const TONS: Readonly<Record<TonBadge, string>> = {
	brand: 'bg-brand-soft text-brand',
	success: 'bg-success-soft text-success',
	accent: 'bg-accent-soft text-ink',
	danger: 'bg-danger-soft text-danger',
	neutre: 'bg-hover text-text-2',
}

const POINTS: Readonly<Record<TonBadge, string>> = {
	brand: 'bg-brand',
	success: 'bg-success',
	accent: 'bg-accent',
	danger: 'bg-danger',
	neutre: 'bg-text-3',
}

export type ProprietesBadge = {
	readonly ton?: TonBadge
	readonly children: ReactNode
}

export function Badge({ ton = 'neutre', children }: ProprietesBadge) {
	return (
		<span
			className={[
				'inline-flex items-center gap-2 rounded-full px-3 py-1',
				'text-sm font-medium',
				TONS[ton],
			].join(' ')}
		>
			<span aria-hidden="true" className={['size-2 rounded-full shrink-0', POINTS[ton]].join(' ')} />
			{children}
		</span>
	)
}
