// @verifies CRM-117 (docs/BACKLOG.md) — tranche T2 : les pages de l'aide, le sommaire et un chapitre
// @verifies docs/SPEC-manual.md §13.1 (les adresses), §13.3 (le sommaire lu une fois, les liens), §13.4 (chargement,
//           erreur et reprise, chapitre introuvable) ; docs/DESIGN_SYSTEM.md §5.69 (« Dans ce chapitre », chapitre
//           précédent et suivant), §5.8

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { enChargement, enErreur, pret } from '../lib/async'
import type { Chapitre, Sommaire } from '../lib/manuel'
import type { ClientCrm } from '../lib/supabase'
import { oublierSommaire } from './lecture-manuel'
import { SommaireAide, VueChapitre, voisinsDe } from './PageAide'

const SOMMAIRE: Sommaire = {
	introduction: [{ type: 'paragraph', content: [{ type: 'text', text: 'Bienvenue dans le manuel.' }] }],
	chapters: [
		{ slug: 'premiers-pas', title: '1. Premiers pas', sections: [{ anchor: 'se-connecter', title: '1.1 Se connecter' }] },
		{ slug: 'le-board', title: '2. Le board', sections: [] },
		{ slug: 'la-fiche', title: '3. La fiche', sections: [] },
	],
}

const CHAPITRE: Chapitre = {
	slug: 'le-board',
	title: '2. Le board',
	blocks: [
		{ type: 'paragraph', content: [{ type: 'text', text: 'Le board range les affaires.' }] },
		{ type: 'heading', level: 3, anchor: 'deplacer', content: [{ type: 'text', text: 'Déplacer une affaire' }] },
		{ type: 'heading', level: 3, anchor: 'filtrer', content: [{ type: 'text', text: 'Filtrer' }] },
	],
}

const clients: ClientCrm[] = []
afterEach(() => {
	cleanup()
	for (const c of clients.splice(0)) oublierSommaire(c)
})

/** Un stockage dont la lecture du sommaire échoue `echecs` fois, puis réussit. */
function stockage(echecs = 0) {
	let restants = echecs
	let lectures = 0
	const c = {
		storage: {
			from: () => ({
				download: () => {
					lectures += 1
					if (restants > 0) {
						restants -= 1
						return Promise.resolve({ data: null, error: { message: 'panne', status: 503 } })
					}
					return Promise.resolve({ data: new Blob([JSON.stringify(SOMMAIRE)]), error: null })
				},
			}),
		},
	} as unknown as ClientCrm
	clients.push(c)
	return { client: c, lectures: () => lectures }
}

describe('SommaireAide', () => {
	it('rend l’introduction, puis chaque chapitre et ses sections en liens', async () => {
		const { client } = stockage()
		render(
			<MemoryRouter>
				<SommaireAide client={client} />
			</MemoryRouter>,
		)
		expect(await screen.findByText('Bienvenue dans le manuel.')).toBeTruthy()
		expect(screen.getAllByTestId('chapitre-sommaire')).toHaveLength(3)
		expect(screen.getByRole('link', { name: '2. Le board' }).getAttribute('href')).toBe('/aide/le-board')
		expect(screen.getByRole('link', { name: '1.1 Se connecter' }).getAttribute('href')).toBe('/aide/premiers-pas#se-connecter')
		expect(screen.getByRole('navigation', { name: 'Chapitres du manuel' })).toBeTruthy()
	})

	it('une lecture en échec dit l’erreur, et « Réessayer » relit réellement', async () => {
		const { client, lectures } = stockage(1)
		render(
			<MemoryRouter>
				<SommaireAide client={client} />
			</MemoryRouter>,
		)
		expect(await screen.findByText('Le manuel n’a pas pu être chargé')).toBeTruthy()
		await userEvent.click(screen.getByRole('button', { name: 'Réessayer' }))
		expect(await screen.findByRole('link', { name: '2. Le board' })).toBeTruthy()
		expect(lectures()).toBe(2)
	})
})

describe('VueChapitre — les états', () => {
	const vue = (etat: Parameters<typeof VueChapitre>[0]['etat'], reessayer = () => {}) =>
		render(
			<MemoryRouter>
				<VueChapitre etat={etat} reessayer={reessayer} client={null} voisins={voisinsDe(SOMMAIRE, 'le-board')} />
			</MemoryRouter>,
		)

	it('pendant la lecture, un squelette nommé', () => {
		vue(enChargement())
		expect(screen.getByRole('status', { name: 'Chargement du chapitre' })).toBeTruthy()
	})

	it('une erreur offre la reprise', async () => {
		const reessayer = vi.fn()
		vue(enErreur({ nature: 'network', detail: 'x' }), reessayer)
		await userEvent.click(screen.getByRole('button', { name: 'Réessayer' }))
		expect(reessayer).toHaveBeenCalledOnce()
	})

	it('un chapitre introuvable le dit, et mène au sommaire', () => {
		vue(pret(null))
		expect(screen.getByText('Chapitre introuvable')).toBeTruthy()
		expect(screen.getByRole('link', { name: 'Sommaire du manuel' }).getAttribute('href')).toBe('/aide')
	})

	it('un chapitre : « Dans ce chapitre », ses sections, puis ses voisins', () => {
		vue(pret(CHAPITRE))
		const sommaireLocal = screen.getByRole('navigation', { name: 'Dans ce chapitre' })
		expect([...sommaireLocal.querySelectorAll('a')].map((a) => [a.textContent, a.getAttribute('href')])).toEqual([
			['Déplacer une affaire', '#deplacer'],
			['Filtrer', '#filtrer'],
		])
		expect(screen.getByRole('heading', { level: 2, name: 'Déplacer une affaire' }).id).toBe('deplacer')
		expect(screen.getByRole('link', { name: 'Chapitre précédent : 1. Premiers pas' }).getAttribute('href')).toBe('/aide/premiers-pas')
		expect(screen.getByRole('link', { name: 'Chapitre suivant : 3. La fiche' }).getAttribute('href')).toBe('/aide/la-fiche')
	})
})

describe('voisinsDe', () => {
	it('aux extrémités, un seul voisin ; un chapitre absent du sommaire, aucun', () => {
		expect(voisinsDe(SOMMAIRE, 'premiers-pas')).toEqual({ precedent: null, suivant: SOMMAIRE.chapters[1] })
		expect(voisinsDe(SOMMAIRE, 'la-fiche')).toEqual({ precedent: SOMMAIRE.chapters[1], suivant: null })
		expect(voisinsDe(SOMMAIRE, 'inconnu')).toBeNull()
	})
})

describe('la page se porte à la section du fragment', () => {
	it('une fois le chapitre rendu', async () => {
		const appel = vi.fn()
		Element.prototype.scrollIntoView = appel
		render(
			<MemoryRouter initialEntries={['/aide/le-board#filtrer']}>
				<VueChapitre etat={pret(CHAPITRE)} reessayer={() => {}} client={null} voisins={null} />
			</MemoryRouter>,
		)
		await waitFor(() => expect(appel).toHaveBeenCalled())
		expect((appel.mock.contexts[0] as HTMLElement).id).toBe('filtrer')
	})
})
