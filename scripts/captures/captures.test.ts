// @verifies CRM-122 (docs/BACKLOG.md) — tranche T2 : ce qu'une capture recopie dans `docs/captures/` selon la demande, et
//           le tri d'un renouvellement par écart de pixels
// @verifies docs/SPEC-captures.md §2 (deux demandes, et rien sans elles ; les valeurs refusées), §3 (l'écart, ses classes
//           et leurs seuils)
//
// Le module est pur : chaque cas lui donne un environnement ou deux images en mémoire, et lit ce qu'il rend.

import { describe, expect, it } from 'vitest'
import { SEUIL_CANAL, SEUIL_CHANGEE, classer, destinationsCapture, ecartPixels } from './captures.mjs'

describe('destinationsCapture (§2)', () => {
	it('sans demande, rien n’est recopié ; la sortie est toujours e2e/output/<unité>/', () => {
		expect(destinationsCapture('CRM-007', {})).toEqual({ sortie: 'CRM-007', versionner: false })
	})

	it('l’unité nommée seule est recopiée ; une liste en nomme plusieurs, espaces tolérés', () => {
		expect(destinationsCapture('CRM-122', { CAPTURES_UNITES: 'CRM-122' }).versionner).toBe(true)
		expect(destinationsCapture('CRM-074', { CAPTURES_UNITES: 'CRM-122' }).versionner).toBe(false)
		const liste = { CAPTURES_UNITES: 'CRM-122, INC-323' }
		expect(destinationsCapture('INC-323', liste).versionner).toBe(true)
		expect(destinationsCapture('CRM-122', liste).versionner).toBe(true)
		expect(destinationsCapture('CRM-007', liste).versionner).toBe(false)
	})

	it('le renouvellement recopie tout', () => {
		expect(destinationsCapture('CRM-007', { CAPTURES_RENOUVELLEMENT: '1' }).versionner).toBe(true)
		expect(destinationsCapture('CRM-074', { CAPTURES_RENOUVELLEMENT: '1', CAPTURES_UNITES: 'CRM-122' }).versionner).toBe(true)
	})

	it('une valeur hors forme est refusée, jamais lue comme « aucune demande »', () => {
		expect(() => destinationsCapture('CRM-122', { CAPTURES_UNITES: 'crm-122' })).toThrow(/CAPTURES_UNITES/)
		expect(() => destinationsCapture('CRM-122', { CAPTURES_UNITES: 'CRM-122,' })).toThrow(/CAPTURES_UNITES/)
		expect(() => destinationsCapture('CRM-122', { CAPTURES_RENOUVELLEMENT: 'oui' })).toThrow(/CAPTURES_RENOUVELLEMENT/)
		expect(() => destinationsCapture('../ailleurs', {})).toThrow(/unité/)
	})

	it('une variable vide vaut absente', () => {
		expect(destinationsCapture('CRM-122', { CAPTURES_UNITES: '', CAPTURES_RENOUVELLEMENT: '' }).versionner).toBe(false)
	})
})

/** Une image RGBA unie de `largeur` × `hauteur`, dont `differents` pixels portent `delta` sur le rouge. */
function image(largeur: number, hauteur: number, differents = 0, delta = 0): Uint8ClampedArray {
	const pixels = new Uint8ClampedArray(largeur * hauteur * 4).fill(100)
	for (let i = 0; i < differents; i += 1) pixels[i * 4] = 100 + delta
	return pixels
}

describe('ecartPixels et classer (§3)', () => {
	it('deux images égales : écart nul, bruit', () => {
		expect(ecartPixels(image(10, 10), image(10, 10))).toBe(0)
		expect(classer(0)).toBe('bruit')
	})

	it('un canal qui bouge de 24 ou moins est du bruit de recompression ; au-delà, le pixel compte', () => {
		expect(ecartPixels(image(10, 10), image(10, 10, 50, SEUIL_CANAL))).toBe(0)
		expect(ecartPixels(image(10, 10), image(10, 10, 50, SEUIL_CANAL + 1))).toBe(0.5)
	})

	it('une image est changée à partir de 0,2 % de pixels différents, du bruit en dessous', () => {
		const total = 1000 * 10
		expect(ecartPixels(image(1000, 10), image(1000, 10, 20, 80))).toBe(20 / total)
		expect(classer(20 / total)).toBe('changée')
		expect(classer(19 / total)).toBe('bruit')
		expect(SEUIL_CHANGEE).toBe(0.002)
	})

	it('deux tailles différentes valent un écart de 100 %', () => {
		expect(ecartPixels(image(10, 10), image(10, 11))).toBe(1)
		expect(classer(1)).toBe('changée')
	})
})
