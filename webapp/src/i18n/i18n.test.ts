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
import ts from 'typescript'
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

const AU_MOINS_DEUX_LETTRES = /[A-Za-zÀ-ÿ]{2,}/

/**
 * Attributs dont la valeur est **lue par l'utilisateur** — à l'écran ou par une technologie
 * d'assistance. Un `data-testid` ou un `className` porte lui aussi du texte, et il n'en est pas.
 */
const ATTRIBUTS_VISIBLES: readonly string[] = ['title', 'aria-label', 'placeholder', 'alt']

interface TexteVisible {
	readonly ligne: number
	readonly texte: string
}

/**
 * Les textes visibles écrits en dur dans une source TSX (`docs/DESIGN_SYSTEM.md` §10).
 *
 * LA SOURCE EST LUE PAR SA GRAMMAIRE, JAMAIS PAR UN MOTIF, et c'est tout le sujet d'INC-070. La
 * version précédente cherchait `>…<` par expression régulière : elle rendait la queue d'un
 * ternaire — `const etatVide = total > 0 ? undefined : (` — comme un nœud de texte, et faisait
 * échouer un composant correct. Élargir le motif aurait affaibli la garde pour accommoder une
 * écriture ; le remplacer par l'analyseur qui compile déjà le projet supprime la question
 * (`docs/JOURNAL.md`, décisions 296 et 381).
 *
 * Ce que la grammaire permet de nommer, et qu'un motif ne savait pas distinguer :
 *
 *   1. un nœud `JsxText` qui n'est pas que de l'espace — le cas courant, `<p>Bonjour</p>` ;
 *   2. une chaîne littérale rendue comme **enfant** de JSX — `<p>{'Bonjour'}</p>` ;
 *   3. la valeur littérale d'un attribut visible, écrite `="…"` ou `={'…'}`.
 *
 * Les cas 2 et 3 sous accolades échappaient à l'ancien contrôle : l'accolade lui suffisait à
 * renoncer. Ils ne sont pas un périmètre ajouté, mais la conséquence du changement de méthode.
 *
 * Les commentaires ne sont pas traités : un analyseur syntaxique ne les voit pas, ce sont des
 * trivia. Le retrait préalable des commentaires que faisait l'ancienne version disparaît avec sa
 * cause.
 */
export function textesVisiblesEnDur(source: string, chemin: string): readonly TexteVisible[] {
	const fichier = ts.createSourceFile(chemin, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
	const trouves: TexteVisible[] = []

	function retenir(noeud: ts.Node, texte: string): void {
		const nettoye = texte.trim()
		if (!AU_MOINS_DEUX_LETTRES.test(nettoye)) {
			return
		}
		const position = fichier.getLineAndCharacterOfPosition(noeud.getStart(fichier))
		trouves.push({ ligne: position.line + 1, texte: nettoye })
	}

	/** La chaîne portée par la valeur d'un attribut, qu'elle soit écrite `="…"` ou `={'…'}`. */
	function chaineLitterale(valeur: ts.JsxAttributeValue | undefined): string | undefined {
		if (valeur === undefined) {
			return undefined
		}
		if (ts.isStringLiteral(valeur)) {
			return valeur.text
		}
		if (ts.isJsxExpression(valeur) && valeur.expression !== undefined && ts.isStringLiteral(valeur.expression)) {
			return valeur.expression.text
		}
		return undefined
	}

	function parcourir(noeud: ts.Node): void {
		if (ts.isJsxText(noeud)) {
			if (!noeud.containsOnlyTriviaWhiteSpaces) {
				retenir(noeud, noeud.text)
			}
		} else if (ts.isJsxAttribute(noeud)) {
			// `name.getText` plutôt que `escapedText` : un attribut `aria-label` n'est pas un
			// identifiant JavaScript, et le nom peut aussi être qualifié (`xml:lang`).
			if (ATTRIBUTS_VISIBLES.includes(noeud.name.getText(fichier))) {
				const texte = chaineLitterale(noeud.initializer)
				if (texte !== undefined) {
					retenir(noeud, texte)
				}
			}
		} else if (ts.isJsxExpression(noeud) && noeud.expression !== undefined && ts.isStringLiteral(noeud.expression)) {
			// Une accolade sert aussi de valeur d'attribut : seul l'enfant d'un élément ou d'un
			// fragment est rendu à l'écran, et il est le seul compté ici.
			const parent = noeud.parent
			if (ts.isJsxElement(parent) || ts.isJsxFragment(parent)) {
				retenir(noeud, noeud.expression.text)
			}
		}
		ts.forEachChild(noeud, parcourir)
	}

	parcourir(fichier)
	return trouves
}

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

	it.each(composants)('%s ne contient aucun texte visible littéral', (chemin) => {
		const trouves = textesVisiblesEnDur(readFileSync(chemin, 'utf8'), chemin)
		expect(trouves).toEqual([])
	})
})

// UN DÉTECTEUR QUI NE TROUVE JAMAIS RIEN PASSE TOUS LES CONTRÔLES CI-DESSUS.
//
// La suite précédente est muette sur ce point : elle affirme que trente-huit composants sont
// propres, jamais que l'outil sait voir une faute. Cette fixture l'éprouve dans les DEUX sens, et
// c'est ce que la décision 296 exige d'elle — « prouve à la fois qu'il détecte un vrai texte UI et
// qu'il ignore la branche structurelle d'un ternaire ».
describe('le détecteur lui-même (INC-070, docs/JOURNAL.md décisions 296 et 381)', () => {
	// La forme `? undefined : (` est celle qui a réellement mis l'ancien contrôle en défaut, sur
	// `webapp/src/app/RouteTrack.tsx`. Elle est reproduite ici telle quelle plutôt que résumée :
	// une fixture qui ne porte pas le cas mesuré ne prouve pas qu'il est traité.
	const FIXTURE = `
		import { t } from './i18n'

		export function Fixture({ total }: { readonly total: number }) {
			const etatVide = total > 0 ? undefined : (
				<p>{t('liste.empty.title')}</p>
			)
			const rendu: Array<string> = []
			return (
				<section aria-label="Section de fixture" data-testid="fixture-i18n">
					<h1>Bonjour</h1>
					<p>{'Chaîne rendue comme enfant'}</p>
					<p>{t('app.name')}</p>
					<input placeholder={'Votre adresse'} title={t('champ.title')} />
					<span aria-label={t('etat.label')}>{rendu.length}</span>
					{etatVide}
				</section>
			)
		}
	`

	const trouves = textesVisiblesEnDur(FIXTURE, 'fixture.tsx')
	const textes = trouves.map((trouve) => trouve.texte)

	it('voit un nœud de texte visible', () => {
		expect(textes).toContain('Bonjour')
	})

	it('voit une chaîne littérale rendue comme enfant de JSX', () => {
		expect(textes).toContain('Chaîne rendue comme enfant')
	})

	it('voit un attribut visible littéral, écrit `="…"` comme `={\'…\'}`', () => {
		expect(textes).toContain('Section de fixture')
		expect(textes).toContain('Votre adresse')
	})

	// Le cœur d'INC-070 : rien de ce qui suit n'est un texte, et l'ancien contrôle en comptait un.
	it('ignore la queue structurelle d’un ternaire', () => {
		expect(textes).not.toContain('0 ? undefined : (')
		expect(textes.filter((texte) => texte.includes('undefined'))).toEqual([])
	})

	it('ignore une signature générique, un appel de traduction et un attribut non visible', () => {
		expect(textes.filter((texte) => texte.includes('Array'))).toEqual([])
		expect(textes.filter((texte) => texte.startsWith('liste.') || texte.startsWith('app.'))).toEqual([])
		expect(textes).not.toContain('fixture-i18n')
	})

	// Le compte exact ferme la porte au détecteur qui trouverait « aussi » autre chose : les
	// quatre textes ci-dessus sont les seuls que cette fixture contient.
	it('ne trouve QUE ces quatre textes', () => {
		expect([...textes].sort()).toEqual(
			['Bonjour', 'Chaîne rendue comme enfant', 'Section de fixture', 'Votre adresse'].sort(),
		)
	})

	it('situe chaque texte à sa ligne, pour que le diagnostic soit lisible', () => {
		const bonjour = trouves.find((trouve) => trouve.texte === 'Bonjour')
		expect(bonjour?.ligne).toBe(FIXTURE.split('\n').findIndex((ligne) => ligne.includes('<h1>')) + 1)
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
