// @spec CRM-106 (docs/BACKLOG.md) — tranche T2 : la bande de la semaine dans la fiche d'une affaire
// @spec docs/SPEC-temps.md §7.6 (1 : sept cellules de la matrice et le total de la semaine ; 2 : une valeur remplace ;
//       3 : son temps seulement ; 4 : le mode et le pied d'un jour comptent toutes ses saisies ; 5 : la semaine de la
//       seule personne, sans arborescence ; 6 : navigation hors de l'adresse, « Ouvrir dans Temps » ; 7 : « Votre
//       semaine » ; 8 : le résumé relu ; 9 : aucun motif de lecture seule), §6.3, §3.2 ; docs/DESIGN_SYSTEM.md §5.54 bis,
//       §5.54 (cellule, en-tête d'un jour, pied) ; décision 630
//
// LA BANDE NE REJOUE AUCUNE RÈGLE. Elle réemploie la cellule de la matrice, qui annonce le plafond avant l'envoi et dit
// le refus de la base — la cible lisible, le plafond et l'auteur sont tenus par la migration `0087`. Elle n'obéit pas
// au motif de lecture seule de la fiche (`CRM-093`) : il dit le droit d'écrire l'affaire, et le temps décrit la personne.

import { ChevronLeft, ChevronRight, Timer } from 'lucide-react'
import { useCallback, useEffect, useId, useMemo, useRef, useState, type RefObject } from 'react'
import { Link } from 'react-router'
import { LiveRegion } from '../components/ui/LiveRegion'
import { SkeletonListe } from '../components/ui/Skeleton'
import { t } from '../i18n'
import { enChargement, type EtatAsync } from '../lib/async'
import { lireSaisies } from '../lib/saisie-temps'
import type { ClientCrm } from '../lib/supabase'
import {
	cleCible,
	decalerJours,
	enJours,
	joursDeLaSemaine,
	lundiDe,
	modesDesJours,
	remplacerDansSaisies,
	totalJour,
	totalLigne,
	type LigneMatrice,
	type Saisie,
} from '../lib/temps'
import { CHEMIN_TEMPS } from './chemins'
import { CLE_URL_SEMAINE, CelluleTemps, EnTeteJour, MotifCaseHeures, PiedJour, formaterDuree, libelleSemaine, useCasesEnHeures } from './SaisieTemps'

/** L'adresse de la matrice pour une semaine : sans paramètre pour celle du jour, comme la navigation de l'écran « Temps ». */
export function adresseTemps(lundi: string, aujourdhui: string): string {
	return lundi === lundiDe(aujourdhui) ? CHEMIN_TEMPS : `${CHEMIN_TEMPS}?${CLE_URL_SEMAINE}=${lundi}`
}

const CLASSES_ICONE =
	'inline-flex size-[var(--size-target)] items-center justify-center rounded-md border border-border hover:bg-hover'

export type ProprietesBandeTemps = {
	readonly client: ClientCrm
	readonly idWorkspace: string
	/** La personne connectée : la bande ne saisit que son temps, administrateur compris (§7.6 point 3). */
	readonly idUtilisateur: string
	readonly idCard: string
	readonly titreCard: string
	/** Le jour local de la personne, en ISO, injecté pour que les preuves le fixent. */
	readonly aujourdhui: string
	/** Appelé après chaque écriture acceptée : le résumé du bloc se relit (§7.6 point 8). */
	readonly onEnregistre: () => void
}

export function BandeTempsCard({ client, idWorkspace, idUtilisateur, idCard, titreCard, aujourdhui, onEnregistre }: ProprietesBandeTemps) {
	const [lundi, setLundi] = useState(() => lundiDe(aujourdhui))
	const jours = useMemo(() => joursDeLaSemaine(lundi), [lundi])
	const [etat, setEtat] = useState<EtatAsync<readonly Saisie[]>>(enChargement)
	const [tentative, setTentative] = useState(0)
	const [annonce, setAnnonce] = useState('')
	const cases = useCasesEnHeures(etat.statut === 'pret' ? etat.donnees : [])
	const { reinitialiser: reinitialiserCases } = cases
	const tableau = useRef<HTMLTableElement>(null)
	const idTitre = useId()

	// TOUTES les saisies de la personne sur la semaine, et non celles de l'affaire : le mode d'un jour et le plafond se
	// lisent sur le jour entier (§7.6 point 4). Le filtre sur la personne est écrit : à un administrateur, la RLS
	// rendrait le temps de chacun.
	useEffect(() => {
		let courant = true
		setEtat(enChargement)
		void lireSaisies(client, idWorkspace, idUtilisateur, lundi, decalerJours(lundi, 6)).then((resultat) => {
			if (courant) setEtat(resultat)
		})
		return () => {
			courant = false
		}
	}, [client, idWorkspace, idUtilisateur, lundi, tentative])

	useEffect(() => reinitialiserCases(), [lundi, reinitialiserCases])

	const ligne: LigneMatrice = useMemo(() => {
		const cible = { genre: 'card', id: idCard } as const
		return { cle: cleCible(cible), cible, libelle: titreCard, niveau: 2 }
	}, [idCard, titreCard])

	const remplacer = useCallback(
		(ancienne: Saisie | null, nouvelle: Saisie | null, cle: string, jour: string) => {
			setEtat((precedent) => (precedent.statut === 'pret' ? { statut: 'pret', donnees: remplacerDansSaisies(precedent.donnees, ancienne, nouvelle, cle, jour) } : precedent))
			onEnregistre()
		},
		[onEnregistre],
	)

	const deplacer = (rang: number, colonne: number) => {
		tableau.current?.querySelector<HTMLInputElement>(`input[data-ligne="${rang}"][data-colonne="${colonne}"]`)?.focus()
	}

	const semaineDuJour = lundiDe(aujourdhui)

	return (
		<section aria-labelledby={idTitre} className="flex flex-col gap-3 border-t border-border pt-4" data-testid="temps-card-bande">
			<div className="flex flex-wrap items-center justify-between gap-2">
				<h3 id={idTitre} className="text-[15px] font-medium">
					{t('personnel.card.week.title')}
				</h3>
				<Link
					to={adresseTemps(lundi, aujourdhui)}
					className="inline-flex min-h-[var(--size-target)] items-center gap-1 rounded-md px-2 text-sm text-brand hover:bg-hover"
					data-testid="temps-card-ouvrir"
				>
					<Timer aria-hidden="true" size={16} />
					{t('personnel.card.week.open')}
				</Link>
			</div>
			<div className="flex flex-wrap items-center gap-2">
				<button type="button" onClick={() => setLundi(decalerJours(lundi, -7))} aria-label={t('time.week.previous')} className={CLASSES_ICONE}>
					<ChevronLeft aria-hidden="true" size={16} />
				</button>
				<p className="text-sm" data-testid="temps-card-semaine">
					{libelleSemaine(lundi)}
				</p>
				<button type="button" onClick={() => setLundi(decalerJours(lundi, 7))} aria-label={t('time.week.next')} className={CLASSES_ICONE}>
					<ChevronRight aria-hidden="true" size={16} />
				</button>
				{lundi !== semaineDuJour ? (
					<button
						type="button"
						onClick={() => setLundi(semaineDuJour)}
						className="inline-flex min-h-[var(--size-target)] items-center rounded-md px-2 text-sm text-brand hover:bg-hover"
					>
						{t('time.week.current')}
					</button>
				) : null}
			</div>

			{etat.statut === 'chargement' ? (
				<SkeletonListe lignes={1} libelle={t('state.loading.aria')} />
			) : etat.statut === 'erreur' ? (
				<div className="flex flex-wrap items-center gap-2">
					<p role="alert" className="text-sm text-danger">
						{t('personnel.error')}
					</p>
					<button
						type="button"
						onClick={() => setTentative((n) => n + 1)}
						className="inline-flex min-h-[var(--size-target)] items-center rounded-md border border-border px-3 text-sm hover:bg-hover"
					>
						{t('state.error.retry')}
					</button>
				</div>
			) : (
				<>
					<MotifCaseHeures jour={cases.motifCase} />
					<Bande
						tableau={tableau}
						client={client}
						idWorkspace={idWorkspace}
						idUtilisateur={idUtilisateur}
						ligne={ligne}
						jours={jours}
						aujourdhui={aujourdhui}
						saisies={etat.donnees}
						heuresForcees={cases.heuresForcees}
						onBasculerHeures={cases.basculer}
						deplacer={deplacer}
						onEnregistre={remplacer}
						onAnnonce={setAnnonce}
					/>
				</>
			)}
			<LiveRegion libelle={t('time.live.aria')} message={annonce} />
		</section>
	)
}

function Bande({
	tableau,
	client,
	idWorkspace,
	idUtilisateur,
	ligne,
	jours,
	aujourdhui,
	saisies,
	heuresForcees,
	onBasculerHeures,
	deplacer,
	onEnregistre,
	onAnnonce,
}: {
	readonly tableau: RefObject<HTMLTableElement | null>
	readonly client: ClientCrm
	readonly idWorkspace: string
	readonly idUtilisateur: string
	readonly ligne: LigneMatrice
	readonly jours: readonly string[]
	readonly aujourdhui: string
	readonly saisies: readonly Saisie[]
	readonly heuresForcees: ReadonlySet<string>
	readonly onBasculerHeures: (jour: string, coche: boolean) => void
	readonly deplacer: (rang: number, colonne: number) => void
	readonly onEnregistre: (ancienne: Saisie | null, nouvelle: Saisie | null, cle: string, jour: string) => void
	readonly onAnnonce: (message: string) => void
}) {
	const modes = modesDesJours(saisies, jours, heuresForcees)
	const totalSemaine = totalLigne(saisies, ligne.cle, jours)
	// RETOUCHE TIRÉE DES CAPTURES (2026-10-23) : avec le libellé « En heures » sous chaque jour et une colonne de total, la
	// bande débordait la colonne de la fiche dès 1440 px — samedi, dimanche et le total hors de vue. Les cases gardent
	// leur nom accessible et une phrase les nomme ; le total de la semaine passe sous la bande (§5.54 bis).
	return (
		<div className="flex flex-col gap-2">
		<p className="text-[13px] text-text-2">{t('personnel.card.week.hoursHint')}</p>
		<div className="overflow-x-auto rounded-lg border border-border indique-debordement-x">
			<table ref={tableau} className="w-full border-collapse text-sm" data-testid="temps-card-tableau">
				<caption className="sr-only">{t('personnel.card.week.caption', { titre: ligne.libelle })}</caption>
				<thead>
					<tr className="border-b border-border">
						{/* Aucune première colonne visible : la fiche nomme déjà l'affaire (§5.54 bis). */}
						<td className="sr-only" />
						{jours.map((jour) => (
							<EnTeteJour
								key={jour}
								jour={jour}
								aujourdhui={aujourdhui}
								mode={modes[jour] ?? 'quarts'}
								onBasculer={onBasculerHeures}
								libelleVisible={false}
							/>
						))}
					</tr>
				</thead>
				<tbody>
					<tr className="border-b border-border" data-testid="temps-ligne" data-cible={ligne.cle}>
						<th scope="row" className="sr-only">
							{ligne.libelle}
						</th>
						{jours.map((jour, colonne) => (
							<td key={jour} className="px-1 py-1 text-center">
								<CelluleTemps
									client={client}
									idWorkspace={idWorkspace}
									personne={idUtilisateur}
									ligne={ligne}
									jour={jour}
									mode={modes[jour] ?? 'quarts'}
									saisies={saisies}
									rang={0}
									colonne={colonne}
									nombreLignes={1}
									entreeVers="jour"
									deplacer={deplacer}
									onEnregistre={onEnregistre}
									onAnnonce={onAnnonce}
								/>
							</td>
						))}
					</tr>
				</tbody>
				<tfoot>
					<tr>
						<th scope="row" className="sr-only">
							{t('personnel.card.week.dayTotal')}
						</th>
						{jours.map((jour) => (
							<PiedJour key={jour} jour={jour} total={totalJour(saisies, jour)} mode={modes[jour] ?? 'quarts'} />
						))}
					</tr>
				</tfoot>
			</table>
		</div>
		{/* Un total nul ne s'écrit pas, comme dans la matrice (§5.54) : « 0 h » se lirait comme une semaine remplie. */}
		{totalSemaine > 0 ? (
			<p className="text-sm">
				{t('personnel.card.week.total')}{' '}
				<span className="font-medium tabular-nums" data-testid="temps-total-ligne">
					{formaterDuree(enJours(totalSemaine))}
				</span>
			</p>
		) : null}
		</div>
	)
}
