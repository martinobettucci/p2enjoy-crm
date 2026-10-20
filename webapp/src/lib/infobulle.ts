// @spec CRM-105 (docs/BACKLOG.md) — ce que l'infobulle de description décide sans navigateur
// @spec docs/DESIGN_SYSTEM.md §5.58 (elle n'existe que s'il y a une description ; sous l'élément ou à
//       sa droite, de l'autre côté faute de place ; cadre borné à la fenêtre, 16 px de marge), §5.43
//       (mesurer le cadre de la surface flottante, jamais la page)
// @spec docs/JOURNAL.md décision 629
//
// Ce module ne rend rien : il **décide**. Le composant `webapp/src/components/ui/Infobulle.tsx` mesure
// l'élément et la bulle, puis lui demande où poser celle-ci. La séparation rend la règle de cadre du
// §5.58 vérifiable par un test unitaire, sur des rectangles écrits à la main — jsdom ne mesure rien.

/** L'écart entre l'élément et la bulle, en pixels (§5.58). */
export const ECART_INFOBULLE = 8

/** La marge que la bulle garde avec chaque bord de la fenêtre, en pixels (§5.58, §5.43). */
export const MARGE_INFOBULLE = 16

/** Le côté de l'élément où la bulle se pose d'abord. */
export type CoteInfobulle = 'bas' | 'droite'

/** Un rectangle, à la forme de ce que `getBoundingClientRect` rend et de ce que la règle lit. */
export type Rectangle = {
	readonly left: number
	readonly top: number
	readonly right: number
	readonly bottom: number
}

export type Dimensions = { readonly largeur: number; readonly hauteur: number }

export type PositionInfobulle = { readonly gauche: number; readonly haut: number }

/**
 * La description à afficher, ou `null` lorsqu'il n'y en a pas.
 *
 * Absente, vide ou faite de blancs : aucune infobulle (§5.58). Le texte rendu reste celui de la base,
 * retours à la ligne compris — seuls les blancs de tête et de queue tombent, qui ne se voient pas et
 * décaleraient la bulle d'une ligne vide.
 */
export function descriptionAffichable(description: string | null | undefined): string | null {
	if (description === null || description === undefined) return null
	const nettoyee = description.trim()
	return nettoyee === '' ? null : nettoyee
}

/** Ramène une coordonnée dans `[min, max]` ; une bulle plus grande que la place se colle à `min`. */
function borner(valeur: number, min: number, max: number): number {
	if (max < min) return min
	return Math.min(Math.max(valeur, min), max)
}

/**
 * Où poser la bulle, en coordonnées de la fenêtre (`position: fixed`).
 *
 * - **`bas`** : sous l'élément, bord gauche aligné sur le sien ; au-dessus s'il n'y a pas la place
 *   dessous et qu'il y en a dessus.
 * - **`droite`** : à droite de l'élément, bord haut aligné sur le sien ; à sa gauche s'il n'y a pas
 *   la place à droite ; sous lui si aucun des deux côtés ne suffit.
 *
 * Dans tous les cas, le cadre est ensuite **borné à la fenêtre** avec la marge du §5.58 : bord gauche
 * ≥ marge, bord droit ≤ largeur − marge, et de même en hauteur.
 */
export function positionnerInfobulle(
	ancre: Rectangle,
	bulle: Dimensions,
	fenetre: Dimensions,
	cote: CoteInfobulle,
): PositionInfobulle {
	const maxGauche = fenetre.largeur - MARGE_INFOBULLE - bulle.largeur
	const maxHaut = fenetre.hauteur - MARGE_INFOBULLE - bulle.hauteur

	if (cote === 'droite') {
		const aDroite = ancre.right + ECART_INFOBULLE
		const aGauche = ancre.left - ECART_INFOBULLE - bulle.largeur
		const gauche =
			aDroite <= maxGauche ? aDroite : aGauche >= MARGE_INFOBULLE ? aGauche : null
		if (gauche !== null) {
			return { gauche, haut: borner(ancre.top, MARGE_INFOBULLE, maxHaut) }
		}
	}

	const dessous = ancre.bottom + ECART_INFOBULLE
	const dessus = ancre.top - ECART_INFOBULLE - bulle.hauteur
	const haut = dessous <= maxHaut ? dessous : dessus >= MARGE_INFOBULLE ? dessus : dessous
	return {
		gauche: borner(ancre.left, MARGE_INFOBULLE, maxGauche),
		haut: borner(haut, MARGE_INFOBULLE, maxHaut),
	}
}
