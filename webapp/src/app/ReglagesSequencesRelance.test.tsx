// @verifies CRM-125 (docs/BACKLOG.md) T3 — l'aperçu des paliers dans la fiche d'une séquence : un seul palier déplié, un
//           rendu par modèle partagé entre ses paliers, l'aperçu de la séquence et ses délais cumulés, la mention des
//           données d'exemple et de l'identité fictive, l'erreur puis « Réessayer », la séquence sans palier sans aperçu
// @verifies docs/SPEC-modeles-emails.md §14.5 ; docs/DESIGN_SYSTEM.md §5.41 (révision `CRM-125`), §5.8
//
// L'écran RÉEL est monté sur un client espion qui sert les lectures et compte les appels de l'aperçu. La pile réelle est
// éprouvée par `e2e/ui/sequences-apercu.spec.ts`.

import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { fr } from '../i18n'
import { CAPACITES_INCONNUES } from '../lib/capacites'
import type { ClientCrm } from '../lib/supabase'
import { FournisseurEspace } from './ContexteEspace'
import { ReglagesSequencesRelance } from './ReglagesSequencesRelance'

afterEach(cleanup)

const PALIERS = [
	{ id: 'p1', position: 1, delai_jours: 4, template_id: 'm1', mail_templates: { name: 'Relance 1' } },
	{ id: 'p2', position: 2, delai_jours: 6, template_id: 'm2', mail_templates: { name: 'Relance 2' } },
	{ id: 'p3', position: 3, delai_jours: 5, template_id: 'm1', mail_templates: { name: 'Relance 1' } },
]

type Options = { readonly paliers?: readonly unknown[]; readonly fictive?: boolean; readonly pannes?: number }

function client({ paliers = PALIERS, fictive = false, pannes = 0 }: Options = {}) {
	const apercus: string[] = []
	let restantes = pannes
	const donnees: Record<string, unknown> = {
		workspaces: [{ id: 'ws-1', name: 'Démo', slug: 'demo' }],
		mail_sequences: [{ id: 's1', workspace_id: 'ws-1', name: 'FR · Lead', mail_sequence_steps: [{ count: paliers.length }] }],
		mail_templates: [{ id: 'm1', workspace_id: 'ws-1', name: 'Relance 1', subject: 'S', body_text: 'B' }],
		mail_sequence_steps: paliers,
	}
	const faux = {
		from: (table: string) => {
			const maillon: Record<string, unknown> = {}
			for (const methode of ['select', 'order', 'eq', 'is', 'in', 'limit']) maillon[methode] = () => maillon
			maillon.then = (resoudre: (r: unknown) => unknown) => resoudre({ data: donnees[table] ?? [], error: null, status: 200 })
			return maillon
		},
		rpc: (nom: string, args: { p_template_id?: string }) => {
			if (nom !== 'render_mail_template_sample') return Promise.resolve({ data: [], error: null, status: 200 })
			apercus.push(args.p_template_id ?? '')
			if (restantes > 0) {
				restantes -= 1
				return Promise.resolve({ data: null, error: { message: 'boom' }, status: 500 })
			}
			const ligne = {
				subject: `Objet ${args.p_template_id}`,
				body_text: `Bonjour M. Dupont,\nCorps ${args.p_template_id}`,
				signature_text: fictive ? null : 'Driss Lemoine',
				identity_is_sample: fictive,
			}
			return Promise.resolve({ data: [ligne], error: null, status: 200 })
		},
	} as unknown as ClientCrm
	return { client: faux, apercus }
}

async function ouvrirFiche(c: ClientCrm) {
	render(
		<FournisseurEspace valeur={{ idWorkspace: 'ws-1', estAdmin: true, capacites: { ...CAPACITES_INCONNUES } }}>
			<ReglagesSequencesRelance client={c} />
		</FournisseurEspace>,
	)
	await userEvent.click(await screen.findByTestId('modifier-sequence'))
	return screen.findAllByTestId('ligne-palier')
}

describe('l’aperçu d’un palier (§14.5)', () => {
	it('rien n’est rendu avant le clic ; le bloc déplié montre la mention, l’objet, le corps et la signature', async () => {
		const { client: c, apercus } = client()
		const lignes = await ouvrirFiche(c)
		expect(apercus).toEqual([])
		const bouton = within(lignes[0]!).getByTestId('apercu-palier')
		expect(bouton.getAttribute('aria-label')).toBe('Aperçu du palier 1')
		expect(bouton.getAttribute('aria-expanded')).toBe('false')
		await userEvent.click(bouton)
		expect(bouton.getAttribute('aria-expanded')).toBe('true')
		const bloc = within(lignes[0]!).getByTestId('apercu-palier-bloc')
		expect(within(bloc).getByTestId('mention-donnees-exemple').textContent).toContain(fr['admin.sequences.preview.notice'])
		expect(within(bloc).queryByTestId('mention-identite-fictive')).toBeNull()
		expect((await within(bloc).findByTestId('apercu-palier-rendu-objet')).textContent).toBe('Objet m1')
		const corps = within(bloc).getByTestId('apercu-palier-rendu-corps').textContent
		expect(corps).toBe('Bonjour M. Dupont,\nCorps m1\n\n-- \nDriss Lemoine')
		expect(apercus).toEqual(['m1'])
	})

	it('un seul palier est déplié à la fois, et deux paliers du même modèle partagent le rendu', async () => {
		const { client: c, apercus } = client()
		const lignes = await ouvrirFiche(c)
		await userEvent.click(within(lignes[0]!).getByTestId('apercu-palier'))
		await userEvent.click(within(lignes[1]!).getByTestId('apercu-palier'))
		expect(screen.getAllByTestId('apercu-palier-bloc')).toHaveLength(1)
		expect(within(lignes[0]!).queryByTestId('apercu-palier-bloc')).toBeNull()
		await userEvent.click(within(lignes[2]!).getByTestId('apercu-palier'))
		await within(lignes[2]!).findByTestId('apercu-palier-rendu-objet')
		// Le palier 3 emploie le modèle du palier 1 : aucun appel de plus.
		expect(apercus).toEqual(['m1', 'm2'])
		// Un second clic replie.
		await userEvent.click(within(lignes[2]!).getByTestId('apercu-palier'))
		expect(screen.queryByTestId('apercu-palier-bloc')).toBeNull()
	})

	it('l’expéditeur fictif est dit ; une erreur offre « Réessayer », qui redemande', async () => {
		const { client: c, apercus } = client({ fictive: true, pannes: 1 })
		const lignes = await ouvrirFiche(c)
		await userEvent.click(within(lignes[0]!).getByTestId('apercu-palier'))
		const erreur = await screen.findByTestId('apercu-palier-rendu-erreur')
		expect(erreur.getAttribute('role')).toBe('alert')
		await userEvent.click(within(erreur).getByRole('button', { name: fr['admin.sequences.preview.retry'] }))
		await screen.findByTestId('apercu-palier-rendu-objet')
		expect(screen.getByTestId('mention-identite-fictive').textContent).toBe(fr['admin.sequences.preview.identitySample'])
		expect(screen.getByTestId('apercu-palier-rendu-corps').textContent).not.toContain('-- ')
		expect(apercus).toEqual(['m1', 'm1'])
	})
})

describe('l’aperçu de la séquence entière (§14.5)', () => {
	it('chaque palier dans l’ordre, avec son délai et son délai cumulé ; un appel par modèle distinct ; « Fermer » rend le focus', async () => {
		const { client: c, apercus } = client()
		await ouvrirFiche(c)
		const ouvrir = screen.getByTestId('apercu-sequence-ouvrir')
		await userEvent.click(ouvrir)
		const panneau = screen.getByTestId('apercu-sequence')
		const titres = within(panneau).getAllByTestId('apercu-sequence-titre').map((titre) => titre.textContent)
		expect(titres).toEqual([
			'Palier 1 · J+4 — J+4 depuis l’armement',
			'Palier 2 · J+6 — J+10 depuis l’armement',
			'Palier 3 · J+5 — J+15 depuis l’armement',
		])
		await waitFor(() => expect(within(panneau).getAllByTestId('apercu-sequence-rendu')).toHaveLength(3))
		expect(apercus).toEqual(['m1', 'm2'])
		await userEvent.click(within(panneau).getByTestId('fermer-apercu-sequence'))
		expect(screen.queryByTestId('apercu-sequence')).toBeNull()
		expect(document.activeElement).toBe(ouvrir)
	})

	it('une séquence sans palier n’offre pas l’aperçu', async () => {
		const { client: c } = client({ paliers: [] })
		render(
			<FournisseurEspace valeur={{ idWorkspace: 'ws-1', estAdmin: true, capacites: { ...CAPACITES_INCONNUES } }}>
				<ReglagesSequencesRelance client={c} />
			</FournisseurEspace>,
		)
		await userEvent.click(await screen.findByTestId('modifier-sequence'))
		await screen.findByTestId('paliers-vides')
		expect(screen.queryByTestId('apercu-sequence-ouvrir')).toBeNull()
	})
})
