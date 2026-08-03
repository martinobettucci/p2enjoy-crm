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

| Fonction | Retour |
|---|---|
| `app.is_workspace_member(ws uuid)` | l'appelant appartient au workspace |
| `app.is_workspace_admin(ws uuid)` | l'appelant y est administrateur |
| `app.can_read_track(track uuid)` | droit de lecture effectif sur le track |
| `app.can_read_channel(ch uuid)` | droit de lecture effectif sur le channel |
| `app.can_write_channel(ch uuid)` | droit d'écriture effectif sur le channel |
| `app.can_read_card(card uuid)` | dérivé du channel de la card |

Ces fonctions existent pour deux raisons : éviter la **récursion** des politiques (une politique
sur `workspace_members` qui interrogerait `workspace_members`), et garder les politiques lisibles
et indexables.

Elles sont `STABLE` et s'appuient sur `auth.uid()`. **Les droits ne sont pas portés par le JWT** :
une révocation prend effet immédiatement, sans attendre l'expiration du jeton.

## 4. Politiques par famille de tables

| Table | Lecture | Écriture |
|---|---|---|
| `profiles` | Membres d'un workspace commun | Son propre profil |
| `workspaces` | Membres | `admin` |
| `workspace_members` | Membres du workspace | `admin` ; **un administrateur ne peut pas se retirer son propre rôle s'il est le dernier** |
| `tracks` | `app.can_read_track` | `admin` |
| `channels` | `app.can_read_channel` | `admin` |
| `workflow_nodes_catalog`, `workflows`, `workflow_steps`, `workflow_transitions` | Membres du workspace | `admin` |
| `form_fields`, `form_field_rules` | Membres du workspace | `admin` |
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
| 2 | `business_developer` tente de modifier un workflow | Refus |
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
