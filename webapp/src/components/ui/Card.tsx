// @spec CRM-007 (docs/BACKLOG.md) — surface de carte du design system
// @spec docs/DESIGN_SYSTEM.md §3 (rayon 14 px, ombre de carte), §1 (surface, bordure)
// @spec docs/SPEC-webapp.md §5.3 (composants livrés)

import type { ReactNode } from 'react'

export type ProprietesCard = {
	readonly className?: string
	readonly children: ReactNode
}

export function Card({ className = '', children }: ProprietesCard) {
	return (
		<div
			className={[
				'bg-surface border border-border rounded-lg shadow-card',
				'transition-shadow duration-[var(--transition-duration-fast)]',
				className,
			].join(' ')}
		>
			{children}
		</div>
	)
}
