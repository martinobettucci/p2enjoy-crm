// @verifies CRM-117 (docs/BACKLOG.md) — tranche T2 : la construction du manuel
// @verifies docs/SPEC-manual.md §10 point 7 (l'identifiant d'un titre), §13.3 (des blocs, jamais du HTML), §15 (le format
//           construit et les cinq refus : HTML brut, image absente du disque ou du manifeste, identifiant en double, lien
//           interne sans cible, manuel sans chapitre)
//
// Le module est pur : chaque cas lui donne une source et un manifeste, et lit ce qu'il rend — blocs, erreurs nommant la
// ligne, avertissements. Aucun fichier n'est lu.

import { describe, expect, it } from 'vitest'
import { type Construction, construire, identifiant, serialiser } from './construction.mjs'

type Resultat = Construction

const IMAGE = { fichier: 'board/carte.jpg', largeur: 320, hauteur: 180 }
const bati = (source: string, images = [IMAGE], present = (_: string) => true): Resultat =>
	construire(source, { images }, { imageExiste: present })

describe('identifiant d’un titre (§10, point 7)', () => {
	it.each([
		['1. Se connecter et se déconnecter', 'se-connecter-et-se-deconnecter'],
		['1.1 Qui peut entrer', 'qui-peut-entrer'],
		['1 bis.1 L’état d’une étape', 'l-etat-d-une-etape'],
		['3 quater.3 « Mes affaires » ou tout l’espace', 'mes-affaires-ou-tout-l-espace'],
		['5 undecies.6 bis La bande de la semaine', 'la-bande-de-la-semaine'],
		['Le catalogue de nœuds', 'le-catalogue-de-noeuds'],
		['Annexe A — Ce que contient', 'annexe-a-ce-que-contient'],
	])('« %s » → %s', (titre, attendu) => {
		expect(identifiant(titre)).toBe(attendu)
	})

	it('un nombre seul suivi d’un mot n’est pas une numérotation', () => {
		expect(identifiant('2026 en chiffres')).toBe('2026-en-chiffres')
	})
})

describe('découpage en chapitres et en sections', () => {
	const source = [
		'# Manuel',
		'',
		'Une introduction.',
		'',
		'## 1. Le board',
		'',
		'Un paragraphe.',
		'',
		'### 1.1 Déplacer une affaire',
		'',
		'Texte.',
		'',
		'## 2. La fiche',
		'',
		'### 2.1 L’en-tête',
	].join('\n')

	it('rend le sommaire, l’introduction sans le titre du manuel, et un fichier par chapitre', () => {
		const r = bati(source)
		expect(r.erreurs).toEqual([])
		expect(r.contents.chapters).toEqual([
			{ slug: 'le-board', title: '1. Le board', sections: [{ anchor: 'deplacer-une-affaire', title: '1.1 Déplacer une affaire' }] },
			{ slug: 'la-fiche', title: '2. La fiche', sections: [{ anchor: 'l-en-tete', title: '2.1 L’en-tête' }] },
		])
		expect(r.contents.introduction).toEqual([{ type: 'paragraph', content: [{ type: 'text', text: 'Une introduction.' }] }])
		expect(r.chapters.map((c) => c.slug)).toEqual(['le-board', 'la-fiche'])
		expect(r.chapters[0]?.blocks[1]).toEqual({
			type: 'heading',
			level: 3,
			anchor: 'deplacer-une-affaire',
			content: [{ type: 'text', text: '1.1 Déplacer une affaire' }],
		})
	})

	it('refuse un manuel sans chapitre', () => {
		expect(bati('# Manuel\n\nRien d’autre.').erreurs).toEqual(['le manuel ne porte aucun chapitre (aucun titre de niveau 2)'])
	})

	it('refuse deux chapitres de même identifiant, en nommant les deux lignes', () => {
		const r = bati('## 1. Le board\n\nA.\n\n## 2. Le board\n')
		expect(r.erreurs).toEqual(['ligne 5 : l’identifiant « le-board » est déjà celui du chapitre de la ligne 1'.replace('’', "'")])
	})

	it('refuse deux sections de même identifiant dans un chapitre, et les accepte dans deux chapitres', () => {
		expect(bati('## A\n\n### Réglages\n\n### Réglages\n').erreurs).toHaveLength(1)
		expect(bati('## A\n\n### Réglages\n\n## B\n\n### Réglages\n').erreurs).toEqual([])
	})
})

describe('les blocs (§13.3) — jamais du HTML', () => {
	const premier = (source: string) => bati(`## C\n\n${source}\n`).chapters[0]?.blocks ?? []

	it('rend la mise en forme en ligne en nœuds nommés', () => {
		expect(premier('Un **gras**, une *emphase*, du `code`.')).toEqual([
			{
				type: 'paragraph',
				content: [
					{ type: 'text', text: 'Un ' },
					{ type: 'strong', content: [{ type: 'text', text: 'gras' }] },
					{ type: 'text', text: ', une ' },
					{ type: 'emphasis', content: [{ type: 'text', text: 'emphase' }] },
					{ type: 'text', text: ', du ' },
					{ type: 'code', text: 'code' },
					{ type: 'text', text: '.' },
				],
			},
		])
	})

	it('rend une liste, une citation en note, un tableau, un code et un filet', () => {
		const types = premier('- un\n- deux\n\n1. a\n2. b\n\n> note\n\n| A | B |\n|---|--:|\n| 1 | 2 |\n\n```\nx\n```\n\n---').map(
			(b) => b.type,
		)
		expect(types).toEqual(['list', 'list', 'note', 'table', 'codeblock', 'rule'])
		const [puces, numeros, , tableau] = premier('- un\n- deux\n\n3. a\n4. b\n\n> note\n\n| A | B |\n|---|--:|\n| 1 | 2 |')
		expect(puces).toMatchObject({ ordered: false, start: null })
		expect(numeros).toMatchObject({ ordered: true, start: 3 })
		expect(tableau).toMatchObject({ align: [null, 'right'], header: [[{ type: 'text', text: 'A' }], [{ type: 'text', text: 'B' }]] })
	})

	it('refuse du HTML brut, en bloc comme en ligne, en nommant la ligne', () => {
		expect(bati('## C\n\n<div>x</div>\n').erreurs[0]).toMatch(/^ligne 3 : du HTML brut/)
		expect(bati('## C\n\nUn <b>mot</b>.\n').erreurs[0]).toMatch(/^ligne 3 : du HTML brut/)
	})
})

describe('les images (§11, §15)', () => {
	it('une image seule dans son paragraphe devient un bloc, ses dimensions lues dans le manifeste', () => {
		const r = bati('## Board\n\n![La carte d’une affaire](manuel/images/board/carte.jpg)\n')
		expect(r.erreurs).toEqual([])
		expect(r.chapters[0]?.blocks).toEqual([
			{ type: 'image', src: 'board/carte.jpg', alt: 'La carte d’une affaire', width: 320, height: 180 },
		])
	})

	it('refuse une image absente du disque, absente du manifeste, ou sans texte alternatif', () => {
		expect(bati('## Board\n\n![x](manuel/images/board/carte.jpg)\n', [IMAGE], () => false).erreurs).toEqual([
			'ligne 3 : l\'image « board/carte.jpg » est absente du disque',
		])
		expect(bati('## Board\n\n![x](manuel/images/board/carte.jpg)\n', []).erreurs).toEqual([
			'ligne 3 : l\'image « board/carte.jpg » est absente du manifeste',
		])
		expect(bati('## Board\n\n![](manuel/images/board/carte.jpg)\n').erreurs).toEqual([
			'ligne 3 : l\'image « board/carte.jpg » n\'a pas de texte alternatif',
		])
	})

	it('refuse une image hors de manuel/images/<chapitre>/<nom>.jpg, et une image dans le fil d’un texte', () => {
		expect(bati('## Board\n\n![x](../captures/a.jpg)\n').erreurs[0]).toMatch(/n'est pas sous manuel\/images/)
		expect(bati('## Board\n\nVoir ![x](manuel/images/board/carte.jpg) ici.\n').erreurs[0]).toMatch(/ne se place pas dans le fil/)
	})
})

describe('les liens', () => {
	const source = '## Le board\n\n### Déplacer une affaire\n\n## La fiche\n\n### Notes\n\n'

	it('résout un lien vers un chapitre ou une section en cible de la webapp', () => {
		const r = bati(`${source}[le board](#le-board) et [déplacer](#deplacer-une-affaire).\n`)
		expect(r.erreurs).toEqual([])
		const contenu = r.chapters[1]?.blocks.at(-1)?.content as Array<Record<string, unknown>>
		expect(contenu[0]).toMatchObject({ type: 'link', target: { chapter: 'le-board' } })
		expect(contenu[2]).toMatchObject({ type: 'link', target: { chapter: 'le-board', anchor: 'deplacer-une-affaire' } })
	})

	it('refuse un lien interne sans cible, et un lien vers une section que deux chapitres portent', () => {
		expect(bati(`${source}[x](#inconnu)\n`).erreurs[0]).toMatch(/ne désigne aucun chapitre ni aucune section/)
		expect(bati('## A\n\n### Notes\n\n## B\n\n### Notes\n\n[x](#notes)\n').erreurs[0]).toMatch(/désigne plusieurs sections/)
	})

	it('marque un lien externe, et rend en texte un lien vers un fichier du dépôt, avec un avertissement', () => {
		const r = bati(`${source}[site](https://example.org) et [journal](JOURNAL.md)\n`)
		const contenu = r.chapters[1]?.blocks.at(-1)?.content as Array<Record<string, unknown>>
		expect(contenu[0]).toMatchObject({ type: 'link', href: 'https://example.org', external: true })
		expect(contenu.at(-1)).toEqual({ type: 'text', text: 'journal' })
		expect(r.avertissements).toEqual(['ligne 9 : le lien « JOURNAL.md » ne mène ni à un chapitre, ni hors du produit — rendu en texte'])
	})
})

describe('sérialisation', () => {
	it('est stable et finie par un saut de ligne', () => {
		expect(serialiser({ b: 1, a: [2] })).toBe('{\n\t"b": 1,\n\t"a": [\n\t\t2\n\t]\n}\n')
	})
})
