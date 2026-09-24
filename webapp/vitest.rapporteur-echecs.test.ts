// @verifies docs/BACKLOG.md « Correctifs arbitrés », INC-189 c ; docs/JOURNAL.md décision 594 — une
//           exécution unitaire rouge laisse son journal, une exécution verte n'écrit rien, et seuls
//           les plus récents sont gardés
// @verifies CRM-008 (docs/BACKLOG.md) — harnais de tests ; docs/SPEC-test-harness.md §6.1

import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { TestModule } from 'vitest/node'
import RapporteurEchecs, {
	composerJournal,
	journauxASupprimer,
	nomJournal,
	texteErreur,
} from './vitest.rapporteur-echecs'

/** Module de test minimal : seules les trois lectures du rapporteur sont fournies. */
function module(
	relativeModuleId: string,
	tests: ReadonlyArray<{ readonly nom: string; readonly erreurs?: readonly string[] }>,
	erreursHorsTests: readonly string[] = [],
): TestModule {
	return {
		relativeModuleId,
		errors: () => erreursHorsTests.map((message) => ({ message })),
		children: {
			*allTests() {
				for (const test of tests) {
					yield {
						fullName: test.nom,
						result: () =>
							test.erreurs === undefined
								? { state: 'passed', errors: undefined }
								: { state: 'failed', errors: test.erreurs.map((message) => ({ message })) },
					}
				}
			},
		},
	} as unknown as TestModule
}

const repertoires: string[] = []
function repertoireJetable(): string {
	const repertoire = mkdtempSync(join(tmpdir(), 'journaux-unitaires-'))
	repertoires.push(repertoire)
	return repertoire
}
afterEach(() => {
	for (const repertoire of repertoires.splice(0)) rmSync(repertoire, { recursive: true, force: true })
})

const INSTANT = new Date('2026-09-24T08:15:30.123Z')
/** Les preuves ne polluent pas la sortie de la suite avec des annonces de journaux jetables. */
const silence = () => {}

describe('le nom et le contenu du journal', () => {
	it('horodate le nom, si bien que l’ordre alphabétique est l’ordre chronologique', () => {
		expect(nomJournal(INSTANT, 4242)).toBe('unitaires-2026-09-24T08-15-30-123Z-4242.log')
		expect(nomJournal(new Date('2026-09-24T08:15:30.124Z'), 1) > nomJournal(INSTANT, 9999)).toBe(true)
	})

	it('rend la pile quand elle existe, sinon le nom et le message, puis l’écart attendu / reçu', () => {
		expect(texteErreur({ message: 'boum', stack: 'Error: boum\n    at x' })).toBe('Error: boum\n    at x')
		expect(texteErreur({ message: 'boum', name: 'AssertionError' })).toBe('AssertionError: boum')
		expect(texteErreur({ message: 'boum', diff: '- 268\n+ 260' })).toBe('Error: boum\n- 268\n+ 260')
	})

	it('nomme chaque test en échec avec son fichier, ses erreurs, et le contexte de l’exécution', () => {
		const journal = composerJournal({
			instant: INSTANT,
			commande: 'vitest run --config webapp/vitest.config.ts',
			repertoire: '/depot',
			fuseau: 'Pacific/Kiritimati',
			raison: 'failed',
			echecs: [{ fichier: 'src/app/routes.test.tsx', test: 'table des routes > /ma-journee', erreurs: ['Error: expiré'] }],
			horsTests: ['src/app/X.test.tsx\nError: import raté'],
		})
		expect(journal).toContain('Exécution unitaire ROUGE — 2026-09-24T08:15:30.123Z')
		expect(journal).toContain('Fuseau     : Pacific/Kiritimati')
		expect(journal).toContain('Issue      : failed — 1 test(s) en échec, 1 erreur(s) hors test')
		expect(journal).toContain('× src/app/routes.test.tsx › table des routes > /ma-journee\nError: expiré')
		expect(journal).toContain('× hors test\nsrc/app/X.test.tsx\nError: import raté')
	})
})

describe('la rétention', () => {
	it('garde les plus récents, et ne touche jamais un fichier qui n’est pas le sien', () => {
		const noms = [
			'unitaires-2026-09-24T08-00-00-000Z-1.log',
			'unitaires-2026-09-24T09-00-00-000Z-2.log',
			'unitaires-2026-09-24T10-00-00-000Z-3.log',
			'LISEZMOI.txt',
			'unitaires-brouillon.txt',
		]
		expect(journauxASupprimer(noms, 2)).toEqual(['unitaires-2026-09-24T08-00-00-000Z-1.log'])
		expect(journauxASupprimer(noms, 30)).toEqual([])
	})
})

describe('le rapporteur', () => {
	it('se construit comme Vitest le construit : avec un objet d’options, vide par défaut', () => {
		const rapporteur = new RapporteurEchecs({})
		expect(rapporteur.repertoire.endsWith('e2e/output/journaux-unitaires')).toBe(true)
		expect(rapporteur.garder).toBe(30)
	})

	it('une exécution VERTE n’écrit rien, pas même le répertoire', () => {
		const repertoire = join(repertoireJetable(), 'journaux')
		const rapporteur = new RapporteurEchecs({ repertoire, maintenant: () => INSTANT, annoncer: silence })
		rapporteur.onTestRunEnd([module('src/a.test.ts', [{ nom: 'vert' }])], [], 'passed')
		expect(rapporteur.dernierJournal).toBeNull()
		expect(() => readdirSync(repertoire)).toThrow()
	})

	it('une exécution ROUGE dépose le journal des tests en échec, et lui seul', () => {
		const repertoire = repertoireJetable()
		const rapporteur = new RapporteurEchecs({ repertoire, maintenant: () => INSTANT, annoncer: silence })
		rapporteur.onTestRunEnd(
			[
				module('src/app/Objectifs.test.tsx', [
					{ nom: 'Alt et flèche REDIMENSIONNENT', erreurs: ['AssertionError: reçu 260'] },
					{ nom: 'vert' },
				]),
			],
			[],
			'failed',
		)
		expect(rapporteur.dernierJournal).not.toBeNull()
		const journal = readFileSync(rapporteur.dernierJournal as string, 'utf8')
		expect(journal).toContain('× src/app/Objectifs.test.tsx › Alt et flèche REDIMENSIONNENT')
		expect(journal).toContain('AssertionError: reçu 260')
		expect(journal).not.toContain('› vert')
	})

	it('une erreur hors test — un import raté — suffit à rendre l’exécution rouge', () => {
		const repertoire = repertoireJetable()
		const rapporteur = new RapporteurEchecs({ repertoire, maintenant: () => INSTANT, annoncer: silence })
		rapporteur.onTestRunEnd([module('src/b.test.ts', [], ['Cannot find module'])], [], 'failed')
		expect(readFileSync(rapporteur.dernierJournal as string, 'utf8')).toContain('src/b.test.ts\nError: Cannot find module')
	})

	it('une interruption sans échec n’est pas rouge, et n’écrit rien', () => {
		const repertoire = repertoireJetable()
		const rapporteur = new RapporteurEchecs({ repertoire, maintenant: () => INSTANT, annoncer: silence })
		rapporteur.onTestRunEnd([module('src/a.test.ts', [{ nom: 'vert' }])], [], 'interrupted')
		expect(readdirSync(repertoire)).toEqual([])
	})

	it('retire les plus anciens au-delà de la limite, sans toucher aux fichiers étrangers', () => {
		const repertoire = repertoireJetable()
		writeFileSync(join(repertoire, 'unitaires-2026-09-23T00-00-00-000Z-1.log'), 'ancien')
		writeFileSync(join(repertoire, 'unitaires-2026-09-23T12-00-00-000Z-2.log'), 'moins ancien')
		writeFileSync(join(repertoire, 'LISEZMOI.txt'), 'étranger')
		const rapporteur = new RapporteurEchecs({ repertoire, garder: 2, maintenant: () => INSTANT, annoncer: silence })
		rapporteur.onTestRunEnd([module('src/a.test.ts', [{ nom: 'rouge', erreurs: ['Error: x'] }])], [], 'failed')
		expect(readdirSync(repertoire).sort()).toEqual([
			'LISEZMOI.txt',
			'unitaires-2026-09-23T12-00-00-000Z-2.log',
			nomJournal(INSTANT, process.pid),
		])
	})
})
