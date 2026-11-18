// @verifies CRM-154 (docs/BACKLOG.md) — tranche T4 : réorganiser les channels depuis la barre d'onglets — la poignée rendue
//           selon la capacité, le mode déplacement au clavier (saisir, déplacer, poser, annuler), l'appel et l'ordre relu,
//           le refus écrit sous la barre et l'ordre rétabli, « Réorganiser » rendu à tous
// @verifies docs/SPEC-administration-arborescence.md §15.4 ; docs/DESIGN_SYSTEM.md §5.106 ; docs/JOURNAL.md décisions 935
//           et 938
//
// Le glisser à la souris se prouve dans le navigateur (`e2e/ui/reorganiser-channels.spec.ts`) : jsdom n'a pas de
// glisser-déposer natif. Ici, tout ce qui n'en dépend pas.

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router'
import { FournisseurEspace } from './ContexteEspace'
import type { Capacite } from '../lib/capacites'
import { pret } from '../lib/async'
import type { Channel } from '../lib/channels'
import type { ClientCrm } from '../lib/supabase'

type Reponse = { data: unknown; error: { message: string; code?: string } | null; status: number }

const injecte = vi.hoisted(() => ({
	rpc: null as null | ((fonction: string, corps: unknown) => Promise<unknown>),
	/** L'ordre que la relecture rend : la « base » de la preuve. */
	base: [] as { id: string; name: string; slug: string; archived_at: null }[],
}))

vi.mock('../lib/supabase', () => ({
	get clientCrm() {
		if (injecte.rpc === null) return null
		const chaine: Record<string, unknown> = {}
		for (const methode of ['select', 'eq', 'is', 'order']) chaine[methode] = () => chaine
		chaine['then'] = (resoudre: (valeur: unknown) => unknown) =>
			Promise.resolve({ data: injecte.base, error: null, status: 200 }).then(resoudre)
		return { rpc: injecte.rpc, from: () => chaine } as unknown as ClientCrm
	},
}))

const { TabBar } = await import('./TabBar')

const UUID_TRACK = '5eed0000-0000-4000-8000-000000000022'
const canal = (id: string, name: string, position: number): Channel => ({
	id,
	name,
	slug: name.toLowerCase(),
	position,
	workflow_id: 'wf',
	description: null,
	color: 'neutral',
})
const CHANNELS: readonly Channel[] = [canal('a', 'Refonte', 1), canal('b', 'Maintenance', 2), canal('c', 'Checklists', 3)]

function monter(administration: Capacite, options: { appels?: unknown[]; reponse?: Reponse } = {}) {
	const appels = options.appels ?? []
	injecte.rpc = async (fonction, corps) => {
		appels.push([fonction, corps])
		return options.reponse ?? { data: 3, error: null, status: 200 }
	}
	const onRelire = vi.fn()
	render(
		<MemoryRouter initialEntries={['/tracks/studio-web/refonte']}>
			<FournisseurEspace valeur={{ idWorkspace: 'w', estAdmin: false, capacites: { administration, edition: 'permise' } }}>
				<TabBar etat={pret(CHANNELS)} slugTrack="studio-web" idTrack={UUID_TRACK} onRelire={onRelire} />
			</FournisseurEspace>
		</MemoryRouter>,
	)
	return { appels, onRelire }
}

const ordreAffiche = () => screen.getAllByTestId('onglet-channel').map((onglet) => onglet.textContent)
const poignee = (nom: string) => screen.getByRole('button', { name: `Déplacer « ${nom} »` })
const annonce = () => screen.getByRole('status', { name: 'Annonces de la barre d’onglets' }).textContent

afterEach(() => {
	cleanup()
	injecte.rpc = null
	injecte.base = []
})

describe('la poignée, selon la capacité (§15.4)', () => {
	it('rendue quand l’administration est permise, ou inconnue (un défaut de lecture n’éteint rien)', () => {
		monter('permise')
		expect(screen.getAllByTestId('poignee-onglet')).toHaveLength(3)
		cleanup()
		monter('inconnue')
		expect(screen.getAllByTestId('poignee-onglet')).toHaveLength(3)
	})

	it('absente quand l’administration est refusée ou en lecture — mais « Réorganiser » reste un lien', () => {
		monter('refusee')
		expect(screen.queryAllByTestId('poignee-onglet')).toHaveLength(0)
		const lien = screen.getByRole('link', { name: 'Réorganiser' })
		expect(lien.getAttribute('href')).toBe(`/reglages/arborescence?track=${UUID_TRACK}`)
		cleanup()
		monter('en-lecture')
		expect(screen.queryAllByTestId('poignee-onglet')).toHaveLength(0)
	})

	it('le lien de l’onglet ne se tire pas ; la poignée porte ses consignes', () => {
		monter('permise')
		expect(screen.getAllByTestId('onglet-channel')[0]?.getAttribute('draggable')).toBe('false')
		expect(poignee('Refonte').getAttribute('aria-describedby')).toBeTruthy()
		expect(poignee('Refonte').getAttribute('aria-pressed')).toBe('false')
	})
})

describe('le mode déplacement au clavier (§15.4, décision 938)', () => {
	it('saisir, déplacer, poser : l’ordre change à l’écran, un appel part, l’ordre relu est annoncé', async () => {
		const { appels } = monter('permise')
		injecte.base = [
			{ id: 'b', name: 'Maintenance', slug: 'maintenance', archived_at: null },
			{ id: 'a', name: 'Refonte', slug: 'refonte', archived_at: null },
			{ id: 'c', name: 'Checklists', slug: 'checklists', archived_at: null },
		]
		const p = poignee('Refonte')
		act(() => p.focus())
		fireEvent.keyDown(p, { key: ' ' })
		expect(poignee('Refonte').getAttribute('aria-pressed')).toBe('true')
		expect(annonce()).toContain('« Refonte » saisi, rang 1 sur 3.')
		fireEvent.keyDown(poignee('Refonte'), { key: 'ArrowRight' })
		expect(ordreAffiche()).toEqual(['Maintenance', 'Refonte', 'Checklists'])
		expect(annonce()).toBe('Rang 2 sur 3.')
		expect(appels).toHaveLength(0)
		fireEvent.keyDown(poignee('Refonte'), { key: 'Enter' })
		await waitFor(() => expect(annonce()).toBe('« Refonte » placé au rang 2 sur 3.'))
		expect(appels).toEqual([['reorder_channels', { p_track_id: UUID_TRACK, p_channel_ids: ['b', 'a', 'c'] }]])
		expect(ordreAffiche()).toEqual(['Maintenance', 'Refonte', 'Checklists'])
		expect(document.activeElement).toBe(poignee('Refonte'))
	})

	it('Échap annule : l’ordre d’avant revient, rien n’est envoyé', () => {
		const { appels } = monter('permise')
		const p = poignee('Checklists')
		act(() => p.focus())
		fireEvent.keyDown(p, { key: 'Enter' })
		fireEvent.keyDown(poignee('Checklists'), { key: 'Home' })
		expect(ordreAffiche()).toEqual(['Checklists', 'Refonte', 'Maintenance'])
		fireEvent.keyDown(poignee('Checklists'), { key: 'Escape' })
		expect(ordreAffiche()).toEqual(['Refonte', 'Maintenance', 'Checklists'])
		expect(annonce()).toBe('Déplacement annulé.')
		expect(appels).toHaveLength(0)
	})

	it('posé à sa place, rien n’est envoyé', () => {
		const { appels } = monter('permise')
		const p = poignee('Maintenance')
		act(() => p.focus())
		fireEvent.keyDown(p, { key: 'Enter' })
		fireEvent.keyDown(poignee('Maintenance'), { key: 'ArrowLeft' })
		fireEvent.keyDown(poignee('Maintenance'), { key: 'ArrowRight' })
		fireEvent.keyDown(poignee('Maintenance'), { key: 'Enter' })
		expect(appels).toHaveLength(0)
		expect(annonce()).toBe('Déplacement annulé.')
	})
})

describe('les refus, sous la barre (§15.4)', () => {
	it('42501 : l’ordre d’avant revient, le refus est écrit sous la barre', async () => {
		monter('inconnue', { reponse: { data: null, error: { message: 'channel_reorder_forbidden', code: '42501' }, status: 403 } })
		const p = poignee('Refonte')
		act(() => p.focus())
		fireEvent.keyDown(p, { key: 'Enter' })
		fireEvent.keyDown(poignee('Refonte'), { key: 'End' })
		fireEvent.keyDown(poignee('Refonte'), { key: 'Enter' })
		const alerte = await screen.findByRole('alert')
		expect(alerte.textContent).toBe('Seul un administrateur de cet espace de travail peut réorganiser les channels.')
		expect(ordreAffiche()).toEqual(['Refonte', 'Maintenance', 'Checklists'])
	})

	it('23514 `channel_order_incomplete` : la liste a changé, l’hôte relit', async () => {
		const { onRelire } = monter('permise', {
			reponse: { data: null, error: { message: 'channel_order_incomplete', code: '23514' }, status: 400 },
		})
		const p = poignee('Refonte')
		act(() => p.focus())
		fireEvent.keyDown(p, { key: 'Enter' })
		fireEvent.keyDown(poignee('Refonte'), { key: 'ArrowRight' })
		fireEvent.keyDown(poignee('Refonte'), { key: 'Enter' })
		expect((await screen.findByRole('alert')).textContent).toBe(
			'La liste des channels a changé entre-temps : elle a été relue.',
		)
		expect(onRelire).toHaveBeenCalledTimes(1)
	})

	it('le refus s’efface au geste suivant', async () => {
		monter('inconnue', { reponse: { data: null, error: { message: 'x', code: '42501' }, status: 403 } })
		const p = poignee('Refonte')
		act(() => p.focus())
		fireEvent.keyDown(p, { key: 'Enter' })
		fireEvent.keyDown(poignee('Refonte'), { key: 'End' })
		fireEvent.keyDown(poignee('Refonte'), { key: 'Enter' })
		await screen.findByRole('alert')
		fireEvent.keyDown(poignee('Refonte'), { key: 'Enter' })
		expect(screen.queryByRole('alert')).toBeNull()
	})
})

describe('« Réorganiser » (§15.4)', () => {
	it('suit « Nouveau channel » et précède les entrées transverses', () => {
		monter('permise')
		const barre = screen.getByTestId('barre-onglets')
		const ordre = within(barre)
			.getAllByRole('link')
			.map((lien) => lien.getAttribute('data-testid'))
			.filter((id) => id !== 'onglet-channel')
		expect(ordre).toEqual(['commande-nouveau-channel', 'commande-reorganiser', 'onglet-couts-track'])
	})
})
