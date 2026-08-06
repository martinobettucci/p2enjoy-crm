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

Les identifiants sont **stables** — `5eed0000-0000-4000-8000-0000000000c1` à `…c9` —, comme
`CLAUDE.md` §8 l'exige des données dont les tests dépendent.

### 9.1 Aucune card dans `prospection`, et le motif est mesuré

Le channel `prospection` est le seul du seed que le workflow **dérivé** de `CRM-032` occupe, et
c'est aussi celui que le droit fin du `viewer` rouvre. Il aurait été le meilleur candidat pour
démontrer les deux. Il est pourtant **laissé vide**, et le motif n'est pas un choix esthétique.

MESURÉ, une card posée dans `prospection` puis le seed rejoué : **échec, code de sortie `1`**, dès
la **section 4** :

```
ERREUR création du channel prospection : code HTTP 409, attendu 200 201.
  {"code":"23503","details":"Key (id, workflow_id)=(…31, 244bbfc6-…) is still referenced
   from table \"cards\"", …}
```

Le seed **repointe le `workflow_id` de `prospection` deux fois à chaque exécution** : la section 4
le ramène au workflow global déclaré, la section 7 le rattache ensuite à la copie de portée track.
La clé composite du §2.4 refuse le premier geste dès qu'une card y vit. Contre-épreuve mesurée :
une card dans `grands-comptes`, dont le workflow ne change jamais, laisse le seed **vert**, code de
sortie `0`, zéro erreur.

Ce n'est pas un défaut de la clé, et ce n'est pas un défaut du seed : c'est la **conséquence
concrète et immédiate** de la règle non décidée d'INC-046, sur le seul objet du projet qui
l'exerce. Le comportement du seed reste **inchangé** — le corriger supposerait de trancher INC-046,
ou de rendre conditionnelle une convergence livrée par `CRM-032` et `CRM-033`, dont
`scripts/verify-copie-workflow.sh` dépend. La démonstration que la card perdue portait est reprise
**ailleurs, sans rien perdre** : la ligne *n* du contrat du §8.1 fait créer une card dans
`prospection` par le `viewer` lui-même, ce qui prouve la réouverture par droit fin mieux qu'une
ligne de seed ne le ferait, puis la retire.

L'écart est **figé par une assertion** de la suite pgTAP, qui constate qu'aucune card ne réside
dans `prospection` **et** que la clé composite refuse le déplacement. Le jour où l'arbitrage
d'INC-046 sera rendu, elle le dira.

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
4. **Le changement de workflow d'un channel occupé est refusé** par une conséquence structurelle que
   nulle spécification n'énonce — INC-046.
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
`Range: 0-1` sur les trois cards actives de `grands-comptes` :

```
HTTP/1.1 206 Partial Content
Content-Range: 0-1/3
```

**`count=exact` et non `count=planned`.** MESURÉ sur les mêmes trois lignes : `count=planned` rend
`Content-Range: 0-0/1` — l'estimation du planificateur, **fausse d'un facteur trois**. Une
pagination construite sur une estimation afficherait un nombre de pages qui n'existe pas. Le coût
d'un `count(*)` exact est assumé et **borné** : le filtre `channel_id` est servi par
`cards_channel_step_position_idx`, et le point est rouvert au §12.11 si le volume l'impose.

**Le responsable n'est pas affiché, et la colonne n'existe pas.** MESURÉ avec le jeton réel de
l'administratrice : `GET /rest/v1/profiles?select=id,full_name` rend `200` et `[]` — INC-014,
arbitrage attendu. C'est le constat du §7.2 de `docs/SPEC-workflow-engine.md`, inchangé. Afficher
`owner_id` à la place d'un nom serait la valeur par défaut trompeuse que `CLAUDE.md` §18 proscrit :
la colonne « Responsable » n'est **pas** rendue du tout, plutôt que rendue vide.

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
{"code":"PGRST103","details":"An offset of 4 was requested, but there are only 3 rows.", …}
```

**MESURÉ, et le comportement est piégeux :**

| Rang demandé | Total réel | Réponse |
|---|---|---|
| `offset=0&limit=2` | 3 | `206`, `Content-Range: 0-1/3`, deux lignes |
| `offset=2&limit=1` | 3 | `206`, `Content-Range: 2-2/3`, une ligne |
| `offset=3&limit=1` — l'offset **égale** le total | 3 | `206`, `Content-Range: */3`, **zéro ligne, aucune erreur** |
| `offset=4&limit=1` — l'offset **dépasse** le total | 3 | **`416 Requested Range Not Satisfiable`**, `Content-Range: */3` |
| `offset=25&limit=25` — la page 2 d'un channel d'une page | 3 | **`416`**, `Content-Range: */3` |
| `offset=0&limit=25` | 0 (appelant anonyme) | `200`, `Content-Range: */0`, `[]` |

Vu à travers `supabase-js`, le `416` n'est pas une page vide : c'est une **erreur**. MESURÉ,
`.range(4, 28)` rend `status: 416`, `error.code: 'PGRST103'`, `count: null` **et** `data: null`.
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
| La colonne **Responsable** | `profiles` en refus par défaut, INC-014 (§12.3) |
| Les **étiquettes** | Aucune table `tags` n'existe, et aucune unité du backlog n'en porte (§1.2) |
| Le **choix du nombre de lignes par page** | Périmètre inventé (§12.6) |
| Les **vues sauvegardées** | `CRM-071`, que `docs/manual.md` nomme déjà |
| La **recherche globale** au workspace | Aucune unité ne la porte (§12.1) |
| Une **vue des archives** ou une **corbeille** | Promises par le §4, portées par aucune unité |
| Le **parcours complet d'un utilisateur connecté** | INC-021. La webapp est un appelant anonyme, et une card est par construction invisible à un anonyme |

### 12.11 Points ouverts propres à la vue liste

1. **`count=exact` sur chaque page.** Le coût est aujourd'hui nul — neuf cards en base — et
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
4. **Le seed ne porte aucune donnée longue.** MESURÉ : le titre le plus long du seed fait
   **34 caractères**, la prochaine action la plus longue **34** également. La Definition of Done
   exige un « comportement avec données longues vérifié en capture » : la capture est produite
   contre une **réponse substituée** (`docs/DESIGN_SYSTEM.md` §12.5), et le manque appartient au
   seed de démonstration, `CRM-046`.
5. **Le seed ne porte aucun channel de plus de 25 cards.** MESURÉ : trois cards actives au maximum
   dans un channel. La seconde page se prouve donc, elle aussi, contre une réponse substituée et
   par la mesure directe du `Range` sur la pile réelle. Même destinataire : `CRM-046`.
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

**Modification et suppression — l'auteur seul** (décision 194, INC-072). Le §4 y ajoute les
`admin` ; le backlog ne le fait pas. `CRM-043` livre l'**intersection** des deux énoncés, qui
n'ouvre rien que l'un ou l'autre refuse. Conséquence nommée et non masquée : **aucun modérateur ne
peut retirer un commentaire déplacé**. L'arbitrage est demandé ; il porte sur une politique
supplémentaire, non sur le modèle.

**Les quatre politiques :**

| Opération | Rôles | Prédicat |
|---|---|---|
| `SELECT` | `anon`, `authenticated` | `app.can_read_card(card_id)` |
| `INSERT` | `authenticated` | `app.can_write_card(card_id) and author_id = auth.uid()` |
| `UPDATE` | `authenticated` | `USING` **et** `WITH CHECK` : `author_id = auth.uid() and app.can_write_card(card_id)` |
| `DELETE` | — | **aucune politique**, et **aucun privilège** : refus double (§13.7) |

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
écrite**, par le trigger du §13.5.

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
- **Le nom de l'auteur n'est PAS affiché.** `profiles` n'est lisible par aucun jeton d'utilisateur —
  INC-014, ouverte depuis `CRM-005` —, et la vue liste a tranché le même cas en ne rendant **pas du
  tout** la colonne « Responsable » plutôt qu'en la rendant vide (§12.7). La règle est reconduite,
  et la limite nommée à l'écran plutôt que comblée par un identifiant technique.
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
| `…0c4` *Refonte intranet Ville de Lyon* | Driss Lemoine | **supprimé** | la pierre tombale, corps vide, dans un channel d'un autre track |
| `…0c5` *Support niveau 2* | Farida Nowak (`viewer`) | vivant | **le témoin du refus** : la ligne existe, écrite par la clé de service, et le `viewer` ne peut pas en écrire une seconde par l'API. Sans elle, le §13.8 e prouverait une lecture vide |

Le commentaire de `…0c5` est **posé par la clé de service**, non par le `viewer` : le seed écrit ce
que le produit refuserait, et le dit. C'est la seule ligne du seed dont l'auteur ne pourrait pas
l'écrire lui-même, et elle existe pour que la lecture autorisée soit distinguable d'une table vide.

`mentions` reste `'{}'` sur les cinq : rien ne l'alimente (§13.1).

### 13.12 Ce que `CRM-043` ne livre pas

**LES ACTIONS « MODIFIER » ET « SUPPRIMER » NE SONT PAS RENDUES PAR L'ÉCRAN.** Le §5.10 du design
system les décrit — boutons tertiaires, visibles au survol **et au focus clavier**, confirmation
explicite pour la suppression —, et le backend les applique : les deux politiques et le trigger sont
livrés, et `e2e/api/commentaires.spec.ts` les exerce avec les jetons réels. **Aucun bouton ne les
offre dans le fil.** L'écart est nommé plutôt que comblé au jugé : les deux gestes supposent de
distinguer *ses* commentaires de ceux des autres, donc de connaître l'identifiant de l'appelant,
donc une session — INC-021. Un bouton offert à tous, qui échouerait pour tous sauf l'auteur, serait
une aide d'interface trompeuse. Le §13.10 et `docs/manual.md` chapitre 4.10 disent l'un et l'autre
que la règle existe et que le geste n'est pas offert.

Outre le §13.1 : aucune pagination du fil — MESURÉ, cinq commentaires au seed, et le §12.6 a montré
ce que coûte une pagination bâtie sans mesure ; aucune recherche dans les commentaires ; aucun
`card_activities`, table voisine que `docs/SCHEMA.md` §5 décrit et qu'aucune unité du chunk 3 ne
porte.

### 13.13 Points ouverts

1. **Le markdown est stocké et rendu en texte brut.** `docs/SCHEMA.md` §5 dit « markdown » ; aucune
   unité ne porte son rendu, et le rendre exigerait une politique d'assainissement qu'aucun document
   n'écrit. Rendre du markdown reçu d'un tiers sans cette politique serait ouvrir une injection.
2. **Aucune modération** (§13.6, INC-072).
3. **Aucune notification de mention** (§13.1).
4. **Le nom de l'auteur reste illisible** (INC-014), et c'est la limite la plus visible du panneau :
   un fil de discussion sans nom d'auteur est un fil incomplet. Elle appartient aux politiques de
   `profiles`, qu'aucune unité ne porte.
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

### 13.14 Preuves attendues de `CRM-043`

| Niveau | Preuves |
|---|---|
| pgTAP | Forme de la table, unicité ajoutée à `cards`, clé composite dans les deux sens, `CHECK` conditionnel du corps, trigger d'insertion (dérivation, défauts), trigger de mise à jour (`edited_at`, pierre tombale, refus de résurrection, colonnes gelées), quatre politiques, privilèges de colonne, appartenance à la publication, conformité du seed |
| Unitaire | Projection du fil, ordre chronologique, classification des refus, état « modifié », état « supprimé », et le composant réel |
| API | Les seize lignes du §13.8 avec les jetons réels, plus le **temps réel** : le témoin qui reçoit, et le `viewer` fermé qui ne reçoit rien |
| E2E d'interface | Contre le **build de production** : l'anonyme qui n'atteint jamais le panneau sans substitution, puis le fil, l'état vide, la pierre tombale, la mention « modifié » et le refus d'écriture, réponses substituées et **dit comme tel** |
| Visuel | Captures aux paliers du §7 du design system : fil chargé, état vide, refus d'écriture, commentaire long |
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
| `type` | `text` | non nul, `CHECK` sur les **huit** valeurs du §14.4 | Le vocabulaire est tenu par la base |
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

### 14.4 Les neuf types livrés

`docs/SCHEMA.md` §5 énumère `created`, `moved`, `field_changed`, `assigned`, `mail_received`,
`mail_sent`, `archived`, puis des points de suspension. Les valeurs suivantes sont livrées, et le
`CHECK` **n'en accepte aucune autre** — **huit** par `CRM-044`, la **neuvième** par `CRM-045` :

| Type | Écrit quand | Trigger |
|---|---|---|
| `created` | une card naît | `cards`, `AFTER INSERT` |
| `moved` | `current_step_id` change **et `channel_id` ne change pas** | `cards`, `AFTER UPDATE` |
| `channel_changed` | `channel_id` change — `CRM-045` | `cards`, `AFTER UPDATE` |
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

**`moved` et `channel_changed` s'excluent.** La garde `moved` est conditionnée à `channel_id`
inchangé : une card qui change de channel n'a franchi **aucune arête** du graphe, et `moved`
signifie exactement cela depuis `CRM-044`. Rien n'est perdu — le `payload` de `channel_changed`
porte l'étape d'avant et celle d'après (`docs/SPEC-workflow-engine.md` §6.7).

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
- **Quatre familles de filtres**, et pas huit : `Discussion` (les commentaires), `Étapes` (`moved`),
  `Champs` (`field_changed`), `Cycle de vie` (`created`, `archived`, `unarchived`, `trashed`,
  `restored`, `assigned`). Huit cases pour vingt-sept lignes seraient un contrôle plus gros que
  son objet.
- **Aucune persistance du filtre.** Ni `localStorage`, ni `sessionStorage` : `CLAUDE.md` §11 n'admet
  une donnée sur l'appareil que si elle est nécessaire, et l'état d'un filtre ne l'est pas. Il
  repart complet à chaque ouverture, ce qui est aussi la seule valeur qui ne cache jamais rien.
- **Aucun nom d'acteur.** INC-014 : `profiles` n'est lisible par aucun jeton d'utilisateur. La
  règle du §12.5 du design system s'applique une troisième fois — une donnée illisible n'est pas
  rendue **du tout**. L'événement dit ce qui s'est passé, pas qui l'a fait, et le §5.11 le dit à
  l'écran plutôt que d'afficher un identifiant technique.
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
