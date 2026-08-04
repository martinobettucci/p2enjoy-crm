# Modèle de données — P2Enjoy CRM

Référence du schéma PostgreSQL. Toute migration cite ce document et l'unité de backlog
correspondante dans son commentaire `@spec`. Toute évolution du modèle met ce fichier à jour
**dans le même changement** que la migration.

Documents liés : `docs/DAT.md`, `docs/SPEC-permissions-rls.md`, `docs/SPEC-workflow-engine.md`,
`docs/SPEC-form-composer.md`, `docs/SPEC-mail-subsystem.md`.

## Conventions générales

- Clés primaires `uuid` avec `gen_random_uuid()` (extension `pgcrypto`).
- Horodatages `timestamptz`, toujours en UTC. `created_at` par défaut `now()`.
- Suppression douce par `archived_at` (masqué, réversible) ou `deleted_at` (corbeille).
  La suppression physique est réservée aux purges RGPD.
- Toute table métier porte `workspace_id`, y compris lorsqu'il serait déductible par jointure :
  les politiques RLS restent ainsi simples et indexables.
- Les énumérations sont des types PostgreSQL lorsqu'elles sont stables, des colonnes `text` avec
  contrainte `CHECK` lorsqu'elles sont susceptibles d'évoluer par migration.
- Les noms de colonnes sont en anglais, les libellés destinés aux utilisateurs sont des données.
- **Les migrations sont idempotentes.** Le conteneur `migrations-runner` rejoue tout le répertoire
  à chaque démarrage de la pile et ne tient aucun registre : une migration doit pouvoir être
  appliquée plusieurs fois sans erreur ni effet de bord (`docs/DAT.md` §3.2, `docs/JOURNAL.md`
  décision 20).
- **RLS est activée dans la migration qui crée la table**, sans attendre ses politiques. Une table
  livrée avant ses politiques ne retourne donc aucune ligne et refuse toute écriture, plutôt que
  d'être ouverte à quiconque détient la clé anonyme, qui est publique par construction.

---

## 1. Identité et cloisonnement

### `profiles`
Prolonge `auth.users`. Créée par trigger à l'inscription.

| Colonne | Type | Contraintes |
|---|---|---|
| `id` | `uuid` | PK, FK `auth.users(id)` `ON DELETE CASCADE` |
| `full_name` | `text` | non nul |
| `avatar_url` | `text` | |
| `locale` | `text` | défaut `'fr'` |
| `created_at`, `updated_at` | `timestamptz` | |

### `workspaces`
Cloisonnement de premier niveau.

| Colonne | Type | Contraintes |
|---|---|---|
| `id` | `uuid` | PK |
| `name` | `text` | non nul |
| `slug` | `text` | unique, non nul |
| `inbound_domain` | `text` | domaine des adresses de card, ex. `crm.p2enjoy.studio` |
| `settings` | `jsonb` | défaut `'{}'` |
| `created_at`, `updated_at` | `timestamptz` | |

### `workspace_members`

| Colonne | Type | Contraintes |
|---|---|---|
| `workspace_id` | `uuid` | PK composite, FK `workspaces` |
| `user_id` | `uuid` | PK composite, FK `profiles` |
| `role` | `text` | `CHECK (role IN ('admin','business_developer','viewer'))` |
| `created_at` | `timestamptz` | |

### `track_members`, `channel_members`
Droits fins facultatifs. **Absence de ligne = accès hérité du rôle de workspace.** Une ligne
restreint ou étend explicitement l'accès à un sous-arbre (voir `docs/SPEC-permissions-rls.md`).

| Colonne | Type | Contraintes |
|---|---|---|
| `track_id` / `channel_id` | `uuid` | PK composite |
| `user_id` | `uuid` | PK composite, FK `profiles` `ON DELETE CASCADE` |
| `access` | `text` | `CHECK (access IN ('member','viewer','none'))` |
| `created_at` | `timestamptz` | date d'octroi du droit fin |

**Deux écarts assumés, consignés et non résolus implicitement :**

- `track_id` et `channel_id` ne portent **aucune clé étrangère** dans la migration d'amorçage
  `CRM-003` : les tables `tracks` et `channels` sont livrées par `CRM-020` et `CRM-021`, après
  elle. Voir `docs/INCONSISTENCY_REPORT.md`, INC-010.
- Ces deux tables ne portent **pas** `workspace_id`, alors que les conventions générales de ce
  document l'exigent de toute table métier. Voir `docs/INCONSISTENCY_REPORT.md`, INC-011.

---

## 2. Organisation

### `tracks`

Livrée par `CRM-020`. Spécification complète : `docs/SPEC-tracks.md`.

| Colonne | Type | Contraintes |
|---|---|---|
| `id` | `uuid` | PK, défaut `gen_random_uuid()` |
| `workspace_id` | `uuid` | FK `workspaces`, non nul, `ON DELETE CASCADE` |
| `name` | `text` | non nul, `CHECK (btrim(name) <> '')` |
| `slug` | `text` | non nul, `CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$')`, unique par workspace |
| `description` | `text` | |
| `color` | `text` | non nul, défaut `'neutral'`, `CHECK (color IN ('brand','success','accent','danger','neutral'))` — jeton du design system, pas un hexadécimal libre |
| `icon` | `text` | non nul, défaut `'folder'`, `CHECK (icon ~ '^[a-z][a-z0-9-]*$')` — nom d'icône lucide ; la **forme** est contrainte, l'existence est traitée par l'interface |
| `position` | `numeric` | non nul, ordre dans la barre latérale ; attribuée par trigger si omise |
| `archived_at` | `timestamptz` | non nul = archivé : masqué, réversible |
| `created_at`, `updated_at` | `timestamptz` | non nuls, défaut `now()` ; `updated_at` maintenue par `app.set_updated_at()` |

`created_at` et `updated_at` étaient absentes de ce tableau alors que les « Conventions
générales » les exigent de toute table : lacune consignée en `docs/INCONSISTENCY_REPORT.md`,
INC-025, et corrigée ici. Le tableau de `channels` ci-dessous n'est **pas** corrigé — il relève de
`CRM-021`, qui livrera la table.

**La clé étrangère `track_members.track_id → tracks.id` est posée par cette migration** : c'est la
moitié d'INC-010 que `CRM-020` referme. `channel_members.channel_id` attend `CRM-021`.

**Politiques RLS** (`docs/SPEC-permissions-rls.md` §4) : lecture par `app.is_workspace_member`,
insertion et mise à jour par `app.is_workspace_admin`, **aucune suppression** — ni politique, ni
privilège. `app.can_read_track` reste différée (INC-013), la lecture n'applique donc **aucun droit
fin** : INC-024.

### `channels`

| Colonne | Type | Contraintes |
|---|---|---|
| `id` | `uuid` | PK |
| `workspace_id` | `uuid` | FK, non nul (dénormalisé) |
| `track_id` | `uuid` | FK, non nul |
| `name` | `text` | non nul |
| `slug` | `text` | unique par track |
| `description` | `text` | |
| `workflow_id` | `uuid` | FK `workflows`, non nul |
| `position` | `numeric` | ordre des onglets |
| `archived_at` | `timestamptz` | |

**Contrainte non exprimable en clé étrangère** — un trigger garantit que `workflow_id` désigne
soit un workflow de portée `global` du même workspace, soit un workflow de portée `track`
rattaché à `track_id`. C'est la traduction de « les channels choisissent parmi les workflows
disponibles dans leur track ».

---

## 3. Workflows

Spécification complète : `docs/SPEC-workflow-engine.md`.

### `workflow_nodes_catalog`
Catalogue partagé des étapes. C'est lui qui rend l'analytique comparable d'un channel à l'autre.

| Colonne | Type | Contraintes |
|---|---|---|
| `id` | `uuid` | PK |
| `workspace_id` | `uuid` | FK, non nul |
| `key` | `text` | unique par workspace, ex. `prospection` |
| `label` | `text` | non nul |
| `kind` | `text` | `CHECK (kind IN ('open','won','lost'))` |
| `color` | `text` | jeton du design system |
| `default_probability` | `numeric(5,2)` | `CHECK (0 <= x <= 100)` |
| `default_stale_after_days` | `integer` | seuil de relance par défaut |
| `position` | `numeric` | ordre d'affichage du catalogue |
| `archived_at` | `timestamptz` | un nœud utilisé n'est jamais supprimé, seulement archivé |

Catalogue initial livré par le seed : `prospection`, `relance`, `negociation`, `signature`,
`realisation`, `livre` (`kind = 'won'`), `perdu` (`kind = 'lost'`).

### `workflows`

| Colonne | Type | Contraintes |
|---|---|---|
| `id` | `uuid` | PK |
| `workspace_id` | `uuid` | FK, non nul |
| `name` | `text` | non nul |
| `scope` | `text` | `CHECK (scope IN ('global','track'))` |
| `track_id` | `uuid` | FK, nul si `scope='global'`, non nul si `scope='track'` |
| `derived_from_workflow_id` | `uuid` | FK `workflows`, origine de la copie |
| `derived_at` | `timestamptz` | date de la copie, permet de signaler une divergence |
| `is_default` | `boolean` | un seul défaut par workspace |
| `archived_at` | `timestamptz` | |

Contrainte : `CHECK ((scope='global' AND track_id IS NULL) OR (scope='track' AND track_id IS NOT NULL))`.

### `workflow_steps`
Instanciation d'un nœud du catalogue dans un workflow.

| Colonne | Type | Contraintes |
|---|---|---|
| `id` | `uuid` | PK |
| `workflow_id` | `uuid` | FK, non nul |
| `node_id` | `uuid` | FK `workflow_nodes_catalog`, non nul |
| `position` | `numeric` | ordre des colonnes du board |
| `label_override` | `text` | surcharge locale facultative |
| `probability_override` | `numeric(5,2)` | |
| `stale_after_days` | `integer` | surcharge du seuil de relance |
| `is_initial` | `boolean` | exactement une étape initiale par workflow |

Unique : `(workflow_id, node_id)` — un nœud n'apparaît qu'une fois par workflow.

### `workflow_transitions`
Arêtes autorisées. **Une transition non déclarée est refusée.** Les cycles sont permis
(négociation → relance), ainsi que les branches vers un nœud terminal.

| Colonne | Type | Contraintes |
|---|---|---|
| `id` | `uuid` | PK |
| `workflow_id` | `uuid` | FK, non nul |
| `from_step_id` | `uuid` | FK `workflow_steps` |
| `to_step_id` | `uuid` | FK `workflow_steps`, différent de `from_step_id` |
| `label` | `text` | libellé du bouton d'action |
| `require_comment` | `boolean` | défaut faux |
| `require_fields` | `uuid[]` | champs exigés en plus de ceux requis par l'étape cible |

Unique : `(workflow_id, from_step_id, to_step_id)`.

---

## 4. Formulaires conditionnels

Spécification complète : `docs/SPEC-form-composer.md`.

### `form_fields`

| Colonne | Type | Contraintes |
|---|---|---|
| `id` | `uuid` | PK |
| `workflow_id` | `uuid` | FK, non nul |
| `key` | `text` | unique par workflow |
| `label` | `text` | non nul |
| `type` | `text` | `text`, `textarea`, `number`, `money`, `date`, `datetime`, `select`, `multiselect`, `checkbox`, `url`, `email`, `phone`, `user`, `contact`, `file` |
| `options` | `jsonb` | choix des types `select`/`multiselect`, bornes des numériques |
| `help_text` | `text` | |
| `position` | `numeric` | |
| `archived_at` | `timestamptz` | |

### `form_field_rules`
Conditionnalité par étape : c'est la table qui rend un champ visible ou obligatoire selon le
statut courant de la card.

| Colonne | Type | Contraintes |
|---|---|---|
| `field_id` | `uuid` | PK composite, FK |
| `step_id` | `uuid` | PK composite, FK `workflow_steps` |
| `visibility` | `text` | `CHECK (visibility IN ('hidden','visible','required'))` |

Absence de ligne pour un couple : le champ suit sa valeur par défaut, `visible`.

### `card_field_values`

| Colonne | Type | Contraintes |
|---|---|---|
| `card_id` | `uuid` | PK composite, FK |
| `field_id` | `uuid` | PK composite, FK |
| `value` | `jsonb` | non nul ; `'null'::jsonb` signifie explicitement vide |
| `updated_by` | `uuid` | FK `profiles` |
| `updated_at` | `timestamptz` | |

Index GIN sur `value` pour les filtres des vues sauvegardées.

---

## 5. Cards

### `cards`

| Colonne | Type | Contraintes |
|---|---|---|
| `id` | `uuid` | PK |
| `workspace_id` | `uuid` | FK, non nul (dénormalisé pour les politiques RLS) |
| `channel_id` | `uuid` | FK, non nul |
| `workflow_id` | `uuid` | FK, non nul — figé à la création, suit le channel |
| `current_step_id` | `uuid` | FK `workflow_steps`, non nul |
| `title` | `text` | non nul |
| `description` | `text` | |
| `position` | `numeric` | index fractionnaire pour le glisser-déposer |
| `owner_id` | `uuid` | FK `profiles` |
| `amount` | `numeric(14,2)` | montant de l'affaire |
| `currency` | `text` | défaut `'EUR'` |
| `probability_override` | `numeric(5,2)` | sinon celle de l'étape |
| `next_action` | `text` | prochaine action à mener |
| `next_action_at` | `timestamptz` | échéance, alimente la vue « Ma journée » |
| `entered_step_at` | `timestamptz` | date d'entrée dans l'étape courante, base des relances |
| `health_score` | `integer` | recalculé par l'ordonnanceur |
| `email_local_part` | `text` | unique global, partie locale de l'adresse de la card |
| `snoozed_until` | `timestamptz` | |
| `archived_at`, `deleted_at` | `timestamptz` | |
| `created_by` | `uuid` | FK `profiles` |
| `created_at`, `updated_at` | `timestamptz` | |
| `search_tsv` | `tsvector` | colonne générée, index GIN |

`email_local_part` est généré par trigger sous la forme `c-<8 caractères base32>`, non devinable
afin qu'une adresse divulguée ne permette pas d'énumérer les autres cards. L'adresse complète
est `email_local_part || '@' || workspaces.inbound_domain`.

### `card_comments`

| Colonne | Type | Contraintes |
|---|---|---|
| `id`, `card_id`, `workspace_id` | `uuid` | |
| `author_id` | `uuid` | FK `profiles` |
| `body` | `text` | non nul, markdown |
| `mentions` | `uuid[]` | destinataires de notification |
| `created_at`, `edited_at`, `deleted_at` | `timestamptz` | |

Tout membre pouvant lire la card peut commenter : c'est la règle demandée.

### `card_activities`
Activités typées, distinctes des commentaires libres.

| Colonne | Type | Contraintes |
|---|---|---|
| `id`, `card_id`, `workspace_id` | `uuid` | |
| `type` | `text` | `CHECK (type IN ('call','meeting','visio','note'))` |
| `occurred_at` | `timestamptz` | non nul |
| `duration_minutes` | `integer` | |
| `body` | `text` | compte rendu |
| `author_id` | `uuid` | FK `profiles` |

### `card_events`
Timeline **append-only**, alimentée par triggers. Aucune écriture directe par un client.

| Colonne | Type | Contraintes |
|---|---|---|
| `id`, `card_id`, `workspace_id` | `uuid` | |
| `type` | `text` | `created`, `moved`, `field_changed`, `assigned`, `mail_received`, `mail_sent`, `archived`, … |
| `actor_id` | `uuid` | nul si l'auteur est un service |
| `payload` | `jsonb` | avant/après |
| `created_at` | `timestamptz` | |

### Tables satellites

| Table | Contenu |
|---|---|
| `tags`, `card_tags` | Étiquettes transverses, filtrables |
| `card_watchers` | Abonnements aux notifications d'une card |
| `card_checklists`, `card_checklist_items` | Sous-tâches |
| `card_templates` | Modèles par channel : champs pré-remplis et checklist type |

---

## 6. Relations

### `organizations`

| Colonne | Type | Contraintes |
|---|---|---|
| `id`, `workspace_id` | `uuid` | |
| `name` | `text` | non nul |
| `domain` | `text` | unique par workspace, pivot du rapprochement des emails |
| `website` | `text` | |

### `contacts`

| Colonne | Type | Contraintes |
|---|---|---|
| `id`, `workspace_id` | `uuid` | |
| `organization_id` | `uuid` | FK, facultatif |
| `full_name` | `text` | |
| `email` | `text` | unique par workspace sur `lower(email)` |
| `phone`, `role_title` | `text` | |
| `source` | `text` | `manual`, `email`, `import` |

### `card_contacts`
Association n-n, avec un rôle (`decideur`, `prescripteur`, `technique`, …).

---

## 7. Messagerie

Spécification complète : `docs/SPEC-mail-subsystem.md`. La séparation entre compte entrant et
identité sortante traduit une contrainte réelle : un utilisateur peut recevoir sur une boîte et
répondre depuis une adresse hébergée ailleurs.

### `mail_inbound_accounts` (IMAP)

| Colonne | Type | Contraintes |
|---|---|---|
| `id`, `workspace_id` | `uuid` | |
| `owner_id` | `uuid` | FK `profiles`, **nul = boîte système du workspace** |
| `label` | `text` | non nul |
| `imap_host` | `text` | non nul |
| `imap_port` | `integer` | non nul |
| `imap_security` | `text` | `CHECK (imap_security IN ('ssl','starttls','none'))` |
| `imap_username` | `text` | non nul |
| `secret_id` | `uuid` | référence Vault — **révoquée en lecture pour `authenticated`** |
| `watch_folders` | `text[]` | défaut `{INBOX}` |
| `folder_style` | `text` | `CHECK (folder_style IN ('folder','label'))` |
| `sync_state` | `jsonb` | dernier `UIDVALIDITY` et dernier UID vu par dossier |
| `backfill_months` | `integer` | profondeur d'import initial |
| `status` | `text` | `pending`, `ok`, `error`, `disabled` |
| `last_sync_at` | `timestamptz` | |
| `last_error` | `text` | message assaini, sans identifiants |

### `mail_outbound_identities` (SMTP)

| Colonne | Type | Contraintes |
|---|---|---|
| `id`, `workspace_id` | `uuid` | |
| `owner_id` | `uuid` | FK `profiles`, nul = identité de service |
| `label` | `text` | non nul |
| `smtp_host`, `smtp_port`, `smtp_security`, `smtp_username` | | comme ci-dessus |
| `secret_id` | `uuid` | référence Vault, mêmes restrictions |
| `from_address` | `text` | non nul — l'adresse réellement affichée |
| `from_name` | `text` | |
| `signature_html` | `text` | |
| `is_default` | `boolean` | une seule par utilisateur |
| `daily_quota` | `integer` | garde-fou anti-abus |
| `status`, `last_error` | | |

### `mail_messages`
Message canonique, dédoublonné.

| Colonne | Type | Contraintes |
|---|---|---|
| `id`, `workspace_id` | `uuid` | |
| `rfc822_message_id` | `text` | unique avec `workspace_id` |
| `in_reply_to` | `text` | |
| `references` | `text[]` | |
| `subject` | `text` | |
| `from_addr`, `from_name` | `text` | |
| `to_addrs`, `cc_addrs` | `text[]` | |
| `sent_at` | `timestamptz` | date du message |
| `body_text`, `body_html` | `text` | |
| `raw_path` | `text` | message brut dans Storage |
| `direction` | `text` | `CHECK (direction IN ('inbound','outbound'))` |
| `card_id` | `uuid` | FK `cards`, nul tant que non classé |
| `classification` | `text` | `CHECK (classification IN ('auto','manual','unclassified'))` |
| `classified_by` | `uuid` | FK `profiles`, nul si automatique |
| `snoozed_until` | `timestamptz` | |
| `search_tsv` | `tsvector` | index GIN |

Un message classé dans une card **reste** dans l'inbox globale : le classement renseigne
`card_id`, il ne retire rien.

### `mail_message_occurrences`
Un même message peut exister dans plusieurs boîtes (boîte système et boîte mirroir).

| Colonne | Type | Contraintes |
|---|---|---|
| `message_id` | `uuid` | PK composite |
| `account_id` | `uuid` | PK composite, FK `mail_inbound_accounts` |
| `folder` | `text` | PK composite |
| `uid` | `bigint` | UID IMAP dans ce dossier |
| `flags` | `text[]` | |

### `mail_attachments`

| Colonne | Type | Contraintes |
|---|---|---|
| `id`, `message_id`, `card_id` | `uuid` | `card_id` recopié pour un accès direct depuis la card |
| `filename` | `text` | non nul, assaini |
| `mime_type` | `text` | déterminé par inspection, pas seulement par l'extension |
| `size_bytes` | `bigint` | |
| `storage_path` | `text` | |
| `sha256` | `text` | déduplication du contenu |
| `av_status` | `text` | `CHECK (av_status IN ('pending','clean','infected','skipped'))` |
| `extracted_text` | `text` | pour la recherche dans le contenu |

Une pièce jointe n'est téléchargeable qu'en statut `clean`.

### `mail_outbox`
File d'envoi persistante.

| Colonne | Type | Contraintes |
|---|---|---|
| `id`, `workspace_id` | `uuid` | |
| `identity_id` | `uuid` | FK `mail_outbound_identities` |
| `card_id` | `uuid` | détermine le `Reply-To` |
| `in_reply_to_message_id` | `uuid` | FK `mail_messages`, pour le fil |
| `to_addrs`, `cc_addrs`, `bcc_addrs` | `text[]` | |
| `subject`, `body_html`, `body_text` | `text` | |
| `attachments` | `jsonb` | chemins Storage |
| `status` | `text` | `queued`, `sending`, `sent`, `failed`, `cancelled` |
| `attempts` | `integer` | défaut 0 |
| `next_attempt_at` | `timestamptz` | backoff exponentiel |
| `last_error` | `text` | assaini |
| `sent_message_id` | `uuid` | FK `mail_messages` une fois envoyé |

### Autres tables de messagerie

| Table | Contenu |
|---|---|
| `mail_folder_map` | Correspondance entre une card/channel/track et le chemin IMAP réellement créé, par compte |
| `mail_templates` | Modèles avec variables (`{{card.title}}`, `{{contact.full_name}}`, …) |
| `mail_sequences`, `mail_sequence_steps` | Cadences de relance (J+3, J+8, J+15) |
| `card_sequence_enrollments` | Inscription d'une card à une cadence, arrêtée dès qu'une réponse arrive |

---

## 8. Transverse

| Table | Contenu |
|---|---|
| `notifications` | Destinataire, type, charge utile, date de lecture |
| `notification_preferences` | Canal souhaité par type : in-app, email immédiat, digest |
| `audit_log` | Acteur, action, entité, charge utile, date — append-only |
| `api_tokens` | Jetons à portée limitée : empreinte stockée, jamais le jeton en clair |
| `webhook_endpoints`, `webhook_deliveries` | Points de sortie signés et historique des remises |
| `saved_views` | Filtres nommés, personnels ou partagés |

---

## 9. Fonctions et RPC

| Fonction | Rôle | État |
|---|---|---|
| `app.workspace_role(ws)` | Rôle de l'appelant dans le workspace, `NULL` s'il n'en est pas membre. `SECURITY DEFINER`, `STABLE` | livrée (`CRM-010`) |
| `app.is_workspace_member(ws)` / `app.is_workspace_admin(ws)` | Résolution du rôle, `SECURITY DEFINER` pour éviter la récursion RLS | livrées (`CRM-010`) |
| `app.resolve_access(ws_role, track_access, channel_access)` | Algorithme « le plus spécifique gagne » de `docs/SPEC-permissions-rls.md` §2.2, appliqué à trois valeurs déjà lues. Rend `none`, `read` ou `write`. Fonction pure : `IMMUTABLE`, `SECURITY INVOKER` | livrée (`CRM-010`) |
| `app.can_read_track(track)` / `app.can_read_channel(ch)` / `app.can_write_channel(ch)` / `app.can_read_card(card)` | Droit effectif après application des droits fins : lecture de la ligne, puis `app.resolve_access` | **différées** — dépendent de `tracks`, `channels` et `cards` (INC-013) |
| `move_card(card_id, to_step_id, comment)` | **Garde centrale** : droit d'écriture, transition déclarée, champs requis renseignés |
| `copy_workflow_to_track(workflow_id, track_id)` | Copie tracée d'un workflow global vers un track |
| `move_card_to_channel(card_id, channel_id, step_mapping)` | Changement de channel avec remappage explicite des étapes |
| `queue_outbound_email(...)` | Insertion contrôlée dans `mail_outbox` |
| `classify_message(message_id, card_id)` | Classement manuel d'un message, journalisé |

Toutes les fonctions `SECURITY DEFINER` fixent `search_path` explicitement et sont accordées au
seul rôle qui doit les appeler.

---

## 10. Index principaux

| Table | Index |
|---|---|
| `cards` | `(channel_id, current_step_id, position)`, `(workspace_id, next_action_at)`, `(email_local_part)` unique, GIN sur `search_tsv` |
| `card_field_values` | GIN sur `value` |
| `mail_messages` | `(workspace_id, rfc822_message_id)` unique, `(card_id, sent_at DESC)`, GIN sur `search_tsv` |
| `mail_outbox` | partiel sur `status IN ('queued','sending')` trié par `next_attempt_at` |
| `contacts` | unique sur `(workspace_id, lower(email))` |
| `card_events` | `(card_id, created_at DESC)` |

---

## 11. Points à trancher avant implémentation

Consignés également dans `docs/INCONSISTENCY_REPORT.md` :

1. ~~**Disponibilité de `supabase_vault`** dans l'image PostgreSQL retenue. Repli : `pgcrypto`
   avec clé d'environnement dédiée.~~ **Tranché par `CRM-004`** : `supabase_vault` 0.3.1 est
   présente, installée et préchargée dans `supabase/postgres:17.6.1.136`. Vault est retenu, le
   repli `pgcrypto` est abandonné (`docs/JOURNAL.md`, décision 23 ; `docs/DAT.md` §8). Les
   colonnes `secret_id` ci-dessous portent donc bien une référence Vault. Contrainte
   d'exploitation associée : la clé racine vit hors de `PGDATA` et doit être sauvegardée à part
   (décision 24, `docs/DAT.md` §10).
2. **Messages sans `Message-ID`.** Certains expéditeurs non conformes n'en fournissent pas. Une
   empreinte de repli (expéditeur, date, sujet, taille) devra être définie dans la spécification
   du sous-système mail avant implémentation.
3. **Archivage d'un nœud utilisé.** L'archivage d'un nœud du catalogue encore référencé par des
   cards actives exige un plan de remappage. Comportement par défaut retenu : archivage refusé
   tant que des cards s'y trouvent.
