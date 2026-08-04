// @spec CRM-008 (docs/BACKLOG.md) — fixtures du projet Playwright `api`
// @spec docs/SPEC-test-harness.md §4.3 (fixtures, scénarios)
// @spec docs/SPEC-seed.md §2.3 (comptes du seed, mot de passe de développement)
// @spec docs/SPEC-permissions-rls.md §7 (preuves de refus, hors interface)
// @spec CLAUDE.md §10 (toute règle d'accès se prouve hors interface)
//
// Les jetons sont obtenus par la **véritable route de connexion** de GoTrue, jamais fabriqués
// localement. Un jeton signé à la main prouverait que la signature est acceptée ; il ne
// prouverait rien de ce que le produit consent à un profil réel.
//
// Ce module est le livrable durable du projet `api` : `CRM-014` s'appuiera dessus pour ses
// douze scénarios de refus, avec les mêmes profils et le même chemin d'obtention.

import { request } from '@playwright/test'
import { cleAnonyme, cleService, urlApi } from '../env'

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
 * Mot de passe de développement commun aux comptes seedés.
 *
 * Il est publié dans `docs/SPEC-seed.md` §2.3 et `README.md` : ce n'est pas un secret, mais une
 * donnée de développement sur un domaine `.test`, réservé par la RFC 2606 et non routable.
 */
export const MOT_DE_PASSE_SEED = 'SeedDev2026Local'

/**
 * Tables du socle réellement alimentées par le seed.
 *
 * `track_members` et `channel_members` en sont **absentes à dessein** : le seed n'y pose aucune
 * ligne, leurs tables cibles n'existant pas avant `CRM-020` et `CRM-021`. Sur une table vide,
 * « l'API rend `[]` » est vrai que la RLS refuse ou qu'elle autorise tout : l'assertion serait
 * verte dans les deux cas, donc sans valeur probante (docs/JOURNAL.md décision 50).
 */
export const TABLES_ALIMENTEES = ['profiles', 'workspaces', 'workspace_members'] as const

/**
 * Obtient un jeton d'accès par la route de connexion réelle.
 *
 * Échoue en nommant la cause probable : un compte seedé introuvable signale presque toujours un
 * seed non appliqué, et non un défaut d'authentification.
 */
export async function jetonDe(adresse: string, motDePasse = MOT_DE_PASSE_SEED): Promise<string> {
	const contexte = await request.newContext({ baseURL: URL_API })
	try {
		const reponse = await contexte.post('/auth/v1/token?grant_type=password', {
			headers: { apikey: CLE_ANONYME, 'Content-Type': 'application/json' },
			data: { email: adresse, password: motDePasse },
		})
		if (!reponse.ok()) {
			throw new Error(
				`Connexion refusée pour ${adresse} (HTTP ${reponse.status()}) : ${await reponse.text()}\n` +
					`Le seed est-il appliqué ? Voir supabase/seed/apply-seed.sh.`,
			)
		}
		const corps = (await reponse.json()) as { access_token?: string }
		if (!corps.access_token) {
			throw new Error(`Réponse de connexion sans access_token pour ${adresse}.`)
		}
		return corps.access_token
	} finally {
		await contexte.dispose()
	}
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
