// @spec CRM-098 (docs/BACKLOG.md) — tranche T3 : la série « Personnel », à côté des coûts existants
// @spec docs/SPEC-temps.md §7.5 (écran de coûts du track : « Coût du personnel » par channel sur le mois choisi ;
//       fiche d'une affaire : « Temps passé » ; ni budgets, ni lignes de coût, ni histogramme ; la portée écrite),
//       §5.1 (un membre ne lit que son temps), §4 (« non valorisé ») ; docs/DESIGN_SYSTEM.md §5.54 (série « Personnel »,
//       portée en 13 px `--color-text-2` au-dessus du chiffre), §5.9 ; décision 621, point 8
//
// LA PORTÉE EST ÉCRITE, ET C'EST LA RÈGLE DU §4.5 DES COÛTS : un total qui ne dit pas ce qu'il compte se lit comme celui
// de l'équipe. Elle suit le rôle que la base rend ; le périmètre lui-même est tenu par la RLS de `saisies_temps`.

import { useEffect, useId, useState } from 'react'
import { SkeletonListe } from '../components/ui/Skeleton'
import { t } from '../i18n'
import { enChargement, type EtatAsync } from '../lib/async'
import {
	TOUTE_LA_DUREE,
	bornesDuMois,
	cumuler,
	idsANommer,
	lireNoms,
	lireTempsValorise,
	parChannel,
	type Cumul,
	type Noms,
} from '../lib/rapport-temps'
import type { ClientCrm } from '../lib/supabase'
import { enJours, jourLocal } from '../lib/temps'
import { useContexteEspace } from './ContexteEspace'
import { CelluleCout, libelleMois } from './RapportTemps'
import { formaterDuree } from './SaisieTemps'

function Portee() {
	const { estAdmin } = useContexteEspace()
	return (
		<p className="text-[13px] text-text-2" data-testid="personnel-portee">
			{estAdmin ? t('personnel.scope.team') : t('personnel.scope.mine')}
		</p>
	)
}

type DonneesTrack = { readonly series: ReturnType<typeof parChannel>; readonly total: Cumul; readonly noms: Noms }

/** Sur l'écran de coûts du track : le coût du personnel du mois choisi, par channel (§7.5). */
export function SeriePersonnelTrack({
	client,
	idTrack,
	aujourdhui = jourLocal(new Date()),
}: {
	readonly client: ClientCrm
	readonly idTrack: string
	readonly aujourdhui?: string
}) {
	const [mois, setMois] = useState(aujourdhui.slice(0, 7))
	const [etat, setEtat] = useState<EtatAsync<DonneesTrack>>(enChargement)
	const idTitre = useId()

	useEffect(() => {
		let courant = true
		setEtat(enChargement)
		void (async () => {
			const { debut, fin } = bornesDuMois(mois)
			const lignes = await lireTempsValorise(client, debut, fin, { track: idTrack })
			if (!courant) return
			if (lignes.statut !== 'pret') return setEtat(lignes)
			const noms = await lireNoms(client, { ...idsANommer(lignes.donnees), cards: [], profils: [] })
			if (!courant) return
			if (noms.statut !== 'pret') return setEtat(noms)
			setEtat({ statut: 'pret', donnees: { series: parChannel(lignes.donnees), total: cumuler(lignes.donnees), noms: noms.donnees } })
		})()
		return () => {
			courant = false
		}
	}, [client, idTrack, mois])

	return (
		<section aria-labelledby={idTitre} className="flex max-w-[960px] flex-col gap-2" data-testid="personnel-track">
			<div className="flex flex-wrap items-end justify-between gap-3">
				<div className="flex flex-col gap-1">
					<h2 id={idTitre} className="text-h3">
						{t('personnel.track.title')}
					</h2>
					<Portee />
				</div>
				<label className="flex flex-col gap-1 text-sm text-text-2">
					{t('time.report.month')}
					<input
						type="month"
						value={mois}
						onChange={(e) => setMois(e.target.value === '' ? aujourdhui.slice(0, 7) : e.target.value)}
						data-testid="personnel-mois"
						className="min-h-[var(--size-target)] rounded-sm border border-border bg-surface px-3 text-text"
					/>
				</label>
			</div>
			{etat.statut === 'chargement' ? (
				<SkeletonListe lignes={3} libelle={t('state.loading.aria')} />
			) : etat.statut === 'erreur' ? (
				<p role="alert" className="text-sm text-danger">
					{t('personnel.error')}
				</p>
			) : etat.donnees.series.length === 0 ? (
				<p className="text-sm text-text-2">{t('personnel.track.empty', { mois: libelleMois(mois) })}</p>
			) : (
				<div className="overflow-x-auto rounded-lg border border-border indique-debordement-x">
					<table className="w-full table-fixed border-collapse text-sm">
						{/* Colonnes FIXES : les sections de « Toute l'équipe » s'alignent d'un tableau à l'autre (constaté sur la
						    capture : chaque tableau calculait ses propres largeurs). */}
						<colgroup>
							<col />
							<col className="w-[14ch]" />
							<col className="w-[28ch]" />
						</colgroup>
						<thead>
							<tr className="border-b border-border">
								<th scope="col" className="px-3 py-2 text-left font-medium">
									{t('personnel.track.channel')}
								</th>
								<th scope="col" className="px-3 py-2 text-right font-medium">
									{t('time.report.time')}
								</th>
								<th scope="col" className="px-3 py-2 text-right font-medium">
									{t('time.report.cost')}
								</th>
							</tr>
						</thead>
						<tbody>
							{etat.donnees.series.map((serie) => (
								<tr key={serie.channel_id ?? 'track'} className="border-b border-border" data-testid="personnel-ligne">
									<th scope="row" className="px-3 py-2 text-left font-normal">
										{serie.channel_id === null
											? t('personnel.track.direct')
											: (etat.donnees.noms.channels.get(serie.channel_id) ?? t('time.report.unnamed'))}
									</th>
									<td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{formaterDuree(enJours(serie.cumul.minutes))}</td>
									<td className="px-3 py-2 text-right tabular-nums">
										<CelluleCout cumul={serie.cumul} />
									</td>
								</tr>
							))}
						</tbody>
						<tfoot>
							<tr>
								<th scope="row" className="px-3 py-2 text-left font-medium">
									{t('time.report.total')}
								</th>
								<td className="whitespace-nowrap px-3 py-2 text-right font-medium tabular-nums" data-testid="personnel-total">
									{formaterDuree(enJours(etat.donnees.total.minutes))}
								</td>
								<td className="px-3 py-2 text-right font-medium tabular-nums">
									<CelluleCout cumul={etat.donnees.total} />
								</td>
							</tr>
						</tfoot>
					</table>
				</div>
			)}
		</section>
	)
}

/** Dans la fiche d'une affaire : le temps passé depuis le premier jour, et son coût (§7.5). */
export function BlocTempsCard({ client, idCard }: { readonly client: ClientCrm | null; readonly idCard: string }) {
	const [etat, setEtat] = useState<EtatAsync<Cumul>>(enChargement)
	const idTitre = useId()

	useEffect(() => {
		if (client === null) return
		let courant = true
		setEtat(enChargement)
		void lireTempsValorise(client, TOUTE_LA_DUREE.debut, TOUTE_LA_DUREE.fin, { affaire: idCard }).then((lignes) => {
			if (!courant) return
			setEtat(lignes.statut === 'pret' ? { statut: 'pret', donnees: cumuler(lignes.donnees) } : lignes)
		})
		return () => {
			courant = false
		}
	}, [client, idCard])

	return (
		<section aria-labelledby={idTitre} className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4" data-testid="temps-card">
			<h2 id={idTitre} className="text-h3">
				{t('personnel.card.title')}
			</h2>
			<Portee />
			{etat.statut === 'chargement' ? (
				<SkeletonListe lignes={1} libelle={t('state.loading.aria')} />
			) : etat.statut === 'erreur' ? (
				<p role="alert" className="text-sm text-danger">
					{t('personnel.error')}
				</p>
			) : etat.donnees.minutes === 0 ? (
				<p className="text-sm text-text-2">{t('personnel.card.empty')}</p>
			) : (
				<dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
					<dt className="text-text-2">{t('time.report.time')}</dt>
					<dd className="tabular-nums" data-testid="temps-card-duree">
						{formaterDuree(enJours(etat.donnees.minutes))}
					</dd>
					<dt className="text-text-2">{t('time.report.cost')}</dt>
					<dd className="tabular-nums">
						<CelluleCout cumul={etat.donnees} />
					</dd>
				</dl>
			)}
		</section>
	)
}
