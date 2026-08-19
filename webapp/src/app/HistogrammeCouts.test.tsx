// @verifies CRM-086 (docs/BACKLOG.md) — écrans de coûts, TRANCHE 2 : l'histogramme partagé
// @verifies docs/SPEC-costs.md §4.2 (deux barres par groupe, le réel dépassant passe en danger),
//           §4.4 (la mention des réels manquants est OBLIGATOIRE dès qu'une ligne en manque, et
//           ABSENTE sinon), §4.7 (état vide : deux barres nulles ET une phrase)
// @verifies docs/DESIGN_SYSTEM.md §5.30 (axe à zéro, valeurs en clair, légende nommant les séries,
//           tableau équivalent rendu sous le graphique), §1 (la couleur ne porte jamais seule
//           l'information)
//
// CE FICHIER ÉPROUVE CE QU'UN LECTEUR D'ÉCRAN PERÇOIT, et pas seulement ce qu'un œil voit. Le §5.30
// pose que le tableau équivalent est la version accessible du graphique ; les assertions portent
// donc sur le tableau — rôles `table`, `row`, `cell` — plutôt que sur les barres, qui sont
// `aria-hidden` à dessein. Un test qui n'interrogerait que les barres laisserait le tableau
// disparaître sans bruit, et avec lui la seule lecture qui reste juste si la couleur ne passe pas.
//
// LE TEST DE L'ÉCHELLE EST CELUI QUI PROTÈGE L'HONNÊTETÉ DE L'ÉCRAN. Le §5.30 exige que l'axe parte
// de zéro : une échelle resserrée autour des valeurs exagérerait visuellement un écart, et c'est
// exactement la comparaison que cet écran existe pour porter.

import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import {
	HistogrammeCouts,
	echelle,
	formaterMontant,
	hauteurPourcent,
	type GroupeHistogramme,
} from './HistogrammeCouts'

afterEach(cleanup)

const groupe = (
	cle: string,
	libelle: string,
	estime: number,
	reel: number,
	sansReel = 0,
	estimeSansReel = 0,
	// UN GROUPE DE FIXTURE PORTE UNE LIGNE PAR DÉFAUT, et ce n'est pas arbitraire : le §4.7
	// distingue « aucune dépense rattachée » de « des dépenses qui s'annulent », et cette
	// distinction se lit désormais sur le COMPTE (décision 476). Un défaut à zéro ferait rendre la
	// phrase de l'état vide à tous les scénarios de ce fichier, dont aucun n'est vide.
	lignes = 1,
): GroupeHistogramme => ({
	cle,
	libelle,
	agregat: { estime, reel, sansReel, estimeSansReel, lignes },
})

// ---------------------------------------------------------------------------------------------

describe('hauteurPourcent — docs/DESIGN_SYSTEM.md §5.30, « l\'axe part de zéro, toujours »', () => {
	it('rapporte la valeur au maximum, et non à un intervalle resserré', () => {
		// 340 sur un maximum de 350 rend 97 % : l'axe part de zéro. Une échelle resserrée entre 340
		// et 350 rendrait 0 % et 100 %, ce qui ferait lire dix euros d'écart comme un gouffre.
		expect(Math.round(hauteurPourcent(340, 350))).toBe(97)
		expect(hauteurPourcent(350, 350)).toBe(100)
	})

	it('rend zéro sur un maximum nul, et jamais NaN — c\'est l\'état vide du §4.7', () => {
		expect(hauteurPourcent(0, 0)).toBe(0)
	})

	it('rend une hauteur POSITIVE pour une valeur négative — un avoir est un coût (§2.1)', () => {
		// Une hauteur négative sortirait la barre du cadre. C'est l'étiquette, qui porte le signe,
		// qui dit le sens ; la barre, elle, dit l'ampleur.
		expect(hauteurPourcent(-50, 100)).toBe(50)
	})

	it('plafonne à 100 %', () => {
		expect(hauteurPourcent(500, 100)).toBe(100)
	})
})

describe('echelle', () => {
	it('prend le maximum ABSOLU des deux séries confondues', () => {
		// Une échelle par série rendrait deux barres de hauteur comparable pour 100 et 900, et la
		// comparaison — l'objet même de l'écran — n'aurait plus aucun sens.
		expect(echelle([groupe('a', 'A', 100, 900)])).toBe(900)
	})

	it('reste positive sur un graphique entièrement négatif', () => {
		// Un maximum signé vaudrait 0 ici, et toutes les barres seraient pleines.
		expect(echelle([groupe('a', 'A', -100, -300)])).toBe(300)
	})

	it('rend zéro sans aucun groupe', () => {
		expect(echelle([])).toBe(0)
	})
})

describe('formaterMontant', () => {
	it('délègue à Intl, jamais à une concaténation', () => {
		expect(formaterMontant(1234, 'EUR')).toContain('€')
	})

	it('reste lisible sur une devise que le navigateur ne connaît pas', () => {
		// Un code inventé ne doit pas faire tomber l'écran : le montant reste lu, suivi du code que
		// la base porte.
		const rendu = formaterMontant(1234, 'ZZZ')
		expect(rendu).toContain('ZZZ')
		expect(rendu).toMatch(/1/)
	})
})

describe('HistogrammeCouts — ce que le lecteur d\'écran perçoit', () => {
	const TOTAL_MIXTE = { estime: 450, reel: 375, sansReel: 1, estimeSansReel: 100 }

	function rendre(groupes: readonly GroupeHistogramme[], total = TOTAL_MIXTE) {
		render(
			<HistogrammeCouts
				devise="EUR"
				groupes={groupes}
				total={total}
				legendeColonne="Budget"
			/>,
		)
	}

	it('nomme les trois séries dans la légende — la couleur ne suffit jamais (§1)', () => {
		rendre([groupe('b1', 'Publicité', 100, 0, 1, 100)])
		expect(screen.getAllByText('Prévisionnel').length).toBeGreaterThan(0)
		expect(screen.getAllByText('Réel').length).toBeGreaterThan(0)
		expect(screen.getByText('Réel dépassant le prévisionnel')).toBeTruthy()
	})

	it('rend un TABLEAU ÉQUIVALENT portant chaque groupe et le total (§5.30)', () => {
		rendre([
			groupe('b1', 'Publicité', 100, 0, 1, 100),
			groupe('b2', 'Production', 350, 375),
		])
		const tableau = screen.getByRole('table')
		expect(within(tableau).getByRole('rowheader', { name: /Publicité/ })).toBeTruthy()
		expect(within(tableau).getByRole('rowheader', { name: /Production/ })).toBeTruthy()
		expect(within(tableau).getByRole('rowheader', { name: 'Total' })).toBeTruthy()
	})

	it('dit le dépassement EN TEXTE, et pas seulement par la couleur de la barre', () => {
		rendre([groupe('b2', 'Production', 350, 375)])
		expect(screen.getByText('dépassement')).toBeTruthy()
	})

	it('ne dit PAS « dépassement » à l\'égalité', () => {
		rendre([groupe('b2', 'Production', 350, 350)])
		expect(screen.queryByText('dépassement')).toBeNull()
	})

	it('rend la mention du §4.4 dès qu\'une ligne manque son réel — elle est OBLIGATOIRE', () => {
		rendre([groupe('b1', 'Publicité', 100, 0, 1, 100)])
		const mention = screen.getByText(/ligne\(s\) sans coût réel saisi/)
		expect(mention.textContent).toContain('1 ligne(s)')
		// « pour m € de prévisionnel » : le montant est celui des lignes SANS réel, pas l'estimé
		// total. Les confondre annoncerait 450 € là où 100 € seulement sont en attente.
		expect(mention.textContent).toMatch(/100/)
	})

	it('N\'AFFICHE PAS la mention quand tous les réels sont saisis', () => {
		// Elle est absente, et non rendue à zéro : un avertissement permanent cesserait d'être lu,
		// et c'est précisément quand il apparaît qu'il doit se remarquer.
		rendre([groupe('b2', 'Production', 350, 375)], {
			estime: 350,
			reel: 375,
			sansReel: 0,
			estimeSansReel: 0,
		})
		expect(screen.queryByText(/sans coût réel saisi/)).toBeNull()
	})

	it('rend la phrase de l\'état vide, et pas seulement des barres nulles (§4.7)', () => {
		rendre([], { estime: 0, reel: 0, sansReel: 0, estimeSansReel: 0, lignes: 0 })
		expect(screen.getByText('Aucune dépense rattachée.')).toBeTruthy()
	})

	// -----------------------------------------------------------------------------------------
	// PREUVE RÉVISÉE ET ÉTENDUE À LA DÉCISION 476. La condition de l'état vide portait sur
	// `groupes.length === 0` : un histogramme SANS BUDGET. Un budget réellement vide gardait donc
	// ses deux barres nulles et se taisait — défaut MESURÉ par la preuve d'interface de la
	// tranche 3 sur « Suisse romande », que le seed pose sans aucune ligne. La condition porte
	// désormais sur le COMPTE DE LIGNES, et les deux cas ci-dessous sont ce qui l'oblige à ne pas
	// se déduire des montants.
	// -----------------------------------------------------------------------------------------

	it('rend la phrase sur un budget PRÉSENT mais SANS ligne — le cas exact du §4.7', () => {
		rendre([groupe('b1', 'Suisse romande', 0, 0, 0, 0, 0)], {
			estime: 0,
			reel: 0,
			sansReel: 0,
			estimeSansReel: 0,
			lignes: 0,
		})
		expect(screen.getByText('Aucune dépense rattachée.')).toBeTruthy()
		// Les barres et le tableau restent rendus À CÔTÉ de la phrase : le §4.7 demande « deux
		// barres nulles ET la phrase », pas la phrase à la place du budget.
		expect(screen.getByRole('row', { name: /Suisse romande/ })).toBeTruthy()
	})

	it('NE rend PAS la phrase quand des lignes existent et que leurs montants s’annulent', () => {
		// La contre-épreuve, et elle est indispensable : le §2.1 pose qu'un avoir est un coût
		// négatif légitime. Une condition écrite sur `estime === 0 && reel === 0` écrirait ici
		// « aucune dépense rattachée » sur un budget qui en porte deux — la valeur par défaut
		// trompeuse que `CLAUDE.md` §18 interdit.
		rendre([groupe('b1', 'Avoirs', 0, 0, 0, 0, 2)], {
			estime: 0,
			reel: 0,
			sansReel: 0,
			estimeSansReel: 0,
			lignes: 2,
		})
		expect(screen.queryByText('Aucune dépense rattachée.')).toBeNull()
	})

	it('rend le compte des lignes en attente PAR GROUPE, et non seulement au total', () => {
		// Sans cette colonne, l'utilisateur voit qu'il manque des réels sans savoir où : la mention
		// du §4.4 dit combien, le tableau dit lesquels.
		rendre([
			groupe('b1', 'Publicité', 100, 0, 1, 100),
			groupe('b2', 'Production', 350, 375),
		])
		const tableau = screen.getByRole('table')
		const lignePublicite = within(tableau)
			.getByRole('rowheader', { name: /Publicité/ })
			.closest('tr')
		expect(lignePublicite).not.toBeNull()
		expect(lignePublicite?.textContent).toContain('1')
	})

	it('rend la précision sous le libellé quand elle est fournie', () => {
		render(
			<HistogrammeCouts
				devise="EUR"
				groupes={[{ ...groupe('o1', 'Janvier 2026', 100, 90), precision: '01/01 – 31/01' }]}
				total={{ estime: 100, reel: 90, sansReel: 0, estimeSansReel: 0 }}
				legendeColonne="Occurrence"
			/>,
		)
		expect(screen.getByText('01/01 – 31/01')).toBeTruthy()
	})

	it('masque le GRAPHIQUE aux lecteurs d\'écran — le tableau est sa version accessible', () => {
		const { container } = render(
			<HistogrammeCouts
				devise="EUR"
				groupes={[groupe('b1', 'Publicité', 100, 90)]}
				total={{ estime: 100, reel: 90, sansReel: 0, estimeSansReel: 0 }}
				legendeColonne="Budget"
			/>,
		)
		// Sans cet attribut, un lecteur d'écran énoncerait deux fois la même série : une fois par
		// les étiquettes des barres, une fois par le tableau.
		expect(container.querySelector('[aria-hidden="true"].overflow-x-auto')).not.toBeNull()
	})
})
