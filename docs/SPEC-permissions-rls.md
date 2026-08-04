# Spécification — Rôles, autorisations et RLS

Unités de backlog : `CRM-010` à `CRM-014` (voir `docs/BACKLOG.md`).
Documents liés : `docs/SCHEMA.md` §1, `docs/DAT.md` §7, `docs/SPEC-workflow-engine.md` §5,
`docs/SPEC-mail-subsystem.md` §2.3.

---

## 1. Principe

Les termes « autorisé », « interdit », « visible », « peut modifier » désignent toujours une règle
**appliquée côté base de données**. Masquer un bouton ou désactiver un champ n'est qu'une aide
d'interface ; l'autorité est la politique RLS et la garde des fonctions RPC.

Toute règle décrite ici doit être prouvée par un test qui **contourne l'interface** : requête
directe avec le jeton réel du profil concerné, démontrant que l'opération interdite est refusée.

## 2. Rôles

### 2.1 Rôle de workspace (`workspace_members.role`)

| Rôle | Portée |
|---|---|
| `admin` | Administre le workspace : membres, tracks, channels, catalogue de nœuds, workflows, formulaires, boîte système, jetons d'API, webhooks |
| `business_developer` | Travaille : crée et fait avancer des cards, commente, envoie des emails, gère ses propres boîtes |
| `viewer` | Consulte, sans aucune écriture |

### 2.2 Droits fins (`track_members`, `channel_members`)

Facultatifs. **L'absence de ligne signifie que l'accès découle du rôle de workspace.** Une ligne
surcharge explicitement :

| `access` | Effet |
|---|---|
| `member` | Lecture et écriture sur ce sous-arbre, même si le rôle de workspace est `viewer` |
| `viewer` | Lecture seule sur ce sous-arbre, même si le rôle de workspace est `business_developer` |
| `none` | Aucun accès, y compris en lecture |

Résolution : la règle **la plus spécifique gagne** — channel, puis track, puis workspace. Un
`admin` de workspace n'est jamais restreint par un droit fin : l'administration doit rester
possible, et une restriction silencieuse d'un administrateur produirait des situations
irrécupérables.

## 3. Fonctions d'autorisation

Déclarées `SECURITY DEFINER`, `search_path` fixé, accordées à `authenticated` :

| Fonction | Retour | Livrée par |
|---|---|---|
| `app.is_workspace_member(ws uuid)` | l'appelant appartient au workspace | `CRM-010` |
| `app.is_workspace_admin(ws uuid)` | l'appelant y est administrateur | `CRM-010` |
| `app.can_read_track(track uuid)` | droit de lecture effectif sur le track | différée, INC-013 — la politique de `tracks` s'appuie sur `is_workspace_member` en attendant (INC-024) |
| `app.can_read_channel(ch uuid)` | droit de lecture effectif sur le channel | différée, INC-013 — la politique de `channels` s'appuie sur `is_workspace_member` en attendant (INC-030) |
| `app.can_write_channel(ch uuid)` | droit d'écriture effectif sur le channel | différée, INC-013 (INC-030) |
| `app.can_read_card(card uuid)` | dérivé du channel de la card | différée, INC-013 |

Ces fonctions existent pour deux raisons : éviter la **récursion** des politiques (une politique
sur `workspace_members` qui interrogerait `workspace_members`), et garder les politiques lisibles
et indexables.

Elles sont `STABLE` et s'appuient sur `auth.uid()`. **Les droits ne sont pas portés par le JWT** :
une révocation prend effet immédiatement, sans attendre l'expiration du jeton.

### 3.1 Deux fonctions d'appui, livrées par `CRM-010`

| Fonction | Retour |
|---|---|
| `app.workspace_role(ws uuid)` | rôle de l'appelant dans le workspace, `NULL` s'il n'en est pas membre. `SECURITY DEFINER`, `STABLE` |
| `app.resolve_access(ws_role text, track_access text, channel_access text)` | `none`, `read` ou `write` — l'algorithme du §2.2, appliqué à trois valeurs déjà lues. Fonction **pure** : `IMMUTABLE`, `SECURITY INVOKER`, aucun accès aux tables |

`app.resolve_access` n'est pas une fonction supplémentaire du modèle : c'est la **décomposition**
des quatre fonctions `can_*`, dont elle isole la seule partie qui porte une règle métier. Les
quatre, une fois écrivables, se réduisent à une lecture de ligne suivie de son appel. Cette
séparation permet de prouver la règle par énumération exhaustive de ses 64 combinaisons d'entrées,
sans fixture ni compte (`docs/JOURNAL.md`, décision 25).

Conséquence de la précédence channel → track → workspace, explicitée ici parce qu'elle est
contre-intuitive : un `channel_members.access = 'member'` **l'emporte** sur un
`track_members.access = 'none'` posé sur le track qui contient ce channel. « Le plus spécifique
gagne » vaut dans les deux sens, y compris lorsqu'il rouvre plus bas ce qui est fermé plus haut.

### 3.2 `EXECUTE` est également accordé à `anon`

Une politique RLS est évaluée avec les droits du **rôle courant**. Un appelant anonyme atteignant
une table dont la politique appelle l'une de ces fonctions recevrait, faute d'`EXECUTE`, une
**erreur de privilège** — alors que le comportement exigé au §7 est **zéro ligne**. `EXECUTE` est
donc accordé à `anon`, `authenticated` et `service_role`, jamais à `PUBLIC`.

Le droit n'ouvre rien : `auth.uid()` étant nul sans jeton, les prédicats rendent faux et
`app.workspace_role` rend `NULL`. C'est la même logique qui accorde `SELECT` à `anon` sur les
tables d'identité (`docs/JOURNAL.md`, décisions 21 et 26).

## 4. Politiques par famille de tables

| Table | Lecture | Écriture |
|---|---|---|
| `profiles` | Membres d'un workspace commun | Son propre profil |
| `workspaces` | Membres | `admin` |
| `workspace_members` | Membres du workspace | `admin` ; **un administrateur ne peut pas se retirer son propre rôle s'il est le dernier** |
| `tracks` | `app.can_read_track` — **livré par `CRM-020` avec `app.is_workspace_member`**, les droits fins restant dus (INC-024) | `admin` ; **aucune suppression n'est exposée**, l'archivage tient lieu de suppression (`docs/SPEC-tracks.md` §4) |
| `channels` | `app.can_read_channel` — **livré par `CRM-021` avec `app.is_workspace_member`**, les droits fins restant dus (INC-030) | `admin` ; **aucune suppression n'est exposée**, l'archivage tient lieu de suppression (`docs/SPEC-channels.md` §4) |
| `workflow_nodes_catalog` | Membres du workspace — **livré par `CRM-030`** avec `app.is_workspace_member`, qui **est** la règle spécifiée et non un repli : aucun droit fin ne gouverne le catalogue | `admin` ; **aucune suppression n'est exposée**, l'archivage tient lieu de suppression (`docs/SPEC-workflow-engine.md` §2.6) |
| `workflows`, `workflow_steps`, `workflow_transitions` | Membres du workspace — **livré par `CRM-031`** avec `app.is_workspace_member`, qui **est** la règle spécifiée : aucun droit fin ne gouverne un workflow | `admin` ; **la suppression est exposée aux étapes et aux transitions**, et à elles seules — elles sont la composition d'un workflow et n'ont aucun `archived_at` (`docs/SPEC-workflow-engine.md` §3.7, `docs/JOURNAL.md` décision 74). Un workflow, lui, s'archive |
| `form_fields`, `form_field_rules` | Membres du workspace — **livré par `CRM-035`** avec `app.is_workspace_member`, qui **est** la règle spécifiée : aucun droit fin ne gouverne un formulaire, qui appartient à un workflow | `admin` ; **la suppression est exposée aux règles**, et à elles seules — un champ porte `archived_at` et l'archivage tient lieu de suppression, une règle est la composition d'un formulaire (`docs/SPEC-form-composer.md` §2.7, `docs/JOURNAL.md` décision 96) |
| `cards` | `app.can_read_card` | `app.can_write_channel` pour l'insertion et la mise à jour ; **`current_step_id` non modifiable directement** |
| `card_field_values` | Lecture de la card | Écriture sur le channel |
| `card_comments` | Lecture de la card | Écriture sur le channel ; modification et suppression réservées à l'auteur et aux `admin` |
| `card_activities` | Lecture de la card | Écriture sur le channel |
| `card_events` | Lecture de la card | **Aucune écriture par un client** : triggers uniquement |
| `contacts`, `organizations` | Membres du workspace | `business_developer` et `admin` |
| `mail_inbound_accounts`, `mail_outbound_identities` | Propriétaire, plus `admin` pour les comptes système | Propriétaire ; `admin` pour les comptes système |
| `mail_messages` | Membres du workspace ayant accès à la card, ou message non classé du workspace | Classement par RPC uniquement |
| `mail_attachments` | Comme le message porteur | Aucune écriture directe |
| `mail_outbox` | Propriétaire de l'identité, plus `admin` | Insertion par `queue_outbound_email` uniquement |
| `audit_log` | `admin` | **Aucune écriture par un client** |
| `api_tokens` | `admin` | `admin` ; le jeton en clair n'est affiché qu'à la création |
| `notifications` | Destinataire | Destinataire, pour marquer comme lu |
| `saved_views` | Propriétaire, plus les vues partagées du workspace | Propriétaire |

### Colonnes protégées

Certaines colonnes ne doivent jamais être écrites — ni lues — par un client, même lorsque la
ligne est lisible :

| Colonne | Protection |
|---|---|
| `cards.current_step_id` | Écriture refusée ; passe par `move_card` |
| `cards.email_local_part` | Généré par trigger, non modifiable |
| `mail_inbound_accounts.secret_id`, `mail_outbound_identities.secret_id` | **`REVOKE SELECT` pour `authenticated`** ; lisible par `service_role` uniquement |
| `api_tokens.token_hash` | Jamais exposé |
| `card_events.*`, `audit_log.*` | Insertion par trigger ou `service_role` |

La révocation au niveau colonne est indispensable : une politique RLS autorise ou refuse une
**ligne**, pas une colonne. Sans `REVOKE`, un membre légitime du workspace pourrait lire la
référence du secret de messagerie d'un collègue.

## 5. Storage

Les pièces jointes et les fichiers de formulaire sont rangés sous un préfixe portant le
workspace et la card. Les politiques d'accès au bucket reproduisent `app.can_read_card`.

Une pièce jointe dont `av_status` n'est pas `clean` n'est **jamais** servie, quelle que soit
l'autorisation du demandeur.

## 6. Comptes de service

`mail-sync` utilise le rôle `service_role`, qui contourne RLS. C'est assumé et borné :

- le service n'expose aucune route permettant d'exécuter une requête arbitraire ;
- son API interne vérifie l'identité de l'appelant et n'agit que sur les objets de cet appelant ;
- ses endpoints de test ne sont montés qu'en environnement de développement, sur une variable
  explicite, jamais en production.

## 7. Preuves de refus exigées

Chaque unité de backlog touchant aux droits fournit au minimum ces tests, exécutés **hors
interface**, avec les jetons réels de chaque profil :

| # | Scénario | Attendu |
|---|---|---|
| 1 | `viewer` tente `move_card` | Refus |
| 2 | `business_developer` tente de modifier un workflow | Refus — **acquise sur `workflow_nodes_catalog` par `CRM-030`** ; les trois autres tables de la famille restent dues par `CRM-031` |
| 3 | Membre du workspace A lit une card du workspace B | Aucune ligne |
| 4 | Utilisateur avec `channel_members.access='none'` lit une card de ce channel | Aucune ligne |
| 5 | Mise à jour directe de `cards.current_step_id` par PostgREST | Refus |
| 6 | Lecture de `secret_id` d'un compte mail par `authenticated` | Refus (colonne révoquée) |
| 7 | Lecture du compte mail d'un autre utilisateur | Aucune ligne |
| 8 | Insertion directe dans `card_events` ou `audit_log` | Refus |
| 9 | Téléchargement d'une pièce jointe `infected` ou `pending` | Refus |
| 10 | Dernier administrateur tente de se retirer son rôle | Refus |
| 11 | Utilisateur anonyme lit n'importe quelle table métier | Aucune ligne |
| 12 | `queue_outbound_email` avec une identité qui ne lui appartient pas | Refus |

Un refus ne se manifeste pas toujours par une erreur : pour une lecture, l'attendu est **zéro
ligne**. Les deux formes sont testées explicitement, car un test qui vérifie seulement l'absence
d'erreur ne prouve rien.

## 8. Points ouverts

1. **Suppression d'un membre** possédant des cards : réaffectation forcée, ou conservation avec
   un responsable inactif ? Comportement par défaut retenu : conservation, la card restant
   visible et réattribuable.
2. **Invitation d'un utilisateur externe** à un seul channel : couvert par `channel_members`,
   mais le parcours d'invitation correspondant reste à spécifier.
