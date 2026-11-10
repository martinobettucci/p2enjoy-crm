// @verifies CRM-137 (docs/BACKLOG.md) — le sélecteur d'affaire cherchable et la case « Expéditeur connu » : la case cochée
//           à l'ouverture, la relecture au repos de la frappe, la réponse périmée ignorée, la présélection unique, le
//           choix qui survit au filtre, les vides et leur action, l'erreur et sa reprise, le clavier
// @verifies docs/DESIGN_SYSTEM.md §5.94, §5.46 ; docs/SPEC-mail-subsystem.md §26.3 ; docs/JOURNAL.md décision 893
//
// Le lecteur est injecté : ces preuves éprouvent le RENDU et le comportement, la base l'est par pgTAP (0161) et par
// `e2e/api/candidats-classement.spec.ts`.

import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useRef, useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Candidate, DemandeCandidates, ResultatCandidates } from '../lib/candidats-classement'
import { SelecteurClassement } from './SelecteurClassement'

afterEach(cleanup)

const A: Candidate = { id: 'a', titre: 'Refonte du site vitrine', chemin: 'Conseil IA › Grands comptes', connue: true }
const B: Candidate = { id: 'b', titre: 'Support niveau 2', chemin: 'Studio web › Maintenance', connue: true }
const C: Candidate = { id: 'c', titre: 'Audit sécurité', chemin: '', connue: false }

function lecteur(repondre: (d: DemandeCandidates) => ResultatCandidates | Promise<ResultatCandidates>) {
	const demandes: DemandeCandidates[] = []
	const lire = vi.fn((d: DemandeCandidates) => {
		demandes.push(d)
		return Promise.resolve(repondre(d))
	})
	return { lire, demandes }
}

function Banc({ lire, onEchap = () => undefined }: { lire: (d: DemandeCandidates) => Promise<ResultatCandidates>; onEchap?: () => void }) {
	const [choix, setChoix] = useState<Candidate | null>(null)
	const champ = useRef<HTMLInputElement | null>(null)
	return (
		<SelecteurClassement
			messageId="m1"
			expediteur="leo.marchand@sogexia.example"
			choix={choix}
			onChoisir={setChoix}
			onEchap={onEchap}
			champ={champ}
			lire={lire}
		/>
	)
}

const pret = (candidates: readonly Candidate[], tronquee = false): ResultatCandidates => ({ ok: true, candidates, tronquee })

describe('SelecteurClassement', () => {
	it('s’ouvre case cochée, sans terme, et nomme l’adresse de l’expéditeur', async () => {
		const { lire, demandes } = lecteur(() => pret([A, B]))
		render(<Banc lire={lire} />)
		expect((screen.getByTestId('classement-connu') as HTMLInputElement).checked).toBe(true)
		expect(screen.getByText('leo.marchand@sogexia.example').tagName).toBe('CODE')
		await waitFor(() => expect(screen.getAllByTestId('classement-option')).toHaveLength(2))
		expect(demandes[0]).toEqual({ messageId: 'm1', connues: true, terme: '' })
		// Deux candidates : aucune présélection, « Classer » attendra un choix.
		expect(screen.getByTestId('classement-choix').textContent).toBe('')
	})

	it('présélectionne l’affaire unique d’une liste cochée et sans terme', async () => {
		const { lire } = lecteur(() => pret([A]))
		render(<Banc lire={lire} />)
		await waitFor(() =>
			expect(screen.getByTestId('classement-choix').textContent).toBe(
				'Affaire choisie : Refonte du site vitrine — Conseil IA › Grands comptes',
			),
		)
		expect(screen.getByTestId('classement-option')?.getAttribute('aria-selected')).toBe('true')
	})

	it('décocher relit aussitôt toutes les affaires, et marque les connues d’une pilule', async () => {
		const { lire, demandes } = lecteur((d) => (d.connues ? pret([A]) : pret([A, C])))
		render(<Banc lire={lire} />)
		await waitFor(() => expect(screen.getAllByTestId('classement-option')).toHaveLength(1))
		await userEvent.click(screen.getByTestId('classement-connu'))
		await waitFor(() => expect(screen.getAllByTestId('classement-option')).toHaveLength(2))
		expect(demandes.at(-1)).toEqual({ messageId: 'm1', connues: false, terme: '' })
		const [premiere, seconde] = screen.getAllByTestId('classement-option')
		expect(premiere?.textContent).toContain('Expéditeur connu')
		expect(seconde?.textContent).not.toContain('Expéditeur connu')
	})

	it('la frappe ne relit qu’au repos, et une réponse périmée est ignorée', async () => {
		vi.useFakeTimers({ shouldAdvanceTime: true })
		try {
			let resoudreLente: (r: ResultatCandidates) => void = () => undefined
			const demandes: DemandeCandidates[] = []
			const lire = (d: DemandeCandidates) => {
				demandes.push(d)
				if (d.terme === 'v') return new Promise<ResultatCandidates>((r) => (resoudreLente = r))
				if (d.terme === 'vitri') return Promise.resolve(pret([A]))
				return Promise.resolve(pret([A, B]))
			}
			render(<Banc lire={lire} />)
			await waitFor(() => expect(screen.getAllByTestId('classement-option')).toHaveLength(2))
			const champ = screen.getByTestId('classement-champ')
			const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
			await user.type(champ, 'v')
			await act(() => vi.advanceTimersByTimeAsync(250))
			await user.type(champ, 'itri')
			await act(() => vi.advanceTimersByTimeAsync(250))
			await waitFor(() => expect(screen.getAllByTestId('classement-option')).toHaveLength(1))
			// La réponse lente de « v » arrive après celle de « vitri » : elle ne remplace rien.
			await act(async () => resoudreLente(pret([A, B, C])))
			expect(screen.getAllByTestId('classement-option')).toHaveLength(1)
			expect(demandes.map((d) => d.terme)).toEqual(['', 'v', 'vitri'])
		} finally {
			vi.useRealTimers()
		}
	})

	it('au clavier : les flèches activent sans quitter le champ, Entrée choisit, Échap referme', async () => {
		const onEchap = vi.fn()
		const { lire } = lecteur(() => pret([A, B]))
		render(<Banc lire={lire} onEchap={onEchap} />)
		await waitFor(() => expect(screen.getAllByTestId('classement-option')).toHaveLength(2))
		const champ = screen.getByTestId('classement-champ')
		champ.focus()
		await userEvent.keyboard('{ArrowDown}{ArrowDown}')
		const options = screen.getAllByTestId('classement-option')
		expect(document.activeElement).toBe(champ)
		expect(champ?.getAttribute('aria-activedescendant')).toBe(options[1]?.id)
		await userEvent.keyboard('{Enter}')
		expect(screen.getByTestId('classement-choix')?.textContent).toContain('Support niveau 2')
		expect(options[1]?.getAttribute('aria-selected')).toBe('true')
		await userEvent.keyboard('{Escape}')
		expect(onEchap).toHaveBeenCalledTimes(1)
	})

	it('le choix survit au filtre qui le fait sortir de la liste', async () => {
		const { lire } = lecteur((d) => (d.terme === 'audit' ? pret([C]) : pret([A, B])))
		render(<Banc lire={lire} />)
		await waitFor(() => expect(screen.getAllByTestId('classement-option')).toHaveLength(2))
		await userEvent.pointer({ target: screen.getAllByTestId('classement-option')[0]!, keys: '[MouseLeft]' })
		await userEvent.click(screen.getByTestId('classement-connu'))
		await userEvent.type(screen.getByTestId('classement-champ'), 'audit')
		await waitFor(() => expect(screen.getAllByTestId('classement-option')).toHaveLength(1))
		expect(screen.getByTestId('classement-choix')?.textContent).toContain('Affaire choisie : Refonte du site vitrine')
	})

	it('vide, case cochée : la phrase nomme l’adresse, et « Voir toutes les affaires » décoche et rend le focus au champ', async () => {
		const { lire } = lecteur((d) => (d.connues ? pret([]) : pret([C])))
		render(<Banc lire={lire} />)
		await waitFor(() =>
			expect(screen.getByTestId('classement-vide')?.textContent).toContain(
				'leo.marchand@sogexia.example n’est le contact d’aucune affaire.',
			),
		)
		await userEvent.click(screen.getByTestId('classement-elargir'))
		expect((screen.getByTestId('classement-connu') as HTMLInputElement).checked).toBe(false)
		expect(document.activeElement).toBe(screen.getByTestId('classement-champ'))
		await waitFor(() => expect(screen.getAllByTestId('classement-option')).toHaveLength(1))
	})

	it('vide avec un terme : la phrase cite le terme et l’action dit qu’elle cherche partout ; décochée, aucune action', async () => {
		const { lire } = lecteur(() => pret([]))
		render(<Banc lire={lire} />)
		await userEvent.type(screen.getByTestId('classement-champ'), 'zorglub')
		await waitFor(() => expect(screen.getByTestId('classement-vide')?.textContent).toContain('zorglub'))
		expect(screen.getByTestId('classement-elargir')?.textContent).toContain('Chercher dans toutes les affaires')
		await userEvent.click(screen.getByTestId('classement-elargir'))
		await waitFor(() => expect(screen.queryByTestId('classement-elargir')).toBeNull())
	})

	it('l’erreur se dit et « Réessayer » relit ; la troncature est écrite', async () => {
		let essais = 0
		const { lire } = lecteur(() =>
			++essais === 1 ? { ok: false, erreur: { nature: 'network', detail: 'x' } } : pret([A], true),
		)
		render(<Banc lire={lire} />)
		await waitFor(() => expect(screen.getByTestId('classement-erreur')?.textContent).toContain('La liste des affaires n’a pas pu être lue.'))
		await userEvent.click(screen.getByRole('button', { name: 'Réessayer' }))
		await waitFor(() => expect(screen.getByTestId('classement-tronquee')?.textContent).toContain('Les 50 premières affaires'))
	})
})
