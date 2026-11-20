// @verifies CRM-159 (docs/BACKLOG.md) — tranche T2 : sous les résultats de la palette, les mails masqués par une pastille
//           cachée — un lien vers l'inbox, la pastille activée, pour une pastille de l'espace courant ; un texte qui nomme
//           l'espace, sans lien, pour une autre ; rien sans mail masqué
// @verifies docs/SPEC-mail-subsystem.md §31.13.6 ; docs/DESIGN_SYSTEM.md §5.111 ; docs/JOURNAL.md décision 958
//
// La palette entière est éprouvée sur la vraie pile par `e2e/ui/pastilles-cachees.spec.ts` ; ici, la seule mention.

import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MailsMasques } from '../lib/recherche'

vi.mock('../lib/supabase', () => ({ clientCrm: null }))
const { MentionMailsMasques } = await import('./PaletteRecherche')

afterEach(cleanup)

const masque = (idPastille: string, nom: string, idEspace: string, nomEspace: string, mails: number): MailsMasques => ({
	idPastille,
	nom,
	idEspace,
	nomEspace,
	mails,
	adresse: `/inbox?pastille=${idPastille}`,
})

describe('la mention des mails masqués dans la palette (§5.111)', () => {
	it('une pastille de l’espace courant est une commande qui mène à l’inbox, la pastille activée', async () => {
		const onAller = vi.fn()
		render(<MentionMailsMasques masques={[masque('p-spam', 'Spam', 'ws-1', 'P2Enjoy', 3)]} idEspace="ws-1" onAller={onAller} />)
		const lien = screen.getByTestId('recherche-mails-masques-lien')
		expect(lien.textContent).toBe('3 mails masqués (Spam)')
		await userEvent.click(lien)
		expect(onAller).toHaveBeenCalledWith('/inbox?pastille=p-spam')
	})

	it('au singulier ; au clavier, `Entrée` mène aussi', async () => {
		const onAller = vi.fn()
		render(<MentionMailsMasques masques={[masque('p-spam', 'Spam', 'ws-1', 'P2Enjoy', 1)]} idEspace="ws-1" onAller={onAller} />)
		const lien = screen.getByTestId('recherche-mails-masques-lien')
		expect(lien.textContent).toBe('1 mail masqué (Spam)')
		lien.focus()
		await userEvent.keyboard('{Enter}')
		expect(onAller).toHaveBeenCalledTimes(1)
	})

	it('une pastille d’un autre espace nomme l’espace, sans lien : l’inbox ne l’activerait pas', () => {
		render(
			<MentionMailsMasques masques={[masque('p-ext', 'Spam', 'ws-2', 'Studio', 2)]} idEspace="ws-1" onAller={vi.fn()} />,
		)
		expect(screen.queryByTestId('recherche-mails-masques-lien')).toBeNull()
		expect(screen.getByTestId('recherche-mails-masques-ailleurs').textContent).toBe('2 mails masqués (Spam, espace Studio)')
	})

	it('rien sans mail masqué', () => {
		render(<MentionMailsMasques masques={[]} idEspace="ws-1" onAller={vi.fn()} />)
		expect(screen.queryByTestId('recherche-mails-masques')).toBeNull()
	})
})
