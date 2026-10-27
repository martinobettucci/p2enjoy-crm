// @verifies CRM-118 (docs/BACKLOG.md) — tranche T1.b : changer le workflow d'un channel depuis l'arborescence — lectures,
//           mapping explicite, perte consentie, refus traduits
// @verifies docs/SPEC-workflow-engine.md §7 quinquies.3 ; docs/SPEC-change-channel-workflow.md §2 (aucune source
//           devinée, l'ordre stable), §3 (les refus ; l'occupation compte TOUS les rattachements), §5 (la perte explicite)

import { describe, expect, it } from 'vitest'
import {
	changerWorkflowChannel,
	classerRefusChangement,
	composerMapping,
	lireEtapesOccupees,
	lireNomWorkflow,
	lireWorkflowsCibles,
	mappingComplet,
} from './changement-workflow-channel'
import type { ClientCrm } from './supabase'

type Reponse = {
	data: unknown
	error: { code?: string; message: string; details?: string } | null
	status: number
}
type Trace = { readonly appels: (readonly [string, readonly unknown[]])[] }

function espion(reponse: Reponse): { client: ClientCrm; trace: Trace } {
	const trace: Trace = { appels: [] }
	const chaine: Record<string, unknown> = new Proxy(
		{},
		{
			get(_cible, nom: string) {
				if (nom === 'then') return (resoudre: (r: Reponse) => unknown) => resoudre(reponse)
				return (...args: unknown[]) => {
					trace.appels.push([nom, args])
					return chaine
				}
			},
		},
	)
	return { client: chaine as unknown as ClientCrm, trace }
}

const appels = (trace: Trace, methode: string) => trace.appels.filter(([m]) => m === methode).map(([, a]) => a)

describe('les lectures du panneau', () => {
	it('compte les rattachements par étape, sans filtre d’état : archivés et corbeille comptent', async () => {
		const { client, trace } = espion({
			data: [
				{ current_step_id: 'e2', etape: { label_override: null, noeud: { label: 'Relance' } } },
				{ current_step_id: 'e1', etape: { label_override: 'Premier contact', noeud: { label: 'Prospection' } } },
				{ current_step_id: 'e2', etape: { label_override: null, noeud: { label: 'Relance' } } },
			],
			error: null,
			status: 200,
		})
		const lu = await lireEtapesOccupees(client, 'c1')
		expect(lu).toEqual({
			statut: 'pret',
			donnees: [
				{ id: 'e2', nom: 'Relance', affaires: 2 },
				{ id: 'e1', nom: 'Premier contact', affaires: 1 },
			],
		})
		expect(appels(trace, 'from')).toEqual([['card_placements']])
		expect(appels(trace, 'eq')).toEqual([['channel_id', 'c1']])
		expect(appels(trace, 'is')).toEqual([])
	})

	it('ne propose que les workflows affectables, non archivés, hors le courant', async () => {
		const { client, trace } = espion({ data: [], error: null, status: 200 })
		await lireWorkflowsCibles(client, 'ws', 't1', 'courant')
		expect(appels(trace, 'is')).toEqual([['archived_at', null]])
		expect(appels(trace, 'neq')).toEqual([['id', 'courant']])
		expect(appels(trace, 'or')).toEqual([['scope.eq.global,and(scope.eq.track,track_id.eq.t1)']])
	})
})

describe('le nom du workflow courant', () => {
	it('le lit par son identifiant, et rend `null` quand la RLS ne le rend pas', async () => {
		const lu = espion({ data: { name: 'Prospection' }, error: null, status: 200 })
		expect(await lireNomWorkflow(lu.client, 'w1')).toEqual({ statut: 'pret', donnees: 'Prospection' })
		expect(appels(lu.trace, 'eq')).toEqual([['id', 'w1']])
		const cache = espion({ data: null, error: null, status: 200 })
		expect(await lireNomWorkflow(cache.client, 'w1')).toEqual({ statut: 'pret', donnees: null })
	})
})

describe('le mapping', () => {
	it('n’invente aucune destination, et s’ordonne par étape de départ', () => {
		const choix = new Map([['e2', 'x'], ['e1', 'y'], ['e3', '']])
		expect(composerMapping(choix)).toEqual([
			{ from_step_id: 'e1', to_step_id: 'y' },
			{ from_step_id: 'e2', to_step_id: 'x' },
		])
	})

	it('n’est complet que si chaque étape occupée a une destination', () => {
		const occupees = [{ id: 'e1', nom: 'A', affaires: 1 }, { id: 'e2', nom: 'B', affaires: 1 }]
		expect(mappingComplet(occupees, new Map([['e1', 'x']]))).toBe(false)
		expect(mappingComplet(occupees, new Map([['e1', 'x'], ['e2', '']]))).toBe(false)
		expect(mappingComplet(occupees, new Map([['e1', 'x'], ['e2', 'y']]))).toBe(true)
		expect(mappingComplet([], new Map())).toBe(true)
	})
})

describe('l’appel et ses refus', () => {
	it('envoie le mapping et la perte telle que la personne l’a acceptée', async () => {
		const { client, trace } = espion({ data: [{ id: 'p1' }, { id: 'p2' }], error: null, status: 200 })
		const resultat = await changerWorkflowChannel(client, 'c1', 'w2', [{ from_step_id: 'e1', to_step_id: 'x' }], false)
		expect(resultat).toEqual({ statut: 'applique', remappes: 2 })
		expect(appels(trace, 'rpc')).toEqual([
			['change_channel_workflow', {
				channel_id: 'c1', workflow_id: 'w2', step_mapping: [{ from_step_id: 'e1', to_step_id: 'x' }],
				discard_field_values: false,
			}],
		])
	})

	it('nomme la perte et son nombre, sans jamais la consentir seul', async () => {
		const { client } = espion({
			data: null, error: { code: 'P0001', message: 'field_values_would_be_lost', details: '4' }, status: 400,
		})
		expect(await changerWorkflowChannel(client, 'c1', 'w2', [], false)).toEqual({
			statut: 'refus', refus: { nature: 'perte', reponses: 4 },
		})
	})

	it.each([
		['same_workflow', 'meme-workflow'],
		['step_mapping_incomplete', 'mapping-incomplet'],
		['step_mapping_duplicate', 'mapping-invalide'],
		['invalid_step_mapping', 'mapping-invalide'],
		['step_not_in_workflow', 'etape-hors-workflow'],
		['workflow_not_found', 'workflow-introuvable'],
		['workflow_not_compatible', 'workflow-incompatible'],
		['channel_not_found', 'channel-introuvable'],
		['forbidden', 'interdit'],
	] as const)('« %s » devient %s', (message, nature) => {
		expect(classerRefusChangement(400, 'P0001', message, undefined)).toEqual({ nature })
	})

	it('replie le reste sur l’interdiction, le réseau ou l’inconnu', () => {
		expect(classerRefusChangement(403, '42501', 'permission denied', undefined)).toEqual({ nature: 'interdit' })
		expect(classerRefusChangement(undefined, undefined, 'Failed to fetch', undefined)).toEqual({ nature: 'reseau' })
		expect(classerRefusChangement(500, 'XX000', 'boom', undefined)).toEqual({ nature: 'inconnu' })
	})
})
