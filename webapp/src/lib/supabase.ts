// @spec CRM-007 (docs/BACKLOG.md) — client Supabase de la webapp
// @spec docs/SPEC-webapp.md §6.1 (client), §6.2 (session), §11 (stockage côté client)
// @spec docs/DAT.md §3.1 (webapp) ; CLAUDE.md §11 (stockage sur l'appareil)
//
// Le client est typé par le schéma généré (CRM-006) : une colonne inexistante ne compile pas.
// Il ne porte **aucune** règle d'autorisation — l'interface ne déduit jamais un droit d'un
// type, le refus fait toujours autorité côté backend (docs/DAT.md §3.1).
//
// Aucune session n'est persistée (docs/JOURNAL.md décision 44) : cette unité ne livre aucun
// parcours de connexion, donc aucune écriture sur l'appareil n'est nécessaire, donc il n'y en
// a aucune. L'arbitrage du consentement revient à l'unité qui livrera la connexion.

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from './database.types'

export type ClientCrm = SupabaseClient<Database>

export type ConfigurationClient = {
	readonly url: string
	readonly cleAnonyme: string
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
			persistSession: false,
			autoRefreshToken: false,
			detectSessionInUrl: false,
		},
	})
}

const configuration = lireConfiguration(import.meta.env)

/** `null` si la configuration est absente : l'interface le traite comme un état, pas comme un crash. */
export const clientCrm: ClientCrm | null = configuration === null ? null : creerClient(configuration)
