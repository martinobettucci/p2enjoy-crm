// @verifies CRM-111 (docs/BACKLOG.md) T7.5 — les autres rattachements d'une carte : le courant retiré, les chemins non
//           rendus omis, l'ordre des tracks puis des channels (docs/SPEC-rattachements.md §8 ; docs/DESIGN_SYSTEM.md §5.85)

import { describe, expect, it } from 'vitest'
import { autresRattachements } from './aussi-rattachee'

const plonge = (id: string, track: string, channel: string) => ({ id, channels: { name: channel, tracks: { name: track } } })

describe('les autres rattachements (§5.85)', () => {
	it('retire celui du channel affiché, omet un chemin non rendu, et trie par track puis channel', () => {
		expect(
			autresRattachements(
				[
					plonge('p-courant', 'Studio web', 'Refonte de site'),
					plonge('p-maint', 'Studio web', 'Maintenance'),
					{ id: 'p-masque', channels: null },
					plonge('p-conseil', 'Conseil & IA', 'Grands comptes'),
				],
				'p-courant',
			),
		).toEqual([
			{ track: 'Conseil & IA', channel: 'Grands comptes' },
			{ track: 'Studio web', channel: 'Maintenance' },
		])
	})

	it('un seul rattachement, ou aucun rendu : rien', () => {
		expect(autresRattachements([plonge('p-courant', 'Studio web', 'Refonte de site')], 'p-courant')).toEqual([])
		expect(autresRattachements(null, 'p-courant')).toEqual([])
		expect(autresRattachements(undefined, 'p-courant')).toEqual([])
	})
})
