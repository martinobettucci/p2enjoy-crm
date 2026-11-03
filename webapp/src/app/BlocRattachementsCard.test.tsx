// @verifies CRM-111 (docs/BACKLOG.md) T7.2 — le bloc « Rattachements » : une ligne par rattachement, celle de la fiche
//           marquée et sans détail, les autres en liens avec étape, responsable, montant et pilules ; archiver relit la
//           fiche, un refus se dit dans la ligne ; la commande d'un channel que la base refuse est éteinte avec le motif
//           du bloc (docs/SPEC-rattachements.md §8.1 ; docs/DESIGN_SYSTEM.md §5.82, §5.59)

import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RattachementDuBloc } from '../lib/formulaire'
import type { ClientCrm } from '../lib/supabase'
import { BlocRattachementsCard } from './BlocRattachementsCard'

afterEach(cleanup)

const COURANT: RattachementDuBloc = {
	id: 'p-studio', slugTrack: 'studio-web', slugChannel: 'refonte', track: 'Studio web', channel: 'Refonte de site',
	courant: true, idChannel: 'ch-refonte', etape: 'Négociation', responsable: 'Camille Aubert', montant: 12000, archivedAt: null, snoozedUntil: null,
}
const AUTRE: RattachementDuBloc = {
	id: 'p-conseil', slugTrack: 'conseil-ia', slugChannel: 'grands-comptes', track: 'Conseil & IA', channel: 'Grands comptes',
	courant: false, idChannel: 'ch-grands-comptes', etape: 'Prospection', responsable: null, montant: 4321, archivedAt: '2026-11-01T00:00:00Z',
	snoozedUntil: '2026-12-01T00:00:00Z',
}

/** `ecritures` : ce que `channels.ecriture_permise` rend pour chaque channel (§5.59) ; absent, la ligne est inconnue. */
function client(
	reponse: { data: unknown[] | null; error: unknown; status: number },
	ecritures: Record<string, boolean> = { 'ch-refonte': true, 'ch-grands-comptes': true },
) {
	const charges: unknown[] = []
	const faux = {
		from: (table: string) =>
			table === 'channels'
				? {
						select: () => ({
							in: () =>
								Promise.resolve({
									data: Object.entries(ecritures).map(([id, ecriture_permise]) => ({ id, ecriture_permise })),
									error: null,
									status: 200,
								}),
						}),
					}
				: {
						update: (charge: unknown) => {
							charges.push(charge)
							const chaine = { eq: () => chaine, select: () => Promise.resolve(reponse) }
							return chaine
						},
					},
	} as unknown as ClientCrm
	return { faux, charges }
}

function monter(c: ClientCrm, onChange = vi.fn()) {
	render(
		<MemoryRouter>
			<BlocRattachementsCard
				idCard="c-1"
				devise="EUR"
				rattachements={[AUTRE, COURANT]}
				onChange={onChange}
				client={c}
				maintenant={() => new Date('2026-11-03T10:00:00Z')}
			/>
		</MemoryRouter>,
	)
	return onChange
}

describe('le bloc « Rattachements » (§5.82)', () => {
	it('la ligne de la fiche est marquée, sans lien ni détail ; l’autre est un lien vers son adresse, avec ses détails', () => {
		monter(client({ data: [], error: null, status: 200 }).faux)
		const lignes = screen.getAllByTestId('ligne-rattachement')
		const courante = lignes.find((ligne) => ligne.getAttribute('aria-current') === 'page')!
		expect(courante.textContent).toContain('Studio web › Refonte de site')
		expect(courante.textContent).toContain('fiche ouverte')
		expect(within(courante).queryByRole('link')).toBeNull()
		expect(courante.textContent).not.toContain('Négociation')

		const autre = lignes.find((ligne) => ligne !== courante)!
		expect(within(autre).getByRole('link', { name: 'Conseil & IA › Grands comptes' }).getAttribute('href')).toBe(
			'/tracks/conseil-ia/grands-comptes/cards/c-1',
		)
		expect(autre.textContent).toContain('Prospection · Aucun responsable')
		expect(autre.textContent).toMatch(/4\s321,00/)
		expect(within(autre).getByTestId('rattachement-archive').textContent).toContain('Archivé')
		expect(within(autre).getByTestId('rattachement-sommeil')).toBeTruthy()
		// Archivé, il offre « Désarchiver » ; la fiche, « Archiver ».
		expect(within(autre).getByRole('button').textContent).toContain('Désarchiver')
		expect(within(courante).getByRole('button').textContent).toContain('Archiver')
	})

	it('archiver écrit `archived_at`, puis fait relire la fiche', async () => {
		const { faux, charges } = client({ data: [{ id: 'p-studio' }], error: null, status: 200 })
		const onChange = monter(faux)
		const courante = screen.getAllByTestId('ligne-rattachement').find((l) => l.getAttribute('aria-current') === 'page')!
		await waitFor(() => expect((within(courante).getByRole('button') as HTMLButtonElement).disabled).toBe(false))
		await userEvent.click(within(courante).getByRole('button'))
		await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1))
		expect(Object.keys(charges[0] as object)).toEqual(['archived_at'])
		expect(screen.queryByTestId('refus-archivage-rattachement')).toBeNull()
	})

	it('un refus de la base (zéro ligne) se dit dans la ligne, et rien n’est relu', async () => {
		const onChange = monter(client({ data: [], error: null, status: 200 }).faux)
		const autre = screen.getAllByTestId('ligne-rattachement').find((l) => l.getAttribute('aria-current') !== 'page')!
		await waitFor(() => expect((within(autre).getByRole('button') as HTMLButtonElement).disabled).toBe(false))
		await userEvent.click(within(autre).getByRole('button'))
		const refus = await within(autre).findByRole('alert')
		expect(refus.textContent).toContain('vos droits ne permettent pas')
		expect(onChange).not.toHaveBeenCalled()
	})

	it('un channel que la base refuse : sa commande est éteinte et cite le motif du bloc, l’autre reste offerte (§5.59)', async () => {
		monter(client({ data: [], error: null, status: 200 }, { 'ch-refonte': true, 'ch-grands-comptes': false }).faux)
		const motif = await screen.findByTestId('motif-lecture-seule')
		expect(motif.textContent).toContain('rattachements aux channels que vous ne pouvez pas modifier')
		const lignes = screen.getAllByTestId('ligne-rattachement')
		const autre = lignes.find((l) => l.getAttribute('aria-current') !== 'page')!
		const courante = lignes.find((l) => l.getAttribute('aria-current') === 'page')!
		const eteinte = within(autre).getByRole('button') as HTMLButtonElement
		expect(eteinte.disabled).toBe(true)
		expect(eteinte.getAttribute('aria-describedby')).toBe(motif.id)
		expect((within(courante).getByRole('button') as HTMLButtonElement).disabled).toBe(false)
	})

	it('aucun channel refusé : aucun motif', async () => {
		monter(client({ data: [], error: null, status: 200 }).faux)
		await waitFor(() => expect((screen.getAllByRole('button')[0] as HTMLButtonElement).disabled).toBe(false))
		expect(screen.queryByTestId('motif-lecture-seule')).toBeNull()
	})
})
