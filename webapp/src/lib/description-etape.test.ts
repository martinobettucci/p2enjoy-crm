// @verifies CRM-133 (docs/BACKLOG.md) — tranche T2 : la description EFFECTIVE d'une étape, sa surcharge sinon celle de son
//           nœud ; une valeur blanche vaut absence (docs/SPEC-workflow-engine.md §7 sexies.1)
import { describe, expect, it } from 'vitest'
import { descriptionEffective } from './description-etape'

describe('la description effective d’une étape (§7 sexies.1)', () => {
	it('préfère la surcharge de l’étape', () => {
		expect(descriptionEffective('Le besoin est confirmé.', 'Premier contact.')).toBe('Le besoin est confirmé.')
	})

	it('reprend celle du nœud sans surcharge, et une surcharge blanche ne compte pas', () => {
		expect(descriptionEffective(null, 'Premier contact.')).toBe('Premier contact.')
		expect(descriptionEffective(undefined, 'Premier contact.')).toBe('Premier contact.')
		expect(descriptionEffective('  \n ', 'Premier contact.')).toBe('Premier contact.')
	})

	it('rend `null` sans l’une ni l’autre : aucun bouton d’information', () => {
		expect(descriptionEffective(null, null)).toBeNull()
		expect(descriptionEffective(undefined, '   ')).toBeNull()
	})
})
