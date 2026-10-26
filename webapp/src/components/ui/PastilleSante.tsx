// @spec CRM-066 (docs/BACKLOG.md) — tranche 4 : la pastille d'un score de santé, sur la carte du board et sur la fiche
// @spec docs/DESIGN_SYSTEM.md §5.65 (pastille compacte, teinte du palier, palier écrit dans le nom accessible et
//       l'infobulle) ; docs/SPEC-analytique.md §13.6 ; docs/JOURNAL.md décisions 708 et 724
//
// LE PALIER EST UN MOT, PAS SEULEMENT UNE COULEUR (§1, CLAUDE.md §22) : la pastille montre « Dynamique 55 », et son nom
// accessible comme son infobulle disent « Dynamique 55 sur 100, à surveiller ».

import { t } from '../../i18n'
import { CLASSES_PALIER, CLE_PALIER, type Palier } from '../../lib/sante'

export function PastilleSante({
	libelle,
	score,
	palier,
	testId,
}: {
	/** Le nom court du score : « Dynamique » ou « Santé ». */
	readonly libelle: string
	readonly score: number
	readonly palier: Palier
	readonly testId?: string
}) {
	const phrase = t('health.badge.aria', { libelle, score: String(score), palier: t(CLE_PALIER[palier]) })
	return (
		<span
			role="img"
			aria-label={phrase}
			title={phrase}
			data-testid={testId}
			data-palier={palier}
			className={[
				'inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs tabular-nums font-medium w-fit',
				CLASSES_PALIER[palier],
			].join(' ')}
		>
			{libelle} {score}
		</span>
	)
}
