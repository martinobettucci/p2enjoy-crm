// @spec CRM-116 (docs/BACKLOG.md) tranche T3 — le sélecteur de couleur, partagé par les formulaires de track et de
//       channel (docs/SPEC-administration-arborescence.md §14.3 ; docs/JOURNAL.md décision 729)
// @spec docs/DESIGN_SYSTEM.md §5.68 (cinq pastilles nommées dans l'ordre de la palette, valeur initiale et repli,
//       responsive), §5.29 (le patron du choix de couleur du canevas d'objectifs, réemployé), §5.7 (libellé), §8 (cible
//       de 40 px, focus visible), §10 (noms traduits)
//
// LE PATRON EST CELUI DU CANEVAS D'OBJECTIFS (§5.29), RÉEMPLOYÉ ET NON RÉINVENTÉ : un groupe de boutons radio natifs,
// chaque option portant sa pastille et son NOM EN CLAIR, l'option choisie bordée de la marque. Deux écrans qui
// choisissent la même chose le font de la même façon. Le radio reste VISIBLE : son état coché dit le choix sans la
// couleur (§1), et il porte lui-même l'anneau du `:focus-visible` global. `Tab` entre dans le groupe sur l'option
// choisie, les flèches changent l'option — le comportement du navigateur, sans code clavier propre.

import { useId } from 'react'
import { t } from '../i18n'
import { classesPastille, cleNomCouleur, JETONS_COULEUR, jetonCouleur } from './presentation-tracks'

export type ProprietesSelecteurCouleur = {
	/** La couleur courante, telle que lue ou saisie ; une valeur hors des cinq jetons s'affiche comme Gris. */
	readonly valeur: string
	readonly onChange: (couleur: string) => void
}

export function SelecteurCouleur({ valeur, onChange }: ProprietesSelecteurCouleur) {
	const groupe = useId()
	const choisie = jetonCouleur(valeur)

	return (
		<fieldset data-testid="selecteur-couleur" className="flex flex-col gap-2 min-w-0">
			<legend className="text-sm text-text-2">{t('admin.form.color')}</legend>
			{/* LA RANGÉE EST BORNÉE À LA FENÊTRE, ET C'EST UN DÉFAUT TROUVÉ EN REGARDANT UNE CAPTURE À 390 PX (`CLAUDE.md`
			    §16). Dans l'arborescence, le formulaire vit dans une liste `min-w-max` qui défile (§12.6) : il prend la largeur
			    du contenu, pas celle de la fenêtre, et « Rouge » et « Gris » sortaient du champ sans passer à la ligne. La
			    borne est celle du §5.27 pour un bloc posé dans un conteneur qui défile : la fenêtre, moins les marges des
			    conteneurs (6 rem). Là où le formulaire est déjà plus étroit, elle ne joue pas. */}
			<div className="flex flex-wrap gap-2 max-w-[calc(100vw-6rem)]">
				{JETONS_COULEUR.map((jeton) => (
					<label
						key={jeton}
						data-testid="option-couleur"
						data-couleur={jeton}
						className={[
							'inline-flex items-center gap-2 min-h-[var(--size-target)] px-3 rounded-sm border cursor-pointer',
							jeton === choisie ? 'border-brand bg-brand-soft' : 'border-border hover:bg-hover',
						].join(' ')}
					>
						<input
							type="radio"
							name={groupe}
							value={jeton}
							checked={jeton === choisie}
							onChange={() => onChange(jeton)}
							className="size-4 accent-brand"
						/>
						<span aria-hidden="true" className={`size-3 shrink-0 rounded-full ${classesPastille(jeton)}`} />
						<span className="text-sm">{t(cleNomCouleur(jeton))}</span>
					</label>
				))}
			</div>
		</fieldset>
	)
}
