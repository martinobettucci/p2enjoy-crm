// @spec CRM-072 (docs/BACKLOG.md) — tranche T2 : Réglages ▸ Journal d'audit, la lecture du journal de l'espace
// @spec docs/SPEC-audit.md §3.2 (lu par les administrateurs de l'espace, sous la RLS), §7.3 (le nom d'un contact lu à
//       l'affichage), §8 (filtres dans l'adresse, pagination de 50, états) ; docs/DESIGN_SYSTEM.md §5.66 (l'écran), §5.56
//       (le journal de la plateforme, dont il reprend la forme), §5.48 bis (filtres en tête, entrée d'historique
//       remplacée), §5.29 tranche 2 c (la relecture garde ce qu'elle a lu), §5.8 (états), §5.9 (tableau) ;
//       docs/JOURNAL.md décisions 725 à 728
// @spec CLAUDE.md §10 — l'écran ne décide aucun droit : refusée par la base, la capacité d'administrer ferme l'écran avant
//       toute lecture ; inconnue, la RLS reste seule juge et rend zéro ligne à qui n'administre pas
//
// L'ÉCRAN NE CALCULE RIEN DE CE QUE LE JOURNAL DIT : il rend ce que la base a inscrit, phrase par phrase.

import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'
import { Button } from '../components/ui/Button'
import { SkeletonListe } from '../components/ui/Skeleton'
import { EtatErreur, EtatRefus, EtatVide } from '../components/ui/States'
import { t } from '../i18n'
import type { NatureErreur } from '../lib/async'
import {
	ACTEUR_SYSTEME,
	contactsDe,
	curseurSuivantAudit,
	ecrireFiltres,
	FAMILLES_AUDIT,
	lireFiltres,
	lireJournalAudit,
	lireNomsContacts,
	type EntreeAudit,
	type FamilleAudit,
	type FiltresAudit,
} from '../lib/audit'
import { lireMembresEspace, type MembreEspace } from '../lib/membres-espace'
import { clientCrm, type ClientCrm } from '../lib/supabase'
import { useContexteEspace } from './ContexteEspace'
import { CLES_FAMILLE, detailAudit, libelleActeurAudit, libelleGesteAudit } from './presentation-audit'
import { formaterDate } from './presentation-plateforme'

const CLASSES_ENTETE = 'bg-bg text-sm text-text-2 font-medium h-[var(--size-target)] px-3 text-left whitespace-nowrap'
const CLASSES_CELLULE = 'h-[var(--size-target)] px-3 truncate max-w-[32ch]'
const CLASSES_CHAMP = 'min-h-[var(--size-target)] rounded-sm border border-border bg-surface px-3 text-text'
const CLASSES_LIBELLE = 'flex w-full flex-col gap-1 text-sm text-text-2 md:w-auto'

type Lecture =
	| { readonly statut: 'chargement' }
	| { readonly statut: 'erreur'; readonly nature: NatureErreur }
	| {
			readonly statut: 'pret'
			readonly entrees: readonly EntreeAudit[]
			readonly suivant: number | null
			readonly noms: ReadonlyMap<string, string>
			/** Les filtres que cette lecture a appliqués : une relecture en vol les distingue de ceux de l'adresse. */
			readonly cle: string
	  }

export type ProprietesReglagesJournal = { readonly client?: ClientCrm | null }

export function ReglagesJournal({ client = clientCrm }: ProprietesReglagesJournal = {}) {
	const { idWorkspace, capacites } = useContexteEspace()
	const administration = capacites.administration
	const [parametres, setParametres] = useSearchParams()
	const filtres = lireFiltres(parametres)
	const cle = ecrireFiltres(filtres).toString()
	const [lecture, setLecture] = useState<Lecture>({ statut: 'chargement' })
	const [tentative, setTentative] = useState(0)
	const [suite, setSuite] = useState<'repos' | 'lecture' | 'echec'>('repos')
	const [membres, setMembres] = useState<readonly MembreEspace[]>([])
	const rang = useRef(0)
	// Tant que la capacité se lit, rien ne part : un non-administrateur recevrait zéro ligne et lirait « aucun geste »,
	// ce qui ferait passer un refus pour un journal vide (§5.48).
	const enAttente = administration === 'en-lecture'

	useEffect(() => {
		if (client === null || idWorkspace === null || enAttente || administration === 'refusee') return
		const r = ++rang.current
		setSuite('repos')
		void (async () => {
			const page = await lireJournalAudit(client, idWorkspace, filtres, null)
			if (r !== rang.current) return
			if (page.statut === 'erreur') return setLecture({ statut: 'erreur', nature: page.erreur.nature })
			if (page.statut !== 'pret') return
			const noms = await lireNomsContacts(client, contactsDe(page.donnees))
			if (r !== rang.current) return
			setLecture({ statut: 'pret', entrees: page.donnees, suivant: curseurSuivantAudit(page.donnees), noms, cle })
		})()
		// `filtres` est dérivé de `cle`, qui le résume entièrement.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [client, idWorkspace, cle, tentative, administration, enAttente])

	useEffect(() => {
		if (client === null || idWorkspace === null || administration === 'refusee') return
		let vivant = true
		void lireMembresEspace(client, idWorkspace).then((lu) => {
			if (vivant && lu.statut === 'pret') setMembres(lu.donnees)
		})
		return () => {
			vivant = false
		}
	}, [client, idWorkspace, administration])

	const changer = (suivants: FiltresAudit) => {
		// Le choix remplace l'entrée d'historique, il n'en empile pas (§5.48 bis).
		setParametres(ecrireFiltres(suivants), { replace: true })
	}

	const lireSuite = async () => {
		if (client === null || idWorkspace === null || lecture.statut !== 'pret' || lecture.suivant === null) return
		setSuite('lecture')
		const page = await lireJournalAudit(client, idWorkspace, filtres, lecture.suivant)
		if (page.statut !== 'pret') {
			setSuite('echec')
			return
		}
		const noms = await lireNomsContacts(client, contactsDe(page.donnees))
		setSuite('repos')
		setLecture({
			...lecture,
			entrees: [...lecture.entrees, ...page.donnees],
			suivant: curseurSuivantAudit(page.donnees),
			noms: new Map([...lecture.noms, ...noms]),
		})
	}

	if (client === null || idWorkspace === null) {
		return <EtatVide titre={t('time.noworkspace.title')} corps={t('audit.noworkspace.body')} />
	}
	if (administration === 'refusee' || (lecture.statut === 'erreur' && lecture.nature === 'forbidden')) {
		return <EtatRefus titre={t('audit.forbidden.title')} corps={t('audit.forbidden.body')} />
	}

	const relecture = lecture.statut === 'pret' && lecture.cle !== cle

	return (
		<div className="flex max-w-[1200px] min-w-0 flex-col gap-4" data-testid="journal-audit">
			<h2 className="text-h3">{t('audit.title')}</h2>
			<p className="max-w-[72ch] text-sm text-text-2">{t('audit.intro')}</p>
			<Filtres filtres={filtres} membres={membres} changer={changer} />
			{lecture.statut === 'chargement' || enAttente ? (
				<SkeletonListe lignes={5} libelle={t('state.loading.aria')} />
			) : lecture.statut === 'erreur' ? (
				<EtatErreur
					titre={t('audit.error.title')}
					corps={t(lecture.nature === 'network' ? 'state.error.network' : 'state.error.unknown')}
					libelleReprise={t('state.error.retry')}
					onReprise={() => setTentative((n) => n + 1)}
				/>
			) : lecture.entrees.length === 0 ? (
				<div aria-busy={relecture}>
					<EtatVide titre={t('audit.empty.title')} corps={t('audit.empty.body')} />
				</div>
			) : (
				<>
					<div className="overflow-x-auto indique-debordement-x" aria-busy={relecture}>
						<table data-testid="tableau-audit" className="w-full border-collapse">
							<caption className="sr-only">{t('audit.title')}</caption>
							<thead>
								<tr className="border-b border-border">
									<th scope="col" className={`${CLASSES_ENTETE} text-right`}>{t('audit.column.date')}</th>
									<th scope="col" className={CLASSES_ENTETE}>{t('audit.column.actor')}</th>
									<th scope="col" className={CLASSES_ENTETE}>{t('audit.column.geste')}</th>
									<th scope="col" className={CLASSES_ENTETE}>{t('audit.column.detail')}</th>
								</tr>
							</thead>
							<tbody>
								{lecture.entrees.map((entree) => {
									const geste = libelleGesteAudit(entree, lecture.noms)
									const detail = detailAudit(entree)
									return (
										<tr
											key={entree.id}
											data-testid="ligne-audit"
											data-famille={entree.famille ?? ''}
											data-geste={`${entree.objet}.${entree.action}`}
											className="border-b border-border hover:bg-hover"
										>
											<td className="h-[var(--size-target)] px-3 text-right tabular-nums whitespace-nowrap">
												{formaterDate(entree.date)}
											</td>
											<td className={CLASSES_CELLULE} title={libelleActeurAudit(entree)}>
												{libelleActeurAudit(entree)}
											</td>
											<td className={`${CLASSES_CELLULE} max-w-[48ch]`} title={geste}>
												{geste}
											</td>
											<td className={`${CLASSES_CELLULE} max-w-[48ch]`} title={detail}>
												{detail}
											</td>
										</tr>
									)
								})}
							</tbody>
						</table>
					</div>
					{lecture.suivant !== null && (
						<div className="flex flex-col items-start gap-2">
							<Button variante="secondaire" onClick={() => void lireSuite()} disabled={suite === 'lecture'} data-testid="audit-suite">
								{suite === 'lecture' ? t('audit.more.loading') : t('audit.more')}
							</Button>
							{suite === 'echec' && (
								<p role="alert" className="text-sm text-danger-on-soft">
									{t('audit.more.failed')}
								</p>
							)}
						</div>
					)}
				</>
			)}
		</div>
	)
}

/** La ligne des filtres, rendue en toute circonstance — elle est la cause possible d'un vide (§5.3 quinquies). */
function Filtres({
	filtres,
	membres,
	changer,
}: {
	readonly filtres: FiltresAudit
	readonly membres: readonly MembreEspace[]
	readonly changer: (suivants: FiltresAudit) => void
}) {
	return (
		<div role="group" aria-label={t('audit.filters.aria')} className="flex flex-wrap items-end gap-3" data-testid="audit-filtres">
			<label className={CLASSES_LIBELLE}>
				{t('audit.filter.family')}
				<select
					value={filtres.famille ?? ''}
					onChange={(e) =>
						changer({ ...filtres, famille: e.target.value === '' ? null : (e.target.value as FamilleAudit) })
					}
					className={CLASSES_CHAMP}
				>
					<option value="">{t('audit.filter.family.all')}</option>
					{FAMILLES_AUDIT.map((famille) => (
						<option key={famille} value={famille}>
							{t(CLES_FAMILLE[famille])}
						</option>
					))}
				</select>
			</label>
			<label className={CLASSES_LIBELLE}>
				{t('audit.filter.actor')}
				<select
					value={filtres.acteur ?? ''}
					onChange={(e) => changer({ ...filtres, acteur: e.target.value === '' ? null : e.target.value })}
					className={CLASSES_CHAMP}
				>
					<option value="">{t('audit.filter.actor.all')}</option>
					{membres.map((membre) => (
						<option key={membre.idUtilisateur} value={membre.idUtilisateur}>
							{membre.nom ?? t('platform.journal.acteurSupprime')}
						</option>
					))}
					<option value={ACTEUR_SYSTEME}>{t('audit.acteur.systeme')}</option>
				</select>
			</label>
			<label className={CLASSES_LIBELLE}>
				{t('audit.filter.from')}
				<input
					type="date"
					value={filtres.du ?? ''}
					onChange={(e) => changer({ ...filtres, du: e.target.value === '' ? null : e.target.value })}
					className={CLASSES_CHAMP}
				/>
			</label>
			<label className={CLASSES_LIBELLE}>
				{t('audit.filter.to')}
				<input
					type="date"
					value={filtres.au ?? ''}
					onChange={(e) => changer({ ...filtres, au: e.target.value === '' ? null : e.target.value })}
					className={CLASSES_CHAMP}
				/>
			</label>
		</div>
	)
}
