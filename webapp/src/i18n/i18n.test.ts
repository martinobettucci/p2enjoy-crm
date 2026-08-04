// @verifies CRM-007 (docs/BACKLOG.md) — internationalisation et absence de texte en dur
// @verifies docs/DESIGN_SYSTEM.md §10 (aucun texte visible en dur, clés stables), §1, §11
// @verifies docs/SPEC-webapp.md §4 (jetons), §10 (internationalisation)
//
// Deux règles du design system sont ici **exécutables** plutôt que seulement écrites :
//
//   1. aucun texte visible n'est écrit en dur dans un composant (§10) ;
//   2. aucune valeur hexadécimale n'apparaît hors du fichier de jetons (§11).
//
// Une règle qu'aucun test ne peut faire échouer finit toujours par être enfreinte sans que
// personne ne s'en aperçoive.

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { fr } from './fr'
import { t } from './index'

const RACINE_SRC = join(import.meta.dirname, '..')
const FICHIER_JETONS = join(RACINE_SRC, 'styles', 'tokens.css')

function fichiers(racine: string, extensions: readonly string[]): readonly string[] {
	const trouves: string[] = []
	for (const entree of readdirSync(racine, { withFileTypes: true })) {
		const chemin = join(racine, entree.name)
		if (entree.isDirectory()) {
			trouves.push(...fichiers(chemin, extensions))
		} else if (extensions.some((extension) => entree.name.endsWith(extension))) {
			trouves.push(chemin)
		}
	}
	return trouves
}

/** Retire commentaires de bloc et de ligne : ils contiennent du français, et c'est voulu. */
function sansCommentaires(source: string): string {
	return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

const AU_MOINS_DEUX_LETTRES = /[A-Za-zÀ-ÿ]{2,}/

describe('dictionnaire', () => {
	it('rend la valeur française de chaque clé', () => {
		expect(t('app.name')).toBe('P2Enjoy CRM')
		expect(t('state.error.retry')).toBe('Réessayer')
	})

	it('ne contient aucune valeur vide', () => {
		const vides = Object.entries(fr).filter(([, valeur]) => valeur.trim() === '')
		expect(vides).toEqual([])
	})

	// Une clé morte est une trace de fonctionnalité retirée sans nettoyage, ou d'un texte
	// oublié : les deux méritent d'être vues.
	it('ne contient aucune clé morte', () => {
		const sources = fichiers(RACINE_SRC, ['.ts', '.tsx'])
			.filter((chemin) => !chemin.endsWith('fr.ts'))
			.map((chemin) => readFileSync(chemin, 'utf8'))
			.join('\n')
		const mortes = Object.keys(fr).filter((cle) => !sources.includes(`'${cle}'`))
		expect(mortes).toEqual([])
	})
})

describe('aucun texte visible en dur (docs/DESIGN_SYSTEM.md §10)', () => {
	const composants = fichiers(RACINE_SRC, ['.tsx']).filter((chemin) => !chemin.endsWith('.test.tsx'))

	it('trouve bien des composants à contrôler', () => {
		expect(composants.length).toBeGreaterThan(5)
	})

	it.each(composants)('%s ne contient aucun nœud de texte littéral', (chemin) => {
		const source = sansCommentaires(readFileSync(chemin, 'utf8'))
		// Le texte cherché est un nœud JSX : il tient sur une ligne, entre deux balises, et ne
		// contient ni accolade ni chevron. Interdire le saut de ligne évite de confondre un
		// nœud de texte avec une signature TypeScript générique, dont les chevrons encadrent
		// eux aussi du texte — `() => void` suivi d'un `EtatAsync<…>` à la ligne suivante.
		const litteraux = [...source.matchAll(/>\s*([^<>{}\n][^<>{}\n]*?)\s*</g)]
			.map((occurrence) => occurrence[1] ?? '')
			.filter((texte) => AU_MOINS_DEUX_LETTRES.test(texte))
		expect(litteraux).toEqual([])
	})

	it.each(composants)('%s ne contient aucun attribut visible littéral', (chemin) => {
		const source = sansCommentaires(readFileSync(chemin, 'utf8'))
		const attributs = [...source.matchAll(/(title|aria-label|placeholder|alt)="([^"]*)"/g)]
			.map((occurrence) => occurrence[2] ?? '')
			.filter((texte) => AU_MOINS_DEUX_LETTRES.test(texte))
		expect(attributs).toEqual([])
	})
})

describe('aucune couleur hexadécimale hors des jetons (docs/DESIGN_SYSTEM.md §11)', () => {
	const HEXADECIMAL = /#[0-9a-fA-F]{3,8}\b/

	it('le fichier de jetons en contient, lui', () => {
		expect(HEXADECIMAL.test(readFileSync(FICHIER_JETONS, 'utf8'))).toBe(true)
	})

	it.each(fichiers(RACINE_SRC, ['.ts', '.tsx', '.css']).filter((chemin) => chemin !== FICHIER_JETONS))(
		'%s n’en contient aucune',
		(chemin) => {
			const occurrences = readFileSync(chemin, 'utf8').match(new RegExp(HEXADECIMAL, 'g')) ?? []
			expect(occurrences).toEqual([])
		},
	)
})
