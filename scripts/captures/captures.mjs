// @spec CRM-122 (docs/BACKLOG.md) — tranche T2 : ce qu'une capture recopie dans `docs/captures/`, et le tri d'un
//       renouvellement par écart de pixels
// @spec docs/SPEC-captures.md §2 (deux demandes, et rien sans elles), §3 (l'écart, ses classes et leurs seuils)
//
// Module pur : il ne lit ni n'écrit aucun fichier. `e2e/ui/captures.ts` décide par `destinationsCapture` ;
// `scripts/captures/rapport.mjs` fait calculer `ecartPixels` par le Chromium de Playwright, puis classe par `classer`.

const FORME_UNITE = /^(CRM|INC)-[0-9]{3}$/

/** Un canal qui bouge de ce nombre ou moins est du bruit de recompression JPEG (§3). */
export const SEUIL_CANAL = 24

/** La part de pixels différents à partir de laquelle une image est « changée » (§3). */
export const SEUIL_CHANGEE = 0.002

/**
 * Où va la capture d'une unité : toujours `e2e/output/<unité>/`, et dans `docs/captures/<unité>/` seulement sur demande.
 * Une valeur hors forme lève : une faute de frappe ne doit jamais passer pour « aucune demande » (§2).
 * @param {string} unite
 * @param {Record<string, string | undefined>} environnement
 */
export function destinationsCapture(unite, environnement) {
	if (!FORME_UNITE.test(unite)) throw new Error(`unité de capture hors forme : « ${unite} »`)
	const renouvellement = environnement.CAPTURES_RENOUVELLEMENT || ''
	if (renouvellement !== '' && renouvellement !== '1') {
		throw new Error(`CAPTURES_RENOUVELLEMENT vaut « 1 » ou est absente, et non « ${renouvellement} »`)
	}
	const brute = environnement.CAPTURES_UNITES || ''
	const unites = brute === '' ? [] : brute.split(',').map((u) => u.trim())
	const fautive = unites.find((u) => !FORME_UNITE.test(u))
	if (fautive !== undefined) throw new Error(`CAPTURES_UNITES porte une unité hors forme : « ${fautive} »`)
	return { sortie: unite, versionner: renouvellement === '1' || unites.includes(unite) }
}

/**
 * La part des pixels de deux images RGBA dont un canal au moins (alpha compris) diffère de plus de `seuil`. Deux tailles
 * différentes valent 1. Fonction autonome, sans fermeture : le rapport l'envoie telle quelle au navigateur.
 * @param {Uint8ClampedArray} a
 * @param {Uint8ClampedArray} b
 */
export function ecartPixels(a, b, seuil = 24) {
	if (a.length !== b.length) return 1
	let differents = 0
	for (let i = 0; i < a.length; i += 4) {
		if (
			Math.abs(a[i] - b[i]) > seuil ||
			Math.abs(a[i + 1] - b[i + 1]) > seuil ||
			Math.abs(a[i + 2] - b[i + 2]) > seuil ||
			Math.abs(a[i + 3] - b[i + 3]) > seuil
		) {
			differents += 1
		}
	}
	return a.length === 0 ? 0 : differents / (a.length / 4)
}

/** « changée » à partir de `SEUIL_CHANGEE`, « bruit » en dessous (§3). */
export function classer(ecart) {
	return ecart >= SEUIL_CHANGEE ? 'changée' : 'bruit'
}
