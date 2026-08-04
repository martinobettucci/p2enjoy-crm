# Spécification — Moteur de workflow

Unités de backlog : `CRM-030` à `CRM-034` (voir `docs/BACKLOG.md`).
Documents liés : `docs/SCHEMA.md` §3, `docs/SPEC-permissions-rls.md`,
`docs/SPEC-form-composer.md`, `docs/SPEC-seed.md`, `docs/DESIGN_SYSTEM.md` §1, §5.1–5.2.

Le §2 a été **réécrit après mesure** lors de `CRM-030` ; les §3 à §9 datent de `CRM-000` et
n'engagent que l'intention, jusqu'à ce que les unités correspondantes les mesurent à leur tour.

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

## 2. Catalogue de nœuds — `CRM-030`

Le catalogue (`workflow_nodes_catalog`) est propre à un workspace. Chaque nœud porte une clé
stable, un libellé, un type (`open`, `won`, `lost`), une couleur, une probabilité par défaut et
un seuil de relance par défaut.

Ce chapitre a été **écrit après mesure**, et non de mémoire : une table sonde jetable portant la
structure et les politiques envisagées a été créée sur la pile réelle, interrogée avec les jetons
des trois comptes seedés obtenus par la véritable route de connexion, puis détruite — l'absence de
reste étant constatée (`to_regclass` nul, aucune fonction `app.sonde*`, aucun workspace de sonde).
Les valeurs chiffrées des §2.3 à §2.8 sont ces mesures.

### 2.1 Ce que le catalogue est, et ce qu'il n'est pas

Le catalogue est un **vocabulaire**, pas un workflow. Il ne dit ni l'ordre dans lequel une card
traverse les états, ni quels déplacements sont permis : cela relève de `workflow_steps` et de
`workflow_transitions` (§3). Il dit seulement **quels états ont un nom dans ce workspace**, et ce
que ce nom signifie pour l'analytique.

C'est ce qui rend comparable le temps passé en « Relance » d'un channel à l'autre : deux workflows
différents qui instancient le même nœud parlent du même état. Une étape peut en surcharger le
libellé, la probabilité et le seuil de relance ; **la clé et le type restent ceux du catalogue**,
faute de quoi la comparabilité serait perdue au premier renommage.

### 2.2 Modèle

Référence de schéma : `docs/SCHEMA.md` §3. Le tableau ci-dessous est celui de la table réellement
livrée, complété des `created_at` / `updated_at` que les conventions générales de `docs/SCHEMA.md`
exigent de toute table métier et que le §3 omettait — même omission que celle relevée pour
`tracks` et `channels` (INC-025).

| Colonne | Type | Contrainte |
|---|---|---|
| `id` | `uuid` | PK, `gen_random_uuid()` |
| `workspace_id` | `uuid` | non nul, FK `workspaces` `on delete cascade` |
| `key` | `text` | non nul, minuscules-chiffres-tirets, **unique par workspace** |
| `label` | `text` | non nul, non vide après `btrim` |
| `kind` | `text` | non nul, défaut `open`, `CHECK (kind in ('open','won','lost'))` |
| `color` | `text` | non nul, défaut `neutral`, jeton du design system |
| `default_probability` | `numeric(5,2)` | nullable, `CHECK (0 ≤ x ≤ 100)` |
| `default_stale_after_days` | `integer` | nullable, `CHECK (x > 0)` |
| `position` | `numeric` | non nul, attribuée si omise |
| `archived_at` | `timestamptz` | non nul = archivé |
| `created_at`, `updated_at` | `timestamptz` | `now()` ; `updated_at` maintenu par trigger |

`workspace_id` est porté directement, sans jointure : c'est la convention générale de
`docs/SCHEMA.md`, et ici elle ne coûte rien — le catalogue n'a pas de parent intermédiaire, donc
aucune dénormalisation ne peut mentir, contrairement à `channels.workspace_id` qui a exigé une clé
étrangère composite (`docs/SPEC-channels.md` §2.4).

**`color` est un nom de jeton, jamais un hexadécimal** — `docs/DESIGN_SYSTEM.md` §1, « Couleurs de
données ». Les cinq valeurs admises sont celles de `tracks` : `brand`, `success`, `accent`,
`danger`, `neutral`. Le défaut est `neutral` : un nœud qui n'a pas choisi sa couleur ne doit pas
revendiquer celle de la marque.

### 2.3 La clé stable

`key` est l'identifiant durable du nœud, celui sur lequel l'analytique s'appuie. Il est contraint
à la même forme que les slugs de `tracks` et de `channels` — `^[a-z0-9]+(-[a-z0-9]+)*$` — de sorte
qu'il reste utilisable dans une URL, un nom de colonne de rapport ou une clé de traduction.

**Mesuré**, sur la sonde : `prospection` et `relance-longue` acceptés ; `Majuscule`,
`deux--tirets`, `-debut`, `fin-`, `avec_underscore`, `accentué` et la chaîne vide refusés, chacun
par `sonde_wnc_key_check`.

L'unicité est **par workspace**, pas globale. **Mesuré** : la même clé insérée deux fois dans le
même workspace est refusée (`duplicate key value violates unique constraint`, détail nommant
`(workspace_id, key)`) ; la même clé dans un autre workspace est acceptée. Deux workspaces peuvent
donc avoir chacun leur `prospection` sans se gêner — c'est la condition pour que le catalogue soit
réellement « propre à un workspace ».

### 2.4 Ordre du catalogue

`position` ordonne l'affichage du catalogue dans l'écran d'administration. Sa portée est le
**workspace** : le catalogue est une liste unique par workspace, contrairement aux onglets de
channels dont la portée est le track (`docs/SPEC-channels.md` §3).

Le type est `numeric` et non `integer`, comme `tracks.position` et `channels.position` : insérer un
nœud entre deux autres n'exigera pas de renuméroter la liste entière.

La colonne est `NOT NULL` **sans défaut de colonne** ; un trigger `BEFORE INSERT` la renseigne
lorsqu'elle est omise, en plaçant le nœud en fin de liste de son workspace.

**Mesuré** : trois insertions sans `position` dans un workspace rendent `1`, `2`, `3` ; une
quatrième dans un **autre** workspace rend `1` — la numérotation redémarre bien par workspace ; une
valeur explicite (`42`) est conservée telle quelle. Écrire `position: null` équivaut à l'omettre :
un trigger `BEFORE INSERT` reçoit `new.position` à `NULL` dans les deux cas et ne peut pas les
distinguer. Propriété héritée de `CRM-020` et vérifiée à nouveau ici plutôt que supposée.

La contrainte `NOT NULL` protège en revanche les **mises à jour**, que le trigger ne couvre pas.

### 2.5 Probabilité et seuil de relance

`default_probability` est un pourcentage, exprimé de `0` à `100`. Il est **nullable** : un nœud
peut ne pas se prononcer, ce qui est différent de se prononcer à `0` — `perdu` vaut réellement
`0 %`, alors qu'un nœud d'un catalogue métier peut n'avoir aucune signification prévisionnelle.

`default_stale_after_days` est le nombre de jours au-delà duquel une card figée sur ce nœud est
signalée. Il est nullable, et **doit être nul pour un nœud terminal** : une affaire livrée ou
perdue n'est pas en retard. La contrainte livrée est `x > 0` — un seuil de zéro jour signalerait
toute card dès son arrivée, ce qui n'est jamais l'intention et masquerait l'absence de seuil sous
une valeur qui a l'air d'en être une.

**Mesuré, et contre-intuitif** : `numeric(5,2)` **arrondit avant** que la contrainte de valeur ne
soit évaluée. `99.999` est stocké `100.00` et **accepté**, `100.004` également ; `100.01` et
`-0.01` sont refusés. La contrainte `0 ≤ x ≤ 100` porte donc sur la valeur **arrondie**, jamais sur
celle que le client a envoyée. Le fait est nommé ici parce qu'un test qui insérerait `99.999` en
attendant `99.999` échouerait pour une raison qui n'a rien à voir avec la règle métier.

### 2.6 Archivage — et la garde qui n'est pas livrable aujourd'hui

Un nœud n'est **jamais supprimé** : `archived_at` le masque des sélecteurs, réversiblement.
Aucune suppression physique n'est exposée — ni politique `for delete`, ni privilège `DELETE`, de
sorte que le refus se manifeste dès le privilège. La suppression physique reste réservée aux purges
RGPD, qui passent par `service_role` (`docs/SCHEMA.md`, conventions générales).

L'intention complète est plus forte : **l'archivage doit être refusé tant qu'une card active se
trouve sur ce nœud**, l'administrateur devant d'abord déplacer ces cards. Ce refus évite de casser
l'historique et les statistiques.

**Cette garde n'est pas livrable par `CRM-030`.** Le chemin qui va d'un nœud à une card active
passe par `workflow_steps` (`CRM-031`) puis par `cards` (`CRM-040`). **Mesuré** :
`to_regclass('public.workflow_steps')`, `to_regclass('public.workflows')` et
`to_regclass('public.cards')` rendent tous les trois `NULL`.

Et l'écrire quand même serait pire que l'omettre. **Mesuré** : PostgreSQL **accepte la création**
d'une fonction PL/pgSQL référençant une table absente — le corps n'est pas analysé à la création —
et l'échec ne survient qu'au **premier appel**, en `relation "public.cards" does not exist`. Un
trigger d'archivage écrit aujourd'hui ne protégerait donc rien : il ferait échouer **toute** mise à
jour du catalogue, y compris un simple renommage, dès la livraison. C'est le même motif qu'INC-013
un cran plus loin.

Le comportement retenu est donc celui des unités précédentes face à la même situation : livrer ce
qui est démontrable, **nommer** ce qui ne l'est pas, et **figer l'écart par des assertions** qui
deviendront rouges le jour où les tables apparaîtront. Contradiction consignée en
`docs/INCONSISTENCY_REPORT.md`, **INC-031**.

### 2.7 Autorisations

`docs/SPEC-permissions-rls.md` §4 range `workflow_nodes_catalog` avec les tables d'organisation :
**lecture par les membres du workspace, écriture réservée à l'`admin`**. Un
`business_developer` travaille dans la structure, il ne la définit pas.

Trois politiques, aucune de suppression :

| Politique | Commande | Prédicat |
|---|---|---|
| lecture | `select` (`anon`, `authenticated`) | `app.is_workspace_member(workspace_id)` |
| insertion | `insert` (`authenticated`) | `with check (app.is_workspace_admin(workspace_id))` |
| mise à jour | `update` (`authenticated`) | `using` **et** `with check` `app.is_workspace_admin(workspace_id)` |

Le `WITH CHECK` de la mise à jour n'est pas une redondance : sans lui, un administrateur du
workspace A pourrait déplacer un nœud vers le workspace B, où il n'a aucun droit. **Mesuré** :
refusé en `403`, code `42501`.

`select` est accordé à `anon` **et** à `authenticated`. Sans jeton, `auth.uid()` est nul, le
prédicat rend faux, et le refus se manifeste par **zéro ligne** plutôt que par une erreur de
privilège — c'est ce que `docs/SPEC-permissions-rls.md` §7 exige d'une lecture refusée.

**Les droits fins ne s'appliquent pas, et n'ont pas à s'appliquer ici** : `track_members` et
`channel_members` portent sur un sous-arbre d'organisation, et le catalogue n'appartient à aucun
track ni à aucun channel. La politique s'arrête donc au rôle de workspace **par conception**, et
non par différé — à la différence de `tracks` (INC-024) et de `channels` (INC-030), où
`app.can_read_track` et `app.can_read_channel` restent dus.

### 2.8 Contrat d'API, mesuré

Toutes les lignes ci-dessous ont été **observées** sur la pile réelle, avec les jetons des comptes
seedés obtenus par `POST /auth/v1/token?grant_type=password`.

| # | Appel | Profil | Attendu, mesuré |
|---|---|---|---|
| a | `GET` du catalogue | `admin` | `200`, les nœuds du workspace, ordonnés par `position` |
| b | `GET` du catalogue | `viewer` | `200`, les mêmes nœuds — la lecture est ouverte à tout membre |
| c | `GET` du catalogue | anonyme | `200` et `[]` — preuve de refus n° 11 |
| d | `POST` d'un nœud | `admin` | `201`, `position` attribuée automatiquement |
| e | `POST` d'un nœud | `business_developer` | `403`, code `42501`, RLS |
| f | `POST` d'un nœud | `viewer` | `403`, code `42501`, RLS |
| g | `PATCH` `archived_at` | `admin` | `200`, nœud archivé |
| h | `PATCH` `archived_at` | `business_developer` | **`200` et `[]`** — voir ci-dessous |
| i | `DELETE` | `admin` | `403`, `permission denied for table` — le privilège manque |
| j | `PATCH` `workspace_id` vers un autre workspace | `admin` | `403`, `42501` — le `WITH CHECK` |
| k | `POST` dans un workspace dont on n'est pas membre | `admin` | `403`, `42501` |
| l | `GET` filtré sur un autre workspace | `admin` | `200` et `[]` — preuve de refus n° 3 |
| m | `POST` sans `position` | `admin` | `201`, `position` = dernière + 1 |

**La ligne h est la plus importante à énoncer explicitement.** Une mise à jour refusée par la
clause `USING` d'une politique ne produit **aucune erreur** : PostgREST rend `200` et un tableau
vide, parce qu'aucune ligne n'a été **vue** comme modifiable. Un test qui se contenterait de
constater l'absence d'erreur conclurait donc que l'écriture a réussi. Toute preuve de refus de mise
à jour doit relire la ligne et vérifier qu'elle est **inchangée** — sans quoi elle ne prouve rien.

Constat associé, déjà consigné : le refus de la ligne i **divulgue la commande `GRANT` à exécuter**
dans son `hint`. Comportement de la version épinglée de PostgREST, portée transverse, INC-026.

### 2.9 Catalogue initial livré par le seed

| Clé | Libellé | Type | Couleur | Probabilité | Seuil de relance |
|---|---|---|---|---|---|
| `prospection` | Prospection | `open` | `neutral` | 10 % | 14 j |
| `relance` | Relance | `open` | `accent` | 20 % | 7 j |
| `negociation` | Négociation | `open` | `brand` | 50 % | 10 j |
| `signature` | Signature | `open` | `brand` | 90 % | 7 j |
| `realisation` | Réalisation | `open` | `success` | 100 % | 30 j |
| `livre` | Livré | `won` | `success` | 100 % | — |
| `perdu` | Perdu | `lost` | `danger` | 0 % | — |

Le type `won` / `lost` est ce qui rend l'analytique de conversion possible sans convention
implicite sur les libellés.

Les couleurs ne figuraient pas dans l'énoncé d'origine, qui exigeait pourtant une colonne `color`.
Elles sont fixées ici : les deux nœuds terminaux prennent `success` et `danger`, dont c'est
exactement le sens dans `docs/DESIGN_SYSTEM.md` §1 ; `prospection` reste `neutral`, un début
d'affaire ne portant aucun jugement. **Aucun nœud du seed n'emploie les cinq jetons à lui seul** :
`accent` n'est employé que par `relance`, de sorte que chacun des cinq soit exercé au moins une
fois par l'ensemble catalogue + tracks.

Le seed livre en outre **un nœud archivé**, hors des sept ci-dessus, sans quoi l'état archivé ne
serait jamais représenté dans les données de démonstration — même raison qu'un track archivé pour
`CRM-020` et un channel archivé pour `CRM-021`.

### 2.10 Preuves attendues de `CRM-030`

| Niveau | Preuves |
|---|---|
| pgTAP | Structure, contraintes de valeur, unicité par workspace, ordre attribué et ordre fourni, archivage réversible, politiques, privilèges, autorisations éprouvées contre des comptes réels ; **absence des tables dont dépend la garde d'archivage**, figée pour devenir rouge à `CRM-031` / `CRM-040` |
| API | Les treize lignes du §2.8, hors interface, avec les jetons réels des trois profils ; preuves de refus n° 3 et n° 11 au niveau du catalogue |
| Seed | Les sept nœuds du §2.9 plus un nœud archivé, créés par la véritable API REST, convergents |
| Interface | **Aucune** — le catalogue n'a pas d'écran, et n'en aura pas avant l'éditeur de `CRM-031`. Voir INC-021 |

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
| pgTAP | Transition déclarée acceptée ; transition non déclarée refusée ; champ requis manquant refusé ; commentaire exigé absent refusé ; étape hors workflow refusée ; unicité de l'étape initiale ; refus d'archivage d'un nœud occupé — **différé, INC-031** : sa cible traverse `workflow_steps` (`CRM-031`) et `cards` (`CRM-040`), voir §2.6 |
| API | Appel direct de `move_card` avec le jeton d'un `viewer` → refusé ; mise à jour directe de `cards.current_step_id` par PostgREST → refusée |
| E2E | Parcours complet Prospection → Livré par l'interface ; tentative de glisser-déposer interdite ; message d'erreur de champ requis affiché et compréhensible |
| Visuel | Board aux quatre paliers responsive, colonne vide, card figée au-delà du seuil, menu de transitions |

## 9. Points ouverts

1. **Réalisation → Perdu** non déclaré dans le workflow par défaut : à confirmer par le
   responsable.
2. **Suppression d'une transition** encore empruntée par des cadences ou des automatisations :
   comportement à définir (refus, ou avertissement).
3. **Le refus d'archivage d'un nœud occupé n'est rattaché à aucune unité livrable** : INC-031,
   trois options d'arbitrage, à trancher avant `CRM-040`.
