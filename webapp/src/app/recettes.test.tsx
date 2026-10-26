// @verifies CRM-108 (docs/BACKLOG.md) — tranche T3 : le bloc « Recettes », le bloc « Rentabilité », l'onglet « À saisir »
//           et l'écran « Rentabilité »
// @verifies docs/SPEC-recettes.md §2.3 (« nul n'est pas zéro » : un tiret, jamais 0,00), §6.1 (lignes, pied, mention des
//           réels manquants, création, sans-effet dit), §6.2 (bloc ABSENT sur `42501`, « non calculable »), §6.3 (refus
//           « Réservé aux administrateurs » et lien vers « À saisir » ; tableaux par devise ; vue « Prévu »), §6.4
//           (Entrée enregistre et passe à la ligne suivante ; ligne non saisissable désactivée avec motif ; vide sain) ;
//           docs/DESIGN_SYSTEM.md §5.60 (devise dans les en-têtes ; marge négative en pastille ; pilule « partielle »)
// @verifies CRM-111 T2.4.1 (docs/BACKLOG.md) — les noms de la rentabilité se lisent sur les rattachements (docs/SPEC-rattachements.md §5)

import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it } from 'vitest'
import { fr } from '../i18n/fr'
import type { ClientCrm } from '../lib/supabase'
import { BlocRecettesCard } from './BlocRecettesCard'
import { BlocRentabiliteCard } from './BlocRentabiliteCard'
import { RecettesASaisir } from './RecettesASaisir'
import { Rentabilite } from './Rentabilite'
import type { RecetteASaisir } from '../lib/card-revenues'

afterEach(cleanup)

type Reponse = { data: unknown; error: { message: string; code?: string } | null; status: number }
type Ecriture = { table: string; action: string; charge: unknown }

/** Client factice : une réponse de lecture par table, une réponse par RPC, et des écritures enregistrées. */
function clientFactice(opts: {
	lectures?: Record<string, unknown[]>
	rpc?: Reponse
	ecriture?: Reponse
}) {
	const ecritures: Ecriture[] = []
	const rpcs: string[] = []
	const client = {
		rpc: (nom: string) => {
			rpcs.push(nom)
			return Promise.resolve(opts.rpc ?? { data: [], error: null, status: 200 })
		},
		from: (table: string) => {
			let action = 'select'
			let charge: unknown = null
			const chaine: Record<string, unknown> = {}
			for (const nom of ['eq', 'is', 'in', 'order', 'select']) chaine[nom] = () => chaine
			for (const nom of ['insert', 'update', 'delete']) {
				chaine[nom] = (c?: unknown) => {
					action = nom
					charge = c
					return chaine
				}
			}
			chaine.then = (ok: (r: unknown) => unknown) => {
				if (action === 'select') {
					return Promise.resolve({ data: opts.lectures?.[table] ?? [], error: null, status: 200 }).then(ok)
				}
				ecritures.push({ table, action, charge })
				return Promise.resolve(opts.ecriture ?? { data: [{ id: 'x', actual_amount: 500 }], error: null, status: 201 }).then(ok)
			}
			return chaine
		},
	}
	return { client: client as unknown as ClientCrm, ecritures, rpcs }
}

const LIGNES = [
	{ id: 'r1', card_id: 'c1', label: 'Acompte', estimated_amount: 6000, actual_amount: 6000, settled_at: '2026-10-01T00:00:00Z', position: 1 },
	{ id: 'r2', card_id: 'c1', label: 'Solde', estimated_amount: 14000, actual_amount: null, settled_at: null, position: 2 },
]

describe('le bloc « Recettes »', () => {
	it('liste les lignes, nomme la devise dans les en-têtes, et rend une recette inconnue par un tiret, jamais 0,00', async () => {
		const { client } = clientFactice({ lectures: { card_revenues: LIGNES } })
		render(<BlocRecettesCard client={client} idCard="c1" titreCard="Refonte" devise="CHF" />)
		const lignes = await screen.findAllByTestId('ligne-recette')
		expect(lignes).toHaveLength(2)
		expect(screen.getByRole('columnheader', { name: 'Prévu (CHF)' })).toBeTruthy()
		const reelInconnu = within(lignes[1]!).getByTestId('recette-cellule-reel')
		expect(reelInconnu.textContent).not.toContain('0.00')
		expect(within(reelInconnu).getByText(fr['card.revenues.actual.unknown'])).toBeTruthy()
		expect(within(lignes[0]!).getByTestId('recette-pilule-soldee')).toBeTruthy()
		expect(screen.getByTestId('recettes-sans-reel').textContent).toContain('1 ligne sans recette réelle')
	})

	it('crée une ligne avec sa nature et son prévu, sans réel, et prévient la fiche', async () => {
		const { client, ecritures } = clientFactice({ lectures: { card_revenues: [] } })
		let prevenue = 0
		render(<BlocRecettesCard client={client} idCard="c1" titreCard="Refonte" devise="EUR" onChange={() => (prevenue += 1)} />)
		await screen.findByText(fr['card.revenues.empty'])
		await userEvent.click(screen.getByRole('button', { name: fr['card.revenues.action.new'] }))
		await userEvent.type(screen.getByLabelText(fr['card.revenues.form.label']), 'Acompte')
		await userEvent.type(screen.getByLabelText('Recette prévue (EUR)'), '6000')
		await userEvent.click(screen.getByRole('button', { name: fr['card.revenues.action.add'] }))
		await waitFor(() => expect(prevenue).toBe(1))
		expect(ecritures[0]).toEqual({
			table: 'card_revenues',
			action: 'insert',
			charge: { card_id: 'c1', label: 'Acompte', estimated_amount: 6000, position: null },
		})
	})

	it('dit l’issue « sans effet » — zéro ligne touchée — et garde le formulaire ouvert', async () => {
		const { client } = clientFactice({ lectures: { card_revenues: LIGNES }, ecriture: { data: [], error: null, status: 200 } })
		render(<BlocRecettesCard client={client} idCard="c1" titreCard="Refonte" devise="EUR" />)
		await screen.findAllByTestId('ligne-recette')
		await userEvent.click(screen.getByRole('button', { name: 'Modifier la ligne « Solde »' }))
		await userEvent.click(screen.getByRole('button', { name: fr['admin.action.save'] }))
		expect(await screen.findByText(fr['card.revenues.refus.sans-effet'])).toBeTruthy()
		expect(screen.getByTestId('formulaire-recette')).toBeTruthy()
	})
})

const LIGNE_RENTAB = {
	workspace_id: 'w', track_id: 't', channel_id: 'h', card_id: 'c1', node_kind: 'open', archivee: false, currency: 'EUR',
	recettes_prevues: 72000, recettes_reelles: 4000, lignes_recette: 2, lignes_recette_sans_reel: 1,
	couts_prevus: 450, couts_reels: 375, lignes_cout: 2, lignes_cout_sans_reel: 1,
	personnel: 4800, minutes: 4200, minutes_non_valorisees: 0,
}

describe('le bloc « Rentabilité » de la fiche', () => {
	it('n’est pas rendu quand la base refuse en 42501 — aucun rôle n’est deviné', async () => {
		const { client } = clientFactice({ lectures: { workspaces: [{ administration_permise: true, edition_permise: true }] }, rpc: { data: null, error: { message: 'rentabilite_reservee', code: '42501' }, status: 403 } })
		const { container } = render(
			<MemoryRouter>
				<BlocRentabiliteCard client={client} idCard="c1" idWorkspace="w" />
			</MemoryRouter>,
		)
		await waitFor(() => expect(container.querySelector('[data-testid="bloc-rentabilite-card"]')).toBeNull())
	})

	it('n’appelle PAS la fonction quand la base refuse la capacité d’administrer : aucune 403 dans la console', async () => {
		const { client, rpcs } = clientFactice({ lectures: { workspaces: [{ administration_permise: false, edition_permise: true }] } })
		const { container } = render(
			<MemoryRouter>
				<BlocRentabiliteCard client={client} idCard="c1" idWorkspace="w" />
			</MemoryRouter>,
		)
		await waitFor(() => expect(container.querySelector('[data-testid="bloc-rentabilite-card"]')).toBeNull())
		expect(rpcs).toEqual([])
	})

	it('rend prévu et réel, la marge négative en pastille, et la marque « partielle » avec ses causes', async () => {
		const { client } = clientFactice({ lectures: { workspaces: [{ administration_permise: true, edition_permise: true }] }, rpc: { data: [LIGNE_RENTAB], error: null, status: 200 } })
		render(
			<MemoryRouter>
				<BlocRentabiliteCard client={client} idCard="c1" idWorkspace="w" />
			</MemoryRouter>,
		)
		const marges = await screen.findAllByTestId('rentab-marge')
		const reelle = marges[1]!
		expect(reelle.dataset.negative).toBe('oui')
		expect(reelle.textContent).toMatch(/^-1\s175,00$/u)
		expect(screen.getByRole('img', { name: /Marge partielle : 1 ligne de recette sans réel, 1 ligne de coût sans réel/ })).toBeTruthy()
		expect(screen.getByTestId('rentab-taux').textContent).toContain('-29,4')
	})

	it('dit « non calculable » une affaire à plusieurs devises', async () => {
		const { client } = clientFactice({ lectures: { workspaces: [{ administration_permise: true, edition_permise: true }] }, rpc: { data: [LIGNE_RENTAB, { ...LIGNE_RENTAB, currency: 'CHF' }], error: null, status: 200 } })
		render(
			<MemoryRouter>
				<BlocRentabiliteCard client={client} idCard="c1" idWorkspace="w" />
			</MemoryRouter>,
		)
		expect((await screen.findAllByTestId('rentab-non-calculable')).length).toBeGreaterThan(0)
	})
})

const A_SAISIR = (id: string, saisissable: boolean): RecetteASaisir => ({
	id,
	label: `Ligne ${id}`,
	estimated_amount: 1000,
	actual_amount: null,
	created_at: '2026-10-01T00:00:00Z',
	recette_saisissable: saisissable,
	cards: { id: 'c1', title: 'Refonte', currency: 'EUR', archived_at: null, channels: { slug: 'refonte', tracks: { slug: 'studio-web', name: 'Studio web' } } },
})

describe('l’onglet « À saisir »', () => {
	it('Entrée enregistre la recette et mène au champ de la ligne suivante ; la ligne reste en place', async () => {
		const { client, ecritures } = clientFactice({ lectures: { card_revenues: [{ actual_amount: 500 }] } })
		render(
			<MemoryRouter>
				<RecettesASaisir client={client} lecture={{ statut: 'pret', donnees: [A_SAISIR('a', true), A_SAISIR('b', true)] }} onRelire={() => undefined} maintenant={new Date('2026-10-23T00:00:00Z')} />
			</MemoryRouter>,
		)
		const champs = screen.getAllByTestId('recette-saisir-champ')
		await userEvent.type(champs[0]!, '500{Enter}')
		await waitFor(() => expect(document.activeElement).toBe(champs[1]))
		expect(ecritures[0]).toMatchObject({ table: 'card_revenue_actuals', action: 'insert', charge: { card_revenue_id: 'a', amount: 500 } })
		expect(screen.getAllByTestId('ligne-recette-a-saisir')).toHaveLength(2)
		expect(screen.getAllByText('22 jours')).toHaveLength(2)
	})

	it('rend une ligne non saisissable désactivée avec son motif, jamais masquée', () => {
		const { client } = clientFactice({})
		render(
			<MemoryRouter>
				<RecettesASaisir client={client} lecture={{ statut: 'pret', donnees: [A_SAISIR('a', false)] }} onRelire={() => undefined} />
			</MemoryRouter>,
		)
		expect((screen.getByTestId('recette-saisir-champ') as HTMLInputElement).disabled).toBe(true)
		expect(screen.getAllByText(fr['card.revenues.refus.forbidden']).length).toBeGreaterThan(0)
		expect(screen.getByText(fr['rentab.pending.readonly.all'])).toBeTruthy()
	})

	it('dit que l’état est sain quand rien n’attend', () => {
		render(
			<MemoryRouter>
				<RecettesASaisir client={null} lecture={{ statut: 'pret', donnees: [] }} onRelire={() => undefined} />
			</MemoryRouter>,
		)
		expect(screen.getByText(fr['rentab.pending.empty'])).toBeTruthy()
	})
})

describe('l’écran « Rentabilité »', () => {
	it('rend « Réservé aux administrateurs » sur un refus 42501, et le lien vers « À saisir »', async () => {
		const { client } = clientFactice({ rpc: { data: null, error: { message: 'rentabilite_reservee', code: '42501' }, status: 403 } })
		render(
			<MemoryRouter initialEntries={['/rentabilite']}>
				<Rentabilite client={client} administration="permise" />
			</MemoryRouter>,
		)
		expect(await screen.findByText(fr['rentab.refused.title'])).toBeTruthy()
		expect(screen.getByRole('link', { name: fr['rentab.refused.toPending'] }).getAttribute('href')).toContain('onglet=saisir')
	})

	it('n’appelle PAS la fonction tant que l’espace n’est pas connu, ni quand la capacité est refusée', async () => {
		const { client, rpcs } = clientFactice({})
		render(
			<MemoryRouter initialEntries={['/rentabilite']}>
				<Rentabilite client={client} />
			</MemoryRouter>,
		)
		await screen.findAllByLabelText(fr['state.loading.aria'])
		const refusee = clientFactice({})
		render(
			<MemoryRouter initialEntries={['/rentabilite']}>
				<Rentabilite client={refusee.client} administration="refusee" />
			</MemoryRouter>,
		)
		expect(await screen.findByText(fr['rentab.refused.title'])).toBeTruthy()
		expect([...rpcs, ...refusee.rpcs]).toEqual([])
	})

	it('rend un tableau par devise, la devise nommée dans les en-têtes, et retire le taux en vue « Prévu »', async () => {
		const { client } = clientFactice({
			rpc: { data: [LIGNE_RENTAB, { ...LIGNE_RENTAB, card_id: 'c2', currency: 'CHF' }], error: null, status: 200 },
			lectures: {
				cards: [
					{ id: 'c1', title: 'Refonte', currency: 'EUR', card_placements: [{ id: 'r1', created_at: '2026-01-01T00:00:00Z', amount: 72000, channels: { id: 'h', name: 'Refonte', slug: 'refonte', position: 1, tracks: { id: 't', name: 'Studio web', slug: 'studio-web', position: 1 } } }] },
					{ id: 'c2', title: 'Formation', currency: 'CHF', card_placements: [{ id: 'r2', created_at: '2026-01-01T00:00:00Z', amount: 28000, channels: { id: 'h', name: 'Refonte', slug: 'refonte', position: 1, tracks: { id: 't', name: 'Studio web', slug: 'studio-web', position: 1 } } }] },
				],
			},
		})
		render(
			<MemoryRouter initialEntries={['/rentabilite?vue=prevu']}>
				<Rentabilite client={client} administration="permise" />
			</MemoryRouter>,
		)
		const tableaux = await screen.findAllByTestId('rentab-tableau')
		expect(tableaux.map((t) => t.dataset.devise)).toEqual(['CHF', 'EUR'])
		expect(within(tableaux[1]!).getByRole('columnheader', { name: 'Marge prévue (EUR)' })).toBeTruthy()
		expect(within(tableaux[1]!).queryByRole('columnheader', { name: fr['rentab.column.rate'] })).toBeNull()
		expect(screen.getByText(fr['rentab.note.prevu'])).toBeTruthy()
	})
})
