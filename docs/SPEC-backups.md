# Sauvegardes chiffrées et restauration prouvée — `CRM-080`

Contrat écrit **avant toute ligne de code** (`CLAUDE.md` §5, `docs/CloudWorker.md` §3.2 point 3),
après mesures prises sur la pile réelle démarrée et seedée le **2026-08-20**. Chaque paragraphe
intitulé « MESURÉ » rapporte une sortie obtenue sur cet hôte, jamais un souvenir.

Références amont, qui **précèdent** ce document et le contraignent :

- `docs/BACKLOG.md`, unité `CRM-080` — Definition of Done : « une preuve restaure réellement un
  snapshot, compare les invariants et détruit seulement l'environnement jetable ; runbook
  production, alertes et rotation documentés » ;
- `docs/DAT.md` §10 « Reprise et continuité », qui **annonce** la sauvegarde `pg_dump` planifiée et
  chiffrée, et qui nomme déjà la contrainte la plus dangereuse de ce sujet : la **clé racine de
  Vault vit hors de `PGDATA`**, si bien qu'une sauvegarde de la seule base ne restitue **aucun**
  secret de messagerie ;
- `docs/DAT.md` §8, qui décrit le chiffrement des secrets par pgsodium et le fichier
  `/etc/postgresql-custom/pgsodium_root.key`, porté par le volume `db-config` ;
- `CLAUDE.md` §9, qui interdit toute opération destructrice non validée et toute écriture de
  production non demandée : ce document ne décrit **aucune** commande qui touche une production
  sans instruction humaine ;
- `docs/SPEC-test-harness.md` §1 : « un harnais qui rend vert sans rien exercer est pire qu'une
  commande absente ».

---

## 1. Ce que l'unité couvre, et pourquoi elle est découpée en trois

L'énoncé de `CRM-080` tient en une phrase mais recouvre **trois** objets techniquement
indépendants, dont deux ne peuvent pas être écrits avant le premier :

1. **produire** une sauvegarde chiffrée et vérifiable ;
2. **la restaurer** dans un environnement jetable et **comparer les invariants** ;
3. **l'exploiter** : planification, rétention hors site, alertes, rotation des clés, runbook.

Le découpage suit cette dépendance, et chaque tranche est committée et prouvée avant la suivante
(`docs/CloudWorker.md` §3.2) :

| Tranche | Objet | Livrables |
|---|---|---|
| **1** | **La sauvegarde chiffrée** | `scripts/backup.sh`, ses variables d'environnement, son manifeste d'intégrité, sa rétention, son harnais `scripts/verify-sauvegardes.sh` |
| **2** | **La restauration prouvée** | `scripts/restore-drill.sh` : restauration dans une pile jetable, comparaison des invariants, destruction du **seul** environnement jetable |
| **3** | **L'exploitation** | runbook de production, planification, copie hors site, alertes, rotation des clés de chiffrement |

**Le présent document spécifie INTÉGRALEMENT la tranche 1.** Les tranches 2 et 3 sont **cadrées**
au §9 — ce qu'elles devront tenir, et les questions qu'elles auront à trancher — mais leur contrat
ligne à ligne sera écrit avant leur propre code, jamais deviné ici.

---

## 2. Mesures du 2026-08-20 — l'état réel de la pile

Toutes les commandes ci-dessous ont été exécutées sur la pile de développement montée par
`./runDev.sh` et seedée par `supabase/seed/apply-seed.sh`.

**M1. `pg_dump` est disponible DANS le conteneur de base, et à la bonne version.**

```
docker exec p2enjoy-db pg_dump --version   => pg_dump (PostgreSQL) 17.6
docker exec p2enjoy-db which pg_restore    => /usr/bin/pg_restore
```

Aucun client PostgreSQL n'est donc requis **sur l'hôte** : le format de l'archive et la version du
serveur ne peuvent pas diverger, puisque c'est le serveur lui-même qui produit le dump.

**M2. Le dump complet de la base seedée pèse 972 060 octets en format `custom`.**

```
docker exec p2enjoy-db pg_dump -U postgres -d postgres -Fc  => rc=0, 972 060 octets
docker exec -i p2enjoy-db pg_restore --list < base.dump
  => ; Archive created at 2026-08-20 05:21:20 UTC
     ;     dbname: postgres
```

L'authentification passe par le **socket local** du conteneur : aucun mot de passe n'est nécessaire,
donc aucun secret ne transite par une ligne de commande ni par une variable d'environnement.

**M3. La clé racine de Vault existe, elle pèse 64 octets, et elle est hors de `PGDATA`.**

```
docker exec p2enjoy-db ls -la /etc/postgresql-custom/
  => -rw-r----- 1 postgres postgres 64 pgsodium_root.key
```

`PGDATA` est le montage `./supabase/docker/volumes/db/data` ; `/etc/postgresql-custom` est le volume
nommé `db-config`. **Ce sont deux objets distincts, et c'est exactement le piège que le §10 du DAT
décrit.** Une sauvegarde qui n'emporterait que le dump laisserait les secrets de messagerie
chiffrés et **indéchiffrables** : il faudrait ressaisir chaque mot de passe de compte.

**M4. `age` est présent sur l'hôte, en version 1.1.1, et la chaîne complète a été éprouvée.**

```
age --version                                        => 1.1.1
age-keygen -o id.txt ; age-keygen -y id.txt          => age155r5m…fluf6g
tar -cf a.tar base.dump key.bin                      => 972 160 octets
age --encrypt --recipients-file rec.txt -o a.tar.age => 983 464 octets
age --decrypt -i id.txt a.tar.age > b.tar ; cmp a.tar b.tar => identiques
```

**M5. Le conteneur MinIO ne porte NI `tar` NI `find`, et l'export passe donc par `docker cp`.**

```
docker exec p2enjoy-minio tar -cf - -C /data p2enjoy-crm
  => sh: tar: command not found        (rc=127, sortie inexploitable de 122 octets)

docker cp p2enjoy-minio:/data/p2enjoy-crm -   => rc=0, flux tar valide
  tar -tf … => p2enjoy-crm/
```

`docker cp <conteneur>:<chemin> -` fait produire le flux `tar` **par le démon Docker**, qui lit le
système de fichiers du conteneur sans rien exiger de son image. C'est le seul chemin qui marche ici,
et il est retenu pour cette raison mesurée, non par préférence.

**M6. Le dépôt objet est vide sur la pile seedée, et ce n'est pas un défaut.**

```
select count(*) from storage.objects;      => 0
select id, name from storage.buckets;      => mail-attachments
select count(*) from public.mail_attachments; => 0
du -sh /data/p2enjoy-crm                   => 4,0 K
```

Les quatre messages du seed ne portent aucune pièce jointe. La sauvegarde des objets doit donc
fonctionner — et être **prouvée** — sur un dépôt **vide** comme sur un dépôt peuplé : la preuve de
la tranche 1 dépose un objet témoin avant de sauvegarder, plutôt que de conclure d'un dossier vide
que le chemin marche.

**M7. Le bucket S3 de la pile est `p2enjoy-crm`, et il n'est pas le bucket applicatif.**
`GLOBAL_S3_BUCKET=p2enjoy-crm` (`.env.example`) est le bucket **S3** ; `mail-attachments` est un
bucket **Supabase Storage**, c'est-à-dire un préfixe à l'intérieur du premier. La sauvegarde emporte
le bucket S3 entier : c'est le contenant réel, et découper par préfixe inventerait une frontière
que le stockage n'a pas.

**M8. `wal-g` est configuré dans l'image mais n'est pas activé par la pile.**
`/etc/postgresql-custom/wal-g.conf` existe (463 octets, daté du 2026-06-15, donc livré par l'image
`supabase/postgres:17.6.1.136`). Aucun service de la pile ne l'appelle et aucune variable du dépôt
ne le renseigne. **La restauration à un instant quelconque (PITR) est donc hors périmètre de cette
unité**, et le fait est nommé au §8 plutôt que découvert plus tard.

---

## 3. Tranche 1 — Ce que `scripts/backup.sh` produit

### 3.1 Un fichier, et un seul

Une exécution réussie dépose dans le répertoire de sortie **exactement un** fichier :

```
p2enjoy-sauvegarde-AAAAMMJJTHHMMSSZ.tar.age
```

L'horodatage est celui du **début** de l'exécution, en UTC. Le nom est le seul index : il se trie
lexicographiquement dans l'ordre chronologique, ce dont la rétention (§3.6) et la tranche 2
dépendent.

**Rien d'autre n'est déposé.** Ni journal, ni copie en clair, ni fichier temporaire résiduel : le
répertoire de sortie ne contient que des sauvegardes, de sorte qu'un opérateur qui l'énumère lise un
inventaire et non un chantier.

### 3.2 Ce que l'archive contient

Sous une racine portant le nom de l'archive sans son extension :

| Membre | Origine mesurée | Obligatoire |
|---|---|---|
| `MANIFESTE.txt` | engendré par le script | oui |
| `base.dump` | `pg_dump -U postgres -d <base> -Fc` dans le conteneur `db` (M1, M2) | oui |
| `pgsodium_root.key` | `cat /etc/postgresql-custom/pgsodium_root.key` dans le conteneur `db` (M3) | oui |
| `objets.tar` | `docker cp <minio>:/data/<bucket> -` (M5) | **seulement** si le dépôt objet est local |

**`pgsodium_root.key` est OBLIGATOIRE, et son absence fait ÉCHOUER la sauvegarde.** C'est la règle
la plus importante de cette tranche. Le §10 du DAT dit que la clé doit être sauvegardée séparément ;
l'expérience de ce genre d'avertissement est qu'il n'est pas suivi. Le script ne se contente donc
pas de le recommander : il **refuse** de produire une archive dont la clé serait absente, parce
qu'une telle archive donnerait la confiance d'une sauvegarde sans en avoir la valeur. Un opérateur
qui voudrait délibérément une sauvegarde sans la clé peut extraire `base.dump` de l'archive ; le
chemin par défaut, lui, ne perd rien en silence.

**`objets.tar` est conditionnel, et la condition est LUE, non supposée.** Le dépôt objet est
considéré comme **local** lorsque le conteneur MinIO de la pile courante est en fonctionnement.
Sinon — fournisseur S3 externe, cas nominal de production —, le membre est absent, le manifeste
l'écrit noir sur blanc (`depot_objet=externe`), et le script **avertit** que la sauvegarde des
objets relève alors du fournisseur. Il n'invente pas un client S3, et il ne prétend pas avoir
sauvegardé ce qu'il n'a pas lu.

### 3.3 Le manifeste, et à quoi il sert

`MANIFESTE.txt` est un fichier **texte**, lisible sans outil, au format `clé=valeur`, une paire par
ligne. Il est le premier membre de l'archive.

```
format_version=1
cree_le=2026-08-20T05:21:20Z
profil=dev
base_de_donnees=postgres
postgres_version=17.6
depot_objet=minio-local
bucket_objet=p2enjoy-crm
membre=base.dump 972060 <sha256>
membre=pgsodium_root.key 64 <sha256>
membre=objets.tar 1536 <sha256>
```

- **`format_version`** existe pour que la tranche 2 refuse explicitement une archive d'un format
  qu'elle ne connaît pas, plutôt que de la lire de travers ;
- **une ligne `membre=` par membre**, portant son **nom**, sa **taille en octets** et son
  **SHA-256**. C'est le « contrôle d'intégrité » de la Definition of Done, et c'est ce que la
  tranche 2 vérifiera **avant** de restaurer quoi que ce soit ;
- **aucun secret n'y figure** : ni mot de passe, ni jeton, ni identifiant S3, ni chemin de clé
  privée. Le manifeste est la partie de l'archive la plus susceptible d'être citée dans un ticket
  ou un courriel d'exploitation (`CLAUDE.md` §20).

Le manifeste **ne porte pas sa propre empreinte** : elle ne prouverait rien, l'archive entière étant
scellée par `age`, dont le format est authentifié (ChaCha20-Poly1305). Une archive altérée ne se
déchiffre pas du tout ; les empreintes du manifeste servent à détecter une corruption **survenue
avant** le chiffrement — un `pg_dump` tronqué par un disque plein, par exemple.

### 3.4 Le chiffrement — destinataires publics, jamais de phrase de passe

Le chiffrement emploie **`age`** avec un fichier de **destinataires** (`--recipients-file`), et
**jamais** une phrase de passe.

Le motif est une propriété de sécurité, pas une préférence d'outil : l'hôte qui produit les
sauvegardes ne détient que des **clés publiques**. Il peut écrire des archives, il ne peut en
relire aucune — pas même les siennes. Une compromission de l'hôte de sauvegarde ne livre donc pas
l'historique. La clé privée correspondante vit hors de cet hôte, et **le script de la tranche 1 ne
la lit jamais** ; c'est la tranche 2 qui en aura besoin, et sur un poste distinct.

Une phrase de passe serait le contraire : elle transiterait par l'environnement d'une tâche
planifiée, donc par la table des processus et par les journaux d'un incident.

**`age` est un prérequis dur.** Absent, le script s'arrête en le nommant. Il ne se rabat sur aucun
autre outil : un chemin de repli silencieux produirait des archives dont le format dépendrait de
l'hôte, et la tranche 2 n'aurait plus un seul format à savoir lire.

### 3.5 Le déroulé, et la règle d'atomicité

1. contrôle des prérequis (§3.7) — **aucune écriture avant que tous soient satisfaits** ;
2. création d'un répertoire d'assemblage par `mktemp -d`, en mode `700`, **détruit par un `trap`**
   quelle que soit l'issue ;
3. écriture de `base.dump`, `pgsodium_root.key`, et `objets.tar` le cas échéant ;
4. calcul des empreintes et écriture de `MANIFESTE.txt` ;
5. `tar` de l'assemblage, chiffré par `age` **en flux**, vers un fichier **temporaire** du
   répertoire de sortie nommé `.<nom-final>.partiel` ;
6. renommage atomique en `<nom-final>` ;
7. application de la rétention (§3.6) ;
8. rapport final : chemin, taille, membres, ce qui a été supprimé par la rétention.

**Le point 5 puis 6 est la règle d'atomicité, et elle n'est pas décorative** : un lecteur du
répertoire de sortie — la tranche 2, une copie hors site, un opérateur — ne doit jamais pouvoir
prendre une archive en cours d'écriture pour une sauvegarde valide. Le nom temporaire commence par
un point et se termine par `.partiel` : il ne correspond ni au motif de la rétention ni à celui que
la tranche 2 énumérera. Sur échec à n'importe quelle étape, le `trap` supprime **et**
l'assemblage **et** le fichier partiel.

### 3.6 La rétention

`BACKUP_RETENTION_DAYS` (défaut : **30**) supprime, **après** l'écriture réussie de la nouvelle
archive, celles du répertoire de sortie dont la date de modification dépasse ce nombre de jours.

Trois gardes, chacune contre une manière connue de perdre des données :

- **le motif est strict** : seuls les fichiers `p2enjoy-sauvegarde-*.tar.age` du répertoire de
  sortie sont candidats. Rien d'autre n'est jamais supprimé, quoi que contienne le répertoire ;
- **la valeur `0` est REFUSÉE**, comme toute valeur non entière ou négative : `0` supprimerait
  l'archive qui vient d'être écrite. Le minimum est `1` ;
- **la suppression est ÉNUMÉRÉE** dans le rapport final, une ligne par fichier. Une rétention qui
  efface en silence est indistinguable d'une corruption.

La rétention ne s'applique **jamais** si l'écriture a échoué : on ne fait pas de place pour une
sauvegarde qui n'existe pas.

### 3.7 Les refus — dictionnaire FERMÉ

Chaque refus s'arrête avec le code `1` et un message qui **nomme sa cause et le geste qui la lève**.
Aucune exécution partielle ne subsiste.

| # | Condition | Message |
|---|---|---|
| R1 | `age` introuvable sur l'hôte | « `age` est introuvable : la sauvegarde chiffrée l'exige (voir README §4). » |
| R2 | `BACKUP_AGE_RECIPIENTS_FILE` vide ou non renseignée | « `BACKUP_AGE_RECIPIENTS_FILE` n'est pas renseignée : elle doit désigner le fichier des clés publiques de chiffrement. » |
| R3 | fichier de destinataires illisible ou vide | « le fichier de destinataires … est illisible ou vide. » |
| R4 | aucune ligne de destinataire valide (`age1…` ou `ssh-…`) | « le fichier de destinataires … ne contient aucune clé publique reconnue. » |
| R5 | Docker indisponible | message de `require_docker` (`scripts/lib/env.sh`), réemployé tel quel |
| R6 | conteneur de base non démarré | « le service `db` n'est pas démarré : la sauvegarde lit la base par lui. » |
| R7 | répertoire de sortie **dans le dépôt** | « le répertoire de sortie … est dans le dépôt Git : une sauvegarde chiffrée n'a rien à y faire. » |
| R8 | répertoire de sortie non créable ou non inscriptible | « le répertoire de sortie … n'est pas inscriptible. » |
| R9 | `BACKUP_RETENTION_DAYS` non entier, ou < 1 | « `BACKUP_RETENTION_DAYS` doit être un entier supérieur ou égal à 1. » |
| R10 | `pg_dump` en échec | « `pg_dump` a échoué (code …) : aucune archive n'a été écrite. » |
| R11 | clé racine de Vault absente ou vide | « la clé racine … est absente : une archive sans elle ne restituerait aucun secret de messagerie (docs/DAT.md §10). » |
| R12 | `age` en échec au chiffrement | « le chiffrement a échoué (code …) : aucune archive n'a été écrite. » |

**R7 mérite son motif.** Le dépôt porte un `.gitignore`, mais une archive chiffrée déposée dans
l'arbre de travail serait, au mieux, poussée par erreur, au pire ajoutée à une image. Le refus est
structurel : le script compare le chemin **canonique** du répertoire de sortie à la racine du dépôt,
et refuse tout ce qui est dessous. C'est `CLAUDE.md` §3, « aucun secret réel dans le dépôt »,
rendu exécutable.

### 3.8 Ce que le script n'écrit JAMAIS

- aucun mot de passe, jeton, identifiant S3 ni chemin de clé privée dans le manifeste, dans son
  rapport ou dans un journal (`CLAUDE.md` §20) ;
- aucun fichier hors du répertoire d'assemblage temporaire et du répertoire de sortie ;
- **aucune écriture dans la base**, ni dans les conteneurs : la sauvegarde est une lecture. Elle ne
  pose pas de verrou exclusif, `pg_dump` travaillant dans une transaction `REPEATABLE READ`.

---

## 4. Les variables d'environnement de la tranche 1

Documentées dans `.env.example` au format du dépôt — rôle, format, caractère obligatoire, exemple
non sensible.

| Variable | Rôle | Format | Requise | Défaut |
|---|---|---|---|---|
| `BACKUP_AGE_RECIPIENTS_FILE` | fichier des **clés publiques** `age` destinataires du chiffrement | chemin absolu | **oui** | aucun |
| `BACKUP_OUTPUT_DIR` | répertoire de dépôt des archives, **hors du dépôt Git** | chemin absolu | non | `/var/backups/p2enjoy` |
| `BACKUP_RETENTION_DAYS` | âge maximal, en jours, d'une archive conservée | entier ≥ 1 | non | `30` |

`--output-dir DIR` surcharge `BACKUP_OUTPUT_DIR` pour une exécution. `--help` imprime l'aide tirée
du bloc de tête du fichier, comme les autres scripts du dépôt.

**Aucune valeur réelle n'entre dans le dépôt** : `.env.example` porte un chemin d'exemple, et le
fichier de destinataires n'est pas versionné. Le fichier de destinataires ne contenant que des clés
**publiques**, le versionner serait sans danger — mais le laisser hors du dépôt évite d'avoir à
tenir cette nuance à chaque relecture.

---

## 5. Contrat de comportement — cas a à n

| Cas | Situation | Attendu |
|---|---|---|
| a | Pile debout, prérequis satisfaits | Une archive `p2enjoy-sauvegarde-*.tar.age`, et **elle seule**, dans le répertoire de sortie |
| b | L'archive déchiffrée par la clé privée correspondante | Un `tar` valide portant `MANIFESTE.txt`, `base.dump`, `pgsodium_root.key` |
| c | `pg_restore --list` sur `base.dump` extrait | Rend la table des matières de l'archive, dont `dbname:` |
| d | `pgsodium_root.key` extrait | **Identique octet à octet** à `/etc/postgresql-custom/pgsodium_root.key` du conteneur |
| e | Les empreintes du manifeste | Chacune égale au `sha256sum` du membre extrait |
| f | Dépôt objet local **peuplé d'un objet témoin** | `objets.tar` présent, et le témoin s'y trouve |
| g | Dépôt objet local **vide** | `objets.tar` présent et valide, sans membre autre que le bucket |
| h | Conteneur MinIO absent (dépôt externe) | Pas de membre `objets.tar` ; `depot_objet=externe` au manifeste ; un avertissement, **pas** un échec |
| i | `age` absent du `PATH` | R1, code `1`, **aucun** fichier dans le répertoire de sortie |
| j | Fichier de destinataires vide | R3, code `1`, aucun fichier |
| k | Répertoire de sortie situé dans le dépôt | R7, code `1`, aucun fichier |
| l | `BACKUP_RETENTION_DAYS=0` | R9, code `1`, aucun fichier |
| m | Rétention à 1 jour, une archive datée d'avant | L'ancienne est supprimée **et énumérée** ; la neuve subsiste ; un fichier étranger du même répertoire est **intact** |
| n | Échec en cours d'exécution | Aucun `.partiel` ni assemblage temporaire ne subsiste |

---

## 6. Preuves exigées — tranche 1

| Niveau | Preuve |
|---|---|
| Harnais | `scripts/verify-sauvegardes.sh` : exécute le **vrai** script sur la **vraie** pile, et couvre les cas a à n du §5. Il engendre pour lui-même une paire de clés `age` jetable, chiffre, **déchiffre**, et compare. Non complaisant : il **dégrade volontairement** chaque prérequis et exige le refus attendu |
| Intégrité | Les empreintes du manifeste sont **recalculées** sur les membres extraits, jamais relues du manifeste lui-même |
| Traçabilité | `scripts/verify-scripts.sh` étendu : le nouveau script porte son en-tête `@spec`, son aide `--help`, et le `set -euo pipefail` du dépôt |
| Documentation | `README.md` §5 et §9, `docs/DAT.md` §10, `.env.example`, `CHANGELOG.md` |

**Il n'y a ni test unitaire Vitest ni scénario Playwright pour cette tranche, et ce n'est pas une
dérogation à `CLAUDE.md` §15 : c'est le vocabulaire du dépôt.** La tranche ne livre ni module
TypeScript ni surface ; son unité d'exécution est un script shell, et le dépôt éprouve ses scripts
par des harnais (`scripts/verify-scripts.sh` pour `runDev.sh`, `runProd.sh` et `resetMe.sh`). Le
harnais **est** la preuve, et il exerce le comportement réel de bout en bout — production,
déchiffrement, comparaison octet à octet, et chacun des refus. L'écart est nommé ici plutôt que
compensé par un test de substitution sans valeur probante.

---

## 7. Definition of Done — tranche 1

- `scripts/backup.sh` livré, exécutable, avec son aide et ses commentaires `@spec` ;
- l'archive du §3.2, son manifeste du §3.3, son chiffrement du §3.4, son atomicité du §3.5 et sa
  rétention du §3.6 ;
- les douze refus du §3.7, chacun **éprouvé** ;
- les trois variables du §4 documentées dans `.env.example` ;
- `scripts/verify-sauvegardes.sh` couvrant les cas a à n, exécuté et **vert** ;
- `README.md`, `docs/DAT.md` §10 et `CHANGELOG.md` mis à jour dans le même changement ;
- `docs/BACKLOG.md` au véritable état — `CRM-080` reste `[~]` tant que les tranches 2 et 3 ne sont
  pas livrées.

---

## 8. Limites nommées — écrites plutôt que découvertes plus tard

- **Aucune restauration.** La tranche 1 produit ; elle ne rend rien. Une sauvegarde jamais
  restaurée n'est pas une sauvegarde, et c'est précisément l'objet de la tranche 2. Tant qu'elle
  n'est pas livrée, `CRM-080` ne peut pas passer à `[x]` : sa Definition of Done exige qu'« une
  preuve restaure réellement un snapshot ».
- **Aucune restauration à un instant quelconque (PITR).** `pg_dump` est un instantané logique
  cohérent, pas un journal continu. `wal-g` est configuré dans l'image mais n'est activé par aucun
  service de la pile (M8) ; l'activer serait une décision d'architecture, à prendre explicitement.
- **Aucune planification.** Le script s'exécute quand on l'appelle. Le déclencheur — `cron`,
  `systemd`, ordonnanceur de l'hôte — appartient au runbook de la tranche 3, parce qu'il dépend de
  l'hôte de production et non du dépôt.
- **Aucune copie hors site, aucune alerte.** Une archive laissée sur la machine qu'elle sauvegarde
  ne protège d'aucun sinistre matériel. Tranche 3.
- **Aucun chiffrement du dépôt objet externe.** Quand le stockage est un fournisseur S3, ses objets
  restent sous sa responsabilité. Le manifeste le **dit** (`depot_objet=externe`) pour qu'aucune
  restauration ne croie disposer de ce qu'elle n'a pas.
- **Aucune rotation de clé.** Changer de destinataires `age` n'affecte que les archives futures ;
  les anciennes restent lisibles par l'ancienne clé privée, qui doit donc être conservée. La
  procédure appartient à la tranche 3.
- **La base entière est sauvegardée, y compris `auth`, `storage` et `realtime`.** Ce n'est pas un
  excès : restaurer `public` sans `auth` rendrait toutes les cards orphelines de leurs auteurs.

---

## 9. Cadrage des tranches 2 et 3 — ce qu'elles devront tenir

Ce paragraphe **cadre**, il ne spécifie pas : le contrat de chaque tranche sera écrit avant son
propre code.

**Tranche 2 — la restauration prouvée.** `scripts/restore-drill.sh` devra : déchiffrer une archive
avec une identité `age` fournie par l'opérateur ; refuser un `format_version` inconnu ; **vérifier
toutes les empreintes du manifeste avant** de restaurer quoi que ce soit ; monter une pile
**jetable** portant un nom de projet Docker distinct, sur des ports distincts, sans jamais toucher
la pile courante ; y restaurer `base.dump` et la clé racine ; **comparer des invariants** — comptes
de lignes des tables du seed, présence des politiques RLS, et surtout le **déchiffrement effectif
d'un secret de Vault**, seule preuve que la clé racine a suivi ; puis détruire **le seul**
environnement jetable, jamais un volume de la pile courante. La garde la plus importante de cette
tranche sera cette dernière : elle devra être structurelle — nom de projet dédié — et non
conditionnelle.

**Tranche 3 — l'exploitation.** Un runbook dédié devra porter : la planification et sa fréquence ;
la copie hors site ; l'alerte sur échec **et** sur absence de sauvegarde récente — une sauvegarde
qui ne tourne plus est silencieuse par nature ; la rotation des destinataires `age` et la
conservation des clés privées anciennes ; le rythme des exercices de restauration ; et l'exigence de
`CLAUDE.md` §12, qui veut que toute opération manuelle de production vive dans un document dédié.
