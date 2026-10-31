// @spec CRM-117 (docs/BACKLOG.md) — tranche T4.0 : l'aide qui produit une image du manuel et l'inscrit au manifeste
// @spec docs/SPEC-manual.md §11.1 (la découpe au strict minimum, la pleine page en tête de chapitre, JPEG qualité 85),
//       §11.2 (un générateur, jamais une capture à la main ; les libellés relevés dans la page), §11.4 (le manifeste)
//
// Un scénario de `e2e/manuel/` ouvre l'écran que décrit une section, puis appelle `illustrer` avec les éléments que le
// passage cite. L'aide attend qu'ils soient visibles, découpe le rectangle qui les englobe (`scripts/manuel/images.mjs`),
// écrit l'image sous `docs/manuel/images/<chapitre>/<nom>.jpg`, et inscrit au manifeste ce que la page montre réellement
// dans ce rectangle : les libellés sont LUS, jamais déclarés, pour que la preuve « un élément cité, une image » soit
// opposable.

import type { Locator, Page } from '@playwright/test'
import { existsSync, mkdirSync, readFileSync, renameSync, rmdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { cadrer, fusionnerManifeste, type EntreeManifeste, type Rectangle } from '../../scripts/manuel/images.mjs'

const RACINE = dirname(dirname(import.meta.dirname))
const IMAGES = join(RACINE, 'docs', 'manuel', 'images')
const MANIFESTE = join(IMAGES, 'manifeste.json')
const VERROU = join(IMAGES, '.manifeste.verrou')
const IDENTIFIANT = /^[a-z0-9-]+$/
/** Les images produites par ce processus : un même nom deux fois écraserait la première sans que rien ne le dise. */
const PRODUITES = new Set<string>()

export type Illustration = {
	/** L'identifiant du chapitre où l'image paraît. */
	readonly chapitre: string
	/** L'identifiant de la section, ou `null` pour l'introduction du chapitre. */
	readonly section: string | null
	/** Le nom du fichier, sans extension. */
	readonly nom: string
	/** Les éléments que le passage cite ; une image pleine page peut n'en nommer aucun. */
	readonly cibles: readonly Locator[]
	/** La fenêtre entière, réservée à la première image d'un chapitre (§11.1). */
	readonly pleinePage?: boolean
}

/** Les textes visibles dans un rectangle de la fenêtre : nœuds de texte, libellés accessibles, contenu des champs. */
async function libellesDans(page: Page, cadre: Rectangle): Promise<string[]> {
	return page.evaluate((r) => {
		const dedans = (b: DOMRect) =>
			b.width > 0 && b.height > 0 && b.left >= r.x - 1 && b.top >= r.y - 1 && b.right <= r.x + r.width + 1 && b.bottom <= r.y + r.height + 1
		// Un texte réservé aux lecteurs d'écran (`sr-only` : une boîte d'un pixel, découpée) n'est pas dans l'image : il
		// ne compte pas, et l'élément qu'il porte relève des exceptions du §11.3.
		const visible = (e: Element) => {
			for (let n: Element | null = e; n !== null && n !== document.body; n = n.parentElement) {
				const s = getComputedStyle(n)
				if (s.visibility === 'hidden' || s.display === 'none' || Number(s.opacity) === 0) return false
				const b = n.getBoundingClientRect()
				if (b.width <= 1 && b.height <= 1 && s.overflow === 'hidden') return false
			}
			return true
		}
		const textes: string[] = []
		const marcheur = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
		for (let n = marcheur.nextNode(); n !== null; n = marcheur.nextNode()) {
			const parent = n.parentElement
			if (parent === null || !visible(parent) || (n.textContent ?? '').trim() === '') continue
			const plage = document.createRange()
			plage.selectNodeContents(n)
			if (dedans(plage.getBoundingClientRect())) textes.push(n.textContent ?? '')
		}
		// Un libellé coupé entre plusieurs éléments en ligne — « Chapitre suivant : … » — se lit sur l'élément entier.
		for (const e of document.querySelectorAll('a, button, label, legend, h1, h2, h3, h4, th, td, li, p, span, option, [role], [aria-label]')) {
			if (!visible(e) || !dedans(e.getBoundingClientRect())) continue
			const texte = (e as HTMLElement).innerText
			if (texte !== undefined && texte.trim() !== '') textes.push(texte)
			for (const attribut of ['aria-label', 'placeholder', 'title']) {
				const valeur = e.getAttribute(attribut)
				if (valeur !== null && valeur.trim() !== '') textes.push(valeur)
			}
		}
		for (const champ of document.querySelectorAll('input, textarea, select')) {
			if (!visible(champ) || !dedans(champ.getBoundingClientRect())) continue
			const c = champ as HTMLInputElement
			// Une liste montre le texte de son option choisie, pas sa valeur : « — Aucun choix — », jamais « ».
			const montre = champ instanceof HTMLSelectElement ? (champ.selectedOptions[0]?.text ?? '') : c.type === 'password' ? '' : c.value
			for (const valeur of [c.placeholder, c.getAttribute('aria-label'), montre]) if (valeur) textes.push(valeur)
		}
		return textes
	}, cadre)
}

/** Une écriture du manifeste à la fois : les scénarios peuvent tourner en parallèle. */
async function sousVerrou<T>(action: () => T): Promise<T> {
	for (let essai = 0; essai < 200; essai += 1) {
		try {
			mkdirSync(VERROU)
		} catch {
			await new Promise((r) => setTimeout(r, 50))
			continue
		}
		try {
			return action()
		} finally {
			rmdirSync(VERROU)
		}
	}
	throw new Error(`le manifeste des images reste verrouillé : retirez ${VERROU} si aucun scénario ne tourne`)
}

export async function illustrer(page: Page, illustration: Illustration): Promise<EntreeManifeste> {
	const { chapitre, section, nom, cibles, pleinePage = false } = illustration
	for (const identifiant of [chapitre, section ?? 'introduction', nom])
		if (!IDENTIFIANT.test(identifiant)) throw new Error(`identifiant d'image hors de forme : « ${identifiant} »`)
	if (!pleinePage && cibles.length === 0) throw new Error(`l'image ${chapitre}/${nom} ne cite aucun élément : que montre-t-elle ?`)
	// Une reprise de Playwright rejoue le test dans un processus neuf : seul un doublon du même passage est une faute.
	if (PRODUITES.has(`${chapitre}/${nom}`)) throw new Error(`l'image ${chapitre}/${nom} est produite deux fois : la seconde écraserait la première`)
	PRODUITES.add(`${chapitre}/${nom}`)

	const fenetre = page.viewportSize()
	if (fenetre === null) throw new Error('la fenêtre du navigateur n’a pas de taille')
	const boites: Rectangle[] = []
	for (const cible of cibles) {
		// Une cible re-rendue entre deux appels — un panneau que le temps réel relit — se reprend, au plus trois fois.
		for (let essai = 1; ; essai += 1) {
			try {
				await cible.first().scrollIntoViewIfNeeded()
				await cible.first().waitFor({ state: 'visible' })
				const boite = await cible.first().boundingBox()
				if (boite === null) throw new Error(`une cible de ${chapitre}/${nom} n'a pas de boîte`)
				boites.push(boite)
				break
			} catch (erreur) {
				if (essai >= 3 || !String(erreur).includes('not attached')) throw erreur
			}
		}
	}
	const cadre = pleinePage
		? { x: 0, y: 0, width: fenetre.width, height: fenetre.height }
		: cadrer(boites, { largeur: fenetre.width, hauteur: fenetre.height })
	for (const b of boites)
		if (b.y < 0 || b.y + b.height > fenetre.height)
			throw new Error(
				`les cibles de ${chapitre}/${nom} ne tiennent pas ensemble dans la fenêtre (une boîte de ${Math.round(b.y)} à ${Math.round(b.y + b.height)} px pour ${fenetre.height}) : découpez en deux images`,
			)

	const fichier = `${chapitre}/${nom}.jpg`
	mkdirSync(join(IMAGES, chapitre), { recursive: true })
	await page.screenshot({ path: join(IMAGES, fichier), type: 'jpeg', quality: 85, clip: cadre })
	const entree: EntreeManifeste = {
		fichier,
		largeur: Math.round(cadre.width),
		hauteur: Math.round(cadre.height),
		chapitre,
		section,
		pleinePage,
		libelles: await libellesDans(page, cadre),
	}
	await sousVerrou(() => {
		const actuel = existsSync(MANIFESTE) ? JSON.parse(readFileSync(MANIFESTE, 'utf8')) : { images: [] }
		const suivant = fusionnerManifeste(actuel, [entree])
		// Écrire à côté puis renommer : un manifeste à moitié écrit ne serait plus lisible par la construction.
		writeFileSync(`${MANIFESTE}.ecriture`, `${JSON.stringify(suivant, null, '\t')}\n`)
		renameSync(`${MANIFESTE}.ecriture`, MANIFESTE)
	})
	return entree
}
