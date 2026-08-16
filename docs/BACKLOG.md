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

### CRM-001 — Pile Supabase self-hosted `[~]`
Pile self-hosted à versions épinglées. Assemblage `docker-compose.yml` + overlays dev et prod.
MinIO en dev, Storage sur S3.
**DoD** : `docker compose up` démarre tous les services sains ; Kong répond ; Studio accessible en
dev ; aucun service de développement présent en prod.

- [x] Assemblage commun `docker-compose.yml` : `db`, `auth-templates`, `migrations-runner`,
      `auth`, `rest`, `realtime`, `storage`, `functions`, `kong`. Toutes les images épinglées à une
      version exacte. **`supavisor` en a été retiré** le 2026-08-13 (décision 366) : le pooler
      n'avait aucun consommateur.
- [ ] **Démarrage à froid rejoué après le retrait du pooler.** Les preuves de démarrage et le
      harnais ci-dessous datent d'un assemblage qui comportait encore `supavisor`, la base
      `_supabase` et le mot de passe du rôle `pgbouncer`. Le retrait touche des scripts
      d'initialisation qui ne rejouent qu'à la création du cluster : la seule preuve valable est
      `./resetMe.sh` puis `./runDev.sh`, suivis de `scripts/verify-stack.sh` et de
      `scripts/verify-scripts.sh`. **Non rejouée le 2026-08-13 : le démon Docker n'était pas
      joignable depuis la distribution WSL de la session.** L'unité reste `[~]` jusque-là.
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
- [x] Harnais de preuves rejouable `scripts/verify-stack.sh` : **55 contrôles, aucune anomalie**,
      et **non complaisant** — il échoue bien lorsqu'un service est arrêté, lorsque MinIO est
      coupé, ou lorsqu'un service de développement est réintroduit en production. La reprise de
      `CRM-009` l'a rendu exhaustif ; `CRM-016` porte l'état courant à **17 services persistants**,
      **3 tâches one-shot** et **10 services réservés au développement**, dont `auth-templates` et
      le runtime `functions` réellement appelé à travers Kong.

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
- La pile provient de la distribution self-hosted **officielle** de Supabase, versions épinglées,
  et non de `../starter.2025.12/`, absent de l'environnement d'exécution. **Confirmé et clos le
  2026-08-13 par le responsable (INC-006)** : la pile officielle épinglée convient, aucun écart de
  `starter.2025.12` n'est à reporter. La pile a depuis divergé de la distribution officielle par
  des décisions propres au projet — le retrait de Supavisor (décision 366) en est une —, ce qui rend
  la question de l'origine définitivement close : la référence est désormais le dépôt lui-même.

### CRM-002 — Scripts de lancement et environnement `[x]`
`runDev.sh`, `runProd.sh`, `resetMe.sh`, `.env.example` documentant **chaque** variable (rôle,
format, obligatoire ou non, exemple non sensible). La liste exhaustive des variables déjà
consommées par les fichiers Compose de `CRM-001` figure dans `docs/JOURNAL.md`, décision 15 :
`.env.example` doit la couvrir intégralement.
**DoD** : démarrage à froid depuis un dépôt propre ; `resetMe.sh` recrée la base et le seed ;
aucun secret réel versionné ; `README.md` §5–6 conforme au comportement réel.

- [x] `.env.example` : **90 variables**, chacune documentée avec son rôle, son format, son
      caractère obligatoire et une valeur d'exemple non sensible. Le gabarit couvre **exactement**
      les 86 variables interpolées par les trois fichiers Compose ; les 4 restantes sont nommées
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
- [x] Harnais de preuves rejouable `scripts/verify-scripts.sh` : **80 contrôles, aucune
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
- [x] **LE CONTEXTE DE BUILD DE LA WEBAPP EXCLUT LES DONNÉES ET LES SECRETS LOCAUX**
      (décision 247). Mesuré pendant la preuve à froid de `CRM-050`, un nouveau nom de projet
      oblige Compose à reconstruire l'image : l'envoi du dépôt entier échoue en lisant
      `supabase/docker/volumes/db/data`, fermé en `0750`. Plus grave, l'image existante contient
      réellement `/app/.env` et `/app/.git` parce que `COPY . .` n'avait aucun `.dockerignore`.
      La correction doit exclure au minimum `.env`, `.git`, les dépendances, les sorties de build
      et de preuve, ainsi que `supabase/docker/volumes/`; le harnais doit construire l'image et
      constater que ces chemins en sont absents, sans jamais lire ni afficher un secret. Prouvé :
      contexte ramené de **233,04 Mo à 11,56 Mo**, reconstruction réelle verte, puis absence de
      `/app/.env`, `/app/.git` et `/app/supabase/docker/volumes` dans l'image ; `.env.example`
      reste présent. L'ancienne image locale identifiée, qui contenait les deux premiers chemins,
      n'existe plus.

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

**Arbitrage du responsable — `docs/JOURNAL.md`, décision 257 (INC-044, INC-079).** La garde de
ports est **inerte** là où ni `ss` ni `netstat` n'existent : `host_listening_ports` rend une liste
vide, `require_free_ports` avertit et laisse démarrer — voulu —, tandis que
`scripts/verify-scripts.sh` **échoue** en comparant quinze ports publiés à une liste vide.

- [x] **Lire `/proc/net/tcp` en dernier recours.** C'est la seule option qui ferme les deux entrées
      à la fois, et surtout la seule qui rende la garde **réellement** protectrice au lieu
      d'apparemment protectrice : faire s'abstenir le contrôle aurait laissé l'angle mort intact,
      et un vrai conflit de port serait resté invisible jusqu'à l'échec de Compose. IPv4 et IPv6
      sont lus ; seul l'état noyau `0A` (`LISTEN`) est retenu, avec conversion hexadécimale portable.
- [x] **Exigence attachée** : la lecture est prouvée **dans les deux sens** — sans `ss` ni
      `netstat`, le harnais ouvre une vraie socket sur un port alloué par le noyau et la retrouve
      dans `/proc/net/tcp`, tue et attend son détenteur exact, puis constate que le même port fermé
      a disparu. Une fixture distincte couvre aussi `/proc/net/tcp6`. Résultat complet :
      `scripts/verify-scripts.sh` **64/64**.
- [x] **Refuser une origine webapp de développement incohérente avant Docker** (décision 272).
      `SITE_URL` doit être exactement l'origine réellement publiée par
      `DEV_BIND_ADDRESS:WEBAPP_DEV_PORT`, et `ADDITIONAL_REDIRECT_URLS` doit l'autoriser. Sans cette
      garde, la pile démarre mais le clic d'un destinataire sur une invitation aboutit sur une
      adresse qui n'écoute pas. La garde s'exécute aussi avec `--bootstrap`, avant tout appel à
      Docker.
- [x] **Exigence attachée et non-complaisante** : le harnais accepte le trio cohérent, puis dégrade
      séparément `SITE_URL` et `ADDITIONAL_REDIRECT_URLS` et exige un refus explicite avant tout
      appel à Docker. Résultat rejoué : `scripts/verify-scripts.sh` **61/61**.

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

### CRM-010 — Fonctions d'autorisation `[x]`
`app.is_workspace_member`, `app.is_workspace_admin`, `app.can_read_track`,
`app.can_read_channel`, `app.can_write_channel`, `app.can_read_card`.
**DoD** : pgTAP couvrant chaque rôle et chaque combinaison de droits fins ; absence de récursion
démontrée ; `search_path` fixé sur toutes les fonctions `SECURITY DEFINER`.

- [x] `supabase/migrations/0002_fonctions_autorisation.sql` : `app.resolve_access`,
      `app.workspace_role`, `app.is_workspace_member`, `app.is_workspace_admin`, et leurs
      privilèges d'exécution. **Aucune politique RLS** : le refus par défaut de `CRM-003` est
      intact, ce que la suite pgTAP vérifie explicitement.
- [x] **pgTAP couvrant chaque rôle et chaque combinaison de droits fins** :
      `supabase/tests/0002_fonctions_autorisation.test.sql`, **153 assertions, aucune anomalie**
      — 127 à la livraison du 2026-08-03, étendues le 2026-08-05 par la reprise de l'unité.
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
- [x] Harnais de preuves rejouable `scripts/verify-authz.sh` : **35 contrôles, aucune anomalie**,
      et **non complaisant** — il échoue bien lorsque `is_workspace_member` repasse en
      `SECURITY INVOKER`, lorsque `search_path` est relâché, lorsque `resolve_access` autorise
      tout, lorsqu'un administrateur devient restreignable par un droit fin, lorsqu'`EXECUTE` est
      retiré à `anon`, lorsqu'une politique permissive est ajoutée, et lorsqu'une des quatre
      fonctions différées est créée sans étendre les preuves. *(26 contrôles jusqu'au 2026-08-05.)*
- [x] `scripts/verify-stack.sh` (**33/33**), `scripts/verify-scripts.sh` (**38/38**) et
      `scripts/verify-migrations.sh` (**23/23**) rejoués : aucune régression sur les unités
      précédentes.
- [x] `docs/SCHEMA.md` §9, `docs/SPEC-permissions-rls.md` §3, §3.1, §3.2, `docs/DAT.md` §7,
      `docs/PROD_MIGRATIONS.md` §3, `README.md` §5 et §7, `CHANGELOG.md` mis à jour dans le même
      changement.
- [x] **~~Quatre des six fonctions ne sont pas livrées.~~ LES SIX SONT LIVRÉES, ET INC-013 EST
      CLOSE** (2026-08-05, décision 155). `app.can_read_track`, `app.can_read_channel` et
      `app.can_write_channel` par `CRM-012`, `app.can_read_card` par `CRM-040`. La Definition of
      Done **n'a pas été réécrite** : elle nomme six fonctions, elle est redevenue satisfaisable
      telle qu'elle est, et l'unité a été reprise pour la satisfaire plutôt que pour la réduire.
      Le second point ouvert d'INC-013 — « faut-il la ramener à quatre ? » — tombe avec le premier.
- [x] **Spécification écrite avant les preuves ajoutées**, `docs/SPEC-permissions-rls.md` §3.8 :
      les trois exigences de la Definition of Done rendues vérifiables — l'égalité que les quatre
      fonctions doivent respecter, le tableau des six cas de récursion avec leurs résultats
      **mesurés**, et le recensement des `SECURITY DEFINER`. Commit documentaire dédié, poussé
      avant la première ligne de test (décision 156).
- [x] **La matrice, à travers des lignes réelles** — ce qu'INC-013 nommait comme manquant. Un seul
      utilisateur, quatre workspaces pour les quatre états du rôle, quatre tracks et quatre
      channels par niveau, une card par channel : **64 triplets**, tous construits par des lignes
      distinctes. Aucune divergence entre `can_read_track`, `can_read_channel`, `can_write_channel`
      et `app.resolve_access` — et la matrice **discrimine** : 10 tracks sur 16, 38 channels sur 64
      en lecture, 27 sur 64 en écriture. `can_read_card` délègue strictement à `can_read_channel`
      sur les 64, conformément au §3.6.
- [x] **Absence de récursion démontrée sur les trois tables protégées, en la provoquant** — la
      section 4 ne portait que sur `workspace_members`. Sur `tracks`, `channels` et `cards`, la
      politique adossée à la fonction **livrée** répond et rend exactement le filtrage de la
      matrice ; une jumelle `SECURITY INVOKER`, identique au mode d'exécution près, épuise la pile
      en **`54001`**, les trois fois. La plus longue chaîne du produit —
      `card_field_values` → `can_read_card` → `cards` → `can_read_channel` → `channels` — répond et
      rend des lignes. `docs/SPEC-permissions-rls.md` §3.3 l'**affirmait** depuis `CRM-012` sans
      qu'aucune assertion ne le tienne.
- [x] **Le `search_path` est un recensement, plus une liste** : aucune fonction `SECURITY DEFINER`
      des schémas `app` et `public` sans `search_path` vide — **18** mesurées le 2026-08-05 sur
      **29** —, et aucune fonction du schéma `app`, `SECURITY INVOKER` comprise, qui le laisse au
      hasard. La preuve tombera d'elle-même le jour où une unité en ajoutera une sans son
      `search_path`, sans qu'aucun fichier n'ait à être tenu à jour (décision 51).
- [x] **Test unitaire dédié** : `supabase/tests/0002_fonctions_autorisation.test.sql`, **153
      assertions, aucune anomalie** (128 jusqu'au 2026-08-05).
- [x] **Preuve d'intégration dédiée, hors interface, sur les quatre fonctions ajoutées** : sous
      PostgREST, avec les jetons réels des trois profils du seed obtenus par la véritable route de
      connexion, `tracks`, `channels` et `cards` rendent 4/6/9 à l'administratrice et au business
      developer, **3/4/4** au `viewer` fermé sur un track par un droit fin, et **zéro ligne avec un
      `200`** à l'anonyme (preuve n° 11). Ces trois tables portent les politiques qui appellent les
      fonctions : elles les exercent par le **chemin réel** du produit, sans instrumentation.
- [x] **UN DÉFAUT RÉEL DE CE HARNAIS, TROUVÉ PAR LE REJEU DE RÉGRESSION** (décision 157, INC-060).
      L'étape 2 enchaînait `docker compose up -d migrations-runner` et la lecture de
      `.State.ExitCode` : MESURÉ, l'inspection lit `0` alors que `Status` vaut encore `running`
      — c'est le code de l'exécution **précédente**. Le contrôle était donc complaisant, et le
      harnais rendait la main sur une base **à moitié migrée** : entre les migrations 3 et 10,
      `tracks_lecture_membre` revenait à sa forme de `CRM-003` et `npm run test:sql` rendait trois
      assertions rouges dans `0011_droits_fins.test.sql`, dont la preuve de refus n° 4. Corrigé par
      `docker compose run --rm`, **synchrone**, et par un contrôle de plus qui vérifie l'**état
      final de la base** plutôt qu'un code de conteneur. Troisième occurrence du mécanisme des
      décisions 108 et 135.
- [x] **Quatre dégradations de plus, et elles mordent** : `can_read_track` repassée en
      `SECURITY INVOKER` (1 assertion rouge), `can_read_channel` cessant de regarder
      `channel_members` (5), `can_read_card` jugeant sur le workspace au lieu du channel (3), et une
      fonction `SECURITY DEFINER` ajoutée sans `search_path` (3). Sans elles, la suite pouvait
      rester verte pendant que quatre des six fonctions étaient réécrites n'importe comment.
- [x] **Build vert**, `npm run typecheck` vert sur les quatre projets, `npm run test:unit`
      **164 tests**, `npm run e2e:api` **291 scénarios**, `npm run e2e:ui` **37 scénarios**,
      `npm run test:sql` **1164 assertions**.
- [x] **Les vingt-trois harnais du dépôt rejoués** (décision 158) : `verify-stack` 33,
      `verify-migrations` 23, `verify-vault` 26, `verify-auth` 42, `verify-authz` **35**,
      `verify-seed` 49, `verify-types` 30, `verify-webapp` 41, `verify-harness` 25,
      `verify-tracks` 43, `verify-channels` 30, `verify-catalogue` 39, `verify-workflows` 49,
      `verify-copie-workflow` 34, `verify-coherence-workflow` 33, `verify-champs-formulaire` 38,
      `verify-droits-fins` 42, `verify-move-card` 56, `verify-valeurs-champs` 40,
      `verify-colonnes-protegees` 50, `verify-preuves-refus` 26 — **aucune anomalie**.
- [x] **UN GARDE-FOU FIGÉ A ÉCHOUÉ COMME PRÉVU, ET A ÉTÉ RÉVISÉ** (mécanisme de la décision 51,
      dixième occurrence) : `scripts/verify-harness.sh` comptait 1139 assertions et a rendu « vert
      mais 1164 au lieu de 1139 ». Révisé à **1164** dans le même changement, valeur mesurée ;
      `SCENARIOS_API` et `SCENARIOS_UI` restent à 291 et 37, l'unité ne livrant ni route ni écran.
- [x] **DEUX HARNAIS RENDENT UNE ANOMALIE QUI NE VIENT PAS DE CETTE UNITÉ, ET AUCUNE N'EST
      MASQUÉE** — chacune isolée, reproduite et consignée plutôt que rangée sous « régression ».
      `scripts/verify-scripts.sh` : 51 sur 52, INC-044, défaut d'hôte connu — ni `ss` ni `netstat`
      installés. `scripts/verify-cards.sh` : 44 sur 45, **défaut réel et nouveau**,
      **INC-061** — sa section 10 rejoue `npm run test:sql` avant que son `trap` ne retire ses
      cinq cards de preuve, et trois assertions de `0015_colonnes_protegees.test.sql` comptent les
      neuf cards du seed. MESURÉ : reproductible, et `npm run test:sql` lancé immédiatement après
      la sortie du harnais rend 1164 assertions sans anomalie. Livrable de `CRM-040` : **non
      corrigé ici**, arbitrage attendu.
- [x] **Septième occurrence d'INC-036, contournée hors dépôt.** Les navigateurs du conteneur sont
      en révision `1194` là où le Playwright épinglé réclame `1234` : `verify-webapp` rendait
      **10 anomalies** et `npm run e2e:ui` échouait sur ses 37 scénarios. L'arborescence de
      compatibilité recréée, les deux repassent au vert. Le coût d'entrée reste **récurrent**, et
      l'arbitrage reste attendu.
- [x] **Les trois captures réécrites par le rejeu ont été regardées puis restaurées**, comme aux
      six unités précédentes : cette unité ne touche aucun composant de l'interface, et l'écran
      reste celui d'un appelant anonyme. Les différences étaient des variations de rendu, aucune
      de contenu.

*DoD adaptée, écarts explicites.* **Aucun test E2E dédié, aucune vérification visuelle** : cette
unité ne livre ni parcours utilisateur ni écran, et n'en livrera pas — ses objets sont sept
fonctions SQL. Ses preuves sont unitaires (pgTAP) et d'intégration (PostgREST, jetons réels, hors
interface), ce que `CLAUDE.md` §10 exige de toute façon d'une règle d'accès. **Aucune mise à jour du
seed** : les comptes et workspaces de la matrice vivent dans la transaction de la suite et sont
annulés avec elle ; ceux du harnais sont créés puis détruits par lui. L'unité n'introduit ni table,
ni page, ni statut, ni flux — rien que le seed doive démontrer.

*Limites nommées, non masquées.*

- **Aucune politique RLS n'est écrite par cette unité** : ce qui est prouvé, ce sont les fonctions.
  Leur emploi par le produit est prouvé ici **à travers** les politiques de `CRM-012` et `CRM-040`,
  mais celles-ci restent leurs livrables. Au passage, **aucune unité du backlog ne porte nommément
  les politiques des tables d'identité**, ni la preuve de refus n° 10 :
  `docs/INCONSISTENCY_REPORT.md`, **INC-014, en attente d'arbitrage** — inchangée.
- **`scripts/verify-migrations.sh` porte le même défaut que celui corrigé ici**, et n'est **pas**
  corrigé : c'est un livrable de `CRM-003`, unité `[x]`, et le reprendre dans ce commit
  contredirait `CLAUDE.md` §13. Le piège reste armé et il est nommé : **INC-060, arbitrage
  attendu**.
- **La création des workspaces et des appartenances du harnais passe par SQL**, faute de politique
  autorisant leur création par l'API. Le fait est nommé dans le script, pas masqué.
- **Les preuves d'intégration ajoutées dépendent du seed** : elles lisent les nombres du seed socle
  et échoueront explicitement — avec le message qui le dit — si le seed n'est pas appliqué.
- **Sur l'hôte de vérification, la chaîne s'exécute sous Node 22.22.2**, alors que le dépôt exige
  Node 24. Limite héritée, inchangée, sans effet sur cette unité qui ne touche aucun code TypeScript.

### CRM-011 — Authentification `[x]`
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
- [x] **Conserver `GOTRUE_JWT_DEFAULT_GROUP_NAME=authenticated` malgré l'avertissement amont**
      (décision 276, qui corrige la décision 275 après contre-preuve) : sans elle, GoTrue 2.189.0
      émet réellement `role=""` et PostgREST refuse tout utilisateur en `401`. Le harnais exige la
      variable appliquée, `role=authenticated` dans le JWT et son acceptation par PostgREST.
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
- [x] **Suppression du compte** par l'API d'administration : aucun profil orphelin. **Correction
      terminologique du 2026-08-11 (investigation INC-076) :** le mot « cascade » était inexact et
      laissait croire qu'un commentaire disparaîtrait avec son auteur. Le geste réel, livré par
      `CRM-022` (migration `0021_identites_et_memberships_surs.sql`, 2026-08-09), est un
      **détachement** — `card_comments.author_id` devient nullable et sa FK porte
      `ON DELETE SET NULL` — prouvé par les assertions 5, 6, 81 à 83 de
      `supabase/tests/0023_identites_et_memberships_surs.test.sql`. **Rejouée sur une pile réelle le
      2026-08-12** (`docs/JOURNAL.md` décision 355) : suite `0023` verte, `scripts/verify-seed.sh`
      vert, et un véritable `DELETE /auth/v1/admin/users/<id>` sur le compte auteur de deux
      commentaires du seed rend `200`, les deux commentaires survivant avec `author_id` devenu
      `null`. `docs/INCONSISTENCY_REPORT.md` INC-076 est close.
- [x] **Vérification visuelle réellement observée** : `docs/captures/CRM-011/` — moniteur Inbucket
      montrant le trafic SMTP réel, email d'invitation et email de réinitialisation ouverts et lus.
      C'est la seule vérification visuelle que cette unité rend possible, et c'est celle que sa
      Definition of Done nomme.
- [x] Harnais de preuves rejouable `scripts/verify-auth.sh` : **62 contrôles, aucune anomalie**.
      Son premier contrôle compare la configuration **réellement appliquée au conteneur** aux
      valeurs du `.env` : sans lui, tous les suivants mesureraient les défauts de l'image en
      croyant mesurer le produit. Les contrôles ajoutés exigent les quatre URL et sujets, le
      service sain, le contenu SMTP français et la non-conformité du repli anglais.
- [x] Harnais **non complaisant, éprouvé dans les deux sens** : il démarre un GoTrue **jetable**, à
      la même version épinglée, portant le réglage affaibli, et exige qu'il accepte ce que la pile
      refuse ; et il a été **réellement mis en échec** contre la pile affaiblie —
      `DISABLE_SIGNUP=false` produit **6 anomalies**, `PASSWORD_MIN_LENGTH=6` en produit **2**,
      code de sortie `1` dans les deux cas. Un GoTrue jetable privé du serveur de gabarits rend
      aussi l'anglais attendu, que le validateur du produit refuse. Configuration restaurée,
      retour à 62/62.
- [x] `scripts/verify-stack.sh` (**50/50**), `scripts/verify-scripts.sh` (**61/61**),
      `scripts/verify-migrations.sh` (**23/23**), `scripts/verify-vault.sh` (**26/26**) et
      `scripts/verify-authz.sh` (**26/26**) rejoués : aucune régression.
- [x] `docs/DAT.md` §4.1 et §7, `README.md` §7, §9, §10 et §11, `docs/PROD_MIGRATIONS.md` §2 et §4,
      `docs/manual.md`, `CHANGELOG.md` mis à jour dans le même changement.
- [x] **E2E de connexion et de refus enfin livré.** Six scénarios de
      `e2e/ui/authentification.spec.ts` exercent le build de production et la vraie API, sans
      substitution : refus générique, session restaurée dans l'onglet, déconnexion, publication
      d'un commentaire, refus du `viewer`, déplacement autorisé et déplacement refusé avec retour
      à l'état précédent. Les deux écritures réussies sont relues directement par l'API.
- [x] **Session conforme à l'arbitrage** : `sessionStorage`, repli mémoire, aucun `localStorage`.
      Le rechargement conserve la session ; la déconnexion retire le jeton. Le comportement est
      prouvé aux niveaux unitaire et navigateur.
- [x] **Vérification visuelle de l'application observée** : quatre paliers de `/connexion` et une
      session chargée dans `docs/captures/CRM-011/`, en plus des captures d'emails historiques.
- [x] **Limite explicitement bornée : l'invitation n'est pas encore un parcours produit.** Elle exige la clé de service : c'est une
      opération d'**exploitation**. Le composant qui permettrait à un administrateur de workspace
      d'inviter depuis le produit n'existe pas et n'est rattaché à aucune unité — **INC-015, en
      attente d'arbitrage** (décision 30).
- [x] **Limite explicitement bornée : aucun rattachement d'un compte invité à un workspace.** L'invitation crée un compte et son
      profil ; elle ne crée aucune ligne `workspace_members`. Relève du même arbitrage.

*DoD satisfaite.* Le mécanisme GoTrue reste couvert par `scripts/verify-auth.sh`. La reprise webapp
ajoute 32 tests unitaires au total de la suite concernée et six scénarios d'interface réels ; les
comptes stables de `CRM-005` servent de profils et aucune donnée d'essai ne subsiste.

*Limites nommées, non masquées.*

- GoTrue 2.189.0 écrit deux avertissements de groupes JWT. Le premier,
  `GOTRUE_JWT_ADMIN_GROUP_NAME`, apparaît même sans variable injectée : son propre
  `ApplyDefaults()` impose `admin`. Le second qualifie `GOTRUE_JWT_DEFAULT_GROUP_NAME` de non pris
  en charge, mais la contre-preuve exige de le conserver : son retrait vide réellement le claim
  `role` et casse PostgREST (décision 276). Masquer le niveau `warning` cacherait les vraies
  alertes ; cette incohérence amont est distinguée de la console navigateur, strictement vide.

- **La récupération de mot de passe reste hors interface**, bien que son mécanisme soit prouvé.
- **L'invitation reste une opération d'exploitation** (INC-015).
- **INC-016 est close par `CRM-009`** : les quatre emails transactionnels emploient les gabarits
  français servis par `auth-templates`, et leur contenu réel est vérifié. La limite amont reste
  le **HTML seul**, sans partie MIME `text/plain` ; Inbucket reconstruit son onglet texte.
- **L'expiration des liens d'invitation et de réinitialisation n'est pas mesurée.** Le défaut est
  de 24 heures ; le vérifier exigerait de manipuler le temps de l'instance.
- **La fenêtre de grâce de 10 secondes** sur la rotation des jetons de rafraîchissement est
  documentée d'après le défaut de GoTrue ; sa borne exacte n'a pas été mesurée.

### CRM-012 — Droits fins par track et channel `[x]`
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
- [x] **~~Aucun écran, aucune capture, aucun test E2E d'interface.~~ INC-021 est close depuis
      `CRM-009`, et la preuve est acquise** : `e2e/ui/droits-fins.spec.ts`, **8 scénarios verts**,
      deux personnes réelles connectées **au clavier**. RÉVISÉE PAR LA DÉCISION 333 : Farida Nowak
      **voit** « Conseil & IA », parce qu'un de ses channels lui est rouvert, et **l'atteint au
      clic** — c'est le geste qui manquait. Son ouverture n'expose que l'onglet « Prospection », les
      autres channels du track restant fermés. Camille Aubert **porte la même ligne
      `access = 'none'`** et voit les quatre tracks — « un administrateur n'est jamais restreint »
      devient une image, pas une assertion. Saisir `/tracks/conseil-ia` à la main mène désormais au
      même écran que le clic, et l'adresse d'un channel fermé rend l'état vide neutre sans révéler
      son nom (§7). Sept captures observées, dont les quatre paliers, console silencieuse et aucun
      débordement horizontal.
- [x] **~~Preuve de refus n° 7 non acquise~~ — ACQUISE depuis `CRM-052`** sur les comptes
      **entrants** : avec le jeton réel d'un membre non administrateur, la boîte système et celle
      d'un collègue rendent **zéro ligne**, la contre-épreuve par la clé de service constatant que
      les trois lignes existent bien. La moitié restante — `mail_outbound_identities` — est due par
      `CRM-053`, et son absence reste **figée par une assertion**, non commentée.
- [x] **~~`app.can_read_card` non livrée~~ — livrée depuis par `CRM-040`**, migration
      `0011_cards.sql`, dernier point d'INC-013. La preuve n° 4 au niveau des cards l'accompagne, et
      `0013_valeurs_champs.sql` s'appuie déjà sur la fonction.
- [x] **~~Les politiques des tables d'identité ne sont pas écrites~~ — écrites depuis par
      `CRM-022`**, migration `0021_identites_et_memberships_surs.sql`. INC-014 est traitée là où
      elle devait l'être, et non par une unité qui touchait aux politiques par commodité.
- [x] **INC-085 et INC-075 CLOSES — décision 333, reprise livrée et prouvée le 2026-08-12.**
      `supabase/migrations/0034_lecture_track_transitive.sql` livre
      `app.track_has_readable_channel(uuid)` et élargit `tracks_lecture_membre` à « le track est
      lisible **ou** l'un de ses channels l'est ». MESURÉ avec le jeton du `viewer` seedé, avant
      puis après : tracks rendus **3 → 4**, channels rendus **4 → 4 (inchangé)**, channels du track
      réapparu **« Prospection » seul**, `PATCH` du `viewer` sur ce track **zéro ligne touchée** et
      nom relu intact, `insert … returning` d'administrateur **201** — la décision 107 n'est pas
      réintroduite. `npm run test:sql` **33 fichiers / 1944 assertions**, `npm run e2e:api`
      **504/504**, `npm run e2e:ui` **182/182**, `scripts/verify-authz.sh` **35 contrôles**,
      `scripts/verify-seed.sh` **55 contrôles**, `npm run typecheck` — aucune anomalie. Le triplet
      du `viewer` de `verify-authz.sh` passe de `3/4/8` à `4/4/8` : **seuls les tracks ont bougé**.
      Quatre preuves qui encodaient l'ancienne règle ont été **révisées en expliquant pourquoi dans
      le fichier même**, aucune supprimée ni relâchée.
- [x] ~~**INC-085 est ARBITRÉE et non close — décision 333, cette unité est rouverte.** La politique
      de lecture de `tracks` s'élargit : un track redevient lisible dès qu'un de ses **channels**
      l'est, `app.can_read_channel` étant consultée sur les channels du track. « Le plus spécifique
      gagne » devient transitif, et l'ouverture d'un tel track n'affiche **que les channels
      consentis** — la politique de lecture des `channels` filtre déjà, aucune règle nouvelle n'est
      créée. La même décision constate qu'**INC-075 décrit le même défaut** et se ferme avec elle.
      À reprendre dans le même changement : `supabase/migrations/0010_droits_fins.sql`, la matrice
      de `CRM-010`, `0011_droits_fins.test.sql`, `e2e/api/droits-fins.spec.ts`,
      `e2e/ui/droits-fins.spec.ts` — qui devra montrer « Conseil & IA » rendu à Farida avec son seul
      onglet « Prospection » —, `scripts/verify-droits-fins.sh` et `docs/SPEC-permissions-rls.md`
      §3.4. **Garde-fou de la décision 107 opposable** : les politiques évaluent les colonnes de la
      ligne, jamais une relecture de la table, faute de quoi un `insert … returning` rendra `403`.~~
- [x] ~~**Constat d'origine, conservé.** Farida porte aussi
      `channel_members.access = 'member'` sur « Prospection », channel du track qui lui est fermé.
      MESURÉ : l'API **rend** ce channel — la réouverture du plus spécifique fonctionne — mais
      **aucun geste de navigation n'y mène**, la barre d'onglets ne listant les channels qu'une
      fois un track ouvert. Un droit fin **accordé** est donc inexerçable là où un droit fin
      **retiré** est correctement observable. Ce n'est ni un défaut de RLS ni un masquage : c'est
      une surface manquante, et les trois options possibles changent soit la politique de lecture
      des tracks, soit la navigation, soit la règle elle-même. **Consignée, non résolue.**~~
      **RÉSOLUE le 2026-08-12** : la surface manquante existe, le geste de navigation aussi.

*DoD adaptée, écarts explicites.* La Definition of Done demandait « pgTAP sur la matrice de
résolution ; preuves de refus n° 3, 4, 7 et 11 ». La première est livrée, largement au-delà — la
matrice est éprouvée sur des lignes réelles, ce que `CRM-010` ne pouvait pas faire. Les preuves
n° 3, 4 et 11 sont acquises **au niveau des tracks et des channels**, la n° 4 au niveau des
**cards** par `CRM-040`, et **la n° 7 depuis `CRM-052`** pour les comptes entrants. **Les quatre
preuves de la Definition of Done sont donc tenues**. INC-085, dernier point ouvert, a été
**arbitrée par la décision 333 puis livrée et prouvée le 2026-08-12** — l'élargissement de la
politique de lecture des tracks, migration `0034` —, et INC-075 se ferme avec elle.

**TOUTES LES PREUVES DE LA DEFINITION OF DONE SONT VERTES. `CRM-012` PASSE `[x]`.**

*Limites nommées, non masquées.*

- **~~Aucun écran.~~** La neuvième unité consécutive à buter sur INC-021 a désormais sa preuve
  d'interface : INC-021 est close, et `e2e/ui/droits-fins.spec.ts` la remplace.
- **~~La preuve n° 7 n'a pas de sujet.~~** `CRM-052` lui en donne un, et elle est mesurée avec les
  jetons réels : un membre ne voit que sa propre boîte.
- **Un droit fin de channel accordé sous un track fermé n'a pas de surface** — INC-085, ouverte par
  cette preuve, **arbitrée par la décision 333** et non résolue ici : la politique de lecture des
  tracks s'élargira, et la limite tombera avec la reprise de cette unité.
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

### CRM-013 — Colonnes protégées `[~]`
`REVOKE` sur `secret_id`, `token_hash` ; `current_step_id` et `email_local_part` non modifiables
directement ; `card_events` et `audit_log` en écriture par trigger uniquement.
**DoD** : preuves de refus n° 5, 6 et 8 ; test explicite qu'une lecture refusée retourne **zéro
ligne** et non une erreur ambiguë.

- [x] **Spécification écrite avant tout code**, `docs/SPEC-permissions-rls.md` §4.4 : aucun document
      ne disait ce que `CRM-013` pouvait réellement livrer à cette place du plan, ni ce qu'un refus
      d'écriture de colonne rend, ni si le chemin d'**insertion** devait être fermé lui aussi.
      Rédigée **après mesure** sur la pile réelle — sondes créées puis détruites, codes HTTP et
      `SQLSTATE` relevés à la main —, avec un contrat d'API de **douze lignes** écrit avant le code
      pour être mesuré et non supposé. Commit documentaire dédié, poussé avant la première ligne
      de SQL.
- [x] **Le périmètre initialement livrable était UNE colonne, et il a été mesuré, non estimé**
      (décision 138). À la livraison, `to_regclass` rendait `NULL` pour
      `mail_inbound_accounts`, `mail_outbound_identities`, `api_tokens`, `card_events` et
      `audit_log`. Depuis, `CRM-044` a livré et protégé `card_events` ; **quatre tables restent
      réellement absentes**. `current_step_id` est fermée depuis `CRM-034` (INC-049) et
      `cards.email_local_part` par cette unité. L'unité **reste `[~]`** pour les quatre dépendances
      encore dues, chacune nommée plutôt que compensée.
- [x] **UNE PROPRIÉTÉ DE SÉCURITÉ ÉTAIT FAUSSE, ET LA MESURE L'A ÉTABLIE** (décision 139). Le
      trigger de `CRM-040` **génère** l'adresse d'une card ; il ne la **protège** pas, et le §3.4 de
      `docs/SPEC-cards.md` le disait en toutes lettres. MESURÉ avec le jeton réel de
      l'administratrice : `PATCH {"email_local_part":"c-00000000"}` rendait `200`, et la relecture
      confirmait la valeur. Les quarante bits de hasard sur lesquels `docs/SCHEMA.md` §5 fonde la
      non-devinabilité étaient rendus au client par une simple mise à jour.
- [x] `supabase/migrations/0014_colonnes_protegees.sql` : `revoke update` de table puis
      `grant update (…)` énumérant les **douze** colonnes qui restent ouvertes, et le commentaire de
      colonne mis à jour. **Aucune donnée touchée, aucune structure modifiée** : la migration ne
      pose que des privilèges.
- [x] **Ce que l'unité ne devait PAS changer est prouvé autant que ce qu'elle change**
      (décision 140). MESURÉ : un `POST` portant `"email_local_part":"c-zzzzzzzz"` rend `201` et
      enregistre une adresse **générée**. Le chemin d'insertion était déjà sûr ; le fermer aurait
      refusé une requête que le produit accepte sans dommage. Le privilège `INSERT` reste donc de
      table, et le trigger est **figé par deux assertions** — son existence et son type
      `BEFORE INSERT`.
- [x] **Aucun trigger de restauration, et le motif est écrit** (décision 141). Un `BEFORE UPDATE`
      remettant `OLD.email_local_part` rendrait `200` à un appelant qui croirait avoir renommé
      l'adresse : la « valeur par défaut trompeuse » que `CLAUDE.md` §18 proscrit. Un trigger levant
      une exception ferait double emploi avec le privilège, vérifié par le moteur avant toute
      exécution et valable pour tout chemin SQL.
- [x] **INC-050 est CLOSE, par exécution et non par arbitrage** (décision 142). Ses deux branches ne
      portaient que sur **l'attribution** de la colonne à une unité, jamais sur son état final,
      identique des deux côtés. L'énoncé de backlog de `CRM-013` tranche l'imputation sans rien
      décider à la place du responsable, et l'état posé coïncide **exactement** avec le bloc `GRANT`
      du §5.5 de `docs/SPEC-workflow-engine.md`.
- [x] **Test unitaire dédié** : `supabase/tests/0015_colonnes_protegees.test.sql`, **41 assertions,
      aucune anomalie** — la colonne fermée en écriture et ouverte en lecture, les douze colonnes
      ouvertes **énumérées une par une** et leur **total compté**, le refus opposable sous le rôle
      réel (`42501`), le trigger d'insertion et son effet, le seed intact, les quatre cibles
      absentes figées par des assertions d'absence et `card_events` sans aucun privilège
      d'écriture pour les trois rôles API.
- [x] **Test d'intégration dédié, hors interface** : `e2e/api/colonnes-protegees.spec.ts`, **12
      scénarios**, avec les jetons réels des trois profils seedés. Les douze lignes du contrat d'API
      du §4.4.4 y sont rejouées, chaque refus **relisant la ligne** pour la constater inchangée.
- [x] **Deux prédictions confirmées, une ligne révisée par la mesure.** Les lignes *c* et *d* du
      contrat étaient signalées comme des prédictions : le refus porte bien sur l'**instruction
      entière** — le titre d'une écriture mixte n'est pas modifié non plus — et réécrire la valeur
      **courante** est refusé tout autant, le privilège se vérifiant sur les colonnes nommées. La
      ligne *g* annonçait « refus » ; MESURÉ, l'anonyme obtient `401` et non `403`. Le contrat est
      corrigé, pas le test relâché.
- [x] **Preuves de refus n° 4 et n° 11 reconduites** au niveau des cards : le `viewer` fermé sur le
      track ne voit aucune des cinq cards de `grands-comptes` ; l'anonyme obtient `200` et `[]` sur
      une table qui en porte neuf. Le refus est mesuré comme **zéro ligne**, jamais comme une erreur.
- [x] **Trois garde-fous posés par `CRM-034` et `CRM-040` ont échoué comme prévu, et ont été
      RETOURNÉS** (mécanisme de la décision 51, dixième occurrence) : `supabase/tests/0012_cards.test.sql`,
      `supabase/tests/0013_move_card.test.sql` et `scripts/verify-move-card.sh`. **Aucun n'a été
      retiré** : le `lives_ok` devient un `throws_ok`, et les deux constats d'INC-050 constatent
      désormais la fermeture **et** la dépendance d'ordre qui la menace.
- [x] **Build vert**, `npm run typecheck` vert sur les quatre projets, `npm run types:check` vert.
      `npm run test:sql` **1093 assertions**, `npm run test:unit` **164 tests**, `npm run e2e:api`
      **254 scénarios**, `npm run e2e:ui` **37 scénarios** — ce dernier au prix du contournement
      récurrent d'INC-036 (**septième** occurrence). Les quatre captures réécrites par ce rejeu ont
      été **regardées puis restaurées**, comme aux six unités précédentes : cette unité ne touche
      aucun composant de l'interface, et l'écran reste celui d'un appelant anonyme. La seule
      différence observée est l'état de survol laissé par le pointeur du pilote, déjà décrit par
      `CRM-032`.
- [x] Harnais de preuves rejouable `scripts/verify-colonnes-protegees.sh` : **50 contrôles, aucune
      anomalie** — 44 hors suites, 50 avec elles, et **non complaisant** — la colonne rendue à la main fait passer une écriture qui
      doit être refusée, et la restauration est **constatée**, pas supposée. Il mesure aussi la
      **dépendance d'ordre 12 → 14 dans les deux sens** : rejouer la migration 12 seule rouvre la
      colonne.
- [x] **UN DÉFAUT RÉEL DANS LE HARNAIS QUE J'ÉCRIVAIS, TROUVÉ PAR `npm run test:sql`**
      (décision 145). Sa première écriture rejouait la migration 12 puis la 14, **sans la 13** — qui
      redéfinit `move_card` avec sa sixième vérification. Le produit sortait donc avec une garde à
      **cinq** vérifications, et quatre fichiers pgTAP l'ont dénoncé. C'est la décision 135
      reproduite à l'identique, par le harnais suivant. Corrigé : séquence 12 → 13 → 14, et un
      contrôle explicite constate que `move_card` a retrouvé sa sixième garde. **Et ce n'est pas une
      coïncidence** : une autre exécution de la routine a corrigé le même mode de défaillance sur
      `scripts/verify-cards.sh` le même jour (décision 143, INC-055). Troisième et quatrième
      occurrences ; la question d'inscrire la règle dans `docs/SPEC-test-harness.md` plutôt que de
      la corriger harnais par harnais est posée en **INC-055**, à l'arbitrage.
- [x] **`scripts/verify-cards.sh` reprend la migration 14 dans sa séquence de restauration**, à la
      suite de la correction ci-dessus : il rejoue 11 → 12 → 13, et rejouer la 12 rouvre
      `email_local_part`. Sans cet ajout, le harnais de `CRM-040` aurait défait `CRM-013` en
      sortant.
- [x] **UNE QUATRIÈME OCCURRENCE, TROUVÉE PAR LE CONTRÔLE DE CLÔTURE ET NON PAR UN TEST**
      (décision 145). Avant de clore, l'état de la base a été relu : `email_local_part` était
      **ouverte** après un balayage complet des harnais. Recherche par élimination, un harnais à la
      fois : `scripts/verify-valeurs-champs.sh` rejoue la migration 12 en **trois** endroits et ne
      rejouait ensuite que la 13. Il sortait sur une base dégradée **en annonçant « 33 contrôles,
      aucune anomalie »**. Ce harnais n'était pas fautif à son écriture — la migration 14 n'existait
      pas ; c'est `CRM-013` qui l'a rendu défaillant, et donc à `CRM-013` de le reprendre. Corrigé :
      la 14 suit chacun des trois rejeux, le ménage de sortie la rejoue, et un **contrôle neuf
      constate** la colonne refermée (34 contrôles au lieu de 33).
- [x] **Les vingt-deux harnais ont été passés un par un, en relevant l'état de la colonne après
      chacun** : `verify-valeurs-champs` était le seul à la laisser ouverte, et il ne l'est plus.
      Une migration qui retire un privilège crée une dette rétroactive sur tout harnais rejouant une
      migration antérieure ; la trouver exige de mesurer, pas de se souvenir.
- [x] **UN SECOND DÉFAUT, QUE SEULE UNE BASE FROIDE POUVAIT RÉVÉLER — INC-056** (décision 144).
      Trois garde-fous de `CRM-031`, `CRM-035` et `CRM-036` comptaient à l'échelle du **workspace**
      les transitions à `require_fields` non vide, et attendaient `1`. MESURÉ sur un cluster neuf :
      **2** — le seed pose ce tableau à sa section 6 et crée la copie de workflow à sa section 7,
      laquelle en hérite (INC-037). Les contrôles mesuraient l'**âge de la base**, non le produit,
      et `./resetMe.sh` ne reproduisait pas l'état sur lequel les preuves avaient été écrites,
      contre `CLAUDE.md` §8. Comportement **inchangé** — il appartient à `CRM-032` et `CRM-005` ;
      les trois contrôles sont rendus déterministes et l'héritage est **compté séparément**.
- [x] **Compteurs de `scripts/verify-harness.sh` révisés dans le MÊME changement** que les preuves
      qu'ils comptent — sans le retard que `CRM-036` avait dû rattraper sur quatre unités :
      1051 → **1093** assertions, 242 → **254** scénarios d'API.
- [x] **Aucune régression : les vingt et un harnais précédents rejoués** — `verify-stack` 33,
      `verify-scripts` 52 (dont **1 anomalie connue**, INC-044, voir ci-dessous),
      `verify-migrations` 23, `verify-vault` 26, `verify-authz` 26, `verify-auth` 42, `verify-seed`
      49, `verify-types` 30, `verify-webapp` 41, `verify-harness` 25, `verify-tracks` 40,
      `verify-channels` 23, `verify-catalogue` 32, `verify-workflows` 42, `verify-copie-workflow`
      27, `verify-coherence-workflow` 26, `verify-champs-formulaire` 31, `verify-droits-fins` 35,
      `verify-cards` 37, `verify-move-card` 55, `verify-valeurs-champs` 33.
- [x] `docs/SPEC-permissions-rls.md` §4.3, §4.4, §7, `docs/SPEC-cards.md` §3.4 et §6.3,
      `docs/SPEC-workflow-engine.md` §5.5, `docs/SCHEMA.md` §5, `docs/PROD_MIGRATIONS.md` §3
      (migration 14), `docs/manual.md` chapitres 12 et 4.2, `README.md` §7, `CHANGELOG.md`,
      `docs/INCONSISTENCY_REPORT.md` (INC-050 close, INC-056 ouverte) mis à jour dans le même
      changement.
- [ ] **QUATRE CIBLES SUR SIX NE SONT PAS LIVRÉES, ET LEURS TABLES N'EXISTENT PAS** :
      `mail_inbound_accounts.secret_id` (`CRM-052`), `mail_outbound_identities.secret_id`
      (`CRM-053`), `api_tokens.token_hash` (`CRM-073`) et `audit_log` (`CRM-072`). La preuve de
      refus n° 6 reste donc hors d'atteinte et la n° 8 reste incomplète pour `audit_log`. Chaque
      absence est figée par une assertion pgTAP **et** par un contrôle du harnais, qui deviendront
      rouges à la naissance de la table et désigneront alors le `REVOKE` à écrire. **Bloqué par
      une dépendance, pas par un défaut de l'unité.**
- [x] **`card_events` est livrée et protégée depuis `CRM-044`** : aucun privilège d'écriture pour
      `anon`, `authenticated` ou `service_role`, alimentation uniquement par les triggers privés.
      La suite pgTAP et `scripts/verify-colonnes-protegees.sh` mesurent désormais cet état au lieu
      de continuer à attendre l'absence historique de la table.
- [x] **Aucun écran propre à cette ACL de colonne n'est dû.** Depuis `CRM-009`, la webapp possède
      une connexion réelle et ses parcours authentifiés sont rejoués par les **144 scénarios UI à
      console stricte**. Cette règle backend reste, par construction, invisible : elle est prouvée
      sous les jetons réels en base et par l'API, tandis que la campagne UI confirme qu'elle ne
      régresse aucun geste utilisateur. Aucune capture spécifique ne serait une preuve de
      privilège de colonne.
- [x] **Le seed n'a pas été mis à jour, et il n'y avait rien à y ajouter.** Cette unité ne crée ni
      table, ni colonne, ni statut, ni flux : elle retire un privilège. Les quatorze cards du seed
      courant démontrent la règle — leur adresse est générée, et non réécrivable. Trois assertions
      et trois contrôles constatent le seed **intact** après passage du harnais.

*DoD adaptée, écarts explicites.* La Definition of Done demandait « preuves de refus n° 5, 6 et 8 ;
test explicite qu'une lecture refusée retourne zéro ligne ». La n° 5 était **déjà acquise par
`CRM-034`** (INC-049). Le second point est livré — lignes *j* et *k* du contrat, mesurées comme zéro
ligne et non comme une erreur. Les n° 6 et n° 8 ne l'étaient pas à cette place du plan, et l'absence
est nommée plutôt que compensée par une preuve de substitution. **Aucun test E2E d'interface, aucune
vérification visuelle** : l'unité ne livre aucun écran.

*Limites nommées, non masquées.*

- **Aucun écran dédié.** C'est la nature de l'ACL ; INC-021 a depuis été close par `CRM-009` et la
  non-régression utilisateur est couverte par la campagne UI globale.
- **`service_role` conserve l'écriture sur la colonne**, et le seed en dépend. Un service porteur de
  cette clé — `mail-sync` à partir de `CRM-051` — ne serait donc arrêté par rien s'il se trompait de
  colonne. Aucun consommateur n'existe aujourd'hui ; la question devra être reposée à ce moment-là.
- **Le refus divulgue la commande `GRANT` à exécuter**, dans son `hint`. Comportement de PostgREST,
  **cinquième occurrence d'INC-026**, inchangé et non masqué — un scénario le constate plutôt que de
  laisser la divulgation devenir invisible à force d'être habituelle.
- **`scripts/verify-scripts.sh` rend 1 anomalie sur 52**, et elle est **connue et inchangée** :
  INC-044, la garde de ports est inerte faute de `ss` et de `netstat` sur l'hôte. Elle ne relève pas
  de cette unité, et la masquer serait exactement ce que `CLAUDE.md` §18 interdit.
- **Sur l'hôte de vérification, la chaîne s'exécute sous Node 22.22.2**, alors que le dépôt exige
  Node 24. Limite héritée, inchangée.
- **Trois contournements hors dépôt ont dû être refaits**, comme les entrées correspondantes le
  prédisaient : démon Docker lancé à la main (`dockerd --host=…`), image `webapp` construite avec le
  certificat du proxy suivie d'un `npm ci` précédé d'un `npm config set cafile` (INC-032, INC-042),
  et l'arborescence de compatibilité des navigateurs Playwright (INC-036, **septième** occurrence).

### CRM-014 — Harnais de preuves d'autorisation `[~]`
Projet Playwright `api` exécutant les douze scénarios de refus avec les jetons réels de chaque
profil.
**DoD** : les 12 scénarios verts ; le harnais échoue si une politique est retirée (vérifié en
retirant temporairement une politique).

- [x] **Spécification écrite avant tout code**, `docs/SPEC-permissions-rls.md` §7.1 à §7.4 : aucun
      document ne disait **combien** des douze preuves étaient satisfaisables, alors que onze unités
      successives avaient écrit que telle ou telle « restait due par `CRM-014` ». Rédigée **après
      mesure** — les douze scénarios rejoués à la main contre la pile réelle, avec les jetons réels,
      codes HTTP et `SQLSTATE` relevés. Commit documentaire dédié, poussé avant la première ligne
      de code.
- [x] **Le périmètre livrable est SEPT preuves sur douze, et il est mesuré, non estimé**
      (décision 146). Acquises : n° 1, 2, 3, 4, 5, 10 et 11. Non satisfaisables : n° 6, 7, 8, 9
      et 12, dont l'objet **n'existe pas**.
- [x] **UNE PREUVE ÉTAIT ANNONCÉE SANS EXISTER — INC-057.** L'en-tête `@verifies` de
      `e2e/api/cards.spec.ts` déclare porter la preuve n° 3 ; recherche faite, elle n'y est pas, et
      l'énoncé de `CRM-040` dans ce backlog ne l'annonçait d'ailleurs pas. Consignée **sans être
      corrigée** dans le fichier d'une autre unité, et la preuve est écrite ici.
- [x] **Test unitaire dédié** : `supabase/tests/0016_preuves_refus.test.sql`, **46 assertions,
      aucune anomalie** — l'inventaire des **41** politiques de `public`, table par table, nom par
      nom **et** par un compte ; la RLS activée sur toutes les tables ; les **douze** conditions de
      validité de la preuve n° 11 ; les causes en base des preuves n° 1, n° 4 et n° 5 ; les sept
      assertions d'absence.
- [x] **Test d'intégration dédié, hors interface** : `e2e/api/preuves-refus.spec.ts`, **37
      scénarios**, avec les jetons réels des trois profils seedés obtenus par la véritable route de
      connexion. Les douze preuves y sont **nommées une à une**, et le harnais vérifie qu'elles ont
      toutes été réellement exécutées — sur la sortie de Playwright, non sur le texte du fichier.
- [x] **La preuve n° 3 sur les cards est livrée sur une chaîne complète** : workspace, track,
      workflow, nœud, étape initiale, channel et card créés dans un **second** workspace avec la clé
      de service, la card constatée **présente**, puis invisible aux trois profils du workspace A ;
      son `PATCH` par un administrateur de A rend `200` et `[]` sans effet, la ligne étant relue.
      Le seed ne fournit aucun second workspace (`docs/SPEC-seed.md` §8) : `CRM-014` fabrique le
      sien et le **détruit**, plutôt que d'étendre un seed qui appartient à `CRM-005` et `CRM-046`.
- [x] **La preuve n° 11 passe de trois tables à douze.** `CRM-008` l'exerçait sur le seul socle,
      `track_members` et `channel_members` étant alors vides — un « zéro ligne » sur une table vide
      ne prouvant rien. Les douze tables métier sont aujourd'hui peuplées, **énumérées** et non
      échantillonnées, et chaque scénario constate la table non vide avec la clé de service avant
      d'affirmer que l'anonyme n'y lit rien.
- [x] **UNE PRÉDICTION DE MA PROPRE SPÉCIFICATION ÉTAIT FAUSSE, ET LA DÉGRADATION L'A ÉTABLIE**
      (décision 151). Le §7.4 annonçait que retirer `cards_lecture` ferait échouer les scénarios
      n° 3, n° 4 et n° 11. MESURÉ : `drop policy cards_lecture` puis exécution → **37 passed**,
      aucun échec. Une suite composée de preuves de refus mesure une **borne supérieure** des
      droits : un produit devenu plus strict satisfait toutes ses assertions. Même la preuve n° 1
      reste verte, `move_card` étant `SECURITY DEFINER` et n'interrogeant pas la politique. La
      spécification est **corrigée**, le contrôle n'est pas relâché, et le harnais **assère
      désormais ce fait** au lieu d'espérer un échec qui n'arrive pas.
- [x] **Harnais de preuves rejouable `scripts/verify-preuves-refus.sh` : 26 contrôles, aucune
      anomalie** — 21 hors suites —, et **non complaisant dans les deux sens** : une politique
      **retirée** fait échouer l'inventaire pgTAP ; une politique **permissive** posée sur `cards`
      pour `anon` fait échouer **exactement un** scénario, la preuve n° 11 sur les cards, et le
      compte de 41 politiques. La ligne d'échec est isolée par son numéro — chercher « PREUVE N° 11 »
      dans toute la sortie matcherait aussi les scénarios **verts**, faux positif mesuré à
      l'écriture et corrigé.
- [x] **Restauration constatée, non supposée** : l'inventaire complet des politiques — nom, table,
      commande, rôles, `USING`, `WITH CHECK` — est relevé avant dégradation et comparé après. Le
      seed est constaté intact : neuf cards, un seul workspace, aucun résidu du second.
- [x] **Aucune migration rejouée** (décision 150). Les quatre défaillances d'INC-055 venaient toutes
      d'un harnais rejouant un préfixe incomplet de l'historique. Celui-ci dégrade au niveau où il
      vérifie et recrée la politique à partir de sa définition **lue en base** avant retrait.
- [x] **Build vert**, `npm run typecheck` vert sur les quatre projets. `npm run test:sql`
      **1139 assertions**, `npm run e2e:api` **291 scénarios**, `npm run test:unit` vert,
      `npm run e2e:ui` **37 scénarios** — ce dernier au prix du contournement récurrent d'INC-036
      (**huitième** occurrence). Les trois captures réécrites par ce rejeu ont été **regardées puis
      restaurées**, comme aux sept unités précédentes : cette unité ne touche aucun composant de
      l'interface, et l'écran reste celui d'un appelant anonyme. La seule différence observée est
      l'état de survol laissé par le pointeur du pilote, déjà décrit par `CRM-032`.
- [x] **Compteurs de `scripts/verify-harness.sh` révisés dans le MÊME changement** que les preuves
      qu'ils comptent, et sans retard : 1093 → **1139** assertions, 254 → **291** scénarios d'API.
      `scripts/verify-harness.sh` rejoué : **25 contrôles, aucune anomalie**.
- [x] **Les vingt et un harnais précédents rejoués en mode COMPLET**, l'état de la base relevé après
      chacun — `41` politiques et `email_local_part` fermée, **invariants** : `verify-stack` 33,
      `verify-scripts` 52 (dont **1 anomalie connue**, INC-044), `verify-migrations` 23,
      `verify-authz` 26, `verify-auth` 42, `verify-seed` 49, `verify-types` 30, `verify-webapp` 41,
      `verify-harness` 25, `verify-tracks` 43, `verify-channels` 30, `verify-catalogue` 39,
      `verify-workflows` 49, `verify-copie-workflow` 34, `verify-coherence-workflow` 33,
      `verify-champs-formulaire` 38, `verify-droits-fins` 42, `verify-move-card` 56,
      `verify-valeurs-champs` 40, `verify-colonnes-protegees` 50. **Aucune dette rétroactive** de la
      sorte que `CRM-013` avait laissée.
- [x] **UNE CONTRADICTION ENTRE DEUX HARNAIS, TROUVÉE PAR CE BALAYAGE — INC-058** (décision 152).
      `scripts/verify-cards.sh` rend `45 contrôles, 1 en échec` en mode **complet** : son
      `npm run test:sql` échoue sur trois assertions de `CRM-013` — « les neuf cards du seed sont
      intactes ». MESURÉ en échantillonnant le compte de cards pendant l'exécution : il vaut **14**
      puis **9**, le harnais retirant ses cinq cards dans son `trap EXIT`, donc **après** la section
      qui lance les suites. Ni défaut du produit, ni mesure fausse : une composition contradictoire.
      **Vérifié comme antérieur à `CRM-014`** — la suite `0016` retirée du répertoire, l'échec est
      identique. Comportement **inchangé**, consigné avec trois options d'arbitrage : les deux
      fichiers appartiennent à `CRM-040` et `CRM-013`.
- [x] `docs/SPEC-permissions-rls.md` §7, §7.1 à §7.4, §8, `docs/SPEC-test-harness.md` §4.6, §8,
      §10, `docs/DAT.md` §7, `README.md` §7, `CHANGELOG.md`, `docs/JOURNAL.md` (décisions 146
      à 152), `docs/INCONSISTENCY_REPORT.md` (INC-057 et INC-058 ouvertes) mis à jour dans le même
      changement.
- [ ] **QUATRE PREUVES SUR DOUZE RESTENT HORS D'ATTEINTE, ET LEURS OBJETS N'EXISTENT PAS** : n° 6
      (`mail_inbound_accounts`, `CRM-052`), n° 7 (`mail_outbound_identities`, `CRM-053`), n° 9
      (aucune table de pièces jointes, aucun bucket de storage), n° 12 (`queue_outbound_email`,
      `CRM-058`). Chaque absence est figée par une assertion pgTAP **et** par un scénario d'API, qui
      deviendront rouges à la naissance de leur objet et désigneront alors la preuve à écrire.
      **Bloqué par une dépendance, pas par un défaut de l'unité.**
- [~] **La preuve n° 8 est À MOITIÉ ACQUISE, et l'inventaire le dit désormais.** `card_events`
      existe depuis `CRM-044` : son refus est **mesuré** — `403`, `42501`, `service_role` compris —
      et non plus attendu. `audit_log` reste due par `CRM-072`. L'inventaire du fichier consolidé
      la comptait encore parmi les cinq non satisfaisables : **il masquait une preuve réellement
      acquise**, et il est corrigé en trois catégories plutôt qu'en deux.
- [x] **~~La preuve n° 10 n'est acquise que dans son EFFET, pas dans sa règle.~~ Acquise dans sa
      règle depuis `CRM-022`** : `workspace_members` porte ses quatre politiques, et l'invariant du
      dernier administrateur est différable. MESURÉ : se retirer son rôle rend `23514`
      `last_workspace_admin`, et supprimer sa dernière appartenance rend le même refus. INC-014 est
      traitée là où elle devait l'être.
- [x] **~~Aucun écran, aucune capture, aucun test E2E d'interface.~~ Aucun écran n'est dû, et la
      raison n'est plus INC-021 — close par `CRM-009`.** Cette unité est un **harnais de preuves**,
      pas une surface : ce qu'elle éprouve est par construction ce que l'écran ne montre jamais. La
      non-régression utilisateur est couverte par la campagne UI, à console stricte ; une capture
      spécifique ne serait pas une preuve de refus. Même raisonnement que `CRM-013`.
- [x] **Le seed n'a pas été étendu, et le choix est documenté.** La preuve n° 3 exige un second
      workspace ; `CRM-014` le fabrique et le détruit, comme `scripts/verify-authz.sh`, plutôt que
      d'étendre un seed qui appartient à `CRM-005` et `CRM-046` (`docs/SPEC-seed.md` §8). Rien
      d'autre n'était à ajouter : l'unité ne crée ni table, ni colonne, ni statut, ni flux.

*DoD adaptée, écarts explicites.* La Definition of Done demandait « les 12 scénarios verts ». Les
douze scénarios **existent et sont verts**, mais cinq d'entre eux n'assèrent pas un refus : ils
assèrent que le sujet du refus **n'existe pas**. La différence est nommée plutôt que masquée par une
formulation qui laisserait croire à douze refus prouvés. Le second point — « le harnais échoue si
une politique est retirée » — est **livré et mesuré**, et la mesure a montré que c'est l'inventaire
pgTAP, non les scénarios HTTP, qui porte cette détection (décision 151). **Aucun test E2E
d'interface, aucune vérification visuelle** : l'unité ne livre aucun écran.

*Limites nommées, non masquées.*

- **Quatre preuves sur douze restent dues**, et une cinquième — la n° 8 — l'est à moitié. Leurs
  unités sont nommées ci-dessus.
- **~~Aucun écran.~~** La douzième unité consécutive à buter sur INC-021 n'en bute plus : INC-021
  est close, et cette unité ne doit aucun écran par nature.
- **La duplication avec les quatorze autres fichiers de scénarios est assumée** (§7.1,
  décision 147) : les preuves des unités précédentes ne sont ni retirées ni déplacées, les retirer
  rouvrirait sept unités dans un commit qui n'en traite qu'une.
- **Une suite de preuves de refus ne vérifie jamais qu'un profil légitime OBTIENT ce qui lui est
  dû** (décision 151). Cette moitié-là vit dans les contrats d'API de chaque unité, pas ici, et
  aucune unité du backlog ne porte nommément son inventaire.
- **`scripts/verify-scripts.sh` rend 1 anomalie sur 52**, connue et inchangée : INC-044, la garde de
  ports est inerte faute de `ss` et de `netstat` sur l'hôte. Elle ne relève pas de cette unité.
- **Sur l'hôte de vérification, la chaîne s'exécute sous Node 22.22.2**, alors que le dépôt exige
  Node 24. Limite héritée, inchangée.
- **Trois contournements hors dépôt ont dû être refaits**, comme les entrées correspondantes le
  prédisaient : démon Docker lancé à la main, pile démarrée **sans** le service `webapp` faute de
  pouvoir construire son image derrière le proxy à certificat interposé (INC-032, INC-042), et
  l'arborescence de compatibilité des navigateurs Playwright (INC-036, **huitième** occurrence).

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

**Arbitrage du responsable — `docs/JOURNAL.md`, décision 259 (INC-003).** Le workflow par défaut
déclare une sortie vers « Perdu » depuis Prospection, Relance, Négociation et Signature, mais
**pas depuis Réalisation** : une affaire signée puis abandonnée en cours de réalisation n'a aucun
chemin vers « Perdu ». Interrogé sur l'origine de l'oubli, le responsable a répondu qu'il avait
**listé des exemples** et attendait des propositions — l'oubli est donc celui de l'agent, qui a
recopié les exemples comme s'ils étaient le graphe complet.

- [x] **Transition « Réalisation en cours → Perdu » ajoutée**, libellé « Marquer perdu »,
      **commentaire exigé** comme les quatre autres sorties vers Perdu. Le seed passe de dix à
      **onze** transitions, et la copie dérivée l'hérite : les deux workflows en portent onze,
      MESURÉ après `./resetMe.sh`. INC-003 est close.
- [x] **Graphe relu en entier**, et non seulement complété au point signalé. Cinq étapes sur sept
      ont au moins une sortie ; les deux qui n'en ont pas — `Livré` et `Perdu` — sont **justifiées
      par leur issue** : `won` et `lost` sont les deux fins du cycle, et une sortie y contredirait
      la notion même d'issue. Aucun autre cul-de-sac.
- [x] **Douze preuves qui figeaient l'ABSENCE vérifient désormais la PRÉSENCE.**
      `scripts/verify-workflows.sh` asserait « `Réalisation → Perdu` n'est pas déclarée : le point
      ouvert n° 1 est tenu » — une absence prouvée ne se distingue plus d'une règle, et c'est ce qui
      a rendu l'oubli durable. Révisées : `verify-workflows` 49, `verify-board` 56,
      `verify-copie-workflow` 35, `verify-move-card` 56, plus les suites `board.spec.ts`,
      `workflows.spec.ts`, `copie-workflow.spec.ts` et la fixture pgTAP `0021`, qui occupait
      justement le couple désormais déclaré.
- [x] **Règle générale qui en découle** : lorsqu'un document du responsable donne une **énumération
      d'exemples**, l'agent ne la recopie pas telle quelle — il la complète, propose le résultat, et
      **nomme** ce qu'il a ajouté. Écrite au journal, décision 259.

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
- [x] **LE BUILD RESTE SANS AVERTISSEMENT À MESURE QUE LE PRODUIT GRANDIT** (décision 248).
      Mesuré après `CRM-050`, le seul chunk JavaScript atteint **530,59 kB minifiés** et Vite
      avertit au-delà de 500 kB. La correction découpe `RouteTrack` et `RouteCard` par imports
      dynamiques : l'écran de connexion ne doit plus télécharger le board, la liste, le formulaire
      et la timeline avant qu'un utilisateur n'ouvre une route métier. Le seuil Vite reste à sa
      valeur par défaut ; le chargement différé rend un squelette accessible, puis les parcours
      utilisateur existants prouvent que les deux routes restent praticables. **Résultat mesuré :**
      quatre chunks JavaScript, dont le plus gros pèse **477,86 kB**, aucun avertissement Vite,
      **525 tests unitaires** et **144 scénarios UI sur 144**.
- [x] **Jetons du design system en variables CSS**, un seul fichier autorisé à porter des
      hexadécimaux (`webapp/src/styles/tokens.css`). Les espaces de noms de Tailwind sont
      **remis à zéro** : `bg-red-500` et `p-7` n'existent pas. Chaque couleur de la charte n'a
      **qu'une déclaration** dans le CSS produit, et aucune ne figure dans le corps d'une règle de
      classe.
- [x] **Garde née d'un défaut réel** : une classe dont le jeton manque n'est pas engendrée, en
      silence — `min-w-0` avait ainsi disparu, et la page défilait horizontalement sous 768 px.
      `scripts/lib/classes-css.mjs` vérifie désormais que **chaque classe citée existe dans le CSS
      produit**, et échoue sur un `px-7`. Sa reprise distingue les classes réellement invalides
      (`text-muted`, `placeholder:text-muted`, palier `sm`) du faux positif sur
      `before:content-['·']` : **167 classes sur 167** sont engendrées, et la contre-épreuve
      `px-7` rend exactement le code `1` (décision 267).
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
- [x] **Console navigateur incluse dans le verdict de chaque scénario UI** : tout `warning`,
      `error` ou `pageerror` résiduel fait échouer Playwright. Les scénarios qui provoquent
      volontairement un refus HTTP doivent d'abord vérifier son effet visible, puis consommer le
      message **exact** attendu ; aucun filtre global ni motif large ne peut cacher une anomalie.
      Suite complète mesurée : **144/144**, aucune anomalie console résiduelle.
- [x] **Régression révélée par Chromium 151 : favicon explicite.** Le navigateur demande
      `/favicon.ico` lorsqu'aucun `link rel="icon"` n'existe ; `vite preview` rend `404` et chacun
      des sept parcours `CRM-009` échoue grâce à la garde console ci-dessus. Le point d'entrée doit
      référencer un SVG de marque servi avec le build, puis la suite complète doit revenir à zéro
      anomalie. Le monogramme `public/favicon.svg` est maintenant référencé explicitement ; la
      suite complète revient à **144/144**, console vide. Contrat : `docs/SPEC-webapp.md` §3.1 et
      `docs/DESIGN_SYSTEM.md` §9.
- [x] **Service `webapp` conteneurisé** livré : `runDev.sh` cesse de l'annoncer comme dû.
      `node:24-alpine` — **le prérequis Node 24 du dépôt y est exercé pour la première fois** :
      build, 96 tests et compilation rejoués verts dans le conteneur.
- [x] Harnais de preuves rejouable `scripts/verify-webapp.sh` : **42 contrôles, aucune anomalie**,
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

- **Limite historique close par `CRM-011`.** À la livraison de cette coquille, aucun écran de
  connexion n'existait et `CRM-012` n'avait pas encore livré les politiques métier. La reprise de
  `CRM-011` restaure désormais la session avant les lectures ; INC-021 est close. Les tables
  d'identité restent, elles, soumises à INC-014.
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

### CRM-009 — Écran de connexion `[x]`
Écran `/connexion`, garde de route, posture de session, gabarits d'emails transactionnels servis
en français.
**DoD** : E2E de connexion **et** de refus ; après connexion, `localStorage` reste **vide** et
`sessionStorage` porte la session ; après fermeture du contexte, rien ne subsiste ; un email
transactionnel est vérifié **sur son contenu**, jamais sur sa seule présence.

Unité créée par arbitrage du responsable — `docs/JOURNAL.md`, décision 253, INC-021. Elle se place
dans l'ordre d'exécution **entre `CRM-007` et `CRM-008`** : la coquille existe avant l'écran, et le
harnais vient après ce qu'il doit exercer.

**Clôture mesurée.** `docs/SPEC-auth.md` §9
avait rattaché ce parcours à `CRM-011` « selon l'option la plus étroite » — c'est-à-dire
**l'option 1** des trois soumises, alors que le responsable a retenu **l'option 2**. L'écran, la
garde de route et la posture de session ont donc été livrés et prouvés sous `CRM-011`. Le
comportement était conforme ; le **rattachement** était faux. La traçabilité est désormais
corrigée et le parcours destinataire complète le contrat initial.

- [x] **Écran `/connexion` et garde de route** — livrés, mais sous `CRM-011`. `CRM-011` a par
      ailleurs livré et prouvé le **mécanisme** d'authentification sur 62 contrôles hors interface :
      c'est ce mélange de deux sujets, qui n'ont ni les mêmes preuves ni le même risque, que
      l'arbitrage écarte.
- [x] **Session en `sessionStorage`**, décision 254 : le client `supabase-js` est **explicitement**
      configuré — `persistSession` actif, `storage` visant `sessionStorage`, repli mémoire si ce
      stockage est indisponible — plutôt que laissé à son défaut, qui écrirait dans `localStorage`
      et tomberait sous `CLAUDE.md` §11. Un `F5` ne déconnecte pas ; la fermeture de l'onglet, si.
      `docs/SPEC-auth.md` §9.2. Preuve acquise hors interface autant que dedans.
- [x] **Consommer le retour d'un email transactionnel** (décision 273) : le client accepte le
      fragment de session émis par GoTrue, valide réellement son utilisateur, retire les jetons de
      l'URL et persiste la session dans le même `sessionStorage` limité à l'onglet. La preuve exige
      un `localStorage` vide et une URL débarrassée de tout jeton après le clic destinataire.
- [x] **Contrat des gabarits écrit avant le code**, `docs/SPEC-auth.md` §5 : service Caddy interne
      commun aux assemblages, quatre URL et sujets français, dépendance saine de GoTrue, contenu
      vérifié dans le message SMTP réel. La limite HTML seul de GoTrue 2.189.0 est mesurée et
      distinguée du texte que reconstruit Inbucket.
- [x] **Reprendre la traçabilité** : les commentaires `@spec` du code livré, les `@verifies` des
      preuves et `docs/DAT.md` §3.1 citent maintenant `CRM-009`. Aucun changement de comportement.
- [x] **Gabarits d'emails transactionnels servis en HTTP** depuis la pile, décision 264. Les quatre
      fichiers français sont servis par `auth-templates`, service Caddy commun et non publié sur
      l'hôte ; GoTrue attend sa sonde saine. `scripts/verify-auth.sh` rend **62/62**.
- [x] **Exigence attachée, qui vaut au-delà de cette unité** : toute preuve portant sur un email
      vérifie son **contenu**, jamais sa seule présence. Un email reçu ne prouve pas que le gabarit
      configuré a été employé — c'est précisément ce que la mesure a montré. La preuve comporte
      aussi un parcours Chromium de la boîte au lien d'invitation, comme un destinataire.
- [x] **Action réellement visible dans le client rendu** (décision 274) : les quatre gabarits
      emploient un bouton email robuste à l'assainissement des styles de lien. Chromium vérifie le
      fond bleu et le texte blanc calculés dans Inbucket, puis la capture observée doit montrer
      l'action, le code et le contenu français — une ancre seulement présente dans le DOM ne suffit
      pas. La capture observée `docs/captures/CRM-009/invitation-francaise-destinataire.jpg`
      montre le contenu, l'action bleue à texte blanc et le code.
- [x] **Conséquence de fermeture acquise** : cette unité était la condition de fermeture de **dix-huit unités
      `[~]`** dont le code est livré et prouvé. Elles ne passeront pas `[x]` d'un trait de plume :
      chacune reste à reprendre, sa preuve manquante réellement exécutée, et son état révisé sur
      mesure. Cette dépendance n'empêche plus leur audit individuel.

### CRM-008 — Harnais de tests `[x]`
pgTAP, Vitest et Playwright (`api`, `ui`, `mail`) ; pytest naît avec `mail-sync` en `CRM-051`.
**DoD** : chaque commande du `README.md` §7 dont le sujet existe s'exécute ; un test volontairement
faux échoue bien. Périmètre arbitré par le responsable — décision 277, INC-023, option 2.

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
- [x] Harnais de preuves rejouable `scripts/verify-harness.sh` : **28 contrôles, aucune anomalie**,
      et **non complaisant, éprouvé par six dégradations réelles** — une assertion fausse dans une
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
- [x] **`pytest mail-sync/tests` est explicitement hors du périmètre de cette unité** (décision
      277). Aucun code Python n'existe encore ; la commande appartient à `CRM-051`, qui porte son
      sujet et exige déjà pytest. Aucun projet vide n'est fabriqué pour obtenir un code de sortie 0.
- [x] **`npm run e2e:mail` est livré par `CRM-050`** : seize scénarios exercent les protocoles et
      services réels. Le parcours d'email du produit reste dû par `CRM-054` et `CRM-058`, sans être
      recompté comme une dette de `CRM-008`.
- [x] **INC-023 est arbitrée, option 2.** La DoD est restreinte aux commandes dont le sujet existe ;
      l'ordre du master plan ne dépend plus d'une unité située deux chunks plus loin.
- [x] **Fermeture mesurée après arbitrage sur une base locale froide** : `resetMe.sh --yes` rend
      `0`; la transition « Démarrer la réalisation » porte exactement un champ requis dans le
      workflow global **et** sa copie de track. Le rejeu actuel rend 19 fichiers / 1405 assertions
      pgTAP, 416 scénarios API, 144 UI Chromium avec console stricte, 16 mail, 531 Vitest, quatre
      compilations, rapport HTTP 200, puis **28 contrôles sans anomalie** après les dégradations et
      leur restauration.
- [x] **Le parcours utilisateur ne confond plus `npm.exe` et Node Linux** (décision 278).
      Reproduit depuis le shell WSL réel : 26 contrôles, 10 anomalies, et des dégradations
      faussement `OK` parce que l'exécuteur commun était déjà cassé. Le correctif sélectionne
      Node v24.14.1 / npm 11.11.0 Linux sous NVM avant toute mutation ; la preuve isolée couvre
      quatre branches, puis recense tous les points d'entrée, et rend 5/5.
- [x] **La chaîne Node est réellement commune à tous les harnais autonomes** (INC-083,
      décision 281). Le parcours final de `CRM-015` a révélé que vingt et un des vingt-deux scripts
      `verify-*.sh` exécutant Node ou npm contournaient encore le résolveur et que
      `verify-webapp.sh` choisissait donc `npm.exe`. Chaque point d'entrée concerné doit préparer
      Node avant sa première mutation, et une preuve statique doit interdire qu'un nouveau script
      échappe à cette garde. La preuve dynamique rend **5/5** et le harnais frontend **42/42**
      depuis le `PATH` WSL qui expose `npm.exe`. `CRM-016` ajoute un vingt-troisième harnais ; le
      recensement dynamique reste **5/5**.
- [x] **Le parcours UI global est déterministe et sa commande ne produit aucun avertissement**
      (INC-084, décision 282). Le rejeu après INC-083 rend 143/144 : la preuve de publication
      relit l'API avant d'avoir attendu l'annonce utilisateur de succès. Le rejeu ciblé rend 10/10,
      mais reproduit à chaque fois le conflit `NO_COLOR` / `FORCE_COLOR`. La fermeture exige le
      scénario ciblé, les 144 parcours et le harnais 28/28, tous sans ligne `Warning:`. Après
      correction : **10/10**, puis **144/144 sans avertissement**, puis **28/28** avec les six
      dégradations et leur restauration.
- [x] **Le résumé SQL n'annonce plus trois fichiers en dur** (décision 279). L'exécution froide
      réelle en découvre **19** pour **1405 assertions** ; le harnais extrait les deux valeurs de
      l'unique résumé de `run-sql-tests.sh` et les compare à deux attendus indépendants.

*DoD adaptée, écarts explicites.* **Aucune migration, aucune mise à jour du seed** : un harnais de
tests n'introduit ni table, ni statut, ni flux ; il consomme le seed socle de `CRM-005` sans le
modifier. `docs/PROD_MIGRATIONS.md` est inchangé à dessein — ni schéma, ni service déployé, ni
variable d'environnement du produit ne changent (`E2E_PROJETS` est un contrat interne entre
`package.json` et la configuration Playwright, et n'a pas sa place dans `.env.example`).

- [x] **INC-101 close le 2026-08-14 : les cinq garde-fous globaux gardent de nouveau quelque
      chose** (lot I+J, décisions 377 et 380). Les compteurs figés portaient `31 / 1921 / 504 /
      182 / 41` ; les valeurs **mesurées sur base seedée, avant toute modification du dépôt**, sont
      `33 / 1971 / 507 / 185 / 42`. L'écart est **attribué fichier par fichier** dans le fichier
      lui-même — deux suites pgTAP ajoutées, quatre étendues, trois scénarios d'interface, un de
      messagerie —, et le compte se reconstitue à l'unité. Aucun contrôle ajouté, aucun retiré :
      seule la ligne de comptage est remise à jour.
- [x] **Et l'un des cinq n'avait JAMAIS été juste, ce qui élargit la leçon d'INC-080.** Les trois
      autres avaient dérivé — des preuves ajoutées après eux. `SCENARIOS_API` non : depuis le commit
      qui a écrit `504`, **aucun scénario d'API n'a été ajouté ni retiré**, le seul fichier
      d'`e2e/api/` modifié depuis l'ayant été par le *renommage* d'un scénario. Le compte déclaré
      était déjà de **507** à l'instant de l'écriture. Un compteur figé peut donc mentir sans
      qu'aucune livraison ne l'ait dépassé.
- [x] **Les trois compteurs de scénarios sont COMPTÉS par `--list`, puis CONFRONTÉS aux verts** :
      507 déclarés / 507 verts, 185 / 185, 42 / 42. Les deux mesures coïncident ; un écart aurait
      été un fait à consigner, pas un nombre à choisir.
- [x] **Le harnais rejoué EN ENTIER après révision**, ses six dégradations comprises :
      `scripts/verify-harness.sh` rend **28 contrôles, aucune anomalie**, restauration constatée.
      C'est le juge d'INC-101, et il ne pouvait pas l'être tant que ses compteurs étaient périmés.

*Limites nommées, non masquées.*

- **`pytest mail-sync/tests` n'est pas livré et ne doit pas l'être ici** : décision 277. Il reste
  dû par `CRM-051`; ce fait n'est plus une limite de `CRM-008`.
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

### CRM-015 — Secret de build du registre npm `[x]`
Le secret de build `npm_ca`, déjà prévu par le `Dockerfile` de la webapp, est **fourni par les
fichiers Compose** à partir de l'environnement.
**DoD** : `./runDev.sh` construit l'image de la webapp derrière un proxy à certificat interposé ;
sur un poste sans proxy, **rien ne change** ; aucun certificat n'est versionné.

Unité créée par arbitrage du responsable — `docs/JOURNAL.md`, décision 255, INC-042.
Elle ferme également INC-032, première entrée qui avait mesuré le même échec de `runDev.sh`.

- [x] **Le motif est mesuré, pas ressenti** : INC-042 en est à sa **onzième** occurrence. Le coût
      n'est pas du temps mais une **preuve perdue à chaque unité** — `./runDev.sh` n'a jamais été
      exécuté de bout en bout, alors que la DoD de `CRM-050` l'exige nommément et que toutes les
      unités d'interface reposent dessus.
- [x] **Contrainte non négociable attachée à la décision** : le certificat vient de
      l'environnement, jamais du dépôt, et l'assemblage reste **inerte** là où la variable est
      absente.
- [x] **Spécification écrite avant le code**, `docs/SPEC-webapp.md` §12.1, décision 280 : variable
      `NPM_CA_FILE`, priorité du shell identique à Compose, format PEM absolu et lisible, secret
      vide `/dev/null`, compatibilité des anciens `.env`, refus avant Docker et inspection de
      l'image. Commit documentaire dédié.
- [x] La variable est documentée dans `README.md` §6 et §9 et `.env.example` — nom, rôle, format,
      caractère facultatif — sans valeur réelle.
- [x] `docker-compose.dev.yml` transporte le secret `npm_ca` jusqu'au montage BuildKit du
      `Dockerfile`. Variable absente ou vide : marqueur `inactif` et `npm ci` inchangé. Variable
      renseignée : marqueur `actif` et `cafile` limité à l'instruction de build.
- [x] `runDev.sh --bootstrap` refuse avant Docker toute valeur effective relative, absente, non
      régulière, illisible, vide ou non PEM ; une valeur exportée par le shell prévaut sur `.env`.
      Un ancien `.env` qui omet cette variable facultative reste accepté.
- [x] **Deux constructions sans cache réelles**, sans CA puis avec le paquet d'autorités de
      l'hôte ; l'image finale ne contient ni `/run/secrets/npm_ca`, ni `cafile`, ni `.npmrc` non
      vide. Aucun certificat ni copie de certificat n'apparaît dans le dépôt.
- [x] **Parcours utilisateur réel** : `./runDev.sh` aboutit dans les deux configurations, la
      webapp répond, puis `scripts/verify-stack.sh`, `verify-scripts.sh`, build, tests unitaires,
      E2E UI et console stricte restent verts. Mesuré : pile **50/50**, scripts **80/80**, webapp
      **42/42**, harnais **28/28**, dont **144/144** parcours Chromium sans avertissement.
- [x] `docs/PROD_MIGRATIONS.md` nomme explicitement l'absence d'opération de production : le
      secret ne concerne que l'image Vite de développement.

### CRM-016 — Fonctions edge `[x]`
`edge-runtime` déployé, `supabase/functions/` créé, route `/functions/v1/` déclarée dans la
passerelle.
**DoD** : la route répond ; une fonction d'exemple est appelée depuis un test ; le `README.md` §10
cesse d'annoncer un répertoire qui n'existe pas.

Unité créée par arbitrage du responsable — `docs/JOURNAL.md`, décision 260, INC-007. **La décision
12 est rouverte sur ce point** : l'agent avait proposé de retirer la mention du `README.md`, le
responsable tranche l'inverse — livrer ce que le document annonce plutôt que faire disparaître la
moitié qui gêne.

- [x] **Contrat stable avant code** : `docs/SPEC-edge-functions.md` fixe l'image 1.74.2 et son
      empreinte mesurée, l'isolation `oneshot`, le routeur sans dépendance distante, la santé
      interne, l'authentification Kong et le JSON exact de la fonction d'exemple. La politique par
      défaut a été contre-éprouvée : elle répond mais écrit deux avertissements d'isolate ;
      `oneshot` reste silencieuse après cinq POST concurrents et une fenêtre supérieure au timeout
      là où `per_request` avertit encore (décisions 283 et 286).
- [x] **Service commun et route protégée** : `functions` tourne dans les deux assemblages sans
      port hôte, le montage des sources est en lecture seule, son healthcheck est HTTP, et Kong
      exige une vraie clé d'API sur `/functions/v1/` avant de joindre le runtime.
- [x] **Preuves propres et non simulées** : Vitest éprouve les modules purs ; Playwright appelle
      `example` par la vraie passerelle avec refus des clés absente et fausse ; le harnais inspecte
      image, commande, montage, ports et journaux. Le service doit rester sans `warning`, `error`,
      `panic` ni terminaison d'isolate.
- [x] **Parcours réel et non-régression** : remise à zéro froide, commande documentée, appel HTTP
      comme un client, pile, build, types, tests unitaires, API complète, UI Chromium et console
      stricte sont tous verts. Aucun seed ni capture ne change puisque cette unité n'ajoute pas
      d'écran ni de donnée. Mesure du 2026-08-08 : Edge **13/13**, pile **55/55**, scripts
      **80/80**, harnais global **28/28** — 19 fichiers / 1405 assertions pgTAP, **416 API**,
      **144 UI** et **16 mail**, **531 Vitest**, quatre compilations et rapport HTTP 200 ; zéro
      avertissement, erreur ou `pageerror` dans Chromium et zéro bruit du runtime après la fenêtre
      différée.
- [x] **Deux besoins réels trouvent enfin un porteur** : l'invitation d'un membre (INC-015), qui
      exige la clé de service et ne peut pas vivre dans la webapp, et les webhooks sortants signés
      (`CRM-073`). `CRM-070` pourra s'appuyer sur une fonction edge plutôt que sur un appel sortant
      depuis la base par `pg_net`, chemin plus contournant.
- [x] **Ce que la décision ne change pas** : la logique métier reste en PostgreSQL, et `mail-sync`
      reste un service Python — IMAP et SMTP demandent des connexions longues, incompatibles avec
      des fonctions courtes (`docs/DAT.md` §3.3). Les fonctions edge **s'ajoutent**, elles ne
      remplacent rien.

### CRM-017 — Ordonnancement par `pg_cron` `[x]`
Relances, séquences, digest et purge RGPD sont ordonnancés par `pg_cron`.
**DoD** : une tâche planifiée est créée, exécutée et prouvée **par pgTAP** ; `docs/DAT.md` §3.3 et
§12 sont corrigés dans le même changement.

Unité créée par arbitrage du responsable — `docs/JOURNAL.md`, décision 261, INC-012. **La décision
8 est renversée**, pas seulement corrigée dans son énoncé.

- [x] **Contrat stable avant code** : `docs/SPEC-scheduler.md` fixe l'extension, les objets privés,
      le job nommé, son amorçage observable puis sa cadence horaire, les privilèges et la preuve
      d'exécution. Il refuse d'inventer les relances, digests ou rétentions dont les tables
      arrivent dans des unités ultérieures.
- [x] **Le premier motif de la décision 8 a été démenti par la mesure** : `CRM-004` a constaté que
      `pg_cron` 1.6.4 est présent, préchargé et fonctionnel dans l'image épinglée. Seul le motif de
      testabilité subsistait.
- [x] **Ce que l'ordonnanceur applicatif coûtait était écrit noir sur blanc** dans `docs/DAT.md`
      §12 : « les tâches planifiées s'arrêtent si le service s'arrête ». Une purge RGPD qui ne
      s'exécute pas est un **manquement**, pas un retard.
- [x] **Ce que la décision coûte, et qui est assumé** : les tâches planifiées deviennent testables
      par pgTAP plutôt que par pytest.
- [x] **Conséquence sur une unité voisine** : le périmètre de `CRM-051` (`mail-sync`) **perd son
      sous-composant `scheduler`**.
- [x] **Migration privée, rejouable et convergente** : `pg_cron` est installé ; le heartbeat et sa
      fonction restent dans `app`, fermés à tous les rôles API ; un unique job nommé est réparé
      sans changer de `jobid`.
- [x] **Exécution réelle prouvée par pgTAP** : le job passe après migration, incrémente le compteur,
      laisse un `succeeded` dans `cron.job_run_details` et se promeut de cinq secondes à la cadence
      nominale horaire.
- [x] **Parcours froid et non-régression** : deux resets ont rejoué les 19 migrations et le seed ;
      la suite dédiée rend **48/48** et le harnais `scripts/verify-scheduler.sh` **14/14**, passage
      réel et restauration compris. La campagne globale rend **21 fichiers / 1553 assertions**,
      **425 API**, **144 UI Chromium** sans avertissement, erreur ni `pageerror`, **16 mail** réels,
      **531 unitaires**, quatre compilations TypeScript, build sans avertissement et méta-harnais
      **28/28**. La pile rend en outre **55/55**. Aucun seed ni écran ne change.

### CRM-018 — `require_fields` devient une table de liaison `[x]`
`workflow_transitions.require_fields` (`uuid[]`) est remplacée par une table de liaison
`(transition_id, field_id)`, avec ses deux clés étrangères et son `ON DELETE CASCADE`.
**DoD** : migration versionnée et rejouable ; `copy_workflow_to_track`, le seed, les suites pgTAP
et les preuves d'API mis à jour dans le même changement ; la suppression d'un champ ne laisse plus
aucun identifiant mort.

Unité créée par arbitrage du responsable — `docs/JOURNAL.md`, décision 262, INC-033.

- [x] **Contrat stable avant code** : `docs/SPEC-transition-required-fields.md` fixe la table à
      deux colonnes, ses cascades, la migration sans perte de comportement, la cohérence de
      workflow, RLS, les
      deux fonctions à réviser, le seed, les preuves et le retour arrière.
- [x] **Le constat est une propriété du type, pas un différé d'ordonnancement** : PostgreSQL refuse
      toute clé étrangère depuis une colonne tableau, et cela ne changera jamais. La suppression
      d'un champ de formulaire laisse aujourd'hui des identifiants **morts** dans les transitions,
      et rien ne le signale.
- [x] **L'option écartée est nommée** : accepter le type et nettoyer au moment de la suppression
      aurait reproduit **en code applicatif**, et imparfaitement, ce que le moteur sait faire seul.
      L'intégrité référentielle est le travail de la base.
- [x] **Ce que la décision coûte, et qui est assumé** : elle **rouvre `CRM-031` et `CRM-035`**,
      livrées et prouvées.
- [x] **Conséquence sur une entrée voisine** : INC-056 constatait que la copie de workflow recopie
      `require_fields` tel quel et fait varier un compte global. La table de liaison rend ce
      comptage déterministe **par construction**.
- [x] **Migration de mise à niveau sans perte** : les tableaux valides deviennent des liaisons,
      tout identifiant mort ou croisement de workspace arrête explicitement l'application ; les
      anciennes copies inertes dans un autre workflow du même workspace sont recensées puis
      écartées, avant disparition de la colonne et réparation convergente des deux cascades.
- [x] **Appelants et seed révisés ensemble** : `copy_workflow_to_track`, `move_card`, les anciennes
      migrations rejouées et le seed n'accèdent plus à la colonne ; conformément à la décision
      293, la copie remappe intégralement champs, règles et exigences, sans partager leurs
      identifiants avec la source. La reprise bornée d'une fixture legacy refuse aussi toute
      timeline utilisateur avant de supprimer ses deux cards ; seule l'absence d'événement ou
      l'unique `created` technique sans acteur est reconstructible (décision 305).
- [x] **Divergence de composition exacte** : l'empreinte canonique stockée à la copie couvre
      nœuds, étapes, transitions, champs, règles et exigences ; ajout, modification ou suppression
      dans la source sont tous signalés sans dépendre d'un horodatage.
- [x] **Preuves backend non complaisantes** : pgTAP, vrais jetons API et harnais de dégradation
      couvrent autorisations, copie complète et atomique, empreinte, sixième garde, croisement
      refusé à la création comme après déplacement de chacun des parents, concurrence verrouillée
      et suppression sans reste.
- [x] **Parcours froid et non-régression** : reset, migrations, seed, SQL, API, UI Chromium à
      console stricte, mail, unitaires, types et build sont verts. Mesuré le 2026-08-09 : migration
      ciblée **88 assertions**, harnais CRM-018 **24/24**, global **21 fichiers / 1553 assertions**,
      **425 API**, **144 UI**, **16 mail**, **531 unitaires**, quatre compilations TypeScript et
      build sans avertissement ; méta-harnais **28/28**. Aucun écran ni capture ne change.

### CRM-019 — `change_channel_workflow` `[x]`
Changer le workflow d'un channel entier, en remappant l'étape de **toutes** ses cards en un appel.
**DoD** : le remappage est **explicite et exhaustif** — aucune étape de départ devinée, aucune card
laissée sur une étape qui n'appartient pas à son nouveau workflow — et le refus est renvoyé
**entier** plutôt qu'appliqué à moitié ; pgTAP et preuve d'API hors interface.

Unité créée par arbitrage du responsable — `docs/JOURNAL.md`, décision 263, INC-046 et INC-073.

- [x] **Le pluriel du `docs/SCHEMA.md` §9 n'était pas une erreur de rédaction** : il décrivait une
      fonction que personne n'avait encore nommée. Deux gestes distincts, deux fonctions, deux
      noms :

| Fonction | Objet |
|---|---|
| `move_card_to_channel(card_id, channel_id, step_id)` | Une card change de dossier. **Livrée par `CRM-045`, inchangée** |
| `change_channel_workflow(channel_id, workflow_id, step_mapping, discard_field_values)` | Un channel change de workflow, et l'étape de **toutes** ses cards est remappée |

- [x] `docs/SCHEMA.md` §9 nomme les deux fonctions et cesse de laisser croire qu'une seule porte les
      deux gestes.
- [x] **Contrat écrit avant le code**, `docs/SPEC-change-channel-workflow.md` : tableau JSON exact
      et doublons détectables, égalité avec les étapes réellement occupées, regroupement
      plusieurs-vers-une, compatibilité de portée, administration du workspace, perte de réponses
      refusée par défaut, dixième événement exclusif et clé composite différable seulement pendant
      la transaction.
- [x] **Migration convergente et sans relâchement** : fonction, contrainte, trigger, vocabulaire,
      privilèges et types générés sont livrés ensemble ; le rejeu conserve les identifiants et ne
      modifie aucune donnée métier tant que la RPC n'est pas appelée.
- [x] **Preuves backend non complaisantes** : pgTAP, vrais JWT et harnais couvrent chaque refus,
      le channel vide, les cards archivées/corbeille, le regroupement, les positions, la perte
      explicite, la concurrence et l'atomicité par relecture complète.
- [x] **Parcours froid et non-régression** : reset, migrations, seed, SQL, API, UI Chromium à
      console stricte, mail, unitaires, types, build et méta-harnais sont verts ; la timeline rend
      le nouveau type sans substituer un succès du backend.

**Clôture mesurée le 2026-08-09.** La migration 20 a été appliquée par le runner sur une base
entièrement reconstruite, puis rejouée sur la base seedée sans modifier son empreinte métier et
sans reconstruire les OID conformes. `0022_change_channel_workflow.test.sql` rend **59/59**,
`e2e/api/change-channel-workflow.spec.ts` **14/14** sous les vrais jetons, et le harnais dédié
**23/23**, dont six dégradations et une insertion réellement concurrente qui attend le verrou puis
échoue sur la FK après le commit. Campagne complète : **22 fichiers / 1612 assertions pgTAP**,
**439 API**, **144 UI Chromium** sans `console.warn`, `console.error` ni `pageerror`, **16 mail**,
**532 unitaires**, types générés identiques au schéma, quatre compilations, build sans avertissement,
méta-harnais **28/28** et pile **55/55**. Les captures de timeline desktop/mobile ont été observées.
INC-046, INC-073, INC-077, INC-078 et INC-081 sont closes.

### CRM-022 — Identités lisibles et memberships sûrs `[x]`

Socle RLS des `profiles`, `workspaces` et `workspace_members`, créé par la décision 294 pour fermer
INC-014 avant que les écrans continuent à contourner le refus par défaut.

**DoD** : un membre lit son workspace, les memberships et les profils nécessaires à
l'identification de ses collègues ; il ne lit aucun autre workspace ; il modifie uniquement ses
données de profil non privilégiées ; seul un administrateur gère les memberships ; le dernier
administrateur ne peut ni se retirer ni se rétrograder. Preuves pgTAP et API avec vrais JWT pour
les trois profils seedés, parcours utilisateur où noms et avatars réels apparaissent, console
stricte, captures desktop/mobile et documentation synchronisée. `CRM-070` reste propriétaire de
l'invitation et de l'interface d'administration complète.

- [x] **État initial mesuré et contrat écrit avant le code**, `docs/SPEC-identite.md` : zéro
      politique sur les trois tables, trois réponses `200` / `[]` sous le vrai JWT admin, ACL
      d'écriture trop larges mais neutralisées, trois avatars nuls et unique FK vers `profiles`
      encore bloquante. La frontière avec `CRM-070` est explicite.
- [x] **Choix délégués arrêtés** : partage d'un workspace pour lire un profil, memberships
      lisibles par l'équipe et mutables par l'admin, workspace en lecture seule, profil propre
      limité à son nom/avatar, invariant différable du dernier admin et identité historique
      détachable.
- [x] **Migration convergente et sans donnée réécrite** : politiques, ACL de colonnes,
      contraintes, trigger différable et FK de commentaire livrés ensemble ; l'application refuse
      tout legacy faux avant d'annoncer l'invariant.
- [x] **Identité réellement visible** : en-tête, board, liste, commentaires et événements rendent
      noms et avatars sans requête par ligne ni identifiant technique ; repli accessible et
      responsive.
- [x] **Preuves non complaisantes** : pgTAP, vrais JWT, vrai navigateur, captures, console stricte,
      migration froide, dégradations et campagne globale.

**Résultat mesuré — `CRM-022` close.** La migration 21 converge les sept politiques, les ACL de
colonnes, les deux bornes de profil, la garde différable du dernier administrateur et la FK qui
conserve la parole d'un compte supprimé. Le harnais ciblé rend **23/23** après sept dégradations
effectives et restauration ; pgTAP dédié **84/84**, API ciblée **5/5** plus **2/2** refus du dernier
admin. `./resetMe.sh --yes` a détruit le cluster local puis rejoué à froid les **21 migrations** et
le seed complet. Sur cet état reconstruit, la campagne rend **23 fichiers / 1698 assertions
pgTAP**, **444/444 API**, **145/145 UI Chromium** au clavier et à la souris sans `console.warn`,
`console.error` ni `pageerror`, **16/16 mail**, **564/564 Vitest**, quatre compilations, build sans
avertissement et types générés identiques au schéma. Le méta-harnais rend **28/28**, la pile
**55/55** ; les quatre captures desktop/mobile ont été observées. INC-014 est close.

## Chunk 3 — CRM utilisable

### CRM-020 — Tracks `[x]`
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
- [x] **~~Aucun track n'est visible dans l'interface.~~ Ils le sont.** INC-021 est close depuis
      `CRM-009` : la barre latérale liste les tracks que le backend consent, en pilules portant
      couleur et icône, et `e2e/ui/tracks.spec.ts` l'éprouve aux quatre paliers. Les captures de
      `docs/captures/CRM-012/` montrent en outre **deux barres différentes** selon la personne
      connectée.
- [x] **~~Les droits fins ne sont pas appliqués.~~ Ils le sont depuis `CRM-012`**, et INC-024 est
      close : `app.can_read_track` existe, la politique de lecture la consulte, et un
      `track_members.access = 'none'` masque réellement le track. MESURÉ à l'API — la lectrice voit
      trois tracks sur quatre — et **à l'écran**, capture à l'appui.
- [x] **~~Aucune surface d'administration, et aucune unité n'en porte.~~ `CRM-075` la livre —
      INC-086 close.** L'écran de création, de renommage, de réordonnancement et d'archivage d'un
      track existe désormais (`webapp/src/app/AdministrationArborescence.tsx`), au-dessus du même
      CRUD déjà prouvé par l'API. `docs/JOURNAL.md` décision 349.

*DoD adaptée, écarts explicites — **révisée le 2026-08-09**.* La Definition of Done exige « E2E,
captures ». Les deux étaient livrés sur les seuls états qu'un appelant **anonyme** obtient — vide,
chargement, refus, paliers —, le rendu chargé étant éprouvé par test unitaire et par substitution
de la réponse réseau. **Ce n'est plus la seule preuve** : INC-021 close, `e2e/ui/droits-fins.spec.ts`
exerce la barre latérale sur une **session réelle**, avec les tracks que la base consent à deux
personnes différentes. La substitution reste employée pour les variantes de couleur et d'icône
qu'aucun track du seed ne porte — un jeton que rien ne rend n'est jamais mesuré — et elle est
nommée comme telle (`docs/DESIGN_SYSTEM.md` §12.5).

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

### CRM-021 — Channels `[x]`
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
- [x] **~~Aucun channel n'est visible dans l'interface.~~ Ils le sont.** INC-021 est close depuis
      `CRM-009` : la route d'un track résout son slug, la barre d'onglets liste ses channels non
      archivés dans l'ordre, et l'onglet courant porte `aria-current="page"`.
      `e2e/ui/channels.spec.ts` l'éprouve sur le parcours connecté.
- [x] **~~`workflow_id` n'est ni obligatoire, ni référencée, ni cohérente.~~ Les trois le sont.**
      MESURÉ sur la base migrée : `is_nullable = NO`, clé étrangère composite
      `channels_workflow_id_workspace_id_fkey` posée, et trigger de cohérence livré par `CRM-033`.
      INC-029 est soldée **par une contrainte, non par une convention**, ce que
      `scripts/verify-workflows.sh` vérifie en propre — aucun channel n'est sans board.
- [x] **~~Les droits fins ne sont pas appliqués.~~ Ils le sont depuis `CRM-012`**, et INC-030 est
      close : `app.can_read_channel` et `app.can_write_channel` existent, et la politique de lecture
      consulte la première. MESURÉ : la lectrice voit quatre channels sur six, et « Prospection »
      lui reste ouvert alors que son track est fermé — la règle « le plus spécifique gagne »
      s'applique jusqu'au channel. Cette réouverture n'a en revanche **aucune surface** : INC-085.
- [x] **~~Aucune surface d'administration, et aucune unité n'en porte.~~ `CRM-075` la livre —
      INC-086 close.** L'écran de création, de renommage, de réordonnancement et d'archivage d'un
      channel existe désormais (`webapp/src/app/AdministrationArborescence.tsx`), au-dessus du
      même CRUD déjà prouvé par l'API. `docs/JOURNAL.md` décision 349.

*DoD adaptée, écarts explicites — **révisée le 2026-08-09**.* La Definition of Done exige « E2E,
captures ». Les deux étaient livrés sur les seuls états qu'un appelant **anonyme** obtient : track
introuvable, barre vide, erreur, paliers. **Ce n'est plus la seule preuve** : INC-021 close, les
parcours connectés du board, de la liste et des identités traversent la barre d'onglets réelle, et
`e2e/ui/droits-fins.spec.ts` montre que « Track introuvable » reste l'état rendu à qui n'y a pas
droit — l'écran ne révèle pas l'existence du track. Le rendu **chargé** — onglets, ordre, onglet
courant — est
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

### CRM-030 — Catalogue de nœuds `[x]`
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
- [x] **LE REFUS D'ARCHIVAGE D'UN NŒUD OCCUPÉ EST LIVRÉ, ET IL L'ÉTAIT DEPUIS `CRM-040`.** Le
      constat ci-dessous décrivait l'état du 2026-08-04 ; la migration `0011_cards.sql` pose la
      garde `workflow_nodes_catalog_refuser_archivage_occupe` avec la table qui manquait
      (décision 111), et l'assertion d'absence de la suite pgTAP est devenue rouge ce jour-là,
      exactement comme elle avait été écrite pour le faire. **Mesuré le 2026-08-16** avec le jeton
      réel de l'administratrice : `PATCH archived_at` sur `prospection` rend `403`, `42501` et
      `node_occupied : 4 card(s) active(s) se trouvent encore sur ce nœud` ; le même appel sur un
      nœud libre rend `200`, et le désarchivage n'est jamais refusé. La **preuve d'API manquait**
      malgré tout, et elle est écrite : `e2e/api/catalogue-noeuds.spec.ts` §N6, deux scénarios — le
      refus reçu avec sa ligne relue inchangée, et sa contre-épreuve sur un nœud libre. Le §2.6 de
      `docs/SPEC-workflow-engine.md` est corrigé dans le même changement, son texte d'origine
      conservé pour son motif.
- [x] ~~**Le refus d'archivage d'un nœud occupé n'est pas livré.**~~ *(état du 2026-08-04, ci-dessus ;
      la case passe à `[x]` le 2026-08-16 — ce qu'elle décrivait EST livré, et un `[ ]` sous une unité
      close aurait continué de dire le contraire)*
      Son chemin est
      `cards.current_step_id → workflow_steps.node_id → workflow_nodes_catalog.id` : il traverse
      `workflow_steps` (`CRM-031`) et `cards` (`CRM-040`). Mesuré : les trois tables rendent `NULL`
      à `to_regclass`. Mesuré aussi, et c'est ce qui a tranché : PostgreSQL **accepte la création**
      d'une fonction PL/pgSQL référençant une table absente, l'échec ne survenant qu'au premier
      appel — un trigger écrit ici ferait échouer **toute** mise à jour du catalogue sans rien
      protéger. **INC-031, en attente d'arbitrage** (trois options), avec trois assertions
      `hasnt_table` et un contrôle du harnais qui deviendront rouges le jour où les tables
      apparaîtront.
      **Cette preuve est bloquée par une dépendance, pas par un défaut de l'unité.**
- [x] **L'ÉCRAN D'ADMINISTRATION EST LIVRÉ, ET L'E2E QUE LA DEFINITION OF DONE EXIGE AVEC LUI.**
      Les deux motifs de l'absence — INC-021 et « aucun écran » — sont tombés : INC-021 est close
      depuis `CRM-009`, et le second n'était pas un motif, c'était l'absence elle-même.
      **Spécification écrite avant le code et committée d'abord** : `docs/SPEC-workflow-engine.md`
      §2 bis, neuf sections, écrites après mesure sur la pile réelle — chaque code et chaque message
      du §2 bis.5 observé le 2026-08-16, jamais supposé. `docs/DESIGN_SYSTEM.md` §5.18 porte ses
      règles visuelles.
- [x] **Cinquième surface d'administration, et la première dont l'objet est une liste plate** :
      `webapp/src/app/AdministrationCatalogue.tsx` et `webapp/src/lib/administration-catalogue.ts`,
      à `/reglages/catalogue`, atteinte depuis l'index des réglages. Une **seule lecture**, sans
      aucun filtre : ni `workspace_id`, que la RLS borne déjà, ni `archived_at` — l'écart avec la
      lecture 3 du §7 bis.3, et c'est lui qui rend le rétablissement d'un nœud atteignable.
- [x] **Quatre gestes** : créer, modifier, archiver, rétablir. La **clé n'est pas modifiable**, et
      ce n'est pas la base qui le refuse — l'écran ne l'expose pas, parce que le §2.1 fonde la
      comparabilité analytique sur elle. Elle se rend en **phrase**, jamais en champ désactivé
      (`docs/DESIGN_SYSTEM.md` §5.15, §5.18).
- [x] **`0` N'EST PAS `NULL`, ET LA PREUVE LE CONSTATE EN BASE.** Un champ numérique laissé vide
      arrive à `NULL` : un `Number('')` valant `0`, une lecture naïve aurait écrit « 0 jour » — un
      seuil qui signalerait toute affaire dès son arrivée (§2.5). Le scénario d'interface relit la
      ligne créée et exige `default_stale_after_days === null`.
- [x] **Les deux `42501` sont séparés, et c'est le seul endroit du produit où le message d'une
      exception est lu.** La garde porte `node_occupied`, la RLS porte `row-level security policy`.
      Les confondre aurait fait lire un refus **rattrapable** — déplacez les affaires — comme un
      refus de droit. Le classement porte sur le **jeton**, pas sur la phrase française, et deux
      preuves le figent : le test unitaire et le scénario d'API §N6.
- [x] **Test unitaire dédié** : `webapp/src/lib/administration-catalogue.test.ts`, **20 cas**. Les
      deux plus utiles sont écrits **en négatif** — la lecture n'émet aucun filtre, la modification
      n'écrit jamais `key` —, parce qu'une régression qui ajouterait l'un ou l'autre ne changerait
      la forme d'aucune valeur.
- [x] **Test E2E d'interface dédié** : `e2e/ui/administration-catalogue.spec.ts`, **7 scénarios,
      verts, console vierge**, sur la vraie base et le vrai seed, **aucune réponse substituée**. Les
      gestes sont joués à la souris **et** au clavier, chaque effet est **relu en base** après coup,
      et le refus d'un nœud occupé est obtenu en tentant réellement d'archiver `prospection`, que le
      seed occupe de quatre affaires actives. Le scénario purge ce qu'il dépose dans son `finally`
      et **restitue** l'archivage du nœud `qualification` à sa date exacte, sans quoi
      `scripts/verify-catalogue.sh` rougirait ailleurs sans que rien ne dise pourquoi.
- [x] **Captures produites ET observées** : `docs/captures/CRM-030/catalogue-liste-{xl-1440,
      lg-1152, md-900, sm-390}.jpg`, `catalogue-refus-occupe-1440.jpg`,
      `catalogue-formulaire-1440.jpg`. Observées : la pilule de couleur, la clé en `code`, le type
      en toutes lettres, la pilule « Archivé » sur `qualification` et le « Rétablir » qui remplace
      les deux autres commandes, l'alerte de refus dans le flux avec son compte, et le repli des
      lignes à 390 px sans débordement horizontal de la page.
- [x] **Le manuel dit l'écran** : chapitre 5 *quater*, cinq sections, et la ligne 19 du sommaire
      passe de « partiellement livré, sans écran » à « livré et vérifié ».
- [x] **LE RÉORDONNANCEMENT EST LIVRÉ, ET C'ÉTAIT LE DERNIER MANQUE DE L'UNITÉ.**
      **Spécification écrite après mesure et committée avant la première ligne de code** :
      `docs/SPEC-workflow-engine.md` §2 ter, sept sections, plus la règle visuelle de
      `docs/DESIGN_SYSTEM.md` §5.18. Deux commandes par ligne active — `ArrowUp`, `ArrowDown`, en
      tête du groupe d'actions —, et `deplacerNoeud` écrit **une colonne sur une ligne** : la liste
      n'est jamais renumérotée. `calculerDeplacement`, `positionEntre` et `positionAvant` de
      `CRM-075` sont **réutilisés et non dupliqués**.
- [x] **LE CALCUL PORTE SUR LA LISTE AFFICHÉE, ARCHIVÉS COMPRIS** (§2 ter.3), et c'est le choix
      structurant de la tranche. Un nœud archivé reste dans la liste à sa position ; calculer sur la
      seule sous-liste active ferait franchir cette ligne visible d'un seul clic, ou produirait une
      position égale à la sienne. Le nœud archivé, lui, **ne se déplace pas** — ses flèches ne sont
      pas rendues, comme « Modifier » — mais **compte comme voisine**. Le test unitaire fige les deux
      moitiés de la règle.
- [x] **UNE MESURE QUI N'ALLAIT PAS DE SOI, ET QU'UNE PREUVE D'API FIGE** : la garde
      `node_occupied` est un trigger `BEFORE UPDATE` posé sur **toute** la table, mais elle ne se
      réveille qu'au passage d'`archived_at` de `NULL` à une valeur. **Mesuré le 2026-08-16** :
      déplacer `prospection`, que le seed occupe de quatre affaires actives, rend `200` — avec le
      même jeton et sur le même nœud dont l'archivage rend `403`. Sans ce contrôle, un resserrement
      futur de la garde rendrait le catalogue immobile et l'écran afficherait « des affaires en cours
      se trouvent encore sur ce nœud » pour un simple déplacement, sans qu'aucune preuve ne
      l'annonce.
- [x] **Preuves unitaires** : `webapp/src/lib/administration-catalogue.test.ts`, **29 cas** (20
      auparavant). L'écriture est comparée en **égalité stricte** et non en correspondance partielle
      — la seule forme qui attrape une colonne ajoutée par mégarde à un déplacement.
- [x] **Preuve d'API** : `e2e/api/catalogue-noeuds.spec.ts` §N7, trois scénarios, **30 scénarios**
      sur le fichier (27 auparavant). Les trois lignes du §2 ter.4, chacune restituant la position
      qu'elle a changée.
- [x] **Preuve d'interface** : `e2e/ui/administration-catalogue.spec.ts`, deux scénarios, **9
      scénarios** sur le fichier (7 auparavant), console vierge. Descente **à la souris**, remontée
      **au clavier**, positions **relues en base** après chaque geste — un réordonnancement purement
      local passerait toute assertion d'écran. Extrémités éteintes avec leur infobulle, ligne
      archivée sans commande d'ordre, ordre du seed restitué en épilogue.
- [x] **Capture produite ET observée** : `docs/captures/CRM-030/catalogue-ordre-1440.jpg`, plus les
      six captures existantes renouvelées. Observé : les deux flèches viennent avant « Modifier »
      sans faire sauter le groupe d'actions d'une ligne à l'autre, « Monter » est visiblement éteint
      sur la première ligne, la ligne archivée ne porte que « Rétablir », et le repli à 390 px est
      celui de la ligne de base.
- [x] **Le manuel dit le geste** : chapitre 5 *quater*.5, et la ligne 19 du sommaire cesse de dire
      que réordonner « reste un geste d'API ».

*DoD adaptée, écarts explicites — RÉVISÉE LE 2026-08-16.* Le paragraphe qui suivait disait que
« E2E d'administration » ne pouvait pas être livré, cette unité ne livrant ni écran ni parcours.
**Les deux termes ont cessé d'être vrais** : l'écran est livré, l'E2E d'administration l'est avec
lui, et la vérification visuelle a eu lieu. Les preuves unitaires (pgTAP) et d'intégration
(PostgREST, jetons réels, hors interface) restent celles de la table ; elles s'ajoutent désormais à
une preuve d'interface au lieu d'en tenir lieu.

*Limites nommées, non masquées.*

- ~~**La garde d'archivage manque**~~ — livrée par `CRM-040`, mesurée et prouvée le 2026-08-16.
- ~~**Aucune donnée du catalogue ne peut apparaître dans l'interface tant qu'INC-021 n'est pas
  tranchée.**~~ — INC-021 close par `CRM-009` ; l'écran est livré.
- **Le réordonnancement reste le seul manque de l'unité** (§2 bis.8).
- **L'occupation d'un nœud n'est pas affichée avant le geste** : le compte demanderait une jointure
  que PostgREST n'expose pas au client, et l'anticiper serait un contrôle d'interface là où la base
  en tient un. Le nombre est rendu par le refus lui-même.
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
*Reste `[~]` pour **un seul** manque, et il n'appartient pas à cette unité : la contrainte `NOT NULL`
de `channels.workflow_id`, qui revient à `CRM-033`. L'éditeur, l'E2E de création et les captures que
la Definition of Done exigeait sont livrés et prouvés — voir plus bas.*
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
- [x] **~~Aucun éditeur d'administration, aucun E2E de création par l'interface, aucune
      capture.~~ LES TROIS SONT LIVRÉS.** L'éditeur est venu avec `CRM-076`, qui composait les
      workflows existants et rangeait « un créateur de workflow » parmi ce qu'il n'est pas
      (§7 bis.1), en renvoyant le geste ici. L'écran d'administration authentifié n'était plus le
      blocage — INC-021 est close depuis `CRM-009`. **Ce qui manquait était la création elle-même**,
      livrée par le §3 bis : spécification écrite après mesure et committée avant la première ligne
      de code, `docs/DESIGN_SYSTEM.md` §5.15 complété de quatre règles visuelles.
- [x] **Le geste est rendu DEUX FOIS, et la seconde est celle qui comptait** (§3 bis.2). L'état vide
      de l'écran écrivait « Aucun workflow dans cet espace de travail » sans offrir d'issue : or le
      §3.2 pose qu'« un workspace neuf n'a aucun workflow ». Un écran d'administration dont l'état
      vide est un cul-de-sac est un défaut, pas une sobriété.
- [x] **Le sélecteur de track est ABSENT sous la portée globale, non grisé**, et la bascule de
      portée **oublie** le track choisi. Les deux moitiés sont figées séparément : par le test de
      composant pour l'absence, par la mesure d'API pour ce que l'oubli évite — `scope = 'global'`
      avec un `track_id` rend `400` / `23514` sur `workflows_scope_track_check`. `creerWorkflow`
      refait le geste de son côté : un état d'interface n'est pas un contrat.
- [x] **Aucune case « par défaut », et le motif est mesuré** (§3 bis.1) : `is_default` vrai est
      refusé en `23505` sur l'index unique partiel `workflows_workspace_default_uk` dès qu'un défaut
      existe — c'est-à-dire dans le cas normal. Le refus est prouvé par l'API précisément parce que
      l'écran ne peut pas le produire.
- [x] **Test unitaire dédié** : `webapp/src/lib/administration-workflows.test.ts`, **13 assertions
      ajoutées** — la quatrième lecture et ses filtres, les deux conditions de la validation de
      forme, l'identifiant rendu au succès, `track_id` forcé à `null`, `is_default` jamais envoyé,
      zéro ligne rendu `sans-effet`, et les trois refus classés par leur code SQL. **134 assertions**
      sur le fichier, aucune anomalie.
- [x] **Test de composant dédié** : `webapp/src/app/AdministrationWorkflows.test.tsx`, **11
      scénarios ajoutés**, dont **l'état vide qui porte le geste** — la preuve que seul ce niveau
      peut rendre, la table du seed n'étant jamais vide et la vider casserait toutes les autres
      suites (§3 bis.8). **107 scénarios** sur le fichier, aucune anomalie.
- [x] **Test d'intégration dédié, hors interface** : `e2e/api/workflows.spec.ts` §N8, **11
      scénarios** rejouant les dix lignes du §3 bis.5 avec les jetons réels des trois profils.
      Chaque refus **relit la table** avec la clé de service pour constater qu'aucune ligne n'a été
      écrite. **45 scénarios** sur le fichier, aucune anomalie.
- [x] **UN FAIT FIGÉ EXPRÈS : un nom déjà porté est ACCEPTÉ en `201`.** Aucune unicité ne pèse sur
      `workflows.name`, et le §3.2 n'en demande aucune. Sans cette mesure, une unicité ajoutée un
      jour passerait inaperçue jusqu'au premier refus en production — que l'écran, qui ne la
      prévient pas, afficherait sans qu'aucune de ses validations ne l'annonce.
- [x] **Test E2E d'interface dédié** : `e2e/ui/administration-workflows.spec.ts`, **7 scénarios** —
      le geste à la souris avec la ligne **confirmée en base** par la clé de service, la bascule de
      portée, le parcours **entièrement au clavier** avec le focus entrant vérifié dans le premier
      champ, et les quatre paliers sans débordement. **63 scénarios** sur le fichier, aucune
      anomalie, console vierge. Chaque scénario purge ce qu'il dépose dans son `finally` (INC-099).
- [x] **Vérification visuelle réellement observée** : `docs/captures/CRM-031/`, six captures — les
      quatre paliers, la portée propre à un track avec sa commande éteinte, et le succès montrant le
      workflow neuf **choisi** avec son bloc d'étapes vide.
- [x] **Build vert**, `npm run typecheck` et `npm run types:check` verts. Harnais de l'unité
      `scripts/verify-workflows.sh` rejoué : **49 contrôles, aucune anomalie**, ses quatre
      dégradations réelles comprises. Campagne : `test:sql` **2133 assertions**, `test:unit`
      **1204/1204**, `e2e:api` **612/612**, `e2e:ui` **302/302**.
- [x] `docs/SPEC-workflow-engine.md` §3 bis (neuf sous-chapitres) et §3.10, `docs/DESIGN_SYSTEM.md`
      §5.15, `docs/manual.md` chapitre 5 bis.0, 5 bis.5 et §3.2, `CHANGELOG.md` mis à jour dans le
      même changement.
- [ ] **La contrainte `NOT NULL` de `channels.workflow_id` n'est pas posée** (INC-029, ci-dessus) :
      elle revient à `CRM-033`. **Bloquée par une frontière d'unité, pas par un défaut.**

*DoD adaptée, écarts explicites — LE PARAGRAPHE CI-DESSOUS EST HISTORIQUE, et il est conservé parce
qu'il dit pourquoi ces preuves ont manqué si longtemps. La Definition of Done exigeait un « E2E de
création » et des « captures de l'éditeur » : **les deux sont livrés** depuis le §3 bis, INC-021
étant close et l'éditeur venu avec `CRM-076`. Ce qui suit décrit l'état d'avant.* La Definition of
Done exige un « E2E de création » et des « captures de l'éditeur ». Aucun n'est livré, et aucun ne
pouvait l'être : cette unité ne livre ni écran ni parcours, l'éditeur étant suspendu à INC-021. Ses preuves sont unitaires (pgTAP) et
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

**Rouverte par arbitrage du responsable — `docs/JOURNAL.md`, décision 262 (INC-033).**
`workflow_transitions.require_fields` est un `uuid[]`, et PostgreSQL refuse toute clé étrangère
depuis une colonne tableau. La colonne est remplacée par une table de liaison
`(transition_id, field_id)`. **Mise en œuvre : `CRM-018`.** Cette unité ne pourra être close
qu'après elle.

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
- [x] **Les deux contradictions propres à la copie sont arbitrées** par la décision 293 :
      `CRM-018` remappe le formulaire complet et remplace le signal temporel par une empreinte de
      composition. INC-039 relève de la reprise transverse des clés différables (décision 295).
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
- [ ] **Copie complète et divergence exacte à prouver avec `CRM-018`.** Les champs, règles et
      exigences sont remappés sans identifiant partagé ; ajout, modification et suppression source
      allument le signal de divergence. Ce point rouvre les preuves de `CRM-032` jusqu'au parcours
      froid de `CRM-018`.

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
- **Le signal de divergence historique ne voyait pas une suppression** dans la source. La décision
  293 retient l'empreinte de composition ; le point reste ouvert uniquement jusqu'à sa preuve dans
  `CRM-018`.
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

- [x] **LOT G — LE MOTIF EXIGÉ EST ENFIN CONSERVÉ, ET « VIDE » S'ENTEND DES BLANCS UNICODE.**
      INC-048 et INC-052 sont **closes** (arbitrage : décision 367 ; mise en œuvre : décision 374 ;
      migration `0035_commentaires_lot_g.sql`). `move_card` insère le motif fourni dans
      `card_comments`, **dans sa propre transaction** — soit la card bouge et le motif est conservé,
      soit ni l'un ni l'autre —, et dès qu'il est **fourni**, non seulement lorsqu'il est **exigé**.
      Une vérification **n° 5 bis** borne sa longueur à 10 000 caractères par `comment_too_long`,
      plutôt que de laisser remonter le `23514` de la contrainte de la migration 15. La
      normalisation passe de `btrim(comment)` à `app.btrim_blancs(comment)`, dont la classe est
      exactement celle de `String.prototype.trim()`, énumérée en points de code pour ne pas dépendre
      du `ctype` de l'instance. **Prouvé** : `0013_move_card.test.sql` — cinq assertions figées
      **retournées et non retirées** (décision 51), dont celle qui portait « CETTE ASSERTION DOIT
      DEVENIR ROUGE le jour où l'arbitrage d'INC-052 est rendu » —, motif relu sur une vraie
      transition avec son auteur, motif facultatif conservé lui aussi, borne de longueur éprouvée
      des deux côtés (10 000 passe, 10 001 refusé), blancs non-ASCII refusés. `e2e/api/move-card.spec.ts`
      mesure la même chose **par la vraie route**, et purge ce qu'elle écrit.

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
- [x] **LA VÉRIFICATION N° 6 EST ÉCRITE — livrée par `CRM-036` le 2026-08-05, INC-047 CLOSE.** Les
      deux assertions figées ici pour devenir rouges ce jour-là le sont devenues et ont été
      **retournées**, non retirées : le mécanisme de la décision 51 a désigné son moment. Le message
      listant les clés manquantes existe, dans le `DETAIL` du refus. Ce que la n° 6 contrôle est
      écrit en `docs/SPEC-form-composer.md` §6.7. **Le constat d'origine est conservé ci-dessous**,
      parce qu'il porte la décision et non seulement un état.
- [ ] **~~LA VÉRIFICATION N° 6 N'EST PAS ÉCRITE — INC-047.~~** La Definition of Done exige « pgTAP
      pour chacune des **six** » ; cinq sont livrées. La n° 6 demande que les champs requis de l'étape
      cible soient **renseignés**, et l'ensemble renseigné n'a aucune source : `card_field_values`
      est le livrable de `CRM-036`. MESURÉ, `to_regclass` rend `NULL`. Les deux écritures possibles
      sont écartées au §5.7 — refuser toute transition dont l'ensemble exigé n'est pas vide
      interdirait les entrées en négociation, en signature et les **quatre** transitions « Marquer
      perdu », c'est-à-dire le parcours que la garde est censée garder ; prétendre vérifier sans
      vérifier est le faux vert que `CLAUDE.md` §17 proscrit. L'écart est **figé par deux
      assertions**, en pgTAP et en API, qui deviendront rouges à `CRM-036`.
- [x] **~~Le message d'erreur listant les clés manquantes n'existe pas~~ — LIVRÉ par `CRM-036`.**
      Il voyage dans le `DETAIL` du refus, ordonné par `position`, et non dans le message, qui reste
      un jeton comparable par égalité comme les cinq refus précédents (décision 126). MESURÉ :
      PostgREST l'expose dans la clé `details` de sa réponse.
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
disputait à `CRM-013`. **Cinq vérifications sur six** étaient couvertes en pgTAP par cette
unité, largement au-delà de ce qui était demandé — chacune dans les deux sens. **La sixième et son
message ont été livrés par `CRM-036`** le 2026-08-05 : les six sont désormais couvertes, et
l'absence qui était nommée ici a été comblée par l'unité que le plan désignait.

*Limites nommées, non masquées.*

- **`CRM-034` reste `[~]`** : la n° 6 et son message sont livrés par `CRM-036`, mais **aucune
  capture n'existe** — la garde n'a pas de surface, et la webapp reste anonyme (INC-021).
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
- [ ] **La copie du formulaire rouvre cette preuve sous `CRM-018`.** La décision 293 remplace la
      frontière historique de la décision 93 : champs, règles et exigences doivent être remappés
      par le vrai geste de copie. Les assertions qui exigeaient zéro champ sont remplacées par des
      preuves d'équivalence métier et d'identifiants distincts.

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
- **La copie des champs est portée par `CRM-018`** — décision 293 ; ce point reste dû jusqu'à sa
  preuve froide, pas jusqu'à un nouvel arbitrage.
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

**Rouverte par arbitrage du responsable — `docs/JOURNAL.md`, décision 262 (INC-033).** La
suppression d'un champ laisse aujourd'hui des identifiants morts dans
`workflow_transitions.require_fields`, sans que rien ne le signale. La table de liaison décidée
rend le nettoyage automatique. **Mise en œuvre : `CRM-018`.**

### CRM-036 — Valeurs et validation `[~]`
`card_field_values`, validation par type, union étape + transition.
**DoD** : pgTAP (type incorrect refusé, `hidden` non exigé, règle ajoutée après coup
n'invalidant pas l'existant).

- [x] **LOT G — « RENSEIGNÉ » S'ÉLARGIT AUX BLANCS UNICODE, DES DEUX CÔTÉS À LA FOIS.** INC-052,
      seconde occurrence, **close** (décisions 367 et 374). `app.valeur_de_champ_est_vide` employait
      `btrim(valeur #>> '{}')`, qui ne retire que `U+0020` : une valeur réduite à `"\t"` était
      **renseignée** et satisfaisait un champ `required`. Elle appelle désormais `app.btrim_blancs`.
      Le §4.3 de `docs/SPEC-form-composer.md` exige que l'interface et la garde donnent la **même**
      lecture : la décision 165 avait dû faire converger l'interface **vers** `btrim` faute
      d'arbitrage ; la convergence se fait désormais dans l'autre sens et **par construction** —
      `webapp/src/lib/valeur-renseignee.ts` cesse d'être une réimplémentation et appelle `trim()`,
      dont la classe est celle qu'`app.btrim_blancs` énumère. Il n'y a donc **plus rien à maintenir
      en double**. Cinq cas rejoignent le tableau partagé du §4.3, dont deux blancs **non-ASCII**
      qu'un élargissement minimal `btrim(v, E' \t\r\n')` n'aurait pas couverts. **Prouvé** :
      `0014_valeurs_champs.test.sql` (six assertions, contre-cas compris), le test unitaire du
      prédicat **retourné et non retiré**, et la preuve d'API qui confronte les deux lectures aux
      mêmes valeurs en base.

- [x] **Spécification écrite avant tout code**, `docs/SPEC-form-composer.md` §6 réécrit en douze
      sous-chapitres : le §6 d'origine tenait en dix lignes, disait *où* la validation vit sans
      jamais dire sur quelles colonnes la table repose, ce qu'un refus rend, ce que « renseigné »
      veut dire, ni ce qu'il advient d'une valeur portée par un champ archivé. Rédigé **après
      mesure** sur la pile réelle — sondes créées puis détruites, `SQLSTATE` et codes HTTP relevés à
      la main —, avec un contrat d'API de **dix-huit lignes** écrit avant le code pour être mesuré
      et non supposé. Commit documentaire dédié, poussé avant la première ligne de SQL.
- [x] **INC-047 est close, et l'arbitrage n'avait pas à être demandé une seconde fois**
      (décision 123). Son option 1 — rattacher la sixième vérification de `move_card` à `CRM-036` —
      n'est pas une décision de produit : c'est la lecture littérale de la Definition of Done de
      cette unité, qui porte « union étape + transition », et du §7.2 qui porte « champ `hidden` non
      exigé même si vide ». Livrer l'unité sans écrire la n° 6 l'aurait amputée de ce qu'elle nomme.
- [x] `supabase/migrations/0013_valeurs_champs.sql` : la table, **trois clés étrangères
      composites**, l'unicité ajoutée à `cards`, la validation par type par trigger,
      `app.valeur_de_champ_est_vide`, `app.can_write_card`, deux index, trois politiques, les
      privilèges, et la **redéfinition de `move_card` avec sa sixième vérification**.
- [x] **L'unicité qui manquait à `cards`, trouvée par la mesure** (décision 124) : une clé étrangère
      composite `(card_id, workflow_id)` était impossible, `cards` ne portant que `PRIMARY KEY (id)`.
      MESURÉ : « there is no unique constraint matching given keys for referenced table "cards" ».
      `UNIQUE (id, workflow_id)` lui est ajoutée — **elle ne change aucun comportement**, `id` étant
      déjà clé primaire, elle rend seulement la relation exprimable.
- [x] **La validation est un trigger parce qu'un `CHECK` ne peut pas la porter** (décision 125) :
      MESURÉ, « cannot use subquery in check constraint ». Le type gouvernant une valeur vit sur une
      **autre** table. `SECURITY DEFINER` : le trigger doit voir **tous** les champs, pas ceux que
      la RLS de l'appelant lui montre — un champ invisible ne doit pas être un champ non validé.
- [x] **Le point ouvert n° 4 du §8 est clos du côté qui compte** (décision 131) : la base ne
      contraint toujours pas la forme de `options.choices`, mais un `select` ou un `multiselect`
      dont la clé ne figure pas dans les choix déclarés est **refusé**. Aucune card ne peut plus
      porter une réponse que son champ n'offre pas.
- [x] **La sixième vérification de `move_card`, et l'union qu'elle contrôle** : les champs
      `required` de l'étape cible unis aux `require_fields` de la transition, **moins** les champs
      archivés (décision 129) et les identifiants que la jointure ne résout pas (décision 128).
      Chaque exclusion est une décision écrite, et chacune est **figée par une assertion**.
- [x] **La liste des clés manquantes voyage dans le `DETAIL`, pas dans le message** (décision 126),
      et le choix est mesuré : la première écriture rendait le `message` incomparable par égalité,
      là où les cinq refus déjà livrés sont des jetons stables. MESURÉ que PostgREST expose ce
      `DETAIL` dans la clé `details` de sa réponse.
- [x] **UN DÉFAUT DE CONCEPTION RÉEL, TROUVÉ PAR LE SEED LUI-MÊME** (décision 133, INC-054).
      `docs/SCHEMA.md` §4 exigeait `value` **non nul**, avec `'null'::jsonb` pour « explicitement
      vide ». MESURÉ : PostgREST convertit un `null` JSON en **SQL NULL** et ne sait produire
      `'null'::jsonb` par aucune écriture. « Vider un champ `money` » n'avait donc **aucune écriture
      licite** — chaîne vide refusée par la validation de type, SQL NULL par la colonne, aucune
      suppression exposée. La colonne est rendue nullable. **Aucune suite pgTAP ne l'aurait vu** —
      `insert … values (…, 'null'::jsonb)` passe très bien —, ni aucun test d'API écrit *après* le
      code, qui l'aurait été contre le comportement observé.
- [x] **UN SECOND DÉFAUT RÉEL, TROUVÉ PAR LA SUITE pgTAP DE L'UNITÉ** (décision 134). Les
      privilèges par défaut de l'image Supabase accordent **tout** — `DELETE` compris — à `anon` et
      `authenticated` sur toute table neuve. Le « refus double » annoncé au §6.9 n'existait donc
      pas : seule la politique RLS refusait. C'est la décision 80 sur les *fonctions*, dont la
      conséquence pour les *tables* n'avait jamais été tirée. `revoke all` posé avant les `grant`,
      de sorte qu'un rejeu **répare** un privilège relâché à la main.
- [x] **Test unitaire dédié** : `supabase/tests/0014_valeurs_champs.test.sql`, **98 assertions,
      aucune anomalie** — forme de la table, unicité ajoutée à `cards`, les trois clés composites
      **dans les deux sens**, les quinze types validés dans les deux sens, la définition de
      « renseigné » y compris `false` et `0`, la sixième vérification et ses quatre exclusions, la
      RLS, les politiques, les privilèges, et la conformité du seed.
- [x] **Test d'intégration dédié, hors interface** : `e2e/api/valeurs-champs.spec.ts`, **22
      scénarios**, avec les jetons réels des trois profils seedés. Les dix-huit lignes du contrat
      d'API du §6.10 y sont rejouées, chaque refus **relisant la ligne** pour la constater inchangée.
- [x] **Deux lignes du contrat ont été révisées par la mesure**, plutôt que les tests relâchés :
      une violation de clé étrangère rend `409` et non `400` ; un `DELETE` refusé à un rôle
      **authentifié** rend `403` et non `401` — même correction qu'au §2.8 de `CRM-035`.
- [x] **Preuves de refus n° 4 et n° 11 acquises au niveau des valeurs** : le `viewer`, fermé sur le
      track par un droit fin, ne voit **aucune** valeur des cards de `grands-comptes` ; l'anonyme
      obtient `200` et `[]` sur une table qui porte pourtant quatorze lignes. Le refus est mesuré
      comme **zéro ligne**, jamais comme une erreur.
- [x] **Seed repris dans le même changement** : quatorze valeurs sur six cards, dont une **vidée
      explicitement** — une ligne présente n'est pas une valeur renseignée —, une portée par un
      champ **archivé**, et une **paire** de cards à la même étape dont l'une passe et l'autre non,
      sans quoi un refus ne prouverait pas que la règle discrimine. `require_fields` cesse d'être
      vide : « Démarrer la réalisation » exige `lien-proposition`, seule donnée du seed qui exerce
      le **second membre** de l'union.
- [x] **Build vert**, `npm run typecheck` vert sur les quatre projets, `npm run types:check` vert
      après régénération. `npm run test:sql` **1051 assertions**, `npm run test:unit` **164 tests**,
      `npm run e2e:api` **242 scénarios**.
- [x] Harnais de preuves rejouable `scripts/verify-valeurs-champs.sh` : **33 contrôles, aucune
      anomalie**, et **non complaisant, éprouvé par trois dégradations réelles** — trigger de
      validation désactivé, `move_card` ramenée à sa version de la migration 12, politique
      d'insertion adossée à la **lecture**. Chacune fait passer une écriture ou une transition qui
      doit être refusée, et la restauration est **constatée**. Il mesure aussi la **dépendance
      d'ordre 12 → 13** dans les deux sens : rejouer la 12 seule retire la sixième vérification.
- [x] **Six garde-fous figés par des unités précédentes ont échoué comme prévu, et ont été révisés**
      (mécanisme de la décision 51, neuvième occurrence) : les deux assertions d'INC-047 dans
      `0013_move_card.test.sql` et `move-card.spec.ts` sont **retournées** ; les trois constats de
      `require_fields` vide **comptent** désormais ; l'assertion d'absence de `card_field_values`
      dans `0012_cards.test.sql` constate la présence **et** la conséquence qui comptait —
      `app.can_read_card` a son premier appelant. **Aucun n'a été retiré.**
- [x] `docs/SPEC-form-composer.md` (§6 réécrit, §7 scindé, §8 mis à jour), `docs/SCHEMA.md` §4,
      `docs/SPEC-permissions-rls.md` §3.7, §4, §7, `docs/SPEC-workflow-engine.md` §5.3, §5.7, §5.9,
      §8, §9, `docs/SPEC-seed.md` §2.13, `docs/DAT.md`, `docs/PROD_MIGRATIONS.md` §3 (migration 13),
      `docs/manual.md` chapitres 4.3, 5, 6, 23 et 24, `README.md`, `CHANGELOG.md` mis à jour dans le
      même changement.
- [ ] **Aucun écran, aucune capture, aucun test E2E d'interface.** Le rendu du formulaire, sa
      section repliée et la mention « requis pour passer à » sont `CRM-037` ; et la webapp reste un
      appelant **anonyme** faute d'écran de connexion — **INC-021, en attente d'arbitrage**. Une
      valeur de formulaire est par construction invisible à un anonyme, qui ne voit déjà aucune
      card : il n'existe **aucune** vérification visuelle sensée à produire pour cette unité tant
      que l'arbitrage n'est pas rendu. **Cette preuve est bloquée par un arbitrage, pas par un
      défaut de l'unité.**
- [ ] **`user` et `contact` ne sont pas résolus** : leur valeur est validée comme un `uuid`, et rien
      de plus. `contacts` n'existe pas (`CRM-060`), et résoudre `user` seul rendrait la famille
      incohérente tout en posant une règle d'appartenance que nul document n'énonce —
      **INC-053, arbitrage attendu** (décision 132). L'écart est figé par une assertion : un `uuid`
      bien formé désignant un profil **inexistant** est accepté aujourd'hui.
- [x] **`npm run e2e:ui` : 37 scénarios verts**, au prix du contournement récurrent d'INC-036
      (**sixième** occurrence). Les captures réécrites par ce rejeu ont été **regardées puis
      restaurées**, comme aux cinq unités précédentes : cette unité ne touche aucun composant de
      l'interface, et l'écran reste celui d'un appelant anonyme.
- [x] **Aucune régression sur les dix-sept harnais précédents, APRÈS correction de trois d'entre
      eux** — `verify-stack` 33, `verify-migrations` 23, `verify-authz` 26, `verify-seed` 49,
      `verify-types` 30, `verify-webapp` 41, `verify-harness` 25, `verify-tracks` 40,
      `verify-channels` 23, `verify-catalogue` 32, `verify-workflows` 42, `verify-copie-workflow`
      27, `verify-coherence-workflow` 26, `verify-champs-formulaire` 30, `verify-droits-fins` 35,
      `verify-cards` 37, `verify-move-card` 55 —, aucune anomalie.
- [x] **UN HARNAIS LAISSAIT LE PRODUIT DÉGRADÉ EN SORTANT, ET C'EST LE REJEU QUI L'A TROUVÉ**
      (décision 135). `scripts/verify-move-card.sh` rejoue la migration 12 en trois endroits ; la 13
      la redéfinissant, chaque rejeu **retirait la sixième vérification** sans aucun signal, et les
      harnais exécutés ensuite mesuraient un produit amputé. **Seconde occurrence exacte de la
      décision 108.** Corrigé : les deux migrations sont rejouées dans l'ordre, et la restauration
      de sortie rejoue la 13.
- [x] **Deux autres harnais révisés** (décisions 136 et 137) : les compteurs de
      `verify-harness.sh`, restés à ceux de `CRM-035` alors que trois unités les avaient dépassés
      depuis — l'omission est **nommée** dans le fichier plutôt que lissée ; et la dégradation
      d'`verify-authz.sh` qui retirait `app.can_read_card`, devenue inapplicable puisque la fonction
      a désormais un appelant réel — un `cascade` la **renforce** au lieu de la retirer.

*DoD adaptée, écarts explicites.* La Definition of Done demandait « pgTAP (type incorrect refusé,
`hidden` non exigé, règle ajoutée après coup n'invalidant pas l'existant) ». Les trois sont livrées,
largement au-delà — les quinze types éprouvés dans les deux sens, l'union et ses quatre exclusions,
dix-huit lignes de contrat d'API mesurées, trois dégradations réelles. **Aucun test E2E d'interface,
aucune vérification visuelle** : l'unité ne livre aucun écran, et l'absence est nommée plutôt que
compensée par une preuve de substitution.

*Limites nommées, non masquées.*

- **Aucun écran.** Dixième unité consécutive à buter sur INC-021.
- **`user` et `contact` ne sont pas résolus** — INC-053, arbitrage attendu.
- **INC-037 est désormais portée par `CRM-018`** : la décision 293 impose la copie atomique des
  champs, règles et exigences. La limite historique reste une mesure utile, mais n'est plus le
  comportement cible.
- **Une valeur écrasée ne laisse aucune trace** : `card_events` est due par `CRM-044`.
- **`phone` n'est pas contraint**, les formats nationaux étant trop divers pour qu'un refus soit
  défendable ; `file` ne vérifie pas que l'objet existe dans Storage. Les deux écarts sont figés par
  des assertions plutôt que laissés à la prose.
- **Sur l'hôte de vérification, la chaîne s'exécute sous Node 22.22.2**, alors que le dépôt exige
  Node 24. Limite héritée, inchangée.
- **Trois contournements hors dépôt ont dû être refaits**, comme les entrées correspondantes le
  prédisaient : démon Docker lancé à la main (`dockerd --host=…`), image `webapp` construite avec le
  certificat du proxy suivie d'un `npm ci` précédé d'un `npm config set cafile` (INC-032, INC-042),
  et l'arborescence de compatibilité des navigateurs Playwright (INC-036, **sixième** occurrence).

### CRM-037 — Rendu du formulaire conditionnel `[~]`
Champs par étape, section repliée des valeurs d'autres étapes, mention « requis pour passer à ».
**DoD** : E2E (transition bloquée, saisie, transition réussie) ; captures de chaque étape ;
accessibilité des erreurs vérifiée.

- [x] **Spécification écrite avant tout code**, `docs/SPEC-form-composer.md` §4 : le chapitre
      « Rendu » tenait en **cinq lignes** écrites à `CRM-000`, qui disent ce que l'écran montre sans
      jamais dire comment il le compose ni ce qu'il faut en prouver. Réécrit en contrat vérifiable
      **après mesure du seed en base** — sept champs dont un archivé, dix-sept règles, neuf cards,
      quatorze valeurs —, avec les cinq règles d'origine **citées mot pour mot**. Commit
      documentaire dédié, poussé avant la première ligne de code (décision 160).
- [x] **Une addition, et une seule, au-delà de la lettre du §4 : le champ archivé.** Le §5 posait
      depuis `CRM-000` que ses valeurs « restent consultables dans la section repliée » ; le §4 ne
      nommait pas cette destination. Elle est écrite au §4.2 plutôt que laissée à l'interprétation
      du composant, et le seed la rend démontrable.
- [x] **La composition part des champs, jamais des règles**, comme le §3.1 l'exige. MESURÉ sur le
      seed : à `Prospection`, **cinq règles pour six champs actifs** — `decideur-identifie` n'a
      aucune règle et doit apparaître par le défaut `visible`. Une lecture par les règles le
      perdrait sans qu'aucune erreur ne le signale ; une dégradation du harnais le vérifie.
- [x] **Les trois destinations du §4.2 sont exercées par des données que le produit porte** : la
      card `…0000c6` est à `Prospection`, où `motif-perte` est `hidden`, et porte pourtant une
      valeur pour ce champ. Un contrôle du harnais échoue si le seed cesse de le démontrer.
- [x] **L'INTERFACE ET LA GARDE LISENT « RENSEIGNÉ » DE LA MÊME FAÇON, ET C'EST MESURÉ.** Le §6.6
      l'exigeait « faute de quoi l'interface annoncerait passable une transition que la garde
      refuse », sans qu'aucune preuve ne le tienne — deux codes, deux langages, deux processus.
      Un **tableau de cas partagé** de douze valeurs vit désormais dans
      `webapp/src/lib/valeur-renseignee.ts`, seul de son espèce : le test unitaire l'exerce contre
      le prédicat TypeScript, et `e2e/api/rendu-formulaire.spec.ts` écrit **les mêmes valeurs** dans
      de vraies lignes `card_field_values`, par la vraie route et avec le jeton réel de
      l'administratrice, puis lit le jugement de `move_card`. **15 scénarios, aucune anomalie.**
- [x] **La card ne bouge jamais pendant cette preuve**, et le procédé est écrit : `budget` étant
      vide par contrat de seed, tout déplacement est refusé de toute façon, et c'est la **liste des
      clés manquantes** qui porte l'information. Le seed sort intact — ce qu'un déplacement réussi
      ne permettrait pas, `current_step_id` n'étant réécrivable par personne depuis `CRM-013`.
- [x] **Un champ archivé n'est ni affiché ni exigé** : le §4.2 l'écarte du formulaire, le §6.7 ne
      l'exige pas. Les deux règles se répondaient sans qu'aucune assertion ne les tienne ensemble ;
      c'est désormais le scénario R2 de la preuve d'API.
- [x] **Écran hôte livré** : `webapp/src/app/RouteCard.tsx`, route
      `/tracks/:slugTrack/:slugChannel/cards/:idCard` (§4.6). C'est le procédé de `CRM-021`, qui a
      livré la route d'un track parce que la barre d'onglets n'avait aucun hôte. **Rien d'autre du
      §5.3 du design system n'est livré** : timeline (`CRM-044`), commentaires (`CRM-043`) et champs
      d'en-tête (`CRM-040`) restent dus. La card est désignée par son **identifiant** — aucun slug
      n'existe, et son adresse email est délibérément non devinable.
- [x] **Accessibilité prouvée sur le composant réel, pas déclarée** : libellé résolvant vers son
      contrôle par `for`, astérisque **décoratif** doublé d'un texte lisible par lecteur d'écran,
      mention « requis pour passer à <étape> » nommant l'étape, alerte `role="alert"` citée par
      `aria-describedby`, `aria-invalid` sur le champ exigé et vide, section repliée `details` /
      `summary` **ouverte au clavier** dans le navigateur réel.
- [x] **Aucune écriture, et l'écran dit pourquoi** (§4.7) : les contrôles sont indisponibles,
      restent lisibles, et un bandeau nomme la cause — enregistrer exige une session, INC-021. Ce
      que `docs/DESIGN_SYSTEM.md` §8 exige d'un état désactivé. Un formulaire où l'on saisirait sans
      pouvoir enregistrer serait un piège ; un formulaire muet serait une perte d'information.
- [x] **UN DÉFAUT RÉEL, TROUVÉ PAR LE CONTRÔLE DE CLASSES ET NON À L'ŒIL** (décision 162). La case à
      cocher avait été écrite en `size-5`, soit 20 px. L'échelle du §3 est **fermée** et
      `--spacing-5` n'existe pas : la classe n'était **pas engendrée du tout**, en silence, et la
      case perdait sa taille. Exactement le défaut que `docs/DESIGN_SYSTEM.md` §11 décrit, et que
      `scripts/lib/classes-css.mjs` existe pour attraper. Corrigé en `size-6` (24 px), valeur de
      l'échelle.
- [x] **Deux règles visuelles ajoutées au design system**, §5.7 bis, dans le même changement :
      une case à cocher occupe une ligne de hauteur `--size-target` — une case de 16 px isolée était
      la seule cible du produit sous les 40 px du §8 —, et une valeur en lecture seule dont le type
      est un montant, une date ou un horodatage se rend en **donnée technique** au sens du §2. Les
      deux ont été trouvées **en regardant une capture**, pas en lisant un test.
- [x] **Vérification visuelle réellement observée** : `docs/captures/CRM-037/`, huit captures —
      card introuvable, formulaire chargé, champ exigé en défaut, section repliée ouverte, et les
      **quatre paliers** du §7. Produites depuis l'application **construite et servie**, regardées
      une à une ; c'est en les regardant que les deux règles ci-dessus ont été écrites.
- [x] **Preuves d'interface** : `e2e/ui/formulaire.spec.ts`, **10 scénarios**, contre le build de
      production. Deux d'entre eux n'emploient **aucune substitution** — la route interroge
      réellement `/rest/v1/cards`, filtrée sur l'identifiant et sur `deleted_at`, et l'appelant
      anonyme obtient l'état « card introuvable », qui est le refus réel du backend. Les huit autres
      **substituent la réponse réseau**, procédé endossé par `docs/DESIGN_SYSTEM.md` §12.5, et
      chacun le dit.
- [x] **Tests unitaires dédiés** : `webapp/src/lib/formulaire.test.ts` (**30 tests** : composition,
      les trois destinations, l'ordre, le défaut `visible`, les clés manquantes, le tableau de cas)
      et `webapp/src/app/FormulaireCard.test.tsx` (**23 tests** sur le composant réel).
      `npm run test:unit` passe de 164 à **227 tests**.
- [x] Harnais de preuves rejouable `scripts/verify-formulaire.sh` : **45 contrôles, aucune
      anomalie**, et **non complaisant** — six dégradations volontaires le font réellement échouer :
      `false` compté comme vide (côté unitaire **et** confronté à la base), un champ sans règle qui
      disparaît, un champ archivé qui revient dans le formulaire, `role="alert"` retiré, la mention
      d'exigence supprimée. Sa section 7 vérifie qu'il **rend les fichiers intacts** et rejoue les
      tests après restauration (mécanisme des décisions 143, 145, 157).
- [x] **Build vert**, `npm run typecheck` vert sur les quatre projets, `npm run test:sql`
      **1164 assertions** inchangées, `npm run e2e:api` **306 scénarios** (291 + 15),
      `npm run e2e:ui` **47 scénarios** (37 + 10).
- [x] **Un garde-fou figé a échoué comme prévu, et a été révisé** (mécanisme de la décision 51,
      onzième occurrence) : `scripts/verify-harness.sh` attendait 291 scénarios d'API et 37
      d'interface. Révisé à **306** et **47** dans le même changement, valeurs mesurées ;
      `ASSERTIONS_ATTENDUES` reste à 1164, l'unité n'ajoutant aucune assertion pgTAP.
- [x] **Aucune régression** : `verify-harness` 25, `verify-webapp` 41, `verify-tracks` 43,
      `verify-channels` 30, `verify-valeurs-champs` 40 — aucune anomalie.
- [x] `docs/SPEC-form-composer.md` §4 et §7.3, `docs/DESIGN_SYSTEM.md` §5.7 bis,
      `docs/SPEC-webapp.md` §5.2, `docs/DAT.md` §3.1, `docs/manual.md` §4.7 et sommaire,
      `docs/INCONSISTENCY_REPORT.md` INC-062, `docs/JOURNAL.md`, `CHANGELOG.md` mis à jour dans le
      même changement.
- [ ] **LE PARCOURS QUE LA DEFINITION OF DONE EXIGE N'EST PAS ATTEIGNABLE — INC-062.** « Transition
      bloquée → saisie → transition réussie » suppose une **session** (INC-021) et un **contrôle de
      transition**, dû par `CRM-041`, que `docs/MASTER_PLAN.md` §2 ordonne **après** cette unité.
      Il n'y a pas d'erreur d'ordre à corriger : il y a une preuve écrite en supposant un écran que
      le plan livre plus tard. Trois options d'arbitrage sont portées au responsable, **aucune n'est
      appliquée en silence**.
      **Cette preuve est bloquée par une dépendance et par un arbitrage, pas par un défaut de
      l'unité.**
- [ ] **« Captures de chaque étape » n'est pas tenu à la lettre.** Les captures montrent **une**
      étape — `Prospection` —, celle de la card que le seed place là et qui exerce les trois
      destinations du §4.2. Capturer les sept étapes exigerait sept cards, une par étape, que le
      seed ne pose pas et qu'inventer ici dépasserait l'unité. Le fait est nommé, pas contourné.
- [ ] **L'ÉCRITURE DEPUIS L'ÉCRAN APPARTIENT À CETTE UNITÉ — INC-088, décision 334.** La limite
      « aucune écriture depuis l'écran » (§4.7) s'imputait à **INC-021**, close depuis `CRM-009` :
      le motif invoqué avait disparu sans que la limite soit réexaminée, et la fiche affiche encore
      « Consultation seule : l'enregistrement des réponses n'est pas encore livré dans cette fiche ».
      L'unité n'est pas élargie, elle est **ramenée à son énoncé** : sa Definition of Done exige
      depuis l'origine « E2E (transition bloquée, **saisie**, transition réussie) ». Aucune règle
      n'est inventée — `CRM-036` livre déjà `card_field_values`, ses politiques et sa validation ;
      il ne manque que le chemin vers elles. Reste dû : la saisie, son refus backend mesuré **hors
      interface** pour un profil sans droit d'écriture, les captures aux quatre paliers, le retrait
      du bandeau « Consultation seule » et la mise à jour de `docs/manual.md`.
  *Énoncé d'origine, conservé pour la trace : « **Aucune écriture depuis l'écran** (§4.7), donc
  aucune preuve de saisie. Relève d'INC-021. » La limite reste vraie à l'écran ; c'est son **motif**
  qui est caduc, pas son constat.*
- [ ] **Le défilement jusqu'au premier champ concerné** (§4.5) n'est pas livré : il appartient au
      geste de transition, qui n'existe pas. Même cause qu'INC-062.

*DoD adaptée, écarts explicites.* **Aucun test pgTAP dédié** : cette unité ne livre ni table, ni
fonction, ni politique — son objet est un rendu. La règle de base qu'elle doit respecter,
« renseigné », est déjà couverte par la suite de `CRM-036` ; ce que cette unité ajoute est la
**preuve que les deux lectures coïncident**, et cette preuve ne peut vivre qu'à cheval sur les deux
côtés, donc dans le projet `api`. **Aucune mise à jour du seed** : les données que le rendu démontre
y sont déjà — la card `c6`, son champ `hidden` porteur d'une valeur, son champ sans règle, son champ
archivé — et deux contrôles du harnais échouent si elles cessent d'y être. L'unité n'introduit ni
table, ni statut, ni flux.

*Correction apportée après la livraison, par une seconde exécution de la routine.*

- [x] **Le prédicat « renseigné » divergeait de la garde, et c'est la mesure qui l'a dit** —
      décision 165, INC-052 seconde occurrence. `estRenseigne` employait `String.prototype.trim()`
      pour transcrire la clause « chaîne vide après `btrim` » du §6.6. `btrim(texte)` ne retire que
      l'espace U+0020 ; `trim()` retire toute l'espace blanche. MESURÉ contre la base réelle : une
      valeur réduite à `"\t"` ou `"\n"` est **renseignée** pour `app.valeur_de_champ_est_vide` et
      satisfait un champ `required`, là où l'interface l'annonçait vide. **Reproduit avant d'être
      corrigé** : les deux cas ajoutés au tableau de cas partagé ont rendu deux tests unitaires et
      deux scénarios d'API rouges **avant** que le prédicat ne soit touché. Corrigé en reproduisant
      `btrim` fidèlement, sans élargir la règle — l'arbitrage d'INC-052 reste dû. Dégradation
      **D2 bis** ajoutée à `scripts/verify-formulaire.sh`, confrontée à la base.
- [x] **Ce que l'épisode dit du harnais** : le mécanisme de comparaison était **bon** — tableau de
      cas partagé, confronté à la base — et il n'a rien attrapé, parce que le tableau ne contenait
      pas le cas. Un comparateur ne vaut que les cas qu'on lui donne, comme la décision 50 le disait
      des tables vides.

*Seconde correction après la livraison, par une troisième exécution de la routine.*

- [x] **LA BARRE D'ONGLETS ÉTAIT VIDE SUR LA ROUTE D'UNE CARD, ET LE §4 DU DESIGN SYSTEM DIT LE
      CONTRAIRE** — décision 167. `RouteCard` transmettait `slugTrack` à la coquille **sans** les
      channels du track porteur : toute fiche s'ouvrait sous « Aucun channel », là où
      `docs/DESIGN_SYSTEM.md` §4 pose « Onglets : les channels du track courant ». Le défaut avait
      été relevé sur une capture par l'exécution précédente et laissé en l'état pour ne pas mêler
      deux sujets dans un commit ; il est corrigé ici.
- [x] **Spécification écrite avant le code, dans un commit dédié** : `docs/SPEC-form-composer.md`
      §4.6 bis — ce que la coquille montre autour du formulaire, ce qu'elle fait d'un échec de
      chargement, et ce qu'elle ne vérifie **pas** — et `docs/SPEC-channels.md` §5.4, qui pose la
      règle générale : toute route dont l'adresse porte un `slugTrack` alimente la barre par le
      chargeur du §5, et aucune ne réécrit sa propre lecture des channels.
- [x] **Aucune seconde lecture des channels n'est écrite.** `RouteCard` emploie `useContenuTrack`,
      celui de `CRM-021`. La projection d'un état de contenu de track en état de channels quitte
      `RouteTrack` pour `webapp/src/lib/channels.ts` : elle est désormais **partagée**, et non
      recopiée. Quatre tests unitaires l'exercent, dont celui qui interdit qu'un échec devienne un
      état vide.
- [x] **L'onglet courant n'est pas calculé, et c'est mesuré.** `NavLink` le résout par préfixe de
      segments, l'adresse d'une card commençant par celle de son channel. Le scénario d'interface
      exige qu'**un seul** onglet porte `aria-current="page"` — sans ce compte, servir un unique
      channel aurait rendu l'assertion vraie par accident.
- [x] **Preuves d'interface : 3 scénarios de plus**, `e2e/ui/formulaire.spec.ts`. Le premier
      n'emploie **aucune substitution** : anonyme, la route demande réellement le track de
      l'adresse — `slug=eq.formation`, `archived_at=is.null` —, la requête de channels n'est **pas**
      émise faute de track résolu, et la barre affiche l'état vide, qui est le refus réel du backend.
      Les deux autres substituent la réponse réseau (`docs/DESIGN_SYSTEM.md` §12.5) et le disent.
      `npm run e2e:ui` passe de 47 à **50 scénarios**.
- [x] **L'ADRESSE DE LA PREUVE N'ÉTAIT L'ADRESSE DE RIEN — INC-065.** Elle nommait
      `/tracks/inter-entreprises/formations/…` ; MESURÉ en base, la card `…0000c6` appartient au
      channel `inter-entreprises` du **track `formation`**. Les deux segments étaient intervertis et
      le second n'existait pas — et **aucune assertion ne pouvait le voir**, la card étant résolue
      par son seul identifiant. L'adresse redevient celle du produit. Que rien ne confronte le couple
      `(slugTrack, slugChannel)` à la card reste **non tranché** : comportement inchangé, arbitrage
      demandé.
- [x] **Harnais non complaisant, éprouvé** : `scripts/verify-formulaire.sh` gagne la dégradation
      **D7**, qui remet la route dans son état fautif — `etatChannels` retiré — et exige que la
      preuve d'interface **tombe**. Elle tombe. La cible `ui` est ajoutée à son mécanisme de
      dégradation, qui ne connaissait que `unit` et `api` ; `RouteCard.tsx` rejoint les fichiers dont
      la restitution est constatée en section 7. Le harnais passe de 45 à **49 contrôles, aucune
      anomalie**.
- [x] **Vérification visuelle réellement observée** : `docs/captures/CRM-037/coquille-onglets-1440.jpg`
      — les deux onglets rendus, celui de l'adresse souligné et bleu, la pilule du track porteur
      active dans la barre latérale, le formulaire sous cette barre. Les huit captures antérieures
      ont été **régénérées** : elles montrent désormais la coquille cohérente que le produit rend, et
      non un formulaire sous une barre vide. Toutes regardées.
- [x] **Un garde-fou figé a échoué comme prévu, et a été révisé** (mécanisme de la décision 51,
      douzième occurrence) : `scripts/verify-harness.sh` attendait 47 scénarios d'interface. Révisé
      à **50**, valeur mesurée.
- [x] **ET IL A DÉNONCÉ UNE RÉVISION OMISE PAR LA CORRECTION PRÉCÉDENTE.** MESURÉ :
      `npm run e2e:api` rend **308** scénarios, quand `SCENARIOS_API` valait encore 306. La
      correction du prédicat « renseigné » (décision 165) avait ajouté deux cas au tableau de cas
      partagé — `"\t"` et `"\n"` —, donc deux scénarios à `e2e/api/rendu-formulaire.spec.ts`, qui
      passe de 15 à **17**, sans réviser ce compteur dans le même changement. Le contrôle a fait ce
      qu'on lui demande ; c'est la révision qui manquait. Portée à **308** ici.
      `ASSERTIONS_ATTENDUES` reste à **1164** : aucune assertion pgTAP n'est ajoutée par l'une ni
      par l'autre de ces deux reprises.
- [x] **Chaîne complète rejouée** : `npm run typecheck` vert sur les quatre projets,
      `npm run test:unit` **234 tests** (230 avant, quatre de plus pour la projection),
      `npm run test:sql` **1164 assertions**, `npm run e2e:api` **308 scénarios**,
      `npm run e2e:ui` **50 scénarios**, `npm run build` vert et chaque classe citée présente dans
      le CSS produit. `scripts/verify-harness.sh` : **25 contrôles, aucune anomalie**, compteurs
      révisés compris.
- [x] `docs/SPEC-form-composer.md` §4.6 bis et §7.3, `docs/SPEC-channels.md` §5.4,
      `docs/manual.md` §4.7, `docs/INCONSISTENCY_REPORT.md` INC-065, `docs/JOURNAL.md` décision 167,
      `CHANGELOG.md` mis à jour dans le même changement. **`docs/DESIGN_SYSTEM.md` n'est pas
      modifié** : aucune règle visuelle, aucun composant et aucun écart nouveaux — la correction rend
      l'implémentation conforme au §4 existant, et la règle d'architecture de l'information vit dans
      `docs/SPEC-channels.md`.

*Limites nommées, non masquées.*

- **INC-062 est ouverte** et conditionne le passage en `[x]` (voir ci-dessus).
- **INC-065 est ouverte** : rien ne confronte le couple `(slugTrack, slugChannel)` de l'adresse à la
  card qu'elle désigne. Aucun droit n'est contourné — chaque lecture reste soumise à sa politique —,
  mais aucune spécification ne dit ce qu'une adresse incohérente doit rendre. Comportement inchangé,
  correction à rattacher à `CRM-040` ou `CRM-045`.
- **INC-063 est ouverte** : `docs/SPEC-form-composer.md` §4.5 prescrit `role="alert"` pour le
  **message d'exigence**, `docs/DESIGN_SYSTEM.md` §5.7 le réserve à l'**erreur**. Le code a tranché
  pour la seconde lecture — la mention est un texte ordinaire, `role="alert"` ne porte que sur
  l'alerte de champ manquant — et c'est probablement la bonne, mais c'est une **résolution
  implicite** qui n'était consignée nulle part. Le comportement est **laissé inchangé** ;
  l'arbitrage est demandé.
- ~~**La barre d'onglets reste vide sur la route d'une card.**~~ **CORRIGÉ** par la troisième
  exécution — voir la section ci-dessous.
- **Aucune donnée métier n'apparaît dans l'interface tant qu'INC-021 n'est pas tranchée.** Sixième
  unité consécutive du chunk 3 à buter sur le même obstacle, et la première dont un écran existe
  pourtant : la route rend « card introuvable » à tout visiteur, ce qui est le refus réel du backend.
- **`user`, `contact` et `file` ne sont pas résolus** (INC-053) : le rendu affiche leur valeur
  **brute** plutôt qu'un nom qu'il ne peut pas obtenir.
- **Les champs exigés par une transition** (`require_fields`, §3.5) ne sont pas signalés : ils
  dépendent de l'arête empruntée, donc d'un geste qui n'existe pas encore.
- **La colonne droite du §5.3 du design system n'est pas livrée**, et la grille reste donc à une
  colonne. L'écart est nommé dans le composant plutôt que comblé par un panneau vide.
- **`scripts/verify-cards.sh` rend 44 sur 45**, pour la raison déjà consignée — **INC-061**, son
  propre jeu d'essai encore en base quand il rejoue `npm run test:sql`. Reproduit à l'identique ici,
  **non corrigé** : c'est un livrable de `CRM-040`, et le reprendre dans ce commit contredirait
  `CLAUDE.md` §13. MESURÉ : `npm run test:sql` lancé après sa sortie rend 1164 assertions sans
  anomalie, et la base porte bien neuf cards.
- **Deux contournements hors dépôt ont dû être refaits**, comme les entrées correspondantes le
  prédisaient : démon Docker lancé à la main, image `webapp` construite avec le certificat du proxy
  (INC-032, INC-042), et l'arborescence de compatibilité des navigateurs Playwright — INC-036,
  **huitième** occurrence.
- **Sur l'hôte de vérification, la chaîne s'exécute sous Node 22.22.2**, alors que le dépôt exige
  Node 24. Limite héritée, inchangée.

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
- [x] Harnais de preuves rejouable `scripts/verify-cards.sh` : **45 contrôles, aucune anomalie**, et
      **non complaisant, éprouvé par trois dégradations réelles** — politique de lecture ramenée à
      `is_workspace_member`, `WITH CHECK` rendu permissif, garde d'archivage retirée. Chacune fait
      passer une opération qui doit être refusée, et la restauration est **constatée**.
- [x] **DEUX DÉFAUTS DE CE HARNAIS, TROUVÉS ET CORRIGÉS LE 2026-08-05 pendant `CRM-036`**
      (INC-055, décision 143). Ils sont consignés ici, sur l'unité qui porte le harnais, et non sur
      celle qui les a trouvés.
      1. **Il désactivait la garde centrale de `CRM-034` derrière lui.** Il restaurait en rejouant
         `0011_cards.sql` **seul**, dont la section 7 rend à `authenticated` l'`UPDATE` de table sur
         `cards` — ce que `0012` retire précisément. MESURÉ, avant et après son passage sur une base
         saine : le privilège passait de `false` à `true`, et `npm run test:sql` de « aucune
         anomalie » à **huit assertions en échec**. Il annonçait pendant ce temps « aucune
         anomalie » : vrai de ce qu'il mesurait, faux **ailleurs et plus tard**. Il rejoue désormais
         sa migration **et celles qui la complètent**.
      2. **Sa dégradation *b* ne prouvait plus rien**, et ne l'exerçait que grâce au défaut n° 1 :
         elle éprouvait le `WITH CHECK` de `cards_maj` par un `PATCH` de `channel_id`, colonne
         fermée au niveau **privilège** depuis `CRM-034`. Réécrite **en deux temps** — refus par le
         seul privilège, puis `WITH CHECK` réellement exercé une fois le privilège rendu —, elle
         mesure désormais chaque barrière séparément. Le contrôle en sort **plus fort**.
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

### CRM-041 — Board kanban `[x]`
Colonnes par étape, glisser-déposer appelant `move_card`, menu des transitions déclarées,
retour arrière visuel en cas de refus.
**DoD** : E2E de déplacement autorisé **et** de tentative interdite ; déplacement au clavier
vérifié ; captures aux quatre paliers ; vidéo `.webm` du glisser-déposer.

- [x] **Spécification écrite avant tout code**, `docs/SPEC-workflow-engine.md` §7 : le chapitre
      « Interface » tenait en **cinq lignes** écrites à `CRM-000`, qui posent des règles justes sans
      jamais dire ce que le board **lit**, en combien de requêtes, dans quel ordre les colonnes et
      les cards se rangent, ni ce qu'il faut prouver. Réécrit en quatorze sous-chapitres opposables
      **après mesure de la pile réelle**, avec les cinq règles d'origine **citées mot pour mot**.
      Commit documentaire dédié, poussé avant la première ligne de code (décision 168).
- [x] **Ce qui a été mesuré avant d'être écrit** : le seed en base — sept étapes, dix transitions,
      neuf cards dont une archivée et une en corbeille, `grands-comptes` n'occupant que **deux**
      étapes sur sept —, les quatre lectures du board avec le jeton réel de l'administratrice, les
      **sept** refus de `move_card` un par un avec leur code HTTP et leur `details`, l'absence de
      colonne `position` sur `workflow_transitions`, le `[]` de `profiles` **même à
      l'administratrice**, et le fait que le seed pose `entered_step_at` à `now()`. **État
      historique au jour de CRM-041** : CRM-046 a depuis porté le seed à quatorze cards et CRM-022
      a livré la lecture sûre des identités.
- [x] **Le glisser-déposer natif HTML5 est retenu parce qu'il a été MESURÉ pilotable** par le
      Playwright réellement épinglé — `locator.dragTo()` **et** une séquence
      `mouse.down` / `mouse.move` / `mouse.up`, seule à produire une vidéo exploitable
      (décision 170). Sans cette mesure, la Definition of Done aurait exigé une vidéo d'un geste que
      le harnais ne sait pas jouer.
- [x] **Une contradiction consignée sans être résolue** : **INC-066**, l'éditeur de workflow que le
      §7 prescrit depuis `CRM-000` n'est rattaché à aucune unité du backlog — sept unités ont livré
      sa matière sans une ligne d'interface. La phrase est **conservée mot pour mot** au §7.13,
      explicitement hors du périmètre de cette unité (décision 173).
- [x] **Le board est livré, et il ne porte aucune règle.** La composition — colonnes à partir des
      **étapes**, ordre, cumuls par devise, ancienneté, index des transitions, classification des
      refus — vit dans `webapp/src/lib/board.ts`, vérifiable sans navigateur ; `Board.tsx` rend.
      L'écran est monté sur la route de `CRM-021`, `/tracks/:slugTrack/:slugChannel`, qui affichait
      jusqu'ici l'état vide de sa zone principale.
- [x] **`move_card` est le SEUL chemin d'écriture, et le board est son premier appelant
      d'interface.** La ligne rendue par la garde **remplace** la card — étape, `position` et
      `entered_step_at` viennent du serveur, jamais du client. C'est la raison pour laquelle la
      fonction rend `public.cards` et non `void` (§5.2), écrite à `CRM-034` et employée ici.
- [x] **`workflow_id` rejoint la lecture PARTAGÉE des channels**, et non une seconde lecture des
      mêmes lignes (décision 169) : le channel courant est résolu dans la liste que la coquille a
      déjà chargée, sans aucune requête. Un contrôle du harnais exige qu'il n'existe qu'**un seul**
      `from('channels')` dans `webapp/src`.
- [x] **Test unitaire dédié** : `webapp/src/lib/board.test.ts` (**43 tests** : composition partant
      des étapes, ordre des colonnes et des cards avec départage à position égale, cumul et son
      refus en devises mêlées, ancienneté dans ses quatre cas, index et ordre du menu, résolution
      d'une étape et ses replis, les sept refus, l'optimisme et son retour arrière, les quatre
      lectures **et leurs filtres**) et `webapp/src/app/Board.test.tsx` (**24 tests** sur le
      composant réel). `npm run test:unit` passe de 234 à **308 tests**.
- [x] **Test d'intégration dédié, hors interface** : `e2e/api/board.spec.ts`, **24 scénarios**, avec
      le jeton réel de l'administratrice. Les quatre lectures du §7.2 sont confrontées à la pile
      réelle — sept étapes, jointure embarquée consentie, dix transitions dont quatre à motif, deux
      étapes sans transition sortante, **quatre cards actives sur trois étapes** des sept depuis
      CRM-046. **La preuve
      importe les colonnes du produit** (`webapp/src/lib/colonnes-board.ts`), elle ne les recopie
      pas (décision 177).
- [x] **La contre-épreuve de l'exclusion est mesurée, pas supposée** : sans les filtres
      `archived_at`/`deleted_at`, la même requête rend **six** cards au lieu de quatre. Sans elle,
      un filtre retiré passerait inaperçu — l'écran afficherait simplement deux cards de plus.
- [x] **Preuve de refus reconduite** : l'anonyme obtient `200` et `[]` sur les **quatre** lectures,
      et les quatre tables sont d'abord constatées **non vides** avec le jeton de l'administratrice
      — sans quoi l'assertion serait verte que la RLS refuse ou qu'elle autorise tout (décision 50).
- [x] **L'ABSENCE HISTORIQUE D'IDENTITÉ EST CLOSE.** Au jour de CRM-041, `profiles` rendait `200`
      et `[]` même à l'administratrice (INC-014), donc le board masquait l'UUID. CRM-022 livre
      depuis la relation embarquée consentie : le nom et l'avatar du responsable sont rendus sans
      requête par ligne. Aucune table d'étiquettes n'existe encore ; cette absence distincte reste
      écrite au §7.4.
- [x] **Preuves d'interface** : `e2e/ui/board.spec.ts`, **21 scénarios**, contre le build de
      production. Le premier n'emploie **aucune substitution** — l'anonyme demande réellement le
      track de l'adresse, `slug=eq.conseil-ia` et `archived_at=is.null`, n'obtient rien, et le board
      n'est jamais atteint. Les autres substituent la réponse réseau (`docs/DESIGN_SYSTEM.md`
      §12.5) et le disent.
- [x] **Le glisser-déposer est prouvé dans les DEUX sens** : un dépôt sur une colonne atteignable
      déplace l'affaire et appelle la garde **une fois** ; un dépôt sur une colonne non atteignable
      n'émet **aucun** appel et la colonne **ne se signale jamais** comme zone de dépôt.
- [x] **Le déplacement au clavier est prouvé sans aucune souris**, par le menu que
      `docs/DESIGN_SYSTEM.md` §8 désigne comme le chemin clavier : focus, `Entrée`, focus,
      `Entrée` — la garde est appelée. `Échap` referme le menu et **rend le focus** au bouton.
- [x] **UN HARNAIS COMPLAISANT, TROUVÉ PAR SA PROPRE DÉGRADATION** (décision 174). La preuve du
      dépôt refusé ne constatait que « aucun appel émis », et le composant portait **trois** gardes
      redondantes : la dégradation D7 la laissait verte. Deux mesures ont été nécessaires pour
      rendre le refus **visuel** observable — `dragleave` a un `relatedTarget` **nul** pendant un
      glissement, et un `mouse.move` qui **s'arrête** sur une colonne n'y fait dispatcher **aucun**
      `dragover`. L'écouteur `dragleave` est **retiré** — c'est un clignotement de moins — et la
      preuve tombe désormais sous D7, vérifié dans les deux sens.
- [x] **Vérification visuelle réellement observée** : `docs/captures/CRM-041/`, **onze captures** —
      board anonyme, board chargé, menu ouvert, après dépôt, refus, champs manquants, motif exigé,
      et les **quatre paliers** du §7 — plus la **vidéo `.webm` du glisser-déposer** que la
      Definition of Done exige nommément. Toutes regardées une à une ; la vidéo a été observée
      **image par image**, rendue dans un navigateur faute d'encodeur JPEG dans le `ffmpeg` du
      harnais. Elle montre le liseré en pointillés de la colonne cible pendant le glissement, puis
      la carte en fin de colonne d'arrivée avec compteurs et cumul recalculés.
- [x] **UN DÉFAUT RÉEL, TROUVÉ EN REGARDANT UNE CAPTURE** (décision 175) : le liseré d'un nœud
      `neutral`, écrit en `bg-border`, était **invisible** sur la surface blanche d'une carte.
      Corrigé en `bg-text-3`, le jeton du point neutre d'un badge. Aucun test ne pouvait l'attraper :
      la classe existait et était engendrée.
- [x] **UN SECOND DÉFAUT, DANS UNE FIXTURE D'UNE UNITÉ PRÉCÉDENTE** (décision 178) : les channels
      servis par `e2e/ui/channels.spec.ts` portaient des identifiants qui ne sont pas des UUID. Le
      board les envoie à la vraie API, qui refuse en `400` : l'écran capturé montrait l'état
      d'**erreur**. Les fixtures emploient désormais les identifiants **du seed** — une fixture n'a
      pas le droit de servir une ligne que la base ne pourrait pas produire.
- [x] **Trois règles ajoutées au design system**, §5.2 bis, dans le même changement : le liseré
      neutre, la largeur fixe d'une colonne, et l'absence d'écouteur `dragleave`. La portée du §12.6
      est mise à jour : le board porte bien `.indique-debordement-x`, comme cette entrée l'annonçait.
- [x] **Build vert**, `npm run typecheck` vert sur les quatre projets, `npm run types:check` vert,
      `npm run test:sql` **1164 assertions** inchangées, `npm run e2e:api` **332 scénarios**
      (308 + 24), `npm run e2e:ui` **71 scénarios** (50 + 21), et chaque classe citée par le board
      présente dans le CSS produit.
- [x] Harnais de preuves rejouable `scripts/verify-board.sh` : **56 contrôles, aucune anomalie**, et
      **non complaisant** — huit dégradations volontaires le font réellement échouer : les colonnes
      vides qui disparaissent, le menu qui perd son ordre, deux devises additionnées, un refus
      inconnu absorbé, le retour arrière retiré, une transition à motif rendue optimiste, toute
      colonne devenue cible de dépôt, et les cards rangées revenues sur le board. Sa section 7
      constate que les fichiers sont **rendus intacts** et rejoue les tests après restauration.
- [x] **Deux assertions figées ont échoué comme prévu, et ont été RETOURNÉES** (mécanisme de la
      décision 51, treizième occurrence) : `webapp/src/lib/channels.test.ts` exigeait que
      `workflow_id` **ne soit pas** demandée, et `e2e/ui/channels.spec.ts` attendait « Aucune card
      dans ce channel » à l'ouverture d'un onglet. **Aucune n'a été retirée** : la première exige
      désormais la colonne dans la lecture partagée, la seconde constate le board et son état réel.
- [x] **Compteurs de `scripts/verify-harness.sh` révisés dans le MÊME changement** : 308 → **332**
      scénarios d'API, 50 → **71** d'interface. `ASSERTIONS_ATTENDUES` reste à **1164** : l'unité ne
      livre ni table, ni fonction, ni politique.
- [x] **Aucune régression** : `verify-harness` 25, `verify-webapp` 41, `verify-tracks` 43,
      `verify-channels` 30, `verify-formulaire` 49, `verify-move-card` 56, `verify-valeurs-champs`
      40, `verify-seed` 49, `verify-migrations` 23, `verify-authz` 35, `verify-types` 30,
      `verify-colonnes-protegees` 50, `verify-preuves-refus` 26 — aucune anomalie.
      **`verify-cards` rend 45 contrôles, 2 en échec** : INC-061, **seconde occurrence**, voir les
      limites ci-dessous.
- [x] `docs/SPEC-workflow-engine.md` §7 (quatorze sous-chapitres), `docs/SPEC-channels.md` §5,
      `docs/SPEC-webapp.md` §5.2, `docs/DESIGN_SYSTEM.md` §5.2 bis et §12.6, `docs/DAT.md` §3.1,
      `docs/manual.md` chapitres 4.8, 4.6 et sommaire, `docs/INCONSISTENCY_REPORT.md` (INC-066
      ouverte, INC-061 aggravée), `docs/JOURNAL.md` décisions 168 à 179, `CHANGELOG.md` mis à jour
      dans le même changement.
- [x] **ÉCART AU §7.5 CORRIGÉ APRÈS COUP, ET IL AVAIT ÉCHAPPÉ À TOUTES LES PREUVES** (décision 180).
      Le repli du libellé d'une transition était composé **par concaténation dans le composant** —
      `` `${t('board.transition.fallback')} ${etape.libelle}` `` —, ce que le §7.5 interdit nommément
      au profit d'une clé de traduction **paramétrée** (`CLAUDE.md` §23). MESURÉ, et c'est la raison
      pour laquelle l'écart a survécu : les **dix** transitions du seed portent toutes un libellé, et
      aucun jeu servi n'exerçait cette branche — elle était écrite, jamais exécutée. `t` accepte
      désormais des paramètres, la clé devient « Passer à {etape} », et **deux preuves** ont été
      ajoutées avec un jeu de rechange, l'une unitaire et l'autre d'interface. Les deux vérifient
      aussi que le marqueur ne fuit jamais jusqu'à l'écran. **Contre-épreuve faite** : rétabli le
      code d'origine, le test unitaire échoue. Capture `board-transition-sans-libelle-1440.jpg`,
      observée.
- [x] **Deux exécutions de la routine ont livré cette unité en parallèle** (décision 182). La
      seconde implémentation, complète et indépendante, a été **abandonnée en entier** — conduite
      déjà retenue pour `CRM-014`. Elle a servi de relecture adverse : l'écart au §7.5 ci-dessus et
      l'échappatoire de navigateur ci-dessous sont les deux seules choses qui en ont été conservées.
- [~] **Les preuves d'interface ont exigé un navigateur fourni par l'environnement** (décision 181).
      Playwright 1.62.1 épingle une révision de Chromium que l'image d'exécution ne fournit pas, et
      **tous** les scénarios `ui` du dépôt — pas seulement ceux de cette unité — échouaient au
      lancement. `e2e/playwright.config.ts` accepte désormais `PLAYWRIGHT_CHROMIUM_PATH` ; les
      scénarios ont été rejoués avec le Chromium **révision 1194** de l'image, contre la révision
      1234 attendue. Rien n'a été désactivé ni substitué, mais la preuve n'a pas tourné sur le
      binaire nominal, et cela est écrit plutôt que tu.
- [x] **INC-068 consignée sans être résolue** : les pastilles d'étiquettes que `docs/DESIGN_SYSTEM.md`
      §5.1 prescrit n'ont ni table ni unité. L'unité avait nommé leur absence **sur la carte** ; la
      prescription, elle, restait sans porteur — même motif qu'INC-066.
- [x] **LE PARCOURS COMPLET EST PROUVÉ DEPUIS `CRM-011`.** Une administratrice se connecte par
      l'écran, déplace par le menu une card créée pour la preuve, la voit dans la colonne d'arrivée
      et l'API confirme `current_step_id`. Le `viewer` tente le même geste sur une card qu'il voit :
      le backend refuse, l'interface affiche la raison et la card reste dans sa colonne. Aucune
      réponse réseau n'est substituée et la donnée d'essai est nettoyée.
- [ ] **Le seed ne démontre pas la bascule de la pastille d'ancienneté.** MESURÉ : il pose
      `entered_step_at` à `now()`, contre des seuils de 5 à 30 jours — aucune card n'atteint jamais
      le sien. La règle est prouvée par un test unitaire et par une réponse substituée, jamais par
      une donnée permanente. Un contrôle du harnais **échoue** si cela venait à changer. Le manque
      appartient au seed de démonstration, `CRM-046`.
- [x] **L'éditeur de workflow a désormais un porteur — INC-066 arbitrée.** CRM-076 livrera l'écran
      administrateur complet ; la phrase reste hors du périmètre de CRM-041 sans être orpheline.
- [x] **Le seed a été étendu depuis par CRM-046.** Le board démontre toujours ses colonnes vides,
      l'exclusion des cards rangées et son menu, avec sept étapes, dix transitions dont quatre à
      motif, deux étapes sans sortie et **quatre cards actives sur trois étapes**. Le harnais
      courant fixe ces volumes et sa contre-épreuve.
- [ ] **LE CUMUL DE MONTANT DÉPEND D'UNE DÉCLARATION QUE DEUX FICHIERS CONTREDISENT — INC-067.**
      MESURÉ : PostgREST rend `cards.amount` en **nombre** JSON, le type engendré le déclare ainsi,
      et `e2e/api/cards.spec.ts` — livré par `CRM-040` — le déclare en **chaîne**. Le cumul de
      `webapp/src/lib/board.ts` additionne sans convertir : si la représentation basculait, il
      concaténerait **en silence**. Comportement inchangé, arbitrage demandé.

*DoD satisfaite.* Le déplacement autorisé et le refus sont désormais aussi prouvés avec les sessions
réelles ; le déplacement au clavier, les quatre paliers et la vidéo restent couverts par la suite
dédiée. **Aucun test pgTAP dédié** :
l'unité ne livre ni table, ni fonction, ni politique — la règle qu'elle exerce, `move_card`, est
déjà couverte par la suite de `CRM-034`, et ce que cette unité ajoute est un écran.

*Limites nommées, non masquées.*

- **INC-021 est close** par la reprise de `CRM-011`.
- **INC-066 a un porteur** : l'éditeur complet est dû par CRM-076, pas par ce board.
- **INC-048 est ouverte, et l'écran le DIT** : le motif exigé par une transition valide le
  déplacement puis disparaît, `card_comments` étant `CRM-043`. La saisie l'annonce plutôt que de
  laisser croire à un enregistrement.
- **INC-014 est close par CRM-022** : nom et avatar du responsable sont lisibles par l'équipe et
  rendus sur la carte sans exposer l'identifiant technique.
- **INC-061 est close sous CRM-040** (décisions 296 et 309). Le harnais retire et mesure son jeu
  d'essai **avant** SQL/API/UI ; aucun compte métier n'est relâché. La campagne complète rend
  **46/46**, dont SQL **1698**, API **444** et UI **145** à console stricte.
- **Aucun réordonnancement dans une colonne** : il exige une RPC atomique que
  `docs/SPEC-channels.md` §1.2 annonce déjà comme nécessaire et qu'aucune unité ne porte.
- **Aucune création ni modification d'affaire depuis le board** : `CRM-040` a livré la table et son
  contrat d'API, aucun écran d'édition n'existe.
- **La colonne droite du §5.3 du design system n'est toujours pas livrée** — elle appartient à
  `CRM-043` et `CRM-044`.
- **Sur l'hôte de vérification, la chaîne s'exécute sous Node 22.22.2**, alors que le dépôt exige
  Node 24. Limite héritée, inchangée.
- **Trois contournements hors dépôt ont dû être refaits**, comme les entrées correspondantes le
  prédisaient : démon Docker lancé à la main, `npm ci` précédé d'un `npm config set cafile`
  (INC-032, INC-042), et l'arborescence de compatibilité des navigateurs Playwright — INC-036,
  **neuvième** occurrence. `./runDev.sh` a de nouveau échoué à construire l'image `webapp` : la pile
  a été démarrée sans ce service, sans effet sur les preuves.

### CRM-042 — Vue liste `[~]`
Tri, filtres, densité maîtrisée, pagination.
**DoD** : E2E ; comportement avec données longues vérifié en capture.

- [x] **Spécification écrite avant tout code**, `docs/SPEC-cards.md` §12 : l'unité tenait en **deux
      lignes** au backlog, et quatre documents la nommaient sans la décrire — le §1.2 et le §4 de
      ce même document, le §7.1 de `docs/SPEC-workflow-engine.md`, le §12.6 de
      `docs/DESIGN_SYSTEM.md`. Écrite en **douze sous-chapitres opposables**, après mesure de la
      pile réelle. Commit documentaire dédié, poussé avant la première ligne de code
      (décision 183).
- [x] **Ce qui a été mesuré avant d'être écrit** : le `206` et son `Content-Range: 0-1/3`, le
      **`416`** à un rang près de la fin, le `count=planned` **faux d'un facteur trois**, le
      `Content-Range: */0` de l'anonyme, `nullslast` dans les deux sens, `plfts(french)` sur
      `search_tsv`, le plan du tri par titre — un `Sort` qu'aucun index ne sert —, et surtout la
      **sonde `sonde_l2`** : une marche paginée sur un tri **non total** rend 20 lignes dont
      **17 distinctes**, contre 20 sur 20 lorsque la clé primaire rend l'ordre total.
- [x] **`docs/DESIGN_SYSTEM.md` §5.9 écrit dans le même changement** : le tableau est le **premier
      du produit**, et le §4 l'annonçait — « board kanban […] ou vue liste » — sans lui donner une
      seule règle visuelle. La portée du §12.6 est étendue à la vue liste, comme cette entrée
      l'annonçait elle-même.
- [x] **La vue liste est livrée, et elle ne porte aucune règle.** La clôture des tris, l'ordre
      **total**, le repli des paramètres d'adresse, le bornage du rang de page, le découpage en
      pages et la classification du `416` vivent dans `webapp/src/lib/liste-cards.ts`, vérifiables
      sans navigateur ; `ListeCards.tsx` rend. L'écran est monté sur une route **propre**,
      `/tracks/:slugTrack/:slugChannel/liste`, et une bascule board ↔ liste les relie.
- [x] **Tout est côté serveur** : les deux filtres d'activité, le filtre par étape, la recherche
      plein texte, l'ordre et la plage. Un filtre appliqué après la pagination ne verrait que les
      lignes déjà rapportées — une affaire de la page 3 ne sortirait jamais d'une recherche.
- [x] **L'ordre est TOTAL, et c'est une correction de défaut, pas une précaution** (décision 185).
      MESURÉ sur la sonde `sonde_l2`, 200 000 lignes de clé égale parcourues page par page : un tri
      non total rend **20 lignes dont 17 distinctes** — trois affaires jamais montrées, sans que
      rien ne le signale. Terminé par `id`, il en rend 20 sur 20.
- [x] **Le `416` est classé pour lui-même** (décision 186). MESURÉ : `offset` égal au total rend
      `206` ; le rang suivant rend `416` / `PGRST103`, `count: null` **et** `data: null`. Le
      traiter comme une erreur ordinaire afficherait « Chargement impossible » à qui a seulement
      gardé son onglet ouvert.
- [x] **Le total est exact, jamais estimé** (décision 187). MESURÉ : `count=planned` rend **1** là
      où la table en porte **3** — une pagination bâtie dessus afficherait un nombre de pages qui
      n'existe pas.
- [x] **Aucune persistance côté client n'est introduite** : tri, filtres et rang de page vivent
      dans l'**adresse** (décision 184, `CLAUDE.md` §11). Un contrôle du harnais échoue si un
      `localStorage`, un `sessionStorage` ou un cookie apparaît.
- [x] **La lecture des étapes est celle du board, importée et non réécrite** (décision 188). La
      liste ne lit ni `workflow_transitions` ni `form_fields` : elle n'offre aucun déplacement.
      **Deux** requêtes, pas quatre.
- [x] **Test unitaire dédié** : `webapp/src/lib/liste-cards.test.ts` (**43 tests** : clôture des
      tris et des sens, ordre total dans les huit combinaisons, `nullslast`, repli de chaque
      paramètre d'adresse, aller-retour d'écriture et de relecture, découpage en pages, bornage du
      rang, classification du `416` et des autres refus, et la requête réellement émise) et
      `webapp/src/app/ListeCards.test.tsx` (**40 tests** sur le composant réel). `npm run test:unit`
      passe de 316 à **399 tests**.
- [x] **Test d'intégration dédié, hors interface** : `e2e/api/liste-cards.spec.ts`, **26
      scénarios**, avec le jeton réel de l'administratrice. **La preuve importe les colonnes et le
      pas du produit** (`webapp/src/lib/colonnes-liste.ts`), elle ne les recopie pas.
- [x] **Trois contre-épreuves mesurées, pas supposées** : sans les filtres d'activité, la même
      requête rend **deux lignes de plus** ; sans `nullslast`, l'affaire sans montant remonte **en
      tête** d'un tri descendant ; une colonne inventée est refusée en `400` par la pile — ce que
      la clôture des clés de tri empêche d'atteindre.
- [x] **Preuve de refus reconduite** : l'anonyme obtient `200` et `[]` sur les **deux** lectures,
      un total de **zéro**, et ni le filtre ni la recherche ne lui ouvrent quoi que ce soit. Les
      deux tables sont d'abord constatées **non vides** avec le jeton de l'administratrice — sans
      quoi l'assertion serait verte que la RLS refuse ou qu'elle autorise tout (décision 50).
- [x] **Preuves d'interface** : `e2e/ui/liste-cards.spec.ts`, **27 scénarios**, contre le build de
      production. Le premier n'emploie **aucune substitution** — l'anonyme demande réellement le
      track de l'adresse `/liste`, n'obtient rien, et la liste n'est jamais atteinte. Les autres
      substituent la réponse réseau (`docs/DESIGN_SYSTEM.md` §12.5) et le disent.
- [x] **Le tri est prouvé au clavier, sans aucune souris** : focus sur l'en-tête, `Entrée`,
      l'adresse change et la requête part.
- [x] **UNE ERREUR DE MA PROPRE SPÉCIFICATION, TROUVÉE EN EXÉCUTANT** (décision 189). Le §12.6
      annonçait une plage demandée par un en-tête `Range` — mesure faite à la main, au `curl`.
      MESURÉ : `postgrest-js` émet deux **paramètres de requête**, `offset` et `limit`, et aucun
      en-tête. Le comportement de PostgREST est identique jusqu'au `416` près, mais la preuve
      d'interface cherchait un en-tête qui n'existe pas. Le §12.6 est corrigé dans le même
      changement, et les preuves observent le chemin **que le produit emprunte**.
- [x] **UN DÉFAUT DE FIXTURE, TROUVÉ EN EXÉCUTANT** : servir `Content-Range` ne suffit pas.
      L'API et la page sont sur deux origines, et sans `Access-Control-Expose-Headers` un navigateur
      n'en laisse rien lire — `supabase-js` rendait `count: null`, et l'écran affichait
      « Chargement impossible », ce qui est **le comportement voulu** face à un total manquant. La
      fixture était fautive, pas le produit. Le §12.11 l'écrit.
- [x] **TROIS DÉFAUTS RÉELS, TROUVÉS EN REGARDANT UNE CAPTURE** (décision 190) : l'état vide se
      rendait **au-dessus** de la barre de filtres qui en était la cause, l'action « Effacer les
      filtres » apparaissait **deux fois**, et sous l'ensemble subsistait une **carcasse de
      tableau** — cinq en-têtes sans une seule ligne. Aucune assertion ne pouvait les attraper :
      les trois éléments existaient et étaient rendus correctement. Corrigés, écrits au §12.7 bis,
      et **figés par quatre assertions** du test de composant.
- [x] **Vérification visuelle réellement observée** : `docs/captures/CRM-042/`, **douze captures** —
      liste anonyme, liste chargée, tri par montant, filtre sans résultat, page pleine de 25
      lignes, page inexistante, **données longues** à 1440 et à 390 px, et les **quatre paliers**
      du §7. Toutes regardées une à une ; c'est en regardant la sixième que les trois défauts
      ci-dessus ont été vus.
- [x] **Le comportement avec données longues est prouvé et capturé**, comme la Definition of Done
      l'exige nommément : un titre de 128 caractères tient sur **une ligne**, la valeur entière
      reste portée par l'attribut `title`, la hauteur de ligne ne bouge pas, et la page ne défile
      jamais horizontalement — à 1440 comme à 390 px.
- [x] **Une règle ajoutée au design system**, §5.9 — le **premier tableau du produit** : sémantique
      `table`, ligne à `--size-target` et une seule ligne de texte par cellule, en-tête collant,
      séparateurs sans zébrure, `aria-sort` sur la colonne triée, données techniques à droite,
      cellule sans valeur **vide**, débordement signalé, pagination désactivée mais visible. La
      portée du §12.6 est étendue à la vue liste, comme cette entrée l'annonçait.
- [x] **Build vert**, `npm run typecheck` vert sur les quatre projets, `npm run types:check` vert,
      `npm run test:sql` **1164 assertions** inchangées, `npm run e2e:api` **358 scénarios**
      (332 + 26), `npm run e2e:ui` **99 scénarios** (72 + 27), et chaque classe citée par la liste
      présente dans le CSS produit.
- [x] Harnais de preuves rejouable `scripts/verify-liste.sh` : **70 contrôles, aucune anomalie**, et
      **non complaisant** — **douze** dégradations volontaires le font réellement échouer : l'ordre
      qui cesse d'être total, `nullslast` retiré, un tri inconnu qui part vers l'API, une étape mal
      formée qui part vers l'API, le total redevenu estimé, le `416` absorbé, un total manquant
      devenu zéro, le rang de page non borné, les cards rangées revenues dans la liste, la recherche
      qui quitte `search_tsv`, la carcasse de tableau qui revient, et `aria-sort` qui ment. Sa
      section 7 constate que les fichiers sont **rendus intacts** et rejoue les tests après
      restauration.
- [x] **UN FAUX POSITIF D'UN CONTRÔLE DU DÉPÔT, REPRODUCTIBLE — INC-070.** Le contrôle de textes en
      dur lit la queue d'un `? undefined : (` comme un nœud de texte et **a réellement échoué**.
      L'affectation est réécrite en `if` — la forme la plus lisible des deux —, et la limite de
      l'outil est consignée **sans que le contrôle soit affaibli** : élargir son expression
      régulière sans mesurer ce qu'elle cesserait d'attraper serait affaiblir une garde pour
      accommoder une écriture.
- [x] **Compteurs de `scripts/verify-harness.sh` révisés dans le MÊME changement** : 332 → **358**
      scénarios d'API, 72 → **99** d'interface. `ASSERTIONS_ATTENDUES` reste à **1164** : l'unité
      ne livre ni table, ni fonction, ni politique.
- [x] **Aucune régression sur les douze harnais rejoués** — dont **les huit qui touchent
      l'interface**, c'est-à-dire tous ceux qu'un changement d'écran peut atteindre :
      `verify-harness` 25, `verify-webapp` 41, `verify-tracks` 43, `verify-channels` 30,
      `verify-formulaire` 49, `verify-move-card` 56, `verify-valeurs-champs` 40, `verify-board` 56,
      `verify-seed` 49, `verify-migrations` 23, `verify-authz` 35, `verify-types` 30 — **aucune
      anomalie**. `verify-board` en particulier reste vert alors que l'écran du board a changé : la
      bascule board ↔ liste s'est ajoutée au-dessus de lui, et ses onze captures ont été
      **renouvelées** en conséquence, comme `CLAUDE.md` §16 l'exige.
- [x] `docs/SPEC-cards.md` §12 (douze sous-chapitres) et §12.7 bis, `docs/DESIGN_SYSTEM.md` §5.9 et
      §12.6, `docs/DAT.md` §3.1, `README.md` §10, `docs/manual.md` chapitres 3.2, 4.6, 4.9 et
      sommaire, `docs/INCONSISTENCY_REPORT.md` (INC-069 et INC-070 ouvertes),
      `docs/JOURNAL.md` décisions 183 à 190, `CHANGELOG.md` mis à jour dans le même changement.
- [ ] **LE PARCOURS COMPLET N'EST PAS PROUVÉ, ET IL NE PEUT PAS L'ÊTRE — INC-021.** La Definition of
      Done exige un E2E. Le tri, les filtres et la pagination sont prouvés **contre des réponses
      substituées**, et les requêtes qu'ils émettent sont prouvées hors interface avec le jeton réel
      de l'administratrice (`e2e/api/liste-cards.spec.ts`). Ce qui manque est le **chaînage** des
      deux : un utilisateur connecté triant réellement une liste depuis l'écran. Il suppose une
      session, et **aucune unité du backlog ne porte l'écran de connexion**. **Cette preuve est
      bloquée par un arbitrage, pas par un défaut de l'unité.** Treizième unité consécutive.
- [ ] **Le seed ne démontre ni les données longues, ni la seconde page.** MESURÉ : le titre le plus
      long fait **34 caractères**, et aucun channel ne porte plus de **trois** cards actives. Les
      deux sont donc prouvés contre des réponses substituées, et la pagination l'est en outre par
      la mesure directe de l'`offset` sur la pile réelle. Deux contrôles du harnais **échouent** si
      cela venait à changer. Le manque appartient au seed de démonstration, `CRM-046`.
- [ ] **Le seed n'a pas été étendu, et le choix est documenté.** L'unité n'introduit ni table, ni
      colonne, ni statut, ni flux : elle lit ce que `CRM-040` a livré. Six contrôles du harnais
      échouent si les données qu'elle démontre cessent d'être là.
- [x] **LES NEUF HARNAIS EN ATTENTE ONT ÉTÉ REJOUÉS, ET HUIT SONT VERTS** (décision 191). Le
      balayage promis par l'entrée précédente a été mené en **mode complet**, séquentiellement,
      contre la pile réellement démarrée et le seed réellement appliqué :
      `verify-catalogue` **39**, `verify-workflows` **49**, `verify-copie-workflow` **34**,
      `verify-coherence-workflow` **33**, `verify-champs-formulaire` **38**, `verify-droits-fins`
      **42**, `verify-colonnes-protegees` **50**, `verify-preuves-refus` **26** — **aucune
      anomalie**. Trois de ces comptes dépassent celui qu'avait consigné leur propre unité — 36, 47
      et 33 — parce que les harnais concernés ont reçu des contrôles supplémentaires depuis, livrés
      par les unités suivantes ; `git log` sur chacun des trois fichiers le montre. Le raisonnement
      que l'entrée précédente donnait pour ce qu'il était — « l'unité ne livre aucun SQL » — est
      désormais **une mesure**.
- [x] **LE NEUVIÈME ÉCHOUAIT DÉJÀ : INC-061, TROISIÈME OCCURRENCE, CLOSE DEPUIS**
      (décision 191). `scripts/verify-cards.sh` rend **45 contrôles, 2 en échec** — `npm run
      test:sql` et `npm run e2e:api` —, de façon reproductible et pour une cause déjà consignée :
      sa **section 10** rejoue les suites globales **avant** que son `trap … EXIT` ne retire ses
      cinq cards de preuve. Contre-épreuve **mesurée** : la base porte **9** cards en sortant du
      harnais, aucune ne portant le préfixe du jeu d'essai ; `npm run test:sql` rejoué juste après
      rend **1164 assertions, aucune anomalie**, et `npm run e2e:api` **358 scénarios, aucune
      anomalie**. Ni le produit ni les preuves de `CRM-042` ne sont en cause. **Le harnais n'est pas
      corrigé ici** : il est un livrable de `CRM-040`, l'arbitrage est ouvert depuis deux
      occurrences, et le reprendre sous une unité qui ne le porte pas reviendrait à toucher les 45
      contrôles d'une autre unité sans les rejouer sous la sienne (`CLAUDE.md` §13).
      **Résolu le 2026-08-09 sous CRM-040** : le ménage précède et conditionne désormais les suites ;
      le harnais complet rend **46/46**, SQL **1698** et API **444** inclus.
- [x] **CE QUE LA TROISIÈME OCCURRENCE A APPRIS EST DEVENUE UNE GARDE TRANSVERSE.** La cause
      a été isolée **sans exécuter le harnais**, en recréant ses cinq cards par le **vrai chemin
      applicatif** — `POST /rest/v1/cards` avec le jeton réel de l'administratrice, cinq `201` — puis
      en mesurant les suites, puis en les retirant. MESURÉ, base à **14** cards : trois assertions de
      `supabase/tests/0015_colonnes_protegees.test.sql` tombent (`not ok 33, 34, 35`) et **onze**
      scénarios d'API échouent, contre deux à la première occurrence et trois à la deuxième. Sept
      d'entre eux appartiennent à `e2e/api/liste-cards.spec.ts`, **la preuve d'intégration dédiée de
      cette unité** : les deux lectures, les deux filtres d'activité, la contre-épreuve des deux
      lignes de plus, et les cinq scénarios de pagination et du `416`. INC-061 avait prédit que le
      défaut frapperait « toute preuve future qui comptera des cards » ; il frappe désormais la plus
      récente. **Aucune assertion n'est relâchée pour l'accommoder** : compter les cards du seed est
      précisément ce qui rend la pagination vérifiable. La décision 296 impose désormais le ménage
      avant mesure et `docs/SPEC-test-harness.md` §3.5 le rend opposable.
- [ ] **Aucune vue sauvegardée, aucun réglage de densité, aucune recherche globale.** Les trois sont
      hors périmètre et nommés au §12.10 : `CRM-071` porte la première, les deux autres ne sont
      portées par personne.
- [ ] **INC-069 est ouverte** : deux décisions du journal portent le numéro 180, deux exécutions
      concurrentes de la routine les ayant écrites en parallèle. `CRM-042` a décalé les siennes à
      183–188 pour ne pas aggraver la collision, sans la résoudre. **Arbitrage attendu.**
- [ ] **INC-070 est ouverte** : le contrôle de textes en dur repose sur une expression régulière là
      où il faudrait un analyseur de JSX. **Arbitrage attendu.**
- [ ] **INC-067 reçoit une quatrième mesure, et n'est pas tranchée.** `typeof amount === 'number'`
      sur la pile réelle, figé par un scénario de `e2e/api/liste-cards.spec.ts`. La vue liste
      **n'additionne aucun montant** — elle n'a pas de cumul de colonne —, elle n'est donc pas
      exposée au défaut que le board porte. Comportement inchangé, arbitrage toujours demandé.

*DoD adaptée, écarts explicites.* La Definition of Done demandait « E2E ; comportement avec données
longues vérifié en capture ». **Le second est livré** — deux captures, à 1440 et à 390 px, sur un
titre de 128 caractères et une prochaine action de 134. Le premier l'est **contre des réponses
substituées**, et la limite est nommée ci-dessus plutôt que maquillée. **Aucun test pgTAP dédié** :
l'unité ne livre ni table, ni fonction, ni politique — ce qu'elle lit est déjà couvert par la suite
de `CRM-040`, et ce qu'elle ajoute est un écran.

*Limites nommées, non masquées.*

- **INC-021 est ouverte** et conditionne le passage en `[x]` (voir ci-dessus).
- **INC-014 est ouverte** : le nom du responsable n'est lisible par personne, et la colonne
  « Responsable » n'est donc **pas rendue du tout**, plutôt que rendue vide.
- **INC-069 et INC-070 sont ouvertes**, relevées par cette unité.
- **Aucun écran de création, d'édition, d'archivage ou de mise en corbeille** : la liste **lit**, et
  cinq contrôles du harnais échouent si un chemin d'écriture y apparaît.
- **Sur l'hôte de vérification, la chaîne s'exécute sous Node 22.22.2**, alors que le dépôt exige
  Node 24. Limite héritée, inchangée.
- **Trois contournements hors dépôt ont dû être refaits**, comme les entrées correspondantes le
  prédisaient : démon Docker lancé à la main, `npm ci` précédé d'un `npm config set cafile`
  (INC-032, INC-042), et `PLAYWRIGHT_CHROMIUM_PATH` renseigné vers le navigateur préinstallé de
  l'image — INC-036, **dixième** occurrence, désormais absorbée par l'échappatoire que `CRM-041` a
  livrée (décision 181). `./runDev.sh` a de nouveau échoué à construire l'image `webapp` : la pile
  a été démarrée sans ce service, sans effet sur les preuves.
- **Le rejeu des neuf harnais a reproduit les trois contournements à l'identique** : démon Docker
  lancé à la main, `npm ci` précédé d'un `npm config set cafile` (INC-032, INC-042), et
  `PLAYWRIGHT_CHROMIUM_PATH` renseigné vers le navigateur préinstallé — INC-036, **onzième**
  occurrence. `./runDev.sh --dev` a échoué **avant tout démarrage** en construisant l'image `webapp`
  malgré `--scale webapp=0` : la pile a été démarrée par `docker compose up` en énumérant les treize
  autres services. Aucune preuve n'en dépend, et aucun script du dépôt n'a été modifié pour
  l'occasion.
- **Quatorze captures ont été réécrites par le rejeu, puis restaurées**, comme aux exécutions
  précédentes : elles appartiennent à `CRM-007`, `CRM-021`, `CRM-041` et `CRM-042`, et le rejeu ne
  change que leur encodage. **Trois ont été regardées** avant restauration —
  `CRM-042/liste-filtre-sans-resultat-1440.jpg` (l'état vide est bien **sous** la barre de filtres,
  l'action n'apparaît qu'**une fois**, aucune carcasse de tableau : les trois corrections de la
  décision 190 tiennent), `CRM-041/board-apres-depot-1440.jpg` (la bascule *Tableau / Liste*, trois
  cards et un cumul de **188 500 €** qui est bien la somme arithmétique de 48 000, 125 000 et
  15 500 — quatrième constat cohérent avec INC-067) et `CRM-021/channel-ouvert-1440.jpg`. **Les dix
  autres captures et la vidéo `glisser-deposer.webm` n'ont pas été regardées** lors de ce rejeu :
  elles ont été restaurées telles quelles, et aucune affirmation nouvelle ne repose sur elles.

### CRM-043 — Commentaires `[x]`
> **Repris par `CRM-044`** : le panneau que cette unité a livré est devenu le **fil unifié**, comme
> le §5.10 du design system l'annonçait. `PanneauCommentaires.tsx` est renommé `PanneauTimeline.tsx`,
> ses seize tests de composant sont conservés, et deux scénarios d'interface de `CRM-043` sont
> ajustés — le libellé de la région et le texte de l'état vide. Aucune règle de cette unité ne
> change ; ses captures sont **renouvelées** (`CLAUDE.md` §16).
Rédaction par tout membre pouvant **écrire** sur le channel de la card, édition par l'auteur,
suppression par l'auteur et par les `admin` du workspace, auditée.
**DoD** : API (refus pour un `viewer`) ; E2E ; temps réel constaté.

> **Énoncé corrigé le 2026-08-14 — INC-071 et INC-072 closes.** Il portait « rédaction libre par
> tout membre pouvant **lire** la card, édition et suppression par l'auteur ». Les deux moitiés
> étaient fausses, et différemment. La première **se contredisait elle-même** : un `viewer` peut
> lire une card, et la Definition of Done ci-dessus exige la preuve de son **refus** — deux sources
> sur trois disaient déjà « écriture », et c'est le comportement livré depuis la migration 15
> (INC-071). La seconde était l'**intersection** que `CRM-043` avait livrée faute d'arbitrage, avec
> sa conséquence nommée : aucun modérateur ne pouvait retirer un propos déplacé (INC-072).
> L'arbitrage est rendu par la décision 367 (lot G) et mis en œuvre par la décision 374. Corriger
> cet énoncé **ne change aucun code pour INC-071** ; INC-072 apporte une politique et une colonne
> d'audit, livrées par la migration 35.

- [x] **Spécification écrite avant toute ligne de code**, `docs/SPEC-cards.md` §13 : l'unité tenait
      en **deux lignes** au backlog, et trois documents la nommaient sans la décrire — le §5 de
      `docs/SCHEMA.md` pour son modèle, le §4 de `docs/SPEC-permissions-rls.md` pour ses politiques,
      le §5.3 de `docs/DESIGN_SYSTEM.md` pour la colonne d'écran qui l'accueille. **Les trois ne
      disaient pas la même chose.** Écrite en quatorze sous-chapitres opposables, après mesure sur
      la pile réelle. Commit documentaire dédié, poussé avant la première ligne de code.
- [x] **Ce qui a été mesuré avant d'être écrit** : l'absence d'unicité `(id, workspace_id)` sur
      `cards` — `there is no unique constraint matching given keys` —, `auth.uid()` acceptée comme
      **défaut de colonne**, un trigger qui écrit une colonne dont le privilège d'écriture est
      **refusé au client**, et surtout le **temps réel** : `pg_publication_tables` compte **zéro**
      table publiée, le canal `postgres_changes` répond `SUBSCRIBED` à travers Kong, l'abonnement
      s'inscrit dans `realtime.subscription` le temps du canal, et l'événement arrive dans les
      quatre délais mesurés — mais **pas** à la toute première sonde, ce qui n'a pas été reproduit
      et fonde la règle « recharger à l'abonnement » (décisions 192 à 197).
- [x] **DEUX CONTRADICTIONS RELEVÉES, NON RÉSOLUES IMPLICITEMENT.** **INC-071** : `docs/SCHEMA.md`
      §5 ouvre le commentaire à qui peut **lire** la card, quand `docs/SPEC-permissions-rls.md` §4
      et la Definition of Done de cette unité exigent le droit d'**écriture** — la DoD réclamant
      nommément la preuve du refus opposé à un `viewer`, que la lecture littérale rendrait
      impossible. Comportement retenu : le droit d'écriture ; la phrase minoritaire de `SCHEMA` est
      corrigée, l'**énoncé** du backlog est laissé intact et l'arbitrage demandé. **INC-072** : le
      §4 ouvre la modération aux `admin`, l'énoncé ne l'ouvre qu'à l'auteur ; l'**intersection** est
      livrée, et l'absence de modérateur est nommée.
- [x] **LOT G — LA MODÉRATION EST LIVRÉE, SERVEUR PUIS ÉCRAN, ET INC-072 EST CLOSE.** INC-072
      (décisions 367 et 374, migration `0035`). Politique `card_comments_moderation` : un `admin`
      du workspace supprime un commentaire qu'il peut **lire** — `app.can_read_card` et non
      `app.can_write_card`, modérer ne dépendant pas d'un droit métier. La borne « supprimer sans
      modifier » est portée par le **trigger** et non par la politique, qui n'a pas d'`OLD` ; toute
      autre écriture d'un tiers rend `comment_moderation_limitee`. L'audit est la colonne
      `deleted_by`, écrite par le trigger et fermée au client. **Prouvé** :
      `0017_commentaires.test.sql` — le modérateur supprime, le même ne modifie pas, le corps est
      intact après le refus, la pierre tombale reste définitive pour lui aussi, un
      `business_developer` n'obtient rien **et pas davantage une erreur**, l'auteur est tracé lui
      aussi, `deleted_by` n'est écrite par aucun client ; inventaire des politiques porté de 64 à
      65 dans `0016_preuves_refus.test.sql`. **CE QUI MANQUE, ET C'EST POURQUOI CETTE LIGNE EST
      `[~]`** : le produit n'offre **aucun geste** de modération. `PanneauTimeline.tsx` calcule
      `actionsOffertes = estAuteur && !supprime`, et la webapp n'a **aucune notion du rôle de
      workspace** de l'utilisateur courant. C'est la forme d'INC-085 — un droit qui n'a pas de
      chemin n'est pas un droit. Reste à livrer : le rôle courant côté client, l'action
      *Supprimer* — et **jamais** *Modifier* — sur le commentaire d'un tiers, ses tests de
      composant, un scénario `e2e/ui`, la vérification visuelle, et **le seed** : `…0d4` porte
      « Note interne publiée par erreur sur la mauvaise affaire », le cas de modération idéal, mais
      le seed le supprime par la clé de service — `deleted_by` reste donc nul, ce qui est juste et
      ne démontre rien.
- [x] **Conception du geste de modération écrite et COMMITTÉE AVANT le code**, décision 376
      (`CLAUDE.md` §5, `docs/CloudWorker.md` §3.1) : `docs/SPEC-cards.md` §13.10 à §13.14,
      `docs/DESIGN_SYSTEM.md` §5.10, `docs/SPEC-seed.md` §2.14, `docs/manual.md` §4.10. Cinq points
      tranchés — le rôle courant lu dans `workspace_members` filtré sur `(workspace_id, user_id)` et
      **jamais** traité comme une autorisation ; l'action **unique** *Supprimer* sur le commentaire
      d'un tiers ; une confirmation propre nommant la trace nominative ; la pierre tombale qui
      distingue « retiré par la modération » de « supprimé » en lisant `deleted_by`, sans quoi la
      colonne d'audit ne serait lue par personne ; le seed qui retire `…0d4` avec le jeton réel de
      l'administratrice. La règle a été **mesurée avant d'être décrite**, jetons réels à l'appui :
      falsification refusée par `comment_moderation_limitee`, retrait accepté avec
      `deleted_by` ≠ `author_id`, non-administrateur rendu à `200` et **zéro ligne**.
- [x] **LE GESTE EST LIVRÉ ET PROUVÉ le 2026-08-14 — INC-072 CLOSE**, décision 376. Tout ce que la
      ligne ci-dessus nommait comme manquant existe.
      **Le rôle courant** est lu par `webapp/src/lib/roles.ts` dans `workspace_members`, filtré sur
      `(workspace_id, user_id)` — MESURÉ : un anonyme reçoit `200` et `[]`, jamais un `401`, et
      aucune requête n'est émise sans identifiant d'utilisateur. Le module **n'autorise rien** : la
      politique `card_comments_moderation` tient la règle, un rôle inconnu de la contrainte devient
      `null`, et le doute — chargement, erreur — ne vaut jamais permission (`CLAUDE.md` §10).
      **UNE seule action** sur le commentaire d'un tiers, *Supprimer* ; *Modifier* n'est pas rendu,
      pas même désactivé — un contrôle grisé annonce un droit temporairement indisponible, quand
      celui-là ne le sera jamais. **Sa confirmation est distincte** de celle de l'auteur et nomme la
      trace nominative. **La pierre tombale distingue** « retiré par la modération » de
      « supprimé », en comparant `deleted_by` à `author_id` : une colonne d'audit que rien ne lit
      n'audite rien. Le **nom** du modérateur reste hors de l'écran (§13.13, point 7).
      **Deux défauts réels, trouvés en exécutant les preuves et non à la lecture.** Écrit
      `!== null`, le prédicat lisait une colonne ABSENTE comme un retrait par un tiers : une pierre
      tombale ordinaire s'annonçait « retirée par la modération » sur une réponse substituée.
      Corrigé, figé par un test, la substitution rendue fidèle. Et `comment_moderation_limitee`
      était rendu comme `comment_deleted` : deux `P0001` disaient deux choses opposées, et un
      modérateur bloqué lisait que le commentaire était supprimé alors qu'il était vivant.
      **Le seed retire `…0d4` avec le jeton RÉEL de l'administratrice** — `api_admin` remonte
      au-dessus de la section 8 quinquies —, et deux assertions pgTAP l'exigent : `deleted_by` porte
      Camille Aubert, et diffère d'`author_id`.
      **Trois gardes figées de `scripts/verify-commentaires.sh` ont joué et sont RÉVISÉES, non
      retirées** (mécanisme de la décision 51) : l'inventaire des politiques passe à quatre — le lot
      G avait ajouté `card_comments_moderation` sans rejouer ce harnais, **resté rouge depuis** —,
      le compte d'assertions de 84 à 98, et la restauration rejoue enfin la migration `0035`, sans
      laquelle elle réinstallait une version antérieure du trigger.
      **Preuves** : `test:unit` **770**, `test:sql` 33 fichiers / **1971** assertions, `e2e:api`
      **507**, `e2e:ui` **185** — dont 3 scénarios de modération **sans aucune substitution** —,
      `e2e:mail` **42**, `pytest` **242**, `typecheck`, `build`, `types:check`,
      `scripts/verify-commentaires.sh` **78 contrôles**, `scripts/verify-manual.sh` **107**,
      `scripts/verify-types.sh` **30**. **QUATRE captures observées** :
      `moderation-actions-1440`, `moderation-confirmation-1440`, `moderation-pierre-tombale-1440`,
      `moderation-seed-1440`.
- [x] **LA RÈGLE CENTRALE ÉTAIT ÉPROUVÉE ET OBSERVÉE NULLE PART** (décision 379, `CLAUDE.md` §16).
      *Une seule action sur le commentaire d'un tiers* est tenue depuis la livraison par deux
      assertions — `actions-moderation` à **1**, `Modifier` à **0** — mais **aucune capture ne la
      montrait** : `moderation-confirmation-1440` est prise **après** le clic, au moment où la
      confirmation a déjà pris la place du corps (§5.10). Le dossier de captures était fourni, la
      preuve verte, et la forme la plus visible de l'unité la seule que personne n'avait regardée.
      `moderation-actions-1440.jpg` la fixe, prise **avant** le clic, et entre à l'inventaire du
      harnais. **Et la capture a dénoncé deux défauts qu'elle seule pouvait voir** — septième
      occurrence du mécanisme de la décision 202 : rendue sans survol, elle montrait une rangée
      **vide**, les actions étant `opacity-0` jusqu'à `group-hover` ou `group-focus-within` ; rendue
      après survol mais sans attendre le fondu, elle montrait un « Supprimer » **à demi
      transparent**, `toBeVisible()` acceptant un élément `opacity-0` qui occupe une surface. Le
      scénario attend désormais l'opacité **calculée** à `1` — une observation, non une
      temporisation (`CLAUDE.md` §18). **Preuves rejouées** : `commentaires-gestes.spec.ts` **8
      scénarios**, `e2e:ui` **185**, `scripts/verify-commentaires.sh` **79 contrôles**, `typecheck`,
      `build`.
- [x] **INC-071 est CLOSE le 2026-08-14**, par l'arbitrage de la décision 367
      (lot G) et la mise en œuvre de la décision 374. **INC-071** : l'énoncé ci-dessus est aligné
      sur le comportement livré — aucun code ne change, et la preuve du refus opposé au `viewer`
      existait déjà. **INC-072** : la suppression s'ouvre aux `admin` du workspace, la modification
      leur reste fermée, et la pierre tombale dit désormais qui l'a posée (`deleted_by`). La borne
      « supprimer sans modifier » est tenue par le **trigger** et non par la politique, qui n'a pas
      d'`OLD` — migration `0035`, `docs/SPEC-cards.md` §13.6. **INC-072 reste ouverte** faute du
      geste d'interface — écart comblé le même jour par la décision 376, et **INC-072 est close**.
- [x] `docs/DESIGN_SYSTEM.md` §5.10 écrit dans le même changement : le panneau de commentaires est
      le **premier fil de discussion du produit**, et le §5.3 l'annonçait sans lui donner une seule
      règle visuelle. Ordre chronologique **croissant** — écrit explicitement pour que `CRM-044` ne
      l'inverse pas par habitude —, pierre tombale qui tient sa place, refus rendu **sans perdre le
      texte saisi**, et **aucun nom d'auteur** : INC-014 rend `profiles` illisible, et la règle du
      §12.5 s'applique comme pour la colonne « Responsable » de la vue liste.
- [x] `docs/SPEC-seed.md` §2.14 : cinq commentaires sur trois cards, par les trois comptes, dont un
      **modifié** et un **supprimé**. La convergence de cette section ne s'écrit **pas** comme les
      autres — `ignore-duplicates` et deux mises à jour conditionnées par une relecture — parce que
      le trigger refuse toute écriture sur une ligne supprimée, et parce qu'un commentaire est une
      parole et non un paramètre.
- [x] **La table est livrée, et elle ne porte aucune règle dans l'interface.**
      `supabase/migrations/0015_commentaires.sql` : `public.card_comments`, l'unicité
      `(id, workspace_id)` que `cards` devait offrir, la clé étrangère composite, deux triggers,
      un `CHECK` **conditionnel**, un index, trois politiques, les privilèges de colonne, et
      l'ajout à la publication `supabase_realtime`. **Rejouée deux fois sans erreur** :
      idempotente et convergente au sens d'INC-035.
- [x] **La pierre tombale est une propriété de la BASE, pas une politesse du code** (décision 193).
      Un commentaire supprimé ne porte plus aucun contenu : le `CHECK` exige `body = ''` dès que
      `deleted_at` est renseignée. MESURÉ par la preuve d'API : la date envoyée — `2001` — est
      ignorée au profit de `now()`, le corps revient **vide**, et toute écriture ultérieure rend
      `comment_deleted`. La ligne survit pour que la suppression **se propage au temps réel**, qui
      n'émet que ce que l'abonné peut lire.
- [x] **LE REFUS OPPOSÉ AU `viewer` EST PROUVÉ, HORS INTERFACE, AVEC SON JETON RÉEL** — la preuve
      que la Definition of Done exige nommément. `403`, `42501`, sur une card qu'il **voit**, la
      lisibilité étant d'abord constatée dans le même scénario : sans elle, le refus prouverait
      qu'il ne voit pas la card, non que commenter exige le droit d'**écriture** (INC-071).
- [x] **Trois autres refus mesurés** : signer du nom d'autrui (`403`), écrire sans jeton (`401`),
      supprimer physiquement (`403` — **aucun privilège**, et aucune politique derrière). Et un
      **non-refus** qui compte autant : un tiers qui a pourtant le droit d'écrire obtient `200` et
      un corps **vide** en tentant de modifier le commentaire d'un autre — le `USING` filtre, aucune
      erreur n'est levée, et la preuve **relit** la ligne pour constater qu'elle est intacte.
- [x] **Suite pgTAP dédiée** : `supabase/tests/0017_commentaires.test.sql`, **84 assertions**.
      `npm run test:sql` passe de 1164 à **1250**.
- [x] **Preuve d'API dédiée** : `e2e/api/commentaires.spec.ts`, **17 scénarios** avec les jetons
      réels des trois comptes. `npm run e2e:api` passe de 358 à **375**.
- [x] **LE TEMPS RÉEL EST CONSTATÉ, ET IL EST AUSSI UNE SURFACE D'AUTORISATION** (décision 195).
      `card_comments` est la **première table du produit publiée** : MESURÉ avant l'unité,
      `pg_publication_tables` en comptait **zéro**, alors que le §4 de `docs/DAT.md` annonçait des
      abonnements depuis le socle documentaire. La preuve exerce le **témoin** — l'administratrice
      reçoit l'événement — et le **silence** — le `viewer` fermé sur le track ne reçoit rien. Sans
      le témoin, le silence prouverait aussi bien la RLS qu'un temps réel en panne.
- [x] **L'établissement du canal est OBSERVÉ, jamais temporisé.** La preuve n'attend pas une durée :
      elle attend un **fait** — que le canal se soit montré vivant en rapportant un premier
      événement —, puis vide ce qu'elle a reçu et mesure le produit. Une temporisation arbitraire
      serait la « temporisation » que `CLAUDE.md` §18 range parmi les façons de masquer une erreur.
- [x] **Seed étendu** : cinq commentaires sur trois cards, par les trois comptes, dont un
      **modifié** et un **supprimé au corps vide**. Les deux états sont posés par le **produit** —
      un second `PATCH` traversant les vrais triggers —, jamais fabriqués. La convergence de cette
      section ne s'écrit **pas** comme les autres (`ignore-duplicates` et deux mises à jour
      conditionnées par une relecture) : le trigger refuse toute écriture sur une ligne supprimée,
      et un commentaire est une parole, non un paramètre. Le rejeu est **vérifié**.
- [x] **QUATRE GARDE-FOUS ANTÉRIEURS ONT DÉNONCÉ LA NAISSANCE DE LA TABLE** (décision 198) — le
      mécanisme de la décision 51, **dixième** occurrence. Cinq assertions constataient l'absence de
      `card_comments` ; elles sont **révisées, non retirées**, et mesurent désormais ce qui compte
      encore : que `move_card` n'écrive toujours pas le motif qu'elle exige. Le compte de politiques
      de `CRM-014` passe de 41 à **44**.
- [x] **INC-048 change de nature : la cause bloquante est LEVÉE, la perte SUBSISTE.** L'argument qui
      fondait l'acceptation temporaire — « aucune table n'est créée par anticipation » — n'a plus
      d'objet. `move_card` n'est **pas** redéfinie ici : elle appartient à `CRM-034`, et la
      reprendre sous une unité qui ne la porte pas toucherait ses six vérifications sans les
      rejouer. L'arbitrage est désormais **exigible**, et son périmètre est plus étroit.
- [x] **DEUX DÉFAUTS DE MES PROPRES PREUVES, TROUVÉS EN EXÉCUTANT.** `?id=like.f00d*` rend **404** —
      PostgREST ne sait pas appliquer `like` à une colonne `uuid` — et le nettoyage a laissé **six
      lignes d'essai** en base sans rien signaler (décision 199, INC-061 en sens inverse). Les
      identifiants sont désormais **énumérés**, et le nettoyage est **constaté** par une relecture,
      deux fois : dans le fichier de preuve, puis dans le harnais.
- [x] **UNE LIMITE DE L'OUTILLAGE, MESURÉE ET NON CONTOURNÉE** (décision 200) : le générateur de
      types déclare `workspace_id` obligatoire à l'insertion, alors que la pile l'accepte omise —
      il ne voit pas le trigger qui la dérive. Aucune assertion de type ne fait taire le
      compilateur : l'interface enverra la valeur qu'elle lit sur la card, et la base la remplacera.
      La preuve d'API le mesure en envoyant un workspace **inventé**.
- [x] Harnais de preuves rejouable `scripts/verify-commentaires.sh` : **38 contrôles, aucune
      anomalie**, et **non complaisant** — **six** dégradations volontaires le font réellement
      échouer : le privilège `DELETE` rendu, `edited_at` rouverte au client, la table retirée de la
      publication, la politique d'insertion ramenée au droit de **lecture** (INC-071 rouverte en
      silence), la clause d'auteur retirée de la mise à jour, le trigger de mise à jour supprimé.
      La restauration est **constatée** : migration rejouée, fichiers rendus intacts, suite verte.
- [x] **Compteurs de `scripts/verify-harness.sh` révisés dans le MÊME changement** : 1164 → **1250**
      assertions — la première révision depuis `CRM-036`, l'unité livrant enfin une table — et
      358 → **375** scénarios d'API. `SCENARIOS_UI` inchangé, l'écran n'étant pas livré.
- [x] `docs/SPEC-cards.md` §13 (quatorze sous-chapitres), `docs/SCHEMA.md` §5,
      `docs/DESIGN_SYSTEM.md` §5.10, `docs/SPEC-seed.md` §2.14, `docs/DAT.md` §4 et §7,
      `docs/PROD_MIGRATIONS.md` §3 (migration 15 et son contrat d'exploitation),
      `docs/INCONSISTENCY_REPORT.md` (INC-071 et INC-072 ouvertes, INC-048 et INC-034 enrichies),
      `docs/JOURNAL.md` décisions 192 à 200, `CHANGELOG.md` mis à jour dans le même changement.
- [x] **LE PANNEAU DE COMMENTAIRES EST LIVRÉ**, et il ne porte aucune règle. L'ordre du fil, la
      classification des refus et la règle d'abonnement vivent dans `webapp/src/lib/commentaires.ts`,
      vérifiables sans navigateur ; `PanneauCommentaires.tsx` rend. Il occupe la **colonne de
      droite** du détail de card, que `CRM-037` avait laissée vide en nommant l'écart, et passe
      **sous** le formulaire en dessous de 1024 px.
- [x] **Le composeur est TOUJOURS rendu, et le refus vient du backend.** L'interface ne calcule
      aucun droit d'écriture : elle envoie, et traduit le `403`. Masquer le bouton pour un `viewer`
      serait une aide d'interface prise pour une autorisation (`CLAUDE.md` §10) — et supposerait de
      calculer côté client une règle que seule la base connaît. **Le texte saisi est conservé** en
      cas de refus : le vider ferait perdre un texte pour une erreur qui n'est pas celle de qui
      l'a écrit.
- [x] **Le flux DÉCLENCHE la lecture, il ne la remplace pas** (décision 201). Un événement dit que
      le fil a changé, non ce qu'il est devenu : le panneau relit. L'ordre reste celui du serveur,
      un événement perdu ne laisse aucun écart, et la lecture applique la RLS **courante**. Le coût
      — une requête par événement — est nommé, et borné par l'absence de pagination.
- [x] **Test unitaire dédié** : `webapp/src/lib/commentaires.test.ts` (**17 tests** : ordre
      chronologique, ordre **total** à date égale, place tenue par la pierre tombale, requête
      réellement émise, charge d'insertion sans `author_id`, quatre classifications de refus) et
      `webapp/src/app/PanneauCommentaires.test.tsx` (**16 tests** sur le composant réel, dont la
      lecture déclenchée par l'abonnement et la relecture sur événement). `npm run test:unit` rend
      **438 tests**.
- [x] **Preuve d'interface dédiée** : `e2e/ui/commentaires.spec.ts`, **14 scénarios** contre le
      build de production. Le premier n'emploie **aucune substitution** — l'anonyme ouvre réellement
      la fiche, n'obtient aucune card, et **aucune requête de fil ne part**. Le second substitue la
      card **et rien d'autre** : la requête du fil est celle du produit, la réponse est celle de la
      pile — `200` et `[]` —, et l'écran affiche son état vide. `npm run e2e:ui` passe de 99 à
      **113**.
- [x] **Vérification visuelle réellement observée** : `docs/captures/CRM-043/`, **huit captures** —
      fil chargé, fil vide, refus d'écriture, commentaire très long à 390 px, et les **quatre
      paliers** du §7. Quatre ont été regardées une à une.
- [x] **UNE INCOHÉRENCE TROUVÉE EN REGARDANT UNE CAPTURE** (décision 202) : dans
      `refus-ecriture-1440.jpg`, l'état vide invite à « être la première personne à commenter »
      **juste au-dessus** du message disant que l'on ne peut pas commenter. Les deux textes sont
      corrects ; leur voisinage ne l'est pas. **Non corrigée**, et le motif est une règle : corriger
      supposerait que l'interface sache avant d'envoyer que l'utilisateur n'a pas le droit d'écrire.
      Écrite au §13.13. Cinquième fois qu'une capture dénonce ce qu'un test laisse passer.
- [x] **`docs/manual.md` chapitre 4.10 et sommaire**, écrits d'après le produit **réellement
      exécuté** : ce que la discussion fait, ce qu'elle ne fait pas, et **le fait que la règle de
      correction et de suppression existe sans que le geste soit offert**.
- [x] Harnais complété : `scripts/verify-commentaires.sh` rend **62 contrôles, aucune anomalie**, et
      ajoute trois gardes de séparation — le composant ne trie ni ne classe, aucune identité
      d'auteur n'atteint le rendu (INC-014), aucune persistance côté client n'apparaît
      (`CLAUDE.md` §11).
- [x] **Compteurs de `scripts/verify-harness.sh` révisés une seconde fois dans le MÊME
      changement** : `SCENARIOS_UI` 99 → **113**.
- [x] **~~LES ACTIONS « MODIFIER » ET « SUPPRIMER » NE SONT PAS RENDUES.~~ ELLES LE SONT**
      (décision 315). L'écart tenait à une cause nommée — les deux gestes supposent de distinguer
      *ses* commentaires de ceux des autres, donc une session, donc INC-021 —, et cette cause a
      disparu avec `CRM-009`. Livrés : les deux boutons tertiaires du §5.10, révélés au survol
      **et au focus clavier**, la correction en place dont le champ reçoit le focus curseur en fin
      de texte, et une confirmation explicite qui nomme l'irréversible **dans le libellé de son
      action**. Une pierre tombale n'offre plus rien : le trigger refuserait.
- [x] **LA COMPARAISON À L'IDENTIFIANT DE SESSION N'EST PAS UN CONTRÔLE D'ACCÈS** (`CLAUDE.md`
      §10). Elle ne sert qu'à **ne pas offrir** un geste voué au refus ; la règle est tenue par la
      politique `UPDATE`, qui exige l'auteur **et** le droit d'écriture courant. Le cas où l'écran
      se trompe est traité **explicitement** : un `PATCH` filtré par le `USING` rend `200` et
      **zéro ligne** — ligne *j* du §13.8 —, et l'écran le dit au lieu d'afficher une modification
      qui n'a pas eu lieu. Le `select('id')` final est ce qui rend ce refus visible.
- [x] **UN DÉFAUT VU SUR UNE CAPTURE, ET SUR ELLE SEULE** (décision 315, **sixième** occurrence du
      mécanisme). `commentaire-supprime-1440.jpg` montrait le fil **entièrement vide** une seconde
      après une suppression réussie, alors que le scénario était vert : `recharger()` rejouait tout
      l'effet — état de chargement, canal retiré, canal recréé —, si bien que la conversation
      disparaissait le temps d'un aller-retour et qu'une reconnexion au temps réel était payée à
      chaque écriture. La relecture ne touche plus au canal, et l'état de chargement n'est posé que
      lorsqu'il n'y a **rien à montrer**.
- [x] **UN SECOND DÉFAUT, DÉCOUVERT EN CORRIGEANT LE PREMIER** : deux lectures en vol revenaient
      dans le désordre et faisaient **réapparaître un commentaire supprimé**, une fois sur trois.
      Le rang de garde était pris par abonnement ; il l'est désormais **par lecture**. Le défaut
      préexistait, masqué par la reconstruction de l'effet.
- [x] **Trois preuves de composant tiennent ces deux corrections**, et elles **retiennent** une
      lecture pour placer l'assertion pendant l'aller-retour : sans ce levier, aucune assertion ne
      peut se situer là où le défaut vit. Vérifié non complaisant : chacune échoue sur le code
      d'avant.
- [x] **Preuve d'interface dédiée, SANS AUCUNE SUBSTITUTION** : `e2e/ui/commentaires-gestes.spec.ts`,
      **cinq scénarios** qui ouvrent une session réelle, écrivent par l'écran et **relisent l'effet
      par l'API** avec la clé de service — correction et `edited_at` posé par le trigger,
      suppression confirmée puis pierre tombale au corps vide, pierre tombale sans geste, parcours
      clavier, et la garde qui interdit au fichier de mesurer avec la clé anonyme ce qu'il prétend
      mesurer avec celle de service. Chaque scénario **rend le seed intact**. `SCENARIOS_UI` passe
      de 145 à **150**.
- [x] **La preuve clavier atteint le bouton par `Shift+Tab`, jamais par `focus()`** : Chromium ne
      pose pas `:focus-visible` sur un focus programmatique, et la preuve était verte pendant que
      la capture montrait un bouton **sans anneau de focus** — l'inverse de ce que le §8 exige.
- [x] **UN DÉFAUT D'ACCESSIBILITÉ QUE LA PREUVE CLAVIER A RÉVÉLÉ EN ÉCHOUANT** : publier au clavier
      renvoyait le focus au `body`, « Publier » devenant **désactivé** dès le brouillon vidé.
      L'utilisateur était donc rejeté en haut du document après chaque message. Le champ de
      composition reçoit désormais le focus ; sur un **refus**, il ne bouge pas, l'éloigner du
      message d'erreur serait pire. Deux tests de composant tiennent les deux cas.
- [x] **UNE TROISIÈME DISPOSITION ÉCARTÉE SUR CAPTURE** : devenues étroites, les deux actions
      tenaient sur la ligne du nom et de la date et la rétrécissaient jusqu'à couper
      « 10/08/2026 18:14 » en deux, **en permanence** — une action transparente occupe quand même
      sa place. Elles occupent maintenant leur **propre ligne**, réservée ; le §5.10 le dit.
- [x] **Un scénario instable, corrigé sans être toléré** : `getByText('Commentaire supprimé')`
      résolvait **deux** éléments — la pierre tombale et la région d'annonces du §8, qui porte le
      même texte —, et échouait en mode strict une fois sur trois. La cible est cherchée dans la
      carte ; tolérer deux résultats aurait confondu deux faits distincts.
- [x] **Cinq captures nouvelles**, observées une à une : actions au focus clavier, correction en
      cours, commentaire corrigé portant « modifié », confirmation de suppression, pierre tombale
      dans un fil intact.
- [x] **Deux défauts du harnais, corrigés dans le même changement.** Il renvoyait ses échecs vers
      un répertoire que son propre `trap` effaçait — la piste de diagnostic n'existait que dans la
      phrase qui la promettait ; et il exigeait **564 tests unitaires à l'identique** quand la
      campagne en portait 585, faisant rougir les commentaires pour une unité tierce. Les journaux
      d'échec survivent sous `e2e/output/`, et le compte global devient un **plancher** comme celui
      des assertions pgTAP depuis la décision 314.
- [x] **Un écart au design system corrigé plutôt qu'absous** : le §5.10 demandait des actions
      tertiaires de 13 px, le bouton n'avait qu'une taille. `Button` reçoit une taille `compacte`,
      **déclarée au §5.5**, la hauteur minimale de 40 px restant intacte (§8).
- [x] **UN COMPTEUR GLOBAL ÉTAIT RESTÉ EN ARRIÈRE, ET LA CAMPAGNE COMPLÈTE L'A DIT** :
      `SCENARIOS_UI` valait 145 quand la campagne en portait **152**, le commit « Prouve les droits
      fins à l'écran et ouvre INC-085 » ayant ajouté sept scénarios sans réviser le compteur dans
      le même changement. Même défaut qu'à `CRM-036` et `CRM-045` : le contrôle dénonce, la
      révision manque, et le soupçon retombe sur l'unité suivante. Porté à **157**.
- [x] **ET LE COMPTEUR VOISIN SOUFFRAIT DU MÊME MAL** : `SCENARIOS_MAIL` valait 16 quand
      `npm run e2e:mail` en rend **21**, `CRM-051` ayant livré cinq scénarios de protocole de plus
      en les annonçant dans son compte rendu. Deux compteurs sur quatre étaient périmés en même
      temps : `scripts/verify-harness.sh` était rouge par construction. Les deux sont corrigés, et
      la campagne complète le confirme.
- [x] **Un défaut de charge, mesuré et non contourné** : `npm run test:unit` échouait au hasard, le
      délai par défaut de Vitest — 5 s — étant atteint par un rendu qui coûte 0,1 s à vide. Le
      verdict d'une Definition of Done dépendait de la charge de l'hôte ; le plafond passe à 20 s
      sans qu'aucune assertion soit assouplie.
- [x] **Le parcours connecté est prouvé depuis `CRM-011`.** L'administratrice publie depuis la
      fiche réelle, voit le commentaire dans le fil, puis l'API relit exactement cette ligne. Le
      `viewer` commente une card qu'il voit : le backend refuse et le brouillon reste intact.

*DoD adaptée, écarts explicites.* La Definition of Done demandait « API (refus pour un `viewer`) ;
E2E ; temps réel constaté ». **Le premier et le troisième sont livrés et mesurés** — le refus avec
le jeton réel du `viewer` sur une card qu'il voit, et le temps réel avec son témoin et son silence.
**Le second est désormais complété par un chaînage réel** : les quatorze scénarios déterministes
restent, la reprise de `CRM-011` ajoute succès et refus connectés sans substitution, et les cinq
scénarios de `commentaires-gestes.spec.ts` écrivent puis relisent la base sans rien substituer.
**Les trois exigences sont donc tenues.**

*Limites nommées, non masquées.*

- **INC-072 reste la seule limite de modération** : les deux gestes sont livrés **pour l'auteur**,
  et pour lui seul. Aucun modérateur ne peut retirer un commentaire déplacé, l'intersection des
  deux sources contradictoires étant ce qui est livré.
- **INC-071 et INC-072 sont ouvertes**, relevées par cette unité : la première sur ce qu'il faut
  pour commenter, la seconde sur la modération. Le comportement livré est celui des sources
  concordantes et de l'intersection ; **aucun modérateur ne peut retirer un commentaire déplacé**.
- **INC-048 est enrichie et toujours ouverte** : `move_card` n'écrit pas le motif qu'elle exige,
  bien que sa destination existe désormais.
- **INC-014 est ouverte** : le nom de l'auteur n'est lisible par personne, ce qui pèsera sur le
  panneau plus lourdement encore que sur la colonne « Responsable » de la vue liste.
- **Le markdown est stocké et rendu en texte brut** : aucune unité ne porte son assainissement,
  et l'interpréter sans politique ouvrirait une injection (`docs/SPEC-cards.md` §13.13).
- **Aucune notification** : `mentions` n'est alimentée par rien, et une assertion le fige.
  L'**événement de timeline**, lui, n'est plus une limite : `card_events` est livrée par `CRM-044`,
  et le fil unifié range la parole au milieu des faits.
- **La phrase « la chaîne s'exécute sous Node 22.22.2 » ne décrit plus la reprise** : les preuves
  des deux gestes ont tourné sous **Node 24.14.1**, la version que le dépôt exige. La limite reste
  écrite pour la livraison d'origine, elle ne vaut pas pour celle-ci.
- **Aucun contournement hors dépôt n'a été nécessaire à la reprise** : la pile était déjà en
  marche, ses dix-huit services sains, et Playwright a résolu lui-même son navigateur —
  `PLAYWRIGHT_CHROMIUM_PATH` est resté vide, comme la décision 314 l'a rendu possible.
- **Les huit captures de `CRM-037` ont été RENOUVELÉES**, comme `CLAUDE.md` §16 l'exige : l'écran de
  détail d'une card a changé — la colonne de droite qu'il laissait vide porte désormais le panneau —,
  et les captures qui le montraient ne représentaient plus l'état exécuté. Les quatorze captures des
  autres unités, réécrites par le rejeu sans que leur contenu change, ont été **restaurées**.

### CRM-044 — Timeline unifiée `[x]`
`card_events` alimentée par triggers ; fil chronologique filtrable.
**DoD** : pgTAP (aucune écriture cliente possible) ; E2E ; captures.

- [x] **Spécification écrite avant toute ligne de code**, `docs/SPEC-cards.md` §14 : l'unité tenait
      en **deux lignes** au backlog, et **quatre** documents la nommaient sans la décrire — le §5 de
      `docs/SCHEMA.md` pour ses colonnes et une liste de types terminée par des points de
      suspension, le §10 du même pour son index, le §4 de `docs/SPEC-permissions-rls.md` pour une
      règle d'accès en cinq mots, le §5.3 de `docs/DESIGN_SYSTEM.md` pour une place et **cinq
      sources dont trois n'ont aucune table**. Écrite en quatorze sous-chapitres opposables, après
      mesure sur la pile réelle. Commit documentaire dédié, poussé avant la première ligne de code.
- [x] **Ce qui a été mesuré avant d'être écrit** (sondes `sonde_e1` et `sonde_ev`, créées puis
      détruites) : un trigger `SECURITY INVOKER` est **refusé** sur une table sans privilège
      d'écriture — et refuserait avec lui l'écriture métier ; le même en `SECURITY DEFINER` écrit,
      et `auth.uid()` y rend **l'identifiant réel de l'appelant** ; `service_role` est refusé comme
      `authenticated` ; `now()` donne **le même horodatage** à trois événements nés d'un seul
      `UPDATE` quand `clock_timestamp()` en donne trois distincts et **dans l'ordre réel** ; une
      écriture qui ne change rien ne produit **aucun** événement ; `move_card` produit un `moved`
      avec son acteur ; un aller-retour d'étape et un aller-retour de responsable rendent la card à
      son état de départ ; la cascade depuis `cards` **emporte** les événements (décisions 203 à
      209).
- [x] `docs/DESIGN_SYSTEM.md` §5.11 écrit dans le même changement : un événement est une **ligne**
      et non une carte — la différence de forme porte la différence de nature entre une parole et un
      fait —, cinq familles de filtres depuis `CRM-019` (Organisation séparée), leurs couleurs
      prises dans les jetons du §1, le
      compte porté par chaque bascule comptant **la source et non le filtre**, et **deux vides
      distincts** — « aucun événement » et « aucun élément pour ces filtres ».
- [x] `docs/SPEC-seed.md` §2.15 : le seed **ne peut pas** écrire un événement, et sa section est la
      première dont le contenu est entièrement dérivé de ses autres actes.
- [x] `docs/SCHEMA.md` §5 corrigé et complété : le `CHECK` des huit types, le refus explicite de
      `mail_received` et `mail_sent`, `clock_timestamp()` et son motif mesuré, l'absence d'
      `updated_at` comme **conséquence** et non comme écart.
- [x] `docs/JOURNAL.md` décisions 203 à 209, `CHANGELOG.md` mis à jour dans le même changement.
- [x] **LA TABLE EST LIVRÉE, ET PERSONNE NE PEUT Y ÉCRIRE.**
      `supabase/migrations/0016_timeline.sql` : `public.card_events`, son `CHECK` de vocabulaire à
      huit valeurs, la clé composite vers `cards (id, workspace_id)`, l'index de `docs/SCHEMA.md`
      §10, **une seule politique** — la lecture —, des privilèges réduits à `SELECT` **pour les
      trois rôles**, un trigger d'immuabilité et **cinq triggers d'alimentation**. **Rejouée deux
      fois sans erreur** : idempotente et convergente au sens d'INC-035.
- [x] **`service_role` N'A PAS L'ÉCRITURE, et c'est la propriété que l'unité cherchait**
      (décision 205). `CLAUDE.md` §8 interdit de fabriquer des traces ; toutes les unités
      précédentes l'ont respecté **par convention**, ici le seed ne le **peut** pas. MESURÉ :
      `permission denied for table card_events` avec le jeton de l'administratrice **comme** avec
      la clé de service.
- [x] **L'immuabilité est opposable au PROPRIÉTAIRE lui-même** : un trigger `BEFORE UPDATE` lève
      `card_event_immutable` pour tous les rôles. MESURÉ. **Aucun trigger de suppression** en
      revanche, et le motif est mesuré : la clé composite portant `ON DELETE CASCADE`, un refus
      rendrait impossible `delete from public.cards`, geste d'exploitation que la migration 15
      avait préservé (décision 207). La conséquence est écrite sans détour — une card physiquement
      supprimée **emporte sa mémoire**.
- [x] **Les triggers sont sur les TABLES, non dans les RPC** (décision 203). `move_card` n'est pas
      rouverte — elle appartient à `CRM-034` —, et le trigger de `cards` capte son effet **tout en
      couvrant strictement plus** : `owner_id`, `archived_at` et `deleted_at` s'écrivent par un
      `PATCH` direct qu'aucune fonction ne médie.
- [x] **`clock_timestamp()` et non `now()`** (décision 204). MESURÉ : trois événements nés d'un
      seul `UPDATE` portent le même horodatage avec `now()`, et l'ordre du fil devient celui de
      leurs `uuid` ; avec `clock_timestamp()`, trois valeurs distinctes **dans l'ordre réel**.
- [x] **Suite pgTAP dédiée** : `supabase/tests/0018_timeline.test.sql`, **87 assertions**, dont les
      huit types éprouvés **en écrivant** et les trois refusés — `mail_received`, `mail_sent`,
      `commented`. `npm run test:sql` passe de 1250 à **1337**.
- [x] **Preuve d'API dédiée** : `e2e/api/timeline.spec.ts`, **16 scénarios** avec les jetons réels.
      `npm run e2e:api` passe de 375 à **392** — seize ici, et **un** de plus dans
      `e2e/api/preuves-refus.spec.ts`.
- [x] **LA PREUVE DE REFUS N° 8 CESSE D'ÊTRE HORS D'ATTEINTE, POUR MOITIÉ.**
      `docs/SPEC-permissions-rls.md` §7 la comptait parmi les cinq non satisfaisables ; elles ne
      sont plus que **quatre**. `card_events` existe et refuse ; `audit_log` reste due par
      `CRM-072`, et son absence reste figée.
- [x] **SIX GARDE-FOUS ANTÉRIEURS ONT DÉNONCÉ LA NAISSANCE DE LA TABLE** — le mécanisme de la
      décision 51, **onzième** occurrence, et le plus large jusqu'ici. Six assertions pgTAP et deux
      scénarios d'API constataient l'absence de `card_events` ; ils sont **révisés, non retirés**,
      et mesurent désormais ce qui compte encore : que `move_card` ne soit pas rouverte, qu'un
      commentaire n'écrive aucun événement, que `card_field_values` ne conserve toujours aucun
      historique. Le compte de politiques passe de 44 à **45**.
- [x] **UN DÉFAUT DE MES PROPRES PREUVES, TROUVÉ EN EXÉCUTANT** (décision 210). L'assertion « 27
      événements » est verte seule et **rouge dans la suite complète** — 93 : les autres fichiers de
      preuve agissent sur les cards du seed, et la timeline enregistre tout. Ce n'est pas un défaut
      du produit, c'est le produit. Seule la **naissance** d'une card est idempotente : les suites
      assèrent neuf `created` exactement, et des **bornes inférieures** pour le reste.
- [x] **Seed étendu sans changer d'un iota l'état qu'il livrait** : deux allers-retours
      **conditionnés par une relecture** — d'étape sur `…0c4` par la vraie RPC `move_card`, de
      responsable sur `…0c1` par un vrai `PATCH` —, tous deux avec le **jeton réel de
      l'administratrice**, seuls événements du seed à porter un acteur. 27 événements au sortir du
      seed, et le rejeu n'en ajoute **aucun** : vérifié.
- [x] Harnais de preuves rejouable `scripts/verify-timeline.sh` : **49 contrôles**, et **non
      complaisant** — **six** dégradations volontaires le font réellement échouer : `INSERT` rendu à
      `authenticated`, `INSERT` rendu à `service_role`, trigger d'immuabilité retiré, `CHECK` élargi
      à `mail_received`, politique de lecture ouverte à tous, trigger de mise à jour de `cards`
      retiré. La restauration est **constatée** : migration rejouée, fichiers rendus intacts, suite
      verte.
- [x] **Compteurs de `scripts/verify-harness.sh` révisés dans le MÊME changement** : 1250 → **1337**
      assertions, 375 → **392** scénarios d'API. `SCENARIOS_UI` inchangé à cette étape.
- [x] `docs/SPEC-cards.md` §14 (quatorze sous-chapitres), `docs/SCHEMA.md` §5,
      `docs/DESIGN_SYSTEM.md` §5.11, `docs/SPEC-seed.md` §2.15, `docs/DAT.md` §3.2, §4.2 et §7,
      `docs/PROD_MIGRATIONS.md` §3 (migration 16 et son contrat d'exploitation),
      `docs/JOURNAL.md` décisions 203 à 210, `CHANGELOG.md` mis à jour dans le même changement.
- [x] **LE FIL UNIFIÉ EST LIVRÉ, ET IL NE PORTE AUCUNE RÈGLE.** La fusion des deux sources, l'ordre
      total, les familles, les filtres et la résolution des libellés vivent dans
      `webapp/src/lib/timeline.ts`, vérifiables sans navigateur ; `PanneauTimeline.tsx` rend. Le
      panneau de commentaires de `CRM-043` **est repris**, comme le §5.10 l'annonçait — « la
      première voie d'un fil unifié » —, et la colonne de droite du détail de card porte désormais
      les deux sources dans **un seul fil**, ordre croissant **non inversé**.
- [x] **Un commentaire n'écrit AUCUN événement** (décision 209) : la fusion se fait à la **lecture**.
      Dupliquer produirait deux représentations d'un même fait, dont l'une — immuable — survivrait à
      la pierre tombale de l'autre. Une assertion pgTAP fige l'absence de tout trigger de timeline
      sur `card_comments`.
- [x] **Test unitaire dédié** : `webapp/src/lib/timeline.test.ts` (**17 tests** : familles et leur
      repli documenté, ordre total **entre** les deux sources, comptes qui suivent la source,
      filtres, résolution des libellés et ses **échecs**, et le refus de lire un libellé dans le
      `payload`) et `webapp/src/app/PanneauTimeline.test.tsx` (**26 tests** sur le composant réel,
      dont dix nouveaux). `npm run test:unit` passe de 438 à **467 tests**.
- [x] **Preuve d'interface dédiée** : `e2e/ui/timeline.spec.ts`, **14 scénarios** contre le build de
      production. Le premier n'emploie **aucune substitution** : l'anonyme ouvre la fiche, n'obtient
      aucune card, et **aucune requête d'événements ne part**. `npm run e2e:ui` passe de 113 à
      **127**.
- [x] **QUATRE DÉFAUTS TROUVÉS EN REGARDANT LES CAPTURES, SUITE VERTE** (décision 212) — sixième
      occurrence. Trois viennent d'une classe utilitaire **hors de l'échelle discrète** du §3 du
      design system : `gap-1.5` et `size-7` ne produisent **aucune** règle CSS et n'échouent jamais
      bruyamment — le compte était collé au libellé (« Discussion1 »), et la pastille d'icône
      n'avait ni taille ni fond. Le quatrième : la barre de filtres **débordait du panneau** à
      1440 px, « Cycle de vie » coupé. Un cinquième point a été corrigé dans la foulée : quatre
      bascules à « 0 » au-dessus de « aucun événement ». Les cinq sont corrigés, le §5.11 est repris
      dans le même changement, et le harnais fige ce qui les a causés.
- [x] **UNE RÈGLE DU DESIGN SYSTEM A ÉTÉ RETIRÉE APRÈS OBSERVATION** : le filet vertical reliant les
      événements. La distinction carte / ligne porte déjà seule la lecture, et un filet
      s'interrompant à chaque prise de parole aurait produit une ligne pointillée sans signification.
      Retirée avec son motif plutôt que laissée écrite et non tenue.
- [x] **UN SCÉNARIO D'INTERFACE A ÉTÉ RÉÉCRIT PLUTÔT QUE TEMPORISÉ** (décision 211). Il comptait les
      requêtes après un clic de filtre et échouait : une requête part bien, mais **le clic n'en est
      pas la cause** — le fil des commentaires se relit quand l'abonnement temps réel tombe, et la
      lecture des événements est chaînée à la sienne. La preuve déterministe vit dans le test
      unitaire ; l'E2E mesure ce que l'utilisateur voit.
- [x] **Vérification visuelle réellement observée** : `docs/captures/CRM-044/`, **huit captures** —
      fil unifié, fil filtré, tous filtres éteints, fil vide, et les quatre paliers du §7. Cinq ont
      été regardées une à une, et quatre défauts en sont sortis.
- [x] **Les captures de `CRM-037` et de `CRM-043` ont été RENOUVELÉES** (`CLAUDE.md` §16) : la
      colonne de droite du détail de card a changé. Les captures de `CRM-007`, `CRM-021`, `CRM-041`
      et `CRM-042`, réécrites par le rejeu sans que leur contenu change, ont été **restaurées**.
- [x] `docs/manual.md` chapitre 4.10 réécrit d'après le produit **réellement exécuté** — ce que
      l'affaire retient d'elle-même, le fait que ces traces ne peuvent être ni fabriquées ni
      corrigées, et le fait qu'elles ne disent **pas qui** a agi.
- [x] Harnais complété : `scripts/verify-timeline.sh` rend **74 contrôles, aucune anomalie**, et
      ajoute quatre gardes d'interface — aucune classe hors échelle, la barre qui se replie, le
      composant qui ne trie ni ne classe, aucune persistance côté client. **Il a d'abord échoué sur
      ses propres commentaires** : les contrôles lisent désormais le code, pas la prose.
- [x] **Compteurs de `scripts/verify-harness.sh` révisés une seconde fois dans le MÊME changement** :
      `SCENARIOS_UI` 113 → **127**. Et `SCENARIOS_API` **corrigé après exécution** : posé à 392 par
      déduction — seize scénarios de plus, plus un dans les preuves de refus —, il vaut **391**, la
      preuve n° 8 ayant *remplacé* un cas au lieu d'en ajouter un. La révision d'un compteur se
      mesure ; `scripts/verify-harness.sh` rend **25 contrôles, aucune anomalie**.
- [x] **Le fil réel est atteint depuis `CRM-011`.** La connexion revient à la fiche demandée, le
      fil chargé est rendu et la publication nouvellement écrite y apparaît sans substitution.

*DoD adaptée, écarts explicites.* La Definition of Done demandait « pgTAP (aucune écriture cliente
possible) ; E2E ; captures ». **Les trois sont livrés** — 87 assertions pgTAP dont le refus mesuré
pour les trois rôles, quatorze scénarios d'interface contre le build de production, huit captures
observées. Les réponses substituées gardent les états rares déterministes ; un parcours connecté
les complète désormais sur la vraie fiche et la vraie API. Le contrat de lecture reste aussi
prouvé hors interface avec les jetons réels des trois comptes.

*Limites nommées, non masquées.*

- **Le parcours connecté est livré ;** les autres limites du fil restent inchangées.
- **Le motif d'une transition reste perdu** — INC-048, enrichie une seconde fois : sa destination
  existe désormais **deux fois**, et l'arbitrage porte sur laquelle.
- **Une card physiquement supprimée emporte sa mémoire** : la clé composite porte `ON DELETE
  CASCADE`, et un trigger de refus rendrait impossible un geste d'exploitation que la migration 15
  avait préservé. Deux issues sont écrites au §14.13, aucune n'est prise.
- **`actor_id` est perdu si le profil disparaît**, et **aucun acteur n'est nommé à l'écran**
  (INC-014).
- **Aucun temps réel sur les événements** : un déplacement fait par un tiers pendant que la fiche
  est ouverte n'apparaît qu'au prochain chargement.
- **`mail_received`, `mail_sent`, `card_activities` et les pièces jointes** ne sont pas dans le fil :
  leurs tables n'existent pas. Le §5.3 du design system en annonce cinq sources, deux sont livrées.
- **Sur l'hôte de vérification, la chaîne s'exécute sous Node 22.22.2**, alors que le dépôt exige
  Node 24. Limite héritée, inchangée.
- **Trois contournements hors dépôt ont dû être refaits** : démon Docker lancé à la main, `npm ci`
  précédé d'un `npm config set cafile` (INC-032, INC-042), et `PLAYWRIGHT_CHROMIUM_PATH` renseigné
  vers le navigateur préinstallé — INC-036, **treizième** occurrence. `./runDev.sh` et `./resetMe.sh`
  ont été **tentés** et ont l'un et l'autre échoué sur la construction de l'image `webapp`
  (`SELF_SIGNED_CERT_IN_CHAIN`) : la pile a été démarrée par `docker compose up` en énumérant les
  treize services autres que `webapp`. Aucune preuve n'en dépend, et aucun script du dépôt n'a été
  modifié.
- **Identité Git reposée avant le premier commit** — INC-034 point 2, **sixième** occurrence.

### CRM-045 — Déplacement d'une card entre channels `[~]`
`move_card_to_channel` avec remappage explicite.
**DoD** : pgTAP (remappage obligatoire, événement écrit) ; E2E.

- [x] **Spécification écrite avant toute ligne de code**, `docs/SPEC-workflow-engine.md` §6 :
      l'unité tenait en **dix lignes** écrites à `CRM-000`, qui nomment une fonction, un principe et
      un type d'événement sans dire ce que la fonction vérifie, dans quel ordre, ce qu'elle écrit ni
      ce qu'elle détruit. Réécrite en treize sous-chapitres opposables, **après mesure sur la pile
      réelle**. Commit documentaire dédié, poussé avant la première ligne de code.
- [x] **Ce qui a été mesuré avant d'être écrit** (décisions 213 à 218) : les douze colonnes que
      `authenticated` peut écrire sur `cards` — `channel_id`, `workflow_id` et `current_step_id`
      **n'en sont pas**, la garde était donc close avant d'exister ; un changement de channel est
      aujourd'hui **parfaitement silencieux**, le trigger de `CRM-044` ne surveillant pas
      `channel_id` ; le `CHECK` de `card_events` **refuse** `channel_changed` en `23514` ; un
      `UPDATE` du seul `channel_id` est refusé en `23503` par la clé composite, les trois colonnes
      devant s'écrire en **une** instruction ; et surtout, `card_field_values` interdit le
      changement de `workflow_id` d'une card qui porte une réponse — **six cards du seed sur
      neuf**.
- [x] **Une contradiction consignée sans être résolue implicitement** : **INC-073**,
      `docs/SCHEMA.md` §9 et `docs/SPEC-workflow-engine.md` §6 décrivent deux fonctions différentes
      sous le même nom — `step_mapping`, « remappage **des étapes** », annonce un déplacement en
      lot qu'aucune unité du backlog ne porte. La lecture la plus faible est retenue, la ligne du
      document de schéma est corrigée, l'arbitrage est demandé.
- [x] `docs/SCHEMA.md` §5 et §9, `docs/SPEC-cards.md` §14.4 et §14.6, `docs/SPEC-seed.md` §2.15 et
      §2.16, `docs/JOURNAL.md` décisions 213 à 218, `CHANGELOG.md` mis à jour dans le même
      changement que la spécification.
- [x] **LA FONCTION EST LIVRÉE, ET LA GARDE ÉTAIT CLOSE AVANT ELLE.**
      `supabase/migrations/0017_move_card_to_channel.sql` : `public.move_card_to_channel`, ses
      huit vérifications, `SECURITY DEFINER`, `search_path` vide, `EXECUTE` révoqué de `public` ET
      nommément d'`anon`. **Aucun privilège de colonne n'est posé** — décision 214, et c'est le
      premier cas du projet où une unité de sécurité antérieure paie d'avance une unité qui
      n'existait pas encore. Un contrôle du harnais et quatre assertions pgTAP défendent désormais
      un privilège qu'**aucune migration ne pose**.
- [x] **UN SEUL ÉVÉNEMENT, ET JAMAIS UN `moved` À CÔTÉ** (décision 215). `channel_changed` est la
      **neuvième** valeur du vocabulaire, et la garde `moved` est conditionnée à `channel_id`
      inchangé : une card qui change de workflow n'a franchi **aucune arête**, et il ne peut pas y
      en avoir entre deux graphes disjoints. Rien n'est perdu — le `payload` porte l'étape d'avant
      et celle d'après, donc **plus** que le `moved` qu'il remplace. Le trigger est sur la TABLE :
      un `PATCH` direct sous `service_role` produit l'événement lui aussi, ce qu'une assertion
      mesure.
- [x] **UNE PERTE QU'AUCUN DOCUMENT N'AVAIT VUE, ET QUI N'EST JAMAIS SILENCIEUSE** (décision 216).
      MESURÉ : `card_field_values` porte `(card_id, workflow_id) → cards (id, workflow_id)` sans
      `ON UPDATE CASCADE`, donc changer le workflow d'une card qui porte une réponse est refusé en
      `23503` — **six cards du seed sur neuf**. Les réponses sont détruites, et le quatrième
      paramètre `discard_field_values` vaut `false` : le refus `field_values_would_be_lost` porte
      leur **nombre** en `DETAIL`. La mémoire, elle, survit à la donnée : les `field_changed` sont
      conservés, et une assertion le prouve.
- [x] **Test unitaire dédié** : `supabase/tests/0019_move_card_to_channel.test.sql`, **64
      assertions**, dont les huit vérifications **dans les deux sens**. `npm run test:sql` passe de
      1337 à **1401**.
- [x] **Preuve d'API dédiée, hors interface, avec les jetons réels des trois profils** :
      `e2e/api/move-card-to-channel.spec.ts`, **18 scénarios** — les seize lignes du contrat du
      §6.9, plus le refus sur `workflow_id` et l'état laissé par le seed. `npm run e2e:api` passe
      de 391 à **409**. **Preuves de refus n° 1 et n° 5 reconduites**, la seconde sur `channel_id`.
- [x] **Seed étendu sans changer d'un iota l'état qu'il livrait** : un aller-retour de `…0c5` vers
      `prospection`, par la **vraie RPC** et avec le **jeton de l'administratrice**, conditionné par
      une relecture. 29 événements au sortir du seed, et le rejeu n'en ajoute **aucun** : vérifié.
      Le seed démontre enfin une card sur un **workflow dérivé** — en transit, jamais à demeure
      (décision 218). **À la clôture de cette unité, INC-046 n'était PAS levée** : elle portait
      sur le workflow d'un *channel*. `CRM-019` l'a fermée ensuite.
- [x] **`entered_step_at` est CONDITIONNELLE** (décision 217) : remise à `now()` si l'étape change,
      **inchangée** sinon — un changement de dossier ne fait entrer la card nulle part. `position`
      est en revanche **toujours** recalculée : changer de channel change de portée.
- [x] **Harnais de preuves rejouable** `scripts/verify-move-card-to-channel.sh` : **43 contrôles,
      aucune anomalie**, et **non complaisant** — cinq dégradations volontaires le font réellement
      échouer, dont la plus fine : la garde `moved` désinhibée, que seule l'assertion « aucun
      `moved` » voit. La restauration est **constatée**.
- [x] **UN DÉFAUT RÉEL DE MES PROPRES PREUVES, TROUVÉ EN EXÉCUTANT** — seconde occurrence de la
      décision 210. Deux assertions comptaient un **cumul** d'événements que d'autres suites du
      dépôt font varier : vertes seules, rouges dans la suite complète. Elles mesurent désormais
      un **écart**, pris avant et après le déplacement.
- [x] **UN SECOND DÉFAUT, DE LA MÊME FAMILLE, TROUVÉ PAR UN GARDE-FOU DE `CRM-034`.** Le scénario
      *l* déplaçait une card du seed ; `e2e/api/move-card.spec.ts` a échoué, le rang maximal de sa
      colonne valant 3 au lieu de 2. Le motif n'est pas un défaut du produit, **c'est le produit** :
      `position` est toujours recalculée, et un aller-retour ne la rend jamais. Le scénario opère
      désormais sur une card qu'il crée et qu'il détruit, et un contrôle du harnais fige les rangs
      du seed.
- [x] **LE SECOND DÉFAUT A RÉCIDIVÉ APRÈS LE COMMIT, ET LA CORRECTION ÉTAIT À MOITIÉ FAITE**
      (décision 229). Seul le scénario *l* avait été porté sur une card d'essai ; *n* et *p*
      déplaçaient encore `…0c5` et ne la rendaient **que si toutes leurs assertions passaient**. Le
      balayage de non-régression ayant dégradé la base pendant leur exécution, la card est restée
      dans `appels-offres` — et **dix-sept assertions réparties sur cinq suites** sont devenues
      rouges pour une seule card mal rangée. Les trois scénarios opèrent désormais sur des cards
      créées et détruites par la preuve, y compris en cas d'échec. **Vérifié après remise à froid**
      : les 409 scénarios d'API laissent les neuf cards du seed à leur channel, leur étape et leur
      rang exacts, relevés un à un.
- [x] **UN TROISIÈME DÉFAUT, ET LE PLUS GRAVE — INC-074, décision 219.** Trouvé par le **balayage de
      non-régression** et par rien d'autre. La migration 16 converge le vocabulaire vers huit
      valeurs, la 17 vers neuf ; le runner rejouant tout le répertoire à chaque démarrage, la 16
      ramenait la contrainte en arrière — et PostgreSQL refuse une contrainte que les lignes
      présentes violent. **`migrations-runner` sortait en code 3, la pile ne redémarrait plus.**
      Invisible sur une base neuve, où les migrations tournent avant le seed ; invisible de toute
      suite pgTAP, de toute preuve d'API et de tout harnais dédié, qui s'exécutent contre une base
      déjà migrée. Corrigé : l'autorité sur le vocabulaire passe à la dernière migration qui
      l'étend. **Vérifié** — runner recréé de force sur la base seedée, **code 0**, neuf valeurs
      relues.
- [x] **Une contradiction consignée sans être résolue** : **INC-073** (`step_mapping` désignait un
      déplacement en lot). Une **limite structurelle** consignée de même : **INC-074**, la
      convergence d'INC-035 ne sait pas exprimer une définition qui avance avec les migrations.
- [x] **Un garde-fou de types a joué comme il l'annonçait** : `database.types.test-d.ts` disait
      « une troisième fonction la rendra rouge à son tour ». Elle l'a rendue rouge. **Révisé, non
      retiré**, et resserré sur les trois fonctions livrées, avec la signature et le retour de la
      nouvelle.
- [x] **AUCUN GARDE-FOU DE VOCABULAIRE N'A JOUÉ, ET UNE VÉRIFICATION L'A ÉTABLI.** J'avais écrit
      que l'assertion « huit valeurs » de `0018_timeline.test.sql` serait retournée par cette
      unité : **c'était faux**. Cette suite éprouve ses huit types **en écrivant**, un à un, et n'a
      jamais compté l'énumération — le mécanisme de la décision 51 ne pouvait pas jouer. Le
      recensement manquait ; il est désormais porté par `0019`, et échouera à la dixième valeur.
- [x] **Build vert**, `npm run typecheck` vert sur les quatre projets, `npm run types:check` vert
      après régénération, `npm run test:unit` vert (**467 tests**, inchangés : aucune interface).
- [x] **Compteurs de `scripts/verify-harness.sh` révisés dans le MÊME changement**, et **mesurés,
      non déduits** : 1337 → **1401** assertions, 391 → **409** scénarios d'API. `SCENARIOS_UI`
      inchangé à 127 — cette unité ne livre aucun écran.
- [x] `docs/SPEC-workflow-engine.md` §6 (treize sous-chapitres), `docs/SCHEMA.md` §5 et §9,
      `docs/SPEC-cards.md` §14.4 et §14.6, `docs/SPEC-seed.md` §2.15 et §2.16, `docs/DAT.md`,
      `docs/PROD_MIGRATIONS.md` §3 (migration 17 et son contrat d'exploitation **destructif**),
      `docs/manual.md` chapitre 7 bis, `docs/JOURNAL.md` décisions 213 à 219 et 229, `CHANGELOG.md` mis à
      jour dans le même changement.
- [x] **BALAYAGE DE NON-RÉGRESSION : CE QU'IL A TROUVÉ, ET À QUI CHAQUE DÉFAUT APPARTIENT.** Les
      suites globales sont vertes sur une base fraîchement seedée — **1401 assertions pgTAP, 409
      scénarios d'API, 127 scénarios d'interface, 467 tests unitaires**, et la suite d'API laisse
      les neuf cards du seed à leur channel, leur étape et leur rang **exacts**, relevés un à un.
      Les harnais rejoués individuellement rendent : `verify-authz` **35/35**, `verify-migrations`
      **23/23**, `verify-move-card` **56/56**, `verify-move-card-to-channel` **43/43**,
      `verify-timeline` **75/76**.
- [x] **DEUX DÉFAUTS DU BALAYAGE M'APPARTENAIENT, ET SONT CORRIGÉS DANS CE CHANGEMENT.**
      **(a)** La dégradation « CHECK élargi à `mail_received` » de `scripts/verify-timeline.sh`
      **cessait de mordre** — forme la plus discrète du mécanisme de la décision 51 : ses deux
      listes omettaient `channel_changed`, les deux `ALTER` échouaient en silence derrière leur
      `|| true`, et le harnais rendait « DÉGRADATION NON VUE » sans que rien du produit n'ait
      changé. **(b)** La **restauration** du même harnais rejouait la seule migration 16, qui
      remplaçait `app.card_events_apres_maj_card()` par sa forme à **quatre** gardes : neuf
      assertions de la suite de cette unité en devenaient rouges **longtemps après** que le harnais
      eut rendu la main. C'est la parente d'INC-074 — un fichier qui n'est plus la dernière autorité
      sur un objet ne peut pas, seul, le restaurer. La migration 17 rejoint la séquence de
      restauration, comme la 14 avait rejoint celle de `verify-cards.sh` à `CRM-013`, et un
      contrôle **constate** que la cinquième garde est rendue. Le harnais passe de 74 à **76**
      contrôles.
- [ ] **QUATRE DÉFAUTS DU BALAYAGE NE M'APPARTIENNENT PAS, ET AUCUN N'EST CORRIGÉ ICI.** Les
      corriger reviendrait à rouvrir trois unités pendant un passage consacré à une quatrième
      (`CLAUDE.md` §13). Chacun est mesuré, daté et nommé :
      **(1) ~~INC-076, la plus grave~~ — CLOSE depuis `CRM-022` (2026-08-09), preuve rejouée le
      2026-08-12** — `card_comments.author_id` (`CRM-043`) n'a **aucune** action
      `ON DELETE`, là où les cinq autres clés vers `profiles` portent toutes `ON DELETE SET NULL`.
      Supprimer un compte qui a commenté rend `500` / `23503`. La Definition of Done de `CRM-011`
      affirme le contraire — « aucun profil orphelin (cascade) » —, et trois contrôles de
      `scripts/verify-seed.sh` échouent en le constatant sans le nommer. Un droit à l'effacement
      que le schéma rend inexécutable (`CLAUDE.md` §11). *Résolu par `CRM-022`, `author_id` nullable
      avec `ON DELETE SET NULL` ; `docs/INCONSISTENCY_REPORT.md` INC-076 et `docs/JOURNAL.md`
      décision 355 pour la preuve sur pile réelle.*
      **(2) `scripts/verify-commentaires.sh` est resté à `CRM-043`** : il cherche
      `PanneauCommentaires.tsx`, que `CRM-044` a **remplacé** par `PanneauTimeline.tsx`, et compte
      **438** tests unitaires là où `CRM-044` en a porté **467**. Quatre contrôles échouent, tous
      pour cette raison. Le fichier n'a pas été touché depuis `CRM-043` : vérifié par `git log`.
      **(3) `scripts/verify-preuves-refus.sh` attend 41 politiques**, la base en porte **45**
      depuis `CRM-044`. Compteur non révisé par l'unité qui l'a fait bouger.
      **(4) INC-036, quatorzième occurrence** : les navigateurs du conteneur sont en **1194**, le
      Playwright épinglé exige **1234**. Toute suite d'interface échoue tant que
      `PLAYWRIGHT_CHROMIUM_PATH` n'est pas renseigné — ce qui explique **à lui seul** la majorité
      des échecs du premier balayage. Avec le contournement, **127 scénarios verts**.
- [ ] **UN BALAYAGE SÉQUENTIEL DE TOUS LES HARNAIS N'EST PAS REPRODUCTIBLE, ET C'EST MESURÉ.** Après
      une passe complète, la base portait **neuf channels résiduels** (`api-cree-*`, `k6-bizdev`) et
      `appels-offres` archivé — chaque harnais dégrade puis restaure, mais les jeux d'essai
      s'accumulent. Les suites globales, vertes isolément, deviennent rouges. Contre-épreuve :
      `npm run e2e:api` seul, deux fois de suite sur une base fraîche, laisse **zéro** résidu. Le
      phénomène est de la famille d'INC-058 et d'INC-061 ; il est nommé ici parce que sa mesure
      manquait, et parce qu'il rend tout verdict de balayage séquentiel non concluant.
- [x] **DEUX EXÉCUTIONS DE LA ROUTINE ONT TRAVAILLÉ EN PARALLÈLE — INC-059, seconde occurrence.**
      `CRM-046` a été livrée pendant que celle-ci finissait ses vérifications, et elle a **révisé
      les assertions de `CRM-045`** au lieu de les contourner : `prospection` n'est plus vide, elle
      porte deux cards sur le workflow **dérivé**. La collision a porté sur deux numérotations —
      INC-075 et décision 220, attribuées de part et d'autre — résolues en renumérotant celles de
      cette unité en **INC-076** et **décision 227**.
- [x] **LE GARDE-FOU DU HARNAIS A TOURNÉ AU LIEU DE DISPARAÎTRE.** `CRM-046` avait révisé la suite
      pgTAP et la preuve d'API de cette unité, **pas son harnais**, qui contrôlait encore
      « `prospection` est vide ». Le contrôle est **remplacé par ce qu'INC-046 prouve désormais** :
      les deux cards y suivent bien la **copie** de portée track, et surtout **repointer le
      workflow d'un channel peuplé reste REFUSÉ** — mesuré en `23503`, et non déduit. Une assertion
      de refus prouve la règle ; une assertion de vide ne prouvait que l'absence d'occasion de
      l'enfreindre. Le harnais passe de 43 à **45 contrôles**.
- [x] **Suites rejouées APRÈS synchronisation**, comme la DoD l'exige : **1405 assertions pgTAP**,
      **410 scénarios d'API**, **467 tests unitaires**, typecheck et build verts,
      `verify-move-card-to-channel` **45/45**. Les compteurs de `scripts/verify-harness.sh` étaient
      déjà portés à 1405 et 410 par `CRM-046`.
- [ ] **INC-021 conditionne le passage en `[x]`**, comme pour les quinze unités précédentes : le
      parcours complet suppose une session, et aucune unité du backlog ne porte l'écran de
      connexion. **Seizième unité consécutive.**

*DoD adaptée, écarts explicites.* La Definition of Done demandait « pgTAP (remappage obligatoire,
événement écrit) ; E2E ». **Les trois sont livrés** — 64 assertions pgTAP dont le remappage
obligatoire dans les deux sens et l'événement écrit avec son payload complet, et 18 scénarios d'API
hors interface avec les jetons réels des trois profils. Cette unité est **la seule du chunk 3 dont
la Definition of Done ne demande pas de captures**, et le motif est écrit au §6.10 : elle ne livre
aucun écran, ni le board ni la vue liste ne portant de sélecteur de channel.

*Limites nommées, non masquées.*

- **Aucun écran, donc aucun test E2E d'interface et aucune capture.** La preuve E2E est une preuve
  d'**API**. C'est conforme à la DoD de l'unité, et ce n'est pas un parcours utilisateur.
- **Aucun parcours par un utilisateur connecté** : INC-021, seizième unité consécutive.
- **Les réponses de formulaire détruites ne se récupèrent pas.** `card_field_values` n'a pas
  d'historique ; seuls les `field_changed` de la timeline subsistent, **sans libellé** — l'écran
  résout les libellés dans les champs du workflow courant et ne les y trouve plus (§6.10).
- **À la clôture de cette unité, INC-046 n'était pas levée** : le workflow d'un channel peuplé
  restait inchangeable. L'option 2 de son arbitrage — une RPC qui remappe l'étape de toutes les
  cards d'un channel — a ensuite été créée et livrée par `CRM-019`.
- **Aucun déplacement en lot** : INC-073, en attente d'arbitrage.
- **Aucun harnais du dépôt ne rejoue le `migrations-runner` sur une base SEEDÉE** : INC-074. Le
  défaut le plus grave de cette unité a été trouvé par `verify-authz`, par effet de bord, alors que
  `verify-migrations` — dont c'est l'objet — ne l'a pas vu.
- **Sur l'hôte de vérification, la chaîne s'exécute sous Node 22.22.2**, alors que le dépôt exige
  Node 24. Limite héritée, inchangée.
- **Trois contournements hors dépôt ont dû être refaits** : démon Docker lancé à la main,
  `npm config set cafile` avant `npm ci` (INC-032, INC-042), et la pile démarrée par
  `docker compose up` en énumérant les treize services autres que `webapp`. `./runDev.sh` **et**
  `./resetMe.sh` ont été **tentés** et ont l'un et l'autre échoué sur la construction de l'image
  `webapp` (`SELF_SIGNED_CERT_IN_CHAIN`) — INC-042, **huitième** occurrence, prédiction vérifiée
  une nouvelle fois. `./resetMe.sh` avait toutefois **détruit le cluster avant d'échouer**, ce qui
  a permis un vrai rejeu à froid des dix-sept migrations. Aucun script du dépôt n'a été modifié.
- **Identité Git reposée avant le premier commit** — INC-034 point 2, **septième** occurrence.

**Arbitrage du responsable — `docs/JOURNAL.md`, décision 263 (INC-046, INC-073).** Le pluriel du
`docs/SCHEMA.md` §9 — « remappage explicite **des étapes** » — décrivait un second geste, distinct
de celui livré ici. `move_card_to_channel(card_id, channel_id, step_id)` est **retenue inchangée** ;
le geste pluriel devient `change_channel_workflow`, porté par **`CRM-019`**.

### CRM-046 — Seed de démonstration complet `[~]`
Trois tracks, plusieurs channels, workflows distincts dont un dérivé, cards à toutes les étapes,
cas d'erreur et branches alternatives, aucun écran vide.
**DoD** : `resetMe.sh` reproduit exactement le même état ; chaque fonctionnalité livrée est
démontrable depuis le seed.

- [x] **Spécification écrite avant toute ligne de code**, `docs/SPEC-seed.md` §9 : l'unité tenait
      en **cinq lignes** écrites à `CRM-000`, qui commandent un jeu de données neuf sans dire ce
      que le seed livre déjà — vingt-cinq unités plus tard — ni ce qui lui manque réellement.
      Réécrite en dix sous-chapitres opposables, **après mesure sur la pile réelle**. Commit
      documentaire dédié, poussé avant la première ligne de code.
- [x] **Ce qui a été mesuré avant d'être écrit** (décisions 220 à 224) : quatre des six exigences
      de l'énoncé sont **déjà satisfaites** par le socle ; deux ne le sont pas, et le manque est
      chiffré — `realisation` **0 card**, `livre` **1 card archivée**, `perdu` **0 card**, le
      workflow dérivé **0 card à ses sept étapes**, le channel `prospection` **0 card** ;
      l'obstruction du §9.1 de `docs/SPEC-cards.md` **re-mesurée** (section 4, HTTP `409`, `23503`,
      sortie `1`), avec sa contre-épreuve ; l'arborescence lue par les **trois** jetons réels
      (4/6/7 lignes pour l'`admin` et le `business_developer`, **3/4/4** pour le `viewer`) ; et
      l'absence totale de `form_fields` sur la copie.
- [x] **L'unité ne réécrit pas le seed** (décision 220) : cinq cards, quatre valeurs, **aucun**
      commentaire, aucun nouveau track ni channel. Un jeu refait aurait invalidé les identifiants
      que vingt-cinq unités, leurs suites pgTAP, leurs preuves d'API et leurs captures citent
      nommément.
- [x] **L'obstruction se lève par convergence, pas par relâchement** (décision 221) : les deux
      écritures inutiles — `workflow_id` de `prospection` en section 4, séquence de libération en
      section 7 — deviennent conditionnées par une relecture. **À la clôture de cette unité,
      INC-046 n'était PAS levée** : changer le workflow d'un channel peuplé restait refusé, et le
      seed cessait seulement de le tenter quand il n'y avait rien à changer. `CRM-019` a depuis
      livré le geste atomique légitime.
- [x] **Deux identifiants échappent au §4 et le produit l'impose** (décision 222) : la copie et ses
      sept étapes naissent de `gen_random_uuid()`. Le seed les résout **par la clé de nœud**, et
      aucune preuve ne peut figer le `workflow_id` de `…0ca`.
- [x] **INC-037 est constatée, pas compensée** (décision 223) : les deux cards du workflow dérivé
      ne portent aucune valeur de formulaire, et l'absence est **figée par une preuve** plutôt que
      maquillée par sept champs déclarés à la main.
- [x] **Une contradiction consignée sans être résolue implicitement** : **INC-075** (décision 224).
      Le `viewer` lit le channel `prospection` par droit fin sous un track fermé — ligne f du §3 de
      `docs/SPEC-permissions-rls.md`, la mesure même qui a clos INC-030 — mais la coquille résout le
      track **avant** ses channels : le droit existe côté serveur et **n'a aucun chemin côté
      produit**. Trois issues nommées, aucune tranchée.
- [x] `docs/SPEC-seed.md` §1, §4, §8 et §9, `docs/JOURNAL.md` décisions 220 à 224,
      `docs/INCONSISTENCY_REPORT.md` INC-075, `CHANGELOG.md` mis à jour dans le même changement que
      la spécification.
- [x] **LE JEU EST LIVRÉ, ET LES TROIS MANQUES SONT FERMÉS.** `supabase/seed/apply-seed.sh` :
      cinq cards, quatre valeurs, la convergence par état des sections 4 et 7. MESURÉ après
      application : **14 cards** dont 12 actives, **18 valeurs**, 5 commentaires, **38 événements**.
      Les **sept** étapes du workflow global portent chacune une card active, le workflow dérivé en
      porte deux à deux étapes distinctes, et **aucun channel actif n'est vide**.
- [x] **UN DÉFAUT RÉEL DE MON PROPRE TRAVAIL, TROUVÉ EN EXÉCUTANT LE HARNAIS** (décision 225).
      Conditionner TOUTE la réparation de la section 7 à la conformité de la copie faisait perdre
      la convergence pour toute dérive réparable — un nom modifié à la main n'était plus rattrapé.
      Seules `scope` et `track_id` exigent de libérer le channel ; `name`, `is_default` et
      `archived_at` sont désormais convergées **inconditionnellement**. `CRM-046` aurait introduit
      une régression de convergence en croyant en réparer une.
- [x] **UN SECOND DÉFAUT, DE LA MÊME FAMILLE** (décision 226), trouvé en exécutant le harnais
      **deux fois** : « 38 événements » n'est pas un invariant mais un ÉTAT, et le harnais lui-même
      en écrit quatre par exécution. Seul « un `created` par card » se fige par une égalité ; le
      reste est vérifié **en minorant**. L'assertion jumelle de `0018_timeline.test.sql`, qui
      comptait le même cumul, est révisée avec lui.
- [x] **UN TROISIÈME DÉFAUT, DANS UNE PREUVE QUE PERSONNE NE VOYAIT ROUGE.** La ligne *b* de
      `e2e/api/coherence-workflow.spec.ts` appelait `remettreChannel` **sans rien asserter** avant
      son écriture utile : le retour au workflow global échouait en silence, et l'assertion
      suivante réaffectait une valeur déjà en place. Elle serait restée **VERTE sans plus rien
      prouver**. Trois scénarios opèrent désormais sur un channel qu'ils créent et détruisent.
- [x] **Harnais de preuves rejouable** `scripts/verify-seed-demo.sh` : **62 contrôles, aucune
      anomalie**, et **non complaisant** — trois dégradations posées par la vraie route le font
      réellement mordre, et la restauration est **constatée**. Elle porte sur l'ÉTAT : la MÉMOIRE
      ne revient pas, et l'écart de la timeline est mesuré à la valeur près, quatre événements.
- [x] **Onze assertions figées par des unités antérieures sont devenues rouges, et TOUTES ont été
      RÉVISÉES, jamais retirées** (décision 51). Deux figeaient explicitement une conséquence
      d'INC-046 — « aucune card seedée dans `prospection` » : elles prouvent désormais que ces
      cards suivent le workflow dérivé, et le **refus** qui fonde INC-046 est éprouvé à côté, en
      `409`. Fichiers touchés : `0012_cards.test.sql`, `0015_colonnes_protegees.test.sql`,
      `0018_timeline.test.sql`, `0019_move_card_to_channel.test.sql`, `e2e/api/board.spec.ts`,
      `e2e/api/cards.spec.ts`, `e2e/api/coherence-workflow.spec.ts`,
      `e2e/api/colonnes-protegees.spec.ts`, `e2e/api/liste-cards.spec.ts`,
      `e2e/api/move-card-to-channel.spec.ts`, `e2e/api/valeurs-champs.spec.ts`.
- [x] **Suite pgTAP verte** : 1401 → **1405 assertions**, 19 fichiers, aucune anomalie.
- [x] **Preuves d'API vertes** : 409 → **410 scénarios**, dont la contre-épreuve « ligne a bis » qui
      mesure le refus `409` opposé au déplacement du workflow d'un channel peuplé.
- [x] **Preuves d'interface vertes** : **127 scénarios**, inchangés — l'unité ne livre aucun écran.
- [x] **Build vert**, `npm run typecheck` vert sur les quatre projets, `npm run test:unit` vert
      (**467 tests**, inchangés).
- [x] **Compteurs de `scripts/verify-harness.sh` révisés dans le MÊME changement**, et **mesurés,
      non déduits** : 1401 → **1405** assertions, 409 → **410** scénarios d'API, `SCENARIOS_UI`
      inchangé à 127. Le harnais rejoué : **25 contrôles, aucune anomalie**.
- [x] `docs/SPEC-seed.md` §1, §4, §8 et §9, `docs/SPEC-cards.md` §9 et §9.1,
      `docs/JOURNAL.md` décisions 220 à 226, `docs/INCONSISTENCY_REPORT.md` INC-075,
      `CHANGELOG.md` mis à jour dans le même changement que le code et les preuves.
- [x] **LA PREUVE N° 14 EST ACQUISE SOUS SA FORME FORTE** (décision 228). `./resetMe.sh --yes` a
      réellement détruit le cluster et ses volumes ; les dix-sept migrations ont été rejouées à
      froid — « 17 fichier(s) appliqué(s) avec succès » —, le seed appliqué, et l'empreinte
      reproductible est **identique** de part et d'autre :
      `34c409d17775c2ee6d1f68aa5fc73c03b9b49a0573596ffcf07bb2ead27d9d07`. `card_events` porte
      **exactement 38 lignes** sur la base neuve, ce qui confirme le nombre du §9.6 pour ce qu'il
      est. Les **62 contrôles** du harnais sont verts sur cette base reconstruite.
      **Réserve nommée** : `resetMe.sh` a échoué APRÈS la destruction, sur la construction de
      l'image `webapp` (INC-042, neuvième occurrence). La pile a été redémarrée à la main sans ce
      service, qui ne touche à aucune donnée.
- [x] **UN QUATRIÈME DÉFAUT DE MON PROPRE TRAVAIL, VU AVANT D'EXÉCUTER** (décision 227) : le §9.8
      déclarait comparer `email_local_part`, qui est **tiré au hasard** par le trigger de la
      migration 11. L'inclure aurait rendu la preuve n° 14 rouge par construction. Deux empreintes
      distinctes désormais — l'une compare deux états du même cluster, l'autre deux
      reconstructions —, et la valeur est remplacée par sa **forme** et son **unicité**, vérifiées
      par deux contrôles dédiés.
- [ ] **INC-021 conditionne le passage en `[x]`**, comme pour les seize unités précédentes.
      **Dix-septième unité consécutive.**

*Definition of Done tenue.* Elle demandait « `resetMe.sh` reproduit exactement le même état ;
chaque fonctionnalité livrée est démontrable depuis le seed ». **Les deux sont mesurées** : la
première par une destruction réelle du cluster et deux empreintes identiques, la seconde par les
soixante-deux contrôles du harnais, dont ce que chacun des trois profils lit avec son jeton réel.
**Seule INC-021 retient l'unité en `[~]`.**

*Limites nommées, non masquées.*

- **Aucun écran, donc aucune capture et aucun test E2E d'interface.** « Aucun écran vide » est
  vérifié au niveau des **données** que chaque jeton réel obtient, jamais au niveau du rendu :
  INC-021, dix-septième unité consécutive (`docs/SPEC-seed.md` §9.7).
- **Les deux cards du workflow dérivé ne portent aucune valeur de formulaire** : `copy_workflow_to_track`
  ne copie pas les champs, INC-037. L'absence est **figée par une preuve** plutôt que compensée par
  sept champs déclarés à la main (décision 223).
- **Un channel consenti par le backend reste inatteignable par la navigation** : INC-075, ouverte.
- **À la clôture de cette unité, INC-046 n'était pas levée.** Le seed avait cessé de repointer un
  channel peuplé sans rendre le geste possible, et le refus `409` était éprouvé par trois preuves
  distinctes. `CRM-019` a depuis fermé ce manque sans relâcher le `PATCH` direct.
- **Aucun message, aucune pièce jointe** : chunk 4.
- **Sur l'hôte de vérification, la chaîne s'exécute sous Node 22.22.2**, alors que le dépôt exige
  Node 24. Limite héritée, inchangée.
- **Trois contournements hors dépôt ont dû être refaits** : démon Docker lancé à la main,
  `npm config set cafile` avant `npm ci` (INC-032, INC-042), et la pile démarrée par
  `docker compose up` en énumérant les treize services autres que `webapp`. **INC-036, neuvième
  occurrence** : le Chromium préinstallé est en version `1194` là où le Playwright épinglé attend
  `1234` ; le contournement documenté du dépôt — `PLAYWRIGHT_CHROMIUM_PATH` — a suffi, et aucun
  fichier du dépôt n'a été modifié pour cela.

**Arbitrage du responsable — `docs/JOURNAL.md`, décision 259 (INC-003).** Le seed de démonstration
reprend le graphe du workflow par défaut une fois la transition « Réalisation → Perdu » ajoutée et
le graphe relu en entier. Une affaire de démonstration doit pouvoir emprunter ce chemin.

### CRM-047 — Manuel utilisateur du chunk 3 `[~]`
**DoD** : `docs/manual.md` décrit le produit réellement exécuté ; captures renouvelées.

- [x] **Spécification écrite avant toute ligne de code**, `docs/SPEC-manual.md` : l'unité tenait en
      **une ligne**, qui ne disait ni de quoi le manuel doit parler à la fin du chunk 3, ni comment
      on prouve qu'il décrit le produit plutôt qu'un souvenir de celui-ci. Rédigée **après mesure**
      sur la pile réelle — pile démarrée, seed appliqué, libellés relus dans `webapp/src/i18n/fr.ts`,
      volumes comptés dans la base, routes lues, quatre captures observées. Commit documentaire
      dédié, poussé avant la première ligne de code.
- [x] **La dérive est mesurée, écart par écart** : **treize**, consignés au §6 de la spécification
      avec la mesure qui établit chacun. Quatre affirmations rendues fausses par une unité
      **ultérieure** (`CRM-041`, `CRM-042`, `CRM-043`, `CRM-044`), deux chiffres périmés par
      `CRM-046`, un libellé cité que le produit n'affiche pas, un chapitre promis par le sommaire et
      écrit nulle part (`CRM-045`), et un écart qui n'est **pas** du manuel (INC-077).
- [x] **Une contradiction consignée sans être résolue implicitement** : **INC-077** (décision 232).
      `card_events.type` admet neuf valeurs, `PanneauTimeline.tsx` en déclare huit :
      `channel_changed` — écrit par `CRM-045`, **deux lignes dans la base** — tombe sur le repli et
      s'affiche « Événement ». Trois questions nommées, aucune tranchée ; le comportement reste
      inchangé et le manuel cesse d'annoncer un libellé qui n'existe pas.
- [x] **Deux décisions de méthode** : un volume du jeu de démonstration ne se recopie plus dans une
      phrase mais vit dans l'annexe A, comparée à la base par le harnais (décision 231) ; et le
      manuel se prouve par un **visiteur anonyme réel**, sans substitution de réseau, sur les huit
      adresses qu'il cite (décision 233).
- [x] `docs/JOURNAL.md` décisions 230 à 233, `docs/INCONSISTENCY_REPORT.md` INC-077, `CHANGELOG.md`
      mis à jour dans le même changement que la spécification.
- [x] **LES DOUZE ÉCARTS DU MANUEL SONT REFERMÉS**, le treizième étant un écart du produit. Le §3.2
      cesse de dire que les affaires n'ont aucun écran — elles en ont **trois** ; le §4.3 cesse de
      dire qu'aucune trace de déplacement n'est enregistrée et qu'aucun écran ne porte le geste ; le
      §4.7 cite désormais « **Card introuvable** », le libellé réel, et reconnaît que le fil occupe
      sa colonne de droite ; le §4.4 renvoie au bon chapitre ; le §4.6 cesse de ranger `CRM-045`
      parmi ce qui n'est pas livré.
- [x] **Le chapitre §4.11 est écrit** — `CRM-045` était promis par le sommaire et n'existait nulle
      part. Rédigé **après lecture de la fonction réellement installée** : les huit vérifications,
      le remappage jamais deviné, la perte de réponses qu'il faut accepter, `entered_step_at` qui ne
      bouge que si l'étape change, et la trace que le fil ne sait pas nommer.
- [x] **L'annexe A est livrée**, vingt et une grandeurs **mesurées** sur la base. La prose des
      chapitres renvoie à elle et n'écrit plus aucun volume (décision 231).
- [x] **UN DÉFAUT RÉEL DE MON PROPRE TRAVAIL, TROUVÉ EN EXÉCUTANT LE HARNAIS** (décision 234) :
      l'annexe portait « 38 événements », recopié de `CRM-046`. La première exécution après la suite
      d'API a rendu « le manuel dit 38, la base dit **73** ». Un total d'événements ne se fige pas —
      c'est la décision 226, que la spécification citait et que l'annexe enfreignait trois cents
      lignes plus loin. La grandeur **sort de la table**, son absence est expliquée dans le manuel,
      et l'invariant qui la remplace est vérifié : aucune affaire sans son événement `created`.
- [x] **UN SECOND DÉFAUT, DANS LE HARNAIS, QUE SEULE LA CONTRE-ÉPREUVE POUVAIT VOIR.** Deux
      contrôles se terminaient par `condition && ok` : sous `set -e`, la fonction rendait `1` dès
      qu'une anomalie existait, et le script s'interrompait **au premier écart** sans jouer les
      suivants. Invisible à toute exécution verte. Trouvé parce que la contre-épreuve exige un
      **nombre minimal** d'anomalies — cinq, une par famille — et non la simple présence d'un échec.
- [x] **Preuve d'interface dédiée** : `e2e/ui/manuel.spec.ts`, **9 scénarios verts**. Huit exercent
      les huit adresses citées par le manuel **en visiteur anonyme réel, sans aucune substitution**,
      et exigent le libellé **exact** promis au lecteur — la seule preuve du dépôt dont l'objet est
      une phrase de documentation (décision 233).
- [x] **INC-077 est MESURÉE, pas déduite** : le neuvième scénario sert un événement
      `channel_changed` et constate que le fil affiche « Événement », sans nommer les dossiers.
      Capture observée : `docs/captures/CRM-047/manuel-evenement-sans-nom-1440.jpg`.
- [x] **Harnais de preuves rejouable** `scripts/verify-manual.sh` : **105 contrôles, aucune
      anomalie**, et **non complaisant** — cinq dégradations posées sur une **copie** du manuel
      produisent **6 anomalies** réparties sur les cinq familles de contrôle.
- [x] **Captures renouvelées et OBSERVÉES.** Le corpus entier a été reproduit depuis l'application
      réellement exécutée par les 136 scénarios du projet `ui`. Huit images ont été regardées une à
      une : quatre du jeu `CRM-047` — accueil, track, liste, fiche — et quatre des jeux antérieurs
      qui portent les chapitres corrigés (`CRM-007`, `CRM-041`, `CRM-042`, `CRM-044`).
- [x] **Suite pgTAP verte** : 19 fichiers, **1405 assertions**, inchangées — l'unité ne touche
      aucune table.
- [x] **Preuves d'API vertes** : **410 scénarios**, inchangés.
- [x] **Preuves d'interface vertes** : 127 → **136 scénarios**.
- [x] **Build vert**, `npm run typecheck` vert sur les quatre projets, `npm run test:unit` vert
      (**467 tests**, inchangés).
- [x] **Compteur `SCENARIOS_UI` de `scripts/verify-harness.sh` révisé dans le MÊME changement**, et
      **mesuré** : 127 → **136**. Le harnais rejoué : **25 contrôles, aucune anomalie**.
      `scripts/verify-seed-demo.sh` rejoué : **62 contrôles, aucune anomalie**.
- [x] **Une seconde contradiction consignée sans être résolue** : **INC-078**. Quatre harnais du
      chunk 3 — `verify-formulaire.sh`, `verify-commentaires.sh`, `verify-timeline.sh`,
      `verify-move-card-to-channel.sh` — n'apparaissent dans aucune liste du `README.md`. Corriger
      quatre lignes appartenant à quatre autres unités mêlerait quatre sujets à un commit qui n'en
      traite qu'un : l'omission est consignée, pas refermée au passage.
- [x] `docs/SPEC-manual.md`, `docs/manual.md`, `README.md` §5 et §7, `docs/JOURNAL.md` décisions 230
      à 234, `docs/INCONSISTENCY_REPORT.md` INC-077 et INC-078, `CHANGELOG.md` mis à jour dans le
      même changement que le code et les preuves.
- [ ] **INC-021 conditionne le passage en `[x]`**, comme pour les dix-sept unités précédentes.
      **Dix-huitième unité consécutive.**

*Definition of Done tenue.* Elle demandait « `docs/manual.md` décrit le produit réellement exécuté ;
captures renouvelées ». **Les deux sont mesurées** : la première par les 105 contrôles de
`scripts/verify-manual.sh` et les 9 scénarios de `e2e/ui/manuel.spec.ts`, la seconde par la
reproduction complète du corpus et l'observation de huit images.

*DoD adaptée, écart explicite.* **Aucun test unitaire dédié** : l'unité ne livre aucune logique
applicative — elle livre un document et deux harnais. Un test unitaire qui lirait un fichier
Markdown dupliquerait `scripts/verify-manual.sh` dans un exécuteur sans accès à la base, et serait
donc **plus faible** que la preuve qu'il double (`docs/SPEC-manual.md` §7.3). L'écart est nommé
plutôt que comblé par un test de façade.

*Limites nommées, non masquées.*

- **Le manuel décrit des écrans que personne ne peut atteindre.** Les captures chargées des
  chapitres 4.7 à 4.10 proviennent de réponses **substituées sur le réseau**
  (`docs/DESIGN_SYSTEM.md` §12.5) ; le parcours réel d'un lecteur est celui du jeu `CRM-047` : une
  suite d'états vides et de refus. INC-021, dix-huitième unité consécutive.
- **Trois captures du parcours sont identiques** — track, board et liste — parce que le refus
  anonyme intervient **au niveau du track**, avant que le board ou la liste ne soient atteints.
  C'est ce que le manuel dit, et non un défaut de la série.
- **Le harnais vérifie des faits, pas du sens.** Il attrape un chiffre faux, un libellé paraphrasé,
  une capture disparue, une unité oubliée, un secret recopié. Il n'attrape pas une phrase juste mais
  trompeuse : la relecture humaine reste la seule preuve de la qualité d'un manuel.
- **INC-077 n'est pas levée** : le fil ne nomme toujours pas un changement de dossier. Le manuel dit
  ce que l'écran montre, et trois questions attendent l'arbitrage.
- **`docs/DAT.md` n'est pas touché** : l'unité ne modifie aucun composant, service, flux, modèle de
  données ni stratégie de déploiement.
- **Sur l'hôte de vérification, la chaîne s'exécute sous Node 22.22.2**, alors que le dépôt exige
  Node 24. Limite héritée, inchangée.
- **Trois contournements hors dépôt ont dû être refaits** : démon Docker lancé à la main,
  `npm config set cafile` avant `npm ci`, et la pile démarrée par `docker compose up` en énumérant
  les treize services autres que `webapp`. **INC-042, dixième occurrence** : la construction de
  l'image `webapp` échoue en `SELF_SIGNED_CERT_IN_CHAIN`, le secret de build `npm_ca` que le
  `Dockerfile` prévoit n'étant câblé par aucun fichier Compose. **INC-036, dixième occurrence** : le
  Chromium préinstallé est en version `1194` là où le Playwright épinglé attend `1234` ; le
  contournement documenté du dépôt — `PLAYWRIGHT_CHROMIUM_PATH` — a suffi, et aucun fichier du dépôt
  n'a été modifié pour cela.

---

## Chunk 4 — Messagerie

### CRM-050 — Infrastructure mail de développement `[x]`
Stalwart (IMAP/SMTP), Roundcube (vérification visuelle), ClamAV, Inbucket conservé pour les
mails transactionnels. Boîte système et deux boîtes personnelles seedées.
**DoD** : `runDev.sh` démarre l'ensemble ; connexion IMAP et SMTP constatée ; Roundcube affiche
les boîtes ; `README.md` §6 conforme.

- [x] **Spécification écrite avant toute ligne de code**, `docs/SPEC-mail-subsystem.md` §11 :
      l'unité tenait en quatre lignes, qui ne disaient ni quelles images, ni quels ports, ni quels
      domaines, ni comment un serveur mail se provisionne sans qu'un exploitant tape des commandes
      à la main. Rédigée **après mesure** sur des conteneurs réellement démarrés — et après trois
      pannes, écrites dans le document parce qu'aucune ne se lit dans une documentation
      (décision 235). Commit documentaire dédié, poussé avant la première ligne de code.
- [x] **Trois pièges mesurés, pas supposés** : la liaison `[::]` que génère `stalwart --init` **tue
      le serveur en silence** sur un conteneur sans IPv6 — `docker logs` vide, conteneur `Up`,
      aucun port ouvert ; le traceur fichier échoue tant que son répertoire n'existe pas ; et un
      principal créé sans `"roles":["user"]` **s'authentifie puis ne peut rien faire**, sans qu'un
      seul octet revienne au client.
- [x] **Chaîne de bout en bout déjà mesurée sur des conteneurs isolés** : soumission SMTP
      authentifiée en clair sur 587, message adressé à `c-abcd1234@crm.p2enjoy.test` — une adresse
      de card jamais déclarée — accepté, remis par le **catch-all** dans `INBOX` de la boîte
      système, puis relu par IMAP avec son `Message-ID` intact. Délimiteur de hiérarchie mesuré :
      `/`, ce dont `CRM-056` aura besoin.
- [x] **ClamAV prouvé opérant, et non seulement vivant** : `zPING` rend `PONG`, et un `zINSTREAM`
      portant la chaîne de test EICAR rend `stream: Eicar-Test-Signature FOUND`. Les signatures
      sont dans l'image ; aucun téléchargement n'est nécessaire.
- [x] **Cinq décisions consignées** : `docs/JOURNAL.md` 235 à 239 — la méthode, le placement de
      ClamAV (décision 236), la convergence de `CRM_INBOUND_DOMAIN` avec le seed (décision 237),
      les preuves de protocole sans bibliothèque (décision 238), et l'absence de boîte pour le
      `viewer` (décision 239).
- [x] **Une contradiction consignée sans être résolue** : **INC-079**. L'image de Stalwart
      télécharge sa console web depuis GitHub au démarrage ; derrière le proxy de la routine, la
      requête échoue et deux lignes `ERROR` sont écrites à chaque démarrage. Le serveur fonctionne,
      l'API de gestion répond, seule la console manque. Trois questions nommées — la console
      est-elle voulue, le bruit doit-il subsister, et une dépendance téléchargée en `latest`
      heurte-t-elle `docs/DAT.md` §3.7 — aucune tranchée, comportement inchangé.
- [x] **La pile de développement démarre les quatre services**, et `./runDev.sh` les annonce :
      `stalwart` (`stalwartlabs/stalwart:v0.13.4`), `stalwart-init` (`curlimages/curl:8.16.0`),
      `roundcube` (`roundcube/roundcubemail:1.6.11-apache`) et `clamav` (`clamav/clamav:1.4.3`).
      Les trois services durables sont **`healthy`** et le provisionnement **sort en succès** —
      c'est lui que `--wait` attend, exactement comme `minio-createbucket`. Le `healthcheck` de
      Stalwart éprouve **les quatre listeners un par un** : c'est le contrôle qui attrape à
      l'exécution la régression `[::]`, laquelle laisse le conteneur `Up` sans qu'aucun port
      n'écoute.
- [x] **Les boîtes sont créées par le véritable mécanisme** (`CLAUDE.md` §8) : `stalwart-init`
      appelle l'API de gestion de Stalwart, comme le ferait un exploitant. Aucune écriture directe
      dans RocksDB. L'image de Stalwart n'embarque ni `curl` ni `wget`, et son `stalwart-cli`
      v0.13.4 n'a **aucune** sous-commande de gestion de compte — mesuré, d'où la quatrième image.
- [x] **Convergent, et mesuré comme tel** : rejoué, le provisionnement rend « déjà présent,
      attributs rétablis » pour les trois boîtes et les deux domaines, sans doublon et **sans
      toucher un seul message**. L'API rend `200` avec un corps `fieldAlreadyExists` : la
      convergence se lit dans le corps, pas dans le code HTTP, et un `--fail` l'aurait masquée.
- [x] **Le catch-all fonctionne, de bout en bout et hors interface** : un message soumis en SMTP
      authentifié à `c-<jeton>@crm.p2enjoy.test` — une adresse de card **jamais déclarée** — est
      accepté, remis dans `INBOX` de la boîte système, puis relu par IMAP avec son `Message-ID`,
      son sujet et son destinataire intacts.
- [x] **Test unitaire dédié** : `stalwart/config.test.ts`, **24 assertions**, sur le seul artefact
      du dépôt qui porte de la logique — la configuration. Deux de ses invariants ont été payés par
      une panne réelle. Le périmètre de Vitest est étendu à `stalwart/` dans le même changement,
      plutôt que de ranger une preuve d'infrastructure parmi celles de l'interface.
      `npm run test:unit` : **523 tests**, 24 fichiers sur l'état courant.
- [x] **Preuve de protocole dédiée, hors interface** : `e2e/mail/infrastructure.spec.ts`,
      **13 scénarios** — trois sessions IMAP réelles, le refus d'un mot de passe faux, le
      délimiteur `/` annoncé par le serveur (ce dont `CRM-056` aura besoin), la remise par le
      catch-all et sa relecture, le refus d'une soumission non authentifiée, trois contrôles de
      l'API de gestion, et trois de ClamAV.
- [x] **Le projet Playwright `mail` est DÉCLARÉ**, pour la première fois : annoncé par
      `README.md` §7 et laissé vide par `CRM-008` faute de sujet (INC-023), il en a un désormais.
      `npm run e2e:mail` : **16 scénarios verts**. Il ne parle qu'aux serveurs — ni build, ni
      `webServer`.
- [x] **Aucune bibliothèque IMAP ou SMTP ajoutée** (décision 238) : les clients sont écrits sur une
      socket `node:net`. Le point ouvert n° 1 du §10 — le choix d'une bibliothèque IMAP pour
      `mail-sync` — reste **ouvert** pour `CRM-051`, plutôt que tranché par un test.
- [x] **ClamAV est prouvé opérant, pas seulement vivant** : `zPING` → `PONG`, `zINSTREAM` de la
      chaîne EICAR → `stream: Eicar-Test-Signature FOUND`, et une **contre-épreuve** sur un contenu
      anodin → `OK`. Sans cette dernière, un antivirus qui répondrait « FOUND » à tout passerait le
      contrôle. La chaîne EICAR est assemblée à l'exécution : elle n'existe telle quelle dans aucun
      fichier du dépôt, faute de quoi un antivirus installé sur le poste mettrait le dépôt en
      quarantaine.
- [x] **Vérification visuelle réellement observée** : `e2e/mail/roundcube.spec.ts`, 3 scénarios, et
      `docs/captures/CRM-050/` — trois images **regardées une à une**. La boîte personnelle rend
      son arborescence (Inbox, Drafts, Sent, Junk, Trash) ; la **boîte système montre les trois
      messages que le catch-all a captés**, ce qui est la preuve visuelle du mécanisme ; et le
      refus laisse le visiteur sur son formulaire avec « Login failed. ».
- [x] **TROIS DÉFAUTS RÉELS DE MES PROPRES PREUVES, TROUVÉS EN LES EXÉCUTANT** (décision 240), et
      les trois rendaient un **faux rouge** — ils accusaient le serveur d'un défaut qui était le
      mien. `trim()` ne retire pas l'octet NUL que `clamd` ajoute ; une preuve de refus qui
      poursuit le dialogue après un `535` se bloque sur le `503` suivant et l'échec est imputé à
      une absence de réponse ; et `SEARCH HEADER Message-ID "<jeton@domaine>"` ne trouve rien,
      Stalwart n'indexant pas les chevrons.
- [x] **Harnais de preuves rejouable** `scripts/verify-mail-infra.sh` : **84 contrôles, aucune
      anomalie**, et **non complaisant** — cinq dégradations posées sur une **copie** des fichiers
      versionnés produisent **6 anomalies** réparties sur les familles de contrôle. Il compare
      notamment `CRM_INBOUND_DOMAIN` à `workspaces.inbound_domain` **lu dans la base** (décision
      237), vérifie qu'aucun des quatre services n'apparaît dans l'assemblage de production, et
      que le mot de passe d'administration tiré au hasard n'est présent dans **aucun** fichier
      versionné.
- [x] **Compteur du harnais du harnais révisé dans le MÊME changement** : `scripts/verify-harness.sh`
      gagne `SCENARIOS_MAIL=16` et un contrôle « 5 bis » qui exécute `npm run e2e:mail`. Sans lui,
      un projet entier serait resté hors du périmètre du harnais. Rejoué : **26 contrôles, aucune
      anomalie**.
- [x] **Aucune régression sur les suites du dépôt** : `npm run test:sql` **1405 assertions**
      (inchangé), `npm run e2e:api` **410 scénarios** (inchangé), `npm run e2e:ui` **136 scénarios**
      (inchangé), `npm run build` vert, `npm run typecheck` vert sur les quatre projets.
- [x] `README.md` §2, §5, §6, §7, §9, §10 et §11, `docs/DAT.md` §3.4, §3.6, §3.7 et §13,
      `docs/SPEC-test-harness.md` §1, §2, §8 et §9, `docs/PROD_MIGRATIONS.md` §4,
      `docs/SPEC-mail-subsystem.md` §11, `docs/JOURNAL.md` décisions 235 à 241,
      `docs/INCONSISTENCY_REPORT.md` INC-079 et INC-080, `CHANGELOG.md` mis à jour dans le même
      changement que le code et les preuves.
- [x] **PREUVE À FROID, APRÈS DESTRUCTION COMPLÈTE.** Le cluster et **tous** les volumes ont été
      détruits, y compris le RocksDB de Stalwart, puis la pile relancée : elle remonte en
      **33 secondes**, `p2enjoy-migrations` sort en `0`, les seize services sont sains, et le
      provisionnement **recrée les deux domaines et les trois boîtes** sans aucune intervention.
      Les preuves de l'unité ont été **reprouvées sur cet état froid** : `verify-mail-infra.sh`
      72 contrôles sans anomalie, `npm run e2e:mail` 16 scénarios, `npm run test:unit` 488 tests,
      `npm run test:sql` 1405 assertions.
- [x] **DÉMARRAGE FROID DÉTERMINISTE ET SANS AVERTISSEMENT STALWART** (décision 245) : la
      console `latest` est remplacée par une page locale versionnée, les deux réglages
      d'authentification modifiables passent par `/api/settings` puis `/api/reload`, et le
      healthcheck hérité de `postgres-meta` reçoit une période d'initialisation. La preuve doit
      partir sans volume Stalwart, exécuter `./runDev.sh` en succès et constater zéro `ERROR` et
      zéro `WARN` dans les journaux du serveur mail. Prouvé sur le projet Docker jetable
      `p2enjoy-crm-cold-proof`, les volumes normaux conservés : `runDev.sh` sort en succès,
      `verify-mail-infra.sh` rend **84/84**, `e2e:mail` **16/16**, puis le journal reste propre
      après la vraie soumission SMTP. Le provisionnement désactive explicitement DKIM et ARC en
      développement, faute de clés de production ; le harnais contrôle le journal **après** les
      protocoles, pas avant.
- [x] **REFUS ANTICIPÉ D'UN DOMAINE DE CATCH-ALL INCOHÉRENT** (décision 245) : en profil `dev`,
      `runDev.sh` et `resetMe.sh` refusent avant toute action un `CRM_INBOUND_DOMAIN` différent de
      `crm.p2enjoy.test`. Le harnais éprouve le refus de `runDev.sh` et de `resetMe.sh` sur un
      fichier jetable **avant Docker**, et conserve sa comparaison tardive avec la vraie base.
- [x] **LE REJEU SÉQUENTIEL EST DE NOUVEAU UNE MESURE — INC-080 CLOSE** (décisions 296 et 309).
      Le défaut final venait de `verify-cards.sh` : sa restauration mémorisait un suffixe de
      migrations et omettait la migration 20. Le harnais appelle maintenant le runner complet,
      synchrone, avant toute mesure globale. La séquence ciblée des dix harnais recensés ne produit
      plus de deadlock ni d'état intermédiaire ; SQL **1698**, API **444** et UI **145** restent
      verts après son passage.
- [x] **LES GARDE-FOUS PÉRIMÉS SUIVENT L'ÉTAT COURANT — INC-080 CLOSE.** Les contrôles comptent
      désormais **14 cards** et **55 politiques**, le board attend **4** cards actives sur
      **3** étapes, le panneau réel est `PanneauTimeline.tsx`, les **172** classes du CSS produit
      sont reconnues et l'accès aux identités suit `CRM-022`. Rejeu ciblé : migrations **25/25**,
      authz **35/35**, cards **46/46**, board **56/56**, refus **21/21**, commentaires **46/46**,
      liste **54/54**, formulaire **27/27**, webapp **42/42**, seed **69/69**.
- [x] **Le seed de la base n'est pas touché, et il n'y avait rien à y ajouter.** Cette unité ne
      crée ni table, ni page, ni statut, ni flux applicatif : elle livre des boîtes **dans un
      serveur mail**, qui sont son propre jeu de données et se rejouent par `stalwart-init`. Les
      tables `mail_*` n'existent pas avant `CRM-052`.
- [x] **INC-021 est close** : la connexion réelle et les gestes utilisateur authentifiés ont été
      livrés et mesurés lors de la reprise de `CRM-011` (décisions 243 et 244).

*Definition of Done tenue.* Elle demandait « `runDev.sh` démarre l'ensemble ; connexion IMAP et
SMTP constatée ; Roundcube affiche les boîtes ; `README.md` §6 conforme ». **Les quatre sont
mesurées** : les quatre services démarrent avec la pile et sont sains ; la connexion IMAP est
prouvée sur les trois boîtes et la soumission SMTP par un message réellement remis et relu ;
Roundcube affiche les boîtes, captures observées ; et `scripts/verify-mail-infra.sh` compare les
ports de `README.md` §6 à ceux que `.env.example` déclare.

*Limites nommées, non masquées.*

- **Aucun consommateur applicatif.** Rien dans le CRM ne lit ces boîtes avant `CRM-052` et
  `CRM-054`. Ce qui est livré est le **monde extérieur**, pas la fonctionnalité.
- **`./runDev.sh` est désormais exécuté d'un bloc sur cet hôte**, y compris avec reconstruction de
  `webapp` et volume Stalwart neuf. L'ancienne limite `SELF_SIGNED_CERT_IN_CHAIN` n'est pas apparue
  lors de cette reprise ; le contexte Docker incorrect, lui, a été trouvé et corrigé par la
  décision 247.
- **La console web de Stalwart est volontairement absente** — INC-079 close. Sa racine sert une
  page locale explicative ; l'API porte l'exploitation et Roundcube la vérification visuelle.
- **Aucun TLS**, par choix documenté (`docs/SPEC-mail-subsystem.md` §11.3). Les ports ne sont
  publiés que sur `DEV_BIND_ADDRESS`.
- **ClamAV n'est pas déclaré en production** : opération due, inscrite dans
  `docs/PROD_MIGRATIONS.md` §4 sous `CRM-054` (décision 236).
- **`scripts/verify-scripts.sh` rend 58 contrôles, aucune anomalie**, y compris la lecture réelle
  d'un port publié, la reconstruction de l'image webapp et l'absence des chemins sensibles.
- **La dette de preuve d'INC-080 est soldée sur son périmètre exact.** Les dix harnais qu'elle
  recensait ont été rejoués sur la même pile et restaurent tous leur état ; la campagne globale
  qui les suit rend **1698 SQL**, **444 API** et **145 UI** sans bruit de console. La preuve mail
  réelle rend **84/84**, sa contre-épreuve produit **6 anomalies** attendues et `e2e:mail` reste
  **16/16**. Cette mesure remplace le balayage historique invalide ; elle ne prétend pas qu'une
  liste de scripts figée serait à jamais exhaustive. Le méta-harnais final rend **28/28** après
  ses six dégradations et sa restauration SQL/API.
- **La chaîne a été rejouée sous Node 24.14.1**, conforme au prérequis du dépôt, et avec le
  Chromium headless `1234` attendu par Playwright 1.62.1.

### CRM-051 — Service `mail-sync` `[x]`
Squelette Python, configuration, journaux structurés, point de santé, API interne.
**DoD** : pytest unitaire ; image construite ; arrêt et redémarrage sans perte d'état.

**Périmètre réduit par arbitrage du responsable — `docs/JOURNAL.md`, décision 261 (INC-012).** Cette
unité **perd son sous-composant `scheduler`** : relances, séquences, digest et purge RGPD passent à
`pg_cron`, porté par **`CRM-017`**. `mail-sync` reste un service Python parce qu'IMAP et SMTP
demandent des connexions longues ; seul l'ordonnancement en sort.

- [x] **Spécification écrite avant code** : `docs/SPEC-mail-subsystem.md` §12 fixe runtime,
      configuration, santé, API authentifiée, état atomique, journaux, refus et preuves.
- [x] **Dépendance IMAP tranchée sans l'embarquer prématurément** : IMAPClient 3.1.0,
      BSD-3-Clause, maintenu, compatible Python 3.13 et IDLE. Il entrera dans l'image avec son
      premier consommateur (`CRM-052` ou `CRM-054`) ; les connexions TLS vérifieront explicitement
      certificats et noms d'hôtes.
- [x] **Périmètre sans façade** : les workers IMAP et SMTP sont explicitement
      `waiting_for_configuration`; aucune connexion, table métier ou file factice ne préempte les
      unités suivantes. Aucun scheduler ne réapparaît.
- [x] **Moindre privilège décidé** : le socle ne reçoit pas `SERVICE_ROLE_KEY`, puisqu'il ne
      touche encore aucune donnée Supabase. Le seul secret nouveau est son jeton d'API interne.
- [x] **Service Python réel** : configuration validée au démarrage, stockage opérationnel
      versionné et atomique, logs JSONL, middleware de corrélation, santé et statut. L'état est
      ouvert **synchroniquement dans `create_app`**, sans lifespan applicatif : `ready` est vrai,
      ou l'application n'existe pas (décision 313, §12.3).
- [x] **API interne fermée** : santé minimale sans jeton ; statut avec Bearer ; jetons absent,
      faux et mal formé indiscernables ; checkpoint de preuve borné au profil `dev` et `404` en
      production ; corps et propriétés bornés. MESURÉ sur un conteneur `prod` issu de la MÊME
      image : `/internal/v1/dev/checkpoint` rend `404` **avec le bon jeton**.
- [x] **Conteneur durci et commun** : `python:3.13.13-slim-bookworm`, uid `10001`, racine en
      lecture seule — une écriture hors volume est refusée par le noyau —, `cap_drop: ALL`,
      `no-new-privileges`, aucun port hôte (`{"8080/tcp":null}`), volume nommé
      `p2enjoy-crm_mail-sync-state`, healthcheck interrogeant la readiness réelle. Les deux
      assemblages Compose restent valides et ne publient aucun port.
- [x] **Chemin utilisateur livré** : `./runDev.sh` amorce le jeton — **y compris sur un `.env`
      antérieur à l'unité**, par `env_ensure_dev_completions` —, démarre le service et
      `./runDev.sh --withLog mail-sync` suit réellement ses journaux.
- [x] **pytest unitaire significatif** : **40 tests verts, aucun avertissement**. TestClient
      Starlette 1.3.1 avec HTTPX2 2.7.0 (décision 312), contre-preuve d'entrée/sortie sur
      l'application réelle, configuration/refus sans fuite, état atomique/corrompu, routes
      dev/prod, en-têtes, borne de corps, journaux JSON sans fuite, refus du point d'entrée.
- [x] **Image et API réellement exercées** : construction `--no-cache`, uid du processus contrôlé
      à `10001`, santé et appels internes émis depuis un conteneur jetable **placé sur le réseau
      Compose**, aucun port publié. `scripts/verify-mail-sync.sh --contre-epreuve` : **64/64**.
- [x] **Arrêt/redémarrage sans perte prouvé** : un UUID est écrit par l'API interne, le **vrai**
      conteneur subit `docker compose stop` puis `start`, le même UUID est relu, `boot_count`
      vaut précédent + 1 et `boot_id` change. Prouvé deux fois : par le harnais et par
      `e2e/mail/mail-sync.spec.ts` (S2).
- [x] **Console opérationnelle silencieuse** : tout journal nominal est un JSON valide portant
      `timestamp`, `level`, `service` et `event` ; aucun secret, aucun en-tête, aucun corps, et
      aucune ligne `WARNING`, `ERROR` ou supérieure après démarrage, API, arrêt et reprise.
- [x] **Campagnes de non-régression et documentation synchronisées** : `npm run typecheck` vert,
      `npm run e2e:mail` **21/21** (les 16 preuves de `CRM-050` incluses), `pytest` **40/40**,
      `scripts/verify-mail-sync.sh --contre-epreuve` **64/64**. `README.md` §5, §7, §9, §10 et
      §11, `docs/DAT.md` §3.3, `docs/SPEC-mail-subsystem.md` §12.2 et §12.6,
      `docs/PROD_MIGRATIONS.md` §4, `CHANGELOG.md` et `docs/JOURNAL.md` décision 313 sont à jour
      dans le même changement.

*Limite nommée.* L'unité ne livre **aucune synchronisation** : `imap_worker` et `smtp_worker`
annoncent `waiting_for_configuration`, et le harnais échoue si l'un d'eux prétend autre chose. Les
comptes arrivent en `CRM-052`, l'ingestion en `CRM-054`. Aucun écran n'est dû : `mail-sync` est un
service interne, sans interface — INC-021 ne s'y applique pas.

### CRM-052 — Comptes entrants IMAP `[~]`
Configuration, secret chiffré, test de connexion réel, état de synchronisation.
**DoD** : `CRM-004` tranché ; preuve de refus n° 6 (secret illisible) et n° 7 ; E2E de connexion
d'une boîte ; message d'erreur assaini vérifié.

- [x] **Spécification écrite avant toute ligne de code**, `docs/SPEC-mail-subsystem.md` §13 :
      l'unité tenait en deux lignes au backlog, et trois documents la nommaient sans la décrire —
      le §2.1 et le §2.3 du sous-système pour ses objets, le §12 de `docs/SCHEMA.md` pour ses
      colonnes, le §7 de `docs/SPEC-permissions-rls.md` pour deux preuves de refus **figées comme
      non satisfaisables**. Écrite en dix sous-chapitres opposables, **après mesure** sur la pile
      réelle. Commit documentaire dédié, poussé avant la première ligne de code.
- [x] **Ce qui a été mesuré avant d'être écrit** : `vault.create_secret` refusée à
      `authenticated` **dès le schéma** ; `service_role` seul à porter `USAGE` sur `vault` et
      `SELECT` sur `decrypted_secrets` ; l'aller-retour chiffrement/déchiffrement complet ; et,
      contre le vrai Stalwart depuis le réseau Compose, les six comportements du §13.6 — dont le
      fait que **mot de passe faux et compte inconnu rendent le même refus**, que la vérification
      TLS stricte échoue sur le certificat auto-signé, et qu'aucun listener 993 n'existe.
- [x] **La migration est livrée** : `supabase/migrations/0022_comptes_entrants_imap.sql` —
      `public.mail_inbound_accounts`, dix contraintes posées par **convergence** et non par la
      seule création, **deux index uniques partiels**, deux politiques de lecture, les privilèges
      de colonne, et **trois** fonctions `SECURITY DEFINER`. Rejouée trois fois sans erreur :
      idempotente et convergente au sens d'INC-035.
- [x] **AUCUNE ÉCRITURE DIRECTE N'EST OUVERTE**, et c'est un choix, pas un oubli : ni `INSERT`, ni
      `UPDATE`, ni `DELETE` pour `authenticated`. Une table de configuration dont un seul chemin
      d'écriture est correct — celui qui met le mot de passe dans Vault au lieu de la table — ne
      doit pas en offrir deux. Le droit est vérifié **dans la fonction, en base** (`CLAUDE.md` §10).
- [x] **Les trois fonctions vivent dans `public`, et c'est MESURÉ** : PostgREST est configuré avec
      `PGRST_DB_SCHEMAS=public,storage,graphql_public`. Une fonction du schéma `app` serait
      invisible de `/rest/v1/rpc/`, donc inappelable par le seed comme par `mail-sync`.
- [x] **UN DÉFAUT TROUVÉ PAR LA SUITE pgTAP, PAS À LA LECTURE** : `array_length('{}', 1)` rend
      **NULL**, et un `check` qui vaut NULL est réputé satisfait — la borne de `watch_folders`
      laissait donc passer un tableau vide. Corrigée par `coalesce`, et c'est **la convergence**
      qui l'a réellement appliquée à une base déjà créée.
- [x] **UN SECOND DÉFAUT TROUVÉ DE LA MÊME FAÇON** : `vault.secrets.name` est UNIQUE. Un compte
      supprimé laissait derrière lui un secret orphelin, et recréer la même boîte échouait sur un
      `23505` incompréhensible. Le secret orphelin est désormais **repris**, jamais recréé.
- [x] **Suite pgTAP dédiée** : `supabase/tests/0024_comptes_entrants_imap.test.sql`, **60
      assertions**. Elle retire les comptes seedés **dans sa transaction** : sans cela elle serait
      verte sur une base fraîche et rouge après le seed, et un verdict qui dépend de l'ordre des
      commandes n'éprouve pas le produit.
- [x] **Le service teste RÉELLEMENT la connexion** : `POST /internal/v1/inbound-accounts/{id}/test`
      lit le compte par PostgREST avec la clé de service, déchiffre par la fonction réservée, ouvre
      une session IMAP vers le serveur déclaré, liste ses dossiers, et écrit son verdict. La route
      est `def` et non `async def` — trois entrées/sorties bloquantes gèleraient la boucle
      d'événements, donc les sondes de santé.
- [x] **IMAPClient 3.1.0 entre dans l'image, et pas avant** : l'arbitrage n° 1 du §10 l'avait
      retenu en écrivant qu'il n'y entrerait qu'avec son premier consommateur. Éprouver la
      connexion avec `imaplib` pendant que `CRM-054` emploierait IMAPClient prouverait un chemin
      que le produit n'emprunte pas. **Aucun client HTTP n'est ajouté** : `urllib` couvre les deux
      appels PostgREST du service (`CLAUDE.md` §19).
- [x] **`SERVICE_ROLE_KEY` est remise au service**, ce que `CRM-051` avait délibérément différé :
      le principe de moindre privilège se tient dans le temps, pas seulement dans l'espace.
- [x] **Le seed porte ses trois comptes**, posés par le **véritable chemin d'écriture** — jamais un
      `INSERT` direct, que la base refuse d'ailleurs. Farida n'en a pas, et son absence est utile
      aux preuves : elle donne un membre sans boîte, donc une lecture vide qui n'est pas un refus.
      Le statut reste `pending` : un `ok` sans connexion réelle serait la trace fabriquée que
      `CLAUDE.md` §8 proscrit.
- [x] **LES PREUVES DE REFUS N° 6 ET N° 7 SONT ACQUISES**, et les assertions qui figeaient leur
      absence sont **retournées, non retirées** — septième occurrence du mécanisme de la
      décision 51. Trois suites antérieures les portaient : `0015_colonnes_protegees.test.sql`,
      `0016_preuves_refus.test.sql` et `e2e/api/preuves-refus.spec.ts`, dont l'inventaire de
      couverture passe de « sept acquises, quatre absentes » à « **huit acquises, deux à moitié,
      deux absentes** ». Laisser ce compte inchangé aurait figé une absence que le produit venait
      de combler.
- [x] **Preuve d'API dédiée** : `e2e/api/comptes-entrants.spec.ts`, **11 scénarios** avec les
      jetons réels des trois comptes — refus n° 6, n° 7 et n° 11, écriture directe refusée, la
      voie de sortie du secret refusée à tous sauf au service, et la convergence du chemin
      d'écriture. `npm run e2e:api` passe de 444 à **456**.
- [x] **Preuve `mail` dédiée, SANS AUCUNE SUBSTITUTION** : `e2e/mail/comptes-entrants.spec.ts`,
      **6 scénarios** qui ouvrent de vraies sessions IMAP contre le Stalwart de `CRM-050` et
      **relisent la base** — un service qui rendrait `ok` sans rien écrire serait vert autrement.
      `npm run e2e:mail` passe de 21 à **27**.
- [x] **`starttls` est prouvé EN REFUS, et `ssl` ne l'est pas du tout** (§13.6) : le certificat
      local est auto-signé, et le produit refuse à raison de lui faire confiance ; aucun listener
      993 n'existe. Les deux absences sont **figées par des assertions**, jamais par un
      commentaire, et la seconde devra tomber le jour où un listener existera.
- [x] **`last_error` porte un CODE, et la contrainte `CHECK` le rend opposable** : le texte d'un
      serveur distant est une entrée non maîtrisée — il peut contenir l'identifiant essayé, un nom
      d'hôte interne, une adresse IP — et il finirait affiché puis capturé. La preuve `mail`
      mesure que « `[AUTHENTICATIONFAILED]` » ne franchit jamais la frontière.
- [x] **`pytest mail-sync/tests` passe de 63 à 70**, dont la traduction de **onze** pannes en
      codes, deux pannes réellement provoquées — hôte inexistant, port fermé — et la garde qui
      interdit au journal de porter l'identifiant de connexion, l'hôte ou le mot de passe.
- [x] **Harnais de preuves rejouable** `scripts/verify-mail-inbound.sh` : **47 contrôles, aucune
      anomalie**, et **non complaisant** — sept dégradations volontaires le font réellement
      échouer. Il porte en outre un **témoin** avant les dégradations : si la suite était déjà
      rouge, chacune serait déclarée « vue » sans rien prouver. Ce n'est pas théorique — c'est
      arrivé une fois en écrivant cette unité.
- [x] **Compteurs de `scripts/verify-harness.sh` révisés dans le MÊME changement** : 23 → **24**
      fichiers SQL, 1698 → **1759** assertions, 444 → **456** scénarios d'API, 21 → **27**
      scénarios `mail`. `SCENARIOS_UI` inchangé : l'unité ne livre aucun écran.
- [x] **Le harnais de `CRM-051` a dénoncé ce changement, et il a été révisé** : son conteneur de
      profil `prod` démarrait sans les deux variables devenues obligatoires, et trois de ses
      contrôles échouaient pour une raison qui ne les regardait pas. `verify-mail-sync.sh` rend de
      nouveau **61/61**, et sa contre-épreuve **64/64**.
- [x] **Le contrat de types est révisé, non contourné** : `database.types.test-d.ts` annonçait
      « une cinquième fonction la rendra rouge à son tour ». Elle l'a fait. Les trois fonctions y
      sont déclarées, et **deux d'entre elles restent inaccessibles au client** — le type les voit,
      la base les refuse, et c'est la différence entre ce qui est déclaré et ce qui est consenti.
- [ ] **Aucun écran**, et l'écart est nommé au §13.1 : le §2.3 décrit des formulaires qu'aucune
      unité du backlog ne porte. Le geste existe par l'API interne du service, comme l'exploitant
      l'exercera. **Seul écart restant de cette unité.**

*DoD adaptée, écarts explicites.* La Definition of Done demandait « `CRM-004` tranché ; preuve de
refus n° 6 et n° 7 ; E2E de connexion d'une boîte ; message d'erreur assaini vérifié ». Les quatre
sont tenues : `CRM-004` l'était depuis la décision 23, les deux refus sont **mesurés avec les
jetons réels**, la connexion d'une boîte est ouverte pour de bon contre le vrai serveur, et le
message assaini est éprouvé dans les deux sens — le code est écrit, la phrase du serveur ne l'est
jamais.

*Limites nommées, non masquées.*

- **Aucun écran de configuration** (voir ci-dessus). Le manuel dit ce que le produit fait et ce
  qu'il n'offre pas encore.
- **`ssl` implicite n'est pas prouvable en développement** faute de listener 993, et `starttls` ne
  l'est qu'en refus, le certificat local étant auto-signé. Ce n'est pas une faiblesse du produit :
  aucun mode dégradé de vérification TLS n'existe, et c'est la bonne réponse.
- **Aucune synchronisation** : `last_sync_at` et `sync_state` restent nuls, `CRM-054` les
  remplira. Le harnais échoue si l'un d'eux prétend autre chose.
- **OAuth2 reste hors périmètre**, arbitrage n° 2 du §10 inchangé : les organisations qui
  l'imposent ne pourront pas connecter leur boîte en v1.
- **Un compte supprimé laisse son secret dans Vault**, désormais **repris** au lieu d'être recréé.
  Aucune purge n'est livrée : elle relève d'une unité RGPD, et la nommer ici vaut mieux que
  d'écrire un `DELETE` sur un schéma que le produit ne gouverne pas.

### CRM-053 — Identités sortantes SMTP `[~]`
Indépendantes des comptes entrants, adresse d'expédition, signature, quota.
**DoD** : E2E de configuration ; preuve de refus n° 12 ; cas « entrant Yahoo / sortant interne »
présent dans le seed.

- [x] **Spécification écrite avant toute ligne de code**, `docs/SPEC-mail-subsystem.md` §14, sur le
      modèle du §13 et **après mesure** sur la pile réelle.
- [x] **UNE MESURE CHANGE LE CONTRAT** : Stalwart applique un **délai de pénalité de dix secondes**
      sur un échec d'authentification SMTP — `535 5.7.8` après 10,0 s exactement, mesuré à 10 s et
      à 35 s de patience, quand un délai de 5 s rendait un trompeur `SMTPServerDisconnected`. Avec
      le délai hérité du §13.5, un mot de passe faux serait rapporté comme un `timeout` : le
      diagnostic **mentirait**. Le test SMTP emploie donc trente secondes, dans sa propre variable.
- [x] **La migration est livrée** : `supabase/migrations/0023_identites_sortantes_smtp.sql`, jumelle
      de la 22 — mêmes politiques, mêmes privilèges de colonne, même chemin d'écriture unique vers
      Vault, **même catalogue de codes**. Rejouée deux fois sans erreur.
- [x] **UN DÉFAUT TROUVÉ EN EXERÇANT, PAS À LA LECTURE** : le trigger qui rabat l'identité par
      défaut était écrit `AFTER`, et l'index unique partiel refusait la seconde identité **avant**
      que le rabattement n'ait lieu. Un invariant tenu par un index et rétabli par un trigger n'a
      de sens que si le second parle en premier. Le trigger est `BEFORE`, et une assertion pgTAP
      lit son `tgtype` pour que la régression soit visible.
- [x] **Le défaut se DÉPLACE, il ne se dispute pas** : déclarer une nouvelle identité par défaut
      rabat l'ancienne, et il n'existe aucun instant sans identité par défaut. Obliger
      l'utilisateur à décocher d'abord ferait porter à l'écran une mécanique que la base tient.
- [x] **L'adresse d'expédition est bornée** : c'est la seule donnée de cette table que le
      destinataire verra, et une chaîne qui n'est pas une adresse doit être refusée à
      l'enregistrement — non plus tard, à l'envoi, sur un compte annoncé valide.
- [x] **Suite pgTAP dédiée** : `supabase/tests/0025_identites_sortantes_smtp.test.sql`,
      **38 assertions**.
- [x] **Le service teste RÉELLEMENT la connexion SMTP** :
      `POST /internal/v1/outbound-identities/{id}/test` s'authentifie, émet `NOOP`, referme —
      **et n'envoie aucun message** : une unité sans destinataire n'a pas à en inventer un.
- [x] **Le délai est de trente secondes, dans sa propre variable**, et un test Python **fige la
      règle** : le délai SMTP doit rester supérieur à la pénalité mesurée. Sans lui, quelqu'un
      ramènerait un jour les deux protocoles au même réglage, et le diagnostic recommencerait à
      mentir.
- [x] **Le seed porte les deux identités**, et la seconde **démontre** le cas d'usage que le §2.2
      promettait depuis le socle documentaire : Driss reçoit sur `bizdev@` et expédie depuis
      `contact@`. Camille n'en a aucune — une administratrice qui lit tout sans rien posséder.
- [x] **Preuve d'API dédiée** : `e2e/api/identites-sortantes.spec.ts`, **7 scénarios**, dont la
      divergence entrant/sortant mesurée sur le seed et le déplacement du défaut.
- [x] **Preuve `mail` dédiée, sans aucune substitution** : `e2e/mail/identites-sortantes.spec.ts`,
      **5 scénarios** SMTP réels. Celui du mot de passe faux dure **onze secondes** : il traverse
      pour de bon le délai de pénalité, et échouerait si le réglage revenait à dix.
- [x] **LA PREUVE DE REFUS N° 7 EST DÉSORMAIS ENTIÈRE**, et la n° 6 porte ses deux tables. Les
      assertions qui figeaient l'absence de `mail_outbound_identities` sont **retournées, non
      retirées** — huitième occurrence du mécanisme de la décision 51. L'inventaire de couverture
      passe à « **neuf acquises, une à moitié, deux absentes** ».
- [x] **Harnais dédié** `scripts/verify-mail-outbound.sh` : **51 contrôles, aucune anomalie**, avec
      son témoin et **huit** dégradations, dont celle qui ramène le délai SMTP sous la pénalité.
- [x] **Compteurs de `scripts/verify-harness.sh` révisés dans le MÊME changement** : 24 → **25**
      fichiers SQL, 1759 → **1797** assertions, 456 → **463** scénarios d'API, 27 → **32**
      scénarios `mail`.
- [x] **`docs/manual.md` chapitre 4.13** : recevoir et expédier sont deux choses distinctes,
      l'adresse par défaut se déplace, l'adresse d'expédition est vérifiée à l'enregistrement, et
      le quota n'est appliqué par rien.
- [ ] **La preuve de refus n° 12 reste hors d'atteinte** : elle exige `queue_outbound_email`, due
      par `CRM-058`. L'absence est **figée par une assertion**, non commentée.
- [ ] **Aucun écran**, même écart qu'à `CRM-052` et pour la même raison.

*DoD adaptée, écarts explicites.* La Definition of Done demandait « E2E de configuration ; preuve
de refus n° 12 ; cas “entrant Yahoo / sortant interne” présent dans le seed ». **Le premier et le
troisième sont tenus** — la configuration est exercée de bout en bout contre le vrai serveur, et le
cas d'usage est démontré par le seed. **Le second ne l'est pas, et ne peut pas l'être** : la
fonction qu'il exige appartient à `CRM-058`. L'absence est figée plutôt que compensée par une
preuve de substitution, et l'unité reste `[~]` pour cette raison.

*Limites nommées, non masquées.*

- **`daily_quota` est créée sans consommateur** : aucun quota n'est appliqué tant que `CRM-058`
  n'est pas livrée, et le harnais échoue si une valeur non nulle apparaissait.
- **SMTPS implicite n'est pas prouvable** faute de listener 465, et `starttls` ne l'est qu'en refus.
  Aucun mode dégradé de vérification TLS n'existe.
- **Aucun message n'est envoyé, pas même par le test** : le test s'authentifie et referme.
- **Aucun écran de configuration.**

### CRM-054 — Ingestion `[~]`
IDLE, analyse MIME, dédoublonnage par `Message-ID`, occurrences, pièces jointes, antivirus.
**DoD** : pytest unitaire et intégration contre Stalwart ; E2E `mail` avec un email **réellement
envoyé** ; pièce jointe `infected` non téléchargeable (preuve n° 9) ; empreinte de repli testée.

- [x] **Spécification écrite avant toute ligne de code**, `docs/SPEC-mail-subsystem.md` §15, après
      mesure sur la pile réelle.
- [x] **UNE MESURE CHANGE LE PRODUIT** : un message externe soumis **sans authentification** est
      accepté puis classé dans **`Junk Mail`**, pas dans `INBOX` — mesuré sur trois expéditeurs,
      dont `preuves.p2enjoy.test`, le domaine même de la preuve M2 de `CRM-050`. Cette preuve passe
      parce qu'elle soumet **en SMTP authentifié**. Un worker aveugle au dossier des indésirables
      ne verrait donc jamais arriver un vrai message. Le seed surveillera `INBOX` **et**
      `Junk Mail` ; le défaut de la colonne reste `{INBOX}`, seul choix qu'un produit puisse faire
      à la place de quelqu'un.
- [x] **Trois autres mesures** : `UIDVALIDITY` lisible et stable, ClamAV détectant EICAR depuis le
      réseau Compose, et Storage acceptant un aller-retour complet avec la clé de service —
      `storage.buckets` étant **vide**, ce que la preuve de refus n° 9 avait figé.
- [x] **Les trois tables et le bucket sont livrés** : `supabase/migrations/0024_ingestion_messages.sql`.
      La clé de dédoublonnage est celle du §4.2, un message classé porte toujours une card et un
      message non classé n'en porte jamais — l'invariant est écrit pour que `CRM-055` ne puisse pas
      le rompre par inadvertance.
- [x] **LE CHEMIN DE DÉPÔT NE PORTE AUCUN NOM DE FICHIER**, et une contrainte le tient : un nom
      d'origine dans un chemin de stockage est une traversée de répertoire qui attend son heure.
      Le nom d'origine est **conservé à côté** du nom assaini — le perdre priverait l'utilisateur
      de ce que l'expéditeur a voulu transmettre.
- [x] **Le bucket est PRIVÉ et sans politique**, et la mesure a montré ce qui protège réellement :
      `storage.objects` accorde **tous** les privilèges à `anon` et `authenticated` — défaut de
      Supabase. Seule l'absence de politique refuse. `CRM-057` devra en écrire une conditionnée à
      `av_status = 'clean'` ; écrite à la légère, elle ouvrirait aussi les `infected`.
- [x] **Suite pgTAP dédiée** : `supabase/tests/0026_ingestion_messages.test.sql`, **26 assertions**.
- [x] **L'analyse MIME vit hors du réseau**, dans un module qui ne parle ni IMAP, ni HTTP, ni SQL :
      **27 tests** l'éprouvent sans serveur — empreinte de repli et sa canonisation, séparateur nul,
      assainissement des noms, type déterminé par le **contenu** quand la déclaration est générique.
- [x] **L'empreinte de repli est canonisée**, et le séparateur nul n'est pas décoratif : sans lui,
      « a@b » + « c » et « a@bc » + « » se concaténeraient identiquement, et deux messages
      différents auraient la même empreinte. Une preuve le mesure.
- [x] **Une panne d'antivirus ne rend JAMAIS `clean`** : elle rend `skipped`, que le §4.3 range
      parmi les statuts non téléchargeables. Un fichier non analysé n'est pas un fichier sain.
- [x] **La relève est livrée et IDEMPOTENTE** : `POST /internal/v1/inbound-accounts/{id}/poll` lit
      les dossiers **déclarés par l'exploitant**, relève, dédoublonne, ajoute une occurrence, et
      dépose puis analyse les pièces. Rejouée, elle n'ajoute rien — le dédoublonnage est tenu par
      la base, pas par le service.
- [x] **UNE MESURE A CORRIGÉ L'ÉCRITURE** : `Prefer: resolution=ignore-duplicates` ne s'applique
      **pas** sans le paramètre `on_conflict`, et PostgREST rendait un `409 / 23505`. Le paramètre
      nomme la contrainte de dédoublonnage, qui n'est pas la clé primaire.
- [x] **Preuve `mail` dédiée, sans aucune substitution** : `e2e/mail/ingestion.spec.ts`, un email
      **réellement envoyé** par le chemin authentifié, relevé depuis le vrai IMAP, sa pièce EICAR
      détectée `infected` par le vrai ClamAV, sa pièce PDF `clean` et typée **par son contenu**,
      son nom `../rapport.pdf` assaini, son chemin de dépôt sans nom de fichier, et le rejeu qui
      n'ajoute rien.
- [x] **LA PREUVE DE REFUS N° 9 EST ACQUISE** : une pièce `infected` **et** une pièce `pending` ne
      se téléchargent ni anonymement, ni avec le jeton de l'administratrice. Les assertions qui
      figeaient l'absence de bucket sont **retournées, non retirées** — neuvième occurrence du
      mécanisme de la décision 51. L'inventaire passe à « **dix acquises, une à moitié, une
      absente** ».
- [x] **Le seed surveille `INBOX` ET `Junk Mail`**, et le défaut de la colonne reste `{INBOX}` :
      c'est le seul choix qu'un produit puisse faire à la place de quelqu'un.
- [x] **Harnais dédié** `scripts/verify-mail-ingestion.sh` : **35 contrôles, aucune anomalie**,
      témoin compris et **six** dégradations, dont le bucket rendu public et l'antivirus rendu
      complaisant.
- [x] **UN DÉFAUT DE MES PROPRES PREUVES** : le faux serveur ClamAV lisait le flux par un unique
      `recv`, répondait, puis fermait — le client recevait alors un `BrokenPipeError` en
      poursuivant son envoi, et le verdict devenait `skipped`. **Une fois sur trois.** Il lit
      désormais jusqu'au terminateur.
- [x] **Compteurs de `scripts/verify-harness.sh` révisés** : 25 → **26** fichiers SQL,
      1797 → **1823** assertions, 463 → **466** scénarios d'API — dont **un de moins** dans
      `preuves-refus`, la table sortant de la liste des absences —, 32 → **34** scénarios `mail`.
- [ ] **Aucun classement** : un message ingéré est `unclassified`, et les quatre règles du §4.4
      appartiennent à `CRM-055`. Le harnais échoue si un message classé apparaissait.
- [ ] **Aucune veille permanente** : la relève est déclenchée par l'API interne. IDLE est **mesuré
      disponible** — et seulement **après authentification**, ce qu'un client naïf ne verrait pas —
      mais la boucle durable, sa reprise et sa supervision appartiennent à `CRM-059`.
- [ ] **Aucun dossier IMAP créé** (`CRM-056`), **aucun écran** (`CRM-057`), **aucun envoi**
      (`CRM-058`).

*DoD adaptée, écarts explicites.* La Definition of Done demandait « pytest unitaire et intégration
contre Stalwart ; E2E `mail` avec un email **réellement envoyé** ; pièce jointe `infected` non
téléchargeable (preuve n° 9) ; empreinte de repli testée ». **Les quatre sont tenues.** L'unité
reste `[~]` pour les écarts ci-dessus, tous nommés et tous portés par une unité identifiée.

*Limites nommées, non masquées.*

- **La relève n'est pas permanente** : elle est déclenchée, donc observable et rejouable. La veille
  appartient à `CRM-059`.
- **Un message non classé n'est lisible par personne** à travers PostgREST : l'inbox globale, qui
  décidera qui voit les non classés, appartient à `CRM-057`. Inventer ici une règle que l'unité
  suivante devrait défaire serait pire que l'absence, et une assertion le fige.
- **Aucune purge** : un message ingéré reste, et sa suppression relève d'une unité RGPD.

### CRM-055 — Classement assisté `[~]`
Les quatre règles, dont la suggestion non classante.
**DoD** : pytest par règle ; E2E de classement manuel ; si `CRM-060` n'est pas livré, règle 3
désactivée et documentée comme telle.

- [x] **Spécification écrite avant toute ligne de code**, `docs/SPEC-mail-subsystem.md` §16.
- [x] **La règle 3 est DÉSACTIVÉE, et la Definition of Done le prévoit** : elle suppose des
      contacts, qu'aucune table ne porte (`CRM-060`). Elle ne classe pas, elle **suggère**, et une
      suggestion fondée sur rien serait pire qu'aucune suggestion. L'absence est **figée par une
      assertion**, non commentée.
- [x] **Les règles 1, 2 et 4 sont livrées** : `supabase/migrations/0025_classement_messages.sql`.
      La chaîne s'arrête à la **première règle satisfaite**, ce qui rend le classement
      déterministe : un message adressé à une card et répondant à un message d'une autre a une
      destination unique et prévisible.
- [x] **UNE ADRESSE SE RECONNAÎT À SA FORME ET À SON DOMAINE**, et trois assertions le mesurent :
      la forme seule laisserait un correspondant écrire à `c-abcd1234@son-domaine.tld` sans que
      cela désigne quoi que ce soit ; le domaine seul laisserait passer `contact@crm.p2enjoy.test`.
      La casse, elle, n'a pas d'importance.
- [x] **UNE CARD ARCHIVÉE OU EN CORBEILLE NE REÇOIT PAS** : classer dans une card qu'on a rangée y
      ramènerait du courrier. La règle 2 **hérite** de ce refus, faute de quoi la filiation le
      contournerait.
- [x] **`classify_message` est livrée** : elle exige le droit d'**écriture** — classer un message y
      ajoute du contenu —, journalise son auteur, écrit un `card_event` `mail_received`, et reste
      **idempotente** : un utilisateur qui clique deux fois ne raconte pas deux histoires.
- [x] **Un classement automatique n'a PAS d'auteur** : `classified_by` reste nul. Prétendre le
      contraire attribuerait un geste à quelqu'un.
- [x] **Le classement automatique n'est pas offert au client** : c'est un constat de la relève, et
      l'exposer laisserait un client déclarer qu'une règle s'est appliquée alors qu'elle ne l'a pas
      fait.
- [x] **Suite pgTAP dédiée** : `supabase/tests/0027_classement_messages.test.sql`, **20 assertions**.
- [x] **Preuve d'API dédiée** : `e2e/api/classement.spec.ts`, **3 scénarios**, dont le refus opposé
      au `viewer` avec son jeton réel, et le fait qu'un message **devient lisible** en étant classé.
- [x] **Preuve `mail`** : un vrai email adressé à l'adresse d'une vraie card y est classé
      **automatiquement**, et sa trace apparaît dans la timeline.
- [x] **QUATRE ASSERTIONS ANTÉRIEURES ONT DÉNONCÉ L'EXTENSION DU VOCABULAIRE** — dixième occurrence
      du mécanisme de la décision 51. `0018`, `0019` et `0022` figeaient le refus de
      `mail_received` ; elles sont **révisées, non retirées**, et figent désormais `mail_sent`, que
      `CRM-058` devra écrire.
- [x] **UN DÉFAUT DE MES PROPRES PREUVES, ET IL SE CROYAIT PROPRE** : deux scénarios prétendaient
      retirer l'événement de timeline qu'ils avaient créé. `card_events` n'accorde **aucune**
      écriture, `service_role` compris (`CRM-044`) : le `DELETE` était refusé en silence, et le
      scénario croyait nettoyer ce qu'il laissait derrière lui. L'historique ne se corrige pas —
      les preuves le disent maintenant au lieu de l'ignorer.
- [x] **Un second défaut du harnais** : une dégradation qui ne s'applique pas faisait **mourir le
      script** sous `set -e`, au milieu de sa section la plus importante et sans rien signaler.
      Elle est désormais rapportée comme un échec, et la restauration aussi.
- [x] **Harnais dédié** `scripts/verify-mail-classement.sh` : **22 contrôles, aucune anomalie**,
      témoin et trois dégradations comprises.
- [x] **Compteurs révisés** : 26 → **27** fichiers SQL, 1823 → **1843** assertions,
      466 → **469** scénarios d'API, 34 → **35** scénarios `mail`.
- [ ] **LA RÈGLE 3 N'EST PAS LIVRÉE**, et la Definition of Done le prévoit : elle suppose des
      contacts (`CRM-060`). Son absence est **figée par une assertion** qui devra tomber ce
      jour-là.
- [ ] **Aucun écran** (`CRM-057`), et **aucun déclassement** : rien dans le §4.4 ne le décrit, et
      l'inventer obligerait à décider ce que devient l'événement déjà écrit — une question qui
      appartient à l'unité livrant l'écran.

*DoD adaptée, écarts explicites.* La Definition of Done demandait « pytest par règle ; E2E de
classement manuel ; si `CRM-060` n'est pas livré, règle 3 désactivée et documentée comme telle ».
**Les trois sont tenues** — la preuve « par règle » vit en pgTAP plutôt qu'en pytest, parce que les
règles vivent en base et non dans le service, ce qui est le choix d'architecture du produit depuis
`CRM-010`. L'unité reste `[~]` pour les deux écarts ci-dessus.

### CRM-056 — Dossiers IMAP imbriqués `[~]`
Création, assainissement, renommage, labels Gmail, `mail_folder_map`.
**DoD** : intégration vérifiant l'arborescence **par un client IMAP** ; observation visuelle dans
Roundcube ; renommage d'un track propageant le renommage du dossier.

- [x] **Mesures faites avant toute ligne de code**, `docs/SPEC-mail-subsystem.md` §17.1 : le
      délimiteur est `/`, chaque niveau se crée séparément, le renommage **emporte les enfants**,
      et le serveur **n'assainit pas** à notre place — une contre-oblique passe.
- [x] **UNE MESURE A ÉTÉ CORRIGÉE PAR LA SUIVANTE, ET LES DEUX SONT ÉCRITES.** Lu avec `imaplib`,
      `CRM/Conseil & IA` revient `CRM/Conseil &- IA` — UTF-7 modifié de la RFC 3501. Lu avec
      **IMAPClient**, la bibliothèque que le produit emploie, il revient intact. Le ré-encodage est
      une propriété **du fil**, pas du serveur. Mesurer avec un outil que le produit n'emploie pas
      conduit à écrire une règle qui ne le concerne pas.
- [x] **`mail_folder_map` reste nécessaire, pour la vraie raison** : le chemin est dérivé de noms
      que l'utilisateur peut changer, et l'assainissement les fait déjà diverger — « A/B » donne
      « A B ». Sans correspondance, le produit ne saurait plus quel dossier renommer.
- [x] **La table, l'assainissement et le chemin dérivé sont livrés** :
      `supabase/migrations/0026_dossiers_imap.sql`. Le délimiteur est remplacé par une espace et non
      retiré en silence — « A/B » reste lisible —, et un nom vide devient `sans-nom` plutôt que de
      produire un segment vide.
- [x] **La création paresseuse et la COPIE sont livrées** : après classement, l'arborescence
      `CRM/<Track>/<Channel>/<Card>` est créée niveau par niveau, le chemin réel **relu**, la
      correspondance écrite, et le message **copié** — jamais déplacé. Mesuré de bout en bout : un
      vrai email a créé `CRM/Conseil & IA/Grands comptes/Audit sécurité applicative`.
- [x] **Les labels Gmail écartent le modèle de dossiers**, et la détection est **positive sur
      l'inadaptation** : un serveur inconnu est traité comme un serveur à dossiers, ce qui est le
      cas général. Supposer l'inverse priverait de classement tout serveur que le produit ne
      connaît pas encore.
- [x] **Le dossier suit le classement, et ne le conditionne pas** : un dossier qu'on ne sait pas
      créer n'empêche pas un message d'être rangé en base. La copie est un confort d'exploitation,
      le classement est le fait.
- [x] **Preuves unitaires** : `mail-sync/tests/test_dossiers.py`, **13 tests**, dont le ré-encodage
      simulé, la copie qui n'est jamais un déplacement, le serveur à labels, et le renommage qui
      emporte les enfants.
- [x] **Le renommage propagé est livré, et il est prouvé sur le vrai serveur** : renommer une card
      renomme son dossier, et la correspondance suit. **La base dit ce qui a divergé, le service
      renomme** — elle ne parle pas IMAP, et le chemin souhaité est **recalculé**, jamais mémorisé
      à part : une troisième copie du nom divergerait à son tour.
- [x] **LE RENOMMAGE PRÉCÈDE LA RELÈVE**, et l'ordre compte : renommer après coup laisserait les
      messages du passage dans l'ancien chemin, et l'arborescence divergerait pour de bon.
- [x] **Les parents du nouveau chemin sont créés avant le `RENAME`** : renommer vers
      `CRM/Nouveau track/Channel/Card` échoue si `CRM/Nouveau track` n'existe pas.
- [x] **Un renommage refusé rend `None` plutôt qu'un chemin optimiste** : écrire une correspondance
      vers un dossier inexistant rendrait tout classement ultérieur silencieusement inutile.
- [x] **L'ARBORESCENCE EST VÉRIFIÉE PAR UN CLIENT IMAP TIERS** — `e2e/mail/dossiers.spec.ts`,
      2 scénarios. Le client vit dans un conteneur jetable, il n'est ni le service ni sa connexion,
      et il **décode l'UTF-7 modifié** lui-même : un client qui ne décode pas ne vérifie que le fil.
      Deux bibliothèques différentes ne se trompent pas de la même façon.
- [x] **LE MESSAGE EST COPIÉ, ET RESTE DANS `INBOX`** — mesuré dans les deux dossiers. Retirer un
      message de la boîte de quelqu'un serait destructif, et le §4.5 l'écrit.
- [x] **OBSERVATION VISUELLE DANS ROUNDCUBE**, que la Definition of Done exige :
      `e2e/mail/roundcube-dossiers.spec.ts` ouvre une vraie session à la souris et au clavier, lit
      les **trois niveaux** avec leurs vrais noms, ouvre le dossier de la card et y trouve le
      message. Deux captures observées.
- [x] **UN DÉFAUT TROUVÉ PAR L'ŒIL, ET PAR LUI SEUL : LES DOSSIERS ÉTAIENT INVISIBLES.** Créer un
      dossier ne suffit pas — un client de messagerie n'affiche que les dossiers **souscrits**
      (RFC 3501 §6.3.6). L'arborescence existait côté serveur, l'API la voyait, et l'utilisateur
      n'en voyait rien. Un rangement que personne ne voit ne range rien. `SUBSCRIBE` suit désormais
      chaque création **et** chaque renommage — le renommage ne transporte pas la souscription.
- [x] **UN SECOND DÉFAUT, DANS MA PROPRE PREUVE** : Roundcube colle le compteur de messages non lus
      **dans** le lien du dossier — « Inbox12 ». Un `exact: true` ne résolvait jamais, et le
      scénario expirait au bout de cinq minutes **sans rien dire**. Un test qui expire sans
      diagnostic est pire qu'un test absent.
- [x] **Le renommage propagé couvre les TROIS niveaux** : la correspondance mémorise le track, le
      channel et la card, et la divergence est traitée **du plus haut au plus bas**. Un seul
      `RENAME` suffit alors — mesuré : `renamed = 1` pour trois dossiers déplacés.
- [x] **Un renommage refusé est DIT** : un dossier de destination qui existe déjà bloquerait la
      boucle indéfiniment, et un arrêt muet serait un blocage permanent invisible.
- [x] **Suite pgTAP dédiée** : `supabase/tests/0028_dossiers_imap.test.sql`, **18 assertions**.
- [x] **Harnais dédié** `scripts/verify-mail-dossiers.sh` : **37 contrôles, aucune anomalie**,
      témoin et trois dégradations comprises — dont la souscription retirée et la copie devenue un
      déplacement.
- [x] **Compteurs révisés** : 27 → **28** fichiers SQL, 1843 → **1861** assertions,
      35 → **38** scénarios `mail`.
- [ ] **La reprise d'un rangement manqué n'est pas livrée** : le rangement est tenté à la
      **première** vue d'un message, et un refus est journalisé sans être rejoué. La reprise
      appartient à `CRM-059`.

*DoD adaptée, écarts explicites.* La Definition of Done demandait « intégration vérifiant
l'arborescence **par un client IMAP** ; observation visuelle dans Roundcube ; renommage d'un track
propageant le renommage du dossier ». **Les trois sont tenues.** L'unité reste `[~]` pour le seul
écart ci-dessus, porté par une unité nommée.

*Limites nommées, non masquées.*

- **Aucun écran du produit** ne montre l'arborescence : Roundcube reste le seul moyen de
  vérification visuelle tant que `CRM-057` n'existe pas.
- **Les labels Gmail sont détectés, jamais exercés** : aucun serveur à labels n'existe dans la
  pile de développement, et la détection est éprouvée sur un serveur simulé.
- **Un rangement manqué n'est pas rejoué** (voir ci-dessus).

### CRM-057 — Inbox globale `[~]`
Trois panneaux, arborescence Track → Channel → Card, « Non classés », pile sous 1024 px.
**DoD** : E2E ; captures aux quatre paliers ; message classé visible **à la fois** dans la card
et dans l'inbox.

- [x] **Les trois panneaux sont livrés** : dossiers, liste, message. Sous 1024 px, une **pile** —
      un seul panneau visible, un bouton « Retour » par cran —, non trois colonnes rétrécies.
- [x] **La question laissée ouverte par `CRM-054` est tranchée** : la visibilité d'un message non
      classé est celle de la **boîte** où il a été vu. Aucune notion nouvelle — c'est la règle que
      `mail_message_occurrences` porte depuis `CRM-054`.
- [x] **UN DÉFAUT DE CONTRÔLE D'ACCÈS, ANTÉRIEUR, EST BOUCHÉ** : `classify_message` ne vérifiait
      que le droit d'écriture sur la card cible. Un membre pouvait donc classer **chez lui** un
      message qu'il n'avait pas le droit de lire, puis le lire. Le classement exige désormais les
      **deux** droits, et le refus est mesuré hors interface avec un vrai jeton.
- [x] **LA PREUVE DE REFUS N° 9 EST RÉVISÉE ET RENDUE CONCLUANTE** — dixième occurrence du
      mécanisme de la décision 51. `CRM-054` mesurait le refus sur des objets **jamais déposés** :
      « rien ne se télécharge » y était vrai aussi d'un bucket vide. Quatre objets sont désormais
      réellement déposés ; la pièce **`clean` se télécharge** — témoin, contenu comparé — et
      `infected`, `pending`, `skipped` sont refusées au **même** appelant.
- [x] **Le HTML d'un expéditeur n'atteint jamais le DOM** : le corps est réduit en texte, et
      l'absence de rendu HTML est **figée** par des tests, non commentée. Neuf tests éprouvent la
      réduction sans navigateur, dont le retrait des scripts avec leur contenu.
- [x] **Le seed fait ARRIVER deux vrais messages** (`docs/SPEC-seed.md` §2.19) : soumission SMTP
      authentifiée puis relève réelle, `Message-ID` fixes. L'un est classé par la règle 1, l'autre
      reste non classé. Rien n'est forgé en base.
- [x] **Le fil d'une card nomme le courrier reçu** : `mail_received` cesse d'être un événement sans
      détail et porte l'objet et l'expéditeur. Il rejoint la famille **discussion** — un message est
      une parole. Les deux replis documentés qui l'annonçaient sont **révisés**, non retirés.
- [x] **Suite pgTAP dédiée** : `supabase/tests/0029_inbox_globale.test.sql`, **22 assertions**.
- [x] **Contrat d'API hors interface** : `e2e/api/inbox.spec.ts`, **9 scénarios**, témoin compris.
- [x] **Parcours d'écran au clavier ET à la souris** : `e2e/ui/inbox.spec.ts`, **6 scénarios**, dont
      la double visibilité exigée par la Definition of Done et les **quatre paliers**.
- [x] **TROIS DÉFAUTS TROUVÉS PAR L'ŒIL, PAS PAR LES TESTS** (décision 328) : un bouton de flexbox
      qui refusait de rétrécir et débordait du panneau ; quatre classes d'espacement **inexistantes**
      — l'échelle est fermée — qui disparaissaient en silence et donnaient trois panneaux de 1000 px ;
      une capture prise pendant la transition de la barre latérale.
- [x] **Un `401` de moins dans la console** : la timeline ne demande les messages d'une card que si
      son fil en porte un. La version précédente interrogeait `mail_messages` sur **toutes** les
      fiches et laissait un refus dans la console de chaque preuve à session anonyme.
- [x] **Harnais dédié** `scripts/verify-mail-inbox.sh` : **45 contrôles, aucune anomalie**, témoin
      compris et **quatre** dégradations, dont les deux retraits qui portent la garantie du §18.4.
- [x] **Compteurs de `scripts/verify-harness.sh` révisés** : 28 → **29** fichiers SQL,
      1861 → **1884** assertions, 469 → **478** scénarios d'API, 157 → **163** scénarios d'interface.
- [ ] **Aucun envoi depuis l'inbox** : répondre appartient à `CRM-058`.
- [ ] **Aucune notion de lu / non lu** : rien ne la porte en base, et l'inventer côté client
      donnerait un état faux dès la seconde session.
- [ ] **Aucun rôle de tri** : un membre ordinaire ne voit **aucun** message non classé. L'absence
      est **figée** par une assertion pgTAP et par un scénario d'API, à réviser le jour où un tel
      rôle existera.

*DoD adaptée, écarts explicites.* La Definition of Done demandait « E2E ; captures aux quatre
paliers ; message classé visible à la fois dans la card et dans l'inbox ». **Les trois sont
tenues.** L'unité reste `[~]` pour les écarts ci-dessus, tous nommés et tous portés par une unité
identifiée ou par une absence figée.

*Spécifiée avant d'être écrite* — `docs/SPEC-mail-subsystem.md` §18, `docs/JOURNAL.md` décision 327.
Ce qui est **déjà tranché**, et ne le sera pas pendant l'implémentation :

- **Qui voit un message non classé** : la boîte où il a été vu — son propriétaire, ou un
  administrateur du workspace. Aucune notion nouvelle ; c'est la règle que
  `mail_message_occurrences` porte depuis `CRM-054`. Un membre ordinaire n'en voit aucun, et
  l'absence de rôle de tri est **figée par une assertion**, non commentée.
- **Classer exigera les deux droits** — voir le message **et** écrire dans la card. `CRM-055` ne
  vérifiait que le second, ce qui laissait classer chez soi un message illisible pour le lire
  ensuite. Le trou est nommé avant d'être bouché.
- **La pièce jointe saine devient téléchargeable**, et la preuve de refus n° 9 sera **révisée, non
  retirée** — dixième occurrence du mécanisme de la décision 51. `pending`, `infected` et `skipped`
  restent refusés à tous.
- **Aucun rendu HTML** : le corps affiché est du texte. Injecter le HTML d'un expéditeur inconnu
  lui offrirait scripts, images distantes et pistage à l'ouverture.
- **Le seed enverra deux vrais messages** puis déclenchera une vraie relève : un écran vide ne
  démontre rien, et une trace fabriquée est interdite (CLAUDE.md §8).

### CRM-058 — Composition et réponse `[~]`
`queue_outbound_email`, `smtp_worker`, `Reply-To` de la card, fil respecté, envoi depuis la card
ou depuis l'inbox par le même chemin.
**DoD** : E2E `mail` d'aller-retour complet ; en-têtes de threading vérifiés sur le message reçu ;
quota et refus testés.

- [x] **L'ALLER-RETOUR COMPLET EST PROUVÉ, SANS AUCUNE SUBSTITUTION** : le produit met en file par
      sa vraie garde, son worker soumet réellement en SMTP authentifié, le destinataire **reçoit
      dans sa boîte**, répond à l'adresse du `Reply-To`, et la relève ramène cette réponse **dans la
      même card**. Un `Reply-To` faux rendrait ce scénario rouge.
- [x] **La file `mail_outbox` et sa garde** : six refus, dans l'ordre où elle les oppose. Aucune
      écriture n'est ouverte au client, ni dans la table, ni par les trois fonctions du worker.
- [x] **Les trois effets d'un envoi réussi sont SOLIDAIRES** — file marquée, message archivé en
      `outbound`, timeline écrite. Trois écritures séparées laisseraient, à la première coupure, un
      message parti dont la card ne garde aucune trace.
- [x] **La composition vit hors du réseau** : **10 tests** éprouvent sans serveur les trois
      garanties que le transport ne tient pas — identifiant choisi, `Reply-To` de la card, chaîne
      `References` complète et dédoublonnée.
- [x] **Écrire depuis la card et répondre depuis l'inbox empruntent le MÊME composant** (§19.6).
      Un message non classé n'offre pas de réponse : sans affaire, pas d'adresse de retour.
- [x] **LA PREUVE DE REFUS N° 12 EST ACQUISE** : envoyer avec l'identité d'autrui est refusé, mesuré
      hors interface. L'inventaire passe à « **onze acquises, une à moitié** ».
- [x] **UN DÉFAUT DE `CRM-053` EST CORRIGÉ** : `daily_quota` valait `0` par défaut, ce qui
      interdisait **tout** envoi dès qu'un consommateur existait. `NULL` signifie désormais « aucun
      plafond » ; `0` garde son sens littéral.
- [x] **INC-087 est CLOSE** : `contact@p2enjoy.test` rejoint le principal de Driss, ce qui rend
      applicable la divergence entrant/sortant promise depuis `CRM-053`.
- [x] **Un refus ne ressemble pas à une panne** : `identity_not_available` portait `P0002`, traduit
      par PostgREST en **500**. Il porte `42501`, donc `403` — mesuré.
- [x] **La liste des adresses d'expédition ne propose plus ce que la garde refuserait** : la RLS
      ouvre la **lecture** aux administrateurs sur tout le workspace, ce qui est une règle de
      supervision et non d'usage.
- [x] **Suite pgTAP dédiée** : `supabase/tests/0030_envoi_sortant.test.sql`, **21 assertions**.
- [x] **Contrat d'API hors interface** : `e2e/api/envoi.spec.ts`, **8 scénarios**.
- [x] **Parcours d'écran** : `e2e/ui/envoi.spec.ts`, **4 scénarios**, deux captures observées.
- [x] **Quatre témoins figés retournés** : trois annonçaient « `mail_sent` reste refusé », le
      quatrième exigeait que l'énumération soit étendue dans la même migration que son écriture.
- [ ] **Aucun backoff, aucune reprise** : un échec est `failed` et le dit. `CRM-059`.
- [ ] **Aucune pièce jointe à l'envoi**, aucune signature, aucune copie cachée — absences figées.
- [ ] **Harnais dédié `scripts/verify-mail-envoi.sh`** : dû avant le passage à `[x]`.

*DoD adaptée, écarts explicites.* La Definition of Done demandait « E2E `mail` d'aller-retour
complet ; en-têtes de threading vérifiés sur le message reçu ; quota et refus testés ». **Les trois
sont tenues.** L'unité reste `[~]` pour les écarts ci-dessus.

*Spécifiée avant d'être écrite* — `docs/SPEC-mail-subsystem.md` §19, `docs/JOURNAL.md` décision 330.
Ce qui est **déjà mesuré**, et ne sera pas redécouvert pendant l'implémentation :

- **Le serveur ne réécrit pas le `Message-ID`** : le produit choisit le sien et le mémorise, ce qui
  fait de lui la charnière du fil pour la règle 2 du §4.4.
- **Le `Reply-To` n'est vérifié par personne d'autre que nous** — il passe même vers une adresse de
  card inexistante. Sa justesse est une responsabilité entière du produit.
- **INC-087 est CLOSE** : un principal ne peut expédier que depuis ses propres adresses
  (`501 5.5.4`, mesuré), et `contact@p2enjoy.test` rejoint le principal de Driss. La divergence
  entrant/sortant promise depuis `CRM-053` devient applicable.
- **Deux colonnes manquent à `mail_messages`** : `direction`, sans quoi un message écrit serait
  montré comme reçu, et `references_ids`, sans quoi une réponse couperait le fil au deuxième
  aller-retour.
- **Le quota se compte sur la journée UTC**, sur les lignes `queued`, `sending` **et** `sent` :
  compter les seuls envois réussis laisserait mettre mille messages en file. Il est vérifié deux
  fois — à la mise en file par politesse, à l'envoi par autorité.
- **Le backoff n'appartient pas à cette unité** : `CRM-059` le revendique. Un échec passe `failed`
  et le dit.

### CRM-059 — Backfill, résilience, supervision `[x]`
> **RÉTROGRADÉE DE `[x]` À `[~]` LE 2026-08-12, SUR PREUVE ROUGE.** Le scénario
> `e2e/mail/backfill.spec.ts` — « un premier contact ne descend jamais l'historique, même déjà
> présent et autorisé » — **échoue** : les trois archives de 90 jours descendent dès la première
> relève, en même temps que le courrier du jour, alors que le §20.6 exige « la boîte courante
> d'abord, puis un lot d'historique borné — jamais l'inverse ».
>
> **La prémisse de la preuve a été vérifiée** : mesuré le 2026-08-12, Stalwart **conserve**
> l'`INTERNALDATE` passée d'un `APPEND` — un message déposé à 90 jours est relu `15-May-2026`. La
> preuve mesure donc bien le produit, et non le serveur.
>
> **CORRIGÉ LE 2026-08-14 — LE COUPABLE N'EST PAS ÉTABLI** (décision 368, écrite sous le numéro 341
> et renumérotée le 2026-08-14). L'exécution qui a rendu
> la preuve rouge s'est faite sur une pile **incomplète** : `rest`, `mail-sync` et `webapp` étaient
> absents et l'API répondait `000`. Et la relecture du code ne montre pas le défaut annoncé —
> `planifier_dossier` traite bien le premier contact en `SEARCH SINCE <aujourd'hui>`, et le
> `search(["ALL"])` qui rapatriait toute la boîte a été retiré.
>
> Ce qui reste : une preuve vue rouge ne redevient verte que **rejouée**. L'unité reste donc `[~]`,
> **bloquée par une dépendance** — le rejeu exige la pile, donc le démon Docker, qui sur ce poste
> vit dans Docker Desktop côté Windows et **nécessite une action humaine** pour démarrer.
>
> Une unité dont une preuve de sa propre Definition of Done est rouge ne peut pas rester `[x]`.
>
> **REJOUÉE ET VERTE LE 2026-08-14, SUR PILE COMPLÈTE VÉRIFIÉE AVANT LA MESURE** (décision 369).
> La complétude a été établie **d'abord**, ce que l'exécution du 12 n'avait pas fait : `docker
> compose ps` rendait **17 services sur 17 `healthy`** — le dix-huitième était Supavisor, retiré par
> la décision 366 — et le seed a été appliqué (`apply-seed.sh`, `EXIT=0`). Puis :
>
> | Preuve | Résultat mesuré |
> |---|---|
> | `e2e/mail/backfill.spec.ts` (le scénario rouge du 12) | **1 passed** — « un premier contact ne descend jamais l'historique » |
> | `npm run e2e:mail` (suite entière) | **42 passed** |
> | `pytest mail-sync/tests` | **242 passed** |
> | `scripts/verify-mail-resilience.sh` | **56 contrôles, aucune anomalie** — dont backoff, coupure SMTP réelle, écran d'état, et cinq mutations de non-complaisance qui rougissent bien |
> | `npm run typecheck` / `test:unit` / `build` | verts — 741 tests unitaires |
>
> **La décision 368 est donc confirmée par la mesure** : la preuve rouge du 12 août était imputable
> à l'environnement de sa mesure, non au produit. Le backfill borne bien sa première passe.
>
> **L'UNITÉ RESTE POURTANT `[~]`, ET POUR UNE SEULE RAISON QUI LUI APPARTIENT — INC-091.**
> `npm run test:sql` rend **33 fichiers, 1 en échec** : `0029_inbox_globale.test.sql`, assertion 9,
> « ABSENCE FIGÉE : un membre ordinaire ne voit AUCUN non classé » — `have: 4`, `want: 0`. Ce n'est
> pas un défaut étranger que l'unité pourrait renvoyer ailleurs : INC-091 s'intitule « **la veille
> permanente de `CRM-059`** transforme tout envoi de preuve vers une boîte seedée en message non
> classé permanent ». La boucle de veille livrée par cette unité relève désormais tous les comptes,
> et remonte ce que `e2e/mail/resilience.spec.ts` (`CRM-059`) et `e2e/mail/infrastructure.spec.ts`
> (`CRM-050`) laissent dans une boîte IMAP **réelle** — leur `finally` supprime la ligne en base,
> jamais le message dans la boîte, et rend donc `204` en n'effaçant rien.
>
> L'arbitrage est rendu depuis la décision 362 et n'attend que la pile, laquelle est là : chaque
> preuve qui adresse un envoi réel à une boîte seedée **purge ce qu'elle y a déposé**, dans son
> propre `finally`, par le chemin IMAP de `retirerDeLaBoite`. L'assertion 9 **reste armée sur la
> table entière** — elle a vu une fuite que rien d'autre ne voyait, et la désarmer serait corriger
> le défaut en supprimant son détecteur (`CLAUDE.md` §18).
>
> **INC-091 EST LIVRÉE ET CONTRE-ÉPROUVÉE LE MÊME JOUR ; L'UNITÉ REVIENT À `[x]`** (décision 371).
> La fuite a d'abord été **reproduite et chiffrée** avant d'être corrigée : sur un conteneur neuf,
> deux exécutions de `npm run e2e:mail` avaient laissé **exactement six** messages — « Coupure » ×2
> et « Orphelin » ×2 (`resilience.spec.ts`), « Preuve CRM-050 » ×2 (`infrastructure.spec.ts`) —,
> soit deux scénarios × deux passages par fichier. Le compte correspond à la cause, sans reste.
>
> `retirerDeLaBoite` est écrite dans `e2e/mail/protocoles.ts`, en `node:net` et **sans aucune
> bibliothèque** (décision 238), et balaie **tous** les dossiers de la boîte et non le seul `INBOX`
> — entre le dépôt et la purge, la veille a pu ranger le message dans le dossier de sa card.
>
> | Contre-épreuve | Résultat mesuré |
> |---|---|
> | `npm run test:sql` après purge des débris | **33 fichiers, 1944 assertions, aucune anomalie** — `0029` : 22 assertions |
> | `npm run e2e:mail` rejouée avec la purge en place | **42 passed** |
> | débris laissés en base par ce rejeu | **AUCUN** |
> | débris laissés dans les deux boîtes IMAP réelles | **0** chez Driss, **0** dans la boîte système |
> | `npm run test:sql` APRÈS ce rejeu | **1944 assertions, aucune anomalie** |
>
> C'est cette dernière ligne qui ferme l'entrée : la fuite ne revient pas après un cycle complet.
> Nettoyer les débris sans corriger la cause aurait rendu `0029` vert au premier `test:sql` et
> rouge au suivant.
>
> **CE QUI RESTE OUVERT, ET QUI N'EST PAS CETTE UNITÉ — INC-092.** Le lot B n'est pas soldé pour
> autant : INC-092 est un **journal**, pas une donnée — un `WARNING` légitime produit quand la
> veille relève le compte de Driss pendant que `comptes-entrants.spec.ts` y pose délibérément un
> mot de passe faux. Aucune purge ne l'empêche. `e2e:mail` a été rejouée **trois fois** ce jour,
> 42 verts à chaque passage, S3 compris : ce n'est pas une correction, c'est la mesure que la
> fenêtre de course ne s'est pas ouverte. Le choix de conception appartient au responsable.
Import historique par lots, file persistante, backoff, états visibles.
**DoD** : pytest sur le backoff ; coupure SMTP simulée sans perte de message ; état affiché
conforme à la réalité.

*Spécifiée avant d'être écrite* — `docs/SPEC-mail-subsystem.md` §20, `docs/JOURNAL.md` décision 331.
Ce qui est **déjà mesuré ou tranché** :

- **`UID SEARCH SINCE` est honoré par le serveur** : le backfill est une sélection, pas un tri.
  Rapatrier toute la boîte pour ignorer ce qui dépasse ferait payer au réseau ce que le serveur
  sait faire. **LIVRÉ** — `mail-sync/src/mail_sync/backfill.py`, spécifié avant le code en
  `docs/SPEC-mail-subsystem.md` §20.6 bis (décision 342). `search(["ALL"])` a disparu de la relève :
  deux passes, le **courant d'abord** puis un lot d'historique borné à 200, la progression tenue par
  `sync_state` sous forme de **plage** `{uid_min, uid_max}` et non d'un seul UID. Un premier contact
  descend le **courrier du jour**, jamais la boîte entière. **48 assertions pytest vertes** — 39 sur
  le plan, 9 sur la relève, qui gagne ainsi son **premier test unitaire** —, non complaisantes :
  cinq mutations font toutes rougir la suite. **La passe d'historique elle-même est désormais
  exercée de bout en bout** — `e2e/mail/backfill.spec.ts`, `docs/JOURNAL.md` décision 352 : trois
  messages déposés par `APPEND` IMAP daté (RFC 3501 §6.3.11, la commande que le protocole prévoit
  pour porter une date d'origine — mesuré, Stalwart la restitue fidèlement) dans la boîte de Driss,
  `backfill_months` porté à 6 par le vrai chemin d'écriture, puis un message du jour envoyé par
  SMTP réel. Le premier contact est mesuré pour NE PAS descendre l'historique, et la relève
  suivante le reprend intégralement — la relève rejouée confirme l'idempotence.
- **`IDLE` est annoncé, et ne sera PAS employé ici** : une connexion permanente par compte est un
  état de plus à superviser, là où une scrutation déclarée est observable et rejouable. Le passage
  à `IDLE` demandera sa propre mesure.
- **`MAIL_SYNC_POLL_INTERVAL` est déclarée et consommée par rien** depuis `CRM-051` : une variable
  documentée que rien ne lit est une promesse tenue par personne. La boucle de veille la prend.
  **LIVRÉ** — `mail-sync/src/mail_sync/veille.py`, spécifié avant le code en
  `docs/SPEC-mail-subsystem.md` §20.10 (décision 341). La décision — quels comptes, dans quel ordre,
  quel délai — est **pure** et se prouve **sans dormir une seule fois** ; seul le pilote attend, sur
  un `threading.Event` qu'un arrêt interrompt. `0` désactive explicitement, les bornes sont 5 s et
  1 h, et une valeur hors bornes **refuse le démarrage** au lieu d'être corrigée en silence.
  Un compte en panne est journalisé — son **type**, jamais son texte — puis absorbé, et le tour
  continue. **31 assertions pytest vertes** (25 sur la veille, 6 sur la configuration), non
  complaisantes : quatre mutations — délai à fréquence fixe, texte de l'exception journalisé, panne
  qui interrompt le tour, comptes sans secret non écartés — font toutes rougir la suite.
- **Un refus ne se rejoue pas** : `auth_failed` et un destinataire refusé passent `failed`
  immédiatement. Seules les pannes de transport sont reprogrammées — rejouer un refus, c'est
  répéter une erreur en espérant un autre résultat.
- **Le backoff est géométrique ET borné** : 1, 4, 16, 64 minutes, puis `failed`. Sans progression,
  un serveur en panne serait harcelé ; sans borne, un message adressé à un domaine disparu
  resterait en file pour toujours.
- **Un envoi `sending` depuis plus de dix minutes est orphelin** et repasse `queued`. Le seuil est
  généreux à dessein : un envoi lent n'est pas un envoi mort, et reprendre trop tôt enverrait le
  message deux fois.
- **La dette de `CRM-056` est réglée ici** : un rangement manqué est repris à la relève suivante,
  sans qu'il faille recevoir un nouveau message pour la déclencher.
  **LIVRÉ** — `mail_messages.filed_at` dit QUAND un message a été copié, jamais quand il a été
  classé ; `messages_a_ranger` (migration 32) rend les messages classés et non rangés d'un compte,
  avec l'occurrence la plus ancienne ; `marquer_message_range` ferme le fait uniquement après une
  copie IMAP réussie. `mail_sync/ingestion.reprendre_rangements_manques` appelle la MÊME primitive
  que la classification, sans en inventer une seconde, sur tout le compte — pas seulement les
  dossiers surveillés du tour courant. **12 assertions pgTAP** (suite complète 1933, verte) et
  **5 assertions pytest** (suite complète 192, verte), non complaisantes : deux mutations — marquer
  le fait sans condition de succès — font rougir exactement les deux assertions qui protègent cette
  règle. `docs/JOURNAL.md` décision 342.
- **Un défaut bloquant TOUT envoi a été trouvé et corrigé en tentant de rejouer la preuve
  ci-dessous** — `docs/JOURNAL.md` décision 347. `upsert_mail_outbound_identity` réinstallait
  `daily_quota = 0` (interdiction totale) à chaque appel sans plafond précisé, alors que la
  migration `0030` avait établi `NULL` (aucun plafond) comme défaut : sa branche `INSERT`, écrite
  par `CRM-053` et jamais retouchée, gardait `coalesce(p_daily_quota, 0)`. Chaque réapplication du
  seed — donc chaque exécution de cette tâche planifiée — réinstallait le blocage. **LIVRÉ** —
  migration `0033`, une ligne changée. **4 assertions pgTAP** dédiées
  (`supabase/tests/0033_quota_par_defaut.test.sql`), suite complète rejouée : **33 fichiers, 1937
  assertions, aucune anomalie**.
- **« Une coupure SMTP réelle » (§20.8) est PROUVÉE** — `e2e/mail/resilience.spec.ts`, déjà écrit,
  rejoué avec succès une fois le défaut ci-dessus corrigé et le seed réappliqué : **2 scénarios
  verts**, coupure et reprise, orphelin repris. `e2e/mail/envoi.spec.ts` (`CRM-058`) rejoué sans
  régression.
- **L'écran d'état — §20.11, décision 346 — est LIVRÉ** : `webapp/src/lib/mail-etat.ts` (deux
  lectures, aucune politique nouvelle) et `webapp/src/app/EtatMessagerie.tsx` à
  `/reglages/messagerie`, index de réglages étendu. Tableau des comptes conforme à
  `docs/DESIGN_SYSTEM.md` §5.9, dictionnaire fermé des six codes d'incident, deux compteurs sobres
  sur la file sortante. **45 assertions unitaires** (lib + écran + routage). **L'API de lecture
  d'un compte (« lisible par son propriétaire et un administrateur, par personne d'autre ») était
  déjà prouvée par `e2e/api/comptes-entrants.spec.ts` (`CRM-052`) et a été rejouée ici : 11
  scénarios verts, aucune règle inventée.** `e2e/ui/etat-messagerie.spec.ts` : **6 scénarios
  verts** au clavier et à la souris, incident produit par la clé de service puis rendu au seed,
  refus du non-administrateur mesuré par l'état vide. **Captures aux quatre paliers, observées** —
  `docs/captures/CRM-059/`.
- **Les six preuves du tableau §20.8 sont TOUTES vertes**, et le harnais qui les rejoue est LIVRÉ —
  `scripts/verify-mail-resilience.sh`, **56 contrôles, aucune anomalie**, non complaisant : trois
  dégradations réelles (le backoff cesse de progresser, sa borne disparaît, le filtre « en
  attente » perd `sending`) font toutes rougir la suite avant restauration. pytest sur tout
  `mail-sync/tests` (**240 assertions**), pgTAP sur `0031`/`0032`/`0033` (**30 assertions**), API
  réutilisée de `CRM-052`, E2E `mail` (coupure SMTP réelle), E2E `ui` (écran d'état) — les cinq
  rejoués dans le même passage.
- **Un défaut d'amorçage a été trouvé et corrigé en vérifiant cette unité** — `docs/JOURNAL.md`
  décision 351. `mail-sync` ne déclarait `depends_on` ni sur `kong` ni sur `rest` : sur un
  amorçage à froid, la boucle de veille pouvait démarrer avant que l'API ne réponde, et son
  premier tour journalisait `veille_source_indisponible` en `WARNING` — la console cessait alors
  d'être silencieuse (§20.10, `e2e/mail/mail-sync.spec.ts` S3), sans que le compte soit réellement
  en panne. **Corrigé** dans `docker-compose.yml` : `mail-sync` attend désormais `kong` et `rest`
  sains. Rejoué deux fois sur un amorçage à froid : **zéro** `WARNING`, **42 scénarios** `e2e:mail`
  verts à chaque passage.
- **DERNIER ÉCART SOLDÉ** : la passe historique du backfill (§20.6 bis.3, second passage) est
  désormais exercée par une relève réelle — voir l'alinéa `UID SEARCH SINCE` ci-dessus et
  `docs/JOURNAL.md` décision 352. Deux défauts de fuite entre preuves, révélés au passage par
  cette vérification, sont consignés sans être résolus — INC-091 et INC-092
  (`docs/INCONSISTENCY_REPORT.md`) : ni l'un ni l'autre ne porte sur un comportement de `CRM-059`
  elle-même — la veille permanente qu'elle livre est correcte —, et leur correction touche des
  preuves étrangères à cette unité.

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
| CRM-070 | Administration des permissions fines **et invitation d'un membre** | `[ ]` |
| CRM-071 | Vues sauvegardées et import CSV | `[ ]` |
| CRM-072 | Journal d'audit consultable et conformité RGPD | `[ ]` |
| CRM-073 | Webhooks sortants signés et jetons d'API | `[ ]` |
| CRM-074 | Aperçu des pièces jointes et extraction de texte | `[ ]` |
| CRM-075 | **Administration des tracks et des channels** | `[x]` |
| CRM-076 | Éditeur administrateur de workflows | `[x]` |
| CRM-077 | Corbeille et restauration des objets métier | `[~]` |
| CRM-078 | Versionnement des workflows et plans de remappage | `[x]` |
| CRM-079 | Onboarding guidé au premier lancement | `[x]` |
| CRM-080 | Sauvegardes chiffrées et restauration prouvée | `[ ]` |
| CRM-081 | Snooze des fils et des cards | `[ ]` |

*`CRM-075` désignait « Snooze des fils et des cards » jusqu'au 2026-08-11. La décision 332 a créé
l'administration de l'arborescence sous ce numéro sans voir qu'il était pris — même mode de
défaillance qu'INC-069, deux décisions sous le numéro 180. **La décision 335 renumérote le snooze
en `CRM-081`** : l'administration est déjà citée par la décision 332, par `CHANGELOG.md`, par
INC-086 et par le corps de ce document, là où le snooze n'existait qu'en ligne de table. Un numéro
d'unité s'attribue désormais en lisant **cette table**, jamais le dernier numéro cité dans le corps
du document.*

### CRM-070 — précision d'arbitrage : l'invitation d'un membre

**Arbitrage du responsable — `docs/JOURNAL.md`, décision 256 (INC-015).** `POST /auth/v1/invite`
exige la clé de service, que la webapp ne doit jamais détenir. Le parcours d'invitation est
**rattaché à cette unité**, qui traite déjà de la gestion des membres, plutôt que de faire l'objet
d'une unité créée maintenant.

Le motif est explicite : une unité dédiée aurait fait prendre **trois décisions d'architecture d'un
coup** — une table d'invitations absente de `docs/SCHEMA.md`, un appel sortant depuis la base absent
de `docs/DAT.md` §3, et une clé de service à provisionner en Vault — pour servir un geste **rare**,
alors que l'écran de connexion sert un geste quotidien. Assumer définitivement l'invitation comme
une opération d'exploitation était écarté : un CRM où seul un opérateur peut créer un compte n'est
pas un produit.

- [ ] Depuis la décision 260, `CRM-070` pourra s'appuyer sur une **fonction edge** (`CRM-016`)
      plutôt que sur un appel sortant depuis la base par `pg_net`, chemin plus contournant.
- [ ] **Exigence immédiate, qui n'est pas facultative et ne dépend pas de cette unité** : tant que
      le parcours n'est pas livré, le comportement réel — l'invitation est émise par un
      **opérateur** disposant de la clé de service, hors interface — est **nommé explicitement dans
      `docs/manual.md`**, chapitre 17. Un manuel qui décrit un écran qui n'existe pas est un défaut,
      pas une anticipation.
- [ ] **Reste ouvert sciemment** : les trois choix d'architecture ci-dessus sont **reportés, pas
      tranchés**. `CRM-070` devra les prendre explicitement, et INC-014 — les politiques RLS des
      tables d'identité — posera la même question pour l'éventuelle table d'invitations.

---

## Plan de solde du registre — décision 367, 2026-08-13

Les **61 entrées ouvertes** ont chacune reçu une disposition du responsable, lot par lot. Ce tableau
est le plan d'exécution ; le détail des motifs est dans `docs/JOURNAL.md`, décision 367, et les
porteurs dans `docs/ARBITRAGES.md`.

**Contrainte de tête — INC-096, LEVÉE LE 2026-08-14.** Le registre d'images était injoignable :
aucune preuve de pile n'était exécutable, et le responsable retenait de **ne traiter que ce qui se
prouve sans la pile**. Le lot A est **soldé** : le responsable a transmis un jeton d'accès Docker
Hub **hors dépôt**, et la décision 373 mesure que le `429` venait aussi des tirages **parallèles**
de `docker compose`, qu'un tirage séquentiel avec temporisation contourne. Les lots marqués « pile »
sont de nouveau atteignables, à condition que l'exécution reçoive le jeton.

| Lot | Entrées | Disposition | Prouvable maintenant |
|---|---|---|---|
| A | INC-096 | action humaine hors dépôt : identifiants Docker Hub ou miroir de registre | **soldé** le 2026-08-14, décision 373 |
| B | INC-094 | le contrôle des migrations élevées passe à la justification obligatoire | **oui** |
| B | INC-091, INC-092 | chaque preuve purge par IMAP ce qu'elle dépose | pile |
| C | INC-034, INC-059, INC-069, INC-089, INC-097 | verrou d'exécution concurrente et refus d'un numéro de décision déjà pris, dans `.githooks/pre-commit` | **oui**, dépôt jetable |
| D | INC-006, INC-008, INC-017, INC-019 | corriger la documentation contre l'état réel, et clore | **oui** |
| E | INC-095 | écrire les lignes des migrations 31 à 34 et poser la garde dans `verify-migrations.sh` | **oui** |
| F | INC-015, INC-062, INC-066, INC-068, INC-088 | clore : la dette passe dans la DoD de `CRM-070`, `CRM-041`, `CRM-076`, `CRM-069`, `CRM-037` | **oui** |
| G | INC-048, INC-052, INC-071, INC-072 | un chunk unique sur les commentaires : commentaire de transition conservé, blancs Unicode, énoncé de `CRM-043` aligné, suppression ouverte aux `admin` avec audit | pile |
| H | INC-009, 010, 011, 025, 027, 029, 031, 033, 037, 039, 040, 041, 043, 045, 054 | clore les quinze **après vérification contre le code réel**, jamais sur déclaration | **oui** |
| I+J | INC-035, 049, 051, 055, 056, 057, 058, 060, 064, 074 | reprise transverse des harnais ; volet statique (`@verifies`, propriété des preuves) faisable d'abord | partiel |
| K | INC-002, INC-004, INC-018, INC-026, INC-036, INC-082 | clore comme faits établis, chacun inscrit dans sa spécification | **oui** |
| L | INC-070 | détecteur de textes en dur : analyse AST, prouvée dans les deux sens | **oui** |
| L | INC-028, INC-063, INC-065, INC-067 | jetons `*-on-soft`, `alert` réservé à l'erreur, redirection canonique de la card, parseur numérique partagé | pile |
| M | INC-038, INC-053 | clore sur leur porteur, la répartition du §2.3 écrite dans le même geste | **oui** |

**Aucune entrée n'est fermée par déclaration.** Le responsable a écarté, chaque fois qu'elle était
offerte, l'issue qui aurait fait descendre le compteur sans rien réparer.

---

## Dettes ouvertes par les arbitrages du 2026-08-13

Ces quatre arbitrages (`docs/JOURNAL.md`, décisions **362 à 365**) ne créent **aucune unité** : ils
rattachent du travail à des unités existantes ou à la méthode de travail. Chacun reste ouvert au
registre jusqu'à sa livraison **et sa preuve**.

| Porteur | Ce qui est dû | Entrée |
|---|---|---|
| `CRM-059` — `e2e/mail/resilience.spec.ts` | purger **par IMAP** dans le `finally` le message déposé chez Driss. Le `DELETE … subject=like.*objet*` actuel vise la **table** avant tout relèvement, rend `204` et n'efface **rien** : le message réel survit dans la boîte | INC-091 |
| `CRM-050` — `e2e/mail/infrastructure.spec.ts` | même geste sur la boîte système catch-all, que le scénario M2 ne nettoie pas | INC-091, INC-092 |
| les deux ci-dessus | une **contre-épreuve** : la purge doit échouer bruyamment si le message n'est pas dans la boîte, faute de quoi elle serait complaisante comme l'est le `DELETE` actuel | INC-091 |
| `scripts/verify-scripts.sh`, `docs/SCHEMA.md` | le contrôle des migrations élevées passe de l'**énumération** à la **justification obligatoire** en en-tête ; `0018` et `0029` la portent déjà. Une dégradation doit prouver qu'une migration élevée **sans motif** est refusée. La ligne de base 104/3 anomalies doit en perdre une | INC-094 |
| `.githooks/`, `scripts/verify-crochets-git.sh` | deux refus de plus au `pre-commit` : un **numéro de décision déjà pris** dans `docs/JOURNAL.md`, et une **seconde exécution concurrente** (verrou daté, avec expiration). Preuve du même ordre que la décision 358 : dépôt jetable, collision **provoquée** et refusée, voie nominale démontrée encore ouverte | INC-089, INC-097 |
| `CRM-053`, `CRM-056`, `CRM-059` | écrire dans `docs/PROD_MIGRATIONS.md` les lignes de **leurs** migrations 31 à 34 — objectif, dépendances, réversibilité. Elles ne se déduisent pas du SQL : c'est l'unité qui a décidé qui les connaît | INC-095 |
| `scripts/verify-migrations.sh` | un contrôle refusant toute migration absente du contrat de déploiement, posé **avec** le contenu et **jamais avant** — un harnais rouge en attendant reproduirait INC-094 | INC-095 |
| ~~**hors dépôt**~~ | ~~INC-096 : identifiants Docker Hub ou miroir de registre sur le démon~~ — **livré le 2026-08-14** : jeton transmis hors dépôt, tirage séquentiel consigné (décision 373). Les preuves de pile sont exécutables | INC-096, close |

---

## Propositions arbitrées

**Arbitrage autonome du responsable — `docs/JOURNAL.md`, décision 299.** Il n'existe plus de
pseudo-unités suspendues : chaque proposition est intégrée à une unité planifiée ou refusée avec
un motif explicite.

| Proposition | Destination | État de la décision |
|---|---|---|
| CRM-P01 anti-double-prospection | `CRM-060`, alerte non bloquante email/domaine | retenue |
| CRM-P02 score de santé transparent | `CRM-066` | retenue |
| CRM-P03 corbeille/restauration | `CRM-077` | retenue |
| CRM-P04 versionnement/remappage | `CRM-078` | retenue |
| CRM-P05 détection/fusion de contacts | `CRM-060`, avec prévisualisation et audit | retenue |
| CRM-P06 flux ICS révocable | `CRM-061` | retenue |
| CRM-P07 rapport hebdomadaire | `CRM-069`, planifié par `pg_cron` | retenue |
| CRM-P08 écran de revue séparé | préréglage de vues sauvegardées + analytique | refusée comme surface distincte |
| CRM-P09 FR/EN dès la v1 | français canonique, textes centralisés | refusée pour la v1 |
| CRM-P10 onboarding guidé | `CRM-079` | retenue |
| CRM-P11 sauvegarde/restauration | `CRM-080` | retenue |
| CRM-P12 enrichissement automatique | aucun porteur sans base légale, fournisseur et DPA | refusée |

### CRM-075 — Administration des tracks et des channels `[x]`
*Créée le 2026-08-11 par arbitrage du responsable — INC-086, option 2, `docs/JOURNAL.md` décision
332. Elle est le **préalable** de `CRM-076` : un workflow s'affecte à un channel, qui vit dans un
track.*

Écrans d'administration de l'arborescence : **créer**, **renommer**, **réordonner**, **archiver** et
**désarchiver** un track ; les mêmes gestes pour un channel, plus son rattachement à un track et son
workflow.

*Le cinquième verbe a été ajouté le 2026-08-11 par arbitrage du responsable (INC-090, option 1A).
L'énoncé d'origine n'en citait que quatre, alors qu'il justifiait l'absence de suppression par le
fait qu'« archiver masque et reste réversible » : sans le désarchivage, cette phrase décrivait une
propriété de la base et non du produit.*

Le CRUD backend existe déjà et est prouvé depuis `CRM-020` et `CRM-021` — l'écriture y est réservée
aux administrateurs du workspace, et `scripts/verify-tracks.sh` comme `verify-channels.sh` le
mesurent. **Cette unité ne livre donc aucune règle nouvelle** : elle livre la surface qui manquait,
et rien d'autre. Une règle d'accès qui apparaîtrait ici serait le signe qu'elle a été inventée.

**Points déjà tranchés, à ne pas rouvrir :**

- **Aucune suppression.** Ni `tracks` ni `channels` n'exposent de `DELETE`, par décision de
  `CRM-020` et `CRM-021` : archiver masque et reste réversible. L'écran ne proposera donc pas un
  geste que la base refuse.
- **Le réordonnancement écrit `position`**, colonne `numeric` prévue pour cela depuis `CRM-020` et
  déjà alimentée par un trigger lorsqu'elle est omise.
- **Un `viewer` ne voit aucun de ces gestes**, et un membre non administrateur non plus — mais
  c'est une **aide d'interface** : le refus reste celui de la base, et il doit être prouvé hors
  interface (`CLAUDE.md` §10).

**DoD** : E2E au clavier et à la souris — créer un track, le renommer, le réordonner, l'archiver, le
désarchiver, puis les mêmes gestes sur un channel ; captures aux quatre paliers ; refus du `viewer`
et du membre mesuré **hors interface** ; seed inchangé après le passage du scénario ; harnais dédié
non complaisant.

*Spécifiée avant d'être écrite* — `docs/SPEC-administration-arborescence.md`,
`docs/DESIGN_SYSTEM.md` §5.13, `docs/JOURNAL.md` décision 338. Ce qui est **tranché par la
spécification**, et n'a pas à être redécidé pendant l'implémentation :

- **Deux adresses** : `/reglages` devient l'index des sections de réglages, `/reglages/arborescence`
  porte l'écran. Motif : `CRM-070` et `CRM-076` amènent deux autres sections, et une adresse
  partagée ne se déplace pas gratuitement (§3.1).
- **Réordonner écrit UNE position**, calculée par index fractionnaire — le milieu des deux voisines —
  et ne permute jamais deux lignes. Une permutation coûte deux `UPDATE` non atomiques dont le second
  peut échouer (§6.2).
- **Le désarchivage fait partie de l'unité** — **arbitré le 2026-08-11, option 1A** (INC-090,
  `docs/JOURNAL.md` décision 339). Sans lui, « archiver reste réversible » est faux dans le produit.
  Aucune règle, colonne ni politique nouvelle : le même `UPDATE`, sous la même politique. L'énoncé
  ci-dessus est corrigé pour le citer, et INC-090 est **close**.
- **Les commandes ne sont PAS masquées pour un non-administrateur.** L'énoncé ci-dessus dit
  « un `viewer` ne voit aucun de ces gestes » ; la spécification tient l'autre moitié de la phrase —
  « c'est une aide d'interface » — et écarte la première : un rôle lu au chargement peut être périmé
  à l'instant de l'écriture, et une commande masquée sur cette foi cacherait un geste **permis**.
  Même position que le composeur de commentaires (§10).
- **Aucune modale** : le design system n'en déclare aucune, et `CRM-043` a déjà tranché ce cas.
- **Le slug ne se modifie pas depuis l'écran**, alors que la base l'accepte. Ce n'est pas une règle
  inventée mais une absence de geste, et elle est nommée (§5.3, §11 limite 5).

**Definition of Done détaillée**, par preuve et par support :

- [x] `webapp/src/lib/administration-arborescence.ts` — lectures et huit écritures, refus classés sur
      le code PostgreSQL puis le code HTTP, `200`-zéro-ligne traité comme « sans effet ».
- [x] `webapp/src/lib/administration-arborescence.test.ts` — position calculée, dégénérescences,
      proposition de slug, motif copié de la contrainte, classement de chaque refus, requêtes émises.
      **51 assertions vertes**, non complaisantes : trois mutations — garde du milieu strict retirée,
      filtre des archivés retiré, code HTTP testé avant le code PostgreSQL — ont été appliquées et
      ont bien fait rougir 3, 1 et 1 assertions avant restauration.
- [x] Écran, index de réglages, route, textes centralisés dans `webapp/src/i18n/fr.ts`.
      `/reglages` devient l'index des sections ; `/reglages/arborescence` est montée par `App` et
      **hors de la table `ROUTES`**, qui doit couvrir exactement les entrées de la barre latérale —
      patron déjà employé par `CHEMIN_CARD` et `CHEMIN_LISTE`. Écran chargé à la demande, **21 ko**
      en paquet séparé. Deux clés devenues mortes (`route.settings.empty.*`) sont retirées.
- [x] `webapp/src/app/AdministrationArborescence.test.tsx` — états, formulaires, confirmation,
      focus à l'ouverture, commandes désactivées aux extrémités. **34 assertions vertes**, non
      complaisantes : trois mutations — workflow par défaut présélectionné, archivage sans
      confirmation, saisie vidée après un refus — font rougir 2, 3 et 1 assertions.
      **Deux défauts réels trouvés par ces preuves, et corrigés** : (1) le refus d'un déplacement
      impossible était calculé mais rendu **nulle part** hors formulaire — une erreur masquée au
      sens de `CLAUDE.md` §18 ; (2) l'infobulle d'une commande désactivée annonçait « Déjà en tête
      de liste » **y compris** quand la cause était des positions indistinctes — un message faux,
      contre `docs/DESIGN_SYSTEM.md` §8.
      **Un troisième défaut trouvé par `scripts/lib/classes-css.mjs`** : la classe `size-10`
      n'existe pas — 40 px n'est pas dans l'échelle du §3 — et disparaissait **en silence**,
      exactement le mode de défaillance que `docs/DESIGN_SYSTEM.md` §11 décrit.
- [x] `e2e/api/administration-arborescence.spec.ts` — refus du `viewer` et du `business_developer`
      **hors interface**, avec les jetons réels, sur les **huit** écritures de l'écran. **16
      scénarios verts**, rejoués sans régression sur les 502 scénarios de `npm run e2e:api`.
      **Mesuré plutôt que supposé (CLAUDE.md §1)** : une première rédaction attendait `403` /
      `42501` pour les huit écritures, par symétrie avec la création. Rejouée contre la pile réelle,
      elle a échoué sur les douze scénarios de renommage, déplacement et archivage — la politique
      `USING` de `tracks`/`channels` (migration `0003`) rend la ligne **invisible** au `UPDATE` d'un
      non-administrateur, et PostgREST rend `200` avec un corps **vide**, jamais une erreur. C'est
      exactement l'état « sans-effet » de `docs/SPEC-administration-arborescence.md` §9, que
      `administration-arborescence.ts` classe à part de `forbidden` : l'écran affiche alors
      `admin.refus.sans-effet`, pas un message de droit refusé. Le fichier a été corrigé pour
      mesurer cette forme réelle plutôt que l'hypothèse initiale.
- [x] `e2e/ui/administration-arborescence.spec.ts` — les cinq gestes, track puis channel, clavier
      **et** souris ; épilogue rendant le seed à son état initial. **8 scénarios verts** : deux
      parcours complets à la souris (track, puis channel), deux au clavier (focus atteint par
      `Tab`, jamais par `focus()`), quatre paliers responsive. Rejoués sans régression sur les 181
      scénarios de `npm run e2e:ui`.
      **Un défaut réel trouvé en OBSERVANT LA CAPTURE à 390 px, pas en lisant un test** (CLAUDE.md
      §16) : le groupe de commandes d'une ligne au nom long (« Formation ») débordait de la liste,
      et `<main>` (`AppShell.tsx`) porte son propre `overflow-x-auto` **sans** l'indication du
      débordement — le bouton « Archiver » disparaissait au bord, sans qu'aucun dégradé ne signale
      qu'il y avait plus à voir. Même mode de défaillance que `docs/DESIGN_SYSTEM.md` §12.6, sur
      une surface différente. **Corrigé** : les deux listes (tracks, channels) sont enveloppées
      dans le conteneur `.indique-debordement-x` déjà partagé par la barre d'onglets, le board, la
      vue liste et le tableau de `CRM-059` — aucune règle nouvelle, le patron existant appliqué là
      où il manquait.
      **Deux preuves transverses périmées, révélées ici pour la première fois** (`e2e/ui/coquille.spec.ts`,
      `e2e/ui/manuel.spec.ts`) : elles attendaient encore l'état vide de `CRM-007` sur `/reglages`,
      remplacé par l'index de cette unité. Aucune session précédente n'avait pu rejouer `e2e:ui`
      contre la vraie pile depuis ce changement (`docs/JOURNAL.md` décision 343). Corrigées plutôt
      que contournées ; `docs/manual.md` §5 gagne la phrase qui manquait sur l'index.
      **Un troisième défaut, dans `e2e/ui/etat-messagerie.spec.ts` (`CRM-059`), trouvé au passage** :
      l'identifiant du compte de Driss y était recopié d'une exécution antérieure du seed, alors que
      `mail_inbound_accounts.id` est un `gen_random_uuid()` sans littéral stable — corrigé pour
      filtrer par `label`, qui l'est.
- [x] Captures aux quatre paliers, observées — `docs/captures/CRM-075/`.
- [x] `scripts/verify-administration-arborescence.sh` — rejeu complet et non-complaisance. **27
      contrôles, aucune anomalie** : traçabilité, captures, Vitest (lib et écran), API, UI (dont les
      deux preuves transverses ci-dessus), puis trois dégradations réelles — garde du milieu strict
      retirée, filtre des archivés retiré, code HTTP classé avant le code PostgreSQL — qui font
      toutes rougir la suite avant restauration.
- [x] `docs/manual.md` — chapitre 5, « Administrer l'arborescence », et l'entrée 18 du sommaire, qui
      annonce désormais « Livré et vérifié ». `scripts/verify-manual.sh` reste à rejouer séparément
      (harnais distinct, non exécuté dans ce passage).
- [x] INC-086 : la limite « aucune surface d'administration » retirée de `docs/SPEC-tracks.md` §10
      et `docs/SPEC-channels.md` §10, barrée avec renvoi vers cette unité plutôt qu'effacée en
      silence — même convention que la limite déjà levée de `CRM-033` dans `SPEC-channels.md`.

**TOUTES LES PREUVES DE LA DEFINITION OF DONE SONT VERTES. `CRM-075` PASSE `[x]`.**

- [x] **INC-099 close le 2026-08-14 : la preuve rend la table dans l'état où elle l'a trouvée**
      (lot I+J, décisions 362 et 380). Les quatre scénarios de
      `e2e/ui/administration-arborescence.spec.ts` laissaient **deux tracks et deux channels**
      derrière eux. Ils avaient bien un `finally` — l'entrée du registre affirmait le contraire, et
      la lecture du fichier l'a corrigée — mais il **archivait** au lieu de supprimer. Une ligne
      archivée reste une ligne, et c'est même le résidu *archivé* qui faisait rougir la seconde
      assertion. Le `finally` purge désormais par slug avec la clé de service, appliquant la règle
      rendue par la décision 362 pour INC-091. Le nettoyage d'entrée est conservé : il protège du
      `23505` d'une exécution tuée avant son épilogue.
- [x] **Défaut REPRODUIT avant correction, puis CONTRE-ÉPROUVÉ après** — protocole `CLAUDE.md` §18,
      sur le même conteneur et sans qu'aucune assertion ne soit touchée :

      | Étape | tracks | archivés | channels | `test:sql` |
      |---|---|---|---|---|
      | seed frais | 4 | 1 | 6 | 33 fichiers, 1971 assertions |
      | après le spec, AVANT correction | **6** | **3** | **8** | `0004` rouge : `have: 6 want: 4`, `have: 3 want: 1` |
      | après le spec, APRÈS correction | 4 | 1 | 6 | 33 fichiers, 1971 assertions |

- [x] **La contre-épreuve tient à l'échelle de la campagne, pas seulement du fichier** : `test:sql`
      reste vert après `e2e:ui` **entier** (185 verts), puis après les **trois** projets Playwright
      joués à la suite. Et `e2e:api`, que le résidu faisait tomber à 496 verts / 11 rouges lorsqu'il
      suivait `e2e:ui` (décisions 378 et 379), rend ses **507**.
- [x] **L'assertion de `0004_tracks.test.sql` n'est ni désarmée ni assouplie** : c'est elle qui a
      prononcé la reproduction, et elle reste le détecteur.
- [x] **Aucun changement d'interface, et la mesure le dit** : les quatre captures de
      `docs/captures/CRM-075/` sont **identiques à l'octet près** après le rejeu — l'épilogue
      n'agit qu'après le dernier geste observé. `arborescence-xl-1440.jpg` a été **regardée**
      (`CLAUDE.md` §16) : trois tracks actifs, aucun résidu `E2E Arbo`, la commande « Nouveau
      track », la case « Afficher les archivés » éteinte et les quatre actions par ligne.

**Reste dû, et nommé : la GÉNÉRALISATION.** INC-099 demandait aussi « si le contrôle doit être
généralisé aux autres preuves qui écrivent dans des tables partagées, ce qu'un harnais de
non-complaisance saurait mesurer ». Ce point **n'est pas livré** : il engage toutes les suites du
dépôt, pas `CRM-075`, et reste une question du responsable. `CRM-075` demeure `[x]` — l'unité livre
ses gestes et ses preuves ; c'est la propriété transverse des harnais qui reste ouverte.

### CRM-076 — Éditeur administrateur de workflows `[x]`

CRUD visuel complet des workflows, étapes, transitions, champs, règles et exigences, avec
prévisualisation des effets et refus backend pour tout non-administrateur. **DoD** : chaque geste
est clavier/souris, annulation des modifications non enregistrées, validation atomique, pgTAP/API,
E2E et captures aux quatre paliers sans avertissement console.

**Première tranche livrée et vérifiée, 2026-08-14** — la composition d'un workflow
(docs/SPEC-workflow-engine.md §7 bis) :

- [x] Route `/reglages/workflows` depuis l'index des réglages, chargée à la demande.
- [x] Couche de données : les trois lectures du §7 bis.3, les six écritures du §7 bis.4 —
      ajouter, déplacer, surcharger, retirer une surcharge (`null` envoyé, `0` distinct), désigner
      l'initiale (éteindre avant d'allumer, §3.5), retirer. Réutilise l'ordonnancement de
      `CRM-075`. 28 preuves unitaires (`webapp/src/lib/administration-workflows.test.ts`).
- [x] Écran : liste des workflows (défaut choisi d'office), étapes dans l'ordre du graphe,
      catalogue lu à l'ouverture du sélecteur et filtré des nœuds employés, formulaire de
      surcharge repartant des surcharges portées, confirmation avant retrait, refus traduits,
      commandes d'extrémité désactivées jamais masquées. 22 preuves d'écran
      (`webapp/src/app/AdministrationWorkflows.test.tsx`).
- [x] E2E sur la vraie base (`e2e/ui/administration-workflows.spec.ts`, 8 scénarios) : les six
      gestes à la souris confirmés en base après chaque geste, ajout/surcharge/retrait au clavier
      seul, refus réel d'une étape occupée (`on delete restrict`, 409 consommé), quatre paliers
      sans débordement, captures produites et **observées**. Les preuves créent leur propre nœud
      de catalogue préfixé `e2e-wf-` et purgent dans leur `finally` ; `test:sql` rejoué après la
      campagne : 33 fichiers / 1971 assertions, aucun résidu.

**Deuxième tranche livrée et vérifiée, 2026-08-14** — les transitions
(docs/SPEC-workflow-engine.md §7 bis.9) :

- [x] Lecture 4 (`workflow_transitions` filtrée par workflow), émise **avec** celle des étapes :
      un graphe dont on montrerait les nœuds sans les arêtes serait à moitié faux. L'ordre demandé
      est celui des identifiants — la table ne porte pas la position des étapes — et l'ordre
      lisible est composé par `grouperTransitions`.
- [x] Couche de données : `lireTransitions`, `grouperTransitions`, `arriveesPossibles`,
      `libelleTransitionConforme`, `classerRefusTransition`, et les trois écritures du §7 bis.9.2 —
      déclarer, modifier (libellé et motif exigé, jamais une extrémité), retirer. 22 preuves
      unitaires ajoutées (`webapp/src/lib/administration-workflows.test.ts`, 50 au total).
- [x] `classerRefusTransition` **n'a pas de paramètre `geste`**, et c'est mesuré, pas supposé :
      aucune colonne de `cards` ne désigne une transition, donc le `23503` d'un retrait d'arête ne
      peut pas vouloir dire « occupée » comme sur une étape.
- [x] Écran : bloc « Transitions déclarées » sous les étapes, groupes dans l'ordre du graphe,
      culs-de-sac nommés, motif exigé en mention textuelle, libellé absent annoncé, formulaire de
      déclaration à deux listes liées, édition du seul couple libellé/motif, confirmation avant
      retrait. 18 preuves d'écran ajoutées (`AdministrationWorkflows.test.tsx`, 40 au total).
- [x] E2E sur la vraie base (`e2e/ui/administration-workflows.spec.ts`, 8 scénarios ajoutés,
      16 au total) : les trois gestes à la souris confirmés en base après chaque geste, les trois
      au clavier seul, le refus d'unicité obtenu par une **course réelle** — un second
      administrateur déclare l'arête par la clé de service pendant que le formulaire est ouvert —,
      quatre paliers sans débordement, captures produites et **observées**. L'arête de preuve relie
      deux étapes seedées qu'aucune arête ne joignait, et son `finally` la supprime : le seed
      retrouve exactement son graphe.
- [x] Documentation : `docs/manual.md` chapitre **5 bis**, absent jusqu'ici alors que la première
      tranche avait livré l'écran ; `docs/DESIGN_SYSTEM.md` §5.15 (un graphe se rend en listes
      groupées, pas en diagramme).
- [x] **Aucune migration** : `workflow_transitions` et ses politiques datent de `CRM-031`.
- [x] Deux preuves antérieures **révisées, non supprimées** : le libellé d'une étape apparaît
      désormais deux fois à l'écran — dans sa ligne et comme titre de son groupe d'arêtes —, donc
      une assertion unitaire et une assertion E2E de la première tranche sont resserrées sur la
      liste des étapes. Le motif est écrit dans les deux fichiers.
- [ ] **INC-104 relevée au passage, non corrigée** : deux phrases de ce document comptent « dix
      transitions dont quatre à motif » là où le seed en pose **onze dont cinq** depuis la
      décision 259. Elles décrivent la DoD de `CRM-041` et `CRM-046`, unités closes : arbitrage
      demandé plutôt que retouche.

**Troisième tranche livrée et vérifiée, 2026-08-14** — les champs du formulaire
(docs/SPEC-workflow-engine.md §7 bis.10) :

- [x] Lecture 5 (`form_fields` filtrée par workflow, ordre `position`), émise **avec** celles des
      étapes et des arêtes. Les champs **archivés sont rapportés**, à la différence du catalogue de
      la lecture 3 : l'archivage est le seul retrait que le produit connaisse, et le masquer
      rendrait la restauration inatteignable.
- [x] Couche de données : `lireChamps`, `choixDuChamp`, `deviseDuChamp`, `composerOptions`, les
      six contrôles de forme, `classerRefusChamp`, et les cinq écritures du §7 bis.10.2 — déclarer
      (`position` **omise**, le trigger la calcule), modifier, déplacer, archiver, restaurer.
      24 preuves unitaires ajoutées (`administration-workflows.test.ts`, 74 au total).
- [x] **Aucun geste de suppression, et c'est MESURÉ** : `DELETE /form_fields` rend `403` / `42501`
      avec le jeton réel de l'administratrice, `hint` « GRANT DELETE ON public.form_fields ». Le
      §2.7 du composeur l'annonçait ; il est constaté.
- [x] **La clé et le type ne sont pas modifiables depuis l'écran**, bien que la base l'accepte —
      `200` dans les deux cas, mesuré. Le type est décisif : un champ `text` portant `"une chaîne"`
      passe à `number` en `200`, la valeur **reste** en base, et sa réécriture est alors refusée
      (`P0001`, « attend un nombre, reçu string »). La conversion est un plan de remappage, donc
      `CRM-078`. L'écran affiche les deux en phrase, avec leur motif.
- [x] **Le premier contrôle d'écran qui ne soit pas un raccourci** : la base accepte un `select`
      portant deux choix de **même clé** — mesuré, `201`. L'unicité des clés de choix et la forme
      `{key, label}` sont tenues par l'éditeur seul (`refusDesChoix`), et par ses preuves.
- [x] Écran : bloc « Champs du formulaire » sous les transitions, clé en `code`, type traduit,
      champ archivé **nommé** et restaurable, éditeur de choix structuré en deux colonnes, champ de
      devise pour `money`. 16 preuves d'écran ajoutées (`AdministrationWorkflows.test.tsx`, 56 au
      total), 91 clés de traduction.
- [x] E2E sur la vraie base (`e2e/ui/administration-workflows.spec.ts`, 9 scénarios ajoutés,
      25 au total) : les cinq gestes à la souris confirmés en base après chaque geste, la
      déclaration d'un champ à choix avec le refus de deux clés identiques constaté **avant**
      l'envoi, le refus réel d'une clé déjà prise (`23505`, `409` consommé), le parcours au clavier
      seul, quatre paliers sans débordement, captures produites et **observées**. Les champs de
      preuve sont préfixés `e2e-wf-` et purgés dans leur `finally` ; `test:sql` rejoué après la
      campagne : **1971 assertions avant ET après**, aucun résidu.
- [x] Documentation : `docs/manual.md` chapitre **5 bis.4**, `docs/DESIGN_SYSTEM.md` §5.15 complété
      de six règles, `CHANGELOG.md` sous `[Non publié]`. `SCENARIOS_UI` porté à **210**.
- [x] **Aucune migration** : `form_fields` et ses politiques datent de `CRM-035`.
- [ ] **INC-106 relevée au passage, non corrigée** : `scripts/verify-mail-sync.sh` déclare absents
      deux événements présents — `grep -q` ferme le tuyau, `printf` reçoit `SIGPIPE`, et le
      `pipefail` du script en fait un échec. Défaut du harnais de `CRM-051`, arbitrage demandé.

**Quatrième tranche livrée et vérifiée, 2026-08-15** — la grille champ × étape
(docs/SPEC-workflow-engine.md §7 bis.11) :

- [x] Lecture 6 (`form_field_rules` filtrée par workflow, ordre des identifiants), émise **avec**
      celles des étapes, des arêtes et des champs : une règle n'a de sens qu'entre un champ et une
      étape du **même instant**. L'ordre des identifiants est assumé — la table ne porte ni la
      position d'un champ ni celle d'une étape —, et la grille n'en dépend pas : elle est indexée
      par le couple.
- [x] Couche de données : `lireRegles`, `composerGrille`, `classerRefusRegle`, et les deux écritures
      du §7 bis.11.3 — régler par `upsert`, rendre au défaut par suppression. 16 preuves unitaires
      ajoutées (`administration-workflows.test.ts`, **90** au total).
- [x] **La composition ne part JAMAIS des règles**, et le chiffre le justifie : MESURÉ le
      2026-08-15, **quinze** règles pour six champs actifs × sept étapes, soit **vingt-sept** couples
      sans règle. Une lecture par les règles perdrait les deux tiers de la grille.
- [x] **Le réglage est un `upsert`, et c'est MESURÉ** : `POST` d'un couple absent → `201` ; le même
      `POST` avec `resolution=merge-duplicates` → `200` ; **sans** cette résolution → `409` /
      `23505` sur `form_field_rules_pkey` ; `PATCH` → `200`. Un écran qui choisirait d'après ce
      qu'il a lu prendrait le `409` dès qu'un autre administrateur a réglé la même case entre-temps.
- [x] **Quatre états par case, pas trois** : le seed pose deux règles `visible` **explicites**, et
      les replier sur le défaut les aurait affichées comme des absences puis supprimées au premier
      réglage voisin. L'écran écrit sous le tableau que les deux produisent le même formulaire.
- [x] **Les champs archivés sont écartés des lignes**, à la différence de la liste du §7 bis.10.1 :
      un champ archivé ne figure dans aucun formulaire. MESURÉ : la base accepte pourtant une règle
      sur un champ archivé (`201`), et l'archivage n'en efface aucune — elles redeviennent
      effectives à la restauration, ce que la note de l'écran dit.
- [x] **Le `sans-effet` est ici le cas fréquent, et il est mesuré** : le `business_developer` reçoit
      `403`/`42501` en insertion, mais **`200` et `[]`** en `PATCH` comme en `DELETE`, la règle
      seedée restant intacte.
- [x] Écran : quatrième bloc sous les champs, **vrai `table`** avec `th scope="col"` pour les étapes
      et `th scope="row"` pour les champs (docs/DESIGN_SYSTEM.md §5.9), une liste déroulante par
      case dont le libellé accessible nomme le champ **et** l'étape, largeur minimale de case,
      défilement propre au tableau. 13 preuves d'écran ajoutées (`AdministrationWorkflows.test.tsx`,
      **69** au total), 17 clés de traduction.
- [x] E2E sur la vraie base (`e2e/ui/administration-workflows.spec.ts`, 9 scénarios ajoutés,
      **34** au total) : la grille lue contre les trois états seedés dont le `visible` explicite, le
      réglage puis le **changement** d'une même case — le geste que seul l'`upsert` accepte —, le
      retour au défaut vérifié par l'**absence** de ligne en base, le parcours au clavier seul, les
      quatre paliers sans débordement de page, captures produites et **observées**. Le champ de
      preuve est préfixé `e2e-wf-` et purgé dans le `finally` : la cascade emporte ses règles, et un
      scénario dédié vérifie que le seed retrouve ses **quinze** règles.
- [x] **Une preuve antérieure révisée, non supprimée** : le plafond de tabulation de `tabVers` passe
      de 120 à 260 pressions, motif écrit dans le fichier. La grille ajoute quarante-deux listes
      déroulantes à l'ordre de tabulation du document, et trois preuves clavier antérieures
      épuisaient leur plafond avant de revenir sur leur cible. La règle prouvée est inchangée.
- [x] **Un défaut visuel trouvé par la capture, et corrigé** : au palier 1440, chaque case se
      rétrécissait à la largeur de l'en-tête de sa colonne et son état devenait illisible — « Par
      dé… », « Aff… » —, c'est-à-dire l'information même que la grille existe pour donner.
- [x] Documentation : `docs/manual.md` chapitre **5 bis.4 bis**, `docs/DESIGN_SYSTEM.md` §5.15
      complété de cinq règles, `docs/SPEC-form-composer.md` §5 mis à l'état livré, `CHANGELOG.md`
      sous `[Non publié]`. `SCENARIOS_UI` porté à **219**.
- [x] **Aucune migration** : `form_field_rules` et ses politiques datent de `CRM-035`.
- [ ] **INC-108 relevée au passage, non corrigée** : trois documents comptent « dix-sept règles » là
      où le seed en pose **quinze** par workflow. Arbitrage demandé.

**Cinquième tranche livrée, 2026-08-15** — les exigences de transition
(docs/SPEC-workflow-engine.md §7 bis.12) :

- [x] Lecture 7 (`workflow_transition_required_fields`), filtrée par **jointure interne**
      `workflow_transitions!inner` : la table n'a que deux colonnes et ne dénormalise aucun
      `workflow_id`. MESURÉ : la lecture sans filtre rend **les deux** liaisons du seed — la globale
      et la dérivée —, et l'écran d'un workflow afficherait donc les exigences d'un autre.
- [x] Couche de données : `lireExigencesTransition`, `exigencesEffectives`, `exigencesSansEffet`,
      `champsLiables`, `classerRefusExigence`, et les deux écritures du §7 bis.12.3 — exiger par
      `POST` simple, ne plus exiger par suppression du couple.
- [x] **L'écriture N'EST PAS un `upsert`, à l'inverse de la tranche précédente, et c'est MESURÉ** :
      `POST` d'un couple absent → `201` ; sans résolution → `409` / `23505` sur
      `workflow_transition_required_fields_pkey` ; **avec** `resolution=merge-duplicates` →
      **`403`** / `42501` (« GRANT UPDATE … TO authenticated ») ; `PATCH` → **`403`** / `42501`. La
      migration de `CRM-018` n'accorde que `insert` et `delete`, parce que sa spécification §2 pose
      qu'aucune valeur n'est mutable. Reprendre le patron de la grille aurait produit un `403`
      incompréhensible sur le geste le plus courant du bloc.
- [x] **Le bloc rend les exigences EFFECTIVES, pas la table** : la sixième garde de `move_card`
      exige l'**union** des champs `required` par règle à l'étape d'arrivée et des champs liés à la
      transition. MESURÉ : **six** règles `required` sur quatre étapes d'arrivée. Un écran qui
      n'aurait montré que la table aurait écrit « aucune exigence » là où l'étape en impose trois.
- [x] **Une exigence héritée d'une règle n'offre AUCUNE commande de retrait**, et le bloc renvoie à
      la grille. Écart assumé à la règle « commande désactivée jamais masquée » du §5.13 : le geste
      n'existe pas ici, il existe ailleurs, et un bouton grisé aurait suggéré un droit manquant.
- [x] **Les champs archivés sont écartés des choix** : la base accepte pourtant la liaison (`201`
      sur `…071 × …087`) alors que `move_card` filtre `archived_at is null`. Les liaisons existantes
      ne sont pas supprimées et sont **nommées sans effet**.
- [x] **Le vocabulaire des refus est mesuré, pas supposé** : `400`/`23514`
      `required_field_workflow_mismatch` sur un croisement de workflows ; `409`/`23503` sur un
      parent inconnu ; `403`/`42501` en insertion pour le `business_developer` ; et **`200` avec
      `[]`** en `DELETE`, aussi bien pour le `business_developer` sur la liaison seedée — relue
      intacte — que pour l'administratrice sur un couple inexistant. Les deux sont indiscernables
      par la réponse : l'écran dit « rien n'a changé » sans prétendre savoir laquelle s'applique.
- [x] Écran : cinquième bloc sous la grille, arêtes parcourues dans l'ordre du graphe, chacune
      titrée « départ vers arrivée » — cinq arêtes du seed s'appellent toutes « Marquer perdu » —,
      formulaire d'ajout dans le flux, confirmation nommant le champ et le chemin, 21 clés de
      traduction.
- [x] E2E sur la vraie base (`e2e/ui/administration-workflows.spec.ts`, 9 scénarios ajoutés + les
      quatre paliers) : les exigences seedées rendues avec leur origine, l'exigence de règle sans
      commande de retrait, les deux gestes à la souris puis au clavier seul confirmés en base, le
      champ déjà exigé retiré des choix et l'archivé jamais proposé, le refus réel `23505` consommé,
      la liaison sans effet nommée et conservée, le seed retrouvant ses **deux** liaisons.
- [x] Documentation : `docs/manual.md` chapitre **5 bis.4 ter**, `docs/DESIGN_SYSTEM.md` §5.15
      complété de six règles, `CHANGELOG.md` sous `[Non publié]`.
- [x] **Aucune migration** : `workflow_transition_required_fields`, ses trois triggers et ses trois
      politiques datent de `CRM-018`.
- [x] **Compteur du harnais porté** : `SCENARIOS_UI` passe de 219 à **241** avec la sixième
      tranche, MESURÉ par une campagne complète verte le 2026-08-15 et non déduit.

**Sixième tranche livrée, 2026-08-15** — la prévisualisation des effets
(docs/SPEC-workflow-engine.md §7 bis.13), **dernier manque de comportement de l'unité** :

- [x] **DEUX nombres, et la mesure qui l'impose** : les affaires **déjà** à l'étape — jamais
      chassées (§5.7) — et celles qui ne pourront plus y **entrer**. MESURÉ le 2026-08-15 pour
      `date-signature-prevue` sur les sept étapes : `Prospection` rend **4 et 0** — aucune arête ne
      mène à l'étape initiale —, `Signature` rend l'inverse **0 et 1**, `Perdu` rend **1 et 8**. Un
      seul nombre aurait annoncé « aucun effet » sur deux étapes du workflow par défaut.
- [x] **Migration `0036`** : `public.previsualiser_exigence(uuid, uuid, uuid)`, `stable`,
      **`security invoker`**, `search_path` vide, `execute` à `authenticated`. **Aucun changement de
      schéma** : ni table, ni colonne, ni contrainte, ni politique. Contrat de déploiement mis à
      jour (`docs/PROD_MIGRATIONS.md`, ligne 36).
- [x] **Le compte est fait par la base, et les trois motifs sont mesurés** : « vide » est
      `app.valeur_de_champ_est_vide` — vingt-quatre points de code d'espaces (`CRM-036`) —, le
      réécrire en TypeScript aurait dupliqué le contrat de `move_card` ; compter côté navigateur
      aurait exigé une lecture non bornée ; et `security invoker` borne le compte à ce que
      l'appelant a le droit de lire, là où un `definer` aurait annoncé des affaires inaccessibles.
- [x] **10 assertions pgTAP** (`supabase/tests/0034_previsualisation_exigence.test.sql`) dont
      **la parenté avec `move_card`** : la règle est posée, et une affaire comptée « à l'entrée » se
      voit réellement refuser son déplacement par `missing_required_fields`. Sans elle, le reste ne
      prouverait que la cohérence de la fonction avec elle-même. `test:sql` passe de 33/1971 à
      **34 fichiers / 1981 assertions**, `FICHIERS_SQL_ATTENDUS` et `ASSERTIONS_ATTENDUES` portés.
- [x] **Le dédoublonnage est dit pour ce qu'il vaut, et non surestimé** :
      `workflow_transitions_workflow_from_to_key` rend unique le couple (départ, arrivée), donc
      aucune affaire ne peut être comptée deux fois aujourd'hui. La preuve constate l'**égalité**
      entre le compte de l'étape et la somme de ses cinq arêtes — 8 = 4+2+1+0+1 — plutôt que de
      prétendre observer un dédoublonnage que le modèle rend impossible.
- [x] Couche de données : `previsualiserExigence`, `composerMessageEffets`, et les cinq messages —
      dont `aucun-effet`, qui est une phrase et non un silence. `indisponible` n'est **pas** replié
      sur zéro : un zéro inventé aurait rassuré à tort. 8 preuves unitaires.
- [x] Écran : confirmation sous la grille pour le seul état « Exigé », les trois autres restant
      immédiats ; case montrant le choix en cours ; compte affiché sous le choix du champ dans le
      formulaire d'exigence de transition ; échec de mesure **non bloquant**. 13 preuves d'écran,
      13 clés de traduction.
- [x] **Un défaut trouvé par les preuves E2E, mesuré et corrigé** : l'effet du formulaire d'exigence
      dépendait d'une callback recréée à chaque rendu — le parent la construit dans une boucle sur
      les arêtes —, donc il se rejouait à chaque rendu et les appels RPC partaient sans fin. Sept
      scénarios E2E tombaient en délai. Corrigé par un `ref`, et fixé par une preuve unitaire qui
      compte les appels.
- [x] E2E sur la vraie base (5 scénarios + les quatre paliers) : les deux nombres mesurés contre le
      seed — 1 et 9 sur `Perdu` pour un champ neuf, 4 sur `Prospection → Relance` —, le renoncement
      vérifié par l'**absence** de ligne, la confirmation au clavier seul, le seed retrouvant ses
      quinze règles. Captures aux quatre paliers produites et **observées**.
- [x] **Deux preuves antérieures révisées, non supprimées** : les deux scénarios qui réglaient une
      case sur « Exigé » et attendaient une écriture immédiate passent par la confirmation, motif
      écrit dans les fichiers ; et `_lesVingtSixFonctions` devient `_lesVingtSeptFonctions`.
- [x] Documentation : `docs/manual.md` chapitre **5 bis.4 quater**, `docs/DESIGN_SYSTEM.md` §5.15
      complété de six règles, `CHANGELOG.md` sous `[Non publié]`, `docs/PROD_MIGRATIONS.md` ligne 36.
- [x] **Compteur `SCENARIOS_UI` porté à 241, valeur MESURÉE** le 2026-08-15 par la campagne
      complète — `npm run e2e:ui` **241 verts en 7,9 min** —, sur un arbre portant les six tranches
      et après rétablissement complet de la pile. 219 + 22 : neuf scénarios pour les exigences de
      transition, le reste pour la prévisualisation des effets.
- [x] **Trois parcours clavier RÉVISÉS, non affaiblis, et la mesure qui l'a exigé** : les parcours
      des étapes, des arêtes et des champs expiraient au bout des 30 s par défaut pendant la
      campagne complète, et le premier laissait alors son champ de preuve en base — six scénarios
      suivants tombaient sur ce résidu. La cause n'est PAS le plafond de tabulation : MESURÉ en
      instrumentant `tabVers`, les parcours coûtent **356**, **347** et **410** pressions, dont 161
      au plus pour un seul appel, quand le plafond est de 260. C'est la DURÉE — 27,8 s, 28,7 s et
      37 s à vide —, le cinquième bloc ayant allongé le tour du document que chacun fait deux fois.
      Délai porté à 120 s, motif et chiffres écrits dans le fichier, aucune assertion touchée.
- [x] **La campagne complète du 2026-08-15, dans son détail** : `e2e:ui` **241/241**, `e2e:api`
      **507/507**, `e2e:mail` **42/42**, `test:sql` **34 fichiers / 1981 assertions**, `test:unit`
      **973**, `pytest` **242**, `typecheck` et `build` verts.

**Preuves API dédiées à l'écran — ÉCRITES ET VERTES, 2026-08-15.**
`e2e/api/previsualisation-exigence.spec.ts`, **7 scénarios**, `SCENARIOS_API` porté de 507 à
**514**. Elles couvrent le seul objet que la sixième tranche expose réellement au réseau,
`previsualiser_exigence`, et prouvent hors interface ce qu'aucune autre preuve ne pouvait montrer :

- [x] **`security invoker` cesse d'être une déclaration d'intention** — sur le couple
      `date-signature-prevue` × `Perdu`, l'administratrice reçoit **`1, 8`** et le `viewer`
      **`1, 4`**, avec deux jetons réels obtenus par la véritable route de connexion. L'assertion
      écrit l'inégalité : un passage en `security definer` la ferait tomber AVANT que le produit
      n'annonce à quelqu'un des affaires qu'il ne peut pas ouvrir. Ni l'écran ni pgTAP ne peuvent
      montrer cela — pgTAP endosse un rôle, il ne traverse pas PostgREST avec deux jetons.
- [x] **L'anonyme est refusé par le PRIVILÈGE, avant toute politique** : `401` / `42501`
      « permission denied for function », conséquence directe du `revoke … from anon` de `0036`.
- [x] Les trois comptes mesurés du seed, la cible de transition qui ne compte que son chemin
      (**4**, contre **8** pour l'étape d'arrivée qui agrège ses cinq chemins), les deux refus de
      cible (`400` / `P0001` / `previsualisation_cible`) et les deux cas sans effet.

**Reste dû sous cette unité** : le réglage en **lot** d'une exigence sur plusieurs transitions
(§7 bis.11.7, §7 bis.12.7) et la **liste nominative** des affaires prévisualisées (§7 bis.13.5),
tous deux explicitement hors périmètre depuis le §7 bis.11.7. Les politiques d'écriture des tables
de l'éditeur restent prouvées par `CRM-031`, `CRM-035` et `CRM-018` — §3.7, §2.7 et la liaison de
`CRM-018` —, et la sixième tranche n'en ajoute aucune, sa seule migration étant en lecture seule.
**Aucun comportement de la Definition of Done ne reste dû** : les six tranches sont livrées, et
leurs preuves API le sont désormais aussi.

**Toutes les conditions posées ci-dessus sont remplies, et mesurées le 2026-08-15** : campagne
complète verte — `test:sql` 34/1981, `e2e:api` **514** (507 + les 7 de la prévisualisation),
`e2e:ui` **241**, `e2e:mail` 42, `test:unit` 973, `pytest` 242, `typecheck` et `build` —, compteurs
`SCENARIOS_UI` et `SCENARIOS_API` portés sur mesure, et preuves API dédiées écrites.

**LA DERNIÈRE PREUVE MANQUANTE A ÉTÉ EXÉCUTÉE : campagne complète rejouée sur une PILE NEUVE**
— `docker compose down -v`, `./runDev.sh`, seed appliqué —, le 2026-08-15 :

| Preuve | Résultat |
|---|---|
| `npm run test:sql` | **34 fichiers / 1981 assertions**, aucune anomalie |
| `npm run e2e:api` | **514 / 514** |
| `npm run e2e:ui` | **241 / 241** |
| `npm run e2e:mail` | **41 / 42** — l'unique rouge est `mail-sync.spec.ts:210`, c'est-à-dire **INC-107**, connue, documentée et étrangère à cette unité : elle juge l'historique COMPLET du conteneur, si bien qu'un seul `veille_compte_echoue` la rend rouge pour le reste de la vie du conteneur |
| `npm run test:unit` | **973** |
| `npm run typecheck` / `npm run build` | verts |
| `pytest` | **242** |

**Toutes les preuves propres à `CRM-076` sont vertes.** L'unité passe à `[x]`. Ce qui reste écrit
plus haut comme « reste dû » — réglage en lot, liste nominative — n'appartient PAS à sa Definition
of Done : les deux sont explicitement hors périmètre depuis le §7 bis.11.7, et relèveront d'une
unité qui les portera.

### CRM-077 — Corbeille et restauration `[~]`

Suppression logique et restauration de cards, tracks et channels avec dépendances visibles,
durée de rétention et effacement définitif réservé au parcours RGPD. **DoD** : aucun objet enfant
n'est perdu silencieusement ; restauration atomique, audit, droits backend, E2E et captures.

**Spécifiée le 2026-08-15, non livrée** — `docs/SPEC-corbeille.md`, écrite avant toute ligne de code
(`CLAUDE.md` §5) et fondée sur quatre mesures prises sur la pile :

- [x] **`deleted_at` n'existe que sur `cards` et `card_comments`** : `tracks` et `channels` n'ont que
      l'archivage, alors que la DoD les couvre. C'est le manque principal, et il appelle une
      migration — `deleted_at`, plus `deleted_by` fermée au client et écrite par trigger, sur le
      patron déjà éprouvé de `card_comments` (`CRM-043`).
- [x] **La corbeille des cards n'est filtrée par AUCUNE politique**, et ce n'est PAS un défaut à
      corriger au passage : MESURÉ, `GET /rest/v1/cards?deleted_at=not.is.null` rend `200` et la
      card `Saisie erronée`. Le §12 de `docs/SPEC-cards.md` filtre `deleted_at=is.null` dans les
      **listes** : la corbeille est une **vue**, non une frontière de confidentialité — et il le faut
      bien, sans quoi aucun écran ne pourrait l'afficher ni la restaurer. « Droits backend » porte
      donc sur les **écritures**, pas sur l'invisibilité.
- [x] **Les cascades physiques perdent les enfants en silence** : `tracks → channels → cards →
      commentaires, événements, valeurs, file d'envoi` en `CASCADE`, messages et pièces jointes en
      `SET NULL`. D'où deux règles : la corbeille n'efface jamais physiquement, et l'effacement
      définitif ÉNUMÈRE avant d'agir plutôt que de s'en remettre aux cascades.
- [x] **La mise en corbeille d'un parent ne descend PAS sur ses enfants**, et le motif est
      mesurable : descendre l'horodatage rendrait la restauration ambiguë — impossible de distinguer
      les enfants emportés par le parent de ceux déjà en corbeille avant lui. L'énumération remplace
      la descente, et restaurer un enfant sous parent en corbeille est **refusé par une garde
      backend**, pas par une aide d'interface.
**Première tranche livrée, 2026-08-15 — le modèle** (`supabase/migrations/0037_corbeille.sql`) :

- [x] `deleted_at` et `deleted_by` sur `tracks` et `channels`, `deleted_by` sur `cards` — FK
      `profiles` `on delete set null`. **Aucune cascade touchée, aucune politique ajoutée, aucune
      purge, aucun filtre de lecture** : les quatre abstentions sont motivées dans la migration.
- [x] `app.corbeille_avant_ecriture()` — **une fonction pour les trois tables**, trois triggers :
      elle écrit `deleted_by` côté serveur, la **fige** tant que la ligne reste en corbeille — sans
      quoi une écriture ultérieure réattribuerait la suppression à qui passe par là —, l'efface à la
      restauration — « supprimé par X » sur un objet vivant serait un mensonge de plus, pas une
      trace de plus —, et laisse passer le détachement référentiel d'un profil supprimé par la porte
      étroite d'INC-076.
- [x] **L'audit est fermé au client PAR LE PRIVILÈGE, et c'est une mesure qui l'a imposé** : `cards`
      portait déjà des droits colonne par colonne depuis `CRM-013`, si bien que sa nouvelle
      `deleted_by` n'a hérité d'aucun `UPDATE` ; `tracks` et `channels` portaient un droit de TABLE,
      et leur audit était donc écrivable par le client, le trigger seul s'y opposant. L'écart est
      refermé en énumérant leurs colonnes. Deux tables protégées par le privilège et la troisième
      par un trigger seul auraient été une asymétrie que personne ne retrouve en relisant.
- [x] **12 assertions pgTAP** (`supabase/tests/0035_corbeille.test.sql`) : la forme, les trois refus
      `42501` — un par table —, l'audit renseigné par le trigger, figé sous une écriture tierce,
      effacé à la restauration, et la corbeille qui **reste lisible**, propriété voulue que
      l'assertion fige pour qu'un futur masquage se voie ici d'abord. `test:sql` passe de 34/1981 à
      **35 fichiers / 1995 assertions**.
- [x] **Quatre preuves antérieures révisées, aucune supprimée ni contournée**, motif écrit dans
      chaque fichier : les contrôles de privilèges de `0004_tracks` et `0005_channels` deviennent des
      contrôles de privilège de **colonne** — plus précis, non plus permissifs — ; la liste de
      colonnes de `0005_channels` s'étend, et `docs/SPEC-channels.md` §2.1 comme
      `docs/SPEC-tracks.md` §2.1 la portent **dans le même changement** ; les deux assertions de
      types figées suivent.
- [x] `docs/PROD_MIGRATIONS.md` ligne 37, avec son retour arrière — dont l'étape facile à oublier :
      restaurer le droit de table avant de retirer les colonnes.
**Deuxième tranche livrée, 2026-08-15 — la garde de restauration**
(`supabase/migrations/0038_corbeille_restauration.sql`) :

- [x] **Restaurer un enfant sous un parent en corbeille est REFUSÉ par la base**, `parent_en_corbeille`
      (`P0001`) : le rendre là serait le rendre à un endroit où personne ne le verrait — l'utilisateur
      aurait cliqué « restaurer », le produit aurait répondu « c'est fait », et rien n'aurait été
      rendu. Le refus vit dans la base et non dans l'écran : ce qui empêche réellement un geste doit
      valoir aussi pour une API, un script ou une intégration (`CLAUDE.md` §10).
- [x] **Les DEUX niveaux sont vérifiés pour une affaire** — son channel **et** son track. Un seul
      aurait laissé restaurer une affaire sous un channel vivant dont le track est supprimé,
      c'est-à-dire à un endroit tout aussi introuvable, d'un cran plus haut.
- [x] **La garde ne se déclenche QUE sur la transition « était en corbeille, ne l'est plus »** :
      toute autre écriture passe sans lecture du parent. Interroger le parent à chaque mise à jour
      aurait coûté une lecture par écriture pour une question qui ne se pose qu'une fois.
- [x] **8 assertions pgTAP** (`supabase/tests/0036_corbeille_restauration.test.sql`), dont **trois
      qui prouvent que la garde NE refuse PAS ce qu'elle ne doit pas** — modifier un objet en
      corbeille, l'y remettre, et le restaurer une fois ses parents rendus dans l'ordre. Une garde
      qui refuserait trop serait aussi fautive qu'une garde absente. `test:sql` passe de 35/1995 à
      **36 fichiers / 2003 assertions**.
- [x] **La garde vaut pour TOUS les rôles**, propriétaire et clé de service compris : c'est une règle
      de cohérence, non d'autorisation. Consigné au contrat de déploiement, ligne 38, car un script
      de reprise doit remonter l'arborescence des parents avant les enfants.

**Troisième tranche livrée, 2026-08-15 — les listes retirent ce qui est en corbeille**
(`webapp/src/lib/tracks.ts`, `webapp/src/lib/channels.ts`) :

- [x] **Les trois lectures de listes portent `deleted_at=is.null`** — barre latérale des tracks,
      résolution d'un track par son **slug**, barre d'onglets des channels. Sans la deuxième, un
      track en corbeille restait **ouvrable par son adresse**, avec ses onglets et son board : le
      produit aurait dit « retiré » et montré le contraire.
- [x] **Le filtre est SÉPARÉ de celui de l'archivage, et l'assertion unitaire le fige.** Les deux
      états sont indépendants (§3.1) : les fondre en un seul prédicat ferait réapparaître au
      désarchivage un objet mis à la corbeille, et l'écran de corbeille n'aurait plus de quoi les
      distinguer.
- [x] **L'enfant d'un parent en corbeille est rendu inaccessible sans être horodaté** (§3.3) : un
      channel dont le track est en corbeille ne porte aucun `deleted_at`, il devient injoignable
      parce que son track ne se résout plus. C'est ce qui garde la restauration non ambiguë.
- [x] **Preuves exécutées sur cette tranche** : `test:unit` **974/974** (36 fichiers) — deux
      assertions ajoutées et deux doubles de transport étendus à la requête réelle, aucune
      supprimée —, `typecheck` vert, `build` vert, `e2e:ui` **241/241** sur l'arbre qui la porte.
      C'est la mesure que la décision 401 laissait explicitement à la session qui porte le commit.

**Quatrième tranche livrée, 2026-08-15 — le seed enrichi** (`supabase/seed/apply-seed.sh`,
`docs/SPEC-seed.md` §10) :

- [x] **Trois objets, et chacun démontre ce que les deux autres ne démontrent pas** : le track
      `legacy-2023` (`…025`) **en corbeille** — seul cas de restauration qui RÉUSSIT, son unique
      ascendant étant le workspace ; le channel `annexes-2023` (`…038`) **en corbeille sous lui** —
      cas de refus `parent_en_corbeille` du §3.4 ; le channel `dossiers-2023` (`…037`) **actif sous
      lui** — l'enfant du §3.3, qui ne porte **aucun `deleted_at`** et n'est injoignable que parce
      que son track ne se résout plus. Sans ce dernier, « enfant d'un parent en corbeille »
      passerait pour un état unique.
- [x] **La corbeille est un GESTE, jamais une déclaration**, et une mesure l'impose : la clé de
      service ne porte aucune revendication `sub`, donc `auth.uid()` y est nul et un objet né avec
      `deleted_at` renseigné par elle porte un `deleted_by` **nul** — que le trigger **fige**
      ensuite. Les trois objets naissent donc actifs, puis sont mis en corbeille par le **jeton réel
      de l'administratrice**, sur le patron de la décision 376 (INC-072). Le seed **vérifie**
      `deleted_by = …011` et échoue en le disant sinon.
- [x] **Les charges de création n'envoient pas `deleted_at`, et c'est la condition de la
      convergence** : une charge qui enverrait `deleted_at: null` demanderait la **restauration** de
      `…038` à chaque rejeu — restauration que la garde de `0038` **refuse**, et le seed échouerait
      au second passage. La règle du §10.2 est la seule qui converge.
- [x] **Comptes figés révisés, aucun supprimé ni contourné**, motif écrit dans chaque fichier :
      quatre tracks deviennent **cinq**, six channels deviennent **huit**. Les révisions
      **renforcent** — « quatre tracks dont un archivé » devient « cinq tracks dont un archivé **et
      un en corbeille** » — plutôt que de relâcher le compte en tolérance, qui aurait rendu la
      preuve muette sur ce que la tranche ajoute. Treize scénarios d'API, deux assertions pgTAP et
      deux harnais révisés ; **trois assertions AJOUTÉES** : l'audit de l'objet en corbeille, et
      l'enfant du §3.3 asserté NON horodaté. Deux révisions vont au-delà d'un compte —
      `archived_at is null` ne suffisait plus à dire « actif », et plusieurs preuves mesuraient donc
      « non archivé » en croyant mesurer « actif ».
- [x] **Preuves exécutées sur l'arbre qui porte la tranche** : `test:sql` **36 fichiers / 2004
      assertions**, `test:unit` **974/974**, `typecheck`, `build` et `types:check` verts, `e2e:api`
      **514/514**, `e2e:ui` **241/241**, `e2e:mail` **42/42**, `pytest` **242**. Les six preuves du
      §10.5 de `docs/SPEC-seed.md` sont vertes, y compris le refus `parent_en_corbeille` (`P0001`)
      mesuré hors interface avec le jeton réel de l'administratrice, et la dérive rattrapée au rejeu.
- [x] **Vérifié visuellement et OBSERVÉ** (`CLAUDE.md` §16), première fois que le filtre de la
      troisième tranche a quelque chose à filtrer : la barre latérale rend **trois** tracks — ni
      l'archivé ni celui en corbeille —, et `/tracks/legacy-2023` rend **« Track introuvable »** au
      lieu du track. **Console VIERGE.** Captures : `docs/captures/CRM-077/`.

- [x] **Harnais révisés** : `verify-workflows.sh` **42 contrôles sans anomalie** ;
      `verify-seed.sh` vert ; `verify-tracks.sh`, `verify-channels.sh` et `verify-droits-fins.sh`
      ne portent plus que **INC-112 / INC-113**, deux entrées ouvertes consignées et **étrangères à
      cette tranche** — un harnais qui rejoue une migration sans ses successeurs mesure un produit
      en arrière d'une arbitration, et laisse la base de développement ouverte.

**Cinquième tranche livrée, 2026-08-15 — l'énumération des enfants rendus inaccessibles**
(`webapp/src/lib/corbeille.ts`, `docs/SPEC-corbeille.md` §3.5) :

- [x] **Trois règles de comptage, et chacune répond à une question précise.** Un enfant DÉJÀ en
      corbeille n'est pas compté — il ne *devient* pas inaccessible, il l'est, et il porte sa propre
      entrée où il se restaure séparément. Un enfant ARCHIVÉ est compté, lui : l'archivage est
      réversible et le désarchivage est livré, si bien que le retour attendu d'un channel archivé est
      exactement ce que la mise à la corbeille de son track immobilise. Les affaires d'un channel
      lui-même en corbeille ne comptent pas pour le track : elles sont retenues un cran plus bas. Le
      compte d'un track répond donc à « que retire ce geste **de plus** que ce qui est déjà retiré ».
- [x] **DEUX LECTURES, ET C'EST UNE MESURE** : `cards` porte deux clés étrangères composites vers
      `channels`, et `select=id,channels!inner(id)` rend `300` / `PGRST201`. Lever l'ambiguïté
      demanderait un nom de contrainte dans la requête d'un écran, ce que `inbox.ts` a déjà refusé
      pour cette relation. Le nombre de channels est la longueur de la première lecture ; le compte
      des affaires vient de `count=exact`, jamais des lignes, et une réponse aboutie **sans `count`
      est une erreur**, pas un zéro.
- [x] **Le compte est celui de l'appelant, et il est mesuré** : sur `conseil-ia`, l'administratrice
      lit 3 channels et 7 affaires, la lectrice 1 et 2. Le §3.5 en tire la seule interdiction qui
      compte — ce nombre n'est pas une garantie d'exhaustivité.
- [x] **La composition n'écrit aucune phrase** : elle rend une liste ordonnée de lignes, omet celle
      dont le compte est nul et n'en rend aucune quand rien ne devient inaccessible. Le singulier et
      le pluriel restent deux clés du catalogue (`CLAUDE.md` §23) ; aucun module de `lib/` n'importe
      les textes.
- [x] **L'affaire `…0cf` sous `dossiers-2023`** (`docs/SPEC-seed.md` §10.4 bis), annoncée par la
      quatrième tranche : elle donne son compte non nul à l'énumération et devient le **seul** cas de
      garde à deux niveaux du seed — channel vivant, track en corbeille. Son étape est choisie sur
      mesure : `livre` aurait faussé un préalable de `cards.spec.ts`, `perdu` exige `motif-perte`.
- [x] **Comptes figés révisés, aucun supprimé ni contourné** : 14 affaires deviennent 15, 12 actives
      13, six channels portent des affaires au lieu de cinq. Et deux comptes de l'annexe A du manuel,
      **faux depuis la quatrième tranche** — MESURÉ « 3 tracks actifs » contre 4, « 5 channels
      actifs » contre 7 —, sont réparés à leur cause : leurs requêtes ignoraient la corbeille et
      comptaient comme actif un objet retiré. Deux grandeurs nouvelles la rendent visible.

- [x] **Preuves exécutées sur l'arbre fusionné** : `typecheck`, `build` et `types:check` verts,
      `test:unit` **1000/1000** sur 37 fichiers, `test:sql` **36 fichiers / 2004 assertions**,
      `e2e:api` **521/521** dont les sept scénarios de `e2e/api/corbeille.spec.ts`, `e2e:mail` vert,
      `scripts/verify-manual.sh` **111 contrôles sans anomalie** sur une base propre — la ligne de
      base en portait deux. Les cinq échecs qu'une campagne complète a rapportés passaient tous
      isolément et disparaissent après `./resetMe.sh` : ils tenaient à l'état accumulé par les
      harnais, non au dépôt. `scripts/verify-seed-demo.sh` n'est PAS vert, et son écart est nommé :
      INC-115 pour son contrôle n° 13, INC-116 pour ses empreintes et pour la base qu'il laisse
      dégradée derrière lui. `scripts/verify-timeline.sh`, rejoué SEUL sur une base propre, tombe de
      5 anomalies à **2** — INC-117 et **INC-119**, toutes deux étrangères. `verify-webapp.sh` est
      **vert, 42 contrôles**, traçabilité des nouveaux fichiers comprise ; `verify-harness.sh` rend
      25 contrôles verts sur 28, ses trois rouges étant des rejeux de suites sur une base déjà
      dégradée.
- [x] **Deux constats ÉTRANGERS consignés plutôt que corrigés au passage** (`docs/CloudWorker.md`
      §3.1) : **INC-115**, une preuve qui exige que la lectrice ne lise pas un track que la
      réouverture par droit fin lui ouvre depuis `CRM-012` ; **INC-116**, l'empreinte du §9.8 qui
      n'est stable qu'à partir du deuxième rejeu du seed, ce qui rend `verify-seed-demo.sh` rouge
      sur une base fraîchement réinitialisée et vert ensuite.

**Sixième tranche livrée, 2026-08-15 — l'écran** (`webapp/src/app/Corbeille.tsx`,
`webapp/src/lib/corbeille.ts`, `docs/SPEC-corbeille.md` §4, `docs/DESIGN_SYSTEM.md` §5.16) :

- [x] **TROIS lectures, dont l'embarquement doit être désambiguïsé, et la mesure est plus large que
      celle du §3.5** : `select=id,profiles(id)` rend `300` / `PGRST201` sur les **trois** tables,
      pour deux causes distinctes — trois clés étrangères sur `cards`, mais sur `tracks` et
      `channels` la seule clé `deleted_by` concurrencée par la relation **plusieurs-à-plusieurs** des
      tables d'appartenance. L'ambiguïté ne vient donc pas du nombre de clés étrangères. La levée est
      le **nom de la contrainte**, convention déjà écrite par `colonnes-board.ts`, `colonnes-liste.ts`
      et `commentaires.ts` pour cette relation exacte.
- [x] **Une première rédaction du §4.2 concluait à une quatrième lecture séparée, et elle était
      FAUSSE** : le refus du §3.5 portait sur `cards` → `channels`, dont les clés sont composites et
      que nommer n'aurait pas réparées. La règle avait été transportée d'un contexte à l'autre sans
      être remesurée — récidive du motif d'INC-113, une tranche plus tard. Corrigée **avant** la
      première ligne de code, et la contradiction est écrite dans le chapitre lui-même.
- [x] **L'auteur inconnu est NOMMÉ, jamais une cellule vide** (§4.3) : la card `Saisie erronée` porte
      `deleted_by` **NUL** — MESURÉ —, née en corbeille sous la clé de service qui ne porte aucune
      revendication `sub`, valeur ensuite figée par le trigger de `0037`. Le §5.9 réserve la cellule
      vide à une donnée qui n'existe pas pour la ligne ; un auteur non enregistré est un fait.
- [x] **Les TROIS issues de la restauration, toutes mesurées avec les jetons réels** : appliquée ;
      refusée par la garde — `400`, `P0001`, `parent_en_corbeille`, avec le `details` qui dit quoi
      restaurer d'abord ; et **sans effet** — la lectrice reçoit `200` et `[]`, la clause `USING`
      filtrant la ligne avant la mise à jour (décision 70), le track relu **toujours en corbeille**.
      `classerRefusRestauration` exige le NOM de l'exception avec le code, `P0001` étant le SQLSTATE
      de tout `raise exception`.
- [x] **L'écran n'anticipe AUCUN refus** : la commande « Restaurer » n'est éteinte sur aucune ligne,
      y compris celle d'un channel sous parent en corbeille. La garde vit dans `0038` ; une commande
      désactivée par l'interface ferait passer une règle de la base pour une décision d'écran, et se
      tromperait dès qu'un autre utilisateur aurait restauré le parent entre le chargement et le clic.
- [x] **L'état vide est le cas NORMAL et n'offre aucune action** — écart assumé avec le §5.8 : il n'y
      a rien à faire d'une corbeille vide. Le succès relit la liste plutôt que de la corriger en
      mémoire, c'est la base qui décide de ce que contient la corbeille.
- [x] **Aucun effacement définitif, aucun vidage, aucune pagination** (§4.7) : le §6 n'est pas
      arbitré. Une preuve unitaire garde cette porte fermée. Les deux limites assumées — pas de
      pagination, tri croisé des trois tables côté client — sont écrites au §7 de la spécification.
- [x] **Preuves exécutées sur l'arbre qui porte la tranche** : `test:unit` **1013/1013** sur 38
      fichiers, `test:sql` **36 fichiers / 2004 assertions**, `typecheck`, `build` et `types:check`
      verts, `e2e:api` **521/521**, `e2e:ui` **251/251** dont les **10 scénarios** de
      `e2e/ui/corbeille.spec.ts`, console **VIERGE**.
- [x] **Vérifié visuellement et OBSERVÉ** (`CLAUDE.md` §16) : captures aux quatre paliers et de
      l'état vide, dans `docs/captures/CRM-077/`. L'état vide emploie une réponse substituée,
      **nommée**, admise par le §12.5 du design system pour isoler un état rare — le seed existe
      précisément pour démontrer la corbeille, et aucun des trois comptes ne peut donc l'atteindre.
- [x] **Trois preuves pgTAP que la cinquième tranche laissait rouges ont été soldées d'abord** :
      `0012_cards`, `0015_colonnes_protegees` et `0034_previsualisation_exigence` figeaient des
      comptes que l'affaire `…0cf` déplace. La ligne de base de la session les mesurait en échec sur
      l'arbre distant, avant toute modification.

- [ ] **Reste dû** : un **harnais dédié** `scripts/verify-corbeille.sh`, qui rassemblerait les
      preuves aujourd'hui dispersées entre `webapp/src/lib/corbeille.test.ts`,
      `webapp/src/app/Corbeille.test.tsx`, `e2e/api/corbeille.spec.ts` et
      `e2e/ui/corbeille.spec.ts`.
- [x] **La ligne « Visuel » du §5 demandait aussi une capture de la confirmation portant
      l'énumération.** Elle n'appartenait pas à cette tranche : le §4.7 place le geste hors de
      l'écran de corbeille — « on n'y retire rien, on y rend ». **Produite par la septième tranche**,
      ci-dessous, aux quatre paliers.

**Septième tranche livrée, 2026-08-15 — le geste de mise à la corbeille d'un track et d'un channel**
(`webapp/src/app/AdministrationArborescence.tsx`, `webapp/src/lib/administration-arborescence.ts`,
`docs/SPEC-corbeille.md` §4 bis, `docs/DESIGN_SYSTEM.md` §5.13) :

- [x] **Le geste vit dans `/reglages/arborescence`, à côté d'« Archiver »** (§4 bis.1) : le §4.7
      l'exclut de l'écran de corbeille, les trois états du §3.1 sont un seul vocabulaire, et cet
      écran porte déjà la confirmation, la traduction des refus et la relecture après écriture. La
      commande reste offerte sur une ligne **archivée**, là où renommer et réordonner disparaissent :
      elles n'ont aucun effet observable sur un objet masqué, le retrait en a un.
- [x] **Préalable MESURÉ, refermé dans la même tranche** (§4 bis.2) : l'administration lit par ses
      propres requêtes, que la troisième tranche n'avait pas filtrées — `tracks?archived_at=is.null`
      rendait **quatre** tracks dont `Legacy 2023`, en corbeille. Le filtre `deleted_at=is.null` est
      ajouté aux deux lectures, **séparé** de celui de l'archivage. **Quatre attentes unitaires
      révisées**, aucune supprimée ni relâchée : la plus utile exige que la case « Afficher les
      archivés » retire le filtre d'archivage ET conserve celui de corbeille.
- [x] **La confirmation porte l'énumération** de `compterEnfantsInaccessibles` (§4 bis.3) —
      l'appelant que la cinquième tranche avait livré sans, et la capture que la ligne « Visuel » du
      §5 réclamait. Ses quatre états sont distincts, dont « n'a pas pu être mesuré », et **aucun
      n'éteint la commande** : une énumération informe, elle n'autorise pas. Le type des états et le
      choix singulier/pluriel sont **partagés** avec l'écran de corbeille
      (`webapp/src/app/presentation-corbeille.ts`) plutôt que recopiés.
- [x] **Les trois issues MESURÉES avec les jetons réels** (§4 bis.5) : l'administratrice obtient
      `200` et la ligne, `deleted_by` écrite par le trigger ; le business developer **et** la
      lectrice obtiennent `200` et `[]`, la ligne relue **inchangée** — troisième occurrence de la
      décision 70 dans cette unité. Une charge portant `deleted_by` est refusée **entièrement**, en
      `42501`, et `deleted_at` n'est pas écrite non plus : le refus de privilège n'est pas partiel.
- [x] **L'horodatage reste celui du client**, comme `archived_at` : le poser côté serveur
      remplacerait la date **fixe** des trois objets en corbeille du seed par l'instant du rejeu et
      emporterait la reproductibilité du jeu de démonstration. Limite nommée au §7, point 3.
- [x] **Un défaut d'affichage trouvé en REGARDANT une capture** (`CLAUDE.md` §16), qu'aucune
      assertion n'aurait vu : la liste porte `min-w-max` pour son défilement horizontal, donc un
      paragraphe ne s'y replie jamais, et le corps de la confirmation sortait de l'écran. Borné, et
      la preuve mesure désormais que la confirmation tient dans le champ au palier de référence.
- [x] **Preuves exécutées sur l'arbre qui porte la tranche** : `typecheck`, `types:check` et `build`
      verts ; `test:unit` **1029/1029** sur 38 fichiers ; `test:sql` **36 fichiers / 2004
      assertions** ; `e2e:api` **530/530** dont 9 scénarios ajoutés ; `e2e:ui` **258/258** dont 7
      scénarios ajoutés, **console VIERGE** ; `e2e:mail` **42/42** ; `pytest` **242** ;
      `scripts/verify-manual.sh` **113 contrôles sans anomalie**.
- [x] **Vérifié visuellement et OBSERVÉ** : captures aux quatre paliers de la confirmation et de son
      énumération, dans `docs/captures/CRM-077/`.
- [x] **Le manuel gagne le chapitre 5 ter**, absent depuis la livraison de l'écran de corbeille, et
      le chapitre 5 décrit le geste et ce qui le distingue de l'archivage.
- [x] **Un constat ÉTRANGER mesuré et tranché sans passer par le registre** (doctrine du
      2026-08-15) : la barre latérale garde un track que l'administration vient de retirer, jusqu'au
      prochain chargement — MESURÉ à l'identique sur l'**archivage**, donc antérieur. Cause : la
      coquille et l'écran tiennent deux copies de la même liste. Comportement inchangé, travail dû
      porté par `CRM-075` (`docs/JOURNAL.md` décision 421, `docs/ARBITRAGES.md` §1).

**Huitième tranche livrée, 2026-08-15 — le geste de mise à la corbeille d'une AFFAIRE**
(`webapp/src/app/RouteCard.tsx`, `webapp/src/lib/corbeille.ts`, `docs/SPEC-corbeille.md` §4 ter,
spécifié avant toute ligne de code) :

- [x] **La surface est tranchée PAR MESURE, et deux candidates s'écartent sur une règle déjà écrite**
      (§4 ter.1) : le menu d'une carte de board ne liste que les transitions déclarées
      (`docs/DESIGN_SYSTEM.md` §5.1), et le tableau de la vue liste ne déclare aucune colonne
      d'actions (§5.9). Reste la **route de détail**, seule surface où l'affaire est le sujet — même
      raisonnement que pour le track et le channel, administrés en tant qu'objets.
- [x] **La confirmation ne porte AUCUNE énumération** (§4 ter.2), ni la phrase « aucun objet ne
      devient inaccessible » du §4 bis.3 : celle-ci rapporte une mesure qui a rendu zéro, et ici
      aucune mesure n'a lieu — `compterEnfantsInaccessibles` n'accepte pas une affaire.
- [x] **Le BUSINESS DEVELOPER RÉUSSIT le geste, là où il échoue sur un track** — MESURÉ avec les
      jetons réels (§4 ter.3) : `cards_maj` porte `app.can_write_channel`, `tracks_maj_admin` exige
      un rôle. Retirer une affaire est une écriture ordinaire sur son channel. La lectrice obtient
      `200` et `[]`, la ligne relue **inchangée** — quatrième occurrence de la décision 70.
- [x] **Après le geste, l'écran NOMME la corbeille** (§4 ter.5) : la route lit `deleted_at=is.null`
      — MESURÉ —, et « Card introuvable » serait faux pour qui vient de la retirer. Bloc
      `role="status"`, **deux** chemins — le channel, et la corbeille —, aucune annulation sur place.
- [x] **Le fil enregistre le geste sans que le client écrive rien** (§4 ter.4) : le trigger de `0016`
      fait naître un événement `trashed` portant son acteur. La charge ne porte que `deleted_at` ;
      une charge portant `deleted_by` est refusée **entièrement**, en `42501`.
- [x] **Un défaut trouvé par la preuve clavier, corrigé dans sa cause** : la commande est démontée
      pendant la confirmation, si bien que rendre le focus à l'annulation visait une référence nulle.
      Honoré par un effet, au remontage. `Button` déclare enfin sa `ref` (React 19).
- [x] **Preuves exécutées sur l'arbre qui porte la tranche** : `typecheck` et `build` verts ;
      `test:unit` **1042/1042** sur 39 fichiers dont 7 scénarios ajoutés ; `test:sql` **36 fichiers /
      2004 assertions** ; `e2e:api` **536/536** dont 6 scénarios ajoutés ; `e2e:ui` **265/265** dont
      7 scénarios ajoutés, console **VIERGE** ; `e2e:mail` **42/42** ; `pytest` **242** ;
      `scripts/verify-manual.sh` **113 contrôles sans anomalie**.
- [x] **Vérifié visuellement et OBSERVÉ** (`CLAUDE.md` §16) : la confirmation aux quatre paliers, le
      bloc de succès et le refus « sans effet », dans `docs/captures/CRM-077/`, préfixés `card-`.
- [x] **Le manuel gagne le chapitre 4.7 bis**, et le chapitre 5 ter cesse d'annoncer qu'une affaire
      ne se retire d'aucun écran.
- [ ] **Non exécutés, et nommés** : les `scripts/verify-*.sh` qui passent par `scripts/lib/node.sh`
      — l'environnement de cette session fournit **Node 22**, le dépôt exige Node 24. Aucune de ces
      preuves n'est annoncée comme verte.

**Neuvième tranche livrée, 2026-08-15 — le harnais dédié** (`scripts/verify-corbeille.sh`,
`docs/SPEC-corbeille.md` §5 bis, spécifié avant toute ligne de code) :

- [x] **Un verdict unique là où les preuves étaient dispersées entre neuf fichiers** : traçabilité
      des douze fichiers de l'unité, captures, les deux suites pgTAP, les deux filtres Vitest, les
      scénarios d'API et le parcours d'interface. **39 contrôles, aucune anomalie**, MESURÉ sur la
      pile démarrée et seedée.
- [x] **Les comptes sont figés PAR PAIRE** — fichiers ET assertions, fichiers ET tests (décision
      279) : `2 fichiers / 20 assertions` pgTAP, `2 fichiers / 39 tests` et `1 fichier / 7 tests`
      Vitest, `22` scénarios d'API, `24` d'interface. Un compte qui **monte** est un écart au même
      titre qu'un compte qui descend, et le §5 bis.1 se met à jour dans le même changement.
- [x] **Quatre dégradations réelles, et les QUATRE sont vues** : le filtre `deleted_at=not.is.null`
      de `lireTable`, l'omission des lignes à compte nul de `composerEnumeration`, la reconnaissance
      de `parent_en_corbeille` par `classerRefusRestauration`, et la branche `sans-effet` de
      `mettreCardALaCorbeille`. Chacune vise une règle dont la disparition serait **silencieuse en
      production** — l'écran continuerait de s'afficher.
- [x] **La restauration est CONSTATÉE octet à octet** contre un instantané pris avant la première
      dégradation, jamais contre `HEAD` (`docs/SPEC-test-harness.md` §7.2 point 9) : le harnais doit
      fonctionner dans un arbre portant une évolution légitime non encore committée.
- [x] **Le harnais nomme ce qu'il NE prouve PAS** (§5 bis.3) : aucune politique d'autorisation n'y
      est réécrite, aucun effacement définitif, aucune convergence de seed.
- [x] **`README.md` porte la commande et son `--rapide`**, dans les trois listes qui énumèrent les
      harnais.

**L'unité n'a PLUS de dette de construction**, et reste `[~]` pour une seule raison, qui ne se lève
pas en session : sa Definition of Done cite l'**effacement définitif**, lequel dépend des trois
points ci-dessous. Toutes ses preuves sont exécutées et vertes, rassemblées par
`scripts/verify-corbeille.sh` (**39/39**).

**Trois points restent ouverts et appellent l'arbitrage du responsable** (§6 de la spécification) :
la **durée de rétention**, que `docs/SPEC-cards.md` §10 laissait déjà ouverte ; l'**effacement
définitif** et son parcours RGPD, qui ne sera pas livré tant que la rétention n'est pas décidée —
livrer une destruction irréversible sans règle de conservation serait le contraire d'une mesure de
conformité ; et la **visibilité de la corbeille** pour un membre ordinaire. Aucun n'est tranché
ici.

### CRM-078 — Versionnement des workflows `[x]`

Versions immuables, comparaison de composition et plan explicite de remappage des cards avant
activation. **DoD** : aucune étape n'est devinée, aperçu exhaustif, application transactionnelle,
retour arrière, pgTAP/API/E2E et captures.

**Découpage en tranches, posé le 2026-08-15.** L'unité est trop large pour une session : elle est
menée par tranches, chacune livrée, prouvée et poussée avant la suivante.

1. **Versions immuables et publication** — la fondation de données et le geste serveur ;
2. **Comparaison de deux versions** — ajouts, retraits et modifications, calculés sur les documents
   conservés ;
3. **Plan de remappage des cards** — card par card, aucune étape devinée ;
4. **Application transactionnelle et retour arrière** ;
5. **Écrans** — liste des versions, publication, aperçu de comparaison, et leurs captures.

#### Première tranche — versions immuables et publication

- [x] **Spécification écrite avant tout code**, `docs/SPEC-workflow-engine.md` **§7 ter** (dix
      sections) : ce que le versionnement est et n'est pas, le document canonique et l'exigence
      d'empreinte inchangée, le modèle, les trois barrières d'immuabilité, le geste et ses cinq
      refus dans l'ordre, les autorisations, les quinze lignes du contrat d'API, le seed, ce qui
      n'est pas livré, les preuves attendues. `docs/SCHEMA.md` §3 et §9 mis à jour dans le même
      commit documentaire, poussé **avant** la première ligne de code (`CLAUDE.md` §5).
- [x] `supabase/migrations/0039_versionnement_workflows.sql` : `app.workflow_composition_document`,
      `app.workflow_composition_fingerprint` réécrite en appelant, table `public.workflow_versions`,
      trigger d'immuabilité, l'UNIQUE politique RLS de lecture, privilèges explicites, RPC
      `public.publish_workflow_version`. Appliquée et rejouée sur la pile réelle.
- [x] **L'EXTRACTION DU DOCUMENT N'A PAS DÉPLACÉ L'EMPREINTE, et c'était le seul risque de
      régression de cette migration.** `workflows.source_composition_fingerprint` porte des valeurs
      figées et `workflow_derivations` les compare à l'empreinte courante : un changement d'ordre de
      clés aurait fait diverger **toutes** les copies du produit sans qu'aucune n'ait bougé. Les
      deux empreintes du seed relevées avant, constatées identiques après, et **figées en dur** dans
      la suite pgTAP. Le contrat de déploiement exige le même relevé en production.
- [x] **Test unitaire dédié** `supabase/tests/0037_versionnement_workflows.test.sql` :
      **31 assertions, aucune anomalie** — structure, six contraintes de valeur, unicité
      `(workflow_id, version_number)`, clé étrangère de couple, l'unique politique et l'absence des
      trois autres, privilèges, refus de mise à jour opposable au **propriétaire de la base**,
      cascade laissée possible, cinq refus de la RPC contre des comptes réels, et la publication qui
      RÉUSSIT — sans quoi les refus seraient verts sur un produit où publier est impossible.
- [x] **Test d'intégration dédié, hors interface** `e2e/api/versionnement-workflows.spec.ts` :
      **14 scénarios**, les quinze lignes du §7 ter.7 avec les jetons réels des trois profils ;
      preuves de refus n° 2, n° 3 et n° 11 au niveau des versions. Chaque refus est **relu en base**
      avec la clé de service : un refus qui laisse une trace n'est pas un refus.
- [x] **Seed** : une version du workflow par défaut, publiée par la vraie RPC avec le jeton réel de
      l'administratrice. `published_by` est **vérifié** et non supposé. Convergent : deux passages
      laissent une seule version, et c'est la cinquième vérification de la RPC qui l'assure, pas une
      garde propre au seed.
- [x] **Trois preuves figées ont rougi et ont été RÉVISÉES, jamais contournées** (mécanisme de la
      décision 51) : le compteur global de politiques de `0016_preuves_refus.test.sql` (65 → 66) et
      les deux énumérations de `webapp/src/lib/database.types.test-d.ts` — les tables, et les
      fonctions qui passent de vingt-sept à vingt-huit. Chacune porte son motif dans le fichier.
- [x] `docs/SCHEMA.md` §3 et §9, `docs/DAT.md` §7, `docs/PROD_MIGRATIONS.md` §3, `CHANGELOG.md`,
      `webapp/src/lib/database.types.ts` (régénéré) mis à jour dans le même changement.
- [x] **`docs/manual.md` — ligne 20 bis ajoutée au sommaire**, et le README porté à l'état réel.
      La tranche ne livre aucun geste d'interface, mais le manuel énumère déjà ce qui n'existe que
      côté serveur (lignes 22, 25 et 25 bis) : l'omettre aurait laissé croire que le versionnement
      n'existe pas. La ligne dit ce que publier fait, ce que publier **ne fait pas** — les affaires
      circulent toujours sur la structure vivante — et que publier reste un geste d'API. **Le
      chapitre rédigé** naîtra avec l'écran de la cinquième tranche.
- [ ] **Aucun harnais dédié `scripts/verify-versionnement.sh`.** Les preuves de l'unité vivent dans
      deux fichiers ; un verdict d'ensemble ne s'écrit utilement qu'une fois les cinq tranches
      livrées, comme `CRM-077` l'a montré.

#### Deuxième tranche — comparaison de deux versions

- [x] **Spécification écrite avant tout code**, `docs/SPEC-workflow-engine.md` **§7 ter.11** (huit
      sections) : ce que la comparaison est et n'est pas, **l'identité est un identifiant et jamais
      une ressemblance** — la règle qui tranche « aucune étape n'est devinée » —, le geste et ses
      quatre refus dans l'ordre, la forme rendue, l'algorithme unique appelé six fois, les douze
      lignes du contrat d'API, ce qui n'est pas livré, les preuves attendues. `docs/SCHEMA.md` §9
      mis à jour dans le même commit documentaire, poussé **avant** la première ligne de code
      (`CLAUDE.md` §5).
- [x] `supabase/migrations/0040_comparaison_versions_workflow.sql` :
      `app.composition_collection_diff` — l'algorithme, appelé **six fois** —,
      `public.compare_workflow_versions`, privilèges explicites et révocation nommée d'`anon`.
      Appliquée et rejouée sur la pile réelle.
- [x] **UN SEUL ALGORITHME, ET C'EST UNE DÉCISION DE CONCEPTION.** Cinq comparaisons spécialisées
      auraient produit cinq occasions de diverger — le défaut qu'avait corrigé l'extraction du
      document canonique en migration 39, et qui n'est pas réintroduit ici. La clé `workflow`, qui
      n'est pas un tableau, est enveloppée dans un tableau d'un élément et passée au même
      algorithme.
- [x] **`SECURITY INVOKER`, et non `definer`.** La politique de lecture de `workflow_versions` EST
      déjà la règle d'autorisation exacte du geste ; une fonction `definer` devrait la réécrire dans
      son corps, et deux formulations de la même règle finissent toujours par diverger. Conséquence
      directe : **aucun contrôle de workspace n'est écrit à la main**, et son absence est une
      garantie et non un oubli. Une assertion pgTAP fige `prosecdef = false`.
- [x] **Test unitaire dédié** `supabase/tests/0038_comparaison_versions_workflow.test.sql` :
      **31 assertions, aucune anomalie** — existence, `stable`, absence de `security definer`,
      privilèges et révocation d'`anon` ; l'algorithme éprouvé hors de tout workflow sur trois
      objets ; l'identité en COUPLE de `rules` ; les quatre refus contre des comptes réels ; le
      geste qui RÉUSSIT sur deux versions publiées par la vraie RPC ; l'invariant `identical` dans
      les deux sens ; l'ordre déterministe des tableaux ; et le `viewer` qui compare — sans quoi les
      refus seraient verts sur un produit où personne ne peut comparer.
- [x] **LA RÈGLE « AUCUNE ÉTAPE N'EST DEVINÉE » EST TRANCHÉE ICI, ET FIGÉE PAR DEUX ASSERTIONS**
      (n° 12 et n° 13) : une étape **renommée** reste UNE étape modifiée, le libellé n'entrant pas
      dans l'identité ; une étape **supprimée puis recréée** à l'identique rend un RETRAIT et un
      AJOUT, jamais un inchangé. C'est la vérité de la base, et toute autre réponse serait une
      supposition.
- [x] **Test d'intégration dédié, hors interface**
      `e2e/api/comparaison-versions-workflow.spec.ts` : **12 scénarios**, les douze lignes du
      §7 ter.11.6 avec les jetons réels des trois profils. La ligne j — preuve de refus n° 3 — crée
      un **second workspace réel**, absent du seed, y pose une version dont l'existence est
      constatée avec la clé de service, et démonte le tout : sans cela, le refus serait vrai par
      simple absence et ne prouverait rien (décision 50).
- [x] **Une preuve figée a rougi et a été RÉVISÉE, jamais contournée** (mécanisme de la décision 51,
      quatorzième occurrence) : l'énumération des fonctions de `webapp/src/lib/database.types.test-d.ts`
      passe de vingt-huit à vingt-neuf, avec son motif écrit dans le fichier.
- [x] `docs/SCHEMA.md` §9, `docs/DAT.md` §7, `docs/PROD_MIGRATIONS.md` §3, `CHANGELOG.md`,
      `webapp/src/lib/database.types.ts` (régénéré) mis à jour dans le même changement.
- [ ] **Aucun harnais dédié `scripts/verify-versionnement.sh`.** Les preuves de l'unité vivent
      désormais dans quatre fichiers ; un verdict d'ensemble ne s'écrit utilement qu'une fois les
      cinq tranches livrées, comme `CRM-077` l'a montré.

#### Troisième tranche — le plan de remappage des cards

- [x] **Spécification écrite avant tout code**, `docs/SPEC-workflow-engine.md` **§7 ter.12** (onze
      sections) : ce que le plan est et n'est pas, les trois issues d'une card et **la seule qui
      soit automatique**, les instructions portées par les étapes et non par les cards, le geste et
      ses huit refus dans l'ordre, quelles cards entrent dans le plan, la forme rendue, la liste
      bornée dont la troncature est annoncée, les autorisations, les quinze lignes du contrat
      d'API, ce qui n'est pas livré, les preuves attendues. `docs/SCHEMA.md` §9 mis à jour dans le
      même commit documentaire, poussé **avant** la première ligne de code (`CLAUDE.md` §5).
- [x] `supabase/migrations/0041_plan_remappage_cards.sql` : `public.plan_card_remapping(uuid,
      jsonb, integer)`, `stable`, `security invoker`, huit refus, privilèges explicites et
      révocation nommée d'`anon`. Appliquée et rejouée sur la pile réelle.
- [x] **AUCUNE DESTINATION N'EST DEVINÉE, et c'est la lecture littérale de la Definition of Done.**
      Une seule issue est automatique — `unchanged`, quand l'étape existe des deux côtés avec le
      même identifiant. Toute autre destination vient d'un humain, par `step_overrides`. Une
      affaire sans instruction reste `unresolved` et `ready` est faux : le produit dit « je ne sais
      pas » plutôt que de choisir à la place de l'administrateur.
- [x] **UNE ÉTAPE RÉTABLIE EST NOMMÉE, JAMAIS CHOISIE.** Une étape que la restauration ressuscite
      est vide par construction, et il aurait été tentant d'y verser les affaires des étapes
      retirées « puisqu'elle revient » : ce serait une supposition sur l'intention. L'assertion 23
      de la suite pgTAP la fige — l'étape rétablie est disponible, et les affaires bloquées le
      restent.
- [x] **`SECURITY INVOKER`, ET C'EST LA CONDITION DE JUSTESSE DU RÉSULTAT.** Un plan partiel est
      pire qu'un refus : il ferait échouer une restauration après l'avoir déclarée sûre. Or `cards`
      applique les droits fins dès sa politique de lecture. MESURÉ sur la pile seedée :
      l'administratrice lit **13 affaires sur 13** malgré un `track_members.access = 'none'` sur le
      track qui en porte six, là où la lectrice n'en lit que **7 sur 13**. L'exhaustivité vient donc
      de la **vérification 3**, non d'un emprunt de privilèges — d'où le refus opposé aux deux
      profils non administrateurs.
- [x] **Les cards ARCHIVÉES et celles en CORBEILLE entrent dans le plan.** Ce ne sont pas des lignes
      disparues : elles portent un `current_step_id` réel et une clé étrangère opposable
      (`docs/SPEC-cards.md` §4). Les exclure aurait rendu un plan qui se dit complet et une
      restauration qui échoue en base sur une affaire que personne ne regardait plus.
- [x] **La liste est BORNÉE et sa troncature est ANNONCÉE**, les compteurs portant sur la totalité ;
      et **l'ordre place les affaires bloquantes en tête**, sans quoi une troncature masquerait
      exactement ce qui empêche d'appliquer.
- [x] **Test unitaire dédié** `supabase/tests/0039_plan_remappage_cards.test.sql` :
      **37 assertions, aucune anomalie** — existence, `stable`, absence de `security definer`,
      privilèges et révocation d'`anon` ; l'exhaustivité mesurée sous droit fin `none`, et la
      lectrice qui en lit strictement moins — sans quoi la première assertion serait vraie sans rien
      prouver ; le cas nominal ; l'archivée et la corbeille avec leur `state` ; l'étape retirée,
      l'instruction qui lève le blocage, l'étape rétablie jamais choisie ; les compteurs
      indépendants de la borne et l'ordre des blocages ; les huit refus contre des comptes réels.
      **Aucun compte du seed n'y est figé en dur** : les assertions comparent des comptes entre eux.
- [x] **Test d'intégration dédié, hors interface** `e2e/api/plan-remappage-cards.spec.ts` :
      **15 scénarios**, les quinze lignes du §7 ter.12.9 avec les jetons réels des trois profils.
      La ligne n — preuve de refus n° 3 — crée un **second workspace réel**, absent du seed, y pose
      une version dont l'existence est constatée avec la clé de service, et démonte le tout : sans
      cela, le refus serait vrai par simple absence et ne prouverait rien (décision 50). Ces preuves
      attrapent aussi ce que pgTAP ne peut pas : le `401` de l'anonyme, et le fait que les arguments
      facultatifs `card_limit` et `step_overrides` traversent réellement PostgREST.
- [x] **Une preuve figée a rougi et a été RÉVISÉE, jamais contournée** (mécanisme de la décision 51,
      quinzième occurrence) : l'énumération des fonctions de
      `webapp/src/lib/database.types.test-d.ts` passe de vingt-neuf à trente, avec son motif écrit
      dans le fichier.
- [x] `docs/SCHEMA.md` §9, `docs/DAT.md` §7, `docs/PROD_MIGRATIONS.md` §3, `CHANGELOG.md`,
      `docs/manual.md` ligne 20 bis, `webapp/src/lib/database.types.ts` (régénéré) mis à jour dans
      le même changement.
- [ ] **Aucun harnais dédié `scripts/verify-versionnement.sh`.** Les preuves de l'unité vivent
      désormais dans six fichiers ; un verdict d'ensemble ne s'écrit utilement qu'une fois les cinq
      tranches livrées, comme `CRM-077` l'a montré.

#### Quatrième tranche — l'application transactionnelle et le retour arrière

- [x] **Spécification écrite avant tout code**, `docs/SPEC-workflow-engine.md` **§7 ter.13** (douze
      sections) : ce que l'application est et n'est pas, le plan rejoué dans la transaction, ce qui
      est restauré et ce qui ne l'est pas, les champs jamais supprimés, le point de retour publié,
      le geste et ses huit refus dans l'ordre, l'ordre des neuf écritures, la forme rendue, les
      autorisations, les dix-huit lignes du contrat d'API, ce qui n'est pas livré, les preuves
      attendues. `docs/SCHEMA.md` §9 mis à jour dans le même commit documentaire, poussé **avant**
      la première ligne de code (`CLAUDE.md` §5).
- [x] `supabase/migrations/0042_restauration_version_workflow.sql` :
      `public.restore_workflow_version(uuid, jsonb, text)`, `volatile`, `security definer`,
      propriétaire `postgres`, huit refus, privilèges explicites et révocation nommée d'`anon`.
      Appliquée et rejouée sur la pile réelle.
- [x] **LE PLAN EST REJOUÉ DANS LA TRANSACTION, JAMAIS TRANSMIS.** Un plan calculé six minutes plus
      tôt décrit un monde qui n'existe peut-être plus. La fonction appelle `plan_card_remapping`
      elle-même et exige `ready` ; ses huit refus **remontent tels quels**, avec leur message et
      leur `SQLSTATE`. La règle de remappage n'est donc écrite qu'**une fois**.
- [x] **LE RETOUR ARRIÈRE EST UN POINT DE RETOUR PUBLIÉ**, et non une seconde forme de conservation
      d'une composition à côté de `workflow_versions`. La composition vivante est publiée par la
      vraie RPC avant toute écriture — sauf lorsque la dernière version joue déjà ce rôle, ce
      qu'assure la vérification 5 du §7 ter.5 et non une garde propre à la restauration. Revenir en
      arrière est alors **le même code**, éprouvé par les mêmes preuves (assertions 28 à 30).
- [x] **`SECURITY DEFINER`, ET C'EST LA MESURE QUI L'A IMPOSÉ**, contre la première rédaction de la
      spécification qui retenait `invoker`. MESURÉ : `authenticated` ne détient l'`UPDATE` sur
      `public.cards` que **colonne par colonne**, sur douze colonnes, et `current_step_id` n'en fait
      pas partie — le privilège de colonne de `CRM-034`. Un `invoker` aurait échoué en `42501` sur
      le déplacement des affaires, y compris pour un administrateur. La spécification a été
      **corrigée et le motif écrit**, jamais changé en silence. Conséquence assumée et écrite à la
      main : la vérification 2 porte `app.is_workspace_member`, la RLS ne masquant plus les versions
      d'autrui — l'assertion 10 est la seule qui l'éprouve.
- [x] **UN CHAMP SURNUMÉRAIRE EST ARCHIVÉ, JAMAIS SUPPRIMÉ.** MESURÉ : `form_fields` ne porte
      **aucune politique `delete`** et `authenticated` n'a que `select`, `insert`, `update` ; la
      suppression d'un champ n'existe pas dans ce produit. Le supprimer pour rétablir une structure
      aurait détruit les saisies de `card_field_values`, qu'aucune version ne conserve.
- [x] **L'IDENTITÉ DU WORKFLOW N'EST PAS RESTAURÉE** — nom, portée, track, défaut, archivage. Ce
      sont le placement et l'identité, non la composition ; les rétablir aurait fait de la
      restauration un déménagement. La conséquence est **rendue** et non masquée : `matches_version`
      dit si l'empreinte obtenue égale celle de la version.
- [x] **L'ORDRE DES NEUF ÉCRITURES EST IMPOSÉ PAR DES CONTRAINTES MESURÉES**, non par un goût de
      séquence : `cards_current_step_id_workflow_id_fkey` est en `NO ACTION` — supprimer une étape
      portant une affaire échoue en `23503`, et c'est ce fait seul qui rend le plan obligatoire ;
      `workflow_steps_workflow_initial_uk` est un index unique **partiel**, d'où l'étape initiale
      démise avant d'être rétablie ; `workflow_steps_workflow_id_node_id_key` veut qu'un nœud
      n'apparaisse qu'une fois, d'où la suppression avant la création.
- [x] **Test unitaire dédié** `supabase/tests/0040_restauration_version_workflow.test.sql` :
      **30 assertions, aucune anomalie**. Une preuve d'écriture **relit la base** et ne se satisfait
      jamais du document rendu : l'affaire relue sur son étape (22), l'étape et l'arête relues
      absentes (24, 26), l'étape et l'arête revenues du point de retour relues **avec leurs
      identifiants d'origine** (29). L'assertion 4 fige le fait qui impose le `definer`, sans quoi
      la 3 serait vraie sans rien prouver ; l'assertion 10 crée un **second workspace réel** et
      exige le même refus qu'un identifiant inexistant (décision 50) ; l'assertion 20 relit
      l'affaire **après le refus** — un refus qui laisse une trace n'est pas un refus.
- [x] **Une preuve figée a rougi et a été RÉVISÉE, jamais contournée** (mécanisme de la décision 51,
      seizième occurrence) : l'énumération des fonctions de
      `webapp/src/lib/database.types.test-d.ts` passe de trente à trente et une, avec son motif
      écrit dans le fichier.
- [x] `docs/SCHEMA.md` §9, `docs/DAT.md` §7, `docs/PROD_MIGRATIONS.md` §3, `CHANGELOG.md`,
      `webapp/src/lib/database.types.ts` (régénéré) mis à jour dans le même changement.
- [x] **Test d'intégration dédié, hors interface** `e2e/api/restauration-version-workflow.spec.ts` :
      **14 scénarios couvrant les dix-huit lignes** du §7 ter.13.10 avec les jetons réels des trois
      profils. La ligne p — preuve de refus n° 3 — crée un **second workspace réel**, absent du seed,
      y pose une version dont l'existence est constatée avec la clé de service, et démonte le tout
      (décision 50). La ligne a reste sur la **vraie version du seed**, parce qu'elle n'écrit rien,
      et **relit le nombre de versions** pour prouver qu'elle ne laisse aucune trace ; toute ligne
      qui écrit se joue sur un workflow jetable rendu dans un `finally`, restaurer publiant un point
      de retour que le seed conserverait à chaque exécution.
- [x] **CE HARNAIS A ATTRAPÉ UN DÉFAUT QUE pgTAP NE POUVAIT PAS VOIR, et c'est sa justification.**
      La vérification 5 rendait **`400`** là où le §7 ter.13.6 exige `409`. MESURÉ par une sonde
      posée puis retirée sur la pile locale : PostgREST rend `400` pour tout `P0001`, et `409` pour
      un `SQLSTATE` de la forme `PT<statut>`. Les deux exigences de la spécification — `P0001` et
      `409` — étaient inconciliables. **Le `SQLSTATE` a cédé**, le code HTTP étant le seul des deux
      que la spécification argumentait ; message et `detail` inchangés. L'assertion 13 de la suite
      pgTAP, qui figeait `P0001`, a été **révisée avec son motif dans le fichier** (mécanisme de la
      décision 51, dix-septième occurrence), et le §7 ter.13.6, le §7 ter.13.10 et
      `docs/PROD_MIGRATIONS.md` portent la révision et son point de vérification.
- [ ] **Aucun harnais dédié `scripts/verify-versionnement.sh`.** Les preuves de l'unité vivent
      désormais dans huit fichiers ; un verdict d'ensemble ne s'écrit utilement qu'une fois les cinq
      tranches livrées, comme `CRM-077` l'a montré.

#### Cinquième tranche — les écrans

- [x] **Spécification écrite avant tout code**, `docs/SPEC-workflow-engine.md` **§7 ter.14** (neuf
      sections) : ce que les écrans sont et ne sont pas, l'adresse et le sixième bloc de l'éditeur,
      la lecture 8 et son profil embarqué, les quatre gestes, les instructions de remappage saisies
      sur les **étapes retirées**, le nommage d'un élément de comparaison en quatre replis, le
      dictionnaire fermé des refus, les états et ce que la tranche ne livre pas, les preuves
      attendues. `docs/DESIGN_SYSTEM.md` §5.15 complété dans le même commit documentaire, poussé
      **avant** la première ligne de code (`CLAUDE.md` §5).
- [x] `webapp/src/lib/versions-workflow.ts` : la lecture 8 avec son profil embarqué, les quatre
      appels, la lecture **défensive** des documents `jsonb` rendus — aucun `undefined` n'atteint
      l'écran —, la composition des instructions de remappage, le nommage d'un élément en quatre
      replis et le dictionnaire fermé de quinze refus.
- [x] `webapp/src/app/BlocVersionsWorkflow.tsx`, monté par `AdministrationWorkflows.tsx` : le
      sixième bloc — liste des versions, publication, aperçu de comparaison, aperçu du plan avec
      ses listes de destination, restauration et sa confirmation dans le flux.
- [x] **AUCUNE COMMANDE N'EST ÉTEINTE D'AVANCE**, y compris « Restaurer » sous un plan non
      applicable : la garde est la vérification 7 du §7 ter.13.6, et un bouton grisé ferait passer
      une règle de base pour une décision d'interface (`CLAUDE.md` §10).
- [x] **`expected_live_fingerprint` n'est pas transmis, et le motif est mesuré** : aucune RPC
      publique ne rend l'empreinte vivante d'un workflow, le schéma `app` n'étant pas exposé par
      PostgREST (§7 ter.13.10, ligne c). La garde n'est pas perdue — la restauration rejoue le plan
      dans sa propre transaction. L'écart est nommé au §7 ter.14.8, et une assertion l'éprouve.
- [x] **Test unitaire dédié** `webapp/src/lib/versions-workflow.test.ts` : **53 assertions** — la
      lecture 8 avec ses colonnes, son filtre et son ordre réellement émis ; une ligne amputée qui
      ne rend jamais `undefined` ; le choix par défaut, y compris à une seule version ; les quinze
      messages du dictionnaire et son repli ; les quatre replis du nommage, identité composée
      comprise ; l'instruction qu'une étape sans choix n'engendre pas. **Trois assertions écrites
      en négatif** : `card_limit` et `expected_live_fingerprint` ne partent pas.
- [x] **Test E2E d'interface dédié** `e2e/ui/versions-workflow.spec.ts` : **10 scénarios** sur la
      vraie base — la liste du seed et son auteur nommé, le workflow dérivé sans version, la
      publication refusée en `composition inchangee` **affichée**, la comparaison d'une version à
      elle-même, le plan à treize affaires avec son verdict, et le **refus opposé à la lectrice
      avec ses droits réels**, constaté et non simulé. Aucun scénario n'écrit dans le seed.
- [x] **Captures observées** aux quatre paliers, versions et plan, sous `docs/captures/CRM-078/`.
      **Une correction vient de cette observation** : la liste « Version à restaurer » garde la
      largeur de son contenu — étirée sur toute la colonne, elle se lisait comme un champ de saisie.
- [x] `docs/manual.md` **§5 bis.6 et §5 bis.7** : le chapitre rédigé que la première tranche
      annonçait, et la ligne 20 bis du sommaire portée de « sans écran » à **livré**.
      `CHANGELOG.md` et `docs/DESIGN_SYSTEM.md` §5.15 mis à jour dans le même changement.
- [ ] **Aucun harnais dédié `scripts/verify-versionnement.sh`.** Les preuves de l'unité vivent
      désormais dans dix fichiers ; un verdict d'ensemble s'écrirait maintenant utilement, les cinq
      tranches étant livrées — mais il n'est pas exécutable dans cet environnement, qui n'offre pas
      le couple Node 24 / npm 11+ que tous les harnais exigent (`docs/JOURNAL.md`, 2026-08-15).

*Écart nommé.* **Aucun seed** dans cette tranche non plus : la restauration ne conserve rien qu'une
version ne conserve déjà, et fabriquer une divergence dans le seed pour donner une restauration à
montrer serait une donnée fabriquée pour la preuve (`CLAUDE.md` §8). La suite pgTAP construit
elle-même ce qu'elle restaure, par les vrais gestes, et rend le seed intact par `rollback`.

*Écart nommé.* **Aucun seed** dans cette tranche non plus : le plan ne conserve rien, et publier une
seconde version ou déplacer une affaire pour donner un plan bloqué à montrer serait une donnée
fabriquée pour la preuve (`CLAUDE.md` §8). Les preuves construisent elles-mêmes ce qu'elles
planifient, par les vrais gestes.

*Écart nommé.* **Aucun seed** dans cette tranche : la comparaison ne conserve rien, et publier une
seconde version pour donner à comparer serait une donnée fabriquée pour la preuve (`CLAUDE.md` §8).
Les preuves publient elles-mêmes ce qu'elles comparent, par la vraie RPC.

*Écart nommé.* **Aucun écran, aucune capture** dans les deux premières tranches : elles ne livrent
que des données et des gestes serveur (`docs/SPEC-workflow-engine.md` §7 ter.9 et §7 ter.11.7).
L'unité **ne peut pas** passer `[x]` avant la cinquième tranche, dont la Definition of Done exige
l'aperçu et les captures.

*Statut, 2026-08-15.* **`[x]`, les cinq tranches livrées et prouvées.** La cinquième livre les
écrans que la Definition of Done exigeait — « aperçu exhaustif […] pgTAP/API/E2E et captures » — et
la campagne complète a été rejouée après elle : `test:sql` **40 fichiers, 2133 assertions**,
`e2e:api` **591/591**, `e2e:ui` **275/275** dont les 10 neufs, `e2e:mail` **42/42**,
`test:unit` **1099/1099** sur 40 fichiers, `python3 -m pytest mail-sync/tests` **242 passés**,
`typecheck` et `build` verts.

*Écart nommé, et il ne relève PAS de la Definition of Done.* `scripts/verify-versionnement.sh`
n'est **pas écrit**. Il serait désormais utile, les cinq tranches étant livrées, et il est
**désormais exécutable** : le blocage Node 24 est levé, `nvm install 24` posant `v24.19.0` /
`npm 11.17.0` sur cet hôte (procédure mesurée et consignée dans `docs/CloudWorker.md` §2.1 bis, le
2026-08-15). Il reste à écrire, et à écrire seulement une fois qu'une session peut réellement
l'exécuter — un harnais non éprouvé n'est pas une preuve (`CLAUDE.md` §25).

*Preuves restant à exécuter pour cette unité.* **Aucune.** La première tranche redevient
intégralement verte sur une base neuve — **31 assertions sur 31** — l'arbitrage de la **décision
430** ayant été appliqué à ses assertions 3 et 28 : le workflow dérivé s'y désigne désormais **par
son nom**, seule de ses propriétés que le seed fixe, et l'empreinte du dérivé est éprouvée par sa
propriété **relative** — la fonction appelante rend exactement le condensé du document extrait —
plutôt que comparée à une constante qu'aucune base ne reproduit. L'assertion 2 **garde** sa
constante : l'identifiant du workflow par défaut est épinglé, et cette constante est la seule qui
protège la FORME du document. Les deuxième et troisième tranches rendent 31 et 37 assertions pgTAP,
et 12 et 15 scénarios d'API, tous verts. **INC-122 est close** : elle est retirée du registre par
l'arbitrage, et sa mise en œuvre est livrée ici.

*Constat étranger, consigné et laissé inchangé.* `scripts/verify-preuves-refus.sh` rend **4
anomalies sur 26** — trois compteurs figés périmés de plusieurs unités, et neuf preuves de refus non
écrites. L'antériorité est établie : le compteur pgTAP était figé à 65 et vert avant cette session,
là où ce harnais en attend 55. **INC-121**, porteur `CRM-014`.

### CRM-079 — Onboarding guidé `[x]`

Parcours du premier lancement fondé sur les vrais écrans déjà livrés, interrompable et relançable,
sans tracker ni stockage persistant non consenti. **DoD** : clavier, mobile, reprise de session,
états incomplets et console stricte prouvés ; aucun écran factice ne remplace une fonctionnalité.

**Spécification écrite et committée avant tout code le 2026-08-15 : `docs/SPEC-onboarding.md`**,
neuf sections, mesurée sur la pile seedée (§3.1), avec `docs/DESIGN_SYSTEM.md` §5.17 dans le même
commit. Le principe qu'elle pose est le suivant, et il conditionne le reste : **la progression est
une mesure, jamais un drapeau** — cinq comptages sur des tables déjà lues, aucun état persisté,
aucune politique RLS ouverte.

**Livré et prouvé le 2026-08-15.** Le module de mesure `webapp/src/lib/demarrage.ts` (§3), l'écran
`GuideDemarrage` et ses deux surfaces (§4.1 et §4.2), l'adresse `/demarrage`, l'entrée en tête de
l'index des réglages (§4.3), le masquage limité à la session (§5) et les trois états d'étape (§6.2).
La règle du §4.4 — **aucune mesure sans session** — a été ajoutée en cours de session : la clé
anonyme reçoit `401` sur `mail_inbound_accounts`, et mesurer sans session écrivait une erreur dans
la console de l'accueil d'un visiteur.

*Preuves exécutées.* **24** assertions unitaires d'écran et **19** de module ; `test:unit`
**1148/1148** ; `e2e:ui` **285/285**, dont les 10 scénarios de `e2e/ui/demarrage.spec.ts` — clavier
seul, mobile, masquage et reprise après rechargement, `localStorage` vide, étape non mesurable et
reprise réelle ; **`e2e/api/demarrage.spec.ts` 6/6**, qui établit HORS INTERFACE les trois faits du
§3.1 que l'écran ne peut pas établir seul — la lectrice compte moins de channels et d'affaires que
l'administratrice, elle compte **zéro** boîte entrante là où le seed en porte trois, et
`mail_inbound_accounts` est la **seule** des cinq tables à refuser la clé anonyme ;
`test:sql` **2133 assertions** ; `e2e:api` **597/597** ; `pytest` **242 passés** ; `typecheck` et
`build` verts ;
`scripts/verify-webapp.sh` **42 contrôles sans anomalie**. Captures aux quatre paliers plus
l'accompli, le masqué et le non mesurable, produites **et observées** sous `docs/captures/CRM-079/`.

*Les trois manques de la Definition of Done sont soldés. L'unité est close le 2026-08-16.*

- [x] **`scripts/verify-onboarding.sh` est écrit, exécuté et vert — 2026-08-16.** **27 contrôles,
      aucune anomalie.** Son contrat est spécifié **avant son code** au §8 bis de
      `docs/SPEC-onboarding.md` : comptes figés avec leur date de mesure, ce qu'il ne prouve pas, et
      la restauration constatée octet à octet contre un instantané pris avant — jamais contre `HEAD`.
      Il fige les **fichiers autant que les tests** (décision 279) : Vitest **2 fichiers / 43
      tests**, API **6 scénarios**, UI **10 scénarios**, **9 captures**. Il **ne fige aucun compte
      pgTAP**, et c'est une propriété de l'unité, pas un oubli : `CRM-079` n'ajoute aucune migration
      et n'ouvre aucune politique — les cinq lectures sont régies par `CRM-020`, `CRM-021`,
      `CRM-040`, `CRM-022` et `CRM-052`, prouvées par leurs propres suites.
      **Il est NON COMPLAISANT** : cinq dégradations réelles des deux fichiers de l'unité, chacune
      attaquant une règle nommée — le filtre de corbeille (§3), le refus du `count` absent (§3.2),
      le seuil d'accomplissement et le maintien du guide sur une étape non mesurable (§6.2), et la
      garde de session (§4.4) : « la garde de session saute — l'accueil mesurerait sans session et
      salirait la console ». **Les cinq sont vues**, et la restauration **octet à octet** de
      `demarrage.ts` comme de `GuideDemarrage.tsx` est constatée après chacune. La quatrième était
      d'abord **INAPPLICABLE**, et le harnais l'a dit au lieu de la compter verte : un `&` dans le
      remplacement est substitué par `sed` avec le motif entier, si bien que le contrôle qui suit
      cherchait une chaîne jamais écrite. Corrigée, motif écrit dans le fichier.
      *Deux conditions d'hôte, mesurées et consignées au §2.1 ter de `docs/CloudWorker.md`* :
      `export PLAYWRIGHT_CHROMIUM_PATH=/opt/pw-browsers/chromium`, et **aucun `vite preview`
      résiduel sur le port 4173**. Sans elles, ce harnais rend des échecs qui ne disent rien du
      produit (INC-123).
      *`scripts/verify-node-toolchain.sh` **5/5**, et il recense désormais **34** harnais Node/npm
      protégés, le nouveau compris.*
- [x] **`docs/manual.md` décrit le parcours du premier lancement — chapitre 1 *bis*, 2026-08-16.**
      Les cinq étapes et où chacune se fait, puis les trois points qu'un utilisateur ne peut pas
      deviner : l'état est **mesuré à chaque affichage** et non mémorisé — supprimer le dernier
      track décoche l'étape —, le guide rapporte ce que le compte **voit** et non ce qui existe, et
      le masquage est limité à la session sans rien écrire durablement sur l'appareil. Écrit
      d'après les libellés réels du catalogue. Sommaire mis à jour.
      *`scripts/verify-manual.sh` **117 contrôles sans anomalie**, contre 113 avant le chapitre.*
- [x] **Le cas « espace de travail neuf » est éprouvé — 2026-08-16.** Le onzième scénario de
      `e2e/ui/demarrage.spec.ts` monte un workspace **sans aucun objet** et son compte `admin` avec
      la clé de service, ouvre l'accueil avec le **jeton réel** de ce compte, et constate l'état que
      le §1 décrit : « 1 étape(s) sur 5 », la première accomplie par la connexion, les quatre autres
      à faire avec leur phrase d'absence et leurs liens jamais éteints.
      *Il établit la distinction du §6.2 que rien n'éprouvait* : les quatre étapes sont **à faire**
      et non « non mesurable », `mail_inbound_accounts` rendant `200` et zéro pour une session
      ouverte — le `401` du §3.1 est celui de la clé **anonyme**. Contrat écrit au **§8 ter** de
      `docs/SPEC-onboarding.md` et committé **avant le code**.
      **Le seed n'est PAS étendu, et c'est une décision motivée** : `CRM-005` pose « un workspace »
      et le contrôle n° 1 de `scripts/verify-seed.sh` échoue sur tout second workspace en base. La
      preuve fabrique son espace et le détruit, suivant le second terme de `docs/SPEC-seed.md` §8
      et le précédent de `scripts/verify-authz.sh`. Le démontage **constate** qu'il ne reste qu'un
      workspace — `scripts/verify-seed.sh` rend **55 contrôles, aucune anomalie** après le passage.
      *`scripts/verify-onboarding.sh` **28 contrôles, aucune anomalie**, ses cinq dégradations
      toujours vues ; `e2e:ui` **286/286**, console vierge ; capture
      `docs/captures/CRM-079/guide-espace-neuf-1440.jpg` produite et **observée**.*

### CRM-081 — Snooze des fils et des cards `[ ]`
*Unité inchangée, **renumérotée depuis `CRM-075`** le 2026-08-11 par la décision 335 pour lever la
collision avec l'administration de l'arborescence. Son objet n'est pas modifié ici : elle reste
décrite par sa seule ligne de la table du chunk 5, comme les autres unités de ce chunk qui n'ont
pas encore d'énoncé détaillé.*

### CRM-080 — Sauvegardes chiffrées et restauration prouvée `[ ]`

Sauvegarde planifiée de la base et des objets, chiffrement avec secret hors dépôt, rétention,
contrôle d'intégrité et restauration régulière dans un environnement isolé. **DoD** : une preuve
restaure réellement un snapshot, compare les invariants et détruit seulement l'environnement
jetable ; runbook production, alertes et rotation documentés.
