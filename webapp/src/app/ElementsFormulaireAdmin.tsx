// @spec CRM-075 (docs/BACKLOG.md) — les éléments des formulaires de l'arborescence : champ texte, alerte de refus,
//       traduction des refus
// @spec docs/SPEC-administration-arborescence.md §9 (les refus, et comment ils sont présentés)
// @spec docs/DESIGN_SYSTEM.md §5.7 (champs), §5.13 (l'alerte de refus DANS le formulaire)
// @spec CRM-100 (docs/BACKLOG.md) tranche T1 — docs/SPEC-administration-arborescence.md §13.2 : ces éléments
//       quittent `AdministrationArborescence.tsx`, inchangés, parce que le formulaire de channel est désormais
//       partagé avec la vue d'un track ; les recopier ferait diverger le premier refus traduit d'un côté seulement.

import { TriangleAlert } from 'lucide-react'
import { t } from '../i18n'
import type { RefusEcriture } from '../lib/administration-arborescence'

/** Traduit un refus, ou l'absence d'effet, en un texte destiné à l'utilisateur (§9). */
export function texteRefus(refus: RefusEcriture): string {
	switch (refus.nature) {
		case 'forbidden':
			return t('admin.refus.forbidden')
		case 'slug-pris':
			return t('admin.refus.slug-pris')
		case 'workflow-hors-track':
			return t('admin.refus.workflow-hors-track')
		case 'forme-refusee':
			return t('admin.refus.forme-refusee')
		case 'reference-absente':
			return t('admin.refus.reference-absente')
		case 'network':
			return t('admin.refus.network')
		case 'unknown':
			return t('admin.refus.unknown')
	}
}

/**
 * Alerte de refus, placée **dans** le formulaire concerné et non en tête d'écran, pour que le refus
 * soit lu près du champ qui l'a causé (docs/DESIGN_SYSTEM.md §5.13).
 */
export function AlerteRefus({ message }: { readonly message: string }) {
	return (
		<p
			role="alert"
			data-testid="admin-refus"
			className="flex items-start gap-2 rounded-sm bg-danger-soft text-danger-on-soft px-3 py-2 text-sm"
		>
			<TriangleAlert aria-hidden="true" size={16} strokeWidth={2} className="shrink-0 mt-[2px]" />
			<span>{message}</span>
		</p>
	)
}

type ProprietesChamp = {
	readonly id: string
	readonly libelle: string
	readonly valeur: string
	readonly onChange: (valeur: string) => void
	readonly aide?: string
	readonly erreur?: string
	readonly refInterne?: React.Ref<HTMLInputElement>
	readonly desactive?: boolean
}

/** Champ texte du §5.7 : libellé au-dessus, aide et erreur associées par `aria-describedby`. */
export function ChampTexte({
	id,
	libelle,
	valeur,
	onChange,
	aide,
	erreur,
	refInterne,
	desactive = false,
}: ProprietesChamp) {
	const idAide = `${id}-aide`
	const idErreur = `${id}-erreur`
	const decrit = [aide === undefined ? null : idAide, erreur === undefined ? null : idErreur]
		.filter((valeur): valeur is string => valeur !== null)
		.join(' ')
	return (
		<div className="flex flex-col gap-1">
			<label htmlFor={id} className="text-sm text-text-2">
				{libelle}
			</label>
			<input
				id={id}
				ref={refInterne}
				value={valeur}
				disabled={desactive}
				onChange={(evenement) => onChange(evenement.target.value)}
				aria-describedby={decrit === '' ? undefined : decrit}
				aria-invalid={erreur === undefined ? undefined : true}
				className="min-h-[var(--size-target)] rounded-sm border border-border bg-surface px-3 disabled:opacity-70"
			/>
			{aide === undefined ? null : (
				<span id={idAide} className="text-sm text-text-3">
					{aide}
				</span>
			)}
			{erreur === undefined ? null : (
				<span id={idErreur} role="alert" className="text-sm text-danger-on-soft">
					{erreur}
				</span>
			)}
		</div>
	)
}
