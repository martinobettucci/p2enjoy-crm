// @spec CRM-086 (docs/BACKLOG.md) — écrans de coûts, TRANCHE 4 : le MONTAGE de l'écran du §4.3,
//       le détail d'un budget, une paire de barres par occurrence et la liste de ses lignes
// @spec docs/SPEC-costs.md §4.0 (adresse `/tracks/:slugTrack/couts/:idBudget`), §4.3 (contenu),
//       §4.4 (la mention des réels inconnus), §4.7 (les états), §2.2 (les occurrences),
//       §2.3 (« nul n'est pas zéro », la devise vient du budget), §3.1 (double condition de lecture)
// @spec docs/DESIGN_SYSTEM.md §5.30 (l'histogramme), §5.9 (tableau de données), §5.8 (les états),
//       §5.7 (champs), §7 (responsive), §8 (accessibilité), §10 (aucun texte en dur),
//       §12.6 (débordement signalé)
// @spec docs/SPEC-webapp.md §5.2 (routes), §6.4 (contrat asynchrone)
//
// CET ÉCRAN NE CALCULE RIEN LUI-MÊME, comme celui du §4.2 : la lecture, le groupement par
// occurrence et le filtre vivent dans `webapp/src/lib/couts-ecrans.ts` ; le rendu des barres, du
// tableau équivalent et de la mention du §4.4 vit dans `HistogrammeCouts.tsx`. Ce fichier résout le
// track depuis son slug, appelle la lecture, traite les états, et rend la liste des lignes.
//
// LE TRACK EST RÉSOLU PAR `useContenuTrack`, ET NON PAR UNE LECTURE PROPRE — le motif exact de
// `CoutsTrack` : cette coquille a de toute façon besoin des channels pour sa barre d'onglets, et
// une seconde lecture du track pour son seul nom serait une requête payée pour rien.
//
// LE TRACK DE L'ADRESSE N'EST PAS CONFRONTÉ AU BUDGET, et c'est assumé. Le budget est lu par son
// identifiant seul, sous la politique du §3.1 ; le slug de l'adresse ne sert qu'à la coquille — son
// titre, sa barre d'onglets et le retour vers l'écran du §4.2. Une adresse forgée qui mêlerait le
// slug d'un track au budget d'un autre rendrait donc le bon budget sous le mauvais en-tête, sans
// jamais divulguer quoi que ce soit : c'est exactement le compromis déjà pris et consigné par
// `RouteCard` (INC-065), et le corriger ici seulement laisserait le défaut entier ailleurs.

import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router'
import { EtatErreur, EtatRefus, EtatVide } from '../components/ui/States'
import { SkeletonListe } from '../components/ui/Skeleton'
import { t, type CleTraduction } from '../i18n'
import { projeterChannels, useContenuTrack } from '../lib/channels'
import { enChargement, type EtatAsync } from '../lib/async'
import {
	adresseAffaireLigne,
	filtrerParOccurrence,
	grouperParOccurrence,
	lireDetailBudget,
	type BarresOccurrence,
	type DetailBudget,
	type LigneBudget,
	type OccurrenceDeLEcran,
} from '../lib/couts-ecrans'
import { clientCrm } from '../lib/supabase'
import type { ClientCrm } from '../lib/supabase'
import { AppShell } from './AppShell'
import { cheminCoutsTrack } from './chemins'
import { formaterMontant, HistogrammeCouts, type GroupeHistogramme } from './HistogrammeCouts'

/** Classes du lien de retour, identiques à celles de `CoutsTrack` (docs/DESIGN_SYSTEM.md §5.5). */
const CLASSES_RETOUR = [
	'inline-flex items-center justify-center',
	'min-h-[var(--size-target)] px-4 rounded-sm',
	'bg-brand text-white font-medium',
	'transition-colors duration-[var(--transition-duration-fast)] hover:bg-brand-hover',
].join(' ')

/**
 * Repli du titre de l'en-tête, remplacé par le nom du budget dès qu'il est connu.
 *
 * LE TITRE EST CELUI DU BUDGET, PAS CELUI DU TRACK — l'écart avec `CoutsTrack`, et il est voulu :
 * l'objet de cet écran est le budget, le track n'en est que le contexte, déjà porté par la barre
 * latérale et par la barre d'onglets. Déclaré en constante et non écrit dans le JSX : le contrôle
 * de clés mortes de `webapp/src/i18n/i18n.test.ts` cherche les clés citées entre apostrophes.
 */
const CLE_TITRE_BUDGET: CleTraduction = 'route.costs.budget.title'

export function CoutsBudget() {
	const { slugTrack, idBudget } = useParams()
	const { etat, recharger } = useContenuTrack(clientCrm, slugTrack)
	const [nomBudget, setNomBudget] = useState<string | null>(null)

	return (
		<AppShell
			cleTitreRoute={CLE_TITRE_BUDGET}
			{...(nomBudget === null ? {} : { titreRoute: nomBudget })}
			etatChannels={projeterChannels(etat)}
			onRechargerChannels={recharger}
			{...(slugTrack === undefined ? {} : { slugTrack })}
		>
			<ContenuCoutsBudget
				idBudget={idBudget}
				{...(slugTrack === undefined ? {} : { slugTrack })}
				client={clientCrm}
				onNomBudget={setNomBudget}
			/>
		</AppShell>
	)
}

/**
 * La zone principale, séparée de la coquille pour être éprouvable sans routeur ni session.
 *
 * `onNomBudget` REMONTE LE NOM À LA COQUILLE plutôt que de laisser celle-ci relire le budget. Le
 * titre de la route est une **donnée** (`docs/DESIGN_SYSTEM.md` §5.20, §5.24), et il n'est connu
 * qu'une fois la lecture faite ; une seconde lecture dans la coquille doublerait la requête, et un
 * état partagé plus haut ferait porter à la coquille un savoir qui n'est pas le sien.
 */
export function ContenuCoutsBudget({
	idBudget,
	slugTrack,
	client,
	onNomBudget,
}: {
	readonly idBudget: string | undefined
	readonly slugTrack?: string
	readonly client: ClientCrm | null
	readonly onNomBudget?: (nom: string | null) => void
}) {
	const [etat, setEtat] = useState<EtatAsync<DetailBudget | null>>(enChargement)
	const [tentative, setTentative] = useState(0)
	const [occurrenceFiltree, setOccurrenceFiltree] = useState<string | null>(null)

	useEffect(() => {
		if (client === null) return
		// Une réponse arrivée après un changement de budget ne doit pas écraser la suivante : le
		// drapeau est capturé par la fermeture, et le nettoyage de l'effet le baisse. Même garde que
		// `ContenuCoutsTrack`.
		let courant = true
		setEtat(enChargement)
		void (async () => {
			const resultat = await lireDetailBudget(client, idBudget)
			if (!courant) return
			setEtat(resultat)
			onNomBudget?.(resultat.statut === 'pret' ? (resultat.donnees?.budget.name ?? null) : null)
		})()
		return () => {
			courant = false
		}
		// `onNomBudget` est délibérément hors des dépendances : la coquille passe `setNomBudget`, dont
		// l'identité est stable, mais un appelant qui passerait une fermeture recréée à chaque rendu
		// relancerait la lecture en boucle. L'effet ne dépend que de ce qu'il LIT.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [client, idBudget, tentative])

	// Le filtre retombe sur « toutes les occurrences » à chaque changement de budget : une occurrence
	// retenue qui n'appartient pas au budget affiché viderait la table sans que rien ne le dise.
	useEffect(() => {
		setOccurrenceFiltree(null)
	}, [idBudget])

	const detail = etat.statut === 'pret' ? etat.donnees : null
	const groupes = useMemo(
		() => (detail === null ? [] : grouperParOccurrence(detail)),
		[detail],
	)
	const lignesFiltrees = useMemo(
		() => (detail === null ? [] : filtrerParOccurrence(detail.lignes, occurrenceFiltree)),
		[detail, occurrenceFiltree],
	)

	if (etat.statut === 'chargement') {
		return (
			<div className="py-2">
				<SkeletonListe lignes={4} libelle={t('state.loading.aria')} />
			</div>
		)
	}

	if (etat.statut === 'erreur') {
		if (etat.erreur.nature === 'forbidden') {
			return <EtatRefus titre={t('state.forbidden.title')} corps={t('state.forbidden.body')} />
		}
		return (
			<EtatErreur
				titre={t('state.error.title')}
				corps={t(etat.erreur.nature === 'network' ? 'state.error.network' : 'state.error.unknown')}
				libelleReprise={t('state.error.retry')}
				onReprise={() => setTentative((precedente) => precedente + 1)}
			/>
		)
	}

	// UN BUDGET INEXISTANT, UN BUDGET FERMÉ À L'APPELANT ET UN IDENTIFIANT MAL FORMÉ RENDENT LE MÊME
	// ÉCRAN, et c'est la règle du §7 de `docs/SPEC-permissions-rls.md` — les distinguer renseignerait
	// un appelant sans droit sur l'existence d'un budget. Le retour mène aux coûts du track, jamais à
	// la racine : c'est de là qu'on vient, et c'est là que les autres budgets se trouvent.
	if (detail === null) {
		return (
			<EtatVide
				titre={t('costs.budget.notfound.title')}
				corps={t('costs.budget.notfound.body')}
				action={
					<Link to={slugTrack === undefined ? '/' : cheminCoutsTrack(slugTrack)} className={CLASSES_RETOUR}>
						{t('costs.budget.notfound.action')}
					</Link>
				}
			/>
		)
	}

	const devise = detail.budget.currency
	const total = groupes.reduce(
		(cumul, groupe) => ({
			estime: cumul.estime + groupe.agregat.estime,
			reel: cumul.reel + groupe.agregat.reel,
			sansReel: cumul.sansReel + groupe.agregat.sansReel,
			estimeSansReel: cumul.estimeSansReel + groupe.agregat.estimeSansReel,
			lignes: cumul.lignes + groupe.agregat.lignes,
		}),
		{ estime: 0, reel: 0, sansReel: 0, estimeSansReel: 0, lignes: 0 },
	)

	return (
		<div className="flex flex-col gap-8 max-w-[960px]">
			<EnTeteBudget budget={detail.budget} occurrences={detail.occurrences} />

			<HistogrammeCouts
				devise={devise}
				groupes={enGroupesOccurrence(groupes)}
				total={total}
				legendeColonne={t('costs.budget.column')}
			/>

			<TableLignes
				lignes={lignesFiltrees}
				devise={devise}
				occurrences={detail.occurrences}
				occurrenceFiltree={occurrenceFiltree}
				onFiltrer={setOccurrenceFiltree}
				recurrent={detail.budget.is_recurrent}
			/>
		</div>
	)
}

/**
 * L'identité du budget : sa devise, son enveloppe, et les deux états du §4.7 qui lui sont propres.
 *
 * UNE LISTE DE DÉFINITIONS ET NON UN TABLEAU (`docs/DESIGN_SYSTEM.md` §5.20) : ce sont des couples
 * terme / valeur qui ne se comparent pas entre eux. « Enveloppe » lue seule, puis un nombre lu
 * seul, ne dirait pas que l'un qualifie l'autre — la règle du §5.3 bis.
 *
 * UNE ENVELOPPE NON RENSEIGNÉE NE REND AUCUNE LIGNE. Le §2.1 la déclare facultative, et une ligne
 * vide se lirait comme une enveloppe nulle — la distinction entre « ne se prononce pas » et
 * « vaut zéro » est une règle du produit (§5.18 du design system).
 */
function EnTeteBudget({
	budget,
	occurrences,
}: {
	readonly budget: DetailBudget['budget']
	readonly occurrences: readonly OccurrenceDeLEcran[]
}) {
	const clos = budget.closed_at !== null
	return (
		<section className="flex flex-col gap-3" aria-label={t('costs.budget.identity.aria')}>
			<dl className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-2 text-sm max-w-[560px]">
				<div className="flex gap-2">
					<dt className="text-text-2">{t('costs.budget.currency')}</dt>
					<dd className="font-mono tabular-nums text-ink">{budget.currency}</dd>
				</div>
				{budget.planned_amount === null ? null : (
					<div className="flex gap-2">
						<dt className="text-text-2">{t('costs.budget.planned')}</dt>
						<dd className="font-mono tabular-nums text-ink">
							{formaterMontant(budget.planned_amount, budget.currency)}
						</dd>
					</div>
				)}
			</dl>

			{/* La pilule « clôturé » du §5.6 : un MOT et une icône, jamais une teinte seule. Le jeton
			    est neutre et non `--color-danger` — la règle du §5.31 : un budget clos n'est pas une
			    erreur, et ses lignes restent lisibles et saisissables (§2.3). */}
			{clos ? (
				<p className="inline-flex items-center gap-2 self-start rounded-full bg-hover px-3 py-1 text-sm text-text-2">
					<span className="inline-block size-2 rounded-full bg-text-3" aria-hidden="true" />
					{t('costs.budget.closed')}
				</p>
			) : null}

			{/* L'état « budget récurrent sans occurrence » du §4.7. Il ne vaut QUE pour un budget
			    récurrent : un budget qui n'en porte aucune parce qu'il n'en admet aucune est le cas
			    ordinaire, et l'annoncer serait du bruit à chaque ouverture de l'écran. */}
			{budget.is_recurrent && occurrences.length === 0 ? (
				<p className="text-sm text-text-2">{t('costs.budget.nooccurrence')}</p>
			) : null}
		</section>
	)
}

/**
 * Traduit les paires de barres par occurrence en groupes rendables.
 *
 * `precision` PORTE LA PÉRIODE, et c'est ici que le champ déclaré à la tranche 2 trouve son emploi :
 * le §2.2 pose qu'un libellé d'occurrence est LIBRE — rien n'oblige « Janvier 2026 » à couvrir
 * janvier —, et les deux bornes sont « purement descriptives ». Les rendre sous le libellé dit ce
 * que le libellé ne garantit pas, sans jamais le contredire.
 *
 * LA PÉRIODE EST COMPOSÉE PAR UNE CLÉ DE TRADUCTION, JAMAIS PAR CONCATÉNATION (§10) : trois formes
 * existent — les deux bornes, la seule ouverture, la seule fin —, et « du … au … » ne se construit
 * pas en collant deux dates avec un tiret.
 */
export function enGroupesOccurrence(
	groupes: readonly BarresOccurrence[],
): readonly GroupeHistogramme[] {
	return groupes.map((groupe) => {
		const occurrence = groupe.occurrence
		if (occurrence === null) {
			// Le groupe sans occurrence : sur un budget non récurrent, c'est LE budget ; sur un budget
			// récurrent, ce sont les lignes qu'aucune occurrence listée ne réclame. Les deux se lisent
			// « Sans occurrence » — l'un décrit la seule paire de l'écran, l'autre un reliquat que
			// taire ferait disparaître un montant du total.
			return { cle: 'sans-occurrence', libelle: t('costs.budget.nooccurrence.group'), agregat: groupe.agregat }
		}
		const periode = formaterPeriode(occurrence)
		return {
			cle: occurrence.id,
			libelle: occurrence.label,
			...(periode === null ? {} : { precision: periode }),
			agregat: groupe.agregat,
		}
	})
}

/**
 * La période d'une occurrence en toutes lettres, ou `null` lorsqu'elle n'en porte aucune.
 *
 * Le format court est celui du §5.14 et du §5.16 du design system — « deux dates du même produit ne
 * se lisent pas dans deux formats ». Une valeur que `Date` ne sait pas lire est traitée comme
 * absente plutôt que rendue « Invalid Date » : le type généré ne garantit aucune valeur
 * (`docs/SPEC-types.md`).
 */
export function formaterPeriode(
	occurrence: Pick<OccurrenceDeLEcran, 'period_start' | 'period_end'>,
	locale = 'fr-FR',
): string | null {
	const debut = dateCourte(occurrence.period_start, locale)
	const fin = dateCourte(occurrence.period_end, locale)
	if (debut !== null && fin !== null) return t('costs.budget.period.range', { debut, fin })
	if (debut !== null) return t('costs.budget.period.from', { debut })
	if (fin !== null) return t('costs.budget.period.until', { fin })
	return null
}

function dateCourte(valeur: string | null, locale: string): string | null {
	if (valeur === null) return null
	const date = new Date(valeur)
	if (Number.isNaN(date.getTime())) return null
	return new Intl.DateTimeFormat(locale, { dateStyle: 'short' }).format(date)
}

/**
 * La liste des lignes de coût — « affaire, libellé, estimé, réel, auteur » (§4.3).
 *
 * CINQ COLONNES, EXACTEMENT CELLES QUE LA SPÉCIFICATION ÉNUMÈRE. Une sixième colonne « Occurrence »
 * a été écartée : le §4.3 rend la liste « filtrable par occurrence », et c'est le filtre qui porte
 * cette dimension — l'histogramme juste au-dessus la porte déjà, une paire de barres par occurrence.
 *
 * LE TABLEAU DU §5.9, SANS ÉCART : `table` sémantique, en-tête collant, une ligne de texte par
 * cellule en ellipse avec la valeur entière en `title`, séparateurs sans zébrure, montants alignés
 * à droite en chiffres tabulaires, conteneur `overflow-x-auto` portant `.indique-debordement-x`
 * (§12.6) pour que la page ne défile jamais horizontalement (§7).
 */
function TableLignes({
	lignes,
	devise,
	occurrences,
	occurrenceFiltree,
	onFiltrer,
	recurrent,
}: {
	readonly lignes: readonly LigneBudget[]
	readonly devise: string
	readonly occurrences: readonly OccurrenceDeLEcran[]
	readonly occurrenceFiltree: string | null
	readonly onFiltrer: (idOccurrence: string | null) => void
	readonly recurrent: boolean
}) {
	// Le filtre n'existe QUE s'il y a quelque chose à filtrer — la règle du §5.11 pour la barre de
	// filtres du fil : un contrôle sans objet est du bruit. Un budget non récurrent n'a aucune
	// occurrence par construction (§2.2), et un budget récurrent qui n'en porte encore aucune non
	// plus. Le seuil porte sur les occurrences CHARGÉES, jamais sur les lignes filtrées, sinon un
	// filtre trop restrictif ferait disparaître le moyen de le lever.
	const filtrable = recurrent && occurrences.length > 0

	return (
		<section className="flex flex-col gap-3" aria-label={t('costs.budget.lines.aria')}>
			<h2 className="text-[20px] font-bold text-ink">{t('costs.budget.lines.title')}</h2>

			{filtrable ? (
				<div className="flex flex-col gap-1 max-w-[320px]">
					<label htmlFor="couts-budget-filtre-occurrence" className="text-sm text-text-2">
						{t('costs.budget.filter.label')}
					</label>
					<select
						id="couts-budget-filtre-occurrence"
						className="min-h-[var(--size-target)] rounded-sm border border-border bg-surface px-3 text-sm text-ink"
						value={occurrenceFiltree ?? ''}
						onChange={(evenement) =>
							onFiltrer(evenement.target.value === '' ? null : evenement.target.value)
						}
					>
						{/* L'option vide est le moyen de LEVER le filtre, exactement comme l'option vide
						    d'un `select` de formulaire est le moyen de vider un champ (§5.22). */}
						<option value="">{t('costs.budget.filter.all')}</option>
						{occurrences.map((occurrence) => (
							<option key={occurrence.id} value={occurrence.id}>
								{occurrence.label}
							</option>
						))}
					</select>
				</div>
			) : null}

			{lignes.length === 0 ? (
				<p className="text-sm text-text-2">
					{occurrenceFiltree === null
						? t('costs.budget.lines.empty')
						: t('costs.budget.lines.empty.filtered')}
				</p>
			) : (
				<div className="overflow-x-auto indique-debordement-x [contain:paint]">
					<table className="w-full text-sm border-collapse">
						<caption className="sr-only">{t('costs.budget.lines.caption')}</caption>
						<thead>
							<tr className="text-left text-text-2 border-b border-border">
								<th scope="col" className="py-2 pr-4 font-medium">
									{t('costs.budget.lines.column.card')}
								</th>
								<th scope="col" className="py-2 px-4 font-medium">
									{t('costs.budget.lines.column.label')}
								</th>
								<th scope="col" className="py-2 px-4 font-medium text-right">
									{t('costs.chart.legend.planned')}
								</th>
								<th scope="col" className="py-2 px-4 font-medium text-right">
									{t('costs.chart.legend.actual')}
								</th>
								<th scope="col" className="py-2 pl-4 font-medium">
									{t('costs.budget.lines.column.author')}
								</th>
							</tr>
						</thead>
						<tbody>
							{lignes.map((ligne) => (
								<LigneCoutBudget key={ligne.id} ligne={ligne} devise={devise} />
							))}
						</tbody>
					</table>
				</div>
			)}
		</section>
	)
}

/**
 * Une ligne du tableau.
 *
 * TROIS RÈGLES QUI NE SE DEVINENT PAS.
 *
 * 1. **Un coût réel non saisi laisse la cellule VIDE** (§5.9) : ni tiret, ni « non renseigné », ni
 *    zéro. Le §2.3 pose que « nul n'est pas zéro », et écrire `0 €` transformerait un retard de
 *    saisie en dépense nulle — la principale façon dont cet écran mentirait (§4.4). Le compte des
 *    lignes concernées est porté par la mention sous l'histogramme, pas par la cellule.
 *
 * 2. **Un auteur inconnu est un TEXTE, pas une cellule vide** — la règle du §5.16 : `created_by`
 *    est `on delete set null`, et un profil supprimé laisse un fait à nommer, non une donnée
 *    absente.
 *
 * 3. **Le titre de l'affaire est un lien quand elle est adressable, et un texte sinon.** Un lien
 *    vers une adresse incomplète mènerait à un écran que l'utilisateur croirait cassé
 *    (`adresseAffaireLigne`). L'affaire archivée garde son lien : « une affaire archivée est une
 *    affaire réelle » (§5.24), et sa pilule le dit.
 */
function LigneCoutBudget({
	ligne,
	devise,
}: {
	readonly ligne: LigneBudget
	readonly devise: string
}) {
	const affaire = ligne.cards
	const adresse = adresseAffaireLigne(ligne)
	const titre = affaire?.title ?? null

	return (
		<tr className="border-b border-border hover:bg-hover h-[var(--size-target)]">
			<th scope="row" className="py-2 pr-4 font-normal text-left text-ink max-w-[28ch] truncate">
				{titre === null ? (
					<span className="text-text-2">{t('costs.budget.lines.card.unknown')}</span>
				) : adresse === null ? (
					<span title={titre}>{titre}</span>
				) : (
					<Link to={adresse} className="text-brand hover:underline" title={titre}>
						{titre}
					</Link>
				)}
				{affaire?.archived_at == null ? null : (
					<span className="ml-2 inline-flex items-center rounded-full bg-accent-soft px-2 text-[12px] text-accent-on-soft align-middle">
						{t('costs.budget.lines.card.archived')}
					</span>
				)}
			</th>
			<td className="py-2 px-4 max-w-[24ch] truncate" title={ligne.label}>
				{ligne.label}
			</td>
			<td className="py-2 px-4 text-right font-mono tabular-nums">
				{formaterMontant(ligne.estimated_cost, devise)}
			</td>
			<td className="py-2 px-4 text-right font-mono tabular-nums">
				{ligne.actual_cost === null ? null : formaterMontant(ligne.actual_cost, devise)}
			</td>
			<td className="py-2 pl-4 max-w-[20ch] truncate">
				{ligne.profiles === null ? (
					<span className="text-text-2">{t('costs.budget.lines.author.unknown')}</span>
				) : (
					<span title={ligne.profiles.full_name}>{ligne.profiles.full_name}</span>
				)}
			</td>
		</tr>
	)
}
