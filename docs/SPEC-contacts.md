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
un seul déplacement de compteur au lieu de deux. Ce n'est pas un renoncement à `CLAUDE.md` §8 : le
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
