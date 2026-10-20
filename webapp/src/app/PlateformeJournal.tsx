// @spec CRM-101 (docs/BACKLOG.md) — tranche T3 : le journal de la plateforme, en lecture seule
// @spec docs/SPEC-plateforme.md §5.2 (gestes), §6.5 (`plateforme_journal_liste`, curseur) ; docs/DESIGN_SYSTEM.md §5.56
//       (geste en MOT, détail par clé, « Entrées plus anciennes »), §5.9, §5.29 tranche 2 c (la relecture garde ce
//       qu'elle a lu), §5.8

import { useCallback, useEffect, useState } from 'react'
import { Button } from '../components/ui/Button'
import { SkeletonListe } from '../components/ui/Skeleton'
import { EtatErreur, EtatVide } from '../components/ui/States'
import { t } from '../i18n'
import { curseurSuivant, lireJournal, type EntreeJournal } from '../lib/plateforme'
import type { ClientCrm } from '../lib/supabase'
import { detailJournal, formaterDate, libelleActeur, libelleGeste } from './presentation-plateforme'

const CLASSES_ENTETE = 'bg-bg text-sm text-text-2 font-medium h-[var(--size-target)] px-3 text-left whitespace-nowrap'
const CLASSES_CELLULE = 'h-[var(--size-target)] px-3 truncate max-w-[32ch]'

type EtatJournal =
	| { readonly statut: 'chargement' }
	| { readonly statut: 'erreur' }
	| { readonly statut: 'pret'; readonly entrees: readonly EntreeJournal[]; readonly suivant: number | null }

export function PlateformeJournal({ client }: { readonly client: ClientCrm }) {
	const [etat, setEtat] = useState<EtatJournal>({ statut: 'chargement' })
	const [tentative, setTentative] = useState(0)
	const [suite, setSuite] = useState<'repos' | 'lecture' | 'echec'>('repos')

	useEffect(() => {
		let vivant = true
		void lireJournal(client, null).then((page) => {
			if (!vivant) return
			setEtat(page.statut === 'pret' ? { statut: 'pret', entrees: page.donnees, suivant: curseurSuivant(page.donnees) } : { statut: 'erreur' })
		})
		return () => {
			vivant = false
		}
	}, [client, tentative])

	const lireSuite = useCallback(async () => {
		if (etat.statut !== 'pret' || etat.suivant === null) return
		setSuite('lecture')
		const page = await lireJournal(client, etat.suivant)
		if (page.statut !== 'pret') {
			setSuite('echec')
			return
		}
		setSuite('repos')
		setEtat({ statut: 'pret', entrees: [...etat.entrees, ...page.donnees], suivant: curseurSuivant(page.donnees) })
	}, [client, etat])

	if (etat.statut === 'chargement') return <SkeletonListe lignes={5} libelle={t('state.loading.aria')} />
	if (etat.statut === 'erreur') {
		return (
			<EtatErreur
				titre={t('platform.journal.erreur.title')}
				corps={t('platform.journal.erreur.body')}
				libelleReprise={t('state.error.retry')}
				onReprise={() => setTentative((n) => n + 1)}
			/>
		)
	}
	if (etat.entrees.length === 0) {
		return <EtatVide titre={t('platform.journal.vide.title')} corps={t('platform.journal.vide.body')} />
	}

	return (
		<section aria-labelledby="titre-journal" className="flex flex-col gap-4">
			<h2 id="titre-journal" className="text-h2">
				{t('platform.journal.titre')}
			</h2>
			<div className="overflow-x-auto indique-debordement-x">
				<table data-testid="tableau-journal" className="w-full border-collapse">
					<caption className="sr-only">{t('platform.journal.titre')}</caption>
					<thead>
						<tr className="border-b border-border">
							<th scope="col" className={`${CLASSES_ENTETE} text-right`}>{t('platform.journal.colonne.date')}</th>
							<th scope="col" className={CLASSES_ENTETE}>{t('platform.journal.colonne.acteur')}</th>
							<th scope="col" className={CLASSES_ENTETE}>{t('platform.journal.colonne.geste')}</th>
							<th scope="col" className={CLASSES_ENTETE}>{t('platform.journal.colonne.detail')}</th>
						</tr>
					</thead>
					<tbody>
						{etat.entrees.map((entree) => {
							const detail = detailJournal(entree)
							return (
								<tr key={entree.id} data-testid="ligne-journal" data-geste={entree.geste ?? ''} className="border-b border-border hover:bg-hover">
									<td className="h-[var(--size-target)] px-3 text-right tabular-nums whitespace-nowrap">{formaterDate(entree.creeLe)}</td>
									<td className={CLASSES_CELLULE}>{libelleActeur(entree)}</td>
									<td className={CLASSES_CELLULE}>{libelleGeste(entree.geste)}</td>
									<td className={`${CLASSES_CELLULE} max-w-[48ch]`} title={detail}>
										{detail}
									</td>
								</tr>
							)
						})}
					</tbody>
				</table>
			</div>
			{etat.suivant !== null && (
				<div className="flex flex-col items-start gap-2">
					<Button onClick={() => void lireSuite()} disabled={suite === 'lecture'} data-testid="journal-suite">
						{suite === 'lecture' ? t('platform.journal.suite.lecture') : t('platform.journal.suite')}
					</Button>
					{suite === 'echec' && (
						<p role="alert" className="text-sm text-danger-on-soft">
							{t('platform.journal.suite.echec')}
						</p>
					)}
				</div>
			)}
		</section>
	)
}
