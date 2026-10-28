// @spec CRM-069 (docs/BACKLOG.md) — tranche T2 : « Étiquettes » sur la fiche d'une affaire — la commande et son panneau
// @spec docs/DESIGN_SYSTEM.md §5.73 (la commande dans la rangée de « Mettre en sommeil », icône `Tags`, la capacité
//       d'écrire l'affaire ; le panneau dans le flux, une case par étiquette, écrite au clic et revenue si la base refuse ;
//       le catalogue vide), §5.3 quater, §5.31 bis, §5.59 ; docs/SPEC-etiquettes-digest.md §2.2, §3
//
// LA COMMANDE ET LE PANNEAU VIVENT EN DEUX PLACES de l'en-tête, comme « Enregistrer comme modèle » (`EnregistrerModele.tsx`) :
// l'état qui les relie appartient à l'en-tête (`EnTeteCard.tsx`).

import { Tags, TriangleAlert } from 'lucide-react'
import { forwardRef, useEffect, useId, useRef, useState } from 'react'
import { Link } from 'react-router'
import { Button } from '../components/ui/Button'
import { PastilleEtiquette } from '../components/ui/PastilleEtiquette'
import { useRefus } from '../components/ui/RefusCommandes'
import { t, type CleTraduction } from '../i18n'
import { enChargement, type EtatAsync } from '../lib/async'
import {
	basculerEtiquetteAffaire,
	lireEtiquettes,
	type Etiquette,
	type NatureRefusEtiquette,
} from '../lib/etiquettes'
import type { ClientCrm } from '../lib/supabase'
import { CHEMIN_ADMIN_ETIQUETTES } from './chemins'
import { useContexteEspace } from './ContexteEspace'

const CLE_COMMANDE: CleTraduction = 'card.labels.open'

/** La commande, secondaire compacte (§5.73). Elle suit la capacité d'écrire l'affaire : le refus de la fiche l'éteint. */
export const CommandeEtiquettes = forwardRef<HTMLButtonElement, { readonly onOuvrir: () => void }>(function CommandeEtiquettes(
	{ onOuvrir },
	ref,
) {
	const droit = useRefus()
	return (
		<Button {...droit}
			ref={ref}
			taille="compacte"
			variante="secondaire"
			aria-expanded={false}
			data-testid="entete-card-etiquettes"
			onClick={onOuvrir}
		>
			<Tags aria-hidden="true" size={16} strokeWidth={2} />
			{t(CLE_COMMANDE)}
		</Button>
	)
})

const CLES_REFUS: Readonly<Record<NatureRefusEtiquette, CleTraduction>> = {
	archivee: 'card.labels.refus.archivee',
	forbidden: 'card.labels.refus.forbidden',
	'sans-effet': 'card.labels.refus.forbidden',
	'nom-pris': 'card.labels.refus.panne',
	forme: 'card.labels.refus.panne',
	network: 'card.labels.refus.panne',
	unknown: 'card.labels.refus.panne',
}

/**
 * Le panneau, dans le flux sous l'en-tête (§5.3 quater) : une case par étiquette du catalogue, puis les archivées encore
 * posées, qui se décochent seulement. Chaque case écrit au clic ; refusée, elle revient, et le refus s'écrit dessous.
 */
export function PanneauEtiquettes({
	client,
	idCard,
	etiquettes,
	onChange,
	onFermer,
}: {
	readonly client: ClientCrm
	readonly idCard: string
	/** Les étiquettes posées sur l'affaire. */
	readonly etiquettes: readonly Etiquette[]
	readonly onChange: (etiquettes: readonly Etiquette[]) => void
	readonly onFermer: () => void
}) {
	const droit = useRefus()
	const { capacites } = useContexteEspace()
	const idLegende = useId()
	const [catalogue, setCatalogue] = useState<EtatAsync<readonly Etiquette[]>>(enChargement)
	const [enVol, setEnVol] = useState<string | null>(null)
	const [refus, setRefus] = useState<{ readonly id: string; readonly nature: NatureRefusEtiquette } | null>(null)
	const premiere = useRef<HTMLInputElement | null>(null)
	const fermer = useRef<HTMLButtonElement | null>(null)

	useEffect(() => {
		let actif = true
		void lireEtiquettes(client).then((lu) => {
			if (actif) setCatalogue(lu)
		})
		return () => {
			actif = false
		}
	}, [client])

	// Le focus entre dans la première case, une fois le catalogue lu (§5.13). Sans case — catalogue vide ou illisible —, il
	// va à « Fermer » : laissé sur le document, `Échap` ne refermait plus le panneau (trouvé par la preuve unitaire).
	useEffect(() => {
		if (catalogue.statut === 'chargement') return
		;(premiere.current ?? fermer.current)?.focus()
	}, [catalogue.statut])

	const posees = new Set(etiquettes.map((e) => e.id))
	const proposees =
		catalogue.statut === 'pret'
			? [...catalogue.donnees, ...etiquettes.filter((e) => e.archivee && !catalogue.donnees.some((c) => c.id === e.id))]
			: []

	const basculer = async (etiquette: Etiquette, posee: boolean) => {
		setRefus(null)
		setEnVol(etiquette.id)
		const issue = await basculerEtiquetteAffaire(client, idCard, etiquette.id, posee)
		setEnVol(null)
		if (issue.statut === 'refus') {
			setRefus({ id: etiquette.id, nature: issue.nature })
			return
		}
		onChange(
			posee
				? [...etiquettes, etiquette].sort((a, b) => a.nom.localeCompare(b.nom, 'fr', { sensitivity: 'base' }))
				: etiquettes.filter((e) => e.id !== etiquette.id),
		)
	}

	const administrer = capacites.administration !== 'refusee' && capacites.administration !== 'en-lecture'

	return (
		<fieldset
			data-testid="entete-card-panneau-etiquettes"
			aria-labelledby={idLegende}
			className="flex flex-col gap-2 rounded-lg border border-border p-3"
			onKeyDown={(evenement) => {
				if (evenement.key !== 'Escape') return
				evenement.stopPropagation()
				onFermer()
			}}
		>
			<legend id={idLegende} className="text-sm text-text-2">
				{t('card.labels.legend')}
			</legend>
			{catalogue.statut === 'chargement' ? (
				<p className="text-sm text-text-3">{t('card.labels.loading')}</p>
			) : catalogue.statut === 'erreur' ? (
				<p className="text-sm text-text-2">{t('card.labels.error')}</p>
			) : proposees.length === 0 ? (
				<p className="flex flex-wrap items-center gap-2 text-sm text-text-2" data-testid="etiquettes-catalogue-vide">
					{t('card.labels.empty')}
					{administrer ? (
						<Link to={CHEMIN_ADMIN_ETIQUETTES} className="text-brand underline">
							{t('card.labels.empty.link')}
						</Link>
					) : null}
				</p>
			) : (
				<ul className="flex flex-col gap-1">
					{proposees.map((etiquette, rang) => {
						const cochee = posees.has(etiquette.id)
						const idCase = `${idLegende}-${etiquette.id}`
						const idRefus = `${idCase}-refus`
						const refusee = refus?.id === etiquette.id
						return (
							<li key={etiquette.id} className="flex flex-col gap-1">
								<label htmlFor={idCase} className="flex min-h-[var(--size-target)] items-center gap-3">
									<input
										id={idCase}
										ref={rang === 0 ? premiere : undefined}
										type="checkbox"
										data-testid="case-etiquette"
										checked={cochee}
										// Une archivée encore posée se décoche seulement : elle ne se pose plus (§5.73).
										disabled={droit.disabled === true || enVol === etiquette.id || (etiquette.archivee && !cochee)}
										{...(refusee ? { 'aria-describedby': idRefus } : droit['aria-describedby'] === undefined ? {} : { 'aria-describedby': droit['aria-describedby'] })}
										onChange={(evenement) => void basculer(etiquette, evenement.currentTarget.checked)}
										className="size-6 shrink-0 accent-[var(--color-brand)]"
									/>
									<PastilleEtiquette etiquette={etiquette} />
								</label>
								{refusee ? (
									<p id={idRefus} role="alert" className="flex items-start gap-2 rounded-sm bg-danger-soft p-2 text-sm text-danger-on-soft">
										<TriangleAlert aria-hidden="true" size={16} strokeWidth={2} className="mt-1 shrink-0" />
										{t(CLES_REFUS[refus.nature])}
									</p>
								) : null}
							</li>
						)
					})}
				</ul>
			)}
			<div>
				<Button ref={fermer} variante="secondaire" taille="compacte" data-testid="entete-card-etiquettes-fermer" onClick={onFermer}>
					{t('card.labels.close')}
				</Button>
			</div>
		</fieldset>
	)
}
