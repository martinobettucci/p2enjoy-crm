// @spec CRM-022 (docs/BACKLOG.md) — avatar partagé, sûr et accessible
// @spec docs/SPEC-identite.md §7 ; docs/DESIGN_SYSTEM.md §5.1, §5.10, §8 et §11
//
// Une image refusée, absente ou en échec ne laisse jamais un trou : les initiales gardent la même
// taille. L'appelant choisit si l'identité est déjà écrite à côté (`decoratif`) ou si l'avatar doit
// porter seul son nom accessible (`libelleAccessible`).

import { useState } from 'react'
import { initialesDe, urlAvatarSure, type ProfilAffiche } from '../../lib/identites'

export type ProprietesAvatar = {
	readonly profil: ProfilAffiche | null
	readonly taille: 24 | 32
	/** Nom employé quand le profil a été détaché, notamment « Compte supprimé ». */
	readonly nomDeRepli?: string
	/** `true` lorsque le nom est écrit juste à côté : l'image devient décorative. */
	readonly decoratif?: boolean
	/** Exigé lorsque l'avatar est la seule représentation accessible de la personne. */
	readonly libelleAccessible?: string
	readonly className?: string
}

export function Avatar({
	profil,
	taille,
	nomDeRepli,
	decoratif = false,
	libelleAccessible,
	className = '',
}: ProprietesAvatar) {
	const nom = profil?.full_name ?? nomDeRepli ?? ''
	const source = urlAvatarSure(profil?.avatar_url)
	// Mémoriser la source fautive plutôt qu'un booléen réinitialisé par effet : si le profil change,
	// une nouvelle URL est immédiatement tentée sans écriture d'état pendant un effet React.
	const [sourceEnEchec, setSourceEnEchec] = useState<string | null>(null)

	if (nom === '') return null

	const libelle = decoratif ? undefined : (libelleAccessible ?? nom)
	const tailleClasse = taille === 24 ? 'size-6 text-xs' : 'size-8 text-sm'
	const classes = [
		'inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full',
		'bg-brand-soft text-brand font-medium select-none',
		tailleClasse,
		className,
	]
		.filter(Boolean)
		.join(' ')

	return (
		<span data-testid="avatar" className={classes} title={nom}>
			{source !== null && source !== sourceEnEchec ? (
				<img
					src={source}
					alt={decoratif ? '' : libelle}
					className="size-full object-cover"
					onError={() => setSourceEnEchec(source)}
				/>
			) : (
				<span
					aria-hidden={decoratif ? 'true' : undefined}
					role={decoratif ? undefined : 'img'}
					aria-label={decoratif ? undefined : libelle}
				>
					{initialesDe(nom)}
				</span>
			)}
		</span>
	)
}
