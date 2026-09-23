// @spec CRM-092 (docs/BACKLOG.md) — entrées-sorties réelles de l'échangeur de session
// @spec docs/SPEC-session-sso.md §5.2 (délais), §5.5 (environnement, coût, mode dégradé), §6.2 (appel)
// @spec docs/SPEC-edge-functions.md §2 (runtime : 10 s de temps mur par worker)
// @spec CLAUDE.md §19 (timeout et gestion d'erreur de tout service externe), §20 (aucun secret journalisé)
//
// Module pur : `fetch` et l'environnement sont injectés, de sorte que la forme exacte des appels —
// adresse, en-têtes, corps, délai — se prouve sans réseau. Le délai de chaque appel est de 3 s : trois
// appels au plus par échange restent sous les 10 s de temps mur d'un worker (§2 de la spécification
// des fonctions), au lieu d'être tués sans réponse.

import type { ConfigurationSession, DependancesSession, ResultatOuverture } from './handler.ts'

export const DELAI_APPEL_MS = 3_000

type Fetch = (url: string, init?: RequestInit) => Promise<Response>
type LireEnv = (nom: string) => string | undefined

/** Rend `null` si une variable manque : l'échangeur répond alors `service_indisponible`, sans rien tenter. */
export function lireConfiguration(lire: LireEnv): ConfigurationSession | null {
	const emetteur = lire('SSO_OIDC_ISSUER')?.trim().replace(/\/+$/, '')
	const clientId = lire('SSO_OIDC_CLIENT_ID')?.trim()
	const secretJwt = lire('JWT_SECRET')
	if (!emetteur || !clientId || !secretJwt) return null
	return { emetteur, clientId, secretJwt }
}

export function creerDependances(lire: LireEnv, requete: Fetch = fetch): DependancesSession {
	const urlApi = lire('SUPABASE_URL')?.replace(/\/+$/, '')
	const cleService = lire('SUPABASE_SERVICE_ROLE_KEY')

	return {
		configuration: urlApi && cleService ? lireConfiguration(lire) : null,

		async lireJson(url) {
			const reponse = await requete(url, {
				headers: { accept: 'application/json' },
				signal: AbortSignal.timeout(DELAI_APPEL_MS),
			})
			if (!reponse.ok) throw new Error(`HTTP ${reponse.status}`)
			return await reponse.json()
		},

		async ouvrirSession(sub, adresse, nom): Promise<ResultatOuverture> {
			const reponse = await requete(`${urlApi}/rest/v1/rpc/ouvrir_session_sso`, {
				method: 'POST',
				headers: {
					apikey: cleService ?? '',
					authorization: `Bearer ${cleService ?? ''}`,
					'content-type': 'application/json',
				},
				body: JSON.stringify({ p_sub: sub, p_email: adresse, p_nom: nom }),
				signal: AbortSignal.timeout(DELAI_APPEL_MS),
			})
			if (!reponse.ok) throw new Error(`HTTP ${reponse.status}`)
			const corps = (await reponse.json()) as Record<string, unknown> | null
			if (corps === null || typeof corps.admis !== 'boolean') throw new Error('réponse inattendue')
			return { admis: corps.admis, nom: typeof corps.nom === 'string' ? corps.nom : null }
		},

		maintenant: () => Math.floor(Date.now() / 1000),

		// Un événement par échange, et rien d'autre : ni jeton, ni adresse, ni nom, ni `sub` (§5.5).
		journaliser: (evenement) => console.info(JSON.stringify(evenement)),
	}
}
