# Spécification — Moteur de workflow

Unités de backlog : `CRM-030` à `CRM-034` (voir `docs/BACKLOG.md`).
Documents liés : `docs/SCHEMA.md` §3, `docs/SPEC-permissions-rls.md`,
`docs/SPEC-form-composer.md`, `docs/DESIGN_SYSTEM.md` §5.1–5.2.

---

## 1. Intention

Un workflow décrit les états possibles d'une card et **les déplacements autorisés entre ces
états**. Chaque channel suit un workflow ; deux channels d'un même track peuvent en suivre des
différents.

Trois exigences dictent la conception :

1. On assemble un workflow **à partir de nœuds** issus d'un catalogue partagé — c'est ce qui rend
   comparable le temps passé en « Relance » d'un channel à l'autre.
2. On crée des **workflows globaux**, on les **copie dans un track** pour les y modifier, et
   chaque channel choisit parmi ceux disponibles dans son track.
3. Un déplacement non prévu est **refusé par le backend**, pas seulement masqué dans l'interface.

## 2. Catalogue de nœuds

Le catalogue (`workflow_nodes_catalog`) est propre à un workspace. Chaque nœud porte une clé
stable, un libellé, un type (`open`, `won`, `lost`), une couleur, une probabilité par défaut et
un seuil de relance par défaut.

Catalogue initial livré par le seed :

| Clé | Libellé | Type | Probabilité | Seuil de relance |
|---|---|---|---|---|
| `prospection` | Prospection | `open` | 10 % | 14 j |
| `relance` | Relance | `open` | 20 % | 7 j |
| `negociation` | Négociation | `open` | 50 % | 10 j |
| `signature` | Signature | `open` | 90 % | 7 j |
| `realisation` | Réalisation | `open` | 100 % | 30 j |
| `livre` | Livré | `won` | 100 % | — |
| `perdu` | Perdu | `lost` | 0 % | — |

Le type `won` / `lost` est ce qui rend l'analytique de conversion possible sans convention
implicite sur les libellés.

**Archivage.** Un nœud n'est jamais supprimé. Son archivage est **refusé tant qu'une card active
s'y trouve** ; l'administrateur doit d'abord déplacer ces cards. Ce choix évite de casser
l'historique et les statistiques.

## 3. Workflow, étapes, transitions

Un workflow est une sélection de nœuds (`workflow_steps`) et un ensemble d'arêtes
(`workflow_transitions`).

- Une étape référence exactement un nœud du catalogue, une seule fois par workflow.
- Une étape peut surcharger localement le libellé, la probabilité et le seuil de relance ;
  la clé et le type restent ceux du catalogue.
- **Exactement une étape initiale** par workflow (`is_initial`). Toute card créée y démarre.
- Les transitions sont orientées. Les **cycles sont autorisés** (Négociation → Relance) ainsi
  que les raccourcis vers un nœud terminal (n'importe quelle étape ouverte → Perdu).
- Une transition peut exiger un commentaire (`require_comment`) et des champs supplémentaires
  (`require_fields`).

### Workflow par défaut livré par le seed

```
Prospection ──▶ Relance ◀──▶ Négociation ──▶ Signature ──▶ Réalisation ──▶ Livré
     │             │              │              │
     └─────────────┴──────────────┴──────────────┴────────────────────────▶ Perdu
```

Transitions déclarées : la progression linéaire, le retour Négociation ⇄ Relance, et le passage
vers Perdu depuis les quatre premières étapes. **Réalisation → Perdu n'est pas déclaré** : une
affaire signée qui échoue relève d'un autre traitement, à arbitrer si le besoin apparaît.

## 4. Portée et dérivation

| Portée | `track_id` | Disponible pour |
|---|---|---|
| `global` | nul | tous les channels du workspace |
| `track` | renseigné | uniquement les channels de ce track |

`copy_workflow_to_track(workflow_id, track_id)` duplique un workflow global, ses étapes, ses
transitions et ses champs de formulaire vers un track, en renseignant `derived_from_workflow_id`
et `derived_at`.

**La copie est une divergence assumée**, conforme au geste demandé : une modification ultérieure
du workflow global ne se propage pas. L'interface signale la situation — « ce workflow dérive de
*X*, modifié depuis le *jj/mm/aaaa* » — et propose de comparer, sans jamais réappliquer
automatiquement.

*Écart relevé et assumé* : la convention générale privilégie la surcharge à la duplication
(`CLAUDE.md` §4). Le responsable a explicitement demandé une copie modifiable. La traçabilité
d'origine est la contrepartie retenue ; l'écart est consigné dans `docs/JOURNAL.md`.

### Contrainte d'affectation

Un trigger sur `channels` vérifie que `workflow_id` désigne un workflow `global` du même
workspace **ou** un workflow `track` rattaché au track du channel. Toute autre valeur est
refusée. La même vérification s'applique lors du déplacement d'un channel vers un autre track.

## 5. Garde centrale : `move_card`

Toute écriture de `cards.current_step_id` passe par cette fonction. La mise à jour directe de la
colonne est refusée aux clients par les politiques RLS.

```
move_card(card_id uuid, to_step_id uuid, comment text default null)
```

Vérifications, dans l'ordre, chacune levant une exception explicite :

| # | Vérification | Message |
|---|---|---|
| 1 | La card existe et n'est ni archivée ni supprimée | `card_not_found` |
| 2 | L'appelant a le droit d'écriture sur le channel | `forbidden` |
| 3 | L'étape cible appartient au workflow de la card | `step_not_in_workflow` |
| 4 | Une transition est déclarée de l'étape courante vers la cible | `transition_not_allowed` |
| 5 | Le commentaire est fourni si la transition l'exige | `comment_required` |
| 6 | Les champs requis de l'étape cible sont renseignés | `missing_required_fields` (liste des clés) |

En cas de succès : mise à jour de `current_step_id`, réinitialisation de `entered_step_at`,
écriture d'un `card_event` de type `moved`, insertion du commentaire s'il est fourni, arrêt des
cadences de relance si l'étape cible est terminale.

La fonction est `SECURITY DEFINER`, avec `search_path` fixé, accordée au seul rôle
`authenticated`.

## 6. Changement de channel

Une card change de channel — donc potentiellement de workflow — par
`move_card_to_channel(card_id, channel_id, step_mapping)`. Le remappage est **explicite** :
l'appelant fournit l'étape de destination. Si le workflow cible est identique, l'étape est
conservée par défaut. L'opération écrit un `card_event` de type `channel_changed` conservant
l'ancien et le nouveau contexte.

Il n'y a pas de remappage automatique par clé de nœud : deux workflows peuvent partager une clé
sans que le déplacement soit sémantiquement équivalent.

## 7. Interface

- Le board affiche une colonne par étape, ordonnée par `position`.
- Le menu d'actions d'une card liste **exactement** les transitions déclarées depuis son étape
  courante, avec leur libellé.
- Le glisser-déposer vers une colonne non atteignable est refusé visuellement **et** ne déclenche
  aucun appel : la liste des transitions autorisées est connue du client.
- Un refus du backend replace la card et affiche la raison exacte (transition interdite, champs
  manquants avec leur libellé, droit insuffisant).
- L'éditeur de workflow est réservé aux administrateurs : sélection des nœuds, ordre, arêtes,
  surcharges, et champs de formulaire.

## 8. Vérification exigée

| Niveau | Preuves attendues |
|---|---|
| pgTAP | Transition déclarée acceptée ; transition non déclarée refusée ; champ requis manquant refusé ; commentaire exigé absent refusé ; étape hors workflow refusée ; unicité de l'étape initiale ; refus d'archivage d'un nœud occupé |
| API | Appel direct de `move_card` avec le jeton d'un `viewer` → refusé ; mise à jour directe de `cards.current_step_id` par PostgREST → refusée |
| E2E | Parcours complet Prospection → Livré par l'interface ; tentative de glisser-déposer interdite ; message d'erreur de champ requis affiché et compréhensible |
| Visuel | Board aux quatre paliers responsive, colonne vide, card figée au-delà du seuil, menu de transitions |

## 9. Points ouverts

1. **Réalisation → Perdu** non déclaré dans le workflow par défaut : à confirmer par le
   responsable.
2. **Suppression d'une transition** encore empruntée par des cadences ou des automatisations :
   comportement à définir (refus, ou avertissement).
