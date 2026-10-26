// @verifies CRM-058 (docs/BACKLOG.md) — tranche 2 : « Ajouter Cci », « Joindre des fichiers », le dépôt immédiat, le
//           retrait, les plafonds qui éteignent l'envoi avec leur motif, l'annulation qui retire les dépôts
// @verifies docs/SPEC-mail-subsystem.md §19 bis.2, §19 bis.5 ; docs/DESIGN_SYSTEM.md §5.4 sexies ; décisions 719 et 720
//
// LE VRAI COMPOSANT, AVEC UN CLIENT FACTICE qui journalise ce que l'écran demande au stockage et à la file. Le parcours
// réel — dépôt par l'API de stockage, mise en file, remise — est prouvé par `e2e/ui/envoi-pieces-jointes.spec.ts`.

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const injecte: { appels: Array<[string, ...unknown[]]> } = { appels: [] }

const client = {
	from: (table: string) => ({
		select: () => ({
			eq: () => ({
				limit: () => Promise.resolve({ data: [{ workspace_id: 'espace-1' }], error: null }),
			}),
			order: () =>
				Promise.resolve({
					data: table === 'mail_outbound_identities'
						? [{ id: 'id-1', label: 'Service', from_address: 'contact@p2enjoy.test', owner_id: null }]
						: [],
					error: null,
				}),
		}),
	}),
	rpc: (nom: string, args: unknown) => {
		injecte.appels.push(['rpc', nom, args])
		return Promise.resolve({ data: 'file-1', error: null, status: 200 })
	},
	storage: {
		from: () => ({
			upload: (chemin: string) => {
				injecte.appels.push(['upload', chemin])
				return Promise.resolve({ data: { path: chemin }, error: null })
			},
			remove: (chemins: string[]) => {
				injecte.appels.push(['remove', chemins])
				return Promise.resolve({ data: [], error: null })
			},
		}),
	},
}

vi.mock('../lib/supabase', () => ({ clientCrm: client }))
vi.mock('./Authentification', () => ({
	useAuthentification: () => ({
		etat: { statut: 'authentifie', utilisateur: { id: 'personne-1' } },
		profilCourant: { statut: 'pret', donnees: null },
	}),
}))

const { FormulaireEnvoi } = await import('./FormulaireEnvoi')

beforeEach(() => {
	injecte.appels = []
})
afterEach(cleanup)

async function ouvrir() {
	render(<FormulaireEnvoi idCard="card-1" destinataire="client@exemple.fr" objet="Devis" />)
	await userEvent.click(screen.getByTestId('envoi-ouvrir'))
	await screen.findByRole('combobox')
}

const fichier = (nom: string, octets: number, type = 'text/plain') => new File([new Uint8Array(octets)], nom, { type })

describe('FormulaireEnvoi — copie cachée et pièces jointes (§19 bis)', () => {
	it('« Ajouter Cci » révèle le champ et y met le focus', async () => {
		await ouvrir()
		expect(screen.queryByLabelText('Copie cachée (Cci)')).toBeNull()
		await userEvent.click(screen.getByRole('button', { name: 'Ajouter Cci' }))
		expect(document.activeElement).toBe(screen.getByLabelText('Copie cachée (Cci)'))
	})

	it('dépose chaque fichier dès qu’il est choisi, dans `<espace>/<personne>/…`, puis l’envoie avec la Cci', async () => {
		await ouvrir()
		await userEvent.click(screen.getByRole('button', { name: 'Ajouter Cci' }))
		await userEvent.type(screen.getByLabelText('Copie cachée (Cci)'), 'direction@exemple.fr')
		await userEvent.upload(screen.getByTestId('envoi-fichiers'), fichier('Devis été.pdf', 2048, 'application/pdf'))
		await waitFor(() => expect(screen.getByTestId('envoi-piece').getAttribute('data-etat')).toBe('pret'))
		const [, chemin] = injecte.appels.find(([genre]) => genre === 'upload') as [string, string]
		expect(chemin).toMatch(/^espace-1\/personne-1\/[0-9a-f-]{36}\/Devis ete\.pdf$/)
		expect(screen.getByTestId('envoi-pieces-total').textContent).toBe('1 fichier, 2 Ko sur 10 Mo')

		await userEvent.type(screen.getByLabelText('Message'), 'Bonjour')
		await userEvent.click(screen.getByTestId('envoi-valider'))
		await waitFor(() => expect(injecte.appels.some(([genre]) => genre === 'rpc')).toBe(true))
		const [, , args] = injecte.appels.find(([genre]) => genre === 'rpc') as [string, string, Record<string, unknown>]
		expect(args.p_bcc).toEqual(['direction@exemple.fr'])
		expect(args.p_attachments).toEqual([chemin])
		// LES DÉPÔTS APPARTIENNENT À L'ENVOI : rien n'est retiré après la mise en file.
		expect(injecte.appels.some(([genre]) => genre === 'remove')).toBe(false)
	})

	it('retirer une pièce retire son dépôt', async () => {
		await ouvrir()
		await userEvent.upload(screen.getByTestId('envoi-fichiers'), fichier('note.txt', 10))
		await waitFor(() => expect(screen.getByTestId('envoi-piece').getAttribute('data-etat')).toBe('pret'))
		await userEvent.click(screen.getByRole('button', { name: 'Retirer note.txt' }))
		expect(screen.queryByTestId('envoi-piece')).toBeNull()
		expect(injecte.appels.filter(([genre]) => genre === 'remove')).toHaveLength(1)
	})

	it('au-delà de dix fichiers, l’envoi s’éteint et dit pourquoi', async () => {
		await ouvrir()
		await userEvent.upload(
			screen.getByTestId('envoi-fichiers'),
			Array.from({ length: 11 }, (_, rang) => fichier(`f${rang}.txt`, 1)),
		)
		await waitFor(() => expect(screen.getAllByTestId('envoi-piece')).toHaveLength(11))
		await waitFor(() => expect((screen.getByTestId('envoi-valider') as HTMLButtonElement).disabled).toBe(true))
		expect(screen.getByText('Retirez des fichiers : 10 au plus par message.')).toBeTruthy()
		expect(screen.getByTestId('envoi-valider').getAttribute('aria-describedby')).toContain('envoi-blocage')
	})

	it('annuler retire les dépôts du formulaire', async () => {
		await ouvrir()
		await userEvent.upload(screen.getByTestId('envoi-fichiers'), [fichier('a.txt', 1), fichier('b.txt', 1)])
		await waitFor(() =>
			expect(screen.getAllByTestId('envoi-piece').every((p) => p.getAttribute('data-etat') === 'pret')).toBe(true),
		)
		await userEvent.click(screen.getByRole('button', { name: 'Annuler' }))
		expect(injecte.appels.filter(([genre]) => genre === 'remove')).toHaveLength(2)
	})
})
