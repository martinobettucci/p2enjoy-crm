// @verifies CRM-051 (docs/BACKLOG.md) — socle du service `mail-sync`
// @verifies docs/SPEC-mail-subsystem.md §12.1 (aucun port publié), §12.3 (santé et API interne),
//           §12.4 (état durable et reprise), §12.5 (journaux), §12.6 (preuves exigées)
// @verifies docs/JOURNAL.md décision 310 (état de reprise prouvable), décision 313 (aucun
//           lifespan applicatif) ; CLAUDE.md §10 (règle prouvée hors interface)
//
// Ce projet `mail` n'exerce pas un écran : `mail-sync` n'en a pas, et n'en aura pas — c'est un
// service interne. Le parcours réellement offert à un développeur est celui de `./runDev.sh` :
// le conteneur démarre, son API n'est joignable QUE depuis le réseau Compose, et ses journaux
// se suivent par `--withLog mail-sync`.
//
// Les appels passent donc par un conteneur jetable placé sur ce réseau. C'est le seul chemin
// d'accès existant, et c'est précisément ce que la preuve doit établir : un appel depuis l'hôte
// n'aurait aucune chance d'aboutir, puisque aucun port n'est publié.

import { execFileSync, spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { RACINE, lireEnv } from '../env'

const CONTENEUR = 'p2enjoy-mail-sync'
const IMAGE_APPELANTE = 'python:3.13.13-slim-bookworm'
const JETON = lireEnv('MAIL_SYNC_INTERNAL_TOKEN')

function docker(...arguments_: string[]): string {
	return execFileSync('docker', arguments_, { encoding: 'utf8', timeout: 120_000 }).trim()
}

/**
 * Journaux du conteneur, **les deux flux réunis**.
 *
 * `logging.StreamHandler` écrit sur la sortie d'erreur : lire la seule sortie standard rendrait
 * une chaîne vide, et un contrôle qui ne lit rien ne prouve rien.
 */
function journauxConteneur(): string {
	const execution = spawnSync('docker', ['logs', CONTENEUR], { encoding: 'utf8', timeout: 120_000 })
	return `${execution.stdout}${execution.stderr}`.trim()
}

/** Réseau Compose auquel le service est attaché — jamais supposé, toujours relu. */
const RESEAU = docker(
	'inspect',
	CONTENEUR,
	'--format',
	'{{range $k,$v := .NetworkSettings.Networks}}{{$k}}{{end}}',
)

interface Reponse {
	readonly code: number
	readonly corps: string
}

/** Appelle l'API interne depuis le réseau Compose, comme le ferait un futur consommateur. */
function appelInterne(methode: string, chemin: string, autorisation: string, corps = ''): Reponse {
	const brut = docker(
		'run',
		'--rm',
		'--network',
		RESEAU,
		'-e',
		`METHODE=${methode}`,
		'-e',
		`CHEMIN=${chemin}`,
		'-e',
		`AUTORISATION=${autorisation}`,
		'-e',
		`CORPS=${corps}`,
		IMAGE_APPELANTE,
		'python',
		'-c',
		`
import os, urllib.error, urllib.request

corps = os.environ["CORPS"].encode() or None
requete = urllib.request.Request(
    "http://mail-sync:8080" + os.environ["CHEMIN"], data=corps, method=os.environ["METHODE"]
)
if os.environ["AUTORISATION"]:
    requete.add_header("Authorization", os.environ["AUTORISATION"])
if corps:
    requete.add_header("Content-Type", "application/json")
try:
    with urllib.request.urlopen(requete, timeout=10) as reponse:
        print(reponse.status)
        print(reponse.read().decode(), end="")
except urllib.error.HTTPError as erreur:
    print(erreur.code)
    print(erreur.read().decode(), end="")
`,
	)
	const saut = brut.indexOf('\n')
	return {
		code: Number(saut === -1 ? brut : brut.slice(0, saut)),
		corps: saut === -1 ? '' : brut.slice(saut + 1),
	}
}

/** Attente bloquante d'une seconde : le scénario est synchrone, et `docker` l'est aussi. */
function patienter(): void {
	execFileSync('sleep', ['1'])
}

function attendreSain(secondes = 60): void {
	for (let reste = secondes; reste > 0; reste -= 1) {
		if (docker('inspect', CONTENEUR, '--format', '{{.State.Health.Status}}') === 'healthy') return
		patienter()
	}
	throw new Error(`${CONTENEUR} n'est pas redevenu sain en ${secondes} s`)
}

/** Commande Compose du dépôt : les mêmes fichiers et le même `.env` que `./runDev.sh`. */
function compose(...arguments_: string[]): string {
	return docker(
		'compose',
		'--env-file',
		join(RACINE, '.env'),
		'-f',
		join(RACINE, 'docker-compose.yml'),
		'-f',
		join(RACINE, 'docker-compose.dev.yml'),
		...arguments_,
	)
}

test.describe('S1 — le service est joignable par le réseau interne, et par lui seul', () => {
	test('aucune liaison de port de l’hôte n’est attachée au conteneur', () => {
		// Sonder un port de l'hôte ne prouverait rien : ceux qui écoutent appartiennent à
		// d'autres services. La question est posée au conteneur lui-même.
		const liaisons = docker('inspect', CONTENEUR, '--format', '{{json .NetworkSettings.Ports}}')

		expect(liaisons).not.toContain('HostPort')
		expect(docker('port', CONTENEUR)).toBe('')
	})

	test('la santé répond sans jeton, le statut l’exige', () => {
		expect(appelInterne('GET', '/health/live', '')).toMatchObject({ code: 200 })
		expect(appelInterne('GET', '/health/ready', '')).toMatchObject({ code: 200 })

		const statut = appelInterne('GET', '/internal/v1/status', `Bearer ${JETON}`)
		expect(statut.code).toBe(200)

		const corps = JSON.parse(statut.corps) as Record<string, unknown>
		expect(corps['service']).toBe('mail-sync')
		expect(corps['profile']).toBe('dev')
		expect(corps['schema_version']).toBe(1)
		// L'unité ne livre aucune synchronisation : les workers doivent le dire, pas le simuler.
		expect(corps['workers']).toEqual({
			imap: { state: 'waiting_for_configuration' },
			smtp: { state: 'waiting_for_configuration' },
		})
	})

	test('jeton absent, mal formé ou faux donnent le même refus', () => {
		const autorisations = [
			'',
			'Basic Zm9vOmJhcg==',
			'Bearer',
			'Bearer faux-jeton-0123456789abcdef0123456789',
			`Bearer ${JETON} suffixe`,
		]

		const refus = autorisations.map((autorisation) =>
			appelInterne('GET', '/internal/v1/status', autorisation),
		)

		for (const reponse of refus) {
			expect(reponse.code).toBe(401)
			expect(reponse.corps).toBe(refus[0]?.corps)
		}
		expect(JSON.parse(refus[0]?.corps ?? '{}')).toEqual({ detail: 'Authentification requise' })
	})
})

test.describe('S2 — arrêt et redémarrage sans perte d’état', () => {
	test('le checkpoint survit, boot_count monte d’un et boot_id change', () => {
		const temoin = randomUUID()

		const ecriture = appelInterne(
			'PUT',
			'/internal/v1/dev/checkpoint',
			`Bearer ${JETON}`,
			JSON.stringify({ checkpoint: temoin }),
		)
		expect(ecriture.code).toBe(200)

		const avant = JSON.parse(
			appelInterne('GET', '/internal/v1/status', `Bearer ${JETON}`).corps,
		) as Record<string, unknown>

		// Le vrai conteneur est arrêté puis redémarré : ni un processus de test, ni une copie.
		compose('stop', 'mail-sync')
		compose('start', 'mail-sync')
		attendreSain()

		const apres = JSON.parse(
			appelInterne('GET', '/internal/v1/status', `Bearer ${JETON}`).corps,
		) as Record<string, unknown>
		const relu = JSON.parse(
			appelInterne('GET', '/internal/v1/dev/checkpoint', `Bearer ${JETON}`).corps,
		) as Record<string, unknown>

		expect(relu['checkpoint']).toBe(temoin)
		expect(apres['boot_count']).toBe((avant['boot_count'] as number) + 1)
		expect(apres['boot_id']).not.toBe(avant['boot_id'])
	})
})

test.describe('S3 — la console opérationnelle reste silencieuse', () => {
	test('chaque ligne est un JSON borné, sans secret ni avertissement', () => {
		const journaux = journauxConteneur()
		const lignes = journaux.split('\n').filter((ligne) => ligne.trim().length > 0)

		expect(lignes.length).toBeGreaterThan(0)
		for (const ligne of lignes) {
			const objet = JSON.parse(ligne) as Record<string, unknown>
			expect(Object.keys(objet)).toEqual(
				expect.arrayContaining(['timestamp', 'level', 'service', 'event']),
			)
			expect(objet['service']).toBe('mail-sync')
			expect(['DEBUG', 'INFO']).toContain(objet['level'])
		}

		expect(journaux).not.toContain(JETON)
		expect(journaux.toLowerCase()).not.toContain('authorization')
		expect(lignes.map((ligne) => JSON.parse(ligne)['event'])).toContain('service_started')
	})
})
