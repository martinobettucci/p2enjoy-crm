// @verifies CRM-162 (docs/BACKLOG.md) — tranche T2 : le bloc « Tracks » de la fiche d'un espace — le tableau, le bloc du
//           déplacement sur une ligne à lui, l'aperçu après le choix de l'arrivée, les refus listés sans commande, la saisie
//           du nom qui ouvre « Déplacer le track », l'issue, `Échap` qui referme et rend le focus
// @verifies docs/SPEC-deplacement-track.md §4, §5, §13 ; docs/DESIGN_SYSTEM.md §5.112, §5.27, §5.40, §5.50
//
// L'écran RÉEL est monté sur un client espion ; la pile réelle est éprouvée par `e2e/ui/deplacement-track.spec.ts`.

import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { EspacePlateforme } from '../lib/plateforme'
import type { ClientCrm } from '../lib/supabase'
import { BlocTracks } from './PlateformeTracks'
import type { Message } from './TableauMembres'

afterEach(cleanup)

const ESPACE = { id: 'w1', nom: 'P2Enjoy SAS', slug: 'p2enjoy' } as unknown as EspacePlateforme
const LUMEN = { id: 'w2', nom: 'Studio Lumen', slug: 'studio-lumen' } as unknown as EspacePlateforme

function apercu(refusals: unknown[] = []) {
	return {
		track: { id: 't1', name: 'Formation' },
		from: { id: 'w1', name: 'P2Enjoy SAS' },
		to: { id: 'w2', name: 'Studio Lumen', slug: 'studio-lumen', inbound_domain: 'lumen.test' },
		counts: { channels: 1, cards: 3 },
		referentials: { label: { reused: [{ source: 'Secteur public', target: 'Secteur public' }], created: [] } },
		costs: { minutes: 0, from: [], to: [], without_cost: [] },
		duplicates: [],
		refusals,
	}
}

function client(options: { refus?: unknown[]; deplacement?: unknown } = {}) {
	const appels: string[] = []
	const c = {
		rpc: (nom: string) => {
			appels.push(nom)
			if (nom === 'plateforme_tracks') {
				return Promise.resolve({ data: [{ id: 't1', name: 'Formation', slug: 'formation', channels: 1, cards: 3, trashed: false }], error: null, status: 200 })
			}
			if (nom === 'track_move_preview') return Promise.resolve({ data: apercu(options.refus), error: null, status: 200 })
			return Promise.resolve(options.deplacement ?? { data: { cards: 3, channels: 1 }, error: null, status: 200 })
		},
	} as unknown as ClientCrm
	return { c, appels }
}

function monter(c: ClientCrm, ouvert: string | null, props: Partial<Parameters<typeof BlocTracks>[0]> = {}) {
	return render(
		<BlocTracks
			client={c}
			espace={ESPACE}
			espaces={[ESPACE, LUMEN]}
			ouvert={ouvert}
			onOuvrir={vi.fn()}
			onFermer={vi.fn()}
			onDeplace={vi.fn()}
			message={null}
			{...props}
		/>,
	)
}

describe('le bloc « Tracks » (docs/DESIGN_SYSTEM.md §5.112)', () => {
	it('liste les tracks, leurs channels et leurs affaires ; la commande nomme le track', async () => {
		const onOuvrir = vi.fn()
		monter(client().c, null, { onOuvrir })
		const ligne = await screen.findByTestId('ligne-track')
		expect(within(ligne).getAllByRole('cell').map((c) => c.textContent)).toEqual(['Formation', '1', '3', 'Déplacer vers un autre espace'])
		await userEvent.click(within(ligne).getByRole('button', { name: 'Déplacer le track Formation vers un autre espace' }))
		expect(onOuvrir).toHaveBeenCalledWith('t1')
	})

	it('ouvert : l’arrivée se choisit parmi les AUTRES espaces ; l’aperçu suit ; la saisie du nom ouvre la commande', async () => {
		const onDeplace = vi.fn()
		const { c, appels } = client()
		monter(c, 't1', { onDeplace })
		const bloc = await screen.findByTestId('bloc-deplacement')
		const choix = within(bloc).getByLabelText('Espace d’arrivée') as HTMLSelectElement
		// Le focus entre dans le premier champ du bloc ouvert (§5.13).
		await waitFor(() => expect(document.activeElement).toBe(choix))
		expect([...choix.options].map((o) => o.textContent)).toEqual(['Choisir un espace', 'Studio Lumen'])
		await userEvent.selectOptions(choix, 'w2')
		await within(bloc).findByTestId('apercu-deplacement')
		expect(appels).toContain('track_move_preview')
		expect(within(bloc).getByTestId('compte-affaires').textContent).toBe('3')
		expect(within(bloc).getByTestId('famille-referentiel').textContent).toContain('Secteur public')
		expect(within(bloc).getByTestId('adresses-domaine').textContent).toContain('lumen.test')
		const confirmer = within(bloc).getByTestId('confirmer-deplacement') as HTMLButtonElement
		expect(confirmer.disabled).toBe(true)
		await userEvent.type(within(bloc).getByTestId('saisie-nom-track'), 'Formation')
		expect(confirmer.disabled).toBe(false)
		await userEvent.click(confirmer)
		await waitFor(() => expect(onDeplace).toHaveBeenCalledWith('Track « Formation » déplacé vers Studio Lumen.'))
	})

	it('le succès : le bloc se referme, le message le dit et mène à la fiche de l’espace d’arrivée', async () => {
		const { c } = client()
		function Fiche() {
			const [ouvert, setOuvert] = useState<string | null>('t1')
			const [message, setMessage] = useState<Message>(null)
			return (
				<BlocTracks
					client={c}
					espace={ESPACE}
					espaces={[ESPACE, LUMEN]}
					ouvert={ouvert}
					onOuvrir={setOuvert}
					onFermer={() => setOuvert(null)}
					onDeplace={(texte) => {
						setOuvert(null)
						setMessage({ ton: 'succes', texte })
					}}
					message={message}
				/>
			)
		}
		render(
			<MemoryRouter>
				<Fiche />
			</MemoryRouter>,
		)
		const bloc = await screen.findByTestId('bloc-deplacement')
		await userEvent.selectOptions(within(bloc).getByLabelText('Espace d’arrivée'), 'w2')
		await userEvent.type(await within(bloc).findByTestId('saisie-nom-track'), 'Formation')
		await userEvent.click(within(bloc).getByTestId('confirmer-deplacement'))
		const message = await screen.findByTestId('message-tracks')
		expect(message.getAttribute('role')).toBe('status')
		expect(message.textContent).toContain('Track « Formation » déplacé vers Studio Lumen.')
		expect(within(message).getByRole('link', { name: 'Ouvrir la fiche de Studio Lumen' }).getAttribute('href')).toBe('/plateforme/espaces/studio-lumen')
		expect(screen.queryByTestId('bloc-deplacement')).toBeNull()
	})

	it('des refus : listés par une alerte, et AUCUNE commande de déplacement', async () => {
		const { c } = client({ refus: [{ code: 'non_member', items: [{ name: 'Driss Lemoine' }] }] })
		monter(c, 't1')
		const bloc = await screen.findByTestId('bloc-deplacement')
		await userEvent.selectOptions(within(bloc).getByLabelText('Espace d’arrivée'), 'w2')
		const alerte = await within(bloc).findByTestId('refus-deplacement')
		expect(alerte.getAttribute('role')).toBe('alert')
		expect(alerte.textContent).toContain('Personnes qui ne sont pas membres de Studio Lumen')
		expect(alerte.textContent).toContain('Driss Lemoine')
		expect(within(bloc).queryByTestId('confirmer-deplacement')).toBeNull()
		expect(within(bloc).queryByTestId('saisie-nom-track')).toBeNull()
	})

	it('un refus recalculé par la base remplace l’aperçu par sa liste', async () => {
		const { c } = client({
			deplacement: { data: null, error: { message: 'track_move_refused', details: JSON.stringify([{ code: 'queued_send', items: [{ title: 'A', subject: 'Devis' }] }]) }, status: 400 },
		})
		monter(c, 't1')
		const bloc = await screen.findByTestId('bloc-deplacement')
		await userEvent.selectOptions(within(bloc).getByLabelText('Espace d’arrivée'), 'w2')
		await userEvent.type(await within(bloc).findByTestId('saisie-nom-track'), 'Formation')
		await userEvent.click(within(bloc).getByTestId('confirmer-deplacement'))
		expect((await within(bloc).findByTestId('refus-deplacement')).textContent).toContain('A — Devis')
	})

	it('`Échap` referme le bloc', async () => {
		const onFermer = vi.fn()
		monter(client().c, 't1', { onFermer })
		await screen.findByTestId('bloc-deplacement')
		await userEvent.keyboard('{Escape}')
		expect(onFermer).toHaveBeenCalled()
	})
})
