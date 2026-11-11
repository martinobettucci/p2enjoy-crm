// @verifies CRM-141 (docs/BACKLOG.md) — tranche T4 : les pastilles d'un message — la lecture des poses et de l'état
//           d'évaluation, les deux gestes par leurs fonctions, le dictionnaire fermé des refus, et la résolution des
//           pastilles d'une ligne de liste
// @verifies docs/SPEC-mail-subsystem.md §31.2, §31.4 (refus nommés), §31.7 ; docs/DESIGN_SYSTEM.md §5.103
//
// Les droits réels sont éprouvés contre la vraie base par `e2e/api/pastilles-inbox.spec.ts` (CLAUDE.md §10).

import { describe, expect, it } from 'vitest'
import type { PastilleMail } from './pastilles-mail'
import {
	classerRefusGestePastille,
	demanderReevaluation,
	idsPosees,
	lirePastillesDuMessage,
	poserPastilleMessage,
	projeterPastillesDuMessage,
	resoudrePastilles,
} from './pastilles-message'
import type { ClientCrm } from './supabase'

type Appel = { readonly quoi: string; readonly args: readonly unknown[] }

function espion(reponses: Record<string, unknown>, rpc: unknown = { error: null, status: 204 }) {
	const appels: Appel[] = []
	const client = {
		from: (table: string) => {
			appels.push({ quoi: 'from', args: [table] })
			const maillon: Record<string, unknown> = {}
			for (const m of ['select', 'eq', 'limit']) {
				maillon[m] = (...args: unknown[]) => {
					appels.push({ quoi: m, args })
					return maillon
				}
			}
			maillon.then = (resoudre: (r: unknown) => unknown) => resoudre(reponses[table])
			return maillon
		},
		rpc: (nom: string, args: unknown) => {
			appels.push({ quoi: 'rpc', args: [nom, args] })
			if (rpc instanceof Error) return Promise.reject(rpc)
			return Promise.resolve(rpc)
		},
	} as unknown as ClientCrm
	return { client, appels }
}

const pastille = (id: string, nom: string, archivee = false): PastilleMail => ({
	id,
	idEspace: 'ws-1',
	nom,
	couleur: 'brand',
	descriptif: 'x',
	archivee,
})

describe('projeterPastillesDuMessage', () => {
	it('garde l’origine et l’état de chaque ligne ; une origine ou un état inconnus ne sont jamais devinés', () => {
		const projete = projeterPastillesDuMessage(
			[
				{ label_id: 'a', source: 'llm', applied: true },
				{ label_id: 'b', source: 'manual', applied: false },
				{ label_id: 'c', source: 'robot', applied: true },
			],
			'pending',
		)
		expect(projete.poses).toEqual([
			{ idPastille: 'a', origine: 'llm', appliquee: true },
			{ idPastille: 'b', origine: 'manual', appliquee: false },
		])
		expect(projete.evaluation).toBe('pending')
		expect(projeterPastillesDuMessage([], 'bizarre').evaluation).toBeNull()
		// Un mail envoyé n'est pas dans la file.
		expect(projeterPastillesDuMessage([], null).evaluation).toBeNull()
	})
})

describe('lirePastillesDuMessage', () => {
	it('lit les poses et l’évaluation du seul message demandé', async () => {
		const { client, appels } = espion({
			mail_message_labels: { data: [{ label_id: 'a', source: 'manual', applied: true }], error: null, status: 200 },
			mail_label_evaluations: { data: [{ state: 'failed' }], error: null, status: 200 },
		})
		const etat = await lirePastillesDuMessage(client, 'm1')
		expect(etat).toEqual({
			statut: 'pret',
			donnees: { poses: [{ idPastille: 'a', origine: 'manual', appliquee: true }], evaluation: 'failed' },
		})
		expect(appels.filter((a) => a.quoi === 'eq').map((a) => a.args)).toEqual([
			['message_id', 'm1'],
			['message_id', 'm1'],
		])
	})

	it('une erreur de l’une des deux lectures rend l’état d’erreur', async () => {
		const { client } = espion({
			mail_message_labels: { data: [], error: null, status: 200 },
			mail_label_evaluations: { data: null, error: { message: 'boom' }, status: 500 },
		})
		expect((await lirePastillesDuMessage(client, 'm1')).statut).toBe('erreur')
	})
})

describe('les gestes', () => {
	it('poser appelle `set_message_label` avec ses trois arguments ; réévaluer, `request_label_evaluation`', async () => {
		const { client, appels } = espion({})
		expect(await poserPastilleMessage(client, 'm1', 'p1', false)).toEqual({ statut: 'applique' })
		expect(await demanderReevaluation(client, 'm1')).toEqual({ statut: 'applique' })
		expect(appels.map((a) => a.args)).toEqual([
			['set_message_label', { p_message_id: 'm1', p_label_id: 'p1', p_applied: false }],
			['request_label_evaluation', { p_message_id: 'm1' }],
		])
	})

	it('un refus de la base est classé ; une exception du transport devient le refus réseau', async () => {
		const refuse = espion({}, { error: { code: '22023', message: 'label_archived' }, status: 400 })
		expect(await poserPastilleMessage(refuse.client, 'm1', 'p1', true)).toEqual({ statut: 'refus', nature: 'pastille-archivee' })
		const coupe = espion({}, new Error('réseau coupé'))
		expect(await demanderReevaluation(coupe.client, 'm1')).toEqual({ statut: 'refus', nature: 'network' })
	})
})

describe('classerRefusGestePastille — dictionnaire fermé (§31.4)', () => {
	it.each([
		[404, 'PT404', 'message_not_found', 'message-introuvable'],
		[404, 'PT404', 'label_not_found', 'pastille-introuvable'],
		[400, '22023', 'label_archived', 'pastille-archivee'],
		[400, '22023', 'outbound_message', 'mail-envoye'],
		[403, '42501', 'forbidden', 'forbidden'],
		[401, undefined, 'JWT expired', 'forbidden'],
		[0, undefined, 'fetch failed', 'network'],
		[500, 'XX000', 'boom', 'unknown'],
	] as const)('%s %s %s → %s', (statut, code, message, nature) => {
		expect(classerRefusGestePastille(statut, code, message)).toBe(nature)
	})
})

describe('la liste', () => {
	it('idsPosees ne retient que les posées', () => {
		expect(
			idsPosees([
				{ label_id: 'a', applied: true },
				{ label_id: 'b', applied: false },
			]),
		).toEqual(['a'])
		expect(idsPosees(null)).toEqual([])
	})

	it('resoudrePastilles : dans l’ordre du nom, une pastille hors du catalogue est omise, jamais une pilule sans nom', () => {
		const catalogue = new Map([
			['s', pastille('s', 'Spam')],
			['d', pastille('d', 'Devis / commande')],
			['n', pastille('n', 'Newsletter', true)],
		])
		expect(resoudrePastilles(['s', 'inconnue', 'n', 'd'], catalogue).map((p) => p.nom)).toEqual([
			'Devis / commande',
			'Newsletter',
			'Spam',
		])
	})
})
