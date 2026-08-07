// @spec CRM-007 (docs/BACKLOG.md) — client Supabase de la webapp
// @spec CRM-011 (docs/BACKLOG.md) — session authentifiée limitée à l'onglet
// @spec docs/SPEC-webapp.md §6.1 (client), §6.2 (session), §11 (stockage côté client)
// @spec docs/SPEC-auth.md §9.2 (sessionStorage et repli mémoire)
// @spec docs/DAT.md §3.1 (webapp) ; CLAUDE.md §11 (stockage sur l'appareil)
//
// Le client est typé par le schéma généré (CRM-006) : une colonne inexistante ne compile pas.
// Il ne porte **aucune** règle d'autorisation — l'interface ne déduit jamais un droit d'un
// type, le refus fait toujours autorité côté backend (docs/DAT.md §3.1).
//
// CRM-011 conserve la session dans `sessionStorage`, jamais dans le `localStorage` choisi par
// défaut par supabase-js. Le stockage est borné à l'onglet ; s'il est verrouillé par le
// navigateur, le repli mémoire maintient la session courante sans inventer de persistance.

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

export function creerClient(configuration: ConfigurationClient): ClientCrm {
	return createClient<Database>(configuration.url, configuration.cleAnonyme, {
		auth: {
			persistSession: true,
			autoRefreshToken: true,
			detectSessionInUrl: false,
			storage: creerStockageSession(),
		},
	})
}

const configuration = lireConfiguration(import.meta.env)

/** `null` si la configuration est absente : l'interface le traite comme un état, pas comme un crash. */
export const clientCrm: ClientCrm | null = configuration === null ? null : creerClient(configuration)
