// @spec CRM-007 (docs/BACKLOG.md) — harnais E2E de la coquille et des captures
// @spec docs/SPEC-webapp.md §13 (commandes), §14 (preuves) ; docs/DESIGN_SYSTEM.md §11 (captures)
// @spec README.md §7 (tests)
//
// Seul le projet `ui` est déclaré ici. Les projets `api` et `mail` annoncés par README.md §7
// relèvent de `CRM-008` : les déclarer vides donnerait l'illusion d'un harnais complet.
//
// Le serveur sous test sert le **build de production**, pas le serveur de développement : ce
// qui est éprouvé doit être ce qui sera déployé. Le build est refait à chaque exécution, avec
// les mêmes variables que celles injectées ici — une preuve obtenue sur un `dist` périmé ne
// prouverait rien.

import { defineConfig, devices } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const RACINE = dirname(import.meta.dirname)
const PORT = Number(process.env['WEBAPP_PREVIEW_PORT'] ?? 4173)
const URL_BASE = `http://127.0.0.1:${PORT}`

/**
 * Lit une variable du `.env` de la racine sans dépendance supplémentaire.
 *
 * Le fichier est le contrat d'environnement du dépôt (README.md §9) ; les preuves lisent la
 * même source que la pile, sinon elles mesureraient une configuration qui n'existe nulle part.
 */
function lireEnv(nom: string): string {
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

const urlApi = process.env['VITE_SUPABASE_URL'] ?? `http://127.0.0.1:${lireEnv('KONG_HTTP_PORT')}`
const cleAnonyme = process.env['VITE_SUPABASE_ANON_KEY'] ?? lireEnv('ANON_KEY')

export default defineConfig({
	testDir: join(import.meta.dirname, 'ui'),
	outputDir: join(import.meta.dirname, 'test-results'),
	fullyParallel: false,
	forbidOnly: true,
	retries: 0,
	workers: 1,
	reporter: [['list']],
	use: {
		baseURL: URL_BASE,
		...devices['Desktop Chrome'],
		// Les traces et vidéos ne sont conservées qu'en cas d'échec : ce sont des pièces de
		// diagnostic, pas des artefacts de livraison.
		trace: 'retain-on-failure',
		video: 'retain-on-failure',
	},
	projects: [{ name: 'ui' }],
	webServer: {
		command: 'npm run build && npm run preview',
		url: URL_BASE,
		cwd: RACINE,
		reuseExistingServer: false,
		timeout: 120_000,
		env: {
			VITE_SUPABASE_URL: urlApi,
			VITE_SUPABASE_ANON_KEY: cleAnonyme,
			WEBAPP_PREVIEW_PORT: String(PORT),
		},
	},
})

export const CONFIGURATION_PREUVES = { urlApi, PORT }
