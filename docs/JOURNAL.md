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
