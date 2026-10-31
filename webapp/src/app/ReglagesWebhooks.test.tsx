// @verifies CRM-073 (docs/BACKLOG.md) — tranche T3 : Réglages ▸ Webhooks — la liste (hôte seul, état, dernière remise),
//           la fiche (événements de contact éteints sous un channel), le secret montré une fois, la régénération confirmée,
//           l'historique et le renvoi, le refus de l'écran sans la capacité d'administrer
// @verifies docs/SPEC-webhooks.md §3, §4.1, §5.3, §6, §7 ; docs/DESIGN_SYSTEM.md §5.79, §5.59, §5.8
//
// L'écran RÉEL est monté sur un client espion. La pile réelle est éprouvée par `e2e/ui/webhooks.spec.ts`.

import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { fr } from '../i18n'
import { CAPACITES_INCONNUES, type Capacite } from '../lib/capacites'
import type { ClientCrm } from '../lib/supabase'
import { FournisseurEspace } from './ContexteEspace'
import { ReglagesWebhooks } from './ReglagesWebhooks'

afterEach(cleanup)

const WEBHOOKS = [
	{
		id: 'w-tableur',
		name: 'Tableur commercial',
		url: 'https://hooks.example.com/crm?jeton=secret',
		events: ['card.created', 'card.step_changed'],
		channel_id: null,
		enabled: true,
		created_at: '2026-10-31T10:00:00Z',
		derniere: [{ status: 'failed', created_at: '2026-10-31T11:00:00Z' }],
	},
]
const CHANNELS = [{ id: 'ch-refonte', name: 'Refonte de site', tracks: { id: 't-studio', name: 'Studio web' } }]
const REMISES = [
	{
		id: 'd-1',
		event: 'card.created',
		status: 'failed',
		attempts: 5,
		last_status_code: 500,
		last_error: null,
		last_attempt_at: '2026-10-31T11:00:00Z',
		created_at: '2026-10-31T10:30:00Z',
		payload: { event: 'card.created', data: { title: 'Refonte' } },
	},
]

function client(options: { readonly rpc?: Record<string, { data: unknown; error: unknown; status: number }> } = {}) {
	const appels: { nom: string; args: unknown }[] = []
	const faux = {
		from: (table: string) => {
			const maillon: Record<string, unknown> = {}
			for (const methode of ['select', 'eq', 'is', 'order', 'limit', 'update', 'delete']) {
				maillon[methode] = (args?: unknown) => {
					if (methode === 'update' || methode === 'delete') appels.push({ nom: `${methode}:${table}`, args })
					return maillon
				}
			}
			const donnees = table === 'webhook_endpoints' ? WEBHOOKS : table === 'channels' ? CHANNELS : REMISES
			maillon.then = (resoudre: (r: unknown) => unknown) => resoudre({ data: donnees, error: null, status: 200 })
			return maillon
		},
		rpc: (nom: string, args: unknown) => {
			appels.push({ nom: `rpc:${nom}`, args })
			return Promise.resolve(options.rpc?.[nom] ?? { data: null, error: { message: 'boom' }, status: 500 })
		},
	} as unknown as ClientCrm
	return { client: faux, appels }
}

function monter(c: ClientCrm, administration: Capacite = 'permise') {
	return render(
		<FournisseurEspace valeur={{ idWorkspace: 'ws-1', estAdmin: true, capacites: { ...CAPACITES_INCONNUES, administration } }}>
			<ReglagesWebhooks client={c} />
		</FournisseurEspace>,
	)
}

describe('Réglages ▸ Webhooks (docs/DESIGN_SYSTEM.md §5.79)', () => {
	it('la ligne montre le nom, l’hôte seul — jamais l’adresse et son jeton —, le compte d’événements, l’état et la dernière remise', async () => {
		monter(client().client)
		const ligne = await screen.findByTestId('ligne-webhook')
		expect(ligne.textContent).toContain('Tableur commercial')
		expect(ligne.textContent).toContain('hooks.example.com')
		expect(ligne.textContent).not.toContain('jeton')
		expect(ligne.textContent).toContain('2 événements')
		expect(ligne.textContent).toContain(fr['admin.webhooks.active'])
		expect(ligne.textContent).toContain(fr['admin.webhooks.last.failed'])
		expect(within(ligne).getByRole('button', { name: 'Historique des remises de Tableur commercial' })).toBeDefined()
	})

	it('la fiche : sous un channel, les cases des contacts s’éteignent et la phrase dit pourquoi', async () => {
		monter(client().client)
		await userEvent.click(await screen.findByTestId('nouveau-webhook'))
		expect(document.activeElement).toBe(screen.getByLabelText(fr['admin.webhooks.field.name']))
		const contact = screen.getByLabelText(fr['admin.webhooks.event.contactCreated']) as HTMLInputElement
		expect(contact.disabled).toBe(false)
		await userEvent.selectOptions(screen.getByLabelText(fr['admin.webhooks.field.channel']), 'ch-refonte')
		expect((screen.getByLabelText(fr['admin.webhooks.event.contactCreated']) as HTMLInputElement).disabled).toBe(true)
		expect(screen.getByTestId('webhook-contacts-eteints').textContent).toBe(fr['admin.webhooks.field.events.contactsOff'])
		expect(screen.getByRole('option', { name: 'Studio web — Refonte de site' })).toBeDefined()
	})

	it('la création montre le secret une seule fois, puis le referme', async () => {
		const { client: c, appels } = client({ rpc: { create_webhook_endpoint: { data: [{ id: 'w-neuf', secret: 'whsec_abc' }], error: null, status: 200 } } })
		monter(c)
		await userEvent.click(await screen.findByTestId('nouveau-webhook'))
		await userEvent.type(screen.getByLabelText(fr['admin.webhooks.field.name']), 'Automate')
		const url = screen.getByLabelText(fr['admin.webhooks.field.url'])
		await userEvent.clear(url)
		await userEvent.type(url, 'https://automate.example/hook')
		expect((screen.getByTestId('webhook-enregistrer') as HTMLButtonElement).disabled).toBe(true)
		await userEvent.click(screen.getByLabelText(fr['admin.webhooks.event.cardCreated']))
		await userEvent.click(screen.getByTestId('webhook-enregistrer'))
		expect(((await screen.findByTestId('webhook-secret')) as HTMLInputElement).value).toBe('whsec_abc')
		expect(appels.find((a) => a.nom === 'rpc:create_webhook_endpoint')?.args).toMatchObject({
			p_name: 'Automate',
			p_url: 'https://automate.example/hook',
			p_events: ['card.created'],
		})
		await userEvent.click(screen.getByTestId('webhook-secret-fermer'))
		expect(screen.queryByTestId('webhook-secret')).toBeNull()
	})

	it('régénérer demande une confirmation destructive, puis montre le nouveau secret', async () => {
		monter(client({ rpc: { rotate_webhook_secret: { data: 'whsec_neuf', error: null, status: 200 } } }).client)
		await userEvent.click(await screen.findByRole('button', { name: 'Régénérer le secret du webhook Tableur commercial' }))
		const confirmation = screen.getByTestId('confirmation-rotation')
		expect(confirmation.textContent).toContain('Régénérer le secret du webhook')
		expect(document.activeElement).toBe(screen.getByTestId('confirmation-rotation-confirmer'))
		await userEvent.click(screen.getByTestId('confirmation-rotation-confirmer'))
		expect(((await screen.findByTestId('webhook-secret')) as HTMLInputElement).value).toBe('whsec_neuf')
	})

	it('l’historique : le motif ou le code, « Renvoyer » sur une remise close, le refus traduit', async () => {
		monter(client({ rpc: { redeliver_webhook: { data: null, error: { code: 'P0001', message: 'webhook_disabled' }, status: 400 } } }).client)
		await userEvent.click(await screen.findByRole('button', { name: 'Historique des remises de Tableur commercial' }))
		const ligne = await screen.findByTestId('ligne-remise')
		expect(within(ligne).getByTestId('resultat-remise').textContent).toBe('500')
		expect(ligne.textContent).toContain('5 sur 5')
		await userEvent.click(within(ligne).getByTestId('renvoyer-remise'))
		await waitFor(() => expect(screen.getByTestId('message-historique').textContent).toBe(fr['admin.webhooks.refus.desactive']))
	})

	it('sans la capacité d’administrer, l’écran rend « Réservé aux administrateurs », sans aucune lecture', async () => {
		monter(client().client, 'refusee')
		expect(screen.getByText(fr['admin.webhooks.forbidden.title'])).toBeDefined()
		expect(screen.queryByTestId('liste-webhooks')).toBeNull()
	})
})
