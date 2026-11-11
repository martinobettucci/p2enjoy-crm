// @spec CRM-140 (docs/BACKLOG.md) — tranche T2 : le corps HTML d'un mail rendu confiné — le nettoyage par DOMPurify et sa
//       configuration, les images distantes déplacées et comptées, les images intégrées (`cid:`) repérées puis résolues,
//       le document servi au cadre et sa politique de contenu en deux états, les adresses web d'un corps texte
//       (docs/SPEC-mail-subsystem.md §30.2 à §30.7 ; décisions 881 et 918) ; la portée couvre tout le module
//
// AUCUN DROIT N'EST APPLIQUÉ ICI, ET AUCUNE BARRIÈRE N'Y REPOSE SEULE. Le cadre (§30.3) n'exécute aucun script et n'a pas
// l'origine de l'application ; sa politique de contenu bloque toute requête distante avant qu'elle parte. Le nettoyage est la
// défense en profondeur que la décision 918 a voulue : il retire ce que le cadre neutraliserait déjà, et ses tests le figent.
// Les pièces se lisent sous la session, par la politique de stockage `0029` (pièce saine, message lisible).

import DOMPurify from 'dompurify'
import feuilleDesJetons from '../styles/tokens.css?raw'
import { formeApercu, lireFichierPiece, typeForce } from './pieces-jointes'
import type { PieceJointe } from './inbox'
import type { ClientCrm } from './supabase'

/** La borne d'une image intégrée (§30.6) : au-delà, la mention « indisponible ». */
export const IMAGE_INTEGREE_MAX_OCTETS = 5 * 1024 * 1024

/** Les attributs que le CRM pose lui-même ; ceux qu'un expéditeur écrirait sont retirés (`ALLOW_DATA_ATTR: false`). */
const ATTRIBUT_DISTANTE = 'data-crm-src'
const ATTRIBUT_CID = 'data-crm-cid'

const SCHEMAS_LIEN = /^(?:https?|mailto):/i
const SCHEMA_DISTANT = /^https?:/i
const SCHEMA_CID = /^cid:/i

/** Retirés AVEC leur contenu (§30.4). `svg` et `math` tombent par le profil HTML seul. */
const BALISES_INTERDITES = [
	'script',
	'noscript',
	'template',
	'iframe',
	'frame',
	'frameset',
	'object',
	'embed',
	'applet',
	'form',
	'input',
	'button',
	'select',
	'option',
	'textarea',
	'meta',
	'base',
	'link',
	'audio',
	'video',
	'source',
	'track',
	'picture',
]

const ATTRIBUTS_INTERDITS = ['srcset', 'ping', 'formaction', 'action', 'background', 'poster', 'srcdoc']

export type CorpsNettoye = {
	/** Le HTML nettoyé, images distantes déplacées dans `data-crm-src`, images intégrées repérées par `data-crm-cid`. */
	readonly html: string
	/** Le nombre d'images distantes bloquées : le bandeau paraît s'il est positif (§30.5). */
	readonly imagesDistantes: number
	/** Les `Content-ID` cités, normalisés, sans doublon, dans l'ordre du message. */
	readonly cids: readonly string[]
	/** Vrai quand rien de visible ne reste : le cadre n'est alors jamais montré (§30.2). */
	readonly vide: boolean
}

/** Un `Content-ID` comparable : sans blancs autour, sans chevrons, en minuscules (§30.6). */
export function normaliserContentId(valeur: string): string {
	return valeur.trim().replace(/^</, '').replace(/>$/, '').trim().toLowerCase()
}

/** L'identifiant d'une adresse `cid:` (RFC 2392 : il y est encodé comme une adresse). */
function idDeCid(adresse: string): string {
	const brut = adresse.trim().slice(4)
	try {
		return normaliserContentId(decodeURIComponent(brut))
	} catch {
		return normaliserContentId(brut)
	}
}

let instance: ReturnType<typeof DOMPurify> | null = null

/** Une instance À NOUS : les crochets de ce module ne touchent pas l'instance partagée de la bibliothèque. */
function purificateur(): ReturnType<typeof DOMPurify> {
	if (instance === null) instance = DOMPurify()
	return instance
}

/** Nettoie le HTML d'un expéditeur selon le §30.4. Rien n'est réécrit en base : la fonction ne fait que le lire. */
export function nettoyerHtml(html: string): CorpsNettoye {
	const p = purificateur()
	let imagesDistantes = 0
	const cids: string[] = []

	p.removeAllHooks()
	p.addHook('afterSanitizeAttributes', (noeud) => {
		const element = noeud as Element
		const balise = element.nodeName.toLowerCase()
		if (balise === 'a' || balise === 'area') {
			const cible = (element.getAttribute('href') ?? '').trim()
			if (SCHEMAS_LIEN.test(cible)) {
				// CHAQUE lien gardé, que l'expéditeur ait écrit `target` ou non (§30.4).
				element.setAttribute('target', '_blank')
				element.setAttribute('rel', 'noopener noreferrer')
			} else {
				element.removeAttribute('href')
				element.removeAttribute('target')
			}
			return
		}
		if (element.hasAttribute('target')) element.removeAttribute('target')
		if (balise !== 'img') return
		const source = (element.getAttribute('src') ?? '').trim()
		element.removeAttribute('src')
		if (SCHEMA_DISTANT.test(source)) {
			element.setAttribute(ATTRIBUT_DISTANTE, source)
			imagesDistantes += 1
		} else if (SCHEMA_CID.test(source)) {
			const id = idDeCid(source)
			if (id !== '') {
				element.setAttribute(ATTRIBUT_CID, id)
				if (!cids.includes(id)) cids.push(id)
			}
		}
		// Tout autre `src` — dont un `data:` d'expéditeur — est retiré : une image intégrée n'arrive que par sa pièce.
	})

	const corps = p.sanitize(html, {
		USE_PROFILES: { html: true },
		FORBID_TAGS: BALISES_INTERDITES,
		// « Retirés AVEC leur contenu » : sans cette liste, DOMPurify garderait le texte d'un `<button>` ou d'une `<option>`.
		ADD_FORBID_CONTENTS: BALISES_INTERDITES,
		FORBID_ATTR: ATTRIBUTS_INTERDITS,
		ALLOW_DATA_ATTR: false,
		// Les styles placés en tête d'un courrier restent avec son corps, au lieu d'être perdus avec `<head>`.
		FORCE_BODY: true,
		RETURN_DOM: true,
	}) as HTMLElement
	p.removeAllHooks()

	const visible =
		(corps.textContent ?? '').replace(/\s+/g, '') !== '' || corps.querySelector(`img[${ATTRIBUT_DISTANTE}], img[${ATTRIBUT_CID}]`) !== null
	return { html: corps.innerHTML, imagesDistantes, cids, vide: !visible }
}

/** La politique de contenu du cadre, selon l'état des images (§30.3). */
export function politiqueDeContenu(imagesAffichees: boolean): string {
	const images = imagesAffichees ? "img-src data: https: http:" : 'img-src data:'
	return `default-src 'none'; ${images}; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'`
}

/** Les jetons que la feuille du cadre emploie (docs/DESIGN_SYSTEM.md §5.100, §12.7). */
export const NOMS_DES_JETONS = ['--color-surface', '--color-text', '--color-text-2', '--color-border', '--font-sans', '--radius-sm'] as const
export type NomJeton = (typeof NOMS_DES_JETONS)[number]

/**
 * Les valeurs des jetons, LUES dans la source de `tokens.css` (docs/DESIGN_SYSTEM.md §12.7). Le document du cadre a une
 * origine opaque : il ne lit pas les variables CSS de l'application. Plutôt que de recopier leurs valeurs — le §11 interdit
 * l'hexadécimal hors du fichier des jetons —, le module les extrait du fichier lui-même, embarqué au build par `?raw`.
 * Un jeton absent est une faute de construction : la fonction le dit, au lieu de rendre un cadre sans couleur.
 */
export function lireJetons(source: string): Readonly<Record<NomJeton, string>> {
	const valeurs = {} as Record<NomJeton, string>
	for (const nom of NOMS_DES_JETONS) {
		const trouve = new RegExp(`${nom}:\\s*([^;]+);`).exec(source)
		if (trouve === null) throw new Error(`Le jeton ${nom} est absent de tokens.css (docs/DESIGN_SYSTEM.md §12.7).`)
		valeurs[nom] = trouve[1]!.trim()
	}
	return valeurs
}

export const JETONS_DU_CADRE = lireJetons(feuilleDesJetons)

/** La feuille de base, écrite par le CRM (§30.8) ; le HTML de l'expéditeur garde la main sur sa mise en page. */
const FEUILLE_DE_BASE = [
	`html{background:${JETONS_DU_CADRE['--color-surface']}}`,
	`body{margin:12px;color:${JETONS_DU_CADRE['--color-text']};font-family:${JETONS_DU_CADRE['--font-sans']};font-size:15px;line-height:1.55;overflow-wrap:anywhere}`,
	'img{max-width:100%;height:auto}',
	`.crm-image-indisponible{display:inline-block;border:1px dashed ${JETONS_DU_CADRE['--color-border']};border-radius:${JETONS_DU_CADRE['--radius-sm']};padding:4px 8px;color:${JETONS_DU_CADRE['--color-text-2']};font-size:13px}`,
].join('')

/**
 * Le document servi au cadre par `srcdoc` (§30.3) : la politique de contenu EN TÊTE, avant tout contenu ; les images
 * intégrées résolues ; les images distantes rendues à `src` seulement si `imagesAffichees`.
 *
 * `images` associe un `Content-ID` normalisé à son adresse `data:` ; une absence, ou `null`, donne la mention.
 */
export function documentDuCadre({
	html,
	images,
	imagesAffichees,
	mentionIndisponible,
}: {
	readonly html: string
	readonly images: ReadonlyMap<string, string | null>
	readonly imagesAffichees: boolean
	readonly mentionIndisponible: string
}): string {
	const gabarit = document.createElement('template')
	gabarit.innerHTML = html
	for (const image of Array.from(gabarit.content.querySelectorAll<HTMLImageElement>(`img[${ATTRIBUT_CID}]`))) {
		const adresse = images.get(image.getAttribute(ATTRIBUT_CID) ?? '') ?? null
		if (adresse !== null && adresse.startsWith('data:image/')) {
			image.setAttribute('src', adresse)
			continue
		}
		const mention = document.createElement('span')
		mention.className = 'crm-image-indisponible'
		const alternatif = (image.getAttribute('alt') ?? '').trim()
		mention.textContent = alternatif === '' ? mentionIndisponible : `${mentionIndisponible} — ${alternatif}`
		image.replaceWith(mention)
	}
	if (imagesAffichees) {
		for (const image of Array.from(gabarit.content.querySelectorAll<HTMLImageElement>(`img[${ATTRIBUT_DISTANTE}]`))) {
			const adresse = image.getAttribute(ATTRIBUT_DISTANTE) ?? ''
			if (SCHEMA_DISTANT.test(adresse)) image.setAttribute('src', adresse)
		}
	}
	return (
		'<!doctype html><html><head><meta charset="utf-8">' +
		`<meta http-equiv="Content-Security-Policy" content="${politiqueDeContenu(imagesAffichees)}">` +
		'<meta name="referrer" content="no-referrer"><base target="_blank">' +
		`<style>${FEUILLE_DE_BASE}</style></head><body>${gabarit.innerHTML}</body></html>`
	)
}

/** Les pièces qu'une liste de `Content-ID` désigne : la première par nom l'emporte (§30.6). */
export function piecesDesCids(cids: readonly string[], pieces: readonly PieceJointe[]): ReadonlyMap<string, PieceJointe> {
	const triees = [...pieces].sort((a, b) => a.nom.localeCompare(b.nom))
	const resultat = new Map<string, PieceJointe>()
	for (const id of cids) {
		const piece = triees.find((candidate) => candidate.contentId !== null && normaliserContentId(candidate.contentId) === id)
		if (piece !== undefined) resultat.set(id, piece)
	}
	return resultat
}

/** Une image intégrée affichable, lue sous la session, en `data:` au type FORCÉ ; `null` sinon (§30.6). */
export async function lireImageIntegree(client: ClientCrm | null, piece: PieceJointe): Promise<string | null> {
	if (formeApercu(piece) !== 'image' || piece.taille > IMAGE_INTEGREE_MAX_OCTETS) return null
	const fichier = await lireFichierPiece(client, piece.chemin)
	if (fichier === null) return null
	const octets = new Uint8Array(await fichier.arrayBuffer())
	let binaire = ''
	for (let debut = 0; debut < octets.length; debut += 0x8000) {
		binaire += String.fromCharCode(...octets.subarray(debut, debut + 0x8000))
	}
	return `data:${typeForce('image', piece)};base64,${btoa(binaire)}`
}

/** Les images intégrées d'un corps, lues en parallèle ; une lecture manquée donne la mention, jamais une panne. */
export async function lireImagesIntegrees(
	client: ClientCrm | null,
	cids: readonly string[],
	pieces: readonly PieceJointe[],
): Promise<ReadonlyMap<string, string | null>> {
	const designees = piecesDesCids(cids, pieces)
	const lues = await Promise.all(
		cids.map(async (id) => {
			const piece = designees.get(id)
			return [id, piece === undefined ? null : await lireImageIntegree(client, piece)] as const
		}),
	)
	return new Map(lues)
}

export type MorceauTexte = { readonly type: 'texte'; readonly valeur: string } | { readonly type: 'lien'; readonly valeur: string }

const ADRESSE_WEB = /https?:\/\/[^\s<>"]+/gi
const PONCTUATION_FINALE = /[.,;:!?)»]+$/

/** Un corps texte découpé en morceaux, ses adresses `http(s)://` devenues des liens (§30.7). */
export function decouperLiens(texte: string): readonly MorceauTexte[] {
	const morceaux: MorceauTexte[] = []
	let curseur = 0
	for (const trouve of texte.matchAll(ADRESSE_WEB)) {
		const debut = trouve.index
		const adresse = trouve[0].replace(PONCTUATION_FINALE, '')
		if (!/^https?:\/\/[^/]/i.test(adresse)) continue
		if (debut > curseur) morceaux.push({ type: 'texte', valeur: texte.slice(curseur, debut) })
		morceaux.push({ type: 'lien', valeur: adresse })
		curseur = debut + adresse.length
	}
	if (curseur < texte.length) morceaux.push({ type: 'texte', valeur: texte.slice(curseur) })
	return morceaux
}
