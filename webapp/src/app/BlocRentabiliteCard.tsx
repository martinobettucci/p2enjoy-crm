// @spec CRM-108 (docs/BACKLOG.md) — tranche T3 : le bloc « Rentabilité » de la fiche d'une affaire
// @spec docs/SPEC-recettes.md §4.1 à §4.4 (grandeurs, marge prévue, partielle, plusieurs devises), §6.2 (ce bloc :
//       prévu et réel, taux, « non calculable », lien vers l'écran ; ABSENT quand la base refuse en `42501`)
// @spec docs/DESIGN_SYSTEM.md §5.60 (après « Temps passé », carte bordée, `dl`, marge négative en pastille de danger,
//       pilule neutre « partielle » au nom accessible complet, lien « Ouvrir dans Rentabilité » icône `Scale`), §8, §10
// @spec CRM-126 (docs/BACKLOG.md) — tranche T2 : docs/SPEC-recettes.md §4.4 et §6.2 révisés (décision 810) — un seul
//       tableau, une valeur par devise empilée dans chaque cellule, le code devise en élément propre, le taux absent sur
//       une affaire à plusieurs devises ; docs/DESIGN_SYSTEM.md §5.60 (« UNE VALEUR PAR DEVISE », écart au §5.9)
//
// LA CAPACITÉ D'ADMINISTRER L'ESPACE EST LUE D'ABORD (`workspaces.administration_permise`, `CRM-093`), et la fonction
// n'est appelée que si la base la PERMET : un refus `42501` attendu laisserait une erreur réseau 403 dans la console de
// chaque fiche d'un non-administrateur — défaut trouvé par les campagnes E2E des autres unités (précision de T3,
// docs/SPEC-recettes.md §6.2). Une capacité refusée, ou illisible, retire le bloc ; un `42501` malgré tout le retire aussi.

import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { Scale } from 'lucide-react'
import { Button } from '../components/ui/Button'
import { SkeletonListe } from '../components/ui/Skeleton'
import { t, type CleTraduction } from '../i18n'
import { enChargement, type EtatAsync } from '../lib/async'
import {
	calculerLigne,
	type CausesPartielle,
	type LigneRentabilite,
	type Rentabilite,
	type RentabiliteLigne,
} from '../lib/rentabilite'
import { lireRentabilite } from '../lib/rentabilite-lecture'
import { lireCapacitesEspace } from '../lib/capacites'
import type { ClientCrm } from '../lib/supabase'
import { CHEMIN_RENTABILITE } from './chemins'

const FORMAT_MONTANT = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const FORMAT_TAUX = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })

export const montantEnClair = (v: number): string => FORMAT_MONTANT.format(v)

/** Le nom accessible de la pilule « partielle » : chaque cause présente, par clé (§5.60). */
export function raisonPartielle(c: CausesPartielle): string {
	const parties: string[] = []
	const accorder = (n: number, un: CleTraduction, plusieurs: CleTraduction) =>
		parties.push(t(n === 1 ? un : plusieurs, { n: String(n) }))
	if (c.recettesSansReel > 0) accorder(c.recettesSansReel, 'rentab.partial.revenues.one', 'rentab.partial.revenues.many')
	if (c.coutsSansReel > 0) accorder(c.coutsSansReel, 'rentab.partial.costs.one', 'rentab.partial.costs.many')
	if (c.minutesNonValorisees > 0) parties.push(t('rentab.partial.time', { duree: dureeEnClair(c.minutesNonValorisees) }))
	return t('rentab.partial.aria', { raisons: parties.join(', ') })
}

/** « 2 h », « 1 h 45 », « 30 min » — au quart d'heure, comme la saisie de temps. */
export function dureeEnClair(minutes: number): string {
	const h = Math.floor(minutes / 60)
	const m = minutes % 60
	if (h === 0) return t('rentab.duration.minutes', { m: String(m) })
	return m === 0 ? t('rentab.duration.hours', { h: String(h) }) : t('rentab.duration.hoursMinutes', { h: String(h), m: String(m).padStart(2, '0') })
}

/** Une valeur suivie de son code devise, dans son propre élément (§5.48, §5.60). */
export type ValeurDevise = { readonly devise: string; readonly valeur: number }

/** Les valeurs connues d'une grandeur, une par devise, dans l'ordre des balances. */
export const valeursDe = (r: RentabiliteLigne, grandeur: (x: Rentabilite) => number | null): readonly ValeurDevise[] =>
	r.parDevise.flatMap((b) => {
		const valeur = grandeur(b.rentabilite)
		return valeur === null ? [] : [{ devise: b.devise, valeur }]
	})

function Code({ devise }: { readonly devise: string }) {
	return <span className="text-sm text-text-2">{devise}</span>
}

/** Une valeur par devise, empilées dans la cellule (§5.60, écart au §5.9) ; rien quand aucune n'est connue. */
export function ParDevise({ valeurs }: { readonly valeurs: readonly ValeurDevise[] }) {
	if (valeurs.length === 0) return null
	return (
		<span className="inline-flex flex-col items-end gap-1">
			{valeurs.map((v) => (
				<span key={v.devise} data-testid="rentab-valeur" data-devise={v.devise} className="inline-flex items-baseline gap-1 whitespace-nowrap">
					<span className="tabular-nums">{montantEnClair(v.valeur)}</span>
					<Code devise={v.devise} />
				</span>
			))}
		</span>
	)
}

/** Les taux connus d'une ligne ; le code n'est dit que si la ligne a plusieurs devises (§5.60). */
export function Taux({ r }: { readonly r: RentabiliteLigne }) {
	const taux = valeursDe(r, (x) => x.taux)
	if (taux.length === 0) return null
	return (
		<span className="inline-flex flex-col items-end gap-1">
			{taux.map((v) => (
				<span key={v.devise} data-testid="rentab-taux-devise" data-devise={v.devise} className="inline-flex items-baseline gap-1 whitespace-nowrap">
					<span className="tabular-nums">{`${FORMAT_TAUX.format(v.valeur)} %`}</span>
					{r.parDevise.length > 1 ? <Code devise={v.devise} /> : null}
				</span>
			))}
		</span>
	)
}

/**
 * Les marges d'une ligne, une balance par devise : son signe, la pastille de danger sur chaque valeur négative seule, puis
 * la pilule « partielle », une par ligne (§4.4, §5.60).
 */
export function Marge({ r }: { readonly r: RentabiliteLigne }) {
	const marges = valeursDe(r, (x) => x.marge)
	if (marges.length === 0) return null
	return (
		<span className="inline-flex flex-wrap items-center justify-end gap-2">
			<span className="inline-flex flex-col items-end gap-1">
				{marges.map((m) => {
					const negative = m.valeur < 0
					return (
						<span key={m.devise} className="inline-flex items-baseline gap-1 whitespace-nowrap">
							<span
								data-testid="rentab-marge"
								data-devise={m.devise}
								data-negative={negative ? 'oui' : 'non'}
								className={
									negative
										? 'inline-flex items-center rounded-full bg-danger-soft px-2 text-danger-on-soft tabular-nums'
										: 'tabular-nums'
								}
							>
								{montantEnClair(m.valeur)}
							</span>
							<Code devise={m.devise} />
						</span>
					)
				})}
			</span>
			{r.partielle === null ? null : <PilulePartielle causes={r.partielle} />}
		</span>
	)
}

export function PilulePartielle({ causes }: { readonly causes: CausesPartielle }) {
	const nom = raisonPartielle(causes)
	return (
		<span
			data-testid="rentab-partielle"
			role="img"
			aria-label={nom}
			title={nom}
			className="inline-flex items-center gap-1 rounded-full bg-hover px-2 text-xs text-text-2"
		>
			<span aria-hidden="true" className="inline-block size-2 rounded-full bg-text-3" />
			<span aria-hidden="true">{t('rentab.partial')}</span>
		</span>
	)
}

type Lecture = EtatAsync<readonly LigneRentabilite[]> | { readonly statut: 'refusee' }

export function BlocRentabiliteCard({
	client,
	idCard,
	idWorkspace,
	relecture = 0,
}: {
	readonly client: ClientCrm | null
	readonly idCard: string
	/** L'espace de l'affaire, dont la capacité d'administration décide si la rentabilité est lue. */
	readonly idWorkspace: string
	/** Incrémenté par la fiche quand une recette, un coût ou un temps vient d'être écrit. */
	readonly relecture?: number
}) {
	const [etat, setEtat] = useState<Lecture>(enChargement)
	const [tentative, setTentative] = useState(0)
	const courant = useRef(0)

	useEffect(() => {
		if (client === null) return
		const rang = ++courant.current
		void (async () => {
			const capacite = await lireCapacitesEspace(client, idWorkspace)
			if (rang !== courant.current) return
			if (capacite.statut !== 'pret' || capacite.donnees.administration !== 'permise') {
				setEtat({ statut: 'refusee' })
				return
			}
			const lu = await lireRentabilite(client, { du: null, au: null }, idCard)
			if (rang !== courant.current) return
			if (lu.statut === 'erreur' && lu.erreur.nature === 'forbidden') setEtat({ statut: 'refusee' })
			else if (lu.statut === 'pret') setEtat({ statut: 'pret', donnees: lu.donnees.lignes })
			else setEtat(lu.statut === 'erreur' ? lu : enChargement())
		})()
	}, [client, idCard, idWorkspace, tentative, relecture])

	// Refusée par la base : le bloc n'est pas rendu (§6.2). Sans client : rien où lire.
	if (client === null || etat.statut === 'refusee') return null

	return (
		<section
			data-testid="bloc-rentabilite-card"
			aria-labelledby="rentabilite-card-titre"
			className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4 min-w-0"
		>
			<div className="flex flex-wrap items-center justify-between gap-2">
				<h2 id="rentabilite-card-titre" className="text-h3 font-medium">
					{t('rentab.card.title')}
				</h2>
				<Link to={CHEMIN_RENTABILITE} className="inline-flex min-h-[var(--size-target)] items-center gap-1 text-sm text-brand hover:underline">
					<Scale aria-hidden="true" size={16} strokeWidth={2} />
					{t('rentab.card.open')}
				</Link>
			</div>
			{etat.statut === 'chargement' ? <SkeletonListe lignes={2} libelle={t('state.loading.aria')} /> : null}
			{etat.statut === 'erreur' ? (
				<div className="flex flex-col items-start gap-2">
					<p role="alert" className="text-sm text-danger-on-soft">
						{t('rentab.card.error')}
					</p>
					<Button taille="compacte" variante="secondaire" onClick={() => setTentative((n) => n + 1)}>
						{t('card.revenues.error.retry')}
					</Button>
				</div>
			) : null}
			{etat.statut === 'pret' ? <Contenu lignes={etat.donnees} /> : null}
		</section>
	)
}

function Contenu({ lignes }: { readonly lignes: readonly LigneRentabilite[] }) {
	if (lignes.length === 0) {
		return (
			<p data-testid="rentab-card-vide" className="text-sm text-text-3">
				{t('rentab.card.empty')}
			</p>
		)
	}
	// Une ligne de la fonction par devise : un seul tableau, une balance par devise (§4.4, révision CRM-126).
	const montants = new Map(lignes.map((l) => [l.devise, l]))
	const plusieursDevises = montants.size > 1
	const reel = calculerLigne(montants, 'reel', plusieursDevises)
	const prevu = calculerLigne(montants, 'prevu', plusieursDevises)
	const taux = valeursDe(reel, (x) => x.taux)
	return (
		<div className="flex flex-col gap-4">
			<div className="flex flex-col gap-2">
				<table className="w-full border-collapse text-sm">
					<caption className="sr-only">{t('rentab.card.caption')}</caption>
					<thead>
						<tr className="border-b border-border text-text-2">
							<th scope="col" className="h-[var(--size-target)] px-2 text-left font-medium">
								<span className="sr-only">{t('rentab.card.quantity')}</span>
							</th>
							<th scope="col" className="h-[var(--size-target)] px-2 text-right font-medium">
								{t('rentab.view.prevu')}
							</th>
							<th scope="col" className="h-[var(--size-target)] px-2 text-right font-medium">
								{t('rentab.view.reel')}
							</th>
						</tr>
					</thead>
					<tbody>
						{(
							[
								['rentab.column.revenues', (x: Rentabilite) => x.recettes],
								['rentab.column.costs', (x: Rentabilite) => x.couts],
								['rentab.column.staff', (x: Rentabilite) => x.personnel],
							] as const
						).map(([cle, grandeur]) => (
							<tr key={cle} className="border-b border-border">
								<th scope="row" className="h-[var(--size-target)] px-2 text-left font-normal">
									{t(cle)}
								</th>
								<td className="px-2 py-1 text-right">
									<ParDevise valeurs={valeursDe(prevu, grandeur)} />
								</td>
								<td className="px-2 py-1 text-right">
									<ParDevise valeurs={valeursDe(reel, grandeur)} />
								</td>
							</tr>
						))}
						<tr>
							<th scope="row" className="h-[var(--size-target)] px-2 text-left font-medium">
								{t('rentab.column.margin')}
							</th>
							<td className="px-2 py-1 text-right">
								<Marge r={prevu} />
							</td>
							<td className="px-2 py-1 text-right">
								<Marge r={reel} />
							</td>
						</tr>
					</tbody>
				</table>
				{/* Le taux d'une affaire à plusieurs devises n'est pas rendu (§4.4) : `calculerLigne` le laisse vide. */}
				{taux.length === 1 ? (
					<p data-testid="rentab-taux" className="text-sm text-text-2">
						{t('rentab.card.rate', { taux: FORMAT_TAUX.format(taux[0]!.valeur) })}
					</p>
				) : null}
			</div>
			<p className="text-sm text-text-2">{t('rentab.note.prevu')}</p>
		</div>
	)
}
