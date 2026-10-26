// @spec CRM-066 (docs/BACKLOG.md) — tranche 4 : le bloc « Santé de l'affaire » de la fiche — les deux scores, leur palier
//       écrit, et leur détail
// @spec docs/SPEC-analytique.md §13.2 (les pénalités), §13.3 (les signaux, le signal inconnu), §13.6 (l'écran) ;
//       docs/DESIGN_SYSTEM.md §5.65 (ce bloc), §5.21 (la forme d'un bloc de colonne gauche), §5.8 (états) ;
//       docs/JOURNAL.md décisions 708 et 724
//
// LE BLOC NE CALCULE RIEN : il lit les deux colonnes calculées de l'affaire et les écrit. Une affaire décidée n'a aucun
// score, et le bloc ne se rend pas — un bloc vide dirait « 0 » là où il n'y a rien à noter.

import { useEffect, useState } from 'react'
import { SkeletonListe } from '../components/ui/Skeleton'
import { PastilleSante } from '../components/ui/PastilleSante'
import { t } from '../i18n'
import { enChargement, type EtatAsync } from '../lib/async'
import {
	CLE_PALIER,
	CLE_PENALITE,
	CLE_SIGNAL,
	lireScoresAffaire,
	type ScoresAffaire,
} from '../lib/sante'
import { clientCrm } from '../lib/supabase'

export function BlocSanteCard({ idCard }: { readonly idCard: string }) {
	const [etat, setEtat] = useState<EtatAsync<ScoresAffaire>>(enChargement)

	useEffect(() => {
		let vivant = true
		setEtat(enChargement())
		void lireScoresAffaire(clientCrm, idCard).then((lu) => {
			if (vivant) setEtat(lu)
		})
		return () => {
			vivant = false
		}
	}, [idCard])

	if (etat.statut === 'chargement') {
		return <SkeletonListe lignes={2} libelle={t('state.loading.aria')} />
	}
	if (etat.statut === 'erreur') {
		// UN REFUS OU UNE PANNE SE DIT, sans masquer la fiche : le bloc est une lecture de plus, pas la fiche.
		return (
			<p role="alert" className="text-sm text-danger" data-testid="bloc-sante-erreur">
				{t('health.error')}
			</p>
		)
	}
	const { dynamique, commerciale } = etat.donnees
	if (dynamique === null && commerciale === null) return null

	return (
		<section aria-labelledby="bloc-sante-titre" className="flex flex-col gap-3" data-testid="bloc-sante">
			<h2 id="bloc-sante-titre" className="text-h3">
				{t('health.title')}
			</h2>
			{dynamique === null ? null : (
				<div className="flex flex-col gap-1" data-testid="sante-dynamique">
					<p className="flex flex-wrap items-center gap-2">
						<PastilleSante libelle={t('health.momentum.short')} score={dynamique.score} palier={dynamique.palier} />
						<span className="text-sm text-text-2">{t(CLE_PALIER[dynamique.palier])}</span>
					</p>
					{dynamique.penalites.length === 0 ? (
						<p className="text-sm text-text-3">{t('health.penalty.none')}</p>
					) : (
						<ul aria-label={t('health.momentum.detail')} className="flex flex-col gap-1">
							{dynamique.penalites.map((penalite) => (
								<li key={penalite.code} className="flex justify-between gap-3 text-sm">
									<span className="text-text-2">
										{CLE_PENALITE[penalite.code] === undefined
											? penalite.code
											: t(CLE_PENALITE[penalite.code]!, {
													jours: String(penalite.jours ?? ''),
													seuil: String(penalite.seuil ?? ''),
												})}
									</span>
									<span className="tabular-nums text-text-2 whitespace-nowrap">−{penalite.points}</span>
								</li>
							))}
						</ul>
					)}
				</div>
			)}
			{commerciale === null ? null : (
				<div className="flex flex-col gap-1" data-testid="sante-commerciale">
					<p className="flex flex-wrap items-center gap-2">
						<PastilleSante
							libelle={t('health.commercial.short')}
							score={commerciale.score}
							palier={commerciale.palier}
						/>
						<span className="text-sm text-text-2">{t(CLE_PALIER[commerciale.palier])}</span>
					</p>
					<ul aria-label={t('health.commercial.detail')} className="flex flex-col gap-1">
						{commerciale.signaux.map((signal) => (
							<li key={signal.code} className="flex justify-between gap-3 text-sm">
								<span className="text-text-2">
									{CLE_SIGNAL[signal.code] === undefined ? signal.code : t(CLE_SIGNAL[signal.code]!)}
								</span>
								{/* `whitespace-nowrap` : à 390 px, « poids 20 % » se coupait et le « % » passait seul à la ligne
								    (défaut vu en capture). Le libellé du signal, lui, se replie. */}
								<span className="tabular-nums text-text-2 whitespace-nowrap">
									{signal.note === null
										? t('health.signal.unknown', { poids: String(signal.poids) })
										: t('health.signal.value', { note: String(signal.note), poids: String(signal.poids) })}
								</span>
							</li>
						))}
					</ul>
				</div>
			)}
		</section>
	)
}
