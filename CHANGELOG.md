# Changelog

Toutes les modifications notables du projet sont consignées ici.

Deux sections structurent ce fichier :

- **[Non publié]** — ce qui existe dans le code courant mais n'est **pas encore déployé et
  vérifié en production** ;
- **[Publié]** — uniquement ce qui est réellement actif et vérifié en production.

Un changement n'est jamais déclaré publié tant que la production n'a pas été constatée en train
d'exécuter le code attendu.

## [Non publié]

### Ajouté

- **`CRM-011` — Spécification de l'authentification, écrite avant tout code.**
  - `docs/SPEC-auth.md` : cycle de vie d'un compte de bout en bout — inscription libre refusée,
    invitation, acceptation, connexion, session, déconnexion, réinitialisation de mot de passe —,
    politique de mot de passe, contenu du jeton, et les **20 preuves de refus et d'acceptation**
    exigées, toutes exécutées hors interface.
  - Spécification rédigée **après mesure** du comportement réel de `supabase/gotrue:v2.189.0` et
    non de mémoire : GoTrue est un service tiers dont le comportement fait autorité.
  - Mesure notable : le refus d'inscription libre **n'est pas contournable par le privilège** — la
    clé `service_role` est refusée exactement comme la clé anonyme.
  - Mesure notable : l'API ne renseigne pas sur l'existence d'un compte — adresse inconnue et mot
    de passe erroné rendent le même message, et `recover` sur une adresse inconnue rend `200` sans
    émettre d'email.
  - Décisions 29 à 31 consignées dans `docs/JOURNAL.md` ; contradictions **INC-015** (parcours
    d'invitation sans composant pour le porter) et **INC-016** (gabarits d'emails, repli silencieux
    vers l'anglais) consignées sans résolution implicite.

- **`CRM-011` — Authentification durcie et prouvée hors interface (partiel : ni écran ni E2E
  d'interface avant `CRM-007`).**
  - **La longueur minimale de mot de passe passe de 6 à 12** (décision 29). Le défaut de GoTrue
    n'était pas théorique : un mot de passe de six caractères était **réellement accepté**.
    Nouvelle variable `PASSWORD_MIN_LENGTH`, documentée dans `.env.example` et câblée dans le
    service `auth`. Prouvée dans les deux sens — onze caractères refusés, douze acceptés.
  - `scripts/verify-auth.sh` : harnais de preuves rejouable, **42 contrôles, aucune anomalie**,
    couvrant les vingt scénarios de `docs/SPEC-auth.md` §7 — invitation, acceptation **en suivant
    le lien de l'email reçu**, connexion, refus, contenu du jeton, session, déconnexion,
    réinitialisation menée à son terme, suppression.
  - **Le harnais commence par comparer la configuration réellement appliquée au conteneur aux
    valeurs du `.env`** : sans ce contrôle, tous les suivants mesureraient les défauts de l'image
    en croyant mesurer le produit.
  - **Non-complaisance éprouvée dans les deux sens** : un GoTrue **jetable**, même version
    épinglée, portant le réglage affaibli, doit accepter ce que la pile refuse ; et le harnais a été
    **réellement mis en échec** contre la pile affaiblie — `DISABLE_SIGNUP=false` produit
    6 anomalies, `PASSWORD_MIN_LENGTH=6` en produit 2.
  - **Vérification visuelle observée** : `docs/captures/CRM-011/` — moniteur Inbucket et les deux
    emails ouverts. Constat relevé à cette occasion : les emails de GoTrue sont en **HTML seul**,
    sans partie `text/plain` (INC-016).
  - **Comportement d'exploitation mesuré et documenté** : une variable ajoutée au gabarit
    n'atteint pas un `.env` existant, mais la garde de `CRM-002` refuse le démarrage et **nomme**
    la variable manquante. Marche à suivre écrite dans `docs/PROD_MIGRATIONS.md` §4.
  - `README.md` §7, §9, §10 et §11, `docs/DAT.md` §4.1 et §7, `docs/PROD_MIGRATIONS.md` §2 et §4,
    `docs/manual.md` mis à jour. **INC-017** relevée au passage : `README.md` §11 annonce encore
    comme non vérifié ce que `CRM-004` a mesuré — consignée, non corrigée ici, car elle relève
    d'un autre périmètre.

- **`CRM-010` — Fonctions d'autorisation (partiel : 4 fonctions sur 6, voir INC-013).**
  - `supabase/migrations/0002_fonctions_autorisation.sql` : `app.resolve_access`,
    `app.workspace_role`, `app.is_workspace_member`, `app.is_workspace_admin`. **Aucune politique
    RLS** — le refus par défaut posé par `CRM-003` reste intact, ce que les preuves vérifient
    explicitement.
  - **L'algorithme de résolution des droits fins est isolé des tables qu'il ne peut pas encore
    lire** (décision 25). `app.resolve_access(ws_role, track_access, channel_access)` est une
    fonction **pure** : elle se prouve par énumération **exhaustive** de ses **64 combinaisons**
    d'entrées, sans fixture ni compte. Les quatre fonctions différées n'auront plus qu'à lire leur
    ligne et l'appeler.
  - **L'absence de récursion est démontrée en la provoquant** (décision 27) : une politique
    auto-référente échoue en `42P17`, une jumelle `SECURITY INVOKER` épuise la pile en `54001`, et
    la même politique adossée à la fonction livrée répond sans erreur avec le filtrage attendu.
    Fait relevé au passage, contraire à l'attente : PostgreSQL **ne détecte pas** la récursion
    lorsqu'elle traverse une fonction.
  - **Les droits ne sont pas portés par le jeton** : l'appartenance retirée, le même jeton non
    expiré cesse immédiatement d'ouvrir des droits. Mesuré en base **et** sous PostgREST.
  - **`EXECUTE` est accordé à `anon`** (décision 26), pour que le refus d'un appelant anonyme reste
    **zéro ligne** au lieu d'une erreur de privilège. Le droit n'ouvre rien, et `PUBLIC` reste
    exclu — vérifié sur l'ACL des quatre fonctions.
  - `scripts/verify-authz.sh` : harnais de preuves rejouable, **26 contrôles, aucune anomalie**, et
    non complaisant — sept affaiblissements volontaires le font échouer. Suite pgTAP
    `supabase/tests/0002_fonctions_autorisation.test.sql` : **127 assertions, aucune anomalie**.
  - Preuves **hors interface** avec les jetons réels de trois profils : chaque profil ne voit que
    son workspace, l'anonyme obtient `200` et `[]` (preuve n° 11), un `viewer` ne modifie rien, un
    administrateur d'un autre workspace non plus (preuve n° 3). Le schéma `app` n'étant pas exposé
    par l'API, deux politiques d'instrumentation sont posées temporairement puis retirées, et
    l'absence de toute politique résiduelle est vérifiée (décision 28).
  - `docs/INCONSISTENCY_REPORT.md` : **INC-013 ouverte** — quatre des six fonctions dépendent de
    `tracks`, `channels` et `cards`, livrées deux chunks plus tard ; trois options d'arbitrage sont
    proposées, à trancher avant `CRM-012`. **INC-014 ouverte** — aucune unité ne porte nommément
    les politiques RLS des tables d'identité, ni la preuve de refus n° 10.
  - `docs/SCHEMA.md` §9, `docs/SPEC-permissions-rls.md` §3, §3.1, §3.2, `docs/DAT.md` §7,
    `docs/PROD_MIGRATIONS.md` §3, `README.md` §5 et §7 mis à jour dans le même changement.
  - **L'unité reste `[~]`** : les quatre fonctions `can_*` ne sont pas livrables dans l'ordre
    actuel du plan.

- **`CRM-004` — Chiffrement des secrets de messagerie : hypothèse levée, décision prise.**
  - `scripts/verify-vault.sh` : harnais de preuves rejouable et **autonome** — il ne dépend ni de
    `.env` ni de la pile en cours d'exécution, crée ses propres conteneur et volumes jetables et
    les détruit en sortant. **26 vérifications, aucune anomalie.**
  - L'image **réellement épinglée** par `docker-compose.yml` est mesurée, et non supposée :
    `supabase_vault` **0.3.1** présente, déjà installée et préchargée ; `pg_cron` **1.6.4**
    disponible, préchargé et fonctionnel ; `pgcrypto` 1.3, `pg_net` 0.20.3, `pgtap` 1.3.3.
  - **Vault est retenu ; le repli `pgcrypto` est abandonné** (décision 23). Entretenir un second
    chemin de chiffrement que rien n'obligerait à exercer reviendrait à ne jamais l'éprouver avant
    le jour où il servirait.
  - Cloisonnement mesuré **hors interface** avec les rôles réels : `anon` et `authenticated` sont
    refusés sur le schéma `vault` tout entier — donc plus fortement qu'un `REVOKE` de colonne —,
    tandis que `service_role` lit, déchiffre et crée. Le `REVOKE` sur `secret_id` reste exigé : il
    porte sur des tables de `public`, exposées par PostgREST.
  - **La clé racine de Vault vit hors de `PGDATA`** (décision 24), dans le volume `db-config`.
    Mesuré : PGDATA restauré sans elle, le chiffré subsiste et le déchiffrement échoue. Elle
    devient un **élément obligatoire du périmètre de sauvegarde** — `docs/DAT.md` §10 et
    `docs/PROD_MIGRATIONS.md` §2.1, §5, §6, §7.
  - `docs/INCONSISTENCY_REPORT.md` : **INC-001 close**, avec sa mesure et sa décision. **INC-012
    ouverte** : la mesure dément le motif principal de la décision 8 — `pg_cron` est disponible.
    Le résultat de la décision est conservé, son énoncé corrigé dans `docs/DAT.md` §3.3 et §12, et
    la réouverture de l'arbitrage est laissée au responsable.
  - `docs/DAT.md` §8, §10, §12, §15, `docs/SCHEMA.md` §11, `docs/SPEC-mail-subsystem.md` §2.3,
    `README.md` §5, §7, §12 mis à jour dans le même changement.
  - **Débloque `CRM-052` et `CRM-053`.**

- **`CRM-003` — Migrations d'amorçage : identité et cloisonnement.**
  - `supabase/migrations/0001_identite_et_cloisonnement.sql` : extension `pgcrypto`, schéma `app`
    (non exposé par l'API REST), et les cinq tables de `docs/SCHEMA.md` §1 — `profiles`,
    `workspaces`, `workspace_members`, `track_members`, `channel_members`.
  - Création automatique du profil à l'ouverture d'un compte, par trigger sur `auth.users` : le
    seul point qui capte tous les modes de création — invitation, seed, API d'administration.
  - **Refus par défaut** : RLS activée sur les cinq tables, sans aucune politique. Une lecture
    anonyme ou authentifiée retourne zéro ligne, une écriture est refusée, jusqu'aux politiques de
    `CRM-010` et `CRM-012`. Les privilèges de table sont posés explicitement plutôt qu'hérités des
    privilèges par défaut de l'image.
  - Les migrations du dépôt sont **idempotentes** : le `migrations-runner` ne tient aucun registre
    et rejoue tout le répertoire à chaque démarrage.
  - `supabase/tests/0001_identite_et_cloisonnement.test.sql` : suite pgTAP de l'unité
    (**70 assertions**).
  - `scripts/verify-migrations.sh` : harnais rejouable des preuves de l'unité (**23 contrôles**),
    dont la création d'un compte par l'API d'administration GoTrue et les refus mesurés hors
    interface avec les jetons réels.
- **`CRM-002` — Scripts de lancement et contrat d'environnement.** *(unité `[~]` : une preuve
  reste bloquée par une dépendance, voir les notes)*
  - `.env.example` : gabarit documenté des **76** variables — rôle, format, caractère
    obligatoire, valeur d'exemple non sensible. Aucun secret réel ; les valeurs sensibles portent
    un marqueur `CHANGE_ME_*`.
  - `runDev.sh` : amorce `.env` au premier lancement en **tirant chaque secret au hasard**, en
    mode `600`, sans jamais écraser un fichier existant. `ANON_KEY` et `SERVICE_ROLE_KEY` sont
    dérivées du `JWT_SECRET` produit, sous forme de jetons HS256 valides. Options `--dev`,
    `--withLog <composant>`, `--bootstrap`, `--stop`.
  - `runProd.sh` : démarre l'assemblage de production. N'amorce jamais de fichier
    d'environnement et n'invente aucun secret ; refuse un profil de développement et refuse
    `APPLY_MIGRATIONS=true`.
  - `resetMe.sh` : détruit la base et les volumes locaux, redémarre à froid, rejoue les
    migrations, puis le seed s'il existe. Refuse tout profil autre que `dev` et exige une
    confirmation explicite.
  - `scripts/lib/env.sh` : socle commun — lecture du fichier d'environnement, amorçage,
    validation contre le gabarit, gardes de profil.
  - `scripts/verify-scripts.sh` : harnais rejouable des preuves de l'unité (**38 contrôles**).
  - Nouvelle variable `P2ENJOY_ENV_PROFILE` (`dev` ou `prod`), garde des trois scripts.
  - `STACK_RLIMIT_NOFILE` s'ajuste à la limite dure de l'hôte lors de l'amorçage, et le signale.
- **`CRM-001` — Pile Supabase self-hosted, à versions épinglées.**
  - `docker-compose.yml` : assemblage commun — PostgreSQL 17, GoTrue, PostgREST, Realtime,
    Storage, Supavisor, Kong, et un conteneur `migrations-runner` qui rejoue
    `supabase/migrations/*.sql` au démarrage.
  - `docker-compose.dev.yml` : Supabase Studio, `postgres-meta`, MinIO et Inbucket, tous publiés
    sur l'interface de bouclage uniquement.
  - `docker-compose.prod.yml` : Caddy pour TLS et fichiers statiques, aucun outillage de
    développement, ni Kong ni PostgreSQL exposés.
  - `supabase/docker/` : configuration déclarative de Kong et scripts d'initialisation de la
    base, repris de la distribution self-hosted officielle.
  - `caddy/Caddyfile` : terminaison TLS, en-têtes de sécurité, application monopage.
  - `scripts/verify-stack.sh` : harnais rejouable des preuves de la Definition of Done
    (33 contrôles).
  - Le stockage vise **toujours** S3 : MinIO en développement, fournisseur réel en production.
  - Captures de vérification visuelle : `docs/captures/CRM-001/`.
- Amorçage du dépôt : `.gitignore`, `.editorconfig`, `.nvmrc` (Node 24).
- Documentation de référence complète, rédigée et committée **avant tout code**, conformément à
  la règle de persistance immédiate des décisions :
  - `README.md` — objectif, stack, prérequis, commandes, variables, structure, limites connues ;
  - `docs/DAT.md` — architecture technique, composants, flux, déploiement, compromis ;
  - `docs/SCHEMA.md` — modèle de données complet et contraintes ;
  - `docs/DESIGN_SYSTEM.md` — charte P2Enjoy appliquée au CRM, tokens, composants, accessibilité ;
  - `docs/SPEC-workflow-engine.md` — catalogue de nœuds partagé, workflows dérivables par track,
    transitions contraintes appliquées côté base ;
  - `docs/SPEC-form-composer.md` — champs conditionnels par étape et validation au moment de la
    transition ;
  - `docs/SPEC-mail-subsystem.md` — comptes entrants IMAP et identités sortantes SMTP découplés,
    classement des messages, dossiers imbriqués, file d'envoi résiliente ;
  - `docs/SPEC-permissions-rls.md` — rôles, politiques RLS et preuves de refus exigées ;
  - `docs/MASTER_PLAN.md` — index d'exécution autoritatif référencé par les commentaires `@spec` ;
  - `docs/BACKLOG.md` — unités `CRM-NNN` avec leur Definition of Done ;
  - `docs/JOURNAL.md` — décisions de conception et leurs justifications ;
  - `docs/PROD_MIGRATIONS.md` — contrat de déploiement et prérequis manuels ;
  - `docs/manual.md` — manuel utilisateur ;
  - `docs/INCONSISTENCY_REPORT.md` — registre des contradictions en attente d'arbitrage.

### Notes

- La pile d'exécution et son outillage de lancement sont livrés et vérifiés, mais **aucun code
  applicatif ni aucune migration** ne l'est encore : `supabase/migrations/` est vide, il n'y a ni
  webapp ni service `mail-sync`.
- `CRM-002` reste `[~]` : la branche « rejoue le seed » de `resetMe.sh` **n'a pas pu être
  prouvée**, faute de seed — c'est l'objet de `CRM-005`, planifiée plus tard. Contradiction
  d'ordonnancement consignée dans `docs/INCONSISTENCY_REPORT.md`, INC-009. Aucun seed factice
  n'a été fabriqué pour rendre la preuve verte.
- Limites de vérification nommées dans `docs/BACKLOG.md` (`CRM-001`, `CRM-002`) : valeur par
  défaut de `STACK_RLIMIT_NOFILE` non éprouvée, certificat ACME non obtenu, production démarrée
  contre un fournisseur S3 simulé.
- Les commandes `npm` annoncées sans `package.json` — dont `npm run stop`, attribué à `CRM-002` —
  sont consignées dans `docs/INCONSISTENCY_REPORT.md`, INC-008. L'arrêt propre passe par
  `./runDev.sh --stop` et `./runProd.sh --stop`.

## [Publié]

_Rien à publier pour le moment._
