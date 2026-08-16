// @spec CRM-081 (docs/BACKLOG.md) — mise en sommeil d'une affaire, tranche 2 b
// @spec docs/SPEC-cards.md §16.2 (« en sommeil » = non nulle ET future), §16.12.1 (le prédicat
//       d'exclusion et sa mesure), §16.12.2 (l'instant est celui du client, et pourquoi ce n'est
//       pas une règle d'accès), §16.12.4 (le paramètre d'adresse et sa clôture)
// @spec docs/SPEC-cards.md §12.2 (l'adresse porte tout) ; docs/SPEC-types.md §4
//
// CE MODULE N'IMPORTE RIEN, ET C'EST TOUT SON OBJET.
//
// Le filtre d'exclusion doit être exercé des **deux** côtés : par le test unitaire, qui vérifie la
// requête que la vue liste construit, et par la preuve d'API, qui vérifie que la pile réelle rend
// bien ce que ce filtre demande. Or la preuve d'API appartient à un autre projet TypeScript
// (`tsconfig.tools.json`), qui n'a ni `vite/client` ni les types du DOM : importer
// `sommeil-card.ts` depuis `e2e/` fait échouer la compilation sur `webapp/src/lib/supabase.ts`,
// que ce module-là atteint par son type de client.
//
// C'est le procédé de `colonnes-board.ts` et de `colonnes-liste.ts` (décision 177), repris ici
// plutôt que réinventé : une seule déclaration, atteignable des deux côtés.

/** Les deux états de la bascule. La liste est **close** : rien d'autre n'entre dans l'adresse. */
export type ModeSommeil = 'masquees' | 'visibles'

/**
 * Le défaut, et c'est la Definition of Done elle-même : une affaire en sommeil **sort des vues par
 * défaut** (§16.12.4). Une adresse nue ouvre donc un board et une liste sans les affaires endormies.
 */
export const MODE_SOMMEIL_PAR_DEFAUT: ModeSommeil = 'masquees'

/** Le nom du paramètre dans l'adresse, déclaré une fois : les deux vues et les preuves l'importent. */
export const CLE_URL_SOMMEIL = 'sommeil'

/**
 * La seule valeur qui s'écrit dans l'adresse.
 *
 * Le défaut n'y est jamais écrit (§12.2) : une adresse portant `?sommeil=masquees` ne dirait rien
 * de plus que l'adresse nue, et la vue par défaut doit rester l'adresse la plus courte.
 */
export const VALEUR_URL_SOMMEIL_VISIBLES = 'visibles'

/**
 * Lit le mode d'une valeur d'adresse, en repliant **tout** ce qui n'est pas reconnu.
 *
 * La clôture n'est pas décorative : elle est la même que celle des tris du §12.2, et pour la même
 * raison — une valeur inconnue ne doit jamais atteindre la requête. Ici, elle ne pourrait pas
 * devenir un nom de colonne, mais un repli explicite évite qu'une faute de frappe dans une adresse
 * partagée fasse apparaître des affaires qu'on croyait rangées.
 */
export function lireModeSommeil(valeur: string | null | undefined): ModeSommeil {
	return valeur === VALEUR_URL_SOMMEIL_VISIBLES ? 'visibles' : MODE_SOMMEIL_PAR_DEFAUT
}

/**
 * Le filtre `or=` que la vue liste envoie à PostgREST pour **écarter** les affaires en sommeil.
 *
 * C'est la négation stricte du prédicat du §16.2 : « ni nulle, ni future » devient « nulle OU
 * échue ». Écrit ainsi et non en `not.gt`, parce qu'une colonne NULLE ne satisfait aucune
 * comparaison — `snoozed_until=not.gt.<instant>` écarterait toutes les affaires qui n'ont jamais
 * dormi, c'est-à-dire l'immense majorité.
 *
 * L'INSTANT EST ENVOYÉ COMME VALEUR, et le motif est écrit au §16.12.2 : PostgREST n'évalue aucune
 * fonction dans un filtre, `lte.now()` comparerait à la chaîne « now() ». Ce n'est pas un contrôle
 * d'accès déporté chez le client (`CLAUDE.md` §10) — le sommeil range, il n'autorise pas, et la RLS
 * reste seule juge de ce qui est lisible.
 *
 * MESURÉ le 2026-08-16 : PostgREST accepte l'horodatage avec ses millisecondes
 * (`2026-08-16T17:23:59.000Z`, la forme que rend `toISOString`) comme sans elles.
 */
export function filtreExclusionSommeil(maintenant: Date): string {
	return `snoozed_until.is.null,snoozed_until.lte.${maintenant.toISOString()}`
}
