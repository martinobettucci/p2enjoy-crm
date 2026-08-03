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

### CRM-002 — Scripts de lancement et environnement `[~]`
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
- [ ] **`resetMe.sh` rejoue le seed : NON PROUVÉ.** `supabase/seed/apply-seed.sh` n'existe pas —
      c'est l'objet de `CRM-005`, planifiée après `CRM-014` (`docs/MASTER_PLAN.md` §2.c). Seule
      la branche « seed absent » a pu être exercée : elle avertit explicitement et nomme
      `CRM-005`, au lieu de laisser croire à un succès complet. **Cette preuve est bloquée par une
      dépendance, pas par un défaut de l'unité : il n'y a rien à y faire tant que `CRM-005` n'est
      pas livrée.** Contradiction d'ordonnancement consignée dans
      `docs/INCONSISTENCY_REPORT.md`, INC-009.

*DoD adaptée, écarts explicites.* Aucun test unitaire ni test E2E dédié : cette unité ne livre
aucune logique métier ni parcours utilisateur, seulement l'outillage d'exécution. Les preuves
correspondantes sont d'intégration et vivent dans `scripts/verify-scripts.sh`. Le harnais Vitest,
pytest et Playwright reste l'objet de `CRM-008`. **Aucune vérification visuelle** : rien de cette
unité n'atteint l'interface, dont le premier écran arrive avec `CRM-007`.

*Limites nommées, non masquées.*

- La branche « seed » de `resetMe.sh` n'est pas exercée (voir ci-dessus).
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

### CRM-005 — Seed socle `[ ]`
Utilisateurs créés par l'API d'administration GoTrue ; un workspace ; les rôles représentés.
**DoD** : seed reproductible, identifiants stables, aucun mot de passe réel ; profils `admin`,
`business_developer` et `viewer` présents ; documenté dans `README.md`.

### CRM-006 — Types TypeScript générés `[ ]`
**DoD** : `npm run types:generate` régénère depuis le schéma local ; build de la webapp vert.

### CRM-007 — Squelette de la webapp `[ ]`
React + Vite + Tailwind, jetons du design system en variables CSS, mise en page barre latérale et
onglets, états de chargement, d'erreur et vide.
**DoD** : `docs/DESIGN_SYSTEM.md` §11 respecté (aucun hexadécimal hors jetons) ; captures aux
quatre paliers responsive observées ; navigation clavier vérifiée.

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
