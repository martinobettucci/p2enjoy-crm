// @spec CRM-041 (docs/BACKLOG.md) — les colonnes demandées par les quatre lectures du board
// @spec CRM-066 (docs/BACKLOG.md) — tranche 4 : les deux scores de santé lus avec la carte — docs/SPEC-analytique.md §13.5
// @spec CRM-022 (docs/BACKLOG.md) — responsable embarqué, sans requête par card
// @spec docs/SPEC-workflow-engine.md §7.2 (ce que le board lit, et en combien de requêtes)
// @spec docs/SPEC-cards.md §2.6 (ordre dans une colonne) ; docs/SPEC-types.md §4
// @spec CRM-095 (docs/BACKLOG.md) — tranche T2 : l'étape initiale lue avec les colonnes
//       (docs/SPEC-cards.md §18.3, docs/DESIGN_SYSTEM.md §5.2)
// @spec CRM-105 (docs/BACKLOG.md) — `description` lue pour l'infobulle du titre de la carte
//       (docs/SPEC-workflow-engine.md §7.2, docs/DESIGN_SYSTEM.md §5.58, décision 629)
// @spec CRM-068 (docs/BACKLOG.md) — tranche T3a : les points de checklist du rattachement, pour le compte de la carte
//       (docs/SPEC-checklists.md §4, docs/DESIGN_SYSTEM.md §5.70)
// @spec CRM-111 (docs/BACKLOG.md) — tranche T2.4.1 : le board lit les RATTACHEMENTS du channel, l'affaire en plongement
//       (docs/SPEC-rattachements.md §8, §14)
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
 *
 * `is_initial` a rejoint la liste avec `CRM-095` tranche T2 (docs/SPEC-cards.md §18.3,
 * docs/DESIGN_SYSTEM.md §5.2) : la colonne de l'étape initiale, vide, porte l'action de création — une
 * affaire naît là et nulle part ailleurs. Le drapeau est lu, jamais déduit de la position.
 */
export const COLONNES_ETAPE =
	'id, position, is_initial, label_override, stale_after_days, workflow_nodes_catalog(label, color, kind, default_stale_after_days)'

/** Transitions du workflow : l'index des gestes atteignables (§7.5). */
export const COLONNES_TRANSITION = 'id, from_step_id, to_step_id, label, require_comment'

/**
 * Cards affichées sur une carte de board.
 *
 * `probability_override`, `health_score` et les horodatages de création ne sont pas demandés : une
 * requête ne rapporte que ce qui est affiché. `description` l'est depuis `CRM-105` : elle est
 * affichée, en infobulle sur le titre de la carte (docs/DESIGN_SYSTEM.md §5.58). `owner_id` et son profil sont en
 * revanche embarqués par la FK : `CRM-022` rend enfin l'identité d'équipe lisible, sans seconde
 * requête ni identifiant technique à l'écran.
 *
 * `snoozed_until` a rejoint la liste avec la tranche 2 b de `CRM-081` : le board masque par défaut
 * les affaires en sommeil et les marque lorsqu'il les montre (docs/SPEC-cards.md §16.12), ce qu'il
 * ne peut faire sans lire la colonne. Elle est lue une fois pour les deux usages.
 *
 * Le rattachement de l'affaire est lu depuis `CRM-111` T2.3.1 : le sommeil le désigne (docs/SPEC-rattachements.md §5,
 * `rattachements.ts`).
 */
// `health_momentum` et `health_commercial` — `CRM-066` tranche 4, docs/SPEC-analytique.md §13.5 : les deux scores de
// santé, colonnes calculées par la base, rendus avec la ligne (`null` pour une affaire décidée).
//
// `CRM-111` T2.4.1 : la requête part des RATTACHEMENTS du channel (`card_placements`) — étape, rang, montant, prochaine
// action, responsable, sommeil sont les siens — et plonge l'affaire (`affaire:cards!inner`) pour ce qui est commun :
// titre, description, devise, adresse, scores de santé. `!inner` fait du filtre sur la corbeille de l'affaire un filtre
// des rattachements. La forme rendue à l'écran est inchangée (`carteDepuisRattachement`, `board.ts`).
//
// `CRM-068` T3a (docs/DESIGN_SYSTEM.md §5.70) : les points de checklist du rattachement (`COLONNES_POINT_CARTE`), réduits à leur état et à l'étape
// de leur origine — la carte compte ceux de son étape courante ; rien d'autre de ces points n'est affiché.
/** `CRM-069` T2 (docs/DESIGN_SYSTEM.md §5.73) : les étiquettes de l'affaire sont plongées depuis `cards` par cette lecture. */
/** Un point de checklist pour le compte de la carte — plongé par la lecture du board, relu après un déplacement. */
export const COLONNES_POINT_CARTE = 'checked, origine:workflow_step_checklist_items(step_id)'

export const COLONNES_RATTACHEMENT_BOARD =
	'id, created_at, position, amount, next_action, current_step_id, entered_step_at, owner_id, snoozed_until, health_momentum, health_commercial, responsable:profiles!card_placements_owner_id_fkey(id, full_name, avatar_url), affaire:cards!inner(id, title, description, currency, email_local_part, etiquettes:card_labels(etiquette:labels(id, name, color, archived_at))), points:card_checklist_items!card_checklist_items_placement_id_fkey(checked, origine:workflow_step_checklist_items(step_id))'

/**
 * Champs du workflow, réduits à ce qui traduit un refus.
 *
 * `move_card` rapporte les **clés** des champs manquants dans son `DETAIL` (décision 126) ; le
 * board les rend par leur libellé (§7.10). Rien d'autre de ces champs n'est affiché sur un board.
 */
export const COLONNES_CHAMP_LIBELLE = 'key, label'
