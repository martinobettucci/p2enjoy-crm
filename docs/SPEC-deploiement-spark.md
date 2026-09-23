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
| `SMTP_HOST`, `SMTP_PORT` | relais d'envoi, port de repli ouvert | à fournir ; la Forge ferme `25`, `465` et `587` en sortie |
| `SMTP_ADMIN_EMAIL` | expéditeur sur un domaine vérifié chez le relais | à fournir |

**Secrets** — `/run/spark/secrets` :

| Secret | Origine |
|---|---|
| `POSTGRES_PASSWORD`, `JWT_SECRET`, `SECRET_KEY_BASE`, `REALTIME_DB_ENC_KEY`, `MAIL_SYNC_INTERNAL_TOKEN`, `MINIO_ROOT_USER`, `MINIO_ROOT_PASSWORD`, `S3_PROTOCOL_ACCESS_KEY_ID`, `S3_PROTOCOL_ACCESS_KEY_SECRET` | **tirés dans la cellule** par `scripts/spark/proposer.sh`, aux longueurs de `env_bootstrap_dev` |
| `SERVICE_ROLE_KEY` | dérivé de `JWT_SECRET` par le même script |
| `SMTP_USER`, `SMTP_PASS` | **demandés vides** : seul le titulaire du relais les connaît |

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
- La route proposée est `crm.lelabs.tech 8080 clair`, dans la grammaire du fichier.

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
vierge, rien n'est à protéger, mais **affirmer** l'instantané serait faux. `./runProd.sh --spark
--migrate --premier-deploiement` :

- exige que la pile soit démarrée ;
- **mesure** `select count(*) from pg_tables where schemaname = 'public'` dans `p2enjoy-db` ;
- migre sans confirmation d'instantané **si et seulement si** le compte vaut `0` ;
- refuse sinon, en rendant le compte et en renvoyant vers `--migrate --instantane-verifie`.

L'option n'est acceptée qu'avec `--migrate`, et elle ne relâche aucune autre garde.

## 6. Ce qui n'appartient pas au dépôt

| Geste | Qui | Pourquoi |
|---|---|---|
| Créer `/srv/crm` et le confier à `spark-docker` | `root` de la cellule | S7 ; une seule fois |
| Enregistrement DNS `crm.lelabs.tech` vers la Forge, et route `crm.lelabs.tech 8080 clair` | propriétaire du Spark | S8 ; « rien ne s'expose depuis l'intérieur » |
| Importer variables et secrets proposés, **puis fournir** les valeurs SMTP | propriétaire du Spark | S6 ; seule la console écrit |
| Déclarer le client OIDC | administrateur du realm `lelabs` | `docs/SPEC-auth.md` §10.8 |
| Créer le premier compte et le premier espace | opérateur disposant de la clé de service | `docs/PROD_MIGRATIONS.md` §7 : chemin d'exploitation encadré |

## 7. Vérifications

En plus du §5 de `docs/PROD_MIGRATIONS.md` :

1. `cat /srv/crm/REVISION` rend le commit livré.
2. Tous les conteneurs sont `healthy` ; `docker stats --no-stream` reste sous les limites du §8.
3. Depuis la cellule : `curl -fsS http://127.0.0.1:8080/auth/v1/health -H "apikey: $ANON_KEY"` rend
   `200`, et `http://127.0.0.1:8080/` rend l'`index.html` de la webapp.
4. Aucun port n'est publié hors `SPARK_HTTP_PORT` : `docker ps --format '{{.Ports}}'`.
5. Depuis Internet, une fois la route posée : `https://crm.lelabs.tech/` charge l'application,
   **sans** l'écran « Configuration incomplète ».
6. `df -h /` laisse au moins 2 Gio libres après le premier déploiement.

## 8. Capacité — mesures

*À mesurer dans le même changement que le code (règle : la spécification précède le code, la mesure
précède les chiffres).* Le tableau rendra, par service, la mémoire au repos puis sous le parcours de
connexion, la limite retenue et sa marge, ainsi que l'occupation disque des images et des volumes.

## 9. Preuves exigées

| Niveau | Preuve |
|---|---|
| Harnais dédié `scripts/verify-spark.sh` | fusion (ordre des sources, apostrophes, `$` littéral, grammaire, fichiers absents, `tmpfs` en `600`) ; gardes (profil, `APPLY_MIGRATIONS`, `CHANGE_ME_*`) ; `--premier-deploiement` refusé sans `--migrate` ; assemblage résolu : seul `SPARK_HTTP_PORT` publié, ni `80` ni `443`, aucun port pour `minio`, `sans-objet-cellule-spark` absent, `KONG_NGINX_WORKER_PROCESSES=1`, une limite mémoire sur chaque service ; `proposer.sh` sur des fichiers jetables — refus si `JWT_SECRET` existe, refus sur proposition pendante, aucune valeur de secret sur sa sortie ; témoin de non-complaisance par dégradation |
| Intégration réelle | l'assemblage de la cellule démarré sur ce poste avec des secrets jetables, sous le même projet Compose isolé : tous les services sains, `--premier-deploiement` appliquant les migrations sur base vierge puis refusant sur base peuplée |
| Déploiement | §7, exécuté dans la cellule et relevé dans `docs/PROD_MIGRATIONS.md` |

## 10. Hors périmètre

- **L'ouverture publique** : elle attend la route et le DNS du §6, qu'aucun code ne peut poser.
- **Les sauvegardes hors site depuis la cellule** : `age` n'y est pas installé (S5) et
  `scripts/backup.sh` le refuse sans repli. Sa mise en place appartient à l'exploitation de
  `CRM-080` et exige un paquet que seul `root` installe.
- **ClamAV** : §3.4.
