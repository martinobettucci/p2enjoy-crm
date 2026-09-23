// @spec CRM-009 (docs/BACKLOG.md) — adresse de retour après connexion
// @spec CRM-092 (docs/BACKLOG.md) — le classement des refus de GoTrue quitte ce module avec le
//       formulaire à mot de passe (docs/SPEC-session-sso.md §2) ; les refus de l'échangeur sont
//       classés par `lib/session.ts`
// @spec docs/SPEC-auth.md §9.1 (navigation) ; docs/SPEC-session-sso.md §4 (point 6)
//
// Ce module ne rend rien.

/** Une adresse de retour ne quitte jamais l'origine ni la racine de l'application. */
export function cheminRetour(valeur: unknown): string {
	if (typeof valeur !== 'string') return '/'
	if (!valeur.startsWith('/') || valeur.startsWith('//')) return '/'
	return valeur === '/connexion' || valeur.startsWith('/connexion?') ? '/' : valeur
}
