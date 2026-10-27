// @verifies CRM-117 (docs/BACKLOG.md) — tranche T2 : l'icône « Aide » de l'en-tête et son panneau
// @verifies docs/SPEC-manual.md §13.2 (« Aide sur cet écran » puis « Sommaire du manuel » ; un écran sans chapitre n'a
//           que le sommaire) ; docs/DESIGN_SYSTEM.md §5.69 (focus sur le premier lien, Échap rend le focus à l'icône,
//           clic hors du panneau, un seul panneau de l'en-tête ouvert), §5.43 ; docs/JOURNAL.md décision 740

import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { afterEach, describe, expect, it } from 'vitest'
import type { ClientCrm } from '../lib/supabase'
import { AideEntete, titreDeLaCible } from './AideEntete'
import { oublierSommaire } from './lecture-manuel'
import { fermerLesAutresPanneaux } from './panneaux-entete'

const SOMMAIRE = {
	introduction: [],
	chapters: [
		{
			slug: 'l-affaire-ce-qu-elle-porte-son-adresse-ses-deux-facons-de-disparaitre',
			title: '4. L’affaire',
			sections: [{ anchor: 'le-tableau-kanban-d-un-channel', title: '4.8 Le tableau kanban d’un channel' }],
		},
	],
}

function client(lectures: string[] = []): ClientCrm {
	return {
		storage: {
			from: () => ({
				download: (chemin: string) => {
					lectures.push(chemin)
					return Promise.resolve({ data: new Blob([JSON.stringify(SOMMAIRE)]), error: null })
				},
			}),
		},
	} as unknown as ClientCrm
}

let dernierClient: ClientCrm | null = null
afterEach(() => {
	cleanup()
	if (dernierClient !== null) oublierSommaire(dernierClient)
})

function Adresse() {
	return <span data-testid="adresse">{useLocation().pathname + useLocation().hash}</span>
}

function monter(chemin: string, lectures: string[] = []) {
	dernierClient = client(lectures)
	const instance = dernierClient
	return render(
		<MemoryRouter initialEntries={[chemin]}>
			<button type="button">dehors</button>
			<AideEntete client={instance} />
			<Routes>
				<Route path="*" element={<Adresse />} />
			</Routes>
		</MemoryRouter>,
	)
}

const icone = () => screen.getByRole('button', { name: 'Aide' })

describe('l’icône et son panneau', () => {
	it('l’icône est un bouton nommé « Aide », fermé, et le sommaire n’est pas lu avant l’ouverture', () => {
		const lectures: string[] = []
		monter('/tracks/conseil-ia/prospection', lectures)
		expect(icone().getAttribute('aria-expanded')).toBe('false')
		expect(screen.queryByTestId('panneau-aide')).toBeNull()
		expect(lectures).toEqual([])
	})

	it('sur un board : « Aide sur cet écran » nommé par la section, puis le sommaire ; le focus entre sur le premier lien', async () => {
		monter('/tracks/conseil-ia/prospection')
		await userEvent.click(icone())
		expect(icone().getAttribute('aria-expanded')).toBe('true')
		const ecran = await screen.findByRole('link', { name: '4.8 Le tableau kanban d’un channel' })
		expect(ecran.getAttribute('href')).toBe(
			'/aide/l-affaire-ce-qu-elle-porte-son-adresse-ses-deux-facons-de-disparaitre#le-tableau-kanban-d-un-channel',
		)
		expect(document.activeElement).toBe(screen.getByTestId('aide-ecran'))
		expect(screen.getByRole('link', { name: 'Sommaire du manuel' }).getAttribute('href')).toBe('/aide')
	})

	it('un écran sans chapitre n’offre que le sommaire, qui prend le focus', async () => {
		monter('/reglages')
		await userEvent.click(icone())
		expect(screen.queryByTestId('aide-ecran')).toBeNull()
		expect(screen.queryByText('Aide sur cet écran')).toBeNull()
		expect(document.activeElement).toBe(screen.getByRole('link', { name: 'Sommaire du manuel' }))
	})

	it('Échap referme et rend le focus à l’icône ; « Fermer l’aide » aussi', async () => {
		monter('/inbox')
		await userEvent.click(icone())
		await userEvent.keyboard('{Escape}')
		expect(screen.queryByTestId('panneau-aide')).toBeNull()
		expect(document.activeElement).toBe(icone())
		await userEvent.click(icone())
		await userEvent.click(screen.getByRole('button', { name: 'Fermer l’aide' }))
		expect(screen.queryByTestId('panneau-aide')).toBeNull()
		expect(document.activeElement).toBe(icone())
	})

	it('un clic hors du panneau le referme sans ramener le focus', async () => {
		monter('/inbox')
		await userEvent.click(icone())
		await userEvent.click(screen.getByRole('button', { name: 'dehors' }))
		expect(screen.queryByTestId('panneau-aide')).toBeNull()
		expect(document.activeElement).toBe(screen.getByRole('button', { name: 'dehors' }))
	})

	it('suivre un lien referme le panneau et mène au chapitre', async () => {
		monter('/tracks/conseil-ia/prospection')
		await userEvent.click(icone())
		await userEvent.click(await screen.findByTestId('aide-ecran'))
		expect(screen.getByTestId('adresse').textContent).toBe(
			'/aide/l-affaire-ce-qu-elle-porte-son-adresse-ses-deux-facons-de-disparaitre#le-tableau-kanban-d-un-channel',
		)
		expect(screen.queryByTestId('panneau-aide')).toBeNull()
	})

	it('un autre panneau de l’en-tête qui s’ouvre referme celui-ci (§5.69)', async () => {
		monter('/inbox')
		await userEvent.click(icone())
		act(() => fermerLesAutresPanneaux('notifications'))
		await waitFor(() => expect(screen.queryByTestId('panneau-aide')).toBeNull())
	})
})

describe('titreDeLaCible', () => {
	it('la section, sinon le chapitre ; rien tant que le sommaire n’est pas lu ou si le chapitre a disparu', () => {
		const slug = SOMMAIRE.chapters[0]?.slug ?? ''
		expect(titreDeLaCible(SOMMAIRE, { chapitre: slug, section: 'le-tableau-kanban-d-un-channel' })).toBe(
			'4.8 Le tableau kanban d’un channel',
		)
		expect(titreDeLaCible(SOMMAIRE, { chapitre: slug })).toBe('4. L’affaire')
		expect(titreDeLaCible(SOMMAIRE, { chapitre: slug, section: 'inconnue' })).toBe('4. L’affaire')
		expect(titreDeLaCible(null, { chapitre: slug })).toBeNull()
		expect(titreDeLaCible(SOMMAIRE, { chapitre: 'disparu' })).toBeNull()
	})
})
