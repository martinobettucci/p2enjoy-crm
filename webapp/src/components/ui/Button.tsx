// @spec CRM-007 (docs/BACKLOG.md) — bouton du design system
// @spec docs/DESIGN_SYSTEM.md §5.5 (variantes, hauteur 40 px, anneau de focus), §8 (cibles ≥ 40 px)
// @spec docs/SPEC-webapp.md §5.3 (composants livrés)
//
// Seuls les composants de `components/ui` définissent des styles de base
// (docs/DESIGN_SYSTEM.md §11) : les composants métier les composent, ils ne les redéfinissent
// pas.

import type { ButtonHTMLAttributes, ReactNode } from 'react'

export type VarianteBouton = 'primaire' | 'secondaire' | 'destructif' | 'discret'

const VARIANTES: Readonly<Record<VarianteBouton, string>> = {
	primaire: 'bg-brand text-white hover:bg-brand-hover',
	secondaire: 'bg-surface text-ink border border-border hover:bg-hover',
	destructif: 'bg-danger text-white hover:opacity-90',
	discret: 'bg-transparent text-brand hover:bg-hover',
}

export type ProprietesBouton = ButtonHTMLAttributes<HTMLButtonElement> & {
	readonly variante?: VarianteBouton
	readonly children: ReactNode
}

export function Button({
	variante = 'secondaire',
	className = '',
	type = 'button',
	children,
	...reste
}: ProprietesBouton) {
	return (
		<button
			type={type}
			className={[
				'inline-flex items-center justify-center gap-2',
				'min-h-[var(--size-target)] px-4 rounded-sm',
				'text-base font-medium',
				'transition-colors duration-[var(--transition-duration-fast)]',
				// Un état désactivé reste lisible (docs/DESIGN_SYSTEM.md §8) : on baisse
				// l'opacité juste assez pour signaler l'indisponibilité, jamais au point de
				// rendre le libellé illisible.
				'disabled:opacity-70 disabled:cursor-not-allowed',
				VARIANTES[variante],
				className,
			].join(' ')}
			{...reste}
		>
			{children}
		</button>
	)
}
