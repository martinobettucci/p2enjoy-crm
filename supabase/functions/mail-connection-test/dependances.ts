// @spec CRM-127 (docs/BACKLOG.md) — tranche T3 : les dépendances réelles de la fonction `mail-connection-test`
// @spec docs/SPEC-mail-subsystem.md §23.3 (`authorize_mail_connection_test`, appelée par PostgREST avec le jeton de
//       l'appelant), §23.4 (relais vers `MAIL_SYNC_URL` avec `MAIL_SYNC_INTERNAL_TOKEN`, borné à 40 s) ;
//       docs/SPEC-edge-functions.md §2 (environnement propre à cette fonction)
//
// Aucune connexion directe à PostgreSQL : la fonction parle à la base comme le navigateur le ferait, avec le jeton de
// l'appelant, si bien que c'est la base qui décide. Le jeton interne ne sort jamais de ce module.

import type { Autorisation, Cible, DependancesTest, Relais } from './handler.ts'

type LireEnv = (nom: string) => string | undefined
type Fetch = (url: string, init: RequestInit) => Promise<Response>

/** Un appel à la base ne retient jamais la fonction plus de 10 s. */
export const DELAI_BASE_MS = 10_000
/** Le test SMTP prend jusqu'à 30 s (§14.5) : le relais lui en laisse 40. */
export const DELAI_RELAIS_MS = 40_000

const ROUTES: Readonly<Record<Cible, string>> = {
	inbound: 'inbound-accounts',
	outbound: 'outbound-identities',
}

const REFUS_CONNUS = new Set(['not_authenticated', 'invalid_target', 'not_found', 'disabled', 'too_soon'])

/**
 * Le refus de la base, lu sur son message — un mot du contrat (§23.3) —, jamais deviné à partir du code HTTP que
 * PostgREST choisit. Un `42501` sans ce mot est un refus d'exécution : un appelant anonyme, donc sans session.
 */
export async function lireAutorisation(reponse: Response): Promise<Autorisation> {
	if (reponse.ok) return 'ok'
	let corps: { code?: unknown; message?: unknown } = {}
	try {
		corps = await reponse.json()
	} catch {
		return 'indisponible'
	}
	if (typeof corps.message === 'string' && REFUS_CONNUS.has(corps.message)) return corps.message as Autorisation
	if (corps.code === '42501') return 'not_authenticated'
	return 'indisponible'
}

export async function lireRelais(reponse: Response): Promise<Relais> {
	if (reponse.status === 404) return { cas: 'not_found' }
	if (reponse.status === 409) return { cas: 'secret_missing' }
	if (!reponse.ok) return { cas: 'indisponible' }
	try {
		const corps = (await reponse.json()) as Record<string, unknown>
		if (typeof corps.status !== 'string' || typeof corps.checked_at !== 'string') return { cas: 'indisponible' }
		return {
			cas: 'verdict',
			status: corps.status,
			error: typeof corps.error === 'string' ? corps.error : null,
			checked_at: corps.checked_at,
		}
	} catch {
		return { cas: 'indisponible' }
	}
}

export function creerDependances(
	lire: LireEnv,
	requete: Fetch = fetch,
	ecrireJournal: (ligne: string) => void = (ligne) => console.info(ligne),
): DependancesTest {
	const urlApi = lire('SUPABASE_URL')?.replace(/\/+$/, '') ?? ''
	const cleAnonyme = lire('SUPABASE_ANON_KEY') ?? ''
	const urlService = lire('MAIL_SYNC_URL')?.replace(/\/+$/, '') ?? ''
	const jetonInterne = lire('MAIL_SYNC_INTERNAL_TOKEN') ?? ''

	return {
		async autoriser(jeton, cible, id) {
			try {
				const reponse = await requete(`${urlApi}/rest/v1/rpc/authorize_mail_connection_test`, {
					method: 'POST',
					headers: {
						apikey: cleAnonyme,
						authorization: `Bearer ${jeton}`,
						'content-type': 'application/json',
						accept: 'application/json',
					},
					body: JSON.stringify({ p_target: cible, p_id: id }),
					signal: AbortSignal.timeout(DELAI_BASE_MS),
				})
				return await lireAutorisation(reponse)
			} catch {
				return 'indisponible'
			}
		},

		async relayer(cible, id) {
			// Sans adresse ni jeton, la fonction ne prétend pas tester : le service est réputé injoignable.
			if (urlService === '' || jetonInterne === '') return { cas: 'indisponible' }
			try {
				const reponse = await requete(`${urlService}/internal/v1/${ROUTES[cible]}/${id}/test`, {
					method: 'POST',
					headers: { authorization: `Bearer ${jetonInterne}`, accept: 'application/json' },
					signal: AbortSignal.timeout(DELAI_RELAIS_MS),
				})
				return await lireRelais(reponse)
			} catch {
				return { cas: 'indisponible' }
			}
		},

		journal: (ligne) => ecrireJournal(JSON.stringify(ligne)),
	}
}
