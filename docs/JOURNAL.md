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
