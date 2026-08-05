# Modèle de données — P2Enjoy CRM

Référence du schéma PostgreSQL. Toute migration cite ce document et l'unité de backlog
correspondante dans son commentaire `@spec`. Toute évolution du modèle met ce fichier à jour
**dans le même changement** que la migration.

Documents liés : `docs/DAT.md`, `docs/SPEC-permissions-rls.md`, `docs/SPEC-workflow-engine.md`,
`docs/SPEC-form-composer.md`, `docs/SPEC-mail-subsystem.md`.

## Conventions générales

- Clés primaires `uuid` avec `gen_random_uuid()` (extension `pgcrypto`).
- Horodatages `timestamptz`, toujours en UTC. `created_at` par défaut `now()`.
- Suppression douce par `archived_at` (masqué, réversible) ou `deleted_at` (corbeille).
  La suppression physique est réservée aux purges RGPD.
- Toute table métier porte `workspace_id`, y compris lorsqu'il serait déductible par jointure :
  les politiques RLS restent ainsi simples et indexables.
- Les énumérations sont des types PostgreSQL lorsqu'elles sont stables, des colonnes `text` avec
  contrainte `CHECK` lorsqu'elles sont susceptibles d'évoluer par migration.
- Les noms de colonnes sont en anglais, les libellés destinés aux utilisateurs sont des données.
- **Les migrations sont idempotentes.** Le conteneur `migrations-runner` rejoue tout le répertoire
  à chaque démarrage de la pile et ne tient aucun registre : une migration doit pouvoir être
  appliquée plusieurs fois sans erreur ni effet de bord (`docs/DAT.md` §3.2, `docs/JOURNAL.md`
  décision 20).
- **RLS est activée dans la migration qui crée la table**, sans attendre ses politiques. Une table
  livrée avant ses politiques ne retourne donc aucune ligne et refuse toute écriture, plutôt que
  d'être ouverte à quiconque détient la clé anonyme, qui est publique par construction.

---

## 1. Identité et cloisonnement

### `profiles`
Prolonge `auth.users`. Créée par trigger à l'inscription.

| Colonne | Type | Contraintes |
|---|---|---|
| `id` | `uuid` | PK, FK `auth.users(id)` `ON DELETE CASCADE` |
| `full_name` | `text` | non nul |
| `avatar_url` | `text` | |
| `locale` | `text` | défaut `'fr'` |
| `created_at`, `updated_at` | `timestamptz` | |

### `workspaces`
Cloisonnement de premier niveau.

| Colonne | Type | Contraintes |
|---|---|---|
| `id` | `uuid` | PK |
| `name` | `text` | non nul |
| `slug` | `text` | unique, non nul |
| `inbound_domain` | `text` | domaine des adresses de card, ex. `crm.p2enjoy.studio` |
| `settings` | `jsonb` | défaut `'{}'` |
| `created_at`, `updated_at` | `timestamptz` | |

### `workspace_members`

| Colonne | Type | Contraintes |
|---|---|---|
| `workspace_id` | `uuid` | PK composite, FK `workspaces` |
| `user_id` | `uuid` | PK composite, FK `profiles` |
| `role` | `text` | `CHECK (role IN ('admin','business_developer','viewer'))` |
| `created_at` | `timestamptz` | |

### `track_members`, `channel_members`
Droits fins facultatifs. **Absence de ligne = accès hérité du rôle de workspace.** Une ligne
restreint ou étend explicitement l'accès à un sous-arbre (voir `docs/SPEC-permissions-rls.md`).

| Colonne | Type | Contraintes |
|---|---|---|
| `track_id` / `channel_id` | `uuid` | PK composite |
| `user_id` | `uuid` | PK composite, FK `profiles` `ON DELETE CASCADE` |
| `access` | `text` | `CHECK (access IN ('member','viewer','none'))` |
| `created_at` | `timestamptz` | date d'octroi du droit fin |

**Deux écarts assumés, consignés et non résolus implicitement :**

- `track_id` et `channel_id` ne portent **aucune clé étrangère** dans la migration d'amorçage
  `CRM-003` : les tables `tracks` et `channels` sont livrées par `CRM-020` et `CRM-021`, après
  elle. Voir `docs/INCONSISTENCY_REPORT.md`, INC-010. **Clés rétablies** par ces deux unités.
- Ces deux tables ne portent **pas** `workspace_id`, alors que les conventions générales de ce
  document l'exigent de toute table métier. Voir `docs/INCONSISTENCY_REPORT.md`, INC-011.
  **Conséquence mesurée à `CRM-012`** : leurs politiques ne peuvent pas filtrer par workspace
  directement et doivent remonter par `tracks` ou `channels`, d'où les deux fonctions d'appui
  `app.track_workspace` et `app.channel_workspace` du §9. L'écart n'est pas résolu, il est payé.

**Politiques — livrées par `CRM-012`** (`docs/SPEC-permissions-rls.md` §4.1) : lecture par
l'administrateur du workspace propriétaire et par l'utilisateur concerné pour sa propre ligne ;
insertion, mise à jour **et suppression** réservées à l'administrateur. La suppression est exposée
ici, contrairement aux tracks et aux channels : retirer un droit fin est le retour à l'accès
hérité, non la suppression d'une donnée métier.

---

## 2. Organisation

### `tracks`

Livrée par `CRM-020`. Spécification complète : `docs/SPEC-tracks.md`.

| Colonne | Type | Contraintes |
|---|---|---|
| `id` | `uuid` | PK, défaut `gen_random_uuid()` |
| `workspace_id` | `uuid` | FK `workspaces`, non nul, `ON DELETE CASCADE` |
| `name` | `text` | non nul, `CHECK (btrim(name) <> '')` |
| `slug` | `text` | non nul, `CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$')`, unique par workspace |
| `description` | `text` | |
| `color` | `text` | non nul, défaut `'neutral'`, `CHECK (color IN ('brand','success','accent','danger','neutral'))` — jeton du design system, pas un hexadécimal libre |
| `icon` | `text` | non nul, défaut `'folder'`, `CHECK (icon ~ '^[a-z][a-z0-9-]*$')` — nom d'icône lucide ; la **forme** est contrainte, l'existence est traitée par l'interface |
| `position` | `numeric` | non nul, ordre dans la barre latérale ; attribuée par trigger si omise |
| `archived_at` | `timestamptz` | non nul = archivé : masqué, réversible |
| `created_at`, `updated_at` | `timestamptz` | non nuls, défaut `now()` ; `updated_at` maintenue par `app.set_updated_at()` |

`created_at` et `updated_at` étaient absentes de ce tableau alors que les « Conventions
générales » les exigent de toute table : lacune consignée en `docs/INCONSISTENCY_REPORT.md`,
INC-025, et corrigée ici. Le tableau de `channels` ci-dessous n'est **pas** corrigé — il relève de
`CRM-021`, qui livrera la table.

**La clé étrangère `track_members.track_id → tracks.id` est posée par cette migration** : c'est la
moitié d'INC-010 que `CRM-020` referme. `channel_members.channel_id` attend `CRM-021`.

**Politiques RLS** (`docs/SPEC-permissions-rls.md` §4) : lecture par `app.is_workspace_member`,
insertion et mise à jour par `app.is_workspace_admin`, **aucune suppression** — ni politique, ni
privilège. `app.can_read_track` reste différée (INC-013), la lecture n'applique donc **aucun droit
fin** : INC-024.

### `channels`

Livrée par `CRM-021`. Spécification complète : `docs/SPEC-channels.md`.

| Colonne | Type | Contraintes |
|---|---|---|
| `id` | `uuid` | PK, défaut `gen_random_uuid()` |
| `workspace_id` | `uuid` | FK `workspaces`, non nul (dénormalisé), `ON DELETE CASCADE` |
| `track_id` | `uuid` | non nul ; la clé étrangère est **composite**, voir ci-dessous |
| `name` | `text` | non nul, `CHECK (btrim(name) <> '')` |
| `slug` | `text` | non nul, `CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$')`, unique **par track** |
| `description` | `text` | |
| `workflow_id` | `uuid` | **non nul depuis `CRM-033`** ; FK **composite** `(workflow_id, workspace_id) → workflows (id, workspace_id)` depuis `CRM-031` ; portée vérifiée par trigger, voir ci-dessous |
| `position` | `numeric` | non nul, ordre des onglets **dans son track** ; attribuée par trigger si omise |
| `archived_at` | `timestamptz` | non nul = archivé : masqué, réversible |
| `created_at`, `updated_at` | `timestamptz` | non nuls, défaut `now()` ; `updated_at` maintenue par `app.set_updated_at()` |

`created_at` et `updated_at` étaient absentes de ce tableau alors que les « Conventions
générales » les exigent de toute table : c'est la **seconde moitié** d'INC-025, que `CRM-020` avait
explicitement laissée à `CRM-021`. Les deux tables du §2 suivent désormais les conventions.

**Le cloisonnement est garanti par une clé étrangère composite**, et non par la bonne foi :

```sql
alter table public.tracks   add constraint tracks_id_workspace_id_key unique (id, workspace_id);
alter table public.channels add constraint channels_track_id_workspace_id_fkey
	foreign key (track_id, workspace_id) references public.tracks (id, workspace_id) on delete cascade;
```

`channels.workspace_id` est dénormalisé, et c'est lui que la politique RLS interroge. S'il pouvait
différer du workspace de son track, la politique cloisonnerait sur une valeur fausse — le channel
d'un track de A serait lisible par les membres de B, avec des politiques pourtant correctes. La
clé composite rend cet état impossible. Elle **remplace** la clé simple `track_id → tracks(id)`,
qu'elle contient (`docs/SPEC-channels.md` §2.4, `docs/JOURNAL.md` décision 60).

**La clé étrangère `channel_members.channel_id → channels.id` est posée par cette migration** :
c'est la seconde moitié d'INC-010, que `CRM-021` referme.

**`workflow_id` : écart réduit de moitié par `CRM-031`, et non clos.** Ce tableau l'exige non nulle
et référencée. `CRM-021` avait dû livrer la colonne nue, `workflows` n'existant pas, et trois
assertions figeaient cet état ; elles sont **devenues rouges à `CRM-031`**, comme prévu, et ont été
révisées avec le code.

Ce qui est acquis : la clé étrangère existe, et elle est **composite** —
`(workflow_id, workspace_id) → workflows (id, workspace_id)` —, de sorte que le workflow d'un
channel appartienne au même workspace, garanti par la base. Le seed rattache les six channels au
workflow par défaut.

**INC-029 EST SOLDÉE PAR `CRM-033`.** La contrainte `NOT NULL` est posée : créer un channel exige
désormais de désigner un workflow, et **aucun défaut de colonne** ne l'adoucit — un workspace peut
n'avoir aucun workflow par défaut, et un défaut silencieux transformerait une omission du client en
un choix qu'il n'a pas fait (`docs/JOURNAL.md`, décision 91). Mesuré avant de la poser : aucune ligne
n'y faisait obstacle.

**Contrainte non exprimable en clé étrangère, livrée par `CRM-033`** — `workflow_id` désigne soit un
workflow de portée `global` du même workspace, soit un workflow de portée `track` rattaché à
`track_id`. C'est la traduction de « les channels choisissent parmi les workflows disponibles dans
leur track ». Elle est portée par **deux** triggers et non un seul : la mesure a établi que deux des
quatre écritures capables de la casser passent par `workflows` — déplacer un workflow `track` sous
ses channels, faire basculer un workflow `global` occupé vers `track` — et qu'aucun trigger sur
`channels` ne pouvait les voir (INC-040, décision 89).

| Trigger | Table | Colonnes surveillées | Refus |
|---|---|---|---|
| `channels_verifier_workflow` | `public.channels` | `workflow_id`, `track_id`, `workspace_id` | `23514`, `workflow_hors_track` |
| `workflows_verifier_portee_occupee` | `public.workflows` | `scope`, `track_id` | `23514`, `workflow_portee_occupee` |

Le premier **se tait** lorsque le workflow désigné est introuvable : la clé étrangère composite rend
alors `23503` en nommant la contrainte, et un refus inventé serait moins précis (décision 90). Le
second ne refuse que ce qui **casse un rattachement existant** : un workflow `track` sans channel
change de track librement.

**Politiques RLS** (`docs/SPEC-permissions-rls.md` §4) : lecture par `app.is_workspace_member`,
insertion et mise à jour par `app.is_workspace_admin`, **aucune suppression** — ni politique, ni
privilège. `app.can_read_channel` et `app.can_write_channel` restent différées (INC-013), la
lecture n'applique donc **aucun droit fin** : INC-030.

---

## 3. Workflows

Spécification complète : `docs/SPEC-workflow-engine.md`.

### `workflow_nodes_catalog`
Catalogue partagé des étapes. C'est lui qui rend l'analytique comparable d'un channel à l'autre.

| Colonne | Type | Contraintes |
|---|---|---|
| `id` | `uuid` | PK |
| `workspace_id` | `uuid` | FK, non nul |
| `key` | `text` | unique par workspace, ex. `prospection` |
| `label` | `text` | non nul |
| `kind` | `text` | `CHECK (kind IN ('open','won','lost'))` |
| `color` | `text` | jeton du design system |
| `default_probability` | `numeric(5,2)` | `CHECK (0 <= x <= 100)` |
| `default_stale_after_days` | `integer` | seuil de relance par défaut |
| `position` | `numeric` | ordre d'affichage du catalogue, attribuée par trigger si omise |
| `archived_at` | `timestamptz` | un nœud utilisé n'est jamais supprimé, seulement archivé |
| `created_at`, `updated_at` | `timestamptz` | conventions générales ; `updated_at` maintenue par trigger |

Précisions apportées par `CRM-030`, après mesure (`docs/SPEC-workflow-engine.md` §2.2 à §2.6) :

- `key` suit la même forme que les slugs de `tracks` et de `channels` :
  `^[a-z0-9]+(-[a-z0-9]+)*$` ;
- `color` vaut l'un des cinq jetons du design system, défaut `neutral` ;
- `default_probability` et `default_stale_after_days` sont **nullables**, `0` n'étant pas `NULL` ;
  le seuil est contraint à `> 0` et vaut `NULL` pour un nœud terminal ;
- `numeric(5,2)` **arrondit avant** que la contrainte de valeur ne soit évaluée : `99.999` est
  accepté et stocké `100.00` ;
- **aucune suppression n'est exposée** : ni politique `for delete`, ni privilège `DELETE` ;
- le **refus d'archiver un nœud occupé** n'est pas livré — sa cible traverse `workflow_steps` et
  `cards`, qui n'existent pas encore. `docs/INCONSISTENCY_REPORT.md`, INC-031.

Catalogue initial livré par le seed : `prospection`, `relance`, `negociation`, `signature`,
`realisation`, `livre` (`kind = 'won'`), `perdu` (`kind = 'lost'`), plus un nœud **archivé** —
`qualification` — pour que l'état archivé soit démontrable et non seulement documenté.

### `workflows`

| Colonne | Type | Contraintes |
|---|---|---|
| `id` | `uuid` | PK |
| `workspace_id` | `uuid` | FK, non nul |
| `name` | `text` | non nul |
| `scope` | `text` | `CHECK (scope IN ('global','track'))` |
| `track_id` | `uuid` | FK, nul si `scope='global'`, non nul si `scope='track'` |
| `derived_from_workflow_id` | `uuid` | FK `workflows`, origine de la copie |
| `derived_at` | `timestamptz` | date de la copie, permet de signaler une divergence |
| `is_default` | `boolean` | un seul défaut par workspace |
| `archived_at` | `timestamptz` | |

Contrainte : `CHECK ((scope='global' AND track_id IS NULL) OR (scope='track' AND track_id IS NOT NULL))`.

Précisions apportées par `CRM-031`, après mesure (`docs/SPEC-workflow-engine.md` §3.2 à §3.7) :

- `created_at` / `updated_at` sont livrées, comme les conventions générales l'exigent et comme le
  tableau ci-dessus les omet — quatrième occurrence d'INC-025 ;
- `track_id` porte une clé étrangère **composite** `(track_id, workspace_id) → tracks (id,
  workspace_id)` : le track d'un workflow appartient au même workspace, garanti par la base ;
- `is_default` : **au plus un** vrai par workspace, par index unique partiel. « Au plus » et non
  « exactement » — un workspace neuf n'a aucun workflow ;
- `derived_from_workflow_id` est `on delete set null` : la copie est une divergence assumée, et
  supprimer l'original ne doit pas emporter ses copies. `derived_at` l'accompagne obligatoirement ;
- **aucune suppression n'est exposée** sur `workflows` : ni politique `for delete`, ni privilège.
  L'archivage tient lieu de suppression, comme pour les tracks, les channels et le catalogue.

### `workflow_steps`
Instanciation d'un nœud du catalogue dans un workflow.

| Colonne | Type | Contraintes |
|---|---|---|
| `id` | `uuid` | PK |
| `workflow_id` | `uuid` | FK, non nul |
| `node_id` | `uuid` | FK `workflow_nodes_catalog`, non nul |
| `position` | `numeric` | ordre des colonnes du board |
| `label_override` | `text` | surcharge locale facultative |
| `probability_override` | `numeric(5,2)` | |
| `stale_after_days` | `integer` | surcharge du seuil de relance |
| `is_initial` | `boolean` | exactement une étape initiale par workflow |

Unique : `(workflow_id, node_id)` — un nœud n'apparaît qu'une fois par workflow.

Précisions apportées par `CRM-031`, après mesure :

- la table porte `workspace_id`, comme les conventions générales l'exigent de toute table métier ;
  sa **véracité** est garantie par la clé composite `(workflow_id, workspace_id) → workflows (id,
  workspace_id)`, non supposée ;
- `node_id` porte une clé composite `(node_id, workspace_id)` vers le catalogue, en `on delete
  restrict` : un nœud instancié ne se supprime pas sous ses étapes ;
- unique également : `(id, workflow_id)`, **condition** des clés composites des transitions ;
- `is_initial` : **au plus une** vraie par workflow, par index unique partiel. « Au moins une » n'est
  pas imposable à l'écriture — mesuré : un `constraint trigger` différé rendrait la création d'un
  workflow impossible par l'API (`docs/SPEC-workflow-engine.md` §3.5, `docs/JOURNAL.md`
  décision 72). Un workflow sans étape initiale est un **brouillon**, valide et inutilisable ;
- `position` est attribuée par trigger dans la portée du **workflow** lorsqu'elle est omise ;
- les surcharges sont nullables, et `NULL` signifie « prendre la valeur du catalogue », jamais zéro ;
- la **suppression physique est exposée** aux administrateurs, ici et sur les transitions
  seulement : une étape est la composition d'un workflow, pas un objet à durée de vie propre, et
  aucun `archived_at` ne lui est donné (décision 74).

### `workflow_transitions`
Arêtes autorisées. **Une transition non déclarée est refusée.** Les cycles sont permis
(négociation → relance), ainsi que les branches vers un nœud terminal.

| Colonne | Type | Contraintes |
|---|---|---|
| `id` | `uuid` | PK |
| `workflow_id` | `uuid` | FK, non nul |
| `from_step_id` | `uuid` | FK `workflow_steps` |
| `to_step_id` | `uuid` | FK `workflow_steps`, différent de `from_step_id` |
| `label` | `text` | libellé du bouton d'action |
| `require_comment` | `boolean` | défaut faux |
| `require_fields` | `uuid[]` | champs exigés en plus de ceux requis par l'étape cible |

Unique : `(workflow_id, from_step_id, to_step_id)`.

Précisions apportées par `CRM-031`, après mesure :

- les deux extrémités portent une clé étrangère **composite** `(step_id, workflow_id)` : une
  transition ne peut pas sortir de son workflow, refus mesuré en `23503`. Supprimer une étape
  emporte ses arêtes (`on delete cascade`) ;
- `workspace_id` est porté et garanti comme pour les étapes ;
- `require_fields` ne peut porter **aucune** intégrité référentielle : PostgreSQL refuse une clé
  étrangère depuis une colonne tableau. Ce n'est pas un différé en attendant `form_fields`, c'est
  une propriété du type — `docs/INCONSISTENCY_REPORT.md`, INC-033.

---

## 4. Formulaires conditionnels

Spécification complète : `docs/SPEC-form-composer.md`.

### `form_fields`

| Colonne | Type | Contraintes |
|---|---|---|
| `id` | `uuid` | PK ; **`UNIQUE (id, workflow_id)`** en plus, condition de la clé composite de `form_field_rules` |
| `workflow_id` | `uuid` | non nul ; FK **composite** `(workflow_id, workspace_id) → workflows (id, workspace_id)`, `ON DELETE CASCADE` |
| `workspace_id` | `uuid` | non nul, dénormalisé pour la RLS ; sa véracité est garantie par la clé composite ci-dessus |
| `key` | `text` | non nul, unique par workflow — **totale**, un champ archivé garde sa clé ; `^[a-z0-9]+(-[a-z0-9]+)*$` |
| `label` | `text` | non nul, non vide |
| `type` | `text` | non nul, `CHECK` : `text`, `textarea`, `number`, `money`, `date`, `datetime`, `select`, `multiselect`, `checkbox`, `url`, `email`, `phone`, `user`, `contact`, `file` |
| `options` | `jsonb` | non nul, défaut `{}`, **objet** JSON ; `select`/`multiselect` exigent `choices` non vide, `money` exige `currency` (`^[A-Z]{3}$`) |
| `help_text` | `text` | nullable, non vide si fourni |
| `position` | `numeric` | non nul **sans défaut de colonne** ; attribuée par trigger dans la portée du workflow si omise |
| `archived_at` | `timestamptz` | nullable ; non nul = archivé. **Aucune suppression n'est exposée** |
| `created_at`, `updated_at` | `timestamptz` | non nuls, `now()` ; `updated_at` par trigger |

### `form_field_rules`
Conditionnalité par étape : c'est la table qui rend un champ visible ou obligatoire selon le
statut courant de la card.

| Colonne | Type | Contraintes |
|---|---|---|
| `field_id` | `uuid` | PK composite ; FK **composite** `(field_id, workflow_id) → form_fields (id, workflow_id)`, `ON DELETE CASCADE` |
| `step_id` | `uuid` | PK composite ; FK **composite** `(step_id, workflow_id) → workflow_steps (id, workflow_id)`, `ON DELETE CASCADE` |
| `workflow_id` | `uuid` | non nul ; **charnière** des deux clés composites — c'est lui qui rend impossible une règle croisant deux workflows |
| `workspace_id` | `uuid` | non nul ; FK composite `(workflow_id, workspace_id) → workflows (id, workspace_id)` |
| `visibility` | `text` | non nul, `CHECK (visibility IN ('hidden','visible','required'))` |
| `created_at`, `updated_at` | `timestamptz` | non nuls, `now()` |

Absence de ligne pour un couple : le champ suit sa valeur par défaut, `visible`. Le formulaire
d'une étape se lit donc en listant les **champs du workflow** puis en appliquant les règles
trouvées, jamais en listant les règles de l'étape.

Détail des contraintes, de leurs mesures et de leurs motifs : `docs/SPEC-form-composer.md` §2 et §3.

### `card_field_values`

| Colonne | Type | Contraintes |
|---|---|---|
| `card_id` | `uuid` | PK composite ; FK **composite** `(card_id, workflow_id) → cards (id, workflow_id)`, `ON DELETE CASCADE` |
| `field_id` | `uuid` | PK composite ; FK **composite** `(field_id, workflow_id) → form_fields (id, workflow_id)`, `ON DELETE CASCADE` |
| `workflow_id` | `uuid` | non nul ; **charnière** des deux clés composites — c'est lui qui rend impossible une valeur répondant à la question d'un autre workflow |
| `workspace_id` | `uuid` | non nul ; FK composite `(workflow_id, workspace_id) → workflows (id, workspace_id)` |
| `value` | `jsonb` | **nullable** ; SQL `NULL` **et** `'null'::jsonb` signifient explicitement vide. La **forme** est validée par trigger selon `form_fields.type` — un `CHECK` ne peut pas porter de sous-requête, mesuré |
| `updated_by` | `uuid` | nullable, FK `profiles`, `ON DELETE SET NULL` |
| `created_at`, `updated_at` | `timestamptz` | non nuls, `now()` ; `updated_at` par trigger |

Index GIN sur `value` pour les filtres des vues sauvegardées.

**Livrée par `CRM-036`** — voir `docs/SPEC-form-composer.md` §6. Deux précisions opposables que le
tableau d'origine ne portait pas :

- `created_at` s'ajoute, comme pour toute table métier (« Conventions générales » ; **quatrième
  occurrence d'INC-025**) ;
- `value` est **nullable**, contre ce que ce tableau annonçait. MESURÉ : PostgREST convertit un
  `null` JSON en SQL `NULL` et ne sait produire `'null'::jsonb` par aucune écriture — la contrainte
  `NOT NULL` rendait donc inatteignable le « vide explicite » que la même ligne spécifiait, et un
  champ `money` renseigné par erreur n'avait aucune écriture licite qui le remette à vide. INC-054,
  décision 133 ;
- `cards` reçoit `UNIQUE (id, workflow_id)` dans la même migration, **condition** de la première clé
  composite ci-dessus. MESURÉ : sans elle, « there is no unique constraint matching given keys for
  referenced table "cards" ». L'ajout ne change aucun comportement, `id` étant déjà clé primaire.

---

## 5. Cards

### `cards`

| Colonne | Type | Contraintes |
|---|---|---|
| `id` | `uuid` | PK |
| `workspace_id` | `uuid` | FK, non nul (dénormalisé pour les politiques RLS) |
| `channel_id` | `uuid` | FK, non nul |
| `workflow_id` | `uuid` | FK, non nul — figé à la création, suit le channel |
| `current_step_id` | `uuid` | FK `workflow_steps`, non nul |
| `title` | `text` | non nul |
| `description` | `text` | |
| `position` | `numeric` | index fractionnaire pour le glisser-déposer |
| `owner_id` | `uuid` | FK `profiles` |
| `amount` | `numeric(14,2)` | montant de l'affaire |
| `currency` | `text` | défaut `'EUR'` |
| `probability_override` | `numeric(5,2)` | sinon celle de l'étape |
| `next_action` | `text` | prochaine action à mener |
| `next_action_at` | `timestamptz` | échéance, alimente la vue « Ma journée » |
| `entered_step_at` | `timestamptz` | date d'entrée dans l'étape courante, base des relances |
| `health_score` | `integer` | recalculé par l'ordonnanceur |
| `email_local_part` | `text` | unique global, partie locale de l'adresse de la card |
| `snoozed_until` | `timestamptz` | |
| `archived_at`, `deleted_at` | `timestamptz` | |
| `created_by` | `uuid` | FK `profiles` |
| `created_at`, `updated_at` | `timestamptz` | |
| `search_tsv` | `tsvector` | colonne générée, index GIN |

`email_local_part` est généré par trigger sous la forme `c-<8 caractères base32>`, non devinable
afin qu'une adresse divulguée ne permette pas d'énumérer les autres cards. L'adresse complète
est `email_local_part || '@' || workspaces.inbound_domain`.

**Livrée par `CRM-040`** — voir `docs/SPEC-cards.md`. Trois précisions que le tableau ci-dessus ne
porte pas, et qui sont opposables :

- `created_at` et `updated_at` s'ajoutent, comme pour toute table métier (« Conventions
  générales » ; troisième occurrence d'INC-025) ;
- la cohérence workspace / workflow / étape est tenue par **trois clés étrangères composites** et
  non par des triggers (décision 109). L'une d'elles a une conséquence non spécifiée : le workflow
  d'un channel **occupé** ne peut plus changer — INC-046, arbitrage attendu ;
- l'alphabet base32 retenu est celui de **Crockford en minuscules**, `0123456789abcdefghjkmnpqrstvwxyz`,
  et la forme est tenue par un `CHECK`, non seulement par le trigger qui la produit.

### `card_comments`

| Colonne | Type | Contraintes |
|---|---|---|
| `id`, `card_id`, `workspace_id` | `uuid` | |
| `author_id` | `uuid` | FK `profiles` |
| `body` | `text` | non nul, markdown |
| `mentions` | `uuid[]` | destinataires de notification |
| `created_at`, `edited_at`, `deleted_at` | `timestamptz` | |

Tout membre pouvant lire la card peut commenter : c'est la règle demandée.

### `card_activities`
Activités typées, distinctes des commentaires libres.

| Colonne | Type | Contraintes |
|---|---|---|
| `id`, `card_id`, `workspace_id` | `uuid` | |
| `type` | `text` | `CHECK (type IN ('call','meeting','visio','note'))` |
| `occurred_at` | `timestamptz` | non nul |
| `duration_minutes` | `integer` | |
| `body` | `text` | compte rendu |
| `author_id` | `uuid` | FK `profiles` |

### `card_events`
Timeline **append-only**, alimentée par triggers. Aucune écriture directe par un client.

| Colonne | Type | Contraintes |
|---|---|---|
| `id`, `card_id`, `workspace_id` | `uuid` | |
| `type` | `text` | `created`, `moved`, `field_changed`, `assigned`, `mail_received`, `mail_sent`, `archived`, … |
| `actor_id` | `uuid` | nul si l'auteur est un service |
| `payload` | `jsonb` | avant/après |
| `created_at` | `timestamptz` | |

### Tables satellites

| Table | Contenu |
|---|---|
| `tags`, `card_tags` | Étiquettes transverses, filtrables |
| `card_watchers` | Abonnements aux notifications d'une card |
| `card_checklists`, `card_checklist_items` | Sous-tâches |
| `card_templates` | Modèles par channel : champs pré-remplis et checklist type |

---

## 6. Relations

### `organizations`

| Colonne | Type | Contraintes |
|---|---|---|
| `id`, `workspace_id` | `uuid` | |
| `name` | `text` | non nul |
| `domain` | `text` | unique par workspace, pivot du rapprochement des emails |
| `website` | `text` | |

### `contacts`

| Colonne | Type | Contraintes |
|---|---|---|
| `id`, `workspace_id` | `uuid` | |
| `organization_id` | `uuid` | FK, facultatif |
| `full_name` | `text` | |
| `email` | `text` | unique par workspace sur `lower(email)` |
| `phone`, `role_title` | `text` | |
| `source` | `text` | `manual`, `email`, `import` |

### `card_contacts`
Association n-n, avec un rôle (`decideur`, `prescripteur`, `technique`, …).

---

## 7. Messagerie

Spécification complète : `docs/SPEC-mail-subsystem.md`. La séparation entre compte entrant et
identité sortante traduit une contrainte réelle : un utilisateur peut recevoir sur une boîte et
répondre depuis une adresse hébergée ailleurs.

### `mail_inbound_accounts` (IMAP)

| Colonne | Type | Contraintes |
|---|---|---|
| `id`, `workspace_id` | `uuid` | |
| `owner_id` | `uuid` | FK `profiles`, **nul = boîte système du workspace** |
| `label` | `text` | non nul |
| `imap_host` | `text` | non nul |
| `imap_port` | `integer` | non nul |
| `imap_security` | `text` | `CHECK (imap_security IN ('ssl','starttls','none'))` |
| `imap_username` | `text` | non nul |
| `secret_id` | `uuid` | référence Vault — **révoquée en lecture pour `authenticated`** |
| `watch_folders` | `text[]` | défaut `{INBOX}` |
| `folder_style` | `text` | `CHECK (folder_style IN ('folder','label'))` |
| `sync_state` | `jsonb` | dernier `UIDVALIDITY` et dernier UID vu par dossier |
| `backfill_months` | `integer` | profondeur d'import initial |
| `status` | `text` | `pending`, `ok`, `error`, `disabled` |
| `last_sync_at` | `timestamptz` | |
| `last_error` | `text` | message assaini, sans identifiants |

### `mail_outbound_identities` (SMTP)

| Colonne | Type | Contraintes |
|---|---|---|
| `id`, `workspace_id` | `uuid` | |
| `owner_id` | `uuid` | FK `profiles`, nul = identité de service |
| `label` | `text` | non nul |
| `smtp_host`, `smtp_port`, `smtp_security`, `smtp_username` | | comme ci-dessus |
| `secret_id` | `uuid` | référence Vault, mêmes restrictions |
| `from_address` | `text` | non nul — l'adresse réellement affichée |
| `from_name` | `text` | |
| `signature_html` | `text` | |
| `is_default` | `boolean` | une seule par utilisateur |
| `daily_quota` | `integer` | garde-fou anti-abus |
| `status`, `last_error` | | |

### `mail_messages`
Message canonique, dédoublonné.

| Colonne | Type | Contraintes |
|---|---|---|
| `id`, `workspace_id` | `uuid` | |
| `rfc822_message_id` | `text` | unique avec `workspace_id` |
| `in_reply_to` | `text` | |
| `references` | `text[]` | |
| `subject` | `text` | |
| `from_addr`, `from_name` | `text` | |
| `to_addrs`, `cc_addrs` | `text[]` | |
| `sent_at` | `timestamptz` | date du message |
| `body_text`, `body_html` | `text` | |
| `raw_path` | `text` | message brut dans Storage |
| `direction` | `text` | `CHECK (direction IN ('inbound','outbound'))` |
| `card_id` | `uuid` | FK `cards`, nul tant que non classé |
| `classification` | `text` | `CHECK (classification IN ('auto','manual','unclassified'))` |
| `classified_by` | `uuid` | FK `profiles`, nul si automatique |
| `snoozed_until` | `timestamptz` | |
| `search_tsv` | `tsvector` | index GIN |

Un message classé dans une card **reste** dans l'inbox globale : le classement renseigne
`card_id`, il ne retire rien.

### `mail_message_occurrences`
Un même message peut exister dans plusieurs boîtes (boîte système et boîte mirroir).

| Colonne | Type | Contraintes |
|---|---|---|
| `message_id` | `uuid` | PK composite |
| `account_id` | `uuid` | PK composite, FK `mail_inbound_accounts` |
| `folder` | `text` | PK composite |
| `uid` | `bigint` | UID IMAP dans ce dossier |
| `flags` | `text[]` | |

### `mail_attachments`

| Colonne | Type | Contraintes |
|---|---|---|
| `id`, `message_id`, `card_id` | `uuid` | `card_id` recopié pour un accès direct depuis la card |
| `filename` | `text` | non nul, assaini |
| `mime_type` | `text` | déterminé par inspection, pas seulement par l'extension |
| `size_bytes` | `bigint` | |
| `storage_path` | `text` | |
| `sha256` | `text` | déduplication du contenu |
| `av_status` | `text` | `CHECK (av_status IN ('pending','clean','infected','skipped'))` |
| `extracted_text` | `text` | pour la recherche dans le contenu |

Une pièce jointe n'est téléchargeable qu'en statut `clean`.

### `mail_outbox`
File d'envoi persistante.

| Colonne | Type | Contraintes |
|---|---|---|
| `id`, `workspace_id` | `uuid` | |
| `identity_id` | `uuid` | FK `mail_outbound_identities` |
| `card_id` | `uuid` | détermine le `Reply-To` |
| `in_reply_to_message_id` | `uuid` | FK `mail_messages`, pour le fil |
| `to_addrs`, `cc_addrs`, `bcc_addrs` | `text[]` | |
| `subject`, `body_html`, `body_text` | `text` | |
| `attachments` | `jsonb` | chemins Storage |
| `status` | `text` | `queued`, `sending`, `sent`, `failed`, `cancelled` |
| `attempts` | `integer` | défaut 0 |
| `next_attempt_at` | `timestamptz` | backoff exponentiel |
| `last_error` | `text` | assaini |
| `sent_message_id` | `uuid` | FK `mail_messages` une fois envoyé |

### Autres tables de messagerie

| Table | Contenu |
|---|---|
| `mail_folder_map` | Correspondance entre une card/channel/track et le chemin IMAP réellement créé, par compte |
| `mail_templates` | Modèles avec variables (`{{card.title}}`, `{{contact.full_name}}`, …) |
| `mail_sequences`, `mail_sequence_steps` | Cadences de relance (J+3, J+8, J+15) |
| `card_sequence_enrollments` | Inscription d'une card à une cadence, arrêtée dès qu'une réponse arrive |

---

## 8. Transverse

| Table | Contenu |
|---|---|
| `notifications` | Destinataire, type, charge utile, date de lecture |
| `notification_preferences` | Canal souhaité par type : in-app, email immédiat, digest |
| `audit_log` | Acteur, action, entité, charge utile, date — append-only |
| `api_tokens` | Jetons à portée limitée : empreinte stockée, jamais le jeton en clair |
| `webhook_endpoints`, `webhook_deliveries` | Points de sortie signés et historique des remises |
| `saved_views` | Filtres nommés, personnels ou partagés |

---

## 9. Fonctions et RPC

| Fonction | Rôle | État |
|---|---|---|
| `app.workspace_role(ws)` | Rôle de l'appelant dans le workspace, `NULL` s'il n'en est pas membre. `SECURITY DEFINER`, `STABLE` | livrée (`CRM-010`) |
| `app.is_workspace_member(ws)` / `app.is_workspace_admin(ws)` | Résolution du rôle, `SECURITY DEFINER` pour éviter la récursion RLS | livrées (`CRM-010`) |
| `app.resolve_access(ws_role, track_access, channel_access)` | Algorithme « le plus spécifique gagne » de `docs/SPEC-permissions-rls.md` §2.2, appliqué à trois valeurs déjà lues. Rend `none`, `read` ou `write`. Fonction pure : `IMMUTABLE`, `SECURITY INVOKER` | livrée (`CRM-010`) |
| `app.can_read_track(track)` / `app.can_read_channel(ch)` / `app.can_write_channel(ch)` | Droit effectif après application des droits fins : lecture de la ligne par jointures **externes**, puis `app.resolve_access`, enveloppé dans `coalesce(…, false)`. `SECURITY DEFINER`, `search_path` vide — sans quoi la politique de `tracks` s'interrogerait elle-même et épuiserait la pile (`54001`, mesuré) | livrées (`CRM-012`) |
| `app.track_workspace(track)` / `app.channel_workspace(ch)` | Workspace propriétaire, `NULL` si l'objet n'existe pas. Support des politiques de `track_members` et `channel_members`, qui ne portent pas `workspace_id` (INC-011) | livrées (`CRM-012`) |
| `app.can_read_card(card)` | Droit effectif sur une card, dérivé de son channel | **livrée** par `CRM-040` — INC-013 close. Destinée aux tables **filles** : les politiques de `cards` jugent sur `channel_id` (décision 110) |
| `move_card(card_id, to_step_id, comment)` | **Garde centrale**, et **seul chemin** par lequel une card change d'étape : c'est la seule place du produit où le graphe du workflow est opposable. Rend `public.cards` — donc un **objet** JSON pour PostgREST, non un tableau —, remet `entered_step_at` à `now()` et recalcule `position` en fin de colonne d'arrivée. `SECURITY DEFINER`, `search_path` vide, `EXECUTE` **révoqué nommément à `anon`**. Cinq refus : `card_not_found`, `forbidden`, `step_not_in_workflow`, `transition_not_allowed`, `comment_required` (docs/SPEC-workflow-engine.md §5.3) | **livrée** par `CRM-034` — **cinq vérifications sur six** : la n° 6, « champs requis renseignés », lit `card_field_values`, due par `CRM-036` (INC-047) |
| `copy_workflow_to_track(workflow_id, track_id, new_name)` | Copie tracée d'un workflow global vers un track : étapes, arêtes remappées par le nœud, lignage renseigné. `SECURITY DEFINER`, `search_path` vide, `EXECUTE` **révoqué nommément à `anon`**. Quatre refus : `workflow_not_found`, `forbidden`, `workflow_not_global`, `track_not_found` (docs/SPEC-workflow-engine.md §4.3) | livrée (`CRM-032`) |
| `move_card_to_channel(card_id, channel_id, step_mapping)` | Changement de channel avec remappage explicite des étapes |
| `queue_outbound_email(...)` | Insertion contrôlée dans `mail_outbox` |
| `classify_message(message_id, card_id)` | Classement manuel d'un message, journalisé |

Toutes les fonctions `SECURITY DEFINER` fixent `search_path` explicitement et sont accordées au
seul rôle qui doit les appeler.

**Un `revoke … from public` ne suffit pas dans le schéma `public`.** MESURÉ pendant `CRM-032`
(docs/JOURNAL.md, décision 80) : l'image livre des `ALTER DEFAULT PRIVILEGES` qui accordent
**nommément** à `anon`, `authenticated` et `service_role` l'exécution de toute fonction nouvelle du
schéma `public`, et **tous** les droits de toute table ou vue nouvelle. Tout objet créé dans
`public` doit donc être fermé en nommant les rôles, avant d'être rouvert au strict nécessaire. Les
fonctions du schéma `app` ne sont pas concernées : ce schéma n'a aucun privilège par défaut, et
l'API ne l'expose pas.

### 9.1 Vues exposées

| Vue | Rôle | État |
|---|---|---|
| `public.workflow_derivations` | Une ligne par workflow dérivé : son origine, la date de la copie, la date du dernier changement de la source **composition comprise**, et le booléen de divergence. `security_invoker = true`, lecture seule (docs/SPEC-workflow-engine.md §4.6) | livrée (`CRM-032`) |

Une vue exposée à l'API est toujours `security_invoker = true` : sans ce réglage, elle lirait ses
tables avec les droits de son propriétaire et deviendrait une porte dérobée sur des tables
protégées par RLS.

---

## 10. Index principaux

| Table | Index |
|---|---|
| `cards` | `(channel_id, current_step_id, position)`, `(workspace_id, next_action_at)`, `(email_local_part)` unique, GIN sur `search_tsv` |
| `card_field_values` | GIN sur `value` |
| `mail_messages` | `(workspace_id, rfc822_message_id)` unique, `(card_id, sent_at DESC)`, GIN sur `search_tsv` |
| `mail_outbox` | partiel sur `status IN ('queued','sending')` trié par `next_attempt_at` |
| `contacts` | unique sur `(workspace_id, lower(email))` |
| `card_events` | `(card_id, created_at DESC)` |

---

## 11. Points à trancher avant implémentation

Consignés également dans `docs/INCONSISTENCY_REPORT.md` :

1. ~~**Disponibilité de `supabase_vault`** dans l'image PostgreSQL retenue. Repli : `pgcrypto`
   avec clé d'environnement dédiée.~~ **Tranché par `CRM-004`** : `supabase_vault` 0.3.1 est
   présente, installée et préchargée dans `supabase/postgres:17.6.1.136`. Vault est retenu, le
   repli `pgcrypto` est abandonné (`docs/JOURNAL.md`, décision 23 ; `docs/DAT.md` §8). Les
   colonnes `secret_id` ci-dessous portent donc bien une référence Vault. Contrainte
   d'exploitation associée : la clé racine vit hors de `PGDATA` et doit être sauvegardée à part
   (décision 24, `docs/DAT.md` §10).
2. **Messages sans `Message-ID`.** Certains expéditeurs non conformes n'en fournissent pas. Une
   empreinte de repli (expéditeur, date, sujet, taille) devra être définie dans la spécification
   du sous-système mail avant implémentation.
3. **Archivage d'un nœud utilisé.** L'archivage d'un nœud du catalogue encore référencé par des
   cards actives exige un plan de remappage. Comportement par défaut retenu : archivage refusé
   tant que des cards s'y trouvent.
