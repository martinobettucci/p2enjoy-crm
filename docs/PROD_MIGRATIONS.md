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
| `webapp` | À chaque changement d'interface |
| `mail-sync` | À chaque changement du service de messagerie ou de ses dépendances |
| Pile Supabase | À chaque changement de version épinglée d'un composant (tableau dans `docs/DAT.md` §3.7) |
| `kong` | À chaque changement de `supabase/docker/volumes/api/kong.yml` |
| `caddy` | À chaque changement de `caddy/Caddyfile` |

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
