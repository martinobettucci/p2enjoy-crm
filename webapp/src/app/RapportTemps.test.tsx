// @verifies CRM-098 (docs/BACKLOG.md) — tranche T3 : le rapport mensuel, la série « Personnel » et les réglages du
//           coût du personnel, à l'écran
// @verifies docs/SPEC-temps.md §4 (« non valorisé », jamais zéro ; une devise par montant), §7.3 (rapport ; « Toute
//           l'équipe » réservé aux administrateurs), §7.4 (réglages ; refus pour un membre), §7.5 (portée écrite) ;
//           docs/DESIGN_SYSTEM.md §5.54
// @verifies CRM-111 (docs/BACKLOG.md) — tranche T4.2 : la pilule « partagée » et sa mention, dans le rapport et sous la
//           série du track ; docs/DESIGN_SYSTEM.md §5.54 (« La saisie partagée »), §5.60 ; docs/SPEC-temps.md §7.3, §7.5

import { cleanup, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FournisseurEspace } from './ContexteEspace'
import { CelluleCout, RapportTemps, montantsEnMots } from './RapportTemps'
import { ReglagesCoutPersonnel } from './ReglagesCoutPersonnel'
import { BlocTempsCard, SeriePersonnelTrack } from './SeriePersonnel'
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
		// INC-333 : le mois est le titre du rapport, choisi par la navigation, jamais par un champ.
		expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Mars 2027')
		expect(document.querySelector('input[type="month"]')).toBeNull()
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

describe('une saisie partagée entre plusieurs channels (CRM-111 T4.2)', () => {
	const PARTAGE = 'Saisie partagée : cette affaire est rattachée à plusieurs channels ; son temps paraît sous chacun et ne compte qu’une fois dans le total'
	const NOMS_PARTAGE = {
		tracks: [{ id: 't1', nom: 'Studio web' }, { id: 't2', nom: 'Conseil & IA' }],
		channels: [{ id: 'c1', nom: 'Refonte de site' }, { id: 'c2', nom: 'Grands comptes' }, { id: 'c3', nom: 'Maintenance' }],
		cards: [{ id: 'a1', nom: 'Refonte du portail' }, { id: 'a2', nom: 'Audit' }],
		profiles: [{ id: 'p1', nom: 'Driss Lemoine' }],
	}
	const saisie = (track: string, channel: string, card: string, shared: boolean) => ({
		profile_id: 'p1', track_id: track, channel_id: channel, card_id: card, minutes: 105, montant: 120, devise: 'EUR', shared,
	})

	it('la ligne de l’affaire porte « partagée » sous chaque channel, le total la compte une fois, et la mention le dit', async () => {
		render(
			<MemoryRouter initialEntries={['/temps?onglet=rapport&mois=2027-03']}>
				<RapportTemps
					client={clientFactice([saisie('t1', 'c1', 'a1', true), saisie('t2', 'c2', 'a1', true), saisie('t1', 'c1', 'a2', false)], NOMS_PARTAGE)}
					idWorkspace="w"
					idUtilisateur="p1"
					estAdmin={false}
					aujourdhui="2026-10-11"
				/>
			</MemoryRouter>,
		)
		const rangees = await screen.findAllByTestId('temps-rapport-ligne')
		const partagees = rangees.filter((r) => within(r).queryByTestId('temps-partagee') !== null)
		expect(partagees).toHaveLength(2)
		expect(screen.getAllByRole('img', { name: PARTAGE })).toHaveLength(2)
		// Deux lignes de même nom : le chemin de chacune dit de quel channel elle relève.
		expect(screen.getAllByTestId('temps-partagee-chemin').map((c) => c.textContent)).toEqual([
			'Conseil & IA › Grands comptes',
			'Studio web › Refonte de site',
		])
		const audit = rangees.find((r) => within(r).getByRole('rowheader').textContent === 'Audit')
		expect(audit && within(audit).queryByTestId('temps-partagee'), 'une affaire non partagée ne porte rien').toBeNull()
		// Deux saisies de 1 h 45 : la partagée une fois, l'autre une fois.
		expect(screen.getByTestId('temps-rapport-total').textContent).toBe('3 h 30')
		expect(screen.getByTestId('temps-partagee-mention').textContent).toBe(
			'Une saisie sur une affaire rattachée à plusieurs channels paraît sous chacun ; le total ne la compte qu’une fois.',
		)
	})

	it('sans saisie partagée, ni pilule ni mention', async () => {
		render(
			<MemoryRouter initialEntries={['/temps?onglet=rapport&mois=2027-03']}>
				<RapportTemps client={clientFactice([saisie('t1', 'c1', 'a2', false)], NOMS_PARTAGE)} idWorkspace="w" idUtilisateur="p1" estAdmin={false} aujourdhui="2026-10-11" />
			</MemoryRouter>,
		)
		await screen.findAllByTestId('temps-rapport-ligne')
		expect(screen.queryByTestId('temps-partagee')).toBeNull()
		expect(screen.queryByTestId('temps-partagee-mention')).toBeNull()
	})

	it('la série du track : la mention quand la saisie paraît sous deux de SES channels, rien quand l’autre est ailleurs', async () => {
		const deuxChannels = [saisie('t1', 'c1', 'a1', true), saisie('t1', 'c3', 'a1', true)]
		render(
			<MemoryRouter initialEntries={['/tracks/studio-web/couts?mois=2027-03']}>
				<FournisseurEspace valeur={{ idWorkspace: 'w', estAdmin: true }}>
					<SeriePersonnelTrack client={clientFactice(deuxChannels, NOMS_PARTAGE)} idTrack="t1" aujourdhui="2026-10-11" />
				</FournisseurEspace>
			</MemoryRouter>,
		)
		expect((await screen.findByTestId('personnel-total')).textContent).toBe('1 h 45')
		expect(screen.getByTestId('temps-partagee-mention')).toBeTruthy()
		cleanup()
		render(
			<MemoryRouter initialEntries={['/tracks/studio-web/couts?mois=2027-03']}>
				<FournisseurEspace valeur={{ idWorkspace: 'w', estAdmin: true }}>
					<SeriePersonnelTrack client={clientFactice([saisie('t1', 'c1', 'a1', true)], NOMS_PARTAGE)} idTrack="t1" aujourdhui="2026-10-11" />
				</FournisseurEspace>
			</MemoryRouter>,
		)
		expect((await screen.findByTestId('personnel-total')).textContent).toBe('1 h 45')
		expect(screen.queryByTestId('temps-partagee-mention'), 'le total du track ne diverge pas : rien n’est dit').toBeNull()
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
	it('sont refusés quand la base refuse l’administration de l’espace, qui renvoie au rapport', () => {
		render(
			<FournisseurEspace valeur={{ idWorkspace: 'w', estAdmin: false, capacites: { administration: 'refusee', edition: 'permise' } }}>
				<ReglagesCoutPersonnel client={clientFactice([])} aujourdhui="2026-10-11" />
			</FournisseurEspace>,
		)
		expect(screen.getByRole('heading', { name: 'Réservé aux administrateurs' })).toBeTruthy()
		expect(screen.queryByTestId('cout-personnel')).toBeNull()
	})
	it('lisent la capacité, pas le rôle : un rôle lu « admin » ne rouvre pas un refus de la base (CRM-093)', () => {
		render(
			<FournisseurEspace valeur={{ idWorkspace: 'w', estAdmin: true, capacites: { administration: 'refusee', edition: 'permise' } }}>
				<ReglagesCoutPersonnel client={clientFactice([])} aujourdhui="2026-10-11" />
			</FournisseurEspace>,
		)
		expect(screen.getByRole('heading', { name: 'Réservé aux administrateurs' })).toBeTruthy()
	})
	it('ne disent aucun refus pendant la lecture de la capacité, ni sur une capacité inconnue (CRM-093 §4)', async () => {
		const client = clientFactice([], {
			workspace_members: [{ user_id: 'p1', profiles: { id: 'p1', full_name: 'Driss Lemoine' } }],
			saisies_temps: [],
			couts_personnel: [],
		})
		const requetes = vi.spyOn(client, 'from')
		render(
			<FournisseurEspace valeur={{ idWorkspace: 'w', estAdmin: false, capacites: { administration: 'en-lecture', edition: 'en-lecture' } }}>
				<ReglagesCoutPersonnel client={client} aujourdhui="2026-10-11" />
			</FournisseurEspace>,
		)
		expect(screen.queryByRole('heading', { name: 'Réservé aux administrateurs' })).toBeNull()
		expect(screen.queryByTestId('cout-personne')).toBeNull()
		expect(requetes, 'rien n’est lu tant que la capacité ne l’est pas').not.toHaveBeenCalled()
		cleanup()
		render(
			<FournisseurEspace valeur={{ idWorkspace: 'w', estAdmin: false }}>
				<ReglagesCoutPersonnel client={client} aujourdhui="2026-10-11" />
			</FournisseurEspace>,
		)
		expect((await screen.findByTestId('cout-personne')).textContent).toContain('Driss Lemoine')
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
