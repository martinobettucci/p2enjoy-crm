// @verifies INC-367 (docs/BACKLOG.md « Correctif — INC-367 ») — aucune construction d'image ni aucun tirage d'un script de harnais sans borne de temps :
//           `verify-scripts.sh` est resté 13 h 24 dans une construction avec le verrou de campagne
// @verifies docs/SPEC-test-harness.md §3.16 ; docs/INCONSISTENCY_REPORT.md INC-367
//
// La forme sûre passe la commande par `borner <secondes> …` (scripts/lib/borne.sh) ou par `timeout`. Le contrôle lit chaque script de `scripts/`, de `scripts/lib/`
// et les lanceurs de la racine ; une ligne qui construit ou tire une image sans l'un des deux est un défaut nommé.

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

/** Une construction ou un tirage d'image : `docker build`, `docker pull`, `docker compose … build|pull`. */
const CONSTRUCTION = /\bdocker\s+(?:compose\s+[^|;&]*?\s)?(?:build|pull)\b/
const BORNEE = /\b(?:borner|timeout)\b/

function fichiersDeScripts(): string[] {
	const fichiers: string[] = []
	for (const dossier of ['scripts', join('scripts', 'lib')]) {
		for (const nom of readdirSync(dossier)) if (nom.endsWith('.sh')) fichiers.push(join(dossier, nom))
	}
	for (const nom of readdirSync('.')) if (nom.endsWith('.sh')) fichiers.push(nom)
	return fichiers
}

describe('aucune construction ni aucun tirage d’image sans borne de temps (INC-367)', () => {
	it('chaque `docker build`, `docker pull` et `docker compose … build` passe par `borner` ou `timeout`', () => {
		const sansBorne: string[] = []
		for (const fichier of fichiersDeScripts()) {
			for (const { numero, ligne } of lignesLogiques(readFileSync(fichier, 'utf8'))) {
				if (ligne.trimStart().startsWith('#')) continue
				if (CONSTRUCTION.test(ligne) && !BORNEE.test(ligne)) sansBorne.push(`${fichier}:${numero}`)
			}
		}
		expect(sansBorne, 'passer la commande par `borner <secondes> …` (scripts/lib/borne.sh) : sans borne, un réseau muet gèle le verrou de campagne').toEqual([])
	})

	it('le motif reconnaît les formes à borner, et laisse passer les formes bornées et les commentaires', () => {
		expect(CONSTRUCTION.test('docker build -q -t x dossier')).toBe(true)
		expect(CONSTRUCTION.test('docker pull postgres:17-alpine')).toBe(true)
		expect(CONSTRUCTION.test('NPM_CA_FILE= docker compose --env-file e -f a.yml -f b.yml build --no-cache webapp')).toBe(true)
		expect(CONSTRUCTION.test('docker compose up --wait')).toBe(false)
		expect(CONSTRUCTION.test('docker image inspect x')).toBe(false)
		expect(BORNEE.test('borner "$DELAI" docker build -q x')).toBe(true)
		expect(BORNEE.test('timeout 600 docker pull x')).toBe(true)
	})

	it('une instruction continuée par `\\` est lue en une seule ligne logique', () => {
		const lues = lignesLogiques('if NPM_CA_FILE= docker compose -f a.yml \\\n\t-f b.yml build webapp \\\n\t>log; then\nfi\n')
		expect(lues[0]?.ligne).toMatch(CONSTRUCTION)
		expect(lues[0]?.numero).toBe(1)
	})
})
