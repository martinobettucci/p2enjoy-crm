// @verifies INC-306 (docs/INCONSISTENCY_REPORT.md) — aucun script ne filtre `docker logs` par `grep -q` dans un TUBE : sous `set -o pipefail`, `grep -q` sort à la première
//           correspondance, `docker logs` reçoit `SIGPIPE` (code 141) et le tube rend un échec alors que la chaîne est présente — un faux verdict, aléatoire
// @verifies docs/SPEC-test-harness.md §3.13 (lire le journal dans une variable avant de le filtrer) ; docs/BACKLOG.md « Correctif — INC-306 »
//
// Le défaut est celui qu'INC-106 avait corrigé dans `verify-mail-sync.sh`, et qui est revenu dans `verify-mail-infra.sh` (INC-306) : ce contrôle ferme la CLASSE.
// La forme sûre lit le journal dans une variable (`journal=$(docker logs … 2>&1)`) puis `grep -q … <<<"$journal"`, ou substitue un processus (`grep -q … <(docker logs …)`).

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/** Les lignes logiques d'un script : un `\` en fin de ligne continue l'instruction. */
function lignesLogiques(texte: string): { numero: number; ligne: string }[] {
	const sortie: { numero: number; ligne: string }[] = []
	const brutes = texte.split('\n')
	for (let i = 0; i < brutes.length; i++) {
		let ligne = brutes[i] as string
		const debut = i + 1
		while (ligne.endsWith('\\') && i + 1 < brutes.length) {
			ligne = `${ligne.slice(0, -1)} ${(brutes[++i] as string).trim()}`
		}
		sortie.push({ numero: debut, ligne })
	}
	return sortie
}

const TUBE_FAUTIF = /\bdocker\s+(?:compose\s+[^|]*)?logs\b[^|]*\|\s*grep\s+-[a-zA-Z]*q/

describe('les scripts ne filtrent pas docker logs par grep -q dans un tube (INC-306)', () => {
	it('aucun script ne porte la forme `docker logs … | grep -q`', () => {
		const fautifs: string[] = []
		for (const nom of readdirSync('scripts')) {
			if (!nom.endsWith('.sh')) continue
			const texte = readFileSync(join('scripts', nom), 'utf8')
			for (const { numero, ligne } of lignesLogiques(texte)) {
				if (ligne.trimStart().startsWith('#')) continue
				if (TUBE_FAUTIF.test(ligne)) fautifs.push(`scripts/${nom}:${numero}`)
			}
		}
		expect(fautifs, 'lire le journal dans une variable avant de le filtrer : `grep -q` ferme le tube, `docker logs` reçoit SIGPIPE').toEqual([])
	})

	it('le motif sait reconnaître la forme fautive, et laisse passer les deux formes sûres', () => {
		expect(TUBE_FAUTIF.test(`docker logs "$(conteneur x)" 2>&1 | grep -q 'texte'`)).toBe(true)
		expect(TUBE_FAUTIF.test(`docker logs "$(conteneur x)" 2>&1 | grep -qE 'a|b'`)).toBe(true)
		expect(TUBE_FAUTIF.test(`docker compose logs --no-color svc | grep -q 'texte'`)).toBe(true)
		expect(TUBE_FAUTIF.test(`grep -q 'texte' <(docker logs "$(conteneur x)" 2>&1)`)).toBe(false)
		expect(TUBE_FAUTIF.test(`grep -q 'texte' <<<"$journal"`)).toBe(false)
		expect(TUBE_FAUTIF.test(`journal=$(docker logs "$(conteneur x)" 2>&1)`)).toBe(false)
	})

	it('une instruction continuée par `\\` est lue en une seule ligne logique', () => {
		const lues = lignesLogiques("if docker logs x 2>&1 \\\n\t| grep -q 'a'; then\nfi\n")
		expect(lues[0]?.ligne).toMatch(TUBE_FAUTIF)
		expect(lues[0]?.numero).toBe(1)
	})
})
