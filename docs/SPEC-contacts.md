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
   UUID opaque par une clé vers un contact du même workspace (`CRM-036`, §6.5). **Spécifiée au §9**,
   et le champ `user` y est résolu dans le même geste, l'arbitrage de la décision 295 les traitant
   ensemble.
4. **Les écrans** — carnet de contacts, fiche d'organisation, rattachement d'un contact à une
   affaire depuis la route de détail. Tranche ultérieure, `docs/DESIGN_SYSTEM.md`.

Ce document a spécifié **intégralement la tranche 1** d'emblée, puis a reçu le contrat de la
tranche 2 au §8 et celui de la tranche 3 au §9, chacun écrit, mesuré et committé au moment de sa
reprise. La tranche 4 reste **nommée** sans être détaillée.

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
4. **Références mortes après suppression d'un contact** (ajouté par la tranche 3, §9.4). La
   résolution des champs `contact` et `user` est vérifiée **à l'écriture** ; `value` étant un
   `jsonb`, aucune clé étrangère n'y est possible. Supprimer un contact laisse donc en place les
   valeurs qui le désignaient. Les balayer par un trigger `AFTER DELETE`, ou remplacer le `jsonb`
   par une table de liaison, sont deux réponses possibles dont le coût et les effets de bord
   dépassent l'unité : la question est **nommée**, non tranchée.

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

### 8.8 Sous-tranche 2 bis — La SURFACE de la suggestion, dans l'inbox

Contrat écrit **avant toute ligne de code** (`CLAUDE.md` §5, `docs/CloudWorker.md` §3.2), après
mesure sur la pile réelle démarrée et seedée le 2026-08-20. Chaque paragraphe intitulé « MESURÉ »
rapporte une sortie obtenue sur cet hôte, jamais un souvenir.

**Le motif de cette sous-tranche est écrit depuis le premier jour de la tranche 2.** Le §8.6
range la preuve visible de la suggestion dans une case restée vide — « elle attend l'écran de
l'inbox (`CRM-057`), non livré » —, et `docs/SPEC-mail-subsystem.md` §16.1 répète l'écart : « Reste
non livré : l'écran qui MONTRE la suggestion ». **L'inbox est livrée depuis le 2026-08-11.** La
condition est donc tombée, et elle tombe par **livraison**, jamais par contournement.
`docs/DESIGN_SYSTEM.md` §5.4 porte d'ailleurs la règle depuis `CRM-000` : « un message non classé
affiche l'action *Classer dans une card* **et, le cas échéant, la suggestion proposée par le
classement assisté, toujours présentée comme une suggestion à confirmer** ». Rien de tout cela
n'était rendu.

**MESURÉ, l'état du produit avant cette sous-tranche.** `webapp/src/app/RouteInbox.tsx` ne cite
jamais `suggested_card_id` ; `COLONNES_LISTE` et `COLONNES_MESSAGE` de `webapp/src/lib/inbox.ts` ne
la demandent pas ; et les trois messages du seed n'en portent aucune :

```
select from_address, classification, suggested_card_id from public.mail_messages;
 bizdev@p2enjoy.test | auto         | (nul)
 bizdev@p2enjoy.test | unclassified | (nul)
 bizdev@p2enjoy.test | auto         | (nul)
```

La règle 3 est donc **livrée, prouvée en base, et invisible** : aucun écran ne la montre, et aucune
donnée de démonstration ne la déclenche. Les deux manques se tiennent, et cette sous-tranche les
lève **ensemble** — une surface sans donnée n'aurait aucune capture, et une donnée sans surface
n'aurait aucun lecteur.

#### 8.8.1 Ce que la sous-tranche livre, et ce qu'elle ne livre pas

**Livré :**

- le **bloc de suggestion** dans le panneau de lecture de l'inbox, sur un message non classé qui en
  porte une : l'affaire nommée, la règle écrite en toutes lettres, et **un geste qui l'accepte** ;
- la colonne `suggested_card_id` **demandée** par la lecture d'un message — et elle **seule** ;
- la **boîte du correspondant de démonstration** — un principal Stalwart sur un troisième domaine,
  posé par le provisionnement existant (`docs/SPEC-mail-subsystem.md` §11.4) ;
- le **quatrième message du seed**, réellement soumis depuis cette boîte et réellement relevé, qui
  arrive non classé **et suggéré** (`docs/SPEC-seed.md` §2.19).

**Non livré, et nommé plutôt que suggéré :**

- **aucun refus de suggestion.** Rien dans le §8 ne décrit un geste qui écarterait un indice, et
  l'inventer obligerait à décider ce que devient la colonne — effacée, ou marquée refusée, ce qui
  serait une donnée nouvelle. La suggestion s'accepte ou s'ignore ;
- **aucun recalcul.** `suggested_at` est un instantané de la relève (§8.3), et cette surface ne le
  rafraîchit pas plus qu'elle ne le montre (§8.8.5) ;
- **aucune suggestion dans la LISTE ni dans l'arborescence.** Le §5.4 bis de
  `docs/DESIGN_SYSTEM.md` tient une densité que cette sous-tranche ne défait pas : une ligne de
  liste porte un expéditeur, un objet et une date. L'indice se lit là où l'on décide, c'est-à-dire
  dans le message ouvert — le même raisonnement que le geste de sommeil (§5.3 septies) ;
- **aucun changement de règle backend.** `classify_message` est celle de `CRM-055`, révisée par
  `CRM-057` (§18.2) et **inchangée ici** : accepter une suggestion est un classement manuel comme
  un autre, avec ses deux droits et ses refus.

#### 8.8.2 Où le bloc s'ancre — dans le pied du panneau de lecture, AU-DESSUS de la commande manuelle

Le pied du panneau de lecture porte déjà deux visages exclusifs (`CRM-057`, `CRM-058`) : sur un
message **classé**, la pilule de l'affaire et le formulaire de réponse ; sur un message **non
classé**, la phrase « Ce message n'est rattaché à aucune affaire » et la commande « Classer dans une
card ». Le bloc de suggestion s'insère dans le **second** visage, entre la phrase et la commande.

**Au-dessus de la commande manuelle, et l'ordre porte un sens** : la suggestion est le chemin court,
la commande manuelle est le chemin qui marche toujours. Placer l'indice après la commande le ferait
lire une fois la liste déroulée, c'est-à-dire trop tard.

**Il ne remplace jamais la commande manuelle.** Une suggestion peut désigner la mauvaise affaire —
un contact rattaché à une seule affaire *active* n'en est pas moins le contact de plusieurs
dossiers dans le temps —, et un écran qui n'offrirait que l'indice enfermerait l'utilisateur dans
un choix qu'il n'a pas fait.

#### 8.8.3 Ce que l'écran lit — mesuré sur la pile réelle

Deux lectures, et **aucune nouvelle forme de requête** : les deux existent déjà et sont reprises
telles quelles.

1. **Les deux colonnes rejoignent `COLONNES_MESSAGE`**, la liste des colonnes du panneau de
   lecture. Elles ne rejoignent **pas** `COLONNES_LISTE` : la liste ne montre aucune suggestion
   (§8.8.1), et rapporter deux colonnes par message pour n'en afficher aucune contredirait le motif
   écrit en tête de cette constante.

   MESURÉ avec le jeton réel de Camille Aubert (`admin`), sur le message de mesure du 2026-08-20 :

   ```
   GET /rest/v1/mail_messages?select=id,classification,card_id,suggested_card_id,suggested_at
   → 200, [{ "classification": "unclassified", "card_id": null,
             "suggested_card_id": "5eed0000-0000-4000-8000-0000000000c2",
             "suggested_at": "2026-08-20T04:20:01.927001+00:00" }]
   ```

   Les mêmes appels avec les jetons de Driss Lemoine (`business_developer`) et de Farida Nowak
   (`viewer`) rendent `200` et **zéro ligne** : un message non classé de la boîte système n'est
   lisible que des administrateurs (`docs/SPEC-mail-subsystem.md` §18.1). L'écran ne calcule rien de
   cela — il lit ce que la RLS consent.

2. **L'affaire suggérée est résolue par `lireCheminCard`**, la fonction que la pilule du message
   classé emploie déjà (`CRM-057`). Elle rend le **titre** et l'**adresse** de l'affaire, ou `null`
   lorsque l'affaire n'est pas lisible. MESURÉ, avec le jeton de Camille :

   ```
   GET /rest/v1/cards?select=id,title,channel_id&id=eq.5eed…00c2
   → 200, [{ "title": "Migration ERP Sogexia", "channel_id": "5eed…0032" }]
   ```

**Aucune requête n'est faite quand il n'y a rien à résoudre** : un message classé, ou un message non
classé sans suggestion, ne déclenche aucune lecture supplémentaire. C'est la règle du §13.4 —
« jamais sur une fiche qui n'en a pas besoin » — tenue sans changement.

**`suggested_at` N'EST PAS DEMANDÉE, ET C'EST UNE RÈGLE PLUTÔT QU'UN OUBLI — point précisé à la
LIVRAISON.** La rédaction d'avant-code de cette sous-tranche annonçait « les deux colonnes » ;
écrire la surface a montré que la seconde n'a **aucun consommateur** : le §8.8.5 interdit de
l'afficher, et rien d'autre ne s'en sert. Demander une colonne qu'aucune surface ne rend laisserait
croire qu'elle sert, et le premier lecteur du code chercherait où. Le contrat est donc plus étroit
que ce qu'il annonçait : **une** colonne, et le §8.8.1 est corrigé en conséquence.

#### 8.8.4 Les quatre états du bloc, et aucun ne se confond avec un autre

| # | Situation | Ce que l'écran rend |
|---|---|---|
| a | Message **classé** | Rien. Le bloc appartient au visage « non classé » du pied (§8.8.2) |
| b | Message non classé, **sans** suggestion | Rien. C'est le cas ordinaire, et un bloc « aucune suggestion » serait du bruit à chaque message |
| c | Message non classé, suggestion **lisible** | Le bloc entier : l'affaire nommée et adressable, la règle écrite, le geste |
| d | Message non classé, suggestion **illisible** | Rien |

**Le cas d est le seul qui demande un motif, et il est de confidentialité.** Lorsque l'affaire
suggérée n'est pas lisible par l'appelant, `lireCheminCard` rend `null` : l'écran **ne rend rien**,
et n'écrit surtout pas « une affaire vous est suggérée mais vous ne pouvez pas la voir ». Cette
phrase divulguerait l'existence d'une affaire que la RLS ferme — exactement ce que le §5.29 de
`docs/DESIGN_SYSTEM.md` interdit au canevas d'objectifs pour un bloc masqué, et ce que
`docs/SPEC-costs.md` §4.5 tient pour un budget masqué. Le chemin manuel reste offert, et il est le
même pour tout le monde.

**Le cas b n'est pas un état vide au sens du §5.8**, et c'est pourquoi il ne porte aucune mention :
la règle 3 ne se déclenche que sur un expéditeur connu rattaché à exactement une affaire active
(§8.1). L'absence d'indice est la situation NORMALE d'une boîte de tri, pas un manque.

#### 8.8.5 Ce que le bloc écrit, mot pour mot, et ce qu'il tait

- **L'affaire est NOMMÉE et ADRESSABLE.** Son titre est un lien vers sa fiche, comme la pilule du
  message classé (`docs/DESIGN_SYSTEM.md` §5.4). Un indice qui ne nommerait pas sa cible ne serait
  pas un indice, et un nom sans lien obligerait à chercher l'affaire ailleurs pour la vérifier —
  or vérifier est précisément ce que « suggestion à confirmer » demande.

- **La règle est écrite en toutes lettres** : « L'expéditeur est un contact rattaché à cette
  affaire. » C'est l'énoncé de la règle 3 (§8.1), et non une mesure refaite à l'écran : la colonne
  n'est écrite que par `classer_message_automatiquement`, et elle ne peut pas signifier autre chose.
  Sans cette phrase, l'utilisateur lirait un nom d'affaire sans savoir d'où il sort — et un indice
  dont on ignore l'origine ne se confirme pas, il se subit.

- **`suggested_at` n'est PAS affichée.** Elle daterait l'**indice**, pas l'affaire, et un indice
  daté ferait chercher un mécanisme de rafraîchissement qui n'existe pas : la suggestion est un
  instantané de la relève et n'est jamais recalculée (§8.3). La question à laquelle l'utilisateur
  répond est « est-ce la bonne affaire ? », et c'est le **nom** qui y répond.

- **Aucun compte, aucun score, aucune probabilité.** La règle 3 n'en produit aucun : elle exige
  « exactement une » affaire active, donc l'indice est certain ou absent (§8.2). Afficher une
  confiance inventerait une nuance que la base ne porte pas.

#### 8.8.6 Le geste, et ses refus — aucun contrat nouveau

Accepter la suggestion appelle **`classify_message(p_message_id, p_card_id)`** avec l'affaire
suggérée, par la fonction `classerMessage` déjà employée par le formulaire manuel. Il n'y a donc
**aucun nouveau contrat d'API**, et c'est délibéré : un second chemin d'écriture divergerait du
premier au premier ajustement, et la garde des deux droits du §18.2 doit rester **une**.

Conséquences, toutes déjà écrites ailleurs et rappelées ici parce qu'elles gouvernent la surface :

- **la suggestion n'accorde aucun droit** (§8.1). Elle peut désigner une affaire que l'appelant
  n'a pas le droit d'écrire ; le geste échoue alors comme tout classement manuel non autorisé ;
- **les quatre refus sont ceux du dictionnaire FERMÉ existant** — `forbidden`,
  `card_indisponible`, `network`, `unknown` (`webapp/src/lib/inbox.ts`) —, et leurs quatre clés de
  traduction sont réemployées **sans en ajouter une cinquième**. Un même refus ne se formule pas de
  deux façons selon le bouton qui l'a demandé (`docs/DESIGN_SYSTEM.md` §5.3 sexies) ;
- **le refus s'écrit dans le bloc**, en `role="alert"`, près du geste qui l'a causé, et **le bloc
  reste rendu** : disparaître sur un refus retirerait le seul endroit où lire la cause ;
- **le succès relit exactement ce que le classement a changé** — les compteurs de l'arborescence,
  la liste des non classés d'où le message sort, et le message lui-même, qui porte désormais une
  affaire. C'est `apresClassement` de `CRM-057`, réemployée telle quelle : deux chemins de
  relecture divergeraient ;
- **la commande n'est jamais éteinte d'avance**, quel que soit le rôle (`docs/DESIGN_SYSTEM.md`
  §5.3, §5.13, §5.16, §5.21, sans exception). L'écran ne calcule aucun droit : il appuie et traduit
  le refus.

#### 8.8.7 Autorisations — l'écran n'en calcule aucune, et trois mesures le disent

| Profil | Voit le message non classé de la boîte système | Voit l'affaire suggérée | Conséquence à l'écran |
|---|---|---|---|
| Camille Aubert, `admin` | **oui** (administratrice du workspace, §18.1) | oui | Cas c : le bloc entier |
| Driss Lemoine, `business_developer` | **non** — `200`, zéro ligne | — | Le message n'est pas ouvrable : aucun bloc |
| Farida Nowak, `viewer` | **non** — `200`, zéro ligne | non (track fermé par un droit fin) | Aucun bloc |

Les trois lignes sont **MESURÉES** le 2026-08-20 avec les jetons réels obtenus par
`/auth/v1/token?grant_type=password`. Aucune n'est une décision d'écran : ce sont les politiques de
`mail_message_occurrences` et de `cards` qui les produisent, et la surface ne fait que rendre ce
qu'elle reçoit (`CLAUDE.md` §10).

#### 8.8.8 Le seed — un correspondant qui existe pour de bon

Sans donnée, cette surface n'a **aucune capture** et **aucun parcours** : le cas c ne se
produirait jamais. Le seed doit donc faire arriver un message qui déclenche la règle 3, et
`CLAUDE.md` §8 interdit de le forger — « un e-mail de démonstration doit être envoyé par le
véritable mécanisme d'envoi local ».

**L'obstacle est mesuré depuis `CRM-057`, et il est nommé au §2.19 de `docs/SPEC-seed.md`** : un
principal Stalwart n'expédie que depuis ses propres adresses, et le serveur refuse tout autre `From`
en `501 5.5.4 You are not allowed to send from this address.` Le seed s'était donc rabattu sur
Driss comme correspondant, ce qui suffisait aux règles 1, 2 et 4 — mais **pas** à la règle 3, qui
exige un expéditeur reconnu comme **contact** : l'adresse de Léo Marchand est
`leo.marchand@sogexia.example` (§5), et aucune boîte ne la portait.

**LE REMÈDE EST DE DONNER UNE BOÎTE AU CORRESPONDANT, ET IL EST MESURÉ, non supposé.** Le
2026-08-20, sur la pile réelle :

```
POST /api/principal {"type":"domain","name":"sogexia.example"}        → {"data":6}
POST /api/principal {"type":"individual",
                     "name":"leo.marchand@sogexia.example", …}        → {"data":7}
SMTP 587, login leo.marchand@sogexia.example, From: la même adresse    → acceptée
relève réelle du service mail-sync                                     → messages_new: 1
select … from mail_messages where rfc822_message_id = '<mesure-…>'
  → classification = unclassified, card_id = nul,
    suggested_card_id = 5eed0000-0000-4000-8000-0000000000c2,
    suggested_at = 2026-08-20 04:20:01.927001+00
```

La règle 3 s'est déclenchée **sans que rien ne soit forcé en base**, et elle a désigné l'affaire
« Migration ERP Sogexia » — exactement la seule affaire active de Léo (§5, garde du seed).

**Ce n'est pas un contournement de la mesure de `CRM-057`, c'est sa conséquence.** Le §2.19 écrit
« aucun correspondant extérieur n'existe sur cette pile » ; la réponse n'est pas de faire mentir le
`From`, c'est d'en **faire exister un**. Un serveur de développement qui héberge le domaine du
client simule ce que la production verra arriver de l'extérieur, et le message reste soumis par le
véritable chemin authentifié.

`sogexia.example` est sous le TLD `.example`, réservé par la RFC 2606 au même titre que `.test` :
il n'est pas routable, et la précaution du §11.4 de `docs/SPEC-mail-subsystem.md` est tenue.

#### 8.8.9 Contrat de comportement — cas a à j

Mesuré sur le seed du 2026-08-20, ou vérifiable sur lui.

| Cas | Situation | Attendu |
|---|---|---|
| a | Message classé ouvert | Aucun bloc de suggestion ; la pilule de l'affaire et le formulaire de réponse, inchangés |
| b | Message non classé **sans** suggestion — « Candidature spontanée » | Aucun bloc ; la phrase et la commande « Classer dans une card », inchangées |
| c | Message non classé **avec** suggestion lisible — le message de Léo Marchand | Le bloc : titre « Migration ERP Sogexia » en lien, la phrase de la règle, le geste |
| d | Suggestion dont l'affaire n'est pas lisible | Aucun bloc, aucune mention, aucun identifiant (§8.8.4) |
| e | Le geste est accepté | `classification` passe à `manual`, `card_id` vaut l'affaire suggérée, un `card_event` `mail_received` est écrit |
| f | Après le succès | Le message quitte « Non classés », les compteurs de l'arborescence baissent, le panneau montre la pilule de l'affaire |
| g | Le geste est refusé faute de droit d'écriture | La mention `inbox.classify.refus.forbidden`, le bloc **reste** rendu, rien n'a changé en base |
| h | Deux appuis consécutifs | Idempotent (§16.3) : aucun second événement, et le second appui n'a plus d'objet, le message étant classé |
| i | La commande manuelle reste offerte à côté du bloc | Oui, et elle propose **toutes** les affaires classables, y compris celle de la suggestion |
| j | `suggested_at` | N'apparaît nulle part à l'écran (§8.8.5) |

#### 8.8.10 Limites nommées — sous-tranche 2 bis

- **La suggestion ne se refuse pas** (§8.8.1). Un indice ignoré reste écrit sur la ligne, et il
  réapparaîtra au prochain affichage du même message. Le classer — dans l'affaire suggérée ou dans
  une autre — est le seul moyen de le faire disparaître, puisque la colonne ne vit que sur un
  message non classé (§8.3).
- **La suggestion n'est jamais recalculée.** Rattacher le contact à une seconde affaire après la
  relève ne rend pas l'indice faux à l'écran ; il reste ce qu'il était à la réception. C'est la
  règle du §8.3, et cette surface ne la change pas.
- **Un seul message du seed porte une suggestion.** Le cas d — suggestion illisible — n'est donc
  pas démontré par le seed, et il est éprouvé par un test unitaire plutôt que par une capture. Le
  construire dans le seed demanderait un contact rattaché à une affaire d'un track fermé à
  l'administratrice, or les droits fins du seed ne ferment aucun track à Camille (§2.11 de
  `docs/SPEC-seed.md`), et en inventer un déplacerait des compteurs figés par quatre harnais.
- **Le quatrième message ajoute une ligne aux compteurs de courrier**, et tous les contrôles qui
  comptent trois messages sont **révisés dans le même changement**, jamais contournés.
- **LE PARCOURS D'INTERFACE LAISSE UN ÉVÉNEMENT DE TIMELINE DERRIÈRE LUI, ET C'EST NOMMÉ.** Le
  scénario qui accepte la suggestion remet le message non classé par la clé de service — le seul
  chemin qui le puisse —, mais le `mail_received` écrit par `classify_message` **demeure** :
  MESURÉ le 2026-08-20, un `DELETE` sur `card_events` rend **403** même à `service_role`, garantie
  que `CRM-044` a posée délibérément. L'affaire suggérée garde donc un événement de plus par
  exécution. La dérive est bornée et tolérée par construction — les compteurs d'événements de
  `scripts/verify-seed-demo.sh` sont des **minorants**, seul le compte des `created` étant exact —,
  et elle est écrite ici plutôt que masquée par une affirmation de restauration qui serait fausse.
  Le même défaut existe dans `e2e/ui/inbox.spec.ts`, qui l'**affirme** pourtant : consigné en
  **INC-185**, non corrigé au passage (`CLAUDE.md` §3.1).

#### 8.8.11 Preuves exigées — sous-tranche 2 bis

| Niveau | Preuve |
|---|---|
| Vitest | `RouteInbox.test.tsx` étendu : les quatre états du §8.8.4, le geste accepté, le refus qui laisse le bloc rendu, l'absence de requête quand il n'y a rien à résoudre. `inbox.test.ts` : les deux colonnes demandées, et la projection de la suggestion |
| API | `e2e/api/classement.spec.ts` : avec les jetons réels, l'administratrice lit `suggested_card_id` sur le message du seed ; le `business_developer` et la `viewer` reçoivent zéro ligne |
| E2E `ui` | `e2e/ui/inbox.spec.ts` : le parcours complet **au clavier et à la souris** — ouvrir le message suggéré, lire l'affaire nommée, accepter d'un geste, constater que le message porte l'affaire et a quitté « Non classés » |
| Captures | Les **quatre paliers** — 390, 768, 1152, 1440 px — du panneau de lecture portant le bloc, produites **et observées** (`CLAUDE.md` §16) |
| Seed | Le quatrième message **réellement soumis et relevé**, et le seed **vérifie** la suggestion plutôt que de la supposer — comme il vérifie déjà le fil (§2.19) |
| Harnais | `scripts/verify-mail-classement.sh` et `scripts/verify-mail-infra.sh` révisés, non contournés : la surface et la donnée de démonstration entrent dans leur périmètre |

**LA PREUVE D'API NE CLASSE PAS, ET LE POINT EST RÉVISÉ PAR LA LIVRAISON.** La rédaction
d'avant-code demandait qu'elle « classe dans l'affaire suggérée ». Écrire les preuves a montré que
ce geste écrirait un `card_event` **permanent** sur une card de démonstration : `card_events` est
append-only, et un `DELETE` y rend **403** même à la clé de service (mesuré, INC-185). Or le
parcours d'interface prouve déjà ce classement de bout en bout, avec la session réelle d'une
administratrice — c'est le **même jeton** qui part dans les deux cas. Rejouer le geste au niveau
de l'API doublerait donc la dérive du seed sans rien apprendre. Le fichier écrit ce motif à
l'endroit du test, comme le faisait déjà le commentaire d'en-tête de son bloc « règle 3 ».

#### 8.8.12 Definition of Done — sous-tranche 2 bis

- le bloc rendu selon le §8.8.2 et le §8.8.5, avec ses quatre états ;
- la colonne `suggested_card_id` demandée par `COLONNES_MESSAGE`, et non par `COLONNES_LISTE` ;
  `suggested_at` n'est **pas** demandée (§8.8.3, dernier point) ;
- le geste appelant `classify_message` **sans nouveau contrat**, avec les quatre refus existants ;
- la boîte du correspondant posée par `stalwart/provision.sh` et relue par lui ;
- le quatrième message du seed, soumis et relevé pour de bon, avec sa garde de suggestion ;
- les preuves du §8.8.11 exécutées et vertes ;
- `docs/DESIGN_SYSTEM.md` §5.4 ter, `docs/SPEC-mail-subsystem.md` §11.4 et §16.1,
  `docs/SPEC-seed.md` §2.19, `docs/manual.md`, `README.md`, `CHANGELOG.md` mis à jour dans le même
  changement ;
- commentaires `@spec` / `@verifies` sur chaque fichier touché.

---

## 9. Tranche 3 — La résolution des champs `contact` et `user` du formulaire

Contrat écrit **avant toute ligne de code** (`CLAUDE.md` §5, `docs/CloudWorker.md` §3.2), après
mesure sur la pile réelle seedée le 2026-08-18 : comportement actuel du validateur constaté par
sondes en transaction sur PostgreSQL `17.6`, colonnes de `workspace_members` et de `profiles`
inventoriées, contacts et membres du seed relevés à la main.

Références amont, qui **précèdent** ce document et le contraignent :

- **`docs/JOURNAL.md`, décision 295 — l'arbitrage du responsable, cité mot pour mot** : « Une valeur
  `user` doit désigner un membre actif du workspace dès maintenant. Une valeur `contact` est refusée
  tant que `CRM-060` n'a pas livré la table ; cette unité remplacera le refus par une clé vers un
  contact du même workspace. Accepter un UUID opaque temporaire créerait une dette de données
  impossible à distinguer d'une référence valide. » C'est cette tranche qui l'exécute ;
- `docs/SPEC-form-composer.md` §6.5, qui laisse aujourd'hui les deux types valider la **forme** d'un
  `uuid` et **rien de plus**, et nomme l'écart `INC-053`, « arbitrage attendu » ;
- `docs/ARBITRAGES.md`, ligne `INC-053` : « `user` résolu maintenant ; `contact` refusé jusqu'à
  `CRM-060` » — porteur « reprise formulaires, `CRM-060` » ;
- `docs/SPEC-form-composer.md` §6.4 : la validation est un trigger `BEFORE INSERT OR UPDATE`,
  `SECURITY DEFINER`, `search_path` vide, dont le refus porte le jeton `invalid_field_value` et un
  `DETAIL` nommant la clé du champ.

### 9.1 Ce que la tranche livre, et ce qu'elle ne livre pas

Elle livre **la règle opposable en base** (`CLAUDE.md` §10) : le validateur de
`card_field_values` **résout** désormais la cible des deux types au lieu d'en valider la seule
forme.

Elle ne livre **pas** le sélecteur d'interface. Le §2.3 annonce pour `contact` un « sélecteur de
contact, création à la volée » et pour `user` un « sélecteur de membre du workspace » : ces deux
contrôles appartiennent aux **écrans** de la tranche 4, avec le carnet de contacts. La saisie reste
donc, pour cette tranche, le champ texte du défaut de `FormulaireCard.tsx` — mais elle n'accepte
plus n'importe quel identifiant : **la base refuse ce qui ne désigne rien**, et l'interface rend ce
refus par le message d'erreur déjà en place (`docs/SPEC-form-composer.md` §4 bis).

Cet ordre est délibéré : poser d'abord la règle en base, l'écran ensuite. L'inverse aurait offert un
sélecteur au-dessus d'une base qui accepte encore n'importe quoi — exactement la « décision
d'écran » que `CLAUDE.md` §10 interdit.

### 9.2 État mesuré avant modification — le défaut à corriger

MESURÉ le 2026-08-18, en transaction roulée en arrière, sur la base seedée :

```
insert into public.card_field_values (…, value)
values (…, '"00000000-0000-4000-8000-000000000000"');   -- champ de type `contact`
=> INSERT 0 1                                            -- ACCEPTÉ
                                                          -- idem pour un champ de type `user`
```

Un identifiant **bien formé mais ne désignant rien** est accepté par les deux types. C'est
exactement la « dette de données impossible à distinguer d'une référence valide » que la décision
295 refuse. Deux assertions de `supabase/tests/0014_valeurs_champs.test.sql` **figent** cet écart
et annoncent leur propre révision « le jour où l'arbitrage sera rendu » : elles sont **retournées**
par cette tranche, non retirées (mécanisme de la décision 51, `CLAUDE.md` §3.1).

### 9.3 La règle, type par type

| Type | Forme exigée | Résolution exigée |
|---|---|---|
| `contact` | `string` convertible en `uuid` | il existe une ligne de `public.contacts` d'`id` égal à cette valeur **et** de `workspace_id` égal à celui de la valeur écrite |
| `user` | `string` convertible en `uuid` | il existe une ligne de `public.workspace_members` de `user_id` égal à cette valeur **et** de `workspace_id` égal à celui de la valeur écrite |

**La portée est le `workspace_id` de la valeur écrite**, non celui du contact ni du profil. La
colonne est non nulle et sa véracité est garantie structurellement par la clé composite
`(workflow_id, workspace_id) → workflows (id, workspace_id)` (§6.3 de
`docs/SPEC-form-composer.md`). Un client qui mentirait sur `workspace_id` verrait sa ligne refusée
par cette clé — mais **après** le trigger, qui est `BEFORE` : le refus qui remonte est alors celui
du trigger, et il est juste, puisque la cible n'appartient pas au workspace revendiqué.

**« Membre actif » veut dire « membre », et la mesure l'impose.** La décision 295 dit « membre
**actif** du workspace ». MESURÉ : `public.workspace_members` porte `(workspace_id, user_id, role,
created_at)` et **aucune** colonne de statut, de suspension ni de date de sortie ; `public.profiles`
porte `(id, full_name, avatar_url, locale, created_at, updated_at)` et n'en porte pas davantage. Le
produit n'a **aucune** notion de membre inactif : l'appartenance **est** l'activité, et retirer un
membre se fait en supprimant sa ligne. La règle est donc « il existe une ligne de
`workspace_members` », et ce n'est pas un affaiblissement de l'arbitrage : c'est sa seule lecture
possible sur ce schéma. Le jour où un statut d'appartenance apparaîtrait, cette règle devrait être
resserrée dans le même changement — la phrase est écrite ici pour que ce jour-là la dette soit
visible.

**La résolution lit les tables en entier, pas ce que la RLS de l'appelant montre.** Le trigger est
`SECURITY DEFINER` pour cette raison même (§6.4) : un contact invisible à l'appelant ne doit pas
être un contact « inexistant ». En pratique, la RLS de `contacts` porte sur le workspace entier
(§3), si bien que les deux lectures coïncident ; la propriété est néanmoins posée par construction
plutôt que par coïncidence.

### 9.4 Ce que la résolution ne garantit toujours PAS — limite nommée, non masquée

La résolution est vérifiée **à l'écriture**, et elle ne peut pas l'être ailleurs : `value` est un
`jsonb`, où **aucune clé étrangère n'est possible** (`docs/SPEC-form-composer.md` §6.1, propriété
du type, INC-033). Conséquence assumée et **nommée** :

- supprimer un contact **ne supprime pas** les valeurs qui le désignaient. Elles deviennent des
  références mortes, exactement comme aujourd'hui, et une relecture ultérieure ne les refusera pas ;
- ce que la tranche supprime est la création **d'une** référence morte à l'écriture, pas la
  possibilité qu'une référence meure ensuite.

Traiter le second cas exigerait soit un trigger `AFTER DELETE` sur `contacts` balayant les valeurs,
soit une table de liaison. Les deux dépassent cette tranche et **appellent l'arbitrage du
responsable** : la question est ajoutée au §6 (point 4) plutôt que tranchée au passage
(`CLAUDE.md` §1).

### 9.5 Contrat de comportement — mesuré sur le seed

Acteurs et données du seed : workspace `…001`, contacts `…091` (Léo Marchand), `…092` (Sophie
Dupont), `…093` (Élise Fabre) ; membres `…011` (admin), `…012` (business developer), `…013`
(viewer).

| # | Écriture d'une valeur | Attendu |
|---|---|---|
| a | champ `contact`, valeur `"5eed…091"` (contact du workspace) | **acceptée** |
| b | champ `contact`, valeur `"00000000-0000-4000-8000-000000000000"` (bien formé, inexistant) | **refusée** `invalid_field_value`, `DETAIL` : « … ne désigne aucun contact de ce workspace » |
| c | champ `contact`, valeur d'un contact d'un **autre** workspace | **refusée** — le cloisonnement est la raison d'être de la règle |
| d | champ `contact`, valeur `"martin"` | **refusée** — la forme, comme avant (inchangé) |
| e | champ `contact`, valeur `null` ou `'null'::jsonb` | **acceptée** — « vidé explicitement » sort avant le `case` (§6.6, décision 133) |
| f | champ `contact`, valeur `42` | **refusée** — la forme, comme avant (inchangé) |
| g | champ `user`, valeur `"5eed…012"` (membre du workspace) | **acceptée** |
| h | champ `user`, valeur d'un profil **existant mais non membre** du workspace | **refusée** — c'est la règle d'appartenance que la décision 295 énonce |
| i | champ `user`, valeur `"00000000-…-000000000000"` (inexistante) | **refusée** |
| j | le contact d'une valeur acceptée est **supprimé** ensuite | la valeur **demeure** — §9.4, limite nommée |

Le `DETAIL` nomme la **clé du champ** et la raison, comme les autres refus du §6.5 : le message reste
`invalid_field_value`, jeton stable comparable par égalité.

### 9.6 Seed — pourquoi la tranche 3 n'y ajoute PAS de champ, et où la donnée arrivera

Le seed ne porte **aucun** champ de type `contact` ni `user` : les sept champs du workflow source
sont `money`, `select`, `date`, `textarea`, `checkbox`, `url`, `number` (mesuré). Ce paragraphe
prévoyait d'y ajouter un champ de chaque type ; **la mesure a renversé la décision, et le motif est
écrit ici plutôt que le changement fait en silence.**

MESURÉ le 2026-08-18 : le nombre « sept champs sur le workflow source » est **figé par dix
preuves** étrangères à cette tranche — `supabase/tests/0008`, `0010`, `0021`,
`scripts/verify-champs-formulaire.sh`, `verify-copie-workflow.sh`, `verify-seed-demo.sh`,
`e2e/api/champs-formulaire.spec.ts`, `e2e/api/copie-workflow.spec.ts`,
`e2e/ui/administration-workflows.spec.ts`, `docs/SPEC-seed.md` §1082 —, parce que la **copie de
workflow** (`CRM-018`) recopie le formulaire source et que ces preuves comparent les deux
inventaires. Ajouter deux champs oblige donc à réviser dix preuves qui ne parlent pas de contacts,
pour une donnée qu'**aucun écran ne rend encore** : les deux sélecteurs sont dus par la tranche 4
(§9.1).

**Décision : la donnée de démonstration arrive avec l'écran qui la montre**, c'est-à-dire à la
tranche 4, où la révision des dix comptes sera faite dans le même geste que le carnet de contacts —
un seul déplacement de compteur au lieu de deux.

> **EXÉCUTÉ le 2026-08-18 par la sous-tranche 4d** (§13.6). Le seed porte depuis lors
> `contact-principal` et `referent-technique`, et les onze fichiers de preuve que ce paragraphe
> annonçait ont été révisés dans le même changement. Le premier alinéa ci-dessus décrit donc l'état
> ANTÉRIEUR, conservé pour son motif ; l'état courant est au §13.6. Ce n'est pas un renoncement à `CLAUDE.md` §8 : le
seed doit démontrer **chaque fonctionnalité livrée**, et cette tranche ne livre aucun écran.

Conséquence pour les preuves de la tranche 3 : elles **fabriquent leurs propres champs sondes**,
dans leur transaction (pgTAP) ou avec la clé de service et un ménage garanti (preuve d'API), comme
`0014_valeurs_champs.test.sql` le fait déjà pour les quinze types. Le seed est rendu **intact**.

### 9.7 Preuves exigées — tranche 3

- **pgTAP dédiée** : les cas a à j du §9.5 sur des états construits dans la transaction (savepoints),
  plus la révision des deux assertions figées de `0014_valeurs_champs.test.sql` et de l'assertion
  `has_table('contacts')` dont le libellé annonce sa propre péremption à cette tranche ;
- **preuve d'API dédiée** : les écritures acceptées et refusées par la **vraie route** PostgREST avec
  les jetons réels, chaque refus **relisant la ligne** pour la constater inchangée (décision 70) ;
- **harnais** : `scripts/verify-champs-formulaire.sh` étendu d'un contrôle comportemental de la
  résolution, avec témoin ;
- **types régénérés** si le schéma bouge (il ne bouge pas : aucune colonne n'est ajoutée) ;
- **aucune preuve d'interface** n'est due par cette tranche, qui ne livre aucun écran ; l'écart est
  nommé plutôt que compensé par une preuve de substitution.

### 9.8 Definition of Done — tranche 3

- migration `0047` redéfinissant `app.card_field_values_valider()` avec la résolution des deux
  types, idempotente et rejouable ;
- suite pgTAP dédiée couvrant les cas a à j du §9.5 ;
- assertions figées par `CRM-036` **retournées** dans le même changement, jamais retirées ;
- preuve d'API dédiée avec les jetons réels ;
- seed **inchangé** et rendu intact, pour le motif mesuré du §9.6 — l'enrichissement rejoint la
  tranche 4, avec l'écran qui le montre ;
- `docs/SPEC-form-composer.md` §6.5, `docs/SCHEMA.md`, `docs/PROD_MIGRATIONS.md` (migration 47),
  `docs/INCONSISTENCY_REPORT.md` (INC-053 **close**), `CHANGELOG.md` mis à jour dans le même
  changement ;
- commentaires `@spec` / `@verifies` sur chaque fichier.

La tranche 3 livrée, l'unité `CRM-060` **demeure `[~]`** : la tranche 4 (écrans — carnet de
contacts, fiche d'organisation, rattachement depuis la route de détail, les deux sélecteurs du
§9.1 et l'enrichissement du seed du §9.6) reste due.

---

## 10. Tranche 4 — Les écrans

Contrat écrit **avant toute ligne de code** (`CLAUDE.md` §5, `docs/CloudWorker.md` §3.2), après
mesure sur la pile réelle seedée le 2026-08-18 : réponses PostgREST relevées à la main avec les
jetons réels des trois profils, table des routes et des entrées de navigation lues ligne à ligne,
`docs/DESIGN_SYSTEM.md` relu intégralement.

Références amont, qui **précèdent** ce document et le contraignent :

- `docs/DESIGN_SYSTEM.md` §4 (barre latérale et entrées transverses), §5.9 (tableau de données),
  §5.8 (états systématiques), §5.13 (formulaires dans le flux, jamais de modale), §2 (données
  techniques), §8 (accessibilité), §10 (aucun texte en dur) ;
- `docs/SPEC-webapp.md` §5.2 (table des routes), §6.4 (contrat asynchrone), §7 (états) ;
- `docs/SPEC-permissions-rls.md` §7 : un refus de lecture est **zéro ligne**, jamais une erreur ;
- `CLAUDE.md` §4 : « l'objet métier principal doit être traité comme un citoyen de première
  classe » — c'est ce qui décide où le carnet s'ancre (§10.2).

### 10.1 Découpage de la tranche 4, et son motif

La tranche 4 porte quatre surfaces distinctes, qui ne lisent pas les mêmes tables et ne partagent
aucun geste. Les livrer d'un bloc produirait un changement que personne ne peut relire, et la
première interruption le perdrait entier. Elle est donc **sous-découpée**, chaque sous-tranche
committée et prouvée avant la suivante :

- **4a — Le carnet de contacts.** Une route propre, une entrée de navigation, un tableau des
  contacts du workspace avec leur organisation. **Lecture seule.** Objet de la présente livraison.
- **4b — La fiche d'organisation.** Les contacts d'une organisation, et ce qui la caractérise.
  **Livrée le 2026-08-18, spécifiée au §11.**
- **4c — Le rattachement d'un contact à une affaire** depuis la route de détail (`card_contacts`),
  premier geste d'écriture de la tranche. Ultérieure.
- **4d — Les deux sélecteurs du §9.1** (`contact` et `user`) dans le formulaire d'une affaire, et
  **l'enrichissement du seed différé par le §9.6**, avec la révision des dix comptes qu'il déplace.
  Ultérieure.

**La lecture vient avant l'écriture, et ce n'est pas un ordre de confort.** Un sélecteur de contact
(4d) suppose une liste de contacts lisible ; un rattachement (4c) suppose de savoir désigner un
contact. 4a livre cette lecture, et rien d'autre.

### 10.2 Où le carnet s'ancre — une route de premier niveau, non une section de réglages

**Décision : `/contacts`, entrée de la barre latérale**, aux côtés de l'Inbox et de Ma journée, et
**non** `/reglages/contacts`.

Le motif est celui de `CLAUDE.md` §4 : un contact est le matériau **quotidien** d'un commercial,
au même titre qu'une affaire — c'est d'ailleurs exactement ce que le §3 de ce document a déjà
tranché en base, en ouvrant l'écriture des contacts au `business_developer` là où les tracks, les
channels et les workflows restent à l'`admin`. Les cinq surfaces de `/reglages` administrent la
**structure** du workspace ; le carnet n'administre rien, il travaille.

Deux conséquences, toutes deux tenues dans le même changement :

- **`ROUTES` et `ENTREES_TRANSVERSES` gagnent la même entrée.** Une assertion existante exige que
  ces deux tables se couvrent **exactement**, sans orpheline dans un sens ni dans l'autre : ajouter
  l'une sans l'autre fait rougir `webapp/src/app/routes.test.tsx`. C'est voulu, et c'est le
  mécanisme qui garantit qu'aucune entrée de navigation ne mène nulle part.
- **`docs/DESIGN_SYSTEM.md` §4 est révisé dans le même changement.** Il énumère les entrées
  transverses — « Inbox, Ma journée, Réglages » — et cette énumération deviendrait fausse. Le
  document reçoit aussi le §5.19, qui dit de quoi le carnet a l'air.

L'icône est `Contact` de Lucide (§9 : Lucide exclusivement). `Users` désignerait les **membres** du
workspace, que `CRM-070` administrera : deux objets distincts ne partagent pas une icône.

### 10.3 Ce que le carnet lit — mesuré sur la pile réelle

MESURÉ le 2026-08-18 avec le jeton réel de l'administratrice, la requête que l'écran émettra :

```
GET /rest/v1/contacts
    ?select=id,full_name,email,phone,role_title,organization_id,organizations(id,name,domain)
    &order=full_name
```

rend les trois contacts du seed, l'organisation **embarquée** et nulle lorsqu'elle est absente :

```
{"full_name":"Élise Fabre","email":null,"phone":"+33 6 12 34 56 78",
 "role_title":"Cheffe d'atelier","organizations":{"name":"Studio Meunier","domain":null}}
{"full_name":"Léo Marchand","email":"leo.marchand@sogexia.example","phone":null,
 "role_title":"Directeur achats","organizations":{"name":"Sogexia","domain":"sogexia.example"}}
{"full_name":"Sophie Dupont","email":"sophie@dupont.test","phone":null,
 "role_title":null,"organizations":null}
```

- **L'organisation est EMBARQUÉE, et c'est mesuré comme possible ici.** `contacts` ne porte qu'**une
  seule** clé étrangère vers `organizations`, si bien que `organizations(...)` ne rend aucune
  ambiguïté `PGRST201` — le défaut qui a imposé deux lectures séparées à `compterEnfantsInaccessibles`
  (`corbeille.ts`) et à `lireCardsClassables` (`inbox.ts`). Une seconde requête serait ici un coût
  gratuit.
- **`source` n'est PAS demandée.** Une requête ne rapporte que ce qui est affiché
  (patron de `lireTracks`), et le carnet n'affiche pas la provenance d'un contact : `manual`,
  `email` et `import` ne veulent rien dire pour un commercial tant qu'aucun import n'existe.
- **L'ordre est `full_name`**, celui du nom affiché — un carnet se parcourt par le nom. MESURÉ, la
  collation de la base range « Élise » avant « Léo » : l'ordre est celui du serveur, l'écran ne
  retrie pas.
- **Aucune pagination dans cette sous-tranche, et l'écart est NOMMÉ.** Le §5.9 du design system
  décrit une pagination pour le tableau de la vue liste ; le carnet lit ici **tous** les contacts du
  workspace. Trois lignes seedées ne mesurent rien, et poser une pagination sur une lecture dont
  personne n'a mesuré le volume serait de l'optimisation sans mesure (`CLAUDE.md` §21). La limite
  est écrite au §10.7 et devra être reprise dès qu'un import (`source = 'import'`) existera.

### 10.4 Autorisations — l'écran n'en calcule aucune

MESURÉ, avec les jetons réels :

| Acteur | Requête | Mesure |
|---|---|---|
| administratrice `…011` | `GET /contacts` | `200`, **3 lignes** |
| lectrice `…013` | `GET /contacts` | `200`, `Content-Range: 0-2/3` — **3 lignes**, la lecture est ouverte à tout membre (§3) |
| anonyme | `GET /contacts` | `200` et **`[]`** — zéro ligne, jamais une erreur de privilège |

L'écran **ne calcule aucun droit** : il rend ce que le backend consent (`docs/DAT.md` §3.1). Un
carnet vide pour un anonyme est donc l'état vide ordinaire du §5.8, et non un refus à mettre en
scène — c'est exactement ce que `docs/SPEC-permissions-rls.md` §7 pose.

Cette sous-tranche ne livre **aucune écriture**, donc **aucun refus d'écriture** n'est à traduire.
La question ne se pose qu'en 4c.

### 10.5 De quoi l'écran a l'air — règles renvoyées au design system

Le détail visuel est écrit dans `docs/DESIGN_SYSTEM.md` §5.19, ajouté dans le même changement. Les
trois décisions structurantes sont rappelées ici parce qu'elles découlent de la **donnée** :

1. **C'est un tableau du §5.9, non la liste imbriquée du §5.13** : les cinq colonnes — nom,
   organisation, fonction, email, téléphone — sont les **mêmes** pour chaque ligne, et il n'y a
   rien à imbriquer, un contact n'ayant pas d'enfant. C'est la distinction que le §5.16 a déjà
   tranchée pour la corbeille.
2. **Une donnée absente laisse la cellule VIDE** (§5.9) : ni tiret, ni « non renseigné ». Le seed
   exerce les trois cas — Sophie sans organisation ni fonction, Élise sans email, Léo sans
   téléphone —, si bien que la règle est visible à la capture et non seulement écrite.
3. **L'email et le téléphone sont des données techniques** (§2) : monospace, chiffres tabulaires.
   Ils se comparent colonne par colonne, ce qui est la seule raison d'avoir des chiffres
   tabulaires. **Ils ne sont pas des liens `mailto:` ni `tel:`** dans cette sous-tranche : écrire
   un message à un contact depuis le carnet est un geste que personne n'a spécifié, et un lien qui
   ouvre le client de messagerie du système sortirait du produit sans le dire.

> **RÉVISION DU 2026-08-18, sous-tranche 4b (§11.6).** Le point 3 ci-dessus ajoutait que le nom
> d'organisation reste un **texte**, la fiche n'existant pas encore. **Cette condition est tombée** :
> la fiche est livrée au §11, et le nom d'organisation est désormais un **lien** vers elle. La règle
> change par **livraison**, non par contournement — le reste du point 3 est inchangé, et il n'y a
> toujours ni `mailto:` ni `tel:`. Une cellule sans organisation reste **vide** et sans lien.

### 10.6 Contrat de comportement — sous-tranche 4a

| # | Situation | Attendu |
|---|---|---|
| a | membre du workspace, contacts présents | le tableau rend une ligne par contact, dans l'ordre du serveur |
| b | contact sans organisation (Sophie) | cellule « Organisation » **vide**, aucune erreur |
| c | contact sans email (Élise) | cellule « Email » **vide** |
| d | lecture en vol | squelettes à la forme du tableau attendu (§5.8), jamais un spinner plein écran |
| e | lecture en échec | état d'erreur avec **action de reprise**, qui relance la lecture |
| f | aucun contact lisible (anonyme, ou workspace neuf) | état **vide** nommant ce qui manque, **sans action** — créer un contact est un geste que 4a ne livre pas, et un bouton vers nulle part est une commande morte (§5.16) |
| g | entrée de navigation | `/contacts` figure dans la barre latérale et porte `aria-current="page"` lorsqu'elle est ouverte |

Le cas **f** mérite son motif : le §5.8 prévoit « message **et action** » pour un état vide, et le
§5.13 ajoute que sur une surface d'administration l'état vide porte le geste qui le comble. Le
carnet n'est pas une surface d'administration (§10.2) et **ne livre aucun geste de création** :
l'écart est celui du §5.16, où l'état vide de la corbeille n'offre aucune action non plus.

### 10.7 Limites nommées — sous-tranche 4a

Écrites plutôt que découvertes plus tard :

- **aucune pagination** (§10.3), à reprendre quand un volume aura été mesuré ;
- **aucune recherche ni aucun filtre.** Le §5.9 les prévoit pour le tableau de la vue liste ; les
  poser ici sans pagination reviendrait à filtrer côté client une liste déjà entièrement chargée,
  ce qui n'est pas la même fonctionnalité et donnerait une fausse idée de son coût ;
- **aucun geste de création, de modification ni de suppression.** L'écriture est ouverte en base
  au `business_developer` depuis la tranche 1, et aucun écran ne l'exerce encore : l'écart est
  nommé, non compensé ;
- ~~**la fiche d'organisation n'existe pas encore** : le nom de l'organisation est un **texte**,
  jamais un lien mort. Il deviendra un lien en 4b, avec sa destination.~~
  **LEVÉE le 2026-08-18 par la sous-tranche 4b (§11.6)** : la fiche existe, et le nom
  d'organisation est le lien qui l'ouvre. Cette limite est tenue, non abandonnée.

### 10.8 Preuves exigées — sous-tranche 4a

| Niveau | Preuve |
|---|---|
| Unitaire | `webapp/src/lib/contacts.test.ts` : la requête émise (table, colonnes, ordre) est vérifiée telle quelle ; les trois issues du contrat asynchrone (§6.4) — prêt, erreur classée sur le code HTTP, jamais sur le texte ; l'organisation absente rendue `null` et non `undefined` |
| Unitaire | `webapp/src/app/Carnet.test.tsx` : les quatre états du §5.8, les cellules vides des cas b et c, l'en-tête du tableau |
| Unitaire | `webapp/src/app/routes.test.tsx` (existant) : la couverture exacte `ROUTES` ⇄ `ENTREES_TRANSVERSES` **inclut** la nouvelle entrée — l'assertion existe déjà et devient la garde de la §10.2 |
| E2E | `e2e/ui/contacts.spec.ts` : le parcours connecté d'un membre — la barre latérale porte l'entrée, le carnet rend les trois contacts du seed, les cellules vides sont vides, et la navigation au **clavier** atteint l'entrée puis le tableau |
| Visible | captures sous `docs/captures/CRM-060/`, **observées** conformément à `CLAUDE.md` §16 : le carnet peuplé, l'état vide anonyme, et le rendu à 390 px |
| i18n | `webapp/src/i18n/i18n.test.ts` (existant) : aucun texte visible en dur (§10 du design system) |

### 10.9 Definition of Done — sous-tranche 4a

- `webapp/src/lib/contacts.ts` : la lecture du §10.3, son type et son contrat asynchrone ;
- `webapp/src/app/Carnet.tsx` : le tableau et les quatre états ;
- `/contacts` ajouté à `chemins.ts`, à `ROUTES` et à `ENTREES_TRANSVERSES`, avec ses clés de
  traduction ;
- tests unitaires du §10.8 verts, et `routes.test.tsx` vert sans révision de son assertion de
  couverture ;
- E2E `e2e/ui/contacts.spec.ts` vert, captures produites **et observées** ;
- `docs/DESIGN_SYSTEM.md` §4 révisé et §5.19 ajouté ; `docs/SPEC-webapp.md` §5.2 (table des
  routes) ; `docs/manual.md` ; `CHANGELOG.md` mis à jour dans le même changement ;
- commentaires `@spec` / `@verifies` sur chaque fichier.

Les sous-tranches 4b, 4c et 4d restent dues ; l'unité `CRM-060` **demeure `[~]`**.

---

## 11. Sous-tranche 4b — La fiche d'organisation

Contrat écrit **avant toute ligne de code** (`CLAUDE.md` §5, `docs/CloudWorker.md` §3.2), après
mesure sur la pile réelle seedée le 2026-08-18 : les cinq réponses PostgREST du §11.3 ont été
relevées à la main avec le jeton réel de l'administratrice et avec la clé anonyme, et le §5.19 de
`docs/DESIGN_SYSTEM.md` relu intégralement.

Cette section prolonge le §10, dont elle reprend les références amont sans les répéter. Elle livre
la **deuxième** des quatre surfaces du §10.1. Les sous-tranches 4c et 4d restent dues.

### 11.1 Ce que la sous-tranche livre, et ce qu'elle ne livre pas

**Elle livre** une route de détail qui, pour une organisation donnée :

- rend **ce qui la caractérise** — son nom, son domaine, son site web ;
- rend **ses contacts**, dans l'ordre du nom ;
- devient la **destination** que le nom d'organisation du carnet n'avait pas.

**Elle ne livre pas**, et chaque manque est nommé au §11.8 plutôt que découvert plus tard : aucun
geste d'écriture, aucune liste d'organisations, aucune affaire de l'organisation (`card_contacts`
est l'objet de 4c), aucun filtre et aucune pagination.

### 11.2 Où la fiche s'ancre — `/contacts/organisations/:idOrganisation`

**Décision : une route de détail SOUS le carnet**, et non une route de premier niveau
`/organisations/:id`.

Le motif est celui qui a déjà décidé de `CHEMIN_CARD` : une adresse de premier niveau suppose une
surface d'entrée qui la peuple. Le carnet est cette entrée — on atteint une organisation **par un
de ses contacts** —, et il n'existe aucune liste d'organisations (§11.8). Poser `/organisations`
créerait une racine que rien n'ouvre.

Conséquences, toutes tenues dans le même changement :

- **La fiche ne figure PAS dans `ROUTES`**, exactement comme `CHEMIN_CARD` et `CHEMIN_LISTE` : son
  titre est le **nom de l'organisation**, donc une donnée et non une clé de traduction, et son
  contenu dépend d'un paramètre d'URL. La couverture exacte `ROUTES` ⇄ `ENTREES_TRANSVERSES` que
  `routes.test.tsx` exige reste donc **inchangée**, et c'est voulu : le carnet garde son entrée de
  barre latérale, la fiche n'en réclame aucune.
- **Elle porte sa propre coquille `AppShell`**, avec `titreRoute` alimenté par le nom lu et une
  clé de repli pour le chargement et l'introuvable — le patron exact de `RouteCard`.

**L'organisation est désignée par son IDENTIFIANT, et non par un slug.** MESURÉ : `organizations`
ne porte aucune colonne `slug` (§2.1), et `domain` ne peut pas en tenir lieu — il est **nul** pour
Studio Meunier, et une adresse qui n'existe que pour la moitié des lignes n'est pas une adresse.

### 11.3 Ce que la fiche lit — mesuré sur la pile réelle

MESURÉ le 2026-08-18 avec le jeton réel de l'administratrice, la requête **unique** que l'écran
émettra :

```
GET /rest/v1/organizations
    ?id=eq.<idOrganisation>
    &select=id,name,domain,website,contacts(id,full_name,email,phone,role_title)
    &contacts.order=full_name
```

rend, pour Sogexia (`…081`) :

```
[{"id":"5eed…081","name":"Sogexia","domain":"sogexia.example","website":null,
  "contacts":[{"id":"5eed…091","full_name":"Léo Marchand",
               "email":"leo.marchand@sogexia.example","phone":null,
               "role_title":"Directeur achats"}]}]
```

et pour Studio Meunier (`…082`), l'organisation sans domaine :

```
[{"id":"5eed…082","name":"Studio Meunier","domain":null,"website":null,
  "contacts":[{"id":"5eed…093","full_name":"Élise Fabre","email":null,
               "phone":"+33 6 12 34 56 78","role_title":"Cheffe d'atelier"}]}]
```

- **UNE seule requête, et l'embarquement est mesuré comme possible dans ce sens aussi.** Le §10.3
  avait établi que `contacts → organizations` ne rend aucune ambiguïté `PGRST201` ; la mesure
  ci-dessus établit la même chose **dans le sens inverse**, `organizations → contacts`, la clé
  étrangère restant unique. Une seconde requête serait ici un coût gratuit.
- **L'ordre des contacts embarqués est demandé au serveur** — `contacts.order=full_name` —, jamais
  posé après coup : c'est la règle du §10.3, et elle vaut pour une relation embarquée comme pour
  une table. **Il ne se demande PAS de la même façon, et c'est MESURÉ** : la forme
  `order=contacts(full_name)`, que produirait un tri écrit comme celui du carnet, est refusée par
  `PGRST108` — « 'contacts' is not an embedded resource in this request ». Le tri d'une relation
  embarquée passe par `referencedTable`, qui construit le `contacts.order=full_name` ci-dessus.
- **`source` n'est pas davantage demandée qu'au §10.3**, et pour la même raison.
- **`website` EST demandé, alors que le carnet ne le demandait pas** : c'est précisément la fiche
  qui caractérise l'organisation, et le §10.3 avait déjà annoncé que `domain` était demandé « pour
  le jour où la fiche existera ». Ce jour est celui-ci.

### 11.4 Autorisations — l'écran n'en calcule aucun, et trois absences donnent le même écran

MESURÉ, avec les jetons réels :

| # | Acteur / adresse | Mesure |
|---|---|---|
| 1 | administratrice, `id` d'une organisation du workspace | `200`, **1 ligne**, contacts embarqués |
| 2 | administratrice, `id` bien formé mais **inexistant** | `200` et **`[]`** |
| 3 | **anonyme**, `id` d'une organisation réelle | `200` et **`[]`** |
| 4 | administratrice, `id` **qui n'est pas un uuid** | **`400`**, `22P02`, `invalid input syntax for type uuid` |

Les cas **2 et 3 rendent la même réponse**, et l'écran rend donc le **même** écran « organisation
introuvable ». C'est délibéré, et c'est la règle de `docs/SPEC-permissions-rls.md` §7, déjà tenue
par `RouteCard` : distinguer les deux renseignerait un appelant sans droit sur l'**existence** d'une
organisation.

**Le cas 4 est celui que la mesure a rendu intéressant, et il décide d'une règle.** Un `400` classé
par `classerErreur` tomberait sur l'état d'**erreur**, dont l'action de reprise relancerait la même
requête pour recevoir le même `400` — **une commande morte** (`docs/DESIGN_SYSTEM.md` §5.10), sur une
surface dont l'adresse est directement éditable par l'utilisateur.

**Décision : la fiche contrôle la FORME de l'identifiant avant d'émettre quoi que ce soit, et un
identifiant mal formé rend « organisation introuvable », comme les cas 2 et 3.** Aucune requête
n'est émise. Le motif est écrit dans le code, et le contrôle porte sur la forme uuid seule — il ne
prétend pas savoir si l'organisation existe, ce que seul le backend peut dire.

Cette sous-tranche ne livre **aucune écriture**, donc **aucun refus d'écriture** n'est à traduire.

### 11.5 De quoi l'écran a l'air

Le détail visuel est écrit dans `docs/DESIGN_SYSTEM.md` §5.20, ajouté dans le même changement.
Trois décisions découlent de la **donnée** et sont rappelées ici :

1. **Deux zones, et non un tableau unique.** Ce qui caractérise l'organisation est une **liste de
   définitions** — des couples libellé/valeur qui ne se comparent pas entre eux —, là où ses
   contacts sont des **lignes homogènes** et reprennent donc le tableau du §5.9. Poser les deux
   dans la même structure obligerait l'une des deux à mentir sur sa nature.
2. **`domain` et `website` sont des données techniques** (§2) : monospace. Une valeur absente
   laisse la valeur **vide**, jamais un tiret — la règle du §5.9 déjà tenue par le carnet.
3. **`website` est un LIEN, `domain` ne l'est pas.** Un site web a une destination réelle, et la
   contrainte de base garantit déjà sa forme `http`/`https` (§2.1) : le lien ne peut donc pas être
   construit sur une valeur qui n'en est pas une. Il s'ouvre dans un nouvel onglet, avec
   `rel="noreferrer noopener"`, et le fait qu'il **sorte du produit** est annoncé à l'utilisateur
   plutôt que subi. Un domaine, lui, n'est pas une URL : `sogexia.example` est un pivot de
   rapprochement d'emails (§2.1), pas une adresse à visiter, et en faire un lien inventerait un
   schéma que la donnée ne porte pas.

Le tableau des contacts porte **quatre** colonnes — nom, fonction, email, téléphone — et non les
cinq du carnet : la colonne « organisation » y répéterait le titre de la page à chaque ligne.

### 11.6 Le carnet gagne sa destination — une règle du §10 RÉVISÉE par livraison

Le §10.7 et le §5.19 du design system posaient que le nom d'organisation du carnet est un **texte,
jamais un lien**, avec leur condition écrite : « sa fiche est due par une sous-tranche ultérieure,
et un lien sans destination serait mort ». **Cette condition tombe ici.**

La règle change donc par **livraison**, et non par contournement :

- le §10.7 et le §10.5 de ce document sont **révisés**, avec la date et le motif ;
- `docs/DESIGN_SYSTEM.md` §5.19 est révisé de même ;
- les deux preuves qui figeaient l'absence de lien — `webapp/src/app/Carnet.test.tsx` et
  `e2e/ui/contacts.spec.ts` — sont **RÉVISÉES avec leur motif écrit dans le fichier**, jamais
  retirées ni contournées : c'est le mécanisme de la décision 51, et ce qu'elles exigent devient
  « le nom d'organisation mène à sa fiche », qui reste une exigence vérifiable.

**Une cellule sans organisation reste VIDE** : Sophie Dupont n'a aucune organisation, donc aucun
lien. Un lien n'apparaît que là où il a une destination.

### 11.7 Le seed s'enrichit, et les deux ajouts sont mesurés comme sans effet sur les compteurs

`CLAUDE.md` §8 : une fonctionnalité qui introduit une page met à jour le seed **dans le même
changement**, et les données doivent couvrir les branches alternatives. La fiche en a deux que le
seed n'exerçait pas :

1. **Une organisation qui porte un site web.** `website` est ajouté à Sogexia :
   `https://www.sogexia.example`. Sans lui, le lien du §11.5 n'est **jamais rendu** et la capture
   ne le montre pas.
2. **Une organisation SANS aucun contact.** Une troisième organisation est seedée — « Comptoir
   Vasseur », domaine `comptoir-vasseur.example`, aucun contact —, sans laquelle l'état vide de la
   liste de contacts n'est démontrable que contre une réponse substituée.

**Aucun compteur figé n'est déplacé, et c'est MESURÉ, non supposé** : le seed compare
`organizations_count` à `${#ORGANIZATIONS_SEED[@]}`, donc à la taille du tableau lui-même ; aucun
`scripts/verify-*.sh` ne cite `organizations` ; les preuves d'API de `e2e/api/contacts.spec.ts`
créent leurs **propres** organisations sondes et les suppriment. Le carnet, qui liste des
**contacts** et non des organisations, garde ses **trois** lignes. C'est ce qui distingue cet
enrichissement de celui que le §9.6 a différé : celui-là déplaçait dix compteurs, celui-ci aucun.

### 11.8 Limites nommées — sous-tranche 4b

- **aucune liste d'organisations.** On atteint une fiche par un contact du carnet, et par là seul.
  Une liste demanderait sa propre route, son propre tri et sa propre pagination ;
- **aucun geste d'écriture** : ni création, ni modification, ni suppression d'organisation. Les
  privilèges existent en base depuis la tranche 1 ; aucun écran ne les exerce encore. L'écart est
  nommé, non compensé par une commande morte ;
- **aucune affaire de l'organisation.** `card_contacts` est lu par 4c ;
- **aucune pagination des contacts de l'organisation**, pour le motif exact du §10.3 : aucun volume
  n'est mesuré ;
- **le contact de la fiche ne mène nulle part.** Il n'existe pas de fiche de contact, et 4b n'en
  crée pas : un lien serait mort, ce qui est la faute même que le §11.6 vient de réparer ailleurs.

### 11.9 Contrat de comportement — sous-tranche 4b

| # | Situation | Attendu |
|---|---|---|
| a | organisation lisible, avec contacts | le nom en titre, ses caractéristiques, et une ligne par contact dans l'ordre du nom |
| b | organisation sans domaine (Studio Meunier) | la valeur « domaine » est **vide**, aucune erreur |
| c | organisation avec site web (Sogexia) | le site est un **lien**, ouvert dans un nouvel onglet, `rel="noreferrer noopener"` |
| d | organisation **sans contact** (Comptoir Vasseur) | la zone des contacts rend l'état **vide**, sans action ; les caractéristiques restent rendues |
| e | identifiant inexistant, ou appelant sans droit | « organisation introuvable », avec un retour vers le carnet — **le même écran dans les deux cas** |
| f | identifiant mal formé (non-uuid) | « organisation introuvable », **aucune requête émise** (§11.4) |
| g | lecture en vol | squelettes, jamais un spinner plein écran |
| h | lecture en échec | état d'erreur avec action de reprise, qui relance réellement la lecture |
| i | depuis le carnet | le nom d'organisation est un **lien** qui ouvre la fiche ; une cellule sans organisation reste **vide** et sans lien |

### 11.10 Preuves exigées — sous-tranche 4b

| Niveau | Preuve |
|---|---|
| Unitaire | `webapp/src/lib/contacts.test.ts` (étendu) : la requête émise par la lecture de la fiche — table, colonnes, ordre des contacts embarqués, filtre sur `id` ; l'organisation rendue `null` quand la réponse est vide ; le refus de forme du cas f **sans appel réseau** ; les trois issues du contrat asynchrone |
| Unitaire | `webapp/src/app/FicheOrganisation.test.tsx` : les cas a à h du §11.9 |
| Unitaire | `webapp/src/app/Carnet.test.tsx` (RÉVISÉ, §11.6) : le nom d'organisation est désormais un lien vers la fiche, et une cellule sans organisation reste vide et sans lien |
| E2E | `e2e/ui/contacts.spec.ts` (étendu et RÉVISÉ) : depuis le carnet, le clic sur « Sogexia » ouvre la fiche ; le site web y est un lien ; « Comptoir Vasseur » rend l'état vide des contacts ; une adresse mal formée rend « introuvable » ; l'accès au **clavier** |
| Visible | captures sous `docs/captures/CRM-060/`, **observées** conformément à `CLAUDE.md` §16 : la fiche peuplée, la fiche sans contact, l'introuvable, et le rendu à 390 px |
| i18n | `webapp/src/i18n/i18n.test.ts` (existant) : aucun texte visible en dur |
| Seed | le seed rejoué **converge** : trois organisations, trois contacts, deux rattachements |

### 11.11 Definition of Done — sous-tranche 4b

- `webapp/src/lib/contacts.ts` : la lecture du §11.3, son type, son contrôle de forme du §11.4 ;
- `webapp/src/app/FicheOrganisation.tsx` : les deux zones et les cinq états ;
- `CHEMIN_ORGANISATION` dans `chemins.ts`, montée par `App` **hors de `ROUTES`** ;
- `webapp/src/app/Carnet.tsx` : le nom d'organisation devient un lien (§11.6) ;
- seed enrichi des deux ajouts du §11.7 ;
- preuves du §11.10 exécutées et vertes, captures produites **et observées** ;
- `docs/DESIGN_SYSTEM.md` §5.20 ajouté et §5.19 révisé ; `docs/SPEC-webapp.md` §5.2 ;
  `docs/SPEC-seed.md` ; `docs/manual.md` ; `CHANGELOG.md`, dans le même changement ;
- commentaires `@spec` / `@verifies` sur chaque fichier.

Les sous-tranches 4c et 4d restent dues ; l'unité `CRM-060` **demeure `[~]`**.

---

## 12. Sous-tranche 4c — Le rattachement d'un contact à une affaire

Contrat écrit **avant toute ligne de code** (`CLAUDE.md` §5, `docs/CloudWorker.md` §3.2), après
mesure sur la pile réelle seedée le 2026-08-18 : les treize réponses PostgREST des §12.3 et §12.4
ont été relevées à la main avec les jetons réels des trois profils et avec la clé anonyme, et
`docs/DESIGN_SYSTEM.md` relu **intégralement**. Le seed a été rendu **intact** après chaque
mesure d'écriture, et c'est vérifié : `card_contacts` compte de nouveau ses deux lignes du §5.

Cette section prolonge les §10 et §11, dont elle reprend les références amont sans les répéter.
Elle livre la **troisième** des quatre surfaces du §10.1, et la **première à ÉCRIRE** : les §10.4
et §11.4 ont tous deux écrit « aucun refus d'écriture n'est à traduire, la question ne se pose
qu'en 4c ». Elle se pose ici, et le §12.5 y répond.

### 12.1 Ce que la sous-tranche livre, et ce qu'elle ne livre pas

**Elle livre**, sur la route de détail d'une affaire :

- la **liste des contacts rattachés** à cette affaire, avec leur rôle dans l'affaire ;
- le **geste de rattachement** d'un contact du carnet à cette affaire, avec un rôle facultatif ;
- le **geste de détachement**, avec sa confirmation.

**Elle ne livre pas**, et chaque manque est nommé au §12.8 : aucune modification du rôle d'un
rattachement déjà posé, aucune liste des affaires d'un contact, aucun rattachement depuis le
carnet ni depuis la fiche d'organisation, et aucune création de contact.

### 12.2 Où le bloc s'ancre — colonne GAUCHE, entre le formulaire et le geste de corbeille

**Décision : un bloc de la colonne gauche du détail de card, posé APRÈS le formulaire et AVANT le
bloc de mise à la corbeille.**

Le motif est celui que `docs/DESIGN_SYSTEM.md` §5.3 a déjà écrit deux fois :

- **la colonne DROITE raconte**, elle n'agit pas. Elle porte le fil unifié (§5.10, §5.11), et
  « un geste qui agit n'appartient pas au récit ». Rattacher un contact est un geste ;
- **le bloc de corbeille reste le DERNIER de la colonne**, « parce qu'un retrait n'est pas ce
  qu'on vient faire sur une fiche ». Poser les contacts sous lui les mettrait après la sortie.

L'ordre de la colonne gauche devient donc : **en-tête, formulaire, contacts, corbeille**. Les
contacts d'une affaire appartiennent à son dossier — ils se lisent avec lui, pas après le geste
qui la retire.

**Aucune route nouvelle, aucune entrée de navigation.** La couverture exacte `ROUTES` ⇄
`ENTREES_TRANSVERSES` de `routes.test.tsx` reste **inchangée**, comme au §11.2 et pour une raison
plus forte encore : ce bloc n'a pas d'adresse propre, il vit dans celle de l'affaire.

### 12.3 Ce que le bloc lit — mesuré sur la pile réelle

MESURÉ le 2026-08-18 avec le jeton réel de l'administratrice, la requête **unique** que le bloc
émettra pour les rattachements :

```
GET /rest/v1/card_contacts
    ?card_id=eq.<idCard>
    &select=contact_id,role,contacts(id,full_name,organization_id,organizations(id,name))
    &order=contacts(full_name)
```

rend, pour l'affaire `Migration ERP Sogexia` (`…0c2`) :

```
[{"contact_id":"5eed…091","role":"decideur",
  "contacts":{"id":"5eed…091","full_name":"Léo Marchand",
              "organization_id":"5eed…081",
              "organizations":{"id":"5eed…081","name":"Sogexia"}}}]
```

- **L'EMBARQUEMENT TIENT SUR DEUX NIVEAUX**, `card_contacts → contacts → organizations`, et c'est
  mesuré : aucune ambiguïté `PGRST201` n'apparaît, chacune des deux clés étrangères restant unique
  dans son sens. Le §10.3 l'avait établi pour un niveau, le §11.3 pour l'autre sens ; la mesure
  ci-dessus l'établit pour la chaîne. **Une seconde requête serait ici un coût gratuit.**
- **L'ORDRE SE DEMANDE AU PREMIER NIVEAU, ET C'EST UN ÉCART MESURÉ AVEC LE §11.3.** La fiche
  d'organisation trie une relation **to-many** embarquée, ce que PostgREST n'accepte que par
  `referencedTable` (`contacts.order=full_name`), la forme `order=contacts(full_name)` y étant
  refusée par `PGRST108`. Ici la relation est **to-one** — un rattachement désigne un contact et un
  seul —, et `order=contacts(full_name)` est **accepté**, mesuré `200` : il trie les
  **rattachements** eux-mêmes par le nom du contact qu'ils désignent. Vérifié dans les deux sens
  sur deux lignes — ascendant rend `["Léo Marchand","Sophie Dupont"]`, descendant l'inverse : le
  tri **agit**, il n'est pas seulement toléré.
- **`role_title` n'est PAS demandé, et ce n'est pas un oubli.** La fonction d'un contact le
  qualifie dans son **organisation** ; ce bloc dit son rôle dans **cette affaire**, qui est une
  autre donnée et porte le même mot. Les afficher tous deux sur une ligne ferait lire deux « rôles »
  contradictoires. La fonction reste lisible au carnet (§10.3) et sur la fiche (§11.3).
- **`created_at` n'est pas demandé non plus** : le fil unifié raconte la chronologie d'une affaire
  (§5.11), pas ce bloc, et une requête ne rapporte que ce qui est affiché (§10.3).

**Les contacts rattachables sont lus par `lireContactsDuCarnet`, sans nouvelle requête ni nouveau
type** (§10.3). Le sélecteur du §12.6 a besoin exactement de ce que le carnet lit : l'identifiant,
le nom, et l'organisation qui distingue deux homonymes.

### 12.4 Autorisations — treize mesures, et deux refus qui ne se ressemblent pas

MESURÉ le 2026-08-18, avec les jetons réels. **Lecture** :

| # | Acteur / requête | Mesure |
|---|---|---|
| 1 | administratrice, rattachements de `…0c2` | `200`, **1 ligne**, contact et organisation embarqués |
| 2 | **lectrice**, rattachements de `…0c4` (affaire qu'elle lit) | `200`, **1 ligne** — la lecture suit celle de la card (`app.can_read_card`) |
| 3 | **anonyme**, rattachements de `…0c2` | `200` et **`[]`** — zéro ligne, jamais une erreur de privilège |

**Écriture — le rattachement** :

| # | Acteur / requête | Mesure |
|---|---|---|
| 4 | administratrice, `POST` Élise sur `…0c2` | **`201`** et la ligne |
| 5 | **business developer**, `POST` Sophie sur `…0c2` | **`201`** et la ligne — le geste n'est PAS un geste d'administration : `card_contacts_insertion` porte sur `app.can_write_card`, jamais sur un rôle |
| 6 | **lectrice**, `POST` sur `…0c4` | **`403`**, `42501`, « new row violates row-level security policy » |
| 7 | administratrice, `POST` d'un rattachement **déjà posé** | **`409`**, `23505`, `duplicate key value violates unique constraint "card_contacts_pkey"` |
| 8 | administratrice, `POST` avec un `contact_id` **inexistant** | **`409`**, `23503`, violation de la FK composite `(contact_id, workspace_id)` |
| 9 | administratrice, `POST` avec un `contact_id` **qui n'est pas un uuid** | **`400`**, `22P02` |
| 10 | administratrice, `POST` avec `role: ""` | **`400`**, `23514`, `card_contacts_role_check` |

**Écriture — le détachement** :

| # | Acteur / requête | Mesure |
|---|---|---|
| 11 | administratrice / business developer, `DELETE` d'un rattachement existant | **`200`** et la ligne retirée |
| 12 | **lectrice**, `DELETE` d'un rattachement **existant** de `…0c4` | **`200`** et **`[]`** — la ligne est relue **inchangée** |
| 13 | administratrice, `DELETE` d'un rattachement **inexistant** | **`200`** et **`[]`** |

**Trois conséquences, et chacune décide d'une règle.**

1. **Le refus d'INSERTION est bruyant, celui de SUPPRESSION est SILENCIEUX.** Les mesures 6 et 12
   portent sur le même acteur et la même table : l'un rend `403`, l'autre `200` et zéro ligne. La
   clause `USING` d'une politique `DELETE` filtre la ligne **avant** de supprimer, exactement comme
   celle de `cards_maj` au §4 ter.3 de `docs/SPEC-corbeille.md`. Le détachement a donc **trois
   issues**, pas deux, et l'issue « sans effet » n'est **ni** un succès **ni** une erreur.
2. **Les mesures 12 et 13 sont INDISTINGUABLES**, et c'est délibérément assumé : « aucun
   rattachement n'a été retiré » est vrai des deux côtés, et prétendre distinguer un refus de droit
   d'une ligne déjà partie renseignerait un appelant sans droit sur l'état de l'affaire
   (`docs/SPEC-permissions-rls.md` §7). L'écran dit ce qui est vrai — rien n'a changé — et **relit**.
3. **`409` recouvre DEUX causes opposées** (mesures 7 et 8), et le code HTTP seul ne les sépare pas.
   « Ce contact est déjà rattaché » appelle un geste — en choisir un autre — là où « ce contact
   n'existe pas » signale une donnée périmée. Les fondre sous « une erreur est survenue » serait la
   valeur par défaut trompeuse de `CLAUDE.md` §18. Le classement lit donc le **code PostgreSQL
   d'abord, le code HTTP ensuite** — la règle de `classerRefusRestauration` (`corbeille.ts`),
   reprise sans exception.

**L'écran ne calcule AUCUN droit**, et **aucune commande n'est éteinte d'avance**, quel que soit le
rôle : c'est la règle du §5.3, du §5.16 et du §5.13 du design system, tenue ici sans exception. La
règle vit dans `card_contacts_insertion` et `card_contacts_suppression` ; une commande grisée par
l'interface ferait passer une décision de la base pour une décision d'écran (`CLAUDE.md` §10).

### 12.5 Les refus, traduits par un dictionnaire FERMÉ

Le message du serveur n'atteint **jamais** l'écran — règle déjà tenue par les codes d'incident de
`CRM-059`, le classement des refus de `CRM-075` et le geste de corbeille de `CRM-077` : un texte
d'API n'est pas un texte pour un humain, et le rendre tel quel exposerait le détail de la pile
(`CLAUDE.md` §20).

| Nature | Reconnue par | Ce que l'écran dit |
|---|---|---|
| `deja-rattache` | code `23505` | le contact est déjà rattaché à cette affaire |
| `contact-inconnu` | code `23503` | ce contact n'existe pas dans cet espace de travail ; la liste est peut-être périmée |
| `forbidden` | `401` ou `403` | vous ne pouvez pas modifier cette affaire |
| `network` | statut absent ou `0` | la requête n'a pas abouti |
| `unknown` | tout le reste | une erreur inattendue |

**Le code PostgreSQL prime sur le code HTTP**, et l'ordre compte : `23505` et `23503` rendent tous
deux `409`, et un classement qui commencerait par le statut les confondrait.

**La forme `role: ""` n'est jamais envoyée** (mesure 10) : un champ de rôle laissé vide vaut
**`null`**, l'absence de rôle étant un état légitime que la colonne accepte. Ce n'est **pas** une
garde de saisie doublant la base au sens du §5.3 ter — la base refuserait `''` —, c'est le choix de
la valeur qui exprime « pas de rôle ». Le rôle saisi n'est pour le reste **ni contraint ni
normalisé** : il est libre (§2.3), et en fermer la liste à l'écran poserait une règle de produit que
personne n'a prise.

### 12.6 De quoi le bloc a l'air — règles renvoyées au design system

Le détail visuel est écrit dans `docs/DESIGN_SYSTEM.md` §5.21, ajouté dans le même changement.
Quatre décisions découlent de la **donnée** et sont rappelées ici :

1. **Une `ul` de lignes, ni le tableau du §5.9 ni l'arborescence du §5.13.** La colonne gauche est
   large de `72ch` au plus (§5.3) et chaque ligne porte **sa propre commande** : c'est le patron de
   la liste plate du §5.18. Deux ou trois colonnes comparables n'y tiendraient pas, et un contact
   rattaché n'a pas d'enfant à imbriquer.
2. **Le rôle dans l'affaire est un MOT, jamais une teinte** (§1) — « decideur », « prescripteur »,
   tel que la donnée le porte, sans traduction : c'est une **valeur métier libre** (§2.3), pas une
   clé fermée, et la traduire supposerait une énumération que la base refuse d'avoir. Un
   rattachement **sans rôle** ne rend rien à cette place : ni tiret, ni « non renseigné » (§5.9).
3. **Le nom de l'organisation est un LIEN vers sa fiche**, comme au §5.19 et pour la même raison :
   la destination existe depuis 4b. **Le nom du contact n'est PAS un lien** — il n'existe pas de
   fiche de contact, et un lien y serait mort (§11.8, §5.10).
4. **Le formulaire de rattachement vit DANS LE FLUX du document, jamais en modale** (§5.13), et sa
   confirmation de détachement aussi (§5.3, §5.13, `CRM-043` ayant tranché trois fois). Le focus
   entre dans le premier contrôle à l'ouverture et revient à la commande à la fermeture.

**Le sélecteur n'offre que les contacts NON ENCORE rattachés**, et c'est un filtre posé sur des
données déjà en main, non une requête de plus. Le motif est mesuré : rattacher un contact déjà
rattaché rend `409` (mesure 7), et « on n'offre pas une commande dont on sait qu'elle sera
refusée » — la règle que le §5.15 a posée pour la case « par défaut » d'un workflow. Le refus
`deja-rattache` du §12.5 reste néanmoins traduit : deux utilisateurs peuvent rattacher le même
contact à la même seconde, et l'écran ne prétend pas connaître l'état du serveur.

### 12.7 Contrat de comportement — sous-tranche 4c

| # | Situation | Attendu |
|---|---|---|
| a | affaire avec un contact rattaché | une ligne par rattachement, dans l'ordre du **nom du contact**, avec son rôle quand il existe |
| b | rattachement **sans rôle** | la ligne rend le nom et l'organisation, et **rien** à la place du rôle |
| c | contact **sans organisation** rattaché | la ligne rend le nom seul, sans lien |
| d | affaire **sans aucun rattachement** | état **vide** nommant ce qui manque, et le formulaire de rattachement reste offert — il est le geste qui comble ce vide (§5.13) |
| e | lecture en vol | squelettes à la forme de la liste attendue (§5.8), jamais un spinner |
| f | lecture en échec | état d'erreur avec **action de reprise**, qui relance réellement la lecture |
| g | rattachement réussi | la liste est **relue** — jamais complétée localement —, le formulaire se referme, et le focus revient à la commande |
| h | rattachement refusé (lectrice) | alerte `role="alert"` **dans le formulaire**, texte du dictionnaire fermé, la **saisie conservée** |
| i | rattachement d'un contact déjà rattaché | alerte disant qu'il l'est déjà, jamais « une erreur est survenue » |
| j | rôle laissé vide | `null` est envoyé, jamais `""` ; le rattachement réussit |
| k | tous les contacts du workspace sont déjà rattachés | le formulaire dit qu'il n'en reste aucun, et **n'offre pas de sélecteur vide** |
| l | le workspace n'a **aucun** contact | le formulaire nomme l'absence, **sans action** : aucun écran ne crée de contact (§10.7, §11.8) |
| m | détachement demandé | une confirmation dans le flux, **nommant le contact** (§6) |
| n | détachement réussi | la liste est **relue** ; la ligne disparaît |
| o | détachement sans effet (lectrice, ou ligne déjà partie) | « aucun rattachement n'a été retiré » — ni un succès, ni une erreur —, et la liste est **relue** |
| p | commandes et rôle | **aucune commande n'est éteinte d'avance**, quel que soit le rôle de l'appelant |

### 12.8 Limites nommées — sous-tranche 4c

Écrites plutôt que découvertes plus tard :

- **le rôle d'un rattachement posé ne se MODIFIE pas.** La politique `card_contacts_maj` existe en
  base depuis la tranche 1 ; aucun écran ne l'exerce. Détacher puis rattacher reste possible, et
  l'écart est nommé plutôt que compensé par une commande morte ;
- **aucune liste des affaires d'un contact.** Elle demanderait une fiche de contact, qui n'existe
  pas (§11.8) ;
- **aucun rattachement depuis le carnet ni depuis la fiche d'organisation** : le geste part de
  l'affaire, qui est ce que la politique `can_write_card` garde ;
- **aucune création de contact depuis ce bloc.** Si le workspace n'a aucun contact, le bloc le dit
  et s'arrête là (cas l) — la création reste due, et sa surface n'est spécifiée nulle part ;
- **aucune pagination du sélecteur**, pour le motif exact du §10.3 : aucun volume n'est mesuré ;
- **le fil unifié n'apprend rien de ce geste.** `card_contacts` n'écrit aucun `card_event`, et la
  tranche 1 n'en a posé aucun trigger : un rattachement n'apparaît pas dans la timeline. L'écart est
  nommé ici et reste à arbitrer.

### 12.9 Preuves exigées — sous-tranche 4c

| Niveau | Preuve |
|---|---|
| Unitaire | `webapp/src/lib/contacts.test.ts` (étendu) : la requête émise par la lecture des rattachements — table, colonnes, filtre, ordre au premier niveau ; la charge réellement envoyée par le rattachement, `role` valant `null` sur une saisie vide ; le classement des cinq refus du §12.5, **code PostgreSQL avant code HTTP** ; les trois issues du détachement |
| Unitaire | `webapp/src/app/BlocContactsCard.test.tsx` : les cas a à p du §12.7 |
| E2E | `e2e/ui/contacts-affaire.spec.ts` : sur la pile réelle, l'administratrice rattache Élise à `Migration ERP Sogexia` puis la détache — la liste est relue dans les deux sens ; la **lectrice** reçoit le refus écrit ; le parcours au **clavier** ; console **vierge** |
| Visible | captures sous `docs/captures/CRM-060/`, **observées** conformément à `CLAUDE.md` §16 : le bloc peuplé, son état vide, le formulaire ouvert, le refus, et le rendu à 390 px |
| i18n | `webapp/src/i18n/i18n.test.ts` (existant) : aucun texte visible en dur |
| Seed | le seed est rendu **INTACT** par les preuves : `card_contacts` compte de nouveau ses **deux** lignes après la campagne |

**LE SEED EST UNE CONTRAINTE DURE POUR CETTE SOUS-TRANCHE, et c'est mesuré.** `apply-seed.sh`
compare `card_contacts` à la taille de son propre tableau — **deux** — et **échoue** si le compte
diffère ; une seconde garde exige que Léo Marchand soit rattaché à **exactement une** card active,
état que la règle 3 du classement (`CRM-055`) lit. Toute preuve qui rattache un contact **doit donc
le détacher**, et le détachement n'est pas ici une commodité de test : c'est le geste que la
sous-tranche livre, exercé par sa propre preuve.

### 12.10 Definition of Done — sous-tranche 4c

- `webapp/src/lib/contacts.ts` : la lecture du §12.3, les deux écritures, le classement du §12.5 ;
- `webapp/src/app/BlocContactsCard.tsx` : la liste, le formulaire, la confirmation, les états ;
- `webapp/src/app/RouteCard.tsx` : le bloc monté entre le formulaire et la corbeille (§12.2) ;
- clés de traduction ajoutées, aucun texte en dur ;
- preuves du §12.9 exécutées et vertes, captures produites **et observées** ;
- `docs/DESIGN_SYSTEM.md` §5.21 ajouté ; `docs/manual.md` ; `CHANGELOG.md`, dans le même changement ;
- commentaires `@spec` / `@verifies` sur chaque fichier.

La sous-tranche 4d reste due ; l'unité `CRM-060` **demeure `[~]`**.

## 13. Sous-tranche 4d — Les deux sélecteurs du formulaire, et le seed qui les démontre

Contrat écrit **avant toute ligne de code** (`CLAUDE.md` §5, `docs/CloudWorker.md` §3.2), après
mesure sur la pile réelle seedée le 2026-08-18 : les réponses PostgREST des §13.3 et §13.6 ont été
relevées à la main avec les jetons réels de l'administratrice et de la lectrice, et avec la clé
anonyme ; `docs/DESIGN_SYSTEM.md` a été relu **intégralement**. Toutes les mesures d'écriture ont
été faites sur des **champs sondes** créés puis détruits, et le seed a été rendu **intact** : le
workflow global porte de nouveau ses sept champs seedés, les trois contacts et les vingt et une
valeurs sont retrouvés à l'identique.

Cette section livre la **quatrième et dernière** surface du §10.1. Elle referme ce que le §9.1 a
laissé ouvert en toutes lettres : « elle ne livre **pas** le sélecteur d'interface […] ces deux
contrôles appartiennent aux **écrans** de la tranche 4 ». Elle exécute aussi la décision du §9.6,
« la donnée de démonstration arrive avec l'écran qui la montre ».

### 13.1 Ce que la sous-tranche livre, et ce qu'elle ne livre pas

**Elle livre**, dans le formulaire d'une affaire (`docs/SPEC-form-composer.md` §4) :

- un **sélecteur de contact** pour tout champ de type `contact`, offrant les contacts du workspace
  au lieu d'un champ texte où l'on tape un `uuid` ;
- un **sélecteur de membre** pour tout champ de type `user`, offrant les membres du workspace ;
- la **résolution en toutes lettres** de ces deux types dans la section repliée « Informations
  d'autres étapes », qui affichait jusqu'ici l'identifiant brut ;
- **deux champs de démonstration dans le seed**, un de chaque type, avec leur valeur — sans quoi
  aucun parcours réel n'exercerait ces deux contrôles (`CLAUDE.md` §8).

**Elle ne livre pas**, et chaque manque est nommé au §13.8 : aucune création de contact « à la
volée » (le §2.3 l'annonce, aucune surface ne la spécifie), aucune recherche ni filtre dans les
listes, aucune pagination, et le type `file` reste en saisie texte.

### 13.2 Le motif de ce geste — un identifiant n'est pas une saisie

`FormulaireCard.tsx` porte aujourd'hui, en commentaire de sa fonction `Controle`, la phrase qui
motive cette sous-tranche : « les types que `CRM-036` ne résout pas — `user`, `contact`, `file`
(INC-053) — tombent dans le défaut et se saisissent en texte brut : afficher un nom que le produit
ne sait pas obtenir serait une invention ».

**Les deux motifs de cette phrase sont tombés.** La tranche 1 a livré `contacts` ; la tranche 3 a
livré la résolution en base (migration `0047`) ; les tranches 4a et 4b ont livré la lecture des
contacts et des organisations. Le produit **sait** désormais obtenir le nom, et la conséquence est
double :

- **saisir un `uuid` à la main est un chemin qui ne mène nulle part.** Aucun écran ne montre
  l'identifiant d'un contact ni celui d'un membre ; personne ne peut donc renseigner ces deux
  champs autrement qu'en le devinant. Depuis la migration `0047`, la base **refuse** toute valeur
  qui ne désigne rien : le champ texte n'offre plus qu'un refus certain ;
- **lire un `uuid` en lecture seule ne dit rien.** La section repliée du §4.2 de
  `docs/SPEC-form-composer.md` affiche la valeur telle quelle ; pour ces deux types, elle affiche
  trente-six caractères qui ne nomment personne.

### 13.3 Ce que les deux sélecteurs lisent — mesuré, et REPRIS sans nouvelle forme de requête

**Aucune requête nouvelle n'est inventée : les deux lectures existent déjà et sont réutilisées.**

| Type | Fonction réutilisée | Module |
|---|---|---|
| `contact` | `lireContactsDuCarnet` (§10.3) | `webapp/src/lib/contacts.ts` |
| `user` | `lireMembresAffectables` (`docs/SPEC-cards.md` §15 bis.6) | `webapp/src/lib/entete-card.ts` |

MESURÉ le 2026-08-18 avec le jeton réel de l'administratrice, la lecture des membres :

```
GET /rest/v1/workspace_members
    ?select=user_id,profiles(id,full_name)
    &workspace_id=eq.5eed0000-0000-4000-8000-000000000001
=> 200, 3 lignes : Camille Aubert, Driss Lemoine, Farida Nowak
```

et la même requête avec le jeton de la **lectrice** rend elle aussi **3 lignes** — « le nom d'un
collègue est une donnée d'équipe, pas une donnée du dossier ». La lecture des contacts rend les
trois contacts du seed à l'administratrice **comme** à la lectrice, et `[]` à un appelant anonyme
(§10.4, remesuré).

**`lireContactsDuCarnet` est réutilisée bien qu'elle rapporte plus que le sélecteur n'affiche** —
`email`, `phone`, `role_title` et l'organisation embarquée. C'est un écart assumé avec le patron
« une requête ne rapporte que ce qui est affiché » (§10.3), et il est motivé : le sélecteur du
§5.21, livré par 4c, compose déjà son libellé d'option en `« nom — organisation »` pour **distinguer
deux homonymes**, et il emploie cette même fonction. Poser ici une troisième forme de requête pour
la même relation dupliquerait une lecture sans rien démontrer de plus. **La composition du libellé
est en revanche EXTRAITE** dans `contacts.ts` — `libelleContactAvecOrganisation` — et les deux
surfaces l'appellent : une règle d'affichage écrite deux fois divergerait au premier changement.

### 13.4 QUAND les listes sont lues — jamais sur une fiche qui n'en a pas besoin

**Décision : chaque liste n'est lue que si le modèle résolu porte au moins un champ de son type**,
en comptant les champs de l'étape courante **et** ceux de la section repliée.

Le motif est celui que `lireMembresAffectables` a déjà écrit pour l'en-tête : « charger la liste
des membres pour un geste que la plupart des visites ne font pas serait une requête gratuite sur
l'écran le plus ouvert du produit ». La fiche d'affaire est cet écran. Un workflow dont le
formulaire ne porte aucun champ `contact` ni `user` — c'est le cas de **tous** les workflows du
dépôt avant le §13.6 — n'émet donc **aucune** requête supplémentaire.

Les deux listes sont lues **indépendamment** : un formulaire qui ne porte qu'un champ `user` ne lit
pas les contacts.

La section repliée compte dans la condition **bien qu'elle soit en lecture seule** : c'est
précisément là que la résolution du §13.1 opère, et une valeur y reste illisible si la liste n'est
pas chargée.

### 13.5 Contrat de comportement — les cinq états d'une liste, et la valeur qui ne se résout pas

Le contrôle rendu est un `select` (`docs/DESIGN_SYSTEM.md` §5.7), et son comportement dépend de
l'état de sa liste. Les états sont ceux du §5.8, sans invention.

| # | Situation | Attendu |
|---|---|---|
| a | liste **chargée**, valeur vide | le `select` affiche l'option vide en tête, aucune option retenue |
| b | liste **chargée**, valeur désignant une entrée de la liste | l'option correspondante est **retenue**, et son libellé est le nom |
| c | l'utilisateur retient une autre entrée | une écriture part **au changement**, comme pour `select` (§4 bis.3) ; les quatre états du §4 bis.6 s'appliquent sans changement |
| d | l'utilisateur retient l'option vide | la valeur est **vidée** — `normaliserSaisie` rend `null` sur `''` (§4 bis.5), aucun code nouveau |
| e | l'écriture est refusée `400` / `invalid_field_value` | message `form.save.refus.invalid` du dictionnaire fermé existant (§4 bis.7). MESURÉ : `{"code":"P0001","message":"invalid_field_value"}`, `400` |
| f | l'écriture est refusée à la **lectrice** | `403` / `42501`, message `form.save.refus.forbidden`. MESURÉ, inchangé |
| g | liste **en cours de lecture** | le `select` porte une **unique** option « Chargement… », est `aria-busy` et **désactivé** |
| h | liste **en erreur** | le `select` est désactivé, et une **action de reprise** sous le champ relit la liste (§5.8) |
| i | liste **vide** — le workspace n'a aucun contact, ou aucun membre | le `select` n'offre que l'option vide, et une mention le dit en toutes lettres, **sans action** |
| j | valeur **non nulle** qui ne désigne aucune entrée de la liste | une option **supplémentaire** est ajoutée, **retenue**, portant l'identifiant brut et la mention « référence inconnue ». Aucune écriture n'est émise |
| k | l'utilisateur quitte l'option du cas j pour une entrée réelle | l'écriture part ; l'option supplémentaire disparaît à la confirmation |
| l | section repliée, valeur résolue | le **nom** est affiché, en texte ordinaire |
| m | section repliée, valeur non résolue, ou liste indisponible | l'**identifiant brut** est affiché en **donnée technique** (§2 du design system, `code`) — jamais un nom inventé |

**Le cas j est le cœur de ce contrat, et il est MESURÉ.** Le §9.4 pose que la résolution est
vérifiée à l'écriture seule, `value` étant un `jsonb` où aucune clé étrangère n'est possible :
supprimer un contact laisse en place les valeurs qui le désignaient. Vérifié le 2026-08-18 sur la
pile — un contact sonde créé, désigné par une valeur, puis supprimé : la valeur **demeure**, et
PostgREST la rend inchangée. Un `select` qui ne porterait pas d'option pour elle afficherait sa
**première** option comme si elle avait été choisie : la donnée enregistrée serait **remplacée à
l'écran** par une autre, et un simple passage sur le champ risquerait de l'écraser en base. C'est
la « valeur par défaut trompeuse » que `CLAUDE.md` §18 interdit.

**Les cas g et h dérogent explicitement à une règle du §5.7 ter**, et le motif est écrit ici plutôt
que découvert plus tard : « le contrôle n'est jamais désactivé pendant l'envoi ». Cette règle vise
l'**envoi**, où les choix existent et où désactiver ferait perdre le focus au clavier ; ici, il n'y
a **rien à choisir** — la liste n'est pas là. La lecture précède toute interaction, personne n'y a
encore le focus, et un `select` vide mais actif serait une commande morte (§5.21). Le §13.9 du
design system porte cette règle.

### 13.6 Le seed enrichi — deux champs, deux valeurs, et les compteurs qu'ils déplacent

Le §9.6 avait **différé** cet enrichissement, en écrivant son motif : « le nombre *sept champs sur
le workflow source* est figé par dix preuves […] la donnée de démonstration arrive avec l'écran qui
la montre ». L'écran est ici. Les deux champs sont ajoutés au workflow global, à la suite des sept
existants :

| id | clé | libellé | type | position | règle de visibilité |
|---|---|---|---|---|---|
| `5eed…088` | `contact-principal` | Contact principal | `contact` | 8 | aucune — donc `visible` par défaut (§3.1) |
| `5eed…089` | `referent-technique` | Référent technique | `user` | 9 | aucune — donc `visible` par défaut (§3.1) |

et deux valeurs, sur l'affaire `Migration ERP Sogexia` (`…0c2`), choisie parce que son organisation
est **Sogexia**, dont Léo Marchand est le directeur achats — la donnée de démonstration raconte
alors quelque chose au lieu d'être un remplissage :

| card | champ | valeur | ce qu'elle démontre |
|---|---|---|---|
| `…0c2` | `contact-principal` | `"5eed…091"` (Léo Marchand) | un sélecteur de contact **renseigné**, résolu en toutes lettres |
| `…0c2` | `referent-technique` | `"5eed…012"` (Driss Lemoine) | un sélecteur de membre **renseigné** |

**Aucune règle de visibilité n'est posée sur ces deux champs, et c'est délibéré** : la valeur par
défaut du §3.1 les rend `visible` à **toutes** les étapes, si bien que les deux contrôles sont
atteignables depuis n'importe quelle affaire du workflow global. Les poser `required` obligerait en
outre à les renseigner pour tout déplacement, ce qui déplacerait les preuves de `move_card`
(`CRM-018`) sans rien démontrer de ces sélecteurs.

**Les compteurs déplacés, énumérés exhaustivement plutôt que découverts par un harnais rouge** —
c'est la « révision des dix comptes » que le §9.6 annonçait :

| Fichier | Ce qui bouge |
|---|---|
| `supabase/seed/apply-seed.sh` | tableau `CHAMPS` (7 → 9), tableau `VALEURS` (18 → 20), commentaires « sept champs », « six champs actifs », « vingt-sept couples sans règle » (7 × 8 − 15 = **41**), « dix-huit valeurs historiques », « les 21 valeurs » (→ 23) |
| `scripts/verify-champs-formulaire.sh` | `[ "$champs" = "7" ]` → `9` ; « sept champs » ; « chacune 7 champs » |
| `scripts/verify-copie-workflow.sh` | « sept champs » ; « chacune 7 champs remappés » |
| `scripts/verify-seed-demo.sh` | « le formulaire dérivé porte 7 champs » ; « 21 valeurs » |
| `supabase/tests/0008_copie_workflow.test.sql` | deux assertions « sept champs » |
| `supabase/tests/0010_champs_formulaire.test.sql` | « le seed pose sept champs » ; « la copie porte les sept champs remappés » |
| `supabase/tests/0021_transition_required_fields.test.sql` | « la copie sonde porte les sept champs » |
| `e2e/api/champs-formulaire.spec.ts` | deux titres et deux comptes |
| `e2e/api/copie-workflow.spec.ts` | « les sept champs de la source » |
| `e2e/ui/administration-workflows.spec.ts` | trois mentions « sept champs » |
| `docs/SPEC-seed.md` | §1082 (ligne 6 du tableau), §1085 (ligne 9), §1113 |

**Ces révisions ne sont pas des contournements.** La règle a changé par **livraison** : le seed
porte désormais neuf champs, et une preuve qui exigerait encore sept serait fausse. Le mécanisme
est celui de la décision 51 — la preuve est **révisée avec son motif écrit dans le fichier**,
jamais retirée ni désactivée (`docs/CloudWorker.md` §3.1).

### 13.7 Autorisations — l'écran n'en calcule toujours aucune

Rien de nouveau, et c'est le point : les deux sélecteurs écrivent par le **même** chemin que tous
les autres champs, `ecrireValeur`, sous les mêmes politiques. MESURÉ le 2026-08-18 :

| Acteur | Écriture d'une valeur de champ | Mesure |
|---|---|---|
| administratrice `…011` | valeur `contact` désignant `…091` | `201`, ligne écrite |
| administratrice `…011` | valeur `contact` inexistante | `400`, `P0001`, `invalid_field_value`, `DETAIL` « … ne désigne aucun contact de ce workspace » |
| administratrice `…011` | valeur `user` désignant le membre `…012` | `201`, ligne écrite |
| lectrice `…013` | toute valeur | `403`, `42501`, « new row violates row-level security policy » |

**Aucune commande n'est éteinte d'avance selon le rôle** (§5.21, §5.3, §5.13) : la lectrice voit les
deux sélecteurs, peut y choisir, et reçoit le refus **traduit** du dictionnaire fermé. Une liste
grisée ferait passer une décision de la base pour une décision d'écran (`CLAUDE.md` §10).

### 13.8 Limites nommées — sous-tranche 4d

Écrites plutôt que découvertes plus tard :

- **aucune création de contact « à la volée »**, que le §2.3 annonce pourtant pour le type
  `contact`. Aucun écran du produit ne crée de contact (§5.19, §5.21) ; l'ouvrir ici poserait une
  surface que rien ne spécifie. Le cas i dit alors la vérité et s'arrête là ;
- **aucune recherche ni filtre** dans les deux listes : un `select` natif porte déjà la recherche
  au clavier de la plateforme, et un filtre supposerait un volume que personne n'a mesuré
  (`CLAUDE.md` §21) ;
- **aucune pagination**, pour le motif exact du §10.3 ;
- **le type `file` reste en saisie texte.** Son chemin vise Storage, service distinct (§6.5 de
  `docs/SPEC-form-composer.md`), et rien n'a changé pour lui ;
- **une référence morte n'est ni réparée ni signalée ailleurs qu'à l'écran** : le cas j la rend
  visible là où elle est, sans la corriger. Le nettoyage des références mortes reste l'arbitrage
  attendu du §6, point 4 ;
- **le rôle d'un membre n'est pas affiché** dans le sélecteur `user` : `lireMembresAffectables` ne
  le rapporte pas, et l'ajouter changerait une lecture partagée avec l'en-tête pour un besoin qui
  n'est pas démontré.

### 13.9 Preuves exigées — sous-tranche 4d

| Niveau | Preuve |
|---|---|
| Unitaire | `webapp/src/lib/contacts.test.ts` (étendu) : `libelleContactAvecOrganisation`, avec et sans organisation |
| Unitaire | `webapp/src/app/FormulaireCard.test.tsx` (étendu) : les cas a à m du §13.5, dont le cas **j** — l'option supplémentaire d'une référence morte — et le cas **m** — l'identifiant brut en donnée technique ; ainsi que la condition du §13.4, aucune lecture émise quand aucun champ ne porte ces types |
| API | `e2e/api/valeurs-champs.spec.ts` (existant) : la résolution en base est déjà éprouvée par la tranche 3 ; cette sous-tranche n'ajoute aucune règle de base |
| E2E | `e2e/ui/formulaire-selecteurs.spec.ts` : sur la pile réelle et le seed, l'administratrice ouvre `Migration ERP Sogexia`, **lit les deux noms** dans les sélecteurs, change le contact principal, obtient « Enregistré », recharge et retrouve son choix, **puis rétablit la valeur seedée** ; la **lectrice** reçoit le refus traduit ; le parcours au **clavier** ; console **vierge** |
| Visible | captures sous `docs/captures/CRM-060/`, préfixées `formulaire-selecteurs-`, **observées** conformément à `CLAUDE.md` §16 : les deux sélecteurs renseignés, la liste déroulée, le refus de la lectrice, et les quatre paliers |
| i18n | `webapp/src/i18n/i18n.test.ts` (existant) : aucun texte visible en dur |
| Seed | le seed est rendu **INTACT** : neuf champs sur le workflow global, vingt-trois valeurs, et `contact-principal` de `…0c2` désignant de nouveau Léo Marchand après la campagne |

### 13.10 Definition of Done — sous-tranche 4d

- `webapp/src/lib/contacts.ts` : `libelleContactAvecOrganisation` extraite et exportée ;
- `webapp/src/app/FormulaireCard.tsx` : les deux sélecteurs, leurs cinq états, la résolution de la
  section repliée ; les deux lectures conditionnelles du §13.4 ;
- `supabase/seed/apply-seed.sh` : les deux champs et les deux valeurs du §13.6 ;
- les onze fichiers de preuve du §13.6 révisés **dans le même changement**, motif écrit ;
- clés de traduction ajoutées, aucun texte en dur ;
- preuves du §13.9 exécutées et vertes, captures produites **et observées** ;
- `docs/DESIGN_SYSTEM.md` §5.22 ajouté ; `docs/manual.md` ; `CHANGELOG.md`, dans le même changement ;
- commentaires `@spec` / `@verifies` sur chaque fichier touché.

Cette sous-tranche est la **dernière** de la tranche 4 (§10.1). Ce qui reste dû sur `CRM-060` après
elle est nommé au §13.8 et au §6 : la création d'un contact, la fiche d'un contact, et l'arbitrage
sur les références mortes.

---

## 14. Sous-tranche 4e — La création d'un contact depuis le carnet

Contrat écrit **avant toute ligne de code** (`CLAUDE.md` §5, `docs/CloudWorker.md` §3.2), après
**onze** mesures relevées à la main le 2026-08-18 sur la pile seedée, avec les jetons réels des
trois profils. Toutes les insertions de mesure ont été faites sur des **contacts sondes**, détruits
ensuite : le seed est rendu **intact**, ses trois contacts retrouvés à l'identique.

Le §13.8 nommait ce manque en toutes lettres : « **aucune création de contact « à la volée »**,
que le §2.3 annonce pourtant pour le type `contact`. Aucun écran du produit ne crée de contact
(§5.19, §5.21) ». Quatre surfaces lisent désormais les contacts — le carnet, la fiche
d'organisation, le bloc d'une affaire et les deux sélecteurs du formulaire — et **aucune** ne
permet d'en ajouter un : le carnet du seed est le seul carnet possible.

### 14.1 Ce que la sous-tranche livre, et ce qu'elle ne livre pas

**Elle livre**, dans le carnet (§10, `docs/DESIGN_SYSTEM.md` §5.19) :

- un geste **« Nouveau contact »** qui ouvre un formulaire **dans le flux du document**, au-dessus
  du tableau, sur le patron du bloc de la sous-tranche 4c (§12.6, `docs/DESIGN_SYSTEM.md` §5.21) ;
- les **cinq champs** de la ligne du carnet : nom (obligatoire), organisation (choix parmi les
  organisations du workspace), fonction, email, téléphone ;
- la **traduction fermée des cinq refus** mesurés au §14.3, un contact créé **rejoignant le
  tableau** sans rechargement de page.

**Elle ne livre pas**, et chaque manque est nommé au §14.7 : aucune modification ni suppression
d'un contact existant, aucune création d'**organisation**, aucune création depuis les trois autres
surfaces qui lisent des contacts, et aucun rapprochement de doublon au-delà de ce que l'unicité de
la base refuse déjà.

### 14.2 Où le geste s'ancre — au-dessus du tableau, jamais dans une modale

Le carnet est un **tableau du §5.9**, et le geste s'ancre entre son titre et lui, comme le
formulaire de 4c s'ancre dans le flux du bloc des contacts d'une affaire (§12.2). Le motif est
identique et déjà écrit au §5.21 du design system : une modale prend le focus, cache la liste que
l'on vient de lire, et oblige à mémoriser ce qu'elle recouvre — or **la liste est précisément ce
qui dit si le contact existe déjà**.

Le formulaire est **replié par défaut** : le carnet est d'abord une surface de lecture, et un
formulaire toujours déplié pousserait le tableau sous la ligne de flottaison à chaque visite.

### 14.3 Ce que l'écriture envoie, et les cinq refus — MESURÉS

L'écriture est un `POST /rest/v1/contacts` avec `Prefer: return=representation`, la ligne créée
étant insérée dans le tableau sans relecture complète. `workspace_id` est celui du workspace
courant ; `source` n'est **pas** envoyé — la base pose `manual` par défaut, mesuré.

| # | Envoi | Réponse mesurée le 2026-08-18 |
|---|---|---|
| 1 | administratrice, nom seul | `201`, ligne rendue, `source` = `manual`, `organization_id` = `null` |
| 2 | administratrice, nom + organisation du workspace | `201`, ligne rendue |
| 3 | `business_developer`, nom + email | `201` — l'écriture n'est pas réservée à l'administration |
| 4 | **lectrice**, nom seul | `403` / `42501`, « new row violates row-level security policy » |
| 5 | administratrice, email **déjà porté**, casse différente | `409` / `23505`, `contacts_workspace_email_key` |
| 6 | administratrice, nom **entièrement blanc** | `400` / `23514`, `contacts_full_name_check` |
| 7 | administratrice, email malformé (`pasunemail`) | `400` / `23514`, `contacts_email_check` |
| 8 | administratrice, email **chaîne vide** | `400` / `23514`, `contacts_email_check` |
| 9 | administratrice, téléphone **chaîne vide** | `400` / `23514`, `contacts_phone_check` |
| 10 | administratrice, organisation inconnue | `409` / `23503`, `contacts_organization_id_workspace_id_fkey` |
| 11 | administratrice, `workspace_id` étranger | `403` / `42501` — c'est le `WITH CHECK` |

**Les mesures 8 et 9 décident du contrat de saisie plutôt que de le confirmer.** Un champ
facultatif laissé vide ne s'envoie **jamais** comme `''` : les contraintes de forme refusent la
chaîne vide sur `email`, `phone` et `role_title`. C'est exactement la règle que `rattacherContact`
applique déjà au rôle d'un rattachement (§12.3) — `normaliserFacultatif` rend `null` sur une saisie
blanche —, et elle est ici **partagée** plutôt que réécrite.

**La mesure 5 décide du classement.** `23505` (email déjà porté) et `23503` (organisation inconnue)
rendent **tous deux `409`** : le code HTTP seul ne les sépare pas, alors qu'ils appellent des gestes
opposés — corriger l'email, ou relire une liste d'organisations périmée. Le classement lit donc le
**code PostgreSQL d'abord**, patron de `classerRefusRattachement` (§12.5).

### 14.4 Les refus, traduits par un dictionnaire FERMÉ

Cinq clés, et aucune interpolation d'un message serveur dans l'interface (`docs/DESIGN_SYSTEM.md`
§10) :

| Classement | Cause mesurée | Clé |
|---|---|---|
| `interdit` | `403` / `42501` | `contacts.creation.refus.interdit` |
| `doublon` | `409` / `23505` | `contacts.creation.refus.doublon` |
| `organisationInconnue` | `409` / `23503` | `contacts.creation.refus.organisation` |
| `saisieInvalide` | `400` / `23514` | `contacts.creation.refus.saisie` |
| `indisponible` | tout le reste | `contacts.creation.refus.indisponible` |

**Un refus n'efface jamais la saisie** (§12.6) : la personne corrige et renvoie. Le formulaire
reste ouvert, et le message vit **sous** lui, près de ce qui l'a causé.

### 14.5 Contrat de comportement — sous-tranche 4e

| # | Situation | Attendu |
|---|---|---|
| a | carnet chargé, geste replié | un seul bouton « Nouveau contact », le tableau inchangé |
| b | le geste est déclenché | le formulaire s'ouvre, le **focus entre** sur le champ du nom |
| c | le formulaire est refermé | le focus **revient** à la commande qui l'a ouvert |
| d | nom vide ou blanc | l'envoi est **refusé côté écran**, aucun appel réseau, le champ est signalé |
| e | nom seul, envoi accepté | la ligne **rejoint le tableau à sa place de tri**, le formulaire se referme |
| f | organisation retenue | la cellule d'organisation de la ligne neuve porte son **lien** (§5.19) |
| g | email déjà porté | message `doublon`, formulaire ouvert, **saisie conservée** |
| h | organisation inconnue (liste périmée) | message `organisation`, saisie conservée |
| i | lectrice | message `interdit`, saisie conservée, **aucune commande éteinte d'avance** |
| j | pendant l'envoi | la commande d'envoi est `aria-busy` et l'envoi ne part **qu'une fois** |
| k | liste d'organisations en erreur | le sélecteur est désactivé avec une action de reprise (§13.5 cas h) |
| l | liste d'organisations vide | le sélecteur n'offre que l'option vide, mention sans action (§13.5 cas i) |

**Le cas d est le seul contrôle d'écran, et il ne remplace aucune règle** : la base refuse déjà un
nom blanc (mesure 6). L'écran l'anticipe pour ne pas faire payer un aller-retour à une faute
évidente, mais le refus serveur reste traduit si la saisie passe malgré tout (`CLAUDE.md` §10).

### 14.6 Autorisations — l'écran n'en calcule aucune

Rien de nouveau, et c'est le point : la lectrice **voit** le geste, ouvre le formulaire, envoie, et
reçoit le refus **traduit**. Une commande grisée selon le rôle ferait passer une décision de la base
pour une décision d'écran (`CLAUDE.md` §10, `docs/DESIGN_SYSTEM.md` §5.21).

### 14.7 Limites nommées — sous-tranche 4e

- **aucune modification ni suppression** d'un contact existant : les politiques `contacts_maj` et
  `contacts_suppression` existent (§3), aucun écran ne les exerce, et le cycle de vie d'un contact
  reste l'arbitrage du §6, point 1 ;
- **aucune création d'organisation** : le sélecteur n'offre que celles qui existent ;
- **aucune création depuis les trois autres surfaces** — bloc d'une affaire, sélecteur du
  formulaire, fiche d'organisation. Le carnet est la surface de gestion du carnet ;
- **aucun rapprochement de doublon** au-delà de l'unicité que la base refuse : détecter un homonyme
  sans email est `CRM-P05`, qui a son propre porteur ;
- **aucune pagination**, pour le motif exact du §10.3.

### 14.8 Preuves exigées — sous-tranche 4e

| Niveau | Preuve |
|---|---|
| Unitaire | `webapp/src/lib/contacts.test.ts` (étendu) : la charge réellement envoyée par `creerContact` — les facultatifs blancs rendus `null`, jamais `''` — et le classement des cinq refus du §14.4 |
| Unitaire | `webapp/src/app/Carnet.test.tsx` (étendu) : les cas a à l du §14.5 |
| API | `e2e/api/contacts.spec.ts` (étendu) : les onze mesures du §14.3 avec les jetons réels, chaque refus **relisant la ligne** pour la constater absente (décision 70) |
| E2E | `e2e/ui/carnet-contacts.spec.ts` (étendu) : la création par les gestes de l'écran puis **la suppression du contact créé** pour rendre le seed intact, le même parcours au **clavier**, le refus opposé à la lectrice avec sa saisie conservée ; console **vierge** |
| Visible | captures sous `docs/captures/CRM-060/`, préfixées `carnet-creation-`, **observées** (`CLAUDE.md` §16) : le formulaire ouvert, la ligne obtenue, le refus, et les quatre paliers |
| Seed | rendu **INTACT** : trois contacts, deux rattachements, Léo Marchand sur exactement une card active |

### 14.9 Definition of Done — sous-tranche 4e

- `webapp/src/lib/contacts.ts` : `creerContact` et `classerRefusCreation` ;
- `webapp/src/app/Carnet.tsx` : le geste, le formulaire replié, les douze cas du §14.5 ;
- clés de traduction ajoutées, aucun texte en dur ;
- preuves du §14.8 exécutées et vertes, captures produites **et observées** ;
- `docs/DESIGN_SYSTEM.md` §5.23 ; `docs/manual.md` ; `CHANGELOG.md`, dans le même changement ;
- commentaires `@spec` / `@verifies` sur chaque fichier touché.

**Aucune migration : cette sous-tranche n'ouvre aucune politique et ne crée aucune colonne.** Elle
n'exerce que la politique d'insertion posée par la migration `0045` et déjà prouvée par la
tranche 1.

---

## 15. Sous-tranche 4f — La fiche d'un contact

Contrat écrit **avant toute ligne de code** (`CLAUDE.md` §5, `docs/CloudWorker.md` §3.2), après
**seize** mesures relevées à la main le 2026-08-19 sur la pile seedée, avec les jetons réels des
trois profils et avec la clé anonyme. Les mesures qui exigeaient plusieurs rattachements ont été
faites sur des **rattachements sondes**, détruits ensuite : le seed est rendu **intact**, ses trois
contacts et ses deux rattachements retrouvés à l'identique.

Le §11.8 nommait ce manque en toutes lettres : « **le contact de la fiche ne mène nulle part.** Il
n'existe pas de fiche de contact, et 4b n'en crée pas : un lien serait mort ». Quatre surfaces
nomment un contact — le carnet, la fiche d'organisation, le bloc d'une affaire et le sélecteur du
formulaire — et **aucune** ne mène à lui. Un contact est pourtant l'objet métier de première classe
que le §1 de ce document annonce : il est le seul de la tranche à n'avoir aucune page.

### 15.1 Ce que la sous-tranche livre, et ce qu'elle ne livre pas

**Elle livre** une route de détail qui, pour un contact donné :

- rend **ce qui le caractérise** — sa fonction, son email, son téléphone, et son **organisation**,
  qui est un lien vers la fiche du §11 ;
- rend **ses affaires** — les cards auxquelles il est rattaché, avec son **rôle dans chacune** et un
  lien vers chaque affaire. C'est l'**historique transverse** que la Definition of Done de `CRM-060`
  nomme, et que la tranche 4 n'avait livré que dans l'autre sens : 4c dit les contacts d'une
  affaire, 4f dit les affaires d'un contact ;
- devient la **destination** que le nom du contact n'avait sur aucune des quatre surfaces.

**Elle ne livre pas**, et chaque manque est nommé au §15.8 : aucune modification ni suppression d'un
contact, aucun rattachement depuis cette page, aucun fil d'activité, aucune pagination.

### 15.2 Où la fiche s'ancre — `/contacts/:idContact`

**Décision : une route de détail SOUS le carnet**, pour le motif exact du §11.2 — le carnet est la
surface d'entrée qui la peuple.

**Aucune collision avec `/contacts/organisations/:idOrganisation`, et ce n'est pas une chance mais
une propriété du chemin** : la fiche d'organisation porte **trois** segments, celle du contact
**deux**. Un patron à deux segments ne peut pas apparier une adresse qui en a trois, quel que soit
le classement des routes. Le contact garde donc l'adresse la plus courte, qui est celle de l'objet
de première classe, et l'organisation reste sous son préfixe.

Conséquences, identiques à celles du §11.2 et tenues dans le même changement :

- **la fiche ne figure PAS dans `ROUTES`** — son titre est le **nom du contact**, donc une donnée et
  non une clé de traduction. La couverture exacte `ROUTES` ⇄ `ENTREES_TRANSVERSES` que
  `routes.test.tsx` exige reste **inchangée** ;
- **elle porte sa propre coquille `AppShell`**, `titreRoute` alimenté par le nom lu, avec une clé de
  repli pour le chargement et l'introuvable — le patron de `RouteCard` et de `FicheOrganisation` ;
- **le contact est désigné par son identifiant** : `contacts` ne porte aucun slug, et l'email ne
  peut pas en tenir lieu — il est **nul** pour Élise Fabre (§10.3).

### 15.3 Ce que la fiche lit — mesuré sur la pile réelle

MESURÉ le 2026-08-19 avec le jeton réel de l'administratrice, la requête **unique** que l'écran
émettra :

```
GET /rest/v1/contacts
    ?id=eq.<idContact>
    &select=id,full_name,email,phone,role_title,organization_id,
            organizations(id,name,domain),
            card_contacts(role,cards!inner(id,title,archived_at,
                          channels!cards_channel_id_workspace_id_fkey(slug,tracks(slug))))
    &card_contacts.cards.deleted_at=is.null
    &card_contacts.order=cards(title)
```

rend, pour Léo Marchand (`…091`) :

```
[{"id":"5eed…091","full_name":"Léo Marchand","email":"leo.marchand@sogexia.example",
  "phone":null,"role_title":"Directeur achats","organization_id":"5eed…081",
  "organizations":{"id":"5eed…081","name":"Sogexia","domain":"sogexia.example"},
  "card_contacts":[{"role":"decideur",
    "cards":{"id":"5eed…0c2","title":"Migration ERP Sogexia","archived_at":null,
             "channels":{"slug":"grands-comptes","tracks":{"slug":"conseil-ia"}}}}]}]
```

**Quatre mesures ont DÉCIDÉ de cette requête plutôt que de la confirmer.**

- **L'embarquement `cards → channels` est AMBIGU, et il faut le nommer.** MESURÉ : la forme naïve
  `card_contacts(cards(channels(...)))` est refusée par **`PGRST201`** — deux relations existent
  entre `cards` et `channels`, `cards_channel_id_workflow_id_fkey` et
  `cards_channel_id_workspace_id_fkey`. C'est le défaut que le §10.3 avait rencontré ailleurs et
  contourné par deux lectures ; ici il se **désigne** au lieu de se contourner, par
  `channels!cards_channel_id_workspace_id_fkey`, et la chaîne **quatre niveaux**
  `contacts → card_contacts → cards → channels → tracks` tient alors en **une seule requête**,
  mesurée `200`. La clé retenue est celle du **cloisonnement** — `(channel_id, workspace_id)` —, et
  non celle du workflow : c'est la relation qui dit à quel channel une affaire appartient, le
  workflow n'étant qu'une propriété partagée.
- **L'adresse d'une affaire exige les slugs de son track et de son channel**, ce que
  `lireCheminCard` (`inbox.ts`) obtenait en **trois** requêtes en cascade faute d'avoir levé
  l'ambiguïté. La fiche n'en émet **aucune de plus** : l'embarquement désigné les rapporte toutes.
- **UNE AFFAIRE À LA CORBEILLE NE FIGURE PAS SUR LA FICHE, ET C'EST MESURÉ.** Sans filtre, une card
  dont `deleted_at` n'est pas nul **apparaît** dans l'embarquement — mesuré sur « Saisie erronée ».
  La lister offrirait un lien vers une affaire dont la **corbeille** est la surface propriétaire
  (`CRM-077`). La forme qui l'écarte est `cards!inner(...)` avec
  `card_contacts.cards.deleted_at=is.null` : mesurée, elle **retire la ligne entière** au lieu de
  rendre `cards: null`, ce qu'un embarquement non-`inner` aurait fait et qui aurait obligé l'écran à
  filtrer une donnée que le serveur sait déjà écarter.
- **Une affaire ARCHIVÉE reste rendue, et son archivage est DIT.** Une affaire archivée est une
  affaire réelle et lisible, et l'historique d'un contact est précisément ce que cette page sert :
  la taire mentirait sur le passé. `archived_at` est donc demandé — la seule colonne de cycle de vie
  que l'écran affiche — et rendu comme une **pilule**, jamais comme une absence.

**Le tri agit, et il est vérifié dans les deux sens.** La relation `card_contacts → cards` est
**to-one**, si bien que `card_contacts.order=cards(title)` est accepté — l'écart mesuré au §12.3
entre une relation to-one et une relation to-many vaut ici aussi. Une seule ligne ne prouverait
qu'une tolérance : mesuré sur **deux** rattachements sondes, l'ordre ascendant rend
`["Audit sécurité applicative","Contrat cadre 2025"]` et le descendant l'inverse. Le tri par le
**titre** est celui d'un lecteur qui cherche une affaire par son nom ; l'écran ne retrie pas.

**`role_title` ET `role` sont demandés tous les deux, et ils ne se confondent pas ici.** Le §12.3
refusait de les afficher ensemble sur une **ligne** d'affaire, où deux « rôles » se seraient
contredits. Sur cette page ils vivent dans **deux zones distinctes** : `role_title` caractérise le
contact en tête de page, `role` qualifie chaque rattachement dans sa ligne. La distinction est
portée par la structure, pas par une glose.

**`source` et `created_at` ne sont pas demandés**, pour le motif du §10.3 : une requête ne rapporte
que ce qui est affiché.

### 15.4 Autorisations — l'écran n'en calcule aucune, et les droits fins TRAVERSENT l'embarquement

MESURÉ le 2026-08-19, avec les jetons réels :

| # | Acteur / adresse | Mesure |
|---|---|---|
| 1 | administratrice, `id` d'un contact du workspace | `200`, **1 ligne**, organisation et affaires embarquées |
| 2 | administratrice, `id` bien formé mais **inexistant** | `200` et **`[]`** |
| 3 | **anonyme**, `id` d'un contact réel | `200` et **`[]`** |
| 4 | administratrice, `id` **qui n'est pas un uuid** | **`400`**, `22P02`, `invalid input syntax for type uuid` |
| 5 | `business_developer`, Léo Marchand | `200`, 1 ligne, l'affaire « Migration ERP Sogexia » rendue |
| 6 | **lectrice**, Léo Marchand | `200`, 1 ligne, **`card_contacts: []`** |
| 7 | **lectrice**, Sophie Dupont | `200`, 1 ligne, l'affaire « Refonte intranet Ville de Lyon » rendue |

Les cas 1 à 4 reproduisent exactement le §11.4, et la **même** décision en découle : les cas 2, 3 et
4 rendent le **même** écran « contact introuvable », et un identifiant mal formé **n'émet aucune
requête** — un `400` classé en erreur donnerait une commande de reprise morte sur une adresse que
l'utilisateur édite lui-même.

**Les cas 6 et 7 sont ceux que la mesure a rendus décisifs, et ils confirment une propriété plutôt
qu'ils n'en créent une.** La lectrice n'a pas accès au track « Conseil IA » (`CRM-012`) : sur la
fiche de Léo, dont l'unique affaire vit dans « Grands comptes », `card_contacts` rend **`[]`** — la
ligne de rattachement est **retirée**, et non rendue avec une affaire nulle. Sur la fiche de Sophie,
dont l'affaire vit dans un track qui lui est ouvert, l'affaire **est** rendue. Les droits fins de
`cards` traversent donc l'embarquement, et **l'écran ne calcule aucun droit** : il rend ce que le
backend consent (`docs/DAT.md` §3.1, `docs/SPEC-permissions-rls.md` §7). La zone « affaires » vide
d'un lecteur restreint est l'état vide ordinaire du §5.8, jamais un refus mis en scène.

Cette sous-tranche ne livre **aucune écriture**, donc **aucun refus d'écriture** n'est à traduire.

### 15.5 De quoi l'écran a l'air

Le détail visuel est écrit dans `docs/DESIGN_SYSTEM.md` §5.24, ajouté dans le même changement. Trois
décisions découlent de la **donnée** et sont rappelées ici :

1. **Deux zones, et le patron du §11.5 tenu à l'identique.** Ce qui caractérise le contact est une
   **liste de définitions** ; ses affaires sont des lignes homogènes et reprennent le **tableau du
   §5.9**. Le tableau porte **trois** colonnes — affaire, rôle dans l'affaire, état — et non
   davantage : le track et le channel d'une affaire sont dans son adresse, et les répéter en
   colonnes remplirait la ligne d'une information que le clic donne déjà.
2. **`email` et `phone` sont des données techniques** (§2) : monospace, valeur absente laissée
   **vide**, jamais un tiret. **`role_title` n'en est pas une** — c'est un intitulé de fonction, du
   texte ordinaire.
3. **Le titre d'une affaire est un LIEN vers elle**, construit sur les slugs rapportés par
   l'embarquement (§15.3). Une affaire **archivée** porte en outre une **pilule** « Archivée »
   (§5.6) : elle reste atteignable, son état est dit.

**L'organisation du contact est un lien vers sa fiche** (§11), et une valeur absente reste **vide et
sans lien** — la règle que le carnet tient déjà depuis le §11.6.

### 15.6 Quatre surfaces gagnent leur destination — une règle du §11 RÉVISÉE par livraison

Le §11.8 et le §5.20 du design system posaient que le nom d'un contact est un **texte, jamais un
lien**, avec leur condition écrite : « il n'existe pas de fiche de contact, et un lien y serait
mort ». **Cette condition tombe ici**, exactement comme le §11.6 l'avait fait tomber pour
l'organisation. La règle change donc par **livraison**, jamais par contournement.

Deux surfaces gagnent le lien dans ce changement, et **deux ne le gagnent pas** :

- **le carnet** (§10) : le nom du contact mène à sa fiche. C'est la colonne de tête d'un tableau
  dont chaque ligne EST un contact ;
- **la fiche d'organisation** (§11) : le nom de chaque contact mène à sa fiche, ce que le §11.8
  nommait comme le manque à combler ;
- **le bloc des contacts d'une affaire** (§12) ne le gagne PAS dans cette sous-tranche, et c'est
  nommé au §15.8 : ce bloc porte des **gestes d'écriture** — détacher un contact —, et poser un lien
  dans une ligne qui porte déjà une commande destructrice demande de rejouer sa preuve clavier
  complète. L'écart est nommé plutôt qu'improvisé ;
- **le sélecteur du formulaire** (§13) ne le gagne pas non plus : une option de liste déroulante ne
  peut pas porter de lien, et c'est une propriété du contrôle, pas un choix.

Les preuves qui **figeaient l'absence de lien** — `webapp/src/app/FicheOrganisation.test.tsx`,
`webapp/src/app/Carnet.test.tsx` et `e2e/ui/contacts.spec.ts` — sont **RÉVISÉES avec leur motif
écrit dans le fichier**, jamais retirées ni contournées : c'est le mécanisme de la décision 51, et
ce qu'elles exigent devient « le nom du contact mène à sa fiche », qui reste vérifiable.

### 15.7 Le seed — pourquoi il n'est PAS modifié, et c'est MESURÉ

`CLAUDE.md` §8 exige que le seed démontre chaque fonctionnalité livrée et couvre les branches
alternatives. **Les trois contacts du seed les couvrent déjà toutes**, ce qui a été vérifié et non
supposé :

| Branche de la fiche | Contact du seed qui la démontre |
|---|---|
| organisation présente, et une affaire | **Léo Marchand** — Sogexia, « Migration ERP Sogexia » |
| organisation **absente**, et une affaire | **Sophie Dupont** — aucune organisation, « Refonte intranet Ville de Lyon » |
| **aucune affaire** — état vide de la zone | **Élise Fabre** — Studio Meunier, zéro rattachement |
| email absent / téléphone absent | **Élise Fabre** (email nul) et **Léo Marchand** (téléphone nul) |
| fonction absente | **Sophie Dupont** (`role_title` nul) |
| affaire **invisible** au lecteur restreint | **Léo Marchand** lu par la lectrice — `card_contacts: []` |

**Une seule branche n'est pas seedée : l'affaire ARCHIVÉE rattachée à un contact.** Elle n'est pas
ajoutée, et le motif est mesuré : le seul rattachement supplémentaire possible déplacerait la garde
de convergence de `apply-seed.sh` — deux rattachements exactement — et la règle 3 du classement
(§8) lit « Léo rattaché à exactement une card active ». Un enrichissement qui déplace un compteur
figé par une preuve existante n'est pas gratuit, et le §11.7 a déjà tranché ce départage : on
n'enrichit que ce qui ne casse rien. La pilule « Archivée » est donc éprouvée par une **preuve
unitaire** sur une réponse construite, et l'écart est **nommé** au §15.8 plutôt que masqué.

### 15.8 Limites nommées — sous-tranche 4f

- **aucun geste d'écriture** : ni modification, ni suppression, ni rattachement depuis cette page.
  Les privilèges existent en base depuis la tranche 1 ; l'écart est nommé, non compensé par une
  commande morte ;
- **le bloc des contacts d'une affaire (§12) ne mène toujours pas à la fiche**, pour le motif
  du §15.6 — sa ligne porte une commande destructrice dont la preuve clavier devrait être rejouée ;
- **aucune pagination des affaires**, pour le motif exact du §10.3 : aucun volume n'est mesuré ;
- **aucun fil d'activité du contact.** Les emails et les événements d'une affaire vivent dans le fil
  unifié de cette affaire (§5.11) ; les agréger par contact est une lecture que rien ne spécifie ;
- **une affaire archivée n'est démontrée que par une preuve unitaire**, le seed ne portant aucun
  rattachement vers une affaire archivée (§15.7) ;
- **une affaire à la corbeille est invisible**, et sa disparition n'est pas expliquée à l'écran :
  aucun texte ne dit « une affaire supprimée n'est pas listée ». La corbeille est la surface qui en
  répond (`CRM-077`).

### 15.9 Contrat de comportement — sous-tranche 4f

| # | Situation | Attendu |
|---|---|---|
| a | contact lisible, avec organisation et affaires | le nom en titre, ses caractéristiques, et une ligne par affaire dans l'ordre du titre |
| b | contact **sans organisation** (Sophie Dupont) | la valeur « organisation » est **vide et sans lien**, aucune erreur |
| c | contact **avec** organisation (Léo Marchand) | l'organisation est un **lien** vers sa fiche (§11) |
| d | données absentes (email, téléphone, fonction) | cellules **vides**, jamais un tiret |
| e | contact **sans affaire** (Élise Fabre) | la zone des affaires rend l'état **vide**, sans action ; les caractéristiques restent rendues |
| f | affaire **archivée** | la ligne porte la pilule « Archivée », et son titre reste un **lien** |
| g | affaire à la **corbeille** | la ligne **n'est pas rendue** — le serveur l'a écartée (§15.3) |
| h | identifiant inexistant, ou appelant sans droit | « contact introuvable », avec un retour vers le carnet — **le même écran dans les deux cas** |
| i | identifiant mal formé (non-uuid) | « contact introuvable », **aucune requête émise** (§15.4) |
| j | lecture en vol | squelettes, jamais un spinner plein écran |
| k | lecture en échec | état d'erreur avec action de reprise, qui relance réellement la lecture |
| l | aucun client (aucun espace de travail) | état vide dédié, aucune requête |
| m | depuis le carnet | le nom du contact est un **lien** qui ouvre sa fiche |
| n | depuis la fiche d'organisation | le nom de chaque contact est un **lien** qui ouvre sa fiche |
| o | lecteur restreint (lectrice sur Léo) | la zone des affaires rend l'état **vide** — l'écran ne calcule aucun droit (§15.4) |

### 15.10 Preuves exigées — sous-tranche 4f

| Niveau | Preuve |
|---|---|
| Unitaire | `webapp/src/lib/contacts.test.ts` (étendu) : la requête émise — table, colonnes, **désambiguïsation** de `channels`, filtre `deleted_at`, tri des rattachements ; le contact rendu `null` sur réponse vide ; le refus de forme du cas i **sans appel réseau** ; l'adresse d'affaire construite depuis les slugs embarqués ; les trois issues du contrat asynchrone |
| Unitaire | `webapp/src/app/FicheContact.test.tsx` : les cas a à l du §15.9 |
| Unitaire | `webapp/src/app/Carnet.test.tsx` (RÉVISÉ, §15.6) : le nom du contact est désormais un lien vers sa fiche |
| Unitaire | `webapp/src/app/FicheOrganisation.test.tsx` (RÉVISÉ, §15.6) : le nom de chaque contact est désormais un lien vers sa fiche |
| E2E | `e2e/ui/contacts.spec.ts` (étendu et RÉVISÉ) : depuis le carnet, le clic sur « Léo Marchand » ouvre sa fiche ; l'affaire y est un lien qui ouvre réellement l'affaire ; Élise rend l'état vide ; une adresse mal formée rend « introuvable » ; l'accès au **clavier** ; la **lectrice** sur Léo rend la zone des affaires vide (cas o) |
| E2E | `e2e/api/contacts.spec.ts` (étendu) : les mesures du §15.3 et du §15.4 avec les jetons réels des trois profils, dont l'ambiguïté `PGRST201` **figée comme telle** et l'exclusion de la corbeille |
| Visible | captures sous `docs/captures/CRM-060/`, **observées** conformément à `CLAUDE.md` §16 : la fiche peuplée, la fiche sans affaire, l'introuvable, et le rendu à 390 px |
| i18n | `webapp/src/i18n/i18n.test.ts` (existant) : aucun texte visible en dur |
| Seed | le seed rejoué **converge**, et il n'est PAS modifié (§15.7) |

### 15.11 Definition of Done — sous-tranche 4f

- `webapp/src/lib/contacts.ts` : la lecture du §15.3, son type, et la construction de l'adresse
  d'une affaire ;
- `webapp/src/app/FicheContact.tsx` : les deux zones et les cinq états ;
- `CHEMIN_CONTACT` et `cheminContact` dans `chemins.ts`, montés par `App` **hors de `ROUTES`** ;
- `webapp/src/app/Carnet.tsx` et `webapp/src/app/FicheOrganisation.tsx` : le nom du contact devient
  un lien (§15.6) ;
- preuves du §15.10 exécutées et vertes, captures produites **et observées** ;
- clés de traduction ajoutées, aucun texte en dur ;
- `docs/DESIGN_SYSTEM.md` §5.24 ajouté et §5.20 révisé ; `docs/SPEC-webapp.md` §5.2 ;
  `docs/manual.md` ; `CHANGELOG.md`, dans le même changement ;
- commentaires `@spec` / `@verifies` sur chaque fichier touché.

**Aucune migration : cette sous-tranche ne crée aucune colonne et n'ouvre aucune politique.** Elle
ne fait que lire sous la RLS posée par la migration `0045` et sous les droits fins de `cards` posés
par `CRM-012`, tous deux déjà prouvés.

**Ce qui restera dû sur `CRM-060` après 4f** : l'arbitrage sur les **références mortes** (§6,
point 4), et les gestes d'écriture nommés au §15.8. L'unité demeure `[~]`.

---

## 16. Sous-tranche 4g — La modification d'un contact depuis sa fiche

Contrat écrit **avant toute ligne de code** (`CLAUDE.md` §5, `docs/CloudWorker.md` §3.2), après
**vingt et une** mesures relevées à la main le 2026-08-19 sur la pile seedée, avec les jetons réels
des trois profils et avec la clé anonyme. Les écritures de mesure ont porté sur un **contact sonde**
détruit ensuite, sauf les mesures 19 et 21 qui devaient porter sur une ligne du seed et qui sont des
refus : le seed est rendu **intact**, ses trois contacts relus à l'identique après la campagne.

Le §15.8 nommait ce manque en toutes lettres : « **aucun geste d'écriture** : ni modification, ni
suppression, ni rattachement depuis cette page. Les privilèges existent en base depuis la tranche 1 ;
l'écart est nommé, non compensé par une commande morte. » La politique `contacts_maj_bizdev_admin`
est posée par la migration `0045` et prouvée par la tranche 1 ; **aucun écran ne l'exerce**. Un
contact créé au carnet (§14) est aujourd'hui définitif : une coquille dans un nom, un email qui
change d'employeur, une fonction promue n'ont aucune surface pour se corriger.

### 16.1 Ce que la sous-tranche livre, et ce qu'elle ne livre pas

**Elle livre**, sur la fiche du §15 :

- un geste **« Modifier »** qui ouvre un formulaire **dans le flux du document**, au-dessus des deux
  zones, sur le patron du §5.21 et du §5.23 — jamais une modale ;
- les **cinq champs** du §14.1, **préremplis** avec les valeurs courantes du contact : nom
  (obligatoire), organisation, fonction, email, téléphone ;
- la **traduction fermée des six refus** mesurés au §16.3, la fiche rendant les nouvelles valeurs
  **sans relecture** ;
- le **titre de la route** qui suit le nouveau nom, le nom étant une donnée (§15.2).

**Elle ne livre pas**, et chaque manque est nommé au §16.8 : aucune **suppression** d'un contact,
aucun rattachement depuis cette page, aucune création d'organisation, et aucune détection d'écriture
concurrente.

**La suppression est délibérément hors de cette sous-tranche, et le motif n'est pas le temps.**
Supprimer un contact laisse en place les valeurs `jsonb` qui le désignaient — c'est l'arbitrage du
**§6, point 4**, explicitement laissé au responsable et **non tranché**. Livrer la suppression
avant cet arbitrage produirait exactement les références mortes que le §6 nomme. La modification,
elle, n'en produit aucune : la clé du contact ne change pas.

### 16.2 Où le geste s'ancre — sur la fiche, jamais au carnet

**Décision : la fiche, et elle seule.** Le carnet est une liste ; la fiche est la surface de
l'objet, celle qui rend déjà les cinq valeurs que le formulaire modifie. Poser le geste au carnet
obligerait à choisir entre une édition en ligne — qui casse le tableau du §5.9 — et une navigation
vers la fiche, c'est-à-dire ce geste-ci.

Le formulaire s'ancre **entre le titre de la route et la zone 1**, replié par défaut, pour le motif
exact du §14.2 : la fiche est d'abord une surface de lecture, et **ce qu'elle affiche est
précisément ce que l'on vient corriger** — une modale le recouvrirait.

**Les cinq champs sont ceux du §14.1, et ils ne sont pas réécrits.** La saisie, ses libellés, ses
identifiants d'accessibilité et les trois états du sélecteur d'organisation (§13.5 cas h et i) sont
**partagés** avec le formulaire de création par un composant de champs commun, plutôt que dupliqués :
deux copies d'une même saisie divergeraient au premier champ ajouté.

### 16.3 Ce que l'écriture envoie, et les six refus — MESURÉS

L'écriture est un `PATCH /rest/v1/contacts?id=eq.<id>` avec `Prefer: return=representation`, la ligne
modifiée revenant avec son organisation embarquée — la fiche s'actualise donc **sans relecture**.
`workspace_id` n'est **jamais** envoyé : il n'est pas modifiable depuis cet écran, et l'envoyer
n'ouvrirait qu'un refus (mesure 13).

| # | Envoi | Réponse mesurée le 2026-08-19 |
|---|---|---|
| 1 | administratrice, renomme | `200`, ligne rendue, `organizations` embarqué |
| 2 | `business_developer`, change la fonction | `200` — l'écriture n'est pas réservée à l'administration |
| 3 | **lectrice**, renomme | **`200` et `[]`** — aucune erreur, aucune ligne modifiée |
| 4 | administratrice, email **déjà porté** par un autre, casse différente | `409` / `23505`, `contacts_workspace_email_key` |
| 5 | administratrice, nom **entièrement blanc** | `400` / `23514`, `contacts_full_name_check` |
| 6 | administratrice, email malformé | `400` / `23514`, `contacts_email_check` |
| 7 | administratrice, email **chaîne vide** | `400` / `23514`, `contacts_email_check` |
| 8 | administratrice, téléphone **chaîne vide** | `400` / `23514`, `contacts_phone_check` |
| 9 | administratrice, organisation **inconnue** | `409` / `23503`, `contacts_organization_id_workspace_id_fkey` |
| 10 | administratrice, organisation retenue | `200`, `organizations` embarqué **peuplé** |
| 11 | administratrice, organisation à `null` | `200`, `organizations` embarqué **`null`** |
| 12 | administratrice, identifiant **inexistant** | **`200` et `[]`** |
| 13 | administratrice, `workspace_id` **étranger** | `403` / `42501` — c'est le `WITH CHECK` |
| 14 | **anonyme** | `401` / `42501`, « permission denied for table contacts » |
| 15 | après une écriture acceptée | `updated_at` **a bougé**, `created_at` non — le trigger agit |
| 16 | administratrice, la ligne **reprend son propre email** | `200` — l'unicité ne se heurte **pas** à elle-même |
| 17 | administratrice, son propre email en **autre casse** | `200` — l'index insensible à la casse ne s'oppose pas non plus |
| 18 | administratrice, les **cinq colonnes d'un bloc**, trois à `null` | `200`, ligne rendue |
| 19 | **lectrice** sur **Léo Marchand**, ligne du seed | **`200` et `[]`**, ligne relue **INCHANGÉE** |
| 20 | administratrice, **sans** `Prefer: return=representation` | `204`, aucun corps |
| 21 | administratrice, identifiant **mal formé** | `400` / `22P02`, `invalid input syntax for type uuid` |

**LA MESURE 3 DÉCIDE DU CONTRAT, ET ELLE SÉPARE CETTE SOUS-TRANCHE DE LA 4e.** À la création, un
refus d'autorisation est un **`403` explicite** (§14.3, mesure 4) : la clause `WITH CHECK` d'une
politique `INSERT` rejette la ligne. À la modification, la clause **`USING`** de
`contacts_maj_bizdev_admin` rend la ligne **invisible à l'écriture** : PostgREST ne trouve rien à
modifier, et rend `200` avec un tableau **vide**. Un refus d'autorisation est donc **silencieux**.
C'est le piège que `e2e/api/contacts.spec.ts` nomme dès son entête depuis la tranche 1, et il
gouverne ici le contrat d'écran : **une écriture sans effet doit être dite**, faute de quoi la
lectrice verrait son formulaire se refermer sur une modification qui n'a jamais eu lieu.

**LES MESURES 3, 12 ET 19 SONT INDISTINGUABLES, ET UN SEUL MESSAGE LES COUVRE.** Un appelant sans
droit, un contact disparu entre l'ouverture de la fiche et l'envoi, une ligne devenue invisible :
les trois rendent `200` et `[]`, par construction et non par accident. C'est exactement la situation
du §15.4 — trois absences, un seul écran —, et la réponse est la même : **un seul message**, qui
n'affirme ni le refus ni la disparition, et qui invite à relire la fiche. Prétendre les séparer
exigerait une lecture supplémentaire qui, elle-même, ne dirait rien de plus : la relecture d'un
contact refusé rend zéro ligne, comme celle d'un contact supprimé.

**LES MESURES 16 ET 17 DÉCIDENT DE LA CHARGE ENVOYÉE.** L'unicité partielle sur `lower(email)` ne
s'oppose **pas** à la ligne elle-même, même en changeant la casse. Le formulaire envoie donc les
**cinq colonnes d'un bloc** (mesure 18), sans comparer la saisie à l'état initial pour n'envoyer que
les différences. Un envoi différentiel serait une complication dont la mesure montre qu'elle
n'achète rien, et il introduirait un chemin — « aucun champ n'a changé » — qu'aucune règle ne
demande.

**La mesure 21 ne concerne pas cet écran, et c'est une propriété du §15.4** : la fiche refuse un
identifiant mal formé **sans émettre aucune requête**, donc aucune modification ne peut partir avec
un tel identifiant. La mesure est consignée pour ce qu'elle établit — la borne existe côté serveur
aussi — et non parce que l'écran l'atteindrait.

### 16.4 Les refus, traduits par un dictionnaire FERMÉ

Six clés, et aucune interpolation d'un message serveur dans l'interface (`docs/DESIGN_SYSTEM.md`
§10). Le classement lit **le code PostgreSQL d'abord**, pour le motif du §14.3 — `23505` et `23503`
rendent tous deux `409` :

| Classement | Cause mesurée | Clé |
|---|---|---|
| `sans-effet` | `200` et **zéro ligne** (mesures 3, 12, 19) | `contact.modification.refus.sansEffet` |
| `doublon` | `409` / `23505` | `contact.modification.refus.doublon` |
| `organisation-inconnue` | `409` / `23503` | `contact.modification.refus.organisation` |
| `saisie-invalide` | `400` / `23514` | `contact.modification.refus.saisie` |
| `interdit` | `401` / `403` | `contact.modification.refus.interdit` |
| `indisponible` | tout le reste | `contact.modification.refus.indisponible` |

**`sans-effet` est la nature que la création n'a pas**, et les cinq autres sont celles du §14.4 :
`classerRefusCreation` est donc **partagée** — elle classe une erreur, ce que ces cinq natures sont
—, et `sans-effet` est décidée **avant** elle, sur l'absence de ligne rendue, qui n'est pas une
erreur.

**Un refus n'efface jamais la saisie** (§14.4) : la personne corrige et renvoie. Le formulaire reste
ouvert, et le message vit **sous** lui.

### 16.5 De quoi le geste a l'air

Le bouton « Modifier » se pose **à côté du titre de la route**, dans le flux de la fiche, avant la
zone 1. Le formulaire ouvert **remplace** ce bouton — les deux s'excluent, comme au carnet (§14.5
cas c) —, et les deux zones de lecture restent rendues **sous** lui : on corrige en voyant ce que
l'on corrige.

**Le focus entre** sur le champ du nom à l'ouverture, et **revient** à la commande d'ouverture à la
fermeture. Ce retour n'est pas immédiat et ne peut pas l'être : la commande est **démontée** tant
que le formulaire est ouvert, et sa référence vaut `null` au moment où le gestionnaire de fermeture
s'exécute. C'est le défaut exact que la décision 453 a trouvé au carnet et que `BlocContactsCard`
résout déjà — un drapeau posé à la fermeture, un effet qui rend le focus **au tour de rendu suivant**,
quand la commande est remontée. Aucune temporisation : c'est le cycle de rendu de React qui ordonne
les deux gestes, pas une horloge (`CLAUDE.md` §18).

### 16.6 Autorisations — l'écran n'en calcule aucune

Rien de nouveau, et c'est le point : la lectrice **voit** le geste, ouvre le formulaire, envoie, et
reçoit le message `sans-effet` **traduit**. Une commande grisée selon le rôle ferait passer une
décision de la base pour une décision d'écran (`CLAUDE.md` §10, `docs/DESIGN_SYSTEM.md` §5.21).

**La différence avec 4e est réelle et assumée** : à la création, la lectrice reçoit un refus qui
**dit** qu'il en est un ; ici elle reçoit un message qui dit que **rien n'a changé**, sans affirmer
pourquoi. C'est ce que le serveur permet de dire, et rien de plus (§16.3).

### 16.7 Ce que la fiche fait de la ligne rendue

La ligne revient avec son organisation embarquée (mesures 10 et 11). La fiche **remplace ses
caractéristiques** par celles-là, **sans relire** : une relecture serait une seconde requête pour une
donnée déjà en main, et c'est la règle que le carnet tient depuis le §14.5 cas e.

**La zone 2 — les affaires — n'est PAS touchée**, et ne doit pas l'être : aucune colonne modifiable
par ce formulaire n'entre dans un rattachement. La reconstruire relancerait la lecture à quatre
niveaux du §15.3 pour un résultat identique.

**Le titre de la route suit le nouveau nom** : il est une donnée (§15.2), et un titre resté sur
l'ancien nom après une correction de coquille serait précisément le défaut que l'on vient corriger.

### 16.8 Limites nommées — sous-tranche 4g

- **aucune suppression d'un contact** : le privilège existe (§3), aucun écran ne l'exerce, et le
  motif est l'arbitrage **non tranché** du §6 point 4 — supprimer laisse des références mortes dans
  les valeurs `jsonb` que la tranche 3 a résolues à l'écriture ;
- **aucun rattachement depuis la fiche**, pour le motif du §15.8 ;
- **aucune création d'organisation** : le sélecteur n'offre que celles qui existent (§14.7) ;
- **aucune détection d'écriture concurrente** : ni `ETag`, ni `If-Match`. Deux personnes qui
  modifient le même contact voient la dernière écriture l'emporter, sans avertissement. Le produit
  ne porte aucun verrou optimiste nulle part, et en introduire un pour ce seul écran serait une
  règle locale sans le reste du produit ;
- **le carnet ne porte pas ce geste** (§16.2), et sa ligne ne gagne aucune commande ;
- **`source` n'est pas modifiable** : elle appartient au modèle (§2.2), et un contact rapproché
  automatiquement ne doit pas devenir « manuel » parce qu'on a corrigé son téléphone.

### 16.9 Contrat de comportement — sous-tranche 4g

| # | Situation | Attendu |
|---|---|---|
| a | fiche chargée, geste replié | une seule commande « Modifier », les deux zones inchangées |
| b | le geste est déclenché | le formulaire s'ouvre **prérempli des valeurs courantes**, le **focus entre** sur le champ du nom, la commande disparaît |
| c | le formulaire est refermé | le focus **revient** à la commande d'ouverture, remontée (§16.5) |
| d | nom vidé ou blanc | l'envoi est **refusé côté écran**, aucun appel réseau, le champ est signalé |
| e | envoi accepté | la zone 1 rend les **nouvelles** valeurs sans relecture, le formulaire se referme |
| f | le nom a changé | le **titre de la route** rend le nouveau nom (§16.7) |
| g | organisation changée | la valeur d'organisation devient un **lien** vers la nouvelle fiche |
| h | organisation détachée | la valeur d'organisation devient **vide et sans lien** (§15.9 cas b) |
| i | seule la fonction change, email inchangé | accepté — l'unicité ne se heurte pas à elle-même (mesures 16, 17) |
| j | email déjà porté par un autre | message `doublon`, formulaire ouvert, **saisie conservée** |
| k | organisation inconnue (liste périmée) | message `organisation`, saisie conservée |
| l | email malformé, ou téléphone vidé en `''` | message `saisie`, saisie conservée |
| m | **lectrice** | message `sansEffet`, saisie conservée, **aucune commande éteinte d'avance** |
| n | contact disparu entre l'ouverture et l'envoi | message `sansEffet`, **le même** qu'au cas m (§16.3) |
| o | pendant l'envoi | la commande d'envoi est `aria-busy` et l'envoi ne part **qu'une fois** |
| p | liste d'organisations en erreur, ou vide | les cas h et i du §13.5, comme au §14.5 cas k et l |
| q | après une modification acceptée | la **zone 2** est inchangée, sans nouvelle lecture (§16.7) |
| r | contact introuvable, en erreur, ou aucun client | **aucune commande « Modifier »** — il n'y a rien à modifier |

### 16.10 Preuves exigées — sous-tranche 4g

| Niveau | Preuve |
|---|---|
| Unitaire | `webapp/src/lib/contacts.test.ts` (étendu) : la charge réellement envoyée par `modifierContact` — les cinq colonnes d'un bloc, facultatifs blancs rendus `null` —, la ligne rendue avec son organisation, et le classement des **six** refus du §16.4 dont `sans-effet` sur zéro ligne |
| Unitaire | `webapp/src/app/FicheContact.test.tsx` (étendu) : les cas a à r du §16.9 |
| Unitaire | `webapp/src/app/Carnet.test.tsx` (existant, NON modifié) : la preuve que l'extraction des champs partagés (§16.2) n'a rien changé au formulaire de création |
| API | `e2e/api/contacts.spec.ts` (étendu) : les mesures du §16.3 avec les jetons réels des trois profils, chaque refus **relisant la ligne** pour la constater inchangée (décision 70), et le silence des mesures 3, 12 et 19 **figé comme tel** |
| E2E | `e2e/ui/contacts.spec.ts` (étendu) : la modification par les gestes de l'écran puis **la restauration des valeurs du seed** par les mêmes gestes, le parcours au **clavier**, et la lectrice recevant `sansEffet` avec sa saisie conservée ; console **vierge** |
| Visible | captures sous `docs/captures/CRM-060/`, préfixées `fiche-contact-modification-`, **observées** (`CLAUDE.md` §16) : le formulaire ouvert et prérempli, la fiche après modification, le message `sansEffet` de la lectrice, et le rendu à 390 px |
| i18n | `webapp/src/i18n/i18n.test.ts` (existant) : aucun texte visible en dur, aucune clé morte |
| Seed | rendu **INTACT** : trois contacts aux valeurs d'origine, deux rattachements |

### 16.11 Definition of Done — sous-tranche 4g

- `webapp/src/lib/contacts.ts` : `modifierContact`, `RefusModificationContact`, et le classement
  qui décide `sans-effet` **avant** de classer une erreur ;
- `webapp/src/app/ChampsContact.tsx` : les cinq champs partagés extraits du formulaire de création,
  à comportement **inchangé** ;
- `webapp/src/app/FormulaireModificationContact.tsx` : le formulaire prérempli et ses six refus ;
- `webapp/src/app/FicheContact.tsx` : la commande, le formulaire dans le flux, le retour du focus,
  et la mise à jour des caractéristiques et du titre sans relecture ;
- clés de traduction ajoutées, aucun texte en dur ;
- preuves du §16.10 exécutées et vertes, captures produites **et observées** ;
- `docs/DESIGN_SYSTEM.md` §5.25 ajouté et §5.24 révisé ; `docs/manual.md` ; `CHANGELOG.md`, dans le
  même changement ;
- commentaires `@spec` / `@verifies` sur chaque fichier touché.

**Aucune migration : cette sous-tranche ne crée aucune colonne et n'ouvre aucune politique.** Elle
n'exerce que `contacts_maj_bizdev_admin`, posée par la migration `0045` et déjà prouvée par la
tranche 1.

**Ce qui restera dû sur `CRM-060` après 4g** : l'arbitrage sur les **références mortes** (§6,
point 4) et, derrière lui, la **suppression** d'un contact ; le rattachement depuis la fiche.
L'unité demeure `[~]`.

## 17. Sous-tranche 4h — Le rattachement d'une affaire depuis la fiche d'un contact

Contrat écrit **avant toute ligne de code** (`CLAUDE.md` §5, `docs/CloudWorker.md` §3.2), après
**dix-huit** mesures relevées à la main le 2026-08-19 — une **dix-neuvième** s'y est ajoutée,
trouvée par la preuve d'interface et consignée au §17.4 sur la pile seedée, avec les jetons réels des
trois profils et avec la clé anonyme. Les mesures d'écriture ont été faites sur des rattachements
**sondes**, détruits ensuite : le seed est rendu **intact**, ses deux rattachements relus à
l'identique (`c2 → Léo, decideur` et `c4 → Sophie, prescripteur`).

Le §15.8 puis le §16.8 nomment ce manque deux fois en toutes lettres : « aucun rattachement depuis
cette page ». La fiche d'un contact **liste** ses affaires depuis 4f et **corrige** le contact
depuis 4g, mais elle ne sait toujours pas le rattacher à une affaire de plus. Le geste n'existe que
dans l'autre sens — depuis la fiche de l'affaire (§12) —, ce qui oblige à quitter le contact que
l'on a sous les yeux, à retrouver l'affaire, puis à y chercher le contact d'où l'on venait.

### 17.1 Ce que la sous-tranche livre, et ce qu'elle ne livre pas

**Elle livre**, sur la route `/contacts/:idContact` :

- le **geste de rattachement** de ce contact à une affaire du workspace, avec un rôle facultatif ;
- la **relecture** de la zone des affaires après le geste, l'affaire rattachée y apparaissant avec
  son rôle, son état et son lien.

**Elle ne livre pas**, et chaque manque est nommé au §17.8 : aucun **détachement** depuis cette
page, aucune modification du rôle d'un rattachement déjà posé, aucune création d'affaire, et
toujours aucune suppression de contact — celle-ci restant suspendue à l'arbitrage **non tranché**
du §6 point 4.

### 17.2 Où le geste s'ancre — DANS la zone des affaires, et non avant les deux zones

**Décision : le geste vit DANS la zone 2 — la section des affaires —, sous son titre, et non en
tête de fiche à côté de la commande de modification.**

Le motif est celui que le §12.2 a déjà écrit pour l'autre sens, retourné : un geste se pose près de
ce qu'il change. La commande de modification du §16.2 vit **avant** les deux zones parce qu'elle
touche les **caractéristiques**, c'est-à-dire la zone 1 et le titre de la route. Celle-ci ne touche
que la zone 2, et la poser à côté de l'autre ferait lire deux commandes voisines dont rien ne dirait
qu'elles agissent sur des objets différents.

**Aucune route nouvelle, aucune entrée de navigation** : le §15.2 et le §16.2 l'ont écrit chacun
une fois, et la raison est plus forte encore ici — ce geste n'a pas d'adresse propre, il vit dans
celle du contact. La couverture exacte `ROUTES` ⇄ `ENTREES_TRANSVERSES` de `routes.test.tsx` reste
**inchangée**.

### 17.3 Ce que le sélecteur lit — mesuré sur la pile réelle

MESURÉ le 2026-08-19 avec le jeton réel de l'administratrice, la requête **unique** que le geste
ajoute :

```
GET /rest/v1/cards
    ?select=id,title,archived_at
    &deleted_at=is.null
    &order=title
    &limit=<borne>
```

rend **40 affaires** (mesure 15), dont **une archivée**, « Contrat cadre 2025 ».

**Trois mesures ont DÉCIDÉ de cette requête plutôt que de la confirmer.**

- **UNE AFFAIRE À LA CORBEILLE EST ÉCARTÉE PAR L'ÉCRAN, ET C'EST UNE DÉCISION DE PRODUIT, PAS UNE
  GARDE DE LA BASE.** MESURÉ (mesure 7) : la base **ACCEPTE** le rattachement d'un contact à une
  affaire supprimée — `201`, et la ligne. Rien ne le refuse. Mais le §15.3 a mesuré que la fiche
  **n'affiche jamais** une affaire à la corbeille : le serveur l'écarte de la lecture. Un
  rattachement posé sur une telle affaire serait donc **invisible immédiatement après avoir été
  créé** — l'utilisateur agirait, la liste ne bougerait pas, et rien ne dirait pourquoi. Le
  sélecteur ne les offre pas. C'est le refus d'une commande dont le résultat serait indiscernable
  d'une panne, au même titre que le sélecteur du §12.6 refuse une commande vouée au `409`.

- **UNE AFFAIRE ARCHIVÉE EST OFFERTE, ET SON ARCHIVAGE EST DIT DANS L'OPTION.** MESURÉ (mesure 6) :
  le rattachement à une affaire archivée rend **`201`**. C'est l'écart avec `lireCardsClassables`
  (`inbox.ts`), qui les exclut parce que `classify_message` les refuse par `card_not_available` —
  ici rien ne les refuse. Les exclure serait poser à l'écran une règle de produit que personne n'a
  prise, alors que le §15.3 a déjà tranché dans l'autre sens pour la **lecture** : « une affaire
  archivée est une affaire réelle, et l'historique d'un contact est précisément ce que cette page
  sert ». Rattacher un contact à une affaire close est un geste ordinaire de mise à jour d'un
  historique. L'option porte donc la mention de l'archivage, pour que le choix soit éclairé.

- **LE TRI SE DEMANDE AU SERVEUR, ET IL AGIT.** `order=title` est vérifié dans les **deux** sens
  (mesure 18) : descendant rend `["Veille de vulnérabilités — Atelier Meunier", "TMA annuelle —
  Fédération sportive du Rhône", "Tableau de bord de supervision livré — Nordis"]`, l'exact inverse
  de la tête ascendante. Le tri **agit**, il n'est pas seulement toléré.

**Ni le track ni le channel ne sont demandés, et ce n'est pas un oubli.** Le §15.3 les lit parce que
la fiche doit construire l'**adresse** de chaque affaire ; un sélecteur n'a aucune adresse à
construire, il envoie un identifiant. Les demander imposerait la levée d'ambiguïté `PGRST201` du
§15.3 pour une donnée que rien n'afficherait — et le §10.3 a déjà posé qu'une requête ne rapporte
que ce qui est affiché.

**La lecture n'est émise QUE si le geste est ouvert**, comme la liste des organisations du §16
(règle du §13.4) : charger quarante affaires pour un geste que la plupart des visites ne font pas
serait une requête gratuite.

**La borne du sélecteur est celle du §13.4 de `inbox.ts`, reprise sans changement** : une liste
déroulante de plusieurs milliers d'entrées n'est plus un choix. Le workspace seedé en compte
quarante ; au-delà, c'est une recherche qu'il faudra livrer, pas une liste plus longue. L'écart est
nommé au §17.8.

### 17.4 Autorisations — huit mesures, et un refus qui NE ressemble PAS à celui de 4g

MESURÉ le 2026-08-19, avec les jetons réels. **Lecture du sélecteur** :

| # | Acteur / requête | Mesure |
|---|---|---|
| 15 | administratrice, affaires hors corbeille | `200`, **40 lignes**, dont une archivée |
| 16 | **lectrice**, la même requête | `200`, **35 lignes**, et **aucune archivée** — les droits fins de `cards` retirent le track « Grands comptes », qui portait la seule affaire archivée |
| 17 | **anonyme**, la même requête | `200` et **`[]`** — zéro ligne, jamais une erreur de privilège |

**Écriture — le rattachement** :

| # | Acteur / requête | Mesure |
|---|---|---|
| 6 | administratrice, `POST` Élise sur l'affaire **archivée** `…0c8` | **`201`** et la ligne |
| 7 | administratrice, `POST` Élise sur l'affaire **en corbeille** `…0c9` | **`201`** et la ligne — la base ne s'y oppose PAS |
| 8 | administratrice, `POST` Léo sur `…0c2`, où il est **déjà** rattaché | **`409`**, code **`23505`**, `card_contacts_pkey` |
| 9 | **lectrice**, `POST` Élise sur `…0c4` | **`403`**, code **`42501`**, « new row violates row-level security policy » |
| 10 | **business developer**, `POST` Élise sur `…0c1` | **`201`** et la ligne — le geste n'est PAS un geste d'administration |
| 11 | administratrice, rôle **chaîne vide** | **`400`**, code **`23514`**, `card_contacts_role_check` |
| 12 | administratrice, affaire **inexistante** `…0ff` | **`403`**, code **`42501`** — et **non** `23503` |
| 19 | **lectrice**, `POST` sur `…0cb` « Assistant IA support — Nordis » | **`201`** — elle RÉUSSIT |

**LA MESURE 19 A ÉTÉ TROUVÉE PAR LA PREUVE D'INTERFACE, ET ELLE CORRIGE UNE GÉNÉRALISATION.** Le
premier scénario de la lectrice prenait la première affaire venue du sélecteur, en supposant que
« lectrice » signifiait « refusée partout ». Elle a **réussi**. Les droits fins de `CRM-012`
divergent d'une affaire à l'autre **pour un même profil** : la lectrice écrit sur `…0cb` et se voit
refuser `…0c4`, `…0c6` et `…d013`, toutes quatre pourtant **lisibles** par elle.

C'est la démonstration la plus nette de ce que le §17.6 exige : **l'écran ne peut PAS calculer ce
droit**, et ne doit pas essayer. Aucune propriété du profil ne le prédit, et la lecture ne le
prédit pas davantage — `lireAffairesRattachables` lit le droit de LECTURE et le dit (§17.3). Une
interface qui grisrait la commande « parce que l'utilisateur est lecteur » retirerait à la lectrice
un geste que la base lui accorde. Le scénario d'interface **nomme** désormais l'affaire qu'il
choisit, faute de quoi il passerait tantôt par le refus, tantôt par le succès.

**LA MESURE 9 SÉPARE 4h DE 4g, ET LA MESURE 12 FERME UNE NATURE DE REFUS.**

- **Le refus opposé à la lectrice est EXPLICITE, et il est dit comme tel.** C'est un `403` et un
  code, là où la **modification** d'un contact (§16.3, mesure 3) rend `200` et un tableau vide sans
  aucune erreur. La cause est structurelle et déjà écrite au §16 : une insertion est filtrée par la
  clause **`WITH CHECK`**, qui **rejette la ligne**, tandis qu'une mise à jour l'est par la clause
  **`USING`**, qui rend la ligne **invisible à l'écriture**. Cette sous-tranche rejoint donc 4c et
  4e, non 4g : **aucun message « sans effet » n'a d'objet ici**, et en écrire un serait décrire une
  issue que la base ne produit pas.

- **UNE AFFAIRE INEXISTANTE REND EXACTEMENT LE MÊME REFUS QU'UN DROIT MANQUANT** (mesure 12), et
  c'est structurel : `app.can_write_card` rend faux pour une affaire qui n'existe pas, si bien que
  la clause `WITH CHECK` rejette la ligne **avant** que la clé étrangère ne soit seulement
  éprouvée. Le code `23503` — `CODE_CONTACT_INCONNU`, que le §12.5 distingue parce que le contact
  y était la variable — est donc **inatteignable depuis cette surface**, où c'est l'affaire qui
  varie. Les deux causes sont **indistinguables par construction**, c'est la situation du §15.4,
  et un **seul** message les couvre : il n'affirme ni le refus ni la disparition, et invite à
  relire la liste. Inventer deux messages que la mesure ne sait pas séparer serait affirmer à
  l'utilisateur une cause que l'on ignore.

**Aucune politique nouvelle n'est ouverte.** Le geste n'exerce que `card_contacts_insertion`, posée
par la migration `0045` et déjà éprouvée par la tranche 1 puis par 4c. **Aucune migration.**

### 17.5 Ce que le formulaire envoie, et pourquoi il ne recalcule rien

Il appelle `rattacherContact` (§12), **inchangée** : la fonction envoie déjà les quatre colonnes
d'un bloc et traduit `role` vide en `null`, ce que la mesure 11 exige — la contrainte
`card_contacts_role_check` refuse la chaîne vide par `400` / `23514`. Écrire une seconde fonction
pour le même `POST` sur la même table ferait diverger deux contrats au premier champ ajouté ; c'est
l'argument que le §16 a retenu pour extraire `ChampsContact`, appliqué ici à l'écriture.

**`workspace_id` est LU AVEC LE CONTACT, pas deviné et pas relu.** MESURÉ (mesures 13 et 14) : la
colonne est lisible sur `contacts` par l'administratrice **comme par la lectrice**. Elle est donc
**ajoutée à `COLONNES_FICHE_CONTACT`** — une colonne de plus dans une requête déjà émise, contre une
requête entière si on la relisait. C'est la règle du §12.5 — « `workspace_id` est TRANSMIS et non
deviné » —, tenue avec la source que cette surface a sous la main : là-bas c'était la card déjà
chargée, ici c'est le contact.

### 17.6 De quoi le geste a l'air, et l'écran ne calcule aucun droit

Le rendu **hérite du §12.6** — le formulaire de rattachement de l'autre sens — plutôt que d'inventer
une forme, et de `docs/DESIGN_SYSTEM.md` §5.21 dont il reprend les règles. Ce qui suit ne dit que ce
qui lui est propre ; le §5.26 du design system porte le reste.

- **Une commande, puis son formulaire DANS LE FLUX** du document, sous le titre de la zone et
  au-dessus du tableau des affaires — jamais une modale (§5.13). Le tableau est précisément ce qui
  dit à quelles affaires le contact est **déjà** rattaché : le recouvrir cacherait la réponse à la
  question que l'on se pose en ouvrant le geste.
- **Replié par défaut**, et **la commande et le formulaire s'excluent** — règle du §16.5.
- **Le focus ENTRE dans le sélecteur à l'ouverture, et REVIENT à la commande à la fermeture**, ce
  retour étant **différé d'un tour de rendu** : la commande est démontée tant que le formulaire est
  ouvert, et l'appeler depuis le gestionnaire de fermeture viserait une référence nulle. C'est le
  défaut mesuré au carnet par la décision 453, et le remède que `BlocContactsCard` puis
  `FicheContact` portent déjà. **Aucune temporisation** (`CLAUDE.md` §18).
- **Le sélecteur n'offre que les affaires NON ENCORE rattachées** à ce contact. Ce n'est pas une
  garde de droit — c'est le refus d'une commande vouée au `409` (mesure 8), la règle du §5.21. Le
  refus `deja-rattache` reste néanmoins **traduit** : deux utilisateurs peuvent agir à la même
  seconde, et l'écran ne prétend pas connaître l'état du serveur.
- **Une option d'affaire archivée porte la mention de son archivage**, pour que le choix soit
  éclairé (§17.3). La mention est un **texte dans le libellé de l'option**, jamais une teinte : une
  `option` native ne porte ni icône ni pilule, et le §1 interdit qu'une couleur porte seule une
  information.
- **AUCUNE COMMANDE N'EST ÉTEINTE D'AVANCE SELON LE RÔLE** (§5.21, §5.23, §5.25, sans exception) :
  la lectrice voit le geste, envoie, et reçoit le refus **traduit** (mesure 9). Griser ferait passer
  une décision de la base pour une décision d'écran (`CLAUDE.md` §10). La commande d'envoi l'est en
  revanche tant qu'**aucune affaire n'est choisie**, ce qui est autre chose : il n'y a alors rien à
  envoyer.
- **Un refus n'efface pas la saisie** (§5.7 ter) : l'affaire choisie et le rôle tapé restent à
  l'écran avec leur explication, et le formulaire **reste ouvert**.
- **Trois vides distincts, et aucun ne se confond avec un autre** (§5.21, repris) : « aucune affaire
  rattachée », qui **garde son geste** — c'est lui qui la comble ; « toutes les affaires lisibles
  sont déjà rattachées », qui n'affiche **aucun sélecteur vide** ; et « aucune affaire lisible dans
  cet espace de travail », qui n'offre **aucune action** — aucune surface de cette page ne crée
  d'affaire.
- **La zone des affaires est RELUE après un rattachement réussi, jamais complétée localement**
  (§5.21). L'insertion optimiste contredirait l'ordre du serveur le temps d'un rendu, et masquerait
  un rattachement posé entre-temps par un collègue. La relecture est celle du §15.3 — la lecture
  entière de la fiche —, ce qui rapporte du même coup l'état d'archivage et l'adresse de l'affaire
  ajoutée, que le sélecteur ne connaissait pas.
- **La zone 1 et le titre de la route ne bougent pas** : aucun champ de ce formulaire n'entre dans
  les caractéristiques du contact. C'est la règle du §16.7, retournée.

### 17.7 Contrat de comportement, cas a à n

| # | Situation | Attendu |
|---|---|---|
| a | fiche chargée, geste replié | la commande est rendue sous le titre de la zone des affaires ; aucun sélecteur n'est monté, et **aucune requête d'affaires n'est émise** |
| b | ouverture du geste | le formulaire remplace la commande, la liste des affaires est lue, le focus entre dans le sélecteur |
| c | fermeture par « Annuler » | le formulaire est démonté, la commande remonte, **et le focus lui revient** |
| d | sélecteur ouvert | il n'offre **aucune** affaire déjà rattachée à ce contact, **aucune** affaire à la corbeille, et il offre les archivées **avec leur mention** |
| e | envoi sans affaire choisie | la commande d'envoi est **désactivée** ; aucune requête n'est émise |
| f | rattachement accepté | le formulaire se referme, le focus revient à la commande, **la fiche est relue**, et l'affaire apparaît dans le tableau avec son rôle et son lien |
| g | rattachement accepté d'une affaire **archivée** | la ligne apparaît **avec sa pilule « Archivée »** (§15.3) |
| h | rôle laissé vide | il est envoyé `null`, jamais `""` (mesure 11), et la cellule du rôle reste **vide** |
| i | **lectrice** qui envoie | `403` (mesure 9) traduit en refus d'autorisation ; le formulaire **reste ouvert**, la saisie est **conservée**, la fiche n'est pas relue |
| j | affaire rattachée entre-temps par un tiers | `409` / `23505` (mesure 8) traduit en « déjà rattachée » ; la saisie est conservée |
| k | affaire devenue illisible entre-temps | `403` (mesure 12) traduit par le **même** message que le cas i — les deux causes sont indistinguables (§17.4) |
| l | liste des affaires illisible | le sélecteur est **désactivé** et porte son **action de reprise**, qui relit réellement (§5.22) |
| m | aucune affaire lisible | mention en toutes lettres, **sans action** |
| n | contact introuvable, erreur de lecture, ou absence d'espace de travail | **aucun geste n'est rendu** — il n'y a pas d'objet à rattacher (règle du §16.9 cas r) |

### 17.8 Ce que la sous-tranche ne fait PAS, et pourquoi

- **Aucun DÉTACHEMENT depuis cette page.** Le geste existe, et il est livré depuis la fiche de
  l'affaire (§12.6) — que le tableau de la zone 2 atteint **en un clic**, chaque titre étant un
  lien. Le livrer ici demanderait sa confirmation nommant l'objet (§6), la place où poser cette
  confirmation dans une ligne de tableau, et le traitement du « sans effet » que la clause `USING`
  produit à la suppression (§12.4, conséquence 1) : c'est une sous-tranche à part entière, non
  l'appoint de celle-ci. L'asymétrie est **assumée et nommée** plutôt que comblée à la hâte.
- **Aucune modification du rôle d'un rattachement déjà posé** — le §12.8 le nommait déjà, et rien
  ici ne le change.
- **Aucune recherche dans le sélecteur**, dont la liste est **bornée** (§17.3). Le §5.19 tient déjà
  ce raisonnement pour la pagination du carnet : poser une recherche sur une lecture dont personne
  n'a mesuré le volume réel serait de l'optimisation sans mesure (`CLAUDE.md` §21). La condition de
  reprise est un workspace dont les affaires dépassent la borne.
- **Aucune suppression de contact**, toujours suspendue à l'arbitrage **non tranché** du §6
  point 4 : les valeurs `jsonb` qui désignent un contact supprimé demeurent en base
  (`docs/CloudWorker.md` §4.1 — une entrée qui attend un arbitrage ne se tranche jamais soi-même).
- **Le seed n'est PAS modifié.** Ses trois contacts et ses deux rattachements couvrent déjà les
  branches dont ce geste a besoin : un contact **sans** aucune affaire (Élise Fabre, l'état vide
  qui garde son geste), un contact **avec** une affaire (Léo Marchand, l'exclusion du sélecteur),
  une affaire **archivée** lisible (« Contrat cadre 2025 ») et une affaire **en corbeille**
  (« Saisie erronée »), qui sont exactement les deux cas que le §17.3 tranche. Y toucher
  déplacerait la garde de convergence de `apply-seed.sh` et le compteur que lit la règle 3 du
  classement, ce que le §11.7 a déjà tranché — on n'enrichit que ce qui ne casse rien.

### 17.9 Definition of Done de la sous-tranche 4h

- `webapp/src/lib/contacts.ts` : `lireAffairesRattachables`, ses colonnes exportées et son filtre de
  corbeille ; `workspace_id` ajouté à `COLONNES_FICHE_CONTACT` et à `FicheContactLue` ;
- `webapp/src/app/FormulaireRattachementAffaire.tsx` : le geste, son sélecteur, ses états et son
  dictionnaire **fermé** de refus ;
- `webapp/src/app/FicheContact.tsx` : le geste posé dans la zone des affaires, le retour du focus
  différé, et la relecture après succès ;
- test unitaire dédié : la requête émise, le filtre de corbeille, l'exclusion des affaires déjà
  rattachées, la conservation des archivées, et les natures de refus ;
- preuve d'API dédiée : les mesures du §17.4 avec les **jetons réels**, chaque refus **relisant la
  ligne** pour la constater inchangée (décision 70) ;
- preuve E2E dédiée : le rattachement par les **gestes de l'écran**, le parcours **clavier**, le
  refus opposé à la lectrice, et le rendu à 390 px — **le seed restitué par les gestes de l'écran**,
  jamais par une requête de service ;
- captures produites **et observées** (`CLAUDE.md` §16) sous `docs/captures/CRM-060/` ;
- clés de traduction ajoutées, aucun texte en dur ;
- `docs/DESIGN_SYSTEM.md` §5.26 ajouté et §5.24 révisé ; `docs/manual.md` ; `CHANGELOG.md`, dans le
  même changement ;
- commentaires `@spec` / `@verifies` sur chaque fichier touché.

**Aucune migration : cette sous-tranche ne crée aucune colonne et n'ouvre aucune politique.**

**Ce qui restera dû sur `CRM-060` après 4h** : l'arbitrage sur les **références mortes** (§6,
point 4) et, derrière lui, la **suppression** d'un contact ; le **détachement** depuis la fiche du
contact (§17.8). L'unité demeure `[~]`.

## 18. Sous-tranche 4i — Le détachement d'une affaire depuis la fiche d'un contact

Contrat écrit **avant toute ligne de code** (`CLAUDE.md` §5, `docs/CloudWorker.md` §3.2), après
**onze** mesures relevées à la main le 2026-08-19 sur la pile seedée, avec les jetons réels des
trois profils et avec la clé anonyme. Les mesures d'écriture ont été faites sur des rattachements
**sondes** posés puis purgés, plus une mesure sur une **ligne du seed** dont le refus a été relu
inchangé : le seed est rendu **intact**, ses deux rattachements relus à l'identique
(`c2 → Léo, decideur` et `c4 → Sophie, prescripteur`).

Le §15.8, puis le §16.8, puis le §17.8 nomment ce manque **trois fois**. La fiche d'un contact
**liste** ses affaires depuis 4f, **corrige** le contact depuis 4g et le **rattache** depuis 4h,
mais défaire un rattachement oblige encore à quitter la personne que l'on a sous les yeux, à ouvrir
l'affaire, et à y retrouver le contact d'où l'on venait. Le §17.8 a assumé cette asymétrie en la
nommant, et en disant précisément ce qu'il faudrait pour la combler : une confirmation nommant
l'objet, **la place où la poser dans une ligne de tableau**, et le traitement du « sans effet » que
la clause `USING` produit à la suppression. C'est l'objet de cette sous-tranche, et rien d'autre.

### 18.1 Ce que la sous-tranche livre, et ce qu'elle ne livre pas

**Elle livre**, sur la route `/contacts/:idContact` :

- une **commande de détachement par ligne** du tableau des affaires ;
- sa **confirmation dans le flux**, nommant l'affaire dont on va détacher le contact ;
- le traitement des **trois issues** que la mesure impose — appliquée, sans effet, refusée ;
- la **relecture** de la fiche après un geste, dans les trois cas.

**Elle ne livre pas** : aucune modification du rôle d'un rattachement posé (le §12.8 le nommait
déjà, et rien ici ne le change) ; aucune création ni suppression d'affaire ; et toujours **aucune
suppression de contact**, suspendue à l'arbitrage **non tranché** du §6 point 4. Chaque manque est
repris au §18.8.

### 18.2 Aucune fonction nouvelle — `detacherContact` est celle de 4c, INCHANGÉE

`webapp/src/lib/contacts.ts` porte déjà `detacherContact(client, idCard, idContact)` et son type
`ResultatDetachement` à **trois** issues, livrés par 4c pour la fiche de l'affaire. Cette
sous-tranche les **appelle sans les modifier**, exactement comme 4h a rappelé `rattacherContact` :
écrire un second `DELETE` sur la même table ferait diverger deux contrats au premier champ ajouté.

**C'est donc une sous-tranche d'écran, et la mesure le confirme** : les onze relevés ci-dessous ne
demandent aucune colonne, aucune politique, aucune requête nouvelle. **Aucune migration.**

Le `.select('contact_id')` que la fonction accole à la suppression est ce qui rend l'issue « zéro
ligne touchée » **observable** : sans lui PostgREST ne renvoie aucun corps, et le refus silencieux
de la politique serait indistinguable d'un succès. Cette sous-tranche en dépend entièrement.

### 18.3 Ce que la suppression rend — ONZE MESURES, le 2026-08-19

`DELETE /rest/v1/card_contacts?card_id=eq.<affaire>&contact_id=eq.<contact>`, avec
`Prefer: return=representation`.

| # | Acteur / requête | Mesure |
|---|---|---|
| 1 | administratrice, rattachement **existant** (sonde sur `…0c1`) | **`200`** et **la ligne retirée** ; relue avec la clé de service : **absente** |
| 2 | **lectrice**, rattachement **existant** d'une affaire qu'elle **LIT** (`…0c4 → Sophie`, ligne du **seed**) | **`200`** et **`[]`** — **aucune erreur** ; la ligne relue est **INCHANGÉE**, `role` toujours `prescripteur` |
| 3 | administratrice, rattachement **inexistant** (`…0c1 → Sophie`) | **`200`** et **`[]`** |
| 4 | administratrice, rattachement sur une affaire **ARCHIVÉE** (`…0c8`) | **`200`** et **la ligne** — la base ne s'y oppose **PAS** |
| 5 | **business developer**, rattachement existant | **`200`** et **la ligne** — le geste n'est **PAS** un geste d'administration |
| 6 | **anonyme**, rattachement existant | **`401`**, code **`42501`**, « permission denied for table card_contacts » ; la ligne relue est **INCHANGÉE** |
| 7 | **lectrice**, sur `…0cb` « Assistant IA support — Nordis » | **`200`** et **la ligne** — elle **RÉUSSIT** |
| 8 | administratrice, identifiant d'affaire **mal formé** | **`400`**, code **`22P02`** |
| 9 | fiche de Léo **avant** | **1** affaire — « Migration ERP Sogexia » |
| 10 | fiche de Léo **pendant** (sonde sur l'archivée `…0c8`) | **2** affaires, dont l'archivée, avec son `archived_at` |
| 11 | fiche de Léo **après** détachement de la sonde | **1** affaire — la ligne a **disparu**, le seed est rendu intact |

**QUATRE MESURES DÉCIDENT DE CETTE SOUS-TRANCHE. Les autres confirment.**

**1. LA MESURE 2 IMPOSE UNE TROISIÈME ISSUE, ET C'EST L'ÉCART EXACT AVEC 4h.** La lectrice reçoit
`200` et un tableau **vide**, sans la moindre erreur, sur une ligne qui **existe** et qui reste en
base. La cause est structurelle et déjà écrite deux fois : une **insertion** est filtrée par la
clause `WITH CHECK`, qui **rejette** la ligne — d'où le `403` explicite du §17.4 ; une
**suppression** l'est par la clause `USING`, qui rend la ligne **invisible à l'écriture**, et
PostgREST n'a alors rien à supprimer. Cette sous-tranche rejoint donc **4g**, non 4h : un message
« sans effet » y a un objet, et ne pas l'écrire ferait disparaître de l'écran une ligne que la base
a conservée. **Refermer la confirmation sur ce silence en annonçant un détachement serait le mensonge
que le §5.25 interdit déjà pour la modification.**

**2. LES MESURES 2 ET 3 SONT INDISTINGUABLES, ET C'EST ASSUMÉ.** Un refus de droit et une ligne
déjà partie rendent tous deux `200` et `[]`. Prétendre les séparer renseignerait un appelant sans
droit sur l'état de l'affaire (`docs/SPEC-permissions-rls.md` §7). C'est la situation du §15.4 —
plusieurs causes, un seul écran —, et un **seul** message les couvre : il dit ce qui est vrai,
« aucun rattachement n'a été retiré », n'affirme ni le refus ni la disparition, et la fiche est
**relue** pour montrer l'état réel.

**3. LA MESURE 4 RETIRE UNE RÈGLE D'ÉCRAN AVANT QU'ELLE NE SOIT ÉCRITE.** Le tableau de la zone 2
liste les affaires **archivées** (§15.3, §5.24), à la différence du sélecteur de 4h qui écarte les
affaires à la corbeille. Une politique qui refuserait la suppression sur une affaire close aurait
obligé à éteindre la commande sur ces lignes — ou pire, à la laisser produire un « sans effet »
indiscernable d'un refus de droit. Elle ne refuse pas : `app.can_write_card` dérive du **channel**
et ne lit ni `archived_at` ni `deleted_at`. **Toutes les lignes du tableau portent donc la même
commande, sans exception ni condition.**

**4. LA MESURE 7 INTERDIT À L'ÉCRAN DE CALCULER LE DROIT, et elle est le pendant exact de la
mesure 19 de 4h.** La lectrice **réussit** le détachement sur `…0cb` et se voit opposer le silence
sur `…0c4`, deux affaires qu'elle **lit** l'une comme l'autre. Les droits fins de `CRM-012` divergent
d'une affaire à l'autre **pour un même profil** : aucune propriété du profil ne prédit l'issue, et
la lecture ne la prédit pas davantage. Une interface qui grisrait la commande « parce que
l'utilisateur est lecteur » lui retirerait un geste que la base lui accorde.

**Les mesures 6 et 8 ne sont pas atteignables depuis l'écran, et sont relevées pour fermer le
classement.** La route est derrière l'authentification, et l'identifiant de l'affaire vient de la
**donnée déjà lue**, jamais d'une saisie. Elles disent néanmoins ce que le dictionnaire du §18.5
doit couvrir sans jamais mentir : `401` est classé `forbidden` par `classerRefusRattachement`, et
`22P02` tombe dans `unknown`.

**Deux natures de refus sont STRUCTURELLEMENT INATTEIGNABLES sur cette surface**, et le §18.5 dit ce
qu'il en fait : `23505` (`deja-rattache`) suppose une insertion, et `23503` (`contact-inconnu`)
suppose une clé étrangère à éprouver — une suppression n'en éprouve aucune.

### 18.4 Où le geste s'ancre — UNE COLONNE DE PLUS, ET LA CONFIRMATION SUR SA PROPRE LIGNE

**Décision : la commande est une QUATRIÈME COLONNE du tableau des affaires, et la confirmation
occupe une LIGNE À ELLE, immédiatement sous celle qu'elle concerne, sur toute la largeur.**

C'est la question que le §17.8 a laissée ouverte — « la place où poser cette confirmation dans une
ligne de tableau » —, et elle a trois réponses possibles, dont deux sont écartées par une raison
mesurable.

- **Dans la cellule de la commande.** Écartée : la cellule est bornée par `CLASSES_CELLULE`
  (`max-w-[32ch]`, `truncate`), et une confirmation qui **nomme l'affaire** (§6) y serait tronquée
  — la règle qui exige de nommer l'objet serait tenue dans le balisage et perdue à l'écran.
- **Sous le tableau, une seule confirmation pour la ligne choisie.** Écartée : rien ne relierait
  visuellement la confirmation à sa ligne, sur un tableau qui en porte plusieurs. Le §12.6 n'a pas
  ce problème — sa liste plate imbrique la confirmation **dans** le `li`.
- **Une ligne de tableau à elle, en `colSpan`.** Retenue : elle est le seul emplacement qui soit à
  la fois **dans le flux** (§5.13), **adjacent** à la ligne concernée, et **assez large** pour
  nommer l'affaire. Le balisage reste un tableau valide, et la ligne de confirmation porte
  `data-testid` pour que la preuve la rattache à son affaire.

**La commande ne se cache pas pendant sa confirmation**, à la différence du §12.6 où commande et
confirmation s'excluent dans la même ligne : ici elles vivent sur **deux lignes distinctes**, et
retirer la commande ferait sauter la hauteur de la ligne du dessus au moment précis où l'on
demande à l'utilisateur de lire. Elle est **désactivée** tant que sa confirmation est ouverte —
il n'y a rien à rouvrir —, ce qui n'est pas une garde de droit mais l'état d'une commande sans
objet, exactement comme la commande d'envoi de 4h l'est sans affaire choisie.

**Une seule confirmation à la fois.** Ouvrir celle d'une autre ligne ferme la précédente : deux
confirmations simultanées poseraient deux questions destructrices dont rien ne dirait laquelle on
répond.

**Le focus revient à la commande de SA ligne à la fermeture**, et ce retour n'a **pas** besoin
d'être différé ici, la commande n'étant jamais démontée — c'est l'écart avec le §16.5 et le §17.6,
et il est écrit pour qu'on ne recopie pas un remède sans son motif. **Aucune temporisation.**

**Le geste de rattachement (§17.2) ne bouge pas** : il reste sous le titre de la zone, au-dessus du
tableau. Les deux gestes agissent sur la même zone mais pas sur le même objet — l'un ajoute une
ligne, l'autre en retire une nommée.

### 18.5 Les refus, traduits par un dictionnaire FERMÉ

Le message du serveur n'atteint **jamais** l'écran (§12.5, §17.4). Le classement est celui de
`classerRefusRattachement`, **repris sans changement** : code PostgreSQL d'abord, code HTTP ensuite.

| Nature | Atteignable ici ? | Ce que l'écran dit |
|---|---|---|
| `forbidden` (`401`/`403`) | **oui**, hors écran (mesure 6) | le détachement a été refusé ; rechargez la fiche |
| `network` | **oui** | la requête n'a pas abouti |
| `unknown` | **oui** (mesure 8, et tout le reste) | le détachement a échoué |
| `deja-rattache` (`23505`) | **non** — suppose une insertion | même texte que `unknown` |
| `contact-inconnu` (`23503`) | **non** — une suppression n'éprouve aucune clé étrangère | même texte que `unknown` |

**Les deux natures inatteignables reçoivent le texte de `unknown`, et ce n'est pas un repli
paresseux** : leur donner un texte propre ferait entrer dans le produit une phrase que **rien** ne
peut afficher, donc qu'aucune preuve ne peut éprouver. Le dictionnaire reste **exhaustif** — le type
l'impose —, et le motif est écrit dans le fichier.

**L'issue `sans-effet` n'est PAS dans ce tableau, et c'est le point du §18.3.** Elle n'est ni un
succès ni une erreur : elle a son propre message, et elle **relit** la fiche.

### 18.6 De quoi le geste a l'air

Le rendu **hérite du §12.6 / §5.21** — le même geste dans l'autre sens — et de `docs/DESIGN_SYSTEM.md`
§5.27, ajouté dans le même changement. Ce qui suit ne dit que ce qui lui est propre.

- **Une commande par ligne**, à l'icône `Unlink` du §5.21 : c'est le même geste, et lui en donner
  une autre ferait lire deux gestes différents. Taille compacte, comme au §12.6.
- **La confirmation NOMME L'AFFAIRE** (§6). C'est le §12.6 **retourné** : là-bas le contact variait
  et l'affaire était le décor, ici le contact est le décor et l'affaire varie. Nommer le contact
  sur cette page nommerait la personne dont on lit déjà la fiche, ce qui ne lèverait aucune
  ambiguïté.
- **Elle dit que le rôle part avec le rattachement**, quand il y en a un : c'est la seule donnée
  que le geste détruit sans reprise, le rattachement se refaisant en deux clics par le geste de 4h.
- **Le bouton de confirmation est destructif** (teinte de danger, §5.3), et « Annuler » est
  secondaire.
- **Aucune commande n'est éteinte d'avance selon le rôle** (§5.21, §5.23, §5.25, §5.26, sans
  exception) : la lectrice voit la commande, confirme, et reçoit — selon l'affaire — un détachement
  **réel** (mesure 7) ou le message « sans effet » (mesure 2). Griser ferait passer une décision de
  la base pour une décision d'écran (`CLAUDE.md` §10), et la mesure 7 montre que l'écran se
  tromperait.
- **Une affaire ARCHIVÉE porte la commande comme les autres** (mesure 4). Rien à l'écran ne
  distingue sa ligne, hors la pilule que le §15.3 y pose déjà.
- **Le message du geste se lit SOUS le tableau**, `role="alert"`, jamais en tête d'écran (§5.13,
  §5.16) — la place que le §12.6 lui donne déjà. Il **survit à la relecture** : c'est la règle du
  cas o du §12.7, et la relecture est précisément ce qui pourrait l'effacer.
- **La fiche est RELUE après un geste, dans les TROIS issues** (§5.21). Après un succès parce que la
  ligne doit partir ; après un « sans effet » parce que l'écran ne sait pas laquelle des deux causes
  s'applique et ne prétend pas le savoir ; après un refus parce que l'état affiché peut être périmé.
  Jamais de retrait local : il contredirait l'ordre du serveur le temps d'un rendu.
- **La zone 1 et le titre de la route ne bougent pas** — règle du §17.6, tenue à l'identique.
- **L'état vide de la zone des affaires garde le geste de RATTACHEMENT et n'en gagne aucun autre** :
  un tableau sans ligne n'a aucune commande de détachement à porter, et le §5.24 est révisé sur ce
  point précis.

### 18.7 Contrat de comportement, cas a à m

| # | Situation | Attendu |
|---|---|---|
| a | fiche avec au moins une affaire | **chaque** ligne porte sa commande de détachement, y compris la ligne d'une affaire **archivée** ; aucune confirmation n'est rendue |
| b | commande activée | une **ligne de confirmation** apparaît sous la ligne concernée, sur toute la largeur, **nommant l'affaire** ; le focus entre dans son bouton de confirmation |
| c | fermeture par « Annuler » | la ligne de confirmation est démontée, **et le focus revient à la commande de SA ligne** |
| d | ouverture de la confirmation d'une **autre** ligne | la précédente est fermée ; **une seule** confirmation existe à tout instant |
| e | confirmation activée pendant que la requête vole | le bouton de confirmation est **désactivé** et porte son libellé d'attente ; aucune seconde requête n'est émise |
| f | détachement **appliqué** | la confirmation se ferme, la fiche est **relue**, la ligne **disparaît**, et **aucun message** n'est affiché |
| g | détachement appliqué sur la **dernière** affaire | le tableau cède la place à l'**état vide** de la zone, qui garde le geste de rattachement (§17.6) |
| h | détachement **sans effet** (lectrice sur une affaire qu'elle ne peut pas écrire, ou ligne déjà partie) | message « aucun rattachement n'a été retiré » **sous le tableau**, `role="alert"` ; la confirmation se ferme ; **la fiche est relue** ; la ligne est **toujours là** si la base l'a gardée |
| i | détachement **refusé** (`401`, réseau, inattendu) | message du dictionnaire **fermé** ; la confirmation se ferme ; la fiche est **relue** |
| j | affaire **archivée** détachée | elle part comme les autres (mesure 4) ; sa pilule ne change rien |
| k | rattachement **puis** détachement dans la même visite | les deux gestes cohabitent ; le message du détachement n'efface pas la zone, et le geste de rattachement offre de nouveau l'affaire détachée après la relecture |
| l | contact introuvable, erreur de lecture, ou absence d'espace de travail | **aucune commande n'est rendue** — il n'y a pas de tableau (règle du §17.7 cas n) |
| m | commandes et rôle | **aucune commande n'est éteinte d'avance**, quel que soit le rôle de l'appelant (mesure 7) |

### 18.8 Ce que la sous-tranche ne fait PAS, et pourquoi

- **Aucune modification du rôle d'un rattachement posé.** La politique `card_contacts_maj` existe en
  base depuis la tranche 1 ; aucun écran ne l'exerce. Détacher puis rattacher reste le chemin, et
  cette sous-tranche le rend possible **sans quitter la fiche** — ce qui réduit l'écart sans le
  combler. Il est nommé, comme au §12.8, plutôt que compensé par une commande morte.
- **Aucune suppression de contact**, toujours suspendue à l'arbitrage **non tranché** du §6
  point 4 : les valeurs `jsonb` qui désignent un contact supprimé demeurent en base
  (`docs/CloudWorker.md` §4.1 — une entrée qui attend un arbitrage ne se tranche jamais soi-même).
- **Le fil unifié n'apprend rien de ce geste** : `card_contacts` n'écrit aucun `card_event`, et la
  tranche 1 n'en a posé aucun trigger. L'écart est celui du §12.8, inchangé et toujours à arbitrer.
- **Le seed n'est PAS modifié.** Ses deux rattachements couvrent exactement les branches dont ce
  geste a besoin : `c2 → Léo` sur une affaire **active** que l'administratrice écrit, et
  `c4 → Sophie` sur une affaire que la **lectrice lit sans l'écrire** — c'est-à-dire la mesure 2,
  celle qui décide de l'issue « sans effet ». Y toucher déplacerait la garde de convergence de
  `apply-seed.sh`, qui compare `card_contacts` à **deux**, et le compteur que lit la règle 3 du
  classement (`CRM-055`) : le §11.7 a déjà tranché — on n'enrichit que ce qui ne casse rien.

### 18.9 Preuves exigées — sous-tranche 4i

| Niveau | Preuve |
|---|---|
| Unitaire | `webapp/src/app/FicheContact.test.tsx` : les cas a à m du §18.7 |
| API | `e2e/api/contacts.spec.ts` : les mesures 1 à 8 du §18.3 avec les **jetons réels**, chaque refus et chaque « sans effet » **relisant la ligne** pour la constater inchangée (décision 70) |
| E2E | `e2e/ui/contacts.spec.ts` : le détachement par les **gestes de l'écran**, le parcours **clavier**, le « sans effet » opposé à la lectrice, et le rendu à 390 px ; console **vierge** |
| Visible | captures sous `docs/captures/CRM-060/`, **observées** (`CLAUDE.md` §16) |
| i18n | `webapp/src/i18n/i18n.test.ts` (existant) : aucun texte visible en dur, aucune clé morte |
| Seed | `card_contacts` compte de nouveau ses **deux** lignes après la campagne, **restituées par les gestes de l'écran** |

### 18.10 Definition of Done de la sous-tranche 4i

- `webapp/src/app/FicheContact.tsx` : la quatrième colonne, la commande par ligne, la ligne de
  confirmation en `colSpan`, l'exclusivité des confirmations, le message sous le tableau et la
  relecture dans les trois issues ;
- **aucune modification de `webapp/src/lib/contacts.ts`** : `detacherContact` est celle de 4c ;
- test unitaire dédié : les cas a à m du §18.7 ;
- preuve d'API dédiée : les huit mesures d'écriture du §18.3 ;
- preuve E2E dédiée : les gestes, le clavier, le « sans effet », 390 px, console vierge ;
- captures produites **et observées** ;
- clés de traduction ajoutées, aucun texte en dur ;
- `docs/DESIGN_SYSTEM.md` §5.27 ajouté et §5.24 révisé ; `docs/manual.md` ; `CHANGELOG.md`, dans le
  même changement ;
- compteurs de `scripts/verify-harness.sh` **comptés** par `playwright test --list`, jamais déduits
  (INC-101) ;
- commentaires `@spec` / `@verifies` sur chaque fichier touché.

**Aucune migration : cette sous-tranche ne crée aucune colonne et n'ouvre aucune politique.**

**Ce qui restera dû sur `CRM-060` après 4i** : l'arbitrage sur les **références mortes** (§6,
point 4) et, derrière lui, la **suppression** d'un contact ; la **modification du rôle** d'un
rattachement posé (§18.8). L'unité demeure `[~]`.

## 19. Sous-tranche 4j — La modification du rôle d'un rattachement, depuis la fiche d'un contact

Contrat écrit **avant toute ligne de code** (`CLAUDE.md` §5, `docs/CloudWorker.md` §3.2), après
**quinze** mesures relevées à la main le 2026-08-19 sur la pile seedée, avec les jetons réels des
trois profils et avec la clé anonyme. Les mesures d'écriture ont été faites sur des rattachements
**sondes** posés puis purgés, plus une mesure sur une **ligne du seed** dont le refus a été relu
inchangé : le seed est rendu **intact**, ses deux rattachements relus à l'identique
(`c2 → Léo, decideur` et `c4 → Sophie, prescripteur`).

Le §12.8, puis le §17.8, puis le §18.8 nomment ce manque **trois fois**, et dans les mêmes termes :
« la politique `card_contacts_maj` existe en base depuis la tranche 1 ; aucun écran ne l'exerce ».
La fiche d'un contact **liste** ses affaires depuis 4f, **corrige** le contact depuis 4g, le
**rattache** depuis 4h et le **détache** depuis 4i — mais corriger un rôle mal saisi oblige encore à
détacher puis à rattacher, c'est-à-dire à détruire la ligne pour la refaire. C'est l'objet de cette
sous-tranche, et rien d'autre.

### 19.1 Ce que la sous-tranche livre, et ce qu'elle ne livre pas

**Elle livre**, sur la route `/contacts/:idContact` :

- une **commande de modification du rôle par ligne** du tableau des affaires ;
- son **formulaire dans le flux**, sur une ligne à lui, **prérempli** du rôle courant ;
- le traitement des **trois issues** que la mesure impose — appliquée, sans effet, refusée ;
- l'**effacement** d'un rôle, que la mesure 9 montre accepté par la base.

**Elle ne livre pas** : aucun déplacement d'un rattachement d'une affaire à une autre — la mesure 12
montre que la base l'accepterait, et le §19.8 dit pourquoi l'écran ne l'offre pas ; aucune création
ni suppression d'affaire ; et toujours **aucune suppression de contact**, suspendue à l'arbitrage
**non tranché** du §6 point 4. Chaque manque est repris au §19.8.

### 19.2 Une fonction NOUVELLE, et c'est le premier `UPDATE` du produit sur `card_contacts`

`webapp/src/lib/contacts.ts` porte `rattacherContact` (le `POST`) et `detacherContact` (le
`DELETE`), que 4h et 4i ont rappelées **inchangées**. Il n'existe **aucun** `UPDATE` sur cette
table : `card_contacts_maj` n'a jamais été exercée par un écran. Cette sous-tranche ajoute donc
`modifierRoleRattachement`, et c'est la seule fonction qu'elle écrit. **Aucune migration** — la
politique, la contrainte et les privilèges existent depuis la migration `0045`.

**LA MESURE 12 DÉCIDE DE CE QUE LA FONCTION ENVOIE, ET ELLE ENVOIE `role` SEUL.** MESURÉ : un
`PATCH` portant `card_id` dans son corps **DÉPLACE** le rattachement — `200`, la ligne rendue sur la
nouvelle affaire, et **plus rien** sur l'ancienne. Ce n'est pas une faille : la clause `USING` filtre
sur l'ancienne affaire et la clause `WITH CHECK` sur la nouvelle, si bien que le déplacement n'est
possible qu'entre deux affaires que l'appelant écrit **toutes les deux**. C'est une capacité réelle
de la base, que **cet écran n'exerce pas** (§19.8) : la fonction envoie `role`, et rien d'autre.
Envoyer les clés « pour être complet » ouvrirait un déplacement silencieux au premier champ ajouté à
un formulaire.

`.select(...)` accompagne la mise à jour pour la raison exacte du §18.2 : sans lui, PostgREST ne
rend aucun corps, et le refus silencieux de la clause `USING` serait indistinguable d'un succès.
`.maybeSingle()` et non `.single()` : zéro ligne est ici un **résultat attendu**, et `.single()` le
déguiserait en erreur `PGRST116`, c'est-à-dire en panne — la règle que `modifierContact` tient déjà
au §16.

### 19.3 Ce que la mise à jour rend — QUINZE MESURES, le 2026-08-19

`PATCH /rest/v1/card_contacts?card_id=eq.<affaire>&contact_id=eq.<contact>`, corps `{"role": …}`,
avec `Prefer: return=representation`.

| # | Acteur / requête | Mesure |
|---|---|---|
| 1 | administratrice, rattachement **existant** (sonde sur `…0c1`), `decideur` → `technique` | **`200`** et **la ligne**, `role` valant `technique` ; relue avec la clé de service : **modifiée** |
| 2 | **lectrice**, ligne **existante** d'une affaire qu'elle **LIT** (`…0c4 → Sophie`, ligne du **seed**) | **`200`** et **`[]`** — **aucune erreur** ; la ligne relue est **INCHANGÉE**, `role` toujours `prescripteur` |
| 3 | administratrice, rattachement **inexistant** (`…0c1 → Sophie`) | **`200`** et **`[]`** |
| 4 | administratrice, sur une affaire **ARCHIVÉE** (`…0c8`) | **`200`** et **la ligne** — la base ne s'y oppose **PAS** |
| 5 | **business developer**, rattachement existant | **`200`** et **la ligne** — le geste n'est **PAS** un geste d'administration |
| 6 | **anonyme**, rattachement existant | **`401`**, code **`42501`**, « permission denied for table card_contacts », l'indice nommant `GRANT UPDATE … TO anon` ; la ligne relue est **INCHANGÉE** |
| 7 | **lectrice**, sur `…0cb` « Assistant IA support — Nordis » | **`200`** et **la ligne** — elle **RÉUSSIT** |
| 8 | administratrice, rôle **chaîne vide** `""` | **`400`**, code **`23514`**, `card_contacts_role_check` ; la ligne relue est **INCHANGÉE** |
| 9 | administratrice, rôle **`null`** | **`200`** et la ligne, `role` valant **`null`** — **le rôle S'EFFACE** |
| 10 | administratrice, rôle **`"   "`** (espaces seuls) | **`400`**, code **`23514`** — `btrim(role) <> ''` |
| 11 | administratrice, identifiant d'affaire **mal formé** | **`400`**, code **`22P02`** |
| 12 | administratrice, corps portant `card_id` d'une **autre** affaire | **`200`** et la ligne **DÉPLACÉE** : plus rien sur `…0c1`, la ligne sur `…0c4` |
| 13 | administratrice, **même rôle** réécrit à l'identique | **`200`** et **la ligne** — ce n'est **PAS** un « sans effet » |
| 14 | administratrice, rôle de **500 caractères** | **`200`** et la ligne, **entière** — aucune contrainte de longueur |
| 15 | lecture embarquée de la fiche (§15.3) **avant** puis **après** | le `role` rendu par la fiche **suit** la modification |

**QUATRE MESURES DÉCIDENT DE CETTE SOUS-TRANCHE. Les autres confirment.**

**1. LA MESURE 2 RANGE 4j DU CÔTÉ DE 4g ET DE 4i, NON DE 4h.** La lectrice reçoit `200` et un
tableau **vide**, sans la moindre erreur, sur une ligne qui **existe** et qui reste en base avec son
rôle. La cause est structurelle et désormais écrite trois fois : une **insertion** est filtrée par
la clause `WITH CHECK`, qui **rejette** la ligne — d'où le `403` explicite du §17.4 ; une **mise à
jour** l'est par la clause `USING`, qui rend la ligne **invisible à l'écriture**, et PostgREST n'a
alors rien à modifier. Un message « sans effet » a donc un objet ici, et **refermer le formulaire
sur ce silence annoncerait une modification qui n'a pas eu lieu** — le mensonge que le §5.25 interdit
déjà pour la modification d'un contact.

**2. LA MESURE 9 OUVRE UN GESTE QUE 4h NE POUVAIT PAS OFFRIR : LE RÔLE S'EFFACE.** Un rôle `null`
est accepté, et la ligne le rend. Au rattachement, un rôle vide **valait** `null` faute d'alternative
— c'était le choix de la valeur qui exprime « pas de rôle » (§12.5). Ici, c'est un **geste** : un
rôle saisi par erreur se retire sans détruire le rattachement. Le formulaire vidé **efface** donc le
rôle, et il le dit en toutes lettres plutôt que de laisser deviner ce qu'un champ vide va produire.

**3. LES MESURES 8 ET 10 IMPOSENT LA MÊME NORMALISATION QU'AU RATTACHEMENT, ET ELLES LA MESURENT
DEUX FOIS.** La chaîne vide **et** la chaîne blanche sont refusées par `card_contacts_role_check`
(`role is null or btrim(role) <> ''`), toutes deux en `400` / `23514`. Ce n'est **pas** une garde de
saisie doublant la base au sens du §5.3 ter : la base refuserait ces deux valeurs, et la fonction ne
les envoie jamais — elle envoie `null`, qui est la valeur que la base accepte pour dire « pas de
rôle ». C'est exactement la règle du §12.5, transposée d'une insertion à une mise à jour, et la
mesure 10 est la preuve qu'un `trim` seul ne suffirait pas.

**4. LA MESURE 7 INTERDIT À L'ÉCRAN DE CALCULER LE DROIT, et elle est le pendant exact de la
mesure 19 de 4h et de la mesure 7 de 4i.** La lectrice **réussit** la modification sur `…0cb` et se
voit opposer le silence sur `…0c4`, deux affaires qu'elle **lit** l'une comme l'autre. Les droits
fins de `CRM-012` divergent d'une affaire à l'autre **pour un même profil** : aucune propriété du
profil ne prédit l'issue. Une interface qui grisrait la commande « parce que l'utilisateur est
lecteur » lui retirerait un geste que la base lui accorde.

**LA MESURE 13 FERME UN CHEMIN QUE L'ÉCRAN AURAIT PU INVENTER.** Réécrire le **même** rôle rend
`200` et la ligne, jamais zéro ligne : PostgreSQL réécrit la ligne sans comparer. Un utilisateur qui
ouvre le formulaire et l'envoie sans rien changer reçoit donc un **succès**, et l'écran n'a aucun cas
« aucun champ n'a changé » à traiter — c'est le raisonnement que le §16.3 a déjà tenu pour la
modification d'un contact, confirmé ici par la mesure.

**LA MESURE 14 INTERDIT UNE GARDE DE LONGUEUR.** Cinq cents caractères sont acceptés et rendus
entiers. Poser un `maxLength` à l'écran serait une règle de produit que personne n'a prise
(`CLAUDE.md` §10), et la cellule du tableau borne déjà l'**affichage** à `32ch` avec son `title`
(§5.9) — ce qui est une règle de rendu, pas une règle de donnée.

**Les mesures 6 et 11 ne sont pas atteignables depuis l'écran, et sont relevées pour fermer le
classement.** La route est derrière l'authentification, et l'identifiant de l'affaire vient de la
**donnée déjà lue**, jamais d'une saisie. Elles disent néanmoins ce que le dictionnaire du §19.5
doit couvrir sans jamais mentir : `401` est classé `forbidden` par `classerRefusRattachement`, et
`22P02` tombe dans `unknown`.

**Deux natures de refus sont STRUCTURELLEMENT INATTEIGNABLES sur cette surface**, et le §19.5 dit ce
qu'il en fait : `23505` (`deja-rattache`) suppose une insertion sur une clé déjà prise — la mise à
jour ne touche pas la clé —, et `23503` (`contact-inconnu`) suppose une clé étrangère à éprouver,
qu'une écriture du seul `role` n'éprouve pas.

**Une nature de refus est en revanche ATTEIGNABLE ICI ET NULLE PART AILLEURS SUR CETTE FICHE** :
`23514`, la saisie invalide de la mesure 8. Elle ne peut pas survenir, la fonction normalisant la
saisie ; elle est néanmoins **traduite**, parce que le §19.2 interdit d'affirmer qu'une issue est
impossible quand seule la fonction — et non la base — l'empêche.

### 19.4 Où le geste s'ancre — UNE SECONDE COMMANDE DANS LA QUATRIÈME COLONNE

**Décision : la commande de modification du rôle rejoint celle de détachement dans la quatrième
colonne du tableau, et son formulaire occupe une LIGNE À ELLE, immédiatement sous celle qu'il
concerne, sur toute la largeur.**

C'est l'emplacement que le §18.4 a tranché, **repris sans changement et pour les motifs qu'il
écrit** — la cellule bornée à `32ch` et tronquée ne peut pas porter un formulaire, et sous le
tableau rien ne relierait ce formulaire à **sa** ligne. La seule chose que cette sous-tranche ajoute
est la **cohabitation** de deux gestes sur la même ligne, et elle appelle une règle propre :

**UN SEUL BLOC OUVERT À TOUT INSTANT DANS LE TABLEAU, TOUTES LIGNES ET TOUS GESTES CONFONDUS.** Le
§18.4 posait « une seule confirmation à la fois » ; la règle s'étend aux deux gestes. Ouvrir le
formulaire de rôle d'une ligne ferme la confirmation de détachement d'une autre, et réciproquement.
Deux blocs ouverts feraient deux questions dans le flux, dont rien ne dirait laquelle on répond, et
sur un tableau étroit ils se pousseraient l'un l'autre hors de vue.

**Les DEUX commandes d'une ligne sont désactivées tant qu'un bloc de CETTE ligne est ouvert.** Le
motif du §18.4 vaut pour les deux : elles ne sont jamais démontées — leur retrait ferait sauter la
hauteur de la ligne au moment où l'on demande de lire —, et une commande dont le bloc est déjà
ouvert n'a rien à rouvrir. Ce n'est pas une garde de droit. Les commandes des **autres** lignes
restent actives : les activer ferme le bloc courant et ouvre le leur, ce que la règle d'exclusivité
ci-dessus décrit déjà.

**L'ordre des deux commandes est : modifier le rôle, puis détacher.** Le geste qui **corrige**
précède le geste qui **retire**, comme la colonne gauche de la fiche d'affaire place « Modifier »
avant le bloc de corbeille (§5.3, §5.3 ter). Un geste destructeur ne se pose jamais en premier sous
le pointeur.

**Le geste de rattachement (§17.2) ne bouge pas**, et le §18.4 l'avait déjà écrit : il reste sous le
titre de la zone, au-dessus du tableau. Trois gestes agissent désormais sur cette zone, et chacun
est posé près de ce qu'il change — l'un ajoute une ligne, l'un en corrige une nommée, l'un en retire
une nommée.

### 19.5 Les refus, traduits par un dictionnaire FERMÉ

Le message du serveur n'atteint **jamais** l'écran (§12.5, §17.4, §18.5). Le classement est celui de
`classerRefusRattachement`, **repris sans changement** : code PostgreSQL d'abord, code HTTP ensuite.
Une nature s'y ajoute, `saisie-invalide`, que la mesure 8 rend atteignable sur cette surface.

| Nature | Atteignable ici ? | Ce que l'écran dit |
|---|---|---|
| `forbidden` (`401`/`403`) | **oui**, hors écran (mesure 6) | la modification a été refusée ; rechargez la fiche |
| `network` | **oui** | la requête n'a pas abouti |
| `unknown` | **oui** (mesure 11, et tout le reste) | la modification a échoué |
| `saisie-invalide` (`23514`) | **oui en base** (mesures 8 et 10), **non depuis l'écran** — la fonction normalise | le rôle saisi n'est pas accepté |
| `deja-rattache` (`23505`) | **non** — suppose une insertion, et la clé n'est pas touchée | même texte que `unknown` |
| `contact-inconnu` (`23503`) | **non** — une écriture du seul `role` n'éprouve aucune clé étrangère | même texte que `unknown` |

**`saisie-invalide` reçoit un texte PROPRE là où les deux autres inatteignables partagent celui
d'`unknown`, et l'écart est motivé.** Les deux dernières sont impossibles **par construction** — la
forme de la requête les exclut, quoi que fasse l'appelant. `saisie-invalide`, elle, n'est empêchée
que par la **normalisation de la fonction** : c'est une issue que la base produit réellement (deux
fois mesurée), et lui donner le texte d'« une erreur est survenue » masquerait une cause connue
derrière un fourre-tout, ce que `CLAUDE.md` §18 interdit. Le dictionnaire reste **exhaustif** — le
type l'impose —, et le motif est écrit dans le fichier.

**L'issue `sans-effet` n'est PAS dans ce tableau, et c'est le point du §19.3.** Elle n'est ni un
succès ni une erreur : elle a son propre message, et le formulaire **reste ouvert**.

### 19.6 De quoi le geste a l'air

Le rendu **hérite du §5.27** — le geste voisin, dans la même colonne et sur la même forme de ligne —
et du §5.25, dont il reprend le traitement du refus silencieux. `docs/DESIGN_SYSTEM.md` §5.28 est
ajouté dans le même changement. Ce qui suit ne dit que ce qui lui est propre.

- **Une commande par ligne, à l'icône `PencilLine`** — celle de la famille « Champs » du fil (§5.11)
  et de la commande « Modifier » de l'en-tête d'affaire (§5.3 ter) : c'est le même genre de geste,
  et lui en donner une autre ferait lire un geste différent. Taille compacte, comme sa voisine.
- **Le champ est PRÉREMPLI du rôle courant** (§5.25) : c'est précisément ce que l'on vient corriger.
  Un rattachement **sans** rôle donne un champ **vide**, jamais le texte « null ».
- **Le formulaire NOMME L'AFFAIRE**, comme la confirmation du §18.6 et pour le motif retourné du
  §12.6 : sur cette page le contact est le décor, l'affaire varie. Sans ce nom, un formulaire ouvert
  sous une ligne d'un tableau qui défile ne dirait plus quel rattachement il modifie.
- **Le texte d'aide dit que VIDER LE CHAMP EFFACE LE RÔLE** (mesure 9). C'est un geste destructeur
  discret — la seule donnée du rattachement disparaît — et le §6 exige qu'un geste dise ce qu'il
  fait. Ce n'est pas une confirmation : la ligne reste, le rattachement reste, et le rôle se
  réécrit d'un second geste identique.
- **Le bouton d'envoi est PRIMAIRE, jamais destructif.** Corriger un rôle n'efface rien qui ne se
  refasse par le même formulaire, et la teinte de danger est réservée à ce qui détruit (§1, §6) —
  c'est l'écart avec la confirmation voisine du §5.27, et il est écrit pour qu'on ne recopie pas une
  teinte sans son motif.
- **Aucune confirmation.** Le §6 la réserve aux gestes destructifs ; celui-ci se défait en le
  rejouant. En demander une banaliserait celle qui protège le détachement, sur la même ligne.
- **Le bouton d'envoi n'est JAMAIS désactivé par l'état du champ.** Un champ vide est un envoi
  **légitime** — c'est l'effacement de la mesure 9 —, à la différence du sélecteur de 4h qui n'a
  rien à envoyer sans affaire choisie. Il l'est pendant le vol, et porte alors son libellé d'attente.
- **Aucune commande n'est éteinte d'avance selon le rôle** (§5.21, §5.23, §5.25, §5.26, §5.27, sans
  exception) : la lectrice voit la commande, envoie, et reçoit — selon l'affaire — une modification
  **réelle** (mesure 7) ou le message « sans effet » (mesure 2).
- **Une affaire ARCHIVÉE porte la commande comme les autres** (mesure 4). Rien à l'écran ne
  distingue sa ligne, hors la pilule que le §15.3 y pose déjà.
- **Aucune garde de longueur** (mesure 14) : ni `maxLength`, ni compteur de caractères.
- **UN REFUS ET UN « SANS EFFET » LAISSENT LE FORMULAIRE OUVERT, ET LA SAISIE EST CONSERVÉE**
  (§5.7 ter, §5.25). C'est l'écart avec le §18.6, où la confirmation se ferme dans les trois issues :
  là-bas il n'y a **rien à conserver**, une confirmation ne portant aucune saisie. Ici le rôle tapé
  est un travail de l'utilisateur, et le perdre pour une erreur qui n'est pas la sienne serait la
  valeur par défaut trompeuse que `CLAUDE.md` §18 interdit. Le message se lit **dans** le formulaire,
  près du champ qui l'a causé (§5.13).
- **LA FICHE PREND LA LIGNE RENDUE, ET NE RELIT RIEN** (§16.7). C'est le second écart avec le
  §18.6, et il est mesuré : le `PATCH` rend la ligne modifiée, et cette sous-tranche ne change **ni
  l'ensemble des lignes, ni aucune donnée que l'écriture ignore**. La relecture de 4h et de 4i
  existait parce qu'un rattachement ajouté apporte un archivage et une adresse que le formulaire ne
  connaît pas, et parce qu'une ligne retirée change l'ensemble ; ici seule une valeur scalaire d'une
  ligne déjà affichée est réécrite. Relire serait une seconde requête pour une donnée en main.
- **Sur un succès, le formulaire se ferme et AUCUN message n'est affiché.** La cellule du rôle
  **porte** le nouveau rôle : c'est la confirmation, et en écrire une seconde dirait deux fois la
  même chose (§5.7 ter, « la confirmation remplace l'envoi »).
- **Le focus entre dans le champ à l'ouverture, et revient à la commande de SA ligne à la
  fermeture**, sans être différé — la commande n'est jamais démontée, seulement désactivée. C'est
  la règle du §5.27, tenue à l'identique et pour son motif exact. **Aucune temporisation.**
- **La zone 1 et le titre de la route ne bougent pas** — règle du §17.6 et du §18.6, tenue à
  l'identique : aucun champ de ce formulaire n'entre dans les caractéristiques du contact.
- **L'état vide de la zone des affaires ne gagne aucune commande** : un tableau sans ligne n'a aucun
  rôle à modifier. Le §5.24 est révisé sur ce point précis, comme il l'a été pour 4i.

### 19.7 Contrat de comportement, cas a à p

| # | Situation | Attendu |
|---|---|---|
| a | fiche avec au moins une affaire | **chaque** ligne porte ses **deux** commandes — modifier le rôle, puis détacher —, y compris la ligne d'une affaire **archivée** ; aucun bloc n'est rendu |
| b | commande de rôle activée | une **ligne de formulaire** apparaît sous la ligne concernée, sur toute la largeur, **nommant l'affaire** ; le champ est **prérempli** du rôle courant et le focus y entre |
| c | ligne **sans** rôle | le champ est **vide**, jamais « null » |
| d | fermeture par « Annuler » | la ligne de formulaire est démontée, **et le focus revient à la commande de rôle de SA ligne** |
| e | ouverture du formulaire de rôle d'une **autre** ligne | le précédent est fermé ; **un seul** bloc existe à tout instant |
| f | ouverture de la **confirmation de détachement** pendant qu'un formulaire de rôle est ouvert | le formulaire de rôle est fermé ; la règle d'exclusivité vaut **entre les deux gestes** (§19.4) |
| g | envoi pendant que la requête vole | le bouton d'envoi est **désactivé** et porte son libellé d'attente ; aucune seconde requête n'est émise |
| h | modification **appliquée** | le formulaire se ferme, **la cellule du rôle porte la nouvelle valeur**, **aucune relecture** n'est émise et **aucun message** n'est affiché |
| i | champ **vidé** puis envoyé | le rôle est envoyé `null` (mesure 9), la cellule du rôle devient **vide**, et le rattachement **demeure** |
| j | rôle réduit à des **espaces** | il est envoyé `null`, jamais `"   "` que la base refuserait (mesure 10) |
| k | **même** rôle réenvoyé | c'est un **succès** (mesure 13), jamais un « sans effet » |
| l | modification **sans effet** (lectrice sur une affaire qu'elle ne peut pas écrire, ou ligne disparue) | message « aucun rôle n'a été modifié » **dans le formulaire**, `role="alert"` ; le formulaire **reste ouvert**, la saisie est **conservée**, la cellule du rôle est **inchangée** |
| m | modification **refusée** (`401`, réseau, saisie invalide, inattendu) | message du dictionnaire **fermé** ; le formulaire **reste ouvert** et la saisie est **conservée** |
| n | affaire **archivée** | son rôle se modifie comme les autres (mesure 4) ; sa pilule ne change rien |
| o | modification **puis** détachement de la même ligne | les deux gestes cohabitent ; le détachement retire la ligne et son message vit **sous** le tableau, à sa place du §18.6 |
| p | contact introuvable, erreur de lecture, ou absence d'espace de travail | **aucune commande n'est rendue** — il n'y a pas de tableau (règle du §17.7 cas n et du §18.7 cas l) |

### 19.8 Ce que la sous-tranche ne fait PAS, et pourquoi

- **Aucun DÉPLACEMENT d'un rattachement d'une affaire à une autre**, alors que **la base l'accepte**
  (mesure 12). Ce n'est pas une garde de droit — les deux clauses de `card_contacts_maj` encadrent
  déjà le geste des deux côtés —, c'est le refus d'offrir une commande dont personne n'a spécifié le
  produit : déplacer un rattachement est indistinguable, pour l'utilisateur, d'un détachement suivi
  d'un rattachement, que 4i et 4h livrent **déjà** sur cette page, nommément et en deux gestes
  lisibles. La capacité est **nommée** ici plutôt qu'exercée à la faveur d'un champ ajouté.
- **Aucune suppression de contact**, toujours suspendue à l'arbitrage **non tranché** du §6
  point 4 : les valeurs `jsonb` qui désignent un contact supprimé demeurent en base
  (`docs/CloudWorker.md` §4.1 — une entrée qui attend un arbitrage ne se tranche jamais soi-même).
- **Le fil unifié n'apprend rien de ce geste** : `card_contacts` n'écrit aucun `card_event`, et la
  tranche 1 n'en a posé aucun trigger. L'écart est celui du §12.8 et du §18.8, inchangé et toujours
  à arbitrer.
- **Le rôle n'est ni énuméré, ni suggéré, ni complété.** `docs/SCHEMA.md` §6 l'illustre par
  `decideur`, `prescripteur`, `technique`, « … », et la contrainte porte sur la **forme**, jamais sur
  une liste (§2.3). Offrir les valeurs déjà employées dans le workspace serait une lecture nouvelle
  au service d'une commodité que personne n'a demandée.
- **Le seed n'est PAS modifié.** Ses deux rattachements couvrent exactement les branches dont ce
  geste a besoin : `c2 → Léo, decideur` sur une affaire **active** que l'administratrice écrit, et
  `c4 → Sophie, prescripteur` sur une affaire que la **lectrice lit sans l'écrire** — c'est-à-dire
  la mesure 2, celle qui décide de l'issue « sans effet ». Les deux portent en outre un rôle **non
  nul**, ce que le préremplissage du cas b exige. Y toucher déplacerait la garde de convergence de
  `apply-seed.sh`, qui compare `card_contacts` à **deux**, et le compteur que lit la règle 3 du
  classement (`CRM-055`) : le §11.7 a déjà tranché — on n'enrichit que ce qui ne casse rien.

### 19.9 Preuves exigées — sous-tranche 4j

| Niveau | Preuve |
|---|---|
| Unitaire | `webapp/src/lib/contacts.test.ts` : la requête émise — `role` **seul** —, la normalisation des mesures 8 à 10, et les trois issues. `webapp/src/app/FicheContact.test.tsx` : les cas a à p du §19.7 |
| API | `e2e/api/contacts.spec.ts` : les mesures 1 à 14 du §19.3 avec les **jetons réels**, chaque refus et chaque « sans effet » **relisant la ligne** pour la constater inchangée (décision 70) |
| E2E | `e2e/ui/contacts.spec.ts` : la modification par les **gestes de l'écran**, le parcours **clavier**, l'effacement du rôle, le « sans effet » opposé à la lectrice, et le rendu à 390 px ; console **vierge** |
| Visible | captures sous `docs/captures/CRM-060/`, **observées** (`CLAUDE.md` §16) |
| i18n | `webapp/src/i18n/i18n.test.ts` (existant) : aucun texte visible en dur, aucune clé morte |
| Seed | `card_contacts` compte ses **deux** lignes après la campagne, **avec leurs rôles d'origine**, restitués par les gestes de l'écran |

### 19.10 Definition of Done de la sous-tranche 4j

- `webapp/src/lib/contacts.ts` : `modifierRoleRattachement`, son type de résultat à **trois** issues,
  et la nature `saisie-invalide` ajoutée au classement — **`role` seul dans le corps** (mesure 12) ;
- `webapp/src/app/ModificationRoleRattachement.tsx` : la commande par ligne, le formulaire prérempli
  nommant l'affaire, et le dictionnaire **fermé** de refus ;
- `webapp/src/app/FicheContact.tsx` : la seconde commande de la quatrième colonne, la ligne de
  formulaire en `colSpan`, **l'exclusivité entre les deux gestes**, et la mise à jour locale de la
  cellule du rôle sans relecture ;
- test unitaire dédié : la fonction, puis les cas a à p du §19.7 ;
- preuve d'API dédiée : les quatorze mesures d'écriture du §19.3 ;
- preuve E2E dédiée : les gestes, le clavier, l'effacement, le « sans effet », 390 px, console
  vierge ;
- captures produites **et observées** ;
- clés de traduction ajoutées, aucun texte en dur ;
- `docs/DESIGN_SYSTEM.md` §5.28 ajouté et §5.24 **révisé par livraison** ; `docs/manual.md` ;
  `CHANGELOG.md`, dans le même changement ;
- compteurs de `scripts/verify-harness.sh` **comptés** par `playwright test --list`, jamais déduits
  (INC-101) ;
- commentaires `@spec` / `@verifies` sur chaque fichier touché.

**Aucune migration : cette sous-tranche n'ouvre aucune politique et ne crée aucune colonne. Elle
exerce `card_contacts_maj`, posée par la migration `0045` et jamais atteinte par un écran jusqu'ici.**

**Ce qui restera dû sur `CRM-060` après 4j** : l'arbitrage sur les **références mortes** (§6,
point 4) et, derrière lui, la **suppression** d'un contact ; le **fil unifié**, qui n'apprend rien
des trois gestes de rattachement (§12.8). L'unité demeure `[~]`.

---

## 19. Tranche 5 — Le fil de l'affaire apprend les rattachements de contacts

**Écrite avant la première ligne de code**, le 2026-08-25, en exécution de la **décision 517**
(`docs/ARBITRAGES.md` §5), qui tranche l'écart nommé au §12.8 : « le fil unifié n'apprend rien de ce
geste ».

### 19.1 Ce que la tranche livre, et ce qu'elle ne livre pas

**Livré** : les trois gestes de `card_contacts` — rattacher, détacher, changer le rôle — laissent
chacun une trace dans `card_events`, et le fil de l'affaire la NOMME.

**Non livré, et nommé plutôt que compensé** : aucune trace côté **contact**. La fiche d'un contact
n'a pas de fil, et lui en donner un demanderait une table dont personne n'a besoin ailleurs. Aucun
filtre nouveau non plus : la barre du §5.11 reste à cinq bascules.

### 19.2 Pourquoi un trigger de TABLE, et non les écrans

Trois surfaces écrivent aujourd'hui dans `card_contacts` — la fiche d'affaire (4c), la fiche de
contact (4h, 4i) et la modification du rôle (4j) —, et rien n'interdit qu'une quatrième arrive. Une
trace écrite par chaque écran serait **trois fois la même règle**, donc trois occasions de diverger,
et une quatrième surface l'oublierait en silence.

Le trigger est posé sur la TABLE, exactement comme `CRM-081` l'a fait pour le sommeil
(`docs/SPEC-cards.md` §16.5) : la trace suit la DONNÉE, pas le geste. Un rattachement écrit par la
clé de service — un import, un seed — laisse donc lui aussi sa trace.

### 19.3 Les trois types, et le vocabulaire qui passe de quinze à dix-huit

| Type | Écrit quand | Payload, clés exactes |
|---|---|---|
| `contact_linked` | `INSERT` sur `card_contacts` | `contact_id`, `role` (nul si absent) |
| `contact_unlinked` | `DELETE` sur `card_contacts` | `contact_id`, `role` (celui qu'il portait) |
| `contact_role_changed` | `UPDATE OF role`, et **seulement si la valeur bouge** | `contact_id`, `from`, `to` |

**Le payload ne porte AUCUN libellé** (`docs/SPEC-cards.md` §14.6) : ni le nom du contact, ni celui
de l'organisation. Un nom recopié dans un événement immuable devient faux le jour où le contact est
renommé, et le fil se mettrait à mentir sur son propre passé. L'écran résout le nom à la lecture.

**`is distinct from` sur le rôle**, comme les cinq gardes de `CRM-044` : une écriture qui ne déplace
pas la valeur n'allonge pas l'histoire, ce qui rend un rejeu convergent.

### 19.4 La migration, et la garde qu'INC-210 rend obligatoire

La contrainte `card_events_type_check` passe à **dix-huit** valeurs, et la migration porte les
**deux** gardes d'INC-144 : la première regarde la contrainte — converger seulement si
`contact_linked` en est absent —, la seconde regarde les **lignes** et interdit de converger si
l'une porte un type que cette migration ne connaît pas. La migration 44 avait omis la seconde, et
`stalled` a rendu le répertoire non rejouable (INC-210, décision 507) : la leçon est appliquée le
jour même, et non redécouverte.

### 19.5 Ce que l'écran en fait — et le piège d'INC-207, qui ne se répétera pas

`CRM-062` a livré `stalled` en base sans l'inscrire dans `TYPES_EVENEMENT`, `FAMILLE_PAR_TYPE` ni
les traductions : le fil rendait **« Événement »**, et la tranche avait livré la moitié de sa propre
spécification. Les trois types sont donc, **dans le même changement** :

- ajoutés à `TYPES_EVENEMENT` (`webapp/src/lib/timeline.ts`) ;
- rangés **explicitement** dans `FAMILLE_PAR_TYPE`, famille **`organisation`** — « qui travaille sur
  cette affaire, et où vit-elle ? » est la question de cette famille, celle qui porte déjà
  `channel_changed` et `workflow_changed`. Aucune sixième bascule n'est ajoutée (§5.11) ;
- traduits dans `webapp/src/i18n/fr.ts`, avec leur détail : « Contact rattaché », « Contact
  détaché », « Rôle du contact modifié », et le rôle en détail quand il existe.

Une boucle de preuve vérifie que **les dix-huit** types sont rangés dans `FAMILLE_PAR_TYPE` : un
dix-neuvième ajouté sans y figurer retomberait sur le repli documenté, et l'oubli d'INC-207 se
répéterait sans que rien ne rougisse.

### 19.6 Autorisations — aucune n'est ajoutée, et c'est un point de contrôle

`card_events` n'accorde **aucun** privilège d'écriture, `service_role` compris
(`docs/SPEC-cards.md` §14.7) : le trigger passe par `app.card_event_ecrire()`, seule voie
d'écriture. La lecture d'un événement suit la lecture de son affaire — un profil qui ne lit pas
l'affaire ne lit pas ses rattachements. Aucune politique n'est créée, aucune n'est modifiée.

### 19.7 Contrat de comportement — mesuré sur le seed

| Cas | Geste | Attendu |
|---|---|---|
| a | rattacher un contact à une affaire | exactement **un** `contact_linked`, `payload` aux deux clés, acteur = l'appelant |
| b | détacher ce contact | exactement **un** `contact_unlinked`, portant le rôle qu'il avait |
| c | changer le rôle | **un** `contact_role_changed`, `from` et `to` distincts |
| d | réécrire le MÊME rôle | **aucun** événement de plus — `is distinct from` |
| e | rattacher par la clé de service | trace écrite quand même : elle suit la donnée |
| f | lire le fil sans lire l'affaire | **aucune** ligne — la RLS de `card_events` décide seule |
| g | le fil de l'affaire, à l'écran | les trois libellés rendus, jamais « Événement » |

### 19.8 Preuves exigées — tranche 5

| Niveau | Preuves attendues |
|---|---|
| pgTAP | le vocabulaire compte dix-huit valeurs ; le trigger existe sur `card_contacts` et sa fonction est `SECURITY DEFINER`, propriétaire `postgres`, `search_path` vide ; les cas a à e, chacun précédé de son témoin |
| API | les trois gestes par la vraie route PostgREST avec les jetons réels, la trace relue dans `card_events` ; le cas f mesuré avec le jeton de la lectrice |
| Unitaire (webapp) | les trois types rangés dans `FAMILLE_PAR_TYPE`, la boucle sur les dix-huit, les trois libellés et leur détail |
| E2E d'interface | le fil d'une affaire montre le rattachement fait à l'écran, avec son libellé — cas g |
| Visuel | une capture du fil portant les trois lignes, produite **et observée** |
| Harnais | `scripts/verify-contacts.sh` étendu, non complaisant : retirer un type de `FAMILLE_PAR_TYPE` doit faire rougir, retirer le trigger aussi |
| Seed | le seed pose ses rattachements par le VRAI chemin, donc les traces existent sans fixture |

### 19.9 Definition of Done — tranche 5

Les sept preuves ci-dessus vertes, la migration rejouable **sur une base portant déjà ses propres
types** (INC-210), le vocabulaire à dix-huit dans `docs/SCHEMA.md` et `docs/SPEC-cards.md` §14.4,
`docs/manual.md` mis à jour là où il décrit le fil, et le §12.8 **révisé par livraison** — l'écart
qu'il nommait n'existe plus.
