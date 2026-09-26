// @spec CRM-016 (docs/BACKLOG.md) — environnement transmis aux workers des fonctions edge
// @spec CRM-092 (docs/BACKLOG.md), docs/SPEC-session-sso.md §5.5 — environnement PAR FONCTION :
//       la clé de signature n'atteint que l'échangeur de session
// @spec docs/SPEC-edge-functions.md §2 (variables du runtime), §5 (sécurité)
// @spec docs/JOURNAL.md décision 584 (révision de la règle « JWT_SECRET n'est pas propagé »)
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
