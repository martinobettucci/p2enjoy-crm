// @spec CRM-117 (docs/BACKLOG.md) — tranche T2 : la construction du manuel, module pur
// @spec docs/SPEC-manual.md §10 point 7 (l'identifiant d'un chapitre et d'une section), §13.3 (des blocs, jamais du
//       HTML), §15 (le format construit, les cinq refus) ; docs/DAT.md §3.7 quater, §12 bis (les clés du contrat, en
//       anglais) ; docs/JOURNAL.md décisions 750 et 751
//
// Le manuel est découpé en chapitres (titres de niveau 2) et en sections (niveau 3). Chaque chapitre devient une suite
// de BLOCS structurés, que la webapp rend par ses propres composants : aucune balise venue du fichier ne s'exécute, et
// les styles viennent du design system. Le Markdown est analysé par `marked` (lexer seul), et rien d'autre de
// `marked` n'est employé : la sortie HTML de la bibliothèque n'est jamais produite.
//
// Le module ne lit ni n'écrit aucun fichier : `construire(source, manifeste)` rend le manuel construit, ses erreurs et
// ses avertissements. Le script `construire.mjs` fait les entrées et sorties.

import { Lexer } from 'marked'

/**
 * La numérotation de tête d'un titre — « 5 bis. », « 1.1 », « 1 bis.1 », « 3 quater.3 », « 5 undecies.6 bis » —
 * n'entre pas dans l'identifiant : une suite de nombres et d'ordinaux latins, séparés par des points ou des espaces.
 */
const ORDINAL = '(?:\\d+|bis|ter|quater|quinquies|sexies|septies|octies|nonies|decies|undecies|duodecies)'
// Un nombre seul suivi d'un mot n'en est pas une : « 2026 en chiffres » garde son année.
const NUMEROTATION = new RegExp(`^\\s*\\d+(?:(?:[\\s.]+${ORDINAL})+\\.?|\\.)\\s+`, 'i')

/** Les ligatures que la décomposition Unicode ne sépare pas : « nœud » doit donner `noeud`, jamais `n-ud`. */
const LIGATURES = { œ: 'oe', Œ: 'oe', æ: 'ae', Æ: 'ae', ß: 'ss' }

/**
 * L'identifiant d'un titre (§10, point 7) : la numérotation retirée, minuscules, accents retirés, tout ce qui n'est ni
 * lettre ni chiffre devient un tiret, sans tiret en tête ni en fin, ni deux de suite.
 */
export function identifiant(titre) {
	return titre
		.replace(NUMEROTATION, '')
		.replace(/[œŒæÆß]/g, (lettre) => LIGATURES[lettre])
		.normalize('NFD')
		.replace(/[̀-ͯ]/g, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
}

/** Le texte brut d'une suite de jetons en ligne : un titre se nomme sans sa mise en forme. */
function texteBrut(jetons) {
	return (jetons ?? [])
		.map((j) => (j.tokens ? texteBrut(j.tokens) : j.type === 'codespan' ? j.text : (j.text ?? '')))
		.join('')
}

/** Le numéro de ligne (à partir de 1) d'un décalage dans la source : un refus nomme la ligne. */
function ligneDe(source, decalage) {
	return source.slice(0, decalage).split('\n').length
}

/**
 * Construit le manuel.
 * @param {string} source le contenu de `docs/manual.md`
 * @param {{ images?: Array<{ fichier: string, largeur: number, hauteur: number }> }} manifeste le manifeste des images
 * @param {{ imageExiste?: (chemin: string) => boolean }} options pour éprouver qu'une image référencée est sur le disque
 */
export function construire(source, manifeste = { images: [] }, options = {}) {
	const erreurs = []
	const avertissements = []
	const imageExiste = options.imageExiste ?? (() => true)
	const images = new Map((manifeste.images ?? []).map((image) => [image.fichier, image]))

	// Les jetons de premier niveau, avec leur décalage dans la source, pour nommer la ligne d'un refus.
	const jetons = Lexer.lex(source)
	let decalage = 0
	for (const jeton of jetons) {
		const position = source.indexOf(jeton.raw, decalage)
		jeton.ligne = ligneDe(source, position >= 0 ? position : decalage)
		if (position >= 0) decalage = position + jeton.raw.length
	}

	// 1. Le découpage : ce qui précède le premier titre de niveau 2 est l'introduction (son titre de niveau 1 compris,
	//    qui nomme le manuel et n'est pas rendu) ; chaque niveau 2 ouvre un chapitre.
	const introduction = []
	const chapitres = []
	for (const jeton of jetons) {
		if (jeton.type === 'heading' && jeton.depth === 2) {
			const titre = texteBrut(jeton.tokens).trim()
			chapitres.push({ titre, slug: identifiant(titre), ligne: jeton.ligne, jetons: [] })
		} else if (chapitres.length === 0) {
			if (!(jeton.type === 'heading' && jeton.depth === 1)) introduction.push(jeton)
		} else {
			chapitres.at(-1).jetons.push(jeton)
		}
	}
	if (chapitres.length === 0) erreurs.push('le manuel ne porte aucun chapitre (aucun titre de niveau 2)')

	// 2. Les identifiants : uniques entre chapitres, et entre sections d'un même chapitre.
	const vus = new Map()
	for (const chapitre of chapitres) {
		if (chapitre.slug === '') erreurs.push(`ligne ${chapitre.ligne} : le titre « ${chapitre.titre} » ne donne aucun identifiant`)
		else if (vus.has(chapitre.slug))
			erreurs.push(`ligne ${chapitre.ligne} : l'identifiant « ${chapitre.slug} » est déjà celui du chapitre de la ligne ${vus.get(chapitre.slug)}`)
		else vus.set(chapitre.slug, chapitre.ligne)
		chapitre.sections = []
		const ancres = new Map()
		for (const jeton of chapitre.jetons) {
			if (jeton.type !== 'heading' || jeton.depth !== 3) continue
			const titre = texteBrut(jeton.tokens).trim()
			const ancre = identifiant(titre)
			if (ancre === '') erreurs.push(`ligne ${jeton.ligne} : le titre « ${titre} » ne donne aucun identifiant`)
			else if (ancres.has(ancre))
				erreurs.push(`ligne ${jeton.ligne} : l'identifiant « ${ancre} » est déjà celui de la section de la ligne ${ancres.get(ancre)}`)
			else ancres.set(ancre, jeton.ligne)
			jeton.ancre = ancre
			chapitre.sections.push({ anchor: ancre, title: titre })
		}
	}

	// Tout identifiant connu, pour résoudre un lien interne : `#chapitre` ou `#section`, cette dernière devant être
	// unique dans le manuel pour qu'un lien la désigne sans ambiguïté.
	const cibles = new Map()
	for (const chapitre of chapitres) {
		cibles.set(chapitre.slug, [{ chapter: chapitre.slug }])
		for (const section of chapitre.sections) {
			const deja = cibles.get(section.anchor) ?? []
			cibles.set(section.anchor, [...deja, { chapter: chapitre.slug, anchor: section.anchor }])
		}
	}

	// 3. Les blocs.
	function enLigne(liste, ligne) {
		const sortie = []
		for (const j of liste ?? []) {
			switch (j.type) {
				case 'text':
				case 'escape':
					if (j.tokens && j.tokens.length > 0) sortie.push(...enLigne(j.tokens, ligne))
					else sortie.push({ type: 'text', text: j.text })
					break
				case 'strong':
				case 'em':
				case 'del':
					sortie.push({ type: j.type === 'del' ? 'deleted' : j.type === 'em' ? 'emphasis' : 'strong', content: enLigne(j.tokens, ligne) })
					break
				case 'codespan':
					sortie.push({ type: 'code', text: j.text })
					break
				case 'br':
					sortie.push({ type: 'break' })
					break
				case 'link':
					sortie.push(lien(j, ligne))
					break
				case 'image':
					erreurs.push(`ligne ${ligne} : une image ne se place pas dans le fil d'un texte — elle occupe son propre paragraphe`)
					break
				case 'html':
					erreurs.push(`ligne ${ligne} : du HTML brut (« ${j.raw.trim().slice(0, 40)} ») — le manuel est du Markdown seul`)
					break
				default:
					sortie.push({ type: 'text', text: j.raw ?? '' })
			}
		}
		return sortie
	}

	function lien(j, ligne) {
		const contenu = enLigne(j.tokens, ligne)
		const href = j.href ?? ''
		if (/^https?:\/\//.test(href)) return { type: 'link', href, external: true, content: contenu }
		if (href.startsWith('#')) {
			const trouvees = cibles.get(href.slice(1)) ?? []
			if (trouvees.length === 1) return { type: 'link', target: trouvees[0], content: contenu }
			erreurs.push(
				trouvees.length === 0
					? `ligne ${ligne} : le lien « ${href} » ne désigne aucun chapitre ni aucune section`
					: `ligne ${ligne} : le lien « ${href} » désigne plusieurs sections — il faut un titre de section unique`,
			)
			return { type: 'text', text: texteBrut(j.tokens) }
		}
		// Un lien vers un fichier du dépôt est une référence interne (§10, point 2) : il est rendu en texte, et la preuve
		// du manuel la signale. La construction ne la refuse pas, pour que le manuel d'avant la réécriture se construise.
		avertissements.push(`ligne ${ligne} : le lien « ${href} » ne mène ni à un chapitre, ni hors du produit — rendu en texte`)
		return { type: 'text', text: texteBrut(j.tokens) }
	}

	function image(j, ligne, slugChapitre) {
		const src = j.href ?? ''
		const correspondance = /^manuel\/images\/([a-z0-9-]+\/[a-z0-9-]+\.jpg)$/.exec(src)
		if (correspondance === null) {
			erreurs.push(`ligne ${ligne} : l'image « ${src} » n'est pas sous manuel/images/<chapitre>/<nom>.jpg`)
			return null
		}
		const fichier = correspondance[1]
		if (!fichier.startsWith(`${slugChapitre}/`))
			avertissements.push(`ligne ${ligne} : l'image « ${fichier} » est rangée hors du dossier de son chapitre, « ${slugChapitre} »`)
		const entree = images.get(fichier)
		if (!imageExiste(fichier)) erreurs.push(`ligne ${ligne} : l'image « ${fichier} » est absente du disque`)
		if (entree === undefined) erreurs.push(`ligne ${ligne} : l'image « ${fichier} » est absente du manifeste`)
		if ((j.text ?? '').trim() === '') erreurs.push(`ligne ${ligne} : l'image « ${fichier} » n'a pas de texte alternatif`)
		return {
			type: 'image',
			src: fichier,
			alt: (j.text ?? '').trim(),
			width: entree?.largeur ?? null,
			height: entree?.hauteur ?? null,
		}
	}

	function blocs(liste, slugChapitre) {
		const sortie = []
		for (const j of liste) {
			const ligne = j.ligne ?? 0
			switch (j.type) {
				case 'space':
					break
				case 'heading':
					sortie.push({ type: 'heading', level: j.depth, anchor: j.ancre ?? null, content: enLigne(j.tokens, ligne) })
					break
				case 'paragraph': {
					const utiles = j.tokens.filter((t) => !(t.type === 'text' && t.raw.trim() === ''))
					if (utiles.length === 1 && utiles[0].type === 'image') {
						const bloc = image(utiles[0], ligne, slugChapitre)
						if (bloc !== null) sortie.push(bloc)
					} else sortie.push({ type: 'paragraph', content: enLigne(j.tokens, ligne) })
					break
				}
				case 'list':
					sortie.push({
						type: 'list',
						ordered: j.ordered,
						start: j.ordered ? (j.start === '' ? 1 : Number(j.start)) : null,
						items: j.items.map((item) => blocs(item.tokens.map((t) => ({ ...t, ligne })), slugChapitre)),
					})
					break
				case 'text':
					// Le texte d'un élément de liste « serré » : un paragraphe sans en porter le nom.
					sortie.push({ type: 'paragraph', content: enLigne(j.tokens ?? [{ type: 'text', text: j.text }], ligne) })
					break
				case 'blockquote':
					sortie.push({ type: 'note', blocks: blocs(j.tokens.map((t) => ({ ...t, ligne })), slugChapitre) })
					break
				case 'table':
					sortie.push({
						type: 'table',
						align: j.align.map((a) => a ?? null),
						header: j.header.map((cellule) => enLigne(cellule.tokens, ligne)),
						rows: j.rows.map((rangee) => rangee.map((cellule) => enLigne(cellule.tokens, ligne))),
					})
					break
				case 'code':
					sortie.push({ type: 'codeblock', text: j.text })
					break
				case 'hr':
					sortie.push({ type: 'rule' })
					break
				case 'html':
					erreurs.push(`ligne ${ligne} : du HTML brut (« ${j.raw.trim().slice(0, 40)} ») — le manuel est du Markdown seul`)
					break
				default:
					erreurs.push(`ligne ${ligne} : un élément de Markdown non pris en charge (« ${j.type} »)`)
			}
		}
		return sortie
	}

	const contents = {
		introduction: blocs(introduction, ''),
		chapters: chapitres.map((c) => ({ slug: c.slug, title: c.titre, sections: c.sections })),
	}
	const chapters = chapitres.map((c) => ({ slug: c.slug, title: c.titre, blocks: blocs(c.jetons, c.slug) }))

	return { contents, chapters, erreurs, avertissements }
}

/** La sérialisation canonique d'un fichier construit : stable d'une construction à l'autre, finie par un saut. */
export function serialiser(objet) {
	return `${JSON.stringify(objet, null, '\t')}\n`
}
