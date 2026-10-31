// @verifies CRM-073 (docs/BACKLOG.md) — tranche T3 : le module des webhooks — la projection (hôte seul, événements dans
//           l'ordre de l'écran, dernière remise), le classement des refus, les appels émis vers la base
// @verifies docs/SPEC-webhooks.md §3, §4.1, §5.3, §6, §12 ; docs/DESIGN_SYSTEM.md §5.79

import { describe, expect, it } from 'vitest'
import type { ClientCrm } from './supabase'
import {
	classerRefusWebhook,
	creerWebhook,
	hoteDe,
	modifierWebhook,
	projeterRemise,
	projeterWebhook,
	regenererSecret,
	renvoyerRemise,
} from './webhooks'

describe('projeterWebhook', () => {
	it('garde l’hôte seul, range les événements dans l’ordre de l’écran, lit la dernière remise', () => {
		const webhook = projeterWebhook({
			id: 'w1',
			name: 'Tableur',
			url: 'https://hooks.example.com:8443/crm?jeton=secret',
			events: ['contact.created', 'card.created', 'inconnu'],
			channel_id: null,
			enabled: true,
			created_at: '2026-10-31T10:00:00Z',
			derniere: [{ status: 'failed', created_at: '2026-10-31T11:00:00Z' }],
		})
		expect(webhook.hote).toBe('hooks.example.com:8443')
		expect(webhook.evenements).toEqual(['card.created', 'contact.created'])
		expect(webhook.derniere).toEqual({ etat: 'failed', le: '2026-10-31T11:00:00Z' })
	})

	it('sans remise : aucune dernière remise ; une adresse illisible se rend telle quelle', () => {
		expect(projeterWebhook({ id: 'w', name: 'n', url: 'x', events: [], channel_id: 'c', enabled: false, created_at: '', derniere: [] }).derniere).toBeNull()
		expect(hoteDe('pas une adresse')).toBe('pas une adresse')
	})
})

describe('projeterRemise', () => {
	it('lit l’état, les essais, le code ou le motif ; écarte un événement inconnu', () => {
		const base = { id: 'd1', status: 'pending', attempts: 2, last_status_code: null, last_attempt_at: null, created_at: 't', payload: { a: 1 } }
		expect(projeterRemise({ ...base, event: 'card.step_changed', last_error: 'timeout' })).toMatchObject({
			evenement: 'card.step_changed',
			etat: 'pending',
			essais: 2,
			motif: 'timeout',
			corps: { a: 1 },
		})
		expect(projeterRemise({ ...base, event: 'card.step_changed', last_error: 'bizarre' })?.motif).toBeNull()
		expect(projeterRemise({ ...base, event: 'autre', last_error: null })).toBeNull()
	})
})

describe('classerRefusWebhook', () => {
	it.each([
		[400, '23514', 'violates check constraint "webhook_endpoints_url_check"', 'adresse'],
		[400, '23514', 'violates check constraint "webhook_endpoints_name_check"', 'nom'],
		[400, '23514', 'violates check constraint "webhook_endpoints_channel_sans_contacts"', 'evenements'],
		[409, '23503', 'fk', 'channel'],
		[400, 'P0001', 'delivery_pending', 'en-attente'],
		[400, 'P0001', 'webhook_disabled', 'desactive'],
		[404, 'P0002', 'webhook_not_found', 'introuvable'],
		[403, '42501', 'forbidden', 'forbidden'],
		[undefined, undefined, 'Failed to fetch', 'network'],
		[500, 'XX000', 'boom', 'unknown'],
	] as const)('%s %s %s → %s', (statut, code, message, nature) => {
		expect(classerRefusWebhook(statut, code, message)).toBe(nature)
	})
})

function espion(reponse: { data: unknown; error: unknown; status: number }) {
	const appels: { nom: string; args: unknown }[] = []
	const maillon: Record<string, unknown> = {}
	for (const m of ['update', 'eq', 'select', 'delete']) {
		maillon[m] = (args?: unknown) => {
			appels.push({ nom: m, args })
			return maillon
		}
	}
	maillon.then = (resoudre: (r: unknown) => unknown) => resoudre(reponse)
	const client = {
		from: (table: string) => (appels.push({ nom: 'from', args: table }), maillon),
		rpc: (nom: string, args: unknown) => (appels.push({ nom: `rpc:${nom}`, args }), Promise.resolve(reponse)),
	} as unknown as ClientCrm
	return { client, appels }
}

const SAISIE = { nom: ' Tableur ', url: ' https://hooks.example.com/crm ', evenements: ['card.created'] as const, idChannel: null, actif: true }

describe('les écritures', () => {
	it('la création appelle `create_webhook_endpoint` et rend l’identifiant et le secret', async () => {
		const { client, appels } = espion({ data: [{ id: 'w1', secret: 'whsec_x' }], error: null, status: 200 })
		expect(await creerWebhook(client, 'ws-1', SAISIE)).toEqual({ statut: 'applique', valeur: { id: 'w1', secret: 'whsec_x' } })
		expect(appels[0]).toEqual({
			nom: 'rpc:create_webhook_endpoint',
			args: { p_workspace: 'ws-1', p_name: ' Tableur ', p_url: 'https://hooks.example.com/crm', p_events: ['card.created'], p_channel: undefined, p_enabled: true },
		})
	})

	it('une modification qui ne rend aucune ligne est un refus, jamais un succès', async () => {
		const { client } = espion({ data: [], error: null, status: 200 })
		expect(await modifierWebhook(client, 'w1', SAISIE)).toEqual({ statut: 'refus', nature: 'introuvable' })
	})

	it('la régénération et le renvoi rendent la valeur de la base ; un refus est classé', async () => {
		expect(await regenererSecret(espion({ data: 'whsec_neuf', error: null, status: 200 }).client, 'w1')).toEqual({ statut: 'applique', valeur: 'whsec_neuf' })
		expect(await renvoyerRemise(espion({ data: null, error: { code: 'P0001', message: 'delivery_pending' }, status: 400 }).client, 'd1')).toEqual({
			statut: 'refus',
			nature: 'en-attente',
		})
	})
})
