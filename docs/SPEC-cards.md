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

À la **mise à jour**, le trigger ne fait **rien**, et la colonne reste modifiable par un appelant
qui a le droit d'écriture sur le channel. **C'est un manque, il est nommé** : sa correction est
`CRM-013` — « `current_step_id` et `email_local_part` non modifiables directement » —, unité `[ ]`
distincte dont la Definition of Done porte ces deux colonnes mot pour mot. L'écart est figé par une
assertion de la suite pgTAP, qui deviendra rouge le jour où `CRM-013` sera livrée sans que
l'assertion soit révisée.

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
