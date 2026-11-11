// @verifies CRM-074 (docs/BACKLOG.md) — tranche T3 : la liste des pièces et l'aperçu dans le flux — une pièce non saine
//           sans commande, « Aperçu » seulement là où il a un objet, le panneau sous la pièce (PDF et son texte, image,
//           fichier Office en texte seul), les états du texte, un seul panneau ouvert, Échap qui referme et rend le focus,
//           l'échec de lecture et sa reprise, la copie du texte
// @verifies docs/DESIGN_SYSTEM.md §5.80, §5.4, §5.28 ; docs/SPEC-pieces-jointes.md §5, §5.2 (décision 791)
// @verifies CRM-143 (docs/BACKLOG.md) — tranche T4 : la pièce non analysée — sa raison écrite, « Télécharger quand même »,
//           l'avertissement dans le flux qui prend le focus, Échap et « Annuler » qui le referment, la confirmation par
//           `acknowledge_unscanned_attachment` AVANT le téléchargement, un refus dit sans rien télécharger, la pièce déjà
//           confirmée, la trop volumineuse sans commande ; docs/SPEC-pieces-jointes.md §17.4 ; docs/DESIGN_SYSTEM.md §5.95
//
// Le composant RÉEL est monté sur un client espion. La pile réelle est éprouvée par `e2e/ui/pieces-jointes.spec.ts`.

import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fr } from '../i18n'
import type { PieceJointe } from '../lib/inbox'
import type { ClientCrm } from '../lib/supabase'
import { ListePiecesJointes } from './PiecesJointes'

const BASE = { raisonNonAnalyse: null, recueLe: '2026-11-10T08:00:00Z', confirmee: false, contentId: null } as const
const NON_ANALYSEE: PieceJointe = {
	id: 'p6',
	nom: 'releve.pdf',
	type: 'application/pdf',
	taille: 2048,
	chemin: 'w/m/6',
	statutAnalyse: 'skipped',
	raisonNonAnalyse: 'scanner_unavailable',
	recueLe: '2026-11-10T08:00:00Z',
	confirmee: false,
	contentId: null,
}
const LOURDE: PieceJointe = { ...NON_ANALYSEE, id: 'p7', nom: 'video.mov', chemin: 'w/m/7', raisonNonAnalyse: 'too_large' }
const PDF: PieceJointe = { id: 'p1', nom: 'devis.pdf', type: 'application/pdf', taille: 2048, chemin: 'w/m/1', statutAnalyse: 'clean', ...BASE }
const PNG: PieceJointe = { id: 'p2', nom: 'maquette.png', type: 'image/png', taille: 1411, chemin: 'w/m/2', statutAnalyse: 'clean', ...BASE }
const DOCX: PieceJointe = {
	id: 'p3',
	nom: 'cahier.docx',
	type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
	taille: 1081,
	chemin: 'w/m/3',
	statutAnalyse: 'clean',
	...BASE,
}
const TXT: PieceJointe = { id: 'p4', nom: 'note.txt', type: 'text/plain', taille: 12, chemin: 'w/m/4', statutAnalyse: 'clean', ...BASE }
const VIRUS: PieceJointe = { id: 'p5', nom: 'virus.exe', type: 'application/x-msdownload', taille: 9, chemin: 'w/m/5', statutAnalyse: 'infected', ...BASE }

type Textes = Record<string, { text_status: string | null; extracted_text: string | null; text_truncated: boolean }>

function espion(options: { textes?: Textes; fichierEnPanne?: boolean; refusConfirmation?: string } = {}) {
	const telechargements: string[] = []
	const appels: string[] = []
	const faux = {
		rpc: async (nom: string, args: { p_attachment_id: string }) => {
			appels.push(`rpc:${nom}:${args.p_attachment_id}`)
			return options.refusConfirmation === undefined
				? { data: '2026-11-10T12:00:00Z', error: null }
				: { data: null, error: { message: options.refusConfirmation } }
		},
		storage: {
			from: () => ({
				download: async (chemin: string) => {
					telechargements.push(chemin)
					return options.fichierEnPanne ? { data: null, error: { message: 'refusé' } } : { data: new Blob(['%PDF']), error: null }
				},
				createSignedUrl: async (chemin: string) => {
					appels.push(`signer:${chemin}`)
					return { data: { signedUrl: 'https://signe.example/x' }, error: null }
				},
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
	return { client: faux, telechargements, appels }
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

describe('ListePiecesJointes — la pièce non analysée (CRM-143, docs/DESIGN_SYSTEM.md §5.95)', () => {
	beforeEach(() => {
		window.open = vi.fn() as unknown as typeof window.open
	})

	it('dit sa raison, n’a pas d’aperçu, et offre « Télécharger quand même » ; la trop volumineuse n’offre rien', () => {
		render(<ListePiecesJointes pieces={[NON_ANALYSEE, LOURDE]} client={espion().client} />)
		const [nonAnalysee, lourde] = screen.getAllByTestId('inbox-piece-jointe')
		expect(within(nonAnalysee!).getByTestId('statut-piece').textContent).toBe(fr['inbox.attachments.status.unscanned.unavailable'])
		expect(within(nonAnalysee!).queryByTestId('apercu-piece')).toBeNull()
		const commande = within(nonAnalysee!).getByRole('button', { name: 'Télécharger quand même releve.pdf' })
		expect(commande.getAttribute('aria-expanded')).toBe('false')
		expect(within(lourde!).getByTestId('statut-piece').textContent).toBe(fr['inbox.attachments.status.tooLarge'])
		expect(within(lourde!).queryAllByRole('button')).toHaveLength(0)
	})

	it('l’avertissement s’ouvre dans le flux, prend le focus, et Échap comme « Annuler » le referment sans rien envoyer', async () => {
		const { client, appels } = espion()
		render(<ListePiecesJointes pieces={[NON_ANALYSEE]} client={client} />)
		const commande = screen.getByTestId('telecharger-quand-meme')
		await userEvent.click(commande)
		expect(commande.getAttribute('aria-expanded')).toBe('true')
		const avertissement = screen.getByTestId('avertissement-piece')
		expect(avertissement.textContent).toContain(fr['inbox.attachments.risk.warning'])
		expect(document.activeElement).toBe(screen.getByTestId('accepter-risque'))
		expect(screen.getByTestId('accepter-risque').getAttribute('aria-describedby')).toBe('risque-p6')
		await userEvent.keyboard('{Escape}')
		expect(screen.queryByTestId('avertissement-piece')).toBeNull()
		expect(document.activeElement).toBe(commande)
		await userEvent.click(commande)
		await userEvent.click(screen.getByTestId('annuler-risque'))
		expect(screen.queryByTestId('avertissement-piece')).toBeNull()
		expect(document.activeElement).toBe(commande)
		expect(appels).toEqual([])
	})

	it('la confirmation est écrite AVANT le téléchargement ; la ligne porte ensuite « Télécharger » et garde sa raison', async () => {
		const { client, appels } = espion()
		render(<ListePiecesJointes pieces={[NON_ANALYSEE]} client={client} />)
		await userEvent.click(screen.getByTestId('telecharger-quand-meme'))
		await userEvent.click(screen.getByTestId('accepter-risque'))
		await waitFor(() => expect(window.open).toHaveBeenCalledWith('https://signe.example/x', '_blank', 'noopener,noreferrer'))
		expect(appels).toEqual(['rpc:acknowledge_unscanned_attachment:p6', 'signer:w/m/6'])
		expect(screen.queryByTestId('avertissement-piece')).toBeNull()
		const telecharger = screen.getByTestId('telecharger-confirmee')
		expect(document.activeElement).toBe(telecharger)
		expect(screen.getByTestId('statut-piece').textContent).toBe(fr['inbox.attachments.status.unscanned.unavailable'])
	})

	it('un refus se dit dans l’avertissement, sans rien télécharger, et rend le focus au bouton', async () => {
		const { client, appels } = espion({ refusConfirmation: 'attachment_infected' })
		render(<ListePiecesJointes pieces={[NON_ANALYSEE]} client={client} />)
		await userEvent.click(screen.getByTestId('telecharger-quand-meme'))
		await userEvent.click(screen.getByTestId('accepter-risque'))
		expect((await screen.findByTestId('refus-risque')).textContent).toBe(fr['inbox.attachments.risk.refus.infectee'])
		expect(screen.getByRole('alert').textContent).toBe(fr['inbox.attachments.risk.refus.infectee'])
		expect(appels).toEqual(['rpc:acknowledge_unscanned_attachment:p6'])
		expect(window.open).not.toHaveBeenCalled()
		await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId('accepter-risque')))
	})

	it('une pièce déjà confirmée par la personne n’en redemande pas : « Télécharger », la raison restant écrite', async () => {
		const { client, appels } = espion()
		render(<ListePiecesJointes pieces={[{ ...NON_ANALYSEE, confirmee: true }]} client={client} />)
		expect(screen.queryByTestId('telecharger-quand-meme')).toBeNull()
		await userEvent.click(screen.getByRole('button', { name: 'Télécharger releve.pdf' }))
		await waitFor(() => expect(window.open).toHaveBeenCalled())
		expect(appels).toEqual(['signer:w/m/6'])
		expect(screen.getByTestId('statut-piece').textContent).toBe(fr['inbox.attachments.status.unscanned.unavailable'])
	})

	it('une pièce en attente d’analyse depuis plus de quinze minutes est non analysée ; plus jeune, elle est en cours', () => {
		const ancienne = new Date(Date.now() - 20 * 60_000).toISOString()
		const recente = new Date(Date.now() - 2 * 60_000).toISOString()
		render(
			<ListePiecesJointes
				pieces={[
					{ ...NON_ANALYSEE, id: 'p8', statutAnalyse: 'pending', raisonNonAnalyse: null, recueLe: ancienne },
					{ ...NON_ANALYSEE, id: 'p9', nom: 'jeune.pdf', statutAnalyse: 'pending', raisonNonAnalyse: null, recueLe: recente },
				]}
				client={espion().client}
			/>,
		)
		const [ancienneLigne, jeuneLigne] = screen.getAllByTestId('inbox-piece-jointe')
		expect(within(ancienneLigne!).getByTestId('statut-piece').textContent).toBe(fr['inbox.attachments.status.unscanned.waiting'])
		expect(within(ancienneLigne!).getByTestId('telecharger-quand-meme')).toBeDefined()
		expect(within(jeuneLigne!).getByTestId('statut-piece').textContent).toBe(fr['inbox.attachments.status.pending'])
		expect(within(jeuneLigne!).queryAllByRole('button')).toHaveLength(0)
	})
})
