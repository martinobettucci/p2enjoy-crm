// @spec CRM-016 (docs/BACKLOG.md) — environnement transmis aux workers des fonctions edge
// @spec CRM-092 (docs/BACKLOG.md), docs/SPEC-session-sso.md §5.5 — environnement PAR FONCTION :
//       la clé de signature n'atteint que l'échangeur de session
// @spec docs/SPEC-edge-functions.md §2 (variables du runtime), §5 (sécurité)
// @spec docs/JOURNAL.md décision 584 (révision de la règle « JWT_SECRET n'est pas propagé »)
// @spec CRM-097 (docs/BACKLOG.md) — tranche T1 : la fonction `ia` reçoit les variables `OLLAMA_*` et le
//       simulateur de développement, elle seule, et une borne de 150 s (docs/SPEC-ia.md §11.1, §11.6)
// @spec CRM-101 (docs/BACKLOG.md) — tranche T2 : `session` reçoit aussi `CRM_SUPERADMINS_INITIAUX`, la liste de
//       l'amorçage unique (docs/SPEC-plateforme.md §3, décision 627)
// @spec CRM-073 (docs/BACKLOG.md) — tranche T2 : `webhooks` reçoit les hôtes autorisés et l'adresse de l'autorité du
//       récepteur local — deux variables de développement —, et une borne de 30 s (docs/SPEC-webhooks.md §5.2, §6, §12)
// @spec CRM-127 (docs/BACKLOG.md) — tranche T3 : `mail-connection-test` reçoit, elle seule, l'adresse de `mail-sync` et son
//       jeton interne, et une borne de 45 s (docs/SPEC-mail-subsystem.md §23.4)
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
	// `CRM-101` : la liste d'amorçage du superadministrateur, qu'applique la seule fonction de session serveur
	// (docs/SPEC-plateforme.md §3). Elle n'est pas un secret, mais aucune autre fonction n'en a l'emploi.
	session: ['JWT_SECRET', 'SSO_OIDC_ISSUER', 'SSO_OIDC_CLIENT_ID', 'OIDC_CLIENT_SECRET', 'CRM_SUPERADMINS_INITIAUX'],
	// `CRM-097` : la clé du serveur LLM n'atteint que l'assistant ; `IA_SIMULATEUR_HOST` n'existe qu'en
	// développement (docs/SPEC-ia.md §11.6).
	ia: ['OLLAMA_HOST', 'OLLAMA_API_KEY', 'OLLAMA_MODEL', 'OLLAMA_CONTEXT_LENGTH', 'IA_SIMULATEUR_HOST'],
	// `CRM-073` : les deux variables n'existent qu'en développement, pour joindre le récepteur local
	// (docs/SPEC-webhooks.md §6, §12) ; la production ne les pose pas.
	webhooks: ['WEBHOOKS_ALLOWED_HOSTS', 'WEBHOOKS_DEV_CA_URL'],
	// `CRM-127` : le jeton interne de `mail-sync` n'atteint que le relais du test de connexion, jamais un navigateur ni une
	// autre fonction (docs/SPEC-mail-subsystem.md §23.4).
	'mail-connection-test': ['MAIL_SYNC_URL', 'MAIL_SYNC_INTERNAL_TOKEN'],
}

/** La borne commune d'un worker : une fonction courte. */
export const DELAI_COMMUN_MS = 10_000

/**
 * Ce qu'une fonction nommée reçoit comme borne, si elle diffère. `ia` poursuit une génération de 120 s
 * au plus en tâche de fond : sa borne la couvre, avec la marge de ses écritures (docs/SPEC-ia.md §11.1).
 */
export const DELAI_PROPRE: Readonly<Record<string, number>> = {
	ia: 150_000,
	// `CRM-073` : un passage remet jusqu'à 50 remises en parallèle, chacune bornée à 10 s, puis rend leurs résultats.
	webhooks: 30_000,
	// `CRM-127` : le relais vers `mail-sync` est borné à 40 s, le test SMTP en prenant jusqu'à 30 (§23.4).
	'mail-connection-test': 45_000,
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
