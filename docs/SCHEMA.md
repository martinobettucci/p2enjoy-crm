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

**Contrat `CRM-022` :** `full_name` est normalisé, non blanc et borné à 120 caractères ;
`avatar_url` est nul, un chemin même origine ou une URL HTTPS, bornée à 2048 caractères. Un profil
lit le sien et ceux des personnes avec lesquelles il partage un workspace ; il ne modifie que son
nom et son avatar. Spécification complète : `docs/SPEC-identite.md`.

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

**Contrat `CRM-022` :** tous les membres du workspace lisent ses appartenances ; seul un admin les
modifie. La mise à jour cliente ne porte que sur `role`. Après chaque mutation de membership, un
constraint trigger différable exige un admin dans chaque workspace affecté qui existe encore,
même si l'admin retiré était l'unique membre ; la cascade du workspace lui-même reste possible.

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
| `source_composition_fingerprint` | `text` | SHA-256 canonique de la source au moment de la copie ; nul hors dérivation et sur une copie historique dont l'état d'origine est inconnaissable |
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
- `source_composition_fingerprint` accompagne tout lignage et permet à `workflow_derivations` de
  comparer la composition complète, y compris une suppression dans la source. La date ne sert
  plus de substitut à cette comparaison. Une copie antérieure à la migration 19 garde `NULL` et
  est signalée divergente/à vérifier plutôt que déclarée faussement identique (`CRM-018`, décision
  293) ;
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

Unique : `(workflow_id, from_step_id, to_step_id)`.

Précisions apportées par `CRM-031`, après mesure :

- les deux extrémités portent une clé étrangère **composite** `(step_id, workflow_id)` : une
  transition ne peut pas sortir de son workflow, refus mesuré en `23503`. Supprimer une étape
  emporte ses arêtes (`on delete cascade`) ;
- `workspace_id` est porté et garanti comme pour les étapes ;
- l'ancien `require_fields uuid[]` ne pouvait porter **aucune** intégrité référentielle : propriété
  du type mesurée et corrigée par la table ci-dessous — INC-033, décision 262, `CRM-018`.

### `workflow_transition_required_fields`

| Colonne | Type | Contraintes |
|---|---|---|
| `transition_id` | `uuid` | PK avec `field_id`, FK vers `workflow_transitions`, `ON DELETE CASCADE` |
| `field_id` | `uuid` | PK avec `transition_id`, FK vers `form_fields`, `ON DELETE CASCADE` |

La table n'a ni identité, ni horodatage, ni `workspace_id`. Son trigger verrouille les deux parents
et refuse tout couple dont ils appartiennent à des workflows différents ; deux triggers
symétriques empêchent aussi de rendre une liaison existante incohérente en déplaçant ensuite la
transition ou le champ (`CRM-018`, décision 301). `copy_workflow_to_track` copie désormais le
formulaire complet et remappe chaque liaison vers le champ dérivé correspondant : aucune exigence
inerte ni aucun identifiant partagé (`CRM-018`, décision 293).
Contrat complet : `docs/SPEC-transition-required-fields.md`.

**État : livré et vérifié par `CRM-018`.** L'option d'un nettoyage applicatif est écartée : les
deux cascades font de l'absence d'identifiant mort une propriété de la base.

### `workflow_versions`

| Colonne | Type | Contraintes |
|---|---|---|
| `id` | `uuid` | PK, `gen_random_uuid()` |
| `workspace_id` | `uuid` | `NOT NULL`, FK vers `workspaces`, `ON DELETE CASCADE` |
| `workflow_id` | `uuid` | `NOT NULL`, FK de couple `(workflow_id, workspace_id)` vers `workflows (id, workspace_id)`, `ON DELETE CASCADE` |
| `version_number` | `integer` | `NOT NULL`, `> 0`, **unique par `workflow_id`** |
| `composition` | `jsonb` | `NOT NULL`, objet — photographie canonique de la composition |
| `composition_fingerprint` | `text` | `NOT NULL`, `^[0-9a-f]{64}$` |
| `note` | `text` | facultatif, non vide après `btrim` |
| `published_by` | `uuid` | FK vers `profiles`, `ON DELETE SET NULL` |
| `published_at` | `timestamptz` | `NOT NULL`, `now()` |

**Table immuable, et l'immuabilité est tenue à trois niveaux** : aucune politique RLS de mise à jour
ni de suppression, aucun privilège d'écriture pour `anon` ni `authenticated`, et un trigger
`before update` qui refuse en `42501` **y compris sous `service_role`**. Le trigger ne porte
délibérément **pas** sur `delete` : il s'exécuterait lors des suppressions en cascade et rendrait la
suppression d'un workspace impossible (mode de défaillance d'INC-039).

Aucune colonne `updated_at` : une ligne immuable n'a pas de date de modification.

Le contenu conservé est une photographie de **structure** — étapes, arêtes, champs, règles,
exigences. Il ne contient **aucune card, aucune valeur de champ, aucune donnée personnelle**.

Écriture par la seule RPC `public.publish_workflow_version` (§9). Contrat complet :
`docs/SPEC-workflow-engine.md` §7 ter.

**État : première tranche de `CRM-078`.** La comparaison de deux versions, le plan de remappage des
cards et son application transactionnelle restent dus (`docs/SPEC-workflow-engine.md` §7 ter.9).

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
| `value` | `jsonb` | **nullable** ; SQL `NULL` **et** `'null'::jsonb` signifient explicitement vide. La **forme** est validée par trigger selon `form_fields.type` — un `CHECK` ne peut pas porter de sous-requête, mesuré. **Depuis la migration 47** (`CRM-060` tranche 3), les types `contact` et `user` sont en outre **résolus** : leur cible doit exister dans le **workspace de la valeur** — `public.contacts` pour l'un, `public.workspace_members` pour l'autre. La vérification a lieu **à l'écriture** ; un `jsonb` ne portant pas de clé étrangère, une valeur survit à la suppression de sa cible (`docs/SPEC-contacts.md` §9.4) |
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
| `snoozed_until` | `timestamptz` | mise en sommeil : non nulle ET future ⇒ la card dort. **Fermée en écriture à `authenticated` depuis `CRM-081`** — elle s'écrit par `snooze_card` et `wake_card` |
| `archived_at`, `deleted_at` | `timestamptz` | |
| `created_by` | `uuid` | FK `profiles` |
| `created_at`, `updated_at` | `timestamptz` | |
| `search_tsv` | `tsvector` | colonne générée, index GIN |

`email_local_part` est généré par trigger sous la forme `c-<8 caractères base32>`, non devinable
afin qu'une adresse divulguée ne permette pas d'énumérer les autres cards. L'adresse complète
est `email_local_part || '@' || workspaces.inbound_domain`.

**La colonne n'est pas modifiable par un client depuis `CRM-013`** : `authenticated` n'a plus le
privilège `UPDATE` dessus (`docs/SPEC-permissions-rls.md` §4.4). Sans ce retrait, la
non-devinabilité ci-dessus était rendue au client par une simple mise à jour — MESURÉ. La
**lecture** reste ouverte : une adresse de card est une identité, non un secret. `service_role`
conserve l'écriture, dont le seed dépend.

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
| `id` | `uuid` | clé primaire, `gen_random_uuid()` |
| `card_id` | `uuid` | non nul, FK `cards (id)` `on delete cascade` |
| `workspace_id` | `uuid` | non nul, **dérivé de la card par trigger** ; clé composite `(card_id, workspace_id) → cards (id, workspace_id)` |
| `author_id` | `uuid` | nullable, FK `profiles` `ON DELETE SET NULL`, défaut `auth.uid()` |
| `body` | `text` | non nul, markdown ; `CHECK` **conditionnel** : 1 à 10 000 caractères tant que le commentaire vit, **chaîne vide** dès qu'il est supprimé |
| `mentions` | `uuid[]` | non nul, défaut `'{}'` — destinataires de notification, **jamais alimentée** par `CRM-043` |
| `created_at` | `timestamptz` | non nul, défaut `now()` |
| `edited_at` | `timestamptz` | posé par trigger quand le corps change, jamais par le client |
| `deleted_at` | `timestamptz` | posé par trigger ; **irréversible**, et le corps est alors vidé |
| `deleted_by` | `uuid` | nullable, FK `profiles` `ON DELETE SET NULL` ; posé par trigger avec `deleted_at` — **audit de la modération** (migration 35, décision 374) |

**Commenter exige le droit d'ÉCRITURE sur le channel de la card, non le droit de lecture.** Cette
ligne corrige une phrase de ce chapitre — « tout membre pouvant lire la card peut commenter » — que
le §4 de `docs/SPEC-permissions-rls.md` et la Definition of Done de `CRM-043` contredisaient tous
deux, la seconde exigeant nommément la preuve du refus opposé à un `viewer`. La contradiction est
consignée en **INC-071** ; le comportement retenu est celui des deux sources concordantes, et le
motif complet vit dans `docs/SPEC-cards.md` §13.6.

**La modification est réservée à l'auteur ; la suppression lui est ouverte, ainsi qu'aux `admin` du
workspace.** `CRM-043` avait livré l'intersection des deux énoncés — l'auteur seul pour les deux
gestes — faute d'arbitrage, en nommant sa conséquence : aucun modérateur ne pouvait retirer un
propos déplacé. L'arbitrage est rendu (décision 367, lot G) et mis en œuvre par la décision 374 :
**INC-072 est close**. Modifier le propos d'autrui reste impossible à tous — c'est une falsification,
non une modération —, la borne étant tenue par le **trigger**, qu'aucune politique RLS ne peut
remplacer faute d'`OLD`. La suppression par un tiers est **auditée** par `deleted_by`.

`updated_at` **n'est pas ajoutée**, seul écart assumé à la convention générale ci-dessous :
`edited_at` et `deleted_at` nomment les deux seules évolutions possibles d'un commentaire, et les
confondre serait perdre de l'information (`docs/SPEC-cards.md` §13.2).

**Première table du produit publiée au temps réel.** `alter publication supabase_realtime add table
public.card_comments` : `realtime.apply_rls` évalue alors la politique `SELECT` pour chaque abonné,
de sorte qu'un membre sans accès à la card ne reçoit **rien** (`docs/SPEC-cards.md` §13.9).

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
| `type` | `text` | `CHECK` sur les **dix** valeurs livrées : `created`, `moved`, `assigned`, `channel_changed`, `workflow_changed`, `archived`, `unarchived`, `trashed`, `restored`, `field_changed` |
| `actor_id` | `uuid` | nul si l'auteur est un service — FK `profiles(id)` `ON DELETE SET NULL` |
| `payload` | `jsonb` | non nul, défaut `'{}'` ; avant/après, **sans aucun libellé** (`docs/SPEC-cards.md` §14.6) |
| `created_at` | `timestamptz` | non nul, défaut **`clock_timestamp()`** et non `now()` |

**`clock_timestamp()` et non `now()`, et c'est mesuré.** `now()` rend l'heure de début de
transaction : trois événements écrits par un même `UPDATE` porteraient le même horodatage, et
l'ordre du fil deviendrait celui, arbitraire, de leurs `uuid`. MESURÉ le 2026-08-05 :
`clock_timestamp()` rend trois valeurs distinctes, dans l'ordre réel des écritures
(`docs/SPEC-cards.md` §14.3).

**`mail_received` et `mail_sent` sont REFUSÉS par le `CHECK`** tant que `CRM-054` et `CRM-058`
n'écrivent pas ces événements : une valeur autorisée que rien ne produit laisse croire à une
capacité inexistante. `unarchived` et `restored` s'y ajoutent en revanche, le §4 de
`docs/SPEC-cards.md` posant que l'archivage et la corbeille sont **réversibles**.

**`channel_changed` est la neuvième, ajoutée par `CRM-045`**, et son arrivée a éprouvé le mécanisme
que `CRM-044` avait posé : le `CHECK` a refusé la valeur en `23514` tant que la migration ne l'avait
pas étendue, dans le **même** changement que le trigger qui l'écrit. **`workflow_changed` est la
dixième, portée par `CRM-019`.** Les trois gestes s'excluent : un changement de channel prévaut,
sinon un changement de workflow prévaut, sinon seulement un changement d'étape écrit `moved`
(`docs/SPEC-change-channel-workflow.md` §6).

**Aucune colonne `updated_at`**, et ce n'est pas un écart aux conventions générales mais leur
conséquence : une ligne qu'aucun rôle ne peut modifier — pas même `service_role`, pas même le
propriétaire, un trigger `BEFORE UPDATE` levant `card_event_immutable` — n'a pas de date de
dernière modification.

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

**Livré par `CRM-060` tranche 1** (migration `0045`, `docs/SPEC-contacts.md` §2.1).

| Colonne | Type | Contraintes |
|---|---|---|
| `id`, `workspace_id` | `uuid` | |
| `name` | `text` | non nul, `btrim(name) <> ''` |
| `domain` | `text` | unique **partielle** par workspace sur `lower(domain)` — forme canonique en minuscules (RFC 1035) —, pivot du rapprochement des emails |
| `website` | `text` | forme `http(s)://…` lorsqu'il est présent |
| `created_at`, `updated_at` | `timestamptz` | conventions générales |

Contrainte composite ajoutée : `UNIQUE (id, workspace_id)` — rend exprimable la FK composite
depuis `contacts`, sans changer aucun comportement.

### `contacts`

**Livré par `CRM-060` tranche 1** (migration `0045`, `docs/SPEC-contacts.md` §2.2).

| Colonne | Type | Contraintes |
|---|---|---|
| `id`, `workspace_id` | `uuid` | |
| `organization_id` | `uuid` | FK **composite** `(organization_id, workspace_id)` → `organizations`, `on delete set null (organization_id)` — cloisonnement structurel, la liste de colonnes évite d'annuler `workspace_id` non nul |
| `full_name` | `text` | non nul, `btrim(full_name) <> ''` |
| `email` | `text` | unique **partielle** par workspace sur `lower(email)` |
| `phone`, `role_title` | `text` | |
| `source` | `text` | `manual`, `email`, `import` — défaut `manual` |
| `created_at`, `updated_at` | `timestamptz` | conventions générales |

Contrainte composite ajoutée : `UNIQUE (id, workspace_id)` — rend exprimable la FK composite
depuis `card_contacts`.

### `card_contacts`

**Livré par `CRM-060` tranche 1** (migration `0045`, `docs/SPEC-contacts.md` §2.3). Association
n-n, avec un rôle **libre** (`decideur`, `prescripteur`, `technique`, …).

| Colonne | Type | Contraintes |
|---|---|---|
| `workspace_id`, `card_id`, `contact_id` | `uuid` | non nuls |
| `role` | `text` | facultatif, non vide lorsqu'il est présent |
| `created_at` | `timestamptz` | conventions générales |

Clé primaire `(card_id, contact_id)`. FK **composites** vers `cards (id, workspace_id)` et
`contacts (id, workspace_id)`, toutes deux `on delete cascade` : le cloisonnement `workspace_id`
est garanti structurellement, aucun trigger requis.

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
| `status` | `text` | `pending`, `ok`, `error`, `disabled` — **écrit par le serveur seul** |
| `last_sync_at` | `timestamptz` | dernière lecture de messages — dû par `CRM-054` |
| `last_checked_at` | `timestamptz` | dernier **test de connexion**, ajouté par `CRM-052` |
| `last_error` | `text` | **code stable** du §13.7, jamais le texte du serveur distant |

Deux index uniques **partiels** (`CRM-052`, `docs/SPEC-mail-subsystem.md` §13.2) : une boîte
système par workspace — `UNIQUE (workspace_id) WHERE owner_id IS NULL` — et une boîte personnelle
par utilisateur — `UNIQUE (workspace_id, owner_id) WHERE owner_id IS NOT NULL`. Sans le premier,
deux catch-all liraient le même domaine et dédoubleraient chaque message.

`last_checked_at` n'était pas déclarée ici avant `CRM-052`, et son absence confondait deux
questions : « quand ai-je lu des messages » et « quand la connexion a-t-elle été éprouvée ». Seule
la seconde a une réponse tant que `CRM-054` n'est pas livrée.

`status`, `last_error`, `last_checked_at`, `last_sync_at`, `sync_state` et `secret_id` sont
**fermées en écriture** à `authenticated` : leur valeur est un constat du serveur. L'écriture d'un
compte passe par `app.upsert_mail_inbound_account`, seul chemin ouvert au client, et le mot de
passe n'atteint jamais la table — il va dans Vault.

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
| `is_default` | `boolean` | une seule par utilisateur — index unique **partiel**, et un trigger **rabat** les autres au lieu de refuser (`CRM-053`, `docs/SPEC-mail-subsystem.md` §14.2) |
| `daily_quota` | `integer` | garde-fou anti-abus. **Révisée par `CRM-058`** : `NULL` = aucun plafond, un entier = le plafond du jour **UTC**, `0` = cette identité n'envoie pas. Le `not null default 0` d'origine interdisait tout envoi dès qu'un consommateur existait — mesuré |
| `status`, `last_error` | | mêmes règles qu'au §12 des comptes entrants : écrites par le serveur seul, `last_error` portant l'un des six codes du §13.7 |
| `last_checked_at` | `timestamptz` | dernier test de connexion, ajouté par `CRM-053` |

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
| `suggested_card_id` | `uuid` | FK `cards` `on delete set null`, nul par défaut — **suggestion** de la règle 3 du classement (`CRM-060` tranche 2) : card d'un contact expéditeur rattaché à **exactement une** card active. INDICE de tri, jamais un rattachement ; le message reste non classé |
| `suggested_at` | `timestamptz` | horodate le calcul de la suggestion, nul si aucune |
| `filed_at` | `timestamptz` | quand le message a été COPIÉ dans le dossier de sa card — `CRM-059` §20.5, nul si non rangé ou rangement manqué |
| `snoozed_until` | `timestamptz` | mise en sommeil : non nulle ET future ⇒ la card dort. **Fermée en écriture à `authenticated` depuis `CRM-081`** — elle s'écrit par `snooze_card` et `wake_card` |
| `search_tsv` | `tsvector` | index GIN |

**Livré par `CRM-059`** : `messages_a_ranger(account_id)` rend les messages classés dont aucune
occurrence n'a jamais été rangée, pour ce compte — une seule ligne par message, sa plus ancienne
occurrence. `marquer_message_range(message_id)` ferme le fait après une copie IMAP réussie, jamais
à la classification. Réservées à `service_role` — migration 32.

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

**Livré par `CRM-057`** : jusque-là, le bucket `mail-attachments` ne portait **aucune** politique et
refusait donc tout le monde. La politique de lecture de `storage.objects` n'ouvre que
l'intersection « bucket `mail-attachments` » ∩ « pièce `clean` » ∩ « message visible »
(`app.peut_voir_message`). Aucune écriture n'est ouverte : le dépôt reste le fait de `service_role`.

### `mail_outbox`
File d'envoi persistante. **Livrée par `CRM-058`** (migration 30). Aucune écriture par un client :
`queue_outbound_email` est la seule porte, et elle oppose six refus (`docs/SPEC-mail-subsystem.md`
§19.4). La lecture suit la card : un envoi appartient à l'affaire au nom de laquelle il part.

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

### `mail_thread_snoozes` — le sommeil d'un FIL (`CRM-081`, migration 48)

Spécification : `docs/SPEC-cards.md` §16.14.

| Colonne | Type | Contraintes |
|---|---|---|
| `workspace_id` | `uuid` | FK `workspaces` `ON DELETE CASCADE` — avec `thread_key`, la **clé primaire** |
| `thread_key` | `text` | non nul, `CHECK (btrim(thread_key) <> '')` — la racine RFC 5322 du fil |
| `snoozed_until` | `timestamptz` | **non nulle** : une ligne sans échéance n'a pas de sens que son absence ne dise mieux |
| `snoozed_by` | `uuid` | FK `profiles` `ON DELETE SET NULL` — écrit par la fonction, jamais offert au client |
| `created_at`, `updated_at` | `timestamptz` | `updated_at` par `app.set_updated_at()` |

**Un fil est en sommeil si sa ligne existe ET que `snoozed_until` est strictement postérieure à
`now()`** — le prédicat de `cards.snoozed_until`, transposé sans changement, et la sortie reste
**implicite** : aucun réveil n'est planifié. **Le réveil SUPPRIME la ligne** ; l'absence est la
représentation de « éveillé ».

**Il n'y a AUCUNE colonne de fil sur `mail_messages`**, et c'est un choix motivé (§16.14.2) : la
clé est rendue par `app.cle_fil(references_ids, rfc822_message_id)` — `immutable` —, et un index
d'expression `mail_messages_cle_fil_idx` sur `(workspace_id, app.cle_fil(…))` sert la garde. Une
colonne générée déplacerait la liste des colonnes de la table, que plusieurs preuves figent, sans
servir aucune règle de la tranche.

**Fermée en écriture PAR LE PRIVILÈGE** : `revoke all … from anon, authenticated`, puis `select`
seul à `authenticated`. Les deux RPC `security definer` `public.snooze_thread(uuid, text,
timestamptz)` et `public.wake_thread(uuid, text)` sont le seul chemin. L'unique politique,
`mail_thread_snoozes_lecture`, porte `app.fil_lisible(workspace_id, thread_key)` — **le même
prédicat que les deux gardes**, pour que la ligne visible et le fil visible ne divergent jamais.

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

### Objets privés d'ordonnancement

`CRM-017` ajoute `app.scheduler_heartbeat`, table `UNLOGGED` non exposée à l'API : une ligne
`scheduler`, un compteur d'exécutions et la date du dernier passage. La fonction privée
`app.scheduler_heartbeat_tick()` l'alimente et ramène le job nommé
`p2enjoy-scheduler-heartbeat` de sa cadence d'amorçage à sa cadence horaire. Le catalogue et
l'historique natifs restent dans le schéma `cron`. Aucun des rôles `anon`, `authenticated` ou
`service_role` n'a de privilège sur ces objets (`docs/SPEC-scheduler.md`).

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
| `move_card_to_channel(card_id, to_channel_id, to_step_id, discard_field_values)` | Changement de channel — donc potentiellement de **workflow** — avec remappage **explicite** de l'étape : aucun remappage automatique par clé de nœud. Rend `public.cards`. `SECURITY DEFINER`, `search_path` vide, `EXECUTE` **révoqué nommément à `anon`**. Le droit d'écriture est exigé sur les **deux** channels. Huit refus : `card_not_found`, `forbidden`, `channel_not_found`, `same_channel`, `step_mapping_required`, `step_not_in_workflow`, `field_values_would_be_lost` (`docs/SPEC-workflow-engine.md` §6.4). Le paramètre `step_mapping` annoncé à l'origine par ce §9 désignait une **fonction différente**, désormais nommée `change_channel_workflow` — décision 263, INC-046 et INC-073 | **livrée** par `CRM-045`, **inchangée** |
| `change_channel_workflow(channel_id, workflow_id, step_mapping, discard_field_values)` | Un **channel entier** change de workflow, et l'étape de **toutes** ses cards est remappée en un appel. `step_mapping` est un tableau JSON exact `{from_step_id,to_step_id}` couvrant chaque étape occupée une fois ; plusieurs sources peuvent converger. Les réponses sont refusées par défaut et détruites seulement sur opt-in. Rend `SETOF public.cards` (`docs/SPEC-change-channel-workflow.md`) | **livrée** — `CRM-019`, migration 20, décisions 263, 295 et 306 |
| `app.scheduler_heartbeat_tick()` | Incrémente le heartbeat opérationnel puis ramène le job `pg_cron` à sa cadence nominale ; privée, sans argument, `search_path` vide, exécutable uniquement par le propriétaire PostgreSQL | **livrée** — `CRM-017`, `docs/SPEC-scheduler.md` |
| `queue_outbound_email(card_id, identity_id, to, subject, body_text, cc, in_reply_to_message_id)` | Seule porte de la file d'envoi. Six refus : `not_authenticated`, `forbidden` (droit d'**écriture** sur la card), `identity_not_available`, `card_not_available` (fermée **ou sans adresse**), `recipient_required`, `quota_exceeded`. `SECURITY DEFINER`, `search_path` vide | **livrée** — `CRM-058`, migration 30 |
| `reserver_envois(limite)` / `marquer_envoi_reussi(...)` / `marquer_envoi_echoue(...)` | Ce que le worker appelle. La réservation est faite par la BASE dans la même instruction que la lecture (`skip locked`) : deux workers n'enverraient pas deux fois le même message. Le succès produit **trois effets solidaires** — file marquée, message archivé en `outbound`, timeline écrite. Réservées à `service_role` | **livrées** — `CRM-058`, migration 30 |
| `app.envois_du_jour(identity_id)` | Envois de la journée UTC, **en vol compris** : compter les seuls `sent` laisserait mettre mille messages en file | **livrée** — `CRM-058`, migration 30 |
| `classify_message(message_id, card_id)` | Classement manuel d'un message, journalisé. **Révisée par `CRM-057`** : elle exige désormais **les deux** droits — voir le message **et** écrire dans la card. Le seul droit d'écriture aurait permis de classer chez soi un message qu'on n'a pas le droit de lire, puis de le lire (`docs/SPEC-mail-subsystem.md` §18.2) | **livrée** — `CRM-055`, migration 25 ; garde ajoutée par `CRM-057`, migration 28 |
| `app.peut_voir_message(message_id)` | Visibilité d'un message : sa card s'il est classé, sa **boîte** s'il ne l'est pas — propriétaire du compte ou administrateur du workspace. Support des politiques de `mail_messages`, `mail_attachments` et du bucket `mail-attachments`. `SECURITY DEFINER`, `search_path` vide | **livrée** — `CRM-057`, migration 28 |
| `app.workflow_composition_document(workflow_id)` | Document `jsonb` **canonique** de la composition d'un workflow — six clés, chaque collection triée par identifiant. Extrait de `app.workflow_composition_fingerprint`, qui devient son appelant : la forme canonique n'a désormais qu'une seule définition. `STABLE`, `search_path` vide | **livrée** — `CRM-078`, migration 39 |
| `publish_workflow_version(workflow_id, note)` | Fige une **photographie immuable** de la composition d'un workflow : numéro suivant dans la portée du workflow, document, empreinte, auteur. Sérialise sur la ligne du workflow (`for update`) avant de lire le numéro. Cinq refus : appelant non authentifié (`42501`), `workflow introuvable`, `publication reservee aux administrateurs` (`42501`), `workflow archive`, `composition inchangee`. `SECURITY DEFINER`, `search_path` vide, `EXECUTE` **révoqué nommément à `anon`** (`docs/SPEC-workflow-engine.md` §7 ter.5) | **livrée** — `CRM-078`, migration 39 |
| `app.composition_collection_diff(base, target, identity_keys)` | Différence entre deux tableaux d'objets `jsonb` appariés par une identité donnée : `added`, `removed`, `modified` avec le détail attribut par attribut. Ne connaît rien aux workflows — un seul algorithme, appelé six fois. `IMMUTABLE`, `search_path` vide | **livrée** — `CRM-078`, migration 40 |
| `compare_workflow_versions(base_version_id, target_version_id)` | Compare deux versions d'un **même** workflow et rend `base`, `target`, `identical`, `summary` et `changes` sur les six collections. **Aucune correspondance n'est devinée** : l'identité est faite d'identifiants réels et d'eux seuls. `STABLE`, **`SECURITY INVOKER`** — la politique de lecture de `workflow_versions` est déjà la règle d'autorisation exacte. Quatre refus : appelant non authentifié (`42501`), `version introuvable` pour la base comme pour la cible, `versions de workflows differents`. `EXECUTE` **révoqué nommément à `anon`** (`docs/SPEC-workflow-engine.md` §7 ter.11) | **livrée** — `CRM-078`, migration 40 |
| `compare_workflow_with_source(workflow_id)` | Dit en quoi une **copie** s'écarte de sa source vivante, et rend `workflow`, `source`, `identical`, `summary` et `changes` sur cinq collections. L'appariement se fait sur les **clés naturelles du remappage** (`node_id`, le couple de nœuds, `key`) : la copie ne partage aucun identifiant de composition avec sa source, mesuré. `STABLE`, **`SECURITY INVOKER`** — la politique de lecture de `workflows` est déjà la règle d'autorisation exacte. Quatre refus : appelant non authentifié (`42501`), `workflow introuvable`, `workflow non derive`, `source introuvable`. `EXECUTE` **révoqué nommément à `anon`** (`docs/SPEC-workflow-engine.md` §4 ter) | **livrée** — `CRM-032`, migration 43 |
| `snooze_card(card_id, until)` / `wake_card(card_id)` | Seuls chemins par lesquels `cards.snoozed_until` prend et perd sa valeur. Rendent `public.cards`. `SECURITY DEFINER`, `search_path` vide, `EXECUTE` **révoqué nommément à `anon`**. Refus de `snooze_card`, dans l'ordre : `card_not_found` (inexistante, archivée, en corbeille ou channel illisible), `forbidden` (`42501`), `snooze_date_required`, `snooze_date_in_past`. `wake_card` n'a aucun refus propre et est **idempotente** (`docs/SPEC-cards.md` §16) | **livrées** — `CRM-081`, migration 44 |
| `plan_card_remapping(target_version_id, step_overrides, card_limit)` | Avant de restaurer une version, dit **card par card où elle atterrit** : `unchanged` quand l'étape existe des deux côtés, `remapped` quand l'appelant a donné une instruction, `unresolved` sinon — **aucune destination n'est devinée**. Rend `version`, `ready`, `summary`, `steps.removed`/`restored` et une liste d'affaires **bornée dont la troncature est annoncée**. Couvre les cards archivées et en corbeille, qui portent une clé étrangère opposable. Huit refus : appelant non authentifié (`42501`), `version introuvable`, `plan reserve aux administrateurs` (`42501`), `limite invalide`, `remappage invalide`, `remappage ambigu`, `origine de remappage inconnue`, `cible de remappage absente de la version`. `STABLE`, **`SECURITY INVOKER`** — exhaustif parce que réservé aux administrateurs, qu'un droit fin ne restreint jamais (règle 2 de `app.resolve_access`). `EXECUTE` **révoqué nommément à `anon`** (`docs/SPEC-workflow-engine.md` §7 ter.12) | **livrée** — `CRM-078`, migration 41 |
| `restore_workflow_version(target_version_id, step_overrides, expected_live_fingerprint)` | Rend la composition vivante d'un workflow égale à celle qu'une version a photographiée, **en une transaction ou pas du tout**. Rejoue `plan_card_remapping` dans sa propre transaction — un plan pré-calculé n'est jamais accepté — et exige `ready`. Publie d'abord la composition vivante comme **point de retour** par la vraie RPC `publish_workflow_version`, sauf lorsque la dernière version joue déjà ce rôle : le **retour arrière** est alors la restauration de ce point, donc le même code. Restaure `steps`, `transitions`, `fields`, `rules` et `required_fields` ; **jamais la clé `workflow`** — nom, portée, track, défaut et archivage sont l'identité et le placement, non la composition. **Un champ surnuméraire est ARCHIVÉ, jamais supprimé** : `form_fields` ne porte aucune politique `delete` et `card_field_values` porte les saisies. Rend les compteurs par collection, `rollback_version`, `fingerprint_after` et `matches_version`. Huit refus : appelant non authentifié (`42501`), `version introuvable`, `restauration reservee aux administrateurs` (`42501`), `workflow archive`, `structure modifiee depuis le plan` (`409`), les refus du plan **remontés tels quels**, `plan non applicable`, `noeud de catalogue introuvable`. `VOLATILE`, **`SECURITY DEFINER`** — MESURÉ : `authenticated` ne détient l'`UPDATE` sur `cards` que sur douze colonnes, dont `current_step_id` ne fait pas partie, comme pour `move_card` et `change_channel_workflow` ; la vérification d'appartenance au workspace est donc écrite à la main. `EXECUTE` **révoqué nommément à `anon`** (`docs/SPEC-workflow-engine.md` §7 ter.13) | **livrée** — `CRM-078`, migration 42 |

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
| `public.workflow_derivations` | Une ligne par workflow dérivé : son origine, la date de la copie, le dernier `updated_at` disponible de la source et de sa composition horodatée — catalogue de nœuds utilisé compris —, et le booléen exact de divergence par empreinte. `security_invoker = true`, lecture seule (docs/SPEC-workflow-engine.md §4.6) | livrée (`CRM-032`), révisée par `CRM-018` |

Une vue exposée à l'API est toujours `security_invoker = true` : sans ce réglage, elle lirait ses
tables avec les droits de son propriétaire et deviendrait une porte dérobée sur des tables
protégées par RLS.

---

## 9 bis. Objectifs et coûts

Écrit avant tout code, 2026-08-19 — `docs/SPEC-goals.md` et `docs/SPEC-costs.md`, décisions 431 et
432. Toutes ces tables portent `id uuid`, `created_at` et `updated_at`, conformément aux conventions
du §2, et sont en refus par défaut (`enable row level security`, aucune politique implicite).

### 9 bis.1 `goal_boards` — tableau d'objectifs

| Colonne | Type | Règle |
|---|---|---|
| `workspace_id` | `uuid` | non nul, `on delete cascade` |
| `name` | `text` | non vide ; unique par workspace sur la forme normalisée |
| `description` | `text` | |
| `position` | `numeric` | non nul, attribuée par trigger si omise — convention `tracks` |
| `archived_at` | `timestamptz` | l'archivage tient lieu de suppression |
| `created_by` | `uuid` | `profiles`, `on delete set null` |

### 9 bis.2 `goal_blocks` — bloc

| Colonne | Type | Règle |
|---|---|---|
| `board_id` | `uuid` | non nul, `on delete cascade` |
| `title` | `text` | non vide |
| `body` | `text` | |
| `fill_percent` | `smallint` | non nul, défaut `0`, `CHECK (0 <= x <= 100)` — **saisi, jamais calculé** |
| `channel_id` | `uuid` | **nullable**, `on delete set null` — le lien survit à la destination |
| `pos_x`, `pos_y` | `numeric` | non nuls |
| `width`, `height` | `numeric` | non nuls, `CHECK (> 0)` |
| `color` | `text` | `CHECK (in ('brand','success','accent','danger','neutral'))` — nom de jeton, jamais un hexadécimal |
| `created_by` | `uuid` | `profiles`, `on delete set null` — **trace, jamais un droit** |

### 9 bis.3 `goal_links` — flèche

| Colonne | Type | Règle |
|---|---|---|
| `board_id` | `uuid` | non nul, `on delete cascade` — **redondance délibérée**, `SPEC-goals` §2.4 |
| `source_block_id`, `target_block_id` | `uuid` | non nuls, `on delete cascade` |
| `direction` | `text` | `CHECK (in ('forward','backward','both'))` — `->`, `<-`, `<->` |
| `label` | `text` | |

`CHECK (source_block_id <> target_block_id)`. Unique sur `(source_block_id, target_block_id)`.
Trigger : les deux blocs appartiennent à `board_id`. **Aucun refus de cycle** — un objectif qui en
nourrit un autre en retour est une intention légitime.

### 9 bis.4 `budgets`

| Colonne | Type | Règle |
|---|---|---|
| `track_id` | `uuid` | non nul, `on delete cascade` |
| `name` | `text` | non vide ; unique par track **parmi les budgets non clôturés** (index partiel `where closed_at is null`) |
| `currency` | `text` | non nul, défaut `'EUR'`, `CHECK (~ '^[A-Z]{3}$')` — convention `cards.currency` |
| `planned_amount` | `numeric(14,2)` | facultatif ; **aucune contrainte de signe**, comme `cards.amount` |
| `is_recurrent` | `boolean` | non nul, défaut faux |
| `closed_at` | `timestamptz` | nul tant que le budget est ouvert |
| `position` | `numeric` | non nul, attribuée par trigger si omise |

### 9 bis.5 `budget_occurrences`

| Colonne | Type | Règle |
|---|---|---|
| `budget_id` | `uuid` | non nul, `on delete cascade` |
| `label` | `text` | non vide, unique par budget |
| `period_start`, `period_end` | `date` | facultatives, **purement descriptives** — elles ne contraignent aucune ligne |
| `planned_amount` | `numeric(14,2)` | facultatif |
| `closed_at` | `timestamptz` | se clôture indépendamment de son budget |

Trigger : une occurrence n'existe que sur un budget `is_recurrent`. **Aucune génération
automatique**, jamais — `SPEC-costs` §2.2.

### 9 bis.6 `card_costs` — lignes de coût d'une affaire

| Colonne | Type | Règle |
|---|---|---|
| `card_id` | `uuid` | non nul, `on delete cascade` |
| `budget_id` | `uuid` | non nul, `on delete restrict` — un budget ne se supprime pas, il se clôture |
| `occurrence_id` | `uuid` | **nul si le budget n'est pas récurrent, non nul s'il l'est** — trigger ; `on delete restrict` |
| `label` | `text` | non vide |
| `estimated_cost` | `numeric(14,2)` | **non nul** |
| `actual_cost` | `numeric(14,2)` | **nullable — nul n'est pas zéro** |
| `created_by` | `uuid` | `profiles`, `on delete set null` |

**Aucune colonne `currency`** : la devise est celle du budget. La porter ici permettrait
d'additionner deux devises dans un même total. **Aucune unicité** sur `(card_id, budget_id)` ni sur
`(card_id, label)` : une affaire porte autant de lignes qu'elle a de natures de dépense — publicité,
production —, et deux achats de même nature restent deux lignes.

Triggers : refus d'insertion sur un budget ou une occurrence **clôturés** ; l'occurrence appartient
au budget cité.

**`occurrence_id` est `on delete restrict`, et c'est le seul choix cohérent avec le trigger**
(`CRM-085`, migration 51). Une occurrence détruite sous ses lignes laisserait `occurrence_id` nul
sur un budget récurrent, c'est-à-dire l'invariant ci-dessus **faux sans qu'aucune ligne interdite
n'ait jamais été écrite** — la même brèche que la décision 471 a fermée entre `budgets` et
`budget_occurrences`.

**Et l'invariant se tient aussi depuis `budgets`.** Rendre récurrent un budget simple qui porte
déjà des lignes les laisserait sans occurrence sur un budget désormais récurrent : un second
trigger sur `budgets` le refuse tant que des lignes y sont rattachées (`app.budgets_verifier_
recurrence_lignes`), pendant exact de `app.budgets_verifier_recurrence` (`CRM-084`), qui garde le
sens inverse.

**La clôture n'interdit que le RATTACHEMENT, jamais la saisie du réel** (`SPEC-costs` §2.3) : le
trigger refuse l'insertion et le changement de `budget_id` ou d'`occurrence_id` — des deux côtés,
celui qu'on quitte comme celui qu'on rejoint —, et ne s'oppose ni à `actual_cost` ni au `label`.

### 9 bis.7 Politiques

| Table | Lecture | Écriture |
|---|---|---|
| `goal_boards` | membre du workspace | **membre du workspace** — `SPEC-goals` §4.2 |
| `goal_blocks` | lecture du tableau **et**, si `channel_id` non nul, `app.can_read_channel` | membre ; `app.can_write_channel` **exigé pour poser un lien** |
| `goal_links` | lecture du tableau | écriture sur les deux blocs reliés |
| `budgets` | `app.can_read_track(track_id)` | `admin` du workspace |
| `budget_occurrences` | lecture du budget | `admin` du workspace |
| `card_costs` | `app.can_read_card(card_id)` **et** lecture du budget | `app.can_write_card(card_id)`, budget lisible et **ouvert** — **sauf la mise à jour**, qui n'exige pas le budget ouvert (§2.3 : le réel se saisit après la clôture) |

**La double condition de lecture de `card_costs` n'est pas redondante** : card et budget peuvent
relever de deux tracks dont l'appelant ne lit que l'un.

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
