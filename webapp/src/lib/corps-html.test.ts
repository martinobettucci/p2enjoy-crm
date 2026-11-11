// @verifies CRM-140 (docs/BACKLOG.md) — tranche T2 : le nettoyage du HTML d'un expéditeur — chaque vecteur retiré (scripts,
//           gestionnaires `on*`, `javascript:` et ses variantes, formulaires, `meta refresh`, `base`, `link`, cadres, SVG), les
//           liens gardés et leur `target`/`rel`, l'image distante déplacée et comptée, le `data:` d'expéditeur retiré, le HTML
//           vidé ; le document du cadre et sa politique de contenu en deux états ; `cid:` résolu ou remplacé ; les adresses
//           web d'un corps texte
// @verifies docs/SPEC-mail-subsystem.md §30.2 à §30.7, §30.11 (lignes « Vitest, nettoyage » et « Vitest, document »)

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
	IMAGE_INTEGREE_MAX_OCTETS,
	JETONS_DU_CADRE,
	NOMS_DES_JETONS,
	decouperLiens,
	documentDuCadre,
	lireImageIntegree,
	lireImagesIntegrees,
	lireJetons,
	nettoyerHtml,
	normaliserContentId,
	piecesDesCids,
	politiqueDeContenu,
} from './corps-html'
import type { PieceJointe } from './inbox'
import type { ClientCrm } from './supabase'

/** Le HTML nettoyé, relu comme un document : les assertions portent sur la structure, non sur une chaîne. */
function lu(html: string): DocumentFragment {
	const gabarit = document.createElement('template')
	gabarit.innerHTML = nettoyerHtml(html).html
	return gabarit.content
}

describe('nettoyerHtml — ce qui est retiré (§30.4)', () => {
	it('retire les scripts, avec leur contenu, sous toutes leurs formes', () => {
		const html = nettoyerHtml('<p>Bonjour</p><script>alert(1)</script><noscript>x</noscript><template><b>t</b></template>').html
		expect(html).toBe('<p>Bonjour</p>')
	})

	it('retire tout gestionnaire `on*`', () => {
		const fragment = lu('<p onclick="alert(1)" onmouseover="x()">a</p><img src="cid:a" onerror="alert(2)"><body onload="y()">')
		const attributs = Array.from(fragment.querySelectorAll('*')).flatMap((element) => Array.from(element.attributes).map((a) => a.name))
		expect(attributs.filter((nom) => nom.startsWith('on'))).toEqual([])
	})

	it.each([
		'javascript:alert(1)',
		'JaVaScRiPt:alert(1)',
		'  javascript:alert(1)',
		'java\tscript:alert(1)',
		'&#x6a;avascript:alert(1)',
		'vbscript:msgbox(1)',
		'data:text/html,<script>alert(1)</script>',
		'file:///etc/passwd',
		'/chemin/relatif',
		'#ancre',
	])('un lien `%s` perd son `href`, et son texte reste', (cible) => {
		const fragment = lu(`<a href="${cible}" target="_top">cliquer</a>`)
		const lien = fragment.querySelector('a')!
		expect(lien.hasAttribute('href')).toBe(false)
		expect(lien.hasAttribute('target')).toBe(false)
		expect(lien.textContent).toBe('cliquer')
	})

	it('retire les formulaires et tous leurs champs', () => {
		const fragment = lu(
			'<form action="https://pirate.test/vol"><input name="mdp" type="password"><select><option>a</option></select><textarea>t</textarea><button formaction="https://pirate.test">Envoyer</button></form><p>reste</p>',
		)
		expect(fragment.querySelectorAll('form, input, select, option, textarea, button')).toHaveLength(0)
		expect(fragment.textContent).toBe('reste')
	})

	it('retire `meta refresh`, `base` et `link`, même placés en tête d’un document complet', () => {
		const html = nettoyerHtml(
			'<html><head><meta http-equiv="refresh" content="0;url=https://pirate.test"><base href="https://pirate.test/"><link rel="stylesheet" href="https://pirate.test/a.css"></head><body><p>corps</p></body></html>',
		).html
		expect(html).not.toMatch(/<meta|<base|<link|pirate/i)
		expect(html).toContain('<p>corps</p>')
	})

	it('retire les cadres, objets, médias et le SVG porteur de script', () => {
		const html = nettoyerHtml(
			'<iframe src="https://pirate.test"></iframe><object data="x"></object><embed src="x"><video src="https://pirate.test/v.mp4" poster="https://pirate.test/p.png"></video><audio src="a"></audio><picture><source srcset="https://pirate.test/i.png"></picture><svg><script>alert(1)</script><a xlink:href="javascript:alert(2)">s</a></svg><math><mi>x</mi></math><p>fin</p>',
		).html
		expect(html).not.toMatch(/<(iframe|object|embed|video|audio|picture|source|svg|math|script)/i)
		expect(html).not.toContain('pirate')
		expect(html).toContain('<p>fin</p>')
	})

	it('retire `srcset`, `ping`, `background` et les attributs `data-*` d’un expéditeur', () => {
		const fragment = lu(
			'<table background="https://pirate.test/fond.png"><tr><td>a</td></tr></table><a href="https://ok.test" ping="https://pirate.test/p">l</a><img src="cid:x" srcset="https://pirate.test/2x.png 2x" data-crm-src="https://pirate.test/faux.png"><div data-suivi="1">d</div>',
		)
		expect(fragment.querySelector('table')!.hasAttribute('background')).toBe(false)
		expect(fragment.querySelector('a')!.hasAttribute('ping')).toBe(false)
		const image = fragment.querySelector('img')!
		expect(image.hasAttribute('srcset')).toBe(false)
		// Le `data-crm-src` écrit par l'expéditeur n'est pas celui du CRM : il est retiré, et l'image reste intégrée.
		expect(image.getAttribute('data-crm-src')).toBeNull()
		expect(image.getAttribute('data-crm-cid')).toBe('x')
		expect(fragment.querySelector('div')!.hasAttribute('data-suivi')).toBe(false)
	})

	it('le HTML que le nettoyage vide est dit vide', () => {
		expect(nettoyerHtml('<script>alert(1)</script>').vide).toBe(true)
		expect(nettoyerHtml('<p> \n </p><form><input></form>').vide).toBe(true)
		expect(nettoyerHtml('<img src="data:image/png;base64,AAAA">').vide).toBe(true)
		expect(nettoyerHtml('<p>a</p>').vide).toBe(false)
		expect(nettoyerHtml('<img src="https://images.test/a.png">').vide).toBe(false)
		expect(nettoyerHtml('<img src="cid:logo">').vide).toBe(false)
	})
})

describe('nettoyerHtml — ce qui est gardé (§30.4)', () => {
	it('garde la mise en forme d’un courrier, et ses styles placés en tête', () => {
		const html = nettoyerHtml(
			'<html><head><style>.titre{color:navy}</style></head><body><h1 class="titre">Devis</h1><table><tr><td style="padding:4px">1</td></tr></table><ul><li>a</li></ul><center><font color="red">b</font></center></body></html>',
		).html
		expect(html).toContain('<style>.titre{color:navy}</style>')
		expect(html).toContain('<h1 class="titre">Devis</h1>')
		expect(html).toContain('<td style="padding:4px">1</td>')
		expect(html).toContain('<font color="red">b</font>')
	})

	it('pose `target="_blank"` et `rel="noopener noreferrer"` sur CHAQUE lien gardé', () => {
		const fragment = lu('<a href="https://p2enjoy.test/devis">devis</a><a href="http://exemple.test" target="_self" rel="opener">b</a><a href="mailto:contact@p2enjoy.test">c</a>')
		const liens = Array.from(fragment.querySelectorAll('a'))
		expect(liens.map((lien) => lien.getAttribute('href'))).toEqual(['https://p2enjoy.test/devis', 'http://exemple.test', 'mailto:contact@p2enjoy.test'])
		for (const lien of liens) {
			expect(lien.getAttribute('target')).toBe('_blank')
			expect(lien.getAttribute('rel')).toBe('noopener noreferrer')
		}
	})

	it('déplace et compte les images distantes, repère les intégrées, et retire un `data:` d’expéditeur', () => {
		const resultat = nettoyerHtml(
			'<img src="https://images.test/a.png" alt="A"><img src="HTTP://images.test/b.png"><img src="cid:%3CLogo@P2enjoy%3E"><img src="cid:logo@p2enjoy"><img src="data:image/png;base64,AAAA"><img src="/relatif.png">',
		)
		expect(resultat.imagesDistantes).toBe(2)
		expect(resultat.cids).toEqual(['logo@p2enjoy'])
		const gabarit = document.createElement('template')
		gabarit.innerHTML = resultat.html
		const images = Array.from(gabarit.content.querySelectorAll('img'))
		expect(images.map((image) => image.getAttribute('src'))).toEqual([null, null, null, null, null, null])
		expect(images.map((image) => image.getAttribute('data-crm-src'))).toEqual(['https://images.test/a.png', 'HTTP://images.test/b.png', null, null, null, null])
	})

	it('un appel ne laisse pas ses crochets au suivant', () => {
		nettoyerHtml('<img src="https://images.test/a.png">')
		expect(nettoyerHtml('<p>sans image</p>').imagesDistantes).toBe(0)
	})
})

describe('politiqueDeContenu et documentDuCadre (§30.3, §30.6)', () => {
	const sansImages = new Map<string, string | null>()

	it('la politique bloque tout, sauf les images `data:`, tant que les images ne sont pas affichées', () => {
		expect(politiqueDeContenu(false)).toBe("default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'")
		expect(politiqueDeContenu(true)).toBe("default-src 'none'; img-src data: https: http:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'")
	})

	it('le document commence par la politique, AVANT tout contenu de l’expéditeur', () => {
		const doc = documentDuCadre({ html: nettoyerHtml('<p>corps</p>').html, images: sansImages, imagesAffichees: false, mentionIndisponible: 'm' })
		expect(doc.startsWith('<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy"')).toBe(true)
		expect(doc.indexOf('Content-Security-Policy')).toBeLessThan(doc.indexOf('<p>corps</p>'))
		expect(doc).toContain('<meta name="referrer" content="no-referrer"><base target="_blank">')
		const analyse = new DOMParser().parseFromString(doc, 'text/html')
		expect(analyse.querySelector('meta[http-equiv]')!.getAttribute('content')).toBe(politiqueDeContenu(false))
	})

	it('les images distantes ne reçoivent leur `src` qu’après « Afficher les images »', () => {
		const { html } = nettoyerHtml('<img src="https://images.test/a.png">')
		const bloque = new DOMParser().parseFromString(documentDuCadre({ html, images: sansImages, imagesAffichees: false, mentionIndisponible: 'm' }), 'text/html')
		expect(bloque.querySelector('img')!.hasAttribute('src')).toBe(false)
		const affiche = new DOMParser().parseFromString(documentDuCadre({ html, images: sansImages, imagesAffichees: true, mentionIndisponible: 'm' }), 'text/html')
		expect(affiche.querySelector('img')!.getAttribute('src')).toBe('https://images.test/a.png')
		expect(affiche.querySelector('meta[http-equiv]')!.getAttribute('content')).toBe(politiqueDeContenu(true))
	})

	it('une image intégrée résolue reçoit son `data:` ; une autre devient la mention, avec son texte alternatif', () => {
		const { html } = nettoyerHtml('<img src="cid:logo"><img src="cid:absente" alt="Signature"><img src="cid:refusee">')
		const images = new Map<string, string | null>([
			['logo', 'data:image/png;base64,iVBORw0KGgo='],
			['refusee', null],
		])
		const doc = new DOMParser().parseFromString(documentDuCadre({ html, images, imagesAffichees: false, mentionIndisponible: 'image intégrée indisponible' }), 'text/html')
		expect(doc.querySelectorAll('img')).toHaveLength(1)
		expect(doc.querySelector('img')!.getAttribute('src')).toBe('data:image/png;base64,iVBORw0KGgo=')
		expect(Array.from(doc.querySelectorAll('.crm-image-indisponible')).map((mention) => mention.textContent)).toEqual([
			'image intégrée indisponible — Signature',
			'image intégrée indisponible',
		])
	})

	it('la feuille du cadre LIT les jetons dans tokens.css, valeur pour valeur (§5.100, §12.7)', () => {
		const jetons = readFileSync(resolve(__dirname, '../styles/tokens.css'), 'utf8')
		expect(JETONS_DU_CADRE).toEqual(lireJetons(jetons))
		expect(JETONS_DU_CADRE['--radius-sm']).toBe('8px')
		const doc = documentDuCadre({ html: '<p>a</p>', images: new Map(), imagesAffichees: false, mentionIndisponible: 'm' })
		expect(doc).toContain(`color:${JETONS_DU_CADRE['--color-text']}`)
		expect(doc).toContain(`font-family:${JETONS_DU_CADRE['--font-sans']}`)
	})

	it('un jeton absent de tokens.css est une faute dite, jamais un cadre sans couleur', () => {
		expect(() => lireJetons('--color-surface: blanc;')).toThrow('Le jeton --color-text est absent de tokens.css')
		expect(lireJetons(NOMS_DES_JETONS.map((nom) => `${nom}: v${nom.length};`).join('\n'))['--font-sans']).toBe('v11')
	})

	it('une adresse résolue qui n’est pas une image `data:` n’est jamais posée', () => {
		const { html } = nettoyerHtml('<img src="cid:logo">')
		const doc = documentDuCadre({ html, images: new Map([['logo', 'https://pirate.test/a.png']]), imagesAffichees: true, mentionIndisponible: 'm' })
		expect(doc).not.toContain('pirate')
	})
})

const PIECE: PieceJointe = {
	id: 'p1',
	nom: 'logo.png',
	type: 'image/png',
	taille: 4,
	chemin: 'w/m/logo',
	statutAnalyse: 'clean',
	raisonNonAnalyse: null,
	recueLe: '2026-11-11T08:00:00Z',
	confirmee: false,
	contentId: '<Logo@P2enjoy>',
}

function clientStockage(fichier: Blob | null, lus: string[] = []): ClientCrm {
	return {
		storage: {
			from: () => ({
				download: async (chemin: string) => {
					lus.push(chemin)
					return fichier === null ? { data: null, error: { message: 'refus' } } : { data: fichier, error: null }
				},
			}),
		},
	} as unknown as ClientCrm
}

describe('les images intégrées (§30.6)', () => {
	it('normalise un `Content-ID`', () => {
		expect(normaliserContentId(' <Logo@P2enjoy> ')).toBe('logo@p2enjoy')
	})

	it('désigne la pièce par son `Content-ID`, la première par nom en cas de doublon', () => {
		const doublon: PieceJointe = { ...PIECE, id: 'p0', nom: 'a-logo.png' }
		const designees = piecesDesCids(['logo@p2enjoy', 'absent'], [PIECE, doublon, { ...PIECE, id: 'p9', contentId: null }])
		expect(designees.get('logo@p2enjoy')!.id).toBe('p0')
		expect(designees.has('absent')).toBe(false)
	})

	it('lit une pièce saine en `data:`, au type forcé', async () => {
		const lus: string[] = []
		const adresse = await lireImageIntegree(clientStockage(new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'text/html' }), lus), PIECE)
		expect(adresse).toBe('data:image/png;base64,AQIDBA==')
		expect(lus).toEqual(['w/m/logo'])
	})

	it.each([
		['non saine', { statutAnalyse: 'infected' as const }],
		['en attente', { statutAnalyse: 'pending' as const }],
		['trop grande', { taille: IMAGE_INTEGREE_MAX_OCTETS + 1 }],
		['d’un type que l’aperçu ne montre pas', { type: 'image/svg+xml' }],
	])('une pièce %s n’est jamais lue', async (_cas, ecart) => {
		const lus: string[] = []
		expect(await lireImageIntegree(clientStockage(new Blob(['x']), lus), { ...PIECE, ...ecart })).toBeNull()
		expect(lus).toEqual([])
	})

	it('une lecture refusée donne la mention, jamais une panne', async () => {
		const images = await lireImagesIntegrees(clientStockage(null), ['logo@p2enjoy', 'absent'], [PIECE])
		expect([...images.entries()]).toEqual([
			['logo@p2enjoy', null],
			['absent', null],
		])
	})
})

describe('decouperLiens — les adresses web d’un corps texte (§30.7)', () => {
	it('fait des adresses `http(s)://` des liens, sans leur ponctuation finale', () => {
		expect(decouperLiens('Voir https://p2enjoy.test/devis. Et (http://exemple.test/a?b=1), « https://x.test/c »')).toEqual([
			{ type: 'texte', valeur: 'Voir ' },
			{ type: 'lien', valeur: 'https://p2enjoy.test/devis' },
			{ type: 'texte', valeur: '. Et (' },
			{ type: 'lien', valeur: 'http://exemple.test/a?b=1' },
			{ type: 'texte', valeur: '), « ' },
			{ type: 'lien', valeur: 'https://x.test/c' },
			{ type: 'texte', valeur: ' »' },
		])
	})

	it('laisse en texte une adresse sans schéma, un autre schéma, et un schéma seul', () => {
		expect(decouperLiens('www.p2enjoy.test javascript:alert(1) https:// ftp://a.test')).toEqual([
			{ type: 'texte', valeur: 'www.p2enjoy.test javascript:alert(1) https:// ftp://a.test' },
		])
	})

	it('un texte sans adresse reste un seul morceau, et un texte vide n’en a aucun', () => {
		expect(decouperLiens('Bonjour')).toEqual([{ type: 'texte', valeur: 'Bonjour' }])
		expect(decouperLiens('')).toEqual([])
	})
})
