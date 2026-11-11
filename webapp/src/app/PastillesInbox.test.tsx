// @verifies CRM-141 (docs/BACKLOG.md) — tranche T4 : les pastilles dans l'inbox — la ligne d'un fil (trois au plus, puis
//           « +n » qui nomme les masquées), le filtre « Pastille » (actives, puis archivées suffixées), le message ouvert
//           (pastilles et origine en mots, état d'évaluation, « Réévaluer les pastilles » absente d'un envoyé, le panneau
//           et ses cases qui écrivent au clic et reviennent au refus, `Échap`, la commande refusée avec son motif, et
//           l'exclusion avec la confirmation d'« Effacer »)
// @verifies docs/SPEC-mail-subsystem.md §31.4, §31.7 ; docs/DESIGN_SYSTEM.md §5.103, §5.73, §5.59 ; décision 926
//
// Les composants RÉELS sont montés ; le client ne simule que les deux lectures et les deux fonctions de la base. La pile
// réelle est éprouvée par `e2e/ui/pastilles-inbox.spec.ts`.

import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PastilleMail } from '../lib/pastilles-mail'
import type { ClientCrm } from '../lib/supabase'

const injecte = vi.hoisted(() => ({
	lignes: [] as unknown[],
	etat: 'done' as string | null,
	rpc: [] as { nom: string; args: unknown }[],
	reponseRpc: { error: null, status: 204 } as unknown,
}))

vi.mock('../lib/supabase', () => ({
	get clientCrm() {
		return {
			from: (table: string) => {
				const maillon: Record<string, unknown> = {}
				for (const m of ['select', 'eq', 'limit']) maillon[m] = () => maillon
				maillon.then = (resoudre: (r: unknown) => unknown) =>
					resoudre(
						table === 'mail_message_labels'
							? { data: injecte.lignes, error: null, status: 200 }
							: { data: injecte.etat === null ? [] : [{ state: injecte.etat }], error: null, status: 200 },
					)
				return maillon
			},
			rpc: (nom: string, args: unknown) => {
				injecte.rpc.push({ nom, args })
				return Promise.resolve(injecte.reponseRpc)
			},
		} as unknown as ClientCrm
	},
}))

const { FiltrePastille, PastillesLigne, PastillesMessageOuvert } = await import('./PastillesInbox')

afterEach(() => {
	cleanup()
	injecte.lignes = []
	injecte.etat = 'done'
	injecte.rpc = []
	injecte.reponseRpc = { error: null, status: 204 }
})

const p = (id: string, nom: string, archivee = false, idEspace = 'ws-1'): PastilleMail => ({
	id,
	idEspace,
	nom,
	couleur: 'brand',
	descriptif: 'x',
	archivee,
})

const CATALOGUE = new Map(
	[
		p('p-adm', 'Administratif'),
		p('p-devis', 'Devis / commande'),
		p('p-lead', 'Lead'),
		p('p-spam', 'Spam'),
		p('p-autre', 'Autre espace', false, 'ws-2'),
		p('p-news', 'Newsletter', true),
		p('p-vieux', 'Ancienne', true),
	].map((x) => [x.id, x]),
)

describe('la ligne d’un fil (§5.103)', () => {
	it('trois pastilles au plus dans l’ordre du nom, puis « +n » qui nomme les masquées ; aucune : rien', () => {
		const { container } = render(<PastillesLigne ids={['p-spam', 'p-lead', 'p-adm', 'p-devis']} catalogue={CATALOGUE} />)
		const ligne = screen.getByTestId('inbox-pastilles-ligne')
		expect(within(ligne).getAllByTestId('pastille-etiquette').map((e) => e.textContent)).toEqual([
			'Administratif',
			'Devis / commande',
			'Lead',
		])
		const reste = within(ligne).getByTestId('pastille-etiquettes-reste')
		expect(reste.textContent).toBe('+1')
		expect(reste.getAttribute('aria-label')).toBe('1 autres pastilles : Spam')
		cleanup()
		const vide = render(<PastillesLigne ids={[]} catalogue={CATALOGUE} />)
		expect(vide.container.innerHTML).toBe('')
		expect(container).toBeTruthy()
	})

	it('une archivée garde sa pilule, et son nom accessible le dit', () => {
		render(<PastillesLigne ids={['p-news']} catalogue={CATALOGUE} />)
		expect(screen.getByRole('img', { name: 'Newsletter, pastille archivée' })).toBeTruthy()
	})
})

describe('le filtre « Pastille » (§5.103)', () => {
	it('« Toutes les pastilles », les actives, puis les archivées suffixées ; le choix et son effacement', async () => {
		const onChange = vi.fn()
		const actives = [...CATALOGUE.values()].filter((x) => !x.archivee)
		const archivees = [...CATALOGUE.values()].filter((x) => x.archivee)
		render(<FiltrePastille catalogue={new Map([...actives, ...archivees].map((x) => [x.id, x]))} valeur={null} onChange={onChange} />)
		const select = screen.getByLabelText('Pastille') as HTMLSelectElement
		expect([...select.options].map((o) => o.textContent)).toEqual([
			'Toutes les pastilles',
			'Administratif',
			'Devis / commande',
			'Lead',
			'Spam',
			'Autre espace',
			'Newsletter (archivée)',
			'Ancienne (archivée)',
		])
		await userEvent.selectOptions(select, 'p-lead')
		expect(onChange).toHaveBeenLastCalledWith('p-lead')
		await userEvent.selectOptions(select, '')
		expect(onChange).toHaveBeenLastCalledWith(null)
	})

	it('sans catalogue, aucun filtre', () => {
		const { container } = render(<FiltrePastille catalogue={new Map()} valeur={null} onChange={vi.fn()} />)
		expect(container.innerHTML).toBe('')
	})
})

function monterMessage({
	envoye = false,
	edition = 'permise' as const,
	onAnnonce = vi.fn(),
}: { envoye?: boolean; edition?: 'permise' | 'refusee'; onAnnonce?: (t: string) => void } = {}) {
	const signaux = { refermer: 0, confirmation: () => {} }
	render(
		<PastillesMessageOuvert
			idMessage="m1"
			idEspace="ws-1"
			envoye={envoye}
			catalogue={CATALOGUE}
			edition={edition}
			onAnnonce={onAnnonce}
			rangee={({ commandes, refermerConfirmation, onConfirmationOuverte }) => {
				signaux.refermer = refermerConfirmation
				signaux.confirmation = onConfirmationOuverte
				return (
					<div data-testid="rangee">
						<button type="button">Marquer comme non lu</button>
						{commandes}
						<button type="button">Effacer</button>
					</div>
				)
			}}
		/>,
	)
	return signaux
}

describe('le message ouvert (§5.103)', () => {
	it('ses pastilles posées, l’origine en mots ; l’état « en attente » ; les commandes entre la lecture et « Effacer »', async () => {
		injecte.lignes = [
			{ label_id: 'p-lead', source: 'llm', applied: true },
			{ label_id: 'p-spam', source: 'manual', applied: true },
			{ label_id: 'p-devis', source: 'manual', applied: false },
		]
		injecte.etat = 'pending'
		monterMessage()
		const ligne = await screen.findByTestId('inbox-pastilles-message')
		expect(within(ligne).getByRole('img', { name: "Lead, posée par l'IA" })).toBeTruthy()
		expect(within(ligne).getByRole('img', { name: 'Spam, posée à la main' })).toBeTruthy()
		expect(within(ligne).queryByText('Devis / commande')).toBeNull()
		expect(screen.getByTestId('inbox-pastilles-etat').textContent).toBe("Pastilles en attente d'évaluation")
		const boutons = Array.from(screen.getByTestId('rangee').querySelectorAll('button')).map((b) => b.textContent)
		expect(boutons).toEqual(['Marquer comme non lu', 'Réévaluer les pastilles', 'Pastilles', 'Effacer'])
	})

	it('l’échec de l’évaluation se dit en mots ; un mail envoyé n’a ni état ni « Réévaluer les pastilles »', async () => {
		injecte.etat = 'failed'
		monterMessage()
		expect((await screen.findByTestId('inbox-pastilles-etat')).textContent).toBe("Les pastilles n'ont pas pu être évaluées")
		cleanup()
		injecte.etat = null
		monterMessage({ envoye: true })
		await screen.findByTestId('inbox-pastilles')
		expect(screen.queryByTestId('inbox-reevaluer-pastilles')).toBeNull()
		expect(screen.queryByTestId('inbox-pastilles-etat')).toBeNull()
	})

	it('« Réévaluer les pastilles » appelle la base sans confirmation, et l’annonce', async () => {
		const onAnnonce = vi.fn()
		monterMessage({ onAnnonce })
		await userEvent.click(await screen.findByTestId('inbox-reevaluer-pastilles'))
		await waitFor(() => expect(onAnnonce).toHaveBeenCalledWith('Réévaluation demandée.'))
		expect(injecte.rpc).toEqual([{ nom: 'request_label_evaluation', args: { p_message_id: 'm1' } }])
	})

	it('« Pastilles » ouvre le panneau : les actives de l’espace, l’archivée encore posée, l’origine ; la case écrit au clic', async () => {
		injecte.lignes = [
			{ label_id: 'p-lead', source: 'llm', applied: true },
			{ label_id: 'p-devis', source: 'manual', applied: false },
			{ label_id: 'p-news', source: 'llm', applied: true },
		]
		const onAnnonce = vi.fn()
		monterMessage({ onAnnonce })
		await screen.findByTestId('inbox-pastilles-message')
		const commande = screen.getByTestId('inbox-pastilles')
		await userEvent.click(commande)
		expect(commande.getAttribute('aria-expanded')).toBe('true')
		const panneau = screen.getByRole('group', { name: 'Pastilles de ce message' })
		const cases = within(panneau).getAllByTestId('inbox-case-pastille')
		// L'autre espace n'est pas proposé ; l'archivée non posée non plus ; l'archivée posée vient en dernier.
		expect(cases.map((c) => within(c).getByTestId('pastille-etiquette').textContent)).toEqual([
			'Administratif',
			'Devis / commande',
			'Lead',
			'Spam',
			'Newsletter',
		])
		expect(document.activeElement).toBe(within(cases[0]!).getByRole('checkbox'))
		expect(cases[1]!.textContent).toContain('retirée à la main')
		expect(cases[2]!.textContent).toContain("posée par l'IA")
		expect((within(cases[4]!).getByRole('checkbox') as HTMLInputElement).checked).toBe(true)

		await userEvent.click(within(cases[3]!).getByRole('checkbox'))
		await waitFor(() => expect(onAnnonce).toHaveBeenCalledWith('Pastille « Spam » posée.'))
		expect(injecte.rpc).toEqual([{ nom: 'set_message_label', args: { p_message_id: 'm1', p_label_id: 'p-spam', p_applied: true } }])
	})

	it('un refus de la base : la case revient, et le refus est écrit dessous', async () => {
		injecte.reponseRpc = { error: { code: '42501', message: 'forbidden' }, status: 403 }
		monterMessage()
		await userEvent.click(await screen.findByTestId('inbox-pastilles'))
		const caseLead = screen.getByRole('checkbox', { name: /Lead/ }) as HTMLInputElement
		await userEvent.click(caseLead)
		expect((await screen.findByRole('alert')).textContent).toBe(
			"Seuls les administrateurs et les business developers de l'espace posent ou retirent une pastille.",
		)
		expect(caseLead.checked).toBe(false)
	})

	it('au clavier, la case GARDE le focus pendant l’appel, et `Échap` referme ensuite', async () => {
		monterMessage()
		const commande = await screen.findByTestId('inbox-pastilles')
		await userEvent.click(commande)
		const premiere = screen.getAllByRole('checkbox')[0] as HTMLInputElement
		expect(document.activeElement).toBe(premiere)
		await userEvent.keyboard(' ')
		expect(premiere.disabled).toBe(false)
		expect(document.activeElement).toBe(premiere)
		await userEvent.keyboard('{Escape}')
		expect(screen.queryByTestId('inbox-panneau-pastilles')).toBeNull()
	})

	it('`Échap` et « Fermer » referment ; le focus revient à « Pastilles »', async () => {
		monterMessage()
		const commande = await screen.findByTestId('inbox-pastilles')
		await userEvent.click(commande)
		await userEvent.keyboard('{Escape}')
		expect(screen.queryByTestId('inbox-panneau-pastilles')).toBeNull()
		await waitFor(() => expect(document.activeElement).toBe(commande))
		await userEvent.click(commande)
		await userEvent.click(screen.getByTestId('inbox-pastilles-fermer'))
		expect(screen.queryByTestId('inbox-panneau-pastilles')).toBeNull()
	})

	it('sans la capacité d’éditer l’espace : « Réévaluer » éteinte et décrite par le motif ; le panneau s’ouvre, ses cases éteintes', async () => {
		monterMessage({ edition: 'refusee' })
		const reevaluer = (await screen.findByTestId('inbox-reevaluer-pastilles')) as HTMLButtonElement
		expect(reevaluer.disabled).toBe(true)
		const motifCache = document.getElementById(reevaluer.getAttribute('aria-describedby') ?? '')
		expect(motifCache?.textContent).toContain('réservées aux administrateurs et aux business developers')
		await userEvent.click(screen.getByTestId('inbox-pastilles'))
		expect(screen.getByTestId('motif-lecture-seule')).toBeTruthy()
		for (const c of screen.getAllByRole('checkbox')) expect((c as HTMLInputElement).disabled).toBe(true)
	})

	it('le panneau et la confirmation d’« Effacer » s’excluent', async () => {
		const signaux = monterMessage()
		const avant = signaux.refermer
		await userEvent.click(await screen.findByTestId('inbox-pastilles'))
		// Ouvrir le panneau referme la confirmation…
		expect(signaux.refermer).toBe(avant + 1)
		// … et ouvrir la confirmation referme le panneau.
		signaux.confirmation()
		await waitFor(() => expect(screen.queryByTestId('inbox-panneau-pastilles')).toBeNull())
	})
})
