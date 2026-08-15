// @spec CRM-007 (docs/BACKLOG.md) — bouton du design system
// @spec docs/DESIGN_SYSTEM.md §5.5 (variantes, deux tailles, hauteur 40 px, anneau de focus),
//       §5.10 (actions tertiaires 13 px du fil), §8 (cibles ≥ 40 px)
// @spec docs/SPEC-webapp.md §5.3 (composants livrés)
//
// Seuls les composants de `components/ui` définissent des styles de base
// (docs/DESIGN_SYSTEM.md §11) : les composants métier les composent, ils ne les redéfinissent
// pas.

import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react'

export type VarianteBouton = 'primaire' | 'secondaire' | 'destructif' | 'discret'

const VARIANTES: Readonly<Record<VarianteBouton, string>> = {
	primaire: 'bg-brand text-white hover:bg-brand-hover',
	secondaire: 'bg-surface text-ink border border-border hover:bg-hover',
	destructif: 'bg-danger text-white hover:opacity-90',
	discret: 'bg-transparent text-brand hover:bg-hover',
}

/**
 * Deux tailles, et la cible tactile ne change pas d'une à l'autre.
 *
 * `compacte` n'agit que sur le **libellé** — 13 px, la taille des métadonnées du §5.10 — et sur le
 * rembourrage horizontal. La hauteur minimale reste celle du §8 : une action tertiaire n'est pas
 * une cible plus petite, elle est un texte plus discret.
 */
export type TailleBouton = 'normale' | 'compacte'

const TAILLES: Readonly<Record<TailleBouton, string>> = {
	normale: 'px-4 text-base',
	compacte: 'px-2 text-sm',
}

export type ProprietesBouton = ButtonHTMLAttributes<HTMLButtonElement> & {
	readonly variante?: VarianteBouton
	readonly taille?: TailleBouton
	readonly children: ReactNode
	/**
	 * Référence vers le bouton rendu, DÉCLARÉE et non seulement transmise.
	 *
	 * React 19 passe `ref` comme une propriété ordinaire des composants de fonction : elle est déjà
	 * reversée au `button` par l'étalement ci-dessous, mais `ButtonHTMLAttributes` ne la déclare pas,
	 * et l'écrire sans ce type ne compilerait pas. Elle sert aux écrans qui doivent RENDRE le focus à
	 * la commande ayant ouvert une confirmation (docs/DESIGN_SYSTEM.md §5.13) — sans quoi annuler au
	 * clavier laisse le focus sur un bouton qui vient de disparaître.
	 */
	readonly ref?: Ref<HTMLButtonElement>
}

export function Button({
	variante = 'secondaire',
	taille = 'normale',
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
				'min-h-[var(--size-target)] rounded-sm',
				'font-medium',
				TAILLES[taille],
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
