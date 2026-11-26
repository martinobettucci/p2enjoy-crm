// @verifies INC-368 (docs/BACKLOG.md « Correctif — INC-368 ») — les specs que `verify-cards.sh` et `verify-colonnes-protegees.sh` rejouent à la place des suites
//           entières existent, et chacune appartient au projet Playwright qu'elle prétend (api sous e2e/api, ui sous e2e/ui)
// @verifies docs/SPEC-test-harness.md §3.17 ; docs/INCONSISTENCY_REPORT.md INC-368
//
// Un nom de spec périmé ferait rejouer RIEN (Playwright ne trouve aucun test) : le contrôle refuse une liste vide pour une unité qui a des écrans à prouver
// et une spec absente du dépôt.

import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const HARNAIS = ['scripts/verify-cards.sh', 'scripts/verify-colonnes-protegees.sh', 'scripts/verify-workflows.sh'] as const

/** Les éléments d'un tableau bash `NOM=(a b c)` d'une ligne. */
function tableau(texte: string, nom: string): string[] | null {
	const trouve = new RegExp(`^${nom}=\\(([^)]*)\\)`, 'm').exec(texte)
	if (trouve === null) return null
	return (trouve[1] as string).split('#')[0]!.trim().split(/\s+/).filter((s) => s !== '')
}

describe('les specs d’unité des harnais existent (INC-368)', () => {
	for (const harnais of HARNAIS) {
		it(`${harnais} nomme au moins une spec d’API, toutes présentes sous e2e/api`, () => {
			const specs = tableau(readFileSync(harnais, 'utf8'), 'SPECS_API_UNITE')
			expect(specs, 'SPECS_API_UNITE est déclaré').not.toBeNull()
			expect(specs!.length, 'au moins une spec d’API').toBeGreaterThan(0)
			for (const spec of specs!) {
				expect(spec.startsWith('e2e/api/') && spec.endsWith('.spec.ts'), `${spec} est une spec d’API`).toBe(true)
				expect(existsSync(spec), `${spec} existe`).toBe(true)
			}
		})
	}

	it('une spec d’interface nommée existe sous e2e/ui ; une liste vide est admise (unité sans écran)', () => {
		for (const harnais of HARNAIS) {
			const specs = tableau(readFileSync(harnais, 'utf8'), 'SPECS_UI_UNITE') ?? []
			for (const spec of specs) {
				expect(spec.startsWith('e2e/ui/') && existsSync(spec), `${spec} existe sous e2e/ui`).toBe(true)
			}
		}
	})

	it('l’extraction lit un tableau bash et refuse son absence', () => {
		expect(tableau('X=(a b)\nSPECS_API_UNITE=(e2e/api/a.spec.ts e2e/api/b.spec.ts) # note\n', 'SPECS_API_UNITE')).toEqual(['e2e/api/a.spec.ts', 'e2e/api/b.spec.ts'])
		expect(tableau('SPECS_UI_UNITE=() # aucun écran\n', 'SPECS_UI_UNITE')).toEqual([])
		expect(tableau('rien\n', 'SPECS_API_UNITE')).toBeNull()
	})
})
