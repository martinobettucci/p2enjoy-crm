// @verifies CRM-058 (docs/BACKLOG.md) — tranche 2 : « Ajouter Cci », « Joindre des fichiers », le dépôt immédiat, le
//           retrait, les plafonds qui éteignent l'envoi avec leur motif, l'annulation qui retire les dépôts
// @verifies docs/SPEC-mail-subsystem.md §19 bis.2, §19 bis.5 ; docs/DESIGN_SYSTEM.md §5.4 sexies ; décisions 719 et 720
// @verifies INC-335 (docs/BACKLOG.md, correctif de la décision 805, T2) — l'adresse présélectionnée est l'identité par
//           défaut de la personne ; l'identité de service n'est pas proposée (docs/SPEC-mail-subsystem.md §19.4, §22.14)
// @verifies CRM-128 (docs/BACKLOG.md) — tranche T4 : la relecture d'un mail préparé — ouverte et préremplie, identité
//           proposée, copie et Cci, mise en file par `send_email_draft`, « Écarter » et sa confirmation
//           (docs/SPEC-mails-prepares.md §6.1 ; docs/DESIGN_SYSTEM.md §5.90)
// @verifies CRM-143 (docs/BACKLOG.md) — tranche T4 : la relecture précharge les pièces du mail préparé ; elles partent avec
//           lui, et une pièce retirée n'est pas effacée du stockage (docs/SPEC-pieces-jointes.md §17.6 ;
//           docs/DESIGN_SYSTEM.md §5.95)
//
// LE VRAI COMPOSANT, AVEC UN CLIENT FACTICE qui journalise ce que l'écran demande au stockage et à la file. Le parcours
// réel — dépôt par l'API de stockage, mise en file, remise — est prouvé par `e2e/ui/envoi-pieces-jointes.spec.ts`.

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const injecte: { appels: Array<[string, ...unknown[]]>; identites: unknown[] } = { appels: [], identites: [] }

/** Les identités du seed vues par une administratrice : le service, et deux des siennes, la seconde par défaut. */
const IDENTITES_ADMINISTRATRICE = [
	{ id: 'id-service', label: 'Identité de service', from_address: 'systeme@crm.p2enjoy.test', owner_id: null, is_default: true },
	{ id: 'id-1', label: 'Envoi A', from_address: 'a@p2enjoy.test', owner_id: 'personne-1', is_default: false },
	{ id: 'id-2', label: 'Envoi B', from_address: 'admin@p2enjoy.test', owner_id: 'personne-1', is_default: true },
]

const client = {
	from: (table: string) => ({
		select: () => ({
			eq: () => ({
				limit: () => Promise.resolve({ data: [{ workspace_id: 'espace-1' }], error: null }),
			}),
			order: () =>
				Promise.resolve({
					data: table === 'mail_outbound_identities' ? injecte.identites : [],
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
	injecte.identites = IDENTITES_ADMINISTRATRICE
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

describe('FormulaireEnvoi — l’adresse présélectionnée (décision 805, INC-335)', () => {
	it('présélectionne l’identité PAR DÉFAUT de la personne, et ne propose pas celle du service', async () => {
		await ouvrir()
		const selecteur = screen.getByRole('combobox') as HTMLSelectElement
		expect(selecteur.value).toBe('id-2')
		const options = Array.from(selecteur.options).map((option) => option.value)
		expect(options).toEqual(['id-1', 'id-2'])
		expect(screen.queryByText(/systeme@crm\.p2enjoy\.test/)).toBeNull()

		await userEvent.type(screen.getByLabelText('Message'), 'Bonjour')
		await userEvent.click(screen.getByTestId('envoi-valider'))
		await waitFor(() => expect(injecte.appels.some(([genre]) => genre === 'rpc')).toBe(true))
		const [, , args] = injecte.appels.find(([genre]) => genre === 'rpc') as [string, string, Record<string, unknown>]
		expect(args.p_identity_id).toBe('id-2')
	})

	it('sans défaut et avec plusieurs identités, ne présélectionne rien et le montre', async () => {
		injecte.identites = IDENTITES_ADMINISTRATRICE.map((identite) => ({ ...identite, is_default: false }))
		await ouvrir()
		const selecteur = screen.getByRole('combobox') as HTMLSelectElement
		expect(selecteur.value).toBe('')
		expect(selecteur.options[0]?.textContent).toBe('Choisir une adresse')
	})

	it('sans aucune identité à soi, dit où en déclarer une — l’identité de service ne la remplace pas', async () => {
		injecte.identites = [IDENTITES_ADMINISTRATRICE[0]]
		render(<FormulaireEnvoi idCard="card-1" destinataire="client@exemple.fr" objet="Devis" />)
		await userEvent.click(screen.getByTestId('envoi-ouvrir'))
		expect(
			await screen.findByText(
				"Aucune adresse d'expédition ne vous est attribuée : déclarez la vôtre dans Réglages ▸ Identités d'expédition.",
			),
		).toBeTruthy()
		expect(screen.queryByRole('combobox')).toBeNull()
	})
})

// `CRM-128` T4 — la relecture d'un mail préparé (docs/SPEC-mails-prepares.md §6.1 ; docs/DESIGN_SYSTEM.md §5.90).
const valeur = (element: HTMLElement): string => (element as HTMLInputElement).value

describe('FormulaireEnvoi — la relecture d’un mail préparé', () => {
	const MAIL = {
		id: 'mail-1',
		idCard: 'card-1',
		titreCard: 'Refonte',
		idIdentite: 'id-1',
		repondA: 'msg-1',
		destinataires: ['client@exemple.fr', 'autre@exemple.fr'],
		copies: ['copie@exemple.fr'],
		copiesCachees: ['direction@exemple.fr'],
		objet: 'Proposition',
		corps: 'Bonjour, voici notre proposition.',
		origine: 'mcp' as const,
		creeLe: '2026-11-03T10:00:00Z',
		pieces: [] as readonly { chemin: string; nom: string; taille: number }[],
	}

	it('s’ouvre d’emblée, prérempli, l’identité PROPOSÉE retenue plutôt que le défaut, la copie et la Cci rendues', async () => {
		render(<FormulaireEnvoi idCard="card-1" mailPrepare={MAIL} />)
		await waitFor(() => expect(valeur(screen.getByRole('combobox'))).toBe('id-1'))
		expect(screen.queryByTestId('envoi-ouvrir')).toBeNull()
		expect(valeur(screen.getByLabelText('Destinataires'))).toBe('client@exemple.fr, autre@exemple.fr')
		expect(valeur(screen.getByLabelText('Copie'))).toBe('copie@exemple.fr')
		expect(valeur(screen.getByLabelText('Copie cachée (Cci)'))).toBe('direction@exemple.fr')
		expect(valeur(screen.getByLabelText('Objet'))).toBe('Proposition')
		expect(valeur(screen.getByLabelText('Message'))).toBe('Bonjour, voici notre proposition.')
		// La relecture ne vole pas le focus vers la Cci.
		expect(document.activeElement).not.toBe(screen.getByLabelText('Copie cachée (Cci)'))
		expect(screen.queryByRole('button', { name: 'Annuler' })).toBeNull()
	})

	it('met en file par `send_email_draft` avec le contenu RELU, jamais par `queue_outbound_email`', async () => {
		const envoye = vi.fn()
		render(<FormulaireEnvoi idCard="card-1" mailPrepare={MAIL} onEnvoye={envoye} />)
		await waitFor(() => expect(valeur(screen.getByRole('combobox'))).toBe('id-1'))
		await userEvent.clear(screen.getByLabelText('Message'))
		await userEvent.type(screen.getByLabelText('Message'), 'Corps relu')
		await userEvent.click(screen.getByTestId('envoi-valider'))
		await waitFor(() => expect(envoye).toHaveBeenCalled())
		expect(injecte.appels).toEqual([
			[
				'rpc',
				'send_email_draft',
				{
					p_draft_id: 'mail-1',
					p_identity_id: 'id-1',
					p_to: ['client@exemple.fr', 'autre@exemple.fr'],
					p_subject: 'Proposition',
					p_body_text: 'Corps relu',
					p_cc: ['copie@exemple.fr'],
					p_bcc: ['direction@exemple.fr'],
					p_attachments: [],
				},
			],
		])
	})

	it('« Écarter » demande une confirmation dans le flux, qui prend le focus, et Échap la referme en rendant le focus', async () => {
		const ecarte = vi.fn()
		render(<FormulaireEnvoi idCard="card-1" mailPrepare={MAIL} onEcarte={ecarte} />)
		await screen.findByRole('combobox')
		await userEvent.click(screen.getByTestId('mail-prepare-ecarter'))
		expect(document.activeElement).toBe(screen.getByTestId('mail-prepare-ecarter-confirmer'))
		await userEvent.keyboard('{Escape}')
		expect(screen.queryByTestId('mail-prepare-confirmation-ecart')).toBeNull()
		expect(document.activeElement).toBe(screen.getByTestId('mail-prepare-ecarter'))
		await userEvent.click(screen.getByTestId('mail-prepare-ecarter'))
		await userEvent.click(screen.getByTestId('mail-prepare-ecarter-confirmer'))
		await waitFor(() => expect(ecarte).toHaveBeenCalled())
		expect(injecte.appels).toEqual([['rpc', 'discard_email_draft', { p_draft_id: 'mail-1' }]])
	})

	it('CRM-143 : précharge les pièces du mail préparé, les envoie avec lui, et n’efface pas celle qu’on retire', async () => {
		const envoye = vi.fn()
		const pieces = [
			{ chemin: 'e/p/u1/devis.pdf', nom: 'devis.pdf', taille: 1200 },
			{ chemin: 'e/p/u2/annexe.pdf', nom: 'annexe.pdf', taille: 800 },
		]
		render(<FormulaireEnvoi idCard="card-1" mailPrepare={{ ...MAIL, pieces }} onEnvoye={envoye} />)
		await waitFor(() => expect(valeur(screen.getByRole('combobox'))).toBe('id-1'))
		expect(screen.getAllByTestId('envoi-piece').map((ligne) => ligne.getAttribute('data-etat'))).toEqual(['pret', 'pret'])
		await userEvent.click(screen.getByRole('button', { name: 'Retirer annexe.pdf' }))
		expect(screen.getAllByTestId('envoi-piece')).toHaveLength(1)
		expect(injecte.appels.filter(([genre]) => genre === 'remove')).toEqual([])
		await userEvent.click(screen.getByTestId('envoi-valider'))
		await waitFor(() => expect(envoye).toHaveBeenCalled())
		const envoi = injecte.appels.find(([genre, nom]) => genre === 'rpc' && nom === 'send_email_draft')
		expect((envoi?.[2] as { p_attachments: string[] }).p_attachments).toEqual(['e/p/u1/devis.pdf'])
	})

	it('sans identité proposée encore à soi, retombe sur la présélection du défaut', async () => {
		render(<FormulaireEnvoi idCard="card-1" mailPrepare={{ ...MAIL, idIdentite: 'id-service' }} />)
		await waitFor(() => expect(valeur(screen.getByRole('combobox'))).toBe('id-2'))
	})
})
