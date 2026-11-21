// @spec CRM-161 (docs/BACKLOG.md) tranche T2.a — le lien et la navigation d'une page d'un espace : un chemin d'espace
//       (`/inbox`, `/tracks/…`, `/reglages/…`) est mis dans l'espace courant de l'onglet ; un chemin global reste tel quel
//       (docs/SPEC-espace-courant.md §15.3)
//
// LES ÉCRANS D'UN ESPACE L'IMPORTENT À LA PLACE DE `Link` ET DE `useNavigate` (`import { LienEspace as Link }`) : leurs
// liens, écrits comme avant, mènent dans l'espace courant sans que chaque composition ait à le savoir. Les pages
// GLOBALES gardent `Link` : une ligne y porte une ressource d'un espace qui n'est pas forcément le courant, et son
// ancienne adresse est résolue par la redirection vers l'espace de la ressource (§15.4).

import { forwardRef, useCallback } from 'react'
import { Link, NavLink, useNavigate, type LinkProps, type NavLinkProps, type NavigateOptions, type To } from 'react-router'
import { useVersEspace } from './ContexteEspace'

export const LienEspace = forwardRef<HTMLAnchorElement, LinkProps>(function LienEspace({ to, ...proprietes }, ref) {
	const versEspace = useVersEspace()
	return <Link ref={ref} to={typeof to === 'string' ? versEspace(to) : to} {...proprietes} />
})

/** `NavLink`, dont un chemin d'espace est mis dans l'espace courant : l'état actif se compare à l'adresse réelle. */
export const NavLienEspace = forwardRef<HTMLAnchorElement, NavLinkProps>(function NavLienEspace({ to, ...proprietes }, ref) {
	const versEspace = useVersEspace()
	return <NavLink ref={ref} to={typeof to === 'string' ? versEspace(to) : to} {...proprietes} />
})

/** `useNavigate`, dont un chemin d'espace est mis dans l'espace courant. */
export function useNaviguerEspace(): (destination: To | number, options?: NavigateOptions) => void {
	const naviguer = useNavigate()
	const versEspace = useVersEspace()
	return useCallback(
		(destination: To | number, options?: NavigateOptions) => {
			if (typeof destination === 'number') {
				void naviguer(destination)
				return
			}
			void naviguer(typeof destination === 'string' ? versEspace(destination) : destination, options)
		},
		[naviguer, versEspace],
	)
}
