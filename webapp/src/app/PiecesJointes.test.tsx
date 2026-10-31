// @verifies CRM-074 (docs/BACKLOG.md) — tranche T3 : la liste des pièces et l'aperçu dans le flux — une pièce non saine
//           sans commande, « Aperçu » seulement là où il a un objet, le panneau sous la pièce (PDF et son texte, image,
//           fichier Office en texte seul), les états du texte, un seul panneau ouvert, Échap qui referme et rend le focus,
//           l'échec de lecture et sa reprise, la copie du texte
// @verifies docs/DESIGN_SYSTEM.md §5.80, §5.4, §5.28 ; docs/SPEC-pieces-jointes.md §5, §5.2 (décision 791)
//
// Le composant RÉEL est monté sur un client espion. La pile réelle est éprouvée par `e2e/ui/pieces-jointes.spec.ts`.

import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fr } from '../i18n'
import type { PieceJointe } from '../lib/inbox'
import type { ClientCrm } from '../lib/supabase'
import { ListePiecesJointes } from './PiecesJointes'

const PDF: PieceJointe = { id: 'p1', nom: 'devis.pdf', type: 'application/pdf', taille: 2048, chemin: 'w/m/1', statutAnalyse: 'clean' }
const PNG: PieceJointe = { id: 'p2', nom: 'maquette.png', type: 'image/png', taille: 1411, chemin: 'w/m/2', statutAnalyse: 'clean' }
const DOCX: PieceJointe = {
	id: 'p3',
	nom: 'cahier.docx',
	type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
	taille: 1081,
	chemin: 'w/m/3',
	statutAnalyse: 'clean',
}
const TXT: PieceJointe = { id: 'p4', nom: 'note.txt', type: 'text/plain', taille: 12, chemin: 'w/m/4', statutAnalyse: 'clean' }
const VIRUS: PieceJointe = { id: 'p5', nom: 'virus.exe', type: 'application/x-msdownload', taille: 9, chemin: 'w/m/5', statutAnalyse: 'infected' }

type Textes = Record<string, { text_status: string | null; extracted_text: string | null; text_truncated: boolean }>

function espion(options: { textes?: Textes; fichierEnPanne?: boolean } = {}) {
	const telechargements: string[] = []
	const faux = {
		storage: {
			from: () => ({
				download: async (chemin: string) => {
					telechargements.push(chemin)
					return options.fichierEnPanne ? { data: null, error: { message: 'refusé' } } : { data: new Blob(['%PDF']), error: null }
				},
				createSignedUrl: async () => ({ data: { signedUrl: 'https://signe.example/x' }, error: null }),
			}),
		},
		from: () => {
			let id = ''
			const maillon: Record<string, unknown> = {
				select: () => maillon,
				eq: (_colonne: string, valeur: string) => ((id = valeur), maillon),
				maybeSingle: () => maillon,
				then: (resoudre: (r: unknown) => unknown) => resoudre({ data: options.textes?.[id] ?? null, error: null }),
			}
			return maillon
		},
	} as unknown as ClientCrm
	return { client: faux, telechargements }
}

beforeEach(() => {
	URL.createObjectURL = vi.fn(() => 'blob:apercu')
	URL.revokeObjectURL = vi.fn()
})
afterEach(cleanup)

describe('ListePiecesJointes (docs/DESIGN_SYSTEM.md §5.80)', () => {
	it('une pièce non saine garde son statut et n’a aucune commande ; « Aperçu » n’existe que là où il a un objet', () => {
		render(<ListePiecesJointes pieces={[PDF, TXT, VIRUS]} client={espion().client} />)
		const [pdf, txt, virus] = screen.getAllByTestId('inbox-piece-jointe')
		expect(within(pdf!).getByRole('button', { name: 'Aperçu de devis.pdf' })).toBeDefined()
		expect(within(pdf!).getByTestId('taille-piece').textContent).toBe('2 Ko')
		expect(within(txt!).queryByTestId('apercu-piece')).toBeNull()
		expect(within(txt!).getByRole('button', { name: 'Télécharger note.txt' })).toBeDefined()
		expect(within(virus!).queryAllByRole('button')).toHaveLength(0)
		expect(virus!.textContent).toContain(fr['inbox.attachments.status.infected'])
	})

	it('l’aperçu d’un PDF s’ouvre sous la pièce : le cadre au type forcé, puis le texte extrait et sa copie', async () => {
		const { client, telechargements } = espion({ textes: { p1: { text_status: 'extracted', extracted_text: 'Devis n° 42', text_truncated: true } } })
		render(<ListePiecesJointes pieces={[PDF]} client={client} />)
		const commande = screen.getByRole('button', { name: 'Aperçu de devis.pdf' })
		await userEvent.click(commande)
		expect(commande.getAttribute('aria-expanded')).toBe('true')
		const cadre = await screen.findByTestId('apercu-pdf')
		expect(cadre.getAttribute('src')).toBe('blob:apercu')
		expect(cadre.getAttribute('title')).toBe('Aperçu de devis.pdf')
		expect(telechargements).toEqual(['w/m/1'])
		const [blob] = vi.mocked(URL.createObjectURL).mock.calls[0]!
		expect((blob as Blob).type).toBe('application/pdf')
		expect((await screen.findByTestId('texte-contenu')).textContent).toBe('Devis n° 42')
		expect(screen.getByTestId('texte-extrait').textContent).toContain(fr['inbox.attachments.text.truncated'])
		const ecrire = vi.fn(async () => undefined)
		Object.defineProperty(navigator, 'clipboard', { value: { writeText: ecrire }, configurable: true })
		await userEvent.click(screen.getByRole('button', { name: fr['inbox.attachments.text.copy'] }))
		expect(ecrire).toHaveBeenCalledWith('Devis n° 42')
		expect(await screen.findByText(fr['inbox.attachments.text.copied'])).toBeDefined()
	})

	it('une image se montre sans texte ; un fichier Office ne montre que son texte, et ses états sont des phrases', async () => {
		const { client, telechargements } = espion({ textes: { p3: { text_status: 'empty', extracted_text: null, text_truncated: false } } })
		render(<ListePiecesJointes pieces={[PNG, DOCX]} client={client} />)
		await userEvent.click(screen.getByRole('button', { name: 'Aperçu de maquette.png' }))
		expect((await screen.findByTestId('apercu-image')).getAttribute('alt')).toBe('Aperçu de maquette.png')
		expect(screen.queryByTestId('texte-extrait')).toBeNull()
		// UN SEUL PANNEAU OUVERT (§5.28) : ouvrir le second ferme le premier.
		await userEvent.click(screen.getByRole('button', { name: 'Aperçu de cahier.docx' }))
		expect(screen.queryByTestId('apercu-image')).toBeNull()
		expect(screen.getAllByTestId('apercu-panneau')).toHaveLength(1)
		expect((await screen.findByTestId('texte-etat')).textContent).toBe(fr['inbox.attachments.text.empty'])
		expect(screen.queryByTestId('apercu-pdf')).toBeNull()
		expect(telechargements).toEqual(['w/m/2'])
	})

	it('Échap referme le panneau et rend le focus à « Aperçu » ; « Fermer l’aperçu » aussi', async () => {
		render(<ListePiecesJointes pieces={[PDF]} client={espion({ textes: { p1: { text_status: 'pending', extracted_text: null, text_truncated: false } } }).client} />)
		const commande = screen.getByRole('button', { name: 'Aperçu de devis.pdf' })
		await userEvent.click(commande)
		expect((await screen.findByTestId('texte-etat')).textContent).toBe(fr['inbox.attachments.text.pending'])
		screen.getByTestId('apercu-fermer').focus()
		await userEvent.keyboard('{Escape}')
		expect(screen.queryByTestId('apercu-panneau')).toBeNull()
		expect(document.activeElement).toBe(commande)
		await userEvent.click(commande)
		await userEvent.click(await screen.findByTestId('apercu-fermer'))
		expect(screen.queryByTestId('apercu-panneau')).toBeNull()
		expect(document.activeElement).toBe(commande)
	})

	it('une pièce qui ne se lit pas le dit en alerte, avec « Réessayer » qui relit', async () => {
		const { client, telechargements } = espion({ fichierEnPanne: true })
		render(<ListePiecesJointes pieces={[PNG]} client={client} />)
		await userEvent.click(screen.getByRole('button', { name: 'Aperçu de maquette.png' }))
		const alerte = await screen.findByRole('alert')
		expect(alerte.textContent).toContain(fr['inbox.attachments.preview.error'])
		await userEvent.click(within(alerte).getByRole('button', { name: fr['inbox.attachments.preview.retry'] }))
		await waitFor(() => expect(telechargements).toHaveLength(2))
	})
})
