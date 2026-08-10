// @verifies CRM-050 (docs/BACKLOG.md) — invariants de la configuration du serveur de messagerie
// @verifies docs/SPEC-mail-subsystem.md §11.3 (configuration), §11.9 (le test unitaire de l'unité)
// @verifies docs/JOURNAL.md décisions 235 et 245 (configuration locale déterministe)
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
const PROVISION = readFileSync(join(import.meta.dirname, 'provision.sh'), 'utf8')
const WEBADMIN_SOURCE = readFileSync(
	join(import.meta.dirname, 'webadmin-disabled', 'index.html'),
)
const WEBADMIN_ZIP = readFileSync(join(import.meta.dirname, 'webadmin-disabled.zip'))

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
	it("ne place aucune clé modifiable d'authentification dans le fichier local", () => {
		expect(CONFIG).not.toContain('[session.auth]')
		expect(CONFIG).not.toContain('[imap.auth]')
		expect(CONFIG).not.toMatch(/^session\.auth\.(mechanisms|require)\s*=/m)
		expect(CONFIG).not.toMatch(/^imap\.auth\.allow-plain-text\s*=/m)
	})

	it("fait écrire et relire les deux réglages par l'API avant de recharger", () => {
		expect(PROVISION).toContain('/api/settings')
		expect(PROVISION).toContain('session.auth.mechanisms')
		expect(PROVISION).toContain('imap.auth.allow-plain-text')
		expect(PROVISION).toContain('["auth.dkim.sign","false"]')
		expect(PROVISION).toContain('["auth.arc.seal","false"]')
		expect(PROVISION).toContain(
			'["webadmin.resource","file:///opt/stalwart/etc/webadmin-disabled.zip"]',
		)
		expect(PROVISION).toContain('"assert_empty":false')
		expect(PROVISION).not.toContain('"assertEmpty"')
		expect(PROVISION).toContain('/api/reload')
	})
})

describe('configuration de Stalwart — console web volontairement absente', () => {
	it('vise une ressource locale déclarée parmi les clés locales', () => {
		expect(CONFIG).toContain('config.local-keys.15 = "webadmin.resource"')
		expect(CONFIG).toContain(
			'resource = "file:///opt/stalwart/etc/webadmin-disabled.zip"',
		)
		expect(CONFIG).not.toContain('releases/latest')
		expect(PROVISION).toContain('/api/update/webadmin')
		expect(PROVISION).not.toContain('/api/reload/webadmin')
	})

	it('versionne un véritable ZIP qui contient exactement la page source', () => {
		expect(WEBADMIN_ZIP.subarray(0, 4).toString('hex')).toBe('504b0304')
		expect(WEBADMIN_ZIP.includes(WEBADMIN_SOURCE)).toBe(true)
	})

	it('livre une page française, sémantique et sans script', () => {
		const source = WEBADMIN_SOURCE.toString('utf8')
		expect(source).toContain('<html lang="fr">')
		expect(source).toContain('<main>')
		expect(source).toContain('<h1>Console Stalwart désactivée</h1>')
		expect(source).not.toContain('<script')
	})
})
