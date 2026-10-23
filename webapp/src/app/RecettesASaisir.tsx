// @spec CRM-108 (docs/BACKLOG.md) — tranche T3 : l'onglet « À saisir » de l'écran « Rentabilité »
// @spec docs/SPEC-recettes.md §6.4 (les lignes de recette non soldées que l'appelant lit ; `recette_saisissable` rendue
//       par la base ; `Entrée` ajoute le réel du jour et mène à la ligne suivante ; la ligne enregistrée reste en place ;
//       zéro est une valeur, vide n'en est pas une ; ancienneté neutre ; « Toutes les recettes réelles sont saisies. »)
// @spec docs/DESIGN_SYSTEM.md §5.60 (la table du §5.31 bis sans budget ni occurrence), §5.31 (clavier, ligne en place,
//       lecture seule lisible avec son motif), §5.7 ter (mentions sous le champ), §8

import { useRef, useState } from 'react'
import { Link } from 'react-router'
import { SkeletonListe } from '../components/ui/Skeleton'
import { EtatErreur } from '../components/ui/States'
import { t } from '../i18n'
import type { EtatAsync } from '../lib/async'
import { lireMontant } from '../lib/card-costs'
import { adresseAffaireLigne } from '../lib/couts-ecrans'
import {
	ancienneteRecette,
	enregistrerRecetteReelle,
	recetteSaisissable,
	type RecetteASaisir,
	type ResultatSaisieRecette,
} from '../lib/card-revenues'
import { solderLigne } from '../lib/reels-ligne'
import type { ClientCrm } from '../lib/supabase'
import { texteRefusRecette } from './BlocRecettesCard'
import { montantEnClair } from './BlocRentabiliteCard'

type EtatLigne =
	| { readonly statut: 'repos' }
	| { readonly statut: 'envoi' }
	| { readonly statut: 'enregistre'; readonly reel: number }
	| { readonly statut: 'refus'; readonly message: string }

export function RecettesASaisir({
	client,
	lecture,
	onRelire,
	maintenant = new Date(),
}: {
	readonly client: ClientCrm | null
	readonly lecture: EtatAsync<readonly RecetteASaisir[]>
	readonly onRelire: () => void
	readonly maintenant?: Date
}) {
	const champs = useRef(new Map<string, HTMLInputElement>())

	if (lecture.statut === 'chargement') return <SkeletonListe lignes={4} libelle={t('state.loading.aria')} />
	if (lecture.statut === 'erreur') {
		return (
			<EtatErreur
				titre={t('state.error.title')}
				corps={t(lecture.erreur.nature === 'network' ? 'state.error.network' : 'state.error.unknown')}
				libelleReprise={t('state.error.retry')}
				onReprise={onRelire}
			/>
		)
	}
	const lignes = lecture.donnees
	if (lignes.length === 0) {
		return (
			<p data-testid="recettes-a-saisir-vide" className="text-text-2">
				{t('rentab.pending.empty')}
			</p>
		)
	}
	const saisissables = lignes.filter(recetteSaisissable)
	const suivante = (id: string) => {
		const i = saisissables.findIndex((l) => l.id === id)
		const prochaine = saisissables[i + 1]
		if (prochaine !== undefined) champs.current.get(prochaine.id)?.focus()
	}

	return (
		<div className="flex flex-col gap-3 min-w-0">
			{saisissables.length === 0 ? (
				<p role="status" className="rounded-sm border border-border bg-hover px-3 py-2 text-ink">
					{t('rentab.pending.readonly.all')}
				</p>
			) : null}
			<div className="overflow-x-auto indique-debordement-x [contain:paint] rounded-lg border border-border bg-surface">
				<table data-testid="tableau-recettes-a-saisir" className="w-full min-w-[52rem] border-collapse">
					<caption className="sr-only">{t('rentab.pending.caption')}</caption>
					<thead>
						<tr className="border-b border-border text-sm text-text-2">
							<th scope="col" className="sticky top-0 bg-bg h-[var(--size-target)] px-3 text-left font-medium">{t('rentab.pending.column.age')}</th>
							<th scope="col" className="sticky top-0 bg-bg px-3 text-left font-medium">{t('rentab.column.card')}</th>
							<th scope="col" className="sticky top-0 bg-bg px-3 text-left font-medium">{t('card.revenues.column.label.short')}</th>
							<th scope="col" className="sticky top-0 bg-bg px-3 text-right font-medium">{t('rentab.pending.column.estimated')}</th>
							<th scope="col" className="sticky top-0 bg-bg px-3 text-right font-medium">{t('rentab.pending.column.done')}</th>
							<th scope="col" className="sticky top-0 bg-bg px-3 text-right font-medium">{t('rentab.pending.column.add')}</th>
							<th scope="col" className="sticky top-0 bg-bg px-3 text-left font-medium">{t('costs.actuals.settle')}</th>
						</tr>
					</thead>
					<tbody>
						{lignes.map((ligne) => (
							<LigneASaisir
								key={ligne.id}
								client={client}
								ligne={ligne}
								maintenant={maintenant}
								inscrire={(el) => {
									if (el === null) champs.current.delete(ligne.id)
									else champs.current.set(ligne.id, el)
								}}
								onSuivante={() => suivante(ligne.id)}
							/>
						))}
					</tbody>
				</table>
			</div>
			<p className="text-sm text-text-2">{t('rentab.pending.zero')}</p>
		</div>
	)
}

function LigneASaisir({
	client,
	ligne,
	maintenant,
	inscrire,
	onSuivante,
}: {
	readonly client: ClientCrm | null
	readonly ligne: RecetteASaisir
	readonly maintenant: Date
	readonly inscrire: (el: HTMLInputElement | null) => void
	readonly onSuivante: () => void
}) {
	const [valeur, setValeur] = useState('')
	const [etat, setEtat] = useState<EtatLigne>({ statut: 'repos' })
	const [soldee, setSoldee] = useState(false)
	const saisissable = recetteSaisissable(ligne)
	const idMention = `recette-saisir-${ligne.id}-mention`
	const devise = ligne.cards?.currency ?? ''
	const jours = ancienneteRecette(ligne, maintenant)
	const adresse = adresseAffaireLigne(ligne)
	const deja = etat.statut === 'enregistre' ? etat.reel : ligne.actual_amount

	const soumettre = async (suivre: boolean) => {
		if (!saisissable || client === null || soldee || etat.statut === 'envoi') return
		const lu = lireMontant(valeur)
		if (lu.statut === 'absent') {
			if (suivre) onSuivante()
			return
		}
		if (lu.statut === 'invalide') {
			setEtat({ statut: 'refus', message: t('card.costs.form.amount.invalid') })
			return
		}
		setEtat({ statut: 'envoi' })
		const r: ResultatSaisieRecette = await enregistrerRecetteReelle(client, ligne.id, lu.montant)
		if (r.statut === 'applique') {
			setEtat({ statut: 'enregistre', reel: r.reel })
			setValeur('')
			if (suivre) onSuivante()
		} else if (r.statut === 'sans-effet') setEtat({ statut: 'refus', message: t('card.revenues.refus.sans-effet') })
		else setEtat({ statut: 'refus', message: texteRefusRecette(r.refus) })
	}

	// Calculée HORS du littéral `className` : le contrôle des classes lit chaque mot de ce littéral comme une classe, et
	// une comparaison à `'enregistre'` y passerait pour une classe absente (le piège de `CoutsASaisir.tsx`).
	const fondEnregistre = etat.statut === 'enregistre' || soldee ? 'bg-success-soft' : ''
	return (
		<tr data-testid="ligne-recette-a-saisir" className={`border-b border-border align-top ${fondEnregistre}`}>
			<td className="py-2 px-3 text-sm text-text-2 whitespace-nowrap">
				{jours === null ? '' : t(jours <= 1 ? 'rentab.pending.age.one' : 'rentab.pending.age.many', { n: String(jours) })}
			</td>
			<th scope="row" className="py-2 px-3 text-left font-normal max-w-[28ch] truncate" title={ligne.cards?.title ?? ''}>
				{adresse === null ? (ligne.cards?.title ?? '') : (
					<Link to={adresse} className="text-brand hover:underline">
						{ligne.cards?.title}
					</Link>
				)}
			</th>
			<td className="py-2 px-3 max-w-[20ch] truncate" title={ligne.label}>{ligne.label}</td>
			<td className="py-2 px-3 text-right tabular-nums whitespace-nowrap">
				{montantEnClair(ligne.estimated_amount)} <span className="text-sm text-text-2">{devise}</span>
			</td>
			<td className="py-2 px-3 text-right tabular-nums text-text-2 whitespace-nowrap">{deja === null ? '' : montantEnClair(deja)}</td>
			<td className="py-2 px-3 text-right">
				<input
					ref={inscrire}
					data-testid="recette-saisir-champ"
					inputMode="decimal"
					value={valeur}
					disabled={!saisissable || soldee}
					aria-label={t('rentab.pending.input.aria', { nature: ligne.label, affaire: ligne.cards?.title ?? '' })}
					aria-describedby={idMention}
					onChange={(e) => setValeur(e.target.value)}
					onKeyDown={(e) => {
						if (e.key === 'Enter') {
							e.preventDefault()
							void soumettre(true)
						} else if (e.key === 'Escape') setValeur('')
					}}
					onBlur={() => void soumettre(false)}
					className="w-[10ch] min-h-[var(--size-target)] rounded-sm border border-border bg-surface px-2 text-right tabular-nums"
				/>
				<p id={idMention} className="mt-1 text-sm" aria-live="polite">
					{!saisissable ? (
						<span className="text-text-2">{t('card.revenues.refus.forbidden')}</span>
					) : etat.statut === 'envoi' ? (
						<span className="text-text-3">{t('rentab.pending.saving')}</span>
					) : etat.statut === 'enregistre' ? (
						<span className="text-success">{t('rentab.pending.saved')}</span>
					) : etat.statut === 'refus' ? (
						<span role="alert" className="text-danger-on-soft">{etat.message}</span>
					) : null}
				</p>
			</td>
			<td className="py-2 px-3">
				<label className="inline-flex min-h-[44px] items-center gap-2 text-sm">
					<input
						type="checkbox"
						className="size-6 accent-[var(--color-brand)]"
						checked={soldee}
						disabled={!saisissable || client === null}
						aria-label={t('rentab.pending.settle.aria', { nature: ligne.label, affaire: ligne.cards?.title ?? '' })}
						onChange={(e) => {
							const voulu = e.target.checked
							setSoldee(voulu)
							if (client === null) return
							void solderLigne(client, ligne.id, voulu, 'recette').then((r) => {
								if (!r.ok) {
									setSoldee(!voulu)
									setEtat({ statut: 'refus', message: t('card.revenues.refus.forbidden') })
								}
							})
						}}
					/>
					<span aria-hidden="true">{t('costs.actuals.settle')}</span>
				</label>
			</td>
		</tr>
	)
}

