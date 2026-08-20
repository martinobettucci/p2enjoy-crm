// @verifies CRM-088 (docs/BACKLOG.md) — écran de configuration des comptes entrants IMAP
// @verifies docs/SPEC-mail-subsystem.md §21.3 (ce que l'écran lit), §21.4 (le formulaire et son
//           sélecteur), §21.5 (le mot de passe n'est jamais affiché, un champ vide conserve),
//           §21.7 (le refus est traduit, jamais recopié), §21.8 (les états)
// @verifies docs/DESIGN_SYSTEM.md §5.34 (cette surface), §5.8 (états), §5.13 (focus)
//
// Ces preuves montent le VRAI écran avec un client factice qui enregistre les requêtes émises,
// comme `EtatMessagerie.test.tsx`. Le parcours connecté complet relève de
// `e2e/ui/reglages-comptes-mail.spec.ts`, qui ne peut pas être exécuté sans la pile.

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router'
import { ReglagesComptesMail } from './ReglagesComptesMail'
import type { ClientCrm } from '../lib/supabase'

afterEach(cleanup)

const WORKSPACE = '5eed0000-0000-4000-8000-000000000001'
const CAMILLE = '5eed0000-0000-4000-8000-000000000011'
const DRISS = '5eed0000-0000-4000-8000-000000000012'

type Reponse = { data: unknown; error: { message: string } | null; status: number }

const COMPTES = [
	{
		id: 'c-1',
		label: 'Boîte de Camille Aubert',
		owner_id: CAMILLE,
		imap_host: 'stalwart',
		imap_port: 143,
		imap_security: 'none',
		imap_username: 'admin@p2enjoy.test',
		status: 'pending',
		last_error: null,
		last_checked_at: null,
	},
	{
		id: 'c-2',
		label: 'Boîte système du workspace',
		owner_id: null,
		imap_host: 'stalwart',
		imap_port: 143,
		imap_security: 'starttls',
		imap_username: 'systeme@crm.p2enjoy.test',
		status: 'error',
		last_error: 'auth_failed',
		last_checked_at: '2026-08-20T09:00:00Z',
	},
]

/** Client factice : un workspace, une liste de comptes, et un RPC dont la réponse est fournie. */
function client({
	comptes = { data: COMPTES, error: null, status: 200 },
	rpc = { data: 'c-1', error: null, status: 200 },
	espionRpc,
}: {
	comptes?: Reponse
	rpc?: Reponse
	espionRpc?: (fonction: string, arguments_: Record<string, unknown>) => void
} = {}): ClientCrm {
	return {
		from: (table: string) => {
			if (table === 'workspaces') {
				return {
					select: () => ({
						order: () =>
							Promise.resolve({
								data: [{ id: WORKSPACE, name: 'P2Enjoy', slug: 'p2enjoy' }],
								error: null,
								status: 200,
							}),
					}),
				}
			}
			if (table === 'mail_inbound_accounts') {
				return { select: () => ({ order: () => Promise.resolve(comptes) }) }
			}
			throw new Error(`table inattendue : ${table}`)
		},
		rpc: (fonction: string, arguments_: Record<string, unknown>) => {
			espionRpc?.(fonction, arguments_)
			return Promise.resolve(rpc)
		},
	} as unknown as ClientCrm
}

function monter(c: ClientCrm, idUtilisateur: string | null = CAMILLE) {
	return render(
		<MemoryRouter>
			<ReglagesComptesMail client={c} idUtilisateur={idUtilisateur} />
		</MemoryRouter>,
	)
}

describe('ReglagesComptesMail — la liste', () => {
	it('rend une ligne par boîte visible, avec sa connexion et son état', async () => {
		monter(client())

		expect(await screen.findByTestId('liste-comptes-mail')).toBeTruthy()
		expect(screen.getAllByTestId('ligne-compte-configuration')).toHaveLength(2)
		expect(screen.getAllByTestId('connexion-compte')[0]?.textContent).toBe('stalwart:143')
		// Le mode de sécurité est un MOT, jamais une teinte (§5.34).
		expect(screen.getByText('STARTTLS')).toBeTruthy()
		expect(screen.getByText('En attente')).toBeTruthy()
		expect(screen.getByText('En erreur')).toBeTruthy()
	})

	// Un cinquième état serait un défaut de la contrainte : la pilule est ABSENTE, jamais remplie
	// du code brut (§5.34, règle du §5.14).
	it('n’affiche AUCUNE pilule pour un état que la contrainte n’admet pas', async () => {
		monter(
			client({
				comptes: {
					data: [{ ...COMPTES[0], status: 'inventé' }],
					error: null,
					status: 200,
				},
			}),
		)

		expect(await screen.findByTestId('liste-comptes-mail')).toBeTruthy()
		expect(screen.queryByText('inventé')).toBeNull()
	})

	it('sur une erreur de lecture, propose une reprise qui RELIT réellement', async () => {
		let appels = 0
		const c = {
			from: (table: string) => {
				if (table === 'workspaces') {
					return {
						select: () => ({
							order: () =>
								Promise.resolve({ data: [{ id: WORKSPACE, name: 'P', slug: 'p' }], error: null, status: 200 }),
						}),
					}
				}
				appels += 1
				return {
					select: () => ({
						order: () =>
							Promise.resolve(
								appels === 1
									? { data: null, error: { message: 'boom' }, status: 500 }
									: { data: COMPTES, error: null, status: 200 },
							),
					}),
				}
			},
		} as unknown as ClientCrm

		monter(c)
		const reprise = await screen.findByText('Réessayer')
		await userEvent.click(reprise)

		expect(await screen.findByTestId('liste-comptes-mail')).toBeTruthy()
		expect(appels).toBe(2)
	})

	// L'état vide PORTE le geste — §21.8, §5.13. C'est l'écart assumé avec l'écran d'état (§5.14),
	// qui n'agit pas et n'offre donc rien.
	it('l’état vide porte la commande de configuration', async () => {
		monter(client({ comptes: { data: [], error: null, status: 200 } }))

		expect(await screen.findByText('Aucune boîte configurée')).toBeTruthy()
		expect(screen.getByTestId('ouvrir-configuration')).toBeTruthy()
	})
})

describe('ReglagesComptesMail — le formulaire', () => {
	it('est REPLIÉ par défaut, et s’ouvre préremplí de la boîte visée', async () => {
		monter(client())
		await screen.findByTestId('liste-comptes-mail')

		expect(screen.queryByTestId('formulaire-compte-mail')).toBeNull()

		await userEvent.click(screen.getAllByTestId('configurer-compte')[1] as HTMLElement)

		const libelle = (await screen.findByTestId('champ-libelle-compte')) as HTMLInputElement
		expect(libelle.value).toBe('Boîte système du workspace')
		expect((screen.getByTestId('champ-port') as HTMLInputElement).value).toBe('143')
		expect((screen.getByTestId('champ-securite') as HTMLSelectElement).value).toBe('starttls')
	})

	// §21.5 : le mot de passe n'a NI valeur affichée, NI point de substitution.
	it('n’affiche jamais le mot de passe : le champ est vide, sur toutes les boîtes', async () => {
		monter(client())
		await screen.findByTestId('liste-comptes-mail')
		await userEvent.click(screen.getAllByTestId('configurer-compte')[0] as HTMLElement)

		const champ = (await screen.findByTestId('champ-mot-de-passe')) as HTMLInputElement
		expect(champ.value).toBe('')
		expect(champ.type).toBe('password')
	})

	it('le sélecteur énumère les boîtes visibles, plus celle que l’appelant peut créer', async () => {
		// Driss ne voit que la sienne : il doit pouvoir viser la boîte système, que la base lui
		// refusera — l'écran ne calcule aucun droit (§21.4).
		monter(
			client({ comptes: { data: [{ ...COMPTES[0], owner_id: DRISS }], error: null, status: 200 } }),
			DRISS,
		)
		await screen.findByTestId('liste-comptes-mail')
		await userEvent.click(screen.getByTestId('configurer-compte'))

		const selecteur = (await screen.findByTestId('champ-boite')) as HTMLSelectElement
		const libelles = [...selecteur.options].map((option) => option.textContent)
		expect(libelles).toContain('Boîte de Camille Aubert')
		expect(libelles).toContain('Boîte système de l’espace de travail')
		// AUCUNE option vide en tête — écart assumé avec le §5.22.
		expect(libelles.some((libelle) => libelle === '')).toBe(false)
	})

	it('changer de boîte visée REMPLACE le préremplissage', async () => {
		monter(client())
		await screen.findByTestId('liste-comptes-mail')
		await userEvent.click(screen.getAllByTestId('configurer-compte')[0] as HTMLElement)

		const selecteur = (await screen.findByTestId('champ-boite')) as HTMLSelectElement
		await userEvent.selectOptions(selecteur, 'systeme')

		expect((screen.getByTestId('champ-libelle-compte') as HTMLInputElement).value).toBe(
			'Boîte système du workspace',
		)
	})

	it('envoie la saisie SANS mot de passe quand le champ est resté vide', async () => {
		const espion = vi.fn()
		monter(client({ espionRpc: espion }))
		await screen.findByTestId('liste-comptes-mail')
		await userEvent.click(screen.getAllByTestId('configurer-compte')[0] as HTMLElement)
		await userEvent.click(await screen.findByTestId('valider-compte-mail'))

		await waitFor(() => expect(espion).toHaveBeenCalled())
		const [fonction, arguments_] = espion.mock.calls[0] as [string, Record<string, unknown>]
		expect(fonction).toBe('upsert_mail_inbound_account')
		expect(Object.hasOwn(arguments_, 'p_password')).toBe(false)
		expect(arguments_['p_owner_id']).toBe(CAMILLE)
	})

	it('un succès referme le formulaire et RELIT la liste', async () => {
		let lectures = 0
		const c = {
			from: (table: string) => {
				if (table === 'workspaces') {
					return {
						select: () => ({
							order: () =>
								Promise.resolve({ data: [{ id: WORKSPACE, name: 'P', slug: 'p' }], error: null, status: 200 }),
						}),
					}
				}
				lectures += 1
				return {
					select: () => ({ order: () => Promise.resolve({ data: COMPTES, error: null, status: 200 }) }),
				}
			},
			rpc: () => Promise.resolve({ data: 'c-1', error: null, status: 200 }),
		} as unknown as ClientCrm

		monter(c)
		await screen.findByTestId('liste-comptes-mail')
		await userEvent.click(screen.getAllByTestId('configurer-compte')[0] as HTMLElement)
		await userEvent.click(await screen.findByTestId('valider-compte-mail'))

		await waitFor(() => expect(screen.queryByTestId('formulaire-compte-mail')).toBeNull())
		expect(lectures).toBe(2)
	})
})

describe('ReglagesComptesMail — les refus', () => {
	// §21.7 : une PHRASE du produit, jamais le corps d'erreur du serveur — qui divulguerait
	// `secret_id` (INC-193).
	it('traduit le refus d’autorisation et ne recopie PAS le message du serveur', async () => {
		monter(
			client({
				rpc: { data: null, error: { message: 'forbidden' }, status: 403 },
			}),
		)
		await screen.findByTestId('liste-comptes-mail')
		await userEvent.click(screen.getAllByTestId('configurer-compte')[0] as HTMLElement)
		await userEvent.click(await screen.findByTestId('valider-compte-mail'))

		const refus = await screen.findByTestId('refus-compte-mail')
		expect(refus.getAttribute('role')).toBe('alert')
		expect(refus.textContent).toContain('Vous ne pouvez pas configurer cette boîte')
		expect(refus.textContent).not.toContain('forbidden')
	})

	it('traduit un refus de contrainte SANS jamais montrer la ligne fautive', async () => {
		const message =
			'new row for relation "mail_inbound_accounts" violates check constraint "mail_inbound_accounts_port_borne"'
		monter(client({ rpc: { data: null, error: { message }, status: 400 } }))
		await screen.findByTestId('liste-comptes-mail')
		await userEvent.click(screen.getAllByTestId('configurer-compte')[0] as HTMLElement)
		await userEvent.click(await screen.findByTestId('valider-compte-mail'))

		const refus = await screen.findByTestId('refus-compte-mail')
		expect(refus.textContent).toContain('entier compris entre 1 et 65535')
		expect(refus.textContent).not.toContain('mail_inbound_accounts')
		expect(refus.textContent).not.toContain('violates')
	})

	it('un refus LAISSE le formulaire ouvert et n’efface pas la saisie', async () => {
		monter(client({ rpc: { data: null, error: { message: 'forbidden' }, status: 403 } }))
		await screen.findByTestId('liste-comptes-mail')
		await userEvent.click(screen.getAllByTestId('configurer-compte')[0] as HTMLElement)
		const libelle = (await screen.findByTestId('champ-libelle-compte')) as HTMLInputElement
		await userEvent.clear(libelle)
		await userEvent.type(libelle, 'Ma boîte corrigée')
		await userEvent.click(screen.getByTestId('valider-compte-mail'))

		await screen.findByTestId('refus-compte-mail')
		expect(screen.getByTestId('formulaire-compte-mail')).toBeTruthy()
		expect((screen.getByTestId('champ-libelle-compte') as HTMLInputElement).value).toBe(
			'Ma boîte corrigée',
		)
	})

	// Le repli nommé du §21.7 : une cause inconnue se dit, elle ne se déguise pas.
	it('nomme un refus dont la cause n’est pas reconnue', async () => {
		monter(client({ rpc: { data: null, error: { message: 'imprévu' }, status: 400 } }))
		await screen.findByTestId('liste-comptes-mail')
		await userEvent.click(screen.getAllByTestId('configurer-compte')[0] as HTMLElement)
		await userEvent.click(await screen.findByTestId('valider-compte-mail'))

		expect((await screen.findByTestId('refus-compte-mail')).textContent).toContain(
			"L'enregistrement a été refusé",
		)
	})
})

describe('ReglagesComptesMail — le clavier', () => {
	// §5.13 : ouvrir un formulaire déplace le focus dans son premier champ, le fermer le rend à la
	// commande qui l'a ouvert — ce retour étant DIFFÉRÉ, la commande étant démontée (§5.25).
	it('entre le focus dans le premier champ, et le rend à la commande à la fermeture', async () => {
		monter(client())
		await screen.findByTestId('liste-comptes-mail')
		const commande = screen.getAllByTestId('configurer-compte')[0] as HTMLElement
		await userEvent.click(commande)

		await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId('champ-boite')))

		await userEvent.click(screen.getByTestId('annuler-compte-mail'))
		await waitFor(() =>
			expect(document.activeElement).toBe(screen.getAllByTestId('configurer-compte')[0]),
		)
	})
})
