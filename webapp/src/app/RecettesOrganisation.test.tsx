// @verifies CRM-146 (docs/BACKLOG.md) — tranche T2 : la cellule « Réel sur prévu » et le bloc « Recettes avec cette
//           organisation », montés pour de vrai
// @verifies docs/SPEC-recettes.md §12.4 (une ligne par devise, « Rien de saisi sur », cellule vide sans recette), §12.5
//           (le tableau, les mentions conditionnelles, la portée, le vide sans action, l'erreur et sa reprise dans le bloc
//           seul, le squelette) ; docs/DESIGN_SYSTEM.md §5.97 (la barre `aria-hidden`, bornée, absente d'une part sans
//           objet ; le texte porte tout), §5.9, §5.8, §10 (accord par clé)

import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { BlocRecettesOrganisation, ReelSurPrevu } from './RecettesOrganisation'
import { fr } from '../i18n/fr'
import { montantEnClair } from './BlocRentabiliteCard'
import type { TotalDevise } from '../lib/recettes-organisation'
import type { ClientCrm } from '../lib/supabase'

afterEach(cleanup)

const total = (o: Partial<TotalDevise> = {}): TotalDevise => ({
	devise: 'EUR', prevu: 210000, reel: 163000, affaires: 1, affairesPartagees: 0, lignes: 2, lignesSansReel: 0, ...o,
})

const ligneBrute = (o: Record<string, unknown> = {}) => ({
	organization_id: 'o1', currency: 'EUR', estimated_total: 210000, actual_total: 163000,
	cards: 1, shared_cards: 0, revenue_lines: 2, lines_without_actual: 0, ...o,
})

describe('la cellule « Réel sur prévu » (§12.4)', () => {
	it('rend une ligne par devise : la barre cachée, le texte, puis le code dans son propre élément', () => {
		render(<ReelSurPrevu totaux={[total({ devise: 'CHF', prevu: 28000, reel: 14000 }), total()]} />)
		const lignes = screen.getAllByTestId('reel-sur-prevu')
		expect(lignes.map((l) => l.getAttribute('data-devise'))).toEqual(['CHF', 'EUR'])
		const eur = lignes[1] as HTMLElement
		expect(eur.textContent).toBe(`${montantEnClair(163000)} sur ${montantEnClair(210000)}EUR`)
		expect(within(eur).getByText('EUR').tagName).toBe('SPAN')
		const barre = within(eur).getByTestId('barre-recette')
		expect(barre.getAttribute('aria-hidden')).toBe('true')
		expect((within(eur).getByTestId('barre-recette-remplissage') as HTMLElement).style.width).toMatch(/^77\.6/)
	})

	it('un réel inconnu s’écrit « Rien de saisi sur », barre vide', () => {
		render(<ReelSurPrevu totaux={[total({ reel: null, prevu: 72000 })]} />)
		expect(screen.getByTestId('reel-sur-prevu').textContent).toBe(`Rien de saisi sur ${montantEnClair(72000)}EUR`)
		expect((screen.getByTestId('barre-recette-remplissage') as HTMLElement).style.width).toBe('0%')
	})

	it('un dépassement remplit la barre sans changer sa couleur', () => {
		render(<ReelSurPrevu totaux={[total({ prevu: 100, reel: 150 })]} />)
		const remplissage = screen.getByTestId('barre-recette-remplissage') as HTMLElement
		expect(remplissage.style.width).toBe('100%')
		expect(remplissage.className).toContain('bg-brand')
		expect(remplissage.className).not.toMatch(/success|danger|accent/)
	})

	it('une part sans objet n’a pas de barre, mais garde sa place', () => {
		render(<ReelSurPrevu totaux={[total({ prevu: 0, reel: 10 })]} />)
		expect(screen.queryByTestId('barre-recette')).toBeNull()
		expect(screen.getByTestId('barre-recette-sans-objet').className).toContain('w-[96px]')
	})

	it('sans recette, rien n’est rendu — ni barre à zéro, ni « 0 sur 0 »', () => {
		const { container } = render(<ReelSurPrevu totaux={[]} />)
		expect(container.textContent).toBe('')
	})
})

type Reponse = { data: unknown; error: { message: string } | null; status: number }

function clientRpc(...reponses: (Reponse | 'jamais')[]) {
	const appels: unknown[] = []
	const client = {
		rpc: (_nom: string, args: unknown) => {
			appels.push(args)
			const r = reponses[Math.min(appels.length - 1, reponses.length - 1)]
			return r === 'jamais' || r === undefined ? new Promise(() => {}) : Promise.resolve(r)
		},
	} as unknown as ClientCrm
	return { client, appels }
}

describe('le bloc « Recettes avec cette organisation » (§12.5)', () => {
	it('rend un tableau par devise, la part en pourcentage entier, et les mentions accordées', async () => {
		const { client, appels } = clientRpc({
			data: [
				ligneBrute({ currency: 'CHF', estimated_total: 28000, actual_total: 14000, cards: 1, lines_without_actual: 1 }),
				ligneBrute({ cards: 2, shared_cards: 1 }),
			],
			error: null,
			status: 200,
		})
		render(<BlocRecettesOrganisation client={client} idOrganisation="o1" />)
		const lignes = await screen.findAllByTestId('ligne-recettes-organisation')
		expect(appels).toEqual([{ p_organization_id: 'o1' }])
		expect(screen.getByRole('heading', { level: 2 }).textContent).toBe(fr['organization.revenues.title'])
		expect(screen.getAllByRole('columnheader').map((c) => c.textContent)).toEqual([
			fr['organization.revenues.column.currency'], fr['organization.revenues.column.estimated'],
			fr['organization.revenues.column.actual'], fr['organization.revenues.column.progress'],
		])
		expect(within(lignes[0] as HTMLElement).getByRole('rowheader').textContent).toBe('CHF')
		expect(lignes[0]?.textContent).toContain('50 %')
		expect(lignes[1]?.textContent).toContain('78 %')
		const mentions = screen.getByTestId('mentions-recettes-organisation')
		expect([...mentions.querySelectorAll('p')].map((p) => p.textContent)).toEqual([
			fr['organization.revenues.cards.many'].replace('{n}', '3'),
			fr['organization.revenues.shared.one'].replace('{n}', '1'),
			fr['organization.revenues.withoutActual.one'].replace('{n}', '1'),
			fr['organization.revenues.scope'],
		])
	})

	it('tait les mentions dont le compte est nul ; un réel inconnu laisse la cellule vide et la part à 0 %', async () => {
		const { client } = clientRpc({ data: [ligneBrute({ actual_total: null })], error: null, status: 200 })
		render(<BlocRecettesOrganisation client={client} idOrganisation="o1" />)
		const ligne = await screen.findByTestId('ligne-recettes-organisation')
		expect((ligne.querySelectorAll('td')[1] as HTMLElement).textContent).toBe('')
		expect(ligne.textContent).toContain('0 %')
		expect(screen.queryByTestId('mention-recettes-partagees')).toBeNull()
		expect(screen.queryByTestId('mention-recettes-sans-reel')).toBeNull()
		expect(screen.getByTestId('mentions-recettes-organisation').firstElementChild?.textContent).toBe(
			fr['organization.revenues.cards.one'].replace('{n}', '1'),
		)
	})

	it('une part sans objet laisse la cellule vide', async () => {
		const { client } = clientRpc({ data: [ligneBrute({ estimated_total: -50 })], error: null, status: 200 })
		render(<BlocRecettesOrganisation client={client} idOrganisation="o1" />)
		const ligne = await screen.findByTestId('ligne-recettes-organisation')
		expect((ligne.querySelectorAll('td')[2] as HTMLElement).textContent).toBe('')
		expect(screen.queryByTestId('barre-recette')).toBeNull()
	})

	it('le vide n’offre aucune action et ne dit pas la portée', async () => {
		const { client } = clientRpc({ data: [], error: null, status: 200 })
		render(<BlocRecettesOrganisation client={client} idOrganisation="o1" />)
		const vide = await screen.findByTestId('etat-vide')
		expect(vide.textContent).toContain(fr['organization.revenues.empty.title'])
		expect(vide.querySelectorAll('button, a')).toHaveLength(0)
		expect(screen.queryByText(fr['organization.revenues.scope'])).toBeNull()
	})

	it('une organisation absente de la réponse est le vide — les totaux d’une autre ne s’affichent pas', async () => {
		const { client } = clientRpc({ data: [ligneBrute({ organization_id: 'autre' })], error: null, status: 200 })
		render(<BlocRecettesOrganisation client={client} idOrganisation="o1" />)
		expect(await screen.findByTestId('etat-vide')).toBeTruthy()
	})

	it('rend un squelette pendant la lecture', () => {
		render(<BlocRecettesOrganisation client={clientRpc('jamais').client} idOrganisation="o1" />)
		expect(screen.getByLabelText(fr['state.loading.aria'])).toBeTruthy()
	})

	it('l’erreur reste dans le bloc, et « Réessayer » relit', async () => {
		const { client, appels } = clientRpc(
			{ data: null, error: { message: 'boom' }, status: 500 },
			{ data: [ligneBrute()], error: null, status: 200 },
		)
		render(<BlocRecettesOrganisation client={client} idOrganisation="o1" />)
		const bloc = screen.getByTestId('recettes-organisation')
		await userEvent.click(await within(bloc).findByRole('button', { name: fr['organization.revenues.error.retry'] }))
		expect(await screen.findByTestId('tableau-recettes-organisation')).toBeTruthy()
		expect(appels).toHaveLength(2)
	})
})
