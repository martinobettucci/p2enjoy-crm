// @verifies CRM-156 (docs/BACKLOG.md) — tranche T3 : la description de la portée envoyée à la base, le filtre explicite, la
//           traduction d'une action en appel, l'addition des paquets, l'enchaînement par curseur et l'arrêt sur un paquet
//           en échec, le compte lu en base
// @verifies docs/SPEC-mail-subsystem.md §32.2, §32.3, §32.4, §32.5, §32.5 bis ; docs/JOURNAL.md décisions 946 et 949
// @verifies CRM-161 (docs/BACKLOG.md) — tranche T1 : la portée porte l'espace (`workspace_id`), nul tant qu'il n'est pas lu —
//           docs/SPEC-mail-subsystem.md §35.3

import { describe, expect, it } from 'vitest'
import {
	COMPTE_RENDU_VIDE,
	aUnFiltreExplicite,
	additionner,
	appelAction,
	appliquerParPaquets,
	compterPortee,
	descriptionPortee,
	nombreRefus,
	type PorteeGroupee,
} from './actions-groupees'
import type { ClientCrm } from './supabase'

const BASE: PorteeGroupee = {
	idWorkspace: 'w1',
	dossier: { genre: 'non-classes' },
	seulementMoi: false,
	pastilles: [],
	expediteur: null,
	sommeilVisible: false,
	fils: null,
}

/** Un client qui rend, appel après appel, les réponses données — et garde ce qu'on lui a demandé. */
function client(reponses: readonly unknown[], appels: unknown[] = []): ClientCrm {
	let rang = 0
	return {
		rpc: async (fonction: string, corps: unknown) => {
			appels.push([fonction, corps])
			const reponse = reponses[Math.min(rang, reponses.length - 1)]
			rang += 1
			if (reponse instanceof Error) throw reponse
			return reponse
		},
	} as unknown as ClientCrm
}

describe('la description de la portée (§32.2)', () => {
	it('décrit le dossier, les filtres, le sommeil et les fils cochés, le couple et jamais la clé seule', () => {
		expect(
			descriptionPortee({
				...BASE,
				seulementMoi: true,
				pastilles: ['p1', 'p2'],
				sommeilVisible: true,
				fils: [{ workspaceId: 'w1', cleFil: '<a@x>' }],
			}),
		).toEqual({
			workspace_id: 'w1',
			folder: 'unclassified',
			only_me: true,
			label_ids: ['p1', 'p2'],
			snoozed: 'shown',
			threads: [{ workspace_id: 'w1', thread_key: '<a@x>' }],
		})
	})

	it('« tout le filtre » envoie `threads` nul ; une affaire porte son identifiant ; l’expéditeur est rogné', () => {
		const description = descriptionPortee({ ...BASE, dossier: { genre: 'card', cardId: 'c1' }, expediteur: '  a@b.fr ' })
		expect(description['threads']).toBeNull()
		expect(description['folder']).toBe('card')
		expect(description['card_id']).toBe('c1')
		expect(description['sender']).toBe('a@b.fr')
		expect(description['snoozed']).toBe('hidden')
	})

	it('CRM-161 T1 (§35.3) : la portée porte l’espace ; nul tant qu’il n’est pas lu, et la base la refuse alors', () => {
		expect(descriptionPortee(BASE)['workspace_id']).toBe('w1')
		expect(descriptionPortee({ ...BASE, idWorkspace: null })['workspace_id']).toBeNull()
	})

	it('la corbeille porte ses messages cochés ; le curseur du paquet entre sous `after`', () => {
		const description = descriptionPortee({ ...BASE, dossier: { genre: 'corbeille' }, messages: ['m1', 'm2'] }, 'm1')
		expect(description['folder']).toBe('trash')
		expect(description['message_ids']).toEqual(['m1', 'm2'])
		expect(description['after']).toBe('m1')
		expect('sender' in descriptionPortee(BASE)).toBe(false)
	})
})

describe('le filtre explicite (§32.3)', () => {
	it('une pastille, « Seulement moi » ou un expéditeur en est un ; le dossier seul, non', () => {
		expect(aUnFiltreExplicite(BASE)).toBe(false)
		expect(aUnFiltreExplicite({ ...BASE, pastilles: ['p'] })).toBe(true)
		expect(aUnFiltreExplicite({ ...BASE, seulementMoi: true })).toBe(true)
		expect(aUnFiltreExplicite({ ...BASE, expediteur: 'a@b.fr' })).toBe(true)
		expect(aUnFiltreExplicite({ ...BASE, expediteur: '   ' })).toBe(false)
	})
})

describe('l’action et son argument (§32.5)', () => {
	it('traduit chaque action en appel de la base', () => {
		expect(appelAction({ genre: 'mark_read' })).toEqual({ p_action: 'mark_read', p_argument: {} })
		expect(appelAction({ genre: 'classify', cardId: 'c1' })).toEqual({ p_action: 'classify', p_argument: { card_id: 'c1' } })
		expect(appelAction({ genre: 'snooze', jusqua: '2027-01-01T00:00:00.000Z' })).toEqual({
			p_action: 'snooze',
			p_argument: { until: '2027-01-01T00:00:00.000Z' },
		})
		expect(appelAction({ genre: 'set_label', pastille: 'p', posee: false })).toEqual({
			p_action: 'set_label',
			p_argument: { label_id: 'p', applied: false },
		})
		expect(appelAction({ genre: 'delete', partout: true })).toEqual({ p_action: 'delete', p_argument: { also_mailbox: true } })
	})
})

describe('les paquets (§32.5 bis, décision 949)', () => {
	it('additionne les paquets, refus compris, par code', () => {
		const un = additionner(COMPTE_RENDU_VIDE, { threads: 2, messages: 3, done: 2, refused: { forbidden: 1 } })
		const deux = additionner(un, { threads: 1, messages: 1, done: 0, refused: { forbidden: 1, outbound_message: 1 } })
		expect(deux).toMatchObject({ fils: 3, messages: 4, faits: 2, refus: { forbidden: 2, outbound_message: 1 } })
		expect(nombreRefus(deux)).toBe(3)
	})

	it('enchaîne les paquets par le curseur rendu, jusqu’à `next` nul, et rend la progression après chacun', async () => {
		const appels: unknown[] = []
		const progressions: number[] = []
		const compte = await appliquerParPaquets(
			client(
				[
					{ data: { threads: 2000, messages: 2000, done: 2000, refused: {}, next: 'id-2000' }, error: null, status: 200 },
					{ data: { threads: 1, messages: 1, done: 1, refused: {}, next: null }, error: null, status: 200 },
				],
				appels,
			),
			{ ...BASE, pastilles: ['p'] },
			{ genre: 'mark_read' },
			(courant) => progressions.push(courant.messages),
		)
		expect(compte).toMatchObject({ messages: 2001, faits: 2001, interruption: null })
		expect(progressions).toEqual([2000, 2001])
		expect((appels[1] as [string, { p_scope: { after?: unknown } }])[1].p_scope.after).toBe('id-2000')
		expect((appels[0] as [string, { p_scope: { after?: unknown } }])[1].p_scope.after).toBeUndefined()
	})

	it('un paquet en échec arrête la suite : les précédents restent comptés, et l’interruption est dite', async () => {
		const compte = await appliquerParPaquets(
			client([
				{ data: { threads: 2000, messages: 2000, done: 1999, refused: { forbidden: 1 }, next: 'x' }, error: null, status: 200 },
				{ data: null, error: { message: 'canceling statement due to statement timeout' }, status: 500 },
			]),
			{ ...BASE, pastilles: ['p'] },
			{ genre: 'delete', partout: false },
		)
		expect(compte.faits).toBe(1999)
		expect(compte.messages).toBe(2000)
		expect(compte.interruption).not.toBeNull()
	})

	it('un curseur qui ne bouge pas arrête la boucle au lieu de tourner sans fin', async () => {
		const appels: unknown[] = []
		await appliquerParPaquets(
			client([{ data: { threads: 1, messages: 1, done: 1, refused: {}, next: 'meme' }, error: null, status: 200 }], appels),
			{ ...BASE, pastilles: ['p'] },
			{ genre: 'mark_read' },
		)
		expect(appels).toHaveLength(2)
	})

	it('sans client, rien ne part et l’interruption est dite', async () => {
		const compte = await appliquerParPaquets(null, BASE, { genre: 'mark_read' })
		expect(compte.interruption).not.toBeNull()
	})
})

describe('le compte (§32.4)', () => {
	it('lit les fils et les messages de la portée, et rend l’erreur telle quelle', async () => {
		expect(
			await compterPortee(client([{ data: [{ thread_count: 3, message_count: 7 }], error: null, status: 200 }]), {
				...BASE,
				pastilles: ['p'],
			}),
		).toEqual({ statut: 'pret', donnees: { fils: 3, messages: 7 } })
		const refus = await compterPortee(client([{ data: null, error: { message: 'filter_required' }, status: 400 }]), BASE)
		expect(refus.statut).toBe('erreur')
	})
})
