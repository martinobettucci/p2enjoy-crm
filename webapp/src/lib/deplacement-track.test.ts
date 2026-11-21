// @verifies CRM-162 (docs/BACKLOG.md) — tranche T2 : ce que l'écran du déplacement d'un track lit et envoie — la lecture
//           des tracks d'un espace, la projection défensive de l'aperçu, les refus classés par un dictionnaire fermé (un code
//           inconnu écarté), chaque issue du déplacement, la confirmation par le nom
// @verifies docs/SPEC-deplacement-track.md §4, §5, §6, §13 ; docs/DESIGN_SYSTEM.md §5.112

import { describe, expect, it } from 'vitest'
import {
	confirmationDeplacementValide,
	deplacerTrack,
	lireRefus,
	lireTracksEspace,
	projeterApercu,
} from './deplacement-track'
import type { ClientCrm } from './supabase'

function client(reponse: { data: unknown; error: { message: string; details?: string } | null; status: number } | Error) {
	const appels: { nom: string; args: unknown }[] = []
	const c = {
		rpc: (nom: string, args: unknown) => {
			appels.push({ nom, args })
			return reponse instanceof Error ? Promise.reject(reponse) : Promise.resolve(reponse)
		},
	} as unknown as ClientCrm
	return { c, appels }
}

const APERCU = {
	track: { id: 't1', name: 'Formation', slug: 'formation' },
	from: { id: 'w1', name: 'P2Enjoy SAS', slug: 'p2enjoy' },
	to: { id: 'w2', name: 'Studio Lumen', slug: 'studio-lumen', inbound_domain: null },
	counts: { channels: 1, cards: 3, messages: 2, attachments: 1, comments: 4, time_entries: 2, budgets: 1, costs: 1, revenues: 1, webhooks: 0, views: 0 },
	referentials: {
		workflow: { reused: [], created: [{ source: 'Cycle', target: 'Cycle (P2Enjoy SAS)' }] },
		label: { reused: [{ source: 'Secteur public', target: 'Secteur public' }], created: [] },
		inconnue: { reused: [{ source: 'x', target: 'x' }], created: [] },
	},
	costs: {
		minutes: 120,
		from: [{ currency: 'EUR', amount: 150 }],
		to: [{ currency: 'EUR', amount: '180.5' }],
		without_cost: [{ profile_id: 'p', name: 'Driss Lemoine' }],
	},
	duplicates: [{ subject: 'Relance', received_at: '2026-11-01' }],
	refusals: [],
}

describe('la lecture des tracks d’un espace (§13)', () => {
	it('appelle `plateforme_tracks` avec l’espace, et projette chaque ligne', async () => {
		const { c, appels } = client({ data: [{ id: 't1', name: 'Formation', slug: 'formation', channels: 1, cards: 3, trashed: false }], error: null, status: 200 })
		const etat = await lireTracksEspace(c, 'w1')
		expect(appels).toEqual([{ nom: 'plateforme_tracks', args: { p_ws: 'w1' } }])
		expect(etat.statut === 'pret' && etat.donnees).toEqual([
			{ id: 't1', nom: 'Formation', slug: 'formation', channels: 1, affaires: 3, corbeille: false },
		])
	})

	it('un refus de la base est un état d’erreur, jamais une liste vide', async () => {
		const { c } = client({ data: null, error: { message: 'forbidden' }, status: 403 })
		expect((await lireTracksEspace(c, 'w1')).statut).toBe('erreur')
	})
})

describe('l’aperçu (§5)', () => {
	it('projette les comptes, les référentiels connus dans l’ordre, les valeurs, les personnes sans coût et les doublons', () => {
		const a = projeterApercu(APERCU)
		expect(a.arrivee).toEqual({ id: 'w2', nom: 'Studio Lumen', slug: 'studio-lumen', domaine: null })
		expect(a.comptes).toMatchObject({ channels: 1, affaires: 3, mails: 2, pieces: 1, commentaires: 4, saisies: 2, minutes: 120 })
		// L'ordre est celui de l'écran (le workflow d'abord) ; une famille inconnue n'est pas rendue.
		expect(a.referentiels).toEqual([
			{ famille: 'workflow', reutilises: [], crees: ['Cycle (P2Enjoy SAS)'] },
			{ famille: 'label', reutilises: ['Secteur public'], crees: [] },
		])
		expect(a.valeurArrivee).toEqual([{ devise: 'EUR', montant: 180.5 }])
		expect(a.sansCout).toEqual(['Driss Lemoine'])
		expect(a.doublons).toEqual(['Relance'])
	})

	it('une réponse incomplète rend des valeurs vides, jamais un `undefined`', () => {
		const a = projeterApercu({})
		expect(a.track.nom).toBe('')
		expect(a.comptes.affaires).toBe(0)
		expect(a.referentiels).toEqual([])
		expect(a.refus).toEqual([])
	})
})

describe('les refus (§4)', () => {
	it('nomme les éléments de chaque refus, et écarte un code inconnu', () => {
		expect(
			lireRefus([
				{ code: 'non_member', items: [{ name: 'Driss Lemoine' }] },
				{ code: 'shared_card', items: [{ title: 'Infogérance', other_tracks: ['Studio web', 'Formation'] }] },
				{ code: 'field_type_conflict', items: [{ field: 'Budget', type: 'money', target_type: 'text' }] },
				{ code: 'same_workspace', items: [] },
				{ code: 'inconnu', items: [{ name: 'x' }] },
			]),
		).toEqual([
			{ code: 'non_member', elements: ['Driss Lemoine'] },
			{ code: 'shared_card', elements: ['Infogérance — Studio web, Formation'] },
			{ code: 'field_type_conflict', elements: ['Budget (money → text)'] },
			{ code: 'same_workspace', elements: [] },
		])
	})
})

describe('le déplacement (§6)', () => {
	it('envoie le track, l’arrivée et le nom saisi, et rend le bilan', async () => {
		const { c, appels } = client({ data: { cards: 3, channels: 1 }, error: null, status: 200 })
		expect(await deplacerTrack(c, 't1', 'w2', 'Formation')).toEqual({ statut: 'deplace', affaires: 3, channels: 1 })
		expect(appels).toEqual([{ nom: 'move_track', args: { p_track_id: 't1', p_target_workspace_id: 'w2', p_confirm_name: 'Formation' } }])
	})

	it('un refus recalculé par la base rend sa liste, lue dans `details`', async () => {
		const { c } = client({
			data: null,
			error: { message: 'track_move_refused', details: JSON.stringify([{ code: 'queued_send', items: [{ title: 'A', subject: 'Devis' }] }]) },
			status: 400,
		})
		expect(await deplacerTrack(c, 't1', 'w2', 'Formation')).toEqual({ statut: 'refuse', refus: [{ code: 'queued_send', elements: ['A — Devis'] }] })
	})

	it.each([
		[{ message: 'confirmation_mismatch' }, 400, 'confirmation'],
		[{ message: 'forbidden' }, 403, 'forbidden'],
		[{ message: 'track_not_found' }, 404, 'introuvable'],
		[{ message: 'boum' }, 500, 'unknown'],
	] as const)('classe le refus %o (%i) en « %s »', async (error, status, nature) => {
		const { c } = client({ data: null, error, status })
		expect(await deplacerTrack(c, 't1', 'w2', 'Formation')).toEqual({ statut: 'echec', nature })
	})

	it('une exception du transport est le refus réseau', async () => {
		const { c } = client(new Error('réseau coupé'))
		expect(await deplacerTrack(c, 't1', 'w2', 'Formation')).toEqual({ statut: 'echec', nature: 'network' })
	})
})

describe('la confirmation par le nom (§5.112)', () => {
	it('exige le nom, aux blancs des bords près, la casse comprise', () => {
		expect(confirmationDeplacementValide(' Formation ', 'Formation')).toBe(true)
		expect(confirmationDeplacementValide('formation', 'Formation')).toBe(false)
		expect(confirmationDeplacementValide('', '')).toBe(false)
	})
})
