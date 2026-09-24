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
// Le contrôle ne lit que les valeurs d'attributs `className` et les initialiseurs des constantes
// `CLASSES_*` : les clés de traduction et le texte français des commentaires ne sont donc jamais
// pris pour des classes.
//
// @spec docs/BACKLOG.md « Correctifs arbitrés », INC-251 ; docs/JOURNAL.md décision 596 — DEUX
// ANGLES MORTS FERMÉS le 2026-09-24. (1) Les constantes : `CLASSES_CHAMP = '… text-text-1'` n'était
// lue par personne, et le contrôle rendait « aucune classe manquante » sur une classe absente — la
// convention du dépôt nomme ces constantes `CLASSES_*`, chaîne, tableau joint ou table par jeton.
// (2) Les variables des valeurs arbitraires : `accent-[var(--color-primary)]` EST engendrée, mais
// la variable n'est déclarée nulle part ; chaque `var(--…)` citée doit donc être DÉCLARÉE dans le
// CSS produit (`--nom:`), sans quoi la propriété retombe en silence sur sa valeur initiale.
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

// L'initialiseur d'une constante `CLASSES_*`, lu jusqu'à sa fin : une chaîne, ou un tableau, un
// objet, un appel équilibrés. Les chaînes sont SAUTÉES pendant l'équilibrage — une classe comme
// `min-h-[var(--size-target)]` porte des crochets qui ne ferment rien.
function initialiseur(source, debut) {
	let profondeur = 0
	let i = debut
	while (i < source.length) {
		const c = source[i]
		if (c === "'" || c === '"' || c === '`') {
			const fin = source.indexOf(c, i + 1)
			if (fin === -1) return source.slice(debut)
			i = fin + 1
			if (profondeur === 0) {
				// Une chaîne seule, ou suivie d'un appel de méthode (`.trim()`) : on poursuit sur la
				// même expression, jamais au-delà de la ligne.
				const reste = source.slice(i).match(/^\s*\./)
				if (reste === null) return source.slice(debut, i)
			}
			continue
		}
		if (c === '[' || c === '{' || c === '(') profondeur += 1
		else if (c === ']' || c === '}' || c === ')') {
			profondeur -= 1
			if (profondeur === 0) {
				const reste = source.slice(i + 1).match(/^\s*\./)
				if (reste === null) return source.slice(debut, i + 1)
			}
		} else if (c === '\n' && profondeur === 0 && source.slice(debut, i).trim() !== '') {
			return source.slice(debut, i)
		}
		i += 1
	}
	return source.slice(debut)
}

function jetonsDesLitteraux(expression, classes) {
	for (const litteral of expression.matchAll(/'([^'\n]*)'|"([^"\n]*)"|`([^`$]*)`/g)) {
		const chaine = litteral[1] ?? litteral[2] ?? litteral[3] ?? ''
		for (const jeton of chaine.split(/\s+/)) {
			if (jeton !== '') classes.add(jeton)
		}
	}
}

/** Les classes des constantes `CLASSES_*` du fichier — convention du dépôt, INC-251. */
function classesDesConstantes(source) {
	const classes = new Set()
	for (const declaration of source.matchAll(/\bconst\s+CLASSES_[A-Z0-9_]*\b[^=\n]*=\s*/g)) {
		const debut = (declaration.index ?? 0) + declaration[0].length
		jetonsDesLitteraux(initialiseur(source, debut), classes)
	}
	return classes
}

/** Les variables CSS citées par une valeur arbitraire : `accent-[var(--color-brand)]` → `--color-brand`. */
function variablesCitees(classe) {
	return [...classe.matchAll(/var\((--[A-Za-z0-9_-]+)/g)].map((m) => m[1])
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
	const brute = readFileSync(chemin, 'utf8')
	for (const classe of classesDuFichier(brute)) toutes.add(classe)
	const sansCommentaires = brute.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
	for (const classe of classesDesConstantes(sansCommentaires)) toutes.add(classe)
}

const absentes = [...toutes].filter((classe) => !css.includes(selecteur(classe))).sort()

// Une variable est DÉCLARÉE si le CSS produit porte `--nom:` quelque part — `:root`, `@theme` rendu,
// ou une règle locale. Sa seule citation dans `var(--nom)` ne compte pas.
const nonDeclarees = []
for (const classe of [...toutes].sort()) {
	for (const variable of variablesCitees(classe)) {
		if (!css.includes(`${variable}:`)) nonDeclarees.push(`${variable} (${classe})`)
	}
}

console.log(`classes citées : ${toutes.size}`)
let rouge = false
if (absentes.length > 0) {
	console.error(`classes absentes du CSS produit : ${absentes.join(' ')}`)
	rouge = true
}
if (nonDeclarees.length > 0) {
	console.error(`variables CSS citées mais déclarées nulle part : ${nonDeclarees.join(' ')}`)
	rouge = true
}
if (rouge) process.exit(1)
console.log('aucune classe manquante')
