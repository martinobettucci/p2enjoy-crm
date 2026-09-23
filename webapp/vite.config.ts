// @spec CRM-007 (docs/BACKLOG.md) — chaîne de build de la webapp
// @spec docs/SPEC-webapp.md §3.2 (projet npm unique, racine Vite), §12 (conteneurisation)
// @spec docs/DAT.md §3.1 (composant webapp) ; README.md §8 (build)
// @spec CRM-092 (docs/BACKLOG.md), docs/SPEC-session-sso.md §8.6 — relais de l'échangeur de session
//
// La racine du projet Vite est **déclarée explicitement** comme le répertoire de ce fichier,
// `webapp/`. Mesuré : `--config webapp/vite.config.ts` ne déplace pas la racine, qui reste le
// répertoire courant — sans `root`, le build échoue en `UNRESOLVED_ENTRY` faute de trouver
// `index.html`. Le dépôt ne porte qu'un seul `package.json`, à la racine
// (docs/JOURNAL.md décision 42 ; docs/SPEC-webapp.md §3.2).
//
// Les ports sont paramétrables pour que le service conteneurisé et les preuves puissent en
// changer sans toucher au code. Les valeurs par défaut sont celles que `.env.example`
// documente : 5173 pour Vite, 4173 pour le service de prévisualisation des preuves.
import { defineConfig, type ProxyOptions } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const port = (name: string, defaut: number): number => {
	const brut = process.env[name]
	if (brut === undefined || brut === '') return defaut
	const valeur = Number(brut)
	if (!Number.isInteger(valeur) || valeur <= 0 || valeur > 65535) {
		throw new Error(`${name} doit être un port valide, reçu « ${brut} »`)
	}
	return valeur
}

/**
 * Relais de l'échangeur de session (`CRM-092`, docs/SPEC-session-sso.md §8.6, décision 586).
 *
 * La webapp appelle l'échangeur par un chemin RELATIF : le cookie `httpOnly` de la poignée est alors
 * posé sur l'origine de la webapp, `SameSite=Strict`, comme en production où Caddy relaie
 * `/functions/v1/*` sur la même origine (`caddy/routes.caddy`). En développement et pour le
 * `vite preview` du harnais, ce relais tient ce rôle. Sa cible vient de l'environnement du
 * processus (`API_RELAIS_SESSION`), jamais du bundle ; absente, aucun relais n'est déclaré.
 * `changeOrigin` ne réécrit que `Host` : l'en-tête `Origin` du navigateur atteint l'échangeur intact,
 * qui en déduit l'attribut `Secure` du cookie.
 */
const relaisSession = (): Record<string, ProxyOptions> => {
	const cible = (process.env['API_RELAIS_SESSION'] ?? '').trim()
	return cible === '' ? {} : { '/functions/v1/session': { target: cible, changeOrigin: true } }
}

export default defineConfig({
	root: import.meta.dirname,
	plugins: [react(), tailwindcss()],
	build: {
		outDir: 'dist',
		emptyOutDir: true,
		// Le rapport de taille est bruyant dans les journaux de preuve et n'apporte rien tant
		// que l'application ne charge aucune donnée réelle.
		reportCompressedSize: false,
	},
	server: {
		host: process.env['WEBAPP_DEV_HOST'] ?? '127.0.0.1',
		port: port('WEBAPP_DEV_PORT', 5173),
		strictPort: true,
		proxy: relaisSession(),
	},
	preview: {
		host: process.env['WEBAPP_PREVIEW_HOST'] ?? '127.0.0.1',
		port: port('WEBAPP_PREVIEW_PORT', 4173),
		strictPort: true,
		proxy: relaisSession(),
	},
})
