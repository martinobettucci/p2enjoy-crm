// @verifies CRM-149 (docs/BACKLOG.md) — tranche T3 : le module des prompts du connecteur — la requête émise (colonnes,
//           espace), l'ordre du titre puis de l'identifiant, les écritures resserrées (ajout, modification, suppression
//           filtrée par l'identifiant), le classement fermé des refus, la panne réseau
// @verifies docs/SPEC-mcp.md §17.2, §17.3, §17.7 ; docs/DESIGN_SYSTEM.md §5.104

import { describe, expect, it } from 'vitest'
import type { ClientCrm } from './supabase'
import {
	ajouterPrompt,
	classerRefusPrompt,
	COLONNES_PROMPT,
	lirePrompts,
	modifierPrompt,
	projeterPrompts,
	supprimerPrompt,
} from './prompts-connecteur'

type Appel = { table: string; etapes: [string, unknown[]][] }

function espion(reponse: unknown, jette = false) {
	const appels: Appel[] = []
	const client = {
		from: (table: string) => {
			const appel: Appel = { table, etapes: [] }
			appels.push(appel)
			const maillon: Record<string, unknown> = {}
			for (const methode of ['select', 'eq', 'insert', 'update', 'delete']) {
				maillon[methode] = (...args: unknown[]) => {
					appel.etapes.push([methode, args])
					return maillon
				}
			}
			maillon.then = (resoudre: (r: unknown) => unknown, rejeter: (e: unknown) => unknown) =>
				jette ? rejeter(new Error('réseau')) : resoudre(reponse)
			return maillon
		},
	} as unknown as ClientCrm
	return { client, appels }
}

const SAISIE = { cle: ' faire-le-point ', titre: ' Faire le point ', description: ' Résume. ', texte: '\n Lis.\nRésume. \n' }

describe('les prompts du connecteur — lecture (docs/SPEC-mcp.md §17.3)', () => {
	it('lit les colonnes de l’espace, et les rend dans l’ordre du titre puis de l’identifiant', async () => {
		const { client, appels } = espion({
			data: [
				{ id: '2', workspace_id: 'w', key: 'b', title: 'Zèbre', description: 'd', body: 't' },
				{ id: '1', workspace_id: 'w', key: 'z', title: 'âne', description: 'd', body: 't' },
				{ id: '3', workspace_id: 'w', key: 'a', title: 'Âne', description: 'd', body: 't' },
			],
			error: null,
			status: 200,
		})
		const lu = await lirePrompts(client, 'w')
		expect(appels[0]).toEqual({ table: 'mcp_prompts', etapes: [['select', [COLONNES_PROMPT]], ['eq', ['workspace_id', 'w']]] })
		expect(lu.statut === 'pret' && lu.donnees.map((p) => p.cle)).toEqual(['a', 'z', 'b'])
	})

	it('une erreur de la base, puis une panne réseau, rendent l’état d’erreur', async () => {
		expect((await lirePrompts(espion({ data: null, error: { message: 'x' }, status: 500 }).client, 'w')).statut).toBe('erreur')
		expect((await lirePrompts(espion(null, true).client, 'w')).statut).toBe('erreur')
	})

	it('projette une ligne en prompt', () => {
		expect(projeterPrompts([{ id: '1', workspace_id: 'w', key: 'k', title: 'T', description: 'D', body: 'B' }, null])).toEqual([
			{ id: '1', cle: 'k', titre: 'T', description: 'D', texte: 'B' },
		])
	})
})

describe('les prompts du connecteur — écritures et refus (docs/SPEC-mcp.md §17.3)', () => {
	it('ajoute dans l’espace, les champs resserrés', async () => {
		const { client, appels } = espion({ data: [{ id: 'n' }], error: null, status: 201 })
		expect(await ajouterPrompt(client, 'w', SAISIE)).toEqual({ statut: 'applique' })
		expect(appels[0]!.etapes[0]).toEqual([
			'insert',
			[{ workspace_id: 'w', key: 'faire-le-point', title: 'Faire le point', description: 'Résume.', body: 'Lis.\nRésume.' }],
		])
	})

	it('modifie et supprime par l’identifiant du prompt', async () => {
		const modification = espion({ data: [{ id: 'p' }], error: null, status: 200 })
		await modifierPrompt(modification.client, 'p', SAISIE)
		expect(modification.appels[0]!.etapes.map(([m]) => m)).toEqual(['update', 'eq', 'select'])
		expect(modification.appels[0]!.etapes[1]).toEqual(['eq', ['id', 'p']])
		const suppression = espion({ data: [{ id: 'p' }], error: null, status: 200 })
		expect(await supprimerPrompt(suppression.client, 'p')).toEqual({ statut: 'applique' })
		expect(suppression.appels[0]!.etapes).toEqual([['delete', []], ['eq', ['id', 'p']], ['select', ['id']]])
	})

	it('zéro ligne touchée est un refus « sans effet » ; une panne est « réseau »', async () => {
		expect(await supprimerPrompt(espion({ data: [], error: null, status: 200 }).client, 'p')).toEqual({ statut: 'refus', nature: 'sans-effet' })
		expect(await supprimerPrompt(espion(null, true).client, 'p')).toEqual({ statut: 'refus', nature: 'network' })
	})

	it('classe les refus de la base dans un dictionnaire fermé', () => {
		expect(classerRefusPrompt(409, '23505')).toBe('cle-prise')
		expect(classerRefusPrompt(400, '23514')).toBe('forme')
		expect(classerRefusPrompt(403, '42501')).toBe('forbidden')
		expect(classerRefusPrompt(401, undefined)).toBe('forbidden')
		expect(classerRefusPrompt(0, undefined)).toBe('network')
		expect(classerRefusPrompt(500, 'XX000')).toBe('unknown')
	})
})
