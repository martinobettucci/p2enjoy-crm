// @spec CRM-097 (docs/BACKLOG.md) — tranche T1 : la configuration de l'assistant IA et sa cible
// @spec docs/SPEC-ia.md §3 (les quatre variables `OLLAMA_*`), §4 (mode dégradé), §11.6 (le simulateur,
//       instrumentation du seul développement) ; docs/JOURNAL.md décision 617
//
// Module pur. La clé n'est lue qu'ici et ne ressort que dans l'en-tête `Authorization` de l'appel au
// serveur : aucune réponse ni aucun journal ne la porte.

type LireEnv = (nom: string) => string | undefined

/** Défauts du gabarit (`.env.example` §13). */
export const MODELE_PAR_DEFAUT = 'gemma4:e2b'
export const CONTEXTE_PAR_DEFAUT = 36_864

/** L'en-tête qui choisit un scénario du simulateur — honoré en développement SEULEMENT. */
export const EN_TETE_SIMULATEUR = 'x-ia-simulateur'
export const SCENARIOS_SIMULATEUR = ['valide', 'incoherente', 'invalide', 'cle_refusee'] as const

export type ConfigurationIa = {
	readonly hote: string | null
	readonly cle: string | null
	readonly modele: string
	readonly contexte: number
	/** Posée par le seul `docker-compose.dev.yml` ; absente en production. */
	readonly hoteSimulateur: string | null
}

/** Une cible d'appel : le serveur réel, ou le simulateur pour une preuve. */
export type Cible = { readonly hote: string; readonly cle: string; readonly simulee: boolean }

const sansBarreFinale = (valeur: string) => valeur.trim().replace(/\/+$/, '')

export function lireConfiguration(lire: LireEnv): ConfigurationIa {
	const hote = lire('OLLAMA_HOST')
	const cle = lire('OLLAMA_API_KEY')?.trim()
	const modele = lire('OLLAMA_MODEL')?.trim()
	const contexte = Number.parseInt(lire('OLLAMA_CONTEXT_LENGTH') ?? '', 10)
	const simulateur = lire('IA_SIMULATEUR_HOST')
	return {
		hote: hote && hote.trim() !== '' ? sansBarreFinale(hote) : null,
		cle: cle && cle !== '' ? cle : null,
		modele: modele && modele !== '' ? modele : MODELE_PAR_DEFAUT,
		contexte: Number.isInteger(contexte) && contexte > 0 ? contexte : CONTEXTE_PAR_DEFAUT,
		hoteSimulateur: simulateur && simulateur.trim() !== '' ? sansBarreFinale(simulateur) : null,
	}
}

/**
 * La cible de cette requête, ou `null` si l'assistant n'a ni serveur ni clé.
 *
 * Le simulateur n'est visé que si la configuration le CONNAÎT — la variable n'existe qu'en
 * développement — ET que la requête le demande par un scénario connu. En production, l'en-tête est
 * ignoré : la cible reste le serveur réel (docs/SPEC-ia.md §11.6). Le scénario voyage comme clé du
 * simulateur (`simule-<scénario>`), là où le serveur réel attend la sienne.
 */
export function cibleDe(configuration: ConfigurationIa, entetes: Headers): Cible | null {
	const scenario = entetes.get(EN_TETE_SIMULATEUR)
	if (
		configuration.hoteSimulateur !== null &&
		scenario !== null &&
		(SCENARIOS_SIMULATEUR as readonly string[]).includes(scenario)
	) {
		return { hote: configuration.hoteSimulateur, cle: `simule-${scenario}`, simulee: true }
	}
	if (configuration.hote === null || configuration.cle === null) return null
	return { hote: configuration.hote, cle: configuration.cle, simulee: false }
}
