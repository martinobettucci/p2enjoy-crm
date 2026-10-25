// @spec CRM-008 (docs/BACKLOG.md) — amorce d'environnement commune aux projets Playwright
// @spec docs/SPEC-test-harness.md §4.1 (une seule configuration), §4.3 (projet api)
// @spec README.md §9 (variables d'environnement)
// @spec CRM-115 (docs/BACKLOG.md) tranche T4 — `portPrevisualisation` : le port de l'emplacement de la pile, lu dans
//       `.env` (docs/SPEC-pile-par-session.md §5)
//
// Les preuves lisent le `.env` de la racine, c'est-à-dire **la même source que la pile** : une
// preuve obtenue contre une configuration qui n'existe nulle part ne prouverait rien.
//
// Ce module était auparavant inséré dans `playwright.config.ts`. Il en est extrait parce que le
// projet `api` en a besoin sans passer par la configuration — un fichier de scénarios ne peut
// pas importer la configuration sans créer une dépendance circulaire.

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/** Racine du dépôt, déduite de l'emplacement de ce fichier — jamais du répertoire courant. */
export const RACINE = dirname(import.meta.dirname)

/**
 * Lit une variable du `.env` de la racine sans dépendance supplémentaire.
 *
 * Échoue explicitement plutôt que de rendre une valeur vide : une variable absente doit
 * interrompre la preuve en nommant la commande qui l'amorce, pas produire un scénario qui
 * interroge `http://127.0.0.1:undefined`.
 */
export function lireEnv(nom: string): string {
	const chemin = join(RACINE, '.env')
	let contenu: string
	try {
		contenu = readFileSync(chemin, 'utf8')
	} catch {
		throw new Error(`Fichier .env absent : lancez ./runDev.sh, qui l'amorce depuis .env.example.`)
	}
	for (const ligne of contenu.split('\n')) {
		const separateur = ligne.indexOf('=')
		if (separateur > 0 && ligne.slice(0, separateur).trim() === nom) {
			return ligne.slice(separateur + 1).trim()
		}
	}
	throw new Error(`Variable ${nom} absente de .env`)
}

/**
 * Le port de la prévisualisation des preuves : l'environnement de l'appelant, puis `.env` — où l'emplacement de la pile
 * l'écrit (`CRM-115` T4, docs/SPEC-pile-par-session.md §5) —, puis 4173, la valeur d'avant les emplacements.
 */
export function portPrevisualisation(): number {
	const brut = process.env['WEBAPP_PREVIEW_PORT']
	if (brut !== undefined && brut !== '') return Number(brut)
	try {
		return Number(lireEnv('WEBAPP_PREVIEW_PORT'))
	} catch {
		return 4173
	}
}

/** URL de la passerelle Kong, surchargeable pour viser une autre pile. */
export function urlApi(): string {
	return process.env['VITE_SUPABASE_URL'] ?? `http://127.0.0.1:${lireEnv('KONG_HTTP_PORT')}`
}

/** Clé anonyme : celle que porte la webapp, et celle de l'appelant non authentifié. */
export function cleAnonyme(): string {
	return process.env['VITE_SUPABASE_ANON_KEY'] ?? lireEnv('ANON_KEY')
}

/**
 * Clé de service : elle contourne la RLS.
 *
 * Elle n'est jamais employée pour prouver un refus — elle sert à établir que les lignes
 * **existent** avant d'affirmer que personne ne les voit (docs/JOURNAL.md décision 50).
 */
export function cleService(): string {
	return lireEnv('SERVICE_ROLE_KEY')
}
