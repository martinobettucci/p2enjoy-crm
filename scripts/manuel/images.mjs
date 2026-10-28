// @spec CRM-117 (docs/BACKLOG.md) — tranche T4.0 : les images du manuel, leur manifeste et la preuve « un élément cité,
//       une image »
// @spec docs/SPEC-manual.md §11.1 (ce qu'une image montre : la découpe au strict minimum, la pleine page en tête de
//       chapitre), §11.2 (le manifeste, les libellés relevés, l'élément cité sans image), §11.3 (les exceptions),
//       §11.4 (le contrat technique), §16 (la preuve du manuel)
//
// Module pur : il ne lit ni n'écrit aucun fichier. L'aide Playwright `e2e/manuel/illustrer.ts` s'en sert pour découper
// et inscrire une image ; `scripts/verify-manual.sh` s'en sert pour vérifier le manuel contre le manifeste.

import { identifiant } from './construction.mjs'

/** La marge autour des cibles d'une image découpée, en pixels (§11.1). */
export const MARGE = 16

/** Un texte tel que la preuve le compare : apostrophe droite, espaces réduits, sans blanc aux bords. */
export function normaliserLibelle(texte) {
	return String(texte).replace(/[’‘]/g, "'").replace(/\s+/g, ' ').trim()
}

/**
 * Le rectangle d'une image découpée : celui qui englobe les cibles, élargi de `marge` de chaque côté, borné à la page.
 * @param {Array<{ x: number, y: number, width: number, height: number }>} cibles
 * @param {{ largeur: number, hauteur: number }} page
 */
export function cadrer(cibles, page, marge = MARGE) {
	if (cibles.length === 0) throw new Error('une image découpée demande au moins une cible')
	const gauche = Math.min(...cibles.map((c) => c.x))
	const haut = Math.min(...cibles.map((c) => c.y))
	const droite = Math.max(...cibles.map((c) => c.x + c.width))
	const bas = Math.max(...cibles.map((c) => c.y + c.height))
	const x = Math.max(0, Math.floor(gauche - marge))
	const y = Math.max(0, Math.floor(haut - marge))
	return {
		x,
		y,
		width: Math.min(page.largeur, Math.ceil(droite + marge)) - x,
		height: Math.min(page.hauteur, Math.ceil(bas + marge)) - y,
	}
}

/** Le manifeste après l'inscription d'entrées : une entrée remplace celle du même fichier ; l'ordre est celui des fichiers. */
export function fusionnerManifeste(manifeste, entrees) {
	const parFichier = new Map((manifeste?.images ?? []).map((image) => [image.fichier, image]))
	for (const entree of entrees) {
		parFichier.set(entree.fichier, {
			...entree,
			libelles: [...new Set(entree.libelles.map(normaliserLibelle).filter((l) => l !== ''))].sort(),
		})
	}
	return { images: [...parFichier.values()].sort((a, b) => a.fichier.localeCompare(b.fichier)) }
}

/**
 * Les valeurs du catalogue `fr.ts`, normalisées. Une valeur à paramètres (« Page {rang} sur {pages} ») devient un motif.
 * @returns {{ exactes: Set<string>, motifs: RegExp[] }}
 */
export function valeursInterface(sourceFr) {
	const exactes = new Set()
	const motifs = []
	for (const m of sourceFr.matchAll(/^\s*'[^'\n]+':\s*(?:\n\s*)?(['"])((?:\\.|(?!\1)[^\\\n])*)\1,?\s*$/gm)) {
		const valeur = normaliserLibelle(m[2].replace(/\\(['"\\])/g, '$1'))
		if (valeur === '') continue
		if (/\{[a-zA-Z]+\}/.test(valeur)) {
			// « {prenom} {nom} » ou « {track} › {channel} » reconnaîtraient toute citation : un motif garde au moins un mot.
			if (!/\p{L}{2,}/u.test(valeur.replace(/\{[a-zA-Z]+\}/g, ''))) continue
			const echappe = valeur.replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(/\\?\{[a-zA-Z]+\\?\}/g, '.+?')
			motifs.push(new RegExp(`^${echappe}$`))
		} else exactes.add(valeur)
	}
	return { exactes, motifs }
}

const estValeur = (texte, valeurs) => valeurs.exactes.has(texte) || valeurs.motifs.some((m) => m.test(texte))

/**
 * Les éléments cités du manuel : par section (`chapitre#section`, ou `chapitre` pour son introduction), les textes entre
 * guillemets français qui sont des valeurs de l'interface. Une citation coupée par un retour à la ligne compte.
 * @returns {Map<string, Set<string>>}
 */
export function elementsCites(source, valeurs) {
	const parSection = new Map()
	let chapitre = null
	let section = null
	let tampon = []
	let dansCode = false
	const vider = () => {
		if (chapitre === null) return (tampon = [])
		const cle = section === null ? chapitre : `${chapitre}#${section}`
		for (const m of tampon.join(' ').matchAll(/«\s*([^»]{1,120}?)\s*»/g)) {
			const texte = normaliserLibelle(m[1])
			if (!estValeur(texte, valeurs)) continue
			if (!parSection.has(cle)) parSection.set(cle, new Set())
			parSection.get(cle).add(texte)
		}
		tampon = []
	}
	for (const ligne of source.split('\n')) {
		if (/^```/.test(ligne)) dansCode = !dansCode
		const titre = dansCode ? null : /^(##|###) (.*)$/.exec(ligne)
		if (titre) {
			vider()
			if (titre[1] === '##') {
				chapitre = identifiant(titre[2])
				section = null
			} else section = identifiant(titre[2])
			continue
		}
		if (!dansCode) tampon.push(ligne)
	}
	vider()
	return parSection
}

/** Les images référencées par le manuel, dans l'ordre, avec leur chapitre et leur section. */
export function imagesReferencees(source) {
	const images = []
	let chapitre = null
	let section = null
	let dansCode = false
	for (const ligne of source.split('\n')) {
		if (/^```/.test(ligne)) dansCode = !dansCode
		if (dansCode) continue
		const titre = /^(##|###) (.*)$/.exec(ligne)
		if (titre) {
			if (titre[1] === '##') {
				chapitre = identifiant(titre[2])
				section = null
			} else section = identifiant(titre[2])
			continue
		}
		for (const m of ligne.matchAll(/!\[[^\]]*\]\(manuel\/images\/([a-z0-9-]+\/[a-z0-9-]+\.jpg)\)/g))
			images.push({ fichier: m[1], chapitre, section })
	}
	return images
}

/**
 * La cohérence entre le manuel, le manifeste et le disque (§11.2) : image référencée absente du manifeste ou du disque,
 * image orpheline, image rangée sous un autre chapitre ou une autre section que celle où elle paraît, image pleine page
 * qui n'est pas la première de son chapitre.
 * @param {{ chapitres?: Set<string> | null }} portee les chapitres contrôlés ; `null` : tout le manuel
 * @returns {string[]} les anomalies, nommées
 */
export function controlerImages(source, manifeste, fichiersSurDisque, { chapitres = null } = {}) {
	const dans = (ch) => chapitres === null || chapitres.has(ch)
	const anomalies = []
	const references = imagesReferencees(source)
	const parFichier = new Map((manifeste?.images ?? []).map((image) => [image.fichier, image]))
	const disque = new Set(fichiersSurDisque)
	const vues = new Set(references.map((r) => r.fichier))
	const premiere = new Map()
	for (const ref of references) if (!premiere.has(ref.chapitre)) premiere.set(ref.chapitre, ref.fichier)

	for (const ref of references) {
		if (!dans(ref.chapitre)) continue
		const entree = parFichier.get(ref.fichier)
		if (!disque.has(ref.fichier)) anomalies.push(`image absente du disque : ${ref.fichier}`)
		if (entree === undefined) {
			anomalies.push(`image absente du manifeste : ${ref.fichier}`)
			continue
		}
		if (entree.chapitre !== ref.chapitre || (entree.section ?? null) !== ref.section)
			anomalies.push(`image rangée ailleurs que là où elle paraît : ${ref.fichier} (manifeste ${entree.chapitre}#${entree.section ?? ''}, manuel ${ref.chapitre}#${ref.section ?? ''})`)
		if (entree.pleinePage && premiere.get(ref.chapitre) !== ref.fichier)
			anomalies.push(`image pleine page qui n'ouvre pas son chapitre : ${ref.fichier}`)
	}
	for (const fichier of new Set([...parFichier.keys(), ...disque])) {
		const chapitre = parFichier.get(fichier)?.chapitre ?? fichier.split('/')[0]
		if (dans(chapitre) && !vues.has(fichier)) anomalies.push(`image orpheline, citée nulle part : ${fichier}`)
	}
	return anomalies
}

/**
 * La preuve « un élément cité, une image » (§11.1) : chaque élément cité d'une section figure dans les libellés d'une
 * image de cette section, ou d'une image pleine page de son chapitre — hors exceptions déclarées (§11.3).
 * @param {Array<{ libelle: string, chapitre: string }>} exceptions
 * @returns {string[]} les éléments cités sans image, nommés
 */
export function controlerIllustration(source, manifeste, valeurs, { chapitres = null, exceptions = [] } = {}) {
	const dans = (ch) => chapitres === null || chapitres.has(ch)
	const excepte = new Set(exceptions.map((e) => `${e.chapitre}|${normaliserLibelle(e.libelle)}`))
	const images = manifeste?.images ?? []
	const anomalies = []
	for (const [cle, cites] of elementsCites(source, valeurs)) {
		const [chapitre, section = null] = cle.split('#')
		if (!dans(chapitre)) continue
		const visibles = new Set(
			images
				.filter((i) => i.chapitre === chapitre && ((i.section ?? null) === section || (i.pleinePage && (i.section ?? null) === null)))
				.flatMap((i) => i.libelles.map(normaliserLibelle)),
		)
		for (const libelle of cites) {
			if (visibles.has(libelle) || excepte.has(`${chapitre}|${libelle}`)) continue
			anomalies.push(`élément cité sans image : « ${libelle} » (${cle})`)
		}
	}
	return anomalies
}

/** Les exceptions de la table du §11.3 : « | élément | chapitre | motif | », la ligne d'en-tête et le gabarit exclus. */
export function exceptionsDeLaSpecification(spec) {
	const debut = spec.indexOf('### 11.3 ')
	const fin = spec.indexOf('\n### ', debut + 1)
	const exceptions = []
	for (const ligne of spec.slice(debut, fin).split('\n')) {
		const m = /^\|\s*([^|*][^|]*?)\s*\|\s*`?([a-z0-9-]+)`?\s*\|\s*([^|]+?)\s*\|$/.exec(ligne)
		if (m && m[1] !== 'Élément cité' && !/^-+$/.test(m[1])) exceptions.push({ libelle: m[1].replace(/^«\s*|\s*»$/g, ''), chapitre: m[2], motif: m[3] })
	}
	return exceptions
}
