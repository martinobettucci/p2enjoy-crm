# Spécification — Production sur la cellule Spark « crm »

Unité de backlog : `CRM-090` (voir `docs/BACKLOG.md`).
Documents liés : `docs/PROD-SERVER.md` (dossier de la cellule, source des faits imposés — **non
versionné**, il porte des adresses d'infrastructure ; le même texte est réécrit par le plan de contrôle
dans `/etc/spark/BRIEFING.md`),
`docs/DAT.md` §3.5 et §9, `docs/PROD_MIGRATIONS.md`, `docs/SPEC-auth.md` §10 (`CRM-091`, le SSO),
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
| 2 Gio de mémoire, 10 Gio de disque, 0,5 CPU garanti | Chaque service est borné ; les images pèsent 5,9 Go | S4, S9 |
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

### 3.3 Stockage objet : un MinIO interne

- Service `minio`, image `quay.io/minio/minio` à l'étiquette déjà épinglée par le développement
  (décision 569), **aucun port publié**, volume nommé `minio-data`, conteneur `p2enjoy-minio`.
- Service `minio-createbucket`, image `quay.io/minio/mc`, crée `GLOBAL_S3_BUCKET` s'il manque puis
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
- **ClamAV n'est pas déclaré dans la cellule.** Ses signatures exigent à elles seules plus de
  1 Gio. Le produit échoue **fermé** : une pièce jointe naît `pending` et ne devient `clean` que si
  ClamAV le dit (`docs/SPEC-mail-subsystem.md` §15.5) ; sans lui, aucune pièce jointe reçue n'est
  téléchargeable. C'est une limite de la cellule, écrite dans `README.md` §11.

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
| `API_EXTERNAL_URL`, `SUPABASE_PUBLIC_URL`, `SITE_URL`, `ADDITIONAL_REDIRECT_URLS` | `https://crm.lelabs.tech` | dérivées du domaine |
| `SPARK_HTTP_PORT` | `8080` | constante, égale au port de la route |
| `ANON_KEY` | jeton `anon` signé par `JWT_SECRET` | dérivée ; **publique par construction**, elle entre dans le bundle |
| `SSO_OIDC_ISSUER` | `https://oauth.lelabs.tech/realms/lelabs` | `docs/SSO.md` |
| `SSO_OIDC_CLIENT_ID` | l'identifiant **réellement créé** par le realm | réponse à la déclaration, `docs/SPEC-auth.md` §10.8 |
| `SMTP_HOST`, `SMTP_PORT` | relais d'envoi, port de repli ouvert | proposés par `proposer.sh --smtp-hote --smtp-port`, sinon demandés ; la Forge ferme `25`, `465` et `587` en sortie, et le script refuse de les proposer |
| `SMTP_ADMIN_EMAIL` | expéditeur sur un domaine vérifié chez le relais | proposé par `--smtp-expediteur`, sinon demandé |

**Secrets** — `/run/spark/secrets` :

| Secret | Origine |
|---|---|
| `POSTGRES_PASSWORD`, `JWT_SECRET`, `SECRET_KEY_BASE`, `REALTIME_DB_ENC_KEY`, `MAIL_SYNC_INTERNAL_TOKEN`, `MINIO_ROOT_USER`, `MINIO_ROOT_PASSWORD`, `S3_PROTOCOL_ACCESS_KEY_ID`, `S3_PROTOCOL_ACCESS_KEY_SECRET` | **tirés dans la cellule** par `scripts/spark/proposer.sh`, aux longueurs de `env_bootstrap_dev` |
| `SERVICE_ROLE_KEY` | dérivé de `JWT_SECRET` par le même script |
| `SMTP_USER`, `SMTP_PASS` | **demandés vides** : seul le titulaire du relais les connaît. Facultatifs au regard des gardes : sans eux, la pile démarre et seuls les courriels transactionnels échouent |

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
- `--route-seule` ne propose que la route, sans toucher aux variables ni aux secrets : c'est la
  seule proposition encore possible quand des secrets sont en service. Mêmes refus sur une
  proposition de route pendante.

## 5. Livrer

### 5.1 Depuis le poste : `scripts/spark/livrer.sh`

1. Refuse un arbre de travail modifié et un `HEAD` absent d'`origin/main` : la cellule exécute du
   code **poussé**, jamais un état local. La cellule est jointe par un **alias `ssh`**,
   `SPARK_SSH_HOTE` (`crm` par défaut), que le poste définit selon le fragment `ssh_config` du
   dossier de cellule : aucune adresse n'entre au dépôt.
2. Relit dans la cellule les variables **publiques** du build — `API_EXTERNAL_URL`, `ANON_KEY`,
   `SSO_OIDC_ISSUER`, `SSO_OIDC_CLIENT_ID` — depuis `/etc/spark/env`, et refuse si l'une manque.
3. Construit la webapp **sur le poste** avec ces valeurs (`VITE_SUPABASE_URL`,
   `VITE_SUPABASE_ANON_KEY`, `VITE_SSO_ISSUER`, `VITE_SSO_CLIENT_ID`).
4. Transfère `git archive HEAD` et `webapp/dist`, puis les extrait **par-dessus** `/srv/crm`. Les
   données (`supabase/docker/volumes/db/data`) ne sont pas dans l'archive et ne sont jamais touchées.
5. Écrit `REVISION` (le condensé du commit livré) dans `/srv/crm`.
6. Lance `./runProd.sh --spark` dans la cellule.

`git diff --diff-filter=D` entre la révision déployée et `HEAD` doit être vide : une extraction
par-dessus ne retire pas un fichier supprimé. Le script le vérifie et refuse sinon.

### 5.2 Le premier déploiement : `--premier-deploiement`

La fenêtre de migration exige la confirmation d'un instantané de VM (décision 489). Sur une base
vierge, rien n'est à protéger, mais **affirmer** l'instantané serait faux.

**RÉVISÉ par la mesure avant livraison (décision 570).** La première rédaction exigeait « que la pile
soit démarrée ». Mesuré sur l'assemblage de la cellule : sur une base vierge, la pile entière **ne
démarre pas** — PostgREST ne charge pas son cache de schéma tant que le schéma `app` de la
migration 1 n'existe pas, reste `unhealthy`, et `mail-sync` qui en dépend ne démarre jamais. La
séquence documentée jusqu'ici, `./runProd.sh` puis `./runProd.sh --migrate`, échouait donc à sa
première étape. `./runProd.sh [--spark] --migrate --premier-deploiement` :

1. ne démarre que `db`, `auth` et `storage` — les dépendances du runner — et ce qu'eux exigent ;
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
| Importer variables et secrets proposés, **puis fournir** les valeurs SMTP | propriétaire du Spark | S6 ; seule la console écrit |
| Déclarer le client OIDC | administrateur du realm `lelabs` | `docs/SPEC-auth.md` §10.8 |
| Créer le premier compte et le premier espace | opérateur, sur instruction explicite | `scripts/spark/amorcer-espace.sh` (décision 573) : compte invité par `generate_link` — sans mot de passe, donc hors du chemin que la décision 265 encadre —, espace, appartenance `admin` ; le lien d'action n'est jamais affiché |

## 7. Vérifications

En plus du §5 de `docs/PROD_MIGRATIONS.md`. Les points 1 à 6 et la sonde du client OIDC sont
exécutés, en lecture seule, par `scripts/spark/verifier.sh`, qui distingue un échec d'un contrôle
« en attente » d'un geste extérieur :

1. `cat /srv/crm/REVISION` rend le commit livré.
2. Tous les conteneurs sont `healthy` ; `docker stats --no-stream` reste sous les limites du §8.
3. Depuis la cellule : `curl -fsS http://127.0.0.1:8080/auth/v1/health -H "apikey: $ANON_KEY"` rend
   `200`, et `http://127.0.0.1:8080/` rend l'`index.html` de la webapp.
4. Aucun port n'est publié hors `SPARK_HTTP_PORT` : `docker ps --format '{{.Ports}}'`.
5. La route active de `/etc/spark/routes` est en **`tls`** (décision 576) — une route `clair` n'est
   publiée qu'en `http://` ; puis, depuis Internet : `https://crm.lelabs.tech/` charge
   l'application, **sans** l'écran « Configuration incomplète ».
6. `df -h /` laisse au moins 2 Gio libres après le premier déploiement.

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
| `functions` | 23 Mio | 23 Mio | 256 Mio |
| `caddy` | 13 Mio | 15 Mio | 128 Mio |
| `auth-templates` | 12 Mio | 12 Mio | 64 Mio |
| `auth` | 10 Mio | 13 Mio | 128 Mio |
| **Pile** | **≈ 1 060 Mio** | **≈ 940 Mio** | — |

`migrations-runner` (128 Mio) et `minio-createbucket` (64 Mio) ne vivent que le temps de leur
passage. Les limites valent environ le double de l'empreinte, arrondi : ce sont des **plafonds**, et
leur somme dépasse volontairement les 2 Gio (§3.4). La marge réelle est celle qui reste au démon
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
| Harnais dédié `scripts/verify-spark.sh` | amorçage d'un espace contre la pile de développement (création, idempotence, compte invité, lien jamais affiché, profil `dev` refusé) ; image Realtime dérivée cohérente avec l'assemblage commun et avec `livrer.sh`, construite puis inspectée — aucune entrée de couche ni aucun compte cible du `sudo` de `run.sh` au-delà de l'identifiant 64534, `/app` à `nobody`, configuration d'exécution identique à l'origine ; fusion (ordre des sources, apostrophes, `$` littéral, grammaire, fichiers absents, `tmpfs` en `600`) ; gardes (profil, `APPLY_MIGRATIONS`, `CHANGE_ME_*`) ; `--premier-deploiement` refusé sans `--migrate` ; assemblage résolu : seul `SPARK_HTTP_PORT` publié, ni `80` ni `443`, aucun port pour `minio`, `sans-objet-cellule-spark` absent, `KONG_NGINX_WORKER_PROCESSES=1`, une limite mémoire sur chaque service ; `proposer.sh` sur des fichiers jetables — refus si `JWT_SECRET` existe, refus sur proposition pendante, aucune valeur de secret sur sa sortie ; témoin de non-complaisance par dégradation |
| Intégration réelle | l'assemblage de la cellule démarré sur ce poste avec des secrets jetables, sous le même projet Compose isolé : tous les services sains, `--premier-deploiement` appliquant les migrations sur base vierge puis refusant sur base peuplée |
| Déploiement | §7, exécuté dans la cellule et relevé dans `docs/PROD_MIGRATIONS.md` |

## 10. Hors périmètre

- **L'ouverture publique** : elle attend la route et le DNS du §6, qu'aucun code ne peut poser.
- **Les sauvegardes hors site depuis la cellule** : `age` n'y est pas installé (S5) et
  `scripts/backup.sh` le refuse sans repli. Sa mise en place appartient à l'exploitation de
  `CRM-080` et exige un paquet que seul `root` installe.
- **ClamAV** : §3.4.
