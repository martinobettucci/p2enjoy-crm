// @spec CRM-133 (docs/BACKLOG.md) — tranche T2 : le bouton d'information d'une étape, sur l'en-tête de colonne du board et
//       sur le rattachement de la fiche (docs/SPEC-workflow-engine.md §7 sexies.4 ; docs/DESIGN_SYSTEM.md §5.58, révisé)
//
// Ni l'en-tête de colonne ni le nom de l'étape d'un rattachement ne sont des liens : la bulle de §5.58 s'accroche donc à
// un BOUTON posé juste après le nom — icône Lucide `Info` à 16 px dans une cible de `--size-target`, nom accessible
// « Description de l'étape {étape} », la description citée par `aria-describedby`. Il s'ouvre au survol, au focus
// clavier et à Entrée, se ferme à Échap. SANS DESCRIPTION EFFECTIVE, IL N'EST PAS RENDU (§5.58) : `Infobulle` ne rend
// alors que son enfant, et cet enfant est ici `null`.

import { Info } from 'lucide-react'
import { Infobulle } from '../components/ui/Infobulle'
import { descriptionAffichable } from '../lib/infobulle'
import { t } from '../i18n'

export type ProprietesBoutonDescriptionEtape = {
	/** Le libellé de l'étape, tel que l'écran l'écrit : il titre la bulle et nomme le bouton. */
	readonly etape: string
	/** La description effective (`descriptionEffective`, `lib/board.ts`) ; `null`, aucun bouton. */
	readonly description: string | null
	readonly testId?: string
}

export function BoutonDescriptionEtape({ etape, description, testId }: ProprietesBoutonDescriptionEtape) {
	if (descriptionAffichable(description) === null) return null
	return (
		<Infobulle titre={etape} description={description} ouvrirAEntree>
			{({ idDescription }) => (
				<button
					type="button"
					data-testid={testId ?? 'description-etape'}
					aria-label={t('workflow.step.descriptionButton', { etape })}
					aria-describedby={idDescription}
					className={[
						'inline-flex shrink-0 items-center justify-center rounded-sm align-middle',
						'min-h-[var(--size-target)] min-w-[var(--size-target)]',
						// La cible garde ses 40 px (§8) sans pousser la ligne : sans cette marge négative, l'en-tête d'une colonne
						// qui porte le bouton était 12 px plus haut que ses voisines (capture du 2026-11-10, `CLAUDE.md` §16).
						'-my-2',
						// Le focus visible est celui de toute l'application (`:focus-visible`, docs/DESIGN_SYSTEM.md §8).
						'text-text-3 hover:bg-hover hover:text-ink',
					].join(' ')}
				>
					<Info size={16} strokeWidth={2} aria-hidden="true" />
				</button>
			)}
		</Infobulle>
	)
}
