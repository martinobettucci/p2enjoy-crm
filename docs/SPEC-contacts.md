# SPEC — Contacts et organisations (`CRM-060`)

Spécification du carnet de contacts du CRM : les personnes avec qui une affaire se traite, et les
organisations auxquelles elles appartiennent. Écrite **avant toute ligne de code** (`CLAUDE.md`
§5), après mesure sur la pile réelle le 2026-08-18 — schéma existant relevé à la main, identifiants
du seed confirmés, absence des trois tables constatée par `to_regclass`.

Références amont, qui **précèdent** ce document et le contraignent :

- `docs/SCHEMA.md` §6 (`organizations`, `contacts`, `card_contacts`) et sa ligne « unicité »
  (`contacts` unique sur `(workspace_id, lower(email))`) ;
- `docs/SPEC-permissions-rls.md` §4 (tableau des familles de tables) : « `contacts`,
  `organizations` — lecture par les **membres du workspace**, écriture par les
  **`business_developer` et `admin`** » ;
- `docs/SPEC-mail-subsystem.md` §16, règle 3 du classement : « l'expéditeur est un **contact**
  rattaché à **exactement une** card active » — la règle qui donnera son premier consommateur à
  `card_contacts`, désactivée jusqu'à cette unité (`CRM-055`) ;
- `docs/SPEC-form-composer.md` §6.5 : un champ de type `contact` doit **résoudre** vers un contact
  du **même workspace** (décision 295, INC-053) — second consommateur, hors de cette première
  tranche ;
- `docs/MASTER_PLAN.md` §2, contrainte d'ordre : « `CRM-060` (contacts) précède `CRM-055` pour la
  règle de suggestion par contact connu ».

---

## 1. Portée, et son découpage en tranches

L'unité livre un objet métier de première classe (`CLAUDE.md` §4). Elle est **découpée**, et
chaque tranche est committée et prouvée avant la suivante :

1. **Le modèle** — les trois tables `organizations`, `contacts`, `card_contacts`, leurs
   contraintes, leur RLS, leurs privilèges, leur suite pgTAP, leur preuve d'API et leur seed. **Objet
   de la présente livraison.**
2. **La règle 3 du classement** — activer la suggestion « expéditeur connu » de `CRM-055`, qui
   suppose ce modèle. Tranche ultérieure, `docs/SPEC-mail-subsystem.md` §16.
3. **La résolution du champ `contact`** — remplacer, dans la saisie du formulaire, le refus d'un
   UUID opaque par une clé vers un contact du même workspace (`CRM-036`, §6.5). Tranche ultérieure.
4. **Les écrans** — carnet de contacts, fiche d'organisation, rattachement d'un contact à une
   affaire depuis la route de détail. Tranche ultérieure, `docs/DESIGN_SYSTEM.md`.

Ce document spécifie **intégralement la tranche 1** et **nomme** les tranches suivantes sans les
détailler : leur contrat sera écrit, mesuré et committé au moment où elles seront reprises.

---

## 2. Modèle de données — tranche 1

### 2.1 `organizations`

| Colonne | Type | Contraintes |
|---|---|---|
| `id` | `uuid` | clé primaire, défaut `gen_random_uuid()` |
| `workspace_id` | `uuid` | non nul, FK `workspaces(id)` `on delete cascade` |
| `name` | `text` | non nul, `btrim(name) <> ''` |
| `domain` | `text` | facultatif ; **unique par workspace sur `lower(domain)`** ; forme validée |
| `website` | `text` | facultatif ; forme validée lorsqu'il est présent |
| `created_at` | `timestamptz` | non nul, défaut `now()` |
| `updated_at` | `timestamptz` | non nul, défaut `now()`, maintenu par trigger |

- **`domain` est le pivot du rapprochement des emails** (`docs/SCHEMA.md` §6) : deux organisations
  d'un même workspace ne peuvent pas revendiquer le même domaine. L'unicité est **partielle** —
  `WHERE domain IS NOT NULL` —, une organisation pouvant naître sans domaine connu.
- **La base stocke la forme canonique**, en minuscules, conformément à RFC 1035 : la contrainte
  de forme refuse les majuscules à l'écriture (`23514`), et `lower(domain)` dans l'index unique
  reste une défense en profondeur. Résultat : l'insensibilité à la casse est éprouvée à
  l'écriture (refus de forme) et à l'unicité (refus de doublon), plutôt que par une normalisation
  silencieuse qui aurait rendu la donnée non fidèle à ce que le client a envoyé.
- Une contrainte `unique (id, workspace_id)` est ajoutée : elle ne change aucun comportement,
  `id` étant déjà la clé primaire, mais elle rend **exprimable** la clé étrangère composite de
  `contacts` (§2.2), qui garantit qu'un contact ne se rattache qu'à une organisation de son
  workspace.

### 2.2 `contacts`

| Colonne | Type | Contraintes |
|---|---|---|
| `id` | `uuid` | clé primaire, défaut `gen_random_uuid()` |
| `workspace_id` | `uuid` | non nul, FK `workspaces(id)` `on delete cascade` |
| `organization_id` | `uuid` | facultatif ; FK **composite** `(organization_id, workspace_id)` → `organizations(id, workspace_id)` `on delete set null` |
| `full_name` | `text` | non nul, `btrim(full_name) <> ''` |
| `email` | `text` | facultatif ; **unique par workspace sur `lower(email)`** ; forme validée |
| `phone` | `text` | facultatif |
| `role_title` | `text` | facultatif ; fonction de la personne (« Directeur achats ») |
| `source` | `text` | non nul, défaut `manual`, `CHECK (source IN ('manual','email','import'))` |
| `created_at` | `timestamptz` | non nul, défaut `now()` |
| `updated_at` | `timestamptz` | non nul, défaut `now()`, maintenu par trigger |

- **`email` est facultatif mais discriminant** : un contact peut n'être qu'un nom et un téléphone.
  L'unicité `(workspace_id, lower(email))` est donc **partielle** — `WHERE email IS NOT NULL` —,
  sans quoi deux contacts sans email entreraient en collision sur `NULL`. La casse est ignorée,
  comme le classement des emails l'exige (`docs/SPEC-mail-subsystem.md` §16).
- **`full_name` est non nul** : un contact sans nom n'est pas exploitable dans une fiche ni dans une
  suggestion. C'est le seul écart au tableau de `docs/SCHEMA.md` §6, qui ne marquait aucune colonne
  `non nul` ; il est nommé ici plutôt que tu, et resserre sans contredire.
- **La FK vers `organizations` est composite** : `(organization_id, workspace_id)`. Rattacher un
  contact à une organisation d'un **autre** workspace serait une fuite de cloisonnement ; la clé
  composite l'interdit **structurellement**, sans trigger — même patron que `form_field_rules`
  (`CRM-035`). `on delete set null` : supprimer une organisation n'emporte pas ses contacts, elle
  les **détache**.
- Une contrainte `unique (id, workspace_id)` est ajoutée pour la même raison qu'au §2.1 : elle rend
  exprimable la clé composite de `card_contacts` (§2.3).

### 2.3 `card_contacts`

Association plusieurs-à-plusieurs entre une affaire et un contact, avec un rôle facultatif.

| Colonne | Type | Contraintes |
|---|---|---|
| `workspace_id` | `uuid` | non nul |
| `card_id` | `uuid` | non nul ; FK **composite** `(card_id, workspace_id)` → `cards(id, workspace_id)` `on delete cascade` |
| `contact_id` | `uuid` | non nul ; FK **composite** `(contact_id, workspace_id)` → `contacts(id, workspace_id)` `on delete cascade` |
| `role` | `text` | facultatif ; `btrim(role) <> ''` lorsqu'il est présent |
| `created_at` | `timestamptz` | non nul, défaut `now()` |
| | | clé primaire `(card_id, contact_id)` |

- **Les deux clés étrangères composites portent `workspace_id`**, si bien qu'une affaire et un
  contact liés partagent **forcément** leur workspace : la mesure a montré que `cards` porte déjà
  `workspace_id` et une contrainte `unique (id, workspace_id)`, ce qui rend cette garantie
  structurelle et dispense d'un trigger de cohérence. C'est ce qui donnera sa base à la règle 3 du
  classement, qui compte les cards **actives** d'un contact.
- **Le rôle est libre** : `docs/SCHEMA.md` §6 l'illustre par `decideur`, `prescripteur`,
  `technique`, « … » — une énumération fermée deviendrait fausse au premier besoin métier. La
  contrainte porte sur la **forme** (non vide), pas sur une liste. `NULL` est licite : un contact
  peut être rattaché sans rôle nommé.
- **La clé primaire `(card_id, contact_id)`** interdit qu'un même contact apparaisse deux fois sur
  une affaire. Un contact peut être lié à plusieurs affaires, et une affaire à plusieurs contacts.

---

## 3. Autorisations — tranche 1

Règle de `docs/SPEC-permissions-rls.md` §4, rendue opposable **en base** et non dans un écran
(`CLAUDE.md` §10) :

| Table | Lecture | Écriture (`INSERT`, `UPDATE`, `DELETE`) |
|---|---|---|
| `organizations` | membres du workspace (`app.is_workspace_member`) | `business_developer` **et** `admin` |
| `contacts` | membres du workspace | `business_developer` **et** `admin` |
| `card_contacts` | lecture de la card portée (`app.can_read_card(card_id)`) | écriture sur la card (`app.can_write_card(card_id)`) **et** droit d'écriture des contacts |

- **L'écriture des contacts et des organisations est ouverte au `business_developer`**, à la
  différence des tracks, channels et workflows, réservés à l'`admin` : un contact est le matériau
  quotidien d'un commercial, non une décision de structure (`docs/SPEC-permissions-rls.md` §2.1).
  Le prédicat est `app.workspace_role(workspace_id) IN ('business_developer','admin')` — la fonction
  `app.workspace_role`, livrée par `CRM-010`, rend le rôle de l'appelant.
- **`card_contacts` compose deux droits** : voir l'affaire (sa card) et pouvoir écrire dessus, car
  rattacher un contact enrichit l'affaire ; le droit d'écriture des contacts n'est **pas** exigé en
  plus pour le rattachement, un `business_developer` fermé sur un track ne devant pas rattacher un
  contact à une affaire qu'il ne peut pas écrire. Le cloisonnement du contact lui-même est déjà
  tenu par la clé composite. La lecture d'un rattachement suit la lecture de la card.
- **La lecture est accordée à `anon` comme à `authenticated`** sur les trois tables : sans jeton,
  `auth.uid()` est nul, les prédicats rendent faux, et le refus se manifeste par **zéro ligne**,
  jamais par une erreur de privilège (`docs/SPEC-permissions-rls.md` §7, dernier paragraphe).
- **Aucune suppression physique n'est masquée** : `organizations` et `contacts` n'exposent **pas**
  d'archivage dans cette tranche — la question du cycle de vie d'un contact (fusion, doublons,
  purge RGPD) est nommée au §6 et laissée à l'arbitrage. `DELETE` est exposé, réservé à l'écriture,
  et une organisation supprimée **détache** ses contacts (`on delete set null`) plutôt que de les
  emporter — c'est la mesure de sûreté contre la perte silencieuse d'enfants qu'a imposée `CRM-077`.

Les privilèges sont posés **explicitement** (`revoke all` puis `grant`), comme sur toute table du
projet, pour ne pas dépendre des défauts de l'image Supabase (`CRM-036`, décision 134).

---

## 4. Contrat d'API — tranche 1

Mesuré sur la pile réelle avec les jetons réels des trois profils seedés. `A` = administratrice
(`…011`), `B` = business developer (`…012`), `V` = lectrice/viewer (`…013`), `∅` = anonyme.

| # | Requête | Acteur | Attendu |
|---|---|---|---|
| a | `POST /organizations` `{name:"…"}` | A | `201`, ligne créée |
| b | `POST /organizations` | B | `201` — le bizdev crée |
| c | `POST /organizations` | V | `403` / `42501` — la lectrice ne crée pas |
| d | `POST /organizations` | ∅ | `401` — appelant sans rôle |
| e | `POST /organizations` deux fois, même `domain` | A | second : `409` / `23505` unicité par workspace |
| f | `POST /contacts` `{full_name,email}` | B | `201` |
| g | `POST /contacts` `{full_name}` sans email | B | `201` — email facultatif |
| h | `POST /contacts` deux fois, même `email` (casse différente) | A | second : `409` / `23505` — unicité insensible à la casse |
| i | `POST /contacts` `{full_name:"  "}` | A | `4xx` — `full_name` vide refusé par la contrainte |
| j | `POST /contacts` `{organization_id:<org d'un AUTRE workspace>}` | A | `409` / `23503` — la FK composite refuse |
| k | `GET /contacts` | V | `200` — la lectrice **lit** les contacts de son workspace |
| l | `GET /contacts` | ∅ | `200` et `[]` — zéro ligne, jamais une erreur |
| m | `POST /card_contacts` `{card_id,contact_id}` | B | `201`, rattachement créé |
| n | `POST /card_contacts` vers une card fermée à V | V | `403` / `42501` (`can_write_card`) |
| o | `POST /card_contacts` deux fois, même paire | A | second : `409` / `23505` — clé primaire |
| p | `DELETE /contacts?id=eq.<x>` | A | `204`, et le `card_contacts` qui le portait a disparu (cascade) |

Chaque refus est **relu** pour constater la ligne inchangée : une réponse d'erreur ne prouve pas
qu'aucune écriture n'a eu lieu.

---

## 5. Seed — tranche 1

`docs/SPEC-seed.md` gagnera une section « Contacts et organisations ». Le seed pose, **par la
vraie API REST** avec le jeton réel d'un profil autorisé (jamais en SQL direct, `docs/SPEC-seed.md`
§3) :

- **deux organisations** : une avec domaine (`sogexia.example` — pivot du rapprochement futur), une
  sans domaine, pour exercer l'unicité partielle ;
- **trois contacts** : un rattaché à une organisation avec email, un sans organisation avec email,
  un sans email (nom et téléphone seuls) — pour couvrir l'unicité partielle sur `email`,
  l'organisation facultative et la source par défaut ;
- **deux rattachements** `card_contacts` sur des affaires seedées existantes, dont **un contact
  rattaché à exactement une card active** — l'état précis que la règle 3 du classement lira, pour
  que la tranche 2 ait sa donnée de démonstration dès qu'elle sera reprise ;
- **identifiants stables** préfixés `5eed…`, bloc réservé aux contacts, pour que les preuves et les
  futures captures s'y accrochent.

Le seed **converge** (rejouable sans doublon) et **vérifie** ses comptes, comme le reste du fichier.

---

## 6. Points laissés à l'arbitrage du responsable

Nommés plutôt que tranchés ici (`CLAUDE.md` §1, §26) :

1. **Cycle de vie d'un contact** — archivage, fusion de doublons, purge RGPD. La tranche 1 expose
   la suppression physique réservée à l'écriture ; savoir s'il faut un archivage réversible comme
   pour les tracks relève d'une décision produit.
2. **Rapprochement automatique email → organisation par domaine.** `docs/SCHEMA.md` §6 en fait le
   rôle de `domain`, mais l'automatisme (créer ou rattacher une organisation à la réception d'un
   email d'un domaine connu) touche l'ingestion et mérite son propre arbitrage.
3. **Rôles de `card_contacts` normalisés.** La tranche 1 laisse le rôle libre ; une éventuelle liste
   contrôlée (`decideur`, `prescripteur`, …) devra être décidée avec le vocabulaire métier.

---

## 7. Definition of Done — tranche 1

- migration `organizations`, `contacts`, `card_contacts` avec contraintes, RLS et privilèges
  explicites, idempotente et rejouable ;
- suite pgTAP dédiée : forme des trois tables, contraintes de valeur, unicités partielles, FK
  composites dans les deux sens, RLS activée, politiques nommées, privilèges par rôle ;
- preuve d'API dédiée rejouant les lignes du §4 avec les jetons réels des trois profils ;
- seed enrichi et convergent (§5) ;
- `docs/SCHEMA.md`, `docs/SPEC-permissions-rls.md`, `docs/DAT.md`, `docs/PROD_MIGRATIONS.md`,
  `docs/SPEC-seed.md`, `README.md`, `CHANGELOG.md` mis à jour dans le même changement ;
- commentaires `@spec` / `@verifies` sur chaque fichier.

Les tranches 2 à 4 restent dues ; l'unité demeure `[~]` tant qu'elles ne sont pas livrées.
