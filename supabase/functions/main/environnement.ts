// @spec CRM-016 (docs/BACKLOG.md) — environnement transmis aux workers des fonctions edge
// @spec CRM-092 (docs/BACKLOG.md), docs/SPEC-session-sso.md §5.5 — environnement PAR FONCTION :
//       la clé de signature n'atteint que l'échangeur de session
// @spec docs/SPEC-edge-functions.md §2 (variables du runtime), §5 (sécurité)
// @spec docs/JOURNAL.md décision 584 (révision de la règle « JWT_SECRET n'est pas propagé »)
// @spec CRM-097 (docs/BACKLOG.md) — tranche T1 : la fonction `ia` reçoit les variables `OLLAMA_*` et le
//       simulateur de développement, elle seule, et une borne de 150 s (docs/SPEC-ia.md §11.1, §11.6)
//
// Module pur. Le conteneur `functions` reçoit `JWT_SECRET` depuis `CRM-092`, parce que l'échangeur
// doit signer le jeton interne que PostgREST, Realtime et Storage acceptent. Le service principal ne
// le remet pourtant qu'au SEUL worker `session` : une autre fonction, présente ou future, ne peut pas
// frapper un jeton. Depuis la décision 586, `session` reçoit aussi le secret du client confidentiel
// (`OIDC_CLIENT_SECRET`), qu'aucune autre fonction ne voit. Ajouter une fonction à
// `ENVIRONNEMENT_PROPRE` est un geste à justifier.

/** Ce que toute fonction de confiance reçoit (`docs/SPEC-edge-functions.md` §2). */
export const ENVIRONNEMENT_COMMUN = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY'] as const

/** Ce qu'une fonction nommée reçoit EN PLUS, et elle seule. */
export const ENVIRONNEMENT_PROPRE: Readonly<Record<string, readonly string[]>> = {
	session: ['JWT_SECRET', 'SSO_OIDC_ISSUER', 'SSO_OIDC_CLIENT_ID', 'OIDC_CLIENT_SECRET'],
	// `CRM-097` : la clé du serveur LLM n'atteint que l'assistant ; `IA_SIMULATEUR_HOST` n'existe qu'en
	// développement (docs/SPEC-ia.md §11.6).
	ia: ['OLLAMA_HOST', 'OLLAMA_API_KEY', 'OLLAMA_MODEL', 'OLLAMA_CONTEXT_LENGTH', 'IA_SIMULATEUR_HOST'],
}

/** La borne commune d'un worker : une fonction courte. */
export const DELAI_COMMUN_MS = 10_000

/**
 * Ce qu'une fonction nommée reçoit comme borne, si elle diffère. `ia` poursuit une génération de 120 s
 * au plus en tâche de fond : sa borne la couvre, avec la marge de ses écritures (docs/SPEC-ia.md §11.1).
 */
export const DELAI_PROPRE: Readonly<Record<string, number>> = {
	ia: 150_000,
}

export function delaiDe(fonction: string): number {
	return Object.hasOwn(DELAI_PROPRE, fonction) ? DELAI_PROPRE[fonction] ?? DELAI_COMMUN_MS : DELAI_COMMUN_MS
}

export function environnementDe(fonction: string, lire: (nom: string) => string | undefined): [string, string][] {
	const noms = [...ENVIRONNEMENT_COMMUN, ...(Object.hasOwn(ENVIRONNEMENT_PROPRE, fonction) ? ENVIRONNEMENT_PROPRE[fonction] ?? [] : [])]
	const valeurs: [string, string][] = []
	for (const nom of noms) {
		const valeur = lire(nom)
		if (valeur !== undefined) valeurs.push([nom, valeur])
	}
	return valeurs
}
