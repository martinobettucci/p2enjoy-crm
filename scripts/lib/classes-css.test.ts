// @verifies INC-314 et INC-334 (docs/BACKLOG.md « Relevé du 2026-11-25 », lot A ; décision 992) — le contrôle des classes lit les
//           gabarits à interpolation et leurs chaînes, ne prend pas une chaîne de comparaison pour une classe, et reste
//           vert sur le CSS qui porte tout ce qui est cité (scripts/lib/classes-css.mjs ; docs/DESIGN_SYSTEM.md §3, §11)
//
// Le vrai script, lancé comme les harnais le lancent (`node scripts/lib/classes-css.mjs <src> <dist>`), sur une source et un
// CSS jetables : ce qu'on prouve est le verdict qu'il rend, son code de sortie et ce qu'il nomme.

import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const SCRIPT = resolve(import.meta.dirname, 'classes-css.mjs')
const jetables: string[] = []

/** Un CSS qui engendre ces classes, et une source qui contient `composant` ; rend le verdict du script. */
function controler(composant: string, classesEngendrees: readonly string[]) {
	const racine = mkdtempSync(join(tmpdir(), 'classes-css-'))
	jetables.push(racine)
	mkdirSync(join(racine, 'src'))
	mkdirSync(join(racine, 'dist'))
	writeFileSync(join(racine, 'src', 'Composant.tsx'), composant)
	const selecteurs = classesEngendrees.map((c) => `.${c.replace(/[.[\]()/%,#:]/g, (x) => `\\${x}`)}{}`).join('\n')
	writeFileSync(join(racine, 'dist', 'a.css'), selecteurs)
	try {
		const sortie = execFileSync('node', [SCRIPT, join(racine, 'src'), join(racine, 'dist')], { encoding: 'utf8', stdio: 'pipe' })
		return { code: 0, texte: sortie }
	} catch (erreur) {
		const e = erreur as { status: number; stdout: string; stderr: string }
		return { code: e.status, texte: `${e.stdout}${e.stderr}` }
	}
}

afterEach(() => {
	for (const dossier of jetables.splice(0)) rmSync(dossier, { recursive: true, force: true })
})

describe('classes-css.mjs — INC-314 : les gabarits à interpolation', () => {
	it('lit une classe écrite avant une interpolation (le cas de la pastille de channel)', () => {
		const verdict = controler('export const A = () => <i className={`mr-1.5 size-2 ${x}`} />', ['size-2'])
		expect(verdict.code).toBe(1)
		expect(verdict.texte).toContain('mr-1.5')
	})

	it("lit une classe écrite après l'interpolation", () => {
		const verdict = controler('export const A = () => <i className={`${CLASSES_CHAMP} w-32`} />', [])
		expect(verdict.code).toBe(1)
		expect(verdict.texte).toContain('w-32')
	})

	it("lit les chaînes d'une interpolation, y compris celles qui contiennent une accolade", () => {
		const verdict = controler("export const A = () => <i className={`flex ${actif ? 'pl-5' : '}'} gap-2`} />", ['flex', 'gap-2'])
		expect(verdict.code).toBe(1)
		expect(verdict.texte).toContain('pl-5')
	})

	it('reste vert quand le CSS porte tout ce que le gabarit cite', () => {
		const verdict = controler('export const A = () => <i className={`flex ${x} gap-2`} />', ['flex', 'gap-2'])
		expect(verdict.code).toBe(0)
		expect(verdict.texte).toContain('aucune classe manquante')
	})

	it("lit encore les formes d'avant : chaîne simple, tableau joint, constante CLASSES_*", () => {
		const verdict = controler(
			["const CLASSES_X = 'text-sm absente-constante'", 'export const A = () => <i className="p-4" /> '].join('\n') +
				"\nexport const B = () => <i className={['gap-2', 'absente-tableau'].join(' ')} />",
			['text-sm', 'p-4', 'gap-2'],
		)
		expect(verdict.code).toBe(1)
		expect(verdict.texte).toContain('absente-constante')
		expect(verdict.texte).toContain('absente-tableau')
	})
})

describe('classes-css.mjs — INC-334 : une chaîne de comparaison n’est pas une classe', () => {
	it("ne prend pas l'opérande de `===` pour une classe, et lit les deux branches du ternaire", () => {
		const verdict = controler(
			"export const A = () => <p className={message.role === 'alert' ? 'text-danger' : 'text-sm'} />",
			['text-danger', 'text-sm'],
		)
		expect(verdict.code).toBe(0)
	})

	it('couvre les quatre opérateurs et l’opérande à gauche (INC-184 : `statut === …` dans un className)', () => {
		const verdict = controler(
			[
				"export const A = () => <p className={statut === 'enregistre' ? 'text-ok' : 'text-ko'} />",
				"export const B = () => <p className={'brouillon' !== statut ? 'text-ok' : 'text-ko'} />",
				"export const C = () => <p className={statut == 'x' ? 'text-ok' : 'text-ko'} />",
				"export const D = () => <p className={statut != 'y' ? 'text-ok' : 'text-ko'} />",
			].join('\n'),
			['text-ok', 'text-ko'],
		)
		expect(verdict.code).toBe(0)
		expect(verdict.texte).not.toContain('enregistre')
	})

	it('lit toujours une vraie classe absente à côté de la comparaison', () => {
		const verdict = controler("export const A = () => <p className={r === 'alert' ? 'absente-ok' : 'text-sm'} />", ['text-sm'])
		expect(verdict.code).toBe(1)
		expect(verdict.texte).toContain('absente-ok')
		expect(verdict.texte).not.toContain('alert ')
	})
})
