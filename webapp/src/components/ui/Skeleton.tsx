// @spec CRM-007 (docs/BACKLOG.md) — état de chargement du design system
// @spec docs/DESIGN_SYSTEM.md §5.8 (squelettes, jamais de spinner plein écran), §6
// @spec docs/SPEC-webapp.md §7 (états systématiques)
//
// Le squelette prend la **forme du contenu attendu** : c'est ce qui distingue un squelette
// d'un spinner, et ce que docs/DESIGN_SYSTEM.md §5.8 demande explicitement.
//
// L'ensemble est annoncé une seule fois par le conteneur (`aria-busy`, `aria-label`) : les
// barres elles-mêmes sont décoratives et masquées aux technologies d'assistance, sans quoi un
// lecteur d'écran énumérerait des rectangles vides.

export type ProprietesSkeletonListe = {
	/** Nombre de lignes du squelette : la forme du contenu attendu, pas un nombre décoratif. */
	readonly lignes: number
	readonly libelle: string
	readonly className?: string
}

export function SkeletonListe({ lignes, libelle, className = '' }: ProprietesSkeletonListe) {
	return (
		<div
			role="status"
			aria-busy="true"
			aria-label={libelle}
			data-testid="squelette"
			className={['flex flex-col gap-2', className].join(' ')}
		>
			{Array.from({ length: lignes }, (_, rang) => (
				<span
					key={rang}
					aria-hidden="true"
					className="block h-8 rounded-sm bg-hover animate-pulse"
				/>
			))}
		</div>
	)
}
