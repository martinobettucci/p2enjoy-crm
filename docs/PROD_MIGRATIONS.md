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
| 14 | `supabase/migrations/0014_colonnes_protegees.sql` | **Protection de colonne** : retire à `authenticated` le privilège `UPDATE` sur `public.cards.email_local_part`, par la seule forme que PostgreSQL admette — `revoke update` de table, puis `grant update (…)` énumérant les **douze** colonnes qui restent ouvertes. Met à jour le commentaire de la colonne. **Aucune donnée n'est touchée, aucune structure n'est modifiée** : la migration ne pose que des privilèges. | Migrations 1 à 13 : `public.cards` doit exister. **DÉPENDANCE D'ORDRE STRICTE** : la section 2 de la migration 12 réapplique les mêmes privilèges **avec** `email_local_part` dans la liste. Réappliquer la 12 **après** celle-ci **rouvre** la colonne, sans aucun signal — toute réapplication partielle doit donc se terminer par la 13 **puis** la 14. `scripts/verify-colonnes-protegees.sh` mesure cette dépendance dans les deux sens. | Réapplication de la seule section 2 de la migration 12, qui rend `email_local_part` à la liste des colonnes ouvertes. **Non destructif** : aucune donnée n'est perdue. **Effet immédiat sur le comportement** : l'adresse entrante d'une card redevient réécrivable par tout membre qui écrit sur son channel, donc remplaçable par une valeur devinable — c'est un **relâchement** de garde, à ne pas exécuter sans l'avoir voulu. |

**Ce que la migration 12 ajoute au contrat d'exploitation.** Un seul point, mais il casse
potentiellement des appelants existants :

- **`cards` n'est plus modifiable colonne par colonne comme avant.** Contrôle à exécuter **avant**
  application, sur la base cible : recenser les intégrations, jetons d'API et scripts qui font un
  `PATCH /rest/v1/cards` avec un jeton `authenticated`, et vérifier quelles colonnes ils écrivent.
  Celles qui touchent `current_step_id` doivent être portées sur `POST /rest/v1/rpc/move_card`
  **avant** l'application, faute de quoi elles tomberont en `403`. Le message de refus divulgue la
  commande `GRANT` à exécuter — comportement de PostgREST, INC-026 : ne pas la suivre, elle
  rouvrirait la garde.

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

**Ce que la migration 10 ne fait pas, et qui reste dû.** Elle n'écrit **aucune** politique sur
`public.profiles`, `public.workspaces` et `public.workspace_members` : ces trois tables restent en
refus par défaut depuis la migration 1, et aucune unité du backlog ne porte leurs politiques
(INC-014, arbitrage attendu). Elle n'écrit pas non plus `app.can_read_card`, faute de table.

**Ce que la migration 9 ne fait pas, et qui reste dû.** `copy_workflow_to_track` (migration 7) ne
copie **aucun** champ de formulaire : un workflow copié vers un track naît sans formulaire. Le
comportement est inchangé et documenté — INC-037, arbitrage attendu du responsable. Si la production
emploie la copie de workflow, ses copies devront recevoir leurs champs à la main tant que l'arbitrage
n'est pas rendu.

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
