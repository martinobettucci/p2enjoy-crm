// @spec CRM-007 (docs/BACKLOG.md) — barre latérale de la coquille
// @spec docs/DESIGN_SYSTEM.md §4 (barre latérale, repli), §7 (paliers), §8 (clavier, cibles)
// @spec docs/SPEC-webapp.md §5.1 (coquille), §8 (responsive), §9 (accessibilité)
//
// Comportement par palier (docs/DESIGN_SYSTEM.md §7), obtenu par les classes et non par une
// mesure JavaScript de la fenêtre — un `resize` non écouté ne peut donc pas désynchroniser
// l'affichage :
//
//   < 1024 px   tiroir, hors flux, ouvert par le bouton de l'en-tête ; libellés visibles
//   1024–1279   colonne d'icônes ; les libellés restent lisibles par infobulle et lecteur d'écran
//   ≥ 1280      colonne déployée, repliable en icônes par l'utilisateur
//
// Le repli n'est proposé qu'au dernier palier : en dessous, la barre est déjà réduite, et
// offrir un bouton sans effet visible serait une commande morte.

import { PanelLeftClose, PanelLeftOpen, X } from 'lucide-react'
import { NavLink } from 'react-router'
import { SkeletonListe } from '../components/ui/Skeleton'
import { t } from '../i18n'
import { ENTREES_TRANSVERSES } from './navigation'
import { classesPilule, iconeTrack } from './presentation-tracks'
import type { EtatAsync } from '../lib/async'
import type { Track } from '../lib/tracks'

export type ProprietesSidebar = {
	readonly replie: boolean
	readonly onBasculerRepli: () => void
	readonly tiroirOuvert: boolean
	readonly onFermerTiroir: () => void
	readonly etatTracks: EtatAsync<readonly Track[]>
}

export function Sidebar({
	replie,
	onBasculerRepli,
	tiroirOuvert,
	onFermerTiroir,
	etatTracks,
}: ProprietesSidebar) {
	// Au-delà de `lg`, les libellés ne réapparaissent qu'à `xl` et seulement si l'utilisateur
	// n'a pas replié la barre. Ils sont **masqués visuellement**, jamais retirés du document :
	// au palier « icônes », le lecteur d'écran continue de les annoncer. Réduire l'affichage
	// ne doit pas réduire l'information (docs/DESIGN_SYSTEM.md §7, §8).
	const classeLibelle = replie ? 'not-sr-only lg:sr-only' : 'not-sr-only lg:sr-only xl:not-sr-only'
	const classeLargeur = replie
		? 'w-[var(--size-sidebar)] lg:w-[var(--size-sidebar-icons)]'
		: 'w-[var(--size-sidebar)] lg:w-[var(--size-sidebar-icons)] xl:w-[var(--size-sidebar)]'

	return (
		<aside
			aria-label={t('nav.sidebar.aria')}
			data-testid="barre-laterale"
			data-replie={replie ? 'oui' : 'non'}
			className={[
				'fixed inset-y-0 left-0 z-40 lg:static lg:z-auto',
				'flex flex-col shrink-0 gap-4 p-3',
				'bg-surface border-r border-border',
				'overflow-y-auto',
				'transition-transform duration-[var(--transition-duration-fast)]',
				// Le retrait hors écran est **borné au palier tiroir** par `max-lg:` plutôt
				// qu'annulé par un `lg:translate-x-0`. Mesuré : les deux classes écrivent la
				// même variable, et c'est `-translate-x-full` que Tailwind émet en dernier —
				// la barre restait donc hors écran à tous les paliers. Une règle qui n'a rien
				// à annuler ne peut pas perdre cet arbitrage.
				tiroirOuvert ? '' : 'max-lg:-translate-x-full',
				classeLargeur,
			].join(' ')}
		>
			{/* Repliée, la colonne ne fait plus que 64 px : la marque et la bascule ne tiennent
			    plus côte à côte, et c'est la bascule qui était rognée — le repli devenait
			    irréversible. Constaté sur une capture, corrigé en empilant les deux au palier
			    où le repli existe. */}
			<div
				className={[
					'flex items-center gap-2',
					replie ? 'xl:flex-col' : 'justify-between',
				].join(' ')}
			>
				<span className="flex items-center gap-2 min-h-[var(--size-target)] px-2">
					<span
						aria-hidden="true"
						className="size-8 rounded-md bg-brand shrink-0"
						data-testid="marque"
					/>
					<span className={['font-bold text-ink truncate', classeLibelle].join(' ')}>
						{t('app.name')}
					</span>
				</span>
				{/* Refermer le tiroir depuis le tiroir lui-même. Échap y suffit, mais une
				    commande visible ne suppose pas de connaître le raccourci
				    (docs/DESIGN_SYSTEM.md §8). Au-delà du palier « tiroir », la barre est
				    dans le flux : il n'y a plus rien à refermer. */}
				<button
					type="button"
					onClick={onFermerTiroir}
					data-testid="fermer-tiroir"
					title={t('nav.sidebar.close')}
					className={[
						'inline-flex lg:hidden items-center justify-center shrink-0',
						'size-[var(--size-target)] rounded-sm text-text-2 hover:bg-hover',
						'transition-colors duration-[var(--transition-duration-fast)]',
					].join(' ')}
				>
					<X aria-hidden="true" size={20} />
					<span className="sr-only">{t('nav.sidebar.close')}</span>
				</button>
				<button
					type="button"
					onClick={onBasculerRepli}
					data-testid="bascule-repli"
					aria-pressed={replie}
					title={replie ? t('nav.sidebar.expand') : t('nav.sidebar.collapse')}
					className={[
						'hidden xl:inline-flex items-center justify-center shrink-0',
						'size-[var(--size-target)] rounded-sm text-text-2 hover:bg-hover',
						'transition-colors duration-[var(--transition-duration-fast)]',
					].join(' ')}
				>
					{replie ? (
						<PanelLeftOpen aria-hidden="true" size={20} />
					) : (
						<PanelLeftClose aria-hidden="true" size={20} />
					)}
					<span className="sr-only">
						{replie ? t('nav.sidebar.expand') : t('nav.sidebar.collapse')}
					</span>
				</button>
			</div>

			<nav aria-label={t('nav.aria')} className="flex flex-col gap-1">
				{ENTREES_TRANSVERSES.map((entree) => (
					<NavLink
						key={entree.chemin}
						to={entree.chemin}
						end={entree.chemin === '/'}
						onClick={onFermerTiroir}
						title={t(entree.cleLibelle)}
						className={({ isActive }) =>
							[
								'flex items-center gap-3 px-2 min-h-[var(--size-target)] rounded-sm',
								'transition-colors duration-[var(--transition-duration-fast)]',
								isActive ? 'bg-brand-soft text-brand font-medium' : 'text-text-2 hover:bg-hover',
							].join(' ')
						}
					>
						<entree.icone aria-hidden="true" size={20} className="shrink-0" />
						<span className={['truncate', classeLibelle].join(' ')}>{t(entree.cleLibelle)}</span>
					</NavLink>
				))}
			</nav>

			<section aria-labelledby="titre-tracks" className="flex flex-col gap-2">
				<h2
					id="titre-tracks"
					className={['px-2 text-sm uppercase text-text-3', classeLibelle].join(' ')}
				>
					{t('nav.section.tracks')}
				</h2>
				<SectionTracks etat={etatTracks} replie={replie} onNaviguer={onFermerTiroir} />
			</section>
		</aside>
	)
}

/**
 * Les tracks du workspace, en pilules (`docs/DESIGN_SYSTEM.md` §4).
 *
 * La section affiche ce que le backend consent à rendre, et rien d'autre : elle ne fabrique
 * aucune donnée d'attente. Aujourd'hui, l'appelant étant anonyme faute d'écran de connexion
 * (INC-021), c'est l'**état vide** qui s'affiche — et c'est le refus réel de la RLS
 * (`docs/SPEC-tracks.md` §7).
 *
 * Les pilules sont **cliquables depuis `CRM-021`** : un track s'ouvre sur ses channels, et la
 * destination `/tracks/:slug` existe désormais. L'écart temporaire de `docs/DESIGN_SYSTEM.md`
 * §12.4 — « le lien arrivera avec la destination » — est donc refermé.
 */
function SectionTracks({
	etat,
	replie,
	onNaviguer,
}: {
	readonly etat: EtatAsync<readonly Track[]>
	readonly replie: boolean
	readonly onNaviguer: () => void
}) {
	const classeTexte = replie ? 'not-sr-only lg:sr-only' : 'not-sr-only lg:sr-only xl:not-sr-only'

	if (etat.statut === 'chargement') {
		return <SkeletonListe lignes={3} libelle={t('state.loading.aria')} className="px-2" />
	}
	// Un échec de chargement est présenté au centre de l'écran, pas dupliqué ici : la barre
	// latérale n'a pas la place d'expliquer une erreur ni d'offrir une reprise utilisable.
	if (etat.statut === 'erreur' || etat.donnees.length === 0) {
		return (
			<p data-testid="tracks-vides" className={['px-2 text-sm text-text-3', classeTexte].join(' ')}>
				{t('tracks.empty.title')}
			</p>
		)
	}
	return (
		<ul className="flex flex-col gap-1">
			{etat.donnees.map((track) => {
				// `docs/DESIGN_SYSTEM.md` §5.6 : une pilule est précédée d'une icône, « afin que
				// l'information ne repose jamais sur la seule couleur ». C'est aussi ce qui rend
				// la liste lisible au palier « colonne d'icônes », où les libellés sont masqués
				// visuellement mais restent annoncés (§7, §8).
				const Icone = iconeTrack(track.icon)
				return (
					<li key={track.id}>
						<NavLink
							to={`/tracks/${track.slug}`}
							// Le tiroir se referme après la navigation, comme pour les entrées
							// transverses : laisser une surface qui recouvre l'écran ouverte sur
							// un contenu qu'elle masque serait un cul-de-sac.
							onClick={onNaviguer}
							data-testid="entree-track"
							data-slug={track.slug}
							title={track.name}
							className={({ isActive }) =>
								[
									'flex items-center gap-2 px-2 min-h-[var(--size-target)] rounded-full',
									'transition-colors duration-[var(--transition-duration-fast)]',
									classesPilule(track.color),
									// L'état actif s'ajoute à la couleur du track, il ne la remplace
									// pas : la couleur est une **donnée**, et l'écraser ferait perdre
									// au track actif ce qui l'identifie. `aria-current="page"`, posé
									// par `NavLink`, porte l'information indépendamment du visuel.
									isActive ? 'ring-2 ring-brand font-medium' : '',
								].join(' ')
							}
						>
							<Icone aria-hidden="true" size={18} className="shrink-0" />
							<span className={['truncate', classeTexte].join(' ')}>{track.name}</span>
						</NavLink>
					</li>
				)
			})}
		</ul>
	)
}
