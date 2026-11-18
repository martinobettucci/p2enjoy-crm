// @verifies CRM-153 (docs/BACKLOG.md) — tranche T3 : la ligne « Catégories » de la fiche — les pilules (l'archivée le dit),
//           « Aucune catégorie », la commande et son panneau de cases (actives, puis archivées posées qui se décochent
//           seulement), l'écriture au clic, le retour de la case refusée et son motif, les cases éteintes avec le motif en
//           tête du panneau, `Échap` qui rend le focus à la commande
// @verifies docs/SPEC-organisations.md §9.1, §9.3 ; docs/DESIGN_SYSTEM.md §5.107, §5.73, §5.59, §5.13
//
// L'écran RÉEL est monté sur un client espion par table. La pile réelle est éprouvée par
// `e2e/ui/organisation-fiche-commentaires.spec.ts` ; les droits, par `e2e/api/commentaires-categories-organisations.spec.ts`.

import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it } from 'vitest'
import { fr } from '../i18n'
import type { Capacite } from '../lib/capacites'
import type { ClientCrm } from '../lib/supabase'
import { LigneCategories } from './CategoriesOrganisation'

afterEach(cleanup)

const CATALOGUE = [
	{ id: 'c-client', name: 'Client', color: 'brand', archived_at: null },
	{ id: 'c-part', name: 'Partenaire', color: 'success', archived_at: null },
	{ id: 'c-ancien', name: 'Ancien client', color: 'neutral', archived_at: '2026-11-18T00:00:00Z' },
	{ id: 'c-vieux', name: 'Vieux fournisseur', color: 'accent', archived_at: '2026-11-18T00:00:00Z' },
]

type Ecriture = { methode: string; valeur: unknown; filtres: string[] }
type Reponse = { data: unknown; error: unknown; status: number }

function client(posees: readonly string[], ecriture: Reponse = { data: [{ category_id: 'x' }], error: null, status: 201 }) {
	const ecritures: Ecriture[] = []
	const faux = {
		from: (table: string) => {
			const maillon: Record<string, unknown> = {}
			let courante: Ecriture | null = null
			maillon.select = () => maillon
			maillon.eq = (colonne: string, valeur: string) => {
				courante?.filtres.push(`${colonne}=${valeur}`)
				return maillon
			}
			for (const methode of ['insert', 'delete']) {
				maillon[methode] = (valeur?: unknown) => {
					courante = { methode, valeur, filtres: [] }
					ecritures.push(courante)
					return maillon
				}
			}
			maillon.then = (resoudre: (r: unknown) => unknown) => {
				if (courante !== null) return resoudre(ecriture)
				if (table === 'organization_category_links') {
					return resoudre({ data: CATALOGUE.filter((c) => posees.includes(c.id)).map((c) => ({ categorie: c })), error: null, status: 200 })
				}
				return resoudre({ data: CATALOGUE, error: null, status: 200 })
			}
			return maillon
		},
	} as unknown as ClientCrm
	return { client: faux, ecritures }
}

function monter(c: ClientCrm, edition: Capacite = 'permise') {
	return render(
		<MemoryRouter>
			<dl>
				<LigneCategories client={c} idOrganisation="org-1" idWorkspace="ws-1" edition={edition} idMotif="motif-fiche" />
			</dl>
		</MemoryRouter>,
	)
}

const pilules = () => within(screen.getByTestId('pilules-categories-organisation')).queryAllByTestId('pastille-etiquette').map((p) => p.textContent)

describe('la ligne « Catégories » de la fiche (docs/DESIGN_SYSTEM.md §5.107)', () => {
	it('montre les pilules posées, l’archivée la dernière et dite archivée ; sans catégorie, « Aucune catégorie »', async () => {
		monter(client(['c-part', 'c-ancien', 'c-client']).client)
		await waitFor(() => expect(pilules()).toEqual(['Client', 'Partenaire', 'Ancien client']))
		// Seule l'archivée porte un nom accessible propre (rôle `img`) : il dit qu'elle est archivée.
		const nommees = within(screen.getByTestId('pilules-categories-organisation')).getAllByRole('img')
		expect(nommees.map((p) => p.getAttribute('aria-label'))).toEqual(['Ancien client, catégorie archivée'])
		cleanup()
		monter(client([]).client)
		expect(await screen.findByText(fr['organization.categories.none'])).toBeTruthy()
	})

	it('le panneau propose les actives, puis les archivées POSÉES seulement, qui se décochent mais ne se cochent pas', async () => {
		monter(client(['c-client', 'c-ancien']).client)
		await waitFor(() => expect(pilules()).toEqual(['Client', 'Ancien client']))
		const commande = screen.getByTestId('commande-categories-organisation')
		await userEvent.click(commande)
		expect(commande.getAttribute('aria-expanded')).toBe('true')
		const panneau = await screen.findByTestId('panneau-categories-organisation')
		await waitFor(() => expect(within(panneau).getAllByTestId('case-categorie-organisation')).toHaveLength(3))
		const cases = within(panneau).getAllByTestId('case-categorie-organisation') as HTMLInputElement[]
		expect(cases.map((c) => [c.closest('label')!.textContent, c.checked, c.disabled])).toEqual([
			['Client', true, false],
			['Partenaire', false, false],
			['Ancien client', true, false],
		])
		// « Vieux fournisseur », archivé et non posé, n'est pas proposé.
		expect(within(panneau).queryByText('Vieux fournisseur')).toBeNull()
		expect(document.activeElement).toBe(cases[0])
	})

	it('cocher pose la catégorie (insert du couple) et la pilule paraît ; décocher la retire', async () => {
		const { client: c, ecritures } = client(['c-client'])
		monter(c)
		await waitFor(() => expect(pilules()).toEqual(['Client']))
		await userEvent.click(screen.getByTestId('commande-categories-organisation'))
		const panneau = await screen.findByTestId('panneau-categories-organisation')
		await userEvent.click(await within(panneau).findByRole('checkbox', { name: /Partenaire/ }))
		await waitFor(() => expect(pilules()).toEqual(['Client', 'Partenaire']))
		expect(ecritures[0]).toEqual({ methode: 'insert', valeur: { organization_id: 'org-1', category_id: 'c-part' }, filtres: [] })
		await userEvent.click(within(panneau).getByRole('checkbox', { name: /Client/ }))
		await waitFor(() => expect(pilules()).toEqual(['Partenaire']))
		expect(ecritures[1]).toMatchObject({ methode: 'delete', filtres: ['organization_id=org-1', 'category_id=c-client'] })
	})

	it('une pose refusée laisse la case décochée, et son motif s’écrit dessous, cité par la case', async () => {
		monter(client([], { data: null, error: { code: '22023', message: 'category_archived' }, status: 400 }).client)
		await screen.findByText(fr['organization.categories.none'])
		await userEvent.click(screen.getByTestId('commande-categories-organisation'))
		const panneau = await screen.findByTestId('panneau-categories-organisation')
		const caseClient = (await within(panneau).findByRole('checkbox', { name: /^Client/ })) as HTMLInputElement
		await userEvent.click(caseClient)
		const refus = await within(panneau).findByRole('alert')
		expect(refus.textContent).toBe(fr['organization.categories.refus.archivee'])
		expect(caseClient.checked).toBe(false)
		expect(caseClient.getAttribute('aria-describedby')).toBe(refus.id)
		expect(pilules()).toEqual([])
	})

	it('refusée par la capacité d’éditer : la commande est éteinte, lisible, et cite le motif de la fiche ; les pilules restent lues', async () => {
		monter(client(['c-client']).client, 'refusee')
		await waitFor(() => expect(pilules()).toEqual(['Client']))
		const commande = screen.getByTestId('commande-categories-organisation') as HTMLButtonElement
		expect(commande.disabled).toBe(true)
		expect(commande.getAttribute('aria-describedby')).toBe('motif-fiche')
	})

	it('décocher une archivée la retire du panneau, et le focus revient à la première case — jamais au document', async () => {
		monter(client(['c-client', 'c-ancien'], { data: [{ category_id: 'c-ancien' }], error: null, status: 200 }).client)
		await waitFor(() => expect(pilules()).toEqual(['Client', 'Ancien client']))
		await userEvent.click(screen.getByTestId('commande-categories-organisation'))
		const panneau = await screen.findByTestId('panneau-categories-organisation')
		await userEvent.click(await within(panneau).findByRole('checkbox', { name: /Ancien client/ }))
		await waitFor(() => expect(within(panneau).queryByRole('checkbox', { name: /Ancien client/ })).toBeNull())
		await waitFor(() => expect(document.activeElement).toBe(within(panneau).getAllByTestId('case-categorie-organisation')[0]))
	})

	it('Échap referme le panneau et rend le focus à la commande', async () => {
		monter(client(['c-client']).client)
		await waitFor(() => expect(pilules()).toEqual(['Client']))
		await userEvent.click(screen.getByTestId('commande-categories-organisation'))
		await screen.findAllByTestId('case-categorie-organisation')
		await userEvent.keyboard('{Escape}')
		expect(screen.queryByTestId('panneau-categories-organisation')).toBeNull()
		await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId('commande-categories-organisation')))
	})
})
