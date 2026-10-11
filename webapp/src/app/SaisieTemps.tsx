// @spec CRM-098 (docs/BACKLOG.md) — tranche T2 : l'onglet « Saisie » de l'écran « Temps »
// @spec docs/SPEC-temps.md §6.1 (la semaine et la précédente), §6.3 (le mode d'une journée, la case « En heures »),
//       §7.1 (« Saisir pour », administrateurs), §7.2 (la matrice : lignes, colonnes, cellule qui s'enregistre seule,
//       pied, navigation, ajout d'une affaire) ; docs/DESIGN_SYSTEM.md §5.54 (matrice, en-tête d'un jour, cellule,
//       clavier, pied, navigation, bandeau « Vous saisissez le temps de… »), §5.7 ter, §5.9, §5.21 (combobox), §8
//
// L'écran n'impose aucune règle : il annonce avant l'envoi qu'une valeur dépasserait la journée, et dit le refus que la
// base rend. Le plafond, la cible lisible et qui saisit pour qui sont tenus en base (migration `0087`).

import { ChevronLeft, ChevronRight, Plus } from 'lucide-react'
import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useSearchParams } from 'react-router'
import { LiveRegion } from '../components/ui/LiveRegion'
import { SkeletonListe } from '../components/ui/Skeleton'
import { EtatErreur, EtatVide } from '../components/ui/States'
import { t } from '../i18n'
import type { CleTraduction } from '../i18n'
import { enChargement, type EtatAsync } from '../lib/async'
import { lireMembresAffectables, type MembreAffectable } from '../lib/entete-card'
import {
	chercherAffaires,
	ecrireCellule,
	lireAffaires,
	lireArbreTemps,
	lireSaisies,
	type MotifRefusTemps,
} from '../lib/saisie-temps'
import type { ClientCrm } from '../lib/supabase'
import {
	MINUTES_JOURNEE,
	MINUTES_QUART,
	affairesDesSaisies,
	cibleDe,
	cleCible,
	decalerJours,
	depasseLaJournee,
	enHeures,
	enJours,
	joursDeLaSemaine,
	lignesMatrice,
	lireSaisie,
	lundiDe,
	minutesCellule,
	modeDuJour,
	totalJour,
	totalLigne,
	valeurDeChamp,
	type Affaire,
	type ArbreTrack,
	type Duree,
	type LigneMatrice,
	type ModeJour,
	type Saisie,
} from '../lib/temps'

/** Le paramètre d'adresse de la semaine affichée : le lundi, en ISO. Absent ou invalide, c'est la semaine du jour. */
export const CLE_URL_SEMAINE = 'semaine' as const

export function lireSemaine(valeur: string | null, aujourdhui: string): string {
	if (valeur !== null && /^\d{4}-\d{2}-\d{2}$/.test(valeur) && !Number.isNaN(Date.parse(`${valeur}T00:00:00Z`))) {
		return lundiDe(valeur)
	}
	return lundiDe(aujourdhui)
}

const FORMAT_JOUR_COURT = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', timeZone: 'UTC' })
const FORMAT_JOUR_LONG = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })
const FORMAT_JOUR_MOIS = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', timeZone: 'UTC' })
const FORMAT_JOUR_MOIS_AN = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
const enDate = (iso: string) => new Date(`${iso}T00:00:00Z`)

/** « Semaine du 12 au 18 octobre 2026 », ou « du 26 octobre au 1 novembre 2026 » à cheval sur deux mois. */
export function libelleSemaine(lundi: string): string {
	const dimanche = decalerJours(lundi, 6)
	const memeMois = lundi.slice(0, 7) === dimanche.slice(0, 7)
	const memeAn = lundi.slice(0, 4) === dimanche.slice(0, 4)
	const debut = memeMois
		? String(enDate(lundi).getUTCDate())
		: (memeAn ? FORMAT_JOUR_MOIS : FORMAT_JOUR_MOIS_AN).format(enDate(lundi))
	return t('time.week.label', { debut, fin: FORMAT_JOUR_MOIS_AN.format(enDate(dimanche)) })
}

/** Une durée en mots courts : « 6 h 30 », « 45 min », « 1 j 3 h 05 », « 0 h ». */
export function formaterDuree(duree: Duree): string {
	const m = String(duree.minutes).padStart(2, '0')
	if (duree.jours > 0) {
		if (duree.heures === 0 && duree.minutes === 0) return t('time.duration.d', { j: String(duree.jours) })
		if (duree.minutes === 0) return t('time.duration.dh', { j: String(duree.jours), h: String(duree.heures) })
		return t('time.duration.dhm', { j: String(duree.jours), h: String(duree.heures), m })
	}
	if (duree.heures === 0 && duree.minutes > 0) return t('time.duration.m', { m: String(duree.minutes) })
	if (duree.minutes === 0) return t('time.duration.h', { h: String(duree.heures) })
	return t('time.duration.hm', { h: String(duree.heures), m })
}

const REFUS: Readonly<Record<MotifRefusTemps, CleTraduction>> = {
	plafond: 'time.cell.refused.cap',
	droit: 'time.cell.refused.forbidden',
	conflit: 'time.cell.refused.conflict',
	reseau: 'time.cell.refused.network',
	inconnu: 'time.cell.refused.unknown',
}

type EtatCellule =
	| { readonly statut: 'repos' }
	| { readonly statut: 'envoi' }
	| { readonly statut: 'enregistre' }
	| { readonly statut: 'invalide'; readonly cle: CleTraduction }
	| { readonly statut: 'refus'; readonly cle: CleTraduction }

type Donnees = {
	readonly arbre: readonly ArbreTrack[]
	readonly saisies: readonly Saisie[]
	readonly affaires: readonly Affaire[]
}

export type ProprietesSaisieTemps = {
	readonly client: ClientCrm
	readonly idWorkspace: string
	readonly idUtilisateur: string
	readonly estAdmin: boolean
	/** Le jour local de la personne, en ISO (`jourLocal(new Date())`), injecté pour que les preuves le fixent. */
	readonly aujourdhui: string
}

export function SaisieTemps({ client, idWorkspace, idUtilisateur, estAdmin, aujourdhui }: ProprietesSaisieTemps) {
	const [parametres, setParametres] = useSearchParams()
	const lundi = lireSemaine(parametres.get(CLE_URL_SEMAINE), aujourdhui)
	const jours = useMemo(() => joursDeLaSemaine(lundi), [lundi])
	const [personne, setPersonne] = useState(idUtilisateur)
	const [membres, setMembres] = useState<readonly MembreAffectable[]>([])
	const [etat, setEtat] = useState<EtatAsync<Donnees>>(enChargement)
	const [tentative, setTentative] = useState(0)
	const [ajoutees, setAjoutees] = useState<readonly Affaire[]>([])
	const [heuresForcees, setHeuresForcees] = useState<ReadonlySet<string>>(new Set())
	const [annonce, setAnnonce] = useState('')
	const [motifCase, setMotifCase] = useState<string | null>(null)

	useEffect(() => {
		if (!estAdmin) return
		let courant = true
		void lireMembresAffectables(client, idWorkspace).then((resultat) => {
			if (courant && resultat.statut === 'pret') setMembres(resultat.donnees)
		})
		return () => {
			courant = false
		}
	}, [client, idWorkspace, estAdmin])

	useEffect(() => {
		let courant = true
		setEtat(enChargement)
		void (async () => {
			const [arbre, saisies] = await Promise.all([
				lireArbreTemps(client),
				lireSaisies(client, idWorkspace, personne, decalerJours(lundi, -7), decalerJours(lundi, 6)),
			])
			if (!courant) return
			if (arbre.statut === 'erreur') return setEtat(arbre)
			if (saisies.statut === 'erreur') return setEtat(saisies)
			if (arbre.statut !== 'pret' || saisies.statut !== 'pret') return
			const affaires = await lireAffaires(client, [...affairesDesSaisies(saisies.donnees)])
			if (!courant) return
			if (affaires.statut === 'erreur') return setEtat(affaires)
			if (affaires.statut !== 'pret') return
			setEtat({ statut: 'pret', donnees: { arbre: arbre.donnees, saisies: saisies.donnees, affaires: affaires.donnees } })
		})()
		return () => {
			courant = false
		}
	}, [client, idWorkspace, personne, lundi, tentative])

	// Changer de semaine ou de personne repart d'une matrice sans case forcée ni affaire ajoutée.
	useEffect(() => {
		setAjoutees([])
		setHeuresForcees(new Set())
		setMotifCase(null)
	}, [personne, lundi])

	const allerA = (nouveauLundi: string) => {
		const suivants = new URLSearchParams(parametres)
		if (nouveauLundi === lundiDe(aujourdhui)) suivants.delete(CLE_URL_SEMAINE)
		else suivants.set(CLE_URL_SEMAINE, nouveauLundi)
		setParametres(suivants)
	}

	const remplacerSaisie = useCallback((ancienne: Saisie | null, nouvelle: Saisie | null, cle: string, jour: string) => {
		setEtat((precedent) => {
			if (precedent.statut !== 'pret') return precedent
			const autres = precedent.donnees.saisies.filter(
				(s) => !(s.jour === jour && cleCible(cibleDe(s)) === cle) && s.id !== ancienne?.id,
			)
			return { statut: 'pret', donnees: { ...precedent.donnees, saisies: nouvelle === null ? autres : [...autres, nouvelle] } }
		})
	}, [])

	const nomPersonne = membres.find((m) => m.id === personne)?.nom ?? null

	return (
		<div className="flex flex-col gap-4" data-testid="temps-saisie">
			{estAdmin ? (
				<label className="inline-flex flex-wrap items-center gap-2 text-sm text-text-2">
					{t('time.for.label')}
					<select
						data-testid="temps-saisir-pour"
						value={personne}
						onChange={(e) => setPersonne(e.target.value)}
						className="min-h-[var(--size-target)] rounded-sm border border-border bg-surface px-3 text-text"
					>
						<option value={idUtilisateur}>{t('time.for.me')}</option>
						{membres
							.filter((m) => m.id !== idUtilisateur)
							.map((m) => (
								<option key={m.id} value={m.id}>
									{m.nom}
								</option>
							))}
					</select>
				</label>
			) : null}
			{personne !== idUtilisateur && nomPersonne !== null ? (
				<p role="status" data-testid="temps-bandeau-autrui" className="rounded-md bg-brand-soft px-4 py-2 text-sm text-brand">
					{t('time.for.banner', { nom: nomPersonne })}
				</p>
			) : null}

			<div className="flex flex-wrap items-center gap-2">
				<button
					type="button"
					onClick={() => allerA(decalerJours(lundi, -7))}
					className="inline-flex min-h-[var(--size-target)] items-center gap-1 rounded-md border border-border px-3 hover:bg-hover"
				>
					<ChevronLeft aria-hidden="true" size={16} />
					{t('time.week.previous')}
				</button>
				<h2 className="text-h3" data-testid="temps-semaine">
					{libelleSemaine(lundi)}
				</h2>
				<button
					type="button"
					onClick={() => allerA(decalerJours(lundi, 7))}
					className="inline-flex min-h-[var(--size-target)] items-center gap-1 rounded-md border border-border px-3 hover:bg-hover"
				>
					{t('time.week.next')}
					<ChevronRight aria-hidden="true" size={16} />
				</button>
				{lundi !== lundiDe(aujourdhui) ? (
					<button
						type="button"
						onClick={() => allerA(lundiDe(aujourdhui))}
						className="inline-flex min-h-[var(--size-target)] items-center rounded-md px-3 text-brand hover:bg-hover"
					>
						{t('time.week.current')}
					</button>
				) : null}
			</div>

			{etat.statut === 'chargement' ? (
				<SkeletonListe lignes={6} libelle={t('state.loading.aria')} />
			) : etat.statut === 'erreur' ? (
				<EtatErreur
					titre={t('state.error.title')}
					corps={t(etat.erreur.nature === 'network' ? 'state.error.network' : 'state.error.unknown')}
					libelleReprise={t('state.error.retry')}
					onReprise={() => setTentative((n) => n + 1)}
				/>
			) : etat.donnees.arbre.length === 0 ? (
				<EtatVide titre={t('time.empty.title')} corps={t('time.empty.body')} />
			) : (
				<Matrice
					client={client}
					idWorkspace={idWorkspace}
					personne={personne}
					jours={jours}
					aujourdhui={aujourdhui}
					donnees={etat.donnees}
					ajoutees={ajoutees}
					heuresForcees={heuresForcees}
					motifCase={motifCase}
					onBasculerHeures={(jour, coche) => {
						const minutes = etat.donnees.saisies.filter((s) => s.jour === jour).map((s) => s.minutes)
						if (!coche && modeDuJour(minutes) === 'heures') {
							setMotifCase(jour)
							return
						}
						setMotifCase(null)
						setHeuresForcees((precedent) => {
							const suivant = new Set(precedent)
							if (coche) suivant.add(jour)
							else suivant.delete(jour)
							return suivant
						})
					}}
					onEnregistre={remplacerSaisie}
					onAnnonce={setAnnonce}
				/>
			)}

			{etat.statut === 'pret' ? (
				<AjoutAffaire
					client={client}
					dejaPresentes={new Set([...affairesDesSaisies(etat.donnees.saisies), ...ajoutees.map((a) => a.id)])}
					onAjouter={(affaire) => {
						setAjoutees((precedent) => [...precedent, affaire])
						setAnnonce(t('time.add.done', { titre: affaire.title }))
					}}
				/>
			) : null}
			<LiveRegion libelle={t('time.live.aria')} message={annonce} />
		</div>
	)
}

function Matrice({
	client,
	idWorkspace,
	personne,
	jours,
	aujourdhui,
	donnees,
	ajoutees,
	heuresForcees,
	motifCase,
	onBasculerHeures,
	onEnregistre,
	onAnnonce,
}: {
	readonly client: ClientCrm
	readonly idWorkspace: string
	readonly personne: string
	readonly jours: readonly string[]
	readonly aujourdhui: string
	readonly donnees: Donnees
	readonly ajoutees: readonly Affaire[]
	readonly heuresForcees: ReadonlySet<string>
	readonly motifCase: string | null
	readonly onBasculerHeures: (jour: string, coche: boolean) => void
	readonly onEnregistre: (ancienne: Saisie | null, nouvelle: Saisie | null, cle: string, jour: string) => void
	readonly onAnnonce: (message: string) => void
}) {
	const tableau = useRef<HTMLTableElement>(null)
	const affaires = useMemo(() => {
		const parId = new Map(donnees.affaires.map((a) => [a.id, a]))
		for (const a of ajoutees) parId.set(a.id, a)
		return [...parId.values()]
	}, [donnees.affaires, ajoutees])
	const lignes = useMemo(
		() => lignesMatrice(donnees.arbre, affaires, new Set([...affairesDesSaisies(donnees.saisies), ...ajoutees.map((a) => a.id)])),
		[donnees.arbre, affaires, donnees.saisies, ajoutees],
	)
	const modes: Readonly<Record<string, ModeJour>> = Object.fromEntries(
		jours.map((jour) => [
			jour,
			heuresForcees.has(jour) ? 'heures' : modeDuJour(donnees.saisies.filter((s) => s.jour === jour).map((s) => s.minutes)),
		]),
	)

	/** Les flèches vont de cellule en cellule quand le champ est vide ou sa valeur entièrement sélectionnée (§5.54). */
	const deplacer = (ligne: number, colonne: number) => {
		tableau.current?.querySelector<HTMLInputElement>(`input[data-ligne="${ligne}"][data-colonne="${colonne}"]`)?.focus()
	}

	return (
		<div className="flex flex-col gap-2">
			{/* Le motif de la case qui ne se décoche pas vit AU-DESSUS de la matrice : posé dans l'en-tête, il élargissait la
			    colonne de son jour et déformait toute la grille (constaté sur la capture, §5.54). */}
			{motifCase !== null ? (
				<p role="status" className="text-sm text-danger" data-testid="temps-motif-case">
					{t('time.hours.locked', { jour: FORMAT_JOUR_LONG.format(enDate(motifCase)) })}
				</p>
			) : null}
			<div className="overflow-x-auto rounded-lg border border-border indique-debordement-x">
				<table ref={tableau} className="w-full border-collapse text-sm" data-testid="temps-matrice">
					<caption className="sr-only">{t('time.matrix.caption')}</caption>
					<thead className="sticky top-0 bg-surface">
						<tr className="border-b border-border">
							<th scope="col" className="sticky left-0 z-10 w-[16ch] min-w-[16ch] bg-surface px-3 py-2 text-left font-medium md:w-[28ch] md:min-w-[28ch]">
								{t('time.matrix.target')}
							</th>
							{jours.map((jour) => (
								<th key={jour} scope="col" className="px-1 py-2 text-center font-medium">
									<span
										className={`inline-block pb-1 ${jour === aujourdhui ? 'border-b-2 border-brand' : 'border-b-2 border-transparent'}`}
										{...(jour === aujourdhui ? { 'aria-current': 'date' as const } : {})}
									>
										{FORMAT_JOUR_COURT.format(enDate(jour))}
									</span>
									<label className="mt-1 flex min-h-[var(--size-target)] items-center justify-center gap-1 whitespace-nowrap px-1 text-[13px] font-normal text-text-2">
										<input
											type="checkbox"
											checked={modes[jour] === 'heures'}
											onChange={(e) => onBasculerHeures(jour, e.target.checked)}
											aria-label={t('time.hours.toggle', { jour: FORMAT_JOUR_LONG.format(enDate(jour)) })}
											data-testid={`temps-heures-${jour}`}
											className="size-6 accent-[var(--color-brand)]"
										/>
										<span aria-hidden="true">{t('time.hours.short')}</span>
									</label>
								</th>
							))}
							<th scope="col" className="px-3 py-2 text-right font-medium">
								{t('time.matrix.total')}
							</th>
						</tr>
					</thead>
					<tbody>
						{lignes.map((ligne, rang) => (
							<LigneTemps
								key={ligne.cle}
								ligne={ligne}
								rang={rang}
								nombreLignes={lignes.length}
								client={client}
								idWorkspace={idWorkspace}
								personne={personne}
								jours={jours}
								modes={modes}
								saisies={donnees.saisies}
								deplacer={deplacer}
								onEnregistre={onEnregistre}
								onAnnonce={onAnnonce}
							/>
						))}
					</tbody>
					<tfoot>
						<tr className="border-t border-border">
							<th scope="row" className="sticky left-0 bg-surface px-3 py-2 text-left font-medium">
								{t('time.matrix.dayTotal')}
							</th>
							{jours.map((jour) => {
								const total = totalJour(donnees.saisies, jour)
								const plein = total === MINUTES_JOURNEE
								const texte =
									modes[jour] === 'quarts'
										? t('time.foot.quarters', { n: String(total / MINUTES_QUART) })
										: t('time.foot.hours', { duree: formaterDuree(enHeures(total)) })
								return (
									<td key={jour} className="whitespace-nowrap px-1 py-2 text-center text-[13px] tabular-nums text-text-2" data-testid={`temps-total-${jour}`}>
										<span className={plein ? 'inline-flex rounded-full bg-success-soft px-2 text-success-on-soft' : ''}>{texte}</span>
									</td>
								)
							})}
							<td className="whitespace-nowrap px-3 py-2 text-right tabular-nums font-medium" data-testid="temps-total-semaine">
								{formaterDuree(enJours(jours.reduce((s, j) => s + totalJour(donnees.saisies, j), 0)))}
							</td>
						</tr>
					</tfoot>
				</table>
			</div>
		</div>
	)
}

// Les retraits de l'arborescence : un pas de 12 px par niveau (§5.54). `pl-[36px]` est une valeur arbitraire assumée,
// l'échelle close n'ayant pas de 36 px — la classe `pl-9` ne serait pas engendrée (leçon d'INC-231).
const RETRAITS = ['pl-3 text-[15px] font-medium', 'pl-6', 'pl-[36px]'] as const

function LigneTemps({
	ligne,
	rang,
	nombreLignes,
	client,
	idWorkspace,
	personne,
	jours,
	modes,
	saisies,
	deplacer,
	onEnregistre,
	onAnnonce,
}: {
	readonly ligne: LigneMatrice
	readonly rang: number
	readonly nombreLignes: number
	readonly client: ClientCrm
	readonly idWorkspace: string
	readonly personne: string
	readonly jours: readonly string[]
	readonly modes: Readonly<Record<string, ModeJour>>
	readonly saisies: readonly Saisie[]
	readonly deplacer: (ligne: number, colonne: number) => void
	readonly onEnregistre: (ancienne: Saisie | null, nouvelle: Saisie | null, cle: string, jour: string) => void
	readonly onAnnonce: (message: string) => void
}) {
	return (
		<tr className="border-b border-border last:border-b-0" data-testid="temps-ligne" data-cible={ligne.cle}>
			<th scope="row" className={`sticky left-0 z-10 bg-surface py-1 pr-3 text-left font-normal ${RETRAITS[ligne.niveau]}`}>
				{ligne.libelle}
			</th>
			{jours.map((jour, colonne) => (
				<td key={jour} className="px-1 py-1 text-center">
					<CelluleTemps
						client={client}
						idWorkspace={idWorkspace}
						personne={personne}
						ligne={ligne}
						jour={jour}
						mode={modes[jour] ?? 'quarts'}
						saisies={saisies}
						rang={rang}
						colonne={colonne}
						nombreLignes={nombreLignes}
						deplacer={deplacer}
						onEnregistre={onEnregistre}
						onAnnonce={onAnnonce}
					/>
				</td>
			))}
			{/* Un total nul reste vide, comme une cellule vide : une colonne de « 0 h » se lirait comme remplie (§5.54). */}
			<td className="whitespace-nowrap px-3 py-1 text-right tabular-nums text-text-2" data-testid="temps-total-ligne">
				{totalLigne(saisies, ligne.cle, jours) > 0 ? formaterDuree(enJours(totalLigne(saisies, ligne.cle, jours))) : ''}
			</td>
		</tr>
	)
}

function CelluleTemps({
	client,
	idWorkspace,
	personne,
	ligne,
	jour,
	mode,
	saisies,
	rang,
	colonne,
	nombreLignes,
	deplacer,
	onEnregistre,
	onAnnonce,
}: {
	readonly client: ClientCrm
	readonly idWorkspace: string
	readonly personne: string
	readonly ligne: LigneMatrice
	readonly jour: string
	readonly mode: ModeJour
	readonly saisies: readonly Saisie[]
	readonly rang: number
	readonly colonne: number
	readonly nombreLignes: number
	readonly deplacer: (ligne: number, colonne: number) => void
	readonly onEnregistre: (ancienne: Saisie | null, nouvelle: Saisie | null, cle: string, jour: string) => void
	readonly onAnnonce: (message: string) => void
}) {
	const minutes = minutesCellule(saisies, ligne.cle, jour)
	const existante = saisies.find((s) => s.jour === jour && cleCible(cibleDe(s)) === ligne.cle) ?? null
	const [texte, setTexte] = useState(valeurDeChamp(minutes, mode))
	const [focus, setFocus] = useState(false)
	const [etat, setEtat] = useState<EtatCellule>({ statut: 'repos' })
	const idMotif = useId()

	// CE QUE LA BASE A RETENU POUR CETTE CELLULE, SU DÈS LA RÉPONSE — et non au rendu suivant. `Entrée` enregistre puis
	// déplace le focus, ce qui fait quitter le champ AVANT que la matrice ne soit rendue avec la nouvelle ligne : relu
	// dans les propriétés, l'état serait périmé, et la sortie du champ renverrait une seconde insertion (mesuré : `409`
	// d'unicité, ou `400` du plafond qui compte la valeur deux fois). Une seule écriture vole à la fois, pour la même
	// raison.
	const retenue = useRef<{ minutes: number; existante: Saisie | null }>({ minutes, existante })
	const enVol = useRef<Promise<boolean> | null>(null)
	useEffect(() => {
		if (enVol.current === null) retenue.current = { minutes, existante }
	}, [minutes, existante])

	// Hors du focus, le champ suit la valeur retenue et le mode du jour.
	useEffect(() => {
		if (!focus) setTexte(valeurDeChamp(minutes, mode))
	}, [minutes, mode, focus])

	const nom = t('time.cell.aria', { cible: ligne.libelle, jour: FORMAT_JOUR_LONG.format(enDate(jour)) })

	const enregistrer = (): Promise<boolean> => {
		if (enVol.current !== null) return enVol.current
		const envoi = envoyer().finally(() => {
			enVol.current = null
		})
		enVol.current = envoi
		return envoi
	}

	const envoyer = async (): Promise<boolean> => {
		const { minutes: minutesRetenues, existante: ligneRetenue } = retenue.current
		const lecture = lireSaisie(texte, mode)
		if (!lecture.ok) {
			const cle: CleTraduction =
				lecture.motif === 'borne' ? 'time.cell.invalid.bound' : lecture.motif === 'pas' ? (mode === 'quarts' ? 'time.cell.invalid.quarter' : 'time.cell.invalid.step') : 'time.cell.invalid.format'
			setEtat({ statut: 'invalide', cle })
			onAnnonce(t(cle))
			return false
		}
		if (lecture.minutes === minutesRetenues) {
			if (etat.statut !== 'enregistre') setEtat({ statut: 'repos' })
			return true
		}
		if (depasseLaJournee(saisies, ligne.cle, jour, lecture.minutes)) {
			setEtat({ statut: 'refus', cle: 'time.cell.refused.cap' })
			onAnnonce(t('time.cell.refused.cap'))
			return false
		}
		setEtat({ statut: 'envoi' })
		const issue = await ecrireCellule(client, {
			idWorkspace,
			idPersonne: personne,
			jour,
			cible: ligne.cible,
			minutes: lecture.minutes,
			existante: ligneRetenue,
		})
		if (issue.statut === 'applique') {
			retenue.current = { minutes: lecture.minutes, existante: issue.saisie }
			onEnregistre(ligneRetenue, issue.saisie, ligne.cle, jour)
			setEtat({ statut: 'enregistre' })
			onAnnonce(t('time.cell.saved', { cible: ligne.libelle }))
			return true
		}
		const cle = issue.statut === 'refus' ? REFUS[issue.motif] : 'time.cell.refused.unknown'
		setEtat({ statut: 'refus', cle })
		onAnnonce(t(cle))
		return false
	}

	const surTouche = (e: KeyboardEvent<HTMLInputElement>) => {
		const champ = e.currentTarget
		const toutSelectionne = champ.value === '' || (champ.selectionStart === 0 && champ.selectionEnd === champ.value.length)
		if (e.key === 'Enter') {
			e.preventDefault()
			void enregistrer().then((ok) => {
				if (ok && rang + 1 < nombreLignes) deplacer(rang + 1, colonne)
			})
		} else if (e.key === 'Escape') {
			e.preventDefault()
			setTexte(valeurDeChamp(minutes, mode))
			setEtat({ statut: 'repos' })
		} else if (toutSelectionne && e.key === 'ArrowDown' && rang + 1 < nombreLignes) {
			e.preventDefault()
			deplacer(rang + 1, colonne)
		} else if (toutSelectionne && e.key === 'ArrowUp' && rang > 0) {
			e.preventDefault()
			deplacer(rang - 1, colonne)
		} else if (toutSelectionne && e.key === 'ArrowRight' && colonne < 6) {
			e.preventDefault()
			deplacer(rang, colonne + 1)
		} else if (toutSelectionne && e.key === 'ArrowLeft' && colonne > 0) {
			e.preventDefault()
			deplacer(rang, colonne - 1)
		}
	}

	const enDefaut = etat.statut === 'invalide' || etat.statut === 'refus'
	const enregistree = etat.statut === 'enregistre'
	const bordure = enDefaut ? 'border-2 border-danger' : enregistree ? 'border border-success' : 'border border-border'
	const affiche = focus ? texte : mode === 'heures' && minutes > 0 ? formaterDuree(enHeures(minutes)) : texte

	return (
		<span className="relative inline-flex flex-col items-center">
			<input
				type="text"
				inputMode="decimal"
				value={affiche}
				aria-label={nom}
				aria-invalid={enDefaut}
				{...(enDefaut ? { 'aria-describedby': idMotif } : {})}
				data-ligne={rang}
				data-colonne={colonne}
				data-testid="temps-cellule"
				data-etat={etat.statut}
				onFocus={(e) => {
					setFocus(true)
					setTexte(valeurDeChamp(minutes, mode))
					const champ = e.currentTarget
					requestAnimationFrame(() => champ.select())
				}}
				onChange={(e) => {
					setTexte(e.target.value)
					if (etat.statut !== 'repos') setEtat({ statut: 'repos' })
				}}
				onBlur={() => {
					setFocus(false)
					void enregistrer()
				}}
				onKeyDown={surTouche}
				className={`h-[var(--size-target)] w-[4rem] rounded-sm bg-surface text-center tabular-nums text-text ${bordure}`}
			/>
			{enDefaut ? (
				<span id={idMotif} role="status" className="mt-1 max-w-[8rem] text-[13px] leading-tight text-danger">
					{t(etat.cle)}
				</span>
			) : null}
		</span>
	)
}

/** « Ajouter une affaire » : une combobox de recherche par titre (§5.21), qui ajoute la ligne sous son channel. */
function AjoutAffaire({
	client,
	dejaPresentes,
	onAjouter,
}: {
	readonly client: ClientCrm
	readonly dejaPresentes: ReadonlySet<string>
	readonly onAjouter: (affaire: Affaire) => void
}) {
	const [terme, setTerme] = useState('')
	const [resultats, setResultats] = useState<readonly Affaire[]>([])
	const [actif, setActif] = useState(-1)
	const idListe = useId()

	useEffect(() => {
		let courant = true
		const minuterie = setTimeout(() => {
			void chercherAffaires(client, terme).then((etat) => {
				if (courant) {
					setResultats(etat.statut === 'pret' ? etat.donnees.filter((a) => !dejaPresentes.has(a.id)) : [])
					setActif(-1)
				}
			})
		}, 200)
		return () => {
			courant = false
			clearTimeout(minuterie)
		}
		// `dejaPresentes` est recalculé à chaque rendu : la recherche ne repart que sur le terme.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [client, terme])

	const choisir = (affaire: Affaire) => {
		onAjouter(affaire)
		setTerme('')
		setResultats([])
	}

	const ouverte = terme.trim() !== '' && resultats.length > 0

	return (
		<div className="relative flex max-w-[480px] flex-col gap-1">
			<label className="inline-flex items-center gap-2 text-sm font-medium">
				<Plus aria-hidden="true" size={16} />
				{t('time.add.label')}
			</label>
			<input
				type="text"
				role="combobox"
				aria-label={t('time.add.label')}
				aria-expanded={ouverte}
				aria-controls={idListe}
				aria-autocomplete="list"
				{...(actif >= 0 ? { 'aria-activedescendant': `${idListe}-${actif}` } : {})}
				value={terme}
				placeholder={t('time.add.placeholder')}
				data-testid="temps-ajout-affaire"
				onChange={(e) => setTerme(e.target.value)}
				onKeyDown={(e) => {
					if (e.key === 'ArrowDown' && resultats.length > 0) {
						e.preventDefault()
						setActif((n) => Math.min(n + 1, resultats.length - 1))
					} else if (e.key === 'ArrowUp' && resultats.length > 0) {
						e.preventDefault()
						setActif((n) => Math.max(n - 1, 0))
					} else if (e.key === 'Enter' && actif >= 0) {
						e.preventDefault()
						const affaire = resultats[actif]
						if (affaire !== undefined) choisir(affaire)
					} else if (e.key === 'Escape') {
						setTerme('')
					}
				}}
				className="min-h-[var(--size-target)] rounded-sm border border-border bg-surface px-3 text-text"
			/>
			{ouverte ? (
				<ul id={idListe} role="listbox" className="rounded-md border border-border bg-surface py-1 shadow-card">
					{resultats.map((affaire, i) => (
						<li
							key={affaire.id}
							id={`${idListe}-${i}`}
							role="option"
							aria-selected={i === actif}
							onMouseDown={(e) => {
								e.preventDefault()
								choisir(affaire)
							}}
							className={`flex min-h-[var(--size-target)] cursor-pointer items-center px-3 ${i === actif ? 'bg-hover' : ''}`}
						>
							{affaire.title}
						</li>
					))}
				</ul>
			) : terme.trim() !== '' ? (
				<p className="text-sm text-text-2">{t('time.add.none')}</p>
			) : null}
		</div>
	)
}
