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
// @spec CRM-133 (docs/BACKLOG.md) — tranche T2 : `ouvrirAEntree`, pour le bouton d'information d'une étape, qui s'ouvre aussi
//       à la touche Entrée (docs/DESIGN_SYSTEM.md §5.58, révisé)
// @spec CRM-148 (docs/BACKLOG.md) — la bulle ÉPINGLÉE : un clic dans elle ou `Flèche bas` l'épingle ; épinglée, elle ne se ferme
//       qu'à sa croix ou à `Échap`, suit son élément au défilement, et son texte défile sans la fermer ; une seule épinglée
//       (docs/DESIGN_SYSTEM.md §5.58, « Épinglée — CRM-148 » ; docs/JOURNAL.md décision 929)

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { t } from '../../i18n'
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

/**
 * `CRM-148` : UNE SEULE BULLE ÉPINGLÉE À LA FOIS (§5.58). La fermeture de celle qui l'est, si une autre s'épingle. Un état de
 * module, et non un contexte : les bulles vivent dans quatre écrans sans ancêtre commun qui ne soit la coquille.
 */
let fermerLEpinglee: (() => void) | null = null

export type ProprietesInfobulle = {
	/** Le nom de l'objet, écrit en tête de la bulle : c'est ce que le `title` portait (§5.58). */
	readonly titre: string
	/** La description, telle que la base la rend. Absente, vide ou blanche : aucune infobulle. */
	readonly description: string | null | undefined
	/** Le côté de l'élément où la bulle se pose d'abord ; `droite` pour la barre latérale. */
	readonly cote?: CoteInfobulle
	/**
	 * `CRM-133` (§5.58 révisé) : la touche Entrée ouvre aussi la bulle — pour le bouton d'information d'une étape, qui
	 * n'est pas un lien et ne navigue pas. Jamais pour un lien : Entrée y navigue, et la bulle resterait sur l'écran
	 * d'arrivée.
	 */
	readonly ouvrirAEntree?: boolean
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

export function Infobulle({
	titre,
	description,
	cote = 'bas',
	ouvrirAEntree = false,
	children,
}: ProprietesInfobulle) {
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
	// `CRM-148` : épinglée par un clic dans elle ou par `Flèche bas`. L'état pour le rendu, la référence pour les gestionnaires
	// d'événements, qui se déclenchent avant le rendu suivant (le focus qui entre dans la bulle fait perdre le sien à l'élément).
	const [epinglee, setEpinglee] = useState(false)
	const epingleeRef = useRef(false)
	// L'épinglage au clavier place le focus dans le texte, une fois la bulle rendue épinglée.
	const focusAuTexte = useRef(false)
	const texteRef = useRef<HTMLDivElement>(null)
	const croixRef = useRef<HTMLButtonElement>(null)
	const idTitre = useId()

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
		epingleeRef.current = false
		setEpinglee(false)
	}, [annulerMinuterie])

	// La fermeture de CETTE bulle, stable, que le registre de module garde quand elle est épinglée.
	const fermerCetteBulle = useRef(fermer)
	fermerCetteBulle.current = fermer
	const fermerEnregistree = useRef(() => fermerCetteBulle.current())

	const epingler = useCallback(
		(auClavier: boolean) => {
			annulerMinuterie()
			if (fermerLEpinglee !== null && fermerLEpinglee !== fermerEnregistree.current) fermerLEpinglee()
			fermerLEpinglee = fermerEnregistree.current
			epingleeRef.current = true
			focusAuTexte.current = auClavier
			setEpinglee(true)
			setOuverte(true)
		},
		[annulerMinuterie],
	)

	// La croix et `Échap` : fermer, et RENDRE LE FOCUS À L'ÉLÉMENT sans la rouvrir (§5.58, « Épinglée »).
	const fermerEtRendreLeFocus = useCallback(() => {
		tenueFermee.current = true
		fermer()
		const element = ancre.current?.firstElementChild
		if (element instanceof HTMLElement) element.focus()
	}, [fermer])

	// Le registre de module ne garde jamais la fermeture d'une bulle démontée.
	useEffect(
		() => () => {
			if (fermerLEpinglee === fermerEnregistree.current) fermerLEpinglee = null
		},
		[],
	)
	useEffect(() => {
		if (!epinglee && fermerLEpinglee === fermerEnregistree.current) fermerLEpinglee = null
	}, [epinglee])

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
		// Épinglée, le pointeur qui s'en va ne la ferme pas (§5.58, « Épinglée »).
		if (epingleeRef.current) return
		minuterie.current = window.setTimeout(() => {
			minuterie.current = undefined
			setOuverte(false)
			setPosition(null)
		}, DELAI_FERMETURE_INFOBULLE)
	}, [annulerMinuterie])

	useEffect(() => annulerMinuterie, [annulerMinuterie])

	// La bulle est mesurée APRÈS son rendu et AVANT d'être peinte : sa taille dépend de son texte, et une
	// bulle peinte à l'origine puis déplacée clignoterait.
	const mesurer = useCallback(() => {
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
	}, [cote])

	useLayoutEffect(() => {
		if (!ouverte) return
		mesurer()
		// `epinglee` : la croix change la hauteur de la ligne du nom, la bulle se re-mesure.
	}, [ouverte, mesurer, texte, titre, epinglee])

	// `CRM-148` : épinglée au clavier, le focus entre dans le texte une fois la bulle rendue — et son entrée l'annonce.
	useEffect(() => {
		if (!epinglee || !focusAuTexte.current) return
		focusAuTexte.current = false
		texteRef.current?.focus()
	}, [epinglee])

	// Masquable : `Échap` ferme sans déplacer ni le pointeur ni le focus. Défiler ou redimensionner rendrait
	// la position fausse : la bulle se ferme plutôt que de flotter loin de son élément.
	useEffect(() => {
		if (!ouverte) return
		const surTouche = (evenement: KeyboardEvent) => {
			if (evenement.key !== 'Escape') return
			// Épinglée, `Échap` ferme aussi, et rend le focus à l'élément (décision 929).
			if (epingleeRef.current) {
				fermerEtRendreLeFocus()
				return
			}
			tenueFermee.current = true
			fermer()
		}
		// `CRM-148` — LA CAUSE DU DÉFAUT : le défilement du TEXTE de la bulle, capté ici, la fermait. Un défilement dont la
		// cible est dans la bulle ne fait rien ; les autres la ferment, ou la recalent sur son élément si elle est épinglée.
		const surDeplacement = (evenement: Event) => {
			const cible = evenement.target
			if (cible instanceof Node && bulle.current?.contains(cible)) return
			if (epingleeRef.current) mesurer()
			else fermer()
		}
		document.addEventListener('keydown', surTouche)
		globalThis.addEventListener('scroll', surDeplacement, true)
		globalThis.addEventListener('resize', surDeplacement)
		return () => {
			document.removeEventListener('keydown', surTouche)
			globalThis.removeEventListener('scroll', surDeplacement, true)
			globalThis.removeEventListener('resize', surDeplacement)
		}
	}, [ouverte, fermer, fermerEtRendreLeFocus, mesurer])

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
				onKeyDown={(evenement) => {
					// `CRM-148` : `Flèche bas` épingle la bulle ouverte sur l'élément qui a le focus, et y place le focus.
					if (evenement.key === 'ArrowDown' && ouverte && !epingleeRef.current) {
						evenement.preventDefault()
						epingler(true)
						return
					}
					if (!ouvrirAEntree || evenement.key !== 'Enter') return
					tenueFermee.current = false
					ouvrirApres(0)
				}}
				onBlur={() => {
					tenueFermee.current = false
					// Épinglée, la perte du focus ne la ferme pas : il entre dans elle, ou part ailleurs (§5.58).
					if (epingleeRef.current) return
					fermer()
				}}
			>
				{children({ idDescription })}
				{/* Toujours présent, ouvert ou non : le lecteur d'écran n'attend pas la bulle (§5.58).
				    `position: fixed`, ET NON L'`absolute` DE `sr-only` — défaut trouvé par la preuve de palier de `CRM-148` : dans
				    une carte du board, sans ancêtre positionné, le texte masqué s'échappait du conteneur défilant et faisait
				    défiler la PAGE (1565 px à une fenêtre de 900). Un élément fixe ne compte pas dans le défilement du document ;
				    une enveloppe `relative` (§5.16) ajouterait un élément aux mises en page `flex` des appelants. */}
				<span id={idDescription} className="sr-only" style={{ position: 'fixed' }}>
					{texte}
				</span>
			</span>
			{ouverte
				? createPortal(
						<div
							ref={bulle}
							// Épinglée, la bulle porte une commande : elle n'est plus masquée aux technologies d'assistance, et devient
							// une boîte de dialogue NON MODALE nommée par l'objet (§5.58, « Épinglée »).
							{...(epinglee
								? { role: 'dialog', 'aria-modal': false, 'aria-labelledby': idTitre }
								: { 'aria-hidden': true })}
							data-testid="infobulle"
							data-epinglee={epinglee ? 'true' : undefined}
							onMouseEnter={annulerMinuterie}
							onMouseLeave={fermerApres}
							// UN CLIC DANS LA BULLE L'ÉPINGLE, n'importe où dans elle ; à la souris, le focus ne bouge pas.
							onPointerDown={(evenement) => {
								// LE PORTAIL REMONTE PAR L'ARBRE REACT, JAMAIS PAR LE DOM : sans cet arrêt, l'appui dans la bulle
								// atteindrait les ANCÊTRES de l'élément — la carte déplaçable du board y commencerait un glisser-déposer.
								evenement.stopPropagation()
								if (!epingleeRef.current) epingler(false)
							}}
							// `Tab` va du texte à la croix et revient : deux arrêts, sans sortir de la bulle.
							onKeyDown={(evenement) => {
								if (evenement.key !== 'Tab' || !epingleeRef.current) return
								evenement.preventDefault()
								const surCroix = document.activeElement === croixRef.current
								;(surCroix ? texteRef.current : croixRef.current)?.focus()
							}}
							style={
								position === null
									? { left: 0, top: 0, visibility: 'hidden' }
									: { left: position.gauche, top: position.haut, width: position.largeur }
							}
							className={[
								'fixed z-50 flex flex-col gap-1 px-3 py-2',
								'max-w-[min(40ch,calc(100vw_-_32px))] max-h-[min(50vh,320px)] overflow-hidden',
								'bg-surface border border-border rounded-sm shadow-card-hover',
							].join(' ')}
						>
							<div className="flex items-start gap-2 shrink-0">
								<p id={idTitre} className="flex-1 min-w-0 text-sm font-medium text-ink break-words">
									{titre}
								</p>
								{/* LA CROIX NE PARAÎT QUE SUR UNE BULLE ÉPINGLÉE, en haut à droite (décision 929). */}
								{epinglee ? (
									<button
										ref={croixRef}
										type="button"
										data-testid="infobulle-fermer"
										aria-label={t('infobulle.fermer', { titre })}
										onClick={fermerEtRendreLeFocus}
										className="shrink-0 -my-2 -mr-2 inline-flex items-center justify-center size-[var(--size-target)] rounded-sm text-text-2 hover:bg-hover focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-brand"
									>
										<X aria-hidden="true" size={16} />
									</button>
								) : null}
							</div>
							{/* SEUL LE TEXTE DÉFILE : le nom et la croix restent en tête. Épinglée, c'est une région que le clavier
							    atteint et que les flèches font défiler. */}
							<div
								ref={texteRef}
								data-testid="infobulle-texte"
								{...(epinglee
									? { tabIndex: 0, role: 'region', 'aria-label': t('infobulle.texte', { titre }) }
									: {})}
								className="min-h-0 overflow-y-auto text-sm text-text-2 whitespace-pre-line break-words focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand rounded-sm"
							>
								{texte}
							</div>
						</div>,
						document.body,
					)
				: null}
		</>
	)
}
