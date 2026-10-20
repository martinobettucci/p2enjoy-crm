// @spec CRM-105 (docs/BACKLOG.md) — l'infobulle de description, partagée par la barre latérale, la barre
//       d'onglets, la carte de board et la ligne de vue liste
// @spec docs/DESIGN_SYSTEM.md §5.58 (tout le comportement : quand elle existe, ce qu'elle montre, où elle
//       se pose, quand elle s'ouvre et se ferme, ce que le lecteur d'écran entend), §5.49 (relief), §5.43
//       (largeur et cadre), §5.3 bis (un `title` seul ne suffit pas), §8 (parité clavier), §10 (donnée)
// @spec docs/JOURNAL.md décision 629
//
// La bulle est rendue À LA RACINE DU DOCUMENT et non dans l'élément : les quatre écrans qui l'emploient
// défilent dans leur propre conteneur (§7, §12.6), qui la rognerait. Le composant ne décide pas où la
// poser — `webapp/src/lib/infobulle.ts` le fait, sur les rectangles qu'il mesure ici.
//
// Ce que le composant NE fait PAS : changer l'élément. Il le reçoit par une fonction, lui donne
// l'identifiant de la description à citer, et c'est l'écran appelant qui décide de garder ou non son
// `title` — gardé quand il n'y a pas de description, retiré quand la bulle le remplace (§5.58).

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import {
	descriptionAffichable,
	positionnerInfobulle,
	type CoteInfobulle,
	type PositionInfobulle,
} from '../../lib/infobulle'

/** Le survol n'ouvre la bulle qu'après ce délai : traverser une liste ne la fait pas clignoter (§5.58). */
export const DELAI_OUVERTURE_INFOBULLE = 400

/** Le temps laissé au pointeur pour passer de l'élément à la bulle — survolable (§5.58, WCAG 1.4.13). */
export const DELAI_FERMETURE_INFOBULLE = 150

export type ProprietesInfobulle = {
	/** Le nom de l'objet, écrit en tête de la bulle : c'est ce que le `title` portait (§5.58). */
	readonly titre: string
	/** La description, telle que la base la rend. Absente, vide ou blanche : aucune infobulle. */
	readonly description: string | null | undefined
	/** Le côté de l'élément où la bulle se pose d'abord ; `droite` pour la barre latérale. */
	readonly cote?: CoteInfobulle
	/**
	 * Rend l'élément. `idDescription` est l'identifiant à citer en `aria-describedby`, ou `undefined`
	 * quand il n'y a rien à décrire — l'élément est alors rendu exactement comme avant.
	 */
	readonly children: (declencheur: { readonly idDescription: string | undefined }) => ReactNode
}

/**
 * Le focus vient-il du clavier ? La bulle s'ouvre au focus clavier, jamais au focus posé par un clic
 * (§5.58). Un moteur qui ne connaît pas `:focus-visible` lève une erreur de syntaxe : le focus est
 * alors tenu pour un focus clavier, plutôt que de priver le clavier de la bulle.
 */
function focusClavier(element: Element): boolean {
	try {
		return element.matches(':focus-visible')
	} catch {
		return true
	}
}

export function Infobulle({ titre, description, cote = 'bas', children }: ProprietesInfobulle) {
	const texte = descriptionAffichable(description)
	const idDescription = useId()
	const [ouverte, setOuverte] = useState(false)
	// La largeur mesurée est reposée avec la position : une bulle `fixed` se dimensionne sur la place qui
	// reste à droite de son bord gauche, et déplacée vers la droite elle se rétrécirait, donc grandirait en
	// hauteur, après avoir été mesurée.
	const [position, setPosition] = useState<(PositionInfobulle & { readonly largeur: number }) | null>(null)
	const ancre = useRef<HTMLSpanElement>(null)
	const bulle = useRef<HTMLDivElement>(null)
	const minuterie = useRef<number | undefined>(undefined)
	// Un appui ferme la bulle et la tient fermée jusqu'à ce que le pointeur quitte l'élément ou que le
	// focus le quitte : sans quoi le focus posé par le clic, ou le pointeur resté dessus, la rouvrirait
	// sur l'écran d'arrivée (§5.58, « jamais au clic »). `Échap` la tient fermée de la même façon.
	const tenueFermee = useRef(false)

	const annulerMinuterie = useCallback(() => {
		if (minuterie.current !== undefined) {
			window.clearTimeout(minuterie.current)
			minuterie.current = undefined
		}
	}, [])

	const fermer = useCallback(() => {
		annulerMinuterie()
		setOuverte(false)
		setPosition(null)
	}, [annulerMinuterie])

	const ouvrirApres = useCallback(
		(delai: number) => {
			annulerMinuterie()
			if (tenueFermee.current) return
			if (delai === 0) {
				setOuverte(true)
				return
			}
			minuterie.current = window.setTimeout(() => {
				minuterie.current = undefined
				setOuverte(true)
			}, delai)
		},
		[annulerMinuterie],
	)

	const fermerApres = useCallback(() => {
		annulerMinuterie()
		minuterie.current = window.setTimeout(() => {
			minuterie.current = undefined
			setOuverte(false)
			setPosition(null)
		}, DELAI_FERMETURE_INFOBULLE)
	}, [annulerMinuterie])

	useEffect(() => annulerMinuterie, [annulerMinuterie])

	// La bulle est mesurée APRÈS son rendu et AVANT d'être peinte : sa taille dépend de son texte, et une
	// bulle peinte à l'origine puis déplacée clignoterait.
	useLayoutEffect(() => {
		if (!ouverte) return
		const element = ancre.current?.firstElementChild
		const cadre = bulle.current?.getBoundingClientRect()
		if (element === null || element === undefined || cadre === undefined) return
		setPosition({
			...positionnerInfobulle(
				element.getBoundingClientRect(),
				{ largeur: cadre.width, hauteur: cadre.height },
				{ largeur: globalThis.innerWidth, hauteur: globalThis.innerHeight },
				cote,
			),
			largeur: cadre.width,
		})
	}, [ouverte, cote, texte, titre])

	// Masquable : `Échap` ferme sans déplacer ni le pointeur ni le focus. Défiler ou redimensionner rendrait
	// la position fausse : la bulle se ferme plutôt que de flotter loin de son élément.
	useEffect(() => {
		if (!ouverte) return
		const surTouche = (evenement: KeyboardEvent) => {
			if (evenement.key !== 'Escape') return
			tenueFermee.current = true
			fermer()
		}
		const surDeplacement = () => fermer()
		document.addEventListener('keydown', surTouche)
		globalThis.addEventListener('scroll', surDeplacement, true)
		globalThis.addEventListener('resize', surDeplacement)
		return () => {
			document.removeEventListener('keydown', surTouche)
			globalThis.removeEventListener('scroll', surDeplacement, true)
			globalThis.removeEventListener('resize', surDeplacement)
		}
	}, [ouverte, fermer])

	if (texte === null) {
		return <>{children({ idDescription: undefined })}</>
	}

	return (
		<>
			{/* `contents` : l'enveloppe ne prend aucune place dans la mise en page de l'écran appelant, et elle
			    reçoit pourtant les événements de l'élément, qui remontent par le document. */}
			<span
				ref={ancre}
				className="contents"
				onMouseEnter={() => ouvrirApres(DELAI_OUVERTURE_INFOBULLE)}
				onMouseLeave={() => {
					tenueFermee.current = false
					if (ouverte) fermerApres()
					else annulerMinuterie()
				}}
				onPointerDown={() => {
					tenueFermee.current = true
					fermer()
				}}
				onFocus={(evenement) => {
					if (focusClavier(evenement.target)) ouvrirApres(0)
				}}
				onBlur={() => {
					tenueFermee.current = false
					fermer()
				}}
			>
				{children({ idDescription })}
				{/* Toujours présent, ouvert ou non : le lecteur d'écran n'attend pas la bulle (§5.58). */}
				<span id={idDescription} className="sr-only">
					{texte}
				</span>
			</span>
			{ouverte
				? createPortal(
						<div
							ref={bulle}
							aria-hidden="true"
							data-testid="infobulle"
							onMouseEnter={annulerMinuterie}
							onMouseLeave={fermerApres}
							style={
								position === null
									? { left: 0, top: 0, visibility: 'hidden' }
									: { left: position.gauche, top: position.haut, width: position.largeur }
							}
							className={[
								'fixed z-50 flex flex-col gap-1 px-3 py-2',
								'max-w-[min(40ch,calc(100vw_-_32px))] max-h-[min(50vh,320px)] overflow-y-auto',
								'bg-surface border border-border rounded-sm shadow-card-hover',
							].join(' ')}
						>
							<p className="text-sm font-medium text-ink break-words">{titre}</p>
							<p className="text-sm text-text-2 whitespace-pre-line break-words">{texte}</p>
						</div>,
						document.body,
					)
				: null}
		</>
	)
}
