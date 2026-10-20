// @spec CRM-093 (docs/BACKLOG.md) — tranche T2 : le motif d'une commande refusée, dit une fois en tête de son bloc
// @spec docs/DESIGN_SYSTEM.md §5.59 (la commande refusée par une capacité de la base), §5.29 ter (le bandeau neutre de
//       lecture seule, dont ce composant est la forme partagée) ; docs/SPEC-droits-interface.md §3
//
// UN BANDEAU D'INFORMATION, JAMAIS UNE ALERTE : ne pas pouvoir écrire n'est pas une erreur. Fond `--color-hover`,
// bordure `--color-border`, texte `--color-ink`, icône `Eye` — la forme exacte du §5.29 ter, extraite ici pour que tout
// le produit la rende de la même façon. Il dit ce que l'écran permet — le consulter — avant ce qu'il refuse : l'ordre
// inverse se lit comme un reproche. Chaque commande éteinte le CITE par `aria-describedby` (son `id`) plutôt que de
// répéter le motif : dit une fois, il se lit ; répété sur six commandes, il se saute.

import { Eye } from 'lucide-react'
import type { ReactNode } from 'react'

export type ProprietesMotifLectureSeule = {
	/** L'identifiant que chaque commande éteinte du bloc cite en `aria-describedby`. */
	readonly id: string
	readonly children: ReactNode
	readonly 'data-testid'?: string
}

export function MotifLectureSeule({ id, children, 'data-testid': testId }: ProprietesMotifLectureSeule) {
	return (
		<p
			id={id}
			role="status"
			data-testid={testId ?? 'motif-lecture-seule'}
			className="flex items-start gap-2 rounded-lg border border-border bg-hover px-3 py-2 text-sm text-ink max-w-[70ch]"
		>
			{/* L'icône descend de 2 px pour s'aligner sur la première ligne — valeur arbitraire assumée (§5.29 ter). */}
			<Eye aria-hidden="true" size={16} strokeWidth={2} className="mt-[2px] shrink-0" />
			<span>{children}</span>
		</p>
	)
}
