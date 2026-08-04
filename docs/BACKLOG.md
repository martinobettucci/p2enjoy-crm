# Backlog — P2Enjoy CRM

Unités d'exécution du projet. L'ordre et les règles d'avancement sont dans
`docs/MASTER_PLAN.md` ; la Definition of Done commune y figure au §4.

## Marquage

- `[ ]` non commencé ;
- `[~]` en cours, ou implémenté mais insuffisamment vérifié ;
- `[x]` terminé **et intégralement vérifié**.

Une unité ne passe `[x]` qu'avec ses preuves : test unitaire dédié, test API ou d'intégration
dédié, test E2E dédié, vérification visuelle observée si l'interface est touchée, seed à jour,
documentation à jour, commit poussé. **Aucune exception.**

---

## Chunk 1 — Documentation

### CRM-000 — Socle documentaire `[x]`

- [x] `README.md`, `CHANGELOG.md`.
- [x] `docs/DAT.md`, `docs/SCHEMA.md`, `docs/DESIGN_SYSTEM.md`.
- [x] `docs/SPEC-workflow-engine.md`, `docs/SPEC-form-composer.md`,
      `docs/SPEC-mail-subsystem.md`, `docs/SPEC-permissions-rls.md`.
- [x] `docs/MASTER_PLAN.md`, `docs/BACKLOG.md`, `docs/JOURNAL.md`,
      `docs/PROD_MIGRATIONS.md`, `docs/manual.md`, `docs/INCONSISTENCY_REPORT.md`.
- [x] Commit documentaire dédié, poussé avant toute ligne de code.

*DoD réduite : unité purement documentaire, sans code ni interface, donc sans test ni capture.*

---

## Chunk 2 — Infrastructure et socle d'identité

### CRM-001 — Pile Supabase self-hosted `[x]`
Pile self-hosted à versions épinglées. Assemblage `docker-compose.yml` + overlays dev et prod.
MinIO en dev, Storage sur S3.
**DoD** : `docker compose up` démarre tous les services sains ; Kong répond ; Studio accessible en
dev ; aucun service de développement présent en prod.

- [x] Assemblage commun `docker-compose.yml` : `db`, `migrations-runner`, `auth`, `rest`,
      `realtime`, `storage`, `supavisor`, `kong`. Toutes les images épinglées à une version
      exacte.
- [x] Overlay `docker-compose.dev.yml` : Studio, `postgres-meta`, MinIO, Inbucket ; ports publiés
      sur l'interface de bouclage uniquement.
- [x] Overlay `docker-compose.prod.yml` : Caddy, aucun outillage de développement, ni Kong ni
      PostgreSQL publiés.
- [x] Démarrage à froid vérifié : volumes et `PGDATA` détruits, puis `up` en **26 s**, les
      11 services de longue durée `healthy`, les 2 conteneurs éphémères terminés en `0`.
- [x] Kong répond et **filtre réellement** : `401` sans clé, `200` avec la clé de service, `403`
      pour la clé anonyme sur la racine OpenAPI.
- [x] Studio accessible en développement (`200`), capture produite **et observée** :
      `docs/captures/CRM-001/`.
- [x] Assemblage de production **réellement démarré** : les 8 services `healthy` (Caddy compris),
      redirection `http` → `https`, API jointe en TLS, aucun conteneur `studio`, `meta`, `minio`
      ou `inbucket`, seuls les ports `80` et `443` publiés.
- [x] Chaîne de stockage prouvée de bout en bout : objet déposé par l'API, relu à l'identique, et
      **retrouvé dans le bucket MinIO** par un client S3.
- [x] Harnais de preuves rejouable `scripts/verify-stack.sh` : **33 contrôles, aucune anomalie**,
      et **non complaisant** — il échoue bien lorsqu'un service est arrêté, lorsque MinIO est
      coupé, ou lorsqu'un service de développement est réintroduit en production.

*DoD adaptée, écarts explicites.* Aucun test unitaire ni test E2E dédié : cette unité ne livre
aucune logique métier ni parcours utilisateur, seulement l'assemblage d'exécution. Les preuves
correspondantes sont d'intégration et vivent dans `scripts/verify-stack.sh`. Le harnais Vitest,
pytest et Playwright reste l'objet de `CRM-008`, et le seed celui de `CRM-005`.

*Limites nommées, non masquées.*

- La valeur par défaut `STACK_RLIMIT_NOFILE=100000` **n'a pas pu être vérifiée** :
  l'environnement de la routine est privé de `CAP_SYS_RESOURCE` et plafonne à 4096 descripteurs.
  Les vérifications ont donc tourné à `4096` (`docs/JOURNAL.md`, décision 14).
- L'obtention d'un certificat **ACME** n'est pas prouvée : la vérification de production a utilisé
  `APP_DOMAIN=localhost`, donc l'autorité interne de Caddy.
- La production a été démarrée contre un **fournisseur S3 simulé**, faute de compte S3 réel.
- La pile provient de la distribution self-hosted **officielle** de Supabase et non de
  `../starter.2025.12/`, absent de l'environnement : voir `docs/INCONSISTENCY_REPORT.md`, INC-006,
  **en attente d'arbitrage du responsable**.

### CRM-002 — Scripts de lancement et environnement `[x]`
`runDev.sh`, `runProd.sh`, `resetMe.sh`, `.env.example` documentant **chaque** variable (rôle,
format, obligatoire ou non, exemple non sensible). La liste exhaustive des variables déjà
consommées par les fichiers Compose de `CRM-001` figure dans `docs/JOURNAL.md`, décision 15 :
`.env.example` doit la couvrir intégralement.
**DoD** : démarrage à froid depuis un dépôt propre ; `resetMe.sh` recrée la base et le seed ;
aucun secret réel versionné ; `README.md` §5–6 conforme au comportement réel.

- [x] `.env.example` : **76 variables**, chacune documentée avec son rôle, son format, son
      caractère obligatoire et une valeur d'exemple non sensible. Le gabarit couvre **exactement**
      les 72 variables interpolées par les trois fichiers Compose ; les 4 restantes sont nommées
      et justifiées dans `scripts/verify-scripts.sh`.
- [x] Aucun secret réel versionné : les 14 variables sensibles valent un marqueur `CHANGE_ME_*`,
      et `.env` est ignoré par git — vérifié.
- [x] `runDev.sh` amorce `.env` au premier lancement, chaque secret **tiré au hasard**, en mode
      `600`, sans jamais écraser un fichier existant. `ANON_KEY` et `SERVICE_ROLE_KEY` sont des
      jetons HS256 réellement dérivés du `JWT_SECRET` produit — signature et rôle vérifiés.
- [x] Démarrage à froid depuis un dépôt propre — ni `.env`, ni `PGDATA` — par la seule commande
      `./runDev.sh` : amorçage puis pile démarrée en **31,8 s**, 11 services `healthy`, 2
      éphémères terminés en `0`.
- [x] `scripts/verify-stack.sh` rejoué contre le `.env` **amorcé par le script** : **33 contrôles,
      aucune anomalie**. Les jetons produits sont donc réellement acceptés par Kong, PostgREST,
      Storage et Realtime.
- [x] `resetMe.sh` recrée bien la base : identifiant de cluster PostgreSQL changé, table témoin
      disparue, redémarrage à froid en **38,9 s**, `verify-stack.sh` de nouveau à 33/33.
- [x] `runProd.sh` démarre réellement l'assemblage de production : **8 services `healthy`**, Caddy
      compris, redirection `http` → `https`, API jointe en TLS, aucun outillage de développement,
      seuls `80` et `443` publiés.
- [x] Gardes prouvées par le refus **et** par l'acceptation : profil `dev` exigé par `runDev.sh`
      et `resetMe.sh`, profil `prod` par `runProd.sh`, `APPLY_MIGRATIONS=false` imposé en
      production, confirmation explicite avant destruction, aucun amorçage en production.
- [x] `README.md` §4–6, §9–11 et `docs/DAT.md` §13 décrivent le comportement réellement observé.
- [x] Harnais de preuves rejouable `scripts/verify-scripts.sh` : **38 contrôles, aucune
      anomalie**, et **non complaisant** — il échoue bien lorsqu'une variable Compose n'est pas
      documentée, lorsqu'un secret est écrit en clair dans le gabarit, lorsqu'une garde de profil
      est retirée, et lorsque la dérivation d'un jeton est faussée.
- [x] **`resetMe.sh` rejoue le seed : PROUVÉ**, par `CRM-005` qui a livré
      `supabase/seed/apply-seed.sh`. `./resetMe.sh --yes` détruit le cluster — identifiant
      PostgreSQL changé, table témoin disparue —, rejoue les migrations à blanc **puis applique le
      seed**, en **45,6 s** ; les trois comptes et leurs appartenances sont constatés sur la base
      neuve. La dernière case ouverte de cette unité est donc levée, et INC-009 peut être close par
      le responsable.

*DoD adaptée, écarts explicites.* Aucun test unitaire ni test E2E dédié : cette unité ne livre
aucune logique métier ni parcours utilisateur, seulement l'outillage d'exécution. Les preuves
correspondantes sont d'intégration et vivent dans `scripts/verify-scripts.sh`. Le harnais Vitest,
pytest et Playwright reste l'objet de `CRM-008`. **Aucune vérification visuelle** : rien de cette
unité n'atteint l'interface, dont le premier écran arrive avec `CRM-007`.

*Limites nommées, non masquées.*

- L'assemblage de production a été démarré contre un **fournisseur S3 simulé** et avec
  `APP_DOMAIN=localhost`, donc l'autorité interne de Caddy : l'émission d'un certificat **ACME**
  reste non prouvée, comme pour `CRM-001`.
- La valeur par défaut `STACK_RLIMIT_NOFILE=100000` reste **non éprouvée** : l'hôte de la routine
  plafonne à 4096, valeur que l'amorçage inscrit automatiquement et signale.

### CRM-003 — Migrations d'amorçage `[x]`
Extensions, schéma `app`, `profiles` (+ trigger de création), `workspaces`,
`workspace_members`, `track_members`, `channel_members`.
**DoD** : migrations rejouables à blanc ; `docs/SCHEMA.md` §1 conforme ; pgTAP sur le trigger de
création de profil ; `docs/PROD_MIGRATIONS.md` mis à jour.

- [x] `supabase/migrations/0001_identite_et_cloisonnement.sql` : extension `pgcrypto`, schéma
      `app` (non exposé par PostgREST), `app.set_updated_at()`, `app.handle_new_user()`, et les
      cinq tables de `docs/SCHEMA.md` §1.
- [x] **Rejouée à blanc** : `./resetMe.sh --yes` détruit le cluster, `migrations-runner`
      l'applique sur une base vierge et se termine en `0`, pile complète redémarrée en **38,1 s**.
- [x] **Rejouée sur une base déjà migrée** : réapplication sans erreur, empreinte de structure des
      cinq tables **identique** avant et après. Le `migrations-runner` de `CRM-001` ne tient aucun
      registre : l'idempotence est une exigence d'exécution, motivée par `docs/JOURNAL.md`,
      décision 20.
- [x] `docs/SCHEMA.md` §1 conforme à la structure réellement créée — vérifié colonne par colonne
      par `columns_are`, les clés primaires, les clés étrangères, les contraintes `CHECK`, les
      valeurs par défaut et les index. Les deux écarts constatés sont **documentés dans
      `docs/SCHEMA.md` et consignés**, pas corrigés en douce (INC-010, INC-011).
- [x] **pgTAP sur le trigger de création de profil** :
      `supabase/tests/0001_identite_et_cloisonnement.test.sql`, **70 assertions, aucune anomalie**.
      Les quatre branches de la chaîne de repli du nom affiché sont couvertes une par une, ainsi
      que la non-réécriture d'un profil existant, la cascade de suppression, et le maintien
      d'`updated_at` malgré une valeur forcée par le client.
- [x] **Preuve par le véritable chemin applicatif**, hors interface : compte créé par l'API
      d'administration GoTrue, profil constaté par PostgREST avec le nom et la langue des
      métadonnées ; suppression du compte par GoTrue, profil disparu.
- [x] **Refus par défaut réellement mesuré** : RLS activée sur les cinq tables, aucune politique.
      Anonyme sur les cinq tables → `HTTP 200` et corps `[]`, soit **zéro ligne et non une
      erreur** (preuve n° 3 et n° 11 de `docs/SPEC-permissions-rls.md` §7). Compte authentifié
      réel → son propre profil invisible, création de workspace refusée (`403`), modification de
      profil sans effet. Schéma `app` injoignable par l'API (`404`).
- [x] Harnais de preuves rejouable `scripts/verify-migrations.sh` : **23 contrôles, aucune
      anomalie**, et **non complaisant** — il échoue bien lorsque le trigger est retiré (9
      assertions), lorsque RLS est désactivée, lorsqu'une politique permissive est ajoutée,
      lorsque `SELECT` est retiré à `anon`, lorsque la contrainte de rôle est supprimée et
      lorsque la cascade de suppression du profil est retirée.
- [x] `scripts/verify-stack.sh` (**33/33**) et `scripts/verify-scripts.sh` (**38/38**) rejoués
      après le redémarrage à blanc : aucune régression sur les unités précédentes.
- [x] `docs/PROD_MIGRATIONS.md` §3 mis à jour : migration listée avec son objectif, ses
      dépendances et son retour arrière. `docs/SCHEMA.md`, `docs/DAT.md` §3.2, `README.md` §7 et
      §10, `CHANGELOG.md` mis à jour dans le même changement.

*DoD adaptée, écarts explicites.* **Aucun test E2E dédié ni vérification visuelle** : cette unité
ne livre aucun parcours utilisateur ni aucun écran — le premier arrive avec `CRM-007`, le harnais
Playwright avec `CRM-008`. Ses preuves sont unitaires (pgTAP) et d'intégration (API réelle, hors
interface), ce que la nature d'une migration commande. **Aucune mise à jour du seed** : il
n'existe pas encore, c'est l'objet de `CRM-005`.

*Limites nommées, non masquées.*

- **Les politiques RLS ne sont pas écrites** : ce qui est prouvé est le refus par défaut, pas la
  résolution des droits (`CRM-010`, `CRM-012`). Sur les douze preuves de refus de
  `docs/SPEC-permissions-rls.md` §7, seules la n° 3 et la n° 11 sont acquises.
- **`track_members.track_id` et `channel_members.channel_id` sont sans clé étrangère**, faute de
  tables à référencer avant `CRM-020` et `CRM-021` : `docs/INCONSISTENCY_REPORT.md`, INC-010,
  **en attente d'arbitrage**.
- **Ces deux tables ne portent pas `workspace_id`**, contre la convention générale de
  `docs/SCHEMA.md` mais conformément à son §1 : INC-011, **en attente d'arbitrage avant
  `CRM-012`**.

### CRM-004 — Décision chiffrement des secrets `[x]`
**Bloquante pour `CRM-052` et `CRM-053`.** Vérifier la présence de `supabase_vault` et de
`pg_cron` dans l'image PostgreSQL retenue. Retenir Vault ou le repli `pgcrypto`.
**DoD** : vérification exécutée et **sortie de commande consignée** dans `docs/JOURNAL.md` ;
décision inscrite dans `docs/DAT.md` §8 et `docs/SCHEMA.md` ; entrée retirée de
`docs/INCONSISTENCY_REPORT.md`.

- [x] Vérification exécutée sur l'image **réellement épinglée** par `docker-compose.yml`,
      `supabase/postgres:17.6.1.136`, et non sur une image supposée : `supabase_vault` **0.3.1**
      présente, **déjà installée** et **préchargée** ; `pg_cron` **1.6.4** disponible, préchargé,
      installable, et ordonnançant réellement une tâche. `pgcrypto` 1.3, `pg_net` 0.20.3 et
      `pgtap` 1.3.3 relevés au passage.
- [x] **Sorties de commande consignées** dans `docs/JOURNAL.md`, section `CRM-004` : version du
      serveur, `pg_available_extensions`, `shared_preload_libraries`, création et déchiffrement
      d'un secret, refus par rôle, et script de dérivation de la clé racine.
- [x] **Décision 23 — Vault retenu, repli `pgcrypto` abandonné.** Inscrite dans `docs/DAT.md` §8,
      §12 et §15, `docs/SCHEMA.md` §11, `docs/SPEC-mail-subsystem.md` §2.3.
- [x] **Chiffrement prouvé effectif, pas supposé** : le clair n'est pas dans `vault.secrets` — un
      chiffré base64 avec nonce y figure —, la vue le restitue à l'identique, et
      `vault.update_secret` remplace réellement la valeur.
- [x] **Cloisonnement mesuré hors interface, avec les rôles réels** : `anon` et `authenticated`
      refusés (`permission denied for schema vault`) sur `vault.secrets`,
      `vault.decrypted_secrets` **et** `vault.create_secret` ; `service_role` lit, déchiffre et
      crée. Protection **plus forte que prévu** : le refus porte sur le schéma entier, pas sur une
      colonne. Le `REVOKE` de `secret_id` reste exigé — il vise des tables de `public`, exposées
      par PostgREST.
- [x] **Décision 24 — la clé racine est une donnée de sauvegarde à part entière.** Découverte en
      vérifiant : `/etc/postgresql-custom/pgsodium_root.key` vit dans le volume `db-config`,
      **hors de `PGDATA`**. Mesuré et non déduit : PGDATA conservé et volume de configuration
      neuf, le chiffré est toujours en base et le déchiffrement échoue (`invalid ciphertext`) ;
      la clé d'origine restituée, le secret redevient lisible. Répercuté dans `docs/DAT.md` §10 et
      `docs/PROD_MIGRATIONS.md` §2.1, §5, §6, §7.
- [x] **INC-001 retirée des ouverts** et déplacée en section « Clos » de
      `docs/INCONSISTENCY_REPORT.md`, avec sa mesure et sa décision.
- [x] Harnais de preuves rejouable `scripts/verify-vault.sh` : **26 contrôles, aucune anomalie**.
      Autonome — il ne dépend ni de `.env` ni de la pile en cours d'exécution — et il détruit ses
      conteneur et volumes jetables en sortant, y compris sur interruption.
- [x] Harnais **non complaisant**, éprouvé de deux façons : il relâche lui-même le cloisonnement
      et exige que le contrôle échoue, puis restitue la clé d'origine et exige que le secret
      redevienne lisible ; exécuté contre une image `postgres:17-alpine` dépourvue de Vault, il
      rend **25 anomalies sur 26** et sort en `1`.
- [x] `README.md` §5, §7 et §12, `CHANGELOG.md` mis à jour dans le même changement.

*DoD adaptée, écarts explicites.* **Aucun test unitaire, aucun test E2E, aucune vérification
visuelle, aucune mise à jour du seed** : cette unité est une décision d'architecture. Elle ne
livre ni logique métier, ni migration, ni écran — le premier arrive avec `CRM-007`. Ses preuves
sont d'intégration par nature et vivent dans `scripts/verify-vault.sh`. C'est la DoD que l'unité
elle-même énonce : vérification exécutée, sortie consignée, décision inscrite, entrée retirée.

*Limites nommées, non masquées.*

- **Aucun secret de messagerie n'est encore stocké** : `mail_accounts` et
  `mail_outbound_identities` n'existent pas. Ce qui est prouvé, c'est que le mécanisme fonctionne
  dans l'image retenue — pas son usage par le produit, qui relève de `CRM-052` et `CRM-053`.
- **La restauration d'une sauvegarde n'est pas éprouvée.** La contrainte portant sur la clé
  racine est acquise et documentée ; la procédure qui la respecte reste à livrer.
- **Le motif principal de la décision 8 est démenti** : `pg_cron` est disponible. Le résultat de
  la décision est conservé, son énoncé corrigé, et la question de rouvrir l'arbitrage est
  consignée en `docs/INCONSISTENCY_REPORT.md`, **INC-012, en attente d'arbitrage**.

### CRM-010 — Fonctions d'autorisation `[~]`
`app.is_workspace_member`, `app.is_workspace_admin`, `app.can_read_track`,
`app.can_read_channel`, `app.can_write_channel`, `app.can_read_card`.
**DoD** : pgTAP couvrant chaque rôle et chaque combinaison de droits fins ; absence de récursion
démontrée ; `search_path` fixé sur toutes les fonctions `SECURITY DEFINER`.

- [x] `supabase/migrations/0002_fonctions_autorisation.sql` : `app.resolve_access`,
      `app.workspace_role`, `app.is_workspace_member`, `app.is_workspace_admin`, et leurs
      privilèges d'exécution. **Aucune politique RLS** : le refus par défaut de `CRM-003` est
      intact, ce que la suite pgTAP vérifie explicitement.
- [x] **pgTAP couvrant chaque rôle et chaque combinaison de droits fins** :
      `supabase/tests/0002_fonctions_autorisation.test.sql`, **127 assertions, aucune anomalie**.
      La matrice de `docs/SPEC-permissions-rls.md` §2.2 est énumérée **exhaustivement** — 4 rôles
      de workspace, dont l'absence de rôle, × 4 états du droit fin de track × 4 du droit fin de
      channel, soit **64 combinaisons**, chacune une assertion nommée.
- [x] **Absence de récursion démontrée en la provoquant**, et non affirmée : une politique
      auto-référente échoue en `42P17`, une jumelle `SECURITY INVOKER` épuise la pile en `54001`,
      et la même politique adossée à la fonction livrée répond sans erreur avec le filtrage
      attendu. Fait relevé au passage : PostgreSQL **ne détecte pas** la récursion lorsqu'elle
      traverse une fonction (`docs/JOURNAL.md`, décision 27).
- [x] **`search_path` fixé** sur les sept fonctions du schéma `app`, et valant exactement la chaîne
      vide sur les quatre nouvelles. `SECURITY DEFINER` seulement là où il est nécessaire :
      `resolve_access`, qui ne lit aucune table, reste `SECURITY INVOKER`.
- [x] **Résolution du rôle éprouvée contre des comptes réels** : administratrice, business
      developer, viewer, membre d'un **autre** workspace, compte sans appartenance, et appelant
      anonyme. Le refus est **calme** — faux ou NULL —, jamais une erreur. Workspace inconnu et
      workspace nul également couverts.
- [x] **Les droits ne sont pas portés par le jeton** : l'appartenance retirée, le même jeton non
      expiré cesse immédiatement d'ouvrir des droits. Mesuré en base **et** sous PostgREST.
- [x] **Preuves d'intégration hors interface, avec les jetons réels de trois profils** obtenus par
      la véritable route de connexion : chaque profil ne voit que son workspace ; l'anonyme obtient
      `200` et `[]` (preuve n° 11) ; un `viewer` ne modifie rien ; un administrateur d'un autre
      workspace non plus (preuve n° 3). Le schéma `app` n'étant pas exposé par l'API, deux
      politiques d'instrumentation sont posées **temporairement** puis retirées, et l'absence de
      toute politique résiduelle est vérifiée (`docs/JOURNAL.md`, décision 28).
- [x] **Migration rejouable** : réappliquée sur une base déjà migrée sans modifier la définition,
      la volatilité ni les droits des fonctions ; `migrations-runner` rejoue les deux migrations et
      se termine en `0` ; réinitialisation **à blanc** par `./resetMe.sh --yes` suivie d'un rejeu
      complet des preuves, toujours 26/26.
- [x] Harnais de preuves rejouable `scripts/verify-authz.sh` : **26 contrôles, aucune anomalie**,
      et **non complaisant** — il échoue bien lorsque `is_workspace_member` repasse en
      `SECURITY INVOKER`, lorsque `search_path` est relâché, lorsque `resolve_access` autorise
      tout, lorsqu'un administrateur devient restreignable par un droit fin, lorsqu'`EXECUTE` est
      retiré à `anon`, lorsqu'une politique permissive est ajoutée, et lorsqu'une des quatre
      fonctions différées est créée sans étendre les preuves.
- [x] `scripts/verify-stack.sh` (**33/33**), `scripts/verify-scripts.sh` (**38/38**) et
      `scripts/verify-migrations.sh` (**23/23**) rejoués : aucune régression sur les unités
      précédentes.
- [x] `docs/SCHEMA.md` §9, `docs/SPEC-permissions-rls.md` §3, §3.1, §3.2, `docs/DAT.md` §7,
      `docs/PROD_MIGRATIONS.md` §3, `README.md` §5 et §7, `CHANGELOG.md` mis à jour dans le même
      changement.
- [ ] **Quatre des six fonctions ne sont pas livrées : `app.can_read_track`,
      `app.can_read_channel`, `app.can_write_channel`, `app.can_read_card`.** Elles doivent
      remonter d'un track, d'un channel ou d'une card jusqu'à son workspace ; ce chemin passe par
      `tracks`, `channels` et `cards`, livrées par `CRM-020`, `CRM-021` et `CRM-040`, soit au
      chunk suivant. **Cette preuve est bloquée par une dépendance, pas par un défaut de l'unité :
      il n'y a rien à y faire tant que ces tables n'existent pas.** Contradiction
      d'ordonnancement consignée dans `docs/INCONSISTENCY_REPORT.md`, INC-013, avec trois options
      d'arbitrage, **à trancher avant `CRM-012`**.

*DoD adaptée, écarts explicites.* **Aucun test E2E dédié, aucune vérification visuelle** : cette
unité ne livre ni parcours utilisateur ni écran — le premier arrive avec `CRM-007`, le harnais
Playwright avec `CRM-008`. Ses preuves sont unitaires (pgTAP) et d'intégration (PostgREST, jetons
réels, hors interface), ce que la nature de fonctions SQL commande. **Aucune mise à jour du seed** :
il n'existe pas encore, c'est l'objet de `CRM-005` ; les comptes et workspaces du harnais sont
créés puis détruits par lui.

*Limites nommées, non masquées.*

- **Les quatre fonctions `can_*` ne sont pas livrées** (voir ci-dessus, INC-013). Ce qui manque
  n'est pas la règle métier — livrée et prouvée sur ses 64 combinaisons — mais la jointure qui
  remonte au workspace.
- **Aucune politique RLS n'est écrite** : ce qui est prouvé, ce sont les fonctions, pas leur emploi
  par le produit. Les politiques relèvent de `CRM-012`. Au passage, **aucune unité du backlog ne
  porte nommément les politiques des tables d'identité**, ni la preuve de refus n° 10 :
  `docs/INCONSISTENCY_REPORT.md`, **INC-014, en attente d'arbitrage**.
- **Sur les douze preuves de refus de `docs/SPEC-permissions-rls.md` §7**, seules la n° 3 et la
  n° 11 sont acquises, et uniquement au niveau du workspace — pas encore des cards.
- **La création des workspaces et des appartenances du harnais passe par SQL**, faute de politique
  autorisant leur création par l'API. Le fait est nommé dans le script, pas masqué.

### CRM-011 — Authentification `[~]`
GoTrue, inscription libre désactivée, invitation par un administrateur, connexion, déconnexion,
réinitialisation de mot de passe.
**DoD** : E2E de connexion et de refus ; email d'invitation **réellement envoyé** et constaté
dans Inbucket ; captures observées.

- [x] **Spécification écrite avant tout code**, `docs/SPEC-auth.md` : aucun document ne disait ce
      qu'un refus doit rendre, qui a le droit d'inviter, ni ce que le produit exige d'un mot de
      passe. Rédigée **après mesure** du comportement réel de `supabase/gotrue:v2.189.0`, la
      version épinglée, et non de mémoire. Commit documentaire dédié.
- [x] Deux contradictions consignées sans être résolues implicitement : **INC-015** (le parcours
      d'invitation depuis le produit n'a aucun composant pour le porter) et **INC-016** (gabarits
      d'emails chargeables en HTTP seulement, avec repli **silencieux** vers l'anglais).
- [x] **Inscription libre réellement refusée, et le privilège ne contourne pas le refus** :
      `422 signup_disabled` avec la clé anonyme **comme avec la clé de service**. Vérifié aussi
      qu'aucun compte n'est créé par ces tentatives.
- [x] **Invitation** : refusée à la clé anonyme (`403 not_admin`), acceptée avec la clé de service.
      Le compte naît avec `invited_at`, **sans mot de passe** et sans adresse confirmée, et le
      trigger de `CRM-003` crée son profil avec le nom des métadonnées.
- [x] **Email d'invitation réellement envoyé et constaté dans Inbucket**, puis **acceptation en
      suivant le lien de cet email** — pas un raccourci d'API : `303` vers `SITE_URL` portant la
      session, adresse confirmée ensuite.
- [x] **Politique de mot de passe prouvée dans les deux sens** : onze caractères refusés
      (`422 weak_password`, raison `length`), douze acceptés. `PASSWORD_MIN_LENGTH=12` livrée dans
      `.env.example` et câblée dans le service `auth` ; le défaut de GoTrue, 6, était mesuré comme
      réellement permissif (décision 29).
- [x] **Connexion, refus et discrétion** : connexion `200` ; mot de passe erroné `400
      invalid_credentials` ; **adresse inconnue rendant le même code et le même message**, comparés
      chaîne à chaîne ; requête sans clé `apikey` refusée en `401` par la passerelle.
- [x] **Contenu du jeton vérifié claim par claim** : `sub` égal à l'identifiant réel, `role` et
      `aud` à `authenticated`, `exp − iat` exactement `JWT_EXPIRY`. Le jeton est **accepté par
      PostgREST**, où le refus par défaut se manifeste bien par `200` et zéro ligne.
- [x] **Session** : le rafraîchissement fait tourner le jeton ; la déconnexion rend `204` et le
      jeton de rafraîchissement est ensuite refusé (`refresh_token_not_found`).
- [x] **Réinitialisation menée à son terme** : `recover` sur une adresse inconnue rend `200` **sans
      émettre d'email** — boîte vérifiée vide —, `recover` sur un compte existant produit un email
      réellement reçu, dont le lien ouvre une session ; nouveau mot de passe accepté, **ancien
      refusé**.
- [x] **Suppression du compte** par l'API d'administration : aucun profil orphelin (cascade).
- [x] **Vérification visuelle réellement observée** : `docs/captures/CRM-011/` — moniteur Inbucket
      montrant le trafic SMTP réel, email d'invitation et email de réinitialisation ouverts et lus.
      C'est la seule vérification visuelle que cette unité rend possible, et c'est celle que sa
      Definition of Done nomme.
- [x] Harnais de preuves rejouable `scripts/verify-auth.sh` : **42 contrôles, aucune anomalie**.
      Son premier contrôle compare la configuration **réellement appliquée au conteneur** aux
      valeurs du `.env` : sans lui, tous les suivants mesureraient les défauts de l'image en
      croyant mesurer le produit.
- [x] Harnais **non complaisant, éprouvé dans les deux sens** : il démarre un GoTrue **jetable**, à
      la même version épinglée, portant le réglage affaibli, et exige qu'il accepte ce que la pile
      refuse ; et il a été **réellement mis en échec** contre la pile affaiblie —
      `DISABLE_SIGNUP=false` produit **6 anomalies**, `PASSWORD_MIN_LENGTH=6` en produit **2**,
      code de sortie `1` dans les deux cas. Configuration restaurée, retour à 42/42.
- [x] `scripts/verify-stack.sh` (**33/33**), `scripts/verify-scripts.sh` (**38/38**),
      `scripts/verify-migrations.sh` (**23/23**), `scripts/verify-vault.sh` (**26/26**) et
      `scripts/verify-authz.sh` (**26/26**) rejoués : aucune régression.
- [x] `docs/DAT.md` §4.1 et §7, `README.md` §7, §9, §10 et §11, `docs/PROD_MIGRATIONS.md` §2 et §4,
      `docs/manual.md`, `CHANGELOG.md` mis à jour dans le même changement.
- [ ] **E2E de connexion : toujours impossible, et la cause a changé.** `CRM-007` a livré la
      webapp, ses captures et un harnais Playwright fonctionnel : ce qui manque n'est plus
      l'outillage, c'est **l'écran de connexion lui-même**, qu'aucune unité du backlog ne porte —
      **INC-021, en attente d'arbitrage**. Ce qui est livré reste le mécanisme, prouvé **hors
      interface** sur les vingt scénarios de `docs/SPEC-auth.md` §7 — ce que `CLAUDE.md` §10 exige
      de toute façon, l'interface n'ayant jamais valeur de preuve.
      **Cette preuve est bloquée par un arbitrage, pas par un défaut de l'unité.**
- [ ] **L'invitation n'est pas un parcours produit.** Elle exige la clé de service : c'est une
      opération d'**exploitation**. Le composant qui permettrait à un administrateur de workspace
      d'inviter depuis le produit n'existe pas et n'est rattaché à aucune unité — **INC-015, en
      attente d'arbitrage** (décision 30).
- [ ] **Aucun rattachement d'un compte invité à un workspace.** L'invitation crée un compte et son
      profil ; elle ne crée aucune ligne `workspace_members`. Relève du même arbitrage.

*DoD adaptée, écarts explicites.* **Aucun test unitaire dédié** : cette unité ne livre aucune
logique applicative propre — elle configure un service tiers et prouve son comportement. Ses
preuves sont d'intégration par nature et vivent dans `scripts/verify-auth.sh`. **Aucune mise à
jour du seed** : il n'existe pas encore, c'est l'objet de `CRM-005` ; les comptes du harnais sont
créés puis détruits par lui, et la base est vérifiée vide en sortant.

*Limites nommées, non masquées.*

- **E2E d'interface et captures d'application impossibles** avant `CRM-007` et `CRM-008`
  (voir ci-dessus).
- **L'invitation reste une opération d'exploitation** (INC-015).
- **Les emails transactionnels partent en anglais**, et le repli vers le gabarit par défaut est
  **silencieux** du point de vue du destinataire : un email reçu ne prouve pas que le gabarit
  configuré a été employé (INC-016). Constat associé : ces emails sont en **HTML seul**, sans
  partie `text/plain`.
- **L'expiration des liens d'invitation et de réinitialisation n'est pas mesurée.** Le défaut est
  de 24 heures ; le vérifier exigerait de manipuler le temps de l'instance.
- **La fenêtre de grâce de 10 secondes** sur la rotation des jetons de rafraîchissement est
  documentée d'après le défaut de GoTrue ; sa borne exacte n'a pas été mesurée.

### CRM-012 — Droits fins par track et channel `[ ]`
Résolution « le plus spécifique gagne », administrateur jamais restreint.
**DoD** : pgTAP sur la matrice de résolution ; preuves de refus n° 3, 4, 7 et 11 de
`docs/SPEC-permissions-rls.md` §7.

### CRM-013 — Colonnes protégées `[ ]`
`REVOKE` sur `secret_id`, `token_hash` ; `current_step_id` et `email_local_part` non modifiables
directement ; `card_events` et `audit_log` en écriture par trigger uniquement.
**DoD** : preuves de refus n° 5, 6 et 8 ; test explicite qu'une lecture refusée retourne **zéro
ligne** et non une erreur ambiguë.

### CRM-014 — Harnais de preuves d'autorisation `[ ]`
Projet Playwright `api` exécutant les douze scénarios de refus avec les jetons réels de chaque
profil.
**DoD** : les 12 scénarios verts ; le harnais échoue si une politique est retirée (vérifié en
retirant temporairement une politique).

### CRM-005 — Seed socle `[x]`
Utilisateurs créés par l'API d'administration GoTrue ; un workspace ; les rôles représentés.
**DoD** : seed reproductible, identifiants stables, aucun mot de passe réel ; profils `admin`,
`business_developer` et `viewer` présents ; documenté dans `README.md`.

- [x] **Spécification écrite avant tout code**, `docs/SPEC-seed.md` : aucun document ne disait
      quels comptes, quel workspace ni quels identifiants, alors que `docs/DAT.md` §11 pose que le
      seed est un *contrat maintenu*. Rédigée **après mesure** du comportement réel de
      `supabase/gotrue:v2.189.0` et `postgrest/postgrest:v14.12`. Commit documentaire dédié.
- [x] `supabase/seed/apply-seed.sh` : un workspace, trois comptes, les **trois rôles** de
      `docs/SPEC-permissions-rls.md` §2.1 représentés.
- [x] **Créés par les vrais mécanismes** (décision 32) : comptes par l'API d'administration
      GoTrue, profils par le trigger de `CRM-003` — le seed n'en crée aucun —, workspace et
      appartenances par l'API REST. **Aucun `psql`, aucun `INSERT` direct.**
- [x] **Identifiants stables**, fixés dans le script et non tirés au hasard (décision 33). Rendu
      possible par une mesure : l'API d'administration **accepte un `id` fourni**. Tous portent le
      préfixe `5eed`, ce qui rend une ligne seedée reconnaissable sans requête.
- [x] **Aucun mot de passe réel** : un mot de passe de développement unique, publié dans
      `docs/SPEC-seed.md` §2.3 et `README.md`, sur des adresses en `p2enjoy.test` — TLD réservé par
      la RFC 2606, donc non routable. Sa longueur (16) est **prouvée** conforme à
      `PASSWORD_MIN_LENGTH`, et non supposée : l'API d'administration ne l'impose pas (INC-018).
- [x] **Reproductible et convergent** (décision 34) : rejoué sans erreur ni doublon, état
      **identique** après second passage. Une dérive réellement provoquée — profil renommé, viewer
      promu `admin` — est rattrapée. La convergence du profil passe par un `PATCH` explicite, une
      mise à jour de métadonnées ne déclenchant pas le trigger de `CRM-003`.
- [x] **Les trois comptes se connectent réellement**, et le `sub` de leur jeton vaut l'identifiant
      fixe attendu. Un compte présent mais incapable de se connecter ne servirait ni aux tests ni
      aux captures.
- [x] **Test unitaire dédié** : `supabase/tests/0003_seed_socle.test.sql`, **30 assertions**,
      vérifiant le contrat **au niveau SQL** — un cran sous l'API, de sorte qu'un écart entre les
      deux vues devienne détectable. En lecture seule, transaction annulée.
- [x] **Test d'intégration dédié** : `scripts/verify-seed.sh`, **49 contrôles, aucune anomalie**,
      couvrant les douze preuves de `docs/SPEC-seed.md` §7, toutes hors interface.
- [x] Harnais **non complaisant, éprouvé en faussant réellement le seed** : rôle faussé → 4
      anomalies ; identifiant faussé sur un compte absent → 7 anomalies ; identifiant faussé sur un
      compte présent → le seed refuse lui-même. Code de sortie `1` dans les trois cas, retour à
      49/49 après remise en état.
- [x] **Le seed n'ouvre rien** : preuves n° 10 et n° 11 — l'anonyme **et** l'administrateur seedé
      obtiennent `200` et zéro ligne sur les tables du socle. Aucune politique RLS n'est posée ; le
      refus par défaut de `CRM-003` est intact, ce que la suite pgTAP vérifie aussi.
- [x] **Garde de profil prouvée** : le seed refuse un fichier d'environnement en profil `prod`, et
      il est vérifié qu'**aucune écriture** n'a eu lieu pendant ce refus.
- [x] **Vérification visuelle réellement observée** : `docs/captures/CRM-005/` — comptes, profils,
      workspace et appartenances dans Studio, les identifiants `5eed…` et les trois rôles lisibles.
      Comme pour `CRM-011`, il s'agit d'un outil d'exploitation et non du produit.
- [x] **Régression de `CRM-003` détectée et corrigée dans le même changement** (décision 35) : sa
      suite pgTAP supposait une base vide — décompte global des profils, et slug `p2enjoy` réservé.
      Corrigée pour ne porter que sur ses propres fixtures ; repassée à **70/70**.
- [x] **Aucune régression** : les sept harnais rejoués après réinitialisation à froid —
      `verify-stack` 33/33, `verify-scripts` 38/38, `verify-migrations` 23/23, `verify-vault` 26/26,
      `verify-authz` 26/26, `verify-auth` 42/42, `verify-seed` 49/49, soit **237 contrôles**.
- [x] `README.md` §5, §6, §7 et §10, `docs/DAT.md` §11 et §13, `docs/MASTER_PLAN.md` §3,
      `CHANGELOG.md` mis à jour dans le même changement.

*DoD adaptée, écarts explicites.* **Aucun test E2E dédié** : le harnais Playwright est l'objet de
`CRM-008` et le premier écran du produit celui de `CRM-007`. Les preuves de cette unité sont
unitaires (pgTAP) et d'intégration (API réelle, hors interface), ce que la nature d'un seed
commande. **Aucune migration** : le seed est une donnée, pas une structure — `docs/PROD_MIGRATIONS.md`
n'a pas à changer, la production n'appliquant jamais de seed.

*Limites nommées, non masquées.*

- **Aucun second workspace ni compte extérieur** (`docs/SPEC-seed.md` §8). Les preuves n° 3 et n° 7
  de `docs/SPEC-permissions-rls.md` §7 en exigeront : `CRM-014` devra soit étendre le seed, soit
  continuer de créer ses propres comptes comme le fait `scripts/verify-authz.sh`.
- **Aucun droit fin, aucune donnée métier** : les tables cibles n'existent pas encore. Le jeu de
  démonstration complet est l'objet de `CRM-046`.
- **`npm run db:seed` n'existe pas** : il attend le `package.json` de `CRM-007` (INC-008). Le seed
  s'invoque par `supabase/seed/apply-seed.sh` ou par `resetMe.sh`.
- **Les comptes ne naissent pas d'un parcours produit** : la création exige la clé de service, donc
  reste une opération d'exploitation (INC-015), comme pour `CRM-011`.

### CRM-006 — Types TypeScript générés `[x]`
**DoD** : `npm run types:generate` régénère depuis le schéma local ; build de la webapp vert.

- [x] **Spécification écrite avant tout code**, `docs/SPEC-types.md` : la DoD ne disait ni d'où
      viennent les types, ni où ils vont, ni ce qui prouve qu'ils décrivent encore le schéma trois
      migrations plus tard. Rédigée **après mesure** de `supabase/postgres-meta:v0.96.6`, la
      version épinglée, et non de mémoire. Commit documentaire dédié.
- [x] `scripts/generate-types.sh` : génération depuis la **base réellement migrée**, par le service
      `meta` de l'overlay de développement — aucune dépendance nouvelle, ni CLI à télécharger
      (décision 37). Trois modes : écriture, `--check`, `--stdout`.
- [x] `webapp/src/lib/database.types.ts` **versionné**, 311 lignes, en-tête de traçabilité réémis à
      chaque génération. Versionné plutôt que produit au build, pour que la dérive se lise dans le
      diff au lieu de rester invisible (décision 36).
- [x] `package.json` et `tsconfig.json` livrés : `types:generate`, `types:check`, `typecheck`, en
      mode `strict`. **Aucun alias `npm` des scripts existants** n'est ajouté : la façade `npm`
      reste un arbitrage ouvert (décision 38, INC-008 mise à jour).
- [x] **Garde anti-dérive prouvée non complaisante de deux façons**, en agissant sur le monde réel
      et non en l'affirmant : une colonne renommée à la main fait échouer `types:check` ; et une
      table **réellement créée en base** apparaît dans la sortie, fait échouer la garde, puis, une
      fois retirée, la sortie **redevient identique** au fichier versionné. C'est cette seconde
      preuve qui établit que le générateur lit la base vivante, et non un cache.
- [x] **Déterminisme mesuré** : deux générations successives rendent des octets identiques. Une
      régénération sur un dépôt à jour ne réécrit pas le fichier, et le dit.
- [x] **Test unitaire dédié** : `webapp/src/lib/database.types.test-d.ts`, **19 assertions de
      type** vérifiées à la compilation — tables du socle, nullabilité, colonnes exigées à
      l'insertion, relations réellement déclarées. **Non complaisant, éprouvé** : une assertion
      volontairement fausse fait bien échouer `tsc` (code `2`), puis restaurée, le vert revient.
- [x] **Les limites sont figées par des assertions**, non seulement documentées : `role` et
      `access` se typent `string`, et une assertion **exige** qu'ils ne soient pas l'union des
      valeurs autorisées. Le jour où le schéma passerait à un type énuméré, elle échouerait et
      forcerait à réviser la limite plutôt qu'à la laisser survivre à sa cause.
- [x] **Gardes du script prouvées par le refus** : profil `prod` refusé ; option inconnue refusée ;
      **générateur arrêté → échec explicite et aucun fichier écrit**, vérifié par empreinte.
- [x] Harnais de preuves rejouable `scripts/verify-types.sh` : **30 contrôles, aucune anomalie**.
      Il restaure tout ce qu'il altère — table de preuve, fichiers, conteneur — et le **constate**
      en sortant plutôt que de le supposer.
- [x] `scripts/verify-stack.sh` (**33/33**), `scripts/verify-scripts.sh` (**38/38**),
      `scripts/verify-migrations.sh` (**23/23**), `scripts/verify-vault.sh` (**26/26**),
      `scripts/verify-authz.sh` (**26/26**), `scripts/verify-auth.sh` (**42/42**) et
      `scripts/verify-seed.sh` (**49/49**) rejoués : aucune régression.
- [x] `README.md` §4, §5 et §10, `docs/DAT.md` §3.1 et §13, `docs/MASTER_PLAN.md` §3,
      `CHANGELOG.md` mis à jour dans le même changement.
- [x] **Build de la webapp : ACQUIS par `CRM-007`**, comme INC-020 l'avait prévu. `npm run build`
      est vert, `webapp/dist` est produit, et le client comme la couche d'accès **importent
      réellement** `database.types.ts`. La preuve ne s'arrête pas à la compilation : les types
      étant effacés à la compilation, ce qui établit qu'ils contraignent le code est le contrôle
      **non complaisant** de `scripts/verify-webapp.sh` — une colonne inexistante glissée dans la
      requête fait échouer `npm run typecheck`. INC-020 est close.
- [x] **Le prérequis Node 24 est exercé** depuis `CRM-007` : le conteneur `webapp` tourne sur
      `node:24-alpine`, où le build, les **96 tests unitaires** et la compilation des quatre
      projets ont été rejoués verts. La limite « toutes les preuves obtenues sur Node 22 » ne vaut
      donc plus que pour l'hôte de vérification.

*DoD adaptée, écarts explicites.* **Aucun test E2E dédié, aucune vérification visuelle** : l'unité
ne livre ni écran ni parcours — le premier arrive avec `CRM-007`, le harnais Playwright avec
`CRM-008`. **Aucune mise à jour du seed** : les types ne dépendent d'aucune donnée, et le seed n'a
aucun effet sur le schéma. **Aucune opération de déploiement** : ni migration, ni service, ni
variable d'environnement — `docs/PROD_MIGRATIONS.md` est inchangé à dessein.

*Limites nommées, non masquées.*

- **Les contraintes `CHECK` ne survivent pas à la génération** : `workspace_members.role` se type
  `string`, pas `'admin' | 'business_developer' | 'viewer'`. Le compilateur ne protégera donc pas
  `CRM-007` d'une chaîne de rôle erronée — seule la base la refuse. Fabriquer l'union à la main
  créerait une seconde source de vérité, donc une dérive de plus à surveiller.
- **Les types n'expriment aucun droit** : une table en refus par défaut se type comme une table
  ouverte. L'interface ne peut jamais déduire une autorisation d'un type.
- **Les relations de `track_members` et `channel_members` sont incomplètes**, faute de `tracks` et
  `channels` (INC-010) ; deux assertions le figent et échoueront à `CRM-020` et `CRM-021`.
- **La génération exige la pile de développement démarrée** : le service `meta` ne publie aucun
  port, l'appel passe par `docker exec`. Aucun chemin hors ligne n'est fourni.
- **Node 24 n'est exercé que dans le conteneur** livré par `CRM-007` ; sur l'hôte de vérification,
  la chaîne s'exécute sous Node 22.22.2 et npm 10.9.7.
- **TypeScript est épinglé à `5.9.3`** alors que `7.0.2` est la version courante du registre. Motif
  assumé : c'est la dernière du cycle que l'outillage Vite/React consomme aujourd'hui sans réserve,
  et la compatibilité réelle ne devient mesurable qu'à `CRM-007`, où la chaîne complète est
  assemblée. À réexaminer à ce moment-là (décision 39).

### CRM-007 — Squelette de la webapp `[x]`
React + Vite + Tailwind, jetons du design system en variables CSS, mise en page barre latérale et
onglets, états de chargement, d'erreur et vide.
**DoD** : `docs/DESIGN_SYSTEM.md` §11 respecté (aucun hexadécimal hors jetons) ; captures aux
quatre paliers responsive observées ; navigation clavier vérifiée. **Reprend la preuve de build due
par `CRM-006`** (INC-020).

- [x] **Spécification écrite avant tout code**, `docs/SPEC-webapp.md` : l'énoncé ne disait ni où
      vit la webapp, ni comment les jetons deviennent des variables CSS, ni ce que chaque état
      signifie. Rédigée **après installation et exercice réel** de la chaîne — `vite@8.2.0`,
      `tailwindcss@4.3.3`, `vitest@4.1.10`, `@playwright/test@1.62.1` — et non de mémoire. Commit
      documentaire dédié.
- [x] **Chaîne livrée et build vert** : `webapp/index.html`, `vite.config.ts`, quatre projets
      TypeScript, `npm run build` → `webapp/dist`. **Preuve de `CRM-006` reprise** : le client et
      la couche d'accès importent les types générés, et une **colonne inexistante fait échouer**
      `npm run typecheck` — c'est le schéma qui contraint le code, pas une déclaration d'intention.
- [x] **Jetons du design system en variables CSS**, un seul fichier autorisé à porter des
      hexadécimaux (`webapp/src/styles/tokens.css`). Les espaces de noms de Tailwind sont
      **remis à zéro** : `bg-red-500` et `p-7` n'existent pas. Chaque couleur de la charte n'a
      **qu'une déclaration** dans le CSS produit, et aucune ne figure dans le corps d'une règle de
      classe.
- [x] **Garde née d'un défaut réel** : une classe dont le jeton manque n'est pas engendrée, en
      silence — `min-w-0` avait ainsi disparu, et la page défilait horizontalement sous 768 px.
      `scripts/lib/classes-css.mjs` vérifie désormais que **chaque classe citée existe dans le CSS
      produit**, et échoue sur un `px-7`.
- [x] **Coquille conforme à `docs/DESIGN_SYSTEM.md` §4** : `aside`, `nav`, `header`, `main`, barre
      d'onglets, quatre routes de premier niveau, aucune page blanche.
- [x] **Quatre états explicites, provoqués sur le réseau et non simulés** : chargement (réponse
      retardée), vide (`200` et `[]` réels), erreur de transport (requête réellement abandonnée),
      refus (`403` réel), plus l'état de configuration incomplète. La reprise **relance la
      requête**, ce qu'un scénario vérifie en rendant la seconde réponse différente.
- [x] **Preuve d'intégration hors interface, décisive** : la requête de la coquille rejouée
      directement rend `200` et `[]` **avec la clé anonyme comme avec le jeton réel d'un compte
      seedé** obtenu par la véritable route de connexion, alors que la base contient bien une
      ligne. L'écran vide n'est donc pas un défaut d'interface : c'est le refus par défaut de
      `CRM-003`, faute de politiques RLS (`CRM-012`).
- [x] **Captures aux quatre paliers, produites et observées** : `docs/captures/CRM-007/` —
      1440, 1152, 900 et 390 px, plus le tiroir ouvert, la barre repliée, les états de chargement,
      d'erreur et de refus, le lien d'évitement focalisé, et l'application servie par le conteneur.
- [x] **Deux défauts trouvés par l'observation des captures, corrigés, et figés par un test** :
      à 390 px le titre de la route disparaissait au profit du contexte ; repliée, la barre
      latérale rognait sa propre bascule, rendant le repli **irréversible**. Les deux sont
      désormais gardés par un scénario E2E (`docs/DESIGN_SYSTEM.md` §12.2).
- [x] **Navigation clavier vérifiée** dans l'application exécutée : lien d'évitement en premier
      élément focusable et menant réellement au contenu, ordre de tabulation conforme à l'ordre
      visuel, activation à `Entrée`, anneau de focus **mesuré** à 2 px, tiroir refermé par `Échap`.
- [x] **Aucune écriture sur l'appareil** (`CLAUDE.md` §11) : `localStorage` vérifié **vide** après
      un parcours complet ; le repli de la barre vit en `sessionStorage` ; le client est créé sans
      persistance de session, faute de consentement recueilli (décision 44).
- [x] **Aucun texte visible en dur** : dictionnaire typé de 50 clés, `t` refusant une clé inconnue
      **à la compilation**. Deux contrôles indépendants — nœuds de texte et attributs visibles —
      et un test qui échoue sur une **clé morte**.
- [x] **Test unitaire dédié** : `npm run test:unit`, **96 tests, 5 fichiers**, montant réellement
      les composants et les interrogeant par leur rôle accessible.
- [x] **Test E2E dédié** : `npm run e2e:ui`, **13 scénarios** contre le **build de production**
      servi par `vite preview`, pas contre le serveur de développement.
- [x] **Service `webapp` conteneurisé** livré : `runDev.sh` cesse de l'annoncer comme dû.
      `node:24-alpine` — **le prérequis Node 24 du dépôt y est exercé pour la première fois** :
      build, 96 tests et compilation rejoués verts dans le conteneur.
- [x] Harnais de preuves rejouable `scripts/verify-webapp.sh` : **41 contrôles, aucune anomalie**,
      et **non complaisant, éprouvé en dégradant réellement le produit puis en le rebuildant** —
      couleur hexadécimale dans un composant, texte visible en dur, espacement hors échelle,
      colonne inexistante dans une requête. Il restaure tout ce qu'il altère et le **constate**.
- [x] Les huit harnais précédents rejoués : **33, 38, 23, 26, 26, 42, 49 et 30 contrôles**, aucune
      régression — y compris le contrat `.env.example`, que la nouvelle variable et le nouveau
      service auraient pu rompre.
- [x] `docs/SPEC-webapp.md`, `docs/DESIGN_SYSTEM.md` §1, §11, §12, `docs/DAT.md` §3.1 et §3.7,
      `README.md` §2, §4, §5, §7, §8, §10, §11, `docs/manual.md` chapitre 3, `.env.example`,
      `docs/PROD_MIGRATIONS.md` §4, `CHANGELOG.md` mis à jour dans le même changement.

*DoD adaptée, écarts explicites.* **Aucune mise à jour du seed** : le squelette ne lit que
`workspaces`, que le seed socle alimente déjà, et il n'introduit ni table, ni statut, ni flux.
**Aucune migration**, **aucun service de production nouveau** : le build est un répertoire monté
dans Caddy, pas une image.

*Limites nommées, non masquées.*

- **Aucun écran de connexion**, et aucune unité ne le porte : **INC-021, en attente d'arbitrage**.
  L'interface ne peut donc afficher que ce que la clé anonyme obtient — et, mesuré, un compte
  connecté n'obtiendrait pas davantage tant que `CRM-012` n'a pas livré les politiques.
- **La barre d'onglets n'implémente pas le patron ARIA `tablist`** : sans channel, il n'y a rien à
  parcourir, et l'écrire produirait du code qu'aucun test ne pourrait exercer
  (`docs/DESIGN_SYSTEM.md` §12.1). Dû par `CRM-021`.
- **Le rechargement à chaud n'est pas éprouvé** par une preuve automatique ; seul le rendu du
  conteneur a été constaté.
- **Aucun test de contraste automatisé** : les contrastes AA sont vérifiés par lecture des jetons
  et observation des captures.
- **Un seul navigateur** : Chromium. Firefox et WebKit ne sont pas exercés.
- **Node 24 n'est exercé que dans le conteneur** ; les preuves E2E s'exécutent sur l'hôte, en
  Node 22.22.2.
- **Recherche, `Cmd+K` et menu de profil**, annoncés par `docs/DESIGN_SYSTEM.md` §4, ne sont pas
  livrés : la recherche n'a rien à interroger et le profil suppose une session. Les afficher
  inertes serait une commande morte.

### CRM-008 — Harnais de tests `[~]`
pgTAP, Vitest, pytest, Playwright (`api`, `ui`, `mail`).
**DoD** : chaque commande du `README.md` §7 s'exécute ; un test volontairement faux échoue bien.

- [x] **Spécification écrite avant tout code**, `docs/SPEC-test-harness.md` : l'énoncé nommait
      quatre outils sans dire ce que chacun doit rendre, ni comment un harnais peut mentir.
      Rédigée **après mesure** du comportement réel des outils épinglés, non de mémoire. Commit
      documentaire dédié.
- [x] **Mesure fondatrice, qui a décidé de la conception** : `psql` rend **`0`** sur une suite
      pgTAP dont les assertions échouent, **`0`** sur un plan non tenu, et pgTAP n'émet **aucun**
      diagnostic de plan lorsque `finish()` manque. Le code de sortie ne peut donc pas servir de
      verdict, ni le diagnostic de pgTAP le remplacer (`docs/JOURNAL.md`, décision 48).
- [x] `scripts/run-sql-tests.sh` et `npm run test:sql` : les **trois** suites de `supabase/tests/`,
      **227 assertions**, avec quatre conditions d'échec indépendantes — code de sortie de `psql`,
      absence de plan, présence d'un `not ok`, et **écart entre le plan annoncé et le nombre
      d'assertions réellement émises**, que l'exécuteur calcule lui-même.
- [x] **Projet Playwright `api` livré**, `npm run e2e:api` : **13 scénarios verts**, entièrement
      **hors interface**, aucun navigateur lancé. Ils couvrent le refus de la passerelle (`401`),
      la non-exposition du schéma `app` (`404 PGRST202`), la **preuve de refus n° 11** de
      `docs/SPEC-permissions-rls.md` §7, l'absence de privilège des trois profils seedés, et le
      refus d'écriture (`403`, code `42501`) **doublé** de la vérification que la ligne n'a été
      créée nulle part.
- [x] **Les jetons sont obtenus par la véritable route de connexion**, jamais fabriqués :
      `e2e/api/jetons.ts` est le livrable durable de l'unité, celui sur lequel `CRM-014`
      s'appuiera pour ses douze scénarios.
- [x] **« Zéro ligne » n'est affirmé que là où il prouve quelque chose** : le scénario A3 constate
      d'abord, avec la clé de service, que `profiles`, `workspaces` et `workspace_members`
      **contiennent réellement des lignes**. `track_members` et `channel_members`, vides, sont
      exclues — sur une table vide, `[]` serait vrai que la RLS refuse ou qu'elle autorise tout
      (décision 50).
- [x] **Le projet `api` ne construit ni ne sert la webapp**, mesuré et non déduit : `webapp/dist`
      est supprimé avant l'exécution et **n'est pas recréé**. Playwright démarrant son `webServer`
      pour toute exécution quel que soit le filtre `--project` — et ce filtre n'étant pas visible
      des workers —, le besoin est **déclaré** par `E2E_PROJETS` (décision 49).
- [x] `npm run e2e:report` livré, et **réellement servi** : le processus est lancé, interrogé en
      HTTP, et le code `200` constaté avant qu'il soit arrêté. Rapporteur `html` ajouté avec
      `open: 'never'`, sortie dans `e2e/report/`, ignorée par git.
- [x] **Aucune régression sur `CRM-007`** : `npm run e2e:ui` reste vert sur ses **13 scénarios**
      malgré le renommage du projet et la déclaration conditionnelle du serveur ;
      `npm run test:unit` reste à **96 tests** ; `npm run typecheck` reste vert sur les quatre
      projets, les nouveaux fichiers `e2e/` étant couverts par `tsconfig.tools.json`.
- [x] Harnais de preuves rejouable `scripts/verify-harness.sh` : **22 contrôles, aucune anomalie**,
      et **non complaisant, éprouvé par six dégradations réelles** — une assertion fausse dans une
      suite pgTAP réelle, un plan non tenu **sans** `finish()`, une erreur SQL, une **politique RLS
      permissive réellement posée** sur `workspaces`, et un test unitaire volontairement faux.
      Chacune doit faire échouer la commande correspondante.
- [x] **Le contrôle de la politique RLS est le contrôle décisif du projet `api`** : il est d'abord
      vérifié que la politique posée est **effective** — l'anonyme voit alors 1 ligne —, puis
      qu'`npm run e2e:api` échoue. Sans lui, les scénarios pourraient se contenter de constater
      une base vide au lieu de mesurer un refus.
- [x] **Restauration constatée, pas supposée** : suite pgTAP identique à sa version versionnée,
      test faux supprimé, **aucune politique résiduelle** sur `public.workspaces`, et les deux
      commandes redevenues vertes.
- [x] **Vérification visuelle réellement observée** : `docs/captures/CRM-008/` — le rapport HTML
      servi par `npm run e2e:report`, sur une exécution verte puis sur une exécution **rouge**,
      celle que provoque la politique permissive. Comme pour `CRM-001`, `CRM-005` et `CRM-011`, il
      s'agit d'un outil d'exploitation et non du produit : le harnais n'a pas d'interface propre.
- [x] Les neuf harnais précédents rejoués : **33, 38, 23, 26, 26, 42, 49, 30 et 41 contrôles**,
      aucune régression.
- [x] `docs/SPEC-test-harness.md`, `README.md` §7 et §13, `docs/DAT.md` §13,
      `docs/SPEC-webapp.md` §13, `docs/MASTER_PLAN.md` §3, `.gitignore`, `package.json`,
      `CHANGELOG.md` mis à jour dans le même changement.
- [ ] **`pytest mail-sync/tests` n'est pas livré** : aucun code Python n'existe dans le dépôt, le
      service `mail-sync` étant l'objet de `CRM-051`. Un harnais pytest sans sujet rendrait `5`
      (« no tests ran ») ou, pire, `0` sur un périmètre vide.
- [ ] **`npm run e2e:mail` n'est pas livré** : ni Stalwart, ni boîte, ni ingestion — `CRM-050` et
      `CRM-054`. Rien à faire circuler.
- [ ] **Ces deux manques ne sont pas des défauts de l'unité, mais une contradiction
      d'ordonnancement** : la Definition of Done exige des commandes dont les sujets arrivent
      **deux chunks plus loin**. Consignée en `docs/INCONSISTENCY_REPORT.md`, **INC-023**, avec
      trois options d'arbitrage — dont la constatation que `CRM-051` et `CRM-054` portent **déjà**
      ces deux commandes dans leur propre DoD, ce qui les compte deux fois. **À trancher par le
      responsable.**

*DoD adaptée, écarts explicites.* **Aucune migration, aucune mise à jour du seed** : un harnais de
tests n'introduit ni table, ni statut, ni flux ; il consomme le seed socle de `CRM-005` sans le
modifier. `docs/PROD_MIGRATIONS.md` est inchangé à dessein — ni schéma, ni service déployé, ni
variable d'environnement du produit ne changent (`E2E_PROJETS` est un contrat interne entre
`package.json` et la configuration Playwright, et n'a pas sa place dans `.env.example`).

*Limites nommées, non masquées.*

- **Deux des sept commandes de `README.md` §7 ne sont pas livrées** (voir ci-dessus, INC-023).
  L'unité reste `[~]` pour cette seule raison.
- **Sur les douze preuves de refus de `docs/SPEC-permissions-rls.md` §7, seule la n° 11 est
  acquise.** Les onze autres exigent des cards, des channels, des comptes mail et un second
  workspace : elles restent dues par `CRM-014`, qui héritera des fixtures livrées ici.
- **Les scénarios A5 et A6 décrivent un produit sans politiques RLS et échoueront à `CRM-012`.**
  C'est voulu et annoncé à l'endroit même de l'assertion (décision 51) : une limite figée par une
  assertion force sa révision, alors qu'une limite commentée survit à sa cause.
- **La lecture du TAP est dupliquée** : l'exécuteur la porte, et `verify-migrations.sh`,
  `verify-authz.sh` et `verify-seed.sh` gardent la leur. Les unifier reviendrait à modifier les
  preuves de trois autres unités dans ce commit (`CLAUDE.md` §13).
- **`E2E_PROJETS` doit rester cohérente avec `--project`**, et rien ne peut le vérifier depuis la
  configuration. Une incohérence n'est pas silencieuse pour autant : elle démarre un serveur
  inutile, ou l'omet — auquel cas les scénarios `ui` échouent bruyamment.
- **Un seul navigateur** pour le projet `ui` : Chromium, comme depuis `CRM-007`.
- **Le projet `api` ne couvre ni Realtime ni Storage** : ces contrats entreront dans le harnais
  avec les unités qui les emploient.
- **Sur l'hôte de vérification, la chaîne s'exécute sous Node 22.22.2**, alors que le dépôt exige
  Node 24 — exercé dans le conteneur `webapp` depuis `CRM-007`. Limite héritée, inchangée.

---

## Chunk 3 — CRM utilisable

### CRM-020 — Tracks `[~]`
CRUD, ordre, archivage, barre latérale.
**DoD** : unitaire, API (écriture refusée aux non-administrateurs), E2E, captures.

- [x] **Spécification écrite avant tout code**, `docs/SPEC-tracks.md` : aucun document ne disait
      comment un track s'ordonne, ce qu'archiver veut dire pour lui, ni ce que l'API doit rendre à
      chacun des trois rôles. Rédigée **après mesure** — une table sonde jetable, portant la
      structure et les politiques envisagées, créée sur la pile réelle, interrogée avec les jetons
      des trois comptes seedés, puis détruite et l'absence de reste constatée. Les douze lignes du
      §6 sont ces mesures. Commit documentaire dédié.
- [x] `supabase/migrations/0003_tracks.sql` : table, contraintes, index partiel de la barre
      latérale, trigger de `position`, trigger d'`updated_at`, **trois politiques RLS** et
      privilèges explicites. **Aucun `DELETE` accordé à personne** : l'archivage tient lieu de
      suppression (`docs/SCHEMA.md`, conventions générales).
- [x] **INC-010 refermée de moitié** : la clé étrangère `track_members.track_id → tracks.id` est
      posée, en `ON DELETE CASCADE`. Le risque d'exploitation associé — une ligne orpheline
      empêcherait le démarrage de la pile — est **nommé dans la migration** et porté par
      `docs/PROD_MIGRATIONS.md` §3 comme vérification préalable, plutôt que masqué par un
      `not valid` qui rendrait la contrainte décorative.
- [x] **Test unitaire dédié** : `supabase/tests/0004_tracks.test.sql`, **78 assertions, aucune
      anomalie** — structure, contraintes de valeur, unicité **par workspace**, ordre attribué et
      ordre fourni, archivage réversible, politiques, privilèges, et les autorisations éprouvées
      contre des comptes réels avec les revendications JWT simulées comme PostgREST les pose.
- [x] **Deux affirmations de la spécification démenties par la mesure, et la spécification
      corrigée** (décision 56) : écrire `null` dans `position` à l'insertion **équivaut à
      l'omettre** — un trigger `BEFORE INSERT` ne peut pas distinguer les deux ; et
      `updated_at > created_at` est invérifiable dans une transaction, `now()` y étant constant —
      ce qui se prouve est que le trigger **écrase** la valeur du client.
- [x] **Test d'intégration dédié, hors interface** : `e2e/api/tracks.spec.ts`, **17 scénarios**,
      avec les jetons réels des trois profils obtenus par la véritable route de connexion. Les
      douze lignes du §6 sont rejouées contre la table réelle.
- [x] **Preuve de refus n° 3 acquise au niveau des tracks** : un membre du workspace A ne voit
      aucun track du workspace B — et la ligne de B est d'abord constatée présente avec la clé de
      service, sans quoi le « zéro ligne » ne prouverait rien (décision 50).
- [x] **Preuve de refus n° 11 acquise sur `tracks`** : l'anonyme obtient `200` et `[]` alors que la
      table contient quatre lignes.
- [x] **L'écriture est réservée aux administrateurs, prouvée par le refus ET par l'acceptation** :
      `viewer` et `business_developer` refusés en `403` / `42501`, la ligne n'existant **nulle
      part** ensuite ; administrateur accepté en `201`, `position` attribuée automatiquement.
- [x] **Le `WITH CHECK` de la mise à jour est prouvé nécessaire** : un administrateur de A ne peut
      pas déplacer son track vers B, refus que le `USING` seul aurait laissé passer.
- [x] **Contraintes de valeur convergentes** (décision 57) : défaut réel trouvé par le contrôle de
      restauration du harnais — `create table if not exists` ne répare jamais une contrainte
      retirée, et la base restait durablement affaiblie. Les contraintes sont désormais reposées à
      chaque passage, et le rejeu **répare**.
- [x] **Seed mis à jour dans le même changement** : quatre tracks, dont un **archivé**, créés par
      la véritable API REST, convergents. Rejoué : toujours quatre lignes, aucun doublon.
      `docs/SPEC-seed.md` §2.5 et §4 mis à jour ; le message de fin d'exécution du seed, devenu
      faux, est corrigé — `tracks` est lisible par un membre, les tables d'identité ne le sont pas.
- [x] **Test E2E dédié** : `e2e/ui/tracks.spec.ts`, **9 scénarios verts** — la requête réellement
      émise par l'application construite (filtre serveur, ordre, colonnes), l'état vide, le
      chargement, le refus, et les quatre paliers responsive.
- [x] **Tests unitaires d'interface** : `webapp/src/lib/tracks.test.ts`,
      `webapp/src/app/presentation-tracks.test.ts`, `webapp/src/app/SectionTracks.test.tsx`.
      **133 tests unitaires** au total (96 avant l'unité). Un défaut réel y a été trouvé : la
      recherche dans les catalogues rendait une propriété héritée d'`Object` pour `constructor` ou
      `toString`, court-circuitant les replis — corrigé par `Object.hasOwn`.
- [x] **Vérification visuelle réellement observée** : `docs/captures/CRM-020/` — huit captures,
      dont l'état vide, l'état chargé, le chargement, le refus, et les quatre paliers. **Deux
      défauts trouvés en les regardant, alors que toutes les preuves étaient vertes** : l'écran
      affirmait « Aucun track n'est accessible » en listant trois tracks, et la pilule `accent`
      n'atteignait pas le contraste AA en texte jaune. Corrigés dans le même changement.
- [x] Harnais de preuves rejouable `scripts/verify-tracks.sh` : **40 contrôles, aucune anomalie**,
      et **non complaisant, éprouvé par sept dégradations réelles** — écriture ouverte aux membres,
      `WITH CHECK` retiré, contrainte de couleur retirée, `DELETE` accordé, trigger de position
      retiré, lecture ouverte à tous, seed privé de son track archivé. Chacune fait échouer les
      preuves, et la restauration est **constatée** : trois politiques et elles seules, aucun
      `DELETE` résiduel, seed revenu à son contrat.
- [x] **Trois assertions figées par des unités précédentes ont échoué comme prévu, et ont été
      révisées** : la clé étrangère absente (`CRM-003`, suite `0001`), la liste des tables et les
      relations de `track_members` (`CRM-006`, `database.types.test-d.ts`), et les comptes de
      preuves (`CRM-008`, `verify-harness.sh` : 306 assertions, 30 scénarios `api`, 22 `ui`). Le
      mécanisme de la décision 51 a fonctionné comme prévu.
- [x] **Build vert**, `npm run typecheck` vert sur les quatre projets, `npm run types:check` vert —
      les types régénérés suivent le schéma.
- [x] **Aucune régression** : les dix harnais précédents rejoués — **33, 38, 23, 26, 26, 42, 49,
      30, 41 et 22 contrôles**, aucune anomalie.
- [x] `docs/SCHEMA.md` §2, `docs/SPEC-permissions-rls.md` §3 et §4, `docs/SPEC-webapp.md` §6.3,
      `docs/SPEC-seed.md` §2.5 et §4, `docs/DESIGN_SYSTEM.md` §5.5 bis, §12.4 et §12.5,
      `docs/DAT.md` §3.1 et §7, `docs/PROD_MIGRATIONS.md` §3, `docs/manual.md` §3.2 et §3.2 bis,
      `README.md`, `CHANGELOG.md` mis à jour dans le même changement.
- [ ] **Aucun track n'est visible dans l'interface, et aucune interface ne permet de les gérer.**
      La webapp est un appelant **anonyme** : elle n'a aucun parcours de connexion, qu'aucune unité
      du backlog ne porte — **INC-021, en attente d'arbitrage**. La politique de lecture ne consent
      donc rien à l'interface, et il n'existe ni écran de création, ni de renommage, ni de
      réordonnancement, ni d'archivage. Le CRUD est livré et prouvé **par l'API**, ce que
      `CLAUDE.md` §10 exige de toute façon, l'interface n'ayant jamais valeur de preuve.
      **Cette preuve est bloquée par un arbitrage, pas par un défaut de l'unité.**
- [ ] **Les droits fins ne sont pas appliqués.** La politique de lecture s'arrête au rôle de
      workspace : `app.can_read_track` est l'une des quatre fonctions différées par INC-013, dont
      l'arbitrage reste ouvert, et l'écrire ici trancherait à la place du responsable. Un
      `track_members.access = 'none'` ne masque donc rien encore. **INC-024**, avec une assertion
      pgTAP qui deviendra rouge lorsque `CRM-012` resserrera la politique.

*DoD adaptée, écarts explicites.* La Definition of Done exige « E2E, captures ». Les deux sont
livrés, mais sur les **états que le backend consent réellement** à un appelant anonyme : vide,
chargement, refus, paliers. Le rendu **chargé** — pilules, couleurs, icônes, ordre, repli — est
éprouvé par test unitaire du composant réel et, dans l'application construite, en substituant la
**réponse réseau**. Ni l'un ni l'autre n'est une session, et aucun des deux n'est présenté comme
telle.

*Correctif du 2026-08-04 — le contraste des pilules était déclaré, non mesuré.*

- [x] **Défaut réel trouvé et corrigé, protocole `CLAUDE.md` §18 suivi** : reproduit par un test
      **rouge avant correction**, puis corrigé, puis vérifié. `docs/DESIGN_SYSTEM.md` §8 exige
      4,5:1 « y compris pour les badges colorés » et aucune preuve ne calculait un contraste :
      `success` — la couleur du track `studio-web` du seed — rendait **3,82:1**, et `danger`
      **3,29:1**. Tous deux **lisibles sans être conformes**, donc invisibles à l'observation ;
      seul `accent`, à 1,45:1, avait été vu et corrigé.
- [x] **Quatre jetons `--color-*-on-soft`**, calculés à partir du jeton plein : 7,64 / 4,85 / 4,72 /
      4,67. `accent` repasse de `text-ink` à `text-accent-on-soft` — une règle unique plutôt qu'une
      exception dans un tableau qui devra s'étendre aux badges.
- [x] **La conformité est désormais mesurée sur le rendu**, pas déclarée : `e2e/ui/tracks.spec.ts`
      peint les couleurs rendues sur un canevas d'un pixel et relit les octets. Lire
      `getComputedStyle` serait faux — la première version de la mesure rendait 2,31:1 pour un
      contraste de 7,64:1, un faux rouge qui aurait aussi bien pu être un faux vert.
- [x] **Les cinq jetons sont exercés**, dont `danger` et `neutral` qu'aucun track du seed n'emploie :
      un jeton que rien ne rend n'est jamais mesuré.
- [x] **Le mappage exact est figé** (`presentation-tracks.test.ts`). Les trois assertions
      existantes — « non vide », « pas d'hexadécimal », « fond et texte distincts » — étaient toutes
      vertes avec `text-success` : une propriété générale ne remplace pas la valeur attendue.
- [x] `npm run test:unit` **138 tests**, `npm run e2e:ui` **23 scénarios**,
      `scripts/verify-tracks.sh` **43 contrôles, aucune anomalie** avec une **huitième dégradation**
      qui éprouve la nouvelle preuve, `scripts/verify-harness.sh` **22 contrôles** (comptes `ui`
      épinglés portés de 22 à 23).
- [x] `docs/DESIGN_SYSTEM.md` §1, §5.6, **§12.5**, `docs/INCONSISTENCY_REPORT.md` **INC-028**,
      `docs/JOURNAL.md` et `CHANGELOG.md` mis à jour dans le même changement.

*Limites nommées, non masquées.*

- **INC-028 est ouverte et dépasse cette unité.** La contradiction §5.6 / §8 date de `CRM-000` et
  vaut pour les badges, les liserés de card et les compteurs de colonne, qui ne sont **pas**
  modifiés ici. Trois questions sont portées à l'arbitrage.
- **Les seuils chiffrés du §8 ne sont mesurés que sur les pilules de track.** Partout ailleurs, la
  conformité AA reste déclarée — c'est-à-dire dans l'état où étaient les pilules avant ce correctif.
- **Aucune donnée métier ne peut apparaître dans l'interface tant qu'INC-021 n'est pas tranchée.**
  Ce n'est plus une gêne locale : `CRM-021`, `CRM-041`, `CRM-042` et les suivantes buteront sur le
  même obstacle et livreront, au mieux, des captures vides. L'arbitrage conditionne la valeur
  démontrable de **tout le chunk 3**.
- **L'administration des tracks est une opération d'exploitation**, pas un parcours produit — même
  nature qu'INC-015 pour l'invitation.
- **Sur les douze preuves de refus de `docs/SPEC-permissions-rls.md` §7**, la n° 3 et la n° 11 sont
  désormais acquises **au niveau des tracks**. Les dix autres exigent des cards, des channels et
  des comptes mail : elles restent dues par `CRM-014`.
- **Le réordonnancement n'a pas d'opération atomique** : réordonner, c'est écrire `position`. Une
  RPC deviendra nécessaire avec le glisser-déposer (`CRM-041`).
- **Le type généré exige `position` à l'insertion**, que le trigger rend facultative : le
  générateur ignore les triggers. Écart figé par une assertion, **INC-027**.
- **PostgREST divulgue la commande `GRANT`** dans son refus de privilège. Comportement de la
  version épinglée, portée transverse, **INC-026**.
- **Aucune limite de nombre de tracks par workspace** n'est posée côté serveur.
- **Sur l'hôte de vérification, la chaîne s'exécute sous Node 22.22.2**, alors que le dépôt exige
  Node 24 — exercé dans le conteneur `webapp` depuis `CRM-007`. Limite héritée, inchangée.

### CRM-021 — Channels `[~]`
CRUD, ordre, archivage, onglets, débordement horizontal.
**DoD** : idem, plus le trigger de cohérence du workflow (`CRM-033`) une fois disponible.

- [x] **Spécification écrite avant tout code**, `docs/SPEC-channels.md` : aucun document ne disait
      ce qu'un channel doit garantir de son cloisonnement, ni ce que la barre d'onglets doit lire.
      Rédigée **après mesure** du comportement réel de la pile épinglée, sur une table sonde
      jetable `public.sonde_channels` créée puis détruite. Commit documentaire dédié.
- [x] `supabase/migrations/0004_channels.sql` : table, unicité du slug **par track**, contraintes
      de valeur convergentes, trigger d'attribution de `position` dans la portée du track, trigger
      d'`updated_at`, index partiel des channels actifs, **trois politiques RLS**.
- [x] **Le cloisonnement est garanti, pas espéré** (décision 60). `channels.workspace_id` est
      dénormalisé et c'est lui que la politique interroge : s'il pouvait mentir, la RLS
      cloisonnerait sur une valeur fausse et aucune politique ne le rattraperait. La clé étrangère
      est donc **composite** — `(track_id, workspace_id) → tracks (id, workspace_id)` — et elle
      remplace la clé simple, qu'elle contient. Sa condition, `unique (id, workspace_id)` sur
      `tracks`, a été **mesurée** : sans elle PostgreSQL refuse la clé composite.
- [x] **Refus prouvé au niveau où il compte** : l'insertion d'un channel dont `workspace_id` ne
      correspond pas à celui de son track est refusée en `23503` **y compris à `postgres`**, donc
      indépendamment de toute politique. La preuve porte aussi sur la **mise à jour**, sans quoi il
      suffirait de créer une ligne cohérente puis de la corrompre.
- [x] **INC-010 refermée** : la clé étrangère `channel_members.channel_id → channels.id` est
      posée. C'est la seconde des deux clés qu'INC-010 avait dû différer, et **deux assertions
      figées ont réellement échoué** au moment de la poser — celle de la suite `0001` et celle de
      `database.types.test-d.ts` — puis ont été révisées dans le même changement. Le mécanisme de
      la décision 51 a fonctionné une seconde fois, à un chunk d'intervalle.
- [x] **INC-025 refermée** : `created_at` et `updated_at` sont livrées, et le tableau de `channels`
      de `docs/SCHEMA.md` §2 est complété. Les deux moitiés de l'entrée sont traitées.
- [x] **Test unitaire dédié** : `supabase/tests/0005_channels.test.sql`, **67 assertions, aucune
      anomalie** — structure, clé composite, ordre par track, archivage, politiques, privilèges,
      et les autorisations éprouvées contre quatre comptes réels avec les revendications JWT
      simulées comme PostgREST les pose.
- [x] **Test d'intégration dédié, hors interface** : `e2e/api/channels.spec.ts`, **20 scénarios**,
      avec les jetons réels des trois profils obtenus par la véritable route de connexion. Les
      quatorze lignes du contrat d'API de `docs/SPEC-channels.md` §7 y sont rejouées.
- [x] **Preuves de refus n° 3 et n° 11 acquises au niveau des channels** : un membre du workspace A
      ne voit aucun channel de B (constaté d'abord avec la clé de service, pour que le « zéro
      ligne » ne soit pas vrai sur une table vide) ; l'anonyme obtient `200` et `[]`.
- [x] **L'écriture est réservée aux administrateurs, prouvée par le refus ET par l'acceptation** :
      `viewer` et `business_developer` refusés en `403`/`42501`, administrateur accepté en `201`
      avec `position` attribuée **en troisième position de son track**, et non à la suite de tous
      les channels du workspace.
- [x] **L'unicité par track est prouvée dans les deux sens** : le même slug refusé dans le même
      track, accepté dans un autre track du même workspace. C'est la différence de fond avec
      `tracks`, dont le slug est unique par workspace.
- [x] **Aucune suppression physique** : `DELETE` n'est accordé à personne ; le refus se manifeste
      dès le privilège (`permission denied for table channels`) et la ligne survit.
- [x] **Seed mis à jour dans le même changement** : six channels sur trois tracks, dont un
      **archivé**, et un track n'en portant qu'**un** — une barre à un seul onglet est un cas
      d'affichage réel, distinct de la barre vide. Créés par la véritable API REST, écriture
      convergente, rejoué sans doublon.
- [x] **Test E2E dédié** : `e2e/ui/channels.spec.ts`, **13 scénarios verts** contre le build de
      production — la route interroge réellement `tracks` puis `channels`, ne demande pas les
      channels quand le track n'est pas consenti, et traite les quatre états.
- [x] **Tests unitaires d'interface** : `webapp/src/lib/channels.test.ts` et
      `webapp/src/app/TabBar.test.tsx` — la requête émise, la classification des échecs, le rendu
      des onglets, l'onglet courant et l'absence de `tablist`. **164 tests, 10 fichiers**, verts.
- [x] **Vérification visuelle réellement observée** : `docs/captures/CRM-021/` — sept captures,
      dont les quatre paliers, regardées une à une.
- [x] **Deux défauts trouvés en regardant les captures, corrigés, et figés par un test** :
      (1) une capture montrait un écran **incohérent** — un track ouvert avec ses onglets, et une
      barre latérale affirmant qu'aucun track n'existe — parce que la substitution réseau ne
      servait le track qu'à une des deux requêtes ; (2) à 390 px, la barre d'onglets débordait sans
      indication, le dernier libellé coupé net. Le §7 était respecté (la page ne défilait pas) et
      le §4 violé (« jamais tronqué sans indication ») : **aucune assertion ne pouvait l'attraper**,
      les deux règles étant vérifiées séparément. Corrigé par `.indique-debordement-x`, en CSS pur
      et sans écouter d'événement, et consigné en `docs/DESIGN_SYSTEM.md` §12.6.
- [x] **`docs/DESIGN_SYSTEM.md` §12.4 refermé** : les pilules de track sont des liens, la
      destination existant désormais. L'état actif **s'ajoute** à la couleur du track sans la
      remplacer, et `aria-current="page"` porte l'information indépendamment du visuel.
- [x] **`docs/DESIGN_SYSTEM.md` §12.1 requalifié** : l'écart temporaire devient une **position
      motivée** (décision 62). Le patron `tablist` annoncé par `CRM-007` est écarté — nos onglets
      changent l'URL, un `tablist` décrit des panneaux qui s'échangent dans la même page, et le
      `tabindex` glissant retirerait la navigation par `Tab`.
- [x] Harnais de preuves rejouable `scripts/verify-channels.sh` : **28 contrôles, aucune
      anomalie**, et **non complaisant** — il relâche réellement la politique d'insertion (le
      refus disparaît), retire réellement la clé composite (la ligne menteuse passe), puis
      **constate** la restauration au lieu de la supposer.
- [x] **Build vert**, `npm run typecheck` vert sur les quatre projets, `npm run types:check` vert.
- [x] **Trois compteurs figés par `CRM-008` ont échoué comme prévu, et ont été révisés** :
      `scripts/verify-harness.sh` fige le nombre d'assertions pgTAP et de scénarios Playwright, de
      sorte qu'une suite cessant d'être découverte ne passe pas pour verte. Les trois sont passés
      à **374 / 50 / 37**.
- [x] **Aucune régression** : les douze harnais rejoués après commit — **33, 38, 23, 26, 26, 42,
      49, 30, 41, 22, 43 et 28 contrôles**, aucune anomalie.
- [x] `docs/SCHEMA.md` §2, `docs/SPEC-permissions-rls.md` §3 et §4, `docs/SPEC-seed.md` §2.2, §2.6,
      `docs/DESIGN_SYSTEM.md` §4, §12.1, §12.4, §12.6, `docs/DAT.md` §3.1 et §7,
      `docs/PROD_MIGRATIONS.md` §3, `docs/manual.md` §3.2 bis et §3.2 ter, `docs/MASTER_PLAN.md` §3,
      `README.md`, `CHANGELOG.md` mis à jour dans le même changement.
- [ ] **Aucun channel n'est visible dans l'interface, et aucune interface ne permet de les gérer.**
      La webapp est un appelant **anonyme** : elle n'a aucun parcours de connexion, qu'aucune unité
      du backlog ne porte — **INC-021, en attente d'arbitrage**. La route d'un track affiche donc
      « Track introuvable » pour **tout** identifiant, et il n'existe ni écran de création, ni de
      renommage, ni de réordonnancement, ni d'archivage. Le CRUD est livré et prouvé **par l'API**,
      ce que `CLAUDE.md` §10 exige de toute façon.
      **Cette preuve est bloquée par un arbitrage, pas par un défaut de l'unité.**
- [ ] **`workflow_id` n'est ni obligatoire, ni référencée, ni cohérente.** `docs/SCHEMA.md` §2
      l'exige non nulle et référencée vers `workflows`, table livrée par `CRM-031`, deux étapes
      plus loin dans le plan. Mesuré : `to_regclass('public.workflows')` rend `NULL`. La colonne
      est livrée nullable et sans clé étrangère, et **trois assertions pgTAP plus une assertion de
      type** constatent l'écart pour le rendre rouge à `CRM-031`. **INC-029, en attente
      d'arbitrage** (trois options). Le trigger de cohérence relève de `CRM-033`, ce que la DoD de
      cette unité prévoyait déjà.
      **Cette preuve est bloquée par une dépendance, pas par un défaut de l'unité.**
- [ ] **Les droits fins ne sont pas appliqués.** La politique de lecture s'arrête au rôle de
      workspace : `app.can_read_channel` et `app.can_write_channel` sont deux des quatre fonctions
      différées par INC-013, dont l'arbitrage reste ouvert, et les écrire ici trancherait à la
      place du responsable. Un `channel_members.access = 'none'` ne masque donc rien encore.
      **INC-030**, avec une assertion pgTAP et un scénario d'API qui deviendront rouges lorsque
      `CRM-012` resserrera la politique.

*DoD adaptée, écarts explicites.* La Definition of Done exige « E2E, captures ». Les deux sont
livrés, mais sur les **états que le backend consent réellement** à un appelant anonyme : track
introuvable, barre vide, erreur, paliers. Le rendu **chargé** — onglets, ordre, onglet courant — est
éprouvé par test unitaire du composant réel et, dans l'application construite, en substituant la
**réponse réseau**. Ni l'un ni l'autre n'est une session, et aucun des deux n'est présenté comme
telle.

*Limites nommées, non masquées.*

- **Aucune donnée métier ne peut apparaître dans l'interface tant qu'INC-021 n'est pas tranchée.**
  Troisième unité consécutive du chunk 3 à buter sur le même obstacle, et la plus démonstrative :
  la route d'un track ne peut afficher que « Track introuvable ».
- **L'administration des channels est une opération d'exploitation**, pas un parcours produit.
- **Sur les douze preuves de refus de `docs/SPEC-permissions-rls.md` §7**, la n° 3 et la n° 11 sont
  désormais acquises **au niveau des channels**. Les dix autres exigent des cards et des comptes
  mail : elles restent dues par `CRM-014`.
- **Le réordonnancement des onglets n'a pas d'opération atomique** : réordonner, c'est écrire
  `position`. Une RPC deviendra nécessaire avec le glisser-déposer (`CRM-041`).
- **Le type généré exige `position` à l'insertion**, que le trigger rend facultative : INC-027 se
  reproduit à l'identique sur `channels`, et l'écart y est figé par une assertion.
- **L'archivage d'un track ne cascade pas sur ses channels** : choix motivé (`docs/SPEC-channels.md`
  §4), mais il signifie qu'un désarchivage de track fait réapparaître exactement les channels qui
  étaient visibles avant.
- **Aucune limite de nombre de channels par track** n'est posée côté serveur.
- **INC-010 et INC-025 sont techniquement closes mais restent ouvertes au registre** : l'arbitrage
  qu'elles demandaient — désigner l'unité porteuse, confirmer la lecture des conventions — n'a
  jamais été rendu. Le fait technique est acquis, la décision documentaire ne l'est pas.
- **Sur l'hôte de vérification, la chaîne s'exécute sous Node 22.22.2**, alors que le dépôt exige
  Node 24 — exercé dans le conteneur `webapp` depuis `CRM-007`. Limite héritée, inchangée.

### CRM-030 — Catalogue de nœuds `[~]`
`workflow_nodes_catalog`, catalogue initial de sept nœuds, refus d'archivage d'un nœud occupé.
**DoD** : pgTAP sur le refus d'archivage ; E2E d'administration ; seed conforme au tableau de
`docs/SPEC-workflow-engine.md` §2.

- [x] **Spécification écrite avant tout code**, `docs/SPEC-workflow-engine.md` §2 réécrit : le
      chapitre tenait en dix-huit lignes et ne disait ni ce qu'une clé de nœud a le droit d'être,
      ni comment le catalogue s'ordonne, ni ce que l'API doit rendre à chacun des trois rôles, ni
      quelles couleurs les sept nœuds portent — alors que `docs/SCHEMA.md` §3 exige la colonne.
      Rédigé **après mesure** sur une table sonde jetable `public.sonde_wnc`, créée puis détruite,
      l'absence de reste étant constatée. Commit documentaire dédié.
- [x] `supabase/migrations/0005_workflow_nodes_catalog.sql` : table, unicité de la clé **par
      workspace**, six contraintes de valeur convergentes, trigger d'attribution de `position`
      dans la portée du workspace, trigger d'`updated_at`, index partiel du catalogue actif,
      **trois politiques RLS** et privilèges explicites. **Aucun `DELETE` accordé à personne** :
      l'archivage tient lieu de suppression.
- [x] **Test unitaire dédié** : `supabase/tests/0006_workflow_nodes_catalog.test.sql`,
      **80 assertions, aucune anomalie** — structure, bornes, unicité par workspace, ordre attribué
      et ordre fourni, archivage réversible, politiques, privilèges, et les autorisations éprouvées
      contre quatre comptes réels avec les revendications JWT simulées comme PostgREST les pose.
- [x] **Une affirmation de la spécification démentie par la mesure, et la spécification corrigée**
      (décision 70) : le §2.8 attribuait à PostgREST le fait qu'une mise à jour refusée rende `200`
      et un tableau vide. **C'est le moteur.** Une clause `USING` ne refuse pas une ligne, elle la
      rend invisible ; l'`UPDATE` réussit alors sur zéro ligne. L'assertion pgTAP, d'abord écrite
      en `throws_ok('42501')` par symétrie avec l'insertion, a **échoué** en rendant « caught: no
      exception » — et c'est cet échec qui a établi le fait. La preuve correcte relit la ligne et
      la constate inchangée.
- [x] **Test d'intégration dédié, hors interface** : `e2e/api/catalogue-noeuds.spec.ts`,
      **25 scénarios**, avec les jetons réels des trois profils obtenus par la véritable route de
      connexion. Les treize lignes du contrat d'API de `docs/SPEC-workflow-engine.md` §2.8 y sont
      rejouées.
- [x] **PREUVE DE REFUS N° 2 ACQUISE, pour la première fois du projet** : un
      `business_developer` ne modifie ni ne renomme aucun nœud, et la ligne est relue **inchangée**.
      Les trois autres tables de la famille des workflows restent dues par `CRM-031`.
- [x] **Preuves de refus n° 3 et n° 11 acquises au niveau du catalogue** : un membre du workspace A
      ne voit aucun nœud de B — la ligne de B étant d'abord constatée présente avec la clé de
      service, sans quoi le « zéro ligne » ne prouverait rien (décision 50) ; l'anonyme obtient
      `200` et `[]` alors que la table contient huit lignes.
- [x] **L'écriture est réservée aux administrateurs, prouvée par le refus ET par l'acceptation** :
      `viewer` et `business_developer` refusés en `403` / `42501`, la ligne n'existant **nulle
      part** ensuite ; administrateur accepté en `201`, `position` attribuée automatiquement, et
      les défauts de colonne appliqués — `open` et `neutral`, jamais `brand`.
- [x] **Le `WITH CHECK` de la mise à jour est prouvé nécessaire** : un administrateur de A ne peut
      pas déplacer son nœud vers B, refus que le `USING` seul aurait laissé passer. Et il se
      manifeste ici par une **erreur** `42501`, à la différence du refus par le `USING` : les deux
      formes coexistent sur la même politique, ce qui est exactement ce qui rend la seconde
      difficile à voir.
- [x] **`numeric(5,2)` arrondit avant la contrainte, mesuré et figé** : `99.999` est accepté et
      stocké `100.00`, `100.01` et `-0.01` refusés. Sans cette preuve, un test futur insérant
      `99.999` échouerait pour une raison sans rapport avec la règle métier, et serait « corrigé »
      en relâchant la contrainte (décision 68).
- [x] **Seed mis à jour dans le même changement** : les sept nœuds du §2.9 plus **un archivé**,
      créés par la véritable API REST, convergents. Les **trois types** sont représentés, les
      **cinq jetons** du design system exercés, et les deux nœuds terminaux portent un seuil de
      relance **nul** et non `0`. Rejoué : toujours huit lignes, aucun doublon.
- [x] Harnais de preuves rejouable `scripts/verify-catalogue.sh` : **36 contrôles, aucune
      anomalie** — 29 hors suites Playwright et build (`--rapide`) —, et **non complaisant, éprouvé
      par trois dégradations réelles** — lecture ouverte
      à tous, seed privé de son nœud archivé, seuil de relance posé sur un nœud terminal. Chacune
      fait sortir le harnais en code `1`, et la restauration est **constatée** : contrainte revenue,
      politiques revenues, libellé du seed revenu à « Prospection ».
- [x] **Le contrôle décisif de ce harnais est celui de la ligne h** : il ouvre réellement la
      politique de mise à jour et **constate que le renommage passe**. Sans lui, la preuve du refus
      serait tout aussi verte sur un produit où **rien** n'est modifiable.
- [x] **Convergence prouvée, et non simple idempotence** : une contrainte retirée à la main est
      **rétablie** par un rejeu de la migration, conformément à la décision 57.
- [x] **Deux compteurs figés par des unités précédentes ont échoué comme prévu, et ont été
      révisés** : `scripts/verify-harness.sh` (374 / 50 / 37 → **454 / 75 / 37**, le compteur
      d'interface **inchangé**, cette unité ne livrant aucun écran) et
      `webapp/src/lib/database.types.test-d.ts`, dont l'énumération des tables a échoué à la
      régénération des types. Le mécanisme de la décision 51 a fonctionné une troisième fois.
- [x] **Sept assertions de type ajoutées** pour figer le contrat du catalogue, dont la troisième
      occurrence d'INC-027 : le type généré exige `position` à l'insertion, que le trigger rend
      facultative — le générateur ignore les triggers.
- [x] **Build vert**, `npm run typecheck` vert sur les quatre projets, `npm run types:check` vert —
      les types régénérés suivent le schéma. `npm run test:unit` **164 tests**, `npm run e2e:ui`
      **37 scénarios**, inchangés : aucune régression.
- [x] **Aucune régression** : les douze harnais précédents rejoués — **33, 38, 23, 26, 26, 42, 49,
      30, 41, 22, 43 et 28 contrôles**, aucune anomalie.
- [x] `docs/SPEC-workflow-engine.md` §2 (réécrit), §8, §9, `docs/SCHEMA.md` §3,
      `docs/SPEC-permissions-rls.md` §4 et §7, `docs/SPEC-seed.md` §2.7 et §4, `docs/DAT.md` §7 et
      §8, `docs/PROD_MIGRATIONS.md` §3 et §5, `docs/manual.md` §3.2 et sommaire,
      `docs/MASTER_PLAN.md` §3, `README.md`, `CHANGELOG.md` mis à jour dans le même changement.
- [ ] **Le refus d'archivage d'un nœud occupé n'est pas livré.** Son chemin est
      `cards.current_step_id → workflow_steps.node_id → workflow_nodes_catalog.id` : il traverse
      `workflow_steps` (`CRM-031`) et `cards` (`CRM-040`). Mesuré : les trois tables rendent `NULL`
      à `to_regclass`. Mesuré aussi, et c'est ce qui a tranché : PostgreSQL **accepte la création**
      d'une fonction PL/pgSQL référençant une table absente, l'échec ne survenant qu'au premier
      appel — un trigger écrit ici ferait échouer **toute** mise à jour du catalogue sans rien
      protéger. **INC-031, en attente d'arbitrage** (trois options), avec trois assertions
      `hasnt_table` et un contrôle du harnais qui deviendront rouges le jour où les tables
      apparaîtront.
      **Cette preuve est bloquée par une dépendance, pas par un défaut de l'unité.**
- [ ] **Aucun E2E d'administration, aucune capture d'application.** Le catalogue n'a **aucun
      écran** et n'en aura pas avant l'éditeur de workflow de `CRM-031` : il n'existe rien à
      regarder, et rien à administrer depuis une interface. La webapp reste de surcroît un appelant
      **anonyme**, faute d'écran de connexion — **INC-021, en attente d'arbitrage**. Le CRUD est
      livré et prouvé **par l'API**, ce que `CLAUDE.md` §10 exige de toute façon.
      **Cette preuve est bloquée par une dépendance et par un arbitrage, pas par un défaut de
      l'unité.**

*DoD adaptée, écarts explicites.* La Definition of Done exige « E2E d'administration ». Aucun n'est
livré, et aucun ne pouvait l'être : cette unité ne livre ni écran ni parcours. Ses preuves sont
unitaires (pgTAP) et d'intégration (PostgREST, jetons réels, hors interface), ce que la nature
d'une table de référence commande. **Aucune vérification visuelle** pour la même raison — et non
parce qu'elle aurait été omise.

*Limites nommées, non masquées.*

- **La garde d'archivage manque** (INC-031, ci-dessus). Ce qui manque n'est pas la règle — elle est
  écrite au §2.6 — mais la jointure qui remonte d'un nœud à ses cards.
- **Aucune donnée du catalogue ne peut apparaître dans l'interface tant qu'INC-021 n'est pas
  tranchée.** Quatrième unité consécutive du chunk 3 à buter sur le même obstacle.
- **L'administration du catalogue est une opération d'exploitation**, pas un parcours produit —
  même nature qu'INC-015 pour l'invitation et que les constats de `CRM-020` et `CRM-021`.
- **Sur les douze preuves de refus de `docs/SPEC-permissions-rls.md` §7**, les n° 2, 3 et 11 sont
  désormais acquises au niveau du catalogue, la n° 2 pour la première fois. Les neuf autres
  exigent des cards, des comptes mail et des colonnes protégées : elles restent dues par `CRM-013`
  et `CRM-014`.
- **Le réordonnancement du catalogue n'a pas d'opération atomique** : réordonner, c'est écrire
  `position`. Une RPC deviendra nécessaire avec l'éditeur de `CRM-031`.
- **Le type généré exige `position` à l'insertion**, que le trigger rend facultative : INC-027 se
  reproduit à l'identique une troisième fois, et l'écart y est figé par une assertion.
- **PostgREST divulgue la commande `GRANT`** dans son refus de privilège. Comportement de la
  version épinglée, portée transverse, **INC-026** — désormais **figé par une assertion**, de sorte
  qu'une version future qui cesserait de le faire rende le scénario rouge et permette de clore
  l'entrée.
- **Aucune limite de nombre de nœuds par workspace** n'est posée côté serveur.
- **Aucune contrainte ne lie `kind` et `default_probability`.** Un nœud `won` à 0 % ou un nœud
  `lost` à 100 % est accepté en base. Le seed respecte la cohérence ; le produit ne l'impose pas,
  faute d'une règle écrite dans la spécification d'origine.
- **Sur l'hôte de vérification, la chaîne s'exécute sous Node 22.22.2**, alors que le dépôt exige
  Node 24 — exercé dans le conteneur `webapp` depuis `CRM-007`. Limite héritée, inchangée.

### CRM-031 — Workflows, étapes, transitions `[ ]`
Éditeur d'administration ; workflow par défaut du seed conforme au graphe spécifié.
**DoD** : pgTAP (étape initiale unique, unicité `(workflow, nœud)`, transitions distinctes) ;
E2E de création ; captures de l'éditeur.

### CRM-032 — Copie d'un workflow vers un track `[ ]`
`copy_workflow_to_track` avec traçabilité d'origine et signalement de divergence.
**DoD** : pgTAP (copie complète des étapes, transitions et champs ; lignage renseigné) ; E2E ;
mention de divergence visible dans l'interface.

### CRM-033 — Cohérence workflow ↔ channel `[ ]`
Trigger : workflow `global` du workspace, ou `track` du track du channel.
**DoD** : pgTAP sur les trois cas (global accepté, track du même track accepté, track étranger
refusé) ; refus constaté aussi lors d'un déplacement de channel.

### CRM-034 — `move_card`, garde centrale `[ ]`
Les six vérifications de `docs/SPEC-workflow-engine.md` §5.
**DoD** : pgTAP pour chacune des six ; preuves de refus n° 1 et 5 ; message d'erreur listant les
clés manquantes.

### CRM-035 — Définition des champs `[ ]`
`form_fields`, `form_field_rules`, grille champ × étape dans l'éditeur.
**DoD** : unitaire, API (écriture réservée aux administrateurs), E2E, captures de la grille.

### CRM-036 — Valeurs et validation `[ ]`
`card_field_values`, validation par type, union étape + transition.
**DoD** : pgTAP (type incorrect refusé, `hidden` non exigé, règle ajoutée après coup
n'invalidant pas l'existant).

### CRM-037 — Rendu du formulaire conditionnel `[ ]`
Champs par étape, section repliée des valeurs d'autres étapes, mention « requis pour passer à ».
**DoD** : E2E (transition bloquée, saisie, transition réussie) ; captures de chaque étape ;
accessibilité des erreurs vérifiée.

### CRM-040 — Cards `[ ]`
CRUD, adresse email générée, responsable, montant, archivage, corbeille.
**DoD** : pgTAP sur la génération et l'unicité de `email_local_part` ; E2E ; captures.

### CRM-041 — Board kanban `[ ]`
Colonnes par étape, glisser-déposer appelant `move_card`, menu des transitions déclarées,
retour arrière visuel en cas de refus.
**DoD** : E2E de déplacement autorisé **et** de tentative interdite ; déplacement au clavier
vérifié ; captures aux quatre paliers ; vidéo `.webm` du glisser-déposer.

### CRM-042 — Vue liste `[ ]`
Tri, filtres, densité maîtrisée, pagination.
**DoD** : E2E ; comportement avec données longues vérifié en capture.

### CRM-043 — Commentaires `[ ]`
Rédaction libre par tout membre pouvant lire la card, édition et suppression par l'auteur.
**DoD** : API (refus pour un `viewer`) ; E2E ; temps réel constaté.

### CRM-044 — Timeline unifiée `[ ]`
`card_events` alimentée par triggers ; fil chronologique filtrable.
**DoD** : pgTAP (aucune écriture cliente possible) ; E2E ; captures.

### CRM-045 — Déplacement d'une card entre channels `[ ]`
`move_card_to_channel` avec remappage explicite.
**DoD** : pgTAP (remappage obligatoire, événement écrit) ; E2E.

### CRM-046 — Seed de démonstration complet `[ ]`
Trois tracks, plusieurs channels, workflows distincts dont un dérivé, cards à toutes les étapes,
cas d'erreur et branches alternatives, aucun écran vide.
**DoD** : `resetMe.sh` reproduit exactement le même état ; chaque fonctionnalité livrée est
démontrable depuis le seed.

### CRM-047 — Manuel utilisateur du chunk 3 `[ ]`
**DoD** : `docs/manual.md` décrit le produit réellement exécuté ; captures renouvelées.

---

## Chunk 4 — Messagerie

### CRM-050 — Infrastructure mail de développement `[ ]`
Stalwart (IMAP/SMTP), Roundcube (vérification visuelle), ClamAV, Inbucket conservé pour les
mails transactionnels. Boîte système et deux boîtes personnelles seedées.
**DoD** : `runDev.sh` démarre l'ensemble ; connexion IMAP et SMTP constatée ; Roundcube affiche
les boîtes ; `README.md` §6 conforme.

### CRM-051 — Service `mail-sync` `[ ]`
Squelette Python, configuration, journaux structurés, point de santé, API interne.
**DoD** : pytest unitaire ; image construite ; arrêt et redémarrage sans perte d'état.

### CRM-052 — Comptes entrants IMAP `[ ]`
Configuration, secret chiffré, test de connexion réel, état de synchronisation.
**DoD** : `CRM-004` tranché ; preuve de refus n° 6 (secret illisible) et n° 7 ; E2E de connexion
d'une boîte ; message d'erreur assaini vérifié.

### CRM-053 — Identités sortantes SMTP `[ ]`
Indépendantes des comptes entrants, adresse d'expédition, signature, quota.
**DoD** : E2E de configuration ; preuve de refus n° 12 ; cas « entrant Yahoo / sortant interne »
présent dans le seed.

### CRM-054 — Ingestion `[ ]`
IDLE, analyse MIME, dédoublonnage par `Message-ID`, occurrences, pièces jointes, antivirus.
**DoD** : pytest unitaire et intégration contre Stalwart ; E2E `mail` avec un email **réellement
envoyé** ; pièce jointe `infected` non téléchargeable (preuve n° 9) ; empreinte de repli testée.

### CRM-055 — Classement assisté `[ ]`
Les quatre règles, dont la suggestion non classante.
**DoD** : pytest par règle ; E2E de classement manuel ; si `CRM-060` n'est pas livré, règle 3
désactivée et documentée comme telle.

### CRM-056 — Dossiers IMAP imbriqués `[ ]`
Création, assainissement, renommage, labels Gmail, `mail_folder_map`.
**DoD** : intégration vérifiant l'arborescence **par un client IMAP** ; observation visuelle dans
Roundcube ; renommage d'un track propageant le renommage du dossier.

### CRM-057 — Inbox globale `[ ]`
Trois panneaux, arborescence Track → Channel → Card, « Non classés », pile sous 1024 px.
**DoD** : E2E ; captures aux quatre paliers ; message classé visible **à la fois** dans la card
et dans l'inbox.

### CRM-058 — Composition et réponse `[ ]`
`queue_outbound_email`, `smtp_worker`, `Reply-To` de la card, fil respecté, envoi depuis la card
ou depuis l'inbox par le même chemin.
**DoD** : E2E `mail` d'aller-retour complet ; en-têtes de threading vérifiés sur le message reçu ;
quota et refus testés.

### CRM-059 — Backfill, résilience, supervision `[ ]`
Import historique par lots, file persistante, backoff, états visibles.
**DoD** : pytest sur le backoff ; coupure SMTP simulée sans perte de message ; état affiché
conforme à la réalité.

---

## Chunk 5 — Extensions

Chaque unité est indépendamment livrable et suit la Definition of Done commune.

| Unité | Objet | État |
|---|---|---|
| CRM-060 | Contacts et organisations, historique transverse | `[ ]` |
| CRM-061 | Prochaine action, échéance, vue « Ma journée » | `[ ]` |
| CRM-062 | Relances automatiques des cards figées | `[ ]` |
| CRM-063 | Templates d'emails, signatures, séquences de relance | `[ ]` |
| CRM-064 | @mentions, notifications temps réel et préférences | `[ ]` |
| CRM-065 | Recherche globale plein texte et palette Cmd+K | `[ ]` |
| CRM-066 | Analytique de conversion et prévisionnel pondéré | `[ ]` |
| CRM-067 | Activités typées : appels, réunions, visios | `[ ]` |
| CRM-068 | Checklists et modèles de cards | `[ ]` |
| CRM-069 | Étiquettes et digest quotidien | `[ ]` |
| CRM-070 | Administration des permissions fines | `[ ]` |
| CRM-071 | Vues sauvegardées et import CSV | `[ ]` |
| CRM-072 | Journal d'audit consultable et conformité RGPD | `[ ]` |
| CRM-073 | Webhooks sortants signés et jetons d'API | `[ ]` |
| CRM-074 | Aperçu des pièces jointes et extraction de texte | `[ ]` |
| CRM-075 | Snooze des fils et des cards | `[ ]` |

---

## Propositions en attente d'arbitrage

Ces unités ne sont **pas planifiées**. Elles ont été proposées au responsable et attendent sa
décision. Aucune ne démarre sans arbitrage explicite.

| Unité | Proposition | État |
|---|---|---|
| CRM-P01 | Anti-double-prospection : alerte si un contact ou un domaine est déjà suivi ailleurs | `[ ]` |
| CRM-P02 | Score de santé de card et tri « cards à risque » | `[ ]` |
| CRM-P03 | Corbeille et restauration sur cards, tracks et channels | `[ ]` |
| CRM-P04 | Versionnement des workflows et plan de remappage | `[ ]` |
| CRM-P05 | Détection et fusion des doublons de contacts | `[ ]` |
| CRM-P06 | Flux ICS abonnable des prochaines actions | `[ ]` |
| CRM-P07 | Rapport hebdomadaire automatique aux administrateurs | `[ ]` |
| CRM-P08 | Écran de revue de pipeline pour les réunions | `[ ]` |
| CRM-P09 | Internationalisation FR/EN dès l'origine | `[ ]` |
| CRM-P10 | Onboarding guidé au premier lancement | `[ ]` |
| CRM-P11 | Sauvegarde chiffrée planifiée et restauration testée | `[ ]` |
| CRM-P12 | Enrichissement automatique des contacts (à évaluer au regard du RGPD) | `[ ]` |

**Note sur `CRM-P04`** : l'archivage d'un nœud occupé est déjà refusé par `CRM-030`, ce qui traite
le cas le plus dangereux. L'unité complète reste ouverte pour les cas de remappage volontaire.

**Note sur `CRM-P09`** : plus l'internationalisation est ajoutée tard, plus elle coûte cher. Si
elle est retenue, elle doit précéder `CRM-007`.
