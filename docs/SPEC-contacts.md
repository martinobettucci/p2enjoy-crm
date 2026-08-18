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

---

## 8. Tranche 2 — La règle 3 du classement (suggestion par expéditeur connu)

Contrat écrit **avant toute ligne de code** (`CLAUDE.md` §5, `docs/CloudWorker.md` §3.2), après
mesure sur la pile réelle seedée le 2026-08-18 : les trois contacts du seed relevés en base, leurs
emails et leurs rattachements confirmés, les colonnes de `mail_messages` inventoriées (aucune
colonne de suggestion), et la version courante de `classer_message_automatiquement`
(migration `0025`, non redéfinie par `0028`) lue ligne à ligne.

Références amont, qui **précèdent** ce document et le contraignent :

- `docs/SPEC-mail-subsystem.md` §4.4 et §16.2, règle 3 : « l'expéditeur est un contact rattaché à
  **exactement une** card active → **suggestion**, ne classe pas » ;
- `docs/SPEC-mail-subsystem.md` §16.1, qui **désactivait** la règle 3 faute de contacts et prévoyait
  sa levée « le jour où `CRM-060` livre les contacts » — ce jour est arrivé (tranche 1) ;
- `CRM-055` (backlog), dont l'assertion pgTAP et le harnais `verify-mail-classement.sh` **figent**
  l'absence de la règle 3 par une garde qui devient rouge dès que les tables de contacts existent —
  cette tranche fait **tomber** cette garde en la remplaçant par une preuve de la règle active.

### 8.1 Ce que la règle 3 fait, et ce qu'elle ne fait PAS

La règle 3 **suggère**, elle **ne classe pas**. Classer automatiquement sur la seule foi d'un
expéditeur produirait des rattachements faux et difficiles à détecter (`docs/SPEC-mail-subsystem.md`
§4.4). Concrètement, pour un message que les règles 1 et 2 n'ont pas classé :

- si l'expéditeur est un **contact** du workspace (reconnu à son **email**) rattaché à **exactement
  une** card **active** (ni archivée, ni en corbeille), cette card devient une **suggestion**
  persistée sur le message ;
- le message **reste non classé** : `classification` demeure `unclassified`, `card_id` demeure nul,
  aucun `card_event` n'est écrit, aucun `mail_attachments.card_id` n'est recopié. La chaîne rend
  toujours « non classé » (règle 4) ;
- la suggestion est un **indice de tri** destiné à l'inbox (`CRM-057`) : un membre pourra
  l'accepter d'un geste, mais l'acceptation passe par `classify_message`, qui exige **les deux
  droits** (voir le message et écrire la card, §18.2). La suggestion n'accorde donc **aucun** droit
  et ne contourne **aucun** contrôle : au pire elle propose une card que le membre ne peut pas
  écrire, et le geste échouera alors comme tout classement manuel non autorisé.

### 8.2 La place dans la chaîne, et pourquoi « exactement une »

La chaîne du §16.2 s'arrête à la **première règle satisfaite**, ce qui la rend déterministe. La
règle 3 est évaluée **après** les règles 1 (adresse de card) et 2 (filiation), et **avant** la
règle 4 (non classé). Elle n'est donc atteinte que lorsque `v_card is null`.

**« Exactement une » card active est la condition, et l'ambiguïté est du côté des cards, non des
contacts** : l'unicité partielle `(workspace_id, lower(email))` de `contacts` (§2.2) garantit qu'un
email désigne **au plus un** contact dans le workspace. Le nombre à compter est donc celui des cards
**actives** rattachées à ce contact :

- **zéro** card active → aucune suggestion : la règle ne propose rien plutôt que d'inventer ;
- **une** card active → cette card est suggérée ;
- **deux ou plus** cards actives → aucune suggestion : proposer l'une d'elles au hasard serait pire
  que se taire ; le tri reste manuel.

Une card **archivée ou en corbeille** ne compte pas, exactement comme la règle 1 refuse de classer
dans une card rangée (§16.2) : suggérer un dossier fermé y ramènerait du courrier.

### 8.3 Persistance de la suggestion — colonnes ajoutées à `mail_messages`

| Colonne | Type | Contraintes |
|---|---|---|
| `suggested_card_id` | `uuid` | facultatif ; FK `cards(id)` `on delete set null` |
| `suggested_at` | `timestamptz` | facultatif ; horodate le calcul de la suggestion |

- **`suggested_card_id` est indépendant de `card_id`** : le premier est un indice, le second un fait.
  L'invariant `mail_messages_classement_coherent` (`(classification='unclassified') = (card_id is
  null)`) n'est pas touché — une suggestion vit sur un message non classé, `card_id` nul.
- **`on delete set null`** : supprimer la card suggérée efface l'indice sans emporter le message.
- **La suggestion est un instantané de la relève**, comme le classement automatique des règles 1 et
  2 : elle est calculée à l'ingestion et n'est **pas** recalculée si l'état des contacts ou des
  rattachements change ensuite. C'est cohérent avec le reste de la chaîne, et nommé ici plutôt que
  laissé à la surprise ; un recalcul à la lecture appartiendrait à l'écran (`CRM-057`).
- **Aucune nouvelle politique RLS** : `suggested_card_id` est une colonne de la ligne du message,
  visible par qui voit déjà le message (politique `mail_messages_lecture`, `CRM-057` §18.1). La
  résolution du **titre** de la card suggérée reste soumise à la RLS de `cards`.

### 8.4 Reconnaissance de l'expéditeur

L'appariement se fait sur l'**email** stocké dans `mail_messages.from_address`, comparé à
`contacts.email` du **même workspace**, **insensible à la casse** et après `btrim` :
`lower(btrim(from_address)) = lower(contacts.email)`, avec `contacts.email IS NOT NULL`.

- **Le workspace borne l'appariement** : un contact d'un autre workspace portant le même email ne
  peut jamais être suggéré (cloisonnement).
- **Un contact sans email** (Élise Fabre, seed) n'est jamais apparié : `email` nul ne peut égaler
  aucune adresse.
- **La forme de `from_address`** est celle que la relève a stockée. Un `from_address` contenant un
  nom d'affichage (`"Léo" <leo@…>`) ne s'apparie pas ; la relève d'ingestion stocke l'adresse nue
  (mesuré : le seed et `e2e/api/classement.spec.ts` posent des adresses nues). Cet écart est
  **nommé** plutôt que masqué par une extraction fragile ; l'améliorer relèverait de l'ingestion.

### 8.5 Contrat de comportement — mesuré sur le seed

Données du seed (mesurées le 2026-08-18) : Léo Marchand `leo.marchand@sogexia.example` rattaché à la
seule card active `…0000c2` (« Migration ERP Sogexia ») ; Sophie Dupont `sophie@dupont.test`
rattachée à la seule card active `…0000c4` ; Élise Fabre sans email.

| # | Message non classé (règles 1 et 2 muettes), expéditeur | Attendu |
|---|---|---|
| a | `leo.marchand@sogexia.example` | `suggested_card_id = …0000c2`, message toujours `unclassified`, `card_id` nul, aucun `card_event` |
| b | `LEO.MARCHAND@Sogexia.Example` | même suggestion : la casse est ignorée |
| c | `inconnu@nulle-part.test` (aucun contact) | aucune suggestion (`suggested_card_id` nul) |
| d | contact rattaché à **zéro** card active (rattachement retiré, ou card archivée) | aucune suggestion |
| e | contact rattaché à **deux** cards actives | aucune suggestion (ambiguïté) |
| f | expéditeur d'un **autre** workspace portant un email de contact | aucune suggestion (cloisonnement) |

Et deux cas où la règle 3 **n'est pas atteinte**, la chaîne s'étant arrêtée avant :

| # | Message dont | Attendu |
|---|---|---|
| g | une **adresse de card** figure dans les destinataires (règle 1) et l'expéditeur est un contact | `classification = 'auto'`, `card_id` = la card de la règle 1, `suggested_card_id` **nul** — la règle 3 n'est pas évaluée |
| h | la **filiation** désigne une card déjà classée (règle 2) et l'expéditeur est un contact | classé par la règle 2, `suggested_card_id` **nul** |

### 8.6 Preuves exigées — tranche 2

| Niveau | Preuve |
|---|---|
| pgTAP | `supabase/tests/0044_regle3_suggestion.test.sql` : présence des deux colonnes ; les cas a à h du §8.5 sur des états construits dans la transaction de test ; l'invariant de classement inchangé ; `classer_message_automatiquement` reste réservée à `service_role` |
| API | `e2e/api/classement.spec.ts` (étendu) : via la RPC de service, un message de Léo reçoit la suggestion `…0000c2` sans être classé ; un message d'un expéditeur inconnu n'en reçoit aucune ; un message portant une adresse de card est classé `auto` **sans** suggestion. Chaque assertion **relit la ligne** (décision 70) |
| Harnais | `scripts/verify-mail-classement.sh` : la garde de désactivation (§16.1) est **révisée**, non retirée — elle prouve désormais la règle 3 **active** avec son témoin (expéditeur inconnu → aucune suggestion), non complaisante |
| Visible | La preuve d'interface de la suggestion (l'inbox montrant « message non classé et sa suggestion », §16 tableau) attend l'écran de l'inbox (`CRM-057`), non livré. L'absence est **nommée**, non compensée par une preuve de substitution |

### 8.7 Definition of Done — tranche 2

- migration `0046` : colonnes `suggested_card_id`, `suggested_at` sur `mail_messages` et
  `classer_message_automatiquement` enrichie de la règle 3, idempotente et rejouable ;
- suite pgTAP `0044` couvrant les cas a à h du §8.5 ;
- preuve d'API dédiée étendue avec les jetons réels ;
- harnais `verify-mail-classement.sh` révisé, non complaisant, avec témoin ;
- types régénérés (`webapp/src/lib/database.types.ts`) dans le même changement ;
- `docs/SCHEMA.md`, `docs/SPEC-mail-subsystem.md` §16, `docs/PROD_MIGRATIONS.md` (migration 46),
  `CHANGELOG.md` mis à jour dans le même changement ;
- commentaires `@spec` / `@verifies` sur chaque fichier.

La tranche 2 livrée, l'unité `CRM-060` **demeure `[~]`** : les tranches 3 (résolution du champ
`contact`) et 4 (écrans) restent dues, et la preuve visible de la suggestion attend l'inbox.
