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
existant. Le correctif est durable : il vaut pour tous les passages suivants de la routine, qui
n'ont plus à y penser.

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
