# Spécification — Cards

Unité de backlog : `CRM-040` (voir `docs/BACKLOG.md`).
Documents liés : `docs/SCHEMA.md` §5 (cards), §9 (fonctions), §10 (index),
`docs/SPEC-permissions-rls.md` §3 (fonctions d'autorisation), §4 (politiques), §7 (preuves de refus),
`docs/SPEC-channels.md` (le parent), `docs/SPEC-workflow-engine.md` §2.6 (archivage d'un nœud
occupé), §3.3 (étapes), §5 (`move_card`), `docs/SPEC-form-composer.md` §2 (champs),
`docs/SPEC-seed.md` §2 (contrat du seed), `docs/manual.md`.

Cette spécification est écrite **après mesure** du comportement réel de la pile épinglée —
PostgreSQL `supabase/postgres:17.6.1.136`, PostgREST `v14.12`, GoTrue `v2.189.0` — et non de
mémoire. Les contraintes, les `SQLSTATE` et les codes HTTP cités aux §2, §4 et §8 ont été
**observés** sur des tables sondes jetables — `public.sonde_c1` à `public.sonde_c4` —, créées puis
détruites avant la rédaction, selon le procédé de `docs/JOURNAL.md` décision 52. La destruction est
constatée : `to_regclass('public.sonde_c4')` rend `NULL`.

---

## 1. Objet et périmètre

La card est l'**objet métier principal** du produit, au sens de `CLAUDE.md` §4 : une affaire, une
opportunité, un dossier. Elle naît dans un channel (`CRM-021`), à une étape d'un workflow
(`CRM-031`), et tout le reste du CRM — formulaires, commentaires, timeline, messagerie — s'y
rattache.

Jusqu'à cette unité, le produit décrivait une **organisation vide** : des tracks, des channels, des
graphes d'états et un vocabulaire de formulaire, sans rien à y ranger. MESURÉ avant écriture, sur la
base du seed, la pile en marche :

```
cards=NULL  card_events=NULL  card_comments=NULL  card_field_values=NULL
card_activities=NULL  move_card=NULL  app.can_read_card=NULL
```

### 1.1 Dans le périmètre

1. La table `public.cards`, conforme à `docs/SCHEMA.md` §5, aux réserves du §2.9 près.
2. L'**adresse email générée** : `email_local_part`, de la forme `c-<8 caractères base32>`, unique
   globalement et **non devinable** (§3).
3. Le **responsable** (`owner_id`) et le **montant** (`amount`, `currency`), que l'énoncé de
   `CRM-040` nomme explicitement.
4. L'**archivage** (`archived_at`) et la **corbeille** (`deleted_at`) : deux suppressions douces
   **distinctes**, réversibles, sans suppression physique (§5).
5. La **cohérence structurelle** : une card ne peut pas mentir sur son workspace, ni porter un
   workflow autre que celui de son channel, ni pointer une étape d'un autre workflow (§2.4). Les
   trois sont tenues par des **clés étrangères composites**, non par des triggers.
6. `app.can_read_card(card uuid)` — la **quatrième et dernière** fonction d'autorisation différée
   par INC-013, dont la cible existe désormais (§6.2).
7. Les **politiques RLS** de `cards` : lecture par droit effectif sur le channel, écriture réservée
   à qui a le droit d'écriture sur ce channel, prouvées hors interface avec les jetons réels des
   trois profils seedés.
8. La **garde d'archivage d'un nœud occupé** — INC-031, dont la dernière table manquante est
   livrée ici (§7).
9. L'**ordre** dans une colonne de board : `position`, numérique, attribuée automatiquement dans la
   portée `(channel, étape courante)`.
10. La **recherche plein texte** : `search_tsv`, colonne générée, index GIN (§2.7).
11. Le **seed** : des cards de démonstration réparties sur plusieurs channels et plusieurs étapes,
    dont une archivée et une en corbeille.

### 1.2 Hors périmètre, et nommé comme tel

| Ce qui n'est pas livré | Pourquoi, et par qui |
|---|---|
| `move_card` et ses six vérifications | `CRM-034`. Cette unité livre sa **cible**, pas la garde. Tant qu'elle n'existe pas, `current_step_id` s'écrit directement — voir §9, limite n° 1 |
| La **protection de colonne** de `current_step_id` et de `email_local_part` — `REVOKE`, non modifiables directement | `CRM-013`, dont la Definition of Done les nomme mot pour mot. S'en emparer ici rouvrirait une unité `[ ]` distincte. Cette unité **génère** l'adresse ; elle ne la **protège** pas en mise à jour (§3.4) |
| `card_events`, donc toute timeline et tout événement `created` ou `moved` | `CRM-044`. Aucun trigger d'événement n'est écrit : il n'aurait pas de table où écrire |
| `card_comments` | `CRM-043` |
| `card_field_values`, donc toute valeur de formulaire et toute validation de type | `CRM-036` |
| `card_activities`, `tags`, `card_tags`, `card_watchers`, `card_checklists`, `card_templates` | Tables satellites de `docs/SCHEMA.md` §5, qu'aucune unité du chunk 3 ne porte. Les créer ici préempterait des unités qui n'existent pas encore au backlog |
| `move_card_to_channel` | `CRM-045` |
| Le recalcul de `health_score` | Aucun ordonnanceur n'existe. La colonne est livrée, **jamais alimentée**, et le dire vaut mieux que de laisser croire l'inverse (§2.9) |
| Le **board**, la **vue liste**, le **glisser-déposer** | `CRM-041`, `CRM-042` |
| Toute **interface** de création, d'édition, d'archivage ou de corbeille | Exige une session, donc un écran de connexion, qu'aucune unité ne porte — **INC-021**. Le CRUD est livré et prouvé **par l'API**, ce que `CLAUDE.md` §10 exige de toute façon |

## 2. Modèle de données

### 2.1 Table `public.cards`

| Colonne | Type | Contraintes | Motif |
|---|---|---|---|
| `id` | `uuid` | PK, défaut `gen_random_uuid()` | Convention générale de `docs/SCHEMA.md` |
| `workspace_id` | `uuid` | non nul, FK `workspaces(id)` `ON DELETE CASCADE` | Cloisonnement. Dénormalisé, et **rendu véridique** par la clé composite du §2.4 |
| `channel_id` | `uuid` | non nul | Parent. Sa clé étrangère est portée par les contraintes composites du §2.4, pas par une clé simple |
| `workflow_id` | `uuid` | non nul | Le workflow de la card. **Toujours celui de son channel**, garanti structurellement (§2.4) |
| `current_step_id` | `uuid` | non nul | L'étape courante. **Toujours une étape de `workflow_id`**, garanti structurellement (§2.4) |
| `title` | `text` | non nul, non vide après `btrim` | Libellé affiché — une **donnée**, pas une traduction (`docs/DESIGN_SYSTEM.md` §10) |
| `description` | `text` | | Corps libre |
| `position` | `numeric` | non nul, **sans défaut de colonne** | Index fractionnaire, comme `tracks.position` et `channels.position`. Le trigger du §2.6 la renseigne lorsqu'elle est omise |
| `owner_id` | `uuid` | FK `profiles(id)` `ON DELETE SET NULL` | Le **responsable**. Nullable : une card sans responsable est un état licite, et `docs/SPEC-permissions-rls.md` §8.1 retient la conservation plutôt que la réaffectation forcée |
| `amount` | `numeric(14,2)` | | Montant de l'affaire. **Aucune contrainte de signe** — voir §10, point ouvert n° 1 |
| `currency` | `text` | défaut `'EUR'`, `CHECK` trois lettres majuscules | Code ISO 4217 dans sa **forme**. La base ne connaît pas la liste des devises réelles, et le dire est plus honnête qu'une liste figée qui vieillirait |
| `probability_override` | `numeric(5,2)` | `CHECK` entre 0 et 100 inclus | Sinon celle de l'étape (`workflow_steps`). Même borne que `workflow_nodes_catalog.probability` |
| `next_action` | `text` | | Prochaine action à mener |
| `next_action_at` | `timestamptz` | | Échéance, alimentera la vue « Ma journée » |
| `entered_step_at` | `timestamptz` | non nul, défaut `now()` | Date d'entrée dans l'étape courante, base des relances. **Non maintenue** tant que `move_card` n'existe pas (§9) |
| `health_score` | `integer` | | Recalculé par l'ordonnanceur, qui n'existe pas (§2.9) |
| `email_local_part` | `text` | non nul, **unique globalement**, `CHECK` de forme | Généré par le trigger du §3 |
| `snoozed_until` | `timestamptz` | | Mise en sommeil |
| `archived_at` | `timestamptz` | | Archivage (§5) |
| `deleted_at` | `timestamptz` | | Corbeille (§5) |
| `created_by` | `uuid` | FK `profiles(id)` `ON DELETE SET NULL` | Auteur de la création |
| `created_at`, `updated_at` | `timestamptz` | non nuls, défaut `now()` | Conventions générales de `docs/SCHEMA.md`, que le tableau du §5 omet pour cette table comme pour les précédentes (INC-025) |
| `search_tsv` | `tsvector` | colonne **générée**, `STORED` | §2.7 |

### 2.2 Ce que le tableau de `docs/SCHEMA.md` §5 omet

`created_at` et `updated_at` n'y figurent pas, alors que les « Conventions générales » du même
document les imposent à toute table métier. C'est la **troisième** occurrence d'INC-025, après
`tracks` et `channels` : le tableau de référence est incomplet, la convention fait foi, et l'écart
est signalé plutôt que résolu en silence.

### 2.3 Contraintes de valeur

| Contrainte | Règle | Motif |
|---|---|---|
| `cards_title_check` | `btrim(title) <> ''` | Un titre d'espaces n'est pas un titre. Même règle que `tracks` et `channels` |
| `cards_currency_check` | `currency ~ '^[A-Z]{3}$'` | Forme ISO 4217. Ni la liste, ni son actualité |
| `cards_probability_override_check` | `probability_override between 0 and 100` | Nullable : la contrainte ne s'applique qu'à une valeur fournie |
| `cards_email_local_part_check` | `email_local_part ~ '^c-[0-9abcdefghjkmnpqrstvwxyz]{8}$'` | La forme du §3, tenue par la base et non seulement par le trigger qui la produit |

Toutes sont **convergentes** : `drop constraint if exists` puis `add constraint`, de sorte qu'un
rejeu de la migration **répare** une contrainte retirée à la main plutôt que de la laisser dégradée
(décision 57, généralisée par `CRM-021`).

### 2.4 Trois clés étrangères composites, et ce que chacune rend impossible

Aucune de ces trois règles n'est confiée à un trigger. Un trigger se contourne par un `DISABLE
TRIGGER`, se trompe sur les mises à jour concurrentes, et ne dit rien de l'état déjà en base. Une
clé étrangère composite est vérifiée par le moteur, à l'insertion **comme** à la mise à jour, des
deux côtés de la relation.

| Contrainte | Colonnes | Référence | Ce qu'elle rend impossible |
|---|---|---|---|
| `cards_channel_id_workspace_id_fkey` | `(channel_id, workspace_id)` | `channels (id, workspace_id)` | Une card dont le `workspace_id` dénormalisé diffère de celui de son channel |
| `cards_channel_id_workflow_id_fkey` | `(channel_id, workflow_id)` | `channels (id, workflow_id)` | Une card dont le workflow n'est pas celui de son channel |
| `cards_current_step_id_workflow_id_fkey` | `(current_step_id, workflow_id)` | `workflow_steps (id, workflow_id)` | Une card posée sur une étape qui appartient à un autre workflow |

**Deux unicités doivent être ajoutées à `channels` pour que ces clés soient possibles.** MESURÉ,
sans elles : `there is no unique constraint matching given keys for referenced table "channels"`.
La migration les pose donc de façon gardée — `channels_id_workspace_id_key` et
`channels_id_workflow_id_key` —, exactement comme `CRM-021` avait dû poser
`tracks_id_workspace_id_key` depuis la migration des channels. Ces unicités ne changent rien au
comportement de `channels` : `id` étant déjà la clé primaire, elles sont **structurellement
redondantes** et ne servent qu'à rendre la référence composite légale.

**La troisième clé livre gratuitement la vérification n° 3 de `move_card`.** MESURÉ sur la sonde
`sonde_c3` : une étape associée à son propre workflow est acceptée ; la même étape associée à un
autre workflow est refusée en `23503`. `docs/SPEC-workflow-engine.md` §5 comptait cette
vérification parmi les six que `CRM-034` devra écrire ; elle n'aura pas à l'écrire, la base la
tient déjà.

**Une conséquence émergente, mesurée, et qui n'est écrite nulle part.** La deuxième clé rend
**refusé** le changement de `channels.workflow_id` d'un channel qui porte au moins une card.
MESURÉ sur `sonde_c4` :

```
ERROR:  update or delete on table "channels" violates foreign key constraint
        "sonde_c4_wf_fk" on table "sonde_c4"
```

Aucune spécification n'énonce cette règle. Elle est **défendable** — repointer le workflow d'un
channel sous des cards existantes les laisserait sur des étapes d'un graphe qu'elles ne suivent
plus —, mais elle n'a pas été décidée par le responsable, et `CRM-045` prévoit précisément un
remappage **explicite** pour le cas voisin du changement de channel. L'écart est consigné en
`docs/INCONSISTENCY_REPORT.md`, **INC-046**, sans être résolu implicitement, et **figé par une
assertion** de la suite pgTAP : le jour où l'arbitrage retiendra une autre règle, l'assertion le
dira.

### 2.5 « Figé à la création » : ce que la base tient, et ce qu'elle ne tient pas

`docs/SCHEMA.md` §5 décrit `workflow_id` comme « figé à la création, suit le channel ». Les deux
membres de la phrase ne demandent pas la même garde :

- « **suit le channel** » est tenu **en permanence** par `cards_channel_id_workflow_id_fkey` : à
  l'insertion comme à toute mise à jour, la paire `(channel_id, workflow_id)` doit exister dans
  `channels` ;
- « **figé** » — au sens d'une colonne qu'aucune mise à jour ne peut toucher — **n'est pas** livré,
  et délibérément. Un tel gel interdirait `move_card_to_channel` (`CRM-045`), dont l'objet est
  précisément de changer `channel_id` **et** `workflow_id` ensemble, de façon cohérente. La
  contrainte composite autorise ce couple cohérent et refuse tout autre.

Ce que la base refuse n'est donc pas « toute écriture de `workflow_id` », mais « toute écriture
incohérente ». C'est la lecture la plus faible des deux, et la seule qui ne préempte pas `CRM-045`.

### 2.6 Ordre dans une colonne de board

`position` est `numeric` et non `integer` : index fractionnaire. Glisser une card entre deux autres
n'exigera pas de renuméroter la colonne entière.

La portée de l'ordre est le couple `(channel_id, current_step_id)` — c'est-à-dire **une colonne du
board**, non le channel entier. Un trigger `BEFORE INSERT`, `SECURITY INVOKER`, `search_path` vidé,
la renseigne lorsqu'elle est omise :

```
position := coalesce(max(position) parmi les cards du même (channel, étape), 0) + 1
```

Le trigger **ne se déclenche pas** lorsqu'une position est fournie, ce qui laisse le seed et les
futures réorganisations maîtriser leur ordre. Aucune unicité n'est posée sur `position` : deux cards
peuvent partager une position, et l'affichage tranche par `created_at`. Une unicité rendrait toute
insertion intercalaire dépendante d'une renumérotation — l'inverse de ce qu'un index fractionnaire
cherche.

### 2.7 Recherche plein texte

`search_tsv` est une colonne **générée** `STORED`, indexée en GIN :

```
to_tsvector('french', coalesce(title,'') || ' ' || coalesce(description,''))
```

MESURÉ sur la sonde : la configuration `'french'` **explicite** rend l'expression immuable, donc
licite dans une colonne générée ; `'Refonte du site' / 'Client historique'` produit
`'client':4 'histor':5 'refont':1 'sit':3`. Une configuration implicite — `to_tsvector(title)` —
dépend de `default_text_search_config`, paramètre de session, et serait refusée.

Le choix de `'french'` est celui de la langue par défaut du produit (`docs/DESIGN_SYSTEM.md` §10,
`CLAUDE.md` §23). Il est **assumé et nommé** : une card rédigée en anglais sera mal racinisée. La
recherche multilingue exigerait une colonne de langue par card, qu'aucune spécification ne demande.

### 2.8 Index

| Index | Colonnes | Usage |
|---|---|---|
| `cards_channel_step_position_idx` | `(channel_id, current_step_id, position)` | Une colonne de board, dans l'ordre |
| `cards_workspace_next_action_idx` | `(workspace_id, next_action_at)` | Vue « Ma journée » |
| `cards_email_local_part_key` | `(email_local_part)` **unique** | §3 |
| `cards_search_tsv_idx` | GIN sur `search_tsv` | Recherche |
| `cards_owner_idx` | `(owner_id)` | Cards d'un responsable |

Les quatre premiers sont ceux de `docs/SCHEMA.md` §10. Le cinquième s'y ajoute : `owner_id` est
nullable et porte une clé étrangère `ON DELETE SET NULL`, dont PostgreSQL n'indexe pas la colonne
référençante — chaque suppression d'un profil imposerait sinon un parcours complet de `cards`.

### 2.9 Colonnes livrées mais non alimentées

Trois colonnes existent parce que `docs/SCHEMA.md` §5 les nomme et que les types générés doivent les
porter, et **rien ne les écrit** :

| Colonne | Ce qui l'alimentera |
|---|---|
| `health_score` | Un ordonnanceur qu'aucune unité du backlog ne porte. Non rattaché, non promis |
| `entered_step_at` | Alimentée à la **création** par son défaut ; sa **remise à zéro** appartient à `move_card` (`CRM-034`) |
| `snoozed_until` | Aucune unité ne porte la mise en sommeil |

Les dire est plus honnête que de laisser croire l'inverse. Aucune n'est omise : le coût de reprise
serait identique, et les types générés doivent refléter le schéma de référence.

## 3. L'adresse email de la card

### 3.1 Ce que la spécification exige

`docs/SCHEMA.md` §5 : « `email_local_part` est généré par trigger sous la forme
`c-<8 caractères base32>`, non devinable afin qu'une adresse divulguée ne permette pas d'énumérer
les autres cards. L'adresse complète est `email_local_part || '@' || workspaces.inbound_domain`. »

Trois exigences distinctes s'y lisent : la **forme**, l'**unicité**, et la **non-devinabilité**.

### 3.2 La forme, et l'alphabet retenu

Huit caractères base32 portent exactement **40 bits**, soit cinq octets. L'alphabet est celui de
Crockford **en minuscules**, `0123456789abcdefghjkmnpqrstvwxyz` : il exclut `i`, `l`, `o` et `u`,
donc les confusions `1`/`l`, `0`/`o`, et le seul mot que l'on ne souhaite pas voir apparaître dans
une adresse tirée au hasard. Les minuscules sont retenues parce qu'une partie locale d'adresse est
traitée sans casse par la quasi-totalité des serveurs, et qu'une adresse recopiée à la main ne doit
pas dépendre de la casse.

MESURÉ sur la pile : PostgreSQL ne sait pas encoder en base32 — `encode()` ne connaît que `hex`,
`base64` et `escape`. La conversion retenue lit les cinq octets comme un entier et le déplie chiffre
par chiffre :

```sql
('x' || encode(gen_random_bytes(5), 'hex'))::bit(40)::bigint
```

MESURÉ : `54514012921 → 1jrmkmqs`, `581002890529 → gx37h391`, `898741571943 → t50jr4b7`. Huit
caractères, systématiquement, y compris pour les valeurs basses — la boucle parcourt les huit
groupes de cinq bits, poids fort en tête, sans supprimer les zéros de tête.

### 3.3 La non-devinabilité, et ce qu'elle coûte

`gen_random_bytes` (pgcrypto 1.3, MESURÉ présent sur la pile) tire d'un générateur
cryptographiquement sûr. L'espace est de 2⁴⁰, soit environ 1,1 × 10¹² adresses.

**La colonne ne peut pas être `GENERATED ALWAYS AS`.** MESURÉ :

```
ERROR:  generation expression is not immutable
```

Une expression aléatoire n'est pas immuable, et PostgreSQL refuse la colonne générée. Le trigger est
donc une nécessité mesurée, non un choix de style.

**Le trigger réessaie, l'index garantit.** Le trigger tire une valeur, vérifie qu'aucune card ne la
porte, et recommence jusqu'à dix fois avant de lever `unique_violation` (`23505`) avec un message
explicite. Cette boucle **ne garantit rien** : deux transactions concurrentes ne voient pas leurs
lignes non validées respectives. Ce qui garantit l'unicité est l'**index unique**
`cards_email_local_part_key`, et lui seul. La boucle ne fait que rendre l'erreur visible
improbable — pour qu'une collision survienne sur un espace de 2⁴⁰, il faudrait environ un million de
cards en base, ce qu'aucun workspace n'atteindra.

Le dire explicitement importe : une boucle de réessai qui **passerait** pour la garantie
d'unicité serait exactement le genre de fausse sécurité que `CLAUDE.md` §18 interdit.

### 3.4 Ce que le trigger fait à l'insertion, et ce qu'il ne fait pas à la mise à jour

À l'**insertion**, le trigger renseigne `email_local_part` **quelle que soit** la valeur fournie par
l'appelant. « Généré » signifie que la valeur ne vient pas du client : accepter une valeur fournie
laisserait un appelant choisir une adresse devinable, ce qui annulerait l'exigence du §3.3.

À la **mise à jour**, le trigger ne fait **rien** — et c'était un manque, désormais **corrigé par
`CRM-013`** : ce n'est pas le trigger qui protège la colonne, c'est le **privilège**. Depuis
`supabase/migrations/0014_colonnes_protegees.sql`, `authenticated` n'a plus `UPDATE` sur
`email_local_part` ; une tentative rend `403` / `42501` et la ligne est relue inchangée
(`docs/SPEC-permissions-rls.md` §4.4).

La distinction mérite d'être tenue : **générer et protéger sont deux gestes**, portés par deux
mécanismes différents et par deux unités différentes. Un trigger de restauration aurait rendu `200`
à un appelant qui croirait avoir renommé l'adresse — la valeur par défaut trompeuse que
`CLAUDE.md` §18 proscrit (`docs/JOURNAL.md`, décision 141).

`service_role` conserve l'écriture : le seed en dépend, et la limite est nommée au §4.4.3 de
`docs/SPEC-permissions-rls.md`.

### 3.5 L'adresse complète n'est pas une colonne

`email_local_part || '@' || workspaces.inbound_domain` est une **dérivation**, pas une donnée. Elle
n'est pas stockée : `inbound_domain` peut changer, et une adresse dénormalisée deviendrait fausse
sans que rien ne le signale. Sa composition appartient à la messagerie (`CRM-054`), qui est le seul
consommateur.

## 4. Cycle de vie

| État | `archived_at` | `deleted_at` | Visible dans |
|---|---|---|---|
| Active | `NULL` | `NULL` | Board, vue liste, recherche |
| Archivée | renseignée | `NULL` | Vue « archives » d'un channel |
| En corbeille | indifférent | renseignée | Corbeille du workspace |

Les deux colonnes sont **indépendantes** : archiver n'est pas supprimer. Une card archivée est un
dossier clos que l'on conserve ; une card en corbeille est une erreur de saisie que l'on efface. La
seconde est la seule qui prétende à une disparition, et elle reste **réversible** : aucune
suppression physique n'est exposée.

**Aucun privilège `DELETE` n'est accordé.** Ni à `anon`, ni à `authenticated`. C'est la même règle
que pour `tracks`, `channels`, `workflow_nodes_catalog` et `form_fields` : ce que le produit appelle
« supprimer » est toujours un horodatage.

**Aucune purge automatique n'est écrite.** Une corbeille qui se vide seule au bout de trente jours
est une règle de rétention, donc une décision de produit et de conformité que personne n'a prise. La
colonne existe, la purge n'existe pas, et le point est ouvert au §10.

## 5. Ce que « active » signifie, et pourquoi la définition compte

Une card est **active** lorsque `archived_at is null and deleted_at is null`.

Cette définition n'est pas décorative : c'est elle que la garde d'archivage d'un nœud occupé (§7)
interroge. Une card en corbeille n'occupe pas son étape ; une card archivée non plus. Sans cette
définition, archiver un nœud du catalogue deviendrait impossible dès qu'une seule card y serait
passée un jour, ce qui viderait la garde de son sens.

## 6. Autorisations

### 6.1 Politiques de `cards`

| Politique | Commande | Prédicat |
|---|---|---|
| `cards_lecture` | `select` | `app.can_read_channel(channel_id)` |
| `cards_insertion` | `insert` | `app.can_write_channel(channel_id)` |
| `cards_maj` | `update` | `app.can_write_channel(channel_id)`, en `USING` **et** en `WITH CHECK` |

Aucune politique `for delete`, aucun privilège `DELETE`.

**Le `WITH CHECK` de la mise à jour est écrit explicitement, et il est pourtant redondant —
mesuré.** Le raisonnement d'origine était que sans lui, un appelant ayant le droit d'écriture sur le
channel A pourrait déplacer une card **vers** le channel B où il n'a rien à faire : le `USING` juge
la ligne **avant** modification, le `WITH CHECK` la juge **après**.

La règle est juste, la conclusion ne l'était pas. MESURÉ sur une politique sonde `for update`
écrite **sans** `with check` : `pg_get_expr(polwithcheck, …)` rend `NULL`, et PostgreSQL
**réutilise le `USING`** pour juger la nouvelle ligne. L'omettre ne rouvre donc rien.

La clause est **conservée**, pour deux raisons, et le fait qu'elle soit redondante est écrit plutôt
que tu : elle rend la règle lisible sans connaître ce détail du moteur, et elle protège d'une
réécriture ultérieure qui donnerait au `USING` une expression plus large que celle qu'on veut
appliquer à la ligne d'arrivée. La preuve de non-complaisance du harnais rend donc le `WITH CHECK`
**permissif** — `with check (true)` — plutôt que de le retirer : le retirer ne dégraderait rien, et
la dégradation serait complaisante sans que rien ne le signale.

**Les prédicats lisent la colonne de la ligne, jamais la card par son identifiant.** C'est la règle
générale écrite au §3.5 de `docs/SPEC-permissions-rls.md` après le défaut trouvé par `CRM-012`
(décision 107) : une politique qui appellerait `app.can_read_card(id)` relirait `cards`, et une
fonction `STABLE` ne voit pas la ligne que l'instruction en cours vient d'écrire — tout
`INSERT … RETURNING` rendrait alors `403`. Le prédicat porte donc sur `channel_id`, colonne de la
ligne jugée.

### 6.2 `app.can_read_card`, et pourquoi elle existe malgré tout

`docs/SPEC-permissions-rls.md` §3 la décrit depuis `CRM-010` ; INC-013 l'a différée quatre fois,
faute de `cards`. Elle est livrée ici, et **close le dernier point d'INC-013**.

```
app.can_read_card(card uuid) → boolean
  = coalesce((select app.can_read_channel(c.channel_id) from public.cards c where c.id = card), false)
```

`SECURITY DEFINER`, `search_path` vidé, `STABLE`, `EXECUTE` accordé à `anon`, `authenticated` et
`service_role` — pour la raison du §3.2 de `docs/SPEC-permissions-rls.md` : un anonyme privé
d'`EXECUTE` recevrait une **erreur de privilège** là où le §7 exige **zéro ligne**.

Elle n'est **pas** employée par les politiques de `cards` (§6.1). Elle existe pour ses **tables
filles** — `card_comments` (`CRM-043`), `card_field_values` (`CRM-036`), `card_events` (`CRM-044`),
`mail_messages` (`CRM-054`) et les politiques de Storage (`docs/SPEC-permissions-rls.md` §5) —, dont
les politiques ne disposent que d'un `card_id` et n'ont aucun moyen d'atteindre le channel sans
elle. Livrer une fonction sans usage immédiat est assumé et **dit** : c'est le même cas que
`app.can_write_channel` à `CRM-012`, et la suite pgTAP l'éprouve directement plutôt que par
l'intermédiaire d'une politique.

Le `coalesce(…, false)` est exigé par le contrat : un identifiant inconnu rend zéro ligne, donc
`NULL`, et une fonction qui annonce `boolean` doit rendre un booléen (décision 102).

### 6.3 Privilèges

```
revoke all on public.cards from anon, authenticated;
grant select         on public.cards to anon, authenticated;
grant insert, update on public.cards to authenticated;
grant all privileges on public.cards to service_role;
```

`SELECT` à `anon` : sans lui, un appelant sans jeton recevrait `401` par le privilège avant même
qu'une politique ne s'exprime, et le refus exigé — **zéro ligne** — ne serait pas celui qui est
mesuré.

**Le `grant update` de table n'existe plus.** `CRM-034` puis `CRM-013` l'ont remplacé par un
`grant update (…)` énumérant **douze** colonnes : `current_step_id`, `entered_step_at` et
`email_local_part` en sont exclues, ainsi que les identifiants de rattachement et les colonnes
techniques. La liste exacte, son mécanisme et sa conséquence — toute colonne nouvelle est fermée
par défaut — sont dans `docs/SPEC-permissions-rls.md` §4.3 et §4.4.3.

## 7. La garde d'archivage d'un nœud occupé — INC-031

`docs/SPEC-workflow-engine.md` §2.6 énonce la règle depuis `CRM-030` : « l'archivage d'un nœud du
catalogue est refusé tant qu'une card active s'y trouve ». Son chemin est
`cards.current_step_id → workflow_steps.node_id → workflow_nodes_catalog.id`. Il traversait deux
tables absentes ; `workflow_steps` est arrivée à `CRM-031`, **`cards` arrive ici**, et le chemin est
complet.

Deux harnais livrés par des unités précédentes attendent explicitement ce moment.
`scripts/verify-catalogue.sh` et `scripts/verify-workflows.sh` portent un contrôle qui **tombe** dès
que `cards` existe, avec le message « si `cards` existe, la garde d'archivage doit être écrite ».
Les laisser rouges serait masquer ; les retirer serait pire.

**La garde est donc écrite par cette unité**, ce qui retient l'**option 1** des trois qu'INC-031
soumettait à l'arbitrage — « rattacher la garde à `CRM-040`, l'unité qui livre la dernière table
dont elle dépend ». L'arbitrage n'a pas été rendu ; deux faits l'ont réduit à une seule issue
tenable, et le mécanisme est celui de la décision 103 :

- l'**option 2** — rattacher la garde à `CRM-031`, limitée à l'occupation par une étape — est
  éteinte : `CRM-031` est livrée, et cette option était déjà écartée par elle comme **plus stricte
  que la règle spécifiée** ;
- l'**option 3** — créer une unité `CRM-030b` après `CRM-040` — reviendrait à **inventer une unité
  de backlog**, ce que `CLAUDE.md` §1 interdit à l'agent, et laisserait les deux harnais rouges
  entre-temps.

Le choix est **nommé, motivé et réversible** : INC-031 reste ouverte au responsable, qui peut
déplacer la garde ailleurs.

### 7.1 Forme de la garde

Trigger `BEFORE UPDATE` sur `public.workflow_nodes_catalog`, `SECURITY DEFINER` — il lit `cards`,
table dont l'appelant peut ne voir qu'une partie, et la garde doit juger sur **toutes** les cards,
pas sur celles que l'appelant a le droit de voir. Une garde qui n'appliquerait la RLS de l'appelant
laisserait passer l'archivage d'un nœud occupé par des cards invisibles pour lui, ce qui est
précisément le cas qu'elle doit refuser.

Elle se déclenche **au seul passage** de `archived_at` de `NULL` à une valeur. Un renommage, un
changement de couleur, une réactivation ne la réveillent pas — ce qui évite le défaut qu'INC-031
redoutait : une garde qui ferait échouer toute mise à jour du catalogue.

Refus : `raise exception … using errcode = '42501'`, message `node_occupied`, avec le nombre de
cards actives concernées. `42501` est rendu `403` par PostgREST (mesuré, `docs/SPEC-workflow-engine.md`
§4.4), ce qui est le code juste : l'opération est interdite, non malformée.

## 8. Contrat d'API, mesuré

Codes HTTP mesurés sur la pile, avec les jetons réels des comptes seedés
(`docs/SPEC-seed.md` §2.3) :

| `SQLSTATE` | HTTP | Mesuré sur |
|---|---|---|
| `23503` (`foreign_key_violation`) | **`409`** | `POST /rest/v1/channels` avec un `track_id` inexistant |
| `23514` (`check_violation`) | **`400`** | `POST /rest/v1/channels` avec un nom d'espaces |
| `23502` (`not_null_violation`) | **`400`** | `POST /rest/v1/channels` sans `workflow_id` |
| `23505` (`unique_violation`) | `409` | mesuré à `CRM-032`, §4.4 |
| `42501` (`insufficient_privilege`) | `403` | mesuré à `CRM-032`, §4.4 |
| appelant anonyme | `401` | mesuré à `CRM-032`, §4.4 |

### 8.1 Lignes du contrat attendues de `CRM-040`

Chaque refus de lecture est mesuré comme **zéro ligne**, jamais comme une erreur ; chaque refus
d'écriture **relit la ligne** pour la constater inchangée (leçon de la décision 106).

| # | Appelant | Opération | Attendu |
|---|---|---|---|
| a | `admin` | crée une card dans `grands-comptes` | `201`, la ligne, `email_local_part` conforme au §3.2 |
| b | `admin` | crée deux cards | deux `email_local_part` **différents** |
| c | `admin` | crée une card en fournissant `email_local_part` | `201`, valeur **ignorée et remplacée** (§3.4) |
| d | `admin` | crée une card sans `position` | `201`, `position` attribuée dans la portée `(channel, étape)` |
| e | `admin` | crée une card avec une étape d'un **autre** workflow | `409`, `23503` |
| f | `admin` | crée une card avec un `workflow_id` autre que celui du channel | `409`, `23503` |
| g | `admin` | crée une card avec un `workspace_id` autre que celui du channel | `409`, `23503` |
| h | `admin` | crée une card au titre composé d'espaces | `400`, `23514` |
| i | `admin` | crée une card avec `currency = 'euro'` | `400`, `23514` |
| j | `admin` | crée une card avec `probability_override = 101` | `400`, `23514` |
| k | `business_developer` | crée une card dans `grands-comptes` | `201` — il a le droit d'écriture |
| l | `business_developer` | crée une card dans `maintenance` (droit fin `viewer`) | `403`, `42501` |
| m | `viewer` | crée une card dans `grands-comptes` | `403`, `42501` |
| n | `viewer` | crée une card dans `prospection` (droit fin `member`) | `201` — le droit fin **rouvre** |
| o | `viewer` | lit les cards | seules celles de ses channels lisibles ; **zéro** dans `grands-comptes`, dont le track `conseil-ia` lui est fermé, mais **non zéro** dans `prospection`, que le droit de channel rouvre |
| p | `admin` | lit les cards | toutes — un administrateur n'est jamais restreint |
| q | anonyme | lit les cards | `200`, `[]` — **preuve n° 11** |
| r | `business_developer` | modifie le titre d'une card de `maintenance` | `403`, ligne **relue inchangée** |
| s | `business_developer` | déplace une card **vers** un channel interdit | `403` — le `WITH CHECK` (§6.1) |
| t | `admin` | archive une card | `200`, `archived_at` renseignée |
| u | `admin` | met une card en corbeille | `200`, `deleted_at` renseignée |
| v | `admin` | `DELETE` sur une card | `403` — aucun privilège `DELETE` |
| w | `admin` | archive un nœud occupé par une card active | `403`, `node_occupied` (§7) |
| x | `admin` | archive un nœud dont les cards sont toutes archivées | `200` — la garde ne juge que les cards **actives** (§5) |

## 9. Ce que le seed livre

`docs/SPEC-seed.md` §2 est complété d'une section `cards`. Le contrat :

Les étapes sont désignées par la **clé de nœud** du catalogue (`docs/SPEC-workflow-engine.md` §2.9),
seule dénomination stable : `prospection`, `relance`, `negociation`, `signature`, `realisation`,
`livre`, `perdu`.

| Card | Track / Channel | Étape | État | Ce qu'elle démontre |
|---|---|---|---|---|
| Refonte du site vitrine | `conseil-ia` / `grands-comptes` | `relance` | active | Le cas nominal, avec responsable et montant |
| Migration ERP Sogexia | `conseil-ia` / `grands-comptes` | `relance` | active | Deux cards dans la **même** colonne : l'ordre `position` |
| Audit sécurité applicative | `conseil-ia` / `grands-comptes` | `prospection` | active | Une autre colonne du même board |
| Refonte intranet Ville de Lyon | `studio-web` / `refonte` | `negociation` | active | Un second track, donc un second board |
| Support niveau 2 — Atelier Meunier | `studio-web` / `maintenance` | `prospection` | active | Le channel en **lecture seule** pour le `business_developer` |
| Piste entrante à qualifier | `formation` / `inter-entreprises` | `prospection` | active | **Sans responsable, sans montant** : le caractère nullable d'`owner_id` et d'`amount`, démontré et non seulement écrit |
| Formation Data & IA — promo 2026 | `formation` / `inter-entreprises` | `signature` | active | Une `currency` autre qu'`EUR`, sans quoi le défaut de colonne serait la seule valeur jamais observée |
| Contrat cadre 2025 | `conseil-ia` / `grands-comptes` | `livre` | **archivée** | L'archivage, et une card qui **n'occupe plus** son nœud (§5) |
| Saisie erronée | `conseil-ia` / `grands-comptes` | `prospection` | **en corbeille** | La corbeille, distincte de l'archivage |
| Portail adhérents — MGEN Loire | `studio-web` / `refonte` | `realisation` | active | **`CRM-046`** — l'étape `realisation`, vide sur tout board ; porte `lien-proposition`, que l'arête entrante **exige** |
| Socle analytique — Vertuo | `conseil-ia` / `grands-comptes` | `livre` | active | **`CRM-046`** — l'étape `livre`, dont la seule card était archivée, donc invisible de tout écran |
| Cursus DevSecOps — Institut Berthier | `formation` / `inter-entreprises` | `perdu` | active | **`CRM-046`** — l'étape `perdu` et la **branche alternative** du graphe ; porte `motif-perte`, que l'étape exige |
| Cadrage data — Groupe Vallier | `conseil-ia` / `prospection` | `prospection` **du workflow dérivé** | active | **`CRM-046`** — le workflow dérivé, jusque-là inexercé, et le seul channel actif vide |
| Assistant IA support — Nordis | `conseil-ia` / `prospection` | `negociation` **du workflow dérivé** | active | **`CRM-046`** — deux colonnes peuplées sur le board dérivé, et non une seule |

Les identifiants sont **stables** — `5eed0000-0000-4000-8000-0000000000c1` à `…ce` —, comme
`CLAUDE.md` §8 l'exige des données dont les tests dépendent. **Deux exceptions, et c'est le produit
qui les impose** : les deux dernières cards vivent sur le workflow dérivé, dont l'identifiant et
ceux de ses étapes sont frappés par `copy_workflow_to_track`. Le seed résout ces deux clés
étrangères à l'exécution, par la clé de nœud (`docs/SPEC-seed.md` §9.4).

Après `CRM-046`, **les sept étapes du workflow global portent chacune au moins une card active**, et
aucun channel actif n'est vide.

### 9.1 `prospection` a longtemps été vide, et le motif était mesuré — levé par `CRM-046`

**Ce chapitre décrit un état révolu, et il est conservé parce que la mesure qu'il porte reste la
seule preuve écrite de ce qui a été corrigé.**

Le channel `prospection` est le seul du seed que le workflow **dérivé** de `CRM-032` occupe, et
c'est aussi celui que le droit fin du `viewer` rouvre. Il aurait été le meilleur candidat pour
démontrer les deux. De `CRM-040` à `CRM-045`, il est pourtant resté **vide**, et le motif n'était
pas un choix esthétique.

MESURÉ, une card posée dans `prospection` puis le seed rejoué : **échec, code de sortie `1`**, dès
la **section 4** :

```
ERREUR création du channel prospection : code HTTP 409, attendu 200 201.
  {"code":"23503","details":"Key (id, workflow_id)=(…31, 244bbfc6-…) is still referenced
   from table \"cards\"", …}
```

Le seed **repointait le `workflow_id` de `prospection` deux fois à chaque exécution** : la section 4
le ramenait au workflow global déclaré, la section 7 le rattachait ensuite à la copie de portée
track. La clé composite du §2.4 refuse le premier geste dès qu'une card y vit. Contre-épreuve
mesurée : une card dans `grands-comptes`, dont le workflow ne change jamais, laisse le seed
**vert**, code de sortie `0`, zéro erreur.

**Ce que `CRM-046` a changé, et ce qu'il n'a pas changé.** Aucune règle n'a été relâchée : ni la clé
composite, ni le trigger de `CRM-033`, ni INC-046. Ce sont les **deux écritures inutiles** qui ont
disparu — le seed relit avant d'écrire, et n'écrit que ce qui diverge (décisions 221 et 225,
`docs/SPEC-seed.md` §9.2). Sur une base conforme, la section 7 ne fait plus aucune écriture, et la
clé étrangère n'a rien à vérifier.

**Le `PATCH` direct reste refusé, même après la clôture d'INC-046 par `CRM-019`.** Le geste brut —
repointant le workflow d'un channel peuplé sans mapping — rend `409` sur `prospection`,
ce que mesurent `e2e/api/coherence-workflow.spec.ts` (ligne *a bis*),
`e2e/api/move-card-to-channel.spec.ts` (scénario *q*) et le contrôle N3 de
`scripts/verify-seed-demo.sh`. Une assertion de refus prouve la règle ; une assertion de vide ne
prouvait que l'absence d'occasion de l'enfreindre. `change_channel_workflow` est désormais la voie
explicite qui remappe le lot sans relâcher cette protection.

La ligne *n* du contrat du §8.1 continue par ailleurs de faire créer une card dans `prospection`
par le `viewer` lui-même, puis de la retirer : la réouverture par droit fin reste prouvée par le
geste, non par une ligne de seed.

**Conséquence de navigation, non résolue** : le `viewer` lit ces cards par son droit fin et
**aucun écran du produit ne l'y mène**, la coquille résolvant le track avant ses channels. C'est
INC-075, ouverte, mesurée et figée par la preuve n° 13 de `scripts/verify-seed-demo.sh`.

Chaque card active hors « Piste entrante à qualifier » porte un `owner_id` réel parmi les trois profils, un `amount`,
une `currency`, une `next_action` et une `next_action_at` — sans quoi la vue « Ma journée » et
l'index du §2.8 seraient livrés sans aucune donnée pour les exercer. Deux cards portent une
`currency` autre qu'`EUR`, sans quoi le défaut de colonne serait la seule valeur jamais observée.

## 10. Points ouverts

1. **`amount` n'est pas contraint en signe.** Un montant négatif est accepté. Refuser les négatifs
   est une décision de produit — un avoir, une remise, une perte constatée peuvent légitimement
   s'exprimer en négatif — que personne n'a prise. La contrainte n'est pas posée, et son absence est
   **figée par une assertion** plutôt que laissée au hasard.
2. **Aucune purge de la corbeille.** Toute rétention est une décision de conformité (`CLAUDE.md`
   §11). Arbitrage attendu.
3. **La recherche est monolingue** (§2.7).
4. **Un `PATCH` direct du workflow d'un channel occupé reste refusé** ; le geste atomique et
   exhaustif passe par `change_channel_workflow` (`CRM-019`, INC-046).
5. **`current_step_id` s'écrit directement** tant que `move_card` (`CRM-034`) et la protection de
   colonne (`CRM-013`) ne sont pas livrées. Une card peut donc franchir une transition non déclarée
   par un simple `PATCH`, et la seule garde qui tienne aujourd'hui est structurelle : l'étape doit
   appartenir au workflow de la card (§2.4).

## 11. Preuves attendues de `CRM-040`

| Niveau | Preuves |
|---|---|
| pgTAP | Structure de la table, contraintes de valeur, les trois clés composites dans les **deux** sens, génération et unicité d'`email_local_part`, attribution de `position` dans sa portée, colonne générée `search_tsv`, index, RLS activée, les trois politiques, les privilèges (dont l'absence de `DELETE`), `app.can_read_card` éprouvée directement, la garde du §7 dans ses trois cas, conformité du seed, et les écarts du §10 **figés par des assertions** |
| API | Les vingt-quatre lignes du §8.1, avec les jetons réels des trois profils seedés |
| Harnais | `scripts/verify-cards.sh`, rejouable, **non complaisant** : éprouvé par des dégradations réelles de la base, chacune faisant passer une opération qui doit être refusée, la restauration étant constatée |
| E2E d'interface | **Impossible** — INC-021, la webapp reste un appelant anonyme faute d'écran de connexion. Une card est par construction invisible à un anonyme |
| Visuel | **Impossible**, même motif |

---

## 12. Interface : la vue liste — `CRM-042`

Ce chapitre n'existait pas. `CRM-042` tenait en **deux lignes** au backlog — « Tri, filtres,
densité maîtrisée, pagination. **DoD** : E2E ; comportement avec données longues vérifié en
capture » —, et le reste du dépôt ne la nommait qu'en creux : le §1.2 ci-dessus la range hors du
périmètre de `CRM-040`, le §4 l'inscrit parmi les vues où une card **active** est visible, le §7.1
de `docs/SPEC-workflow-engine.md` écarte du board « une vue liste : tri, filtres et pagination sont
`CRM-042` », et le §12.6 de `docs/DESIGN_SYSTEM.md` annonce qu'elle « débordera de la même façon »
que la barre d'onglets. Quatre renvois, aucun contrat.

Il est écrit **après mesure de la pile réelle** — PostgREST `v14.12`, PostgreSQL
`supabase/postgres:17.6.1.136`, le seed en base — et non de mémoire. Les codes HTTP, les en-têtes
`Content-Range` et le comportement du tri paginé cités ci-dessous ont été **observés** le
2026-08-05, les deux derniers sur des tables sondes jetables `public.sonde_l1` et
`public.sonde_l2`, détruites avant rédaction selon le procédé de `docs/JOURNAL.md` décision 52 :
`to_regclass('public.sonde_l2')` rend `NULL`.

### 12.1 Ce que la vue liste est, et ce qu'elle n'est pas

La vue liste est la **seconde lecture d'un même channel**. Le board (`CRM-041`) montre les cards
rangées par le graphe ; la liste les montre rangées par leurs **propres colonnes** — titre, montant,
échéance, date de création — avec un filtre et une pagination. Le board répond à « où en est
chaque affaire ? » ; la liste répond à « laquelle, parmi toutes, dois-je ouvrir ? ».

C'est la raison pour laquelle sa spécification vit **ici**, dans le document des cards, et non dans
celui de la garde : elle est le miroir de la **table**, quand le board est le miroir du **graphe**.
Le §7.1 de `docs/SPEC-workflow-engine.md` avait déjà tracé la frontière ; ce chapitre la tient.

Elle **n'est pas** :

- **une autorisation.** Ce qu'elle montre est ce que la RLS a consenti. `CLAUDE.md` §10 interdit
  qu'un écran porte une règle d'accès, et aucune ligne de cette vue n'en porte ;
- **un écran de création, d'édition, d'archivage ou de corbeille.** Aucun n'existe (§1.2), et cette
  unité n'en livre aucun. La liste **lit** ;
- **un déplacement d'affaire.** Le geste est celui du board, gardé par `move_card` (`CRM-034`).
  Offrir un second chemin d'écriture ici en ferait une seconde définition du même geste ;
- **une vue des archives ni une corbeille.** Le §4 leur promet des vues distinctes ; aucune unité
  du backlog ne les porte. La liste applique la définition d'« active » du §5, **la même** que le
  board et que la première vérification de `move_card` ;
- **une recherche globale.** La barre de recherche de l'en-tête (`docs/DESIGN_SYSTEM.md` §4) porte
  sur tout le workspace et n'est portée par aucune unité. Le filtre textuel de ce chapitre est
  **borné au channel ouvert**.

### 12.2 Où elle s'ouvre, et pourquoi l'adresse porte tout

La liste s'ouvre sur une route **propre** : `/tracks/:slugTrack/:slugChannel/liste`. Le board garde
`/tracks/:slugTrack/:slugChannel`, qui reste la vue par défaut d'un channel.

**Le tri, le filtre, la recherche et le rang de page vivent dans la chaîne de requête**, non dans
l'état du composant :

```
/tracks/conseil-ia/grands-comptes/liste?tri=amount&sens=desc&etape=<uuid>&q=refonte&page=2
```

Trois motifs, et aucun n'est esthétique :

1. **Une pagination qui se perd au rechargement ment sur l'endroit où l'on est.** L'utilisateur qui
   recharge la page 3 doit retrouver la page 3, et celui qui colle son adresse à un collègue doit
   lui montrer ce qu'il voit.
2. **Aucune persistance côté client n'est introduite.** `CLAUDE.md` §11 exige que toute donnée
   posée sur l'appareil appartienne à l'une des trois catégories ; un tri rangé dans
   `localStorage` n'appartient à aucune, et même `sessionStorage` serait un stockage que personne
   n'a demandé. L'URL n'est pas un stockage : elle est l'écran.
3. **Les preuves ouvrent un état directement.** Un scénario qui doit capturer la page 2 d'un tri
   descendant n'a pas à reproduire quatre clics pour y arriver : il ouvre l'adresse. C'est ce qui
   rend la capture « données longues » de la Definition of Done reproductible.

**Un paramètre absent, inconnu ou hors bornes se replie sur son défaut, et l'écran n'affiche
aucune erreur** : une adresse tapée à la main n'est pas une panne. Les défauts sont `tri=title`,
`sens=asc`, aucune étape, aucune recherche, `page=1`. Un `tri=couleur_préférée` ne devient jamais
un `order=couleur_préférée` envoyé à l'API — la valeur est comparée à la liste close du §12.4
avant d'entrer dans une requête.

### 12.3 Ce que la liste lit, et en combien de requêtes

| # | Source | Filtre | Ordre | Motif |
|---|---|---|---|---|
| 0 | le channel courant | résolu **dans la liste déjà chargée** par la coquille | — | aucune requête, comme au §7.2 de `docs/SPEC-workflow-engine.md` |
| 1 | `workflow_steps` + `workflow_nodes_catalog` embarqué | `workflow_id=eq.<workflow du channel>` | `position` | le **libellé et la couleur** de l'étape de chaque ligne, et les choix du filtre par étape |
| 2 | `cards` | `channel_id=eq.<channel>`, `archived_at=is.null`, `deleted_at=is.null`, plus les filtres du §12.5 | celui du §12.4 | la page courante **et** le total |

**Deux requêtes, pas quatre.** `workflow_transitions` et `form_fields` ne sont pas lues : la liste
n'offre aucun déplacement, donc aucune transition à proposer et aucun refus à traduire. Une requête
qui ne sert rien est une requête de trop.

**La lecture des étapes est celle du board, pas une seconde.** `lireEtapes` et `resoudreEtape`
vivent dans `webapp/src/lib/board.ts` et y restent : la liste les **importe**. C'est la règle de la
décision 167 — la même donnée lue deux fois finit par être lue de deux façons —, déjà appliquée à
`projeterChannels` et à `workflow_id`.

**Le total est demandé dans la même requête que la page**, par `Prefer: count=exact`. MESURÉ,
`Range: 0-1` sur les quatre cards actives de `grands-comptes` :

```
HTTP/1.1 206 Partial Content
Content-Range: 0-1/4
```

**`count=exact` et non `count=planned`.** MESURÉ sur les mêmes quatre lignes : `count=planned` rend
`Content-Range: 0-0/1` — l'estimation du planificateur, **fausse d'un facteur quatre**. Une
pagination construite sur une estimation afficherait un nombre de pages qui n'existe pas. Le coût
d'un `count(*)` exact est assumé et **borné** : le filtre `channel_id` est servi par
`cards_channel_step_position_idx`, et le point est rouvert au §12.11 si le volume l'impose.

**Révisé par `CRM-022` : le responsable est embarqué et affiché.** La lecture demande
`responsable:profiles!cards_owner_id_fkey(id, full_name, avatar_url)` dans la même requête paginée.
La colonne « Responsable » rend avatar et nom ; une card sans `owner_id` garde une cellule vide.
Aucun UUID technique n'est présenté et aucune requête par ligne n'est émise.

### 12.4 Le tri, et pourquoi il doit être TOTAL

Quatre tris sont offerts, chacun dans les deux sens :

| Clé | Colonne | Défaut de sens | Motif |
|---|---|---|---|
| `title` | `cards.title` | `asc` | le tri par défaut de la vue |
| `amount` | `cards.amount` | `desc` | on cherche la plus grosse affaire, pas la plus petite |
| `next_action_at` | `cards.next_action_at` | `asc` | on cherche l'échéance la plus proche |
| `created_at` | `cards.created_at` | `desc` | on cherche la plus récente |

La liste est **close**. Une clé absente de ce tableau ne devient jamais un `order=` : elle se replie
sur `title` (§12.2). Sans cette clôture, la chaîne de requête dicterait à PostgREST le nom d'une
colonne, ce qui n'est pas une faille de droit — la RLS juge les lignes, pas les colonnes
demandées — mais laisserait un appelant sonder l'existence d'une colonne par la différence entre un
`200` et un `400`.

**Les valeurs absentes ne remontent jamais en tête** : tout ordre porte `nullslast`, dans les deux
sens. MESURÉ sur `inter-entreprises`, `order=amount.desc.nullslast,title.asc` :
`Formation Data & IA — promo 2026` (28 000 CHF) précède `Piste entrante à qualifier` (montant nul).
Une card sans montant n'est pas la plus grosse affaire du channel.

**Tout tri est complété par `id`, et ce n'est pas une précaution : c'est une correction de défaut,
mesurée.** PostgreSQL ne promet **aucun** ordre entre deux lignes de clé de tri égale, et une
pagination qui s'y fie perd ou duplique des lignes en silence. MESURÉ sur la sonde `sonde_l2`,
200 000 lignes portant toutes la **même** clé, parcourues page par page, quatre pages de cinq :

| Tri | Lignes rendues | Lignes **distinctes** |
|---|---|---|
| `order by cle` — non total | 20 | **17** |
| `order by cle, id` — total | 20 | **20** |

Trois lignes rendues deux fois, donc trois lignes que la marche n'a **jamais** montrées. Rien dans
l'écran ne l'aurait signalé : chaque page était pleine, le total était juste, et les affaires
manquantes n'existaient simplement plus pour l'utilisateur. Le second critère est `id`, clé
primaire donc unique : il rend l'ordre **total**, et le résultat identique d'un plan à l'autre.

`title` est ajouté comme critère intermédiaire pour les trois tris qui ne portent pas sur lui —
deux affaires de même montant se rangent alors par leur nom, ce qu'un utilisateur peut prévoir,
plutôt que par un identifiant qu'il ne voit pas. L'ordre complet est donc :

```
order=<clé>.<sens>.nullslast,title.asc,id.asc
```

**Aucun index ne sert ces tris, et c'est assumé.** MESURÉ, plan du tri par titre sur
`grands-comptes` : `Sort` au-dessus d'un `Index Scan using cards_channel_step_position_idx`. Le
filtre par channel est indexé, l'ordre ne l'est pas. Poser quatre index pour quatre tris sur une
table qui porte neuf lignes serait une optimisation sans mesure, que `CLAUDE.md` §21 proscrit. Le
point est ouvert au §12.11.

### 12.5 Les filtres

Deux filtres, tous deux **côté serveur** :

| Filtre | Requête | Motif |
|---|---|---|
| **Étape** | `current_step_id=eq.<uuid>` | la question la plus fréquente d'un channel : « que reste-t-il en négociation ? » |
| **Recherche** | `search_tsv=plfts(french).<termes>` | la colonne générée du §2.7, et son index GIN |

**Filtrer dans le composant serait un mensonge dès la seconde page.** Un filtre appliqué après la
pagination ne verrait que les 25 lignes rapportées : une affaire de la page 3 ne sortirait jamais
d'une recherche. Le filtre appartient donc à la requête, avant `Range`, et le total du §12.3 est
celui des lignes **filtrées**.

**La recherche emploie `plfts` et non `ilike`.** `search_tsv` est une colonne générée `STORED`
indexée en GIN (§2.7) ; un `ilike '%…%'` ne peut pas l'utiliser et impose un parcours complet.
MESURÉ : `search_tsv=plfts(french).refonte` rend `Refonte du site vitrine` sur `grands-comptes`.
La configuration `french` est **explicite**, comme dans la définition de la colonne : implicite,
elle dépendrait de `default_text_search_config`, paramètre de session.

**La monolinguisme du §2.7 s'applique à ce filtre**, et il est écrit dans l'écran plutôt que
supposé : une card rédigée en anglais sera mal racinisée. Le point ouvert n° 3 du §10 le porte
déjà ; ce chapitre ne le rouvre pas.

L'étape offerte au filtre est prise dans la lecture n° 1 du §12.3 — donc **toutes** les étapes du
workflow, y compris celles qu'aucune card n'occupe. Une étape absente de la liste des choix ferait
croire qu'elle n'existe pas, quand elle est seulement vide.

### 12.6 La pagination, et le `416` qui l'attend au tournant

**La page compte 25 lignes.** Valeur fixée, non configurable : aucune unité du backlog ne porte un
sélecteur de densité, et en offrir un serait un périmètre inventé. Elle est déclarée une fois, dans
le module de composition, et les preuves l'importent au lieu de la recopier.

La page `n` demande les lignes `(n−1)×25` à `n×25 − 1`, et le nombre de pages se déduit du total
rendu par la même réponse.

**Le client demande cette plage par `offset` et `limit`, non par un en-tête `Range` — et la
première écriture de ce chapitre disait le contraire.** MESURÉ en exécutant les preuves
d'interface : `postgrest-js` traduit `.range(de, à)` en deux **paramètres de requête**,
`offset=<de>&limit=<à − de + 1>`. L'en-tête `Range` reste accepté par PostgREST et se comporte de
façon identique — les deux chemins ont été mesurés jusqu'au `416` près —, mais c'est le premier que
le produit emprunte, et c'est donc lui que les preuves doivent observer (décision 189). Le tableau
ci-dessous vaut pour les deux ; le corps du `416` par `offset` est plus précis encore :

```
{"code":"PGRST103","details":"An offset of 5 was requested, but there are only 4 rows.", …}
```

**MESURÉ, et le comportement est piégeux :**

| Rang demandé | Total réel | Réponse |
|---|---|---|
| `offset=0&limit=2` | 4 | `206`, `Content-Range: 0-1/4`, deux lignes |
| `offset=3&limit=1` | 4 | `206`, `Content-Range: 3-3/4`, une ligne |
| `offset=4&limit=1` — l'offset **égale** le total | 4 | `206`, `Content-Range: */4`, **zéro ligne, aucune erreur** |
| `offset=5&limit=1` — l'offset **dépasse** le total | 4 | **`416 Requested Range Not Satisfiable`**, `Content-Range: */4` |
| `offset=25&limit=25` — la page 2 d'un channel d'une page | 4 | **`416`**, `Content-Range: */4` |
| `offset=0&limit=25` | 0 (appelant anonyme) | `200`, `Content-Range: */0`, `[]` |

Vu à travers `supabase-js`, le `416` n'est pas une page vide : c'est une **erreur**. MESURÉ,
`.range(5, 29)` rend `status: 416`, `error.code: 'PGRST103'`, `count: null` **et** `data: null`.
Une vue liste qui traiterait toutes les erreurs de la même façon afficherait « Chargement
impossible » à un utilisateur dont la seule faute est d'avoir gardé l'onglet ouvert pendant qu'une
affaire était archivée ailleurs.

Deux règles en découlent, et la seconde n'est pas facultative :

1. **Le rang demandé est borné par le total connu.** Tant qu'un total a été rapporté, la page
   demandée est ramenée dans `[1, nombre de pages]`. Une adresse portant `page=99` sur un channel
   d'une page ouvre donc la page 1.
2. **Le `416` qui survient malgré tout est classé pour lui-même**, jamais absorbé. Il survient
   lorsque le total a diminué entre deux lectures — une card archivée par quelqu'un d'autre — et
   l'écran affiche alors « cette page n'existe plus », avec une action qui revient à la première.
   Ce n'est ni un `try/catch` vide ni une valeur par défaut trompeuse (`CLAUDE.md` §18) : le refus
   est nommé, et l'utilisateur sait quoi faire.

L'état vide de la liste distingue deux causes, parce que l'utilisateur n'y répond pas de la même
façon : « aucune affaire dans ce channel » n'appelle aucune action, « aucune affaire ne correspond
à ce filtre » appelle le retrait du filtre, et l'écran l'offre.

### 12.7 Le tableau, sa densité et ses colonnes

Le rendu est un **tableau** au sens sémantique — `table`, `thead`, `th scope="col"` —, et non une
grille de `div`. Une liste de données tabulaires annoncée comme telle donne à un lecteur d'écran la
navigation par cellule et l'en-tête de colonne à chaque cellule ; une grille de `div` ne donne rien.

| Colonne | Contenu | Règle |
|---|---|---|
| **Affaire** | `title`, **lien** vers `/tracks/:slugTrack/:slugChannel/cards/:id` | une ligne, ellipse, `title` en attribut pour la valeur entière |
| **Étape** | libellé de l'étape, en badge à la couleur du nœud | jamais la couleur seule (`docs/DESIGN_SYSTEM.md` §1) |
| **Montant** | `amount` et `currency`, en **donnée technique** | `Intl.NumberFormat`, aligné à droite, cellule vide si nul |
| **Prochaine action** | `next_action` | une ligne, ellipse |
| **Échéance** | `next_action_at` | donnée technique, format court, cellule vide si nulle |

**« Densité maîtrisée » est une contrainte mesurable, pas une intention.** Une ligne fait
`--size-target` de haut — 40 px, la cible minimale du §8 du design system —, et **une seule ligne
de texte par cellule** : le tableau doit rester lisible en diagonale, ce qu'un texte replié sur
trois lignes interdit. C'est l'écart exact avec la carte de board, qui accorde deux lignes au titre
(`docs/DESIGN_SYSTEM.md` §5.1) : une carte se lit, une ligne de tableau se balaye.

**Le débordement horizontal est signalé.** Le tableau vit dans un conteneur `overflow-x: auto`
portant `.indique-debordement-x` — le §12.6 du design system l'annonçait nommément : « la vue liste
(`CRM-042`) débordera de la même façon et la portera aussi ». Aucun `scroll-snap` : il n'y a pas de
colonne sur laquelle s'ancrer, contrairement au board.

Les règles visuelles du tableau — hauteur de ligne, en-tête collant, séparateurs, bouton de tri,
`aria-sort` — vivent dans `docs/DESIGN_SYSTEM.md` §5.9, écrit dans le même changement que ce
chapitre. Ce document-ci dit **ce que** l'écran montre ; celui-là dit **comment**.

### 12.7 bis Ce que le tableau a appris en étant rendu

Trois règles ajoutées **après avoir regardé une capture**, et non après avoir lu un test — les
trois éléments fautifs existaient tous, si bien qu'aucune assertion ne pouvait les attraper
(décision 190).

- **Un état vide REMPLACE le tableau**, il ne s'y ajoute pas. La première écriture laissait sous le
  message une ligne d'en-têtes sans une seule ligne de données : une carcasse de tableau, qui
  affirme cinq colonnes et n'en remplit aucune.
- **Un état vide se rend SOUS la barre de filtres.** Rendu au-dessus, l'utilisateur lisait
  « aucune affaire ne correspond » **avant** de voir les filtres qui en étaient la cause.
- **L'action « Effacer les filtres » n'existe qu'une fois à l'écran.** La barre de filtres et
  l'état vide la portaient toutes deux, à cent pixels l'une de l'autre. Lorsque l'état vide
  l'offre — c'est le patron du §5.8 du design system —, la barre ne la répète pas.

**La barre de filtres, elle, reste toujours rendue**, y compris sur un total nul : elle est la
cause de l'état vide filtré, et la masquer priverait l'utilisateur du seul geste qui l'en sort.

### 12.8 Accessibilité et clavier

- Le tri est déclenché par un **bouton dans l'en-tête de colonne**, et l'en-tête porte
  `aria-sort="ascending" | "descending" | "none"`. L'attribut n'est pas décoratif : sans lui, un
  lecteur d'écran ne sait pas sur quelle colonne le tableau est trié.
- Les filtres sont des champs de formulaire étiquetés (`docs/DESIGN_SYSTEM.md` §5.7). La recherche
  est un `form` que `Entrée` soumet : une recherche qui partirait à chaque frappe émettrait une
  requête par caractère.
- La pagination est une paire de boutons **désactivés aux extrémités**, jamais masqués : un état
  désactivé reste lisible et dit pourquoi (§8 du design system). Le rang courant et le total sont
  écrits en toutes lettres, pas seulement suggérés par la position.
- Le changement de page, de tri ou de filtre est annoncé par la région `aria-live` polie déjà
  livrée (`webapp/src/components/ui/LiveRegion.tsx`) : un tableau qui se remplit sans un mot est
  un changement invisible pour qui ne voit pas l'écran.
- La bascule board ↔ liste est une paire de **liens**, `aria-current="page"` sur la vue ouverte —
  le patron déjà retenu pour la barre d'onglets (`docs/DESIGN_SYSTEM.md` §12.1), et pour le même
  motif : les deux vues changent d'adresse.

### 12.9 États systématiques

Les quatre états du §5.8 du design system sont traités, plus deux propres à cette vue :

| État | Rendu |
|---|---|
| Chargement | squelettes à la place des lignes, jamais un écran vide |
| Vide — channel sans affaire | « Aucune affaire dans ce channel » |
| Vide — **filtre trop étroit** | « Aucune affaire ne correspond », avec l'action qui efface les filtres |
| — | Les deux états vides **remplacent le tableau** et sa pagination, et se rendent **sous** la barre de filtres, jamais au-dessus (§12.7 bis) |
| Erreur | message et reprise, la reprise relançant la requête |
| Refus (`401`/`403`) | explication, jamais une page blanche |
| **Page inexistante (`416`)** | message propre et retour à la première page (§12.6) |

Un refus par RLS n'est **pas** une erreur : il rend `200` et zéro ligne (§7 de
`docs/SPEC-permissions-rls.md`), donc l'état vide. C'est le contrat de `webapp/src/lib/async.ts`,
inchangé.

### 12.10 Ce que `CRM-042` ne livre pas, et pourquoi

| Absent | Motif |
|---|---|
| Toute **écriture** — création, édition, archivage, corbeille, déplacement | Aucun écran d'écriture n'existe (§1.2), et le déplacement est le geste du board |
| ~~La colonne **Responsable**~~ | **Livrée depuis par `CRM-022`** (§12.3) |
| Les **étiquettes** | Aucune table `tags` n'existe, et aucune unité du backlog n'en porte (§1.2) |
| Le **choix du nombre de lignes par page** | Périmètre inventé (§12.6) |
| Les **vues sauvegardées** | `CRM-071`, que `docs/manual.md` nomme déjà |
| La **recherche globale** au workspace | Aucune unité ne la porte (§12.1) |
| Une **vue des archives** ou une **corbeille** | Promises par le §4, portées par aucune unité |
| ~~Le **parcours complet d'un utilisateur connecté**~~ | **Livré depuis par `CRM-009`**, puis étendu aux identités par `CRM-022` |

### 12.11 Points ouverts propres à la vue liste

1. **`count=exact` sur chaque page.** Le coût est aujourd'hui nul — quatorze cards en base — et
   deviendra mesurable. Le remplacer par un `count=estimated` ou par un compte différé est une
   décision de produit qu'aucune mesure ne justifie encore. `CLAUDE.md` §21 interdit d'optimiser
   sans mesure ; le point est **ouvert**, pas tranché.
2. **Aucun index ne sert les quatre tris** (§12.4). Même motif.
3. **Le total ne franchit pas les origines sans `Access-Control-Expose-Headers`.** Constat, non
   point ouvert, mais il appartient à ce chapitre parce qu'il conditionne toute preuve d'interface :
   `Content-Range` est un en-tête de réponse **cross-origin**, et un navigateur n'en laisse rien
   lire s'il n'est pas explicitement exposé. PostgREST l'expose ; une fixture de test qui l'oublie
   fait rendre `count: null` à `supabase-js`, et l'écran affiche alors « Chargement impossible » —
   ce qui est le comportement voulu face à un total manquant (§12.6). Mesuré en exécutant.
4. **~~Le seed ne porte aucune donnée longue.~~ FERMÉ le 2026-08-16 par `CRM-046` tranche 2.** Le
   point disait vrai à l'écriture — titre le plus long **36 caractères**, prochaine action **34** —,
   et la capture était alors produite contre une **réponse substituée**
   (`docs/DESIGN_SYSTEM.md` §12.5). Le seed porte désormais `…d001`, **128** caractères de titre et
   **134** de prochaine action (`docs/SPEC-seed.md` §9.11.4), et les deux captures
   `liste-donnees-longues-{1440,390}` sont prises sur une session **connectée**, sans aucune
   substitution.
5. **~~Le seed ne porte aucun channel de plus de 25 cards.~~ FERMÉ par la même tranche.** Le point
   disait vrai à l'écriture — quatre cards actives au maximum. `maintenance` en porte désormais
   **27** (`docs/SPEC-seed.md` §9.11.2) : la première page est pleine, la seconde porte deux lignes,
   et elle est franchie **par le bouton du produit** dans `e2e/ui/liste-cards.spec.ts`, en plus de
   la mesure directe du `Range` dans `e2e/api/liste-cards.spec.ts`.
6. **`amount` voyage en nombre JSON** — MESURÉ une quatrième fois ici, `typeof amount === 'number'`,
   valeur `15500`. C'est INC-067, ouverte par `CRM-041` : `e2e/api/cards.spec.ts` le déclare en
   **chaîne**. Ce chapitre **ne tranche pas** et ne modifie aucun comportement ; il ajoute une
   mesure à l'entrée.

### 12.12 Preuves attendues de `CRM-042`

| Niveau | Preuves |
|---|---|
| pgTAP | **Aucune dédiée.** L'unité ne livre ni table, ni fonction, ni politique. Ce qu'elle lit est couvert par la suite de `CRM-040` |
| Unitaire | Composition du modèle de liste, clôture des tris et des sens, ordre **total**, repli des paramètres d'adresse, bornage du rang de page, découpage en pages, classification du `416`, et le composant réel |
| API | Les deux lectures du §12.3 confrontées à la pile réelle avec le jeton de l'administratrice : le `206` et son `Content-Range`, le `416` et son `PGRST103`, le `count=planned` **faux**, les quatre tris, les deux filtres, et le refus opposé à l'anonyme sur les mêmes requêtes |
| E2E d'interface | Contre le **build de production** : l'anonyme qui n'atteint jamais la liste sans substitution, puis le tri, le filtre, la recherche, la pagination, la bascule board ↔ liste, le `416` et l'état vide filtré, avec réponses substituées et **dit comme tel** |
| Visuel | Captures aux **quatre paliers** du §7 du design system, plus l'état « données longues » exigé nommément par la Definition of Done |
| Harnais | `scripts/verify-liste.sh`, rejouable et **non complaisant** : chaque dégradation volontaire le fait réellement échouer, la restauration étant constatée |

---

## 13. Commentaires — `CRM-043`

Chapitre écrit **avant toute ligne de code** de `CRM-043`, et **après mesure sur la pile réelle**
(`docs/JOURNAL.md` décisions 192 à 197). L'unité tenait en deux lignes au backlog — « rédaction
libre par tout membre pouvant lire la card, édition et suppression par l'auteur » —, et trois
documents la nommaient sans la décrire : le §5 de `docs/SCHEMA.md` pour son modèle, le §4 de
`docs/SPEC-permissions-rls.md` pour ses politiques, le §5.3 de `docs/DESIGN_SYSTEM.md` pour la
colonne d'écran qui l'accueille. Les trois **ne disent pas la même chose**, et le §13.6 nomme la
contradiction plutôt que de la trancher en silence.

### 13.1 Ce que l'unité est, et ce qu'elle n'est pas

**Est** : une table `public.card_comments`, ses politiques, la garde de son édition et de sa
suppression, sa publication au temps réel, son seed, et un **panneau de commentaires** dans le
détail de card.

**N'est pas**, et chaque absence est figée par une assertion plutôt que compensée :

- **aucune notification.** La colonne `mentions` est livrée par le §5 de `docs/SCHEMA.md` et
  **n'est alimentée par rien** : ni analyse du corps, ni écriture par l'interface. Les
  notifications appartiennent à `CRM-063`, et la table `notifications` n'existe pas ;
- **aucune timeline.** Le fil unifié — commentaires, transitions, activités, emails — est
  `CRM-044`. `CRM-043` livre le **flux des commentaires seul**, dans le panneau que `CRM-044`
  reprendra ;
- **aucun événement.** `card_events` n'existe pas : un commentaire écrit, modifié ou supprimé ne
  laisse aucune trace typée. `CRM-044` ;
- **aucune pièce jointe, aucun rendu markdown enrichi.** Le corps est stocké en markdown parce que
  `docs/SCHEMA.md` §5 le dit ; il est **rendu en texte brut** par cette unité. Interpréter du
  markdown reçu d'un tiers est un sujet de sécurité entier — il n'a aucune unité, et le §13.13 le
  nomme ;
- **aucune modération.** Voir §13.6 : le §4 de `docs/SPEC-permissions-rls.md` ouvre la suppression
  aux `admin`, la Definition of Done ne l'ouvre qu'à l'auteur. INC-072.

### 13.2 Modèle : `public.card_comments`

| Colonne | Type | Contraintes |
|---|---|---|
| `id` | `uuid` | clé primaire, `gen_random_uuid()` |
| `card_id` | `uuid` | non nul, FK `cards (id)` `on delete cascade` |
| `workspace_id` | `uuid` | non nul, **dérivé de la card** (§13.3) |
| `author_id` | `uuid` | non nul, FK `profiles (id)`, **défaut `auth.uid()`** |
| `body` | `text` | non nul, markdown, longueur tenue par un `CHECK` conditionnel (§13.4) |
| `mentions` | `uuid[]` | non nul, défaut `'{}'`, **jamais alimentée** (§13.1) |
| `created_at` | `timestamptz` | non nul, défaut `now()` |
| `edited_at` | `timestamptz` | nul tant que le corps n'a pas changé, **posé par trigger** (§13.5) |
| `deleted_at` | `timestamptz` | nul tant que le commentaire vit, **posé par trigger** (§13.4) |
| `deleted_by` | `uuid` | nullable, FK `profiles (id)`, **posé par trigger** avec `deleted_at` — audit de la modération (§13.6, décision 374) |

`updated_at` **n'est pas ajoutée**, et c'est un écart assumé à la convention générale de
`docs/SCHEMA.md` : `edited_at` et `deleted_at` disent déjà, et plus précisément, ce qu'une colonne
`updated_at` dirait confusément — un commentaire n'a que deux évolutions possibles, et les nommer
vaut mieux que les confondre. C'est la cinquième occurrence d'INC-025, et la première où le tableau
du §5 de `docs/SCHEMA.md` est **suivi à la lettre** plutôt que complété.

### 13.3 L'unicité qui manque à `cards`, et la clé étrangère composite

`workspace_id` est une **dénormalisation** : elle ne porte aucune décision, elle recopie celle de la
card. Deux mécanismes la tiennent, et les deux sont nécessaires :

1. un `BEFORE INSERT` la **dérive** de la card, quelle que soit la valeur envoyée. Un client qui
   annoncerait le workspace d'un autre espace de travail obtient la valeur exacte, sans erreur :
   la colonne n'est pas une question posée au client ;
2. une **clé étrangère composite** `(card_id, workspace_id) → cards (id, workspace_id)` rend
   l'incohérence impossible même par la clé de service, qui contourne la RLS mais **pas** les
   contraintes.

Le second exige une unicité que `cards` ne porte pas. MESURÉ le 2026-08-05, sur une table sonde
créée puis annulée :

```
create table sonde_c1 (card_id uuid, workspace_id uuid,
  foreign key (card_id, workspace_id) references public.cards (id, workspace_id));
ERROR:  there is no unique constraint matching given keys for referenced table "cards"
```

`cards` porte `PRIMARY KEY (id)` et, depuis `CRM-036`, `UNIQUE (id, workflow_id)` — rien de plus.
`CRM-043` ajoute donc `UNIQUE (id, workspace_id)`, **exactement** comme la migration 13 avait ajouté
`UNIQUE (id, workflow_id)` pour la même raison (décision 124). Elle **ne change aucun comportement** :
`id` étant déjà clé primaire, le couple était déjà unique ; elle rend seulement la relation
exprimable.

La suppression d'une card **cascade** sur ses commentaires. C'est la seule cascade du chapitre, et
elle est sans conséquence pratique : `cards` n'expose aucune suppression (§4), l'archivage et la
corbeille en tiennent lieu. Elle existe pour que la destruction d'un workspace par la clé de
service ne laisse pas d'orphelins.

### 13.4 Ce qu'un commentaire supprimé devient : une pierre tombale vidée

C'est la décision 193, et c'est la plus structurante du chapitre.

« Suppression par l'auteur » admet trois lectures, et deux sont mauvaises :

1. **suppression physique.** `docs/SCHEMA.md` §5 donne à la table une colonne `deleted_at` : la
   suppression voulue est douce. Une suppression physique la rendrait morte-née ;
2. **`deleted_at` posé, ligne laissée lisible.** Le corps reste alors servi par l'API à tout membre
   qui sait le demander, et « supprimé » ne serait vrai que dans l'interface. C'est exactement ce
   que `CLAUDE.md` §10 refuse : masquer un élément d'interface n'est pas une règle d'accès ;
3. **`deleted_at` posé, ligne retirée de la lecture.** Le corps devient inatteignable, mais la ligne
   aussi — et le §13.9 montre ce que cela coûte : **le temps réel ne transmet que ce que le
   destinataire peut lire**. Une suppression retirant la ligne de la lecture ne serait donc jamais
   transmise, et l'écran d'un autre membre continuerait d'afficher le commentaire supprimé jusqu'à
   son prochain rechargement. Une suppression qui ne se propage pas est une suppression qui ment.

**Retenu : la pierre tombale.** La ligne survit, **vidée de son corps**, et le `CHECK` en fait une
propriété de la base et non une politesse du code :

```
constraint card_comments_corps_check check (
  (deleted_at is null     and length(btrim(body)) between 1 and 10000) or
  (deleted_at is not null and body = '')
)
```

Un commentaire supprimé **ne porte plus aucun contenu** : ce n'est pas caché, c'est détruit. La
ligne subsiste pour trois raisons, toutes vérifiables : la suppression se **propage** au temps réel
(§13.9) ; la chronologie du futur fil unifié (`CRM-044`) n'a pas de trou ; et `author_id` étant
immuable (§13.7), la ligne ne peut pas être recyclée pour faire dire à quelqu'un ce qu'il n'a pas
écrit.

**Une pierre tombale est définitive.** Le trigger refuse toute écriture ultérieure sur une ligne
déjà supprimée — `comment_deleted` —, et refuse la résurrection : `deleted_at` ne redevient jamais
nul. Un corps vidé n'est pas récupérable ; c'est le sens du geste.

**La borne de 10 000 caractères** est écrite parce qu'une colonne `text` sans borne est une
promesse qu'aucune couche ne tient : un commentaire est un message, pas un document, et la limite
appartient à la base — seul endroit que tous les chemins d'écriture traversent.

### 13.5 Édition : `edited_at` est posé par un trigger, jamais par le client

Un `BEFORE UPDATE` pose `edited_at := now()` **si et seulement si** le corps change. Trois
conséquences opposables :

- corriger une faute et **le dire** sont le même geste : l'interface ne peut pas éditer sans
  marquer ;
- une mise à jour qui renvoie le même corps ne marque rien — ce que fait tout client qui
  réenregistre une ligne entière ;
- `edited_at` **n'est pas ouverte à l'écriture** par `authenticated` (§13.7), et le trigger l'écrit
  malgré tout. MESURÉ le 2026-08-05, sur une table sonde :

| Geste, rôle `authenticated` | Résultat |
|---|---|
| `update … set corps = 'b'` — colonne **accordée** | `UPDATE 1`, et la colonne `edite_le` **renseignée par le trigger** |
| `update … set edite_le = '2020-01-01'` — colonne **non accordée** | `ERROR: permission denied for table` |

Le privilège de colonne juge la **cible du client**, pas les affectations d'un trigger. C'est ce qui
permet à une colonne d'être à la fois tenue par le produit et fermée à l'appelant.

### 13.6 Autorisations, et la contradiction que trois documents portent

**Ce que les documents disent :**

| Source | Qui peut écrire un commentaire | Qui peut le modifier et le supprimer |
|---|---|---|
| `docs/SCHEMA.md` §5 | « Tout membre pouvant **lire** la card » | non dit |
| `docs/SPEC-permissions-rls.md` §4 | « Écriture sur le channel » | « l'auteur **et les `admin`** » |
| `docs/BACKLOG.md`, `CRM-043` | « tout membre pouvant lire la card », **DoD : refus pour un `viewer`** | « l'auteur » |

Les deux colonnes se contredisent, et pas de la même façon.

**Écriture — la règle retenue est le droit d'ÉCRITURE sur le channel** (décision 192, INC-071).
Trois raisons : le §2.1 de `docs/SPEC-permissions-rls.md` définit le `viewer` comme « consulte,
**sans aucune écriture** », invariant de tout le produit ; le §4 du même document prescrit
« écriture sur le channel » ; et la Definition of Done de l'unité **exige la preuve du refus opposé
à un `viewer`**, ce qui est incompatible avec la lecture littérale de `docs/SCHEMA.md` §5. Deux
sources contre une, dont l'une est la Definition of Done elle-même. La phrase du §5 de
`docs/SCHEMA.md` est **corrigée dans le même changement**, et l'écart consigné en INC-071.

**Modification — l'auteur seul, et cela ne bougera pas** (décision 194, INC-072). Le motif n'est pas
prudentiel : **modifier** le commentaire d'autrui n'est pas de la modération mais une falsification.
Un administrateur pourrait faire dire à un commercial l'inverse de ce qu'il a écrit, sans autre
trace qu'un `edited_at`, et aucun document ne demande cela.

**Suppression — l'auteur, ET les `admin` du workspace, AVEC audit** (arbitrage de la décision 367,
mise en œuvre par la décision 374, INC-072 close). `CRM-043` avait livré l'**intersection** des deux
énoncés faute d'arbitrage, avec sa conséquence nommée : **aucun modérateur ne pouvait retirer un
commentaire déplacé**. C'est cette conséquence que l'arbitrage lève, et elle seule.

**La restriction « le modérateur supprime, il ne modifie pas » ne peut PAS être portée par la
politique**, et c'est ce qui donne sa forme à la mise en œuvre. Une politique RLS n'a pas d'`OLD`
dans son `WITH CHECK` : elle ne sait pas dire « tu peux écrire cette colonne, pas celle-là ». Le
privilège de colonne ne le sait pas davantage — il est attaché au **rôle** `authenticated`, que
l'auteur et le modérateur partagent. La barrière est donc posée dans le **trigger** du §13.5, seul
endroit qui voit `OLD`, `NEW` et `auth.uid()` en même temps : un appelant qui n'est pas l'auteur ne
peut faire qu'une chose, poser `deleted_at`. Toute autre écriture rend `comment_moderation_limitee`.
**La politique ouvre, le trigger borne**, et les deux sont nécessaires.

**L'audit est une colonne, `deleted_by`.** Une pierre tombale qui ne dit pas qui l'a posée n'est pas
auditée. Elle est écrite par le trigger à `auth.uid()`, fermée au client comme `edited_at`, et rend
la modération immédiatement lisible : un commentaire dont `deleted_by` **diffère** de `author_id` a
été retiré par un tiers. Le choix d'une colonne plutôt que d'un `card_event` a un motif : la
timeline typée appartient à `CRM-044`, et l'audit d'INC-072 ne doit pas attendre une unité qu'il ne
porte pas.

**Ce que l'ouverture n'emporte pas.** Aucune résurrection — la pierre tombale reste définitive pour
tout le monde, `admin` compris. Aucune suppression physique — il n'existe toujours ni politique
`for delete`, ni privilège `DELETE`.

**Les cinq politiques :**

| Opération | Rôles | Prédicat |
|---|---|---|
| `SELECT` | `anon`, `authenticated` | `app.can_read_card(card_id)` |
| `INSERT` | `authenticated` | `app.can_write_card(card_id) and author_id = auth.uid()` |
| `UPDATE` — l'auteur | `authenticated` | `USING` **et** `WITH CHECK` : `author_id = auth.uid() and app.can_write_card(card_id)` |
| `UPDATE` — la modération | `authenticated` | `USING` **et** `WITH CHECK` : `app.is_workspace_admin(workspace_id) and app.can_read_card(card_id)` |
| `DELETE` | — | **aucune politique**, et **aucun privilège** : refus double (§13.7) |

**La politique de modération juge sur `app.can_read_card`, non sur `app.can_write_card`.** Un
administrateur de workspace dont le droit fin sur le channel est retombé à `viewer` doit pouvoir
retirer un propos déplacé qu'il **voit** ; lui demander en plus le droit d'écrire reviendrait à
faire dépendre la modération d'un droit métier qui n'a rien à voir avec elle. Il ne gagne pour
autant aucun pouvoir d'écriture : le trigger ne lui laisse que `deleted_at`.

`anon` reçoit `SELECT` pour le motif du §3.2 de `docs/SPEC-permissions-rls.md` : sans le privilège,
un appelant sans jeton recevrait une **erreur de privilège** là où le comportement exigé par le §7
est **zéro ligne**. `auth.uid()` étant nul, le prédicat rend faux et la table est vide pour lui.

`card_comments` est le **deuxième appelant réel** d'`app.can_read_card` et d'`app.can_write_card`,
après `card_field_values` (`docs/SPEC-permissions-rls.md` §3.6 et §3.7, qui la nommaient déjà). Le
défaut de la décision 107 ne s'y reproduit pas : les deux fonctions lisent `cards`, une **autre**
table.

`author_id = auth.uid()` dans le `WITH CHECK` **n'est pas redondant** avec le défaut de colonne. Le
défaut ne s'applique qu'à une colonne omise ; un client qui envoie `author_id` explicitement le
contourne. La politique est ce qui refuse d'écrire sous le nom d'autrui, et elle se prouve : une
administratrice postant au nom du commercial reçoit `403`.

`app.can_write_card` dans l'`UPDATE` **n'est pas redondant** avec `author_id = auth.uid()` : un
auteur dont le droit fin est retombé à `viewer` depuis qu'il a écrit ne doit plus pouvoir modifier —
la règle est celle du droit **courant**, non de celui du jour de l'écriture.

### 13.7 Colonnes protégées

Mécanisme du §4.3 de `docs/SPEC-permissions-rls.md`, appliqué **dès la migration qui crée la
table**, et non deux unités plus tard comme pour `cards` :

```
revoke all on public.card_comments from anon, authenticated;
grant select                 on public.card_comments to anon;
grant select, insert         on public.card_comments to authenticated;
grant update (body, deleted_at) on public.card_comments to authenticated;
grant all privileges         on public.card_comments to service_role;
```

**Deux colonnes ouvertes en mise à jour, et deux seulement.** `id`, `card_id`, `workspace_id`,
`author_id`, `created_at` et `mentions` sont fermées par voie de conséquence : un commentaire ne
change ni de card, ni d'auteur, ni de date de naissance. `edited_at` est fermée **et pourtant
écrite**, par le trigger du §13.5. `deleted_by`, ajoutée par la décision 374, l'est de la même
façon : fermée au client, écrite par le trigger.

Le trigger de mise à jour **refuse** en outre tout changement de `card_id`, de `author_id` ou de
`created_at` : c'est le refus double du §8.4 de la migration 13, appliqué aux colonnes plutôt qu'à
la suppression. Sans le trigger, la clé de service — que le seed emploie — n'aurait aucune barrière.

Le privilège `INSERT` reste **de table**, comme pour `cards` (décision 140) : le défaut de colonne
et la politique suffisent à tenir `author_id`, et fermer l'insertion colonne par colonne ferait
`403` à des clients qui envoient la ligne entière sans dommage.

### 13.8 Contrat d'API, mesuré

À exercer par `e2e/api/commentaires.spec.ts`, avec les **jetons réels** obtenus par la véritable
route de connexion :

| # | Identité | Requête | Attendu |
|---|---|---|---|
| a | administratrice | `POST /rest/v1/card_comments` `{card_id, body}` | `201`, `author_id` = son `sub`, `workspace_id` **dérivé**, `edited_at` nul |
| b | administratrice | `POST` avec `author_id` = celui du commercial | `403`, `42501` — la politique refuse la signature d'autrui |
| c | administratrice | `POST` avec `workspace_id` d'un autre espace | `201`, et `workspace_id` **corrigé** par le trigger |
| d | `viewer` | `POST` sur une card **qu'il voit** (`…0c5`, channel `maintenance`) | `403`, `42501` — **la preuve nommée par la Definition of Done** |
| e | `viewer` | `GET /rest/v1/card_comments?card_id=eq.…0c5` | `200` et les commentaires : lire n'est pas écrire |
| f | `viewer` | `GET` sur une card d'un channel **fermé** (`…0c1`) | `200` et `[]` — preuve n° 4 des droits fins, reconduite |
| g | anonyme | `GET /rest/v1/card_comments` | `200` et `[]`, la table étant **d'abord constatée non vide** avec la clé de service (décision 50) |
| h | anonyme | `POST` | `401` ou `403` — jamais une ligne écrite |
| i | auteur | `PATCH ?id=eq.…` `{body}` | `200`, `edited_at` **renseigné**, corps changé |
| j | tiers pouvant écrire | `PATCH` sur le commentaire d'un autre | `200` et `[]` — le `USING` filtre, **aucune ligne modifiée**, et la relecture le confirme |
| k | auteur | `PATCH` `{deleted_at: <une date>}` | `200`, `deleted_at` = `now()` **et non la date envoyée**, `body` = `''` |
| l | auteur | `PATCH` sur un commentaire déjà supprimé | `400`, `P0001`, `comment_deleted` |
| m | auteur | `PATCH` `{deleted_at: null}` sur un supprimé | même refus : pas de résurrection |
| n | auteur | `PATCH` `{author_id}` ou `{created_at}` | `403` — privilège de colonne (INC-026 : le refus divulgue la commande `GRANT`) |
| o | quiconque | `DELETE /rest/v1/card_comments?id=eq.…` | `403` — **aucun privilège**, et aucune politique derrière |
| p | administratrice | `POST` avec `body` vide ou de 10 001 caractères | `400`, `23514` — le `CHECK` |

Le point **j** mérite d'être lu deux fois : PostgREST rend `200` et un corps vide lorsqu'une
politique `USING` ne laisse passer aucune ligne. Ce n'est **pas** un succès silencieux — c'est le
comportement normal d'un `UPDATE … WHERE faux` —, et la preuve ne s'en contente pas : elle **relit**
la ligne et constate qu'elle est intacte.

### 13.9 Le temps réel : ce qui a été mesuré avant d'être spécifié

La Definition of Done exige « temps réel constaté ». Le §4 de `docs/DAT.md` annonce des
« abonnements Realtime pour les commentaires » depuis le socle documentaire ; **aucune table n'était
publiée**. MESURÉ le 2026-08-05 : `select count(*) from pg_publication_tables where pubname =
'supabase_realtime'` rend **0**. `card_comments` est la **première** table du produit à l'être.

**Ce qui a été mesuré, sur une table sonde créée puis détruite** (décision 195) :

| Mesure | Résultat |
|---|---|
| Canal `postgres_changes` ouvert par `supabase-js` à travers Kong, jeton réel | `SUBSCRIBED` |
| `realtime.subscription` pendant que le canal vit | **1 ligne** |
| Insertion par la clé de service, 0 / 100 / 300 / 1000 ms après `SUBSCRIBED` | **1 événement** dans les quatre cas |
| Première sonde, émise dans la seconde suivant l'ajout de la table à la publication | **0 événement** |

Le dernier cas n'a pas été reproduit et **n'est donc pas expliqué**. Il suffit à fonder une règle
d'interface : **le panneau recharge sa liste à l'abonnement**, jamais avant. Tout événement perdu
entre l'ouverture de l'écran et l'établissement du canal est ainsi rattrapé par la lecture qui suit,
et le produit ne dépend pas d'une garantie que la mesure n'établit pas.

**Le temps réel applique la RLS, et c'est une preuve de refus à part entière.** `realtime.apply_rls`
évalue la politique `SELECT` de la table pour le rôle et les revendications de chaque abonné : un
`viewer` fermé sur le track de `grands-comptes` **ne reçoit rien** d'une card de ce channel. La
preuve d'API l'exerce, et c'est le seul endroit du produit où un refus se constate par un
**silence** plutôt que par un code de statut — ce qui exige d'établir d'abord qu'un abonné autorisé,
lui, reçoit bien l'événement. Sans ce témoin, le silence prouverait aussi bien la RLS qu'un temps
réel en panne (décision 50, appliquée au temps réel).

`REPLICA IDENTITY` reste à sa valeur par défaut — la clé primaire. Elle suffit : aucune suppression
physique n'est exposée (§13.7), et une pierre tombale est un `UPDATE` dont la ligne d'arrivée est
lisible (§13.4).

**Une relecture n'est ni une reprise, ni une reconnexion** (décision 315). Trois règles, mesurées
sur le produit exécuté avant d'être écrites ici :

1. **Le canal survit à la relecture.** Recréer l'abonnement à chaque écriture ferait payer une
   reconnexion pour une lecture, et laisserait une fenêtre sans abonné **à l'instant précis où le
   fil change**. Seule une reprise explicite — celle que l'écran offre quand le fil est en erreur —
   refait l'abonnement, parce qu'une erreur peut venir du canal autant que de la requête.
2. **Le fil n'est jamais vidé pour être relu.** L'état de chargement n'est dû que lorsqu'il n'y a
   rien à montrer : première lecture, changement de card, reprise après erreur. Le poser pour une
   relecture ferait disparaître toute la conversation le temps d'un aller-retour — ce qui est
   arrivé, et qu'une capture seule a montré.
3. **Une lecture plus ancienne n'écrase jamais une lecture plus récente.** Deux lectures peuvent
   être en vol en même temps — l'événement de temps réel et le geste qui l'a provoqué se croisent —
   et rien ne garantit l'ordre des réponses. Le rang de garde est pris **par lecture**, jamais par
   abonnement ; sans cela, un commentaire supprimé réapparaît.

### 13.10 Interface : le panneau de commentaires

Le §5.3 de `docs/DESIGN_SYSTEM.md` place à droite du détail de card la timeline unifiée. Elle est
`CRM-044`. `CRM-043` livre **la colonne de droite et le flux des commentaires**, que `CRM-044`
reprendra ; le §5.10 du design system écrit ce que le panneau montre.

- **Ordre chronologique croissant** — le plus ancien en haut, le composeur en bas, comme toute
  conversation. C'est l'inverse du fil d'une timeline d'activité, et c'est délibéré : on lit une
  discussion dans le sens où elle s'est tenue.
- **Un commentaire supprimé reste à sa place**, réduit à la mention « Commentaire supprimé ». Il n'a
  pas de corps à afficher — la base n'en porte plus (§13.4).
- **Un commentaire modifié porte la mention « modifié »**, avec sa date en infobulle.
- **L'auteur est nommé par la relation embarquée de `CRM-022`.** Avatar et nom accompagnent chaque
  commentaire vivant ou supprimé tant que le profil existe. Si le compte a été supprimé,
  `author_id` devient nul par `ON DELETE SET NULL` et le fil affiche « Compte supprimé » sans perdre
  la parole ni exposer d'identifiant technique.
- **Un commentaire retiré par un tiers le dit** — « Commentaire retiré par la modération » au lieu de
  « Commentaire supprimé ». La distinction se lit dans la donnée : `deleted_by` non nul et
  **différent** d'`author_id` (§13.6). Une colonne d'audit que rien ne lit n'audite rien.
  **Le nom du modérateur n'est pas affiché** : dire *qu'un tiers* a retiré un propos et dire *qui*
  l'a retiré ne sont pas la même divulgation, et aucun document ne porte la seconde (§13.13, point
  7). La trace nominative reste en base, opposable.
- **Le geste de modération est offert au seul `admin` du workspace, et il est UNIQUE** — *Supprimer*,
  jamais *Modifier* (décision 376). L'écran lit le rôle courant dans `workspace_members`, filtré sur
  `(workspace_id, user_id)`. Ce n'est **pas** un contrôle d'accès (`CLAUDE.md` §10) : la règle est
  tenue par `card_comments_moderation`, et le cas où l'écran se trompe — rôle retombé depuis le
  chargement — est celui, déjà traité, du `200` rendant **zéro ligne**.

  Offrir *Supprimer* à tous en laissant le `USING` filtrer aurait été plus court, et c'est refusé :
  MESURÉ, un non-administrateur reçoit `200` et zéro ligne, donc une commande qui ne dit rien et ne
  fait rien — ce que le §5.10 du design system refuse déjà à propos de la pierre tombale.

  **La confirmation d'un retrait n'est pas celle d'une suppression** : elle nomme que le commentaire
  appartient à quelqu'un d'autre, et que le retrait sera **enregistré sous le nom** du modérateur.
- **Le composeur est toujours rendu**, et le refus vient du backend. L'interface ne calcule aucun
  droit : elle envoie, et traduit le `403` en « vous ne pouvez pas commenter cette affaire ». C'est
  `CLAUDE.md` §10 pris au mot — un bouton masqué n'est pas une autorisation.
- **Les quatre états** du §5.8 du design system sont traités : chargement, erreur avec reprise,
  refus, et **vide** — « aucun commentaire pour le moment ».
- **Aucune persistance côté client** : ni brouillon en `localStorage`, ni préférence. `CLAUDE.md`
  §11.

### 13.11 Ce que le seed livre

Cinq commentaires, sur **trois** cards, écrits par les **trois** comptes du seed, par la véritable
API REST comme toute autre section (`docs/SPEC-seed.md` §2.14) :

| Card | Auteur | État | Ce qu'il démontre |
|---|---|---|---|
| `…0c1` *Refonte du site vitrine* | Camille Aubert (`admin`) | vivant | le cas nominal |
| `…0c1` | Driss Lemoine (`business_developer`) | vivant | **deux auteurs sur une même card**, donc un fil |
| `…0c1` | Camille Aubert | **modifié** | `edited_at` renseigné : l'état « modifié » est démontré, non seulement décrit |
| `…0c4` *Refonte intranet Ville de Lyon* | Driss Lemoine | **retiré par la modération** | la pierre tombale, corps vide, dans un channel d'un autre track — **et l'audit** : retiré par Camille Aubert avec son jeton réel, `deleted_by` ≠ `author_id` |
| `…0c5` *Support niveau 2* | Farida Nowak (`viewer`) | vivant | **le témoin du refus** : la ligne existe, écrite par la clé de service, et le `viewer` ne peut pas en écrire une seconde par l'API. Sans elle, le §13.8 e prouverait une lecture vide |

Le commentaire de `…0c5` est **posé par la clé de service**, non par le `viewer` : le seed écrit ce
que le produit refuserait, et le dit. C'est la seule ligne du seed dont l'auteur ne pourrait pas
l'écrire lui-même, et elle existe pour que la lecture autorisée soit distinguable d'une table vide.

**Le retrait de `…0d4` passe par le JETON RÉEL de l'administratrice, non par la clé de service**
(décision 376). La clé de service ne porte aucune revendication `sub` : `auth.uid()` y est nul,
`deleted_by` reste donc nul, et la pierre tombale ne démontre alors que la destruction du corps —
jamais la modération. Le corps de `…0d4`, « Note interne publiée par erreur sur la mauvaise
affaire », écrit par Driss Lemoine et retiré par Camille Aubert, est le cas de démonstration exact
du §13.6, et le seul geste qui le produise est celui qu'un modérateur ferait (`CLAUDE.md` §8).
La convergence est inchangée : le retrait reste **conditionné par une relecture** de `deleted_at`.

`mentions` reste `'{}'` sur les cinq : rien ne l'alimente (§13.1).

### 13.12 Ce que `CRM-043` ne livre pas

**~~LES ACTIONS « MODIFIER » ET « SUPPRIMER » NE SONT PAS RENDUES PAR L'ÉCRAN.~~ Elles le sont
depuis le 2026-08-10.** L'écart tenait à une cause nommée, et elle a disparu : les deux gestes
supposent de distinguer *ses* commentaires de ceux des autres, donc de connaître l'identifiant de
l'appelant, donc une session — INC-021, **close par `CRM-009`**. Le raisonnement d'origine reste
juste, et c'est pourquoi il est conservé ici : un bouton offert à tous, qui échouerait pour tous
sauf l'auteur, aurait été une aide d'interface trompeuse.

Ce qui est livré : les deux boutons tertiaires du §5.10, révélés au survol **et au focus clavier**,
la correction en place — dont le champ reçoit le focus, curseur en fin de texte —, et une
confirmation explicite nommant l'irréversible dans le libellé de son action. Une ligne déjà
supprimée n'offre plus rien : le trigger refuserait.

**La comparaison à l'identifiant de session n'est pas un contrôle d'accès** (`CLAUDE.md` §10) : la
règle est tenue par la politique `UPDATE`, qui exige l'auteur **et** le droit d'écriture courant.
Le cas où l'écran se trompe est traité explicitement — un `200` rendant **zéro ligne**, ligne *j*
du §13.8, est affiché comme tel et jamais confondu avec un succès.

**~~AUCUN GESTE DE MODÉRATION N'EST OFFERT PAR L'ÉCRAN.~~ Il l'est depuis le 2026-08-14**
(décision 376, INC-072 close). La forme de l'écart était celle d'INC-085 — *un droit qui n'a pas de
chemin n'est pas un droit* : la règle avait été livrée par la migration `0035` et prouvée en pgTAP
sans qu'aucun administrateur puisse modérer depuis le produit. Ce qui est livré : le rôle courant lu
dans `workspace_members`, l'action **unique** *Supprimer* sur le commentaire d'un tiers, sa
confirmation propre, et la pierre tombale qui distingue un retrait par la modération d'une
suppression par l'auteur. Ce qui ne l'est pas, délibérément : le **nom** du modérateur (§13.13,
point 7).

Outre le §13.1 : aucune pagination du fil — MESURÉ, cinq commentaires au seed, et le §12.6 a montré
ce que coûte une pagination bâtie sans mesure ; aucune recherche dans les commentaires ; aucun
`card_activities`, table voisine que `docs/SCHEMA.md` §5 décrit et qu'aucune unité du chunk 3 ne
porte.

### 13.13 Points ouverts

1. **Le markdown est stocké et rendu en texte brut.** `docs/SCHEMA.md` §5 dit « markdown » ; aucune
   unité ne porte son rendu, et le rendre exigerait une politique d'assainissement qu'aucun document
   n'écrit. Rendre du markdown reçu d'un tiers sans cette politique serait ouvrir une injection.
2. **~~Aucune modération~~ — livrée, serveur puis écran** (§13.6, §13.10, INC-072 close le
   2026-08-14 par les décisions 374 puis 376).
3. **Aucune notification de mention** (§13.1).
4. **L'identité de l'auteur est livrée par `CRM-022`.** INC-014 est close ; la suppression d'un
   compte conserve le commentaire avec son repli « Compte supprimé ».
5. **L'invitation de l'état vide voisine le refus d'écriture, et c'est maladroit** (décision 202).
   VU EN REGARDANT `docs/captures/CRM-043/refus-ecriture-1440.jpg` : « Soyez la première personne à
   commenter cette affaire » s'affiche **juste au-dessus** de « vous ne pouvez pas commenter cette
   affaire ». Les deux textes sont individuellement corrects ; leur voisinage ne l'est pas. La
   corriger supposerait que l'interface sache **avant d'envoyer** que l'utilisateur n'a pas le
   droit d'écrire — un calcul de droit côté client, que `CLAUDE.md` §10 refuse. La seule correction
   honnête est de **retenir** l'invitation une fois un refus reçu, ce qui est un changement de
   composition à part entière. Point ouvert, comportement inchangé.
6. **La pierre tombale est irréversible et le corps est détruit.** Aucun mécanisme de restauration
   n'est prévu, et aucune trace du corps supprimé ne subsiste. C'est le comportement voulu (§13.4) ;
   il est nommé ici pour qu'un besoin d'archivage légal ne le découvre pas après coup.
7. **Le NOM du modérateur n'est pas affiché** (décision 376). Le fil dit qu'un commentaire a été
   retiré par la modération, jamais par qui. Deux raisons, et la seconde compte plus que la
   première : `deleted_by` est un identifiant, que nommer exigerait une seconde relation embarquée
   sur la même table ; surtout, **dire *qu'un tiers* a retiré un propos et dire *qui* l'a retiré ne
   sont pas la même divulgation**, et ni le §13.6 ni le §5.10 du design system ne portent la
   seconde. La trace nominative existe en base et reste opposable. Point ouvert, comportement
   inchangé, arbitrage non tranché ici.
8. **Aucun `card_event` de modération.** Le retrait n'apparaît pas dans la timeline typée : elle
   appartient à `CRM-044`, et l'audit d'INC-072 ne doit pas attendre une unité qu'il ne porte pas
   (décision 374, inchangée). La pierre tombale du fil est la seule surface du fait.

### 13.14 Preuves attendues de `CRM-043`

| Niveau | Preuves |
|---|---|
| pgTAP | Forme de la table, unicité ajoutée à `cards`, clé composite dans les deux sens, `CHECK` conditionnel du corps, trigger d'insertion (dérivation, défauts), trigger de mise à jour (`edited_at`, pierre tombale, refus de résurrection, colonnes gelées), quatre politiques, privilèges de colonne, appartenance à la publication, conformité du seed |
| Unitaire | Projection du fil, ordre chronologique, classification des refus — **`comment_deleted` et `comment_moderation_limitee` distingués** —, état « modifié », état « supprimé », état « retiré par la modération », lecture du rôle de workspace, et le composant réel : l'action **unique** offerte au modérateur, aucune sur le commentaire d'un tiers pour un non-administrateur |
| API | Les seize lignes du §13.8 avec les jetons réels, plus le **temps réel** : le témoin qui reçoit, et le `viewer` fermé qui ne reçoit rien |
| E2E d'interface | Contre le **build de production** : l'anonyme qui n'atteint jamais le panneau sans substitution, puis le fil, l'état vide, la pierre tombale, la mention « modifié » et le refus d'écriture, réponses substituées et **dit comme tel**. **Sans aucune substitution** : l'administratrice retire le commentaire d'un tiers sur la vraie base, l'effet est relu par l'API — `deleted_by` ≠ `author_id` —, et un `business_developer` ne se voit offrir **aucune** action sur ce même commentaire |
| Visuel | Captures aux paliers du §7 du design system : fil chargé, état vide, refus d'écriture, commentaire long, **confirmation de retrait et pierre tombale de modération** |
| Harnais | `scripts/verify-commentaires.sh`, rejouable et **non complaisant** : chaque dégradation volontaire le fait réellement échouer |

---

## 14. Timeline unifiée — `CRM-044`

L'unité tient en **deux lignes** au backlog — « `card_events` alimentée par triggers ; fil
chronologique filtrable » — et sa Definition of Done en une seule : « pgTAP (aucune écriture
cliente possible) ; E2E ; captures ». Quatre documents la nomment sans la décrire :

- `docs/SCHEMA.md` §5 donne les **colonnes** de `card_events` et une liste de types terminée par
  des points de suspension ;
- `docs/SCHEMA.md` §10 lui donne un **index**, `(card_id, created_at DESC)` ;
- `docs/SPEC-permissions-rls.md` §4 lui donne une **règle d'accès** en cinq mots ;
- `docs/DESIGN_SYSTEM.md` §5.3 lui donne une **place** — la colonne de droite du détail de card —
  et cinq sources dont trois n'ont aucune table.

Ce chapitre est écrit **après mesure sur la pile réelle**, et avant toute ligne de code. Les
mesures sont datées du 2026-08-05 et reproduites telles quelles : elles sont la seule chose qui
distingue une spécification d'une intention.

### 14.1 Ce que l'unité est, et ce qu'elle n'est pas

`CRM-044` livre **la mémoire d'une affaire** : ce qui lui est arrivé, dans l'ordre où c'est arrivé,
écrit par la base au moment où ça arrive, et que personne ne peut ni forger ni corriger.

Dans le périmètre :

- `public.card_events`, ses contraintes, ses index, sa politique de lecture, ses privilèges ;
- **cinq triggers** qui l'alimentent, et **rien d'autre** ne l'alimente ;
- l'immuabilité, éprouvée dans les deux sens ;
- l'écran : la colonne de droite du détail de card devient le **fil unifié** annoncé par le §5.10
  du design system, avec ses filtres par type ;
- le seed, qui démontre le fil sans changer d'un iota l'état qu'il livrait hier.

Hors du périmètre, et nommé :

| Ce qui manque | Pourquoi |
|---|---|
| `mail_received`, `mail_sent` | `mail_messages` est livrée par `CRM-054`. Le `CHECK` du §14.4 ne les accepte pas : une valeur autorisée que rien n'écrit est une promesse que personne ne tient |
| `card_activities` — appels, réunions, visios | La table est décrite par `docs/SCHEMA.md` §5 et **aucune unité du chunk 3 ne la porte** |
| Pièces jointes | Aucune table, et `storage.buckets` est vide (`docs/SPEC-permissions-rls.md` §7.2, scénario 9) |
| Le **motif** d'une transition | `move_card` reçoit un `comment` et ne le conserve nulle part — INC-048. Un trigger sur `cards` ne voit pas les arguments de la fonction qui a fait l'`UPDATE` |
| Toute notification | `notifications` n'existe pas, `CRM-063` |
| Toute pagination du fil | Mesuré au §14.11 : le seed produit **27 événements** sur neuf cards. Le §12.6 a montré ce que coûte une pagination bâtie sans mesure |
| Tout temps réel | `card_comments` est la seule table publiée (§13.9). Publier `card_events` ajouterait une surface d'abonnement qu'aucune preuve de cette unité n'exerce ; le fil se relit à l'ouverture de la card |

### 14.2 Modèle : `public.card_events`

`docs/SCHEMA.md` §5, complété par les conventions générales du même document.

| Colonne | Type | Contraintes | Motif |
|---|---|---|---|
| `id` | `uuid` | PK, défaut `gen_random_uuid()` | Convention générale |
| `card_id` | `uuid` | non nul | L'affaire dont c'est la mémoire |
| `workspace_id` | `uuid` | non nul | Cloisonnement, **dérivé** de la card par le trigger qui écrit — jamais décidé par un appelant, puisqu'aucun appelant n'écrit |
| `type` | `text` | non nul, `CHECK` sur les **dix** valeurs du §14.4 | Le vocabulaire est tenu par la base |
| `actor_id` | `uuid` | FK `profiles(id)` `ON DELETE SET NULL`, **nullable** | « Nul si l'auteur est un service » — `docs/SCHEMA.md` §5 |
| `payload` | `jsonb` | non nul, défaut `'{}'` | Avant / après, §14.6 |
| `created_at` | `timestamptz` | non nul, défaut **`clock_timestamp()`** | §14.3 — et c'est le seul écart de cette table à la convention |

**Aucune colonne `updated_at`.** Sixième occurrence d'INC-025, et la première où l'absence n'est pas
un écart mais une **conséquence** : une ligne qui ne peut jamais être modifiée n'a pas de date de
dernière modification. La poser serait écrire une colonne dont la valeur est, par construction,
toujours égale à `created_at`.

### 14.3 Pourquoi `clock_timestamp()` et non `now()` — MESURÉ

`now()` rend l'heure de **début de transaction** : deux événements écrits par la même instruction
portent alors exactement le même horodatage, et l'ordre du fil devient celui, arbitraire, de leurs
`uuid`. Ce n'est pas une hypothèse. MESURÉ le 2026-08-05, sur la sonde `sonde_ev`, avec un seul
`UPDATE` touchant trois colonnes surveillées :

```
   type   |          created_at           | identique_au_premier
----------+-------------------------------+----------------------
 assigned | 2026-08-05 22:05:36.23185+00  | t
 archived | 2026-08-05 22:05:36.232672+00 | f
 trashed  | 2026-08-05 22:05:36.232953+00 | f

 horodatages_distincts | evenements
-----------------------+------------
                     3 |          3
```

Avec `clock_timestamp()`, les trois horodatages sont **distincts et dans l'ordre réel des
écritures**. L'ordre du fil devient donc *total* — l'exigence que `CRM-042` avait tirée de la sonde
`sonde_l2`, où un ordre non total parcouru page par page perdait des lignes — **et** signifiant :
il dit ce qui s'est passé avant quoi, à l'intérieur même d'une transaction.

Le fil est néanmoins terminé par `id` partout où il est servi, parce qu'une égalité reste
concevable (deux transactions concurrentes, résolution d'horloge) et qu'un ordre total ne doit
dépendre d'aucune hypothèse sur l'horloge.

### 14.4 Les dix types livrés

`docs/SCHEMA.md` §5 énumère `created`, `moved`, `field_changed`, `assigned`, `mail_received`,
`mail_sent`, `archived`, puis des points de suspension. Les valeurs suivantes sont livrées, et le
`CHECK` **n'en accepte aucune autre** — **huit** par `CRM-044`, la **neuvième** par `CRM-045`, la
**dixième** par `CRM-019` :

| Type | Écrit quand | Trigger |
|---|---|---|
| `created` | une card naît | `cards`, `AFTER INSERT` |
| `moved` | `current_step_id` change, tandis que `channel_id` **et** `workflow_id` ne changent pas | `cards`, `AFTER UPDATE` |
| `channel_changed` | `channel_id` change — `CRM-045` | `cards`, `AFTER UPDATE` |
| `workflow_changed` | `workflow_id` change tandis que `channel_id` reste identique — `CRM-019` | `cards`, `AFTER UPDATE` |
| `assigned` | `owner_id` change, dans un sens comme dans l'autre — y compris vers `NULL` | `cards`, `AFTER UPDATE` |
| `archived` | `archived_at` passe de nul à renseignée | `cards`, `AFTER UPDATE` |
| `unarchived` | `archived_at` repasse à nul | `cards`, `AFTER UPDATE` |
| `trashed` | `deleted_at` passe de nul à renseignée | `cards`, `AFTER UPDATE` |
| `restored` | `deleted_at` repasse à nul | `cards`, `AFTER UPDATE` |
| `field_changed` | une valeur de formulaire naît ou change | `card_field_values`, `AFTER INSERT OR UPDATE` |

`unarchived` et `restored` ne figurent pas dans la liste de `docs/SCHEMA.md`, et ils sont livrés :
le §4 de ce document dit que la corbeille est **réversible** et que l'archivage n'est pas une
suppression. Un cycle de vie dont la moitié des transitions ne laisse aucune trace n'est pas une
mémoire — c'est un compte rendu partial.

`mail_received` et `mail_sent` sont **refusés par le `CHECK`**. C'est délibéré : le jour où
`CRM-054` livrera `mail_messages`, elle devra étendre l'énumération dans la même migration que le
trigger qui l'écrit, et la base le lui rappellera par un `23514`. L'alternative — accepter dès
aujourd'hui des valeurs que rien ne produit — laisserait croire qu'une capacité existe.

**Le mécanisme a été éprouvé, et il a tenu.** `CRM-045` est la première unité à écrire un type
nouveau : le `CHECK` a refusé `channel_changed` en `23514` — MESURÉ le 2026-08-06 — jusqu'à ce que
sa migration étende l'énumération dans le même changement que son trigger. Ce qui n'était qu'une
intention écrite est désormais un fait constaté.

**`moved`, `channel_changed` et `workflow_changed` s'excluent.** La garde `moved` exige channel et
workflow inchangés : une card remappée entre deux graphes n'a franchi **aucune arête**, même si son
étape change. Le changement de channel prévaut lorsqu'il existe ; sinon le changement de workflow
prévaut sur l'étape. Rien n'est perdu : chacun des deux payloads de contexte porte l'étape d'avant
et celle d'après (`docs/SPEC-workflow-engine.md` §6.7 et
`docs/SPEC-change-channel-workflow.md` §6).

### 14.5 Les triggers, et pourquoi ils sont `SECURITY DEFINER` — MESURÉ

Aucun rôle client ne détient le privilège `INSERT` sur `card_events` (§14.7). Un trigger
`SECURITY INVOKER` s'exécute avec les droits de **l'appelant** : il serait donc refusé, et
refuserait avec lui l'écriture métier qui l'a déclenché. MESURÉ, sur la sonde `sonde_e1` :

```
ERROR:  permission denied for table sonde_e1
CONTEXT:  SQL statement "insert into public.sonde_e1 …"
          PL/pgSQL function public.sonde_e1_invoker() line 3 at SQL statement
```

Le même trigger en `SECURITY DEFINER`, propriété de `postgres`, écrit — **et `auth.uid()` y rend
l'identifiant réel de l'appelant**, ce qui n'allait pas de soi : la revendication JWT est portée par
un paramètre de session, non par le rôle courant, et le changement de droits ne l'efface pas.
MESURÉ :

```
  note   |                acteur
---------+--------------------------------------
 definer | 5eed0000-0000-4000-8000-000000000011
```

Trois propriétés en découlent, et chacune est une règle :

1. **Un trigger d'audit ne refuse jamais l'écriture métier.** `actor_id` n'est renseigné que si
   `auth.uid()` désigne un profil **existant** — sous-requête, non affectation directe. Sans cette
   précaution, un appelant dont le profil aurait disparu ferait échouer la création de sa card sur
   une violation de clé étrangère levée par la trace, non par l'acte.
2. **Un service n'a pas de nom.** La clé de service ne porte pas de revendication `sub` :
   `auth.uid()` y rend `NULL`, et l'événement est attribué à personne — exactement ce que
   `docs/SCHEMA.md` §5 prescrit. Les événements du seed en portent la marque (§14.11).
3. **Le trigger est sur la table, pas dans la RPC.** `docs/DAT.md` §4.2 montre l'écriture d'un
   `card_event` à l'intérieur de `move_card` ; le backlog dit « alimentée par triggers ». Les deux
   sont satisfaits — c'est bien PostgreSQL qui écrit, dans la même transaction, après la mise à
   jour — mais le trigger couvre **strictement plus** : un `PATCH` direct de `owner_id` ou
   d'`archived_at`, qu'aucune RPC ne médie, laisse lui aussi sa trace. Une garde placée dans une
   fonction ne vaut que pour ceux qui empruntent la fonction ; c'est l'argument même de la
   migration 12, retourné vers la trace.

**Aucun événement pour une écriture qui ne change rien.** Chaque garde compare `is distinct from`.
MESURÉ : `update public.cards set title = title || ''` produit **zéro** événement, et une valeur de
formulaire réécrite à l'identique n'en produit pas davantage. C'est ce qui rend le seed
**convergent** : le rejeu n'allonge pas l'histoire.

### 14.6 Ce que chaque `payload` porte

| Type | `payload` |
|---|---|
| `created` | `{title, channel_id, step_id}` — l'état de naissance, tel qu'il était |
| `moved` | `{from_step_id, to_step_id}` |
| `assigned` | `{from_owner_id, to_owner_id}` |
| `channel_changed` | `{from_channel_id, to_channel_id, from_workflow_id, to_workflow_id, from_step_id, to_step_id}` — « l'ancien et le nouveau contexte », `docs/SPEC-workflow-engine.md` §6.7 |
| `workflow_changed` | `{channel_id, from_workflow_id, to_workflow_id, from_step_id, to_step_id}` — le channel reste identique, le graphe et l'étape changent ensemble |
| `archived`, `unarchived`, `trashed`, `restored` | `{}` — la date est `created_at`, l'acteur est `actor_id`, il n'y a rien d'autre à dire |
| `field_changed`, à l'insertion | `{field_id, to}` — **la clé `from` est absente** |
| `field_changed`, à la mise à jour | `{field_id, from, to}` |

**L'absence de la clé `from` est le seul moyen de distinguer deux choses que le JSON confond.**
`docs/SPEC-form-composer.md` §6.9 pose que vider un champ, c'est écrire `'null'::jsonb`. Une valeur
SQL `NULL` et une valeur JSON `null` rendent alors toutes deux `"from": null` — MESURÉ :

```
     type      |                                     payload
---------------+---------------------------------------------------------------------------------
 field_changed | {"to": 42000, "from": null, "field_id": "…081"}     ← la valeur n'existait pas
 field_changed | {"to": null, "from": 42000, "field_id": "…081"}     ← le champ a été vidé
```

Les deux lignes ci-dessus sont issues de la même sonde : la première venait d'une valeur SQL
`NULL`, la seconde d'un `'null'::jsonb` délibéré. Elles sont indistinguables. La clé `from` est donc
**omise** lorsque la ligne naît, et **toujours présente** lorsqu'elle change : « la clé n'est pas
là » signifie « il n'y avait rien », « la clé vaut `null` » signifie « il y avait le vide ».

`payload` ne porte **aucun libellé**. Ni le nom de l'étape, ni la clé du champ, ni le nom du
responsable : ce sont des données d'autres tables, qui changent, et une trace qui les recopierait
dirait demain ce qui était vrai hier. L'écran les résout à la lecture (§14.10).

### 14.7 Autorisations : aucune écriture par un client, et la mesure du refus

`docs/SPEC-permissions-rls.md` §4 : « Lecture de la card. **Aucune écriture par un client** :
triggers uniquement. »

| Rôle | `SELECT` | `INSERT` | `UPDATE` | `DELETE` |
|---|---|---|---|---|
| `anon` | accordé, filtré par la politique | — | — | — |
| `authenticated` | accordé, filtré par la politique | — | — | — |
| `service_role` | accordé | — | — | — |

Une seule politique, en lecture, `app.can_read_card(card_id)` — la troisième table à l'appeler,
après `card_field_values` et `card_comments`. Accordée à `anon` pour que le refus soit **zéro
ligne** et non une erreur de privilège (`docs/SPEC-permissions-rls.md` §3.2).

**Le refus d'écriture est DOUBLE, et il vaut aussi pour la clé de service.** Aucun privilège,
aucune politique. MESURÉ dans les deux cas :

```
 authenticated : ERROR:  permission denied for table sonde_ev
 service_role  : ERROR:  permission denied for table sonde_ev
```

C'est la première table du produit dont `service_role` **n'est pas** propriétaire de l'écriture.
La conséquence est voulue : **le seed lui-même ne peut pas forger un événement.** Tout ce que le
fil montre a été produit par un acte réel passé par les vrais triggers — `CLAUDE.md` §8 pris au
mot, non seulement respecté par convention.

Cette table rend enfin satisfaisable la **moitié** de la preuve de refus n° 8 de
`docs/SPEC-permissions-rls.md` §7 — « insertion directe dans `card_events` ou `audit_log` ».
`card_events` existe désormais et refuse ; `audit_log` reste due par `CRM-072`, et son absence
reste figée. Les assertions des unités précédentes qui constataient l'inexistence de la table sont
**révisées, non retirées** : le mécanisme de la décision 51, onzième occurrence.

### 14.8 L'immuabilité, et la seule porte qui reste ouverte

Un journal que l'on peut réécrire n'est pas un journal.

- **Mise à jour** : refusée à tous les rôles, y compris au propriétaire, par un trigger
  `BEFORE UPDATE` qui lève systématiquement `card_event_immutable`. MESURÉ. Le refus des privilèges
  suffirait aux clients ; le trigger ferme la porte que la clé de service et un accès
  d'exploitation laisseraient ouverte.
- **Suppression** : refusée aux trois rôles clients par double absence — aucun privilège, aucune
  politique. **Aucun trigger `BEFORE DELETE` n'est posé, et c'est un choix mesuré.** La clé
  étrangère composite vers `cards` porte `ON DELETE CASCADE`, exactement comme celle de
  `card_comments` (§13.3) : un trigger de refus rendrait alors **impossible** la suppression
  physique d'une card, geste d'exploitation que la migration 15 avait délibérément préservé.
  MESURÉ : `delete from public.cards where id = …` réussit et emporte les événements.

Ce que cela signifie, écrit sans détour : **une card physiquement supprimée emporte sa mémoire.**
Le produit n'expose aucune suppression physique — archiver et mettre à la corbeille sont des
horodatages (§4) —, mais le propriétaire de la base peut le faire, et la trace ne survit pas à
l'objet tracé. Point ouvert n° 2 du §14.13.

### 14.9 Contrat d'API

Le fil se lit par PostgREST, en **une** requête, comme le panneau de commentaires :

```
GET /rest/v1/card_events?card_id=eq.<id>&select=id,type,actor_id,payload,created_at
    &order=created_at.asc,id.asc
```

| # | Appelant | Requête | Attendu |
|---|---|---|---|
| a | anonyme | `GET` sur une card du seed | `200`, `[]` — refus par défaut |
| b | `admin` | `GET` sur `…0c1` | `200`, les événements de la card, dans l'ordre croissant |
| c | `viewer` | `GET` sur une card d'un channel qui lui est **fermé** | `200`, `[]`, alors que la clé de service y voit des lignes |
| d | `viewer` | `GET` sur une card qu'il **voit** | `200`, les événements — commenter exige d'écrire (INC-071), **lire la mémoire n'exige que de lire** |
| e | `admin` | `POST` d'un événement forgé | `403`, `42501`, `permission denied for table card_events` |
| f | clé de service | `POST` d'un événement forgé | `403`, `42501` — **le service non plus** |
| g | `admin` | `PATCH` d'un événement existant | `403`, `42501` |
| h | `admin` | `DELETE` d'un événement existant | `403`, `42501` |
| i | `admin` | `POST /rpc/move_card` puis relecture du fil | un événement `moved` de plus, `actor_id` = l'administratrice, `payload` portant les deux étapes |
| j | `admin` | `PATCH` d'`owner_id` puis relecture | un événement `assigned` de plus |
| k | `admin` | `PATCH` d'un champ à une valeur **identique** | **aucun** événement de plus |
| l | clé de service | insertion d'une card, puis relecture | un `created` dont `actor_id` est **nul** |

Le §14.14 exige que chacune de ces lignes soit exercée avec les **jetons réels**, et que tout
scénario qui écrit nettoie derrière lui **par identifiant énuméré** — décision 199, INC-061.

### 14.10 Interface : la timeline unifiée

Le §5.10 du design system annonçait le panneau de commentaires comme « la première voie d'un fil
unifié ». `CRM-044` fond les deux : la colonne de droite du détail de card devient **un seul fil**,
alimenté par **deux sources**, avec des filtres par type. Le §5.11 du design system écrit ce que
l'écran montre ; les règles ci-dessous sont celles du produit.

- **Une seule requête par source, jamais une jointure côté client sur des pages différentes.** Le
  fil lit `card_comments` et `card_events` séparément — ce sont deux tables, deux politiques — puis
  **fusionne en mémoire** sur `(created_at, id)`. Aucune des deux n'est paginée (§14.1).
- **Ordre chronologique CROISSANT**, celui du §5.10, **non inversé**. La règle avait été écrite par
  `CRM-043` précisément pour que cette unité ne l'inverse pas par habitude ; elle est reconduite,
  et le composeur reste en bas.
- **Le filtre est une vue, jamais une requête.** Filtrer ne relance rien : les deux sources sont
  déjà chargées, et le filtre masque. Un filtre qui rechargerait ferait dépendre le contenu du fil
  de l'état d'un contrôle d'interface, et rendrait l'état vide ambigu — « rien à cette date » ou
  « rien de ce type ».
- **Cinq familles de filtres**, et pas dix : `Discussion` (les commentaires), `Étapes` (`moved`),
  `Champs` (`field_changed`), `Organisation` (`channel_changed`, `workflow_changed`) et `Cycle de
  vie` (`created`, `archived`, `unarchived`, `trashed`, `restored`, `assigned`). Dix cases pour le
  fil seraient un contrôle plus gros que son objet.
- **Aucune persistance du filtre.** Ni `localStorage`, ni `sessionStorage` : `CLAUDE.md` §11 n'admet
  une donnée sur l'appareil que si elle est nécessaire, et l'état d'un filtre ne l'est pas. Il
  repart complet à chaque ouverture, ce qui est aussi la seule valeur qui ne cache jamais rien.
- **L'acteur consenti est nommé depuis `CRM-022`.** La relation embarquée rend son avatar et son
  nom, jamais son UUID. Un `actor_id` nul reste silencieux : il peut désigner une écriture de
  service autant qu'un profil supprimé, et l'interface ne fabrique pas une identité ambiguë.
- **Les libellés sont résolus à la lecture**, jamais lus dans le `payload` (§14.6) : le nom d'une
  étape vient des étapes du workflow déjà chargées par la fiche, la clé d'un champ vient des
  champs du formulaire. **Lorsque la résolution échoue** — étape supprimée, champ archivé et non
  chargé —, le fil affiche le type de l'événement sans son détail, et **ne construit aucune phrase
  par concaténation** (`CLAUDE.md` §23, décision reprise de `CRM-041`).
- **Quatre états** (§5.8), et **deux vides distincts** : « aucun événement pour le moment » quand
  les deux sources sont vides, « aucun élément pour ces filtres » sinon. Les confondre ferait passer
  un filtre trop restrictif pour une affaire sans histoire.
- **La barre de filtres n'est rendue que si le fil chargé porte quelque chose.** Quatre bascules
  affichant « 0 » au-dessus de « aucun événement » sont un contrôle sans objet — VU sur
  `docs/captures/CRM-044/fil-vide-1440.jpg` (décision 212). Le seuil porte sur le fil **chargé**,
  jamais sur le fil filtré : sinon éteindre toutes les familles ferait disparaître le moyen de les
  rallumer.
- **Les libellés d'étape sont lus par une requête de plus**, `workflow_steps` du workflow de la
  card. La fiche ne charge que l'étape **courante** : sans cette lecture, un déplacement
  n'afficherait **jamais** son détail, et le repli du §5.11 — prévu pour un échec — deviendrait
  l'état normal. Son échec, lui, n'est pas une erreur du fil : la table de libellés est vide et
  chaque `moved` se replie, le fil restant lisible.

### 14.11 Ce que le seed livre

**Le seed ne fabrique aucun événement** — il ne le peut pas (§14.7). Tout ce que le fil montre est
le produit de ses actes réels :

| Source | Événements | Ce que ça démontre |
|---|---|---|
| Les 9 cards insérées | 9 × `created`, `actor_id` **nul** | la naissance, et l'attribution à un service |
| Les 14 valeurs de formulaire | 14 × `field_changed`, `payload` **sans clé `from`** | la valeur qui naît |
| Un aller-retour d'étape sur `…0c4` | 2 × `moved`, `actor_id` = **Camille Aubert** | la transition, dans les deux sens, par la **vraie** RPC `move_card` |
| Un aller-retour de responsable sur `…0c1` | 2 × `assigned`, `actor_id` = **Camille Aubert** | l'attribution, par un **vrai** `PATCH` |

MESURÉ **immédiatement après l'application du seed sur une base neuve** : **27 événements**, dont
**4 portent un acteur réel** et 23 n'en portent aucun. La précision de temps n'est pas une
précaution de style — voir ci-dessous. Les quatre gestes des allers-retours passent par le **jeton réel de
l'administratrice**, non par la clé de service — `move_card` refuserait cette dernière, `auth.uid()`
y étant nul —, et c'est la seule chose du seed qui démontre un `actor_id` non nul.

**Les deux allers-retours laissent l'état du seed rigoureusement identique à celui d'hier.** C'est
la condition pour qu'aucune assertion des unités précédentes ne bouge : la card `…0c4` repart de
l'étape de négociation où elle était, la card `…0c1` retrouve son responsable. Seule l'**histoire**
s'allonge. MESURÉ sur la sonde : l'aller-retour d'étape franchit deux transitions réellement
déclarées — « Revenir en relance » puis « Engager la négociation » — et rend `current_step_id` à sa
valeur de départ.

**LE COMPTE EXACT NE TIENT QU'À CET INSTANT-LÀ, ET C'EST UNE PROPRIÉTÉ DE L'UNITÉ.** Une timeline
enregistre **tout**, y compris ce que les autres preuves du dépôt font à la même pile :
`e2e/api/move-card.spec.ts` déplace des cards du seed et les remet, et chacun de ces gestes laisse
sa trace. Seule la **naissance** d'une card est idempotente — une card ne naît qu'une fois. Les
suites de preuves assèrent donc **neuf `created` exactement**, et des **bornes inférieures** pour
tout le reste. Cette croissance n'est pas un défaut à contenir : c'est la démonstration que la
trace est réelle, et qu'aucune écriture n'y échappe.

**Ils sont conditionnés par une relecture**, comme les commentaires du §13.11 : le seed n'exécute
l'aller-retour que si la card ne porte **aucun** événement du type visé. Sans cette garde, chaque
rejeu allongerait le fil de quatre lignes, et le seed cesserait de converger — ce qui est la seule
propriété que `docs/SPEC-seed.md` exige de lui sans exception.

`entered_step_at` et `position` de `…0c4` sont **réécrits** par l'aller-retour, `move_card` les
maintenant (§2.9). C'est un effet réel du produit, non un effet du seed, et il est nommé ici parce
qu'il est la seule chose que l'aller-retour ne rend pas à l'identique.

### 14.12 Ce que `CRM-044` ne livre pas

Outre le §14.1 :

- **Aucun geste depuis le fil.** On lit, on filtre, on ne fait rien. Reprendre une valeur de champ
  depuis un événement, ou revenir à une étape précédente, supposerait une session — INC-021.
- **Aucune recherche dans le fil**, aucun export, aucune plage de dates.
- **Aucun regroupement par jour.** Vingt-sept lignes n'en demandent pas ; le §12.6 a montré ce que
  coûte une structure bâtie avant sa mesure.
- **Aucun rafraîchissement des faits.** Le fil des commentaires se met à jour tout seul —
  `card_comments` est publiée au temps réel — mais un déplacement effectué par un tiers pendant que
  la fiche est ouverte n'apparaît qu'au prochain chargement. Les événements sont **relus à chaque
  changement du fil des commentaires**, ce qui est un effet de bord assumé et non une garantie.
- **Aucun événement pour un commentaire.** Un commentaire *est* dans le fil — il en est la première
  source — mais il n'écrit **pas** de ligne dans `card_events`. Le dupliquer produirait deux
  représentations d'un même fait, dont l'une survivrait à la suppression de l'autre.

### 14.13 Points ouverts

1. **Le motif d'une transition reste perdu** — INC-048, enrichie une seconde fois. La destination
   existe maintenant *deux fois* : `card_comments` depuis `CRM-043`, `card_events.payload` depuis
   cette unité. Un trigger sur `cards` ne voit **pas** les arguments de `move_card` : l'écrire
   supposerait de rouvrir `move_card`, livrable de `CRM-034`. L'arbitrage porte désormais sur
   *laquelle* des deux destinations, et il est exigible.
2. **Une card physiquement supprimée emporte sa mémoire** (§14.8). Les deux issues sont écrites :
   soit la trace survit à l'objet — clé étrangère sans cascade, `card_id` conservé sans intégrité —,
   soit la suppression physique disparaît du produit. Aucune n'est prise ici.
3. **`actor_id` est perdu si le profil disparaît** (`ON DELETE SET NULL`). Un journal d'audit qui
   oublie ses acteurs est une demi-mémoire ; conserver l'identifiant sans clé étrangère serait la
   solution, et c'est une décision de conformité, pas une décision d'agent.
4. **`docs/SCHEMA.md` §10 déclare l'index en `DESC`, le fil est servi en `ASC`.** Ce n'est pas une
   contradiction — un index btree se parcourt dans les deux sens — mais l'index ne sert **pas**
   l'ordre à ce volume. MESURÉ sur 3 600 lignes : le planificateur choisit un `Bitmap Index Scan`
   suivi d'un `Sort`, l'index servant le **filtre** `card_id` et non le tri. L'index est posé tel
   que `docs/SCHEMA.md` l'annonce, et ce qu'il fait réellement est écrit ici.
5. **QUATRE DÉFAUTS ONT ÉTÉ TROUVÉS EN REGARDANT LES CAPTURES, ALORS QUE LES 127 SCÉNARIOS
   D'INTERFACE ÉTAIENT VERTS** (décision 212). Trois viennent d'une classe utilitaire **hors de
   l'échelle discrète** du §3 du design system — `gap-1.5` et `size-7` ne produisent **aucune**
   règle CSS et n'échouent jamais bruyamment : le compte était collé au libellé, et la pastille
   d'icône n'avait ni taille ni fond. Le quatrième est une composition correcte dans un cas et
   absurde dans l'autre : la barre de filtres débordait du panneau à 1440 px. Les quatre sont
   corrigés, et `scripts/verify-timeline.sh` fige ce qui les a causés. **Le point ouvert est le
   mécanisme** : rien, dans l'outillage, ne signale une classe qui n'existe pas.
6. **Aucun temps réel** (§14.1). Le fil d'une card ouverte ne bouge pas quand un tiers agit ;
   `card_comments` est publiée, `card_events` ne l'est pas, et le panneau unifié se relit donc
   **entièrement** à chaque événement de commentaire. Le coût est nommé : une requête de plus par
   commentaire reçu.

### 14.14 Preuves attendues de `CRM-044`

| Niveau | Preuves |
|---|---|
| pgTAP | Forme de la table, `CHECK` des huit types dans les deux sens, clé composite, index, **absence de tout privilège d'écriture pour les trois rôles**, politique unique de lecture, les cinq triggers et leur `SECURITY DEFINER`, l'immuabilité, les événements réellement produits par le seed, et les gardes révisées des unités antérieures |
| Unitaire | Fusion des deux sources, ordre total, familles de filtres, résolution des libellés et **son échec**, et le composant réel |
| API | Les douze lignes du §14.9 avec les jetons réels des trois comptes, nettoyage **constaté** par relecture |
| E2E d'interface | Contre le **build de production** : l'anonyme qui n'obtient rien sans substitution, puis le fil unifié, ses filtres, son état vide par filtre, réponses substituées et **dit comme tel** |
| Visuel | Captures aux paliers du §7 du design system : fil complet, fil filtré, état vide d'un filtre, fil long |
| Harnais | `scripts/verify-timeline.sh`, rejouable et **non complaisant** : chaque dégradation volontaire — privilège d'écriture rendu, trigger retiré, `CHECK` élargi, politique de lecture ouverte, immuabilité levée — le fait réellement échouer |

---

## 15. Interface : l'en-tête de la fiche d'affaire — `CRM-040`

Ce chapitre n'existait pas. Le §1.2 rangeait « toute interface » hors du périmètre de `CRM-040` au
motif d'INC-021 — « exige une session, donc un écran de connexion, qu'aucune unité ne porte ». **Ce
motif a disparu** : INC-021 est close depuis `CRM-009`, la fiche existe depuis `CRM-037`
(`webapp/src/app/RouteCard.tsx`), et trois documents nomment depuis lors le même reste avec les
mêmes mots — `docs/DESIGN_SYSTEM.md` §5.3 (« les champs d'entête (titre, responsable, montant,
prochaine action) »), `docs/SPEC-form-composer.md` §446 (« les champs d'en-tête de la card
(`CRM-040`) restent dus par leurs unités ») et `docs/SPEC-manual.md` §183 (« seuls les champs
d'en-tête manquent »). Trois renvois, aucun contrat : ce chapitre l'écrit.

Il est écrit **après mesure de la pile réelle** — PostgREST `v14.12`, PostgreSQL
`supabase/postgres:17.6.1.136`, le seed en base —, le 2026-08-16, et non de mémoire. Chaque fait
cité « MESURÉ » ci-dessous a été observé avec les jetons réels des comptes seedés.

### 15.1 Ce que la tranche livre, et ce qu'elle ne livre pas

Elle livre **la lecture** : l'en-tête de la fiche montre ce qu'une affaire est — son titre, son
responsable, son montant, sa prochaine action et son échéance — et son **adresse email**, avec
l'action de copie et l'explication d'usage que `docs/DESIGN_SYSTEM.md` §5.3 exige depuis `CRM-000`.
Aucune de ces six données n'atteint aujourd'hui l'écran : la fiche ouvre directement sur le
formulaire conditionnel, et le titre n'est visible que dans l'en-tête d'application.

Elle **ne livre pas l'écriture de ces champs**, et l'écart est nommé plutôt que masqué. MESURÉ, le
rôle `authenticated` porte bien le privilège `UPDATE` sur les six colonnes concernées — `title`,
`owner_id`, `amount`, `currency`, `next_action`, `next_action_at` —, donc **rien en base ne bloque
la tranche suivante** : ce qui manque est le geste d'interface, ses refus et ses preuves, soit un
volume comparable au §4 bis du composeur de formulaire. Le livrer à moitié serait pire que
l'annoncer.

Elle ne livre pas davantage : la création d'une affaire (aucun écran ne la porte), l'archivage
(§4 en donne l'état, aucun geste ne l'écrit), ni la corbeille — livrée, elle, par `CRM-077` et déjà
présente en bas de la même colonne.

### 15.2 Où l'en-tête vit, et pourquoi au-dessus du formulaire

Le §5.3 du design system range dans la colonne GAUCHE « le formulaire conditionnel […] et les
champs d'entête ». L'en-tête se place **au-dessus** du formulaire, et non en dessous :

- il dit **ce qu'est** l'affaire, là où le formulaire dit ce qu'on en sait. On lit l'identité avant
  le dossier ;
- le geste de mise à la corbeille (`CRM-077`) occupe déjà le bas de cette colonne, séparé par une
  bordure haute. Insérer l'en-tête entre le formulaire et lui mettrait une identité entre un
  dossier et son retrait ;
- la reprise d'un déplacement refusé (§4 ter de `docs/SPEC-form-composer.md`) déplace le focus vers
  le **premier champ exigé** du formulaire et l'amène au centre. Un en-tête placé au-dessus est
  franchi par ce défilement sans le gêner ; placé en dessous, il aurait été poussé hors de vue.

L'ordre de la colonne gauche est donc, de haut en bas : **en-tête**, formulaire, bloc de corbeille.

### 15.3 Ce que l'en-tête lit, et en combien de requêtes

**Aucune requête supplémentaire.** La fiche lit déjà sa card par `lireCard`
(`webapp/src/lib/formulaire.ts`) ; la tranche **élargit ce `select`** au lieu d'en émettre un
second. Les colonnes ajoutées sont `amount`, `currency`, `next_action`, `next_action_at`,
`archived_at`, plus deux relations embarquées.

**Le responsable vient d'une relation embarquée, et son nom doit être désambiguïsé.** MESURÉ, un
`profiles(full_name)` nu est refusé en `PGRST201` :

```
"code":"PGRST201" … "hint":"Try changing 'profiles' to one of …"
  cards_created_by_fkey  cards_deleted_by_fkey  cards_owner_id_fkey
```

Trois clés étrangères de `cards` désignent `profiles` — `owner_id`, `created_by`, `deleted_by` —, et
PostgREST refuse de choisir. La relation s'écrit donc **par le nom de sa contrainte** :
`profiles!cards_owner_id_fkey(id, full_name, avatar_url)`. MESURÉ, elle rend l'objet du profil sur
la card `c2` (« Driss Lemoine ») et **`null`** sur la card `c6`, qui n'a pas de responsable.

**L'adresse complète est composée à l'écran, jamais lue en colonne.** Le §3.5 pose que
`email_local_part || '@' || workspaces.inbound_domain` est une **dérivation** et n'est pas stockée.
La fiche embarque donc `workspaces(inbound_domain)` — relation non ambiguë, une seule clé étrangère
— dans le même `select`. MESURÉ : `workspaces` est lisible par un membre, y compris par le `viewer`
(`inbound_domain` rendu), et rend **zéro ligne** à un appelant anonyme. Ce dernier point ne change
rien à l'écran : sans session, la card elle-même est déjà `null` et la fiche rend « affaire
introuvable » (`CRM-037`).

**Le domaine peut manquer sans que la card manque.** C'est le cas d'un appelant qui obtiendrait la
card sans le workspace ; l'écran ne compose alors **aucune** adresse et n'affiche pas non plus la
partie locale seule — une adresse tronquée serait une adresse fausse, et la copier enverrait un mail
nulle part. Le bloc écrit à la place que l'adresse n'est pas disponible (§15.7).

### 15.4 Les six données, et comment chacune se rend

| Donnée | Source | Rendu | Absente |
|---|---|---|---|
| Titre | `cards.title` | `h2`, titre de niveau 2 du §2 du design system. Non nul par contrainte (§2.3) | ne peut pas l'être |
| Responsable | `profiles!cards_owner_id_fkey` | avatar 32 px (`CRM-022`) **suivi du nom écrit** ; l'avatar est alors décoratif | « Aucun responsable », en toutes lettres |
| Montant | `cards.amount`, `cards.currency` | **donnée technique** (§2 du design system) : monospace, chiffres tabulaires, formaté par `Intl.NumberFormat` en `fr-FR` avec le code devise | la ligne entière est absente |
| Prochaine action | `cards.next_action` | texte courant | la ligne entière est absente |
| Échéance | `cards.next_action_at` | **donnée technique**, date courte, à côté de la prochaine action | l'échéance seule est omise, la prochaine action reste |
| Adresse email | `email_local_part` + `workspaces.inbound_domain` | `code`, monospace, avec l'action de copie du §15.5 | mention d'indisponibilité (§15.3) |

**Une donnée absente n'est jamais un tiret.** La règle du §5.9 du design system — « ni tiret, ni
“—”, ni “non renseigné” » — vaut pour une **cellule** de tableau, où la colonne dit déjà de quoi il
s'agit. Ici il n'y a pas de colonne : une ligne « Montant » vide se lirait comme un défaut
d'affichage. La règle retenue est donc **l'omission de la ligne entière** pour le montant et la
prochaine action, et une **phrase** pour le responsable — parce que « personne n'en est
responsable » est un fait de l'affaire, là qu'« aucun montant » n'en est pas un : une affaire sans
montant chiffré est le cas ordinaire d'un début de qualification.

**Le montant n'est pas formaté en devise « native ».** `Intl.NumberFormat('fr-FR', { style:
'currency', currency })` lèverait `RangeError` sur un code que le navigateur ne connaît pas, et la
base ne contraint que la **forme** du code, jamais sa liste réelle (§2.1). Le rendu emploie donc le
format numérique à deux décimales, suivi du code devise **dans son propre élément** — jamais accolé
par un nœud de texte nu, défaut « Discussion1 » mesuré au §5.11 du design system.

**Une affaire archivée est NOMMÉE dans son en-tête.** `archived_at` est lue et rend la pilule
« Archivé » `--color-accent-soft` / `--color-accent-on-soft` avec son icône `Archive`, exactement
comme un champ archivé (§5.15 du design system) et un nœud archivé (§5.18). MESURÉ, la card `c8`
« Contrat cadre 2025 » du seed porte `archived_at` et **reste lisible** par sa route : sans cette
mention, l'écran d'une affaire close serait indistinguable de celui d'une affaire en cours.

### 15.5 L'action de copie, et ce qu'elle promet

Le §5.3 du design system exige « une action de copie et une infobulle expliquant son usage ». Trois
décisions, chacune motivée :

1. **C'est un `button`, pas un lien `mailto:`.** L'adresse d'une card n'est pas une adresse à
   laquelle on écrit depuis son client : c'est celle qu'on **donne** à un tiers ou qu'on met en
   copie pour que le fil de l'affaire reçoive le message (§3.1). Un `mailto:` ouvrirait un
   composeur, geste que personne n'a demandé.
2. **L'explication d'usage est un texte, pas seulement un `title`.** Une infobulle native
   n'apparaît ni au clavier, ni au toucher. La phrase — « mettez cette adresse en copie : les
   messages rejoignent le fil de l'affaire » — est écrite **sous** l'adresse, en 13 px
   `--color-text-3`, à la place et dans la graduation du texte d'aide du §5.7. Le `title` est
   conservé **en plus**, pour la souris.
3. **La confirmation remplace le libellé de la commande, et rien d'autre ne bouge.** « Copié » se
   substitue à « Copier l'adresse » pendant deux secondes, dans une région `role="status"` (§8) ;
   le bouton conserve sa largeur minimale pour que la ligne ne se décale pas. C'est la règle du
   §5.7 ter — « la confirmation remplace l'envoi, elle ne s'y ajoute pas » — appliquée à un geste
   de lecture.

**L'échec de la copie est dit, jamais tu.** `navigator.clipboard` n'existe pas dans tout contexte —
un document non sécurisé n'y a pas droit, et la permission peut être refusée. Le geste **rend alors
un refus** : « la copie n'a pas abouti, sélectionnez l'adresse pour la copier ». Un bouton qui ne
fait rien en silence est la « simulation de succès » que `CLAUDE.md` §18 interdit.

**La commande n'est pas rendue lorsqu'il n'y a pas d'adresse à copier** (§15.3) — une commande sans
objet est une commande morte (§5.10 du design system).

### 15.6 Accessibilité

- L'en-tête est une `section` portant `aria-labelledby` vers son `h2` — le titre de l'affaire.
  C'est le **seul** `h2` de la colonne gauche à ce jour, et aucun niveau n'est sauté : `AppShell`
  porte le `h1` de la route.
- Chaque donnée est un couple **terme / valeur** dans une `dl` : le libellé « Responsable »,
  « Montant », « Prochaine action » est lu avec sa valeur, et non comme un texte flottant.
- L'avatar est **décoratif** (`decoratif`), le nom étant écrit à côté : sans quoi un lecteur
  d'écran annoncerait deux fois la même personne (`docs/SPEC-identite.md` §7).
- La commande de copie porte un nom accessible complet — « Copier l'adresse email de l'affaire » —
  et non le seul mot « Copier », qui ne dirait pas ce qui est copié hors contexte visuel.
- Cible ≥ 40 px, anneau de focus du §8, et l'issue du geste annoncée par `role="status"`.

### 15.7 États

L'en-tête n'a **ni état de chargement, ni état d'erreur propres** : il est rendu par la même route
que le formulaire, à partir de la **même** réponse. Tant que la card n'est pas là, la fiche entière
ne rend rien ; si elle est refusée ou absente, la fiche rend déjà « affaire introuvable ». Lui
donner des états à lui serait inventer un chargement qui n'a pas lieu.

Trois états lui appartiennent en propre, et ils portent tous sur une **donnée** :

| État | Rendu |
|---|---|
| Aucun responsable (`owner_id` nul, ou profil détaché) | « Aucun responsable » |
| Adresse non composable (domaine du workspace absent) | « Adresse indisponible », **aucune** commande de copie |
| Affaire archivée | pilule « Archivé » à côté du titre |

### 15.8 Traçabilité et internationalisation

Aucun texte visible n'est écrit en dur : toutes les clés vivent dans `webapp/src/i18n/fr.ts`, sous
le préfixe `card.header.*`, et `webapp/src/i18n/i18n.test.ts` fait échouer toute violation
(§10 du design system). Les libellés d'affaire — titre, prochaine action — sont des **données**, pas
des traductions.

### 15.9 Points ouverts propres à l'en-tête

1. **L'écriture des six champs n'est pas livrée** (§15.1). Les privilèges existent ; le geste, ses
   refus et ses preuves restent dus. Ce n'est pas un blocage, c'est une tranche.
2. **`probability_override` n'est pas affichée.** Le §5.3 du design system ne la nomme pas parmi les
   champs d'en-tête, et l'ajouter sans qu'aucun document la demande inventerait une règle de
   produit.
3. **L'échéance n'est pas qualifiée.** Une `next_action_at` dépassée se rend comme les autres, sans
   teinte ni mention « en retard » : le seuil de relance est une décision de produit que personne
   n'a prise, et `health_score` — qui la porterait — n'est jamais alimentée (§2.9).

### 15.10 Preuves attendues de cette tranche

| Niveau | Preuves |
|---|---|
| pgTAP | **Aucune suite dédiée** : la tranche ne livre ni table, ni fonction, ni politique. Les colonnes qu'elle lit sont déjà couvertes par `supabase/tests/0012_cards.test.sql` |
| Unitaire | Composition de l'adresse et son absence, formatage du montant et de l'échéance, et le composant réel — responsable présent et absent, montant présent et absent, affaire archivée, copie réussie et copie refusée |
| API | Les faits mesurés du §15.3 rejoués : l'ambiguïté `PGRST201`, la relation désambiguïsée, l'embarquement du domaine, et le refus anonyme |
| E2E d'interface | Contre le **build de production**, sur une session réelle : l'en-tête d'une affaire du seed avec ses six données, l'affaire sans responsable ni montant, et l'affaire archivée |
| Visuel | Captures observées aux paliers du §7 du design system |

## 15 bis. Écrire les six champs d'en-tête — `CRM-040`

Ce chapitre est écrit **avant la première ligne de code** de la tranche qui livre l'écriture, et
**après mesure** sur la pile réelle le 2026-08-16 : jetons obtenus par la route de connexion réelle
des trois comptes seedés, `PATCH` sur `/rest/v1/cards` avec les cards `…0000c6` et `…0000c8`, codes
HTTP et `SQLSTATE` relevés à la main, état du seed restauré après chaque mesure. Les valeurs citées
ne sont pas supposées.

Il existe parce que le §15.1 posait « elle ne livre pas l'écriture de ces champs » en nommant
l'écart plutôt qu'en le masquant, et que le §15.9.1 le désignait comme « une tranche, pas un
blocage ». Aucune règle métier n'est créée ici : `CRM-040` livre déjà la table, ses politiques et
ses privilèges de colonne, et `CRM-013` a fermé les deux colonnes qui devaient l'être. Ce chapitre
décrit **le chemin vers elles**, et rien d'autre.

### 15 bis.1 Ce que le geste est, et ce qu'il n'est pas

Le geste est : **corriger, depuis la fiche, l'une des six données d'en-tête d'une affaire** — son
titre, son responsable, son montant, sa devise, sa prochaine action et l'échéance de celle-ci.

Il n'est pas :

- une transition — `current_step_id` est **fermée par privilège** (mesure `j` du §15 bis.8) et
  appartient à `move_card` (`CRM-034`) ;
- une modification de l'adresse — `email_local_part` est fermée par le même mécanisme (`CRM-013`) ;
- la saisie d'un champ de formulaire — c'est le §4 bis de `docs/SPEC-form-composer.md`, geste
  distinct sur une table distincte ;
- la création d'une affaire, ni son archivage, ni sa mise à la corbeille — la première n'a aucun
  écran, la deuxième aucun geste, la troisième est livrée par `CRM-077` en bas de la même colonne.

Les six colonnes sont celles que le §15.1 nomme, et la mesure confirme qu'elles sont **exactement**
celles que `authenticated` peut écrire parmi les données d'en-tête. `description`,
`probability_override`, `position` et `snoozed_until` sont ouvertes en base mais **hors de cette
tranche** : aucune n'atteint l'en-tête en lecture (§15.4), et livrer l'écriture d'une donnée que
l'écran ne montre pas inventerait une règle de produit.

### 15 bis.2 Un champ, une écriture — et la mesure qui l'impose

L'écriture est **par champ**, comme au §4 bis.2 du composeur, et ici la mesure est plus contraignante
encore : **chaque colonne a son refus propre, et ils ne se ressemblent pas**.

```
title = ""                    => 400  23514  cards_title_check
currency = "eur"              => 400  23514  cards_currency_check
next_action_at = "pas-une-date" => 400  22007  invalid input syntax for type timestamp with time zone
owner_id = <uuid inconnu>     => 409  23503  cards_owner_id_fkey
```

Un `PATCH` portant plusieurs colonnes est **une seule instruction** : une devise mal formée ferait
échouer le titre saisi en même temps, et l'écran n'aurait qu'un refus global là où le §5.7 du design
system exige l'erreur **au niveau du champ**. MESURÉ, le lot fonctionne — `{"amount":1234.5,
"currency":"USD"}` rend `200` — ; ce n'est pas une impossibilité technique, c'est une perte
d'attribution que le produit refuse.

Écrire champ par champ rend en outre chaque écriture **indépendante** : un refus sur la devise laisse
le titre enregistré, ce qui est le comportement honnête.

### 15 bis.3 Le moment de l'écriture

| Contrôle | Déclencheur |
|---|---|
| titre, montant, devise, prochaine action, échéance | **perte du focus** (`blur`), et seulement si la valeur a changé |
| responsable | **changement** (`change`) — c'est une liste |

La règle et son motif sont ceux du §4 bis.3, sans changement : écrire à chaque caractère produirait
une requête par touche, et pour le responsable un événement `assigned` par touche dans le fil de
`CRM-044` (§15 bis.6). Le changement pour la liste : sa valeur est complète dès qu'elle est choisie.

**Aucune écriture n'est émise si la valeur n'a pas changé**, la comparaison portant sur la valeur
**normalisée** (§15 bis.4) et non sur le texte saisi.

### 15 bis.4 Ce qui est écrit, et sous quelle forme

| Donnée | Colonne | Ce qui est envoyé | Vidé |
|---|---|---|---|
| Titre | `title` | la chaîne **sans `trim`** | impossible : la contrainte le refuse (§15 bis.5) |
| Responsable | `owner_id` | l'`uuid` choisi | `null` — « Aucun responsable » est une option de la liste |
| Montant | `amount` | un **nombre** JSON | `null` |
| Devise | `currency` | trois lettres **en majuscules** | impossible : la colonne est `NOT NULL` (mesure `g`) |
| Prochaine action | `next_action` | la chaîne sans `trim` | `null` |
| Échéance | `next_action_at` | l'horodatage rendu par le contrôle | `null` |

**Sans `trim`, et c'est la décision du §4 bis.4 reprise sans changement** : rogner à l'écriture ferait
diverger ce que l'utilisateur voit de ce que la base porte. La différence avec le composeur est que
`cards_title_check` **refuse** une chaîne de blancs — mesuré, `"   "` rend `23514` comme `""` —, si
bien que l'écran n'a pas à décider ce qu'une telle saisie signifie : la base le décide, et le refus
est montré.

**La devise est mise en majuscules par l'écran, et ce n'est pas une validation.** MESURÉ, `"eur"`
est refusé en `23514` : la contrainte porte sur la **forme**, trois lettres majuscules. Passer la
saisie en majuscules épargne un refus que l'utilisateur ne comprendrait pas — il a bien tapé sa
devise — sans jamais décider à la place de la base : une saisie de quatre lettres reste envoyée, et
son refus reste montré.

**Aucune liste fermée de devises.** La base ne contraint que la forme du code, jamais sa liste
réelle (§2.1) : en fermer une à l'écran interdirait une devise que la base accepte. C'est le motif
qui interdit déjà `style: 'currency'` au rendu (§15.4), vu depuis l'écriture.

**`updated_at` n'est pas écrite** : MESURÉ, le trigger l'avance de lui-même à chaque `PATCH`
(`11:28:29.131417+00:00` observé après la mesure `a`). L'écrire depuis le client serait une seconde
version de la même information, qui pourrait la contredire — c'est le motif du §4 bis.4 pour
`updated_by`.

### 15 bis.5 Ce que le produit N'invente PAS

Trois refus appartiennent à la base et **ne sont pas anticipés par l'écran** :

1. **Un titre vide n'est pas rattrapé côté écran.** Aucun `required` HTML, aucune garde de saisie :
   la contrainte `cards_title_check` est la règle, et une garde d'interface qui la doublerait ferait
   passer une décision de la base pour une décision d'écran (`CLAUDE.md` §10). Le contrôle envoie, la
   base refuse, l'écran dit le refus.
2. **Un montant négatif est ACCEPTÉ.** MESURÉ, `{"amount":-500}` rend `200` : `amount` n'est pas
   contraint en signe, limite déjà nommée par le §10 et **figée par une assertion**. L'écran ne pose
   donc aucun `min` : refuser un négatif à l'écran serait une règle de produit que personne n'a
   prise, et le §10 dit exactement cela.
3. **Une affaire archivée reste modifiable.** MESURÉ, `PATCH` sur `…0000c8` rend `200`. L'écran
   **n'éteint rien** : la pilule « Archivé » du §15.4 dit l'état, elle ne le transforme pas en refus
   que la base ne prononce pas.

### 15 bis.6 Le responsable, et la seule écriture qui laisse une trace

**La liste des membres est lue, et pas devinée.** L'option « Aucun responsable » plus une entrée par
membre du workspace de l'affaire :

```
GET /rest/v1/workspace_members?select=user_id,role,profiles(id,full_name,avatar_url)
                              &workspace_id=eq.<workspace de la card>
```

MESURÉ : la relation `profiles` n'est **pas** ambiguë ici — une seule clé étrangère de
`workspace_members` la désigne —, et s'écrit donc simplement, à la différence de celle de `cards`
(§15.3). Elle rend les trois membres du seed à l'`admin` **comme au `viewer`** (§3.3 de
`docs/SPEC-identite.md` : le nom d'un collègue est une donnée d'équipe), et `[]` à un appelant
anonyme.

**Elle n'est émise qu'à l'ouverture de l'édition**, jamais au chargement de la fiche. L'en-tête est
d'abord une lecture (§15.1) ; charger la liste des membres pour un geste que la plupart des visites
ne font pas serait une requête gratuite sur l'écran le plus ouvert du produit.

**Le nom affiché après un changement vient de cette liste, jamais d'une relecture.** La
représentation rendue par le `PATCH` ne porte pas la relation embarquée : relire la card entière pour
un nom déjà en main serait un aller-retour gratuit, et le §4 bis.8 a déjà tranché ce cas.

**Changer le responsable est la SEULE des six écritures qui laisse une trace dans le fil**, et c'est
mesuré, non supposé :

```
{"type":"assigned",
 "payload":{"from_owner_id":null,"to_owner_id":"…000012"},
 "actor_id":"…000011"}
```

Le titre, le montant, la devise, la prochaine action et l'échéance n'engendrent **aucun** événement :
la mesure a relu `card_events` après chacune et n'y a trouvé que l'`assigned` ci-dessus. Ce n'est
**pas** un écart à corriger dans cette tranche — les dix types livrés par `CRM-044` sont ce que le
§14.4 énumère, et en ajouter un demanderait un trigger, donc une migration, donc `CRM-044`. L'écart
est **nommé** ici (§15 bis.10, point 2) plutôt que comblé au passage.

`actor_id` est posé par le serveur à partir de la session réelle : l'écran ne le fournit jamais.

### 15 bis.7 Les issues, dictionnaire fermé — et la quatrième n'est pas un refus

Cinq issues, classées sur le code HTTP et le `SQLSTATE`, **jamais** sur le message du serveur.

| Issue | Mesure | Ce que l'écran dit |
|---|---|---|
| `enregistree` | `200` **et au moins une ligne** rendue | « Enregistré » (§5.7 ter) |
| `sans-effet` | `200` **et zéro ligne** | le droit d'écrire sur cette affaire manque |
| `invalide` | `400`, `23514` ou `22007` | la valeur ne convient pas à ce champ |
| `introuvable` | `409`, `23503` | la personne choisie n'est plus membre — rouvrir la liste |
| `refus` | `403`, `42501` | l'enregistrement a échoué (colonne fermée : hors du geste, §15 bis.1) |
| `reseau` | aucune réponse | la connexion a échoué, réessayer |
| `inconnu` | tout le reste | l'enregistrement a échoué |

**LA QUATRIÈME LIGNE EST LA DÉCOUVERTE DE CETTE MESURE, et elle contredit ce qu'on attendait.** Le
`viewer` qui **voit** une affaire et tente d'en écrire le titre ne reçoit **pas** `403` :

```
PATCH /rest/v1/cards?id=eq.…0000c6   (jeton réel du viewer)
=> 200   []
```

La politique `cards_maj` filtre par sa clause `USING` **avant** la mise à jour : aucune ligne n'est
candidate, aucune erreur n'est levée, et PostgREST rend un tableau vide. C'est exactement la
troisième issue du geste de mise à la corbeille (`docs/SPEC-corbeille.md` §4 ter.3), et le produit la
traite de la même façon : **ni un succès, ni une erreur d'application**, mais un état que l'écran
nomme. Annoncer « Enregistré » sur zéro ligne serait la « simulation de succès » que `CLAUDE.md` §18
interdit — et c'est le piège que cette mesure a évité.

**La conséquence sur la forme de la requête est obligatoire** : le `PATCH` porte
`Prefer: return=representation`, sans quoi PostgREST rend `204` et **aucun corps**, et les deux
premières issues deviendraient indistinguables.

**L'écran n'éteint aucune commande d'avance en fonction du rôle**, exactement comme le geste de mise
à la corbeille (§5.3 du design system) et la saisie de valeur (§4 bis.7) : la règle vit dans la
politique RLS, et le refus est **montré**, jamais anticipé.

### 15 bis.8 Contrat d'API, mesuré

Quinze lignes, mesurées le 2026-08-16 sur la pile réelle avant d'être écrites. L'état du seed a été
restauré après la série.

| # | Appelant | Geste | Mesuré |
|---|---|---|---|
| a | `admin` | `PATCH title` sur `…0000c6` | `200`, la ligne modifiée, `updated_at` avancé par trigger |
| b | `viewer` | `PATCH title` sur une affaire qu'il **voit** | **`200` et zéro ligne** — jamais `403` |
| c | `bizdev` | `PATCH title` | `200`, la ligne modifiée — la politique porte sur le droit d'écriture du channel, pas sur un rôle |
| d | `admin` | `title = ""` | `400`, `23514`, `cards_title_check` |
| e | `admin` | `title = "   "` | `400`, `23514` — la base traite les blancs comme le vide |
| f | `admin` | `amount = -500` | **`200`** — aucune contrainte de signe (§10) |
| g | `admin` | `currency = null` | `400`, `23502` — colonne `NOT NULL` |
| h | `admin` | `currency = "eur"` ou `"EURO"` | `400`, `23514`, `cards_currency_check` |
| i | `admin` | `next_action_at = "pas-une-date"` | `400`, `22007` |
| j | `admin` | `owner_id` = `uuid` inconnu | `409`, `23503`, `cards_owner_id_fkey` |
| k | `admin` | `current_step_id` | `403`, `42501` — privilège de colonne (`CRM-034`) |
| l | `admin` | `email_local_part` | `403`, `42501` — privilège de colonne (`CRM-013`) |
| m | `admin` | les quatre colonnes nullables à `null` | `200`, vidées |
| n | `admin` | changement d'`owner_id` | `200`, **et un événement `assigned`** portant `from_owner_id`, `to_owner_id` et l'`actor_id` réel |
| o | `admin` | `PATCH` sur l'affaire **archivée** `…0000c8` | `200` — l'archivage ne ferme pas l'écriture |

### 15 bis.9 Interface, accessibilité et états

**L'en-tête bascule entre lecture et édition ; il ne porte pas six contrôles en permanence.** Le
motif est celui du §15.2 : l'en-tête dit **ce qu'est** l'affaire, là où le formulaire dit ce qu'on en
sait. Six contrôles permanents en feraient un second formulaire au-dessus du formulaire, et la fiche
ouvrirait sur deux formulaires empilés.

La bascule résout en outre un problème que l'édition en place ne résout pas : **une donnée absente
n'a pas de ligne** (§15.4). Le montant d'une affaire qui n'en a pas, la prochaine action d'une
affaire qui n'en a pas, ne sont rendus **nulle part** — et sans mode d'édition, il n'existerait aucun
endroit où les saisir. En édition, les six contrôles sont **tous** rendus, vides compris. C'est la
quatrième destination du §4 ter.4 du composeur, transposée : un champ que la lecture omet reste
saisissable.

Le geste porte donc :

- une commande **« Modifier »** dans l'en-tête, secondaire compacte, icône `PencilLine` — celle de la
  famille « Champs » du fil (§5.11), puisque c'est le même genre de fait ;
- en édition, **aucun bouton d'enregistrement** : chaque champ écrit sa propre valeur (§5.7 ter), et
  une commande **« Terminer »** revient à la lecture sans rien envoyer ;
- **le focus entre dans le premier contrôle** à l'ouverture et **revient à la commande** à la
  fermeture — la règle du §5.13, dont le §5.10 a déjà mesuré les deux défauts qu'elle évite.

Accessibilité, en plus du §15.6 qui reste entier :

| Exigence | Ce qui la rend vérifiable |
|---|---|
| Chaque contrôle porte un libellé **visible** | `label` / `for`, jamais un `placeholder` seul (§5.7) |
| L'envoi et la confirmation sont annoncés | un `role="status"` par champ, cité par son `aria-describedby` |
| Le refus est annoncé et lié | un `role="alert"` par champ, cité par le même `aria-describedby` |
| Le champ refusé est signalé | `aria-invalid="true"` sur le contrôle |
| Le mode courant est annoncé | `aria-expanded` sur la commande « Modifier » |

Les états sont ceux du §4 bis.6, repris sans changement : `inactif`, `envoi`, `enregistre`, `refus` —
le contrôle **n'est jamais désactivé** pendant l'envoi (un contrôle désactivé perd le focus, §5.13),
et **un refus n'efface pas la saisie**.

Aucun texte visible n'est écrit en dur : les clés vivent sous `card.header.edit.*` dans
`webapp/src/i18n/fr.ts`.

### 15 bis.10 Ce que cette tranche ne livre pas

1. **Aucune création d'affaire**, aucun archivage, aucun changement d'étape : trois gestes distincts,
   deux d'entre eux fermés par privilège (§15 bis.1).
2. **Aucun événement de fil pour cinq des six écritures.** MESURÉ (§15 bis.6) : seul `owner_id`
   engendre un `assigned`. Modifier un montant ou une échéance ne laisse aucune trace dans la
   timeline. L'écart est nommé, non comblé : le combler suppose un trigger, donc une migration, donc
   `CRM-044`.
3. **Aucune écriture de `description`, `probability_override`, `position` ni `snoozed_until`**, bien
   que la base les ouvre : aucune n'atteint l'en-tête en lecture (§15 bis.1).
4. **Aucune reprise hors ligne, aucun brouillon** : une saisie non enregistrée est perdue si l'onglet
   se ferme, comme au §4 bis.11.

### 15 bis.11 Preuves attendues de cette tranche

| Niveau | Preuves |
|---|---|
| pgTAP | **Aucune suite dédiée** : la tranche ne livre ni table, ni fonction, ni politique. Les colonnes qu'elle écrit et leurs privilèges sont déjà couverts par `supabase/tests/0012_cards.test.sql` et `supabase/tests/0015_colonnes_protegees.test.sql` |
| Unitaire | La normalisation des six saisies, le classement des sept issues du §15 bis.7 — **y compris `200` et zéro ligne** —, et le composant réel en lecture et en édition |
| API | Les quinze lignes du §15 bis.8 rejouées avec les jetons réels des trois profils seedés, chaque refus **relisant la ligne** pour la constater inchangée |
| E2E d'interface | Contre le **build de production**, sur une session réelle : ouvrir l'édition, corriger le titre, renseigner un montant sur une affaire qui n'en a pas, changer le responsable et **constater l'événement `assigned` dans le fil**, et le refus mesuré du `viewer` |
| Visuel | Captures observées aux paliers du §7 du design system, en lecture et en édition |

## 16. Mise en sommeil d'une affaire — `CRM-081`

Écrit **après mesure** sur la pile réellement exécutée le 2026-08-16, et non d'après le souvenir de
la colonne. Ce chapitre est le contrat de la **première tranche** de `CRM-081` : la règle, sa garde
et sa trace, toutes trois en base et par l'API. L'écran vient après, et le §16.10 dit ce qu'il devra
porter.

### 16.1 Ce que la tranche livre, et ce qu'elle ne livre pas

Livré :

- **deux gestes**, `public.snooze_card(uuid, timestamptz)` et `public.wake_card(uuid)`, seuls
  chemins par lesquels `cards.snoozed_until` prend et perd sa valeur ;
- la **fermeture en écriture directe** de `cards.snoozed_until` pour `authenticated`, qui devient
  un constat du serveur au sens du §4.4 de `docs/SPEC-permissions-rls.md` ;
- **deux événements de fil**, `snoozed` et `woken`, écrits par un trigger de table et par lui seul,
  comme les douze valeurs déjà livrées (§14.4) ;
- la **définition opposable** de « en sommeil », et le fait qu'aucune tâche planifiée n'est
  nécessaire pour en sortir (§16.2).

Non livré, et nommé plutôt que suggéré :

- **aucun écran** : ni le geste, ni la pastille, ni le filtre du board et de la vue liste. Une card
  en sommeil reste aujourd'hui visible partout où elle l'était (§16.10) ;
- **aucun sommeil de fil de messagerie** : l'énoncé du chunk 5 nomme « les fils et les cards ». Les
  fils vivent dans `mail_messages` (`docs/SPEC-mail-subsystem.md` §17), n'ont aucune colonne pour
  le porter, et une seconde tranche leur est due ;
- **aucun réveil planifié**, et ce n'est pas un manque : le §16.2 rend la question sans objet ;
- **aucun seed** : les 41 cards du seed portent `snoozed_until` nulle — MESURÉ. Poser une affaire
  en sommeil dans les données de démonstration n'a d'intérêt que le jour où un écran le montre,
  et ce sera la tranche 2 (`CLAUDE.md` §8).

### 16.2 Ce que « en sommeil » signifie, et pourquoi aucun réveil planifié n'est écrit

Une card est **en sommeil** si `snoozed_until` est non nulle **et** strictement postérieure à
`now()`. La sortie du sommeil est donc **implicite** : le temps passe, le prédicat devient faux, et
la card redevient ordinaire sans qu'aucune écriture n'ait eu lieu.

C'est la raison pour laquelle aucune tâche `pg_cron` n'est ajoutée (`CRM-017`). Une tâche qui
remettrait la colonne à `NULL` à l'échéance produirait exactement le même prédicat, au prix d'une
écriture par card, d'un événement de fil que personne n'a demandé et d'une fenêtre pendant laquelle
la base dirait « en sommeil » pour une échéance dépassée.

Conséquence à connaître : `snoozed_until` **conserve une date passée**. Elle dit « cette affaire a
été mise en sommeil jusqu'au … », ce qui est une information, et non un état résiduel à nettoyer.
`wake_card` la remet à `NULL` ; le temps, lui, ne l'efface pas.

### 16.3 Le geste `snooze_card`, et les refus dans l'ordre où la garde les oppose

```
public.snooze_card(card_id uuid, until timestamptz) returns public.cards
```

`security definer`, `search_path` vidé, propriétaire `postgres` — mêmes raisons qu'au §5 de
`docs/SPEC-workflow-engine.md` pour `move_card` : la colonne est fermée en écriture, donc la
fonction doit détenir un privilège que l'appelant n'a pas, et elle vérifie elle-même le droit.

| Ordre | Refus | Code | HTTP | Motif |
|---|---|---|---|---|
| 1 | `card_not_found` | `P0001` | `400` | La card n'existe pas, n'est pas **active** (§5), ou son channel n'est pas lisible de l'appelant. Une card invisible est **absente**, jamais « interdite » : répondre « interdit » confirmerait son existence (règle de discrétion du §4.3 de `docs/SPEC-permissions-rls.md`) |
| 2 | `forbidden` | `42501` | `403` | L'appelant lit le channel mais n'y écrit pas — `app.can_write_channel`. C'est la **preuve de refus n° 1** du §7 de `docs/SPEC-permissions-rls.md`, exercée par un geste de plus |
| 3 | `snooze_date_required` | `P0001` | `400` | `until` est `NULL`. Une mise en sommeil sans échéance serait un archivage, geste qui existe déjà et qui n'est pas celui-ci |
| 4 | `snooze_date_in_past` | `P0001` | `400` | `until <= now()`. Le prédicat du §16.2 rendrait la card **immédiatement** hors sommeil : l'écriture serait acceptée et sans effet observable, ce que `CLAUDE.md` §18 proscrit sous le nom de succès simulé |

L'ordre est celui de la garde et il est opposable : une card archivée d'un channel qu'on ne lit pas
rend `card_not_found`, jamais `forbidden`.

Une card **déjà en sommeil** est acceptée : la nouvelle échéance remplace l'ancienne, et le fil en
porte un second `snoozed`. Reporter une échéance est un geste ordinaire, non une erreur.

La fonction rend **la ligne mise à jour**, type composite `public.cards`, comme `move_card` — la
garde n° 1 ayant réussi, l'appelant a le droit de la lire.

### 16.4 Le geste `wake_card`, et son idempotence assumée

```
public.wake_card(card_id uuid) returns public.cards
```

Mêmes gardes n° 1 et n° 2, dans le même ordre, et aucun refus propre. Sur une card dont
`snoozed_until` est déjà `NULL`, la fonction **ne fait rien** : elle ne refuse pas, et elle
n'engendre **aucun** événement de fil. Un réveil sans sommeil n'est pas une erreur du demandeur ;
c'est un état déjà atteint.

Cette idempotence est une décision, pas un effet de bord : deux onglets ouverts sur la même affaire
ne doivent pas produire deux traces pour un seul réveil.

### 16.5 La trace est écrite par un trigger, jamais par la fonction

`public.card_events` n'accorde **aucun** privilège d'écriture, `service_role` compris (§14). La
trace ne peut donc pas être écrite par `snooze_card` : elle l'est par un trigger
`AFTER UPDATE OF snoozed_until` sur `public.cards`, qui appelle `app.card_event_ecrire` comme les
cinq triggers de `CRM-044`.

Placer la trace sur la **table** et non dans la fonction a une conséquence voulue : une écriture de
`snoozed_until` par la clé de service — le seed, un correctif d'exploitation — laisse elle aussi sa
trace. C'est le même choix qu'au §14 pour `owner_id`, et il est ce qui rend le fil complet.

| Transition de `snoozed_until` | Événement | `payload` |
|---|---|---|
| `NULL` → date, ou date → autre date | `snoozed` | `{"until": "<nouvelle échéance>"}` |
| date → `NULL` | `woken` | `{"from": "<échéance abandonnée>"}` |
| valeur inchangée | **aucun** | — |

Le vocabulaire de `card_events.type` passe de douze à **quatorze** valeurs. La contrainte est
**convergée** et non recréée : cette migration devient la dernière autorité sur
`card_events_type_check`, comme la migration 30 l'était (INC-074).

Le `payload` ne porte **aucun libellé** — ni titre de card, ni nom d'utilisateur —, règle du §14.6
inchangée.

### 16.6 Qui peut mettre en sommeil

Le droit d'écriture sur le channel, et rien d'autre : `app.can_write_channel`. Aucun droit propre au
responsable de l'affaire n'est inventé — le §2.2 de `docs/SPEC-permissions-rls.md` ne connaît pas
cette notion, et l'introduire ici la rendrait incohérente avec les six gestes déjà livrés.

Un administrateur du workspace n'est jamais restreint (règle 2 du §2.2). Un `viewer` est refusé par
la garde n° 2, et c'est mesuré par la preuve d'API.

### 16.7 La colonne se ferme, et une assertion figée doit être retournée

MESURÉ le 2026-08-16 : `has_column_privilege('authenticated','public.cards','snoozed_until','update')`
rend `t`. La colonne fait partie des **douze** ouvertes par la migration 14, et
`supabase/tests/0015_colonnes_protegees.test.sql` l'énumère nommément — « `snoozed_until` reste
ouverte ».

Cette assertion devient fausse par **arbitrage**, non par régression : la valeur cesse d'être une
saisie libre pour devenir le constat d'un geste gardé. Elle est donc **retournée avec son motif
écrit dans le fichier**, jamais retirée — mécanisme de la décision 51, appliqué ici pour ce qu'il
est : une preuve périmée par une règle nouvelle (`CLAUDE.md` §18, `docs/CloudWorker.md` §3.1).

Les onze autres colonnes ouvertes restent ouvertes, et la suite continue de les énumérer une à une.

### 16.8 Contrat d'API, mesuré

| # | Appel | Profil | Attendu |
|---|---|---|---|
| 1 | `POST /rest/v1/rpc/snooze_card` sur une affaire active de son channel, échéance future | administratrice | `200`, objet JSON unique, `snoozed_until` égale à l'échéance |
| 2 | idem, échéance passée | administratrice | `400`, `snooze_date_in_past` |
| 3 | idem, `until` absent | administratrice | `400`, `snooze_date_required` |
| 4 | idem sur une card d'un channel qu'elle ne lit pas | lectrice | `400`, `card_not_found` |
| 5 | idem sur une card qu'elle lit sans y écrire | lectrice | `403`, `forbidden` |
| 6 | `PATCH /rest/v1/cards?id=eq.…` avec `snoozed_until` | administratrice | `403`, privilège refusé — la colonne est fermée |
| 7 | `POST /rest/v1/rpc/wake_card` sur la card mise en sommeil | administratrice | `200`, `snoozed_until` nulle |
| 8 | `POST /rest/v1/rpc/wake_card` sur une card qui ne dort pas | administratrice | `200`, aucun événement `woken` de plus |
| 9 | Le fil de la card après les gestes | administratrice | un `snoozed` puis un `woken`, dans cet ordre, `payload` portant l'échéance |

### 16.9 Preuves exigées de cette tranche

| Niveau | Preuves |
|---|---|
| pgTAP | Suite dédiée : la forme des deux fonctions, leur `security definer` et leur propriétaire, les quatre refus de `snooze_card`, l'idempotence de `wake_card`, le vocabulaire à quatorze valeurs, le trigger et ses deux événements, la fermeture de la colonne et l'ouverture **inchangée** des onze autres |
| API | Les neuf lignes du §16.8 rejouées avec les jetons réels des profils seedés, chaque refus **relisant la ligne** pour la constater inchangée |
| E2E d'interface | **Aucune** : la tranche ne livre aucune surface. Elle est due par la tranche 2, avec ses captures |
| Visuel | **Aucune vérification visuelle**, pour la même raison |

### 16.10 Ce que la tranche 2 devra porter

- le geste dans l’en-tête de la fiche et dans le menu de la card, avec ses échéances usuelles ;
- une **pastille** disant qu'une affaire dort et jusqu'à quand ;
- le **filtre** du board et de la vue liste : une affaire en sommeil sort des vues par défaut et
  reste atteignable par un filtre explicite — sans quoi la mettre en sommeil ne change rien pour
  l'utilisateur ;
- les deux événements dans la timeline, avec leur libellé ;
- le seed, qui devra poser au moins une affaire en sommeil et une affaire dont le sommeil est
  échu, faute de quoi l'écran ne serait démontrable ni dans un état, ni dans l'autre ;
- le sommeil des **fils** de messagerie, qui n'a aujourd'hui aucune colonne pour le porter.

### 16.11 Tranche 2 a — le sommeil se voit et se pilote depuis la fiche

Le §16.10 énumère six choses. Elles ne tiennent pas dans une seule tranche, et les livrer à moitié
chacune ne donnerait aucun état démontrable. Ce sous-chapitre est le contrat de la **tranche 2 a**,
écrit avant sa première ligne de code : le geste, sa pastille, ses deux libellés de fil et son seed.
Le filtre du board et de la vue liste est la **tranche 2 b** (§16.12) ; le sommeil des fils de
messagerie la **tranche 2 c**.

#### Ce que la tranche livre

- la lecture de `cards.snoozed_until` par la fiche d'affaire, colonne qu'aucun écran ne demandait ;
- une **pastille** à côté du titre, « En sommeil jusqu'au … », lorsque l'affaire dort ;
- un **geste** dans l'en-tête : mettre en sommeil, avec quatre échéances usuelles et une échéance
  choisie, puis réveiller ;
- les deux événements `snoozed` et `woken` **nommés dans la timeline**, avec leur détail ;
- le **seed** : une affaire en sommeil et une affaire dont le sommeil est échu.

#### Ce qu'elle ne livre pas, et qui est nommé plutôt que suggéré

- **aucun filtre** : une affaire en sommeil reste visible dans le board et dans la vue liste. La
  DoD de `CRM-081` n'est donc pas tenue par cette tranche, et l'unité reste `[~]` ;
- **aucun geste dans le menu de la carte du board** : la fiche est le seul chemin ;
- **aucun sommeil de fil de messagerie**.

#### 16.11.1 « En sommeil » se calcule à la lecture, jamais à l'écriture

Le prédicat est celui du §16.2, transposé sans changement : `snoozed_until` non nulle **et**
strictement postérieure à l'instant de rendu. Une échéance **passée** n'est donc pas un sommeil,
et l'écran ne la montre pas — la colonne conserve sa valeur (§16.2), mais elle ne dit plus que
l'affaire dort.

Conséquence assumée : la pastille disparaît **sans rechargement** seulement au prochain rendu. Le
produit n'installe aucune minuterie pour la faire disparaître à la seconde près ; une échéance de
sommeil se compte en jours, et un `setInterval` sur l'écran le plus ouvert du produit coûterait
plus que la précision qu'il achète.

L'instant de comparaison est **injectable**, faute de quoi aucune preuve ne pourrait éprouver les
deux côtés du prédicat sans dépendre de l'heure de son exécution.

#### 16.11.2 La pastille

Elle vit à côté du titre, comme la pilule « Archivé » du §5.3 bis, et les deux coexistent : une
affaire peut être archivée **et** endormie, et masquer l'une derrière l'autre perdrait un fait.

Elle porte l'échéance en **date courte**, au même format que celle de la prochaine action (§15.4) :
deux dates du même produit ne se lisent pas dans deux formats. Une valeur que `Date` ne sait pas
lire fait disparaître la pastille plutôt que d'écrire « Invalid Date » — même règle qu'au §15.4.

#### 16.11.3 Le geste, et les quatre échéances usuelles

La commande est rendue dans l'en-tête, à côté de « Modifier ». Elle a **deux visages**, et un seul
est rendu à la fois :

| État de l'affaire | Commande | Ce qu'elle fait |
|---|---|---|
| Éveillée | « Mettre en sommeil » | ouvre le panneau des échéances |
| Endormie | « Réveiller » | appelle `wake_card` **directement**, sans panneau |

Le panneau porte quatre échéances usuelles et une échéance choisie :

| Libellé | Échéance émise |
|---|---|
| Demain | `now` + 1 jour |
| Dans trois jours | `now` + 3 jours |
| La semaine prochaine | `now` + 7 jours |
| Le mois prochain | `now` + 30 jours |
| *(champ)* | l'instant saisi, converti en ISO 8601 |

Les quatre usuelles sont **des jours ajoutés à l'instant courant**, jamais des dates calées sur un
début de journée : « demain à la même heure » est une promesse que le produit tient, là où
« demain à 9 h » inventerait une heure de bureau que personne n'a spécifiée.

« Le mois prochain » vaut trente jours et non « le même quantième du mois suivant » : le second
n'existe pas pour le 31 janvier, et la règle de repli serait une décision de produit que personne
n'a prise.

**Aucune garde de saisie ne double la base** (§5.3 ter) : une échéance passée est **envoyée**, et
c'est `snooze_date_in_past` qui la refuse. Le champ n'a ni `min`, ni `required`.

#### 16.11.4 Les issues du geste, dictionnaire fermé

Classées sur le **code HTTP et le message** que le §16.3 oppose, jamais sur un texte de serveur
libre.

| Issue | Origine | Ce que l'écran dit |
|---|---|---|
| `endormie` | `200` sur `snooze_card` | l'échéance, dans la pastille |
| `reveillee` | `200` sur `wake_card` | la pastille disparaît |
| `echeance-requise` | `400`, `snooze_date_required` | « Une échéance est nécessaire. » |
| `echeance-passee` | `400`, `snooze_date_in_past` | « L'échéance doit être future. » |
| `introuvable` | `400`, `card_not_found` | « Cette affaire n'est plus disponible. » |
| `refus` | `403`, `forbidden` | « Vous ne pouvez pas modifier cette affaire. » |
| `reseau` | aucune réponse | « La demande n'a pas abouti. » |
| `inconnu` | tout le reste | l'écran ne prétend pas savoir |

La commande **n'est jamais éteinte d'avance**, quel que soit le rôle (§5.3 ter) : la règle vit dans
`app.can_write_channel`, et un bouton grisé ferait passer une décision de la base pour une décision
d'écran (`CLAUDE.md` §10). Un lecteur seul l'ouvre, appuie, et lit le refus.

**La ligne rendue par la fonction est la source de la mise à jour**, jamais la saisie : `snooze_card`
rend le type composite `public.cards` (§16.3), et l'écran met `snoozed_until` à jour en place à
partir de ce que le serveur a rendu.

#### 16.11.5 Les deux événements dans la timeline

`snoozed` et `woken` rejoignent les onze types que l'écran connaît, et le vocabulaire de
`webapp/src/lib/timeline.ts` passe de onze à **treize** — `mail_sent`, quatorzième valeur du `CHECK`
depuis la migration 44, n'est écrit par aucun trigger et reste hors de cette tranche.

Ils appartiennent à la famille **`cycle`** : « qu'est devenue cette affaire ? » est exactement la
question qu'ils répondent, et une sixième bascule pour deux types contredirait le §5.11.

Leur **détail** est l'échéance, lue dans le `payload` — `until` pour `snoozed`, `from` pour `woken`
— et rendue en date courte. C'est le seul cas où le fil lit une valeur du `payload` plutôt qu'un
libellé résolu, et l'écart est motivé : une **date** n'est pas un libellé qui pourrait changer de
sens (§14.6) ; c'est la valeur même du fait. Une date illisible rend un détail absent, jamais une
phrase tronquée (§14.10).

#### 16.11.6 Le seed

Deux affaires du seed portent désormais un `snoozed_until`, écrit par la clé de service — donc
tracé par le trigger du §16.5, ce qui est la démonstration même de ce que ce trigger promet :

| Affaire | `snoozed_until` | Ce qu'elle démontre |
|---|---|---|
| une affaire active de `prospection` | `now() + 10 jours` | la pastille, et le geste « Réveiller » |
| une autre affaire active | `now() - 2 jours` | une échéance **échue** : aucune pastille, la colonne conserve pourtant sa valeur (§16.2) |

Les deux échéances sont **relatives à l'instant du seed**, jamais des dates fixes : une date fixe
cesserait d'être future au bout de quelques semaines, et la première affaire cesserait de démontrer
quoi que ce soit.

#### 16.11.7 Preuves exigées de la tranche

| Niveau | Preuves |
|---|---|
| Unitaire | Le prédicat des deux côtés de l'échéance avec un instant injecté, les quatre échéances usuelles, la conversion de la saisie, le classement des huit issues, le détail des deux événements et leur famille |
| E2E d'interface | La fiche d'une affaire endormie du seed porte sa pastille ; le geste de réveil la fait disparaître et le fil porte `woken` ; la mise en sommeil par une échéance usuelle la fait apparaître ; une échéance passée saisie est **refusée par la base** et l'écran le dit |
| Visuel | Captures de la fiche endormie, du panneau ouvert et du refus d'échéance passée, observées conformément à `CLAUDE.md` §16 |

#### 16.12 Tranche 2 b — le filtre du board et de la vue liste

Écrit **après mesure** sur la pile réellement exécutée le 2026-08-16, et committé avant la première
ligne de code de la tranche. Ce sous-chapitre porte ce que le §16.10 nomme au troisième point, et
qui est le dernier écart de la Definition of Done de `CRM-081` : **une affaire en sommeil sort des
vues par défaut et reste atteignable par un filtre explicite**. Sans lui, mettre une affaire en
sommeil ne change rien pour l'utilisateur — la tranche 2 a le disait déjà de sa propre limite.

##### Ce que la tranche livre

- les deux vues d'un channel — le **board** et la **vue liste** — **masquent par défaut** les
  affaires en sommeil ;
- une **bascule explicite**, portée par l'adresse, les ramène dans les deux vues ;
- une **pastille compacte** marque une affaire endormie rendue visible, sans quoi « afficher »
  reviendrait à noyer ;
- les **états vides** cessent de mentir quand tout ce qui reste dort.

##### Ce qu'elle ne livre pas, et qui est nommé plutôt que suggéré

- **aucun geste dans le menu de la carte du board** : la fiche reste le seul chemin pour endormir
  ou réveiller (écart hérité de la tranche 2 a, inchangé) ;
- **aucun sommeil de fil de messagerie** : tranche 2 c ;
- **aucun mode « seules les affaires en sommeil »** : la Definition of Done demande qu'elles soient
  *atteignables*, pas qu'elles aient leur propre écran. Un troisième état serait un périmètre
  inventé (`CLAUDE.md` §1). MESURÉ pourtant, pour le jour où il serait demandé :
  `snoozed_until=gt.<instant>` rend la seule endormie de `prospection`.

##### 16.12.1 Le prédicat est celui du §16.2, et il ne change pas de définition en route

« En sommeil » vaut « `snoozed_until` non nulle **et** strictement postérieure à l'instant ». Le
filtre des vues masque donc exactement ces lignes, et son complément — ce que les vues montrent par
défaut — est la négation stricte :

```
snoozed_until IS NULL  OU  snoozed_until <= instant
```

**Une échéance échue n'est pas un sommeil** (§16.11.1) : une affaire dont l'échéance est passée
reste visible partout, sans bascule et sans pastille. MESURÉ le 2026-08-16 sur le seed, avec la clé
de service, `channel_id=eq.…032` (`grands-comptes`) :

| Requête | Lignes | `Content-Range` |
|---|---|---|
| actives, sans filtre de sommeil | 4 | `0-3/4` |
| actives, `or=(snoozed_until.is.null,snoozed_until.lte.<instant>)` | 4, dont `Refonte du site vitrine` (échéance `-2 j`) | `0-3/4` |

et sur `channel_id=eq.…031` (`prospection`), qui porte l'affaire réellement endormie :

| Requête | Lignes | `Content-Range` |
|---|---|---|
| actives, sans filtre de sommeil | 2, dont `Cadrage data — Groupe Vallier` (échéance `+10 j`) | `0-1/2` |
| actives, avec le filtre | 1 | `0-0/1` |

Le total suit le filtre, et c'est la propriété que la vue liste exige (§12.5).

##### 16.12.2 L'instant de comparaison est celui du client, et il est envoyé au serveur

PostgREST n'évalue aucune fonction dans un filtre de requête : `snoozed_until=lte.now()` compare à
la chaîne « now() », pas à l'heure du serveur. Deux chemins existaient, et le second est écarté avec
son motif :

1. **l'instant du client, envoyé comme valeur** — un `toISOString()`, MESURÉ accepté par PostgREST
   avec ses millisecondes (`2026-08-16T17:23:59.000Z`) comme sans elles ;
2. une **vue SQL ou un RPC** qui appliquerait `now()` côté serveur — écarté : il faudrait une
   migration, une politique de lecture propre et un second chemin de lecture pour les cards, pour
   une règle qui **n'est pas une règle d'accès**.

Ce point est le seul de la tranche qui mérite d'être défendu, et il l'est ainsi : **le sommeil range,
il n'autorise pas**. La RLS décide de ce qu'un appelant a le droit de lire (`CLAUDE.md` §10) ; le
sommeil décide seulement de ce qui encombre sa vue. Un appelant qui fausserait l'instant envoyé ne
verrait rien qu'il n'ait déjà le droit de voir — il retrouverait ses propres affaires endormies,
exactement ce que la bascule lui offre d'un clic. Aucun contrôle d'autorisation n'est donc déplacé
côté client, et le §10 de `CLAUDE.md` reste tenu.

Conséquence assumée : une horloge de poste décalée décale la frontière du sommeil d'autant. Une
échéance de sommeil se compte en jours (§16.11.1) ; quelques minutes d'écart ne changent aucun
verdict observable.

##### 16.12.3 Le board filtre à la composition, la liste filtre au serveur — et ce n'est pas une inconséquence

| Vue | Où le filtre s'applique | Motif |
|---|---|---|
| **Vue liste** | dans la **requête**, avant `Range` | elle pagine et elle compte. Un filtre appliqué après la pagination ne verrait que les 25 lignes rapportées, et le total afficherait un nombre de pages qui n'existe pas — c'est mot pour mot la règle du §12.5 |
| **Board** | dans le **module de composition**, sur les cards déjà lues | il ne pagine pas : il lit déjà **toutes** les cards actives du channel en une requête (§7.2 de `docs/SPEC-workflow-engine.md`). Filtrer au serveur y coûterait une requête de plus à chaque bascule et ferait **perdre le nombre d'affaires masquées**, dont l'état vide du §16.12.6 a besoin |

L'argument qui impose le serveur pour `archived_at` et `deleted_at` — « ne pas faire diverger
l'écran de la garde » — **ne se transporte pas ici** : « active » est la première vérification de
`move_card`, tandis que le sommeil n'est la garde de rien. Une card endormie se déplace, s'édite et
se commente exactement comme une autre.

Les deux chemins emploient la **même** fonction `estEnSommeil` et le **même** instant injectable
(§16.11.1) : le board l'appelle, la vue liste en écrit la négation dans sa requête. Une seule
définition, deux traductions, et la preuve unitaire les tient toutes deux.

##### 16.12.4 La bascule vit dans l'adresse, et elle se propage d'une vue à l'autre

Un cinquième paramètre rejoint les quatre du §12.2, avec la même clôture — toute valeur inconnue se
replie sur le défaut, et le défaut n'est jamais écrit dans l'adresse :

| Clé | Valeurs | Défaut |
|---|---|---|
| `sommeil` | `visibles` | absent, c'est-à-dire **masquées** |

**Le défaut est « masquées », et c'est la Definition of Done elle-même** : « sort des vues par
défaut ». Une adresse nue ouvre donc un board et une liste sans les affaires endormies.

**Le paramètre est le même pour les deux vues, et la bascule board ↔ liste le conserve** — elle
seule, jamais le tri, la recherche, l'étape ni la page : ceux-là n'ont aucun sens sur un board, et
les traîner écrirait dans l'adresse d'une vue des paramètres que l'autre ignore. Un utilisateur qui
a demandé à voir les affaires endormies ne redemande pas à chaque changement de vue.

##### 16.12.5 « Effacer les filtres » efface celui-ci aussi

L'action de la vue liste ramène l'adresse à son état nu : étape, recherche **et** sommeil reprennent
leur défaut. Elle apparaît dès que **l'un** des trois s'en écarte — donc, désormais, sur une liste
dont la seule différence est que les affaires endormies y sont visibles.

C'est la lecture la plus prévisible : « effacer les filtres » rend la vue par défaut, et la vue par
défaut ne montre pas les affaires en sommeil.

##### 16.12.6 Les états vides cessent de mentir

**Le défaut masque, donc un écran vide n'est plus la preuve d'un channel vide.** MESURÉ sur le seed :
`prospection` porte deux affaires actives dont une dort ; un channel dont toutes les affaires
dormiraient afficherait aujourd'hui « Aucune affaire dans ce channel », ce qui serait **faux**.

| Vue | Situation | Ce que l'écran dit |
|---|---|---|
| Liste | total nul, mode **masquées**, aucun autre filtre | « Aucune affaire éveillée dans ce channel », et l'action **« Afficher les affaires en sommeil »** |
| Liste | total nul, mode **visibles**, aucun autre filtre | l'état vide existant, inchangé : il n'y a réellement aucune affaire |
| Liste | total nul, un autre filtre posé | l'état vide filtré existant, inchangé |
| Board | aucune carte rendue, **et** au moins une affaire masquée | « Toutes les affaires de ce channel sont en sommeil », et la même action |
| Board | aucune carte rendue, aucune masquée | l'état vide existant, inchangé |

**Aucune requête supplémentaire n'est émise pour cela**, et c'est ce qui rend la règle acceptable :
le board connaît le nombre de masquées puisqu'il les a lues (§16.12.3), et la liste ne prétend rien
savoir de plus que ce qu'elle a — « aucune affaire **éveillée** » est vrai dans les deux cas, qu'il
en dorme ou non. Un second comptage à chaque page pour distinguer les deux cas serait une requête
payée sur tous les chargements pour un cas de bord.

##### 16.12.7 Une affaire endormie rendue visible est MARQUÉE

Sans marque, la bascule ne ferait que noyer l'affaire endormie parmi les autres.

- **Board** : la carte porte la pastille compacte sous son titre, à côté de la pastille
  d'ancienneté ;
- **Vue liste** : la cellule « Affaire » porte la même pastille après le lien, `shrink-0`, le titre
  gardant son ellipse et la ligne sa hauteur d'une seule ligne de texte (§12.7).

La pastille est celle du §5.3 quater du design system, en **version compacte** : icône `Moon` et
échéance en **date courte**, sans le mot « En sommeil » que la place ne permet pas — le nom
accessible, lui, porte la phrase entière. Ses règles visuelles vivent au §5.3 quinquies du design
system, écrit dans le même changement.

Une échéance que `Date` ne sait pas lire fait disparaître la pastille plutôt que d'écrire
« Invalid Date » — même règle qu'au §16.11.2, et une affaire dont l'échéance est illisible n'est de
toute façon pas en sommeil au sens du prédicat.

##### 16.12.8 Ce que le compte de colonne et le cumul deviennent

Le compteur d'une colonne de board et son cumul de montants portent sur les cartes **rendues** :
une affaire masquée n'y entre pas. Une colonne annonce ce qu'elle montre, sinon son compteur
désignerait des cartes introuvables à l'œil.

De même, le total de la vue liste est celui des lignes filtrées (§12.5, inchangé) : il varie donc
avec la bascule, et c'est la propriété attendue.

##### 16.12.9 Preuves exigées de la tranche

| Niveau | Preuves |
|---|---|
| Unitaire | Le repli et la clôture du paramètre `sommeil` dans les deux sens (lecture d'adresse, écriture, omission du défaut) ; le filtre de la requête de page dans les deux modes ; la composition du board dans les deux modes, avec le compte des masquées ; les deux côtés de l'échéance avec un instant injecté ; la conservation du paramètre par la bascule de vue |
| API | Les deux modes rejoués **avec les jetons réels** sur les deux channels du seed : `prospection` rend 1 ligne sur 2 en mode masqué et 2 sur 2 en mode visible ; `grands-comptes` rend ses 4 lignes dans les deux modes, l'échéance échue n'étant pas un sommeil. Le total du `Content-Range` est constaté à chaque fois |
| E2E d'interface | Le board de `prospection` ne montre pas l'affaire endormie du seed ; la bascule la ramène **avec sa pastille** ; la vue liste du même channel fait de même et son total passe de 1 à 2 ; l'affaire à l'échéance échue de `grands-comptes` est présente dans les deux modes et **sans** pastille ; le paramètre survit au passage board → liste |
| Visuel | Captures des deux modes, board et vue liste, plus la pastille compacte au palier étroit, observées conformément à `CLAUDE.md` §16 |

#### 16.13 Tranche 2 d — le geste de sommeil depuis la carte du board

Écrit **après mesure** sur la pile réellement exécutée le 2026-08-17, et committé avant la première
ligne de code de la tranche. Ce sous-chapitre porte le premier point du §16.10 — « le geste dans
l'en-tête de la fiche **et dans le menu de la card** » —, dont la moitié est due depuis la
tranche 2 a : les trois tranches livrées jusqu'ici laissent la **fiche comme seul chemin** pour
endormir ou réveiller une affaire.

##### Ce que la tranche livre

- le geste des deux visages — « Mettre en sommeil », « Réveiller » — **dans le menu de la carte du
  board**, avec les quatre échéances usuelles du §16.11.3 ;
- un menu de carte qui **cesse d'être éteint** lorsque l'étape ne déclare aucune transition ;
- la disparition de la carte du board par défaut dès que le sommeil est écrit, et sa réapparition
  au réveil, **sans rechargement** ;
- le refus dit sur la carte, avec les mêmes mentions qu'à la fiche.

##### Ce qu'elle ne livre pas, et qui est nommé plutôt que suggéré

- **aucune échéance choisie depuis le board** : le champ `datetime-local`, son étiquette et son
  bouton d'envoi occupent trois lignes d'une carte large de **288 px** (§5.2 bis), soit davantage
  que la carte entière n'en porte aujourd'hui. Le geste du board sert les quatre échéances
  usuelles ; une échéance particulière se pose depuis la fiche, à un clic du titre de la carte.
  L'écart est écrit ici plutôt que découvert à l'usage ;
- **aucun sommeil de fil de messagerie** : tranche 2 c, inchangée ;
- **aucun geste de sommeil dans la vue liste** : le §16.10 nomme la fiche et la carte du board, et
  ajouter une commande par ligne de tableau serait un périmètre inventé (`CLAUDE.md` §1).

##### 16.13.1 LE MENU DE LA CARTE DEVIENT LE MENU DES ACTIONS, ET C'EST UNE MESURE QUI L'IMPOSE

Le menu de la carte ne portait jusqu'ici **que** les transitions déclarées, et il était **éteint**
quand l'étape n'en déclarait aucune — un bouton `disabled` portant « Aucun déplacement déclaré
depuis cette étape ».

MESURÉ le 2026-08-17 sur le seed, en comptant les transitions sortantes de l'étape de chaque
affaire active :

| Channel | Affaire | Étape | Transitions sortantes |
|---|---|---|---|
| `grands-comptes` | `Socle analytique — Vertuo` | `Livré` | **0** |
| `grands-comptes` | `Audit sécurité applicative` | `Prospection` | 2 |
| `grands-comptes` | `Migration ERP Sogexia` | `Relance` | 2 |
| `grands-comptes` | `Refonte du site vitrine` | `Relance` | 2 |
| `prospection` | `Assistant IA support — Nordis` | `Négociation` | 3 |
| `prospection` | `Cadrage data — Groupe Vallier` | `Prospection` | 2 |

Une affaire d'étape terminale existe donc dans le produit, et loger le geste **à l'intérieur** d'un
menu éteint pour elle reviendrait à ne pas le livrer là où il sert le plus : une affaire livrée est
précisément celle qu'on met en sommeil.

La règle change donc, et l'ancienne est retournée avec son motif :

- le déclencheur porte désormais **« Actions »**, et il n'est **jamais éteint d'avance** — une
  carte porte toujours au moins le geste de sommeil ;
- le menu ouvert porte **deux sections nommées** : les transitions déclarées, puis le sommeil ;
- lorsque l'étape ne déclare aucune transition, la section des transitions porte la **phrase**
  « Aucun déplacement déclaré depuis cette étape » **à l'intérieur du menu**, et non plus sur un
  bouton éteint. L'information est conservée, elle change seulement de place.

Le §5.1 du design system, qui écrivait que la carte « expose un menu d'actions listant **uniquement**
les transitions déclarées », est révisé dans le même changement (§5.3 sexies). La garantie qu'il
portait — « l'interface ne propose jamais une action que le backend refuserait » — n'est **pas**
affaiblie : les transitions restent celles que `move_card` accepte, et le sommeil n'est la garde de
rien (§16.12.3) — `snooze_card` est offerte à toute carte visible, et son refus est mesuré, jamais
deviné (§16.13.4).

##### 16.13.2 Les deux visages, et le geste que chacun déclenche

Ce sont ceux du §16.11.3, transposés sans changement de règle :

| État de l'affaire | Ce que la section « Sommeil » porte | Ce que le geste fait |
|---|---|---|
| Éveillée | quatre boutons, un par échéance usuelle | `snooze_card(card_id, échéance)` |
| Endormie | un bouton « Réveiller » | `wake_card(card_id)`, **directement** |

Aucun second niveau de dévoilement n'est ajouté : les quatre échéances sont rendues **dès
l'ouverture du menu**, là où la fiche les cache derrière « Mettre en sommeil ». Le motif est la
place et le nombre de gestes : dans le menu d'une carte, le sommeil est **une** section parmi deux,
et ouvrir un panneau dans un menu déjà ouvert ferait trois niveaux pour un choix de quatre boutons.

Les quatre échéances sont celles de `ECHEANCES_USUELLES` (§16.11.3) — demain, trois jours, la
semaine prochaine, le mois prochain —, comptées **depuis l'instant du geste**, jamais depuis
l'instant du rendu du board : une carte rendue le matin et endormie le soir doit dormir un jour à
partir du soir.

##### 16.13.3 CE QUE LA CARTE DEVIENT APRÈS LE GESTE, ET C'EST LÀ QUE LE PRODUIT SE VOIT

En mode par défaut — les affaires en sommeil sont masquées (§16.12.4) —, une affaire endormie
**depuis le board disparaît du board**, et c'est la propriété qui rend le geste utile : ranger une
affaire sans changer d'écran.

La mécanique n'émet **aucune requête de lecture supplémentaire** :

1. le RPC rend la ligne, et c'est **elle** qui fait foi (§16.11.4) — jamais l'échéance saisie ;
2. la seule colonne reportée sur la card détenue par l'écran est `snoozed_until`. Les deux fonctions
   rendent le type composite `public.cards`, **sans la relation `profiles` embarquée** que la carte
   porte pour son avatar : remplacer la card entière ferait disparaître l'avatar du responsable
   jusqu'au prochain chargement, ce que le §7.9 de `docs/SPEC-workflow-engine.md` a déjà refusé pour
   `move_card` ;
3. la composition du board rejoue son filtre (§16.12.3) et la carte quitte ses colonnes.

Conséquences exigibles, et vérifiables : le **compteur de la colonne** et son **cumul** perdent
l'affaire (§16.12.8) ; si elle était la dernière, l'état vide « Toutes les affaires de ce channel
sont en sommeil » apparaît avec son action (§16.12.6) ; en mode `visibles`, la carte **reste** et
prend sa pastille compacte (§16.12.7).

Le réveil est le chemin inverse, et il n'est observable **que** depuis le mode `visibles` : en mode
masqué, une affaire endormie n'est pas rendue, donc son menu n'existe pas. Ce n'est pas une
limitation à contourner, c'est la conséquence exacte du filtre.

**Aucun optimisme.** La carte ne bouge qu'après la réponse du serveur. Le déplacement, lui, est
optimiste (§7.9) parce qu'il est fréquent et qu'il rend la main au geste suivant ; le sommeil fait
**disparaître** sa carte, et une disparition qu'il faudrait annuler serait bien plus déroutante
qu'une attente de quelques centaines de millisecondes.

##### 16.13.4 Les refus, et ce que la carte en dit

Les huit issues du §16.11.4 sont classées par le **même** module — `classerSommeil` de
`webapp/src/lib/sommeil-card.ts` —, et rendues avec les **mêmes** mentions qu'à la fiche : une
lectrice qui appuie sur « Demain » depuis le board lit « Vous ne pouvez pas modifier cette
affaire. », mot pour mot ce qu'elle lit depuis la fiche.

- la mention est écrite **dans le menu**, sous la section « Sommeil », en `role="alert"` (§5.7) ;
- le menu **reste ouvert** sur un refus : le refermer effacerait le message avant qu'il soit lu ;
- le menu **se referme** sur un succès, la carte disparaissant ou se marquant selon le mode ;
- `snooze_date_required` et `snooze_date_in_past` ne sont pas atteignables depuis le board — les
  quatre échéances usuelles sont toujours futures et jamais nulles — mais leurs mentions restent
  câblées : le dictionnaire est fermé (§16.11.4), et une issue non traitée serait un refus muet.

**La commande n'est jamais éteinte d'avance**, quel que soit le rôle (§5.3 quater) : le board ne
sait pas ce que la RLS consentira, et éteindre un geste par supposition remplacerait un refus mesuré
par une devinette.

Pendant le vol, les quatre échéances et le réveil sont éteints — deux appels concurrents sur la même
carte feraient gagner le plus lent, exactement comme pour `move_card` —, et le libellé du bouton
appuyé passe à « Enregistrement… ».

##### 16.13.5 Ce que le board annonce aux technologies d'assistance

Le board porte déjà une région `aria-live` pour le déplacement et son refus (§7.11). Les deux gestes
du sommeil l'empruntent, et n'en créent pas une seconde :

| Issue | Ce qui est annoncé |
|---|---|
| `endormie` | « Affaire mise en sommeil jusqu'au … », l'échéance en date courte |
| `reveillee` | « Affaire réveillée » |
| toute autre | la mention du refus, la même que celle écrite dans le menu |

Une carte qui disparaît sans un mot est un écran qui ment à celui qui ne le voit pas : c'est la
seule raison pour laquelle ces trois annonces existent.

##### 16.13.6 Preuves exigées de la tranche

| Niveau | Preuves |
|---|---|
| Unitaire | Le report de la seule colonne `snoozed_until` sur la card détenue, l'embed `responsable` conservé, la card étrangère laissée intacte ; le menu **jamais éteint** sans transition et la phrase rendue à l'intérieur ; les deux visages selon l'état de l'affaire ; les quatre échéances envoyées comptées depuis l'instant du geste ; le succès qui referme le menu et le refus qui le laisse ouvert ; les mentions des huit issues ; l'extinction pendant le vol |
| API | Aucune preuve d'API nouvelle n'est due : le contrat des deux RPC est celui du §16.8, déjà éprouvé par `e2e/api/snooze.spec.ts` (9 scénarios) avec les jetons réels. Cette tranche n'ajoute **aucun** chemin serveur, et le prétendre serait une preuve inventée |
| E2E d'interface | Depuis le board de `grands-comptes` : le menu de `Socle analytique — Vertuo`, **étape terminale sans transition**, s'ouvre et porte le geste ; l'affaire endormie depuis la carte **quitte le board**, le compteur de sa colonne décroît, et elle est retrouvée par la bascule **avec sa pastille** ; le réveil depuis le mode `visibles` la ramène en mode masqué ; l'affaire est réveillée en fin de scénario pour que le seed sorte intact |
| Visuel | Captures du menu ouvert sur une affaire éveillée et sur une affaire endormie, du refus rendu à une lectrice, et du board après disparition de la carte, observées conformément à `CLAUDE.md` §16 |

#### 16.14 Tranche 2 c — le sommeil d'un FIL de messagerie : la règle, sa garde et sa trace

Le §16.10 énumère six choses dues par la tranche 2. Cinq sont livrées — le geste et sa pastille
(2 a), le filtre des vues (2 b), le geste depuis la carte du board (2 d). La sixième est celle-ci,
et c'est la seule que l'énoncé de `CRM-081` nomme dans son titre — « snooze des **fils** et des
cards » — sans qu'aucune ligne du produit ne la porte.

Ce sous-chapitre est le contrat de la **tranche 2 c**, écrit avant sa première ligne de code et
fondé sur six mesures relevées le 2026-08-19 sur la pile seedée. Comme la tranche 1 pour l'affaire,
elle livre **la règle, sa garde et sa trace, et aucune surface**.

##### 16.14.1 SIX MESURES, ET DEUX D'ENTRE ELLES ÉCARTENT UNE MOITIÉ DU PATRON DE LA TRANCHE 1

| # | Mesure, le 2026-08-19 | Ce qu'elle décide |
|---|---|---|
| 1 | `public.threads` **n'existe pas**, et `information_schema.columns` ne rend **aucune** colonne dont le nom porte `thread` dans tout le schéma `public` | Le manque du §16.10 est confirmé plutôt que supposé. Il n'y a rien à fermer, rien à réutiliser |
| 2 | Les deux messages du seed portent `references_ids` **vide** ; leur `rfc822_message_id` vaut `<seed-inbox-classe@p2enjoy.test>` et `<seed-inbox-non-classe@p2enjoy.test>` | Un fil d'un seul message est le cas **normal**, non un cas dégradé. La clé doit le couvrir sans détour |
| 3 | `authenticated` détient sur `public.mail_messages` le privilège **`SELECT` et lui seul**, sur les vingt-deux colonnes | **Il n'y a AUCUNE colonne à fermer**, à la différence du §16.7 : le client ne peut déjà rien écrire. La garde ne répare rien, elle ouvre un chemin qui n'existait pas |
| 4 | La politique `mail_messages_lecture` porte pour tout `USING` `((card_id is not null and app.can_read_card(card_id)) or app.boite_du_message_lisible(id))`, expression que `app.peut_voir_message(uuid)` rend déjà telle quelle | La lisibilité d'un fil se dérive de celle de ses messages. Aucun prédicat nouveau n'est inventé |
| 5 | `mail_messages_dedoublonnage` est `unique (workspace_id, rfc822_message_id)` | La clé d'un fil n'est unique **qu'à l'intérieur d'un workspace**. Toute clé primaire l'y porte |
| 6 | Avec les jetons réels des trois profils, la politique rend **2** messages à l'administratrice, **1** au business developer — le seul classé — et **0** à la lectrice | L'asymétrie qui prouve les refus **existe déjà dans le seed**. Aucune donnée nouvelle n'est due pour l'éprouver |

**LA MESURE 3 RETIRE LA MOITIÉ DU PATRON DE LA TRANCHE 1 AVANT QU'ELLE NE SOIT ÉCRITE.** Le §16.7
fermait `cards.snoozed_until`, ouverte en écriture par la migration 14, et ce `revoke` était la
condition pour que les quatre refus du §16.3 gardent quoi que ce soit. Ici il n'y a rien à
reprendre : le client n'a jamais rien pu écrire sur `mail_messages`. La symétrie serait donc
trompeuse, et le contrat ci-dessous ne porte **aucune** section « la colonne se ferme ».

##### 16.14.2 CE QU'EST UN FIL, ET POURQUOI CE N'EST PAS UNE TABLE

Un **fil** est l'ensemble des messages d'un workspace qui partagent la même **racine RFC 5322**.
Cette racine est :

```
app.cle_fil(references_ids, rfc822_message_id) = coalesce(references_ids[1], rfc822_message_id)
```

Le premier élément de `References` est, par la RFC, le message qui a ouvert la chaîne ; un message
qui n'en cite aucun **est** cette racine. La mesure 2 rend les deux cas dans le seed, et le second
est le cas courant.

**Aucune table `threads`, et aucune colonne ajoutée à `mail_messages`.** Deux réponses ont été
pesées :

- une **colonne générée** `thread_key` sur `mail_messages` : elle rendrait la clé indexable et
  lisible du client, mais elle déplace la liste des colonnes de la table, que plusieurs preuves du
  dépôt figent — privilèges énumérés colonne par colonne, comptes de colonnes, types engendrés. Le
  coût est réel et il ne sert **aucune** règle de cette tranche ;
- un **index d'expression** sur `(workspace_id, app.cle_fil(...))` : il donne la même performance à
  la garde, ne déplace aucune forme, et laisse la colonne à la tranche qui en aura besoin — celle
  qui groupera les messages à l'écran.

Le second est retenu. La conséquence est **nommée** plutôt que découverte : tant que la colonne
n'existe pas, l'écran devra recalculer la clé, et l'expression devra alors être la **même** des
deux côtés. C'est pourquoi elle est une **fonction** — `app.cle_fil`, `immutable` — et non une
expression recopiée : une définition, un seul endroit où elle change.

##### 16.14.3 L'ÉTAT DE SOMMEIL EST UNE LIGNE, ET SON ABSENCE EST « ÉVEILLÉ »

`public.mail_thread_snoozes` :

| Colonne | Type | Règle |
|---|---|---|
| `workspace_id` | `uuid not null` | `references public.workspaces on delete cascade`. Avec `thread_key`, la **clé primaire** — mesure 5 |
| `thread_key` | `text not null` | La racine du §16.14.2. Contrainte `check (btrim(thread_key) <> '')` : une clé blanche désignerait tous les fils sans racine à la fois |
| `snoozed_until` | `timestamptz not null` | L'échéance. **Non nulle par contrainte de colonne** : une ligne sans échéance n'a pas de sens que l'absence de ligne ne dise mieux |
| `snoozed_by` | `uuid` | `references public.profiles on delete set null`. Écrit **par la fonction**, jamais offert au client |
| `created_at`, `updated_at` | `timestamptz not null default now()` | `updated_at` par `app.set_updated_at()`, trigger déjà en place ailleurs |

**Un fil est en sommeil si sa ligne existe ET que `snoozed_until` est strictement postérieure à
`now()`** — le prédicat du §16.2, transposé sans changement. La sortie reste **implicite** : aucune
tâche planifiée n'est écrite, ici pas davantage qu'au §16.2.

**Le réveil SUPPRIME la ligne, il ne la vide pas.** Une ligne réveillée ne porterait plus qu'une
échéance nulle interdite par sa propre contrainte, ou une échéance passée que le prédicat écarte
déjà : dans les deux cas une coquille que toute lecture devrait ensuite exclure par une seconde
condition. L'absence de ligne est la représentation honnête de « éveillé ». La conséquence est
assumée et nommée au §16.14.7 : **le réveil efface la trace du sommeil**, et rien ne la recueille
ailleurs, faute d'un journal de fil.

##### 16.14.4 `public.snooze_thread` — TROIS refus, et pas quatre

```
public.snooze_thread(workspace uuid, thread_key text, until timestamptz)
  returns public.mail_thread_snoozes
```

`security definer`, `search_path` vidé, relations pleinement qualifiées — mêmes raisons qu'au
§16.3 : la table n'accorde aucune écriture au client, et les politiques ne s'appliquent pas à son
propriétaire, donc la fonction vérifie **elle-même** ce qu'elle a le droit de faire.

Les gardes, dans l'ordre où elles s'opposent :

| # | Refus | SQLSTATE | HTTP | Quand |
|---|---|---|---|---|
| 1 | `thread_not_found` | `P0001` | `400` | **Aucun message** de ce couple `(workspace, clé)` n'est lisible de l'appelant |
| 2 | `snooze_date_required` | `P0001` | `400` | `until` est `NULL` |
| 3 | `snooze_date_in_past` | `P0001` | `400` | `until <= now()` |

**IL N'Y A PAS DE QUATRIÈME REFUS, ET C'EST LA MESURE 3 QUI L'INTERDIT.** Le §16.3 oppose
`forbidden` à qui lit une affaire sans pouvoir l'écrire, parce que `app.can_write_channel` existe et
que le produit a défini ce droit. Sur un fil de messagerie, **aucun droit d'écriture n'est défini
nulle part** : le client détient `SELECT` et rien d'autre. Inventer ici une seconde autorisation —
« qui peut endormir un fil qu'il lit » — serait trancher une question de produit que personne n'a
posée. La règle retenue est donc celle que les données portent déjà : **qui lit le fil peut
l'endormir**, et c'est écrit plutôt que sous-entendu.

**`thread_not_found` couvre les deux causes**, l'inexistence et l'invisibilité, exactement comme
`card_not_found` au §16.3 : distinguer les deux confirmerait l'existence d'un fil à qui n'a pas le
droit de la connaître (`docs/SPEC-permissions-rls.md` §4.3). La mesure 6 rend cette confusion
**observable** : la lectrice ne lit aucun message, donc les deux fils du seed lui sont
indistinctement introuvables ; le business developer lit le fil classé et **pas** l'autre.

**Un fil DÉJÀ en sommeil est accepté** : la nouvelle échéance remplace l'ancienne — `insert … on
conflict (workspace_id, thread_key) do update` —, et `snoozed_by` devient celui qui a reporté. Le
report est un geste, non une erreur, même règle qu'au §16.3.

##### 16.14.5 `public.wake_thread` — idempotente, et elle le dit

```
public.wake_thread(workspace uuid, thread_key text) returns boolean
```

Une seule garde, `thread_not_found`, sur le **même** prédicat de lisibilité : réveiller un fil
qu'on ne lit pas n'est pas plus permis que l'endormir, et le refus ne dit pas davantage.

La garde passée, la ligne est supprimée **si elle existe**. La fonction rend `true` quand une ligne
a réellement été retirée, `false` sinon. Un réveil sans sommeil **n'est pas une erreur du
demandeur** (§16.4) : rendre `false` dit ce qui s'est passé sans le lui reprocher, et un appelant
qui n'en a que faire peut l'ignorer.

##### 16.14.6 QUI LIT LA LIGNE — et une table neuve n'est PAS fermée, c'est mesuré

**LA PREMIÈRE RÉDACTION DE CE SOUS-CHAPITRE ÉTAIT FAUSSE, ET LA SUITE pgTAP L'A DÉMENTIE AVANT LE
COMMIT.** Elle affirmait qu'une table neuve n'accorde de privilège à personne et que la fermeture
en écriture était donc acquise. **MESURÉ le 2026-08-19** : les `alter default privileges` de la
plateforme accordent `all privileges` à `anon`, `authenticated` **et** `service_role` sur toute
table créée dans `public`. À sa naissance, `mail_thread_snoozes` était ouverte en `INSERT`,
`UPDATE` et `DELETE` **à un appelant anonyme** — l'exact contraire de ce que le §16.14.4 garde.

La fermeture ne s'hérite pas, elle se prend : `revoke all … from anon, authenticated`, puis les
`grant` par action — convention déjà écrite par la migration 45 pour `contacts`. Sont accordés,
nominativement :

- à `authenticated` : **`SELECT` seul**, sur toutes les colonnes. L'écran devra lire l'état pour le
  montrer ; il n'écrira jamais directement ;
- à `service_role` : `all privileges`, comme partout ailleurs, pour le seed et l'exploitation ;
- **aucun privilège à `anon`, et aucun `INSERT`, `UPDATE` ni `DELETE` à `authenticated`.** Les deux
  fonctions du §16.14.4 et du §16.14.5 sont le seul chemin, et l'être **par le privilège** vaut
  mieux que l'être par une politique qu'on pourrait élargir sans y penser.

Les fonctions se ferment de la même façon, et pour la même raison mesurée : `revoke … from public`
**ne suffit pas** dans le schéma `public`, `anon` y conservant un `EXECUTE` hérité que le `revoke`
doit **nommer**. La migration 44 l'avait mesuré pour les deux RPC de l'affaire ; c'est remesuré
ici. `app.fil_lisible` fait exception dans un sens précis : la politique de lecture l'appelle,
donc elle est évaluée **avec les droits de l'appelant**, et `authenticated` doit pouvoir
l'exécuter — même forme que `app.peut_voir_message`.

La RLS est active, et sa politique de lecture est `app.fil_lisible(workspace_id, thread_key)` — le
même prédicat que les deux gardes, pour que la ligne visible et le fil visible ne puissent jamais
diverger.

##### 16.14.7 CE QUE LA TRANCHE NE LIVRE PAS, ET C'EST NOMMÉ

- **Aucune surface** : ni pastille, ni geste, ni filtre de l'inbox. Un fil endormi reste
  aujourd'hui visible partout où il l'était. La Definition of Done de `CRM-081` n'est donc pas
  tenue par cette tranche, et l'unité reste `[~]` ;
- **aucun groupement des messages en fils à l'écran** : l'inbox liste des messages, pas des fils
  (`webapp/src/lib/inbox.ts`), et ce regroupement est un travail d'écran qui appartient à la
  tranche suivante ;
- **aucune trace dans un journal**. `card_events` est le fil d'une **affaire** ; un fil de
  messagerie n'a pas d'équivalent, et en écrire un dans `card_events` attribuerait à une affaire un
  geste qui ne la vise pas — d'autant qu'un fil peut porter des messages classés sur des affaires
  différentes, ou sur aucune. La seule trace est la ligne elle-même, son `snoozed_by` et son
  `updated_at` ; le réveil l'efface (§16.14.3). **L'écart est nommé, non comblé** : le jour où un
  journal de fil existera, il recueillera les deux gestes ;
- **aucun réveil planifié**, pour le motif exact du §16.2 ;
- **aucune donnée de démonstration nouvelle.** La mesure 6 établit que le seed porte déjà
  l'asymétrie qui prouve les refus. Poser un fil endormi n'aurait d'intérêt que le jour où un écran
  le montre — même raisonnement qu'au §16.1 pour l'affaire, et le seed reste **intact**.

##### 16.14.8 Contrat d'API — les neuf lignes, avec les jetons réels

Clés du seed : `Wc` = `<seed-inbox-classe@p2enjoy.test>` (fil **classé**, lu par
l'administratrice et le business developer), `Wn` = `<seed-inbox-non-classe@p2enjoy.test>` (fil
**non classé**, lu de la seule administratrice), `W` = le workspace du seed.

| # | Appel | Profil | Attendu |
|---|---|---|---|
| 1 | `snooze_thread(W, Wc, now()+7j)` | administratrice | `200`, la ligne, `snoozed_by` = son identifiant |
| 2 | `snooze_thread(W, Wc, now()+14j)` | administratrice | `200`, l'échéance **remplacée**, toujours une seule ligne |
| 3 | `snooze_thread(W, Wn, now()+7j)` | business developer | `400`, `thread_not_found` — il ne lit pas ce fil |
| 4 | `snooze_thread(W, Wc, now()+7j)` | lectrice | `400`, `thread_not_found` — elle n'en lit aucun |
| 5 | `snooze_thread(W, Wc, null)` | administratrice | `400`, `snooze_date_required` |
| 6 | `snooze_thread(W, Wc, now()-1j)` | administratrice | `400`, `snooze_date_in_past` |
| 7 | `snooze_thread(W, '<inconnu@p2enjoy.test>', now()+7j)` | administratrice | `400`, `thread_not_found` |
| 8 | `wake_thread(W, Wc)` | administratrice | `200`, `true`, la ligne **relue absente** |
| 9 | `wake_thread(W, Wc)` | administratrice | `200`, `false` — idempotente, aucun refus |

Chaque refus **relit la ligne** pour la constater inchangée (décision 70).

##### 16.14.9 Preuves exigées de la tranche

| Niveau | Preuve |
|---|---|
| pgTAP | Suite dédiée : la forme de la table, de ses contraintes et de sa clé primaire ; les privilèges **accordés et refusés** à `authenticated`, colonne par colonne pour l'écriture ; la RLS active et sa politique ; la forme des trois fonctions, leur `security definer` et leur propriétaire ; `app.cle_fil` sur les deux cas de la mesure 2 ; les trois refus de `snooze_thread`, le report, et l'idempotence de `wake_thread` |
| API | Les neuf lignes du §16.14.8 rejouées avec les jetons réels des profils seedés |
| E2E d'interface | **Aucune** : la tranche ne livre aucune surface. Elle est due par la tranche suivante, avec ses captures |
| Visuel | **Aucune vérification visuelle**, pour la même raison |
| Seed | Le seed sort **intact** : les preuves réveillent le fil qu'elles endorment |

##### 16.14.10 Definition of Done de la tranche 2 c

- `supabase/migrations/0048_snooze_fils.sql` : `app.cle_fil`, l'index d'expression,
  `public.mail_thread_snoozes` et sa RLS, `app.fil_lisible`, `public.snooze_thread`,
  `public.wake_thread`, et les privilèges nominatifs du §16.14.6 ;
- suite pgTAP dédiée, exécutée et verte ;
- preuve d'API dédiée, les neuf lignes avec les jetons réels ;
- `docs/SCHEMA.md`, `docs/PROD_MIGRATIONS.md` et `CHANGELOG.md` dans le même changement ;
- commentaires `@spec` sur chaque fichier touché.

**Ce qui restera dû sur `CRM-081` après la tranche 2 c** : la **surface** du sommeil de fil —
groupement des messages en fils dans l'inbox, pastille, geste et filtre. L'unité demeure `[~]`.

#### 16.15 Tranche 2 e — la SURFACE du sommeil de fil dans l'inbox

Le §16.14.7 nomme quatre manques laissés par la tranche 2 c : aucune pastille, aucun geste, aucun
filtre, aucun groupement. Ce sous-chapitre est le contrat des **trois premiers** ; le groupement est
écarté et son motif est écrit au §16.15.8. Il est rédigé avant sa première ligne de code et fondé
sur **quatorze mesures** relevées le 2026-08-19 sur la pile seedée, avec les jetons réels des trois
profils.

##### 16.15.1 QUATORZE MESURES, ET TROIS D'ENTRE ELLES DÉCIDENT DE LA FORME DE L'ÉCRAN

| # | Mesure, le 2026-08-19 | Ce qu'elle décide |
|---|---|---|
| A | Les deux messages du seed rendent `references_ids` = `[]` — un **tableau vide**, jamais `null` — et leur `rfc822_message_id` porte la clé | La clé se calcule au client sur un tableau **présent mais vide**. C'est le cas courant, pas un cas limite |
| B | Le business developer lit **un** message, le classé, avec les mêmes colonnes | Les colonnes du fil ne sont pas privilégiées : elles suivent la politique de lecture des messages |
| C | La lectrice lit **zéro** message | L'écran d'une lectrice n'a aucun fil, donc aucun geste à offrir — et il n'a rien à masquer non plus |
| D | `GET mail_thread_snoozes` rend `200` et `[]` à l'administratrice sur une table vide | L'écran lit la table **directement**, sans RPC de lecture : le privilège `SELECT` du §16.14.6 est réel |
| E | `snooze_thread(W, Wc, 2099)` rend `200` et la ligne complète, `snoozed_by` = l'administratrice | Le geste rend la ligne écrite : c'est **elle** qui alimente la pastille, jamais la saisie |
| F | La même ligne est relue par l'administratrice **et** par le business developer, et **pas** par la lectrice | La politique de lecture de la ligne suit la lisibilité du fil : l'écran n'a aucun droit à appliquer |
| G | **Le fil endormi, `GET mail_messages` rend TOUJOURS ses 2 messages** | **AUCUN FILTRE SERVEUR N'EXISTE**, et le masquage est un travail de composition — voir le §16.15.5 |
| H | `wake_thread` rend `true`, et la ligne est relue **absente** | Le réveil retire la pastille parce que la ligne a disparu, non parce que l'écran l'a décidé |
| I | `snooze_thread` par le business developer sur le fil non classé : `400`, `thread_not_found` | Le refus de discrétion existe et se lit dans `message` |
| J | `POST mail_thread_snoozes` direct par l'administratrice : `403`, `42501` | L'écran ne peut pas contourner les deux fonctions, même s'il le voulait |
| K1 | `until` = `null` : `400`, `snooze_date_required` | La saisie vide est **envoyée**, et c'est la base qui refuse (§16.11.3, sans changement) |
| K2 | `until` passée : `400`, `snooze_date_in_past` | Aucune garde de saisie ne double la base |
| L | `wake_thread` sur un fil **éveillé** : `200`, `false` | Un réveil sans sommeil n'est pas une erreur du demandeur (§16.14.5) |
| M | `wake_thread` par la lectrice : `400`, `thread_not_found` | Le réveil oppose le même refus que la mise en sommeil, et pas davantage |

**LA MESURE G COMMANDE TOUTE LA TRANCHE.** `app.cle_fil` vit dans le schéma `app`, que PostgREST
n'expose pas : aucune requête de l'écran ne peut demander « les messages dont le fil n'est pas
endormi ». La vue liste des cards filtrait **au serveur** (§16.12.3) parce que `snoozed_until` est
une colonne de `cards` ; ici il n'y a pas de colonne, par la décision du §16.14.2. Le masquage se
fait donc **à la composition**, comme le board — et la conséquence est nommée au §16.15.5 plutôt que
découverte.

**LA MESURE A COMMANDE LA FONCTION DE CLÉ.** `coalesce(p_references_ids[1], p_rfc822_message_id)`
ne teste que `NULL` : en SQL, un tableau vide indexé rend `NULL`, donc la racine est le
`Message-ID` propre. Au client, `references[0]` rend `undefined` sur le même tableau. Les deux
définitions coïncident **à condition que le client ne fasse rien de plus** : toute valeur présente
est retenue, **y compris une chaîne vide**, parce que `coalesce` la retiendrait aussi. « Améliorer »
la règle au client — écarter une chaîne blanche, par exemple — la ferait diverger de la garde, et
l'écran demanderait alors le sommeil d'une clé que le serveur ne connaît pas.

##### 16.15.2 `cleFil` — une définition, deux langages, et aucune tolérance

```
cleFil(referencesIds: readonly string[] | null, rfc822MessageId: string): string
```

Miroir **exact** de `app.cle_fil` (§16.14.2) : le premier élément de `referencesIds` s'il est
présent, sinon `rfc822MessageId`. Un tableau `null` — que le type engendré autorise — vaut un
tableau vide. Aucune normalisation, aucun `trim`, aucun rejet de la chaîne vide : la divergence
serait invisible à la lecture et fatale à l'appel.

La duplication est **assumée et nommée**, comme au §16.14.2 : tant qu'aucune colonne ne porte la
clé, l'écran doit la recalculer. Le jour où la tranche du groupement posera cette colonne, cette
fonction disparaîtra au profit d'une lecture — et c'est écrit ici pour que ce jour-là on sache
qu'elle peut disparaître.

##### 16.15.3 CE QUE L'ÉCRAN LIT, ET COMBIEN DE FOIS

**Une seule lecture de `mail_thread_snoozes` par chargement de liste**, non une par message :

```
select workspace_id, thread_key, snoozed_until  from mail_thread_snoozes
```

Aucun filtre n'est posé sur `workspace_id` : la politique du §16.14.6 rend déjà les seules lignes
dont le fil est lisible (mesure F), et ajouter un `eq` ferait croire que l'écran tient la règle
(même raisonnement qu'au §2.7 du catalogue). La table ne porte **que** des fils endormis ou échus :
son volume est celui des gestes, non celui des messages.

L'état est réduit en une **table de correspondance** `(workspace_id, thread_key) → échéance`. Le
couple est la clé, jamais la seule chaîne : la mesure 5 du §16.14.1 a établi que la clé n'est unique
que dans son workspace, et deux workspaces peuvent porter le même `Message-ID`.

Les colonnes `workspace_id`, `references_ids` et `rfc822_message_id` rejoignent `COLONNES_LISTE`
(`webapp/src/lib/inbox.ts`). Elles sont **nécessaires** : sans les deux dernières, aucune clé ne se
calcule ; sans la première, la clé ne se rattache à aucun workspace. Le corps du message n'est
toujours pas demandé.

##### 16.15.4 LA PASTILLE — la même qu'ailleurs, et pour la même raison

La pastille compacte de `components/ui/Sommeil.tsx` est **réemployée telle quelle** : icône `Moon`,
date courte à l'œil, phrase entière en nom accessible. C'est la même information que sur une carte
de board et dans une ligne de tableau, et « elle doit se reconnaître d'une vue à l'autre »
(`docs/DESIGN_SYSTEM.md` §5.3 quinquies). Une seconde pastille propre à l'inbox serait la même
chose dite deux fois, et les deux divergeraient au premier ajustement.

Elle est rendue :

- dans la **ligne de la liste**, après la date, quand le fil du message est endormi ;
- dans l'**en-tête du message ouvert**, au même endroit.

**Le prédicat est celui du §16.2, transposé sans changement** : une ligne existe ET son échéance est
strictement future. Une échéance **échue** n'est pas un sommeil : la ligne subsiste en base (rien ne
la supprime), et l'écran ne montre rien — exactement la règle du §5.3 quater pour l'affaire.

**L'instant est calculé UNE FOIS par rendu de liste et passé aux lignes.** Un `new Date()` par ligne
ferait qu'une échéance franchie pendant le rendu marquerait une ligne et pas sa voisine — le défaut
que le §16.12.3 a déjà nommé pour le board.

##### 16.15.5 LE FILTRE — à la composition, et il dit ce qu'il masque

**Par défaut, les messages d'un fil endormi sont masqués.** C'est ce que « mettre en sommeil »
promet, et un fil endormi qui resterait visible ne serait qu'une pastille de plus.

La bascule est celle du §5.3 quinquies — **une case à cocher étiquetée**, pas un bouton à deux
états —, réemployée depuis `components/ui/Sommeil.tsx` avec son propre libellé : « Afficher les fils
en sommeil ». Elle vit dans l'en-tête du panneau de liste, et **reste rendue y compris sur une liste
vide** : elle est la cause possible de ce vide.

**TROIS CONSÉQUENCES DE LA MESURE G, ÉCRITES PLUTÔT QUE DÉCOUVERTES :**

1. **La borne de 50 messages s'applique AVANT le filtre** (`MESSAGES_PAR_PAGE`). Une page peut donc
   rendre moins de 50 lignes tout en étant tronquée. La mention « la liste est tronquée » existe
   déjà et reste affichée sur le critère du serveur — le nombre de lignes **rapportées** —, jamais
   sur le nombre affiché : la corriger d'après l'affichage ferait disparaître un avertissement vrai.
2. **L'écran connaît le nombre de messages masqués**, puisqu'il les a lus. Un état vide dû au
   sommeil le dit — « Tous les messages de ce dossier sont dans des fils en sommeil » — et porte la
   bascule qui l'en sort, selon le patron du §5.8. Aucune requête supplémentaire.
3. **Le filtre ne survit pas au changement de dossier**, et il n'entre pas dans l'adresse. L'inbox
   n'a pas de paramètres d'adresse (`webapp/src/app/RouteInbox.tsx` ne lit aucun `searchParams`), et
   lui en inventer un pour ce seul contrôle ouvrirait une question — quelle est l'adresse d'un
   dossier ? — que cette tranche n'a pas à trancher. L'écart est nommé, non masqué.

**Le message OUVERT n'est jamais masqué par le filtre.** Endormir le fil du message qu'on lit ne
fait pas disparaître ce qu'on lit : la ligne quitte la liste, le panneau de lecture reste. Faire
autrement viderait l'écran sous le geste de l'utilisateur.

##### 16.15.6 LE GESTE — deux visages, dans le panneau de lecture

Le geste vit dans le **message ouvert**, et non dans chaque ligne de la liste : une liste dont
chaque ligne porte un bouton n'est plus une liste, et le §5.4 tient une densité que cette tranche
ne défait pas.

- **« Mettre le fil en sommeil »** (icône `Moon`) sur un fil éveillé, **« Réveiller le fil »**
  (icône `Sun`) sur un fil endormi. Un seul rendu à la fois, même règle qu'au §5.3 quater.
- **Le réveil n'ouvre aucun panneau et ne demande aucune confirmation** : il n'a pas de paramètre et
  il est réversible d'un geste.
- **La mise en sommeil ouvre un panneau** sous l'en-tête du message : les **quatre échéances
  usuelles** de `ECHEANCES_USUELLES` — comptées depuis l'instant du geste, jamais du rendu —, puis un
  champ `datetime-local` et son bouton. Le panneau remplace la commande ; `Échap` le referme en
  rendant le focus à la commande.
- **Aucune garde de saisie ne double la base** (mesures K1 et K2) : le champ n'a ni `min` ni
  `required`, une échéance passée est **envoyée**, et le refus s'écrit sous le champ en
  `role="alert"` sans effacer la saisie.
- **La commande n'est jamais éteinte d'avance.** La mesure C interdit d'ailleurs de la deviner : une
  lectrice n'a aucun message, donc aucun message ouvert, donc la question ne se pose pas — mais la
  règle vaut pour tout profil dont le droit changerait entre deux chargements.
- **Pendant le vol, les gestes du panneau sont éteints et le bouton appuyé dit « Enregistrement… »**
  (§5.3 sexies, sans changement).
- **Le succès referme le panneau, retire la ligne de la liste** — ou l'y ramène au réveil — **et
  annonce le geste dans la région live** déjà présente sur l'écran.

**Les issues sont le dictionnaire fermé du §16.11.4, moins une, et cette absence est mesurée** :
`snooze_thread` n'oppose **aucun** `forbidden` (§16.14.4), donc l'issue `refus` n'est pas atteignable
et n'est pas déclarée. Les mentions de `thread_not_found`, `snooze_date_required` et
`snooze_date_in_past` sont écrites pour un **fil** et non pour une affaire : « Ce fil n'est plus
disponible. » remplace « Cette affaire n'est plus disponible. » Un même refus se formule d'une seule
façon, mais il nomme l'objet qu'il vise.

##### 16.15.7 Contrat d'API — aucune ligne nouvelle

Cette tranche n'ajoute **aucun** chemin serveur. Les deux RPC sont celles du §16.14.4 et du
§16.14.5, dont le contrat de neuf lignes (§16.14.8) est déjà éprouvé avec les jetons réels par
`e2e/api/snooze-fils.spec.ts`. Les quatorze mesures ci-dessus l'ont **remesuré** avant d'écrire ce
chapitre plutôt que de s'y fier de mémoire.

La seule lecture nouvelle est le `GET mail_thread_snoozes` du §16.15.3, dont la mesure D et la
mesure F établissent le comportement pour les trois profils.

##### 16.15.8 CE QUE LA TRANCHE NE LIVRE PAS, ET C'EST NOMMÉ

- **Aucun groupement des messages en fils.** L'inbox reste une liste de **messages**, et chaque
  message porte l'état de son fil. Grouper change ce que la liste énumère — un fil n'a ni un
  expéditeur, ni une date, mais un dernier expéditeur et une dernière date, et un compte —, donc ce
  que la sélection désigne, ce que le panneau de lecture ouvre, et ce que les compteurs de
  l'arborescence comptent. C'est une tranche entière, `2 f`, et la mêler à celle-ci livrerait deux
  demi-changements plutôt qu'un entier. **`CRM-081` reste donc `[~]` après cette tranche**, et la
  DoD nomme ce seul manque ;
- **aucun paramètre d'adresse** pour le filtre, motif au §16.15.5 point 3 ;
- **aucune donnée de démonstration nouvelle.** La mesure G montre le seed suffisant pour éprouver
  les deux côtés du filtre : endormir le fil classé masque un message sur deux pour
  l'administratrice, et l'asymétrie des trois profils reste celle de la mesure 6 du §16.14.1. Une
  preuve qui endort **réveille** ce qu'elle a endormi, et le seed sort intact ;
- **aucun geste depuis la ligne de liste**, motif au §16.15.6.

##### 16.15.9 Preuves exigées de la tranche

| Niveau | Preuve |
|---|---|
| Unitaire | `cleFil` sur les deux cas de la mesure A **et** sur la chaîne vide retenue ; le prédicat avec instant injecté, ses deux côtés et l'instant exact ; la table de correspondance sur le couple, deux workspaces portant la même clé ; le filtre de composition dans les deux modes, le compte des masqués, le message ouvert jamais masqué ; le classement des issues sur les quatre codes mesurés |
| Composant | Le geste à deux visages, le panneau et ses quatre échéances, le refus écrit sans effacer la saisie, l'extinction pendant le vol, la bascule et l'état vide qui porte son action |
| API | **Aucune nouvelle** : le §16.15.7 dit pourquoi, et les quatorze mesures l'ont remesuré |
| E2E d'interface | Suite dédiée sans aucune substitution : la pastille après un geste réel, la ligne qui quitte la liste, la bascule qui la ramène, le réveil vérifié **après rechargement** donc contre la base, le refus d'échéance passée avec son message consommé, et les paliers étroits |
| Visuel | Captures produites **et observées** (`CLAUDE.md` §16), sous `docs/captures/CRM-081/` |
| Seed | Intact : la preuve réveille ce qu'elle endort, vérifié par une dernière lecture |

##### 16.15.10 Definition of Done de la tranche 2 e

- `webapp/src/lib/sommeil-fil.ts` : `cleFil`, le prédicat, la table de correspondance, le filtre de
  composition, les deux appels de RPC et le dictionnaire fermé des issues ;
- `webapp/src/lib/inbox.ts` : les trois colonnes du §16.15.3 et la lecture des fils endormis ;
- `webapp/src/app/RouteInbox.tsx` : la pastille, la bascule, l'état vide et le geste ;
- `docs/DESIGN_SYSTEM.md` §5.3 septies pour la forme, `docs/manual.md` pour le parcours ;
- preuves unitaires, de composant et E2E exécutées et vertes, captures observées ;
- `CHANGELOG.md` et `docs/JOURNAL.md` dans le même changement ;
- commentaires `@spec` / `@verifies` sur chaque fichier touché.

**Ce qui restera dû sur `CRM-081` après la tranche 2 e** : le **groupement** des messages en fils
(tranche 2 f). L'unité demeure `[~]`.
