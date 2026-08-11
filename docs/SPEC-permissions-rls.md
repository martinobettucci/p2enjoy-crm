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
| `app.can_read_card(card uuid)` | dérivé du channel de la card | `CRM-040` (§3.6) — INC-013 close |
| `app.can_write_card(card uuid)` | droit d'**écriture** dérivé du channel de la card | `CRM-036` (§3.7) |

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

### 3.5 Une politique n'appelle jamais une fonction qui relit sa propre table

**Règle générale, née d'un défaut mesuré** (`docs/JOURNAL.md`, décision 107).

Une politique `SELECT` gouverne aussi le `RETURNING` d'un `INSERT` ou d'un `UPDATE` — ce que
PostgREST émet dès que l'appelant demande `Prefer: return=representation`. Si son prédicat appelle
une fonction `STABLE` qui **relit la table gouvernée**, cette fonction voit le cliché du début de
l'instruction : la ligne qui vient d'être écrite lui est invisible, la politique la refuse, et
l'écriture entière est annulée en `42501`. Le défaut se manifeste **à l'écriture**, là où personne
ne cherche une politique de lecture.

La règle est donc : le prédicat d'une politique n'emploie que **les colonnes de la ligne évaluée**
et des tables **tierces**. Les fonctions destinées aux politiques prennent ces colonnes en
argument plutôt qu'un identifiant à résoudre :

| Fonction | Employée par | Lit |
|---|---|---|
| `app.resolve_track_access(ws, track)` | la politique de `tracks` | `workspace_members`, `track_members` |
| `app.resolve_channel_access(ws, track, ch)` | la politique de `channels` | `workspace_members`, `track_members`, `channel_members` |

Les fonctions `can_*` du §3.3 conservent leur signature à un seul identifiant : elles s'adressent
aux appelants qui n'ont que lui — une garde RPC, un test — et délèguent à celles-ci. Ce sont deux
usages distincts, et les confondre est précisément ce qui a produit le défaut.

### 3.6 `app.can_read_card`, livrée par `CRM-040`, et qu'aucune politique de `cards` n'appelle

```
app.can_read_card(card uuid) → boolean
  = coalesce((select app.can_read_channel(c.channel_id) from public.cards c where c.id = card), false)
```

`SECURITY DEFINER`, `STABLE`, `search_path` vidé, `EXECUTE` accordé à `anon`, `authenticated` et
`service_role` pour le motif du §3.2.

**Les politiques de `cards` ne l'appellent pas**, et c'est la règle du §3.5 appliquée avant d'être
payée une seconde fois : une politique qui appellerait `app.can_read_card(id)` relirait `cards`, et
une fonction `STABLE` ne voit pas la ligne que l'instruction en cours vient d'écrire — le
`RETURNING` d'un `INSERT` étant soumis à la politique `SELECT`, **toute création de card rendrait
`403`**. C'est exactement le défaut trouvé par `CRM-012` sur `tracks` (décision 107). Les politiques
de `cards` jugent donc sur `channel_id`, **colonne de la ligne jugée**.

Ses appelants sont les tables **filles** — `card_comments` (`CRM-043`), `card_field_values`
(`CRM-036`), `card_events` (`CRM-044`), `mail_messages` (`CRM-054`) et les politiques de Storage
(§5) —, qui ne disposent que d'un `card_id`. **`CRM-036` est son premier appelant réel** : la
politique de lecture de `card_field_values` l'emploie, et le défaut de la décision 107 ne s'y
reproduit pas — la fonction lit `cards`, une **autre** table, déjà écrite.

### 3.7 `app.can_write_card`, livrée par `CRM-036`

```
app.can_write_card(card uuid) → boolean
  = coalesce((select app.can_write_channel(c.channel_id) from public.cards c where c.id = card), false)
```

Symétrique exact de `app.can_read_card`, et livrée pour la même raison : **une table fille ne
dispose que d'un `card_id`**, et aucune politique d'écriture ne peut atteindre le channel sans
cette jointure. Le tableau du §4 prescrivait « Écriture sur le channel » pour `card_field_values`,
`card_activities` et `card_comments` sans dire par quel chemin ; ce chemin est celui-ci.

`SECURITY DEFINER`, `STABLE`, `search_path` vidé. `EXECUTE` accordé à `anon` **aussi**, pour le
motif du §3.2 : sans lui, un appelant anonyme atteignant une table dont la politique l'appelle
recevrait une erreur de privilège là où le comportement exigé par le §7 est **zéro ligne**. Le droit
n'ouvre rien — `auth.uid()` étant nul, `app.can_write_channel` rend faux.

**Comme `app.can_read_card`, elle n'est pas appelée par les politiques de `cards`**, qui jugent sur
`channel_id`, colonne de la ligne jugée (§3.5, §3.6).

### 3.8 Ce que `CRM-010` doit prouver des six fonctions, une fois toutes livrées

Chapitre ajouté par `CRM-010` le 2026-08-05, **après mesure sur la pile réelle**, pour dire ce que
sa Definition of Done exige des quatre fonctions qu'INC-013 lui avait retirées, et qui existent
désormais toutes. Il n'introduit **aucun comportement nouveau** : il énonce le contrat que les
preuves de l'unité doivent exercer, et que trois unités successives ont écrit sans qu'aucune ne le
rassemble.

La Definition of Done de `CRM-010` porte trois exigences. Les trois ont été satisfaites en 2026-08-03
pour les deux fonctions alors écrivables, et **aucune** ne l'a été pour les quatre autres.

**a. « pgTAP couvrant chaque rôle et chaque combinaison de droits fins ».** `CRM-010` a énuméré les
64 combinaisons du §2.2 sur `app.resolve_access`, fonction **pure** : la règle métier est donc
prouvée, mais pas la **jointure** qui l'alimente. C'est exactement ce qu'INC-013 nommait — « il
manque la jointure qui remonte au workspace ». `CRM-012` l'éprouve sur un échantillon de
combinaisons, choisi pour attraper le défaut de jointure externe de la décision 104 ; l'énumération
exhaustive **à travers des lignes réelles** n'existe nulle part. Le contrat à exercer est l'égalité,
pour les 64 combinaisons de (rôle de workspace × droit fin de track × droit fin de channel) :

| Fonction | Doit valoir |
|---|---|
| `app.can_read_track(t)` | `resolve_access(rôle, accès_track, null) <> 'none'` |
| `app.can_read_channel(c)` | `resolve_access(rôle, accès_track, accès_channel) <> 'none'` |
| `app.can_write_channel(c)` | `resolve_access(rôle, accès_track, accès_channel) = 'write'` |

Les quatre états de chaque droit fin sont `member`, `viewer`, `none` et **l'absence de ligne**, que
la jointure externe du §3.3 rend `NULL`. Les quatre états du rôle de workspace sont `admin`,
`business_developer`, `viewer` et **l'absence d'appartenance**.

`app.can_read_card` n'entre pas dans cette matrice : le §3.6 la définit comme une **délégation
stricte**, sans règle propre. Son contrat est donc l'égalité `can_read_card(k) = can_read_channel(k.channel_id)`
pour **toute** card, et sous **toute** identité, y compris anonyme.

**b. « absence de récursion démontrée ».** MESURÉ le 2026-08-05 sur la pile de développement, avec
l'identité `viewer` du seed, chaque cas dans une transaction annulée :

| Cas | Politique posée sur | Prédicat | Résultat mesuré |
|---|---|---|---|
| A | `public.tracks` | `app.can_read_track(id)` — livrée, `SECURITY DEFINER` | **3 lignes**, soit exactement ce que rend la politique livrée |
| B | `public.tracks` | jumelle `SECURITY INVOKER` de la même fonction | `54001` — *stack depth limit exceeded* |
| C | `public.channels` | `app.can_read_channel(id)` — livrée | **4 lignes**, identique à la politique livrée |
| D | `public.channels` | jumelle `SECURITY INVOKER` | `54001` |
| E | `public.cards` | `app.can_read_card(id)` — livrée | **4 lignes**, identique à la politique livrée |
| F | `public.cards` | jumelle `SECURITY INVOKER` | `54001` |

Les trois fonctions qui lisent une table **elle-même protégée par RLS** ne sont donc non récursives
que parce qu'elles sont `SECURITY DEFINER`. Ce n'est pas une propriété du code écrit : c'est une
propriété de son **mode d'exécution**, qu'un `alter function … security invoker` suffit à détruire
sans changer une ligne de la définition. La démonstration se fait donc en **provoquant** la
récursion, jamais en l'affirmant — c'est le procédé de la décision 27, étendu aux trois tables que
`CRM-010` ne pouvait pas atteindre.

Le graphe **réellement livré** ne referme aucun de ces cycles : les politiques de `tracks`, de
`channels` et de `cards` n'appellent pas les fonctions qui reliraient leur propre table (§3.5, §3.6).
La chaîne la plus longue du produit est celle de `card_field_values` → `can_read_card` → `cards` →
`can_read_channel` → `channels` → `resolve_channel_access` → `workspace_members` ; MESURÉ, elle
répond, et rend **7 lignes** au `viewer` du seed.

**c. « `search_path` fixé sur toutes les fonctions `SECURITY DEFINER` ».** La formulation dit
« toutes », et `CRM-010` ne l'a vérifié que sur les sept fonctions de sa propre migration — les
seules qui existaient. Le produit en compte aujourd'hui davantage, écrites par onze migrations.
L'exigence est donc **un recensement, pas une liste** : aucune fonction des schémas `app` et
`public` ne doit être `SECURITY DEFINER` sans porter `search_path = ''`. MESURÉ le 2026-08-05 :
**29 fonctions**, dont **18** `SECURITY DEFINER`, et **aucune** sans `search_path` vide.

Écrite ainsi, la preuve devient un garde-fou : elle tombe le jour où une unité ultérieure ajoute une
fonction `SECURITY DEFINER` en oubliant son `search_path`, sans qu'aucune liste ait à être tenue à
jour à la main.

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
| `workflow_transition_required_fields` | Membres du workspace du workflow, résolu par la transition — **livré par `CRM-018`** ; `anon` conserve le privilège `SELECT` nécessaire à la preuve mais aucune politique ne lui ouvre de ligne | `admin` pour `INSERT` et `DELETE` ; **aucun `UPDATE` exposé** : modifier une liaison signifie la supprimer puis la créer. Un trigger, appliqué aussi au service, interdit de croiser deux workflows (`docs/SPEC-transition-required-fields.md` §4) |
| `form_fields`, `form_field_rules` | Membres du workspace — **livré par `CRM-035`** avec `app.is_workspace_member`, qui **est** la règle spécifiée : aucun droit fin ne gouverne un formulaire, qui appartient à un workflow | `admin` ; **la suppression est exposée aux règles**, et à elles seules — un champ porte `archived_at` et l'archivage tient lieu de suppression, une règle est la composition d'un formulaire (`docs/SPEC-form-composer.md` §2.7, `docs/JOURNAL.md` décision 96) |
| `cards` | `app.can_read_channel(channel_id)` — **la colonne de la ligne, non `app.can_read_card`** (§3.6) | `app.can_write_channel(channel_id)` pour l'insertion et la mise à jour ; **`current_step_id` non modifiable directement : dû par `CRM-013`, non livré par `CRM-040`** |
| `card_field_values` | `app.can_read_card(card_id)` — **livré par `CRM-036`** | `app.can_write_card(card_id)` (§3.7) pour l'insertion et la mise à jour ; **aucune suppression n'est exposée**, vider un champ c'est écrire `'null'::jsonb` (`docs/SPEC-form-composer.md` §6.9) |
| `card_comments` | Lecture de la card | Écriture sur le channel ; modification et suppression réservées à l'auteur et aux `admin` |
| `card_activities` | Lecture de la card | Écriture sur le channel |
| `card_events` | Lecture de la card | **Aucune écriture par un client** : triggers uniquement |
| `contacts`, `organizations` | Membres du workspace | `business_developer` et `admin` |
| `mail_inbound_accounts`, `mail_outbound_identities` | Propriétaire, plus `admin` pour les comptes système | Propriétaire ; `admin` pour les comptes système |
| `mail_messages` | Message **classé** : `app.can_read_card(card_id)`. Message **non classé** : la boîte où il a été vu — son propriétaire, ou un `admin` du workspace (`CRM-057`, `docs/SPEC-mail-subsystem.md` §18.1) | Classement par RPC uniquement, et le RPC exige **les deux** droits : voir le message, écrire dans la card |
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

**Un refus de suppression ne lève aucune erreur — il ne supprime rien.** MESURÉ pendant
l'implémentation, et contraire à ce que ce chapitre annonçait d'abord : le `USING` d'une politique
`for delete` **filtre** les lignes candidates. La commande réussit, `DELETE 0`, et PostgREST rend
`200` avec `[]`. Seul un `WITH CHECK` lève `42501`, et une politique de suppression n'en porte pas.

Conséquence pour les preuves, et elle n'est pas cosmétique : **un refus de suppression se prouve en
relisant la ligne**, jamais en constatant une erreur ni son absence. Un test qui se contenterait de
« la commande n'a pas échoué » serait vert que la règle tienne ou qu'elle soit retirée. C'est le
dernier paragraphe du §7 — « un refus ne se manifeste pas toujours par une erreur » — appliqué à la
suppression, où il est le plus facile d'oublier. Voir `docs/JOURNAL.md`, décision 106.

**Un administrateur peut se restreindre lui-même, et cela ne l'atteint pas.** La règle 2 du §2.2 —
« un administrateur n'est jamais restreint » — vaut à la résolution, pas à l'écriture. Une ligne
`track_members` posée sur un administrateur est acceptée, stockée, lisible, et **sans effet**. Ce
n'est pas une incohérence : la ligne redevient opposante le jour où ce compte cesse d'être
administrateur, ce qui est exactement le comportement voulu d'une donnée déclarative.

### 4.1 bis Politiques d'identité — contrat de `CRM-022`

Le tableau du §4 ne disait pas comment éviter la récursion de `workspace_members`, quelles
colonnes d'un profil sont réellement modifiables ni comment la suppression du dernier admin se
distingue du refus par défaut. `docs/SPEC-identite.md` ferme ces trois questions avant la migration
21 :

- `profiles` : soi-même ou un profil qui partage au moins un workspace ; mise à jour de sa seule
  ligne, limitée par privilège à `full_name` et `avatar_url` ;
- `workspaces` : lecture par appartenance, aucune écriture cliente dans cette unité ;
- `workspace_members` : lecture par tout membre du workspace, mutations par l'admin, mise à jour
  limitée à `role` ;
- un constraint trigger différable refuse `last_workspace_admin` (`23514`) si un workspace
  peuplé perd tout admin, mais laisse la cascade d'un workspace supprimé aboutir.

Les politiques de membership appellent `app.is_workspace_member` et
`app.is_workspace_admin`, fonctions `SECURITY DEFINER` existantes. La politique de profils remonte
par les memberships consentis ; aucune politique ne relit sa propre table.

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
| j' | `viewer` supprime **sa propre** restriction | `200` | `[]` — **aucune erreur, aucune suppression** : le `USING` filtre, la ligne survit (§4.1) |
| k | `admin` de A pose un droit fin sur un track de B | `403` | `42501` |
| l | `admin` de A lit les tracks de B | `200` | `[]` — **preuve n° 3**, inchangée par le resserrement |

### 4.3 Colonnes protégées

Certaines colonnes ne doivent jamais être écrites — ni lues — par un client, même lorsque la
ligne est lisible :

| Colonne | Protection |
|---|---|
| `cards.current_step_id` | Écriture refusée ; passe par `move_card` — **livrée par `CRM-034`**, voir ci-dessous |
| `cards.email_local_part` | Généré par trigger, écriture refusée — **LIVRÉE par `CRM-013`**, `supabase/migrations/0014_colonnes_protegees.sql`, spécifiée au §4.4. La **lecture** reste ouverte : une adresse de card est une identité, non un secret. INC-050 est close par cette livraison |
| `cards.entered_step_at` | Fermée **par conséquence** du mécanisme ci-dessous, et c'est le comportement voulu : `docs/SPEC-cards.md` §2.9 la réserve nommément à `move_card`, et un client qui la réécrirait fausserait toute mesure d'ancienneté à l'étape — livrée par `CRM-034` |
| `mail_inbound_accounts.secret_id`, `mail_outbound_identities.secret_id` | **`REVOKE SELECT` pour `authenticated`** ; lisible par `service_role` uniquement |
| `api_tokens.token_hash` | Jamais exposé |
| `card_events.*`, `audit_log.*` | Insertion par trigger ou `service_role` |

La révocation au niveau colonne est indispensable : une politique RLS autorise ou refuse une
**ligne**, pas une colonne. Sans `REVOKE`, un membre légitime du workspace pourrait lire la
référence du secret de messagerie d'un collègue.

**Comment la révocation d'écriture s'écrit réellement, mesuré par `CRM-034`.** PostgreSQL n'offre
pas de `REVOKE UPDATE (colonne)` qui laisserait intact un `GRANT UPDATE` posé sur la table entière :
un privilège de table couvre toutes ses colonnes, y compris futures. La forme qui fonctionne est le
retrait du privilège de table, suivi d'un `GRANT UPDATE (…)` **énumérant** les colonnes ouvertes :

```
revoke update on public.cards from authenticated;
grant  update (title, description, position, …) on public.cards to authenticated;
```

Trois conséquences, toutes mesurées et toutes à connaître avant d'employer ce mécanisme ailleurs :

1. **une colonne nouvelle est fermée par défaut.** Toute migration ultérieure qui ajoute une colonne
   destinée à être modifiable doit l'ajouter à cette énumération, faute de quoi elle sera
   silencieusement en lecture seule ;
2. **une fonction `SECURITY DEFINER` n'est pas concernée** : elle s'exécute avec les droits de son
   propriétaire. C'est ce qui permet à `move_card` d'écrire ce que son appelant ne peut pas écrire ;
3. **le refus rend `403` et divulgue la commande `GRANT` à exécuter** — comportement de PostgREST,
   quatrième occurrence d'INC-026.

**Le mécanisme est livré, et la liste réellement posée est celle-ci** — douze colonnes, depuis que
`CRM-013` a retiré la treizième (`supabase/migrations/0014_colonnes_protegees.sql`) : `title`,
`description`, `position`, `owner_id`, `amount`, `currency`, `probability_override`,
`next_action`, `next_action_at`, `snoozed_until`, `archived_at`, `deleted_at`. Sont donc fermées :
`id`, `workspace_id`, `channel_id`, `workflow_id`, `current_step_id`, `entered_step_at`,
`email_local_part`, `health_score`, `created_by`, `created_at`, `updated_at`. `search_tsv` est
générée et ne l'a jamais été. `service_role` conserve `all privileges`, le `revoke` ne visant
qu'`authenticated` : le seed est inchangé.

**Dépendance d'ordre 12 → 14, et elle est réelle.** La section 2 de la migration 12 réapplique
elle aussi ces privilèges, `email_local_part` **comprise** — état d'avant `CRM-013`. Rejouer la 12
seule **rouvre** donc la colonne, sans aucun signal. Tout harnais qui rejoue la 12 doit rejouer la
13 puis la 14 derrière elle ; `docs/PROD_MIGRATIONS.md` §3 le consigne, et
`scripts/verify-colonnes-protegees.sh` le mesure **dans les deux sens**.

**Cette dépendance est rétroactive, et deux harnais antérieurs ont dû être repris** :
`scripts/verify-cards.sh` et `scripts/verify-valeurs-champs.sh` rejouent la migration 12 — le
second en **trois** endroits — et sortaient donc sur une colonne rouverte, tout en annonçant
« aucune anomalie ». Ils n'étaient pas fautifs à leur écriture : la migration 14 n'existait pas.
La règle générale à en tirer est écrite en `docs/JOURNAL.md`, décision 145 — **une migration qui
retire un privilège crée une dette sur tout harnais rejouant une migration antérieure, et la
trouver exige de mesurer l'état de la base après chaque harnais, un par un.** La question de
l'inscrire dans `docs/SPEC-test-harness.md` plutôt que de la traiter harnais par harnais est posée
en INC-055.

La conséquence n° 1 ci-dessus n'est pas laissée à la mémoire : `supabase/tests/0013_move_card.test.sql`
et `supabase/tests/0015_colonnes_protegees.test.sql` **énumèrent les colonnes ouvertes une par
une**, et la seconde en **compte** le total, de sorte qu'ajouter une colonne à `cards` sans
trancher son cas — ou en fermer une de trop — fasse échouer la suite.

Le détail de la garde et de ses six vérifications est dans `docs/SPEC-workflow-engine.md` §5 —
**les six sont livrées** depuis `CRM-036`, qui a apporté `card_field_values` et refermé INC-047.

### 4.4 Ce que `CRM-013` ferme, et ce qu'elle laisse ouvert

`CRM-013` porte six cibles dans son énoncé. **Cinq de leurs tables n'existent pas** :
`mail_inbound_accounts` et `mail_outbound_identities` arrivent avec `CRM-052` et `CRM-053`,
`api_tokens` avec `CRM-073`, `card_events` avec `CRM-044`, `audit_log` avec `CRM-072`. Une
protection ne s'écrit pas sur une table absente, et la simuler serait le faux vert que
`CLAUDE.md` §17 proscrit.

Reste `cards`. `current_step_id` a été fermée par `CRM-034` (INC-049, chevauchement tranché de ce
côté). **`cards.email_local_part` est donc la seule cible de `CRM-013` qui soit livrable
aujourd'hui**, et ce chapitre la spécifie.

#### 4.4.1 Le défaut, mesuré et non déduit

MESURÉ le 2026-08-05 sur la pile réelle, avec le **jeton réel** de `admin@p2enjoy.test` obtenu par
la véritable route de connexion :

```
PATCH /rest/v1/cards?id=eq.5eed…00c1   {"email_local_part":"c-00000000"}
→ HTTP 200 ; relecture : {"email_local_part":"c-00000000"}
```

`information_schema.column_privileges` confirme la cause : `authenticated` détient `UPDATE` sur
**treize** colonnes de `cards`, dont `email_local_part`.

Ce n'est pas une coquette imperfection. `docs/SCHEMA.md` §5 et `docs/SPEC-cards.md` §3.3 fondent
l'adresse d'une card sur sa **non-devinabilité** : quarante bits tirés au hasard, précisément pour
qu'on ne puisse pas écrire à une card dont on ignore l'adresse. Un membre qui écrit sur le channel
peut aujourd'hui remplacer cette adresse par `c-00000000`. La propriété que le tirage achète, une
mise à jour la rend au client.

#### 4.4.2 Ce qui n'est PAS un défaut, et qu'il ne faut donc pas « corriger »

MESURÉ, toujours avec le jeton de l'administratrice :

```
POST /rest/v1/cards   {…, "email_local_part":"c-zzzzzzzz"}
→ HTTP 201 ; adresse enregistrée : « c-2c3qgad2 »
```

Le chemin d'**insertion** est déjà sûr : le trigger de `CRM-040` écrase la valeur fournie
(`docs/SPEC-cards.md` §3.4). Le privilège `INSERT` reste donc **de table**, inchangé. Le fermer
ferait rendre `403` à une requête que le produit accepte aujourd'hui sans dommage, et casserait
tout client qui renvoie la ligne entière. `CRM-013` ne touche qu'`UPDATE`.

#### 4.4.3 La forme retenue, et pourquoi il n'y en a pas d'autre

Le mécanisme est celui du §4.3, déjà mesuré par `CRM-034` : le privilège de table est retiré, puis
rendu colonne par colonne. La liste posée par `CRM-013` est celle du §5.5 de
`docs/SPEC-workflow-engine.md`, **sans** `email_local_part` :

```
revoke update on public.cards from authenticated;
grant  update (title, description, position, owner_id, amount, currency,
               probability_override, next_action, next_action_at, snoozed_until,
               archived_at, deleted_at) on public.cards to authenticated;
```

Deux écritures ont été écartées, et le motif de chacune est écrit ici plutôt que laissé à la
relecture :

- **un trigger `BEFORE UPDATE` qui restaurerait `OLD.email_local_part`** : il *ignorerait*
  silencieusement l'écriture au lieu de la refuser. `CLAUDE.md` §18 interdit nommément de masquer
  une erreur par une valeur par défaut trompeuse ; un appelant recevrait `200` en croyant avoir
  renommé l'adresse ;
- **un trigger qui lèverait une exception** : il ferait double emploi avec le privilège, et le
  privilège seul suffit — il est vérifié par le moteur avant toute exécution, il vaut pour tout
  chemin SQL, et c'est la forme que le §4.3 prescrit déjà.

**Ce que le privilège ne couvre pas, et qui est nommé :** `service_role` conserve
`all privileges`. Le seed, et demain `mail-sync` (`CRM-051`), peuvent donc encore écrire cette
colonne. C'est voulu — le seed en dépend — mais cela signifie qu'un service qui se tromperait de
colonne ne serait arrêté par rien. Aucun consommateur n'existe aujourd'hui ; le jour où
`mail-sync` écrira sur `cards`, la question devra être reposée.

#### 4.4.4 Contrat d'API, à mesurer et non à supposer

Douze lignes, avec les **jetons réels** des trois profils du seed. Les lignes *c* et *d* étaient
des **prédictions** sur le comportement de PostgreSQL, écrites avant le code : toutes deux sont
**confirmées par la mesure**. La ligne *g*, elle, a été **révisée par la mesure** — elle disait
« refus » sans préciser le code.

| # | Appelant | Requête | Attendu |
|---|---|---|---|
| a | `admin` | `PATCH cards` `{email_local_part}` | `403`, `42501`, `permission denied for table cards` ; **ligne relue inchangée** |
| b | `admin` | `PATCH cards` `{title}` | `204` — MESURÉ ; les douze colonnes ouvertes le restent |
| c | `admin` | `PATCH cards` `{title, email_local_part}` | `403`, **et le titre n'est pas modifié non plus** : le refus porte sur l'instruction entière |
| d | `admin` | `PATCH cards` `{email_local_part}` à sa **valeur courante** | `403` — le privilège se vérifie sur les colonnes **nommées**, pas sur les valeurs changées |
| e | `business_developer` | `PATCH cards` `{email_local_part}` sur une card qu'il écrit | `403`, `42501` |
| f | `viewer` | `PATCH cards` `{email_local_part}` sur une card qu'il **voit** | `403` — profil authentifié, donc `403` et non `401` (§2.8 de `CRM-035`) |
| g | anonyme | `PATCH cards` `{email_local_part}` | **`401`**, `42501` — RÉVISÉE PAR LA MESURE : un appelant sans session obtient `401` là où un profil authentifié obtient `403` (§2.8 de `CRM-035`) ; aucune ligne touchée |
| h | `admin` | `POST cards` avec un `email_local_part` choisi | `201`, adresse **générée**, différente de celle qui est fournie |
| i | `admin` | `GET cards?select=email_local_part` | `200` — la colonne se **lit** : elle n'est pas un secret, elle est une **identité** |
| j | anonyme | `GET cards` | `200` et `[]` — **preuve n° 11**, zéro ligne et non une erreur |
| k | `viewer` | `GET cards` d'un channel dont le track lui est fermé | `200` et `[]` — **preuve n° 4**, reconduite |
| l | `service_role` | `PATCH cards` `{email_local_part}` | `204` — MESURÉ ; le chemin du seed reste ouvert, §4.4.3 |

Le refus divulgue la commande `GRANT` à exécuter, dans son `hint`. C'est le comportement de
PostgREST, **cinquième occurrence d'INC-026**, et il n'est pas corrigé ici.

#### 4.4.5 INC-050 s'éteint par exécution, sans arbitrage

INC-050 constatait que le §5.5 de `docs/SPEC-workflow-engine.md` se contredit : sa prose range
`email_local_part` parmi ce qui « reste à `CRM-013` », son bloc `GRANT` ne la liste pas. Les deux
branches de l'arbitrage attendu ne portaient **que sur l'attribution** — quelle unité ferme la
colonne — et non sur le comportement final, identique dans les deux cas : la colonne finit fermée.

`CRM-013` étant exécutée, l'énoncé de son unité dans `docs/BACKLOG.md` — « `current_step_id` et
`email_local_part` non modifiables directement » — tranche l'attribution sans qu'aucune décision
de produit ne soit prise à la place du responsable. L'état posé coïncide alors exactement avec le
bloc `GRANT` du §5.5, et la contradiction disparaît d'elle-même.

#### 4.4.6 Preuves de `CRM-013`, produites

1. les douze lignes du contrat §4.4.4 mesurées hors interface, avec les jetons réels ;
2. `authenticated` privé d'`UPDATE` sur `email_local_part`, **et** conservant les douze autres —
   énumérées une par une, de sorte qu'une fermeture trop large échoue ;
3. `service_role` inchangé, seed rejoué sans erreur ;
4. le trigger d'insertion toujours en place et toujours écrasant la valeur fournie ;
5. les trois garde-fous posés par `CRM-034` et `CRM-040` **retournés** — non retirés :
   `supabase/tests/0012_cards.test.sql`, `supabase/tests/0013_move_card.test.sql`,
   `scripts/verify-move-card.sh` ;
6. un harnais **non complaisant** : la colonne rouverte à la main fait passer une écriture qui doit
   être refusée, et la restauration est **constatée** ;
7. la dépendance d'ordre **12 → 14** mesurée dans les deux sens, comme la 12 → 13 l'a été par
   `CRM-036` : rejouer la migration 12 seule **rouvre** la colonne.

## 5. Storage

Les pièces jointes et les fichiers de formulaire sont rangés sous un préfixe portant le
workspace et la card. Les politiques d'accès au bucket reproduisent `app.can_read_card`.

Une pièce jointe dont `av_status` n'est pas `clean` n'est **jamais** servie, quelle que soit
l'autorisation du demandeur.

**Livré par `CRM-057` pour le bucket `mail-attachments`**, et sous une forme que la mesure impose
(`docs/SPEC-mail-subsystem.md` §18.5) :

- la politique de lecture n'ouvre qu'une **intersection** : le bon bucket, le statut `clean`, et le
  droit de voir le message porteur — lequel suit la card pour un message classé, la boîte pour un
  message non classé ;
- elle est écrite par une migration déclarant `-- @migration-role: supabase_admin`, car
  `storage.objects` appartient à `supabase_storage_admin` et `postgres` n'en est **pas** membre ;
- `anon` et `authenticated` détiennent déjà tous les privilèges de **table** sur `storage.objects`,
  et seule l'absence de politique les refusait : une politique large ouvrirait tout le stockage, et
  la restriction au bucket est donc portée par la politique elle-même, jamais supposée ;
- **aucune écriture** n'est ouverte : le dépôt reste le fait de `service_role`.

## 6. Comptes de service

`mail-sync` utilise le rôle `service_role`, qui contourne RLS. C'est assumé et borné :

- le service n'expose aucune route permettant d'exécuter une requête arbitraire ;
- son API interne vérifie l'identité de l'appelant et n'agit que sur les objets de cet appelant ;
- ses endpoints de test ne sont montés qu'en environnement de développement, sur une variable
  explicite, jamais en production.

## 7. Preuves de refus exigées

Chaque unité de backlog touchant aux droits fournit au minimum ces tests, exécutés **hors
interface**, avec les jetons réels de chaque profil.

`CRM-014` **rassemble** ces douze scénarios en un seul fichier — `e2e/api/preuves-refus.spec.ts` —
sans retirer ceux que les unités précédentes ont posés chacune dans leur propre fichier. Le §7.1
dit pourquoi cette duplication est voulue, et le §7.2 donne le contrat mesuré de chaque scénario.

| # | Scénario | Attendu |
|---|---|---|
| 1 | `viewer` tente `move_card` | Refus — **ACQUISE par `CRM-034`** : `403`, `42501`, `forbidden`, mesuré avec le jeton réel du `viewer` sur une card qu'il **voit**. Sur une card d'un channel que le seed lui ferme, la réponse est `card_not_found` et non `forbidden` — règle de discrétion, éprouvée par le **même jeton** (docs/SPEC-workflow-engine.md §5.3) |
| 2 | `business_developer` tente de modifier un workflow | Refus — **acquise sur `workflow_nodes_catalog` par `CRM-030`** ; les trois autres tables de la famille restent dues par `CRM-031` |
| 3 | Membre du workspace A lit une card du workspace B | Aucune ligne — **acquise sur `tracks`, `channels`, `workflows` et le catalogue** par `CRM-020`, `CRM-021`, `CRM-030`, `CRM-031`, reconduite par `CRM-012` ; **acquise sur les cards par `CRM-014`**, `CRM-040` ne l'ayant pas livrée (INC-057) |
| 4 | Utilisateur avec `channel_members.access='none'` lit une card de ce channel | Aucune ligne — **acquise sur le channel lui-même et sur son track** par `CRM-012` (§4.2, lignes *d* et *e*), **sur les cards** par `CRM-040`, et **sur leurs valeurs de formulaire** par `CRM-036` (`docs/SPEC-form-composer.md` §6.10, ligne *f*) |
| 5 | Mise à jour directe de `cards.current_step_id` par PostgREST | Refus — **ACQUISE par `CRM-034`** : `403`, `42501`, « permission denied for table cards », mesuré avec le jeton de l'administratrice, la ligne étant relue et constatée inchangée. Le chevauchement de Definition of Done avec `CRM-013` est tranché de ce côté (INC-049), parce qu'une unité dont la DoD exige une preuve doit livrer ce qui la rend possible |
| 6 | Lecture de `secret_id` d'un compte mail par `authenticated` | Refus (colonne révoquée) — **ACQUISE par `CRM-052`** : `403`, `42501`, mesuré sur une ligne que l'appelant **lit par ailleurs**. La révocation est un privilège de COLONNE, insensible aux lignes, donc incontournable par un `select` bien choisi. `mail_outbound_identities` la suit depuis `CRM-053` : la preuve porte sur ses **deux** tables |
| 7 | Lecture du compte mail d'un autre utilisateur | Aucune ligne — **ACQUISE sur les comptes ENTRANTS par `CRM-052`** : avec le jeton réel d'un membre non administrateur, la boîte système et celle d'un collègue rendent **zéro ligne**, la contre-épreuve par la clé de service constatant que les trois lignes existent bien. Un membre **sans boîte** lit une liste vide, et ce n'est pas un refus. **ACQUISE ENTIÈREMENT depuis `CRM-053`** : l'identité sortante d'un collègue rend elle aussi zéro ligne, avec la même contre-épreuve par la clé de service |
| 8 | Insertion directe dans `card_events` ou `audit_log` | Refus — **À MOITIÉ ACQUISE** : `card_events` existe depuis `CRM-044`, et son refus est **mesuré** — `403`, `42501`, `service_role` compris. `audit_log` reste due par `CRM-072`, et son absence est figée (§7.3) |
| 9 | Téléchargement d'une pièce jointe `infected` ou `pending` | Refus — **ACQUISE par `CRM-054`**, puis **RÉVISÉE et rendue CONCLUANTE par `CRM-057`**. `CRM-054` mesurait le refus sur un bucket sans aucune politique, mais sur des objets **jamais déposés** : « rien ne se télécharge » y était vrai aussi d'un bucket vide. `CRM-057` dépose réellement quatre objets par la clé de service et mesure l'intersection : la pièce **`clean` se télécharge** — c'est le TÉMOIN, et son contenu est comparé —, tandis que `infected`, `pending` et `skipped` sont refusées **au même appelant**, que l'anonyme est refusé sur les quatre, et qu'un membre qui ne voit pas le message ne voit pas sa pièce. `storage.objects` ne porte qu'**une** politique, et l'assertion porte sur ce nombre autant que sur sa portée : une seconde, si étroite soit-elle, ouvrirait une autre part du stockage |
| 10 | Dernier administrateur tente de se retirer son rôle | Refus — **contrat rouvert par `CRM-022`** : le refus par défaut historique doit devenir `last_workspace_admin` (`23514`) après que la politique admin a réellement trouvé la ligne |
| 11 | Utilisateur anonyme lit n'importe quelle table métier | Aucune ligne — **acquise** ; les douze tables de `CRM-014`, puis `card_comments`, `card_events` et `workflow_transition_required_fields`, soit **quinze** tables réellement peuplées par le seed, énumérées et non échantillonnées |
| 12 | `queue_outbound_email` avec une identité qui ne lui appartient pas | Refus — **non satisfaisable par `CRM-014`** : la fonction n'existe pas (`CRM-058`). Absence figée (§7.3) |

Un refus ne se manifeste pas toujours par une erreur : pour une lecture, l'attendu est **zéro
ligne**. Les deux formes sont testées explicitement, car un test qui vérifie seulement l'absence
d'erreur ne prouve rien.

### 7.1 Pourquoi `CRM-014` duplique des scénarios déjà verts

À l'ouverture de `CRM-014`, sept des douze preuves sont déjà exercées quelque part : la n° 11 dans
six fichiers, la n° 2 dans trois, la n° 3 dans quatre, la n° 4 dans trois. Chacune y est un
**corollaire** du contrat d'API de son unité — elle prouve que *cette* table refuse *ce* profil.

Aucune ne répond à la question que pose la Definition of Done de `CRM-014` : *les douze preuves
sont-elles exercées, et lesquelles ne le sont pas ?* Cette question n'a pas de lieu où être posée
tant que les preuves sont réparties dans quatorze fichiers de scénarios. Un fichier consolidé la
rend mesurable, et surtout **rend l'absence visible** : une preuve non satisfaisable y occupe une
place nommée, avec l'unité qui la débloquera, au lieu de n'exister nulle part.

La duplication est donc **assumée et bornée** :

- les scénarios des unités précédentes ne sont **ni retirés ni déplacés** — les retirer rouvrirait
  sept unités dans un commit qui n'en traite qu'une, ce que `CLAUDE.md` §13 interdit ;
- le fichier consolidé n'invente aucune règle : il rejoue les douze scénarios **du tableau
  ci-dessus**, dans leur ordre, avec les jetons réels ;
- lorsqu'une preuve porte sur une table absente, le scénario existe quand même et **fige
  l'absence** (§7.3).

### 7.2 Contrat mesuré des douze scénarios

Mesuré le 2026-08-05 sur la pile de développement seedée, avec les jetons réels obtenus par
`POST /auth/v1/token?grant_type=password`. Ce tableau est le contrat que
`e2e/api/preuves-refus.spec.ts` rejoue ligne à ligne.

| # | Appelant | Requête | Attendu **mesuré** |
|---|---|---|---|
| 1 | `viewer` | `POST /rpc/move_card` sur une card **qu'il voit** (`…0c4`) | `403`, `42501`, `forbidden` ; étape courante relue **inchangée** |
| 1′ | `viewer` | `POST /rpc/move_card` sur une card d'un channel **qui lui est fermé** (`…0c1`) | `400`, `P0001`, `card_not_found` — règle de discrétion (`docs/SPEC-workflow-engine.md` §5.3) |
| 2 | `business_developer` | `POST` sur `workflows`, `workflow_steps`, `workflow_transitions`, `workflow_nodes_catalog` | `403`, `42501` ; le message est `new row violates row-level security policy for table "…"` sur les tables à politique `INSERT` restrictive |
| 2′ | `business_developer` | `PATCH` d'un workflow du seed | `200` et `[]` — refus **silencieux** par la clause `USING` ; la ligne est relue et constatée inchangée |
| 3 | `admin`, `business_developer`, `viewer` du workspace A | `GET /cards?id=eq.<card de B>` | `200` et `[]`, la card de B étant **d'abord constatée présente** avec la clé de service |
| 3′ | `admin` du workspace A | `PATCH` de cette card de B | `200` et `[]`, sans effet — relecture par la clé de service |
| 4 | `viewer`, fermé sur le track de `grands-comptes` | `GET /cards?channel_id=eq.…032` puis `GET /card_field_values` | `200` et `[]`, alors que la clé de service y voit des lignes |
| 5 | `admin` | `PATCH /cards` portant `current_step_id` | `403`, `42501`, `permission denied for table cards` ; ligne relue inchangée |
| 6 | clé de service | `GET /mail_inbound_accounts` | `404`, `PGRST205` — **la table n'existe pas** |
| 7 | clé de service | `GET /mail_outbound_identities` | `404`, `PGRST205` — **la table n'existe pas** |
| 8 | clé de service | `POST /card_events`, puis `GET /audit_log` | `403` et `42501` sur `card_events`, qui existe depuis `CRM-044` ; `404` et `PGRST205` sur `audit_log`, qui n'existe pas |
| 9 | — | inventaire de `storage.buckets` | **aucun bucket**, aucune table de pièces jointes |
| 10 | `admin` | `PATCH` puis `DELETE` de sa propre ligne `workspace_members` | `200` et `[]`, puis `204` ; le rôle relu par la clé de service vaut **toujours `admin`** |
| 11 | anonyme | `GET` sur les **quinze** tables métier peuplées | `200` et `[]` sur chacune |
| 12 | clé de service | `POST /rpc/queue_outbound_email` | `404`, `PGRST202` — **la fonction n'existe pas** |

Trois précautions gouvernent ce tableau, héritées des unités précédentes et rappelées ici parce
qu'elles sont la condition de validité de l'ensemble :

1. **La clé de service ne prouve jamais un refus.** Elle établit que les lignes existent, avant
   qu'on affirme que personne ne les voit (décision 50). Un « zéro ligne » sur une table vide est
   vrai que la RLS refuse ou qu'elle autorise tout.
2. **Un refus d'écriture par clause `USING` ne lève rien.** PostgREST rend `200` ou `204` et ne
   modifie rien. Toute ligne de refus d'écriture **relit** donc la ligne visée.
3. **Tout scénario qui écrit nettoie derrière lui**, y compris en cas d'échec, et par identifiant
   ou par préfixe — jamais par prédicat métier (décision 108).

### 7.3 Ce qui n'est pas satisfaisable, et comment l'absence est figée

**Révisé par `CRM-057`.** La preuve n° 9 est désormais **entièrement acquise et concluante** (voir
son entrée ci-dessus) : quatre objets réellement déposés, un témoin qui se télécharge, trois refus
sur des objets qui existent. Le paragraphe historique ci-dessous conserve l'état au jour du constat.

Cinq preuves — n° 6, 7, 8, 9 et 12 — ne sont pas encore **entièrement** satisfaisables. La n° 8
l'est pour `card_events`, dont l'insertion directe est réellement refusée depuis `CRM-044`, mais
reste ouverte pour `audit_log`. Les quatre autres objets et cette moitié d'audit n'existent pas à
cette place du plan ; aucune preuve de substitution ne le cachera.

Le scénario existe quand même, et **assère l'absence** : `404` / `PGRST205` pour une table,
`404` / `PGRST202` pour une fonction, inventaire vide pour `storage.buckets`. C'est la convention
déjà retenue par `CRM-006` pour les types et par `CRM-013` pour ses cinq cibles manquantes : le
jour où la table naît, l'assertion devient **rouge** et désigne la preuve à écrire, au lieu de
laisser une limite survivre à sa cause.

**Révisé par `CRM-022`.** La preuve n° 10 est désormais acquise dans sa règle. Seul un
administrateur peut modifier ou supprimer un membership ; une contrainte différable contrôle le
workspace affecté à la fin de la transaction et refuse `last_workspace_admin` (`23514`) s'il existe
encore sans administrateur. La rotation atomique reste possible, comme la cascade d'un workspace
supprimé ; supprimer l'unique membership admin ne contourne pas la garde en laissant zéro membre.

### 7.4 Non-complaisance du harnais

La Definition of Done de `CRM-014` exige que le harnais **échoue si une politique est retirée**.
`scripts/verify-preuves-refus.sh` l'éprouve en dégradant réellement le produit, puis en le
restaurant :

1. la politique `cards_lecture` est **réellement retirée** ; le harnais doit alors échouer ;
2. une politique **permissive** est réellement posée sur `cards` pour `anon` ; le scénario n° 11
   doit échouer, ce qui prouve que le fichier détecte une régression d'autorisation et non une base
   vide ;
3. la restauration est **constatée** : l'inventaire des politiques est relu et comparé à celui
   relevé avant dégradation, table par table et nom par nom.

Un harnais qui ne sait pas échouer ne prouve rien ; la vérification porte donc autant sur son
échec provoqué que sur son succès.

**Ce que la dégradation n° 1 a mesuré, et qui contredisait la prédiction (décision 151).** Cette
section annonçait d'abord que les scénarios n° 3, 4 et 11 échoueraient sans `cards_lecture`.
MESURÉ : **aucun n'échoue**, et le fichier reste vert sur ses trente-sept scénarios. Ce n'est pas
un défaut du fichier, mais une **propriété structurelle** de toute suite composée de preuves de
refus : retirer une politique de lecture fait refuser *davantage*, or chaque assertion attend soit
zéro ligne, soit une erreur — un produit devenu plus strict les satisfait toutes. La preuve n° 1
elle-même reste verte, `move_card` étant `SECURITY DEFINER` : elle n'interroge pas la politique,
elle appelle `app.can_write_channel`.

Conséquence retenue, et c'est la raison d'être de la suite pgTAP de l'unité : **la détection du
sur-refus repose sur l'inventaire des politiques**, non sur les scénarios HTTP. Le harnais échoue
donc bien lorsqu'une politique est retirée — par sa suite pgTAP —, et le fichier de scénarios,
lui, garde la détection du **sur-accès**, qui est la régression dont un utilisateur souffre. Les
deux moitiés sont nécessaires ; aucune ne remplace l'autre. La prédiction fausse est corrigée ici
plutôt que le contrôle relâché.

## 8. Points ouverts

1. **Suppression d'un membre** possédant des cards : réaffectation forcée, ou conservation avec
   un responsable inactif ? Comportement par défaut retenu : conservation, la card restant
   visible et réattribuable.
2. **Invitation d'un utilisateur externe** à un seul channel : couvert par `channel_members`,
   mais le parcours d'invitation correspondant reste à spécifier.
3. **Les politiques des tables d'identité sont livrées par `CRM-022`.** Deux sur `profiles`, une
   sur `workspaces`, quatre sur `workspace_members`, ACL de profil limitées à `full_name` et
   `avatar_url`, et garde différable du dernier administrateur. INC-014 et la preuve n° 10 sont
   closes ; `CRM-070` porte encore le parcours d'invitation et l'écran de gestion.
4. **`app.can_read_card` est livrée par `CRM-040`**, et **INC-013 est close**. Les quatre fonctions
   existent. Voir §3.6 pour la raison — mesurée — qui l'empêche d'être employée par les politiques
   de `cards` elles-mêmes.
