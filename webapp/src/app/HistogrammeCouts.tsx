// @spec CRM-086 (docs/BACKLOG.md) — écrans de coûts, TRANCHE 2 : l'histogramme prévisionnel / réel,
//       composant partagé par les trois écrans des §4.2, §4.3 et §4.5
// @spec docs/SPEC-costs.md §4.2 (deux barres adjacentes par budget, les trois jetons),
//       §4.4 (ce que l'écran dit du réel inconnu), §4.7 (les états)
// @spec docs/DESIGN_SYSTEM.md §5.30 (détail visuel : axe à zéro, valeurs en clair, légende,
//       tableau équivalent, mention des réels manquants, état vide), §1 (la couleur ne porte
//       jamais seule l'information), §2 (les montants sont des données techniques)
// @spec docs/SPEC-webapp.md §5.3 (composants livrés)
//
// TROIS RÈGLES DU §5.30 SONT STRUCTURELLES ICI, ET AUCUNE N'EST OPTIONNELLE.
//
// 1. **L'axe part de zéro, toujours.** La hauteur d'une barre est sa valeur rapportée au maximum du
//    graphique, jamais à un intervalle resserré autour des valeurs. Une échelle tronquée exagère
//    visuellement un écart et ferait mentir la comparaison qui est l'objet même de cet écran.
//
// 2. **La couleur ne porte jamais seule l'information** (§1). Chaque barre affiche sa valeur en
//    clair, la légende nomme les deux séries, et un TABLEAU ÉQUIVALENT est rendu sous le graphique.
//    Le graphique lui-même est donc `aria-hidden` : le rendre accessible par des attributs ARIA
//    dupliquerait ce que le tableau dit déjà mieux, et un lecteur d'écran entendrait deux fois la
//    même série. C'est le tableau qui est la version accessible, comme le §5.30 l'écrit.
//
// 3. **La mention des réels manquants est OBLIGATOIRE dès qu'une ligne n'a pas de réel** (§4.4).
//    Elle n'est pas un ornement : sans elle, un réel bas se lit comme une économie alors qu'il
//    n'est qu'une saisie en retard. Le composant la rend depuis l'agrégat, et ne laisse donc pas
//    à son appelant la possibilité de l'oublier.

import { depasse, type AgregatCouts } from '../lib/couts-ecrans'
import { t } from '../i18n'

/**
 * Un montant se rend en **donnée technique** (`docs/DESIGN_SYSTEM.md` §2 et §5.7 bis) : monospace,
 * chiffres tabulaires. Le formatage est délégué à `Intl`, jamais construit par concaténation — la
 * place du symbole et le séparateur des milliers sont des règles de langue, pas de composant.
 *
 * EXPORTÉ, et c'est délibéré : les trois écrans de coûts rendent des montants, et les laisser
 * chacun redéfinir cette fonction est exactement la duplication déjà présente entre `Board.tsx` et
 * `ListeCards.tsx` — consignée au registre plutôt que corrigée au passage (`CLAUDE.md` §3.1), mais
 * pas reproduite une troisième fois ici.
 */
export function formaterMontant(montant: number, devise: string): string {
	try {
		return new Intl.NumberFormat('fr-FR', {
			style: 'currency',
			currency: devise,
			maximumFractionDigits: 0,
		}).format(montant)
	} catch {
		// Une devise que le navigateur ne connaît pas ne doit pas faire tomber l'écran : le montant
		// reste lisible, suivi du code que la base porte.
		return `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(montant)} ${devise}`
	}
}

/** Une paire de barres : ce qui la nomme, et ce qu'elle vaut. */
export type GroupeHistogramme = {
	readonly cle: string
	readonly libelle: string
	/** Rendu sous le libellé quand il existe — le nom de l'affaire, la période d'une occurrence. */
	readonly precision?: string
	readonly agregat: AgregatCouts
}

/**
 * Hauteur d'une barre, en pourcentage de la hauteur du graphique.
 *
 * L'ÉCHELLE EST COMMUNE À TOUT LE GRAPHIQUE et rapportée au maximum ABSOLU des valeurs, prévisionnel
 * et réel confondus : deux barres de séries différentes ne seraient pas comparables si chacune était
 * rapportée au maximum de sa propre série, ce qui est précisément la comparaison que l'écran existe
 * pour porter.
 *
 * LA VALEUR ABSOLUE EST PRISE POUR L'ÉCHELLE, PAS POUR LA BARRE. Le §2.1 pose qu'un avoir est un
 * coût négatif légitime ; un maximum calculé sur les valeurs signées vaudrait zéro sur un graphique
 * entièrement négatif, et toutes les barres seraient pleines. La hauteur rendue reste celle de la
 * valeur absolue, et c'est l'étiquette — qui porte le signe — qui dit le sens.
 *
 * Un maximum nul rend zéro plutôt que `NaN` : c'est l'état vide du §4.7, « deux barres nulles »,
 * et non un défaut de calcul.
 */
export function hauteurPourcent(valeur: number, maximum: number): number {
	if (maximum <= 0) return 0
	return Math.min(100, (Math.abs(valeur) / maximum) * 100)
}

/** Le maximum absolu d'un jeu de groupes — l'échelle commune du graphique. */
export function echelle(groupes: readonly GroupeHistogramme[]): number {
	let maximum = 0
	for (const groupe of groupes) {
		maximum = Math.max(maximum, Math.abs(groupe.agregat.estime), Math.abs(groupe.agregat.reel))
	}
	return maximum
}

export type ProprietesHistogramme = {
	readonly devise: string
	readonly groupes: readonly GroupeHistogramme[]
	/** Le total de la devise — il porte la mention du §4.4 rendue sous le graphique. */
	readonly total: AgregatCouts
	/** Nommé par l'écran appelant : « Budgets du track », « Occurrences », « Tracks du workspace ». */
	readonly legendeColonne: string
}

const HAUTEUR_GRAPHIQUE = 'h-[180px]'

export function HistogrammeCouts({
	devise,
	groupes,
	total,
	legendeColonne,
}: ProprietesHistogramme) {
	const maximum = echelle(groupes)

	return (
		<section className="flex flex-col gap-4" aria-label={t('costs.chart.region', { devise })}>
			<Legende />

			{groupes.length === 0 ? (
				<p className="text-sm text-text-2">{t('costs.chart.empty')}</p>
			) : (
				// `contain: paint` ferme la propagation de la largeur intrinsèque jusqu'à la racine —
				// c'est le défaut MESURÉ à la décision 474 sur la table des coûts d'une affaire, où la
				// page gagnait 274 px de défilement horizontal fantôme malgré l'`overflow-x: hidden`
				// de `html`. Un graphique à barres est encore plus exposé : sa largeur croît avec le
				// nombre de budgets.
				<div className="overflow-x-auto [contain:paint]" aria-hidden="true">
					<div className={`flex items-end gap-6 ${HAUTEUR_GRAPHIQUE} pt-6`}>
						{groupes.map((groupe) => (
							<div key={groupe.cle} className="flex flex-col justify-end h-full gap-1 shrink-0">
								<div className="flex items-end gap-1 h-full">
									<Barre
										valeur={groupe.agregat.estime}
										maximum={maximum}
										devise={devise}
										classes="bg-brand"
									/>
									<Barre
										valeur={groupe.agregat.reel}
										maximum={maximum}
										devise={devise}
										classes={depasse(groupe.agregat) ? 'bg-danger' : 'bg-success'}
									/>
								</div>
								<span className="text-sm text-text-2 max-w-[14ch] truncate" title={groupe.libelle}>
									{groupe.libelle}
								</span>
							</div>
						))}
					</div>
				</div>
			)}

			<TableauEquivalent
				devise={devise}
				groupes={groupes}
				total={total}
				legendeColonne={legendeColonne}
			/>

			<MentionReelsManquants total={total} devise={devise} />
		</section>
	)
}

/**
 * Une barre, sa valeur en clair au-dessus.
 *
 * La valeur est rendue MÊME À ZÉRO : le §4.7 exige que l'état vide se voie — « deux barres nulles
 * sans texte se lisent comme un défaut d'affichage ». Une barre à zéro garde une hauteur minimale
 * d'un pixel pour rester visible sur la ligne de base.
 */
function Barre({
	valeur,
	maximum,
	devise,
	classes,
}: {
	readonly valeur: number
	readonly maximum: number
	readonly devise: string
	readonly classes: string
}) {
	return (
		<span className="flex flex-col items-center justify-end h-full gap-1">
			<span className="text-[13px] font-mono tabular-nums text-text-2 whitespace-nowrap">
				{formaterMontant(valeur, devise)}
			</span>
			<span
				className={`w-8 rounded-t-sm min-h-px ${classes}`}
				style={{ height: `${hauteurPourcent(valeur, maximum)}%` }}
			/>
		</span>
	)
}

/** La légende nomme les deux séries — §5.30, la couleur ne suffit jamais. */
function Legende() {
	return (
		<ul className="flex flex-wrap items-center gap-4 text-sm text-text-2">
			<li className="flex items-center gap-2">
				<span className="inline-block size-3 rounded-xs bg-brand" aria-hidden="true" />
				{t('costs.chart.legend.planned')}
			</li>
			<li className="flex items-center gap-2">
				<span className="inline-block size-3 rounded-xs bg-success" aria-hidden="true" />
				{t('costs.chart.legend.actual')}
			</li>
			<li className="flex items-center gap-2">
				<span className="inline-block size-3 rounded-xs bg-danger" aria-hidden="true" />
				{t('costs.chart.legend.over')}
			</li>
		</ul>
	)
}

/**
 * Le tableau équivalent — c'est LUI la version accessible du graphique (§5.30).
 *
 * Il n'est jamais masqué, même au plus large : un équivalent textuel rendu seulement en dessous
 * d'un palier serait absent là où le graphique est le plus dense, donc exactement là où il sert le
 * plus. Il porte aussi le dépassement en TEXTE, et pas seulement par la couleur de la barre.
 */
function TableauEquivalent({
	devise,
	groupes,
	total,
	legendeColonne,
}: {
	readonly devise: string
	readonly groupes: readonly GroupeHistogramme[]
	readonly total: AgregatCouts
	readonly legendeColonne: string
}) {
	return (
		<div className="overflow-x-auto [contain:paint]">
			<table className="w-full text-sm border-collapse">
				<caption className="sr-only">{t('costs.chart.table.caption', { devise })}</caption>
				<thead>
					<tr className="text-left text-text-2 border-b border-border">
						<th scope="col" className="py-2 pr-4 font-medium">
							{legendeColonne}
						</th>
						<th scope="col" className="py-2 px-4 font-medium text-right">
							{t('costs.chart.legend.planned')}
						</th>
						<th scope="col" className="py-2 px-4 font-medium text-right">
							{t('costs.chart.legend.actual')}
						</th>
						<th scope="col" className="py-2 pl-4 font-medium text-right">
							{t('costs.chart.table.pending')}
						</th>
					</tr>
				</thead>
				<tbody>
					{groupes.map((groupe) => (
						<tr key={groupe.cle} className="border-b border-border">
							<th scope="row" className="py-2 pr-4 font-normal text-ink">
								{groupe.libelle}
								{groupe.precision !== undefined && (
									<span className="block text-[13px] text-text-2">{groupe.precision}</span>
								)}
							</th>
							<td className="py-2 px-4 text-right font-mono tabular-nums">
								{formaterMontant(groupe.agregat.estime, devise)}
							</td>
							<td className="py-2 px-4 text-right font-mono tabular-nums">
								{formaterMontant(groupe.agregat.reel, devise)}
								{depasse(groupe.agregat) && (
									<span className="block text-[13px] text-danger">
										{t('costs.chart.table.over')}
									</span>
								)}
							</td>
							<td className="py-2 pl-4 text-right font-mono tabular-nums text-text-2">
								{groupe.agregat.sansReel}
							</td>
						</tr>
					))}
				</tbody>
				<tfoot>
					<tr className="font-medium">
						<th scope="row" className="py-2 pr-4 text-left">
							{t('costs.chart.table.total')}
						</th>
						<td className="py-2 px-4 text-right font-mono tabular-nums">
							{formaterMontant(total.estime, devise)}
						</td>
						<td className="py-2 px-4 text-right font-mono tabular-nums">
							{formaterMontant(total.reel, devise)}
						</td>
						<td className="py-2 pl-4 text-right font-mono tabular-nums text-text-2">
							{total.sansReel}
						</td>
					</tr>
				</tfoot>
			</table>
		</div>
	)
}

/**
 * « n lignes sans coût réel saisi, pour m € de prévisionnel » — §4.4, et elle est OBLIGATOIRE.
 *
 * ELLE EST ABSENTE, ET NON RENDUE À ZÉRO, quand tous les réels sont saisis. Le §4.4 la commande
 * « dès qu'une ligne n'a pas de réel » ; l'afficher à zéro transformerait une bonne nouvelle en
 * avertissement permanent, que l'œil cesserait alors de lire — et c'est précisément quand elle
 * apparaît qu'elle doit se remarquer.
 */
function MentionReelsManquants({
	total,
	devise,
}: {
	readonly total: AgregatCouts
	readonly devise: string
}) {
	if (total.sansReel === 0) return null
	return (
		<p className="text-[13px] text-text-2">
			{t('costs.chart.pending.notice', {
				lignes: String(total.sansReel),
				montant: formaterMontant(total.estimeSansReel, devise),
			})}
		</p>
	)
}
