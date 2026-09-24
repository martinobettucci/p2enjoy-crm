// @spec CRM-007 (docs/BACKLOG.md) — configuration des tests unitaires
// @spec CRM-016 (docs/BACKLOG.md), docs/SPEC-edge-functions.md §7.1 — modules Deno purs
// @spec docs/SPEC-webapp.md §13 (commandes), §14 (preuves) ; README.md §7 (tests)
//
// Les tests unitaires vivent à côté du code qu'ils éprouvent, sous le nom `*.test.tsx` ou
// `*.test.ts`. L'environnement est `jsdom` : les composants sont réellement montés et
// interrogés par leur rôle accessible, pas par leur balisage ; les modules edge purs n'emploient
// aucune API DOM et restent donc exécutables dans le même projet sans simuler le runtime.
//
// Le harnais complet — pgTAP, pytest, projets Playwright `api` et `mail` — reste dû par
// `CRM-008` : cette configuration ne couvre que Vitest.
//
// @spec docs/BACKLOG.md « Correctifs arbitrés », INC-189 c ; docs/JOURNAL.md décision 594 ;
//       docs/SPEC-test-harness.md §6.1 — le journal d'une exécution rouge est conservé
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
		include: [
			'src/**/*.test.ts',
			'src/**/*.test.tsx',
			'../stalwart/**/*.test.ts',
			'../supabase/functions/**/*.test.ts',
			// Le rapporteur ci-dessous vit à côté de cette configuration, hors de `src/` : c'est un
			// outil Node, que la compilation de l'application refuserait (`node:fs`).
			'vitest.rapporteur-echecs.test.ts',
		],
		// LE JOURNAL D'UNE EXÉCUTION ROUGE EST CONSERVÉ (INC-189, décision 594). Trente harnais
		// lancent cette suite ; les uns jettent sa sortie, les autres l'effacent en sortant. Le
		// rapporteur dépose les tests en échec dans `e2e/output/journaux-unitaires/`, quel que soit
		// l'appelant. `default` reste le rapporteur de la console, inchangé.
		reporters: ['default', './vitest.rapporteur-echecs.ts'],
		// LA CONFIGURATION DE L'APPLICATION NE FUIT PAS DANS LES TESTS — INC-189, corrigé le 2026-09-24,
		// et c'est le journal ci-dessus qui en a nommé la cause. `scripts/verify-webapp.sh` exporte
		// `VITE_SUPABASE_URL` et `VITE_SUPABASE_ANON_KEY` pour son build, et les tests lancés ensuite
		// les héritaient : les modules qui lisent `import.meta.env` au chargement construisaient alors
		// un vrai client, et `routes.test.tsx` — qui prouve les routes SANS configuration — rendait
		// six rouges, attribués à tort à la charge. Les quatre variables sont vidées ici : un test qui
		// veut une configuration la passe explicitement, comme `lireConfigurationSso(env)`.
		env: {
			VITE_SUPABASE_URL: '',
			VITE_SUPABASE_ANON_KEY: '',
			VITE_SSO_ISSUER: '',
			VITE_SSO_CLIENT_ID: '',
		},
		restoreMocks: true,
		// LE DÉLAI PAR DÉFAUT DE VITEST — 5 s — EST TROP COURT POUR CE HARNAIS, ET C'EST MESURÉ.
		// `npm run test:unit` monte 28 fichiers de composants React sous jsdom, en parallèle, et
		// il est lui-même appelé par les harnais d'unité pendant qu'une pile Docker de dix-huit
		// services tourne. Dans ces conditions, `Board.test.tsx` a dépassé 5 s sur un rendu qui en
		// coûte 0,1 s à vide : le verdict d'une Definition of Done dépendait donc de la charge de
		// l'hôte.
		//
		// Ce délai n'assouplit AUCUNE assertion et ne masque aucune erreur (`CLAUDE.md` §18) : un
		// test réellement bloqué échoue toujours, simplement plus tard. La valeur est un plafond
		// de patience, pas une temporisation ajoutée à un test.
		testTimeout: 20_000,
		hookTimeout: 20_000,
	},
})
