// @verifies CRM-069 (docs/BACKLOG.md) — tranche T2 : les étiquettes sur la fiche — pastilles sous le titre, commande
//           « Étiquettes » dans la rangée de « Mettre en sommeil », panneau de cases qui écrivent au clic et reviennent si la
//           base refuse, archivée seulement décochable, catalogue vide, retour du focus
// @verifies docs/DESIGN_SYSTEM.md §5.73, §5.3 quater, §5.31 bis, §5.59 ; docs/SPEC-etiquettes-digest.md §2.2, §3
//
// L'en-tête RÉEL est monté sur un client espion qui sert le catalogue et note chaque pose ou retrait. La pile réelle est
// éprouvée par `e2e/ui/etiquettes.spec.ts`.

import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it } from 'vitest'
import { fr } from '../i18n'
import { CAPACITES_INCONNUES, type Capacite } from '../lib/capacites'
import type { Etiquette } from '../lib/etiquettes'
import type { CardOuverte } from '../lib/formulaire'
import type { ClientCrm } from '../lib/supabase'
import { FournisseurRefus } from '../components/ui/RefusCommandes'
import { FournisseurEspace } from './ContexteEspace'
import { EnTeteCard } from './EnTeteCard'

afterEach(cleanup)

const PUBLIC: Etiquette = { id: 'e-public', nom: 'Secteur public', couleur: 'brand', archivee: false }
const ANCIENNE: Etiquette = { id: 'e-ancienne', nom: 'Salon 2025', couleur: 'neutral', archivee: true }
const LUES = [
	{ id: 'e-prio', name: 'Prioritaire', color: 'danger', archived_at: null },
	{ id: 'e-public', name: 'Secteur public', color: 'brand', archived_at: null },
]

const carte = (etiquettes: readonly Etiquette[]) =>
	({
		id: 'card-1', title: 'Audit flash — Cerfrance', workflow_id: 'wf-1', workspace_id: 'ws-1', current_step_id: 's',
		email_local_part: 'c-1', amount: null, currency: 'EUR', next_action: null, next_action_at: null, archived_at: null,
		snoozed_until: null, profiles: null, workspaces: { inbound_domain: 'crm.test' },
		card_placements: [{ id: 'r-1', created_at: '2026-10-01T00:00:00Z' }], etiquettes,
	}) as unknown as CardOuverte

function client(catalogue: readonly unknown[] = LUES, ecriture: { data: unknown; error: unknown; status: number } = { data: [{ card_id: 'card-1' }], error: null, status: 201 }) {
	const ecritures: { methode: string; valeur: unknown; filtres: unknown[][] }[] = []
	const faux = {
		from: (table: string) => {
			const maillon: Record<string, unknown> = {}
			let courante: { methode: string; valeur: unknown; filtres: unknown[][] } | null = null
			maillon.select = () => maillon
			maillon.is = () => maillon
			maillon.eq = (...args: unknown[]) => {
				courante?.filtres.push(args)
				return maillon
			}
			for (const methode of ['insert', 'delete']) {
				maillon[methode] = (valeur?: unknown) => {
					courante = { methode, valeur, filtres: [] }
					ecritures.push(courante)
					return maillon
				}
			}
			maillon.then = (resoudre: (r: unknown) => unknown) =>
				resoudre(courante !== null ? ecriture : { data: table === 'labels' ? catalogue : [], error: null, status: 200 })
			return maillon
		},
	} as unknown as ClientCrm
	return { client: faux, ecritures }
}

function monter(c: ClientCrm, etiquettes: readonly Etiquette[] = [], options: { refus?: boolean; administration?: Capacite } = {}) {
	return render(
		<MemoryRouter>
			<FournisseurEspace valeur={{ idWorkspace: 'ws-1', estAdmin: false, capacites: { ...CAPACITES_INCONNUES, administration: options.administration ?? 'permise' } }}>
				<FournisseurRefus valeur={options.refus === true ? { disabled: true, 'aria-describedby': 'motif-card' } : {}}>
					<EnTeteCard card={carte(etiquettes)} client={c} copier={() => Promise.resolve(true)} />
				</FournisseurRefus>
			</FournisseurEspace>
		</MemoryRouter>,
	)
}

const commande = () => screen.getByTestId('entete-card-etiquettes') as HTMLButtonElement

describe('les étiquettes sur la fiche', () => {
	it('les pastilles sous le titre ; aucune ligne sans étiquette', () => {
		monter(client().client, [PUBLIC])
		expect(within(screen.getByTestId('entete-card-etiquettes-pastilles')).getByText('Secteur public')).toBeDefined()
		cleanup()
		monter(client().client)
		expect(screen.queryByTestId('entete-card-etiquettes-pastilles')).toBeNull()
	})

	it('la commande suit « Enregistrer comme modèle » dans la rangée de « Mettre en sommeil », et le refus de la fiche l’éteint', () => {
		monter(client().client)
		expect(screen.getByTestId('entete-card-enregistrer-modele').nextElementSibling).toBe(commande())
		expect(commande().textContent).toBe(fr['card.labels.open'])
		cleanup()
		monter(client().client, [], { refus: true })
		expect(commande().disabled).toBe(true)
		expect(commande().getAttribute('aria-describedby')).toBe('motif-card')
	})

	it('le panneau : le focus dans la première case ; cocher pose l’étiquette, la pastille paraît ; décocher la retire', async () => {
		const { client: c, ecritures } = client()
		monter(c)
		await userEvent.click(commande())
		const prio = await screen.findByRole('checkbox', { name: 'Prioritaire' })
		await waitFor(() => expect(document.activeElement).toBe(prio))
		await userEvent.click(prio)
		await waitFor(() => expect(screen.getByTestId('entete-card-etiquettes-pastilles').textContent).toContain('Prioritaire'))
		expect(ecritures[0]).toMatchObject({ methode: 'insert', valeur: { card_id: 'card-1', label_id: 'e-prio' } })
		await userEvent.click(prio)
		await waitFor(() => expect(screen.queryByTestId('entete-card-etiquettes-pastilles')).toBeNull())
		expect(ecritures[1]).toMatchObject({ methode: 'delete', filtres: [['card_id', 'card-1'], ['label_id', 'e-prio']] })
	})

	it('une archivée encore posée se décoche seulement ; un refus fait revenir la case et s’écrit dessous', async () => {
		monter(client(LUES, { data: null, error: { code: '42501', message: 'rls' }, status: 403 }).client, [ANCIENNE])
		await userEvent.click(commande())
		const ancienne = (await screen.findByRole('checkbox', { name: 'Salon 2025, étiquette archivée' })) as HTMLInputElement
		expect(ancienne.checked).toBe(true)
		expect(ancienne.disabled).toBe(false)
		const prio = screen.getByRole('checkbox', { name: 'Prioritaire' }) as HTMLInputElement
		await userEvent.click(prio)
		expect((await screen.findByRole('alert')).textContent).toContain(fr['card.labels.refus.forbidden'])
		expect(prio.checked).toBe(false)
	})

	it('catalogue vide : la phrase, et le lien des réglages pour qui administre seulement ; `Échap` rend le focus', async () => {
		monter(client([]).client)
		await userEvent.click(commande())
		const vide = await screen.findByTestId('etiquettes-catalogue-vide')
		expect(within(vide).getByRole('link', { name: fr['card.labels.empty.link'] })).toBeDefined()
		await userEvent.keyboard('{Escape}')
		await waitFor(() => expect(document.activeElement).toBe(commande()))
		cleanup()
		monter(client([]).client, [], { administration: 'refusee' })
		await userEvent.click(commande())
		expect(within(await screen.findByTestId('etiquettes-catalogue-vide')).queryByRole('link')).toBeNull()
	})
})
