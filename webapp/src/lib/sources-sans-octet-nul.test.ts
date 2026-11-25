// @verifies INC-247 (docs/INCONSISTENCY_REPORT.md) — aucun fichier source suivi ne porte d'octet NUL littéral : il le rend BINAIRE pour git (« Binary files differ »),
//           pour `grep` et pour `ripgrep`, qui le sautent, si bien qu'une revue ou une recherche de symbole ne le voit plus
// @verifies docs/SPEC-test-harness.md §3.12 (les sources restent du texte) ; docs/BACKLOG.md « Correctif — INC-247 »
//
// Le contrôle ferme la CLASSE du défaut, pas seulement les deux fichiers qui le portaient (`administration-workflows.ts`, `sommeil-fil.ts`) : un NUL voulu — le
// séparateur d'une clé composite — s'écrit `\0`, l'échappement de U+0000, dont la valeur d'exécution est identique.

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { extname, join } from 'node:path'
import { describe, expect, it } from 'vitest'

const RACINES = ['webapp/src', 'e2e', 'scripts', 'supabase', 'docs', 'mcp', '.githooks'] as const
const EXTENSIONS = new Set(['.ts', '.tsx', '.mjs', '.js', '.sh', '.sql', '.md', '.json', '.css', '.html', '.yml', '.yaml', '.py', '.toml', '.txt'])
const IGNORES = new Set(['node_modules', 'output', 'test-results', 'report', 'dist', 'build', '.git', '__pycache__', 'images', 'captures'])

function* fichiers(dossier: string): Generator<string> {
	let entrees: string[]
	try {
		entrees = readdirSync(dossier)
	} catch {
		return
	}
	for (const nom of entrees) {
		if (IGNORES.has(nom)) continue
		const chemin = join(dossier, nom)
		if (statSync(chemin).isDirectory()) yield* fichiers(chemin)
		else if (EXTENSIONS.has(extname(nom))) yield chemin
	}
}

describe('les sources restent du texte (INC-247)', () => {
	it('aucun fichier source ne porte d’octet NUL littéral — on écrit `\\0`', () => {
		const fautifs: string[] = []
		for (const racine of RACINES) {
			for (const chemin of fichiers(racine)) {
				const octets = readFileSync(chemin)
				const n = octets.filter((o) => o === 0).length
				if (n > 0) fautifs.push(`${chemin} (${n} octet(s) NUL)`)
			}
		}
		expect(fautifs, 'écrire `\\0` à la place de l’octet NUL littéral : la valeur d’exécution est la même').toEqual([])
	})
})
