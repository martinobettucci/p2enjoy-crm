// @spec CRM-071 (docs/BACKLOG.md) — tranche T4 : la commande « Exporter en CSV », commune à la vue liste et au carnet
// @spec docs/DESIGN_SYSTEM.md §5.76 (discrète compacte, `FileSpreadsheet`, jamais éteinte par un droit, « Préparation… »,
//       l'issue annoncée près d'elle, le refus traduit) ; docs/SPEC-vues-import-export.md §5
//
// La commande ne sait rien de ce qu'elle exporte : l'appelant lui passe de quoi préparer le fichier — son nom et son
// contenu —, ou la clé du refus. Elle le télécharge, et dit l'issue.

import { FileSpreadsheet, TriangleAlert } from 'lucide-react'
import { useState } from 'react'
import { Button } from '../components/ui/Button'
import { LiveRegion } from '../components/ui/LiveRegion'
import { t, type CleTraduction } from '../i18n'
import { telecharger } from '../lib/export-csv'

export type FichierPrepare = { readonly nom: string; readonly contenu: string } | { readonly refus: CleTraduction }

export function CommandeExportCsv({
	nomAccessible,
	preparer,
	testId,
}: {
	readonly nomAccessible: string
	readonly preparer: () => Promise<FichierPrepare>
	readonly testId: string
}) {
	const [enCours, setEnCours] = useState(false)
	const [annonce, setAnnonce] = useState('')
	const [refus, setRefus] = useState<CleTraduction | null>(null)

	const exporter = async () => {
		if (enCours) return
		setRefus(null)
		setAnnonce('')
		setEnCours(true)
		const fichier = await preparer()
		setEnCours(false)
		if ('refus' in fichier) {
			setRefus(fichier.refus)
			return
		}
		telecharger(fichier.nom, fichier.contenu)
		setAnnonce(t('export.telecharge', { nom: fichier.nom }))
	}

	return (
		<div className="flex flex-col gap-1 min-w-0">
			<Button
				variante="discret"
				taille="compacte"
				data-testid={testId}
				aria-label={nomAccessible}
				disabled={enCours}
				onClick={() => void exporter()}
				className="self-start"
			>
				<FileSpreadsheet aria-hidden="true" size={16} strokeWidth={2} />
				{t(enCours ? 'export.preparation' : 'export.commande')}
			</Button>
			{refus === null ? null : (
				<p role="alert" data-testid={`${testId}-refus`} className="flex items-start gap-2 rounded-sm bg-danger-soft p-2 text-sm text-danger-on-soft">
					<TriangleAlert aria-hidden="true" size={16} strokeWidth={2} className="shrink-0" />
					{t(refus)}
				</p>
			)}
			<LiveRegion libelle={t('export.live')} message={annonce} />
		</div>
	)
}
