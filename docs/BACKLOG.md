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

### CRM-008 — Harnais de tests `[ ]`
pgTAP, Vitest, pytest, Playwright (`api`, `ui`, `mail`).
**DoD** : chaque commande du `README.md` §7 s'exécute ; un test volontairement faux échoue bien.

---

## Chunk 3 — CRM utilisable

### CRM-020 — Tracks `[ ]`
CRUD, ordre, archivage, barre latérale.
**DoD** : unitaire, API (écriture refusée aux non-administrateurs), E2E, captures.

### CRM-021 — Channels `[ ]`
CRUD, ordre, archivage, onglets, débordement horizontal.
**DoD** : idem, plus le trigger de cohérence du workflow (`CRM-033`) une fois disponible.

### CRM-030 — Catalogue de nœuds `[ ]`
`workflow_nodes_catalog`, catalogue initial de sept nœuds, refus d'archivage d'un nœud occupé.
**DoD** : pgTAP sur le refus d'archivage ; E2E d'administration ; seed conforme au tableau de
`docs/SPEC-workflow-engine.md` §2.

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
