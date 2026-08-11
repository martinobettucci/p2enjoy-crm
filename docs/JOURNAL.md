# Journal de conception — P2Enjoy CRM

Trace chronologique des décisions et investigations significatives. Chaque entrée précise, selon
sa pertinence : le problème, les hypothèses, les observations, les solutions envisagées, la
décision, ses conséquences et les vérifications réalisées.

---

## 2026-08-03 — Cadrage initial et décisions structurantes

### Contexte

Dépôt vide, hormis `CLAUDE.md`. Besoin exprimé : un CRM de suivi de projets organisé en tracks
et channels, avec workflows combinables par nœuds, formulaires conditionnels par statut, et une
adresse email par card alimentant ses pièces jointes.

### Observations préalables

Inspection des dépôts voisins pour éviter de réécrire ce qui existe :

- `../starter.2025.12/` : pile Supabase self-hosted officielle, versions épinglées, avec un
  `migrations-runner` appliquant `supabase/migrations/*.sql` au démarrage, un overlay MinIO pour
  le stockage S3, et un overlay de développement fournissant Studio et Inbucket
  (`supabase-mail`, SMTP 2500 → 54325, interface 9000 → 54324). Scripts `runMe.sh` / `resetMe.sh`
  et configuration Caddy réutilisables.
- `../event-os-revamp/` : application React 18 + Vite + TypeScript + Tailwind + lucide-react,
  harnais Playwright découpé en projets `api` et `ui`, et conventions documentaires maison. Son
  `docs/DESIGN_SYSTEM.md` formalise déjà la charte P2Enjoy.

Vérifications d'environnement exécutées : Node 24.14.1, npm 11.11.0, Docker 29.6.1 avec Compose
v5.1.4, Python 3.13.2. La CLI `supabase` n'est **pas** installée — sans conséquence, la pile
retenue est le self-hosting par Docker Compose, pas la CLI.

### Décision 1 — Hiérarchie : workspaces multi-espaces

*Problème.* La demande mentionnait « des comptes dans lesquels suivre les projets », formulation
ambiguë : comptes utilisateurs, espaces cloisonnés, ou entité « compte client » ?

*Options.* Espace unique avec les tracks au sommet ; workspaces cloisonnés ; entité « compte
client » transverse rattachée aux cards.

*Décision du responsable.* **Workspaces multi-espaces**, cloisonnés par RLS.

*Conséquences.* Toutes les tables métier portent `workspace_id`, y compris lorsqu'il serait
déductible par jointure, afin que les politiques RLS restent simples et indexables. Un niveau de
navigation supplémentaire apparaît dans l'interface. L'entité « compte client » n'est pas
abandonnée : elle est traitée par `organizations` et `contacts` (unité `CRM-060`).

### Décision 2 — Workflows : graphe contraint et catalogue de nœuds partagé

*Problème.* « Workflow combinable par nodes » pouvait désigner un simple ordre de colonnes ou un
véritable graphe. Et rien n'indiquait si les nœuds étaient propres à chaque workflow.

*Décision du responsable.* **Graphe à transitions explicitement déclarées, appliquées côté
backend**, composé de nœuds issus d'un **catalogue partagé** par workspace.

*Conséquences.* Une transition non déclarée est refusée par `move_card`, pas seulement masquée
dans l'interface. Le catalogue partagé rend l'analytique comparable d'un channel à l'autre
(unité `CRM-066`) : « Relance » désigne la même chose partout. En contrepartie, renommer un nœud
du catalogue se répercute sur tous les workflows ; les surcharges locales sont donc explicites
(`label_override`, `probability_override`).

*Vérification prévue.* pgTAP couvrant les six gardes de `move_card`.

### Décision 3 — Copie des workflows vers un track, et écart assumé

*Problème.* Le responsable a demandé de pouvoir **copier** un workflow global dans un track pour
l'y modifier. Or `CLAUDE.md` §4 privilégie la surcharge à la duplication : « tout existe par
défaut au niveau général, puis les contextes spécialisés ne définissent que leurs différences ».

*Analyse.* Une surcharge par différences aurait évité la divergence, mais elle ne correspond pas
au geste demandé et rend l'édition d'un workflow de track difficile à se représenter.

*Décision.* Suivre l'instruction explicite du responsable (`CLAUDE.md` §26, priorité 2 sur la
priorité 8) : **copie réelle**, avec traçabilité de l'origine (`derived_from_workflow_id`,
`derived_at`) et signalement dans l'interface lorsque le workflow d'origine a changé depuis.

*Conséquence.* Écart documenté à la convention générale. Il est consigné ici et rappelé dans
`docs/SPEC-workflow-engine.md` §4.

### Décision 4 — Messagerie : entrant et sortant découplés

*Problème.* La demande initiale décrivait un serveur agissant comme serveur mail recevant sur
l'adresse d'une card. Le responsable a ensuite précisé un fonctionnement différent et plus
proche du réel : un compte IMAP administrable lit les mails entrants et les classe ; chaque
utilisateur configure sa propre boîte entrante et son propre SMTP ; **les deux sont des serveurs
distincts** — exemple donné : réception sur Yahoo, réponse depuis une adresse interne
`@p2enjoy.studio` dont les messages sont mirroités vers Yahoo.

*Conséquence majeure sur le modèle.* Compte entrant et identité sortante deviennent deux tables
indépendantes (`mail_inbound_accounts`, `mail_outbound_identities`), et non un unique objet
« compte mail ». Un même message pouvant arriver à la fois dans la boîte système et dans la
boîte mirroir de l'utilisateur, le dédoublonnage par `Message-ID` devient obligatoire, avec une
table d'occurrences distincte. C'est aussi ce qui permet qu'un message classé dans une card
**reste** visible dans l'inbox globale, exigence explicite du responsable.

*Conséquence sur l'ingestion.* Le produit ne reçoit plus en SMTP : il **lit en IMAP**. Aucun
enregistrement MX ni port 25 n'est requis, ce qui simplifie considérablement le déploiement.

### Décision 5 — Dossiers IMAP réellement créés

*Décision du responsable.* Les Tracks, Channels et Cards doivent apparaître comme des dossiers
imbriqués dans la vue inbox, et **les dossiers doivent être créés côté IMAP**. Le choix entre
dossiers et labels est laissé à l'arbitrage technique.

*Décision technique.* Dossiers imbriqués `CRM/<Track>/<Channel>/<Card>` par défaut, en respectant
le délimiteur annoncé par le serveur ; **labels** lorsque la capacité `X-GM-EXT-1` est détectée,
le modèle de dossiers étant inadapté à Gmail. Le chemin réellement créé est mémorisé
(`mail_folder_map`), car l'assainissement peut le faire différer du nom souhaité.

*Choix prudent.* Le service **copie** les messages dans les dossiers et ne les retire jamais de
`INBOX` : décider à la place de l'utilisateur de vider sa boîte serait destructif.

### Décision 6 — Pile mail de développement : Stalwart + Roundcube + Inbucket

*Problème.* Le responsable avait demandé Inbucket pour les emails sortants. Or **Inbucket
n'expose pas d'IMAP** (SMTP et POP3 seulement), alors que le produit doit lire des boîtes,
y créer des dossiers et y déposer des messages.

*Options.* Stalwart (serveur complet) plus Roundcube plus Inbucket ; Stalwart et Roundcube seuls ;
GreenMail plus Inbucket.

*Décision du responsable.* **Stalwart + Roundcube + Inbucket**, motivée par le fonctionnement
réel de la production où entrant et sortant sont des serveurs différents.

*Conséquences.* Trois rôles distincts et non redondants : Stalwart est le vrai serveur
IMAP/SMTP, Roundcube permet de **voir** les dossiers créés par le CRM — ce qui rend la
vérification visuelle possible —, Inbucket reste le puits des mails transactionnels. Un
conteneur de plus en développement, aucun en production.

### Décision 7 — Secrets de messagerie chiffrés en Vault

*Décision du responsable.* Serveur, identifiant et mot de passe applicatif, chiffrés en Supabase
Vault. OAuth2 Google et Microsoft reportés au backlog.

*Conséquence de sécurité.* Une politique RLS filtre des **lignes**, pas des colonnes : sans
mesure supplémentaire, un membre légitime du workspace pourrait lire la référence du secret d'un
collègue. La colonne `secret_id` fait donc l'objet d'un `REVOKE SELECT` pour `authenticated` ;
seul `mail-sync`, avec `service_role`, la lit.

*Limite connue.* Les organisations imposant OAuth ne pourront pas connecter leur boîte en v1.

### Décision 8 — Ordonnanceur applicatif plutôt que `pg_cron`

*Problème.* Les relances, séquences, digests et purges exigent un ordonnancement. `pg_cron` est
l'option naturelle sous Supabase, mais sa présence dans l'image retenue n'est pas vérifiée.

*Décision.* Placer l'ordonnancement dans `mail-sync`, qui tourne déjà en continu. Cela évite une
dépendance non vérifiée et rend les tâches planifiées testables par pytest sans manipuler la
base.

*Compromis assumé.* Si le service est arrêté, les tâches planifiées ne s'exécutent pas : l'état
de santé du service doit être supervisé et visible dans l'interface.

### Décision 9 — Découpage de la livraison

*Décision du responsable.* **Socle vérifiable d'abord, messagerie ensuite** : documentation,
puis infrastructure et autorisations, puis le CRM utilisable, puis la messagerie, puis les
extensions.

*Conséquence.* L'application est utilisable dès la fin du chunk 3. Le sous-système mail, le plus
risqué, arrive sur une base déjà éprouvée et seedée.

### Décision 10 — Périmètre fonctionnel

Le responsable a retenu **l'intégralité** des fonctionnalités proposées : kanban et vue liste,
relances automatiques, mentions et notifications, analytique de conversion, contacts et
organisations, prochaine action et « Ma journée », templates, signatures et séquences, recherche
globale et palette de commandes, classement assisté, résilience mail avec antivirus, permissions
fines, vues sauvegardées et import CSV, prévisionnel pondéré, activités typées, checklists et
modèles, étiquettes et digest, webhooks et jetons d'API, audit et RGPD, backfill et snooze,
aperçu des pièces jointes et extraction de texte.

*Observation transmise au responsable.* Le périmètre est celui d'un produit complet, pas d'un
MVP. Il est donc découpé en unités indépendamment livrables (`docs/BACKLOG.md`), chacune soumise
à la même Definition of Done. Douze propositions supplémentaires ont été enregistrées comme
candidates en attente d'arbitrage, sans être planifiées.

### Vérifications réalisées ce jour

- Environnement : versions de Node, npm, Docker, Compose et Python constatées par commande.
- Pile Supabase self-hosted du dépôt voisin : services et versions relevés dans le fichier
  Compose ; présence de `pg_net` constatée dans les scripts d'initialisation ; présence de
  `supabase_vault` et `pg_cron` **non constatée** — d'où l'unité bloquante `CRM-004`.
- État Git : dépôt déjà initialisé, remote `origin` configurée, arbre de travail propre, local
  aligné sur `origin/main`.
- `CLAUDE.md` sur disque **plus récent** que la version chargée en contexte : il ajoute au §13 une
  règle non négociable interdisant toute attribution de commit à un agent. Règle appliquée dès le
  premier commit, et vérifiée après coup (auteur, committer, absence de trailer).

### Points laissés ouverts

Consignés dans `docs/INCONSISTENCY_REPORT.md` : disponibilité de `supabase_vault` et `pg_cron`,
empreinte de repli pour les messages sans `Message-ID`, transition « Réalisation → Perdu » non
déclarée dans le workflow par défaut, politique face aux expéditeurs inconnus.

---

## 2026-08-03 — Worker cloud d'avancement du backlog

### Décision

Sur instruction du responsable, une **routine cloud** avance le backlog de façon autonome : à
chaque passage, elle prend une unité de `docs/BACKLOG.md` dans l'ordre de `docs/MASTER_PLAN.md`,
la mène à son terme, met à jour la documentation associée, puis committe et pousse.

| Paramètre | Valeur |
|---|---|
| Identifiant | `trig_01DaJKPwKV32xPQ4vi5R8RS8` |
| Cadence | `55 * * * *` — toutes les heures |
| Environnement | Unrestricted |
| Modèle | Opus 5 |
| Dépôt | `github.com/martinobettucci/p2enjoy-crm` |

### Écart assumé à la convention générale

`CLAUDE.md` §1 prescrit de ne pas déléguer à des sous-agents. Le responsable a explicitement
demandé la mise en place de ce worker : l'instruction explicite prime (`CLAUDE.md` §26,
priorité 2 sur priorité 8). L'écart est borné par le prompt de la routine, qui impose les mêmes
règles que celles suivies ici — documentation avant code, une seule unité par passage, preuves
obligatoires, interdiction de déclarer terminé ce qui n'est que codé, attribution des commits au
seul responsable.

### Limites constatées de l'API des routines

Trois écarts entre la demande et ce que l'API accepte réellement :

1. **Cadence de 30 minutes impossible.** L'intervalle minimum est d'une heure ; `*/30 * * * *`
   est rejeté. Cadence horaire retenue en accord avec le responsable.
2. **Minute du cron non contrôlable.** Le serveur l'aligne sur l'instant de création ou de mise à
   jour : deux tentatives de fixer `0 * * * *` ont produit `54 * * * *` puis `55 * * * *`. Sans
   conséquence fonctionnelle, mais l'heure de passage n'est pas ronde.
3. **Niveau d'effort non exposé.** Le champ `effort` demandé au niveau `max` est silencieusement
   ignoré : la réponse de l'API ne le conserve pas. Compensation partielle par une consigne de
   raisonnement approfondi placée en tête du prompt — ce n'est **pas** équivalent à un réglage
   d'effort, et le responsable en a été informé.

### Conséquence à surveiller

Les passages sont horaires et travaillent tous sur `main`. Le prompt impose une resynchronisation
en début de passage et une résolution des conflits sur place, sans création de branche. Si deux
passages se chevauchent sur une unité longue, le second doit terminer l'unité en cours plutôt que
d'en ouvrir une nouvelle. Ce comportement sera vérifié sur les premiers passages réels.

L'autre point de vigilance est la Definition of Done : une part des preuves exige Docker, la pile
Supabase et un navigateur. Si l'environnement cloud ne les fournit pas, les unités doivent rester
en `[~]` avec la limite nommée explicitement. Une dérive vers des `[x]` non prouvés serait le
principal risque de ce dispositif.

---

## 2026-08-03 — `CRM-001` : assemblage et vérification de la pile Supabase self-hosted

### Contexte

Première unité de code du projet. Objectif : une pile Supabase self-hosted qui démarre
réellement, avec un assemblage commun et deux overlays, sans outillage de développement en
production.

### Observations d'environnement

L'environnement de la routine cloud fournit Docker 29.3.1 et Compose v5.1.1, 4 cœurs, 15 Gio de
mémoire et environ 30 Gio de disque libre. Deux constats ont orienté le travail :

1. **Le démon Docker n'est pas démarré** au début de la session ; il faut le lancer soi-même
   (`dockerd`). Sans cela, aucune preuve de `CRM-001` n'est possible.
2. **`../starter.2025.12/` n'existe pas** dans le conteneur : seul `p2enjoy-crm` est cloné. Voir
   `docs/INCONSISTENCY_REPORT.md`, INC-006 — point laissé à l'arbitrage du responsable.

### Décision 11 — La passerelle ne connaît aucun service de développement

*Problème.* La configuration Kong officielle de Supabase se termine par une route « attrape-tout »
vers Studio, plus des routes vers `postgres-meta` et l'endpoint MCP. Studio et `postgres-meta`
sont des outils de développement (`docs/DAT.md` §3.6). Les conserver imposait soit deux
configurations Kong divergentes, soit une passerelle de production pointant vers des services
inexistants.

*Options.* Deux fichiers `kong.yml` complets, l'un pour chaque environnement — au prix d'une
duplication de 400 lignes ; un mécanisme de fragments concaténés par le point d'entrée ; ou
retirer purement ces routes.

*Décision.* **Retirer les routes vers Studio, `postgres-meta` et MCP.** `README.md` §6 prévoit
déjà Studio sur son propre port (54323), et Studio joint `postgres-meta` directement par le
réseau interne : la passerelle n'a jamais besoin de les connaître. La configuration devient
**identique** en développement et en production, ce qui supprime toute divergence possible entre
les deux environnements.

*Conséquences.* Les consommateurs `DASHBOARD` et le greffon `basic-auth` deviennent inutiles et
sont retirés. Studio n'étant plus derrière l'authentification basique de Kong, son port n'est
publié que sur l'interface de bouclage (`DEV_BIND_ADDRESS`, valeur `127.0.0.1` par défaut).
`scripts/verify-stack.sh` vérifie que la racine de Kong répond bien `404` : si quelqu'un
réintroduisait la route attrape-tout, la preuve échouerait.

### Décision 12 — Services écartés de la pile officielle

Trois services de la distribution officielle ne sont **pas** déployés :

| Service écarté | Motif |
|---|---|
| `analytics` (Logflare) et `vector` | Absents de la stack annoncée par `README.md` §2 ; ils imposeraient une dépendance lourde et des `depends_on` supplémentaires sans qu'aucune unité ne les exige. |
| `imgproxy` | Sert la transformation d'images du Storage. Aucune unité livrée n'en dépend ; `ENABLE_IMAGE_TRANSFORMATION` est donc à `false`. À reconsidérer lors de `CRM-074` (aperçu des pièces jointes). |
| `functions` (edge-runtime) | Aucun composant de fonctions edge dans `docs/DAT.md` §3, aucune unité de backlog. Voir INC-007. |

*Conséquence.* La pile compte **onze** services de longue durée en développement et **huit** en
production, contre une quinzaine dans la distribution officielle. Moins de surface à superviser,
et chaque service présent est justifié par une unité du backlog.

### Décision 13 — Le stockage vise toujours S3

`STORAGE_BACKEND` vaut `s3` dans **les deux** environnements : MinIO en développement, fournisseur
réel en production. Le repli `file` de la distribution officielle n'est pas utilisé.

*Motif.* Un développement qui écrit sur disque local et une production qui écrit sur S3 ne
testent pas le même chemin de code. La preuve n° 5 de `scripts/verify-stack.sh` dépose un objet
par l'API, le relit, puis **vérifie par un client S3 que l'octet est bien dans le bucket MinIO** :
un repli silencieux sur disque ferait échouer la vérification.

### Décision 14 — Le nombre de descripteurs de fichiers est explicite

*Problème.* Realtime et Supavisor élèvent `RLIMIT_NOFILE` au démarrage (10 000 et 100 000
respectivement). Les deux conteneurs **redémarraient en boucle** dans l'environnement de la
routine, dont la limite dure est de 4096 sans possibilité de l'élever :

```
$ sh -c 'ulimit -Hn 1048576'
sh: 1: ulimit: error setting limit (Operation not permitted)
$ docker run --rm --ulimit nofile=10000:10000 postgres:17-alpine true
Error ... error setting rlimit type 7: operation not permitted
```

La capacité `CAP_SYS_RESOURCE` est retirée à l'environnement (`CapEff` = `000001fffeffffff`,
bit 24 à zéro) : ni le shell ni le démon Docker ne peuvent dépasser 4096.

*Décision.* Introduire `STACK_RLIMIT_NOFILE`, appliquée aux deux services, de valeur par défaut
**100000**. Le besoin devient une donnée de configuration explicite au lieu d'un défaut de démon
non documenté, et un hôte contraint peut l'abaisser sans modifier la pile.

*Limite assumée et non masquée.* Les vérifications de ce jour ont été menées avec
`STACK_RLIMIT_NOFILE=4096`. La **valeur par défaut du dépôt (100000) n'a donc pas été vérifiée
ici** : elle le sera sur un hôte disposant de `CAP_SYS_RESOURCE`. Cette limite est reportée dans
`README.md` §11.

### Décision 15 — Variables d'environnement requises par l'assemblage

`.env.example` relève de `CRM-002`. Pour que cette unité soit un contrat exploitable, voici la
liste **exhaustive** des variables consommées par les trois fichiers Compose :

| Famille | Variables |
|---|---|
| Base | `POSTGRES_HOST`, `POSTGRES_PORT`, `POSTGRES_DB`, `POSTGRES_PASSWORD`, `POSTGRES_DIRECT_PORT` *(dev)* |
| Jetons | `JWT_SECRET`, `JWT_EXPIRY`, `ANON_KEY`, `SERVICE_ROLE_KEY`, `SECRET_KEY_BASE`, `VAULT_ENC_KEY`, `REALTIME_DB_ENC_KEY`, `PG_META_CRYPTO_KEY` |
| Clés opaques *(facultatives)* | `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `ANON_KEY_ASYMMETRIC`, `SERVICE_ROLE_KEY_ASYMMETRIC` |
| API | `KONG_HTTP_PORT`, `API_EXTERNAL_URL`, `SUPABASE_PUBLIC_URL`, `SITE_URL`, `ADDITIONAL_REDIRECT_URLS`, `PGRST_DB_SCHEMAS`, `PGRST_DB_MAX_ROWS`, `PGRST_DB_EXTRA_SEARCH_PATH` |
| Authentification | `DISABLE_SIGNUP`, `ENABLE_EMAIL_SIGNUP`, `ENABLE_EMAIL_AUTOCONFIRM`, `ENABLE_ANONYMOUS_USERS`, `ENABLE_PHONE_SIGNUP`, `ENABLE_PHONE_AUTOCONFIRM`, `MAILER_URLPATHS_INVITE`, `MAILER_URLPATHS_CONFIRMATION`, `MAILER_URLPATHS_RECOVERY`, `MAILER_URLPATHS_EMAIL_CHANGE` |
| SMTP transactionnel | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_ADMIN_EMAIL`, `SMTP_SENDER_NAME` |
| Stockage | `GLOBAL_S3_BUCKET`, `GLOBAL_S3_ENDPOINT`, `GLOBAL_S3_PROTOCOL`, `GLOBAL_S3_FORCE_PATH_STYLE`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `S3_PROTOCOL_ACCESS_KEY_ID`, `S3_PROTOCOL_ACCESS_KEY_SECRET`, `STORAGE_TENANT_ID`, `STORAGE_FILE_SIZE_LIMIT`, `REGION` |
| Pooler | `POOLER_TENANT_ID`, `POOLER_DEFAULT_POOL_SIZE`, `POOLER_MAX_CLIENT_CONN`, `POOLER_DB_POOL_SIZE`, `POOLER_PROXY_PORT_SESSION`, `POOLER_PROXY_PORT_TRANSACTION` |
| Pile | `STACK_RLIMIT_NOFILE`, `APPLY_MIGRATIONS` |
| Développement | `DEV_BIND_ADDRESS`, `STUDIO_PORT`, `STUDIO_DEFAULT_ORGANIZATION`, `STUDIO_DEFAULT_PROJECT`, `MINIO_ROOT_USER`, `MINIO_ROOT_PASSWORD`, `MINIO_API_PORT`, `MINIO_CONSOLE_PORT`, `INBUCKET_WEB_PORT`, `INBUCKET_SMTP_PORT` |
| Production | `APP_DOMAIN`, `CADDY_ACME_EMAIL` |

### Vérifications réalisées

Toutes exécutées dans l'environnement de la routine, sur la pile réellement démarrée.

| Vérification | Résultat |
|---|---|
| Démarrage à froid du développement (volumes et `PGDATA` détruits au préalable) | **26 s**, code de retour `0`, les 11 services de longue durée `healthy`, les 2 conteneurs éphémères terminés en `0` |
| `scripts/verify-stack.sh` | **33 contrôles, aucune anomalie** |
| Kong sans clé d'API | `401` — la passerelle filtre réellement |
| Kong avec clé de service / clé anonyme sur la racine OpenAPI | `200` / `403` |
| Studio | `200`, capture observée (`docs/captures/CRM-001/`) |
| Chaîne de stockage | objet déposé par l'API, relu à l'identique, **et retrouvé dans le bucket MinIO** |
| Démarrage réel de l'assemblage de **production** | les 8 services `healthy`, Caddy compris |
| Caddy en production | `http://` → `308` vers `https://` ; API jointe en TLS (`/auth/v1/health` → `200`, `/rest/v1/` sans clé → `401`, avec clé de service → `200`) |
| Ports publiés en production | `80` et `443` par Caddy **uniquement** ; ni Kong, ni PostgreSQL, ni le pooler |
| Outillage de développement en production | aucun conteneur `studio`, `meta`, `minio`, `inbucket` |
| `APPLY_MIGRATIONS=false` | le conteneur de migrations renvoie vers `docs/PROD_MIGRATIONS.md` et se termine en `0` |

**Le harnais n'est pas complaisant** — vérifié en le mettant volontairement en défaut :

| Régression introduite | Détection |
|---|---|
| Arrêt de `p2enjoy-storage` | 2 anomalies, code de sortie `1` |
| Réintroduction de `studio` dans `docker-compose.prod.yml` | 2 anomalies : service de développement en production, **et** port `54323` publié |
| Arrêt de MinIO | 4 anomalies, dont « le stockage ne vise pas MinIO » |

### Deux défauts d'outillage corrigés au passage

**1. `.gitignore` excluait la configuration de la pile.** La règle `volumes/`, non ancrée,
s'appliquait à *tout* répertoire de ce nom, donc aussi à `supabase/docker/volumes/` — qui contient
la configuration déclarative de Kong et les scripts d'initialisation de la base. Constaté au
moment de l'indexation : `git check-ignore -v` désignait la ligne 37.

```
$ git check-ignore -v supabase/docker/volumes/api/kong.yml
.gitignore:37:volumes/	supabase/docker/volumes/api/kong.yml
```

*Conséquence évitée.* Un dépôt cloné à neuf n'aurait contenu **ni** la configuration de la
passerelle **ni** les scripts d'initialisation : la pile n'aurait pas démarré, sans que rien ne
le signale. Les lignes 34 à 36, qui excluent explicitement les données générées *à l'intérieur*
de ce répertoire, montrent d'ailleurs que l'intention initiale était bien de le versionner.

*Correction.* Règle ancrée à la racine (`/volumes/`), et exclusion ciblée du contenu généré par
Studio dans `supabase/docker/volumes/snippets/`.

**2. Les commits partaient au nom de l'agent.** La configuration effective provenait de
`/root/.gitconfig` (outillage d'agent) et valait `Claude <noreply@anthropic.com>`, alors que
l'historique du dépôt est intégralement au nom de `P2Enjoy <contact@p2enjoy.studio>`. Le dépôt
n'avait aucune configuration locale : l'identité globale de l'outillage prenait le dessus, en
violation directe de `CLAUDE.md` §13.

*Correction.* Identité fixée dans la configuration **locale** du dépôt, alignée sur l'historique
existant.

*Correctif moins durable qu'annoncé — constaté le 2026-08-03 pendant `CRM-002`.* La routine cloud
travaille sur un conteneur qui **reclone le dépôt** à chaque session : `.git/config` est donc
recréé, et la configuration locale disparaît avec lui. L'identité globale de l'outillage
(`Claude <noreply@anthropic.com>`) reprend alors le dessus. Le contrôle et, si besoin, la remise
en place de l'identité locale font partie du démarrage de chaque passage, avant tout commit.

### Ce que cette unité ne prouve pas

- La **valeur par défaut** `STACK_RLIMIT_NOFILE=100000` (voir décision 14).
- L'obtention d'un certificat **ACME** : la vérification de production a utilisé
  `APP_DOMAIN=localhost`, donc l'autorité interne de Caddy. Le chemin Let's Encrypt exige un
  domaine public et reste à éprouver au premier déploiement réel.
- Le service des fichiers de la **webapp** par Caddy : `webapp/dist` n'existe pas avant `CRM-007`.
  Caddy répond `404` sur `/`, ce qui est le comportement attendu à ce stade.
- La pile de production a été démarrée contre un **fournisseur S3 simulé** (un MinIO autonome,
  extérieur à l'assemblage), faute de compte S3 réel. Le contrat testé est celui d'un stockage
  compatible S3, pas celui d'un fournisseur particulier.

---

## 2026-08-03 — `CRM-002` : scripts de lancement et contrat d'environnement

### Contexte

`CRM-001` a livré une pile qui démarre, mais qui exige un `.env` que **rien** ne fournissait :
aucun gabarit n'était versionné, et la liste des variables ne vivait que dans la décision 15 de ce
journal. Un dépôt cloné à neuf ne démarrait donc pas. Cette unité comble ce trou et livre les
trois scripts annoncés par `README.md` §5.

### Décision 16 — Les secrets de développement sont tirés au hasard, jamais versionnés

*Problème.* Un gabarit d'environnement doit être copiable et immédiatement fonctionnel, mais
`CLAUDE.md` §3 interdit qu'une clé ou un mot de passe réel entre dans le dépôt. La distribution
self-hosted officielle de Supabase résout la tension en livrant des clés de démonstration
publiquement connues — `JWT_SECRET` compris. Toute installation qui oublie de les changer expose
donc une `SERVICE_ROLE_KEY` que n'importe qui peut reconstituer, et cette clé **contourne la RLS**.

*Options.* Reprendre les clés de démonstration officielles, au prix d'un secret partagé par
construction ; exiger que l'utilisateur produise lui-même quinze valeurs à la main, au prix d'une
installation pénible et d'erreurs de longueur ; ou faire produire ces valeurs par le script
d'amorçage.

*Décision.* **`./runDev.sh` amorce `.env` et tire chaque secret au hasard.** `ANON_KEY` et
`SERVICE_ROLE_KEY` ne sont pas tirées mais **dérivées** : ce sont de véritables jetons HS256
signés par le `JWT_SECRET` produit, fabriqués par `openssl` dans `scripts/lib/env.sh`. Le gabarit
ne contient que des marqueurs `CHANGE_ME_*`, et le fichier produit naît en mode `600`.

*Conséquences.* Deux postes n'ont jamais les mêmes clés, et aucun secret ne peut fuiter par le
dépôt. En contrepartie, un `.env` perdu ne se reconstitue pas : la base locale devient illisible,
ce qui est acceptable pour un environnement recréable par `./resetMe.sh`. La production, elle,
n'est **jamais** amorcée automatiquement — `./runProd.sh` refuse de démarrer plutôt que d'inventer
un secret.

### Décision 17 — Le gabarit est un contrat vérifié, pas une documentation à la main

*Problème.* Un `.env.example` dérive silencieusement : on ajoute une variable à un service, on
oublie de la documenter, et l'installation suivante échoue sur une erreur incompréhensible.

*Décision.* `scripts/verify-scripts.sh` compare l'ensemble des variables interpolées par les trois
fichiers Compose à celles déclarées par `.env.example`, dans les **deux** sens. Une variable
consommée mais non documentée fait échouer les preuves ; une variable documentée que rien ne
consomme doit figurer dans une courte liste justifiée, à l'intérieur du harnais. Le harnais
vérifie en outre que chaque variable est précédée d'un commentaire disant son format et son
caractère obligatoire.

*Conséquence.* Les quatre variables aujourd'hui documentées sans être consommées sont nommées et
motivées : `P2ENJOY_ENV_PROFILE` (lue par les scripts) et les trois variables de messagerie
annoncées par `README.md` §9 et `docs/PROD_MIGRATIONS.md` §2.3, qui ne prendront effet qu'avec
`mail-sync`.

### Décision 18 — Un profil d'environnement explicite garde les opérations dangereuses

*Problème.* Deux erreurs coûteuses sont possibles avec trois scripts et un seul fichier `.env` :
démarrer la production avec les secrets du développement, et effacer une base qui n'est pas
locale. Aucune des deux ne se détecte à partir du contenu des variables, qui se ressemblent.

*Décision.* Introduire `P2ENJOY_ENV_PROFILE`, valant `dev` ou `prod`. `runDev.sh` et `resetMe.sh`
exigent `dev`, `runProd.sh` exige `prod`. `runProd.sh` impose en outre `APPLY_MIGRATIONS=false`,
conformément à `docs/PROD_MIGRATIONS.md`. `resetMe.sh` réclame une confirmation, explicite
(`--yes`) hors terminal interactif.

*Conséquence.* Une variable de plus, qu'aucun service ne consomme — c'est le prix d'une garde
lisible. Les cinq refus sont éprouvés par `scripts/verify-scripts.sh`, dans les deux sens : le
harnais vérifie aussi qu'un environnement conforme est bien **accepté**.

### Décision 19 — Le nombre de descripteurs s'ajuste à l'hôte lors de l'amorçage

La décision 14 avait rendu `STACK_RLIMIT_NOFILE` explicite, sans résoudre le fait qu'un hôte
contraint voit Realtime et le pooler redémarrer en boucle. L'amorçage lit désormais `ulimit -Hn`
et inscrit la limite dure réelle dans le `.env` produit lorsqu'elle est inférieure à la valeur
demandée, **en le disant**. La valeur par défaut du dépôt reste `100000`.

*Portée volontairement étroite.* L'ajustement n'a lieu qu'à l'amorçage : un `.env` existant n'est
jamais réécrit, et la production n'en bénéficie pas. Le prérequis d'hôte reste donc à contrôler
avant un déploiement (`docs/PROD_MIGRATIONS.md` §4).

### Vérifications réalisées

Toutes exécutées dans l'environnement de la routine, sur la pile réellement démarrée.

| Vérification | Résultat |
|---|---|
| `scripts/verify-scripts.sh` | **38 contrôles, aucune anomalie** |
| Démarrage à froid par `./runDev.sh`, dépôt sans `.env` ni `PGDATA` | `.env` amorcé puis pile démarrée en **31,8 s**, les 11 services de longue durée `healthy`, les 2 éphémères terminés en `0` |
| `scripts/verify-stack.sh` contre le `.env` **amorcé par le script** | **33 contrôles, aucune anomalie** — les jetons produits sont réellement acceptés par Kong, PostgREST, Storage et Realtime |
| Ajustement automatique des descripteurs | `STACK_RLIMIT_NOFILE` inscrit à `4096`, égal à `ulimit -Hn` de l'hôte, avec avertissement |
| Droits du fichier amorcé | `600` |
| `./resetMe.sh --yes` | Base réellement recréée : identifiant du cluster passé de `7669853337939968035` à `7669853644045238308`, table témoin `sonde_reset` disparue, redémarrage à froid en **38,9 s**, puis `verify-stack.sh` de nouveau à 33/33 |
| Absence de seed | Signalée explicitement par `resetMe.sh`, qui nomme l'unité `CRM-005` au lieu de laisser croire à un succès complet |
| `./runProd.sh` avec un fichier de profil `prod` | Les **8** services `healthy`, Caddy compris, en **37,9 s** |
| Caddy | `http://localhost/` → `308` vers `https://` ; `/auth/v1/health` avec clé anonyme → `200` ; `/rest/v1/` sans clé → `401`, avec clé de service → `200` ; `/` → `404`, webapp non livrée |
| Ports publiés en production | `80` et `443` par Caddy **uniquement** |
| Outillage de développement en production | aucun conteneur `studio`, `meta`, `minio`, `inbucket` |
| `APPLY_MIGRATIONS=false` en production | le conteneur de migrations renvoie vers `docs/PROD_MIGRATIONS.md` et se termine en `0` |
| `./runDev.sh --stop`, `./runProd.sh --stop` | Arrêt propre, volumes conservés |
| `--withLog webapp`, `mail-sync`, `stalwart` | Refus explicite nommant `CRM-007`, `CRM-051`, `CRM-050`, code de sortie `1` |

**Le harnais n'est pas complaisant** — vérifié en le mettant volontairement en défaut :

| Régression introduite | Détection |
|---|---|
| Variable `${SONDE_NON_DOCUMENTEE}` ajoutée à un service Compose | 3 anomalies : variable non documentée, puis les deux assemblages non interpolables |
| `JWT_SECRET` renseigné en clair dans `.env.example` | 1 anomalie : « valeur non neutre dans le gabarit » |
| `env_require_profile prod` commentée dans `runProd.sh` | 1 anomalie : la production accepte un environnement de développement |
| Dérivation d'`ANON_KEY` faussée par un autre secret | 1 anomalie : « signature invalide ou rôle inattendu » |

### Ce que cette unité ne prouve pas

- **Aucun test unitaire ni E2E dédié**, et c'est assumé : cette unité ne livre ni logique métier
  ni parcours utilisateur. Les preuves correspondantes sont d'intégration et vivent dans
  `scripts/verify-scripts.sh`. Le harnais Vitest, pytest et Playwright reste l'objet de `CRM-008`.
- **Aucune vérification visuelle** : rien de cette unité n'atteint l'interface. Le premier écran
  du produit arrive avec `CRM-007`.
- **Le seed n'est pas rejoué**, faute d'exister (`CRM-005`). `resetMe.sh` appelle
  `supabase/seed/apply-seed.sh` s'il est exécutable, et le dit clairement sinon. La partie
  « recrée le seed » de la Definition of Done de `CRM-002` reste donc **non prouvée**, et l'unité
  ne peut pas se déclarer complète sur ce point.
- **La production a été démarrée contre un fournisseur S3 simulé** et avec `APP_DOMAIN=localhost`,
  donc l'autorité interne de Caddy : mêmes limites que `CRM-001`, pour les mêmes raisons.
- **La valeur par défaut `STACK_RLIMIT_NOFILE=100000` reste non éprouvée** : l'hôte de la routine
  plafonne à 4096, et c'est précisément ce que l'ajustement automatique inscrit.

---

## 2026-08-03 — `CRM-003` : migrations d'amorçage, identité et cloisonnement

### Contexte

Première migration applicative du produit. `CRM-001` et `CRM-002` ont livré une pile qui démarre
et des scripts qui l'amorcent ; le répertoire `supabase/migrations/` était vide. Cette unité crée
le socle d'identité : extensions, schéma `app`, `profiles` et son trigger de création,
`workspaces`, `workspace_members`, `track_members`, `channel_members`.

Trois questions ont dû être tranchées avant d'écrire la première ligne de SQL.

### Décision 20 — Pas de registre de migrations, donc des migrations idempotentes

Le conteneur `migrations-runner` livré par `CRM-001` ne tient **aucune** table de suivi : il
rejoue l'intégralité de `supabase/migrations/*.sql` à chaque démarrage de la pile. Ce
comportement n'avait pas d'incidence tant qu'aucune migration n'existait ; il en a une dès la
première.

Deux options : introduire un registre de migrations, ou exiger que chaque migration soit
rejouable.

*Retenu : des migrations idempotentes.* Un registre est un composant à écrire, à tester et à
maintenir cohérent avec un contrat de déploiement qui, en production, applique les migrations à la
main. L'idempotence, elle, se vérifie mécaniquement : `scripts/verify-migrations.sh` réapplique la
migration sur une base déjà migrée et compare la structure obtenue colonne par colonne.

*Conséquence à surveiller.* L'idempotence est facile pour des créations d'objets, beaucoup moins
pour des transformations de données. La première migration qui devra transformer des lignes
existantes remettra ce choix en question — et c'est à ce moment-là qu'il faudra le rouvrir, pas
avant.

*Conséquence assumée.* Une migration rejouée ne détecte pas une divergence : si un objet a été
modifié à la main dans la base, `create table if not exists` ne le corrigera pas. La base de
développement est recréable par `./resetMe.sh`, et la production n'utilise pas ce chemin.

### Décision 21 — Une table naît en refus, pas en attente de ses politiques

`CRM-010` et `CRM-012` livreront les fonctions d'autorisation et les politiques RLS. La question
était de savoir ce que font les cinq tables entre-temps.

*Retenu : RLS activée dès la migration qui crée la table, sans aucune politique.* Le refus par
défaut est donc total : zéro ligne en lecture, refus en écriture. Livrer ces tables sans RLS,
même le temps d'une ou deux unités, les exposerait à quiconque détient la clé anonyme — qui est
publique par construction, puisqu'elle voyage dans le navigateur.

Trois précisions qui en découlent :

1. **`FORCE ROW LEVEL SECURITY` n'est pas utilisée.** Elle soumettrait le propriétaire des tables
   aux politiques, donc `app.handle_new_user()`, qui s'exécute avec les droits de `postgres` : le
   trigger ne pourrait plus créer le moindre profil. Les rôles qui contournent RLS sont ceux qui
   le doivent, `postgres` et `service_role`.
2. **`SELECT` est accordé à `anon` et `authenticated`.** C'est contre-intuitif, et c'est
   délibéré : `docs/SPEC-permissions-rls.md` §7 exige qu'un refus de lecture se manifeste par
   **zéro ligne**, pas par une erreur de privilège. Sans ce `GRANT`, PostgREST répondrait `401`
   ou `403` — une erreur ambiguë, qui renseigne l'appelant sur l'existence de la table au lieu de
   la lui rendre invisible.
3. **Les privilèges sont posés explicitement.** Les privilèges par défaut de l'image accordent
   déjà tout à `anon`, `authenticated` et `service_role` sur les tables créées dans `public`. On
   ne s'y fie pas : un `REVOKE ALL` suivi des `GRANT` voulus rend le comportement du produit
   indépendant d'un réglage d'image susceptible de changer d'une version à l'autre.

### Décision 22 — Le nom affiché a une chaîne de repli, parce que l'alternative est pire

`profiles.full_name` est non nul (`docs/SCHEMA.md` §1). Le trigger le renseigne depuis les
métadonnées du compte GoTrue. Reste le cas d'un compte sans métadonnée **et** sans email —
authentification par téléphone, ou SSO n'exposant pas d'adresse.

*Retenu : une chaîne de repli déterministe et documentée* — métadonnée `full_name`, puis `name`,
puis la partie locale de l'email, puis `Utilisateur <8 premiers caractères de l'identifiant>`.

Le dernier maillon n'est pas un remplissage de complaisance : sans lui, la contrainte `NOT NULL`
ferait échouer l'insertion dans `profiles`, donc le trigger, donc **la création du compte
elle-même**. Un nom fade est un défaut d'affichage ; un compte impossible à créer est un défaut
bloquant. Les quatre branches sont couvertes par la suite pgTAP, une par une.

`on conflict (id) do nothing` complète le dispositif. Ce n'est pas un masquage d'erreur : la clé
du profil **est** `auth.users.id`, donc un conflit signifie que le profil visé existe déjà, avec
des valeurs éventuellement éditées par son titulaire, qu'une réécriture perdrait.

### Deux contradictions relevées, non résolues

- **INC-010** : `track_members` et `channel_members` sont créées avant `tracks` et `channels`
  (`CRM-020`, `CRM-021`). Les colonnes `track_id` et `channel_id` restent donc sans clé étrangère.
  La suite pgTAP **constate** cette absence, de sorte qu'elle devienne rouge le jour où la
  contrainte sera posée sans mise à jour de la suite.
- **INC-011** : ces deux tables ne portent pas `workspace_id`, alors que les conventions générales
  de `docs/SCHEMA.md` l'exigent de toute table métier — mais que le §1 du même document ne le
  déclare pas. La définition spécifique l'emporte sur la convention générale, et l'arbitrage est
  demandé avant `CRM-012`.

Aucune des deux n'a été tranchée par la routine : créer `tracks` par anticipation aurait préempté
`CRM-020`, et ajouter `workspace_id` aurait contredit le §1 sans mandat.

### Vérifications réalisées

Toutes exécutées dans l'environnement de la routine, sur la pile réellement démarrée.

| Vérification | Résultat |
|---|---|
| `scripts/verify-migrations.sh` | **23 contrôles, aucune anomalie** |
| Suite pgTAP `supabase/tests/0001_identite_et_cloisonnement.test.sql` | **70 assertions, aucune anomalie** |
| Rejeu **à blanc** : `./resetMe.sh --yes`, cluster détruit puis recréé | Migration appliquée par `migrations-runner` sur un cluster vierge, code de sortie `0`, redémarrage complet en **38,1 s** |
| Rejeu **sur base déjà migrée** | Migration réappliquée sans erreur ; empreinte de structure des cinq tables identique avant et après |
| Trigger par le **véritable** chemin applicatif | Compte créé par l'API d'administration GoTrue (`HTTP 200`), profil constaté par PostgREST avec le nom et la langue des métadonnées |
| Suppression du compte par GoTrue | Profil disparu (cascade), constaté par PostgREST |
| Refus n° 11 — anonyme sur les cinq tables | `HTTP 200` et corps `[]` : **zéro ligne**, jamais une erreur |
| Compte authentifié réel, jeton obtenu par la route de connexion | Son propre profil invisible (`[]`) tant qu'aucune politique n'existe |
| Écriture par un compte authentifié | Création de workspace refusée (`HTTP 403`) ; modification de son propre profil sans effet (corps `[]`) |
| Schéma `app` | Non joignable par l'API REST (`HTTP 404`) : il n'est pas dans `PGRST_DB_SCHEMAS` |
| `scripts/verify-stack.sh` après le rejeu à blanc | **33 contrôles, aucune anomalie** |
| `scripts/verify-scripts.sh` après le rejeu à blanc | **38 contrôles, aucune anomalie** |

**Le harnais n'est pas complaisant** — vérifié en mutant volontairement la structure. Chaque
mutation est injectée dans la transaction de la suite pgTAP, annulée en fin de parcours ; elle est
d'abord appliquée seule, avec arrêt à la première erreur, pour qu'une mutation qui ne s'appliquerait
pas ne soit pas comptée comme une détection.

| Mutation introduite | Détection |
|---|---|
| Trigger `on_auth_user_created` retiré | **9** assertions en échec |
| RLS désactivée sur `profiles` | 1 assertion en échec |
| Politique permissive ajoutée sur `workspaces` | 1 assertion en échec |
| `SELECT` retiré à `anon` sur `profiles` | 1 assertion en échec |
| Contrainte de rôle de `workspace_members` supprimée | 1 assertion en échec |
| Cascade de suppression du profil retirée | 1 assertion en échec |

Deux défauts du harnais ont été corrigés au passage, tous deux découverts parce qu'un contrôle a
échoué :

1. une substitution de commande accidentelle dans un message — un identifiant entre accents graves
   à l'intérieur de guillemets doubles — que le shell exécutait ;
2. une mutation comptée comme « non détectée » alors qu'elle interrompait la suite sur erreur au
   lieu de produire un `not ok`. Le harnais distingue désormais les deux, et une assertion
   explicite sur `ON DELETE CASCADE` a été ajoutée à la suite pour que ce cas produise un échec
   propre.

### Ce que cette unité ne prouve pas

- **Aucun test E2E dédié, ni vérification visuelle** : cette unité ne livre aucun parcours
  utilisateur ni aucun écran. Le premier écran du produit arrive avec `CRM-007`, et le harnais
  Playwright avec `CRM-008`. Les preuves de cette unité sont unitaires (pgTAP) et d'intégration
  (API réelle, hors interface), ce que la Definition of Done demande pour une migration.
- **Le seed n'est pas mis à jour**, faute d'exister : c'est l'objet de `CRM-005`. La base repart
  donc vide après `./resetMe.sh`, et le script le dit.
- **Les politiques RLS ne sont pas écrites.** Ce qui est prouvé ici, c'est le refus par défaut —
  pas la résolution des droits, qui relève de `CRM-010` et `CRM-012`. Les preuves n° 1 à 10 et 12
  de `docs/SPEC-permissions-rls.md` §7 restent à produire ; seule la n° 11 est acquise.
- **L'intégrité référentielle des droits fins n'est pas garantie** entre cette unité et
  `CRM-020` / `CRM-021` (INC-010).

---

## 2026-08-03 — `CRM-004` : chiffrement des secrets de messagerie, hypothèse levée

### Problème

`docs/DAT.md` §8, `docs/SCHEMA.md` §11 et `docs/SPEC-mail-subsystem.md` §2 reposaient tous sur la
même hypothèse **non vérifiée** : la présence de l'extension `supabase_vault` dans l'image
PostgreSQL retenue. La décision 7 du responsable — secrets IMAP/SMTP chiffrés en Vault — n'était
donc pas exécutable en l'état, et `docs/INCONSISTENCY_REPORT.md` INC-001 la marquait bloquante
pour `CRM-052` et `CRM-053`. La décision 8 reposait sur une hypothèse jumelle au sujet de
`pg_cron`.

`CRM-004` n'avait qu'un objet : **mesurer**, puis trancher.

### Observations — sorties de commande

L'image mesurée est celle réellement épinglée par `docker-compose.yml`, `supabase/postgres:17.6.1.136`.

```
$ docker exec crm004-probe psql -U postgres -c "select version();"
 PostgreSQL 17.6 on x86_64-pc-linux-gnu, compiled by gcc (GCC) 15.2.0, 64-bit

$ docker exec crm004-probe psql -U postgres -Ax -c "select name, default_version, installed_version
    from pg_available_extensions where name in ('supabase_vault','pg_cron','pgcrypto','pgtap','pg_net');"
name|pg_cron         default_version|1.6.4    installed_version|
name|pg_net          default_version|0.20.3   installed_version|
name|pgcrypto        default_version|1.3      installed_version|1.3
name|pgtap           default_version|1.3.3    installed_version|
name|supabase_vault  default_version|0.3.1    installed_version|0.3.1

$ docker exec crm004-probe psql -U postgres -c "show shared_preload_libraries;"
 pg_stat_statements, pgaudit, plpgsql, plpgsql_check, pg_cron, pg_net, pgsodium, auto_explain,
 pg_tle, plan_filter, supabase_vault
```

`supabase_vault` **0.3.1 est présente, déjà installée et préchargée**. `pg_cron` **1.6.4 est
disponible et préchargé** ; il s'installe et ordonnance réellement :

```
$ psql -c "create extension if not exists pg_cron;"
$ psql -c "select cron.schedule('crm004-sonde','5 seconds','select 1');"  ->  1
$ psql -c "select jobid, schedule, command, active from cron.job;"
     1 | 5 seconds | select 1 | t
```

Vault chiffre réellement — le clair n'est pas dans la table, et la vue le restitue :

```
$ psql -Ax -c "select vault.create_secret('mot-de-passe-imap-secret-2026','crm004-preuve');"
id|f57b4c38-ba40-49ce-b4c5-a4849945ec2f

$ psql -Ax -c "select secret, nonce is not null from vault.secrets where name='crm004-preuve';"
secret|qmwsd/yyVJXCvB3hliO5UUWeo8V/QUQ2NBruZaL1qghLKFyZD/7kCoBmFogQMqTnKoiDwFwKtAxJeLclqA==
a_nonce|t

$ psql -Ax -c "select decrypted_secret from vault.decrypted_secrets where name='crm004-preuve';"
decrypted_secret|mot-de-passe-imap-secret-2026
```

Le cloisonnement voulu par la décision 7 est **déjà appliqué par l'image**, au niveau du schéma —
donc plus fort qu'un simple `REVOKE` de colonne :

```
$ psql -c "set role anon;          select count(*) from vault.decrypted_secrets;"
ERROR:  permission denied for schema vault
$ psql -c "set role authenticated; select count(*) from vault.decrypted_secrets;"
ERROR:  permission denied for schema vault
$ psql -c "set role service_role;  select count(*) from vault.decrypted_secrets;"
 2
```

### Décision 23 — Vault est retenu, le repli `pgcrypto` est abandonné

*Constat.* `supabase_vault` 0.3.1 est présente dans l'image épinglée, déjà installée, préchargée,
et fonctionnelle de bout en bout. Le cloisonnement par rôle est effectif sans travail
supplémentaire.

*Décision.* **Vault est retenu.** Le repli `pgcrypto` décrit dans `docs/DAT.md` §8 et
`docs/SCHEMA.md` §11 est abandonné : le maintenir serait entretenir un second chemin de
chiffrement que rien n'obligerait à exercer, donc jamais éprouvé le jour où il servirait.
`pgcrypto` reste installé pour `gen_random_uuid()`, ce qui est son autre usage dans le projet.

*Conséquence.* `CRM-052` et `CRM-053` sont débloquées. Aucune variable d'environnement de clé de
chiffrement applicative n'est à prévoir : la clé est gérée par l'extension.

*Conséquence de conception, plus forte que prévu.* La décision 7 protégeait `secret_id` par un
`REVOKE SELECT` pour `authenticated`. La mesure montre que le schéma `vault` est **intégralement**
hors de portée d'`anon` et d'`authenticated`. Le `REVOKE` sur `secret_id` reste néanmoins exigé :
il porte sur `mail_accounts` et `mail_outbound_identities`, tables du schéma `public` que
PostgREST expose, et empêche un membre du workspace de lire la **référence** du secret d'un
collègue. Les deux mesures se cumulent, elles ne se remplacent pas.

### Décision 24 — La clé racine de Vault est une donnée de sauvegarde à part entière

*Problème découvert en vérifiant, et non anticipé.* La clé racine de Vault ne vit **pas** dans
`PGDATA` :

```
$ psql -c "select name, setting from pg_settings where name like '%vault%' or name like '%sodium%';"
 pgsodium.getkey_script | /usr/lib/postgresql/bin/pgsodium_getkey.sh
 vault.getkey_script    | /usr/lib/postgresql/bin/pgsodium_getkey.sh

$ cat /usr/lib/postgresql/bin/pgsodium_getkey.sh
KEY_FILE=/etc/postgresql-custom/pgsodium_root.key
if [[ ! -f "${KEY_FILE}" ]]; then
    head -c 32 /dev/urandom | od -A n -t x1 | tr -d ' \n' > "${KEY_FILE}"
fi
cat $KEY_FILE
```

`/etc/postgresql-custom` est monté depuis le volume nommé `db-config` (`docker-compose.yml`),
distinct du volume de données. Une sauvegarde de la seule base ne restitue donc **aucun** secret.
Le fait a été mesuré, pas déduit : PGDATA conservé, volume de configuration remplacé par un
volume neuf, le chiffré est toujours en base et le déchiffrement échoue.

```
$ psql -Atc "select left(secret,20) from vault.secrets where name='cle-test';"
YD+4JshlhDol0VGifcSE
$ psql -Atc "select decrypted_secret from vault.decrypted_secrets where name='cle-test';"
ERROR:  pgsodium_crypto_aead_det_decrypt_by_id: invalid ciphertext
```

*Décision.* Le volume `db-config`, et plus précisément `/etc/postgresql-custom/pgsodium_root.key`,
est inscrit comme **élément obligatoire du périmètre de sauvegarde** dans `docs/DAT.md` §10 et
dans `docs/PROD_MIGRATIONS.md`. Une restauration qui l'omettrait rendrait tous les comptes de
messagerie inutilisables et **irrécupérables** : il faudrait ressaisir chaque mot de passe.

*Conséquence pour le développement.* Aucune : `resetMe.sh` fait `compose down -v`, qui détruit
`db-config` en même temps que la base. Clé et secrets disparaissent ensemble, ce qui est cohérent.

*Limite connue.* La procédure de restauration n'est pas testée — c'est l'objet de l'unité de
sauvegarde dédiée (`CRM-P11`, en attente d'arbitrage). Ce qui est acquis ici, c'est la
**contrainte** ; sa mise en œuvre reste à livrer.

### Ce que la mesure invalide : le motif principal de la décision 8

La décision 8 écartait `pg_cron` pour deux motifs. Le premier — « sa présence dans l'image retenue
n'est pas vérifiée » — est **faux depuis cette mesure** : `pg_cron` 1.6.4 est là, préchargé, et
ordonnance réellement. Le second motif tient toujours : placer l'ordonnancement dans `mail-sync`
le rend testable par pytest sans manipuler la base, et garde l'orchestration métier dans le
service qui la porte.

Le **résultat** de la décision 8 est donc conservé — l'ordonnanceur reste applicatif — mais son
énoncé est corrigé dans `docs/DAT.md` §3.3 et §12 pour ne plus invoquer un motif démenti par la
mesure. Rouvrir le choix lui-même dépasse le périmètre de `CRM-004` : le point est consigné en
`docs/INCONSISTENCY_REPORT.md`, INC-012, **en attente d'arbitrage du responsable**.

### Vérifications réalisées

`scripts/verify-vault.sh` rejoue l'ensemble : **26 vérifications, aucune anomalie**. Le harnais est
autonome — il ne dépend ni de `.env` ni de la pile en cours d'exécution —, crée ses propres
conteneur et volumes jetables et les détruit en sortant, y compris sur interruption.

Il est **non complaisant**, ce qui a été éprouvé de trois manières :

1. *Contre-épreuve interne.* Le harnais relâche lui-même le cloisonnement
   (`grant usage on schema vault to authenticated`) et exige que le contrôle du §3 **échoue** ;
   puis il restitue la clé racine d'origine et exige que le secret **redevienne** lisible — sans
   quoi l'échec de déchiffrement du §4 aurait pu tenir à une autre cause.
2. *Contre-épreuve externe.* Exécuté contre une image `postgres:17-alpine` dépourvue de Vault, il
   rend **25 anomalies sur 26** et sort en `1`. Le seul contrôle encore vert est la contre-épreuve
   interne elle-même, qui constate à juste titre que le contrôle de cloisonnement échoue.
3. *Défaut corrigé pendant l'écriture.* La première version concluait au chiffrement dès lors que
   le clair n'apparaissait pas dans la sortie — ce qu'une requête **en erreur** satisfait aussi.
   La contre-épreuve externe l'a révélé par un « OK » injustifié. Le contrôle exige désormais une
   valeur réellement lue, en base64, distincte du clair. Le contrôle « aucune copie de la clé dans
   PGDATA » souffrait du même vice et est désormais subordonné à l'existence d'une clé.

Un second défaut, d'exécution celui-là, a été corrigé : `psql -c` retourne un code non nul sur une
erreur, et `set -euo pipefail` interrompait le harnais au premier refus **attendu**. Les refus sont
la matière même des preuves : les fonctions d'accès neutralisent désormais le code de retour, sans
jamais masquer le message, qui reste ce que chaque contrôle examine.

### Ce que cette unité ne prouve pas

- **Aucun test E2E dédié, ni vérification visuelle.** Cette unité est une décision d'architecture :
  elle ne livre aucun parcours utilisateur, aucun écran, aucune migration. Ses preuves sont
  d'intégration, et vivent dans `scripts/verify-vault.sh`.
- **Aucune mise à jour du seed** : rien de cette unité n'y atteint. Le seed est l'objet de
  `CRM-005`.
- **Aucun secret de messagerie n'est encore stocké** : les tables `mail_accounts` et
  `mail_outbound_identities` n'existent pas. Ce qui est prouvé, c'est que le mécanisme retenu
  fonctionne dans l'image retenue — pas son usage par le produit, qui relève de `CRM-052` et
  `CRM-053`.
- **La restauration d'une sauvegarde n'est pas éprouvée** (décision 24, limite connue).

---

## 2026-08-03 — `CRM-010` : fonctions d'autorisation

Première brique du modèle d'autorisation. Objectif : livrer les fonctions sur lesquelles les
politiques RLS de `CRM-012` s'appuieront, et prouver qu'elles répondent juste — y compris pour un
appelant anonyme, pour un membre d'un autre workspace, et lorsqu'un droit est révoqué sans que le
jeton ait expiré.

### Le problème rencontré d'emblée : quatre fonctions sur six ne sont pas écrivables

`docs/SPEC-permissions-rls.md` §3 énumère six fonctions. Quatre d'entre elles —
`can_read_track`, `can_read_channel`, `can_write_channel`, `can_read_card` — reçoivent
l'identifiant d'un objet et doivent remonter jusqu'à son workspace. Ce chemin passe par `tracks`,
`channels` et `cards`, livrées par `CRM-020`, `CRM-021` et `CRM-040`, c'est-à-dire au chunk
suivant.

*Options examinées.*

1. **Créer les tables manquantes par anticipation.** Écarté : cela préempte trois unités et
   déborde très largement du périmètre autorisé.
2. **Écrire les quatre fonctions quand même.** PL/pgSQL accepte une référence à une table absente
   — la fonction est créée, puis échoue au premier appel. Écarté : aucune preuve ne serait
   possible avant `CRM-020`, et le dépôt porterait quatre pièges silencieux.
3. **Rendre les fonctions tolérantes à l'absence des tables** (`to_regclass`, garde conditionnelle).
   Écarté sans hésitation : c'est du masquage d'erreur, interdit par `CLAUDE.md` §18.
4. **Livrer ce qui est démontrable, consigner le reste.** Retenu.

La contradiction d'ordonnancement est consignée en `docs/INCONSISTENCY_REPORT.md`, **INC-013**,
avec trois options d'arbitrage. L'unité reste `[~]` : ce n'est pas un défaut de réalisation, mais
une dépendance non satisfiable dans l'ordre actuel du plan.

### Décision 25 — L'algorithme de résolution est isolé des tables qu'il ne peut pas encore lire

*Problème.* La règle métier de `docs/SPEC-permissions-rls.md` §2.2 — « le plus spécifique gagne »,
« un administrateur n'est jamais restreint » — est la partie difficile et la seule qui puisse
produire un défaut d'autorisation. Or elle se trouvait, dans la rédaction initiale, enfermée à
l'intérieur des quatre fonctions non écrivables. Attendre `CRM-020` aurait signifié livrer plus
tard une règle non éprouvée, au milieu de jointures, donc éprouvable seulement par fixtures.

*Décision.* La règle est livrée **maintenant**, sous la forme d'une fonction pure :
`app.resolve_access(ws_role, track_access, channel_access)`, qui ne lit aucune table et rend
`none`, `read` ou `write`. Les quatre fonctions différées n'auront plus qu'à lire leur ligne et
l'appeler.

*Conséquences.* La règle se prouve par **énumération complète** de ses entrées : 4 rôles de
workspace — dont l'absence de rôle — par 4 états du droit fin de track par 4 états du droit fin de
channel, soit **64 combinaisons**, toutes écrites en clair dans la suite pgTAP. Aucune fixture,
aucun compte, aucune table. Lorsque `CRM-020` arrivera, la partie restante des quatre fonctions
sera une lecture de ligne, dont la preuve est bien plus simple à écrire.

*Écart assumé.* `resolve_access` n'est pas nommée dans `docs/SPEC-permissions-rls.md` §3. Ce n'est
pas un périmètre supplémentaire mais une **décomposition** des fonctions spécifiées : elle n'ajoute
aucun comportement, elle isole celui qui existe déjà. `docs/SCHEMA.md` §9 et
`docs/SPEC-permissions-rls.md` §3 la documentent dans le même changement.

*Un point de sémantique tranché explicitement.* « Le plus spécifique gagne » vaut dans les deux
sens : un `channel_members.access = 'member'` l'emporte sur un `track_members.access = 'none'` du
track qui contient ce channel. Ce cas est peu intuitif — il autorise plus bas ce qui est refusé
plus haut — mais c'est ce que la précédence channel → track → workspace signifie. Il est écrit
noir sur blanc dans la migration et couvert par les lignes 45 à 48 et 61 à 64 de la matrice.

### Décision 26 — `EXECUTE` est accordé à `anon`, pour que le refus reste « zéro ligne »

*Problème.* `docs/SPEC-permissions-rls.md` §3 demande que ces fonctions soient « accordées à
`authenticated` ». Une politique RLS est pourtant évaluée avec les droits du **rôle courant** : un
appelant anonyme atteignant une table dont la politique appelle `app.is_workspace_member()`
recevrait, sans `EXECUTE`, une **erreur de privilège**. Or le §7 exige exactement l'inverse : « un
refus ne se manifeste pas toujours par une erreur : pour une lecture, l'attendu est zéro ligne ».

*Décision.* `EXECUTE` est accordé à `anon`, `authenticated` et `service_role`. C'est la même
logique qui avait conduit `CRM-003` à accorder `SELECT` à `anon` sur les cinq tables, et à lui
accorder `USAGE` sur le schéma `app`.

*Conséquences.* Le droit n'ouvre rien : `auth.uid()` étant nul sans jeton, les trois prédicats
rendent faux ou NULL. La suite pgTAP le mesure (§3.6), et `scripts/verify-authz.sh` le mesure une
seconde fois sous PostgREST avec la clé anonyme réelle : `HTTP 200` et corps `[]`. `PUBLIC` reste
exclu, ce qui est vérifié sur l'ACL des quatre fonctions.

### Décision 27 — Prouver l'absence de récursion en la provoquant

*Problème.* La Definition of Done exige que l'« absence de récursion soit démontrée ». Une
assertion sur `prosecdef = true` ne démontre rien : elle constate un attribut, pas un
comportement.

*Décision.* La suite pgTAP provoque la récursion de deux façons distinctes, puis exécute la même
politique adossée à la fonction livrée.

*Mesures obtenues.*

| Montage | Résultat mesuré |
|---|---|
| Politique sur `workspace_members` interrogeant `workspace_members` | `42P17` — « infinite recursion detected in policy for relation » |
| Politique appelant une jumelle `SECURITY INVOKER` de `is_workspace_member` | `54001` — « stack depth limit exceeded » |
| Politique appelant `app.is_workspace_member` telle que livrée | aucune erreur, et le filtrage attendu — 3 membres visibles sur 4 |

*Fait relevé, contraire à l'attente initiale.* Le second montage ne produit **pas** `42P17`.
PostgreSQL ne détecte pas la récursion lorsqu'elle traverse une fonction : la pile est épuisée à
la place. Le résultat est le même — la requête échoue — mais le diagnostic est bien moins lisible.
C'est un argument de plus en faveur de `SECURITY DEFINER`, et la raison pour laquelle la suite
attend `54001` et non `42P17` sur ce montage : elle mesure ce qui se produit réellement, et non ce
qu'on aurait supposé.

### Décision 28 — Instrumenter pour prouver, puis retirer et vérifier le retrait

*Problème.* Le schéma `app` n'est pas exposé par PostgREST, et `CRM-010` ne livre volontairement
aucune politique. Le comportement de ces fonctions sous un **vrai jeton**, à travers la véritable
pile, n'était donc observable par aucun chemin : la preuve se serait réduite à ce que pgTAP mesure
déjà en base, ce que `CLAUDE.md` §10 refuse — « toute règle d'accès doit être vérifiée par une
requête directe qui contourne l'interface ».

*Décision.* `scripts/verify-authz.sh` pose **temporairement** deux politiques sur
`public.workspaces`, adossées aux fonctions livrées, interroge l'API avec trois jetons réels
obtenus par la route de connexion, puis les retire et **vérifie qu'il n'en reste aucune**.

*Conséquences.* Ce qui est mesuré est bien le comportement réel : chaque profil ne voit que son
workspace, l'anonyme obtient `200` et `[]`, un `viewer` ne modifie rien, un administrateur d'un
autre workspace non plus, et une appartenance retirée coupe l'accès immédiatement avec un jeton
toujours valide. Le harnais encadre l'instrumentation par un `trap` — les politiques disparaissent
même en cas d'interruption —, il vérifie qu'aucune politique ne subsiste, et il constate que le
refus par défaut de `CRM-003` est restauré à l'identique. Les politiques portent le préfixe
`tst_crm010_` et n'existent dans aucune migration.

*Ce que ce montage ne prouve pas.* Il ne préjuge en rien des politiques que `CRM-012` écrira :
celles-ci sont un choix de conception, pas une conséquence de cette instrumentation.

### Ce que cette unité ne prouve pas

- **Quatre des six fonctions ne sont pas livrées** (INC-013). Ce qui manque n'est pas la règle
  métier — elle est livrée et prouvée — mais la jointure qui remonte au workspace.
- **Aucune politique RLS n'est écrite.** Le refus par défaut de `CRM-003` est intact, ce que la
  suite pgTAP vérifie explicitement. Au passage, aucune unité du backlog ne porte nommément les
  politiques des tables d'identité : consigné en **INC-014**.
- **Aucun test E2E dédié, ni vérification visuelle.** Cette unité ne livre ni parcours utilisateur
  ni écran — le premier arrive avec `CRM-007`, le harnais Playwright avec `CRM-008`. Ses preuves
  sont unitaires (pgTAP) et d'intégration (PostgREST, jetons réels, hors interface).
- **Aucune mise à jour du seed** : il n'existe pas encore, c'est l'objet de `CRM-005`. Les comptes
  et les workspaces de l'étape 3 du harnais sont créés puis détruits par le harnais lui-même.

---

## 2026-08-03 — `CRM-011` : authentification, spécification écrite après mesure

Le backlog décrit `CRM-011` en une ligne — « GoTrue, inscription libre désactivée, invitation par
un administrateur, connexion, déconnexion, réinitialisation de mot de passe » — et `docs/DAT.md`
§4.1 et §7 s'en tiennent à deux phrases. Aucun document ne dit ce qu'un refus doit rendre, qui a le
droit d'inviter, ni ce que le produit exige d'un mot de passe. La spécification manquait : elle est
écrite et committée avant toute ligne de code (`CLAUDE.md` §5), dans `docs/SPEC-auth.md`.

Elle a été écrite **après mesure** et non de mémoire. GoTrue est un service tiers dont le
comportement réel est la seule autorité : rédiger d'abord puis découvrir ensuite que la version
épinglée fait autre chose aurait produit une spécification fausse, donc pire qu'absente. Toutes les
valeurs du §7 de `docs/SPEC-auth.md` proviennent d'appels réellement exécutés contre
`supabase/gotrue:v2.189.0`.

### Ce que la mesure a démenti, et ce qu'elle a confirmé

*Confirmé.* `DISABLE_SIGNUP=true` refuse `POST /signup` par `422 signup_disabled`. Le refus est
celui de l'instance et **le privilège ne le contourne pas** : présenté avec la clé `service_role`,
le même appel est refusé à l'identique. C'était une hypothèse — beaucoup d'implémentations
laissent un administrateur passer outre — et elle méritait d'être vérifiée plutôt que supposée.

*Confirmé.* L'invitation présentée avec la clé anonyme est refusée par `403 not_admin`.

*Confirmé.* Une adresse inconnue et un mot de passe erroné rendent **le même** message,
`400 invalid_credentials` ; `POST /recover` sur une adresse inconnue rend `200` sans émettre
d'email — boîte Inbucket vérifiée vide. L'API ne renseigne donc pas un attaquant sur l'existence
d'un compte.

*Démenti, et corrigé par cette unité.* La longueur minimale de mot de passe valait **6**. Ce
n'était pas une valeur théorique : un mot de passe de six caractères a été réellement accepté par
`PUT /auth/v1/user` avant cette unité.

### Décision 29 — La longueur minimale de mot de passe passe à 12, sans exigence de composition

*Problème.* Le défaut de GoTrue, 6 caractères, est mesuré comme réellement permissif. Un CRM
contient les données commerciales et la correspondance d'une entreprise : c'est trop bas.

*Options examinées.*

1. **Ne rien changer** et laisser le sujet à une unité de durcissement ultérieure. Écarté : aucune
   unité ne le porte, et laisser un défaut connu derrière soi au motif qu'il n'est pas nommé est
   exactement ce que `CLAUDE.md` §17 interdit.
2. **Imposer une composition** — majuscule, chiffre, caractère spécial. Écarté : ces règles
   poussent vers des mots de passe courts, complexes et réutilisés, plus faibles en pratique que
   des mots de passe longs, et elles multiplient les états d'erreur à traduire et à tester.
3. **Porter la longueur minimale à 12, sans autre exigence.** Retenu.

*Conséquences.* `PASSWORD_MIN_LENGTH` entre dans `.env.example` et dans le service `auth`. Le refus
est explicite (`422 weak_password`, raison `length`) et prouvé dans les deux sens : onze caractères
refusés, douze acceptés. Aucun compte n'existe encore, donc aucun mot de passe existant n'est
invalidé — la décision est gratuite aujourd'hui et coûteuse plus tard, ce qui est précisément le
motif de la prendre maintenant.

### Décision 30 — L'invitation reste une opération d'opérateur, faute d'arbitrage

*Problème.* `POST /auth/v1/invite` exige un jeton `service_role`. La webapp ne doit **jamais**
détenir cette clé. Entre l'administrateur de workspace qui clique et GoTrue qui envoie l'email, il
manque donc un composant serveur, et le projet n'en possède aucun qui convienne : les fonctions
edge ne sont pas au périmètre (INC-007), et `mail-sync` (`CRM-051`) n'existe pas encore et vise la
messagerie du produit, pas l'identité.

*Mesure faite pour éclairer l'arbitrage, et non pour le trancher.* `pg_net` 0.20.3 est **déjà
installée** dans la base et préchargée, et la base joint réellement GoTrue :

```
select net.http_get('http://auth:9999/health');
-- status_code 200, {"version":"v2.189.0","name":"GoTrue",...}
```

Une fonction `SECURITY DEFINER` vérifiant `app.is_workspace_admin` puis appelant GoTrue par
`pg_net`, avec la clé de service rangée en Vault, est donc **techniquement possible aujourd'hui**.

*Pourquoi elle n'est pas écrite ici.* Elle introduirait une table d'invitations absente de
`docs/SCHEMA.md`, un appel sortant depuis la base absent de `docs/DAT.md` §3, et une clé de service
à provisionner en Vault, c'est-à-dire trois choix d'architecture que `CRM-011` n'a pas mandat de
prendre. Les inventer au motif qu'ils sont possibles reviendrait à résoudre implicitement une
question ouverte, ce que `CLAUDE.md` §5 interdit.

*Comportement retenu en attendant.* L'invitation est émise par un **opérateur** disposant de la clé
de service. Le parcours produit est consigné en **INC-015**, avec les trois options et la mesure
ci-dessus, et attend l'arbitrage du responsable.

### Décision 31 — Les gabarits d'emails restent ceux de GoTrue, et le mode de défaillance est documenté

*Problème.* Les emails partent en anglais, dans un produit français.

*Mesure.* GoTrue v2.189 ne sait charger un gabarit personnalisé que par **HTTP**. Un chemin de
fichier n'est pas reconnu : la valeur est concaténée à `SITE_URL`, ce que la journalisation du
service montre sans ambiguïté :

```
templatemailer: template type "invite":
Get "http://localhost:5173file///etc/gotrue/templates/invite.html": no such host
```

**Et l'email est tout de même parti**, avec le gabarit anglais par défaut. C'est le fait important :
la défaillance est **silencieuse du point de vue du destinataire**. Un email reçu ne prouve pas que
le gabarit configuré a été employé.

*Options examinées.* Ajouter un serveur statique au seul usage des gabarits — un service de plus
dans deux assemblages, pour quatre fichiers. Servir les gabarits depuis la webapp, qui n'existe pas
et dont l'origine `localhost:5173` n'est de toute façon pas joignable depuis le réseau des
conteneurs. Les deux débordent de `CRM-011` et empiètent sur `CRM-007`.

*Décision.* Les gabarits par défaut sont conservés. La limite est nommée dans
`docs/SPEC-auth.md` §5 plutôt que masquée, et consignée en **INC-016** — rattachée à `CRM-P09`
(internationalisation), qui reste en attente d'arbitrage.

### Deux constats faits pendant la vérification, et non prévus par la spécification

*Les emails sont en HTML seul.* Inbucket signale sur chaque message reçu « MIME problems detected
— Plain Text from HTML: Message did not contain a text/plain part ». Les gabarits par défaut de
GoTrue n'émettent aucune partie `text/plain`. Conséquence pour le produit : signal négatif de
délivrabilité, et clients en mode texte mal servis. Conséquence pour les preuves : la partie texte
que lit `scripts/verify-auth.sh` est **reconstruite par Inbucket**, elle n'est pas émise par
GoTrue. Consigné en INC-016 plutôt que corrigé, puisque les gabarits ne sont pas modifiables sans
trancher INC-016 lui-même.

*Une variable ajoutée n'atteint pas un `.env` existant, mais le cas n'est pas silencieux.* Après
avoir ajouté `PASSWORD_MIN_LENGTH` au gabarit, le service `auth` a démarré avec la variable
**vide** — un `.env` déjà amorcé ne gagne pas les variables introduites depuis. La validation de
`CRM-002` a bien attrapé le cas au lancement suivant :

```
  manquante PASSWORD_MIN_LENGTH
ERREUR 1 variable(s) à corriger dans /home/user/p2enjoy-crm/.env. Le contrat est .env.example.
```

C'est exactement le comportement voulu, et il valait d'être mesuré plutôt que supposé. La marche à
suivre est désormais écrite dans `docs/PROD_MIGRATIONS.md` §4. Le harnais en tire une leçon : son
premier contrôle compare la configuration **réellement appliquée au conteneur** aux valeurs du
`.env`, de sorte qu'un réglage documenté mais non câblé ne puisse pas passer inaperçu — sans lui,
tous les contrôles suivants auraient mesuré les défauts de l'image en croyant mesurer le produit.

### Vérifications réalisées

`scripts/verify-auth.sh` : **42 contrôles, aucune anomalie**. Le cycle complet est exercé hors
interface — invitation émise, email constaté dans Inbucket, acceptation en suivant le lien de cet
email, mot de passe défini, connexion, mot de passe erroné refusé, adresse inconnue indistinguable,
requête sans clé refusée par la passerelle, contenu du jeton vérifié claim par claim, jeton accepté
par PostgREST, rafraîchissement, déconnexion, rafraîchissement ensuite refusé, réinitialisation
menée à son terme, ancien mot de passe refusé, compte supprimé sans profil orphelin.

*Non-complaisance éprouvée dans les deux sens.* Le harnais démarre un GoTrue **jetable**, même
version épinglée, portant le réglage affaibli, et exige qu'il accepte ce que la pile refuse. Et le
harnais a été **réellement mis en échec** contre la pile affaiblie : `DISABLE_SIGNUP=false` produit
**6 anomalies**, `PASSWORD_MIN_LENGTH=6` en produit **2**, dans les deux cas avec un code de sortie
`1`. La configuration a ensuite été restaurée et le harnais est repassé à 42/42.

*Vérification visuelle réellement observée.* Trois captures dans `docs/captures/CRM-011/` : le
moniteur d'Inbucket montrant le trafic SMTP réel des exécutions, l'email d'invitation et l'email
de réinitialisation, ouverts et lus. C'est la seule vérification visuelle que cette unité rend
possible — et c'est précisément celle que sa Definition of Done nomme.

### Ce que cette unité ne prouve pas

- **Aucun écran, aucun test E2E d'interface, aucune capture d'application.** La webapp arrive avec
  `CRM-007` et le harnais Playwright avec `CRM-008`. La seule vérification visuelle possible et
  réellement faite porte sur l'email d'invitation tel qu'il arrive dans Inbucket, ce que la
  Definition of Done de l'unité nomme explicitement.
- **Aucun rattachement d'un compte invité à un workspace** (INC-015).
- **L'expiration des liens d'invitation et de réinitialisation** n'est pas mesurée : la valeur par
  défaut est de 24 heures, et la vérifier exigerait de manipuler le temps de l'instance.

---

## 2026-08-03 — `CRM-005` : spécification du seed, écrite après mesure

### Contexte : pourquoi une spécification avant le script

`CRM-005` avait une Definition of Done — « utilisateurs créés par l'API d'administration GoTrue ;
un workspace ; les rôles représentés ; identifiants stables » — mais **aucun document ne disait
lesquels**. Or `docs/DAT.md` §11 pose que le seed est un *contrat maintenu* : un contrat dont le
contenu ne vit que dans un script est un contrat que personne ne peut opposer au code.

Les unités à venir en dépendent directement : `CRM-014` interrogera l'API avec les jetons de ces
comptes, `CRM-007` produira des captures où ces noms figureront, `CRM-046` étendra ce jeu. Chacune
a besoin d'identifiants stables **écrits quelque part**. D'où `docs/SPEC-seed.md`, écrit et commité
avant la première ligne du script, comme `docs/SPEC-auth.md` l'avait été pour `CRM-011`.

### Choix de l'unité : pourquoi `CRM-005` et non `CRM-012`

`docs/MASTER_PLAN.md` §2 place l'étape 2.b (`CRM-010` → `CRM-014`) avant l'étape 2.c
(`CRM-005` → `CRM-008`). Les trois unités restantes de 2.b ont pourtant été écartées, après examen
et non par commodité :

- **`CRM-012`** — sa Definition of Done vise les preuves n° 3, 4, 7 et 11 de
  `docs/SPEC-permissions-rls.md` §7, qui portent sur les *cards* et les *comptes mail* : aucune de
  ces tables n'existe. Elle écrirait de surcroît les politiques des tracks et channels, qui
  appellent les quatre fonctions différées d'INC-013. INC-011 et INC-013 demandent explicitement un
  arbitrage **avant** `CRM-012` ; la démarrer reviendrait à trancher implicitement deux points que
  le responsable doit trancher.
- **`CRM-013`** — porte sur `cards.current_step_id`, `mail_accounts.secret_id`, `card_events` et
  `audit_log` : aucune de ces tables n'est livrée.
- **`CRM-014`** — exige un projet Playwright, objet de `CRM-008`, et les douze scénarios de refus,
  eux-mêmes bloqués par ce qui précède.

`CRM-005` est donc la première unité **réellement exécutable**. Elle n'enfreint aucune des
« contraintes d'ordre à ne pas enfreindre » de `docs/MASTER_PLAN.md` §2, qui ne la mentionnent pas,
et elle lève la dernière case ouverte de `CRM-002` — la branche « seed » de `resetMe.sh`, restée
non prouvée faute de seed (INC-009).

### Décision 32 — Le seed passe par les API réelles, jamais par `psql`

`docs/DAT.md` §11 exigeait déjà que les utilisateurs naissent de l'API d'administration GoTrue.
La décision étend la règle à tout ce que le seed écrit :

- comptes → `POST /auth/v1/admin/users` ;
- profils → **personne** : ils naissent du trigger de `CRM-003`, alimenté par `user_metadata` ;
- workspace et appartenances → `POST /rest/v1/...`, l'API REST réelle.

*Motif.* Un seed qui écrirait en SQL direct contournerait exactement ce que le produit oppose à ses
clients : contraintes, triggers, cache de schéma, refus par défaut. Il produirait un état que
l'application ne sait pas produire, et les tests qui s'appuieraient dessus prouveraient quelque
chose d'autre que le produit.

*Conséquence assumée.* Le chemin employé reste celui d'un **opérateur** — il exige la clé de
service —, pas celui d'un administrateur depuis l'interface. Ce dernier suppose les politiques de
`CRM-012` et un écran ; ni l'un ni l'autre n'existent. La limite est écrite dans
`docs/SPEC-seed.md` §3.2 et §8 plutôt que passée sous silence.

*Mesures.* La clé de service écrit bien malgré RLS sans politique (`201`) ; la clé anonyme est
refusée (`401`, `SQLSTATE 42501`, `INSERT` non accordé à `anon` par la migration `0001`) ; la
contrainte `CHECK` sur `workspace_members.role` est active à travers l'API (`400`, `23514`).

### Décision 33 — Les identifiants du seed sont fixés, et reconnaissables à l'œil

**Mesure préalable, sans laquelle la décision n'était pas tenable** : `supabase/gotrue:v2.189.0`
**accepte un `id` fourni** dans la charge utile de `POST /auth/v1/admin/users`. Le compte créé porte
exactement l'UUID demandé. Rien ne l'imposait : l'hypothèse inverse aurait obligé le seed à relire
les identifiants après coup et interdit toute référence stable dans un test écrit d'avance.

Tous les identifiants du seed sont donc constants, et adoptent le préfixe **`5eed`** :

```
5eed0000-0000-4000-8000-000000000011
```

*Motif.* Une ligne seedée doit être reconnaissable **sans requête**, dans une capture, un journal
d'erreur ou un tableau de Studio. Les UUID restent parfaitement valides — version 4, variant RFC
4122 — et aucun outil ne les traite différemment.

### Décision 34 — Le seed converge, et converge le profil explicitement

Le seed est rejouable sans erreur ni doublon, pour la même raison que les migrations
(décision 20) : `resetMe.sh` l'appelle à chaque redémarrage à froid, et `npm run db:seed` le
rejouera à la demande.

Deux mesures ont dicté la forme de cette convergence :

1. **Recréer un compte existant est refusé** — `422`, `error_code` `email_exists`. Le seed teste
   donc la présence avant de créer.
2. **Mettre à jour les métadonnées d'un compte ne met pas à jour son profil.** Le trigger de
   `CRM-003` est `AFTER INSERT` et porte `on conflict (id) do nothing` : il ne se déclenche pas sur
   un `UPDATE`, et n'écraserait pas un profil existant même dans ce cas. C'est exactement ce que la
   décision 22 voulait — un profil édité par son titulaire n'est pas écrasé — et cela signifie que
   le seed **ne peut pas** compter sur `user_metadata` pour rattraper une dérive du nom affiché.

Le seed converge donc `public.profiles` par un `PATCH /rest/v1/profiles` explicite, mesuré efficace
avec la clé de service. Pour les tables sans trigger, l'upsert natif de PostgREST suffit :
`Prefer: resolution=merge-duplicates` a été mesuré sur `workspace_members`, dont la clé primaire est
composite — deux passages rendent `201` puis `200` et laissent **une seule ligne**.

*Conséquence.* La preuve n° 9 du §7 de `docs/SPEC-seed.md` n'est pas décorative : elle **fausse
réellement** un nom de profil et un rôle, rejoue le seed, et exige le rétablissement. Sans elle, la
décision ne serait qu'une intention.

### Ce que la mesure a démenti : la politique de mot de passe n'est pas universelle

`docs/SPEC-auth.md` §4 énonce `PASSWORD_MIN_LENGTH=12` sans réserve, et `CRM-011` l'a prouvée dans
les deux sens — mais sur le chemin **utilisateur** seulement. Le chemin employé par le seed est
celui de l'**administration**, et il ne l'applique pas :

```
PUT  /auth/v1/user          mot de passe de 11 caractères  -> 422 weak_password
POST /auth/v1/admin/users   mot de passe de  8 caractères  -> 200, compte créé
```

Le réglage est pourtant bien appliqué au conteneur (`GOTRUE_PASSWORD_MIN_LENGTH=12`), et le compte
créé avec huit caractères **se connecte réellement** : `200` et un jeton d'accès valide. La
politique encadre ce qu'un utilisateur choisit, jamais ce qu'un opérateur impose.

Le point est consigné en **INC-018**, avec trois options d'arbitrage, et **non résolu ici** : la
correction appartient à `CRM-011`, dont c'est la spécification. Le seed s'y conforme volontairement
— 16 caractères — et son harnais **prouve** cette longueur au lieu de la supposer, puisque l'API ne
la garantit pas.

C'est la deuxième fois qu'une mesure prise pour une autre unité corrige l'énoncé d'une décision
antérieure (après INC-012). Le motif est le même : un comportement de service tiers avait été
généralisé à partir d'un seul chemin d'appel.

### Vérifications réalisées

`scripts/verify-seed.sh` : **49 contrôles, aucune anomalie**, dont la suite pgTAP
`supabase/tests/0003_seed_socle.test.sql` (**30 assertions**) qui vérifie le même contrat un cran
sous l'API. Les douze preuves de `docs/SPEC-seed.md` §7 sont exercées hors interface : contrat du
workspace, identifiants fixes des trois comptes, profils et langues, appartenances et rôles,
**connexion réelle** des trois comptes avec le mot de passe publié, `sub` du jeton conforme à
l'identifiant fixe, rejouabilité, rattrapage d'une dérive réellement provoquée, refus par défaut
intact, et refus d'un profil d'environnement autre que `dev`.

*Non-complaisance éprouvée en faussant réellement le seed*, et non en le simulant :

| Mutation | Résultat |
|---|---|
| Rôle du `viewer` changé en `admin` dans le seed | **4 anomalies**, code de sortie `1` — détectée par pgTAP **et** par l'API |
| Identifiant d'un compte faussé, compte déjà présent | Le seed **refuse lui-même** : sa garde d'identifiant fait échouer le harnais |
| Identifiant faussé, compte préalablement supprimé | **7 anomalies**, code de sortie `1` : identifiant, profil, appartenance et `sub` du jeton |

Après remise en état, retour à 49/49.

*Preuve que `CRM-005` débloque `CRM-002`.* La branche « seed » de `resetMe.sh`, jamais exercée
jusqu'ici faute de seed (INC-009), l'a été : `./resetMe.sh --yes` détruit le cluster — identifiant
PostgreSQL passé de `7669930091773866019` à `7669933096091242530`, table témoin disparue —, rejoue
les migrations à blanc, **puis applique le seed**, le tout en **45,6 s**. Les trois comptes et
leurs appartenances sont constatés sur la base neuve.

*Aucune régression.* Les sept harnais rejoués après réinitialisation à froid :
`verify-stack` 33/33, `verify-scripts` 38/38, `verify-migrations` 23/23, `verify-vault` 26/26,
`verify-authz` 26/26, `verify-auth` 42/42, `verify-seed` 49/49 — **237 contrôles**.

### Décision 35 — Une suite de tests ne doit pas dépendre de ce qui l'entoure

Le seed a fait **échouer la suite pgTAP de `CRM-003`**, de deux façons distinctes :

1. une assertion comptait `select count(*) from public.profiles` et attendait `4`, ses propres
   fixtures — elle en a trouvé `7`, les trois du seed compris ;
2. la suite insérait un workspace de slug `p2enjoy`, celui-là même que le seed pose désormais. La
   collision d'unicité produisait une **erreur d'insertion**, pas une assertion rouge : tout ce qui
   suivait était interrompu.

Le défaut n'est pas dans le seed. Il est dans une suite qui supposait la base vide — hypothèse
jamais garantie, vraie seulement par accident, et que `resetMe.sh` invalide désormais à chaque
redémarrage à froid puisqu'il applique le seed.

*Correction, dans le même changement :* l'assertion compte ses **quatre fixtures nommées** au lieu
de toute la table, et le workspace de test prend le slug `pgtap-crm-003`, qui n'appartient qu'à
elle. La suite repasse à **70/70**.

*Pourquoi ce n'est pas consigné comme contradiction à arbitrer.* La correction n'a qu'une forme
sensée — un test se borne à ses propres données —, elle ne change rien à ce que la suite prouve, et
elle ne préempte aucune décision du responsable. La consigner en `INCONSISTENCY_REPORT.md` aurait
demandé un arbitrage là où il n'y a pas de choix.

*Règle qui en découle,* opposable aux suites à venir : une assertion pgTAP ne porte que sur des
lignes qu'elle a elle-même créées, ou filtrées par un identifiant qui lui appartient. Les
identifiants du seed commençant tous par `5eed` (décision 33), la distinction est immédiate.

### Vérification visuelle réellement observée

Quatre captures dans `docs/captures/CRM-005/`, produites contre la pile réellement exécutée et
**observées** : la liste des comptes dans Studio — les trois identifiants `5eed…`, les noms
affichés et les adresses, « Total: 3 users » —, la table `profiles`, la table `workspaces` et la
table `workspace_members` avec ses trois rôles distincts.

Comme pour `CRM-011`, ces captures montrent un outil d'**exploitation**, pas le produit : le
premier écran du CRM arrive avec `CRM-007`. C'est la seule vérification visuelle que cette unité
rende possible, et elle vaut d'être faite — elle donne à voir l'état que le seed produit.

### Ce que cette unité ne prouve pas

- **Aucun test E2E dédié, aucune capture d'application.** Le harnais Playwright est l'objet de
  `CRM-008` et le premier écran celui de `CRM-007`. Les preuves de cette unité sont unitaires
  (pgTAP) et d'intégration (API réelle, hors interface), ce que la nature d'un seed commande.
- **Le seed ne rend rien lisible**, et ne le doit pas : les tables du socle restent en refus par
  défaut jusqu'à `CRM-012`. Le script l'affiche à chaque exécution, et la preuve n° 11 le mesure.
- **Aucun second workspace, aucun compte extérieur au workspace** (`docs/SPEC-seed.md` §8) : les
  preuves n° 3 et n° 7 de `docs/SPEC-permissions-rls.md` §7 en exigeront, et `CRM-014` devra soit
  étendre le seed, soit continuer de fabriquer ses propres comptes comme le fait aujourd'hui
  `scripts/verify-authz.sh`.
- **`npm run db:seed` n'existe toujours pas** : il attend le `package.json` de `CRM-007` (INC-008).
  Le seed s'invoque par `supabase/seed/apply-seed.sh`, ou par `resetMe.sh` qui l'appelle.

---

## 2026-08-03 — `CRM-006` : spécification des types générés, écrite après mesure

### Choix de l'unité : pourquoi `CRM-006`

Deux unités sont `[~]` et devraient, selon la règle d'avancement, être terminées avant toute
autre. Elles ont été réexaminées, et non écartées par commodité :

- **`CRM-010`** — sa seule case ouverte est la livraison de `app.can_read_track`,
  `app.can_read_channel`, `app.can_write_channel` et `app.can_read_card`. Ces fonctions doivent
  remonter d'un track, d'un channel ou d'une card jusqu'à son workspace ; `tracks`, `channels` et
  `cards` n'existent pas et relèvent de `CRM-020`, `CRM-021` et `CRM-040`. INC-013 demande de
  surcroît un arbitrage **avant `CRM-012`**. Rien n'est faisable ici sans préempter trois unités.
- **`CRM-011`** — ses cases ouvertes sont un E2E d'interface et des captures d'application. Il
  n'existe aucun écran : la webapp est `CRM-007`, le harnais Playwright `CRM-008`. La limite est
  déjà nommée dans `docs/BACKLOG.md`.

Les trois unités `[ ]` restantes de l'étape 2.b sont bloquées pour les motifs déjà consignés lors
de `CRM-005` : `CRM-012` par INC-011 et INC-013, `CRM-013` par des tables absentes, `CRM-014` par
le harnais Playwright de `CRM-008`. `CRM-006` est donc la première unité réellement exécutable, et
la suivante dans l'ordre de `docs/MASTER_PLAN.md` §2.c. Elle n'enfreint aucune des « contraintes
d'ordre à ne pas enfreindre » du §2, qui ne la mentionnent pas.

### Contexte : pourquoi une spécification pour une commande d'une ligne

La Definition of Done de `CRM-006` tient en une phrase — « `npm run types:generate` régénère depuis
le schéma local ; build de la webapp vert » — et ne dit ni **d'où** viennent les types, ni **où**
ils vont, ni ce qui prouve qu'ils décrivent encore le schéma trois migrations plus tard. Ce sont
précisément les trois questions qui feront la différence entre un type utile et un type qui ment.

Le comportement réel du générateur a donc été mesuré **avant** d'écrire la spécification, comme
pour `CRM-011` et `CRM-005`. Mesures consignées dans `docs/SPEC-types.md` §3 : route, code de
retour, taille de la sortie, déterminisme de deux appels successifs, effet exact du paramètre
`detect_one_to_one_relationships`.

### Décision 36 — Le fichier de types est versionné, pas produit au build

*Décision.* La sortie du générateur est committée dans le dépôt, et une garde prouve qu'elle
correspond au schéma.

*Motif.* Générer au build rendrait `npm run build` dépendant d'un démon Docker et d'une base
migrée, y compris en intégration continue. Il rendrait surtout la dérive **invisible** : le build
produirait toujours des types cohérents avec la base du moment, et personne ne verrait jamais
qu'une migration a changé le contrat que l'interface lit. Versionner déplace la dérive dans le
diff, là où elle se lit.

*Conséquence.* Il faut une garde, sans quoi le fichier committé deviendrait une affirmation
invérifiable : `npm run types:check` régénère et compare octet à octet, sans jamais réécrire.
Cette garde doit elle-même être éprouvée dans les deux sens (`docs/SPEC-types.md` §6).

### Décision 37 — Le générateur est `postgres-meta`, déjà présent, et non la CLI Supabase

*Décision.* La génération appelle le service `meta` de l'overlay de développement
(`supabase/postgres-meta:v0.96.6`) par `docker exec`, sur
`GET /generators/typescript?included_schemas=public&detect_one_to_one_relationships=true`.

*Motif.* C'est le moteur qu'emploie `supabase gen types typescript` : le résultat est le même, sans
introduire de dépendance. La CLI Supabase exigerait le téléchargement d'un binaire hors registre
npm, épinglé nulle part dans le dépôt, pour un service que la pile de développement fait déjà
tourner pour Studio (`CLAUDE.md` §19 : vérifier qu'une dépendance existante ne suffit pas).

*Détail mesuré, et non supposé.* `meta` ne publie aucun port sur l'hôte : il n'est joignable que
depuis le réseau Docker. L'appel passe donc nécessairement par `docker exec` dans `p2enjoy-meta`,
et la commande exige la pile démarrée — prérequis identique à celui des sept harnais existants.

*Écart assumé.* `included_schemas` vaut `public` seul. Le générateur accepte `app` — vérifié — mais
PostgREST n'expose pas ce schéma : l'inclure produirait un type décrivant des appels impossibles.

### Décision 38 — `package.json` naît avec `CRM-006`, réduit à ce que sa Definition of Done nomme

*Décision.* Le premier `package.json` du dépôt est introduit par `CRM-006`, et ne porte que les
commandes que sa DoD exige : `types:generate`, `types:check`, `typecheck`. **Aucun alias `npm` des
scripts existants** n'est ajouté — ni `npm run dev`, ni `npm run stop`, ni `npm run db:seed`.

*Motif.* INC-008 laisse ouvertes deux questions distinctes : quelle unité introduit `package.json`,
et si le projet veut une façade `npm` par-dessus les scripts. La première se tranche d'elle-même —
`CRM-006` est la première unité dont la DoD nomme une commande `npm`, elle ne peut pas être livrée
sans. La seconde reste un arbitrage, et rien ici ne la préempte : ajouter des alias reviendrait à
la trancher en silence.

*Conséquence.* INC-008 reste **ouverte**, avec sa première question désormais réglée par nécessité
et la seconde intacte. `npm run db:seed`, annoncé par `docs/DAT.md` §13, n'existe toujours pas.

---

## 2026-08-03 — `CRM-006` : types générés, garde anti-dérive éprouvée par le schéma

### Ce que l'unité livre, et pourquoi la garde compte plus que le fichier

Le fichier de types est une commodité ; la **garde** est ce qui lui donne sa valeur. Un fichier
généré une fois puis oublié devient une affirmation invérifiable : il décrit un schéma qui a
changé, et le compilateur valide alors des requêtes que la base refusera. C'est exactement le mode
de défaillance que `CRM-006` doit fermer.

`npm run types:check` régénère et compare **octet à octet**, sans jamais réécrire. Un écart est un
échec, pas une correction silencieuse — réécrire effacerait l'information au moment précis où elle
apparaît.

### Décision 39 — TypeScript est épinglé à `5.9.3`, et la question est rouverte à `CRM-007`

*Décision.* `package.json` épingle `typescript` en `5.9.3`, alors que le registre publie `7.0.2`
en `latest` (et `6.0.3` sur la ligne intermédiaire).

*Motif.* `CLAUDE.md` §19 demande de vérifier la compatibilité d'une dépendance avec la stack. Or la
stack de l'interface — Vite, le greffon React, l'analyseur ESLint — n'existe pas encore : elle
arrive avec `CRM-007`. Choisir aujourd'hui la ligne la plus récente reviendrait à parier sur une
compatibilité qu'aucune mesure ne peut établir dans ce dépôt à cette date. `5.9.3` est la dernière
version de la ligne que cet outillage consomme sans réserve.

*Conséquence, et ce que la décision n'est pas.* Ce n'est pas un choix définitif : `CRM-007`
assemble la chaîne complète et rend la question **mesurable**. La limite est inscrite dans
`docs/BACKLOG.md` pour qu'elle ne se perde pas. Rien dans les types livrés ne dépend d'une
nouveauté de TypeScript 6 ou 7 : le passage, s'il est décidé, se réduira à changer la version et à
rejouer `npm run typecheck`.

### Prouver la garde par le schéma, et non seulement par le fichier

Altérer le fichier généré et constater que la garde échoue prouve peu de chose : cela montre qu'un
`cmp` fonctionne. La question qui compte est ailleurs — **le générateur lit-il vraiment la base
vivante**, ou une empreinte, un cache, un artefact ?

`scripts/verify-types.sh` y répond en agissant sur la base : il crée réellement une table dans
`public`, constate qu'elle apparaît **immédiatement** dans la sortie du générateur, constate que la
garde échoue, puis supprime la table et exige que la sortie **redevienne identique** au fichier
versionné. Les trois observations ensemble établissent ce qu'aucune ne dit seule.

Le harnais restaure ensuite tout ce qu'il a touché — table, fichiers, conteneur arrêté — et le
**constate** en sortant : compte des tables de preuve résiduelles à zéro, fichiers comparés à leur
sauvegarde. Un harnais qui laisserait un résidu invaliderait la preuve suivante.

### Figer une limite par une assertion plutôt que par une phrase

Les contraintes `CHECK` ne survivent pas à la génération : `workspace_members.role` se type
`string`. La limite est documentée (`docs/SPEC-types.md` §7), mais une phrase dans un document ne
se rappelle pas au bon moment.

Elle est donc **figée par une assertion de type** qui exige que `role` ne soit *pas* l'union
`'admin' | 'business_developer' | 'viewer'`. L'assertion paraît absurde lue isolément ; son objet
est précis : le jour où le schéma passerait à un type énuméré PostgreSQL, la compilation
échouerait, et la limite devrait être révisée **dans le même changement** au lieu de survivre à sa
cause. Même mécanique pour les deux relations incomplètes de `track_members` et `channel_members`
(INC-010), qui échoueront à `CRM-020` et `CRM-021`.

*Règle qui en découle,* opposable aux unités à venir : une limite connue d'un contrat de types
s'écrit comme une assertion exécutable quand c'est possible, et comme une phrase seulement quand
ça ne l'est pas.

### Ce que cette unité ne prouve pas

- **Le build de la webapp**, qu'exige pourtant sa Definition of Done. Il n'existe rien à builder :
  INC-020, ouverte à cette occasion, nomme la contradiction d'ordonnancement et l'action attendue
  de `CRM-007`. Ce qui la remplace — `tsc --noEmit` en mode `strict` — compile réellement les types
  livrés, mais ne produit aucun bundle et n'exerce aucun plugin Vite. La résolution des modules
  telle que Vite l'appliquera reste non vérifiée.
- **Aucun test E2E, aucune vérification visuelle** : l'unité ne livre ni écran ni parcours. Aucune
  capture n'a été produite, et il aurait été malhonnête d'en fabriquer une.
- **Le prérequis Node du projet n'a pas été exercé** : `.nvmrc` et `README.md` §3 demandent Node 24,
  l'environnement de vérification fournit Node 22.22.2. `package.json` déclare `>=24` — le contrat
  du dépôt — mais toutes les preuves ont été obtenues sur Node 22.

---

## 2026-08-04 — `CRM-007` : spécification du squelette de la webapp, écrite après mesure

### Contexte

Trois unités portent la mention `[~]` — `CRM-010`, `CRM-011`, `CRM-006` — et il a fallu vérifier,
avant de choisir, qu'aucune n'était terminable maintenant. Chacune n'a plus qu'une case ouverte, et
chacune est bloquée par une dépendance nommée, pas par un défaut de réalisation :

- `CRM-010` attend `tracks`, `channels` et `cards` pour ses quatre fonctions `can_*` (INC-013) ;
- `CRM-011` attend un écran pour son E2E de connexion ;
- `CRM-006` attend une webapp pour sa preuve de build (INC-020).

Deux de ces trois blocages tombent avec `CRM-007`, qui est par ailleurs la première unité `[ ]`
dans l'ordre de `docs/MASTER_PLAN.md` §2.c. Le choix ne demandait donc aucun arbitrage.

### Ce qui a été mesuré avant d'écrire

La spécification est écrite après installation et exercice réel de la chaîne, jamais de mémoire.
Sorties retenues :

- `vite@8.2.0` + `@vitejs/plugin-react@6.0.5` + `react@19.2.8` : `vite build` vert, **1 782 modules
  transformés en 219 ms**, `dist/assets/index-*.js` 192 ko, CSS 4,44 ko ;
- `tailwindcss@4.3.3` par `@tailwindcss/vite` : le bloc `@theme` émet les jetons sur `:root,:host`
  — `--color-brand:#23468c` constaté dans le CSS produit — et les utilitaires les **référencent**
  (`.bg-brand{background-color:var(--color-brand)}`, `.rounded-lg{border-radius:var(--radius-lg)}`).
  C'est la mesure qui rend `docs/DESIGN_SYSTEM.md` §11 satisfiable sans fichier de configuration
  JavaScript ;
- `vitest@4.1.10` + `jsdom@30.0.1` + `@testing-library/react@16.3.2` : suite verte sur un cas
  témoin, environnement jsdom monté en 669 ms ;
- `@playwright/test@1.62.1` : le navigateur attendu est le build **chromium 1234**, alors que
  l'environnement en fournissait un 1194 préinstallé. `playwright install chromium` a réellement
  téléchargé le build attendu (114,7 Mio) ; une capture JPEG a été produite contre un
  `vite preview`. La chaîne de preuve visuelle est donc disponible, ce qui n'allait pas de soi ;
- `psql` et PostgREST : sous la clé anonyme, `GET /rest/v1/workspaces` rend bien `200` et `[]` —
  c'est cette mesure qui fonde le §6.3 de la spécification.

### Décision 40 — React 19, et `docs/DAT.md` corrigé plutôt que contourné

`docs/DAT.md` §3.1 annonce « React 18 ». Il a été écrit avant qu'aucun code n'existe. La version
courante est **19.2.8**, et c'est celle sur laquelle `@vitejs/plugin-react@6` et `@types/react@19`
sont alignés. Livrer React 18 serait une régression délibérée, choisie pour faire coïncider le code
avec une phrase.

*Décision : React 19, et `docs/DAT.md` §3.1 corrigé dans le même changement.*

*Motif :* entre un document et la réalité, c'est le document qui se corrige quand la réalité est
meilleure — à condition que la correction soit explicite et datée, ce qu'elle est ici. Le
contraire — écrire du code diminué pour ne pas toucher au document — installerait une dette dont
personne ne retrouverait la cause.

*Conséquence :* aucune contradiction n'est laissée ouverte ; il n'y a donc pas lieu d'ouvrir une
entrée d'incohérence pour ce point.

### Décision 41 — TypeScript reste à `5.9.3`, et la mesure est consignée

La décision 39 demandait de réexaminer l'épinglage **à cette unité**. Le réexamen a eu lieu par la
mesure, pas par l'opinion : `typescript@7.0.2` a été installé et exécuté contre la configuration
de l'application.

Résultat : il compile, **à une condition** — `vite/client` doit figurer dans les types ambiants,
sans quoi il refuse l'import à effet de bord d'une feuille de style (`TS2882`), là où `5.9.3`
l'accepte sans rien dire. Le correctif est d'une ligne, et il est de toute façon souhaitable.

*Décision : conserver `5.9.3` pour cette unité, et documenter que la porte est ouverte.*

*Motif :* toutes les preuves de `CRM-006` reposent sur le compilateur épinglé ; une bascule les
rejouerait toutes sans qu'aucune exigence ne la demande. La migration mérite son propre changement,
avec ses propres preuves, pas d'être embarquée dans une unité d'interface.

*Conséquence :* la limite de `CRM-006` sur TypeScript cesse d'être une inconnue — elle devient une
migration mesurée et différée.

### Décision 42 — Un seul projet npm, Vite pointé sur `webapp/`

Deux dispositions étaient possibles : un `package.json` propre à `webapp/`, ou un projet unique à
la racine avec Vite configuré pour prendre `webapp/` comme racine.

*Décision : projet unique à la racine ; Vite invoqué avec `--config webapp/vite.config.ts`, ce qui
place sa racine dans `webapp/`.*

*Motif :* deux projets npm imposeraient deux installations, deux verrous de dépendances et deux
occasions de dériver, pour aucun gain à cette échelle. Le `package.json` livré par `CRM-006` vit
déjà à la racine et y porte `types:generate`, `types:check` et `typecheck` ; le scinder maintenant
casserait ces commandes sans nécessité.

*Conséquence :* la configuration TypeScript de la racine devait être **restreinte** aux deux
fichiers générés. Elle visait `webapp/src/lib/**/*.ts` ; le client Supabase y serait tombé, compilé
sous une configuration sans types DOM ni `vite/client`, et aurait échoué pour une raison sans
rapport avec lui. `docs/SPEC-types.md` §9 est mis à jour dans le même changement.

### Décision 43 — Aucune bibliothèque d'internationalisation

`docs/DESIGN_SYSTEM.md` §10 exige des clés stables et interdit le texte en dur. Le besoin
d'aujourd'hui est exactement cela : un dictionnaire et une fonction de recherche.

*Décision : un objet TypeScript figé et une fonction `t` dont le type n'accepte que les clés
existantes. Aucune dépendance ajoutée.*

*Motif :* `CLAUDE.md` §19 demande de vérifier qu'une fonction native ou existante ne suffit pas
avant d'ajouter une dépendance. Ici elle suffit, et elle apporte davantage : une clé inconnue **ne
compile pas**, ce qu'aucune bibliothèque de messages ne garantit à la compilation.

*Conséquence :* pluriels, dates et nombres ne sont pas traités. Ils ne se posent pas encore — aucune
donnée réelle ne traverse l'interface — et la limite est nommée dans la spécification plutôt
qu'anticipée par une abstraction sans usage.

### Décision 44 — Le client est créé sans persistance de session

`supabase-js` persiste par défaut la session dans `localStorage` et la rafraîchit seule. L'unité ne
livre aucun parcours de connexion : aucune session ne devrait donc exister, et rien ne devrait être
écrit sur l'appareil.

*Décision : `persistSession: false` et `autoRefreshToken: false`, et un contrôle E2E qui exige un
`localStorage` vide après un parcours complet.*

*Motif :* `CLAUDE.md` §11 borne le stockage sur l'appareil à ce qui est strictement nécessaire.
Laisser le défaut de la bibliothèque installerait une écriture persistante par inadvertance, sans
consentement et sans usage — exactement ce que la règle interdit.

*Conséquence :* l'arbitrage de la persistance de session revient à l'unité qui livrera la
connexion, avec la question du consentement posée à ce moment-là, et non tranchée en silence
aujourd'hui.

### Ce que cette spécification ne tranche pas

- **L'écran de connexion**, que la Definition of Done de `CRM-011` présuppose et qu'aucune unité ne
  porte. Consigné en **INC-021**, sans résolution implicite : cette unité ne l'invente pas.
- **Le rendu populé de la coquille.** Sans tracks ni channels, la barre latérale et les onglets
  n'affichent que leurs états vides. C'est l'état réel du produit ; le peupler avec des données
  fabriquées donnerait des captures flatteuses et fausses.

---

## 2026-08-04 — `CRM-007` : squelette de la webapp, défauts trouvés par l'observation

### Décision 45 — `skipLibCheck` relâché pour l'application, et pour elle seule

`@supabase/storage-js` et `@supabase/phoenix` déclarent `Buffer` et le namespace `NodeJS` dans
leurs propres fichiers de types. Avec `skipLibCheck: false` — le réglage que `CRM-006` avait posé
alors qu'aucune dépendance n'existait —, la compilation échoue sur des fichiers que ce dépôt
n'écrit pas et ne peut pas corriger.

Deux issues : ajouter `node` aux types ambiants de l'application, ou relâcher la vérification des
déclarations tierces.

*Décision : `skipLibCheck: true` sur `webapp/tsconfig.json`, et sur lui seul.*

*Motif :* la première issue ferait entrer `process` et `Buffer` dans du code qui s'exécute dans un
navigateur. Le compilateur cesserait d'y voir une erreur, et le défaut ne se manifesterait qu'à
l'exécution, chez l'utilisateur. Entre relâcher la vérification des déclarations d'un tiers et
relâcher celle du code qu'on écrit, c'est la première qui coûte le moins.

*Conséquence :* le projet racine, celui des tests et celui de l'outillage conservent
`skipLibCheck: false`. Les tests ont d'ailleurs leur propre configuration, précisément pour que
`node:fs` leur soit permis et reste interdit à l'application.

### Décision 46 — L'échelle d'espacement comprend le zéro, et une garde le prouve

Les espaces de noms de Tailwind sont remis à zéro dans `tokens.css` : sans cela, `bg-red-500` et
`p-7` restent écrivables, et le design system n'est qu'une recommandation. C'était le but.

Le corollaire ne l'était pas : **une classe dont le jeton n'est pas déclaré n'est pas engendrée du
tout, et en silence**. `--spacing-0` n'existant pas, `min-w-0` a disparu — et avec elle la garde
qui empêche une colonne de flex d'imposer sa largeur minimale. Constat : la page **défilait
horizontalement** sous 768 px, contre `docs/DESIGN_SYSTEM.md` §7. Rien ne l'avait signalé : ni le
build, ni la compilation, ni les tests unitaires.

*Décision : ajouter `--spacing-0`, et surtout ajouter une garde — `scripts/lib/classes-css.mjs`
vérifie que **chaque classe citée par un composant existe dans le CSS produit**.*

*Motif :* le défaut n'est pas la classe manquante, c'est le **silence**. Une remise à zéro des
espaces de noms transforme toute faute de frappe et tout jeton oublié en règle absente sans
message. Une garde qui rend ce silence bruyant vaut mieux qu'une vigilance qu'il faudrait
maintenir à chaque revue.

*Vérification :* la garde échoue bien sur un `px-7` introduit volontairement, et le harnais en fait
l'un de ses contrôles de non-complaisance.

### Décision 47 — Le comportement réel de la bibliothèque est documenté, pas contourné

`postgrest-js` réessaie **trois fois** une lecture en échec, avec 1 s, 2 s puis 4 s d'attente.
Mesuré en abandonnant réellement la requête au niveau du réseau : l'état d'erreur n'apparaît
qu'après environ sept secondes.

Un premier scénario E2E a échoué pour cette raison, et la tentation était d'écourter l'attente en
désactivant les reprises.

*Décision : conserver les reprises, et régler les preuves sur le comportement réel.*

*Motif :* trois reprises espacées sont exactement ce qu'il faut face à une coupure brève, et
l'utilisateur voit pendant ce temps des squelettes, pas un écran figé. Désactiver un mécanisme utile
pour faire passer un test plus vite reviendrait à ajuster le produit à la commodité de sa preuve.
Le délai est en revanche **nommé** — dans la spécification, dans le manuel, et dans le commentaire
du scénario — parce qu'un utilisateur qui attend sept secondes mérite qu'on ait su pourquoi.

### Deux défauts que seules les captures ont révélés

`CLAUDE.md` §16 pose que les tests automatisés ne remplacent pas l'observation visuelle. Deux
défauts en donnent la démonstration : build vert, 96 tests unitaires verts, 13 scénarios E2E verts,
et pourtant :

1. **À 390 px, le titre de la route disparaissait.** Le contexte d'espace de travail, marqué
   `shrink-0`, écrasait un titre marqué `truncate`. L'écran affichait « ☰ P2Enjoy CRM / Aucun
   workspace accessible » — et rien qui dise sur quelle page on se trouvait. Aucune assertion ne
   l'aurait vu : le titre était bien dans le document, avec une largeur nulle.
   *Règle qui en découle,* écrite dans `docs/DESIGN_SYSTEM.md` §12.2 : sous les petits paliers,
   l'en-tête sacrifie d'abord ce qui est porté ailleurs, jamais ce qui ne se déduit de rien.

2. **Repliée, la barre latérale rognait sa propre bascule.** À 64 px de large, la marque et le
   bouton ne tenaient plus côte à côte, et c'est le bouton qui sortait. Le repli devenait
   **irréversible** : aucun moyen de revenir, sinon de vider le stockage de session. Là encore,
   les tests étaient verts — le bouton existait, il était simplement hors de la vue.

Les deux sont désormais gardés par des assertions E2E qui exigent, l'une que le titre reste visible
à chacun des quatre paliers, l'autre que la bascule soit **entièrement** dans la fenêtre et déplie
réellement la barre.

*Ce qu'il faut en retenir,* opposable aux unités d'interface à venir : une capture n'est pas une
formalité de fin de tâche. Ces deux défauts n'ont pas été trouvés en relisant du code, mais en
regardant deux images.

### Ce que cette unité ne prouve pas

- **Le rechargement à chaud** de Vite : le conteneur sert bien l'application, ce qu'une capture
  atteste, mais aucune preuve automatique n'exerce le HMR.
- **Les contrastes**, vérifiés par lecture des jetons et observation, non par un outil.
- **Firefox et WebKit** : les preuves E2E s'exécutent sur Chromium seul.
- **Node 24 sur l'hôte** : il n'est exercé que dans le conteneur `webapp`, où build, tests et
  compilation ont été rejoués verts. Les preuves E2E, elles, tournent sous Node 22.22.2.

---

## 2026-08-04 — Deux exécutions concurrentes ont livré `CRM-007` en double

### Le constat, et pourquoi il compte

Deux exécutions de la routine d'avancement du backlog ont tourné **en parallèle** et ont toutes
deux implémenté `CRM-007` **intégralement et indépendamment** : deux arborescences `webapp/src`
complètes, deux jeux de tests, deux harnais `scripts/verify-webapp.sh`, deux séries de captures.

La seconde s'était pourtant resynchronisée avant de commencer : à cet instant, `origin/main` était
encore sur `5ad19b3`, la spécification. Le commit de la première est arrivé pendant le travail.
Se resynchroniser au démarrage ne protège donc de rien : la fenêtre de collision est la durée
entière d'une unité, pas l'instant du `git pull`.

Le rebase a produit des conflits sur **tous** les fichiers de l'unité — des implémentations
divergentes des mêmes composants, non fusionnables ligne à ligne.

### Ce qui a été retenu, et pourquoi

**La livraison conservée est celle de la première exécution**, déjà poussée. Elle est strictement
mieux prouvée : son environnement disposait de Docker, elle a donc obtenu **la preuve
d'intégration hors interface** que l'autre ne pouvait pas produire — la requête de la coquille
rejouée contre PostgREST, avec la clé anonyme **et** avec le jeton réel d'un compte seedé, alors
que la base contient bien une ligne. C'est la seule preuve qui établit que l'écran vide est le
refus par défaut du backend et non un défaut d'interface. Elle a aussi construit et démarré le
service `webapp` conteneurisé, et exercé le prérequis Node 24 du dépôt.

Le doublon a été **abandonné sans être poussé**. Écraser un travail déjà publié est interdit
(`CLAUDE.md` §13), et fusionner deux architectures divergentes du même écran aurait produit un
troisième code que personne n'aurait conçu.

### Vérification indépendante de la livraison conservée

Les affirmations de `CRM-007` ont été rejouées depuis un `node_modules` reconstruit par
`npm ci` :

- `npm run typecheck` — **vert** sur les quatre projets TypeScript ;
- `npm run test:unit` — **96 tests, 5 fichiers, tous verts** ;
- `npm run build` — **vert**, `webapp/dist` produit.

`npm run e2e:ui` n'a pas pu être rejoué : sa configuration exige un `.env`, donc la pile démarrée,
donc Docker — absent de cet environnement. Ce n'est pas un défaut : c'est le choix, défendable, de
faire porter les preuves E2E par la pile réelle. La suite reste donc **vérifiée par l'exécution
qui l'a livrée, non revérifiée ici**.

### Ce que ce constat appelle

Le coût est une exécution entière perdue, et le risque est plus grave que le gaspillage : deux
implémentations concurrentes d'une même unité peuvent se fondre en un état incohérent si le
conflit est résolu à la hâte. **La routine devrait être sérialisée** — une seule exécution à la
fois — ou prendre un verrou sur l'unité qu'elle ouvre. La décision revient au responsable ; elle
n'est pas prise ici, elle est signalée.

---

## 2026-08-04 — `CRM-008` : spécification du harnais de tests, écrite après mesure

### Décision 48 — Le code de sortie de `psql` ne peut pas servir de verdict à une suite pgTAP

**Problème.** `npm run test:sql` doit rendre un verdict sur les suites pgTAP de `supabase/tests/`.
La voie évidente — lancer `psql` et lire son code de sortie — n'a pas été supposée valide : elle a
été mesurée.

**Mesures**, le 2026-08-04, contre le conteneur `p2enjoy-db` de la pile de développement :

| Situation | Sortie TAP | Code de sortie |
|---|---|---|
| Suite verte (`0003_seed_socle.test.sql`) | `ok 1…30` | `0` |
| Une assertion fausse | `not ok 2` + `# Looks like you failed 1 test of 2` | **`0`** |
| Plan `5`, une seule assertion exécutée | `# Looks like you planned 5 tests but ran 1` | **`0`** |
| Plan `1`, `finish()` **jamais appelé** | `ok 1`, **aucun diagnostic** | **`0`** |
| Erreur SQL, `ON_ERROR_STOP=1` | message d'erreur | `3` |

**Observations.** Les trois premières lignes suffisaient à écarter le code de sortie. C'est la
quatrième qui a changé la conception : **sans `finish()`, pgTAP n'émet aucun diagnostic de plan**.
Une suite tronquée — fichier coupé, erreur avalée, `finish()` oublié à la relecture — passerait
donc pour complète, y compris pour un harnais qui lirait consciencieusement les lignes `#` de
pgTAP.

**Décision.** L'exécuteur ne fait confiance ni au code de sortie de `psql`, ni au diagnostic de
pgTAP. Il compare **lui-même** l'en-tête de plan `1..N` au nombre de lignes `ok` et `not ok`
réellement émises, et exige en outre qu'un plan ait été émis. `ON_ERROR_STOP=1` reste obligatoire.

**Conséquences.** Quatre conditions d'échec indépendantes plutôt qu'une (`docs/SPEC-test-harness.md`
§3.2), et quatre contrôles de non-complaisance qui les éprouvent une par une. Le coût est un
exécuteur plus verbeux que le `psql … && echo ok` qu'on écrirait spontanément ; le bénéfice est
qu'aucun des quatre modes de défaillance mesurés ne peut passer pour un succès.

### Décision 49 — Le besoin de `webServer` est déclaré, faute de pouvoir être déduit

**Problème.** Le projet Playwright `api` parle directement à Kong : il n'a aucun besoin de
l'application construite et servie. Le projet `ui` en a besoin. La configuration doit donc savoir
lequel est demandé.

**Mesures.** Deux comportements de `@playwright/test@1.62.1` ont été constatés, non supposés :

1. Un serveur factice écrivant un marqueur à son démarrage est lancé pour **toute** exécution —
   `--project=api`, `--project=ui`, ou sans filtre. Playwright ne conditionne pas le `webServer`
   au périmètre réellement sélectionné.
2. La configuration est **réévaluée dans chaque processus worker**, où `process.argv` vaut
   exactement `["…/node", "…/workerProcessEntry.js"]`. Le filtre `--project` **n'y est pas
   visible**.

**Solutions envisagées.** Déduire le besoin de `process.argv` — écartée par la mesure 2 : elle
serait juste dans le processus principal et fausse dans les workers. Éclater en trois fichiers de
configuration — écartée : les trois projets partagent la même amorce d'environnement, le même
`.env` et le même rapport ; les séparer triplerait cette amorce sans rien isoler d'utile.

**Décision.** Le besoin est **déclaré** par une variable d'environnement `E2E_PROJETS`, positionnée
par le script npm qui lance l'exécution. Absente, elle vaut « tous les projets », donc `webServer`
déclaré : le défaut est le comportement sûr, et une invocation directe de `playwright test`
continue de fonctionner.

**Conséquences.** Une cohérence à tenir entre `E2E_PROJETS` et `--project`, que rien ne peut
vérifier depuis la configuration. L'incohérence n'est pas silencieuse pour autant : elle démarre un
serveur inutile, ou l'omet — auquel cas les scénarios `ui` échouent bruyamment sur une connexion
refusée. La limite est nommée dans `docs/SPEC-test-harness.md` §10.

### Décision 50 — « Zéro ligne » ne se prouve que sur une table qui contient des lignes

**Problème.** La preuve n° 11 de `docs/SPEC-permissions-rls.md` §7 — « utilisateur anonyme lit
n'importe quelle table métier → aucune ligne » — est le refus par défaut aujourd'hui en vigueur. Le
projet `api` doit l'établir.

**Observation.** Mesuré sur la pile seedée : `profiles` contient 3 lignes, `workspaces` 1,
`workspace_members` 3, vues par la clé de service. En revanche `track_members` et `channel_members`
en contiennent **zéro** — leurs tables cibles n'existent pas avant `CRM-020` et `CRM-021`.

**Décision.** Le scénario constate d'abord, avec la clé de service, que les lignes existent, puis
qu'aucun appelant ne les voit. Les deux tables réellement vides sont **exclues** de la preuve.

**Motif.** Sur une table vide, « l'API rend `[]` » est vrai que la RLS refuse ou qu'elle autorise
tout : l'assertion serait verte dans les deux cas, donc sans valeur probante. C'est le même
raisonnement que le contrôle décisif de `scripts/verify-webapp.sh`, qui compare l'état de l'API à
celui de la base au lieu de se contenter du premier.

### Décision 51 — Les assertions qui décrivent une limite doivent échouer quand la limite tombe

**Problème.** Les scénarios A5 et A6 du projet `api` décrivent un produit **sans politiques RLS** :
un membre du workspace ne voit rien, et son écriture est refusée. `CRM-012` changera cela.

**Décision.** Ces assertions sont écrites telles quelles, et leur échec futur est **annoncé à
l'endroit même de l'assertion**. Le jour où `CRM-012` livrera les politiques, `npm run e2e:api`
deviendra rouge, et il faudra réviser le scénario.

**Motif.** C'est la convention déjà retenue par `CRM-006` pour les types générés : une limite figée
par une assertion force sa révision, alors qu'une limite seulement commentée survit tranquillement
à la cause qui la justifiait. Un harnais qui resterait vert au passage de `CRM-012` prouverait
seulement qu'il ne mesure rien.

### Ce que cette spécification ne tranche pas

`pytest mail-sync/tests` et `npm run e2e:mail` n'ont aucun sujet à exercer avant le chunk 4. La
contradiction entre la Definition of Done de `CRM-008` et l'ordre d'exécution de
`docs/MASTER_PLAN.md` §2 est consignée en **INC-023**, avec trois options d'arbitrage. Elle n'est
pas résolue ici : `CRM-008` restera `[~]`.

---

## 2026-08-04 — `CRM-008` : harnais livré, et ce qu'il attrape réellement

### Ce qui a été livré

- `scripts/run-sql-tests.sh` et `npm run test:sql` — trois suites, **227 assertions**, verdict
  calculé selon les quatre conditions de la décision 48.
- Projet Playwright `api`, `npm run e2e:api` — **13 scénarios**, hors interface, sans navigateur.
- `e2e/api/jetons.ts` — fixtures de jetons réels, livrable durable repris par `CRM-014`.
- `e2e/env.ts` — amorce d'environnement extraite de `playwright.config.ts`, un fichier de
  scénarios ne pouvant importer la configuration sans dépendance circulaire.
- `npm run e2e:report` — rapporteur `html`, sortie dans `e2e/report/`, ignorée par git.
- `scripts/verify-harness.sh` — **22 contrôles**, dont six dégradations réelles.

### Ce que la non-complaisance a réellement montré

Le contrôle décisif n'est pas le nombre de scénarios verts, mais ce qui se passe quand on ouvre
une brèche. Une politique RLS permissive posée **sur la seule table `workspaces`** fait échouer
`npm run e2e:api` — et l'observation du rapport HTML montre qu'**un seul** scénario devient rouge :
A4 sur `workspaces`. Les deux autres tables du même scénario restent vertes.

C'est la propriété qu'on attendait sans pouvoir l'affirmer d'avance : le harnais ne signale pas
« quelque chose a changé », il désigne **ce qui** a changé. Un harnais qui aurait viré au rouge
en bloc aurait été aussi peu utile qu'un harnais resté vert.

Les deux captures — `docs/captures/CRM-008/rapport-api-vert-1440.jpg` et
`rapport-api-rouge-1440.jpg` — sont conservées pour cette raison : elles montrent la différence,
pas seulement le succès.

### Ce que cette unité ne prouve pas

- **`pytest` et `e2e:mail` ne sont pas livrés.** Leurs sujets arrivent au chunk 4 (INC-023).
  L'unité reste `[~]` pour cette seule raison.
- **Onze des douze preuves de refus restent dues** par `CRM-014`. Ce qui est livré ici est le
  moyen de les écrire, pas les preuves elles-mêmes.
- **La lecture du TAP reste dupliquée** entre l'exécuteur et trois `scripts/verify-*.sh`. Unifier
  reviendrait à toucher les preuves de trois autres unités dans ce commit.

### Limites de l'environnement de vérification, nommées et non masquées

Deux obstacles ont dû être levés **hors du dépôt**, et aucun correctif n'a été versionné pour eux :

1. **L'image du service `webapp` ne se construit pas derrière le proxy de la routine** : celui-ci
   interpose son propre certificat et `npm ci` refuse la chaîne (`SELF_SIGNED_CERT_IN_CHAIN`). Le
   `webapp/Dockerfile` prévoyait déjà le secret facultatif `npm_ca` pour ce cas ; l'image a été
   construite à la main en le fournissant, puis la pile démarrée par `./runDev.sh --dev`. Le
   dépôt est correct : c'est `docker compose` qui ne transmet pas de secret de build. Question
   ouverte, à examiner si le cas se reproduit — hors périmètre de `CRM-008`.
2. **Le Chromium préinstallé de l'environnement ne correspond pas à la version qu'exige
   `@playwright/test@1.62.1`** (build 1194 contre 1234 attendu). Le navigateur attendu a été
   installé avant de rejouer `npm run e2e:ui`. Sans cela, les 13 scénarios de `CRM-007` auraient
   échoué pour une raison sans rapport avec le produit.

Ces deux points sont des propriétés de l'hôte de vérification, pas du projet. Ils sont consignés
pour qu'une exécution future ne les rediagnostique pas depuis zéro.

---

## 2026-08-04 — `CRM-020` : spécification des tracks, écrite après mesure

`docs/MASTER_PLAN.md` §1 règle 2 : « la documentation précède le code ». Aucun document ne disait
comment un track s'ordonne, ce qu'archiver veut dire pour lui, ni ce que l'API doit rendre à
chacun des trois rôles. `docs/SPEC-tracks.md` est écrite avant la migration, et **après mesure**.

### Choix de l'unité — pourquoi `CRM-020` et non `CRM-012`

L'ordre de `docs/MASTER_PLAN.md` §2 place `CRM-012`, `CRM-013` et `CRM-014` avant `CRM-020`. Les
trois ont été examinées et écartées, non par confort mais par impossibilité :

| Unité | Ce qu'elle exige | Pourquoi elle ne peut pas commencer |
|---|---|---|
| `CRM-012` | politiques des droits fins par track et channel | ni `tracks` ni `channels` n'existent ; et INC-013 demande un arbitrage **avant** cette unité |
| `CRM-013` | colonnes protégées de `cards`, `mail_*`, `api_tokens`, `audit_log` | aucune de ces tables n'existe (chunks 3 et 4) |
| `CRM-014` | les douze scénarios de refus | ils portent sur des cards, des channels et des comptes mail |

`CRM-020` est donc la première unité réellement commençable, et elle lève la dépendance de trois
d'entre elles. Les trois unités `[~]` déjà au dépôt — `CRM-008`, `CRM-010`, `CRM-011` — ont été
relues avant de choisir : leurs points ouverts restent bloqués par un arbitrage ou par une table
absente, sans rien d'actionnable.

### Décision 52 — La spécification est écrite après une sonde jetable, pas de mémoire

Les unités précédentes ont mesuré des **outils** avant de les spécifier. Ici, ce qu'il fallait
mesurer était le comportement de PostgreSQL et de PostgREST sous les politiques envisagées — donc
quelque chose qui n'existait pas encore.

Conduite retenue : une table sonde `public.zz_probe`, portant exactement la structure, les
triggers, les politiques et les privilèges envisagés, a été créée sur la pile de développement,
interrogée avec les jetons réels des trois comptes seedés, puis **détruite** avant la rédaction.
L'absence de reste a été constatée (`0` relation `zz_%`, `1` workspace).

Douze mesures en sont sorties, reportées telles quelles dans `docs/SPEC-tracks.md` §6. Trois ont
changé la conception :

1. **Un trigger `BEFORE INSERT` renseigne une colonne `NOT NULL` avant la vérification de la
   contrainte.** Mesuré : deux insertions sans `position` rendent `1` puis `2`. `position` peut
   donc rester `NOT NULL` sans défaut de colonne — un client ne peut pas y écrire `NULL`, et
   l'omettre reste licite. Sans cette mesure, la colonne aurait été rendue nullable « au cas où »,
   ce qui aurait autorisé des tracks sans ordre.
2. **`WITH CHECK` sur l'`UPDATE` n'est pas une redondance.** Un administrateur du workspace A
   déplaçant son track vers le workspace B est refusé — `403`, `42501` — par le seul `WITH CHECK` ;
   le `USING` seul l'aurait laissé passer, puisque la ligne *avant* modification lui appartient.
3. **La suppression physique n'est pas exposée.** `DELETE` n'est accordé à personne : le refus
   mesuré (`403`, `permission denied for table`) est cohérent avec la convention de suppression
   douce de `docs/SCHEMA.md`. Ce refus a fait apparaître INC-026.

Motif de cette conduite : mesurer d'abord évite d'écrire une spécification qui décrit le
comportement espéré. Le coût est une sonde à détruire ; le bénéfice est que les douze lignes du §6
sont des observations, pas des prévisions.

### Décision 53 — Le défaut de `color` est `neutral`, pas `brand`

`docs/DESIGN_SYSTEM.md` §1 réserve le bleu primaire aux actions primaires, aux liens et au **track
actif**. Un track qui n'a pas choisi sa couleur ne doit pas revendiquer celle de l'état actif :
l'écran deviendrait illisible dès que plusieurs tracks coexisteraient, tous bleus, dont un
prétendument actif. Le défaut est donc `neutral`.

Conséquence sur les jetons : le design system ne déclare pas de « neutre doux ». La pilule
`neutral` emploie les neutres existants — `--color-hover` en fond, `--color-text-2` en texte —
plutôt qu'un jeton nouveau créé pour l'occasion.

### Décision 54 — La contrainte sur `icon` porte sur la forme, pas sur l'existence

Une contrainte `CHECK` énumérant les icônes de Lucide serait fausse au premier `npm update`, sans
qu'aucune migration ne le signale : la base affirmerait une vérité que le paquet aurait cessé de
tenir. La contrainte se limite donc à la forme (kebab-case), et l'existence est traitée dans
l'interface par un catalogue explicite et un repli documenté vers `Folder`.

C'est la même règle que `docs/SPEC-types.md` applique aux types : ce qui n'est pas vérifiable là où
il est écrit ne doit pas y être affirmé.

### Décision 55 — La clé étrangère différée par INC-010 est rétablie ici, et son risque est nommé

`CRM-003` avait dû créer `track_members` sans clé étrangère, `tracks` n'existant pas. `CRM-020` la
pose. Le point délicat n'est pas la contrainte mais son **application** : si une ligne orpheline
existait, l'ajout échouerait et, le `migrations-runner` étant une dépendance de démarrage de
PostgREST, **la pile ne démarrerait plus**.

Le fait est écrit dans la migration et porté dans `docs/PROD_MIGRATIONS.md` comme point de
vérification préalable, plutôt que masqué par un `not valid` qui rendrait la contrainte décorative.

### Ce que cette spécification ne résout pas

- **INC-013 reste ouverte.** Aucune des quatre fonctions `can_*` n'est écrite. La politique de
  lecture s'arrête au rôle de workspace, et l'écart est figé par une assertion pgTAP — INC-024.
- **INC-021 reste ouverte, et devient l'obstacle principal du projet.** Sans écran de connexion, la
  webapp est un appelant anonyme : elle ne verra aucun track, quelles que soient les politiques
  livrées. Toute unité d'interface du chunk 3 rencontrera cet obstacle, pas seulement celle-ci.

---

## 2026-08-04 — `CRM-020` : tracks livrés, et deux affirmations démenties par la mesure

L'unité livre `public.tracks`, ses politiques, son seed et la section « Tracks » de la barre
latérale. Ce qui suit ne retient que ce qu'une mesure a **corrigé**, et ce que l'observation a
trouvé — le reste est dans `docs/SPEC-tracks.md` et dans les preuves.

### Décision 56 — Deux affirmations de la spécification étaient fausses, et ce sont elles qui ont cédé

La spécification est écrite avant le code ; elle n'est pas pour autant à l'abri. Deux de ses
affirmations ont été **démenties par la première exécution de la suite pgTAP**, et c'est la
spécification qui a été corrigée, jamais l'assertion ajustée pour retomber sur ses pieds.

1. **« La colonne `NOT NULL` interdit à un client d'écrire `NULL` explicitement. »** Faux. Un
   trigger `BEFORE INSERT` reçoit `new.position` à `NULL` que le client ait omis la colonne ou
   qu'il y ait écrit `null` : il ne peut pas distinguer les deux, et remplace dans les deux cas.
   La protection existe bien, mais elle ne couvre que les **mises à jour**, que le trigger ne voit
   pas. `docs/SPEC-tracks.md` §3 porte désormais les deux cas, et deux assertions distinctes les
   tiennent.
2. **« `updated_at` est avancée par la modification. »** Invérifiable telle quelle : `now()` rend
   l'heure de **transaction**, constante dans toute la suite, et une comparaison `>=` aurait été
   vraie sans rien prouver. Ce qui se prouve à l'intérieur d'une transaction, c'est que le trigger
   **écrase** la valeur écrite par le client — l'assertion écrit `2000-01-01` et constate qu'elle
   ne survit pas.

Motif retenu : une assertion qu'on affaiblit pour qu'elle passe cesse d'être une preuve. Quand la
mesure et le document divergent, c'est le document qui a tort.

### Décision 57 — Les contraintes de valeur sont convergentes, parce qu'un rejeu doit réparer

Défaut réel, trouvé par le **contrôle de restauration** de `scripts/verify-tracks.sh`, et non par
raisonnement : après avoir retiré `tracks_color_check` pour éprouver la non-complaisance du
harnais, la réapplication de la migration ne la remettait pas. `create table if not exists` saute
la table entière dès qu'elle existe — la migration était idempotente sans être **réparatrice**, et
la base restait durablement affaiblie.

Les contraintes de valeur sont donc sorties du `create table` et posées par `drop constraint if
exists` puis `add constraint` : la définition du fichier fait autorité à chaque passage. Le prix
est une revalidation de la table à chaque démarrage de la pile ; sur `tracks`, il est négligeable.
La propriété achetée vaut mieux : **le schéma converge vers ce que le dépôt déclare**, au lieu de
converger seulement sur une base neuve. Le point est porté dans `docs/PROD_MIGRATIONS.md` §3.

Sans le contrôle de restauration, ce défaut serait passé : les preuves étaient vertes avant la
dégradation, et vertes après. C'est l'écart entre les deux qui l'a montré.

### Décision 58 — Deux chargements, et aucun échec avalé

La coquille lit désormais deux sources : `workspaces` pour l'en-tête, `tracks` pour la barre
latérale. La barre latérale n'a pas la place d'expliquer une erreur — c'était déjà le choix de
`CRM-007`, et il tient. Mais si la zone principale ne regardait que les workspaces, un échec du
chargement des tracks produirait un écran **vide et silencieux**, c'est-à-dire la valeur par défaut
trompeuse que `CLAUDE.md` §18 interdit.

`ZonePrincipale` reçoit donc la liste des états et présente le premier échec, un refus l'emportant
sur une panne — le refus est définitif, la panne se retente, et proposer « Réessayer » à qui n'a
pas les droits serait une fausse promesse. La reprise relance **tous** les chargements.

### Défauts trouvés en regardant les captures, et non les tests

Deux problèmes ont été trouvés par l'observation, alors que toutes les preuves étaient vertes.

1. **L'écran se contredisait.** Avec trois tracks dans la barre latérale, la zone principale
   affichait toujours « Un board s'ouvre depuis un track. Aucun track n'est accessible pour le
   moment. » Le texte datait de `CRM-007`, où il était vrai. Il affirme désormais ce qui manque
   réellement pour ouvrir un board : un **channel**.
2. **Le fond de la pilule `accent`.** Le jaune du design system sur son propre fond doux n'atteint
   pas le contraste AA ; la pilule porte donc son texte en encre. L'écart est inscrit dans
   `docs/DESIGN_SYSTEM.md` §5.5 bis plutôt que laissé à la lecture du code.

Aucun des deux n'aurait été trouvé par une suite de tests : le premier est une incohérence entre
deux zones qu'aucune assertion ne rapprochait, le second une question de perception.

### Ce que cette unité ne prouve pas

- **Aucun track n'apparaît dans l'interface**, et aucune ne le pourra avant qu'un écran de
  connexion existe (INC-021). Le rendu chargé est éprouvé par test unitaire du composant réel et
  par substitution de la réponse réseau ; ni l'un ni l'autre n'est une session.
- **Aucune interface d'administration des tracks** : créer, renommer, réordonner et archiver se
  font par l'API, ce qui est une opération d'exploitation. Le CRUD est prouvé, le parcours produit
  ne l'est pas.
- **Les droits fins ne sont pas appliqués** (INC-024). Un `track_members.access = 'none'` ne masque
  rien encore, et une assertion le constate pour forcer sa révision à `CRM-012`.

### INC-021 n'est plus une gêne locale, c'est l'obstacle du chunk 3

Le fait mérite d'être écrit ici, parce qu'il déborde `CRM-020` : le produit sait maintenant servir
de la donnée métier à un membre du workspace — mesuré, avec des jetons réels — et l'interface n'en
voit rien. Toutes les unités d'interface qui suivent (`CRM-021`, `CRM-041`, `CRM-042`, …) buteront
sur le même obstacle et livreront, au mieux, des captures vides.

L'arbitrage d'INC-021 conditionne donc la valeur démontrable de tout le chunk 3, et non la seule
Definition of Done de `CRM-011`.

---

## 2026-08-04 — `CRM-020` : le contraste des pilules était déclaré, non mesuré

Entrée écrite après la livraison de `CRM-020`, sur un défaut trouvé en cherchant à **prouver** ce
que sa Definition of Done affirmait déjà.

### Le défaut

`docs/DESIGN_SYSTEM.md` §8 exige un contraste AA de 4,5:1 « y compris pour les badges colorés ».
Aucune preuve du dépôt ne calculait un contraste. La conformité était donc **déclarée**.

Mesurés sur le rendu réel, les cinq jetons de couleur de donnée avec « texte à la couleur pleine »
(§5.6) donnaient :

```
brand    7,64  conforme
success  3,82  ÉCHEC   ← rendu par le track « studio-web » du seed
accent   1,45  ÉCHEC   ← déjà corrigé, parce qu'illisible
danger   3,29  ÉCHEC   ← aucun track du seed ne l'emploie
neutral  6,87  conforme
```

`accent` avait été vu et corrigé : à 1,45:1 il saute aux yeux sur une capture. `success` et `danger`
ont survécu **parce qu'ils sont lisibles sans être conformes**. Il n'y avait rien à voir ; il y
avait quelque chose à mesurer.

### Ce que cela dit du procédé, au-delà de ce défaut

Trois preuves existaient sur ces classes et étaient toutes vertes : « les classes ne sont pas
vides », « elles ne contiennent aucun hexadécimal », « chaque jeton a un fond et un texte
distincts ». Aucune ne portait la **valeur attendue**, seulement des propriétés générales. Une
propriété générale est peu coûteuse à écrire et rassurante à lire — et c'est exactement pour cela
qu'elle laisse passer une valeur fausse.

Deux conclusions, consignées parce qu'elles dépassent cette unité :

1. **Une exigence chiffrée qu'aucune preuve ne calcule n'est pas une exigence, c'est une
   intention.** Les seuils du §8 s'appliquent partout ; ils ne sont mesurés que sur les pilules de
   track.
2. **Un jeton que rien ne rend n'est jamais mesuré.** `danger` n'apparaît dans aucun track du seed.
   Le scénario de contraste sert donc désormais **cinq** couleurs, dont deux absentes du seed, au
   lieu des trois qu'il affichait.

### La correction, et pourquoi une règle unique plutôt qu'un cas particulier

Quatre jetons `--color-*-on-soft` : le jeton conservant sa teinte, assombri juste assez pour tenir
les 4,5:1 — 7,64 / 4,85 / 4,72 / 4,67. Valeurs **calculées** à partir du jeton plein, comme les
fonds doux ; `tokens.css` reste le seul fichier du dépôt à contenir une couleur.

`accent` repasse de `text-ink` à `text-accent-on-soft`. Le repli sur l'encre était conforme, mais il
faisait de lui une **exception** dans un tableau de correspondances qui devra s'étendre aux badges,
aux liserés de card et aux compteurs de colonne. Une règle unique se propage ; une exception se
recopie mal.

### Le piège de mesure, qui a failli produire une preuve fausse

La première version du scénario lisait `getComputedStyle().color` et en extrayait trois nombres.
Chromium rend les `color-mix` avec des canaux de **0 à 1** (`color(srgb 0.91 …)`) et les couleurs
littérales en **octets** (`rgb(35, 70, 140)`). Lire les deux avec la même règle donnait 2,31:1 là où
le contraste vaut 7,64:1.

Ici, l'erreur produisait un faux **rouge**, donc visible. Elle aurait tout aussi bien pu produire un
faux vert — c'est-à-dire une preuve de conformité rassurante et sans objet, exactement le défaut
qu'on cherchait à corriger. La conversion est donc confiée au navigateur : la couleur est
**réellement peinte** sur un canevas d'un pixel, et les octets sont relus.

### Deux exécutions concurrentes de la même routine

Cette correction a été écrite après avoir constaté que `CRM-020` venait d'être livrée par une autre
exécution de la routine, pendant que la présente travaillait sur la même unité — les deux ayant
démarré du même commit. Le travail parallèle a été **abandonné** plutôt que substitué : `CLAUDE.md`
§13 interdit d'écraser les modifications d'un autre contributeur, et la version livrée était saine
(43 contrôles, huit dégradations réelles).

Ce qui est retenu ici est le seul écart qu'une relecture ait révélé — un défaut réel, reproduit par
un test rouge avant correction (`CLAUDE.md` §18). Le reste du travail parallèle, largement
équivalent, n'apportait aucune preuve que la version livrée ne portait déjà.
## 2026-08-04 — `CRM-021` : spécification des channels, écrite après mesure

### Choix de l'unité — pourquoi `CRM-021` alors que trois unités la précèdent dans le plan

`docs/MASTER_PLAN.md` §2 place `CRM-012`, `CRM-013` et `CRM-014` avant `CRM-021`. Les trois ont été
examinées et écartées, chacune pour une raison vérifiable et non pour convenance :

- **`CRM-012` — droits fins par track et channel.** INC-013 pose noir sur blanc que son arbitrage
  doit être rendu « **avant `CRM-012`** », parce que cette unité écrira les politiques et figera la
  forme des requêtes. L'ouvrir reviendrait à trancher l'option 1 d'INC-013 à la place du
  responsable. Elle porte de surcroît « par track **et channel** » : sa moitié channel n'a
  aujourd'hui aucune table sur quoi s'exercer.
- **`CRM-013` — colonnes protégées.** Elle vise `secret_id`, `token_hash`, `current_step_id`,
  `email_local_part`, `card_events` et `audit_log`. **Aucune** de ces colonnes ni de ces tables
  n'existe : elles relèvent de `CRM-040`, `CRM-044` et du chunk 4. Il n'y a rien à protéger.
- **`CRM-014` — harnais des douze preuves de refus.** Dix des douze scénarios exigent des cards,
  des channels ou des comptes mail. Le livrer maintenant produirait un harnais dont les deux tiers
  seraient des attentes vides.

`CRM-021` est donc la première unité `[ ]` du plan réellement exécutable. Le fait que `CRM-012`
attende `CRM-021` pour sa propre moitié channel confirme au passage que l'ordre du plan est ici en
tension avec lui-même — ce que INC-013 signale déjà, et que cette entrée ne prétend pas résoudre.

Les quatre unités `[~]` ont été revues d'abord, comme la règle l'exige : `CRM-008`, `CRM-010`,
`CRM-011` et `CRM-020` restent bloquées par des dépendances de chunk 4 ou par des arbitrages
ouverts (INC-013, INC-015, INC-021, INC-023). Aucune n'a progressé, et aucune n'a régressé.

### Décision 59 — `workflow_id` est livrée nullable et sans clé étrangère, plutôt qu'omise

`docs/SCHEMA.md` §2 l'exige `non nul` avec clé étrangère vers `workflows`. Mesuré :
`to_regclass('public.workflows')` rend `NULL` — la table arrive avec `CRM-031`, deux étapes plus
loin dans le plan. INC-029.

Deux conduites étaient possibles : omettre la colonne, ou la livrer sans ses contraintes. La
seconde a été retenue, pour trois raisons dont une seule aurait suffi.

1. La colonne fait partie de l'identité du channel dans la référence de schéma du projet. L'omettre
   ferait diverger le dépôt de son propre `docs/SCHEMA.md`, alors que la livrer ne diffère que deux
   contraintes.
2. Les types générés de `CRM-006` la porteront, et le code qui viendra la lire n'aura pas à être
   réécrit.
3. **Le coût de reprise est identique.** Absente ou nulle, les lignes créées d'ici `CRM-031`
   devront être renseignées avant que `NOT NULL` puisse être posée. L'omission n'achète donc rien.

Ce qui distingue cette décision d'un contournement est qu'elle est **figée par des assertions** :
la suite pgTAP constate que la colonne est nullable, qu'elle ne porte aucune clé étrangère, et que
`public.workflows` n'existe pas. Les trois deviendront rouges à `CRM-031` et forceront la reprise
(décision 51).

### Décision 60 — Le cloisonnement passe par une clé étrangère **composite**, pas par une clé simple

`docs/SCHEMA.md` impose `workspace_id` sur toute table métier, « y compris lorsqu'il serait
déductible par jointure », au motif que les politiques RLS restent ainsi simples et indexables.
C'est une dénormalisation assumée.

Le danger d'une dénormalisation est qu'elle **mente**. Si `channels.workspace_id` pouvait différer
du workspace du track désigné par `channels.track_id`, la politique de lecture — qui interroge
`channels.workspace_id` — cloisonnerait sur une valeur fausse : le channel d'un track de A serait
lisible par les membres de B, avec des politiques pourtant correctes. Aucune règle RLS ne rattrape
cela, puisqu'elle fait confiance à la donnée.

La clé étrangère est donc portée par le couple :

```sql
alter table public.tracks   add constraint tracks_id_workspace_id_key unique (id, workspace_id);
alter table public.channels add constraint channels_track_id_workspace_id_fkey
	foreign key (track_id, workspace_id) references public.tracks (id, workspace_id) on delete cascade;
```

**Mesuré sur la sonde, et non déduit :**

- sans `unique (id, workspace_id)` sur `tracks`, PostgreSQL refuse la clé composite —
  `there is no unique constraint matching given keys for referenced table "tracks"`. L'unicité
  n'est donc pas décorative, elle est la condition de la garantie ;
- avec elle, un `workspace_id` incohérent est refusé en `23503` ;
- un `workspace_id` cohérent passe.

Cette contrainte **remplace** la clé simple `track_id → tracks(id)` : elle la contient. En ajouter
une seconde coûterait une vérification supplémentaire à chaque écriture sans rien garantir de plus.

Conséquence assumée : cette unité ajoute une contrainte d'unicité à `tracks`, table livrée par
`CRM-020`. L'ajout est **additif et idempotent** — `(id)` étant déjà clé primaire, `(id,
workspace_id)` est unique par construction et ne peut refuser aucune ligne. Si une assertion de la
suite `0004` énumère les contraintes de `tracks`, elle deviendra rouge et sera **étendue dans le
même changement**, jamais contournée.

### Décision 61 — `position` est attribuée dans la portée du **track**, pas du workspace

Les onglets d'un track forment une barre à eux seuls. Compter à l'échelle du workspace ferait
dépendre la numérotation d'un track de l'activité d'un autre, et produirait des barres commençant à
7 ou à 12 sans que rien ne l'explique.

Mesuré sur la sonde : trois insertions sans `position` — deux dans `conseil-ia`, une dans
`studio-web` — rendent `1`, `2` et `1`. La numérotation redémarre bien à chaque track.

La propriété apprise à `CRM-020` est reprise telle quelle, sans être redécouverte : un trigger
`BEFORE INSERT` ne distingue pas une `position` omise d'une `position` écrite `null`, et la
contrainte `NOT NULL` ne protège donc que les mises à jour.

### Décision 62 — La barre d'onglets est une navigation par liens, non un `tablist`

`docs/DESIGN_SYSTEM.md` §12.1 annonçait, comme écart temporaire de `CRM-007`, que « le patron ARIA
complet — `role="tab"`, `tabindex` glissant, flèches, `Home`, `Fin` — arrive avec les onglets
réels ». Les onglets réels arrivent ici, et le patron annoncé est **écarté**.

Motif : un `tablist` décrit des panneaux qui s'échangent **dans la même page**, sans changer
d'adresse. Nos onglets changent l'URL et le contenu principal. Les annoncer comme des onglets
décrirait aux technologies d'assistance un comportement qui n'est pas celui du produit — et le
`tabindex` glissant ferait perdre à l'utilisateur la navigation par `Tab` qu'un ensemble de liens
lui donne naturellement.

Le patron retenu est `nav` + liste de liens, avec `aria-current="page"` sur l'onglet courant.
`docs/DESIGN_SYSTEM.md` §12.1 est mis à jour dans le même changement : l'écart temporaire devient
une **position motivée**, ce qui n'est pas la même chose qu'un écart refermé, et le document doit
le dire.

Corollaire : `docs/DESIGN_SYSTEM.md` §12.4 — « les pilules de track ne sont pas cliquables, le lien
arrivera avec la destination » — est en revanche un écart réellement **refermé** : la destination
`/tracks/:slug` est livrée ici.

### Ce que cette spécification ne tranche pas

- **INC-029** — qui pose la clé étrangère et la contrainte `NOT NULL` de `workflow_id`, et quand.
  Trois options sont proposées, aucune n'est choisie.
- **INC-030** — `app.can_read_channel` et `app.can_write_channel` restent différées, comme les deux
  autres fonctions d'INC-013. La politique livrée cloisonne, elle ne restreint pas.
- **INC-021** — aucun écran de connexion. La route d'un track affichera donc son état « track
  introuvable » pour un appelant anonyme, qui est le refus réel du backend et non un défaut
  d'interface. C'est le troisième chunk 3 consécutif où cet arbitrage borne ce qui est démontrable.

---

## 2026-08-04 — `CRM-021` : channels livrés, et un cloisonnement qui ne repose plus sur la confiance

### Ce qui a été livré

La table `public.channels`, ses trois politiques RLS, le trigger d'ordre par track, la clé
étrangère qu'INC-010 avait dû différer, la route `/tracks/:slug[/:channel]`, la barre d'onglets
réelle, six channels seedés, et cinq harnais de preuves — pgTAP, API, unitaire, E2E,
`scripts/verify-channels.sh`.

### Décision 63 — La dénormalisation devait être rendue **véridique**, pas seulement documentée

C'est le point le plus important de cette unité, et il n'était pas dans son énoncé.

`docs/SCHEMA.md` impose `workspace_id` sur toute table métier, « y compris lorsqu'il serait
déductible par jointure », au motif que les politiques RLS restent ainsi simples et indexables. La
politique de lecture des channels interroge donc `channels.workspace_id` — et **rien**, dans
l'énoncé de l'unité, n'exigeait que cette colonne dise la vérité.

Or si elle pouvait mentir, tout le reste s'effondrerait sans qu'aucune preuve ne le voie : les
politiques resteraient correctes, la suite pgTAP resterait verte, et le channel d'un track du
workspace A serait lisible par les membres de B. La faille ne serait pas dans la règle mais dans la
donnée sur laquelle la règle s'applique — un endroit qu'aucune règle ne surveille.

La clé composite ferme ce chemin en base. Ce qui la distingue d'une précaution est qu'elle a été
**mesurée dans les deux sens** : le refus d'une ligne menteuse est constaté en tant que `postgres`,
donc au-dessus de toute RLS ; et l'acceptation d'une ligne cohérente est constatée aussi, faute de
quoi une contrainte trop stricte passerait pour une garantie.

Leçon, indépendante de cette unité : **une dénormalisation acceptée pour la RLS crée une surface
que la RLS ne peut pas défendre.** Toute table métier à venir portant `workspace_id` — `cards`,
`card_comments`, `mail_messages` — rencontrera exactement la même question.

### Ce que la relecture des captures a trouvé, et que les tests ne pouvaient pas trouver

Deux défauts, aucun attrapable par une assertion.

1. **Une capture montrait un écran impossible** : un track ouvert, titré, avec ses trois onglets, et
   une barre latérale affirmant « Aucun track ». La substitution réseau ne servait le track qu'à la
   requête `slug=eq.`, pas à celle de la barre latérale. Le scénario passait — il n'observait que
   les onglets. Substituer le réseau doit produire un état **cohérent** du produit, sinon la
   capture ne prouve rien de ce que l'utilisateur verrait.

2. **À 390 px, la barre d'onglets était tronquée sans indication.** Le §7 du design system était
   respecté : la page ne défilait pas. Le §4 était violé : « défilable, jamais tronqué **sans
   indication** ». Les deux règles étant vérifiées séparément, et chacune satisfaite, aucune
   assertion ne pouvait signaler leur conjonction fautive.

Le second est le plus instructif : ce n'est pas une règle manquante, c'est un **angle mort entre
deux règles vérifiées**. La correction n'ajoute donc pas seulement une classe, elle ajoute une règle
au design system (§12.6) qui nomme l'obligation à la charge du conteneur, pour que le board et la
vue liste ne la redécouvrent pas.

### Le harnais de `CRM-007` était devenu complaisant en silence

`scripts/verify-webapp.sh` éprouve sa propre non-complaisance en dégradant réellement la barre
d'onglets — un espacement hors échelle, une couleur hexadécimale — par substitution de chaîne.
`CRM-021` a réécrit ce composant : les substitutions ne s'appliquaient plus, dégradaient **zéro
ligne**, et les trois contrôles passaient sans rien mesurer.

Le harnais a échoué bruyamment, ce qui est le comportement voulu. Le fait mérite d'être noté au-delà
de sa correction : **un contrôle de non-complaisance qui vise un fichier par son contenu est
lui-même fragile au changement de ce fichier**, et son échec est alors la seule chose qui le
signale. C'est un argument pour que ces contrôles échouent bruyamment plutôt que de vérifier
silencieusement qu'ils ont bien dégradé quelque chose.

### Trois assertions figées par des unités précédentes ont échoué comme prévu

- `supabase/tests/0001` constatait l'absence de `channel_members_channel_id_fkey` ;
- la même suite insérait un droit fin sur un channel imaginaire, ce que la clé étrangère interdit
  désormais ;
- `webapp/src/lib/database.types.test-d.ts` énumérait les tables et les clés étrangères de
  `channel_members`.

Toutes trois ont été **révisées, jamais contournées**, dans le même changement — et la première a
gagné au passage une preuve qu'elle n'avait pas : l'orphelin est désormais refusé.

### Ce que cette unité ne prouve pas

- **Aucun channel n'apparaît dans l'interface**, et aucun ne le pourra avant qu'un écran de
  connexion existe (INC-021). La route d'un track affiche « Track introuvable » pour **tout**
  identifiant. C'est la démonstration la plus nette de ce que cet arbitrage coûte au chunk 3.
- **`workflow_id` n'est ni obligatoire, ni référencée, ni cohérente** (INC-029). Un channel sans
  workflow n'a pas d'étapes ; le risque est borné à la fenêtre `CRM-021` → `CRM-031`, les cards
  n'existant pas avant `CRM-040`.
- **Les droits fins ne sont pas appliqués** (INC-030). Un `channel_members.access = 'none'` ne
  masque rien encore, et deux preuves — une pgTAP, un scénario d'API — le constatent pour forcer
  leur révision à `CRM-012`.

### Décision 64 — Une contrainte d'unicité dans un `create table if not exists` n'est jamais réparée

*Relevée après la livraison de `CRM-021`, en rejouant ses preuves sur un second poste.*

**Problème.** La dégradation volontaire de l'unicité `(track_id, slug)` en unicité par workspace
n'était pas rattrapée par la réapplication de `supabase/migrations/0004_channels.sql`. Le fichier se
terminait **sans erreur**, et la base restait durablement affaiblie : un channel `prospection`
devenait impossible dans deux tracks du même workspace, ce que `docs/SCHEMA.md` §2 autorise
expressément.

**Observation, mesurée et non déduite.** La contrainte était déclarée **dans le `create table`**,
qui porte `if not exists` : au second passage, PostgreSQL saute l'instruction entière, contrainte
comprise. La migration était **idempotente sans être réparatrice** — exactement le défaut que
`CRM-020` avait rencontré sur `tracks_color_check` (décision 57). La leçon avait alors été
appliquée aux contraintes `CHECK` de la section 2.1, sans être généralisée aux autres contraintes
de table : c'est la généralisation qui manquait, pas la compréhension.

**Décision.** La contrainte est posée hors du `create table`, de façon convergente **et
conditionnelle**. La différence avec les contraintes `CHECK` est délibérée : un `drop`/`add`
inconditionnel d'une contrainte d'unicité **reconstruit son index** à chaque démarrage de la pile,
là où une revalidation de `CHECK` est négligeable. `pg_get_constraintdef` est donc comparé à la
définition attendue, et la contrainte n'est refaite que si elle diffère. Vérifié : à rejeu
identique, l'OID de la contrainte ne change pas.

**Ce que cela dit des preuves.** Le défaut était invisible à toutes les autres : elles s'exécutent
sur une base fraîchement migrée, où la contrainte est correcte. Seule la **restauration** après
dégradation l'expose — et `scripts/verify-channels.sh` ne dégradait pas cette contrainte-là. La
dégradation manquante est ajoutée, et la restauration de l'unicité est constatée **séparément** du
reste : un contrôle global, qui vérifie « la clé composite et la politique sont revenues », serait
resté vert pendant que l'unicité restait fausse.

**Règle qui en sort, et qui vaut pour les unités suivantes.** Une contrainte qu'aucune dégradation
n'exerce n'est pas une contrainte prouvée. La liste des dégradations d'un harnais doit couvrir
**chaque** contrainte que la migration déclare, et pas seulement celles qui portent la garantie la
plus visible.

### Décision 65 — Un harnais vérifie sa propre restauration, pas la propreté de l'arbre

**Problème.** `scripts/verify-webapp.sh`, livré par `CRM-007`, terminait par
`git diff --quiet -- webapp/src/app/TabBar.tsx webapp/src/lib/workspaces.ts`. `CRM-021` modifie
`TabBar.tsx` pour y livrer les onglets réels : le contrôle passait au rouge alors que le harnais
avait parfaitement restauré ce qu'il avait altéré.

**Observation.** `git diff` compare au **dernier commit**, pas à l'état d'avant dégradation. Le
contrôle échouait donc dans le cas d'usage principal du harnais — on le rejoue juste **avant** de
committer, donc sur un arbre nécessairement modifié. `scripts/verify-tracks.sh` avait déjà dû
résoudre le même problème pour son fichier de jetons, en le notant explicitement ; la leçon n'avait
pas été reportée.

**Décision.** La comparaison porte sur les sauvegardes que le harnais prend déjà avant sa première
altération. Ce qu'un contrôle de restauration doit prouver est « le harnais rend ce qu'il a pris »,
jamais « l'arbre de travail est propre », qui n'est pas son affaire — et qui, affirmé par un
harnais, ferait échouer toute livraison touchant les fichiers qu'il altère.

### Décision 66 — Deux exécutions concurrentes de la routine ont livré `CRM-021` en parallèle

**Fait.** Deux exécutions de la routine d'avancement du backlog ont travaillé simultanément sur
`CRM-021`, en partant du même commit (`07da59b`, la spécification). L'une a poussé la sienne ; la
seconde a découvert le conflit au moment de se resynchroniser.

**Décision.** L'implémentation **déjà poussée fait foi**, et le travail parallèle est abandonné
plutôt que fusionné : les deux étaient complètes et vérifiées, et rejouer un merge de deux
migrations, deux suites pgTAP et deux harnais aurait produit un ensemble que personne n'a éprouvé
tel quel. Seuls les **défauts trouvés par l'exécution parallèle et absents de la version retenue**
sont reportés — les décisions 64 et 65 ci-dessus. La branche du travail abandonné est conservée
localement sous `travail-crm021-parallele`, sans être poussée.

**Ce que cela change pour la suite.** La consigne « resynchronise-toi d'abord » ne suffit pas quand
deux exécutions se chevauchent : la seconde peut partir d'un état à jour et découvrir le conflit une
heure plus tard. Le fait est consigné ici parce qu'il se reproduira, et que le réflexe correct est
celui appliqué ici — vérifier ce que la version poussée contient **déjà**, et n'ajouter que ce qui
lui manque réellement, plutôt que d'imposer son propre travail.
---

## 2026-08-04 — `CRM-030` : spécification du catalogue de nœuds, écrite après mesure

**Problème.** `docs/SPEC-workflow-engine.md` §2 tenait en dix-huit lignes : un tableau de sept
nœuds, une phrase sur le type `won` / `lost`, une phrase sur l'archivage. Il ne disait ni ce qu'une
clé de nœud a le droit d'être, ni comment le catalogue s'ordonne, ni ce que l'API doit rendre à
chacun des trois rôles, ni quelles couleurs les sept nœuds portent — alors que `docs/SCHEMA.md` §3
exige une colonne `color`. Écrire la migration avant d'avoir répondu à ces questions revenait à
les trancher dans du SQL.

**Méthode.** Celle de la décision 52, appliquée une troisième fois : une table sonde jetable
`public.sonde_wnc`, portant la structure et les politiques envisagées, créée sur la pile réelle,
interrogée avec les jetons des trois comptes seedés obtenus par la véritable route de connexion,
puis détruite — l'absence de reste étant **constatée** et non supposée (`to_regclass` nul, aucune
fonction `app.sonde*` résiduelle, aucun workspace de sonde). Les chiffres des §2.3 à §2.8 de la
spécification sont ces mesures.

### Décision 67 — Le catalogue s'ordonne par **workspace**, et c'est la portée naturelle ici

`CRM-021` avait tranché l'inverse pour les channels : leur `position` est attribuée dans la portée
du **track**, parce que les onglets d'un track forment une barre à eux seuls (décision 61). La
question se repose donc pour le catalogue, et la réponse est différente sans être contradictoire :
le catalogue est **une liste unique par workspace**, affichée d'un seul tenant dans l'écran
d'administration. Il n'a pas de conteneur intermédiaire, donc pas d'autre portée possible.

Mesuré sur la sonde : trois insertions sans `position` dans un workspace rendent `1`, `2`, `3` ; une
quatrième dans un autre workspace rend `1` ; une valeur explicite (`42`) est conservée. La
propriété héritée de `CRM-020` — écrire `position: null` équivaut à l'omettre, un trigger
`BEFORE INSERT` ne pouvant pas distinguer les deux — a été **vérifiée à nouveau** plutôt que
supposée acquise.

**Conséquence.** Deux triggers d'attribution de position coexistent désormais dans le projet, avec
deux portées différentes. Ce n'est pas une duplication à factoriser : ce qui diffère entre eux est
précisément la règle métier, et une fonction générique paramétrée par le nom de la colonne de
portée serait moins lisible que deux fonctions de six lignes.

### Décision 68 — `numeric(5,2)` arrondit **avant** la contrainte, et le fait est documenté

Mesure inattendue : `99.999` inséré dans une colonne `numeric(5,2)` portant
`CHECK (0 <= x <= 100)` est **accepté** et stocké `100.00`. `100.004` également. Seuls `100.01` et
`-0.01` sont refusés. La contrainte porte donc sur la valeur **arrondie par le type**, jamais sur
celle que le client a envoyée.

Rien à corriger : le comportement est correct pour une probabilité en pourcentage à deux décimales.
Mais il devait être écrit, faute de quoi un test insérant `99.999` et attendant `99.999` échouerait
pour une raison sans rapport avec la règle métier — et serait « corrigé » en relâchant la
contrainte. C'est l'application de la décision 47 : le comportement réel de l'outil est documenté,
pas contourné.

### Décision 69 — La garde d'archivage n'est pas écrite, parce que l'écrire ne protégerait rien

`docs/SPEC-workflow-engine.md` §2 exige que l'archivage d'un nœud soit refusé tant qu'une card
active s'y trouve, et la Definition of Done de `CRM-030` exige une preuve pgTAP de ce refus. Le
chemin de la garde est `cards.current_step_id → workflow_steps.node_id → workflow_nodes_catalog.id`.
Mesuré : les trois tables `workflows`, `workflow_steps` et `cards` rendent `NULL` à `to_regclass`.

La tentation est réelle d'écrire quand même le trigger, puisque PostgreSQL l'accepterait. **Mesuré,
et c'est ce qui a tranché** : la création d'une fonction PL/pgSQL référençant `public.cards`
**réussit** — le corps n'est pas analysé à la création — et l'échec ne survient qu'au premier
appel, en `relation "public.cards" does not exist`. Un trigger `BEFORE UPDATE` écrit aujourd'hui
ferait donc échouer **toute** mise à jour du catalogue dès sa livraison : renommer un nœud,
corriger une couleur, et le seed lui-même, qui n'aurait plus convergé.

Une garde qui casse ce qu'elle est censée protéger, sans protéger quoi que ce soit, est pire que
son absence. Elle est donc **différée et nommée** : INC-031, avec trois options d'arbitrage, et
l'absence des deux tables **figée par des assertions `hasnt_table`** qui deviendront rouges à
`CRM-031` et à `CRM-040`. Quatrième emploi du mécanisme de la décision 51.

### Ce que la spécification a dû trancher, et qui n'était écrit nulle part

- **Les couleurs des sept nœuds.** `docs/SCHEMA.md` §3 exigeait la colonne, le tableau du §2 ne
  donnait aucune valeur. Fixées au §2.9 : les deux nœuds terminaux prennent `success` et `danger`,
  dont c'est exactement le sens dans `docs/DESIGN_SYSTEM.md` §1 ; `prospection` reste `neutral`, un
  début d'affaire ne portant aucun jugement.
- **`default_stale_after_days` doit être nul pour un nœud terminal.** Une affaire livrée ou perdue
  n'est pas en retard. La contrainte livrée est `x > 0` : un seuil de zéro jour signalerait toute
  card dès son arrivée et masquerait l'absence de seuil sous une valeur qui a l'air d'en être une.
- **`default_probability` est nullable, et `0` n'est pas `NULL`.** `perdu` vaut réellement `0 %` ;
  un nœud métier peut n'avoir aucune signification prévisionnelle. Confondre les deux rendrait
  toute moyenne fausse.

### Ce que la mesure a rappelé, et qui vaut au-delà de cette unité

**Une mise à jour refusée par la clause `USING` d'une politique ne produit aucune erreur.** Mesuré :
un `business_developer` tentant d'archiver un nœud reçoit `200` et un tableau **vide**, parce
qu'aucune ligne n'a été vue comme modifiable. Un test qui se contenterait de constater l'absence
d'erreur conclurait que l'écriture a réussi. Toute preuve de refus de mise à jour doit donc relire
la ligne et vérifier qu'elle est **inchangée**. Le fait vaut pour `tracks` et `channels` autant que
pour le catalogue ; il est désormais écrit au §2.8 de la spécification.

### Les droits fins ne sont pas différés ici — ils ne s'appliquent pas

`tracks` et `channels` portent chacun un écart ouvert — INC-024, INC-030 — parce que leur politique
de lecture devrait consulter un droit fin et ne le fait pas encore. Le catalogue **n'est pas dans
ce cas** : `track_members` et `channel_members` portent sur un sous-arbre d'organisation, et le
catalogue n'appartient ni à un track ni à un channel. Sa politique s'arrête au rôle de workspace
**par conception**, pas par différé, et aucune entrée d'incohérence n'est ouverte à ce titre.

### Le choix de l'unité — pourquoi `CRM-030`, et pas `CRM-012`

`docs/MASTER_PLAN.md` §2 place `CRM-012` → `CRM-014` avant le chunk 3. Les trois ont été examinées
et écartées, chacune pour une raison mesurée :

- **`CRM-012` — droits fins par track et channel.** INC-013 exige explicitement d'être tranchée
  « **avant `CRM-012`**, qui écrira les politiques et figera la forme des requêtes ». L'arbitrage
  n'a pas été rendu. Écrire les quatre fonctions `can_*` reviendrait à choisir l'option 1 à la
  place du responsable, et rendrait rouge la suite pgTAP de `CRM-010` qui constate leur absence.
- **`CRM-013` — colonnes protégées.** Sa Definition of Done porte sur `cards.current_step_id`,
  `cards.email_local_part`, `mail_*.secret_id`, `card_events` et `audit_log`. Mesuré : aucune de
  ces tables n'existe. Il n'y a rien à révoquer.
- **`CRM-014` — harnais de preuves d'autorisation.** Ses douze scénarios exigent des cards, des
  comptes mail et un second workspace. Dix des douze preuves de refus restent hors d'atteinte.

`CRM-030` est donc la première unité du plan dont le sujet existe, et elle est la tête du chunk 3.b
— « le moteur de workflow avant les cards, car une card naît dans une étape ».

**Les cinq unités `[~]` du backlog ont également été réexaminées**, chacune restant bloquée pour la
raison déjà consignée : `CRM-008` par INC-023, `CRM-010` par INC-013, `CRM-011` et `CRM-020` et
`CRM-021` par INC-021, l'absence d'écran de connexion. Aucune n'a été rouverte : ce qui leur manque
est un arbitrage du responsable ou une table du chunk suivant, et non un travail à faire.


---

## 2026-08-04 — `CRM-030` : catalogue de nœuds livré, et un refus qui ne ressemble pas à un refus

**Ce qui est livré.** `supabase/migrations/0005_workflow_nodes_catalog.sql` : la table, l'unicité
de la clé par workspace, six contraintes de valeur convergentes, le trigger d'attribution de
`position` dans la portée du workspace, l'index partiel du catalogue actif, et trois politiques
RLS. Le seed porte les sept nœuds du contrat plus un archivé. Les preuves sont unitaires
(**80 assertions pgTAP**), d'API (**25 scénarios Playwright**, hors interface, jetons réels) et
rejouables (`scripts/verify-catalogue.sh`, **29 contrôles**).

### Décision 70 — Un refus de mise à jour ne lève aucune exception, et c'est le moteur qui le veut

La spécification écrite avant le code disait déjà, au §2.8, qu'un `PATCH` refusé rend `200` et un
tableau vide. Elle l'attribuait à PostgREST. **C'est faux, et c'est une assertion qui l'a établi.**

Écrite d'abord en `throws_ok('42501')` par symétrie avec l'insertion, l'assertion pgTAP du refus de
renommage par un `business_developer` a rendu « caught: no exception » — en SQL direct, sans
PostgREST. La cause est structurelle : une clause `USING` ne **refuse** pas une ligne, elle la rend
**invisible**. L'ordre `UPDATE` ne trouve alors rien à modifier et réussit sur zéro ligne. Une
clause `WITH CHECK`, elle, refuse bel et bien, en `42501` : les deux formes coexistent sur la même
politique, ce qui est précisément ce qui rend la première difficile à voir.

**Conséquence, et elle dépasse cette unité.** Toute preuve de refus de mise à jour doit relire la
ligne et la constater **inchangée**. Une preuve qui se contenterait de l'absence d'erreur — ou pire,
d'un `throws_ok` qui échouerait puis serait « corrigé » en relâchant l'attente — ne prouverait rien.
Le fait est désormais écrit au §2.8, et le harnais porte un contrôle de non-complaisance dédié : il
ouvre réellement la politique de mise à jour et **constate que le renommage passe**, sans quoi la
preuve du refus serait tout aussi verte sur un produit où rien n'est modifiable.

### Ce que le harnais a réellement attrapé

Trois dégradations volontaires, chacune faisant sortir `scripts/verify-catalogue.sh` en code `1` :

1. **lecture ouverte à tous** — la suite pgTAP tombe la première, avant même que la migration ne
   soit rejouée ;
2. **seed privé de son nœud archivé** — trois contrôles tombent : le compte, l'état archivé, et la
   lecture de l'administrateur ;
3. **seuil de relance posé sur un nœud terminal** — le contrôle des nœuds terminaux tombe.

La restauration est **constatée** dans chaque cas, et non supposée : contrainte revenue, politiques
revenues, libellé du seed revenu à « Prospection ».

### Deux compteurs figés par des unités précédentes ont échoué comme prévu

- `scripts/verify-harness.sh` fige le nombre d'assertions pgTAP et de scénarios Playwright, de
  sorte qu'une suite cessant d'être découverte ne passe pas pour verte. Portés de **374 / 50 / 37**
  à **454 / 75 / 37** — le compteur d'interface est **inchangé**, cette unité ne livrant aucun
  écran.
- `webapp/src/lib/database.types.test-d.ts` énumère les tables du schéma. L'assertion a échoué à la
  régénération des types, et a été **révisée** dans le même changement, accompagnée de sept
  nouvelles qui figent le contrat du catalogue — dont la troisième occurrence d'INC-027,
  `position` exigée à l'insertion par un générateur qui ignore les triggers.

### Ce que cette unité ne prouve pas

- **Le refus d'archiver un nœud occupé n'est pas livré** (INC-031). Ce n'est pas un renoncement :
  ses tables cibles n'existent pas, et l'écrire ferait échouer toute mise à jour du catalogue. Le
  harnais **vérifie que cette absence est toujours vraie**, de sorte qu'elle ne survive pas à sa
  cause.
- **Aucune interface, donc aucune capture d'application.** Le catalogue n'a pas d'écran et n'en
  aura pas avant l'éditeur de `CRM-031`. La Definition of Done exige un « E2E d'administration » :
  il n'y a rien à administrer depuis un écran, et la webapp reste de surcroît un appelant anonyme
  faute de parcours de connexion (INC-021). C'est la quatrième unité consécutive du chunk 3 à
  buter sur cet arbitrage.
- **Les preuves de refus n° 2, n° 3 et n° 11 sont acquises au niveau du catalogue**, la n° 2 pour
  la première fois. Les neuf autres restent dues par `CRM-014`.

---

## 2026-08-04 — Intégration sur `main` du catalogue de nœuds, et ce que l'environnement a coûté

### Décision 71 — Un travail poussé ailleurs que sur `main` s'intègre, il ne se refait pas

**Fait.** `CRM-030` avait été livrée par une exécution de la routine qui l'a poussée sur une
branche — `claude/happy-goldberg-c627zj` —, et non sur `main`, contre `CLAUDE.md` §13. Deux
commits y étaient donc bloqués : la spécification et l'implémentation. `main` avait de son côté
avancé d'un commit, le correctif d'idempotence de `CRM-021` (décision 64).

**Décision.** Les deux commits sont **reportés sur `main` par `cherry-pick`**, et non refaits. La
situation n'est pas celle de la décision 66 : là, deux implémentations complètes et vérifiées de la
**même** unité se faisaient concurrence, et fusionner aurait produit un ensemble que personne
n'avait éprouvé. Ici il n'y a **qu'une** implémentation, et l'alternative n'était pas de choisir
mais de la perdre — puis de la réécrire à la prochaine exécution, qui aurait trouvé `CRM-030`
marquée `[ ]` sur `main`.

**Ce que l'intégration a dû trancher.** Les quatre décisions du catalogue portaient les numéros
64 à 67, déjà pris sur `main` par `CRM-021`. Elles deviennent **67 à 70**, et les onze références
croisées qui les citent — migration, suite pgTAP, harnais, scénarios d'API, spécification du moteur
de workflow, backlog — sont corrigées dans le même changement. Aucune décision antérieure n'est
renumérotée : un journal chronologique ne réécrit pas son passé pour faire de la place.

**Ce que l'intégration ne dispense pas de faire.** Un vert mesuré sur un autre socle ne prouve rien
sur celui-ci. **Toutes** les preuves ont donc été réexécutées sur `main` : `verify-catalogue.sh`
36/36, et les douze harnais précédents, **439 contrôles au total, aucune anomalie**. Un décompte
du backlog s'en trouve corrigé — `verify-channels.sh` vaut 30 et non 28 depuis la décision 64.

**Ce que cela change pour la suite.** La consigne « resynchronise-toi d'abord » ne protège pas
d'une exécution qui pousse ailleurs : la resynchronisation regarde `main`, où le travail n'est
jamais arrivé. Le réflexe correct, appliqué ici, est d'**énumérer les branches distantes** avant de
choisir son unité, et non seulement de mettre `main` à jour.

### Ce que l'environnement de la routine a coûté, mesuré et non supposé

Trois obstacles ont dû être levés avant qu'une seule preuve puisse être produite. Ils sont écrits
ici parce qu'ils se reproduiront à chaque exécution sur un conteneur neuf.

- **Le démon Docker n'est pas démarré, et son script d'init échoue.** `service docker start` sort en
  erreur sur `ulimit: Operation not permitted` — l'hôte est privé de `CAP_SYS_RESOURCE`, ce que la
  décision 14 avait déjà mesuré pour `STACK_RLIMIT_NOFILE`. Le démon se lance directement
  (`dockerd --host=unix:///var/run/docker.sock`), et la pile démarre ensuite normalement.
- **`./runDev.sh` échoue à froid derrière un proxy TLS interposé.** La construction de l'image
  `webapp` s'arrête sur `npm error SELF_SIGNED_CERT_IN_CHAIN`. `webapp/Dockerfile` prévoit
  pourtant le secret `npm_ca` pour ce cas exact, mais `docker-compose.dev.yml` ne le câble pas :
  le chemin documenté est inatteignable depuis le script de lancement. Contourné en construisant
  l'image à la main avec `--secret id=npm_ca`. **Non corrigé** — c'est un livrable de `CRM-002` et
  de `CRM-007`, hors du périmètre de ce passage : consigné en **INC-032**.
- **Les navigateurs préinstallés ne correspondent pas à la version épinglée de Playwright.**
  `@playwright/test@1.62.1` attend la révision `1234` de Chromium ; l'image n'expose que la `1194`.
  Les **37 scénarios** du projet `ui` échouaient tous sur `browserType.launch: Executable doesn't
  exist`, c'est-à-dire pour une raison sans aucun rapport avec le produit. Résolu par
  `npx playwright install chromium chromium-headless-shell`. Le fait est noté parce qu'un harnais
  qui échoue en bloc invite à chercher une régression là où il n'y en a pas.

### Les captures régénérées ne sont pas systématiquement meilleures que celles qu'elles remplacent

Le rejeu des harnais a réécrit trois captures de `CRM-007` et de `CRM-021`. Elles ont été
**regardées** avant d'en décider, et non conservées par défaut. `route-reglages-1440.jpg` montrait
**deux** entrées de navigation mises en valeur — « Ma journée » plus fortement que « Réglages »,
qui est pourtant la route courante — là où la version versionnée n'en montre qu'une. La différence
n'est pas un changement du produit : c'est l'état de survol laissé par le pointeur du pilote
Playwright au moment de la prise, et il rend la capture **trompeuse** sur ce qu'elle est censée
documenter.

Les trois captures sont donc **restaurées**. Ce passage ne touche aucun écran ; remplacer des
captures de référence par des variantes non déterministes, dont une fausse le sens, aurait ajouté
du bruit à un commit documentaire et affaibli la preuve visuelle de deux unités `[x]`.

**Règle qui en sort.** Une capture régénérée par un rejeu se regarde comme une capture neuve. Elle
ne remplace la précédente que si elle documente au moins aussi bien l'état qu'elle prétend montrer
— l'automatisme « le harnais l'a réécrite, donc elle est à jour » n'est pas un critère.

---

## 2026-08-04 — `CRM-031` : spécification des workflows, écrite après mesure et avant tout code

Le §3 de `docs/SPEC-workflow-engine.md` tenait en vingt-six lignes et datait de `CRM-000`. Il
énonçait une intention — « exactement une étape initiale », « les cycles sont autorisés », « une
étape peut surcharger » — sans dire par quel moyen la base le garantirait, ni ce qui arrive quand
elle ne le peut pas. Il a été **réécrit après mesure**, sur trois tables sondes jetables créées
sur la pile réelle puis détruites, l'absence de reste étant constatée (`to_regclass` nul sur les
trois, aucune fonction `sonde*` restante).

Ce qui suit est ce que la mesure a appris, et qui n'était pas déductible du texte d'origine.

### Décision 72 — « Exactement une étape initiale » n'est pas imposable à l'écriture, et l'exiger casserait la création d'un workflow

**Fait mesuré.** L'exigence se scinde en deux moitiés très inégales.

*Au plus une* est acquise sans rien inventer : un index unique partiel `(workflow_id) where
is_initial` refuse la seconde étape initiale en `23505`.

*Au moins une* ne l'est pas. Un workflow naît **avant** ses étapes ; le seul mécanisme capable de
l'exiger est un `constraint trigger … deferrable initially deferred`, qui reporte le contrôle à la
validation de la transaction. Éprouvé sur la sonde : l'insertion isolée d'un workflow — exactement
ce que fait PostgREST, une requête valant une transaction — est **acceptée**, puis le `commit`
**échoue** en `workflow_sans_etape_initiale`. La garde ne protégerait donc rien du tout : elle
rendrait la création d'un workflow impossible par l'API, et l'éditeur d'administration n'aurait
aucun moyen de créer le premier objet qu'il est censé éditer.

**Décision.** La base garantit « au plus une ». « Au moins une » devient une condition **d'emploi**
et non d'existence : un workflow sans étape initiale est un **brouillon**, structurellement valide
et inutilisable. La condition est vérifiée là où elle a un sens — au rattachement d'un channel
(`CRM-033`), à la création d'une card (`CRM-040`) — et le seed en fournit une.

**Conséquence.** Le produit admet un état que la spécification d'origine ne prévoyait pas. Il est
**écrit** au §3.5 et porté au §9 comme point ouvert n° 5, plutôt que découvert par le premier
éditeur qui enregistrera un workflow vide.

### Décision 73 — Une transition ne sort pas de son workflow parce que la base l'interdit, non parce qu'un trigger le vérifie

**Fait mesuré.** Une clé étrangère composite `(from_step_id, workflow_id)` vers
`workflow_steps (id, workflow_id)` refuse en `23503` une arête dont l'étape appartient à un autre
workflow — `Key (to_step_id, workflow_id)=(…) is not present in table "workflow_steps"`. Elle exige
en contrepartie une unicité `(id, workflow_id)` sur les étapes, faute de quoi sa création échoue en
`42830`, « there is no unique constraint matching given keys ».

**Décision.** Les deux extrémités d'une transition portent la clé composite. C'est le même geste
que `channels.workspace_id` rendu véridique par `(track_id, workspace_id)` (décision 62) : la
cohérence est **structurelle**, pas surveillée. Un trigger aurait rendu le même service, plus tard
— au premier appel — et moins sûrement.

Trois autres cohérences suivent le même procédé, pour le même motif : le track d'un workflow
appartient à son workspace, le nœud d'une étape appartient au workspace de son workflow, et le
workflow d'un channel appartient au workspace du channel. Aucune politique RLS ne rattraperait ces
trois erreurs : une politique décide **qui écrit** la ligne, pas **ce que la ligne raconte**.

**Effet de bord mesuré et voulu :** supprimer une étape emporte ses arêtes (`on delete cascade`).
Une arête vers une étape disparue n'est pas une donnée à conserver.

### Décision 74 — La suppression physique est ouverte aux étapes et aux transitions, et à elles seules

**Fait.** `docs/SCHEMA.md` donne pour convention générale la suppression douce et réserve la
suppression physique aux purges RGPD. Les quatre tables livrées jusqu'ici s'y tiennent : aucune
politique `for delete`, aucun privilège `DELETE`.

**Décision.** `workflow_steps` et `workflow_transitions` font exception, et l'exception est écrite
plutôt que silencieuse. Motif : ces lignes sont la **composition** d'un workflow, pas des objets à
durée de vie propre ; `docs/SCHEMA.md` §3 ne leur donne d'ailleurs aucun `archived_at`. Un éditeur
qui ne peut pas retirer une arête ne peut pas éditer, et la seule alternative aurait été d'inventer
une colonne que la référence de schéma ne prévoit pas. Le `DELETE` est réservé aux administrateurs,
par politique **et** par privilège.

**Conséquence écrite d'avance pour `CRM-040`.** Le jour où des cards occuperont des étapes, la clé
étrangère `cards.current_step_id → workflow_steps (id)` devra être `on delete restrict`, faute de
quoi la suppression d'une étape occupée passerait. Le fait est inscrit au §3.7 pour que `CRM-040`
le trouve écrit.

### Décision 75 — Le commentaire exigé sur les transitions vers « Perdu » est un choix, et il est nommé comme tel

L'énoncé d'origine ne disait pas quelles transitions du workflow par défaut exigent un commentaire.
Ne rien exiger aurait laissé `require_comment` non démontrée dans les données de démonstration, ce
que `CLAUDE.md` §8 refuse. Le choix retenu — les quatre transitions vers `Perdu` — est justifiable :
une affaire perdue sans motif n'est exploitable par aucune analyse, et c'est la seule transition du
graphe dont la raison ne se déduit pas de l'étape d'arrivée. Il est **renversable en une ligne** du
contrat de seed, et porté au §9 comme point ouvert n° 4 plutôt que présenté comme une règle établie.

### Ce que la mesure a ouvert, et qui n'est pas tranché ici

- **INC-033.** `require_fields` est un `uuid[]` : PostgreSQL refuse toute clé étrangère depuis une
  colonne tableau — « Key columns "require_fields" and "id" are of incompatible types ». Ce n'est
  pas un différé d'ordonnancement, c'est une propriété du type. Des identifiants morts survivront à
  la suppression d'un champ de formulaire, et le comportement de `move_card` face à eux n'est écrit
  nulle part. Trois options, à trancher avant `CRM-036`.
- **INC-029, mise à jour.** La clé étrangère de `channels.workflow_id` est livrable et livrée ; la
  contrainte `NOT NULL` ne l'est pas, parce qu'elle change le contrat de création d'un channel.
  Elle revient à `CRM-033`, avec le trigger de cohérence qu'elle accompagne. L'option 1 de
  l'arbitrage est engagée **à moitié**, et le dire est plus honnête que de clore l'entrée.
- **INC-031, mise à jour.** `workflow_steps` existe désormais ; `cards` reste due. `CRM-031`
  n'adopte pas l'option 2 — rattacher la garde d'archivage à cette unité en la limitant à
  l'occupation par une étape —, parce qu'elle est **plus stricte** que la règle spécifiée et que
  l'adopter en silence trancherait à la place du responsable.

---

## 2026-08-04 — `CRM-031` : les workflows livrés, et une exigence que la base ne peut pas tenir

L'unité livre les trois tables du graphe des états, leurs neuf politiques, le seed du workflow par
défaut et la clé étrangère qu'INC-029 avait différée. Ce qui suit n'est pas le récit du code, mais
ce que la mesure a appris pendant qu'il s'écrivait.

### Décision 76 — Le comptage de pgTAP est sensible aux savepoints, et cela dicte l'écriture des suites

**Fait mesuré, et découvert par un échec.** La suite a d'abord été écrite comme celles de `CRM-030`
et de `CRM-021` : chaque profil endossé isolé dans un `savepoint … rollback to savepoint`. Résultat
mesuré : **106 assertions émises, 86 comptées**. `finish()` annonçait « planned 96 but ran 85 »,
puis `scripts/run-sql-tests.sh` refusait la suite en « plan annoncé 86, 106 assertions émises ».

La cause a été isolée en tronquant la suite section par section : les résultats de pgTAP vivent dans
une table, qu'un `rollback to savepoint` annule comme le reste, alors que la numérotation, portée
par une séquence, poursuit. Une assertion rejouée dans un savepoint annulé **s'affiche** — et
échoue bruyamment si elle doit échouer — mais **ne compte pas**.

**Décision.** Les blocs d'autorisation de `supabase/tests/0007_workflows.test.sql` n'annulent rien :
ils rendent la main au rôle superutilisateur et **défont explicitement** leurs écritures. Une arête
supprimée par un administrateur est réinsérée avec la clé de service avant la preuve suivante, de
sorte que « le `business_developer` n'a rien supprimé » porte sur une arête réellement présente.

**Pourquoi ne pas simplement aligner le plan sur 86.** Parce que les deux gardes disent des choses
différentes — pgTAP compare le plan à ce qu'il a **enregistré**, le harnais à ce qu'il a **vu
passer** — et qu'aligner l'une aurait laissé l'autre en contradiction. Un fichier de preuves dont la
sortie se contredit n'est pas une preuve.

**Ce que cela ne dit pas.** Les suites `0002`, `0004`, `0005` et `0006` emploient toujours des
savepoints et restent vertes, plan tenu. La différence n'a pas été élucidée, et elle n'a pas été
supposée : ce qui est écrit ici est ce qui a été mesuré sur **cette** suite. Le fait est consigné
dans son en-tête pour que la prochaine ne le redécouvre pas.

### Décision 77 — Une ligne doublement fautive est refusée par sa contrainte de valeur, pas par son unicité

**Fait mesuré, et lui aussi établi par un échec d'assertion.** Une transition portant à la fois un
libellé blanc et un couple `(from, to)` déjà déclaré est refusée en `23514` — la contrainte de
valeur —, non en `23505`. L'assertion avait été écrite dans l'autre sens, par symétrie avec le
catalogue ; elle a échoué, et c'est cet échec qui a fixé l'ordre d'évaluation.

Le fait compte pour la suite : une preuve future qui attendrait un conflit d'unicité sur une ligne
par ailleurs invalide échouerait pour une raison sans rapport avec ce qu'elle croit vérifier — et
serait « corrigée » en relâchant la mauvaise contrainte. C'est le même piège que l'arrondi de
`numeric(5,2)` mesuré à `CRM-030` (décision 68).

### Ce que quatre garde-fous ont coûté, et ce qu'ils ont rapporté

Le mécanisme de la décision 51 a fonctionné une **quatrième** fois, et à plus grande échelle que
jamais : trois assertions pgTAP de `CRM-021`, deux de `CRM-030`, un contrôle de
`scripts/verify-catalogue.sh`, un de `scripts/verify-channels.sh`, un scénario d'API de `CRM-021`,
une assertion de type et les trois compteurs de `scripts/verify-harness.sh` sont **devenus rouges**
en même temps que la migration devenait verte.

Aucun n'a été contourné. Chacun a été révisé dans le même changement, et deux d'entre eux disent
désormais l'inverse de ce qu'ils disaient — `workflows` existe, `channels.workflow_id` est
référencée — tout en conservant la moitié qui reste due : la colonne est encore nullable, et
l'assertion qui le constate deviendra rouge à `CRM-033`.

C'est le coût annoncé de cette pratique, et il est modeste au regard de ce qu'il évite : sans ces
assertions, INC-029 et INC-031 auraient survécu à leur cause, et la clé étrangère de `channels`
serait restée absente sans que rien ne le signale.

### Ce que l'unité ne livre pas, et qui n'est pas un oubli

- **L'éditeur de workflow**, exigé par la Definition of Done. Il suppose un écran d'administration
  authentifié ; la webapp reste un appelant anonyme (INC-021). Cinquième unité consécutive du
  chunk 3 à buter sur cet arbitrage.
- **La contrainte `NOT NULL` de `channels.workflow_id`** : elle change le contrat de création d'un
  channel et revient à `CRM-033` (INC-029, mise à jour).
- **La garde d'archivage d'un nœud occupé** : `workflow_steps` existe, `cards` non (INC-031). Le
  chemin est à moitié praticable, ce qui ne suffit pas.

### Ce que l'environnement de la routine a coûté cette fois-ci, mesuré

Les trois obstacles relevés lors de l'intégration de `CRM-030` se sont **tous reproduits** sur un
conteneur neuf, comme annoncé : démon Docker à lancer à la main, image `webapp` à construire avec
`--secret id=npm_ca` faute de câblage dans `docker-compose.dev.yml` (INC-032), navigateurs
Playwright à réinstaller pour la révision attendue par la version épinglée. Deux faits nouveaux s'y
ajoutent, et ils sont d'une autre nature.

**Vingt-neuf commits n'existaient nulle part ailleurs que dans le conteneur.** Au démarrage,
`git fetch origin claude/happy-goldberg-s6b1t0` répondait « couldn't find remote ref » : la branche
de travail de la routine n'avait **jamais** été poussée, et le travail de plusieurs exécutions —
`CRM-020`, `CRM-021`, l'intégration de `CRM-030` — ne survivait que dans un environnement éphémère.
Le `push` a été la première action de cette exécution, avant même de choisir une unité. La consigne
« resynchronise-toi d'abord » suppose qu'il y ait quelque chose à quoi se synchroniser.

**L'identité Git par défaut du conteneur est celle de l'agent.** Aucune configuration locale
n'existait dans le dépôt, et les deux premiers commits de cette exécution ont porté
`Claude <noreply@anthropic.com>`, contre `CLAUDE.md` §13. La configuration locale a été posée et les
deux commits réécrits ; le fait, ses conséquences et ce qui reste à arbitrer sont consignés en
**INC-034**. La configuration locale vivant dans `.git/config`, non versionné, elle sera perdue au
prochain conteneur neuf : le correctif durable relève d'un arbitrage, pas de cette unité.

---

## 2026-08-04 — `CRM-031` : deux exécutions parallèles, et un défaut que seule la seconde a vu

### Décision 78 — La convergence vaut pour **toute** contrainte nommée, pas seulement pour celles déjà rencontrées

*Contexte.* Deux exécutions de la routine ont livré `CRM-031` en parallèle, à partir du même commit
de spécification. Conformément à la **décision 66**, l'implémentation **déjà poussée fait foi** :
c'est elle qui est intégrée ici, et le travail parallèle est abandonné plutôt que fusionné. Il est
conservé localement sous `travail-crm031-parallele-um0mbt`, sans être poussé. Ce qui suit est le
seul **défaut réel** trouvé par l'exécution parallèle et absent de la version retenue — exactement
ce que la décision 66 prévoit de reporter.

*Problème.* Les douze contraintes nommées de `supabase/migrations/0006_workflows.sql` — cinq clés
étrangères composites et sept unicités — étaient posées en
`if not exists (select 1 from pg_constraint where conname = …)` : elles n'étaient créées que si le
**nom** était absent.

*Observation, produite par un harnais et non par une relecture.* L'exécution parallèle avait écrit
une dégradation que la version retenue ne portait pas : remplacer
`workflow_transitions_to_step_fkey` — clé **composite** `(to_step_id, workflow_id)` — par une clé
**simple** `(to_step_id)` du même nom, pour vérifier qu'une transition peut alors sortir de son
workflow. Elle le peut. Mais le contrôle suivant, celui de la restauration, a **échoué** :

```
ECHEC restauration incomplète :
  « FOREIGN KEY (to_step_id) REFERENCES workflow_steps(id) ON DELETE CASCADE/… »
```

La migration s'était réappliquée **sans erreur** et avait laissé la clé dégradée en place. La
garantie la plus structurante de l'unité — une transition ne sort pas de son workflow — était
perdue, et rien ne le signalait.

*Analyse.* C'est le défaut de la décision 57, à l'identique, pour la troisième fois. `CRM-020`
l'avait rencontré sur une contrainte `CHECK` et avait rendu convergentes les contraintes de valeur.
`CRM-021` l'avait rencontré sur une contrainte d'unicité de table (décision 64) et avait rendu
convergente cette contrainte-là. Chaque fois, la correction avait porté sur **la forme rencontrée**,
jamais sur la classe. Les clés étrangères sont la troisième forme, et il n'y avait aucune raison
d'attendre qu'un défaut les atteigne.

*Décision.* Un mécanisme unique, `app.migration_0006_converger_contrainte(table, nom, définition)`,
compare la définition réelle rendue par `pg_get_constraintdef` à la définition attendue et ne
reconstruit que si elles diffèrent. Les **douze** contraintes nommées du fichier passent par lui.
La dégradation qui a trouvé le défaut devient la dégradation **d** de
`scripts/verify-workflows.sh`, de sorte qu'il ne puisse pas revenir en silence.

*Conséquences.*

- La reconstruction reste **conditionnelle** : un `drop`/`add` inconditionnel revaliderait la table
  et reconstruirait l'index à chaque démarrage de la pile, ce qui n'est pas le prix négligeable
  d'une revalidation de `CHECK`.
- `search_path` vidé n'est pas ici une convention de style : `pg_get_constraintdef` rend les noms de
  relations **selon le `search_path`**, et avec un chemin vide il les rend pleinement qualifiés.
  Les deux côtés de la comparaison s'écrivent alors de la même façon. Sans cela, la comparaison est
  toujours fausse et la contrainte reconstruite à chaque démarrage — ce que le contrôle 2 du
  harnais, qui exige qu'un rejeu ne modifie aucune empreinte, aurait attrapé à son tour.
- La fonction est **retirée en fin de migration**. Laisser dans le schéma `app` une fonction capable
  de reconstruire n'importe quelle contrainte de n'importe quelle table en ferait une surface
  publique que rien ne documente.
- Les migrations `0003`, `0004` et `0005` portent le **même défaut** sur leurs propres clés
  étrangères et sur `tracks_id_workspace_id_key`. Elles ne sont pas corrigées ici : ce sont des
  livrables d'unités vérifiées, et les reprendre dans un commit consacré à une troisième unité
  irait contre `CLAUDE.md` §13. L'écart est ouvert en **INC-035**, avec ses options.

### Ce que l'intégration a coûté, et ce qu'elle a confirmé

L'implémentation retenue a été **rejouée intégralement sur ce socle** après intégration, comme la
décision 71 l'exige : la migration réappliquée, le seed rejoué, le harnais de l'unité et les treize
harnais précédents relancés. Sans quoi le vert mesuré ailleurs n'aurait rien prouvé ici.

Deux différences de détail méritent d'être notées, parce qu'elles ne sont **pas** des défauts :

- l'exécution parallèle avait réécrit l'assertion INC-029 de `supabase/tests/0005_channels.test.sql`
  en comptant les clés étrangères dont `workflow_id` est l'**unique** membre, ce qui serait resté
  **vert à tort** face à une clé composite. La version retenue la réécrit par **nom de
  contrainte** — plus simple, et sans ce piège. La leçon générale vaut d'être écrite : une
  assertion de figeage se relit en se demandant *quelle formulation resterait verte alors que la
  cause a disparu* ;
- les deux versions ont mesuré les mêmes faits sur les mêmes points, avec des comptes différents —
  106 contre 109 assertions pgTAP, 21 contre 20 scénarios d'API. Aucune des deux n'est plus
  complète que l'autre sur le fond.

### Un troisième obstacle d'environnement, nouveau

`npm run e2e:ui` **n'était pas exécutable** : les navigateurs préinstallés de l'environnement sont
une révision plus ancienne que celle qu'exige le Playwright épinglé par le dépôt, et les 37
scénarios échouent tous sur « Executable doesn't exist ». Contourné par une arborescence de
compatibilité **hors dépôt** — même nature qu'INC-032, et à refaire au prochain passage.
**INC-036** ouverte. Sans ce geste, aucune preuve d'interface du projet n'est exécutable, y compris
celles qui n'ont rien à voir avec l'unité en cours.

---

## 2026-08-04 — Le comptage de pgTAP, élucidé, et le faux vert qu'il cachait dans l'exécuteur

Cette exécution de la routine a livré `CRM-031` **en parallèle** de deux autres. L'implémentation
poussée la première fait foi (décision 66), et le travail parallèle n'est pas poussé : le rejeu de
`scripts/verify-workflows.sh` et des sept suites pgTAP sur le socle retenu est vert, l'unité est
livrée, la refaire ne prouverait rien.

Reste ce que ce passage a trouvé et que le socle retenu ne porte pas. La décision 76 avait mesuré
qu'une suite pgTAP pouvait émettre plus de lignes qu'elle n'en comptait, et refermait sur un aveu :
« Les suites `0002`, `0004`, `0005` et `0006` emploient toujours des savepoints et restent vertes,
plan tenu. **La différence n'a pas été élucidée.** » Elle l'est ici, et elle cachait pire qu'un
compte faux.

### Décision 79 — L'écart de comptage tient à la **position** du dernier `rollback`, et il rend l'exécuteur faussement vert

**La différence, mesurée sur trois lignes.** Ce n'est pas la présence de savepoints qui décale le
compte, c'est le fait que la **dernière** assertion soit prise dans un savepoint annulé :

```sql
select plan(3);
select ok(true, 'hors savepoint');
savepoint s1;
select ok(true, 'dans le savepoint');
select ok(true, 'derniere assertion, dans le meme savepoint');
rollback to s1;
select * from finish();
```

Sortie : `ok 1`, `ok 2`, `ok 3`, puis `# Looks like you planned 3 tests but ran 1`. La numérotation
est portée par une séquence, que rien n'annule ; le compte relu par `finish()` vit dans une table,
que le `rollback` annule comme le reste. Toute assertion exécutée **après** le dernier `rollback`
remet les deux d'accord — et c'est précisément ce que font `0002`, `0004`, `0005` et `0006`, qui se
terminent toutes hors savepoint. La décision 76 avait vu l'effet sans voir la cause ; elle n'avait
rien supposé, et c'est ce qui rendait la reprise possible.

**Ce que cela cachait, et qui est plus grave que le compte.** `scripts/run-sql-tests.sh` compare le
plan annoncé au nombre de lignes **émises** (§3.2, contrôle 4). Sur la suite ci-dessus, il compare
`3` à `3`, ne trouve aucun `not ok`, et rend **`0`** — mesuré, et non déduit : le fichier a été
déposé dans `supabase/tests/`, l'exécuteur lancé, et il a affiché « 1 fichiers, 3 assertions, aucune
anomalie ».

L'exécuteur déclarait donc verte une suite que pgTAP déclarait tronquée, et dont les **deux
dernières preuves n'avaient pas été enregistrées**. C'est exactement le mode de défaillance que le
§3.1 énumère depuis `CRM-008` — « une commande qui rend `0` sans rien avoir exercé est pire qu'une
commande absente » — et il visait cette fois l'exécuteur lui-même. Le contrôle 4 mesure ce que le
harnais a **vu passer** ; il ne mesure pas ce que pgTAP a **retenu**.

**Décision.** Un **cinquième contrôle** est ajouté au contrat du §3.2 : tout diagnostic de plan émis
par pgTAP — une ligne `# Looks like you planned` — fait échouer le fichier, la ligne étant
reproduite. Il est indépendant du contrôle 4 et ne le double pas : l'un compare le plan aux lignes
émises, l'autre au compte enregistré, et les deux divergent dès qu'un `rollback to savepoint`
intervient après la dernière assertion.

Le §3.2 porte de plus la contrainte d'écriture qui en découle : **une suite se termine hors
savepoint**, par une assertion de fond et non par une assertion ajoutée pour le compte. La
formulation compte — une suite qui finit dans un savepoint annulé n'a pas seulement un compte faux,
elle a des preuves finales que personne n'a enregistrées.

**Ce que cette décision ne fait pas.** Elle ne touche à aucune suite livrée : les sept sont vertes,
plan tenu, et aucune n'émet de diagnostic — vérifié fichier par fichier avant d'écrire cette entrée.
Le contrôle ajouté ne corrige donc rien aujourd'hui ; il empêche demain un vert qui ne vaudrait
rien.

## 2026-08-04 — `CRM-032` : spécification de la copie vers un track, écrite après mesure et avant tout code

Le §4 de `docs/SPEC-workflow-engine.md` tenait en vingt-cinq lignes et datait de `CRM-000`. Il
donnait une signature — `copy_workflow_to_track(workflow_id, track_id)` —, une intention — « la
copie est une divergence assumée » — et une phrase d'interface — « ce workflow dérive de *X*,
modifié depuis le *jj/mm/aaaa* ». Il ne disait ni qui a le droit de copier, ni ce qu'un refus rend,
ni ce qui arrive à `is_default`, ni comment une arête retrouve ses deux extrémités dans la copie, ni
d'où sortirait la date du « modifié depuis ».

Il a été **réécrit après mesure** : l'algorithme de copie appliqué à la main sur la pile réelle dans
une transaction annulée, et les codes HTTP relevés contre PostgREST au moyen de trois fonctions
sondes et d'une vue sonde, créées puis détruites — l'absence de reste étant constatée (`pg_proc`
vide de toute fonction `sonde*`, `to_regclass` nul sur la vue, aucun workspace de sonde restant).

Ce qui suit est ce que la mesure a appris, et qui n'était pas déductible du texte d'origine.

### Décision 80 — Sur un objet neuf du schéma `public`, révoquer à `public` ne protège rien

**Fait mesuré, et contraire à l'attente.** Une fonction créée dans `public`, puis « protégée » par
`revoke all on function … from public` suivi d'un `grant execute … to authenticated`, a été appelée
**avec succès par la clé anonyme**. Le contrôle du privilège dans `pg_proc.proacl` explique
pourquoi : l'ACL portait `anon=X/postgres`, un droit accordé nommément, qu'un `revoke` visant
`public` ne touche pas.

L'origine est dans l'image : `pg_default_acl` contient, pour le schéma `public`, des
`ALTER DEFAULT PRIVILEGES` qui accordent à `anon`, `authenticated` et `service_role` l'exécution de
**toute** fonction nouvelle et **tous** les droits (`arwdDxtm`) de toute table, vue ou séquence
nouvelle. Vérifié sur une vue jetable : elle est née modifiable par les trois rôles.

**Décision.** Tout objet créé dans `public` par le produit est ouvert par un `revoke` **nommant les
rôles** — `revoke … from anon, authenticated` — avant tout `grant`. C'est ce que les migrations
faisaient déjà pour leurs tables ; la règle est étendue aux fonctions et aux vues, et elle est
écrite au §4.7 plutôt que reproduite de mémoire.

**Pourquoi cela n'avait pas été rencontré.** Les fonctions du produit vivent toutes dans le schéma
`app`, que l'API n'expose pas, et où le défaut d'ACL de l'image ne s'applique pas. `CRM-032` est la
première unité à créer une fonction et une vue **dans `public`**, parce qu'elles doivent être
appelables par le client.

**Conséquence.** Le harnais de l'unité ne se contente pas de constater les privilèges attendus : il
**dégrade** l'ACL de la fonction pour vérifier que l'anonyme y accède alors, et que la migration
répare. Un privilège correct par accident n'est pas un privilège.

### Décision 81 — Le `404` est atteignable, et il est écarté

**Fait mesuré.** Le tableau complet de ce que PostgREST `v14.12` fait des `SQLSTATE` levés par une
fonction : `P0001` → `400`, `P0002` → **`500`**, `42501` → `403`, `23505` → `409`. Le code le plus
naturel pour « rien ne correspond », `no_data_found`, est donc rendu comme une **erreur serveur** —
une donnée mal désignée par le client passerait pour une panne du produit.

Mesuré également : un `404` propre **est** atteignable. PostgREST reconnaît un `SQLSTATE`
conventionnel `PGRST` dont le `DETAIL` porte le statut voulu ; la sonde a rendu `404` avec le corps
JSON attendu.

**Décision.** Il est **écarté**. Une fonction SQL qui connaît les codes HTTP de son client cesse
d'être portable : elle n'est plus une règle métier, elle est une moitié de contrôleur web. Les
refus de `copy_workflow_to_track` emploient `P0001` — `400`, « votre argument ne désigne rien
d'utilisable » — et `42501` — `403`, « vous n'avez pas le droit ». Le `400` pour un identifiant
inconnu est défendable : du point de vue de l'API, l'appel est mal formé, pas la ressource absente.

**Ce que cela coûte, et qui est nommé :** un client ne peut pas distinguer les quatre refus par le
seul code HTTP. Il le peut par le **message**, qui est stable et fait partie du contrat (§4.3).

### Décision 82 — Un workflow d'un autre workspace rend « introuvable », jamais « interdit »

**Fait.** Deux refus se disputent le même appel : l'appelant n'est pas administrateur, ou le
workflow n'est pas le sien. L'ordre dans lequel ils sont évalués **change ce que l'appelant
apprend**.

**Décision.** La visibilité est vérifiée **avant** le rôle. Un workflow d'un autre workspace rend
`workflow_not_found`, exactement comme un identifiant inventé — répondre « interdit » confirmerait
son existence à quelqu'un qui n'a pas le droit de le savoir. Un membre non administrateur de son
**propre** workspace obtient en revanche `forbidden` : il lit ce workflow tous les jours, le lui
cacher ne protégerait rien et l'induirait en erreur.

C'est la transposition à une RPC de ce que les politiques `select` font déjà silencieusement : un
refus de lecture se manifeste par **zéro ligne**, jamais par une erreur (`docs/SPEC-permissions-rls.md`
§7).

### Décision 83 — Les arêtes sont remappées par le nœud, qui est la clé naturelle d'une étape

**Fait mesuré.** `(workflow_id, node_id)` est unique depuis `CRM-031` : dans un workflow donné, un
nœud désigne **une** étape et une seule. L'étape de la copie qui correspond à une étape de la source
est donc celle qui instancie le même nœud — aucune table de correspondance temporaire n'est
nécessaire, et la jointure tient en deux `join`.

Vérifié sur la sonde : **zéro** arête de la copie pointe vers une étape restée dans la source, les
trois transitions ayant retrouvé leurs deux extrémités.

**Deux faits mesurés au passage, qui décident du reste de la fonction :**

- copier `is_default` tel quel depuis un workflow par défaut est refusé en `23505`. Comme le
  workflow que l'on copie *est*, en pratique, le workflow par défaut, la colonne est **forcée à
  faux** ; sans cela la fonctionnalité échouerait sur son cas d'emploi principal ;
- les `position` fractionnaires sont conservées à l'identique — `1`, `2.5`, `3` donnent `1`, `2.5`,
  `3` —, le trigger d'attribution ne se déclenchant pas quand la valeur est fournie. Renuméroter la
  copie changerait l'ordre du board sans que personne ne l'ait demandé.

### Décision 84 — Le signalement de divergence est une vue, et son angle mort est mesuré plutôt que supposé

**Fait mesuré.** La phrase exigée par le §4.1 — « dérive de *X*, **modifié depuis** le
*jj/mm/aaaa* » — n'est pas calculable à partir des colonnes de `workflows` : modifier une étape ne
touche pas la ligne du workflow, donc son `updated_at` ne bouge pas. Il faut le plus récent
`updated_at` du workflow **et de sa composition**.

**Décision.** Une vue `public.workflow_derivations`, `security_invoker = true` — mesuré : un rôle
`anon` n'y voit aucune ligne là où le propriétaire en voit une, les politiques des tables
sous-jacentes s'appliquant bien à l'appelant. La vue expose la copie, son origine, `derived_at`,
`source_modified_at` et le booléen `source_modified_since_copy`.

**L'angle mort, mesuré et non corrigé.** Une **suppression** dans la source — une arête retirée —
ne modifie aucun `updated_at` : après suppression, `source_modified_since_copy` vaut toujours faux.
La source a pourtant divergé. Le corriger engage le schéma — stocker la composition au moment de la
copie, journaliser les suppressions, ou comparer les cardinalités —, ce qui dépasse cette unité.
Consigné en INC-038 avec ses trois options, **sans être résolu implicitement**.

**Second fait, plus bénin :** `now()` est constant sur toute la durée d'une transaction. Une
modification faite dans la même transaction que la copie ne diverge donc pas — et c'est correct :
au `commit`, la copie est à jour.

### Décision 85 — Une copie ne se copie pas

**Fait.** Le §4 d'origine ne parlait que de la copie d'un workflow *global*. Rien n'interdisait
techniquement de copier une copie.

**Décision.** Le contrôle 3 refuse un workflow de portée `track` — `workflow_not_global`. Une chaîne
de dérivations rendrait `derived_from_workflow_id` illisible sans parcourir tout l'arbre, et le
signalement de divergence devrait dire **lequel des ancêtres** a changé, question à laquelle la
spécification ne répond pas. L'interdire est réversible ; l'autoriser puis se raviser ne l'est pas,
les données existant alors déjà.

## 2026-08-04 — `CRM-032` : la copie livrée, et une porte que personne n'avait vue ouverte

L'unité est implémentée telle que le §4 l'annonçait : une fonction, une vue, sept étapes et dix
arêtes recopiées, un lignage renseigné, et un signal de divergence. Ce qui mérite d'être consigné
n'est pas cela — c'est ce que la mise en œuvre a trouvé, et qui n'était pas dans la spécification.

### Décision 86 — La porte de la décision 80 était réellement ouverte, et le harnais est ce qui l'y empêche de revenir

**Ce que la spécification annonçait**, et qui n'était encore qu'une mesure faite sur une sonde :
`revoke all … from public` ne retire pas un droit accordé nommément à `anon` par les privilèges par
défaut de l'image.

**Ce que l'implémentation a confirmé sur l'objet réel :** la fonction livrée, protégée par la seule
révocation visant `public`, aurait été **exécutable par la clé anonyme de la webapp** — donc par
n'importe qui, puisque cette clé est publique par construction. Une copie de workflow par un
visiteur anonyme n'aurait été arrêtée que par le contrôle explicite du §4.3, c'est-à-dire par une
ligne de PL/pgSQL et non par un privilège.

**Décision.** Le privilège est révoqué **en nommant `anon`**, et — c'est le point qui compte — le
harnais **rend le droit à `anon`** puis vérifie que le refus disparaît, avant de constater que le
rejeu de la migration le retire de nouveau. Un privilège correct par accident n'est pas un
privilège : sans cette dégradation, un `revoke` mal écrit resterait vert.

Le contrôle 2 du même harnais en tire une seconde conséquence : la migration est **convergente sur
un privilège**, et pas seulement sur une contrainte. C'est la quatrième forme du défaut de la
décision 57, et la première qui porte sur un droit plutôt que sur une structure.

### Décision 87 — Le refus d'écriture sur la vue ne vient pas d'où on l'attendait, et l'attente écrite a été révisée

**Fait mesuré.** Le §4.9 annonçait, ligne o, qu'un `PATCH` sur `workflow_derivations` serait
« refusé — aucun privilège d'écriture ». La mesure a rendu autre chose : `500`, `SQLSTATE 55000`,
« Views that do not select from a single table or view are not automatically updatable ».

PostgreSQL refuse la **réécriture** de la requête avant d'en arriver au contrôle du privilège. La
vue joint deux fois `workflows` ; elle n'est donc pas automatiquement modifiable, et le privilège
manquant n'a jamais l'occasion de servir.

**Décision.** L'attente du §4.9 est **corrigée d'après la mesure**, et non l'inverse. Les deux
verrous existent — l'absence de privilège est prouvée en base par pgTAP, la non-modifiabilité par
l'API —, et le §4.6 dit lequel parle en premier. Écrire « refusé, `403` » aurait été une prédiction
fausse maintenue par commodité.

### Décision 88 — Le seed traverse la garde plutôt que de la contourner, et paie l'identifiant stable

**Fait.** `copy_workflow_to_track` exige `app.is_workspace_admin`, qui lit `auth.uid()`. La clé de
service — celle qu'emploient toutes les autres sections du seed — n'a pas de `sub` : `auth.uid()` y
est nul, et l'appel est refusé par `workflow_not_found`.

Deux issues : ajouter à la fonction une dérogation pour `service_role`, ou faire **se connecter** le
seed.

**Décision.** Le seed se connecte, par la véritable route de connexion, avec le compte
administrateur qu'il vient lui-même de créer. Une dérogation dans la fonction aurait été une porte
ouverte pour le confort d'un script — exactement ce que la décision 86 vient de refermer ailleurs.

**Le prix, nommé plutôt que caché :** l'identifiant de la copie est frappé par la fonction, donc
**pas stable**, alors que `docs/SPEC-seed.md` §4 fait des identifiants stables un contrat. Le rendre
stable supposerait un quatrième paramètre ajouté pour le seul confort du seed — une API façonnée par
ses tests. La copie se retrouve par sa source et son track, et le §2.9 le dit explicitement pour que
personne ne cherche un `…052` qui n'existe pas.

**Conséquence assumée :** la convergence du seed ne peut plus venir d'un `upsert`. Elle vient d'une
vérification préalable — la copie existe-t-elle déjà sur ce track ? —, ce que le harnais mesure en
rejouant le seed et en comptant **une** copie, ni zéro ni deux.

### Ce que cette unité a fait tomber, et qui devait tomber

Quatre garde-fous posés par des unités précédentes ont échoué à la livraison, comme le mécanisme de
la décision 51 le prévoit : deux assertions de type de `CRM-006` — « aucune vue », « aucune fonction
appelable en RPC », vraies jusqu'à ce que cette unité livre les deux premières —, deux scénarios
d'API de `CRM-031` qui comptaient « un workflow, ni plus ni moins », et les compteurs du harnais.

Aucun n'a été supprimé. Les assertions de type sont **resserrées** sur ce qui est livré — une vue
nommée, une fonction nommée, sa signature exacte —, de sorte qu'un objet de plus les rende rouges à
nouveau. Les scénarios d'API comptent désormais « un workflow **global** » et « un seul par
défaut », qui est ce que `CRM-031` garantit réellement. Un garde-fou qu'on relâche au lieu de le
resserrer cesse d'en être un.

### Décision 89 — Un invariant gardé d'un seul côté n'est pas un invariant : la règle est défendue sur `channels` **et** sur `workflows`

**Fait mesuré.** Le §4.12 écrit à `CRM-000` nommait deux gestes à surveiller : affecter un workflow à
un channel, et déplacer un channel vers un autre track. Quatre écritures ont été appliquées sur la
base du seed, et les **quatre** ont été acceptées :

1. rattacher un channel de `studio-web` au workflow `track` de `conseil-ia` ;
2. déplacer vers `studio-web` un channel de `conseil-ia` qui suit le workflow `track` de `conseil-ia` ;
3. changer le `track_id` d'un workflow `track` **sous** les channels qui le suivent ;
4. faire passer le workflow **par défaut** de `global` à `track` sous ses six channels.

Les deux dernières ne passent pas par `channels`. Elles n'étaient nommées nulle part, et la quatrième
invalide d'un seul `UPDATE` le rattachement des six channels du seed.

**Décision.** `CRM-033` livre **deux** triggers : l'un sur `channels`, l'autre sur `workflows`. La
Definition of Done n'en demandait qu'un, et un seul aurait laissé la règle contournable par la table
qu'elle ne surveillait pas. Ce n'est pas un élargissement de périmètre : c'est la condition pour que
la règle énoncée — « toute autre valeur est refusée » — soit vraie.

**Conséquence.** Le trigger de `workflows` ne refuse que ce qui **casse un rattachement existant** :
un workflow `track` sans channel change de track librement. La règle protège des rattachements, pas
des workflows — et le dire évite qu'on lui prête plus tard une intention qu'elle n'a pas.

### Décision 90 — Le refus d'incompatibilité est une violation de contrainte, et il en porte le code

**Fait mesuré, sur un trigger sonde posé sur `channels` puis détruit.** `raise exception … using
errcode = '23514'` est rendu par PostgREST en **`400`**, corps JSON conservé, `code` et `message`
transmis tels quels. Un workflow **introuvable** rend en revanche `409` / `23503`, la clé étrangère
composite de `CRM-031` nommant elle-même la contrainte et la table.

**Décision.** Le refus d'incompatibilité emploie `23514` — `check_violation` — et non le `P0001` que
le §4.4 avait retenu pour la RPC de `CRM-032`. Les deux rendent `400` ; `23514` dit en outre de
quelle **nature** est le refus. Un client qui trie ses erreurs par famille range alors
`workflow_hors_track` avec `channels_name_check` et `channels_slug_check`, ce qu'il est : une règle
d'intégrité, pas une règle applicative.

**Et le trigger se tait lorsque le workflow est introuvable.** Une clé étrangère est vérifiée **après**
les triggers `BEFORE` : le trigger voit alors une ligne dont il ne peut rien dire. Il rend la main
plutôt que d'inventer un refus moins précis que celui que la base rendra de toute façon.

### Décision 91 — `NOT NULL` est posée, et aucun défaut de colonne ne vient l'adoucir

**Fait.** `docs/SCHEMA.md` §2 décrit `channels.workflow_id` comme non nulle depuis l'origine.
`CRM-021` ne pouvait pas la poser — `workflows` n'existait pas —, `CRM-031` s'y est refusée parce
qu'elle change le contrat de création d'un channel. INC-029 la porte depuis trois unités.

**Mesuré :** `select count(*) from public.channels where workflow_id is null` rend `0`. Aucune reprise
de données n'est nécessaire.

**Décision.** La contrainte est posée par `CRM-033`. Créer un channel exige désormais de désigner un
workflow, et **aucun défaut de colonne n'est ajouté** : rattacher automatiquement le channel neuf au
workflow par défaut du workspace serait commode et faux. Un workspace peut n'avoir aucun workflow par
défaut — le §3.2 dit « au plus un », jamais « exactement un » —, et un défaut silencieux
transformerait une omission du client en un choix qu'il n'a pas fait.

**Conséquence assumée sur le seed.** Le workflow par défaut doit naître **avant** les channels. Sa
ligne ne dépend d'aucun nœud du catalogue — seules ses étapes en dépendent —, si bien que la section
se scinde : la ligne d'abord, ses étapes et ses transitions après le catalogue. Le `PATCH` de
rattachement que `CRM-031` avait posé en fin de section disparaît, les channels naissant rattachés.

## 2026-08-04 — `CRM-035` : l'unité suivante n'était pas celle du plan, et la mesure l'a dit

### Décision 92 — `CRM-034` n'est pas commencée : sa garde n'a aucune cible, et rien n'en est livrable

**Fait mesuré**, sur la base du seed, la pile en marche :

```
cards=NULL   card_events=NULL   card_comments=NULL   card_field_values=NULL
form_fields=NULL   form_field_rules=NULL   move_card=NULL
```

`docs/MASTER_PLAN.md` §2 place `CRM-034` avant les cards, et le justifie ainsi : « le moteur de
workflow avant les cards, car une card naît dans une étape ». Le raisonnement est juste pour
`CRM-030` à `CRM-033`, qui décrivent le **graphe**. Il s'inverse pour `CRM-034`, dont les six
vérifications du §5 ne portent sur rien d'autre que des **cards** : leur existence, le droit
d'écriture sur leur channel, leur étape courante, leur commentaire, leurs valeurs de champs.

**Décision.** `CRM-034` reste `[ ]`, non commencée. Aucune table n'est créée par anticipation : la
commencer exigerait de préempter `CRM-040`, `CRM-043`, `CRM-044` **et** `CRM-036` dans le même
geste. Le passage prend l'unité `[ ]` suivante que l'ordre du plan n'interdit pas — `CRM-035`, dont
les deux tables ne dépendent que de `workflows` et de `workflow_steps`, toutes deux livrées.

**Pourquoi ce n'est pas un contournement de l'ordre.** Les trois contraintes d'ordre que
`docs/MASTER_PLAN.md` §2 énonce sur ces unités — « `CRM-034` avant `CRM-041` », « `CRM-036` avant
`CRM-037` », « `CRM-004` avant `CRM-052` » — restent toutes vraies après ce passage. L'ordre
**détaillé** du tableau est une justification, pas une contrainte ; les contraintes sont listées
séparément, et aucune n'est enfreinte.

**Conséquence.** INC-043 est ouverte, avec trois options d'arbitrage. Elle n'est pas résolue ici :
déplacer `CRM-034` dans le plan serait une décision de planification, qui appartient au responsable.

### Décision 93 — Un champ appartient à son workflow, et la copie vers un track n'en hérite pas — l'écart est compté, pas corrigé

**Fait.** `docs/SCHEMA.md` §4 donne à `form_fields` une colonne `workflow_id` et aucune colonne
`channel_id`. `docs/SPEC-form-composer.md` §2 en tire que deux channels partageant un workflow
partagent son formulaire — et ajoutait, entre parenthèses, « la copie duplique aussi les champs ».

`copy_workflow_to_track`, livrée par `CRM-032`, ne copie aucun champ : elle a été écrite quand la
table n'existait pas, et INC-037 le disait déjà en prévoyant les deux branches possibles.

**Mesuré après ce passage :** la copie posée par le seed porte **zéro** champ là où sa source en
porte **sept**.

**Décision.** Le comportement de `copy_workflow_to_track` reste **inchangé**. Trois motifs, dans cet
ordre :

1. INC-037 réserve explicitement l'arbitrage au responsable, avec trois options — rattacher la copie
   des champs à `CRM-035`, laisser `CRM-032` partiellement due, ou créer une unité de reprise. En
   choisir une reviendrait à trancher à sa place, ce que `CRM-031` a refusé pour INC-031 et
   `CRM-020` pour INC-024 ;
2. la corriger rouvrirait `CRM-032` — sa fonction, sa suite pgTAP, ses quinze scénarios d'API, son
   harnais — dans un commit consacré à `CRM-035`, ce que `CLAUDE.md` §13 interdit ;
3. l'écart n'est pas silencieux : il est **compté** par trois assertions révisées plutôt que
   retirées.

**Conséquence assumée.** Un channel qui suivrait la copie afficherait un formulaire vide. Aucun ne
le fait dans le seed — `prospection` suit la copie, et la démonstration du formulaire porte sur le
workflow global. C'est une limite du produit, nommée dans `docs/BACKLOG.md`, dans
`docs/SPEC-form-composer.md` §2.10 et dans son point ouvert n° 3.

### Décision 94 — `select` sans choix et `money` sans devise sont refusés par la base, et l'éditeur en paie le prix

**Fait.** `docs/SPEC-form-composer.md` §2.3 dit « liste de choix définie dans `options` » pour
`select` et `multiselect`, et « `money` avec devise » pour `money`. Rien n'obligeait la base à le
tenir : `options` est un `jsonb` dont le défaut est `{}`.

**Décision.** Deux contraintes `CHECK` posent ces deux exigences. Un `select` sans `choices` non vide
et un `money` sans `currency` conforme à `^[A-Z]{3}$` sont refusés à l'écriture.

**Prix payé, et assumé :** un champ `select` naît avec au moins un choix. On ne peut pas créer la
question puis ses réponses en deux gestes. C'est peu — les deux écritures partent du même écran — et
cela garantit qu'aucun formulaire rendu ne comporte de liste vide, c'est-à-dire d'impasse.

**Ce que la base ne tient pas, et pourquoi c'est dit plutôt que tu.** La forme de chaque entrée de
`choices` — `{key, label}` — et l'unicité des clés de choix ne sont **pas** contraintes : un `CHECK`
ne peut porter aucune sous-requête, et déplier un tableau `jsonb` dans une contrainte exigerait une
fonction dont l'immutabilité serait à démontrer. La vérification appartient donc au rendu
(`CRM-037`) et à la validation des valeurs (`CRM-036`), seul endroit où une clé de choix inconnue
produit une conséquence.

### Décision 95 — La règle porte le workflow, et c'est lui qui rend le croisement impossible

**Fait mesuré, sur sonde créée puis détruite.** Une table de règles portant `(field_id, step_id)`
sans `workflow_id` ne peut exprimer aucune appartenance commune : rien n'empêche une règle de lier
un champ du workflow A à une étape du workflow B, et seul un trigger la rattraperait.

**Décision.** `form_field_rules` porte `workflow_id`, et deux clés étrangères **composites** —
`(field_id, workflow_id)` et `(step_id, workflow_id)` — le prennent pour charnière.

**Mesuré, dans les deux sens** : la règle croisée est refusée quel que soit le `workflow_id`
déclaré. Avec celui du champ, c'est la clé des étapes qui parle (`23503`, « Key (step_id,
workflow_id)=… is not present in table "workflow_steps" ») ; avec celui de l'étape, c'est celle des
champs. Une des deux clés attrape toujours l'erreur — il n'y a pas de troisième valeur à essayer.

**Mesuré également** : l'unicité `(id, workflow_id)` sur `form_fields` est la **condition** de cette
clé. Sans elle, la création de la table échoue en `42830`, « there is no unique constraint matching
given keys for referenced table ». C'est le même geste que `workflows_id_workspace_id_key` et
`workflow_steps_id_workflow_id_key`, pour la troisième fois.

### Décision 96 — Un champ archivé garde sa clé, et le produit n'expose aucune suppression de champ

**Fait.** `docs/SPEC-form-composer.md` §5 dit que l'archivage d'un champ le retire des formulaires
« sans supprimer les valeurs déjà saisies ».

**Décision.** L'unicité de `key` est **totale par workflow**, et non partielle sur les champs
actifs : un champ archivé garde sa clé réservée. Et aucun privilège `DELETE` n'est accordé sur
`form_fields`, ni aucune politique `for delete` écrite — le refus est double, comme pour les
workflows, les tracks, les channels et le catalogue.

**Motif.** Les valeurs survivent à l'archivage. Réattribuer la clé d'un champ archivé à un champ neuf
rendrait un export ambigu — deux questions différentes sous la même colonne — sans qu'aucune erreur
ne le signale. Et supprimer physiquement un champ effacerait les valeurs par cascade.

**Asymétrie assumée sur les règles.** `form_field_rules` n'a pas d'`archived_at` et sa suppression
**est** ouverte aux administrateurs : une règle est la composition d'un formulaire, pas un objet à
durée de vie propre. Un éditeur qui ne peut pas retirer une règle ne peut pas éditer. C'est
exactement la décision 74, appliquée une seconde fois.

### Décision 97 — `require_fields` peut désormais désigner des champs réels, et le seed n'en désigne aucun

**Fait.** `workflow_transitions.require_fields` est un `uuid[]` qui ne porte aucune intégrité
référentielle et n'en portera jamais — INC-033, propriété du type. Jusqu'ici il était vide pour une
autre raison : `form_fields` n'existait pas.

**Décision.** Il reste vide. Le motif change, et il est réécrit dans le seed plutôt que laissé
périmé : aucune garde ne lit ce tableau — `move_card` est `CRM-034`, non commencée (décision 92).
Une donnée de démonstration que rien n'exerce est une décoration, pas une preuve, et elle serait la
première à pourrir puisque rien ne protège le tableau d'un identifiant supprimé.

**Ce que cela laisse dû :** l'union « champs `required` de l'étape cible + `require_fields` de la
transition » du §3.5 reste sans donnée de démonstration jusqu'à `CRM-034`.

## 2026-08-04 — `./runDev.sh` sur un poste WSL : quatre causes d'échec, aucune dans le code métier

Le responsable signale que `./runDev.sh` ne démarre pas sur son poste, alors que la même commande
tourne dans le conteneur d'intégration. Aucune des quatre causes trouvées n'appartient au métier :
toutes tiennent à ce que le dépôt suppose de l'hôte sans jamais le vérifier. Elles sont consignées
ici parce qu'elles se ressemblent — le dépôt tient pour acquis un environnement qui n'est pas celui
de l'exécution — et parce que chacune est désormais gardée plutôt que subie.

### Décision 98 — Le magasin d'identifiants Docker de Windows échoue en rafale, et la pile n'en a aucun besoin

**Le symptôme.** `./runDev.sh` s'arrête pendant le tirage des images, sur :

    error getting credentials - err: exit status 1, out: ``

**La mesure.** `~/.docker/config.json` du poste vaut `{"auths":{},"credsStore":"desktop.exe"}`.
Chaque interrogation du registre passe donc par un binaire Windows, joint par l'interopérabilité
WSL. Appelé seul, il répond correctement — `credentials not found in native keychain` sur la sortie
standard, code 1, que le client Docker sait interpréter comme « aucun identifiant » et non comme une
panne. Appelé en rafale, il rend **une sortie vide** : sur 150 appels simultanés, **52** n'ont rien
écrit. Compose tirant ses images en parallèle, le client lit cette sortie vide comme une erreur et
abandonne. Le journal du noyau accompagne les échecs de `WSL … ERROR: UtilAcceptVsock:273: accept4
failed 110`.

**Ce qui a été écarté.** Un `docker login`, qui ne résout rien puisque `auths` est vide et que la
pile n'emploie que des images publiques. Une réécriture du fichier du poste, qui déborde du dépôt.
Une sérialisation des tirages, qui ralentirait tout le monde pour un défaut d'un seul hôte.

**Décision.** `require_docker` dérive une configuration Docker **privée des assistants `.exe`**, et
n'exporte `DOCKER_CONFIG` que s'il y avait effectivement quelque chose à écarter. Tout le reste de
la configuration du poste — contexte courant, proxies, greffons — est **recopié ou lié tel quel** :
sans les contextes, un `currentContext` désignerait un démon introuvable, et la commande viserait
un autre moteur que celui de l'utilisateur. Un assistant qui n'est pas un `.exe` est conservé.

**Conséquence assumée.** Les tirages deviennent anonymes sur cet hôte. C'était déjà le cas — le
magasin ne contenait aucun identifiant — et les images de la pile sont publiques. Le répertoire
dérivé vit **hors du dépôt**, sous `${XDG_STATE_HOME:-~/.local/state}/p2enjoy-crm/docker` : il
recopie une configuration qui peut porter des identifiants, et rien de tel n'a sa place dans un
arbre versionné. Sur un hôte sans assistant Windows — le conteneur d'intégration —, la garde ne
fait rien, ce qui explique que le défaut n'y soit jamais apparu.

### Décision 99 — Un port déjà pris se dit avant le démarrage, et nomme la variable — jamais un port choisi à la place de l'opérateur

**La mesure.** Le poste héberge la pile Supabase d'un autre dépôt. Quatre des dix ports publiés par
l'assemblage de développement étaient tenus : `54322`, `54323`, `54324` par cette pile, `5173` par
un serveur Vite hors Docker. Compose ne s'en aperçoit qu'au moment de créer le conteneur concerné :
la moitié de la pile était déjà démarrée, et le démon ne rendait qu'un numéro de port, sans dire à
qui il appartenait ni quelle variable le portait.

**Décision.** `require_free_ports` s'exécute avant tout démarrage, et nomme le port, son détenteur
et la variable du fichier d'environnement à changer. La liste des ports vient de `docker compose
config`, donc de l'assemblage lui-même : elle ne peut pas diverger des fichiers Compose.

**Ce qui a été écarté.** Choisir un port libre à la place de l'opérateur. Les URL documentées,
`verify-stack.sh` et les preuves d'interface en dépendent ; un port choisi en silence rendrait le
`README` faux sans que personne ne le sache.

**Deux exactitudes qui ont coûté une mesure chacune.** Les ports tenus par la pile elle-même sont
ignorés, sans quoi relancer une pile en marche serait refusé — et Docker annonce ses plages sous la
forme `127.0.0.1:9000-9001->9000-9001/tcp`, si bien qu'une recherche de `:9000->` faisait passer
MinIO pour un intrus. Les plages sont donc développées port par port. Enfin, `runDev.sh --dev`
écarte explicitement le port de la webapp : cette option existe précisément parce qu'un Vite de
l'IDE le tient déjà.

**Conséquence pour ce poste.** Les quatre valeurs ont été changées dans le `.env` local — fichier
propre au poste, non versionné — et non dans `.env.example`, dont les valeurs par défaut restent le
contrat du dépôt.

### Décision 100 — Un contrôle de santé nomme une famille d'adresses, jamais « localhost »

**La mesure.** La pile démarrait entièrement, puis échouait sur `container p2enjoy-storage is
unhealthy`. Le service, lui, allait bien : ses journaux annoncent `Server listening at
http://127.0.0.1:5000`. Son contrôle de santé interrogeait `http://localhost:5000/status`, et le
`/etc/hosts` du conteneur résout `localhost` en `127.0.0.1` **et** en `::1`. Sur cet hôte, la
résolution rend `::1` en premier ; le service n'écoutant qu'en IPv4, le contrôle recevait un refus
de connexion. Mesuré dans le conteneur : `wget http://127.0.0.1:5000/status` réussit, `wget
http://localhost:5000/status` échoue.

**Décision.** Le contrôle de santé de `storage` vise `127.0.0.1`. Les autres contrôles de la pile
sont laissés en l'état : ils sont mesurés sains sur cet hôte, et les modifier sans défaut constaté
reviendrait à changer ce que l'on ne sait pas éprouver.

### Décision 101 — Ce que la pile crée sur l'hôte doit appartenir à l'hôte

**Deux faits de même nature, trouvés à quelques minutes d'écart.**

`./resetMe.sh` échoue sur `rm: cannot remove '…/volumes/db/data': Permission denied`. PostgreSQL
crée son cluster sous son propre compte et referme le répertoire en `0750` : le compte de
l'utilisateur ne peut même pas y descendre.

`./runDev.sh` laisse un `node_modules` **appartenant à `root`** à la racine du dépôt. Le service
`webapp` monte un volume nommé sur `/app/node_modules`, chemin situé à l'intérieur du dépôt lui-même
monté en `/app` ; le répertoire n'existant pas sur l'hôte, c'est le démon qui le crée, donc `root`.
`npm install` échouait ensuite en `EACCES` **dans le dépôt de l'utilisateur**, et c'est ce qui
faisait échouer cinq preuves — `verify-tracks`, `verify-channels`, `verify-catalogue`,
`verify-workflows`, `verify-copie-workflow` — pour une raison qui n'avait rien à voir avec elles.

**Décision.** Aucun `sudo` n'est demandé. La destruction du cluster est confiée à un conteneur
jetable, qui a les droits que l'hôte n'a pas, et dont l'image est **lue dans l'assemblage** plutôt
que nommée une seconde fois. Le point de montage `node_modules` est créé par les scripts avant
Compose, ce qui le laisse à son propriétaire légitime. Les deux gardes sont inutiles là où le démon
et l'utilisateur partagent le même compte — le conteneur d'intégration —, ce qui explique une fois
de plus que rien n'y ait jamais été visible.

## 2026-08-04 — `CRM-035`, suite : un défaut trouvé par les preuves de l'unité elle-même

Le numéro de cette décision n'est pas contigu à celles de `CRM-035` — 92 à 97 : une autre
exécution de la routine a livré les décisions 98 à 101 pendant ce passage, et la
renumérotation a porté sur la plus récente. Le fait est consigné plutôt que masqué : deux
exécutions parallèles peuvent réclamer le même numéro, et c'est la seconde arrivée qui cède.

### Décision 102 — Un `CHECK` qui rend `NULL` passe : les deux contraintes d'options ne refusaient rien

**Défaut réel, trouvé par la suite pgTAP de cette unité, corrigé dans le même changement.**

Les deux contraintes de la décision 94 étaient écrites ainsi :

```sql
check (type not in ('select','multiselect')
       or (jsonb_typeof(options -> 'choices') = 'array'
           and jsonb_array_length(options -> 'choices') > 0))
check (type <> 'money' or (options ->> 'currency') ~ '^[A-Z]{3}$')
```

**Mesuré** : elles refusaient `{"choices": []}` et laissaient passer l'**absence pure** — qui est
pourtant le cas à refuser en premier, `{}` étant le **défaut de la colonne**.

```
not ok 23 - un `select` sans `choices` est refusé
#       caught: no exception
#       wanted: 23514
```

La cause est la logique ternaire de SQL : `options -> 'choices'` rend `NULL` quand la clé est
absente, `jsonb_typeof(NULL)` rend `NULL`, la conjonction rend `NULL`, `false or NULL` rend `NULL`
— et **un `CHECK` qui rend `NULL` accepte la ligne**. Même chaîne pour `->>` et l'expression
régulière.

**Décision.** Les deux expressions sont enveloppées dans un `coalesce(…, false)`. Le contrat écrit
au §2.4 devient celui que la base tient réellement.

**Et `jsonb_array_length` disparaît**, pour une seconde raison découverte en corrigeant la
première : cette fonction **lève une erreur** sur un scalaire — « cannot get array length of a
scalar » —, et l'ordre d'évaluation d'un `AND` n'est pas garanti en SQL. Un `CHECK` ne doit jamais
pouvoir échouer autrement qu'en refusant la ligne. La comparaison `options -> 'choices' <> '[]'`
n'a pas ce défaut.

**Ce que cela enseigne au-delà de cette unité.** Les contraintes déjà livrées de la forme
`colonne is null or …` sont saines : le `is null` est explicite. Le piège ne se referme que sur
une expression qui **traverse** un accès `jsonb` ou une colonne nullable sans le dire. Deux
contraintes du dépôt sont dans ce cas et ont été relues : `workflow_steps_probability_check` et
`workflow_nodes_catalog_*`, toutes deux protégées par un `is null` explicite. Aucune autre
correction n'était due.

**Ce qui protège l'écart :** les deux cas — clé absente **et** liste vide — sont désormais deux
assertions distinctes de `supabase/tests/0010_champs_formulaire.test.sql`. La première seule aurait
laissé passer le défaut ; c'est elle qui l'a trouvé.

---

## 2026-08-04 — `CRM-012` : les droits fins deviennent opposables, et INC-013 s'éteint pour trois fonctions sur quatre

### Choix de l'unité — pourquoi `CRM-012`, et pourquoi maintenant

`docs/MASTER_PLAN.md` §2 place `CRM-012` en tête des unités `[ ]`, au chunk 2.b. Quatre exécutions
de la routine l'ont examinée puis écartée — `CRM-005`, `CRM-020`, `CRM-021`, `CRM-030` — et chacune
a nommé le même motif : INC-013 exige un arbitrage « **avant `CRM-012`** », et deux de ses trois
options concernent des tables qui n'existaient pas.

Ce motif est éteint, et il l'est par les faits, non par lassitude :

- `tracks` existe depuis `CRM-020`, `channels` depuis `CRM-021`. Des quatre fonctions différées,
  trois ont désormais une table où aller ; seule `app.can_read_card` n'en a pas ;
- l'option 1 d'INC-013 — « rattacher chaque fonction à l'unité qui livre sa table » — proposait
  `can_read_track` à `CRM-020` et les deux fonctions de channel à `CRM-021`. Ces deux unités sont
  livrées. Y verser aujourd'hui une fonction écrite après elles rouvrirait leur périmètre, ce que
  `CLAUDE.md` §13 refuse.

Reste la lecture littérale de l'unité : `CRM-012` s'intitule « droits fins par track et channel »,
et sa Definition of Done demande « pgTAP sur la matrice de résolution » et les preuves de refus
n° 3 et n° 4. Aucune de ces deux exigences n'est satisfaisable sans les trois fonctions. Les
écrire ici n'invente pas une quatrième option : c'est ce que l'unité demande depuis le premier
jour.

**Ce que ce passage ne tranche pas, et le dit.** Deux points d'INC-013 restent ouverts —
`app.can_read_card`, et la Definition of Done de `CRM-010` qui nomme six fonctions dont quatre lui
échappent. L'entrée reste **ouverte** pour eux. Et INC-014 — les politiques des tables d'identité —
n'est pas davantage tranchée : `profiles`, `workspaces` et `workspace_members` restent en refus par
défaut. Se les attribuer aurait été confortable, l'unité touchant déjà aux politiques ; c'eût été
décider à la place du responsable.

### Décision 103 — Trois fonctions `can_*` sont écrites, la quatrième reste différée pour la raison d'origine

**Problème.** INC-013 réservait l'écriture des quatre fonctions à un arbitrage jamais rendu, la
routine s'exécutant sans personne devant l'écran.

**Ce qui a été mesuré avant de décider.** Sur la pile réellement démarrée, avec les données du
seed :

- une fonction candidate `can_read_track` appelée sur un track **inexistant** rend `NULL`, non
  `false` — le `where` ne rend aucune ligne ;
- adossée à cette fonction en `SECURITY DEFINER`, la politique de lecture de `tracks` répond avec
  le filtrage attendu, **alors même que la fonction lit `tracks`** ; la jumelle `SECURITY INVOKER`
  épuise la pile d'appels. Seconde occurrence de la décision 27 ;
- la matrice se comporte comme le §2.2 la décrit : `viewer` + `track_members = 'none'` → refus ;
  `admin` + le même droit fin → accès ; `channel_members = 'member'` sous un track fermé →
  **écriture**, la règle la plus spécifique rouvrant ce que la moins spécifique ferme.

**Décision.** `app.can_read_track`, `app.can_read_channel` et `app.can_write_channel` sont livrées
par `CRM-012`, en `SECURITY DEFINER`, `search_path` vide, résultat enveloppé dans
`coalesce(…, false)`. `app.can_read_card` n'est **pas** écrite : `cards` n'existe pas, et une
fonction qui référence une table absente échouerait au premier appel sans qu'aucune preuve puisse
être produite. Le motif d'origine d'INC-013 vaut encore pour elle, et pour elle seule.

**Conséquence assumée.** Les assertions `hasnt_function` de `supabase/tests/0002_...` deviennent
rouges pour trois des quatre fonctions. Elles ne sont pas retirées : elles sont **converties** en
`has_function` avec le contrôle de leur volatilité, de leur `search_path` et de leurs privilèges.
C'est ce que la décision 51 attendait d'elles — forcer la révision, non disparaître avec la cause.

### Décision 104 — Les jointures des fonctions `can_*` sont externes, et l'inverse eût été le refus par défaut

**Problème.** `app.resolve_access` distingue strictement `NULL` — « aucun avis à ce niveau » — de
`'none'` — « accès explicitement fermé ». Cette distinction ne survit que si la lecture de la ligne
de droit fin rend `NULL` en son absence.

**Ce qui aurait été faux.** Une jointure interne entre `tracks` et `track_members` ne rend **aucune
ligne** lorsque l'appelant n'a pas de droit fin — c'est-à-dire dans le cas de très loin le plus
courant. La fonction rendrait `NULL`, la politique refuserait, et tout membre du workspace perdrait
l'accès à tout ce sur quoi personne ne lui a rien accordé. Le produit serait fermé par défaut là où
la spécification le veut **hérité** par défaut.

**Décision.** Les deux jointures — `track_members` et `channel_members` — sont des `left join`
portant `user_id = auth.uid()` **dans la condition de jointure**, jamais dans le `where`. Un
`where tm.user_id = auth.uid()` aurait annulé l'effet du `left join` et reproduit exactement le
défaut décrit ci-dessus. Les deux cas — avec et sans droit fin — sont **deux assertions
distinctes** de la suite pgTAP, et non une seule : la seconde seule aurait été verte avec une
jointure interne.

### Décision 105 — Un droit fin se lit par l'administration et par l'intéressé, et se supprime

**Problème.** `docs/SPEC-permissions-rls.md` §4 ne nommait aucune politique pour `track_members` et
`channel_members` (INC-045). Les deux tables étaient donc en refus par défaut depuis `CRM-003` :
`CRM-012` allait rendre les droits fins opposables sans que quiconque puisse en poser un depuis le
produit.

**Décision, écrite au §4.1 avant le code.** Lecture par l'administrateur du workspace propriétaire
**et** par l'utilisateur concerné pour sa propre ligne ; insertion, mise à jour et **suppression**
réservées à l'administrateur.

Trois motifs, dont deux se discutent :

- **la lecture n'est pas ouverte au workspace.** Savoir qui est écarté de quel channel est une
  donnée d'administration. L'intéressé y a droit — une restriction invisible à celui qui la subit
  est une mauvaise règle — mais un `viewer` n'a pas à connaître les restrictions de ses collègues.
  Le choix est **réversible** et soumis à arbitrage en INC-045 ;
- **la suppression est exposée**, contrairement aux tracks et aux channels. Ces tables n'ont pas
  d'`archived_at`, et retirer un droit fin n'est pas supprimer une donnée métier : c'est revenir à
  l'accès hérité, l'état par défaut du §2.2. Un archivage obligerait `app.resolve_access` à
  distinguer « aucune ligne » de « ligne archivée », deux états qu'elle traite — et doit traiter —
  identiquement. Même raisonnement que la décision 96 ;
- **un administrateur peut porter un droit fin restrictif, et cela ne l'atteint pas.** La règle
  « un administrateur n'est jamais restreint » vaut à la résolution, pas à l'écriture. La ligne est
  acceptée, stockée, et redevient opposante le jour où ce compte cesse d'être administrateur. MESURÉ.

**Ce que ces politiques ont coûté à INC-011.** `track_members` ne porte pas `workspace_id` : sa
politique ne peut pas filtrer par workspace directement et doit remonter par `tracks`. D'où deux
fonctions d'appui, `app.track_workspace` et `app.channel_workspace`, en `SECURITY DEFINER` pour la
même raison qu'au §3.3 — sans quoi `track_members` interrogerait `tracks`, dont la politique
interroge `track_members`. MESURÉ : aucune récursion, les deux tables restent lisibles avec le
filtrage attendu. L'écart d'INC-011 n'est pas résolu ; il est **payé**, et le prix est nommé.

### Décision 106 — Un refus de suppression ne lève aucune erreur, et la preuve a dû changer de forme

**Le défaut, trouvé par les preuves de l'unité elle-même.** Le §4.1 écrit avant le code annonçait
une politique `for delete` en `USING`, et la suite pgTAP a été rédigée en conséquence : deux
assertions `throws_ok` attendaient `42501` sur une suppression refusée. Les deux sont **devenues
rouges**, et pour une raison que ni le chapitre ni le test n'avaient vue.

**Ce qui a été mesuré.** Le `USING` d'une politique `for delete` ne refuse pas la commande : il
**filtre** les lignes candidates. La commande réussit, `DELETE 0`, aucune ligne ne disparaît, et
aucune erreur n'est levée. À travers PostgREST, un `viewer` qui tente de retirer sa propre
restriction reçoit `200` et `[]`. Seul un `WITH CHECK` lève `42501` — et une politique de
suppression n'en porte pas, PostgreSQL n'en acceptant pas sur `for delete`.

**Pourquoi cela compte plus qu'une correction de test.** Une assertion écrite « la commande n'a pas
échoué » aurait été verte **que la règle tienne ou qu'elle ait été retirée** : il n'y a aucune
différence observable entre « la politique a filtré la ligne » et « la politique n'existe pas et la
ligne n'était pas là ». Une preuve de suppression refusée qui ne relit pas la ligne ne prouve rien.
C'est exactement le piège que le §7 nomme depuis `CRM-000` — « un refus ne se manifeste pas
toujours par une erreur » — appliqué à l'opération où il est le plus facile d'oublier, parce que
l'insertion et la mise à jour, elles, lèvent bien `42501`.

**Décision.** Les deux assertions deviennent **quatre** : `lives_ok` sur la commande, puis une
relecture de la ligne hors du rôle restreint, qui la constate **intacte**. Le §4.1 et le contrat
d'API du §4.2 sont corrigés dans le même changement — ligne *j'* ajoutée —, plutôt que le test
relâché. C'est la même règle qu'à la décision 87 : quand la mesure contredit le contrat écrit,
c'est le contrat qui est révisé, jamais la preuve qui est adoucie.

**Portée au-delà de cette unité.** Aucune autre politique `for delete` n'existe dans le dépôt :
`form_field_rules` est la seule autre table dont la suppression est exposée, et `CRM-035` ne lui a
posé aucune politique de suppression — son refus vient du **privilège** manquant, qui lève bien
`42501`. Les preuves existantes ne sont donc pas concernées. Elles le deviendront à la première
table qui exposera `DELETE` à `authenticated` : la règle est écrite ici pour qu'elle soit lue
avant, non après.

### Décision 107 — Une politique ne relit pas sa propre table : `insert … returning` en dépend

**LE DÉFAUT LE PLUS GRAVE DE CE PASSAGE, ET IL A ÉTÉ TROUVÉ PAR LES PREUVES D'UNE UNITÉ
PRÉCÉDENTE.** La suite pgTAP de `CRM-012` était verte sur ses 67 assertions ; c'est
`e2e/api/tracks.spec.ts`, livré par `CRM-020`, qui a rougi.

**Le symptôme.** `ligne g — l'administrateur crée un track` rendait `403`, code `42501`, là où le
contrat mesuré de `docs/SPEC-tracks.md` §6 annonce `201`. Un administrateur ne pouvait plus créer
ni track ni channel depuis l'API. Ce n'est pas une preuve devenue caduque : c'est une fonction du
produit cassée par cette unité.

**La cause, mesurée et non supposée.** La politique de lecture s'appuyait sur
`app.can_read_track(id)`, qui **relit `public.tracks`** pour en tirer le workspace. Deux mesures
l'établissent : un `insert` seul réussit, le même `insert … returning` échoue. PostgREST envoie
toujours la seconde forme dès que l'appelant demande `Prefer: return=representation` — et le
`RETURNING` d'un `INSERT` est soumis à la politique `SELECT`. Or la fonction est `STABLE` : elle
voit le cliché du **début de l'instruction**, où la ligne insérée n'existe pas encore. La politique
refuse une ligne que l'appelant vient lui-même d'écrire, et l'`INSERT` entier est annulé.

**Ce qui n'a pas été fait, et pourquoi.** Passer la fonction en `VOLATILE` aurait fait disparaître
le symptôme : une fonction volatile recharge son cliché et verrait la ligne. C'eût été payer un
rechargement par ligne évaluée, sur toutes les lectures de la table, pour contourner un défaut de
conception au lieu de le corriger. Refusé.

**La correction.** Une politique RLS est évaluée **sur une ligne dont elle possède déjà toutes les
colonnes**. Relire la table par son identifiant n'apporte rien et coûte le défaut ci-dessus. Deux
fonctions prennent désormais les colonnes en argument — `app.resolve_track_access(ws, track)` et
`app.resolve_channel_access(ws, track, ch)` — et ne lisent que `track_members` et
`channel_members`, tables que l'instruction en cours ne touche pas. Les politiques les appellent
avec `workspace_id`, `track_id` et `id` pris sur la ligne. Les fonctions `can_*` du §3.3 sont
conservées telles que la spécification les décrit — elles servent les appelants qui n'ont qu'un
identifiant — et délèguent à celles-ci.

Effet secondaire favorable, non recherché : la lecture d'une liste de tracks ne fait plus une
relecture de `tracks` par ligne rendue.

**Ce que cela enseigne, et qui dépasse cette unité.** Toute politique `SELECT` dont le prédicat
relit sa propre table casse `insert … returning` sur cette table, silencieusement, et le symptôme
apparaît **à l'écriture** — là où personne ne le cherche. Les politiques déjà livrées ont été
relues : `tracks`, `channels`, `workflow_nodes_catalog`, `workflows`, `workflow_steps`,
`workflow_transitions`, `form_fields`, `form_field_rules` s'appuient toutes sur
`app.is_workspace_member(workspace_id)`, qui ne lit que `workspace_members`. Aucune autre
correction n'était due. La règle est écrite ici pour être lue **avant** la prochaine politique, non
après.

**Ce qui fige la régression.** Deux assertions de `supabase/tests/0011_droits_fins.test.sql` font
un `insert … returning` sur `tracks` puis sur `channels` avec le jeton de l'administrateur. Elles
échouent si l'une des deux politiques revient à relire sa table. Un commentaire n'aurait pas tenu.

### Décision 108 — Deux effets de bord que seul un seed non vide pouvait révéler

Rendre les droits fins opposables **et** en poser dans le seed a mis au jour deux défauts qui
dormaient depuis `CRM-020`. Aucun des deux n'est dans le code livré par cette unité ; tous deux
étaient invisibles tant que les tables de droits fins restaient vides.

**1. Deux scénarios d'API détruisaient des données du seed.** `e2e/api/tracks.spec.ts` (T6) et
`e2e/api/channels.spec.ts` (C6) posaient une ligne de droit fin sur `conseil-ia` / `prospection`
pour le `viewer`, puis la supprimaient dans un `finally`. Ce sont **exactement** les deux lignes que
le seed pose depuis `docs/SPEC-seed.md` §2.11. Chaque exécution de `npm run e2e:api` amputait donc
le seed de la moitié de son contrat de droits fins, sans le dire — et le symptôme apparaissait bien
plus tard, sur un scénario sans rapport.

Le défaut était invisible avant : la suppression d'une ligne que le harnais venait lui-même de
créer ne détruisait rien. Correction : les deux scénarios visent désormais un couple
(objet, compte) **que le seed ne rapproche pas**, et leur `finally` ne peut plus atteindre une
ligne du contrat. La règle générale est simple et vaut pour tout scénario à venir : *un test ne
supprime jamais par prédicat ce qu'il n'a pas créé par identifiant*.

**2. Deux migrations définissent la même politique, et rejouer la première seule dégrade le
produit.** `0003_tracks.sql` crée `tracks_lecture_membre` ; `0010_droits_fins.sql` la redéfinit
pour y appliquer les droits fins. Le `migrations-runner` rejoue tout le répertoire dans l'ordre :
l'état final est toujours celui de `0010`, et rien n'est cassé en fonctionnement normal.

Mais `scripts/verify-tracks.sh` réapplique `0003` **seule**, à deux endroits — son contrôle
d'idempotence, et la restauration après chaque dégradation. Il ramenait donc la base à l'état de
`CRM-020`, faisait échouer sa propre empreinte, **et laissait le produit dégradé derrière lui**.

Deux corrections étaient possibles. Retirer la politique de `0003` aurait rendu la migration
autonome, au prix de rouvrir un livrable de `CRM-020` (`CLAUDE.md` §13) et de rendre `0003`
inapplicable seule sur une base neuve. Retenue : le harnais rejoue la **paire**, dans l'ordre du
runner, et la dépendance est inscrite dans `docs/PROD_MIGRATIONS.md` §3 — là où un humain qui
applique les migrations à la main la lira.

**Ce que ces deux défauts ont en commun.** Ils ne se voyaient que sur un état non trivial : des
droits fins réellement posés, et une politique réellement redéfinie. C'est l'argument du §8 de
`CLAUDE.md` — un seed qui couvre les états réels n'est pas un confort de démonstration, c'est un
révélateur.

---

## 2026-08-04 — `CRM-040` : spécification des cards, écrite après mesure et avant tout code

**Problème.** Le produit décrivait jusqu'ici une organisation **vide** : des tracks, des channels,
un catalogue de nœuds, des workflows et un vocabulaire de formulaire, sans rien à y ranger.
`CRM-040` livre l'objet métier principal au sens de `CLAUDE.md` §4. Aucun document ne le
spécifiait au-delà du tableau de colonnes de `docs/SCHEMA.md` §5 : ni ce qu'une adresse de card
doit à sa non-devinabilité, ni comment le workspace, le workflow et l'étape d'une card sont tenus
cohérents, ni ce qu'un refus rend, ni ce que « figé à la création » exige au juste.

**Choix de l'unité.** Les quatre unités `[ ]` que `docs/MASTER_PLAN.md` §2 place avant `CRM-040`
ont été examinées, et MESURÉ sur la base du seed, la pile en marche :

```
cards=NULL  card_events=NULL  card_comments=NULL  card_field_values=NULL
card_activities=NULL  move_card=NULL  app.can_read_card=NULL
```

| Unité | Ce qu'elle exige | Pourquoi elle n'est pas livrable |
|---|---|---|
| `CRM-013` | `cards.current_step_id`, `cards.email_local_part`, `mail_*.secret_id`, `api_tokens.token_hash`, `card_events`, `audit_log` | **aucune** de ces tables n'existe |
| `CRM-014` | les douze preuves de refus | dix d'entre elles portent sur des cards, des comptes mail ou des pièces jointes |
| `CRM-034` | les six vérifications de `move_card` | INC-043 : aucune part livrable, `move_card` sans `cards` est une signature vide |
| `CRM-036` | `card_field_values` | une table fille de `cards` |

`CRM-040` est donc la première unité `[ ]` de l'ordre du plan dont **toutes** les dépendances sont
livrées : `channels` (`CRM-021`), `workflows` et `workflow_steps` (`CRM-031`), `profiles`
(`CRM-003`), les fonctions `can_*` (`CRM-012`). C'est aussi l'ordre que l'option 1 d'INC-043
recommandait. **Aucune contrainte d'ordre de `docs/MASTER_PLAN.md` §2 n'est enfreinte** : les trois
qui concernent ces unités — « `CRM-034` avant `CRM-041` », « `CRM-036` avant `CRM-037` », « `CRM-004`
avant `CRM-052` » — restent intactes.

**Observations, sur sondes créées puis détruites.** Quatre tables sondes, `public.sonde_c1` à
`public.sonde_c4`, détruites avant rédaction — `to_regclass('public.sonde_c4')` rend `NULL`.

1. `channels` ne porte **aucune** unicité sur `(id, workspace_id)` ni sur `(id, workflow_id)` :
   toute clé étrangère composite vers elle est refusée à la création,
   « there is no unique constraint matching given keys for referenced table "channels" ».
2. `workflow_steps` porte **déjà** `(id, workflow_id)` unique, posée par `CRM-031`. La clé composite
   `(current_step_id, workflow_id)` est donc immédiatement possible, et MESURÉ elle refuse en
   `23503` une étape appartenant à un autre workflow.
3. Une colonne `GENERATED ALWAYS AS` contenant `gen_random_bytes` est **refusée** :
   « generation expression is not immutable ». Le trigger de génération de l'adresse est une
   nécessité mesurée, non un choix de style.
4. `to_tsvector('french', …)` en colonne générée `STORED` est accepté, et produit
   `'client':4 'histor':5 'refont':1 'sit':3` sur `'Refonte du site' / 'Client historique'`. La
   configuration doit être **explicite** : sans elle, l'expression dépend d'un paramètre de session
   et n'est pas immuable.
5. PostgreSQL ne sait pas encoder en base32 — `encode()` connaît `hex`, `base64`, `escape`. La
   conversion `('x' || encode(gen_random_bytes(5),'hex'))::bit(40)::bigint` puis dépliage par
   groupes de cinq bits rend huit caractères, MESURÉ y compris sur des valeurs basses.
6. Codes HTTP mesurés avec le jeton réel de l'administratrice seedée : `23503 → 409`,
   `23514 → 400`, `23502 → 400`. Ils complètent la table de `docs/SPEC-workflow-engine.md` §4.4.

### Décision 109 — Trois clés composites plutôt que trois triggers, et la vérification n° 3 de `move_card` devient gratuite

La cohérence d'une card — son workspace, son workflow, son étape — est tenue par **trois clés
étrangères composites**, non par des triggers :

| Contrainte | Ce qu'elle rend impossible |
|---|---|
| `(channel_id, workspace_id) → channels (id, workspace_id)` | un `workspace_id` dénormalisé mensonger |
| `(channel_id, workflow_id) → channels (id, workflow_id)` | un workflow autre que celui du channel |
| `(current_step_id, workflow_id) → workflow_steps (id, workflow_id)` | une étape d'un autre workflow |

**Motif.** Un trigger se contourne par un `DISABLE TRIGGER`, ne dit rien de l'état déjà en base, et
doit être écrit deux fois — insertion et mise à jour. Une clé composite est vérifiée par le moteur
des deux côtés de la relation. C'est le même raisonnement que la décision 95 pour
`form_field_rules`, et il est ici trois fois plus rentable.

**Conséquence non anticipée, et qui vaut d'être dite :** la troisième clé livre **la vérification
n° 3 des six de `move_card`** — « l'étape cible appartient au workflow de la card ». `CRM-034`
n'aura pas à l'écrire ; la base la tient, à l'insertion comme à toute mise à jour, y compris pour un
`PATCH` direct qu'aucune garde applicative ne verrait passer.

**Prix payé, et il est réel.** Deux unicités doivent être ajoutées à `channels` — structurellement
redondantes, `id` étant déjà sa clé primaire — et la seconde clé produit une règle de produit que
personne n'a décidée : changer le workflow d'un channel occupé devient refusé. Cette règle est
écrite, figée par une assertion, et soumise à arbitrage en **INC-046** plutôt que découverte un jour
par un administrateur devant un message de PostgreSQL.

### Décision 110 — La politique de `cards` n'appelle pas `app.can_read_card`, et la fonction est livrée quand même

`docs/SPEC-permissions-rls.md` §3 prescrit `app.can_read_card` depuis `CRM-010`. INC-013 l'a
différée quatre fois faute de `cards`. Elle est livrée ici — **dernier point d'INC-013** — et
pourtant les politiques de `cards` ne l'emploient pas : elles appellent `app.can_read_channel` et
`app.can_write_channel` **sur la colonne `channel_id` de la ligne jugée**.

**Motif, et il est mesuré, non théorique.** C'est la règle générale écrite au §3.5 de
`docs/SPEC-permissions-rls.md` après le défaut trouvé par `CRM-012` (décision 107) : une politique
qui appellerait `app.can_read_card(id)` relirait `cards`, et une fonction `STABLE` ne voit pas la
ligne que l'instruction en cours vient d'écrire — le `RETURNING` d'un `INSERT` étant soumis à la
politique `SELECT`, **toute création de card rendrait `403`**. La leçon de `CRM-012` est appliquée
avant d'être payée une seconde fois.

**Pourquoi la fonction existe malgré tout.** Ses appelants sont les tables **filles** —
`card_comments` (`CRM-043`), `card_field_values` (`CRM-036`), `card_events` (`CRM-044`),
`mail_messages` (`CRM-054`), les politiques de Storage —, dont les politiques ne disposent que d'un
`card_id` et n'ont aucun moyen d'atteindre le channel sans elle. Livrer une fonction sans usage
immédiat est assumé et **dit** : c'est le même cas que `app.can_write_channel` à `CRM-012`, et la
suite pgTAP l'éprouve **directement** plutôt qu'à travers une politique qui ne l'appelle pas.

### Décision 111 — La garde d'archivage d'un nœud occupé est rattachée à `CRM-040`, et deux faits ont réduit l'arbitrage à une seule issue

INC-031 soumettait trois options au responsable, « à trancher **avant `CRM-040`** ». L'arbitrage n'a
pas été rendu. Deux faits l'ont éteint, selon le mécanisme de la décision 103 :

- l'**option 2** — rattacher la garde à `CRM-031`, limitée à l'occupation par une **étape** — est
  éteinte : `CRM-031` est livrée, et l'avait elle-même écartée comme **plus stricte que la règle
  spécifiée**, puisqu'elle interdirait d'archiver un nœud instancié mais vide de cards ;
- l'**option 3** — créer une unité `CRM-030b` — reviendrait à **inventer une unité de backlog**, ce
  que `CLAUDE.md` §1 interdit.

Reste l'**option 1**, que deux harnais livrés par des unités précédentes **exigent déjà** :
`scripts/verify-catalogue.sh` et `scripts/verify-workflows.sh` portent un contrôle dont le message
dit « si `cards` existe, la garde d'archivage doit être écrite ». Livrer `cards` sans la garde
laisserait deux harnais rouges ; les amender pour les rendre verts serait exactement le masquage
que `CLAUDE.md` §18 interdit.

**Conséquence sur `CRM-030`** : sa Definition of Done exigeait « pgTAP sur le refus d'archivage »
d'un nœud occupé. Cette preuve devient acquise, mais elle est produite par `CRM-040`. Le fait est
écrit dans les deux entrées de backlog, plutôt que compté deux fois.

**Réversible :** INC-031 reste ouverte. Le responsable peut déplacer la garde ailleurs ; il saura
alors où elle est.

### Décision 112 — Une boucle de réessai n'est pas une garantie d'unicité, et le dire fait partie du livrable

Le trigger qui génère `email_local_part` tire une valeur, vérifie qu'aucune card ne la porte, et
recommence jusqu'à dix fois. Cette boucle **ne garantit rien** : deux transactions concurrentes ne
voient pas leurs lignes non validées respectives. Ce qui garantit l'unicité est l'**index unique**,
et lui seul.

La boucle ne fait que rendre l'erreur visible improbable — sur un espace de 2⁴⁰, il faudrait environ
un million de cards dans la base pour qu'une collision devienne vraisemblable. Le §3.3 de
`docs/SPEC-cards.md` l'écrit explicitement, parce qu'une boucle de réessai qui **passerait** pour la
garantie d'unicité serait précisément la fausse sécurité que `CLAUDE.md` §18 proscrit.

**Conséquence assumée :** le trigger renseigne l'adresse à l'insertion **quelle que soit** la valeur
fournie par le client — « généré » signifie que la valeur ne vient pas de l'appelant. À la **mise à
jour**, il ne fait rien, et la colonne reste modifiable : cette protection est nommément la
Definition of Done de `CRM-013`, unité `[ ]` distincte. L'écart est figé par une assertion plutôt
que corrigé au passage, ce qui rouvrirait une unité que ce chunk ne traite pas (`CLAUDE.md` §13).

---

## 2026-08-04 — `CRM-040`, suite : l'objet métier existe, et il fait tomber ce qui l'attendait

Le code, ses preuves et ses conséquences. Trois constats méritent d'être écrits, parce qu'aucun
n'était prévu au moment de la spécification.

### Décision 113 — Une erreur de la spécification, trouvée par sa propre preuve de non-complaisance

`docs/SPEC-cards.md` §6.1 affirmait, dans le commit documentaire : « Le `WITH CHECK` de la mise à
jour n'est pas une redondance. Sans lui, un appelant ayant le droit d'écriture sur le channel A
pourrait déplacer une card **vers** le channel B. »

La règle est juste. La conclusion ne l'était pas, et c'est la **dégradation b** de
`scripts/verify-cards.sh` qui l'a dit : elle retirait le `WITH CHECK` et attendait que le
déplacement passe. Il n'est pas passé. MESURÉ ensuite sur une politique sonde `for update` écrite
sans `with check` :

```
WITH CHECK ABSENT — PostgreSQL réutilise le USING
```

`pg_get_expr(polwithcheck, …)` rend `NULL`, et le moteur **réutilise le `USING`** pour juger la
nouvelle ligne. Omettre la clause ne rouvre donc rien.

**Ce qui est retenu.** La clause est **conservée** — elle rend la règle lisible sans connaître ce
détail du moteur, et elle protège d'une réécriture ultérieure qui donnerait au `USING` une
expression plus large que celle voulue à l'arrivée. Mais le fait qu'elle soit **redondante** est
écrit, dans la spécification comme dans la migration, plutôt que laissé à croire.

Et la dégradation change de forme : elle rend le `WITH CHECK` **permissif** (`with check (true)`)
au lieu de le retirer. Retirer une clause qui ne change rien est une dégradation **complaisante** —
elle produit un « OK » sans rien avoir dégradé, et rien ne le signale. C'est exactement ce que la
non-complaisance d'un harnais est censée empêcher, et il aura fallu qu'un harnais se trompe pour
qu'on l'apprenne.

### Décision 114 — Le seed ne posera aucune card dans `prospection`, et le motif est mesuré, pas supposé

INC-046 annonçait, au moment de la spécification, un risque théorique : un channel occupé ne change
plus de workflow. Le risque s'est réalisé **immédiatement**, sur le seul objet du projet qui
l'exerce.

`prospection` est le seul channel que le seed **repointe** : la section 4 le ramène au workflow
global déclaré, la section 7 le rattache à la copie de portée track livrée par `CRM-032`. MESURÉ,
une card posée dans ce channel puis le seed rejoué :

```
ERREUR création du channel prospection : code HTTP 409, attendu 200 201.
  {"code":"23503", "details":"Key (id, workflow_id)=(…31, 244bbfc6-…) is still referenced
   from table \"cards\"", …}
exit=1
```

Contre-épreuve mesurée, et elle compte autant : une card dans `grands-comptes`, channel dont le
workflow ne change jamais, laisse le seed **vert**, code de sortie `0`. Le conflit est donc
exactement celui qu'INC-046 décrit, et pas un effet de bord plus large.

**Deux corrections étaient possibles, toutes deux écartées.**

1. **Rendre conditionnels les deux `PATCH` du seed**, pour qu'ils ne s'exécutent que si la valeur
   diffère. Cela ne suffit pas : sur un rejeu, `prospection` est bien sur la copie, la section 4 la
   ramène bien au global, et la valeur **diffère** réellement. Le geste resterait nécessaire et
   resterait refusé.
2. **Faire déplacer les cards par le seed** avant de repointer, puis les ramener. C'est écrire à la
   main ce que `CRM-045` doit livrer, dans un seed, sans garde ni événement — le « geste fabriqué »
   que `CLAUDE.md` §8 proscrit.

**Retenu :** aucune card dans `prospection`, le motif écrit en `docs/SPEC-cards.md` §9.1, l'écart
figé par une assertion, et l'arbitrage laissé au responsable. Le prix est nommé : le seed ne peut
pas démontrer une card sur un **workflow dérivé**. La démonstration que cette card portait — la
réouverture d'un channel par un droit fin — est reprise **ailleurs et mieux**, par le scénario *n*
de `e2e/api/cards.spec.ts`, où c'est le `viewer` lui-même qui écrit.

### Décision 115 — Une assertion figée peut devenir plus forte que ce qu'elle remplaçait

Sept assertions écrites par des unités précédentes pour **devenir rouges** ce jour-là l'ont fait.
Aucune n'a été retirée ; toutes ont été **retournées**, ce qui est le mécanisme habituel de la
décision 51. Deux méritent d'être signalées, parce que la révision les a rendues **plus fortes** que
l'assertion d'origine.

`0006` et `0007` comptaient les triggers du catalogue — « exactement deux, aucun ne prétend porter la
garde ». Un comptage prouve une absence ; il prouve mal une présence, puisqu'un troisième trigger
quelconque le satisferait. La révision compte donc **trois** triggers **et nomme le troisième** :
`has_trigger(… 'workflow_nodes_catalog_refuser_archivage_occupe')`. Même mouvement dans
`scripts/verify-catalogue.sh`, qui ne se contente plus de constater la présence de la garde : il
**l'exerce**, archive un nœud occupé, exige le refus, et relit le nœud pour le constater actif.

La garde d'INC-013 dans `scripts/verify-authz.sh` a suivi le même chemin, en sens inverse : elle
**créait** une fonction que la suite devait refuser ; elle **retire** désormais celle que la suite
exige. L'intention est inchangée — la suite doit dénoncer l'écart entre le produit et ses preuves —,
seul le sens a suivi le produit.

Une limite figée par une assertion ne se contente donc pas de survivre à sa cause : elle est
l'occasion, le jour où elle tombe, d'écrire une preuve meilleure que celle qu'on aurait écrite sans
elle.

---

## 2026-08-04 — `CRM-034` : spécification de la garde centrale, écrite après mesure et avant tout code

**Problème.** Depuis `CRM-040`, le produit a un objet métier — mais aucune règle ne gouverne son
déplacement. `cards.current_step_id` s'écrit par un simple `PATCH`, et une card franchit une arête
que personne n'a déclarée. La seule garde qui tienne est structurelle : la clé composite
`(current_step_id, workflow_id)` impose que l'étape appartienne au workflow de la card, rien de
plus. `docs/SPEC-workflow-engine.md` §5 tenait en trente lignes et ne disait ni ce que la fonction
rend, ni quel `SQLSTATE` porte chaque refus, ni ce qu'un commentaire vide vaut, ni comment la
colonne qu'elle protège est réellement fermée.

**Choix de l'unité.** `CRM-034` est la première unité `[ ]` de `docs/MASTER_PLAN.md` §2, et la
raison qui l'écartait quatre passages durant — INC-043, « aucune part livrable, `move_card` sans
`cards` est une signature vide » — a disparu : `cards` est arrivée à `CRM-040`, qui l'a écrit
noir sur blanc. La contrainte d'ordre « `CRM-034` avant `CRM-041` » est respectée par construction,
`CRM-041` étant `[ ]`.

Les unités `[~]` du chunk 2 et du chunk 3 ont été réexaminées avant de choisir : `CRM-010`,
`CRM-011`, `CRM-012`, `CRM-020`, `CRM-021`, `CRM-030` à `CRM-033`, `CRM-035` et `CRM-040` butent
toutes sur INC-021 — aucun écran de connexion — ou sur des tables du chunk 4. Aucune n'est
terminable par un travail de code aujourd'hui.

**Observations, mesurées sur la pile réelle, sondes créées puis détruites.**
`to_regclass('public.sonde_c34_move')` et `to_regclass('public.sonde_c34_ret')` rendent `NULL`
après ménage.

1. `card_field_values`, `card_events` et `card_comments` valent tous `NULL` : les trois effets que
   le §5 d'origine promettait en cas de succès n'ont aucune table où s'écrire.
2. Un `revoke update on public.cards from authenticated` suivi d'un `grant update (…)` énumérant les
   colonnes ouvertes produit exactement l'effet voulu : `PATCH` de `current_step_id` refusé en
   `42501`, rendu **`403`** par PostgREST avec le message divulguant la commande `GRANT` (INC-026,
   quatrième occurrence) ; `PATCH` de `description` toujours accepté, `204`.
3. Une fonction `SECURITY DEFINER` **écrit la colonne révoquée** : le privilège de colonne juge le
   rôle qui exécute l'instruction, et une telle fonction s'exécute avec les droits de son
   propriétaire. C'est le mécanisme entier de la garde, et il est mesuré et non déduit.
4. Une fonction rendant `public.cards` est rendue par PostgREST comme **un objet JSON unique**, non
   comme un tableau. Le paramètre nommé `comment` est accepté sans réserve, en PL/pgSQL comme dans
   la charge JSON.
5. `revoke all on function … from public` **ne suffit pas** : l'ACL mesurée après ce seul `revoke`
   vaut `postgres=X anon=X authenticated=X service_role=X`, l'image posant un
   `ALTER DEFAULT PRIVILEGES` qui accorde `EXECUTE` **nommément** à `anon`. Un appelant sans jeton
   obtenait `200`. Après `revoke … from public, anon` : **`401`**, « permission denied for function ».
   La décision 80 avait relevé le même piège sur `copy_workflow_to_track` ; il se reproduit à
   l'identique.

### Décision 116 — La garde protège la colonne qu'elle garde, sinon elle ne garde rien

La preuve de refus n° 5 de `docs/SPEC-permissions-rls.md` §7 — « mise à jour directe de
`cards.current_step_id` par PostgREST → refus » — figure dans la Definition of Done de `CRM-034`
**et** dans celle de `CRM-013`. Le chevauchement est réel, et il n'est pas anodin : tant que
`authenticated` détient `UPDATE` sur toute la table, `move_card` est une commodité facultative que
n'importe quel client contourne, et les six vérifications ne s'appliquent qu'à ceux qui veulent
bien passer par elles.

Livrer la garde sans la protection reviendrait à livrer une décoration, puis à en apporter la preuve
par un test qui ne teste pas le produit réel. La protection de `cards.current_step_id` est donc
livrée **ici**. Le périmètre restant de `CRM-013` est réduit et **nommé** — `email_local_part`,
`secret_id`, `token_hash`, `card_events`, `audit_log` —, et le mécanisme mesuré est écrit dans
`docs/SPEC-permissions-rls.md` §4.3 pour que `CRM-013` le reprenne sans le redécouvrir. Consigné en
INC-049, avec l'option inverse laissée au responsable.

**Le prix est écrit avec la décision** : le retrait du `GRANT UPDATE` de table ferme **par défaut**
toute colonne ajoutée plus tard à `cards`. Une migration qui ajouterait une colonne modifiable sans
l'énumérer la rendrait silencieusement en lecture seule. L'énumération est donc **figée par une
assertion** qui liste les colonnes ouvertes une par une : ajouter une colonne sans trancher son cas
fera échouer la suite, plutôt que de produire une régression muette.

### Décision 117 — La sixième vérification n'est pas écrite, parce que ses deux écritures possibles sont l'une destructrice, l'autre mensongère

« Les champs requis de l'étape cible sont **renseignés** » compare deux ensembles. L'ensemble exigé
est calculable — `form_field_rules` et `require_fields` existent depuis `CRM-035`. L'ensemble
renseigné n'a **aucune source** : `card_field_values` est le livrable de `CRM-036`, que le plan
place après.

La lecture littérale — rien n'est renseigné, donc tout ensemble exigé non vide refuse — a été
MESURÉE avant d'être écartée : le seed déclare `required` sur `prospection`, `negociation`,
`signature` et `perdu`. Elle interdirait l'entrée en négociation, l'entrée en signature et les
**quatre** transitions « Marquer perdu ». La garde interdirait le parcours qu'elle est censée
garder, et `CRM-041` n'aurait plus rien à démontrer. L'autre lecture — tout est renseigné, donc rien
n'est vérifié — est le faux vert que `CLAUDE.md` §17 proscrit nommément.

`CRM-034` livre donc **cinq vérifications sur six**, reste `[~]`, et l'écart est figé par une
assertion qui deviendra rouge le jour de `CRM-036`. Le mécanisme est celui que `CRM-040` a employé
pour la protection de colonne, et qui a effectivement désigné son moment — aujourd'hui. Consigné en
INC-047.

Corollaire assumé : le message « liste des clés manquantes », que la Definition of Done nomme,
n'existe pas encore. Il naîtra avec la vérification qu'il décrit.

### Décision 118 — `position` est recalculée au déplacement, et c'est une conséquence, pas un ajout

`docs/SPEC-cards.md` §2.6 définit la portée de `position` comme le couple
`(channel_id, current_step_id)` — **une colonne du board**, non le channel entier. Changer
`current_step_id` sans recalculer `position` laisse donc la card dans une portée où sa valeur n'a
jamais été attribuée : deux cards y porteraient le même rang, et l'ordre du board deviendrait
arbitraire au premier déplacement.

Le trigger d'attribution livré par `CRM-040` est un `BEFORE INSERT` : il ne voit pas les
déplacements, et l'étendre aux mises à jour reviendrait à renuméroter une card à chaque `PATCH` de
son titre. `move_card` place donc la card **en fin** de la colonne d'arrivée, exactement comme une
card qui y naîtrait. Ce n'est pas un périmètre nouveau : c'est la seule écriture qui rende vraie la
définition posée par l'unité précédente.

### Décision 119 — Une card invisible n'existe pas, une card visible et fermée est interdite

L'ordre des deux premières vérifications reprend la règle de discrétion du §4.3, écrite par
`CRM-032`, plutôt que d'en inventer une autre. « La card existe » signifie **et** qu'elle est
visible de l'appelant, au sens d'`app.can_read_channel` : une card d'un autre workspace, ou d'un
channel fermé par un droit fin, rend `card_not_found`. Répondre « interdit » révélerait son
existence à quelqu'un qui n'a pas le droit de la connaître.

Un `viewer` de son propre workspace obtient en revanche `forbidden` : il voit la card tous les
jours, lui dire qu'elle n'existe pas serait un mensonge inutile — et un message qui ment est un
message que l'utilisateur apprend à ignorer.

La même règle range les cards archivées et en corbeille du côté de `card_not_found`, avec la
définition d'« active » de `docs/SPEC-cards.md` §5 : `archived_at is null and deleted_at is null`,
la même que celle qu'emploie la garde d'archivage d'un nœud occupé.

### Décision 120 — Une contradiction de spécification se consigne, et le comportement ne bouge pas

**Problème.** Le §5.5 de `docs/SPEC-workflow-engine.md` dit deux choses incompatibles
d'`email_local_part`. Sa prose l'énumère parmi ce qui « reste à `CRM-013` », son bloc `GRANT` ne la
liste pas — et le mécanisme étant exclusif, ne pas la lister la **ferme**. Il fallait trancher pour
écrire une ligne de SQL.

**Ce qui a décidé.** Les deux lectures sont défendables ; ce qui ne l'est pas, c'est de choisir en
silence. Fermer la colonne aurait livré la moitié de `CRM-013` — unité `[ ]` distincte — sans que
rien ne le dise, et aurait fait rougir à la **mauvaise unité** une assertion de
`0012_cards.test.sql` qui annonce explicitement devenir rouge « à `CRM-013` ».

**Décision.** `CLAUDE.md` §5 prescrit exactement ce cas : consigner, et **laisser le comportement
inchangé**. La colonne est donc ajoutée nommément à la liste des colonnes ouvertes, avec un
commentaire qui renvoie à INC-050. Le comportement est identique à celui de `CRM-040`.

**Conséquence.** Le geste paraît contre-intuitif — on écrit une ligne de `GRANT` pour *ne rien
changer* —, et c'est précisément ce qui le rend traçable : la ligne existe, elle porte son motif,
et le jour de `CRM-013` il suffira de la retirer. Une omission silencieuse n'aurait laissé aucune
prise. Deux autres contradictions ont suivi la même règle dans la même unité : INC-051, la ligne i
du contrat d'API nommant un profil que le seed ne peut pas mettre en défaut ; INC-052, `btrim` à un
argument ne retirant que des espaces là où le titre du paragraphe annonçait « un commentaire vide ».

### Décision 121 — Une preuve de discrétion n'a de valeur qu'avec un seul jeton

**Problème.** La règle de discrétion de la décision 119 produit deux réponses différentes —
`card_not_found` et `forbidden` — selon ce que l'appelant voit. Le contrat d'API du §5.8 les
faisait exercer par **deux profils différents** : le `viewer` pour `forbidden`, le `bizdev` pour
`card_not_found`.

**Observation, mesurée.** Le `bizdev` **lit les neuf cards du seed** : aucun droit fin ne lui ferme
de channel, et l'appel rend `200`. La ligne était insatisfaisable, et le §5.9 interdit de modifier
le seed pour la sauver (INC-051).

**Ce que la correction a révélé.** Le remplacement du `bizdev` par le `viewer` n'est pas un
pis-aller : c'est une preuve **strictement meilleure**. Avec deux profils, un lecteur pouvait
raisonnablement soupçonner que l'écart entre les deux réponses venait du profil — l'un est `viewer`,
l'autre `business_developer`, ils ne sont pas censés obtenir la même chose. Avec **le même jeton**,
à la même seconde, sur deux cards qui ne diffèrent que par le droit fin de leur channel, l'écart ne
peut venir que de la règle.

**Décision.** Les lignes h et i sont exercées par le seul `viewer`. Le `bizdev` reste employé, mais
pour ce qu'il prouve réellement : la rétrogradation en lecture par un droit fin de **channel**, qui
est l'**autre** chemin vers `forbidden` — là où la ligne h passe par un rôle de workspace. Le fait
qui rend la ligne d'origine inapplicable est lui-même figé par un scénario, qui deviendra rouge si
un droit fin venait à fermer ce channel au `bizdev`.

**Portée générale.** Chaque fois qu'une règle produit deux réponses selon une condition, la preuve
doit faire varier **la condition seule**. Faire varier le profil en même temps, c'est mesurer deux
choses et n'en prouver aucune.

### Décision 122 — La convergence d'une migration se prouve sur la porte qu'elle ferme

**Problème.** `scripts/verify-move-card.sh` devait établir que la migration 12 est convergente et
pas seulement idempotente (mécanisme des décisions 57 et 78). Restait à choisir **quelle**
dégradation soumettre au rejeu.

**Ce qui a décidé.** Une migration qui pose des privilèges a une dégradation naturelle et une seule :
la commande qui rouvre ce qu'elle ferme. Ici, `grant update on public.cards to authenticated` — un
seul geste, celui-là même que le message de refus de PostgREST **suggère à l'utilisateur**
(INC-026, quatrième occurrence). Un exploitant pressé le tapera un jour.

**Décision.** Le harnais pose ce `grant`, **constate** que la garde est redevenue contournable — sans
ce constat intermédiaire, le contrôle suivant serait vert sur une dégradation qui n'aurait pas pris
—, rejoue la migration, et vérifie que la porte est **refermée**.

**Conséquence.** La convergence n'est pas une propriété abstraite qu'on affirme dans un commentaire :
c'est le seul rempart contre un `hint` de PostgREST que quelqu'un aura suivi de bonne foi.

## 2026-08-05 — `CRM-036` : spécification des valeurs de formulaire, écrite après mesure et avant tout code

**Unité choisie, et pourquoi celle-là.** `docs/MASTER_PLAN.md` §2 place `CRM-036` immédiatement
après `CRM-035` au chunk 3.c, et sa contrainte d'ordre — « `CRM-036` (validation des champs)
précède `CRM-037` (rendu du formulaire) » — la désigne sans ambiguïté. Les deux unités `[ ]` qui la
précèdent dans le fichier ont été **mesurées** et restent infaisables :

- `CRM-013` vise six cibles ; quatre de ses tables — `mail_inbound_accounts`,
  `mail_outbound_identities`, `api_tokens`, `card_events`, `audit_log` — n'existent pas (chunks 4
  et 5), et les deux qui existent, `cards.current_step_id` et `cards.email_local_part`, sont
  gouvernées par des décisions déjà consignées (INC-049, INC-050) ;
- `CRM-014` exige les douze scénarios de refus ; six d'entre eux portent sur des tables des chunks
  4 et 5.

**Aucune contrainte d'ordre de `docs/MASTER_PLAN.md` §2 n'est enfreinte.**

### Décision 123 — L'arbitrage d'INC-047 n'avait pas à être demandé une seconde fois

**Problème.** INC-047 posait trois options, dont la première : « rattacher la vérification n° 6 à
`CRM-036`, dont la Definition of Done porte déjà "union étape + transition" et "`hidden` non exigé"
— c'est-à-dire, mot pour mot, la sémantique de cette vérification ». L'arbitrage n'a jamais été
rendu. Fallait-il attendre, comme quatre exécutions de la routine l'ont fait pour INC-013 avant que
la décision 103 ne tranche ?

**Ce qui décide.** Non, et pour une raison qui n'est pas la lassitude : **l'option 1 n'est pas une
décision de produit, c'est la lecture littérale d'un texte déjà écrit.** La Definition of Done de
`CRM-036` dans `docs/BACKLOG.md` énonce « `card_field_values`, validation par type, **union étape +
transition** » ; le §7.2 de `docs/SPEC-form-composer.md` énonce « champ `required` manquant →
transition refusée ; champ `hidden` non exigé même si vide ; **union étape + transition** ». Livrer
`CRM-036` sans écrire la n° 6, c'est livrer une unité amputée de ce que sa propre Definition of Done
nomme. Les options 2 et 3 d'INC-047 déplaçaient des unités dans le plan ; aucune n'était nécessaire
puisque le plan, suivi tel quel, amène `CRM-036` ici.

**Décision.** La vérification n° 6 est écrite par `CRM-036`. INC-047 est **close**, avec sa mesure
et son issue, plutôt que laissée ouverte au motif que le responsable n'a pas eu à se prononcer.

**Conséquence.** Le mécanisme de la décision 51 a fonctionné une neuvième fois : les deux assertions
que `CRM-034` avait écrites pour devenir rouges ce jour-là — l'une pgTAP, l'autre d'API — l'ont fait,
et ont été **retournées**, non retirées.

### Décision 124 — Une valeur est opposable parce que trois clés composites la tiennent, et l'une exigeait une unicité qui manquait

**Problème.** Rien n'empêchait structurellement une ligne de `card_field_values` d'associer une card
suivant le workflow A à un champ déclaré sur le workflow B. C'est le problème exact que `CRM-035`
avait résolu pour `form_field_rules` par deux clés étrangères composites articulées autour de
`workflow_id` (décision 95).

**Observation, mesurée le 2026-08-05.** La même solution ne s'écrivait pas :

```
create table sonde (card_id uuid, workflow_id uuid,
  foreign key (card_id, workflow_id) references public.cards (id, workflow_id));
ERROR:  there is no unique constraint matching given keys for referenced table "cards"
```

`cards` ne porte que `PRIMARY KEY (id)`, là où `form_fields` porte `UNIQUE (id, workflow_id)` depuis
`CRM-035` et `workflow_steps` depuis `CRM-031`. La contrainte manquait **par omission**, non par
choix : `CRM-040` n'avait aucune table fille à servir.

**Décision.** `CRM-036` ajoute `UNIQUE (id, workflow_id)` sur `cards`. **Cet ajout ne change aucun
comportement** — `id` étant déjà clé primaire, le couple était déjà unique —, il rend seulement la
relation exprimable. MESURÉ après ajout : une paire cohérente est acceptée, une paire croisant deux
workflows est refusée en `23503`.

**Conséquence.** Une valeur ne peut plus répondre à la question d'un autre workflow, et ce n'est ni
un trigger ni une politique qui le tient : c'est le moteur, des deux côtés de la relation, y compris
contre un `PATCH` direct qu'aucune garde applicative ne verrait passer.

### Décision 125 — La validation par type est un trigger parce qu'un `CHECK` ne peut pas la porter

**Problème.** Le type qui gouverne une valeur est déclaré sur une **autre** table,
`form_fields.type`. La contrainte naturelle serait un `CHECK`.

**Observation, mesurée.** `create table sonde (… check (exists (select 1 from public.form_fields …)))`
rend `ERROR: cannot use subquery in check constraint`. La mesure ferme la question : ce n'est pas un
choix d'écriture, c'est une propriété de PostgreSQL.

**Décision.** Un trigger `BEFORE INSERT OR UPDATE`, `SECURITY DEFINER` et `search_path` vide. Le
`SECURITY DEFINER` n'est pas un confort : le trigger doit lire `form_fields` **en entier**, et non ce
que la RLS de l'appelant lui montre. Un champ invisible ne doit pas être un champ non validé.

**Ce qui a été mesuré au passage, et qui décide de la forme du refus.** PostgREST rend `400` pour un
refus levé depuis un trigger, que le `SQLSTATE` soit `P0001` ou `22023`, et il expose le `DETAIL` du
`raise` dans la clé `details` de sa réponse JSON.

### Décision 126 — La liste des clés manquantes voyage dans le `DETAIL`, pas dans le message

**Problème.** Le §6 de `docs/SPEC-form-composer.md` exige depuis `CRM-000` que le refus « retourne
la liste des clés manquantes, afin que le client puisse les mettre en évidence sans deviner ». Deux
écritures étaient possibles.

**Observation, mesurée sur deux fonctions sondes créées puis détruites :**

| Écriture | Réponse PostgREST |
|---|---|
| `raise exception 'missing_required_fields: %', clés` | `{"code":"P0001","details":null,"message":"missing_required_fields: {budget,source}"}` |
| `raise … using detail = clés` | `{"code":"P0001","details":"budget, source","message":"missing_required_fields"}` |

**Décision.** La seconde. La première rend le `message` **incomparable par égalité** : il porterait
une liste variable, et chaque test — comme chaque client — devrait le découper pour le lire. Les cinq
refus déjà livrés par `CRM-034` sont des jetons stables ; le sixième le reste, et la donnée variable
voyage dans le champ prévu pour elle.

**Portée générale.** Un message d'erreur a deux lecteurs : un programme, qui veut un jeton, et un
humain, qui veut un détail. Les mélanger, c'est mal servir les deux.

### Décision 127 — « Renseigné » est une définition, et elle vit dans une fonction

**Problème.** La sixième vérification compare un ensemble exigé à un ensemble **renseigné**. Or une
ligne présente ne suffit pas : `docs/SCHEMA.md` §4 pose que `'null'::jsonb` signifie « explicitement
vide ». Une chaîne vide et un tableau vide posent la même question.

**Décision.** Une valeur est renseignée lorsqu'elle n'est ni `'null'::jsonb`, ni une chaîne vide ou
faite de seuls espaces, ni un tableau vide. **Tout le reste l'est, y compris `false`, `0` et `"0"`** :
une case décochée est une réponse, pas une absence de réponse — confondre les deux rendrait une case
à cocher impossible à satisfaire par la négative.

**Pourquoi une fonction et non une expression recopiée.** `move_card` et le rendu de `CRM-037`
doivent donner la **même** lecture de « renseigné », faute de quoi l'interface annoncerait passable
une transition que la garde refuse. `app.valeur_de_champ_est_vide(jsonb)` est le seul endroit où
cette définition existe.

### Décision 128 — Un identifiant mort de `require_fields` est ignoré, et l'asymétrie du choix est le motif

**Problème.** Le §3.5 de `docs/SPEC-form-composer.md` laissait à `move_card` le choix d'« ignorer, ou
dénoncer, un identifiant qu'elle ne résout pas ». Aucune intégrité référentielle ne protège ce
tableau — PostgreSQL refuse une clé étrangère depuis un `uuid[]` (INC-033).

**Ce qui décide, et ce n'est pas une préférence.** Les deux erreurs possibles n'ont pas le même
coût :

- **dénoncer** bloque définitivement une transition pour une erreur de saisie d'administrateur, et
  **aucun utilisateur ne peut la corriger depuis le produit** — il faudrait modifier la transition,
  écran réservé à l'administration ;
- **ignorer** ne fait que ne pas exiger ce que personne ne peut renseigner : le champ visé n'existe
  pas, ou appartient à un autre workflow, donc aucune valeur ne pourra jamais lui être associée — les
  clés composites de la décision 124 l'interdisent.

**Décision.** Ignorer. La jointure de la sixième vérification est écrite de sorte que l'identifiant
non résolu tombe naturellement, et le comportement est **figé par une assertion** plutôt que laissé
au hasard d'une écriture.

**Ce qui n'est pas décidé ici.** L'absence de tout signal côté administration reste entière : rien ne
prévient un administrateur que le `require_fields` qu'il vient de poser désigne un champ mort. Le
point ouvert n° 6 du §9 de `docs/SPEC-workflow-engine.md` est réécrit pour le dire.

### Décision 129 — Un champ archivé n'exige rien, et c'est la seule lecture tenable

**Problème.** Le §5 de `docs/SPEC-form-composer.md` pose que l'archivage d'un champ « le retire des
formulaires sans supprimer les valeurs déjà saisies ». Que devient une règle `required` portant sur
un champ archivé, ou un `require_fields` le désignant ?

**Décision.** Le champ archivé est **exclu de l'ensemble exigé**, quelle que soit sa règle. Exiger un
champ qu'aucun formulaire n'affiche rendrait la transition impossible à satisfaire depuis le produit :
l'utilisateur verrait un refus nommant une clé qu'il ne peut renseigner nulle part.

**Conséquence sur le seed.** Le champ archivé `budget-previsionnel` reçoit une valeur sur la card
`…0c3`, précisément pour que « une valeur survit à l'archivage de son champ » soit démontré par une
donnée permanente, et non seulement écrit.

### Décision 130 — `app.can_write_card` est livrée, et ce n'est pas un élargissement de périmètre

**Problème.** Le tableau du §4 de `docs/SPEC-permissions-rls.md` prescrit « Écriture sur le channel »
pour `card_field_values`, sans dire par quel chemin. Une table fille ne dispose que d'un `card_id` ;
aucune politique ne peut atteindre le channel sans une jointure.

**Ce qui décide.** `app.can_read_card` existe depuis `CRM-040` pour exactement cette raison, et son
commentaire nomme `card_field_values` parmi ses appelants prévus. Son symétrique en écriture
manquait. L'alternative — recopier la sous-requête dans chacune des politiques d'insertion et de
mise à jour — répète la jointure et la rend impossible à corriger d'un seul endroit.

**Décision.** `app.can_write_card(uuid)` est livrée, de forme identique à `app.can_read_card`, et
inscrite au §3.7 de `docs/SPEC-permissions-rls.md` dans le commit documentaire qui précède le code.
Comme sa jumelle, elle n'est **pas** appelée par les politiques de `cards`, qui jugent sur
`channel_id`, colonne de la ligne jugée (décision 110).

### Décision 131 — La forme des choix est enfin contrainte, du côté des réponses

**Problème.** Le point ouvert n° 4 du §8 de `docs/SPEC-form-composer.md` était en suspens depuis
`CRM-035` : la base ne contraint pas la forme des entrées de `options.choices`, un `CHECK` ne pouvant
porter de sous-requête. Le §8 renvoyait la question à « la validation de `CRM-036`, ou pas du tout ».

**Décision.** La contrainte est posée là où elle a une conséquence : **la valeur**. Un `select` ou un
`multiselect` dont la clé ne figure pas dans `options.choices` est refusé. La déclaration reste libre
— on peut toujours écrire un `choices` mal formé —, mais aucune card ne peut plus porter une réponse
que son champ n'offre pas.

**Conséquence.** Le risque nommé au §2.4 — une clé de choix inconnue arrivant jusqu'à l'affichage —
est éteint du côté qui compte. Le point ouvert n° 4 est barré, son motif conservé.

### Décision 132 — `user` et `contact` ne sont pas résolus, et résoudre l'un seul aurait été pire

**Problème.** Le §2.3 annonce que « le résoudre appartient à `CRM-036` et à `CRM-060` », sans dire
lequel fait quoi. `contact` vise `contacts`, table qui n'existe pas ; `user` vise `profiles`, livrée.

**Ce qui décide.** Résoudre `user` seul rendrait la famille incohérente — deux types voisins, l'un
opposable et l'autre non — et surtout **poserait une règle que nul document n'énonce** : un `user`
doit-il être membre du workspace de la card, ou tout profil convient-il ? Trancher cela reviendrait à
décider à la place du responsable, dans une unité qui ne le lui a jamais demandé.

**Décision.** Les deux types valident la **forme** d'un `uuid`, et rien de plus. Consigné en
**INC-053**, arbitrage attendu, sans que le comportement soit décidé implicitement.

## 2026-08-05 — `CRM-036`, suite : un défaut de conception trouvé par le seed lui-même

### Décision 133 — `value` est nullable, parce que `'null'::jsonb` est inatteignable depuis l'API

**Problème.** `docs/SCHEMA.md` §4 annonçait `value` **non nul**, avec `'null'::jsonb` pour signifier
« explicitement vide ». La spécification écrite le matin même reprenait cette lecture au §6.6. Le
seed a été écrit d'après elle, et il a **échoué** :

```
ERREUR valeur c1×081 : code HTTP 400, attendu 200 201.
  {"code":"23502", "message":"null value in column \"value\" of relation
   \"card_field_values\" violates not-null constraint"}
```

**Observation, mesurée sur une table sonde créée puis détruite.** PostgREST `v14.12` convertit un
`null` JSON du corps de la requête en **SQL NULL**, et il n'existe aucune écriture qui produise
`'null'::jsonb` :

| Corps envoyé | Colonne `jsonb` obtenue |
|---|---|
| `{"v": null}` | **SQL NULL** |
| `{"v": "null"}` | la chaîne `"null"` |
| `{"v": [null]}` | le tableau `[null]` |

**La conséquence n'est pas cosmétique.** La valeur `'null'::jsonb` étant inatteignable depuis l'API,
« vider un champ » devenait impossible pour tout type dont la validation refuse la chaîne vide. Un
champ `money` renseigné par erreur n'avait **aucune écriture licite** qui le remette à vide : la
chaîne vide est refusée par la validation de type, le SQL NULL par la contrainte de colonne, et
aucune suppression n'est exposée. Le produit aurait livré une valeur impossible à retirer.

**Décision.** `value` est **nullable**, et SQL NULL vaut « explicitement vide » au même titre que
`'null'::jsonb`. `app.valeur_de_champ_est_vide` traitait déjà les deux formes de façon identique —
la fonction a été écrite avant que le défaut n'apparaisse, et c'est la seule raison pour laquelle la
correction tient en une ligne de DDL. Le trigger de validation sort de la même façon dans les deux
cas, avant tout contrôle de type.

**Pourquoi ce n'est pas une décision prise à la place du responsable.** La contrainte « non nul » du
tableau de `docs/SCHEMA.md` §4 datait de `CRM-000`, écrite **avant toute mesure**, et elle rendait
inatteignable un comportement que le même tableau spécifie une ligne plus bas. Ce n'est pas un
arbitrage entre deux produits possibles : c'est une contradiction interne, dont une seule branche est
réalisable. Elle est consignée en **INC-054** avec sa mesure, et le tableau est corrigé dans le même
changement.

**Portée générale, et c'est la leçon du jour.** Le seed n'est pas une donnée de démonstration : c'est
**le premier client réel** du produit, et il emprunte les mêmes routes qu'un utilisateur
(`CLAUDE.md` §8). Ce défaut n'aurait été trouvé par aucune suite pgTAP — `insert … values (…, null)`
en SQL passe très bien la contrainte quand on écrit `'null'::jsonb` à la main — ni par aucun test
d'API écrit après le code, qui aurait été écrit contre le comportement observé. Il a été trouvé
parce qu'une donnée déclarée d'avance devait exister, et qu'elle n'a pas pu.

## 2026-08-05 — `CRM-036`, suite : ce que le rejeu des dix-sept harnais précédents a dénoncé

### Décision 135 — Un harnais qui rejoue une migration doit rejouer celles qui la suivent

**Problème.** `scripts/verify-move-card.sh` — livrable de `CRM-034` — rejoue la migration 12 à trois
endroits : pour éprouver son idempotence, sa convergence, et pour restaurer après dégradation.
Depuis `CRM-036`, la migration **13** redéfinit `public.move_card` pour y ajouter sa sixième
vérification. Rejouer la 12 seule ramène donc la fonction à sa version à **cinq** vérifications.

**Observation, mesurée.** Au rejeu de l'ensemble des harnais, `verify-move-card.sh` rendait **9
anomalies**, et — beaucoup plus grave — **laissait le produit dégradé en sortant** : la garde
n'exigeait plus les champs requis, sans qu'aucun signal ne le dise. Les harnais exécutés ensuite
mesuraient un produit amputé, et l'un d'eux a échoué pour cette raison sans qu'elle apparaisse dans
son message.

**C'est la seconde occurrence exacte de la décision 108**, qui avait relevé que
`scripts/verify-tracks.sh` réappliquait `0003` seule et ramenait la politique de lecture à sa
version sans droits fins.

**Décision.** `verify-move-card.sh` rejoue les deux migrations, dans l'ordre, par une fonction
`rejouer_migration` unique ; et sa restauration de sortie rejoue la **13**, non la 12 — c'est elle
qui porte la définition courante. Le harnais de `CRM-036` mesure par ailleurs cette dépendance
**dans les deux sens** : rejouer la 12 seule retire la sixième vérification, rejouer la 13 la remet.

**Portée générale, et elle vaut pour toute migration future.** Dès qu'une migration en **redéfinit**
un objet posé par une précédente, tout script qui rejoue la précédente doit rejouer la suivante.
La dépendance est inscrite dans `docs/PROD_MIGRATIONS.md` §3, où elle rejoint celle des migrations
3, 4 et 10.

### Décision 136 — Trois unités avaient laissé les compteurs du harnais périmés, et le dire vaut mieux que les corriger en silence

**Problème.** `scripts/verify-harness.sh` fige le nombre d'assertions pgTAP et de scénarios d'API
attendus, **volontairement** : un exécuteur qui se contenterait de « le vert est vert » resterait
vert si une suite entière cessait d'être découverte. Le prix de ce contrôle est sa révision
explicite à chaque livraison.

**Observation.** Les valeurs étaient restées à `717 / 150`, celles de `CRM-035`. Trois unités
livrées depuis — `CRM-012`, `CRM-040`, `CRM-034` — ont ajouté des assertions et des scénarios sans
les réviser. Le harnais rendait donc « vert mais N au lieu de 717 » à chaque exécution, et **c'est
le comportement voulu** : le contrôle a bien dénoncé l'écart à chaque fois. Ce qui manquait, c'est
la révision.

**Décision.** Les compteurs passent à `1051 / 242`, **mesurés** le 2026-08-05 et non déduits, et le
commentaire d'historique **nomme l'omission** au lieu de la lisser. Un lecteur qui compare les
comptes rendus de ces trois unités à ce fichier doit pouvoir comprendre pourquoi ils divergent.

**Ce qui n'est pas fait :** aucune des trois unités n'est rouverte. Le compteur est une propriété du
harnais, pas de leur livrable.

### Décision 137 — Une dégradation devenue inapplicable se renforce, elle ne se retire pas

**Problème.** `scripts/verify-authz.sh` éprouve sa propre non-complaisance en retirant
`app.can_read_card`, et en exigeant que la suite `0002` tombe. Depuis `CRM-036`, la fonction a un
**appelant réel** — la politique de lecture de `card_field_values` —, et `drop function` est refusé
par le moteur : « other objects depend on it ». La mutation ne s'appliquait plus, et le harnais
rendait « contrôle non concluant ».

**Décision.** `cascade` est ajouté, ce qui **renforce** la dégradation au lieu de l'affaiblir : elle
retire désormais la fonction **et** la politique qui en dépend, donc elle ouvre davantage que la
version précédente. La suite doit le dénoncer d'autant plus — et elle le fait.

**Portée générale.** Quand une dégradation cesse de s'appliquer parce que le produit a grandi, la
tentation est de la retirer. Le bon geste est de regarder **pourquoi** elle ne s'applique plus : ici,
la raison est que la fonction est devenue utile, ce qui rend son retrait plus grave, pas moins.

---

## 2026-08-05 — `CRM-013` : spécification des colonnes protégées, écrite après mesure et avant tout code

L'unité choisie est la **première `[ ]` de `docs/MASTER_PLAN.md` §2**. Deux passages précédents
l'avaient écartée comme infaisable — `CRM-040` a écrit noir sur blanc « `CRM-013` vise six tables
dont **aucune** n'existe ». Ce constat était vrai au moment où il a été fait ; il ne l'est plus.
`CRM-040` a livré `cards`, et avec elle deux des six cibles.

### Décision 138 — Le périmètre livrable de `CRM-013` est **une colonne**, et le dire vaut mieux que gonfler l'unité

**Problème.** L'énoncé de `CRM-013` porte six cibles : `secret_id` (deux tables), `token_hash`,
`current_step_id`, `email_local_part`, `card_events` et `audit_log`. Combien sont atteignables
aujourd'hui ?

**Observations, mesurées et non déduites.** `to_regclass` rend `NULL` pour
`mail_inbound_accounts`, `mail_outbound_identities`, `api_tokens`, `card_events` et `audit_log` :
cinq cibles, cinq tables absentes, livrées par `CRM-052`, `CRM-053`, `CRM-073`, `CRM-044` et
`CRM-072`. `current_step_id` est fermée depuis `CRM-034` — INC-049 a tranché ce chevauchement de
ce côté, « parce qu'une unité dont la Definition of Done exige une preuve doit livrer ce qui la
rend possible ».

**Décision.** `CRM-013` livre `cards.email_local_part`, et **rien d'autre**. L'unité reste `[~]`,
avec ses cinq cibles absentes nommées une par une. Trois conduites étaient possibles et deux sont
exclues : écrire des protections sur des tables inexistantes est impossible ; déclarer l'unité
close en comptant une cible sur six serait la déclaration mensongère que `CLAUDE.md` §26 range
au-dessus de tout le reste.

**Conséquence.** Une unité qui n'avance que d'un sixième reste une unité qui avance. Le seul point
livrable était aussi le seul qui laissait une propriété de sécurité **fausse** dans le produit
(décision 139).

### Décision 139 — Une adresse tirée au hasard qu'un client peut réécrire n'est pas une adresse tirée au hasard

**Problème.** `email_local_part` porte quarante bits de hasard, et `docs/SPEC-cards.md` §3.3 fonde
sur eux la non-devinabilité de l'adresse d'une card. Le trigger de `CRM-040` **génère** cette
valeur ; il ne la **protège** pas — son §3.4 le dit en toutes lettres.

**Observation.** MESURÉ avec le jeton réel de `admin@p2enjoy.test`, obtenu par la véritable route
de connexion :

```
PATCH /rest/v1/cards?id=eq.5eed…00c1   {"email_local_part":"c-00000000"}
→ HTTP 200 ; relecture : « c-00000000 »
```

`information_schema.column_privileges` donne la cause : `authenticated` détient `UPDATE` sur
**treize** colonnes de `cards`, `email_local_part` comprise.

**Conséquence, et c'est elle qui compte.** La propriété que le tirage achète — on ne peut pas
écrire à une card dont on ignore l'adresse — est rendue au client par une simple mise à jour. Tout
membre qui écrit sur un channel peut donner à une card une adresse triviale, donc devinable, donc
atteignable par n'importe qui connaissant le domaine entrant. Ce n'est pas une imperfection de
confort : c'est la seule propriété de sécurité que cette colonne porte.

**Décision.** Le privilège `UPDATE` est retiré à `authenticated` sur cette colonne, par la forme
déjà mesurée par `CRM-034` (`docs/SPEC-permissions-rls.md` §4.3) : retrait du privilège de table,
puis `grant update (…)` énumérant les douze colonnes qui restent ouvertes.

### Décision 140 — Le chemin d'insertion est déjà sûr, et le « corriger » aurait été une régression

**Problème.** Faut-il fermer aussi le privilège `INSERT` sur cette colonne ? La question se pose,
puisqu'un client peut nommer `email_local_part` dans un `POST`.

**Observation.** MESURÉ, toujours avec le jeton de l'administratrice :

```
POST /rest/v1/cards   {…, "email_local_part":"c-zzzzzzzz"}
→ HTTP 201 ; adresse enregistrée : « c-2c3qgad2 »
```

Le trigger `BEFORE INSERT` de `CRM-040` écrase la valeur fournie, quelle qu'elle soit. La colonne
est déjà hors d'atteinte du client à l'insertion.

**Décision.** `INSERT` reste **de table**, inchangé. Le fermer ferait rendre `403` à une requête
que le produit accepte aujourd'hui sans dommage, et casserait tout client qui renvoie la ligne
entière. Une protection qui refuse ce qui n'était pas dangereux n'est pas une protection : c'est
une régression.

**Vérification prévue.** Le trigger et son effacement sont **figés par une assertion**, de sorte
que le retirer un jour ne passe pas inaperçu au prétexte que le privilège suffirait.

### Décision 141 — Un trigger de restauration aurait masqué l'écriture au lieu de la refuser

**Problème.** Une seconde écriture était possible : un trigger `BEFORE UPDATE` remettant
`OLD.email_local_part` dans `NEW`. Elle a l'avantage de valoir pour **tout** rôle, `service_role`
compris, là où le privilège ne vise qu'`authenticated`.

**Décision.** Écartée. Ce trigger rendrait `200` à un appelant qui croirait avoir renommé
l'adresse, et n'aurait rien renommé — exactement la « valeur par défaut trompeuse » que
`CLAUDE.md` §18 range parmi les manières de masquer une erreur. Un trigger qui lèverait une
exception, lui, ferait double emploi avec le privilège sans rien ajouter : le privilège est
vérifié par le moteur avant toute exécution et vaut pour tout chemin SQL.

**Ce que la décision laisse ouvert, et qui est nommé.** `service_role` conserve
`all privileges` — le seed en dépend. Un service qui se tromperait de colonne ne serait donc
arrêté par rien. Aucun consommateur n'existe aujourd'hui ; la question devra être reposée le jour
où `mail-sync` (`CRM-051`) écrira sur `cards`.

### Décision 142 — INC-050 s'éteint par exécution, et il n'y avait pas d'arbitrage à demander

**Problème.** INC-050 constate que le §5.5 de `docs/SPEC-workflow-engine.md` se contredit sur
cette colonne : sa prose la range parmi ce qui « reste à `CRM-013` », son bloc `GRANT` ne la liste
pas. `CRM-034` a consigné sans résoudre, comme `CLAUDE.md` §5 l'impose, et attendait un arbitrage.

**Observation.** Les deux branches de cet arbitrage — corriger le bloc, ou corriger la prose — ne
portaient que sur **l'attribution** : quelle unité ferme la colonne. Ni l'une ni l'autre ne
laissait la colonne ouverte. Le comportement final était le même des deux côtés.

**Décision.** Exécuter `CRM-013` tranche l'attribution par son propre énoncé de backlog —
« `current_step_id` et `email_local_part` non modifiables directement » —, sans décider quoi que
ce soit à la place du responsable. L'état posé coïncide alors **exactement** avec le bloc `GRANT`
du §5.5, et la contradiction disparaît d'elle-même. INC-050 est close par exécution, non par
arbitrage.

**Portée générale.** Une contradiction dont toutes les branches mènent au même état du produit
n'est pas un arbitrage : c'est une question d'imputation, que l'exécution de l'unité nommée
résout. La distinguer d'un vrai arbitrage évite d'immobiliser une unité qui n'attend rien.

### Décision 143 — Un harnais restaure en rejouant ce que le runner produit, non sa seule migration

**Problème rencontré.** `scripts/verify-cards.sh` restaurait son état en rejouant
`0011_cards.sql`. MESURÉ le 2026-08-05, sur une base saine, avant et après son passage :
`has_table_privilege('authenticated', 'public.cards', 'update')` passait de `false` à `true`, et
`npm run test:sql` de « aucune anomalie » à **huit assertions en échec**. La section 7 de `0011`
accorde l'`UPDATE` de table sur `cards` ; `0012` le retire précisément pour rendre `move_card`
incontournable. Rejouer `0011` seul **désactivait la garde centrale de `CRM-034`** pour tout ce qui
s'exécutait ensuite.

**Ce que le harnais annonçait pendant ce temps.** « 37 contrôles, aucune anomalie. » Il disait vrai
de ce qu'il mesurait, et laissait derrière lui une base où la porte qu'il venait de vérifier était
rouverte. C'est la forme la plus coûteuse d'un faux vert : il n'est pas faux là où on le lit, il est
faux **ailleurs**, et plus tard.

**Options.**

1. **Sauvegarder puis restaurer les privilèges** autour de chaque dégradation. Rejeté : il faudrait
   énumérer ce qui peut changer, et cette liste dériverait à chaque migration nouvelle.
2. **Ne plus rejouer aucune migration** et restaurer par des instructions ciblées. Rejeté : le rejeu
   est précisément ce qui prouve la **convergence** (décision 57), qu'aucune instruction ciblée ne
   démontrerait.
3. **Rejouer la migration de l'unité ET celles qui la complètent**, dans l'ordre du répertoire.

**Décision.** L'option 3. Le `migrations-runner` rejoue tout le répertoire dans l'ordre à chaque
démarrage (décision 20) : « restaurer » ne peut vouloir dire qu'une chose — ramener la base à l'état
que le runner produit. Restaurer à un état intermédiaire, c'est restaurer à un état que le produit
n'a jamais.

**Conséquence heureuse, et elle n'était pas cherchée.** La correction a fait tomber la dégradation
*b* du même harnais, qui éprouvait le `WITH CHECK` de `cards_maj` par un `PATCH` de `channel_id`.
Cette colonne est fermée au niveau **privilège** depuis `CRM-034` : le `PATCH` est refusé avant
qu'aucune politique ne soit consultée, et la dégradation ne prouvait donc plus rien — **elle ne
l'exerçait que grâce au défaut lui-même**. Elle est réécrite en deux temps : le refus tenu par le
seul privilège, puis le `WITH CHECK` réellement exercé une fois le privilège rendu. Le contrôle en
sort plus fort, et chaque barrière est mesurée séparément.

**Ce qui n'est pas fait, et pourquoi.** Aucune règle générale n'est inscrite dans
`docs/SPEC-test-harness.md`. Le même piège attend toute unité qui modifiera par une migration
ultérieure un objet créé par une migration antérieure, et une règle d'outillage engage toutes les
unités à venir : la question est posée en **INC-055**, à l'arbitrage du responsable. La correction
porte sur la seule occurrence mesurée.
---

## 2026-08-05 — `CRM-013` : la colonne fermée, et deux défauts que la base froide a dénoncés

### Décision 144 — Un garde-fou qui dépend de l'âge de la base ne garde rien — INC-056

**Problème.** `npm run test:sql` a rendu **quatre** fichiers en échec après l'application de la
migration 14, dont deux pour un motif sans aucun rapport avec elle : trois contrôles attendaient
« UNE transition à `require_fields` non vide » et en trouvaient **deux**.

**Observations, mesurées.** La seconde est la **copie** de portée track créée par le seed.
`copy_workflow_to_track` recopie `require_fields` tel quel — INC-037 le disait déjà —, et le seed
pose ce tableau à sa **section 6**, avant de créer la copie à sa **section 7**. Sur une base créée
de zéro, la copie hérite donc de l'exigence. Sur la base **ancienne** où `CRM-036` a mesuré `1`, la
copie précédait l'introduction de `require_fields` et ne portait rien.

**Ce que cela révèle, et qui dépasse trois assertions.** `./resetMe.sh` ne reproduisait pas l'état
sur lequel les preuves avaient été écrites. Deux exécutions de la même commande, sur deux
historiques différents, donnaient deux états différents — contre `CLAUDE.md` §8, qui pose le seed
comme un contrat **reproductible**. Le défaut n'était visible que d'une base froide, et cette
routine tourne presque toujours sur un conteneur neuf : c'est le seul motif pour lequel il a été vu.

**Décision.** Le comportement reste **inchangé** — il appartient à `CRM-032` et à `CRM-005`. Les
trois contrôles sont rendus **déterministes** : ils comptent sur le workflow **global**. Et
l'héritage de la copie, plutôt que d'être perdu, est **compté séparément** par une assertion neuve
et un contrôle neuf. Le total du workspace reste `2` ; il est désormais affirmé au lieu d'être subi.

**Ce qui n'a pas été fait, et pourquoi.** Déplacer la pose de `require_fields` après la copie
aurait fait passer les trois contrôles sans rien changer d'autre. C'eût été corriger le seed d'une
autre unité pendant un passage consacré à `CRM-013`, et surtout **effacer la trace** d'un
comportement d'INC-037 qui mérite l'arbitrage. Consigné en INC-056, avec les deux points à trancher.

**Portée générale.** Un garde-fou qui compte à une échelle plus large que ce qu'il veut prouver
finit par compter autre chose. Le remède n'est pas de relâcher la valeur attendue : c'est de
resserrer la portée, et de compter séparément ce que l'élargissement avait masqué.

### Décision 145 — Le harnais que j'écrivais a reproduit à l'identique la faute qu'il devait prévenir

**Problème.** La première version de `scripts/verify-colonnes-protegees.sh` mesurait la dépendance
d'ordre 12 → 14 en rejouant la migration 12, puis la 14. `npm run test:sql` a ensuite rendu
**quatre** fichiers en échec, et les deux autres — ceux de `move_card` — pour une raison nette : la
migration 13 **redéfinit** `public.move_card` avec sa sixième vérification. Rejouer 12 puis 14, sans
la 13, laissait le produit avec une garde à **cinq** vérifications.

**Ce que c'est exactement.** La décision 135, reproduite à l'identique, par le harnais suivant, et
par quelqu'un qui venait de la lire pour l'écrire. Le fait est consigné plutôt que réparé
discrètement : une faute que sa propre documentation n'empêche pas est une information sur la
documentation.

**ET CE N'EST PAS UNE COÏNCIDENCE : la décision 143, écrite le même jour par une autre exécution de
la routine, corrige exactement le même mode de défaillance sur `scripts/verify-cards.sh`.** Deux
harnais, deux passages indépendants, la même faute — c'est le signe que le remède harnais par
harnais ne suffit pas. La question d'inscrire la règle dans `docs/SPEC-test-harness.md` est posée
en **INC-055** par cette autre exécution, et cette troisième occurrence la renforce.

**Décision.** La séquence de restauration est **12 → 13 → 14**, jamais partielle, dans le harnais
comme dans son `trap` de sortie. Et un **contrôle explicite** est ajouté : après le rejeu, la
définition de `move_card` doit encore contenir `missing_required_fields`. Sans lui, le harnais
sortirait vert sur un produit amputé — précisément ce qui s'est produit.

**Portée générale.** Rejouer une migration n'est jamais un geste local : c'est rejouer un **préfixe**
de l'historique, et tout ce qui a été écrit après doit l'être de nouveau. La règle vaut désormais
pour quatre couples mesurés — 3 → 10, 11 → 12 (décision 143), 12 → 13, 12 → 14 — et il n'y a aucune
raison de croire qu'elle s'arrête là. Un harnais qui rejoue la migration N rejoue **toutes** celles
qui la suivent.

**QUATRIÈME OCCURRENCE, MESURÉE APRÈS COUP, ET C'EST LE CONTRÔLE FINAL QUI L'A TROUVÉE.** Avant de
clore l'unité, l'état de la base a été relu : `email_local_part` était **ouverte**, après un
balayage complet des harnais. Le coupable a été trouvé par élimination, un harnais à la fois :
`scripts/verify-valeurs-champs.sh` rejoue la migration 12 en **trois** endroits — une fois pour
éprouver l'ordre 12 → 13, deux fois pour poser des dégradations — et ne rejouait ensuite que la 13.
Il sortait donc sur une base où l'adresse d'une card redevenait réécrivable, **en annonçant
« 33 contrôles, aucune anomalie »**.

Ce harnais n'était pas fautif quand il a été écrit : la migration 14 n'existait pas. C'est la
livraison de `CRM-013` qui l'a rendu défaillant, et c'est donc à `CRM-013` de le reprendre — ce
qu'elle fait, en ajoutant la 14 derrière chacun des trois rejeux, dans le ménage de sortie, et en
**constatant** la colonne refermée par un contrôle neuf (34 contrôles au lieu de 33).

**Ce que l'épisode apprend, et qui vaut plus que la correction.** Une migration qui retire un
privilège crée une **dette rétroactive** sur tous les harnais existants qui rejouent une migration
antérieure. Les trouver ne peut pas se faire de mémoire : il a fallu **mesurer l'état de la base
après chaque harnais, un par un**. Ce balayage devrait être le geste de clôture de toute unité qui
touche à un privilège ou à une politique, et non l'heureuse conséquence d'une dernière relecture.

---

## 2026-08-05 — `CRM-014` : les douze preuves de refus rassemblées, et ce qu'elles disent quand on les compte

### Décision 146 — La spécification a été écrite après avoir mesuré les douze scénarios, un par un

**Problème.** La Definition of Done de `CRM-014` tient en une ligne — « les 12 scénarios verts » —
et onze unités successives ont écrit dans leur propre backlog que telle ou telle preuve « restait
due par `CRM-014` ». Aucune n'a dit **combien** étaient satisfaisables. Ouvrir l'unité sur cette
base, c'était s'engager à rendre vert un tableau dont plusieurs lignes portent sur des tables qui
n'existent pas.

**Ce qui a été mesuré, avant d'écrire une ligne de spécification.** Chacun des douze scénarios a été
rejoué à la main contre la pile réelle, avec les jetons réels obtenus par la route de connexion :

| # | Mesure |
|---|---|
| 1 | `move_card` par le `viewer` : `403` / `42501` / `forbidden` sur une card qu'il voit ; `400` / `P0001` / `card_not_found` sur une card d'un channel fermé |
| 2 | `business_developer` insérant une étape : `403` / `42501`, message `new row violates row-level security policy` |
| 3 | chaîne complète créée dans un second workspace — workspace, track, workflow, nœud, étape, channel, card : `201` sept fois. L'`admin` de A lit `200` et `[]` ; son `PATCH` rend `200` et `[]` sans effet |
| 4 | `viewer` sur le channel `grands-comptes` : `200` et `[]`, quand la clé de service y voit cinq cards |
| 5 | `PATCH current_step_id` par l'`admin` : `403` / `42501` / `permission denied for table cards` |
| 6, 7 | `mail_inbound_accounts`, `mail_outbound_identities` : `404` / `PGRST205` — **tables absentes** |
| 8 | `card_events`, `audit_log` : `404` / `PGRST205` — **tables absentes** |
| 9 | `storage.buckets` : **vide** ; aucune table de pièces jointes |
| 10 | `admin` retirant son propre rôle : `200` et `[]` puis `204` ; rôle relu = `admin` |
| 11 | anonyme sur les **douze** tables métier peuplées : `200` et `[]` sur chacune |
| 12 | `queue_outbound_email` : `404` / `PGRST202` — **fonction absente** |

**Décision.** Le périmètre livrable est donc **sept preuves sur douze**, et il est mesuré, non
estimé. Les cinq autres portent sur des objets absents. La spécification — `docs/SPEC-permissions-rls.md`
§7.1 à §7.4 — est écrite à partir de ce tableau, et committée avant la première ligne de code.

**Conséquence.** Aucune preuve de substitution ne remplacera une preuve impossible. Les cinq
absences occupent une place nommée dans le fichier consolidé et sont **figées par une assertion**,
selon la convention posée par `CRM-006` puis reprise par `CRM-013`.

### Décision 147 — Rassembler des scénarios déjà verts n'est pas de la duplication, c'est la seule façon de compter

**Problème.** Sept des douze preuves sont déjà exercées quelque part : la n° 11 dans six fichiers,
la n° 3 dans quatre, la n° 2 dans trois, la n° 4 dans trois. La tentation était de déclarer l'unité
acquise par héritage et de n'écrire que le reste.

**Pourquoi c'eût été faux.** Chacune de ces preuves est un **corollaire** du contrat d'API de son
unité : elle prouve que *cette* table refuse *ce* profil. Aucune ne répond à la question que
`CRM-014` pose — *les douze sont-elles exercées, et lesquelles ne le sont pas ?* Tant que les
preuves sont réparties dans quatorze fichiers, cette question n'a aucun lieu où être posée, et
l'absence d'une preuve n'a aucun lieu où être vue. C'est précisément ce qui s'est produit pour la
n° 3 sur les cards : personne ne l'a écrite, et un commentaire de traçabilité affirmait qu'elle
existait (INC-057).

**Décision.** Un fichier consolidé, `e2e/api/preuves-refus.spec.ts`, rejoue les douze scénarios
dans l'ordre du tableau du §7. Les scénarios des unités précédentes ne sont **ni retirés ni
déplacés** : les retirer rouvrirait sept unités dans un commit qui n'en traite qu'une.

**Conséquence assumée.** Le projet `api` compte désormais des assertions redondantes. C'est le prix
d'un inventaire, et il est faible au regard de ce qu'il achète : une preuve manquante devient
visible au lieu d'être invisible.

### Décision 148 — La preuve n° 10 est obtenue, et elle ne prouve pas ce qu'elle a l'air de prouver

**Problème.** La preuve n° 10 exige qu'un dernier administrateur ne puisse pas se retirer son rôle.
MESURÉ : le `PATCH` rend `200` et `[]`, le `DELETE` rend `204`, et le rôle relu par la clé de
service vaut toujours `admin`. L'effet attendu est donc obtenu, et il eût été facile d'écrire un
scénario vert et de cocher la ligne.

**Pourquoi ce serait un mensonge.** L'écriture n'est pas refusée parce qu'une règle protège le
dernier administrateur — cette règle **n'existe pas**. Elle est sans effet parce que
`workspace_members` ne porte **aucune** politique, et retombe donc sur le refus par défaut de
`CRM-003`. Le jour où INC-014 sera arbitrée et les politiques d'identité écrites, la même requête
trouvera une ligne et la modifiera : la protection disparaîtra au moment précis où le produit
deviendra utilisable.

**Décision.** Le scénario mesure l'état réel **et dit ce qu'il ne prouve pas**, dans son propre
corps et dans `docs/SPEC-permissions-rls.md` §7.3. Il assère aussi, par pgTAP, que ces trois tables
portent **zéro politique** : le jour où l'une en recevra une, l'assertion deviendra rouge et
désignera la règle du dernier administrateur comme restant à écrire. La ligne n'est pas cochée dans
la Definition of Done ; elle est nommée comme **partiellement acquise**.

### Décision 149 — Le harnais dégrade la politique la plus centrale, pas la plus commode

**Problème.** La Definition of Done exige que le harnais « échoue si une politique est retirée ».
N'importe quelle politique ferait techniquement l'affaire ; le choix décide de ce que la preuve
vaut.

**Décision.** La politique retirée est `cards_lecture`, et la politique permissive posée l'est sur
`cards` pour `anon`. Motif : `cards` est la seule table dont dépendent **trois** des sept preuves
acquises — la n° 3, la n° 4 et la n° 11. Dégrader une table périphérique ferait échouer un scénario
isolé ; dégrader `cards` éprouve le fichier là où il porte le plus, et dans les deux sens — une
politique retirée (le produit refuse trop) comme une politique permissive (le produit accepte
trop).

**Ce que le harnais constate ensuite.** L'inventaire complet des politiques est relevé **avant** la
dégradation, table par table et nom par nom, puis comparé après restauration. La restauration est
constatée, jamais supposée — leçon des décisions 143 et 145, et de leurs quatre occurrences.

### Décision 150 — La séquence de restauration ne rejoue aucune migration

**Problème.** Quatre harnais ont laissé la base dégradée en rejouant une migration sans celles qui
la suivent (décisions 143 et 145, INC-055). Le remède harnais par harnais a échoué quatre fois.

**Décision.** `scripts/verify-preuves-refus.sh` **ne rejoue aucune migration**. Ses dégradations
sont des `drop policy` et des `create policy` ciblés, et sa restauration recrée exactement la
politique relevée, dont la définition est **lue en base avant d'être retirée** (`pg_get_expr` sur
`pg_policy`), jamais réécrite de mémoire. Un harnais qui n'a pas besoin de rejouer un préfixe de
l'historique ne peut pas laisser derrière lui l'état intermédiaire qu'INC-055 décrit.

**Portée.** Ce n'est pas une réponse générale à INC-055 — l'arbitrage y reste attendu. C'est la
constatation qu'un harnais peut souvent éviter le problème en dégradant au niveau où il vérifie,
plutôt qu'au niveau de la migration qui l'a posé.

### Décision 151 — Une suite de preuves de refus est structurellement aveugle au sur-refus, et la mesure l'a établie

**Prédiction écrite dans la spécification, avant le code.** Le §7.4 annonçait que retirer la
politique `cards_lecture` ferait échouer les scénarios n° 3, n° 4 et n° 11 — un `viewer` ne verrait
plus rien, l'anonyme non plus, et la preuve n° 4 perdrait sa condition de validité.

**MESURÉ, sur la pile réelle, la politique réellement retirée :**

```
drop policy cards_lecture on public.cards;
npm run e2e:api -- e2e/api/preuves-refus.spec.ts   →   37 passed
```

**Aucun scénario n'échoue.** La prédiction était fausse, et son erreur n'est pas un détail
d'écriture : c'est une propriété que je n'avais pas vue et qui vaut pour **toute** suite de preuves
de refus. Retirer une politique de lecture fait refuser *davantage*. Or chacune de ces assertions
attend soit zéro ligne, soit une erreur — un produit devenu plus strict les satisfait toutes. Les
conditions de validité elles-mêmes tiennent, puisqu'elles passent par la clé de service, qui
contourne la RLS.

Même la preuve n° 1 reste verte, et pour une raison mesurée : `move_card` est `SECURITY DEFINER` et
n'interroge pas la politique de lecture — elle appelle `app.can_write_channel`. Le `viewer` obtient
donc toujours `forbidden`, sur une card qu'il ne peut désormais plus lire.

**Ce que cela dit du harnais qu'on croyait avoir.** La Definition of Done de `CRM-014` exige que le
harnais « échoue si une politique est retirée ». Si l'unité n'avait livré que le fichier de
scénarios, cette exigence aurait été **impossible à satisfaire**, et il aurait été très facile de
ne pas s'en apercevoir : il suffisait d'écrire la dégradation sans mesurer son effet, ou de
constater « quelque chose a échoué » sans regarder quoi. C'est d'ailleurs le premier piège dans
lequel le harnais est tombé — son contrôle cherchait « PREUVE N° 4 » dans **toute** la sortie de
Playwright, où ce texte apparaît aussi sur les scénarios **verts**. Le contrôle était vert pour la
mauvaise raison, et la contradiction avec le contrôle voisin l'a dénoncé.

**Décision.** La détection du **sur-refus** est portée par la suite pgTAP, dont l'inventaire nomme
les quarante et une politiques et les compte ; la détection du **sur-accès** reste portée par les
scénarios HTTP. Le harnais éprouve les deux, dans les deux sens :

| Dégradation | Ce qui doit échouer | Mesuré |
|---|---|---|
| `cards_lecture` retirée | la suite pgTAP | échoue ; les scénarios restent verts, et l'assertion **fige ce fait** |
| politique permissive pour `anon` | les scénarios **et** la suite pgTAP | un seul scénario échoue — la preuve n° 11 sur `cards` — et le compte de 41 politiques tombe |

**Ce que le harnais assère désormais**, plutôt que de l'espérer : que le fichier reste vert sans
`cards_lecture`. Une assertion de ce genre paraît étrange jusqu'à ce qu'on voie ce qu'elle achète —
si un jour ce scénario échoue, c'est que la structure des preuves a changé, et la décision 151 doit
être révisée. La limite est figée, pas commentée.

**Portée générale.** Une suite qui ne contient que des preuves de refus mesure une **borne
supérieure** des droits, jamais une borne inférieure. Elle ne remarquera jamais qu'un produit a
cessé de fonctionner ; elle ne remarquera que le jour où il en fait trop. Les unités à venir qui
livreront des preuves d'autorisation — et non de refus — devront le savoir : la moitié manquante
est celle qui vérifie qu'un profil légitime **obtient** ce qui lui est dû, et elle vit aujourd'hui
dans les contrats d'API de chaque unité, non ici.

### Décision 152 — Le balayage de clôture a trouvé une contradiction entre deux harnais, et non un défaut du produit — INC-058

**Le geste.** La décision 145 posait qu'une unité touchant un privilège ou une politique doit finir
par un balayage : rejouer les harnais précédents **un par un** et relever l'état de la base après
chacun. `CRM-014` l'a fait, en mode **complet** — sans `--rapide` — et en mesurant après chaque
passage le nombre de politiques et le privilège d'écriture sur `cards.email_local_part`.

**Ce que le balayage a rendu.** Vingt harnais sur vingt et un verts, l'état de la base **inchangé**
après chacun — `41` politiques, `email_local_part` fermée. Aucune dette rétroactive de la sorte
qu'avait laissée `CRM-013`. Un seul écart : `scripts/verify-cards.sh`, `45 contrôles, 1 en échec`.

**La cause, et pourquoi elle n'est pas celle qu'on attendait.** L'échec porte sur son contrôle
`npm run test:sql`, et la sortie capturée désigne trois assertions de `CRM-013` :
« les neuf cards du seed sont intactes ». En échantillonnant le compte de cards toutes les trois
secondes pendant l'exécution, il vaut **14** puis **9** : le harnais crée cinq cards et les retire
dans son `trap EXIT`, donc **après** la section qui lance les suites. L'assertion compte, elle, la
table entière.

Ce n'est donc ni un défaut du produit, ni une mesure fausse : c'est une **composition**
contradictoire entre deux harnais qui, pris isolément, ont chacun raison.

**Vérifié comme antérieur à cette unité**, et non supposé tel : la suite pgTAP de `CRM-014` retirée
du répertoire, `scripts/verify-cards.sh` échoue à l'identique. La preuve tient en une commande, et
elle valait la peine d'être faite — attribuer à l'unité en cours un défaut qu'elle n'a pas causé
aurait été aussi faux que l'inverse.

**Décision.** Comportement **inchangé**, contradiction consignée en **INC-058** avec trois options
d'arbitrage. `scripts/verify-cards.sh` appartient à `CRM-040` et les trois assertions à `CRM-013` :
les corriger ici rouvrirait deux unités vérifiées dans un commit qui n'en traite qu'une.

**Ce que l'épisode ajoute à INC-055.** C'est la troisième fois qu'une règle de **composition** entre
harnais manque : un harnais qui rejoue un préfixe de migrations (INC-055), un garde-fou qui dépend
de l'âge de la base (INC-056), et maintenant une assertion qui compte une population globale qu'un
autre harnais fait varier (INC-058). Les trois se corrigent au cas par cas depuis trois unités. La
question de les écrire une fois pour toutes dans `docs/SPEC-test-harness.md` n'est plus une
suggestion : c'est le même défaut sous trois formes.

**Et une leçon de méthode, pour l'unité suivante.** Le défaut n'existe que sur le chemin **complet**
du harnais : `--rapide` saute la section des suites, et c'est ce mode que `CRM-013` avait employé
pour rapporter « 37 contrôles ». Un harnais dont deux modes ne mesurent pas la même chose finit par
n'être vérifié que dans le plus court.

## 2026-08-05 — Une exécution de la routine a livré `CRM-014` en double, et ne l'a su qu'au `push`

### Décision 154 — Un travail déjà livré par une autre exécution est abandonné, non fusionné

**Problème.** Une exécution de la routine ouverte à 04:56 UTC s'est resynchronisée — `origin/main`
valait `9a69350`, le commit documentaire de `CRM-014` —, a pris l'unité `CRM-014`, marquée `[ ]`, et
l'a implémentée intégralement : `e2e/api/preuves-refus.spec.ts` (37 scénarios verts),
`scripts/verify-preuves-refus.sh` (59 contrôles, quatre dégradations réelles), documentation,
captures verte et rouge observées, commit local `346a230` à 05:33. Au `git fetch` précédant le
`push`, `origin/main` valait `1364bf3` : **une autre exécution de la même routine avait livré la
même unité à 05:06.**

**Ce que la comparaison des deux livraisons a montré.** Elles concordent sur le fond, sans s'être
vues : mêmes sept preuves acquises, mêmes cinq absences figées, mêmes identifiants de seed, et
surtout **la même réfutation** de la prédiction du §7.4 — retirer `cards_lecture` ne fait échouer
aucun scénario. Deux mesures indépendantes du même fait valent mieux qu'une.

Elles divergent sur la conclusion à en tirer, et **la livraison poussée a raison**. La version
abandonnée concluait que la Definition of Done — « le harnais échoue si une politique est retirée » —
demandait une propriété impossible, et s'apprêtait à consigner cette impossibilité pour arbitrage.
La version poussée y répond : elle ajoute une suite pgTAP, `supabase/tests/0016_preuves_refus.test.sql`,
dont l'inventaire des 41 politiques **échoue réellement** au retrait de l'une d'elles. Le partage est
juste et vaut d'être retenu : **les scénarios détectent le sur-accès, l'inventaire détecte le
sur-refus**, et aucun des deux ne peut faire le travail de l'autre.

**Décision.** Le commit `346a230` n'est **pas** poussé, ni rebasé, ni fusionné par morceaux. Motifs :

1. les deux versions portent les **mêmes chemins de fichiers** — un rebase produirait un conflit
   dont la résolution consisterait à choisir l'une des deux, c'est-à-dire à refaire l'arbitrage à la
   main sur des centaines de lignes, sans preuve que le résultat mixte reste vert ;
2. la version poussée est **strictement meilleure** sur le seul point où elles divergent ;
3. récupérer des fragments supposerait de renuméroter décisions et entrées `INC` — les deux
   exécutions ont attribué `INC-058` à des faits différents —, donc de modifier une unité livrée
   par quelqu'un d'autre dans un commit qui n'en traite pas (`CLAUDE.md` §13).

**Ce qui est conservé du travail abandonné**, parce que cela ne double rien : la constatation que
deux exécutions se sont croisées. Elle est consignée en **INC-059**, avec les trois options
d'arbitrage.

**Vérification apportée à la livraison d'autrui, et c'est le seul apport net de cette exécution.**
`scripts/verify-preuves-refus.sh` a été rejoué sur un **conteneur neuf**, base recréée depuis les
migrations et seed réappliqué : **26 contrôles, aucune anomalie** ; `npm run test:sql` 1139
assertions, `npm run e2e:api` 291 scénarios, `npm run test:unit`, `npm run typecheck` et
`npm run build` verts. La livraison de 05:06 est donc reproductible ailleurs que sur la machine qui
l'a produite — ce qu'aucune exécution ne peut établir sur son propre travail.

**Portée.** La règle appliquée ici vaut pour toute exécution future : **refetch avant `push`, et
abandon si l'unité a été livrée entre-temps.** La resynchronisation d'ouverture ne protège de rien,
puisque le travail dure plus longtemps que l'instant qu'elle mesure.

---

## 2026-08-05 — `CRM-010` : ce que sa Definition of Done exige encore, mesuré avant d'être écrit

**Contexte.** Le balayage d'ouverture a compté **seize** unités `[~]`. Aucune n'est un chantier
inachevé : douze d'entre elles butent sur la même absence — l'écran de connexion, qu'aucune unité du
backlog ne porte (INC-021, arbitrage attendu depuis le 2026-08-04). La première unité `[~]` dans
l'ordre de `docs/MASTER_PLAN.md` §2 est `CRM-010`, et c'est la seule dont le motif d'attente s'est
**réellement éteint** : les quatre fonctions qu'INC-013 lui avait retirées existent toutes.

### Décision 155 — `CRM-010` est reprise parce que sa dépendance est levée, et sa Definition of Done n'est pas réécrite

**Problème.** INC-013 laisse deux points ouverts. Le premier — `app.can_read_card` différée faute de
table — est **éteint** : `CRM-040` a livré `cards` et la fonction. Le second est une question posée
au responsable : « la Definition of Done de `CRM-010` nomme six fonctions ; faut-il la réécrire à
quatre, ou la laisser porter une dette que d'autres unités soldent ? »

**Observation.** La question a été posée le 2026-08-03, à un moment où quatre des six fonctions
étaient **inécrivables**. Elle n'a plus le même objet : les six fonctions existent, elles sont
livrées, et la Definition of Done telle qu'elle est écrite est désormais **satisfaisable**. La
réécrire à quatre reviendrait à retirer de l'unité ce qu'elle nomme, au moment précis où cela cesse
d'être impossible.

**Décision.** La Definition of Done n'est pas réécrite. `CRM-010` est reprise pour la satisfaire
**telle qu'elle est**, en étendant ses propres preuves aux quatre fonctions écrites par
`CRM-012`, `CRM-036` et `CRM-040`. Ce n'est pas un arbitrage de produit rendu à la place du
responsable : c'est la lecture littérale d'un texte qui ne demandait qu'à devenir applicable. Même
mécanisme que la décision 123 sur INC-047.

**Conséquence.** INC-013 perd ses deux points ouverts et peut être close par cette unité. Aucune
autre unité n'est rouverte : les preuves ajoutées vivent dans les fichiers de `CRM-010`, et celles de
`CRM-012`, `CRM-036` et `CRM-040` ne sont pas touchées.

**Ce qui n'est pas décidé ici.** INC-014 (politiques des tables d'identité) et INC-021 (écran de
connexion) restent ouvertes et **inchangées**. `CRM-010` ne les approche pas.

### Décision 156 — Les trois exigences de la Definition of Done sont mesurées avant d'être spécifiées

**Problème.** Dire « il manque des preuves » ne suffit pas : il faut savoir **lesquelles**, et ce
qu'elles rendent réellement, avant d'écrire quoi que ce soit. La Definition of Done porte trois
exigences ; chacune a été confrontée à l'état réel de la pile.

**Observations, mesurées le 2026-08-05 sur la pile de développement, seed appliqué.**

1. **La matrice.** `CRM-010` a énuméré les 64 combinaisons sur `app.resolve_access`, fonction pure.
   La **jointure** qui alimente cette fonction — celle qu'INC-013 disait manquante — n'est éprouvée
   nulle part de façon exhaustive : `supabase/tests/0011_droits_fins.test.sql` en couvre un
   échantillon, choisi pour attraper le défaut de jointure externe de la décision 104.
2. **La récursion.** La démonstration existante porte sur `app.is_workspace_member` et
   `public.workspace_members`, et sur elles seules. Les trois fonctions qui lisent une table
   **elle-même protégée par RLS** — `tracks`, `channels`, `cards` — n'ont aucune démonstration
   mécanique. `docs/SPEC-permissions-rls.md` §3.3 en affirme une, mesurée à la main pendant
   `CRM-012` et jamais figée par une assertion.
   MESURÉ, chaque cas dans une transaction annulée, sous l'identité `viewer` du seed : adossée à la
   fonction **livrée**, une politique posée sur la table que celle-ci relit répond et rend
   exactement ce que rend la politique livrée — **3** tracks, **4** channels, **4** cards ; adossée
   à une jumelle `SECURITY INVOKER` de la même fonction, la même lecture épuise la pile, **54001**,
   sur les **trois** tables. La chaîne la plus longue du produit —
   `card_field_values` → `can_read_card` → `cards` → `can_read_channel` → `channels` — répond et
   rend **7** lignes.
3. **Le `search_path`.** L'exigence dit « toutes les fonctions `SECURITY DEFINER` ». `CRM-010` ne
   l'a vérifié que sur les sept de sa migration, les seules qui existaient alors. MESURÉ
   aujourd'hui : les schémas `app` et `public` portent **29** fonctions, dont **18**
   `SECURITY DEFINER`, et **aucune** sans `search_path` vide. L'état est bon ; ce qui manque est la
   preuve qui le **restera**.

**Décision.** Les trois exigences sont écrites dans `docs/SPEC-permissions-rls.md` §3.8 sous la forme
d'un contrat vérifiable — égalités à respecter, tableau des six cas de récursion et leurs résultats
mesurés, recensement plutôt que liste — et ce chapitre est committé **avant** la première ligne de
test. Le §3.8 n'introduit aucun comportement : il rassemble ce que trois unités successives ont
écrit sans qu'aucune ne le tienne d'un seul tenant.

**Conséquence pour la suite.** La troisième exigence est écrite comme un **recensement** et non
comme une liste de fonctions : elle tombera d'elle-même le jour où une unité ultérieure ajoutera une
fonction `SECURITY DEFINER` sans `search_path`, sans qu'aucun fichier ait à être tenu à jour à la
main. C'est un garde-fou de plus, au sens de la décision 51.

### Décision 157 — Un harnais déclarait vert un rejeu qu'il n'attendait pas, et c'est le rejeu de régression qui l'a trouvé

**Problème.** `npm run test:sql`, rejoué après l'extension des preuves, a rendu **trois assertions
rouges** dans `supabase/tests/0011_droits_fins.test.sql` — dont la preuve de refus n° 4. Aucune
migration n'avait été touchée, aucune politique réécrite, et la suite de `CRM-010` était verte.

**Observation, mesurée.** `tracks_lecture_membre` portait `app.is_workspace_member(workspace_id)`,
c'est-à-dire sa forme de `CRM-003` : les droits fins de `CRM-012` n'étaient plus appliqués. La
cause n'est ni dans le produit ni dans les preuves ajoutées, mais dans l'étape 2 de
`scripts/verify-authz.sh` :

```
docker compose … up -d migrations-runner
runner_code=$(docker inspect -f '{{.State.ExitCode}}' p2enjoy-migrations)
→ 0 running
```

`up -d` rend la main dès le démarrage du conteneur, pas à sa fin. Le `0` lu est celui de
l'exécution **précédente**, et le harnais rend la main pendant que le runner rejoue encore le
répertoire. Entre la migration 3 et la migration 10, la base est dans un état intermédiaire que le
produit ne connaît jamais — et c'est dans cette fenêtre que la suite suivante a mesuré.

**Deux défauts, pas un.** Le contrôle était **complaisant** — il aurait dit « code 0 » d'un rejeu en
cours ou sur le point d'échouer — et le harnais **laissait le produit dégradé derrière lui**.
Troisième occurrence du mécanisme des décisions 108 et 135, sous une forme nouvelle : les deux
précédentes rejouaient trop peu de migrations, celle-ci n'attend pas celles qu'elle déclenche.

**Décision.** `scripts/verify-authz.sh` emploie désormais `docker compose run --rm
migrations-runner`, **synchrone**, dont le code de sortie est celui du rejeu qu'il vient de lancer.
Ce n'est pas une invention : c'est déjà le procédé de `scripts/verify-tracks.sh`, et l'alignement va
du plus ancien vers le plus sûr. Un contrôle est ajouté derrière, qui vérifie non pas un code de
conteneur mais **l'état final de la base** — `tracks_lecture_membre` doit porter
`resolve_track_access`, la forme de la migration 10.

**Conséquence, et ce qui n'est pas fait.** `scripts/verify-migrations.sh`, livrable de `CRM-003`,
porte exactement la même écriture. La correction est connue et tient en trois lignes ; elle n'est
**pas** appliquée, parce que la porter reviendrait à modifier un livrable vérifié d'une autre unité
dans un commit qui n'en traite pas (`CLAUDE.md` §13), sans rejouer ses 23 contrôles sous leur propre
unité. Le piège reste donc armé, et il est **nommé** plutôt que laissé au hasard :
`docs/INCONSISTENCY_REPORT.md`, INC-060, avec trois options d'arbitrage.

**Ce que cet épisode confirme.** Une preuve qui n'est rejouée qu'une fois, juste après avoir été
écrite, ne dit rien de ce que le harnais laisse derrière lui. Les trois occurrences du mécanisme ont
toutes été trouvées par un **rejeu d'ensemble**, jamais par la suite de l'unité en cours.

### Décision 158 — Le rejeu des vingt-trois harnais a rendu quatre anomalies, dont une seule appartient à cette unité

**Problème.** Rejoués d'affilée, les vingt-trois harnais du dépôt rendent quatre anomalies. Les
attribuer à l'unité en cours serait aussi faux que les ignorer : chacune a été isolée et reproduite
séparément.

**Observations, harnais par harnais.**

1. **`scripts/verify-harness.sh` — 1 anomalie, ET ELLE APPARTIENT À CETTE UNITÉ.** « vert mais 1164
   assertions au lieu de 1139 ». C'est le compteur figé de la décision 51 qui fait exactement son
   travail : la reprise de `CRM-010` ajoute 25 assertions à `0002_fonctions_autorisation.test.sql`
   sans qu'aucun fichier ne soit créé. **Révisé dans le même changement**, à 1164, valeur mesurée ;
   `SCENARIOS_API` et `SCENARIOS_UI` restent à 291 et 37, l'unité ne livrant ni route ni écran.
   Quatrième révision de ce compteur, et la première sans retard.
2. **`scripts/verify-webapp.sh` — 10 anomalies, puis aucune.** INC-036, **septième** occurrence : le
   conteneur fournit la révision `1194` des navigateurs Playwright là où la version épinglée réclame
   `1234`. L'arborescence de compatibilité recréée hors dépôt, le harnais rend **41 contrôles,
   aucune anomalie**, `npm run e2e:ui` ses **37 scénarios** et `npm run e2e:api` ses **291**.
   Le coût d'entrée reste récurrent, comme l'entrée le prédisait.
3. **`scripts/verify-scripts.sh` — 1 anomalie, connue et documentée.** INC-044 : ni `ss` ni
   `netstat` sur cet hôte, donc la garde de ports conclut à tort que tout est libre. Le contrôle
   fait ce qu'on lui demande ; le défaut est celui de l'hôte. Inchangé.
4. **`scripts/verify-cards.sh` — 1 anomalie, DÉFAUT RÉEL ET NOUVEAU — INC-061.** Sa section 10
   rejoue `npm run test:sql` **avant** que son `trap` ne retire ses cinq cards de preuve : la base
   porte alors 14 cards au lieu de 9, et trois assertions de
   `supabase/tests/0015_colonnes_protegees.test.sql` — livrée par `CRM-013` **après** que cette
   section a été écrite — comptent précisément les neuf du seed. MESURÉ : l'échec est
   **reproductible**, et `npm run test:sql` lancé immédiatement après la sortie du harnais rend
   « 1164 assertions, aucune anomalie ».

**Décision.** Seule l'anomalie n° 1 est corrigée ici, parce qu'elle appartient à cette unité. La
n° 4 est **consignée sans être corrigée** : `scripts/verify-cards.sh` est un livrable de `CRM-040`,
et le reprendre dans un commit consacré à `CRM-010` toucherait ses 45 contrôles sans les rejouer
sous leur propre unité (`CLAUDE.md` §13). Les n° 2 et 3 sont des obstacles d'environnement déjà
consignés, dont la seule nouveauté est d'être vérifiés une fois de plus.

**Ce que ce rejeu confirme, et c'est la troisième fois.** Les trois défauts d'outillage trouvés
aujourd'hui — INC-060 et INC-061 — l'ont été par un **rejeu d'ensemble**, jamais par la suite de
l'unité en cours. Un harnais ne se juge pas sur ce qu'il mesure, mais sur ce qu'il laisse mesurable
à celui qui passe après lui.

### Décision 159 — L'identité Git du conteneur était de nouveau celle de l'agent, et les deux commits de l'exécution ont été réécrits

**Problème.** Le conteneur neuf rend `git config user.email` = `noreply@anthropic.com`. Le commit
documentaire de l'unité a été créé **et poussé** sous cette identité avant que l'écart ne soit vu :
la vérification n'a eu lieu qu'après le second commit. `CLAUDE.md` §13 l'interdit sans réserve —
« un agent ne s'attribue jamais la paternité, même partielle, d'un commit ».

**Observation.** Troisième occurrence du point 2 d'INC-034, et la première où un commit fautif est
déjà **poussé**. Les 36 commits antérieurs du dépôt portent tous
`P2Enjoy <contact@p2enjoy.studio>`.

**Décision.** Configuration locale reposée, puis les **deux** commits de cette exécution réécrits
pour porter l'identité du responsable, et republiés. Aucun commit antérieur n'est touché, aucun
commit d'une autre exécution n'est concerné. Le motif est celui déjà retenu et journalisé : §13
prévoit l'instruction explicite du responsable pour réécrire un commit poussé, aucune instruction
n'est atteignable pendant une exécution automatique, et la règle d'attribution est elle-même **non
négociable**. Le précédent existe et est documenté — INC-034 —, il est suivi plutôt que réinventé.

**Conséquence pour le point 2 d'INC-034.** Reposer la configuration « au début de l'exécution » ne
suffit pas : il faut la reposer **avant le premier commit**, ce qu'aucun mécanisme du dépôt ne
garantit aujourd'hui. Le correctif durable — script d'amorçage versionné, ou variable
d'environnement fournie par la routine — cesse d'être un confort.

### Décision 160 — Le chapitre « Rendu » disait ce que l'écran montre sans dire comment il le compose, et il est réécrit avant la première ligne de code

**Problème.** `CRM-037` est la première unité `[ ]` du plan dont l'ordre est atteint
(`docs/MASTER_PLAN.md` §2, étape 3.c). Sa spécification tenait en **cinq lignes** —
`docs/SPEC-form-composer.md` §4 —, écrites à `CRM-000`, avant que `form_fields`,
`form_field_rules`, `card_field_values` et `move_card` n'existent. Elles décrivent correctement ce
que l'écran **montre**, et ne disent rien de ce qu'il faut **composer** pour y arriver, ni de ce
qu'il faut en **prouver**.

**Ce que la mesure a montré, et qui a orienté la rédaction.** Le seed a été relu en base, et non de
mémoire : sept champs dont un archivé, dix-sept règles de visibilité, neuf cards, quatorze valeurs.
Deux faits en sortent, qu'aucune prose n'annonçait :

1. à l'étape `Prospection`, cinq règles pour six champs actifs : **un champ n'a aucune règle** et
   doit apparaître par le défaut `visible` du §3.1. Une lecture par les règles le perdrait sans
   qu'aucune erreur ne le signale ;
2. la card `…0000c6` est à `Prospection`, où `motif-perte` est `hidden`, et **porte pourtant une
   valeur** pour ce champ. La section repliée « Informations d'autres étapes » n'est donc pas une
   hypothèse d'écran : le seed la remplit déjà.

**Décision.** Le §4 est réécrit en contrat vérifiable — algorithme de composition, trois
destinations, définition de « renseigné », contrat d'accessibilité, écran hôte, et ce qui n'est pas
livré —, et le §7.3 est doublé d'un second tableau qui énumère les preuves **atteignables**. Les
cinq règles d'origine sont **citées mot pour mot** plutôt que reformulées : elles sont justes, elles
étaient seulement incomplètes. Commit documentaire dédié, poussé avant la première ligne de code
(`CLAUDE.md` §5).

**Une addition, et une seule, au-delà de la lettre du §4 : le champ archivé.** Le §5 pose depuis
`CRM-000` que l'archivage d'un champ « le retire des formulaires sans supprimer les valeurs déjà
saisies, qui restent consultables **dans la section repliée** ». Le §5 nommait donc cette
destination que le §4 ignorait. Elle est écrite au §4.2 plutôt que laissée à l'interprétation du
composant, et le seed la rend démontrable — il porte un champ archivé, et une card porte une valeur
pour lui.

**Conséquence pour la suite.** Le §4.3 impose que l'interface et `app.valeur_de_champ_est_vide`
donnent la même lecture de « renseigné ». Deux codes, deux langages, deux processus : l'égalité
n'est pas démontrable par relecture. Elle est donc rendue vérifiable par un **tableau de cas
partagé**, exercé d'un côté par le test unitaire du prédicat TypeScript, de l'autre par une preuve
d'API qui écrit les mêmes valeurs dans de vraies lignes et demande à `move_card` de trancher. Une
divergence future rend la preuve rouge, quel que soit le côté qui a bougé — mécanisme de la
décision 51.

### Décision 161 — La Definition of Done de `CRM-037` exige un geste que l'unité suivante est seule à livrer, et l'écart est consigné plutôt que contourné

**Problème.** La Definition of Done de `CRM-037` exige « E2E (transition bloquée, saisie,
transition réussie) ». Les trois gestes supposent une session (INC-021), un contrôle de transition
(`CRM-041`) et une écriture depuis l'écran (INC-021 de nouveau). `docs/MASTER_PLAN.md` §2 place
`CRM-041` **après** `CRM-037`, et cet ordre est justifié — le board s'appuie sur la garde
`move_card`, le formulaire sur les étapes.

**Observation.** Il n'y a donc **pas d'erreur d'ordre à corriger**. Il y a une preuve écrite en
supposant un écran que le plan livre plus tard. C'est le sixième cas du motif d'INC-010, INC-013,
INC-029, INC-031 et INC-037 ; la nouveauté est que l'objet manquant n'est pas une table mais un
**geste d'interface**.

**Décision.** Trois options sont portées à l'arbitrage — INC-062 —, et **aucune n'est appliquée en
silence**. `CRM-037` livre le rendu, son écran hôte et ses preuves atteignables ; elle n'invente ni
contrôle de transition, ni parcours de connexion. L'unité restera `[~]` avec sa limite nommée, comme
`CRM-030` l'a fait pour sa garde d'archivage.

**Ce que ce constat change pour le chunk 3.** C'est la **sixième** unité consécutive à buter sur
INC-021, et la première dont la Definition of Done est rendue inatteignable par une **unité du
plan** autant que par l'arbitrage manquant. L'arbitrage d'INC-021 ne débloquerait pas à lui seul la
première ligne du §7.3 : il faudrait encore `CRM-041`.

### Décision 162 — Une case à cocher de 20 px n'existait pas, et c'est le contrôle de classes qui l'a dit

**Problème.** La première capture du formulaire montrait une case à cocher de 16 px, seule cible
interactive du produit sous les 40 px exigés par `docs/DESIGN_SYSTEM.md` §8. La case a donc été
portée à 20 px — `size-5` — dans une ligne de hauteur `--size-target`.

**Observation, mesurée.** `scripts/verify-formulaire.sh` a rendu « des classes citées n'existent pas
dans le CSS produit : `size-5` ». L'échelle d'espacement du §3 est **fermée** — 4, 8, 12, 16, 24,
32, 48 — et `--spacing-5` n'est pas déclarée : la classe n'était donc **pas engendrée du tout**, en
silence, et la case n'avait aucune taille. C'est exactement le mode de défaillance que le §11
décrit, et pour lequel `scripts/lib/classes-css.mjs` a été écrit à `CRM-007` après la disparition
de `min-w-0`.

**Décision.** La case passe à **24 px** — `size-6`, valeur de l'échelle —, et la règle est écrite au
§5.7 bis du design system avec **le motif du choix**, pour que le prochain à écrire un formulaire
ne reprenne pas `size-5`. La ligne de hauteur `--size-target` est conservée : c'est elle qui donne
la cible, la case n'ayant pas à devenir un champ de saisie pour être atteignable.

**Ce que cet épisode confirme.** La règle « aucune valeur intermédiaire » du §3 n'est pas une
préférence de style : elle est **opposable**, et son application est silencieuse. Deux défauts de ce
type ont été trouvés par le même contrôle, jamais à l'œil — la classe manquante ne produit ni
erreur, ni avertissement, ni différence visible tant qu'on ne compare pas au rendu attendu.

### Décision 163 — Deux règles visuelles écrites en regardant une capture, et non en lisant un test

**Problème.** Les preuves du rendu étaient vertes — 30 tests de composition, 23 du composant,
15 scénarios d'API — et deux écarts au design system subsistaient, invisibles à toute assertion
existante.

**Observations, en regardant les captures.**

1. La case à cocher, isolée, était la seule cible interactive du produit sous 40 px (§8).
2. Le montant `72000`, affiché en lecture seule dans la section repliée, était rendu en corps de
   texte, alors que le §2 range « montants, horodatages, identifiants » parmi les **données
   techniques** : monospace, chiffres tabulaires.

**Décision.** Les deux règles sont écrites au **§5.7 bis** du design system, avec leur motif, et
tenues chacune par un test unitaire dans le même changement. La seconde n'introduit aucune classe :
la règle vit déjà dans `webapp/src/styles/app.css`, portée par `code` — le rendu l'emploie plutôt
que de la dupliquer. `url` en est exclue, et le motif est écrit : une adresse se lit, elle ne se
compare pas colonne par colonne.

**Ce que cet épisode confirme, et c'est la troisième fois.** Les écarts au design system se trouvent
en **regardant**, pas en lisant des tests verts — comme le contraste des pilules à `CRM-020` et le
débordement des onglets à `CRM-021`. `CLAUDE.md` §16 n'est pas une formalité de fin de tâche : les
deux règles ci-dessus n'existeraient pas sans elle.

### Décision 165 — Le prédicat « renseigné » de l'interface employait `trim()` là où la garde emploie `btrim`, et la mesure l'a dénoncé

**Contexte.** Deux exécutions de la routine ont travaillé `CRM-037` en parallèle, la première ayant
livré son implémentation pendant que la seconde écrivait la sienne. La seconde a **abandonné son
code** — c'est le geste déjà pris à `CRM-014`, et refaire un travail commité n'apporte rien — mais
elle avait mesuré un cas que la première n'avait pas : `webapp/src/lib/valeur-renseignee.ts`
transcrivait la clause « chaîne vide après `btrim` » du §6.6 par `String.prototype.trim()`.

**Problème.** La transcription est **fausse**, et l'erreur est invisible à la relecture comme à
l'œil sur une capture. `btrim(texte)` sans second argument retire les **espaces** (U+0020) et eux
seuls ; `trim()` retire toute l'espace blanche Unicode. Une valeur réduite à une tabulation est donc
**renseignée** pour `app.valeur_de_champ_est_vide`, et **vide** pour l'interface.

**Reproduit avant d'être corrigé** (`CLAUDE.md` §18). Les deux cas ont été ajoutés au tableau de cas
partagé, sans toucher au prédicat : `webapp/src/lib/formulaire.test.ts` a rendu **deux tests
rouges**, et `e2e/api/rendu-formulaire.spec.ts` **deux scénarios rouges** contre la base réelle —
« `app.valeur_de_champ_est_vide` juge `"\t"` renseignée ; la lecture TypeScript dit vide ». C'est
exactement l'égalité que le §4.3 exige, prise en défaut.

**Correction.** `estRenseigne` porte désormais sa propre fonction `retirerEspaces`, qui ne retire
que l'espace U+0020. Les deux cas restent dans le tableau partagé, et une assertion nommée les
répète pour que l'intention ne dépende pas d'une ligne de tableau. `scripts/verify-formulaire.sh`
gagne une dégradation **D2 bis** qui remet `trim()` en place et **confronte le résultat à la base** :
seule cette confrontation peut attraper ce défaut, aucun test unitaire écrit seul ne l'aurait vu.

**Ce que la correction ne fait PAS.** Elle n'élargit pas ce que le produit tient pour vide. La
propriété de `btrim` est celle d'INC-052, relevée à `CRM-034` sur le commentaire de `move_card` ;
c'en est la **seconde occurrence**, consignée là-bas, et l'arbitrage reste dû. Les deux lectures sont
désormais **identiques** — ce que le §6.6 exige — y compris dans ce qu'elles laissent passer.

**Ce que l'épisode enseigne sur le harnais.** La première exécution avait écrit le bon mécanisme —
tableau de cas partagé, confronté à la base — et il n'a rien attrapé, parce que **le tableau ne
contenait pas le cas**. Un mécanisme de comparaison ne vaut que ce que valent les cas qu'on lui
donne : c'est le même enseignement que la décision 50 sur les tables vides.

### Décision 166 — Un contrôle de restitution comparait au dernier commit, et ne pouvait donc pas être vert pendant qu'on travaille

**Problème.** La section 7 de `scripts/verify-formulaire.sh` vérifie que le harnais a bien restauré
les trois fichiers qu'il dégrade volontairement. Elle le faisait par `git diff --quiet -- <fichier>`,
c'est-à-dire en comparant à **`HEAD`**.

**Observation, mesurée.** Ce contrôle ne distingue pas les deux choses qu'il doit distinguer :
« une dégradation n'a pas été restaurée » — ce qu'il cherche — et « le fichier porte un changement
non encore committé » — l'état normal de tout travail en cours. Le harnais a rendu
`46 contrôles, 1 en échec` sur une correction de `webapp/src/lib/valeur-renseignee.ts` pourtant
**parfaitement restaurée** : le fichier différait de `HEAD` parce que la correction n'était pas
encore committée, et pour aucune autre raison.

**Portée.** Elle est générale, pas anecdotique : le contrôle serait rouge pour **toute** modification
de `formulaire.ts`, `valeur-renseignee.ts` ou `FormulaireCard.tsx` tant qu'elle n'est pas committée —
donc à chaque fois qu'on s'en sert pour vérifier ce qu'on vient d'écrire, ce qui est précisément son
moment d'emploi.

**Décision.** Le harnais prend une **empreinte des trois fichiers à son entrée**, et la section 7
compare à cette empreinte plutôt qu'à `HEAD`. Elle mesure alors exactement ce qu'elle prétend
mesurer : ce que le harnais a laissé derrière lui, indépendamment de l'état du dépôt.

**Ce que ce défaut n'est pas.** Il n'est pas complaisant — c'est l'inverse, il est trop strict, et
c'est ce qui le rend dangereux d'une autre façon : un contrôle qui ne peut pas être vert pendant
qu'on travaille finit par être ignoré, et le jour où il dénonce une vraie dégradation, plus personne
ne le lit. C'est le pendant des décisions 143, 145 et 157, qui traitaient toutes de contrôles
**trop** indulgents.

**Ce qui n'est pas fait, et pourquoi.** Les autres harnais du dépôt n'ont pas été relus à ce titre
dans ce passage : ce sont les livrables d'autres unités, et les reprendre ici rouvrirait celles-là
(`CLAUDE.md` §13). Le constat est porté par INC-064 pour que la revue soit faite là où elle
appartient.

### Décision 167 — La barre d'onglets d'une card se lit avec le chargeur des channels, et non avec un second

**Problème.** `CRM-037` a livré la route `/tracks/:slugTrack/:slugChannel/cards/:idCard` en
transmettant `slugTrack` à la coquille sans lui donner les channels du track porteur. La barre
d'onglets affichait donc « Aucun channel » sur **toute** route de card, alors que
`docs/DESIGN_SYSTEM.md` §4 pose « Onglets : les channels du track courant » et que cette route en
porte un. Le défaut avait été relevé sur une capture pendant la livraison, et laissé volontairement
en l'état pour ne pas mêler deux sujets dans un commit (`CLAUDE.md` §13) — « à reprendre au prochain
passage sur `CRM-037` ». C'est ce passage.

**Hypothèses écartées.**

- *Écrire une lecture des channels propre à la route de card.* Deux chargeurs pour les mêmes lignes
  finissent par diverger : l'un filtrerait les archivés, l'autre non ; l'un ordonnerait par
  `position` puis `name`, l'autre par `position` seul. La règle du §5 de `docs/SPEC-channels.md` est
  déjà écrite une fois, elle est réemployée telle quelle — `useContenuTrack`, qui résout le track
  par son slug puis lit ses channels.
- *Calculer l'onglet actif à partir de `slugChannel`.* Inutile, et coûteux : le patron du §5.3 est
  une navigation par `NavLink` vers `/tracks/:slugTrack/:slugChannel`, dont l'état actif se résout
  par préfixe de segments. MESURÉ dans le navigateur : sur
  `/tracks/inter-entreprises/formations/cards/…c6`, l'onglet `formations` porte
  `aria-current="page"` sans qu'aucune règle ne soit ajoutée. Une seconde définition de « onglet
  courant » aurait été une occasion de divergence de plus.

**Décision.** `RouteCard` charge le contenu du track porteur par `useContenuTrack` et le transmet à
la coquille — `etatChannels`, `onRechargerChannels`, `slugTrack` —, exactement comme `RouteTrack`.
Le formulaire, lui, continue d'être chargé par `useContenuCard` : les deux chargements sont
indépendants, comme le sont déjà ceux du contexte d'espace de travail et des tracks depuis
`CRM-020`.

**Conséquences, y compris celles qui coûtent.**

- Deux requêtes de plus sur la route d'une card — la résolution du track, puis ses channels. Elles
  ne sont pas gratuites, et elles sont le prix de la règle du §4 du design system. La seconde n'est
  pas émise lorsque la première rend zéro ligne, ce que le chargeur fait déjà.
- Un échec de chargement des channels **remplace le formulaire** par l'état d'erreur, la coquille
  décidant sur l'ensemble des chargements. C'est la règle déjà posée pour la route d'un track :
  aucun échec n'est avalé par une barre qui n'a la place ni de l'expliquer, ni d'offrir une reprise.
  Le comportement est écrit au §4.6 bis plutôt que découvert.
- L'appelant étant anonyme (INC-021), l'écran **ne change pas** aujourd'hui : la résolution du track
  rend zéro ligne et la barre garde son état vide. Ce qui change est la **raison** de cet état, et
  elle est désormais mesurable — la preuve d'interface substitue la réponse réseau et montre les
  onglets réels.

**Ce que la décision a rendu visible, et qui n'est pas tranché.** Alimenter la barre depuis
`slugTrack` met en évidence que rien ne confronte le couple `(slugTrack, slugChannel)` de l'adresse
à la card qu'elle désigne : une adresse incohérente affiche le formulaire de la card sous les
onglets d'un autre track. Aucun droit n'est contourné — les deux lectures restent soumises à leurs
politiques —, mais aucune spécification ne dit ce qu'une telle adresse doit rendre. Consigné en
**INC-065**, comportement inchangé, arbitrage demandé.

**Vérifications.** Test unitaire du chargement transmis par la route, preuve d'interface sur le
build de production — requête `channels` réellement émise et filtrée sur `track_id`, onglets rendus
et onglet courant marqué, réponse substituée —, captures produites et observées.

---

## 2026-08-05 — `CRM-041` : spécification du board kanban, écrite après mesure et avant tout code

### Décision 168 — Le chapitre « Interface » disait ce que l'écran montre sans dire ce qu'il lit, et il est réécrit avant la première ligne de code

**Problème.** `docs/SPEC-workflow-engine.md` §7 tenait en **cinq lignes** écrites à `CRM-000`. Elles
posent des règles justes — une colonne par étape, un menu listant exactement les transitions
déclarées, un dépôt impossible sans appel, un refus qui replace la card — mais aucune ne dit **ce
que le board lit**, en combien de requêtes, dans quel ordre les colonnes et les cards se rangent,
ni ce qu'il faut prouver. Une unité dont la spécification n'est pas écrite ne peut pas commencer
(`docs/MASTER_PLAN.md` §1.2). C'est exactement la situation que `CRM-037` avait rencontrée sur le
§4 du form composer (décision 160), et le même remède est appliqué.

**Ce qui a été mesuré avant d'être écrit**, et non rappelé de mémoire :

- le seed en base — sept étapes par workflow, dix transitions, six channels, neuf cards dont une
  archivée et une en corbeille, `grands-comptes` occupant **deux** étapes sur sept ;
- les réponses de PostgREST aux quatre lectures du board, avec le jeton réel de l'administratrice,
  y compris la jointure embarquée vers le catalogue de nœuds ;
- les **sept** refus de `move_card`, un par un, avec leur code HTTP, leur `code` et leur `details` :
  `transition_not_allowed`, `comment_required`, `missing_required_fields` — dont le `details` porte
  `lien-proposition` —, et le `401` de l'anonyme ;
- que `workflow_transitions` ne porte **aucune colonne `position`**, ce qui décide de l'ordre du
  menu ;
- que `profiles` rend `200` et `[]` **même à l'administratrice** (INC-014), ce qui décide de
  l'absence d'avatar ;
- que le seed pose `entered_step_at` à `now()`, ce qui rend la pastille d'ancienneté indémontrable
  par une donnée permanente.

**Décision.** Le §7 est réécrit en quatorze sous-chapitres opposables, les cinq règles d'origine
**citées mot pour mot** et rattachées chacune au sous-chapitre qui la rend vérifiable. Aucun
nouveau document n'est créé : le board est la vue du graphe, et la garde qu'il exerce vit déjà ici.

**Conséquences, y compris celles qui coûtent.** Le chapitre passe de cinq lignes à un contrat de
quatre lectures, sept refus et cinq niveaux de preuve. Il engage `CRM-041` à davantage que ce que
les cinq lignes laissaient croire — et c'est le but : ce qui n'est pas écrit avant le code n'est
pas prouvé après.

### Décision 169 — `workflow_id` rejoint la lecture partagée des channels, plutôt qu'une seconde lecture des mêmes lignes

**Problème.** Le board a besoin du workflow de son channel pour composer ses colonnes. La coquille
lit déjà les channels du track — `id, name, slug, position` — et `CRM-021` avait **délibérément**
écarté `workflow_id` : « elle est de surcroît nulle partout jusqu'à `CRM-031` (INC-029) — le
demander donnerait l'illusion d'une donnée exploitable ».

**Hypothèses écartées.** *Écrire une lecture du channel propre à la route du board.* C'est la faute
que la décision 167 a corrigée il y a un commit : deux lectures des mêmes lignes finissent par
diverger — l'une filtrerait les archivés, l'autre non. `docs/SPEC-channels.md` §5.4 pose la règle
générale, et elle vaut pour une colonne autant que pour une route.

**Décision.** `workflow_id` est ajoutée à `COLONNES_CHANNEL`, la lecture partagée. MESURÉ : le
motif de son absence a disparu — les six channels du seed portent un workflow, et la colonne est
`NOT NULL` depuis `CRM-033`. Le channel courant est donc **résolu dans la liste déjà chargée**, par
son slug, sans aucune requête supplémentaire.

**Conséquences.** La barre d'onglets transporte une colonne qu'elle n'affiche pas — un écart au
principe « une requête ne rapporte que ce qui est affiché », assumé et écrit. Le prix de l'inverse
serait une requête par ouverture de board et une seconde définition de « channel non archivé ».

### Décision 170 — Le glisser-déposer natif HTML5 est retenu **parce qu'il a été mesuré pilotable**, non parce qu'il est le plus simple

**Problème.** La Definition of Done de `CRM-041` exige une **vidéo `.webm` du glisser-déposer**. Une
spécification qui prescrirait un patron que le harnais ne sait pas jouer rendrait cette preuve
inatteignable, et l'écart n'apparaîtrait qu'au moment de la produire — c'est-à-dire après le code.

**Ce qui a été mesuré.** Une page d'essai portant un `draggable` et les trois écouteurs
`dragstart` / `dragover` / `drop`, pilotée par le Playwright **réellement épinglé** (1.62.1) dans
Chromium : `locator.dragTo()` déclenche bien le dépôt, **et** une séquence
`mouse.down` / `mouse.move` / `mouse.up` aussi. La seconde est celle qui produit une vidéo
exploitable ; `dragTo` saute d'un point à l'autre.

**Décision.** Patron natif HTML5. Une cible non atteignable n'appelle **pas** `preventDefault()` sur
`dragover`, ce qui fait refuser le dépôt par le navigateur lui-même : le refus visuel de la
troisième règle d'origine est obtenu sans qu'aucune ligne ne compare quoi que ce soit au moment du
dépôt, et aucun appel ne peut partir.

**Conséquences.** Le geste dépend d'une API du navigateur plutôt que d'une bibliothèque ; il n'a
pas d'équivalent tactile. Le chemin clavier n'est pas une compensation ajoutée après coup : c'est
le menu de transitions, que `docs/DESIGN_SYSTEM.md` §8 exige déjà.

### Décision 171 — Une transition qui exige un motif n'est jamais optimiste

**Problème.** `docs/DESIGN_SYSTEM.md` §6 veut le glisser-déposer **optimiste**. Quatre transitions
du seed exigent un commentaire. Déplacer la card, appeler, recevoir `comment_required`, remettre la
card en place puis demander le motif ferait faire à l'utilisateur un aller-retour dont le client
connaît d'avance l'issue — exactement ce que la troisième règle du §7 refuse pour les colonnes non
atteignables.

**Décision.** Le geste ouvre une saisie **avant** d'appeler, et la card ne bouge pas tant que le
motif n'est pas donné. L'optimisme est conservé pour toutes les autres transitions.

**Conséquence qu'il aurait été confortable de taire.** `move_card` contrôle le motif et ne l'écrit
nulle part — `card_comments` est `CRM-043`, INC-048. La saisie **le dit** : le motif est exigé pour
valider le déplacement, et il n'est pas encore conservé. Laisser croire à un enregistrement serait
la valeur par défaut trompeuse que `CLAUDE.md` §18 proscrit.

### Décision 172 — Ce que le board ne peut pas montrer est nommé dans la spécification, pas découvert à la capture

**Problème.** `docs/DESIGN_SYSTEM.md` §5.1 énumère six contenus pour une carte de card. Deux ne sont
pas produisibles aujourd'hui, et s'en apercevoir en regardant une capture aurait été trop tard.

**Ce qui a été mesuré.** `GET /rest/v1/profiles?select=id,full_name` avec le jeton réel de
l'administratrice rend `200` et `[]` : les trois tables d'identité restent en refus par défaut
(INC-014). `owner_id` est lisible, le nom ne l'est pas. Et aucune table d'étiquettes n'existe, ni
aucune unité qui en porte une.

**Décision.** La carte n'affiche **rien** pour le responsable, plutôt qu'un identifiant technique à
la place d'un nom. Les deux absences sont écrites au §7.4 dans un tableau qui traite les six
contenus du §5.1, aucun passé sous silence.

**Une troisième absence, d'une autre nature.** La pastille d'ancienneté est **livrée**, mais aucune
card du seed ne l'exerce au-delà de son seuil : MESURÉ, `entered_step_at` vaut `now()` à
l'application du seed, contre des seuils de 5 à 30 jours. La règle est donc prouvée par un test
unitaire et par une réponse substituée, jamais par une donnée permanente. Le manque appartient au
seed de démonstration, `CRM-046`.

### Décision 173 — L'éditeur de workflow est conservé mot pour mot et n'est livré par personne — INC-066

**Problème.** La cinquième ligne du §7 d'origine décrit un **écran** — « l'éditeur de workflow est
réservé aux administrateurs » — qu'aucune unité du backlog ne porte. Sept unités ont livré sa
matière sans une ligne d'interface, et chacune l'a nommé.

**Hypothèses écartées.** *La retirer du document*, puisque rien ne la livre : ce serait effacer une
exigence du responsable. *La livrer dans `CRM-041`* : ce serait inventer un périmètre que personne
n'a demandé, sur une unité déjà large.

**Décision.** Conservée intacte au §7.13, explicitement hors du périmètre de `CRM-041`, et consignée
en **INC-066** avec trois options d'arbitrage. Aucune n'est appliquée.

## 2026-08-05 — `CRM-041` : le board livré, et trois défauts que la mesure a dénoncés

### Décision 174 — Deux gardes sur trois étaient invérifiables, et c'est une dégradation du harnais qui l'a établi

**Problème.** La troisième règle d'origine du §7 exige qu'un dépôt sur une colonne non atteignable
soit « refusé visuellement **et** ne déclenche aucun appel ». La preuve d'interface écrite d'abord
ne constatait que la seconde moitié — aucun appel émis. La dégradation **D7** du harnais, qui retire
la garde de `dragover`, la laissait **verte**.

**Ce que la mesure a établi.** Le composant portait **trois** gardes redondantes : celle de
`dragover`, celle de `drop`, et la recherche de transition dans `deposer`. Chacune suffit à empêcher
l'appel ; aucune assertion portant sur « aucun appel » ne peut donc distinguer laquelle est
présente. La seule chose que la garde de `dragover` contrôle **seule** est le refus **visuel** —
l'indication de zone de dépôt, et le refus du navigateur lui-même.

**Deux obstacles ont dû être levés pour rendre ce refus observable, et les deux sont mesurés.**

1. *L'indication s'éteignait aussitôt allumée.* Le composant écoutait `dragleave` pour l'éteindre.
   MESURÉ dans Chromium : `dragleave` remonte des enfants, et son `relatedTarget` est **nul**
   pendant un glisser-déposer — il n'y a aucun moyen de distinguer « le pointeur quitte la colonne »
   de « le pointeur entre dans une carte de la colonne ». L'écouteur est **retiré** : l'état de
   survol est unique pour tout le board, passer d'une colonne à l'autre l'écrase, et la fin du
   glissement l'éteint. C'est aussi un clignotement de moins pour l'utilisateur.
2. *Le harnais ne provoquait aucun `dragover` sur la colonne visée.* MESURÉ en comptant les
   événements : un unique `mouse.move` qui **s'arrête** sur une colonne n'y fait dispatcher **aucun**
   `dragover` par Chromium, quand une colonne simplement traversée en recevait deux. La preuve était
   verte sans rien mesurer. Le pointeur continue désormais de bouger **à l'intérieur** de la colonne
   — ce que fait aussi une main.

**Décision.** La preuve d'interface constate désormais que la colonne non atteignable **ne se
signale jamais** comme zone de dépôt, et que l'atteignable, elle, se signale. La dégradation D7 la
fait tomber — vérifié dans les deux sens.

**Ce que l'épisode dit du procédé.** Le harnais a fait exactement son travail : il a dénoncé une
preuve complaisante, et non un défaut du produit. C'est la quatrième fois qu'une dégradation
volontaire trouve un trou dans la preuve qu'elle éprouve (décisions 143, 145, 157), et la première
où elle conduit à **simplifier le composant** plutôt qu'à renforcer un contrôle.

### Décision 175 — Le liseré d'un nœud neutre était invisible, et c'est une capture qui l'a dit

**Problème.** `docs/DESIGN_SYSTEM.md` §5.1 pose un « liseré supérieur de 3 px à la couleur du
nœud ». Écrit en `bg-border`, celui d'un nœud `neutral` disparaissait sur la surface blanche d'une
carte : sur la capture, `Prospection` semblait n'en porter aucun quand `Relance` portait le sien.

**Décision.** `--color-text-3`, le jeton que le **point neutre** d'un badge emploie déjà (§5.6). Un
neutre discret, mais lisible. Règle écrite au §5.2 bis du design system dans le même changement.

**Ce que l'épisode confirme.** Aucun test ne pouvait l'attraper : la classe existait, elle était
engendrée, le contrôle de classes était vert. C'est le troisième défaut de cette nature trouvé **en
regardant une capture** (décisions 46, 163) — et la raison pour laquelle `CLAUDE.md` §16 exige
d'observer, pas seulement d'exécuter.

### Décision 176 — Une transition qui exige un motif suspend le geste, et l'écran dit que le motif est perdu

**Rappel de la décision 171**, appliquée telle quelle : le geste ouvre une saisie **avant** d'appeler,
et la card ne bouge pas tant que le motif n'est pas donné.

**Ce qui s'y ajoute à l'implémentation.** La saisie **nomme** le fait que le motif n'est pas
conservé — `card_comments` est `CRM-043`, INC-048. Un utilisateur qui motive une affaire perdue doit
savoir que son motif valide le déplacement et disparaît ensuite. Trois preuves le tiennent : le
composant l'affiche, un test unitaire l'exige (`/conserv/i`), et la capture le montre.

### Décision 177 — Les colonnes du board sont déclarées une seule fois, dans un module sans import

**Problème.** Les quatre chaînes `select` du board doivent être exercées des **deux** côtés : par le
test unitaire, qui vérifie la requête construite, et par la preuve d'API, qui vérifie que la pile
réelle rend ce que ces colonnes demandent. MESURÉ : importer `board.ts` depuis `e2e/` fait échouer
`tsc -p tsconfig.tools.json` sur `webapp/src/lib/supabase.ts`, ce projet n'ayant ni `vite/client` ni
les types du DOM.

**Hypothèse écartée.** *Recopier les colonnes dans la preuve d'API.* Elle aurait prouvé qu'une
requête quelconque fonctionne, pas que **celle du produit** fonctionne — et les deux auraient
divergé au premier ajout de colonne.

**Décision.** `webapp/src/lib/colonnes-board.ts`, sans aucun import, réexporté par `board.ts`. C'est
exactement le procédé retenu par `CRM-037` pour son tableau de cas partagé, et un contrôle du
harnais exige que la preuve d'API l'importe.

### Décision 178 — Une fixture mal typée fabrique un écran que le produit ne rend jamais

**Problème.** La preuve d'interface de `CRM-021` sert des channels dont les identifiants étaient
`'c-1'`, `'c-2'`, `'c-3'`. Tant que le contenu d'un channel était un état vide, cela n'avait aucune
conséquence. Le board, lui, interroge la vraie API avec ces identifiants — et
`channel_id=eq.c-2` est refusé en `400` par PostgREST, « invalid input syntax for type uuid ».
L'écran montrait donc l'état d'**erreur** du board, non son état vide.

**Décision.** Les fixtures emploient les identifiants **du seed**. Une fixture n'a pas le droit de
servir une ligne que la base ne pourrait pas produire : elle fabriquerait un écran que personne ne
verra jamais, et la preuve visuelle ne prouverait rien. Même motif que le track amputé de son icône,
trouvé sur une capture pendant `CRM-021`.

**Assertion figée retournée dans le même changement** (mécanisme de la décision 51, treizième
occurrence) : « ouvrir un onglet montre *Aucune card dans ce channel* » devient « … montre que le
workflow ne déclare aucune étape ». Seuls les channels sont substitués : les étapes viennent de la
vraie API, qui n'en consent aucune à un anonyme. La capture `channel-ouvert-1440.jpg` a été
régénérée et observée.

### Décision 179 — INC-061 frappe une seconde suite, et les assertions de `CRM-041` ne sont pas relâchées pour l'accommoder

**Constat mesuré.** `scripts/verify-cards.sh` rend désormais « 45 contrôles, **2** en échec » :
`npm run test:sql` comme avant, et `npm run e2e:api` avec lui. La cause est celle d'INC-061 — le
harnais rejoue les suites globales **avant** de retirer son jeu d'essai de cinq cards — et le second
victime était prévisible : trois scénarios de `e2e/api/board.spec.ts` comptent les cards de
`grands-comptes`.

**Contre-épreuve mesurée.** La base porte **9** cards en sortant du harnais ; `npm run e2e:api`
lancé ensuite rend **332 scénarios, aucune anomalie**, et `npm run test:sql` **1164 assertions,
aucune anomalie**.

**Décision.** Les comptes de `CRM-041` sont **conservés**. Les relâcher pour qu'un harnais fautif
passe reviendrait à supprimer un test pour obtenir un vert, ce que `CLAUDE.md` §26 interdit
explicitement. `scripts/verify-cards.sh` est un livrable de `CRM-040` et son arbitrage est ouvert :
la seconde occurrence est consignée dans INC-061, qui gagne un argument pour son option 2 — une
règle générale protège les preuves à venir, une correction ponctuelle non.

### Décision 180 — Une seconde exécution de la routine a livré `CRM-041` en parallèle, et elle abandonne son implémentation

**Constat.** Deux exécutions de la routine d'avancement ont traité `CRM-041` dans la même heure. La
première a poussé sur `main` le commit « Le board d'un channel est rendu, et trois défauts que la
mesure a dénoncés » ; la seconde avait produit une implémentation complète et indépendante — module
de composition, rendu, preuves unitaires, d'API et d'interface, harnais de 61 contrôles, onze
captures et la vidéo.

**Décision.** L'implémentation de la seconde exécution est **abandonnée**, et celle de `main` est
conservée telle quelle. `CLAUDE.md` §1 interdit de remplacer une solution existante et fonctionnelle
sans justification technique : la livraison poussée est complète, prouvée et non complaisante, et
lui substituer une seconde version équivalente ne serait qu'une préférence. C'est le même arbitrage
qu'à `CRM-014`, où deux exécutions s'étaient déjà croisées.

**Ce qui est néanmoins conservé, parce qu'il ne dépend d'aucune des deux implémentations.** Une
contradiction **mesurée** sur la pile réelle et absente du rapport : `cards.amount` est rendu par
PostgREST en **nombre** JSON, le type engendré le déclare ainsi, et `e2e/api/cards.spec.ts` le
déclare en chaîne. Le constat vaut pour le dépôt entier, et il a une conséquence directe sur le
cumul de montant que `main` vient de livrer — INC-067.

**Ce qui n'est PAS conservé, et pourquoi.** Deux autres observations de la seconde exécution ont été
écartées après contre-mesure :

1. *Le contrôle de texte en dur lit une signature `=> Promise<…>` comme un nœud de texte.* Vrai de
   l'implémentation abandonnée ; **aucun fichier de `main` ne porte cette forme**. Consigner un écart
   qu'aucun code du dépôt ne déclenche serait du bruit.
2. *`scripts/verify-valeurs-champs.sh` mesurerait avant de restaurer, comme `verify-cards.sh`.*
   **MESURÉ contre l'arbre de `main` : le harnais rend 40 contrôles, aucune anomalie.** L'échec
   observé venait d'une assertion plus stricte de l'implémentation abandonnée, non du harnais. Un
   constat qu'on ne sait pas reproduire n'est pas un constat.

### Décision 180 — `t` accepte des paramètres, parce que le §7.5 exige une phrase et interdit de la construire

**Problème.** Le §7.5 de `docs/SPEC-workflow-engine.md` prescrit, pour une transition sans libellé,
le repli « Passer à *<étape cible>* », « composé par une **clé de traduction paramétrée** et jamais
par concaténation dans le composant ». La première livraison du board écrivait exactement l'inverse :

```tsx
{transition.libelle ?? `${t('board.transition.fallback')} ${transition.versEtape.libelle}`}
```

L'ordre des mots du français s'y trouvait figé dans du JSX. Une langue qui place son complément
avant son verbe n'aurait eu aucun moyen de le corriger — c'est précisément ce que `CLAUDE.md` §23
interdit, et ce que le §7.5 avait pris la peine de nommer **avant** que la première ligne de code ne
soit écrite.

**Comment l'écart a survécu à la livraison.** Aucune preuve ne l'exerçait. MESURÉ :
`workflow_transitions.label` est nullable, mais les **dix** transitions du seed en portent un — le
repli n'est atteint par aucune donnée permanente, ni en base ni dans les jeux servis. Ni le test
unitaire du composant ni la preuve d'interface ne passaient par cette branche : elle était écrite,
jamais exécutée. Une règle que rien n'exerce est la première à dévier de sa spécification.

**Hypothèses écartées.** *Laisser la concaténation et amender le §7.5* : ce serait réécrire une
exigence pour l'accommoder au code, alors que le document a été écrit après mesure et avant le code
précisément pour éviter cela. *Ajouter une bibliothèque de messages* apporterait pluriels, genres et
formats de nombre — tous inutiles aujourd'hui — au prix de la garantie que la décision 43 a retenue :
une clé inconnue **ne compile pas**.

**Décision.** `t` accepte un second paramètre facultatif et substitue des marqueurs `{nom}`. Format
délibérément minimal, sans pluriel ni genre. Un paramètre absent de la chaîne est ignoré ; un
marqueur sans valeur reste **visible** tel quel — il vaut mieux voir `{etape}` dans l'interface et
corriger la clé, que de lire une phrase amputée dont rien ne signale qu'il y manque un mot. La clé
devient `'Passer à {etape}'`, et le composant ne compose plus rien.

**Deux preuves, là où il n'y en avait aucune.** Un test unitaire du composant réel, avec un jeu de
transitions **de rechange** portant `label: null` — le seed ne pouvant pas l'exercer —, et un
scénario d'interface qui substitue la même réponse et lit « Passer à Relance » à l'écran. Les deux
vérifient en outre que le marqueur `{etape}` **ne fuit jamais** jusqu'à l'utilisateur.
**Contre-épreuve faite** : rétabli le code d'origine, le test unitaire échoue ; c'est ce qui
distingue une correction prouvée d'une correction affirmée.

**Portée.** Trois clés peuvent désormais être paramétrées ; une seule l'est. La substitution n'est
pas un chantier d'internationalisation — c'est le strict nécessaire pour que le §7.5 soit tenu.

### Décision 181 — Le harnais accepte un navigateur fourni par l'environnement, sans rien changer par défaut

**Problème.** Sur une image qui préinstalle ses navigateurs et interdit `playwright install`,
Playwright 1.62.1 réclame la révision qu'il épingle — `Executable doesn't exist at
…/chromium_headless_shell-1234/…` — et **tous** les scénarios `ui` échouent au lancement, y compris
ceux livrés par les unités précédentes. Aucune preuve d'interface n'est alors exécutable, quel que
soit l'état du code, et la Definition of Done de toute unité touchant l'écran devient inatteignable
pour une raison qui ne regarde pas le produit.

**Hypothèses écartées.** *Épingler le chemin dans la configuration* imposerait à tout le dépôt le
chemin d'une image particulière, et casserait le poste du responsable. *Désactiver les scénarios
`ui`* reviendrait à supprimer des tests pour obtenir un résultat vert, ce que `CLAUDE.md` §26
interdit explicitement. *Déclarer la vérification impossible* aurait été prématuré : le navigateur
**était** présent, il n'était simplement pas celui que Playwright cherchait — mesuré en le pilotant
directement avant d'écrire une ligne de configuration.

**Décision.** `e2e/playwright.config.ts` lit une variable d'environnement facultative,
`PLAYWRIGHT_CHROMIUM_PATH`. **Absente, rien ne change** : Playwright résout le navigateur comme il
l'a toujours fait. Ce n'est donc pas une dérogation inscrite dans le dépôt, mais une porte que
l'environnement d'exécution ouvre lui-même.

**Ce que cette porte ne fait pas.** Elle ne désactive aucun contrôle, ne saute aucun scénario et ne
substitue aucune réponse. Une preuve obtenue par ce chemin exerce le même build, la même API et les
mêmes assertions ; seul le binaire du navigateur diffère. La révision employée est **nommée dans le
compte rendu de livraison**, pour qu'un lecteur sache exactement ce qui a tourné.

### Décision 182 — Deux exécutions de la routine ont livré `CRM-041` en parallèle, et la seconde a abandonné son travail

**Fait.** Deux exécutions de la routine d'avancement ont traité `CRM-041` dans la même heure, à
partir du même commit de spécification. La première a poussé `55accf3` puis `16cb2ee` — le board
complet, ses trois modules, ses preuves, son harnais `scripts/verify-board.sh`, ses captures et sa
vidéo. La seconde a produit une implémentation **indépendante et complète** du même chapitre, avec
ses propres modules, ses propres preuves et ses propres captures.

**Décision.** La seconde implémentation est **abandonnée en entier**, sans être poussée. C'est la
conduite déjà retenue pour `CRM-014` (commit `52dc4ff`), et elle vaut ici pour les mêmes raisons :
deux implémentations concurrentes d'une même unité ne se fusionnent pas ligne à ligne, et écraser un
travail déjà poussé et prouvé pour lui substituer un équivalent serait une perte sèche.

**Ce qui a été conservé, et pourquoi seulement cela.** Le travail abandonné a servi de **relecture
adverse** : écrit contre la même spécification, il permettait de voir ce que la version poussée ne
traitait pas. Deux manques réels en sont sortis, et eux seuls ont été portés sur la base poussée :

1. l'écart au §7.5, corrigé par la décision 180 — une exigence explicite de la spécification, non
   tenue par le code livré, et qu'aucune preuve n'exerçait ;
2. l'échappatoire de navigateur de la décision 181, sans laquelle aucune preuve d'interface n'était
   exécutable dans cet environnement.

Tout le reste — un board fonctionnellement équivalent, des tests équivalents, des captures
équivalentes — a été jeté. **Un doublon n'est pas une amélioration**, et la seule chose qui méritait
d'être conservée d'une seconde implémentation était ce qu'elle voyait et que la première ne voyait
pas.

**Portée générale, écrite parce qu'elle resservira.** Quand deux exécutions se croisent, la seconde
se resynchronise **avant** de committer, compare les deux traitements de la même spécification, et
ne pousse que les écarts que sa lecture a révélés — jamais son implémentation entière.
---

## `CRM-042` — Vue liste

### Décision 183 — La spécification de la vue liste vit dans le document des cards, pas dans celui de la garde

**Problème.** `CRM-042` tenait en deux lignes au backlog. Quatre documents la nomment sans la
décrire : `docs/SPEC-cards.md` §1.2 la range hors du périmètre de `CRM-040`, son §4 l'inscrit parmi
les vues où une card **active** est visible, `docs/SPEC-workflow-engine.md` §7.1 l'écarte du board
— « une vue liste : tri, filtres et pagination sont `CRM-042` » —, et `docs/DESIGN_SYSTEM.md` §12.6
annonce qu'elle « débordera de la même façon » que la barre d'onglets. Aucun ne dit ce qu'elle lit,
dans quel ordre, ni ce qu'il faut en prouver.

**Hypothèse écartée.** Écrire ce chapitre à la suite du §7 de `docs/SPEC-workflow-engine.md`, là où
vit déjà le board. C'était le plus court, et c'était faux.

**Décision.** Le chapitre est écrit en `docs/SPEC-cards.md` §12, en douze sous-chapitres opposables,
et commité **avant la première ligne de code**. Motif : le board est le miroir du **graphe** — c'est
l'argument même du §7.1, qui justifie sa présence dans le document de la garde —, tandis que la
liste est le miroir de la **table** : elle trie et filtre sur les colonnes de `cards`, ne propose
aucun geste du graphe, et ne lit ni `workflow_transitions` ni `form_fields`. Ranger les deux au même
endroit aurait fait du document de la garde le document des écrans.

**Conséquence.** `docs/DESIGN_SYSTEM.md` gagne un §5.9 dans le même changement — le tableau est le
premier du produit, et le §4 l'annonçait sans lui donner une seule règle visuelle.

### Décision 184 — Le tri, le filtre et le rang de page vivent dans l'adresse, et nulle part ailleurs

**Problème.** Où ranger l'état de la vue ? Trois candidats : l'état du composant, un stockage local,
la chaîne de requête.

**Décision.** La chaîne de requête, et **aucun stockage côté client**.

**Motifs, dans l'ordre où ils pèsent.**

1. Une pagination perdue au rechargement ment sur l'endroit où l'on est : l'utilisateur qui recharge
   la page 3 doit retrouver la page 3.
2. `CLAUDE.md` §11 exige que toute donnée posée sur l'appareil relève de l'une de trois catégories.
   Un tri rangé dans `localStorage` ne relève d'aucune, et `sessionStorage` serait une persistance
   que personne n'a demandée. **Aucune n'est introduite.**
3. Les preuves ouvrent un état directement plutôt que de le reconstituer par quatre clics. C'est ce
   qui rend reproductible la capture « données longues » que la Definition of Done exige nommément.

**Conséquence, et garde.** Un paramètre absent, inconnu ou hors bornes se replie sur son défaut sans
afficher d'erreur : une adresse tapée à la main n'est pas une panne. La liste des clés de tri est
**close** — un `tri=couleur_préférée` ne devient jamais un `order=couleur_préférée` envoyé à l'API.
Ce n'est pas une faille de droit, la RLS jugeant les lignes et non les colonnes demandées ; c'est
un appelant qui sonderait l'existence d'une colonne par la différence entre un `200` et un `400`.

### Décision 185 — Un tri paginé qui n'est pas TOTAL perd des lignes, et la sonde l'a établi

**Problème.** Quel ordre envoyer à PostgREST ? La réponse évidente — la colonne demandée par
l'utilisateur — est celle qui perd des données.

**Ce qui a été mesuré, et non supposé.** Sonde jetable `public.sonde_l2`, 200 000 lignes portant
**toutes la même clé de tri**, parcourue page par page, quatre pages de cinq lignes :

| Tri | Lignes rendues | Lignes **distinctes** |
|---|---|---|
| `order by cle` — non total | 20 | **17** |
| `order by cle, id` — total | 20 | **20** |

Trois lignes rendues deux fois, donc **trois lignes que la marche n'a jamais montrées**. Rien dans
l'écran ne l'aurait signalé : chaque page était pleine, le total était juste, et les affaires
manquantes n'existaient simplement plus pour l'utilisateur.

**Décision.** Tout ordre de la vue liste est **total** : `<clé>.<sens>.nullslast,title.asc,id.asc`.
`id` est la clé primaire, donc unique, et rend l'ordre indépendant du plan choisi. `title` s'ajoute
comme critère intermédiaire pour les trois tris qui ne portent pas sur lui, afin que deux affaires
de même montant se rangent par leur nom — que l'utilisateur voit — plutôt que par un identifiant
qu'il ne voit pas.

**Sondes détruites avant rédaction** : `to_regclass('public.sonde_l1')` et
`to_regclass('public.sonde_l2')` rendent `NULL`, selon le procédé de la décision 52.

**Effet de bord mesuré :** `nullslast` est posé dans les deux sens. Sans lui,
`order=amount.desc` ferait remonter en tête les affaires **sans montant**. MESURÉ sur
`inter-entreprises` : avec `nullslast`, `Formation Data & IA — promo 2026` (28 000 CHF) précède
bien `Piste entrante à qualifier` (montant nul).

### Décision 186 — Le `416` de PostgREST est une erreur, pas une page vide, et il est classé pour lui-même

**Ce qui a été mesuré**, sur les trois cards actives de `grands-comptes` avec le jeton réel de
l'administratrice :

| Rang demandé | Réponse |
|---|---|
| `Range: 2-2` | `206`, `Content-Range: 2-2/3` |
| `Range: 3-3` — l'offset **égale** le total | `206`, `Content-Range: */3`, zéro ligne, aucune erreur |
| `Range: 4-4` — l'offset **dépasse** le total | **`416`**, `Content-Range: */3` |

Vu à travers `supabase-js`, `.range(4, 28)` rend `status: 416`, `error.code: 'PGRST103'`,
`count: null` **et** `data: null`. La frontière est à un rang près, et elle n'est écrite nulle part.

**Décision.** Deux règles, et la seconde n'est pas facultative :

1. le rang demandé est **borné** par le total connu — une adresse portant `page=99` sur un channel
   d'une page ouvre la page 1 ;
2. le `416` qui survient malgré tout — le total a diminué entre deux lectures, une card archivée par
   quelqu'un d'autre — est **classé pour lui-même** : « cette page n'existe plus », avec une action
   qui revient à la première. Le traiter comme les autres erreurs afficherait « Chargement
   impossible » à un utilisateur dont la seule faute est d'avoir gardé son onglet ouvert. Ce serait
   la valeur par défaut trompeuse que `CLAUDE.md` §18 proscrit.

### Décision 187 — Le total est exact, jamais estimé, et la mesure dit pourquoi

**Problème.** PostgREST offre trois comptes : `count=exact`, `count=planned`, `count=estimated`. Le
second est gratuit.

**Mesuré**, sur les mêmes trois lignes : `Prefer: count=planned` rend `Content-Range: 0-0/1` — **un**
au lieu de trois. C'est l'estimation du planificateur sur une table que rien n'a analysée depuis le
seed, et elle est fausse d'un facteur trois.

**Décision.** `count=exact`. Une pagination construite sur une estimation afficherait un nombre de
pages qui n'existe pas, et enverrait l'utilisateur sur le `416` de la décision 186. Le coût du
`count(*)` est **assumé et borné** — le filtre `channel_id` est servi par
`cards_channel_step_position_idx` —, et le point est **ouvert** au §12.11 plutôt que tranché
d'avance : `CLAUDE.md` §21 interdit d'optimiser sans mesure, et neuf cards en base n'en fournissent
aucune.

### Décision 188 — La liste importe la lecture des étapes du board, elle ne la réécrit pas

**Problème.** La liste a besoin du libellé et de la couleur de l'étape de chaque ligne, et des choix
de son filtre par étape. Le board lit déjà exactement cela.

**Décision.** `lireEtapes` et `resoudreEtape` restent dans `webapp/src/lib/board.ts` ; la liste les
**importe**. C'est la règle de la décision 167 — la même donnée lue deux fois finit par être lue de
deux façons —, déjà appliquée à `projeterChannels` puis à `workflow_id` (décision 169).

**Ce que la liste ne lit PAS, et le motif.** Ni `workflow_transitions`, ni `form_fields` : elle
n'offre aucun déplacement, donc aucune transition à proposer et aucun refus à traduire. Deux
requêtes, pas quatre. Une requête qui ne sert rien est une requête de trop.

### Décision 189 — La spécification annonçait un en-tête `Range`, et le client émet `offset` et `limit`

**Problème.** Le §12.6 de `docs/SPEC-cards.md`, écrit après mesure **à la main** — `curl` avec un
en-tête `Range` —, énonçait : « la page `n` demande `Range: (n−1)×25 – (n×25 − 1)` ». La preuve
d'interface, écrite d'après ce chapitre, cherchait cet en-tête dans la requête réellement émise.
Elle a **échoué** : `route.request().headers()['range']` rendait `null`.

**Ce qui a été mesuré ensuite.** `postgrest-js` — la version épinglée par `@supabase/supabase-js`
`2.112.0` — traduit `.range(de, à)` en deux **paramètres de requête**, `offset` et `limit`, et
n'émet aucun en-tête `Range`. Contre-mesure directe sur la pile, avec le jeton réel :

| Demandé | Réponse |
|---|---|
| `offset=3&limit=1` — l'offset **égale** le total | `206`, `Content-Range: */3` |
| `offset=4&limit=1` | **`416`**, `PGRST103`, `"An offset of 4 was requested, but there are only 3 rows."` |
| `offset=25&limit=25` | **`416`** |

Les deux chemins se comportent donc **identiquement**, jusqu'au `416` près. La règle du §12.6 est
juste ; sa formulation désignait le mauvais transport.

**Décision.** Le §12.6 est corrigé dans le même changement que le code, et les deux preuves
observent le chemin **que le produit emprunte** : la preuve d'interface lit `offset` et `limit`, la
preuve d'API exerce les deux. Ce qui est en cause n'est pas le comportement du produit — il était
correct — mais une spécification écrite d'après une mesure faite par un autre chemin que le sien.
La leçon est celle du §12.3 : **mesurer le produit, pas une équivalence.**

### Décision 190 — Trois défauts du tableau vide, trouvés en regardant une capture

**Ce qui a été vu.** La capture `liste-filtre-sans-resultat-1440.jpg`, produite par le scénario du
filtre sans résultat, montrait trois choses qu'aucune assertion ne pouvait attraper — les trois
éléments existaient bel et bien, chacun à sa place, et chacun rendu correctement :

1. l'état vide était affiché **au-dessus** de la barre de filtres : l'utilisateur lisait « aucune
   affaire ne correspond » avant de voir les filtres qui en étaient la cause ;
2. l'action « Effacer les filtres » apparaissait **deux fois**, à cent pixels l'une de l'autre — une
   dans l'état vide, une dans la barre ;
3. sous l'ensemble subsistait une **carcasse de tableau** : une ligne de cinq en-têtes sans une
   seule ligne de données, suivie d'une pagination « Page 1 sur 1 » qui ne paginait rien.

**Décision.** L'état vide est **passé au tableau** plutôt qu'empilé au-dessus de lui : le composant
le rend **à la place** du tableau et de sa pagination, sous une barre de filtres qui, elle, reste
toujours visible — elle est la cause de l'état vide filtré, et la masquer priverait l'utilisateur du
seul geste qui l'en sort. La barre ne répète plus l'action lorsque l'état vide la porte.

**Conséquence.** Les trois défauts sont **figés par des assertions** de
`webapp/src/app/ListeCards.test.tsx` — ordre des deux blocs dans le document, unicité de l'action,
absence de toute `columnheader` — pour qu'ils ne puissent pas revenir en silence. Le §12.7 bis de
`docs/SPEC-cards.md` les écrit. C'est la quatrième fois qu'une capture dénonce un défaut que les
tests laissaient passer (décisions 163, 175, et l'écart du §12.5 du design system).

### Décision 191 — Le balayage promis est mené, et il rend un harnais fautif à sa troisième récidive

**Problème.** `CRM-042` s'était achevée en laissant **neuf harnais non rejoués**, et en le disant :
`verify-catalogue`, `verify-workflows`, `verify-copie-workflow`, `verify-coherence-workflow`,
`verify-champs-formulaire`, `verify-droits-fins`, `verify-colonnes-protegees`, `verify-preuves-refus`
et `verify-cards`. L'unité tenait pour probable qu'ils fussent verts — elle ne livre aucun SQL,
aucune migration, aucune politique — mais nommait ce raisonnement pour ce qu'il était : **un
raisonnement, pas une mesure**. L'entrée se terminait par « à rejouer à la prochaine exécution ».

**Ce qui a été fait.** Les neuf ont été rejoués **en mode complet**, séquentiellement — jamais en
parallèle, INC-058 décrivant précisément ce que deux harnais concurrents se font l'un à l'autre —
contre la pile réellement démarrée et le seed réellement appliqué. Huit rendent **aucune anomalie** :
39, 49, 34, 33, 38, 42, 50 et 26 contrôles. Trois de ces comptes dépassent ceux qu'avaient consignés
leurs unités respectives (36, 47, 33) ; `git log` sur les trois fichiers montre qu'ils ont été
enrichis par des unités postérieures, ce qui explique l'écart sans rien laisser d'inexpliqué.

**Ce que le neuvième a rendu.** `scripts/verify-cards.sh` échoue, de façon reproductible, sur
`npm run test:sql` **et** `npm run e2e:api` — INC-061, dont c'est la **troisième occurrence**.

**Comment la cause a été établie, cette fois sans le harnais.** Les deux occurrences précédentes
déduisaient la cause de la sortie du harnais. Celle-ci la **reproduit hors de lui** : cinq cards ont
été créées par le **vrai chemin applicatif** — `POST /rest/v1/cards`, jeton réel de
l'administratrice, cinq `201` —, portant la base à **14** cards ; les suites ont été mesurées dans
cet état ; les cards ont été retirées. Résultat : les mêmes trois assertions de
`0015_colonnes_protegees.test.sql`, et **onze** scénarios d'API contre trois à la deuxième
occurrence — dont **sept** appartenant à `e2e/api/liste-cards.spec.ts`, la preuve d'intégration
dédiée de `CRM-042` elle-même. Base ramenée à 9 cards, les deux suites redeviennent intégralement
vertes : **1164 assertions** et **358 scénarios**.

**Décision : ne pas corriger, consigner et escalader.** Trois raisons, dans cet ordre. D'abord
`scripts/verify-cards.sh` est un livrable de `CRM-040` : le reprendre sous `CRM-042` toucherait les
45 contrôles d'une autre unité sans les rejouer sous la sienne (`CLAUDE.md` §13). Ensuite l'arbitrage
est **déjà ouvert** depuis deux occurrences, avec trois options écrites ; en trancher une seul
reviendrait à s'arroger la décision du responsable. Enfin, et surtout, **la correction évidente est
la mauvaise** : déplacer la section 10 après le `trap` réparerait un harnais et laisserait le motif
intact pour tous les autres qui tiennent un jeu d'essai. La troisième occurrence en donne la mesure —
le nombre de scénarios touchés a **quintuplé en deux unités**, sans qu'aucune ligne du harnais ait
changé ; ce qui a changé, c'est le nombre de preuves qui comptent des cards.

**Conséquence.** INC-061 est enrichie de la mesure et de ce qu'elle tranche : l'option 2 — poser dans
`docs/SPEC-test-harness.md` la règle « un harnais ne rejoue jamais les suites globales tant qu'il
tient un jeu d'essai », et l'appliquer par une unité de dette dédiée — est la seule qui protège les
preuves **à venir**. `CRM-042` reste `[~]`, non à cause de ce harnais, mais parce qu'INC-021 lui
interdit toujours son E2E de bout en bout. **Aucune assertion n'a été relâchée** pour rendre le
harnais vert : compter les cards du seed est exactement ce qui rend la pagination vérifiable, et
l'assouplir pour accommoder un outil fautif serait supprimer un test pour obtenir un vert
(`CLAUDE.md` §26).

### Décision 192 — Commenter est un droit d'ÉCRITURE, et trois documents ne disaient pas la même chose

**Problème.** `CRM-043` tient en deux lignes au backlog, et trois documents la décrivent
partiellement. Sur la question la plus simple — *qui peut écrire un commentaire ?* — ils se
contredisent :

| Source | Ce qu'elle dit |
|---|---|
| `docs/SCHEMA.md` §5 | « Tout membre pouvant **lire** la card peut commenter : c'est la règle demandée » |
| `docs/SPEC-permissions-rls.md` §4 | « Écriture sur le channel » |
| `docs/BACKLOG.md`, `CRM-043` | énoncé : « tout membre pouvant lire la card » ; **DoD : API (refus pour un `viewer`)** |

L'énoncé du backlog reprend la phrase de `SCHEMA`, et sa **propre Definition of Done la
contredit** : un `viewer` peut lire une card, et la preuve exigée est celle de son refus.

**Décision : le droit d'écriture sur le channel**, c'est-à-dire `app.can_write_card`. Trois motifs,
et le troisième emporte les deux autres. D'abord le §2.1 de `docs/SPEC-permissions-rls.md` définit
le `viewer` comme « consulte, **sans aucune écriture** » — invariant du produit entier, que rien
n'autorise à percer pour une table. Ensuite le §4 du même document prescrit « écriture sur le
channel » pour `card_comments`, `card_field_values` et `card_activities` **ensemble** : ouvrir la
première à la lecture seule dissocierait trois tables que ce document traite comme une famille.
Enfin la Definition of Done **est** la condition de recette de l'unité : livrer une règle dont la
preuve exigée serait impossible à obtenir n'est pas livrer l'unité.

**Ce qui est écrit, et ce qui ne l'est pas.** La phrase fautive de `docs/SCHEMA.md` §5 est corrigée
dans le même changement — elle est la seule des trois sources à porter la règle minoritaire, et la
laisser ferait mentir le document de schéma. La contradiction elle-même est consignée en
**INC-071**, non résolue implicitement : l'arbitrage porte sur le fait que l'énoncé de backlog de
`CRM-043` reprend encore la formulation corrigée.

**Conséquence mesurable.** Farida Nowak (`viewer`) lit les commentaires des cards qu'elle voit et
n'en écrit aucun. Le seed lui en attribue un, posé par la clé de service, pour que sa lecture
autorisée soit distinguable d'une table vide (`docs/SPEC-cards.md` §13.11).

### Décision 193 — Un commentaire supprimé est une pierre tombale, et son corps est réellement détruit

**Problème.** « Suppression par l'auteur », avec une colonne `deleted_at` au schéma, admet trois
mises en œuvre. Deux sont mauvaises, et la troisième ne l'est que si l'on ignore le temps réel.

1. **Suppression physique** : elle rend la colonne `deleted_at` morte-née.
2. **`deleted_at` posé, ligne laissée lisible** : le corps reste servi par l'API à qui sait le
   demander. « Supprimé » n'est alors vrai que dans l'interface — précisément ce que `CLAUDE.md`
   §10 refuse.
3. **`deleted_at` posé, ligne retirée de la lecture** : le corps devient inatteignable, mais la
   ligne aussi. Or `realtime.apply_rls` **n'émet que ce que l'abonné peut lire** : la suppression
   ne serait jamais transmise, et l'écran d'un autre membre garderait le commentaire affiché
   jusqu'à son prochain rechargement. Une suppression qui ne se propage pas est une suppression qui
   ment.

**Décision : la pierre tombale.** La ligne survit, **vidée de son corps**, et c'est un `CHECK` qui
le tient :

```
check ((deleted_at is null     and length(btrim(body)) between 1 and 10000)
    or (deleted_at is not null and body = ''))
```

Ce n'est pas un contenu masqué, c'est un contenu détruit — propriété de la base, opposable à tous
les chemins d'écriture. La ligne subsiste pour trois raisons vérifiables : la suppression **se
propage** au temps réel ; la chronologie du futur fil unifié (`CRM-044`) n'a pas de trou ;
`author_id` étant gelé, la ligne ne peut pas être recyclée pour faire dire à quelqu'un ce qu'il n'a
pas écrit.

**Conséquences assumées.** La suppression est **irréversible** : le corps n'est récupérable nulle
part, et aucun mécanisme de restauration n'est prévu. Le trigger refuse en outre toute écriture
ultérieure sur une ligne supprimée (`comment_deleted`) et toute résurrection. Le point est nommé au
§13.13 de `docs/SPEC-cards.md` pour qu'un besoin d'archivage légal ne le découvre pas après coup —
et il oblige le seed à une convergence par présence plutôt que par réécriture (`docs/SPEC-seed.md`
§2.14).

### Décision 194 — L'auteur seul modifie et supprime ; le modérateur est nommé, non livré

**Problème.** Le §4 de `docs/SPEC-permissions-rls.md` réserve modification et suppression « à
l'auteur **et aux `admin`** ». L'énoncé de `CRM-043` ne mentionne que l'auteur.

**Décision : l'intersection**, c'est-à-dire l'auteur seul. Elle n'ouvre rien que l'une ou l'autre
source refuse, là où le sur-ensemble ouvrirait un pouvoir qu'un des deux documents ne donne pas. Le
choix a en outre un fond : **modifier** le commentaire d'autrui n'est pas de la modération, c'est
une falsification — un administrateur pourrait faire dire à un commercial l'inverse de ce qu'il a
écrit, sans autre trace que `edited_at`. Aucun document ne demande cela, et deux lignes de politique
suffiraient à l'introduire par inadvertance.

**Conséquence nommée, non masquée** : aucun modérateur ne peut retirer un commentaire déplacé. La
limite est écrite au §13.6 et au §13.13 de `docs/SPEC-cards.md`, et l'arbitrage demandé en
**INC-072**. Il porte sur une politique supplémentaire — vraisemblablement une suppression ouverte
aux `admin`, sans modification —, non sur le modèle : rien n'est à défaire pour l'ajouter.

### Décision 195 — Le temps réel est mesuré avant d'être spécifié, et le panneau recharge à l'abonnement

**Problème.** La Definition of Done exige « temps réel constaté ». Le §4 de `docs/DAT.md` annonce
des « abonnements Realtime pour les commentaires » depuis le socle documentaire, et **aucun document
ne dit par quel mécanisme**. MESURÉ le 2026-08-05 : `pg_publication_tables` compte **zéro** table
publiée sur `supabase_realtime`. Rien n'avait jamais été branché.

**Ce qui a été mesuré**, sur une table sonde créée puis détruite, avec `supabase-js` `2.112.0` à
travers Kong et le jeton réel de l'administratrice :

| Mesure | Résultat |
|---|---|
| Ouverture du canal `postgres_changes` | `SUBSCRIBED` |
| `realtime.subscription` pendant que le canal vit | **1 ligne** ; **0** dès qu'il se ferme |
| Insertion 0 / 100 / 300 / 1000 ms après `SUBSCRIBED` | **1 événement** dans les quatre cas |
| **Première sonde**, émise dans la seconde suivant l'ajout de la table à la publication | **0 événement** |

**Décision.** `card_comments` est ajoutée à la publication `supabase_realtime` — première table du
produit à l'être. Et le panneau **recharge sa liste à l'abonnement**, jamais avant : la lecture est
déclenchée par le passage à `SUBSCRIBED`, non par le montage du composant.

Le motif est le dernier cas mesuré. Il n'a **pas** été reproduit, donc **pas** expliqué ; il suffit
néanmoins à interdire de bâtir l'écran sur une garantie que la mesure n'établit pas. Recharger à
l'abonnement rattrape tout événement perdu avant l'établissement du canal, et ne coûte qu'une
lecture. Écrire l'inverse — charger puis s'abonner — laisserait une fenêtre dont la largeur ne
serait connue de personne.

**Le temps réel est aussi une preuve de refus.** `realtime.apply_rls` évalue la politique `SELECT`
pour le rôle et les revendications de chaque abonné : un `viewer` fermé sur le track de
`grands-comptes` ne reçoit **rien** d'une card de ce channel. C'est le seul refus du produit qui se
constate par un **silence**, ce qui oblige à établir d'abord qu'un abonné autorisé, lui, reçoit
l'événement — sans ce témoin, le silence prouverait aussi bien la RLS qu'un temps réel en panne.
C'est la décision 50 transposée au temps réel.

### Décision 196 — `auth.uid()` en défaut de colonne ET dans le `WITH CHECK` : les deux, et le motif

**Mesuré** le 2026-08-05, sur une table sonde annulée : `create table sonde_c3 (…, a uuid default
auth.uid())` est acceptée, et une insertion sans jeton y laisse `null`. Le défaut fonctionne.

**Décision : les deux mécanismes.** Le défaut de colonne dispense l'interface d'envoyer
`author_id` — elle ne connaît d'ailleurs pas son propre identifiant sans lire sa session. La
politique `WITH CHECK (author_id = auth.uid())` est ce qui **refuse d'écrire sous le nom d'autrui** :
un défaut ne s'applique qu'à une colonne omise, et un client qui envoie `author_id` explicitement le
contourne entièrement. Le premier est un confort, le second est la règle ; les confondre laisserait
une signature falsifiable, ce que la preuve **b** du §13.8 exerce.

### Décision 197 — Un trigger écrit une colonne que le client n'a pas le droit d'écrire, et c'est mesuré

**Problème.** `edited_at` doit être posé par le produit et fermé à l'appelant. Le mécanisme des
colonnes protégées (`CRM-013`) retire le privilège `UPDATE` de table puis rend nommément les
colonnes ouvertes. Reste à savoir si un `BEFORE UPDATE` peut encore écrire une colonne fermée.

**MESURÉ**, table sonde, rôle `authenticated`, `grant update (corps, supprime_le)` :

| Geste | Résultat |
|---|---|
| `update … set corps = 'b'` | `UPDATE 1`, et `edite_le` **renseignée par le trigger** |
| `update … set edite_le = '2020-01-01'` | `ERROR: permission denied for table` |

Le privilège de colonne juge la **cible du client**, pas les affectations d'un trigger.

**Décision.** `card_comments` n'ouvre que `body` et `deleted_at` en mise à jour. `edited_at` est
fermée et pourtant tenue à jour ; `deleted_at` est ouverte mais **réécrite** par le trigger à
`now()`, de sorte qu'une date antidatée envoyée par un client soit ignorée plutôt que refusée — la
colonne doit rester ouverte pour que le geste « supprimer » existe, et sa valeur n'est pas une
question posée au client. C'est le seul endroit du produit où une colonne est à la fois ouverte et
non décidée par l'appelant ; le §13.7 de `docs/SPEC-cards.md` l'écrit pour que nul ne le déduise du
code.

### Décision 198 — Quatre garde-fous ont dénoncé la naissance de `card_comments`, et ils ont été révisés, non retirés

**Ce qui s'est passé.** La migration 15 appliquée, `npm run test:sql` est passé de vert à **quatre
suites en échec**, et `npm run e2e:api` à **un scénario en échec**. Aucune n'était un défaut : les
cinq assertions constataient l'**absence** de `card_comments`, posées par `CRM-040`, `CRM-034`,
`CRM-036` et `CRM-014` selon le mécanisme de la décision 51 — « figer un manque par une assertion
qui tombera le jour où il sera comblé ».

| Preuve | Ce qu'elle constatait | Ce qu'elle constate désormais |
|---|---|---|
| `0012_cards.test.sql` | la table n'existe pas | elle existe, **et** `cards (id, workspace_id)` est devenue unique pour elle |
| `0013_move_card.test.sql` | la table n'existe pas | elle existe, **et** `move_card` n'écrit toujours pas le motif |
| `0014_valeurs_champs.test.sql` | la table n'existe pas | elle existe, et le motif reste perdu |
| `0016_preuves_refus.test.sql` | **41** politiques dans `public` | **44** : les trois de `card_comments` |
| `e2e/api/move-card.spec.ts` | `GET /card_comments` rend `404` | il rend `200`, et la card déplacée ne porte **aucun** commentaire |

**Décision : réviser, jamais retirer.** Une assertion qui a rempli son office se **retourne** vers
ce qui compte encore. Les trois premières mesuraient un alibi — « la table n'existe pas » ; elles
mesurent maintenant l'**écart lui-même** : `move_card` exige un motif, le contrôle, et ne l'écrit
nulle part alors que sa destination existe. INC-048 change ainsi de nature sans changer de
conséquence, et l'arbitrage passe de théorique à **exigible**.

**Ce que cela apprend sur le mécanisme.** Le garde-fou de la décision 51 a fonctionné exactement
comme annoncé, pour la **dixième** fois, et il a coûté ce qu'il devait coûter : cinq révisions dans
le même changement que la migration. C'est le prix d'un manque écrit plutôt que tu.

### Décision 199 — `like` sur une colonne `uuid` rend `404`, et un nettoyage écrit ainsi échoue en silence

**Problème.** `e2e/api/commentaires.spec.ts` **écrit** — la moitié de son contrat porte sur
l'écriture — et doit donc nettoyer. INC-061 a mesuré trois fois ce que coûte un jeu d'essai laissé
en base : à la troisième occurrence, **onze** scénarios d'API tombaient, dont sept appartenant à la
preuve dédiée de `CRM-042`.

Le nettoyage a d'abord été écrit `DELETE /rest/v1/card_comments?id=like.f00d*`. **MESURÉ** :

```
HTTP 404 — {"code":"42883","message":"operator does not exist: uuid ~~ unknown"}
```

PostgREST ne sait pas appliquer `like` à une colonne `uuid`. Le premier passage de la preuve a donc
laissé **six lignes d'essai** en base, et le `afterAll` n'a rien signalé : un `DELETE` qui échoue
dans un crochet de fin ne fait pas échouer le fichier.

**Décision.** Les identifiants d'essai sont **énumérés** — `RANGS_ESSAI` —, le nettoyage porte sur
`id=in.(…)`, et il est **constaté** par une relecture qui doit rendre `[]`. Le harnais le vérifie
une seconde fois, hors du fichier de preuve. Un nettoyage dont on ne mesure pas l'effet est un
nettoyage qu'on suppose.

**Conséquence pour les preuves à venir :** aucune ligne d'essai ne porte le préfixe `5eed`, réservé
au seed. La suite pgTAP compte les commentaires seedés par ce préfixe ; une ligne d'essai qui le
porterait ferait tomber la conformité du seed — INC-061 en sens inverse.

### Décision 200 — Le générateur de types ne voit pas les triggers, et le client enverra donc un `workspace_id` qu'il ne décide pas

**Mesuré.** `public.card_comments.workspace_id` est `NOT NULL` sans défaut : elle est **dérivée par
un trigger** (§13.3). Le générateur de types la déclare donc **obligatoire à l'insertion** —
`Insert: { workspace_id: string }` — alors que la pile l'accepte omise : le `BEFORE INSERT`
s'exécute avant la vérification de la contrainte. Le seed le prouve, qui ne l'envoie jamais.

**Décision.** Le type n'est **pas** contourné par une assertion. L'interface lira `workspace_id`
sur la card qu'elle affiche déjà et l'enverra ; le trigger le remplacera par la valeur exacte
quelle que soit celle transmise, et la preuve d'API le mesure en envoyant délibérément un workspace
**inventé** — la ligne écrite porte celui de la card.

**Le motif du refus de contourner.** Un `as` ou un `!` ferait taire le compilateur sur une ligne où
il a raison : la colonne **est** obligatoire dans le schéma. Ce qui est en cause n'est pas le type,
c'est que le générateur ne peut pas voir un trigger — limite connue, sans remède local. Faire dire
au client une valeur qu'il croit décider et que la base corrige est honnête tant que c'est **écrit**
et **mesuré** ; le cacher derrière une assertion de type ne le serait pas.

### Décision 201 — Le flux déclenche la lecture, il ne la remplace pas

**Problème.** Un événement `postgres_changes` porte la ligne écrite. Le panneau pourrait donc
fusionner cette ligne dans son état local et n'émettre aucune requête — c'est ce que fait la
plupart des interfaces temps réel.

**Décision : à chaque événement, le panneau RELIT le fil.** L'événement dit qu'il a changé, il ne
dit pas ce qu'il est devenu. Trois raisons, qu'une fusion locale ne donnerait pas :

1. **l'ordre est celui du serveur.** Le fil est trié `created_at, id` par la base ; une fusion
   locale devrait réimplémenter ce tri, et deux implémentations d'un même ordre finissent par
   diverger — c'est la règle des décisions 167 et 188, appliquée au temps ;
2. **un événement perdu ou dupliqué ne laisse aucune trace.** La décision 195 a mesuré qu'un
   événement peut manquer sans que rien ne le signale. Une fusion locale accumulerait l'écart ; une
   relecture le referme au premier événement suivant ;
3. **la lecture applique la RLS COURANTE.** Un droit fin retiré pendant que l'onglet est ouvert
   change ce que l'utilisateur peut lire ; le flux, lui, a été autorisé à l'abonnement.

**Le coût est nommé** : une requête par événement, sur un fil qui n'est pas paginé. Il est borné
par le nombre de commentaires d'une card, et le §13.12 dit pourquoi la pagination n'est pas livrée —
MESURÉ, cinq commentaires au seed. Le jour où un fil deviendra long, c'est la pagination qu'il
faudra livrer, pas la fusion locale.

### Décision 202 — Ce que les captures ont montré, et une incohérence qui n'est pas corrigée ici

**Quatre captures ont été regardées** avant de conclure — `fil-charge-1440`, `refus-ecriture-1440`,
`panneau-sm-390` et `commentaire-long-390`. Elles confirment ce que le §5.10 décrit : deux colonnes
au-dessus de 1024 px, la discussion **sous** le formulaire en dessous, les trois états d'un
commentaire distincts à l'œil, un mot de 200 caractères sans espace **coupé** sans pousser la page,
et le texte refusé **toujours présent** dans le champ.

**Ce qu'une capture a montré et qu'aucune assertion ne voyait :** dans `refus-ecriture-1440`,
l'état vide invite l'utilisateur à « être la première personne à commenter cette affaire » —
**juste au-dessus** du message lui disant qu'il ne peut pas commenter. Les deux textes sont
individuellement corrects et le second est le refus réel du backend ; leur voisinage, lui, est
maladroit.

**Il n'est PAS corrigé ici, et le motif est une règle du projet.** Corriger supposerait que
l'interface sache, avant d'envoyer, que l'utilisateur n'a pas le droit d'écrire — c'est-à-dire
qu'elle calcule côté client une règle que seule la base connaît, exactement ce que `CLAUDE.md` §10
refuse. La seule correction honnête serait de **retenir** l'invitation une fois un refus reçu, ce
qui est un changement de composition à part entière. Le point est écrit au §13.13 de
`docs/SPEC-cards.md` plutôt que corrigé au jugé, et il est la cinquième fois qu'une capture dénonce
ce qu'un test laisse passer (décisions 163, 175, 190, et l'écart du §12.5 du design system).

---

## 2026-08-05 — `CRM-044`, timeline unifiée

### Décision 203 — Les événements sont écrits par des triggers sur les TABLES, non par les RPC

**Problème.** `docs/BACKLOG.md` dit « `card_events` alimentée par triggers ». `docs/DAT.md` §4.2
montre l'écriture d'un `card_event` **à l'intérieur** de `move_card`. Les deux lectures ne
produisent pas le même produit.

**Observation.** Le déplacement d'étape passe forcément par `move_card` — `CRM-034` a retiré à
`authenticated` le privilège `UPDATE` sur la colonne `current_step_id`. Mais `owner_id`,
`archived_at` et `deleted_at`, elles, s'écrivent par un `PATCH` direct que **rien** ne médie.
Placer la trace dans les RPC ne couvrirait donc que le seul mouvement déjà gardé, et laisserait
sans mémoire l'archivage, la mise à la corbeille et le changement de responsable.

**Décision.** Cinq triggers sur les tables : quatre sur `cards` (un à l'insertion, un à la mise à
jour couvrant quatre colonnes surveillées), un sur `card_field_values`. `move_card` n'est **pas**
rouverte — c'est un livrable de `CRM-034`, et le trigger sur `cards` capte son effet.

**Conséquence.** Le diagramme de `docs/DAT.md` §4.2 reste vrai à son niveau de détail — c'est bien
PostgreSQL qui écrit, dans la même transaction, après la mise à jour. Le §3.2 du même document, qui
annonce « les triggers d'audit et de timeline », est celui des deux que l'implémentation suit à la
lettre. Aucune contradiction n'est ouverte : c'est l'argument de la migration 12 retourné vers la
trace — une garde placée dans une fonction ne vaut que pour ceux qui empruntent la fonction.

### Décision 204 — `clock_timestamp()` et non `now()`, parce que l'ordre du fil doit être signifiant

**Problème.** Le §12.4 de `docs/SPEC-cards.md` a établi qu'un ordre non total perd des lignes quand
on le parcourt page par page. Une timeline pose le problème une seconde fois, et plus durement :
plusieurs événements peuvent naître d'une **seule instruction**.

**Mesuré.** Un `UPDATE` touchant `owner_id`, `archived_at` et `deleted_at` produit trois événements.
Avec `now()`, les trois portent le même horodatage et l'ordre du fil devient celui de leurs `uuid`,
c'est-à-dire aléatoire. Avec `clock_timestamp()` :

```
 assigned | 2026-08-05 22:05:36.23185+00
 archived | 2026-08-05 22:05:36.232672+00
 trashed  | 2026-08-05 22:05:36.232953+00
 → 3 horodatages distincts pour 3 événements
```

**Décision.** `clock_timestamp()` comme défaut de colonne, et l'ordre servi reste terminé par `id`.
La première rend l'ordre **signifiant** à l'intérieur d'une transaction ; le second le rend
**total** sans hypothèse sur la résolution de l'horloge.

**Conséquence.** C'est le seul écart de cette table aux conventions générales de `docs/SCHEMA.md`,
et il est écrit dans le §5 du document lui-même plutôt que laissé au fichier de migration.

### Décision 205 — Le seed ne peut pas forger un événement, et c'est la propriété qu'on cherchait

**Problème.** `CLAUDE.md` §8 interdit de « fabriquer artificiellement des traces censées représenter
l'exécution d'un processus réel ». Toutes les unités précédentes l'ont respecté **par convention** :
rien n'empêchait le seed d'écrire ce qu'il voulait, puisqu'il détient la clé de service.

**Mesuré.** Une table dont `service_role` ne reçoit que `SELECT` refuse son insertion comme celle
d'un client :

```
 authenticated : ERROR:  permission denied for table sonde_ev
 service_role  : ERROR:  permission denied for table sonde_ev
```

et un trigger `SECURITY DEFINER`, propriétaire `postgres`, écrit malgré tout — `auth.uid()` y rendant
l'identifiant réel de l'appelant, la revendication JWT étant portée par un paramètre de session que
le changement de droits n'efface pas.

**Décision.** Aucun privilège d'écriture, pour aucun rôle. La règle de `CLAUDE.md` §8 cesse d'être
une convention et devient une propriété de la base : **tout ce que le fil montre a réellement eu
lieu.**

**Conséquence.** Le seed démontre la timeline sans l'écrire, par ses propres actes — neuf `created`,
quatorze `field_changed` —, et par deux **allers-retours** qui laissent son état identique tout en
allongeant son histoire : deux `moved` par la vraie RPC sur `…0c4`, deux `assigned` par un vrai
`PATCH` sur `…0c1`. Les deux gestes sont conditionnés par une relecture, sans quoi chaque rejeu
allongerait le fil de quatre lignes et le seed cesserait de converger.

### Décision 206 — Une trace ne doit jamais faire échouer l'acte qu'elle trace

**Problème.** `actor_id` porte une clé étrangère vers `profiles`. Un appelant dont `auth.uid()`
désignerait un identifiant sans profil ferait échouer **la création de sa card** sur une violation
de clé levée par la trace, non par l'acte.

**Décision.** `actor_id` est renseigné par une **sous-requête** sur `profiles`, non par une
affectation directe : sans profil, la valeur est nulle et l'événement est attribué à personne —
exactement le comportement prévu pour un service par `docs/SCHEMA.md` §5.

**Conséquence assumée.** Un acteur sans profil est indistinguable d'un service. C'est le prix, et
il est plus faible que celui d'un audit capable de refuser une écriture métier.

### Décision 207 — Aucun trigger de refus sur la suppression, et une mémoire qui ne survit pas à son objet

**Problème.** « Append-only » demande que rien ne puisse être ni modifié ni supprimé. La mise à jour
se ferme par un trigger `BEFORE UPDATE` levant `card_event_immutable`, qui vaut pour **tous** les
rôles, propriétaire compris — MESURÉ. Le même geste sur la suppression aurait une conséquence que
la mesure a montrée.

**Mesuré.** La clé étrangère composite vers `cards` porte `ON DELETE CASCADE`, comme celle de
`card_comments` (décision de la migration 15). Un trigger `BEFORE DELETE` de refus rendrait donc
**impossible** `delete from public.cards`, geste d'exploitation que la migration 15 avait
délibérément préservé.

**Décision.** Pas de trigger de suppression. Le refus reste **double** pour les clients — aucun
privilège, aucune politique — et la suppression physique reste possible au seul propriétaire de la
base, par cascade.

**Conséquence, écrite sans détour.** Une card physiquement supprimée **emporte sa mémoire**. Les
deux issues sont écrites au §14.13 de `docs/SPEC-cards.md` — trace qui survit à l'objet, ou
suppression physique retirée du produit — et **aucune n'est prise ici** : c'est une décision de
rétention, donc de conformité.

### Décision 208 — La clé `from` est ABSENTE quand la valeur n'existait pas

**Problème.** `docs/SPEC-form-composer.md` §6.9 pose que vider un champ, c'est écrire
`'null'::jsonb`. Une valeur SQL `NULL` et une valeur JSON `null` rendent alors le même
`"from": null` dans le `payload`. MESURÉ : les deux lignes sont indistinguables.

**Décision.** À l'insertion, le `payload` ne porte **pas** la clé `from`. À la mise à jour, il la
porte toujours. « La clé n'est pas là » signifie « il n'y avait rien » ; « la clé vaut `null` »
signifie « il y avait le vide ».

**Conséquence.** Le `payload` d'un `field_changed` a deux formes, et le §14.6 les écrit toutes les
deux. C'est le prix d'une distinction que le JSON ne sait pas porter autrement.

### Décision 209 — Le fil est unifié à la LECTURE, un commentaire n'écrit aucun événement

**Problème.** `docs/DESIGN_SYSTEM.md` §5.3 décrit « la timeline unifiée : commentaires, transitions,
activités, emails, pièces jointes, dans un fil chronologique unique ». Deux écritures étaient
possibles : un événement `commented` dupliquant chaque commentaire dans `card_events`, ou une fusion
à la lecture.

**Décision.** Fusion à la lecture, sur `(created_at, id)`, à partir de deux requêtes distinctes.
Aucun type `commented` n'existe.

**Motif.** Dupliquer produirait **deux représentations d'un même fait**, dont l'une survivrait à
l'autre : un commentaire supprimé devient une pierre tombale vidée (décision 193), tandis que son
événement, immuable, continuerait de dire qu'il a été écrit. Deux vérités sur le même acte, et
aucune manière de les réconcilier.

**Conséquence.** L'ordre **croissant** du §5.10 est reconduit sans exception, alors qu'un fil
d'activité se lit habituellement du plus récent au plus ancien : le fil contient une conversation,
et `CRM-043` avait écrit cette règle précisément pour que cette unité ne l'inverse pas par
habitude. Le coût est nommé : sur une affaire longue, les faits récents seront en bas.

### Décision 210 — Seule la naissance d'une card est idempotente ; son histoire ne l'est pas

**Problème, trouvé en exécutant.** La preuve d'API assérait « 27 événements sur les cards du
seed ». Elle est verte seule et **rouge dans la suite complète** : 93 événements. La cause n'est pas
un défaut — c'est le produit qui fonctionne. `e2e/api/move-card.spec.ts` déplace des cards du seed
et les remet, `e2e/api/valeurs-champs.spec.ts` écrit des valeurs : chacun de ces gestes laisse sa
trace, puisque c'est exactement ce que `CRM-044` livre.

**Décision.** Un seul compte exact est asséré partout : **neuf `created`**, une card ne naissant
qu'une fois. Tout le reste est borné **par le bas** — au moins deux `moved`, au moins deux
`assigned`, au moins quatorze `field_changed`, au moins quatre événements portant un acteur réel.
Le chiffre de 27 reste écrit dans la spécification et dans le seed, avec sa condition de validité :
**immédiatement après l'application du seed sur une base neuve**, ce que
`scripts/verify-timeline.sh` mesure à cet instant-là.

**Ce qui a été écarté.** Nettoyer la timeline entre les fichiers de preuve : ce serait supprimer des
lignes d'une table append-only, c'est-à-dire démonter la propriété que l'unité entière construit.
Et filtrer les événements « du seed » par leur date : une heure de coupure est une temporisation
arbitraire, que `CLAUDE.md` §18 range parmi les façons de masquer une erreur.

**Conséquence.** La croissance du fil n'est pas un défaut à contenir : c'est la **démonstration**
que la trace est réelle et qu'aucune écriture n'y échappe. C'est la sixième fois qu'une exécution
dénonce ce qu'une lecture laissait passer.

### Décision 211 — Une preuve d'interface ne comptera pas les requêtes du fil

**Problème, trouvé en exécutant.** Le scénario d'interface « filtrer ne relit rien » comptait les
requêtes vers `card_events` après le clic. Il a échoué : une requête part bien, et elle **n'est pas
causée par le clic**. Le fil des commentaires se relit lorsque l'abonnement temps réel se termine en
erreur — la webapp est anonyme, INC-021 —, et la lecture des événements est **chaînée** à la
sienne, ce que le §14.13 point 5 nomme comme un coût assumé.

**Décision.** La preuve que filtrer ne relit rien reste **déterministe** et vit dans le test unitaire
du composant réel, où le nombre de lectures émises est observé. Le scénario d'interface mesure ce
que l'utilisateur voit : le fil se réduit **sans repasser par un état de chargement**.

**Ce qui a été écarté.** Attendre un délai avant de compter : c'est la temporisation arbitraire que
`CLAUDE.md` §18 range parmi les façons de masquer une erreur, et elle n'aurait fait que déplacer la
course.

### Décision 212 — Quatre défauts que les captures ont dénoncés, et qu'aucun test ne voyait

Sixième fois qu'une capture montre ce qu'une suite verte laisse passer (décisions 163, 175, 190,
199, 202). Les 127 scénarios d'interface étaient **verts** sur les quatre.

1. **`gap-1.5` ne produit AUCUNE règle CSS.** L'échelle d'espacement du §3 du design system est
   **discrète** — le CSS bâti ne déclare que `--spacing-1` à `--spacing-6` —, et une classe hors
   échelle est silencieusement ignorée. La capture montrait « Discussion1 », « Cycle de vie2 ». Deux
   corrections : `gap-2`, et le libellé placé dans son **propre élément** — un nœud de texte nu est
   un élément flex *anonyme*, que `gap` ne sépare pas de son voisin.

2. **`size-7` non plus.** La pastille d'icône du §5.11 n'avait donc **ni taille ni fond** : l'icône
   flottait sans son carré coloré. Remplacée par une valeur arbitraire, `size-[1.75rem]`, qui elle
   est compilée — vérifié dans le CSS bâti.

3. **La barre de filtres débordait du panneau à 1440 px** : « Cycle de vie » était **coupé**. Elle
   avait été écrite avec un défilement horizontal, règle héritée du §7 pour les tableaux et le
   board. Mais la colonne de droite est étroite **quelle que soit** la largeur de l'écran, et un
   contrôle dont la dernière option sort du cadre **cache** une option. La barre se replie
   désormais ; le §5.11 est corrigé dans le même changement.

4. **Quatre bascules affichant « 0 » surmontaient « aucun événement pour le moment »** : un contrôle
   sans objet. La barre n'est plus rendue quand le fil chargé est vide. Le seuil porte sur le fil
   **chargé**, non sur le fil filtré — sinon éteindre toutes les familles ferait disparaître le
   moyen de les rallumer.

**Une règle du design system a en outre été RETIRÉE après observation** : le filet vertical reliant
les événements. La distinction carte / ligne porte déjà seule la lecture du fil, et un filet
s'interrompant à chaque prise de parole aurait produit une ligne pointillée dont les trous ne
signifiaient rien. Elle est retirée du §5.11 avec son motif, plutôt que laissée écrite et non tenue.

**Ce que ces quatre défauts ont en commun** : aucun n'est une faute de logique, et aucun n'était
visible d'un test. Trois viennent d'une classe utilitaire qui n'existe pas et qui n'échoue jamais
bruyamment ; le quatrième d'une composition correcte dans un cas et absurde dans l'autre.

---

## `CRM-045` — Déplacement d'une card entre channels

### Décision 213 — Le paramètre `step_mapping` de `docs/SCHEMA.md` désignait une autre fonction

`docs/SCHEMA.md` §9 annonçait `move_card_to_channel(card_id, channel_id, **step_mapping**)`,
« remappage explicite **des étapes** », au pluriel. Le §6 de `docs/SPEC-workflow-engine.md` dit
l'inverse : « l'appelant fournit **l'étape** de destination », pour **une** card.

Une table de correspondance n'a de sens que pour un déplacement **en lot**, ou pour une fonction qui
changerait le workflow d'un channel entier en remappant l'étape de chacune de ses cards — soit
l'option 2 de l'arbitrage d'INC-046, qui n'est rattachée à aucune unité.

**Décision : la lecture du §6**, parce qu'elle est la plus faible et la seule qui ne préempte aucun
arbitrage. Le paramètre est nommé `to_step_id`, par symétrie avec `move_card(card_id, to_step_id,
comment)`. La ligne de `docs/SCHEMA.md` est corrigée ; la contradiction est consignée en **INC-073**
plutôt que résolue en silence, parce que si `step_mapping` exprimait bien l'intention d'un lot,
alors cette capacité n'est portée par **aucune** unité du backlog.

### Décision 214 — La garde était close avant d'exister, et c'est `CRM-013` qui l'avait fermée

`CRM-034` avait dû retirer elle-même le privilège de colonne sur `current_step_id` : sans quoi
`move_card` eût été une commodité que seuls les clients bien intentionnés empruntent. La même
question se posait ici pour `channel_id` et `workflow_id`.

**MESURÉ avant d'écrire quoi que ce soit** — les douze colonnes que `authenticated` peut écrire sur
`cards` sont `amount, archived_at, currency, deleted_at, description, next_action, next_action_at,
owner_id, position, probability_override, snoozed_until, title`. Ni `channel_id`, ni `workflow_id`,
ni `current_step_id`.

`CRM-013` les avait fermées « par voie de conséquence », en notant qu'elles sont « tenues cohérentes
par les clés composites de `CRM-040` ». **La conséquence n'avait pas été nommée** : elle rend
`move_card_to_channel` opposable dès sa naissance. `CRM-045` n'a donc **aucune** protection de
colonne à poser, et c'est le premier cas du projet où une unité de sécurité antérieure paie
d'avance une unité qui n'existait pas encore. La propriété est figée par une assertion plutôt que
laissée à la chance d'une migration future.

### Décision 215 — Un déplacement de channel écrit UN événement, et jamais un `moved` à côté

MESURÉ : aujourd'hui, un changement de channel est **parfaitement silencieux**. Le trigger de
`CRM-044` surveille quatre colonnes, `channel_id` n'en fait pas partie ; `…0c1` déplacée de
`grands-comptes` vers `appels-offres` sous `postgres` produit **zéro événement**.

`channel_changed` est donc ajouté — neuvième type —, et la garde `moved` est **conditionnée à
`channel_id` inchangé**. Motif : `moved` signifie, depuis `CRM-044`, « la card a franchi une arête
du graphe ». Une card qui change de workflow n'en a franchi aucune, et il ne peut pas y en avoir —
deux workflows sont deux graphes disjoints. Écrire les deux ferait dire à la mémoire d'une affaire
qu'une transition a eu lieu là où il n'y en avait pas.

Rien n'est perdu : `from_step_id` et `to_step_id` figurent dans le `payload` de `channel_changed`,
qui dit **plus** que le `moved` qu'il remplace.

L'événement est écrit **par le trigger de la table**, non par la RPC — décision 203 reprise et non
réinventée : un `PATCH` direct sous `service_role`, que la fermeture de colonne n'arrête pas, le
produit aussi. Une garde protège les clients ; une trace doit couvrir tout le monde.

### Décision 216 — Les réponses de formulaire sont détruites, mais jamais sans que l'appelant l'ait dit

**Le fait, découvert en mesurant et prévu par aucun document.** `card_field_values` porte
`(card_id, workflow_id) → cards (id, workflow_id) ON DELETE CASCADE`. La cascade joue sur la
**suppression** d'une card, pas sur la **mise à jour** de son `workflow_id`. Changer le workflow
d'une card qui porte une réponse est donc refusé en `23503` :

```
ERROR: update or delete on table "cards" violates foreign key constraint
       "card_field_values_card_id_workflow_id_fkey" on table "card_field_values"
DETAIL: Key (id, workflow_id)=(…0c1, …051) is still referenced from table "card_field_values".
```

Ce n'est pas un cas limite : MESURÉ, **six cards du seed sur neuf** portent des réponses. Sans
traitement, la fonction rendrait pour les deux tiers du seed un code de contrainte interne.

**Trois issues, et pourquoi la troisième.**

1. **Remapper** les réponses par clé de champ vers le workflow cible — écarté, et pas par prudence :
   c'est le remappage automatique par clé que le §6 interdit nommément, transposé des nœuds aux
   champs. Deux workflows peuvent porter une clé `budget` qui ne désigne pas la même chose.
2. **Refuser** le déplacement dès qu'une réponse existe — cohérent, et inutile : la fonction ne
   servirait plus qu'aux cards vides.
3. **Supprimer**, ce qui est retenu — **mais jamais par défaut**.

**Le quatrième paramètre, `discard_field_values`, vaut `false`.** Tant qu'il vaut `false`, un
déplacement qui détruirait des réponses est refusé — `field_values_would_be_lost`, avec leur nombre
en `DETAIL`. Le motif est le principe même du chapitre : le §6 tient en une phrase, « le remappage
est **explicite** ». Détruire les réponses d'une affaire en silence, à l'occasion d'un geste
présenté comme un rangement, en serait l'exact contraire, et un défaut destructeur eût été la
« valeur par défaut trompeuse » que `CLAUDE.md` §18 proscrit.

**Ce que la mémoire en garde.** La suppression porte sur `card_field_values`, jamais sur
`card_events` — que rien ne peut supprimer. Le fil d'une card déplacée continue de porter les
`field_changed` qu'elle a produits : **la mémoire survit à la donnée**. Elle les porte sans libellé,
les champs du workflow d'origine n'étant plus résolus par l'écran ; le manque est nommé au §6.10
plutôt que corrigé, aucune donnée ne permettant de résoudre un libellé dans un workflow historique.

### Décision 217 — `entered_step_at` n'est touchée que si l'étape change

`docs/SPEC-cards.md` §2.9 réserve `entered_step_at` à `move_card`. L'étendre à
`move_card_to_channel` est une décision, prise ici : entrer dans une étape par remappage est y
entrer.

Mais un changement de channel **à étape constante** ne fait entrer la card nulle part, et remettre
l'horodatage à zéro y ferait mentir la seule mesure d'ancienneté du produit — une affaire en
négociation depuis trois semaines paraîtrait y être entrée à l'instant parce qu'on l'a rangée dans
un autre dossier. `position`, à l'inverse, est **toujours** recalculée : sa portée est le couple
`(channel_id, current_step_id)`, et changer de channel change de portée.

### Décision 218 — Le seed démontre une card sur un workflow dérivé, en transit et non à demeure

INC-046 constate que le seed ne peut poser aucune card dans `prospection`, seul channel suivant la
copie de portée track, sans rendre son propre rejeu impossible. Conséquence écrite au §9.1 de
`docs/SPEC-cards.md` : la divergence de `CRM-032` n'est démontrée que par des étapes et des
transitions, jamais par une card les empruntant.

`move_card_to_channel` ne lève pas la contrainte — elle déplace une card, jamais un channel, et
l'option 2 de l'arbitrage d'INC-046 reste non livrée. Elle permet en revanche un **aller-retour**,
avec le jeton de l'administratrice et par la vraie RPC : `…0c5` de `maintenance` vers `prospection`,
puis retour. La card suit réellement le workflow dérivé, le temps du transit, et aucune card ne
demeure dans `prospection`.

`…0c5` est choisie parce qu'elle est — MESURÉ — l'une des trois cards du seed sans aucune réponse de
formulaire : l'aller-retour n'a rien à détruire, `discard_field_values` reste à `false`, et le seed
reste convergent. Une réponse détruite ne renaîtrait pas au retour ; la destruction est donc prouvée
par la suite d'API, sur une card qu'elle crée et qu'elle détruit.

### Décision 219 — L'autorité sur une contrainte passe à la dernière migration qui l'étend

**UN DÉFAUT RÉEL, TROUVÉ PAR LE BALAYAGE DE NON-RÉGRESSION ET PAR RIEN D'AUTRE.** Ni la suite
pgTAP, ni la preuve d'API, ni le harnais dédié de `CRM-045` ne le voyaient : tous s'exécutent
contre une base déjà migrée. `scripts/verify-authz.sh` rejoue le `migrations-runner`, et lui seul.

```
ERROR: check constraint "card_events_type_check" of relation "card_events"
       is violated by some row
migrations-runner : code de sortie 3
```

**Le mécanisme.** Le `migrations-runner` ne tient aucun registre et rejoue TOUT le répertoire à
chaque démarrage (décision 20). La migration 16 employait `converger_contrainte` — le remède
d'INC-035, qui REMPLACE une contrainte dont la définition diffère de celle que le fichier déclare.
La migration 17 étend l'énumération à neuf valeurs. Au rejeu, la 16 ramenait donc la contrainte à
huit AVANT que la 17 ne la rétablisse.

**Sur une base neuve, cela passait inaperçu** : au moment où les migrations tournent, aucune ligne
n'existe encore, le seed venant après. C'est ce qui explique que le rejeu à froid de cette même
session ait rendu « 17 fichiers appliqués avec succès » alors que le défaut était déjà là. Sur une
base portant des `channel_changed` — c'est-à-dire toute base seedée —, PostgreSQL refuse une
contrainte que les lignes présentes violent, et **la pile ne redémarre plus**.

**La leçon, qui dépasse cette contrainte.** Le mécanisme de convergence suppose qu'UN SEUL fichier
fasse autorité sur un objet. Il n'a pas d'expression pour « une contrainte dont la définition
canonique avance avec les migrations ». `CRM-045` est la première unité du projet à étendre un
objet créé par une unité antérieure ; elle est donc la première à l'exposer.

**Décision : l'autorité change de porteur, la valeur ne change pas.** La migration 16 POSE le
vocabulaire initial — création si absent, et rien de plus. La dernière migration qui l'étend, la 17,
en devient responsable et continue de le CONVERGER. Un rétrécissement manuel est toujours réparé,
par la 17 désormais. Aucune garantie n'est perdue ; elle a changé de fichier.

**Ce qui a été écarté.** Rendre la contrainte de la 16 `NOT VALID` la ferait passer, mais laisserait
une contrainte non validée sur une base neuve et changerait le texte rendu par
`pg_get_constraintdef`, donc les assertions de deux suites. Réécrire la 16 avec les neuf valeurs
ferait dire à `CRM-044` ce qu'elle ne savait pas, et rendrait la section 1 de la 17 redondante —
au prix d'un fichier qui ne décrirait plus ce que son unité a livré.

**Vérifié** : `migrations-runner` recréé de force sur la base seedée, **code de sortie 0**,
« 17 fichier(s) appliqué(s) avec succès », et la contrainte relue porte bien ses neuf valeurs.

La limite structurelle est consignée en `docs/INCONSISTENCY_REPORT.md`, **INC-074** : elle
dépasse cette unité, et la prochaine extension d'un objet existant la rencontrera.

---

### Décision 220 — `CRM-046` ne recommence pas le seed : il comble trois manques mesurés

**Contexte.** L'énoncé de `CRM-046` — « Trois tracks, plusieurs channels, workflows distincts dont
un dérivé, cards à toutes les étapes, cas d'erreur et branches alternatives, aucun écran vide » —
se lit comme la commande d'un jeu de données neuf. Écrit à `CRM-000`, il précède de vingt-cinq
unités le seed qui existe aujourd'hui.

**Ce qui a été mesuré avant d'écrire quoi que ce soit**, le 2026-08-06, sur la pile réelle seedée à
la migration `0017` :

| Exigence de l'énoncé | État mesuré |
|---|---|
| Trois tracks | **satisfaite** — trois actifs, un archivé |
| Plusieurs channels | **satisfaite** — six, dont un archivé, sur trois tracks |
| Workflows distincts dont un dérivé | **satisfaite** — `Cycle commercial standard` (global) et sa copie de portée `track` |
| Cards à toutes les étapes | **fausse** — `realisation` 0 card, `livre` 1 card **archivée**, `perdu` 0 card |
| Cas d'erreur et branches alternatives | **satisfaite** — card sans responsable, sans montant, archivée, en corbeille, transition refusée pour champ requis vide, arête à `require_fields`, commentaire supprimé |
| Aucun écran vide | **fausse** — `prospection` : 0 card ; le workflow dérivé : 0 card à ses sept étapes |

**Décision : l'unité ne réécrit pas le seed, elle ferme les trois manques.** Cinq cards, quatre
valeurs de formulaire, aucun commentaire, aucun nouveau track ni channel. Le motif est le §1 de
`CLAUDE.md` — « ne pas remplacer une solution existante fonctionnelle sans justification
technique » — et le §8 — aucune ligne décorative. Un jeu de données refait aurait invalidé les
identifiants que vingt-cinq unités, leurs suites pgTAP, leurs preuves d'API et leurs captures
citent nommément.

**Conséquence.** Les compteurs figés par les unités antérieures changent — 9 cards deviennent 14,
14 valeurs 18, 29 événements 38 — et les garde-fous qui les portent deviendront rouges. C'est le
mécanisme de la décision 51 : ils sont **révisés, jamais retirés**, dans le même changement.

---

### Décision 221 — L'obstruction du §9.1 de `SPEC-cards` se lève par convergence, pas par relâchement

**Problème.** Aucune card ne pouvait vivre dans `prospection` : le seed y repointe le workflow deux
fois — section 4 vers le global, section 7 vers la copie —, et la clé étrangère composite
`cards (channel_id, workflow_id)` refuse ce déplacement dès qu'une card occupe le channel. C'est ce
qui rendait le workflow dérivé inexerçable, donc l'écran vide.

**Re-mesuré avant d'agir**, et non repris de confiance : une card posée dans `prospection` sur le
workflow dérivé, puis `apply-seed.sh` rejoué, échoue **en section 4**, HTTP `409`, `23503`,
« Key (id, workflow_id)=(…031, fa9f0f61-…) is still referenced from table "cards" », code de sortie
`1`. Contre-épreuve : la card retirée, le seed repasse en `0`, 9 cards.

**Trois issues étaient ouvertes.**

1. **Relâcher la clé étrangère** — supprimer `cards_channel_id_workflow_id_fkey`, ou lui donner
   `ON UPDATE CASCADE`. **Écartée** : elle est la garde qui interdit qu'une card se retrouve sur un
   workflow étranger à son channel, et INC-046 attend précisément l'arbitrage de ce qu'un
   changement de workflow doit faire des cards. La lever ici trancherait INC-046 par
   implémentation.
2. **Poser les cards sur le workflow global dans `prospection`** — le channel porte la copie, la
   clé refuserait. Et si elle acceptait, le contrat serait faux : le board lit les étapes du
   workflow **du channel**.
3. **Cesser d'écrire ce qui n'a pas à changer.** Retenue.

**Décision : convergence par état, en deux points.** La section 4 n'envoie le `workflow_id` de
`prospection` que si le channel ne porte pas déjà la copie déclarée ; la section 7 ne joue sa
séquence libérer → converger → rattacher que si la copie **diverge** de son contrat ou si le
channel ne la suit pas. Sur une base conforme, **aucune écriture** n'est faite sur ces deux points,
et la clé étrangère n'a rien à vérifier.

Ce n'est pas un mécanisme nouveau : c'est exactement celui des §2.14 et §2.15, où les commentaires
modifié et supprimé, et les trois allers-retours de la timeline, sont conditionnés par une
relecture. Le seed relit avant d'écrire.

**Ce que la décision ne fait pas.** INC-046 n'est **pas** levée : changer le workflow d'un channel
peuplé reste refusé, et doit le rester. Il subsiste un cas d'échec légitime — une copie déplacée à
la main **et** des cards dans `prospection` —, que le seed doit **nommer** en citant INC-046 plutôt
que de laisser lire un `23503` brut.

---

### Décision 222 — Deux identifiants du seed sont tirés par le produit, et le seed les résout par la clé de nœud

**Problème.** Le §4 de `docs/SPEC-seed.md` pose que tout identifiant du seed est fixé dans le
script. Les cards `…0ca` et `…0cb` vivent sur le workflow **dérivé**, dont l'identifiant et ceux de
ses sept étapes sont produits par `copy_workflow_to_track` avec `gen_random_uuid()`. MESURÉ : la
copie porte `fa9f0f61-9f4a-4a03-b235-90b823cfd236` sur la base de vérification, valeur qu'aucune
autre base ne reproduira.

**Écarté : forcer les identifiants de la copie.** Il aurait fallu soit poser la copie par `INSERT`
au lieu d'appeler la fonction du produit — ce que `CLAUDE.md` §8 proscrit —, soit réécrire ses
identifiants après coup, ce qui ferait mentir le lignage de `workflow_derivations`.

**Décision : le seed résout ces deux clés à l'exécution**, par la clé de nœud du catalogue —
`prospection`, `negociation` —, qui est stable et déclarée dans le contrat. Les identifiants des
**cards** restent fixes ; seules leurs deux clés étrangères sont résolues.

**Conséquence pour les preuves**, écrite pour qu'aucune ne la redécouvre : une preuve ne peut pas
figer le `workflow_id` de `…0ca`. Elle fige la clé du nœud de son étape, ou l'identifiant de son
channel. Et si la copie manque, le seed **échoue** en le disant — poser les deux cards sur le
workflow global rendrait un seed vert et un contrat faux.

---

### Décision 223 — Le formulaire du workflow dérivé reste vide : INC-037 est constatée, pas compensée

**Mesuré.** `form_fields` ne porte aucune ligne sur le workflow dérivé ; les sept champs sont
déclarés sur le seul workflow global. `copy_workflow_to_track` ne copie pas les champs — le
non-livré est écrit en tête de `supabase/migrations/0007_copie_workflow.sql`, et l'arbitrage est
INC-037.

**Écarté : déclarer à la main sept champs sur la copie.** Le seed aurait alors montré un produit
qui copie les champs, ce que la fonction ne fait pas. Un seed qui compense un manque du produit ne
prouve plus le produit ; il le maquille. La clé étrangère composite
`card_field_values (field_id, workflow_id)` refuserait d'ailleurs toute valeur ainsi fabriquée.

**Décision : les cards `…0ca` et `…0cb` ne portent aucune valeur de formulaire**, et l'absence est
**figée par une preuve** — preuve n° 6 du §9.9 — plutôt que laissée à la mémoire. Le jour où
INC-037 sera tranchée et les champs copiés, cette preuve deviendra rouge et rappellera d'elle-même
que ce chapitre doit changer. C'est le mécanisme de la décision 51.

---

### Décision 224 — Un droit d'accès consenti sans chemin de navigation : INC-075

**Découvert en mesurant** ce que chaque profil verrait après extension, l'énoncé « aucun écran
vide » n'ayant de sens que par profil.

Le `viewer` porte `track_members.access = 'none'` sur `conseil-ia` et
`channel_members.access = 'member'` sur `prospection`. MESURÉ avec son jeton réel : il **ne lit
pas** le track `conseil-ia`, et il **lit** le channel `prospection`. C'est exactement la ligne f du
§3 de `docs/SPEC-permissions-rls.md`, et la mesure qui a permis de clore INC-030.

Or la coquille résout le track **avant** ses channels : `lireTrackParSlug` puis `lireChannels`
filtré sur `track_id`. La route `/tracks/conseil-ia/prospection` rend donc « Track introuvable » à
ce profil. **Le droit existe côté serveur et n'a aucun chemin côté produit.**

**Décision : ne rien changer, et consigner.** Les trois issues — élargir la politique des tracks,
router par le channel, ou déclarer le cas hors parcours — touchent respectivement `CRM-012`,
`CRM-021` et `docs/SPEC-permissions-rls.md`. Aucune n'appartient à `CRM-046`, et en trancher une
serait résoudre implicitement une contradiction, ce que `CLAUDE.md` §5 interdit. INC-075 est
ouverte ; `CRM-046` **mesure** le cas et le fige par sa preuve n° 13.

---

### Décision 225 — Deux conformités, et non une : seule la POSITION de la copie exige de libérer le channel

**Défaut réel de mon propre travail, trouvé en exécutant `scripts/verify-seed-demo.sh`** — première
occurrence pour `CRM-046`, et troisième forme de la décision 210.

La décision 221 avait conditionné **toute** la réparation de la section 7 à la conformité de la
copie, jugée sur cinq colonnes : portée, track, nom, défaut, archivage. Le harnais a posé une
dérive réparable — le nom de la copie changé à la main par la vraie route — et le seed a **échoué**
en citant INC-046. Mesuré, et non déduit : sortie non nulle, message
« la copie de portée track diverge de son contrat, et des cards occupent « prospection » ».

**Le raisonnement était faux, et il l'était par excès.** Une seule des cinq colonnes exige que le
channel soit libéré :

| Colonne | Ce que sa convergence exige |
|---|---|
| `scope`, `track_id` | **déplacer** le workflow — refusé sous ses occupants par le trigger de `CRM-033`, et la libération du channel est refusée par la clé composite dès qu'une card y vit |
| `name`, `is_default`, `archived_at` | **rien** — un `PATCH` sur ces trois colonnes ne touche à aucun rattachement |

Conditionner les cinq à la première faisait perdre la convergence sur les trois autres, pour toute
base dont `prospection` est peuplée — c'est-à-dire, depuis cette unité, **toute base seedée**.
`CRM-046` aurait ainsi introduit une régression de convergence en croyant en réparer une.

**Décision : deux conformités distinctes.** La branche de réparation ne juge plus que la
**position** de la copie — `scope` et `track_id` — et le rattachement du channel. Les trois autres
colonnes sont convergées **inconditionnellement**, après la branche, quel que soit le chemin
emprunté. Le cas bloqué se réduit ainsi à sa forme minimale : une copie déplacée hors de son track
**et** des cards dans `prospection`.

**Ce que cela dit du harnais.** Il a trouvé le défaut parce qu'il dégrade par la **vraie route**
et exige la réparation, au lieu de constater un état. Une preuve qui se serait contentée de lire
« la copie porte le bon nom » serait restée verte.

---

### Décision 226 — Un total d'événements ne se fige pas : seul `created` par card est un invariant

**Second défaut réel de mon propre travail, trouvé en exécutant le harnais DEUX FOIS** — seconde
forme de la décision 210, et la première où c'est le harnais lui-même qui fausse ce qu'il mesure.

Le §9.6 annonce **38 événements** au sortir du seed, et j'en avais fait une assertion d'égalité.
Mesuré : la seconde exécution rend **46**. La section de non-complaisance archive une card, la
désarchive, vide une valeur et la remplit — quatre écritures que les triggers de `CRM-044`
inscrivent, et qui ne s'effacent jamais. `e2e/api` en écrit de même à chaque passage.

**Le nombre 38 n'est pas faux, il n'est pas INVARIANT.** Il décrit l'état d'une base au sortir d'un
`resetMe.sh`, pas une propriété que le seed maintient. Une assertion d'égalité sur ce total serait
rendue rouge par la seule existence des autres preuves du dépôt — exactement le défaut corrigé à
`CRM-045` sur deux assertions de `move-card-to-channel`.

**Décision : mesurer ce qui est stable, minorer le reste.**

- **Invariant assert** : un `created` par card, exactement — une card naît une fois, et le nombre
  de cards est un contrat. Trois contrôles le portent : le compte, les cards sans `created`, et les
  cards qui en porteraient deux.
- **Minorants** : le total, `field_changed`, `moved`, `assigned` et `channel_changed` sont vérifiés
  `≥` à la valeur du contrat. Cela prouve que le seed a produit ce qu'il annonce, sans mentir sur
  ce qu'une base vivante devient.

Le §9.6 et le §9.9 de `docs/SPEC-seed.md` sont réécrits en conséquence : ils disent désormais « au
sortir d'un seed sur base neuve », et non « toujours ».

**Ce qui a été écarté.** Faire nettoyer ses événements par le harnais : ils ne sont pas
supprimables sans privilège, et les supprimer effacerait une mémoire que le produit est fait pour
tenir. Un harnais n'a pas à mutiler la timeline pour que son assertion reste verte.

---

### Décision 227 — `email_local_part` ne peut pas figurer dans une empreinte de reproductibilité

**Troisième défaut de mon propre travail, trouvé avant d'exécuter la preuve** — et c'est la
première fois de cette unité qu'un défaut est vu par la lecture du produit plutôt que par un rouge.

Le §9.8 déclarait comparer « identifiants, slugs, positions, montants, devises, états,
`email_local_part`, rattachements ». Or l'adresse d'une card est **tirée au hasard** :
`gen_random_bytes(5)` dans le trigger de la migration 11, encodés sur l'alphabet du §3.4 de
`docs/SPEC-cards.md`. Elle est stable d'un **rejeu du seed** — la branche de mise à jour d'un
`upsert` ne touche que les colonnes envoyées, et le seed ne l'envoie jamais — et ne peut pas l'être
d'un **cluster** à l'autre.

L'inclure aurait rendu la preuve n° 14 rouge par construction, et j'aurais conclu à une
non-reproductibilité qui n'existe pas.

**Décision : deux empreintes, pour deux usages distincts.**

| Empreinte | Compare | Contient `email_local_part` |
|---|---|---|
| complète | deux états du **même** cluster — le rejeu du seed ne change rien | **oui**, et c'est une propriété réelle |
| reproductible | deux **reconstructions** — ce que rend `--empreinte` | **non**, remplacée par sa forme et son unicité |

Ce que la seconde perd est repris par deux contrôles dédiés : les quatorze adresses ont la forme
`c-` suivie de huit caractères de l'alphabet déclaré, et elles sont **distinctes**. Ce sont des
propriétés du produit ; leur valeur ne l'est pas.

---

### Décision 228 — La forme forte de la preuve n° 14 est acquise, et `resetMe.sh` a échoué après avoir détruit

**MESURÉ le 2026-08-06.** `./resetMe.sh --yes` a réellement détruit le cluster PostgreSQL et ses
volumes — `docker ps -a` vide —, puis a **échoué** à la construction de l'image `webapp` :
`SELF_SIGNED_CERT_IN_CHAIN` sur `npm ci`, INC-042, **neuvième** occurrence sur cet hôte, prédiction
vérifiée une fois de plus.

**Cet échec n'a pas empêché la preuve, il l'a rendue possible.** La destruction avait eu lieu ; la
pile a été redémarrée à la main sans le service `webapp`, les dix-sept migrations ont été rejouées à
froid — « 17 fichier(s) appliqué(s) avec succès » —, et le seed appliqué. Résultat :

- **empreinte reproductible identique** de part et d'autre :
  `34c409d17775c2ee6d1f68aa5fc73c03b9b49a0573596ffcf07bb2ead27d9d07` ;
- **`card_events` porte exactement 38 lignes** sur la base neuve, ce qui confirme le nombre du §9.6
  pour ce qu'il est — un état, non un invariant (décision 226) ;
- **62 contrôles de `scripts/verify-seed-demo.sh`, aucune anomalie**, sur cette base reconstruite.

La Definition of Done de `CRM-046` — « `resetMe.sh` reproduit exactement le même état » — est donc
satisfaite, avec une réserve nommée : le conteneur de l'interface n'a pas été reconstruit. Il ne
touche à aucune donnée, et la reconstruction de la base est complète.

**Ce qui reste, et qui n'appartient pas à cette unité** : INC-021. Aucun écran de connexion, donc
aucun parcours connecté observable, donc aucune capture. Dix-septième unité consécutive.
### Décision 229 — Aucune preuve de `CRM-045` ne déplace une card du seed, et la leçon a été payée deux fois

**Premier paiement, pendant l'écriture.** Le scénario *l* faisait un aller-retour sur `…0c1`, et
`e2e/api/move-card.spec.ts` a échoué : il asserte que le rang maximal de la colonne
`(grands-comptes, relance)` vaut 2, et il valait 3. Le motif n'est pas un défaut du produit, c'est
le produit — `position` est **toujours** recalculée en fin de colonne d'arrivée (§6.5), et un
aller-retour rend le channel, le workflow et l'étape, jamais le rang. Le scénario a été porté sur
une card d'essai.

**Second paiement, après le commit, par le balayage de non-régression.** Les scénarios *n* et *p*
déplaçaient encore `…0c5`. Ils la rendaient à sa place — mais **seulement si toutes leurs
assertions passaient**. Un harnais du balayage ayant dégradé la base pendant qu'ils s'exécutaient,
une assertion a échoué entre l'aller et le retour, et la card est restée dans `appels-offres`.
MESURÉ ensuite : **onze assertions de la suite pgTAP de cette unité, deux de `0012_cards`, une de
`0013_move_card`, deux de `0017_commentaires` et une de `0018_timeline`** sont devenues rouges,
pour une seule card mal rangée.

**La règle, désormais explicite : une preuve ne rend jamais une autre preuve dépendante de son
propre succès.** Toute preuve de cette unité qui déplace une card opère sur une card qu'elle crée
et qu'elle détruit — la destruction étant faite à la fois en fin de scénario et dans `afterAll`,
de sorte qu'un échec en cours de route ne laisse rien derrière. Le scénario *o*, qui ne mute rien,
compare en outre la ligne relue à ce qu'elle était **avant l'appel** plutôt qu'à ce que le seed
déclare.

**Vérifié après correction et remise à froid de la base** : la suite d'API complète — 409
scénarios — laisse les neuf cards du seed dans leur channel, à leur étape et à leur rang exacts,
relevés un à un.

Un contrôle du harnais fige cette propriété : `scripts/verify-move-card-to-channel.sh` relit les
rangs de `(grands-comptes, relance)` après la preuve d'API et exige « 1,2 ».

### Décision 230 — Le manuel du chunk 3 avait dérivé, et la dérive se mesure : treize écarts

**Problème.** `CRM-047` demande que « `docs/manual.md` décrive le produit réellement exécuté ». La
formule suppose une comparaison, et personne ne l'avait faite depuis que le manuel est écrit — un
chapitre à la fois, par l'unité qui le livre. Chaque chapitre était vrai le jour où il a été écrit ;
la question est de savoir s'ils le sont **ensemble**, aujourd'hui.

**Ce qui a été mesuré, avant d'écrire quoi que ce soit** : la pile démarrée, le seed appliqué, les
libellés relus dans `webapp/src/i18n/fr.ts`, les volumes comptés dans la base, les routes lues dans
`webapp/src/app/routes.tsx`, et quatre captures observées à l'œil.

**Treize écarts**, consignés un à un dans `docs/SPEC-manual.md` §6. Ils ne sont pas de même nature,
et c'est le constat le plus utile :

- **quatre affirmations sont devenues fausses parce qu'une unité ULTÉRIEURE a livré ce qu'elles
  déclaraient absent** — l'historique d'un déplacement (`CRM-044`), l'écran du déplacement
  (`CRM-041`), les écrans d'une affaire (`CRM-037`, `CRM-041`, `CRM-042`), le fil sur la fiche
  (`CRM-043`, `CRM-044`). Le manuel n'a pas menti : il a été laissé derrière ;
- **deux chiffres ont été rendus faux par `CRM-046`** — « neuf affaires », « quatorze réponses sur
  six affaires » — sans qu'aucun mécanisme ne le signale ;
- **une phrase citait un libellé que le produit n'affiche pas** : « Affaire introuvable » là où
  l'écran dit « Card introuvable ». Le même manuel écrivait déjà le bon libellé deux chapitres plus
  loin. C'est le seul écart qui était visible sans démarrer la pile ;
- **un chapitre promis par le sommaire n'existait nulle part** (`CRM-045`) ;
- **un écart est du PRODUIT, non du manuel** : décision 232.

**Conséquence.** L'unité ne se contente pas de corriger : elle livre deux harnais (§7 de la
spécification) dont le rôle est que la quatorzième dérive soit rouge avant d'être fausse.

### Décision 231 — Un volume du jeu de démonstration ne se recopie pas dans une phrase

**Problème.** Deux des treize écarts sont des nombres périmés, et ils ont le même mécanisme : une
grandeur mesurable recopiée dans une phrase n'a **aucun lien** avec la base qui la produit. Elle ne
vieillit pas, elle ment, en silence, à partir du jour où une autre unité change la base.

**Options.** (a) Continuer et compter sur la relecture — c'est ce qui a échoué deux fois.
(b) Retirer tous les nombres du manuel — un manuel utilisateur qui refuse de dire ce que l'espace
de démonstration contient est moins utile. (c) Les rassembler en **un seul endroit vérifiable**.

**Décision : (c).** Une annexe A dans `docs/manual.md`, une table `| grandeur | valeur |`, et la
prose qui y renvoie. `scripts/verify-manual.sh` compare la table à la base, ligne par ligne.

**La frontière est explicite**, sans quoi la règle serait ingérable : l'annexe porte les **états de
la base** — combien d'affaires, combien de réponses. Les chapitres gardent les **règles du
produit** — 25 lignes par page, 10 000 caractères, une probabilité entre 0 et 100. Les premières
changent quand un seed change ; les secondes quand le code change, et le code qui les porte est
testé.

**Conséquence assumée** : un nombre de l'annexe est un ÉTAT, pas un invariant — la leçon de la
décision 226. Le harnais exige l'égalité sur un seed fraîchement appliqué, et ne prétend rien
au-delà.

### Décision 232 — Un changement de dossier laisse une trace que le fil ne sait pas nommer : INC-077

**Ce que le manuel annonçait**, au chapitre 7 *bis*, livré avec `CRM-045` : « Le déplacement laisse
une trace *changement de dossier* dans l'historique ».

**MESURÉ le 2026-08-06.** La trace existe : `card_events` porte deux lignes de type
`channel_changed`, écrites par le serveur. Mais `webapp/src/app/PanneauTimeline.tsx` déclare huit
types — `created`, `moved`, `assigned`, `archived`, `unarchived`, `trashed`, `restored`,
`field_changed` — et **pas** `channel_changed`. La contrainte de la table en admet **neuf**. Le
neuvième tombe donc sur le repli `timeline.event.unknown`, et le fil affiche « Événement » : un
fait, sans dire lequel.

Le repli n'est pas un défaut en soi — il est délibéré (`docs/DESIGN_SYSTEM.md` §5.11 : « aucun
`undefined` n'atteint l'écran »). Le défaut est qu'un type **livré par le produit** l'emprunte.

**Décision : consigner, ne pas corriger.** INC-077. Ajouter un libellé et une pastille au fil
serait modifier un écran depuis une unité documentaire, contre `CLAUDE.md` §1, et engagerait aussi
`docs/DESIGN_SYSTEM.md` §5.11 — quelle famille de filtre accueille un changement de dossier ?
Discussion, non ; Étapes, non ; Cycle de vie, peut-être. La question relève de l'arbitrage, pas
d'un manuel.

**Ce que le manuel dit donc**, et c'est la seule phrase vraie disponible : la trace est écrite, elle
apparaît dans le fil, et le fil ne la nomme pas encore.

### Décision 233 — Le manuel se prouve par un visiteur anonyme réel, pas par une substitution

**Problème.** Les preuves d'interface du dépôt substituent presque toutes les réponses réseau
(`docs/DESIGN_SYSTEM.md` §12.5) : c'est la seule façon de montrer un écran chargé sans session,
INC-021. Or ce que le **manuel** promet à son lecteur n'est pas l'écran chargé — c'est ce qu'il
verra en ouvrant l'adresse aujourd'hui, sans compte.

**Décision.** `e2e/ui/manuel.spec.ts` n'emploie **aucune substitution** sur ses huit parcours : il
ouvre les huit adresses citées par le manuel en visiteur anonyme réel, contre l'API réelle, et
exige le **libellé exact** que le manuel cite entre guillemets. C'est la seule preuve du dépôt dont
l'objet est une phrase de documentation.

**Ce que cela attrape**, et qu'aucune preuve existante n'attrapait : un libellé qui change dans
`fr.ts` rend le manuel rouge le jour du changement, au lieu de le rendre faux jusqu'à ce qu'un
lecteur le remarque. C'est exactement l'écart n° 1 des treize.

**Une exception, nommée** : le neuvième scénario du fichier substitue un événement
`channel_changed`, parce que **rien d'autre ne peut le rendre visible** — le fil n'est jamais
atteint par un anonyme, et aucun jeton n'ouvre d'écran. Il ne prouve pas un parcours ; il mesure
INC-077 plutôt que de la déduire de la lecture d'un fichier.

### Décision 234 — Le harnais du manuel a trouvé deux défauts, et les deux étaient les miens

**Le premier, dans le manuel que je venais d'écrire.** L'annexe A portait « Événements
d'historique | 38 », recopié de `CRM-046`. La toute première exécution du harnais **après** la
suite d'API a rendu : « le manuel dit 38, la base dit **73** ». Le nombre n'était pas faux le jour
où il a été mesuré ; il est **incapable d'être vrai**, parce qu'un total d'événements ne fait que
croître et croît dès que quiconque touche une affaire — une personne comme une preuve automatisée.

C'est exactement la leçon de la décision 226, que je venais de citer dans la spécification, et que
j'ai enfreinte trois cents lignes plus loin en construisant l'annexe. La règle du §4 de
`docs/SPEC-manual.md` — « un nombre de l'annexe est un ÉTAT » — ne suffisait pas : elle décrivait la
fragilité sans exclure la grandeur qui ne peut pas la supporter.

**Correction :** la grandeur **sort de la table**, et son absence est expliquée dans le manuel
plutôt que masquée. Ce qui la remplace est le seul invariant que ce fil possède, et il est vérifié :
**aucune affaire sans son événement `created`**. Les vingt et une autres grandeurs, elles, sont
stables — mesuré, elles sont restées égales de part et d'autre des suites pgTAP, d'API et
d'interface.

**Le second, dans le harnais lui-même, et seule la contre-épreuve pouvait le trouver.** Deux
contrôles se terminaient par `[ "$trouve" -eq 0 ] && ok "…"`. Sous `set -e`, ce `&&` fait rendre
**1 à la fonction** dès qu'une anomalie est présente : le script s'interrompait alors **au premier
écart**, sans jouer les contrôles suivants ni imprimer son verdict. Sur un manuel conforme, `trouve`
vaut toujours zéro — le défaut était donc **invisible à toute exécution verte**, et le harnais
aurait paru complet en ne mesurant qu'une partie de ce qu'il annonce.

Il a été trouvé parce que la contre-épreuve exige un **nombre minimal d'anomalies** — cinq, une par
famille de contrôle — et non la simple présence d'un échec. Un seuil à « au moins une » l'aurait
laissé passer.

**Conséquence, générale et non locale :** un harnais de ce dépôt ne se termine pas par
`condition && ok`. La forme est remplacée par un `if` explicite dans les deux contrôles concernés,
et le motif est écrit dans le fichier à côté de la correction.

**Après correction, mesuré :** 105 contrôles verts sur le manuel réel ; **6 anomalies** sur le
manuel dégradé, réparties sur les cinq familles visées, et code de sortie `0` pour la
contre-épreuve.

### Décision 235 — La spécification de `CRM-050` est écrite après trois pannes, pas après une lecture

**Problème.** `CRM-050` tenait en quatre lignes de backlog : « Stalwart, Roundcube, ClamAV,
Inbucket conservé ; boîte système et deux boîtes personnelles seedées ». Aucun document ne disait
quelles images, quels ports, quels domaines, ni surtout comment un serveur mail se provisionne sans
qu'un exploitant tape des commandes à la main.

**Méthode.** La spécification (`docs/SPEC-mail-subsystem.md` §11) a été rédigée **après** avoir
fait tourner Stalwart, Roundcube et ClamAV en conteneurs isolés, et après avoir échoué trois fois.
Les trois échecs sont écrits dans la spécification, parce qu'aucun d'eux ne se lit dans une
documentation :

1. **La liaison `[::]` tue le serveur en silence.** C'est ce que génère `stalwart --init`. Sur un
   conteneur sans IPv6, le processus s'arrête sans écrire une ligne : `docker logs` rend le vide,
   le conteneur reste `Up`, aucun port n'écoute. Trente minutes ont été perdues à chercher une
   erreur de configuration là où il n'y avait qu'une famille d'adresses. Toutes les liaisons valent
   `0.0.0.0`.
2. **Le traceur fichier échoue si son répertoire n'existe pas** — `Failed to create log file`. Un
   traceur `stdout` est retenu : c'est aussi le seul qui alimente `./runDev.sh --withLog stalwart`.
3. **Un principal sans rôle s'authentifie et ne peut rien faire.** Créé sans `"roles":["user"]`, le
   compte valide ses identifiants — le serveur écrit `Authentication successful` — puis refuse la
   commande avec `Unauthorized access`, **sans rien renvoyer au client**, qui attend jusqu'à sa
   propre expiration. Le symptôme ressemble à un mot de passe faux ; la cause n'a rien à voir.

**Conséquence.** Le contrôle unitaire de cette unité porte sur la configuration elle-même : une
régression sur le point 1 rend la pile silencieusement morte, et c'est le seul contrôle capable de
l'attraper sans démarrer quoi que ce soit.

### Décision 236 — ClamAV est déclaré là où il est exercé, et sa production est une opération due

**Problème.** `docs/DAT.md` §3.6 énumère les composants **exclusivement** de développement, et
ClamAV n'y figure pas : c'est un composant de production. Fallait-il donc l'ajouter à
`docker-compose.yml`, l'assemblage commun ?

**Décision : non, pas dans cette unité.** Son unique consommateur est l'ingestion des pièces
jointes, livrée par `CRM-054`. L'ajouter aujourd'hui à l'assemblage commun obligerait la production
à démarrer et à tenir `healthy` un service qu'aucun autre n'appelle, et imposerait à `CRM-050` de
rejouer les preuves de production de `CRM-002` pour un effet qu'aucun énoncé de backlog ne demande
— c'est-à-dire d'inventer du périmètre (`CLAUDE.md` §1).

Le service est déclaré dans `docker-compose.dev.yml`, là où il est **réellement exercé** par les
preuves de cette unité. Son passage dans l'assemblage commun est inscrit comme **opération due**
dans `docs/PROD_MIGRATIONS.md` §4, sous l'unité qui l'appellera.

**Ce que cela coûte, et qui est nommé** : un écart dev/prod temporaire, borné par une unité
identifiée. Le taire aurait été le vrai défaut.

### Décision 237 — Deux domaines divergeaient parce qu'aucun service ne les comparait

**Mesuré.** `.env.example` portait `CRM_INBOUND_DOMAIN=crm.exemple.tld`. Le seed écrit
`inbound_domain = crm.p2enjoy.test` dans le workspace (`supabase/seed/apply-seed.sh`). Les deux
valeurs ne se sont jamais rencontrées : la section 13 de `.env.example` dit en toutes lettres
qu'« aucun service ne consomme encore ces variables ».

**Pourquoi cela cesse d'être anodin.** À partir de `CRM-050`, Stalwart déclare un domaine et lui
attache une boîte catch-all. Si ce domaine n'est pas celui que le produit inscrit dans les adresses
de cards, la boîte système n'attrape rien : elle refuserait les seules adresses qui existent. La
divergence passerait la compilation, passerait le démarrage, et ne se verrait qu'au premier message
perdu.

**Décision.** `CRM_INBOUND_DOMAIN` vaut `crm.p2enjoy.test` dans `.env.example`, la valeur que le
seed écrit réellement, et `scripts/verify-mail-infra.sh` **compare les deux** — la variable
d'environnement, et la colonne lue dans la base. Un futur changement de l'une sans l'autre rend le
harnais rouge.

### Décision 238 — Les preuves de protocole ne dépendent d'aucune bibliothèque IMAP ou SMTP

**Problème.** Prouver qu'un serveur IMAP répond suppose un client. Le réflexe est d'installer
`imapflow` ou `nodemailer`.

**Décision : parler le protocole sur une socket `node:net`.** Deux motifs, et le second est le plus
fort. D'abord, aucune dépendance n'est ajoutée au dépôt pour une unité d'infrastructure
(`CLAUDE.md` §19). Ensuite, le point ouvert n° 1 du §10 de `docs/SPEC-mail-subsystem.md` — le choix
d'une bibliothèque IMAP pour `mail-sync` — est explicitement réservé au chunk qui écrira le
service : le trancher ici, par le biais d'un test, serait le trancher sans l'instruire.

**Ce que cela apporte** : une preuve qui écrit `a1 LOGIN` et lit `a1 OK` éprouve le serveur. Une
preuve qui appelle une bibliothèque éprouve surtout la bibliothèque. Le `LIST` mesuré rend d'ailleurs
le délimiteur réel du serveur — `/` — dont `CRM-056` aura besoin pour ses dossiers imbriqués.

### Décision 239 — Le `viewer` n'a pas de boîte mail, et l'absence est un contenu

**Problème.** Le seed socle livre trois comptes. `CRM-050` demande « deux boîtes personnelles ».
Laquelle des trois reste sans boîte, et pourquoi ?

**Décision.** Farida Nowak, `viewer`, n'a pas de boîte. Un `viewer` lit ; il ne correspond pas. Lui
créer une boîte inutilisée laisserait croire que le produit lui destine une messagerie, ce
qu'aucune spécification ne dit, et le jeu de démonstration cesserait de décrire le produit pour
décrire une commodité de seed (`CLAUDE.md` §8).

**Conséquence utile** : les trois boîtes livrées couvrent les deux **natures** du §2.1 — une boîte
système à `owner_id` nul, deux boîtes personnelles rattachées à un propriétaire — ce qu'une
quatrième boîte n'aurait pas ajouté.

### Décision 240 — Trois défauts de mes propres preuves, trouvés en les exécutant

Les trois viennent du même endroit : un protocole se lit dans une RFC, mais se **mesure** sur un
serveur. Aucun n'aurait été vu par une relecture.

**1. `trim()` ne retire pas un octet NUL.** La réponse de `clamd` se termine par `\0`. Le premier
contrôle exigeait `PONG` et recevait `PONG\0`, ce qui s'affiche « PONG » dans un rapport et n'est
pourtant pas égal. Une heure de confusion possible pour un octet invisible ; le client retire
désormais les NUL avant de comparer.

**2. Une preuve de refus ne doit pas poursuivre le dialogue.** Le scénario qui prouve que la
soumission SMTP exige une authentification réutilisait le client d'envoi complet. Après le `535`
attendu, ce client envoyait `MAIL FROM` et recevait `503 You must authenticate first` — un code
qu'il n'attendait pas —, puis restait bloqué jusqu'à son propre délai. **L'échec était alors imputé
à une absence de réponse, alors que le serveur avait parfaitement refusé.** Une preuve de refus a
désormais son propre client, qui s'arrête à l'authentification.

**3. `SEARCH HEADER Message-ID "<jeton@domaine>"` ne trouve rien.** Stalwart n'indexe pas les
chevrons. La forme sans chevrons trouve. Le scénario cherchait donc éternellement un message qui
était pourtant bien remis — le journal du serveur disait `Message ingested`, et la boîte le
contenait. Le détail est écrit dans le fichier de preuve, plutôt que redécouvert par la prochaine
unité qui touchera à IMAP.

**Ce que ces trois défauts ont en commun** : dans les trois cas, la preuve accusait le serveur d'un
défaut qui était le mien. C'est le pire mode de défaillance d'un harnais — il ne rend pas un faux
vert, il rend un faux rouge, ce qui envoie chercher un défaut là où il n'y en a pas.

### Décision 241 — Le rejeu séquentiel des harnais n'est pas un instrument de mesure, et il a fallu le mesurer pour le savoir

**Ce que j'ai fait, et ce que j'en ai d'abord conclu.** Les vingt-six harnais du dépôt ont été
rejoués à la suite, pour la non-régression de `CRM-050`. Vingt-deux sont rendus rouges. La
conclusion évidente — « le chunk 3 a dérivé depuis `CRM-046` » — était **partiellement fausse**, et
c'est la contre-mesure qui l'a établie.

**La contre-mesure.** Cluster détruit, volumes détruits, migrations rejouées, seed réappliqué, puis
deux harnais exécutés **seuls** :

- `verify-seed-demo.sh` : **2 anomalies** en séquence, **62 contrôles et aucune anomalie** seul.
  Ses deux anomalies n'existaient pas — le rejeu les avait fabriquées.
- `verify-preuves-refus.sh` : **4** en séquence, **2** seul. Deux réelles, deux fabriquées.
- `verify-authz.sh` : **3** dans les deux cas. Celles-là sont réelles.

**La cause, mesurée elle aussi.** À la fin du balayage, `p2enjoy-migrations` était `exited (3)`,
sur un `deadlock detected` en pleine migration `0005`. Plusieurs harnais rejouent des migrations,
réappliquent le seed ou dégradent la base pour éprouver leur propre non-complaisance ; enchaînés,
ils se marchent dessus.

**Décision.** Le tableau de vingt-six lignes n'est **pas** consigné comme un état du dépôt. Ce qui
est consigné en **INC-080** est ce qui a été mesuré sur un état froid, harnais par harnais, plus le
défaut d'instrument lui-même — qui vaut plus que la liste, parce qu'il rend suspecte toute
livraison antérieure annonçant « les vingt-trois harnais rejoués ».

**Ce que je me suis interdit, dans les deux sens** : annoncer « tous verts », ce qu'ils ne sont
pas ; et annoncer « vingt-deux harnais cassés », ce qui aurait envoyé chercher des défauts
inexistants dans au moins deux d'entre eux.

### Décision 242 — Quatre garde-fous périmés, et un composant qui n'existe plus

**Mesuré sur un état froid**, donc indépendamment de l'ordre d'exécution : `verify-authz.sh`
(3 anomalies), `verify-cards.sh` (6), `verify-board.sh` (4) et `verify-preuves-refus.sh` (2)
échouent sur des volumes figés — neuf cards là où le seed en porte quatorze depuis `CRM-046`,
quarante et une politiques là où il y en a quarante-cinq. `git log` établit la chronologie sans
ambiguïté : les garde-fous datent de `CRM-010`, `CRM-040`, `CRM-041` et `CRM-014` ; le jeu de
démonstration complet est venu après, et ne les a pas suivis.

**Un cinquième écart n'est pas un compteur.** `scripts/verify-commentaires.sh` cherche
`webapp/src/app/PanneauCommentaires.tsx` et son test : **ces deux fichiers n'existent plus**.
`CRM-044` (commit `2575b89`) les a supprimés en fondant le panneau des commentaires dans
`PanneauTimeline.tsx`. Le harnais de `CRM-043` désigne donc un composant que l'unité suivante a
dissous. Et quatre harnais rendent « des classes citées n'existent pas dans le CSS produit », dont
la cause n'est pas établie.

**Décision : consigner, ne pas refermer au passage.** Réviser les garde-fous de cinq unités
antérieures dans le commit d'une unité du chunk 4 mêlerait six sujets à un changement qui n'en
traite qu'un. Et deux des écarts ne sont **pas** des compteurs — un composant dissous et des
classes CSS absentes demandent chacun une mesure qui leur est propre. Le point est ouvert en
**INC-080**, avec ses chiffres.

**Ce que je me suis interdit** : masquer les trois anomalies en annonçant « vingt-trois harnais
rejoués, tous verts ». Ils ne le sont pas, et la Definition of Done du projet interdit précisément
cette phrase-là.

**Ce que j'ai vérifié avant de conclure**, pour ne pas accuser une unité antérieure d'un défaut qui
serait le mien : la pile a été **entièrement reconstruite** — cluster détruit, volumes détruits,
migrations rejouées (`p2enjoy-migrations` `exited (0)`), seed réappliqué. La base porte alors
exactement les 14 cards et 45 politiques que le seed écrit, `npm run test:sql` rend 1405 assertions
sans anomalie, `npm run test:unit` 488 tests, et les preuves de `CRM-050` sont reprouvées à froid :
`npm run e2e:mail` 16 scénarios, `scripts/verify-mail-infra.sh` 72 contrôles sans anomalie.
`CRM-050` ne touche pas la base.

**Un bénéfice imprévu de cette destruction** : le provisionnement des boîtes a été prouvé **à
froid**, sur un volume RocksDB inexistant. La pile complète remonte en **33 secondes**, les trois
boîtes sont recréées, et rien n'exige d'intervention manuelle.

## 2026-08-07 — `CRM-011` repris : rendre les gestes du chunk 3 praticables par un utilisateur

### Décision 243 — L'écran de connexion rejoint l'authentification, et la session ne dépasse pas l'onglet

**Le constat.** Les scénarios d'interface de `CRM-041`, `CRM-043` et `CRM-047` le disent eux-mêmes :
leurs écrans chargés utilisent des réponses réseau substituées. Sans substitution, la webapp
appelle avec la clé anonyme, reçoit zéro ligne de la RLS et affiche « Track introuvable ». La base
sait déplacer une card et publier un commentaire avec les vrais jetons ; aucun utilisateur ne peut
atteindre ces gestes depuis le produit. INC-021 n'est donc plus seulement une dette de preuve :
c'est la frontière entre une démonstration d'interface et un CRM utilisable.

**L'arbitrage.** La demande du responsable est explicite : vérifier qu'un utilisateur peut
effectivement accomplir les actions implémentées. Parmi les trois options d'INC-021, l'écran est
rattaché à `CRM-011`. Cette unité porte déjà connexion, déconnexion et leur Definition of Done ;
créer une quatrième unité après dix-neuf unités bloquées aurait ajouté un nom sans clarifier une
responsabilité. `CRM-007` reste la coquille, et n'est pas élargie rétroactivement.

**La persistance.** INC-022 est tranchée par `sessionStorage`, catégorie 2 de `CLAUDE.md` §11. Une
session survit au rechargement de son onglet — condition minimale pour travailler — puis disparaît
avec lui. Le défaut `localStorage` de `supabase-js` n'est pas accepté. Si le stockage est refusé
par le navigateur, un repli mémoire préserve la connexion courante sans inventer de persistance.

**La preuve qui change de nature.** Un test du formulaire ne suffit pas. Le contrat exige deux
gestes déjà livrés : publier un commentaire et déplacer une card depuis le board, après connexion
par l'écran, contre la vraie API, puis relire l'effet hors interface. Le déplacement crée sa propre
card de test et la nettoie ; il ne transforme jamais les données stables de `CRM-046`. Le `viewer`
exerce le refus réel, parce qu'une action qui réussit avec l'administratrice sans preuve du refus
ne suffit pas à démontrer le contrôle d'accès.

**Ce qui n'est pas absorbé par cette décision.** L'invitation depuis le produit reste INC-015 :
elle exige un composant serveur détenant la clé de service. La récupération de mot de passe reste
prouvée hors interface tant que son parcours complet n'est pas spécifié. Les politiques des tables
d'identité restent INC-014 ; le nom du workspace peut donc rester absent, sans bloquer les objets
métier dont les politiques existent.

**Ordre tenu.** `docs/SPEC-auth.md` §9, `docs/DESIGN_SYSTEM.md` §5.12, le DAT, le backlog et les
deux incohérences sont mis à jour et committés avant la première ligne de code de l'écran.

### Décision 244 — Une session n'est prouvée utile que lorsqu'elle accomplit un geste réel

**Ce qui est livré.** `/connexion` appelle le vrai `signInWithPassword`, restaure la session avant
toute lecture métier, revient à l'adresse demandée et expose la vraie déconnexion dans l'en-tête.
Le stockage Supabase est remplacé explicitement : `sessionStorage`, miroir mémoire de secours,
jamais `localStorage`.

**La jonction mesurée.** Six scénarios navigateur parlent au build de production et à la pile
locale sans aucune substitution réseau. L'administratrice voit les trois tracks du seed, publie un
commentaire puis déplace une card créée pour la preuve ; les deux effets sont relus directement par
l'API. Le `viewer` voit une card de `maintenance`, mais son commentaire et son déplacement sont
refusés : son brouillon est conservé et la card reste dans `Prospection`. Les lignes temporaires
sont supprimées en `finally`.

**La suite historique a payé une dette utile.** Sur 141 scénarios initiaux, 140 ont passé. Le seul
rouge cherchait encore le mot « session » dans le bandeau du formulaire, alors que la connexion
existe désormais et que la vraie limite est l'absence de chemin d'enregistrement. L'attente a été
retournée vers « pas encore livré », puis le cas a passé. Un sixième scénario connecté a ensuite
porté le déplacement refusé, portant le total attendu à **142**. La suite finale complète rend
**142 scénarios passés sur 142** contre le build de production et la pile locale réelle.

**Vérification visuelle.** Les quatre captures de connexion — 1440, 1152, 900 et 390 px — et la
session chargée à 1440 px ont été regardées. Aucun débordement ; champs, focus et action restent
lisibles. La vue chargée montre un fait réel à ne pas masquer : `Aucun workspace accessible`
subsiste malgré les tracks, car `workspaces` et `profiles` restent en refus par défaut (INC-014).

**Chaîne finale.** `npm run typecheck`, `npm run build` et les **520 tests unitaires** passent. La
suite UI complète passe à **142/142**. Une relecture SQL après ces parcours constate zéro card et
zéro commentaire temporaires ; la card soumise au déplacement refusé porte toujours l'étape
`Prospection` du seed.

**Conséquence.** INC-021 et INC-022 sont closes. Les Definitions of Done de `CRM-011`, `CRM-041`,
`CRM-043` et `CRM-044` ont désormais leur chaînage réel et passent `[x]`. L'invitation depuis le
produit (INC-015), l'identité lisible (INC-014), l'enregistrement du formulaire et les actions de
correction/suppression d'un commentaire restent des limites distinctes ; aucune n'est absorbée par
la présence d'une session.

### Décision 245 — Un démarrage apparemment sain n'est pas un démarrage réussi

**La mesure utilisateur.** `./runDev.sh` a été exécuté comme documenté, après arrêt propre. Il a
créé les seize services, puis rendu `1` parce que `postgres-meta` était brièvement `unhealthy` ;
une seconde plus tard, le même conteneur était `healthy`. Son healthcheck d'image commence sans
`start_period` et dépense ses tentatives pendant l'initialisation. Ce n'est pas une temporisation
arbitraire : la fenêtre et les échecs `ECONNREFUSED` sont enregistrés par Docker. L'overlay doit
donc qualifier cette fenêtre comme démarrage, puis conserver le même endpoint et les mêmes
tentatives pour détecter une panne réelle.

Le même lancement a révélé deux défauts que la santé verte masque. Stalwart écrit trois `WARN` :
`session.auth.mechanisms`, `session.auth.require` et `imap.auth.allow-plain-text` sont des clés de
base déclarées dans le fichier local. Son code source au tag exact `v0.13.4` confirme cette
séparation. La valeur par défaut de cette version exige déjà l'authentification SMTP hors port 25 : la clé
`require` est supprimée. Les deux valeurs réellement particulières au développement sont écrites
de façon convergente par la véritable API `/api/settings`, relues, puis activées par
`/api/reload`. Les preuves IMAP et SMTP restent obligatoires : faire disparaître les avertissements
sans prouver l'effet serait un faux vert.

**INC-079 est tranchée, pas contournée.** Le même code source montre qu'au premier démarrage sans
blob, `v0.13.4` télécharge sans condition la release `latest` de `webadmin-oss.zip`. Il accepte en
revanche `webadmin.resource=file://…`. La console n'est utilisée nulle part : Roundcube porte la
preuve visuelle et `/api/*` le provisionnement. Un petit ZIP local versionné, monté en lecture
seule, contiendra donc une page qui dit explicitement que la console est désactivée. Stalwart
l'importera lui-même dans son blob store ; aucune écriture RocksDB artisanale. Cela supprime à la
fois la dépendance réseau, le contenu mouvant et les deux `ERROR`, sans masquer un événement du
journal.

**Le catch-all doit échouer avant Docker.** Le `.env` conservé sur ce poste portait encore
`crm.exemple.tld`, ancienne valeur du gabarit. `runDev.sh` l'a accepté, Stalwart a provisionné cette
boîte, puis `verify-mail-infra.sh` a seul signalé la divergence avec le seed
`crm.p2enjoy.test`. En développement, le domaine du seed est fixe : le script de lancement et la
réinitialisation doivent refuser toute autre valeur avant leur première action Docker, en nommant
la valeur attendue et le fichier à corriger. Le fichier local n'est jamais réécrit en silence.

**Critère de clôture.** Sur volume Stalwart absent : `./runDev.sh` sort en succès ; l'API, IMAP,
SMTP et Roundcube sont réellement exercés ; le journal de Stalwart ne porte ni `ERROR` ni `WARN` ;
sa racine rend la page explicative locale ; une configuration jetable au mauvais domaine est
refusée sans appeler Docker. INC-079 reste ouverte jusqu'à cette mesure. INC-080 reste un sujet
séparé : réparer les harnais historiques ne doit pas être mêlé au correctif de démarrage.

**Résultat mesuré.** La preuve a conservé les volumes normaux, arrêté leurs conteneurs, puis lancé
`./runDev.sh` sous le projet jetable `p2enjoy-crm-cold-proof`, dont le volume Stalwart était neuf.
Le script sort en succès ; Meta est sain ; `verify-mail-infra.sh` rend 84/84 et `e2e:mail` 16/16.
Une première version du verdict de journal était placée avant l'envoi et produisait un faux vert :
la soumission réelle révélait ensuite trois `WARN` de signatures ARC/DKIM inexistantes. Le
provisionnement désactive donc explicitement `auth.dkim.sign` et `auth.arc.seal` dans ce serveur
local sans clés de production, et le verdict vient désormais après une vraie soumission SMTP.
Après la suite E2E entière, le journal ne contient ni `WARN` ni `ERROR`. La racine HTTP a été
ouverte dans Chromium : statut 200, page française attendue et console propre. INC-079 est close.

---

### Décision 246 — Quarante et une branches n'auraient jamais dû exister, et une seule portait quelque chose

**Le problème.** Le dépôt distant portait quarante et une branches
`claude/happy-goldberg-*`. `CLAUDE.md` §13 interdit toute création de branche, de
worktree ou d'environnement Git parallèle : le travail se fait sur `main`
exclusivement. La consigne a été violée quarante et une fois. Le responsable a
demandé la récupération de ce qui n'était pas sur `main`, puis la suppression des
branches localement et sur `origin`.

**L'hypothèse à écarter.** « Rebaser les branches sur `main` » était la demande
littérale, et c'était la mauvaise opération. Ces branches ne sont pas des travaux
divergents à réintégrer : ce sont, pour l'essentiel, des **réexécutions parallèles
des mêmes unités de backlog**. Quatre branches distinctes implémentent le
déplacement d'une card entre channels, chacune avec sa propre migration numérotée
`0017`. Un rebase en aurait empilé trois de plus sur celle que `main` porte déjà.

**Les observations.** Mesures faites branche par branche, sur l'arbre et
l'historique, pas sur les noms de fichiers :

- vingt-six branches étaient déjà entièrement contenues dans `main` ;
- quinze ne l'étaient pas ; la comparaison fichier par fichier montre que `main`
  porte le même travail sous ses noms retenus — `ListeCards.tsx` contre
  `Liste.tsx`, `Board.tsx` contre `BoardChannel.tsx`, `PanneauTimeline.tsx` contre
  `PanneauCommentaires.tsx`, `0017_move_card_to_channel.sql` contre
  `0017_deplacement_channel.sql` et `0017_changement_channel.sql`,
  `stalwart/config.toml` contre `stalwart/config.json.template` ;
- une seule, `claude/happy-goldberg-qt5vfi`, portait du contenu que `main` n'a
  jamais reçu : `docs/ARBITRAGES.md`, et **dix-huit décisions de journal dont cinq
  arbitrages explicites du responsable**. Le comptage qui l'a isolée est direct :
  dix mentions de « arbitrage du responsable » et 250 décisions sur cette branche,
  contre cinq et 243 sur `main` ; toutes les autres branches sont sous ces deux
  seuils.

**La décision.** Le contenu unique est récupéré sur `main` **sans être fusionné**.
Les deux lignes ont numéroté leurs décisions en parallèle et les numéros 235 à 252
désignent des sujets différents de chaque côté. Les dix-huit entrées sont donc
reproduites verbatim dans `docs/ARBITRAGES_RECUPERES.md` sous une numérotation de
récupération `R-01` à `R-18`, et ce journal n'est pas réécrit. Conformément à
`CLAUDE.md` §5, la contradiction est consignée — INC-081 — et non résolue.

**Les conséquences.** Une conséquence est mesurée et laissée ouverte :
l'arbitrage `R-14`, « `require_fields` devient une table de liaison », n'est pas
appliqué sur `main`, où `docs/SCHEMA.md` décrit toujours un `uuid[]` sans intégrité
référentielle. À l'inverse, `R-04` et `R-05` sont déjà appliqués par la décision
243 : seule leur trace manquait. Les seize autres entrées ne sont pas jugées.

**Les vérifications réalisées.** Comparaison des arbres des quarante et une
branches contre celui de `main` : hors captures, vingt-neuf fichiers n'existent pas
sur `main`, tous rattachés à une réimplémentation parallèle sauf `docs/ARBITRAGES.md`.
Confirmation par `docs/BACKLOG.md` que `CRM-010` est clos sur `main` avec un harnais
pgTAP de 949 lignes, là où la branche `w9q87o` en proposait un second de 585 lignes.
Les empreintes des quarante et une têtes sont conservées dans
`docs/BRANCHES_SUPPRIMEES.md` : tant que le ramasse-miettes d'`origin` n'est pas
passé, chaque branche reste restaurable par `git push origin <sha>:refs/heads/<nom>`.

### Décision 247 — Un dépôt ignoré par Git n'est pas ignoré par Docker

**La panne utilisateur.** La preuve littérale de `CRM-050` a arrêté proprement la pile normale,
conservé ses volumes, puis relancé `./runDev.sh` sous un nom de projet Docker jetable. Ce nouveau
nom force la reconstruction de l'image web. BuildKit a essayé d'envoyer tout le dépôt comme
contexte et s'est arrêté sur `supabase/docker/volumes/db/data: permission denied` : PostgreSQL
referme volontairement ce répertoire en `0750`.

**La découverte de sécurité.** Il n'existait aucun `.dockerignore` à la racine, alors que
`webapp/Dockerfile` exécute `COPY . .`. Une inspection d'existence, sans lire aucun contenu, a
constaté `/app/.env` et `/app/.git` dans l'image de développement déjà construite. Le fait que
`.env` soit ignoré par Git ne protège donc ni le contexte Docker ni ses couches : les secrets
locaux ont été copiés dans une image.

**Décision.** Un `.dockerignore` racine doit exclure `.env`, `.git`, `node_modules`, les sorties
de build et de preuve, et tout `supabase/docker/volumes/`. L'image reste autonome parce que ses
manifestes, sources, migrations et documents utiles restent dans le contexte ; aucune donnée
d'exécution n'y entre. La preuve construit réellement l'image, vérifie seulement l'absence des
chemins sensibles — jamais leur contenu — puis retire l'ancienne image locale identifiée.

**Critère de clôture.** `./runDev.sh` reconstruit et démarre sous un nom de projet neuf ; la
nouvelle image ne contient ni `/app/.env`, ni `/app/.git`, ni `/app/supabase/docker/volumes`, et
le contrôle ne journalise aucune valeur sensible.

**Résultat mesuré.** Avec `.dockerignore`, le contexte BuildKit passe de 233,04 Mo à 11,56 Mo et
la reconstruction aboutit. `scripts/verify-scripts.sh` rend 58/58 après avoir construit l'image et
éprouvé uniquement l'absence des trois chemins sensibles ainsi que la présence de
`.env.example`. L'ancien identifiant d'image qui contenait `.env` et `.git` n'existe plus ; le
projet Docker jetable et ses volumes ont été supprimés, puis la pile normale a été restaurée sur
ses volumes conservés.

### Décision 248 — Le code des routes métier ne précède pas l'utilisateur sur l'écran de connexion

**La mesure.** Le build suivant la reprise de `CRM-050` est vert, mais Vite écrit un avertissement :
son unique chunk JavaScript pèse **530,59 kB minifiés**, pour une limite par défaut de 500 kB. Une
carte source a été produite sans changer la configuration. Sur 151 sources conservées, les plus
gros groupes non minifiés sont React DOM (545 kB), Supabase Auth (423 kB), React Router (347 kB),
puis le code applicatif (288 kB). Dans ce dernier groupe figurent `Board`, `ListeCards`,
`PanneauTimeline`, `RouteTrack` et `RouteCard`, tous importés avant même que `/connexion` puisse
être affichée.

**Décision.** `RouteTrack` et `RouteCard` deviennent deux imports dynamiques React. Ce sont les
frontières naturelles du produit : la première agrège board et liste, la seconde le formulaire et
la timeline. L'authentification, le routeur et la coquille commune restent immédiatement
disponibles. Une suspension rend le squelette existant avec un statut accessible ; aucune route ne
transite par une page blanche.

**Ce qui est explicitement refusé.** Le seuil `chunkSizeWarningLimit` n'est pas relevé et le
rapport n'est pas désactivé. Ces deux gestes feraient disparaître le message sans retirer un octet
du chemin initial. Un groupe `vendor` manuel n'est pas retenu non plus : il faciliterait le cache,
mais `/connexion` téléchargerait toujours tout le métier. Le découpage doit venir d'un geste réel
de navigation.

**Critère.** `npm run build` produit plusieurs chunks, chacun sous 500 kB, sans avertissement ; le
typecheck et les tests unitaires restent verts ; Playwright ouvre réellement une route de track et
une card après connexion, au clavier et à la souris, sans erreur de console.

**Résultat mesuré.** Le build produit quatre chunks JavaScript : point d'entrée **477,86 kB**,
`RouteTrack` **31,54 kB**, `RouteCard` **21,17 kB** et `channels` **1,29 kB**. Le seuil Vite reste
inchangé et aucun avertissement de taille n'est écrit. Les **524 tests unitaires** passent. Les
**142 scénarios UI sur 142** passent contre le build de production ; chacun porte désormais une
garde qui échoue sur tout `warning`, `error` ou `pageerror` résiduel. Les statuts HTTP provoqués
par les preuves de refus ne sont consommés qu'après leur effet visible et par message exact.

---

### Décision 249 — Stalwart 0.16 ne se configure plus par un fichier, et l'assemblage doit en tenir compte

*Rendue par le responsable sur `claude/happy-goldberg-qt5vfi` sous le numéro 235, réinsérée ici sous un numéro neuf : ce journal portait déjà un numéro 235 sur un autre sujet. Texte inchangé.*


**Problème.** `CRM-050` exige un vrai serveur IMAP/SMTP démarré par `./runDev.sh`, donc configuré
sans intervention humaine. La méthode que le backlog supposait — un fichier de configuration
versionné, comme pour tous les autres services de la pile — n'existe plus dans la version 0.16.

**Mesuré.** Démarré avec un volume `/etc/stalwart` vide, `stalwartlabs/stalwart:v0.16.16` entre en
*bootstrap mode* : il imprime un mot de passe d'administration **aléatoire, affiché une seule
fois**, ouvre le port 8080 et attend qu'un humain termine l'installation dans une interface web.
Cette interface est en outre **indisponible ici** : l'image la télécharge depuis `github.com` au
démarrage, et l'accès sortant du conteneur le refuse — `Failed to unpack application for prefixes:
admin, account`. Aucun des deux points ne se contourne par de la patience : ni l'un ni l'autre
n'est reproductible.

**Ce que la version 0.16 a réellement fait.** La configuration est coupée en deux : un
`/etc/stalwart/config.json` de **106 octets** qui ne porte que l'objet `DataStore`, et **tout le
reste dans le magasin de données**, piloté par un plan JSON déclaratif appliqué par
`stalwart-cli apply`. Mesuré : le fichier engendré par un bootstrap réussi tient en une ligne, et
`stalwart-cli snapshot` rend l'état vivant sous la forme exacte que `apply` réingère.

**Décision.** Le dépôt livre `stalwart/config.json` — monté en **lecture seule** — et
`stalwart/plan.json.template`. Le bootstrap n'a donc jamais lieu, l'interface d'administration
n'est jamais requise, et l'état visé est un fichier versionné plutôt qu'un souvenir de clics.
L'administrateur est fixé par `STALWART_RECOVERY_ADMIN`, dont `./runDev.sh` tire le mot de passe au
hasard comme tous les autres secrets de développement.

**Conséquence.** Deux services de plus dans l'overlay de développement : `stalwart-plan`, qui rend
le gabarit avec les valeurs du `.env`, et `stalwart-init`, qui applique le plan. L'image du CLI est
*distroless* — mesuré, elle n'a pas de `sh` — d'où la séparation en deux conteneurs plutôt qu'un
script d'entrée. L'application du plan est **convergente** : `upsert` sur `name` pour les domaines
et les comptes, `reconcile` pour le traceur, qui n'a aucune propriété d'identité et se dupliquerait
sinon à chaque démarrage.

---

### Décision 250 — Le plan ne déclare aucune écoute réseau, et c'est une contrainte mesurée

*Rendue par le responsable sur `claude/happy-goldberg-qt5vfi` sous le numéro 236, réinsérée ici sous un numéro neuf : ce journal portait déjà un numéro 236 sur un autre sujet. Texte inchangé.*


**Ce que je voulais faire.** Déclarer une écoute IMAP en clair sur 143 et une soumission sur 587,
pour que le développement n'ait ni TLS auto-signé ni vérification de pair à désactiver.

**Ce que la mesure a dit.** Les deux écoutes sont bien créées par le plan, `Action/ReloadSettings`
rend `Created Action`, et **le port reste fermé** : `Connection refused`, avant comme après le
rechargement. Une écoute n'est liée qu'au **démarrage suivant** du serveur. Déclarer une écoute
impose donc de redémarrer Stalwart après chaque application du plan — et, au premier démarrage
d'un poste, laisse une fenêtre où le serveur est sain mais muet sur les ports que le produit
attend.

**Ce que la mesure a aussi dit.** Un magasin vierge naît avec **sept écoutes par défaut**, dont
`smtp` (25), `submissions` (465, TLS implicite) et `imaps` (993, TLS implicite). Elles suffisent :
authentification IMAP réussie sur 993 pour les trois boîtes, soumission authentifiée réussie sur
465, et un message adressé à `c-abcd1234@crm.p2enjoy.test` — une adresse de card qui n'existe pas —
reçu dans l'`INBOX` de la boîte système par le catch-all du domaine.

**Décision.** Le plan ne déclare **aucune** écoute. Le développement parle IMAP et SMTP en TLS
implicite avec un certificat auto-signé, et les clients renoncent à vérifier le pair. Le compromis
est écrit dans `docs/SPEC-mail-dev-infra.md` §9.1 plutôt que dissimulé derrière un port en clair
qui n'aurait existé qu'au deuxième démarrage.

**Constat associé, qui n'est pas un défaut :** le port 25 annonce `STARTTLS` et **jamais** `AUTH` —
mesuré, `SMTPNotSupportedError`. C'est le comportement correct d'un MX. Toute expédition
authentifiée passe par 465, et le harnais en fait une preuve plutôt qu'une supposition.

---

### Décision 251 — Le domaine des cards passe sous un TLD réservé avant d'être réellement délivré

*Rendue par le responsable sur `claude/happy-goldberg-qt5vfi` sous le numéro 237, réinsérée ici sous un numéro neuf : ce journal portait déjà un numéro 237 sur un autre sujet. Texte inchangé.*


**Constat.** `.env.example` porte `CRM_INBOUND_DOMAIN=crm.exemple.tld` depuis `CRM-002`. La
variable n'était consommée par aucun service : sa valeur n'avait aucune conséquence.

**Ce qui change avec `CRM-050`.** Elle devient le domaine d'un serveur qui **délivre réellement**,
avec un catch-all qui accepte tout destinataire local inconnu. Or `exemple.tld` n'est réservé par
aucune RFC — c'est un domaine que quelqu'un peut posséder — alors que `.test` l'est par la
RFC 2606. Le seed socle avait déjà tranché la même question pour les adresses de ses comptes, et
pour le même motif : un email parti par erreur ne doit pouvoir atteindre personne.

**Décision.** La valeur par défaut devient `crm.p2enjoy.test`, et une seconde variable
`MAIL_TEAM_DOMAIN=p2enjoy.test` porte le domaine des boîtes personnelles. Les deux domaines restent
**distincts**, parce que `docs/SPEC-mail-subsystem.md` §1 pose que le compte entrant d'un
utilisateur et le domaine des cards sont deux objets indépendants : les confondre en développement
rendrait indétectable une erreur de routage que la production exhiberait.

**Conséquence.** Les adresses des deux boîtes personnelles sont exactement celles des comptes du
seed socle — `admin@p2enjoy.test` et `bizdev@p2enjoy.test`. Un développeur n'a pas deux identités à
retenir.

---

### Décision 252 — Trois défauts trouvés en exécutant le harnais, et les trois étaient les miens

*Rendue par le responsable sur `claude/happy-goldberg-qt5vfi` sous le numéro 238, réinsérée ici sous un numéro neuf : ce journal portait déjà un numéro 238 sur un autre sujet. Texte inchangé.*


**Le premier, dans le harnais lui-même, et il mentait dans le bon sens.** Le contrôle « les
journaux du serveur sont-ils visibles ? » s'écrivait :

```sh
if docker logs p2enjoy-stalwart 2>&1 | grep -q 'Network listener started'; then
```

Sous `set -o pipefail`, `grep -q` **sort au premier motif trouvé**. Le producteur reçoit alors
`SIGPIPE`, la commande de gauche échoue, et le code du tuyau est celui de l'échec : la condition
rend **faux précisément quand le motif est présent**. Mesuré : `docker logs` rendait 174 lignes,
dont sept `Network listener started`, et le contrôle annonçait « aucune ligne de journal ».

C'est le même genre de piège que la décision 234 — une forme d'écriture qui fait dire à un
contrôle l'inverse de ce qu'il mesure — et il est plus vicieux : ici, l'erreur produit un **faux
négatif**, donc un échec visible. Écrit dans l'autre sens (`fail` sur le motif trouvé, comme le
contrôle du bootstrap mode), le même défaut aurait produit un **faux positif**, invisible.

**Conséquence, générale et non locale :** un harnais de ce dépôt ne tuyaute pas une sortie
volumineuse vers `grep -q`. La sortie est lue une fois dans une variable, et la variable est
filtrée. Les cinq occurrences du fichier sont réécrites ainsi, et le motif est expliqué à côté de
la correction.

**Le deuxième, dans le plan déclaratif que je venais d'écrire.** Le traceur était décrit sans
`lossy` ni `multiline`. Or `matchOn: "*"` compare **par valeur** : deux champs manquants suffisent
à rendre l'objet « différent » de celui que le serveur stocke. Mesuré : la deuxième application du
plan rendait encore « 1 destroyed, 1 created » là où un plan convergent doit rendre « 0 destroyed,
0 created ». Le plan détruisait et recréait le traceur à chaque démarrage — sans jamais échouer,
donc sans jamais se signaler. Après correction : `0 destroyed, 6 updated, 0 created`, deux fois de
suite.

**Le troisième, dans la sonde du catch-all.** Elle cherchait le message par
`SEARCH HEADER Message-ID`. Mesuré sur `v0.16.16` : la recherche rend **zéro résultat** alors que
le message est bien dans l'`INBOX` — `SEARCH ALL` le liste, `SEARCH SUBJECT` le trouve. Le harnais
accusait donc le catch-all d'un défaut qui était le sien : les journaux du serveur montraient
`RCPT TO` réécrit en `system@crm.p2enjoy.test` puis `Message ingested`, c'est-à-dire une remise
parfaitement réussie.

La sonde cherche désormais par sujet, avec le même jeton aléatoire — tout aussi discriminant. Le
constat, lui, **n'est pas refermé** : il est consigné au §9.8 de la spécification, parce qu'il
concernera `CRM-054`, dont le dédoublonnage repose précisément sur le `Message-ID`.

**Quatrième constat, qui n'est pas un défaut mais une contrainte.** Le traceur `Stdout`, comme les
écoutes de la décision 250, n'est lu qu'**au démarrage** du serveur. Appliqué par `stalwart-init`
à un serveur déjà lancé, il ne prend effet qu'ensuite : sur un volume vierge, le tout premier
démarrage écrit encore dans un fichier, et `--withLog stalwart` ne montrerait rien.

`./runDev.sh` redémarre donc le serveur **si et seulement si** son journal de conteneur est vide.
La condition est **exacte**, et non heuristique : le traceur étant persistant, un journal vide
signifie exactement « le traceur n'était pas en place au démarrage ». Mesuré sur un volume neuf :
0 ligne avant, 31 après, et le second passage ne redémarre rien.

**Après correction, mesuré :** `scripts/verify-mail-infra.sh` rend **38 contrôles, aucune
anomalie** ; sa contre-épreuve rend **11 anomalies** sur une configuration dégradée, réparties sur
quatre familles, dont un serveur jetable privé de `config.json` qui entre bien en bootstrap mode.

---

---

### Décision 253 — L'écran de connexion a son unité : `CRM-009` (arbitrage du responsable, INC-021)

*Rendue par le responsable sur `claude/happy-goldberg-qt5vfi` sous le numéro 239, réinsérée ici sous un numéro neuf : ce journal portait déjà un numéro 239 sur un autre sujet. Texte inchangé.*


**Question posée.** La Definition of Done de `CRM-011` exige un « E2E de connexion et de refus ».
Aucune unité du backlog ne livrait l'écran qui rendrait cet E2E possible. Trois options étaient
soumises : rattacher l'écran à `CRM-011`, créer une unité dédiée, ou élargir `CRM-007`.

**Décision du responsable : option 2 — une unité dédiée.** Elle porte l'identifiant `CRM-009`,
libre, et se place dans l'ordre d'exécution **entre `CRM-007` et `CRM-008`** : la coquille existe
avant l'écran, et le harnais de tests vient après ce qu'il doit exercer.

**Motif retenu.** C'est la seule option qui laisse chaque unité à son objet. `CRM-011` a livré et
prouvé le **mécanisme** d'authentification sur 42 contrôles hors interface ; le rouvrir pour y
loger une interface mêlerait deux sujets qui n'ont ni les mêmes preuves ni le même risque.
`CRM-007` livre un **squelette**, et son énoncé ne mentionne ni formulaire, ni session, ni garde
de route. Une unité dédiée donne en outre un propriétaire clair à la posture de session — la
décision 254 — que les deux autres options auraient laissée orpheline.

**Ce que la décision coûte, et qui est assumé :** l'ordre du `docs/MASTER_PLAN.md` §2 est amendé
pour insérer `CRM-009` dans un chunk 2 déjà livré. C'est un coût d'écriture, une fois ; les deux
autres options avaient un coût de traçabilité, permanent.

**Conséquence directe et chiffrée.** `CRM-009` est la condition de fermeture de **dix-huit unités
`[~]`** dont le code est livré et prouvé et qui n'attendaient que cet arbitrage. Elles ne passeront
pas `[x]` d'un trait de plume pour autant : chacune sera reprise, sa preuve manquante réellement
exécutée, et son état révisé sur mesure.

---

### Décision 254 — La session vit en `sessionStorage` (arbitrage du responsable, INC-022)

*Rendue par le responsable sur `claude/happy-goldberg-qt5vfi` sous le numéro 240, réinsérée ici sous un numéro neuf : ce journal portait déjà un numéro 240 sur un autre sujet. Texte inchangé.*


**Question posée.** `docs/DAT.md` §3.1 se contredisait à quatre lignes d'intervalle. La version la
plus ancienne laissait entendre que la session serait « persistée par la bibliothèque » —
c'est-à-dire, par défaut, écrite dans `localStorage`, ce que `CLAUDE.md` §11 interdit sans
consentement explicite. Trois postures étaient soumises : mémoire seule, `sessionStorage`, ou
`localStorage` avec consentement.

**Décision du responsable : option 2 — `sessionStorage`.** La session survit au rechargement de la
page et disparaît à la fermeture de l'onglet.

**Motif retenu.** C'est la **catégorie 2** de `CLAUDE.md` §11 — une donnée limitée à la session —
qui n'exige aucun recueil de consentement. Elle donne le confort qui compte réellement dans un
outil de travail : un `F5` ne déconnecte pas. La mémoire seule aurait été perçue comme un défaut
quotidien ; le `localStorage` avec consentement est un vrai sujet produit, qui mérite son unité
plutôt qu'un coin d'écran de connexion.

**Ce que cela impose à `CRM-009`, et qui doit être prouvé :** le client `supabase-js` est
explicitement configuré — `persistSession` actif, `storage` visant `sessionStorage` — plutôt que
laissé à son défaut. La preuve exigée est symétrique et **hors interface autant que dedans** :
après connexion, `localStorage` reste **vide** et `sessionStorage` porte la session ; après
fermeture du contexte, rien ne subsiste.

**Ce que la décision n'ouvre pas.** Aucune bannière, aucun registre de consentement, aucune
troisième catégorie de `CLAUDE.md` §11. Une évolution vers « rester connecté » reste possible plus
tard, et devra alors être une unité, avec son consentement, son refus possible et sa trace.

---

### Décision 255 — Le secret de build du registre npm est câblé, et c'est une unité : `CRM-015` (arbitrage du responsable, INC-042)

*Rendue par le responsable sur `claude/happy-goldberg-qt5vfi` sous le numéro 241, réinsérée ici sous un numéro neuf : ce journal portait déjà un numéro 241 sur un autre sujet. Texte inchangé.*


**Question posée.** L'image de la webapp ne se construit pas dans l'environnement de la routine :
`npm ci` échoue en `SELF_SIGNED_CERT_IN_CHAIN` derrière un proxy à certificat interposé. Le
`Dockerfile` prévoit pourtant déjà un secret de build `npm_ca` — **aucun fichier Compose ne le
fournit**. Trois options : contourner à chaque exécution, câbler le secret, ou fournir une image
préconstruite.

**Décision du responsable : option 2 — câbler le secret**, dans une **unité à part entière**,
`CRM-015`, et non au détour d'une autre.

**Motif retenu, et il est mesuré.** INC-042 en est à sa **onzième occurrence**. Onze occurrences
constituent une mesure, pas une malchance. Le coût n'est pas seulement du temps : c'est une
**preuve perdue à chaque unité** — `./runDev.sh` n'a jamais été exécuté de bout en bout, alors que
la Definition of Done de `CRM-050` l'exige nommément, et que toutes les unités d'interface
reposent sur lui. Câbler le secret est la seule voie qui rende cette preuve atteignable.

**Contrainte non négociable attachée à la décision :** le certificat est **fourni par
l'environnement**, jamais versionné. Aucun fichier du dépôt ne contient de certificat, et
l'assemblage doit rester **inerte** là où la variable est absente — un poste sans proxy ne doit
rien voir changer. C'est la condition à laquelle cette décision est prise.

**Conséquence :** `CRM-050` cesse d'avoir une preuve manquante pour un motif étranger à son objet.
Elle sera reprise et close par la mesure, pas par déclaration.

---

### Décision 256 — L'invitation est rattachée à `CRM-070` (arbitrage du responsable, INC-015)

*Rendue par le responsable sur `claude/happy-goldberg-qt5vfi` sous le numéro 242, réinsérée ici sous un numéro neuf : ce journal portait déjà un numéro 242 sur un autre sujet. Texte inchangé.*


**Question posée.** `POST /auth/v1/invite` exige la clé de service, que la webapp ne doit jamais
détenir, et aucun composant serveur n'existe pour porter le parcours. Trois options : rattacher à
`CRM-070`, créer une unité dédiée maintenant, ou assumer définitivement l'invitation comme une
opération d'exploitation.

**Décision du responsable : option 1 — rattacher à `CRM-070`**, l'unité d'administration des
permissions fines, qui traite déjà de la gestion des membres.

**Motif retenu.** L'option 2 aurait fait prendre **trois décisions d'architecture d'un coup** —
une table d'invitations absente de `docs/SCHEMA.md`, un appel sortant depuis la base absent de
`docs/DAT.md` §3, et une clé de service à provisionner en Vault — pour servir un geste **rare**,
alors que l'écran de connexion sert un geste quotidien. L'ordre de valeur est clair. L'option 3
était écartée : un CRM où seul un opérateur peut créer un compte n'est pas un produit.

**Ce qui est exigé en attendant, et qui n'est pas facultatif :** le comportement réel —
l'invitation est émise par un **opérateur** disposant de la clé de service, hors interface — doit
être **nommé explicitement dans `docs/manual.md`**, chapitre 17, plutôt que promis comme un
parcours livré. Un manuel qui décrit un écran qui n'existe pas est un défaut, pas une anticipation.

**Ce qui reste ouvert et le reste sciemment :** les trois choix d'architecture ci-dessus sont
reportés, pas tranchés. `CRM-070` devra les prendre explicitement, et INC-014 — les politiques RLS
des tables d'identité — posera la même question pour l'éventuelle table d'invitations.

---

### Décision 257 — La garde de ports lit `/proc/net/tcp` en dernier recours (arbitrage du responsable, INC-044 et INC-079)

*Rendue par le responsable sur `claude/happy-goldberg-qt5vfi` sous le numéro 243, réinsérée ici sous un numéro neuf : ce journal portait déjà un numéro 243 sur un autre sujet. Texte inchangé.*


**Question posée.** Sans `ss` ni `netstat`, `host_listening_ports` rend une liste **vide**. Les
deux consommateurs se comportent alors de façon opposée : `require_free_ports` avertit et laisse
démarrer — voulu —, tandis que `scripts/verify-scripts.sh` **échoue**, comparant quinze ports
publiés à une liste vide. Trois options : faire s'abstenir le contrôle, lire `/proc/net/tcp` en
dernier recours, ou accepter `lsof` comme troisième source.

**Décision du responsable : option 2 — lire `/proc/net/tcp`.**

**Motif retenu.** C'est la seule option qui ferme les **deux** entrées à la fois, et surtout la
seule qui rende la garde **réellement** protectrice au lieu d'apparemment protectrice. L'option 1
aurait fait taire le harnais en laissant l'angle mort intact : sur un tel hôte, un vrai conflit de
port serait resté invisible jusqu'à l'échec de Compose — ce qui est le risque de fond derrière
INC-044, et non le message d'erreur qui l'a révélé. `/proc/net/tcp` est présent sur tout Linux ;
son format hexadécimal est une dizaine de lignes, et il est testable.

**Rattachement :** `CRM-002`, l'unité qui porte `scripts/lib/env.sh` et son harnais. La correction
n'est pas faite depuis une unité qui ne traite pas ce sujet.

**Exigence attachée :** la lecture de `/proc/net/tcp` doit être prouvée **dans les deux sens** —
elle voit un port réellement ouvert, et ne voit pas un port fermé —, faute de quoi on aurait
remplacé une garde inerte par une garde qui se croit active.

**Mise en œuvre mesurée le 2026-08-07.** `host_listening_ports` conserve `ss` puis `netstat` en
priorité et lit les deux tables du noyau en dernier recours. Le parseur awk n'emploie pas
`strtonum()` — absent de BusyBox —, convertit les ports hexadécimaux lui-même et ne retient que
l'état `0A` (`LISTEN`). La preuve masque réellement les deux commandes prioritaires, ouvre une
socket IPv4 sur un port choisi par le noyau, la retrouve, tue puis attend le processus qui la
détient, et constate que le même port fermé n'est plus rendu. Une fixture IPv4/IPv6 écarte aussi
un état non `LISTEN`. Deux faux défauts de la preuve ont été trouvés avant son vert : le premier
processus rendait son PID de wrapper, puis `grep -q` fermait son pipe avant la fin sous
`pipefail`. Aucun n'a été masqué. Résultat final : `scripts/verify-scripts.sh` **64/64**.

---

### Décision 258 — La collision du numéro 180 est levée par un suffixe, jamais par une renumérotation

*Rendue par le responsable sur `claude/happy-goldberg-qt5vfi` sous le numéro 244, réinsérée ici sous un numéro neuf : ce journal portait déjà un numéro 244 sur un autre sujet. Texte inchangé.*


**Constat (INC-069).** Deux entrées portaient « Décision 180 », poussées par deux exécutions
concurrentes de la routine qui avaient lu le même numéro avant que l'autre ne pousse le sien.
`docs/BACKLOG.md` et `CHANGELOG.md` citent « décision 180 » pour l'une, `docs/JOURNAL.md` pour
l'autre : un lecteur qui suit la référence tombe sur l'une ou l'autre selon l'ordre de lecture.

**Décision : suffixer les titres — `180 a` et `180 b` — et ne renuméroter ni l'une ni l'autre.**
Renuméroter casserait les références qui les citent, et **les deux sont citées**. Le suffixe rend
la référence levable : « décision 180 » désigne désormais un couple dont le lecteur voit
immédiatement les deux membres, au lieu d'un numéro qui désigne deux choses sans le dire.

**La cause, elle, est traitée ailleurs** : la routine est sérialisée (décision issue d'INC-059).
Cette entrée reste la trace de ce que la concurrence a coûté.

---

---

### Décision 259 — Une liste d'exemples du responsable n'est pas une spécification exhaustive

*Rendue par le responsable sur `claude/happy-goldberg-qt5vfi` sous le numéro 245, réinsérée ici sous un numéro neuf : ce journal portait déjà un numéro 245 sur un autre sujet. Texte inchangé.*


**Constat (INC-003).** Le workflow par défaut déclare une sortie vers « Perdu » depuis Prospection,
Relance, Négociation et Signature, mais **pas depuis Réalisation**. Une affaire signée puis
abandonnée en cours de réalisation n'a donc **aucun chemin** vers « Perdu » : `move_card` refuse une
transition non déclarée, et la card reste bloquée — ou quelqu'un la fait reculer en « Négociation »
pour pouvoir la perdre, ce qui fausse l'historique et l'analytique.

**Question posée au responsable : oubli de qui ?** Réponse : le responsable avait **listé des
exemples** et attendait des propositions. L'oubli est donc **celui de l'agent** — l'unité qui a écrit
le workflow seedé a recopié les exemples comme s'ils étaient le graphe complet, au lieu de les
traiter pour ce qu'ils étaient : un point de départ à compléter et à soumettre.

**Décision : la transition « Réalisation → Perdu » est ajoutée**, et le graphe du workflow par défaut
est **relu en entier** à cette occasion — chaque étape doit avoir au moins une sortie, et toute
étape sans issue est soit justifiée, soit complétée.

**Règle générale, et c'est le vrai enseignement.** Lorsqu'un document du responsable donne une
**énumération d'exemples**, l'agent ne la recopie pas telle quelle : il la complète, propose le
résultat, et **nomme** ce qu'il a ajouté. Un exemple recopié en silence devient une spécification que
personne n'a écrite, et le défaut ne se voit qu'à l'usage — ici, un cul-de-sac dans un workflow, à
l'endroit exact où une affaire échoue.

**Mise en œuvre rattachée au seed** (`CRM-005`, `CRM-046`), avec la relecture du graphe complet.

---

### Décision 260 — Les fonctions edge entrent au périmètre : la décision 12 est rouverte

*Rendue par le responsable sur `claude/happy-goldberg-qt5vfi` sous le numéro 246, réinsérée ici sous un numéro neuf : ce journal portait déjà un numéro 246 sur un autre sujet. Texte inchangé.*


**Constat (INC-007).** `README.md` §10 annonce un répertoire `supabase/functions/` — « Edge functions
Deno » — qui **n'existe pas**. Le service `edge-runtime` n'est pas déployé, la route
`/functions/v1/` n'est pas déclarée dans la passerelle, et **aucune unité** n'en prévoit.

La décision 12 les avait écartées, au même titre qu'`analytics` et `imgproxy`. L'agent en avait
déduit, dans le dossier d'arbitrage, qu'il fallait **retirer la mention du README**.

**Le responsable tranche l'inverse, et le motif est explicite :** les fonctions edge sont
**explicitement mentionnées** par le socle documentaire. Les retirer aurait consisté à faire
disparaître une contradiction en supprimant la moitié qui gênait, plutôt qu'en livrant ce que le
document annonce. **La décision 12 est rouverte sur ce point.**

**Décision : `edge-runtime` est déployé, `supabase/functions/` existe, et la route `/functions/v1/`
est déclarée dans la passerelle.** Une unité dédiée les porte — **`CRM-016`**.

**Ce que cela change au-delà de l'infrastructure.** Deux besoins réels n'avaient aucun porteur
naturel et en trouvent un :

- l'**invitation d'un membre** (INC-015), qui exige la clé de service et ne peut pas vivre dans la
  webapp — `CRM-070` pourra s'appuyer sur une fonction edge plutôt que sur un appel sortant depuis
  la base par `pg_net`, chemin plus contournant ;
- les **webhooks sortants signés** (`CRM-073`).

**Ce que cela ne change pas :** la logique métier reste en PostgreSQL, et `mail-sync` reste un
service Python — IMAP et SMTP demandent des connexions longues, incompatibles avec des fonctions
courtes (`docs/DAT.md` §3.3). Les fonctions edge s'ajoutent, elles ne remplacent rien.

---

### Décision 261 — L'ordonnancement passe à `pg_cron` : la décision 8 est renversée

*Rendue par le responsable sur `claude/happy-goldberg-qt5vfi` sous le numéro 247, réinsérée ici sous un numéro neuf : ce journal portait déjà un numéro 247 sur un autre sujet. Texte inchangé.*


**Constat (INC-012).** La décision 8 plaçait l'ordonnancement — relances, séquences, digest, purge
RGPD — dans `mail-sync` plutôt que dans `pg_cron`, sur **deux** motifs. `CRM-004` a **démenti le
premier** par la mesure : `pg_cron` 1.6.4 est présent, préchargé et fonctionnel dans l'image
épinglée. Seul le motif de testabilité subsistait.

**Décision du responsable : utiliser `pg_cron`.** La décision 8 est renversée, pas seulement
corrigée dans son énoncé.

**Motif retenu.** Le compromis assumé de l'ordonnanceur applicatif était écrit noir sur blanc dans
`docs/DAT.md` §12 : « **les tâches planifiées s'arrêtent si le service s'arrête** ». Pour des
relances commerciales, un digest quotidien et une purge RGPD, c'est un compromis coûteux : une
purge RGPD qui ne s'exécute pas est un manquement, pas un retard. `pg_cron` s'exécute là où vivent
les données et là où vivent déjà les règles métier — une seule source de vérité, comme pour le
reste du produit.

**Ce que la décision coûte, et qui est assumé :** les tâches planifiées deviennent testables par
pgTAP plutôt que par pytest. C'est le motif de testabilité qui tombe — il tenait seul depuis
`CRM-004`, et il ne pèse pas contre une purge qui ne part pas.

**Mise en œuvre : unité `CRM-017`.** `docs/DAT.md` §3.3 et §12 sont corrigés dans le même
changement, et le périmètre de `CRM-051` (`mail-sync`) perd son sous-composant `scheduler`.

---

### Décision 262 — `require_fields` devient une table de liaison : le modèle est corrigé, pas contourné

*Rendue par le responsable sur `claude/happy-goldberg-qt5vfi` sous le numéro 248, réinsérée ici sous un numéro neuf : ce journal portait déjà un numéro 248 sur un autre sujet. Texte inchangé.*


**Constat (INC-033).** `workflow_transitions.require_fields` est un `uuid[]`. **Mesuré :**
PostgreSQL refuse toute clé étrangère depuis une colonne tableau. Ce n'est pas un différé
d'ordonnancement : c'est une propriété du type, qui ne changera jamais. La suppression d'un champ de
formulaire laisse donc des identifiants **morts** dans les tableaux des transitions, et rien ne le
signale.

**Décision du responsable : on rouvre pour mieux refaire.** `require_fields` est remplacée par une
**table de liaison** `(transition_id, field_id)`, avec ses deux clés étrangères et son
`ON DELETE CASCADE`.

**Motif retenu.** L'option d'accepter le type et d'ajouter un nettoyage au moment de la suppression
d'un champ aurait reproduit **en code applicatif** ce que le moteur sait faire seul, et l'aurait
reproduit **imparfaitement** : un nettoyage oublié dans un chemin de suppression laisse exactement
la donnée morte qu'on prétend éviter. L'intégrité référentielle est le travail de la base.

**Ce que la décision coûte, et qui est assumé :** elle rouvre `CRM-031` et `CRM-035`, livrées et
prouvées. La migration, la mise à jour de `copy_workflow_to_track`, du seed, des suites pgTAP et des
preuves d'API sont du travail réel. **Mise en œuvre : unité `CRM-018`.**

**Conséquence sur une entrée voisine :** INC-056 constatait que la copie de workflow recopie
`require_fields` tel quel et fait varier un compte global. La table de liaison rend ce comptage
déterministe par construction.

---

### Décision 263 — Changer le workflow d'un channel entier est un geste distinct : `change_channel_workflow`

*Rendue par le responsable sur `claude/happy-goldberg-qt5vfi` sous le numéro 249, réinsérée ici sous un numéro neuf : ce journal portait déjà un numéro 249 sur un autre sujet. Texte inchangé.*


**Constat (INC-046, INC-073).** `docs/SCHEMA.md` §9 décrivait `move_card_to_channel(card_id,
channel_id, step_mapping)` — « remappage explicite **des étapes** », au pluriel —, tandis que
`docs/SPEC-workflow-engine.md` §6 décrit **une** card et **une** étape de destination. `CRM-045` a
livré la seconde lecture.

**Décision du responsable : le geste pluriel est retenu** — changer le workflow d'un channel entier,
en remappant l'étape de toutes ses cards en un appel.

**Conséquence : deux fonctions distinctes, deux noms distincts.** Le pluriel du §9 n'était donc pas
une erreur de rédaction : il décrivait une fonction que personne n'avait encore nommée.

| Fonction | Objet |
|---|---|
| `move_card_to_channel(card_id, channel_id, step_id)` | Une card change de dossier. **Livrée par `CRM-045`, inchangée** |
| `change_channel_workflow(channel_id, workflow_id, step_mapping)` | Un channel change de workflow, et l'étape de **toutes** ses cards est remappée |

`docs/SCHEMA.md` §9 est corrigé pour nommer les deux. **Mise en œuvre : unité `CRM-019`.**

**Ce que la seconde fonction devra garantir, et qui n'est pas négociable :** le remappage est
**explicite et exhaustif** — aucune étape de départ n'est devinée, aucune card ne reste sur une
étape qui n'appartient pas à son nouveau workflow —, et le refus est renvoyé **entier** plutôt
qu'appliqué à moitié.

---

### Décision 264 — Les gabarits d'emails sont servis, et une preuve d'email vérifie son contenu

*Rendue par le responsable sur `claude/happy-goldberg-qt5vfi` sous le numéro 250, réinsérée ici sous un numéro neuf : ce journal portait déjà un numéro 250 sur un autre sujet. Texte inchangé.*


**Constat (INC-016).** Le produit est en français ; les emails transactionnels partent en
**anglais**. Mesuré : `supabase/gotrue:v2.189.0` ne charge un gabarit personnalisé que par **HTTP**,
et le repli vers le gabarit par défaut est **silencieux du point de vue du destinataire**.

**Décision du responsable : servir les gabarits en HTTP depuis la pile.**

**Exigence attachée, et elle vaut au-delà de cette entrée :** toute preuve portant sur un email
vérifie son **contenu**, jamais sa seule présence. Un email reçu ne prouve pas que le gabarit
configuré a été employé — c'est précisément ce que la mesure a montré.

**Mise en œuvre rattachée à `CRM-009`**, qui touche déjà l'authentification et ses parcours.

---

### Décision 265 — Le chemin d'administration de GoTrue est encadré, pas accepté

*Rendue par le responsable sur `claude/happy-goldberg-qt5vfi` sous le numéro 251, réinsérée ici sous un numéro neuf : ce journal portait déjà un numéro 251 sur un autre sujet. Texte inchangé.*


**Constat (INC-018).** Mesuré : `POST /auth/v1/admin/users` crée un compte avec un mot de passe de
**8 caractères** là où le chemin utilisateur en exige 12 et refuse en `422 weak_password`. Le compte
ainsi créé est utilisable : il se connecte.

**Décision du responsable : interdire ce chemin en production et le documenter comme une opération
d'exploitation encadrée.**

**Motif retenu :** l'accepter au motif qu'il exige la clé de service reviendrait à dire qu'un
privilège dispense d'une règle. La politique de mot de passe n'est pas une gêne pour l'utilisateur,
c'est une propriété du produit — et un compte à 8 caractères créé par commodité est exactement la
brèche qu'elle existe pour éviter.

**Mise en œuvre :** `docs/PROD_MIGRATIONS.md` et `docs/SPEC-auth.md` §4, qui cesse d'énoncer la
politique « sans réserve » et nomme le chemin qui y échappe.

---

### Décision 266 — La copie de workflow contre la surcharge : l'écart est confirmé

*Rendue par le responsable sur `claude/happy-goldberg-qt5vfi` sous le numéro 252, réinsérée ici sous un numéro neuf : ce journal portait déjà un numéro 252 sur un autre sujet. Texte inchangé.*


**Constat (INC-005).** `CLAUDE.md` §4 demande que « tout existe par défaut au niveau général, puis
les contextes spécialisés ne définissent que leurs différences ». Le responsable avait demandé de
**copier** un workflow global dans un track pour l'y modifier.

**Décision du responsable : l'écart est confirmé.** L'instruction explicite prime (`CLAUDE.md` §26,
priorité 2 sur priorité 8), et la compensation est en place et prouvée : l'origine reste connue
(`derived_from_workflow_id`, `derived_at`) et la divergence est signalée.

**L'entrée est close** : elle était ouverte « pour information », en attente de cette confirmation.

---

### Décision 267 — Le contrôle CSS distingue les classes absentes de son propre défaut

**Mesure (INC-080).** Les quatre harnais web qui annonçaient des classes absentes mélangeaient
deux catégories. `text-muted`, `placeholder:text-muted`, `sm:hidden` et `sm:inline` sont réellement
impossibles à produire : la palette fermée expose `text-3`, pas `muted`, et les paliers fermés
commencent à `md`, pas à `sm`. À l'inverse, `before:content-['·']` est présent dans le CSS sous le
sélecteur échappé par Tailwind ; c'est le contrôleur qui ne protégeait pas l'apostrophe. Un second
défaut du harnais écrivait `grep: Invalid collation character` parce qu'il employait la plage
locale-dépendante `À-ÿ`.

**Décision.** Les composants emploient les seuls jetons et paliers déclarés : `text-text-3`,
`placeholder:text-text-3`, `md:hidden` et `md:inline`. Le contrôleur CSS échappe les apostrophes de
la même façon que Tailwind, et le contrôle des attributs visibles remplace la plage fragile par la
classe POSIX `[[:alpha:]]`.

**Garde de non-complaisance conservée.** Le harnais continue d'injecter réellement `px-7`, classe
hors de l'échelle fermée, puis exige que son propre contrôle échoue. Corriger un faux positif ne
doit pas transformer la preuve en acceptation silencieuse.

**Critère.** Après un vrai build, toutes les classes citées existent dans le CSS produit, la
dégradation `px-7` est refusée et le contrôle d'internationalisation n'écrit aucun diagnostic de
moteur. Les captures aux quatre paliers confirment visuellement que le changement de nom de jeton
et de palier ne dégrade ni contraste ni navigation.

**Résultat mesuré.** **167 classes citées sur 167** existent dans le CSS du build. Une copie des
sources réellement dégradée avec `px-7` est refusée par le contrôleur avec le code exact `1` ; un
exécutable absent (`127`) ne peut donc pas donner un faux vert. Le contrôle des attributs ne rend
ni texte visible en dur ni diagnostic de moteur. Les 142 scénarios UI passent, et les captures
mobile, intermédiaire et large des neuf familles régénérées ont été observées : aucun contraste,
débordement ou contrôle inaccessible nouveau.

---

### Décision 268 — Une décision réinsérée n'est pas une décision appliquée : la passe de cohérence

**Le problème.** Les dix-huit décisions du responsable réinsérées par la décision 246 étaient
revenues dans `docs/JOURNAL.md`, et nulle part ailleurs. Or elles créent des unités, en rouvrent
d'autres, renversent deux décisions d'architecture et corrigent un rattachement. Un journal qui
porte seul une décision que le reste du documentaire ignore ne vaut pas mieux qu'une décision
perdue : il donne l'illusion de la trace.

**Ce que la passe a propagé.** Six unités créées — `CRM-009` (écran de connexion), `CRM-015`
(secret de build du registre npm), `CRM-016` (fonctions edge), `CRM-017` (ordonnancement par
`pg_cron`), `CRM-018` (`require_fields` en table de liaison), `CRM-019`
(`change_channel_workflow`). Sept unités existantes annotées de la conséquence qui les touche, dont
`CRM-031` et `CRM-035` **rouvertes**, et `CRM-051` amputée de son sous-composant `scheduler`.
`docs/MASTER_PLAN.md` §2 amendé pour insérer `CRM-009` entre `CRM-007` et `CRM-008` et borner le
chunk 2 à `CRM-019`. `docs/DAT.md` : le diagramme, le §3.3 et le §12 passent à `pg_cron` et
accueillent `edge-runtime`. `docs/SCHEMA.md` §9 nomme les deux fonctions de déplacement, et le §3
porte la table de liaison décidée. `docs/SPEC-auth.md` gagne un §4.1 sur le chemin d'administration
de GoTrue. `docs/PROD_MIGRATIONS.md` §7 décrit l'opération encadrée. `README.md` §10 cesse
d'annoncer un arbitrage rendu. `docs/manual.md` chapitre 17 nomme l'invitation pour ce qu'elle est.
`.env.example` déclare `MAIL_TEAM_DOMAIN`. Seize entrées du registre reçoivent leur arbitrage, et
INC-005 est close par la décision 266.

**Ce que la passe a trouvé, et qui n'était pas cherché.** Deux contradictions, l'une corrigée et
l'autre consignée.

La première est corrigée. `docs/SPEC-auth.md` §9 rattachait le parcours de connexion à `CRM-011`
« selon l'option la plus étroite ». C'était **l'option 1** des trois soumises au responsable, qui a
retenu l'**option 2** — une unité dédiée. Un agent avait donc tranché un arbitrage que le
responsable avait déjà rendu autrement. Le comportement livré est conforme à la décision 254 ;
c'est le rattachement qui était faux, et il est corrigé dans `docs/SPEC-auth.md`, `docs/DAT.md`
§3.1 et `docs/BACKLOG.md`. `CRM-009` est donc `[~]` et non `[ ]` : son code existe, sous la mauvaise
unité, et les commentaires `@spec` restent à reprendre.

La seconde est consignée, pas résolue — **INC-082**. Les décisions 249, 250 et 252 décrivent un
assemblage Stalwart que `main` n'a pas adopté : `config.json` et `plan.json.template` contre
`config.toml` et `provision.sh`, et surtout **aucune écoute déclarée** contre les **cinq** que
`main` déclare. Elles citent en outre `docs/SPEC-mail-dev-infra.md`, absent de ce dépôt. Trancher
aurait consisté soit à réécrire des décisions du responsable, soit à défaire une infrastructure qui
tourne. Ni l'un ni l'autre n'est du ressort de cette passe.

**Ce qui n'a pas été fait, et c'est délibéré.** Aucune ligne de code n'est modifiée. Aucune unité
n'est déclarée livrée. Les mises en œuvre décidées — la table de liaison, `pg_cron`, les fonctions
edge, `change_channel_workflow`, la garde de ports, la transition « Réalisation → Perdu », les
gabarits d'emails, le secret de build — restent **dues**, chacune rattachée à son unité. Le
documentaire décrit désormais ce qui est décidé **et** ce qui est réellement en place, sans
confondre les deux.

---

### Décision 269 — `CRM-009` sert quatre gabarits HTTP et prouve le message reçu, pas le départ SMTP

**Mesure avant spécification.** Le code exact de `supabase/gotrue:v2.189.0` confirme les deux
comportements observés sous INC-016. Son cache charge le corps par `GET` HTTP ; au premier échec,
il installe le gabarit anglais par défaut et continue. Son interface `mailer.Client.Mail` ne reçoit
qu'un `body`, et `mailmeclient` l'envoie avec `SetBody("text/html", body)` : aucun gabarit séparé
`text/plain` n'existe dans cette version. Un email présent et le texte reconstruit par Inbucket ne
prouvent donc ni le gabarit configuré, ni un multipart d'origine.

**Architecture retenue pour appliquer la décision 264.** Un service `auth-templates`, fondé sur
l'image `caddy:2.9-alpine` déjà épinglée, vit dans le Compose commun. Il monte quatre HTML versionnés
en lecture seule, n'expose aucun port hôte et répond seulement sur le réseau interne. Son contrôle
de santé lit réellement `invite.html`, et GoTrue dépend de cette santé. Cette place commune évite
de dépendre du serveur Vite propre au développement ou du Caddy périphérique propre à la
production.

**Contrat des messages.** Invitation, confirmation, réinitialisation et changement d'adresse ont
chacun un sujet français stable, une phrase propre, le nom P2Enjoy CRM, une action textuelle vers
`{{ .ConfirmationURL }}` et le code `{{ .Token }}`. Le HTML est autonome, sans image, et reprend
les couleurs et la typographie de `docs/DESIGN_SYSTEM.md`. La limite HTML seul est documentée ; la
contourner exigerait de remplacer ou d'interposer le client SMTP et ne se cache pas dans un faux
multipart écrit à l'intérieur du corps.

**Preuve non complaisante.** `scripts/verify-auth.sh` vérifiera les quatre réglages d'URL et de
sujet appliqués au conteneur. Pour l'invitation puis la réinitialisation, il relira le message
réellement reçu par SMTP et exigera le sujet français, le marqueur propre au gabarit, le produit,
le code à six chiffres et le lien du bon type avant de suivre ce lien. Le gabarit anglais de repli
échoue donc alors même que le message est présent.

**Portée.** `CRM-009` porte aussi la correction de traçabilité de l'écran et de la session déjà
livrés. `CRM-011` demeure le mécanisme GoTrue et ses preuves API hors interface. INC-016 ne sera
close et `CRM-009` ne passera `[x]` qu'après exécution de toutes ces preuves et du parcours
Playwright au clavier contre la pile réelle.

---

### Décision 270 — Une console propre inclut la ressource que le navigateur demande de lui-même

**Défaut observé, pas supposé.** Le premier rejeu de `CRM-009` sous le Chromium 151 réellement
installé fait échouer ses sept scénarios avant toute assertion métier : chaque page écrit
`Failed to load resource: 404`. La trace Playwright donne l'URL exacte,
`http://127.0.0.1:4173/favicon.ico`. Le point d'entrée ne déclare aucun favicon ; ce Chromium
demande donc le chemin historique de lui-même. L'ancien binaire employé par la preuve 142/142 ne
le demandait pas, ce qui explique que le défaut ait survécu sans rendre la garde complaisante.

**Décision.** `webapp/index.html` référence un `public/favicon.svg` versionné. C'est un monogramme
`P2` géométrique réduit à ce qui reste lisible à 16 px : carré arrondi bleu `brand`, lettre blanche,
chiffre jaune `accent`. Aucun nouveau jeton, aucune police ni ressource distante. Le SVG porte son
titre accessible et une trace `CRM-007` / `docs/DESIGN_SYSTEM.md` §9.

**Pourquoi pas une tolérance.** Ajouter `404` à la liste des erreurs autorisées cacherait aussi
une route ou un chunk réellement absent. Le défaut est une ressource manquante, donc la correction
est de servir la ressource. `CRM-007` repasse `[~]` jusqu'au build et au rejeu console strict ; il
ne retrouvera `[x]` qu'après preuve.

---

### Décision 271 — La preuve d'email va de la boîte rendue au lien activé par le destinataire

**Écart trouvé pendant la relecture de la DoD.** Le harnais GoTrue relit bien le message reçu par
SMTP, vérifie désormais son contenu et suit son lien par HTTP. Cela prouve le serveur, mais la
consigne de reprise exige aussi que les actions livrées soient praticables par un utilisateur au
clavier et à la souris. Une URL extraite par `grep` ne constate ni le rendu du message dans un
client, ni l'action réellement offerte au destinataire.

**Preuve ajoutée à `CRM-009`.** L'API d'administration crée une invitation jetable — opération de
préparation, puisque l'invitation depuis le produit reste ouverte en INC-015. Chromium ouvre
ensuite la vraie boîte Inbucket, sélectionne le message, constate dans son corps rendu le sujet,
la phrase, le nom P2Enjoy CRM et le code français, puis active le lien d'invitation à la souris.
La navigation GoTrue doit confirmer l'adresse et ouvrir une session. Le compte et sa boîte sont
supprimés en sortie.

**Frontière.** Inbucket est un client de développement, pas le produit. Il ne remplace donc ni la
preuve SMTP/API de `scripts/verify-auth.sh`, ni un futur écran d'invitation. Il ajoute la seule
perspective absente : celle du destinataire qui reçoit, lit et active réellement le message.

---

### Décision 272 — La pile de développement refuse une origine webapp qui rend les emails inutilisables

**Défaut observé par le destinataire réel.** Le parcours Chromium de la décision 271 reçoit et
ouvre correctement l'invitation française dans Inbucket, puis active son bouton. GoTrue vérifie le
jeton et redirige vers `SITE_URL=http://localhost:5173` ; Chromium aboutit à
`chrome-error://chromewebdata/`, car la webapp de cette pile est réellement publiée sur le port
`5273`. Les conteneurs sont tous sains et le port Vite répond : c'est le contrat croisé de
configuration qui est faux, pas le service.

**Cause.** `.env.example` disait déjà que `WEBAPP_DEV_PORT` doit correspondre au port de
`SITE_URL`, mais `runDev.sh` ne vérifiait pas cette phrase. Modifier seulement le port publié est
donc accepté, alors que chaque lien d'invitation, confirmation, récupération ou changement
d'adresse devient inutilisable. Une documentation sans garde n'est pas une propriété du produit.

**Décision rattachée à `CRM-002`.** Après la validation générale et les gardes du profil de
développement, mais avant toute interrogation ou mutation Docker, `runDev.sh` exige :

- `SITE_URL` exactement égal à `http://<DEV_BIND_ADDRESS>:<WEBAPP_DEV_PORT>` ;
- cette même origine présente comme entrée entière de la liste séparée par des virgules
  `ADDITIONAL_REDIRECT_URLS`.

Le refus nomme les variables, l'origine attendue et le fichier local à corriger. Cette règle ne
s'applique ni à `runProd.sh`, dont l'origine est le domaine public, ni à un autre environnement.
Elle vaut aussi avec `--dev` : écarter le conteneur Vite ne change pas le port sur lequel
l'utilisateur doit lancer Vite dans son IDE.

**Preuve non complaisante.** Le harnais de `CRM-002` exerce directement la garde avec une origine
cohérente, puis une copie où `SITE_URL` porte un autre port, puis une copie où l'origine manque de
`ADDITIONAL_REDIRECT_URLS`. Les deux copies doivent être refusées avec un diagnostic précis. La
preuve fonctionnelle reste celle de `CRM-009` : le destinataire clique réellement le lien et voit
la session authentifiée dans la webapp, sans erreur ni avertissement de console.

---

### Décision 273 — La webapp consomme le fragment GoTrue au lieu d'abandonner le destinataire anonyme

**Défaut observé après la correction d'origine.** Le destinataire arrive désormais sur la bonne
webapp. Elle rend pourtant « Se connecter » et les états anonymes. La trace montre que GoTrue a
bien confirmé l'invitation et redirigé avec la session dans le fragment, conformément à
`docs/SPEC-auth.md` §3.3. Le client applicatif est explicitement construit avec
`detectSessionInUrl: false` : il ignore donc ces jetons et restaure seulement un stockage vide.

**Mesure sur la version réellement installée.** `@supabase/auth-js`, dépendance de
`@supabase/supabase-js` 2.112.0, reconnaît un retour implicite lorsqu'il trouve les paramètres de
session. Avec `detectSessionInUrl` actif, il exige jetons d'accès et de rafraîchissement, durée et
type, appelle `/user` pour valider le porteur, efface `window.location.hash`, puis transmet la
session au stockage configuré. Il ne déplace donc rien vers `localStorage` : la décision 254 reste
entière, puisque le stockage injecté demeure `sessionStorage` avec repli mémoire.

**Décision rattachée à `CRM-009`.** Activer `detectSessionInUrl`. Le produit n'emploie aucun autre
fournisseur OAuth susceptible de déposer un `access_token` concurrent dans ce fragment ; le
comportement par défaut de la bibliothèque est donc le contrat le plus étroit qui couvre les
quatre emails GoTrue déjà spécifiés. Une logique de parsing applicative du fragment dupliquerait
les validations et l'effacement que la dépendance épinglée exécute déjà.

**Preuve utilisateur et sécurité.** Après le clic réel dans Inbucket, Chromium doit voir la
déconnexion, l'adresse du destinataire et la session stockée sous la clé Supabase de
`sessionStorage`. `localStorage` reste vide et l'URL ne contient plus ni `access_token`, ni
`refresh_token`. Le compte est supprimé après la preuve. La console stricte reste sans erreur ni
avertissement : un retour accepté mais partiellement initialisé n'est pas un succès.

---

### Décision 274 — Un lien présent mais blanc sur blanc n'est pas une action email livrée

**Défaut trouvé par la capture, après un scénario pourtant vert.** Chromium trouvait l'ancre
« Accepter l'invitation », la déclarait visible et pouvait cliquer dessus. La capture observée ne
montrait qu'un grand espace vide entre l'introduction et le code. La mesure CSS a confirmé le faux
positif : Inbucket retire tout l'attribut `style` de la balise `<a>` dans sa vue « Safe HTML » ; son
fond calculé devient transparent, tandis que le texte blanc du gabarit se confond avec la carte.

**Décision de rendu robuste.** Les quatre gabarits utilisent le patron classique des emails : une
petite table de présentation, une cellule portant le fond `#23468C`, le rayon et le remplissage,
puis un lien contenant un élément textuel intérieur blanc et gras. Si le client retire encore le
style de l'ancre, le contraste est porté par les deux niveaux qu'il conserve déjà sur les autres
éléments du message. Sans CSS, le libellé explicite du lien reste compréhensible.

**Preuve renforcée.** Le parcours destinataire exige dans le style calculé un fond bleu et un texte
blanc, positionne réellement la souris sur l'action, capture la fenêtre assez haute pour montrer
action et code, puis clique. Les assertions de contraste rendent impossible le précédent vert
sémantique sur un bouton visuellement absent. Le même patron est appliqué aux quatre emails pour
éviter quatre variantes d'un défaut identique.

---

### Décision 275 — Retirer le groupe JWT ignoré sans maquiller l'avertissement amont restant

**Inspection après les preuves.** Les journaux récents des trois composants touchés ne portent
aucune erreur. GoTrue écrit toutefois deux lignes de niveau `warning` au démarrage : groupe JWT
administrateur et groupe JWT par défaut « non pris en charge » et bientôt supprimés. Le Compose
injecte seulement `GOTRUE_JWT_DEFAULT_GROUP_NAME=authenticated` ; la première ligne apparaît alors
que `GOTRUE_JWT_ADMIN_GROUP_NAME` est absente de l'environnement du conteneur.

**Mesure du code exact 2.189.0.** La documentation officielle classe l'information de groupe JWT
parmi les fonctions Netlify héritées que Supabase ne prend pas en charge. Dans
`internal/conf/configuration.go`, `ApplyDefaults()` remplace pourtant tout `AdminGroupName` vide par
`admin`. Dans `internal/api/api.go`, le démarrage avertit ensuite dès que ce champ est non vide.
L'avertissement administrateur est donc inconditionnel dans cette version : ni absence ni chaîne
vide ne peuvent le supprimer.

**Décision.** Retirer `GOTRUE_JWT_DEFAULT_GROUP_NAME`, seule variable obsolète que le produit
injecte. Conserver `GOTRUE_JWT_ADMIN_ROLES=service_role`, configuration distincte et réellement
employée par l'API d'administration. Le harnais constate l'absence du groupe par défaut dans le
conteneur et ses preuves existantes continuent d'exiger `role=authenticated`, l'invitation par la
clé de service et le refus de la clé anonyme.

**Pas de faux silence.** Abaisser `LOG_LEVEL` à `error`, filtrer la sortie ou construire une image
forkée uniquement pour retirer la ligne masquerait aussi de futures alertes utiles. L'unique
avertissement administrateur amont est documenté comme limite de GoTrue 2.189.0. Il ne vient pas de
la console navigateur : celle-ci reste contrôlée séparément et strictement vide sur les 144
scénarios UI.

---

### Décision 276 — La contre-preuve renverse la décision 275 : le groupe « ignoré » porte encore `role`

**Expérience destructive bornée, puis restauration immédiate.** Après retrait de
`GOTRUE_JWT_DEFAULT_GROUP_NAME`, GoTrue redémarre sain et les cycles invitation, mot de passe,
connexion et rafraîchissement continuent apparemment de fonctionner. Le harnais refuse pourtant le
résultat : le JWT réel contient `aud=authenticated` mais `role=""`, puis PostgREST répond `401`
avec `role "" does not exist`. Deux contrôles tombent sur 62. La variable a été restaurée et
GoTrue recréé avant de poursuivre.

**Conclusion mesurée.** Dans 2.189.0, « non pris en charge » ne signifie pas « sans effet ».
`JWT_DEFAULT_GROUP_NAME` est encore copié dans le claim `role` dont PostgREST dépend. La
documentation amont et l'avertissement de dépréciation annoncent une suppression future ; ils ne
permettent pas de supprimer aujourd'hui le seul réglage qui produit le rôle PostgreSQL attendu.

**Décision corrigée.** La décision 275 est renversée sur ce point : conserver explicitement
`GOTRUE_JWT_DEFAULT_GROUP_NAME=authenticated`. Le harnais vérifie désormais sa valeur dans le
conteneur avant d'exiger le claim puis l'accès PostgREST. Une migration vers le mécanisme qui le
remplacera appartient à une future montée de version de GoTrue, après mesure de cette version — pas
à une suppression anticipée.

**Avertissements.** Les deux lignes de démarrage restent donc inévitables avec le comportement
fonctionnel exigé : l'une vient du défaut `AdminGroupName=admin`, l'autre d'une variable à la fois
dépréciée et encore nécessaire. Elles sont des journaux serveur amont, pas la console du navigateur.
Abaisser ou filtrer le niveau de log resterait un faux vert et n'est pas retenu.

**Résultat final de `CRM-009`.** Après restauration du groupe requis, `verify-auth.sh` rend
**62/62** et PostgREST accepte le jeton réel. `verify-scripts.sh` rend **61/61**, la pile exhaustive
**50/50**, `verify-webapp.sh` **42/42**, Vitest **525/525**, les quatre compilations TypeScript et
le build en quatre chunks sont verts. Les **144/144** parcours Chromium passent avec une console
sans `warning`, `error` ni `pageerror`; le sous-ensemble d'authentification rend **8/8**. La capture
observée `docs/captures/CRM-009/invitation-francaise-destinataire.jpg` montre le sujet français,
l'action bleue à texte blanc et le code. Le clic ouvre la vraie session GoTrue, nettoie l'URL,
laisse `localStorage` vide et place le jeton uniquement dans `sessionStorage`.

---

### Décision 277 — Chaque harnais naît avec son sujet : `CRM-008` est bornée aux commandes exécutables (arbitrage du responsable, INC-023)

**Question posée.** La Definition of Done historique de `CRM-008` exigeait toutes les commandes du
`README.md` §7, dont `pytest mail-sync/tests`, alors que le service Python n'existe qu'à partir de
`CRM-051`. Trois options étaient documentées par INC-023 : scinder l'unité, restreindre sa DoD aux
sujets existants, ou la laisser ouverte à travers deux chunks.

**Décision explicite du responsable le 2026-08-07 : option 2.** `CRM-008` porte les commandes dont
le sujet existe au moment où le harnais est livré. `pytest mail-sync/tests` appartient à
`CRM-051`, dont la DoD exige déjà les tests unitaires Python ; créer un projet vide ou un squelette
sans fonction métier resterait un faux vert interdit.

**Application au projet `mail`.** `npm run e2e:mail` est désormais réel depuis `CRM-050` : ses
seize scénarios exercent Stalwart, IMAP, SMTP, ClamAV et Roundcube. L'aller-retour du **produit**
reste distinct et dû par `CRM-054` puis `CRM-058`. La décision ne déplace aucune preuve existante :
elle supprime seulement le double comptage qui rendait `CRM-008` impossible à fermer.

**Condition de fermeture.** L'arbitrage ne vaut pas preuve. `CRM-008` reste `[~]` jusqu'au rejeu,
sur une base de développement froide, de toutes les commandes désormais dans son périmètre et de
ses dégradations volontaires. INC-023, contradiction de périmètre, est close par cette décision ;
l'unité ne passera `[x]` qu'après mesure.

---

### Décision 278 — Le harnais prouve d'abord sa chaîne Node, avant de prendre un échec pour une preuve

**Défaut reproduit sur le parcours utilisateur.** Après la remise à zéro froide autorisée, la
commande documentée `scripts/verify-harness.sh`, lancée telle quelle depuis le shell WSL du
responsable, a choisi `/mnt/c/Program Files/nodejs/npm`. Aucun exécutable `node` Linux n'était
alors exposé par le `PATH`, bien que la version demandée par `.nvmrc` soit installée sous NVM.
`cmd.exe` a refusé le chemin UNC du dépôt ; les commandes positives sont devenues rouges, mais les
dégradations volontaires ont affiché des `OK` puisqu'elles ne vérifiaient que l'échec de `npm`.
Verdict final : **26 contrôles, 10 anomalies**. La restauration des fichiers et de la politique
RLS a néanmoins été constatée.

**Cause.** Le harnais vérifiait la base et le seed avant toute mutation, mais pas l'outil commun à
toutes ses familles de tests. Un échec d'infrastructure pouvait donc satisfaire à tort la moitié
« le test faux échoue » de sa DoD. Le prérequis `Node 24 / npm 11` du README ne suffit pas à
identifier un binaire Windows hérité dans WSL, ni à activer la version déjà installée par NVM.

**Décision.** Avant de créer un fichier temporaire ou de dégrader la base, le harnais doit :

1. lire la version majeure attendue depuis `.nvmrc` ;
2. accepter un couple `node` / `npm` Linux déjà présent seulement si leurs versions conviennent ;
3. sinon, chercher une version installée compatible dans `NVM_DIR`, puis dans l'emplacement NVM
   usuel du compte, et préfixer son seul sous-processus au `PATH` ;
4. refuser explicitement un outil sous `/mnt/<lecteur>/`, une version incompatible ou l'absence
   d'outil, avec une action lisible (`nvm use`) ;
5. afficher le couple et le chemin effectivement retenus avant les preuves.

Le shell parent n'est jamais modifié. Les commandes `npm run …` exécutées directement restent
précédées de `nvm use` dans la documentation d'un poste géré par NVM.

**Preuve exigée avant fermeture.** Une preuve isolée doit refuser un chemin Windows littéral puis
exercer un couple déjà conforme, des versions Node/npm incompatibles avec un arbre NVM jetable et
l'absence complète d'outil. Le rejeu depuis le shell WSL réel doit, lui, partir du `npm.exe`
effectivement hérité et sélectionner le couple Linux compatible. Le harnais froid complet ne sera
rejoué qu'après ces preuves ; ses dégradations ne pourront donc plus être vertes sur une panne
commune de Node.

---

### Décision 279 — Le harnais compte aussi les suites SQL, pas seulement leurs assertions

**Défaut observé pendant le rejeu corrigé.** `npm run test:sql` a réellement exécuté **19
fichiers** et **1405 assertions**. `scripts/verify-harness.sh` a bien vérifié le second nombre,
mais a ensuite affiché « 3 fichiers » en dur, valeur historique de la création de `CRM-008`.
L'exécuteur SQL donne pourtant déjà son résumé structuré
`19 fichiers, 1405 assertions, aucune anomalie`.

**Risque.** Une suite entière pourrait disparaître si ses assertions étaient compensées ailleurs :
le total seul resterait conforme. Surtout, le message vert du harnais décrit aujourd'hui une
exécution impossible. Cette vérification est distincte du compteur d'assertions et obéit à la même
règle : une valeur attendue est figée puis révisée consciemment par l'unité qui ajoute une suite.

**Décision.** `CRM-008` fixe désormais deux compteurs SQL : **19 fichiers** et **1405 assertions**.
Le harnais extrait les deux valeurs du résumé réel de `run-sql-tests.sh`, refuse l'absence ou la
duplication du résumé, puis compare chaque nombre à son attendu. Le texte vert reprend les valeurs
mesurées, jamais une constante narrative. La régression est prouvée par l'exécution froide complète
qui doit afficher `19 fichiers, 1405 assertions` avant les projets Playwright.

**Résultat de fermeture de `CRM-008`.** La pile a été reconstruite par `./resetMe.sh --yes`, sans
réutiliser la base précédente. La transition « Démarrer la réalisation » porte un champ requis
dans le workflow global et un dans sa copie de track : le défaut historique du seed ne pollue pas
ce verdict froid. Depuis le même shell WSL qui choisissait `npm.exe`, le résolveur retient Node
`v24.14.1` / npm `11.11.0` Linux ; sa preuve isolée rend 4/4.

Le rejeu complet affiche ensuite **19 fichiers / 1405 assertions**, **410 scénarios API**, **144
parcours UI Chromium** avec la fixture qui interdit `warning`, `error` et `pageerror`, **16
scénarios mail**, **525 tests Vitest**, quatre compilations TypeScript et le rapport HTML réellement
servi en HTTP 200. Les six dégradations échouent pour leur cause propre, la politique RLS et les
fichiers temporaires disparaissent, puis SQL et API redeviennent verts. Verdict : **28 contrôles,
aucune anomalie**. Les captures réécrites mécaniquement par Playwright ont été remises à leur
version de référence puisque l'interface n'a pas changé. `CRM-008` passe `[x]`.

---

### Décision 280 — Contrat exécutable de `CRM-015` : un CA facultatif, validé avant Docker et absent de l'image

**Point de départ mesuré.** Le `Dockerfile` sait déjà monter un secret BuildKit facultatif
`npm_ca`, l'utiliser comme `cafile` pendant `npm ci`, puis supprimer le réglage. Deux constructions
sans cache ont été exécutées avec un overlay Compose jetable : l'une avec
`/etc/ssl/certs/ca-certificates.crt`, l'autre avec `/dev/null`. Les deux réussissent ; dans l'image,
`/run/secrets/npm_ca` est absent, `npm config get cafile` rend `null` et aucun `.npmrc` non vide ne
subsiste. Compose v5.1.4 accepte le fichier vide comme source du secret. Ce que le dépôt ne sait
pas faire est transporter ce choix depuis `./runDev.sh`.

**Nom et format.** La variable retenue est `NPM_CA_FILE`. Elle est facultative, vide par défaut,
et ne contient jamais le certificat : seulement le **chemin absolu** d'un fichier local régulier,
lisible, non vide et au format PEM. Une valeur exportée par le shell prend la priorité réelle de
Compose sur celle de `.env`; la garde de lancement doit valider cette même valeur effective.

**Assemblage inerte sans proxy.** `docker-compose.dev.yml` déclare le secret de build `npm_ca` et
sa source `${NPM_CA_FILE:-/dev/null}`. Absente, vide, ou omise d'un ancien `.env`, la variable
donne donc un secret vide ; le test `-s /run/secrets/npm_ca` du `Dockerfile` laisse `npm ci`
strictement inchangé. Une valeur non vide active le `cafile` pour cette seule instruction de
build. Un marqueur de build explicite distingue les deux branches sans imprimer le chemin ni le
contenu du certificat.

**Compatibilité du contrat d'environnement.** `env_validate` traitait jusqu'ici toute variable
du gabarit comme obligatoire à la présence, y compris celles dont l'exemple vide signifie
« facultative ». `CRM-015` aligne le code sur la convention écrite en tête de `.env.example` :
une variable à exemple non vide doit toujours être présente et renseignée ; une variable à
exemple vide peut être absente d'un ancien `.env`. C'est indispensable pour que l'ajout facultatif
ne casse pas tous les postes existants.

**Refus avant effet.** Une valeur relative, absente du disque, non régulière, illisible, vide ou
sans bloc `BEGIN CERTIFICATE` est refusée par `runDev.sh --bootstrap`, donc avant toute requête au
démon Docker. Le message nomme `NPM_CA_FILE` et la propriété attendue sans afficher le contenu.

**Preuves exigées.** `scripts/verify-scripts.sh` doit éprouver l'ancien `.env` sans variable, la
priorité du shell, chaque refus ci-dessus, l'interpolation `/dev/null` et le chemin explicite. Il
construit ensuite sans cache les deux branches, exige leurs marqueurs respectifs, inspecte l'image
pour l'absence du secret et du `cafile`, puis `./runDev.sh` doit rendre la webapp saine dans les
deux configurations. Aucun certificat n'est créé ni versionné : la branche active emploie le
paquet d'autorités déjà fourni par l'hôte.

**Production.** `NPM_CA_FILE` ne rejoint pas `docker-compose.prod.yml` : la webapp de production
est un répertoire statique construit sur l'hôte, pas cette image Vite de développement. Le contrat
de déploiement doit donc dire explicitement « aucune variable ni opération de production » au lieu
de laisser l'absence être interprétée comme un oubli.

**Résultat de livraison.** `scripts/verify-scripts.sh` rend 80/80 : ancien `.env`, priorité du
shell, six refus avant Docker, surcharge vide, refus avant destruction, interpolation Compose,
deux builds sans cache et inspection de l'image. `./runDev.sh` aboutit sans variable puis avec
`/etc/ssl/certs/ca-certificates.crt`; les 19 conteneurs sont sains et `verify-stack.sh` rend
50/50. La chaîne frontend réparée pendant ce parcours rend `verify-webapp.sh` 42/42 puis le
harnais global 28/28, dont 144/144 UI sans avertissement. Aucun certificat n'est versionné et
`docs/PROD_MIGRATIONS.md` confirme qu'il n'existe aucune action de production. `CRM-015` et
INC-042 sont closes.

---

### Décision 281 — Un résolveur commun que vingt et une commandes contournent n'est pas encore commun

**Défaut rencontré dans le parcours réel de `CRM-015`.** Les deux variantes de `./runDev.sh`
aboutissent et la pile rend 50/50. La commande suivante documentée,
`scripts/verify-webapp.sh`, part toutefois avec le `npm.exe` hérité par WSL : `cmd.exe` refuse le
répertoire UNC et le build échoue avant toute preuve de la webapp. La chaîne Linux livrée par la
décision 278 existe et fonctionne, mais seul le harnais global de `CRM-008` la charge.

**Mesure du périmètre.** Vingt-deux scripts autonomes `scripts/verify-*.sh` contiennent une invocation
effective de `npm` ou `node`; vingt et un n'appellent pas `node_toolchain_prepare`. Ils peuvent donc
échouer pour l'outil du poste, voire prendre cette panne commune pour la réussite d'une
contre-épreuve. Le défaut dépasse `verify-webapp.sh` et le corriger seul laisserait vingt faux
points d'entrée verts dans le registre des commandes disponibles.

**Décision.** Chacun de ces harnais charge `scripts/lib/node.sh` et prépare le couple imposé par
`.nvmrc` avant sa première mutation. Le résolveur reste local au processus, refuse Windows et les
versions incompatibles, et ne change pas le shell du responsable. Sa preuve isolée acquiert un
cinquième contrôle : elle analyse toutes les invocations Node/npm des harnais et exige que chaque
fichier soit protégé. Le nombre de fichiers n'est pas figé ; la propriété l'est.

**Preuve de fermeture attendue.** Partir volontairement du `PATH` WSL qui expose `npm.exe`, lancer
la preuve isolée puis `scripts/verify-webapp.sh` sans `nvm use` manuel. Le premier doit sélectionner
Node 24/npm 11 Linux et le second rendre toutes ses vérifications, y compris Chromium et sa console
stricte. Ce complément rouvre une seule case de `CRM-008` et devient un prérequis de fermeture du
parcours utilisateur de `CRM-015`.

**Résultat.** Les vingt et un scripts manquants chargent la bibliothèque avant leur première
mutation. La preuve statique recense 22 harnais Node/npm, tous protégés, et rend 5/5. Depuis le
`PATH` WSL qui sélectionnait `npm.exe`, `verify-webapp.sh` choisit Node v24.14.1 / npm 11.11.0
Linux, passe build, types, 525 tests et 144 parcours Chromium, puis rend 42/42.

---

### Décision 282 — Une publication est finie au signal de succès, et une console propre commence avant le navigateur

**Échec global.** Le rejeu de `scripts/verify-harness.sh` corrigé pour INC-083 passe SQL, API et la
précondition Node, puis rend 143/144 en UI. Le parcours réel de publication de commentaire voit le
corps dans la page mais sa relecture PostgREST immédiate n'obtient pas exactement une ligne. Les
seize scénarios mail, 525 tests unitaires, quatre compilations et six dégradations restent verts ;
le harnais restaure tout et rend 28 contrôles, 1 anomalie.

**Ce que la répétition apprend.** Dix rejeux ciblés passent en 29 secondes, un worker, sans
substitution réseau. L'échec n'est donc ni une règle produit systématiquement cassée ni une donnée
résiduelle : l'attente du scénario est ambiguë. Le texte cherché est aussi le texte saisi ; le
contrat visible de fin est ailleurs. Le composant ne vide le brouillon et n'annonce « Commentaire
publié » qu'après le retour réussi de l'insertion. La relecture indépendante doit partir après ces
deux effets, comme le ferait un utilisateur qui attend la confirmation.

**Deuxième défaut, parfaitement déterministe.** Les dix rejeux écrivent tous l'avertissement Node
selon lequel `NO_COLOR` est ignoré parce que `FORCE_COLOR` est défini, dans le webServer puis les
workers. La fixture interdit déjà tout `warning`, `error` et `pageerror` du navigateur ; elle ne
peut pas nettoyer la console du lanceur, et filtrer le texte serait un faux vert.

**Décision.** Le scénario attend la région live de succès et le champ vidé avant PostgREST. La
configuration Playwright supprime le `NO_COLOR` hérité dans son processus, avant la création du
webServer et des workers que Playwright exécute avec couleur forcée. Ce choix est local au harnais,
ne modifie pas le shell parent et supprime la cause plutôt que sa sortie. La fermeture exige le
rejeu ciblé, la suite 144/144 et le harnais 28/28 sans aucune ligne `Warning:`.

**Résultat.** Le parcours corrigé rend 10/10 sans une ligne d'avertissement. Le rejeu global
constate ensuite 144/144, console navigateur stricte et sortie Playwright sans avertissement, puis
termine les 16 scénarios mail, 525 tests, quatre compilations et six dégradations. Verdict final :
28 contrôles sans anomalie, fichiers et politique RLS restaurés. INC-083 et INC-084 sont closes ;
`CRM-008` revient à `[x]` sur la preuve réellement rejouée.

---

### Décision 283 — Un worker qui répond mais avertit n'est pas sain : `per_request` devient le contrat edge

**Mesure avant spécification.** L'image locale exacte
`public.ecr.aws/supabase/edge-runtime:v1.74.2` porte l'empreinte
`sha256:a82676277615aee03c4f288cbbbf68dedb5ba8693073e567ab8dbfdd11ba5d45`. Un service principal
minimal, sans import distant, a créé un vrai worker `example` par
`EdgeRuntime.userWorkers.create`; `POST /example` a rendu 200 et le JSON attendu. Le runtime est
donc utilisable sans recopier le routeur complexe d'un autre dépôt ni dépendre de `deno.land`.

**Défaut observé dans les journaux.** Avec la politique par défaut `per_worker`, la réponse reste
verte mais le conteneur écrit `wall clock duration warning` puis
`early termination has been triggered`. Ce n'est ni un échec HTTP ni un détail acceptable sous
la règle de console silencieuse : le verdict utilisateur et l'état opérationnel divergent.

**Contre-épreuve.** Le même montage, le même routeur, la même fonction et la politique explicite
`--policy per_request` rendent le même HTTP 200 sans une ligne de journal. Un premier healthcheck
qui joignait directement le worker puis fermait tôt sa socket a produit une autre ligne de durée
murale ; la sonde finale vise donc `GET /__health` dans le service principal, consomme toute la
réponse et ne crée pas d'isolate utilisateur. Elle est silencieuse. La preuve métier reste
distincte et appelle `example` par Kong.

**Décision.** `CRM-016` épingle l'image et `per_request`, sans `--quiet` ni filtre de logs. Le
routeur natif valide le nom de fonction, refuse les répertoires absents avant la création d'un
worker, borne chaque invocation à 128 Mio / 10 s et ne transmet que l'URL interne et les deux clés
Supabase déjà configurées — jamais `JWT_SECRET`. Kong exige `key-auth` et l'ACL `anon`/`admin`,
mais toute fonction future privilégiée doit encore authentifier et autoriser son appelant côté
backend.

**Contrat de preuve.** `example` est publique derrière la clé anonyme et sans effet. Unitaires :
parsing et contrat HTTP purs. API : clés absente et fausse refusées, POST réel à travers
`/functions/v1/example`, méthode refusée, fonction inconnue et CORS. Intégration : image, commande,
montage en lecture seule, absence de port hôte, santé et journaux. Puis remise à zéro froide et
rejeu global, UI comprise, sans warning, error ni pageerror. Le détail stable est persisté dans
`docs/SPEC-edge-functions.md` avant toute ligne applicative.

---

### Décision 284 — Une route bind-mountée n'est pas rechargée : le graphe Compose doit activer CRM-016

**Premier E2E après implémentation.** `./runDev.sh` crée `p2enjoy-functions`, attend sa santé et
la déclare saine. Il laisse toutefois `p2enjoy-kong` en état `Running`, sans le recréer. Les six
scénarios de `functions.spec.ts` joignent réellement `127.0.0.1:8000`, mais reçoivent tous 404 —
y compris les deux appels sans clé qui auraient dû tomber sur `key-auth`. Le runtime n'est jamais
joint et ses journaux restent vides.

**Cause.** `kong.yml` est un bind mount. Compose compare la définition du service, pas le contenu
courant du fichier source ; le processus Kong ne recharge pas spontanément sa configuration
déclarative. Un `up` normal peut donc laisser l'ancienne table de routes en mémoire alors que le
dépôt et le volume montrent déjà la nouvelle.

**Décision.** Kong dépend explicitement de `functions` avec `condition: service_healthy`. C'est la
dépendance réelle de la nouvelle route et non un artifice de redémarrage : elle empêche aussi la
passerelle de devenir disponible avant sa cible. Pour une pile existante, elle change la définition
Compose de Kong et provoque sa recréation au prochain `./runDev.sh`; sur une pile froide, elle fixe
l'ordre. La preuve doit repartir de la commande documentée, jamais d'un `docker restart` manuel,
puis obtenir les 401/200/405/404/CORS attendus.

---

### Décision 285 — `depends_on` ordonne mais ne recrée pas : Kong porte la révision de sa configuration

**Contre-épreuve de la décision 284.** Après ajout de `functions: service_healthy`, un second
`./runDev.sh` attend bien le runtime puis Kong. Compose affiche pourtant encore
`p2enjoy-kong Running`, jamais `Recreate`. Les six appels continueraient donc à recevoir 404. La
dépendance exprime le bon graphe, mais elle ne fait pas partie de la configuration du conteneur que
Compose compare pour décider sa recréation. La prédiction de la décision 284 sur ce second effet
est fausse ; son effet d'ordre reste vrai.

**Décision corrigée.** Le service Kong reçoit un label de révision déclaratif :
`com.p2enjoy.kong-config-revision=crm-016`. Ce label fait partie du conteneur ; son ajout provoque
donc la recréation qu'un bind mount seul ne provoque pas. Toute évolution future de `kong.yml`
incrémente cette valeur dans le même changement. `scripts/verify-stack.sh` fixe la révision
attendue pour empêcher qu'une configuration modifiée soit livrée avec un label historique.

**Preuve exigée.** Rejouer une troisième fois la seule commande utilisateur `./runDev.sh` et voir
Kong recréé, puis les six scénarios edge passer. Aucun `docker restart`, `compose restart` ni
recréation manuelle ne peut constituer la preuve : le défaut porte précisément sur l'application
automatique d'une nouvelle version du dépôt à une pile existante.

---

### Décision 286 — `per_request` avertit encore sous concurrence : `oneshot` ferme réellement l'isolate

**Le harnais refuse un résultat différé.** Les six scénarios edge passent, puis
`scripts/verify-functions.sh` inspecte l'intégralité des journaux du conteneur et tombe : entre
deux paires POST/GET réussies apparaît `wall clock duraiton reached`. La lecture immédiate qui
avait fondé la décision 283 était trop courte. La politique `per_request` améliore le cas isolé,
mais ne garantit pas le silence après plusieurs workers.

**Hypothèse du corps non consommé, éprouvée puis rejetée.** Le POST Playwright transmet un JSON que
la fonction sans effet ne lit pas. Un probe a donc consommé `request.arrayBuffer()` avant de
répondre. Cinq POST concurrents rendent tous 200 ; après 12 secondes — plus que la borne de 10 s —
le runtime écrit encore une terminaison murale. Le flux entrant n'est pas la cause suffisante.

**Comparaison à code constant.** Le même routeur, le même handler consommant le corps, les cinq
mêmes POST et la même fenêtre de 12 secondes sont rejoués avec `--policy oneshot`. Les cinq réponses
sont 200 et les journaux restent strictement vides. `oneshot` correspond au contrat de cette pile :
un worker neuf, borné, pour chaque invocation courte, puis une terminaison attendue et silencieuse.

**Décision corrective.** `oneshot` remplace `per_request` partout dans le contrat, Compose et les
preuves de `CRM-016`. La décision 283 reste la trace de la première mesure mais est dépassée sur
ce choix précis. Aucun `--quiet`, filtre ni tolérance orthographique n'est ajouté : le harnais
continue de refuser `warning`, `error`, `panic`, `early termination` et `wall clock`, y compris la
faute `duraiton` du runtime.

---

### Décision 287 — Une position optimiste n'est pas une preuve d'écriture : attendre l'annonce backend

**Défaut révélé par le parcours utilisateur final de `CRM-016`.** Après une remise en état de la
pile, la suite UI complète rend 143/144. L'administratrice crée une card, l'ouvre au board, choisit
« Relancer » à la souris et voit immédiatement la card dans la colonne cible ; la relecture directe
de PostgREST reçoit pourtant encore l'étape de départ. Quelques instants plus tard, le contexte
d'échec montre la région live « Affaire déplacée vers Relance » et la card au bon endroit.

**Cause mesurée.** La position dans la colonne est volontairement optimiste : elle change avant
que `move_card` ait répondu. Le scénario attendait cette position puis relisait la base, créant une
course entre l'appel RPC et sa propre requête. Le comportement produit était correct ; la preuve
utilisait un signal ambigu. C'est le même défaut de méthode qu'INC-084 avait déjà corrigé pour la
publication d'un commentaire.

**Correction.** Le scénario attend la région live nommée « Annonces du board » et son message de
succès avant la relecture hors interface. Cette annonce n'est posée qu'après la réponse `ok` de
`move_card` ; elle représente donc ce que l'utilisateur sait réellement, pas l'optimisme visuel.
Le contrat existant de `docs/SPEC-test-harness.md` §7.2 suffisait : aucune règle produit ne change.

**Preuves.** Le scénario ciblé passe, puis la base est remise à zéro avec `./resetMe.sh --yes`.
`scripts/verify-functions.sh` rend 13/13, la pile 55/55, et le harnais global **28/28** avec
**416 API**, **144 UI sans avertissement**, **16 mail** et **531 Vitest**. Les six dégradations
échouent pour leur cause propre et leur restauration est constatée.

---

### Décision 288 — Un heartbeat s'amorce vite puis se calme : prouver `pg_cron` sans bruit durable

**Frontière de `CRM-017`.** L'arbitrage 261 place relances, séquences, digest et purge RGPD dans
`pg_cron`, mais leurs tables et règles appartiennent à `CRM-063`, `CRM-069` et au chunk mail. Les
programmer aujourd'hui imposerait des commandes sur des objets absents ou fabriquerait des données
qui prétendent représenter un métier inexistant. La seule première tâche honnête est donc un
heartbeat opérationnel privé, observable et sans donnée personnelle.

**Mesures avant contrat.** L'image expose `pg_cron` 1.6.4 dans `shared_preload_libraries`, avec
`cron.database_name=postgres`, `cron.log_run=on` et les connexions par `localhost`. Une création
transactionnelle puis annulée montre que le schéma `cron` n'accorde pas `USAGE` à `public`, mais
plusieurs fonctions gardent un `EXECUTE` public : la migration révoquera les deux niveaux et
nommera aussi `anon`, `authenticated` et `service_role`. Deux appels de `cron.schedule` portant le
même nom conservent le même `jobid` et mettent à jour cadence et commande — propriété mesurée, non
supposée, sur la base locale.

**Problème de fréquence.** Un heartbeat permanent toutes les cinq secondes rendrait les tests
rapides au prix de 17 280 passages par jour, de WAL et de lignes `cron.job_run_details`. Un heartbeat
horaire serait propre mais une preuve froide pourrait attendre presque une heure.

**Décision.** La migration programme le job nommé à cinq secondes. Le premier passage incrémente
une ligne `UNLOGGED` dans `app.scheduler_heartbeat`, puis ramène **dans la même transaction** le job
à `7 * * * *`. Une promotion qui échoue annule aussi le heartbeat et reste visible comme échec
`pg_cron`. Chaque rejeu de migration réamorce brièvement le même jobid ; l'état stable produit au
plus vingt-quatre passages par jour. Le seed ne touche jamais cet objet.

**Preuve exigée.** pgTAP attend au plus quinze secondes un compteur positif, une date réelle, un
passage `succeeded` et la cadence nominale. Le harnais dégrade commande et cadence, réapplique la
migration, exige le même jobid puis le nouveau passage. SQL global, reset froid et régressions UI
restent dus avant fermeture. Le contrat complet est persisté dans `docs/SPEC-scheduler.md` avant
toute migration.

---

### Décision 289 — Une révocation acceptée peut ne rien révoquer : administrer l'extension sous son propriétaire

**Défaut trouvé par l'élargissement de pgTAP.** La migration exécutait sous `postgres` un
`REVOKE` des droits `PUBLIC` sur les relations et fonctions de `cron`. PostgreSQL rendait `REVOKE`
sans avertissement ni erreur, mais les ACL restaient exactement en place : `cron.job` gardait
`SELECT`, `cron.job_run_details` gardait `SELECT, DELETE`, et cinq fonctions gardaient `EXECUTE`.
Leur donneur et propriétaire est `supabase_admin`; le rôle `postgres` de l'image n'est ni
superutilisateur, ni autorisé à prendre ce rôle. L'absence d'`USAGE` sur le schéma empêchait
l'exploitation immédiate, mais le contrat documenté de fermeture aux deux niveaux était faux.

**Décision.** Une migration peut déclarer `-- @migration-role: supabase_admin`. Le runner conserve
`postgres` par défaut, n'autorise que cet unique rôle privilégié et refuse tout autre marqueur.
`0018_pg_cron.sql` ferme les ACL sous le propriétaire de l'extension, puis exécute
`SET ROLE postgres` avant de créer le heartbeat, sa fonction et le job : le travail applicatif ne
reste pas sous le superutilisateur. La production doit appliquer ce fichier avec la même identité.
Une fixture éprouve le routage des deux rôles et le refus d'un marqueur `root`.

**Deux courses de preuve fermées dans le même passage.** Sur une base chaude, le compteur pouvait
être déjà positif alors qu'un rejeu venait de remettre la cadence à cinq secondes ; pgTAP ne
dormait donc pas et lisait l'état transitoire. Il attend désormais aussi lorsque cette cadence
d'amorçage est visible. Pendant la contre-épreuve, un worker déjà parti pouvait en outre terminer
après la désactivation et réactiver le job. Le harnais désactive maintenant jusqu'à constater à la
fois `active=false` et zéro exécution `running`, puis seulement dégrade commande, base et cadence.

**Preuves chaudes.** La suite ciblée rend **48/48**, SQL complet **20 fichiers / 1453 assertions**,
le véritable `migrations-runner` rejoue les 18 fichiers et nomme `supabase_admin` uniquement pour
la 18 sans warning ni erreur, puis `scripts/verify-scheduler.sh` rend **14/14**. Ce dernier ouvre
réellement `USAGE` et `EXECUTE` à `anon` sous `supabase_admin`, réapplique la migration et exige
leur disparition, le même `jobid`, un nouveau passage réussi et la cadence horaire. La preuve
froide et les régressions complètes restent dues avant la fermeture de `CRM-017`.

---

### Décision 290 — Une copie sans formulaire ne recopie plus une exigence qu'elle ne peut résoudre

**Frontière de `CRM-018`.** La décision 262 impose deux colonnes et deux cascades, et la propagation
de l'arbitrage dans INC-056 tranche explicitement le comportement : la copie cesse de recopier
`require_fields` tel quel. `copy_workflow_to_track` ne copie toujours pas les définitions de
formulaire — INC-037 reste ouvert —, donc recopier leur exigence produirait seulement une liaison
inerte que `move_card` ne peut résoudre. La source garde sa liaison ; la copie n'en reçoit aucune.

**Cohérence supplémentaire, sans troisième colonne.** Deux clés étrangères simples garantissent
l'existence et les cascades, mais autoriseraient un lien vers un autre workflow. Un trigger refuse
donc tout couple dont les parents n'appartiennent pas au même workflow — et, par conséquent, au
même workspace. `workflow_id` reste déductible des deux parents et n'est pas stocké une troisième
fois.

**Mise à niveau sans perte de comportement.** La migration 19 accepte une base ancienne portant
le tableau et une base neuve où les migrations historiques révisées ne le créent plus. Dans le premier cas, elle
résout tous les identifiants avant de supprimer quoi que ce soit ; identifiant mort ou croisement
de workspace arrête la transaction. Un lien valide du même workspace mais d'un autre workflow est
un ancien artefact de copie déjà ignoré par `move_card` : il est recensé puis écarté conformément
à INC-056. Dans le second état, les liaisons existantes sont préservées. Chaque rejeu répare tout
de même contraintes, trigger, politiques et les deux fonctions.

**Conséquence de l'idempotence du dépôt.** Réviser seulement la migration 19 serait faux : le
runner rejoue aussi 0006, 0007 et 0013 à chaque démarrage. 0006 doit cesser de commenter une
colonne supprimée ; 0007 et 0013 doivent cesser de recréer des fonctions qui la lisent. Le seed
ne peut poser la liaison qu'après la création des champs, et synchronise alors les transitions de
la source et de sa copie. Le contrat complet, y compris RLS, preuves et retour arrière, est écrit
dans `docs/SPEC-transition-required-fields.md` avant la première ligne SQL.

---

### Décision 291 — « N'importe quelle table métier » est un inventaire vivant, pas la photographie de CRM-014

**Oubli trouvé pendant la revue de `CRM-018`.** La preuve n° 11 annonçait encore les douze tables
peuplées à `CRM-014`. `card_comments` et `card_events`, arrivées ensuite et réellement alimentées
par le seed, n'avaient jamais rejoint `TABLES_METIER`; la nouvelle
`workflow_transition_required_fields` aurait été la troisième oubliée. Le test pgTAP connaissait
le *compte* des politiques de commentaires et d'événements, mais pas leurs noms, et ne constatait
pas la non-vacuité de leurs tables. Une suppression remplacée par une politique du même nombre
pouvait donc échapper au contrôle nominal.

**Décision corrective.** La formulation « n'importe quelle table métier » porte sur le schéma
seedé **courant**. Chaque nouvelle table métier peuplée rejoint simultanément : l'inventaire API,
la preuve de non-vacuité sous `service_role`, l'inventaire nominal des politiques et le compte
global. La preuve passe ainsi à quinze tables ; `0016_preuves_refus.test.sql` à 52 assertions ;
`preuves-refus.spec.ts` à 40 scénarios ; et `public` à 48 politiques après les trois de CRM-018.
Le harnais corrige aussi deux compteurs déjà consignés par INC-080 : 48 politiques, non 41, et
quatorze cards seedées, non neuf.

**Conséquence sur le harnais global.** CRM-018 ajoute 49 assertions dédiées et cinq scénarios
d'API, tandis que cette fermeture transverse en ajoute six et trois. Les cibles deviennent donc
**21 fichiers / 1508 assertions pgTAP** et **424 scénarios API**. `playwright --list` mesure bien
424 scénarios dans 22 fichiers ; la somme des plans SQL vaut 1508. Les 531 tests Vitest et le
build de production passent sans avertissement.

**Limite actuelle, non transformée en preuve.** Docker Desktop a perdu son intégration dans cette
distribution : le client Linux n'est plus monté, les sockets sont sans serveur et même l'interop
Windows échoue sur `UtilBindVsockAnyPort`. Le proxy Docker retrouvé dans l'image exige le rôle
root que la session n'a pas. Le typecheck rougit donc uniquement sur les assertions du type généré
encore ancien ; celui-ci ne sera ni écrit à la main ni déclaré conforme. Migration, seed, pgTAP,
API réelle, régénération des types et parcours froid restent dus jusqu'au redémarrage de WSL.

---

### Décision 292 — L'autonomie déléguée ferme les questions produit, pas l'obligation de preuve

**Mandat du responsable.** Le responsable demande le 2026-08-08 de trancher tous les points
suspendus à sa place, en prenant le journal comme expression de son style, puis de terminer le
backlog sans nouvelle validation produit. Les décisions récurrentes du journal donnent une ligne
claire : la base porte les invariants, aucune perte n'est silencieuse, un état démonstratif vient
du vrai mécanisme, une autorisation se prouve hors interface, et un compteur vert n'est pas une
preuve s'il peut être complaisant.

**Décision d'exécution.** Les arbitrages ci-dessous sont définitifs pour la version courante. Ils
sont persistés avant leur code et deviennent le contrat des unités concernées. Le travail reste
strictement séquentiel sur `main`, sans branche, worktree, sous-agent ni seconde exécution active.
Une unité n'est jamais fermée sur décision seule : migration froide, seed, tests propres, parcours
utilisateur clavier/souris, inspection visuelle et console sans erreur ni avertissement restent
dus. Seule une autorité externe réellement indispensable — accès de production, secret, ou
réparation de l'hôte — peut encore demander une intervention humaine.

**Ordre retenu.** Finir `CRM-018`, livrer `CRM-019`, fermer les défauts transverses qui rendent
les preuves trompeuses, puis reprendre chaque `[~]` et chaque `[ ]` dans l'ordre du backlog. Les
défauts qui empêchent un utilisateur autorisé d'agir passent avant une extension de confort.

---

### Décision 293 — Une copie de workflow est une copie utilisable, avec formulaire complet et empreinte de composition

**Arbitrage d'INC-037 et INC-038.** La frontière provisoire de la décision 290 est remplacée :
`copy_workflow_to_track` copie dans la même transaction les étapes, transitions, définitions de
champs, règles conditionnelles et champs exigés par transition. Tous les identifiants sont
remappés vers les nouveaux parents. Une copie sans formulaire était techniquement cohérente mais
fonctionnellement fausse : l'utilisateur obtenait un workflow dont les transitions et formulaires
ne pouvaient plus exprimer le comportement de la source.

**Divergence exacte.** La copie conserve une empreinte SHA-256 canonique de la composition source
au moment de sa création. Elle couvre les attributs métier des nœuds, étapes, transitions, champs,
règles et exigences, triés par leurs identifiants stables ; elle exclut les horodatages et
l'identité de la copie. La vue de divergence recalcule la même empreinte. Une modification, un
ajout **ou une suppression** dans la source devient donc visible. La date reste informative, mais
n'est plus utilisée comme substitut à une comparaison de composition.

**Convergence et preuve.** Un rejeu ramène la fonction, l'empreinte et la vue à leur définition
finale. Le seed exige le même formulaire fonctionnel dans la source et sa copie, sans identifiant
partagé entre elles. pgTAP et API prouvent le remappage complet, les cascades, la détection d'une
suppression source et l'atomicité : une règle impossible à remapper fait échouer toute la copie.
Cette décision ferme le choix d'INC-056 sans accepter l'ancien artefact inerte.

---

### Décision 294 — Un droit backend doit conduire à un parcours, et l'identité ne doit pas rendre les données indestructibles

**Identité (`INC-014`).** Une nouvelle unité `CRM-022` porte le socle RLS qui manque : un profil
lit et modifie ses données non privilégiées, les membres d'un même workspace peuvent lire les
identités nécessaires à l'interface, un membre lit son workspace et ses memberships, et seul un
administrateur gère les memberships. Retirer ou rétrograder le dernier administrateur est refusé
en base. `CRM-070` conserve l'interface d'administration et l'invitation ; une invitation crée un
enregistrement en attente et le membership seulement lors de son acceptation, via une fonction
edge qui garde la clé de service hors du navigateur.

**Droits fins (`INC-011`, INC-045, INC-075).** Les tables de jonction de permissions restent sans
`workspace_id` : leur parent est la source unique du workspace, et les politiques le dérivent par
jointure. Un sujet et les administrateurs voient les droits fins ; les autres membres ne voient
que leur effet. Un track est lisible s'il est accordé directement **ou si au moins un de ses
channels est lisible**. La navigation affiche alors le parent comme contexte et uniquement les
enfants autorisés. Aucun channel accordé par le backend ne reste inaccessible dans le produit.

**Commentaires (`INC-071`, INC-072, INC-076).** Commenter exige l'écriture sur le channel. Un
auteur peut modifier ou retirer logiquement son propre commentaire. Un administrateur peut le
retirer, jamais réécrire son contenu ; une raison de modération obligatoire et un événement
immuable enregistrent le geste. `card_comments.author_id` devient nullable avec `ON DELETE SET
NULL` : supprimer un compte conserve la conversation et affiche « Compte supprimé ». La même
doctrine vaut pour toute trace historique : conserver le fait, détacher l'identité supprimée.

**Contrats voisins.** Le test de `move_card` qui prétendait viser un administrateur vise le viewer
qu'il met réellement en défaut (INC-051). La valeur `NULL` d'un champ reste un vide explicite
valide (INC-054). La preuve de privilège de colonne appartient canoniquement à `CRM-013` ; les
autres unités peuvent garder une contre-preuve de dépendance sans revendiquer sa propriété
(INC-049).

---

### Décision 295 — Les invariants relationnels et les gestes pluriels sont atomiques et explicites

**Colonnes remplies par trigger (`INC-027`).** Toute position omissible par contrat reçoit un
`DEFAULT NULL` en plus du trigger `BEFORE` qui remplace `NULL` avant la contrainte `NOT NULL`. Le
type généré décrit ainsi l'API réelle ; aucun cast client ni type généré retouché à la main.

**Convergence (`INC-035`, INC-039, INC-040, INC-041, INC-074).** La migration la plus récente qui
touche un objet en possède la définition finale complète ; elle ne se contente pas de « créer si
absent ». Les clés qui doivent interdire une suppression directe tout en autorisant la cascade
d'un workspace deviennent différables lorsque l'ordre interne de cascade l'exige. Chaque
invariant croisant deux parents possède une garde symétrique sur chaque écriture possible. Le seed
réconcilie ses objets par identifiants stables, retire ses propres divergences et ne duplique
jamais une copie déplacée.

**Changement de workflow (`INC-046`, INC-073).** `move_card_to_channel` reste le geste unitaire.
`change_channel_workflow` est le geste pluriel : le mapping couvre explicitement chaque étape
source occupée, chaque cible appartient au nouveau workflow, et l'ensemble channel + cards est
modifié dans une transaction. Une absence, un doublon ou une cible étrangère refuse tout le lot.

**Commentaire de transition (`INC-048`, INC-052).** Le texte fourni à `move_card` est normalisé
selon l'ensemble Unicode `White_Space`; un texte uniquement blanc est vide. Lorsqu'il existe, la
fonction crée un vrai `card_comment` dans la transaction et l'événement `moved` référence son
`comment_id`, sans dupliquer le contenu libre dans les métadonnées.

**Références de champs (`INC-053`).** Une valeur `user` doit désigner un membre actif du workspace
dès maintenant. Une valeur `contact` est refusée tant que `CRM-060` n'a pas livré la table ; cette
unité remplacera le refus par une clé vers un contact du même workspace. Accepter un UUID opaque
temporaire créerait une dette de données impossible à distinguer d'une référence valide.

**Montants (`INC-067`).** `cards.amount` est un nombre fini à toutes les frontières. Les clients
convertissent explicitement la représentation PostgREST, refusent `NaN` et l'infini, puis
calculent avec un type numérique unique. Une preuve API réelle fixe la représentation reçue ; le
board, la liste et l'analytique partagent le même parseur.

---

### Décision 296 — Un harnais restitue l'état d'entrée et une preuve globale ne repose pas sur le hasard d'exécution

**Règle transverse (`INC-055`, INC-058, INC-060, INC-061, INC-064, INC-074, INC-080).** Tout
harnais destructif prend l'empreinte de son état d'entrée, attend réellement chaque migration,
rejoue jusqu'à la dernière migration pertinente et restitue cette empreinte — jamais `HEAD`, qui
n'est pas l'état de la base. Le ménage vient avant la mesure. Les comptes globaux de tables métier
mutables sont remplacés par des assertions sur les identifiants seedés nommés. Le runner global
réinitialise froidement avant et après le lot ; il orchestre des harnais autonomes, il ne rend pas
correct un harnais qui fuit. Les harnais mutateurs ne s'exécutent jamais en parallèle.

**Propriété et traçabilité (`INC-057`, INC-059, INC-069).** Un `@verifies` ne cite que les
contrats prouvés directement. Les deux anciennes décisions 180 sont référencées `180a` et `180b`
sans réécrire l'histoire. Une seule routine travaille sur le dépôt et elle reste sur `main` avec
l'identité Git du responsable ; aucune branche, aucun worktree et aucun agent parallèle.

**Contrôle statique (`INC-070`, INC-078).** Le détecteur de textes en dur utilise l'AST TypeScript
déjà disponible, pas une expression régulière. Une fixture prouve à la fois qu'il détecte un vrai
texte UI et qu'il ignore la branche structurelle d'un ternaire. Toutes les commandes de preuve
entrent dans les inventaires README/DAT au même changement que leur création.

**Navigateur (`INC-036`).** `PLAYWRIGHT_CHROMIUM_PATH` est le contrat documenté du navigateur
préinstallé. Une preuve de démarrage et de révision échoue explicitement si le binaire n'est plus
compatible ; aucun téléchargement implicite ou succès sans navigateur.

---

### Décision 297 — Le mail accepte l'inconnu sans lui donner de pouvoir, et la pile réelle reste la référence

**Messages sans identifiant (`INC-002`).** Le repli est
`fallback-sha256:<empreinte>` calculé sur l'enveloppe canonique, les en-têtes normalisés et le corps
MIME brut complet. Il ne dépend ni de `SEARCH HEADER Message-ID` — mesuré défaillant avec la
version Stalwart épinglée — ni d'un résumé sujet/taille collisionnable. Le service déduplique après
récupération réelle du message.

**Expéditeurs inconnus (`INC-004`).** Ils sont acceptés, visibles comme « Expéditeur inconnu » et
mis en quarantaine fonctionnelle : aucune transition, autorisation, association automatique ou
commande n'en découle. Limite de taille, quota, analyse des pièces jointes et contenu jamais
exécuté bornent le risque. Refuser ces messages supprimerait précisément les premiers contacts
qu'un CRM de prospection doit recevoir.

**Pile (`INC-006`, INC-082).** La distribution self-hosted Supabase officielle épinglée et
l'assemblage Stalwart actuel de `main` sont canoniques. Les variantes récupérées ne sont pas
réintroduites. Leurs faits mesurés restent obligatoires à prouver sur cette pile : `pipefail` avec
`grep -q`, listener exigeant un redémarrage, port 25 offrant STARTTLS sans AUTH, recherche
`Message-ID` non fiable. Toute référence au starter voisin absent est retirée ou présentée comme
origine historique, jamais comme prérequis.

**Commandes et erreurs (`INC-008`, INC-018, INC-026).** Les scripts de dépôt sont les commandes
opérationnelles canoniques ; aucun alias npm redondant n'est ajouté pour donner l'illusion d'un
second chemin. L'API d'administration GoTrue reste interdite comme parcours produit et la
politique de mot de passe est appliquée au vrai flux utilisateur. Kong ne filtre pas globalement
les diagnostics PostgREST : l'API authentifiée peut conserver ses détails techniques, tandis que
l'interface traduit les erreurs connues en messages sûrs et ne montre jamais le `hint` brut.

---

### Décision 298 — L'interface nomme les faits, garde une adresse canonique et réserve la couleur à un sens mesuré

**Fil et formulaires (`INC-077`, INC-063).** `channel_changed` s'affiche « Dossier changé » dans
la famille « Organisation », distincte du cycle de vente. `role="alert"` appartient uniquement à
l'erreur de validation ; l'indication permanente d'un champ requis est un texte descriptif relié
au champ, pas une alerte répétée.

**Adresse canonique (`INC-065`).** Une route de card incohérente redirige vers son track/channel
réels uniquement après avoir autorisé à la fois la card et le contexte canonique. Sinon elle rend
le même état introuvable que tout objet inaccessible, sans révéler la hiérarchie réelle.

**Couleurs (`INC-028`).** Tous les textes sur surfaces douces utilisent les jetons `*-on-soft`
mesurés AA ; la règle s'applique aux badges, pilules, compteurs et états. `accent` reste réservé au
surlignage et sort des couleurs de données choisissables. Toute donnée seedée qui l'utilisait est
migrée vers `brand` ou `neutral`. Les hexadécimaux pleins ne servent de texte que lorsque la preuve
de contraste passe.

**Porteurs fonctionnels (`INC-062`, INC-066, INC-068).** Le parcours E2E de transition appartient
à `CRM-041` et reste une contre-preuve nécessaire à la fermeture de `CRM-037`. `CRM-076` porte
l'éditeur de workflow administrateur complet. Les étiquettes appartiennent à `CRM-069`, qui
livrera tables, RLS, seed, filtres et digest ; aucune pastille décorative n'est admise avant leur
donnée réelle.

---

### Décision 299 — Les propositions deviennent soit une unité nommée, soit un refus motivé

Les propositions sont arbitrées sans laisser de pseudo-backlog :

| Proposition | Décision |
|---|---|
| P01 anti-double-prospection | **retenue dans `CRM-060`** ; avertissement non bloquant par email/domaine normalisé |
| P02 score de santé | **retenue dans `CRM-066`** ; facteurs visibles, aucun score opaque |
| P03 corbeille/restauration | **retenue comme `CRM-077`** ; suppression logique et restauration, pas d'effacement physique ordinaire |
| P04 versionnement des workflows | **retenue comme `CRM-078`** ; version immuable et plan de remappage explicite |
| P05 fusion de contacts | **retenue dans `CRM-060`** ; prévisualisation, journal et retour arrière avant fusion définitive |
| P06 flux ICS | **retenue dans `CRM-061`** ; jeton révocable et données minimales |
| P07 rapport hebdomadaire | **retenue dans `CRM-069`** via `pg_cron`, distincte du digest quotidien |
| P08 écran de revue séparé | **refusée** ; les vues sauvegardées et l'analytique fournissent un préréglage « revue » sans seconde surface concurrente |
| P09 FR/EN immédiat | **refusée pour la v1** ; le français reste canonique, les textes restent centralisés pour une évolution ultérieure |
| P10 onboarding | **retenue comme `CRM-079`**, après les parcours qu'il doit réellement enseigner |
| P11 sauvegarde/restauration | **retenue comme `CRM-080`**, chiffrée, planifiée et restaurée en environnement isolé |
| P12 enrichissement automatique | **refusée** tant qu'un fournisseur, une finalité, une base légale et un DPA ne sont pas explicitement approuvés |

Les unités intégrées héritent de la Definition of Done commune. Les nouvelles unités ne sont pas
des raccourcis : elles restent à livrer séquentiellement après `CRM-075`, sauf une dépendance
explicite qui impose de les avancer.

---

### Décision 300 — Le seed possède ses fixtures, jamais les copies utilisateur

**Défaut découvert pendant la reprise de CRM-018.** La convergence historique d'INC-041 supprimait
toute dérivation au-delà de la plus ancienne. Or `copy_workflow_to_track` est un vrai geste produit :
une seconde dérivation peut avoir été créée par un utilisateur. Aucun marqueur en base ne permet au
seed d'en revendiquer la propriété. La supprimer parce qu'un compteur attend un serait une perte de
données silencieuse.

**Décision.** Le seed choisit l'unique dérivation portant son nom déclaré. S'il n'en existe aucune,
une dérivation unique peut être reconnue comme l'ancienne fixture déplacée et ramenée à son contrat.
Plusieurs candidates exactes, ou plusieurs dérivations sans candidate exacte, constituent un état
ambigu : le seed échoue, affiche les identifiants et ne supprime rien. Les copies supplémentaires
non ambiguës sont conservées et ne participent pas aux assertions de la fixture seedée.

**Exception de migration bornée.** Une copie seedée antérieure à CRM-018 ne peut pas recevoir un
formulaire complet sans maquiller le geste de copie. Elle peut être reconstruite par la vraie RPC
seulement après cinq preuves : source exactement conforme, candidate non ambiguë, uniquement les
deux cards seedées, aucun commentaire sur elles, empreinte absente — jamais une divergence moderne
inexpliquée. Les identifiants des deux cards sont recréés par le seed ; toute autre donnée provoque
un refus. Cette exception ne transforme pas le seed en outil de suppression général.

---

### Décision 301 — Une liaison cohérente le reste quand ses parents bougent

**Défaut découvert pendant l'audit de `CRM-018`.** Contrôler le couple seulement lors de son
`INSERT` ou de son `UPDATE` ne crée pas un invariant. `workflow_transitions.workflow_id` et
`form_fields.workflow_id` restent modifiables par un administrateur, et `service_role` conserve
tous les privilèges : déplacer ensuite l'un des parents pouvait laisser une liaison entre deux
workflows différents sans faire repasser son trigger. Deux transactions concurrentes pouvaient
aussi valider chacune un état que l'autre rendait faux.

**Décision.** La liaison verrouille ses deux parents en `FOR SHARE` pendant son contrôle. Deux
triggers symétriques contrôlent aussi tout changement de `workflow_id` sur une transition ou un
champ déjà lié, avec le même refus `23514` / `required_field_workflow_mismatch`. Le contrat ne se
limite donc pas au chemin API ordinaire et reste vrai sous `service_role` et sous concurrence.

**Copie atomique.** `copy_workflow_to_track` verrouille également le track cible et le catalogue
de nœuds qu'inclut son empreinte. Une archive concurrente du track ne peut plus passer entre sa
validation et la création, et une modification de nœud ne peut plus faire diverger l'empreinte dès
l'instant même de la copie.

**Rejeu.** Les trois contraintes structurelles de la nouvelle table ne sont reconstruites que si
leur définition diffère. Un rejeu conforme ne remplace donc ni la clé primaire ni ses index ; une
clé étrangère affaiblie reste réparée. Le harnais mesure les refus depuis chacun des deux parents
et dégrade réellement la sixième garde de `move_card`, pas seulement sa donnée seedée.

---

### Décision 302 — L'empreinte tranche la divergence ; la date explique seulement ce qu'elle sait dater

**Incohérence trouvée pendant l'audit de `CRM-018`.** L'empreinte canonique inclut les attributs
des nœuds du catalogue utilisés par le workflow, mais `source_modified_at` omettait leur
`updated_at` tout en prétendant couvrir la composition entière. À l'inverse, une liaison exigée ne
porte volontairement aucun horodatage, et supprimer une ligne ne transmet l'heure de sa disparition
à aucun survivant. Une date unique ne peut donc pas être à la fois exhaustive et honnête.

**Décision.** La vue prend le plus récent `updated_at` disponible du workflow, de ses étapes,
transitions, champs, règles et nœuds effectivement référencés. Elle ne fabrique aucun horodatage
pour les liaisons ni pour les suppressions. `source_modified_since_copy`, issu de la comparaison
d'empreintes, est le seul verdict : ajout, modification et suppression y restent exacts. La date
est un contexte d'affichage, jamais une seconde preuve susceptible de contredire le booléen.

---

### Décision 303 — Une copie seedée moderne divergente est refusée, jamais maquillée

**Angle mort trouvé pendant l'audit de `CRM-018`.** `source_modified_since_copy` répond exactement
à la question « la source a-t-elle changé depuis la copie ? ». Il ne peut pas répondre à une autre
question : « la copie cible a-t-elle elle-même été modifiée ? ». Le seed ne contrôlait cette cible
que par ses volumes. Renommer un champ, changer une option ou déplacer une règle sans modifier le
nombre de lignes laissait donc passer une fixture fonctionnellement fausse.

**Décision.** Après la sélection non ambiguë de la décision 300, le seed compare la composition
métier complète de la copie à celle de la source : étapes par nœud, transitions par couple de
nœuds, champs par clé, règles par clé de champ et nœud, exigences par transition et clé de champ.
Les identifiants remappés et les horodatages techniques sont volontairement abstraits ; tous les
attributs fonctionnels copiés restent comparés.

Une différence sur une copie moderne provoque un arrêt explicite **avant toute écriture sur sa
composition**. Le seed ne la complète pas, ne la réécrit pas et ne la reconstruit pas. La seule
suppression admise reste l'exception legacy bornée de la décision 300. Le harnais altère un
attribut sans changer aucun compte, exige cet arrêt, constate que l'altération subsiste, la
restaure, puis seulement rejoue le seed vert.

---

## 2026-08-09 — `CRM-018` : preuve froide, puis reprise des garde-fous historiques devenus faux

### Décision 304 — Une contre-épreuve possède ses fixtures et compte les objets du catalogue, jamais les lignes de leur rendu

**Défauts trouvés pendant le rejeu intégral.** Trois harnais antérieurs décrivaient encore un état
du seed que `CRM-046` ou `CRM-044` avait légitimement remplacé : `prospection` était traité comme
un channel repointable malgré ses cards, le nœud `livre` comme libre malgré sa nouvelle card active,
et les politiques RLS étaient comptées par les lignes d'une signature dont `pg_get_expr` peut
rendre une seule politique sur plusieurs lignes. Les produits refusaient correctement ; les
instruments de mesure étaient devenus faux.

**Décision.** Un cas accepté ou dégradé qui dépend de l'absence de données utilise désormais un
channel, un nœud, une étape et/ou une card jetables, créés et supprimés par le harnais. Il ne
réaffecte pas une fixture officielle dont une unité ultérieure peut changer l'occupation. Une
signature textuelle continue de prouver la restauration exacte, mais le nombre d'objets vient du
catalogue PostgreSQL par `count(*)`, jamais du nombre de lignes de son rendu. Cette règle préserve
les données utilisateur supplémentaires autant que la décision 300 préserve leurs copies.

### Résultat mesuré — `CRM-018` close

Le premier reset froid a mordu sur une erreur réelle de création : `COALESCE` et `GREATEST` sont
des expressions SQL, pas des fonctions qualifiables en `pg_catalog`. Après correction, un second
`./resetMe.sh --yes` a rejoué les **19 migrations** et tout le seed. La suite dédiée a ensuite
trouvé trois défauts de scénario pgTAP — types `name[]`/`text[]`, rôle administrateur non restauré
avant la RPC, suppression de fixture exécutée sous un rôle sans `DELETE` — puis a rendu **88/88**.

Les preuves finales sont :

- `scripts/verify-transition-required-fields.sh` : **24/24**, avec migration legacy, UUID mort,
  croisement de workspace, verrous concurrents, dégradations de contrainte/trigger/RLS/garde et
  divergence sémantique de la copie seedée ;
- `npm run test:sql` : **21 fichiers / 1553 assertions** ;
- `npm run e2e:api` : **425/425**, dont cinq gestes CRM-018 sous vrais jetons ;
- `npm run e2e:ui` : **144/144** dans Chromium, sans `console.warn`, `console.error` ni
  `pageerror` ; `npm run e2e:mail` : **16/16** sur les protocoles réels ;
- `npm run test:unit` : **531/531** ; `npm run typecheck` : quatre projets ; types régénérés depuis
  la base réelle puis `types:check` vert ; build Vite sans avertissement ;
- `scripts/verify-harness.sh` : **28/28**, six dégradations réellement rouges puis SQL et API de
  nouveau verts après restauration.

Les onze harnais historiques touchés par le changement ont ensuite été rejoués. Ils sont tous
verts après les trois reprises de la décision 304 : seed **69**, copie **35**, formulaire **38**,
valeurs **40**, workflows **49**, cohérence **26**, cards **38**, `move_card` **55**, timeline
**68**, preuves de refus **21**, colonnes protégées **44**. Les modes rapides n'ont omis que les
suites globales déjà exécutées séparément. Les captures produites pendant les parcours ont été
observées puis rendues à leur version ; `CRM-018` ne change aucun écran.

### Décision 305 — Une reconstruction legacy ne cascade jamais une timeline utilisateur

**Angle mort trouvé pendant la dernière relecture avant commit.** La décision 300 protégeait les
copies utilisateur, les cards étrangères et les commentaires, mais le chemin de reprise supprimait
les deux cards seedées sans relire `card_events`. Or cette table est append-only et sa clé étrangère
porte `ON DELETE CASCADE` : un déplacement, une affectation ou toute autre activité réelle aurait
disparu avec la card, précisément sans que le seed puisse la recréer.

**Décision.** Avant toute suppression d'une fixture legacy, chaque card doit avoir soit aucune
timeline — cas normal d'une montée de version depuis des cards antérieures à `CRM-044` —, soit
exactement un événement `created` technique dont `actor_id` est nul. Toute autre ligne, y compris un
`created` attribué ou un second événement, arrête le seed et conserve intégralement la copie. Cette
garde complète la phrase « toute autre donnée provoque un refus » de la décision 300 ; elle ne
change pas le traitement des copies modernes, qui reste non destructif.

**Preuve réelle.** Sur la pile locale, la copie officielle a été ramenée à sa forme legacy
(`source_composition_fingerprint = NULL`, formulaire dérivé retiré) alors que ses deux cards
portaient encore cinq événements. Le vrai seed s'est arrêté sur la timeline de `…0ca`. La relecture
immédiate a retrouvé **1 copie, 2 cards et 5 événements** ; rien n'avait été supprimé. Un nouveau
`./resetMe.sh --yes` a ensuite rejoué les 19 migrations et le seed complet, puis le harnais ciblé a
rendu **24/24** et le méta-harnais **28/28** avec SQL **1553**, API **425**, UI **144** sans
avertissement, mail **16**, unitaires **531** et quatre compilations.

---

## 2026-08-09 — `CRM-017` : la preuve froide ferme l'ordonnancement PostgreSQL

La migration 18 a été rejouée par deux resets froids, sous `supabase_admin` puis `postgres` selon
son marqueur. La suite `0020_pg_cron.test.sql` rend **48/48** : le heartbeat avance réellement,
`cron.job_run_details` porte un passage `succeeded`, et le job amorcé à cinq secondes revient à
`7 * * * *`.

La contre-épreuve ciblée `scripts/verify-scheduler.sh` rend **14/14**. Elle désactive le job, attend
qu'aucun worker ne reste en cours, dégrade commande, base, cadence, activation et ACL, puis constate
que la migration conserve le même `jobid`, réexécute le heartbeat et referme l'extension sous son
propriétaire réel. La campagne commune est celle de la clôture CRM-018 : SQL **1553**, API **425**,
UI **144** à console stricte, mail **16**, unitaires **531**, quatre compilations, build sans
avertissement, méta-harnais **28/28** et pile **55/55**. `CRM-017` et INC-012 sont closes ; les
cadences métier restent portées par leurs unités propres.

---

## 2026-08-09 — `CRM-019` : le geste pluriel reçoit un contrat exécutable

### Décision 306 — Le mapping est un ensemble exact, et toute perte reste un consentement séparé

**Choix délégués par le responsable.** Les décisions 263 et 295 imposaient le geste, son atomicité,
l'exhaustivité, le refus des doublons et l'appartenance des cibles. Elles ne fixaient ni la forme
JSON, ni la réduction de deux colonnes vers une, ni le traitement des réponses de formulaire et
des traces. Les choix suivants sont arrêtés en cohérence avec les décisions 214 à 217 et 292 à 305.

**Mapping.** `step_mapping` est un tableau d'objets portant exactement `from_step_id` et
`to_step_id`, sous forme de chaînes UUID. Un objet JSON indexé par l'étape source aurait normalisé
les clés identiques avant que PostgreSQL puisse constater le doublon ; il est donc écarté.
L'ensemble des sources est strictement égal à l'ensemble des étapes occupées du channel : aucune
absence, aucun doublon, aucune source inoccupée. Plusieurs sources peuvent viser la même cible,
parce que passer à un workflow plus court exige légitimement de regrouper des colonnes. Un channel
vide exige `[]`.

**Autorisation et portée.** Changer le workflow du contenant est une opération d'administration du
workspace, pas un simple droit `write` sur un channel. Le workflow cible est actif, du même
workspace, global ou rattaché au track exact du channel. Le workflow courant est refusé : un geste
qui ne change rien ne renvoie pas un faux succès.

**Toutes les cards signifie toutes les lignes.** Actives, archivées et en corbeille sont remappées,
sans quoi la clé composite deviendrait fausse. Les positions sont reconstruites de façon
déterministe par étape cible ; `entered_step_at` est réinitialisée, parce qu'un remappage entre
graphes entre nécessairement dans une autre étape.

**Destruction explicite.** Les réponses appartiennent à l'ancien workflow et ne sont jamais
devinées par clé. L'appel à trois arguments les refuse en comptant ce qui serait perdu ; seul
`discard_field_values=true` les supprime. Commentaires et événements survivent.

**Atomicité réelle.** La clé composite cards → channel/workflow devient `DEFERRABLE INITIALLY
IMMEDIATE` : toute écriture ordinaire reste contrôlée à la fin de son instruction, tandis que la
RPC la diffère seulement pendant sa transaction, verrouille channel, cible, étapes et cards, écrit
l'ensemble puis force le contrôle avant de rendre. Une erreur conserve tout l'avant.

**Trace exacte.** Le vocabulaire reçoit `workflow_changed`. Si le channel change,
`channel_changed` prévaut ; sinon si le workflow change, `workflow_changed` prévaut ; sinon un
changement d'étape produit `moved`. Un remappage entre graphes ne prétend donc jamais avoir franchi
une arête inexistante. La timeline reconnaît les deux changements de contexte en français plutôt
que de les abandonner au repli inconnu.

Le contrat complet est `docs/SPEC-change-channel-workflow.md`. La signature retient un quatrième
argument booléen par défaut à `false`; elle reste appelable à trois arguments sans rendre la perte
silencieuse. La migration prévue est la 20.

### Résultat mesuré — `CRM-019` close

La migration 20 livre `change_channel_workflow`, rend la clé composite différable mais initialement
immédiate, étend le vocabulaire à dix événements et rend `channel_changed`, `workflow_changed` et
`moved` exclusifs. Sa première exécution réelle a trouvé trois erreurs qui échappaient à la lecture :
`card_field_values` ne porte pas d'`id`, `pg_input_is_valid` attend un nom de type en texte dans
l'image courante, et `SET CONSTRAINTS` doit qualifier la contrainte lorsque le `search_path` est
vide. Chacune a été corrigée avant la preuve globale.

Le harnais dédié rend **23/23**. Il reconstruit la FK legacy non différable, compare l'empreinte des
données métier et les OID conformes, puis lance deux transactions : la RPC remappe un channel et
dort avant commit ; une insertion sous l'ancien workflow attend réellement son verrou, puis échoue
sur `cards_channel_id_workflow_id_fkey`. L'état final porte le nouveau workflow sur le channel et
la card, aucune card concurrente, et exactement un `workflow_changed`. Six dégradations — ACL
anonyme, garde administrateur, caractère différable, dixième type, trigger, corps du mapping — font
toutes tomber pgTAP avant restauration.

La suite dédiée rend **59/59** et la preuve HTTP **14/14** sous les vrais jetons admin, commercial
et viewer. Le reset froid rejoue les **20 migrations** puis le seed complet. La campagne commune
rend **22 fichiers / 1612 assertions pgTAP**, **439/439 API**, **144/144 UI Chromium** sans
`console.warn`, `console.error` ni `pageerror`, **16/16 mail**, **532/532 Vitest**, quatre
compilations, types générés identiques au schéma, méta-harnais **28/28** et pile **55/55**.

La relecture des arbitrages récupérés a corrigé un dernier écart de ma propre première passe : la
décision 298 imposait « Dossier changé » dans une famille « Organisation », non « Dossier modifié »
dans « Cycle de vie ». Le cinquième filtre est livré, exercé au clavier sur le build de production,
et les captures desktop/mobile ont été observées. Les harnais historiques timeline (**69/69**) et
déplacement entre channels (**42/42**) restaurent désormais la migration 20 en dernier. INC-046,
INC-073, INC-077, INC-078 et INC-081 sont closes.

La dernière inspection transversale a fait mordre `verify-manual` sur quatre volumes devenus
faux après `CRM-018` : la copie complète double les champs du formulaire (12 actifs, 2 retirés),
et le seed courant porte 21 réponses sur 11 affaires. L'annexe A et son historique ont été remis
au niveau de la base froide ; le harnais manuel rend ensuite **107/107**. La campagne globale a
été rejouée après cette correction et après l'arbitrage visuel final : elle confirme de nouveau
**28/28**, dont **144/144 UI** à console entièrement silencieuse.

---

## 2026-08-09 — `CRM-022` : l'identité lisible reçoit sa frontière

### Décision 307 — L'équipe partage les identités, l'intégrité garde le dernier admin

**Mesure.** `profiles`, `workspaces` et `workspace_members` portent zéro politique ; le vrai JWT
admin reçoit `200` / `[]` sur les trois. Les ACL permettent pourtant toutes les colonnes de profil
en mise à jour et toutes les mutations des deux autres tables. Les trois profils seedés ont un nom
mais aucun avatar. Enfin, `card_comments.author_id` est la seule des huit FK vers `profiles` qui
ne détache ni ne cascade : une parole empêche aujourd'hui de supprimer son auteur.

**Choix délégués.** Un workspace commun rend le profil lisible ; tout membre lit son workspace et
ses memberships, seul un admin gère ces derniers. Un utilisateur ne modifie que son nom et son
avatar ; le workspace reste en lecture seule tant qu'aucun geste atomique de création n'existe.
Le dernier admin est une contrainte différable, pas une branche d'interface : elle autorise une
rotation atomique et la cascade du workspace, mais refuse toute équipe peuplée sans admin.

**Mesure d'implémentation.** Une première sonde exprimait littéralement « s'il reste au moins un
membre, il reste un admin ». La suppression de l'unique ligne admin la contournait : après
l'instruction, il ne restait justement plus de membre à contrôler. La garde porte donc sur le
workspace **affecté tant que son parent existe**, même si zéro membership reste. Une seconde sonde
transactionnelle confirme que la suppression du parent reste possible : au contrôle de sa cascade,
le workspace n'existe plus. Le contrat ci-dessus est corrigé sans étendre `CRM-022` à la création
atomique d'un workspace, toujours réservée à `CRM-070`.

La parole survit au compte : `card_comments.author_id` devient nullable avec `ON DELETE SET NULL`
et affiche « Compte supprimé ». Un acteur de timeline nul reste en revanche sans libellé, car le
même `null` représente aussi le service. L'interface rouvre exhaustivement les surfaces qui
citaient INC-014 — en-tête, board, liste, commentaires, événements — avec relations embarquées,
avatars mêmes origine et aucun identifiant technique. `CRM-070` conserve invitation et écran de
gestion. Le contrat complet est `docs/SPEC-identite.md` ; la migration prévue est la 21.

### Décision 308 — Une contre-épreuve suit la structure courante et restaure l'état reçu

**Défaut trouvé par le rejeu exhaustif.** Le méta-harnais annonçait six dégradations mais deux ne
modifiaient plus rien : elles cherchaient littéralement `select plan(30)`, alors que la suite
`0001` en annonce désormais 72. Le plan tronqué et l'erreur SQL rendaient donc vert sans avoir été
injectés. La restauration comparait en outre la suite à `HEAD` ; toute reprise légitime, présente
avant le harnais mais pas encore committée, était dénoncée comme un résidu du harnais.

**Décision.** Une mutation de non-complaisance cible la forme `select plan(N)` indépendamment de
`N`, puis constate que la forme attendue a bien été modifiée. Avant toute altération, le harnais
prend un instantané octet à octet ; son `trap` le restaure, et le verdict final compare le fichier à
cet instantané, jamais à Git. Le dépôt peut être propre ou en cours de travail : dans les deux cas,
le harnais doit rendre exactement l'état qu'il a reçu et prouver que ses dégradations ont mordu.

### Résultat mesuré — `CRM-022` close

La migration 21 a d'abord convergé l'état seedé sans changer son empreinte métier, puis son rejeu a
conservé les OID conformes des contraintes, fonctions, triggers et politiques. Le harnais dédié
rend **23/23** : sa suite pgTAP dédiée compte **84/84**, ses **5/5** scénarios API emploient les
vrais JWT des trois rôles et créent un second workspace par les routes réelles, les **2/2** refus du
dernier admin portent `23514`, et le parcours Chromium connecté fait agir Camille au clavier et à
la souris. Sept affaiblissements indépendants font tous tomber pgTAP avant restauration.

La preuve froide a ensuite détruit le cluster local et rejoué les **21 migrations** puis le seed.
Sur cette reconstruction, les **23 fichiers / 1698 assertions pgTAP**, **444/444 API**, **145/145
UI Chromium** et **16/16 mail** passent. La console des 145 parcours ne contient ni avertissement,
ni erreur, ni `pageerror`. Les **564/564** tests unitaires, les quatre compilations TypeScript, le
build de production et la comparaison octet à octet des types passent également. Le méta-harnais
rend **28/28**, la pile **55/55**. Les quatre captures montrent l'en-tête connecté, le responsable
du board et de la liste, les auteurs/acteurs de la fiche et le repli à 390 px ; elles ont toutes été
observées. INC-014 est close ; invitation et gestion complète de l'équipe restent à `CRM-070`.

---

## 2026-08-09 — INC-080 : une restauration est le runner entier, jamais un suffixe mémorisé

### Décision 309 — Les harnais historiques rejouent les migrations de façon synchrone et exhaustive

**Défaut reproduit après la clôture de CRM-022.** `verify-cards.sh` rendait **3 anomalies**. Le
rejeu annoncé convergent changeait son empreinte ; la campagne SQL puis la campagne API devenaient
rouges, tandis que l'interface et les quatre portes statiques restaient vertes. Le harnais
réappliquait la migration 11 puis une liste manuelle — 12, 13, 14 et 19. Il oubliait la migration
20, qui transforme la FK composite card/channel/workflow en contrainte différable pour
`change_channel_workflow`. Sa « restauration » produisait donc un schéma qu'aucun démarrage réel
ne laisse en place.

**Décision.** Lorsqu'un harnais doit retrouver l'état courant après avoir rejoué ou dégradé une
ancienne migration, il appelle le véritable `migrations-runner` sur le répertoire complet. L'appel
est synchrone (`docker compose run --rm`) : aucune mesure API ou SQL ne commence avant son code de
sortie. Les listes maintenues à la main de migrations ultérieures sont supprimées. Le test de
convergence continue de comparer l'empreinte avant/après, puis les suites globales doivent rester
vertes ; le runner ne vaut pas preuve à lui seul.

Ce contrat complète la correction de course déjà mesurée à CRM022 dans
`verify-migrations.sh`. Il est inscrit dans `docs/SPEC-test-harness.md` §3.5 avant la reprise du
harnais cards. INC-080 ne sera close qu'après le rejeu des harnais qu'elle recensait et la
constatation de leur restauration commune.

### Résultat mesuré — INC-080 et CRM-050 closes

Le défaut du harnais cards est corrigé sous la décision 309, puis les dix harnais nommés par
INC-080 sont rejoués sur la même pile, dans l'ordre, sans reset opportuniste entre leurs mesures :
`verify-migrations` **25/25**, `verify-authz` **35/35**, `verify-cards` **46/46**,
`verify-board` **56/56**, `verify-preuves-refus` **21/21**, `verify-commentaires` **46/46**,
`verify-liste` **54/54**, `verify-formulaire` **27/27**, `verify-webapp` **42/42** et
`verify-seed-demo` **69/69**. Le panneau réel est suivi sous `PanneauTimeline.tsx`, les volumes
courants sont 14 cards et 55 politiques, le board porte quatre cards actives sur trois étapes et
les contrôleurs retrouvent les 172 classes engendrées.

L'état rendu est celui du véritable runner à 21 migrations. La campagne immédiatement suivante
rend **23 fichiers / 1698 assertions pgTAP**, **444/444 API** et **145/145 UI**. Les 145 parcours
Chromium n'écrivent aucun avertissement, aucune erreur et aucun `pageerror`. La preuve mail littérale
rend **84/84** après sessions IMAP réelles sur les trois boîtes, soumission SMTP, détection EICAR et
contrôle des journaux Stalwart ; ses cinq dégradations sur copies produisent **6 anomalies**, et
`e2e:mail` reste **16/16**. Ce sont les preuves manquantes qui retenaient `CRM-050` : l'unité passe
`[x]`, et INC-080 est close sans transformer l'ancien balayage invalide en succès rétroactif.

La campagne cards complète a fourni une contre-mesure supplémentaire. Avant déplacement du
ménage, elle reproduit INC-061 : **45 contrôles, 2 échecs**, exclusivement SQL et API, tandis que
unitaires, types, build et UI sont verts. Après exécution et constat du ménage avant les suites,
elle rend **46/46** avec les sept suites finales vertes. INC-061 est close par le comportement
exact décidé au journal 296 ; aucune assertion de volume n'est assouplie.

La dernière passe est le méta-harnais complet : **28/28**. Elle reconstruit et sert le build,
rejoue 1698 SQL, 444 API, 145 UI, 16 mail, 564 unitaires et les quatre compilations, vérifie le
rapport en HTTP, fait mordre ses six dégradations puis constate la restauration SQL et API. Le
verdict de clôture ne repose donc pas sur les seuls harnais qui viennent d'être modifiés.

---

## 2026-08-09 — CRM051 : un socle mail observable, sans simuler le métier absent

### Décision 310 — L'état de reprise est prouvable, minimal et séparé des données métier

**Question posée.** La DoD exige « arrêt et redémarrage sans perte d'état », mais les tables de
comptes, la progression IMAP et la file SMTP n'existent qu'à partir de `CRM-052`. Déclarer le
service stateless aurait rendu la preuve vraie par vacuité ; inventer ici les futures tables ou
des messages factices aurait préempté le backlog.

**Décision.** `CRM-051` persiste sur un volume un état opérationnel versionné : compteur et UUID
de démarrage, plus un UUID de checkpoint accessible uniquement par une API de développement
authentifiée. Un scénario écrit ce dernier par le réseau Compose, arrête et redémarre le véritable
conteneur, puis exige checkpoint identique, compteur augmenté et UUID de boot renouvelé. Le JSON
est remplacé atomiquement après `fsync`; une corruption refuse le démarrage au lieu de perdre
silencieusement la donnée. Messages, UID, secrets, pièces jointes et files restent absolument
exclus : leur source de vérité future demeure PostgreSQL/Storage.

**Frontière de confiance.** Le service est commun à dev/prod, non publié, sans privilège Linux et
en racine lecture seule. La santé minimale est publique au seul réseau interne ; le statut exige
un Bearer dédié. Le checkpoint est `404` en production. `SERVICE_ROLE_KEY` n'est pas transmis :
un processus qui n'accède encore à aucune table n'a aucune raison de contourner la RLS. Les logs
sont des JSONL UTC de métadonnées bornées, jamais des dumps de requêtes ou de configuration.

### Décision 311 — IMAPClient est retenu, puis installé seulement lorsqu'il sera appelé

**Mesure au 2026-08-09.** La distribution officielle Python fournit l'image
`python:3.13.13-slim-bookworm`. IMAPClient 3.1.0 est BSD-3-Clause, publié le 2026-01-17, annonce
Python 3.8 à 3.13, les UID et IDLE. Son concurrent asynchrone examiné, aioimaplib 2.0.1, est GPLv3,
annonce des versions Python plus anciennes et documente encore l'absence de STARTTLS. La
bibliothèque standard ne fournit le contexte `IDLE` qu'à partir de Python 3.14 ; elle ne suffit
donc pas au runtime 3.13 retenu. Sources primaires consultées :

- <https://hub.docker.com/_/python> ;
- <https://pypi.org/project/IMAPClient/> ;
- <https://pypi.org/project/aioimaplib/> ;
- <https://docs.python.org/3/library/imaplib.html>.

**Décision.** IMAPClient 3.1.0 devient le choix du sous-système. Il n'est pourtant pas ajouté au
squelette : aucune ligne de `CRM-051` ne l'appelle. `CRM-052` ou `CRM-054` l'épinglera avec son
premier usage et ses preuves Stalwart. Toute connexion TLS construira un contexte vérificateur
explicite, notamment du nom d'hôte ; aucun défaut de bibliothèque ne vaut politique de sécurité.

Le runtime HTTP est épinglé simultanément d'après les publications officielles consultées :
FastAPI 0.139.2, Uvicorn 0.51.0 et Pydantic Settings 2.14.2. Le framework sert une API interne
destinée à croître avec les unités mail ; il ne déplace aucune règle métier hors de PostgreSQL.
Sources : <https://pypi.org/project/fastapi/>, <https://pypi.org/project/uvicorn/> et
<https://pypi.org/project/pydantic-settings/>.

### Décision 312 — Le client de test suit Starlette 1.6 et passe à HTTPX2

**Défaut reproduit avant intégration Compose.** Avec FastAPI 0.139.2, pip résout Starlette 1.6.0.
Le `TestClient` importé par FastAPI avertit que le repli `httpx` est déprécié, puis se bloque dans
`TestClient.__enter__` avant que le lifespan n'ait démarré — même sur une application FastAPI vide.
Une trace après cinq secondes place le thread appelant dans `start_task_soon` et le portail AnyIO
sans tâche de lifespan active. Ce n'est donc ni le stockage atomique ni l'application CRM.

**Contrat amont.** La documentation courante de Starlette dit que `TestClient` est construit sur
HTTPX2, recommande explicitement de l'installer et ne garde `httpx` que comme repli déprécié.
HTTPX2 2.7.0 est publié sous BSD-3-Clause, supporte Python 3.10+ et poursuit le client sous
maintenance Pydantic. Sources primaires : <https://www.starlette.io/testclient/> et
<https://pypi.org/project/httpx2/>.

**Contre-mesure immédiate.** HTTPX2 2.7.0 retire bien l'avertissement mais **ne suffit pas** : le
même TestClient vide reste bloqué avec Starlette 1.6.0. Cette version a été publiée le 2026-08-08,
la veille de la mesure, alors que la contrainte ouverte de FastAPI (`starlette>=0.46.0`) laisse pip
la sélectionner. Reprise exacte avec Starlette 1.3.1 : `before`, `entered`, `done`, sans attente.
La publication 1.3.1 du 2026-06-12 est la dernière version dont les notes de version courantes
documentent les correctifs ; les versions 1.4 à 1.6 n'y figurent pas encore au moment du constat.
Source primaire complémentaire : <https://pypi.org/project/starlette/>.

**Décision corrigée par la contre-preuve.** Les dépendances deviennent `httpx2==2.7.0` pour les
tests et `starlette==1.3.1` pour le runtime. `httpx==0.28.1`, qu'aucun code du service n'appelle,
est retiré. L'épinglage direct de Starlette évite qu'une reconstruction identique change de
runtime au gré d'une dépendance transitive publiée la veille. La contre-preuve exigée reste le
même TestClient avec lifespan, avant le reste des 35 tests. HTTPX2 n'entre pas dans l'image.

**Seconde précision mesurée avant code correctif.** Sous 1.3.1, le client vide entre et sort, mais
l'ajout d'un lifespan FastAPI personnalisé le bloque encore avant son premier `yield`. `mail-sync`
n'a pourtant aucune ressource asynchrone dans `CRM-051` : sa configuration et son petit fichier
d'état s'ouvrent synchroniquement. Ils seront donc validés et ouverts pendant `create_app`, avant
que Uvicorn écoute ; `ready` est alors vrai, ou le processus n'existe pas. Introduire une phase
asynchrone sans sujet rendrait le service et ses preuves dépendants d'un défaut amont sans apporter
de garantie. Les messages d'arrêt du serveur restent produits par Uvicorn dans le formateur JSON
commun. La contre-preuve devient : TestClient 1.3.1 entre/sort sur l'application réelle, sans
lifespan personnalisé, puis les 35 comportements sont exercés.

### Décision 313 — Le lifespan tombe pour ce qu'il est, pas pour un défaut amont qui ne se reproduit pas

**Contre-mesure, avant d'écrire le code correctif.** La décision 312 concluait sa dernière
précision par une affirmation technique : sous Starlette 1.3.1, « l'ajout d'un lifespan FastAPI
personnalisé le bloque encore avant son premier `yield` ». Cette affirmation est **fausse**, et la
mesure est directe : une application FastAPI 0.139.2 munie d'un `asynccontextmanager` entre dans
`TestClient.__enter__`, exécute le corps du lifespan, en sort et se referme en 23 ms. Les 35 cas
alors présents dans `mail-sync/tests` passaient d'ailleurs déjà, lifespan compris, en 0,85 s.

Une décision ne peut pas s'appuyer sur un défaut que sa propre pile ne reproduit pas. Le motif est
donc retiré, et remplacé par celui qui tient seul : `CRM-051` n'ouvre **aucune ressource
asynchrone** — sa configuration et son petit fichier d'état s'ouvrent synchroniquement. Un lifespan
n'y déclarerait rien ; il déplacerait seulement l'ouverture de l'état après la construction de
l'application, ce qui rend `/health/ready` temporairement négatif sans qu'aucun appelant ne puisse
observer cet instant. C'est exactement ce que `docs/SPEC-mail-subsystem.md` §12.3 avait écrit
avant le code, et que le code ne suivait pas encore.

**Conséquence tenue.** L'état est ouvert dans `create_app`, avant que Uvicorn écoute : `ready` est
vrai, ou l'application n'existe pas — un état illisible fait échouer la construction, et le fichier
fautif n'est pas réécrit. L'événement `service_stopped` disparaît : Uvicorn journalise déjà son
arrêt dans le même formateur, et un second message n'aurait fait que dupliquer un fait. La
contre-preuve exigée par la décision 312 est conservée telle quelle, comme scénario nommé : le
`TestClient` entre et sort sur l'application réelle avant que le reste ne soit exercé.

**Second défaut mesuré au même endroit, et corrigé.** `ValidationError` de Pydantic **reproduit la
valeur fautive** dans son texte : `MAIL_SYNC_INTERNAL_TOKEN` trop court apparaissait en clair.
`Field(min_length=…)`, un validateur de champ et un validateur de modèle échouent tous les trois à
le masquer — l'entrée est rapportée telle quelle dans les trois cas. Le refus passe donc par
`load_settings`, qui ne conserve que **le nom de la variable et la règle enfreinte**, et qui lève
son `ConfigurationError` **hors du gestionnaire d'exception** : `raise … from None` masque
l'affichage de la cause, mais la laisse — avec la valeur — sur `__context__`, où n'importe quel
outil de journalisation la retrouverait. Le point d'entrée rend alors `78` (`EX_CONFIG`), après une
unique ligne `CRITICAL` qui ne cite aucune valeur. C'est ce que §12.2 exigeait : « sans révéler la
valeur fautive ».

**Troisième défaut, de portée générale.** Toute unité qui ajoute une variable au gabarit casse le
`.env` de quiconque a démarré la pile plus tôt : la variable manque au fichier, existe au contrat,
et `env_validate` refuse de démarrer sans recours documenté. `env_ensure_dev_completions` ferme
cela une fois pour toutes, avec trois cas et un seul geste par cas — secret connu tiré au hasard,
défaut du gabarit recopié, valeur `CHANGE_ME_` laissée à l'humain. Une valeur déjà renseignée n'est
jamais réécrite : ce n'est pas une rotation.

### Décision 314 — Une absence prouvée ne se distingue plus d'une règle : INC-003 est close en corrigeant aussi ses preuves

**Mise en œuvre de la décision 259.** La transition `Réalisation en cours → Perdu` entre dans le
contrat du seed, avec « Marquer perdu » pour libellé et un **commentaire exigé**, comme les quatre
autres sorties vers Perdu. Le graphe passe de dix à onze arêtes, et la copie dérivée l'hérite : les
deux workflows en portent onze, mesuré après un `./resetMe.sh` complet.

**Le graphe est relu en entier, comme la décision l'exigeait.** Cinq étapes sur sept ont au moins
une sortie. Les deux qui n'en ont pas sont `Livré` et `Perdu`, et elles sont **justifiées par leur
issue** : `won` et `lost` sont les deux fins du cycle, et une transition sortante y contredirait la
notion même d'issue. Aucun autre cul-de-sac n'existe dans le graphe.

**Le vrai enseignement est ailleurs, et il porte sur les preuves.** `scripts/verify-workflows.sh`
contenait ceci :

```
ok "`Réalisation → Perdu` n'est pas déclarée : le point ouvert n° 1 est tenu"
```

Une absence était donc **prouvée en permanence**, avec le même sérieux qu'une règle. Dès lors, plus
rien ne distinguait l'oubli d'une décision : le harnais serait devenu rouge le jour où quelqu'un
aurait corrigé le défaut. Douze preuves partageaient cette posture — quatre harnais, trois suites
Playwright, une fixture pgTAP et quatre paragraphes de spécification, tous articulés autour de
« dix transitions » et « quatre à motif ».

**Règle qui en découle.** Une absence n'est légitimement figée que lorsqu'elle est **due à une
dépendance nommée** — la table n'existe pas encore, l'unité qui la livrera est citée. Figer
l'absence d'une **règle métier** revient à graver une question ouverte dans le harnais, et à faire
payer sa résolution par une campagne rouge. Les preuves de `CRM-013` et `CRM-014` restent donc
légitimes ; celle-ci ne l'était pas.

**Deux défauts trouvés en passant, corrigés dans le même changement.** La fixture pgTAP de
`CRM-018` occupait précisément le couple `Réalisation → Perdu` : elle est déplacée sur
`Perdu → Prospection`, dont l'absence découle d'une **règle écrite** — une étape d'issue n'a pas de
sortie — et non du hasard du graphe courant. Et `scripts/verify-commentaires.sh` exigeait
`PLAYWRIGHT_CHROMIUM_PATH=/opt/pw-browsers/chromium` **par défaut**, faisant échouer sa preuve
d'interface sur tout hôte où Playwright résout lui-même son navigateur ; il exigeait de surcroît
1250 assertions pgTAP globales, chiffre qu'une unité ultérieure ne pouvait que démentir. Le premier
redevient une porte que l'environnement ouvre, le second un **plancher** au lieu d'une égalité.

### Décision 315 — Les deux gestes de l'auteur sont livrés, et deux défauts du fil tombent avec eux

**Le motif de l'écart avait disparu avant l'écart.** `CRM-043` avait livré le fil sans « Modifier »
ni « Supprimer », et l'avait écrit noir sur blanc : « les deux gestes supposent de distinguer *ses*
commentaires de ceux des autres, donc de connaître l'identifiant de l'appelant, donc une session :
INC-021. Un bouton offert à tous, qui échouerait pour tous sauf l'auteur, serait une aide
d'interface trompeuse. » Le raisonnement reste juste ; sa prémisse ne l'est plus, INC-021 étant
close par `CRM-009`. L'écart est donc comblé, et il l'est **par le haut** : la comparaison de
`author_id` à l'identifiant de session ne sert **qu'à ne pas offrir** un geste voué au refus. La
règle reste tenue par la politique `UPDATE`, qui exige l'auteur **et** le droit d'écriture courant
(`CLAUDE.md` §10).

**Le cas où l'écran se trompe est traité, et il a son propre message.** Un droit fin retombé depuis
le chargement de la page rend un `PATCH` filtré par le `USING` : `200`, et **zéro ligne** — ligne
*j* du §13.8. Ce n'est ni un succès, ni une erreur HTTP. Le confondre avec l'un des deux afficherait
une modification qui n'a pas eu lieu. Le `select('id')` final n'est donc pas décoratif : sans lui,
PostgREST ne rend aucun corps et le refus silencieux devient indiscernable d'une réussite.

**PREMIER DÉFAUT, VU SUR UNE CAPTURE ET SUR ELLE SEULE.** `commentaire-supprime-1440.jpg` montrait
un fil **entièrement vide** — « Discussion 0 », aucun événement — une seconde après une suppression
pourtant réussie, alors que le scénario venait de constater la pierre tombale et qu'il était vert.
Cause : `recharger()` incrémentait une dépendance de l'effet, ce qui **rejouait tout l'effet** —
`setEtat(enChargement)`, canal retiré, canal recréé, puis lecture. Toute la conversation
disparaissait le temps d'un aller-retour, et une reconnexion au temps réel était payée à chaque
écriture, précisément à l'instant où le fil change. La relecture passe désormais par un relais qui
ne touche pas au canal, et l'état de chargement n'est plus posé que lorsqu'il n'y a **rien à
montrer** — première lecture, changement de card, reprise après erreur. La reprise explicite, elle,
refait tout : une erreur peut venir du canal autant que de la requête.

**SECOND DÉFAUT, DÉCOUVERT EN CORRIGEANT LE PREMIER.** Le rejeu complet des preuves d'interface a
fait réapparaître un commentaire supprimé, une fois sur trois. Deux lectures étaient en vol — celle
déclenchée par l'événement de publication, celle du geste — et rien ne garantit qu'elles reviennent
dans l'ordre : la plus ancienne écrasait la plus récente. Le rang de garde était pris **par
abonnement** ; il est désormais pris **par lecture**. Le défaut préexistait à cette unité et n'était
masqué que par la reconstruction de l'effet, qui invalidait au passage les lectures en vol : la
correction du premier défaut a rendu le second visible au lieu de le créer.

**Ce que ces deux défauts enseignent.** Le premier n'était visible d'aucun test — le scénario
observait le bon état, puis la capture montrait l'état suivant. C'est la **sixième** fois qu'une
capture dénonce ce qu'un test laisse passer, et la première où l'écart durait moins d'une seconde.
Les deux sont désormais tenus par des tests de composant qui **retiennent** une lecture pour placer
l'assertion pendant l'aller-retour ; sans ce levier, aucune assertion ne peut se situer là où le
défaut vit.

**Trois défauts de mes propres preuves, corrigés dans le même changement.**

1. La preuve clavier atteignait le bouton par `focus()`. Chromium ne pose pas `:focus-visible` sur
   un focus programmatique : la preuve était verte et la capture montrait un bouton **sans anneau de
   focus**, c'est-à-dire l'inverse de ce que le §8 exige. Elle presse maintenant `Shift+Tab`, comme
   un utilisateur.
2. Le harnais renvoyait ses échecs vers `$TRAVAIL/…log`, que son propre `trap` efface à la seconde
   suivante. La piste de diagnostic n'existait que dans la phrase qui la promettait. Les journaux
   d'échec sont conservés sous `e2e/output/`, et leurs dernières lignes sont imprimées.
3. Le harnais exigeait **564 tests unitaires** à l'identique, quand la campagne en portait 585 :
   une unité tierce qui ajoute un test faisait rougir les commentaires. Le compte global devient un
   **plancher**, comme celui des assertions pgTAP l'était déjà depuis la décision 314 ; les comptes
   propres à l'unité restent exigés à l'exactitude.

**Un défaut de charge, mesuré et non contourné.** `npm run test:unit` échouait au hasard sur un
rendu de board : le délai par défaut de Vitest — 5 s — était atteint par un test qui coûte 0,1 s à
vide, la pile Docker et les vingt-huit fichiers de composants se partageant l'hôte. Le verdict d'une
Definition of Done dépendait donc de la charge de la machine. Le plafond passe à 20 s : aucune
assertion n'est assouplie, un test réellement bloqué échoue toujours, simplement plus tard.

**Un quatrième défaut de mes preuves, et il cachait un défaut du produit.** La preuve clavier
perdait le focus une fois sur trois après la publication. Cause : « Publier » devient **désactivé**
dès que le brouillon est vidé, et le navigateur rend alors le focus au `body`. Publier au clavier
renvoyait donc l'utilisateur en haut du document, ce qu'aucun test n'observait parce qu'aucun ne
regardait où le focus atterrit. Le champ de composition le reçoit désormais — le seul endroit sensé
—, et deux tests de composant le tiennent, dont le pendant : sur un **refus**, le focus ne bouge
pas, sans quoi l'utilisateur serait éloigné du message d'erreur.

**Un défaut de mes preuves encore, le cinquième, et il rendait un scénario instable.**
`getByText('Commentaire supprimé')` résolvait **deux** éléments : la pierre tombale, et la région
d'annonces du §8, qui porte exactement le même texte. Selon l'instant, Playwright en trouvait un ou
deux, et échouait en mode strict une fois sur trois. La cible est cherchée dans le fil, à
l'intérieur de la carte : tolérer deux résultats aurait masqué la différence entre les deux faits.

**UN COMPTEUR GLOBAL ÉTAIT RESTÉ EN ARRIÈRE, ET LA CAMPAGNE COMPLÈTE L'A DIT.** `SCENARIOS_UI`
valait 145 dans `scripts/verify-harness.sh` quand la campagne en portait **152** : le commit
« Prouve les droits fins à l'écran et ouvre INC-085 » avait ajouté `e2e/ui/droits-fins.spec.ts` et
ses sept scénarios sans réviser le compteur dans le même changement. C'est le même défaut qu'à
`CRM-036` — quatre unités rattrapées d'un coup — et qu'à `CRM-045`. Le mécanisme fonctionne : le
contrôle dénonce l'écart. Ce qui manque à chaque fois est la révision **dans le changement qui la
cause**, et elle fait porter le soupçon sur l'unité suivante. Valeur portée à **157** avec les cinq
scénarios livrés ici, et mesurée par l'exécution complète.

**Et le compteur voisin souffrait du même mal.** `SCENARIOS_MAIL` valait 16 quand `npm run e2e:mail`
en rend **21** : `CRM-051` avait livré cinq scénarios de protocole de plus, et son propre compte
rendu les annonçait — « 21/21 » — sans que le harnais global soit révisé. Deux compteurs sur
quatre étaient donc périmés en même temps, ce qui rendait `scripts/verify-harness.sh` rouge par
construction et aurait fini par le faire ignorer. Les deux sont corrigés ici, et le motif est le
même que celui de la décision 314 : une preuve qui se trompe sur ce qu'elle mesure cesse d'être
une preuve.

**Un écart au design system, corrigé plutôt qu'absous.** Le §5.10 demande des actions tertiaires de
**13 px** ; le bouton du design system n'avait qu'une taille, 16 px. Plutôt que d'habiller les deux
boutons sur place — ce que le §11 interdit —, `Button` reçoit une taille `compacte`, déclarée au
§5.5. **La hauteur minimale de 40 px ne bouge pas** : une action tertiaire est un texte plus
discret, jamais une cible plus petite.

**Et la capture a dénoncé le libellé compact à son tour.** Devenues étroites, les deux actions
tenaient sur la ligne du nom et de la date — et la rétrécissaient jusqu'à couper « 10/08/2026
18:14 » en deux, en permanence, puisqu'une action transparente occupe quand même sa place. Elles
occupent désormais **leur propre ligne**, réservée. Quatrième disposition essayée, troisième
écartée sur capture.

### Décision 316 — `CRM-052` est spécifiée après mesure, et deux de ses trois modes de sécurité ne seront prouvés qu'en refus

**Écrit avant la première ligne de code**, comme la règle de persistance immédiate l'exige. L'unité
tenait en deux lignes au backlog ; trois documents la nommaient sans la décrire, et deux preuves de
refus l'attendaient depuis `CRM-013` et `CRM-014`.

**Ce que la mesure a établi, et que la documentation ne disait pas.**

1. `authenticated` est refusé **dès le schéma `vault`** — `permission denied for schema vault` —,
   donc aucune politique de table n'a besoin de protéger l'écriture d'un secret : elle est déjà
   impossible. Ce qui reste à protéger est la **référence** `secret_id`, et c'est un privilège de
   colonne, pas une politique.
2. `service_role` porte `USAGE` sur `vault` et `SELECT` sur `decrypted_secrets`. Le service peut
   donc déchiffrer — mais **pas par PostgREST**, qui n'expose pas le schéma `vault`. D'où la
   fonction `app.mail_inbound_account_credentials`, `SECURITY DEFINER`, réservée à `service_role` :
   une seule voie de sortie pour un mot de passe, et elle est éprouvée dans les deux sens.
3. Contre le vrai Stalwart, **mot de passe faux et compte inconnu rendent le même refus**. C'est
   une propriété de discrétion du serveur, et le produit ne la défait pas : les deux cas portent le
   code `auth_failed`.

**La décision qui coûte, et qui est assumée : aucun mode dégradé de vérification TLS.** Le
certificat du Stalwart de développement est auto-signé sur un domaine `.test` ; une vérification
stricte échoue, et c'est **la bonne réponse**. Trois voies étaient possibles : ajouter au produit un
drapeau « ne pas vérifier », signer le certificat par une autorité locale, ou accepter que le
développement ne prouve `starttls` qu'en refus. La première met une porte dérobée dans le produit
pour le confort d'un test — c'est exactement ce que `CLAUDE.md` §18 range parmi les façons de
masquer une erreur. La deuxième appartient à `CRM-050` et déborde cette unité. La troisième est
retenue : `starttls` est prouvé **en refus**, avec sa cause TLS nommée, et `ssl` implicite n'est pas
prouvable faute de listener 993 — absence **figée par une assertion**, jamais par un commentaire,
selon la règle de la décision 314 : une absence n'est légitimement figée que lorsqu'elle est due à
une dépendance nommée.

**`last_error` porte un code, jamais le texte du serveur distant.** Un serveur mail tiers est une
entrée non maîtrisée : sa phrase d'erreur peut contenir l'identifiant essayé, un nom d'hôte
interne, une adresse IP. Elle finirait dans une table lue par l'interface, puis dans une capture.
Six codes stables couvrent les causes réelles, sont traduisibles, comparables d'une exécution à
l'autre, et ne peuvent rien révéler que le produit n'ait décidé de dire.

**Une colonne est ajoutée à `docs/SCHEMA.md`, et l'omission qu'elle corrige est nommée.**
`last_sync_at` répond à « quand ai-je lu des messages » ; le test de connexion répond à une autre
question. Les confondre ferait afficher une synchronisation qui n'a pas eu lieu — `CRM-054` seule
pourra renseigner la première. `last_checked_at` existe donc, et le §12 du schéma est corrigé dans
le même changement que la spécification.

**Ce que l'unité ne livre pas, et pourquoi ce n'est pas un oubli.** Le §2.3 décrit des formulaires
de configuration — « remplacer le mot de passe », « tester la connexion ». Aucune unité du backlog
ne porte cet écran, et l'inventer ici ferait porter à `CRM-052` une surface que le plan n'a pas
ordonnée. Le geste existe par l'API interne du service, comme l'exploitant l'exercera, et l'écart
est écrit dans la spécification, le backlog et le manuel plutôt que comblé au jugé.

**Le service reçoit enfin `SERVICE_ROLE_KEY`**, que le §12.1 réservait à « la première unité qui
consomme réellement une table mail ». C'est celle-ci, et pas avant : le principe de moindre
privilège se tient dans le temps, pas seulement dans l'espace.

### Décision 317 — `CRM-052` est livrée, et trois défauts sont nés de ses propres preuves

**Ce qui est livré, et ce que la mesure a imposé au passage.** La table, ses deux index uniques
partiels, ses deux politiques de lecture, ses privilèges de colonne, les trois fonctions et le test
de connexion réel du service. Le seed pose ses trois comptes par le **véritable chemin
d'écriture** — l'`INSERT` direct étant refusé à tous.

**Les trois fonctions vivent dans `public`, et ce n'est pas une préférence de style.** PostgREST est
configuré avec `PGRST_DB_SCHEMAS=public,storage,graphql_public` : une fonction du schéma `app`
serait invisible de `/rest/v1/rpc/`, donc inappelable par le seed comme par `mail-sync`. La
convention du dépôt était déjà celle-là — `app` porte les auxiliaires, `public` porte ce qui
s'appelle — mais elle n'était écrite nulle part. Elle l'est désormais dans la migration.

**PREMIER DÉFAUT, TROUVÉ PAR LA SUITE pgTAP.** `array_length('{}', 1)` rend **NULL**, et un `check`
qui vaut NULL est réputé satisfait : la borne « au moins un dossier surveillé » laissait passer un
tableau vide. Le correctif est un `coalesce` ; l'enseignement est ailleurs. Une contrainte écrite
dans le corps d'un `create table if not exists` n'est posée que sur une base neuve, et un rejeu
laisse intacte une définition périmée. Les dix contraintes passent donc par un **convergeur**, sur
le modèle de la migration 15 — et le convergeur est retiré à la fin, pour qu'aucune migration
ultérieure ne dépende d'un outil qu'elle n'a pas posé.

**SECOND DÉFAUT, TROUVÉ DE LA MÊME FAÇON.** `vault.secrets.name` est UNIQUE. Un compte supprimé
laisse derrière lui un secret que plus rien ne référence, et recréer la même boîte échouait sur un
`23505` que rien n'expliquait à l'exploitant. Le secret orphelin est désormais **repris** — même
nom, même boîte, contenu remplacé — au lieu d'être recréé. Deux assertions le tiennent.

**TROISIÈME DÉFAUT, ET IL EST DANS MA PROPRE PREUVE.** La suite pgTAP était verte sur une base
fraîche et rouge après `apply-seed.sh` : ses unicités partielles butaient sur les trois comptes du
seed. Elle les retire **dans sa transaction**, que le `rollback` rend. Mais le vrai danger n'était
pas là : la section de non-complaisance du harnais dégrade le produit puis vérifie que la suite
tombe. Une suite **déjà rouge** déclare donc chaque dégradation « vue » sans rien avoir prouvé —
six faux verts d'affilée, et le contrôle le plus important du harnais devient le plus trompeur.
C'est arrivé, et la correction n'est pas seulement de réparer la suite : un **témoin** exige
désormais que la suite soit VERTE avant la première dégradation.

**La décision qui coûte, tenue jusqu'au bout : aucun mode dégradé de vérification TLS.** Le
certificat du Stalwart de développement est auto-signé ; `starttls` rend donc `tls_failed`, et
`ssl` implicite ne trouve aucun listener 993. Les deux absences sont **figées par des assertions**
plutôt que par des commentaires, et la seconde devra tomber le jour où un listener existera.
L'option « ne pas vérifier » n'a pas été écrite, et ne le sera pas : une option de ce genre finit
toujours par rester activée.

**Sept preuves antérieures ont dénoncé la naissance de la table** — mécanisme de la décision 51,
septième occurrence. Trois suites figeaient l'absence de `mail_inbound_accounts` ; elles sont
**révisées, non retirées**, et mesurent désormais ce que la table consent. L'inventaire de
couverture de `CRM-014` passe de « sept acquises, quatre absentes » à « **huit acquises, deux à
moitié, deux absentes** » : laisser ce compte inchangé aurait figé une absence que le produit
venait de combler, exactement ce que la décision 314 proscrit.

**Ce que l'unité ne livre toujours pas.** Aucun écran. Le §2.3 décrit des formulaires qu'aucune
unité du backlog ne porte, et l'inventer ici ferait porter à `CRM-052` une surface que le plan n'a
pas ordonnée. Le manuel dit ce que le produit garantit et ce qu'il n'offre pas encore.

### Décision 318 — Un délai de test trop court transformerait un mot de passe faux en panne de réseau

**Écrit avant la première ligne de code de `CRM-053`**, comme la règle de persistance l'exige. La
spécification du §14 reprend celle du §13 presque mot pour mot — même modèle de secret, mêmes
politiques, même catalogue de codes — et c'est voulu : une panne réseau est une panne réseau,
qu'elle survienne en IMAP ou en SMTP, et inventer un second vocabulaire pour les mêmes causes
obligerait l'exploitant à en apprendre deux.

**La mesure qui impose un écart, elle, est nouvelle.** Stalwart applique un **délai de pénalité de
dix secondes** sur un échec d'authentification SMTP. Mesuré trois fois : à cinq secondes de
patience, le client rend `SMTPServerDisconnected … timed out` ; à dix comme à trente-cinq, il rend
`535 5.7.8 Authentication credentials invalid` — après 10,0 secondes exactement, dans les deux cas.

Conséquence directe : avec le délai par défaut hérité du §13.5 — dix secondes —, un mot de passe
faux serait rapporté comme un `timeout`. **Le diagnostic mentirait**, et l'exploitant chercherait un
problème de réseau là où il n'y a qu'un mot de passe erroné. C'est la définition même de la valeur
par défaut trompeuse que `CLAUDE.md` §18 proscrit — sauf qu'ici elle ne vient pas d'un `try/catch`
complaisant, mais d'un réglage plausible.

Le test SMTP emploie donc **trente secondes**, dans une variable **distincte** de celle d'IMAP.
Réutiliser la même reviendrait à régler un protocole par l'autre : IMAP refuse immédiatement — les
deux mesures du §13.6 le montrent —, et allonger son délai ferait attendre trente secondes une
panne qu'il annonce en une.

**Ce que cette mesure enseigne au-delà de l'unité.** Une borne de patience n'est pas un paramètre
de confort : elle décide **quelle cause l'utilisateur verra**. Deux réglages également défendables
produisent ici deux diagnostics contradictoires, et un seul est vrai. Aucun test écrit contre un
serveur simulé ne l'aurait montré — un faux serveur répond tout de suite.

### Décision 319 — `CRM-053` est livrée, et un invariant ne vaut que si son gardien parle en premier

**Ce qui est livré**, et l'essentiel est une répétition assumée : la table jumelle de la 22, mêmes
politiques, mêmes privilèges de colonne, même chemin d'écriture unique vers Vault, **même catalogue
de codes**. La ressemblance est le résultat recherché — un exploitant qui a compris une table a
compris l'autre.

**LE DÉFAUT DE L'UNITÉ, TROUVÉ EN EXERÇANT.** L'unicité de l'identité par défaut est tenue par un
index unique partiel, et rétablie par un trigger qui rabat l'ancienne. Écrit `AFTER`, ce trigger
arrivait **trop tard** : l'index refusait la seconde identité avant que le rabattement n'ait eu
lieu — `duplicate key value violates unique constraint`. La règle qui en découle vaut au-delà de
cette table : **un invariant tenu par une contrainte et rétabli par un trigger n'a de sens que si
le trigger parle en premier.** Une assertion pgTAP lit désormais le `tgtype` du trigger, pour que la
régression soit visible et non seulement possible.

**Ce que la décision 318 a coûté, et pourquoi elle est tenue par un test.** Le délai du test SMTP
est de trente secondes, dans sa propre variable. Rien n'empêcherait quelqu'un de « simplifier » un
jour en réutilisant celle d'IMAP — le code serait plus court, et le diagnostic recommencerait à
mentir. Un test Python fige donc la règle : le délai SMTP doit rester supérieur à la pénalité
mesurée. Et le scénario `mail` du mot de passe faux dure **onze secondes** : il traverse la pénalité
pour de bon, et échouerait si le réglage revenait à dix. La règle est tenue à deux endroits, l'un
rapide et l'autre réel.

**Le cas d'usage du §2.2 cesse d'être une phrase.** « Un utilisateur peut recevoir sur une boîte et
répondre depuis une adresse hébergée ailleurs » était écrit depuis le socle documentaire, et rien ne
le démontrait. Le seed le démontre : Driss reçoit sur `bizdev@` et expédie depuis `contact@`, et
trois preuves — pgTAP, API, harnais — mesurent la divergence au lieu de la décrire.

**La preuve de refus n° 7 est entière**, la n° 6 porte ses deux tables, et l'inventaire de
couverture de `CRM-014` passe à « neuf acquises, une à moitié, deux absentes ». Huitième occurrence
du mécanisme de la décision 51 : les assertions qui figeaient l'absence sont retournées, jamais
retirées.

**Ce qui reste dû, et pourquoi l'unité ne passe pas `[x]`.** La preuve de refus n° 12 exige
`queue_outbound_email`, que `CRM-058` livrera. Deux des trois exigences de la Definition of Done
sont tenues ; la troisième est **impossible à cette place du plan**, et l'absence est figée plutôt
que compensée par une preuve de substitution.

### Décision 320 — Un vrai message externe n'arrive pas où le produit le cherche

**Mesuré avant d'écrire la spécification de `CRM-054`**, et le fait n'était écrit nulle part. Un
message soumis sur le port 25 **sans authentification** est accepté par Stalwart — `250 … queued` —
puis classé dans **`Junk Mail`**. Trois expéditeurs différents, trois fois le même résultat, y
compris depuis `preuves.p2enjoy.test` : le domaine qu'emploie la preuve M2 de `CRM-050`.

**Cette preuve n'est pas fausse pour autant**, et il fallait le vérifier avant d'accuser : elle
soumet **en SMTP authentifié**, et un message authentifié arrive bien dans `INBOX`. Les deux faits
coexistent, et la différence est le chemin de soumission.

**La conséquence touche le produit, pas seulement les preuves.** `watch_folders` vaut `{INBOX}` par
défaut (§2.1). Un worker qui ne surveillerait que ce dossier ne verrait jamais un message classé
indésirable — c'est-à-dire, sur cette pile, **tout message venant de l'extérieur sans
authentification**. Trois réponses étaient possibles :

1. **désactiver le filtre anti-spam de Stalwart** pour que les preuves passent. C'est arranger le
   monde pour que la mesure plaise : une boîte de production a le même dossier, et le défaut
   reviendrait chez le client sans que rien ne l'ait annoncé ;
2. **relever `Junk Mail` par défaut** dans le produit. C'est décider à la place de l'exploitant que
   les indésirables sont du courrier, et remplir ses cards de spam ;
3. **laisser le défaut à `{INBOX}`, faire surveiller les deux dossiers par le SEED, et écrire la
   mesure.** C'est la retenue : la colonne `watch_folders` existe précisément pour porter cette
   question, et le développement montre alors ce qu'un exploitant réel devra trancher.

La preuve d'ingestion, elle, emprunte le chemin **authentifié** — celui d'un message légitime remis
par un serveur de messagerie —, et non le chemin qui produit un indésirable.

**Deux autres mesures fixent le reste.** ClamAV détecte réellement EICAR depuis le réseau Compose,
et Storage accepte un aller-retour complet avec la clé de service — `storage.buckets` étant **vide**
jusqu'ici, ce que la preuve de refus n° 9 avait figé et que cette unité va retourner.

**L'ordre de la chaîne des pièces jointes est arrêté ici, et il n'est pas indifférent** : le dépôt
précède l'analyse. Une pièce infectée est **conservée pour investigation** (§4.3), ce qui serait
impossible si le dépôt attendait un verdict favorable. Le statut naît `pending` — donc non
téléchargeable — et ne devient `clean` que si l'antivirus le dit. Le bucket, lui, reste **privé et
sans politique de lecture** : livrer ici un chemin de téléchargement ouvrirait celui d'une pièce
`infected`, exactement ce que la preuve de refus n° 9 interdit.

### Décision 321 — L'ingestion est livrée, et trois défauts sont venus de mes propres preuves

**Ce qui est livré** : les trois tables, le bucket privé, la relève, le dédoublonnage, les
occurrences, l'analyse MIME, l'empreinte de repli, l'extraction des pièces jointes, leur dépôt et
leur analyse. Un email **réellement envoyé** traverse toute la chaîne, et chaque assertion relit la
base plutôt que la réponse du service.

**CE QUI PROTÈGE LE BUCKET N'EST PAS CE QU'ON CROIT.** `storage.objects` accorde **tous** les
privilèges à `anon` et `authenticated` — c'est le défaut de Supabase, et il est mesuré. La
protection ne vient donc pas des privilèges : elle vient du refus par défaut de la RLS et de
l'**absence de toute politique**. `CRM-057`, qui livrera le téléchargement, devra écrire une
politique conditionnée à `av_status = 'clean'` ; écrite à la légère, elle ouvrirait aussi les
pièces `infected`. Le fait est consigné dans la migration, dans le contrat de déploiement, et dans
l'assertion elle-même — trois endroits, parce qu'il se lit à trois moments différents.

**Une mesure a corrigé l'écriture.** `Prefer: resolution=ignore-duplicates` ne s'applique **pas**
sans le paramètre `on_conflict` : PostgREST rendait un `409 / 23505` au second passage, et la
relève n'était donc pas idempotente. Le paramètre nomme la contrainte sur laquelle l'`upsert` se
résout — celle du dédoublonnage, qui n'est pas la clé primaire.

**L'ordre de la chaîne des pièces jointes est tenu par le code et par une assertion** : le statut
naît `pending`, donc non téléchargeable, et le dépôt précède l'analyse. Une pièce infectée est
conservée pour investigation ; elle ne pourrait pas l'être si le dépôt attendait un verdict.

**Une panne d'antivirus ne rend jamais `clean`.** Elle rend `skipped`, que le §4.3 range parmi les
statuts non téléchargeables : un fichier non analysé n'est pas un fichier sain, et le traiter comme
tel serait la valeur par défaut trompeuse que `CLAUDE.md` §18 proscrit. Une dégradation du harnais
le vérifie en rendant l'antivirus complaisant.

**TROIS DÉFAUTS SONT VENUS DE MES PROPRES PREUVES, et le troisième est le plus instructif.**

1. La suite pgTAP employait `limit 1` sur une table que l'ingestion venait de peupler : elle
   mesurait une ligne réelle au lieu de sa sonde. Le verdict dépendait de l'ordre des exécutions.
2. Une assertion demandait `select=id` sur les occurrences, dont la clé est **composite** :
   PostgREST rendait `400` **avant** tout contrôle d'autorisation, et la preuve de refus n° 11
   mesurait une faute de syntaxe au lieu d'un refus.
3. Le faux serveur ClamAV lisait le flux par un unique `recv`, répondait, puis fermait. Le client,
   qui envoyait encore, recevait un `BrokenPipeError` — donc `skipped` au lieu du verdict attendu.
   **Une fois sur trois.** Un test qui échoue une fois sur trois est pire qu'un test absent : on
   apprend à le relancer. Il lit désormais jusqu'au terminateur du protocole.

**Ce que l'unité ne livre pas, et qui est porté par une unité nommée.** Aucun classement — les
quatre règles du §4.4 sont `CRM-055` —, aucun dossier IMAP créé (`CRM-056`), aucun écran
(`CRM-057`), aucun envoi (`CRM-058`), et **aucune veille permanente** : la relève est déclenchée
par l'API interne, donc observable et rejouable, et la boucle durable appartient à `CRM-059`. IDLE
est mesuré disponible — et seulement **après authentification**, ce qu'un client naïf ne verrait
pas.

### Décision 322 — Le classement est livré, et deux preuves se croyaient propres

**Ce qui est livré** : les règles 1, 2 et 4 du §4.4, le classement manuel, sa journalisation, et
l'onzième type de la timeline. La règle 3 est désactivée, comme la Definition of Done le prévoit.

**LES RÈGLES VIVENT EN BASE, PAS DANS LE SERVICE**, et la Definition of Done demandait « pytest par
règle ». Elles sont éprouvées par **pgTAP**, et c'est délibéré : depuis `CRM-010`, toute règle
métier du produit vit en PostgreSQL. La transcrire en Python pour satisfaire la lettre d'une DoD
aurait créé une seconde source de vérité — exactement ce que `CLAUDE.md` §3 interdit.

**Deux règles de fond, et leurs contre-exemples.** Une adresse de card se reconnaît à sa **forme et
à son domaine** : la forme seule laisserait un correspondant écrire à `c-abcd1234@son-domaine.tld`
sans rien désigner ; le domaine seul laisserait passer `contact@crm.p2enjoy.test`. Et une card
archivée **ne reçoit pas** — la règle 2 hérite de ce refus, faute de quoi la filiation le
contournerait par la bande.

**DEUX DE MES PREUVES SE CROYAIENT PROPRES, ET C'EST LE DÉFAUT LE PLUS INSTRUCTIF DE L'UNITÉ.**
Elles retiraient dans leur `finally` l'événement de timeline qu'elles avaient créé. Or
`card_events` n'accorde **aucune** écriture, `service_role` compris — c'est `CRM-044` qui l'a voulu,
et c'est une propriété du produit : l'historique ne se corrige pas. Le `DELETE` était donc refusé en
silence, et le scénario croyait nettoyer ce qu'il laissait derrière lui. C'est le piège d'INC-061 **à
l'envers** : là, une preuve laissait des lignes sans le savoir ; ici, elle laissait des lignes en
croyant les retirer. Les deux preuves disent désormais pourquoi elles ne nettoient pas.

**Un second défaut, dans le harnais lui-même.** Une dégradation qui ne s'applique pas — un `ALTER`
refusé par une donnée existante — faisait **mourir le script** sous `set -e`, au milieu de sa
section la plus importante, sans rien signaler. Un harnais qui s'arrête en silence est pire qu'un
harnais absent : son dernier verdict connu était vert. Une dégradation impossible est désormais
**rapportée comme un échec**, et la restauration aussi.

**Quatre assertions antérieures ont dénoncé l'extension du vocabulaire** — dixième occurrence du
mécanisme de la décision 51, et la plus régulière : trois suites figeaient le refus de
`mail_received` en annonçant le moment où il faudrait les retourner. Elles figent désormais
`mail_sent`, que `CRM-058` devra écrire dans la même migration que son écriture.

### Décision 323 — Le nom d'un dossier IMAP n'est pas celui qu'on a demandé

**Mesuré avant d'écrire quoi que ce soit de `CRM-056`.** Créer `CRM/Conseil & IA` sur Stalwart, puis
le relire par `LIST` **avec `imaplib`**, rend `CRM/Conseil &- IA` : c'est l'UTF-7 modifié de la
RFC 3501, où `&` s'écrit `&-`.

**CETTE MESURE ÉTAIT INCOMPLÈTE, ET LA SUITE L'A CORRIGÉE — c'est écrit ici plutôt que réécrit.**
Relu avec **IMAPClient**, la bibliothèque que le produit emploie réellement, le même dossier revient
`CRM/Conseil & IA`. Le ré-encodage est une propriété **du fil**, pas du serveur, et `imaplib` ne le
décode simplement pas. Mesurer avec un outil que le produit n'emploie pas conduit à écrire une
règle qui ne le concerne pas : la sonde doit parler la même langue que le code.

**`mail_folder_map` reste nécessaire, mais pour une autre raison, et c'est elle qu'il faut écrire.**
Le chemin souhaité est dérivé de noms que l'utilisateur peut changer — renommer un track change le
chemin —, et l'assainissement du produit fait déjà diverger les deux : un track nommé « A/B » donne
un segment « A B ». Sans correspondance mémorisée, le produit ne saurait plus quel dossier renommer.
La table conserve donc le chemin **demandé** et le chemin **réellement créé**, non l'un ou l'autre.

**Deux autres mesures allègent l'unité.** Le renommage **emporte les enfants** — renommer un track
renommera son dossier et ceux de ses channels sans reconstruire l'arborescence —, et chaque niveau
se crée séparément, ce qui rend la création paresseuse naturelle.

**Une troisième l'alourdit** : le serveur **n'assainit pas** à notre place. Une contre-oblique dans
un nom de dossier est acceptée telle quelle. L'assainissement du §4.5 reste donc entièrement à la
charge du produit, et il ne pourra pas s'en remettre au refus du serveur pour attraper ses propres
erreurs.

### Décision 324 — La sonde doit parler la même langue que le code

**Le fait, d'abord.** `CRM-056` livre `mail_folder_map`, l'assainissement des segments, le chemin
dérivé `CRM/<Track>/<Channel>/<Card>`, la création paresseuse de l'arborescence et la **copie** du
message — jamais son déplacement. Mesuré de bout en bout : un vrai email a créé
`CRM/Conseil & IA/Grands comptes/Audit sécurité applicative` sur le serveur.

**L'ENSEIGNEMENT DE L'UNITÉ EST AILLEURS, ET IL PORTE SUR LA MÉTHODE.** La décision 323 avait
mesuré, avec `imaplib`, que le serveur ré-encode `&` en `&-`. C'était vrai **du fil**, et faux **du
produit** : IMAPClient, la bibliothèque que le code emploie, décode l'UTF-7 modifié et rend le nom
intact. J'avais donc écrit une règle qui ne concernait pas le produit, et fondé sur elle la
justification d'une table.

La règle qui en découle : **une sonde doit parler la même langue que le code**. Mesurer avec un
outil que le produit n'emploie pas donne un fait vrai sur le protocole et faux sur le logiciel. La
décision 323 n'est pas réécrite — elle porte la mesure d'origine et sa correction, dans cet ordre,
parce que l'erreur est plus instructive que le résultat.

**`mail_folder_map` reste nécessaire, et sa vraie justification est plus simple** : le chemin est
dérivé de noms que l'utilisateur peut changer, et l'assainissement les fait déjà diverger — un track
nommé « A/B » donne le segment « A B ». Sans correspondance mémorisée, le produit ne saurait plus
quel dossier renommer.

**Trois choix de conception, écrits parce qu'ils pouvaient aller autrement.** Le délimiteur est
**remplacé par une espace** et non retiré : « A/B » devient « A B » et reste lisible, là où « AB »
inventerait un mot. La détection des serveurs à labels est **positive sur l'inadaptation** : un
serveur inconnu est traité comme un serveur à dossiers, parce que c'est le cas général et que
l'inverse priverait de classement tout serveur non encore rencontré. Et le dossier **suit** le
classement sans le conditionner : un dossier qu'on ne sait pas créer n'empêche pas un message
d'être rangé en base — la copie est un confort d'exploitation, le classement est le fait.

**Ce qui reste dû, et qui n'est pas caché** : le renommage propagé, la preuve d'intégration par un
client IMAP tiers et l'observation dans Roundcube, que la Definition of Done exige toutes trois.
L'unité reste `[~]`.

### Décision 325 — Le rejeu des migrations était cassé, et mon contrôle ne pouvait pas le voir

**LE DÉFAUT, ET IL EST BLOQUANT.** Le `migrations-runner` rejoue **tout** le répertoire à chaque
démarrage de la pile (`CRM-001`), et PostgREST attend sa terminaison réussie. Or les migrations 17
et 20 **rétrécissaient** le vocabulaire de `card_events` à leur état d'origine : dès que `CRM-055` a
produit un `mail_received`, leur convergence a échoué en `23514`, et le runner s'est arrêté. **Un
redémarrage de la pile ne serait jamais reparti** — mesuré, code de sortie 3.

La 26 et la 27 se disputaient en outre la signature de `dossiers_a_renommer` : `CREATE OR REPLACE`
ne peut pas changer un type de retour, et chaque rejeu voyait l'une défaire l'autre.

**CE QUI A PERMIS AU DÉFAUT DE PASSER EST PIRE QUE LE DÉFAUT.** Toute la session, j'ai vérifié
l'application d'une migration par `grep -iE "^ERROR"`. Or `psql` écrit ses erreurs préfixées :
`psql:<stdin>:83: ERROR: …`. L'expression, ancrée en début de ligne, ne pouvait **rien** attraper.
Chaque « appliquée sans erreur » de cette session reposait sur un contrôle aveugle ; seuls le
succès des suites pgTAP et des preuves de bout en bout ont empêché que cela se voie plus tôt.

**La règle qui en découle** : un contrôle d'exécution se fait sur le **code de sortie**, pas sur la
forme d'un message. Un grep sur une sortie est une heuristique ; `$?` est un fait. C'est la même
leçon que la décision 324 sous un autre angle — la sonde doit mesurer ce qu'elle prétend mesurer.

**Les correctifs, et leur forme.** Les convergences de vocabulaire des migrations 17 et 20 ne
s'appliquent plus que si le type que **cette** migration introduit est absent : elles gardent leur
rôle — poser leur propre ajout sur une base qui ne l'a pas — sans jamais défaire celui d'une
migration postérieure. Et une seule migration déclare `dossiers_a_renommer` : la dernière en date.

**La preuve est celle du dépôt, pas la mienne** : `scripts/verify-migrations.sh` exécute le vrai
`migrations-runner` et exige son code 0. Il rend de nouveau **25/25**.

### Décision 326 — Un dossier que personne ne voit ne range rien

**L'unité est complète, à un écart près.** L'arborescence est vérifiée par un **client IMAP tiers**
— un conteneur jetable, ni le service ni sa connexion, qui décode lui-même l'UTF-7 modifié : un
client qui ne décode pas ne vérifie que le fil. Et elle est **observée dans Roundcube**, seul moyen
de vérification visuelle de la messagerie tant que `CRM-057` n'existe pas.

**LE DÉFAUT QUE SEUL L'ŒIL POUVAIT TROUVER.** Créer un dossier IMAP ne suffit pas : un client de
messagerie n'affiche que les dossiers **souscrits** (RFC 3501 §6.3.6). L'arborescence existait donc
côté serveur — l'API la voyait, la suite pgTAP la voyait, le client tiers la voyait — et
l'utilisateur n'en voyait **rien**. Un rangement que personne ne voit ne range rien. `SUBSCRIBE`
suit désormais chaque création **et** chaque renommage, le renommage ne transportant pas la
souscription sur tous les serveurs.

C'est la septième fois qu'une observation visuelle dénonce ce qu'un test laisse passer, et la
première où l'écart n'était pas visuel au sens graphique : c'est une **absence**, invisible à toute
mesure qui ne regarde pas l'écran d'un client réel.

**UN SECOND DÉFAUT, DANS MA PROPRE PREUVE, ET IL EST DU MÊME GENRE QUE CEUX DE LA DÉCISION 321.**
Roundcube colle le compteur de messages non lus **dans** le lien du dossier — « Inbox12 ». Un
`exact: true` ne résolvait donc jamais, et le scénario expirait au bout de **cinq minutes sans rien
dire** : ni assertion fausse, ni message, juste un dépassement de délai. Un test qui expire sans
diagnostic est pire qu'un test absent — il donne l'impression d'un problème d'environnement. Le
localiser a demandé d'instrumenter le scénario étape par étape ; la leçon est de borner chaque
action (`click({ timeout })`) plutôt que de laisser le délai global trancher.

**Le renommage couvre enfin les trois niveaux.** La correspondance mémorise le track, le channel et
la card, et la divergence est traitée **du plus haut au plus bas** : un seul `RENAME` déplace alors
les trois dossiers — mesuré, `renamed = 1` pour trois correspondances mises à jour. La version
précédente ne connaissait que la card : renommer un track l'aurait déplacée une à une en laissant
un dossier vide derrière.

**Ce qui reste dû, et qui est nommé** : un rangement manqué n'est pas rejoué. Le rangement est tenté
à la **première** vue d'un message ; un refus est journalisé, jamais repris. La reprise appartient à
`CRM-059`, dont c'est précisément l'objet.

### Décision 327 — Qui voit un message que personne n'a encore classé

**2026-08-11 — `CRM-057`, spécification écrite AVANT le code (CLAUDE.md §5).**

**Le problème.** `CRM-054` a laissé une question ouverte, et l'a écrite dans sa propre migration :
un message non classé n'est lisible par personne à travers PostgREST, faute d'un porteur de droit.
L'inbox globale ne peut pas exister sans y répondre — un panneau « Non classés » vide pour tout le
monde ne serait pas un écran, mais une promesse non tenue.

**Ce que j'ai refusé d'inventer.** Un « rôle de tri », un drapeau `visible_par_tous`, une politique
« tous les membres du workspace ». Chacune aurait été une notion nouvelle, à documenter, à
éprouver, et à défaire le jour où le produit tranchera vraiment la question du tri partagé.

**La décision.** La visibilité d'un message non classé est **exactement celle de la boîte où il a
été vu** — la règle que `mail_message_occurrences` porte déjà depuis `CRM-054` : le propriétaire du
compte, ou un administrateur du workspace. Un message non classé n'existe que par ses occurrences ;
faire suivre sa visibilité à celles-ci n'ajoute rien au modèle. Un message classé, lui, continue de
suivre sa card.

**La conséquence, nommée plutôt que masquée** : un membre ordinaire ne voit **aucun** message non
classé, et le panneau « Non classés » lui est vide. Ouvrir le tri à tous exposerait à chacun du
courrier dont personne n'a établi qu'il concerne le workspace — une adresse de contact reçoit aussi
des candidatures et des factures. Une assertion fige cette absence et devra être **révisée**, non
retirée, le jour où un rôle de tri existera.

**Un défaut trouvé en écrivant la spécification, et qui n'est pas théorique.** `classify_message`
ne vérifiait que le droit d'**écriture sur la card cible**. Tant qu'aucun message non classé
n'était lisible, cela ne se voyait pas. Dès que l'inbox existe, un membre disposant du droit
d'écriture sur une seule card pourrait désigner l'identifiant d'un message qu'il n'a pas le droit
de voir, le classer **chez lui**, puis le lire en toute légitimité : le contrôle d'accès contourné
par l'écriture. Classer exige désormais les **deux** droits. Le trou existait depuis `CRM-055` ;
c'est la spécification de l'écran qui l'a mis en évidence, pas un test.

**Une mesure qui change la forme de la migration.** `storage.objects` appartient à
`supabase_storage_admin`, dont `postgres` n'est **pas** membre : la migration qui ouvrira le
téléchargement des pièces saines devra déclarer `-- @migration-role: supabase_admin`, comme
`0018_pg_cron`. Mesuré aussi, et c'est ce qui rend la politique dangereuse à écrire : `anon` et
`authenticated` détiennent **tous** les privilèges de table sur `storage.objects`, et seule
l'absence de politique les refuse aujourd'hui. Une politique trop large n'ouvrirait pas seulement
les pièces jointes : elle ouvrirait tout le stockage. La restriction au bucket est donc portée par
la politique elle-même.

**Le HTML des expéditeurs ne sera pas affiché**, et ce n'est pas une paresse. Injecter dans le DOM
le HTML d'un inconnu, c'est lui accorder l'exécution de scripts, le chargement d'images distantes —
donc le pistage à l'ouverture — et la réécriture de l'écran autour de son message. Un rendu confiné
demande un bac à sable, une politique de contenu et ses propres preuves : une unité, pas une ligne.

**Ce que le seed devra faire, et qui coûte.** L'inbox ne se démontre pas sur un écran vide, et
CLAUDE.md §8 interdit d'y suppléer par une trace fabriquée. Le seed enverra donc **deux vrais
messages** par la soumission SMTP authentifiée, puis déclenchera une **vraie** relève. Cela ajoute
une dépendance de Stalwart et de `mail-sync` à chaque exécution du seed — assumée, et bruyante en
cas de panne : un seed qui saute discrètement une démonstration ment sur l'état du produit.

### Décision 328 — Trois défauts que seule la capture pouvait montrer

**2026-08-11 — `CRM-057`, à la vérification visuelle.**

Les preuves étaient vertes — vingt-deux assertions pgTAP, neuf scénarios d'API, vingt-sept tests du
module, six scénarios d'écran. Trois défauts leur ont pourtant échappé, et chacun a été trouvé en
**regardant** les captures.

**1. Un panneau qui déborde de son cadre.** « Refonte intranet Ville de Lyon » sortait du panneau
des dossiers et emportait son compteur hors de l'écran. La cause n'est pas `truncate`, qui était
bien posé sur le texte : c'est qu'un élément de flexbox a `min-width: auto` et **refuse de
rétrécir sous la largeur de son contenu**. Mesuré : le bouton faisait 298 px dans un panneau de
263. `min-w-0` sur le bouton — non sur son texte — a suffi. Aucun test n'aurait vu ce défaut :
l'élément était présent, cliquable, focalisable, et son libellé exact.

**2. L'échelle d'espacement est fermée, et le produit s'en souvient mieux que moi.** J'avais écrit
`lg:w-72`, `lg:w-96`, `pl-7` et `pl-11`. Or `--spacing: initial` remet la gamme à zéro
(`docs/DESIGN_SYSTEM.md` §3) : ces classes **n'existent pas** et disparaissent en silence, sans
erreur de compilation ni avertissement. Les trois panneaux faisaient chacun 1000 px de large et
débordaient de l'écran. Les largeurs de composition sont désormais deux jetons — `--size-inbox-folders`
et `--size-inbox-list` —, comme celle de la barre latérale ; les retraits de l'arborescence suivent
la gamme, 12, 24 et 48 px.

**3. Une capture prise pendant une transition ne montre rien de réel.** Au palier 900 px, la barre
latérale glisse hors champ ; la capture l'a saisie à mi-course, tiroir à moitié sorti et contenu
décalé. Corrigé en attendant une **condition** — la boîte de la barre stable d'une mesure à
l'autre — et non un délai arbitraire, que `CLAUDE.md` §18 proscrit.

**Ce que ces trois défauts ont en commun** : ils ne produisent ni exception, ni assertion rouge, ni
message dans la console. Ils produisent un écran laid, ou faux. C'est exactement le domaine que
`CLAUDE.md` §16 réserve à l'œil, et la troisième fois de ce chunk qu'il rapporte — après le dossier
IMAP invisible de la décision 326.

**Un quatrième défaut, celui-là trouvé par une assertion figée.** `CRM-056` avait livré deux
fonctions SQL **sans régénérer les types TypeScript versionnés**. L'assertion qui fige la liste des
fonctions exposées est devenue rouge à la première régénération — avec un chunk de retard, faute
que `scripts/verify-types.sh` appartienne au harnais global de `CRM-008`, qui ne l'exécute pas. Le
retard est nommé plutôt que corrigé en silence.

### Décision 329 — Un fonctionnement normal ne produit pas d'avertissement

**2026-08-11 — trouvé par une preuve de `CRM-050`, causé par le seed de `CRM-057`.**

**Le symptôme.** `e2e/mail/mail-sync.spec.ts` exige que le journal du service ne contienne que du
`DEBUG` et de l'`INFO`. Il est devenu rouge dès que le seed a fait entrer du courrier dans une card
dont le titre porte un tiret cadratin :

```
{"level":"WARNING","event":"An error occurred while decoding b\"Mailbox 'CRM/Conseil & IA/…/Assistant IA support — Nordis' already exists.\" in ASCII 'strict' mode…"}
```

**La cause, qui n'est pas celle qu'on lit.** Ce n'est pas le nom du dossier qui pose problème : le
dossier existe, il est correct, et le message y est rangé. C'est que `creer_arborescence` appelait
`CREATE` sur **chaque niveau à chaque relève**, y compris sur des dossiers déjà présents. Le serveur
répondait « already exists » — une erreur attendue, avalée par le code —, et la bibliothèque
journalisait un avertissement en tentant de décoder ce message d'erreur en ASCII.

**La décision.** La liste des dossiers est lue **avant** de créer, et seuls les niveaux manquants
sont créés. La souscription est vérifiée séparément, par `LSUB` : un dossier créé avant `CRM-056`
existe sans être souscrit, et doit le devenir sans qu'on le recrée.

**Pourquoi cela valait une correction, et pas une tolérance dans la preuve.** Une erreur attendue à
chaque passage finit par masquer celles qui ne le sont pas ; c'est la définition même du bruit
opérationnel que `CLAUDE.md` §20 proscrit. Et l'avertissement ne se déclenchait qu'en présence d'un
caractère non ASCII — donc rarement en développement, systématiquement chez un client francophone.

**Une conséquence heureuse** : la relève envoie désormais un `CREATE` de moins par niveau et par
message, là où elle en émettait un à chaque passage sur toute l'arborescence.

**Post-scriptum du 2026-08-11 — une fragilité de preuve, nommée.** Le harnais global a échoué une
fois sur `e2e/ui/commentaires-gestes.spec.ts`, et l'unité en cours n'y était pour rien : un
scénario interrompu avait laissé derrière lui un commentaire, et le scénario suivant — qui compte
les cartes portant des actions d'auteur — en trouvait **deux** au lieu d'un. Le nettoyage retiré,
les cinq scénarios redeviennent verts, et l'ont été à chaque exécution depuis. La fragilité est
réelle : un `finally` qui supprime **par identifiant** ne nettoie rien lorsque l'identifiant n'a
pas pu être lu. Elle appartient aux preuves de `CRM-043`, non à `CRM-057`, et elle est écrite ici
plutôt que corrigée à la sauvette dans un chunk qui parle d'autre chose.

### Décision 330 — Ce que le serveur ne fait pas à notre place

**2026-08-11 — `CRM-058`, spécification écrite AVANT le code (CLAUDE.md §5).**

**Quatre mesures, faites avant d'écrire une ligne**, contre le Stalwart de `CRM-050` :

| Mesure | Résultat | Ce qu'elle décide |
|---|---|---|
| `Message-ID` choisi par l'expéditeur | **conservé** | Le produit choisit le sien et le mémorise : c'est la charnière du fil |
| `Reply-To` vers une card **inexistante** | **transmis** | Sa justesse est notre responsabilité, pas une garantie du transport |
| `In-Reply-To` / `References` | **transmis tels quels** | Le fil est ce que nous écrivons, ni plus ni moins |
| `From` étranger au principal | **`501 5.5.4`** | INC-087 : le provisionnement était incomplet, pas le modèle |

**La leçon commune** : le serveur transmet ce qu'on lui donne et ne vérifie presque rien. Chaque
garantie que l'utilisateur attend — la réponse qui revient dans la bonne affaire, le fil qui ne se
coupe pas — est une garantie **du produit**, à écrire et à prouver.

**INC-087 est close par la correction n° 1.** `contact@p2enjoy.test` rejoint la liste `emails` du
principal `bizdev@p2enjoy.test`. J'ai retenu cette voie plutôt que de ramener `from_address` à
`bizdev@` : la seconde aurait fait disparaître la démonstration de divergence que la Definition of
Done de `CRM-053` réclame explicitement, c'est-à-dire supprimé l'exigence au lieu de la satisfaire.
Vérifié après correction : la soumission depuis `contact@` est acceptée.

**Deux colonnes ajoutées à `mail_messages`, et le motif de chacune est un défaut évité** :
`direction`, sans quoi un message que nous avons écrit s'afficherait comme reçu — et la règle 2
pourrait rattacher une réponse à notre propre envoi comme s'il venait du correspondant ;
`references_ids`, sans quoi une réponse ne citerait que son parent et un client de messagerie
couperait le fil au deuxième aller-retour.

**Le quota est vérifié deux fois, à dessein.** À la mise en file, pour que le refus soit immédiat et
visible par celui qui écrit ; à l'envoi, parce que c'est le worker qui le dépense réellement et que
plusieurs messages peuvent être acceptés avant que le premier ne parte. La règle est celle du
worker ; celle du RPC est une politesse. Et il se compte sur les lignes **en vol autant que
parties** : compter les seuls envois réussis laisserait mettre mille messages en file.

**Ce que je refuse de livrer ici** : le backoff et la reprise après coupure. `CRM-059` les
revendique nommément, et un backoff écrit à la va-vite ici serait défait par l'unité suivante.
L'unité livre les colonnes qui les porteront et **une seule tentative** : un échec passe `failed` et
le dit, il ne feint pas d'avoir été envoyé.

### Décision 331 — Rejouer une panne, jamais un refus

**2026-08-11 — `CRM-059`, spécification écrite AVANT le code (CLAUDE.md §5).**

**Quatre mesures d'abord**, contre le serveur réel : `UID SEARCH SINCE` est honoré, `UID FETCH` par
lots aussi, `IDLE` est annoncé, et `MAIL_SYNC_POLL_INTERVAL` — documentée depuis `CRM-051` — n'est
lue par personne.

**La distinction qui gouverne tout le reste : une panne se rejoue, un refus non.** Un serveur
injoignable reviendra ; un mot de passe faux, une adresse refusée, un message rejeté ne deviendront
pas justes en attendant. Confondre les deux produit l'un ou l'autre de deux défauts symétriques :
soit on perd un message qu'un simple délai aurait sauvé, soit on harcèle un serveur avec une erreur
qu'il redira à l'identique. `CRM-058` marquait tout `failed` à la première tentative — honnête, et
insuffisant. Le backoff ne s'applique donc qu'aux codes de transport.

**Le backoff est borné, et la borne est aussi importante que la progression.** Sans progression, un
serveur en panne est interrogé toutes les minutes. Sans borne, un message adressé à un domaine
disparu reste en file indéfiniment, et l'exploitant croit qu'il finira par partir : une file qui ne
bouge plus sans rien dire est pire qu'un refus — c'est déjà la leçon de `CRM-058`, appliquée dans
l'autre sens.

**`IDLE` est annoncé par le serveur, et je ne le prends pas.** Une veille par connexion permanente
demande une connexion par compte, sa surveillance et sa reprise : trois états de plus à superviser,
dans l'unité qui est précisément chargée de la supervision. Une scrutation à intervalle déclaré est
observable, rejouable et mesurable. Le passage à `IDLE` sera une optimisation, avec sa propre mesure
— combien de comptes, quelle latence réellement gagnée —, pas une élégance décidée d'avance.

**Un zéro par défaut peut être le bon choix, contrairement au précédent.** `backfill_months = 0`
signifie « aucun historique », et c'est juste : importer dix ans d'archives sans qu'on l'ait demandé
serait une décision prise à la place de l'exploitant. Le `daily_quota = 0` de `CRM-053` était
l'inverse — un défaut qui interdisait tout. Deux zéros, deux sens : c'est le **défaut sûr** qui les
distingue, non la valeur.

**La dette de `CRM-056` est réglée ici, et nommément.** Un rangement manqué était journalisé sans
être rejoué ; il sera repris à la relève suivante, sans qu'il faille recevoir un nouveau message
pour déclencher la reprise. Une dette nommée dans un backlog n'est réglée que le jour où une unité
la revendique.

### Décision 332 — L'absence trouvée en essayant le produit, et non en lisant le code

**2026-08-11 — arbitrage du responsable sur INC-086.**

**Le constat vient de l'usage**, pas d'une relecture : « quand je teste je vois aucun bouton pour
créer, pour modifier… je ne peux rien toucher à l'existant, ni créer des tracks ni des channels ».
C'est exactement ce qu'INC-086 décrivait depuis le 2026-08-09, en attente d'arbitrage. Une entrée
d'inconsistance qui décrit fidèlement ce qu'un utilisateur ressentira n'a de valeur que si elle est
tranchée : celle-ci a attendu, et c'est l'essai du produit qui l'a rappelée.

**L'arbitrage : option 2, une unité dédiée** — `CRM-075`, placée **avant** `CRM-076`. Le motif de
l'ordre est celui d'INC-086 : un workflow s'affecte à un channel, qui vit dans un track. Livrer
l'éditeur de workflows avant la surface qui crée les objets auxquels un workflow s'attache
reviendrait à construire le premier étage sans le rez-de-chaussée.

**Ce que cette unité NE livrera PAS, et c'est ce qui la rend petite** : aucune règle d'accès. Le
CRUD est en base depuis `CRM-020` et `CRM-021`, l'écriture y est réservée aux administrateurs du
workspace, et deux harnais le mesurent déjà. Une règle qui apparaîtrait dans `CRM-075` serait le
signe qu'elle a été inventée à l'écran plutôt que reprise de la base — exactement ce que
`CLAUDE.md` §10 proscrit.

**Une seconde absence est constatée au passage, et elle n'est pas arbitrée.** La fiche d'une card
affiche « Consultation seule : l'enregistrement des réponses n'est pas encore livré ». `CRM-037` la
nomme comme limite en l'imputant à **INC-021** — or INC-021 est **close depuis `CRM-009`**, la
session existant. Le motif invoqué a donc disparu sans que la limite soit levée : c'est le même
mode de défaillance que celui d'INC-086, et il est consigné plutôt que corrigé au passage
(INC-088).

**Le planificateur, enfin.** La tâche récurrente de la session ne se déclenche que lorsque la
session est **au repos** ; travaillant sans interruption, elle n'a jamais eu de fenêtre. Son
intervalle passe de deux heures à vingt minutes, ce qui augmente le nombre d'occasions mais ne
change pas la règle : une session occupée ne laisse pas passer de cron. Le fait est écrit ici pour
qu'il ne soit pas redécouvert.

### Décision 333 — Un droit accordé qui n'a pas de chemin n'est pas un droit

**2026-08-11 — arbitrage du responsable sur INC-085, qui ferme aussi INC-075.**

**Deux entrées, un seul défaut.** INC-075 (relevée le 2026-08-06, pendant la spécification de
`CRM-046`) et INC-085 (relevée le 2026-08-09, en produisant la preuve d'interface de `CRM-012`)
décrivent la même chose à trois jours d'écart : Farida Nowak porte `track_members.access = 'none'`
sur « Conseil & IA » et `channel_members.access = 'member'` sur « Prospection », channel de ce
track. Le backend fait exactement ce que `docs/SPEC-permissions-rls.md` §3 ligne f prescrit — le
channel lui est rendu — et aucun geste de navigation n'y mène, la barre d'onglets ne listant les
channels qu'une fois un track ouvert. Le doublon est consigné ici : une seule décision les ferme
toutes les deux, et l'existence de deux entrées pour un même fait est elle-même le symptôme d'un
registre relu par unité plutôt que par sujet.

**L'arbitrage : option 1 — un track redevient lisible dès qu'un de ses channels l'est.** La
politique de lecture de `tracks` consultera `app.can_read_channel` sur les channels du track.

**Le motif.** « Le plus spécifique gagne » devient **transitif**, ce qui est la seule lecture qui
rende la règle exerçable. Les deux autres issues étaient perdantes pour des raisons différentes :
une surface « Channels partagés avec moi » n'aurait touché aucune politique mais laissait
`/tracks/conseil-ia/prospection` rendre « Track introuvable », et faisait coexister deux chemins de
navigation vers le même objet, sans porteur au backlog ; déclarer que le droit fin de channel ne
sert qu'à restreindre aurait été **un changement de règle déguisé en renoncement d'interface** —
il aurait fallu corriger le §3.4, retirer une assertion pgTAP verte et une ligne du seed, c'est-à-dire
retirer une capacité livrée et prouvée parce que l'écran ne savait pas s'en servir.

**Ce que l'ouverture du track affiche, et c'est la question que l'option 1 posait.** Seulement les
channels consentis. Aucune règle nouvelle n'est nécessaire pour cela : la politique de lecture des
`channels` filtre déjà, et c'est précisément elle qui rend « Prospection ». Un track réapparu dans
la barre latérale avec un seul onglet est une information exacte, pas une anomalie d'affichage.

**Portée de la reprise, et ce qui doit être re-prouvé.** La politique de lecture de `tracks` est
livrée par `CRM-012` (`supabase/migrations/0010_droits_fins.sql`) et la matrice de résolution à 64
combinaisons appartient à `CRM-010`. Les deux sont rouvertes par cette décision. La règle du §3.5 —
les politiques évaluent les colonnes de la ligne, jamais une relecture de la table — reste
opposable : l'élargissement ne doit pas ramener le défaut de la décision 107, où un `RETURNING`
d'`INSERT` rendait `403`. La preuve d'interface de `CRM-012` devra montrer « Conseil & IA » rendu à
Farida avec son seul onglet « Prospection », là où elle montre aujourd'hui son absence.

**INC-075 et INC-085 restent ouvertes jusqu'à cette livraison et cette preuve**, conformément à la
règle du registre : la décision retire l'attente d'arbitrage, elle ne transforme pas une correction
due en fait acquis.

### Décision 334 — Une limite ne survit pas au motif qui la justifiait

**2026-08-11 — arbitrage du responsable sur INC-088.**

**L'arbitrage : l'écriture depuis la fiche d'une card rejoint `CRM-037`.** Aucune unité n'est créée.

**Le motif est déjà écrit dans l'unité.** La Definition of Done de `CRM-037` exige « E2E (transition
bloquée, **saisie**, transition réussie) ». Le geste manquant y est donc nommé depuis l'origine :
l'unité ne s'élargit pas, elle est ramenée à son énoncé. `CRM-036` livre déjà `card_field_values`,
ses politiques et sa validation — l'écriture n'invente **aucune règle**, elle ouvre un chemin vers
une règle livrée et prouvée, exactement comme la décision 332 l'exigeait de `CRM-075`.

**Pourquoi pas une unité dédiée.** Elle aurait supposé d'**amputer** la Definition of Done de
`CRM-037` de sa preuve de saisie, c'est-à-dire de réécrire une exigence déjà posée pour justifier
le découpage. Un découpage qui oblige à affaiblir une DoD existante est un mauvais découpage.

**Conséquence assumée :** `CRM-037` reste `[~]` plus longtemps. C'est le prix juste : elle était
`[~]` en invoquant INC-021, close depuis `CRM-009`. Le bandeau « Consultation seule » disparaîtra
avec la livraison, pas avec cette décision.

**La leçon, et elle dépasse cette entrée.** `CRM-037` imputait sa limite à INC-021 ; INC-021 est
close depuis `CRM-009` et personne n'a réexaminé les limites qui s'en réclamaient. `CRM-012`,
`CRM-020` et `CRM-021` portaient la même dette et l'ont vue lever. **Toute limite qui cite une
entrée du registre doit être réexaminée le jour où cette entrée est close**, dans le même
changement que la clôture. Faute de quoi une entrée close continue de justifier une absence.

### Décision 335 — Deux unités sous un même numéro, pour la seconde fois

**2026-08-11 — arbitrage du responsable sur une collision relevée pendant la revue du backlog.**

**Le fait.** La décision 332 a créé « Administration des tracks et des channels » sous le numéro
`CRM-075`, alors que ce numéro était déjà attribué à « Snooze des fils et des cards » dans la table
du chunk 5 de `docs/BACKLOG.md`. C'est **le mode de défaillance d'INC-069** — deux décisions n° 180
— transposé au backlog, où les numéros ne servent pas seulement de référence mais de **dépendance
d'ordre** : « `CRM-075` précède `CRM-076` » devient ambigu.

**L'arbitrage : « Snooze des fils et des cards » devient `CRM-081`.** L'unité d'administration
conserve `CRM-075`.

**Le motif est le nombre de références déjà poussées.** L'administration de l'arborescence est citée
par la décision 332, par `CHANGELOG.md`, par INC-086 et par le corps de `docs/BACKLOG.md` — quatre
documents publiés. « Snooze » n'existe que comme ligne de table, cité nulle part ailleurs. Renuméroter
l'unité la moins référencée est le geste qui casse le moins ; suffixer `075 a` et `075 b`, comme il
a fallu le faire pour les décisions 180, aurait délibérément reproduit un défaut que le registre
dénonce.

**Corollaire à appliquer dans le même changement :** `docs/MASTER_PLAN.md` §2 borne encore le chunk 5
à `CRM-075` alors que ses unités vont à `CRM-081`, et y déclare `CRM-P01 → CRM-P12` « en attente
d'arbitrage » alors que la décision 299 les a toutes tranchées. Les deux mentions sont corrigées ici.

**Règle posée pour la suite :** un numéro d'unité s'attribue en lisant **la table du chunk**, pas le
dernier numéro cité dans le corps du document. La décision 332 a lu le corps.

### Décision 336 — Solder d'abord ce qui est cassé

**2026-08-11 — arbitrage du responsable sur l'ordre de solde du registre.**

**L'état mesuré.** Cinquante-huit entrées sont ouvertes. Cinquante-six sont **arbitrées** par les
décisions 292 à 299 et la matrice de `docs/ARBITRAGES.md` : elles restent ouvertes parce que la
règle du registre l'exige — une décision ne ferme pas une entrée tant que sa correction n'est pas
livrée et prouvée. Deux seulement attendaient un arbitrage, et les décisions 333 et 334 les
rendent. **Il ne reste donc aucune question ouverte au responsable dans le registre.**

**L'arbitrage sur l'ordre : les défauts réels d'abord.** Dans l'ordre — INC-076, puis INC-085 et
INC-075, puis INC-072.

**Le motif.** Ce sont les seules entrées où quelque chose est **cassé pour un utilisateur**, et non
où une trace manque. INC-076 est mesurée : `DELETE /auth/v1/admin/users/<id>` rend `500` sur toute
base seedée dès que le compte a écrit un commentaire, et trois contrôles de `scripts/verify-seed.sh`
échouent en le constatant sans le nommer. Un droit à l'effacement que le schéma rend inexécutable
heurte `CLAUDE.md` §11, et c'est le seul de ces trois défauts qui touche des données personnelles.

**Ce qui est explicitement écarté :** commencer par le lot documentaire — INC-017, INC-019,
INC-069. Il est le moins cher et ne répare rien ; le choisir d'abord reviendrait à optimiser le
compteur d'entrées ouvertes avant la valeur rendue à l'utilisateur.

**Le coût assumé :** INC-076 rouvre `CRM-011` (dont la Definition of Done affirme le contraire de ce
que la base fait) et `CRM-043` (qui porte la colonne `author_id not null` sans action `ON DELETE`).
Un chunk qui touche deux unités `[~]` est plus lourd qu'un chunk documentaire — c'est le prix d'une
correction de fond, et l'arbitrage de la matrice est déjà rendu : `author_id` devient nullable avec
`ON DELETE SET NULL`, comme les cinq autres clés vers `profiles` et comme `card_events.actor_id`.

### Décision 337 — Le premier défaut de la décision 336 semble déjà corrigé, deux jours avant elle

**2026-08-11 — investigation menée en reprenant le backlog, sans pile locale disponible.**

**Le fait.** La décision 336, ci-dessus, ouvre sur « cinquante-huit entrées ouvertes » et fixe
l'ordre de correction des trois défauts réels — INC-076 en tête. En relisant `CRM-011` et `CRM-043`
avant de reprendre ce chunk, `git log -S "on delete set null" -- supabase/migrations/0021_identites_et_memberships_surs.sql`
montre que le commit `22996fd` (« Livre les identités d'équipe sûres », `CRM-022`) porte **déjà**,
depuis le **2026-08-09**, exactement l'option 1 de l'arbitrage que la décision 336 cite : la colonne
`card_comments.author_id` nullable, sa FK avec `ON DELETE SET NULL`. Le même commit modifie
`supabase/tests/0023_identites_et_memberships_surs.test.sql` (assertions 5, 6, 81 à 83 : suppression
réelle de l'auteur avec `lives_ok`, commentaire conservé, auteur détaché) et `scripts/verify-seed.sh`
(dont l'en-tête explique désormais pourquoi un compte auteur de commentaires n'est plus supprimé
comme test destructif). `CHANGELOG.md`, dans l'entrée `CRM-022` déjà publiée dans ce fichier, revendique
cette suite pgTAP **84/84**.

**Ce que cela signifie, sous réserve.** La décision 336 a été écrite le même jour que ce constat,
apparemment sans relire ce que `CRM-022` avait déjà livré deux jours plus tôt. Rien n'indique une
mauvaise foi : c'est la conséquence directe et prévisible d'INC-089, ouverte juste au-dessus dans ce
même document — un registre que plusieurs exécutions non sérialisées lisent et écrivent sans se
voir finit par recommander de refaire ce qui est déjà fait.

**Ce que cette décision ne fait PAS.** Elle **ne clôt pas** INC-076 : cette session tourne sans pile
locale (pas de Docker), et n'a rejoué ni `npm run test:sql`, ni `scripts/verify-seed.sh`, ni un
`DELETE /auth/v1/admin/users/<id>` réel. La lecture statique du code et des tests est cohérente et
concordante sur trois sources indépendantes, mais ce n'est pas la preuve d'exécution que
`CLAUDE.md` §17 exige pour fermer une entrée du registre. `docs/INCONSISTENCY_REPORT.md` porte le
détail complet et la liste des preuves à rejouer.

**Corollaire pour la suite de la décision 336.** Si la vérification confirme ce constat, l'ordre
qu'elle fixe perd son premier terme et la prochaine exécution disposant de la pile devrait reprendre
directement à INC-085/INC-075. Aucun autre travail n'a été engagé sur `CRM-059` ni sur `CRM-075`
pendant cette session : le temps disponible est allé à cette vérification plutôt qu'à une nouvelle
ligne de code sur une unité déjà en cours, conformément à `CLAUDE.md` §1 (« traiter une seule tâche
cohérente à la fois »).

### Décision 338 — Spécifier `CRM-075` avant d'écrire son écran, et nommer les cinq points que l'énoncé laissait ouverts

**2026-08-11 — reprise du backlog, toujours sans pile locale (pas de démon Docker).**

**Le point de départ.** `CRM-075` — administration des tracks et des channels — a été créée le même
jour par la décision 332 (INC-086, option 2) et n'est pas commencée. Son énoncé est net sur ce qu'il
faut livrer, et surtout sur ce qu'il ne faut **pas** inventer : « le CRUD backend existe déjà et est
prouvé depuis `CRM-020` et `CRM-021` […] cette unité ne livre donc aucune règle nouvelle. Une règle
d'accès qui apparaîtrait ici serait le signe qu'elle a été inventée. » C'est la contrainte la plus
forte du travail, et elle est vérifiable ligne à ligne.

**Ce qui est fait ici, et pourquoi rien d'autre.** `CLAUDE.md` §5 exige qu'une spécification validée
soit écrite **et committée avant la première ligne de code**. `docs/SPEC-administration-arborescence.md`
est donc écrite en premier, avec `docs/DESIGN_SYSTEM.md` §5.13 pour les règles visuelles, dans un
commit documentaire dédié. Le code suivra dans son propre commit.

**Cinq points que l'énoncé laissait ouverts, tranchés ici plutôt que pendant l'implémentation :**

1. **Deux adresses, pas une.** `/reglages` affiche « Aucun réglage modifiable », ce que cette unité
   rend faux. Plutôt que d'y placer l'écran, `/reglages` devient un index et
   `/reglages/arborescence` porte l'administration. Motif : `CRM-070` et `CRM-076` amènent deux
   autres sections, et déplacer plus tard une adresse déjà partagée coûte plus qu'un index d'une
   entrée aujourd'hui.

2. **Réordonner écrit UNE position, jamais deux.** Une permutation demande deux `UPDATE` non
   atomiques dont le second peut échouer en laissant la liste dans un état que personne n'a voulu.
   Le milieu de deux positions voisines — `position` est un `numeric` précisément pour cela
   (`docs/SPEC-tracks.md` §3) — donne une écriture unique, atomique par construction, dont le refus
   laisse la liste intacte. Le cas dégénéré (deux voisines de position égale, ou une première
   position nulle) est **refusé et nommé**, jamais écrit à vide : écrire une valeur qui ne change
   pas l'ordre affiché serait la valeur par défaut trompeuse que `CLAUDE.md` §18 proscrit.

3. **Le désarchivage est livré, alors que l'énoncé ne cite que quatre verbes.** L'énoncé justifie
   l'absence de suppression par « archiver masque et reste **réversible** ». Un écran qui archive
   sans savoir désarchiver rend cette phrase fausse dans le produit : l'administrateur qui se trompe
   doit reprendre la clé de service, c'est-à-dire exactement le défaut qu'INC-086 relève. Le geste
   n'ajoute aucune règle — même `UPDATE`, même table, même politique — et ce n'est pas la corbeille
   de `CRM-077`, qui porte rétention et effacement définitif. **L'écart est assumé et soumis à
   l'arbitrage du responsable** (§11, limite 1) plutôt que pris en silence : il se retire en
   supprimant une case et deux fonctions.

4. **Les commandes ne sont pas masquées pour un non-administrateur**, contre la lettre de l'énoncé
   (« un `viewer` ne voit aucun de ces gestes ») mais avec son esprit, qui ajoute aussitôt « mais
   c'est une aide d'interface ». L'interface n'a aucun moyen fiable de connaître le rôle courant sans
   le demander au serveur, et un rôle lu au chargement peut être périmé à l'instant de l'écriture :
   une commande masquée sur cette foi cacherait un geste **permis**, là où une commande refusée
   montre le refus réel. C'est déjà la position du composeur de commentaires
   (`docs/DESIGN_SYSTEM.md` §5.10) ; deux réponses opposées à la même question dans le même produit
   seraient pires que l'une ou l'autre.

5. **Aucune modale.** Le §5 du design system n'en déclare aucune, et `CRM-043` a déjà tranché ce cas
   en plaçant sa confirmation dans le flux du document. En inventer une ici demanderait un piège de
   focus, une gestion d'`Échap` et le voile `--color-veil` — trois mécanismes que personne n'a
   spécifiés, pour un écran qui n'en a pas besoin.

**Ce que cette décision ne fait PAS, et ce qui reste dû.** Aucune preuve d'exécution n'est produite
par ce commit : il est documentaire. Le code, ses tests unitaires, `typecheck` et `build` suivent ;
les preuves d'API, E2E et les captures **ne peuvent pas** être produites dans cet environnement, qui
n'a pas de démon Docker. `CRM-075` restera donc `[~]` avec la liste explicite de ce qui reste à
rejouer sur le poste du responsable, et non `[x]`.

**INC-088 n'est pas rouverte, et l'état d'où partait cette session était périmé.** La consigne
d'exécution décrivait INC-088 comme « non tranchée », en demandant de ne pas l'arbitrer. Vérifié
dans le registre et dans `CHANGELOG.md` : elle **est** arbitrée depuis la décision 334, le même
jour — l'écriture depuis la fiche d'une affaire appartient à `CRM-037`, dont la Definition of Done
l'exigeait déjà. Il n'y avait donc aucun arbitrage à éviter, seulement une mise en œuvre à faire,
qui n'appartient pas à `CRM-075`. Le fait est noté ici parce que c'est la troisième fois qu'un état
transmis d'une exécution à l'autre est plus vieux que le dépôt — INC-089, décision 337, et
celle-ci : l'état réel se lit dans les documents, jamais dans le résumé qui les précède.
