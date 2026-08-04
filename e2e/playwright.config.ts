// @spec CRM-007 (docs/BACKLOG.md) — harnais E2E de la coquille et des captures
// @spec CRM-008 (docs/BACKLOG.md) — projets Playwright, déclaration du webServer, rapport HTML
// @spec docs/SPEC-test-harness.md §4 (projets), §4.2 (webServer), §5 (rapport)
// @spec docs/SPEC-webapp.md §13 (commandes), §14 (preuves) ; docs/DESIGN_SYSTEM.md §11 (captures)
// @spec README.md §7 (tests)
//
// Deux projets sont déclarés : `api`, qui parle directement à Kong, et `ui`, qui exerce
// l'application construite et servie. Le projet `mail` annoncé par README.md §7 n'est pas
// déclaré : ni Stalwart ni l'ingestion n'existent avant CRM-050 et CRM-054, et un projet vide
// donnerait l'illusion d'un harnais complet (docs/INCONSISTENCY_REPORT.md, INC-023).
//
// Le serveur sous test sert le **build de production**, pas le serveur de développement : ce
// qui est éprouvé doit être ce qui sera déployé. Le build est refait à chaque exécution, avec
// les mêmes variables que celles injectées ici — une preuve obtenue sur un `dist` périmé ne
// prouverait rien.

import { defineConfig, devices } from '@playwright/test'
import { join } from 'node:path'
import { RACINE, cleAnonyme, urlApi } from './env'

const PORT = Number(process.env['WEBAPP_PREVIEW_PORT'] ?? 4173)
const URL_BASE = `http://127.0.0.1:${PORT}`

const URL_API = urlApi()
const CLE_ANONYME = cleAnonyme()

/**
 * Projets demandés par l'appelant, déclarés et non déduits.
 *
 * Mesuré (docs/SPEC-test-harness.md §4.2, docs/JOURNAL.md décision 49) : Playwright 1.62.1
 * démarre le `webServer` pour **toute** exécution, quel que soit le filtre `--project` ; et la
 * configuration est réévaluée dans chaque worker, où `process.argv` ne contient pas ce filtre.
 * Le besoin ne peut donc pas être déduit — il est déclaré par le script npm qui lance
 * l'exécution.
 *
 * Variable absente : tous les projets sont supposés demandés, donc le serveur est déclaré.
 * C'est le défaut sûr — une invocation directe de `playwright test` continue de fonctionner.
 */
const PROJETS_DEMANDES = (process.env['E2E_PROJETS'] ?? 'api,ui')
	.split(',')
	.map((nom) => nom.trim())
	.filter((nom) => nom.length > 0)

/** Seul `ui` a besoin de l'application construite et servie. */
const SERVEUR_REQUIS = PROJETS_DEMANDES.includes('ui')

const serveur = {
	command: 'npm run build && npm run preview',
	url: URL_BASE,
	cwd: RACINE,
	reuseExistingServer: false,
	timeout: 120_000,
	env: {
		VITE_SUPABASE_URL: URL_API,
		VITE_SUPABASE_ANON_KEY: CLE_ANONYME,
		WEBAPP_PREVIEW_PORT: String(PORT),
	},
}

export default defineConfig({
	outputDir: join(import.meta.dirname, 'test-results'),
	fullyParallel: false,
	forbidOnly: true,
	retries: 0,
	workers: 1,
	// `open: 'never'` : une commande de test ne doit pas tenter d'ouvrir un navigateur, encore
	// moins sur une machine sans affichage. Le rapport se consulte par `npm run e2e:report`.
	reporter: [
		['list'],
		['html', { outputFolder: join(import.meta.dirname, 'report'), open: 'never' }],
	],
	use: {
		// Les traces et vidéos ne sont conservées qu'en cas d'échec : ce sont des pièces de
		// diagnostic, pas des artefacts de livraison.
		trace: 'retain-on-failure',
		video: 'retain-on-failure',
	},
	projects: [
		{
			name: 'api',
			testDir: join(import.meta.dirname, 'api'),
			// Aucun navigateur : ce projet n'emploie que le contexte de requête de Playwright.
			use: { baseURL: URL_API },
		},
		{
			name: 'ui',
			testDir: join(import.meta.dirname, 'ui'),
			use: { baseURL: URL_BASE, ...devices['Desktop Chrome'] },
		},
	],
	...(SERVEUR_REQUIS ? { webServer: serveur } : {}),
})

export const CONFIGURATION_PREUVES = { urlApi: URL_API, PORT, SERVEUR_REQUIS }
