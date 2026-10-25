// @verifies CRM-016 (docs/BACKLOG.md) — aucune fonction edge ne rend `204`
// @verifies docs/SPEC-edge-functions.md §2 bis ; docs/JOURNAL.md décision 686 (INC-292)
//
// Le runtime perd par intermittence le `204` d'un worker `oneshot` (12 sur 3000, mesuré) : la règle est tenue
// par les sources elles-mêmes, et ce test la relit dans chaque module d'exécution de chaque fonction.

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const RACINE = join(__dirname, '..')

function modules(repertoire: string): string[] {
	return readdirSync(repertoire).flatMap((nom) => {
		const chemin = join(repertoire, nom)
		if (statSync(chemin).isDirectory()) return modules(chemin)
		return nom.endsWith('.ts') && !nom.endsWith('.test.ts') ? [chemin] : []
	})
}

/** Une ligne de code — commentaires exclus — qui pose le statut 204. */
const STATUT_204 = /(status\s*:\s*204\b|repondre\(\s*204\b|new Response\([^)]*204)/

describe('aucune fonction edge ne rend 204 (§2 bis)', () => {
	it('relit au moins main, example et session', () => {
		const noms = modules(RACINE).map((chemin) => chemin.slice(RACINE.length + 1))
		expect(noms).toEqual(expect.arrayContaining(['main/index.ts', 'example/handler.ts', 'session/handler.ts']))
	})

	it('aucun module ne pose le statut 204', () => {
		const fautifs = modules(RACINE).flatMap((chemin) =>
			readFileSync(chemin, 'utf8')
				.split('\n')
				.map((ligne, i) => ({ ligne: ligne.trim(), numero: i + 1 }))
				.filter(({ ligne }) => !ligne.startsWith('//') && !ligne.startsWith('*') && STATUT_204.test(ligne))
				.map(({ numero }) => `${chemin.slice(RACINE.length + 1)}:${numero}`),
		)
		expect(fautifs).toEqual([])
	})

	it('reconnaît les formes qu’il doit refuser', () => {
		for (const ligne of ['return new Response(null, { status: 204 })', "return repondre(204, null)", 'new Response(null, { status:204, headers })']) {
			expect(STATUT_204.test(ligne), ligne).toBe(true)
		}
		expect(STATUT_204.test('if (response.status === 204) {')).toBe(false)
	})
})
