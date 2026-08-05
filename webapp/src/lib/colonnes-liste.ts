// @spec CRM-042 (docs/BACKLOG.md) — les colonnes demandées par la lecture paginée de la vue liste
// @spec docs/SPEC-cards.md §12.3 (ce que la liste lit), §12.7 (colonnes du tableau)
// @spec docs/SPEC-types.md §4
//
// CE MODULE N'IMPORTE RIEN, ET C'EST TOUT SON OBJET.
//
// La chaîne `select` de la page doit être exercée des **deux** côtés : par le test unitaire, qui
// vérifie la requête que le module de composition construit, et par la preuve d'API, qui vérifie
// que la pile réelle rend bien ce que ces colonnes demandent. Or la preuve d'API appartient à un
// autre projet TypeScript (`tsconfig.tools.json`), qui n'a ni `vite/client` ni les types du DOM :
// importer `liste-cards.ts` depuis `e2e/` fait échouer la compilation sur
// `webapp/src/lib/supabase.ts`.
//
// C'est le procédé de `webapp/src/lib/colonnes-board.ts` (`CRM-041`, décision 177), repris ici
// plutôt que réinventé : une seule déclaration, atteignable des deux côtés.

/**
 * Cards d'une page de la vue liste.
 *
 * `position` n'est pas demandée : l'ordre de la liste est celui du §12.4, jamais celui d'une
 * colonne de board. `description`, `probability_override`, `health_score` et les horodatages
 * techniques non plus — une requête ne rapporte que ce qui est affiché.
 *
 * `owner_id` est **délibérément absente** : le nom d'un responsable n'est lisible par personne
 * (INC-014), la colonne « Responsable » n'est donc pas rendue du tout, et rapporter un identifiant
 * que rien n'affiche serait une donnée transportée pour rien (§12.3).
 */
export const COLONNES_CARD_LISTE =
	'id, title, amount, currency, next_action, next_action_at, current_step_id'

/**
 * Nombre de lignes d'une page.
 *
 * Valeur **fixe** : aucune unité du backlog ne porte un sélecteur de densité, et en offrir un
 * serait un périmètre inventé (§12.6). Déclarée ici, et non recopiée dans les preuves : une
 * pagination dont le pas est écrit à deux endroits finit par être écrite de deux façons.
 */
export const LIGNES_PAR_PAGE = 25

/**
 * Le code que PostgREST rend lorsque le rang demandé **dépasse** le total.
 *
 * MESURÉ sur les trois cards actives de `grands-comptes` : `Range: 3-3` — l'offset **égale** le
 * total — rend encore `206` et zéro ligne, tandis que `Range: 4-4` rend `416`. Vu à travers
 * `supabase-js`, ce `416` porte `error.code === 'PGRST103'`, `count: null` et `data: null` : c'est
 * une **erreur**, pas une page vide (§12.6, décision 186).
 *
 * Il est reconnu par son code, jamais par le texte du message, qui dépend de la version du
 * serveur — même règle que le `42501` du board (`webapp/src/lib/board.ts`).
 */
export const CODE_PAGE_INEXISTANTE = 'PGRST103'
