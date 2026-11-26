// @verifies INC-371 (docs/BACKLOG.md « Correctif — INC-371 ») — un jeton interne gardé par un harnais n'est jamais réemployé après une opération longue sans être redemandé :
//           le jeton interne d'un script vaut 300 s au plus (scripts/lib/sso.sh, CRM-092) et INC-370 a rendu 401 « JWT expired » au lieu de 403
// @verifies docs/SPEC-test-harness.md §3.18 ; docs/INCONSISTENCY_REPORT.md INC-370, INC-371
//
// Le contrôle lit les sources, il ne mesure aucune durée : une opération longue (reconstruction de la base, build, suites e2e, `test:sql`) entre l'obtention d'un jeton et un emploi
// ultérieur exige une nouvelle affectation de la variable entre les deux. Un appel de fonction qui reconstruit PUIS redemande ses jetons (`rejouer_14`) est admis : c'est la définition
// de la fonction qui porte l'opération et la nouvelle affectation.

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const AFFECTATION = /^\s*([A-Za-z_][A-Za-z_0-9]*)=\$\((?:jeton_de|sso_jeton_interne)\b/
const OPERATION_LONGUE =
	/reconstruire_base_dev|npm run (?:build|e2e|test:sql)|playwright test|docker (?:compose )?(?:build|up)\b|supabase db reset/

export interface Defaut {
	variable: string
	ligneEmploi: number
	ligneOperation: number
}

/** Les jetons réemployés après une opération longue sans nouvelle affectation entre les deux. */
export function jetonsReemployesApresOperationLongue(texte: string): Defaut[] {
	const lignes = texte.split('\n')
	const affectations = new Map<string, number[]>()
	lignes.forEach((ligne, i) => {
		const m = AFFECTATION.exec(ligne)
		if (m !== null) affectations.set(m[1] as string, [...(affectations.get(m[1] as string) ?? []), i + 1])
	})
	const operations: number[] = []
	lignes.forEach((ligne, i) => {
		if (!ligne.trimStart().startsWith('#') && OPERATION_LONGUE.test(ligne)) operations.push(i + 1)
	})
	const defauts: Defaut[] = []
	for (const [variable, lieux] of affectations) {
		const premiere = Math.min(...lieux)
		const emploi = new RegExp(`\\$\\{?${variable}\\b`)
		lignes.forEach((ligne, i) => {
			const numero = i + 1
			if (numero <= premiere || ligne.trimStart().startsWith('#') || lieux.includes(numero) || !emploi.test(ligne)) return
			const derniereOperation = Math.max(0, ...operations.filter((o) => o > premiere && o < numero))
			if (derniereOperation === 0) return
			const redemande = lieux.some((a) => a > derniereOperation && a < numero)
			if (!redemande) defauts.push({ variable, ligneEmploi: numero, ligneOperation: derniereOperation })
		})
	}
	return defauts
}

function harnais(): string[] {
	return readdirSync('scripts')
		.filter((nom) => /^verify-.*\.sh$/.test(nom))
		.map((nom) => join('scripts', nom))
		.filter((chemin) => readFileSync(chemin, 'utf8').includes('sso_jeton_interne'))
}

describe('l’analyse des jetons gardés (INC-371)', () => {
	it('refuse un jeton réemployé après une reconstruction sans être redemandé', () => {
		const texte = ['T_ADMIN=$(jeton_de "$MAIL")', 'reconstruire_base_dev', 'curl -H "Authorization: Bearer $T_ADMIN"'].join('\n')
		expect(jetonsReemployesApresOperationLongue(texte)).toEqual([{ variable: 'T_ADMIN', ligneEmploi: 3, ligneOperation: 2 }])
	})

	it('admet un jeton redemandé entre l’opération et l’emploi', () => {
		const texte = ['T_ADMIN=$(jeton_de "$MAIL")', 'reconstruire_base_dev', 'T_ADMIN=$(jeton_de "$MAIL")', 'curl "$T_ADMIN"'].join('\n')
		expect(jetonsReemployesApresOperationLongue(texte)).toEqual([])
	})

	it('admet un jeton employé avant l’opération longue, et ignore les commentaires', () => {
		const texte = ['T_ADMIN=$(jeton_de "$MAIL")', 'curl "$T_ADMIN"', '# reconstruire_base_dev', 'npm run build', '# $T_ADMIN'].join('\n')
		expect(jetonsReemployesApresOperationLongue(texte)).toEqual([])
	})

	it('admet la fonction qui reconstruit puis redemande, appelée ensuite', () => {
		const texte = [
			'T_ADMIN=$(jeton_de "$MAIL")',
			'rejouer() {',
			'\treconstruire_base_dev',
			'\tT_ADMIN=$(jeton_de "$MAIL")',
			'}',
			'rejouer',
			'curl "$T_ADMIN"',
		].join('\n')
		expect(jetonsReemployesApresOperationLongue(texte)).toEqual([])
	})
})

describe('aucun harnais ne réemploie un jeton interne après une opération longue (INC-371)', () => {
	it('il y a des harnais à lire', () => {
		expect(harnais().length).toBeGreaterThanOrEqual(19)
	})
	for (const chemin of harnais()) {
		it(`${chemin} redemande ses jetons après toute opération longue`, () => {
			expect(jetonsReemployesApresOperationLongue(readFileSync(chemin, 'utf8')), `${chemin} : jeton de 300 s réemployé`).toEqual([])
		})
	}
})
