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
| `app.can_read_track(track uuid)` | droit de lecture effectif sur le track, droits fins appliqués | `CRM-012` (§3.3) |
| `app.can_read_channel(ch uuid)` | droit de lecture effectif sur le channel, droits fins appliqués | `CRM-012` (§3.3) |
| `app.can_write_channel(ch uuid)` | droit d'écriture effectif sur le channel | `CRM-012` (§3.3) |
| `app.can_read_card(card uuid)` | dérivé du channel de la card | **différée** — `cards` arrive à `CRM-040` (INC-013) |

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

### 3.3 Les trois fonctions `can_*` livrées par `CRM-012`

Elles répondent à la question « ce track, ce channel, l'appelant y a-t-il droit ? » **après**
application des droits fins. Chacune se réduit à ce que le §3.1 annonçait : lire une ligne, puis
appeler `app.resolve_access`.

| Fonction | Composition | Vrai lorsque |
|---|---|---|
| `app.can_read_track(track)` | `resolve_access(workspace_role(t.workspace_id), tm.access, null)` | le résultat vaut `read` ou `write` |
| `app.can_read_channel(ch)` | `resolve_access(workspace_role(c.workspace_id), tm.access, cm.access)` | le résultat vaut `read` ou `write` |
| `app.can_write_channel(ch)` | la même expression | le résultat vaut `write` |

`tm` est la ligne `track_members` de l'appelant sur le track — celui du channel pour les deux
dernières —, `cm` sa ligne `channel_members`. **Les deux jointures sont externes** : l'absence de
ligne doit produire `NULL`, que `resolve_access` interprète comme « pas d'avis à ce niveau ». Une
jointure interne rendrait zéro ligne et transformerait « aucun droit fin » en refus, c'est-à-dire
l'exact inverse de la règle du §2.2.

**Un identifiant inconnu rend `NULL`, et le refus est explicite.** MESURÉ : appelée sur un track
inexistant, la requête ne rend aucune ligne, donc la fonction rend `NULL`. Dans un `USING` de
politique, `NULL` refuse déjà — mais les trois fonctions enveloppent néanmoins leur résultat dans
`coalesce(…, false)`. Le motif est celui de la décision 102 : un prédicat qui rend `NULL` se
comporte correctement **ici** et incorrectement ailleurs, et une fonction dont le contrat annonce
`boolean` doit rendre un booléen. Le comportement est figé par une assertion, pas seulement écrit.

**`SECURITY DEFINER`, `search_path` vide, et ce n'est pas un confort.** MESURÉ sur la pile réelle :
la politique de lecture de `tracks` appelle `app.can_read_track`, qui lit `public.tracks` — une
politique qui s'interroge elle-même. Adossée à la fonction `SECURITY DEFINER`, la lecture répond
avec le filtrage attendu ; une jumelle `SECURITY INVOKER` épuise la pile (`54001`). C'est la
seconde occurrence de la décision 27, et la raison pour laquelle ces fonctions existent.

### 3.4 Deux fonctions d'appui, livrées par `CRM-012`

| Fonction | Retour |
|---|---|
| `app.track_workspace(track uuid)` | workspace propriétaire du track, `NULL` s'il n'existe pas |
| `app.channel_workspace(ch uuid)` | workspace propriétaire du channel, `NULL` s'il n'existe pas |

Elles existent pour les politiques des tables du §4.1, qui doivent connaître le workspace d'une
ligne `track_members` — laquelle ne porte **pas** `workspace_id` (INC-011) et doit donc remonter
par `tracks`. Les écrire en `SECURITY DEFINER` évite la même récursion croisée qu'au §3.3 :
`track_members` interroge `tracks`, dont la politique interroge `track_members`. MESURÉ : aucune
récursion, et les deux tables restent lisibles avec le filtrage attendu.

## 4. Politiques par famille de tables

| Table | Lecture | Écriture |
|---|---|---|
| `profiles` | Membres d'un workspace commun | Son propre profil |
| `workspaces` | Membres | `admin` |
| `workspace_members` | Membres du workspace | `admin` ; **un administrateur ne peut pas se retirer son propre rôle s'il est le dernier** |
| `track_members` | Administrateur du workspace propriétaire du track, **et** l'intéressé pour sa propre ligne — **livré par `CRM-012`** (§4.1) | `admin` ; **la suppression est exposée** — retirer un droit fin est le geste normal de retour à l'accès hérité (§4.1) |
| `channel_members` | Administrateur du workspace propriétaire du channel, **et** l'intéressé pour sa propre ligne — **livré par `CRM-012`** (§4.1) | `admin` ; **la suppression est exposée**, même motif |
| `tracks` | `app.can_read_track` — **livré par `CRM-012`**, droits fins compris ; INC-024 close | `admin` ; **aucune suppression n'est exposée**, l'archivage tient lieu de suppression (`docs/SPEC-tracks.md` §4) |
| `channels` | `app.can_read_channel` — **livré par `CRM-012`**, droits fins compris ; INC-030 close | `admin` ; **aucune suppression n'est exposée**, l'archivage tient lieu de suppression (`docs/SPEC-channels.md` §4) |
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

### 4.1 Politiques des tables de droits fins

Aucun chapitre de ce document ne nommait les politiques de `track_members` et de
`channel_members` avant `CRM-012` : le tableau du §4 les omettait, alors qu'elles sont l'objet même
de l'unité. La lacune est consignée en `docs/INCONSISTENCY_REPORT.md`, **INC-045** ; la règle
ci-dessous la comble, et elle est écrite ici **avant** le code qui l'applique.

| Opération | Autorisée à | Prédicat |
|---|---|---|
| `SELECT` | administrateur du workspace, **et** l'utilisateur concerné pour sa propre ligne | `app.is_workspace_admin(app.track_workspace(track_id)) or user_id = auth.uid()` |
| `INSERT` | administrateur du workspace | le même `is_workspace_admin`, en `WITH CHECK` |
| `UPDATE` | administrateur du workspace | le même, en `USING` **et** en `WITH CHECK` |
| `DELETE` | administrateur du workspace | le même, en `USING` |

Trois choix méritent leur motif.

**Un droit fin n'est pas une donnée d'équipe.** Savoir que telle collègue est écartée de tel
channel est une information d'administration, non un élément de travail partagé. La lecture est
donc réservée à l'administration — et à l'intéressé, qui doit pouvoir constater ce qui s'applique
à lui, sans quoi une restriction serait invisible à celui qui la subit.

**La suppression est exposée ici, contrairement aux tracks et aux channels.** Ces deux tables
n'ont aucun `archived_at`, et retirer un droit fin n'est pas une suppression de donnée métier :
c'est le retour à l'accès **hérité** du rôle de workspace, c'est-à-dire l'état par défaut du §2.2.
Le remplacer par un archivage obligerait à distinguer « aucune ligne » de « ligne archivée », deux
états que `app.resolve_access` traite identiquement. Même raisonnement que la décision 96 pour
`form_field_rules`.

**Un administrateur peut se restreindre lui-même, et cela ne l'atteint pas.** La règle 2 du §2.2 —
« un administrateur n'est jamais restreint » — vaut à la résolution, pas à l'écriture. Une ligne
`track_members` posée sur un administrateur est acceptée, stockée, lisible, et **sans effet**. Ce
n'est pas une incohérence : la ligne redevient opposante le jour où ce compte cesse d'être
administrateur, ce qui est exactement le comportement voulu d'une donnée déclarative.

### 4.2 Contrat d'API — droits fins

`A` désigne le workspace du seed. Les lignes sont **mesurées** sur la pile réellement démarrée,
avec les jetons des trois comptes seedés obtenus par la véritable route de connexion, et non
prédites.

| # | Appelant et opération | Code | Corps |
|---|---|---|---|
| a | `anon` lit `track_members` | `200` | `[]` — refus par zéro ligne, preuve n° 11 |
| b | `admin` lit `track_members` | `200` | toutes les lignes du workspace |
| c | `viewer` lit `track_members` | `200` | **ses propres lignes seulement** |
| d | `viewer` lit un track sur lequel il porte `access = 'none'` | `200` | `[]` — **preuve n° 4** au niveau des tracks |
| e | `viewer` lit un channel sur lequel il porte `access = 'none'` | `200` | `[]` — **preuve n° 4** au niveau des channels |
| f | `viewer` lit un channel rouvert par `channel_members.access = 'member'` sous un track fermé | `200` | la ligne — « le plus spécifique gagne » dans les deux sens |
| g | `admin` porteur d'un `access = 'none'` lit ce même track | `200` | la ligne — un administrateur n'est jamais restreint |
| h | `business_developer` pose un droit fin | `403` | `42501`, `new row violates row-level security policy` |
| i | `admin` pose un droit fin | `201` | la ligne |
| j | `admin` supprime un droit fin | `204` | l'accès redevient hérité |
| k | `admin` de A pose un droit fin sur un track de B | `403` | `42501` |
| l | `admin` de A lit les tracks de B | `200` | `[]` — **preuve n° 3**, inchangée par le resserrement |

### 4.3 Colonnes protégées

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
| 3 | Membre du workspace A lit une card du workspace B | Aucune ligne — **acquise sur `tracks` et `channels`** par `CRM-020`, `CRM-021` et reconduite par `CRM-012` ; sur les cards, due par `CRM-040` |
| 4 | Utilisateur avec `channel_members.access='none'` lit une card de ce channel | Aucune ligne — **acquise sur le channel lui-même et sur son track** par `CRM-012` (§4.2, lignes *d* et *e*) ; sur les cards, due par `CRM-040` |
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
3. **Les politiques des tables d'identité** — `profiles`, `workspaces`, `workspace_members` — que
   le §4 spécifie ne sont portées par **aucune** unité du backlog, et la preuve n° 10 non plus.
   `CRM-012` ne les écrit pas : son objet est le droit fin par track et par channel, et se les
   attribuer trancherait INC-014 à la place du responsable. Ces trois tables restent en refus par
   défaut. **Arbitrage attendu**, `docs/INCONSISTENCY_REPORT.md` INC-014.
4. **`app.can_read_card`** reste différée : `cards` arrive à `CRM-040`. Le motif d'INC-013 est
   éteint pour les trois autres fonctions, dont les tables existent ; il subsiste pour celle-là
   seule.
