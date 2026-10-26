#!/usr/bin/env node
// @spec CRM-117 (docs/BACKLOG.md) — tranche T2 : la construction du manuel, et sa vérification
// @spec docs/SPEC-manual.md §15 (le manuel construit versionné, `manuel:verifier`, les refus) ; docs/DAT.md §3.7 quater ;
//       docs/JOURNAL.md décisions 750 et 751
//
// Usage :
//   node scripts/manuel/construire.mjs            écrit docs/manuel/construit/ depuis docs/manual.md
//   node scripts/manuel/construire.mjs --verifier échoue si docs/manuel/construit/ diffère de ce que la source produirait
//
// LE MANUEL CONSTRUIT EST VERSIONNÉ (décision 750, choix 3) : la publication le recopie dans le bucket `manual` sans
// étape de construction sur l'hôte de production. `--verifier` tient la promesse qu'il correspond à sa source — la
// discipline de `npm run types:check` pour les types engendrés.

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { construire, serialiser } from './construction.mjs'

const RACINE = dirname(dirname(import.meta.dirname))
const SOURCE = join(RACINE, 'docs', 'manual.md')
const IMAGES = join(RACINE, 'docs', 'manuel', 'images')
const MANIFESTE = join(IMAGES, 'manifeste.json')
const SORTIE = join(RACINE, 'docs', 'manuel', 'construit')
const verifier = process.argv.includes('--verifier')

const manifeste = existsSync(MANIFESTE) ? JSON.parse(readFileSync(MANIFESTE, 'utf8')) : { images: [] }
const { contents, chapters, erreurs, avertissements } = construire(readFileSync(SOURCE, 'utf8'), manifeste, {
	imageExiste: (fichier) => existsSync(join(IMAGES, fichier)),
})

for (const avertissement of avertissements) console.warn(`manuel : avertissement — ${avertissement}`)
if (erreurs.length > 0) {
	for (const erreur of erreurs) console.error(`manuel : refusé — ${erreur}`)
	console.error(`manuel : ${erreurs.length} refus, rien n'est écrit.`)
	process.exit(1)
}

// Ce que la source produit : un chemin relatif à docs/manuel/construit/, et son contenu.
const attendus = new Map([['contents.json', serialiser(contents)]])
for (const chapitre of chapters) attendus.set(`chapters/${chapitre.slug}.json`, serialiser(chapitre))

function presents() {
	const fichiers = new Map()
	if (existsSync(join(SORTIE, 'contents.json'))) fichiers.set('contents.json', readFileSync(join(SORTIE, 'contents.json'), 'utf8'))
	const dossier = join(SORTIE, 'chapters')
	if (existsSync(dossier))
		for (const nom of readdirSync(dossier)) fichiers.set(`chapters/${nom}`, readFileSync(join(dossier, nom), 'utf8'))
	return fichiers
}

if (verifier) {
	const ecarts = []
	const actuels = presents()
	for (const [chemin, contenu] of attendus) {
		if (!actuels.has(chemin)) ecarts.push(`absent : ${chemin}`)
		else if (actuels.get(chemin) !== contenu) ecarts.push(`périmé : ${chemin}`)
	}
	for (const chemin of actuels.keys()) if (!attendus.has(chemin)) ecarts.push(`en trop : ${chemin}`)
	if (ecarts.length > 0) {
		for (const ecart of ecarts) console.error(`manuel : ${ecart}`)
		console.error('manuel : le manuel construit ne correspond plus à sa source — npm run manuel:construire')
		process.exit(1)
	}
	console.log(`manuel : à jour — ${chapters.length} chapitres, ${avertissements.length} avertissement(s).`)
} else {
	rmSync(join(SORTIE, 'chapters'), { recursive: true, force: true })
	mkdirSync(join(SORTIE, 'chapters'), { recursive: true })
	for (const [chemin, contenu] of attendus) writeFileSync(join(SORTIE, chemin), contenu)
	console.log(`manuel : construit — ${chapters.length} chapitres, ${avertissements.length} avertissement(s).`)
}
