// @verifies CRM-105 (docs/BACKLOG.md) — le composant partagé de l'infobulle de description
// @verifies docs/DESIGN_SYSTEM.md §5.58 (rien sans description ; le nom en tête puis la description ; au
//           survol après le délai, au focus clavier sans délai, jamais au clic ; survolable ; `Échap` ;
//           le lecteur d'écran n'attend pas la bulle), §5.3 bis (un `title` seul ne suffit pas)
//
// Le composant est monté autour d'un vrai lien, comme dans les quatre écrans. La POSITION n'est pas
// éprouvée ici — jsdom ne mesure rien — : elle l'est par `webapp/src/lib/infobulle.test.ts` sur des
// rectangles, et par `e2e/ui/infobulle-description.spec.ts` dans un vrai navigateur.

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DELAI_FERMETURE_INFOBULLE, DELAI_OUVERTURE_INFOBULLE, Infobulle } from './Infobulle'

const DESCRIPTION = 'Clients stratégiques suivis par un interlocuteur dédié.\nCycles de décision longs.'

function monter(description: string | null) {
	return render(
		<Infobulle titre="Grands comptes" description={description}>
			{({ idDescription }) => (
				<a
					href="/tracks/conseil-ia/grands-comptes"
					title={idDescription === undefined ? 'Grands comptes' : undefined}
					aria-describedby={idDescription}
				>
					Grands comptes
				</a>
			)}
		</Infobulle>,
	)
}

const lien = () => screen.getByRole('link', { name: 'Grands comptes' })

/**
 * Le navigateur tient `:focus-visible` pour vrai après une touche, faux après un clic. MESURÉ : jsdom le
 * rend FAUX en toute circonstance. Les scénarios clavier simulent donc la modalité clavier du navigateur
 * sur ce seul sélecteur ; le comportement réel est prouvé par `e2e/ui/infobulle-description.spec.ts`.
 */
function simulerModaliteClavier() {
	const origine = Element.prototype.matches
	vi.spyOn(Element.prototype, 'matches').mockImplementation(function (this: Element, selecteur: string) {
		return selecteur === ':focus-visible' ? true : origine.call(this, selecteur)
	})
}
const bulle = () => screen.queryByTestId('infobulle')

beforeEach(() => {
	vi.useFakeTimers({ shouldAdvanceTime: true })
})

afterEach(() => {
	vi.useRealTimers()
	cleanup()
})

describe('sans description', () => {
	it.each([null, '', '   \n '])('« %s » : l’élément est rendu comme avant, `title` compris', (description) => {
		monter(description)
		expect(lien()?.getAttribute('title')).toBe('Grands comptes')
		expect(lien().hasAttribute('aria-describedby')).toBe(false)
		fireEvent.mouseEnter(lien())
		act(() => vi.advanceTimersByTime(DELAI_OUVERTURE_INFOBULLE * 2))
		expect(bulle()).toBeNull()
	})
})

describe('avec une description', () => {
	it('retire le `title` et cite un texte de description toujours présent', () => {
		monter(DESCRIPTION)
		expect(lien().hasAttribute('title')).toBe(false)
		const id = lien().getAttribute('aria-describedby')
		expect(id).not.toBeNull()
		// Fermée, la bulle n'existe pas — et la description est pourtant annoncée.
		expect(bulle()).toBeNull()
		expect(document.getElementById(id ?? '')?.textContent).toBe(DESCRIPTION)
	})

	it('s’ouvre au survol après le délai, et pas avant', () => {
		monter(DESCRIPTION)
		fireEvent.mouseEnter(lien())
		act(() => vi.advanceTimersByTime(DELAI_OUVERTURE_INFOBULLE - 1))
		expect(bulle()).toBeNull()
		act(() => vi.advanceTimersByTime(1))
		expect(bulle()).not.toBeNull()
	})

	it('porte le nom en tête puis la description, et reste muette pour le lecteur d’écran', () => {
		monter(DESCRIPTION)
		fireEvent.mouseEnter(lien())
		act(() => vi.advanceTimersByTime(DELAI_OUVERTURE_INFOBULLE))
		const rendue = bulle()
		expect(rendue?.getAttribute('aria-hidden')).toBe('true')
		const paragraphes = rendue?.querySelectorAll('p') ?? []
		expect(paragraphes[0]?.textContent).toBe('Grands comptes')
		expect(paragraphes[1]?.textContent).toBe(DESCRIPTION)
		// Rendue à la racine du document, hors des conteneurs défilants.
		expect(rendue?.parentElement).toBe(document.body)
	})

	it('un passage rapide n’ouvre rien', () => {
		monter(DESCRIPTION)
		fireEvent.mouseEnter(lien())
		act(() => vi.advanceTimersByTime(DELAI_OUVERTURE_INFOBULLE / 2))
		fireEvent.mouseLeave(lien())
		act(() => vi.advanceTimersByTime(DELAI_OUVERTURE_INFOBULLE * 2))
		expect(bulle()).toBeNull()
	})

	it('est survolable : passer de l’élément à la bulle la garde ouverte', () => {
		monter(DESCRIPTION)
		fireEvent.mouseEnter(lien())
		act(() => vi.advanceTimersByTime(DELAI_OUVERTURE_INFOBULLE))
		fireEvent.mouseLeave(lien())
		act(() => vi.advanceTimersByTime(DELAI_FERMETURE_INFOBULLE - 1))
		fireEvent.mouseEnter(bulle() as HTMLElement)
		act(() => vi.advanceTimersByTime(DELAI_FERMETURE_INFOBULLE * 4))
		expect(bulle()).not.toBeNull()
		fireEvent.mouseLeave(bulle() as HTMLElement)
		act(() => vi.advanceTimersByTime(DELAI_FERMETURE_INFOBULLE))
		expect(bulle()).toBeNull()
	})

	it('est persistante : aucune minuterie ne la ferme tant que le pointeur reste', () => {
		monter(DESCRIPTION)
		fireEvent.mouseEnter(lien())
		act(() => vi.advanceTimersByTime(60_000))
		expect(bulle()).not.toBeNull()
	})

	it('s’ouvre au focus clavier, sans délai, et se ferme à la perte du focus', async () => {
		simulerModaliteClavier()
		const utilisateur = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
		monter(DESCRIPTION)
		await utilisateur.tab()
		expect(document.activeElement).toBe(lien())
		expect(bulle()).not.toBeNull()
		await utilisateur.tab()
		expect(bulle()).toBeNull()
	})

	it('est masquable : `Échap` la ferme sans déplacer le focus, et elle ne se rouvre pas seule', async () => {
		simulerModaliteClavier()
		const utilisateur = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
		monter(DESCRIPTION)
		await utilisateur.tab()
		expect(bulle()).not.toBeNull()
		await utilisateur.keyboard('{Escape}')
		expect(bulle()).toBeNull()
		expect(document.activeElement).toBe(lien())
		fireEvent.mouseEnter(lien())
		act(() => vi.advanceTimersByTime(DELAI_OUVERTURE_INFOBULLE * 2))
		expect(bulle()).toBeNull()
	})

	it('un focus qui n’est pas clavier — posé par la souris — n’ouvre rien', () => {
		monter(DESCRIPTION)
		act(() => lien().focus())
		expect(document.activeElement).toBe(lien())
		expect(bulle()).toBeNull()
	})

	it('un appui ferme la bulle, et le focus qu’il pose ne la rouvre pas', () => {
		monter(DESCRIPTION)
		fireEvent.mouseEnter(lien())
		act(() => vi.advanceTimersByTime(DELAI_OUVERTURE_INFOBULLE))
		expect(bulle()).not.toBeNull()
		fireEvent.pointerDown(lien())
		fireEvent.focus(lien())
		act(() => vi.advanceTimersByTime(DELAI_OUVERTURE_INFOBULLE * 2))
		expect(bulle()).toBeNull()
	})

	it('se ferme au défilement : sa position deviendrait fausse', () => {
		monter(DESCRIPTION)
		fireEvent.mouseEnter(lien())
		act(() => vi.advanceTimersByTime(DELAI_OUVERTURE_INFOBULLE))
		fireEvent.scroll(window)
		expect(bulle()).toBeNull()
	})
})
