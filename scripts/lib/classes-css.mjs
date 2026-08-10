// @spec CRM-007 (docs/BACKLOG.md) — contrôle des classes utilitaires réellement engendrées
// @spec docs/SPEC-webapp.md §4 (jetons), §14 (preuves) ; docs/DESIGN_SYSTEM.md §11
//
// Vérifie que **chaque classe utilitaire citée par un composant existe dans le CSS produit**.
//
// Motif, tiré d'un défaut réel : les espaces de noms de Tailwind sont remis à zéro dans
// `tokens.css` pour interdire les couleurs et les espacements hors design system. Une classe
// dont le jeton n'est pas déclaré n'est alors **pas engendrée du tout** — silencieusement.
// C'est ainsi que `min-w-0` a disparu, et avec elle la garde qui empêche une colonne de flex
// de déborder : la page défilait horizontalement sous 768 px, contre docs/DESIGN_SYSTEM.md §7.
//
// Le contrôle ne lit que les valeurs d'attributs `className` : les clés de traduction et le
// texte français des commentaires ne sont donc jamais pris pour des classes.
//
// Usage : node scripts/lib/classes-css.mjs <racine-src> <repertoire-dist>

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const [racineSrc, racineDist] = process.argv.slice(2)
if (racineSrc === undefined || racineDist === undefined) {
	console.error('usage : node scripts/lib/classes-css.mjs <racine-src> <repertoire-dist>')
	process.exit(2)
}

function fichiers(racine, filtre) {
	const trouves = []
	for (const entree of readdirSync(racine, { withFileTypes: true })) {
		const chemin = join(racine, entree.name)
		if (entree.isDirectory()) trouves.push(...fichiers(chemin, filtre))
		else if (filtre(entree.name)) trouves.push(chemin)
	}
	return trouves
}

// Toutes les chaînes littérales situées dans une expression `className=...`, que celle-ci soit
// une chaîne simple ou un tableau joint.
//
// Les commentaires sont retirés d'abord : ils sont rédigés en français, et une apostrophe y
// ouvrirait une fausse chaîne littérale — « l'opacité » deviendrait une classe.
function classesDuFichier(sourceBrute) {
	const source = sourceBrute.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
	const classes = new Set()
	for (const occurrence of source.matchAll(/className\s*=\s*(\{[\s\S]*?\}|"[^"]*")/g)) {
		const expression = occurrence[1] ?? ''
		for (const litteral of expression.matchAll(/'([^'\n]*)'|"([^"\n]*)"/g)) {
			const chaine = litteral[1] ?? litteral[2] ?? ''
			for (const jeton of chaine.split(/\s+/)) {
				if (jeton !== '') classes.add(jeton)
			}
		}
	}
	return classes
}

/** Échappement CSS des caractères que Tailwind protège dans un sélecteur de classe. */
function selecteur(classe) {
	return '.' + classe.replace(/[.:[\]()/%,#>+~*=&$!?|'\"]/g, (caractere) => `\\${caractere}`)
}

const sources = fichiers(racineSrc, (nom) => /\.tsx?$/.test(nom) && !nom.includes('.test.'))
const feuilles = fichiers(racineDist, (nom) => nom.endsWith('.css'))
if (feuilles.length === 0) {
	console.error(`aucune feuille de style dans ${racineDist} : le build n'a rien produit`)
	process.exit(1)
}
const css = feuilles.map((chemin) => readFileSync(chemin, 'utf8')).join('\n')

const toutes = new Set()
for (const chemin of sources) {
	for (const classe of classesDuFichier(readFileSync(chemin, 'utf8'))) toutes.add(classe)
}

const absentes = [...toutes].filter((classe) => !css.includes(selecteur(classe))).sort()

console.log(`classes citées : ${toutes.size}`)
if (absentes.length > 0) {
	console.error(`classes absentes du CSS produit : ${absentes.join(' ')}`)
	process.exit(1)
}
console.log('aucune classe manquante')
