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
- [x] Harnais de preuves rejouable `scripts/verify-scripts.sh` : **52 contrôles, aucune
      anomalie**, et **non complaisant** — il échoue bien lorsqu'une variable Compose n'est pas
      documentée, lorsqu'un secret est écrit en clair dans le gabarit, lorsqu'une garde de profil
      est retirée, lorsque la dérivation d'un jeton est faussée, et — mesuré — **9 contrôles
      tombent** dès que les gardes d'hôte sont neutralisées.
- [x] **Gardes d'hôte** livrées et prouvées après échec réel de `./runDev.sh` sur un poste WSL
      (`docs/JOURNAL.md`, décisions 98 à 101) : magasin d'identifiants Docker écarté lorsqu'il
      délègue à un binaire Windows, ports occupés refusés **avant** démarrage en nommant la
      variable et le détenteur, contrôle de santé de `storage` fixé sur `127.0.0.1`, cluster
      PostgreSQL détruit par conteneur jetable, `node_modules` créé avant Compose pour rester à
      l'utilisateur. Démarrage à froid rejoué de bout en bout : `./resetMe.sh --yes` puis
      `./runDev.sh`, 11 services `healthy`, `verify-stack.sh` **33/33**, `verify-seed.sh`
      **49/49**.
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

### CRM-012 — Droits fins par track et channel `[~]`
Résolution « le plus spécifique gagne », administrateur jamais restreint.
**DoD** : pgTAP sur la matrice de résolution ; preuves de refus n° 3, 4, 7 et 11 de
`docs/SPEC-permissions-rls.md` §7.

- [x] **Spécification écrite avant tout code**, `docs/SPEC-permissions-rls.md` §3.3 à §3.5, §4.1 et
      §4.2 : le document décrivait comment un droit fin **se résout** sans jamais dire qui a le
      droit d'en **poser** un, ni de le lire. Rédigés **après mesure** sur la pile réelle — sondes
      créées puis détruites, récursion provoquée, `SQLSTATE` relevés — avec un contrat d'API de
      **treize lignes** écrit avant le code pour être mesuré et non supposé. Commit documentaire
      dédié, poussé avant la première ligne de SQL.
- [x] **INC-013 s'éteint pour trois fonctions sur quatre, et le choix est nommé** (décision 103).
      L'arbitrage demandé « avant `CRM-012` » n'a jamais été rendu, et quatre exécutions de la
      routine avaient écarté l'unité pour ce motif. Deux faits l'ont éteint : `tracks` et
      `channels` existent depuis `CRM-020` et `CRM-021`, et l'option 1 d'INC-013 — rattacher chaque
      fonction à l'unité qui livre sa table — est devenue inapplicable, ces unités étant livrées.
      **`app.can_read_card` reste différée** pour la raison d'origine : `cards` n'existe pas.
- [x] `supabase/migrations/0010_droits_fins.sql` : sept fonctions, les politiques de lecture de
      `tracks` et `channels` resserrées, et **huit politiques** sur les deux tables de droits fins.
- [x] **La jointure est externe, et l'inverse eût été un refus par défaut** (décision 104). Une
      jointure interne rendrait `NULL` dans le cas le plus courant — l'appelant n'a aucun droit fin
      — et fermerait le produit là où la spécification le veut **hérité**. Les deux cas sont **deux
      assertions distinctes** ; la seconde seule aurait été verte avec une jointure interne.
- [x] **UN DÉFAUT RÉEL, INTRODUIT PAR CETTE UNITÉ ET TROUVÉ PAR LES PREUVES DE `CRM-020`**
      (décision 107) : la politique de lecture relisait `tracks`, et le `RETURNING` d'un `INSERT`
      étant soumis à la politique `SELECT`, **toute création de track ou de channel par un
      administrateur rendait `403`**. Une fonction `STABLE` ne voit pas la ligne que l'instruction
      en cours vient d'écrire. Corrigé à la racine — les politiques évaluent les colonnes de la
      ligne — plutôt que par un `VOLATILE` qui aurait masqué la cause. Règle générale écrite au
      §3.5, régression figée par **quatre** assertions.
- [x] **UN SECOND DÉFAUT, DANS LA SPÉCIFICATION CETTE FOIS** (décision 106) : le §4.1 annonçait un
      refus de suppression ; MESURÉ, le `USING` d'une politique `for delete` **filtre** — la
      commande réussit, rien n'est supprimé, aucune erreur n'est levée. Un test qui constaterait
      l'absence d'erreur serait vert que la règle tienne ou qu'elle ait été retirée. Le contrat est
      corrigé et le refus se prouve désormais en **relisant la ligne**.
- [x] **Deux effets de bord révélés par un seed non vide** (décision 108) : `T6` et `C6` des
      scénarios d'API supprimaient par prédicat des lignes de droits fins qu'ils n'avaient pas
      créées et **amputaient le seed** à chaque exécution ; et `scripts/verify-tracks.sh`
      réappliquait `0003_tracks.sql` seule, ramenant la politique à sa version sans droits fins et
      **laissant le produit dégradé**. Les deux sont corrigés, la dépendance d'ordre entre `0003`,
      `0004` et `0010` est inscrite dans `docs/PROD_MIGRATIONS.md` §3.
- [x] **Test unitaire dédié** : `supabase/tests/0011_droits_fins.test.sql`, **71 assertions, aucune
      anomalie** — forme des sept fonctions, matrice appliquée à des lignes réelles, réouverture
      d'un channel sous un track fermé, administrateur non restreint, politiques des deux tables de
      droits fins, privilèges, et `insert … returning`.
- [x] **Test d'intégration dédié, hors interface** : `e2e/api/droits-fins.spec.ts`, **15
      scénarios**, avec les jetons réels des trois profils seedés. Les treize lignes du contrat
      d'API du §4.2 y sont rejouées.
- [x] **Preuves de refus n° 3, 4 et 11 acquises** au niveau des tracks et des channels : membre du
      workspace A lisant B → zéro ligne ; `access = 'none'` → zéro ligne, sur le track **et** sur
      ses channels ; anonyme → zéro ligne sur les quatre tables concernées. Le refus est mesuré
      comme **zéro ligne**, jamais comme une erreur.
- [x] **Seed repris dans le même changement** : quatre droits fins, un par situation de la matrice,
      dont un posé sur l'administratrice pour que « un administrateur n'est jamais restreint » soit
      démontré en permanence et non seulement dans une suite de tests.
- [x] **Build vert**, `npm run typecheck` vert sur les quatre projets, `npm run types:check` vert.
      `npm run test:sql` **789 assertions**, `npm run test:unit` **164 tests**, `npm run e2e:api`
      **167 scénarios**, `npm run e2e:ui` **37 scénarios** — ce dernier au prix du contournement
      récurrent d'INC-036.
- [x] **Aucune régression** : les dix-sept harnais précédents rejoués — `verify-stack`,
      `verify-migrations`, `verify-authz`, `verify-seed`, `verify-tracks`, `verify-channels`,
      `verify-catalogue`, `verify-workflows`, `verify-copie-workflow`, `verify-coherence-workflow`,
      `verify-champs-formulaire` —, aucune anomalie. `scripts/verify-droits-fins.sh` :
      **42 contrôles, aucune anomalie**.
- [x] Harnais de preuves rejouable `scripts/verify-droits-fins.sh`, **non complaisant, éprouvé par
      trois dégradations réelles** — politique revenue à `is_workspace_member`, jointure interne,
      lecture des droits fins ouverte à tout membre. Chacune fait passer une lecture qui doit être
      refusée, et la restauration est **constatée**.
- [x] **Neuf assertions figées par des unités précédentes ont échoué comme prévu, et ont été
      révisées** (mécanisme de la décision 51, huitième et neuvième occurrences) : dans
      `0001`, `0002`, `0003`, `0004`, `0005`, et dans `verify-authz.sh`, `verify-tracks.sh`,
      `tracks.spec.ts`, `channels.spec.ts`. **Aucune n'a été retirée** : elles sont retournées ou
      restreintes aux trois tables d'identité, qui restent le sujet d'INC-014.
- [x] `docs/SPEC-permissions-rls.md`, `docs/SCHEMA.md` §1 et §9, `docs/SPEC-tracks.md` §5.3,
      `docs/SPEC-channels.md` §6.3, `docs/SPEC-seed.md` §2.11, `docs/DAT.md` §7,
      `docs/PROD_MIGRATIONS.md` §3 (migration 10), `docs/manual.md` §3.2 quater, `CHANGELOG.md`
      mis à jour dans le même changement.
- [ ] **Aucun écran, aucune capture, aucun test E2E d'interface.** La webapp reste un appelant
      **anonyme** faute d'écran de connexion — **INC-021, en attente d'arbitrage**. Un droit fin est
      par construction invisible à un anonyme, qui n'a déjà aucun accès : il n'existe **aucune**
      vérification visuelle sensée à produire pour cette unité tant que l'arbitrage n'est pas rendu.
      Les règles sont livrées et prouvées **en base et par l'API**, ce que `CLAUDE.md` §10 exige de
      toute façon. **Cette preuve est bloquée par un arbitrage, pas par un défaut de l'unité.**
- [ ] **Preuve de refus n° 7 non acquise** : « lecture du compte mail d'un autre utilisateur »
      exige `mail_inbound_accounts`, livrée au chunk 4 (`CRM-052`). La Definition of Done la
      nommait ; elle n'était pas satisfaisable à cette place du plan.
- [ ] **`app.can_read_card` non livrée**, et la preuve n° 4 **au niveau des cards** avec elle :
      `cards` arrive à `CRM-040`. INC-013 reste ouverte pour ce seul point, et pour la Definition
      of Done de `CRM-010`, qui nomme six fonctions dont quatre lui échappent désormais.
- [ ] **Les politiques des tables d'identité ne sont pas écrites** : `profiles`, `workspaces` et
      `workspace_members` restent en refus par défaut. Aucune unité du backlog ne les porte, ni la
      preuve n° 10 — **INC-014, arbitrage attendu**. Se les attribuer aurait été confortable, cette
      unité touchant déjà aux politiques ; c'eût été décider à la place du responsable.

*DoD adaptée, écarts explicites.* La Definition of Done demandait « pgTAP sur la matrice de
résolution ; preuves de refus n° 3, 4, 7 et 11 ». La première est livrée, largement au-delà — la
matrice est éprouvée sur des lignes réelles, ce que `CRM-010` ne pouvait pas faire. Les preuves
n° 3, 4 et 11 sont acquises **au niveau des tracks et des channels** ; la n° 7 et la n° 4 au niveau
des **cards** ne l'étaient pas à cette place du plan, et l'absence est nommée plutôt que compensée
par une preuve de substitution.

*Limites nommées, non masquées.*

- **Aucun écran.** Neuvième unité consécutive à buter sur INC-021.
- **Une exception restrictive posée avant cette migration devient opposable au moment où elle est
  appliquée**, sans autre signal. Aucune ligne n'existe sur les bases du projet hors du seed, mais
  le contrôle à exécuter avant tout déploiement est écrit dans `docs/PROD_MIGRATIONS.md` §3.
- **La lecture d'un droit fin est réservée à l'administration et à l'intéressé.** C'est un choix de
  produit, réversible, soumis à arbitrage en **INC-045**.
- **`app.can_write_channel` est livrée sans usage** : aucune table fille de `channels` n'existe
  encore. Elle est prouvée par la suite pgTAP, elle ne gouverne aujourd'hui aucune politique. Le
  dire est plus honnête que de laisser croire l'inverse.
- **Sur l'hôte de vérification, la chaîne s'exécute sous Node 22.22.2**, alors que le dépôt exige
  Node 24. Limite héritée, inchangée.
- **Trois contournements hors dépôt ont dû être refaits**, comme les entrées correspondantes le
  prédisaient : démon Docker lancé à la main (`dockerd --host=…`), image `webapp` construite avec
  le certificat du proxy (INC-032, INC-042), et `npm ci` précédé d'un `npm config set cafile`.

### CRM-013 — Colonnes protégées `[ ]`
`REVOKE` sur `secret_id`, `token_hash` ; `current_step_id` et `email_local_part` non modifiables
directement ; `card_events` et `audit_log` en écriture par trigger uniquement.

- [ ] **PARTIELLEMENT DÉBLOQUÉE PAR `CRM-040`.** Deux de ses six cibles existent désormais :
      `cards.current_step_id` et `cards.email_local_part`, toutes deux **modifiables**, ce que deux
      assertions de `supabase/tests/0012_cards.test.sql` §11 constatent explicitement et qui
      deviendront rouges quand cette unité sera livrée. Les quatre autres — `mail_inbound_accounts`,
      `mail_outbound_identities`, `api_tokens`, `card_events`, `audit_log` — restent absentes
      (chunks 4 et 5).
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
- [x] Harnais de preuves rejouable `scripts/verify-harness.sh` : **25 contrôles, aucune anomalie**,
      et **non complaisant, éprouvé par sept dégradations réelles** — une assertion fausse dans une
      suite pgTAP réelle, un plan non tenu **sans** `finish()`, une erreur SQL, une **politique RLS
      permissive réellement posée** sur `workspaces`, un test unitaire volontairement faux, et une
      suite au **plan tenu ligne pour ligne mais tronquée pour pgTAP**. Chacune doit faire échouer
      la commande correspondante.
- [x] **Un faux vert réel de l'exécuteur trouvé, reproduit et corrigé** (décision 79, protocole
      `CLAUDE.md` §18). pgTAP tient **deux** comptes : la numérotation des lignes, portée par une
      séquence que rien n'annule, et le compte relu par `finish()`, porté par une table qu'un
      `rollback to savepoint` annule. Une suite dont les **dernières** assertions sont prises dans
      un savepoint annulé émet donc exactement autant de lignes que son plan en annonce.
      **Mesuré en déposant le fichier dans `supabase/tests/`** : l'exécuteur affichait « 1 fichiers,
      3 assertions, aucune anomalie » et sortait en `0`, alors que pgTAP annonçait « planned 3 but
      ran 1 » et que les **deux dernières preuves n'avaient pas été enregistrées**. C'est le mode de
      défaillance silencieux que `docs/SPEC-test-harness.md` §3.1 énumère depuis l'ouverture de
      l'unité, et il visait cette fois l'exécuteur lui-même.
      **Correction** : un **cinquième contrôle** au contrat du §3.2 — tout diagnostic
      `# Looks like you planned` fait échouer le fichier. Il ne double pas le quatrième : celui-ci
      compare le plan aux lignes **émises**, le nouveau au compte **enregistré**. La régression est
      figée par la dégradation 9.6 du harnais, écrite en deux temps — elle constate d'abord que la
      suite piégée **émet bien** ses trois lignes, sans quoi c'est le quatrième contrôle qui la
      refuserait et le cinquième ne prouverait rien.
- [x] **La cause que la décision 76 avait laissée ouverte est élucidée.** Elle notait que les
      suites `0002`, `0004`, `0005` et `0006` employaient des savepoints en restant vertes, et que
      « la différence n'a pas été élucidée ». Elle tient à la **position du dernier `rollback`** :
      toute assertion exécutée après lui remet les deux comptes d'accord, et ces quatre suites se
      terminent hors savepoint. Le §3.2 porte désormais la contrainte d'écriture qui en découle.
- [x] **Aucune suite livrée n'était concernée**, vérifié fichier par fichier avant correction :
      les sept sont vertes, plan tenu, **aucun diagnostic** émis. Le contrôle ajouté ne corrige rien
      aujourd'hui ; il empêche demain un vert qui ne vaudrait rien.
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
- [x] **Rejoué intégralement sur `main` après intégration** (décision 71). Cette unité avait été
      poussée sur une branche parallèle, donc sur un socle qui ignorait le correctif d'idempotence
      de `CRM-021` (décision 64). Elle a été reportée sur `main`, puis **toutes ses preuves
      réexécutées sur ce socle**, sans quoi le vert mesuré ailleurs n'aurait rien prouvé ici :
      `scripts/verify-catalogue.sh` **36 contrôles, aucune anomalie**, et les **douze harnais
      précédents** — 33, 38, 23, 26, 26, 42, 49, 30, 41, 22, 43 et **30** contrôles, soit **439**
      au total. Le douzième vaut 30 et non 28 : `CRM-021` lui a ajouté deux contrôles sur `main`
      entre-temps, ce que le décompte ci-dessus ne pouvait pas connaître.
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

### CRM-031 — Workflows, étapes, transitions `[~]`
Éditeur d'administration ; workflow par défaut du seed conforme au graphe spécifié.
**DoD** : pgTAP (étape initiale unique, unicité `(workflow, nœud)`, transitions distinctes) ;
E2E de création ; captures de l'éditeur.

- [x] **Spécification écrite avant tout code**, `docs/SPEC-workflow-engine.md` §3 réécrit : le
      chapitre tenait en vingt-six lignes, datait de `CRM-000` et n'engageait que l'intention. Il
      ne disait ni comment « exactement une étape initiale » serait garantie, ni ce qui empêche une
      transition de sortir de son workflow, ni ce qu'une étape a le droit de surcharger, ni ce que
      l'API doit rendre à chacun des trois rôles. Rédigé **après mesure** sur trois tables sondes
      jetables, créées puis détruites, l'absence de reste étant constatée. Commit documentaire
      dédié.
- [x] `supabase/migrations/0006_workflows.sql` : les trois tables, la cohérence de portée
      `scope` / `track_id`, l'unicité du workflow par défaut **par workspace**, l'unicité
      `(workflow, nœud)`, l'index unique partiel de l'étape initiale, **quatre clés étrangères
      composites** — celles qui enferment une transition dans son workflow et celles qui rendent
      les `workspace_id` dénormalisés véridiques —, le trigger d'ordre dans la portée du workflow,
      **neuf politiques RLS** et les privilèges explicites.
- [x] **Test unitaire dédié** : `supabase/tests/0007_workflows.test.sql`, **106 assertions, aucune
      anomalie** — structure des trois tables, bornes des surcharges, cohérence de portée,
      dérivation, unicités, cascades, ordre, politiques, privilèges, et les autorisations éprouvées
      contre quatre comptes réels avec les revendications JWT simulées comme PostgREST les pose.
- [x] **« Exactement une étape initiale » : la moitié imposable est imposée, l'autre est nommée**
      (décision 72). Mesuré sur une sonde : un `constraint trigger` différé accepte l'insertion
      isolée d'un workflow puis **fait échouer le `commit`** — il rendrait la création d'un workflow
      impossible par l'API, une requête PostgREST valant une transaction. La base garantit « au plus
      une » ; « au moins une » devient une condition d'emploi, vérifiée par `CRM-033` et `CRM-040`,
      et fournie par le seed. Un workflow sans étape initiale est un **brouillon**, écrit au §3.5
      plutôt que découvert par le premier éditeur.
- [x] **Une transition ne sort pas de son workflow, et c'est structurel** (décision 73) : clés
      étrangères composites `(step_id, workflow_id)`, refus mesuré en `23503`. Elles exigent une
      unicité `(id, workflow_id)` sans laquelle leur création échoue en `42830` — mesuré aussi.
- [x] **Une mesure a démenti une attente, et l'assertion l'a établie** : une ligne qui viole à la
      fois une contrainte de valeur et une unicité est refusée par la **contrainte de valeur**
      (`23514`), non par l'unicité. L'assertion, d'abord écrite en `23505`, a échoué — et c'est cet
      échec qui a fixé le fait.
- [x] **Le comptage de pgTAP mesuré, et l'écriture de la suite adaptée** : une assertion exécutée
      dans un savepoint ensuite annulé est **numérotée mais non comptée**, de sorte que le plan
      n'est jamais tenu et que `scripts/run-sql-tests.sh` refuse la suite. Les blocs d'autorisation
      n'annulent donc rien : ils rendent la main au superutilisateur et défont explicitement leurs
      écritures.
- [x] **Test d'intégration dédié, hors interface** : `e2e/api/workflows.spec.ts`, **21 scénarios**,
      avec les jetons réels des trois profils. Les seize lignes du contrat d'API de
      `docs/SPEC-workflow-engine.md` §3.8 y sont rejouées.
- [x] **Preuves de refus n° 2, n° 3 et n° 11 acquises au niveau des workflows** : un
      `business_developer` ne crée, ne renomme et ne supprime rien — la ligne étant **relue
      inchangée**, un refus par le `USING` ne levant aucune erreur ; un membre de A ne voit aucun
      workflow de B, la ligne de B étant d'abord constatée présente avec la clé de service ;
      l'anonyme obtient `200` et `[]` sur les trois tables.
- [x] **La suppression est ouverte aux étapes et aux transitions, et à elles seules** (décision 74),
      seul endroit du produit livré où un client peut supprimer une ligne. Un workflow, lui, est
      refusé en `403` **par le privilège**, avant même la politique, et s'archive à la place.
- [x] **Seed mis à jour dans le même changement** : le workflow du §3.9, ses sept étapes — dont une
      initiale et deux surcharges sur deux colonnes différentes — et ses dix transitions, dont
      **quatre exigeant un commentaire**, créés par la véritable API REST, convergents. L'absence de
      `Réalisation → Perdu` est vérifiée comme le reste.
- [x] **INC-029 levée pour la clé étrangère** : `channels.workflow_id` est enfin référencée, et de
      façon **composite** ; les six channels du seed sont rattachés au workflow par défaut. La
      contrainte `NOT NULL` **reste due par `CRM-033`**, qui porte le contrat de création d'un
      channel qu'elle modifierait. L'entrée est mise à jour, non close.
- [x] Harnais de preuves rejouable `scripts/verify-workflows.sh` : **47 contrôles, aucune
      anomalie** — 40 hors suites Playwright et build (`--rapide`) —, et **non complaisant, éprouvé
      par quatre dégradations réelles** : politique d'écriture relâchée, index de l'étape initiale
      retiré, transition du seed supprimée, et **clé composite remplacée par une clé simple du même
      nom**. Chacune fait sortir le harnais en code `1`, et la restauration est **constatée** —
      index revenu, dix transitions revenues, politique revenue à `is_workspace_admin`, clé
      composite **réparée**, refus de nouveau opposé au `business_developer`.
- [x] **DÉFAUT RÉEL TROUVÉ PAR L'EXÉCUTION PARALLÈLE, ET CORRIGÉ ICI** (décision 78) : les douze
      contraintes nommées de la migration étaient posées en `if not exists (… where conname = …)`,
      donc **idempotentes sans être convergentes**. Une clé composite remplacée à la main par une
      clé simple portant le même nom survivait à tous les rejeux — la garantie la plus structurante
      de l'unité était perdue et rien ne le signalait. C'est le **contrôle de restauration** de la
      quatrième dégradation qui l'a établi, en échouant. Un mécanisme unique compare désormais la
      définition réelle à la définition attendue pour les douze contraintes, et la fonction
      d'assistance est retirée en fin de migration.
- [x] **Les treize harnais précédents rejoués sur ce socle** — 33, 38, 23, 26, 42, 26, 49, 30, 41,
      22, 40, 23 et 29 contrôles, soit **422** au total —, aucune anomalie.
- [x] **Intégration d'une exécution parallèle, et rejeu intégral sur ce socle** (décision 78, qui
      applique la décision 66). Deux exécutions de la routine ont livré cette unité en parallèle à
      partir du même commit de spécification. L'implémentation **déjà poussée fait foi** et est
      celle retenue ici ; le travail parallèle est conservé sous
      `travail-crm031-parallele-um0mbt`, sans être poussé, et **seul le défaut ci-dessus** en est
      reporté. Toutes les preuves ont été **réexécutées sur ce socle** après intégration, sans quoi
      le vert mesuré ailleurs n'aurait rien prouvé ici.
- [x] **Quatre garde-fous figés par des unités précédentes ont échoué comme prévu, et ont été
      révisés** : trois assertions pgTAP de `CRM-021` (INC-029), deux de `CRM-030` (INC-031), le
      contrôle n° 5 de `scripts/verify-catalogue.sh`, celui du seed de `scripts/verify-channels.sh`,
      un scénario d'API de `CRM-021`, une assertion de type, et les compteurs de
      `scripts/verify-harness.sh` (454 / 75 / 37 → **559 / 96 / 37**, le compteur d'interface
      **inchangé**, cette unité ne livrant aucun écran). Le mécanisme de la décision 51 a fonctionné
      une quatrième fois.
- [x] **Huit assertions de type ajoutées** pour figer le contrat des trois tables, dont la quatrième
      occurrence d'INC-027 et le constat qu'aucune relation ne part de `require_fields`.
- [x] **Build vert**, `npm run typecheck` vert sur les quatre projets, `npm run types:check` vert.
      `npm run test:sql` **559 assertions**, `npm run test:unit` **164 tests**, `npm run e2e:api`
      **96 scénarios**, `npm run e2e:ui` **37 scénarios** — ce dernier inchangé.
- [x] **Aucune régression** : les treize harnais précédents rejoués — **33, 38, 23, 26, 26, 42, 49,
      30, 41, 22, 40, 23 et 29 contrôles**, aucune anomalie. Les trois derniers — tracks, channels,
      catalogue — l'ont été en `--rapide`, leurs suites Playwright et leur build étant déjà couverts
      par le harnais de cette unité ; les dix autres n'ont pas de mode rapide et ont été rejoués
      intégralement.
- [x] `docs/SPEC-workflow-engine.md` §3 (réécrit), §9, `docs/SCHEMA.md` §2 et §3,
      `docs/SPEC-permissions-rls.md` §4, `docs/SPEC-seed.md` §2.8 et §8, `docs/DAT.md` §7 et §8,
      `docs/PROD_MIGRATIONS.md` §3, `docs/manual.md` chapitre 20 et §3.2, `README.md`,
      `CHANGELOG.md` mis à jour dans le même changement.
- [ ] **Aucun éditeur d'administration, aucun E2E de création par l'interface, aucune capture.**
      La Definition of Done les exige. Ils supposent un écran d'administration authentifié, et la
      webapp reste un appelant **anonyme** faute d'écran de connexion — **INC-021, en attente
      d'arbitrage**. Le CRUD est livré et prouvé **par l'API**, ce que `CLAUDE.md` §10 exige de toute
      façon. **Cette preuve est bloquée par un arbitrage, pas par un défaut de l'unité.**
- [ ] **La contrainte `NOT NULL` de `channels.workflow_id` n'est pas posée** (INC-029, ci-dessus) :
      elle revient à `CRM-033`. **Bloquée par une frontière d'unité, pas par un défaut.**

*DoD adaptée, écarts explicites.* La Definition of Done exige un « E2E de création » et des
« captures de l'éditeur ». Aucun n'est livré, et aucun ne pouvait l'être : cette unité ne livre ni
écran ni parcours, l'éditeur étant suspendu à INC-021. Ses preuves sont unitaires (pgTAP) et
d'intégration (PostgREST, jetons réels, hors interface). **Aucune vérification visuelle** pour la
même raison — et non parce qu'elle aurait été omise. Les deux captures réécrites par le rejeu des
suites d'interface ont été **regardées puis restaurées** : elles montraient un survol laissé par le
pilote Playwright, artefact non déterministe déjà relevé lors de l'intégration de `CRM-030`.

*Limites nommées, non masquées.*

- **Aucun écran.** Cinquième unité consécutive du chunk 3 à buter sur INC-021.
- **« Au moins une étape initiale » n'est pas garantie par la base**, et ne peut pas l'être sans
  rendre la création d'un workflow impossible par l'API (décision 72). Un workflow brouillon est un
  état légitime du produit, à traiter par `CRM-033` et `CRM-040`.
- **`require_fields` ne portera jamais d'intégrité référentielle** : INC-033, ouverte, trois options
  d'arbitrage avant `CRM-036`.
- **La garde d'archivage d'un nœud occupé reste due** : `workflow_steps` existe désormais, `cards`
  non (INC-031). L'option 2 de l'arbitrage — limiter la garde à l'occupation par une étape — n'a pas
  été adoptée : elle est plus stricte que la règle spécifiée.
- **Aucune détection de cycle, aucune limite de taille** : un workflow peut porter autant d'étapes
  et d'arêtes que voulu, et les cycles sont **voulus**.
- **Aucune RPC de réordonnancement** : réordonner un board, c'est écrire `position` étape par étape.
  Le besoin apparaîtra avec l'éditeur.
- **Sur l'hôte de vérification, la chaîne s'exécute sous Node 22.22.2**, alors que le dépôt exige
  Node 24 — exercé dans le conteneur `webapp` depuis `CRM-007`. Limite héritée, inchangée.

### CRM-032 — Copie d'un workflow vers un track `[~]`
`copy_workflow_to_track` avec traçabilité d'origine et signalement de divergence.
**DoD** : pgTAP (copie complète des étapes, transitions et champs ; lignage renseigné) ; E2E ;
mention de divergence visible dans l'interface.

- [x] **Spécification écrite avant tout code**, `docs/SPEC-workflow-engine.md` §4 réécrit : le
      chapitre tenait en vingt-cinq lignes, datait de `CRM-000` et n'engageait qu'une signature et
      une intention. Il ne disait ni qui a le droit de copier, ni ce qu'un refus rend, ni ce qui
      arrive à `is_default`, ni comment une arête retrouve ses extrémités dans la copie, ni d'où
      sortirait la date du « modifié depuis ». Rédigé **après mesure** sur la pile réelle — copie
      appliquée à la main dans une transaction annulée, codes HTTP relevés contre PostgREST avec le
      jeton réel de l'administrateur, sondes créées puis détruites et l'absence de reste constatée.
      Commit documentaire dédié.
- [x] Six décisions consignées (`docs/JOURNAL.md`, décisions 80 à 85) et **trois contradictions
      relevées sans être résolues** : INC-037 (la DoD exige la copie de champs dont la table arrive
      à `CRM-035`), INC-038 (le signal de divergence ne voit pas une suppression dans la source),
      INC-039 (la suppression d'un workspace échoue quand un workflow instancie ses nœuds).
- [x] `supabase/migrations/0007_copie_workflow.sql` : la fonction
      `public.copy_workflow_to_track(workflow_id, track_id, new_name)`, ses **quatre refus**, le
      remappage des arêtes par le nœud, la vue `public.workflow_derivations` en
      `security_invoker`, et les privilèges posés **en nommant les rôles**.
- [x] **Un défaut d'origine de l'image trouvé par la mesure, et corrigé ici** (décision 80) :
      `revoke all … from public` ne protège **rien** dans le schéma `public`. L'image livre des
      `ALTER DEFAULT PRIVILEGES` qui accordent nommément à `anon` l'exécution de toute fonction
      nouvelle et **tous** les droits de toute vue nouvelle. Mesuré en appelant la fonction
      « protégée » avec la clé anonyme : l'appel **a réussi**. La révocation nomme désormais les
      rôles, et le contrôle 7.b du harnais rend le défaut impossible à réintroduire en silence.
- [x] **Test unitaire dédié** : `supabase/tests/0008_copie_workflow.test.sql`, **63 assertions,
      aucune anomalie** — forme de la fonction et de la vue, privilèges, contenu de la copie,
      remappage des arêtes, surcharges et positions fractionnaires préservées, `is_default` forcé,
      lignage, les quatre refus éprouvés contre quatre comptes réels, et le signal de divergence
      allumé puis éteint.
- [x] **Le contrat d'API des codes HTTP est mesuré, non déduit** (décision 81) : `P0001` → `400`,
      `P0002` → **`500`**, `42501` → `403`, `23505` → `409`. `P0002`, le code le plus naturel pour
      « rien ne correspond », étant rendu comme une erreur serveur, il est écarté. Le `404` propre
      qu'un `SQLSTATE` conventionnel `PGRST` permettrait est écarté aussi, et le motif est écrit :
      une fonction SQL qui connaît les codes HTTP de son client cesse d'être portable.
- [x] **La règle de discrétion est prouvée dans les deux sens** (décision 82) : un workflow d'un
      **autre** workspace — d'abord **constaté présent** avec la clé de service — rend
      `workflow_not_found`, exactement comme un identifiant inventé ; un membre non administrateur
      de son propre workspace obtient `forbidden`. L'ordre des contrôles est lui-même éprouvé par
      une assertion dédiée.
- [x] **Test d'intégration dédié, hors interface** : `e2e/api/copie-workflow.spec.ts`, **14
      scénarios**, avec les jetons réels des trois profils. Les seize lignes du contrat d'API de
      `docs/SPEC-workflow-engine.md` §4.9 y sont rejouées.
- [x] **Preuves de refus n° 2, n° 3 et n° 11 acquises au niveau de la copie** : un
      `business_developer` et un `viewer` sont refusés en `403 forbidden` et **aucune ligne n'est
      créée** — constaté avec la clé de service ; un administrateur du workspace B ne voit aucune
      ligne de la vue ; l'anonyme obtient `200` et `[]` sur `workflow_derivations`, et **`401`** sur
      la RPC, refusé par le privilège avant tout contrôle.
- [x] **Seed mis à jour dans le même changement**, et par la **véritable route** : la copie du
      §4.10 est créée par l'appel RPC réel, avec le jeton de l'administrateur seedé obtenu par la
      vraie route de connexion — la clé de service n'a pas de `sub`, et l'appel serait refusé par
      `workflow_not_found`. Convergent : un second passage ne recrée rien.
- [x] **L'identifiant de la copie n'est pas stable, et le fait est nommé** (`docs/SPEC-seed.md`
      §2.9) : il est frappé par la fonction. Le rendre stable supposerait un paramètre ajouté pour
      le seul confort du seed — une API façonnée par ses tests. C'est le prix assumé de la règle
      « la donnée de démonstration naît du mécanisme réel ».
- [x] Harnais de preuves rejouable `scripts/verify-copie-workflow.sh` : **33 contrôles, aucune
      anomalie** — 26 hors suites Playwright et build (`--rapide`) —, et **non complaisant, éprouvé
      par trois dégradations réelles** : contrôle du rôle retiré de la fonction, privilège rendu à
      `anon`, et vue repassée en `security_definer`. Chacune fait sortir le harnais en code `1`, et
      la restauration est **constatée** — privilège retiré, vue revenue à `security_invoker`, une
      seule copie du seed, et le contrôle du rôle revenu dans la définition de la fonction.
- [x] **Six garde-fous figés par des unités précédentes ont échoué comme prévu, et ont été
      révisés** : deux assertions de type de `CRM-006` (« aucune vue », « aucune fonction »),
      resserrées sur ce qui est livré plutôt que supprimées ; deux scénarios d'API de `CRM-031` qui
      comptaient « un workflow, ni plus ni moins » ; deux contrôles de
      `scripts/verify-workflows.sh`, resserrés sur « un workflow **global** » et sur les étapes du
      workflow par défaut ; et les compteurs de
      `scripts/verify-harness.sh` (559 / 96 / 37 → **622 / 110 / 37**, le compteur d'interface
      **inchangé**, cette unité ne livrant aucun écran). Le mécanisme de la décision 51 a fonctionné
      une cinquième fois.
- [x] **Build vert**, `npm run typecheck` vert sur les quatre projets, `npm run types:check` vert.
      `npm run test:sql` **622 assertions**, `npm run test:unit` **164 tests**, `npm run e2e:api`
      **110 scénarios**, `npm run e2e:ui` **37 scénarios** — ce dernier inchangé.
- [x] **Aucune régression** : les treize harnais précédents rejoués — **33, 38, 23, 26, 42, 26, 49,
      30, 41, 40, 23, 29 et 25 contrôles**, aucune anomalie. Les trois derniers — tracks, channels,
      catalogue — l'ont été en `--rapide`, leurs suites Playwright et leur build étant déjà couverts
      par le harnais de cette unité.
- [x] `docs/SPEC-workflow-engine.md` §4 (réécrit), `docs/SCHEMA.md` §9 et §9.1 (nouveau),
      `docs/SPEC-seed.md` §2.9, `docs/DAT.md` §7 et §8, `docs/PROD_MIGRATIONS.md` §3,
      `docs/manual.md` chapitre 21 et §3.2, `README.md` §5, `CHANGELOG.md` mis à jour dans le même
      changement.
- [ ] **Aucun écran, aucune mention de divergence affichée, aucune capture.** La Definition of Done
      exige que la divergence soit « visible dans l'interface ». Elle suppose un écran
      d'administration authentifié, et la webapp reste un appelant **anonyme** faute d'écran de
      connexion — **INC-021, en attente d'arbitrage**. Ce qui est livré est la **donnée** qui
      porterait cette phrase, prouvée par l'API. **Cette preuve est bloquée par un arbitrage, pas
      par un défaut de l'unité.**
- [ ] **La copie des champs de formulaire n'est pas livrée.** `form_fields` arrive à `CRM-035` —
      mesuré, `to_regclass` nul. **Bloquée par une frontière d'unité**, INC-037, dont l'arbitrage
      est attendu avant `CRM-035`. L'absence est figée par une assertion `hasnt_table`.

*DoD adaptée, écarts explicites.* La Definition of Done exige un « E2E » et une « mention de
divergence visible dans l'interface ». Aucun n'est livré, et aucun ne pouvait l'être : cette unité
ne livre ni écran ni parcours, l'éditeur étant suspendu à INC-021. Ses preuves sont unitaires
(pgTAP) et d'intégration (PostgREST, jetons réels, hors interface). **Aucune vérification visuelle**
pour la même raison — et non parce qu'elle aurait été omise. Les quatre captures réécrites par le
rejeu des suites d'interface ont été **regardées puis restaurées** : elles montraient un survol
laissé par le pilote Playwright, artefact non déterministe déjà relevé lors de `CRM-030` et de
`CRM-031`.

*Limites nommées, non masquées.*

- **Aucun écran.** Sixième unité consécutive du chunk 3 à buter sur INC-021.
- **Le signal de divergence ne voit pas une suppression** dans la source : INC-038, ouverte, trois
  options d'arbitrage. L'angle mort est **mesuré** et figé par une assertion qui deviendra rouge le
  jour où il sera corrigé.
- **Rien n'interdit deux copies du même workflow sur le même track.** Aucune unicité ne le refuse,
  et aucune n'est inventée : la spécification ne dit pas qu'une seconde copie serait une erreur.
  C'est le seed qui converge, en vérifiant avant d'agir.
- **La suppression d'un workspace échoue** dès qu'un workflow instancie ses nœuds : INC-039,
  ouverte. Contournement — supprimer les étapes d'abord — appliqué par le harnais et figé par une
  assertion.
- **Sur l'hôte de vérification, la chaîne s'exécute sous Node 22.22.2**, alors que le dépôt exige
  Node 24 — exercé dans le conteneur `webapp` depuis `CRM-007`. Limite héritée, inchangée.
- **Les preuves d'interface n'ont pu être rejouées qu'au prix d'un contournement hors dépôt**
  (INC-036) : les navigateurs préinstallés de l'environnement ne correspondent pas au Playwright
  épinglé, et une arborescence de compatibilité a dû être recréée. Même nature qu'INC-032, dont le
  contournement a également dû être refait pour démarrer la pile.

### CRM-033 — Cohérence workflow ↔ channel `[~]`
Trigger : workflow `global` du workspace, ou `track` du track du channel.
**DoD** : pgTAP sur les trois cas (global accepté, track du même track accepté, track étranger
refusé) ; refus constaté aussi lors d'un déplacement de channel.

- [x] **Spécification écrite avant tout code**, `docs/SPEC-workflow-engine.md` §4.12 réécrit en huit
      sous-chapitres : le chapitre tenait en dix lignes, datait de `CRM-000` et n'engageait qu'une
      intention. Il ne disait ni sur quelles colonnes le trigger se déclenche, ni ce qu'un refus rend,
      ni ce qui arrive lorsque le workflow désigné est introuvable, ni ce que la contrainte `NOT NULL`
      change au contrat de création d'un channel. Rédigé **après mesure** sur la pile réelle — quatre
      écritures appliquées sur la base du seed, trigger sonde posé sur `channels` puis détruit et son
      absence constatée (`to_regprocedure` nul), codes HTTP relevés contre PostgREST avec le jeton réel
      de l'administrateur. Commit documentaire dédié.
- [x] **Deux défauts trouvés par la mesure, consignés sans être résolus implicitement** : INC-040 (la
      spécification ne nommait que **deux** des **quatre** écritures qui cassent la cohérence — les
      deux autres passent par `workflows`, et l'une invalide d'un seul `UPDATE` le rattachement des six
      channels du seed) et INC-041 (le seed de `CRM-032` est **idempotent sans être convergent** : la
      copie déplacée à la main, un rejeu en crée une **seconde** — reproduit en quatre gestes).
- [x] Trois décisions consignées (`docs/JOURNAL.md`, décisions 89 à 91) : la règle est défendue des
      **deux côtés** ; le refus d'incompatibilité porte `23514` et non `P0001`, et le trigger se tait
      lorsque la clé étrangère parle mieux que lui ; `NOT NULL` est posée **sans défaut de colonne**.
- [x] `supabase/migrations/0008_coherence_workflow_channel.sql` : **deux** triggers —
      `channels_verifier_workflow` (`BEFORE INSERT OR UPDATE OF workflow_id, track_id, workspace_id`)
      et `workflows_verifier_portee_occupee` (`BEFORE UPDATE OF scope, track_id`) — et la contrainte
      `NOT NULL` sur `channels.workflow_id`. **INC-029 est soldée**, trois unités après son
      ouverture.
- [x] **Le second trigger n'était demandé par aucune Definition of Done, et la mesure l'a imposé**
      (décision 89) : deux des quatre écritures capables de casser la cohérence passent par
      `workflows`, non par `channels`. La quatrième — faire basculer le workflow par défaut de
      `global` à `track` — invalidait d'un seul `UPDATE` le rattachement des **six** channels du
      seed. Un invariant gardé d'un seul côté n'est pas un invariant.
- [x] **Test unitaire dédié** : `supabase/tests/0009_coherence_workflow_channel.test.sql`,
      **31 assertions, aucune anomalie** — forme et colonnes surveillées des deux triggers, les trois
      cas de la Definition of Done, le déplacement d'un channel, les portes 3 et 4, ce que la règle
      **n'interdit pas** (workflow `track` libre, écriture qui ne change rien), `NOT NULL` sans défaut
      de colonne, le silence du trigger devant la clé étrangère, et la conformité du seed.
- [x] **Test d'intégration dédié, hors interface** : `e2e/api/coherence-workflow.spec.ts`,
      **15 scénarios**, avec les jetons réels des profils seedés. Les treize lignes du contrat d'API
      de `docs/SPEC-workflow-engine.md` §4.12.6 y sont rejouées, chaque refus **relisant la ligne**
      pour la constater inchangée.
- [x] **La règle s'ajoute aux autorisations et ne les remplace pas** (ligne m) : un
      `business_developer` est refusé par la politique RLS **avant** que la règle ne soit évaluée.
      Sans cette preuve, un refus de rôle pourrait devenir un refus d'intégrité, qui apprendrait au
      demandeur ce que contient une base qu'il n'a pas le droit d'écrire.
- [x] **`23514` et non `P0001`** (décision 90), mesuré : les deux rendent `400`, mais le premier dit
      de quelle **nature** est le refus. Et le trigger **se tait** lorsque le workflow est
      introuvable : la clé étrangère composite rend alors `409` / `23503` en nommant la contrainte,
      et un refus inventé serait moins précis.
- [x] **Seed repris dans le même changement** : la ligne du workflow par défaut naît en section
      3 bis, **avant** les channels, que `NOT NULL` oblige à la désigner ; le `PATCH` de rattachement
      posé par `CRM-031` disparaît ; `prospection` rejoint la copie de portée `track` de son propre
      track, sans quoi le cas accepté le plus intéressant de la règle serait documenté sans être
      démontrable.
- [x] **UN DÉFAUT RÉEL DU SEED DE `CRM-032`, TROUVÉ, REPRODUIT ET CORRIGÉ ICI** (INC-041) : la copie
      était cherchée par sa source **et** son track. Le `track_id` déplacé à la main, la recherche ne
      la trouvait plus et le seed en créait une **seconde** — deux copies là où le contrat en déclare
      une, sans erreur ni avertissement. Idempotent sans être convergent, troisième forme de la
      décision 57 et la **première sur un seed**. Trois corrections : recherche par la seule
      dérivation, track et nom **ramenés** aux valeurs déclarées, copies surnuméraires supprimées.
- [x] Harnais de preuves rejouable `scripts/verify-coherence-workflow.sh` : **26 contrôles hors
      suites, aucune anomalie**, et **non complaisant, éprouvé par trois dégradations réelles** —
      trigger de `channels` retiré, trigger de `workflows` retiré, contrainte `NOT NULL` retirée.
      Chacune fait passer une écriture qui doit être refusée, et la restauration est **constatée**.
      La deuxième est celle qui compte le plus : aucune spécification ne demandait ce trigger, et
      sans elle personne ne saurait qu'il porte réellement quelque chose.
- [x] **Sept garde-fous figés par des unités précédentes ont échoué comme prévu, et ont été
      révisés** : deux assertions pgTAP d'INC-029 (`0005_channels`, `0007_workflows`), une assertion
      de type de `CRM-006` (`workflow_id` nullable → obligatoire) et la liste des colonnes exigées à
      l'insertion, deux scénarios d'API (`channels.spec.ts` C0, `workflows.spec.ts` INC-029), deux
      contrôles de `scripts/verify-workflows.sh`, un de `scripts/verify-channels.sh`, et les
      compteurs de `scripts/verify-harness.sh` (622 / 110 / 37 → **653 / 125 / 37**, le compteur
      d'interface **inchangé**, cette unité ne livrant aucun écran). Le mécanisme de la décision 51 a
      fonctionné une sixième fois. Les fixtures de channels des suites `0001` et `0005` ont dû
      recevoir un workflow : c'est le contrat de création qui change, et les tests le subissent comme
      le produit.
- [x] **Build vert**, `npm run typecheck` vert sur les quatre projets, `npm run types:check` vert
      après régénération. `npm run test:sql` **653 assertions**, `npm run test:unit` **164 tests**,
      `npm run e2e:api` **125 scénarios**, `npm run e2e:ui` **37 scénarios** — ce dernier inchangé et
      **réellement exécuté**, au prix du contournement récurrent d'INC-036.
- [x] **Aucune régression** : les harnais précédents rejoués — `verify-tracks` 40, `verify-channels`
      23, `verify-catalogue` 29, `verify-workflows` 41, `verify-copie-workflow` 26,
      `verify-harness` 25 contrôles —, aucune anomalie.
- [x] `docs/SPEC-workflow-engine.md` §4.12 (réécrit en huit sous-chapitres), `docs/SPEC-channels.md`
      §2.5, §8 et §10, `docs/SCHEMA.md` §2, `docs/SPEC-seed.md`, `docs/DAT.md`,
      `docs/PROD_MIGRATIONS.md` §3 (migration 8 et **sa vérification obligatoire**), `docs/manual.md`
      chapitre 22 et §3.2, `README.md`, `CHANGELOG.md` mis à jour dans le même changement.
- [ ] **Aucun écran, aucune capture, aucun test E2E d'interface.** Affecter un workflow à un channel
      suppose un écran d'administration authentifié, et la webapp reste un appelant **anonyme** faute
      d'écran de connexion — **INC-021, en attente d'arbitrage**. La règle est livrée et prouvée **en
      base et par l'API**, ce que `CLAUDE.md` §10 exige de toute façon. **Cette preuve est bloquée par
      un arbitrage, pas par un défaut de l'unité.**

*DoD adaptée, écarts explicites.* La Definition of Done demandait « pgTAP sur les trois cas » et
« refus constaté aussi lors d'un déplacement de channel » : les deux sont livrés, et **deux refus de
plus** que ce qu'elle demandait, la mesure ayant montré que la règle était contournable par
`workflows`. Elle ne demandait aucune preuve d'interface, et il n'y en a aucune — non par
renoncement, mais parce que cette unité ne livre ni écran ni parcours. **Aucune vérification
visuelle** pour la même raison ; les captures réécrites par le rejeu des suites d'interface ont été
**regardées puis restaurées**, comme aux trois unités précédentes.

*Limites nommées, non masquées.*

- **Aucun écran.** Septième unité consécutive du chunk 3 à buter sur INC-021.
- **Les triggers ne valident pas les lignes existantes.** Un trigger ne s'applique qu'aux écritures
  futures : une base qui porterait déjà un rattachement incohérent le conserverait sans être
  signalée. La requête de détection est écrite dans `docs/PROD_MIGRATIONS.md`, en vérification
  **obligatoire** avant d'appliquer la migration 8.
- **Aucune reprise automatique n'est écrite pour un channel sans workflow.** Choisir le workflow d'un
  channel est une décision métier, pas une valeur par défaut (décision 91). Si la production en
  portait, la migration échouerait bruyamment — comportement voulu, et documenté.
- **Rien n'interdit qu'un workflow `track` reste sans channel**, ni qu'un track porte plusieurs
  workflows `track`. Aucune unicité n'est inventée : la spécification n'en demande pas.
- **Sur l'hôte de vérification, la chaîne s'exécute sous Node 22.22.2**, alors que le dépôt exige
  Node 24. Limite héritée, inchangée.
- **Les preuves d'interface n'ont pu être rejouées qu'au prix d'un contournement hors dépôt**
  (INC-036), refait pour la troisième exécution consécutive. Le conteneur `webapp` n'a pas pu être
  construit du tout — le registre npm est atteint à travers un proxy dont le certificat n'est pas
  celui attendu par l'image ; la pile a été démarrée sans lui, ce qui est sans effet sur les preuves,
  Playwright démarrant son propre serveur. **INC-042.**

### CRM-034 — `move_card`, garde centrale `[~]`
Les six vérifications de `docs/SPEC-workflow-engine.md` §5.
**DoD** : pgTAP pour chacune des six ; preuves de refus n° 1 et 5 ; message d'erreur listant les
clés manquantes.

- [x] **INC-043 EST CLOSE, ET LE BLOCAGE A ÉTÉ LEVÉ PAR `CRM-040`.** L'unité était `[ ]` parce que
      ses six vérifications portent toutes sur des **cards**, dont la table n'existait pas. Elle
      existe depuis `CRM-040`, qui l'a nommément constaté : « `CRM-034` est désormais débloquée : sa
      cible existe ». **Aucune contrainte d'ordre de `docs/MASTER_PLAN.md` §2 n'est enfreinte** —
      celle qui compte, « `CRM-034` avant `CRM-041` », est respectée : le board n'existe pas encore.
- [x] **Spécification écrite avant tout code**, `docs/SPEC-workflow-engine.md` §5 réécrit en onze
      sous-chapitres, avec un contrat d'API de **treize lignes** rédigé avant le code pour être
      mesuré et non supposé. Commit documentaire dédié, poussé avant la première ligne de SQL.
- [x] `supabase/migrations/0012_move_card.sql` : la fonction, **cinq** de ses six vérifications, la
      remise à zéro d'`entered_step_at`, le recalcul de `position`, les privilèges de la fonction et
      **la protection de colonne** sans laquelle la garde ne garderait rien.
- [x] **La porte est fermée, et c'est la moitié de l'unité** (INC-049) : `authenticated` n'a plus
      l'`UPDATE` de table sur `cards` ; seules douze colonnes lui sont rendues nommément. MESURÉ
      avec le jeton réel de l'administratrice : `PATCH` de `current_step_id` → **`403`/`42501`**,
      `PATCH` de `description` → `204`. C'est la **preuve de refus n° 5** de
      `docs/SPEC-permissions-rls.md` §7, et sans elle les cinq vérifications ne s'appliqueraient
      qu'aux clients qui veulent bien passer par la fonction.
- [x] **Preuve de refus n° 1 acquise, et la règle de discrétion prouvée par le MÊME jeton** : le
      `viewer` obtient `forbidden` sur une card qu'il voit, et `card_not_found` sur une card d'un
      channel que le seed lui ferme. Employer deux profils différents aurait laissé planer le doute
      que l'écart vienne du profil plutôt que de la règle.
- [x] **L'ORDRE des vérifications n° 3 et n° 4 est prouvé**, et il ne se prouve pas autrement : une
      étape **du bon workflow** mais non reliée rend `transition_not_allowed`, jamais
      `step_not_in_workflow`. Si l'ordre était inversé, le client serait envoyé chercher un workflow
      là où il manque une arête.
- [x] **Test unitaire dédié** : `supabase/tests/0013_move_card.test.sql`, **73 assertions, aucune
      anomalie** — forme et privilèges de la fonction, `search_path` vide, les cinq vérifications
      **chacune dans les deux sens**, la discrétion par le même profil, les effets du succès sur une
      colonne d'arrivée **déjà peuplée**, les colonnes ouvertes une par une, le contournement refusé
      sous le rôle réel, et les écarts figés.
- [x] **Test d'intégration dédié, hors interface** : `e2e/api/move-card.spec.ts`, **26 scénarios**,
      avec les jetons réels des trois profils seedés. Les treize lignes du contrat du §5.8 y sont
      rejouées, et **chaque refus relit la ligne** pour la constater inchangée — une réponse
      d'erreur ne prouve pas qu'aucune écriture n'a eu lieu.
- [x] **Seed inchangé, et exercé** (§5.9) : le graphe de `CRM-031` fournit déjà les transitions
      déclarées, les paires non reliées et les quatre transitions à commentaire. Convergence
      **vérifiée** : le seed rejoué après cette unité reste vert, `service_role` conservant son
      `UPDATE` de table.
- [x] **Build vert**, `npm run typecheck` vert sur les quatre projets, `npm run types:check` vert
      après régénération. `npm run test:sql` **951 assertions**, `npm run test:unit` **164 tests**,
      `npm run e2e:api` **220 scénarios**, `npm run e2e:ui` **37 scénarios** — ce dernier inchangé,
      cette unité ne touchant aucun écran, et **réellement exécuté** au prix du contournement
      récurrent d'INC-036.
- [x] **Aucune régression** : les harnais précédents rejoués — `verify-migrations` 23,
      `verify-authz` 26, `verify-seed` 49, `verify-tracks` 40, `verify-channels` 23,
      `verify-catalogue` 32, `verify-workflows` 42, `verify-copie-workflow` 27,
      `verify-coherence-workflow` 26, `verify-champs-formulaire` 30, `verify-droits-fins` 35,
      `verify-cards` 37 —, aucune anomalie.
- [x] Harnais de preuves rejouable `scripts/verify-move-card.sh` : **56 contrôles, aucune
      anomalie**, et **non complaisant, éprouvé par trois dégradations réelles** — privilège de
      colonne rendu, `anon` retrouvant `EXECUTE`, et **la vérification n° 4 retirée**. Chacune fait
      passer une opération qui doit être refusée, et la restauration est **constatée**. Il prouve en
      outre la **convergence** : un `grant update on public.cards to authenticated` posé à la main —
      la porte même que l'unité ferme — est **refermé** par un rejeu de la migration.
- [x] **Quatre assertions figées par des unités précédentes ont échoué comme prévu, et ont été
      retournées** (mécanisme de la décision 51, onzième occurrence) : trois dans
      `0012_cards.test.sql` et une dans `database.types.test-d.ts`, dont celle qui annonçait
      littéralement « une fonction de plus les rendrait rouges ». **Aucune n'a été retirée** ; deux
      sont désormais plus fortes — un `lives_ok` devenu `throws_ok`, et un droit de table devenu un
      droit de colonne qui nomme ce qui est modifiable.
- [x] `docs/SPEC-workflow-engine.md` §5, `docs/SCHEMA.md` §9, `docs/SPEC-permissions-rls.md` §4.3 et
      §7, `docs/DAT.md` §5, `docs/PROD_MIGRATIONS.md` §3 (migration 12), `docs/manual.md` chapitre 4.3 et
      sommaire, `README.md`, `CHANGELOG.md` mis à jour dans le même changement. `docs/MASTER_PLAN.md`
      §3 est **inchangé** : son tableau rattache déjà les transitions à `docs/SPEC-workflow-engine.md`,
      et son exemple de commentaire `@spec` cite nommément cette unité.
- [ ] **LA VÉRIFICATION N° 6 N'EST PAS ÉCRITE — INC-047.** La Definition of Done exige « pgTAP pour
      chacune des **six** » ; cinq sont livrées. La n° 6 demande que les champs requis de l'étape
      cible soient **renseignés**, et l'ensemble renseigné n'a aucune source : `card_field_values`
      est le livrable de `CRM-036`. MESURÉ, `to_regclass` rend `NULL`. Les deux écritures possibles
      sont écartées au §5.7 — refuser toute transition dont l'ensemble exigé n'est pas vide
      interdirait les entrées en négociation, en signature et les **quatre** transitions « Marquer
      perdu », c'est-à-dire le parcours que la garde est censée garder ; prétendre vérifier sans
      vérifier est le faux vert que `CLAUDE.md` §17 proscrit. L'écart est **figé par deux
      assertions**, en pgTAP et en API, qui deviendront rouges à `CRM-036`.
- [ ] **Le message d'erreur listant les clés manquantes n'existe pas**, et c'est la conséquence
      directe du point précédent : il décrit la vérification qui n'est pas écrite, et naîtra avec
      elle. La Definition of Done le nomme ; il est dû.
- [ ] **Aucun écran, aucune capture, aucun test E2E d'interface.** Le board est `CRM-041`, et la
      webapp reste un appelant **anonyme** faute d'écran de connexion — **INC-021, en attente
      d'arbitrage**. Il n'existe **aucune** vérification visuelle sensée à produire : la garde n'a
      pas de surface. Les règles sont livrées et prouvées **en base et par l'API**, ce que
      `CLAUDE.md` §10 exige de toute façon. **Cette preuve est bloquée par un arbitrage, pas par un
      défaut de l'unité** — onzième unité consécutive à buter sur INC-021.
- [ ] **Le commentaire fourni n'est conservé nulle part — INC-048.** La vérification n° 5 l'exige,
      la fonction le contrôle, et rien ne l'écrit : `card_comments` est livrée par `CRM-043`. Un
      utilisateur qui motive une affaire perdue verra sa transition acceptée et son motif
      disparaître. Conséquence de l'ordre du plan, nommée plutôt que tue.
- [ ] **Aucun `card_event` de type `moved`** : `card_events` est due par `CRM-044`. La trace du
      déplacement n'existe pas, et **aucune cadence de relance n'est arrêtée** — aucune table n'en
      porte, aucune unité du backlog n'en prévoit.

*DoD adaptée, écarts explicites.* La Definition of Done demandait « pgTAP pour chacune des six ;
preuves de refus n° 1 et 5 ; message d'erreur listant les clés manquantes ». **Les preuves de refus
n° 1 et 5 sont acquises**, la seconde ayant exigé de livrer la protection de colonne qu'INC-049
disputait à `CRM-013`. **Cinq vérifications sur six** sont couvertes en pgTAP, largement au-delà de
ce qui était demandé — chacune dans les deux sens. **La sixième et son message n'existent pas**, et
l'absence est nommée plutôt que compensée par une preuve de substitution.

*Limites nommées, non masquées.*

- **`CRM-034` reste `[~]`** : la n° 6 manque, son message aussi, et aucune capture n'existe.
- **Trois contradictions relevées et NON résolues**, consignées pour arbitrage : INC-050 — le §5.5
  se contredit sur `email_local_part`, et le comportement est **laissé inchangé**, la colonne
  restant ouverte jusqu'à `CRM-013` ; INC-051 — la ligne i du §5.8 nomme le `bizdev`, à qui le seed
  ne ferme aucun channel, et le `viewer` l'exerce à sa place ; INC-052 — « un commentaire vide n'est
  pas un commentaire » ne refuse pas une tabulation, `btrim` à un argument ne retirant que des
  espaces.
- **`health_score` et `snoozed_until` restent jamais alimentées**, inchangé depuis `CRM-040`.
- **Sur l'hôte de vérification, la chaîne s'exécute sous Node 22.22.2**, alors que le dépôt exige
  Node 24. Limite héritée, inchangée.
- **`scripts/verify-scripts.sh` rend une anomalie préexistante et étrangère à cette unité** — « un
  port publié par un conteneur n'apparaît pas dans les ports en écoute », propriété de l'hôte de
  vérification et non du produit. Aucun fichier touché ici n'entre dans son périmètre.
- **Quatre contournements hors dépôt ont dû être refaits**, comme les entrées correspondantes le
  prédisaient : démon Docker lancé à la main, image `webapp` construite avec le certificat du proxy
  (INC-032, INC-042), `npm ci` précédé d'un `npm config set cafile` (INC-042), et l'arborescence de
  compatibilité des navigateurs Playwright (INC-036, **cinquième** occurrence).

### CRM-035 — Définition des champs `[~]`
`form_fields`, `form_field_rules`, grille champ × étape dans l'éditeur.
**DoD** : unitaire, API (écriture réservée aux administrateurs), E2E, captures de la grille.

- [x] **Spécification écrite avant tout code**, `docs/SPEC-form-composer.md` §2 et §3 réécrits en
      seize sous-chapitres : les deux chapitres dataient de `CRM-000`, tenaient en cinquante lignes
      et ne disaient ni sur quelles colonnes les tables reposent, ni ce qu'un refus rend, ni ce que
      la base peut tenir des options d'un `select`, ni ce qu'il advient d'une règle qui croiserait
      deux workflows. Rédigés **après mesure** sur la pile réelle — sondes créées puis détruites,
      `SQLSTATE` relevés à la main —, avec un contrat d'API de **vingt et une lignes** écrit avant le
      code pour être mesuré et non supposé. Commit documentaire dédié.
- [x] **L'unité du plan n'était pas celle qui pouvait être faite, et la mesure l'a dit** (décision 92,
      INC-043) : `CRM-034` précède de trois à dix unités **toutes** les tables dont sa garde a besoin.
      MESURÉ : `cards`, `card_events`, `card_comments`, `card_field_values` et `move_card` valent
      tous `NULL`. Aucune part de l'unité n'est livrable — `move_card` sans `cards` n'est pas une
      garde partielle, c'est une signature vide. `CRM-034` reste `[ ]`, non commencée, et **aucune
      contrainte d'ordre de `docs/MASTER_PLAN.md` §2 n'est enfreinte**.
- [x] `supabase/migrations/0009_champs_formulaire.sql` : `form_fields` et `form_field_rules`, les
      quinze types, les trois visibilités, l'unicité **totale** de la clé par workflow, l'attribution
      automatique de `position` dans la portée du workflow, **sept** politiques RLS et les privilèges
      explicites.
- [x] **Une règle ne peut pas croiser deux workflows, et c'est structurel** (décision 95) : trois
      clés étrangères composites articulées autour de `workflow_id`. MESURÉ dans les **deux** sens —
      quel que soit le workflow déclaré, l'une des deux clés attrape l'erreur en `23503`. Un trigger
      aurait rendu le même service, plus tard et moins sûrement. MESURÉ également : sans l'unicité
      `(id, workflow_id)` sur `form_fields`, la table des règles ne peut pas être créée (`42830`).
- [x] **La base tient ce que la spécification promet des options** (décision 94) : un `select` sans
      choix et un `money` sans devise sont refusés. Le prix est assumé et nommé — un `select` naît
      avec au moins un choix. Ce que la base **ne** tient **pas** — la forme des entrées de
      `choices` — est dit au §2.4 et **figé par une assertion**, non tu.
- [x] **UN DÉFAUT RÉEL, TROUVÉ PAR LA SUITE pgTAP ET CORRIGÉ DANS LE MÊME CHANGEMENT** (décision 102) :
      les deux contraintes ci-dessus **ne refusaient rien** dans le cas le plus courant. Un accès
      `jsonb` absent rend `NULL`, la conjonction rend `NULL`, et **un `CHECK` qui rend `NULL` accepte
      la ligne** : elles refusaient `{"choices": []}` et laissaient passer l'absence pure, qui est
      pourtant le premier cas à refuser. `coalesce(…, false)` sur les deux, et `jsonb_array_length`
      — qui lève une erreur sur un scalaire, dans un `AND` dont l'ordre n'est pas garanti — remplacé
      par une comparaison `jsonb`. Les deux cas sont désormais **deux** assertions distinctes ; la
      première seule aurait laissé passer le défaut, et c'est elle qui l'a trouvé.
- [x] **Asymétrie de suppression, et refus double** (décision 96) : une **règle** se supprime, un
      **champ** s'archive — aucune politique `for delete`, aucun privilège `DELETE`. La dégradation
      n° 3 du harnais **accorde** le privilège pour constater que la politique tient encore la
      seconde barrière : sans elle, on ne saurait pas lequel des deux mécanismes refuse.
- [x] **Test unitaire dédié** : `supabase/tests/0010_champs_formulaire.test.sql`, **61 assertions,
      aucune anomalie** — forme des deux tables, contraintes de valeur, les deux sens du croisement,
      les cascades, l'unicité totale de la clé y compris pour un champ archivé, `position` dans la
      portée du workflow, RLS, politiques, privilèges, et la conformité du seed.
- [x] **Test d'intégration dédié, hors interface** : `e2e/api/champs-formulaire.spec.ts`,
      **25 scénarios**, avec les jetons réels des trois profils seedés. Les vingt et une lignes du
      contrat d'API du §2.8 y sont rejouées, chaque refus **relisant la ligne** pour la constater
      inchangée.
- [x] **Une ligne du contrat a été révisée par la mesure** : la suppression d'un champ par un `admin`
      rend `403`, non `401`. Un rôle **authentifié** privé du privilège n'est pas un appelant sans
      rôle. Le §2.8 est corrigé dans le même changement, plutôt que le test relâché.
- [x] **Seed repris dans le même changement** : sept champs dont un archivé, couvrant sept types ;
      quinze règles couvrant les trois visibilités, dont **deux `visible` explicites** sans quoi cette
      valeur ne serait exercée par aucune donnée ; et **vingt-sept couples champ × étape laissés sans
      règle**, sans quoi la valeur par défaut du §3.1 serait écrite sans être démontrée.
- [x] Harnais de preuves rejouable `scripts/verify-champs-formulaire.sh` : **30 contrôles hors
      suites, aucune anomalie**, et **non complaisant, éprouvé par trois dégradations réelles** —
      contrainte des choix retirée, clé composite dégradée en clé **simple** sous le même nom,
      privilège `DELETE` accordé. Chacune fait passer une écriture qui doit être refusée, et la
      restauration est **constatée**.
- [x] **Trois garde-fous figés par des unités précédentes ont échoué comme prévu, et ont été
      révisés** (mécanisme de la décision 51, septième occurrence) : `hasnt_table('form_fields')`
      dans `0007_workflows` et dans `0008_copie_workflow`, et le contrôle d'absence de
      `scripts/verify-copie-workflow.sh`. Aucun n'a été retiré : le premier constate que
      `require_fields` reste vide **pour un autre motif**, les deux autres **comptent l'écart** —
      source sept champs, copie zéro.
- [x] **Build vert**, `npm run typecheck` vert sur les quatre projets, `npm run types:check` vert
      après régénération. `npm run test:sql` **717 assertions**, `npm run test:unit` **164 tests**,
      `npm run e2e:api` **150 scénarios**, `npm run e2e:ui` **37 scénarios** — ce dernier inchangé et
      **réellement exécuté**, au prix du contournement récurrent d'INC-036.
- [x] **Aucune régression du fait de cette unité** : les seize harnais précédents rejoués **après
      synchronisation** avec `origin/main` — `verify-stack` 33, `verify-migrations` 23,
      `verify-vault` 26, `verify-authz` 26, `verify-auth` 42, `verify-seed` 49, `verify-types` 30,
      `verify-webapp` 41, `verify-harness` 25, `verify-tracks` 40, `verify-channels` 23,
      `verify-catalogue` 29, `verify-workflows` 41, `verify-copie-workflow` 27,
      `verify-coherence-workflow` 26 —, aucune anomalie.
- [ ] **`scripts/verify-scripts.sh` : 51 contrôles verts sur 52, et le 52ᵉ est laissé en échec.**
      Il appartient à `CRM-002`, livré pendant ce passage par une autre exécution de la routine, et
      il échoue pour une raison d'**hôte** : ni `ss` ni `netstat` ne sont installés, si bien que
      `host_listening_ports` rend zéro ligne et que la garde de ports conclut à tort que tout est
      libre. Le contrôle fait donc exactement ce qu'on lui demande. Consigné en **INC-044**, sans
      correction — `scripts/lib/env.sh` est un livrable de `CRM-002`, `[x]`, et le corriger ici
      rouvrirait cette unité (`CLAUDE.md` §13). L'échec est **nommé plutôt que masqué**.
- [x] `docs/SPEC-form-composer.md` (§2 et §3 réécrits, §7 scindé par unité), `docs/SCHEMA.md` §4,
      `docs/SPEC-permissions-rls.md` §4, `docs/SPEC-seed.md` §2.10, `docs/DAT.md`,
      `docs/PROD_MIGRATIONS.md` §3 (migration 9), `docs/manual.md` chapitre 23 et §3.2, `README.md`,
      `CHANGELOG.md` mis à jour dans le même changement.
- [ ] **Aucun écran, aucune capture, aucun test E2E d'interface.** La grille champ × étape que la
      Definition of Done nomme suppose un écran d'administration authentifié, et la webapp reste un
      appelant **anonyme** faute d'écran de connexion — **INC-021, en attente d'arbitrage**. Les
      règles sont livrées et prouvées **en base et par l'API**, ce que `CLAUDE.md` §10 exige de toute
      façon. **Cette preuve est bloquée par un arbitrage, pas par un défaut de l'unité.**
- [ ] **La copie d'un workflow vers un track n'emporte pas ses champs.** `docs/SPEC-form-composer.md`
      §2.1 dit pourtant que le formulaire suit le workflow. MESURÉ : la copie du seed porte **zéro**
      champ là où sa source en porte sept. Le comportement de `copy_workflow_to_track` reste
      **inchangé** — INC-037 réserve l'arbitrage au responsable, et le corriger rouvrirait `CRM-032`
      dans un changement consacré à `CRM-035` (décision 93). L'écart est **compté** par trois
      assertions, jamais corrigé en silence.

*DoD adaptée, écarts explicites.* La Definition of Done demandait « unitaire, API (écriture réservée
aux administrateurs), E2E, captures de la grille » : les deux premières sont livrées, largement
au-delà de ce qu'elle demandait — vingt et une lignes de contrat d'API mesurées, trois dégradations
réelles. **Les deux dernières n'existent pas**, faute d'écran, et l'absence est nommée plutôt que
compensée par une preuve de substitution. **Aucune vérification visuelle** pour la même raison ; les
captures réécrites par le rejeu des suites d'interface ont été **regardées puis restaurées**, comme
aux quatre unités précédentes.

*Limites nommées, non masquées.*

- **Aucun écran.** Huitième unité consécutive du chunk 3 à buter sur INC-021.
- **`required` est une déclaration sans garde.** Ce qui l'applique est `move_card` (`CRM-034`), non
  commencée faute de cible (INC-043). Un champ déclaré obligatoire n'empêche aujourd'hui **rien**, et
  le dire est plus honnête que de laisser croire l'inverse.
- **La copie ne copie pas les champs** — INC-037, arbitrage attendu (voir ci-dessus).
- **La forme des entrées de `choices` n'est pas contrainte par la base** : un `CHECK` ne peut porter
  aucune sous-requête. La vérification appartient à `CRM-036` et à `CRM-037`, seuls endroits où une
  clé de choix inconnue produit une conséquence. Figé par une assertion.
- **`require_fields` reste vide dans le seed**, et le motif a changé : la colonne peut désormais
  désigner des champs réels, mais aucune garde ne la lit (décision 97). L'union « étape + transition »
  du §3.5 reste donc sans donnée de démonstration jusqu'à `CRM-034`.
- **Sur l'hôte de vérification, la chaîne s'exécute sous Node 22.22.2**, alors que le dépôt exige
  Node 24. Limite héritée, inchangée.
- **Trois contournements hors dépôt ont dû être refaits**, comme les entrées correspondantes le
  prédisaient : l'image `webapp` construite à la main avec le certificat du proxy (INC-032, INC-042),
  `npm ci` précédé d'un `npm config set cafile` (INC-042), et l'arborescence de compatibilité des
  navigateurs Playwright (INC-036). **Première exécution où le conteneur `webapp` démarre réellement**
  — les quinze services de la pile de développement sont sains.

### CRM-036 — Valeurs et validation `[ ]`
`card_field_values`, validation par type, union étape + transition.
**DoD** : pgTAP (type incorrect refusé, `hidden` non exigé, règle ajoutée après coup
n'invalidant pas l'existant).

### CRM-037 — Rendu du formulaire conditionnel `[ ]`
Champs par étape, section repliée des valeurs d'autres étapes, mention « requis pour passer à ».
**DoD** : E2E (transition bloquée, saisie, transition réussie) ; captures de chaque étape ;
accessibilité des erreurs vérifiée.

### CRM-040 — Cards `[~]`
CRUD, adresse email générée, responsable, montant, archivage, corbeille.
**DoD** : pgTAP sur la génération et l'unicité de `email_local_part` ; E2E ; captures.

- [x] **Spécification écrite avant tout code**, `docs/SPEC-cards.md` : aucun document ne décrivait
      cette table au-delà du tableau de colonnes de `docs/SCHEMA.md` §5 — ni ce qu'une adresse de
      card doit à sa non-devinabilité, ni comment le workspace, le workflow et l'étape sont tenus
      cohérents, ni ce qu'un refus rend. Rédigée **après mesure** sur la pile réelle — quatre sondes
      créées puis détruites, `to_regclass('public.sonde_c4')` rendant `NULL` —, avec un contrat
      d'API de **vingt-quatre lignes** écrit avant le code pour être mesuré et non supposé. Commit
      documentaire dédié, poussé avant la première ligne de SQL.
- [x] **L'unité choisie est la première du plan dont toutes les dépendances existent.** Les quatre
      unités `[ ]` que `docs/MASTER_PLAN.md` §2 place avant elle ont été examinées et MESURÉES
      infaisables : `CRM-013` vise six tables dont **aucune** n'existe, `CRM-014` dix scénarios sur
      douze, `CRM-034` n'a aucune part livrable (INC-043), `CRM-036` est une table fille de `cards`.
      **Aucune contrainte d'ordre de `docs/MASTER_PLAN.md` §2 n'est enfreinte.**
- [x] `supabase/migrations/0011_cards.sql` : la table, **trois clés étrangères composites**, deux
      triggers, cinq index, trois politiques, les privilèges, `app.can_read_card`, et la garde
      d'archivage d'un nœud occupé.
- [x] **Trois clés composites plutôt que trois triggers** (décision 109). Conséquence non
      anticipée : la troisième livre **la vérification n° 3 des six de `move_card`** — « l'étape
      cible appartient au workflow de la card » —, que `CRM-034` n'aura pas à écrire, et qui vaut
      aussi pour un `PATCH` direct qu'aucune garde applicative ne verrait passer.
- [x] **INC-013 est close** : `app.can_read_card` est livrée, quatrième et dernière des fonctions
      différées. Elle n'est **pas** employée par les politiques de `cards` (décision 110) : une
      politique qui relirait sa propre table ferait rendre `403` à toute création — le défaut réel
      trouvé par `CRM-012` sur `tracks` (décision 107), évité avant d'être payé une seconde fois.
- [x] **INC-031 est close** : la garde d'archivage d'un nœud occupé est écrite (décision 111).
      L'arbitrage n'avait pas été rendu ; deux faits l'ont réduit à une seule issue tenable, et
      **deux harnais livrés par des unités précédentes l'exigeaient nommément** — leur message
      d'échec disait « si `cards` existe, la garde d'archivage doit être écrite ».
- [x] **UNE CONSÉQUENCE ÉMERGENTE, MESURÉE, ET QUI N'EST ÉCRITE NULLE PART — INC-046.** La clé
      `cards (channel_id, workflow_id)` rend **refusé** le changement de workflow d'un channel qui
      porte au moins une card. Règle défendable, que nulle spécification n'énonce. **Elle atteint le
      seed du projet** : MESURÉ, une card dans `prospection` — le seul channel que le seed repointe —
      le fait échouer **en section 4**, code de sortie `1`. Contre-épreuve mesurée : une card dans
      `grands-comptes` laisse le seed vert. Le comportement de `CRM-032` et de `CRM-033` reste
      **inchangé** ; le seed ne pose aucune card dans `prospection`, et le motif est écrit en
      `docs/SPEC-cards.md` §9.1 plutôt que tu.
- [x] **UNE ERREUR DE LA SPÉCIFICATION, TROUVÉE PAR SA PROPRE PREUVE DE NON-COMPLAISANCE.** Le §6.1
      annonçait que le `WITH CHECK` de la politique de mise à jour était indispensable. La
      dégradation du harnais l'a retiré… et le refus a tenu. MESURÉ sur une politique sonde :
      `pg_get_expr(polwithcheck, …)` rend `NULL` et PostgreSQL **réutilise le `USING`**. La
      spécification est corrigée, la clause conservée pour la lisibilité, et la dégradation rend
      désormais le `WITH CHECK` **permissif** — le retirer était une dégradation complaisante que
      rien n'aurait signalée.
- [x] **Test unitaire dédié** : `supabase/tests/0012_cards.test.sql`, **88 assertions, aucune
      anomalie** — forme de la table, contraintes de valeur, les trois clés composites dans les
      **deux** sens, génération et unicité de l'adresse, `position` dans sa portée, colonne générée,
      index, politiques éprouvées avec les rôles réels des comptes seedés, `app.can_read_card`
      éprouvée **directement**, la garde d'archivage dans ses trois cas, conformité du seed, et les
      écarts figés par des assertions.
- [x] **Test d'intégration dédié, hors interface** : `e2e/api/cards.spec.ts`, **24 scénarios**, avec
      les jetons réels des trois profils seedés. Les vingt-quatre lignes du contrat d'API du §8.1 y
      sont rejouées, chaque refus de mise à jour **relisant la ligne** pour la constater inchangée.
- [x] **Preuves de refus n° 4 et n° 11 acquises au niveau des cards** : `access = 'none'` sur le
      track → zéro card dans ses channels ; anonyme → zéro ligne. Le refus est mesuré comme **zéro
      ligne**, jamais comme une erreur — et la table est d'abord constatée **non vide** avec la clé
      de service, sans quoi l'assertion serait verte que la RLS refuse ou qu'elle autorise tout.
- [x] **Seed repris dans le même changement** : neuf cards sur quatre channels et trois tracks, dont
      une archivée, une en corbeille, une sans responsable ni montant, et deux devises distinctes.
      **Convergence vérifiée** : le seed rejoué sur une base déjà peuplée reste vert, et les adresses
      des cards seedées sont **stables** d'un rejeu à l'autre.
- [x] **Build vert**, `npm run typecheck` vert sur les quatre projets, `npm run types:check` vert
      après régénération. `npm run test:sql` **878 assertions**, `npm run test:unit` **164 tests**,
      `npm run e2e:api` **194 scénarios**, `npm run e2e:ui` **37 scénarios** — ce dernier inchangé et
      **réellement exécuté**, au prix du contournement récurrent d'INC-036.
- [x] **Aucune régression** : les harnais précédents rejoués — `verify-stack` 33, `verify-migrations`
      23, `verify-authz` 26, `verify-seed` 49, `verify-tracks` 43, `verify-channels` 30,
      `verify-catalogue` 39, `verify-workflows` 49, `verify-copie-workflow` 34,
      `verify-coherence-workflow` 33, `verify-champs-formulaire` 37, `verify-droits-fins` 42 —,
      aucune anomalie.
- [x] Harnais de preuves rejouable `scripts/verify-cards.sh` : **44 contrôles, aucune anomalie**, et
      **non complaisant, éprouvé par trois dégradations réelles** — politique de lecture ramenée à
      `is_workspace_member`, `WITH CHECK` rendu permissif, garde d'archivage retirée. Chacune fait
      passer une opération qui doit être refusée, et la restauration est **constatée**.
- [x] **Sept assertions figées par des unités précédentes ont échoué comme prévu, et ont été
      révisées** (mécanisme de la décision 51, dixième occurrence) : dans `0002`, `0006`, `0007`,
      `0011`, et dans `verify-authz.sh`, `verify-catalogue.sh`, `verify-workflows.sh`. **Aucune n'a
      été retirée** : chacune est **retournée**, et deux d'entre elles sont désormais plus fortes
      qu'avant — elles **nomment** la garde au lieu de compter des triggers.
- [x] `docs/SPEC-cards.md`, `docs/SCHEMA.md` §5 et §9, `docs/SPEC-permissions-rls.md` §3, §3.6 et §4,
      `docs/SPEC-seed.md` §2.12, `docs/DAT.md` §5, `docs/PROD_MIGRATIONS.md` §3 (migration 11),
      `docs/manual.md` chapitre 4 et §3.2, `docs/MASTER_PLAN.md` §3, `CHANGELOG.md` mis à jour dans
      le même changement.
- [ ] **Aucun écran, aucune capture, aucun test E2E d'interface.** La Definition of Done exige
      « E2E ; captures ». La webapp reste un appelant **anonyme** faute d'écran de connexion —
      **INC-021, en attente d'arbitrage** —, et une card est par construction invisible à un
      anonyme : il n'existe **aucune** vérification visuelle sensée à produire tant que l'arbitrage
      n'est pas rendu. Les règles sont livrées et prouvées **en base et par l'API**, ce que
      `CLAUDE.md` §10 exige de toute façon. **Cette preuve est bloquée par un arbitrage, pas par un
      défaut de l'unité.**
- [ ] **La protection de colonne de `current_step_id` et d'`email_local_part` n'est pas livrée.**
      C'est mot pour mot la Definition of Done de `CRM-013`, unité `[ ]` distincte, désormais
      **partiellement débloquée** — deux de ses six cibles existent. Le trigger **génère** l'adresse ;
      il ne la protège pas en mise à jour. L'écart est **figé par deux assertions** de la suite
      pgTAP, qui deviendront rouges à `CRM-013`.
- [ ] **Aucune card sur un workflow dérivé dans le seed** — INC-046 (voir ci-dessus). La divergence
      de `CRM-032` reste donc démontrée par ses étapes et ses transitions, jamais par une card qui
      les emprunterait.

*DoD adaptée, écarts explicites.* La Definition of Done demandait « pgTAP sur la génération et
l'unicité de `email_local_part` ; E2E ; captures ». La première est livrée, largement au-delà — la
génération, l'unicité, la valeur du client ignorée, et le fait que ce soit l'**index** et non la
boucle qui garantisse. **Les deux dernières n'existent pas**, faute d'écran, et l'absence est nommée
plutôt que compensée par une preuve de substitution.

*Limites nommées, non masquées.*

- **Aucun écran.** Dixième unité consécutive à buter sur INC-021.
- **`move_card` n'existe pas** : `current_step_id` s'écrit directement par un `PATCH`, et une card
  peut franchir une transition non déclarée. La seule garde qui tienne aujourd'hui est structurelle —
  l'étape doit appartenir au workflow de la card. `CRM-034` est désormais **débloquée** : sa cible
  existe.
- **`health_score` et `snoozed_until` sont livrées et jamais alimentées** : aucun ordonnanceur
  n'existe, aucune unité n'en porte. `entered_step_at` est renseignée à la création et sa remise à
  zéro appartient à `move_card`.
- **`amount` n'est pas contraint en signe** : refuser les négatifs est une décision de produit que
  personne n'a prise, et l'absence est **figée par une assertion** (docs/SPEC-cards.md §10).
- **Aucune purge de la corbeille** : toute rétention est une décision de conformité, arbitrage
  attendu.
- **La recherche est monolingue** — `to_tsvector('french', …)`.
- **Sur l'hôte de vérification, la chaîne s'exécute sous Node 22.22.2**, alors que le dépôt exige
  Node 24. Limite héritée, inchangée.
- **Quatre contournements hors dépôt ont dû être refaits**, comme les entrées correspondantes le
  prédisaient : démon Docker lancé à la main, image `webapp` construite avec le certificat du proxy
  (INC-032, INC-042), `npm ci` précédé d'un `npm config set cafile` (INC-042), et l'arborescence de
  compatibilité des navigateurs Playwright (INC-036, **quatrième** occurrence).

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
