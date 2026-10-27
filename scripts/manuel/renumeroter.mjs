#!/usr/bin/env node
// @spec CRM-117 (docs/BACKLOG.md) — tranche T3.1 : recalculer le numéro des liens internes du manuel
// @spec docs/SPEC-manual.md §10 bis (le numéro d'un lien suit sa cible), §16 (la preuve du manuel)
//
// Usage :
//   node scripts/manuel/renumeroter.mjs             récrit docs/manual.md, chaque numéro de lien aligné sur sa cible
//   node scripts/manuel/renumeroter.mjs --verifier  échoue, en nommant chaque lien, si un numéro ne suit pas sa cible

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { renumeroter } from './liens.mjs'

const SOURCE = join(dirname(dirname(import.meta.dirname)), 'docs', 'manual.md')
const fichier = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? SOURCE
const verifier = process.argv.includes('--verifier')

const { texte, decalages } = renumeroter(readFileSync(fichier, 'utf8'))
for (const d of decalages) console.log(`ligne ${d.ligne} : ${d.avant} → ${d.apres}`)
if (verifier) {
	if (decalages.length > 0) {
		console.error(`manuel : ${decalages.length} lien(s) dont le numéro ne suit pas la cible — npm run manuel:liens`)
		process.exit(1)
	}
	console.log('manuel : le numéro de chaque lien suit sa cible')
	process.exit(0)
}
if (decalages.length > 0) writeFileSync(fichier, texte)
console.log(`manuel : ${decalages.length} lien(s) renuméroté(s)`)
