// @spec CRM-041 (docs/BACKLOG.md) — les colonnes demandées par les quatre lectures du board
// @spec CRM-022 (docs/BACKLOG.md) — responsable embarqué, sans requête par card
// @spec docs/SPEC-workflow-engine.md §7.2 (ce que le board lit, et en combien de requêtes)
// @spec docs/SPEC-cards.md §2.6 (ordre dans une colonne) ; docs/SPEC-types.md §4
//
// CE MODULE N'IMPORTE RIEN, ET C'EST TOUT SON OBJET.
//
// Les quatre chaînes `select` du board doivent être exercées des **deux** côtés : par le test
// unitaire, qui vérifie la requête que le module de composition construit, et par la preuve d'API,
// qui vérifie que la pile réelle rend bien ce que ces colonnes demandent. Or la preuve d'API
// appartient à un autre projet TypeScript (`tsconfig.tools.json`), qui n'a ni `vite/client`, ni
// les types du DOM : importer `board.ts` depuis `e2e/` fait échouer la compilation sur
// `webapp/src/lib/supabase.ts`, mesuré.
//
// Les recopier dans la preuve d'API aurait été la solution facile — et elle aurait prouvé qu'une
// requête quelconque fonctionne, pas que **celle du produit** fonctionne. C'est le procédé déjà
// retenu par `CRM-037` pour son tableau de cas partagé (`webapp/src/lib/valeur-renseignee.ts`) :
// une seule déclaration, atteignable des deux côtés.

/**
 * Étapes du workflow, avec leur nœud **embarqué côté serveur**.
 *
 * La jointure est demandée à PostgREST plutôt que recomposée : le libellé, la couleur et le seuil
 * par défaut vivent dans le catalogue, et les rapporter séparément obligerait à une seconde
 * requête et à un appariement que la base fait mieux (§7.2).
 */
export const COLONNES_ETAPE =
	'id, position, label_override, stale_after_days, workflow_nodes_catalog(label, color, kind, default_stale_after_days)'

/** Transitions du workflow : l'index des gestes atteignables (§7.5). */
export const COLONNES_TRANSITION = 'id, from_step_id, to_step_id, label, require_comment'

/**
 * Cards affichées sur une carte de board.
 *
 * `description`, `probability_override`, `health_score` et les horodatages de création ne sont pas
 * demandés : une requête ne rapporte que ce qui est affiché. `owner_id` et son profil sont en
 * revanche embarqués par la FK : `CRM-022` rend enfin l'identité d'équipe lisible, sans seconde
 * requête ni identifiant technique à l'écran.
 *
 * `snoozed_until` a rejoint la liste avec la tranche 2 b de `CRM-081` : le board masque par défaut
 * les affaires en sommeil et les marque lorsqu'il les montre (docs/SPEC-cards.md §16.12), ce qu'il
 * ne peut faire sans lire la colonne. Elle est lue une fois pour les deux usages.
 */
export const COLONNES_CARD_BOARD =
	'id, title, position, amount, currency, next_action, current_step_id, entered_step_at, email_local_part, owner_id, snoozed_until, responsable:profiles!cards_owner_id_fkey(id, full_name, avatar_url)'

/**
 * Champs du workflow, réduits à ce qui traduit un refus.
 *
 * `move_card` rapporte les **clés** des champs manquants dans son `DETAIL` (décision 126) ; le
 * board les rend par leur libellé (§7.10). Rien d'autre de ces champs n'est affiché sur un board.
 */
export const COLONNES_CHAMP_LIBELLE = 'key, label'
