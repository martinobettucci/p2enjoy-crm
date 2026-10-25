# Spécification — Une pile de développement par session

- Unité de backlog : **`CRM-115`** — « Une pile de développement par session, des ports attribués à chaque lancement ».
- Arbitrages : `docs/JOURNAL.md`, **décision 701**, point 3 (texte du responsable cité au §1), et **décision 702**
  (plus aucun nom de conteneur en développement, option A pour la production).
- Documents liés : `docs/SPEC-test-harness.md` §3.5 et §3.6 (reconstruction), `docs/DAT.md` §3.8 et §13 (commandes de
  lancement), `docs/CloudWorker.md` §2 (démarrage d'une session planifiée), `README.md` §6.
- **Connecteur MCP : non** — outillage de développement, pas une fonctionnalité du produit (décision 701).
- État : **validée**. §6 et §6 bis le 2026-10-25 (décision 702), précisés par la décision 703 ; les quatre points du §11
  le même jour, tous selon la recommandation (décision 705).

---

## 1. Objet

> « Chaque session ne devrait travailler que dans sa pile, donc il faut prévoir des ports configurables à chaque
> lancement. Un fichier dans l'OS, partagé par chaque session, doit y répertorier les sessions en cours et être vérifié
> à l'usage, car parfois les VM sont recyclées alors que le FS est maintenu. » — le responsable, 2026-10-25.

Plusieurs sessions (tâches planifiées, sessions interactives) partagent parfois une VM, son démon Docker et son système
de fichiers. Elles démarraient toutes **la même** pile : même nom de projet Compose, mêmes noms de conteneurs, mêmes
ports. Le 2026-10-25, deux sessions ont ainsi mesuré la même base l'une sous l'autre et fait deux fois le même travail
(décision 694). L'objectif : **une pile par session**, des ports attribués au lancement, et un **registre** des
sessions, vérifié à chaque usage.

## 2. Ce que le dépôt et l'hôte portent aujourd'hui — mesuré le 2026-10-25

**Le nom de projet est figé.** `docker-compose.yml` déclare `name: p2enjoy-crm`. Les réseaux et les volumes nommés en
dérivent ; aucun ne porte de `name:` explicite. Ils suivront donc le nom de projet sans autre changement.

**Vingt conteneurs ont un nom figé** (`container_name`), de `p2enjoy-db` à `p2enjoy-ollama-simule`, plus
`realtime-dev.p2enjoy-realtime`. Deux piles ne peuvent pas coexister tant que ces noms ne varient pas.

**Les ports publiés passent déjà par `.env`**, à une exception près. Les treize variables sont `KONG_HTTP_PORT`,
`STUDIO_PORT`, `MINIO_API_PORT`, `MINIO_CONSOLE_PORT`, `WEBAPP_DEV_PORT`, `STALWART_SMTP_PORT`,
`STALWART_SUBMISSION_PORT`, `STALWART_IMAP_PORT`, `STALWART_ADMIN_PORT`, `ROUNDCUBE_PORT`, `CLAMAV_PORT`, `SSO_DEV_PORT`
et `MCP_DEV_PORT`, et la prévisualisation des preuves lit `WEBAPP_PREVIEW_PORT` (4173 par défaut). **Corrigé le
2026-10-25 en écrivant la T3 (décision 710)** : le relevé en omettait une quatorzième, `POSTGRES_DIRECT_PORT` (54322),
que `docker-compose.dev.yml` publie aussi — l'accès direct à la base. Sans elle, deux piles se disputeraient ce port. Les URL de `.env`
répètent ces ports en clair (`API_EXTERNAL_URL`, `SUPABASE_PUBLIC_URL`, `SITE_URL`, les variables `SSO_DEV_*`). Le realm
de Keycloak lit ses redirections dans des variables (`${SSO_DEV_REDIRECT_URI}`…), **sauf une** :
`keycloak/realm-lelabs.json` ligne 45, `http://127.0.0.1:4173/auth/retour`, en clair.

**97 fichiers nomment un conteneur en dur** : 67 harnais posent `DB_CONTAINER=p2enjoy-db`, 10 fichiers sont sous
`e2e/mail`, 2 sous `e2e/ui` (`docker exec p2enjoy-db`, `docker inspect p2enjoy-mail-sync`), 2 sous `scripts/lib`, et le
seed en compte un.

**Des chemins de l'hôte sont partagés hors du dépôt.**
- Le verrou de reconstruction (`/tmp/p2enjoy-crm-reconstruction.lock`) et son journal.
- Une trentaine de fichiers de travail des harnais (`/tmp/p2enjoy-*-body`, `-sql.log`…).
- `pkill -f "[v]ite"`, prescrit par `docs/CloudWorker.md` §2.1 *ter*, tue la prévisualisation de **toutes** les
  sessions.

**La base vit dans le dépôt** : `./supabase/docker/volumes/db/data` est un volume lié. Deux piles issues de **deux
checkouts** ont donc deux clusters. Deux piles issues d'un **même** checkout partageraient le leur, et aussi `.env`,
l'index Git et l'arbre de travail.

**Après un recyclage de la VM, la pile revient à moitié.** Mesuré le 2026-10-25 à 10:10 UTC, VM démarrée à 09:58,
système de fichiers conservé :
- au redémarrage du démon, dix-sept conteneurs repartent seuls, en vertu de leur politique de redémarrage ;
- `p2enjoy-db` reste « Exited (255) », car sa politique est `no`, et son `postmaster.pid` est resté sur le disque ;
- Kong, PostgREST et `meta` sont alors « unhealthy » ;
- les vingt conteneurs citent le même répertoire de travail, `/home/user/p2enjoy-crm`.

L'identifiant de démarrage de la VM (`/proc/sys/kernel/random/boot_id`) change à chaque recyclage.

## 3. Le principe : un emplacement par checkout, attribué au lancement

Une **pile** est désignée par un **emplacement**, un entier `N` de `0` à `P2ENJOY_EMPLACEMENTS_MAX - 1` (`10` par
défaut). L'emplacement fixe :

| Grandeur | Emplacement 0 | Emplacement N |
|---|---|---|
| nom de projet Compose (`COMPOSE_PROJECT_NAME`) | `p2enjoy-crm` | `p2enjoy-crm-N` |
| noms des conteneurs | ceux que Compose dérive du projet : `p2enjoy-crm-db-1` | `p2enjoy-crm-N-db-1` |
| ports publiés | valeurs actuelles de `.env.example` | valeur actuelle + `100 × N` |
| répertoire de travail des harnais (`P2ENJOY_TMP`) | `/tmp/p2enjoy-crm/0` | `/tmp/p2enjoy-crm/N` |

**L'emplacement 0 reproduit les ports actuels** — ceux du `.env` du checkout, et non ceux de `.env.example` : **précisé
par la décision 713**, après l'incident qu'elle consigne. La **base** d'un checkout est la valeur de chaque port dans son
`.env`, moins `100 ×` l'emplacement que ce `.env` déclare (`P2ENJOY_EMPLACEMENT`, 0 s'il n'en déclare aucun) ; un `.env`
neuf, amorcé de `.env.example`, a donc pour base les valeurs de `.env.example`. Un poste qui a changé un port pour
éviter un conflit le garde. Les noms de conteneurs de développement, eux, changent une fois pour
toutes, dès la T2 : plus aucun n'est fixé à la main, et nul appelant n'en dépend plus (§6). Les assemblages de
production et de la cellule Spark **gardent leurs noms** (décision 702, option A, §6 bis).

**Le pas de 100 est sûr jusqu'à dix emplacements**, mesuré sur les valeurs par défaut. Aucun port de base n'en rejoint
un autre par un multiple de 100 inférieur à 1 000. Le cas le plus serré est celui de Kong : 8000 + 900 = 8900, sous
MinIO à 9000. Au-delà de dix emplacements, le contrôle d'attribution (§4.2) refuse plutôt que de chevaucher.

**Un checkout, une pile.** Le dépôt porte la base (§2), `.env` et l'index Git d'une seule session : un emplacement est
attaché à un **chemin de checkout**. Deux sessions qui travailleraient dans le même checkout ne sont pas isolables par
une pile. Le registre le **refuse** (§4.3) au lieu de le laisser faire.

## 4. Le registre des sessions

### 4.1 Forme

- **Lieu** : `P2ENJOY_REGISTRE_SESSIONS`, par défaut `/var/tmp/p2enjoy-crm/sessions/`. Ce répertoire est hors de tout
  checkout, sur le système de fichiers partagé ; `/var/tmp` survit par convention au redémarrage.
- **Un fichier par emplacement occupé**, `emplacement-N`, en lignes `clé=valeur` :

| Clé | Valeur |
|---|---|
| `emplacement` | `N` |
| `session` | identifiant de la session, `P2ENJOY_SESSION` ; par défaut, l'horodatage du premier lancement depuis ce checkout |
| `checkout` | chemin absolu du dépôt |
| `projet` | nom de projet Compose |
| `boot_id` | identifiant de démarrage de la VM au moment du lancement |
| `ouvert` | horodatage UTC de l'attribution |
| `activite` | horodatage UTC du dernier usage (§4.3) |

- **Atomicité** : toute lecture-écriture du registre se fait sous `flock` sur `registre.lock`, dans le même
  répertoire. Deux lancements simultanés se suivent et ne reçoivent jamais le même emplacement.

### 4.2 Attribution, au lancement (`./runDev.sh`)

Sous verrou, dans cet ordre :
1. si une entrée porte **ce checkout**, c'est l'emplacement de ce checkout : on le reprend (§4.3) ;
1 bis. **sinon, si une pile de ce checkout tourne déjà** — des conteneurs dont l'étiquette Compose
   `com.docker.compose.project.working_dir` est ce checkout —, **on l'adopte** : son projet désigne l'emplacement
   (`p2enjoy-crm` → 0, `p2enjoy-crm-N` → N), sans mesurer ses propres ports. Si son projet ne désigne aucun emplacement,
   si plusieurs projets tournent, ou si l'emplacement est déjà inscrit pour un autre checkout, **l'attribution refuse**.
   **Jamais une seconde pile depuis un même checkout** : sa base vit dans le dépôt (§2), et deux PostgreSQL sur un même
   répertoire de données, c'est l'incident de la décision 713 ;
2. sinon, on prend le plus petit `N` sans entrée, ou dont l'entrée est **périmée** (§4.4), après avoir arrêté la pile
   périmée ;
3. on vérifie que **chacun** des ports de `N` est libre sur l'interface de bouclage, par une tentative de liaison. Le
   poste n'a ni `ss` ni `netstat` (INC-044). Un port pris fait passer à `N + 1`, et la cause est nommée. *La précision
   de la décision 712 — les ports d'une pile de ce checkout ne comptent pas — est **remplacée** par le point 1 bis
   (décision 713) : une pile de ce checkout en marche est adoptée avant toute mesure de port ;*
4. on écrit l'entrée, puis les variables de `N` dans `.env` (§5).

Si aucun emplacement n'est libre, le lancement **échoue** sans rien démarrer, et liste les sessions en cours.

### 4.3 Vérification à l'usage

Chaque usage de la pile vérifie l'entrée de son checkout et rafraîchit `activite` : `./runDev.sh`,
`reconstruire_base_dev`, le seed, et l'ouverture commune des harnais (`scripts/lib/emplacement.sh`, §6).

| Constat | Issue |
|---|---|
| aucune entrée pour ce checkout | refus : « lancez `./runDev.sh` » |
| entrée de ce checkout, `session` différente de `P2ENJOY_SESSION` et activité de moins de 6 h | **refus** : un autre agent travaille dans ce checkout |
| `boot_id` différent de celui de la VM | **la VM a été recyclée**. La pile de cet emplacement est arrêtée, ou à moitié vivante (§2). Elle est relancée par `./runDev.sh`, qui rafraîchit `boot_id`. Un harnais refuse de mesurer une pile dans cet état |
| `.env` ne porte pas les variables de l'entrée | refus : le fichier a été changé hors registre |

### 4.4 Entrée périmée

Une entrée est **périmée** lorsque son `activite` date de **plus de 6 heures**, la même borne que la prise en charge
d'une tâche (`CLAUDE.md` §5). Avant de reprendre l'emplacement, l'attribution :
1. arrête ses conteneurs (`docker compose -p <projet> down`, **volumes conservés**) ;
2. **n'efface rien** du checkout de l'entrée ;
3. consigne la reprise dans le fichier `reprises.log` du registre.

Un `boot_id` différent ne suffit pas à périmer une entrée. Une session survit parfois au recyclage de sa VM, et cette
session-ci l'a fait le 2026-10-25 : son emplacement lui reste dû jusqu'à six heures d'inactivité.

### 4.5 Libération

`./runDev.sh --stop` arrête la pile et retire l'entrée. `scripts/sessions.sh liste` affiche le registre, avec pour
chaque entrée son état mesuré : vivante, VM recyclée, périmée. `scripts/sessions.sh liberer N` libère un emplacement
périmé à la main.

## 5. Les variables d'un emplacement

`scripts/lib/emplacement.sh` est la **seule** source de la liste.
- **Les ports** : les quinze variables du §2 — quatorze ports publiés et celui de la prévisualisation —, chacune à
  sa valeur de base + `100 × N`. Avec `POSTGRES_DIRECT_PORT`, le pas de 100 reste sûr : 54322 + 900 = 55222, loin de
  tout autre port de base.
- **Les URL qui les répètent** : `API_EXTERNAL_URL`, `SUPABASE_PUBLIC_URL`, `SITE_URL` et les variables `SSO_DEV_*`.
  Elles sont réécrites à partir des ports, jamais à la main.
- **`COMPOSE_PROJECT_NAME`, `P2ENJOY_TMP`** et **`P2ENJOY_EMPLACEMENT`**.

Le `.env` d'un emplacement reste un `.env` ordinaire : ses secrets sont tirés par l'amorçage actuel. La ligne 45 du realm
Keycloak devient `${SSO_DEV_PREVIEW_REDIRECT_URI}`, à partir de `WEBAPP_PREVIEW_PORT`.

## 6. Les appelants — plus aucun nom de conteneur en développement (décision 702)

Les noms ne sont pas paramétrés : ils sont **supprimés**. Un nom fabriqué à la main, même variable, reste une
convention que chaque appelant doit répéter ; le service Compose est déjà un nom stable, propre au projet.

- **Compose (développement)** : aucun `container_name` dans `docker-compose.yml` ni dans `docker-compose.dev.yml`.
  Compose nomme les conteneurs à partir du projet. Le nom de projet est retiré de `name:` et vient de
  `COMPOSE_PROJECT_NAME`, par défaut `p2enjoy-crm`.
- **Shell** : un utilitaire unique, `conteneur <service>`, dans `scripts/lib/conteneur.sh`, que `scripts/lib/env.sh`
  charge à côté de `compose_dev` et que les harnais chargent seul — ils ne chargent pas `env.sh`, dont plusieurs
  redéfinissent les fonctions (décision 703). Il rend le **nom** du conteneur du service, arrêté compris, et échoue en
  nommant le service si la pile ne le porte pas : le nom et non l'identifiant, qu'une reconstruction change. Les 67
  `DB_CONTAINER=p2enjoy-db` deviennent `DB_CONTAINER=$(conteneur db)`.
- **Scripts que la production exécute aussi** (`scripts/backup.sh`, `scripts/restore-drill.sh`) :
  `conteneur_en_marche <service> <nom de production>` rend le service sous le profil `dev` et exécute ailleurs la
  commande d'avant, à l'identique (décision 703, option B).
- **Conteneurs jetables des preuves** (`…-preuve-prod`, `…-jetable`) : leur nom dérive de celui du conteneur du
  service, donc du projet.
- **TypeScript** (`e2e/`) : un module unique, à côté des fixtures, rend le conteneur d'un service par la même commande
  Compose. Les douze specs qui nomment un conteneur l'emploient.
- **Réseau** : un service s'appelle par son nom de service sur le réseau Compose — le seed passe de
  `http://p2enjoy-mcp:8080` à `http://mcp:8080`. **Realtime** tire son tenant du premier segment de l'hôte : `kong.yml`
  l'appelle par l'**alias réseau** `realtime-dev.realtime`, posé sur le service, sans nom de conteneur global
  (décision 703 : label de Kong à `crm-115`, contrat de déploiement §2.22).
- **Commentaires et documentation** : les modes d'emploi des vingt fichiers pgTAP, `README.md`, `docs/DAT.md` et
  `docs/CloudWorker.md` donnent la commande par service.
- **Garde** : `scripts/verify-noms-conteneurs.sh` fait échouer la série dès qu'un nom `p2enjoy-<service>` littéral
  réapparaît dans un fichier suivi. Ses exceptions sont nommées : les fichiers que seule la production exécute ou
  décrit (`docker-compose.prod.yml`, `docker-compose.spark.yml`, `runProd.sh`, `scripts/spark/*`,
  `scripts/lib/connecteur-mcp.sh`), les états simulés de `verifier.sh` dans `scripts/verify-controles-connecteur.sh`,
  les appels `conteneur_en_marche … p2enjoy-…`, le chemin `/var/lib/p2enjoy-mail-sync`, et les documents. Elle est
  éprouvée par deux mutations et un témoin.
- **Hors des noms** : `P2ENJOY_TMP` remplace les chemins `/tmp/p2enjoy-*` des harnais (T4). `pkill -f "[v]ite"`
  devient l'arrêt du **seul** processus qui écoute sur le `WEBAPP_PREVIEW_PORT` de l'emplacement.

### 6 bis. La production et la cellule Spark gardent leurs noms (décision 702, option A)

Les neuf `container_name` du fichier de base (`db`, `migrations-runner`, `rest`, `realtime`, `storage`, `functions`,
`kong`, `mail-sync`, `mcp`) passent dans `docker-compose.prod.yml` et dans `docker-compose.spark.yml`, qui gardent déjà
les leurs (`p2enjoy-caddy`, `p2enjoy-minio`, `p2enjoy-minio-createbucket`). Une production n'a qu'une pile : ses noms,
`scripts/spark/verifier.sh` et les gestes de `docs/PROD_MIGRATIONS.md` ne changent pas. La T2 le **prouve** : les noms
rendus par `docker compose … config` avec les fichiers de production, et avec ceux de la cellule, sont identiques
avant et après.

## 7. Ce qui reste partagé, et pourquoi c'est sans risque

- **Le démon et le cache d'images** : une image tirée sert toutes les piles, et c'est un gain.
- **`/etc/hosts` et `sso.localhost`** : une résolution de nom, sans état.
- **Les images construites** (`p2enjoy-crm-webapp`…) : elles prennent le nom du projet et sont donc distinctes.

## 8. Recyclage de VM

Le §2 mesure qu'une pile revient à moitié vivante. La vérification à l'usage (§4.3) la reconnaît par le `boot_id` et
**ne la mesure pas**. `./runDev.sh` la recompose avec les deux fichiers Compose (`docs/CloudWorker.md` §2.2 *bis*) et
rend `db` à la vie. Le `postmaster.pid` laissé par un arrêt brutal est l'affaire de PostgreSQL, qui le reconnaît
périmé au démarrage : ce sera vérifié en T5, pas supposé.

## 9. Preuves attendues

`scripts/verify-emplacements.sh` :
- deux attributions lancées en même temps reçoivent deux emplacements distincts ;
- une entrée portant un autre `boot_id` est reconnue « VM recyclée », et la mesure est refusée ;
- une entrée inactive depuis plus de 6 h est reprise, sa pile arrêtée, volumes conservés, la reprise consignée ;
- un port de l'emplacement pris par un tiers fait passer au suivant, et le motif le nomme ;
- deux sessions dans un même checkout : la seconde est refusée ;
- l'emplacement 0 rend un `.env` et des noms identiques à ceux d'avant l'unité ;
- **deux piles debout en même temps sur le même démon**, chacune passant `verify-stack.sh --rapide`. Une écriture faite
  dans l'une est absente de l'autre.

## 10. Tranches

| Tranche | Contenu |
|---|---|
| T1 | Mesures et cette spécification |
| T2 | **Plus aucun nom de conteneur en développement** (§6, §6 bis) : les 125 fichiers, l'alias de Realtime, le seed, la garde et sa mutation ; production et cellule inchangées, prouvées par `config` |
| T3 | Le registre et l'attribution (`scripts/lib/emplacement.sh`, `scripts/sessions.sh`), avec leurs preuves hors pile — après validation du §11 |
| T4 | Compose par emplacement (nom de projet, ports), `.env` par emplacement, realm Keycloak ; `runDev.sh`, `resetMe.sh`, `reconstruire_base_dev` ; `P2ENJOY_TMP` ; `docs/CloudWorker.md` |
| T5 | Deux piles simultanées ; VM recyclée simulée ; `README.md`, `docs/DAT.md` |

## 11. Points à valider par le responsable — VALIDÉS le 2026-10-25 (décision 705), les quatre selon la recommandation

1. **Le registre dans `/var/tmp/p2enjoy-crm/sessions/`** : il doit se trouver sur le système de fichiers que les
   sessions partagent, et le responsable connaît mieux que l'agent le chemin effectivement commun.
2. **Un checkout, une pile** : une seconde session dans le même checkout est refusée, et non isolée.
3. **Péremption à 6 heures d'inactivité**, comme les prises du backlog ; le `boot_id` seul ne périme pas.
4. **L'emplacement 0 reproduit l'existant** (noms, ports) : production, cellule Spark et postes à pile unique ne
   changent pas.
