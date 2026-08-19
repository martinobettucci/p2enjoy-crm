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
| Ports `80` et `443` | Libres sur l'hôte : ce sont les seuls que la production publie. `./runProd.sh` refuse de démarrer si l'un est tenu, en nommant son détenteur (`docs/JOURNAL.md`, décision 99) |
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
| `SECRET_KEY_BASE` | Secret de session de Realtime | Oui |
| `REALTIME_DB_ENC_KEY` | Chiffrement interne de Realtime | Oui |
| `API_EXTERNAL_URL`, `SUPABASE_PUBLIC_URL` | URL publiques | Oui |
| `GLOBAL_S3_BUCKET`, `GLOBAL_S3_ENDPOINT`, `GLOBAL_S3_PROTOCOL`, `GLOBAL_S3_FORCE_PATH_STYLE`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `REGION` | Stockage des pièces jointes | Oui |
| `S3_PROTOCOL_ACCESS_KEY_ID`, `S3_PROTOCOL_ACCESS_KEY_SECRET`, `STORAGE_TENANT_ID`, `STORAGE_FILE_SIZE_LIMIT` | Paramétrage du service Storage | Oui |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_ADMIN_EMAIL` | Emails transactionnels (invitations, notifications) | Oui |
| `CRM_INBOUND_DOMAIN` | Domaine des adresses de card | Oui |
| `MAIL_MAX_ATTACHMENT_MB` | Borne d'ingestion des pièces jointes | Oui |
| `MAIL_SYNC_INTERNAL_TOKEN` | Jeton dédié à l'API interne de `mail-sync`, aléatoire, 32 caractères ou plus ; distinct de toute clé Supabase | Oui |
| `MAIL_SYNC_LOG_LEVEL` | Niveau JSONL de `mail-sync` parmi `DEBUG`, `INFO`, `WARNING`, `ERROR`, `CRITICAL` ; `INFO` recommandé | Non |
| `DISABLE_SIGNUP` | Doit valoir `true` : les comptes sont créés par invitation | Oui |
| `PASSWORD_MIN_LENGTH` | **Nouvelle variable (`CRM-011`).** Longueur minimale d'un mot de passe ; le défaut de GoTrue, 6, est mesuré comme réellement permissif. Valeur retenue : `12` (`docs/SPEC-auth.md` §4) | Oui |
| `APP_DOMAIN` | Domaine servi par Caddy | Oui |
| `CADDY_ACME_EMAIL` | Adresse de contact pour l'émission des certificats | Oui |
| `APPLY_MIGRATIONS` | Doit valoir `false` : aucune migration n'est appliquée automatiquement | Oui |
| `STACK_RLIMIT_NOFILE` | Descripteurs de fichiers réclamés par Realtime ; défaut `10000`, à abaisser si la limite dure de l'hôte est inférieure | Non |

**Deux variables du service `mail-sync` deviennent obligatoires avec `CRM-052`.** Le conteneur ne
recevait pas `SERVICE_ROLE_KEY` tant qu'il ne consommait aucune table ; il la reçoit désormais, et
**refuse de démarrer sans elle** — un service qui écouterait sans clé offrirait une route de test
qui ne peut pas aboutir, et rendrait une erreur de configuration en guise de diagnostic de
connexion. `SUPABASE_URL` doit désigner la passerelle **sur le réseau interne** ; aucun port publié
n'est employé. `MAIL_SYNC_IMAP_TIMEOUT_SECONDS` reste facultative, avec un défaut de 10 secondes, et
`MAIL_SYNC_SMTP_TIMEOUT_SECONDS` également, avec un défaut de **30**. Cette dernière ne doit jamais
être ramenée au niveau de la première : un serveur d'envoi applique couramment un délai de pénalité
sur un échec d'authentification, et le test rapporterait alors un mot de passe faux comme un
dépassement de délai (`docs/JOURNAL.md`, décision 318).

La liste exhaustive, développement compris, figure dans `.env.example`, où chaque variable est
documentée avec son rôle, son format et son caractère obligatoire. `scripts/verify-scripts.sh`
vérifie que ce gabarit couvre exactement les variables consommées par les fichiers Compose.

**Aucune opération de production pour `NPM_CA_FILE` (`CRM-015`).** Cette variable facultative ne
sert qu'au secret BuildKit de l'image Vite de développement. La production sert `webapp/dist`
construit sur l'hôte et `docker-compose.prod.yml` ne consomme ni `NPM_CA_FILE`, ni `npm_ca`.

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
| 7 | `supabase/migrations/0007_copie_workflow.sql` | Fonction `public.copy_workflow_to_track(workflow_id, track_id, new_name)` — copie tracée d'un workflow global vers un track, arêtes remappées par le nœud — et vue `public.workflow_derivations`, qui porte le signal de divergence. Les **privilèges sont posés en nommant les rôles** : `revoke … from public` ne retire pas ce que les privilèges par défaut de l'image accordent nommément à `anon` (MESURÉ, `docs/JOURNAL.md` décision 80). La fonction n'est exécutable que par `authenticated` et `service_role` ; la vue est en lecture seule. | Migrations 1 à 6 : `public.tracks`, `public.workflows`, `public.workflow_steps`, `public.workflow_transitions` et les fonctions `app.is_workspace_member` / `app.is_workspace_admin` doivent exister. | `drop view public.workflow_derivations; drop function public.copy_workflow_to_track(uuid, uuid, text);` — **non destructif** : les copies déjà créées survivent, ce sont des workflows ordinaires. Seuls le geste de copie et le signal de divergence disparaissent. |
| 8 | `supabase/migrations/0008_coherence_workflow_channel.sql` | **Deux** triggers de cohérence workflow ↔ channel — `channels_verifier_workflow` (`BEFORE INSERT OR UPDATE OF workflow_id, track_id, workspace_id`) et `workflows_verifier_portee_occupee` (`BEFORE UPDATE OF scope, track_id`) — et la contrainte **`NOT NULL`** sur `channels.workflow_id` qu'INC-029 laissait due depuis `CRM-021`. Le second trigger n'était demandé par aucune spécification : la mesure a établi que **deux** des quatre écritures capables de casser la cohérence passent par `workflows` et non par `channels` (INC-040, `docs/JOURNAL.md` décision 89). | Migrations 1 à 6 : `public.channels`, `public.workflows` et `public.tracks` doivent exister. **Et une condition de données**, ci-dessous. | `drop trigger channels_verifier_workflow on public.channels; drop trigger workflows_verifier_portee_occupee on public.workflows; alter table public.channels alter column workflow_id drop not null; drop function app.channels_verifier_workflow(); drop function app.workflows_verifier_portee_occupee();` — **non destructif** : aucune donnée n'est perdue, seules les gardes disparaissent. Les rattachements incohérents créés après le retour arrière ne seront pas détectés. |

| 9 | `supabase/migrations/0009_champs_formulaire.sql` | Les deux tables du form composer : `public.form_fields` (champs d'un workflow, quinze types, options exigées pour `select`, `multiselect` et `money`, unicité **totale** de la clé par workflow, trigger d'attribution de `position`) et `public.form_field_rules` (visibilité d'un champ à une étape, clé primaire `(field_id, step_id)`, **trois clés étrangères composites** qui rendent structurellement impossible une règle croisant deux workflows). Six politiques RLS, privilèges explicites, et **aucun** privilège `DELETE` sur les champs — l'archivage tient lieu de suppression (`docs/JOURNAL.md` décisions 94 à 98). | Migrations 1 à 6 : `public.workflows` et `public.workflow_steps` doivent exister. **Aucune condition de données** : les deux tables sont créées vides. | `drop table public.form_field_rules; drop table public.form_fields; drop function app.form_fields_attribuer_position();` — **destructif au sens strict** : les définitions de formulaires et leurs règles sont perdues. Aucune autre table n'en dépend aujourd'hui, `card_field_values` n'étant pas livrée (`CRM-036`). |
| 10 | `supabase/migrations/0010_droits_fins.sql` | Les droits fins deviennent **opposables** : cinq fonctions `SECURITY DEFINER` (`app.can_read_track`, `app.can_read_channel`, `app.can_write_channel`, plus `app.track_workspace` et `app.channel_workspace`) et deux fonctions de résolution employées par les politiques (`app.resolve_track_access`, `app.resolve_channel_access`). Les politiques de **lecture** de `public.tracks` et de `public.channels` sont **redéfinies** pour appliquer les droits fins ; `public.track_members` et `public.channel_members` reçoivent leurs quatre politiques chacune — lecture par l'administrateur et par l'intéressé, écriture et **suppression** par l'administrateur (`docs/SPEC-permissions-rls.md` §4.1). `app.can_read_card` reste différée : `cards` arrive à `CRM-040`. | Migrations 1 à 4 : `public.tracks`, `public.channels`, `public.track_members`, `public.channel_members` et les fonctions de la migration 2 doivent exister. **DÉPENDANCE D'ORDRE STRICTE** : cette migration redéfinit `tracks_lecture_membre` et `channels_lecture_membre`, créées par les migrations 3 et 4. Réappliquer 3 ou 4 **après** celle-ci ramène les politiques à leur version sans droits fins — toute réapplication partielle doit donc se terminer par la 10 (`docs/JOURNAL.md` décision 108). | `drop policy` des huit politiques de `track_members` et `channel_members`, puis réapplication des migrations 3 et 4 pour restaurer les politiques de lecture d'origine, puis `drop function` des sept fonctions. **Non destructif** : aucune donnée n'est perdue. **Effet immédiat et visible** : les droits fins cessent d'être appliqués, et tout membre du workspace retrouve l'accès à tous les tracks et channels — c'est un **élargissement** d'accès, à ne pas exécuter sans l'avoir voulu. |


**VÉRIFICATION OBLIGATOIRE AVANT D'APPLIQUER LA MIGRATION 8.** Elle pose `NOT NULL` sur
`channels.workflow_id`. Si une seule ligne de `public.channels` portait `workflow_id` nul,
l'`alter table` échouerait — et comme PostgREST attend la terminaison réussie du
`migrations-runner`, **la pile ne redémarrerait plus**. Le comportement est voulu : une base dont le
contrat de schéma n'est pas tenable doit le dire, plutôt que démarrer en laissant croire qu'il l'est.

Elle pose également deux triggers de cohérence. Ils ne valident **pas** les lignes existantes — un
trigger ne s'applique qu'aux écritures futures. Une base qui porterait déjà un rattachement
incohérent le conserverait sans être signalée : la seconde requête ci-dessous le détecte.

```sql
-- Les deux doivent rendre zéro ligne. Sinon, arbitrer AVANT d'appliquer la migration 8.
select id, slug, track_id from public.channels where workflow_id is null;

select c.id, c.slug, c.track_id, w.scope, w.track_id as track_du_workflow
  from public.channels c
  join public.workflows w on w.id = c.workflow_id
 where not (w.scope = 'global' or (w.scope = 'track' and w.track_id = c.track_id));
```

**Reprise possible si la première requête rend des lignes** : rattacher chaque channel au workflow
par défaut de son workspace, puis vérifier de nouveau. Aucune reprise automatique n'est écrite ici —
choisir le workflow d'un channel est une décision métier, non une valeur par défaut
(`docs/JOURNAL.md`, décision 91).

**AUCUNE VÉRIFICATION PRÉALABLE POUR LA MIGRATION 9**, et la raison est écrite plutôt que
supposée : elle ne crée que des tables neuves, ne modifie aucune table existante et ne pose aucune
contrainte sur des données déjà présentes. Une production qui l'applique voit apparaître deux tables
vides ; aucun formulaire n'existe tant qu'un administrateur n'en a pas défini.

**CE QUE LA MIGRATION 10 CHANGE POUR LES UTILISATEURS EXISTANTS, ET QU'IL FAUT MESURER AVANT.**
Elle **restreint** des accès, ce qu'aucune migration précédente n'avait fait. Toute ligne déjà
présente dans `public.track_members` ou `public.channel_members` portant `access = 'none'` ou
`access = 'viewer'` devient **opposable au moment de l'application**, sans autre signal. Avant
d'appliquer :

```sql
select 'track' as portee, tm.access, count(*)
  from public.track_members tm group by 1, 2
union all
select 'channel', cm.access, count(*)
  from public.channel_members cm group by 1, 2;
```

Un résultat vide signifie qu'aucun accès n'est modifié. Sinon, chaque ligne restrictive doit être
confirmée avec le responsable du workspace concerné : un droit fin posé « pour plus tard » à une
époque où il ne produisait aucun effet deviendrait actif sans que personne l'ait décidé.

| 11 | `supabase/migrations/0011_cards.sql` | Table `public.cards` — l'objet métier principal —, ses **trois clés étrangères composites** (cloisonnement, workflow du channel, étape du workflow), le trigger de génération de `email_local_part` (`c-<8 base32 Crockford>`, non devinable), le trigger d'attribution de `position` dans la portée `(channel, étape)`, la colonne générée `search_tsv` et **cinq index** dont l'unicité globale de l'adresse, **trois politiques RLS** appliquant les droits fins dès la première ligne, `app.can_read_card` (dernier point d'INC-013), et la **garde d'archivage d'un nœud occupé** du catalogue qu'INC-031 attendait depuis `CRM-030`. Ajoute au passage à `public.channels` deux unicités **redondantes** — `channels_id_workspace_id_key` et `channels_id_workflow_id_key` — sans lesquelles les clés composites sont refusées à la création. | Migrations 1 à 10 : `public.workspaces`, `public.profiles`, `public.channels`, `public.workflows`, `public.workflow_steps`, `public.workflow_nodes_catalog` et les fonctions `app.can_read_channel` / `app.can_write_channel` doivent exister. **CONSÉQUENCE À CONNAÎTRE AVANT D'APPLIQUER** : la clé `cards_channel_id_workflow_id_fkey` rend **refusé** tout changement de `channels.workflow_id` sur un channel qui porte au moins une card (`23503`). Règle non spécifiée, consignée en INC-046 — arbitrage attendu. Aucune ligne n'existe sur les bases du projet hors du seed. | `drop table public.cards cascade;` puis `drop function app.can_read_card(uuid), app.cards_generer_email_local_part(), app.cards_attribuer_position(), app.catalogue_refuser_archivage_noeud_occupe();` et `alter table public.channels drop constraint channels_id_workflow_id_key, drop constraint channels_id_workspace_id_key;` — **destructif dès la première mise en service** : il détruit toutes les affaires du workspace. Il exige une sauvegarde préalable. Retirer le trigger d'archivage rouvre en outre l'archivage d'un nœud occupé, ce qui ferait disparaître une colonne de board sous ses cards. |
| 12 | `supabase/migrations/0012_move_card.sql` | Fonction `public.move_card(card_id, to_step_id, comment)` — **garde centrale de transition**, seul chemin par lequel une card change d'étape. Rend `public.cards`, remet `entered_step_at` à `now()`, recalcule `position` en fin de colonne d'arrivée. `SECURITY DEFINER`, `search_path` vide, `EXECUTE` **révoqué nommément à `public` et `anon`**, accordé à `authenticated` et `service_role`. **ET LA PROTECTION DE COLONNE QUI VA AVEC** : `revoke update on public.cards from authenticated`, suivi d'un `grant update (…)` énumérant treize colonnes. | Migration 11 : `public.cards`, `public.workflow_steps`, `public.workflow_transitions` et les fonctions `app.can_read_channel` / `app.can_write_channel` doivent exister. **CONSÉQUENCE À CONNAÎTRE AVANT D'APPLIQUER, et c'est un changement de contrat pour tout client existant** : `authenticated` perd l'`UPDATE` de **table** sur `cards`. Toute intégration qui écrivait `current_step_id`, `entered_step_at`, `workflow_id`, `channel_id`, `health_score` ou `workspace_id` par un `PATCH` direct recevra désormais `403`/`42501` et **doit passer par `move_card`**. Les treize colonnes énumérées restent ouvertes. `service_role` n'est pas touché : les scripts d'exploitation qui l'emploient sont inchangés. | `revoke update on public.cards from authenticated; grant update on public.cards to authenticated; drop function public.move_card(uuid, uuid, text);` — **rouvre la porte que cette migration ferme** : une card pourra de nouveau franchir une arête non déclarée par un simple `PATCH`. À n'exécuter que pour débloquer une intégration en production, et à refermer aussitôt. |
| 13 | `supabase/migrations/0013_valeurs_champs.sql` | Table `public.card_field_values` (réponses d'une card aux questions de son workflow), ses **trois clés étrangères composites**, la contrainte `UNIQUE (id, workflow_id)` ajoutée à `public.cards` — condition de la première, MESURÉ —, la **validation par type** de `value` par trigger `SECURITY DEFINER` (un `CHECK` ne peut porter aucune sous-requête, MESURÉ), `app.valeur_de_champ_est_vide`, `app.can_write_card`, deux index, trois politiques RLS, les privilèges explicites précédés d'un `revoke all` — sans lui, les privilèges par défaut de l'image laissent `DELETE` et `INSERT` à `anon` (`docs/JOURNAL.md` décision 134) —, et la **redéfinition de `public.move_card` avec sa SIXIÈME vérification**, `missing_required_fields`, dont le `DETAIL` porte la liste des clés manquantes. | Migrations 1 à 12 : `public.cards`, `public.form_fields`, `public.form_field_rules`, `public.workflows` et `public.profiles` doivent exister. **DÉPENDANCE D'ORDRE STRICTE** : cette migration **remplace** la définition de `public.move_card` posée par la migration 12. Réappliquer la 12 **après** celle-ci retire la sixième vérification, sans aucun signal — toute réapplication partielle doit donc se terminer par la 13. `scripts/verify-valeurs-champs.sh` mesure cette dépendance dans les deux sens. | `drop table public.card_field_values;` puis réapplication de la migration 12 pour restaurer `move_card` à cinq vérifications, puis `drop function app.card_field_values_valider(), app.valeur_de_champ_est_vide(jsonb), app.can_write_card(uuid);` et enfin `alter table public.cards drop constraint cards_id_workflow_id_key;` — **destructif au sens strict** : toutes les réponses de formulaire sont perdues, et elles ne se reconstituent pas. Il exige une sauvegarde préalable de `public.card_field_values`. **Effet immédiat sur le comportement** : les transitions redeviennent franchissables sans que les champs requis soient renseignés — c'est un **relâchement** de garde, à ne pas exécuter sans l'avoir voulu. |
| 14 | `supabase/migrations/0014_colonnes_protegees.sql` | **Protection de colonne** : retire à `authenticated` le privilège `UPDATE` sur `public.cards.email_local_part`, par la seule forme que PostgreSQL admette — `revoke update` de table, puis `grant update (…)` énumérant les **douze** colonnes qui restent ouvertes. Met à jour le commentaire de la colonne. **Aucune donnée n'est touchée, aucune structure n'est modifiée** : la migration ne pose que des privilèges. | Migrations 1 à 13 : `public.cards` doit exister. **DÉPENDANCE D'ORDRE STRICTE** : la section 2 de la migration 12 réapplique les mêmes privilèges **avec** `email_local_part` dans la liste. Réappliquer la 12 **après** celle-ci **rouvre** la colonne, sans aucun signal — toute réapplication partielle doit donc se terminer par la 13 **puis** la 14. `scripts/verify-colonnes-protegees.sh` mesure cette dépendance dans les deux sens, et `scripts/verify-cards.sh` comme `scripts/verify-valeurs-champs.sh` ont dû être repris pour chaîner la 14 derrière leurs rejeux de la 12 — la dépendance est **rétroactive** sur tout harnais antérieur. | Réapplication de la seule section 2 de la migration 12, qui rend `email_local_part` à la liste des colonnes ouvertes. **Non destructif** : aucune donnée n'est perdue. **Effet immédiat sur le comportement** : l'adresse entrante d'une card redevient réécrivable par tout membre qui écrit sur son channel, donc remplaçable par une valeur devinable — c'est un **relâchement** de garde, à ne pas exécuter sans l'avoir voulu. |
| 15 | `supabase/migrations/0015_commentaires.sql` | Table `public.card_comments` (fil de discussion d'une card), la contrainte `UNIQUE (id, workspace_id)` ajoutée à `public.cards` — condition de la clé étrangère composite, MESURÉ —, deux triggers `SECURITY INVOKER` (dérivation du workspace à l'insertion ; **pierre tombale**, colonnes gelées et `edited_at` à la mise à jour), un `CHECK` **conditionnel** sur `body` — 1 à 10 000 caractères tant que le commentaire vit, **chaîne vide** dès qu'il est supprimé —, un index, **trois politiques RLS** (aucune `DELETE`), les privilèges précédés d'un `revoke all` avec `update` limité à `(body, deleted_at)`, et l'**ajout de la table à la publication `supabase_realtime`**. | Migrations 1 à 13 : `public.cards`, `public.profiles` et `app.can_read_card` / `app.can_write_card` doivent exister. **AUCUNE dépendance d'ordre nouvelle** : cette migration ne repose aucun privilège d'une table qu'une autre migration touche — le piège 12 → 14 ne se reproduit pas. **CONSÉQUENCE À CONNAÎTRE AVANT D'APPLIQUER** : c'est la **première table du produit publiée au temps réel**. La publication `supabase_realtime` est créée si elle manque. Un flux de réplication logique s'ouvre donc sur cette table : le service `realtime` doit tourner, et le slot `supabase_realtime_replication_slot_` être actif — un slot inactif fait croître le WAL sans borne. | `alter publication supabase_realtime drop table public.card_comments; drop table public.card_comments; drop function app.card_comments_avant_insertion(), app.card_comments_avant_maj(); alter table public.cards drop constraint cards_id_workspace_id_key;` — **destructif au sens strict** : tous les commentaires sont perdus, et ils ne se reconstituent pas. Il exige une sauvegarde préalable de `public.card_comments`. Le retrait de la publication est, lui, non destructif et réversible. |

| 16 | `supabase/migrations/0016_timeline.sql` | Table `public.card_events` (mémoire d'une affaire, **append-only**), son `CHECK` de vocabulaire à **huit** valeurs, la clé étrangère composite vers `cards (id, workspace_id)` avec `ON DELETE CASCADE`, l'index de `docs/SCHEMA.md` §10, **une seule politique RLS** — la lecture —, des privilèges réduits à `SELECT` **pour les trois rôles, `service_role` compris**, un trigger `BEFORE UPDATE` d'immuabilité, et **cinq triggers `SECURITY DEFINER`** d'alimentation : deux sur `cards`, un sur `card_field_values`, plus la fonction d'écriture commune `app.card_event_ecrire`. | Migrations 1 à 15 : `public.cards`, `public.profiles`, `public.card_field_values`, `app.can_read_card`, et **l'unicité `cards (id, workspace_id)` posée par la migration 15**. **AUCUNE dépendance d'ordre nouvelle.** **CONSÉQUENCES À CONNAÎTRE AVANT D'APPLIQUER** : toute écriture existante sur `cards` et `card_field_values` produit désormais des lignes dans une table qui ne se purge pas — voir le contrat d'exploitation ci-dessous. | `drop table public.card_events cascade; drop function app.card_event_ecrire(uuid,uuid,text,jsonb), app.card_events_apres_insertion_card(), app.card_events_apres_maj_card(), app.card_events_apres_ecriture_valeur(), app.card_events_refuser_maj();` — **destructif au sens strict** : toute la mémoire des affaires est perdue et ne se reconstitue pas. Il exige une sauvegarde préalable de `public.card_events`. Les triggers tombent avec la table par la `cascade`. |
| 17 | `supabase/migrations/0017_move_card_to_channel.sql` | La fonction `public.move_card_to_channel(card_id, to_channel_id, to_step_id, discard_field_values)`, `SECURITY DEFINER`, `search_path` vide, `EXECUTE` **révoqué de `public` ET nommément d'`anon`** ; l'extension du `CHECK` de `card_events` de **huit à neuf** valeurs — `channel_changed` ; et le remplacement de `app.card_events_apres_maj_card()`, qui surveille désormais **cinq** colonnes et dont la garde `moved` est **conditionnée à `channel_id` inchangé**. **AUCUN privilège de colonne n'est posé ni retiré** : `channel_id`, `workflow_id` et `current_step_id` sont déjà fermés à `authenticated` depuis la migration 14 (décision 214). | Migrations 1 à 16 : `public.cards` (11), `public.move_card` (12), `public.card_field_values` (13), les privilèges de colonne (14), `card_events` et ses triggers (16). **AUCUNE dépendance d'ordre nouvelle.** **CONSÉQUENCE À CONNAÎTRE AVANT D'APPLIQUER, ET ELLE EST DESTRUCTIVE** : appelée avec `discard_field_values` à `true`, la fonction **supprime définitivement** les réponses de formulaire de la card déplacée lorsque le workflow change. La perte est explicite — le défaut est `false`, et le refus `field_values_would_be_lost` porte le nombre de réponses en `DETAIL` — mais elle est irréversible, et `card_field_values` n'a pas d'historique (décision 216). Les `field_changed` de `card_events`, eux, survivent. | `drop function public.move_card_to_channel(uuid, uuid, uuid, boolean);` puis rejouer la migration 16 pour restaurer `app.card_events_apres_maj_card()` dans sa forme à quatre gardes, et ramener le `CHECK` à huit valeurs — **ce dernier point exige d'abord de supprimer les lignes `channel_changed` déjà écrites**, MESURÉ : PostgreSQL refuse une contrainte que les lignes présentes violent. Or `card_events` n'accorde `DELETE` à personne : le retour arrière du vocabulaire suppose donc une intervention sous `postgres`, et il **détruit de la mémoire d'affaire**. |
| 18 — `CRM-017` | `supabase/migrations/0018_pg_cron.sql` | Installe `pg_cron`, ferme le schéma `cron` aux rôles API, crée le heartbeat privé `app.scheduler_heartbeat`, sa fonction et l'unique job nommé. Le premier passage après migration est attendu en quelques secondes puis le job revient à la minute 7 de chaque heure. | **Appliquer ce fichier en se connectant comme `supabase_admin`**, conformément à son marqueur ; il reprend ensuite le rôle `postgres` pour les objets et le job. PostgreSQL doit précharger `pg_cron` et `cron.database_name` doit viser `postgres` — propriétés déjà mesurées sur l'image épinglée. **Aucune donnée métier n'est modifiée.** Sur une production où `pg_cron` porterait déjà des jobs étrangers, l'installation les conserve ; le nom `p2enjoy-scheduler-heartbeat` doit être libre ou déjà conforme. | `select cron.unschedule('p2enjoy-scheduler-heartbeat'); drop function app.scheduler_heartbeat_tick(); drop table app.scheduler_heartbeat;` — ne pas supprimer l'extension, que des jobs ultérieurs peuvent partager. Seul l'état de supervision est perdu. |
| 19 — `CRM-018` | `supabase/migrations/0019_transition_required_fields.sql` | Migre `workflow_transitions.require_fields` vers `workflow_transition_required_fields`, pose les deux cascades, la cohérence de workflow et RLS, puis remplace `copy_workflow_to_track` et `move_card`. La copie remappe aussi champs, règles et exigences, stocke l'empreinte SHA-256 de composition source et la vue de dérivation compare cette empreinte pour voir jusqu'aux suppressions. | **Précontrôle obligatoire** : tout élément des tableaux doit résoudre un `form_fields` du même workspace ; sinon la migration s'arrête au lieu de perdre l'exigence. Un écart de workflow dans ce même workspace est recensé puis écarté conformément à INC-056. Migrations 6, 7, 9 et 13 appliquées. Les clients qui sélectionnent encore `require_fields` doivent être déployés dans le même changement. Une copie existante sans formulaire n'est pas complétée silencieusement : le plan de déploiement la recopie par le vrai geste après sauvegarde de ses éventuelles personnalisations. | Recréer la colonne, y agréger les liaisons par transition dans un ordre stable, restaurer les anciennes fonctions et la vue temporelle, puis supprimer la table et la colonne d'empreinte. Réversible pour les exigences effectives, mais réintroduit le défaut structurel d'INC-033 et perd la détection exacte des suppressions source ; retour arrière temporaire uniquement. |
| 20 — `CRM-019` | `supabase/migrations/0020_change_channel_workflow.sql` | Rend `cards_channel_id_workflow_id_fkey` différable mais initialement immédiate, livre `change_channel_workflow(channel_id, workflow_id, step_mapping, discard_field_values) returns setof cards`, étend la timeline à `workflow_changed` et rend exclusifs changement de channel, changement de workflow et transition. | **Aucune donnée métier n'est modifiée à l'application.** Avant déploiement, recenser les intégrations qui font un `PATCH` direct de `channels.workflow_id` : un channel occupé reste refusé hors RPC. L'appel détruit les réponses du channel uniquement avec `discard_field_values=true`; le défaut refuse en donnant leur compte. Le mapping doit couvrir exactement toutes les étapes occupées, cards archivées et corbeille comprises. | Retirer la RPC puis rendre la clé `NOT DEFERRABLE` est non destructif. Ramener le vocabulaire à neuf valeurs exige de supprimer sous `postgres` tous les `workflow_changed` existants : **destruction irréversible de timeline**, sauvegarde obligatoire. Conserver le dixième type est le retour arrière recommandé. |
| 21 — `CRM-022` | `supabase/migrations/0021_identites_et_memberships_surs.sql` | Ferme INC-014 : sept politiques sur profils, workspaces et memberships ; édition du profil propre bornée au nom/avatar ; contraintes de nom et d'avatar ; invariant différable du dernier admin ; auteur de commentaire nullable avec `ON DELETE SET NULL`. | **Précontrôle intégré et bloquant** : aucun nom legacy hors bornes, aucune URL d'avatar non sûre et aucun workspace peuplé sans admin. Un état faux lève `23514` avant toute modification. Le changement d'ACL peut rendre immédiatement visibles les identités d'une équipe ; vérifier que chaque membership existant est volontaire. La suppression d'un compte conserve désormais ses commentaires au lieu d'être refusée. | Le retour exact n'est plus non destructif dès qu'un compte a été supprimé : remettre `author_id NOT NULL` exigerait de supprimer sa parole ou de fabriquer un auteur. **Retour recommandé : conserver FK, nullabilité et contraintes**, redéployer l'application précédente et, si nécessaire, retirer seulement les sept politiques pour revenir temporairement au refus par défaut. Cela rend les identités invisibles mais ne détruit aucune donnée. |
| 22 — `CRM-052` | `supabase/migrations/0022_comptes_entrants_imap.sql` | Crée `mail_inbound_accounts`, ses deux index uniques partiels, ses quatre politiques et ses privilèges de colonne — `secret_id`, `status`, `last_error`, `last_checked_at`, `last_sync_at` et `sync_state` fermées en écriture à `authenticated`, `secret_id` révoquée aussi en **lecture**. Livre `app.upsert_mail_inbound_account` (seul chemin d'écriture, écrit le mot de passe dans Vault) et `app.mail_inbound_account_credentials` (`SECURITY DEFINER`, exécution réservée à `service_role`). | **Vault est un prérequis dur** : `supabase_vault` doit être installée et sa clé racine présente **hors de `PGDATA`**. Sa perte rend tout secret enregistré définitivement indéchiffrable — `docs/DAT.md` §10. Aucune donnée métier n'est modifiée à l'application : la table naît vide. Le service `mail-sync` doit recevoir `SERVICE_ROLE_KEY` **dans le même déploiement**, sans quoi le test de connexion rendra une erreur de configuration au lieu d'un diagnostic. | Retirer les deux fonctions puis la table est non destructif tant qu'aucun compte n'a été enregistré. **Dès qu'un compte existe, le retour détruit ses secrets Vault** : les lignes de `vault.secrets` référencées ne sont plus rattachables. Retour recommandé : conserver la table, retirer seulement les deux fonctions et le `SERVICE_ROLE_KEY` du service, ce qui rend la configuration inerte sans rien détruire. |
| 23 — `CRM-053` | `supabase/migrations/0023_identites_sortantes_smtp.sql` | Crée `mail_outbound_identities`, ses deux index uniques partiels d'identité par défaut, son trigger de rabattement **`BEFORE`**, ses deux politiques de lecture et ses privilèges de colonne — `secret_id`, `status`, `last_error` et `last_checked_at` fermées à `authenticated`, `secret_id` révoquée aussi en lecture. Livre `upsert_mail_outbound_identity`, `mail_outbound_identity_credentials` et `mail_outbound_identity_record_check`. | **Mêmes prérequis que la migration 22** : Vault installée et sa clé racine hors de `PGDATA`. Aucune donnée métier n'est modifiée : la table naît vide. `MAIL_SYNC_SMTP_TIMEOUT_SECONDS` doit rester **supérieure au délai de pénalité du serveur d'envoi** — mesuré à dix secondes sur la pile de développement —, sans quoi un mot de passe faux sera rapporté comme un dépassement de délai. `daily_quota` n'est appliqué par rien : l'envoi appartient à `CRM-058`. | Retirer les trois fonctions puis la table est non destructif tant qu'aucune identité n'a été enregistrée. **Dès qu'une identité existe, le retour détruit ses secrets Vault.** Retour recommandé : conserver la table, retirer seulement les fonctions. |
| 24 — `CRM-054` | `supabase/migrations/0024_ingestion_messages.sql` | Crée `mail_messages`, `mail_message_occurrences` et `mail_attachments`, leurs politiques de lecture — qui suivent la card, ou le compte pour une occurrence — et le bucket **privé** `mail-attachments`. Aucune écriture n'est ouverte au client : un message est un fait reçu. | **Le bucket naît privé et SANS politique de lecture, et c'est ce qui protège** : `storage.objects` accorde tous les privilèges à `anon` et `authenticated` — défaut de Supabase —, si bien que seule l'absence de politique refuse. Toute politique ajoutée ultérieurement **doit** être conditionnée à `av_status = 'clean'`, faute de quoi une pièce jointe infectée deviendrait téléchargeable. ClamAV doit être joignable depuis le service : sans lui, les pièces sont enregistrées `skipped`, donc non téléchargeables — jamais `clean`. | Retirer les trois tables et le bucket est non destructif tant qu'aucun message n'a été ingéré. **Dès qu'un message existe, le retour détruit les pièces jointes déposées** : les objets du bucket ne sont plus rattachables. Retour recommandé : conserver les tables et le bucket, retirer seulement la route de relève du service. |
| 25 — `CRM-055` | `supabase/migrations/0025_classement_messages.sql` | Ajoute `classified_by` et `classified_at` à `mail_messages`, étend `card_events_type_check` à un **onzième** type (`mail_received`), livre `app.card_par_adresse`, `public.classer_message_automatiquement` (règles 1, 2 et 4 du §4.4) et `public.classify_message` (classement manuel, réservé à `authenticated`). | L'extension du vocabulaire d'événements est **conditionnée** : elle ne s'applique que si la contrainte ne porte pas déjà `mail_received`, de sorte qu'un rejeu de tout le répertoire ne la re-rétrécit pas. La **règle 3** du classement est désactivée faute de table de contacts (`CRM-060`) ; ce n'est pas une panne. | Retirer les deux fonctions est non destructif. Ramener `card_events_type_check` à dix types exige qu'aucun événement `mail_received` n'existe : la contrainte serait refusée sinon. Retour recommandé : conserver le type, retirer les fonctions. |
| 26 — `CRM-056` | `supabase/migrations/0026_dossiers_imap.sql` | Crée `mail_folder_map` — correspondance entre une entité du produit et le dossier IMAP réellement créé, les **deux** chemins conservés —, sa politique de lecture qui suit le compte, `app.assainir_segment_dossier` et `public.chemin_dossier_card`. | Aucune donnée métier n'est modifiée : la table naît vide. La correspondance est le **seul** chemin de retour vers un dossier existant ; la perdre obligerait à recréer une arborescence à côté de l'ancienne, sans y déplacer les messages déjà rangés. | Retirer la table et les deux fonctions est non destructif côté base. **Les dossiers IMAP déjà créés survivent sur le serveur de messagerie** et deviendront orphelins : leur suppression est une opération manuelle, jamais automatique (`docs/SPEC-mail-subsystem.md` §4.5). |
| 27 — `CRM-056` | `supabase/migrations/0027_dossiers_renommage.sql` | Livre `public.chemin_dossier_entite(text, uuid)`, `public.dossiers_a_renommer(uuid)` — six colonnes, ordonnées de la **plus haute** profondeur à la plus basse — et `public.mail_folder_map_reparenter`. | **DÉPENDANCE D'ORDRE STRICTE** : cette migration `drop` puis recrée `dossiers_a_renommer`, dont le type de retour a changé — `CREATE OR REPLACE` le refuse, mesuré. La fonction n'est déclarée que **par ce fichier** ; la 26 ne la déclare pas, sans quoi les deux se disputeraient la signature à chaque rejeu du répertoire. | Retirer les trois fonctions est non destructif : le renommage des dossiers cesse, l'arborescence existante reste en place et la relève continue de classer dans les dossiers déjà connus. |
| 28 — `CRM-057` | `supabase/migrations/0028_inbox_visibilite.sql` | Tranche la visibilité d'un message **non classé** : elle suit la **boîte** où il a été vu (`app.boite_du_message_lisible`), et non plus personne. Révise les politiques de `mail_messages` et de `mail_attachments`, livre `app.peut_voir_message` et `app.piece_jointe_telechargeable`, ajoute à `classify_message` la garde « voir le message » en plus de « écrire dans la card », et livre `public.inbox_arborescence()`. | **ÉLARGISSEMENT D'ACCÈS VOULU** : les messages non classés deviennent lisibles par le propriétaire de la boîte et par les administrateurs du workspace, alors qu'ils ne l'étaient par personne. Vérifier avant application qu'aucun compte entrant n'a de `owner_id` inattendu. `app.boite_du_message_lisible` ne relit pas `mail_messages` : la politique de cette table l'appelle, et un prédicat qui relirait sa propre table casserait le `RETURNING` d'une écriture (décision 107). | Réappliquer les politiques de la migration 24 restaure l'état antérieur — les non classés redeviennent invisibles à tous —, puis `drop function` des quatre fonctions. **Non destructif** : aucune donnée n'est perdue. La garde de `classify_message` disparaîtrait avec elles : c'est un **retour en arrière de sécurité**, à ne pas exécuter sans l'avoir voulu. |
| 29 — `CRM-057` | `supabase/migrations/0029_pieces_jointes_telechargeables.sql` | Pose l'**unique** politique de lecture du bucket `mail-attachments` sur `storage.objects` : bucket ∩ statut `clean` ∩ message visible. Aucune écriture n'est ouverte. | **S'EXÉCUTE SOUS `supabase_admin`**, déclaré par `-- @migration-role: supabase_admin` : `storage.objects` appartient à `supabase_storage_admin`, dont `postgres` n'est pas membre — mesuré. La migration **28 doit être appliquée avant**, elle porte le prédicat. Rien d'autre n'est créé ici : une fonction `SECURITY DEFINER` créée sous un superutilisateur s'exécuterait avec ses droits. | `drop policy mail_attachments_objets_lecture on storage.objects`, sous `supabase_admin`. Le bucket redevient totalement fermé — état de la migration 24. **Non destructif** : les objets déposés restent en place. |
| 30 — `CRM-058` | `supabase/migrations/0030_envoi_sortant.sql` | Ajoute `direction` et `references_ids` à `mail_messages`, étend `card_events_type_check` à un **douzième** type (`mail_sent`), crée la file `mail_outbox` et sa politique de lecture, livre `queue_outbound_email` (six refus), `app.envois_du_jour`, `reserver_envois`, `marquer_envoi_reussi` et `marquer_envoi_echoue`. **Rend `daily_quota` nullable** et convertit les zéros non configurés en `NULL`. | **LE CHANGEMENT DE `daily_quota` EST INDISPENSABLE, ET MESURÉ** : `CRM-053` l'avait créée `not null default 0` en écrivant qu'aucun consommateur n'existait. Dès qu'un consommateur existe, ce zéro interdit **tout** envoi à **toutes** les identités — le premier appel de la garde a rendu `quota_exceeded`. `NULL` signifie désormais « aucun plafond », `0` garde son sens littéral. Vérifier avant application qu'aucune identité n'a de quota délibérément posé à zéro : la conversion le remonterait à « sans plafond ». | Retirer les quatre fonctions et la table est non destructif tant qu'aucun envoi n'a été mis en file. **Dès qu'un envoi existe, le retour perd l'historique de la file** ; les messages archivés, eux, restent dans `mail_messages`. Ramener `card_events_type_check` à onze types exige qu'aucun événement `mail_sent` n'existe. Restaurer `daily_quota not null default 0` **réinterdirait tout envoi** : à ne faire qu'avec le retrait de la garde. |
| 31 à 33 | `supabase/migrations/0031_resilience_envoi.sql`, `0032_reprise_rangement.sql`, `0033_quota_par_defaut.sql` | **LIGNES MANQUANTES — dérive consignée en INC-095.** Ces trois migrations existent dans le dépôt et ne sont décrites par aucune ligne de ce tableau. Leur objectif, leurs dépendances et leur retour arrière restent donc à documenter par les unités qui les ont livrées (`CRM-059`, `CRM-056`, `CRM-053`). Ne pas appliquer en production avant que cette dérive ne soit résorbée : le contrat ne décrit pas ce qu'elles font. | À documenter | À documenter |
| 34 — `CRM-012` | `supabase/migrations/0034_lecture_track_transitive.sql` | Livre `app.track_has_readable_channel(uuid)` (`STABLE`, `SECURITY DEFINER`, `search_path` vide, `EXECUTE` à `anon`, `authenticated` et `service_role`) et **élargit la politique de lecture** `tracks_lecture_membre` : un track est lisible dès qu'un de ses channels l'est. Ferme INC-085 et INC-075 — un droit fin de channel accordé sous un track fermé n'avait aucun chemin de navigation (décision 333, `docs/SPEC-permissions-rls.md` §3.3 bis). **Aucun changement de schéma** : ni table, ni colonne, ni contrainte. **N'ouvre aucun channel supplémentaire** et **ne confère aucun droit d'écriture** — les politiques de `channels` et l'écriture de `tracks` sont inchangées. | Migrations 1 à 4 et 10 : `public.tracks`, `public.channels`, `app.can_read_channel` et `app.resolve_track_access` doivent exister. | **Non destructif.** Rejouer le bloc §5 de `0010_droits_fins.sql` pour restaurer le prédicat étroit, puis `drop function app.track_has_readable_channel(uuid);`. Aucune donnée n'est touchée : le retour arrière **referme** l'accès en lecture au track porteur, et le défaut d'INC-085 réapparaît tel quel. |
| 35 — lot G (`CRM-034`, `CRM-036`, `CRM-043`) | `supabase/migrations/0035_commentaires_lot_g.sql` | Livre les quatre entrées du lot G en un seul geste, parce qu'elles touchent une seule table. **(1)** `app.btrim_blancs(text)` (`IMMUTABLE`, `SECURITY INVOKER`, `search_path` vide, `EXECUTE` à `anon`, `authenticated` et `service_role`) porte la classe des blancs au sens de `String.prototype.trim()`, énumérée en points de code pour ne pas dépendre du `ctype` de l'instance ; `app.valeur_de_champ_est_vide(jsonb)` et `public.move_card` l'appellent (INC-052). **(2)** `public.move_card` conserve le motif fourni dans `card_comments`, dans sa propre transaction, et borne sa longueur à 10 000 caractères par `comment_too_long` (INC-048). **(3)** Colonne `card_comments.deleted_by` (`uuid`, nullable, FK `profiles` `ON DELETE SET NULL`), écrite par le trigger et fermée au client : audit de la modération. **(4)** Politique `card_comments_moderation` — un `admin` du workspace supprime un commentaire qu'il peut lire —, bornée par `app.card_comments_avant_maj()` à la seule pose de `deleted_at` (`comment_moderation_limitee`). INC-072. | Migrations 2, 11, 13, 15 et 19 : `app.is_workspace_admin`, `app.can_read_card`, `app.valeur_de_champ_est_vide`, `public.card_comments` et `public.move_card` doivent exister. | **Changement de schéma ADDITIF et non destructif** — une colonne nullable, aucune suppression, aucune réécriture de donnée. Retour arrière : `drop policy card_comments_moderation on public.card_comments;`, puis rejouer les sections 4 et 6 de `0015_commentaires.sql` et la section 7 de `0019_transition_required_fields.sql` pour restaurer le trigger et `move_card` d'avant, puis `drop function app.btrim_blancs(text);` **après** avoir rejoué la section 4 de `0013_valeurs_champs.sql`, qui la référence. `deleted_by` peut rester : elle ne gêne rien. **Ce que le retour arrière REND** : le motif d'une transition redevient perdu, une tabulation redevient un motif valide, et plus aucun modérateur ne peut retirer un propos déplacé. |
| 36 — `CRM-076` | `supabase/migrations/0036_previsualisation_exigence.sql` | Livre `public.previsualiser_exigence(uuid, uuid, uuid)` (`STABLE`, **`SECURITY INVOKER`**, `search_path` vide, `EXECUTE` à `authenticated` et `service_role`, révoqué de `public` et `anon`) : miroir **en lecture seule** de la sixième garde de `move_card`, qui rend `sur_place` — les affaires déjà à l'étape visée — et `a_l_entree` — celles qui ne pourraient plus y entrer, champ vide au sens d'`app.valeur_de_champ_est_vide`. Sixième tranche de l'éditeur de workflows (`docs/SPEC-workflow-engine.md` §7 bis.13). `SECURITY INVOKER` est ici une **propriété de sécurité** et non un détail : un `DEFINER` annoncerait un nombre d'affaires que son lecteur n'a pas le droit d'ouvrir. Refuse par `previsualisation_cible` (`P0001`) un appel sans cible ou à deux cibles ; rend `0, 0` sur un champ archivé ou une cible inconnue. | Migrations 11, 13, 15, 19 et 35 : `public.cards`, `public.card_field_values`, `public.form_field_rules`, `public.workflow_transition_required_fields`, `public.workflow_transitions` et `app.valeur_de_champ_est_vide` doivent exister. | **Aucun changement de schéma** : ni table, ni colonne, ni contrainte, ni politique. La fonction ne garde rien et n'écrit rien — la garde reste `move_card`. Retour arrière : `drop function public.previsualiser_exigence(uuid, uuid, uuid);`. **Ce que le retour arrière REND** : l'éditeur de workflows cesse d'annoncer les effets d'une exigence et le dit à l'écran, sans que le geste lui-même soit empêché. |
| 37 — `CRM-077` | `supabase/migrations/0037_corbeille.sql` | Première tranche de la corbeille (`docs/SPEC-corbeille.md` §3.2). **(1)** `deleted_at timestamptz` et `deleted_by uuid` (FK `profiles` `ON DELETE SET NULL`) sur `public.tracks` et `public.channels` ; `deleted_by` seule sur `public.cards`, dont `deleted_at` datait de `CRM-040`. **(2)** `app.corbeille_avant_ecriture()` — une fonction pour les trois tables, trois triggers `BEFORE INSERT OR UPDATE` — écrit `deleted_by` côté serveur, la fige tant que la ligne reste en corbeille, l'efface à la restauration, et laisse passer le détachement référentiel d'un profil supprimé par une porte étroite (patron d'INC-076). **(3)** `UPDATE` sur `tracks` et `channels` passe du niveau TABLE au niveau COLONNE, `deleted_by` EXCLUE : un privilège de table implique toutes les colonnes et PostgreSQL n'en laisse pas retirer une seule. `cards` portait déjà ce patron depuis `CRM-013`. | Migrations 2, 5, 6 et 11 : `public.profiles`, `public.tracks`, `public.channels` et `public.cards` doivent exister. | **ADDITIF et non destructif** : trois colonnes nullables, aucune donnée réécrite, aucune cascade touchée, aucune politique ajoutée, aucune purge. **ATTENTION AU RETOUR ARRIÈRE** : `revoke update on tracks/channels from authenticated;` puis `grant update on public.tracks, public.channels to authenticated;` restaure le droit de table — l'omettre laisserait ces tables en lecture-écriture partielle. Ensuite `drop trigger tracks_corbeille on public.tracks;` (idem channels, cards), `drop function app.corbeille_avant_ecriture();`, puis les colonnes. **Ce que le retour arrière REND** : tracks et channels perdent toute corbeille, et l'audit des cards disparaît — les lignes déjà en corbeille restent en corbeille, leur `deleted_at` n'étant pas touché. | **TOUTE COLONNE AJOUTÉE PLUS TARD à `tracks` ou `channels` devra être accordée EXPLICITEMENT** en `UPDATE`, faute de quoi elle sera silencieusement non modifiable par le client. C'est le coût assumé du droit colonne par colonne, déjà porté par `cards`. |
| 38 — `CRM-077` | `supabase/migrations/0038_corbeille_restauration.sql` | Deuxième tranche de la corbeille (`docs/SPEC-corbeille.md` §3.4). Deux fonctions et deux triggers `BEFORE UPDATE` : `app.channels_restauration_verifier_parent()` refuse de restaurer un channel dont le track est en corbeille ; `app.cards_restauration_verifier_parent()` refuse une affaire dont le channel **OU** le track l'est — les DEUX niveaux, un seul laisserait rendre l'affaire à un endroit tout aussi introuvable d'un cran plus haut. Refus `parent_en_corbeille` (`P0001`). Les gardes ne se déclenchent QUE sur la transition « était en corbeille, ne l'est plus » : toute autre écriture passe sans lecture du parent. | Migration 37 : `deleted_at` doit exister sur `tracks`, `channels` et `cards`. | **AUCUN changement de schéma** : ni table, ni colonne, ni contrainte, ni politique, ni privilège. Retour arrière : `drop trigger channels_restauration_parent on public.channels;`, `drop trigger cards_restauration_parent on public.cards;`, puis les deux fonctions. **Ce que le retour arrière REND** : il redevient possible de restaurer un enfant sous un parent supprimé, c'est-à-dire de le rendre à un endroit où personne ne le verra — l'écran répondrait « c'est fait » sans que rien ne soit rendu. | La garde s'applique à TOUS les rôles, propriétaire et clé de service compris : c'est une règle de cohérence, non une règle d'autorisation. Un script de reprise qui restaurerait en masse doit donc remonter l'arborescence des parents avant les enfants. |
| 39 — `CRM-078` | `supabase/migrations/0039_versionnement_workflows.sql` | Première tranche du versionnement des workflows (`docs/SPEC-workflow-engine.md` §7 ter). Extrait `app.workflow_composition_document(uuid)` du corps de `app.workflow_composition_fingerprint(uuid)`, qui devient son appelant — **la valeur rendue est inchangée**, ce que deux assertions pgTAP figent sur les workflows du seed. Crée `public.workflow_versions` (photographie immuable, numérotée par workflow), son trigger `BEFORE UPDATE` de refus de mutation, son unique politique de lecture, ses privilèges, et la RPC `public.publish_workflow_version(uuid, text)` avec ses cinq refus. | Migrations 6 à 9 et 19 : `workflows`, `workflow_steps`, `workflow_transitions`, `form_fields`, `form_field_rules` et `workflow_transition_required_fields` doivent exister — le document canonique les lit toutes les six. | **Table, trigger, politique, privilèges et deux fonctions ajoutés ; rien de retiré ni de modifié en place** hors la réécriture du corps de `app.workflow_composition_fingerprint`, dont la valeur rendue est identique. Retour arrière : `drop function public.publish_workflow_version(uuid, text);`, `drop table public.workflow_versions;`, puis restaurer le corps historique de `app.workflow_composition_fingerprint` **avant** de supprimer `app.workflow_composition_document` — l'ordre inverse laisserait l'empreinte cassée et ferait diverger la vue `public.workflow_derivations`. | Publier une version **ne change rien** au comportement du produit : `move_card` ne consulte aucune version, et les cards circulent toujours sur la structure vivante. Aucun appelant existant n'est cassé. La table croît d'une ligne par publication explicite, jamais automatiquement. |
| 40 — `CRM-078` | `supabase/migrations/0040_comparaison_versions_workflow.sql` | Deuxième tranche du versionnement des workflows (`docs/SPEC-workflow-engine.md` §7 ter.11). Crée `app.composition_collection_diff(jsonb, jsonb, text[])` — l'algorithme de différence, appelé six fois — et la RPC `public.compare_workflow_versions(uuid, uuid)`, `STABLE` et **`SECURITY INVOKER`**, avec ses quatre refus. | Migration 39 : `public.workflow_versions` doit exister, et les documents conservés portent les six clés du §7 ter.2. | **Deux fonctions ajoutées ; aucune table, aucune politique, aucun privilège de table modifiés.** La RPC n'écrit RIEN : elle est `STABLE`. Retour arrière : `drop function public.compare_workflow_versions(uuid, uuid);` puis `drop function app.composition_collection_diff(jsonb, jsonb, text[]);` — dans cet ordre, la seconde étant appelée par la première. | Aucun appelant existant n'est cassé : les deux fonctions sont neuves. `EXECUTE` est **révoqué nommément à `anon`** sur la RPC ; vérifier après application que `\df+ public.compare_workflow_versions` ne montre pas `anon`. |
| 41 — `CRM-078` | `supabase/migrations/0041_plan_remappage_cards.sql` | Troisième tranche du versionnement des workflows (`docs/SPEC-workflow-engine.md` §7 ter.12). Crée la RPC `public.plan_card_remapping(uuid, jsonb, integer)`, `STABLE` et **`SECURITY INVOKER`**, avec ses huit refus : avant de restaurer une version, elle dit **card par card où l'affaire atterrit** — `unchanged` quand l'étape existe des deux côtés, `remapped` quand l'appelant a donné une instruction, `unresolved` sinon. **Aucune destination n'est devinée.** La liste des affaires est bornée par `card_limit` (défaut 200, maximum 1000) et sa troncature est annoncée ; les compteurs, eux, portent sur la totalité. | Migrations 6, 11, 39 : `workflow_steps`, `workflow_nodes_catalog`, `cards` et `public.workflow_versions` doivent exister, et les documents conservés portent les six clés du §7 ter.2. | **Une fonction ajoutée ; aucune table, aucune colonne, aucune politique, aucun privilège de table modifiés.** La RPC n'écrit RIEN : elle est `STABLE`, et elle ne crée aucune table temporaire — PostgREST autorisant `GET` sur une fonction `STABLE`, donc une transaction en lecture seule. Retour arrière : `drop function public.plan_card_remapping(uuid, jsonb, integer);`. **Ce que le retour arrière REND** : rien du produit livré ne cesse de fonctionner — aucune restauration n'existe encore pour en dépendre. | Aucun appelant existant n'est cassé : la fonction est neuve. `EXECUTE` est **révoqué nommément à `anon`** ; vérifier après application que `\df+ public.plan_card_remapping` ne montre pas `anon`. **Le résultat n'est exhaustif que pour un administrateur** — c'est la vérification 3 qui le garantit, la règle 2 d'`app.resolve_access` voulant qu'un administrateur ne soit jamais restreint par un droit fin. |
| 42 — `CRM-078` | `supabase/migrations/0042_restauration_version_workflow.sql` | Quatrième tranche du versionnement des workflows (`docs/SPEC-workflow-engine.md` §7 ter.13). Crée la RPC `public.restore_workflow_version(uuid, jsonb, text)`, `VOLATILE` et **`SECURITY DEFINER`**, propriétaire `postgres` : elle rend la composition vivante égale à celle qu'une version a photographiée, **en une transaction ou pas du tout**. Elle rejoue `plan_card_remapping` dans sa propre transaction et exige `ready` ; publie d'abord la composition vivante comme **point de retour** par la vraie RPC `publish_workflow_version`, sauf lorsque la dernière version joue déjà ce rôle. | Migrations 6, 9, 11, 19, 39, 41 : `workflow_steps`, `workflow_transitions`, `form_fields`, `form_field_rules`, `workflow_transition_required_fields`, `cards`, `workflow_versions` et `plan_card_remapping` doivent exister. | **Une fonction ajoutée ; aucune table, aucune colonne, aucune politique, aucun privilège de table modifiés.** La fonction ÉCRIT, à la différence des trois précédentes de l'unité : elle déplace des affaires, supprime et recrée des étapes, des arêtes, des règles et des champs requis, et **archive** — jamais ne supprime — les champs surnuméraires. Retour arrière : `drop function public.restore_workflow_version(uuid, jsonb, text);`. **Ce que le retour arrière REND** : rien du produit livré ne cesse de fonctionner — aucun écran ne l'appelle encore, l'interface appartenant à la cinquième tranche. | `EXECUTE` est **révoqué nommément à `anon`** ; vérifier après application que `\df+ public.restore_workflow_version` ne montre pas `anon` et que le propriétaire est bien `postgres`, faute de quoi le `SECURITY DEFINER` prêterait les droits d'un autre rôle. **Le geste est réservé aux administrateurs**, et sa vérification 2 porte `app.is_workspace_member` écrite à la main : sous `definer`, la RLS ne masque plus les versions d'autrui. **Vérifier aussi que la vérification 5 rend bien `409` et non `400`** : elle lève le `SQLSTATE` `PT409`, le seul mécanisme par lequel une fonction choisit son code HTTP sous PostgREST, et c'est le seul refus de cette fonction dont le `SQLSTATE` n'est pas `P0001`. Un appel avec un `expected_live_fingerprint` volontairement faux doit rendre `409` ; un `400` signalerait que la migration appliquée est l'ancienne rédaction. |
| 43 — `CRM-032` | `supabase/migrations/0043_comparaison_copie_source.sql` | Dernière tranche de `CRM-032` (`docs/SPEC-workflow-engine.md` §4 ter). Crée `app.workflow_composition_naturel(uuid)`, qui ré-exprime le document canonique en clés naturelles — `node_id` pour les étapes, le couple de nœuds pour les arêtes, `key` pour les champs —, et la RPC `public.compare_workflow_with_source(uuid)`, `STABLE` et **`SECURITY INVOKER`**, qui dit en quoi une copie s'écarte de sa source. Elle réutilise `app.composition_collection_diff` de la migration 40, appelée cinq fois. | Migrations 6, 7, 9, 19, 39 et 40 : `workflows` avec `derived_from_workflow_id`, `workflow_steps`, `workflow_transitions`, `form_fields`, `form_field_rules`, `workflow_transition_required_fields`, `app.workflow_composition_document` et `app.composition_collection_diff` doivent exister. | **Deux fonctions ajoutées ; aucune table, aucune colonne, aucune politique, aucun privilège de table modifiés.** Les deux sont `STABLE` et **n'écrivent rien** : le §4.1 interdit toute réapplication automatique. Retour arrière : `drop function public.compare_workflow_with_source(uuid); drop function app.workflow_composition_naturel(uuid);`. **Ce que le retour arrière REND** : rien du produit livré ne cesse de fonctionner — aucun écran ne l'appelle, le geste d'interface restant dû (§4 ter.7). | `EXECUTE` est **révoqué nommément à `anon`** sur `public.compare_workflow_with_source` ; vérifier après application que `\df+ public.compare_workflow_with_source` ne montre pas `anon`, faute de quoi un appelant anonyme rendrait `403` au lieu de `401` et le contrôle 1 serait le seul rempart. Vérifier aussi qu'un appel sur le workflow **par défaut** rend `400` / `workflow non derive` : un `200` signalerait que le refus n° 3 manque. |
| 44 — `CRM-081` | `supabase/migrations/0044_snooze_cards.sql` | Première tranche de la mise en sommeil (`docs/SPEC-cards.md` §16). Étend le vocabulaire de `card_events` de douze à **quatorze** valeurs — `snoozed`, `woken` — et devient la **dernière autorité** sur `card_events_type_check` ; ajoute le trigger `card_events_apres_maj_sommeil` sur `public.cards` et sa fonction `app.card_events_apres_maj_sommeil()` ; **RETIRE à `authenticated` le privilège `UPDATE` sur `cards.snoozed_until`** ; crée les RPC `public.snooze_card(uuid, timestamptz)` et `public.wake_card(uuid)`, `SECURITY DEFINER`, propriétaire `postgres`. | Migrations 11, 14 et 16 : `cards`, ses privilèges de colonne et `card_events` doivent exister. | **Un privilège de colonne RETIRÉ, une contrainte remplacée, un trigger et trois fonctions ajoutés ; aucune table, aucune colonne, aucune politique nouvelles.** Le retrait de privilège est le seul point à conséquence : tout client qui écrirait `snoozed_until` par un `PATCH` reçoit désormais `403`. **Aucun n'existe** — MESURÉ, aucun composant de `webapp/` ne l'écrit (`docs/SPEC-cards.md` §15 bis.10). Retour arrière : `drop function public.snooze_card(uuid, timestamptz); drop function public.wake_card(uuid); drop trigger card_events_apres_maj_sommeil on public.cards; drop function app.card_events_apres_maj_sommeil(); grant update (snoozed_until) on public.cards to authenticated;` — la contrainte élargie peut RESTER, un vocabulaire plus large ne refuse rien de ce qui existait. **Ce que le retour arrière REND** : la colonne redevient une saisie libre non gardée, et les événements déjà écrits restent — `card_events` est append-only. | Vérifier après application que `\df+ public.snooze_card` ne montre pas `anon` — un `revoke ... from public` ne suffit pas dans le schéma `public` (décision 80), le `revoke` est nominatif — et que `has_column_privilege('authenticated','public.cards','snoozed_until','update')` rend **`f`**. Vérifier enfin qu'un appel avec une échéance passée rend `400` / `snooze_date_in_past` : un `200` signalerait une rédaction antérieure. |
| 45 — `CRM-060` | `supabase/migrations/0045_contacts_et_organisations.sql` | Première tranche des contacts et organisations (`docs/SPEC-contacts.md` §1 à §5). Crée les trois tables `public.organizations`, `public.contacts` et `public.card_contacts`, avec **FK composites** portant `workspace_id` pour interdire structurellement toute liaison entre workspaces différents (aucun trigger requis). RLS activée, quatre politiques nommées par table (lecture, insertion, MAJ, suppression). Lecture ouverte aux membres du workspace ; écriture ouverte au `business_developer` **et** à l'`admin` — `app.workspace_role(workspace_id) IN ('business_developer','admin')`. `card_contacts` compose `app.can_read_card` en lecture et `app.can_write_card` en écriture. Unicités **partielles** : `(workspace_id, lower(domain))` sur `organizations` et `(workspace_id, lower(email))` sur `contacts`, un objet sans domaine ou sans email étant licite. La FK `contacts → organizations` emploie **`ON DELETE SET NULL (organization_id)`** — la liste explicite évite d'annuler `workspace_id NOT NULL` (bug trouvé par la suite pgTAP, corrigé dans le même changement). | Migrations 1, 2 et 11 : `workspaces`, `app.workspace_role`, `app.is_workspace_member`, `app.can_read_card`, `app.can_write_card` et `cards` doivent exister ; PG ≥ 15 pour la syntaxe `ON DELETE SET NULL (colonne)`. | **Trois tables ajoutées, aucune existante modifiée.** Aucun consommateur existant ne dépend de ces tables : les décisions 132 et 295 laissaient explicitement les résolutions `contact` en attente jusqu'à cette unité. Retour arrière : `drop table if exists public.card_contacts, public.contacts, public.organizations cascade;` — rien du produit livré ne cesse de fonctionner, ces tables n'ont pas encore d'appelant. **Ce que le retour arrière REND** : rien à récupérer si le seed n'a pas été appliqué ; sinon, sauvegarder les trois tables avant le drop. | Vérifier après application que `to_regclass('public.organizations')`, `to_regclass('public.contacts')` et `to_regclass('public.card_contacts')` sont non nuls, que `select count(*) from pg_policies where tablename in ('organizations','contacts','card_contacts')` rend `12` (quatre par table), et qu'un `INSERT` par une lectrice reçoit `42501` sur les trois tables. Vérifier aussi que supprimer une organisation qui porte un contact détache le contact **sans** l'emporter et **sans** violer la contrainte NOT NULL sur `workspace_id`. |
| 46 — `CRM-060` | `supabase/migrations/0046_regle3_suggestion_classement.sql` | Tranche 2 des contacts : activation de la règle 3 du classement (`docs/SPEC-contacts.md` §8, `docs/SPEC-mail-subsystem.md` §16.2). Ajoute deux colonnes facultatives à `public.mail_messages` — `suggested_card_id` (FK `cards` `ON DELETE SET NULL`) et `suggested_at` — et **redéfinit** `public.classer_message_automatiquement(uuid, text, text[])` par `CREATE OR REPLACE` pour y insérer la règle 3 : un expéditeur contact rattaché à **exactement une** card active reçoit sa card en suggestion, le message restant **non classé** (`classification` inchangée, `card_id` nul, aucun `card_event`). La règle 3 n'est atteinte que si les règles 1 et 2 sont muettes. | Migrations 24, 25 et 45 : `mail_messages`, `classer_message_automatiquement` et les tables `contacts`/`card_contacts` doivent exister. | **Deux colonnes ajoutées à une table existante, une fonction redéfinie ; aucune politique, aucun privilège de table modifiés.** L'ACL de la fonction est préservée par `CREATE OR REPLACE` (signature identique) et ré-affirmée par prudence : `service_role` seul l'exécute. **Aucun appelant existant n'est cassé** : la fonction rend toujours la card classée ou `null`, contrat inchangé ; `mail-sync` la consomme sans modification. Retour arrière : restaurer le corps de la fonction depuis la migration `0025` (règles 1, 2, 4 seules), puis `alter table public.mail_messages drop column if exists suggested_at, drop column if exists suggested_card_id;`. **Ce que le retour arrière REND** : les suggestions déjà calculées disparaissent avec les colonnes ; rien du classement 1/2/4 ne change. | Vérifier après application que `has_column('public','mail_messages','suggested_card_id')`, qu'un message non classé d'un expéditeur contact à une seule card active reçoit `suggested_card_id` non nul en restant `unclassified`, et que `\df+ public.classer_message_automatiquement` ne montre pas `authenticated` (réservée à `service_role`). |
| 47 — `CRM-060` | `supabase/migrations/0047_resolution_champs_contact_user.sql` | Tranche 3 des contacts : **résolution** des champs de formulaire de type `contact` et `user` (`docs/SPEC-contacts.md` §9, `docs/SPEC-form-composer.md` §6.5, décision 295, INC-053). **Redéfinit** `app.card_field_values_valider()` par `CREATE OR REPLACE` : les deux types ne valident plus la seule FORME d'un `uuid`, ils exigent que la cible existe **dans le workspace de la valeur écrite** — une ligne de `public.contacts` pour `contact`, une ligne de `public.workspace_members` pour `user`. Le trigger `card_field_values_valider` est ré-affirmé à l'identique. **Aucune colonne, aucune table, aucune politique, aucun privilège de table ne bouge.** | Migrations 13 (la fonction et son trigger) et 45 (`public.contacts`). La 47 doit être appliquée **après** tout rejeu de la 13, qui la ramènerait à sa version sans résolution (INC-154). | **CE DÉPLOIEMENT RESSERRE UNE VALIDATION : des écritures aujourd'hui acceptées seront refusées.** Un client qui envoie un `uuid` de contact ou de membre inexistant recevra `400 invalid_field_value` là où il recevait `201`. **Les lignes DÉJÀ EN BASE ne sont pas revalidées** — le trigger est `BEFORE INSERT OR UPDATE` — mais toute mise à jour ultérieure d'une telle ligne sera refusée tant que sa valeur ne désigne rien. **À VÉRIFIER AVANT APPLICATION** : `select v.card_id, v.field_id, v.value from public.card_field_values v join public.form_fields f on f.id = v.field_id where f.type in ('contact','user') and v.value is not null and v.value <> 'null'::jsonb;` — si ce relevé n'est pas vide, confronter chaque valeur à `contacts` et `workspace_members` du même workspace avant de migrer. Retour arrière : rejouer `supabase/migrations/0013_valeurs_champs.sql` **puis** `0014_colonnes_protegees.sql`, `0019_transition_required_fields.sql` et `0035_commentaires_lot_g.sql`, la 13 redéfinissant aussi `move_card`. **Ce que le retour arrière REND** : les références mortes redeviennent acceptées ; aucune donnée n'est perdue. | Vérifier après application qu'un champ de type `contact` refuse un `uuid` inexistant en `400 invalid_field_value` avec un `details` contenant « ne désigne aucun contact de ce workspace », qu'un contact réel du workspace est accepté, qu'un champ `contact` reste **vidable** (`value: null` → `201`), et que `pg_get_functiondef('app.card_field_values_valider()')` contient « ne désigne aucun membre ». |
| 48 — `CRM-081` | `supabase/migrations/0048_snooze_fils.sql` | Tranche 2 c du sommeil : le sommeil d'un **fil de messagerie** (`docs/SPEC-cards.md` §16.14). Ajoute `app.cle_fil(text[], text)` (`immutable`, racine RFC 5322 d'un fil), l'index d'expression `mail_messages_cle_fil_idx`, la table `public.mail_thread_snoozes` (clé primaire `(workspace_id, thread_key)`, `snoozed_until` non nulle, `snoozed_by` FK `profiles` `ON DELETE SET NULL`), sa RLS et son unique politique de lecture, `app.fil_lisible(uuid, text)`, et les deux RPC `SECURITY DEFINER` `public.snooze_thread(uuid, text, timestamptz)` et `public.wake_thread(uuid, text)`. **Aucune colonne n'est ajoutée à `mail_messages`** ; aucune table existante n'est modifiée. | Migrations 24 (`mail_messages`), 25 (`app.peut_voir_message`) et 1 (`workspaces`, `profiles`, `app.set_updated_at`). | **PURE ADDITION : aucune écriture existante ne change de comportement, et aucun appelant n'est cassé** — le produit n'appelait ni ne lisait rien de ce qui est créé ici. **UN POINT DE SÛRETÉ À NE PAS MANQUER** : les `alter default privileges` de la plateforme accordent `all privileges` à `anon` et `authenticated` sur toute table créée dans `public` — MESURÉ le 2026-08-19. La migration referme cette porte par `revoke all … from anon, authenticated` avant ses `grant` nominatifs ; **une application partielle qui s'arrêterait entre la création de la table et ce `revoke` laisserait `mail_thread_snoozes` ouverte en écriture à un appelant anonyme**. Appliquer la migration ENTIÈRE, dans une seule transaction, et vérifier les privilèges après coup. Retour arrière : `drop function if exists public.snooze_thread(uuid, text, timestamptz), public.wake_thread(uuid, text); drop table if exists public.mail_thread_snoozes; drop index if exists public.mail_messages_cle_fil_idx; drop function if exists app.fil_lisible(uuid, text), app.cle_fil(text[], text);` **Ce que le retour arrière REND** : les états de sommeil de fil déjà posés sont perdus avec la table. **RÉVISÉ LE 2026-08-19 PAR LA TRANCHE 2 e** — la phrase disait « aucun écran ne les lisant encore », et ce n'est plus vrai : l'inbox lit `mail_thread_snoozes` et appelle les deux RPC (`docs/SPEC-cards.md` §16.15). Un retour arrière ferait donc échouer la lecture des fils endormis et les deux gestes de l'inbox ; l'écran retomberait sur « tous les fils éveillés » pour la lecture — `lireFilsEndormis` rend une table vide sur échec —, mais le geste, lui, rendrait un refus `inconnu`. Retirer d'abord la surface, ou l'accepter dégradée le temps du retour arrière. | Vérifier après application que `has_table_privilege('anon','public.mail_thread_snoozes','insert')` rend **false**, que `has_table_privilege('authenticated','public.mail_thread_snoozes','delete')` rend **false**, qu'un membre qui lit un message d'un fil obtient `200` sur `snooze_thread` et que la ligne apparaît, qu'un membre qui ne lit aucun message du fil obtient `400 thread_not_found`, et que `wake_thread` rejoué une seconde fois rend `false` sans refus. |
| 49 — `CRM-082` | `supabase/migrations/0049_objectifs.sql` | Tableau d'objectifs, « la lavagna » (`docs/SPEC-goals.md`, `docs/SCHEMA.md` §9 bis.1 à §9 bis.3). Ajoute les trois tables `public.goal_boards`, `public.goal_blocks` et `public.goal_links`, leurs contraintes de valeur, l'index unique `goal_boards_workspace_name_key` (par workspace, sur la forme normalisée par `app.btrim_blancs`), l'unicité `goal_links_source_target_key`, les deux fonctions de trigger `app.goal_boards_attribuer_position()` et `app.goal_links_verifier_tableau()`, les quatre fonctions d'appui `SECURITY DEFINER` `app.can_read_goal_board`, `app.can_write_goal_board`, `app.can_read_goal_block` et `app.can_write_goal_block`, la RLS et **douze politiques** — quatre par table. **Aucune table existante n'est modifiée, aucune RPC n'est ajoutée** : le client écrit directement dans les trois tables, la règle tenant entièrement dans les politiques. | Migrations 1 (`workspaces`, `profiles`, `app.set_updated_at`), 4 (`channels`), 10 (`app.can_read_channel`, `app.can_write_channel`) et 35 (`app.btrim_blancs`, employée par l'index unique). | **PURE ADDITION : aucune écriture existante ne change de comportement, et aucun appelant n'est cassé** — le produit n'appelait ni ne lisait rien de ce qui est créé ici, et `CRM-082` ne livre AUCUN écran. **LE MÊME POINT DE SÛRETÉ QUE LA MIGRATION 48, ET IL VAUT ICI POUR TROIS TABLES** : les `alter default privileges` de la plateforme accordent `all privileges` à `anon` et `authenticated` sur toute table créée dans `public`. La migration referme cette porte par `revoke all … from anon, authenticated` avant ses `grant` nominatifs ; **une application partielle qui s'arrêterait entre la création d'une table et son `revoke` la laisserait ouverte en écriture à un appelant anonyme**. Appliquer la migration ENTIÈRE, dans une seule transaction, et vérifier les privilèges après coup. Retour arrière : `drop table if exists public.goal_links, public.goal_blocks, public.goal_boards cascade; drop function if exists app.can_read_goal_board(uuid), app.can_write_goal_board(uuid), app.can_read_goal_block(uuid), app.can_write_goal_block(uuid), app.goal_boards_attribuer_position(), app.goal_links_verifier_tableau();` **Ce que le retour arrière REND** : tous les tableaux, blocs et flèches sont perdus avec les tables. Aucun autre objet n'en dépend — `goal_blocks.channel_id` est la seule référence sortante, et elle est `ON DELETE SET NULL`, donc supprimer un channel ne dépend d'aucune de ces tables. | Vérifier après application que `has_table_privilege('anon','public.goal_boards','insert')` rend **false** — et de même pour `goal_blocks` et `goal_links` —, que `select count(*) from pg_policies where tablename like 'goal%'` rend **12**, que les quatre fonctions d'appui sont `prosecdef` avec `search_path=""`, qu'un `viewer` obtient **403 / 42501** sur un `POST` de chacune des trois tables, et qu'un membre pouvant écrire qui ne détient que la LECTURE d'un channel obtient **403** en posant un bloc lié à ce channel, tout en pouvant **retirer** un lien existant (asymétrie du `using` et du `with check`, `docs/SPEC-goals.md` §4.2). |
| 50 — `CRM-084` | `supabase/migrations/0050_budgets.sql` | Enveloppes budgétaires d'un track (`docs/SPEC-costs.md` §2 et §3, `docs/SCHEMA.md` §9 bis.4 et §9 bis.5). Ajoute les deux tables `public.budgets` et `public.budget_occurrences`, leurs contraintes de valeur, l'index unique **PARTIEL** `budgets_track_name_ouvert_key` (`where closed_at is null`, sur la forme normalisée par `app.btrim_blancs`) — l'unicité du nom ne porte donc QUE sur les budgets ouverts, à la différence de celle de `goal_boards` —, l'unicité totale `budget_occurrences_budget_label_key`, les trois fonctions de trigger `app.budgets_attribuer_position()`, `app.budget_occurrences_verifier_recurrence()` et `app.budgets_verifier_recurrence()`, les deux fonctions d'appui `SECURITY DEFINER` `app.can_read_budget` et `app.can_write_budget`, la RLS et **huit politiques** — quatre par table. **Aucune table existante n'est modifiée, aucune RPC n'est ajoutée** : le client écrit directement dans les deux tables, la règle tenant entièrement dans les politiques — `app.can_read_track` pour la lecture, `app.is_workspace_admin` pour l'écriture. | Migrations 1 (`workspaces`, `profiles`, `app.set_updated_at`, `app.is_workspace_admin`), 3 (`tracks`), 10 (`app.can_read_track`) et 35 (`app.btrim_blancs`, employée par les deux index uniques). | **PURE ADDITION : aucune écriture existante ne change de comportement, et aucun appelant n'est cassé** — le produit n'appelait ni ne lisait rien de ce qui est créé ici, et `CRM-084` tranche 1 ne livre AUCUN écran. **LE MÊME POINT DE SÛRETÉ QUE LES MIGRATIONS 48 ET 49** : les `alter default privileges` de la plateforme accordent `all privileges` à `anon` et `authenticated` sur toute table créée dans `public`. La migration referme cette porte par `revoke all … from anon, authenticated` avant ses `grant` nominatifs ; **une application partielle qui s'arrêterait entre la création d'une table et son `revoke` la laisserait ouverte en écriture à un appelant anonyme**. Appliquer la migration ENTIÈRE, dans une seule transaction, et vérifier les privilèges après coup. Retour arrière : `drop table if exists public.budget_occurrences, public.budgets cascade; drop function if exists app.can_read_budget(uuid), app.can_write_budget(uuid), app.budgets_attribuer_position(), app.budget_occurrences_verifier_recurrence(), app.budgets_verifier_recurrence();` **Ce que le retour arrière REND** : tous les budgets et toutes les occurrences sont perdus avec les tables, donc l'historique des enveloppes et de leurs clôtures. Aucun autre objet n'en dépend AUJOURD'HUI ; **cela cessera d'être vrai avec `CRM-085`**, dont `card_costs.budget_id` sera `ON DELETE RESTRICT` : à partir de cette migration-là, le retour arrière ci-dessus emportera aussi les lignes de coût par la cascade, et devra être précédé du sien. | Vérifier après application que `has_table_privilege('anon','public.budgets','insert')` rend **false** — et de même pour `budget_occurrences` —, que `select count(*) from pg_policies where tablename in ('budgets','budget_occurrences')` rend **8**, que les deux fonctions d'appui sont `prosecdef` avec `search_path=""`, qu'un membre `business_developer` obtient **403 / 42501** sur un `POST` de `budgets` alors qu'il ÉCRIT les cards du même track, que la même personne obtient **200 avec zéro ligne** sur un `PATCH` de clôture — les deux formes du refus, et elles ne sont pas interchangeables —, et qu'une occurrence posée sur un budget `is_recurrent = false` obtient **400 / 23514**. |
| 51 — `CRM-085` | `supabase/migrations/0051_card_costs.sql` | Lignes de coût d'une affaire (`docs/SPEC-costs.md` §2.3 et §3, `docs/SCHEMA.md` §9 bis.6). Ajoute la table `public.card_costs`, sa contrainte de forme `card_costs_label_check`, ses trois index — dont `card_costs_sans_reel_idx`, **partiel** `where actual_cost is null`, qui sert l'onglet « À saisir » du §4.8 —, la fonction de trigger `app.card_costs_verifier_rattachement()` (récurrence dans les deux sens, appartenance de l'occurrence au budget, refus des clôtures à l'insertion **et** au changement de rattachement), la fonction de trigger `app.budgets_verifier_recurrence_lignes()` posée **sur `budgets`**, la fonction d'appui `SECURITY DEFINER` `app.budget_est_ouvert(uuid)`, la RLS et **quatre politiques**. **Aucune table existante n'est modifiée**, mais un trigger est AJOUTÉ sur `public.budgets` : `before update of is_recurrent`, il cohabite avec `budgets_verifier_recurrence` de la migration 50 et refuse de rendre récurrent un budget qui porte déjà des lignes. **Aucune RPC** : le client écrit directement dans la table. | Migrations 11 (`cards`, `app.can_read_card`), 13 (`app.can_write_card`), 35 (`app.btrim_blancs`) et **50** (`budgets`, `budget_occurrences`, `app.can_read_budget`). | **PURE ADDITION côté données** : aucune ligne existante n'est réécrite, et `CRM-085` tranche 1 ne livre AUCUN écran. **DEUX POINTS DE SÛRETÉ.** (1) Le même que les migrations 48 à 50 : les `alter default privileges` de la plateforme accordent `all privileges` à `anon` et `authenticated` sur toute table créée dans `public` ; la migration referme la porte par `revoke all … from anon, authenticated` avant ses `grant` nominatifs, donc **appliquer la migration ENTIÈRE, dans une seule transaction**. (2) Le trigger ajouté sur `budgets` **restreint un geste jusqu'ici libre** : passer `is_recurrent` de faux à vrai échoue désormais en `23514` si le budget porte des lignes de coût. Aucune donnée de production n'est concernée tant que `card_costs` est vide, mais un appelant qui automatiserait ce basculement doit être recensé avant application. Retour arrière : `drop table if exists public.card_costs cascade; drop function if exists app.card_costs_verifier_rattachement(), app.budgets_verifier_recurrence_lignes(), app.budget_est_ouvert(uuid);` — le `drop function … cascade` n'est PAS nécessaire, les triggers tombant avec la table pour le premier et étant explicitement supprimés pour le second. **Ce que le retour arrière REND** : toutes les lignes de coût sont perdues, donc la dépense constatée de chaque affaire. **Et il DOIT précéder celui de la migration 50** : `card_costs.budget_id` étant `on delete restrict`, le `drop table … budgets cascade` de la 50 emporterait sinon les lignes de coût par la cascade de la suppression de table. | Vérifier après application que `has_table_privilege('anon','public.card_costs','insert')` rend **false**, que `select count(*) from pg_policies where tablename = 'card_costs'` rend **4**, que `app.budget_est_ouvert` est `prosecdef` avec `search_path=""`, qu'un `POST` de ligne sur un budget **clôturé** rend **403 / 42501** (la politique parle avant le trigger), qu'un `PATCH` d'`actual_cost` sur ce même budget clos rend **200** — c'est la frontière du §2.3, et les deux résultats doivent différer —, qu'un `PATCH` de `budget_id` sur cette même ligne rend **400 / 23514**, et qu'une ligne dont la card est lisible mais le budget non lisible rend **200 avec zéro ligne**. |

**Ce que la migration 12 ajoute au contrat d'exploitation.** Un seul point, mais il casse
potentiellement des appelants existants :

- **`cards` n'est plus modifiable colonne par colonne comme avant.** Contrôle à exécuter **avant**
  application, sur la base cible : recenser les intégrations, jetons d'API et scripts qui font un
  `PATCH /rest/v1/cards` avec un jeton `authenticated`, et vérifier quelles colonnes ils écrivent.
  Celles qui touchent `current_step_id` doivent être portées sur `POST /rest/v1/rpc/move_card`
  **avant** l'application, faute de quoi elles tomberont en `403`. Le message de refus divulgue la
  commande `GRANT` à exécuter — comportement de PostgREST, INC-026 : ne pas la suivre, elle
  rouvrirait la garde.

**Ce que la migration 39 ajoute au contrat d'exploitation.** Un seul point, et il est de
vérification et non de rupture :

- **l'empreinte de composition doit être constatée inchangée sur la base cible AVANT et APRÈS
  l'application.** `workflows.source_composition_fingerprint` porte des valeurs figées par
  `copy_workflow_to_track`, et la vue `public.workflow_derivations` les compare à l'empreinte
  courante. Relever `select id, app.workflow_composition_fingerprint(id) from public.workflows;`
  avant application, puis après : les deux relevés doivent être **identiques ligne à ligne**. Une
  seule divergence signalerait que la forme canonique a bougé, et que toutes les copies de
  production vont se déclarer divergentes sans qu'aucune n'ait été modifiée.

**Ce que la migration 15 ajoute au contrat d'exploitation.** Trois points, et le premier est
d'exploitation pure :

- **La réplication logique devient une dépendance de fonctionnement.** `card_comments` est la
  première table publiée sur `supabase_realtime`. Si le service `realtime` est arrêté sans que son
  slot soit supprimé, PostgreSQL **conserve** le WAL que le slot n'a pas consommé, indéfiniment.
  Contrôle à inscrire dans la supervision : `select slot_name, active,
  pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_lsn(), restart_lsn)) from pg_replication_slots`.
  Un slot inactif dont le retard croît est une alerte, pas une curiosité.
- **La suppression d'un commentaire DÉTRUIT son contenu**, et c'est voulu (`docs/SPEC-cards.md`
  §13.4). Aucune restauration n'est possible autrement que par une sauvegarde antérieure. Si une
  obligation d'archivage devait s'appliquer aux commentaires, elle devrait être posée **avant**
  la mise en service, non après.
- **`authenticated` n'a jamais le privilège `DELETE`** sur cette table, ni aucune politique de
  suppression. Toute intégration qui tenterait un `DELETE /rest/v1/card_comments` recevra `403`.
  C'est le comportement voulu ; le message de refus divulgue la commande `GRANT` qui l'ouvrirait
  (INC-026) — ne pas la suivre.

**Ce que la migration 16 ajoute au contrat d'exploitation.** Quatre points, et les trois premiers
doivent être lus **avant** l'application sur une base déjà en service :

- **`card_events` CROÎT SANS BORNE, et rien ne la purge.** Chaque création de card, chaque
  déplacement, chaque changement de responsable, chaque archivage, chaque mise à la corbeille et
  chaque écriture de valeur de formulaire y ajoute une ligne. Aucune rétention n'est écrite : ce
  serait une décision de conformité que personne n'a prise (`docs/SPEC-cards.md` §14.13, point n° 2).
  Contrôle à inscrire dans la supervision : `select pg_size_pretty(pg_total_relation_size(
  'public.card_events'))`, et une alerte sur sa dérivée plutôt que sur sa valeur.
- **AUCUNE ÉCRITURE N'EST POSSIBLE, PAS MÊME AVEC LA CLÉ DE SERVICE.** C'est voulu — c'est ce que
  l'unité livre. Toute intégration, tout script de reprise, tout import qui tenterait un
  `POST /rest/v1/card_events` recevra `403`. Il n'existe **aucun** chemin d'écriture applicatif :
  seule une intervention du **propriétaire de la base** peut insérer une ligne, et elle
  contredirait la propriété que la table garantit.
- **La table est APPEND-ONLY, y compris pour l'exploitation.** Une correction de donnée par `UPDATE`
  est refusée par trigger, pour tous les rôles. Une reprise de données passe donc par une
  suppression et une réécriture sous le rôle propriétaire, ou par rien.
- **Une suppression physique de card emporte sa mémoire** (cascade). C'est la contrepartie assumée
  du maintien de ce geste d'exploitation ; le produit, lui, n'expose aucune suppression physique.

**Ce que la migration 13 ajoute au contrat d'exploitation.** Deux points, à lire avant de
l'appliquer sur une base déjà en service :

- **Des transitions qui passaient aujourd'hui seront refusées demain.** La sixième vérification
  refuse tout déplacement vers une étape dont un champ `required` n'est pas renseigné, et toute
  transition dont le `require_fields` n'est pas satisfait. Contrôle à exécuter **avant**
  application, sur la base cible : la requête ci-dessous liste les cards qui ne pourraient plus
  franchir la transition sortante de leur étape courante. Une liste non vide n'interdit pas
  d'appliquer la migration — c'est le comportement voulu —, mais elle doit être **connue**, et les
  valeurs manquantes saisies avant que les utilisateurs ne butent dessus.

À exécuter **avant** l'application de la migration 13 — elle emploie donc la définition de « non
renseigné » du §6.6 en clair, `app.valeur_de_champ_est_vide` n'existant pas encore sur la base
cible :

```sql
-- Cards dont une transition sortante serait désormais refusée pour champs manquants.
select c.id, c.title, t.label as transition, f.key as champ_manquant
  from public.cards c
  join public.workflow_transitions t
    on t.workflow_id = c.workflow_id and t.from_step_id = c.current_step_id
  join public.form_fields f
    on f.workflow_id = c.workflow_id and f.archived_at is null
 where c.archived_at is null and c.deleted_at is null
   and (exists (select 1 from public.form_field_rules r
                 where r.field_id = f.id and r.step_id = t.to_step_id
                   and r.visibility = 'required')
        or f.id = any (coalesce(t.require_fields, '{}'::uuid[])))
   and not exists (
       select 1 from public.card_field_values v
        where v.card_id = c.id and v.field_id = f.id
          and v.value is not null
          and jsonb_typeof(v.value) <> 'null'
          and not (jsonb_typeof(v.value) = 'string' and btrim(v.value #>> '{}') = '')
          and not (jsonb_typeof(v.value) = 'array'  and jsonb_array_length(v.value) = 0))
 order by c.title, f.position;
```

Sur une base **antérieure** à la migration 13, `public.card_field_values` n'existe pas : la
sous-requête est alors à retirer, et la liste obtenue est l'ensemble **complet** des transitions qui
deviendront refusées — ce qui est le cas le plus fréquent, aucune valeur n'ayant pu être saisie.

- **`public.cards` reçoit une contrainte d'unicité supplémentaire**, `cards_id_workflow_id_key`.
  Elle ne peut refuser aucune ligne — `id` est déjà clé primaire — et ne change donc aucun
  comportement ; mais elle crée un index, dont le coût est à connaître sur une table volumineuse.

**Ce que la migration 12 ne fait pas, et qui reste dû.** La **sixième** vérification de la garde —
« les champs requis de l'étape cible sont renseignés » — n'était **pas écrite** : elle lit
`card_field_values`. **LIVRÉE PAR LA MIGRATION 13** (`CRM-036`), qui redéfinit `move_card` : INC-047
est close, et la dépendance d'ordre 12 → 13 est inscrite au registre ci-dessus. Le commentaire
exigé par une transition n'est **conservé
nulle part** tant que `card_comments` n'existe pas (INC-048, `CRM-043`), et aucun `card_event` n'est
écrit (`CRM-044`). `email_local_part` **n'est plus modifiable directement depuis la migration 14**
(`CRM-013`) : INC-050 est close, et la dépendance d'ordre 12 → 14 est inscrite au registre
ci-dessus, au même titre que la 12 → 13.

**Ce que la migration 14 ajoute au contrat d'exploitation.** Trois points, et le premier est le
seul de tout ce registre qui puisse rendre une colonne silencieusement en lecture seule.

1. **Toute colonne ajoutée plus tard à `public.cards` sera FERMÉE par défaut.** Le mécanisme est
   un `grant update (…)` énumératif : une colonne absente de la liste n'est pas modifiable. Une
   migration ultérieure qui ajouterait une colonne destinée à l'écriture **doit** l'ajouter à
   l'énumération de la migration 14. `supabase/tests/0015_colonnes_protegees.test.sql` énumère les
   douze colonnes ouvertes une par une **et en compte le total**, de sorte que l'oubli fasse
   échouer la suite plutôt que de se découvrir en production.
2. **Un client qui renvoie la ligne entière en `PATCH` recevra désormais `403`.** Le privilège se
   vérifie sur les colonnes **nommées**, non sur les valeurs changées : réécrire
   `email_local_part` à sa valeur courante est refusé tout autant. MESURÉ. Aucun client du dépôt
   ne procède ainsi ; un intégrateur externe, peut-être.
3. **`service_role` conserve l'écriture.** Le seed en dépend. Un service porteur de cette clé —
   `mail-sync` à partir de `CRM-051` — n'est donc arrêté par rien s'il se trompe de colonne. La
   question devra être reposée à ce moment-là, et non découverte alors.

**Ce que la migration 14 ne fait pas, et qui reste dû à `CRM-013`.** Cinq de ses six cibles portent
sur des tables qui n'existent pas : `mail_inbound_accounts.secret_id` et
`mail_outbound_identities.secret_id` (`CRM-052`, `CRM-053`), `api_tokens.token_hash` (`CRM-073`),
`card_events` et `audit_log` (`CRM-044`, `CRM-072`). Les preuves de refus n° 6 et n° 8 de
`docs/SPEC-permissions-rls.md` §7 restent donc hors d'atteinte, et l'unité reste `[~]`.

**Ce que la migration 11 ajoute au contrat d'exploitation.** Deux points, à lire avant de
l'appliquer sur une base déjà en service :

1. **Un channel occupé ne change plus de workflow.** C'est la conséquence structurelle de la clé
   composite `cards (channel_id, workflow_id)`, et la règle n'a été décidée par personne — INC-046.
   Contrôle à exécuter **avant** application, sur la base cible : si des cards existent déjà et
   qu'une opération d'exploitation prévoit de repointer le workflow d'un channel, elle deviendra
   impossible sans vider ce channel.
2. **La garde d'archivage d'un nœud du catalogue devient active.** Un nœud qu'une card **active**
   occupe ne peut plus être archivé (`42501`, `node_occupied`). Une card archivée ou en corbeille
   n'occupe rien. Une procédure d'exploitation qui archivait des nœuds en masse doit donc être
   revue.

**Frontière historique de la migration 10, fermée par la 21.** La migration 10 n'écrit aucune
politique sur `public.profiles`, `public.workspaces` et `public.workspace_members`; la migration 21
les livre ensemble avec leurs ACL et la garde du dernier administrateur. Elle n'écrivait pas non
plus `app.can_read_card`, arrivée avec la migration 11.

**Frontière historique de la migration 9, fermée par la 19.** `copy_workflow_to_track`
(migration 7) était initialement écrite avant `form_fields` et ne copiait aucun formulaire.
La migration 19 redéfinit la fonction après la création des tables : champs, règles et exigences
sont remappés dans la même transaction. Une production arrêtée entre les migrations 9 et 19 garde
donc temporairement l'ancien comportement ; le runner doit aller jusqu'à la dernière migration
avant d'ouvrir l'API.

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

**La migration 6 va plus loin, et c'est un correctif.** Ses **clés étrangères et ses unicités** sont
convergentes elles aussi, par un mécanisme qui compare la définition réelle rendue par
`pg_get_constraintdef` à celle attendue et ne reconstruit que si elles diffèrent — la
reconstruction d'un index n'étant pas le prix négligeable d'une revalidation de `CHECK`. Sans cela,
une clé composite remplacée à la main par une clé simple **du même nom** survivrait à tous les
rejeux : la base resterait durablement affaiblie et rien ne le signalerait
(`docs/JOURNAL.md`, décision 78). Les migrations 3, 4 et 5 **n'ont pas** cette propriété sur leurs
clés étrangères : `docs/INCONSISTENCY_REPORT.md`, **INC-035**, en attente d'arbitrage.

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
| `functions` | À chaque changement sous `supabase/functions/` ou de l'image Edge Runtime ; `CRM-016` impose un premier déploiement conjoint avec Kong |
| `kong` | À chaque changement de `supabase/docker/volumes/api/kong.yml` |
| `caddy` | À chaque changement de `caddy/Caddyfile` |
| `auth` | À chaque changement d'une variable `GOTRUE_*`, dont `PASSWORD_MIN_LENGTH` livrée par `CRM-011` |

**Opération en attente du prochain déploiement de production — redéployer `mail-sync` pour que le
courrier reçu se groupe en fils (`CRM-081` tranche 2 f).** Le service persiste désormais la chaîne
`References` d'un message entrant dans `mail_messages.references_ids`, ce qu'il omettait depuis
`CRM-058` : la colonne retombait sur son `default '{}'`, et tout message reçu était sa propre racine
au sens de `app.cle_fil` — aucun fil ne pouvait donc se former à partir de courrier entrant.

- **Aucune migration, aucune variable d'environnement nouvelle** : la colonne existe depuis la
  migration 30, et l'écriture emprunte le chemin déjà autorisé à la clé de service.
- **Commande** : `docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
  mail-sync`.
- **Aucune reprise rétroactive n'est prévue, et c'est une décision** (`docs/SPEC-cards.md`
  §16.16.2) : les messages ingérés avant ce déploiement gardent `references_ids` = `[]` et restent
  chacun sur leur propre ligne dans l'inbox. Les relire supposerait de redemander leurs en-têtes à
  l'IMAP, que rien ne conserve en base.
- **Vérification après déploiement** : faire arriver un message portant un en-tête `References`,
  puis contrôler que sa ligne le porte —
  `select references_ids from public.mail_messages order by received_at desc limit 1;` — et que
  l'inbox rend une seule ligne portant son compte pour la conversation.
- **Retour arrière** : redéployer l'image précédente. Les lignes déjà écrites avec leur chaîne la
  conservent ; elles ne gênent rien, la colonne existant depuis la migration 30.

**Opération en attente du prochain déploiement de production — activer les fonctions edge.** Tirer
`public.ecr.aws/supabase/edge-runtime:v1.74.2`, déployer le répertoire
`supabase/functions/` en lecture seule au chemin attendu par Compose, puis recréer `functions` et
`kong`. Aucune variable ni migration SQL n'est ajoutée : le service réemploie les clés Supabase
existantes et ne reçoit pas `JWT_SECRET`. Avant d'ouvrir le trafic, vérifier que le conteneur est
sain, ne publie aucun port et que ses journaux ne portent ni avertissement ni erreur.
Le label `com.p2enjoy.kong-config-revision=crm-016` doit être présent sur le conteneur Kong ; toute
future modification de `kong.yml` incrémente cette révision dans le même déploiement pour forcer
la prise en compte du bind mount.

**Opération en attente du prochain déploiement de production — activer `mail-sync` (`CRM-051`).**
Le service est désormais **déclaré dans l'assemblage commun** : `docker compose -f
docker-compose.yml -f docker-compose.prod.yml up -d --build mail-sync` le construit et le crée avec
son volume nommé. Deux variables doivent exister au préalable dans l'environnement de production :

- `MAIL_SYNC_INTERNAL_TOKEN`, distinct de toute clé Supabase, au moins 32 caractères — le service
  refuse de démarrer en deçà, avec le code de sortie `78` et une seule ligne `CRITICAL` qui ne cite
  pas la valeur ;
- `MAIL_SYNC_LOG_LEVEL`, `INFO` recommandé.

`P2ENJOY_ENV_PROFILE` **doit** valoir `prod` : c'est cette valeur, et elle seule, qui rend `404` la
route de preuve. Aucun port ne doit être publié et aucune `SERVICE_ROLE_KEY` ne doit être présente
dans son environnement à ce stade. Vérifier depuis le réseau Compose : santé positive, statut
refusé sans Bearer puis accepté avec le jeton. Contrôler aussi l'utilisateur non privilégié, la
racine en lecture seule et l'absence de `WARNING`/`ERROR` dans chaque ligne JSON des journaux.

Le volume ne contient que l'état opérationnel décrit dans `docs/SPEC-mail-subsystem.md` §12.4. Il
doit survivre aux recréations ordinaires du conteneur, mais ne remplace ni les sauvegardes
PostgreSQL ni celles de Storage. Ne pas appeler la route `/internal/v1/dev/checkpoint` : elle doit
rendre `404` sous `P2ENJOY_ENV_PROFILE=prod`.

**Opération due — déclarer `clamav` dans l'assemblage commun, avec `CRM-054`.** `CRM-050` a livré
ClamAV dans `docker-compose.dev.yml` seulement, là où il est réellement exercé par ses preuves
(`docs/JOURNAL.md` décision 236). Son unique consommateur est l'ingestion des pièces jointes,
livrée par `CRM-054` : c'est cette unité qui devra le déplacer dans `docker-compose.yml`, ajouter
sa variable de port au contrat d'environnement de production, et **rejouer les preuves de
production de `CRM-002`** — le nombre de services attendus `healthy` par `scripts/verify-scripts.sh`
change avec lui. Tant que l'opération n'est pas faite, la production n'analyse aucune pièce jointe,
et elle n'en reçoit aucune : rien ne l'y dépose avant `CRM-054`.

**Aucun des composants de `CRM-050` n'est destiné à la production.** Stalwart, Roundcube et le
provisionnement de boîtes `stalwart-init` sont des composants **exclusivement** de développement
(`docs/DAT.md` §3.6) : la production utilise les serveurs des utilisateurs, décrits au §2.2
ci-dessus. Aucune variable `STALWART_*`, `ROUNDCUBE_*` ni `MAIL_DEV_*` n'est à provisionner sur un
hôte de production.

**Une variable obligatoire ajoutée n'atteint pas un `.env` existant.** Les scripts n'amorcent que
les fichiers absents : un `.env` déjà en place ne gagne pas les variables introduites depuis. Le
cas n'est pas silencieux — la validation de `CRM-002` refuse le démarrage et **nomme** la variable
manquante lorsque son exemple est non vide :

```
  manquante PASSWORD_MIN_LENGTH
ERREUR 1 variable(s) à corriger dans /chemin/.env. Le contrat est .env.example.
```

Comportement mesuré lors de la livraison de `CRM-011`. La marche à suivre est d'ajouter la
variable au fichier d'environnement de l'hôte, puis de recréer le service `auth`.
Une variable facultative à exemple vide peut en revanche être omise : c'est le contrat de
compatibilité introduit par `CRM-015` pour `NPM_CA_FILE`, sans affaiblir les variables obligatoires.

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

**Prérequis d'hôte à vérifier avant le premier démarrage.** Realtime réclame
`STACK_RLIMIT_NOFILE` descripteurs de fichiers (défaut `10000`, ramené de `100000` par la
décision 366 : la valeur haute était celle du pooler, retiré de la pile). Si la limite dure de
l'hôte est inférieure, le service redémarre en boucle : contrôler `ulimit -Hn` et, le cas échéant,
relever la limite du démon Docker ou abaisser la variable.

**Deux variables disparaissent du contrat, et aucune opération n'en découle.** `VAULT_ENC_KEY` et
les six `POOLER_*` étaient exigées pour le pooler Supavisor, retiré par la décision 366. La
production n'ayant **jamais été déployée** (§1), il n'y a ni conteneur à arrêter, ni base
`_supabase` à supprimer, ni secret à révoquer : ces variables n'ont simplement plus à être
provisionnées. `VAULT_ENC_KEY` était de surcroît décrite ici comme la clé des secrets de
messagerie, ce qu'elle n'a jamais été — voir INC-098.

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
10. **La route edge traverse réellement Kong** : `POST /functions/v1/example` avec la clé
    publique de l'environnement rend 200 et le JSON exact de `docs/SPEC-edge-functions.md` §6 ;
    le même appel sans clé rend 401. Aucun port de `functions` n'est publié sur l'hôte et ses
    journaux restent sans `warning`, `error`, `panic` ni terminaison d'isolate.
11. **Les identités sont consenties sans sur-accès** : avec le JWT d'un membre, `profiles` rend les
    profils de son équipe, `workspaces` uniquement ses espaces et `workspace_members` leurs
    appartenances ; la même lecture anonyme rend `[]`. Une tentative réelle de rétrograder ou
    supprimer l'unique administrateur rend `400`, code `23514`, message `last_workspace_admin`.

## 6. Procédure de retour arrière

| Situation | Action |
|---|---|
| Régression applicative | Redéployer l'image précédente ; le schéma restant compatible, aucune action base n'est requise |
| Migration défectueuse | Appliquer le script de retour arrière fourni avec la migration ; à défaut, restaurer la sauvegarde antérieure |
| Restauration de base sans la clé racine de Vault | **Aucun retour arrière possible** : le chiffré est intact mais définitivement illisible. Restaurer le volume `db-config` d'origine ; à défaut, chaque mot de passe IMAP/SMTP doit être ressaisi dans l'application |
| Messagerie défaillante | Arrêter `mail-sync` : le CRM reste utilisable, la file d'envoi est persistante et reprendra |
| Runtime edge défaillant après `CRM-016` | Restaurer la configuration Kong précédente, recréer `kong`, puis arrêter `functions`. Aucune donnée n'est perdue : la fonction `example` est sans effet et le service n'a aucun volume persistant |

Toute migration non réversible doit **documenter explicitement pourquoi** et être précédée d'une
sauvegarde vérifiée.

## 7. Risques connus

- **~~Le rejeu des migrations échouait sur une base contenant des événements récents.~~ LEVÉ le
  2026-08-18, et à connaître avant tout redémarrage.** Le `migrations-runner` rejoue **tout** le
  répertoire à chaque démarrage de la pile. Cinq migrations — 16, 17, 20, 25 et 30 — réinstallaient
  la contrainte de vocabulaire de `public.card_events` avec la liste de leur époque. Sur une base
  **peuplée**, dont les lignes emploient `mail_received`, `mail_sent`, `snoozed` ou `woken`,
  PostgreSQL refusait la contrainte étroite et **le démarrage échouait**. Le défaut était invisible
  sur une base neuve. Chacune ne pose désormais sa liste que si aucune ligne n'emploie un type qui
  en est absent (INC-144, `docs/JOURNAL.md` décision 431).
  **Conséquence pour le déploiement : AUCUNE opération supplémentaire.** Les cinq migrations
  figurent déjà au §3 parmi les migrations en attente, leur contenu corrigé, et l'état final de la
  contrainte est inchangé — les quatorze types. Rien à appliquer à part, rien à rejouer dans un
  ordre particulier. Le risque est nommé ici parce qu'il portait sur le **redémarrage**, geste que
  l'exploitant fera bien après le premier déploiement.
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
- **`POST /auth/v1/admin/users` contourne la politique de mot de passe.** Mesuré : ce chemin crée
  un compte avec un mot de passe de **8 caractères** là où le chemin utilisateur en exige 12 et
  refuse en `422 weak_password`. Le compte ainsi créé **est utilisable**.

  **Arbitrage du responsable — `docs/JOURNAL.md`, décision 265, INC-018 : ce chemin est interdit
  en production.** Il n'est pas accepté au motif qu'il exige la clé de service : un privilège ne
  dispense pas d'une règle, et un compte à 8 caractères créé par commodité est exactement la
  brèche que la politique existe pour éviter.

  **Opération d'exploitation encadrée.** Lorsqu'un compte doit être créé hors du parcours produit —
  amorçage d'un espace, invitation avant `CRM-070` —, l'opérateur :

  1. crée le compte par ce chemin **en respectant la politique de 12 caractères**, que GoTrue
     n'appliquera pas à sa place ;
  2. n'emploie jamais de mot de passe partagé, réutilisé ou dérivé d'un nom ;
  3. consigne l'opération, sa date et son motif ;
  4. déclenche immédiatement une réinitialisation, pour que le secret n'ait jamais transité par
     l'opérateur au-delà de la création.

  La clé de service ne quitte pas l'environnement d'exploitation. `docs/SPEC-auth.md` §4.1 porte
  la même réserve du côté de la spécification.

## 8. Historique des déploiements

Aucun déploiement à ce jour.
