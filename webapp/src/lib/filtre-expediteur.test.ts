// @verifies CRM-156 (docs/BACKLOG.md) — tranche T4 : le filtre par expéditeur — la lecture de la clé `expediteur` qui ignore
//           une valeur mal formée et rend l'adresse en minuscules, et le motif `ilike` qui n'admet aucun joker
// @verifies docs/SPEC-mail-subsystem.md §32.9 ; docs/DESIGN_SYSTEM.md §5.109 bis

import { describe, expect, it } from 'vitest'
import { CLE_URL_EXPEDITEUR, lireExpediteurFiltre, motifExpediteur } from './filtre-expediteur'

describe('la clé `expediteur` (§32.9)', () => {
	it('s’appelle `expediteur`', () => {
		expect(CLE_URL_EXPEDITEUR).toBe('expediteur')
	})

	it('rend l’adresse rognée, en minuscules', () => {
		expect(lireExpediteurFiltre('  Spam@Exemple.TEST ')).toBe('spam@exemple.test')
	})

	it('ignore une valeur absente, vide, sans `@` ou avec un blanc intérieur', () => {
		expect(lireExpediteurFiltre(null)).toBeNull()
		expect(lireExpediteurFiltre(undefined)).toBeNull()
		expect(lireExpediteurFiltre('   ')).toBeNull()
		expect(lireExpediteurFiltre('pas-une-adresse')).toBeNull()
		expect(lireExpediteurFiltre('a b@exemple.test')).toBeNull()
	})
})

describe('le motif de comparaison', () => {
	it('échappe `%`, `_` et l’antislash : l’adresse ne devient jamais un joker', () => {
		expect(motifExpediteur('a_b%c\\d@x.fr')).toBe('a\\_b\\%c\\\\d@x.fr')
		expect(motifExpediteur('simple@x.fr')).toBe('simple@x.fr')
	})
})
