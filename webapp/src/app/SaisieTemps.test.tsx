// @verifies CRM-098 (docs/BACKLOG.md) — tranche T2 : l'onglet « Saisie » de l'écran « Temps »
// @verifies docs/SPEC-temps.md §6.3 (la case « En heures » qui ne se décoche pas), §7.1 (« Saisir pour » réservé aux
//           administrateurs), §7.2 (lignes, cellule qui s'enregistre seule, Entrée qui descend, une seule écriture à la
//           fois, annonce du dépassement) ; docs/DESIGN_SYSTEM.md §5.54
// @verifies INC-282 (docs/INCONSISTENCY_REPORT.md) — une cellule quittée puis reprise pendant son envoi ne renvoie pas
//           l'ancienne valeur (aucun `DELETE` de la ligne qu'elle vient de créer), et `Entrée` ne vole pas le focus parti
//           ailleurs pendant l'envoi ; reproduit d'après la trace de e2e/ui/saisie-temps.spec.ts:102

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it } from 'vitest'
import { SaisieTemps, formaterDuree, libelleSemaine, lireSemaine } from './SaisieTemps'
import { fr } from '../i18n/fr'
import type { ClientCrm } from '../lib/supabase'
import type { Saisie } from '../lib/temps'

afterEach(cleanup)

type Ecriture = { readonly action: string; readonly charge: unknown }

/**
 * Client factice qui répond SELON LA TABLE : l'écran lit l'arbre, les saisies, les affaires et les membres dans un
 * ordre que `Promise.all` ne fixe pas. Les écritures sur `saisies_temps` sont enregistrées et rendent la ligne écrite.
 */
function clientFactice(saisies: readonly Saisie[] = []): { client: ClientCrm; ecritures: Ecriture[] } {
	const ecritures: Ecriture[] = []
	let numero = 0
	const lectures: Record<string, unknown[]> = {
		tracks: [{ id: 't1', name: 'Studio web', position: 1, channels: [{ id: 'c1', name: 'Refonte de site', position: 1 }] }],
		saisies_temps: [...saisies],
		cards: [],
		workspace_members: [
			{ user_id: 'moi', profiles: { id: 'moi', full_name: 'Camille Aubert' } },
			{ user_id: 'p2', profiles: { id: 'p2', full_name: 'Driss Lemoine' } },
		],
	}
	const client = {
		from: (table: string) => {
			let action = 'select'
			let charge: unknown = null
			const chaine: Record<string, unknown> = {}
			for (const nom of ['eq', 'is', 'in', 'gte', 'lte', 'ilike', 'order', 'limit', 'select']) chaine[nom] = () => chaine
			for (const nom of ['insert', 'update', 'delete']) {
				chaine[nom] = (valeur?: unknown) => {
					action = nom
					charge = valeur
					return chaine
				}
			}
			chaine.then = (resoudre: (r: unknown) => unknown) => {
				if (action === 'select') return Promise.resolve({ data: lectures[table] ?? [], error: null, status: 200 }).then(resoudre)
				ecritures.push({ action, charge })
				const ligne = { id: `s${++numero}`, jour: '2026-06-01', minutes: 105, track_id: null, channel_id: null, card_id: null, ...(charge as object) }
				// Une écriture prend un peu de temps : c'est ce qui laisse la sortie du champ survenir pendant l'envoi.
				return new Promise((ok) => setTimeout(() => ok({ data: [ligne], error: null, status: 201 }), 20)).then(resoudre)
			}
			return chaine
		},
	}
	return { client: client as unknown as ClientCrm, ecritures }
}

function monter(client: ClientCrm, estAdmin = false) {
	return render(
		<MemoryRouter initialEntries={['/temps?semaine=2026-06-01']}>
			<SaisieTemps client={client} idWorkspace="w" idUtilisateur="moi" estAdmin={estAdmin} aujourdhui="2026-10-11" />
		</MemoryRouter>,
	)
}

describe('la semaine et les durées', () => {
	it('l’adresse porte le lundi ; absente ou invalide, c’est la semaine du jour', () => {
		expect(lireSemaine('2026-06-03', '2026-10-11')).toBe('2026-06-01')
		expect(lireSemaine(null, '2026-10-11')).toBe('2026-10-05')
		expect(lireSemaine('nimportequoi', '2026-10-11')).toBe('2026-10-05')
	})
	it('le libellé de la semaine nomme le mois une fois, ou deux à cheval sur deux mois', () => {
		expect(libelleSemaine('2026-06-01')).toBe('Semaine du 1 au 7 juin 2026')
		expect(libelleSemaine('2026-10-26')).toBe('Semaine du 26 octobre au 1 novembre 2026')
		expect(libelleSemaine('2026-12-28')).toBe('Semaine du 28 décembre 2026 au 3 janvier 2027')
	})
	it('les durées en mots courts', () => {
		expect(formaterDuree({ jours: 0, heures: 6, minutes: 30 })).toBe('6 h 30')
		expect(formaterDuree({ jours: 0, heures: 0, minutes: 45 })).toBe('45 min')
		expect(formaterDuree({ jours: 1, heures: 3, minutes: 5 })).toBe('1 j 3 h 05')
		expect(formaterDuree({ jours: 2, heures: 0, minutes: 0 })).toBe('2 j')
		expect(formaterDuree({ jours: 0, heures: 0, minutes: 0 })).toBe('0 h')
	})
})

describe('la matrice', () => {
	it('chaque track puis ses channels, une cellule par jour, et aucun sélecteur pour un membre', async () => {
		const { client } = clientFactice()
		monter(client)
		expect(await screen.findByRole('textbox', { name: 'Studio web, lundi 1 juin' })).toBeTruthy()
		expect(screen.getByRole('textbox', { name: 'Refonte de site, dimanche 7 juin' })).toBeTruthy()
		expect(screen.queryByTestId('temps-saisir-pour')).toBeNull()
	})

	it('Entrée enregistre UNE fois et descend d’une ligne — la sortie du champ pendant l’envoi n’écrit pas une seconde fois', async () => {
		const { client, ecritures } = clientFactice()
		monter(client)
		const champ = await screen.findByRole('textbox', { name: 'Studio web, lundi 1 juin' })
		await userEvent.click(champ)
		await userEvent.keyboard('2{Enter}')
		await waitFor(() => expect(screen.getByRole('textbox', { name: 'Refonte de site, lundi 1 juin' })).toBe(document.activeElement))
		await waitFor(() => expect(screen.getByTestId('temps-total-2026-06-01').textContent).toBe('2 / 4 quarts'))
		expect(ecritures).toEqual([
			{
				action: 'insert',
				charge: { workspace_id: 'w', profile_id: 'moi', jour: '2026-06-01', minutes: 210, track_id: 't1', channel_id: null, card_id: null },
			},
		])
	})

	it('quitter le champ PENDANT l’envoi n’envoie pas une seconde écriture', async () => {
		const { client, ecritures } = clientFactice()
		monter(client)
		const champ = await screen.findByRole('textbox', { name: 'Studio web, lundi 1 juin' })
		await userEvent.click(champ)
		await userEvent.keyboard('1{Enter}{Tab}')
		await waitFor(() => expect(screen.getByTestId('temps-total-2026-06-01').textContent).toBe('1 / 4 quarts'))
		await new Promise((ok) => setTimeout(ok, 60))
		expect(ecritures.map((e) => e.action)).toEqual(['insert'])
	})

	it('une valeur qui dépasserait la journée est annoncée et n’est pas envoyée', async () => {
		const { client, ecritures } = clientFactice([
			{ id: 'a', jour: '2026-06-01', minutes: 315, track_id: 't1', channel_id: null, card_id: null },
		])
		monter(client)
		const champ = await screen.findByRole('textbox', { name: 'Refonte de site, lundi 1 juin' })
		await userEvent.click(champ)
		await userEvent.keyboard('2{Enter}')
		expect(champ.getAttribute('aria-invalid')).toBe('true')
		expect(screen.getAllByText(fr['time.cell.refused.cap']).length).toBeGreaterThan(0)
		expect(ecritures).toEqual([])
	})

	it('la case « En heures » ne se décoche pas tant qu’une saisie du jour n’est pas un quart, et l’écran dit pourquoi', async () => {
		const { client } = clientFactice([
			{ id: 'a', jour: '2026-06-02', minutes: 90, track_id: 't1', channel_id: null, card_id: null },
		])
		monter(client)
		const caseHeures = await screen.findByRole('checkbox', { name: 'Saisir le mardi 2 juin en heures' })
		expect((caseHeures as HTMLInputElement).checked).toBe(true)
		await userEvent.click(caseHeures)
		expect((caseHeures as HTMLInputElement).checked).toBe(true)
		expect(screen.getByTestId('temps-motif-case').textContent).toBe(
			'Le mardi 2 juin reste en heures : des saisies de ce jour ne tombent pas sur un quart.',
		)
	})

	it('un administrateur choisit pour qui il saisit, et le bandeau le rappelle', async () => {
		const { client } = clientFactice()
		monter(client, true)
		const selecteur = await screen.findByTestId('temps-saisir-pour')
		await waitFor(() => expect(screen.getByRole('option', { name: 'Driss Lemoine' })).toBeTruthy())
		await userEvent.selectOptions(selecteur, 'p2')
		expect(screen.getByTestId('temps-bandeau-autrui').textContent).toBe('Vous saisissez le temps de Driss Lemoine.')
	})
})

describe('INC-282 — la cadence de Playwright : la saisie suivante commence pendant l’envoi de la précédente', () => {
	/** Quatre lignes, dont une que la saisie saute ; chaque écriture répond après 40 ms et est consignée. */
	function clientLent() {
		const ecritures: string[] = []
		let numero = 0
		const lectures: Record<string, unknown[]> = {
			tracks: [
				{ id: 't1', name: 'Conseil', position: 1, channels: [{ id: 'c1', name: 'Prospection', position: 1 }, { id: 'c2', name: 'Grands comptes', position: 2 }] },
				{ id: 't2', name: 'Studio', position: 2, channels: [] },
			],
			saisies_temps: [],
			cards: [],
		}
		const client = {
			from: (table: string) => {
				let action = 'select'
				let charge: Record<string, unknown> = {}
				const chaine: Record<string, unknown> = {}
				for (const nom of ['eq', 'is', 'in', 'gte', 'lte', 'ilike', 'order', 'limit', 'select']) chaine[nom] = () => chaine
				for (const nom of ['insert', 'update', 'delete']) {
					chaine[nom] = (valeur?: Record<string, unknown>) => {
						action = nom
						charge = valeur ?? {}
						return chaine
					}
				}
				chaine.then = (resoudre: (r: unknown) => unknown) => {
					if (action === 'select') return Promise.resolve({ data: lectures[table] ?? [], error: null, status: 200 }).then(resoudre)
					ecritures.push(action)
					const ligne = { id: `s${++numero}`, jour: '2026-06-02', minutes: 0, track_id: null, channel_id: null, card_id: null, ...charge }
					return new Promise((ok) => setTimeout(() => ok({ data: [ligne], error: null, status: 201 }), 40)).then(resoudre)
				}
				return chaine
			},
		}
		return { client: client as unknown as ClientCrm, ecritures }
	}

	it('une cellule quittée puis reprise pendant son envoi garde sa valeur : aucune ligne créée n’est retirée', async () => {
		const { client, ecritures } = clientLent()
		monter(client)
		fireEvent.click(await screen.findByRole('checkbox', { name: 'Saisir le mardi 2 juin en heures' }))
		const champ = (cible: string) => screen.getByRole('textbox', { name: `${cible}, mardi 2 juin` })
		act(() => champ('Prospection').focus())
		fireEvent.change(champ('Prospection'), { target: { value: '1,5' } })
		fireEvent.keyDown(champ('Prospection'), { key: 'Enter' })
		// La saisie suivante saute « Grands comptes » et remplit « Studio » sans attendre la réponse …
		act(() => champ('Studio').focus())
		fireEvent.change(champ('Studio'), { target: { value: '1,5' } })
		await act(() => new Promise((ok) => setTimeout(ok, 60)))
		// … puis reprend « Studio » pour y presser Entrée, pendant que son écriture vole.
		act(() => champ('Studio').focus())
		fireEvent.keyDown(champ('Studio'), { key: 'Enter' })
		await act(() => new Promise((ok) => setTimeout(ok, 120)))
		act(() => champ('Grands comptes').focus())
		await act(() => new Promise((ok) => setTimeout(ok, 60)))
		expect(ecritures).toEqual(['insert', 'insert'])
		expect(screen.getByTestId('temps-total-2026-06-02').textContent).toBe('3 h / 7 h')
	})

	it('quittée puis reprise pendant son propre envoi, la cellule ne revient pas à l’ancienne valeur', async () => {
		const { client, ecritures } = clientLent()
		monter(client)
		await screen.findByRole('textbox', { name: 'Prospection, mardi 2 juin' })
		const champ = (cible: string) => screen.getByRole('textbox', { name: `${cible}, mardi 2 juin` })
		act(() => champ('Prospection').focus())
		fireEvent.change(champ('Prospection'), { target: { value: '2' } })
		// La sortie du champ envoie ; on y revient aussitôt, et `Entrée` attend l'envoi en cours.
		act(() => champ('Studio').focus())
		act(() => champ('Prospection').focus())
		expect((champ('Prospection') as HTMLInputElement).value).toBe('2')
		fireEvent.keyDown(champ('Prospection'), { key: 'Enter' })
		await waitFor(() => expect(document.activeElement).toBe(champ('Grands comptes')))
		await act(() => new Promise((ok) => setTimeout(ok, 60)))
		expect(ecritures).toEqual(['insert'])
		expect(screen.getByTestId('temps-total-2026-06-02').textContent).toBe('2 / 4 quarts')
	})

	it('`Entrée` n’avance pas le focus qui est parti ailleurs pendant l’envoi', async () => {
		const { client } = clientLent()
		monter(client)
		await screen.findByRole('textbox', { name: 'Prospection, mardi 2 juin' })
		const champ = (cible: string) => screen.getByRole('textbox', { name: `${cible}, mardi 2 juin` })
		act(() => champ('Prospection').focus())
		fireEvent.change(champ('Prospection'), { target: { value: '1' } })
		fireEvent.keyDown(champ('Prospection'), { key: 'Enter' })
		act(() => champ('Studio').focus())
		await act(() => new Promise((ok) => setTimeout(ok, 80)))
		expect(document.activeElement).toBe(champ('Studio'))
		// Resté sur la cellule, `Entrée` descend bien d'une ligne.
		act(() => champ('Grands comptes').focus())
		fireEvent.change(champ('Grands comptes'), { target: { value: '1' } })
		fireEvent.keyDown(champ('Grands comptes'), { key: 'Enter' })
		await waitFor(() => expect(document.activeElement).toBe(champ('Studio')))
	})
})
