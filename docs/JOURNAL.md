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
