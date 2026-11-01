// @spec CRM-122 (docs/BACKLOG.md) — tranche T2 : le rapport d'un renouvellement des captures — chaque image de
//       `docs/captures/` modifiée, ajoutée ou supprimée, confrontée à `HEAD`, classée par écart de pixels ; le bruit rendu
// @spec docs/SPEC-captures.md §3 (ce qu'il compare, l'écart, les trois classes, le rapport) ; commande
//       `npm run captures:rapport`
//
// Les images sont décodées et comparées par le Chromium de Playwright, dans un canevas : aucune dépendance nouvelle, et
// le même décodeur que celui qui a produit les captures. L'écart est calculé par `ecartPixels`, la fonction même que les
// tests unitaires éprouvent, envoyée telle quelle au navigateur.
//
// Usage :
//   npm run captures:rapport                   rapport, et le bruit rendu à sa version committée (le défaut)
//   npm run captures:rapport -- --garder-le-bruit

import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from '@playwright/test'
import { SEUIL_CANAL, classer, ecartPixels } from './captures.mjs'

const RACINE = join(import.meta.dirname, '..', '..')
const RAPPORT = join(RACINE, 'e2e', 'output', 'captures-rapport.md')
const garderLeBruit = process.argv.includes('--garder-le-bruit')

const git = (...args) => execFileSync('git', args, { cwd: RACINE, maxBuffer: 1 << 30 })

// Les images touchées sous `docs/captures/`, avec leur état Git : modifiée, ajoutée (non suivie comprise), supprimée.
const etats = git('status', '--porcelain', '-z', '--untracked-files=all', '--', 'docs/captures')
	.toString()
	.split('\0')
	.filter((ligne) => ligne.endsWith('.jpg'))
	.map((ligne) => ({ code: ligne.slice(0, 2), chemin: ligne.slice(3) }))

const navigateur = await chromium.launch()
const page = await navigateur.newPage()
await page.setContent('<canvas></canvas>')

/** L'écart de deux JPEG, décodés et comparés dans la page. */
async function ecart(avant, apres) {
	return page.evaluate(
		async ({ a, b, seuil, source }) => {
			const decoder = async (base64) => {
				const image = await createImageBitmap(await (await fetch(`data:image/jpeg;base64,${base64}`)).blob())
				const canevas = new OffscreenCanvas(image.width, image.height)
				const contexte = canevas.getContext('2d')
				contexte.drawImage(image, 0, 0)
				return { largeur: image.width, hauteur: image.height, pixels: contexte.getImageData(0, 0, image.width, image.height).data }
			}
			const [x, y] = [await decoder(a), await decoder(b)]
			if (x.largeur !== y.largeur || x.hauteur !== y.hauteur) return 1
			const calculer = new Function(`return (${source})`)()
			return calculer(x.pixels, y.pixels, seuil)
		},
		{ a: avant.toString('base64'), b: apres.toString('base64'), seuil: SEUIL_CANAL, source: ecartPixels.toString() },
	)
}

const lignes = []
for (const { code, chemin } of etats) {
	if (code.includes('D')) {
		lignes.push({ chemin, classe: 'supprimée', ecart: 1 })
	} else if (code === '??' || code.includes('A')) {
		lignes.push({ chemin, classe: 'ajoutée', ecart: 1 })
	} else {
		const valeur = await ecart(git('show', `HEAD:${chemin}`), readFileSync(join(RACINE, chemin)))
		lignes.push({ chemin, classe: classer(valeur), ecart: valeur })
	}
}
await navigateur.close()

const bruit = lignes.filter((l) => l.classe === 'bruit')
if (!garderLeBruit && bruit.length > 0) git('checkout', 'HEAD', '--', ...bruit.map((l) => l.chemin))

lignes.sort((a, b) => b.ecart - a.ecart || a.chemin.localeCompare(b.chemin))
const compte = (classe) => lignes.filter((l) => l.classe === classe).length
const pourcent = (valeur) => `${(valeur * 100).toFixed(2)} %`
const texte = [
	`# Rapport de renouvellement des captures — ${new Date().toISOString()}`,
	'',
	`Changées : ${compte('changée')} · ajoutées : ${compte('ajoutée')} · supprimées : ${compte('supprimée')} · bruit : ${bruit.length}` +
		(garderLeBruit ? ' (gardé)' : ' (rendu à sa version committée)'),
	'',
	'À observer une à une : les images changées, ajoutées et supprimées (docs/SPEC-captures.md §3).',
	'',
	'| Image | Classe | Écart |',
	'|---|---|---|',
	...lignes.map((l) => `| \`${l.chemin}\` | ${l.classe} | ${pourcent(l.ecart)} |`),
	'',
].join('\n')
mkdirSync(join(RACINE, 'e2e', 'output'), { recursive: true })
writeFileSync(RAPPORT, texte)
console.log(texte.split('\n').slice(0, 3).join('\n'))
console.log(`Rapport complet : ${RAPPORT}`)
