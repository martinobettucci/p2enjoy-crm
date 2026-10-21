// @spec CRM-103 (docs/BACKLOG.md) — tranche T2 : le journal des appels du connecteur, en lecture seule
// @spec docs/SPEC-mcp.md §8.1 (journal filtré par compte et par issue, paginé), §8.2 (`mcp_journal_liste`), §7.1 (issues) ;
//       docs/DESIGN_SYSTEM.md §5.56 (onglet « Connecteur MCP » : issue en MOT, pilule `accent` hors « Réussi », outil en
//       donnée technique, durée suffixée dans son propre élément, filtre `select` à option vide, « Entrées plus
//       anciennes »), §5.9, §5.8
//
// Partagé par la page de l'onglet (tous les comptes, filtre par issue) et par la fiche d'un utilisateur (son seul compte).

import { useCallback, useEffect, useId, useState } from 'react'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { SkeletonListe } from '../components/ui/Skeleton'
import { EtatErreur } from '../components/ui/States'
import { t } from '../i18n'
import { ISSUES_MCP, curseurSuivantMcp, lireJournalMcp, type AppelMcp, type IssueMcp } from '../lib/plateforme'
import type { ClientCrm } from '../lib/supabase'
import { formaterDate, libelleIssue } from './presentation-plateforme'

const CLASSES_ENTETE = 'bg-bg text-sm text-text-2 font-medium h-[var(--size-target)] px-3 text-left whitespace-nowrap'
const CLASSES_CELLULE = 'h-[var(--size-target)] px-3 truncate max-w-[32ch]'
const CLASSES_DROITE = 'h-[var(--size-target)] px-3 text-right tabular-nums whitespace-nowrap'

type EtatJournal =
	| { readonly statut: 'chargement' }
	| { readonly statut: 'erreur' }
	| { readonly statut: 'pret'; readonly appels: readonly AppelMcp[]; readonly suivant: number | null }

export type ProprietesJournalAppelsMcp = {
	readonly client: ClientCrm
	/** Le compte dont on lit les appels ; absent, tous les comptes, et le filtre par issue est offert. */
	readonly sub?: string
	readonly titre: string
}

export function JournalAppelsMcp({ client, sub, titre }: ProprietesJournalAppelsMcp) {
	const id = useId()
	const [issue, setIssue] = useState<IssueMcp | null>(null)
	const [etat, setEtat] = useState<EtatJournal>({ statut: 'chargement' })
	const [tentative, setTentative] = useState(0)
	const [suite, setSuite] = useState<'repos' | 'lecture' | 'echec'>('repos')

	useEffect(() => {
		let vivant = true
		setEtat({ statut: 'chargement' })
		void lireJournalMcp(client, { sub: sub ?? null, issue }).then((page) => {
			if (!vivant) return
			setEtat(page.statut === 'pret' ? { statut: 'pret', appels: page.donnees, suivant: curseurSuivantMcp(page.donnees) } : { statut: 'erreur' })
		})
		return () => {
			vivant = false
		}
	}, [client, sub, issue, tentative])

	const lireSuite = useCallback(async () => {
		if (etat.statut !== 'pret' || etat.suivant === null) return
		setSuite('lecture')
		const page = await lireJournalMcp(client, { sub: sub ?? null, issue, avant: etat.suivant })
		if (page.statut !== 'pret') {
			setSuite('echec')
			return
		}
		setSuite('repos')
		setEtat({ statut: 'pret', appels: [...etat.appels, ...page.donnees], suivant: curseurSuivantMcp(page.donnees) })
	}, [client, sub, issue, etat])

	return (
		<section aria-labelledby={`${id}-titre`} className="flex flex-col gap-4">
			<h2 id={`${id}-titre`} className="text-h2">
				{titre}
			</h2>
			{sub === undefined && (
				<div className="flex flex-col gap-1 max-w-[32ch]">
					<label htmlFor={`${id}-issue`} className="text-sm text-text-2">
						{t('platform.mcp.journal.filtre')}
					</label>
					<select
						id={`${id}-issue`}
						data-testid="filtre-issue"
						value={issue ?? ''}
						onChange={(evenement) => setIssue(evenement.target.value === '' ? null : (evenement.target.value as IssueMcp))}
						className="min-h-[var(--size-target)] rounded-sm border border-border bg-surface px-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
					>
						<option value="">{t('platform.mcp.journal.filtre.toutes')}</option>
						{ISSUES_MCP.map((valeur) => (
							<option key={valeur} value={valeur}>
								{libelleIssue(valeur)}
							</option>
						))}
					</select>
				</div>
			)}
			{etat.statut === 'chargement' && <SkeletonListe lignes={3} libelle={t('state.loading.aria')} />}
			{etat.statut === 'erreur' && (
				<EtatErreur
					titre={t('platform.mcp.journal.erreur.title')}
					corps={t('platform.mcp.journal.erreur.body')}
					libelleReprise={t('state.error.retry')}
					onReprise={() => setTentative((n) => n + 1)}
				/>
			)}
			{etat.statut === 'pret' && etat.appels.length === 0 && (
				<p className="text-text-2" data-testid="journal-appels-vide">
					{issue === null ? t('platform.mcp.journal.vide') : t('platform.mcp.journal.videFiltre')}
				</p>
			)}
			{etat.statut === 'pret' && etat.appels.length > 0 && (
				<>
					<div className="overflow-x-auto indique-debordement-x">
						<table data-testid="tableau-appels" className="w-full border-collapse">
							<caption className="sr-only">{titre}</caption>
							<thead>
								<tr className="border-b border-border">
									<th scope="col" className={`${CLASSES_ENTETE} text-right`}>{t('platform.mcp.journal.colonne.date')}</th>
									{sub === undefined && <th scope="col" className={CLASSES_ENTETE}>{t('platform.mcp.journal.colonne.compte')}</th>}
									<th scope="col" className={CLASSES_ENTETE}>{t('platform.mcp.journal.colonne.outil')}</th>
									<th scope="col" className={CLASSES_ENTETE}>{t('platform.mcp.journal.colonne.espace')}</th>
									<th scope="col" className={CLASSES_ENTETE}>{t('platform.mcp.journal.colonne.issue')}</th>
									<th scope="col" className={`${CLASSES_ENTETE} text-right`}>{t('platform.mcp.journal.colonne.duree')}</th>
								</tr>
							</thead>
							<tbody>
								{etat.appels.map((appel) => (
									<tr key={appel.id} data-testid="ligne-appel" data-issue={appel.issue ?? ''} className="border-b border-border hover:bg-hover">
										<td className={CLASSES_DROITE}>{formaterDate(appel.creeLe)}</td>
										{sub === undefined && <td className={CLASSES_CELLULE} title={appel.nom}>{appel.nom}</td>}
										<td className={CLASSES_CELLULE}>
											<code>{appel.outil}</code>
										</td>
										<td className={CLASSES_CELLULE}>{appel.espaceNom ?? ''}</td>
										<td className="h-[var(--size-target)] px-3 whitespace-nowrap">
											{appel.issue === 'ok' ? libelleIssue(appel.issue) : appel.issue !== null && <Badge ton="accent">{libelleIssue(appel.issue)}</Badge>}
										</td>
										<td className={CLASSES_DROITE}>
											<span>{appel.dureeMs}</span> <span className="text-text-2">{t('platform.mcp.journal.unite')}</span>
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
					{etat.suivant !== null && (
						<div className="flex flex-col items-start gap-2">
							<Button onClick={() => void lireSuite()} disabled={suite === 'lecture'} data-testid="appels-suite">
								{suite === 'lecture' ? t('platform.mcp.journal.suite.lecture') : t('platform.mcp.journal.suite')}
							</Button>
							{suite === 'echec' && (
								<p role="alert" className="text-sm text-danger-on-soft">
									{t('platform.mcp.journal.suite.echec')}
								</p>
							)}
						</div>
					)}
				</>
			)}
		</section>
	)
}
