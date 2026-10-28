// @spec CRM-069 (docs/BACKLOG.md) — tranche T2 : les étiquettes lues avec la ligne, et le filtre par étiquette (docs/DESIGN_SYSTEM.md §5.73)
// @spec CRM-042 (docs/BACKLOG.md) — les colonnes demandées par la lecture paginée de la vue liste
// @spec CRM-022 (docs/BACKLOG.md) — responsable embarqué dans chaque ligne
// @spec docs/SPEC-cards.md §12.3 (ce que la liste lit), §12.7 (colonnes du tableau)
// @spec docs/SPEC-types.md §4
// @spec CRM-105 (docs/BACKLOG.md) — `description` lue pour l'infobulle du titre de la ligne
//       (docs/SPEC-cards.md §12.3, docs/DESIGN_SYSTEM.md §5.58, décision 629)
// @spec CRM-111 (docs/BACKLOG.md) — tranche T2.4.1 : la liste lit les RATTACHEMENTS du channel, l'affaire en plongement
//       (docs/SPEC-rattachements.md §8, §14)
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
 * colonne de board. `probability_override`, `health_score` et les horodatages techniques non
 * plus — une requête ne rapporte que ce qui est affiché. `description` l'est depuis `CRM-105` :
 * elle est affichée, en infobulle sur le titre de la ligne (docs/DESIGN_SYSTEM.md §5.58).
 *
 * Le responsable est embarqué par la FK : la colonne « Responsable » rend désormais avatar et
 * nom sans requête par ligne. Une card sans `owner_id` garde une cellule réellement vide.
 *
 * `snoozed_until` a rejoint la liste avec la tranche 2 b de `CRM-081`. La ligne ne l'affiche pas
 * telle quelle : elle en tire la **pastille compacte** d'une affaire endormie rendue visible par la
 * bascule (docs/SPEC-cards.md §16.12.7). Le filtre, lui, s'applique au serveur et n'a pas besoin
 * que la colonne soit rapportée — c'est la marque qui l'exige.
 */
//
// `CRM-111` T2.4.1 : la requête part des RATTACHEMENTS du channel — montant, prochaine action, étape, responsable, sommeil
// sont les leurs — et plonge l'affaire (`affaire:cards!inner`) pour le titre, la description, la devise, la date de
// création et la recherche. La ligne rendue à l'écran est inchangée (`ligneDepuisRattachement`, `liste-cards.ts`).
// PostgREST ne trie sur `affaire(…)` qu'une colonne que le plongement SÉLECTIONNE (mesuré, `42703`) : `id`, `title` et
// `created_at` y sont donc, même ceux que la ligne n'affiche pas.
export const COLONNES_RATTACHEMENT_LISTE =
	'id, amount, next_action, next_action_at, current_step_id, owner_id, snoozed_until, responsable:profiles!card_placements_owner_id_fkey(id, full_name, avatar_url), affaire:cards!inner(id, title, description, currency, created_at, etiquettes:card_labels(etiquette:labels(id, name, color, archived_at)))'

/**
 * `CRM-069` T2 (docs/DESIGN_SYSTEM.md §5.73) : la même lecture, filtrée par une étiquette. Le second plongement, `!inner`,
 * ne rapporte rien à l'écran : il borne au serveur les rattachements à ceux dont l'affaire porte l'étiquette, AVANT la
 * pagination et le compte (§12.5) ; le premier rapporte toutes les étiquettes de l'affaire.
 */
export const COLONNES_RATTACHEMENT_LISTE_PAR_ETIQUETTE =
	'id, amount, next_action, next_action_at, current_step_id, owner_id, snoozed_until, responsable:profiles!card_placements_owner_id_fkey(id, full_name, avatar_url), affaire:cards!inner(id, title, description, currency, created_at, etiquettes:card_labels(etiquette:labels(id, name, color, archived_at)), filtre:card_labels!inner(label_id))'

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
