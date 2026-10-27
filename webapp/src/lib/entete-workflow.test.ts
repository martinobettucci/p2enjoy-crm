// @verifies CRM-118 (docs/BACKLOG.md) — tranche T1.b : les gestes d'en-tête du workflow (renommer, définir par défaut,
//           archiver, rétablir, copier vers un track) et leurs refus traduits
// @verifies docs/SPEC-workflow-engine.md §7 quinquies.1 (les refus nommés de `set_default_workflow` et de la garde),
//           §7 quinquies.2 (les gestes et le dictionnaire fermé), §4.2 (`copy_workflow_to_track`, le nom facultatif) ;
//           docs/DESIGN_SYSTEM.md §5.3 ter (zéro ligne n'est ni un succès ni une erreur) ; CLAUDE.md §18

import { describe, expect, it } from 'vitest'
import {
	archiverWorkflow,
	classerRefusEnTete,
	copierVersTrack,
	definirParDefaut,
	renommerWorkflow,
} from './entete-workflow'
import type { ClientCrm } from './supabase'

type Reponse = { data: unknown; error: { code?: string; message: string } | null; status: number }
type Trace = { readonly appels: (readonly [string, readonly unknown[]])[] }

/** Un client espion : chaque méthode est enregistrée, la chaîne est thenable et rend la réponse fournie. */
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

const nom = (trace: Trace, methode: string) => trace.appels.find(([m]) => m === methode)?.[1]

describe('les gestes d’en-tête du workflow', () => {
	it('renomme par un PATCH de la seule colonne `name`, le nom trimé, et compte la ligne rendue', async () => {
		const { client, trace } = espion({ data: [{ id: 'w1' }], error: null, status: 200 })
		expect(await renommerWorkflow(client, 'w1', '  Cycle court ')).toEqual({ statut: 'applique', valeur: true })
		expect(nom(trace, 'from')).toEqual(['workflows'])
		expect(nom(trace, 'update')).toEqual([{ name: 'Cycle court' }])
		expect(nom(trace, 'eq')).toEqual(['id', 'w1'])
	})

	it('dit « sans effet » quand la clause USING filtre la ligne en silence', async () => {
		const { client } = espion({ data: [], error: null, status: 200 })
		expect(await renommerWorkflow(client, 'w1', 'X')).toEqual({ statut: 'sans-effet' })
	})

	it('désigne le défaut par la fonction atomique, jamais par deux écritures', async () => {
		const { client, trace } = espion({ data: { id: 'w1', is_default: true }, error: null, status: 200 })
		expect(await definirParDefaut(client, 'w1')).toEqual({ statut: 'applique', valeur: true })
		expect(nom(trace, 'rpc')).toEqual(['set_default_workflow', { p_workflow: 'w1' }])
		expect(nom(trace, 'update')).toBeUndefined()
	})

	it('archive avec un horodatage et rétablit avec null', async () => {
		const archive = espion({ data: [{ id: 'w1' }], error: null, status: 200 })
		await archiverWorkflow(archive.client, 'w1', true)
		expect((nom(archive.trace, 'update')?.[0] as { archived_at: string | null }).archived_at).not.toBeNull()
		const retabli = espion({ data: [{ id: 'w1' }], error: null, status: 200 })
		await archiverWorkflow(retabli.client, 'w1', false)
		expect(nom(retabli.trace, 'update')).toEqual([{ archived_at: null }])
	})

	it('copie vers un track sans envoyer de nom vide, et rend l’identifiant de la copie', async () => {
		const sansNom = espion({ data: 'copie-1', error: null, status: 200 })
		expect(await copierVersTrack(sansNom.client, 'w1', 't1', '  ')).toEqual({ statut: 'applique', valeur: 'copie-1' })
		expect(nom(sansNom.trace, 'rpc')).toEqual(['copy_workflow_to_track', { workflow_id: 'w1', track_id: 't1' }])
		const avecNom = espion({ data: 'copie-2', error: null, status: 200 })
		await copierVersTrack(avecNom.client, 'w1', 't1', ' Cycle conseil ')
		expect(nom(avecNom.trace, 'rpc')).toEqual([
			'copy_workflow_to_track',
			{ workflow_id: 'w1', track_id: 't1', new_name: 'Cycle conseil' },
		])
	})

	it('rend le refus classé, jamais le message brut', async () => {
		const { client } = espion({ data: null, error: { code: 'P0001', message: 'workflow_in_use : 3 channel(s)' }, status: 400 })
		expect(await archiverWorkflow(client, 'w1', true)).toEqual({
			statut: 'refus',
			refus: { nature: 'employe', channels: 3 },
		})
	})
})

describe('le dictionnaire fermé des refus d’en-tête', () => {
	it.each([
		[400, 'P0001', 'workflow_is_default', { nature: 'par-defaut' }],
		[400, 'P0001', 'workflow non global', { nature: 'non-global' }],
		[400, 'P0001', 'workflow_not_global', { nature: 'non-global' }],
		[400, 'P0001', 'workflow archive', { nature: 'archive' }],
		[400, 'P0001', 'track_not_found', { nature: 'track-introuvable' }],
		[404, 'P0002', 'workflow introuvable', { nature: 'introuvable' }],
		[400, '23514', 'new row violates check constraint "workflows_name_check"', { nature: 'nom-vide' }],
		[403, '42501', 'reserve aux administrateurs', { nature: 'interdit' }],
		[undefined, undefined, 'Failed to fetch', { nature: 'reseau' }],
		[500, 'XX000', 'boom', { nature: 'inconnu' }],
	] as const)('%s %s « %s »', (statut, code, message, attendu) => {
		expect(classerRefusEnTete(statut, code, message)).toEqual(attendu)
	})
})
