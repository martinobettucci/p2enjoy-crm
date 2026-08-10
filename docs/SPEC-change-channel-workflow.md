# Spécification — Changer le workflow d'un channel entier

Unité de backlog : `CRM-019`.
Documents liés : `docs/SCHEMA.md` §5 et §9, `docs/SPEC-workflow-engine.md` §6,
`docs/SPEC-cards.md` §2.4 et §14, `docs/SPEC-permissions-rls.md` §4,
`docs/PROD_MIGRATIONS.md` §3, `docs/JOURNAL.md` décisions 263, 295 et 306,
`docs/INCONSISTENCY_REPORT.md` INC-046 et INC-073.

Cette spécification ferme le contrat avant le code. Elle ne confond pas le geste avec
`move_card_to_channel` : cette dernière déplace une card vers un autre channel ; la fonction
décrite ici conserve le channel et remplace son workflow ainsi que l'étape de **toutes** ses cards
dans une transaction.

---

## 1. Frontière et signature

```sql
public.change_channel_workflow(
  channel_id uuid,
  workflow_id uuid,
  step_mapping jsonb,
  discard_field_values boolean default false
) returns setof public.cards
```

Les trois premiers arguments portent le geste décidé. Le quatrième ne rend aucune perte implicite :
il reste à `false` et reprend la doctrine déjà mesurée pour `move_card_to_channel`. Les appels à
trois arguments restent donc valides, mais refusent si des réponses de formulaire seraient perdues.

La fonction rend toutes les cards remappées, y compris archivées ou en corbeille, triées par
`current_step_id`, `position`, puis `id`. Un channel vide rend `200` et `[]` après avoir réellement
changé de workflow. Rejouer le geste vers le workflow déjà en place est refusé par `same_workflow` :
ce n'est ni une simulation de succès ni une opération de réparation.

Il n'existe pas encore de geste d'administration des workflows dans l'interface (`CRM-076`). La
preuve utilisateur de cette unité est donc une requête API authentifiée avec le vrai JWT de
l'administratrice, comme pour les autres opérations d'administration backend déjà livrées.

## 2. Forme exacte du mapping

`step_mapping` est un tableau JSON, éventuellement vide, dont chaque élément porte **exactement**
les deux clés suivantes et deux chaînes UUID :

```json
[
  {
    "from_step_id": "00000000-0000-0000-0000-000000000001",
    "to_step_id": "00000000-0000-0000-0000-000000000002"
  }
]
```

Un objet JSON indexé par UUID n'est pas retenu : JSONB normalise les clés identiques et rendrait
un doublon de source indétectable, alors que la décision 295 exige son refus. Les règles sont :

1. chaque étape source **occupée par au moins une card du channel** apparaît exactement une fois ;
2. aucune étape source inoccupée ou étrangère au workflow courant n'est ajoutée ;
3. chaque cible appartient au nouveau workflow ;
4. plusieurs sources peuvent viser la même cible — changer vers un graphe plus court doit pouvoir
   regrouper deux colonnes ;
5. pour un channel vide, le seul mapping exhaustif est `[]`.

L'ensemble des `from_step_id` doit donc être strictement égal à l'ensemble des étapes réellement
occupées. La fonction ne complète jamais une source, ne choisit jamais la première étape du graphe
cible et ne remappe jamais par clé de nœud, même lorsque les deux workflows semblent identiques.

## 3. Autorisation, visibilité et compatibilité

Changer le workflow du contenant est une opération d'administration : l'appelant doit être
administrateur du workspace du channel. Un droit `write` sur le seul channel ne suffit pas.

L'ordre des contrôles est stable :

1. un channel absent ou hors du workspace visible rend `channel_not_found` ;
2. un membre du même workspace qui n'est pas administrateur rend `forbidden` (`42501`) ;
3. un workflow absent, archivé ou d'un autre workspace rend `workflow_not_found` ;
4. un workflow de portée `track` lié à un autre track rend `workflow_not_compatible` (`23514`) ;
5. le workflow courant rend `same_workflow` ;
6. une forme JSON autre qu'un tableau exact d'objets UUID rend `invalid_step_mapping` ;
7. une source répétée rend `step_mapping_duplicate` ;
8. un ensemble de sources différent de l'ensemble occupé rend `step_mapping_incomplete` ;
9. une cible qui n'appartient pas au nouveau workflow rend `step_not_in_workflow` ;
10. des réponses existantes sans opt-in rendent `field_values_would_be_lost`, avec le nombre exact
    de réponses dans `DETAIL`.

Un workflow global actif du workspace est compatible. Un workflow `track` actif ne l'est que si
son `track_id` est celui du channel. Les cartes archivées et celles en corbeille comptent dans
l'occupation et sont remappées : les ignorer laisserait des lignes structurellement invalides.

## 4. Atomicité, concurrence et intégrité

La clé `cards_channel_id_workflow_id_fkey` reste la garantie permanente que chaque card suit le
workflow de son channel, mais devient `DEFERRABLE INITIALLY IMMEDIATE`. Elle continue donc à
refuser immédiatement toute écriture ordinaire incohérente. La RPC seule la diffère le temps de
mettre à jour le channel et toutes ses cards, puis la force avant de rendre.

La fonction verrouille le channel, le workflow cible, les étapes cibles et toutes les cards du
channel avant validation. Une création ou une modification concurrente ne peut pas se glisser
entre la lecture du mapping et l'écriture. Tous les contrôles et toutes les suppressions ont lieu
dans la même transaction que les mises à jour : un refus quelconque conserve le channel, les
cards, leurs positions, leurs réponses, commentaires et événements exactement comme avant.

## 5. Écriture et perte explicite

Pour chaque card :

| Colonne | Valeur après succès |
|---|---|
| `channel_id` | inchangée |
| `workflow_id` | workflow cible |
| `current_step_id` | cible explicite de sa source |
| `entered_step_at` | `now()` — un remappage entre graphes est une entrée dans une autre étape |
| `position` | rang dense à partir de 1 dans la cible |
| `updated_at` | maintenue par `app.set_updated_at()` |

Lorsque plusieurs sources convergent, l'ordre est déterministe : position de l'étape source dans
l'ancien workflow, ancienne `position`, puis `id`. Toutes les cards du channel étant incluses, ce
rang reconstitue entièrement chaque colonne cible sans dépendre d'un état partiel.

Les réponses de formulaire appartiennent à l'ancien workflow. Elles ne sont jamais remappées par
clé et sont supprimées avant le changement **uniquement** si `discard_field_values = true`. Les
commentaires et la timeline survivent. Le nombre annoncé par le refus porte sur toutes les réponses
du channel, sans distinction entre cards actives, archivées ou en corbeille.

## 6. Mémoire de l'affaire

Chaque card remappée écrit exactement un événement `workflow_changed` :

```json
{
  "channel_id": "…",
  "from_workflow_id": "…",
  "to_workflow_id": "…",
  "from_step_id": "…",
  "to_step_id": "…"
}
```

Le trigger de `cards` reste l'unique auteur. Ses gestes sont exclusifs :

- `channel_changed` si `channel_id` change ;
- sinon `workflow_changed` si `workflow_id` change ;
- sinon `moved` si `current_step_id` change.

Ainsi, un remappage entre deux graphes ne prétend pas avoir franchi une arête qui n'existe pas.
L'interface de timeline reconnaît `channel_changed` et `workflow_changed` dans la famille
« Organisation », distincte du cycle de vie conformément à la décision 298, et rend un libellé
français même lorsqu'aucun nom historique de workflow n'est résoluble.

## 7. Privilèges

La fonction est `SECURITY DEFINER`, propriétaire `postgres`, avec `search_path = ''`. `EXECUTE` est
révoqué de `public` et nommément de `anon`, puis accordé à `authenticated` et `service_role`.
L'autorisation métier reste contrôlée dans la fonction : le caractère definer sert uniquement à
écrire les colonnes protégées et à différer la contrainte, jamais à remplacer le contrôle admin.

## 8. Preuves obligatoires

| Niveau | Preuves |
|---|---|
| pgTAP | signature, retour, propriétaire, `search_path`, ACL, FK différable mais initialement immédiate, dixième type d'événement, trigger exclusif, refus de chaque branche, channel vide, regroupement plusieurs-vers-une, archived/trashed inclus, positions, perte explicite, retour et atomicité |
| API | vrais JWT admin/business developer/viewer : succès complet, refus d'autorisation et de visibilité, mapping absent/supplémentaire/doublé/mal formé, cible étrangère, réponses conservées sur refus puis détruites avec opt-in, événement et réponse `SETOF` |
| Harnais | migration legacy sur base seedée, dégradation réelle de la contrainte, de la garde d'autorisation, du trigger, de l'ACL et du mapping ; chaque rouge est constaté puis l'état exact est restauré |
| Interface | suite Chromium complète après production build ; timeline capable de rendre le nouveau type ; zéro `console.warn`, `console.error` ou `pageerror`. Le geste d'administration lui-même reste hors interface jusqu'à `CRM-076` |

## 9. Déploiement et retour arrière

Avant application, inventorier les appels qui modifient directement `channels.workflow_id` : ils
restent refusés dès qu'une card existe et doivent employer la RPC. La migration n'altère aucune
donnée métier tant que la fonction n'est pas appelée.

Le retour arrière de la fonction et du caractère différable de la clé est non destructif si aucun
appel n'a eu lieu. Revenir de dix à neuf types impose en revanche de supprimer les événements
`workflow_changed` déjà écrits sous `postgres`, donc de détruire une mémoire d'affaire. Une
sauvegarde de `card_events` est obligatoire ; en exploitation normale, on conserve le vocabulaire
étendu même si la RPC est retirée.
