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

---

# Tranche 2 — La restauration prouvée

Contrat écrit **avant toute ligne de code** de cette tranche (`CLAUDE.md` §5,
`docs/CloudWorker.md` §3.2 point 3), après **huit mesures** prises le **2026-08-20** sur la pile
réelle démarrée et seedée, et sur une archive **réellement produite** par `scripts/backup.sh` —
`p2enjoy-sauvegarde-20260820T062911Z.tar.age`, 983 464 octets, trois membres. Les paragraphes
intitulés « MESURÉ » rapportent une sortie obtenue sur cet hôte, jamais un souvenir.

Le §9 ci-dessus **cadrait** cette tranche. Les mesures qui suivent en corrigent deux points sur
lesquels le cadrage se trompait, et le disent ouvertement : la restauration ne se fait pas sous
`postgres`, et l'isolement ne repose pas sur des « ports distincts ».

---

## 10. Mesures du 2026-08-20 — ce que restaurer exige réellement

**M9. La clé racine doit être en place AVANT le premier démarrage du serveur, sinon elle est
perdue pour toujours.** `/usr/lib/postgresql/bin/pgsodium_getkey.sh`, que
`postgresql.conf` désigne par `pgsodium.getkey_script` et `vault.getkey_script`, dit :

```
KEY_FILE=/etc/postgresql-custom/pgsodium_root.key
if [[ ! -f "${KEY_FILE}" ]]; then
    head -c 32 /dev/urandom | od -A n -t x1 | tr -d ' \n' > "${KEY_FILE}"
fi
cat $KEY_FILE
```

Un cluster démarré sans ce fichier **s'en fabrique un au hasard**, et le déposer ensuite ne répare
rien : les secrets restaurés resteront chiffrés par une clé que le serveur n'a plus. La clé de
l'archive est donc **montée dans le conteneur jetable au moment de sa création**, jamais copiée
après coup. C'est la contrainte qui commande tout l'ordre de cette tranche.

**M10. La restauration se fait sous `supabase_admin`, et le cadrage du §9 avait tort.** Le nombre
d'erreurs de `pg_restore` sur la MÊME archive et le MÊME conteneur, en ne changeant que l'identité
et l'amorçage :

```
pg_restore -U postgres         (conteneur nu)                       => 762 erreurs, rc=1
pg_restore -U supabase_admin   (conteneur nu)                       =>  14 erreurs, rc=1
pg_restore -U supabase_admin   (+ scripts d'init du dépôt montés)   =>  12 erreurs, rc=1
pg_restore -U supabase_admin   (+ rôle supabase_realtime_admin créé) =>   0 erreur,  rc=0
```

`postgres` **n'est pas superutilisateur** dans cette pile — `select rolsuper` rend `f` pour lui et
`t` pour `supabase_admin`, sur le conteneur courant comme sur un conteneur neuf — et `vault.secrets`
appartient à `supabase_admin`. Restaurer sous `postgres` rend donc, entre autres :

```
pg_restore: error: could not execute query: ERROR:  permission denied for table secrets
Command was: COPY vault.secrets (id, name, description, secret, key_id, nonce, ...) FROM stdin;
```

**Les secrets ne sont pas restaurés du tout, et rien ne s'arrête** : `vault.secrets` rend `0` là où
la pile en porte `5`. Une restauration sous `postgres` produirait une base d'apparence complète et
**silencieusement privée de tous ses secrets de messagerie**.

**M11. `pg_dump` ne porte AUCUN objet global : les rôles ne sont pas dans l'archive.** C'est une
propriété de `pg_dump`, non un défaut de la tranche 1 — seul `pg_dumpall --globals-only` les
emporte. Deux rôles de la pile manquent donc à un cluster neuf issu de la même image :

```
image seule            : … supabase_admin, supabase_auth_admin, supabase_storage_admin …
pile courante, en plus : supabase_functions_admin, supabase_realtime_admin
```

`supabase_functions_admin` est créé par `supabase/docker/volumes/db/webhooks.sql`, que le dépôt
monte dans `/docker-entrypoint-initdb.d/init-scripts/` ; `supabase_realtime_admin` est créé par le
service Realtime lui-même au démarrage, et par aucun fichier du dépôt. Ses attributs mesurés sur la
pile sont `NOLOGIN NOINHERIT`, sans aucun autre droit. L'environnement jetable reproduit donc
l'amorçage réel de la pile — les mêmes scripts d'initialisation, montés aux mêmes chemins — et crée
ce seul rôle que ces scripts ne créent pas. La conséquence pour l'exploitation est nommée au §14.

**M12. LA MESURE DÉCISIVE — sans la vraie clé racine, TOUT est vert sauf le déchiffrement.** Le même
`base.dump` restauré dans un conteneur jetable amorcé avec une clé racine **tirée au hasard** :

```
pg_restore                          => rc=0, 0 erreur
tables publiques                    => 36     (identique)
politiques RLS de « public »        => 103    (identique)
tables à RLS active                 => 36     (identique)
auth.users / cards / mail_messages  => 3 / 41 / 4  (identiques)
vault.secrets                       => 5      (identique)
select … from vault.decrypted_secrets
  => ERROR: pgsodium_crypto_aead_det_decrypt_by_id: invalid ciphertext
```

**Aucun autre invariant ne voit la différence.** Un exercice qui se contenterait de compter des
lignes rendrait un verdict vert sur une archive dont les secrets sont irrécupérables — exactement la
confiance sans la valeur que le refus R11 de la tranche 1 cherchait à empêcher. Le **déchiffrement
effectif d'un secret de Vault** n'est donc pas un invariant parmi d'autres : c'est le seul qui
éprouve la clé racine, et l'exercice échoue s'il manque.

**M13. Les secrets se comparent par EMPREINTE, jamais en clair.** Le déchiffrement est demandé au
serveur sous la forme `encode(digest(decrypted_secret,'sha256'),'hex')`. Mesuré sur les cinq
secrets du seed, l'empreinte est identique sur la pile courante et sur la pile restaurée, et
**aucun mot de passe ne traverse la sortie de l'exercice ni ses journaux** (`CLAUDE.md` §20).

**M14. L'environnement jetable ne publie AUCUN port, ce qui est plus fort que « des ports
distincts ».** Tout passe par `docker exec` et par le socket local du conteneur, comme la
sauvegarde (M1). Rien n'est donc exposé, rien ne peut entrer en collision avec la pile courante, et
la question du choix des ports ne se pose pas. Le conteneur ne rejoint par ailleurs aucun réseau de
la pile : il reste sur le pont par défaut, sans aucun lien vers `p2enjoy-db`.

**M15. Les objets se restaurent par `docker cp - <conteneur>:/data`, miroir exact de l'export.**
L'image MinIO ne portant ni `tar` ni `find` (M5), c'est de nouveau le **démon** Docker qui extrait
le flux. MESURÉ : un `objets.tar` portant `p2enjoy-crm/temoin.txt` est ressorti lisible dans
`/data/p2enjoy-crm/temoin.txt` du conteneur jetable, contenu intact.

**M16. Les invariants du seed, relevés sur la pile courante**, et qui servent de référence :

```
tables publiques=36  politiques_rls=103  tables_rls_actives=36
auth.users=3  cards=41  mail_messages=4  vault.secrets=5
```

Ces nombres ne sont **pas** codés en dur dans l'exercice : il les LIT sur la pile de référence
quand elle est disponible, et se contente de comparer. Un exercice qui porterait les nombres du
seed deviendrait faux au premier seed modifié, et rougirait pour une raison étrangère à la
sauvegarde.

---

## 11. Ce que `scripts/restore-drill.sh` fait

### 11.1 Un environnement jetable, et un seul

L'exercice crée **exactement un** conteneur PostgreSQL, et — si l'archive porte des objets — **au
plus un** conteneur MinIO. Tous deux portent :

- un **nom dédié**, dérivé de l'horodatage de l'exercice :
  `p2enjoy-restauration-AAAAMMJJTHHMMSSZ` et `p2enjoy-restauration-objets-AAAAMMJJTHHMMSSZ` ;
- une **étiquette dédiée** : `com.p2enjoy.restauration=AAAAMMJJTHHMMSSZ`.

Aucun autre objet Docker n'est créé : ni réseau, ni volume nommé, ni pile Compose. L'exercice
n'appelle **jamais** `docker compose`, sous aucune forme — ni pour monter, ni pour détruire.

### 11.2 La garde de destruction, qui est STRUCTURELLE

C'est la garde la plus importante de la tranche, et le §9 exigeait qu'elle ne soit pas
conditionnelle. Elle ne l'est pas :

- l'exercice ne détruit **que** les conteneurs dont il a lui-même retenu le nom, dans deux variables
  posées au moment de leur création. Il ne construit **aucun** motif, n'énumère **aucune** liste et
  n'interroge **aucun** filtre pour décider quoi détruire ;
- ces noms sont préfixés `p2enjoy-restauration-` et portent l'horodatage de l'exercice ; **aucun
  conteneur de la pile ne peut porter un tel nom**, les noms de la pile étant fixés par
  `docker-compose.yml` (`container_name: p2enjoy-db`, `p2enjoy-minio`, …) ;
- si l'un de ces noms est **déjà pris** au moment de la création, l'exercice **refuse de démarrer**
  (R24) plutôt que de réutiliser ou d'écraser un conteneur qu'il n'a pas créé ;
- la destruction passe par un `trap … EXIT INT TERM` : elle a lieu quelle que soit l'issue, y
  compris sur interruption, et **jamais** sur autre chose que ces deux noms.

`--conserver` laisse l'environnement jetable debout pour inspection. L'exercice imprime alors les
deux commandes exactes de destruction manuelle, et son code de sortie n'en est pas changé.

### 11.3 Le déroulé, dans l'ordre que les mesures imposent

1. **prérequis** (§11.6) — `age`, l'identité de déchiffrement, Docker, l'archive ; aucune création
   avant que tous soient satisfaits ;
2. **déchiffrement** de l'archive dans un répertoire d'assemblage `mktemp -d` en mode `700`, détruit
   par le `trap` ;
3. **lecture du manifeste**, et refus d'un `format_version` inconnu (R22) — **avant** toute autre
   lecture, puisque c'est lui qui dit comment lire le reste ;
4. **VÉRIFICATION DE TOUTES LES EMPREINTES**, membre par membre, taille **et** SHA-256 recalculés
   sur le fichier extrait. Un seul écart arrête l'exercice (R23). **Rien n'est restauré avant que
   toutes soient vérifiées** : restaurer d'abord et vérifier ensuite reviendrait à écrire un
   contenu qu'on sait peut-être corrompu ;
5. **création du conteneur jetable**, la clé racine de l'archive montée à
   `/etc/postgresql-custom/pgsodium_root.key` **dès la création** (M9), les quatre scripts
   d'initialisation du dépôt montés aux chemins de `docker-compose.yml` (M11), **aucun port
   publié** (M14) ;
6. **attente de disponibilité** : boucle sur `pg_isready`, plafonnée, puis création du rôle
   `supabase_realtime_admin` que les scripts du dépôt ne créent pas (M11) ;
7. **restauration** de `base.dump` par `pg_restore -U supabase_admin --clean --if-exists
   --no-owner` (M10). L'exercice **exige zéro erreur** : le compte des lignes `pg_restore: error`
   doit être nul (R25) ;
8. **restauration des objets** dans le MinIO jetable par `docker cp -` (M15), si et seulement si le
   manifeste porte `depot_objet=minio-local` ;
9. **comparaison des invariants** (§11.4) ;
10. **destruction** de l'environnement jetable, et de lui seul (§11.2) ;
11. **rapport** : chaque invariant, sa valeur des deux côtés, et le verdict.

### 11.4 Les invariants comparés, et ce que chacun éprouve

| # | Invariant | Ce qu'il éprouve | Comment |
|---|---|---|---|
| I1 | **Déchiffrement d'un secret de Vault** | **que la clé racine a suivi** — le seul invariant qui le voie (M12) | empreinte SHA-256 de chaque `decrypted_secret`, comparée ligne à ligne (M13) |
| I2 | Nombre de secrets de `vault.secrets` | que les secrets ont été restaurés, et pas seulement leur table | `count(*)` |
| I3 | Comptes de lignes des tables du seed | que les données sont là | `auth.users`, `public.cards`, `public.mail_messages` |
| I4 | Nombre de tables de `public` | que le schéma est complet | `pg_tables` |
| I5 | Politiques RLS de `public` | que les règles d'autorisation ont suivi — une base restaurée sans elles serait **ouverte** | `count(*)` sur `pg_policies` |
| I6 | Tables à RLS **active** | qu'aucune table n'a perdu son `row level security` | `pg_class.relrowsecurity` |
| I7 | Objet du dépôt restauré | que le chemin des objets fonctionne | présence, dans le MinIO jetable, de chaque entrée de `objets.tar` |

**I1 est le cœur, et son échec est un échec de l'exercice**, jamais un avertissement. I5 et I6
viennent juste après : `CLAUDE.md` §10 fait des politiques une règle de backend, et une restauration
qui les perdrait rendrait toutes les données lisibles par n'importe quel porteur de jeton.

**La comparaison a deux modes, et l'exercice dit lequel il emploie :**

- **pile de référence disponible** — le conteneur `p2enjoy-db` tourne : chaque invariant est lu des
  DEUX côtés et comparé. C'est le mode probant, et le seul que le harnais emploie ;
- **pile de référence absente** — cas d'une restauration sur un hôte de secours : les invariants
  sont lus sur la seule pile restaurée, et l'exercice vérifie ce qui se vérifie sans référence —
  I1 (le déchiffrement **réussit**), et le fait que I2 à I6 soient **non nuls**. Le rapport dit
  explicitement que la comparaison n'a pas eu lieu, plutôt que de laisser croire à une égalité.

### 11.5 Les variables d'environnement de la tranche 2

| Variable | Rôle | Format | Requise | Défaut |
|---|---|---|---|---|
| `RESTORE_AGE_IDENTITY_FILE` | fichier de la **clé privée** `age` qui déchiffre l'archive | chemin absolu | **oui** | aucun |
| `BACKUP_OUTPUT_DIR` | répertoire où chercher la dernière archive quand aucune n'est nommée | chemin absolu | non | `/var/backups/p2enjoy` (partagé avec la tranche 1) |

`scripts/restore-drill.sh [ARCHIVE]` prend en argument le chemin d'une archive ; sans argument, il
prend **la plus récente** de `BACKUP_OUTPUT_DIR` selon le tri lexicographique du nom, que le §3.1
rend chronologique. `--conserver` et `--help` complètent l'interface.

**C'est ici, et seulement ici, qu'une clé PRIVÉE est lue.** La tranche 1 n'en lit jamais (§3.4) :
l'hôte qui sauvegarde ne peut relire aucune de ses archives. L'exercice de restauration est donc
une opération d'un poste **distinct**, celui qui détient l'identité — et le §14 le dit à
l'exploitation.

### 11.6 Les refus — dictionnaire FERMÉ

| # | Condition | Message |
|---|---|---|
| R20 | `age` introuvable | « `age` est introuvable : la restauration chiffrée l'exige (voir README §4). » |
| R21 | `RESTORE_AGE_IDENTITY_FILE` vide, illisible ou vide de contenu | « `RESTORE_AGE_IDENTITY_FILE` doit désigner le fichier de la clé privée `age` qui déchiffre l'archive. » |
| R22 | `format_version` absent ou différent de `1` | « le manifeste annonce le format « … », que cet exercice ne sait pas lire. » |
| R23 | une empreinte ou une taille de membre ne correspond pas | « le membre « … » ne correspond pas au manifeste : l'archive est corrompue, rien n'a été restauré. » |
| R24 | un nom de conteneur jetable est déjà pris | « le conteneur « … » existe déjà : l'exercice refuse de réutiliser un environnement qu'il n'a pas créé. » |
| R25 | `pg_restore` rend au moins une erreur | « `pg_restore` a rendu … erreur(s) : la restauration n'est pas fidèle. » |
| R26 | archive introuvable, ou aucune archive dans le répertoire | « aucune archive à restaurer : … » |
| R27 | Docker indisponible | message de `require_docker` (`scripts/lib/env.sh`), réemployé tel quel |
| R28 | déchiffrement `age` en échec | « le déchiffrement a échoué : l'identité fournie n'ouvre pas cette archive. » |
| R29 | le conteneur jetable ne devient pas disponible dans le délai | « la base jetable n'a pas démarré en … s : l'exercice s'arrête et détruit son environnement. » |
| R30 | un invariant diffère de la référence | « invariant « … » : la pile restaurée rend …, la référence rend …. » |

Chaque refus s'arrête avec le code `1`, nomme sa cause, et **laisse la pile courante intacte**. Le
`trap` détruit l'environnement jetable dans tous les cas.

### 11.7 Ce que l'exercice n'écrit JAMAIS

- **rien dans la pile courante** : ni dans sa base, ni dans son dépôt objet, ni dans ses volumes.
  L'exercice ne fait sur elle que des **lectures** — `select` pour les invariants de référence,
  `docker ps` pour savoir si elle tourne. C'est `CLAUDE.md` §9, rendu exécutable ;
- **aucun secret en clair** : ni dans sa sortie, ni dans un fichier, ni dans un journal (M13,
  `CLAUDE.md` §20). Ni la clé racine, ni la clé privée `age`, ni un mot de passe déchiffré ;
- **aucun fichier hors** de son répertoire d'assemblage temporaire ;
- **aucune archive** : l'exercice lit, il ne produit pas de sauvegarde.

---

## 12. Contrat de comportement — tranche 2, cas o à z

| Cas | Situation | Attendu |
|---|---|---|
| o | Archive valide, pile de référence debout | Code `0`, les sept invariants comparés et égaux, environnement jetable détruit |
| p | Archive valide, identité correcte | `pg_restore` rend **0 erreur** ; `vault.decrypted_secrets` rend les cinq empreintes de la référence |
| q | **Clé racine remplacée par une autre dans l'archive** | I1 **échoue** — `invalid ciphertext` —, l'exercice rend `1`, et les autres invariants restent égaux : c'est la dégradation qui prouve que I1 sert (M12) |
| r | Empreinte d'un membre altérée dans le manifeste | R23, code `1`, **aucun conteneur jetable créé** |
| s | `format_version=2` dans le manifeste | R22, code `1`, aucun conteneur jetable créé |
| t | Identité `age` qui n'ouvre pas l'archive | R28, code `1`, aucun conteneur jetable créé |
| u | `RESTORE_AGE_IDENTITY_FILE` non renseignée | R21, code `1` |
| v | Archive inexistante, ou répertoire sans archive | R26, code `1` |
| w | Un conteneur porte déjà le nom jetable | R24, code `1`, et le conteneur existant **n'est ni touché ni détruit** |
| x | Exercice interrompu en cours de restauration | Le `trap` détruit l'environnement jetable ; la pile courante est intacte |
| y | Archive sans `objets.tar` (`depot_objet=externe`) | Aucun MinIO jetable créé, I7 **annoncé non applicable**, les six autres comparés |
| z | Après un exercice réussi ou échoué | `docker ps` ne porte **aucun** conteneur `p2enjoy-restauration-*`, et les 17 services de la pile sont intacts |

**Le cas q est celui qui rend cette tranche non complaisante**, et le cas w celui qui rend sa garde
de destruction éprouvée plutôt que promise.

---

## 13. Preuves exigées — tranche 2

| Niveau | Preuve |
|---|---|
| Harnais | `scripts/verify-restauration.sh` : exécute le **vrai** exercice sur une **vraie** archive produite par le **vrai** `scripts/backup.sh`, et couvre les cas o à z |
| Témoin | Le dépôt objet du seed étant **vide** (M6), le harnais y dépose un **objet témoin** avant de sauvegarder, et vérifie qu'il ressort du MinIO jetable. Il le retire ensuite, et constate son absence préalable |
| Non-complaisance | Les refus R21 à R26 sont éprouvés par **dégradation volontaire** de l'archive ou de l'environnement, et chacun exigé deux fois — code non nul **et** aucun conteneur jetable survivant |
| Dégradation centrale | Le cas **q** : une archive dont la clé racine est remplacée par une autre doit faire **échouer** I1. Sans cette épreuve, rien ne distingue un exercice qui vérifie le déchiffrement d'un exercice qui l'affirme |
| Isolement | Après chaque cas, le harnais vérifie que les conteneurs de la pile sont **toujours les mêmes**, par leur identifiant, et qu'aucun `p2enjoy-restauration-*` ne subsiste |
| Traçabilité | `scripts/verify-scripts.sh` : en-tête `@spec`, aide `--help`, `set -euo pipefail`, variables documentées |
| Documentation | `README.md`, `docs/DAT.md` §10, `.env.example`, `CHANGELOG.md`, `docs/BACKLOG.md` |

Comme pour la tranche 1 (§6), il n'y a ni test Vitest ni scénario Playwright : l'unité d'exécution
est un script shell, et le dépôt éprouve ses scripts par des harnais. L'écart est nommé, non
compensé par un test de substitution.

---

## 14. Limites nommées — tranche 2

- **Les rôles ne sont pas dans l'archive** (M11). `pg_dump` ne porte aucun objet global. Une
  restauration sur un hôte de secours doit donc recréer les rôles par le chemin d'amorçage de la
  pile — les scripts de `supabase/docker/volumes/db/` —, ce que l'exercice reproduit. Emporter
  `pg_dumpall --globals-only` dans l'archive changerait le format de la tranche 1 : c'est une
  décision d'architecture, à prendre explicitement, et elle appartient au runbook de la tranche 3.
  **Les mots de passe des rôles ne sont donc pas sauvegardés** ; ils viennent de
  `POSTGRES_PASSWORD`, c'est-à-dire de la configuration, non des données.
- **L'exercice restaure une base, pas une pile.** Il ne monte ni GoTrue, ni PostgREST, ni Kong :
  vérifier qu'une application se connecte à la base restaurée est un exercice différent, plus
  coûteux, et il n'est pas rendu ici. Ce que cet exercice prouve, il le prouve à la source — dans
  la base et dans le dépôt objet.
- **Aucune restauration en production.** L'exercice crée son propre environnement jetable et ne sait
  pas viser une pile existante. Restaurer une production est une opération humaine, décrite par le
  runbook de la tranche 3 (`CLAUDE.md` §9 et §12).
- **Aucune restauration à un instant quelconque (PITR)**, pour le motif du §8 : `wal-g` n'est activé
  par aucun service.
- **Le témoin objet est déposé par le HARNAIS, jamais par l'exercice.** L'exercice ne touche pas la
  pile courante (§11.7) ; c'est le harnais qui arrange une donnée probante, et qui la retire.

---

## 15. Definition of Done — tranche 2

- `scripts/restore-drill.sh` livré, exécutable, avec son aide et ses commentaires `@spec` ;
- l'environnement jetable du §11.1, sa garde de destruction structurelle du §11.2, et le déroulé du
  §11.3 ;
- les sept invariants du §11.4, dont **I1, le déchiffrement effectif d'un secret de Vault** ;
- les onze refus du §11.6, chacun **éprouvé** ;
- les deux variables du §11.5 documentées dans `.env.example` ;
- `scripts/verify-restauration.sh` couvrant les cas o à z, exécuté et **vert**, dont le **cas q**
  par dégradation volontaire de la clé racine ;
- `README.md`, `docs/DAT.md` §10 et `CHANGELOG.md` mis à jour dans le même changement ;
- `docs/BACKLOG.md` au véritable état — `CRM-080` reste `[~]` tant que la tranche 3 n'est pas
  livrée.
