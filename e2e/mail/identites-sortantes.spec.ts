// @verifies CRM-053 (docs/BACKLOG.md) — test de connexion SMTP RÉEL
// @verifies docs/SPEC-mail-subsystem.md §14.4 (le test n'envoie aucun message), §14.5 (le délai
//           de pénalité mesuré), §13.7 (le code, jamais la phrase du serveur)
// @verifies docs/JOURNAL.md décision 318 ; CLAUDE.md §8 (aucune trace fabriquée)
//
// Rien n'est substitué : le service ouvre de vraies sessions SMTP vers le Stalwart de `CRM-050`,
// et chaque assertion RELIT la base. Le seed est rendu intact par les `finally`.

import { execFileSync } from 'node:child_process'
import { expect, test } from '@playwright/test'
import { lireEnv, urlApi } from '../env'
import { CLE_ANONYME, MOT_DE_PASSE_SEED, enTetesService } from '../api/jetons'

const CONTENEUR = 'p2enjoy-mail-sync'
const IMAGE_APPELANTE = 'python:3.13.13-slim-bookworm'
const JETON = lireEnv('MAIL_SYNC_INTERNAL_TOKEN')
const URL_API = urlApi()
const WORKSPACE = '5eed0000-0000-4000-8000-000000000001'
const DRISS = '5eed0000-0000-4000-8000-000000000012'

function docker(...arguments_: string[]): string {
	return execFileSync('docker', arguments_, { encoding: 'utf8', timeout: 180_000 }).trim()
}

// INC-151 — CALCUL RENDU PARESSEUX le 2026-08-18. Cette valeur était une constante de premier
// niveau, donc un appel `docker` à l'IMPORT du module. Docker absent, l'import levait et Playwright
// abandonnait le PROJET ENTIER : `--list` rendait « 0 test dans 0 fichier » pour les onze fichiers
// de `e2e/mail/`, alors que neuf seulement portaient le défaut. On ne pouvait donc ni compter ni
// inventorier ces scénarios sans l'infrastructure — au moment précis où l'on en a besoin.
// La valeur et la commande sont INCHANGÉES ; seul le moment du calcul l'est, et il est mémoïsé.
let reseauMemo: string | undefined
function reseau(): string {
	reseauMemo ??= docker(
		'inspect',
		CONTENEUR,
		'--format',
		'{{range $k,$v := .NetworkSettings.Networks}}{{$k}}{{end}}',
	)
	return reseauMemo
}

function testerIdentite(id: string): { code: number; corps: string } {
	const brut = docker(
		'run',
		'--rm',
		'--network',
		reseau(),
		'-e',
		`CHEMIN=/internal/v1/outbound-identities/${id}/test`,
		'-e',
		`AUTORISATION=Bearer ${JETON}`,
		IMAGE_APPELANTE,
		'python',
		'-c',
		`
import os, urllib.error, urllib.request

requete = urllib.request.Request(
    "http://mail-sync:8080" + os.environ["CHEMIN"], data=b"", method="POST"
)
requete.add_header("Authorization", os.environ["AUTORISATION"])
try:
    with urllib.request.urlopen(requete, timeout=120) as reponse:
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

type IdentiteEnBase = {
	readonly id: string
	readonly status: string
	readonly last_error: string | null
	readonly last_checked_at: string | null
	readonly smtp_security: string
	readonly smtp_username: string
	readonly from_address: string
	readonly label: string
	readonly owner_id: string | null
}

async function lireIdentite(
	request: import('@playwright/test').APIRequestContext,
	filtre: string,
): Promise<IdentiteEnBase> {
	const reponse = await request.get(
		`${URL_API}/rest/v1/mail_outbound_identities?${filtre}&select=id,status,last_error,last_checked_at,smtp_security,smtp_username,from_address,label,owner_id`,
		{ headers: enTetesService() },
	)
	const lignes = (await reponse.json()) as IdentiteEnBase[]
	expect(lignes, `aucune identité pour « ${filtre} »`).toHaveLength(1)
	return lignes[0] as IdentiteEnBase
}

async function jetonAdministratrice(
	request: import('@playwright/test').APIRequestContext,
): Promise<string> {
	const reponse = await request.post(`${URL_API}/auth/v1/token?grant_type=password`, {
		headers: { apikey: CLE_ANONYME, 'Content-Type': 'application/json' },
		data: { email: 'admin@p2enjoy.test', password: MOT_DE_PASSE_SEED },
	})
	const corps = (await reponse.json()) as { access_token?: string }
	expect(corps.access_token).toBeTruthy()
	return corps.access_token as string
}

async function ecrire(
	request: import('@playwright/test').APIRequestContext,
	jeton: string,
	identite: IdentiteEnBase,
	changements: { securite?: string; port?: number; motDePasse?: string | null },
): Promise<void> {
	const reponse = await request.post(`${URL_API}/rest/v1/rpc/upsert_mail_outbound_identity`, {
		headers: {
			apikey: CLE_ANONYME,
			Authorization: `Bearer ${jeton}`,
			'Content-Type': 'application/json',
		},
		data: {
			p_workspace_id: WORKSPACE,
			p_label: identite.label,
			p_smtp_host: 'stalwart',
			p_smtp_port: changements.port ?? 587,
			p_smtp_security: changements.securite ?? identite.smtp_security,
			p_smtp_username: identite.smtp_username,
			p_from_address: identite.from_address,
			p_password: changements.motDePasse === undefined ? null : changements.motDePasse,
			p_owner_id: identite.owner_id,
		},
	})
	expect(reponse.status(), await reponse.text()).toBe(200)
}

test.describe('identités sortantes — la connexion SMTP est RÉELLEMENT ouverte', () => {
	test('l’identité de service se connecte, et la base porte `ok`', async ({ request }) => {
		const identite = await lireIdentite(request, 'owner_id=is.null')

		const reponse = testerIdentite(identite.id)
		expect(reponse.code, reponse.corps).toBe(200)
		const verdict = JSON.parse(reponse.corps) as { status: string; error: null; folders: number }
		expect(verdict.status).toBe('ok')
		expect(verdict.error).toBeNull()
		// `folders` n'a pas de sens en SMTP : le champ reste à zéro plutôt que d'être détourné.
		expect(verdict.folders).toBe(0)

		const apres = await lireIdentite(request, `id=eq.${identite.id}`)
		expect(apres.status).toBe('ok')
		expect(apres.last_checked_at).not.toBeNull()
	})

	// LA MESURE DE LA DÉCISION 318, EXERCÉE POUR DE BON : le serveur attend dix secondes avant de
	// répondre `535`. Avec le délai d'IMAP, ce scénario rendrait `timeout` — et il échouerait ici.
	test('un mot de passe faux rend `auth_failed`, malgré le délai de pénalité du serveur', async ({
		request,
	}) => {
		test.setTimeout(120_000)
		const jeton = await jetonAdministratrice(request)
		const identite = await lireIdentite(request, `owner_id=eq.${DRISS}`)

		try {
			await ecrire(request, jeton, identite, { motDePasse: 'ce-mot-de-passe-est-faux' })

			const reponse = testerIdentite(identite.id)
			expect(reponse.code, reponse.corps).toBe(200)
			const verdict = JSON.parse(reponse.corps) as { status: string; error: string }
			expect(verdict.error).toBe('auth_failed')
			// La phrase du serveur ne franchit jamais la frontière.
			expect(reponse.corps).not.toContain('5.7.8')

			const apres = await lireIdentite(request, `id=eq.${identite.id}`)
			expect(apres.last_error).toBe('auth_failed')
		} finally {
			await ecrire(request, jeton, identite, { motDePasse: MOT_DE_PASSE_SEED })
		}
	})

	test('`starttls` échoue sur le certificat auto-signé, et le dit', async ({ request }) => {
		const jeton = await jetonAdministratrice(request)
		const identite = await lireIdentite(request, `owner_id=eq.${DRISS}`)

		try {
			await ecrire(request, jeton, identite, { securite: 'starttls' })
			const verdict = JSON.parse(testerIdentite(identite.id).corps) as { error: string }
			expect(verdict.error).toBe('tls_failed')
		} finally {
			await ecrire(request, jeton, identite, { securite: 'none' })
		}
	})

	// §14.5, troisième conséquence : SMTPS implicite n'est pas prouvable, faute de listener 465.
	// L'absence est FIGÉE ici, et cette assertion devra tomber le jour où un listener existera.
	test('SMTPS implicite ne trouve personne : aucun listener 465 n’est déclaré', async ({
		request,
	}) => {
		const jeton = await jetonAdministratrice(request)
		const identite = await lireIdentite(request, `owner_id=eq.${DRISS}`)

		try {
			await ecrire(request, jeton, identite, { securite: 'ssl', port: 465 })
			const verdict = JSON.parse(testerIdentite(identite.id).corps) as { error: string }
			expect(verdict.error).toBe('connection_refused')
		} finally {
			await ecrire(request, jeton, identite, { securite: 'none', port: 587 })
		}
	})

	test('une identité inconnue rend 404, et la route exige le jeton interne', () => {
		expect(testerIdentite('5eed0000-0000-4000-8000-0000000000ff').code).toBe(404)

		const sansJeton = docker(
			'run',
			'--rm',
			'--network',
			reseau(),
			IMAGE_APPELANTE,
			'python',
			'-c',
			`
import urllib.error, urllib.request

requete = urllib.request.Request(
    "http://mail-sync:8080/internal/v1/outbound-identities/5eed0000-0000-4000-8000-0000000000ff/test",
    data=b"", method="POST",
)
try:
    with urllib.request.urlopen(requete, timeout=10) as reponse:
        print(reponse.status)
except urllib.error.HTTPError as erreur:
    print(erreur.code)
`,
		)
		expect(Number(sansJeton.trim())).toBe(401)
	})
})
