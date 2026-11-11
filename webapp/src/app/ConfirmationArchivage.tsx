// @spec CRM-075 (docs/BACKLOG.md) — la confirmation d'archivage de l'arborescence, dans le flux du document, jamais une
//       modale (docs/SPEC-administration-arborescence.md §3.2, §6.3 ; docs/DESIGN_SYSTEM.md §5.13, §6)
// @spec CRM-134 (docs/BACKLOG.md) tranche T1 — la même confirmation, PARTAGÉE avec la vue du channel : le corps en
//       paramètre, la fermeture par `Échap` à la demande (docs/SPEC-channels.md §11.2 ; docs/DESIGN_SYSTEM.md §5.101 ;
//       décision 919 : « le même geste a la même forme dans les deux écrans »)
//
// Elle quitte `AdministrationArborescence.tsx` sans changer de forme : surface bordée, question en `font-medium`, corps
// en 13 px secondaire, « Archiver » plein aux jetons de danger puis « Annuler ». Le focus entre sur « Archiver ».

import { useEffect, useRef, type KeyboardEvent } from 'react'
import { Button } from '../components/ui/Button'
import { t } from '../i18n'
import { AlerteRefus } from './ElementsFormulaireAdmin'

export function ConfirmationArchivage({
	question,
	corps,
	refus,
	enCours,
	onConfirmer,
	onAnnuler,
	fermerParEchap = false,
}: {
	readonly question: string
	/** Ce que le geste fait, dit à l'endroit où il se fait — Réglages et la vue du channel ne le disent pas pareil. */
	readonly corps: string
	readonly refus: string | null
	readonly enCours: boolean
	readonly onConfirmer: () => void
	readonly onAnnuler: () => void
	/**
	 * `Échap` referme comme « Annuler » (§5.84) — demandé par la vue du channel. Réglages ne le demande pas : sa
	 * confirmation n'en a jamais eu, et `CRM-134` ne change pas son comportement.
	 */
	readonly fermerParEchap?: boolean
}) {
	const premier = useRef<HTMLButtonElement>(null)
	useEffect(() => {
		premier.current?.focus()
	}, [])
	const surTouche = (evenement: KeyboardEvent<HTMLDivElement>) => {
		if (!fermerParEchap || evenement.key !== 'Escape') return
		evenement.preventDefault()
		onAnnuler()
	}
	return (
		<div
			data-testid="confirmation-archivage"
			onKeyDown={surTouche}
			className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4"
		>
			<p className="font-medium">{question}</p>
			<p className="text-sm text-text-2">{corps}</p>
			{refus === null ? null : <AlerteRefus message={refus} />}
			<div className="flex gap-2">
				<button
					ref={premier}
					type="button"
					disabled={enCours}
					onClick={onConfirmer}
					className="inline-flex items-center justify-center gap-2 min-h-[var(--size-target)] rounded-sm px-4 font-medium bg-danger text-white hover:opacity-90 disabled:opacity-70"
				>
					{t('admin.archive.confirm.action')}
				</button>
				<Button variante="secondaire" onClick={onAnnuler}>
					{t('admin.action.cancel')}
				</Button>
			</div>
		</div>
	)
}
