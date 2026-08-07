// @spec CRM-007 (docs/BACKLOG.md) — configuration des tests unitaires
// @spec docs/SPEC-webapp.md §13 (commandes), §14 (preuves) ; README.md §7 (tests)
//
// Les tests unitaires vivent à côté du code qu'ils éprouvent, sous le nom `*.test.tsx` ou
// `*.test.ts`. L'environnement est `jsdom` : les composants sont réellement montés et
// interrogés par leur rôle accessible, pas par leur balisage.
//
// Le harnais complet — pgTAP, pytest, projets Playwright `api` et `mail` — reste dû par
// `CRM-008` : cette configuration ne couvre que Vitest.
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
	// Comme pour le build, la racine est déclarée : `--config` ne la déplace pas, elle reste
	// le répertoire courant, et les tests ne seraient pas trouvés (docs/SPEC-webapp.md §3.2).
	root: import.meta.dirname,
	plugins: [react()],
	test: {
		environment: 'jsdom',
		// `../stalwart/**` sort du répertoire de l'application, et c'est voulu : la preuve
		// unitaire de `CRM-050` vit à côté du fichier qu'elle éprouve — la configuration du
		// serveur de messagerie — plutôt que d'être rangée parmi celles de l'interface
		// (docs/SPEC-mail-subsystem.md §11.9).
		include: ['src/**/*.test.ts', 'src/**/*.test.tsx', '../stalwart/**/*.test.ts'],
		restoreMocks: true,
	},
})
