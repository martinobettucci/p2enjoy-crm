# Déplacer un track entier d'un espace à un autre — `CRM-162`

*Écrit le 2026-11-21, avant le code (décisions 964, 965, 966 et 968).* **Origine** : « on devrait pouvoir et depuis
exclusivement le admin, bouger des tracks entiers entre workspaces ». **Connecteur MCP : non** (décision 964) — un geste rare
de super-administrateur, dans l'interface seule ; la question ne se repose pas. L'apparence : `docs/DESIGN_SYSTEM.md`
§5.112 ; le schéma : `docs/SCHEMA.md`, « Migration — `CRM-162` T1 ».

## 1. Ce que l'unité livre, et ce qu'elle ne livre pas

**Elle livre** : depuis Plateforme ▸ Espaces, la fiche d'un espace, un **aperçu chiffré** du déplacement d'un de ses tracks
vers un autre espace, ses **refus listés**, puis le **déplacement** confirmé par la **saisie du nom du track**, en une seule
transaction, journalisé ; l'ancienne adresse d'une affaire déplacée qui **continue d'aboutir** ; le déplacement inverse, qui
est le même geste.

**Elle ne livre pas** : le déplacement d'un channel seul, ou d'une affaire seule ; la fusion de deux tracks (un homonyme
refuse, décision 968) ; un outil du connecteur ; le déplacement d'un espace entier ; la conversion d'une valeur d'un type de
champ à un autre (un homonyme d'un autre type refuse, décision 968).

## 2. Qui

**Le super-administrateur seul** (décision 964). Les deux fonctions publiques (§5, §6) appellent `app.exiger_superadmin()`
en premier : toute autre personne reçoit `42501 forbidden`, par l'API comme par l'écran (`CLAUDE.md` §10). Elles sont
`SECURITY DEFINER` : le super-administrateur n'est pas membre de tous les espaces, et la RLS ne lui ouvrirait pas les lignes
à déplacer.

## 3. Ce que le déplacement emporte — l'inventaire

L'inventaire part du graphe des clés étrangères, fermé depuis `tracks` et depuis `cards` (mesuré sur la base au 2026-11-21).
**L'ensemble déplacé** est : le track ; ses channels ; les **affaires dont tous les rattachements** (`card_placements`) sont
dans ces channels — une affaire rattachée aussi ailleurs refuse (§4) ; et tout ce qui leur est rattaché. Chaque table porte
ici son sort. *Changer d'espace* veut dire : `workspace_id` réécrit à l'espace d'arrivée, et les références aux référentiels
réécrites selon §7.

### 3.1 Changent d'espace avec le track

| Table | Lignes concernées | Remarque |
|---|---|---|
| `tracks` | le track | son nom et son adresse ne changent pas (un homonyme refuse, §4) |
| `channels` | ses channels | `workflow_id` réécrit (§7.3) |
| `workflows` et leur graphe | les workflows **propres au track** (`track_id` = le track) : `workflow_steps`, `workflow_transitions`, `workflow_versions`, `form_fields`, `form_field_rules`, `workflow_step_checklist_items`, `workflow_transition_required_fields`, `workflow_transition_required_checklist_items`, `workflow_transition_required_common_fields`, `card_templates`, `suggestions_ia`, `suggestions_ia_revisions` | les étapes réécrivent leur nœud (§7.2) ; les champs communs requis par une transition, leur champ (§7.1) |
| `cards` | les affaires déplacées | `email_local_part` **ne change pas** (§8) |
| `card_placements`, `card_field_values`, `card_checklist_items` | leurs rattachements, valeurs, cases | `workflow_id` et l'étape courante réécrits quand le workflow est apparié (§7.3) |
| `card_common_field_values` | les valeurs de la partie commune | `field_id` réécrit (§7.1) |
| `card_labels` | les étiquettes posées | `label_id` réécrit (§7.1) |
| `card_contacts` | les contacts liés | `contact_id` réécrit (§7.4) |
| `card_comments`, `card_comment_mentions` | le fil de chaque affaire | |
| `card_activities` | les activités | leurs participants (`card_activity_participants`) réécrivent leur contact (§7.4) |
| `card_events` | l'historique de chaque affaire | une entrée `track_moved` y est ajoutée (§10) |
| `card_sequence_enrollments` | les relances **closes** | `sequence_id` réécrit (§7.5) ; une relance armée refuse (§4) |
| `saisies_temps` | les temps saisis sur le track, ses channels et ses affaires | valorisés à l'arrivée (§9) |
| `saved_views` | les vues enregistrées des channels | |
| `webhook_endpoints`, `webhook_deliveries` | les webhooks limités à un channel déplacé, et leur historique | décision 968 ; un webhook de « tout l'espace » reste |
| `mail_messages` | les mails classés dans les affaires déplacées | |
| `mail_message_labels`, `mail_label_evaluations` | leurs pastilles et leur évaluation | `label_id` réécrit (§7.1) |
| `mail_message_transfers`, `mail_trash_moves` | leurs transferts, leurs déplacements en corbeille | |
| `mail_thread_snoozes` | le sommeil de leurs fils | la clé du fil ne change pas |
| `mail_outbox` | les envois **passés** (partis, en échec, annulés) des affaires | un envoi en file refuse (§4) ; l'identité citée est gardée (§3.3) |
| `mail_drafts` | les mails préparés **écartés ou envoyés** | un mail préparé en attente refuse (§4, décision 968) |
| `notifications` | celles dont le sujet est une affaire déplacée | leurs destinataires les gardent |

### 3.2 Suivent par leur clé, sans colonne d'espace

`budgets`, `budget_occurrences` (par le track) ; `card_costs`, `card_cost_actuals`, `card_revenues`,
`card_revenue_actuals` (par l'affaire) ; `track_members`, `channel_members` (par le track et ses channels) ;
`mail_attachments`, `mail_attachment_risk_acknowledgments`, `mail_message_occurrences`, `mail_message_reads` (par le mail) ;
`goal_links`. **Rien à réécrire** : leur parent change d'espace.

- **Les pièces jointes ne bougent pas dans le stockage** : leur chemin est une clé opaque, et l'accès passe par la ligne
  `mail_attachments` de leur message (`app.piece_jointe_telechargeable`), qui suit l'affaire.
- **Les blocs d'objectifs** (`goal_blocks`) qui citent un channel déplacé **gardent leur lien** ; le tableau d'objectifs reste
  dans son espace ; le bloc s'affiche avec le nom de l'espace d'arrivée (décision 966 ; `docs/DESIGN_SYSTEM.md` §5.112).

### 3.3 Restent dans l'espace de départ — l'histoire est gardée

| Table | Pourquoi |
|---|---|
| `mail_inbound_accounts`, `mail_outbound_identities` | les boîtes et adresses par où un mail est passé ; les mails déplacés les citent encore (décision 968) |
| `goal_boards` | le tableau d'objectifs ne suit pas un channel qu'il cite (décision 966) |
| `couts_personnel` | le coût d'une personne est par espace (décision 965) ; les temps déplacés lisent celui de l'arrivée (§9) |
| `audit_log`, `mcp_journal`, `plateforme_journal` | les journaux disent ce qui s'est passé où ; le déplacement y écrit sa ligne (§10) |
| `mail_blocked_senders`, `mail_templates`, `mcp_droits`, `mcp_prompts`, `digest_runs`, `digest_subscriptions`, `workspace_members`, `workspace_invitations`, `organization_categories`, `organization_category_links`, `organization_comments`, `organization_comment_mentions`, `admission_refus`, `mail_sequence_steps` des séquences de départ | propres à l'espace ou à une personne ; ils ne citent aucune ligne déplacée, ou la citent par une clé simple qui reste valide |

**Une référence croisée est admise** là où la clé étrangère est simple (sans `workspace_id`) : un mail passé cite une boîte
du départ ; un `digest_runs` cite un envoi déplacé. Là où la clé est composite (`workspace_id` + identifiant), la ligne
change d'espace avec sa cible, ou la cible est appariée.

## 4. Les refus — tous listés dans l'aperçu

L'aperçu (§5) rend **tous** les refus, chacun avec sa liste ; le déplacement (§6) les recalcule et refuse s'il en reste un,
par **`22023 track_move_refused`** et la même liste. Aucun refus ne s'arrange de lui-même.

| Code | Le refus | La liste |
|---|---|---|
| `same_workspace` | l'espace d'arrivée est celui du track | — |
| `track_trashed` | le track est à la corbeille | — |
| `homonym_track` | l'arrivée a un track du même nom, ou de la même adresse (décision 968) | le track homonyme |
| `shared_card` | une affaire est aussi rattachée à un channel d'un autre track (décision 964) | les affaires, et leurs autres tracks |
| `non_member` | une **personne citée** n'est pas membre de l'arrivée (décisions 964, 968) | les personnes, et ce qui les cite |
| `armed_sequence` | une relance est armée sur une affaire (décision 966) | les affaires et leur séquence |
| `queued_send` | un envoi est en file (`mail_outbox` en attente) sur une affaire (décision 966) | les affaires et l'objet du mail |
| `pending_draft` | un mail préparé attend sa relecture sur une affaire (décision 968) | les affaires et l'objet du mail |
| `field_type_conflict` | un champ commun utilisé a un homonyme d'un autre type à l'arrivée (décision 968) | le champ, ses deux types |

**Une personne citée** (décision 968) : toute personne que nomme une ligne de l'ensemble déplacé (§3.1, §3.2) — membres du
track et de ses channels, responsables d'affaires, auteurs (de l'affaire, d'un commentaire, d'une activité, d'une saisie de
temps, d'un envoi, d'une pose de pastille, d'un événement), personnes mentionnées, participants, destinataires d'un transfert
ou d'une notification, propriétaires d'une vue. Les colonnes qui nomment une personne sont celles qui référencent `profiles`.
Un compte supprimé (référence nulle) ne compte pas.

## 5. L'aperçu — `public.track_move_preview(p_track_id uuid, p_target_workspace_id uuid) returns jsonb`

`STABLE`, `SECURITY DEFINER`, `search_path` vide, `authenticated` seulement. Il **n'écrit rien**. Il rend :

- `track` (nom, adresse), `from`, `to` (identifiant, nom, slug, domaine entrant) ;
- `counts` : channels, affaires, mails, pièces jointes, commentaires, temps saisis (et leur durée), budgets, coûts, recettes,
  webhooks, vues ;
- `referentials` : pour chaque famille (étiquettes, champs communs, nœuds de workflow, workflows d'espace, contacts,
  organisations, pastilles, séquences), deux listes — **réutilisés** (le nom au départ, le nom à l'arrivée) et **créés** ;
- `costs` : la valeur des temps déplacés au coût du personnel du départ, puis de l'arrivée, l'écart, et les **personnes sans
  coût défini** à l'arrivée (une liste, pas un refus — décision 966) ;
- `addresses` : le domaine d'arrivée, et le nombre d'adresses d'affaires qui y prendront leur nouvelle forme ; **sans domaine
  à l'arrivée**, une mention, pas un refus : les affaires n'y auront d'adresse qu'une fois le domaine réglé, et l'ancienne
  continue d'aboutir (§8) ;
- `refusals` : la liste des refus du §4, vide quand le déplacement est permis.

## 6. Le déplacement — `public.move_track(p_track_id uuid, p_target_workspace_id uuid, p_confirm_name text) returns jsonb`

`SECURITY DEFINER`, `search_path` vide, `authenticated` seulement, **une seule transaction**.

1. `app.exiger_superadmin()` ; `p_confirm_name` égal au nom du track (après `btrim`), sinon `22023 confirmation_mismatch`.
2. **Les verrous** : le track, ses channels et ses affaires `for update`, dans cet ordre, pour qu'aucun geste concurrent ne
   crée entre l'aperçu et l'écriture ce que l'aperçu n'a pas vu.
3. **Les refus** recalculés (§4) ; s'il en reste, `22023 track_move_refused` avec la liste, et rien n'est écrit.
4. **Les référentiels** appariés ou créés à l'arrivée (§7), dans l'ordre de leurs dépendances : nœuds, champs communs,
   étiquettes, organisations, contacts, pastilles, séquences, workflows d'espace.
5. **Les lignes déplacées** (§3.1), des parents aux enfants : les contraintes de clés composites sont **différées** pour la
   transaction, ou les lignes réécrites dans un ordre où chaque clé reste satisfaite ; le choix est précisé au code.
6. **Les alias d'adresse** (§8), le **journal** et l'**événement** de chaque affaire (§10).
7. Rend le compte de ce qui a été déplacé, réutilisé et créé (la forme de `counts` et de `referentials`).

Les déclencheurs qui réagissent à un `UPDATE` (audit, recherche, évaluations, files) ne doivent rien émettre de faux : chacun
est vérifié au code, et la spécification est précisée de ce qui est neutralisé pour la transaction et pourquoi.

## 7. Les référentiels — retrouvés, sinon créés (décisions 964 et 968)

Chaque référentiel **cité** par l'ensemble déplacé est cherché à l'arrivée ; trouvé, il est **réutilisé** ; sinon il est
**créé** à l'arrivée, copie de celui du départ. Celui du départ **reste** : d'autres tracks peuvent le citer.

### 7.1 Par le nom, sans tenir compte de la casse ni des blancs aux bords

- **étiquettes** (`labels`) ; **pastilles des mails** (`mail_labels`) — créées avec leur couleur, leur descriptif et leur
  drapeau « cachée » ; **champs communs** (`card_common_fields`) — un homonyme **d'un autre type refuse** (§4), un homonyme
  du même type est réutilisé, ses choix d'une liste complétés des choix absents.
- une **archivée** à l'arrivée compte comme homonyme : elle est réutilisée, et reste archivée.

### 7.2 Les nœuds de workflow (`workflow_nodes_catalog`) — par leur clé

Une étape cite son nœud ; il est apparié par sa `key`, sinon créé.

### 7.3 Les workflows

- **Propre au track** : il suit le track (§3.1).
- **Commun à l'espace**, utilisé par un channel déplacé : **réutilisé** si l'arrivée a un workflow d'espace **du même nom
  et identique** — mêmes étapes (par nom et par nœud apparié), mêmes champs de formulaire (par nom et par type) ; **sinon
  copié** à l'arrivée, avec tout son graphe, sous son nom, ou suffixé du nom de l'espace de départ si le nom y est pris par
  un workflow différent (décision 968). Réutilisé, les étapes courantes et les valeurs des affaires sont réécrites vers les
  étapes et les champs homonymes ; copié, vers ceux de la copie. Aucune affaire ne perd son étape ni ses valeurs.

### 7.4 Contacts et organisations (décision 968)

- **contact** : par son **e-mail** (sans casse), sinon par son **nom complet** quand il n'a pas d'e-mail ; créé avec son nom,
  son e-mail, son téléphone et sa fonction ;
- **organisation** : par son **domaine**, sinon par son **nom** ; créée avec son nom, son domaine et son site ; ses
  catégories et son fil de commentaires restent au départ (§3.3) ;
- un contact créé est rattaché à l'organisation appariée de son organisation de départ.

### 7.5 Les séquences de relance (décision 968)

Par le nom ; sinon copiée avec ses paliers (`mail_sequence_steps`), les modèles cités appariés par leur nom, sinon copiés.

## 8. Les adresses des affaires (décision 964)

- **L'affaire garde sa partie locale** (`email_local_part`, unique dans toute la base) : sa nouvelle adresse est
  `partie_locale@domaine_d_arrivée` — elle est « une adresse du domaine d'arrivée ». Le préfixe reste celui de son tirage.
- **L'ancienne adresse continue d'aboutir** : `public.card_address_aliases (workspace_id, email_local_part, card_id,
  created_at)`, une ligne par affaire déplacée, l'espace de départ et la partie locale ; écrite par la seule fonction de
  déplacement. Le mail adressé à l'ancienne adresse arrive, comme avant, dans la boîte de l'espace de départ (le motif d'alias
  du serveur de messagerie n'a pas changé) ; **`public.classer_message_automatiquement`** gagne la **règle 1 bis** : si la
  règle 1 ne trouve rien dans l'espace du message, un alias de cet espace désigne l'affaire ; le message est alors **déplacé
  dans l'espace de l'affaire** (`app.move_message_to_workspace`, le même mouvement que §3.1 pour un mail) puis classé. La
  **règle 2** (la filiation) cherche aussi un parent déplacé, par les alias.
- **Le déplacement inverse** réécrit l'alias : revenir dans un espace retire l'alias de cet espace et en pose un pour celui
  qu'on quitte.

## 9. Les temps — valorisés à l'arrivée (décision 966)

Le coût d'un temps se lit au coût du personnel **de l'espace de la saisie** (`couts_personnel`, décision 965) : changer
l'espace d'une saisie la revalorise, sans autre écriture. L'aperçu calcule les deux valeurs et l'écart, et liste les personnes
qui ont des temps déplacés et pas de coût à l'arrivée.

## 10. Le journal

- `public.track_moves (id, track_id, track_slug, from_workspace_id, to_workspace_id, moved_by, moved_at)` : la trace de chaque
  déplacement, écrite par la seule fonction de déplacement ; elle sert la redirection des adresses (§12). Lisible par
  `SELECT` sous la RLS de son track : qui lit le track lit ses déplacements ;
- `plateforme_journal` : une ligne `track_moved`, l'acteur, l'espace de départ, la cible `{track_id, track_name, from, to,
  counts, created}` ;
- `card_events` : sur chaque affaire déplacée, `track_moved` (de l'espace, vers l'espace), qui paraît dans son historique ;
- l'onglet « Journal » de la plateforme traduit le geste (« Track « {nom} » déplacé de {espace} vers {espace} »).

## 11. Le déplacement inverse

C'est le même geste, de l'arrivée vers le départ. Les référentiels créés à l'aller **restent** à l'arrivée ; au retour, ceux
du départ sont retrouvés par les mêmes règles (§7) — leurs homonymes d'origine — si bien que l'aller-retour **rend l'état de
départ** des lignes déplacées : mêmes espaces, mêmes référentiels cités, mêmes valeurs ; seuls restent les référentiels
créés à l'arrivée, les alias et les entrées de journal. La preuve pgTAP le constate.

## 12. Les adresses de l'application (décision 967, `CRM-161`)

L'espace est en tête du chemin (`/<espace>/…`) : un track déplacé change d'adresse. *Accordé avec la session qui porte
`CRM-161` (`docs/SPEC-espace-courant.md` §8.2)* : une **affaire** se retrouve par son identifiant, présent dans son adresse —
sa redirection est à la charge de `CRM-161` ; un **track** ou un **channel** n'a qu'une adresse courte, unique dans son seul
espace : sa redirection lit la trace du déplacement.

**`public.track_current_address(p_workspace_slug text, p_track_slug text) returns table (workspace_slug text, track_slug
text)`**, `STABLE`, `SECURITY INVOKER`, `search_path` vide, `authenticated` : le **dernier** déplacement (`track_moves`) d'un
track d'adresse `p_track_slug` **depuis** l'espace `p_workspace_slug`, et l'adresse actuelle de ce track — si l'appelant le
lit (la RLS de `tracks`). Aucune ligne sinon : la route affiche alors « introuvable ». La route d'un track de `CRM-161`
l'appelle quand le track est introuvable dans l'espace de l'adresse ; le chemin d'un channel garde son adresse courte sous
le track redirigé. Prouvé par un E2E après la livraison de `CRM-161`.

## 13. L'écran — Plateforme ▸ Espaces ▸ la fiche d'un espace

L'apparence : `docs/DESIGN_SYSTEM.md` §5.112.

- un bloc **« Tracks »** liste les tracks de l'espace (nom, nombre de channels et d'affaires) ; chaque ligne porte **« Déplacer
  vers un autre espace »** ;
- le geste ouvre **dans le flux** : le choix de l'**espace d'arrivée**, puis l'**aperçu** (§5) — ce qui part, les
  référentiels réutilisés et créés, l'écart de coût et les personnes sans coût, l'adresse des affaires —, puis, **s'il n'y a
  aucun refus**, la **saisie du nom du track** et **« Déplacer le track »** ; s'il y a des refus, ils sont **listés**, et la
  commande n'est pas offerte ;
- le succès dit ce qui a été déplacé et mène à la fiche de l'espace d'arrivée ;
- un refus de la base (un geste concurrent entre l'aperçu et l'écriture) est rendu tel quel, avec sa liste.

**Les objectifs** : un bloc qui cite un channel d'un autre espace l'affiche avec le nom de cet espace (décision 966).

## 14. Le seed

Un **second espace** de démonstration, *accordé avec la session qui porte `CRM-161`*, qui l'enrichit pour le cloisonnement
dans sa propre section : **« Studio Lumen »**, adresse `studio-lumen`, identifiant `5eed0000-0000-4000-8000-000000002001`
(il trie après « P2Enjoy SAS » : l'espace par défaut ne change pas), **l'administratrice du seed** (`admin@p2enjoy.test`)
administratrice des deux. Il est **créé par le §54 de `docs/SPEC-seed.md`** (cette unité), avec ses **homonymes** — une
étiquette, un champ commun du même type, un autre d'un type différent, un contact par son e-mail, une organisation par son
domaine — et sans homonyme pour le reste, pour que l'aperçu d'un track du seed montre les deux listes, et un refus.
**Aucun déplacement n'est joué par le seed** : il reste un geste à démontrer. Tant que `CRM-161` n'est pas livrée, la barre
latérale d'un membre des deux espaces montre les tracks de l'un et de l'autre ; les preuves qui comptent les tracks de la
barre latérale sous ce compte en tiennent compte.

## 15. Preuves exigées

- **pgTAP** : chaque refus du §4, un à un, par son montage ; le déplacement complet (chaque table du §3.1 change d'espace, les
  §3.2 suivent, les §3.3 restent) ; chaque règle d'appariement du §7 (réutilisé et créé) ; l'alias et la règle 1 bis ; la
  valorisation à l'arrivée ; l'aller-retour qui rend l'état de départ ; le refus à qui n'est pas super-administrateur, par
  requête directe ; aucune écriture sur un refus.
- **API** (jetons réels) : l'aperçu et le déplacement sous le super-administrateur ; le refus d'un administrateur d'espace ;
  un mail à l'ancienne adresse classé dans l'affaire, après la relève.
- **Unitaires** : l'écran (le bloc, le choix, l'aperçu et ses listes, la saisie, les refus, les états).
- **E2E** souris et clavier : l'aperçu, la saisie du nom, le déplacement, les refus listés ; quatre paliers ; captures
  observées ; l'adresse de l'ancien track redirigée (après `CRM-161`).

## 16. Tranches

| Tranche | Contenu |
|---|---|
| **T1** | Migration : `card_address_aliases`, `track_moves`, `track_move_preview`, `move_track`, `track_current_address`, `app.move_message_to_workspace`, la règle 1 bis et la filiation par alias ; pgTAP ; API ; `docs/SCHEMA.md`, `docs/DAT.md` ; contrat |
| **T2** | L'écran : le bloc « Tracks » de la fiche d'un espace, l'aperçu, la saisie, les refus ; le journal traduit ; le bloc d'objectifs d'un autre espace ; unitaires ; E2E ; captures ; `docs/DESIGN_SYSTEM.md` §5.112 précisé au code |
| **T3** | Le seed (le second espace et ses homonymes), le manuel (la super-administration), le contrat ; l'adresse redirigée (après `CRM-161`) ; l'unité passe `[P]` |
