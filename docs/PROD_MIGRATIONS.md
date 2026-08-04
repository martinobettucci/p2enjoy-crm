# Contrat de déploiement — P2Enjoy CRM

Ce document décrit **ce qu'un humain doit appliquer** pour déployer ou mettre à jour la
production. Il ne dérive jamais de l'état réel du projet : toute modification du schéma, des
services déployés ou des variables d'environnement le met à jour **dans le même changement**.

Aucune migration n'est appliquée automatiquement en production. Aucune opération décrite ici ne
s'exécute sans instruction humaine explicite.

---

## 1. Baseline de production

**Aucune.** Le produit n'a jamais été déployé.

| Élément | État |
|---|---|
| Environnement de production | Non provisionné |
| Schéma appliqué | Aucun |
| Dernière migration appliquée | Aucune |
| Version déployée | Aucune |

## 2. Prérequis à provisionner avant le premier déploiement

Ces éléments ne sont pas fournis par le dépôt et exigent une action humaine.

### 2.1 Infrastructure

| Élément | Détail |
|---|---|
| Hôte | Docker et Compose v2, ressources dimensionnées pour la pile Supabase complète |
| Nom de domaine applicatif | Pour la webapp et l'API |
| Certificats TLS | Obtenus par Caddy, ou fournis manuellement |
| Stockage objet | Bucket S3 ou compatible, avec ses accès dédiés |
| Sauvegardes | Destination et planification définies avant la mise en service |
| **Clé racine de Vault** | `/etc/postgresql-custom/pgsodium_root.key`, porté par le volume `db-config`. **Hors de `PGDATA`** : à inclure explicitement dans le périmètre de sauvegarde, avec les mêmes précautions qu'un secret (`CRM-004`, `docs/DAT.md` §10) |

### 2.2 Messagerie

Le produit **lit des boîtes en IMAP** et n'expose aucun serveur SMTP entrant : aucun
enregistrement MX ni ouverture du port 25 n'est nécessaire.

| Élément | Détail |
|---|---|
| Domaine des adresses de card | Renseigné dans `workspaces.inbound_domain`, par exemple `crm.exemple.tld` |
| Boîte système catch-all | Une boîte recevant tout le courrier de ce domaine, accessible en IMAP |
| Identifiants IMAP de la boîte système | Saisis **dans l'application**, jamais dans un fichier du dépôt |
| SPF, DKIM, DMARC | À publier pour chaque domaine utilisé comme adresse d'expédition, faute de quoi les envois seront classés en indésirables |
| Quotas d'envoi | Vérifier les limites du fournisseur SMTP avant de configurer `daily_quota` |

### 2.3 Variables d'environnement

Toutes documentées dans `.env.example`. À produire spécifiquement pour la production, avec des
valeurs distinctes de celles du développement.

**Ces valeurs sont produites par un humain.** `./runProd.sh` n'amorce aucun fichier
d'environnement et n'invente aucun secret : il se contente de refuser de démarrer tant que le
fichier n'est pas conforme. Partir de `.env.example`, remplacer chaque valeur `CHANGE_ME_*`, et
positionner `P2ENJOY_ENV_PROFILE=prod`.

| Variable | Rôle | Obligatoire |
|---|---|---|
| `P2ENJOY_ENV_PROFILE` | Doit valoir `prod`. Garde de `./runProd.sh`, qui refuse un fichier de développement, et de `./resetMe.sh`, qui refuse de détruire un environnement qui n'est pas local | Oui |
| `POSTGRES_PASSWORD` | Mot de passe de la base | Oui |
| `JWT_SECRET` | Signature des jetons | Oui |
| `ANON_KEY`, `SERVICE_ROLE_KEY` | Clés d'API Supabase, dérivées de `JWT_SECRET` | Oui |
| `SECRET_KEY_BASE` | Secret de session de Realtime et du pooler | Oui |
| `REALTIME_DB_ENC_KEY` | Chiffrement interne de Realtime | Oui |
| `API_EXTERNAL_URL`, `SUPABASE_PUBLIC_URL` | URL publiques | Oui |
| `VAULT_ENC_KEY` | Chiffrement des secrets de messagerie | Oui |
| `GLOBAL_S3_BUCKET`, `GLOBAL_S3_ENDPOINT`, `GLOBAL_S3_PROTOCOL`, `GLOBAL_S3_FORCE_PATH_STYLE`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `REGION` | Stockage des pièces jointes | Oui |
| `S3_PROTOCOL_ACCESS_KEY_ID`, `S3_PROTOCOL_ACCESS_KEY_SECRET`, `STORAGE_TENANT_ID`, `STORAGE_FILE_SIZE_LIMIT` | Paramétrage du service Storage | Oui |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_ADMIN_EMAIL` | Emails transactionnels (invitations, notifications) | Oui |
| `CRM_INBOUND_DOMAIN` | Domaine des adresses de card | Oui |
| `MAIL_MAX_ATTACHMENT_MB` | Borne d'ingestion des pièces jointes | Oui |
| `DISABLE_SIGNUP` | Doit valoir `true` : les comptes sont créés par invitation | Oui |
| `PASSWORD_MIN_LENGTH` | **Nouvelle variable (`CRM-011`).** Longueur minimale d'un mot de passe ; le défaut de GoTrue, 6, est mesuré comme réellement permissif. Valeur retenue : `12` (`docs/SPEC-auth.md` §4) | Oui |
| `APP_DOMAIN` | Domaine servi par Caddy | Oui |
| `CADDY_ACME_EMAIL` | Adresse de contact pour l'émission des certificats | Oui |
| `APPLY_MIGRATIONS` | Doit valoir `false` : aucune migration n'est appliquée automatiquement | Oui |
| `STACK_RLIMIT_NOFILE` | Descripteurs de fichiers réclamés par Realtime et le pooler ; défaut `100000`, à abaisser si la limite dure de l'hôte est inférieure | Non |
| `POOLER_TENANT_ID`, `POOLER_DEFAULT_POOL_SIZE`, `POOLER_MAX_CLIENT_CONN`, `POOLER_DB_POOL_SIZE`, `POOLER_PROXY_PORT_SESSION`, `POOLER_PROXY_PORT_TRANSACTION` | Paramétrage du pooler | Oui |

La liste exhaustive, développement compris, figure dans `.env.example`, où chaque variable est
documentée avec son rôle, son format et son caractère obligatoire. `scripts/verify-scripts.sh`
vérifie que ce gabarit couvre exactement les variables consommées par les fichiers Compose.

Aucune clé de production n'est utilisée pour les tests. Aucun environnement local n'est relié en
écriture à la base de production.

## 3. Migrations en attente

Ces migrations existent dans le dépôt et **n'ont jamais été appliquées en production**, celle-ci
n'étant pas provisionnée. Elles sont à appliquer dans l'ordre indiqué, une transaction par
fichier, par un humain — `APPLY_MIGRATIONS=false` interdit tout chemin automatique.

| Ordre | Fichier | Objectif | Dépendances | Retour arrière |
|---|---|---|---|---|
| 1 | `supabase/migrations/0001_identite_et_cloisonnement.sql` | Extension `pgcrypto`, schéma `app`, `profiles` et son trigger de création, `workspaces`, `workspace_members`, `track_members`, `channel_members`. RLS activée sans politique : refus par défaut. | Schéma `auth` créé par GoTrue : le service doit avoir démarré **avant** l'application. | `drop schema app cascade;` puis `drop table` des cinq tables et `drop trigger on_auth_user_created on auth.users`. Aucune donnée applicative n'est encore présente, donc aucune perte : ce retour arrière cessera d'être anodin dès la première mise en service. |
| 2 | `supabase/migrations/0002_fonctions_autorisation.sql` | Fonctions d'autorisation `app.resolve_access`, `app.workspace_role`, `app.is_workspace_member`, `app.is_workspace_admin`, et leurs privilèges d'exécution. **Aucune politique RLS** : le refus par défaut reste inchangé. | Migration 1 : le schéma `app` et la table `public.workspace_members` doivent exister. | `drop function` des quatre fonctions. Sans objet tant qu'aucune politique ne les appelle ; dès `CRM-012`, les retirer rendrait les politiques inopérantes et devra donc précéder ou suivre le retour arrière de celles-ci. |
| 3 | `supabase/migrations/0003_tracks.sql` | Table `public.tracks` (organisation de premier niveau), ses contraintes de valeur, le trigger d'attribution de `position`, ses **trois politiques RLS** — lecture par les membres du workspace, insertion et mise à jour par ses administrateurs — et la clé étrangère `track_members.track_id → tracks.id` qu'INC-010 avait différée. | Migrations 1 et 2 : `public.workspaces`, `public.track_members` et les fonctions `app.is_workspace_member` / `app.is_workspace_admin` doivent exister. | `drop table public.tracks cascade;` — la cascade retire la clé étrangère de `track_members` **et détruit tous les tracks**. Dès la première mise en service, ce retour arrière est destructif : il exige une sauvegarde préalable de `public.tracks`. |
| 4 | `supabase/migrations/0004_channels.sql` | Table `public.channels` (organisation de second niveau), l'unicité du slug **par track**, le trigger d'attribution de `position` dans la portée du track, ses **trois politiques RLS**, la contrainte d'unicité `tracks (id, workspace_id)` et la **clé étrangère composite** `channels (track_id, workspace_id) → tracks (id, workspace_id)` qui garantit que le `workspace_id` dénormalisé ne peut pas mentir à la RLS, ainsi que la clé étrangère `channel_members.channel_id → channels.id` qu'INC-010 avait différée. | Migrations 1 à 3 : `public.workspaces`, `public.tracks`, `public.channel_members` et les fonctions `app.is_workspace_member` / `app.is_workspace_admin` doivent exister. | `drop table public.channels cascade;` puis `alter table public.tracks drop constraint tracks_id_workspace_id_key;` — la cascade retire la clé étrangère de `channel_members` **et détruit tous les channels**. Dès la première mise en service, ce retour arrière est destructif : il exige une sauvegarde préalable de `public.channels`. |
| 5 | `supabase/migrations/0005_workflow_nodes_catalog.sql` | Table `public.workflow_nodes_catalog` (vocabulaire des états d'une card), l'unicité de la clé **par workspace**, ses contraintes de valeur — forme de la clé, libellé non blanc, `kind`, jeton de couleur, bornes de la probabilité, seuil de relance strictement positif —, le trigger d'attribution de `position` dans la portée du workspace, l'index partiel du catalogue actif et ses **trois politiques RLS** : lecture par les membres du workspace, insertion et mise à jour par ses administrateurs. **Aucune suppression n'est exposée.** | Migrations 1 et 2 : `public.workspaces` et les fonctions `app.is_workspace_member` / `app.is_workspace_admin` doivent exister. Aucune dépendance envers `tracks` ni `channels` : le catalogue n'a pas de parent intermédiaire. | `drop table public.workflow_nodes_catalog cascade;` — **destructif dès la première mise en service** : il détruit le vocabulaire du workspace, et avec lui toute comparabilité analytique historique. Il exige une sauvegarde préalable. À partir de `CRM-031`, la cascade emportera aussi les `workflow_steps` qui référencent ces nœuds, donc les workflows eux-mêmes : ce retour arrière devra alors être précédé de celui de la migration de `CRM-031`. |
| 6 | `supabase/migrations/0006_workflows.sql` | Tables `public.workflows`, `public.workflow_steps` et `public.workflow_transitions` (graphe des états d'une card), la cohérence de portée `scope` / `track_id`, l'unicité du workflow par défaut **par workspace**, l'unicité `(workflow, nœud)`, l'index unique partiel qui garantit **au plus une étape initiale**, les **clés étrangères composites** qui empêchent une transition de sortir de son workflow et une étape d'instancier le nœud d'un autre workspace, le trigger d'attribution de `position` dans la portée du workflow, **neuf politiques RLS**, et la clé étrangère `channels (workflow_id, workspace_id) → workflows (id, workspace_id)` qu'INC-029 avait différée. La suppression physique est exposée aux **étapes et transitions uniquement**, jamais aux workflows. | Migrations 1 à 5 : `public.workspaces`, `public.tracks`, `public.channels`, `public.workflow_nodes_catalog` et les fonctions `app.is_workspace_member` / `app.is_workspace_admin` doivent exister. | `alter table public.channels drop constraint channels_workflow_id_workspace_id_fkey;` puis `drop table public.workflow_transitions, public.workflow_steps, public.workflows cascade;` et enfin `alter table public.workflow_nodes_catalog drop constraint workflow_nodes_catalog_id_workspace_id_key;` — **destructif dès la première mise en service** : il détruit tous les workflows du workspace, donc les boards de tous les channels. Il exige une sauvegarde préalable. |

**VÉRIFICATION OBLIGATOIRE AVANT D'APPLIQUER LA MIGRATION 3.** Elle ajoute une clé étrangère sur
`public.track_members`. Si cette table contenait une ligne dont `track_id` ne correspond à aucun
track, l'`alter table` échouerait — et comme PostgREST attend la terminaison réussie du
`migrations-runner`, **la pile ne redémarrerait plus**. Aucun `not valid` n'est employé pour
contourner : il rendrait la contrainte décorative sur les lignes existantes
(`docs/JOURNAL.md`, décision 55).

```sql
-- Doit rendre zéro ligne. Sinon, arbitrer les orphelins AVANT d'appliquer la migration.
select tm.track_id, tm.user_id
  from public.track_members tm
 where not exists (select 1 from public.tracks t where t.id = tm.track_id);
```

**VÉRIFICATION OBLIGATOIRE AVANT D'APPLIQUER LA MIGRATION 4.** Même motif que la migration 3, sur
l'autre table de droits fins : elle ajoute une clé étrangère sur `public.channel_members`. Une
ligne orpheline ferait échouer l'`alter table` et **empêcherait la pile de redémarrer**.

```sql
-- Doit rendre zéro ligne. Sinon, arbitrer les orphelins AVANT d'appliquer la migration.
select cm.channel_id, cm.user_id
  from public.channel_members cm
 where not exists (select 1 from public.channels c where c.id = cm.channel_id);
```

**La migration 4 ajoute aussi une contrainte d'unicité à `public.tracks`**,
`tracks_id_workspace_id_key` sur `(id, workspace_id)`. L'ajout est **additif et sans risque** :
`(id)` étant déjà la clé primaire, le couple est unique par construction et ne peut refuser aucune
ligne existante. Il n'exige donc aucune vérification préalable, mais il coûte la construction d'un
index — négligeable à la cardinalité des tracks d'un workspace, à surveiller si elle devenait
grande. Cette contrainte est la **condition** de la clé composite de `channels` : la retirer
rendrait la seconde impossible à recréer (`docs/SPEC-channels.md` §2.4).

**VÉRIFICATION OBLIGATOIRE AVANT D'APPLIQUER LA MIGRATION 6.** Elle ajoute une clé étrangère sur
`public.channels`. Une ligne dont `workflow_id` ne correspondrait à aucun workflow ferait échouer
l'`alter table` et **empêcherait la pile de redémarrer**. Le cas est réel : `CRM-021` a livré la
colonne nullable, et toute valeur posée à la main avant cette migration serait orpheline.

```sql
-- Doit rendre zéro ligne. Sinon, arbitrer les orphelins AVANT d'appliquer la migration.
select c.id, c.workflow_id
  from public.channels c
 where c.workflow_id is not null
   and not exists (select 1 from public.workflows w
                    where w.id = c.workflow_id and w.workspace_id = c.workspace_id);
```

**La migration 6 ajoute aussi une contrainte d'unicité à `public.workflow_nodes_catalog`**,
`workflow_nodes_catalog_id_workspace_id_key` sur `(id, workspace_id)`. L'ajout est **additif et
sans risque**, pour la même raison que son jumeau sur `tracks` : `(id)` étant déjà la clé primaire,
le couple est unique par construction. Cette contrainte est la **condition** de la clé composite
des étapes ; la retirer rendrait la seconde impossible à recréer.

**La contrainte `NOT NULL` de `channels.workflow_id` n'est pas posée par cette migration.** Elle
reste due par `CRM-033` (INC-029). Une reprise des channels existants sera nécessaire ce jour-là :
tout channel sans workflow devra en recevoir un **avant** que la contrainte ne soit posée, sans quoi
l'`alter table` échouera et bloquera le démarrage de la pile.

**Particularité des migrations 3 à 6 : leurs contraintes de valeur sont convergentes.** Elles sont
posées par `drop constraint if exists` suivi d'`add constraint`, et non dans le `create table`,
qui porte `if not exists` et ne réparerait donc jamais une contrainte retirée à la main sur une
base existante. Conséquence en production : chaque passage **revalide** la table. Sur `tracks`,
`channels`, le catalogue et les workflows, dont la cardinalité est celle d'un workspace, le coût est
négligeable ; la propriété
achetée est que le schéma converge vers ce que le dépôt déclare.

**Toutes les migrations du dépôt sont idempotentes.** Le conteneur `migrations-runner` ne tient
aucun registre : il rejoue l'intégralité du répertoire à chaque démarrage de la pile
(`docs/DAT.md` §3.2, `docs/JOURNAL.md` décision 20). Une migration réappliquée sur une base déjà
migrée doit donc réussir sans effet de bord — vérifié par `scripts/verify-migrations.sh`.

En production, cette propriété ne dispense de rien : les migrations y sont appliquées à la main,
dans l'ordre de ce tableau, et le tableau est vidé une fois l'application confirmée.

### Commande d'application manuelle en production

```bash
# Depuis l'hôte de production, la pile démarrée et GoTrue sain.
# Une transaction par fichier, dans l'ordre du tableau ci-dessus.
for m in supabase/migrations/0001_identite_et_cloisonnement.sql \
         supabase/migrations/0002_fonctions_autorisation.sql; do
	docker exec -i p2enjoy-db psql -U postgres -d "$POSTGRES_DB" \
		--set ON_ERROR_STOP=1 --single-transaction -f - < "$m" || break
done
```

Après application, contrôler que les cinq tables portent bien RLS :

```sql
select relname, relrowsecurity from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public'
   and relname in ('profiles','workspaces','workspace_members',
                   'track_members','channel_members');
```

Contrôler ensuite que les quatre fonctions d'autorisation sont présentes, `SECURITY DEFINER` là où
il le faut, et que **toutes** fixent `search_path` :

```sql
select proname, prosecdef, provolatile, proconfig
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'app'
 order by proname;
```

Attendu : `resolve_access` en `SECURITY INVOKER` et `IMMUTABLE` (`prosecdef` faux, `provolatile`
`i`) ; `workspace_role`, `is_workspace_member` et `is_workspace_admin` en `SECURITY DEFINER` et
`STABLE` ; `proconfig` valant `{"search_path=\"\""}` sur chacune. Aucune politique RLS n'est
attendue à ce stade : `select count(*) from pg_policies where schemaname = 'public'` doit rendre
`0`.

## 4. Services à redéployer

| Service | Condition de redéploiement |
|---|---|
| `webapp` | À chaque changement d'interface — **et à chaque changement de `VITE_SUPABASE_URL` ou `VITE_SUPABASE_ANON_KEY`**, voir ci-dessous |
| `mail-sync` | À chaque changement du service de messagerie ou de ses dépendances |
| Pile Supabase | À chaque changement de version épinglée d'un composant (tableau dans `docs/DAT.md` §3.7) |
| `kong` | À chaque changement de `supabase/docker/volumes/api/kong.yml` |
| `caddy` | À chaque changement de `caddy/Caddyfile` |
| `auth` | À chaque changement d'une variable `GOTRUE_*`, dont `PASSWORD_MIN_LENGTH` livrée par `CRM-011` |

**Une variable ajoutée n'atteint pas un `.env` existant.** Les scripts n'amorcent que les fichiers
absents : un `.env` déjà en place ne gagne pas les variables introduites depuis. Le cas n'est pas
silencieux — la validation de `CRM-002` refuse le démarrage et **nomme** la variable manquante :

```
  manquante PASSWORD_MIN_LENGTH
ERREUR 1 variable(s) à corriger dans /chemin/.env. Le contrat est .env.example.
```

Comportement mesuré lors de la livraison de `CRM-011`. La marche à suivre est d'ajouter la
variable au fichier d'environnement de l'hôte, puis de recréer le service `auth`.

**La webapp de production n'est pas une image : c'est un répertoire.** `npm run build` produit
`webapp/dist` sur l'hôte, et `docker-compose.prod.yml` le monte en lecture seule dans Caddy. Le
déploiement d'une nouvelle interface consiste donc à **rebuilder puis recharger Caddy**, pas à
reconstruire une image.

**Les deux variables `VITE_*` sont figées au build**, pas lues au démarrage : elles sont inscrites
dans le bundle JavaScript. Les changer sans rebuilder n'a **aucun effet** — l'application
continuerait de viser l'ancienne adresse. Livrées par `CRM-007` :

| Variable | Rôle | Format |
|---|---|---|
| `VITE_SUPABASE_URL` | Adresse publique de l'API, telle que le **navigateur** doit la joindre | URL absolue |
| `VITE_SUPABASE_ANON_KEY` | Clé anonyme, publique par construction | JWT |

Absentes au build, l'application démarre et affiche « Configuration incomplète » : elle ne tombe
pas en panne silencieuse, mais elle ne sert à rien non plus. Le contrôle après déploiement est donc
d'ouvrir l'application et de vérifier que **cet écran n'apparaît pas**.

`WEBAPP_DEV_PORT`, également livrée par `CRM-007`, n'a **aucun effet en production** : elle ne sert
qu'à l'overlay de développement.

**Prérequis d'hôte à vérifier avant le premier démarrage.** Realtime et le pooler réclament
`STACK_RLIMIT_NOFILE` descripteurs de fichiers (défaut `100000`). Si la limite dure de l'hôte est
inférieure, les deux services redémarrent en boucle : contrôler `ulimit -Hn` et, le cas échéant,
relever la limite du démon Docker ou abaisser la variable.

## 5. Vérifications après déploiement

À exécuter avant de déclarer un déploiement réussi :

1. Tous les conteneurs sont sains.
2. La connexion à l'application fonctionne avec un compte réel.
3. Une card peut être créée et déplacée dans son workflow.
4. Un test de connexion IMAP et SMTP réussit depuis les réglages.
5. Un email envoyé à l'adresse d'une card est ingéré et classé.
6. Une réponse envoyée depuis une card parvient au destinataire avec le bon `Reply-To`.
7. Les preuves d'autorisation sont rejouées contre l'environnement déployé.
7 bis. **Le catalogue de nœuds du workspace n'est pas vide**, et sa lecture est refusée à un
   appelant anonyme : `GET /rest/v1/workflow_nodes_catalog` avec la seule clé anonyme doit rendre
   `200` et `[]`, et le même appel avec le jeton d'un membre doit rendre ses nœuds. Un catalogue
   vide en production signifie qu'aucun workflow ne pourra être assemblé (`CRM-031`).
8. Les sauvegardes s'exécutent et une restauration a été testée au moins une fois.
9. **La sauvegarde couvre le volume `db-config`**, et pas seulement la base : sans
   `pgsodium_root.key`, une restauration laisse les secrets de messagerie chiffrés et
   indéchiffrables. Contrôle rapide sur l'environnement restauré, avec le rôle `service_role` :
   `select decrypted_secret from vault.decrypted_secrets limit 1;` doit renvoyer une valeur, et
   non `invalid ciphertext`.

## 6. Procédure de retour arrière

| Situation | Action |
|---|---|
| Régression applicative | Redéployer l'image précédente ; le schéma restant compatible, aucune action base n'est requise |
| Migration défectueuse | Appliquer le script de retour arrière fourni avec la migration ; à défaut, restaurer la sauvegarde antérieure |
| Restauration de base sans la clé racine de Vault | **Aucun retour arrière possible** : le chiffré est intact mais définitivement illisible. Restaurer le volume `db-config` d'origine ; à défaut, chaque mot de passe IMAP/SMTP doit être ressaisi dans l'application |
| Messagerie défaillante | Arrêter `mail-sync` : le CRM reste utilisable, la file d'envoi est persistante et reprendra |

Toute migration non réversible doit **documenter explicitement pourquoi** et être précédée d'une
sauvegarde vérifiée.

## 7. Risques connus

- **Aucune restauration n'a encore été testée.** Tant que ce n'est pas fait, la capacité de
  reprise est une hypothèse, pas un fait.
- **La clé racine de Vault est un point de défaillance unique.** Elle vit hors de `PGDATA` et
  n'est reconstituable par aucun moyen : une sauvegarde qui l'omet est une sauvegarde qui perd
  tous les accès de messagerie. Le fait est mesuré (`scripts/verify-vault.sh`), la parade
  documentée, mais **la restauration complète reste non éprouvée**.
- **Réputation d'expédition** : un domaine neuf utilisé pour l'envoi est susceptible d'être
  filtré. Prévoir une montée en charge progressive.
- **Données personnelles** : le produit stocke la correspondance de tiers. La rétention et la
  purge doivent être configurées avant la mise en service réelle (unité `CRM-072`).

## 8. Historique des déploiements

Aucun déploiement à ce jour.
