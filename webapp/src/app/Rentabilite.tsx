// @spec CRM-108 (docs/BACKLOG.md) — tranche T3 : l'écran « Rentabilité » et son onglet « Vue d'ensemble »
// @spec docs/SPEC-recettes.md §4.5 (période sur les réels), §4.6 (filtre d'état, toutes par défaut), §6.0 (adresse et
//       chaîne de requête : `onglet`, `du`, `au`, `etat`, `vue`), §6.3 (le rapport : un tableau par devise, track ›
//       channel › affaire, sous-totaux et total, mentions, portée ; « Réservé aux administrateurs » sur `42501`), §6.5
// @spec docs/DESIGN_SYSTEM.md §5.60 (filtres en tête, paire de liens « Réel » / « Prévu », arborescence du §5.54,
//       sous-totaux en `font-medium`, devise nommée dans les en-têtes, mentions du §5.30), §5.31 (onglets), §5.8, §7, §8
//
// Deux lectures sous le jeton de l'appelant : les sommes (`rentabilite_affaires`) puis les noms. La règle est dans
// `lib/rentabilite.ts`. Un changement de période ou d'état relit ; un changement de vue ne relit rien.

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router'
import { SkeletonListe } from '../components/ui/Skeleton'
import { EtatErreur, EtatRefus, EtatVide } from '../components/ui/States'
import { t, type CleTraduction } from '../i18n'
import { enChargement, type EtatAsync } from '../lib/async'
import {
	construireRapport,
	ETATS_RAPPORT,
	lireEtatRapport,
	lireVueRapport,
	type AffaireDuRapport,
	type EtatRapport,
	type LigneRentabilite,
	type Noms,
	type Rentabilite as R,
	type TableauDevise,
	type VueRentabilite,
} from '../lib/rentabilite'
import { lireNomsRentabilite, lireRentabilite } from '../lib/rentabilite-lecture'
import { lireRecettesASaisir, type RecetteASaisir } from '../lib/card-revenues'
import { clientCrm, type ClientCrm } from '../lib/supabase'
import { CLASSES_ACTIF, CLASSES_INACTIF, CLASSES_ONGLET } from './OngletsCouts'
import { dureeEnClair, Marge, montantEnClair } from './BlocRentabiliteCard'
import { RecettesASaisir } from './RecettesASaisir'
import { CHEMIN_RENTABILITE } from './chemins'
import { useContexteEspace } from './ContexteEspace'
import type { Capacite } from '../lib/capacites'

const CLE_ONGLET = 'onglet'
const DATE_ISO = /^\d{4}-\d{2}-\d{2}$/
const lireDate = (v: string | null): string | null => (v !== null && DATE_ISO.test(v) ? v : null)

const CLES_ETAT: Readonly<Record<EtatRapport, CleTraduction>> = {
	toutes: 'rentab.filter.state.all',
	gagnees: 'rentab.filter.state.won',
	'en-cours': 'rentab.filter.state.open',
	perdues: 'rentab.filter.state.lost',
}
const CLES_GENRE = { open: 'rentab.kind.open', won: 'rentab.kind.won', lost: 'rentab.kind.lost' } as const

type LectureRapport =
	| { readonly statut: 'chargement' }
	| { readonly statut: 'refusee' }
	| { readonly statut: 'erreur'; readonly nature: string }
	| { readonly statut: 'pret'; readonly lignes: readonly LigneRentabilite[]; readonly noms: Noms; readonly cle: string }

export function Rentabilite({
	client = clientCrm,
	administration,
}: {
	readonly client?: ClientCrm | null
	/** Pour une preuve hors coquille : la capacité d'administrer, sinon celle que la coquille a lue. */
	readonly administration?: Capacite
} = {}) {
	const [parametres, setParametres] = useSearchParams()
	const onglet = parametres.get(CLE_ONGLET) === 'saisir' ? 'saisir' : 'ensemble'
	const [aSaisir, setASaisir] = useState<EtatAsync<readonly RecetteASaisir[]>>(enChargement)
	const [tentativeSaisir, setTentativeSaisir] = useState(0)

	useEffect(() => {
		if (client === null) return
		let actif = true
		void lireRecettesASaisir(client).then((lu) => {
			if (actif) setASaisir(lu)
		})
		return () => {
			actif = false
		}
	}, [client, tentativeSaisir])

	const vers = (o: 'ensemble' | 'saisir') => {
		const p = new URLSearchParams(parametres)
		if (o === 'saisir') p.set(CLE_ONGLET, 'saisir')
		else p.delete(CLE_ONGLET)
		const s = p.toString()
		return `${CHEMIN_RENTABILITE}${s === '' ? '' : `?${s}`}`
	}
	const compte = aSaisir.statut === 'pret' ? aSaisir.donnees.length : null
	// Sans client, aucune lecture ne partira : un squelette perpétuel serait une page blanche déguisée (§5.8).
	if (client === null) return <EtatVide titre={t('rentab.noworkspace.title')} corps={t('rentab.noworkspace.body')} />

	return (
		<div className="mx-auto flex w-full max-w-[104rem] flex-col gap-4 px-4 py-6 min-w-0">
			<nav aria-label={t('rentab.tabs.aria')} className="flex items-center gap-1 border-b border-border overflow-x-auto indique-debordement-x">
				<Link
					to={vers('ensemble')}
					data-testid="onglet-rentab-ensemble"
					{...(onglet === 'ensemble' ? { 'aria-current': 'page' as const } : {})}
					className={`${CLASSES_ONGLET} ${onglet === 'ensemble' ? CLASSES_ACTIF : CLASSES_INACTIF}`}
				>
					{t('rentab.tabs.overview')}
				</Link>
				<Link
					to={vers('saisir')}
					data-testid="onglet-rentab-saisir"
					{...(onglet === 'saisir' ? { 'aria-current': 'page' as const } : {})}
					className={`${CLASSES_ONGLET} ${onglet === 'saisir' ? CLASSES_ACTIF : CLASSES_INACTIF}`}
				>
					{t('rentab.tabs.pending')}
					{compte !== null && compte > 0 ? (
						<span
							data-testid="onglet-rentab-badge"
							aria-label={t(compte === 1 ? 'rentab.tabs.pending.count.one' : 'rentab.tabs.pending.count.many', { n: String(compte) })}
							className="shrink-0 rounded-full bg-hover px-2 text-sm text-text-2 tabular-nums"
						>
							{compte}
						</span>
					) : null}
				</Link>
			</nav>
			{onglet === 'saisir' ? (
				<RecettesASaisir client={client} lecture={aSaisir} onRelire={() => setTentativeSaisir((n) => n + 1)} />
			) : (
				<VueEnsemble client={client} parametres={parametres} setParametres={setParametres} versSaisir={vers('saisir')} capaciteSouveraine={administration} />
			)}
		</div>
	)
}

function VueEnsemble({
	client,
	parametres,
	setParametres,
	versSaisir,
	capaciteSouveraine,
}: {
	readonly capaciteSouveraine: Capacite | undefined
	readonly client: ClientCrm | null
	readonly parametres: URLSearchParams
	readonly setParametres: ReturnType<typeof useSearchParams>[1]
	readonly versSaisir: string
}) {
	const du = lireDate(parametres.get('du'))
	const au = lireDate(parametres.get('au'))
	const etat = lireEtatRapport(parametres.get('etat'))
	const vue = lireVueRapport(parametres.get('vue'))
	const cle = `${du ?? ''}|${au ?? ''}`
	const [lecture, setLecture] = useState<LectureRapport>({ statut: 'chargement' })
	const [tentative, setTentative] = useState(0)
	const rang = useRef(0)
	// La capacité d'administrer l'espace, rendue par la base à la coquille (`CRM-093`) : refusée, l'écran dit « réservé »
	// SANS appeler la fonction, dont le refus laisserait une erreur 403 dans la console (précision de T3, §6.3). Illisible
	// (hors coquille, échec), la fonction reste juge.
	const contexte = useContexteEspace()
	const administration = capaciteSouveraine ?? contexte.capacites.administration
	// Tant que l'espace n'est pas connu, la capacité est « inconnue » sans avoir été lue : attendre, sinon l'appel part
	// et un non-administrateur reçoit une 403 (défaut trouvé par l'E2E, chargement direct de l'adresse). Inconnue APRÈS
	// lecture (échec), la fonction reste juge.
	const enAttente =
		administration === 'en-lecture' || (administration === 'inconnue' && capaciteSouveraine === undefined && contexte.idWorkspace === null)

	useEffect(() => {
		if (client === null || enAttente || administration === 'refusee') return
		const r = ++rang.current
		void (async () => {
			const lu = await lireRentabilite(client, { du, au })
			if (r !== rang.current) return
			if (lu.statut === 'erreur') {
				setLecture(lu.erreur.nature === 'forbidden' ? { statut: 'refusee' } : { statut: 'erreur', nature: lu.erreur.nature })
				return
			}
			if (lu.statut !== 'pret') return
			const ids = [...new Set(lu.donnees.lignes.map((l) => l.cardId))]
			const noms = await lireNomsRentabilite(client, ids)
			if (r !== rang.current) return
			if (noms.statut !== 'pret') {
				setLecture({ statut: 'erreur', nature: noms.statut === 'erreur' ? noms.erreur.nature : 'unknown' })
				return
			}
			setLecture({ statut: 'pret', lignes: lu.donnees.lignes, noms: noms.donnees, cle })
		})()
	}, [client, du, au, cle, tentative, administration, enAttente])

	const changer = (cleParam: string, valeur: string | null) => {
		const p = new URLSearchParams(parametres)
		if (valeur === null || valeur === '') p.delete(cleParam)
		else p.set(cleParam, valeur)
		// Le choix remplace l'entrée d'historique, il n'en empile pas (§5.48 bis).
		setParametres(p, { replace: true })
	}

	const rapport = useMemo(
		() => (lecture.statut === 'pret' ? construireRapport(lecture.lignes, etat, vue, lecture.noms) : null),
		[lecture, etat, vue],
	)

	if (lecture.statut === 'refusee' || administration === 'refusee') {
		return (
			<div className="flex flex-col gap-3">
				<EtatRefus titre={t('rentab.refused.title')} corps={t('rentab.refused.body')} />
				<p className="text-center">
					<Link to={versSaisir} className="text-brand underline">
						{t('rentab.refused.toPending')}
					</Link>
				</p>
			</div>
		)
	}
	if (lecture.statut === 'erreur') {
		return (
			<EtatErreur
				titre={t('state.error.title')}
				corps={t(lecture.nature === 'network' ? 'state.error.network' : 'state.error.unknown')}
				libelleReprise={t('state.error.retry')}
				onReprise={() => setTentative((n) => n + 1)}
			/>
		)
	}

	const vueLien = (v: VueRentabilite) => {
		const p = new URLSearchParams(parametres)
		if (v === 'prevu') p.set('vue', 'prevu')
		else p.delete('vue')
		const s = p.toString()
		return `${CHEMIN_RENTABILITE}${s === '' ? '' : `?${s}`}`
	}

	return (
		<div className="flex flex-col gap-4 min-w-0">
			<div className="flex flex-wrap items-end gap-3" data-testid="rentab-filtres">
				<label className="flex w-full flex-col gap-1 text-sm text-text-2 md:w-auto">
					{t('rentab.filter.from')}
					<input
						type="date"
						value={du ?? ''}
						onChange={(e) => changer('du', e.target.value)}
						className="min-h-[var(--size-target)] rounded-sm border border-border bg-surface px-3 text-text"
					/>
				</label>
				<label className="flex w-full flex-col gap-1 text-sm text-text-2 md:w-auto">
					{t('rentab.filter.to')}
					<input
						type="date"
						value={au ?? ''}
						onChange={(e) => changer('au', e.target.value)}
						className="min-h-[var(--size-target)] rounded-sm border border-border bg-surface px-3 text-text"
					/>
				</label>
				<label className="flex w-full flex-col gap-1 text-sm text-text-2 md:w-auto">
					{t('rentab.filter.state')}
					<select
						value={etat}
						onChange={(e) => changer('etat', e.target.value === 'toutes' ? null : e.target.value)}
						className="min-h-[var(--size-target)] rounded-sm border border-border bg-surface px-3 text-text"
					>
						{ETATS_RAPPORT.map((e) => (
							<option key={e} value={e}>
								{t(CLES_ETAT[e])}
							</option>
						))}
					</select>
				</label>
				<nav aria-label={t('rentab.view.aria')} className="flex items-center gap-1">
					{(['reel', 'prevu'] as const).map((v) => (
						<Link
							key={v}
							to={vueLien(v)}
							replace
							data-testid={`rentab-vue-${v}`}
							{...(vue === v ? { 'aria-current': 'page' as const } : {})}
							className={`${CLASSES_ONGLET} ${vue === v ? CLASSES_ACTIF : CLASSES_INACTIF}`}
						>
							{t(v === 'reel' ? 'rentab.view.reel' : 'rentab.view.prevu')}
						</Link>
					))}
				</nav>
			</div>

			{lecture.statut === 'chargement' || rapport === null ? (
				<SkeletonListe lignes={6} libelle={t('state.loading.aria')} />
			) : rapport.tableaux.length === 0 ? (
				<p data-testid="rentab-vide" className="text-text-2">
					{du !== null || au !== null || etat !== 'toutes' ? t('rentab.empty.filtered') : t('rentab.empty')}
				</p>
			) : (
				<div aria-busy={lecture.cle !== cle} className="flex flex-col gap-6">
					{rapport.tableaux.map((tab) => (
						<TableauRentabilite key={tab.devise} tableau={tab} vue={vue} titre={rapport.tableaux.length > 1} />
					))}
					<div className="flex flex-col gap-1 text-sm text-text-2" data-testid="rentab-mentions">
						{rapport.mentions.recettesSansReel > 0 ? (
							<p>{t(rapport.mentions.recettesSansReel === 1 ? 'rentab.mention.revenues.one' : 'rentab.mention.revenues.many', { n: String(rapport.mentions.recettesSansReel) })}</p>
						) : null}
						{rapport.mentions.coutsSansReel > 0 ? (
							<p>{t(rapport.mentions.coutsSansReel === 1 ? 'rentab.mention.costs.one' : 'rentab.mention.costs.many', { n: String(rapport.mentions.coutsSansReel) })}</p>
						) : null}
						{rapport.mentions.minutesNonValorisees > 0 ? (
							<p>{t('rentab.mention.time', { duree: dureeEnClair(rapport.mentions.minutesNonValorisees) })}</p>
						) : null}
						{vue === 'prevu' ? <p>{t('rentab.note.prevu')}</p> : null}
						{du !== null || au !== null ? <p>{t('rentab.note.period')}</p> : null}
						<p>{t('rentab.scope')}</p>
					</div>
				</div>
			)}
		</div>
	)
}

const ENTETE = 'sticky top-0 bg-bg text-sm text-text-2 font-medium h-[var(--size-target)] px-3'
const CELLULE = 'h-[var(--size-target)] px-3 text-right tabular-nums whitespace-nowrap'

function TableauRentabilite({ tableau, vue, titre }: { readonly tableau: TableauDevise; readonly vue: VueRentabilite; readonly titre: boolean }) {
	const d = tableau.devise
	const reel = vue === 'reel'
	return (
		<section aria-label={t('rentab.table.aria', { devise: d })} data-testid="rentab-tableau" data-devise={d} className="flex flex-col gap-2 min-w-0">
			{titre ? <h2 className="text-h2 font-bold">{d}</h2> : null}
			{/* Une surface bordée, comme les tableaux du pilotage (§5.48) : les cellules collantes portent le même fond que la
			    ligne, et la ligne ne se lit plus en deux teintes (constaté sur la capture du 2026-10-23). */}
			<div className="overflow-x-auto indique-debordement-x [contain:paint] rounded-lg border border-border bg-surface">
				<table className="w-full min-w-[56rem] table-fixed border-collapse">
					<thead>
						<tr className="border-b border-border">
							<th scope="col" className={`${ENTETE} sticky left-0 z-10 w-[28ch] text-left`}>{t('rentab.column.card')}</th>
							<th scope="col" className={`${ENTETE} w-[14ch] text-left`}>{t('rentab.column.state')}</th>
							<th scope="col" className={`${ENTETE} text-right`}>{t('rentab.column.amount', { devise: d })}</th>
							<th scope="col" className={`${ENTETE} text-right`}>{t(reel ? 'rentab.column.revenues.devise' : 'rentab.column.revenues.prevu', { devise: d })}</th>
							<th scope="col" className={`${ENTETE} text-right`}>{t(reel ? 'rentab.column.costs.devise' : 'rentab.column.costs.prevu', { devise: d })}</th>
							<th scope="col" className={`${ENTETE} text-right`}>{t('rentab.column.staff.devise', { devise: d })}</th>
							<th scope="col" className={`${ENTETE} w-[22ch] text-right`}>{t(reel ? 'rentab.column.margin.devise' : 'rentab.column.margin.prevu', { devise: d })}</th>
							{reel ? <th scope="col" className={`${ENTETE} w-[10ch] text-right`}>{t('rentab.column.rate')}</th> : null}
						</tr>
					</thead>
					<tbody>
						{tableau.tracks.map((tr) => (
							<GroupeTrack key={tr.trackId} nom={tr.nom} sousTotal={tr.sousTotal} reel={reel}>
								{tr.channels.map((ch) => (
									<GroupeChannel key={ch.channelId} nom={ch.nom} sousTotal={ch.sousTotal} reel={reel}>
										{ch.affaires.map((a) => (
											<LigneAffaire key={a.cardId} a={a} reel={reel} slugTrack={tr.slug} slugChannel={ch.slug} />
										))}
									</GroupeChannel>
								))}
							</GroupeTrack>
						))}
					</tbody>
					<tfoot>
						<LigneMontants titre={t('rentab.total')} r={tableau.total} reel={reel} classe="border-t border-border font-medium" retrait="" />
					</tfoot>
				</table>
			</div>
		</section>
	)
}

function GroupeTrack({ nom, sousTotal, reel, children }: { readonly nom: string; readonly sousTotal: R; readonly reel: boolean; readonly children: ReactNode }) {
	return (
		<>
			<LigneMontants titre={nom} r={sousTotal} reel={reel} classe="border-b border-border font-medium" retrait="pl-3 text-[15px]" sousTotal />
			{children}
		</>
	)
}

function GroupeChannel({ nom, sousTotal, reel, children }: { readonly nom: string; readonly sousTotal: R; readonly reel: boolean; readonly children: ReactNode }) {
	return (
		<>
			<LigneMontants titre={nom} r={sousTotal} reel={reel} classe="border-b border-border font-medium" retrait="pl-6" sousTotal />
			{children}
		</>
	)
}

function LigneMontants({
	titre,
	r,
	reel,
	classe,
	retrait,
	sousTotal = false,
}: {
	readonly titre: string
	readonly r: R
	readonly reel: boolean
	readonly classe: string
	readonly retrait: string
	readonly sousTotal?: boolean
}) {
	const v = (x: number | null) => (x === null ? '' : montantEnClair(x))
	return (
		<tr className={classe}>
			<th scope="row" colSpan={3} className={`sticky left-0 bg-surface h-[var(--size-target)] text-left ${retrait}`}>
				{sousTotal ? <span className="sr-only">{t('rentab.subtotal')} </span> : null}
				{titre}
			</th>
			<td className={CELLULE}>{v(r.recettes)}</td>
			<td className={CELLULE}>{v(r.couts)}</td>
			<td className={CELLULE}>{v(r.personnel)}</td>
			<td className={CELLULE}>
				<Marge r={r} />
			</td>
			{reel ? <td className={CELLULE}>{r.taux === null ? '' : `${r.taux.toLocaleString('fr-FR', { minimumFractionDigits: 1 })} %`}</td> : null}
		</tr>
	)
}

function LigneAffaire({ a, reel, slugTrack, slugChannel }: { readonly a: AffaireDuRapport; readonly reel: boolean; readonly slugTrack: string; readonly slugChannel: string }) {
	const v = (x: number | null) => (x === null ? '' : montantEnClair(x))
	const r = a.rentabilite
	const adresse = slugTrack !== '' && slugChannel !== '' ? `/tracks/${slugTrack}/${slugChannel}/cards/${a.cardId}` : null
	return (
		<tr data-testid="rentab-ligne-affaire" data-card={a.cardId} className="border-b border-border hover:bg-hover">
			<th scope="row" className="sticky left-0 bg-surface h-[var(--size-target)] pl-[36px] pr-3 text-left font-normal truncate" title={a.titre}>
				{adresse === null ? a.titre : (
					<Link to={adresse} className="text-brand hover:underline">
						{a.titre}
					</Link>
				)}
			</th>
			<td className="px-3 text-sm">
				<span className="inline-flex flex-wrap items-center gap-1">
					{t(CLES_GENRE[a.genre])}
					{a.archivee ? <span className="rounded-full bg-accent-soft px-2 text-xs text-accent-on-soft">{t('rentab.archived')}</span> : null}
				</span>
			</td>
			<td className={CELLULE}>{v(a.montant)}</td>
			<td className={CELLULE}>{v(r.recettes)}</td>
			<td className={CELLULE}>{v(r.couts)}</td>
			<td className={CELLULE}>{v(r.personnel)}</td>
			<td className={CELLULE}>
				<Marge r={r} />
			</td>
			{reel ? <td className={CELLULE}>{r.taux === null ? '' : `${r.taux.toLocaleString('fr-FR', { minimumFractionDigits: 1 })} %`}</td> : null}
		</tr>
	)
}

