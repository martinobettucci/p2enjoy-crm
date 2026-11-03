// @spec CRM-111 (docs/BACKLOG.md) — tranche T7.5 : la pastille « aussi rattachée à N », sur la carte du board et dans la
//       cellule « Affaire » de la vue liste (docs/DESIGN_SYSTEM.md §5.85, §5.58 — l'infobulle qui nomme les channels)
//
// Une pastille compacte, neutre, focalisable : son survol ou son focus clavier ouvre l'infobulle du §5.58, qui nomme les
// autres channels. Elle n'est pas un lien : la carte et la ligne mènent déjà à la fiche.

import { FolderInput } from 'lucide-react'
import { t } from '../../i18n'
import type { CheminRattachement } from '../../lib/aussi-rattachee'
import { Infobulle } from './Infobulle'

export function PastilleAussiRattachee({ autres }: { readonly autres: readonly CheminRattachement[] }) {
	if (autres.length === 0) return null
	const nom = t(autres.length === 1 ? 'cardPlacements.also.one' : 'cardPlacements.also.many', { nombre: String(autres.length) })
	const liste = autres.map((autre) => t('cardPlacements.path', { track: autre.track, channel: autre.channel })).join('\n')
	return (
		<Infobulle titre={t('cardPlacements.also.title')} description={liste}>
			{({ idDescription }) => (
				<span
					role="img"
					tabIndex={0}
					data-testid="pastille-aussi-rattachee"
					aria-label={nom}
					aria-describedby={idDescription}
					// La forme compacte du sommeil (§5.3 quinquies), aux jetons neutres de « partagée » (§5.54, §5.60).
					className="inline-flex shrink-0 items-center gap-1 rounded-full bg-hover px-2 py-[2px] text-xs text-text-2"
				>
					<FolderInput aria-hidden="true" className="size-3" />
					<span aria-hidden="true">+{autres.length}</span>
				</span>
			)}
		</Infobulle>
	)
}
