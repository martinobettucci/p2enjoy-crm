// @spec CRM-008 (docs/BACKLOG.md) — fixtures du projet Playwright `api`
// @spec docs/SPEC-test-harness.md §4.3 (fixtures, scénarios)
// @spec docs/SPEC-seed.md §2.3 (comptes du seed, mot de passe de développement)
// @spec docs/SPEC-permissions-rls.md §7 (preuves de refus, hors interface)
// @spec CLAUDE.md §10 (toute règle d'accès se prouve hors interface)
// @spec CRM-092 (docs/BACKLOG.md), docs/SPEC-session-sso.md §4, §5.2, §13 — tranche T4 : le jeton d'une
//       preuve est le jeton INTERNE, obtenu par la vraie connexion LeLabs et l'échangeur de session
//
// Les jetons sont obtenus par la **véritable connexion**, jamais fabriqués localement. Un jeton
// signé à la main prouverait que la signature est acceptée ; il ne prouverait rien de ce que le
// produit consent à un profil réel. Depuis `CRM-092` T4, cette connexion est celle de la webapp :
// la page du Keycloak de développement, puis l'échangeur de session, qui rend le jeton interne que
// PostgREST, Realtime et Storage acceptent. GoTrue n'y prend plus aucune part.
//
// Ce module est le livrable durable du projet `api` : `CRM-014` s'appuiera dessus pour ses
// douze scénarios de refus, avec les mêmes profils et le même chemin d'obtention.

import { cleAnonyme, cleService, urlApi } from '../env'
import { MOT_DE_PASSE_SEED, fermer, obtenirCode, ouvrir } from './sso'

export { MOT_DE_PASSE_SEED }

export const URL_API = urlApi()
export const CLE_ANONYME = cleAnonyme()
export const CLE_SERVICE = cleService()

/** Les trois comptes du seed socle, un par rôle (`docs/SPEC-seed.md` §2.3). */
export const COMPTES_SEED = [
	{ role: 'admin', adresse: 'admin@p2enjoy.test' },
	{ role: 'business_developer', adresse: 'bizdev@p2enjoy.test' },
	{ role: 'viewer', adresse: 'viewer@p2enjoy.test' },
] as const

/**
 * Tables du socle réellement alimentées par le seed.
 *
 * `track_members` et `channel_members` en sont **absentes à dessein** : le seed n'y pose aucune
 * ligne, leurs tables cibles n'existant pas avant `CRM-020` et `CRM-021`. Sur une table vide,
 * « l'API rend `[]` » est vrai que la RLS refuse ou qu'elle autorise tout : l'assertion serait
 * verte dans les deux cas, donc sans valeur probante (docs/JOURNAL.md décision 50).
 */
export const TABLES_ALIMENTEES = ['profiles', 'workspaces', 'workspace_members'] as const

/** Marge sous laquelle un jeton en cache n'est plus rendu : la preuve doit pouvoir s'en servir. */
const MARGE_JETON_S = 60

const jetonsObtenus = new Map<string, { readonly jeton: string; readonly expireA: number }>()

/**
 * Obtient le jeton interne d'un compte par la vraie connexion : code PKCE sur la page du Keycloak de
 * développement, puis ouverture par l'échangeur de session (docs/SPEC-session-sso.md §5.2).
 *
 * La session serveur est aussitôt FERMÉE : la preuve n'emploie que le jeton interne, qui reste
 * valable jusqu'à son échéance, et la table des sessions ne garde rien d'une preuve. Le jeton est
 * gardé en mémoire du processus tant qu'il vit encore au moins une minute ; un compte jetable
 * portant une adresse tirée au hasard, une adresse désigne toujours la même personne.
 *
 * Échoue en nommant la cause probable : un compte refusé signale presque toujours un seed non
 * appliqué — personne n'attend l'adresse —, et non un défaut d'authentification.
 */
export async function jetonDe(adresse: string, motDePasse = MOT_DE_PASSE_SEED): Promise<string> {
	const cle = `${adresse}\u0000${motDePasse}`
	const maintenant = Math.floor(Date.now() / 1000)
	const garde = jetonsObtenus.get(cle)
	if (garde !== undefined && garde.expireA - maintenant > MARGE_JETON_S) return garde.jeton

	const ouverte = await ouvrir(await obtenirCode(adresse, { motDePasse }))
	if (ouverte.statut !== 200 || typeof ouverte.corps?.jeton !== 'string') {
		throw new Error(
			`Connexion LeLabs refusée pour ${adresse} (HTTP ${ouverte.statut}) : ${JSON.stringify(ouverte.corps)}\n` +
				`Le seed est-il appliqué ? Voir supabase/seed/apply-seed.sh.`,
		)
	}
	await fermer(ouverte.poignee)
	const jeton = ouverte.corps.jeton
	jetonsObtenus.set(cle, { jeton, expireA: Number(ouverte.corps.expire_a) })
	return jeton
}

/** En-têtes d'un appelant anonyme : la clé de la webapp, aucune session. */
export function enTetesAnonymes(): Record<string, string> {
	return { apikey: CLE_ANONYME }
}

/** En-têtes d'un appelant authentifié : la clé publique **et** le jeton du profil. */
export function enTetesAuthentifies(jeton: string): Record<string, string> {
	return { apikey: CLE_ANONYME, Authorization: `Bearer ${jeton}` }
}

/** En-têtes de la clé de service, qui contourne la RLS. Jamais employée pour prouver un refus. */
export function enTetesService(): Record<string, string> {
	return { apikey: CLE_SERVICE, Authorization: `Bearer ${CLE_SERVICE}` }
}
