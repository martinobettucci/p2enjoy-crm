// @verifies CRM-111 (docs/BACKLOG.md) T7.2 — le bloc « Rattachements » : une ligne par rattachement, celle de la fiche
//           marquée et sans détail, les autres en liens avec étape, responsable, montant et pilules ; archiver relit la
//           fiche, un refus se dit dans la ligne ; la commande d'un channel que la base refuse est éteinte avec le motif
//           du bloc (docs/SPEC-rattachements.md §8.1 ; docs/DESIGN_SYSTEM.md §5.82, §5.59)
// @verifies CRM-111 (docs/BACKLOG.md) T7.3 — « Rattacher à un channel » : les channels offerts (modifiables, ouverts, non
//           rattachés), l'option vide, l'appel d'`attach_card`, la fiche du nouveau rattachement ouverte, les refus
//           traduits, la liste vide, `Échap` (docs/SPEC-rattachements.md §5 ; docs/DESIGN_SYSTEM.md §5.83)
// @verifies CRM-111 (docs/BACKLOG.md) T7.4 — « Retirer » : éteint avec son motif pour qui n'administre pas l'espace et sur
//           le dernier rattachement, la confirmation qui nomme la perte, `Échap`, le retrait d'un autre rattachement qui
//           relit la fiche, celui de la fiche qui ouvre le rattachement restant, le refus dans la confirmation
//           (docs/SPEC-rattachements.md §4, §5 ; docs/DESIGN_SYSTEM.md §5.84)

import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RattachementDuBloc } from '../lib/formulaire'
import type { ClientCrm } from '../lib/supabase'
import { BlocRattachementsCard } from './BlocRattachementsCard'
import { FournisseurEspace } from './ContexteEspace'
import type { Capacite } from '../lib/capacites'

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
/** Les channels de l'espace, tels que la liste de « Rattacher » les lit (§5.83). */
const CHANNELS = [
	{ id: 'ch-refonte', slug: 'refonte', name: 'Refonte de site', ecriture_permise: true, tracks: { slug: 'studio-web', name: 'Studio web', archived_at: null, deleted_at: null } },
	{ id: 'ch-grands-comptes', slug: 'grands-comptes', name: 'Grands comptes', ecriture_permise: true, tracks: { slug: 'conseil-ia', name: 'Conseil & IA', archived_at: null, deleted_at: null } },
	{ id: 'ch-maint', slug: 'maintenance', name: 'Maintenance', ecriture_permise: true, tracks: { slug: 'studio-web', name: 'Studio web', archived_at: null, deleted_at: null } },
	{ id: 'ch-audit', slug: 'audit', name: 'Audit', ecriture_permise: true, tracks: { slug: 'conseil-ia', name: 'Conseil & IA', archived_at: null, deleted_at: null } },
	{ id: 'ch-ferme', slug: 'ferme', name: 'Fermé', ecriture_permise: false, tracks: { slug: 'conseil-ia', name: 'Conseil & IA', archived_at: null, deleted_at: null } },
	{ id: 'ch-vieux', slug: 'vieux', name: 'Vieux', ecriture_permise: true, tracks: { slug: 'ancien', name: 'Ancien', archived_at: '2026-01-01', deleted_at: null } },
]

function client(
	reponse: { data: unknown[] | null; error: unknown; status: number },
	ecritures: Record<string, boolean> = { 'ch-refonte': true, 'ch-grands-comptes': true },
	options: { channels?: unknown[]; rattacher?: { error: { code?: string; message: string } | null; status: number } } = {},
) {
	const charges: unknown[] = []
	const rpcs: { nom: string; args: unknown }[] = []
	const faux = {
		rpc: (nom: string, args: unknown) => {
			rpcs.push({ nom, args })
			return Promise.resolve({ data: null, ...(options.rattacher ?? { error: null, status: 200 }) })
		},
		from: (table: string) =>
			table === 'channels'
				? {
						select: () => {
							const liste = { data: options.channels ?? CHANNELS, error: null, status: 200 }
							const chaine: Record<string, unknown> = {
								in: () =>
									Promise.resolve({
										data: Object.entries(ecritures).map(([id, ecriture_permise]) => ({ id, ecriture_permise })),
										error: null,
										status: 200,
									}),
								eq: () => chaine,
								is: () => chaine,
								then: (resoudre: (r: unknown) => unknown) => resoudre(liste),
							}
							return chaine
						},
					}
				: {
						update: (charge: unknown) => {
							charges.push(charge)
							const chaine = { eq: () => chaine, select: () => Promise.resolve(reponse) }
							return chaine
						},
					},
	} as unknown as ClientCrm
	return { faux, charges, rpcs }
}

function Adresse() {
	return <p data-testid="adresse">{useLocation().pathname}</p>
}

function monter(
	c: ClientCrm,
	onChange = vi.fn(),
	options: { administration?: Capacite; rattachements?: readonly RattachementDuBloc[] } = {},
) {
	render(
		<FournisseurEspace
			valeur={{ idWorkspace: 'ws-1', estAdmin: true, capacites: { administration: options.administration ?? 'permise', edition: 'permise' } }}
		>
			<MemoryRouter initialEntries={['/tracks/studio-web/refonte/cards/c-1']}>
				<Adresse />
				<BlocRattachementsCard
					idCard="c-1"
					idWorkspace="ws-1"
					devise="EUR"
					rattachements={options.rattachements ?? [AUTRE, COURANT]}
					onChange={onChange}
					client={c}
					maintenant={() => new Date('2026-11-03T10:00:00Z')}
				/>
			</MemoryRouter>
		</FournisseurEspace>,
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
		expect(within(autre).getByTestId('basculer-archivage-rattachement').textContent).toContain('Désarchiver')
		expect(within(courante).getByTestId('basculer-archivage-rattachement').textContent).toContain('Archiver')
	})

	it('archiver écrit `archived_at`, puis fait relire la fiche', async () => {
		const { faux, charges } = client({ data: [{ id: 'p-studio' }], error: null, status: 200 })
		const onChange = monter(faux)
		const courante = screen.getAllByTestId('ligne-rattachement').find((l) => l.getAttribute('aria-current') === 'page')!
		await waitFor(() => expect((within(courante).getByTestId('basculer-archivage-rattachement') as HTMLButtonElement).disabled).toBe(false))
		await userEvent.click(within(courante).getByTestId('basculer-archivage-rattachement'))
		await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1))
		expect(Object.keys(charges[0] as object)).toEqual(['archived_at'])
		expect(screen.queryByTestId('refus-archivage-rattachement')).toBeNull()
	})

	it('un refus de la base (zéro ligne) se dit dans la ligne, et rien n’est relu', async () => {
		const onChange = monter(client({ data: [], error: null, status: 200 }).faux)
		const autre = screen.getAllByTestId('ligne-rattachement').find((l) => l.getAttribute('aria-current') !== 'page')!
		await waitFor(() => expect((within(autre).getByTestId('basculer-archivage-rattachement') as HTMLButtonElement).disabled).toBe(false))
		await userEvent.click(within(autre).getByTestId('basculer-archivage-rattachement'))
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
		const eteinte = within(autre).getByTestId('basculer-archivage-rattachement') as HTMLButtonElement
		expect(eteinte.disabled).toBe(true)
		expect(eteinte.getAttribute('aria-describedby')).toBe(motif.id)
		expect((within(courante).getByTestId('basculer-archivage-rattachement') as HTMLButtonElement).disabled).toBe(false)
	})

	it('aucun channel refusé : aucun motif', async () => {
		monter(client({ data: [], error: null, status: 200 }).faux)
		await waitFor(() => expect((screen.getAllByTestId('basculer-archivage-rattachement')[0] as HTMLButtonElement).disabled).toBe(false))
		expect(screen.queryByTestId('motif-lecture-seule')).toBeNull()
	})

	it('« Rattacher » offre les channels modifiables, ouverts et non rattachés, puis ouvre la fiche du nouveau rattachement', async () => {
		const { faux, rpcs } = client({ data: [], error: null, status: 200 })
		monter(faux)
		await userEvent.click(await screen.findByTestId('ouvrir-rattacher'))
		const champ = (await screen.findByTestId('champ-channel-rattacher')) as HTMLSelectElement
		await waitFor(() => expect(document.activeElement).toBe(champ))
		expect([...champ.options].map((o) => o.textContent)).toEqual([
			'Choisissez un channel',
			'Conseil & IA › Audit',
			'Studio web › Maintenance',
		])
		expect(champ.value).toBe('')
		await userEvent.selectOptions(champ, 'ch-maint')
		await userEvent.click(screen.getByTestId('envoyer-rattacher'))
		await waitFor(() => expect(screen.getByTestId('adresse').textContent).toBe('/tracks/studio-web/maintenance/cards/c-1'))
		expect(rpcs).toEqual([{ nom: 'attach_card', args: { p_card: 'c-1', p_channel: 'ch-maint' } }])
	})

	it('sans choix, la base refuse et l’écran le traduit, le formulaire reste ouvert', async () => {
		const { faux, rpcs } = client({ data: [], error: null, status: 200 }, undefined, {
			rattacher: { error: { code: 'P0001', message: 'channel_not_found' }, status: 400 },
		})
		monter(faux)
		await userEvent.click(await screen.findByTestId('ouvrir-rattacher'))
		await screen.findByTestId('champ-channel-rattacher')
		await userEvent.click(screen.getByTestId('envoyer-rattacher'))
		const refus = await screen.findByTestId('refus-rattacher')
		expect(refus.getAttribute('data-refus')).toBe('channel-introuvable')
		expect(rpcs[0]?.args).toEqual({ p_card: 'c-1', p_channel: null })
		expect(screen.getByTestId('adresse').textContent).toBe('/tracks/studio-web/refonte/cards/c-1')
	})

	it('un workflow sans étape initiale : le refus porte le lien vers l’éditeur de workflows', async () => {
		monter(client({ data: [], error: null, status: 200 }, undefined, {
			rattacher: { error: { code: '22023', message: 'step_not_initial' }, status: 400 },
		}).faux)
		await userEvent.click(await screen.findByTestId('ouvrir-rattacher'))
		await userEvent.selectOptions(await screen.findByTestId('champ-channel-rattacher'), 'ch-audit')
		await userEvent.click(screen.getByTestId('envoyer-rattacher'))
		const refus = await screen.findByTestId('refus-rattacher')
		expect(within(refus).getByRole('link').textContent).toContain('éditeur de workflows')
	})

	it('aucun channel à offrir : une phrase, et seulement « Annuler » ; `Échap` rend le focus à la commande', async () => {
		monter(client({ data: [], error: null, status: 200 }, undefined, { channels: [] }).faux)
		await userEvent.click(await screen.findByTestId('ouvrir-rattacher'))
		expect((await screen.findByTestId('aucun-channel-rattachable')).textContent).toBe('Aucun autre channel que vous pouvez modifier.')
		expect(screen.queryByTestId('envoyer-rattacher')).toBeNull()
		await userEvent.keyboard('{Escape}')
		await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId('ouvrir-rattacher')))
	})

	it('« Retirer » est éteint avec son motif pour qui n’administre pas l’espace', () => {
		monter(client({ data: [], error: null, status: 200 }).faux, vi.fn(), { administration: 'refusee' })
		const motif = screen.getByTestId('motif-retrait-administration')
		for (const commande of screen.getAllByTestId('ouvrir-retrait-rattachement') as HTMLButtonElement[]) {
			expect(commande.disabled).toBe(true)
			expect(commande.getAttribute('aria-describedby')).toBe(motif.id)
		}
		expect(screen.queryByTestId('motif-retrait-dernier')).toBeNull()
	})

	it('« Retirer » est éteint sur le dernier rattachement, avec son propre motif', () => {
		monter(client({ data: [], error: null, status: 200 }).faux, vi.fn(), { rattachements: [COURANT] })
		const commande = screen.getByTestId('ouvrir-retrait-rattachement') as HTMLButtonElement
		expect(commande.disabled).toBe(true)
		expect(commande.getAttribute('aria-describedby')).toBe(screen.getByTestId('motif-retrait-dernier').id)
	})

	it('la confirmation nomme le rattachement et la perte ; `Échap` la referme et rend le focus à « Retirer »', async () => {
		const { faux, rpcs } = client({ data: [], error: null, status: 200 })
		monter(faux)
		const autre = screen.getAllByTestId('ligne-rattachement').find((l) => l.getAttribute('aria-current') !== 'page')!
		await userEvent.click(within(autre).getByTestId('ouvrir-retrait-rattachement'))
		const confirmation = within(autre).getByTestId('confirmation-retrait-rattachement')
		expect(confirmation.textContent).toContain('Retirer le rattachement à Conseil & IA › Grands comptes ?')
		expect(confirmation.textContent).toContain('les réponses de son formulaire sont perdus')
		expect(document.activeElement).toBe(within(confirmation).getByTestId('confirmer-retrait-rattachement'))
		await userEvent.keyboard('{Escape}')
		await waitFor(() => expect(document.activeElement).toBe(within(autre).getByTestId('ouvrir-retrait-rattachement')))
		expect(rpcs).toEqual([])
	})

	it('retirer un AUTRE rattachement relit la fiche ; retirer celui de la fiche ouvre le rattachement restant', async () => {
		const { faux, rpcs } = client({ data: [], error: null, status: 200 })
		const onChange = monter(faux)
		const lignes = () => screen.getAllByTestId('ligne-rattachement')
		const autre = lignes().find((l) => l.getAttribute('aria-current') !== 'page')!
		await userEvent.click(within(autre).getByTestId('ouvrir-retrait-rattachement'))
		await userEvent.click(within(autre).getByTestId('confirmer-retrait-rattachement'))
		await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1))
		expect(rpcs.at(-1)).toEqual({ nom: 'detach_card', args: { p_placement: 'p-conseil', discard_field_values: true } })

		const courante = lignes().find((l) => l.getAttribute('aria-current') === 'page')!
		await userEvent.click(within(courante).getByTestId('ouvrir-retrait-rattachement'))
		await userEvent.click(within(courante).getByTestId('confirmer-retrait-rattachement'))
		await waitFor(() => expect(screen.getByTestId('adresse').textContent).toBe('/tracks/conseil-ia/grands-comptes/cards/c-1'))
		expect(onChange).toHaveBeenCalledTimes(1)
	})

	it('un refus de la base se dit dans la confirmation, qui reste ouverte', async () => {
		const { faux } = client({ data: [], error: null, status: 200 }, undefined, {
			rattacher: { error: { code: '42501', message: 'forbidden' }, status: 403 },
		})
		const onChange = monter(faux)
		const autre = screen.getAllByTestId('ligne-rattachement').find((l) => l.getAttribute('aria-current') !== 'page')!
		await userEvent.click(within(autre).getByTestId('ouvrir-retrait-rattachement'))
		await userEvent.click(within(autre).getByTestId('confirmer-retrait-rattachement'))
		expect((await within(autre).findByTestId('refus-retrait-rattachement')).getAttribute('data-refus')).toBe('interdit')
		expect(onChange).not.toHaveBeenCalled()
	})
})
