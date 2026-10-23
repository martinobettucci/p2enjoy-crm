// @verifies CRM-070 (docs/BACKLOG.md) — tranche T2 : Réglages ▸ Membres, l'écran d'un administrateur d'espace
// @verifies docs/SPEC-membres.md §3 (consultable par tout membre ; commandes éteintes par la capacité d'administration),
//           §3.1 (rôle écrit au choix, retrait confirmé, soi-même, dernier administrateur), §3.4 (états et refus) ;
//           docs/DESIGN_SYSTEM.md §5.61, §5.59 (motif de bloc, éteinte sans motif pendant la lecture), §5.27
//
// La base est simulée en mémoire, au format de PostgREST : une écriture rend ses lignes, ou une erreur, ou zéro ligne.
// Le refus réel par la RLS est prouvé hors interface (`e2e/api/membres.spec.ts`) ; ici, l'écran et sa traduction.

import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it } from 'vitest'
import type { Capacite } from '../lib/capacites'
import type { ClientCrm } from '../lib/supabase'
import { FournisseurEspace } from './ContexteEspace'
import { ReglagesMembres } from './ReglagesMembres'

afterEach(cleanup)

type Ligne = { user_id: string; role: string; created_at: string; profiles: { full_name: string | null } | null }
type Reponse = { data: unknown; error: { code?: string; message: string } | null; status: number }

const SEED: readonly Ligne[] = [
	{ user_id: 'farida', role: 'viewer', created_at: '2026-09-03T08:00:00Z', profiles: { full_name: 'Farida Nowak' } },
	{ user_id: 'driss', role: 'business_developer', created_at: '2026-09-02T08:00:00Z', profiles: { full_name: 'Driss Lemoine' } },
	{ user_id: 'camille', role: 'admin', created_at: '2026-09-01T08:00:00Z', profiles: { full_name: 'Camille Aubert' } },
	{ user_id: 'anonyme', role: 'viewer', created_at: '2026-09-04T08:00:00Z', profiles: null },
]

/**
 * Une base en mémoire. `refus` force la réponse d'une écriture : une erreur, ou zéro ligne. `lecture` force celle de la
 * lecture des membres.
 */
function base(options: { refus?: Reponse; lecture?: Reponse } = {}) {
	let lignes = SEED.map((ligne) => ({ ...ligne }))
	const ecritures: { operation: string; charge?: unknown; filtres: Record<string, unknown> }[] = []
	const client = {
		from(table: string) {
			let operation = 'select'
			let charge: unknown
			const filtres: Record<string, unknown> = {}
			const chaine: Record<string, unknown> = {
				select: () => chaine,
				order: () => chaine,
				eq: (colonne: string, valeur: unknown) => {
					filtres[colonne] = valeur
					return chaine
				},
				update: (valeur: unknown) => {
					operation = 'update'
					charge = valeur
					return chaine
				},
				delete: () => {
					operation = 'delete'
					return chaine
				},
				then(ok: (r: Reponse) => unknown) {
					return Promise.resolve(repondre()).then(ok)
				},
			}
			const repondre = (): Reponse => {
				if (table === 'workspaces') return { data: [{ id: 'w', name: 'Atelier Nord', slug: 'atelier-nord' }], error: null, status: 200 }
				if (operation === 'select') return options.lecture ?? { data: lignes, error: null, status: 200 }
				ecritures.push({ operation, charge, filtres })
				if (options.refus !== undefined) return options.refus
				const visees = lignes.filter((ligne) => ligne.user_id === filtres.user_id)
				if (operation === 'update') visees.forEach((ligne) => Object.assign(ligne, charge))
				if (operation === 'delete') lignes = lignes.filter((ligne) => !visees.includes(ligne))
				return { data: visees.map((ligne) => ({ user_id: ligne.user_id })), error: null, status: 200 }
			}
			return chaine
		},
	}
	return { client: client as unknown as ClientCrm, ecritures }
}

function monter(client: ClientCrm, administration: Capacite = 'permise', idUtilisateur = 'camille') {
	render(
		<MemoryRouter>
			<FournisseurEspace valeur={{ idWorkspace: 'w', estAdmin: administration === 'permise', capacites: { administration, edition: 'permise' } }}>
				<ReglagesMembres client={client} idUtilisateur={idUtilisateur} />
			</FournisseurEspace>
		</MemoryRouter>,
	)
}

const noms = () => screen.getAllByTestId('ligne-membre').map((ligne) => within(ligne).getAllByRole('cell')[0]?.textContent)

describe('la liste des membres', () => {
	it('administrateurs d’abord, puis par nom ; un profil sans nom est nommé ; aucune colonne de superadministrateur', async () => {
		monter(base().client)
		await screen.findByTestId('tableau-membres')
		expect(noms()).toEqual(['Camille Aubert', 'Compte sans nom', 'Driss Lemoine', 'Farida Nowak'])
		expect(screen.getAllByRole('columnheader').map((th) => th.textContent)).toEqual(['Nom', 'Rôle', 'Depuis', 'Commandes'])
		expect(screen.queryByTestId('motif-membres')).toBeNull()
	})

	it('une lecture en échec rend l’erreur avec sa reprise, jamais une liste vide', async () => {
		monter(base({ lecture: { data: null, error: { message: 'x' }, status: 500 } }).client)
		expect(await screen.findByRole('button', { name: 'Réessayer' })).toBeTruthy()
		expect(screen.queryByTestId('tableau-membres')).toBeNull()
	})
})

describe('les commandes et la capacité d’administration (§5.59)', () => {
	it('refusée : un motif en tête, chaque commande éteinte, lisible, et le citant', async () => {
		monter(base().client, 'refusee', 'farida')
		await screen.findByTestId('tableau-membres')
		const motif = screen.getByTestId('motif-membres')
		expect(motif.textContent).toContain('réservées aux administrateurs de l’espace')
		const role = screen.getByLabelText('Rôle de Driss Lemoine') as HTMLSelectElement
		const retirer = screen.getByRole('button', { name: 'Retirer Driss Lemoine de l’espace' }) as HTMLButtonElement
		for (const commande of [role, retirer]) {
			expect(commande.disabled).toBe(true)
			expect(commande.getAttribute('aria-describedby')).toBe(motif.id)
		}
		expect(role.value).toBe('business_developer')
	})

	it('en lecture : éteinte sans motif ; inconnue : offerte', async () => {
		monter(base().client, 'en-lecture')
		const retirer = (await screen.findByRole('button', { name: 'Retirer Driss Lemoine de l’espace' })) as HTMLButtonElement
		expect(retirer.disabled).toBe(true)
		expect(retirer.hasAttribute('aria-describedby')).toBe(false)
		expect(screen.queryByTestId('motif-membres')).toBeNull()
		cleanup()
		monter(base().client, 'inconnue')
		expect(((await screen.findByRole('button', { name: 'Retirer Driss Lemoine de l’espace' })) as HTMLButtonElement).disabled).toBe(false)
	})
})

describe('changer un rôle', () => {
	it('écrit au choix dans workspace_members, annonce le succès, et relit', async () => {
		const { client, ecritures } = base()
		monter(client)
		const utilisateur = userEvent.setup()
		await utilisateur.selectOptions(await screen.findByLabelText('Rôle de Farida Nowak'), 'business_developer')
		expect((await screen.findByTestId('message-membres')).textContent).toBe('Rôle de Farida Nowak modifié.')
		expect(screen.getByTestId('message-membres').getAttribute('role')).toBe('status')
		expect(ecritures).toEqual([{ operation: 'update', charge: { role: 'business_developer' }, filtres: { workspace_id: 'w', user_id: 'farida' } }])
		await waitFor(() => expect((screen.getByLabelText('Rôle de Farida Nowak') as HTMLSelectElement).value).toBe('business_developer'))
	})

	it('le dernier administrateur : le refus de la base est traduit, et le rôle relu revient', async () => {
		monter(base({ refus: { data: null, error: { code: '23514', message: 'last_workspace_admin' }, status: 400 } }).client)
		const utilisateur = userEvent.setup()
		await utilisateur.selectOptions(await screen.findByLabelText('Rôle de Camille Aubert'), 'viewer')
		const message = await screen.findByTestId('message-membres')
		expect(message.getAttribute('role')).toBe('alert')
		expect(message.textContent).toContain('Un espace garde au moins un administrateur')
		await waitFor(() => expect((screen.getByLabelText('Rôle de Camille Aubert') as HTMLSelectElement).value).toBe('admin'))
	})

	it('zéro ligne rendue : « rien n’a changé », jamais un succès', async () => {
		monter(base({ refus: { data: [], error: null, status: 200 } }).client)
		const utilisateur = userEvent.setup()
		await utilisateur.selectOptions(await screen.findByLabelText('Rôle de Farida Nowak'), 'admin')
		expect((await screen.findByTestId('message-membres')).textContent).toContain('Rien n’a changé')
	})

	it('un refus de droit (403) dit que le geste est réservé aux administrateurs', async () => {
		monter(base({ refus: { data: null, error: { code: '42501', message: 'denied' }, status: 403 } }).client)
		const utilisateur = userEvent.setup()
		await utilisateur.selectOptions(await screen.findByLabelText('Rôle de Farida Nowak'), 'admin')
		expect((await screen.findByTestId('message-membres')).textContent).toBe('Ce geste est réservé aux administrateurs de l’espace.')
	})
})

describe('retirer un membre', () => {
	it('confirme en nommant la personne et l’espace, supprime, annonce, et relit', async () => {
		const { client, ecritures } = base()
		monter(client)
		const utilisateur = userEvent.setup()
		await utilisateur.click(await screen.findByRole('button', { name: 'Retirer Driss Lemoine de l’espace' }))
		const confirmation = screen.getByRole('group', { name: /^Retirer Driss Lemoine de l’espace\s«\sAtelier Nord\s»\s\?$/ })
		expect(confirmation.textContent).toContain('Ses droits fins sur les tracks et les channels')
		await utilisateur.click(within(confirmation).getByRole('button', { name: 'Retirer de l’espace' }))
		expect((await screen.findByTestId('message-membres')).textContent).toBe('Driss Lemoine a été retiré de l’espace.')
		expect(ecritures).toEqual([{ operation: 'delete', charge: undefined, filtres: { workspace_id: 'w', user_id: 'driss' } }])
		await waitFor(() => expect(noms()).not.toContain('Driss Lemoine'))
		expect(screen.queryByRole('group')).toBeNull()
	})

	it('un retrait refusé ferme la confirmation, garde la ligne, et dit le refus', async () => {
		monter(base({ refus: { data: null, error: { code: '23514', message: 'last_workspace_admin' }, status: 400 } }).client)
		const utilisateur = userEvent.setup()
		await utilisateur.click(await screen.findByRole('button', { name: 'Retirer Camille Aubert de l’espace' }))
		await utilisateur.click(within(screen.getByRole('group')).getByRole('button', { name: 'Retirer de l’espace' }))
		expect((await screen.findByTestId('message-membres')).textContent).toContain('Un espace garde au moins un administrateur')
		expect(screen.queryByRole('group')).toBeNull()
		expect(noms()).toContain('Camille Aubert')
	})

	it('soi-même : la confirmation dit en clair que l’on perd l’accès', async () => {
		monter(base().client)
		const utilisateur = userEvent.setup()
		await utilisateur.click(await screen.findByRole('button', { name: 'Retirer Camille Aubert de l’espace' }))
		expect(screen.getByRole('group').textContent).toContain('C’est votre propre compte')
	})

	it('Échap annule, n’écrit rien, et rend le focus à la commande', async () => {
		const { client, ecritures } = base()
		monter(client)
		const utilisateur = userEvent.setup()
		const commande = await screen.findByRole('button', { name: 'Retirer Farida Nowak de l’espace' })
		await utilisateur.click(commande)
		await utilisateur.keyboard('{Escape}')
		expect(screen.queryByRole('group')).toBeNull()
		await waitFor(() => expect(document.activeElement).toBe(commande))
		expect(ecritures).toEqual([])
	})
})
