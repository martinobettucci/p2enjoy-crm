// @spec CRM-001 (docs/BACKLOG.md) — tranche INC-299 : la webapp ne compte jamais par `HEAD`
// @spec docs/DAT.md §3.5 bis (seconde cause, décision 700) ; docs/INCONSISTENCY_REPORT.md INC-299
//
// La forme d'un compte, décidée ici et nulle part ailleurs. PostgREST répond à un `HEAD` sans
// longueur puis ferme la connexion sans l'annoncer ; nginx, sous Kong, la remet au pool, et la
// requête suivante qui la reprend rend `502`. Un compte s'écrit donc :
//
//   client.from(table).select(colonne, OPTIONS_COMPTE) … .limit(LIMITE_COMPTE)
//
// soit un `GET` avec `Prefer: count=exact`, une réponse `206` au corps `[]` et le compte dans
// `Content-Range` (`*/N`) — mesuré sur la vraie route. Aucune ligne ne transite, comme avec
// l'option `head` de supabase-js, que `compter.test.ts` refuse dans tout `webapp/src`.

/** Options d'un compte : le serveur compte, et la requête reste un `GET`. */
export const OPTIONS_COMPTE = { count: 'exact' } as const

/** Borne d'un compte : aucune ligne rapportée, seulement leur nombre. */
export const LIMITE_COMPTE = 0
