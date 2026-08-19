// @spec CRM-083 (docs/BACKLOG.md) — canevas d'objectifs, tranche 1 : navigation, liste des
//       tableaux, canevas rendu, flèches, équivalent textuel et ouverture du channel ;
//       tranche 2a : poser, déplacer et redimensionner un bloc, à la souris et au clavier
// @spec docs/SPEC-goals.md §5.1 (liste des tableaux), §5.2 (canevas), §5.3 (flèches),
//       §5.4 (les cinq états), §5.5 (accessibilité et gestes clavier), §3 (ouvrir le channel
//       d'un bloc, poser un bloc, le déplacer, le redimensionner), §4.2 (écriture)
// @spec docs/SPEC-goals.md §4.1 (le bloc masqué n'est pas rendu, et l'écran ne le nomme jamais)
// @spec docs/DESIGN_SYSTEM.md §5.29 (bloc, jauge, flèche, focus), §5.8 (états), §8 (clavier),
//       §5.5 bis (pilule de track réemployée par la pilule de channel)
//
// CE QUE CES TRANCHES LIVRENT, ET CE QU'ELLES NE LIVRENT PAS — nommé ici plutôt que découvert à
// l'usage (`CLAUDE.md` §25) :
//
//   * TRANCHE 1, LA LECTURE : l'entrée de navigation, la liste des tableaux avec leur compte de
//     blocs LISIBLES, le canevas pannable et zoomable, les blocs avec jauge et pilule, les flèches
//     aux trois directions, les moignons pointillés vers le vide, l'équivalent textuel du
//     diagramme, les états vide / introuvable / lien perdu, et l'OUVERTURE du channel ;
//   * TRANCHE 2a, LA GÉOMÉTRIE : poser un bloc à la position du geste, le déplacer et le
//     redimensionner, à la souris ET au clavier, avec persistance des quatre colonnes ;
//   * NON LIVRÉ, et donc non simulé : saisir le titre, le corps, la couleur et le remplissage,
//     lier un bloc à un channel, tracer une flèche, supprimer un bloc, administrer les tableaux.
//     Aucune commande morte n'est posée pour ces gestes — un bouton qui n'écrit rien ment plus
//     qu'une absence.
//
// L'ÉCRAN NE CALCULE AUCUN DROIT : il rend ce que le backend consent, et il ENVOIE puis traduit
// le refus (`CLAUDE.md` §10, `docs/DESIGN_SYSTEM.md` §5.26). Aucune commande n'est éteinte
// d'avance selon le rôle. Un bloc lié à un channel fermé n'arrive jamais jusqu'ici, et l'écran ne
// cherche pas à savoir qu'il a existé.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as EvenementPointeur } from 'react'
import { Link, useParams } from 'react-router'
import { ArrowLeft, Minus, Plus, SquareArrowOutUpRight, SquarePlus, Unlink, X } from 'lucide-react'
import { Button } from '../components/ui/Button'
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
import {
	ecrireGeometrieBloc,
	poserBloc,
	PAS_CLAVIER,
	PAS_CLAVIER_FIN,
	TAILLE_BLOC_MINIMALE,
	TAILLE_BLOC_NEUF,
	bornerCoordonnee,
	bornerDimension,
	type RefusBloc,
} from '../lib/objectifs-ecriture'
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

/**
 * La géométrie d'un bloc — les quatre seules colonnes que la tranche 2a écrit.
 *
 * Elle est nommée à part du bloc parce qu'un geste de canevas ne touche jamais autre chose : le
 * titre, le corps, la couleur, le remplissage et le lien appartiennent à la tranche suivante, et
 * les mêler ici ferait envoyer des colonnes que le geste n'a pas modifiées.
 */
type Geometrie = {
	readonly x: number
	readonly y: number
	readonly largeur: number
	readonly hauteur: number
}

const geometrieDe = (bloc: BlocObjectif): Geometrie => ({
	x: bloc.pos_x,
	y: bloc.pos_y,
	largeur: bloc.width,
	hauteur: bloc.height,
})

const avecGeometrie = (bloc: BlocObjectif, geometrie: Geometrie): BlocObjectif => ({
	...bloc,
	pos_x: geometrie.x,
	pos_y: geometrie.y,
	width: geometrie.largeur,
	height: geometrie.hauteur,
})

/**
 * Ce que l'écran dit d'une écriture — trois mentions, jamais deux à la fois
 * (`docs/DESIGN_SYSTEM.md` §5.7 ter).
 */
type MessageEcriture = { readonly ton: 'attente' | 'succes' | 'refus'; readonly texte: string }

/**
 * Traduit un refus par son DICTIONNAIRE FERMÉ. Un message de serveur n'est pas un texte
 * d'interface (`docs/DESIGN_SYSTEM.md` §10), et `detail` ne sort jamais du module d'écriture.
 */
export function texteRefusBloc(refus: RefusBloc): string {
	if (refus.nature === 'interdit') return t('goals.write.refused.forbidden')
	if (refus.nature === 'saisie-invalide') return t('goals.write.refused.invalid')
	return t('goals.write.refused.unavailable')
}

/**
 * Les deux gestes de géométrie. Ils ne se confondent pas, et c'est ce qui décide des colonnes
 * envoyées : réécrire les quatre à chaque fois écraserait le geste d'un collègue.
 */
type ModeGeste = 'deplacement' | 'taille'

/** Les quatre directions du clavier, en pas unitaires (§5.5). */
const DIRECTIONS_CLAVIER: Readonly<Record<string, readonly [number, number]>> = {
	ArrowLeft: [-1, 0],
	ArrowRight: [1, 0],
	ArrowUp: [0, -1],
	ArrowDown: [0, 1],
}

/** Canevas d'un tableau — §5.2, et depuis la tranche 2a les gestes de géométrie du §3. */
export function CanevasObjectifs({ client = clientCrm }: ProprietesCanevas = {}) {
	const { idTableau } = useParams<{ idTableau: string }>()
	const { etat, recharger } = useContenuTableau(client, idTableau ?? null)
	const [rangZoom, setRangZoom] = useState<number>(ZOOM_PAR_DEFAUT)

	// TROIS ÉTATS LOCAUX, ET ILS NE SE CONFONDENT PAS :
	//   * `ecrits` porte les lignes que le SERVEUR a rendues après une écriture — elles sont vraies,
	//     et les prendre évite une relecture pour une donnée déjà en main (§5.28) ;
	//   * `ajoutes` porte les blocs posés pendant cette session d'écran, pour la même raison ;
	//   * `ebauche` porte le geste EN COURS, qui n'est pas encore une donnée. Un refus l'efface, et
	//     le bloc revient à sa position d'origine (`docs/DESIGN_SYSTEM.md` §6).
	const [ecrits, setEcrits] = useState<ReadonlyMap<string, BlocObjectif>>(() => new Map())
	const [ajoutes, setAjoutes] = useState<readonly BlocObjectif[]>([])
	const [ebauche, setEbauche] = useState<{ readonly id: string; readonly geometrie: Geometrie } | null>(null)
	const [message, setMessage] = useState<MessageEcriture | null>(null)
	const [pose, setPose] = useState<{ readonly x: number; readonly y: number } | null>(null)

	const contenu = etat.statut === 'pret' ? etat.donnees : null

	// Une relecture rapporte l'état du serveur : ce qui était gardé localement devient alors
	// périmé, et le conserver ferait rendre deux fois la même donnée.
	useEffect(() => {
		setEcrits(new Map())
		setAjoutes([])
		setEbauche(null)
	}, [contenu])

	// L'ORDRE DE TABULATION EST CALCULÉ SUR L'ÉTAT DU SERVEUR, JAMAIS SUR L'ÉBAUCHE. Le trier
	// pendant un déplacement ferait sauter le bloc d'une place à l'autre de l'ordre du clavier
	// sous les doigts de celui qui le déplace — le défaut que le §5.31 nomme pour une table de
	// saisie, transposé au canevas.
	const blocs = useMemo(() => {
		const lus = (contenu?.blocs ?? []).map((bloc) => ecrits.get(bloc.id) ?? bloc)
		return ordreTabulation([...lus, ...ajoutes])
	}, [contenu, ecrits, ajoutes])

	const blocsRendus = useMemo(
		() => blocs.map((bloc) => (ebauche !== null && ebauche.id === bloc.id ? avecGeometrie(bloc, ebauche.geometrie) : bloc)),
		[blocs, ebauche],
	)

	const fleches = useMemo(
		() => composerDiagramme(blocsRendus, contenu?.fleches ?? []),
		[blocsRendus, contenu],
	)
	const lignes = useMemo(
		() => listeTextuelleDiagramme(blocsRendus, contenu?.fleches ?? []),
		[blocsRendus, contenu],
	)
	const etendue = useMemo(() => etendueCanevas(blocsRendus), [blocsRendus])

	// LE GESTE DÉCIDE DES COLONNES ENVOYÉES, ET C'EST UN DÉFAUT TROUVÉ PAR LA PREUVE : écrite
	// d'abord avec les quatre colonnes à chaque fois, cette fonction faisait qu'un simple
	// déplacement RÉÉCRIVAIT la taille — donc écrasait le redimensionnement qu'un collègue venait
	// de faire, avec la valeur que l'écran avait chargée. Un déplacement n'envoie que la position,
	// un redimensionnement que la taille.
	const enregistrerGeometrie = useCallback(
		async (idBloc: string, geometrie: Geometrie, mode: ModeGeste) => {
			if (client === null) return
			setMessage({ ton: 'attente', texte: t('goals.write.saving') })
			const resultat = await ecrireGeometrieBloc(
				client,
				idBloc,
				mode === 'deplacement'
					? { x: geometrie.x, y: geometrie.y }
					: { largeur: geometrie.largeur, hauteur: geometrie.hauteur },
			)
			// L'ébauche tombe dans les TROIS issues : sur un succès la ligne rendue la remplace, sur
			// un refus comme sur un silence le bloc reprend sa position d'origine. La laisser en
			// place sur un refus afficherait un déplacement qui n'a pas eu lieu.
			setEbauche((courante) => (courante !== null && courante.id === idBloc ? null : courante))
			if (resultat.statut === 'refus') {
				setMessage({ ton: 'refus', texte: texteRefusBloc(resultat.refus) })
				return
			}
			if (resultat.statut === 'sans-effet') {
				setMessage({ ton: 'refus', texte: t('goals.write.noeffect') })
				return
			}
			setEcrits((precedents) => new Map(precedents).set(idBloc, resultat.bloc))
			setMessage({ ton: 'succes', texte: t('goals.write.saved') })
		},
		[client],
	)

	const poserA = useCallback(
		async (point: { readonly x: number; readonly y: number }) => {
			if (client === null || idTableau === undefined) return
			setPose(null)
			setMessage({ ton: 'attente', texte: t('goals.write.saving') })
			const resultat = await poserBloc(client, {
				idTableau,
				x: point.x,
				y: point.y,
				titre: t('goals.place.title.default'),
			})
			if (resultat.statut === 'refus') {
				setMessage({ ton: 'refus', texte: texteRefusBloc(resultat.refus) })
				return
			}
			setAjoutes((precedents) => [...precedents, resultat.bloc])
			setMessage({ ton: 'succes', texte: t('goals.write.saved') })
		},
		[client, idTableau],
	)

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

	// LE CANEVAS EST RENDU DÈS QU'UNE POSE EST ARMÉE, MÊME SUR UN TABLEAU VIDE : c'est la surface
	// sur laquelle le geste se fait, et l'état vide qui la remplacerait n'aurait aucun endroit où
	// recevoir le clic. L'état vide porte donc le geste qui le comble
	// (`docs/DESIGN_SYSTEM.md` §5.13).
	const canevasRendu = blocsRendus.length > 0 || pose !== null

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
					<CommandePose armee={pose !== null} onBasculer={() => setPose(pose === null ? { x: PAS_CLAVIER * 3, y: PAS_CLAVIER * 3 } : null)} />
					<CommandesZoom rang={rangZoom} onChanger={setRangZoom} />
				</div>
			</header>

			{pose === null ? null : (
				<p data-testid="pose-consigne" className="text-sm text-text-2">
					{t('goals.place.hint')}
				</p>
			)}

			{/* La consigne clavier est CITÉE par chaque bloc en `aria-describedby` : un geste qui
			    n'existe qu'au clavier doit être annoncé au clavier, faute de quoi il n'existe pour
			    personne. Elle est visuellement masquée, jamais retirée (§12.3). */}
			<p id="objectifs-consigne-clavier" className="sr-only">
				{t('goals.block.keyboard.hint')}
			</p>

			{canevasRendu ? (
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
						/* LA POSITION VIENT DU GESTE (§3) : le point du clic devient le coin haut
						   gauche du bloc, sans placement automatique, sans recherche de place libre
						   et sans alignement sur une grille. */
						onClick={
							pose === null
								? undefined
								: (evenement) => {
										const cadre = evenement.currentTarget.getBoundingClientRect()
										void poserA({
											x: bornerCoordonnee((evenement.clientX - cadre.left) / zoom),
											y: bornerCoordonnee((evenement.clientY - cadre.top) / zoom),
										})
									}
						}
					>
						<TraitsDuDiagramme fleches={fleches} etendue={etendue} />
						{blocsRendus.map((bloc) => (
							<BlocCanevas
								key={bloc.id}
								bloc={bloc}
								zoom={zoom}
								onEbauche={(geometrie) => setEbauche({ id: bloc.id, geometrie })}
								onFin={(geometrie, mode) => void enregistrerGeometrie(bloc.id, geometrie, mode)}
							/>
						))}
						{pose === null ? null : (
							<RepereDePose
								position={pose}
								onDeplacer={setPose}
								onValider={() => void poserA(pose)}
								onAnnuler={() => setPose(null)}
							/>
						)}
					</div>
				</div>
			) : (
				<EtatVide
					titre={t('goals.board.empty.title')}
					corps={t('goals.board.empty.body')}
					action={
						<CommandePose armee={false} onBasculer={() => setPose({ x: PAS_CLAVIER * 3, y: PAS_CLAVIER * 3 })} />
					}
				/>
			)}

			<MentionEcriture message={message} />

			<EquivalentTextuel lignes={lignes} />
		</section>
	)
}

/**
 * La commande qui arme la pose, et l'annule — DEUX VISAGES, UN SEUL RENDU À LA FOIS, patron du
 * §5.3 quater. Elle n'est jamais éteinte selon le rôle (`docs/DESIGN_SYSTEM.md` §5.26) : la
 * lectrice l'ouvre, pose, et lit le refus du backend.
 */
function CommandePose({ armee, onBasculer }: { readonly armee: boolean; readonly onBasculer: () => void }) {
	return (
		<Button
			variante={armee ? 'secondaire' : 'primaire'}
			taille="compacte"
			data-testid="poser-bloc"
			aria-pressed={armee}
			onClick={onBasculer}
			className="gap-2"
		>
			{armee ? <X aria-hidden="true" size={16} strokeWidth={2} /> : <SquarePlus aria-hidden="true" size={16} strokeWidth={2} />}
			{armee ? t('goals.place.cancel') : t('goals.place.start')}
		</Button>
	)
}

/**
 * Le repère de pose — la moitié CLAVIER du geste de pose.
 *
 * Sans lui, poser un bloc serait un geste de souris, et le §5.5 serait tenu en apparence
 * seulement. Il porte la position que les flèches déplacent, `Entrée` valide et `Échap` annule ;
 * son nom accessible ÉCRIT la position, faute de quoi un utilisateur au lecteur d'écran
 * déplacerait un repère sans savoir où il est.
 */
function RepereDePose({
	position,
	onDeplacer,
	onValider,
	onAnnuler,
}: {
	readonly position: { readonly x: number; readonly y: number }
	readonly onDeplacer: (position: { readonly x: number; readonly y: number }) => void
	readonly onValider: () => void
	readonly onAnnuler: () => void
}) {
	const repere = useRef<HTMLDivElement | null>(null)

	// Le focus entre dans le repère dès qu'il est armé (`docs/DESIGN_SYSTEM.md` §5.13) : un repère
	// que les flèches ne pilotent qu'après un `Tab` supplémentaire ne serait pas le geste clavier
	// que le §5.5 demande.
	useEffect(() => {
		repere.current?.focus()
	}, [])

	return (
		<div
			ref={repere}
			data-testid="repere-pose"
			tabIndex={0}
			role="application"
			aria-label={t('goals.place.marker', { x: String(position.x), y: String(position.y) })}
			className="absolute rounded-lg border-2 border-brand bg-brand-soft focus-visible:outline-2 focus-visible:outline-brand"
			style={{
				left: `${position.x}px`,
				top: `${position.y}px`,
				width: `${TAILLE_BLOC_NEUF.largeur}px`,
				height: `${TAILLE_BLOC_NEUF.hauteur}px`,
			}}
			onKeyDown={(evenement) => {
				if (evenement.key === 'Escape') {
					evenement.preventDefault()
					onAnnuler()
					return
				}
				if (evenement.key === 'Enter' || evenement.key === ' ') {
					evenement.preventDefault()
					onValider()
					return
				}
				const direction = DIRECTIONS_CLAVIER[evenement.key]
				if (direction === undefined) return
				evenement.preventDefault()
				const pas = evenement.shiftKey ? PAS_CLAVIER_FIN : PAS_CLAVIER
				onDeplacer({
					x: bornerCoordonnee(position.x + direction[0] * pas),
					y: bornerCoordonnee(position.y + direction[1] * pas),
				})
			}}
		/>
	)
}

/**
 * Les trois mentions d'une écriture, jamais deux à la fois (`docs/DESIGN_SYSTEM.md` §5.7 ter).
 *
 * Elle vit SOUS le canevas, près de ce qu'elle concerne (§5.13) : un geste de géométrie porte sur
 * le canevas entier, et non sur une ligne d'un tableau. La région est TOUJOURS rendue, pour qu'un
 * lecteur d'écran ne découvre pas une région qui apparaît — un refus porte `role="alert"`, une
 * attente et une confirmation `role="status"`.
 */
function MentionEcriture({ message }: { readonly message: MessageEcriture | null }) {
	const TONS: Readonly<Record<MessageEcriture['ton'], string>> = {
		attente: 'text-text-3',
		succes: 'text-success',
		refus: 'text-danger-on-soft bg-danger-soft rounded-sm px-2 py-1',
	}
	return (
		<p
			data-testid="mention-ecriture"
			role={message?.ton === 'refus' ? 'alert' : 'status'}
			className={['text-sm', message === null ? '' : TONS[message.ton]].join(' ')}
		>
			{message?.texte ?? ''}
		</p>
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

/**
 * Un bloc du canevas — §5.2, `docs/DESIGN_SYSTEM.md` §5.29, et depuis la tranche 2a les deux
 * gestes de géométrie du §3.
 *
 * TROIS RÈGLES DE GESTE, ÉCRITES ICI PARCE QU'ELLES SE REDÉCOUVRENT MAL :
 *
 *   1. l'ancre d'un glissement est prise au `pointerdown` et gardée dans une référence, jamais
 *      relue à chaque mouvement : une ancre recalculée sur la position courante ferait dériver le
 *      bloc, chaque mouvement s'ajoutant au précédent ;
 *   2. les écarts de pointeur sont divisés par le ZOOM avant d'entrer dans le canevas — la surface
 *      porte un `scale`, si bien qu'un pixel d'écran ne vaut pas une unité de canevas ;
 *   3. un glissement parti d'un lien ou d'un bouton n'en est pas un. Sans cette garde, ouvrir le
 *      channel d'un bloc deviendrait impossible à la souris, le premier `pointerdown` armant un
 *      déplacement qui avale le clic.
 */
function BlocCanevas({
	bloc,
	zoom,
	onEbauche,
	onFin,
}: {
	readonly bloc: BlocObjectif
	readonly zoom: number
	readonly onEbauche: (geometrie: Geometrie) => void
	readonly onFin: (geometrie: Geometrie, mode: ModeGeste) => void
}) {
	const ouvrable = lienOuvrable(bloc)
	const perdu = lienPerdu(bloc)
	const destination = bloc.destination
	const geometrie = geometrieDe(bloc)

	const ancre = useRef<{
		readonly pointeur: { readonly x: number; readonly y: number }
		readonly geometrie: Geometrie
		readonly mode: ModeGeste
	} | null>(null)
	// Le MODE du geste clavier en cours, et non un simple drapeau : c'est lui qui dit, au
	// relâchement de la touche, quelles colonnes partent.
	const clavierEnCours = useRef<ModeGeste | null>(null)

	const etiquette =
		ouvrable && destination !== null && destination.track !== null
			? t('goals.block.aria.channel', {
					titre: bloc.title,
					valeur: String(bloc.fill_percent),
					track: destination.track.nom,
					channel: destination.nom,
				})
			: t('goals.block.aria', { titre: bloc.title, valeur: String(bloc.fill_percent) })

	const depuisAncre = (clientX: number, clientY: number): Geometrie | null => {
		const origine = ancre.current
		if (origine === null) return null
		const dx = (clientX - origine.pointeur.x) / zoom
		const dy = (clientY - origine.pointeur.y) / zoom
		if (origine.mode === 'deplacement') {
			return {
				...origine.geometrie,
				x: bornerCoordonnee(origine.geometrie.x + dx),
				y: bornerCoordonnee(origine.geometrie.y + dy),
			}
		}
		return {
			...origine.geometrie,
			largeur: bornerDimension(origine.geometrie.largeur + dx, TAILLE_BLOC_MINIMALE.largeur),
			hauteur: bornerDimension(origine.geometrie.hauteur + dy, TAILLE_BLOC_MINIMALE.hauteur),
		}
	}

	const armer = (mode: ModeGeste) => (evenement: EvenementPointeur<HTMLElement>) => {
		if (evenement.button !== 0) return
		if (mode === 'deplacement' && (evenement.target as HTMLElement).closest('a, button') !== null) return
		evenement.preventDefault()
		evenement.stopPropagation()
		evenement.currentTarget.setPointerCapture(evenement.pointerId)
		ancre.current = {
			pointeur: { x: evenement.clientX, y: evenement.clientY },
			geometrie,
			mode,
		}
	}

	const suivre = (evenement: EvenementPointeur<HTMLElement>) => {
		const suivante = depuisAncre(evenement.clientX, evenement.clientY)
		if (suivante !== null) onEbauche(suivante)
	}

	const relacher = (evenement: EvenementPointeur<HTMLElement>) => {
		const origine = ancre.current
		const finale = depuisAncre(evenement.clientX, evenement.clientY)
		if (origine === null || finale === null) return
		ancre.current = null
		if (evenement.currentTarget.hasPointerCapture(evenement.pointerId)) {
			evenement.currentTarget.releasePointerCapture(evenement.pointerId)
		}
		onFin(finale, origine.mode)
	}

	return (
		<article
			data-testid="bloc-objectif"
			data-bloc={bloc.id}
			tabIndex={0}
			aria-label={etiquette}
			aria-describedby="objectifs-consigne-clavier"
			className="absolute flex overflow-hidden rounded-lg border border-border bg-surface shadow-card touch-none focus-visible:outline-2 focus-visible:outline-brand"
			style={{
				left: `${bloc.pos_x}px`,
				top: `${bloc.pos_y}px`,
				width: `${bloc.width}px`,
				height: `${bloc.height}px`,
			}}
			onPointerDown={armer('deplacement')}
			onPointerMove={suivre}
			onPointerUp={relacher}
			onPointerCancel={() => {
				ancre.current = null
			}}
			/* LE CLAVIER FAIT EXACTEMENT CE QUE LA SOURIS FAIT (§5.5, `CLAUDE.md` §22) : flèches
			   pour déplacer, `Maj` pour ajuster au pixel, `Alt` pour redimensionner. L'écriture
			   part au RELÂCHEMENT de la touche, jamais à chaque répétition : une frappe maintenue
			   émettrait une requête par pixel. Aucune temporisation n'est employée pour cela. */
			onKeyDown={(evenement) => {
				const direction = DIRECTIONS_CLAVIER[evenement.key]
				if (direction === undefined) return
				evenement.preventDefault()
				const pas = evenement.shiftKey ? PAS_CLAVIER_FIN : PAS_CLAVIER
				clavierEnCours.current = evenement.altKey ? 'taille' : 'deplacement'
				onEbauche(
					evenement.altKey
						? {
								...geometrie,
								largeur: bornerDimension(geometrie.largeur + direction[0] * pas, TAILLE_BLOC_MINIMALE.largeur),
								hauteur: bornerDimension(geometrie.hauteur + direction[1] * pas, TAILLE_BLOC_MINIMALE.hauteur),
							}
						: {
								...geometrie,
								x: bornerCoordonnee(geometrie.x + direction[0] * pas),
								y: bornerCoordonnee(geometrie.y + direction[1] * pas),
							},
				)
			}}
			onKeyUp={(evenement) => {
				if (DIRECTIONS_CLAVIER[evenement.key] === undefined) return
				const mode = clavierEnCours.current
				if (mode === null) return
				clavierEnCours.current = null
				onFin(geometrie, mode)
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
			{/* POIGNÉE DE REDIMENSIONNEMENT — une affordance de SOURIS, et rien d'autre.
			    Elle est `aria-hidden` et hors du parcours de tabulation parce que le clavier
			    dispose du geste complet (`Alt` et flèches, annoncé par la consigne du canevas) :
			    un bouton qui ne ferait rien sur `Entrée` serait la commande morte que le §5.10
			    proscrit. L'écart de taille avec le §8 est nommé au §5.29 du design system. */}
			<span
				data-testid="poignee-taille"
				aria-hidden="true"
				className="absolute right-0 bottom-0 size-6 cursor-se-resize border-r-2 border-b-2 border-text-3 rounded-br-lg"
				onPointerDown={armer('taille')}
				onPointerMove={suivre}
				onPointerUp={relacher}
				onPointerCancel={() => {
					ancre.current = null
				}}
			/>
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
