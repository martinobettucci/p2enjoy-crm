// @verifies CRM-117 (docs/BACKLOG.md) — tranche T4.0 : la découpe, le manifeste et la preuve « un élément cité, une image »
// @verifies docs/SPEC-manual.md §11.1 (strict minimum, pleine page en tête de chapitre), §11.2 (orpheline, absente,
//           élément cité sans image), §11.3 (les exceptions), §11.4 (le contrat technique)
//
// Le module est pur : chaque cas lui donne un manuel, un manifeste ou un catalogue, et lit ce qu'il rend.

import { describe, expect, it } from 'vitest'
import {
	cadrer,
	controlerIllustration,
	controlerImages,
	elementsCites,
	exceptionsDeLaSpecification,
	fusionnerManifeste,
	normaliserLibelle,
	valeursInterface,
	type EntreeManifeste,
} from './images.mjs'

const FR = [
	'export const fr = {',
	"\t'a': 'Nouveau channel',",
	"\t'b': 'Fermer l’aide',",
	'\t\'c\':',
	'\t\t"Aucun channel dans ce track",',
	"\t'd': 'Page {rang} sur {pages}',",
	"\t'e': '{prenom} {nom}',",
	"\t'f': '{track} › {channel}',",
	'}',
].join('\n')
const VALEURS = valeursInterface(FR)

const MANUEL = [
	'## 3. Naviguer',
	'',
	'![La page entière](manuel/images/naviguer/page.jpg)',
	'',
	'### 3.1 Les onglets',
	'',
	'Le bouton « Nouveau channel » ouvre le formulaire ; « Aucun channel',
	'dans ce track » le dit, et « Page 2 sur 5 » aussi. « Pas un libellé » ne compte pas.',
	'',
	'![Le formulaire](manuel/images/naviguer/formulaire.jpg)',
	'',
	'### 3.2 L’aide',
	'',
	'Le panneau se referme par « Fermer l’aide ».',
	'',
].join('\n')

const image = (fichier: string, section: string | null, libelles: string[], pleinePage = false): EntreeManifeste => ({
	fichier,
	largeur: 400,
	hauteur: 200,
	chapitre: 'naviguer',
	section,
	pleinePage,
	libelles,
})

describe('cadrer (§11.1)', () => {
	it('englobe les cibles, avec 16 px de marge, borné à la page', () => {
		const page = { largeur: 1440, hauteur: 900 }
		expect(cadrer([{ x: 100, y: 50, width: 40, height: 20 }, { x: 200, y: 80, width: 10, height: 10 }], page)).toEqual({
			x: 84,
			y: 34,
			width: 142,
			height: 72,
		})
		expect(cadrer([{ x: 5, y: 5, width: 1430, height: 890 }], page)).toEqual({ x: 0, y: 0, width: 1440, height: 900 })
	})

	it('refuse une image sans cible', () => {
		expect(() => cadrer([], { largeur: 10, hauteur: 10 })).toThrow()
	})
})

describe('fusionnerManifeste (§11.4)', () => {
	it('remplace l’entrée du même fichier, garde les autres, range par fichier et normalise les libellés', () => {
		const avant = { images: [image('naviguer/b.jpg', null, ['x']), image('naviguer/a.jpg', null, ['y'])] }
		const apres = fusionnerManifeste(avant, [image('naviguer/b.jpg', 'les-onglets', ['Fermer l’aide', '  Fermer   l’aide ', ''])])
		expect(apres.images.map((i) => i.fichier)).toEqual(['naviguer/a.jpg', 'naviguer/b.jpg'])
		expect(apres.images[1]).toMatchObject({ section: 'les-onglets', libelles: ["Fermer l'aide"] })
	})
})

describe('éléments cités (§11.4)', () => {
	it('lit les valeurs du catalogue, celles sur deux lignes et celles à paramètres comme motifs', () => {
		expect(normaliserLibelle('Fermer l’aide')).toBe("Fermer l'aide")
		expect(VALEURS.exactes.has('Aucun channel dans ce track')).toBe(true)
		expect(VALEURS.motifs.some((m) => m.test('Page 2 sur 5'))).toBe(true)
	})

	it('une valeur faite de paramètres et de ponctuation seulement n’est pas un motif : elle reconnaîtrait toute citation', () => {
		expect(VALEURS.motifs).toHaveLength(1)
		expect(VALEURS.motifs.some((m) => m.test('zéro par défaut') || m.test('Track › Channel'))).toBe(false)
	})

	it('par section, y compris une citation coupée par un retour à la ligne ; pas ce qui n’est pas un libellé', () => {
		const cites = elementsCites(MANUEL, VALEURS)
		expect([...(cites.get('naviguer#les-onglets') ?? [])].sort()).toEqual([
			'Aucun channel dans ce track',
			'Nouveau channel',
			'Page 2 sur 5',
		])
		expect([...(cites.get('naviguer#l-aide') ?? [])]).toEqual(["Fermer l'aide"])
	})
})

describe('controlerImages (§11.2)', () => {
	const manifeste = { images: [image('naviguer/page.jpg', null, [], true), image('naviguer/formulaire.jpg', 'les-onglets', [])] }
	const disque = ['naviguer/page.jpg', 'naviguer/formulaire.jpg']

	it('ne relève rien quand le manuel, le manifeste et le disque concordent', () => {
		expect(controlerImages(MANUEL, manifeste, disque)).toEqual([])
	})

	it('relève l’image absente, l’orpheline, celle rangée ailleurs et la pleine page qui n’ouvre pas son chapitre', () => {
		const faux = {
			images: [
				image('naviguer/page.jpg', null, [], true),
				image('naviguer/formulaire.jpg', 'l-aide', [], true),
				image('naviguer/oubliee.jpg', 'les-onglets', []),
			],
		}
		const anomalies = controlerImages(MANUEL, faux, ['naviguer/page.jpg', 'naviguer/oubliee.jpg'])
		expect(anomalies).toEqual(
			expect.arrayContaining([
				'image absente du disque : naviguer/formulaire.jpg',
				expect.stringContaining('rangée ailleurs que là où elle paraît : naviguer/formulaire.jpg'),
				"image pleine page qui n'ouvre pas son chapitre : naviguer/formulaire.jpg",
				'image orpheline, citée nulle part : naviguer/oubliee.jpg',
			]),
		)
	})

	it('ne contrôle que les chapitres demandés', () => {
		expect(controlerImages(MANUEL, { images: [] }, [], { chapitres: new Set(['autre']) })).toEqual([])
	})
})

describe('controlerIllustration (§11.1, §11.3)', () => {
	it('un élément cité est illustré par une image de sa section, ou par la pleine page de son chapitre', () => {
		const manifeste = {
			images: [
				image('naviguer/page.jpg', null, ['Page 2 sur 5'], true),
				image('naviguer/formulaire.jpg', 'les-onglets', ['Nouveau channel', 'Aucun channel dans ce track']),
			],
		}
		expect(controlerIllustration(MANUEL, manifeste, VALEURS)).toEqual(["élément cité sans image : « Fermer l'aide » (naviguer#l-aide)"])
	})

	it('une image d’une autre section n’illustre pas, une exception déclarée dispense', () => {
		const manifeste = { images: [image('naviguer/formulaire.jpg', 'les-onglets', ["Fermer l'aide"])] }
		expect(controlerIllustration(MANUEL, manifeste, VALEURS)).toContain("élément cité sans image : « Fermer l'aide » (naviguer#l-aide)")
		expect(
			controlerIllustration(MANUEL, manifeste, VALEURS, {
				exceptions: [{ libelle: "Fermer l'aide", chapitre: 'naviguer' }],
			}),
		).not.toContain("élément cité sans image : « Fermer l'aide » (naviguer#l-aide)")
	})

	it('lit les exceptions de la table du §11.3, sans son en-tête ni son gabarit', () => {
		const spec = [
			'### 11.3 Exceptions à la règle d’illustration',
			'',
			'| Élément cité | Chapitre | Motif |',
			'|---|---|---|',
			'| « Chargement impossible » | `naviguer-barre-laterale-onglets-etats` | une panne ne se reproduit pas |',
			'| *(aucune à ce jour)* | | |',
			'',
			'### 11.4 Suite',
		].join('\n')
		expect(exceptionsDeLaSpecification(spec)).toEqual([
			{ libelle: 'Chargement impossible', chapitre: 'naviguer-barre-laterale-onglets-etats', motif: 'une panne ne se reproduit pas' },
		])
	})
})
