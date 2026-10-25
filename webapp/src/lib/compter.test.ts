// @verifies CRM-001 (docs/BACKLOG.md) tranche INC-299 — la webapp ne compte jamais par `HEAD`
// @verifies docs/DAT.md §3.5 bis (seconde cause, décision 700) ; docs/INCONSISTENCY_REPORT.md INC-299
//
// PostgREST ferme sans l'annoncer la connexion d'un `HEAD`, et Kong la réutilisait : `502` sur une
// requête sans rapport. La forme d'un compte est donc décidée par `compter.ts`, et ce fichier garde
// qu'aucun module ne la contourne. Le parcours lit les fichiers réels : une mutation qui remettrait
// `head: true` dans un seul module le fait rougir.

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { LIMITE_COMPTE, OPTIONS_COMPTE } from './compter'

const RACINE_SRC = join(__dirname, '..')

/** Les sources de la webapp, tests exclus : un test peut nommer `head` pour en prouver l'absence. */
function sources(dossier: string): string[] {
	return readdirSync(dossier).flatMap((nom) => {
		const chemin = join(dossier, nom)
		if (statSync(chemin).isDirectory()) return sources(chemin)
		if (!/\.(ts|tsx)$/.test(nom) || /\.test\.(ts|tsx)$/.test(nom) || /\.test-d\.ts$/.test(nom)) return []
		return [chemin]
	})
}

describe('la forme d’un compte (docs/DAT.md §3.5 bis)', () => {
	it('demande le compte exact, sans `head` : la requête reste un `GET`', () => {
		expect(OPTIONS_COMPTE).toEqual({ count: 'exact' })
		expect('head' in OPTIONS_COMPTE).toBe(false)
	})

	it('borne la lecture à zéro ligne : seul le nombre transite', () => {
		expect(LIMITE_COMPTE).toBe(0)
	})

	it('aucune source de la webapp ne demande `head: true`', () => {
		const fichiers = sources(RACINE_SRC)
		// Garde contre un parcours vide, qui rendrait la preuve complaisante.
		expect(fichiers.length).toBeGreaterThan(50)
		expect(fichiers.some((chemin) => chemin.endsWith(join('lib', 'compter.ts')))).toBe(true)
		const fautifs = fichiers
			.filter((chemin) => /head\s*:\s*true/.test(readFileSync(chemin, 'utf8')))
			.map((chemin) => relative(RACINE_SRC, chemin))
		expect(fautifs).toEqual([])
	})
})
