// @spec CRM-092 (docs/BACKLOG.md) — entrées-sorties réelles de l'échangeur de session
// @spec docs/SPEC-session-sso.md §5.2 (point de jeton, secret), §5.7 (échéance de 8 s, 3 s par appel,
//       environnement), §7.4 (fonctions de session appelées par PostgREST)
// @spec docs/SPEC-edge-functions.md §2 (runtime : 10 s de temps mur par worker)
// @spec CLAUDE.md §19 (timeout et gestion d'erreur de tout service externe), §20 (aucun secret journalisé)
//
// Module pur : `fetch`, l'horloge et l'environnement sont injectés, de sorte que la forme exacte des
// appels — adresse, en-têtes, corps, délai — se prouve sans réseau. Chaque appel prend AU PLUS 3 s
// dans ce qui reste de l'échéance du geste : un geste entier répond avant les 10 s d'un worker.

import { tirerPoignee } from './chiffrement.ts'
import type { ConfigurationSession, DependancesSession, ReponseFormulaire } from './handler.ts'

export const DELAI_APPEL_MS = 3_000

type Fetch = (url: string, init?: RequestInit) => Promise<Response>
type LireEnv = (nom: string) => string | undefined

/** Rend `null` si une variable manque : l'échangeur répond alors `service_indisponible`, sans rien tenter. */
export function lireConfiguration(lire: LireEnv): ConfigurationSession | null {
	const emetteur = lire('SSO_OIDC_ISSUER')?.trim().replace(/\/+$/, '')
	const clientId = lire('SSO_OIDC_CLIENT_ID')?.trim()
	const clientSecret = lire('SSO_OIDC_CLIENT_SECRET')
	const secretJwt = lire('JWT_SECRET')
	if (!emetteur || !clientId || !clientSecret || !secretJwt) return null
	return { emetteur, clientId, clientSecret, secretJwt }
}

/** Délai d'un appel : 3 s au plus, et jamais au-delà de l'échéance du geste. */
export function delaiAppel(echeance: number, maintenantMs: number): number {
	return Math.max(0, Math.min(DELAI_APPEL_MS, echeance - maintenantMs))
}

export function creerDependances(
	lire: LireEnv,
	requete: Fetch = fetch,
	maintenantMs: () => number = () => Date.now(),
): DependancesSession {
	const urlApi = lire('SUPABASE_URL')?.replace(/\/+$/, '')
	const cleService = lire('SUPABASE_SERVICE_ROLE_KEY')
	const signal = (echeance: number) => AbortSignal.timeout(delaiAppel(echeance, maintenantMs()))

	return {
		configuration: urlApi && cleService ? lireConfiguration(lire) : null,

		async lireJson(url, echeance) {
			const reponse = await requete(url, { headers: { accept: 'application/json' }, signal: signal(echeance) })
			if (!reponse.ok) throw new Error(`HTTP ${reponse.status}`)
			return await reponse.json()
		},

		async posterFormulaire(url, champs, echeance): Promise<ReponseFormulaire> {
			const reponse = await requete(url, {
				method: 'POST',
				headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
				body: new URLSearchParams(champs).toString(),
				signal: signal(echeance),
			})
			let corps: unknown = null
			try {
				corps = await reponse.json()
			} catch {
				corps = null
			}
			return { statut: reponse.status, corps }
		},

		async appelerBase(fonction, arguments_, echeance) {
			const reponse = await requete(`${urlApi}/rest/v1/rpc/${fonction}`, {
				method: 'POST',
				headers: {
					apikey: cleService ?? '',
					authorization: `Bearer ${cleService ?? ''}`,
					'content-type': 'application/json',
				},
				body: JSON.stringify(arguments_),
				signal: signal(echeance),
			})
			if (!reponse.ok) throw new Error(`HTTP ${reponse.status}`)
			// Une fonction `returns void` rend un corps vide : ce n'est pas une erreur.
			const texte = await reponse.text()
			return texte === '' ? null : JSON.parse(texte)
		},

		maintenantMs,
		tirerPoignee,

		// Un événement par geste, et rien d'autre : ni jeton, ni poignée, ni code, ni adresse, ni `sub`.
		journaliser: (evenement) => console.info(JSON.stringify(evenement)),
	}
}
