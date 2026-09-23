// @spec CRM-007 (docs/BACKLOG.md) — client Supabase de la webapp
// @spec CRM-009 (docs/BACKLOG.md) — stockage d'onglet et repli mémoire
// @spec CRM-092 (docs/BACKLOG.md) — le client reçoit le jeton interne de l'échangeur, sans module `auth`
// @spec docs/SPEC-session-sso.md §8.3 (jeton en mémoire seulement), §8.4 (K6 `accessToken`, K18)
// @spec docs/SPEC-webapp.md §6.1 (client), §11 (stockage côté client)
// @spec docs/SPEC-auth.md §9.2 (sessionStorage et repli mémoire) ; docs/SPEC-auth.md §10.5
// @spec docs/DAT.md §3.1 (webapp) ; CLAUDE.md §11 (stockage sur l'appareil)
//
// Le client est typé par le schéma généré (CRM-006) : une colonne inexistante ne compile pas.
// Il ne porte **aucune** règle d'autorisation — l'interface ne déduit jamais un droit d'un
// type, le refus fait toujours autorité côté backend (docs/DAT.md §3.1).
//
// `CRM-092` : GoTrue n'émet plus rien. Le client est créé avec `accessToken` (K6), qui rend le jeton
// interne tenu EN MÉMOIRE par le porteur ci-dessous — ou `null`, et `supabase-js` présente alors la
// clé anonyme. Le module `auth` de la bibliothèque est désactivé par cette option : rien n'écrit plus
// de session dans le navigateur. `creerStockageSession` ne sert plus qu'à la transaction PKCE
// (`docs/SPEC-session-sso.md` §8.3), bornée à l'onglet avec son repli mémoire.

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from './database.types'

export type ClientCrm = SupabaseClient<Database>

export type ConfigurationClient = {
	readonly url: string
	readonly cleAnonyme: string
}

export type StockageSession = {
	readonly getItem: (cle: string) => string | null
	readonly setItem: (cle: string, valeur: string) => void
	readonly removeItem: (cle: string) => void
}

/**
 * Adapte `sessionStorage` sans laisser son indisponibilité faire tomber la connexion.
 *
 * Certains navigateurs exposent l'objet mais lèvent à la première opération (stockage bloqué,
 * quota nul, contexte privé durci). Chaque opération bascule alors sur la même mémoire de repli :
 * une valeur écrite après l'incident reste lisible pendant la vie de la page.
 */
export function creerStockageSession(stockage?: StockageSession | null): StockageSession {
	const memoire = new Map<string, string>()
	let actif: StockageSession | null = stockage === undefined ? stockageNavigateur() : stockage

	return {
		getItem(cle) {
			if (actif !== null) {
				try {
					return actif.getItem(cle)
				} catch {
					actif = null
				}
			}
			return memoire.get(cle) ?? null
		},
		setItem(cle, valeur) {
			memoire.set(cle, valeur)
			if (actif !== null) {
				try {
					actif.setItem(cle, valeur)
					return
				} catch {
					actif = null
				}
			}
		},
		removeItem(cle) {
			memoire.delete(cle)
			if (actif !== null) {
				try {
					actif.removeItem(cle)
					return
				} catch {
					actif = null
				}
			}
		},
	}
}

/** Ne lit jamais `localStorage`, même comme repli implicite. */
function stockageNavigateur(): StockageSession | null {
	try {
		return globalThis.sessionStorage ?? null
	} catch {
		return null
	}
}

/**
 * Lit la configuration injectée au build par Vite.
 *
 * Rend `null` lorsqu'elle est incomplète, plutôt qu'un client dirigé vers une adresse vide :
 * l'application affiche alors son état d'erreur de configuration (docs/SPEC-webapp.md §6.1).
 * Démarrer muet serait la valeur par défaut trompeuse que CLAUDE.md §18 interdit.
 */
export function lireConfiguration(env: ImportMetaEnv): ConfigurationClient | null {
	const url = env.VITE_SUPABASE_URL
	const cleAnonyme = env.VITE_SUPABASE_ANON_KEY
	if (typeof url !== 'string' || url.trim() === '') return null
	if (typeof cleAnonyme !== 'string' || cleAnonyme.trim() === '') return null
	return { url: url.trim(), cleAnonyme: cleAnonyme.trim() }
}

/**
 * Le jeton interne courant, en mémoire et nulle part ailleurs (docs/SPEC-session-sso.md §8.3). Seul
 * le fournisseur d'authentification le pose ; le client Supabase le lit à chaque requête.
 */
export type PorteurJeton = {
	readonly lire: () => string | null
	readonly poser: (jeton: string | null) => void
}

export function creerPorteurJeton(): PorteurJeton {
	let jeton: string | null = null
	return {
		lire: () => jeton,
		poser(valeur) {
			jeton = valeur
		},
	}
}

export function creerClient(configuration: ConfigurationClient, porteur: PorteurJeton): ClientCrm {
	return createClient<Database>(configuration.url, configuration.cleAnonyme, {
		accessToken: async () => porteur.lire(),
	})
}

const configuration = lireConfiguration(import.meta.env)

/** Le porteur du jeton de l'application ; le fournisseur d'authentification le tient. */
export const porteurJeton: PorteurJeton = creerPorteurJeton()

/** `null` si la configuration est absente : l'interface le traite comme un état, pas comme un crash. */
export const clientCrm: ClientCrm | null = configuration === null ? null : creerClient(configuration, porteurJeton)

/** La clé anonyme, que Kong exige aussi de l'échangeur de session (docs/SPEC-session-sso.md §5.1). */
export const cleAnonymeCrm: string | null = configuration?.cleAnonyme ?? null
