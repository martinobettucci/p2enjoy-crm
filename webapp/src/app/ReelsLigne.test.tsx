// @verifies CRM-099 (docs/BACKLOG.md) — tranche T2 : les réels d'une ligne de coût dans la fiche d'une affaire
// @verifies docs/SPEC-costs.md §2.3 bis (ajouter un réel ; une ligne soldée est figée — gestes éteints AVEC leur
//           motif ; soldée sans réel, elle vaut zéro) ; docs/DESIGN_SYSTEM.md §5.31 bis

import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ReelsLigne } from './ReelsLigne'
import { fr } from '../i18n/fr'
import type { ClientCrm } from '../lib/supabase'

afterEach(cleanup)

const REELS = [
	{ id: 'r1', amount: 40, spent_on: '2026-10-01', label: 'Facture 1' },
	{ id: 'r2', amount: 0, spent_on: '2026-10-02', label: null },
]

/** Client factice : la lecture des réels, et les écritures enregistrées, qui réussissent. */
function clientFactice(reels: readonly unknown[] = REELS) {
	const ecritures: { table: string; action: string; charge: unknown }[] = []
	const client = {
		from: (table: string) => {
			let action = 'select'
			let charge: unknown = null
			const chaine: Record<string, unknown> = {}
			for (const nom of ['eq', 'order', 'select']) chaine[nom] = () => chaine
			for (const nom of ['insert', 'update', 'delete']) {
				chaine[nom] = (c?: unknown) => {
					action = nom
					charge = c
					return chaine
				}
			}
			chaine.then = (ok: (r: unknown) => unknown) => {
				if (action === 'select') return Promise.resolve({ data: [...reels], error: null, status: 200 }).then(ok)
				ecritures.push({ table, action, charge })
				return Promise.resolve({ data: [{ id: 'x', actual_cost: 40 }], error: null, status: 200 }).then(ok)
			}
			return chaine
		},
	}
	return { client: client as unknown as ClientCrm, ecritures }
}

describe('les réels d’une ligne', () => {
	it('liste date, libellé — « Sans libellé » à défaut — et montant', async () => {
		const { client } = clientFactice()
		render(<ReelsLigne client={client} idLigne="l1" nature="Publicité" devise="EUR" soldee={false} onChange={() => undefined} aujourdhui="2026-10-11" />)
		const reels = await screen.findAllByTestId('reel')
		expect(within(reels[0]!).getByText('Facture 1')).toBeTruthy()
		expect(within(reels[0]!).getByText('1 octobre 2026')).toBeTruthy()
		expect(within(reels[1]!).getByText(fr['costs.actuals.nolabel'])).toBeTruthy()
	})

	it('un réel s’ajoute, daté du jour par défaut, et la fiche est prévenue pour relire la ligne', async () => {
		const { client, ecritures } = clientFactice([])
		const onChange = vi.fn()
		render(<ReelsLigne client={client} idLigne="l1" nature="Publicité" devise="EUR" soldee={false} onChange={onChange} aujourdhui="2026-10-11" />)
		await screen.findByText(fr['costs.actuals.none'])
		await userEvent.type(screen.getByLabelText(fr['costs.actuals.form.amount']), '120.50')
		await userEvent.click(screen.getByRole('button', { name: fr['costs.actuals.add'] }))
		await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1))
		expect(ecritures[0]).toEqual({
			table: 'card_cost_actuals',
			action: 'insert',
			charge: { card_cost_id: 'l1', amount: 120.5, label: null, spent_on: '2026-10-11' },
		})
	})

	it('une ligne soldée : plus de formulaire, des gestes éteints AVEC leur motif, la case reste offerte', async () => {
		const { client } = clientFactice()
		render(<ReelsLigne client={client} idLigne="l1" nature="Publicité" devise="EUR" soldee onChange={() => undefined} aujourdhui="2026-10-11" />)
		await screen.findAllByTestId('reel')
		expect(screen.queryByTestId('reels-formulaire')).toBeNull()
		const modifier = screen.getByRole('button', { name: 'Modifier le réel du 1 octobre 2026' }) as HTMLButtonElement
		expect(modifier.disabled).toBe(true)
		expect(modifier.getAttribute('aria-describedby')).toBe(screen.getByTestId('reels-motif-solde').id)
		expect((screen.getByTestId('reels-solde') as HTMLInputElement).disabled).toBe(false)
	})

	it('soldée sans réel, elle le dit : elle vaut zéro', async () => {
		const { client } = clientFactice([])
		render(<ReelsLigne client={client} idLigne="l1" nature="Publicité" devise="EUR" soldee onChange={() => undefined} aujourdhui="2026-10-11" />)
		expect(await screen.findByText(fr['costs.actuals.none.settled'])).toBeTruthy()
	})

	it('cocher « Soldé » envoie le drapeau de la ligne', async () => {
		const { client, ecritures } = clientFactice()
		const onChange = vi.fn()
		render(<ReelsLigne client={client} idLigne="l1" nature="Publicité" devise="EUR" soldee={false} onChange={onChange} aujourdhui="2026-10-11" />)
		await screen.findAllByTestId('reel')
		await userEvent.click(screen.getByTestId('reels-solde'))
		await waitFor(() => expect(onChange).toHaveBeenCalledWith(fr['costs.actuals.settled.done'].replace('{nature}', 'Publicité')))
		expect(ecritures[0]?.table).toBe('card_costs')
		expect(Object.keys(ecritures[0]?.charge as object)).toEqual(['settled_at'])
	})
})
