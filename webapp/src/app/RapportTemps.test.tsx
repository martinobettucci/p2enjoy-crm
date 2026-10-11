// @verifies CRM-098 (docs/BACKLOG.md) — tranche T3 : le rapport mensuel, la série « Personnel » et les réglages du
//           coût du personnel, à l'écran
// @verifies docs/SPEC-temps.md §4 (« non valorisé », jamais zéro ; une devise par montant), §7.3 (rapport ; « Toute
//           l'équipe » réservé aux administrateurs), §7.4 (réglages ; refus pour un membre), §7.5 (portée écrite) ;
//           docs/DESIGN_SYSTEM.md §5.54

import { cleanup, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it } from 'vitest'
import { FournisseurEspace } from './ContexteEspace'
import { CelluleCout, RapportTemps, lireMois, montantsEnMots } from './RapportTemps'
import { ReglagesCoutPersonnel } from './ReglagesCoutPersonnel'
import { BlocTempsCard } from './SeriePersonnel'
import type { ClientCrm } from '../lib/supabase'

afterEach(cleanup)

/** Client factice : `rpc` rend les lignes valorisées données ; `from` rend les noms ou les listes par table. */
function clientFactice(lignes: unknown[], tables: Record<string, unknown[]> = {}): ClientCrm {
	const chaine = (donnees: unknown[]) => {
		const c: Record<string, unknown> = {}
		for (const nom of ['eq', 'in', 'select', 'order', 'is']) c[nom] = () => c
		c.then = (ok: (r: unknown) => unknown) => Promise.resolve({ data: donnees, error: null, status: 200 }).then(ok)
		return c
	}
	return {
		rpc: () => Promise.resolve({ data: lignes, error: null, status: 200 }),
		from: (table: string) => chaine(tables[table] ?? []),
	} as unknown as ClientCrm
}

const NOMS = {
	tracks: [{ id: 't1', nom: 'Studio web' }],
	channels: [{ id: 'c1', nom: 'Refonte de site' }],
	cards: [],
	profiles: [{ id: 'p1', nom: 'Driss Lemoine' }],
}

describe('les montants', () => {
	it('une devise par montant, jamais additionnées entre elles', () => {
		expect(montantsEnMots({ minutes: 1, montants: { EUR: 1234.5, CHF: 10 }, minutesNonValorisees: 0 })).toEqual([
			'10,00 CHF',
			'1 234,50 EUR',
		])
	})
	it('une part sans version est dite « non valorisé », ou « dont … » à côté d’un montant — jamais « 0 »', () => {
		render(<CelluleCout cumul={{ minutes: 105, montants: {}, minutesNonValorisees: 105 }} />)
		expect(screen.getByTestId('temps-non-valorise').textContent).toBe('non valorisé')
		cleanup()
		render(<CelluleCout cumul={{ minutes: 165, montants: { EUR: 120 }, minutesNonValorisees: 60 }} />)
		expect(screen.getByTestId('temps-non-valorise').textContent).toBe('dont 1 h non valorisé')
	})
	it('le mois de l’adresse, ou celui du jour', () => {
		expect(lireMois('2027-03', '2026-10-11')).toBe('2027-03')
		expect(lireMois('2027-13', '2026-10-11')).toBe('2026-10')
		expect(lireMois(null, '2026-10-11')).toBe('2026-10')
	})
})

describe('le rapport mensuel', () => {
	const lignes = [
		{ profile_id: 'p1', track_id: 't1', channel_id: null, card_id: null, minutes: 60, montant: 68.57, devise: 'EUR' },
		{ profile_id: 'p1', track_id: 't1', channel_id: 'c1', card_id: null, minutes: 105, montant: 120, devise: 'EUR' },
	]
	it('un membre : ses cibles, nommées, et le total ; aucun choix de personne', async () => {
		render(
			<MemoryRouter initialEntries={['/temps?onglet=rapport&mois=2027-03']}>
				<RapportTemps client={clientFactice(lignes, NOMS)} idWorkspace="w" idUtilisateur="p1" estAdmin={false} aujourdhui="2026-10-11" />
			</MemoryRouter>,
		)
		const rangees = await screen.findAllByTestId('temps-rapport-ligne')
		expect(rangees.map((r) => within(r).getByRole('rowheader').textContent)).toEqual(['Studio web', 'Refonte de site'])
		expect(screen.getByTestId('temps-rapport-total').textContent).toBe('2 h 45')
		expect(screen.queryByTestId('temps-rapport-personne')).toBeNull()
	})
	it('un mois sans temps le dit, en nommant le mois', async () => {
		render(
			<MemoryRouter initialEntries={['/temps?onglet=rapport&mois=2027-03']}>
				<RapportTemps client={clientFactice([])} idWorkspace="w" idUtilisateur="p1" estAdmin={false} aujourdhui="2026-10-11" />
			</MemoryRouter>,
		)
		expect(await screen.findByText('Aucun temps saisi en mars 2027')).toBeTruthy()
	})
})

describe('la série « Personnel » de l’affaire', () => {
	it('écrit sa portée : « Votre temps » pour un membre, « Le temps de toute l’équipe » pour un administrateur', async () => {
		const ligne = [{ profile_id: 'p1', track_id: 't1', channel_id: 'c1', card_id: 'a1', minutes: 210, montant: 240, devise: 'EUR' }]
		render(
			<FournisseurEspace valeur={{ idWorkspace: 'w', estAdmin: false }}>
				<BlocTempsCard client={clientFactice(ligne)} idCard="a1" />
			</FournisseurEspace>,
		)
		expect((await screen.findByTestId('temps-card-duree')).textContent).toBe('3 h 30')
		expect(screen.getByTestId('personnel-portee').textContent).toBe('Votre temps')
		cleanup()
		render(
			<FournisseurEspace valeur={{ idWorkspace: 'w', estAdmin: true }}>
				<BlocTempsCard client={clientFactice(ligne)} idCard="a1" />
			</FournisseurEspace>,
		)
		expect((await screen.findByTestId('personnel-portee')).textContent).toBe('Le temps de toute l’équipe')
	})
})

describe('les réglages du coût du personnel', () => {
	it('sont refusés à un membre, qui est renvoyé à son rapport', () => {
		render(
			<FournisseurEspace valeur={{ idWorkspace: 'w', estAdmin: false }}>
				<ReglagesCoutPersonnel client={clientFactice([])} aujourdhui="2026-10-11" />
			</FournisseurEspace>,
		)
		expect(screen.getByRole('heading', { name: 'Réservé aux administrateurs' })).toBeTruthy()
		expect(screen.queryByTestId('cout-personnel')).toBeNull()
	})
	it('montrent à un administrateur le coût en vigueur et la prochaine version de chacun', async () => {
		render(
			<FournisseurEspace valeur={{ idWorkspace: 'w', estAdmin: true }}>
				<ReglagesCoutPersonnel
					client={clientFactice([], {
						workspace_members: [{ user_id: 'p1', profiles: { id: 'p1', full_name: 'Driss Lemoine' } }],
						saisies_temps: [],
						couts_personnel: [
							{ id: 'v2', profile_id: 'p1', date_effet: '2027-01-01', cout_quart: 135, devise: 'EUR' },
							{ id: 'v1', profile_id: 'p1', date_effet: '2026-01-01', cout_quart: 120, devise: 'EUR' },
						],
					})}
					aujourdhui="2026-10-11"
				/>
			</FournisseurEspace>,
		)
		expect((await screen.findByTestId('cout-en-vigueur')).textContent).toBe('120,00 EUR par quart')
		expect(screen.getByTestId('cout-prochain').textContent).toBe('135,00 EUR par quart à partir du 1 janvier 2027')
	})
})
