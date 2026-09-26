// @verifies CRM-081 (docs/BACKLOG.md) — la bascule du sommeil
// @verifies docs/INCONSISTENCY_REPORT.md INC-253 ; docs/JOURNAL.md décision 603 ; docs/DESIGN_SYSTEM.md
//           §5.7 bis (case de 24 px), §5.3 quinquies (la bascule), §8 (cible de 40 px portée par le libellé)

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BasculeSommeil } from './Sommeil'

afterEach(cleanup)

describe('BasculeSommeil', () => {
	it('rend une case de 24 px — `size-6`, jamais `size-4` —, dans un libellé haut de `--size-target`', () => {
		render(<BasculeSommeil mode="masquees" onMode={vi.fn()} />)
		const caseSommeil = screen.getByRole('checkbox', { name: 'Afficher les affaires en sommeil' })
		expect(caseSommeil.className.split(' ')).toContain('size-6')
		expect(caseSommeil.className.split(' ')).not.toContain('size-4')
		expect(screen.getByTestId('bascule-sommeil').className).toContain('min-h-[var(--size-target)]')
	})

	it('coche et décoche en rendant le mode, la case restant la cible', () => {
		const onMode = vi.fn()
		render(<BasculeSommeil mode="masquees" onMode={onMode} />)
		screen.getByRole('checkbox').click()
		expect(onMode).toHaveBeenCalledWith('visibles')
	})
})
