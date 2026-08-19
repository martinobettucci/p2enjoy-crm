// @spec CRM-083 (docs/BACKLOG.md) — canevas d'objectifs, tranche 1 : navigation, liste des
//       tableaux, canevas rendu, flèches, équivalent textuel et ouverture du channel
// @spec docs/SPEC-goals.md §5.1 (liste des tableaux), §5.2 (canevas), §5.3 (flèches),
//       §5.4 (les cinq états), §5.5 (accessibilité), §3 (ouvrir le channel d'un bloc)
// @spec docs/SPEC-goals.md §4.1 (le bloc masqué n'est pas rendu, et l'écran ne le nomme jamais)
// @spec docs/DESIGN_SYSTEM.md §5.29 (bloc, jauge, flèche, focus), §5.8 (états), §8 (clavier),
//       §5.5 bis (pilule de track réemployée par la pilule de channel)
//
// CE QUE CETTE TRANCHE LIVRE, ET CE QU'ELLE NE LIVRE PAS — nommé ici plutôt que découvert à
// l'usage (`CLAUDE.md` §25) :
//
//   * LIVRÉ : l'entrée de navigation, la liste des tableaux avec leur compte de blocs LISIBLES,
//     le canevas pannable et zoomable, les blocs avec jauge et pilule, les flèches aux trois
//     directions, les moignons pointillés vers le vide, l'équivalent textuel du diagramme, les
//     états vide / introuvable / lien perdu, et l'OUVERTURE du channel au clic comme au clavier ;
//   * NON LIVRÉ, et donc non simulé : poser, déplacer, redimensionner, remplir et lier un bloc.
//     Aucune commande morte n'est posée pour ces gestes — un bouton qui n'écrit rien ment plus
//     qu'une absence.
//
// L'ÉCRAN NE CALCULE AUCUN DROIT : il rend ce que le backend consent. Un bloc lié à un channel
// fermé n'arrive jamais jusqu'ici, et l'écran ne cherche pas à savoir qu'il a existé.

import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router'
import { ArrowLeft, Minus, Plus, SquareArrowOutUpRight, Unlink } from 'lucide-react'
import { EtatErreur, EtatVide } from '../components/ui/States'
import { SkeletonListe } from '../components/ui/Skeleton'
import { t } from '../i18n'
import {
	composerDiagramme,
	etendueCanevas,
	lienOuvrable,
	lienPerdu,
	listeTextuelleDiagramme,
	ordreTabulation,
	useContenuTableau,
	useTableaux,
	type BlocObjectif,
	type FlecheTracee,
} from '../lib/objectifs'
import { clientCrm, type ClientCrm } from '../lib/supabase'
import { useWorkspaces } from '../lib/workspaces'
import { CHEMIN_OBJECTIFS, cheminTableauObjectifs } from './chemins'

/**
 * Couleur de jeton d'un bloc → classe du liseré gauche (§5.29 : liseré de 4 px).
 *
 * La table est CLOSE et son repli est `neutral` : une couleur inconnue en base — une valeur
 * saisie à la main, un jeton retiré du design system — rend un bloc gris, jamais un bloc sans
 * liseré ni une couleur devinée.
 */
const LISERES: Readonly<Record<string, string>> = {
	brand: 'bg-brand',
	success: 'bg-success',
	accent: 'bg-accent',
	danger: 'bg-danger',
	neutral: 'bg-border',
}

const liseréDe = (couleur: string) => LISERES[couleur] ?? LISERES.neutral

/** Paliers de zoom du canevas. Bornés : un canevas qu'on peut réduire à néant n'est plus une surface. */
const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5] as const
const ZOOM_PAR_DEFAUT = 2

export type ProprietesObjectifs = {
	readonly client?: ClientCrm | null
}

/**
 * Liste des tableaux — §5.1.
 *
 * Le workspace courant est le premier rendu par `lireWorkspaces`, patron déjà porté par le
 * carnet, le header et les trois surfaces d'administration : le produit n'a pas encore de
 * sélecteur d'espace de travail, et en inventer un ici poserait une surface que rien ne spécifie.
 */
export function Objectifs({ client = clientCrm }: ProprietesObjectifs = {}) {
	const { etat: etatWorkspaces } = useWorkspaces(client)

	const idWorkspace =
		etatWorkspaces.statut === 'pret' ? (etatWorkspaces.donnees[0]?.id ?? null) : null
	const { etat, recharger } = useTableaux(client, idWorkspace)

	// PAS DE CLIENT — l'application est montée sans configuration Supabase, cas ordinaire des
	// preuves de routage. Même patron et même texte que le carnet : sans cette sortie, les deux
	// lectures ne partent jamais et le squelette ne se résout pas.
	if (client === null) {
		return <EtatVide titre={t('goals.noWorkspace.title')} corps={t('goals.noWorkspace.body')} />
	}

	if (etatWorkspaces.statut === 'chargement') {
		return <SkeletonListe lignes={3} libelle={t('state.loading.aria')} />
	}

	// AUCUN ESPACE DE TRAVAIL — un appelant sans session en est le cas ordinaire. Sans cette
	// sortie, l'écran resterait EN CHARGEMENT indéfiniment : la lecture des tableaux ne part que
	// lorsqu'un workspace est connu, et un squelette qui ne se résout jamais est une page blanche
	// déguisée (`docs/SPEC-webapp.md` §7). Même patron et même texte que le carnet.
	if (etatWorkspaces.statut === 'pret' && idWorkspace === null) {
		return <EtatVide titre={t('goals.noWorkspace.title')} corps={t('goals.noWorkspace.body')} />
	}

	if (etat.statut === 'chargement') {
		return <SkeletonListe lignes={3} libelle={t('state.loading.aria')} />
	}

	if (etatWorkspaces.statut === 'erreur' || etat.statut === 'erreur') {
		return (
			<EtatErreur
				titre={t('goals.error.title')}
				corps={t('goals.error.body')}
				libelleReprise={t('goals.error.retry')}
				onReprise={recharger}
			/>
		)
	}

	if (etat.donnees.length === 0) {
		return <EtatVide titre={t('goals.list.empty.title')} corps={t('goals.list.empty.body')} />
	}

	return (
		<section aria-label={t('goals.aria')} className="flex flex-col gap-4">
			<ul className="flex flex-col rounded-lg border border-border bg-surface">
				{etat.donnees.map((tableau) => (
					<li key={tableau.id}>
						<Link
							to={cheminTableauObjectifs(tableau.id)}
							data-testid="tableau-objectifs"
							className="flex flex-col gap-1 px-4 py-3 min-h-[var(--size-target)] hover:bg-hover rounded-lg"
						>
							<span className="font-medium">{tableau.name}</span>
							{tableau.description === null ? null : (
								<span className="text-sm text-text-2">{tableau.description}</span>
							)}
							{/* Le compte est celui des blocs LISIBLES par l'appelant (§5.1) : deux
							    personnes du même workspace n'y lisent pas le même nombre, et c'est
							    la conséquence assumée du §4.1. */}
							<span className="text-sm text-text-3">{libelleCompteBlocs(tableau.blocsLisibles)}</span>
						</Link>
					</li>
				))}
			</ul>
		</section>
	)
}

/**
 * Compte de blocs en clair, par CLÉ et jamais par concaténation (`CLAUDE.md` §23) : le français
 * accorde son substantif, et trois clés valent mieux qu'une phrase assemblée dans le composant.
 */
export function libelleCompteBlocs(compte: number): string {
	if (compte === 0) return t('goals.list.blocks.none')
	if (compte === 1) return t('goals.list.blocks.one')
	return t('goals.list.blocks', { compte: String(compte) })
}

export type ProprietesCanevas = {
	readonly client?: ClientCrm | null
}

/** Canevas d'un tableau — §5.2. */
export function CanevasObjectifs({ client = clientCrm }: ProprietesCanevas = {}) {
	const { idTableau } = useParams<{ idTableau: string }>()
	const { etat, recharger } = useContenuTableau(client, idTableau ?? null)
	const [rangZoom, setRangZoom] = useState<number>(ZOOM_PAR_DEFAUT)

	const contenu = etat.statut === 'pret' ? etat.donnees : null
	const blocs = useMemo(() => ordreTabulation(contenu?.blocs ?? []), [contenu])
	const fleches = useMemo(
		() => composerDiagramme(contenu?.blocs ?? [], contenu?.fleches ?? []),
		[contenu],
	)
	const lignes = useMemo(
		() => listeTextuelleDiagramme(contenu?.blocs ?? [], contenu?.fleches ?? []),
		[contenu],
	)
	const etendue = useMemo(() => etendueCanevas(contenu?.blocs ?? []), [contenu])

	if (client === null) {
		return <EtatVide titre={t('goals.noWorkspace.title')} corps={t('goals.noWorkspace.body')} />
	}

	if (etat.statut === 'chargement') {
		return <SkeletonListe lignes={4} libelle={t('state.loading.aria')} />
	}

	if (etat.statut === 'erreur') {
		return (
			<EtatErreur
				titre={t('goals.error.title')}
				corps={t('goals.error.body')}
				libelleReprise={t('goals.error.retry')}
				onReprise={recharger}
			/>
		)
	}

	if (contenu === null || contenu.tableau === null) {
		return (
			<EtatVide
				titre={t('goals.board.notfound.title')}
				corps={t('goals.board.notfound.body')}
				action={<RetourListe />}
			/>
		)
	}

	// Le rang est borné par les deux commandes ; le repli protège d'un état impossible plutôt que
	// de laisser une échelle `undefined` produire un canevas invisible.
	const zoom = ZOOMS[rangZoom] ?? 1

	return (
		<section aria-label={t('goals.canvas.aria')} className="flex flex-col gap-4">
			<header className="flex flex-wrap items-center justify-between gap-3">
				<div className="flex flex-col gap-1">
					<h2 className="text-h3">{contenu.tableau.name}</h2>
					{contenu.tableau.description === null ? null : (
						<p className="text-sm text-text-2 max-w-[70ch]">{contenu.tableau.description}</p>
					)}
				</div>
				<div className="flex items-center gap-2">
					<RetourListe />
					<CommandesZoom rang={rangZoom} onChanger={setRangZoom} />
				</div>
			</header>

			{blocs.length === 0 ? (
				<EtatVide titre={t('goals.board.empty.title')} corps={t('goals.board.empty.body')} />
			) : (
				/* La zone est PANNABLE au défilement — souris, molette, et touches de direction du
				   navigateur une fois le conteneur focalisé —, et ZOOMABLE par les deux commandes
				   ci-dessus. `tabIndex` sur le conteneur est ce qui rend le défilement clavier
				   possible : sans lui, une région défilante ne reçoit jamais le focus. */
				<div
					data-testid="canevas-objectifs"
					tabIndex={0}
					role="group"
					aria-label={t('goals.canvas.aria')}
					className="relative overflow-auto rounded-lg border border-border bg-bg max-h-[70vh] focus-visible:outline-2 focus-visible:outline-brand"
				>
					<div
						data-testid="canevas-surface"
						className="relative origin-top-left"
						style={{
							width: `${etendue.largeur}px`,
							height: `${etendue.hauteur}px`,
							transform: `scale(${zoom})`,
						}}
					>
						<TraitsDuDiagramme fleches={fleches} etendue={etendue} />
						{blocs.map((bloc) => (
							<BlocCanevas key={bloc.id} bloc={bloc} />
						))}
					</div>
				</div>
			)}

			<EquivalentTextuel lignes={lignes} />
		</section>
	)
}

function RetourListe() {
	return (
		<Link
			to={CHEMIN_OBJECTIFS}
			className="inline-flex items-center gap-2 min-h-[var(--size-target)] px-3 rounded-sm border border-border hover:bg-hover"
		>
			<ArrowLeft aria-hidden="true" size={16} strokeWidth={2} />
			{t('goals.back.list')}
		</Link>
	)
}

function CommandesZoom({
	rang,
	onChanger,
}: {
	readonly rang: number
	readonly onChanger: (rang: number) => void
}) {
	return (
		<div className="flex items-center gap-1">
			<button
				type="button"
				data-testid="zoom-moins"
				disabled={rang === 0}
				onClick={() => onChanger(Math.max(0, rang - 1))}
				aria-label={t('goals.zoom.out')}
				className="inline-flex items-center justify-center size-[var(--size-target)] rounded-sm border border-border hover:bg-hover disabled:opacity-50"
			>
				<Minus aria-hidden="true" size={16} strokeWidth={2} />
			</button>
			<span data-testid="zoom-valeur" className="text-sm text-text-2 tabular-nums min-w-[5ch] text-center">
				{t('goals.zoom.value', { valeur: String(Math.round((ZOOMS[rang] ?? 1) * 100)) })}
			</span>
			<button
				type="button"
				data-testid="zoom-plus"
				disabled={rang === ZOOMS.length - 1}
				onClick={() => onChanger(Math.min(ZOOMS.length - 1, rang + 1))}
				aria-label={t('goals.zoom.in')}
				className="inline-flex items-center justify-center size-[var(--size-target)] rounded-sm border border-border hover:bg-hover disabled:opacity-50"
			>
				<Plus aria-hidden="true" size={16} strokeWidth={2} />
			</button>
		</div>
	)
}

/**
 * Les traits, dans un SVG posé SOUS les blocs.
 *
 * Le SVG est `aria-hidden` et il l'est délibérément : le diagramme est restitué aux lecteurs
 * d'écran par la liste textuelle du §5.5, non par des `<path>` que rien ne sait lire. Doubler
 * l'information ferait entendre chaque flèche deux fois.
 */
function TraitsDuDiagramme({
	fleches,
	etendue,
}: {
	readonly fleches: readonly FlecheTracee[]
	readonly etendue: { readonly largeur: number; readonly hauteur: number }
}) {
	return (
		<svg
			aria-hidden="true"
			data-testid="traits-diagramme"
			width={etendue.largeur}
			height={etendue.hauteur}
			viewBox={`0 0 ${etendue.largeur} ${etendue.hauteur}`}
			className="absolute inset-0 pointer-events-none"
		>
			<defs>
				<marker id="pointe-objectif" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
					<path d="M0,0 L8,4 L0,8 z" fill="var(--color-text-3)" />
				</marker>
				<marker
					id="pointe-objectif-inverse"
					markerWidth="8"
					markerHeight="8"
					refX="1"
					refY="4"
					orient="auto"
				>
					<path d="M8,0 L0,4 L8,8 z" fill="var(--color-text-3)" />
				</marker>
			</defs>
			{fleches.map((fleche) => (
				<g key={fleche.id} data-testid={fleche.orpheline ? 'fleche-orpheline' : 'fleche'}>
					<line
						x1={fleche.depart.x}
						y1={fleche.depart.y}
						x2={fleche.arrivee.x}
						y2={fleche.arrivee.y}
						stroke="var(--color-text-3)"
						strokeWidth={2}
						/* Une flèche dont une extrémité n'est pas rendue est POINTILLÉE et sans
						   libellé (§5.4) : l'écran montre qu'un trait continue, sans jamais dire
						   vers quoi. */
						strokeDasharray={fleche.orpheline ? '6 4' : undefined}
						markerEnd={
							fleche.direction === 'forward' || fleche.direction === 'both'
								? 'url(#pointe-objectif)'
								: undefined
						}
						markerStart={
							fleche.direction === 'backward' || fleche.direction === 'both'
								? 'url(#pointe-objectif-inverse)'
								: undefined
						}
					/>
					{fleche.libelle === null ? null : (
						<text
							x={fleche.milieu.x}
							y={fleche.milieu.y}
							textAnchor="middle"
							dominantBaseline="middle"
							fontSize={12}
							fill="var(--color-text-2)"
							/* Le fond interrompt le trait (§5.3) : `paint-order` peint le contour
							   avant le texte, ce qui évite d'avoir à poser un rectangle dont la
							   taille dépendrait de la mesure du texte. */
							stroke="var(--color-surface)"
							strokeWidth={6}
							paintOrder="stroke"
						>
							{fleche.libelle}
						</text>
					)}
				</g>
			))}
		</svg>
	)
}

/** Un bloc du canevas — §5.2, `docs/DESIGN_SYSTEM.md` §5.29. */
function BlocCanevas({ bloc }: { readonly bloc: BlocObjectif }) {
	const ouvrable = lienOuvrable(bloc)
	const perdu = lienPerdu(bloc)
	const destination = bloc.destination

	const etiquette =
		ouvrable && destination !== null && destination.track !== null
			? t('goals.block.aria.channel', {
					titre: bloc.title,
					valeur: String(bloc.fill_percent),
					track: destination.track.nom,
					channel: destination.nom,
				})
			: t('goals.block.aria', { titre: bloc.title, valeur: String(bloc.fill_percent) })

	return (
		<article
			data-testid="bloc-objectif"
			data-bloc={bloc.id}
			tabIndex={0}
			aria-label={etiquette}
			className="absolute flex overflow-hidden rounded-lg border border-border bg-surface shadow-sm focus-visible:outline-2 focus-visible:outline-brand"
			style={{
				left: `${bloc.pos_x}px`,
				top: `${bloc.pos_y}px`,
				width: `${bloc.width}px`,
				height: `${bloc.height}px`,
			}}
		>
			<span aria-hidden="true" className={['w-1 shrink-0', liseréDe(bloc.color)].join(' ')} />
			<div className="flex flex-col gap-1 min-w-0 grow p-3">
				<h3 className="text-[15px] font-medium text-ink truncate">{bloc.title}</h3>
				{bloc.body === null ? null : (
					<p className="text-[13px] text-text-2 line-clamp-2">{bloc.body}</p>
				)}
				<div className="mt-auto flex flex-col gap-2">
					<Jauge valeur={bloc.fill_percent} />
					{ouvrable && destination !== null && destination.track !== null ? (
						<Link
							to={`/tracks/${destination.track.slug}/${destination.slug}`}
							data-testid="pilule-channel"
							title={t('goals.block.open')}
							className="inline-flex items-center gap-1 self-start max-w-full px-2 py-1 rounded-full bg-brand-soft text-brand text-xs truncate hover:bg-brand-soft-strong"
						>
							<SquareArrowOutUpRight aria-hidden="true" size={12} strokeWidth={2} />
							<span className="truncate">
								{t('goals.block.pill', { track: destination.track.nom, channel: destination.nom })}
							</span>
						</Link>
					) : null}
					{perdu ? (
						<span
							data-testid="lien-perdu"
							title={t('goals.block.link.lost.hint')}
							className="inline-flex items-center gap-1 self-start px-2 py-1 rounded-full bg-bg text-text-3 text-xs"
						>
							<Unlink aria-hidden="true" size={12} strokeWidth={2} />
							{t('goals.block.link.lost')}
						</span>
					) : null}
				</div>
			</div>
		</article>
	)
}

/**
 * Jauge de remplissage — §5.2 et `docs/DESIGN_SYSTEM.md` §5.29.
 *
 * ELLE NE CHANGE JAMAIS DE COULEUR AVEC LA VALEUR, et c'est l'écart le plus tentant de ce
 * composant : un remplissage saisi à la main n'est ni bon ni mauvais, et le vert ou le rouge y
 * introduiraient un jugement que le produit n'a pas à porter.
 *
 * La valeur est écrite EN CLAIR à droite : la couleur ne porte jamais seule une information
 * (`docs/DESIGN_SYSTEM.md` §1). Le rôle `progressbar` n'est PAS employé — l'attribut d'un bloc
 * est déjà dans son `aria-label`, et une barre annoncée en plus ferait entendre la valeur deux
 * fois de suite.
 */
function Jauge({ valeur }: { readonly valeur: number }) {
	return (
		<div className="flex items-center gap-2">
			<span aria-hidden="true" className="grow h-[6px] rounded-full bg-brand-soft overflow-hidden">
				<span
					data-testid="jauge-remplissage"
					className="block h-full bg-brand"
					style={{ width: `${Math.min(100, Math.max(0, valeur))}%` }}
				/>
			</span>
			<span aria-hidden="true" className="text-xs text-text-2 tabular-nums">
				{t('goals.block.fill', { valeur: String(valeur) })}
			</span>
		</div>
	)
}

/**
 * Équivalent textuel du diagramme — §5.5.
 *
 * Il est TOUJOURS rendu, y compris vide : un lecteur d'écran qui ne trouve la liste que sur les
 * tableaux liés apprendrait son absence plutôt que l'absence de liens.
 *
 * Une extrémité non rendue est nommée « extrémité hors de portée », formulation qui ne dit rien
 * de ce qui manque — l'écran ne nomme jamais ce qu'il cache (§4.1).
 */
function EquivalentTextuel({
	lignes,
}: {
	readonly lignes: readonly { id: string; source: string; cible: string; symbole: string; libelle: string | null }[]
}) {
	return (
		<section data-testid="equivalent-textuel" aria-label={t('goals.diagram.aria')} className="flex flex-col gap-2">
			<h3 className="text-sm font-medium text-text-2">{t('goals.diagram.title')}</h3>
			{lignes.length === 0 ? (
				<p className="text-sm text-text-3">{t('goals.diagram.empty')}</p>
			) : (
				<ul className="flex flex-col gap-1 text-sm text-text-2">
					{lignes.map((ligne) => {
						// La ligne passe par une CLÉ PARAMÉTRÉE, jamais par une concaténation dans
						// le composant (`CLAUDE.md` §23) : une langue qui place son libellé avant
						// ses extrémités n'aurait aucun moyen de corriger un ordre figé en JSX.
						const parametres = {
							source: ligne.source === '' ? t('goals.diagram.unreachable') : ligne.source,
							cible: ligne.cible === '' ? t('goals.diagram.unreachable') : ligne.cible,
							symbole: ligne.symbole,
							libelle: ligne.libelle ?? '',
						}
						return (
							<li key={ligne.id} data-testid="ligne-diagramme">
								{ligne.libelle === null
									? t('goals.diagram.line', parametres)
									: t('goals.diagram.line.labelled', parametres)}
							</li>
						)
					})}
				</ul>
			)}
		</section>
	)
}
