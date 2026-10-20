// @verifies CRM-105 (docs/BACKLOG.md) — ce que l'infobulle de description décide sans navigateur
// @verifies docs/DESIGN_SYSTEM.md §5.58 (aucune infobulle sans description ; sous l'élément ou à sa
//           droite, de l'autre côté faute de place ; cadre borné à la fenêtre avec 16 px de marge), §5.43
//
// Les rectangles sont écrits à la main : jsdom ne mesure rien, et la règle de cadre est précisément ce
// qu'une preuve de navigateur ne vérifierait qu'au palier où elle tombe.

import { describe, expect, it } from 'vitest'
import {
	ECART_INFOBULLE,
	MARGE_INFOBULLE,
	descriptionAffichable,
	positionnerInfobulle,
	type Rectangle,
} from './infobulle'

const FENETRE = { largeur: 1440, hauteur: 900 }
const BULLE = { largeur: 300, hauteur: 80 }

function rect(left: number, top: number, largeur: number, hauteur: number): Rectangle {
	return { left, top, right: left + largeur, bottom: top + hauteur }
}

describe('descriptionAffichable', () => {
	it('ne rend rien pour une description absente, vide ou blanche', () => {
		expect(descriptionAffichable(null)).toBeNull()
		expect(descriptionAffichable(undefined)).toBeNull()
		expect(descriptionAffichable('')).toBeNull()
		expect(descriptionAffichable('  \n\t ')).toBeNull()
	})

	it('garde le texte de la base, retours à la ligne intérieurs compris', () => {
		expect(descriptionAffichable('  Première ligne.\nSeconde ligne.  \n')).toBe(
			'Première ligne.\nSeconde ligne.',
		)
	})
})

describe('positionnerInfobulle — sous l’élément', () => {
	it('pose la bulle sous l’élément, à l’écart déclaré, bord gauche aligné', () => {
		const ancre = rect(400, 100, 120, 40)
		expect(positionnerInfobulle(ancre, BULLE, FENETRE, 'bas')).toEqual({
			gauche: 400,
			haut: 140 + ECART_INFOBULLE,
		})
	})

	it('passe au-dessus quand la place manque dessous et qu’il y en a dessus', () => {
		const ancre = rect(400, 820, 120, 40)
		expect(positionnerInfobulle(ancre, BULLE, FENETRE, 'bas').haut).toBe(820 - ECART_INFOBULLE - 80)
	})

	it('ne déborde jamais à droite : le bord droit reste à la marge de la fenêtre', () => {
		const ancre = rect(1380, 100, 50, 40)
		const { gauche } = positionnerInfobulle(ancre, BULLE, FENETRE, 'bas')
		expect(gauche + BULLE.largeur).toBe(FENETRE.largeur - MARGE_INFOBULLE)
	})

	it('ne déborde jamais à gauche, même sous un élément à demi hors du cadre', () => {
		const ancre = rect(-40, 100, 120, 40)
		expect(positionnerInfobulle(ancre, BULLE, FENETRE, 'bas').gauche).toBe(MARGE_INFOBULLE)
	})

	it('tient dans une fenêtre étroite : 390 px', () => {
		const etroite = { largeur: 390, hauteur: 780 }
		const bulle = { largeur: 358, hauteur: 120 }
		const { gauche, haut } = positionnerInfobulle(rect(200, 300, 150, 40), bulle, etroite, 'bas')
		expect(gauche).toBeGreaterThanOrEqual(MARGE_INFOBULLE)
		expect(gauche + bulle.largeur).toBeLessThanOrEqual(etroite.largeur - MARGE_INFOBULLE)
		expect(haut + bulle.hauteur).toBeLessThanOrEqual(etroite.hauteur - MARGE_INFOBULLE)
	})

	it('une bulle plus haute que la place se colle à la marge haute plutôt que de sortir', () => {
		const haute = { largeur: 300, hauteur: 2000 }
		expect(positionnerInfobulle(rect(400, 100, 120, 40), haute, FENETRE, 'bas').haut).toBe(
			MARGE_INFOBULLE,
		)
	})
})

describe('positionnerInfobulle — à droite de l’élément', () => {
	it('pose la bulle à droite, bord haut aligné', () => {
		const ancre = rect(12, 300, 220, 40)
		expect(positionnerInfobulle(ancre, BULLE, FENETRE, 'droite')).toEqual({
			gauche: 232 + ECART_INFOBULLE,
			haut: 300,
		})
	})

	it('passe à gauche quand la place manque à droite', () => {
		const ancre = rect(1200, 300, 200, 40)
		expect(positionnerInfobulle(ancre, BULLE, FENETRE, 'droite').gauche).toBe(
			1200 - ECART_INFOBULLE - BULLE.largeur,
		)
	})

	it('passe sous l’élément quand aucun des deux côtés ne suffit', () => {
		const etroite = { largeur: 390, hauteur: 780 }
		const ancre = rect(12, 300, 248, 40)
		const { haut } = positionnerInfobulle(ancre, BULLE, etroite, 'droite')
		expect(haut).toBe(340 + ECART_INFOBULLE)
	})

	it('reste dans la fenêtre en hauteur sous une pilule du bas de l’écran', () => {
		const ancre = rect(12, 870, 220, 40)
		const { haut } = positionnerInfobulle(ancre, BULLE, FENETRE, 'droite')
		expect(haut + BULLE.hauteur).toBe(FENETRE.hauteur - MARGE_INFOBULLE)
	})
})
