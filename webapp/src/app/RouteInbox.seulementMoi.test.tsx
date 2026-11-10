// @verifies CRM-139 (docs/BACKLOG.md) — « Seulement moi » dans l'écran de l'inbox : la case cochée par défaut avec une
//           identité, ce que l'arborescence et la liste DEMANDENT à la base, l'attente pendant la lecture des identités,
//           l'état désactivé qui explique (aucune identité, échec et reprise), le vide sous le filtre et son action,
//           l'adresse qui garde la case, et l'adresse d'un message caché qui la décoche
// @verifies docs/SPEC-mail-subsystem.md §27.3, §27.4 ; docs/DESIGN_SYSTEM.md §5.96 ; docs/JOURNAL.md décision 902
//
// Le filtre lui-même est calculé par la base, et prouvé par pgTAP et par l'E2E API : ces preuves éprouvent ce que
// l'écran DEMANDE et ce qu'il REND. Le client factice retient chaque demande.

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, useLocation } from 'react-router'

type Reponse = { data: unknown; error: { message: string } | null; status: number }
const ok = (data: unknown): Reponse => ({ data, error: null, status: 200 })

const MESSAGE = {
	id: 'msg-1',
	workspace_id: 'ws-1',
	card_id: null,
	classification: 'unclassified',
	subject: 'Candidature spontanée',
	from_address: 'bizdev@p2enjoy.test',
	from_name: null,
	received_at: '2026-11-10T10:00:00.000Z',
	references_ids: [],
	rfc822_message_id: '<libre@client.test>',
	is_read: true,
}

/** L'état du double, remis à zéro avant chaque preuve. */
const etat = {
	identites: (): Promise<Reponse> => Promise.resolve(ok([{ id: 'ident-1' }])),
	messages: [MESSAGE] as unknown[],
	concerne: true,
	appelsArbre: [] as unknown[],
	lecturesListe: [] as Array<Array<[string, unknown]>>,
	lecturesIdentites: 0,
}

/** Une requête PostgREST factice : chaque méthode retient son filtre, et l'attente rend la réponse de la table. */
function requete(table: string, colonnes: string) {
	const filtres: Array<[string, unknown]> = []
	const resoudre = (): Promise<Reponse> => {
		if (table === 'mail_outbound_identities') {
			etat.lecturesIdentites += 1
			return etat.identites()
		}
		if (table === 'mail_messages') {
			const parId = filtres.find(([c]) => c === 'id')
			if (parId !== undefined) {
				return Promise.resolve(ok([{ id: parId[1], card_id: null, concerns_me: etat.concerne }]))
			}
			etat.lecturesListe.push(filtres)
			return Promise.resolve(ok(etat.messages))
		}
		return Promise.resolve(ok([]))
	}
	const chaine: Record<string, unknown> = {
		eq: (colonne: string, valeur: unknown) => {
			filtres.push([colonne, valeur])
			return chaine
		},
		is: (colonne: string, valeur: unknown) => {
			filtres.push([`is:${colonne}`, valeur])
			return chaine
		},
		in: () => chaine,
		order: () => chaine,
		limit: () => chaine,
		then: (succes: (r: Reponse) => unknown, echec: (e: unknown) => unknown) => resoudre().then(succes, echec),
	}
	void colonnes
	return chaine
}

const CLIENT = {
	rpc: (nom: string, args?: Record<string, unknown>) => {
		if (nom === 'inbox_arborescence') {
			etat.appelsArbre.push(args)
			return Promise.resolve(
				ok([
					{
						track_id: null,
						track_name: null,
						channel_id: null,
						channel_name: null,
						card_id: null,
						card_title: null,
						nombre: etat.messages.length,
						unread_count: 0,
					},
				]),
			)
		}
		return Promise.resolve(ok(null))
	},
	from: (table: string) => ({ select: (colonnes: string) => requete(table, colonnes) }),
}

vi.mock('../lib/supabase', () => ({ clientCrm: CLIENT }))
vi.mock('./Authentification', () => ({
	useAuthentification: () => ({
		etat: { statut: 'authentifie', utilisateur: { id: 'moi-1', email: 'admin@p2enjoy.test' } },
		profilCourant: { statut: 'pret', donnees: null },
	}),
}))

const { RouteInbox } = await import('./RouteInbox')

function Adresse() {
	const lieu = useLocation()
	return <output data-testid="adresse">{lieu.search}</output>
}

function monter(adresse = '/inbox') {
	render(
		<MemoryRouter initialEntries={[adresse]}>
			<RouteInbox />
			<Adresse />
		</MemoryRouter>,
	)
}

const caseMoi = () => screen.getByTestId('inbox-seulement-moi') as HTMLInputElement

beforeEach(() => {
	etat.identites = () => Promise.resolve(ok([{ id: 'ident-1' }]))
	etat.messages = [MESSAGE]
	etat.concerne = true
	etat.appelsArbre = []
	etat.lecturesListe = []
	etat.lecturesIdentites = 0
})
afterEach(cleanup)

describe('RouteInbox — « Seulement moi » (§27.4)', () => {
	it('avec une identité, la case est cochée et active, et l’arborescence comme la liste demandent le seul courrier qui me concerne', async () => {
		monter()
		await waitFor(() => expect(caseMoi().disabled).toBe(false))
		expect(caseMoi().checked).toBe(true)
		await waitFor(() => expect(etat.appelsArbre).toContainEqual({ p_only_me: true }))
		await userEvent.click(await screen.findByRole('button', { name: /Non classés/ }))
		await waitFor(() => expect(etat.lecturesListe.at(-1)).toContainEqual(['concerns_me', true]))
		expect(screen.queryByTestId('inbox-seulement-moi-explication')).toBeNull()
	})

	it('décocher écrit `courrier=tous` et relit l’arborescence et la liste sans le filtre', async () => {
		monter()
		await userEvent.click(await screen.findByRole('button', { name: /Non classés/ }))
		await waitFor(() => expect(caseMoi().disabled).toBe(false))
		await userEvent.click(caseMoi())
		expect(caseMoi().checked).toBe(false)
		expect(screen.getByTestId('adresse').textContent).toBe('?courrier=tous')
		await waitFor(() => expect(etat.appelsArbre.at(-1)).toEqual({ p_only_me: false }))
		await waitFor(() => expect(etat.lecturesListe.at(-1)).not.toContainEqual(['concerns_me', true]))
		// Recocher retire la clé : la vue par défaut reste l'adresse la plus courte.
		await userEvent.click(caseMoi())
		expect(screen.getByTestId('adresse').textContent).toBe('')
	})

	it('`?courrier=tous` ouvre l’écran décoché : la case survit au rechargement', async () => {
		monter('/inbox?courrier=tous')
		await waitFor(() => expect(caseMoi().disabled).toBe(false))
		expect(caseMoi().checked).toBe(false)
		await waitFor(() => expect(etat.appelsArbre).toContainEqual({ p_only_me: false }))
	})

	it('PENDANT LA LECTURE DES IDENTITÉS, rien n’est demandé : on ne montre pas tout le courrier pour le retirer ensuite', async () => {
		let liberer: (r: Reponse) => void = () => undefined
		etat.identites = () => new Promise((resoudre) => (liberer = resoudre))
		monter()
		await waitFor(() => expect(etat.lecturesIdentites).toBe(1))
		expect(caseMoi().disabled).toBe(true)
		expect(caseMoi().checked).toBe(true)
		expect(etat.appelsArbre).toEqual([])
		liberer(ok([{ id: 'ident-1' }]))
		await waitFor(() => expect(etat.appelsArbre).toEqual([{ p_only_me: true }]))
	})

	it('SANS IDENTITÉ, la case est décochée, désactivée, et explique, avec le lien qui en ajoute une ; rien n’est filtré', async () => {
		etat.identites = () => Promise.resolve(ok([]))
		monter()
		const explication = await screen.findByTestId('inbox-seulement-moi-explication')
		expect(explication.textContent).toContain('Aucune adresse d’expédition personnelle : tous les mails sont affichés.')
		const lien = screen.getByRole('link', { name: 'Ajouter une adresse d’expédition' })
		expect(lien.getAttribute('href')).toBe('/reglages/identites-mail')
		expect(caseMoi().disabled).toBe(true)
		expect(caseMoi().checked).toBe(false)
		expect(caseMoi().getAttribute('aria-describedby')).toBe(explication.id)
		await waitFor(() => expect(etat.appelsArbre).toEqual([{ p_only_me: false }]))
	})

	it('UN ÉCHEC DE LECTURE ne cache rien, le dit, et « Réessayer » relit les identités', async () => {
		etat.identites = () => Promise.resolve({ data: null, error: { message: 'panne' }, status: 500 })
		monter()
		const explication = await screen.findByTestId('inbox-seulement-moi-explication')
		expect(explication.textContent).toContain('Vos adresses d’expédition n’ont pas pu être lues')
		await waitFor(() => expect(etat.appelsArbre).toEqual([{ p_only_me: false }]))
		etat.identites = () => Promise.resolve(ok([{ id: 'ident-1' }]))
		await userEvent.click(screen.getByRole('button', { name: 'Réessayer' }))
		await waitFor(() => expect(caseMoi().disabled).toBe(false))
		expect(caseMoi().checked).toBe(true)
		expect(screen.queryByTestId('inbox-seulement-moi-explication')).toBeNull()
	})

	it('UNE LISTE VIDE SOUS LE FILTRE porte son action, qui décoche la case', async () => {
		monter()
		await userEvent.click(await screen.findByRole('button', { name: /Non classés/ }))
		etat.messages = []
		await waitFor(() => expect(caseMoi().disabled).toBe(false))
		// Une relecture : le double rend désormais une liste vide.
		await userEvent.click(caseMoi())
		await userEvent.click(caseMoi())
		const action = await screen.findByTestId('inbox-seulement-moi-tout')
		expect(screen.getByText('Aucun message de ce dossier ne vous concerne')).toBeTruthy()
		await userEvent.click(action)
		expect(caseMoi().checked).toBe(false)
		expect(screen.getByTestId('adresse').textContent).toBe('?courrier=tous')
	})

	it('L’ADRESSE D’UN MESSAGE QUI NE ME CONCERNE PAS l’emporte : la case passe décochée', async () => {
		etat.concerne = false
		monter('/inbox?message=msg-1')
		await waitFor(() => expect(screen.getByTestId('adresse').textContent).toBe('?courrier=tous'))
		expect(caseMoi().checked).toBe(false)
	})

	it('l’adresse d’un message qui me concerne ne touche pas à la case', async () => {
		etat.concerne = true
		monter('/inbox?message=msg-1')
		await waitFor(() => expect(etat.appelsArbre).toContainEqual({ p_only_me: true }))
		await waitFor(() => expect(screen.getByTestId('adresse').textContent).toBe(''))
		expect(caseMoi().checked).toBe(true)
	})
})
