// @verifies CRM-105 (docs/BACKLOG.md) — le composant partagé de l'infobulle de description
// @verifies docs/DESIGN_SYSTEM.md §5.58 (rien sans description ; le nom en tête puis la description ; au
//           survol après le délai, au focus clavier sans délai, jamais au clic ; survolable ; `Échap` ;
//           le lecteur d'écran n'attend pas la bulle), §5.3 bis (un `title` seul ne suffit pas)
// @verifies CRM-148 (docs/BACKLOG.md) — la bulle épinglée : un clic dans elle ou `Flèche bas` l'épingle ; la croix et `Échap`
//           la ferment et rendent le focus ; son texte défile sans la fermer ; épinglée, ni le pointeur qui part, ni la
//           perte du focus, ni un clic ailleurs, ni le défilement de la page ne la ferment ; une seule épinglée
//           (docs/DESIGN_SYSTEM.md §5.58, « Épinglée — CRM-148 » ; docs/JOURNAL.md décision 929)
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
	it('`CRM-148` : le texte masqué est fixe, et ne fait jamais défiler la page depuis un conteneur défilant', () => {
		monter(DESCRIPTION)
		const id = lien().getAttribute('aria-describedby') ?? ''
		expect(document.getElementById(id)?.style.position).toBe('fixed')
	})

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
		// RÉVISÉ PAR `CRM-148` (décision 51), non relâché : la description est la région de texte qui défile seule, sous le nom.
		expect(rendue?.querySelector('p')?.textContent).toBe('Grands comptes')
		expect(rendue?.querySelector('[data-testid="infobulle-texte"]')?.textContent).toBe(DESCRIPTION)
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

describe('épinglée — CRM-148 (§5.58, décision 929)', () => {
	const ouvrirAuSurvol = () => {
		fireEvent.mouseEnter(lien())
		act(() => vi.advanceTimersByTime(DELAI_OUVERTURE_INFOBULLE))
		expect(bulle()).not.toBeNull()
	}
	const croix = () => screen.queryByRole('button', { name: 'Fermer la description de Grands comptes' })

	it('son propre texte défile sans la fermer, épinglée ou non — la cause du défaut', () => {
		monter(DESCRIPTION)
		ouvrirAuSurvol()
		fireEvent.scroll(screen.getByTestId('infobulle-texte'))
		expect(bulle()).not.toBeNull()
		expect(croix()).toBeNull()
	})

	it('un clic dans la bulle l’épingle : la croix paraît, et c’est un dialogue non modal nommé par l’objet', () => {
		monter(DESCRIPTION)
		ouvrirAuSurvol()
		fireEvent.pointerDown(screen.getByTestId('infobulle-texte'))
		const rendue = bulle()
		expect(rendue?.getAttribute('data-epinglee')).toBe('true')
		expect(rendue?.hasAttribute('aria-hidden')).toBe(false)
		expect(screen.getByRole('dialog', { name: 'Grands comptes' })).toBe(rendue)
		expect(croix()).not.toBeNull()
		expect(screen.getByRole('region', { name: 'Description de Grands comptes' }).getAttribute('tabindex')).toBe('0')
	})

	it('épinglée, ni le pointeur qui part, ni la perte du focus, ni un clic ailleurs, ni le défilement ne la ferment', () => {
		monter(DESCRIPTION)
		ouvrirAuSurvol()
		fireEvent.pointerDown(bulle()!)
		fireEvent.mouseLeave(bulle()!)
		fireEvent.mouseLeave(lien())
		act(() => vi.advanceTimersByTime(1000))
		fireEvent.blur(lien())
		fireEvent.pointerDown(document.body)
		fireEvent.scroll(window)
		fireEvent.resize(window)
		expect(bulle()?.getAttribute('data-epinglee')).toBe('true')
	})

	it('la croix la ferme et rend le focus à l’élément, sans la rouvrir', async () => {
		simulerModaliteClavier()
		monter(DESCRIPTION)
		ouvrirAuSurvol()
		fireEvent.pointerDown(bulle()!)
		await userEvent.click(croix()!)
		expect(bulle()).toBeNull()
		expect(document.activeElement).toBe(lien())
		act(() => vi.advanceTimersByTime(DELAI_OUVERTURE_INFOBULLE * 2))
		expect(bulle()).toBeNull()
	})

	it('au clavier, `Flèche bas` l’épingle et y place le focus ; `Tab` va du texte à la croix et revient ; `Échap` ferme et rend le focus', async () => {
		simulerModaliteClavier()
		monter(DESCRIPTION)
		await userEvent.tab()
		expect(bulle()).not.toBeNull()
		await userEvent.keyboard('{ArrowDown}')
		const texte = screen.getByRole('region', { name: 'Description de Grands comptes' })
		expect(document.activeElement).toBe(texte)
		await userEvent.tab()
		expect(document.activeElement).toBe(croix())
		await userEvent.tab()
		expect(document.activeElement).toBe(texte)
		await userEvent.keyboard('{Escape}')
		expect(bulle()).toBeNull()
		expect(document.activeElement).toBe(lien())
	})

	it('`Flèche bas` ne fait rien quand la bulle est fermée', async () => {
		monter(DESCRIPTION)
		act(() => lien().focus())
		await userEvent.keyboard('{ArrowDown}')
		expect(bulle()).toBeNull()
	})

	it('un appui dans la bulle n’atteint pas les ancêtres de l’élément (une carte déplaçable du board)', () => {
		const appuiAncetre = vi.fn()
		render(
			<div onPointerDown={appuiAncetre}>
				<Infobulle titre="Carte" description="Description de la carte.">
					{({ idDescription }) => (
						<a href="/carte" aria-describedby={idDescription}>
							Carte
						</a>
					)}
				</Infobulle>
			</div>,
		)
		fireEvent.mouseEnter(screen.getByRole('link', { name: 'Carte' }))
		act(() => vi.advanceTimersByTime(DELAI_OUVERTURE_INFOBULLE))
		fireEvent.pointerDown(screen.getByTestId('infobulle'))
		expect(appuiAncetre).not.toHaveBeenCalled()
		expect(screen.getByTestId('infobulle').getAttribute('data-epinglee')).toBe('true')
	})

	it('un appui sur l’élément la ferme, même épinglée : il navigue', () => {
		monter(DESCRIPTION)
		ouvrirAuSurvol()
		fireEvent.pointerDown(bulle()!)
		fireEvent.pointerDown(lien())
		expect(bulle()).toBeNull()
	})

	it('une seule épinglée à la fois : en épingler une autre ferme la première', () => {
		render(
			<>
				{['Premier', 'Second'].map((nom) => (
					<Infobulle key={nom} titre={nom} description={`Description de ${nom.toLowerCase()}.`}>
						{({ idDescription }) => (
							<a href={`/${nom}`} aria-describedby={idDescription}>
								{nom}
							</a>
						)}
					</Infobulle>
				))}
			</>,
		)
		for (const nom of ['Premier', 'Second']) {
			fireEvent.mouseEnter(screen.getByRole('link', { name: nom }))
			act(() => vi.advanceTimersByTime(DELAI_OUVERTURE_INFOBULLE))
			const ouvertes = screen.getAllByTestId('infobulle')
			fireEvent.pointerDown(ouvertes[ouvertes.length - 1]!)
		}
		const restantes = screen.getAllByTestId('infobulle')
		expect(restantes).toHaveLength(1)
		expect(restantes[0]?.textContent).toContain('Second')
	})
})
