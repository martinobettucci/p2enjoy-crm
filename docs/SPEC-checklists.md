# Checklists et modèles de cards — `CRM-068`

*Proposé le 2026-10-26, écrit avant toute ligne de code (`CLAUDE.md` §5), sur les arbitrages de la décision 747 ; les trois
questions du §9 tranchées le même jour (décision 748, options A).*

Documents liés : `docs/SPEC-rattachements.md` (une affaire, plusieurs rattachements ; les valeurs de champ appartiennent
au rattachement), `docs/SPEC-workflow-engine.md` (étapes, transitions, champs exigés, éditeur), `docs/SPEC-cards.md`
§18 (« Nouvelle affaire »), `docs/SPEC-modeles-emails.md` §1 (les modèles d'emails sont un autre objet),
`docs/SPEC-mcp.md` §6.1, §9.2.

## 1. Les arbitrages (décision 747)

1. **Checklists, trois formes** : des points ajoutés à la main sur une affaire ; des points définis par une **étape** du
   workflow et ajoutés à l'affaire quand elle y entre ; une **transition** qui exige des points cochés pour être franchie.
2. **Modèles de cards, deux gestes** : des modèles stockés qui préremplissent une affaire neuve au geste « Nouvelle
   affaire » ; et « Enregistrer comme modèle » depuis une affaire existante.
3. **Connecteur MCP** : les checklists seules, dans la famille existante **`affaires`** — lire les points d'une affaire
   (`consulter`) et les cocher (`modifier`). Les modèles restent un geste d'écran. Aucune famille, aucune case nouvelles.

## 2. Où vit un point — la conséquence des rattachements

Une étape appartient à un workflow, et une affaire est à une étape **par rattachement** (`docs/SPEC-rattachements.md`
§3). Donc :

- **un point d'étape appartient au rattachement** qui est entré dans l'étape, comme une valeur de champ (§3.3 de cette
  spécification-là) ;
- **un point libre appartient à l'affaire**, dans sa partie commune : il ne dépend d'aucun workflow.

La fiche montre les points libres dans la partie commune, et les points d'étape dans le bloc de leur rattachement.

## 3. Le modèle — tables nouvelles (noms anglais, décision 658)

### 3.1 `public.workflow_step_checklist_items` — les points définis par une étape

| Colonne | Règle |
|---|---|
| `id` | PK |
| `workspace_id`, `workflow_id`, `step_id` | non nuls ; `(step_id, workflow_id) → workflow_steps` `on delete cascade` |
| `label` | non vide après `app.btrim_blancs`, 200 caractères au plus |
| `position` | ordre dans l'étape |
| `archived_at` | un point archivé n'est plus ajouté aux affaires qui entrent dans l'étape ; ceux déjà copiés restent |
| `created_by`, `created_at`, `updated_at` | posés par la base |

Écriture : **administrateur de l'espace**, comme le reste de l'éditeur de workflows. Lecture : tout membre qui lit le
workflow.

### 3.2 `public.card_checklist_items` — les points d'une affaire

| Colonne | Règle |
|---|---|
| `id` | PK |
| `workspace_id`, `card_id` | non nuls ; `(card_id, workspace_id) → cards` `on delete cascade` |
| `placement_id` | **nul pour un point libre** ; sinon `→ card_placements` `on delete cascade` |
| `step_item_id` | nul pour un point libre ; sinon `→ workflow_step_checklist_items` `on delete set null` ; `UNIQUE (placement_id, step_item_id)` |
| `label` | copié du point d'étape à l'ajout, ou saisi ; mêmes règles qu'au §3.1 |
| `position` | ordre |
| `checked_at`, `checked_by` | posés par la base au cochage, effacés au décochage ; `checked_by` FK `profiles` `on delete set null` |
| `created_by`, `created_at`, `updated_at` | posés par la base |

Contraintes : un point d'étape a un rattachement **et** un point d'étape d'origine ; un point libre n'a ni l'un ni
l'autre (`check`).

Écriture : qui **écrit l'affaire** (`app.can_write_card`) coche, décoche, ajoute et retire un **point libre** ; il coche
et décoche un **point d'étape**, mais ne le renomme ni ne le retire — sa forme appartient à l'étape. Lecture : qui lit
l'affaire. `checked_at` et `checked_by` sont fermés au client (privilèges de colonne), posés par un déclencheur.

### 3.3 L'ajout des points d'étape — par la base

Un déclencheur sur `card_placements` (insertion, et changement de `current_step_id`) ajoute au rattachement les points
**non archivés** de sa nouvelle étape qu'il ne porte pas encore. Revenir dans une étape ne duplique rien
(`UNIQUE`), et les points cochés le restent. Changer de channel ou de workflow (`move_card_to_channel`,
`change_channel_workflow`) ajoute les points de l'étape d'arrivée ; les points de l'ancien workflow restent sur le
rattachement, en lecture, sous leur étape d'origine.

### 3.4 Les points exigés par une transition

`public.workflow_transition_required_checklist_items` (`transition_id`, `step_item_id`, PK composite) : une transition
exige que ces points soient **cochés sur le rattachement** pour être franchie. Les points exigés sont ceux de
l'**étape de départ** de la transition (Q3) — un point d'une autre étape pourrait n'avoir jamais été ajouté ; la base le
garantit (un déclencheur refuse une exigence d'une autre étape, `22023 checklist_item_not_from_source_step`).

`move_card` refuse alors en `P0001 checklist_incomplete`, avec la liste des points manquants dans le détail, **après**
les champs exigés : les deux refus se lisent ensemble au board et sur la fiche, comme aujourd'hui pour les champs
(`docs/SPEC-workflow-engine.md` §5.3). Un point d'étape **archivé** reste exigé tant que la transition l'exige : l'écran
de l'éditeur le dit (comme une exigence sur une question archivée, `docs/DESIGN_SYSTEM.md` §5.15).

### 3.5 `public.card_templates` — les modèles de cards

| Colonne | Règle |
|---|---|
| `id` | PK |
| `workspace_id`, `workflow_id` | non nuls ; un modèle sert les channels d'un workflow, parce que ses valeurs répondent aux questions de ce workflow |
| `name` | non vide, unique par espace parmi les modèles non archivés |
| `title`, `description`, `amount`, `currency` | ce que le modèle préremplit ; titre facultatif (le formulaire le demande toujours) |
| `field_values` | `jsonb` `{field_key: valeur}`, validé contre les champs du workflow à l'écriture |
| `checklist` | `jsonb` liste de libellés — des **points libres** ajoutés à l'affaire créée |
| `archived_at` | un modèle archivé n'est plus proposé |
| `created_by`, `created_at`, `updated_at` | posés par la base |

Écriture : **administrateur de l'espace** (Q1). Lecture : tout membre.

### 3.6 Les gestes en base

- `public.creer_affaire(...)` gagne `p_template uuid default null` : l'affaire est créée avec le titre saisi, puis
  reçoit la description, le montant, les valeurs de champ et les points libres du modèle. Un modèle d'un autre workflow
  que le channel visé est refusé (`22023 template_workflow_mismatch`).
- `public.save_card_as_template(p_placement uuid, p_name text)` : crée un modèle depuis un rattachement — son workflow,
  le titre, la description, le montant, les valeurs de champ du rattachement et les **libellés de tous ses points**
  (libres et d'étape, devenus libres dans le modèle). Les cochages ne sont pas repris.
- Les points se cochent par `update` sous RLS (`checked_at` posé par la base) ; aucune fonction n'est nécessaire.
- **Le fil** (Q2) : un déclencheur écrit `checklist_checked` ou `checklist_unchecked` dans `card_events` — famille
  « Champs » du fil, avec l'acteur et le libellé du point —, sur le rattachement pour un point d'étape, sur l'affaire pour
  un point libre. Les deux types entrent dans la liste fermée de `card_events.type`.

## 4. Écrans

- **Fiche d'affaire** : un bloc « Checklist » dans la partie commune (points libres, « Ajouter un point ») ; dans chaque
  bloc de rattachement, sa checklist d'étape, groupée par étape d'origine, l'étape courante d'abord. Un point est une case
  native de 24 px (`docs/DESIGN_SYSTEM.md` §5.7 bis) ; cochée, elle dit par qui et quand. Le compte « 3 sur 5 » en titre.
  Un point **exigé** par une transition sortante porte la mention « Exigé pour passer à {étape} » (§5.7, même forme que
  le champ exigé).
- **Board** : la carte d'une affaire dont l'étape a des points porte « 3/5 » à côté de son ancienneté ; un déplacement
  refusé pour checklist incomplète le dit dans le bandeau de refus et mène à la fiche (`docs/DESIGN_SYSTEM.md` §5.7 quater).
- **Éditeur de workflows** : un bloc « Checklists des étapes » (ajouter, renommer, réordonner, archiver un point par
  étape), et dans le bloc des exigences de transition, les points exigés à côté des champs exigés.
- **Réglages ▸ Modèles d'affaires** : liste par workflow, création, modification, archivage ; le formulaire montre les
  questions du workflow choisi.
- **« Nouvelle affaire »** : un `select` « Modèle », option vide en tête, les modèles du workflow du channel.
- **Fiche** : « Enregistrer comme modèle » dans le bloc d'un rattachement, demande un nom.

`docs/DESIGN_SYSTEM.md` est complété avant le code de chaque écran, après sa relecture intégrale ; le manuel reçoit un
chapitre « Checklists » et une section « Modèles d'affaires ».

## 5. Connecteur MCP — famille `affaires`

Deux outils au catalogue (`docs/SPEC-mcp.md` §9.2) : `crm_card_checklist_list` (`consulter`) rend les points d'une
affaire, libres et par rattachement, avec leur état et les exigences de transition ; `crm_card_checklist_set`
(`modifier`) coche ou décoche un point ; le fil en garde la trace, comme pour un geste d'écran (Q2). Aucun ajout,
renommage ni retrait par le connecteur.

## 6. Seed

Le workflow par défaut reçoit des points sur deux étapes (par exemple « Qualification » : « Besoin confirmé »,
« Décideur identifié » ; « Proposition » : « Proposition envoyée »), dont un exigé par la transition vers
« Négociation » ; trois affaires portent des points cochés et non cochés, dont une bloquée par l'exigence ; deux points
libres ; deux modèles d'affaires, dont un créé par « Enregistrer comme modèle ». Le tout par les vraies fonctions.

**Précisé le 2026-10-26 (décision 755)** : l'exigence n'est **pas** posée sur le workflow par défaut. Une quinzaine de
preuves (pgTAP, API, interface) y déplacent des affaires de Relance vers Négociation, et une exigence bloquerait tout
rattachement qui n'a pas coché le point. Le workflow par défaut reçoit les points d'étape **sans exigence** ; l'exigence,
les trois affaires et les deux points libres vivent dans un **channel de démonstration** du track `studio-web`, dont le workflow est dédié
(`docs/SPEC-seed.md` §28).

## 7. Tranches

- **T1 — le modèle des checklists** : les trois tables de checklists, RLS, privilèges de colonne, déclencheurs (ajout à
  l'entrée dans l'étape, cochage), pgTAP. *Le seed des points est passé en T3, avec les écrans qui le montrent (livraison
  de T1, 2026-10-26).*
- **T2 — l'exigence de transition** : `move_card` et son refus, le bandeau du board ; pgTAP, API, E2E.
- **T3 — l'écran de la fiche et du board** : blocs, cases, compte, mention d'exigence ; l'éditeur de workflows pour les
  points d'étape et les exigences ; le seed des points. *Découpée en T3a (fiche, board, seed) et T3b (éditeur de
  workflows), le 2026-10-26.*
- **T4 — les modèles de cards** : table, `creer_affaire` étendue, `save_card_as_template`, Réglages, « Nouvelle
  affaire », « Enregistrer comme modèle ».
- **T5 — le connecteur** : les deux outils, leurs tests unitaires et d'intégration.

## 8. Preuves attendues

pgTAP par tranche (RLS, privilèges de colonne, déclencheurs, refus `checklist_incomplete`, `template_workflow_mismatch`) ;
API avec les jetons réels (la lectrice ne coche pas, le business developer coche ; un point d'étape ne se retire pas) ;
unitaires ; E2E au clavier et aux quatre paliers, captures observées ; `scripts/verify-checklists.sh`.

## 9. Questions au responsable — tranchées (décision 748)

- **Q1** : les modèles d'affaires sont gérés par l'**administrateur de l'espace** (option A).
- **Q2** : cocher ou décocher un point **laisse une trace dans le fil** (option A).
- **Q3** : une transition n'exige que des points de son **étape de départ** (option A).
