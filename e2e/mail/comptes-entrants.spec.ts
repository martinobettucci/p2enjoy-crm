// @verifies CRM-052 (docs/BACKLOG.md) — test de connexion RÉEL d'un compte entrant
// @verifies docs/SPEC-mail-subsystem.md §13.5 (le test de connexion), §13.6 (ce que le
//           développement peut prouver, et ce qu'il ne peut pas), §13.7 (last_error est un code)
// @verifies docs/JOURNAL.md décision 316 ; CLAUDE.md §8 (aucune trace fabriquée)
//
// CE FICHIER OUVRE DE VRAIES SESSIONS IMAP, ET RIEN N'Y EST SUBSTITUÉ.
//
// La chaîne complète est exercée : le service lit le compte par PostgREST avec la clé de service,
// déchiffre le mot de passe par la fonction réservée, ouvre une session vers le Stalwart de
// `CRM-050`, liste ses dossiers, et écrit son verdict en base. Chaque assertion relit la BASE, pas
// seulement la réponse HTTP : un service qui rendrait `ok` sans rien écrire serait vert autrement.
//
// L'APPEL PASSE PAR UN CONTENEUR JETABLE SUR LE RÉSEAU COMPOSE, seul chemin existant — `mail-sync`
// ne publie aucun port, et c'est précisément ce que `CRM-051` a établi.
//
// LE SEED EST RENDU INTACT : les scénarios qui changent un mot de passe ou un mode de sécurité le
// remettent dans leur `finally`, par le même chemin d'écriture que le seed emploie.

import { execFileSync } from 'node:child_process'
import { expect, test } from '@playwright/test'
import { lireEnv, urlApi } from '../env'
import { CLE_ANONYME, MOT_DE_PASSE_SEED, enTetesService } from '../api/jetons'

const CONTENEUR = 'p2enjoy-mail-sync'
const IMAGE_APPELANTE = 'python:3.13.13-slim-bookworm'
const JETON = lireEnv('MAIL_SYNC_INTERNAL_TOKEN')
const URL_API = urlApi()
const WORKSPACE = '5eed0000-0000-4000-8000-000000000001'

function docker(...arguments_: string[]): string {
	return execFileSync('docker', arguments_, { encoding: 'utf8', timeout: 180_000 }).trim()
}

/** Réseau Compose auquel le service est attaché — jamais supposé, toujours relu. */
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

type Reponse = { readonly code: number; readonly corps: string }

function testerCompte(idCompte: string): Reponse {
	const brut = docker(
		'run',
		'--rm',
		'--network',
		reseau(),
		'-e',
		`CHEMIN=/internal/v1/inbound-accounts/${idCompte}/test`,
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
    with urllib.request.urlopen(requete, timeout=60) as reponse:
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

type CompteEnBase = {
	readonly id: string
	readonly status: string
	readonly last_error: string | null
	readonly last_checked_at: string | null
	readonly imap_security: string
	readonly imap_username: string
	readonly label: string
	readonly owner_id: string | null
}

async function lireCompte(
	request: import('@playwright/test').APIRequestContext,
	filtre: string,
): Promise<CompteEnBase> {
	const reponse = await request.get(
		`${URL_API}/rest/v1/mail_inbound_accounts?${filtre}&select=id,status,last_error,last_checked_at,imap_security,imap_username,label,owner_id`,
		{ headers: enTetesService() },
	)
	const lignes = (await reponse.json()) as CompteEnBase[]
	expect(lignes, `aucun compte pour « ${filtre} » : le seed est-il appliqué ?`).toHaveLength(1)
	return lignes[0] as CompteEnBase
}

/** Réécrit un compte par le VRAI chemin d'écriture — celui du seed, jamais un `PATCH` direct. */
async function ecrire(
	request: import('@playwright/test').APIRequestContext,
	jetonAdmin: string,
	compte: CompteEnBase,
	changements: { securite?: string; motDePasse?: string | null },
): Promise<void> {
	const reponse = await request.post(`${URL_API}/rest/v1/rpc/upsert_mail_inbound_account`, {
		headers: {
			apikey: CLE_ANONYME,
			Authorization: `Bearer ${jetonAdmin}`,
			'Content-Type': 'application/json',
		},
		data: {
			p_workspace_id: WORKSPACE,
			p_label: compte.label,
			p_imap_host: 'stalwart',
			p_imap_port: 143,
			p_imap_security: changements.securite ?? compte.imap_security,
			p_imap_username: compte.imap_username,
			p_password: changements.motDePasse === undefined ? null : changements.motDePasse,
			p_owner_id: compte.owner_id,
		},
	})
	expect(reponse.status(), await reponse.text()).toBe(200)
}

async function jetonAdministratrice(
	request: import('@playwright/test').APIRequestContext,
): Promise<string> {
	const reponse = await request.post(`${URL_API}/auth/v1/token?grant_type=password`, {
		headers: { apikey: CLE_ANONYME, 'Content-Type': 'application/json' },
		data: { email: 'admin@p2enjoy.test', password: MOT_DE_PASSE_SEED },
	})
	const corps = (await reponse.json()) as { access_token?: string }
	expect(corps.access_token, 'connexion de l’administratrice seedée impossible').toBeTruthy()
	return corps.access_token as string
}

test.describe('comptes entrants — la connexion est RÉELLEMENT ouverte', () => {
	test('la boîte système se connecte, liste ses dossiers, et la base porte `ok`', async ({
		request,
	}) => {
		const compte = await lireCompte(request, 'owner_id=is.null')

		const reponse = testerCompte(compte.id)
		expect(reponse.code, reponse.corps).toBe(200)
		const verdict = JSON.parse(reponse.corps) as { status: string; error: null; folders: number }
		expect(verdict.status).toBe('ok')
		expect(verdict.error).toBeNull()
		// Une session qui s'ouvre sans rien pouvoir lister n'est pas une session utilisable :
		// Stalwart déclare INBOX, Drafts, Junk Mail, Deleted Items et Sent Items.
		expect(verdict.folders).toBeGreaterThanOrEqual(4)

		// LA BASE EST RELUE : un service qui rendrait `ok` sans écrire serait vert autrement.
		const apres = await lireCompte(request, `id=eq.${compte.id}`)
		expect(apres.status).toBe('ok')
		expect(apres.last_error).toBeNull()
		expect(apres.last_checked_at).not.toBeNull()
	})

	test('un mot de passe faux rend `auth_failed`, et jamais la phrase du serveur', async ({
		request,
	}) => {
		const jeton = await jetonAdministratrice(request)
		const compte = await lireCompte(request, `owner_id=eq.5eed0000-0000-4000-8000-000000000012`)

		try {
			await ecrire(request, jeton, compte, { motDePasse: 'ce-mot-de-passe-est-faux' })

			const reponse = testerCompte(compte.id)
			expect(reponse.code, reponse.corps).toBe(200)
			const verdict = JSON.parse(reponse.corps) as { status: string; error: string }
			expect(verdict.status).toBe('error')
			expect(verdict.error).toBe('auth_failed')
			// Le §13.7 en une assertion : la phrase du serveur — « [AUTHENTICATIONFAILED]
			// Authentication failed » — ne franchit jamais la frontière.
			expect(reponse.corps).not.toContain('AUTHENTICATIONFAILED')

			const apres = await lireCompte(request, `id=eq.${compte.id}`)
			expect(apres.status).toBe('error')
			expect(apres.last_error).toBe('auth_failed')
		} finally {
			await ecrire(request, jeton, compte, { motDePasse: MOT_DE_PASSE_SEED })
		}
	})

	// §13.6 : le certificat du Stalwart de développement est AUTO-SIGNÉ, et le produit refuse à
	// raison de lui faire confiance. Ce scénario prouve que le refus est nommé — non silencieux —
	// et qu'aucun mode dégradé de vérification n'existe.
	test('`starttls` échoue sur un certificat auto-signé, et le dit : `tls_failed`', async ({
		request,
	}) => {
		const jeton = await jetonAdministratrice(request)
		const compte = await lireCompte(request, `owner_id=eq.5eed0000-0000-4000-8000-000000000011`)

		try {
			await ecrire(request, jeton, compte, { securite: 'starttls' })

			const reponse = testerCompte(compte.id)
			expect(reponse.code, reponse.corps).toBe(200)
			const verdict = JSON.parse(reponse.corps) as { status: string; error: string }
			expect(verdict.status).toBe('error')
			expect(verdict.error).toBe('tls_failed')

			const apres = await lireCompte(request, `id=eq.${compte.id}`)
			expect(apres.last_error).toBe('tls_failed')
		} finally {
			await ecrire(request, jeton, compte, { securite: 'none' })
		}
	})

	// §13.6, troisième conséquence : `ssl` implicite n'est PAS prouvable localement, faute de
	// listener 993. L'absence est FIGÉE par une assertion — jamais par un commentaire — et cette
	// assertion devra tomber le jour où un listener existera (mécanisme de la décision 51).
	test('`ssl` implicite ne trouve personne : aucun listener 993 n’est déclaré', async ({
		request,
	}) => {
		const jeton = await jetonAdministratrice(request)
		const compte = await lireCompte(request, `owner_id=eq.5eed0000-0000-4000-8000-000000000011`)

		try {
			const ecriture = await request.post(`${URL_API}/rest/v1/rpc/upsert_mail_inbound_account`, {
				headers: {
					apikey: CLE_ANONYME,
					Authorization: `Bearer ${jeton}`,
					'Content-Type': 'application/json',
				},
				data: {
					p_workspace_id: WORKSPACE,
					p_label: compte.label,
					p_imap_host: 'stalwart',
					p_imap_port: 993,
					p_imap_security: 'ssl',
					p_imap_username: compte.imap_username,
					p_password: null,
					p_owner_id: compte.owner_id,
				},
			})
			expect(ecriture.status()).toBe(200)

			const reponse = testerCompte(compte.id)
			const verdict = JSON.parse(reponse.corps) as { error: string }
			expect(verdict.error).toBe('connection_refused')
		} finally {
			await ecrire(request, jeton, compte, { securite: 'none' })
			// Le port est rendu lui aussi : `ecrire` ne le change pas, il est écrit en dur à 143.
			const rendu = await lireCompte(request, `id=eq.${compte.id}`)
			expect(rendu.imap_security).toBe('none')
		}
	})

	test('un compte inconnu rend 404, sans révéler s’il a jamais existé', () => {
		const reponse = testerCompte('5eed0000-0000-4000-8000-0000000000ff')
		expect(reponse.code).toBe(404)
	})

	test('la route de test exige le jeton interne, comme tout le reste de l’API', () => {
		const brut = docker(
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
    "http://mail-sync:8080/internal/v1/inbound-accounts/5eed0000-0000-4000-8000-0000000000ff/test",
    data=b"", method="POST",
)
try:
    with urllib.request.urlopen(requete, timeout=10) as reponse:
        print(reponse.status)
except urllib.error.HTTPError as erreur:
    print(erreur.code)
`,
		)
		expect(Number(brut.trim())).toBe(401)
	})
})
