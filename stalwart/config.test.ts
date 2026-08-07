// @verifies CRM-050 (docs/BACKLOG.md) — invariants de la configuration du serveur de messagerie
// @verifies docs/SPEC-mail-subsystem.md §11.3 (configuration), §11.9 (le test unitaire de l'unité)
// @verifies docs/JOURNAL.md décision 235 (les trois pannes payées avant d'être écrites)
//
// CE TEST N'EST PAS UN TEST DE FAÇADE, et son objet est nommé : deux de ses invariants ont été
// payés par une panne réelle.
//
// Une liaison `[::]` arrête Stalwart **sans écrire une seule ligne** sur un conteneur sans IPv6 :
// `docker logs` rend le vide, le conteneur reste `Up`, et aucun port n'écoute. Aucun message ne
// dit pourquoi. C'est le seul contrôle du dépôt capable d'attraper cette régression **sans
// démarrer la pile** — le `healthcheck` de `docker-compose.dev.yml` l'attrape à l'exécution, une
// fois qu'il est trop tard pour un développeur qui lit son diff.
//
// Il vit à côté du fichier qu'il éprouve, et non dans `webapp/src/` : le périmètre de Vitest est
// étendu à `stalwart/` par `webapp/vitest.config.ts`, plutôt que de ranger une preuve
// d'infrastructure parmi celles de l'interface.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const CONFIG = readFileSync(join(import.meta.dirname, 'config.toml'), 'utf8')

/** Les lignes `bind = "…"` réellement déclarées, dans l'ordre du fichier. */
const liaisons = [...CONFIG.matchAll(/^bind\s*=\s*"([^"]+)"/gm)].map((trouve) => trouve[1]!)

/** Les noms de listeners réellement déclarés. */
const listeners = [...CONFIG.matchAll(/^\[server\.listener\.([a-z0-9-]+)\]/gm)].map(
	(trouve) => trouve[1]!,
)

describe('configuration de Stalwart — liaisons', () => {
	it('déclare au moins une liaison', () => {
		expect(liaisons.length).toBeGreaterThan(0)
	})

	it.each(liaisons)('la liaison « %s » ne vise pas la famille IPv6 `[::]`', (liaison) => {
		expect(liaison.startsWith('[::]')).toBe(false)
	})

	it.each(liaisons)('la liaison « %s » vise explicitement 0.0.0.0', (liaison) => {
		expect(liaison).toMatch(/^0\.0\.0\.0:\d+$/)
	})
})

describe('configuration de Stalwart — listeners', () => {
	it('déclare exactement les quatre listeners spécifiés, et pas un de plus', () => {
		// `docs/SPEC-mail-subsystem.md` §11.3 : un port ouvert sans usage est une surface. Les
		// variantes chiffrées et les protocoles inutilisés de la configuration générée par
		// `--init` sont retirés, et ce contrôle interdit leur retour silencieux.
		expect([...listeners].sort()).toEqual(['http', 'imap', 'smtp', 'submission'])
	})

	it.each([
		['smtp', 25],
		['submission', 587],
		['imap', 143],
		['http', 8080],
	])('le listener « %s » écoute le port %i dans le conteneur', (nom, port) => {
		const bloc = CONFIG.split(`[server.listener.${nom}]`)[1] ?? ''
		expect(bloc.split('[server.listener.')[0]).toContain(`bind = "0.0.0.0:${port}"`)
	})
})

describe('configuration de Stalwart — journalisation', () => {
	it('trace sur la sortie standard', () => {
		// Un traceur fichier échoue tant que son répertoire n'existe pas, et ses journaux
		// n'atteindraient pas `./runDev.sh --withLog stalwart`.
		expect(CONFIG).toContain('[tracer.stdout]')
		expect(CONFIG).toMatch(/\[tracer\.stdout\][\s\S]*?type = "stdout"/)
	})

	it("ne déclare aucun traceur vers un fichier", () => {
		expect(CONFIG).not.toContain('[tracer.log]')
	})
})

describe('configuration de Stalwart — secrets', () => {
	it("lit l'administrateur et son secret dans l'environnement", () => {
		expect(CONFIG).toContain('user = "%{env:STALWART_ADMIN_USER}%"')
		expect(CONFIG).toContain('secret = "%{env:STALWART_ADMIN_PASSWORD}%"')
	})

	it('ne porte aucun secret en clair', () => {
		// Toute valeur affectée à `secret` ou `password` doit être une macro d'environnement.
		const affectations = [...CONFIG.matchAll(/^\s*(secret|password)\s*=\s*"([^"]*)"/gim)]
		expect(affectations.length).toBeGreaterThan(0)
		for (const affectation of affectations) {
			expect(affectation[2]).toMatch(/^%\{env:[A-Z0-9_]+\}%$/)
		}
	})

	it('ne porte aucune empreinte de mot de passe pré-calculée', () => {
		// `stalwart --init` écrit un `$6$…` : un tel condensat versionné signerait un secret
		// commun à toutes les installations.
		expect(CONFIG).not.toMatch(/\$[0-9a-z]+\$[^\s"]{8,}/)
	})
})

describe('configuration de Stalwart — authentification', () => {
	it('exige une authentification pour la soumission SMTP', () => {
		// Sans elle, le serveur de développement serait un relais ouvert sur la boucle locale.
		expect(CONFIG).toMatch(/\[session\.auth\][\s\S]*?require = true/)
	})

	it('autorise explicitement `LOGIN` en clair, faute de TLS en développement', () => {
		expect(CONFIG).toMatch(/\[imap\.auth\][\s\S]*?allow-plain-text = true/)
	})
})
