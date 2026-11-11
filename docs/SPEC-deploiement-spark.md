# Spécification — Production sur la cellule Spark « crm »

Unité de backlog : `CRM-090` (voir `docs/BACKLOG.md`).
Documents liés : `docs/PROD-SERVER.md` (dossier de la cellule, source des faits imposés — **non
versionné**, il porte des adresses d'infrastructure ; le même texte est réécrit par le plan de contrôle
dans `/etc/spark/BRIEFING.md`),
`docs/DAT.md` §3.5 et §9, `docs/PROD_MIGRATIONS.md`, `docs/SPEC-session-sso.md` (`CRM-092`, le SSO seule identité),
`docs/JOURNAL.md` décisions 567 et 569.

Écrite le 2026-09-23 **après mesure dans la cellule**, en lecture seule, et **avant la première ligne
de code**. Chaque fait porte le numéro de sa mesure dans la décision 567 (`S1` à `S9`).

---

## 1. Objet

La production du CRM n'a jamais été déployée (`docs/PROD_MIGRATIONS.md` §1). Sa cible est désormais
connue : la cellule `crm` d'une Forge, pilotée par un plan de contrôle. Cette unité adapte
l'assemblage de production à ce que la cellule impose, outille la livraison, et mène le premier
déploiement jusqu'à la vérification.

Elle **ne change aucun comportement du produit**. Tout ce qu'elle ajoute est de l'exploitation :
un fichier Compose, un Caddyfile, une option de `./runProd.sh`, deux scripts de cellule et leur
harnais.

## 2. Ce que la cellule impose

| Fait | Conséquence pour la pile | Mesure |
|---|---|---|
| Docker rootless, compte `spark-docker` | La pile s'exécute sous ce compte ; `root` ne sert qu'à créer `/srv/crm` | S2, S7 |
| Aucun port sous 1024 | Ni `80` ni `443` : Caddy écoute `8080` | S3 |
| La Forge termine TLS et fait suivre une **route** vers un port de la cellule | Caddy sert **en clair**, sans ACME ; la route se **propose**, elle ne se pose pas | `docs/PROD-SERVER.md` §6, §8 |
| Variables dans `/etc/spark/env`, secrets dans `/run/spark/secrets`, **posés par la console seulement** | Aucun `.env` n'est écrit sur l'hôte ; la pile lit ces deux fichiers | S6, `docs/PROD-SERVER.md` §5 |
| `/run` est un `tmpfs` | Après un redémarrage, les secrets reviennent quand le plan de contrôle les repose ; les conteneurs, eux, repartent avec leur configuration enregistrée | `docs/PROD-SERVER.md` §8 |
| 2 Gio de mémoire, 10 Gio de disque, 0,5 CPU garanti — *16 384 Mo et 8 cœurs depuis le 2026-11-10 (décision 889, ajout daté)* | Chaque service est borné ; les images pèsent 5,9 Go | S4, S9 |
| Ni Node, ni `jq`, ni `age` | La webapp se construit sur le poste qui livre ; les scripts de cellule n'emploient que `sh`, `python3` et `openssl` | S5 |
| `nproc` et `free` décrivent la Forge | Aucun service ne dimensionne ses processus sur `nproc` sans borne explicite | `docs/PROD-SERVER.md` §3 |

## 3. L'assemblage de la cellule

### 3.1 Trois fichiers, dans cet ordre

```
docker-compose.yml  +  docker-compose.prod.yml  +  docker-compose.spark.yml
```

Le troisième ne contient **que les différences** de la cellule. L'assemblage de production générique
reste intact et utilisable sur un hôte qui dispose de `80` et `443`. `scripts/lib/env.sh` déclare le
tableau `SPARK_COMPOSE` ; aucun appel ne compose ces fichiers à la main.

### 3.2 Caddy en clair

- Caddy écoute `:8080` dans le conteneur, publié sur `SPARK_HTTP_PORT` (`8080` par défaut), et rien
  d'autre. Les publications `80`, `443` et `443/udp` de l'overlay de production sont **réinitialisées**.
- `auto_https off` : la Forge porte le certificat. Aucun volume d'ACME n'est employé.
- `trusted_proxies static private_ranges` : la Forge joint la cellule par le réseau privé, et
  `X-Forwarded-Proto: https` qu'elle pose est conservé jusqu'à Kong.
- Les routes — API vers Kong, application monopage, en-têtes de sécurité — sont extraites dans
  **`caddy/routes.caddy`**, importé par `caddy/Caddyfile` (production générique) et
  `caddy/Caddyfile.spark` (cellule). Deux copies auraient divergé au premier ajout.
- **`/functions/v1/*` rejoint les préfixes relayés.** `docs/PROD_MIGRATIONS.md` §5.10 exige que
  `POST /functions/v1/example` traverse Kong, et Kong déclare cette route depuis `CRM-016` ; le
  Caddyfile ne la relayait pas, ce qui aurait fait échouer cette vérification au premier déploiement.
- **Le connecteur MCP est aiguillé par l'hôte** (`CRM-102` T3, `docs/SPEC-mcp.md` §2.2). La Forge fait suivre la seconde
  route, `crm.mcp.lelabs.tech 8080 tls`, vers le même port que celle du CRM ; le site `:8080` reçoit donc les deux
  hôtes, et un matcher en tête de `routes.caddy` relaie celui du connecteur vers `mcp:8080`, chemins intacts. Caddy
  reçoit pour cela une seule variable, `MCP_HOTE` — un nom d'hôte public, jamais un secret —, dérivée de
  `CRM_MCP_HOTE` et valant `mcp.invalid` tant que le connecteur est éteint : un matcher vide ferait refuser à Caddy sa
  configuration entière. Le service `mcp` n'est assemblé que sous le profil `mcp`, que `compose_prod` active quand
  `CRM_MCP_HOTE` est posée ; `scripts/verify-spark.sh` résout la cellule dans les deux états.

### 3.2 bis Le cache de la webapp — `CRM-145` (décision 899)

*Écrit le 2026-11-10, avant le code.* **Le constat** : `caddy/routes.caddy` ne posait aucun `Cache-Control` sur la webapp ;
un navigateur gardait `index.html` par heuristique (seuls `ETag` et `Last-Modified`), donc l'ancien bundle, des heures après
une livraison. **La règle**, dans `caddy/routes.caddy`, donc commune aux deux Caddyfile :

| Ce qui est servi | `Cache-Control` | Pourquoi |
|---|---|---|
| un fichier **existant** de `/assets/` | `public, max-age=31536000, immutable` | son nom porte le hachage du build Vite : un contenu nouveau a un nom nouveau |
| `index.html`, toute route de l'application (repli `try_files`), un `/assets/` **absent** | `no-cache` | revalidé à chaque chargement par `ETag` (un `304` sans corps) : la livraison est vue au prochain chargement |
| les autres fichiers de `/srv/www` (`favicon.svg`, `avatars/`) | `no-cache` | sans hachage dans le nom, ils doivent être revalidés ; le manuel publié est dans le bundle |

**Un `/assets/` absent n'est jamais immuable** : l'ancien bundle d'une page restée ouverte retombe sur `index.html`, qui ne
doit pas être figé un an — d'où le matcher `file`, qui exige que le fichier existe. Les routes relayées (`/rest/v1/*`…, le
connecteur MCP) et le `404` de GoTrue ne reçoivent aucune règle nouvelle ; les en-têtes de sécurité sont inchangés.
Le label `com.p2enjoy.caddy-routes-revision` passe à **`crm-145`** (§5.1) : Caddy est recréé au `up` ordinaire.
**Preuve** : `scripts/verify-spark.sh` §4 lance un Caddy jetable avec `Caddyfile.spark` et `routes.caddy` sur un `/srv/www`
de démonstration et lit les en-têtes réels (`/`, `/index.html`, une route profonde, un fichier haché, un fichier absent de
`/assets/`, `favicon.svg`, un `304`). En développement, la webapp est servie par Vite, sans Caddy : la preuve porte sur la
configuration de la cellule, la seule qui serve la production. **Connecteur MCP** : non (décision 899).

### 3.3 Stockage objet : un MinIO interne

- Service `minio`, image `cgr.dev/chainguard/minio` **épinglée par empreinte**, la même que le développement
  (décision 681 ; avant elle, `quay.io/minio/minio`, décision 569, que `quay.io` ne sert plus — INC-290), en
  `user: "0:0"` comme l'image qu'elle remplace : le volume existant appartient à `root`. **Aucun port publié**, volume
  nommé `minio-data`, conteneur `p2enjoy-minio`.
- Service `minio-createbucket`, **la même image** (elle porte `mc` et `/bin/sh`), crée `GLOBAL_S3_BUCKET` s'il manque puis
  se termine ; `storage` en dépend.
- `storage` vise `http://minio:9000` avec `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD`, exactement comme
  l'overlay de développement.
- **Motif** (décision 567, point 2) : `scripts/backup.sh` n'emporte les objets que si
  `p2enjoy-minio` tourne ; c'est le seul mode où la sauvegarde couvre les pièces jointes sans
  dépendre d'un fournisseur.

### 3.4 Mémoire

- `KONG_NGINX_WORKER_PROCESSES=1`.
- Une limite `mem_limit` par service, chiffrée au §8 après mesure. Une limite rend la défaillance
  **localisée et nommée** : sans elle, le premier service qui déborde fait tuer par le noyau un
  voisin quelconque de la cellule.
- **ClamAV est déclaré dans la cellule** (`CRM-143` T3, décision 889 et son ajout du 2026-11-10 ; `docs/SPEC-pieces-jointes.md` §17.6). La cellule compte désormais **16 384 Mo et 8 cœurs**. `docker-compose.spark.yml` pose le service `clamav` : image épinglée `clamav/clamav:1.4.3`, `mem_limit` **4 Go**, aucun port publié, signatures dans le volume `clamav-data`, contrôle de santé `clamdcheck.sh` avec `start_period` 120 s, le temps du premier téléchargement. Le plafond vaut plus du double du pic mesuré en développement (§8). `mail-sync` le joint par `CLAMAV_HOST=clamav`, déjà posée par l'assemblage commun. Le produit échoue toujours **fermé** : sans ClamAV, une pièce reçue naît `skipped` (`scanner_unavailable`), ne se télécharge qu'après la confirmation de chaque personne, et la reprise de `mail-sync` l'analyse dès que ClamAV répond (`docs/SPEC-pieces-jointes.md` §17.3 à §17.5). *Avant `CRM-143`, ClamAV n'était pas déclaré : ses signatures dépassaient à elles seules la marge de la cellule de 2 Gio, et aucune pièce reçue n'était téléchargeable.*
- **Les signatures viennent de `freshclam`**, depuis la cellule. Le réseau de diffusion filtre `curl` en `403` (mesuré le 2026-11-10) : seul un conteneur `freshclam` jetable prouve l'accès, avant tout démarrage (`docs/PROD_MIGRATIONS.md` §2.35, geste 1). S'il est refusé, le recours est une décision du responsable : un miroir privé, ou des signatures déposées avec l'image.

### 3.5 Realtime : une image dérivée, construite sur le poste

**Ajouté par la mesure dans la cellule (décisions 571 et 575).** La cellule ne dispose que de 65 536 UID, et
`spark-docker` n'en reçoit que 64 534 comme subordonnés : un fichier d'image possédé par un UID
supérieur à 64534 n'y est pas extractible. `supabase/realtime:v2.102.3` en porte 3 774, attribués à
`nobody`, et son tirage échoue.

- Son `run.sh` lance aussi ses migrations par `sudo -E -u nobody` : même extraite, l'image
  redémarrait en boucle, `setgid(65534)` étant refusé dans la cellule (décision 575).
- `supabase/docker/realtime-spark/Dockerfile` renumérote `nobody` et `nogroup` de 65534 en
  **64000**, rend à `nobody` les fichiers qu'il possédait, recopie le système de fichiers dans
  **une seule couche** et redéclare la configuration d'exécution à l'identique. Rien d'autre ne
  change : mêmes comptes, mêmes droits, même démarrage.
- L'image est **construite sur le poste** et chargée dans la cellule par `scripts/spark/livrer.sh`,
  seulement si son **contenu** y diffère — couches et configuration d'exécution. Pas son
  identifiant : deux constructions au contenu égal en rendent deux différents (décision 577).
  L'overlay la déclare `pull_policy: never`.
- Une montée de version de Realtime dans l'assemblage commun impose la même montée dans la
  dérivée ; `scripts/verify-spark.sh` rougit sinon.

**MinIO, de même (INC-329, décision 794).** L'image de Chainguard qu'épingle le développement
(décision 681) attribue `/home/nonroot` à `nonroot` (65532), et son tirage échoue dans la cellule
(mesuré le 2026-11-01). Elle n'a ni `find` ni `sed` :
`supabase/docker/minio-spark/Dockerfile` renumérote donc `nonroot` en **64532** sur une copie de sa
racine, dans une étape utilitaire Alpine épinglée, puis recopie le résultat en **une seule couche**
avec la configuration d'exécution de la source. Les deux services, `minio` et `minio-createbucket`,
emploient l'étiquette `p2enjoy/minio-spark:RELEASE.2026-10-23T20-06-51Z` en `pull_policy: never`.
`scripts/spark/livrer.sh` la construit et la transfère comme celle de Realtime. Le
`scripts/verify-spark.sh` §4 prouve son point de départ, l'empreinte de `docker-compose.dev.yml`, et
l'absence de tout identifiant hors de la plage ; il démarre aussi le serveur et crée un bucket.

## 4. Les variables

### 4.1 D'où elles viennent

`./runProd.sh --spark` construit l'environnement de la pile dans cet ordre, la dernière source
l'emportant :

1. le gabarit `.env.example`, pour les valeurs non secrètes qui ne varient pas d'un environnement à
   l'autre (`POSTGRES_PORT`, `JWT_EXPIRY`, `PASSWORD_MIN_LENGTH`…) ;
2. `/etc/spark/env` ;
3. `/run/spark/secrets`.

Le résultat est écrit dans `$XDG_RUNTIME_DIR/p2enjoy-crm/spark.env` — un `tmpfs` propre au compte,
mode `600` —, puis **validé par les gardes existantes** : `env_validate` (aucune valeur
`CHANGE_ME_*`, aucune obligatoire vide), profil `prod` exigé, `APPLY_MIGRATIONS=false` exigé. Un
secret qui n'a pas été importé laisse donc la valeur `CHANGE_ME_*` du gabarit, et **le démarrage est
refusé en nommant la variable**. Rien n'est inventé.

Les chemins se surchargent par `SPARK_ENV_FILE`, `SPARK_SECRETS_FILE` et `P2ENJOY_SPARK_RUNTIME_DIR`,
pour que le harnais travaille sur des fichiers jetables.

**Refus explicites** : fichier de variables ou de secrets absent — cas nominal juste après un
redémarrage de la cellule, avant que le plan de contrôle ait reposé `/run/spark/secrets` ; nom hors
grammaire ; valeur contenant une apostrophe (la valeur est réécrite entre apostrophes pour que `$`
reste littéral, comme la cellule l'énonce, et une apostrophe la casserait).

### 4.2 Les variables sans objet dans la cellule

Cinq variables du gabarit portent `CHANGE_ME_*` mais **ne sont consommées par aucun service de
l'assemblage de la cellule** : `PG_META_CRYPTO_KEY` et `STALWART_ADMIN_PASSWORD` (développement),
`AWS_ACCESS_KEY_ID` et `AWS_SECRET_ACCESS_KEY` (surchargées par MinIO, §3.3), `CADDY_ACME_EMAIL`
(pas d'ACME, §3.2). Exiger du propriétaire qu'il importe des valeurs de remplissage serait exiger
une fausse donnée. Lorsqu'elles sont absentes des deux fichiers injectés, la fusion leur donne la
valeur **`sans-objet-cellule-spark`**, et le harnais prouve que cette chaîne **n'apparaît nulle part**
dans la configuration résolue de l'assemblage (`docker compose config`). La liste est explicite et
le reste : une variable qui deviendrait consommée ferait rougir la preuve.

### 4.3 Répartition

**Variables** — `/etc/spark/env`, lisibles dans la cellule :

| Variable | Valeur | Origine |
|---|---|---|
| `P2ENJOY_ENV_PROFILE` | `prod` | constante |
| `APPLY_MIGRATIONS` | `false` | constante (décision 489) |
| `APP_DOMAIN` | `crm.lelabs.tech` | proposition, décision 567 |
| `API_EXTERNAL_URL`, `SUPABASE_PUBLIC_URL`, `SITE_URL` | `https://crm.lelabs.tech` | dérivées du domaine ; `ADDITIONAL_REDIRECT_URLS`, lue par GoTrue seul, est retirée par `CRM-092` T6 |
| `SPARK_HTTP_PORT` | `8080` | constante, égale au port de la route |
| `ANON_KEY` | jeton `anon` signé par `JWT_SECRET` | dérivée ; **publique par construction**, elle entre dans le bundle |
| `SSO_OIDC_ISSUER` | `https://oauth.lelabs.tech/realms/lelabs` | `docs/SSO.md` |
| `SSO_OIDC_CLIENT_ID` | l'identifiant **réellement créé** par le realm pour le client **confidentiel** — `lelabs-crm-serveur` déclaré | réponse à la déclaration, `docs/SPEC-session-sso.md` §12 |
| `OLLAMA_HOST`, `OLLAMA_MODEL`, `OLLAMA_CONTEXT_LENGTH` | l'URL `https://` du serveur Ollama de LeLabs ; `gemma4:e2b` ; `36864` | `--assistant-ia` (`CRM-097` T4, `docs/SPEC-ia.md` §3) ; facultatives — sans elles, l'assistant se déclare indisponible |

Les variables `SMTP_HOST`, `SMTP_PORT` et `SMTP_ADMIN_EMAIL` — relais des courriels transactionnels de
GoTrue — sont **retirées** par `CRM-092` T6 avec lui, ainsi que les options `--smtp-*` de
`proposer.sh`. Une cellule qui les porte encore les garde inertes : un import ne retire rien.

**Secrets** — `/run/spark/secrets` :

| Secret | Origine |
|---|---|
| `POSTGRES_PASSWORD`, `JWT_SECRET`, `SECRET_KEY_BASE`, `REALTIME_DB_ENC_KEY`, `MAIL_SYNC_INTERNAL_TOKEN`, `MINIO_ROOT_USER`, `MINIO_ROOT_PASSWORD`, `S3_PROTOCOL_ACCESS_KEY_ID`, `S3_PROTOCOL_ACCESS_KEY_SECRET` | **tirés dans la cellule** par `scripts/spark/proposer.sh`, aux longueurs de `env_bootstrap_dev` |
| `SERVICE_ROLE_KEY` | dérivé de `JWT_SECRET` par le même script |
| `OIDC_CLIENT_SECRET` | **demandé vide** (`CRM-092`, décision 586) : LeLabs l'émet et l'affiche une seule fois à l'administrateur du realm, qui le saisit lui-même. Remis au seul worker `session`. `SMTP_USER` et `SMTP_PASS` sont retirés avec GoTrue |
| `OLLAMA_API_KEY` | **demandé vide** par `--assistant-ia` (`CRM-097` T4) : la clé est liée par le serveur LLM à une plage d'adresses ; le propriétaire la saisit en console, et fait autoriser la plage de la cellule par LeLabs. Remise au seul worker `ia` |

### 4.4 Proposer, sans jamais appliquer

`scripts/spark/proposer.sh` s'exécute **dans la cellule**, sous `spark-docker`. Il écrit ses
propositions **sous** le bloc posé par le plan de contrôle dans `/etc/spark/env.?`,
`/run/spark/secrets.?` et `/etc/spark/routes.?`, une étiquette `#` au-dessus de chaque ligne.

- Les secrets sont tirés par `openssl` **dans la cellule** et n'en sortent que par la console : ils
  ne traversent ni ce dépôt, ni le poste qui livre, ni la sortie du script, qui n'affiche que des
  noms.
- **Refus** si `/run/spark/secrets` porte déjà `JWT_SECRET` : proposer de nouveaux secrets à une
  pile qui tourne invaliderait ses jetons et sa base. Une rotation est une autre opération.
- **Refus** si une proposition non tranchée existe déjà dans le fichier `.?` : écraser la demande
  d'autrui n'est pas proposer.
- La route proposée est `crm.lelabs.tech 8080 tls`, dans la grammaire du fichier. **Le mode dit ce
  que la Forge expose au public, non ce que la pile sert** — mesuré (décision 576) : une route
  `clair` est publiée en `http://` seul, et le SSO refuse toute URL de retour hors `https://`. Dans
  les deux modes, la Forge fait suivre en clair vers Caddy.
- `--route-seule` ne propose que la route, sans toucher aux variables ni aux secrets. Mêmes refus
  sur une proposition de route pendante.
- `--demandes-seules` (`CRM-092`, décision 590) **repose les demandes** à une cellule en service,
  sans tirer aucun secret : `SSO_OIDC_ISSUER` et `SSO_OIDC_CLIENT_ID` si la cellule ne les a pas à la
  valeur attendue, `OIDC_CLIENT_SECRET` en demande vide s'il manque ou est vide — un secret posé
  n'est jamais redemandé. Des fichiers réels, il ne lit que la présence d'un nom ; il n'affiche que des
  noms. Il nomme les variables retirées de la pile (GoTrue, `SMTP_*`) que la cellule porte encore,
  inertes : un import ne retire jamais rien. Avec `--route-seule`, c'est la seule proposition possible
  quand des secrets sont en service.
- `--assistant-ia --ollama-host https://…` (`CRM-097` T4, écrit le 2026-10-03 avant son code) propose l'assistant
  IA à une cellule **en service**, sans tirer aucun secret : `OLLAMA_HOST`, `OLLAMA_MODEL` (`gemma4:e2b`) et
  `OLLAMA_CONTEXT_LENGTH` (`36864`) si la cellule ne les porte pas à la valeur attendue, et `OLLAMA_API_KEY` en demande
  vide si elle manque ou est vide — une clé posée n'est jamais redemandée ni lue. `--ollama-host` est exigé et doit
  être une URL `https://` : une valeur qu'on ne peut pas deviner ne se propose pas vide. L'option exclut
  `--route-seule` et `--demandes-seules`, garde les mêmes refus sur une proposition pendante, et n'affiche que des
  noms. La proposition complète d'une cellule vierge ne porte pas l'assistant : il est facultatif, et l'URL du
  serveur n'y est pas connue.

## 5. Livrer

### 5.1 Depuis le poste : `scripts/spark/livrer.sh`

1. Refuse un arbre de travail modifié et un `HEAD` absent d'`origin/main` : la cellule exécute du
   code **poussé**, jamais un état local. **La cellule est jointe par ses adresses IP, jamais par un
   alias** (décision 603, règle du responsable) : `SPARK_SSH_HOTE` porte l'IP de la cellule et est
   **obligatoire** — un nom d'hôte y est refusé —, `SPARK_SSH_REBOND` porte `utilisateur@IP` du rebond,
   passé à `ssh -J`. Les deux valeurs viennent de la ligne `ssh -J` du §1 du dossier de cellule
   (`docs/PROD-SERVER.md`, non versionné) : aucune adresse n'entre au dépôt. `scripts/spark/verifier.sh`
   suit la même règle.
2. Relit dans la cellule les variables **publiques** du build — `API_EXTERNAL_URL`, `ANON_KEY`,
   `SSO_OIDC_ISSUER`, `SSO_OIDC_CLIENT_ID` — depuis `/etc/spark/env`, et refuse si l'une manque.
3. Construit la webapp **sur le poste** avec ces valeurs (`VITE_SUPABASE_URL`,
   `VITE_SUPABASE_ANON_KEY`, `VITE_SSO_ISSUER`, `VITE_SSO_CLIENT_ID`).
4. Transfère `git archive HEAD` et `webapp/dist`, puis les extrait **par-dessus** `/srv/crm`. Les
   données (`supabase/docker/volumes/db/data`) ne sont pas dans l'archive et ne sont jamais touchées.
5. Écrit `REVISION` (le condensé du commit livré) dans `/srv/crm`.
6. Lance `./runProd.sh --spark` dans la cellule.

Une extraction par-dessus ne retire pas un fichier supprimé : le script **retire dans la cellule**,
avant l'extraction, les fichiers que `git diff --diff-filter=D` nomme entre la révision déployée et
`HEAD`, et les liste (`CRM-092` T6 en supprime cinq : `scripts/verify-auth.sh` et les quatre gabarits de
`supabase/auth/templates/`).

**Kong et Caddy ne relisent pas leurs fichiers montés**, que l'extraction remplace sous les conteneurs
en service. Chacun porte donc un label de révision — `com.p2enjoy.kong-config-revision` et
`com.p2enjoy.caddy-routes-revision`, **`crm-092`** depuis le retrait de GoTrue pour Kong, et **`crm-145`** pour Caddy
depuis le `Cache-Control` de la webapp (§3.2 bis ; `crm-001` avant, pour le délai de maintien de ses connexions amont, `docs/DAT.md` §3.5 bis ; `crm-102` avant, pour l'aiguillage du
connecteur MCP, `docs/SPEC-mcp.md` §2.2) — que tout changement
de `kong.yml` ou de `caddy/routes.caddy` incrémente dans le même commit : Compose voit une définition
différente et recrée le conteneur au `up` ordinaire. `scripts/verify-spark.sh` exige les deux labels.

### 5.1 bis Livrer un condensé choisi, récupéré par git dans la cellule — `CRM-147` (décisions 905, 909, 911, 912 et 915)

*Écrit le 2026-11-11, avant le code.* **Le défaut** : le §5.1 livre toujours le `HEAD` du poste et bâtit la webapp dans son
arbre de travail ; une livraison emporte donc tout `main`, unités inachevées comprises. **La règle** : la session de
livraison **choisit un condensé** — le dernier commit d'un lot stable —, la cellule le **récupère elle-même par git**, avec
sa propre clé, et **tout** ce qui part vient de ce condensé : code, migrations, images, webapp, `REVISION`.

**Usage** : `scripts/spark/livrer.sh --revision <condensé> [-- options de runProd.sh]`. **Le condensé est obligatoire**
(décision 915) : sans lui, le script refuse avant tout geste. `--archive-seule` (§5.1, amorçage d'une cellule) reste à part.

**Sur le poste**, avant tout geste dans la cellule :
1. `git fetch origin`, puis le condensé est résolu en un commit (`git rev-parse --verify <condensé>^{commit}`) et doit être
   **contenu dans `origin/main`** (`git merge-base --is-ancestor`) : sinon, refus nommé. L'arbre de travail du poste n'est
   plus livré : il n'est plus exigé propre, et il n'est jamais lu pour la livraison.
2. Les images dérivées (Realtime, MinIO, §3.5) se bâtissent **depuis le condensé** : `git archive <condensé>` extrait dans
   un répertoire jetable du poste, jamais un worktree (`CLAUDE.md` §13), puis effacé.

**Dans la cellule, sous `spark-docker`** (jamais root, décision 909) :
1. **La clé d'hôte de GitHub est épinglée** dans `~/.ssh/known_hosts` (son empreinte publiée), et git s'y connecte en
   `StrictHostKeyChecking=yes` : le script **vérifie** l'épinglage (`ssh-keygen -F github.com`) et refuse s'il manque ; il
   ne l'écrit jamais lui-même. La clé de clonage (`~/.ssh/id_ed25519`, posée par le responsable, décision 912) n'est jamais
   lue, affichée ni journalisée : seules des commandes git la mettent en œuvre.
2. **`/srv/crm` est le clone** (décision 915). *La première fois*, s'il n'est pas un dépôt : `git init`, remote
   `git@github.com:martinobettucci/p2enjoy-crm.git`, `git fetch origin` ; les fichiers que le condensé a supprimés depuis la
   révision déployée (`REVISION`) sont retirés comme au §5.1 ; puis `git checkout --detach --force <condensé>`, qui remplace
   les fichiers suivis par ceux du condensé et **ne touche à aucun fichier non suivi**. *Les fois suivantes* : `git fetch
   origin`, condensé contenu dans `origin/main` (même contrôle que sur le poste), puis `git checkout --detach <condensé>`
   **sans** `--force` : un fichier suivi modifié dans la cellule fait refuser la livraison, et le script le nomme
   (`git status --porcelain --untracked-files=no`) au lieu de l'écraser.
3. **Les données ne sont jamais au dépôt** : avant tout `checkout`, le script vérifie que `supabase/docker/volumes/db/data`,
   `webapp/dist` et `REVISION` sont ignorés par git (`git check-ignore`) et refuse sinon. **Interdits** dans la cellule :
   `git clean`, `git reset --hard`, `git stash` — un dépôt de travail côtoie les données de la base.
4. **La webapp se bâtit dans la cellule** (décision 909), depuis le condensé extrait : un conteneur jetable de l'image du
   build (`node:24-alpine`, celle de `webapp/Dockerfile`), borné (`--memory 2g`, `--cpus 2`), lit le clone en lecture
   seule, installe les dépendances (`npm ci`) et bâtit avec les quatre variables publiques de `/etc/spark/env` (§5.1,
   point 2) ; le résultat remplace le **contenu** de `/srv/crm/webapp/dist` (Caddy en monte le répertoire). Le build
   demande **l'accès de la cellule au registre npm** : constaté par la session de livraison avant la première livraison
   par condensé ; s'il est refusé, le recours est une décision du responsable.
5. `REVISION` reçoit le condensé complet, puis `./runProd.sh --spark` est lancé, avec les options passées après `--`.

**Retour arrière** : `livrer.sh --revision <condensé antérieur>`. Les migrations ne se défont pas par ce geste : leur retour
arrière reste celui du contrat (`docs/PROD_MIGRATIONS.md`).

**Gestes préalables**, à la première livraison par condensé (`docs/PROD_MIGRATIONS.md`) : épingler la clé d'hôte de GitHub
pour `spark-docker` ; constater l'accès au registre npm depuis la cellule. **Connecteur MCP** : non (décision 905).

**Preuves** (`scripts/verify-spark.sh`, cellule simulée) : un dépôt nu local tient lieu d'`origin` ; une livraison d'un
condensé **ancien**, puis d'un **récent** (un fichier supprimé entre les deux est retiré, un fichier non suivi « de
données » est intact, `REVISION` vaut le condensé) ; refus sans `--revision`, pour un condensé absent d'`origin/main`, pour
un fichier suivi modifié dans la cellule, et pour une clé d'hôte non épinglée ; aucune commande `git clean`, `reset --hard`
ni `stash` dans le script.

### 5.2 Le premier déploiement : `--premier-deploiement`

La fenêtre de migration exige la confirmation d'un instantané de VM (décision 489). Sur une base
vierge, rien n'est à protéger, mais **affirmer** l'instantané serait faux.

**RÉVISÉ par la mesure avant livraison (décision 570).** La première rédaction exigeait « que la pile
soit démarrée ». Mesuré sur l'assemblage de la cellule : sur une base vierge, la pile entière **ne
démarre pas** — PostgREST ne charge pas son cache de schéma tant que le schéma `app` de la
migration 1 n'existe pas, reste `unhealthy`, et `mail-sync` qui en dépend ne démarre jamais. La
séquence documentée jusqu'ici, `./runProd.sh` puis `./runProd.sh --migrate`, échouait donc à sa
première étape. `./runProd.sh [--spark] --migrate --premier-deploiement` :

1. ne démarre que `db` et `storage` — les dépendances du runner — et ce qu'eux exigent (`auth` en
   faisait partie jusqu'au retrait de GoTrue, `CRM-092` T6) ;
2. **mesure** `select count(*) from pg_tables where schemaname = 'public'` dans `p2enjoy-db` ;
3. refuse si le compte n'est pas `0`, en le rendant et en renvoyant vers `--migrate
   --instantane-verifie` ;
4. applique les migrations sans confirmation d'instantané ;
5. **recrée PostgREST** : démarré sans schéma, il reste dans une boucle de reconnexion à intervalle
   croissant et n'entend pas le `notify` du runner — mesuré —, et Compose refuse aussitôt une
   dépendance déjà marquée malsaine ;
6. démarre la pile entière.

L'option n'est acceptée qu'avec `--migrate`, et elle ne relâche aucune autre garde. Elle vaut aussi
hors de la cellule : le défaut qu'elle corrige est celui de l'assemblage de production générique.

## 6. Ce qui n'appartient pas au dépôt

| Geste | Qui | Pourquoi |
|---|---|---|
| Créer `/srv/crm` et le confier à `spark-docker` | `root` de la cellule | S7 ; une seule fois |
| Enregistrement DNS `crm.lelabs.tech` vers la Forge, et route `crm.lelabs.tech 8080 tls` | propriétaire du Spark | S8 ; « rien ne s'expose depuis l'intérieur » |
| Importer variables et secrets proposés | propriétaire du Spark | S6 ; seule la console écrit |
| Déclarer le client OIDC **confidentiel** et saisir son secret | administrateur du realm `lelabs` | `docs/SPEC-session-sso.md` §12 (point 1) ; le secret ne transite par aucun dépôt ni message |
| Créer le premier espace et attendre son administrateur | opérateur, sur instruction explicite | `scripts/spark/amorcer-espace.sh` (décision 573, révisé par `CRM-092` T4) : espace, puis **attente** `admin` à l'adresse donnée ; aucun compte n'est créé dans le CRM — la personne devient administratrice à sa première connexion LeLabs, adresse vérifiée et rôle `verified` exigés |

## 7. Vérifications

En plus du §5 de `docs/PROD_MIGRATIONS.md`. Les points 1 à 7 et la sonde du client OIDC sont
exécutés, en lecture seule, par `scripts/spark/verifier.sh`, qui distingue un échec d'un contrôle
« en attente » d'un geste extérieur :

1. `cat /srv/crm/REVISION` rend le commit livré.
2. Tous les conteneurs sont `healthy` ; `docker stats --no-stream` reste sous les limites du §8.
3. Depuis la cellule : `http://127.0.0.1:8080/` rend l'`index.html` de la webapp ;
   `/auth/v1/health` rend **`404`** — GoTrue est retiré (`CRM-092` T6) ; `POST
   /functions/v1/session/prolonger` avec la clé anonyme rend **`204`** — l'échangeur répond, sans
   session (décision 587) ; et aucun conteneur `p2enjoy-auth` ni `p2enjoy-auth-templates` ne subsiste.
4. Aucun port n'est publié hors `SPARK_HTTP_PORT` : `docker ps --format '{{.Ports}}'`.
5. La route active de `/etc/spark/routes` est en **`tls`** (décision 576) — une route `clair` n'est
   publiée qu'en `http://` ; puis, depuis Internet : `https://crm.lelabs.tech/` charge
   l'application, **sans** l'écran « Configuration incomplète ».
6. `df -h /` laisse au moins 2 Gio libres après le premier déploiement.
7. **Le connecteur MCP** (`CRM-102` T5, décision 683 ; `docs/SPEC-mcp.md` §2.1, §2.2, §3.4, §11). Les contrôles faits
   à la main le 2026-10-21 (`docs/PROD_MIGRATIONS.md` §2.14, geste 5) sont portés dans `verifier.sh`, par la
   bibliothèque `scripts/lib/connecteur-mcp.sh`. `CRM_MCP_HOTE` et `SITE_URL` sont lues dans `/etc/spark/env` :
   - **`CRM_MCP_HOTE` vide** : le connecteur est éteint par choix, ce n'est ni un échec ni une attente. Le seul contrôle
     est qu'**aucun conteneur `p2enjoy-mcp`** ne subsiste — il garderait les secrets du connecteur ;
   - **`CRM_MCP_HOTE` posée** :
     1. un conteneur `p2enjoy-mcp` existe (sa santé est le contrôle 2, commun à tous les conteneurs) ;
     2. **depuis la cellule, par Caddy**, avec l'en-tête `Host: <CRM_MCP_HOTE>` : `GET /pret` rend `200` et
        `"pret": true`. L'aiguillage de Caddy est ainsi prouvé sans dépendre du DNS ;
     3. la route `<CRM_MCP_HOTE>` de `/etc/spark/routes` est en **`tls`** — même règle que pour l'application : une
        route `tls` seulement proposée est **en attente**, une route absente ou en `clair` est un **échec** ;
     4. si la route est en `tls` et que le nom résout, **par la route publique** `https://<CRM_MCP_HOTE>` :
        - `GET /pret` rend `200` et `"pret": true` ; sinon l'échec cite le début du corps, qui nomme le contrôle en
          défaut (`sso` ou `crm`) ;
        - `POST /mcp` sans jeton rend `401`, et l'en-tête `WWW-Authenticate` porte
          `resource_metadata="https://<CRM_MCP_HOTE>/.well-known/oauth-protected-resource/mcp"` ;
        - `POST /register` d'un client au retour non listé (`https://malveillant.exemple.test/cb`) rend `400` et
          `invalid_redirect_uri` : **rien n'est écrit** ;
        - `GET /plateforme` rend `302` vers `<SITE_URL>/plateforme` (`CRM-102` T6) ;

       sinon, une **attente** : DNS ou route à poser.
   - **Une seule tentative par contrôle**, bornée à 20 s comme les autres. Le relevé du 2026-10-21 a vu un premier
     `/pret` sans réponse quelques minutes après le démarrage : un échec ponctuel est rapporté tel quel, jamais masqué
     par une reprise.
   - **Compromis nommé** : l'enregistrement refusé passe par la garde d'entrée du connecteur, qui compte les
     enregistrements par adresse (`CRM_MCP_ENREGISTREMENTS_HEURE`, 20 par heure). Chaque exécution de `verifier.sh` en
     consomme donc un pour l'adresse du poste.
   - **Preuve** : `scripts/verify-controles-connecteur.sh`, contre le vrai service `mcp` de développement et une
     cellule simulée (faux `ssh` qui exécute localement, Caddy de la cellule réel), avec des contre-épreuves : origine,
     `SITE_URL` et hôte faux, serveur complaisant qui rend `200` à tout, port fermé, conteneur orphelin.

## 8. Capacité — mesures

Mesuré le 2026-09-23 sur ce poste, l'assemblage de la cellule démarré par
`--migrate --premier-deploiement` sur une base vierge (65 s, onze services sains), puis exercé par
Caddy : un compte créé, 40 connexions et 200 lectures REST — **240 réponses `200`** —, un objet de
5 Mo déposé puis relu par Storage. Aucun arrêt par manque de mémoire, aucun redémarrage.

| Service | Au repos | Après exercice | Limite retenue |
|---|---|---|---|
| `db` | 137 Mio | 102 Mio | 512 Mio |
| `storage` | 244 Mio | 163 Mio | 512 Mio |
| `realtime` | 237 Mio | 213 Mio | 448 Mio |
| `minio` | 219 Mio | 225 Mio | 448 Mio |
| `kong` (un processus) | 81 Mio | 84 Mio | 256 Mio |
| `rest` | 45 Mio | 45 Mio | 128 Mio |
| `mail-sync` | 43 Mio | 42 Mio | 256 Mio |
| `mcp` (`CRM-102`, profil `mcp`) | — | — | 256 Mio, **provisoire** : le plafond de `mail-sync`, son voisin Python, en attendant la mesure dans la cellule au premier allumage ; absent tant que `CRM_MCP_HOTE` n'est pas posée |
| `functions` | 23 Mio | 23 Mio | 256 Mio |
| `caddy` | 13 Mio | 15 Mio | 128 Mio |
| `clamav` (`CRM-143`) | 894 Mio, mesuré en développement le 2026-11-10 | pic de 1,51 à 1,80 Gio pendant trois rechargements des signatures | 4 Go ; **à relever dans la cellule** au premier démarrage (`docs/PROD_MIGRATIONS.md` §2.35, geste 6) |
| ~~`auth-templates`~~ | 12 Mio | 12 Mio | ~~64 Mio~~ — retiré (`CRM-092` T6) |
| ~~`auth`~~ | 10 Mio | 13 Mio | ~~128 Mio~~ — retiré (`CRM-092` T6) |
| **Pile** | **≈ 1 060 Mio** | **≈ 940 Mio** | — |

Mesure du 2026-09-23, avec GoTrue. Son retrait libère ≈ 22 Mio au repos et 192 Mio de plafonds ; la
pile compte désormais neuf services durables (onze conteneurs avec les deux passages uniques).

`migrations-runner` (128 Mio) et `minio-createbucket` (64 Mio) ne vivent que le temps de leur
passage. Les limites valent environ le double de l'empreinte, arrondi : ce sont des **plafonds**, et
leur somme dépasse volontairement les 2 Gio (§3.4) — *la cellule en compte 16 depuis le 2026-11-10 (§3.4, `CRM-143`)*. La marge réelle est celle qui reste au démon
rootless et au système de la cellule — environ 900 Mio —, **à relever dans la cellule** au premier
déploiement, `nproc` et `free` y décrivant la Forge.

**Disque — mesuré DANS la cellule le 2026-09-23.** Les tailles relevées sur le poste (5,9 Go pour
les images) surestimaient : dans la cellule, les onze images tirées ou chargées occupent **≈ 3,9 Go**
— `df -h /` passe de 827 Mo à **4,7 Go** utilisés, **5,8 Go libres**. Restent à y ajouter l'image
`mail-sync` construite sur place (≈ 207 Mo), l'archive livrée (64 Mo), puis la base, les objets et
les journaux. Le disque reste la ressource la plus rare de la cellule, et `df -h /` fait partie des
vérifications (§7).

## 9. Preuves exigées

| Niveau | Preuve |
|---|---|
| Harnais dédié `scripts/verify-spark.sh` | amorçage d'un espace contre la pile de développement (création, idempotence, compte invité, lien jamais affiché, profil `dev` refusé) ; image Realtime dérivée cohérente avec l'assemblage commun et avec `livrer.sh`, construite puis inspectée — aucune entrée de couche ni aucun compte cible du `sudo` de `run.sh` au-delà de l'identifiant 64534, `/app` à `nobody`, configuration d'exécution identique à l'origine ; fusion (ordre des sources, apostrophes, `$` littéral, grammaire, fichiers absents, `tmpfs` en `600`) ; gardes (profil, `APPLY_MIGRATIONS`, `CHANGE_ME_*`) ; `--premier-deploiement` refusé sans `--migrate` ; assemblage résolu : seul `SPARK_HTTP_PORT` publié, ni `80` ni `443`, aucun port pour `minio`, `sans-objet-cellule-spark` absent, `KONG_NGINX_WORKER_PROCESSES=1`, une limite mémoire sur chaque service ; `clamav` épinglé, ses signatures dans `clamav-data`, son contrôle de santé, et `mail-sync` qui le vise (`CRM-143` T3) ; `proposer.sh` sur des fichiers jetables — refus si `JWT_SECRET` existe, refus sur proposition pendante, aucune valeur de secret sur sa sortie ; témoin de non-complaisance par dégradation |
| Intégration réelle | l'assemblage de la cellule démarré sur ce poste avec des secrets jetables, sous le même projet Compose isolé : tous les services sains, `--premier-deploiement` appliquant les migrations sur base vierge puis refusant sur base peuplée |
| Déploiement | §7, exécuté dans la cellule et relevé dans `docs/PROD_MIGRATIONS.md` |

## 10. Hors périmètre

- **L'ouverture publique** : elle attend la route et le DNS du §6, qu'aucun code ne peut poser.
- **Les sauvegardes hors site depuis la cellule** : `age` n'y est pas installé (S5) et
  `scripts/backup.sh` le refuse sans repli. Sa mise en place appartient à l'exploitation de
  `CRM-080` et exige un paquet que seul `root` installe.
- ~~**ClamAV**~~ : déclaré dans la cellule par `CRM-143` T3 (§3.4).
