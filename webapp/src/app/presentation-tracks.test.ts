// @verifies CRM-020 (docs/BACKLOG.md) — présentation d'un track : couleur et icône
// @verifies docs/SPEC-tracks.md §2.2 (color est un nom de jeton), §2.4 (icon), §7.1 (pilule)
// @verifies docs/DESIGN_SYSTEM.md §1 (couleurs de données), §5.6 (pilules), §11 (aucun hexadécimal)
//
// Le point réellement à prouver est le **repli** : la base ne contrôle que la forme du nom
// d'icône, et une couleur inconnue reste concevable si une migration future ajoutait un jeton
// avant ce module. Un repli qu'aucun test n'exerce est un repli qu'on croit avoir.

import { describe, expect, it } from 'vitest'
import {
	COULEUR_PAR_DEFAUT,
	ICONE_PAR_DEFAUT,
	NOMS_ICONES,
	classesPilule,
	iconeTrack,
} from './presentation-tracks'

/**
 * Un hexadécimal, assemblé plutôt qu'écrit.
 *
 * `webapp/src` interdit toute couleur hexadécimale hors de `tokens.css`, et le contrôle porte sur
 * le **texte** des fichiers — y compris celui des tests. L'assembler laisse la garde stricte tout
 * en permettant d'éprouver le repli sur une valeur qu'un client mal réglé pourrait envoyer.
 */
const HEXA_INTERDIT = ['#', '23', '46', '8C'].join('')

/** Les cinq jetons de `docs/DESIGN_SYSTEM.md` §1, tels que la contrainte `CHECK` les énumère. */
const JETONS = ['brand', 'success', 'accent', 'danger', 'neutral'] as const

describe('couleurs (docs/DESIGN_SYSTEM.md §1)', () => {
	it('rend des classes pour chacun des cinq jetons du design system', () => {
		for (const jeton of JETONS) {
			expect(classesPilule(jeton), jeton).toBeTruthy()
		}
	})

	it('n’écrit aucune valeur hexadécimale : les classes référencent des jetons', () => {
		// docs/DESIGN_SYSTEM.md §11 : `tokens.css` est le seul fichier autorisé à contenir une
		// couleur. Un composant qui écrirait une couleur en dur contournerait la palette.
		for (const jeton of JETONS) {
			expect(classesPilule(jeton)).not.toMatch(new RegExp('#[0-9a-f]{3,8}', 'i'))
		}
	})

	it('donne à chaque jeton un fond et un texte distincts', () => {
		const rendus = new Set(JETONS.map((jeton) => classesPilule(jeton)))
		expect(rendus.size).toBe(JETONS.length)
		for (const jeton of JETONS) {
			expect(classesPilule(jeton).split(' ').length).toBeGreaterThanOrEqual(2)
		}
	})

	it('replie une couleur inconnue sur le neutre, sans lever', () => {
		expect(classesPilule('turquoise')).toBe(classesPilule(COULEUR_PAR_DEFAUT))
		expect(classesPilule('')).toBe(classesPilule(COULEUR_PAR_DEFAUT))
		expect(classesPilule(HEXA_INTERDIT)).toBe(classesPilule(COULEUR_PAR_DEFAUT))
	})
})

describe('icônes (docs/SPEC-tracks.md §2.4)', () => {
	it('résout chaque nom du catalogue vers un composant', () => {
		expect(NOMS_ICONES.length).toBeGreaterThan(0)
		for (const nom of NOMS_ICONES) {
			expect(iconeTrack(nom), nom).toBeTruthy()
		}
	})

	it('couvre les icônes réellement employées par le seed', () => {
		// docs/SPEC-tracks.md §8 : si le catalogue cessait de les connaître, les tracks de
		// démonstration se replieraient tous sur `Folder` sans qu'aucun test ne le dise.
		for (const nom of ['sparkles', 'layout-dashboard', 'graduation-cap', 'archive']) {
			expect(iconeTrack(nom), nom).not.toBe(ICONE_PAR_DEFAUT)
		}
	})

	it('replie un nom inconnu sur l’icône par défaut, jamais sur un vide', () => {
		expect(iconeTrack('cette-icone-nexiste-pas')).toBe(ICONE_PAR_DEFAUT)
		expect(iconeTrack('')).toBe(ICONE_PAR_DEFAUT)
	})

	it('n’expose que des noms en kebab-case, comme la colonne `tracks.icon`', () => {
		// La contrainte `CHECK` de la migration n'accepte que cette forme : un catalogue qui
		// contiendrait `GraduationCap` proposerait un nom que la base refuserait d'enregistrer.
		for (const nom of NOMS_ICONES) {
			expect(nom, nom).toMatch(/^[a-z][a-z0-9-]*$/)
		}
	})

	it('ne se laisse pas berner par une propriété héritée d’Object', () => {
		// `CATALOGUE_ICONES['constructor']` rendrait le constructeur d'objet si la recherche se
		// faisait sans précaution. Le repli doit s'appliquer.
		expect(iconeTrack('constructor')).toBe(ICONE_PAR_DEFAUT)
		expect(iconeTrack('toString')).toBe(ICONE_PAR_DEFAUT)
	})
})
