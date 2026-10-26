# Spécification — journal d'audit consultable et conformité RGPD

Contrat exécutable de `CRM-072` (`docs/BACKLOG.md`).

- Unité de backlog : `CRM-072` — journal d'audit consultable et conformité RGPD.
- Arbitrages : `docs/JOURNAL.md` décision 708, point 5 (périmètre produit, tous en option A) ; décision 707 (connecteur
  MCP : non) ; décision 658 (noms anglais pour ce qui est stocké ou exposé).
- Journaux existants : `docs/SPEC-plateforme.md` §5.2 (`plateforme_journal`), `docs/SPEC-mcp.md` §7.1 (`mcp_journal`).
- Sessions : `docs/SPEC-session-sso.md` (`sessions_sso`, migrations `0076`, `0079`, `0089`).
- Contacts : `docs/SPEC-contacts.md`. Corbeille : `docs/SPEC-corbeille.md`.
- Droits : `docs/SPEC-permissions-rls.md` §4 (ligne `audit_log`), preuve de refus n° 8.
- Schéma : `docs/SCHEMA.md` §8 (ligne `audit_log`). Déploiement : `docs/PROD_MIGRATIONS.md`.
- État : **proposée le 2026-10-26 (décision 725), en attente de validation.** Aucune ligne de code avant la validation.

---

## 1. Ce que cette unité est, et ce qu'elle n'est pas

La décision 708 fixe le produit :

- le journal enregistre les **gestes sensibles** : droits et appartenances, configuration (workflows, champs, réglages),
  connexions, exports, effacements et corbeille ;
- il est consulté par les **administrateurs de l'espace**, et par le **superadministrateur pour la plateforme** ;
- il est conservé **1 an**, puis effacé automatiquement, et cet effacement est lui-même journalisé ;
- le volet RGPD d'un **contact** offre un **export JSON** de ses données et un **effacement par anonymisation** ;
- le journal est **en ajout seul** : nul ne le modifie ni ne le supprime, administrateur compris, et la règle est tenue
  en base.

**Connecteur MCP : non** (décision 707). Aucun outil ne lit le journal, n'exporte ni n'anonymise un contact. Un geste fait
par le connecteur au nom d'une personne passe par les mêmes tables, donc il est journalisé comme celui fait à l'écran,
avec cette personne pour acteur.

Cette unité **ne livre pas** :

- la journalisation des gestes ordinaires de la vie d'une affaire (déplacement, champ, commentaire), que la timeline
  (`card_events`) porte déjà ;
- un journal des lectures (qui a consulté quoi) ;
- un export de masse, ni un export d'un membre de l'équipe : le volet RGPD porte sur les **contacts**, les personnes
  extérieures dont le CRM garde les données ;
- la déconnexion comme geste journalisé (§4.4) ;
- un nouvel écran pour le superadministrateur : `/plateforme/journal` existe déjà et reçoit seulement la rétention.

## 2. Ce qui existe déjà, mesuré sur la pile de développement le 2026-10-26

1. **Aucune table `audit_log`.** `docs/SCHEMA.md` §8 la prévoit en une ligne. `docs/SPEC-permissions-rls.md` §4 la
   ferme à toute écriture cliente, et sa preuve de refus n° 8 reste « à moitié acquise » faute de table.
2. **`plateforme_journal`** (migration `0089`) journalise les gestes de la plateforme : superadministrateurs, espaces,
   appartenances posées par la plateforme, attentes et droits du connecteur. Il est lu par
   `plateforme_journal_liste()`. Il est dit « ajout seul », mais **aucun déclencheur ne le garantit** : seuls les
   privilèges retirés le ferment. Rien ne le purge ; sa rétention est confiée à `CRM-072` (`docs/SPEC-plateforme.md` §5.2).
3. **`mcp_journal`** compte les appels d'outils du connecteur. Lui non plus n'a ni déclencheur ni purge.
4. **`card_events`** est en ajout seul, tenu par le déclencheur `card_events_refuser_maj`, qui refuse toute
   modification et toute suppression, même à la clé de service (INC-185, décision 513). C'est le modèle repris ici.
5. **`sessions_sso`** reçoit une ligne à chaque connexion admise (`ouvrir_session_serveur`). Les connexions refusées
   sont comptées par `admission_refus`, purgé à 90 jours par la tâche `p2enjoy-purge-refus-admission`.
6. **Aucun export** n'existe dans le produit. L'export RGPD de cette unité est le premier.
7. **`contacts`** n'a ni corbeille ni marque d'anonymisation. Deux tables le référencent : `card_contacts` et
   `card_activity_participants`. Les messages ne le référencent pas : ils portent ses adresses en texte
   (`from_address`, `to_addresses`, `cc_addresses`, `bcc_addresses`).

## 3. Le modèle — table `public.audit_log`

### 3.1 Colonnes

| Colonne | Type | Règle |
|---|---|---|
| `id` | `bigint` | PK, identité (`generated always`) |
| `workspace_id` | `uuid` | non nul, **sans clé étrangère** : l'entrée survit à la suppression de l'espace (§6.3) |
| `actor_id` | `uuid` | FK `profiles` `ON DELETE SET NULL` ; `null` pour un geste du système (seed, tâche planifiée, clé de service) |
| `family` | `text` | non nul, `check` fermé : `access`, `configuration`, `sign_in`, `export`, `deletion`, `retention` |
| `action` | `text` | non nul, `check` fermé (§4) |
| `entity_type` | `text` | non nul, `check` fermé (§4) |
| `entity_id` | `uuid` | identifiant de l'objet visé ; `null` pour une purge |
| `entity_label` | `text` | libellé de l'objet **au moment du geste** (nom du track, du workflow…) ; **toujours `null` pour un contact** (§7.3) |
| `details` | `jsonb` | non nul, `'{}'` par défaut : ce qui a changé (§5) ; jamais de contenu, de secret ni de jeton |
| `occurred_at` | `timestamptz` | non nul, `now()` |

Index : `(workspace_id, id desc)` pour la lecture paginée, `(occurred_at)` pour la purge.

### 3.2 Qui lit

- RLS activée. Une seule politique, `audit_log_select_admin` : `for select to authenticated using
  (app.is_workspace_admin(workspace_id))`.
- Un membre non administrateur, un anonyme, un superadministrateur qui n'est pas membre de l'espace lisent **zéro
  ligne**. Le superadministrateur lit la plateforme par `/plateforme/journal`, qui reste son écran (décision 708).

### 3.3 Qui écrit — personne, sauf la base

- `SELECT` seul est accordé à `authenticated`. `INSERT`, `UPDATE`, `DELETE` et `TRUNCATE` sont retirés **nommément** à
  `anon`, `authenticated` et `service_role` (`docs/SCHEMA.md` §9 : un `revoke … from public` ne suffit pas).
- L'unique écrivain est **`app.audit_record(p_workspace uuid, p_action text, p_entity_type text, p_entity_id uuid,
  p_entity_label text, p_details jsonb)`** : `SECURITY DEFINER`, `search_path` vide, `EXECUTE` révoqué à tous les
  rôles applicatifs. Elle déduit `family` de `action` (§4), prend `auth.uid()` pour acteur, sauf indication contraire
  pour la connexion (§4.4). Elle **n'écrit rien si l'espace n'existe plus**, pour qu'une suppression d'espace en cascade
  ne produise pas des milliers d'entrées orphelines (§6.3).
- Elle est appelée par des **déclencheurs** posés sur les tables sensibles (§4) et par les deux fonctions RGPD (§7).

### 3.4 Ajout seul, tenu en base

Le déclencheur `audit_log_refuse_change`, `BEFORE UPDATE OR DELETE`, et `audit_log_refuse_truncate`, `BEFORE
TRUNCATE`, refusent par `P0001 audit_log_immutable`, **clé de service et propriétaire compris**, avec deux exceptions,
et deux seulement :

1. **La mise à `null` de l'acteur** quand son profil est supprimé (l'action `ON DELETE SET NULL` de la clé étrangère) :
   une mise à jour dont la **seule** différence est `actor_id` passé à `null` est admise. Sans elle, un profil ne
   pourrait plus être supprimé.
2. **La purge** (§6) : une suppression est admise si, et seulement si, la variable de transaction
   `app.audit_purge` vaut `on` **et** `occurred_at < now() - interval '1 year'`. Même en posant la variable, on ne peut
   effacer qu'une entrée de plus d'un an.

Le même déclencheur, avec les mêmes deux exceptions, est posé sur **`plateforme_journal`** (acteur : `acteur`, date :
`cree_le`) et sur **`mcp_journal`** (date : `cree_le`, pas d'acteur nullable). Les trois journaux obéissent ainsi à la
même règle.

## 4. Les gestes journalisés

Chaque geste est une paire `entity_type` / `action`. La famille se déduit de l'action et de l'objet. L'acteur est
toujours `auth.uid()` au moment du geste, sauf pour la connexion.

### 4.1 Droits et appartenances — famille `access`

| Table et événement | `entity_type` | `action` | `details` |
|---|---|---|---|
| `workspace_members` insertion | `member` | `added` | `{user_id, role}` |
| `workspace_members` mise à jour de `role` | `member` | `role_changed` | `{user_id, before, after}` |
| `workspace_members` suppression | `member` | `removed` | `{user_id, role}` |
| `workspace_invitations` insertion ou remplacement | `invitation` | `created` | `{email, role}` |
| `workspace_invitations` suppression | `invitation` | `removed` | `{email, role}` |
| `track_members` insertion ou mise à jour de `access` | `track_access` | `granted` | `{user_id, track_id, before, after}` |
| `track_members` suppression | `track_access` | `revoked` | `{user_id, track_id, access}` |
| `channel_members` insertion ou mise à jour de `access` | `channel_access` | `granted` | `{user_id, channel_id, before, after}` |
| `channel_members` suppression | `channel_access` | `revoked` | `{user_id, channel_id, access}` |

`entity_label` porte le nom de la personne (profil) ou l'adresse de l'invitation. Une invitation porte une adresse de
collaborateur, pas celle d'un contact : elle n'est pas soumise au §7.3.

### 4.2 Configuration — famille `configuration`

| Table | `entity_type` | `action` |
|---|---|---|
| `workspaces` mise à jour de `name`, `inbound_domain` ou `settings` | `workspace` | `updated` |
| `tracks` insertion, mise à jour de `name` ou `slug` | `track` | `created`, `updated` |
| `channels` insertion, mise à jour de `name`, `slug` ou `workflow_id` | `channel` | `created`, `updated` |
| `workflows` insertion, mise à jour de `name` ou `archived_at`, suppression | `workflow` | `created`, `updated`, `archived`, `deleted` |
| `workflow_versions` insertion | `workflow` | `published` |
| `workflow_steps` insertion, mise à jour, suppression | `workflow_step` | `created`, `updated`, `deleted` |
| `workflow_transitions` et `workflow_transition_required_fields` | `workflow_transition` | `created`, `updated`, `deleted` |
| `workflow_nodes_catalog` insertion, mise à jour, suppression | `workflow_node` | `created`, `updated`, `deleted` |
| `form_fields` insertion, mise à jour, archivage, suppression | `form_field` | `created`, `updated`, `archived`, `deleted` |
| `form_field_rules` insertion, mise à jour, suppression | `form_field_rule` | `created`, `updated`, `deleted` |
| `mail_inbound_accounts`, `mail_outbound_identities` insertion, mise à jour, suppression | `mail_account`, `mail_identity` | `created`, `updated`, `deleted` |

Une mise à jour ne journalise que si une colonne **de configuration** change : `position` seule (un glisser-déposer)
ou `updated_at` seule n'écrivent rien. Les modèles d'emails et les séquences de relance ne sont pas de la
configuration sensible au sens de la décision 708 : ils ne sont pas journalisés.

### 4.3 Effacements et corbeille — famille `deletion`

| Table | `entity_type` | `action` |
|---|---|---|
| `cards`, `tracks`, `channels` : `deleted_at` posé, retiré | `card`, `track`, `channel` | `trashed`, `restored` |
| `cards`, `tracks`, `channels` : suppression définitive | `card`, `track`, `channel` | `destroyed` |
| `card_comments`, `card_activities` : `deleted_at` posé (modération ou retrait par l'auteur) | `comment`, `activity` | `deleted` |
| `contacts`, `organizations` : suppression | `contact`, `organization` | `deleted` |
| `contacts` : anonymisation (§7.2) | `contact` | `anonymized` |

Une destruction en cascade écrit **une entrée par objet détruit** : détruire un channel qui porte cinq affaires écrit
six entrées. Le journal dit ce qui a disparu, sans rien résumer.

### 4.4 Connexions — famille `sign_in`

| Événement | `entity_type` | `action` | Acteur |
|---|---|---|---|
| `sessions_sso` insertion (connexion admise) | `session` | `signed_in` | la personne connectée (`sub`) |

La connexion n'appartient à aucun espace : elle est inscrite **dans chaque espace dont la personne est membre** au
moment de la connexion. Le renouvellement d'une session n'écrit rien. La déconnexion n'est pas journalisée : la base ne
distingue pas une déconnexion d'une session expirée et purgée (limite au §11). Les connexions refusées restent
comptées par `admission_refus` (CRM-092).

### 4.5 Exports — famille `export`

| Événement | `entity_type` | `action` |
|---|---|---|
| `export_contact` (§7.1) | `contact` | `exported` |

### 4.6 Rétention — famille `retention`

| Événement | `entity_type` | `action` | `details` |
|---|---|---|---|
| la purge quotidienne efface des entrées de l'espace (§6) | `audit_log` | `purged` | `{count, before}` |

## 5. Ce que `details` contient, et ce qu'il ne contient jamais

- **Toujours** : les identifiants et les valeurs **de droit ou de structure** qui ont changé, en `before` / `after`
  quand c'est une valeur courte (rôle, accès, nom, slug). Pour une mise à jour large, la liste triée des colonnes
  changées, `changed: ["name", "settings"]`. Pour `workspaces.settings`, **les clés** changées, jamais leurs valeurs.
- **Jamais** : un corps de message, un contenu de commentaire ou d'activité, un mot de passe, un secret, un jeton, une
  empreinte, une valeur de champ de formulaire, et rien d'un contact au-delà de son identifiant (§7.3).

## 6. La rétention — un an, puis effacé, et l'effacement journalisé

### 6.1 La tâche

`app.purge_audit_logs()`, `SECURITY DEFINER`, `search_path` vide, appelée chaque jour par la tâche pg_cron
**`p2enjoy-purge-journaux`** (`17 3 * * *`, entre les tâches existantes). Dans une seule transaction :

1. elle pose `app.audit_purge = on` pour la transaction ;
2. elle efface de `audit_log` les entrées de plus d'un an, **espace par espace**, et pour chaque espace où elle a effacé
   au moins une entrée, elle écrit `audit_log` / `purged` avec `{count, before}` ;
3. elle efface de `plateforme_journal` et de `mcp_journal` les entrées de plus d'un an, et si elle en a effacé, elle
   écrit dans `plateforme_journal` le geste **`logs_purged`**, avec `cible = {platform: n, connector: m, before}` ;
4. elle rend le nombre total d'entrées effacées.

Une purge qui n'efface rien n'écrit rien : pas d'entrée quotidienne vide. L'entrée `purged` vieillit comme les autres,
et sera elle-même effacée un an plus tard.

### 6.2 Le geste nouveau de la plateforme

La liste fermée de `plateforme_journal.geste` reçoit `logs_purged`. Elle est en français pour les gestes existants ;
la valeur nouvelle suit la décision 658, et l'existant reste recensé par INC-286.

### 6.3 La suppression d'un espace

Les entrées d'un espace supprimé restent dans `audit_log` (pas de clé étrangère), illisibles par quiconque puisque
plus personne n'en est administrateur, et la purge les efface au bout d'un an. La suppression de l'espace elle-même est
journalisée par la plateforme (`espace_supprime`). Les déclencheurs n'écrivent rien pendant la cascade (§3.3).

## 7. Le volet RGPD d'un contact

Les deux gestes sont réservés aux **administrateurs de l'espace** : ils touchent toutes les données d'une personne,
au-delà de ce qu'un business developer administre au quotidien. Les deux fonctions sont `SECURITY DEFINER`, avec une
garde écrite qui lève `42501 reserved_to_admins` si l'appelant n'administre pas l'espace du contact, et `P0002
contact_not_found` si le contact n'existe pas ou n'est pas visible.

### 7.1 L'export — `public.export_contact(p_contact uuid) returns jsonb`

Il rend un objet versionné :

```json
{
  "format": "p2enjoy-crm/contact-export/1",
  "exported_at": "…",
  "workspace": {"id": "…", "name": "…"},
  "contact": {"id", "full_name", "email", "phone", "role_title", "source", "created_at", "updated_at", "anonymized_at"},
  "organization": {"id", "name"} | null,
  "cards": [{"id", "title", "role", "linked_at"}],
  "activities": [{"id", "card_id", "type", "occurred_at", "subject", "body"}],
  "messages": [{"id", "card_id", "direction", "sent_at", "received_at", "from_address", "subject", "body_text"}],
  "field_values": [{"card_id", "field_label"}]
}
```

- `activities` : celles dont le contact est **participant** (`card_activity_participants`), non retirées.
- `messages` : ceux où l'**adresse du contact** paraît en expéditeur ou en destinataire (`from`, `to`, `cc`, `bcc`),
  comparaison sans casse. Un contact sans adresse n'a aucun message.
- `field_values` : les valeurs de formulaire qui **désignent** le contact (champ de type contact), avec le libellé du
  champ et l'affaire.
- L'export est journalisé (`contact` / `exported`, `entity_label` nul). Le fichier n'est **jamais stocké** : la fonction
  rend l'objet, l'interface le propose au téléchargement sous `contact-<id court>-<AAAA-MM-JJ>.json`.

### 7.2 L'anonymisation — `public.anonymize_contact(p_contact uuid, p_confirmation text) returns void`

- **Confirmation** : `p_confirmation` doit être égal au `full_name` actuel du contact (même modèle que la suppression
  d'un espace, où l'on retape le slug). Sinon : `22023 confirmation_mismatch`.
- **Effets sur le contact**, dans une seule transaction : `full_name` devient `Contact anonymisé`, `email`, `phone` et
  `role_title` deviennent `null`, et la colonne nouvelle **`anonymized_at`** est posée. L'organisation (une entreprise,
  pas une personne), la source et les rattachements aux affaires restent : les statistiques et l'historique des
  affaires ne perdent rien, mais ne désignent plus personne.
- **Effets sur les messages** : *à arbitrer par le responsable, voir §12, question R1.*
- **Après** : un contact anonymisé ne se modifie plus. Le déclencheur `contacts_refuse_after_anonymization` refuse
  toute mise à jour (`P0001 contact_anonymized`), pour qu'aucune saisie ne le ré-identifie par mégarde. Il reste
  supprimable. Une seconde anonymisation est refusée (`P0001 contact_anonymized`).
- Le geste est journalisé (`contact` / `anonymized`, `entity_label` nul).

### 7.3 Le journal ne garde pas le nom d'un contact

`entity_label` est **toujours `null`** pour un contact, et `details` ne porte que son identifiant. Sans cela, le
journal, qu'on ne peut ni modifier ni purger avant un an, conserverait le nom qu'on vient d'anonymiser. À l'écran, le
nom d'un contact est lu **à l'affichage**, depuis `contacts` : un contact anonymisé paraît « Contact anonymisé », un
contact supprimé « contact supprimé ».

## 8. L'écran « Journal d'audit » — `/reglages/journal`

- **Une section de réglages** de plus, après « Membres » ; l'entrée n'est affichée qu'aux administrateurs (aide
  d'interface), la règle réelle étant la RLS du §3.2. Un non-administrateur qui saisit l'adresse voit l'état de refus
  des réglages.
- **Liste** chronologique, la plus récente en tête : date et heure, acteur (« Système » quand l'acteur est nul,
  « personne supprimée » quand le profil l'est), une **phrase** qui dit le geste (« a retiré Jeanne Martin de l'espace »,
  « a publié la version 4 du workflow Conseil »), et un détail repliable des `before` / `after`.
- **Filtres** : famille (les six, en toutes lettres), acteur (les membres de l'espace), période (du… au…). Les filtres
  sont dans l'adresse, comme ceux du pilotage.
- **Pagination** par curseur (`id < dernier vu`), 50 entrées, bouton « Afficher plus ».
- **États** : chargement, erreur (le message fermé, jamais le corps du serveur), vide (« Aucun geste sur cette
  période. »), refus.
- Les phrases sont centralisées dans `fr.ts`, une clé par paire `entity_type` / `action`.
- `docs/DESIGN_SYSTEM.md` reçoit la section du journal (et les deux gestes RGPD du §9) **avant le code de l'écran**, après
  sa lecture intégrale.

## 9. Les gestes RGPD sur la fiche du contact

- Deux boutons dans une zone « Données personnelles (RGPD) » de la fiche, **visibles aux seuls administrateurs** :
  « Exporter les données » et « Anonymiser ce contact ».
- **Exporter** télécharge le fichier JSON (§7.1) ; une erreur est dite, le refus aussi.
- **Anonymiser** ouvre une modale de confirmation qui dit l'effet (« Le nom, l'email, le téléphone et la fonction seront
  effacés. Les affaires gardent ce contact, anonyme. Ce geste est définitif. »), demande de retaper le nom, et ne
  s'active qu'à l'égalité. Après le geste, la fiche affiche « Contact anonymisé le … » et ses champs sont en lecture
  seule.
- Le manuel (chapitre des contacts) décrit les deux gestes, et le chapitre des réglages décrit le journal.

## 10. Seed

Le seed est un contrat (`CLAUDE.md` §8) et ne fabrique aucune entrée : `audit_log` se remplit **parce que** le seed
joue les vrais gestes après la migration — appartenances, workflows publiés, corbeille, connexions SSO des comptes de
démonstration. Il ajoute :

- un contact dédié, « Régis Anonyme » (identifiant stable), **exporté** puis **anonymisé** par les vraies fonctions avec
  le jeton de l'administratrice ;
- une vérification finale : chacune des familles `access`, `configuration`, `sign_in`, `export` et `deletion` a au moins
  une entrée dans l'espace de démonstration, sinon le seed échoue. La famille `retention` ne peut pas être démontrée par
  le seed : elle exige des entrées d'un an, que rien ne doit fabriquer. Sa preuve est pgTAP (§11).

`docs/SPEC-seed.md` reçoit la section correspondante.

## 11. Preuves

| Niveau | Contenu |
|---|---|
| pgTAP | forme de la table et des listes fermées ; privilèges mesurés dans le catalogue ; `UPDATE`, `DELETE`, `TRUNCATE` refusés aux trois rôles **et au propriétaire** ; l'acteur passé à `null` admis seul ; la purge qui n'efface que plus d'un an, journalise `purged` et `logs_purged`, et n'écrit rien quand il n'y a rien ; chaque déclencheur du §4 écrit son entrée, et une mise à jour de `position` seule n'écrit rien ; rien n'est écrit pour un espace en cours de suppression ; la RLS : admin lit, business developer et lectrice ne lisent rien ; l'export et l'anonymisation : contenu, gardes, confirmation, effets, journal sans nom |
| API | avec les vrais jetons : l'administratrice lit le journal, le business developer et la lectrice lisent `[]` (témoin d'abord) ; l'insertion, la modification et la suppression refusées, clé de service comprise ; `export_contact` et `anonymize_contact` refusés au business developer et à l'anonyme ; un geste fait par l'API paraît au journal avec son acteur |
| Unitaires | la phrase de chaque paire `entity_type` / `action` ; la lecture des filtres depuis l'adresse ; le nom du fichier d'export ; l'état des boutons RGPD |
| E2E | le journal aux quatre paliers, ses filtres et sa pagination ; un geste fait à l'écran (retirer un accès) qui paraît dans le journal ; l'export téléchargé et relu ; l'anonymisation de bout en bout ; le refus pour un non-administrateur ; captures observées |

## 12. Questions au responsable

- **R1 — les messages d'un contact anonymisé.**
  - *Option A* : les messages restent intacts. Ils sont la correspondance de l'entreprise, et l'adresse du contact y
    reste lisible. La limite est écrite.
  - *Option B, recommandée* : l'adresse du contact est remplacée par `anonymized@invalid` dans `from_address`,
    `to_addresses`, `cc_addresses` et `bcc_addresses`, et `from_name` est vidé quand il était le sien. **Les corps restent** :
    une signature peut encore y nommer la personne, et la limite est écrite.
  - *Option C* : comme B, et les corps de ces messages sont aussi effacés. C'est l'effacement le plus complet, mais le
    fil des affaires perd ces échanges.

## 13. Limites connues

- La déconnexion n'est pas journalisée (§4.4).
- Une entrée qui nomme un collaborateur (acteur, membre retiré) garde son nom un an : c'est un journal de sécurité, et
  l'intérêt légitime de l'entreprise le justifie. Seuls les contacts en sont exclus (§7.3).
- Selon R1, le corps des messages peut encore nommer un contact anonymisé.
- Le journal n'est pas exportable : on le consulte à l'écran.

## 14. Production

- **Une migration**, au numéro pris après synchronisation : `CRM-111` T2.3.3 réserve la `0114`. Elle crée `audit_log`,
  l'écrivain, les déclencheurs, l'immutabilité des trois journaux, la purge et sa tâche pg_cron, la colonne
  `contacts.anonymized_at` et les deux fonctions RGPD.
- `docs/PROD_MIGRATIONS.md` reçoit sa ligne. Elle part avec la webapp de `main`. Aucune variable d'environnement.
- Retour arrière : supprimer la tâche pg_cron, les déclencheurs et les fonctions, puis la table. La colonne
  `anonymized_at` reste : une anonymisation ne se défait pas.

## 15. Découpage en tranches

| Tranche | Contenu |
|---|---|
| **T1 — le journal en base** | `audit_log`, l'écrivain, l'immutabilité des trois journaux, les déclencheurs des §4.1 à §4.4, la purge et sa tâche, seed (familles hors export), pgTAP, API, compteurs |
| **T2 — l'écran** | `docs/DESIGN_SYSTEM.md` d'abord, puis `/reglages/journal`, phrases, filtres, pagination, unitaires, E2E, captures, manuel |
| **T3 — le volet RGPD** | `anonymized_at`, `export_contact`, `anonymize_contact` (avec la réponse à R1), le déclencheur de lecture seule, les deux gestes de la fiche, seed (« Régis Anonyme »), pgTAP, API, E2E, captures, manuel |
